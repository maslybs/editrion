use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, State, Window};

use crate::app_state::AppState;
use crate::core::process_manager::{resolve_binary_path, shell_quote, strip_ansi};
use crate::error::{AppError, Result};

#[tauri::command]
pub async fn codex_exec_stream(
    state: State<'_, AppState>,
    window: Window,
    prompt: String,
    cwd: Option<String>,
    run_id: String,
    model: Option<String>,
    config: Option<HashMap<String, String>>,
) -> Result<()> {
    let procs_map = state.procs.clone();
    tauri::async_runtime::spawn_blocking(move || {
        run_external_cli_stream(
            procs_map,
            window,
            "codex",
            prompt,
            cwd,
            run_id,
            model,
            config,
        )
    })
    .await
    .map_err(|e| AppError::Command(format!("Failed to join codex stream worker: {}", e)))?
}

#[tauri::command]
pub async fn claude_exec_stream(
    state: State<'_, AppState>,
    window: Window,
    prompt: String,
    cwd: Option<String>,
    run_id: String,
    model: Option<String>,
    config: Option<HashMap<String, String>>,
) -> Result<()> {
    let procs_map = state.procs.clone();
    tauri::async_runtime::spawn_blocking(move || {
        run_external_cli_stream(
            procs_map,
            window,
            "claude",
            prompt,
            cwd,
            run_id,
            model,
            config,
        )
    })
    .await
    .map_err(|e| AppError::Command(format!("Failed to join claude stream worker: {}", e)))?
}

#[tauri::command]
pub async fn codex_login_stream(window: Window, run_id: String) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || run_external_cli_login_stream(window, "codex", run_id))
        .await
        .map_err(|e| AppError::Command(format!("Failed to join codex login worker: {}", e)))?
}

#[tauri::command]
pub async fn claude_login_stream(window: Window, run_id: String) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || run_external_cli_login_stream(window, "claude", run_id))
        .await
        .map_err(|e| AppError::Command(format!("Failed to join claude login worker: {}", e)))?
}

#[tauri::command]
pub fn codex_cancel(state: State<'_, AppState>, run_id: String) -> Result<()> {
    cancel_process(state, run_id)
}

#[tauri::command]
pub fn claude_cancel(state: State<'_, AppState>, run_id: String) -> Result<()> {
    cancel_process(state, run_id)
}

fn cancel_process(state: State<'_, AppState>, run_id: String) -> Result<()> {
    if let Ok(map) = state.procs.lock() {
        if let Some(child_arc) = map.get(&run_id) {
            if let Ok(mut child) = child_arc.lock() {
                let _ = child.kill();
                return Ok(());
            }
        }
    }
    Err(AppError::ProcessNotFound(run_id))
}

