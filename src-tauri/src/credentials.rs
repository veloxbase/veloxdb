use keyring::Entry;

const SERVICE_NAME: &str = "com.veloxdb.app";
const OPENROUTER_API_KEY_ACCOUNT: &str = "openrouter-api-key";

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

pub fn store_openrouter_api_key(api_key: &str) -> Result<(), String> {
    entry(OPENROUTER_API_KEY_ACCOUNT)?
        .set_password(api_key)
        .map_err(|e| format!("Failed to store API key in keychain: {}", e))
}

pub fn get_openrouter_api_key() -> Result<Option<String>, String> {
    match entry(OPENROUTER_API_KEY_ACCOUNT)?.get_password() {
        Ok(api_key) => Ok(Some(api_key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Failed to read API key from keychain: {}", e)),
    }
}

pub fn delete_openrouter_api_key() -> Result<(), String> {
    match entry(OPENROUTER_API_KEY_ACCOUNT)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Failed to delete API key from keychain: {}", e)),
    }
}
