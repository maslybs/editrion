use std::collections::HashMap;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use crate::error::{Result};

// Menu configuration structures
#[derive(Debug, Clone)]
struct MenuItemConfig {
    id: &'static str,
    label_key: &'static str,
    default_label: &'static str,
    shortcut: Option<&'static str>,
}

#[derive(Debug, Clone)]
struct LanguageConfig {
    id: &'static str,
    label_key: &'static str,
}

// Helper trait for label resolution
trait LabelResolver {
    fn resolve(&self, key: &str) -> String;
}

impl<F> LabelResolver for F
where
    F: Fn(&str) -> String,
{
    fn resolve(&self, key: &str) -> String {
        self(key)
    }
}

// Menu configuration constants
const FILE_MENU_ITEMS: &[MenuItemConfig] = &[
    MenuItemConfig { id: "new_file", label_key: "menu.item.newFile", default_label: "New File", shortcut: Some("CmdOrCtrl+N") },
    MenuItemConfig { id: "open_file", label_key: "menu.item.openFile", default_label: "Open File...", shortcut: Some("CmdOrCtrl+O") },
    MenuItemConfig { id: "open_folder", label_key: "menu.item.openFolder", default_label: "Open Folder...", shortcut: None },
    MenuItemConfig { id: "save", label_key: "menu.item.save", default_label: "Save", shortcut: Some("CmdOrCtrl+S") },
    MenuItemConfig { id: "save_as", label_key: "menu.item.saveAs", default_label: "Save As…", shortcut: Some("CmdOrCtrl+Shift+S") },
    MenuItemConfig { id: "close_tab", label_key: "menu.item.closeTab", default_label: "Close Tab", shortcut: Some("CmdOrCtrl+W") },
    MenuItemConfig { id: "quit_app", label_key: "menu.item.quit", default_label: "Quit Editrion (Beta)", shortcut: Some("CmdOrCtrl+Q") },
];

const EDIT_MENU_ITEMS: &[MenuItemConfig] = &[
    MenuItemConfig { id: "find", label_key: "menu.item.find", default_label: "Find", shortcut: Some("CmdOrCtrl+F") },
    MenuItemConfig { id: "replace", label_key: "menu.item.replace", default_label: "Replace", shortcut: Some("CmdOrCtrl+H") },
    MenuItemConfig { id: "select_all_occurrences", label_key: "menu.item.selectAllOccurrences", default_label: "Select All Occurrences", shortcut: Some("CmdOrCtrl+Shift+L") },
];

const THEME_MENU_ITEMS: &[MenuItemConfig] = &[
    MenuItemConfig { id: "theme_dark", label_key: "menu.item.theme.dark", default_label: "Dark", shortcut: None },
    MenuItemConfig { id: "theme_light", label_key: "menu.item.theme.light", default_label: "Light", shortcut: None },
    MenuItemConfig { id: "theme_load_custom", label_key: "menu.item.theme.loadCustom", default_label: "Load Custom", shortcut: None },
];

const LANGUAGES: &[LanguageConfig] = &[
    LanguageConfig { id: "language_en", label_key: "menu.item.lang.en" },
    LanguageConfig { id: "language_uk", label_key: "menu.item.lang.uk" },
    LanguageConfig { id: "language_es", label_key: "menu.item.lang.es" },
    LanguageConfig { id: "language_fr", label_key: "menu.item.lang.fr" },
    LanguageConfig { id: "language_ja", label_key: "menu.item.lang.ja" },
    LanguageConfig { id: "language_de", label_key: "menu.item.lang.de" },
];

// Helper functions
fn create_menu_item<R: Runtime>(
    app: &AppHandle<R>,
    config: &MenuItemConfig,
    resolver: &impl LabelResolver,
) -> Result<MenuItem<R>> {
    let label = resolver.resolve(config.label_key);
    MenuItem::with_id(app, config.id, &label, true, config.shortcut).map_err(Into::into)
}

fn create_menu_items<R: Runtime>(
    app: &AppHandle<R>,
    configs: &[MenuItemConfig],
    resolver: &impl LabelResolver,
) -> Result<Vec<MenuItem<R>>> {
    configs
        .iter()
        .map(|config| create_menu_item(app, config, resolver))
        .collect()
}

