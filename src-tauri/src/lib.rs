use std::sync::Mutex;
use tauri::State;

struct NodeIdState {
    id: Mutex<String>,
}

#[tauri::command]
fn get_hardware_node_id(state: State<NodeIdState>) -> String {
    let guard = state.id.lock().unwrap();
    guard.clone()
}

fn resolve_node_id() -> String {
    if let Ok(name) = gethostname::gethostname().into_string() {
        if !name.is_empty() {
            return name;
        }
    }
    "PC-01".to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let node_id = resolve_node_id();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        // The dialog plugin grants the fs scope for whatever path the user picks,
        // so exports need no pre-declared directory permissions.
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(NodeIdState {
            id: Mutex::new(node_id),
        })
        .invoke_handler(tauri::generate_handler![get_hardware_node_id])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
