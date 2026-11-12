//! Local dashboard export. The frontend captures the dashboard as it looks on
//! screen (a JPEG snapshot); this module wraps it in a PDF with a title header
//! and writes it to a path the user picked. Nothing is uploaded.

use std::fs::File;
use std::io::{BufWriter, Write};

use base64::Engine;
use chrono::Local;
use printpdf::*;
use serde::Deserialize;

/// Page width in millimetres (A4 landscape width). The page height follows the
/// snapshot's aspect ratio so a long dashboard stays on one continuous page.
const PAGE_WIDTH_MM: f32 = 297.0;
const MARGIN_MM: f32 = 12.0;
const HEADER_MM: f32 = 22.0;
/// PDF viewers cap page size around 5080 mm; stay well under it.
const MAX_PAGE_HEIGHT_MM: f32 = 5000.0;
/// Reject absurd payloads before decoding (a 4K-wide 2x dashboard is ~5 MB).
const MAX_SNAPSHOT_BASE64_BYTES: usize = 40 * 1024 * 1024;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportDashboardPdfRequest {
    pub title: String,
    pub description: Option<String>,
    pub output_path: String,
    /// Baseline JPEG, base64 encoded, without a `data:` prefix.
    pub snapshot_jpeg_base64: String,
    pub snapshot_width: u32,
    pub snapshot_height: u32,
    /// Page background and text colours as `#rrggbb`, taken from the app theme
    /// so the snapshot does not sit on a mismatched white page.
    pub background: Option<String>,
    pub foreground: Option<String>,
}

fn parse_hex_rgb(value: Option<&str>, fallback: (f32, f32, f32)) -> (f32, f32, f32) {
    value
        .map(str::trim)
        .and_then(|hex| hex.strip_prefix('#'))
        .filter(|hex| hex.len() == 6 && hex.is_ascii())
        .and_then(|hex| {
            let channel = |i: usize| u8::from_str_radix(&hex[i..i + 2], 16).ok();
            Some((channel(0)?, channel(2)?, channel(4)?))
        })
        .map(|(r, g, b)| (r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0))
        .unwrap_or(fallback)
}

fn rgb_color((r, g, b): (f32, f32, f32)) -> Color {
    Color::Rgb(Rgb::new(r, g, b, None))
}

/// Image size on the page in millimetres: full content width, height from the
/// snapshot's aspect ratio, shrunk uniformly if the page would get too tall.
fn image_size_mm(snapshot_width: u32, snapshot_height: u32) -> (f32, f32) {
    let content_width = PAGE_WIDTH_MM - 2.0 * MARGIN_MM;
    let height = content_width * snapshot_height as f32 / snapshot_width as f32;
    let max_height = MAX_PAGE_HEIGHT_MM - HEADER_MM - 2.0 * MARGIN_MM;
    if height > max_height {
        let shrink = max_height / height;
        (content_width * shrink, max_height)
    } else {
        (content_width, height)
    }
}

fn build_dashboard_pdf(input: &ExportDashboardPdfRequest, jpeg: Vec<u8>) -> Result<Vec<u8>, String> {
    if input.snapshot_width == 0 || input.snapshot_height == 0 {
        return Err("Dashboard snapshot is empty.".to_string());
    }
    let (image_width, image_height) = image_size_mm(input.snapshot_width, input.snapshot_height);
    let page_height = image_height + HEADER_MM + 2.0 * MARGIN_MM;

    let (doc, page, layer) =
        PdfDocument::new(&input.title, Mm(PAGE_WIDTH_MM), Mm(page_height), "Dashboard");
    let layer = doc.get_page(page).get_layer(layer);
    let font_bold = doc
        .add_builtin_font(BuiltinFont::HelveticaBold)
        .map_err(|e| format!("Font load error: {e:?}"))?;
    let font_regular = doc
        .add_builtin_font(BuiltinFont::Helvetica)
        .map_err(|e| format!("Font load error: {e:?}"))?;

    layer.set_fill_color(rgb_color(parse_hex_rgb(input.background.as_deref(), (1.0, 1.0, 1.0))));
    layer.add_rect(Rect::new(Mm(0.0), Mm(0.0), Mm(PAGE_WIDTH_MM), Mm(page_height)));

    layer.set_fill_color(rgb_color(parse_hex_rgb(input.foreground.as_deref(), (0.1, 0.1, 0.1))));
    let title_y = page_height - MARGIN_MM - 7.0;
    layer.use_text(&input.title, 16.0, Mm(MARGIN_MM), Mm(title_y), &font_bold);
    let generated = format!("Generated {}", Local::now().format("%Y-%m-%d %H:%M"));
    let subtitle = match input.description.as_deref().map(str::trim) {
        Some(desc) if !desc.is_empty() => format!("{desc}  -  {generated}"),
        _ => generated,
    };
    layer.use_text(&subtitle, 8.5, Mm(MARGIN_MM), Mm(title_y - 6.5), &font_regular);

    // Embed the JPEG as-is (DCT filter): no decoding or re-encoding, so the
    // snapshot keeps its quality and the export stays fast.
    let image = Image::from(ImageXObject {
        width: Px(input.snapshot_width as usize),
        height: Px(input.snapshot_height as usize),
        color_space: ColorSpace::Rgb,
        bits_per_component: ColorBits::Bit8,
        interpolate: true,
        image_data: jpeg,
        image_filter: Some(ImageFilter::DCT),
        smask: None,
        clipping_bbox: None,
    });
    // At `dpi`, one pixel is 25.4 / dpi mm; pick the dpi that maps the snapshot
    // width onto `image_width`.
    let dpi = input.snapshot_width as f32 * 25.4 / image_width;
    image.add_to_layer(
        layer,
        ImageTransform {
            translate_x: Some(Mm((PAGE_WIDTH_MM - image_width) / 2.0)),
            translate_y: Some(Mm(MARGIN_MM)),
            dpi: Some(dpi),
            ..Default::default()
        },
    );

    let mut bytes = Vec::new();
    doc.save(&mut BufWriter::new(&mut bytes))
        .map_err(|e| format!("Failed to write PDF: {e:?}"))?;
    Ok(bytes)
}

