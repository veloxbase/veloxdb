use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs::File;
use std::io::{BufWriter, Write};
use std::num::NonZeroU32;
use std::time::Instant;

use chrono::Utc;
use flate2::write::GzEncoder;
use flate2::Compression;
use futures_util::future;
use printpdf::*;
use ring::pbkdf2;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, State};
use base64::{engine::general_purpose::STANDARD, Engine as _};

use crate::credentials;
use crate::db::{self, resolve_connection_engine, AppMetaDb, AppState, MAX_QUERY_ROWS};
use crate::engines::{self, DatabaseEngineOps};
use crate::models::{ChartType, DashboardVariable, QueryResult, WidgetKind, WidgetLayout};

const DEFAULT_CLOUD_URL: &str = "https://veloxdb.dev";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishReportRequest {
    pub dashboard_id: String,
    pub title: String,
    pub description: Option<String>,
    pub slug: Option<String>,
    pub passcode: Option<String>,
    pub expires_in_hours: Option<u32>,
    #[serde(default)]
    pub column_masks: HashMap<String, HashSet<String>>, // widget_id -> set of column names to mask
    #[serde(default)]
    pub variable_values: HashMap<String, String>,
    pub cloud_url: Option<String>,
    #[serde(default)]
    pub live_enabled: bool,
    #[serde(default)]
    pub schedule: Vec<ReportScheduleJob>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishReportResponse {
    pub id: String,
    pub slug: String,
    pub url: String,
    pub title: String,
    pub description: Option<String>,
    pub requires_passcode: bool,
    pub expires_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportWidgetPayload {
    pub id: String,
    pub title: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chart_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub viz: Option<serde_json::Value>,
    #[serde(default)]
    pub columns: Vec<String>,
    #[serde(default)]
    pub rows: Vec<HashMap<String, Option<String>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    pub row_count: usize,
    pub execution_ms: u128,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub x: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub y: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub w: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub h: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportSnapshotPayload {
    pub version: u32,
    pub title: String,
    pub description: Option<String>,
    pub theme: String,
    pub published_at: String,
    pub widgets: Vec<ReportWidgetPayload>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub layout: Vec<WidgetLayout>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub variables: Vec<DashboardVariable>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub variable_values: HashMap<String, String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub pages: Vec<crate::models::DashboardPage>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub story: Option<crate::models::DashboardStory>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub live_enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub live_updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecipeWidgetPayload {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sql: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sql_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connection_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub viz: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub masks: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportRecipePayload {
    pub dashboard_id: String,
    pub widgets: Vec<RecipeWidgetPayload>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub variables: Vec<DashboardVariable>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub layout: Vec<WidgetLayout>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub pages: Vec<crate::models::DashboardPage>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub story: Option<crate::models::DashboardStory>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportScheduleJob {
    pub id: String,
    pub kind: String,
    pub cadence: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub emails: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CloudReportUploadBody<'a> {
    pub title: &'a str,
    pub description: Option<&'a str>,
    pub slug: Option<&'a str>,
    pub password_hash: Option<String>,
    pub expires_in_hours: Option<u32>,
    pub snapshot: &'a ReportSnapshotPayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recipe: Option<&'a ReportRecipePayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dashboard_id: Option<&'a str>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub live_enabled: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub schedule: &'a Vec<ReportScheduleJob>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratePdfRequest {
    pub title: String,
    pub description: Option<String>,
    pub output_path: String,
    pub widgets: Vec<PdfWidgetSummary>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct PdfWidgetSummary {
    pub id: String,
    pub title: String,
    pub kind: String,
    pub columns: Vec<String>,
    pub rows: Vec<HashMap<String, Option<String>>>,
    pub content: Option<String>,
}

/// Replaces `{{name}}` tokens the same way the desktop dashboard substitutes filters.
pub fn substitute_sql_variables(sql: &str, values: &HashMap<String, String>) -> String {
    let mut result = String::with_capacity(sql.len());
    let mut rest = sql;
    while let Some(start) = rest.find("{{") {
        result.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        if let Some(end) = after.find("}}") {
            let name = &after[..end];
            if name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
                if let Some(value) = values.get(name) {
                    result.push_str(value);
                    rest = &after[end + 2..];
                    continue;
                }
            }
            result.push_str("{{");
            result.push_str(name);
            result.push_str("}}");
            rest = &after[end + 2..];
        } else {
            result.push_str("{{");
            result.push_str(after);
            rest = "";
        }
    }
    result.push_str(rest);
    result
}

pub fn hash_widget_sql(sql: &str) -> String {
    hex::encode(Sha256::digest(sql.trim().as_bytes()))
}

fn chart_type_slug(chart_type: ChartType) -> String {
    serde_json::to_value(chart_type)
        .ok()
        .and_then(|value| value.as_str().map(str::to_string))
        .unwrap_or_else(|| format!("{chart_type:?}").to_lowercase())
}

fn resolved_variable_values(
    variables: &[DashboardVariable],
    overrides: &HashMap<String, String>,
) -> HashMap<String, String> {
    let mut values = HashMap::new();
    for variable in variables {
        values.insert(variable.name.clone(), variable.default_value.clone());
    }
    for (name, value) in overrides {
        values.insert(name.clone(), value.clone());
    }
    values
}

/// Native PBKDF2-HMAC-SHA256 passcode hashing (100,000 iterations, 16-byte random salt).
pub fn hash_report_passcode(passcode: &str) -> String {
    let mut salt = [0u8; 16];
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut salt);
    let mut hash = [0u8; 32];
    pbkdf2::derive(
        pbkdf2::PBKDF2_HMAC_SHA256,
        NonZeroU32::new(100_000).unwrap(),
        &salt,
        passcode.as_bytes(),
        &mut hash,
    );
    format!("{}:{}", hex::encode(salt), hex::encode(hash))
}

/// Compresses a byte slice using Gzip compression.
#[allow(dead_code)]
pub fn compress_report_bytes(data: &[u8]) -> Result<Vec<u8>, std::io::Error> {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(data)?;
    encoder.finish()
}

/// In-memory DuckDB downsampling for large time-series/data results (>10k rows)
pub fn downsample_widget_rows_with_duckdb(
    columns: &[String],
    rows: &[HashMap<String, Option<String>>],
    target_count: usize,
) -> Result<Vec<HashMap<String, Option<String>>>, String> {
    if rows.len() <= target_count || rows.is_empty() || columns.len() < 2 {
        return Ok(rows.to_vec());
    }

    let conn = duckdb::Connection::open_in_memory()
        .map_err(|e| format!("Failed to initialize DuckDB memory engine: {}", e))?;

    // Create table for fast columnar processing
    let col_defs: Vec<String> = columns
        .iter()
        .map(|c| format!("\"{}\" VARCHAR", c.replace('"', "\"\"")))
        .collect();
    let create_sql = format!("CREATE TABLE raw_data ({}, _idx INTEGER)", col_defs.join(", "));
    conn.execute(&create_sql, [])
        .map_err(|e| format!("DuckDB table creation failed: {}", e))?;

    let placeholders: Vec<&str> = (0..=columns.len()).map(|_| "?").collect();
    let insert_sql = format!("INSERT INTO raw_data VALUES ({})", placeholders.join(", "));
    let mut insert_stmt = conn
        .prepare(&insert_sql)
        .map_err(|e| format!("DuckDB insert prepare failed: {}", e))?;

    for (idx, row) in rows.iter().enumerate() {
        let mut duck_params: Vec<duckdb::types::Value> = Vec::with_capacity(columns.len() + 1);
        for col in columns {
            let val = row.get(col).and_then(|v| v.clone());
            duck_params.push(match val {
                Some(s) => duckdb::types::Value::Text(s),
                None => duckdb::types::Value::Null,
            });
        }
        duck_params.push(duckdb::types::Value::Int(idx as i32));
        insert_stmt
            .execute(duckdb::params_from_iter(duck_params))
            .map_err(|e| format!("DuckDB row insert failed: {}", e))?;
    }
    drop(insert_stmt);

    // Query downsampled data using NTILE bucket sampling
    let select_cols: Vec<String> = columns
        .iter()
        .map(|c| format!("\"{}\"", c.replace('"', "\"\"")))
        .collect();
    let downsample_sql = format!(
        "WITH ranked AS (
            SELECT {}, _idx, NTILE({}) OVER (ORDER BY _idx) as bucket
            FROM raw_data
        )
        SELECT {} FROM (
            SELECT {}, _idx, ROW_NUMBER() OVER (PARTITION BY bucket ORDER BY _idx) as rn
            FROM ranked
        ) WHERE rn = 1 ORDER BY _idx",
        select_cols.join(", "),
        target_count,
        select_cols.join(", "),
        select_cols.join(", ")
    );

    let mut stmt = conn
        .prepare(&downsample_sql)
        .map_err(|e| format!("DuckDB downsample query failed: {}", e))?;

    let mut downsampled_rows = Vec::new();
    let mut query_rows = stmt
        .query([])
        .map_err(|e| format!("DuckDB execution failed: {}", e))?;

    while let Ok(Some(row)) = query_rows.next() {
        let mut map = HashMap::new();
        for (i, col) in columns.iter().enumerate() {
            let val: Option<String> = row.get(i).ok();
            map.insert(col.clone(), val);
        }
        downsampled_rows.push(map);
    }

    Ok(downsampled_rows)
}

/// Redact specified columns in-place directly in native memory before serialization.
pub fn redact_masked_columns(
    rows: &mut [HashMap<String, Option<String>>],
    masked_columns: &HashSet<String>,
) {
    if masked_columns.is_empty() {
        return;
    }
    for row in rows.iter_mut() {
        for col in masked_columns {
            if row.contains_key(col) {
                row.insert(col.clone(), Some("[REDACTED]".to_string()));
            }
        }
    }
}

/// Compiles and publishes an executive public report to Velox Cloud.
#[tauri::command]
pub async fn compile_and_publish_report(
    app: AppHandle,
    meta: State<'_, AppMetaDb>,
    state: State<'_, AppState>,
    input: PublishReportRequest,
) -> Result<PublishReportResponse, String> {
    // 1. Fetch dashboard
    let dashboard = db::get_dashboard(meta.pool(), &input.dashboard_id)
        .await
        .map_err(|e| format!("Failed to read dashboard: {}", e))?
        .ok_or_else(|| "Dashboard not found".to_string())?;

    // 2. Authenticate against cloud (falls back to guest-desktop for instant zero-config sharing)
    let cloud_api_key = match credentials::get_cloud_api_key() {
        Ok(Some(k)) if !k.trim().is_empty() => k,
        _ => "guest-desktop".to_string(),
    };

    let variable_values = resolved_variable_values(&dashboard.variables, &input.variable_values);

    // 3. Parallel query execution across widgets
    let mut widget_tasks = Vec::new();

    for (widget_id, widget) in &dashboard.widgets {
        if widget.kind == WidgetKind::Text || widget.kind == WidgetKind::Markdown {
            // Text widgets don't have queries
            continue;
        }

        if let Some(query) = &widget.query {
            let app_clone = app.clone();
            let state_ref = state.inner();
            let widget_id_clone = widget_id.clone();
            let widget_title_clone = widget.title.clone();
            let widget_kind_str = format!("{:?}", widget.kind).to_lowercase();
            let conn_id = query.connection_id.clone();
            let sql = substitute_sql_variables(&query.sql, &variable_values);
            let viz_val = widget.viz.as_ref().and_then(|v| serde_json::to_value(v).ok());
            let chart_type = widget.viz.as_ref().map(|v| chart_type_slug(v.chart_type));

            widget_tasks.push(async move {
                let start = Instant::now();
                let exec_result: Result<QueryResult, String> = async {
                    let (resolved_conn, engine) =
                        resolve_connection_engine(&app_clone, state_ref, Some(conn_id)).await?;
                    let ops = engines::get_engine(engine);
                    ops.run_query(&app_clone, state_ref, &resolved_conn, &sql, MAX_QUERY_ROWS)
                        .await
                        .map_err(String::from)
                }
                .await;

                (
                    widget_id_clone,
                    widget_title_clone,
                    widget_kind_str,
                    chart_type,
                    viz_val,
                    exec_result,
                    start.elapsed().as_millis(),
                )
            });
        }
    }

    // Run all widget queries concurrently
    let query_outputs = future::join_all(widget_tasks).await;

    // 4. Transform and redact outputs
    let mut compiled_widgets = Vec::new();

    // Include text/markdown widgets
    for (widget_id, widget) in &dashboard.widgets {
        if widget.kind == WidgetKind::Text || widget.kind == WidgetKind::Markdown {
            let layout_slot = dashboard.layout.iter().find(|l| l.i == *widget_id);
            let content = widget
                .viz
                .as_ref()
                .and_then(|v| v.options.get("content"))
                .and_then(|c| c.as_str())
                .unwrap_or("")
                .to_string();
            let cell_content = dashboard
                .cells
                .iter()
                .find(|c| c.get("id").and_then(|id| id.as_str()) == Some(widget_id.as_str()))
                .and_then(|c| c.get("content").and_then(|ct| ct.as_str()))
                .unwrap_or("");
            let final_content = if !content.is_empty() {
                content
            } else {
                cell_content.to_string()
            };

            compiled_widgets.push(ReportWidgetPayload {
                id: widget_id.clone(),
                title: widget.title.clone(),
                kind: format!("{:?}", widget.kind).to_lowercase(),
                chart_type: None,
                viz: widget.viz.as_ref().and_then(|v| serde_json::to_value(v).ok()),
                columns: Vec::new(),
                rows: Vec::new(),
                content: Some(final_content),
                row_count: 0,
                execution_ms: 0,
                x: layout_slot.map(|l| l.x),
                y: layout_slot.map(|l| l.y),
                w: layout_slot.map(|l| l.w),
                h: layout_slot.map(|l| l.h),
            });
        }
    }

    for (widget_id, title, kind, chart_type, viz, exec_result, elapsed_ms) in query_outputs {
        let (columns, mut rows): (Vec<String>, Vec<HashMap<String, Option<String>>>) = match exec_result {
            Ok(qr) => {
                let cols = qr.columns;
                let rows_converted: Vec<HashMap<String, Option<String>>> = qr
                    .rows
                    .into_iter()
                    .map(|btree: BTreeMap<String, Option<String>>| btree.into_iter().collect())
                    .collect();
                (cols, rows_converted)
            }
            Err(_) => (Vec::new(), Vec::new()),
        };

        // Downsample if rows > 10,000 for extreme efficiency
        if rows.len() > 10_000 {
            if let Ok(downsampled) = downsample_widget_rows_with_duckdb(&columns, &rows, 2_000) {
                rows = downsampled;
            }
        }

        // Apply column masking in-memory
        if let Some(masked) = input.column_masks.get(&widget_id) {
            redact_masked_columns(&mut rows, masked);
        }

        let row_count = rows.len();
        let layout_slot = dashboard.layout.iter().find(|l| l.i == widget_id);
        let resolved_kind = if kind == "chart" && chart_type.as_deref() == Some("kpi") {
            "kpi".to_string()
        } else {
            kind
        };

        compiled_widgets.push(ReportWidgetPayload {
            id: widget_id,
            title,
            kind: resolved_kind,
            chart_type,
            viz,
            columns,
            rows,
            content: None,
            row_count,
            execution_ms: elapsed_ms,
            x: layout_slot.map(|l| l.x),
            y: layout_slot.map(|l| l.y),
            w: layout_slot.map(|l| l.w),
            h: layout_slot.map(|l| l.h),
        });
    }

    // Sort widgets by layout y, then x so they render in natural reading order
    compiled_widgets.sort_by_key(|w| {
        dashboard
            .layout
            .iter()
            .find(|l| l.i == w.id)
            .map(|l| (l.y, l.x))
            .unwrap_or((999, 999))
    });

    // 5. Hash passcode if provided
    let password_hash = input
        .passcode
        .as_deref()
        .filter(|p| !p.trim().is_empty())
        .map(hash_report_passcode);

    // 6. Build snapshot payload
    let snapshot = ReportSnapshotPayload {
        version: 3,
        title: input.title.clone(),
        description: input.description.clone(),
        theme: format!("{:?}", dashboard.theme).to_lowercase(),
        published_at: Utc::now().to_rfc3339(),
        widgets: compiled_widgets,
        layout: dashboard.layout.clone(),
        variables: dashboard.variables.clone(),
        variable_values,
        pages: dashboard.pages.clone(),
        story: dashboard.story.clone(),
        live_enabled: input.live_enabled,
        live_updated_at: input.live_enabled.then(|| Utc::now().to_rfc3339()),
    };

    let recipe = ReportRecipePayload {
        dashboard_id: dashboard.id.clone(),
        widgets: dashboard
            .widgets
            .iter()
            .map(|(id, widget)| RecipeWidgetPayload {
                id: id.clone(),
                sql: widget.query.as_ref().map(|q| q.sql.clone()),
                sql_hash: widget.query.as_ref().map(|q| hash_widget_sql(&q.sql)),
                connection_id: widget.query.as_ref().map(|q| q.connection_id.clone()),
                kind: Some(format!("{:?}", widget.kind).to_lowercase()),
                viz: widget.viz.as_ref().and_then(|v| serde_json::to_value(v).ok()),
                masks: input
                    .column_masks
                    .get(id)
                    .map(|set| set.iter().cloned().collect())
                    .unwrap_or_default(),
            })
            .collect(),
        variables: dashboard.variables.clone(),
        layout: dashboard.layout.clone(),
        pages: dashboard.pages.clone(),
        story: dashboard.story.clone(),
    };

    let upload_body = CloudReportUploadBody {
        title: &input.title,
        description: input.description.as_deref(),
        slug: input.slug.as_deref().filter(|s| !s.trim().is_empty()),
        password_hash,
        expires_in_hours: input.expires_in_hours,
        snapshot: &snapshot,
        recipe: if input.live_enabled { Some(&recipe) } else { None },
        dashboard_id: Some(dashboard.id.as_str()),
        live_enabled: input.live_enabled,
        schedule: &input.schedule,
    };

    // 7. Direct native HTTP upload via reqwest
    let cloud_base = input
        .cloud_url
        .as_deref()
        .unwrap_or(DEFAULT_CLOUD_URL)
        .trim_end_matches('/');
    let target_url = format!("{}/api/v1/reports", cloud_base);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(45))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let res = client
        .post(&target_url)
        .header("Authorization", format!("Bearer {}", cloud_api_key))
        .header("Content-Type", "application/json")
        .json(&upload_body)
        .send()
        .await
        .map_err(|e| format!("Network error publishing report: {}", e))?;

    if !res.status().is_success() {
        let status = res.status();
        let error_body = res.text().await.unwrap_or_default();
        return Err(format!("Cloud publish failed ({status}): {error_body}"));
    }

    let response: PublishReportResponse = res
        .json()
        .await
        .map_err(|e| format!("Failed to parse publish response: {}", e))?;

    Ok(response)
}

/// Revoke a published report from Velox Cloud.
#[tauri::command]
pub async fn revoke_published_report(
    slug: String,
    cloud_url: Option<String>,
) -> Result<(), String> {
    let cloud_api_key = match credentials::get_cloud_api_key() {
        Ok(Some(k)) if !k.trim().is_empty() => k,
        _ => "guest-desktop".to_string(),
    };

    let cloud_base = cloud_url
        .as_deref()
        .unwrap_or(DEFAULT_CLOUD_URL)
        .trim_end_matches('/');
    let target_url = format!("{}/api/v1/reports/{}", cloud_base, slug);

    let client = reqwest::Client::new();
    let res = client
        .delete(&target_url)
        .header("Authorization", format!("Bearer {}", cloud_api_key))
        .send()
        .await
        .map_err(|e| format!("Failed to reach Velox Cloud: {}", e))?;

    if !res.status().is_success() {
        let status = res.status();
        let error_text = res.text().await.unwrap_or_default();
        return Err(format!("Failed to revoke report ({status}): {error_text}"));
    }

    Ok(())
}

fn build_pdf_document(input: &GeneratePdfRequest) -> Result<Vec<u8>, String> {
    let (doc, page1, layer1) = PdfDocument::new(&input.title, Mm(210.0), Mm(297.0), "Main");
    let font_bold = doc
        .add_builtin_font(BuiltinFont::HelveticaBold)
        .map_err(|e| format!("Font load error: {:?}", e))?;
    let font_regular = doc
        .add_builtin_font(BuiltinFont::Helvetica)
        .map_err(|e| format!("Font load error: {:?}", e))?;
    let font_mono = doc
        .add_builtin_font(BuiltinFont::Courier)
        .map_err(|e| format!("Font load error: {:?}", e))?;
    let current_layer = doc.get_page(page1).get_layer(layer1);
    let y_start = 270.0;
    current_layer.use_text("VELOXDB EXECUTIVE REPORT", 9.0, Mm(20.0), Mm(y_start + 10.0), &font_bold);
    current_layer.use_text(&input.title, 18.0, Mm(20.0), Mm(y_start), &font_bold);
    let mut current_y = y_start - 8.0;
    if let Some(desc) = &input.description {
        current_layer.use_text(desc, 10.0, Mm(20.0), Mm(current_y), &font_regular);
        current_y -= 8.0;
    }
    let date_str = format!("Generated on {} UTC", Utc::now().format("%Y-%m-%d %H:%M"));
    current_layer.use_text(&date_str, 8.0, Mm(20.0), Mm(current_y), &font_regular);
    current_y -= 15.0;
    for widget in &input.widgets {
        if current_y < 40.0 {
            break;
        }
        current_layer.use_text(&widget.title, 12.0, Mm(20.0), Mm(current_y), &font_bold);
        current_y -= 5.0;
        let subtitle = format!(
            "Type: {} • Columns: {} • Rows: {}",
            widget.kind,
            widget.columns.len(),
            widget.rows.len()
        );
        current_layer.use_text(&subtitle, 8.0, Mm(20.0), Mm(current_y), &font_regular);
        current_y -= 6.0;
        for row in widget.rows.iter().take(3) {
            if current_y < 35.0 {
                break;
            }
            let row_summary: Vec<String> = widget
                .columns
                .iter()
                .take(4)
                .map(|col| {
                    let val = row.get(col).and_then(|v| v.as_deref()).unwrap_or("—");
                    format!("{}: {}", col, val)
                })
                .collect();
            current_layer.use_text(&row_summary.join("  |  "), 7.5, Mm(24.0), Mm(current_y), &font_mono);
            current_y -= 4.5;
        }
        current_y -= 6.0;
    }
    let mut bytes = Vec::new();
    doc.save(&mut BufWriter::new(&mut bytes))
        .map_err(|e| format!("Failed to write PDF: {:?}", e))?;
    Ok(bytes)
}

/// Compiles a native vectorized executive PDF report to disk using printpdf.
#[tauri::command]
pub async fn generate_report_pdf(input: GeneratePdfRequest) -> Result<String, String> {
    let bytes = build_pdf_document(&input)?;
    let file = File::create(&input.output_path)
        .map_err(|e| format!("Failed to create PDF file: {}", e))?;
    let mut writer = BufWriter::new(file);
    writer
        .write_all(&bytes)
        .map_err(|e| format!("Failed to write PDF: {}", e))?;
    Ok(input.output_path)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunWidgetsRequest {
    pub dashboard_id: String,
    #[serde(default)]
    pub widget_ids: Vec<String>,
    #[serde(default)]
    pub variable_values: HashMap<String, String>,
    #[serde(default)]
    pub sql_hashes: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentWidgetResult {
    pub id: String,
    pub columns: Vec<String>,
    pub rows: Vec<HashMap<String, Option<String>>>,
    pub execution_ms: u128,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[tauri::command]
pub async fn agent_run_widgets(
    app: AppHandle,
    meta: State<'_, AppMetaDb>,
    state: State<'_, AppState>,
    input: AgentRunWidgetsRequest,
) -> Result<Vec<AgentWidgetResult>, String> {
    let dashboard = db::get_dashboard(meta.pool(), &input.dashboard_id)
        .await
        .map_err(|e| format!("Failed to read dashboard: {}", e))?
        .ok_or_else(|| "Dashboard not found".to_string())?;
    let variable_values = resolved_variable_values(&dashboard.variables, &input.variable_values);
    let mut results = Vec::new();
    let wanted: HashSet<String> = if input.widget_ids.is_empty() {
        dashboard.widgets.keys().cloned().collect()
    } else {
        input.widget_ids.iter().cloned().collect()
    };

    for (widget_id, widget) in &dashboard.widgets {
        if !wanted.contains(widget_id) {
            continue;
        }
        let Some(query) = &widget.query else {
            continue;
        };
        if let Some(expected) = input.sql_hashes.get(widget_id) {
            let actual = hash_widget_sql(&query.sql);
            if actual != *expected {
                results.push(AgentWidgetResult {
                    id: widget_id.clone(),
                    columns: Vec::new(),
                    rows: Vec::new(),
                    execution_ms: 0,
                    error: Some("Widget SQL changed since publish. Republish to enable live query.".into()),
                });
                continue;
            }
        }
        let sql = substitute_sql_variables(&query.sql, &variable_values);
        let start = Instant::now();
        let exec_result = async {
            let (resolved_conn, engine) =
                resolve_connection_engine(&app, state.inner(), Some(query.connection_id.clone())).await?;
            let ops = engines::get_engine(engine);
            ops.run_query(&app, state.inner(), &resolved_conn, &sql, MAX_QUERY_ROWS)
                .await
                .map_err(String::from)
        }
        .await;
        match exec_result {
            Ok(qr) => {
                let mut rows: Vec<HashMap<String, Option<String>>> = qr
                    .rows
                    .into_iter()
                    .map(|btree: BTreeMap<String, Option<String>>| btree.into_iter().collect())
                    .collect();
                if rows.len() > 10_000 {
                    if let Ok(downsampled) = downsample_widget_rows_with_duckdb(&qr.columns, &rows, 2_000) {
                        rows = downsampled;
                    }
                }
                results.push(AgentWidgetResult {
                    id: widget_id.clone(),
                    columns: qr.columns,
                    rows,
                    execution_ms: start.elapsed().as_millis(),
                    error: None,
                });
            }
            Err(error) => results.push(AgentWidgetResult {
                id: widget_id.clone(),
                columns: Vec::new(),
                rows: Vec::new(),
                execution_ms: start.elapsed().as_millis(),
                error: Some(error),
            }),
        }
    }
    Ok(results)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentEvalAlertsRequest {
    pub dashboard_id: String,
    #[serde(default)]
    pub variable_values: HashMap<String, String>,
    #[serde(default)]
    pub sql_hashes: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentAlertHit {
    pub widget_id: String,
    pub title: String,
    pub value: f64,
    pub threshold: f64,
    pub emails: Vec<String>,
    pub message: String,
}

fn first_numeric(rows: &[HashMap<String, Option<String>>]) -> Option<f64> {
    let row = rows.first()?;
    for value in row.values() {
        if let Some(raw) = value {
            if let Ok(parsed) = raw.parse::<f64>() {
                return Some(parsed);
            }
        }
    }
    None
}

fn compare_alert(op: &str, value: f64, threshold: f64) -> bool {
    match op {
        "lt" => value < threshold,
        "lte" => value <= threshold,
        "gte" => value >= threshold,
        _ => value > threshold,
    }
}

#[tauri::command]
pub async fn agent_eval_alerts(
    app: AppHandle,
    meta: State<'_, AppMetaDb>,
    state: State<'_, AppState>,
    input: AgentEvalAlertsRequest,
) -> Result<Vec<AgentAlertHit>, String> {
    let dashboard = db::get_dashboard(meta.pool(), &input.dashboard_id)
        .await
        .map_err(|e| format!("Failed to read dashboard: {}", e))?
        .ok_or_else(|| "Dashboard not found".to_string())?;
    let widgets = agent_run_widgets(
        app,
        meta,
        state,
        AgentRunWidgetsRequest {
            dashboard_id: input.dashboard_id.clone(),
            widget_ids: Vec::new(),
            variable_values: input.variable_values,
            sql_hashes: input.sql_hashes,
        },
    )
    .await?;

    let mut hits = Vec::new();
    for result in widgets {
        let Some(widget) = dashboard.widgets.get(&result.id) else { continue };
        let Some(viz) = widget.viz.as_ref() else { continue };
        let alert = viz.options.get("kpiAlert");
        let enabled = alert.and_then(|v| v.get("enabled")).and_then(|v| v.as_bool()).unwrap_or(false);
        if !enabled {
            continue;
        }
        let threshold = alert.and_then(|v| v.get("threshold")).and_then(|v| v.as_f64()).unwrap_or(0.0);
        let op = alert.and_then(|v| v.get("op")).and_then(|v| v.as_str()).unwrap_or("gt");
        let emails: Vec<String> = alert
            .and_then(|v| v.get("emails"))
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
            .unwrap_or_default();
        let Some(value) = first_numeric(&result.rows) else { continue };
        if compare_alert(op, value, threshold) {
            hits.push(AgentAlertHit {
                widget_id: result.id.clone(),
                title: widget.title.clone(),
                value,
                threshold,
                emails,
                message: format!("{} is {} (threshold {} {})", widget.title, value, op, threshold),
            });
        }
    }
    Ok(hits)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRenderPdfRequest {
    pub dashboard_id: String,
    pub title: String,
    pub description: Option<String>,
    #[serde(default)]
    pub variable_values: HashMap<String, String>,
    #[serde(default)]
    pub sql_hashes: HashMap<String, String>,
}

#[tauri::command]
pub async fn agent_render_pdf(
    app: AppHandle,
    meta: State<'_, AppMetaDb>,
    state: State<'_, AppState>,
    input: AgentRenderPdfRequest,
) -> Result<String, String> {
    let widgets = agent_run_widgets(
        app,
        meta,
        state,
        AgentRunWidgetsRequest {
            dashboard_id: input.dashboard_id,
            widget_ids: Vec::new(),
            variable_values: input.variable_values,
            sql_hashes: input.sql_hashes,
        },
    )
    .await?;
    let summaries: Vec<PdfWidgetSummary> = widgets
        .into_iter()
        .map(|widget| PdfWidgetSummary {
            id: widget.id,
            title: String::new(),
            kind: "chart".into(),
            columns: widget.columns,
            rows: widget.rows,
            content: None,
        })
        .collect();
    let bytes = build_pdf_document(&GeneratePdfRequest {
        title: input.title,
        description: input.description,
        output_path: String::new(),
        widgets: summaries,
    })?;
    Ok(STANDARD.encode(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hash_report_passcode() {
        let hash1 = hash_report_passcode("secret123");
        let hash2 = hash_report_passcode("secret123");
        assert_ne!(hash1, hash2);
        assert!(hash1.contains(':'));
        let parts: Vec<&str> = hash1.split(':').collect();
        assert_eq!(parts.len(), 2);
        assert_eq!(parts[0].len(), 32); // 16 bytes hex
        assert_eq!(parts[1].len(), 64); // 32 bytes hex
    }

    #[test]
    fn test_compress_report_bytes() {
        let original = b"{\"title\":\"Test Report\",\"data\":[1,2,3,4,5]}";
        let compressed = compress_report_bytes(original).unwrap();
        assert!(!compressed.is_empty());
    }

    #[test]
    fn test_redact_masked_columns() {
        let mut rows = vec![
            HashMap::from([
                ("id".to_string(), Some("1".to_string())),
                ("email".to_string(), Some("alice@secret.com".to_string())),
            ]),
            HashMap::from([
                ("id".to_string(), Some("2".to_string())),
                ("email".to_string(), Some("bob@secret.com".to_string())),
            ]),
        ];

        let masked = HashSet::from(["email".to_string()]);
        redact_masked_columns(&mut rows, &masked);

        assert_eq!(rows[0].get("email").unwrap().as_deref(), Some("[REDACTED]"));
        assert_eq!(rows[1].get("email").unwrap().as_deref(), Some("[REDACTED]"));
        assert_eq!(rows[0].get("id").unwrap().as_deref(), Some("1"));
    }

    #[test]
    fn test_duckdb_downsampling() {
        let cols = vec!["x".to_string(), "y".to_string()];
        let mut rows = Vec::new();
        for i in 0..12_000 {
            rows.push(HashMap::from([
                ("x".to_string(), Some(i.to_string())),
                ("y".to_string(), Some((i * 2).to_string())),
            ]));
        }

        let downsampled = downsample_widget_rows_with_duckdb(&cols, &rows, 1_000).unwrap();
        assert_eq!(downsampled.len(), 1_000);
        assert_eq!(downsampled[0].get("x").unwrap().as_deref(), Some("0"));
    }

    #[test]
    fn substitutes_known_placeholders_and_keeps_unknown_ones() {
        let values = HashMap::from([
            ("date_from".to_string(), "2024-01-01".to_string()),
            ("region".to_string(), String::new()),
        ]);
        let sql = "SELECT * FROM sales WHERE d >= '{{date_from}}' AND ('{{region}}' = '' OR region = '{{region}}') AND x = '{{mystery}}'";
        assert_eq!(
            substitute_sql_variables(sql, &values),
            "SELECT * FROM sales WHERE d >= '2024-01-01' AND ('' = '' OR region = '') AND x = '{{mystery}}'"
        );
    }

    #[test]
    fn chart_type_slug_keeps_camel_case() {
        assert_eq!(chart_type_slug(ChartType::HorizontalBar), "horizontalBar");
        assert_eq!(chart_type_slug(ChartType::Combo), "combo");
        assert_eq!(chart_type_slug(ChartType::Waterfall), "waterfall");
    }

    #[test]
    fn snapshot_v2_serializes_select_variables_and_combo() {
        let snapshot = ReportSnapshotPayload {
            version: 2,
            title: "Generated".to_string(),
            description: None,
            theme: "inherit".to_string(),
            published_at: "2026-01-01T00:00:00Z".to_string(),
            widgets: vec![ReportWidgetPayload {
                id: "w1".to_string(),
                title: "Revenue vs orders".to_string(),
                kind: "chart".to_string(),
                chart_type: Some("combo".to_string()),
                viz: Some(serde_json::json!({ "chartType": "combo" })),
                columns: vec!["month".to_string()],
                rows: Vec::new(),
                content: None,
                row_count: 0,
                execution_ms: 0,
                x: Some(0),
                y: Some(0),
                w: Some(6),
                h: Some(4),
            }],
            layout: Vec::new(),
            variables: vec![DashboardVariable {
                name: "region".to_string(),
                variable_type: crate::models::DashboardVariableType::Select,
                default_value: String::new(),
                options: Some(vec!["EU".to_string(), "US".to_string()]),
                label: Some("Region".to_string()),
            }],
            variable_values: HashMap::from([("region".to_string(), "EU".to_string())]),
            pages: Vec::new(),
            story: None,
            live_enabled: false,
            live_updated_at: None,
        };

        let json = serde_json::to_value(&snapshot).expect("serialize");
        assert_eq!(json["version"], 2);
        assert_eq!(json["widgets"][0]["chartType"], "combo");
        assert_eq!(json["variables"][0]["type"], "select");
        assert_eq!(json["variableValues"]["region"], "EU");
    }

    #[test]
    fn hashes_trimmed_sql_consistently() {
        assert_eq!(hash_widget_sql("SELECT 1"), hash_widget_sql("  SELECT 1\n"));
        assert_ne!(hash_widget_sql("SELECT 1"), hash_widget_sql("SELECT 2"));
    }
}
