use std::collections::HashMap;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

use crate::error::{AppError, Result};

/// ProcessManager handles the lifecycle of external CLI processes
pub struct ProcessManager {
    pub processes: HashMap<String, Arc<Mutex<Child>>>,
}

#[allow(dead_code)]
impl ProcessManager {
    pub fn new() -> Self {
        Self {
            processes: HashMap::new(),
        }
    }

    /// Add a new process to management
    #[allow(dead_code)]
    pub fn add_process(&mut self, run_id: String, child: Child) {
        let child_arc = Arc::new(Mutex::new(child));
        self.processes.insert(run_id, child_arc);
    }

    /// Get a process by run_id
    #[allow(dead_code)]
    pub fn get_process(&self, run_id: &str) -> Option<Arc<Mutex<Child>>> {
        self.processes.get(run_id).cloned()
    }

    /// Cancel a process by run_id
    pub fn cancel_process(&mut self, run_id: &str) -> Result<()> {
        if let Some(child_arc) = self.processes.remove(run_id) {
            if let Ok(mut child) = child_arc.lock() {
                let _ = child.kill();
                return Ok(());
            }
        }
        Err(AppError::ProcessNotFound(run_id.to_string()))
    }

    /// Remove a completed process
    pub fn remove_process(&mut self, run_id: &str) {
        self.processes.remove(run_id);
    }

    /// Get count of active processes
    #[allow(dead_code)]
    pub fn active_count(&self) -> usize {
        self.processes.len()
    }
}

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

#[allow(dead_code)]
pub fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\'\''"))
}

pub fn strip_ansi(s: &str) -> String {
    String::from_utf8(strip_ansi_escapes::strip(s.as_bytes())).unwrap_or_else(|_| s.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::{Command, Stdio};

    #[test]
    fn test_process_manager_new() {
        let manager = ProcessManager::new();
        assert_eq!(manager.active_count(), 0);
    }

    #[test]
    fn test_process_manager_add_and_remove() {
        let mut manager = ProcessManager::new();
        
        // Create a simple child process (sleep command)
        let child = Command::new("sleep")
            .arg("10")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("Failed to start sleep process");

        manager.add_process("test_id".to_string(), child);
        assert_eq!(manager.active_count(), 1);
        assert!(manager.get_process("test_id").is_some());

        manager.remove_process("test_id");
        assert_eq!(manager.active_count(), 0);
        assert!(manager.get_process("test_id").is_none());
    }

    #[test]
    fn test_process_manager_cancel() {
        let mut manager = ProcessManager::new();
        
        // Create a child process
        let child = Command::new("sleep")
            .arg("10")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("Failed to start sleep process");

        manager.add_process("test_cancel".to_string(), child);
        assert_eq!(manager.active_count(), 1);

        // Cancel the process
        let result = manager.cancel_process("test_cancel");
        assert!(result.is_ok());
        assert_eq!(manager.active_count(), 0);
    }

    #[test]
    fn test_process_manager_cancel_nonexistent() {
        let mut manager = ProcessManager::new();
        let result = manager.cancel_process("nonexistent");
        assert!(result.is_err());
        if let Err(AppError::ProcessNotFound(id)) = result {
            assert_eq!(id, "nonexistent");
        } else {
            panic!("Expected ProcessNotFound error");
        }
    }

    #[test]
    fn test_shell_quote() {
        assert_eq!(shell_quote("hello"), "'hello'");
        assert_eq!(shell_quote("hello world"), "'hello world'");
        assert_eq!(shell_quote("it's working"), "'it'\\'''s working'");
        assert_eq!(shell_quote(""), "''");
    }

    #[test]
    fn test_strip_ansi() {
        // Test normal string
        assert_eq!(strip_ansi("hello world"), "hello world");
        
        // Test string with ANSI escape codes
        let ansi_string = "\x1b[31mRed text\x1b[0m";
        let clean = strip_ansi(ansi_string);
        assert!(!clean.contains("\x1b"));
        assert!(clean.contains("Red text"));
    }

    #[test]
    fn test_resolve_binary_path() {
        // Test with a binary that likely exists on most systems
        let result = resolve_binary_path("sh");
        assert!(result.is_some());
        
        // Test with nonexistent binary
        let result = resolve_binary_path("definitely_nonexistent_binary_12345");
        assert!(result.is_none());
    }
}
