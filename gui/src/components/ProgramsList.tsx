import { useEffect, useState } from "react";
import { Cpu, Layers, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { closeProgram, getPrograms } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { ProgramInfo } from "@/lib/types";

interface Props {
  serverUrl: string;
  programs: string[];
  onChanged: () => void;
}

export function ProgramsList({ serverUrl, programs, onChanged }: Props) {
  const [details, setDetails] = useState<ProgramInfo[]>([]);
  const [closing, setClosing] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (programs.length === 0) { setDetails([]); return; }
    getPrograms(serverUrl)
      .then((d) => alive && setDetails(d))
      .catch(() => alive && setDetails([]));
    return () => { alive = false; };
  }, [serverUrl, programs.join("|")]);

  const handleClose = async (name: string) => {
    setClosing(name);
    try { await closeProgram(name, serverUrl); onChanged(); }
    catch { /* noop */ }
    finally { setClosing(null); }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center gap-2 space-y-0 py-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Layers className="size-4 text-primary" />
          Loaded programs
          <Badge variant="secondary" className="font-mono text-[10px]">{details.length}</Badge>
        </CardTitle>
      </CardHeader>

      <CardContent>
        {details.length === 0 ? (
          <div className="text-sm text-muted-foreground py-6 text-center">
            No programs loaded. Drop a binary or click Import.
          </div>
        ) : (
          <ScrollArea className="max-h-[260px]">
            <div className="grid gap-2.5 sm:grid-cols-2 pr-1">
              {details.map((p) => (
                <div
                  key={p.name}
                  className={cn(
                    "relative rounded-md p-3 transition-colors bg-muted/30",
                    p.is_current ? "border-2 border-primary" : "border border-border"
                  )}
                >
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => handleClose(p.name)}
                    disabled={closing === p.name}
                    className="absolute top-1 right-1 h-6 w-6 hover:text-destructive"
                    title="Close program"
                  >
                    <X className="size-3.5" />
                  </Button>
                  <div className="text-[13px] font-medium truncate pr-5" title={p.name}>
                    {p.name}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1.5 flex items-center gap-2 flex-wrap font-mono">
                    <span className="inline-flex items-center gap-1"><Cpu className="size-3" />{p.language}</span>
                    <span className="text-muted-foreground/50">·</span>
                    <span>{p.format}</span>
                    <span className="text-muted-foreground/50">·</span>
                    <span>{p.functions} fns</span>
                  </div>
                  {p.is_current && (
                    <Badge className="mt-2 font-mono text-[10px]">current</Badge>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
