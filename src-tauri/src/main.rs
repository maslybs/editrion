// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Emitter, Manager};

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    // Read as bytes and decode lossily to allow non-UTF8 text files
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&bytes).to_string())
}

#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(path, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_dir(path: String) -> Result<Vec<serde_json::Value>, String> {
    let mut entries = Vec::new();
    let dir = std::fs::read_dir(path).map_err(|e| e.to_string())?;
    
    for entry in dir {
        let entry = entry.map_err(|e| e.to_string())?;
        let metadata = entry.metadata().map_err(|e| e.to_string())?;
        let path = entry.path();
        let name = path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        
        entries.push(serde_json::json!({
            "name": name,
            "path": path.to_string_lossy(),
            "is_dir": metadata.is_dir(),
        }));
    }
    
    Ok(entries)
}

#[tauri::command]
fn create_new_file() -> Result<String, String> {
    let temp_name = format!("Untitled-{}", std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap().as_secs());
    Ok(temp_name)
}

#[tauri::command]
async fn menu_action(window: tauri::Window, action: String) {
    window.emit("menu-event", &action).unwrap();
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .on_window_event(|window, event| {
            #[cfg(target_os = "macos")]
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Typical macOS behavior: keep app running, just hide window
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .setup(|app| {
            use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
            
            // Create menu using Tauri v2 menu system
            let new_file = MenuItem::with_id(app, "new_file", "New File", true, Some("CmdOrCtrl+N"))?;
            let open_file = MenuItem::with_id(app, "open_file", "Open File...", true, Some("CmdOrCtrl+O"))?;
            let open_folder = MenuItem::with_id(app, "open_folder", "Open Folder...", true, None::<&str>)?;
            let save = MenuItem::with_id(app, "save", "Save", true, Some("CmdOrCtrl+S"))?;
            let save_as = MenuItem::with_id(app, "save_as", "Save As…", true, Some("CmdOrCtrl+Shift+S"))?;
            let close_tab = MenuItem::with_id(app, "close_tab", "Close Tab", true, Some("CmdOrCtrl+W"))?;
            
            let file_menu = Submenu::with_items(app, "File", true, &[
                &new_file,
                &open_file, 
                &open_folder,
                &PredefinedMenuItem::separator(app)?,
                &save,
                &save_as,
                &PredefinedMenuItem::separator(app)?,
                &close_tab,
            ])?;

            let find = MenuItem::with_id(app, "find", "Find", true, Some("CmdOrCtrl+F"))?;
            let replace = MenuItem::with_id(app, "replace", "Replace", true, Some("CmdOrCtrl+H"))?;
            let select_all = MenuItem::with_id(app, "select_all_occurrences", "Select All Occurrences", true, Some("CmdOrCtrl+Shift+L"))?;
            
            let edit_menu = Submenu::with_items(app, "Edit", true, &[
                &PredefinedMenuItem::undo(app, None)?,
                &PredefinedMenuItem::redo(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::cut(app, None)?,
                &PredefinedMenuItem::copy(app, None)?,
                &PredefinedMenuItem::paste(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &find,
                &replace,
                &PredefinedMenuItem::separator(app)?,
                &select_all,
            ])?;
            
            // Window menu
            let show_window = MenuItem::with_id(app, "show_window", "Show Window", true, None::<&str>)?;
            let window_menu = Submenu::with_items(app, "Window", true, &[
                &show_window,
            ])?;

            let menu = Menu::with_items(app, &[&file_menu, &edit_menu, &window_menu])?;
            app.set_menu(menu)?;

            Ok(())
        })
        .on_menu_event(|app, event| {
            if let Some(window) = app.get_webview_window("main") {
                // Always try to show/focus the window when interacting via menu
                let _ = window.show();
                let _ = window.set_focus();

                let id = event.id().as_ref();
                if id == "show_window" {
                    // Handled above; do not forward to frontend
                    return;
                }
                // Send menu events to frontend for other actions
                let _ = window.emit("menu-event", id);
            }
        })
        .invoke_handler(tauri::generate_handler![read_file, write_file, read_dir, create_new_file, menu_action])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
