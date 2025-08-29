use std::path::PathBuf;
use std::process::{Command, Stdio};

// This file will contain the logic for finding binaries, spawning processes,
// and managing their lifecycle. The tauri commands will call into these functions.

pub fn resolve_binary_path(name: &str) -> Option<PathBuf> {
    // 1) Respect ENV_VAR if set and exists
    if let Ok(p) = std::env::var(format!("{}_BIN", name.to_uppercase())) {
        let path = PathBuf::from(p);
        if path.exists() { return Some(path); }
    }

    // 2) Check app data vendor bin (cross‑platform)
    #[cfg(target_os = "windows")]
    {
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            let p = PathBuf::from(local).join("Editrion").join("bin").join(format!("{}.exe", name));
            if p.exists() { return Some(p); }
        }
    }
    #[cfg(target_os = "macos")]
    {
        if let Ok(home) = std::env::var("HOME") {
            let p = PathBuf::from(home).join("Library").join("Application Support").join("Editrion").join("bin").join(name);
            if p.exists() { return Some(p); }
        }
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let base = std::env::var("XDG_CONFIG_HOME").ok()
            .map(PathBuf::from)
            .or_else(|| std::env::var("HOME").ok().map(|h| PathBuf::from(h).join(".config")));
        if let Some(base) = base {
            let p = base.join("Editrion").join("bin").join(name);
            if p.exists() { return Some(p); }
        }
    }

    // 3) Try common locations
    let candidates = [
        format!("/opt/homebrew/bin/{}", name),
        format!("/usr/local/bin/{}", name),
        format!("/usr/bin/{}", name),
    ];
    for c in candidates { let p = PathBuf::from(c); if p.exists() { return Some(p); } }

    // 4) Try `which`
    if let Ok(out) = Command::new("which").arg(name).stdout(Stdio::piped()).output() {
        let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !s.is_empty() { let p = PathBuf::from(s); if p.exists() { return Some(p); } }
    }

    // 5) Try login shell PATH
    if let Ok(out) = Command::new("/bin/zsh").arg("-lc").arg(format!("command -v {}", name)).stdout(Stdio::piped()).output() {
        let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !s.is_empty() { let p = PathBuf::from(s); if p.exists() { return Some(p); } }
    }

    None
}

pub fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\'\''"))
}

pub fn strip_ansi(s: &str) -> String {
    String::from_utf8(strip_ansi_escapes::strip(s.as_bytes())).unwrap_or_else(|_| s.to_string())
}

