// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Emitter, Manager};
use std::collections::HashMap;
use std::path::PathBuf;

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

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn drafts_dir(app: tauri::AppHandle) -> Result<String, String> {
    let base: PathBuf = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let drafts = base.join("drafts");
    std::fs::create_dir_all(&drafts).map_err(|e| e.to_string())?;
    Ok(drafts.to_string_lossy().to_string())
}

#[tauri::command]
fn remove_file(path: String) -> Result<(), String> {
    match std::fs::remove_file(&path) {
        Ok(_) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn clear_dir(path: String) -> Result<(), String> {
    match std::fs::remove_dir_all(&path) {
        Ok(_) => {},
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {},
        Err(e) => return Err(e.to_string()),
    }
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(())
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .on_window_event(|window, event| {
            match event {
                #[cfg(target_os = "macos")]
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    // macOS: keep app running, but avoid leaving a black fullscreen space
                    api.prevent_close();
                    // Try to exit fullscreen before hiding, to avoid ghost/black space artifacts
                    let _ = window.set_fullscreen(false);
                    let _ = window.set_simple_fullscreen(false);
                    // Hide after a short delay to give the OS time to exit fullscreen
                    let win = window.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_millis(120));
                        let _ = win.hide();
                    });
                }
                #[cfg(not(target_os = "macos"))]
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    // Windows/Linux: ask frontend to confirm quit if there are unsaved changes
                    api.prevent_close();
                    let _ = window.emit("request-close", {});
                }
                _ => {}
            }
        })
        .setup(|app| {
            use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
            
            // Initial static English menu; frontend will rebuild it with translations on load
            let new_file = MenuItem::with_id(app, "new_file", "New File", true, Some("CmdOrCtrl+N"))?;
            let open_file = MenuItem::with_id(app, "open_file", "Open File...", true, Some("CmdOrCtrl+O"))?;
            let open_folder = MenuItem::with_id(app, "open_folder", "Open Folder...", true, None::<&str>)?;
            let save = MenuItem::with_id(app, "save", "Save", true, Some("CmdOrCtrl+S"))?;
            let save_as = MenuItem::with_id(app, "save_as", "Save As…", true, Some("CmdOrCtrl+Shift+S"))?;
            let close_tab = MenuItem::with_id(app, "close_tab", "Close Tab", true, Some("CmdOrCtrl+W"))?;
            
            let quit_custom = MenuItem::with_id(app, "quit_app", "Quit Editrion (Beta)", true, Some("CmdOrCtrl+Q"))?;
            let file_menu = Submenu::with_items(app, "File", true, &[
                &new_file,
                &open_file, 
                &open_folder,
                &PredefinedMenuItem::separator(app)?,
                &save,
                &save_as,
                &PredefinedMenuItem::separator(app)?,
                &close_tab,
                &PredefinedMenuItem::separator(app)?,
                &quit_custom,
            ])?;

            let find = MenuItem::with_id(app, "find", "Find", true, Some("CmdOrCtrl+F"))?;
            let replace = MenuItem::with_id(app, "replace", "Replace", true, Some("CmdOrCtrl+H"))?;
            let select_all = MenuItem::with_id(app, "select_all_occurrences", "Select All Occurrences", true, Some("CmdOrCtrl+Shift+L"))?;
            
            // Initial static menu (English); use predefined items for proper shortcut routing.
            let edit_undo = PredefinedMenuItem::undo(app, Some("Undo"))?;
            let edit_redo = PredefinedMenuItem::redo(app, Some("Redo"))?;
            let edit_cut = PredefinedMenuItem::cut(app, Some("Cut"))?;
            let edit_copy = PredefinedMenuItem::copy(app, Some("Copy"))?;
            let edit_paste = PredefinedMenuItem::paste(app, Some("Paste"))?;
            let edit_menu = Submenu::with_items(app, "Edit", true, &[
                &edit_undo,
                &edit_redo,
                &PredefinedMenuItem::separator(app)?,
                &edit_cut,
                &edit_copy,
                &edit_paste,
                &PredefinedMenuItem::separator(app)?,
                &find,
                &replace,
                &PredefinedMenuItem::separator(app)?,
                &select_all,
            ])?;
            
            // View -> Theme
            let theme_dark = MenuItem::with_id(app, "theme_dark", "Dark", true, None::<&str>)?;
            let theme_light = MenuItem::with_id(app, "theme_light", "Light", true, None::<&str>)?;
            let theme_load_custom = MenuItem::with_id(app, "theme_load_custom", "Load Custom…", true, None::<&str>)?;
            let theme_submenu = Submenu::with_items(app, "Theme", true, &[
                &theme_dark,
                &theme_light,
                &PredefinedMenuItem::separator(app)?,
                &theme_load_custom,
            ])?;

            let view_menu = Submenu::with_items(app, "View", true, &[
                &theme_submenu,
            ])?;

            // Settings -> Language
            let lang_en = MenuItem::with_id(app, "language_en", "Language: English", true, None::<&str>)?;
            let lang_uk = MenuItem::with_id(app, "language_uk", "Language: Українська", true, None::<&str>)?;
            let lang_es = MenuItem::with_id(app, "language_es", "Language: Español", true, None::<&str>)?;
            let lang_fr = MenuItem::with_id(app, "language_fr", "Language: Français", true, None::<&str>)?;
            let lang_ja = MenuItem::with_id(app, "language_ja", "Language: 日本語", true, None::<&str>)?;
            let lang_de = MenuItem::with_id(app, "language_de", "Language: Deutsch", true, None::<&str>)?;
            let language_submenu = Submenu::with_items(app, "Language", true, &[
                &lang_en,
                &lang_uk,
                &lang_es,
                &lang_fr,
                &lang_ja,
                &lang_de,
            ])?;
            let settings_menu = Submenu::with_items(app, "Settings", true, &[
                &language_submenu,
            ])?;

            // Window menu
            let show_window = MenuItem::with_id(app, "show_window", "Show Window", true, None::<&str>)?;
            let window_menu = Submenu::with_items(app, "Window", true, &[
                &show_window,
            ])?;

            let menu = Menu::with_items(app, &[&file_menu, &edit_menu, &view_menu, &settings_menu, &window_menu])?;
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
                if id == "quit_app" {
                    // Forward to frontend to handle unsaved changes confirmation
                    let _ = window.emit("menu-event", id);
                    return;
                }
                // Send menu events to frontend for other actions
                let _ = window.emit("menu-event", id);
            }
        })
        .invoke_handler(tauri::generate_handler![read_file, write_file, read_dir, create_new_file, menu_action, quit_app, rebuild_menu, drafts_dir, remove_file, clear_dir])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // Handle app-level events (e.g., Dock icon click on macOS)
    app.run(|app_handle, event| {
        match event {
            // macOS Dock icon clicked or app re-opened when no windows are visible
            tauri::RunEvent::Reopen { .. } => {
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            // Some desktop environments send a Ready / Resumed; ensure we can bring window back when needed
            tauri::RunEvent::Ready => {
                // no-op
            }
            _ => {}
        }
    });
}