/// Writes a PDF of the dashboard snapshot to `output_path`.
#[tauri::command]
pub async fn export_dashboard_pdf(input: ExportDashboardPdfRequest) -> Result<String, String> {
    if input.snapshot_jpeg_base64.len() > MAX_SNAPSHOT_BASE64_BYTES {
        return Err("Dashboard snapshot is too large to export.".to_string());
    }
    let jpeg = base64::engine::general_purpose::STANDARD
        .decode(input.snapshot_jpeg_base64.trim())
        .map_err(|e| format!("Invalid dashboard snapshot: {e}"))?;
    if !jpeg.starts_with(&[0xFF, 0xD8]) {
        return Err("Dashboard snapshot must be a JPEG image.".to_string());
    }
    let bytes = build_dashboard_pdf(&input, jpeg)?;
    let file = File::create(&input.output_path)
        .map_err(|e| format!("Failed to create PDF file: {e}"))?;
    let mut writer = BufWriter::new(file);
    writer
        .write_all(&bytes)
        .map_err(|e| format!("Failed to write PDF: {e}"))?;
    writer.flush().map_err(|e| format!("Failed to write PDF: {e}"))?;
    Ok(input.output_path)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// JPEG start/end markers; the PDF embeds the bytes without decoding them.
    fn fake_jpeg() -> Vec<u8> {
        vec![0xFF, 0xD8, 0xFF, 0xD9]
    }

    fn request(width: u32, height: u32) -> ExportDashboardPdfRequest {
        ExportDashboardPdfRequest {
            title: "Revenue".to_string(),
            description: Some("Weekly".to_string()),
            output_path: String::new(),
            snapshot_jpeg_base64: String::new(),
            snapshot_width: width,
            snapshot_height: height,
            background: Some("#0b0b0c".to_string()),
            foreground: Some("#f5f5f5".to_string()),
        }
    }

    #[test]
    fn builds_a_pdf_around_the_snapshot() {
        let bytes = build_dashboard_pdf(&request(1600, 900), fake_jpeg()).expect("pdf");
        assert!(bytes.starts_with(b"%PDF"));
    }

    #[test]
    fn rejects_an_empty_snapshot() {
        assert!(build_dashboard_pdf(&request(0, 900), fake_jpeg()).is_err());
    }

    #[test]
    fn keeps_aspect_ratio_and_caps_page_height() {
        let (w, h) = image_size_mm(1600, 900);
        assert!((w / h - 1600.0 / 900.0).abs() < 0.01);
        let (w, h) = image_size_mm(100, 10_000);
        assert!(h + HEADER_MM + 2.0 * MARGIN_MM <= MAX_PAGE_HEIGHT_MM + 0.01);
        assert!((h / w - 100.0).abs() < 0.5);
    }

    #[test]
    fn parses_theme_colors_with_fallback() {
        assert_eq!(parse_hex_rgb(Some("#ff0000"), (0.0, 0.0, 0.0)), (1.0, 0.0, 0.0));
        assert_eq!(parse_hex_rgb(Some("oops"), (0.5, 0.5, 0.5)), (0.5, 0.5, 0.5));
        assert_eq!(parse_hex_rgb(None, (0.2, 0.2, 0.2)), (0.2, 0.2, 0.2));
    }
}
