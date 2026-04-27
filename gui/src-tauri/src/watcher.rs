use notify::{recommended_watcher, EventKind, RecursiveMode, Watcher};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

#[derive(Default)]
pub struct WatcherState {
    inner: Mutex<Option<WatchedFile>>,
}

struct WatchedFile {
    path: PathBuf,
    _watcher: notify::RecommendedWatcher,
}

#[tauri::command]
pub fn cmd_start_results_watcher(
    app: AppHandle,
    state: tauri::State<'_, WatcherState>,
    meta_path: String,
) -> Result<(), String> {
    let path = PathBuf::from(&meta_path);
    let watch_target: PathBuf = if path.is_file() {
        path.clone()
    } else {
        // If the file does not exist yet, watch the parent directory.
        path.parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| "invalid meta path".to_string())?
    };

    // If we're already watching the same path, no-op.
    {
        let guard = state.inner.lock().unwrap();
        if let Some(w) = guard.as_ref() {
            if w.path == watch_target {
                return Ok(());
            }
        }
    }

    let app_handle = app.clone();
    let target_for_filter = path.clone();
    let mut watcher = recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(ev) = res else { return };
        let interesting = matches!(
            ev.kind,
            EventKind::Modify(_) | EventKind::Create(_) | EventKind::Remove(_)
        );
        if !interesting {
            return;
        }
        // Only emit when the meta file itself is touched (or when we're watching its parent dir).
        let touches_meta = ev.paths.iter().any(|p| p == &target_for_filter);
        if !touches_meta && watch_target_is_dir(&ev.paths) {
            // ignore unrelated files in the dir
            let other = ev.paths.iter().any(|p| p.file_name() == target_for_filter.file_name());
            if !other {
                return;
            }
        }
        let _ = app_handle.emit("results-changed", ());
    })
    .map_err(|e| e.to_string())?;

    watcher
        .watch(&watch_target, RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;

    let mut guard = state.inner.lock().unwrap();
    *guard = Some(WatchedFile {
        path: watch_target,
        _watcher: watcher,
    });
    Ok(())
}

fn watch_target_is_dir(paths: &[PathBuf]) -> bool {
    paths.iter().any(|p| p.is_dir())
}
