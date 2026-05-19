/// Split a SQL script into individual statements, respecting quotes and comments.
pub fn split_sql_statements(sql: &str) -> Vec<String> {
    let ranges = statement_ranges(sql);
    ranges
        .into_iter()
        .map(|(start, end)| sql[start..end].trim().to_string())
        .filter(|segment| !segment.is_empty())
        .collect()
}

fn statement_ranges(sql: &str) -> Vec<(usize, usize)> {
    let mut ranges = Vec::new();
    let mut start = 0usize;
    let mut i = 0usize;
    let mut in_single = false;
    let mut in_double = false;
    let mut in_line_comment = false;
    let mut block_depth = 0u32;
    let mut dollar_tag: Option<String> = None;
    let bytes = sql.as_bytes();

    while i < bytes.len() {
        let current = bytes[i] as char;
        let next = bytes.get(i + 1).map(|b| *b as char);

        if in_line_comment {
            if current == '\n' {
                in_line_comment = false;
            }
            i += 1;
            continue;
        }
        if block_depth > 0 {
            if current == '/' && next == Some('*') {
                block_depth += 1;
                i += 2;
                continue;
            }
            if current == '*' && next == Some('/') {
                block_depth -= 1;
                i += 2;
                continue;
            }
            i += 1;
            continue;
        }
        if let Some(ref tag) = dollar_tag {
            if sql[i..].starts_with(tag) {
                i += tag.len();
                dollar_tag = None;
                continue;
            }
            i += 1;
            continue;
        }
        if in_single {
            if current == '\'' && next == Some('\'') {
                i += 2;
                continue;
            }
            if current == '\'' {
                in_single = false;
            }
            i += 1;
            continue;
        }
        if in_double {
            if current == '"' && next == Some('"') {
                i += 2;
                continue;
            }
            if current == '"' {
                in_double = false;
            }
            i += 1;
            continue;
        }

        if current == '-' && next == Some('-') {
            in_line_comment = true;
            i += 2;
            continue;
        }
        if current == '/' && next == Some('*') {
            block_depth = 1;
            i += 2;
            continue;
        }
        if current == '\'' {
            in_single = true;
            i += 1;
            continue;
        }
        if current == '"' {
            in_double = true;
            i += 1;
            continue;
        }
        if current == '$' {
            if let Some(tag) = parse_dollar_tag(sql, i) {
                dollar_tag = Some(tag.tag);
                i = tag.end;
                continue;
            }
        }
        if current == ';' {
            ranges.push((start, i));
            start = i + 1;
            i += 1;
            continue;
        }
        i += 1;
    }

    ranges.push((start, sql.len()));
    ranges
}

struct DollarTag {
    tag: String,
    end: usize,
}

fn parse_dollar_tag(sql: &str, start_index: usize) -> Option<DollarTag> {
    if sql.as_bytes().get(start_index)? != &b'$' {
        return None;
    }
    let mut cursor = start_index + 1;
    while cursor < sql.len() {
        let ch = sql.as_bytes()[cursor] as char;
        if ch == '$' {
            let tag = sql[start_index..=cursor].to_string();
            return Some(DollarTag {
                tag,
                end: cursor + 1,
            });
        }
        if !ch.is_ascii_alphanumeric() && ch != '_' {
            return None;
        }
        cursor += 1;
    }
    None
}

#[cfg(test)]
mod tests {
    #[test]
    fn splits_simple_statements() {
        let parts = super::split_sql_statements("select 1; select 2;");
        assert_eq!(parts, vec!["select 1", "select 2"]);
    }

    #[test]
    fn ignores_semicolons_in_strings() {
        let parts = super::split_sql_statements("select 'a;b'; select 2;");
        assert_eq!(parts, vec!["select 'a;b'", "select 2"]);
    }

    #[test]
    fn keeps_trailing_line_comment_with_next_statement() {
        let parts = super::split_sql_statements("select 1; -- comment;\nselect 2;");
        assert_eq!(parts, vec!["select 1", "-- comment;\nselect 2"]);
    }
}
