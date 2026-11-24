use keyring::Entry;

const SERVICE_NAME: &str = "com.veloxdb.app";
const OPENROUTER_API_KEY_ACCOUNT: &str = "openrouter-api-key";

fn ssh_password_account(connection_id: &str) -> String {
    format!("{}:ssh-password", connection_id)
}

fn ssh_passphrase_account(connection_id: &str) -> String {
    format!("{}:ssh-passphrase", connection_id)
}

fn entry(connection_id: &str) -> Result<Entry, String> {
    Entry::new(SERVICE_NAME, connection_id).map_err(|e| format!("Keychain error: {}", e))
}

pub fn store_password(connection_id: &str, password: &str) -> Result<(), String> {
    entry(connection_id)?
        .set_password(password)
        .map_err(|e| format!("Failed to store password in keychain: {}", e))
}

pub fn get_password(connection_id: &str) -> Result<Option<String>, String> {
    match entry(connection_id)?.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Failed to read password from keychain: {}", e)),
    }
}

pub fn delete_password(connection_id: &str) -> Result<(), String> {
    match entry(connection_id)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Failed to delete password from keychain: {}", e)),
    }
}

/// Stores an SSH tunnel password in the OS keychain for the given connection.
pub fn store_ssh_password(connection_id: &str, password: &str) -> Result<(), String> {
    let account = ssh_password_account(connection_id);
    entry(&account)?
        .set_password(password)
        .map_err(|e| format!("Failed to store SSH password in keychain: {}", e))
}

/// Retrieves an SSH tunnel password from the OS keychain for the given connection.
pub fn get_ssh_password(connection_id: &str) -> Result<Option<String>, String> {
    let account = ssh_password_account(connection_id);
    match entry(&account)?.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Failed to read SSH password from keychain: {}", e)),
    }
}

/// Deletes an SSH tunnel password from the OS keychain for the given connection.
pub fn delete_ssh_password(connection_id: &str) -> Result<(), String> {
    let account = ssh_password_account(connection_id);
    match entry(&account)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!(
            "Failed to delete SSH password from keychain: {}",
            e
        )),
    }
}

/// Stores an SSH key passphrase in the OS keychain for the given connection.
pub fn store_ssh_passphrase(connection_id: &str, passphrase: &str) -> Result<(), String> {
    let account = ssh_passphrase_account(connection_id);
    entry(&account)?
        .set_password(passphrase)
        .map_err(|e| format!("Failed to store SSH passphrase in keychain: {}", e))
}

/// Retrieves an SSH key passphrase from the OS keychain for the given connection.
pub fn get_ssh_passphrase(connection_id: &str) -> Result<Option<String>, String> {
    let account = ssh_passphrase_account(connection_id);
    match entry(&account)?.get_password() {
        Ok(passphrase) => Ok(Some(passphrase)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!(
            "Failed to read SSH passphrase from keychain: {}",
            e
        )),
    }
}

/// Deletes an SSH key passphrase from the OS keychain for the given connection.
pub fn delete_ssh_passphrase(connection_id: &str) -> Result<(), String> {
    let account = ssh_passphrase_account(connection_id);
    match entry(&account)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!(
            "Failed to delete SSH passphrase from keychain: {}",
            e
        )),
    }
}

/// AI providers whose API key may be kept in the keychain. Anything else is
/// rejected so the frontend cannot read or overwrite arbitrary entries (for
/// example a connection password, whose account is the connection id).
const AI_PROVIDERS: &[&str] = &[
    "openrouter", "openai", "anthropic", "deepseek", "gemini", "groq", "mistral",
    "xai", "ollama", "lmstudio", "custom",
];

fn ai_key_account(provider: &str) -> Result<String, String> {
    if !AI_PROVIDERS.contains(&provider) {
        return Err(format!("Unknown AI provider: {provider}"));
    }
    // Keep the pre-provider account name so existing OpenRouter keys survive.
    Ok(if provider == "openrouter" {
        OPENROUTER_API_KEY_ACCOUNT.to_string()
    } else {
        format!("ai-api-key-{provider}")
    })
}

pub fn store_ai_api_key(provider: &str, api_key: &str) -> Result<(), String> {
    entry(&ai_key_account(provider)?)?
        .set_password(api_key)
        .map_err(|e| format!("Failed to store API key in keychain: {}", e))
}

pub fn get_ai_api_key(provider: &str) -> Result<Option<String>, String> {
    match entry(&ai_key_account(provider)?)?.get_password() {
        Ok(api_key) => Ok(Some(api_key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Failed to read API key from keychain: {}", e)),
    }
}

pub fn delete_ai_api_key(provider: &str) -> Result<(), String> {
    match entry(&ai_key_account(provider)?)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Failed to delete API key from keychain: {}", e)),
    }
}

#[cfg(test)]
mod tests {
    use super::ai_key_account;

    #[test]
    fn openrouter_keeps_its_legacy_account() {
        assert_eq!(ai_key_account("openrouter").unwrap(), "openrouter-api-key");
        assert_eq!(ai_key_account("deepseek").unwrap(), "ai-api-key-deepseek");
    }

    #[test]
    fn rejects_unknown_providers() {
        assert!(ai_key_account("3f2a-connection-id").is_err());
        assert!(ai_key_account("").is_err());
    }
}
