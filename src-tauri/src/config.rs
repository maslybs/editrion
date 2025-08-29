use crate::error::{AppError, Result};

fn value_is_literal(val: &str) -> bool {
    let v = val.trim();
    if v.eq_ignore_ascii_case("true") || v.eq_ignore_ascii_case("false") { return true; }
    if v.parse::<i64>().is_ok() || v.parse::<f64>().is_ok() { return true; }
    if (v.starts_with('[') && v.ends_with(']')) || (v.starts_with('{') && v.ends_with('}')) { return true; }
    if (v.starts_with('"') && v.ends_with('"')) || (v.starts_with('\'') && v.ends_with('\'')) { return true; }
    false
}

fn update_toml_key(original: &str, key: &str, value: &str) -> String {
    let mut out = String::with_capacity(original.len() + key.len() + value.len() + 8);
    let mut replaced = false;
    for line in original.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with(key) {
            let rest = &trimmed[key.len()..];
            let mut idx = 0usize;
            let rest_bytes = rest.as_bytes();
            while idx < rest_bytes.len() && rest_bytes[idx].is_ascii_whitespace() { idx += 1; }
            if idx < rest_bytes.len() && rest_bytes[idx] == b'=' {
                out.push_str(key);
                out.push_str(" = ");
                if value_is_literal(value) { out.push_str(value.trim()); } else { out.push('"'); out.push_str(value); out.push('"'); }
                out.push('\n');
                replaced = true;
                continue;
            }
        }
        out.push_str(line);
        out.push('\n');
    }
    if !replaced {
        let mut pref = String::new();
        pref.push_str(key);
        pref.push_str(" = ");
        if value_is_literal(value) { pref.push_str(value.trim()); } else { pref.push('"'); pref.push_str(value); pref.push('"'); }
        pref.push('\n');
        pref.push_str(original);
        pref
    } else { out }
}

#[tauri::command]
pub fn codex_config_path() -> Result<String> {
    let home = std::env::var("CODEX_HOME").ok().map(std::path::PathBuf::from).or_else(|| {
        std::env::var("HOME").ok().map(|h| std::path::PathBuf::from(h).join(".codex"))
    }).ok_or_else(|| AppError::Config("HOME not set".to_string()))?;
    std::fs::create_dir_all(&home)?;
    let cfg = home.join("config.toml");
    Ok(cfg.to_string_lossy().to_string())
}

#[tauri::command]
pub fn codex_config_set(key: String, value: String) -> Result<()> {
    let path = codex_config_path()?;
    let existing = std::fs::read_to_string(&path).unwrap_or_else(|_| String::new());
    let updated = update_toml_key(&existing, &key, &value);
    std::fs::write(&path, updated)?;
    Ok(())
}
