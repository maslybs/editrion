use std::collections::HashMap;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use crate::error::{Result};

pub fn build_initial_menu<R: Runtime>(app: &AppHandle<R>) -> Result<Menu<R>> {
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
    let ai_settings = MenuItem::with_id(app, "ai_settings", "AI", true, None::<&str>)?;
    
    let settings_menu = Submenu::with_items(app, "Settings", true, &[
        &language_submenu,
        &PredefinedMenuItem::separator(app)?,
        &ai_settings,
    ])?;

    let show_window = MenuItem::with_id(app, "show_window", "Show Window", true, None::<&str>)?;
    let window_menu = Submenu::with_items(app, "Window", true, &[
        &show_window,
    ])?;

    let menu = Menu::with_items(app, &[&file_menu, &edit_menu, &view_menu, &settings_menu, &window_menu])?;
    Ok(menu)
}

pub fn handle_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();

        let id = event.id().as_ref();
        if id == "show_window" {
            return;
        }
        if id == "quit_app" {
            let _ = window.emit("menu-event", id);
            return;
        }
        let _ = window.emit("menu-event", id);
    }
}

#[tauri::command]
pub fn rebuild_menu(app: AppHandle, labels: HashMap<String, String>) -> Result<()> {
    let g = |k: &str| labels.get(k).cloned().unwrap_or_else(|| k.to_string());

    let new_file = MenuItem::with_id(&app, "new_file", &g("menu.item.newFile"), true, Some("CmdOrCtrl+N"))?;
    let open_file = MenuItem::with_id(&app, "open_file", &g("menu.item.openFile"), true, Some("CmdOrCtrl+O"))?;
    let open_folder = MenuItem::with_id(&app, "open_folder", &g("menu.item.openFolder"), true, None::<&str>)?;
    let save = MenuItem::with_id(&app, "save", &g("menu.item.save"), true, Some("CmdOrCtrl+S"))?;
    let save_as = MenuItem::with_id(&app, "save_as", &g("menu.item.saveAs"), true, Some("CmdOrCtrl+Shift+S"))?;
    let close_tab = MenuItem::with_id(&app, "close_tab", &g("menu.item.closeTab"), true, Some("CmdOrCtrl+W"))?;
    let quit_custom = MenuItem::with_id(&app, "quit_app", &g("menu.item.quit"), true, Some("CmdOrCtrl+Q"))?;
    let file_menu = Submenu::with_items(&app, &g("menu.file"), true, &[
        &new_file, &open_file, &open_folder,
        &PredefinedMenuItem::separator(&app)?,
        &save, &save_as,
        &PredefinedMenuItem::separator(&app)?,
        &close_tab,
        &PredefinedMenuItem::separator(&app)?,
        &quit_custom,
    ])?;

    let find = MenuItem::with_id(&app, "find", &g("menu.item.find"), true, Some("CmdOrCtrl+F"))?;
    let replace = MenuItem::with_id(&app, "replace", &g("menu.item.replace"), true, Some("CmdOrCtrl+H"))?;
    let select_all = MenuItem::with_id(&app, "select_all_occurrences", &g("menu.item.selectAllOccurrences"), true, Some("CmdOrCtrl+Shift+L"))?;
    let edit_undo = PredefinedMenuItem::undo(&app, Some(&g("menu.item.undo")))?;
    let edit_redo = PredefinedMenuItem::redo(&app, Some(&g("menu.item.redo")))?;
    let edit_cut = PredefinedMenuItem::cut(&app, Some(&g("menu.item.cut")))?;
    let edit_copy = PredefinedMenuItem::copy(&app, Some(&g("menu.item.copy")))?;
    let edit_paste = PredefinedMenuItem::paste(&app, Some(&g("menu.item.paste")))?;
    let edit_menu = Submenu::with_items(&app, &g("menu.edit"), true, &[
        &edit_undo, &edit_redo,
        &PredefinedMenuItem::separator(&app)?,
        &edit_cut, &edit_copy, &edit_paste,
        &PredefinedMenuItem::separator(&app)?,
        &find, &replace,
        &PredefinedMenuItem::separator(&app)?,
        &select_all,
    ])?;

    let theme_dark = MenuItem::with_id(&app, "theme_dark", &g("menu.item.theme.dark"), true, None::<&str>)?;
    let theme_light = MenuItem::with_id(&app, "theme_light", &g("menu.item.theme.light"), true, None::<&str>)?;
    let theme_load_custom = MenuItem::with_id(&app, "theme_load_custom", &g("menu.item.theme.loadCustom"), true, None::<&str>)?;
    let theme_submenu = Submenu::with_items(&app, &g("menu.theme"), true, &[
        &theme_dark, &theme_light,
        &PredefinedMenuItem::separator(&app)?,
        &theme_load_custom,
    ])?;
    let view_menu = Submenu::with_items(&app, &g("menu.view"), true, &[&theme_submenu])?;

    let lang_en = MenuItem::with_id(&app, "language_en", &g("menu.item.lang.en"), true, None::<&str>)?;
    let lang_uk = MenuItem::with_id(&app, "language_uk", &g("menu.item.lang.uk"), true, None::<&str>)?;
    let lang_es = MenuItem::with_id(&app, "language_es", &g("menu.item.lang.es"), true, None::<&str>)?;
    let lang_fr = MenuItem::with_id(&app, "language_fr", &g("menu.item.lang.fr"), true, None::<&str>)?;
    let lang_ja = MenuItem::with_id(&app, "language_ja", &g("menu.item.lang.ja"), true, None::<&str>)?;
    let lang_de = MenuItem::with_id(&app, "language_de", &g("menu.item.lang.de"), true, None::<&str>)?;
    let language_submenu = Submenu::with_items(&app, &g("menu.language"), true, &[
        &lang_en, &lang_uk, &lang_es, &lang_fr, &lang_ja, &lang_de,
    ])?;
    let ai_settings = MenuItem::with_id(&app, "ai_settings", &g("menu.item.ai"), true, None::<&str>)?;
    let settings_menu = Submenu::with_items(&app, &g("menu.settings"), true, &[
        &language_submenu,
        &PredefinedMenuItem::separator(&app)?,
        &ai_settings,
    ])?;

    let show_window = MenuItem::with_id(&app, "show_window", &g("menu.item.window.show"), true, None::<&str>)?;
    let window_menu = Submenu::with_items(&app, &g("menu.window"), true, &[&show_window])?;

    let menu = Menu::with_items(&app, &[&file_menu, &edit_menu, &view_menu, &settings_menu, &window_menu])?;
    app.set_menu(menu)?;
    Ok(())
}
