use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use crate::error::Result;

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
pub fn drafts_dir(app: AppHandle) -> Result<String> {
    let base: PathBuf = app
        .path()
        .app_data_dir()?;
    let drafts = base.join("drafts");
    std::fs::create_dir_all(&drafts)?;
    Ok(drafts.to_string_lossy().to_string())
}