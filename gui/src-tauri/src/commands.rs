use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::Duration;

#[derive(Serialize)]
pub struct FileInfo {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub modified: u64,
}

#[derive(Serialize, Deserialize)]
pub struct MetaEntry {
    pub file: String,
    pub tool: String,
    pub program: Option<String>,
    pub identifier: Option<String>,
    pub time: String,
    pub size: u64,
}

#[derive(Serialize, Deserialize)]
pub struct ApiEnvelope<T> {
    pub status: Option<String>,
    pub data: Option<T>,
    pub message: Option<String>,
}

#[derive(Serialize, Deserialize, Default, Clone)]
pub struct JobInfo {
    pub job_id: Option<String>,
    pub r#type: Option<String>,
    pub program: Option<String>,
    pub status: Option<String>,
    pub submitted_at: Option<u64>,
    pub started_at: Option<u64>,
    pub finished_at: Option<u64>,
    pub running_ms: Option<u64>,
    pub duration_ms: Option<u64>,
    pub message: Option<String>,
    pub result: Option<serde_json::Value>,
}

#[derive(Serialize, Deserialize, Default)]
pub struct UploadEnvelopeData {
    // Job-related fields (server v1.3+)
    pub job_id: Option<String>,
    pub status: Option<String>,
    pub program: Option<String>,
    pub submitted_at: Option<u64>,
    pub started_at: Option<u64>,
    pub finished_at: Option<u64>,
    pub running_ms: Option<u64>,
    pub duration_ms: Option<u64>,
    pub result: Option<serde_json::Value>,
    pub hint: Option<String>,
    pub message: Option<String>,
    // File-side fields
    pub file: Option<String>,
    pub size: Option<u64>,
    pub imported: Option<bool>,
    // Inlined-on-ready fields
    pub name: Option<String>,
    pub format: Option<String>,
    pub language: Option<String>,
    pub functions: Option<u64>,
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct ProjectPaths {
    pub binaries_dir: String,
    pub results_dir: String,
    pub meta_path: String,
}

fn err(msg: impl Into<String>) -> String {
    msg.into()
}

#[tauri::command]
pub async fn cmd_list_binaries_dir(dir: String) -> Result<Vec<FileInfo>, String> {
    let p = PathBuf::from(&dir);
    if !p.is_dir() {
        return Ok(vec![]);
    }
    let mut out = Vec::new();
    let mut rd = tokio::fs::read_dir(&p).await.map_err(|e| err(e.to_string()))?;
    while let Some(entry) = rd.next_entry().await.map_err(|e| err(e.to_string()))? {
        let meta = match entry.metadata().await {
            Ok(m) => m,
            Err(_) => continue,
        };
        if !meta.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let modified = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        out.push(FileInfo {
            name,
            path: entry.path().to_string_lossy().into_owned(),
            size: meta.len(),
            modified,
        });
    }
    out.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(out)
}

#[tauri::command]
pub async fn cmd_read_results_meta(path: String, tail: usize) -> Result<Vec<MetaEntry>, String> {
    let p = PathBuf::from(&path);
    if !p.is_file() {
        return Ok(vec![]);
    }
    let text = tokio::fs::read_to_string(&p).await.map_err(|e| err(e.to_string()))?;
    let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    let start = lines.len().saturating_sub(tail);
    let entries: Vec<MetaEntry> = lines[start..]
        .iter()
        .filter_map(|l| serde_json::from_str::<MetaEntry>(l).ok())
        .collect();
    Ok(entries)
}

#[tauri::command]
pub async fn cmd_read_result_file(path: String, max_chars: usize) -> Result<String, String> {
    let p = PathBuf::from(&path);
    let text = tokio::fs::read_to_string(&p).await.map_err(|e| err(e.to_string()))?;
    if text.chars().count() > max_chars {
        let truncated: String = text.chars().take(max_chars).collect();
        Ok(format!(
            "{}\n\n... [TRUNCATED at {} chars, total {}]",
            truncated,
            max_chars,
            text.chars().count()
        ))
    } else {
        Ok(text)
    }
}

/// POST /upload?wait=600 — block on server for up to 10 minutes.
/// Ghidra analysis runs sequentially in one worker; client-side polling adds
/// no parallelism, so we just wait. The server's job system still applies
/// internally (history is visible in the Jobs page), but the GUI uses the
/// simple sync API.
#[tauri::command]
pub async fn cmd_upload_binary(
    file_path: String,
    server_url: String,
    analysis: Option<String>,
) -> Result<UploadEnvelopeData, String> {
    let p = PathBuf::from(&file_path);
    if !p.is_file() {
        return Err(format!("file not found: {}", file_path));
    }
    let name = p
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .ok_or_else(|| err("invalid filename"))?;

    let bytes = tokio::fs::read(&p).await.map_err(|e| err(e.to_string()))?;

    let level = analysis.as_deref().unwrap_or("normal");
    let url = format!(
        "{}/upload?filename={}&wait=600&analysis={}",
        server_url.trim_end_matches('/'),
        urlencode(&name),
        urlencode(level)
    );
    // 30-min HTTP timeout to safely cover the 10-min server-side wait + slack.
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30 * 60))
        .build()
        .map_err(|e| err(e.to_string()))?;

    let resp = client
        .post(&url)
        .header("Content-Type", "application/octet-stream")
        .body(bytes)
        .send()
        .await
        .map_err(|e| err(format!("network error: {}", e)))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("HTTP {}: {}", status, body));
    }

    let parsed: ApiEnvelope<UploadEnvelopeData> = resp.json().await.map_err(|e| err(e.to_string()))?;
    if parsed.status.as_deref() == Some("error") {
        return Err(parsed.message.unwrap_or_else(|| "server error".into()));
    }
    Ok(parsed.data.unwrap_or_default())
}