fn run_external_cli_stream(
    procs_map: Arc<Mutex<HashMap<String, Arc<Mutex<Child>>>>>,
    window: Window,
    cli_name: &str,
    prompt: String,
    cwd: Option<String>,
    run_id: String,
    model: Option<String>,
    config: Option<HashMap<String, String>>,
) -> Result<()> {
    let spawn = || -> std::io::Result<Child> {
        let mut pre_flags: Vec<String> = Vec::new();
        if let Some(m) = model.as_ref() {
            pre_flags.push("--model".into());
            pre_flags.push(m.clone());
        }
        if let Some(cfg) = config.as_ref() {
            for (k, v) in cfg.iter() {
                pre_flags.push("-c".into());
                pre_flags.push(format!("{}={}", k, v));
            }
        }

        if let Some(bin_path) = resolve_binary_path(cli_name) {
            let mut cmd = Command::new(&bin_path);
            cmd.arg("exec").arg("--skip-git-repo-check");
            for a in &pre_flags {
                cmd.arg(a);
            }
            cmd.arg(&prompt);
            if let Some(ref dir) = cwd {
                if Path::new(dir).is_dir() {
                    let _ = cmd.current_dir(dir);
                }
            }
            cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
            return cmd.spawn();
        }

        // Fallback via login shell PATH
        let flags = if pre_flags.is_empty() {
            String::new()
        } else {
            format!("{} ", pre_flags.join(" "))
        };
        let cmdline = format!(
            "{} exec --skip-git-repo-check {}{}",
            cli_name,
            flags,
            shell_quote(&prompt)
        );
        let mut cmd = Command::new("/bin/zsh");
        cmd.arg("-lc").arg(&cmdline);
        if let Some(ref dir) = cwd {
            if Path::new(dir).is_dir() {
                let _ = cmd.current_dir(dir);
            }
        }
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
        cmd.spawn()
    };

    let child = spawn().map_err(AppError::Io)?;
    let child_arc = Arc::new(Mutex::new(child));

    {
        if let Ok(mut m) = procs_map.lock() {
            m.insert(run_id.clone(), child_arc.clone());
        }
    }

    let stdout_buf = Arc::new(Mutex::new(String::new()));
    let mut join_handles = vec![];

    let mut out = { child_arc.lock().ok().and_then(|mut c| c.stdout.take()) };
    if let Some(out) = out.take() {
        let win = window.clone();
        let rid = run_id.clone();
        let buf = stdout_buf.clone();
        let stream_event_name = format!("{}-stream", cli_name);

        let h = std::thread::spawn(move || {
            let reader = BufReader::new(out);
            for line in reader.lines() {
                if let Ok(line) = line {
                    let cleaned_line = strip_ansi(&line);
                    if let Ok(mut b) = buf.lock() {
                        b.push_str(&cleaned_line);
                        b.push('\n');
                    }
                    let _ = win.emit(&stream_event_name, &serde_json::json!({
                        "runId": rid,
                        "channel": "stdout",
                        "data": format!("{}\n", cleaned_line),
                    }));
                }
            }
        });
        join_handles.push(h);
    }

    let mut err = { child_arc.lock().ok().and_then(|mut c| c.stderr.take()) };
    if let Some(err) = err.take() {
        let buf = stdout_buf.clone();
        let h = std::thread::spawn(move || {
            let reader = BufReader::new(err);
            for line in reader.lines() {
                if let Ok(line) = line {
                    if let Ok(mut b) = buf.lock() {
                        b.push_str(&strip_ansi(&line));
                        b.push('\n');
                    }
                }
            }
        });
        join_handles.push(h);
    }

    let status = {
        child_arc
            .lock()
            .map_err(|e| AppError::Command(e.to_string()))?
            .wait()
            .map_err(AppError::Io)?
    };
    for h in join_handles {
        let _ = h.join();
    }

    if let Ok(mut m) = procs_map.lock() {
        m.remove(&run_id);
    }

    let output_text = if let Ok(b) = stdout_buf.lock() {
        b.clone()
    } else {
        String::new()
    };
    
    let complete_event_name = format!("{}-complete", cli_name);

    if status.success() {
        let _ = window.emit(&complete_event_name, &serde_json::json!({
            "runId": run_id,
            "ok": true,
            "output": output_text,
        }));
        Ok(())
    } else {
        let _ = window.emit(&complete_event_name, &serde_json::json!({
            "runId": run_id,
            "ok": false,
            "error": output_text,
        }));
        Err(AppError::Command(format!("{} exec failed", cli_name)))
    }
}

fn run_external_cli_login_stream(window: Window, cli_name: &str, run_id: String) -> Result<()> {
    let spawn = || -> std::io::Result<Child> {
        if let Some(bin_path) = resolve_binary_path(cli_name) {
            let mut cmd = Command::new(&bin_path);
            cmd.arg("login");
            cmd.stdin(Stdio::inherit()).stdout(Stdio::piped()).stderr(Stdio::piped());
            return cmd.spawn();
        }
        let mut cmd = Command::new("/bin/zsh");
        cmd.arg("-lc").arg(format!("{} login", cli_name));
        cmd.stdin(Stdio::inherit()).stdout(Stdio::piped()).stderr(Stdio::piped());
        cmd.spawn()
    };

    let mut child = spawn().map_err(AppError::Io)?;
    let stdout_buf = Arc::new(Mutex::new(String::new()));
    let mut join_handles = vec![];

    if let Some(out) = child.stdout.take() {
        let win = window.clone();
        let rid = run_id.clone();
        let buf = stdout_buf.clone();
        let stream_event_name = format!("{}-stream", cli_name);
        
        let h = std::thread::spawn(move || {
            let reader = BufReader::new(out);
            for line in reader.lines() {
                if let Ok(line) = line {
                    let cleaned = strip_ansi(&line);
                     if let Ok(mut b) = buf.lock() { b.push_str(&cleaned); b.push('\n'); }
                    let _ = win.emit(&stream_event_name, &serde_json::json!({
                        "runId": rid,
                        "channel": "stdout",
                        "data": format!("{}\n", cleaned),
                    }));
                }
            }
        });
        join_handles.push(h);
    }
    
    let status = child.wait().map_err(AppError::Io)?;
    for h in join_handles { let _ = h.join(); }

    let output = if let Ok(b) = stdout_buf.lock() { b.clone() } else { String::new() };
    let complete_event_name = format!("{}-complete", cli_name);

    if status.success() {
        let _ = window.emit(&complete_event_name, &serde_json::json!({
            "runId": run_id,
            "ok": true,
            "output": output,
        }));
        Ok(())
    } else {
        let _ = window.emit(&complete_event_name, &serde_json::json!({
            "runId": run_id,
            "ok": false,
            "error": output,
        }));
        Err(AppError::Command(format!("{} login failed", cli_name)))
    }
}
