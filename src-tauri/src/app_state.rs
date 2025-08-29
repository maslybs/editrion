use std::collections::HashMap;
use std::process::Child;
use std::sync::{Arc, Mutex};

pub struct AppState {
    pub procs: Arc<Mutex<HashMap<String, Arc<Mutex<Child>>>>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            procs: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}
