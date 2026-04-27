// Lifecycle control for the docker-compose stack.
//
// We deliberately re-implement this in Rust (rather than tell the user to
// open a terminal) so the GUI can drive the whole loop:
//   - "Server unreachable" banner -> click Start -> we spawn `docker compose up -d`
//   - Settings page exposes Start / Stop / Restart explicitly
//   - Each command emits structured progress over a Tauri event so the UI can
//     show "starting..." / "stopping..." without polling.
//
// Long-form output is captured and returned in the result so the user can see
// the actual error from docker (e.g. "daemon not reachable", "image not found")
// instead of a generic "command failed".

use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::io::{BufRead, BufReader};
use tauri::{AppHandle, Emitter};

#[derive(serde::Serialize, Default)]
pub struct ComposeResult {
    pub action: String,
    pub success: bool,
    pub exit_code: Option<i32>,
    /// Combined stdout+stderr. Trimmed to the last ~8 KB to keep responses sane.
    pub output: String,
}

fn compose_path() -> Result<PathBuf, String> {
    let root = crate::commands::resolve_project_root()
        .ok_or_else(|| "could not resolve project root".to_string())?;
    let p = root.join("docker").join("docker-compose.yml");
    if !p.is_file() {
        return Err(format!("docker-compose.yml not found at {}", p.display()));
    }
    Ok(p)
}

fn run_compose(app: &AppHandle, action: &str, args: &[&str]) -> Result<ComposeResult, String> {
    let compose = compose_path()?;
    let _ = app.emit("compose-status", serde_json::json!({
        "action": action, "phase": "starting"
    }));

    let mut cmd = Command::new("docker");
    cmd.arg("compose")
       .arg("-f").arg(&compose);
    for a in args { cmd.arg(a); }
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd.spawn().map_err(|e| format!("spawn failed: {}", e))?;
    let mut combined = String::new();
    if let Some(stdout) = child.stdout.take() {
        for line in BufReader::new(stdout).lines().flatten() {
            let _ = app.emit("compose-status", serde_json::json!({
                "action": action, "phase": "log", "line": line
            }));
            combined.push_str(&line);
            combined.push('\n');
        }
    }
    if let Some(stderr) = child.stderr.take() {
        for line in BufReader::new(stderr).lines().flatten() {
            let _ = app.emit("compose-status", serde_json::json!({
                "action": action, "phase": "log", "line": format!("[stderr] {}", line)
            }));
            combined.push_str("[stderr] ");
            combined.push_str(&line);
            combined.push('\n');
        }
    }

    let status = child.wait().map_err(|e| format!("wait failed: {}", e))?;
    let success = status.success();
    // Cap output size — docker compose pull/build produces a lot.
    let truncated = if combined.len() > 8 * 1024 {
        let cut = combined.len() - 8 * 1024;
        format!("... ({} bytes truncated)\n{}", cut, &combined[cut..])
    } else {
        combined
    };
    let result = ComposeResult {
        action: action.to_string(),
        success,
        exit_code: status.code(),
        output: truncated,
    };
    let _ = app.emit("compose-status", serde_json::json!({
        "action": action,
        "phase": if success { "done" } else { "error" },
        "exit_code": result.exit_code,
    }));
    Ok(result)
}

#[tauri::command]
pub fn cmd_compose_up(app: AppHandle, build: Option<bool>) -> Result<ComposeResult, String> {
    let mut args = vec!["up", "-d"];
    if build.unwrap_or(false) { args.push("--build"); }
    run_compose(&app, "up", &args)
}

#[tauri::command]
pub fn cmd_compose_down(app: AppHandle) -> Result<ComposeResult, String> {
    run_compose(&app, "down", &["down"])
}

#[tauri::command]
pub fn cmd_compose_restart(app: AppHandle) -> Result<ComposeResult, String> {
    run_compose(&app, "restart", &["restart"])
}

/// Quick liveness probe — runs `docker version` and reports daemon reachability.
/// Used by the GUI before showing container controls.
#[derive(serde::Serialize)]
pub struct DockerStatus {
    pub daemon_reachable: bool,
    pub server_version: Option<String>,
    pub error: Option<String>,
}

#[tauri::command]
pub fn cmd_docker_status() -> Result<DockerStatus, String> {
    let mut cmd = Command::new("docker");
    cmd.args(["version", "--format", "{{.Server.Version}}"])
       .stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let out = cmd.output().map_err(|e| format!("docker not in PATH: {}", e))?;
    if out.status.success() {
        Ok(DockerStatus {
            daemon_reachable: true,
            server_version: Some(String::from_utf8_lossy(&out.stdout).trim().to_string()),
            error: None,
        })
    } else {
        let stderr = String::from_utf8_lossy(&out.stderr).to_string();
        Ok(DockerStatus {
            daemon_reachable: false,
            server_version: None,
            error: Some(stderr.trim().to_string()),
        })
    }
}