/// POST /import?wait=600 — block on server for up to 10 minutes.
#[tauri::command]
pub async fn cmd_import_binary(
    server_path: String,
    server_url: String,
    analysis: Option<String>,
) -> Result<UploadEnvelopeData, String> {
    let url = format!("{}/import?wait=600", server_url.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30 * 60))
        .build()
        .map_err(|e| err(e.to_string()))?;
    let level = analysis.as_deref().unwrap_or("normal").to_string();
    let body = serde_json::json!({ "path": server_path, "analysis": level });
    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| err(format!("network error: {}", e)))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("HTTP {}: {}", status, body));
    }
    let parsed: ApiEnvelope<UploadEnvelopeData> = resp.json().await.map_err(|e| err(e.to_string()))?;
    if parsed.status.as_deref() == Some("error") {
        return Err(parsed.message.unwrap_or_else(|| "server error".into()));
    }
    Ok(parsed.data.unwrap_or_default())
}

/// GET /jobs/{id}?wait=N — long-poll a job.
#[tauri::command]
pub async fn cmd_get_job(job_id: String, server_url: String, wait_sec: u64) -> Result<JobInfo, String> {
    let url = format!(
        "{}/jobs/{}?wait={}",
        server_url.trim_end_matches('/'),
        urlencode(&job_id),
        wait_sec
    );
    // Allow the HTTP layer to wait slightly longer than the server-side wait.
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(wait_sec + 30))
        .build()
        .map_err(|e| err(e.to_string()))?;
    let resp = client.get(&url).send().await.map_err(|e| err(e.to_string()))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("HTTP {}: {}", status, body));
    }
    let parsed: ApiEnvelope<JobInfo> = resp.json().await.map_err(|e| err(e.to_string()))?;
    if parsed.status.as_deref() == Some("error") {
        return Err(parsed.message.unwrap_or_else(|| "server error".into()));
    }
    Ok(parsed.data.unwrap_or_default())
}

/// GET /jobs?limit=N — list recent jobs newest-first.
#[tauri::command]
pub async fn cmd_list_jobs(server_url: String, limit: u32) -> Result<Vec<JobInfo>, String> {
    let url = format!(
        "{}/jobs?limit={}",
        server_url.trim_end_matches('/'),
        limit
    );
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| err(e.to_string()))?;
    let resp = client.get(&url).send().await.map_err(|e| err(e.to_string()))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let parsed: ApiEnvelope<Vec<JobInfo>> = resp.json().await.map_err(|e| err(e.to_string()))?;
    Ok(parsed.data.unwrap_or_default())
}

