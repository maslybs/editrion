use std::sync::{Arc, Mutex};
use crate::core::process_manager::ProcessManager;

pub struct AppState {
    pub process_manager: Arc<Mutex<ProcessManager>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            process_manager: Arc::new(Mutex::new(ProcessManager::new())),
        }
    }
}
