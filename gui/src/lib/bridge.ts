import { invoke } from "@tauri-apps/api/core";
import type { FileInfo, JobInfo, MetaEntry, UploadResult } from "@/lib/types";

export type AnalysisLevel = "fast" | "normal" | "thorough";

export const tauri = {
  listBinariesDir: (dir: string) =>
    invoke<FileInfo[]>("cmd_list_binaries_dir", { dir }),

  readResultsMeta: (path: string, tail: number) =>
    invoke<MetaEntry[]>("cmd_read_results_meta", { path, tail }),

  readResultFile: (path: string, maxChars: number) =>
    invoke<string>("cmd_read_result_file", { path, maxChars }),

  /** POST /upload — server long-polls to completion. analysis: fast | normal | thorough */
  uploadBinary: (filePath: string, serverUrl: string, analysis: AnalysisLevel = "normal") =>
    invoke<UploadResult>("cmd_upload_binary", { filePath, serverUrl, analysis }),

  /** POST /import — schedule import for a server-visible binary. */
  importBinary: (serverPath: string, serverUrl: string, analysis: AnalysisLevel = "normal") =>
    invoke<UploadResult>("cmd_import_binary", { serverPath, serverUrl, analysis }),

  /** GET /jobs/{id}?wait=N — long-poll a job for up to waitSec seconds. */
  getJob: (jobId: string, serverUrl: string, waitSec: number) =>
    invoke<JobInfo>("cmd_get_job", { jobId, serverUrl, waitSec }),

  /** GET /jobs?limit=N — recent jobs newest-first. */
  listJobs: (serverUrl: string, limit = 20) =>
    invoke<JobInfo[]>("cmd_list_jobs", { serverUrl, limit }),

  startResultsWatcher: (metaPath: string) =>
    invoke<void>("cmd_start_results_watcher", { metaPath }),

  /** Start streaming `docker compose logs -f` from the ghidra-agent-mcp container.
   *  Each line is emitted as the "docker-log-line" event. Idempotent — safe to call
   *  on every mount. Pair with stopDockerLogs in the unmount cleanup. */
  startDockerLogs: (tail = 200) =>
    invoke<void>("cmd_start_docker_logs", { tail }),
  stopDockerLogs: () =>
    invoke<void>("cmd_stop_docker_logs"),

  openFolder: (path: string) =>
    invoke<void>("cmd_open_folder", { path }),

  openDockerLogs: () =>
    invoke<void>("cmd_open_docker_logs"),

  resolveProjectPaths: () =>
    invoke<{ binaries_dir: string; results_dir: string; meta_path: string }>(
      "cmd_resolve_project_paths"
    ),
};

/** Lightweight env detection — true if running under Tauri shell. */
export const IS_TAURI =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
