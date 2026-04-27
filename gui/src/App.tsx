import { useEffect, useMemo, useState } from "react";
import { Sidebar, type Page } from "@/components/Sidebar";
import { ServerStatusBar } from "@/components/ServerStatusBar";
import { DisconnectedBanner } from "@/components/DisconnectedBanner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Card } from "@/components/ui/card";
import { JsonView } from "@/components/JsonView";
import { DashboardPage } from "@/pages/DashboardPage";
import { ProgramsPage } from "@/pages/ProgramsPage";
import { ProgramDetailPage } from "@/pages/ProgramDetailPage";
import { ConsolePage } from "@/pages/ConsolePage";
import { SearchPage } from "@/pages/SearchPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { tauri, IS_TAURI } from "@/lib/bridge";
import { getServerUrl } from "@/lib/api";
import { useHealthPolling } from "@/hooks/useHealthPolling";
import { useJobs } from "@/hooks/useJobs";
import type { ProjectPaths } from "@/lib/types";

const DEMO_JSON = `{
  "status": "ok",
  "data": {
    "function": "FUN_140012a40",
    "decompiled": "void FUN_140012a40(longlong p1, int p2) {\\n  if (p2 > 0) return;\\n  WriteFile(*(HANDLE*)(p1+8), &DAT_180123450, 0x40, NULL, NULL);\\n}",
    "calls": ["WriteFile", "GetLastError"],
    "size_bytes": 184,
    "is_thunk": false,
    "params": [
      { "name": "p1", "type": "longlong", "in_register": true },
      { "name": "p2", "type": "int", "in_register": true }
    ],
    "complexity": 4.5
  }
}`;

/** Optional deep-link payload to pre-select a tab + filter when entering ProgramDetail. */
export interface ProgramDeepLink {
  tab?: "functions" | "imports" | "strings" | "results";
  filter?: string;
  /** Function entry address — when set, auto-trigger decompile on the Functions tab. */
  address?: string;
}

interface ViewState {
  page: Page;
  programDetail?: string;
  deepLink?: ProgramDeepLink;
}

export default function App() {
  const [serverUrl, setServerUrlState] = useState(() => getServerUrl());
  const [paths, setPaths] = useState<ProjectPaths | null>(null);
  const [view, setView] = useState<ViewState>({ page: "dashboard" });
  const [refreshKey, setRefreshKey] = useState(0);
  const bumpRefresh = () => setRefreshKey((n) => n + 1);

  const health = useHealthPolling(serverUrl, 3000);
  const { active: activeJobs } = useJobs(serverUrl);

  useEffect(() => {
    if (!IS_TAURI) {
      setPaths({ binaries_dir: "", results_dir: "", meta_path: "" });
      return;
    }
    tauri.resolveProjectPaths().then(setPaths).catch(() => {
      setPaths({ binaries_dir: "", results_dir: "", meta_path: "" });
    });
  }, []);

  // Sidebar live badges
  const badges = useMemo<Partial<Record<Page, number>>>(() => ({
    programs: health.data?.programs_loaded,
  }), [health.data?.programs_loaded]);
  void activeJobs; // referenced through useJobs side-effects only here

  const isJsonDemo = typeof window !== "undefined"
    && new URLSearchParams(window.location.search).get("demo") === "json";

  if (isJsonDemo) {
    return (
      <TooltipProvider>
        <div className="h-full flex flex-col p-6 gap-4">
          <h1 className="text-lg font-semibold">JsonView demo</h1>
          <Card className="flex-1 overflow-hidden">
            <JsonView text={DEMO_JSON} />
          </Card>
        </div>
      </TooltipProvider>
    );
  }

  const navigate = (p: Page) => setView({ page: p });

  const renderPage = () => {
    switch (view.page) {
      case "dashboard":
        return (
          <DashboardPage
            serverUrl={serverUrl}
            health={health}
            paths={paths}
            refreshKey={refreshKey}
            bumpRefresh={bumpRefresh}
          />
        );
      case "programs":
        if (view.programDetail) {
          return (
            <ProgramDetailPage
              programName={view.programDetail}
              binariesDir={paths?.binaries_dir ?? ""}
              metaPath={paths?.meta_path ?? null}
              deepLink={view.deepLink}
              onBack={() => setView({ page: "programs" })}
            />
          );
        }
        return (
          <ProgramsPage
            serverUrl={serverUrl}
            programs={health.data?.programs ?? []}
            onChanged={bumpRefresh}
            onOpen={(name) => setView({ page: "programs", programDetail: name })}
          />
        );
      case "search":
        return (
          <SearchPage
            serverUrl={serverUrl}
            onOpenProgram={(name, deepLink) =>
              setView({ page: "programs", programDetail: name, deepLink })
            }
          />
        );
      case "console":
        return <ConsolePage serverUrl={serverUrl} />;
      case "settings":
        return (
          <SettingsPage
            serverUrl={serverUrl}
            onServerUrlChange={(u) => setServerUrlState(u)}
            paths={paths}
          />
        );
    }
  };

  return (
    <TooltipProvider>
      <div className="h-full flex overflow-hidden">
        <Sidebar page={view.page} onNavigate={navigate} badges={badges} />
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <ServerStatusBar
            serverUrl={serverUrl}
            onServerUrlChange={(u) => setServerUrlState(u)}
            health={health}
          />
          <DisconnectedBanner
            health={health}
            serverUrl={serverUrl}
            onRetry={bumpRefresh}
          />
          {renderPage()}
        </div>
      </div>
    </TooltipProvider>
  );
}