#[tauri::command]
fn rebuild_menu(app: tauri::AppHandle, labels: HashMap<String, String>) -> Result<(), String> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};

    // Helper to get a label or fallback to key
    let g = |k: &str| labels.get(k).cloned().unwrap_or_else(|| k.to_string());

    let new_file = MenuItem::with_id(&app, "new_file", &g("menu.item.newFile"), true, Some("CmdOrCtrl+N")).map_err(|e| e.to_string())?;
    let open_file = MenuItem::with_id(&app, "open_file", &g("menu.item.openFile"), true, Some("CmdOrCtrl+O")).map_err(|e| e.to_string())?;
    let open_folder = MenuItem::with_id(&app, "open_folder", &g("menu.item.openFolder"), true, None::<&str>).map_err(|e| e.to_string())?;
    let save = MenuItem::with_id(&app, "save", &g("menu.item.save"), true, Some("CmdOrCtrl+S")).map_err(|e| e.to_string())?;
    let save_as = MenuItem::with_id(&app, "save_as", &g("menu.item.saveAs"), true, Some("CmdOrCtrl+Shift+S")).map_err(|e| e.to_string())?;
    let close_tab = MenuItem::with_id(&app, "close_tab", &g("menu.item.closeTab"), true, Some("CmdOrCtrl+W")).map_err(|e| e.to_string())?;
    let quit_custom = MenuItem::with_id(&app, "quit_app", &g("menu.item.quit"), true, Some("CmdOrCtrl+Q")).map_err(|e| e.to_string())?;
    let file_menu = Submenu::with_items(&app, &g("menu.file"), true, &[
        &new_file,
        &open_file,
        &open_folder,
        &PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?,
        &save,
        &save_as,
        &PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?,
        &close_tab,
        &PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?,
        &quit_custom,
    ]).map_err(|e| e.to_string())?;

    let find = MenuItem::with_id(&app, "find", &g("menu.item.find"), true, Some("CmdOrCtrl+F")).map_err(|e| e.to_string())?;
    let replace = MenuItem::with_id(&app, "replace", &g("menu.item.replace"), true, Some("CmdOrCtrl+H")).map_err(|e| e.to_string())?;
    let select_all = MenuItem::with_id(&app, "select_all_occurrences", &g("menu.item.selectAllOccurrences"), true, Some("CmdOrCtrl+Shift+L")).map_err(|e| e.to_string())?;
    // Use predefined items so OS/webview routes shortcuts (Cmd/Ctrl+Z/X/C/V)
    let edit_undo = PredefinedMenuItem::undo(&app, Some(&g("menu.item.undo"))).map_err(|e| e.to_string())?;
    let edit_redo = PredefinedMenuItem::redo(&app, Some(&g("menu.item.redo"))).map_err(|e| e.to_string())?;
    let edit_cut = PredefinedMenuItem::cut(&app, Some(&g("menu.item.cut"))).map_err(|e| e.to_string())?;
    let edit_copy = PredefinedMenuItem::copy(&app, Some(&g("menu.item.copy"))).map_err(|e| e.to_string())?;
    let edit_paste = PredefinedMenuItem::paste(&app, Some(&g("menu.item.paste"))).map_err(|e| e.to_string())?;
    let edit_menu = Submenu::with_items(&app, &g("menu.edit"), true, &[
        &edit_undo,
        &edit_redo,
        &PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?,
        &edit_cut,
        &edit_copy,
        &edit_paste,
        &PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?,
        &find,
        &replace,
        &PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?,
        &select_all,
    ]).map_err(|e| e.to_string())?;

    let theme_dark = MenuItem::with_id(&app, "theme_dark", &g("menu.item.theme.dark"), true, None::<&str>).map_err(|e| e.to_string())?;
    let theme_light = MenuItem::with_id(&app, "theme_light", &g("menu.item.theme.light"), true, None::<&str>).map_err(|e| e.to_string())?;
    let theme_load_custom = MenuItem::with_id(&app, "theme_load_custom", &g("menu.item.theme.loadCustom"), true, None::<&str>).map_err(|e| e.to_string())?;
    let theme_submenu = Submenu::with_items(&app, &g("menu.theme"), true, &[
        &theme_dark,
        &theme_light,
        &PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?,
        &theme_load_custom,
    ]).map_err(|e| e.to_string())?;

    let view_menu = Submenu::with_items(&app, &g("menu.view"), true, &[
        &theme_submenu,
    ]).map_err(|e| e.to_string())?;

    // Settings -> Language
    let lang_en = MenuItem::with_id(&app, "language_en", &g("menu.item.lang.en"), true, None::<&str>).map_err(|e| e.to_string())?;
    let lang_uk = MenuItem::with_id(&app, "language_uk", &g("menu.item.lang.uk"), true, None::<&str>).map_err(|e| e.to_string())?;
    let lang_es = MenuItem::with_id(&app, "language_es", &g("menu.item.lang.es"), true, None::<&str>).map_err(|e| e.to_string())?;
    let lang_fr = MenuItem::with_id(&app, "language_fr", &g("menu.item.lang.fr"), true, None::<&str>).map_err(|e| e.to_string())?;
    let lang_ja = MenuItem::with_id(&app, "language_ja", &g("menu.item.lang.ja"), true, None::<&str>).map_err(|e| e.to_string())?;
    let lang_de = MenuItem::with_id(&app, "language_de", &g("menu.item.lang.de"), true, None::<&str>).map_err(|e| e.to_string())?;
    let language_submenu = Submenu::with_items(&app, &g("menu.language"), true, &[
        &lang_en,
        &lang_uk,
        &lang_es,
        &lang_fr,
        &lang_ja,
        &lang_de,
    ]).map_err(|e| e.to_string())?;
    let settings_menu = Submenu::with_items(&app, &g("menu.settings"), true, &[
        &language_submenu,
    ]).map_err(|e| e.to_string())?;

    // Window menu
    let show_window = MenuItem::with_id(&app, "show_window", &g("menu.item.window.show"), true, None::<&str>).map_err(|e| e.to_string())?;
    let window_menu = Submenu::with_items(&app, &g("menu.window"), true, &[
        &show_window,
    ]).map_err(|e| e.to_string())?;

    let menu = Menu::with_items(&app, &[&file_menu, &edit_menu, &view_menu, &settings_menu, &window_menu]).map_err(|e| e.to_string())?;
    app.set_menu(menu).map_err(|e| e.to_string())?;
    Ok(())
}
