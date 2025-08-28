// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Emitter, Manager};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio, Child};
use std::time::{Duration, Instant};
use std::io::{BufRead, BufReader};

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    // Read as bytes and decode lossily to allow non-UTF8 text files
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&bytes).to_string())
}

#[tauri::command]
async fn codex_exec(prompt: String, cwd: Option<String>) -> Result<String, String> {
    // Run potentially blocking process work off the main thread to keep UI responsive
    tauri::async_runtime::spawn_blocking(move || run_codex_exec(prompt, cwd))
        .await
        .map_err(|e| format!("Failed to join codex worker: {}", e))?
}

#[tauri::command]
async fn codex_exec_stream(window: tauri::Window, prompt: String, cwd: Option<String>, run_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || run_codex_exec_stream(window, prompt, cwd, run_id))
        .await
        .map_err(|e| format!("Failed to join codex stream worker: {}", e))?
}

fn run_codex_exec_stream(window: tauri::Window, prompt: String, cwd: Option<String>, run_id: String) -> Result<(), String> {
    let spawn = || -> std::io::Result<Child> {
        let use_pty = std::env::var("CODEX_STREAM_PTY").map(|v| v != "0").unwrap_or(true);
        #[cfg(not(target_os = "windows"))]
        if use_pty {
            // Try to wrap with 'script' to allocate a PTY for faster flushes
            if let Some(codex_bin) = resolve_codex_path() {
                let mut cmd = Command::new("/usr/bin/script");
                cmd.arg("-q").arg("/dev/null");
                cmd.arg(&codex_bin).arg("exec").arg("--skip-git-repo-check").arg(&prompt);
                if let Some(ref dir) = cwd { if Path::new(dir).is_dir() { let _ = cmd.current_dir(dir); } }
                cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
                if let Ok(child) = cmd.spawn() { return Ok(child); }
            }
            // PTY via zsh login shell
            let cmdline = format!("codex exec --skip-git-repo-check {}", shell_quote(&prompt));
            let mut cmd = Command::new("/usr/bin/script");
            cmd.arg("-q").arg("/dev/null").arg("/bin/zsh").arg("-lc").arg(&cmdline);
            if let Some(ref dir) = cwd { if Path::new(dir).is_dir() { let _ = cmd.current_dir(dir); } }
            cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
            if let Ok(child) = cmd.spawn() { return Ok(child); }
        }
        // Fallback: direct spawn
        if let Some(codex_bin) = resolve_codex_path() {
            let mut cmd = Command::new(&codex_bin);
            cmd.arg("exec").arg("--skip-git-repo-check").arg(&prompt);
            if let Some(ref dir) = cwd { if Path::new(dir).is_dir() { let _ = cmd.current_dir(dir); } }
            cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
            return cmd.spawn();
        }
        // Fallback via login shell PATH
        let cmdline = format!("codex exec --skip-git-repo-check {}", shell_quote(&prompt));
        let mut cmd = Command::new("/bin/zsh");
        cmd.arg("-lc").arg(&cmdline);
        if let Some(ref dir) = cwd { if Path::new(dir).is_dir() { let _ = cmd.current_dir(dir); } }
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
        cmd.spawn()
    };

    let mut child = spawn().map_err(|e| e.to_string())?;
    use std::sync::{Arc, Mutex};
    let stdout_buf = Arc::new(Mutex::new(String::new()));
    let mut join_handles = vec![];

    if let Some(mut out) = child.stdout.take() {
        let win = window.clone();
        let rid = run_id.clone();
        let buf = stdout_buf.clone();
        let h = std::thread::spawn(move || {
            use std::io::Read;
            let mut tmp = [0u8; 2048];
            let mut acc = String::new();
            let mut ended = false;
            let mut started_content = false;
            fn is_meta_line(line: &str) -> bool {
                let ls = line.trim();
                if ls.is_empty() { return false; }
                if is_timestamp_line(ls) { return true; }
                if ls.starts_with("--------") { return true; }
                if ls.contains("OpenAI Codex") { return true; }
                let prefixes = [
                    "workdir:", "model:", "provider:", "approval:", "sandbox:",
                    "reasoning", "User instructions:", "--- INPUT START", "--- INPUT END",
                    "Return only the transformed text.",
                ];
                for p in prefixes { if ls.starts_with(p) { return true; } }
                false
            }
            let mut emit = |text: &str| {
                if text.is_empty() { return; }
                if let Ok(mut b) = buf.lock() { b.push_str(text); }
                let _ = win.emit("codex-stream", &serde_json::json!({
                    "runId": rid,
                    "channel": "stdout",
                    "data": text,
                }));
            };
            while let Ok(n) = out.read(&mut tmp) {
                if n == 0 { break; }
                let chunk = String::from_utf8_lossy(&tmp[..n]).to_string();
                if chunk.is_empty() { continue; }
                let chunk = strip_ansi(&chunk);
                acc.push_str(&chunk);
                // process complete lines; emit non-meta only after assistant marker
                loop {
                    if let Some(pos) = acc.find('\n') {
                        let line = acc[..pos].to_string();
                        // remove the processed part including the newline
                        acc.drain(..=pos);
                        if ended { continue; }
                        let ls = line.trim_start();
                        // Detect assistant phase marker and begin streaming content after it
                        if !started_content && line.contains("] codex") {
                            started_content = true;
                            continue; // do not emit the marker line
                        }
                        if ls.starts_with("tokens used:") {
                            ended = true; continue;
                        }
                        if !started_content || is_meta_line(&line) {
                            continue;
                        }
                        emit(&format!("{}\n", line));
                    } else {
                        break;
                    }
                }
                // Emit any partial tail without newline only after real content started
                if started_content && !ended && !acc.is_empty() {
                    emit(&acc);
                    acc.clear();
                }
            }
        });
        join_handles.push(h);
    }
    // Do not forward stderr to UI to avoid exposing system noise.

    let status = child.wait().map_err(|e| e.to_string())?;
    for h in join_handles { let _ = h.join(); }

    let cleaned = if let Ok(b) = stdout_buf.lock() { clean_codex_output(&b) } else { String::new() };
    if status.success() {
        let _ = window.emit("codex-complete", &serde_json::json!({
            "runId": run_id,
            "ok": true,
            "output": cleaned,
        }));
        Ok(())
    } else {
        let err_s = if let Ok(b) = stdout_buf.lock() { b.clone() } else { String::new() };
        let _ = window.emit("codex-complete", &serde_json::json!({
            "runId": run_id,
            "ok": false,
            "error": err_s,
        }));
        Err("codex exec failed".to_string())
    }
}

