//! Schema answers for the `get_schema` tool, built from the same cached
//! catalog Veloxy uses (`get_or_build_ask_veloxy_db_context`: editor
//! metadata plus foreign keys).
//!
//! [`search`] is a port of `rankSchemaContext` in
//! `src/features/queries/veloxy/schema-rank.ts` and [`describe`] of
//! `describeFromCatalog` in `src/features/queries/veloxy/tool-impl.ts`, so an
//! outside agent sees the schema the way Veloxy does. Keep them in sync.

use std::collections::HashSet;

use serde_json::{json, Value};

use crate::models::{AskVeloxyDbContextCache, ForeignKeyEdge, QueryEditorMetadata, QueryEditorTable};

pub(crate) const MAX_CONTEXT_TABLES: usize = 24;
pub(crate) const MAX_CONTEXT_COLUMNS: usize = 40;
pub(crate) const MAX_CONTEXT_RELATIONSHIPS: usize = 60;
/// Approximate cap on the serialized search result.
pub(crate) const SEARCH_CHAR_BUDGET: usize = 5_000;
/// Tables listed by the overview (no search or table given).
pub(crate) const MAX_OVERVIEW_TABLES: usize = 400;

const STOP_WORDS: &[&str] = &[
    "the", "and", "for", "with", "from", "into", "that", "this", "show", "list", "get", "find",
    "all", "any", "per", "top", "how", "many", "much", "what", "which", "where", "when", "who",
    "table", "tables", "column", "columns", "count", "give", "database", "schema", "select",
    "query", "rows", "data",
];

