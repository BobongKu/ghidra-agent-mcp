import type { HealthResp, ProgramInfo } from "./types";

export const DEFAULT_SERVER = "http://127.0.0.1:18089";

export function getServerUrl(): string {
  return localStorage.getItem("serverUrl") || DEFAULT_SERVER;
}
export function setServerUrl(url: string) {
  localStorage.setItem("serverUrl", url.replace(/\/+$/, ""));
}

async function jsonFetch<T>(
  url: string,
  init?: RequestInit & { timeoutMs?: number }
): Promise<T> {
  const ctrl = new AbortController();
  const timeoutMs = init?.timeoutMs ?? 5000;
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

export async function getHealth(server = getServerUrl()): Promise<HealthResp> {
  return jsonFetch<HealthResp>(`${server}/health`, { timeoutMs: 4000 });
}

export async function getPrograms(server = getServerUrl()): Promise<ProgramInfo[]> {
  const r = await jsonFetch<{ status: string; data: ProgramInfo[] }>(
    `${server}/programs`,
    { timeoutMs: 5000 }
  );
  return r.data ?? [];
}

export async function closeProgram(
  name: string,
  server = getServerUrl()
): Promise<{ status: string }> {
  return jsonFetch(`${server}/program/close`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
    timeoutMs: 10_000,
  });
}

export interface CloseAllResult {
  closed: string[];
  closed_count: number;
  remaining: string[];
}

export async function closeAllPrograms(
  keepCurrent = false,
  server = getServerUrl()
): Promise<CloseAllResult> {
  const r = await jsonFetch<{ status: string; data: CloseAllResult }>(
    `${server}/program/close-all`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keep_current: keepCurrent ? "true" : "false" }),
      timeoutMs: 60_000,
    }
  );
  return r.data;
}