#[tauri::command]
pub fn cmd_open_folder(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("path not found: {}", path));
    }
    open_with_os(&p).map_err(|e| err(e.to_string()))
}

/// Locate the project root by walking up from the current exe until we find
/// a directory that contains both `docker/binaries` and `bridge_lite.py`.
pub fn resolve_project_root() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let mut cur: Option<&Path> = exe.parent();
    for _ in 0..8 {
        if let Some(c) = cur {
            if c.join("docker").join("binaries").is_dir()
                && c.join("bridge_lite.py").is_file()
            {
                return Some(c.to_path_buf());
            }
            cur = c.parent();
        }
    }
    std::env::current_dir().ok()
}

#[tauri::command]
pub fn cmd_open_docker_logs() -> Result<(), String> {
    let root = resolve_project_root().ok_or_else(|| err("could not resolve project root"))?;
    let compose = root.join("docker").join("docker-compose.yml");
    if !compose.is_file() {
        return Err(format!("docker-compose.yml not found at {}", compose.display()));
    }
    spawn_logs_terminal(&compose).map_err(|e| err(e.to_string()))
}

/// Common: derive the docker dir (parent of compose-file). Setting it as cwd
/// for the spawned shell sidesteps Windows quoting issues with absolute -f paths
/// AND lets `.env` be picked up automatically.
fn docker_dir(compose: &Path) -> std::io::Result<PathBuf> {
    compose.parent()
        .map(|p| p.to_path_buf())
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidInput, "compose has no parent"))
}

#[cfg(target_os = "windows")]
fn spawn_logs_terminal(compose: &Path) -> std::io::Result<()> {
    let dir = docker_dir(compose)?;
    // /c start "title" cmd /k "<command>" — opens a new cmd window in `dir`
    // The command runs without `-f` since cwd contains docker-compose.yml.
    std::process::Command::new("cmd")
        .args(["/c", "start", "Docker Logs", "cmd", "/k", "docker compose logs -f"])
        .current_dir(&dir)
        .spawn()?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn spawn_logs_terminal(compose: &Path) -> std::io::Result<()> {
    let dir = docker_dir(compose)?;
    let cmd = format!(
        "cd '{}' && docker compose logs -f",
        dir.to_string_lossy().replace('\'', "'\\''")
    );
    let script = format!(
        r#"tell application "Terminal" to do script "{}""#,
        cmd.replace('"', "\\\"")
    );
    std::process::Command::new("osascript").args(["-e", &script]).spawn()?;
    Ok(())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn spawn_logs_terminal(compose: &Path) -> std::io::Result<()> {
    let dir = docker_dir(compose)?;
    let cmd = "docker compose logs -f; exec bash";
    for term in ["x-terminal-emulator", "gnome-terminal", "konsole", "xterm"] {
        let r = std::process::Command::new(term)
            .args(["-e", "bash", "-c", cmd])
            .current_dir(&dir)
            .spawn();
        if r.is_ok() { return Ok(()); }
    }
    Err(std::io::Error::new(std::io::ErrorKind::NotFound, "no terminal emulator found"))
}

#[tauri::command]
pub fn cmd_resolve_project_paths() -> Result<ProjectPaths, String> {
    let root = resolve_project_root().ok_or_else(|| err("could not resolve project root"))?;
    let binaries_dir = root.join("docker").join("binaries");
    let results_dir = root.join("docker").join("results");
    let meta_path = results_dir.join("_meta.jsonl");
    Ok(ProjectPaths {
        binaries_dir: binaries_dir.to_string_lossy().into_owned(),
        results_dir: results_dir.to_string_lossy().into_owned(),
        meta_path: meta_path.to_string_lossy().into_owned(),
    })
}

#[cfg(target_os = "windows")]
fn open_with_os(path: &Path) -> std::io::Result<()> {
    std::process::Command::new("explorer").arg(path).spawn()?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn open_with_os(path: &Path) -> std::io::Result<()> {
    std::process::Command::new("open").arg(path).spawn()?;
    Ok(())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_with_os(path: &Path) -> std::io::Result<()> {
    std::process::Command::new("xdg-open").arg(path).spawn()?;
    Ok(())
}

fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        let safe =
            b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~');
        if safe {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{:02X}", b));
        }
    }
    out
}