pub(crate) fn tokenize_query(query: &str) -> Vec<String> {
    let mut tokens: Vec<String> = Vec::new();
    let mut push = |token: String| {
        if !tokens.contains(&token) {
            tokens.push(token);
        }
    };
    let lower = query.to_lowercase();
    for raw in lower.split(|c: char| !(c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')) {
        if raw.len() < 3 || STOP_WORDS.contains(&raw) {
            continue;
        }
        push(raw.to_string());
        // Naive singularization so "orders" matches a table named "order".
        if raw.ends_with('s') && raw.len() > 3 {
            push(raw[..raw.len() - 1].to_string());
        }
    }
    tokens
}

fn name_match_score(name: &str, token: &str, exact: i64, partial: i64) -> i64 {
    if name == token {
        exact
    } else if name.contains(token) || (token.len() >= 4 && token.contains(name)) {
        partial
    } else {
        0
    }
}

pub(crate) fn table_relevance_score(table: &QueryEditorTable, prompt_lower: &str, tokens: &[String]) -> i64 {
    let table_name = table.name.to_lowercase();
    let full_name = format!("{}.{}", table.schema.to_lowercase(), table_name);
    let comment_lower = table.comment.as_deref().unwrap_or_default().to_lowercase();
    let mut score = 0;
    if prompt_lower.contains(&full_name) {
        score += 8;
    } else if prompt_lower.contains(&table_name) {
        score += 6;
    }
    let mut column_score = 0;
    let mut comment_score = 0;
    for token in tokens {
        score += name_match_score(&table_name, token, 5, 3);
        for column in &table.columns {
            column_score += name_match_score(&column.name.to_lowercase(), token, 2, 1);
            if column
                .comment
                .as_deref()
                .is_some_and(|comment| comment.to_lowercase().contains(token.as_str()))
            {
                comment_score += 1;
            }
        }
        if comment_lower.contains(token.as_str()) {
            comment_score += 1;
        }
    }
    score + column_score.min(8) + comment_score.min(3)
}

fn table_key(schema: &str, name: &str) -> String {
    format!("{}.{}", schema.to_lowercase(), name.to_lowercase())
}

fn ranked_table_json(table: &QueryEditorTable) -> (Value, bool) {
    let columns: Vec<Value> = table
        .columns
        .iter()
        .take(MAX_CONTEXT_COLUMNS)
        .map(|column| {
            let mut entry = json!({ "name": column.name, "dataType": column.data_type });
            if let Some(comment) = column.comment.as_deref().filter(|c| !c.is_empty()) {
                entry["comment"] = json!(comment);
            }
            entry
        })
        .collect();
    let mut entry = json!({ "schema": table.schema, "name": table.name, "columns": columns });
    if let Some(rows) = table.estimated_rows {
        entry["estimatedRows"] = json!(rows);
    }
    if let Some(comment) = table.comment.as_deref().filter(|c| !c.is_empty()) {
        entry["comment"] = json!(comment);
    }
    (entry, table.columns.len() > MAX_CONTEXT_COLUMNS)
}

pub(crate) fn foreign_key_json(edge: &ForeignKeyEdge) -> Value {
    json!({
        "fromSchema": edge.from_schema,
        "fromTable": edge.from_table,
        "fromColumn": edge.from_column,
        "toSchema": edge.to_schema,
        "toTable": edge.to_table,
        "toColumn": edge.to_column,
    })
}

/// Tables matching `query` (plus their foreign-key neighbours), within the
/// same size budget Veloxy uses.
pub(crate) fn search(metadata: &QueryEditorMetadata, foreign_keys: &[ForeignKeyEdge], query: &str) -> Value {
    let prompt_lower = query.to_lowercase();
    let tokens = tokenize_query(query);

    let mut scored: Vec<(&QueryEditorTable, i64)> = metadata
        .tables
        .iter()
        .map(|table| (table, table_relevance_score(table, &prompt_lower, &tokens)))
        .collect();
    scored.sort_by(|(a_table, a_score), (b_table, b_score)| {
        b_score
            .cmp(a_score)
            .then_with(|| b_table.estimated_rows.unwrap_or(0).cmp(&a_table.estimated_rows.unwrap_or(0)))
    });

    // Direct matches first; with no match, the largest tables (usually the
    // core business tables) so the caller still sees something useful.
    let matches: Vec<&QueryEditorTable> =
        scored.iter().filter(|(_, score)| *score > 0).map(|(table, _)| *table).collect();
    let candidates: Vec<&QueryEditorTable> = if matches.is_empty() {
        scored.iter().map(|(table, _)| *table).collect()
    } else {
        matches.clone()
    };

    // One hop along the foreign-key graph: tables joined to a match are
    // almost always needed for the query being written.
    let mut neighbor_keys: HashSet<String> = HashSet::new();
    if !matches.is_empty() {
        let match_keys: HashSet<String> =
            matches.iter().map(|table| table_key(&table.schema, &table.name)).collect();
        for edge in foreign_keys {
            let from = table_key(&edge.from_schema, &edge.from_table);
            let to = table_key(&edge.to_schema, &edge.to_table);
            if match_keys.contains(&from) && !match_keys.contains(&to) {
                neighbor_keys.insert(to.clone());
            }
            if match_keys.contains(&to) && !match_keys.contains(&from) {
                neighbor_keys.insert(from);
            }
        }
    }
    let neighbors = scored
        .iter()
        .filter(|(table, score)| *score == 0 && neighbor_keys.contains(&table_key(&table.schema, &table.name)))
        .map(|(table, _)| *table);
    let ordered: Vec<&QueryEditorTable> = if matches.is_empty() {
        candidates
    } else {
        candidates.into_iter().chain(neighbors).collect()
    };

    let mut truncated = metadata.truncated_tables || metadata.truncated_columns;
    let mut used_chars = 0usize;
    let mut tables: Vec<Value> = Vec::new();
    let mut selected: HashSet<String> = HashSet::new();
    for table in &ordered {
        if tables.len() >= MAX_CONTEXT_TABLES {
            truncated = true;
            break;
        }
        let (entry, columns_truncated) = ranked_table_json(table);
        let size = entry.to_string().len();
        if !tables.is_empty() && used_chars + size > SEARCH_CHAR_BUDGET {
            truncated = true;
            break;
        }
        truncated |= columns_truncated;
        tables.push(entry);
        selected.insert(table_key(&table.schema, &table.name));
        used_chars += size;
    }
    if tables.len() < ordered.len() {
        truncated = true;
    }

    // Only relationships touching a returned table are useful.
    let relevant: Vec<&ForeignKeyEdge> = foreign_keys
        .iter()
        .filter(|edge| {
            selected.contains(&table_key(&edge.from_schema, &edge.from_table))
                || selected.contains(&table_key(&edge.to_schema, &edge.to_table))
        })
        .collect();
    if relevant.len() > MAX_CONTEXT_RELATIONSHIPS {
        truncated = true;
    }
    json!({
        "tables": tables,
        "foreignKeys": relevant.iter().take(MAX_CONTEXT_RELATIONSHIPS).map(|edge| foreign_key_json(edge)).collect::<Vec<_>>(),
        "truncated": truncated,
    })
}

/// Splits `schema.table` (quotes and backticks allowed) into its parts.
pub(crate) fn parse_table_ref(input: &str) -> (Option<String>, String) {
    let clean = |part: &str| part.trim().trim_matches(|c| c == '"' || c == '`' || c == '[' || c == ']').to_string();
    match input.trim().split_once('.') {
        Some((schema, name)) if !name.trim().is_empty() => (Some(clean(schema)), clean(name)),
        _ => (None, clean(input)),
    }
}

/// Catalog tables matching a `schema.table` or bare table reference.
pub(crate) fn find_tables<'a>(metadata: &'a QueryEditorMetadata, reference: &str) -> Vec<&'a QueryEditorTable> {
    let (schema, name) = parse_table_ref(reference);
    metadata
        .tables
        .iter()
        .filter(|table| {
            table.name.eq_ignore_ascii_case(&name)
                && schema
                    .as_deref()
                    .map_or(true, |schema| table.schema.eq_ignore_ascii_case(schema))
        })
        .collect()
}