fn run_codex_exec(prompt: String, cwd: Option<String>) -> Result<String, String> {
    // Try running via resolved absolute path first
    if let Some(codex_bin) = resolve_codex_path() {
        match spawn_and_collect(|| {
            let mut cmd = Command::new(&codex_bin);
            cmd.arg("exec").arg("--skip-git-repo-check").arg(&prompt);
            if let Some(ref dir) = cwd { if Path::new(dir).is_dir() { let _ = cmd.current_dir(dir); } }
            cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
            cmd.spawn()
        }) {
            Ok(s) => return Ok(clean_codex_output(&s)),
            Err(e) => {
                // Fall through to zsh login shell attempt
                eprintln!("direct codex spawn failed: {}", e);
            }
        }
    }

    // Fallback: run through login shell to load NVM/Brew PATH
    let cmdline = format!("codex exec --skip-git-repo-check {}", shell_quote(&prompt));
    match spawn_and_collect(|| {
        let mut cmd = Command::new("/bin/zsh");
        cmd.arg("-lc").arg(&cmdline);
        if let Some(ref dir) = cwd { if Path::new(dir).is_dir() { let _ = cmd.current_dir(dir); } }
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
        cmd.spawn()
    }) {
        Ok(s) => Ok(clean_codex_output(&s)),
        Err(e) => {
            let path_env = std::env::var("PATH").unwrap_or_default();
            Err(format!(
                "Failed to start codex via zsh. Error: {}\nPATH: {}\nTry setting CODEX_BIN to absolute path of codex, or run 'codex' once in a terminal to sign in.",
                e, path_env
            ))
        }
    }
}

#[tauri::command]
async fn codex_login_stream(window: tauri::Window, run_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || run_codex_login_stream(window, run_id))
        .await
        .map_err(|e| format!("Failed to join codex login stream worker: {}", e))?
}

