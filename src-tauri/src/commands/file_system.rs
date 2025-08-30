use crate::error::{AppError, Result};

#[tauri::command]
pub fn read_file(path: String) -> Result<String> {
    let bytes = std::fs::read(&path).map_err(|e| AppError::Io(e))?;
    Ok(String::from_utf8_lossy(&bytes).to_string())
}

#[tauri::command]
pub fn write_file(path: String, content: String) -> Result<()> {
    std::fs::write(path, content)?;
    Ok(())
}

#[tauri::command]
pub fn read_dir(path: String) -> Result<Vec<serde_json::Value>> {
    let mut entries = Vec::new();
    let dir = std::fs::read_dir(path)?;

    for entry in dir {
        let entry = entry?;
        let metadata = entry.metadata()?;
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
pub fn create_new_file() -> Result<String> {
    let temp_name = format!("Untitled-{}", std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap().as_secs());
    Ok(temp_name)
}

#[tauri::command]
pub fn remove_file(path: String) -> Result<()> {
    match std::fs::remove_file(&path) {
        Ok(_) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}

#[tauri::command]
pub fn clear_dir(path: String) -> Result<()> {
    match std::fs::remove_dir_all(&path) {
        Ok(_) => {},
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {},
        Err(e) => return Err(e.into()),
    }
    std::fs::create_dir_all(&path)?;
    Ok(())
}