fn enum_values_for_type(metadata: &QueryEditorMetadata, data_type: &str) -> Option<Vec<String>> {
    let normalized = data_type.trim().to_lowercase();
    let normalized = normalized.trim_end_matches("[]");
    metadata
        .enums
        .iter()
        .find(|item| {
            let name = item.name.to_lowercase();
            name == normalized || name.ends_with(&format!(".{}", normalized))
        })
        .map(|item| item.values.clone())
}

/// One table in full: columns, keys, enum values and the foreign keys that
/// touch it.
pub(crate) fn describe(context: &AskVeloxyDbContextCache, table: &QueryEditorTable) -> Value {
    let columns: Vec<Value> = table
        .columns
        .iter()
        .map(|column| {
            // Left out when the catalog does not know (SQLite reports
            // neither), rather than guessed.
            let mut entry = json!({ "name": column.name, "dataType": column.data_type });
            if let Some(nullable) = column.is_nullable {
                entry["nullable"] = json!(nullable);
            }
            if let Some(primary_key) = column.is_primary_key {
                entry["primaryKey"] = json!(primary_key);
            }
            if let Some(comment) = column.comment.as_deref().filter(|c| !c.is_empty()) {
                entry["comment"] = json!(comment);
            }
            if let Some(values) = enum_values_for_type(&context.metadata, &column.data_type) {
                entry["enumValues"] = json!(values);
            }
            entry
        })
        .collect();
    let foreign_keys: Vec<Value> = context
        .foreign_keys
        .iter()
        .filter(|edge| {
            (edge.from_schema.eq_ignore_ascii_case(&table.schema) && edge.from_table.eq_ignore_ascii_case(&table.name))
                || (edge.to_schema.eq_ignore_ascii_case(&table.schema) && edge.to_table.eq_ignore_ascii_case(&table.name))
        })
        .map(foreign_key_json)
        .collect();
    let mut entry = json!({
        "schema": table.schema,
        "name": table.name,
        "columns": columns,
        "foreignKeys": foreign_keys,
    });
    if let Some(rows) = table.estimated_rows {
        entry["estimatedRows"] = json!(rows);
    }
    if let Some(comment) = table.comment.as_deref().filter(|c| !c.is_empty()) {
        entry["comment"] = json!(comment);
    }
    entry
}

