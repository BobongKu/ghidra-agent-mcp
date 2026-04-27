import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { setServerUrl } from "@/lib/api";
import { ContainerControl } from "@/components/ContainerControl";
import type { ProjectPaths } from "@/lib/types";

interface Props {
  serverUrl: string;
  onServerUrlChange: (u: string) => void;
  paths: ProjectPaths | null;
}

export function SettingsPage({ serverUrl, onServerUrlChange, paths }: Props) {
  const [draft, setDraft] = useState(serverUrl);

  const apply = () => {
    const next = draft.trim().replace(/\/+$/, "");
    if (next && next !== serverUrl) {
      setServerUrl(next);
      onServerUrlChange(next);
    }
  };

  return (
    <div className="flex-1 min-h-0 overflow-auto p-4 space-y-4">
      <ContainerControl />
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm">Server</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-[11px] text-muted-foreground uppercase tracking-wide">
              Ghidra HTTP server URL
            </label>
            <div className="flex items-center gap-2">
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && apply()}
                placeholder="http://127.0.0.1:18089"
                className="font-mono text-xs"
              />
              <Button size="sm" onClick={apply} disabled={draft === serverUrl}>Save</Button>
            </div>
            <p className="text-[10.5px] text-muted-foreground">
              Stored in browser localStorage as <code>serverUrl</code>. Health check polls every 3s.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm">Project paths (auto-detected)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {paths ? (
            <dl className="space-y-2 text-[12px]">
              <div className="flex items-start gap-3">
                <dt className="w-32 shrink-0 text-muted-foreground">Binaries</dt>
                <dd className="font-mono break-all">{paths.binaries_dir || "—"}</dd>
              </div>
              <div className="flex items-start gap-3">
                <dt className="w-32 shrink-0 text-muted-foreground">Results</dt>
                <dd className="font-mono break-all">{paths.results_dir || "—"}</dd>
              </div>
              <div className="flex items-start gap-3">
                <dt className="w-32 shrink-0 text-muted-foreground">Meta JSONL</dt>
                <dd className="font-mono break-all">{paths.meta_path || "—"}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-[12px] text-muted-foreground">Resolving…</p>
          )}
          <p className="text-[10.5px] text-muted-foreground/80 mt-3">
            Paths are resolved from the executable's location at startup.
            Run the GUI from inside the project tree (or alongside <code>bridge_lite.py</code>).
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm">About</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-[12px]">
          <p>
            <Badge variant="secondary" className="font-mono text-[10px] mr-2">v1.0.0</Badge>
            Ghidra Agent GUI — Tauri + React + shadcn/ui.
          </p>
          <p className="text-muted-foreground text-[11px]">
            Server endpoints, jobs, decompile, and result browser front-end for the
            Ghidra plugin server. The pixel-art mark was generated with pixelforge MCP.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