fn create_language_items<R: Runtime>(
    app: &AppHandle<R>,
    resolver: &impl LabelResolver,
) -> Result<Vec<MenuItem<R>>> {
    LANGUAGES
        .iter()
        .map(|lang| {
            let label = resolver.resolve(lang.label_key);
            MenuItem::with_id(app, lang.id, &label, true, None::<&str>).map_err(Into::into)
        })
        .collect()
}

pub fn build_initial_menu<R: Runtime>(app: &AppHandle<R>) -> Result<Menu<R>> {
    // Simple resolver that returns default labels for all menu items
    let resolver = |key: &str| {
        // Search in all menu item configurations
        if let Some(item) = FILE_MENU_ITEMS.iter().find(|item| item.label_key == key) {
            return item.default_label.to_string();
        }
        if let Some(item) = EDIT_MENU_ITEMS.iter().find(|item| item.label_key == key) {
            return item.default_label.to_string();
        }
        if let Some(item) = THEME_MENU_ITEMS.iter().find(|item| item.label_key == key) {
            return item.default_label.to_string();
        }
        
        // Default menu labels
        match key {
            "menu.file" => "File".to_string(),
            "menu.edit" => "Edit".to_string(),
            "menu.view" => "View".to_string(),
            "menu.settings" => "Settings".to_string(),
            "menu.ai" => "AI".to_string(),
            "menu.ai.reasoning" => "Reasoning Settings".to_string(),
            "menu.ai.manageTemplates" => "Manage Templates".to_string(),
            "menu.window" => "Window".to_string(),
            "menu.theme" => "Theme".to_string(),
            "menu.language" => "Language".to_string(),
            "menu.item.resetSettings" => "Reset All Settings".to_string(),
            "menu.item.undo" => "Undo".to_string(),
            "menu.item.redo" => "Redo".to_string(),
            "menu.item.cut" => "Cut".to_string(),
            "menu.item.copy" => "Copy".to_string(),
            "menu.item.paste" => "Paste".to_string(),
            "menu.item.ai" => "AI".to_string(),
            "menu.item.window.show" => "Show Window".to_string(),
            "menu.item.lang.en" => "English".to_string(),
            "menu.item.lang.uk" => "Українська".to_string(),
            "menu.item.lang.es" => "Español".to_string(),
            "menu.item.lang.fr" => "Français".to_string(),
            "menu.item.lang.ja" => "日本語".to_string(),
            "menu.item.lang.de" => "Deutsch".to_string(),
            _ => key.to_string(),
        }
    };

    build_menu_with_resolver(app, &resolver)
}

fn build_menu_with_resolver<R: Runtime>(
    app: &AppHandle<R>,
    resolver: &impl LabelResolver,
) -> Result<Menu<R>> {
    // Build all menus
    let file_menu = build_file_menu(app, resolver)?;
    let edit_menu = build_edit_menu(app, resolver)?;
    let view_menu = build_view_menu(app, resolver)?;
    let settings_menu = build_settings_menu(app, resolver)?;
    let window_menu = build_window_menu(app, resolver)?;
    let ai_menu = build_ai_menu(app, resolver)?;

    // Create main menu
    Menu::with_items(app, &[&file_menu, &edit_menu, &view_menu, &ai_menu, &settings_menu, &window_menu])
        .map_err(Into::into)
}

fn build_file_menu<R: Runtime>(
    app: &AppHandle<R>,
    resolver: &impl LabelResolver,
) -> Result<Submenu<R>> {
    let items = create_menu_items(app, FILE_MENU_ITEMS, resolver)?;
    let file_label = resolver.resolve("menu.file");
    
    Submenu::with_items(app, &file_label, true, &[
        &items[0], &items[1], &items[2],  // new, open file, open folder
        &PredefinedMenuItem::separator(app)?,
        &items[3], &items[4],             // save, save as
        &PredefinedMenuItem::separator(app)?,
        &items[5],                        // close tab
        &PredefinedMenuItem::separator(app)?,
        &items[6],                        // quit
    ]).map_err(Into::into)
}

