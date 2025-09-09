use std::sync::{Arc, Mutex};
use crate::core::process_manager::ProcessManager;

pub struct AppState {
    pub process_manager: Arc<Mutex<ProcessManager>>,
    pub startup_paths: Vec<String>,
}

impl AppState {
    pub fn new_with_paths(paths: Vec<String>) -> Self {
        Self {
            process_manager: Arc::new(Mutex::new(ProcessManager::new())),
            startup_paths: paths,
        }
    }
}
