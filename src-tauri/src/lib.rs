use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

const CREATE_NO_WINDOW: u32 = 0x08000000;

// ── Data Structures ──────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct Config {
    pub repo_root: Option<String>,
    pub linked_agents: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AgentTarget {
    pub id: String,
    pub name: String,
    pub content_type: String,
    pub path: String,
    pub backend: String,
    pub available: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Item {
    pub name: String,
    pub enabled: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ItemMove {
    pub content_type: String,
    pub name: String,
    pub enabled: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SyncResult {
    pub log: String,
    pub moved_count: usize,
    pub has_errors: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct Profile {
    pub name: String,
    pub skills: Vec<String>,
    pub rules: Vec<String>,
    pub plugins: Vec<String>,
    pub mcps: Vec<String>,
}

// ── Constants ────────────────────────────────────────────────────

const CONTENT_TYPES: &[&str] = &["skills", "rules", "plugins", "mcps"];
const CONTENT_LABELS: &[(&str, &str)] = &[
    ("skills", "Skills"),
    ("rules", "Rules"),
    ("plugins", "Plugins"),
    ("mcps", "MCPs"),
];

// ── Helpers ──────────────────────────────────────────────────────

fn app_config_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".ai")
}

fn config_file_path() -> PathBuf {
    app_config_dir().join("config.json")
}

fn content_label(ct: &str) -> &str {
    CONTENT_LABELS
        .iter()
        .find(|(t, _)| *t == ct)
        .map(|(_, l)| *l)
        .unwrap_or(ct)
}

fn expanded_path(p: &str) -> PathBuf {
    PathBuf::from(shellexpand::tilde(p).as_ref())
}

// ── Config Persistence ───────────────────────────────────────────

fn load_config_from_disk() -> Config {
    let path = config_file_path();
    if !path.exists() {
        return Config::default();
    }
    match fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_default(),
        Err(_) => Config::default(),
    }
}

fn save_config_to_disk(repo_root: &Option<String>, linked_agents: &[String]) -> Result<(), String> {
    let config = Config {
        repo_root: repo_root.clone(),
        linked_agents: linked_agents.to_vec(),
    };
    let dir = app_config_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create config dir: {}", e))?;
    let json = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    fs::write(config_file_path(), json)
        .map_err(|e| format!("Failed to write config: {}", e))
}

// ── Repo Paths ───────────────────────────────────────────────────

fn repo_root() -> Option<String> {
    load_config_from_disk().repo_root
}

fn enabled_dir(repo: &str, content_type: &str) -> PathBuf {
    PathBuf::from(repo).join(content_type).join("enabled")
}

fn disabled_dir(repo: &str, content_type: &str) -> PathBuf {
    PathBuf::from(repo).join(content_type).join("disabled")
}

fn all_enabled_dirs(repo: &str) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = CONTENT_TYPES
        .iter()
        .map(|ct| enabled_dir(repo, ct))
        .collect();
    // legacy enabled dir
    dirs.push(PathBuf::from(repo).join("enabled"));
    dirs
}

// ── Repo Init & Migration ────────────────────────────────────────

fn init_repo(repo: &str) -> Result<(), String> {
    for ct in CONTENT_TYPES {
        fs::create_dir_all(enabled_dir(repo, ct))
            .map_err(|e| format!("Failed to create {} enabled dir: {}", ct, e))?;
        fs::create_dir_all(disabled_dir(repo, ct))
            .map_err(|e| format!("Failed to create {} disabled dir: {}", ct, e))?;
    }

    // Migrate legacy enabled/disabled at root to skills/
    let legacy_enabled = PathBuf::from(repo).join("enabled");
    let legacy_disabled = PathBuf::from(repo).join("disabled");
    migrate_legacy_dir(&legacy_enabled, &enabled_dir(repo, "skills"));
    migrate_legacy_dir(&legacy_disabled, &disabled_dir(repo, "skills"));

    // Migrate loose items from repo root into skills/enabled
    if let Ok(entries) = fs::read_dir(repo) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if CONTENT_TYPES.contains(&name_str.as_ref())
                || name_str == "enabled"
                || name_str == "disabled"
                || name_str == "config.json"
            {
                continue;
            }
            let dest = enabled_dir(repo, "skills").join(&name);
            let _ = fs::rename(entry.path(), &dest);
        }
    }

    Ok(())
}

