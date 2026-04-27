import {
  LayoutDashboard, Boxes, Terminal, Search,
  Settings as SettingsIcon, Upload,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type Page = "dashboard" | "programs" | "search" | "console" | "settings";

interface NavItem {
  page: Page;
  label: string;
  icon: typeof LayoutDashboard;
}

const NAV: NavItem[] = [
  { page: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { page: "programs",  label: "Programs",  icon: Boxes },
  { page: "search",    label: "Search",    icon: Search },
  { page: "console",   label: "Console",   icon: Terminal },
  { page: "settings",  label: "Settings",  icon: SettingsIcon },
];

interface Props {
  page: Page;
  onNavigate: (p: Page) => void;
  /** Optional badge counts per page for live indicators */
  badges?: Partial<Record<Page, number>>;
}

export function Sidebar({ page, onNavigate, badges }: Props) {
  return (
    <aside className="w-[180px] shrink-0 border-r bg-card flex flex-col">
      <div className="px-3 py-3 border-b">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
          <Upload className="size-3" /> ghidra-agent
        </div>
      </div>
      <nav className="flex-1 p-2 space-y-1">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = page === item.page;
          const badge = badges?.[item.page];
          return (
            <button
              key={item.page}
              onClick={() => onNavigate(item.page)}
              className={cn(
                "w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] transition-colors",
                "border border-transparent",
                active
                  ? "bg-primary/15 text-foreground border-primary/40"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              <Icon className="size-4 shrink-0" />
              <span className="flex-1 text-left">{item.label}</span>
              {badge != null && badge > 0 && (
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-primary text-primary-foreground">
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>
      <div className="p-2 border-t text-[10px] text-muted-foreground/70 font-mono">
        v1.0.0
      </div>
    </aside>
  );
}
