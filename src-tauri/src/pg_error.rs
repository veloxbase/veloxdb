//! Format `tokio_postgres` errors for UI display (pgAdmin-style text).

use tokio_postgres::error::ErrorPosition;
use tokio_postgres::Error;

/// Map a Postgres client error to a user-facing string for IPC.
pub fn map_pg_err(error: Error, sql: Option<&str>) -> String {
    format_postgres_error(&error, sql)
}

/// Format a Postgres error with message, SQLSTATE, DETAIL, HINT, and optional LINE/caret.
pub fn format_postgres_error(error: &Error, sql: Option<&str>) -> String {
    let Some(db_error) = error.as_db_error() else {
        return error.to_string();
    };

    let mut out = String::new();
    out.push_str(&format!("{}: {}", db_error.severity(), db_error.message()));
    out.push_str(&format!("\nSQLSTATE: {}", db_error.code().code()));

    if let Some(detail) = db_error.detail() {
        out.push_str(&format!("\nDETAIL: {detail}"));
    }
    if let Some(hint) = db_error.hint() {
        out.push_str(&format!("\nHINT: {hint}"));
    }

    if let Some(sql) = sql {
        if let Some((line, column)) = error_line_column(error, sql) {
            append_line_caret(&mut out, sql, line, column);
        }
    }

    out
}

/// Line/column (1-based) for editor markers and lint diagnostics.
pub fn error_line_column(error: &Error, sql: &str) -> Option<(usize, usize)> {
    let db_error = error.as_db_error()?;
    let byte_offset = match db_error.position()? {
        ErrorPosition::Original(position) => (*position as usize).saturating_sub(1),
        ErrorPosition::Internal { position, .. } => (*position as usize).saturating_sub(1),
    };
    byte_offset_to_line_col(sql, byte_offset)
}

fn byte_offset_to_line_col(sql: &str, byte_offset: usize) -> Option<(usize, usize)> {
    if byte_offset == 0 || byte_offset > sql.len() {
        return None;
    }
    let mut line = 1usize;
    let mut column = 1usize;
    for ch in sql[..byte_offset].chars() {
        if ch == '\n' {
            line += 1;
            column = 1;
        } else {
            column += 1;
        }
    }
    Some((line, column))
}

fn append_line_caret(out: &mut String, sql: &str, line: usize, column: usize) {
    let Some(line_text) = nth_line(sql, line) else {
        return;
    };
    out.push('\n');
    out.push_str(&format!("LINE {line}: {line_text}"));
    let caret_prefix_len = format!("LINE {line}: ").len();
    let caret_spaces = caret_prefix_len + column.saturating_sub(1);
    out.push('\n');
    out.push_str(&format!("{:width$}^", "", width = caret_spaces));
}

fn nth_line(sql: &str, line: usize) -> Option<&str> {
    if line == 0 {
        return None;
    }
    let mut current = 1usize;
    let mut start = 0usize;
    for (index, ch) in sql.char_indices() {
        if ch == '\n' {
            if current == line {
                return sql.get(start..index);
            }
            current += 1;
            start = index + 1;
        }
    }
    if current == line {
        return sql.get(start..);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn byte_offset_maps_to_line_and_column() {
        let sql = "SELECT 1;\nSELECT bad";
        assert_eq!(byte_offset_to_line_col(sql, 1), Some((1, 2)));
        assert_eq!(byte_offset_to_line_col(sql, 11), Some((2, 2)));
        assert_eq!(byte_offset_to_line_col(sql, 16), Some((2, 6)));
    }

    #[test]
    fn nth_line_extracts_correct_line() {
        let sql = "first\nsecond\nthird";
        assert_eq!(nth_line(sql, 1), Some("first"));
        assert_eq!(nth_line(sql, 2), Some("second"));
        assert_eq!(nth_line(sql, 3), Some("third"));
        assert_eq!(nth_line(sql, 4), None);
    }

    #[test]
    fn append_line_caret_aligns_under_column() {
        let sql = "SELECT bad";
        let mut out = String::from("ERROR: syntax error");
        append_line_caret(&mut out, sql, 1, 8);
        assert!(out.contains("LINE 1: SELECT bad"));
        assert!(out.ends_with("       ^\n") || out.ends_with("       ^"));
    }
}
