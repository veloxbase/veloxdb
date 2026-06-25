use crate::error::VeloxError;

pub fn quote_identifier(value: &str) -> String {
    value.replace('"', "\"\"")
}

/// Whether `name` is safe to interpolate into dynamic SQL (e.g. SQLite `PRAGMA`
/// statements, where bind parameters are not allowed). Restricted to ASCII
/// alphanumerics and underscores so it cannot terminate or escape a statement.
pub fn is_safe_identifier(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 128
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// Validates an identifier before it is interpolated into dynamic SQL. Returns
/// the identifier unchanged when safe, or a descriptive error otherwise.
pub fn require_safe_identifier<'a>(name: &'a str, context: &str) -> Result<&'a str, VeloxError> {
    if is_safe_identifier(name) {
        Ok(name)
    } else {
        Err(VeloxError::Validation(format!(
            "Invalid identifier for {}: {:?}",
            context, name
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::{is_safe_identifier, require_safe_identifier};

    #[test]
    fn rejects_sql_injection_in_identifiers() {
        assert!(!is_safe_identifier("\"; DROP TABLE users; --"));
        assert!(!is_safe_identifier("foo; DELETE FROM bar"));
        assert!(!is_safe_identifier("a\0b"));
        assert!(!is_safe_identifier(""));
        assert!(require_safe_identifier("foo);", "table name").is_err());
    }

    #[test]
    fn accepts_plain_identifiers() {
        assert!(is_safe_identifier("users"));
        assert!(is_safe_identifier("_internal"));
        assert!(is_safe_identifier("Table123"));
        assert_eq!(require_safe_identifier("users", "table name").unwrap(), "users");
    }
}