fn run_codex_login_stream(window: tauri::Window, run_id: String) -> Result<(), String> {
    let spawn = || -> std::io::Result<Child> {
        if let Some(codex_bin) = resolve_codex_path() {
            let mut cmd = Command::new(&codex_bin);
            cmd.arg("login");
            cmd.stdin(Stdio::inherit()).stdout(Stdio::piped()).stderr(Stdio::piped());
            return cmd.spawn();
        }
        let mut cmd = Command::new("/bin/zsh");
        cmd.arg("-lc").arg("codex login");
        cmd.stdin(Stdio::inherit()).stdout(Stdio::piped()).stderr(Stdio::piped());
        cmd.spawn()
    };

    let mut child = spawn().map_err(|e| e.to_string())?;
    use std::sync::{Arc, Mutex};
    let stdout_buf = Arc::new(Mutex::new(String::new()));
    let mut join_handles = vec![];

    if let Some(out) = child.stdout.take() {
        let win = window.clone();
        let rid = run_id.clone();
        let buf = stdout_buf.clone();
        let h = std::thread::spawn(move || {
            let reader = BufReader::new(out);
            let mut capture = false;
            let mut ended = false;
            for line in reader.split(b'\n') {
                match line {
                    Ok(bytes) => {
                        if ended { continue; }
                        let mut s = String::from_utf8_lossy(&bytes).to_string();
                        if s.is_empty() { continue; }
                        s = strip_ansi(&s);
                        if !capture {
                            if s.contains("] codex") { capture = true; continue; }
                            continue;
                        }
                        let ls = s.trim_start();
                        if is_timestamp_line(&s) || ls.starts_with("tokens used:") {
                            ended = true; continue;
                        }
                        if let Ok(mut b) = buf.lock() { b.push_str(&s); b.push('\n'); }
                        let _ = win.emit("codex-stream", &serde_json::json!({
                            "runId": rid,
                            "channel": "stdout",
                            "data": s,
                        }));
                    }
                    Err(_) => break,
                }
            }
        });
        join_handles.push(h);
    }
    // Don’t forward stderr to UI for login either.

    let status = child.wait().map_err(|e| e.to_string())?;
    for h in join_handles { let _ = h.join(); }

    if status.success() {
        let _ = window.emit("codex-complete", &serde_json::json!({
            "runId": run_id,
            "ok": true,
            "output": "",
        }));
        Ok(())
    } else {
        let err_s = if let Ok(b) = stdout_buf.lock() { b.clone() } else { String::new() };
        let _ = window.emit("codex-complete", &serde_json::json!({
            "runId": run_id,
            "ok": false,
            "error": err_s,
        }));
        Err("codex login failed".to_string())
    }
}

fn resolve_codex_path() -> Option<std::path::PathBuf> {
    // 1) Respect CODEX_BIN if set and exists
    if let Ok(p) = std::env::var("CODEX_BIN") {
        let path = std::path::PathBuf::from(p);
        if path.exists() { return Some(path); }
    }
    // 1.1) Check app data vendor bin (cross‑platform without tauri::api)
    #[cfg(target_os = "windows")]
    {
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            let p = std::path::PathBuf::from(local).join("Editrion").join("bin").join("codex.exe");
            if p.exists() { return Some(p); }
        }
    }
    #[cfg(target_os = "macos")]
    {
        if let Ok(home) = std::env::var("HOME") {
            let p = std::path::PathBuf::from(home).join("Library").join("Application Support").join("Editrion").join("bin").join("codex");
            if p.exists() { return Some(p); }
        }
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let base = std::env::var("XDG_CONFIG_HOME").ok()
            .map(std::path::PathBuf::from)
            .or_else(|| std::env::var("HOME").ok().map(|h| std::path::PathBuf::from(h).join(".config")));
        if let Some(base) = base {
            let p = base.join("Editrion").join("bin").join("codex");
            if p.exists() { return Some(p); }
        }
    }
    // 2) Try common locations (macOS Homebrew /usr/local)
    let candidates = [
        "/opt/homebrew/bin/codex",
        "/usr/local/bin/codex",
        "/usr/bin/codex",
    ];
    for c in candidates { let p = std::path::PathBuf::from(c); if p.exists() { return Some(p); } }
    // 3) Try `which codex`
    if let Ok(out) = Command::new("which").arg("codex").stdout(Stdio::piped()).output() {
        let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !s.is_empty() { let p = std::path::PathBuf::from(s); if p.exists() { return Some(p); } }
    }
    // 4) Try zsh login shell PATH
    if let Ok(out) = Command::new("/bin/zsh").arg("-lc").arg("command -v codex").stdout(Stdio::piped()).output() {
        let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !s.is_empty() { let p = std::path::PathBuf::from(s); if p.exists() { return Some(p); } }
    }
    None
}

