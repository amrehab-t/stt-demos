import { PROVIDERS } from "@/lib/providers";
import type { ProviderStatus } from "@/lib/types";

interface PanelStats {
  providerId: string | null;
  wordCount: number;
  latencyMs: number[];
  status: ProviderStatus;
}

interface ComparisonBarProps {
  panels: PanelStats[];
}

export function ComparisonBar({ panels }: ComparisonBarProps) {
  const active = panels.filter((p) => p.providerId);

  if (active.length === 0) return null;

  return (
    <div className="border-t bg-card p-3">
      <div className="flex items-center gap-6 text-xs overflow-x-auto">
        {active.map((panel, i) => {
          const provider = PROVIDERS.find((p) => p.id === panel.providerId);
          const avgLatency =
            panel.latencyMs.length > 0
              ? Math.round(panel.latencyMs.reduce((a, b) => a + b, 0) / panel.latencyMs.length)
              : 0;

          return (
            <div key={i} className="flex items-center gap-3 shrink-0">
              <span className="font-medium">
                {provider?.logo} {provider?.shortName ?? panel.providerId}
              </span>
              <span className="text-muted-foreground">
                {panel.wordCount} words
              </span>
              {avgLatency > 0 && (
                <span className="text-muted-foreground">
                  ~{avgLatency}ms
                </span>
              )}
              <StatusDot status={panel.status} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: ProviderStatus }) {
  const colors: Record<ProviderStatus, string> = {
    idle: "bg-muted-foreground",
    connecting: "bg-warning animate-pulse",
    live: "bg-success animate-pulse",
    uploading: "bg-primary animate-pulse",
    processing: "bg-primary animate-pulse",
    done: "bg-success",
    error: "bg-destructive",
  };

  return <span className={`h-2 w-2 rounded-full ${colors[status]}`} />;
}
