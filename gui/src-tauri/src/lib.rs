mod commands;
mod docker_logs;
mod watcher;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(watcher::WatcherState::default())
        .manage(docker_logs::DockerLogsState::default())
        .invoke_handler(tauri::generate_handler![
            commands::cmd_list_binaries_dir,
            commands::cmd_read_results_meta,
            commands::cmd_read_result_file,
            commands::cmd_upload_binary,
            commands::cmd_import_binary,
            commands::cmd_get_job,
            commands::cmd_list_jobs,
            commands::cmd_open_folder,
            commands::cmd_open_docker_logs,
            commands::cmd_resolve_project_paths,
            docker_logs::cmd_start_docker_logs,
            docker_logs::cmd_stop_docker_logs,
            watcher::cmd_start_results_watcher,
        ])
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.set_title("Ghidra Agent GUI (dev)");
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
