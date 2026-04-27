use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

/// State for the in-app `docker compose logs -f` streamer.
/// Holds the running child process so it can be killed on stop / app exit.
#[derive(Default)]
pub struct DockerLogsState {
    inner: Mutex<Option<Child>>,
}

#[tauri::command]
pub fn cmd_start_docker_logs(
    app: AppHandle,
    state: tauri::State<'_, DockerLogsState>,
    tail: Option<u32>,
) -> Result<(), String> {
    // Idempotent — if a child is already running, leave it alone.
    {
        let g = state.inner.lock().unwrap();
        if g.is_some() {
            return Ok(());
        }
    }

    let root = crate::commands::resolve_project_root()
        .ok_or_else(|| "could not resolve project root".to_string())?;
    let compose = root.join("docker").join("docker-compose.yml");
    if !compose.is_file() {
        return Err(format!("docker-compose.yml not found at {}", compose.display()));
    }

    let tail = tail.unwrap_or(200).to_string();
    let mut cmd = Command::new("docker");
    cmd.args([
        "compose",
        "-f",
        &compose.to_string_lossy(),
        "logs",
        "-f",
        "--tail",
        &tail,
        "--no-color",
        "ghidra-agent-mcp",
    ])
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW so we don't pop a console.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd.spawn().map_err(|e| format!("spawn failed: {}", e))?;
    let stdout = child.stdout.take().ok_or_else(|| "no stdout".to_string())?;
    let stderr = child.stderr.take().ok_or_else(|| "no stderr".to_string())?;

    let app_for_stdout = app.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().flatten() {
            let _ = app_for_stdout.emit("docker-log-line", line);
        }
    });
    let app_for_stderr = app.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().flatten() {
            // Tag stderr lines so the UI can highlight them.
            let _ = app_for_stderr.emit("docker-log-line", format!("[stderr] {}", line));
        }
    });

    *state.inner.lock().unwrap() = Some(child);
    Ok(())
}

#[tauri::command]
pub fn cmd_stop_docker_logs(state: tauri::State<'_, DockerLogsState>) -> Result<(), String> {
    let mut guard = state.inner.lock().unwrap();
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
}