/// Every table by name, for a first look at an unfamiliar database.
pub(crate) fn overview(context: &AskVeloxyDbContextCache) -> Value {
    let tables: Vec<Value> = context
        .metadata
        .tables
        .iter()
        .take(MAX_OVERVIEW_TABLES)
        .map(|table| {
            let mut entry = json!({
                "name": format!("{}.{}", table.schema, table.name),
                "columnCount": table.columns.len(),
            });
            if let Some(rows) = table.estimated_rows {
                entry["estimatedRows"] = json!(rows);
            }
            entry
        })
        .collect();
    json!({
        "database": context.database_name,
        "tables": tables,
        "relationshipCount": context.foreign_keys.len(),
        "truncated": context.metadata.tables.len() > MAX_OVERVIEW_TABLES || context.metadata.truncated_tables,
        "hint": "Pass `search` (keywords) for matching tables with columns and foreign keys, or `table` (schema.table) for one table in full.",
    })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::models::{DatabaseEngine, QueryEditorColumn, QueryEditorEnum};

    fn column(name: &str, data_type: &str) -> QueryEditorColumn {
        QueryEditorColumn {
            name: name.to_string(),
            data_type: data_type.to_string(),
            comment: None,
            is_nullable: Some(name != "id"),
            is_primary_key: Some(name == "id"),
        }
    }

    fn table(schema: &str, name: &str, columns: &[(&str, &str)], rows: Option<i64>) -> QueryEditorTable {
        QueryEditorTable {
            schema: schema.to_string(),
            name: name.to_string(),
            columns: columns.iter().map(|(n, t)| column(n, t)).collect(),
            estimated_rows: rows,
            comment: None,
        }
    }

    fn edge(from: (&str, &str, &str), to: (&str, &str, &str)) -> ForeignKeyEdge {
        ForeignKeyEdge {
            from_schema: from.0.into(), from_table: from.1.into(), from_column: from.2.into(),
            to_schema: to.0.into(), to_table: to.1.into(), to_column: to.2.into(),
        }
    }

    pub(crate) fn sample_context() -> AskVeloxyDbContextCache {
        AskVeloxyDbContextCache {
            database_name: "shop".into(),
            engine: DatabaseEngine::Postgres,
            metadata: QueryEditorMetadata {
                tables: vec![
                    table("public", "customers", &[("id", "integer"), ("email", "text")], Some(500)),
                    table("public", "orders", &[("id", "integer"), ("customer_id", "integer"), ("status", "order_status"), ("total", "numeric")], Some(9_000)),
                    table("public", "audit_log", &[("id", "integer"), ("payload", "jsonb")], Some(90_000)),
                    table("billing", "invoices", &[("id", "integer"), ("order_id", "integer")], Some(8_000)),
                ],
                functions: Vec::new(),
                enums: vec![QueryEditorEnum { name: "public.order_status".into(), values: vec!["open".into(), "paid".into()] }],
                truncated_tables: false,
                truncated_columns: false,
                truncated_functions: false,
            },
            foreign_keys: vec![
                edge(("public", "orders", "customer_id"), ("public", "customers", "id")),
                edge(("billing", "invoices", "order_id"), ("public", "orders", "id")),
            ],
        }
    }

    fn names(result: &Value) -> Vec<String> {
        result["tables"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| format!("{}.{}", t["schema"].as_str().unwrap(), t["name"].as_str().unwrap()))
            .collect()
    }

    #[test]
    fn tokenizer_drops_stop_words_and_singularizes() {
        assert_eq!(tokenize_query("Show all orders per customer"), vec!["orders", "order", "customer"]);
        assert!(tokenize_query("the a of").is_empty());
    }

    #[test]
    fn search_ranks_matches_then_foreign_key_neighbours() {
        let context = sample_context();
        let result = search(&context.metadata, &context.foreign_keys, "orders by status");
        let names = names(&result);
        assert_eq!(names[0], "public.orders");
        assert!(names.contains(&"public.customers".to_string()), "FK neighbour: {names:?}");
        assert!(names.contains(&"billing.invoices".to_string()), "FK neighbour: {names:?}");
        assert!(!names.contains(&"public.audit_log".to_string()), "unrelated: {names:?}");
        assert_eq!(result["foreignKeys"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn search_without_matches_falls_back_to_largest_tables() {
        let context = sample_context();
        let result = search(&context.metadata, &context.foreign_keys, "zebra");
        assert_eq!(names(&result)[0], "public.audit_log");
    }

    #[test]
    fn describe_includes_keys_enums_and_relationships() {
        let context = sample_context();
        let orders = find_tables(&context.metadata, "public.orders");
        assert_eq!(orders.len(), 1);
        let described = describe(&context, orders[0]);
        assert_eq!(described["estimatedRows"], json!(9_000));
        assert_eq!(described["columns"][0]["primaryKey"], json!(true));
        assert_eq!(described["columns"][2]["enumValues"], json!(["open", "paid"]));
        assert_eq!(described["foreignKeys"].as_array().unwrap().len(), 2);

        let mut unknown = orders[0].clone();
        unknown.columns[0].is_primary_key = None;
        unknown.columns[0].is_nullable = None;
        let described = describe(&context, &unknown);
        assert!(described["columns"][0].get("primaryKey").is_none(), "unknown is left out, not guessed");
        assert!(described["columns"][0].get("nullable").is_none());
    }

    #[test]
    fn table_references_accept_quotes_and_bare_names() {
        let context = sample_context();
        assert_eq!(find_tables(&context.metadata, "\"billing\".\"invoices\"").len(), 1);
        assert_eq!(find_tables(&context.metadata, "INVOICES").len(), 1);
        assert!(find_tables(&context.metadata, "public.invoices").is_empty());
    }

    #[test]
    fn overview_lists_every_table() {
        let result = overview(&sample_context());
        assert_eq!(result["tables"].as_array().unwrap().len(), 4);
        assert_eq!(result["truncated"], json!(false));
    }
}
