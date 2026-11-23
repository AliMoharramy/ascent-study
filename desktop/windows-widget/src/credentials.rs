use keyring::{Entry, Error as KeyringError};
use serde::{Deserialize, Serialize};

const SERVICE: &str = "Ascent Focus";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionCredential {
    pub token: String,
    pub csrf_token: String,
    pub user_id: String,
    pub username: String,
    pub expires_at: String,
}

fn entry(server_url: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, server_url)
        .map_err(|_| "Windows Credential Manager is unavailable".to_string())
}

pub fn load(server_url: &str) -> Result<Option<SessionCredential>, String> {
    let item = entry(server_url)?;
    match item.get_password() {
        Ok(value) => match serde_json::from_str(&value) {
            Ok(credential) => Ok(Some(credential)),
            Err(_) => {
                let _ = item.delete_credential();
                Ok(None)
            }
        },
        Err(KeyringError::NoEntry) => Ok(None),
        Err(_) => {
            Err("Could not read the Ascent session from Windows Credential Manager".to_string())
        }
    }
}

pub fn save(server_url: &str, credential: &SessionCredential) -> Result<(), String> {
    let item = entry(server_url)?;
    let value = serde_json::to_string(credential)
        .map_err(|_| "Could not encode the Ascent session".to_string())?;
    item.set_password(&value)
        .map_err(|_| "Could not save the Ascent session in Windows Credential Manager".to_string())
}

pub fn clear(server_url: &str) -> Result<(), String> {
    let item = entry(server_url)?;
    match item.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(_) => {
            Err("Could not remove the Ascent session from Windows Credential Manager".to_string())
        }
    }
}
