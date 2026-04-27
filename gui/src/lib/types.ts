export interface HealthData {
  server: string;
  version: string;
  programs_loaded: number;
  max_programs: number;
  current_program: string;
  programs: string[];
  binaries_dir: string;
  available_binaries?: string[];
  hint?: string;
}

export interface HealthResp {
  status: "ok" | "error";
  data?: HealthData;
  message?: string;
}

export interface ProgramInfo {
  name: string;
  format: string;
  language: string;
  functions: number;
  is_current: boolean;
}

export interface ImportResult {
  name: string;
  format: string;
  language: string;
  functions: number;
}

export type JobStatus = "queued" | "analyzing" | "ready" | "error";

export interface JobInfo {
  job_id?: string;
  type?: string;
  program?: string;
  status?: JobStatus;
  submitted_at?: number;
  started_at?: number;
  finished_at?: number;
  running_ms?: number;
  duration_ms?: number;
  message?: string;
  result?: {
    name?: string;
    format?: string;
    language?: string;
    functions?: number;
    [k: string]: unknown;
  };
}

/** Server response from /upload, /import, or /jobs/{id} (the v1.3+ async envelope). */
export interface UploadResult extends JobInfo {
  file?: string;
  size?: number;
  imported?: boolean;
  name?: string;
  format?: string;
  language?: string;
  functions?: number;
  error?: string;
  hint?: string;
}

export interface MetaEntry {
  file: string;
  tool: string;
  program: string | null;
  identifier: string | null;
  time: string;
  size: number;
}

export interface FileInfo {
  name: string;
  path: string;
  size: number;
  modified: number;
}

export interface ProjectPaths {
  binaries_dir: string;
  results_dir: string;
  meta_path: string;
}

export type UploadStatus = "pending" | "uploading" | "analyzing" | "done" | "error";

export interface UploadJob {
  id: string;
  path: string;
  name: string;
  size: number;
  status: UploadStatus;
  message?: string;
  startedAt?: number;
  finishedAt?: number;
}
