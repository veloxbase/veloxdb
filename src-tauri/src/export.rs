use std::collections::HashMap;
use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};
use sqlx::{Column, Row};
use sqlx::mysql::MySqlRow;
use sqlx::sqlite::SqliteRow;
use tokio_postgres::SimpleQueryMessage;

use crate::db::{
    get_or_create_mysql_pool, get_or_create_sqlite_pool, resolve_connection_engine,
    with_pool_client_retry, AppState,
};
use crate::models::DatabaseEngine;
use crate::pg_error::map_pg_err;

const TABLE_W: f64 = 240.0;
const HEADER_H: f64 = 30.0;
const COL_H: f64 = 19.0;
const RADIUS: f64 = 6.0;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportTableNode {
    pub key: String,
    pub name: String,
    pub schema: String,
    pub x: f64,
    pub y: f64,
    pub columns: Vec<ExportColumn>,
    pub columns_total: usize,
    pub header_color: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportColumn {
    pub name: String,
    pub data_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportEdge {
    pub from_key: String,
    pub to_key: String,
    pub from_column: Option<String>,
    pub to_column: Option<String>,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportViewport {
    pub x: f64,
    pub y: f64,
    pub zoom: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagramExportRequest {
    pub nodes: Vec<ExportTableNode>,
    pub edges: Vec<ExportEdge>,
    pub viewport: ExportViewport,
    pub theme: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportQueryRequest {
    pub connection_id: Option<String>,
    pub sql: String,
    pub output_path: String,
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn node_height(cols: usize) -> f64 {
    HEADER_H + (cols.max(1) as f64 * COL_H)
}

fn build_svg(input: &DiagramExportRequest) -> String {
    let dark = input.theme.as_deref() != Some("light");
    let bg = if dark { "#1e1e28" } else { "#f5f5fa" };
    let card_bg = if dark { "#28283a" } else { "#ffffff" };
    let border = if dark { "#505065" } else { "#d0d0d8" };
    let text = if dark { "#dcdce6" } else { "#1e1e2e" };
    let muted = if dark { "#8c8ca0" } else { "#6c6c78" };
    let header_text = "#ffffff";
    let edge_color = if dark { "#7878c8" } else { "#8888cc" };
    let grid_color = if dark { "rgba(55,55,65,0.3)" } else { "rgba(200,200,210,0.3)" };

    let node_map: HashMap<String, &ExportTableNode> =
        input.nodes.iter().map(|n| (n.key.clone(), n)).collect();

    let mut min_x = f64::MAX;
    let mut min_y = f64::MAX;
    let mut max_x = f64::MIN;
    let mut max_y = f64::MIN;

    for node in &input.nodes {
        let h = node_height(node.columns.len());
        min_x = min_x.min(node.x * input.viewport.zoom);
        min_y = min_y.min(node.y * input.viewport.zoom);
        max_x = max_x.max((node.x + TABLE_W) * input.viewport.zoom);
        max_y = max_y.max((node.y + h) * input.viewport.zoom);
    }

    if min_x == f64::MAX {
        min_x = 0.0;
        min_y = 0.0;
        max_x = TABLE_W;
        max_y = HEADER_H;
    }

    let scale = 2.0;
    let padding = 80.0;
    let w = ((max_x - min_x) * scale + padding * 2.0).max(200.0);
    let h = ((max_y - min_y) * scale + padding * 2.0).max(200.0);

    let tx = |x: f64| -> f64 { (x * input.viewport.zoom - min_x) * scale + padding };
    let ty = |y: f64| -> f64 { (y * input.viewport.zoom - min_y) * scale + padding };
    let zoom = input.viewport.zoom * scale;

    let mut svg = String::new();
    svg.push_str("<svg xmlns=\"http://www.w3.org/2000/svg\" ");
    svg.push_str(&format!("width=\"{w}\" height=\"{h}\" viewBox=\"0 0 {w} {h}\">"));
    svg.push_str(&format!("<rect width=\"100%\" height=\"100%\" fill=\"{bg}\"/>"));

    let grid_step = 40.0 * zoom;
    if grid_step > 4.0 {
        svg.push_str(&format!("<g stroke=\"{grid_color}\" stroke-width=\"0.5\">"));
        let start_x = -(padding % grid_step);
        let start_y = -(padding % grid_step);
        let mut gx = start_x;
        while gx <= w {
            svg.push_str(&format!("<line x1=\"{gx}\" y1=\"0\" x2=\"{gx}\" y2=\"{h}\"/>"));
            gx += grid_step;
        }
        let mut gy = start_y;
        while gy <= h {
            svg.push_str(&format!("<line x1=\"0\" y1=\"{gy}\" x2=\"{w}\" y2=\"{gy}\"/>"));
            gy += grid_step;
        }
        svg.push_str("</g>");
    }

    for edge in &input.edges {
        let from = node_map.get(&edge.from_key);
        let to = node_map.get(&edge.to_key);
        if let (Some(from), Some(to)) = (from, to) {
            let from_h = node_height(from.columns.len());
            let to_h = node_height(to.columns.len());
            let sx = tx(from.x + TABLE_W);
            let sy = ty(from.y + from_h / 2.0);
            let ex = tx(to.x);
            let ey = ty(to.y + to_h / 2.0);
            let cx = (sx + ex) / 2.0;

            let dash = if edge.kind == "pending" { " stroke-dasharray=\"6,4\"" } else { "" };
            let opacity = if edge.kind == "pending" { "0.5" } else { "1.0" };

            svg.push_str(&format!(
                "<path d=\"M{sx},{sy} C{cx},{sy} {cx},{ey} {ex},{ey}\" stroke=\"{edge_color}\" stroke-width=\"1.5\" fill=\"none\" opacity=\"{opacity}\"{dash}/>"
            ));

            let arrow = 6.0;
            svg.push_str(&format!(
                "<polygon points=\"{},{}, {},{} {},{}\" fill=\"{edge_color}\" opacity=\"{opacity}\"/>",
                ex, ey,
                ex - arrow, ey - arrow / 2.0,
                ex - arrow, ey + arrow / 2.0,
            ));
        }
    }

    for node in &input.nodes {
        let x = tx(node.x);
        let y = ty(node.y);
        let ht = node_height(node.columns.len());
        let hdr = node.header_color.as_deref().unwrap_or(if dark { "#4848dc" } else { "#6366f1" });

        svg.push_str(&format!(
            "<rect x=\"{x}\" y=\"{y}\" width=\"{TABLE_W}\" height=\"{ht}\" rx=\"{RADIUS}\" fill=\"{card_bg}\" stroke=\"{border}\" stroke-width=\"1.5\"/>"
        ));

        svg.push_str(&format!(
            "<path d=\"M{} {} L{} {} A{RADIUS} {RADIUS} 0 0 1 {} {} L{} {} L{} {} L{} {} A{RADIUS} {RADIUS} 0 0 1 {} {} Z\" fill=\"{hdr}\"/>",
            x + RADIUS, y,
            x + TABLE_W - RADIUS, y,
            x + TABLE_W, y + RADIUS,
            x + TABLE_W, y + HEADER_H,
            x, y + HEADER_H,
            x, y + RADIUS,
            x + RADIUS, y,
        ));

        let label = format!("{} ({})", esc(&node.name), esc(&node.schema));
        svg.push_str(&format!(
            "<text x=\"{}\" y=\"{}\" font-family=\"sans-serif\" font-size=\"11\" font-weight=\"bold\" fill=\"{header_text}\">{label}</text>",
            x + 8.0, y + 20.0,
        ));

        for (i, col) in node.columns.iter().enumerate() {
            let cy = y + HEADER_H + (i as f64 * COL_H);
            let col_color = if i % 2 == 0 { text } else { muted };
            svg.push_str(&format!(
                "<text x=\"{}\" y=\"{}\" font-family=\"sans-serif\" font-size=\"9\" fill=\"{col_color}\">{} <tspan fill=\"{muted}\">{}</tspan></text>",
                x + 8.0, cy + 13.0,
                esc(&col.name), esc(&col.data_type),
            ));
        }

        if node.columns_total > node.columns.len() {
            let cy = y + HEADER_H + (node.columns.len().max(1) as f64 * COL_H);
            let remaining = node.columns_total - node.columns.len();
            svg.push_str(&format!(
                "<text x=\"{}\" y=\"{}\" font-family=\"sans-serif\" font-size=\"9\" fill=\"{muted}\">+{remaining} more columns</text>",
                x + 8.0, cy + 13.0,
            ));
        }
    }

    svg.push_str("</svg>");
    svg
}

pub fn export_diagram_to_png(
    input: &DiagramExportRequest,
    output_path: &Path,
) -> Result<(), String> {
    let svg_str = build_svg(input);

    let fontdb = {
        let mut db = resvg::usvg::fontdb::Database::new();
        db.load_system_fonts();
        db
    };

    let opts = resvg::usvg::Options {
        fontdb: std::sync::Arc::new(fontdb),
        ..Default::default()
    };

    let tree = resvg::usvg::Tree::from_str(&svg_str, &opts).map_err(|e| e.to_string())?;

    let pixmap_size = tree.size();
    let mut pixmap = resvg::tiny_skia::Pixmap::new(
        pixmap_size.width() as u32,
        pixmap_size.height() as u32,
    )
    .ok_or("Failed to create pixmap")?;

    resvg::render(&tree, resvg::tiny_skia::Transform::identity(), &mut pixmap.as_mut());
    pixmap.save_png(output_path).map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn export_results_csv(
    app: &tauri::AppHandle,
    state: &AppState,
    input: &ExportQueryRequest,
) -> Result<(), String> {
    let (connection_id, engine) = resolve_connection_engine(app, state, input.connection_id.clone()).await?;
    let sql = input.sql.trim().to_string();
    if sql.is_empty() {
        return Err("No SQL to export.".to_string());
    }

    let lines = match engine {
        DatabaseEngine::Postgres => {
            with_pool_client_retry(
                app, state, &connection_id, sql,
                |client, sql| async move {
                    let messages = client
                        .simple_query(&sql)
                        .await
                        .map_err(|e| map_pg_err(e, Some(sql.as_str())))?;
                    let mut result: Vec<String> = Vec::new();
                    let mut columns: Vec<String> = Vec::new();
                    let mut header_written = false;

                    for msg in messages {
                        match msg {
                            SimpleQueryMessage::RowDescription(desc) => {
                                if columns.is_empty() {
                                    columns = desc.iter().map(|c| c.name().to_string()).collect();
                                }
                            }
                            SimpleQueryMessage::Row(row) => {
                                if !header_written {
                                    result.push(columns.iter().map(|c| csv_escape(c)).collect::<Vec<_>>().join(","));
                                    header_written = true;
                                }
                                if columns.is_empty() {
                                    columns = row.columns().iter().map(|c| c.name().to_string()).collect();
                                    result.push(columns.iter().map(|c| csv_escape(c)).collect::<Vec<_>>().join(","));
                                    header_written = true;
                                }
                                let values: Vec<String> = columns.iter().enumerate()
                                    .map(|(i, _)| csv_escape(row.get(i).unwrap_or("")))
                                    .collect();
                                result.push(values.join(","));
                            }
                            _ => {}
                        }
                    }
                    Ok(result)
                },
            ).await?
        }
        DatabaseEngine::Mysql => {
            let pool = get_or_create_mysql_pool(app, state, &connection_id).await?;
            let rows = sqlx::query(&sql)
                .fetch_all(&pool)
                .await
                .map_err(|e| e.to_string())?;
            if rows.is_empty() {
                Vec::new()
            } else {
                let columns: Vec<String> = rows[0]
                    .columns()
                    .iter()
                    .map(|column| column.name().to_string())
                    .collect();
                let mut lines = vec![columns.iter().map(|c| csv_escape(c)).collect::<Vec<_>>().join(",")];
                for row in rows {
                    let values: Vec<String> = columns
                        .iter()
                        .enumerate()
                        .map(|(index, column_name)| {
                            mysql_value_to_string(&row, index, column_name, "export_results_csv")
                                .map(|value| csv_escape(&value))
                        })
                        .collect::<Result<Vec<_>, _>>()?;
                    lines.push(values.join(","));
                }
                lines
            }
        }
        DatabaseEngine::Sqlite => {
            let pool = get_or_create_sqlite_pool(app, state, &connection_id).await?;
            let rows = sqlx::query(&sql)
                .fetch_all(&pool)
                .await
                .map_err(|e| e.to_string())?;
            if rows.is_empty() {
                Vec::new()
            } else {
                let columns: Vec<String> = rows[0]
                    .columns()
                    .iter()
                    .map(|column| column.name().to_string())
                    .collect();
                let mut lines = vec![columns.iter().map(|c| csv_escape(c)).collect::<Vec<_>>().join(",")];
                for row in rows {
                    let values: Vec<String> = columns
                        .iter()
                        .enumerate()
                        .map(|(index, column_name)| {
                            sqlite_value_to_string(&row, index, column_name, "export_results_csv")
                                .map(|value| csv_escape(&value))
                        })
                        .collect::<Result<Vec<_>, _>>()?;
                    lines.push(values.join(","));
                }
                lines
            }
        }
        DatabaseEngine::Mongo => {
            return Err("MongoDB export is not supported.".to_string());
        }
    };

    let content = lines.join("\n") + "\n";
    fs::write(&input.output_path, content).map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn export_results_json(
    app: &tauri::AppHandle,
    state: &AppState,
    input: &ExportQueryRequest,
) -> Result<(), String> {
    let (connection_id, engine) = resolve_connection_engine(app, state, input.connection_id.clone()).await?;
    let sql = input.sql.trim().to_string();
    if sql.is_empty() {
        return Err("No SQL to export.".to_string());
    }

    let rows: Vec<String> = match engine {
        DatabaseEngine::Postgres => {
            with_pool_client_retry(
                app, state, &connection_id, sql,
                |client, sql| async move {
                    let messages = client
                        .simple_query(&sql)
                        .await
                        .map_err(|e| map_pg_err(e, Some(sql.as_str())))?;
                    let mut result: Vec<String> = Vec::new();
                    let mut columns: Vec<String> = Vec::new();

                    for msg in messages {
                        match msg {
                            SimpleQueryMessage::RowDescription(desc) => {
                                if columns.is_empty() {
                                    columns = desc.iter().map(|c| c.name().to_string()).collect();
                                }
                            }
                            SimpleQueryMessage::Row(row) => {
                                if columns.is_empty() {
                                    columns = row.columns().iter().map(|c| c.name().to_string()).collect();
                                }
                                let obj: serde_json::Map<String, serde_json::Value> = columns.iter().enumerate()
                                    .map(|(i, col)| {
                                        let val = row.get(i).unwrap_or("");
                                        (col.clone(), serde_json::Value::String(val.to_string()))
                                    })
                                    .collect();
                                result.push(serde_json::to_string(&obj).map_err(|e| e.to_string())?);
                            }
                            _ => {}
                        }
                    }
                    Ok(result)
                },
            ).await?
        }
        DatabaseEngine::Mysql => {
            let pool = get_or_create_mysql_pool(app, state, &connection_id).await?;
            let db_rows = sqlx::query(&sql)
                .fetch_all(&pool)
                .await
                .map_err(|e| e.to_string())?;
            let mut result = Vec::new();
            for row in db_rows {
                let columns = row.columns();
                let mut obj = serde_json::Map::new();
                for (idx, col) in columns.iter().enumerate() {
                    obj.insert(
                        col.name().to_string(),
                        serde_json::Value::String(mysql_value_to_string(
                            &row,
                            idx,
                            col.name(),
                            "export_results_json",
                        )?),
                    );
                }
                result.push(serde_json::to_string(&obj).map_err(|e| e.to_string())?);
            }
            result
        }
        DatabaseEngine::Sqlite => {
            let pool = get_or_create_sqlite_pool(app, state, &connection_id).await?;
            let db_rows = sqlx::query(&sql)
                .fetch_all(&pool)
                .await
                .map_err(|e| e.to_string())?;
            let mut result = Vec::new();
            for row in db_rows {
                let columns = row.columns();
                let mut obj = serde_json::Map::new();
                for (idx, col) in columns.iter().enumerate() {
                    obj.insert(
                        col.name().to_string(),
                        serde_json::Value::String(sqlite_value_to_string(
                            &row,
                            idx,
                            col.name(),
                            "export_results_json",
                        )?),
                    );
                }
                result.push(serde_json::to_string(&obj).map_err(|e| e.to_string())?);
            }
            result
        }
        DatabaseEngine::Mongo => {
            return Err("MongoDB JSON export is not supported.".to_string());
        }
    };

    let content = format!("[\n{}\n]\n", rows.join(",\n"));
    fs::write(&input.output_path, content).map_err(|e| e.to_string())?;
    Ok(())
}

fn csv_escape(s: &str) -> String {
    if s.contains(',') || s.contains('"') || s.contains('\n') || s.contains('\r') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

fn mysql_value_to_string(row: &MySqlRow, index: usize, column_name: &str, context: &str) -> Result<String, String> {
    if let Ok(value) = row.try_get::<Option<String>, _>(index) {
        return Ok(value.unwrap_or_default());
    }
    if let Ok(value) = row.try_get::<Option<i64>, _>(index) {
        return Ok(value.map(|v| v.to_string()).unwrap_or_default());
    }
    if let Ok(value) = row.try_get::<Option<i32>, _>(index) {
        return Ok(value.map(|v| v.to_string()).unwrap_or_default());
    }
    if let Ok(value) = row.try_get::<Option<u64>, _>(index) {
        return Ok(value.map(|v| v.to_string()).unwrap_or_default());
    }
    if let Ok(value) = row.try_get::<Option<f64>, _>(index) {
        return Ok(value.map(|v| v.to_string()).unwrap_or_default());
    }
    if let Ok(value) = row.try_get::<Option<bool>, _>(index) {
        return Ok(value.map(|v| v.to_string()).unwrap_or_default());
    }
    if let Ok(value) = row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>(index) {
        return Ok(value.map(|v| v.format("%Y-%m-%d %H:%M:%S").to_string()).unwrap_or_default());
    }
    if let Ok(value) = row.try_get::<Option<chrono::NaiveDateTime>, _>(index) {
        return Ok(value.map(|v| v.format("%Y-%m-%d %H:%M:%S").to_string()).unwrap_or_default());
    }
    if let Ok(value) = row.try_get::<Option<chrono::NaiveDate>, _>(index) {
        return Ok(value.map(|v| v.to_string()).unwrap_or_default());
    }
    if let Ok(value) = row.try_get::<Option<chrono::NaiveTime>, _>(index) {
        return Ok(value.map(|v| v.to_string()).unwrap_or_default());
    }
    if let Ok(value) = row.try_get::<Option<Vec<u8>>, _>(index) {
        return Ok(value
            .map(|v| format!("0x{}", hex::encode(v)))
            .unwrap_or_default());
    }
    Err(format!(
        "MySQL decode error in {} at column '{}' (index {}): unsupported value type",
        context, column_name, index
    ))
}

fn sqlite_value_to_string(row: &SqliteRow, index: usize, column_name: &str, context: &str) -> Result<String, String> {
    if let Ok(value) = row.try_get::<Option<String>, _>(index) {
        return Ok(value.unwrap_or_default());
    }
    if let Ok(value) = row.try_get::<Option<i64>, _>(index) {
        return Ok(value.map(|v| v.to_string()).unwrap_or_default());
    }
    if let Ok(value) = row.try_get::<Option<f64>, _>(index) {
        return Ok(value.map(|v| v.to_string()).unwrap_or_default());
    }
    if let Ok(value) = row.try_get::<Option<bool>, _>(index) {
        return Ok(value.map(|v| v.to_string()).unwrap_or_default());
    }
    if let Ok(value) = row.try_get::<Option<Vec<u8>>, _>(index) {
        return Ok(value
            .map(|v| format!("0x{}", hex::encode(v)))
            .unwrap_or_default());
    }
    Err(format!(
        "SQLite decode error in {} at column '{}' (index {}): unsupported value type",
        context, column_name, index
    ))
}