fn migrate_legacy_dir(source: &Path, dest: &Path) {
    if !source.is_dir() {
        return;
    }
    // If they're the same real path, skip
    if let (Ok(s), Ok(d)) = (source.canonicalize(), dest.canonicalize()) {
        if s == d {
            return;
        }
    }
    let _ = fs::create_dir_all(dest);
    if let Ok(entries) = fs::read_dir(source) {
        for entry in entries.flatten() {
            let _ = fs::rename(entry.path(), dest.join(entry.file_name()));
        }
    }
    let _ = fs::remove_dir(source);
}

// ── Target Definitions ───────────────────────────────────────────

fn all_targets() -> Vec<AgentTarget> {
    let home = dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    vec![
        AgentTarget {
            id: "gemini-main".into(),
            name: "Gemini CLI (Main)".into(),
            content_type: "skills".into(),
            path: format!("{}/.gemini/antigravity/skills", home),
            backend: "local".into(),
            available: false,
        },
        AgentTarget {
            id: "gemini-ext".into(),
            name: "Gemini CLI (Extension)".into(),
            content_type: "skills".into(),
            path: format!("{}/.gemini/extensions/superpowers/skills", home),
            backend: "local".into(),
            available: false,
        },
        AgentTarget {
            id: "cursor-skills".into(),
            name: "Cursor Skills".into(),
            content_type: "skills".into(),
            path: format!("{}/.cursor/skills", home),
            backend: "local".into(),
            available: false,
        },
        AgentTarget {
            id: "cursor-rules".into(),
            name: "Cursor Rules".into(),
            content_type: "rules".into(),
            path: format!("{}/.cursor/rules", home),
            backend: "local".into(),
            available: false,
        },
        AgentTarget {
            id: "wsl-cursor-skills".into(),
            name: "WSL Cursor Skills".into(),
            content_type: "skills".into(),
            path: "~/.cursor/skills".into(),
            backend: "wsl".into(),
            available: false,
        },
        AgentTarget {
            id: "wsl-cursor-rules".into(),
            name: "WSL Cursor Rules".into(),
            content_type: "rules".into(),
            path: "~/.cursor/rules".into(),
            backend: "wsl".into(),
            available: false,
        },
        AgentTarget {
            id: "wsl-gemini-main".into(),
            name: "WSL Gemini CLI (Main)".into(),
            content_type: "skills".into(),
            path: "~/.gemini/antigravity/skills".into(),
            backend: "wsl".into(),
            available: false,
        },
        AgentTarget {
            id: "wsl-gemini-ext".into(),
            name: "WSL Gemini CLI (Extension)".into(),
            content_type: "skills".into(),
            path: "~/.gemini/extensions/superpowers/skills".into(),
            backend: "wsl".into(),
            available: false,
        },
        AgentTarget {
            id: "claude".into(),
            name: "Claude CLI".into(),
            content_type: "skills".into(),
            path: format!("{}/.claude/skills", home),
            backend: "local".into(),
            available: false,
        },
        AgentTarget {
            id: "trae-skills".into(),
            name: "Trae Skills".into(),
            content_type: "skills".into(),
            path: format!("{}/.trae/skills", home),
            backend: "local".into(),
            available: false,
        },
        AgentTarget {
            id: "trae-rules".into(),
            name: "Trae Rules".into(),
            content_type: "rules".into(),
            path: format!("{}/.trae/rules", home),
            backend: "local".into(),
            available: false,
        },
        AgentTarget {
            id: "qoder".into(),
            name: "Qoder Skills".into(),
            content_type: "skills".into(),
            path: format!("{}/.qoder/skills", home),
            backend: "local".into(),
            available: false,
        },
        AgentTarget {
            id: "codex".into(),
            name: "Codex Skills".into(),
            content_type: "skills".into(),
            path: format!("{}/.codex/skills", home),
            backend: "local".into(),
            available: false,
        },
        AgentTarget {
            id: "astrbot".into(),
            name: "AstrBot Skills".into(),
            content_type: "skills".into(),
            path: format!("{}/.astrbot/data/skills", home),
            backend: "local".into(),
            available: false,
        },
        AgentTarget {
            id: "zcode".into(),
            name: "ZCode Agents".into(),
            content_type: "skills".into(),
            path: format!("{}/.zcode/agents", home),
            backend: "local".into(),
            available: false,
        },
        AgentTarget {
            id: "lmstudio".into(),
            name: "LM Studio Plugins".into(),
            content_type: "plugins".into(),
            path: format!("{}/.lmstudio/extensions/plugins", home),
            backend: "local".into(),
            available: false,
        },
        AgentTarget {
            id: "deepseek-tui-skills".into(),
            name: "DeepSeek TUI Skills".into(),
            content_type: "skills".into(),
            path: format!("{}/.deepseek/skills", home),
            backend: "local".into(),
            available: false,
        },
        AgentTarget {
            id: "deepseek-tui-rules".into(),
            name: "DeepSeek TUI Rules".into(),
            content_type: "rules".into(),
            path: format!("{}/.deepseek/rules", home),
            backend: "local".into(),
            available: false,
        },
        AgentTarget {
            id: "windsurf-skills".into(),
            name: "Windsurf Skills".into(),
            content_type: "skills".into(),
            path: format!("{}/.windsurf/skills", home),
            backend: "local".into(),
            available: false,
        },
        AgentTarget {
            id: "continue-skills".into(),
            name: "Continue Skills".into(),
            content_type: "skills".into(),
            path: format!("{}/.continue/skills", home),
            backend: "local".into(),
            available: false,
        },
        AgentTarget {
            id: "continue-rules".into(),
            name: "Continue Rules".into(),
            content_type: "rules".into(),
            path: format!("{}/.continue/rules", home),
            backend: "local".into(),
            available: false,
        },
    ]
}

