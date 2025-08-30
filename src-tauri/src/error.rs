use serde::{Serialize, ser::Serializer};

#[derive(Debug, thiserror::Error)]
#[allow(dead_code)]
pub enum AppError {
    #[error(transparent)]
    Io(#[from] std::io::Error),

    #[error("JSON serialization/deserialization error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Tauri API error: {0}")]
    Tauri(#[from] tauri::Error),

    #[error("Command failed: {0}")]
    Command(String),

    #[error("Process not found for run_id: {0}")]
    ProcessNotFound(String),

    #[error("Could not resolve path for binary: {0}")]
    BinaryPath(String),

    #[error("Configuration error: {0}")]
    Config(String),
}

// We need to implement Serialize manually for AppError
impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, AppError>;