fn spawn_and_collect<F>(spawn: F) -> Result<String, String>
where
    F: FnOnce() -> std::io::Result<Child>,
{
    let mut child = spawn().map_err(|e| e.to_string())?;
    let start = Instant::now();
    let timeout = Duration::from_secs(90);
    loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            let out = child.wait_with_output().map_err(|e| e.to_string())?;
            if status.success() {
                return Ok(String::from_utf8_lossy(&out.stdout).to_string());
            } else {
                let mut err = String::from_utf8_lossy(&out.stderr).to_string();
                if err.trim().is_empty() { err = String::from_utf8_lossy(&out.stdout).to_string(); }
                return Err(format!("codex exited with code {}: {}", status.code().unwrap_or(-1), err));
            }
        }
        if start.elapsed() > timeout {
            let _ = child.kill();
            return Err("codex exec timed out. Ensure you're signed in: run 'codex' in a terminal once.".to_string());
        }
        std::thread::sleep(Duration::from_millis(150));
    }
}

fn shell_quote(s: &str) -> String {
    let mut out = String::from("'");
    for ch in s.chars() {
        if ch == '\'' { out.push_str("'\\''"); } else { out.push(ch); }
    }
    out.push('\'');
    out
}

fn clean_codex_output(s: &str) -> String {
    let no_ansi = strip_ansi(s);
    let trimmed = extract_codex_result(&no_ansi);
    if trimmed.trim().is_empty() {
        no_ansi.trim().to_string()
    } else {
        trimmed.trim().to_string()
    }
}

fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut it = s.chars().peekable();
    while let Some(ch) = it.next() {
        if ch == '\u{1b}' {
            // Handle CSI sequences: ESC [ ... <alpha>
            if let Some('[') = it.peek().copied() {
                let _ = it.next(); // consume '['
                while let Some(c) = it.next() {
                    if c.is_ascii_alphabetic() { break; }
                }
                continue;
            }
            // Handle OSC sequences: ESC ] ... BEL (\u{07}) or ST (ESC \\)
            if let Some(']') = it.peek().copied() {
                let _ = it.next(); // consume ']'
                // consume until BEL or ST
                let mut prev_esc = false;
                while let Some(c) = it.next() {
                    if c == '\u{07}' { break; }
                    if prev_esc && c == '\\' { break; }
                    prev_esc = c == '\u{1b}';
                }
                continue;
            }
            // Fallback: skip until next ASCII letter
            while let Some(c) = it.next() {
                if c.is_ascii_alphabetic() { break; }
            }
        } else {
            out.push(ch);
        }
    }
    out
}

fn extract_codex_result(s: &str) -> String {
    let mut capture = false;
    let mut out = String::new();
    for line in s.lines() {
        if !capture {
            if line.contains("] codex") {
                capture = true;
                continue; // skip marker line
            }
            continue;
        } else {
            // Stop on timestamp header or tokens summary
            let ls = line.trim_start();
            if is_timestamp_line(line) || ls.starts_with("tokens used:") {
                break;
            }
            out.push_str(line);
            out.push('\n');
        }
    }
    if out.trim().is_empty() {
        // Fallback: remove timestamped lines and banner
        let mut filtered = String::new();
        for l in s.lines() {
            if is_timestamp_line(l) { continue; }
            filtered.push_str(l);
            filtered.push('\n');
        }
        return filtered;
    }
    out
}

fn is_timestamp_line(line: &str) -> bool {
    if !line.starts_with('[') { return false; }
    if let Some(end) = line.find(']') {
        let inside = &line[1..end];
        return inside.chars().take(4).all(|c| c.is_ascii_digit());
    }
    false
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
        .invoke_handler(tauri::generate_handler![read_file, write_file, read_dir, create_new_file, menu_action, quit_app, rebuild_menu, drafts_dir, remove_file, clear_dir, codex_exec, codex_exec_stream, codex_login_stream])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // Handle app-level events (e.g., Dock icon click on macOS)
    app.run(|_app_handle, event| {
        match event {
            // macOS Dock icon clicked or app re-opened when no windows are visible
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => {
                if let Some(window) = _app_handle.get_webview_window("main") {
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