// ── WSL Helpers ──────────────────────────────────────────────────

static CACHED_WSL_AVAILABLE: OnceLock<bool> = OnceLock::new();

#[cfg(target_os = "windows")]
fn wsl_available() -> bool {
    *CACHED_WSL_AVAILABLE.get_or_init(|| {
        Command::new("where")
            .creation_flags(CREATE_NO_WINDOW)
            .arg("wsl.exe")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    })
}

#[cfg(not(target_os = "windows"))]
fn wsl_available() -> bool {
    false
}

#[cfg(target_os = "windows")]
fn run_wsl(args: &[&str]) -> Result<std::process::Output, String> {
    Command::new("wsl.exe")
        .creation_flags(CREATE_NO_WINDOW)
        .args(args)
        .output()
        .map_err(|e| format!("wsl error: {}", e))
}

#[cfg(target_os = "windows")]
fn run_wsl_shell(cmd: &str) -> Result<std::process::Output, String> {
    run_wsl(&["sh", "-lc", cmd])
}

#[cfg(target_os = "windows")]
fn windows_to_wsl_path(win_path: &str) -> Result<String, String> {
    let expanded = shellexpand::tilde(win_path).to_string();
    let abs = std::path::absolute(&expanded)
        .map_err(|e| format!("path error: {}", e))?;
    let output = run_wsl(&["wslpath", "-a", "-u", abs.to_str().unwrap_or(&expanded)])?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        // Fallback: manual drive letter conversion
        let s = abs.to_string_lossy();
        if s.len() >= 2 && s.as_bytes().get(1) == Some(&b':') {
            let drive = s[..1].to_lowercase();
            let tail = s[2..].replace('\\', "/");
            Ok(format!("/mnt/{}{}", drive, tail))
        } else {
            Ok(s.to_string())
        }
    }
}

