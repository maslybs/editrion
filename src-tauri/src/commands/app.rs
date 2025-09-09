use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};
use crate::app_state::AppState;
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

#[tauri::command]
pub fn startup_paths(state: State<'_, AppState>) -> Vec<String> {
    state.startup_paths.clone()
}