fn build_edit_menu<R: Runtime>(
    app: &AppHandle<R>,
    resolver: &impl LabelResolver,
) -> Result<Submenu<R>> {
    let edit_undo = PredefinedMenuItem::undo(app, Some(&resolver.resolve("menu.item.undo")))?;
    let edit_redo = PredefinedMenuItem::redo(app, Some(&resolver.resolve("menu.item.redo")))?;
    let edit_cut = PredefinedMenuItem::cut(app, Some(&resolver.resolve("menu.item.cut")))?;
    let edit_copy = PredefinedMenuItem::copy(app, Some(&resolver.resolve("menu.item.copy")))?;
    let edit_paste = PredefinedMenuItem::paste(app, Some(&resolver.resolve("menu.item.paste")))?;
    
    let edit_items = create_menu_items(app, EDIT_MENU_ITEMS, resolver)?;
    let edit_label = resolver.resolve("menu.edit");
    
    Submenu::with_items(app, &edit_label, true, &[
        &edit_undo, &edit_redo,
        &PredefinedMenuItem::separator(app)?,
        &edit_cut, &edit_copy, &edit_paste,
        &PredefinedMenuItem::separator(app)?,
        &edit_items[0], &edit_items[1],   // find, replace
        &PredefinedMenuItem::separator(app)?,
        &edit_items[2],                   // select all
    ]).map_err(Into::into)
}

fn build_view_menu<R: Runtime>(
    app: &AppHandle<R>,
    resolver: &impl LabelResolver,
) -> Result<Submenu<R>> {
    let theme_items = create_menu_items(app, THEME_MENU_ITEMS, resolver)?;
    let theme_label = resolver.resolve("menu.theme");
    
    let theme_submenu = Submenu::with_items(app, &theme_label, true, &[
        &theme_items[0], &theme_items[1], // dark, light
        &PredefinedMenuItem::separator(app)?,
        &theme_items[2],                  // load custom
    ])?;
    
    let view_label = resolver.resolve("menu.view");
    Submenu::with_items(app, &view_label, true, &[&theme_submenu])
        .map_err(Into::into)
}

fn build_settings_menu<R: Runtime>(
    app: &AppHandle<R>,
    resolver: &impl LabelResolver,
) -> Result<Submenu<R>> {
    let language_items = create_language_items(app, resolver)?;
    let language_label = resolver.resolve("menu.language");
    
    let language_refs: Vec<&dyn tauri::menu::IsMenuItem<R>> = language_items.iter().map(|item| item as &dyn tauri::menu::IsMenuItem<R>).collect();
    let language_submenu = Submenu::with_items(app, &language_label, true, language_refs.as_slice())?;

    let reset_settings = MenuItem::with_id(
        app,
        "reset_settings",
        &resolver.resolve("menu.item.resetSettings"),
        true,
        None::<&str>,
    )?;
    
    let settings_label = resolver.resolve("menu.settings");
    Submenu::with_items(app, &settings_label, true, &[&language_submenu, &PredefinedMenuItem::separator(app)?, &reset_settings]).map_err(Into::into)
}

fn build_window_menu<R: Runtime>(
    app: &AppHandle<R>,
    resolver: &impl LabelResolver,
) -> Result<Submenu<R>> {
    let show_window = MenuItem::with_id(app, "show_window",
        &resolver.resolve("menu.item.window.show"), true, None::<&str>)?;
    
    let window_label = resolver.resolve("menu.window");
    Submenu::with_items(app, &window_label, true, &[&show_window])
        .map_err(Into::into)
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
    let resolver = |k: &str| labels.get(k).cloned().unwrap_or_else(|| k.to_string());
    let menu = build_menu_with_resolver(&app, &resolver)?;
    app.set_menu(menu)?;
    Ok(())
}

fn build_ai_menu<R: Runtime>(app: &AppHandle<R>, resolver: &impl LabelResolver) -> Result<Submenu<R>> {
    let reasoning = MenuItem::with_id(app, "ai_settings", &resolver.resolve("menu.ai.reasoning"), true, None::<&str>)?;
    let manage = MenuItem::with_id(app, "ai_manage_templates", &resolver.resolve("menu.ai.manageTemplates"), true, None::<&str>)?;
    let ai_label = resolver.resolve("menu.ai");
    Submenu::with_items(app, &ai_label, true, &[&reasoning, &manage]).map_err(Into::into)
}