#[cfg(target_os = "windows")]
fn wsl_path_exists_or_link(unix_path: &str) -> bool {
    run_wsl_shell(&format!("test -e {} || test -L {}", shlex_quote(unix_path), shlex_quote(unix_path)))
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[cfg(target_os = "windows")]
fn wsl_realpath(unix_path: &str) -> Result<String, String> {
    let output = run_wsl_shell(&format!("realpath -m {}", shlex_quote(unix_path)))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err("wsl realpath failed".into())
    }
}

#[cfg(target_os = "windows")]
fn shlex_quote(s: &str) -> String {
    // Simple shell quoting for WSL
    if s == "~" {
        return "$HOME".to_string();
    } else if let Some(stripped) = s.strip_prefix("~/") {
        return format!("$HOME/'{}'", stripped.replace('\'', "'\\''"));
    }
    format!("'{}'", s.replace('\'', "'\\''"))
}

// ── Link Management ──────────────────────────────────────────────

#[cfg(target_os = "windows")]
fn create_junction(target: &Path, source: &Path) -> Result<(), String> {
    let parent = target.parent().unwrap_or(Path::new("."));
    fs::create_dir_all(parent)
        .map_err(|e| format!("Failed to create parent dir: {}", e))?;
    let output = Command::new("cmd")
        .creation_flags(CREATE_NO_WINDOW)
        .arg("/c")
        .raw_arg(format!("chcp 65001 > nul && mklink /J \"{}\" \"{}\"",
            target.to_str().ok_or("invalid target path")?,
            source.to_str().ok_or("invalid source path")?))
        .output()
        .map_err(|e| format!("mklink error: {}", e))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[cfg(not(target_os = "windows"))]
fn create_symlink(target: &Path, source: &Path) -> Result<(), String> {
    let parent = target.parent().unwrap_or(Path::new("."));
    fs::create_dir_all(parent)
        .map_err(|e| format!("Failed to create parent dir: {}", e))?;
    std::os::unix::fs::symlink(source, target)
        .map_err(|e| format!("symlink error: {}", e))
}

fn create_directory_link(target: &Path, source: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    { create_junction(target, source) }
    #[cfg(not(target_os = "windows"))]
    { create_symlink(target, source) }
}

#[cfg(target_os = "windows")]
fn remove_link(target: &Path) -> Result<(), String> {
    Command::new("cmd")
        .creation_flags(CREATE_NO_WINDOW)
        .arg("/c")
        .raw_arg(format!("chcp 65001 > nul && rmdir \"{}\"", target.to_str().ok_or("invalid path")?))
        .output()
        .map_err(|e| format!("rmdir error: {}", e))?;
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn remove_link(target: &Path) -> Result<(), String> {
    if target.is_dir() && !target.is_symlink() {
        fs::remove_dir(target).map_err(|e| format!("remove_dir error: {}", e))
    } else {
        fs::remove_file(target).map_err(|e| format!("remove_file error: {}", e))
    }
}

fn is_managed_link(target: &Path, repo: &str) -> bool {
    if !target.exists() && !target.is_symlink() {
        return false;
    }
    let target_real = match target.canonicalize() {
        Ok(p) => p,
        Err(_) => return false,
    };
    for ed in all_enabled_dirs(repo) {
        if let Ok(ed_real) = ed.canonicalize() {
            if target_real.starts_with(&ed_real) {
                return true;
            }
        }
    }
    false
}

#[cfg(target_os = "windows")]
fn is_wsl_managed_link(unix_target: &str, repo: &str) -> bool {
    if !wsl_path_exists_or_link(unix_target) {
        return false;
    }
    let target_real = match wsl_realpath(unix_target) {
        Ok(p) => p,
        Err(_) => return false,
    };
    for ed in all_enabled_dirs(repo) {
        if let Ok(wsl_ed) = windows_to_wsl_path(ed.to_str().unwrap_or("")) {
            if let Ok(wsl_ed_real) = wsl_realpath(&wsl_ed) {
                if target_real.starts_with(&wsl_ed_real) {
                    return true;
                }
            }
        }
    }
    false
}

#[cfg(target_os = "windows")]
fn backup_existing(target: &Path) -> Result<String, String> {
    let ts = chrono::Local::now().format("%Y%m%d%H%M%S").to_string();
    let backup = format!("{}.bak_{}", target.to_string_lossy(), ts);
    fs::rename(target, &backup)
        .map_err(|e| format!("backup failed: {}", e))?;
    Ok(backup)
}

#[cfg(not(target_os = "windows"))]
fn backup_existing(target: &Path) -> Result<String, String> {
    let ts = chrono::Local::now().format("%Y%m%d%H%M%S").to_string();
    let backup = format!("{}.bak_{}", target.to_string_lossy(), ts);
    fs::rename(target, &backup)
        .map_err(|e| format!("backup failed: {}", e))?;
    Ok(backup)
}

#[cfg(target_os = "windows")]
fn backup_existing_wsl(unix_target: &str) -> Result<String, String> {
    let ts = chrono::Local::now().format("%Y%m%d%H%M%S").to_string();
    let backup = format!("{}.bak_{}", unix_target, ts);
    run_wsl_shell(&format!("mv {} {}", shlex_quote(unix_target), shlex_quote(&backup)))?;
    Ok(backup)
}

// ── Availability Scan ────────────────────────────────────────────

fn scan_available_targets() -> Vec<AgentTarget> {
    let mut targets = all_targets();

    // 只检查一次 WSL 是否可用（缓存），不逐个调 wsl.exe 查目录
    let wsl_ok = wsl_available();

    for t in &mut targets {
        if t.backend == "wsl" {
            t.available = wsl_ok;
        } else {
            let parent = expanded_path(&t.path)
                .parent()
                .map(|p| p.to_path_buf())
                .unwrap_or_else(|| PathBuf::from("."));
            t.available = parent.exists();
        }
    }
    targets
}

fn scan_items(repo: &str, content_type: &str) -> Vec<Item> {
    let mut items = Vec::new();
    let ed = enabled_dir(repo, content_type);
    let dd = disabled_dir(repo, content_type);

    if ed.exists() {
        if let Ok(entries) = fs::read_dir(&ed) {
            for entry in entries.flatten() {
                items.push(Item {
                    name: entry.file_name().to_string_lossy().to_string(),
                    enabled: true,
                });
            }
        }
    }
    if dd.exists() {
        if let Ok(entries) = fs::read_dir(&dd) {
            for entry in entries.flatten() {
                items.push(Item {
                    name: entry.file_name().to_string_lossy().to_string(),
                    enabled: false,
                });
            }
        }
    }
    items.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    items
}

// ── Move Items ───────────────────────────────────────────────────

fn move_item_internal(repo: &str, content_type: &str, name: &str, enabled: bool) -> Result<(), String> {
    let ed = enabled_dir(repo, content_type);
    let dd = disabled_dir(repo, content_type);
    let enabled_path = ed.join(name);
    let disabled_path = dd.join(name);

    if enabled && disabled_path.exists() {
        fs::create_dir_all(&ed)
            .map_err(|e| format!("Failed to create enabled dir: {}", e))?;
        fs::rename(&disabled_path, &enabled_path)
            .map_err(|e| format!("Failed to move {} to enabled: {}", name, e))?;
    } else if !enabled && enabled_path.exists() {
        fs::create_dir_all(&dd)
            .map_err(|e| format!("Failed to create disabled dir: {}", e))?;
        fs::rename(&enabled_path, &disabled_path)
            .map_err(|e| format!("Failed to move {} to disabled: {}", name, e))?;
    }
    Ok(())
}

// ── Sync Links ───────────────────────────────────────────────────

fn sync_links(repo: &str, selected_agents: &[String]) -> (String, bool) {
    let targets = scan_available_targets();
    let mut log_lines: Vec<String> = Vec::new();
    let mut has_errors = false;

    if targets.is_empty() {
        return ("No AI Agent configurations found.".into(), false);
    }

    for t in &targets {
        // Skip if not in the set of currently available (even if not selected for linking)
        if !t.available {
            continue;
        }

        let content_type = &t.content_type;
        let source = enabled_dir(repo, content_type);

        if t.backend == "wsl" {
            #[cfg(target_os = "windows")]
            {
                if !selected_agents.contains(&t.id) {
                    if is_wsl_managed_link(&t.path, repo) {
                        let _ = run_wsl_shell(&format!(
                            "if [ -L {} ]; then rm {}; elif [ -d {} ]; then rmdir {}; else rm -f {}; fi",
                            shlex_quote(&t.path), shlex_quote(&t.path),
                            shlex_quote(&t.path), shlex_quote(&t.path),
                            shlex_quote(&t.path)
                        ));
                        log_lines.push(format!("[-] Unlinked {}", t.name));
                    } else {
                        log_lines.push(format!("[ ] Skipped {}", t.name));
                    }
                    continue;
                }

                if wsl_path_exists_or_link(&t.path) {
                    if is_wsl_managed_link(&t.path, repo) {
                        let _ = run_wsl_shell(&format!(
                            "if [ -L {} ]; then rm {}; elif [ -d {} ]; then rmdir {}; else rm -f {}; fi",
                            shlex_quote(&t.path), shlex_quote(&t.path),
                            shlex_quote(&t.path), shlex_quote(&t.path),
                            shlex_quote(&t.path)
                        ));
                    } else {
                        match backup_existing_wsl(&t.path) {
                            Ok(_) => log_lines.push(format!("[-] Backed up existing {} to .bak", t.name)),
                            Err(e) => {
                                log_lines.push(format!("[!] Error backing up {}: {}", t.name, e));
                                has_errors = true;
                                continue;
                            }
                        }
                    }
                }

                match windows_to_wsl_path(source.to_str().unwrap_or("")) {
                    Ok(wsl_source) => {
                        let parent = Path::new(&t.path).parent().map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
                        let result = run_wsl_shell(&format!(
                            "mkdir -p {} && ln -s {} {}",
                            shlex_quote(&parent),
                            shlex_quote(&wsl_source),
                            shlex_quote(&t.path)
                        ));
                        match result {
                            Ok(o) if o.status.success() => {
                                log_lines.push(format!("[+] Linked {} ({})", t.name, content_label(content_type)));
                            }
                            Ok(o) => {
                                log_lines.push(format!("[!] Error linking {}: {}", t.name,
                                    String::from_utf8_lossy(&o.stderr)));
                                has_errors = true;
                            }
                            Err(e) => {
                                log_lines.push(format!("[!] Error linking {}: {}", t.name, e));
                                has_errors = true;
                            }
                        }
                    }
                    Err(e) => {
                        log_lines.push(format!("[!] Error converting path for {}: {}", t.name, e));
                        has_errors = true;
                    }
                }
            }
            #[cfg(not(target_os = "windows"))]
            {
                log_lines.push(format!("[ ] Skipped WSL target {} (not on Windows)", t.name));
            }
        } else {
            // Local target
            let target_path = expanded_path(&t.path);

            if !selected_agents.contains(&t.id) {
                if is_managed_link(&target_path, repo) {
                    let _ = remove_link(&target_path);
                    log_lines.push(format!("[-] Unlinked {}", t.name));
                } else {
                    log_lines.push(format!("[ ] Skipped {}", t.name));
                }
                continue;
            }

            if target_path.exists() || target_path.is_symlink() {
                if is_managed_link(&target_path, repo) {
                    let _ = remove_link(&target_path);
                } else {
                    match backup_existing(&target_path) {
                        Ok(_) => log_lines.push(format!("[-] Backed up existing {} to .bak", t.name)),
                        Err(e) => {
                            log_lines.push(format!("[!] Error backing up {}: {}", t.name, e));
                            has_errors = true;
                            continue;
                        }
                    }
                }
            }

            match create_directory_link(&target_path, &source) {
                Ok(_) => {
                    log_lines.push(format!("[+] Linked {} ({})", t.name, content_label(content_type)));
                }
                Err(e) => {
                    log_lines.push(format!("[!] Error linking {}: {}", t.name, e));
                    has_errors = true;
                }
            }
        }
    }

    (log_lines.join("\n"), has_errors)
}

// ── Open Directory ───────────────────────────────────────────────

fn open_dir(path: &str) -> Result<(), String> {
    let raw = expanded_path(path);

    // 规范化路径（消除 / 和 \ 混用、.. 等）
    let p = std::path::absolute(&raw)
        .unwrap_or(raw.clone());

    if !p.exists() {
        return Err(format!("Directory not found: {}", p.display()));
    }
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(p.to_str().ok_or("invalid path")?)
            .spawn()
            .map_err(|e| format!("Failed to open: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(p.to_str().ok_or("invalid path")?)
            .spawn()
            .map_err(|e| format!("Failed to open: {}", e))?;
    }
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(p.to_str().ok_or("invalid path")?)
            .spawn()
            .map_err(|e| format!("Failed to open: {}", e))?;
    }
    Ok(())
}

// ── Tauri Commands ───────────────────────────────────────────────

#[tauri::command]
fn get_config() -> Config {
    let mut config = load_config_from_disk();

    // 首次启动：自动使用 ~/.ai 作为默认仓库
    if config.repo_root.is_none() {
        let default_root = dirs::home_dir()
            .map(|p| p.join(".ai").to_string_lossy().to_string())
            .unwrap_or_else(|| ".ai".into());

        // 初始化仓库目录（幂等，已存在也无妨）
        if let Ok(()) = init_repo(&default_root) {
            let _ = save_config_to_disk(&Some(default_root.clone()), &config.linked_agents);
            config.repo_root = Some(default_root);
        }
    }

    config
}

#[tauri::command]
fn configure_repo(repo_root: String) -> Result<Config, String> {
    let expanded = shellexpand::tilde(&repo_root).to_string();
    let abs = std::path::absolute(&expanded)
        .map_err(|e| format!("Invalid path: {}", e))?;
    let abs_str = abs.to_string_lossy().to_string();

    init_repo(&abs_str)?;

    let config = load_config_from_disk();
    save_config_to_disk(&Some(abs_str.clone()), &config.linked_agents)?;

    Ok(Config {
        repo_root: Some(abs_str),
        linked_agents: config.linked_agents,
    })
}

#[tauri::command]
fn get_targets(content_type: Option<String>) -> Vec<AgentTarget> {
    let targets = scan_available_targets();
    match content_type {
        Some(ct) if !ct.is_empty() => targets
            .into_iter()
            .filter(|t| t.content_type == ct)
            .collect(),
        _ => targets,
    }
}

#[tauri::command]
fn get_items(content_type: String) -> Result<Vec<Item>, String> {
    let repo = repo_root().ok_or("仓库未配置")?;
    Ok(scan_items(&repo, &content_type))
}

#[tauri::command]
fn move_item(content_type: String, name: String, enabled: bool) -> Result<(), String> {
    let repo = repo_root().ok_or("仓库未配置")?;
    move_item_internal(&repo, &content_type, &name, enabled)
}

#[tauri::command]
async fn save_and_sync(
    linked_agents: Vec<String>,
    items_to_move: Vec<ItemMove>,
) -> Result<SyncResult, String> {
    let repo = repo_root().ok_or("仓库未配置")?;

    // 1. Move items
    let mut moved_count = 0usize;
    for im in &items_to_move {
        move_item_internal(&repo, &im.content_type, &im.name, im.enabled)?;
        moved_count += 1;
    }

    // 2. Save config
    save_config_to_disk(&Some(repo.clone()), &linked_agents)?;

    // 3. Sync links
    let (log, has_errors) = sync_links(&repo, &linked_agents);

    Ok(SyncResult {
        log,
        moved_count,
        has_errors,
    })
}

#[tauri::command]
fn open_directory(path: String) -> Result<(), String> {
    open_dir(&path)
}

#[tauri::command]
fn get_repo_default() -> String {
    dirs::home_dir()
        .map(|p| p.join(".ai").to_string_lossy().to_string())
        .unwrap_or_else(|| ".ai".into())
}

// ── Profiles ─────────────────────────────────────────────────────

fn profiles_dir() -> PathBuf {
    app_config_dir().join("profiles")
}

#[tauri::command]
fn get_profiles() -> Vec<Profile> {
    let dir = profiles_dir();
    let mut profiles = Vec::new();
    if dir.exists() {
        if let Ok(entries) = fs::read_dir(&dir) {
            for entry in entries.flatten() {
                if entry.path().extension().map(|e| e == "json").unwrap_or(false) {
                    if let Ok(content) = fs::read_to_string(entry.path()) {
                        if let Ok(mut profile) = serde_json::from_str::<Profile>(&content) {
                            if let Some(stem) = entry.path().file_stem().and_then(|s| s.to_str()) {
                                profile.name = stem.to_string();
                            }
                            profiles.push(profile);
                        }
                    }
                }
            }
        }
    }
    profiles.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    profiles
}

#[tauri::command]
fn save_profile(profile: Profile) -> Result<(), String> {
    let dir = profiles_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create profiles dir: {}", e))?;
    let safe_name = profile.name.replace(&['/', '\\', '.', ':'][..], "_");
    if safe_name.is_empty() { return Err("Invalid profile name".into()); }
    let path = dir.join(format!("{}.json", safe_name));
    let json = serde_json::to_string_pretty(&profile).map_err(|e| format!("Serialization error: {}", e))?;
    fs::write(&path, json).map_err(|e| format!("Write error: {}", e))
}

#[tauri::command]
fn delete_profile(name: String) -> Result<(), String> {
    let safe_name = name.replace(&['/', '\\', '.', ':'][..], "_");
    if safe_name.is_empty() { return Err("Invalid profile name".into()); }
    let path = profiles_dir().join(format!("{}.json", safe_name));
    if path.exists() {
        fs::remove_file(path).map_err(|e| format!("Delete error: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
async fn apply_profile_and_sync(repo_root: String, profile: Profile, selected_agents: Vec<String>) -> Result<SyncResult, String> {
    let _ = save_config_to_disk(&Some(repo_root.clone()), &selected_agents);
    
    // First, enforce profile logic
    for ct in CONTENT_TYPES {
        let desired_items = match *ct {
            "skills" => &profile.skills,
            "rules" => &profile.rules,
            "plugins" => &profile.plugins,
            "mcps" => &profile.mcps,
            _ => continue,
        };

        let ed = enabled_dir(&repo_root, ct);
        let dd = disabled_dir(&repo_root, ct);
        
        let _ = fs::create_dir_all(&ed);
        let _ = fs::create_dir_all(&dd);

        // Move items currently in enabled but not in desired -> disabled
        if let Ok(entries) = fs::read_dir(&ed) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if !desired_items.contains(&name) {
                    let _ = fs::rename(entry.path(), dd.join(&name));
                }
            }
        }

        // Move items currently in disabled but in desired -> enabled
        if let Ok(entries) = fs::read_dir(&dd) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if desired_items.contains(&name) {
                    let _ = fs::rename(entry.path(), ed.join(&name));
                }
            }
        }
    }

    // Now call sync
    let (log, has_errors) = sync_links(&repo_root, &selected_agents);
    Ok(SyncResult {
        log,
        moved_count: 0,
        has_errors,
    })
}

// ── App Entry ────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_config,
            configure_repo,
            get_targets,
            get_items,
            move_item,
            save_and_sync,
            open_directory,
            get_repo_default,
            get_profiles,
            save_profile,
            delete_profile,
            apply_profile_and_sync,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
