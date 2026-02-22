import { useState } from "react";
import { useAppState } from "@/contexts/AppStateContext";
import { PROVIDERS } from "@/lib/providers";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Copy, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProviderStatus } from "@/lib/types";

interface TranscriptionPanelProps {
  panelIndex: number;
  transcript?: string;
  status?: ProviderStatus;
  latencyMs?: number;
  wordCount?: number;
  error?: string;
  rawMessages?: Array<{ ts: number; raw: string }>;
  onCopy?: () => void;
  onClear?: () => void;
  onRetry?: () => void;
}

const statusColors: Record<ProviderStatus, string> = {
  idle: "bg-muted text-muted-foreground",
  connecting: "bg-warning/20 text-warning",
  live: "bg-success/20 text-success",
  uploading: "bg-primary/20 text-primary",
  processing: "bg-primary/20 text-primary",
  done: "bg-success/20 text-success",
  error: "bg-destructive/20 text-destructive",
};

export function TranscriptionPanel({
  panelIndex,
  transcript = "",
  status = "idle",
  latencyMs,
  wordCount,
  error,
  rawMessages = [],
  onCopy,
  onClear,
  onRetry,
}: TranscriptionPanelProps) {
  const [showRaw, setShowRaw] = useState(false);
  const { panelSelections, setPanelProvider } = useAppState();
  const selectedId = panelSelections[panelIndex];
  const provider = PROVIDERS.find((p) => p.id === selectedId);

  return (
    <div className="flex flex-col rounded-lg border border-border bg-card overflow-hidden h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {provider && <span className="text-lg">{provider.logo}</span>}
          <Select
            value={selectedId ?? "none"}
            onValueChange={(v) => setPanelProvider(panelIndex, v === "none" ? null : v)}
          >
            <SelectTrigger className="h-7 text-xs border-0 bg-transparent shadow-none w-[140px]">
              <SelectValue placeholder="Select provider" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {PROVIDERS.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.logo} {p.shortName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          {status !== "idle" && (
            <Badge variant="secondary" className={cn("text-[10px] h-5", statusColors[status])}>
              {status === "live" && <span className="inline-block w-1.5 h-1.5 rounded-full bg-success mr-1 animate-pulse-live" />}
              {status}
            </Badge>
          )}
          {latencyMs !== undefined && latencyMs > 0 && (
            <Badge variant="outline" className="text-[10px] h-5 font-mono">
              {latencyMs}ms
            </Badge>
          )}
        </div>
      </div>

      {/* Transcript area */}
      <div className="flex-1 p-3 overflow-y-auto min-h-[140px] relative" aria-live="polite">
        {!selectedId ? (
          <p className="text-sm text-muted-foreground italic">Select a provider</p>
        ) : error ? (
          <div className="text-sm text-destructive">
            <p className="mb-2">{error}</p>
            {onRetry && (
              <Button size="sm" variant="outline" onClick={onRetry} className="text-xs">
                Retry
              </Button>
            )}
          </div>
        ) : transcript ? (
          <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{transcript}</p>
        ) : (
          <p className="text-sm text-muted-foreground italic">
            {status === "idle" ? "Waiting to start…" : "Listening…"}
          </p>
        )}
      </div>

      {/* Raw messages panel */}
      {rawMessages.length > 0 && (
        <div className="border-t border-border">
          <button
            onClick={() => setShowRaw(!showRaw)}
            className="flex items-center gap-1 px-3 py-1 text-[10px] text-muted-foreground hover:text-foreground w-full"
          >
            {showRaw ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            Raw ({rawMessages.length})
          </button>
          {showRaw && (
            <div className="max-h-[200px] overflow-y-auto px-3 pb-2">
              {rawMessages.map((msg, idx) => (
                <pre
                  key={idx}
                  className="text-[10px] font-mono text-muted-foreground bg-muted/50 rounded p-1 mb-1 whitespace-pre-wrap break-all"
                >
                  {(() => {
                    try { return JSON.stringify(JSON.parse(msg.raw), null, 2); }
                    catch { return msg.raw; }
                  })()}
                </pre>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between px-3 py-1.5 border-t border-border bg-muted/20 text-xs text-muted-foreground">
        <span>{wordCount ? `${wordCount} words` : ""}</span>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onCopy} disabled={!transcript}>
            <Copy className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClear} disabled={!transcript}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}
