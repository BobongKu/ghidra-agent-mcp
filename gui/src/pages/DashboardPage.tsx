import { DropZone } from "@/components/DropZone";
import { ImportPanel } from "@/components/ImportPanel";
import { ProgramsList } from "@/components/ProgramsList";
import { DockerLogsPanel } from "@/components/DockerLogsPanel";
import type { HealthState } from "@/hooks/useHealthPolling";
import type { ProjectPaths } from "@/lib/types";

interface Props {
  serverUrl: string;
  health: HealthState;
  paths: ProjectPaths | null;
  refreshKey: number;
  bumpRefresh: () => void;
}

/** Mostly the original 2-col dashboard, kept as a quick overview entry-point. */
export function DashboardPage({ serverUrl, health, paths, refreshKey, bumpRefresh }: Props) {
  return (
    <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 lg:grid-rows-1 gap-4 p-4">
      <section className="flex flex-col gap-4 min-h-0 h-full overflow-hidden">
        <DropZone serverUrl={serverUrl} onUploaded={bumpRefresh} />
        <ImportPanel
          serverUrl={serverUrl}
          binariesDir={paths?.binaries_dir ?? ""}
          loadedPrograms={health.data?.programs ?? []}
          onChanged={bumpRefresh}
          refreshKey={refreshKey}
        />
      </section>
      <section className="flex flex-col gap-4 min-h-0 h-full overflow-hidden">
        <ProgramsList
          serverUrl={serverUrl}
          programs={health.data?.programs ?? []}
          onChanged={bumpRefresh}
        />
        {/* Live container logs replace the prior Results card.
            Per-program results have moved into the Programs detail page. */}
        <DockerLogsPanel />
      </section>
    </div>
  );
}
