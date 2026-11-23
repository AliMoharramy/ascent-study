use serde::{Deserialize, Serialize};
use std::{env, fs, path::PathBuf};

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct Settings {
    pub server_url: String,
    #[serde(default)]
    pub widget_x: Option<i32>,
    #[serde(default)]
    pub widget_y: Option<i32>,
}

fn settings_path() -> PathBuf {
    let root = env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(env::temp_dir);
    root.join("AscentFocus").join("settings.json")
}

pub fn load() -> Settings {
    fs::read_to_string(settings_path())
        .ok()
        .and_then(|value| serde_json::from_str(&value).ok())
        .unwrap_or_default()
}

pub fn save(settings: &Settings) -> Result<(), String> {
    let path = settings_path();
    let parent = path
        .parent()
        .ok_or_else(|| "Could not locate the user settings directory".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|_| "Could not create the user settings directory".to_string())?;
    let value = serde_json::to_vec_pretty(settings)
        .map_err(|_| "Could not encode the user settings".to_string())?;
    fs::write(path, value).map_err(|_| "Could not save the user settings".to_string())
}
