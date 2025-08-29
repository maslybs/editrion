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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_value_is_literal_boolean() {
        assert!(value_is_literal("true"));
        assert!(value_is_literal("false"));
        assert!(value_is_literal("True"));
        assert!(value_is_literal("FALSE"));
    }

    #[test]
    fn test_value_is_literal_numbers() {
        assert!(value_is_literal("42"));
        assert!(value_is_literal("-123"));
        assert!(value_is_literal("3.14"));
        assert!(value_is_literal("-0.5"));
    }

    #[test]
    fn test_value_is_literal_strings() {
        assert!(value_is_literal("\"hello\""));
        assert!(value_is_literal("'world'"));
        assert!(!value_is_literal("hello"));
        assert!(!value_is_literal("world"));
    }

    #[test]
    fn test_value_is_literal_arrays_objects() {
        assert!(value_is_literal("[1, 2, 3]"));
        assert!(value_is_literal("{\"key\": \"value\"}"));
        assert!(!value_is_literal("[1, 2"));
        // {key} starts and ends with braces, so it's considered literal by our function
        assert!(value_is_literal("{key}"));
    }

    #[test]
    fn test_update_toml_key_new_key() {
        let original = "existing_key = \"value\"";
        let result = update_toml_key(original, "new_key", "new_value");
        assert!(result.contains("new_key = \"new_value\""));
        assert!(result.contains("existing_key = \"value\""));
    }

    #[test]
    fn test_update_toml_key_update_existing() {
        let original = "key1 = \"old_value\"\nkey2 = 42";
        let result = update_toml_key(original, "key1", "new_value");
        assert!(result.contains("key1 = \"new_value\""));
        assert!(result.contains("key2 = 42"));
        assert!(!result.contains("old_value"));
    }

    #[test]
    fn test_update_toml_key_literal_values() {
        let original = "";
        let result = update_toml_key(original, "bool_key", "true");
        assert!(result.contains("bool_key = true"));
        
        let result = update_toml_key(original, "num_key", "42");
        assert!(result.contains("num_key = 42"));
    }
}
