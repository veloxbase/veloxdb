//! Local dashboard report export. Builds a PDF on this machine and writes it
//! to a path the user picked; nothing is uploaded.

use std::collections::HashMap;
use std::fs::File;
use std::io::{BufWriter, Write};

use chrono::Utc;
use printpdf::*;
use serde::Deserialize;

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_a_pdf_with_widget_rows() {
        let mut row = HashMap::new();
        row.insert("region".to_string(), Some("east".to_string()));
        row.insert("total".to_string(), None);
        let input = GeneratePdfRequest {
            title: "Sales".to_string(),
            description: Some("Quarterly".to_string()),
            output_path: String::new(),
            widgets: vec![PdfWidgetSummary {
                id: "w1".to_string(),
                title: "By region".to_string(),
                kind: "chart".to_string(),
                columns: vec!["region".to_string(), "total".to_string()],
                rows: vec![row],
                content: None,
            }],
        };
        let bytes = build_pdf_document(&input).expect("pdf");
        assert!(bytes.starts_with(b"%PDF"));
    }
}
