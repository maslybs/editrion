// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app_state;
mod commands;
mod config;
mod core;
mod error;
mod menu;

use app_state::AppState;
use tauri::Manager;

fn main() {
    // Collect startup file paths (Windows/Linux when launched with a file)
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    let startup_paths: Vec<String> = {
        use std::path::PathBuf;
        std::env::args_os()
            .skip(1)
            .filter_map(|a| {
                let p = PathBuf::from(&a);
                if p.is_file() { Some(p.to_string_lossy().to_string()) } else { None }
            })
            .collect()
    };
    #[cfg(target_os = "macos")]
    let startup_paths: Vec<String> = Vec::new();

    let app = tauri::Builder::default()
        .manage(AppState::new_with_paths(startup_paths))
        .plugin(tauri_plugin_dialog::init())
        .on_window_event(|window, event| {
            match event {
                #[cfg(target_os = "macos")]
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = window.set_fullscreen(false);
                    let _ = window.set_simple_fullscreen(false);
                    let win = window.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_millis(120));
                        let _ = win.hide();
                    });
                }
                #[cfg(not(target_os = "macos"))]
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = window.emit("request-close", {});
                }
                _ => {}
            }
        })
        .setup(|app| {
            let menu = menu::build_initial_menu(app.handle())?;
            app.handle().set_menu(menu)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            menu::handle_menu_event(app, event);
        })
        .invoke_handler(tauri::generate_handler![
            // commands::app
            commands::app::quit_app,
            commands::app::drafts_dir,
            // commands::file_system
            commands::file_system::read_file,
            commands::file_system::write_file,
            commands::file_system::read_dir,
            commands::file_system::create_new_file,
            commands::file_system::remove_file,
            commands::file_system::clear_dir,
            // commands::external_cli
            commands::external_cli::codex_exec_stream,
            commands::external_cli::claude_exec_stream,
            commands::external_cli::codex_login_stream,
            commands::external_cli::claude_login_stream,
            commands::external_cli::codex_cancel,
            commands::external_cli::claude_cancel,
            // config
            config::codex_config_path,
            config::codex_config_set,
            // menu
            menu::rebuild_menu,
            // startup
            commands::app::startup_paths
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        match event {
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => {
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            _ => {}
        }
    });
}
