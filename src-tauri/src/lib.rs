use serde::{Deserialize, Serialize};
use std::process::Command;
use std::path::Path;
use std::fs;

#[derive(Debug, Deserialize)]
pub struct IdeTarget {
    pub id: String,
    pub name: String,
    pub r#type: String,
    pub path: String,
}

#[tauri::command]
fn sync_workspace(targets: Vec<IdeTarget>) -> Result<String, String> {
    let mut log = String::new();
    let current_dir = std::env::current_dir().map_err(|e| e.to_string())?;
    
    // Create .ai folder structure if it doesn't exist
    let ai_dir = current_dir.join(".ai");
    if !ai_dir.exists() {
        if let Err(e) = fs::create_dir_all(&ai_dir.join("skills")) {
            return Err(format!("Failed to create .ai/skills directory: {}", e));
        }
        if let Err(e) = fs::create_dir_all(&ai_dir.join("rules")) {
            return Err(format!("Failed to create .ai/rules directory: {}", e));
        }
        log.push_str("[+] Created .ai directory structure\n");
    }

    for target in targets {
        let expanded_path = shellexpand::tilde(&target.path).to_string();
        let target_path = Path::new(&expanded_path);
        
        // Ensure parent directory exists
        if let Some(parent) = target_path.parent() {
            if !parent.exists() {
                let _ = fs::create_dir_all(parent);
            }
        }

        // The source is inside our .ai folder based on type
        let source_folder = if target.r#type == "rules" {
            ai_dir.join("rules")
        } else {
            ai_dir.join("skills")
        };

        // Create junction on Windows
        #[cfg(target_os = "windows")]
        {
            // If target exists, remove it first
            if target_path.exists() {
                if target_path.is_symlink() || fs::metadata(target_path).map(|m| m.file_type().is_dir()).unwrap_or(false) {
                    let _ = fs::remove_dir_all(target_path); // Use remove_dir_all just in case it's a junction
                } else {
                    let _ = fs::remove_file(target_path);
                }
            }

            let status = Command::new("cmd")
                .args(["/c", "mklink", "/J", target_path.to_str().unwrap(), source_folder.to_str().unwrap()])
                .output();

            match status {
                Ok(output) if output.status.success() => {
                    log.push_str(&format!("[+] Synced {} to {}\n", target.name, target.path));
                }
                Ok(output) => {
                    let err = String::from_utf8_lossy(&output.stderr);
                    log.push_str(&format!("[Error] Failed to sync {}: {}\n", target.name, err));
                }
                Err(e) => {
                    log.push_str(&format!("[Error] Command failed for {}: {}\n", target.name, e));
                }
            }
        }

        #[cfg(not(target_os = "windows"))]
        {
            if target_path.exists() {
                if target_path.is_symlink() || target_path.is_dir() {
                    let _ = fs::remove_dir_all(target_path);
                } else {
                    let _ = fs::remove_file(target_path);
                }
            }

            match std::os::unix::fs::symlink(&source_folder, target_path) {
                Ok(_) => {
                    log.push_str(&format!("[+] Synced {} to {}\n", target.name, target.path));
                }
                Err(e) => {
                    log.push_str(&format!("[Error] Failed to sync {}: {}\n", target.name, e));
                }
            }
        }
    }

    Ok(log)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![sync_workspace])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
