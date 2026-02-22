import { ArenaLayout } from "@/components/ArenaLayout";
import { TranscriptionPanel } from "@/components/TranscriptionPanel";
import { useCallback, useState, useRef } from "react";
import { Upload, Play, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAsyncProvider } from "@/hooks/useAsyncProvider";
import { useAppState } from "@/contexts/AppStateContext";
import { useToast } from "@/hooks/use-toast";

const Batch = () => {
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { panelSelections, language } = useAppState();
  const { toast } = useToast();

  const p0 = useAsyncProvider({ providerId: panelSelections[0], language });
  const p1 = useAsyncProvider({ providerId: panelSelections[1], language });
  const p2 = useAsyncProvider({ providerId: panelSelections[2], language });
  const p3 = useAsyncProvider({ providerId: panelSelections[3], language });
  const providers = [p0, p1, p2, p3];

  const handleFile = useCallback((f: File) => {
    const maxSize = 25 * 1024 * 1024;
    if (f.size > maxSize) {
      toast({ title: "File too large", description: "Max 25MB", variant: "destructive" });
      return;
    }
    setFile(f);
    providers.forEach((p) => p.reset());
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
    },
    [handleFile]
  );

  const handleProcess = () => {
    if (!file) return;
    providers.forEach((p) => {
      p.reset();
      p.process(file);
    });
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied to clipboard" });
  };

  const handleExport = (providerId: string | null, transcript: string, format: "txt" | "json") => {
    const content = format === "json"
      ? JSON.stringify({ provider: providerId, transcript, exportedAt: new Date().toISOString() }, null, 2)
      : transcript;
    const blob = new Blob([content], { type: format === "json" ? "application/json" : "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transcript-${providerId || "unknown"}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const isProcessing = providers.some((p) => p.status === "uploading" || p.status === "processing");
  const hasResults = providers.some((p) => p.status === "done");

  return (
    <ArenaLayout>
      {/* Upload zone */}
      <div
        className={`mb-4 rounded-lg border-2 border-dashed p-6 text-center cursor-pointer transition-colors ${
          dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept=".mp3,.wav,.m4a,.ogg,.flac,.webm"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
        <Upload className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />
        {file ? (
          <div>
            <p className="text-sm font-medium text-foreground">{file.name}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {(file.size / 1024 / 1024).toFixed(2)} MB
            </p>
          </div>
        ) : (
          <div>
            <p className="text-sm font-medium text-foreground">Drop audio file or click to upload</p>
            <p className="text-xs text-muted-foreground mt-1">.mp3, .wav, .m4a, .ogg, .flac — max 25MB</p>
          </div>
        )}
      </div>

      {/* Process button */}
      <div className="flex items-center justify-center gap-3 mb-4">
        <Button
          size="lg"
          className="gap-2"
          disabled={!file || isProcessing}
          onClick={handleProcess}
        >
          <Play className="h-4 w-4" />
          {isProcessing ? "Processing…" : "Process All Providers"}
        </Button>
        {hasResults && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1"
            onClick={() => {
              providers.forEach((p, i) => {
                if (p.transcript) handleExport(panelSelections[i], p.transcript, "json");
              });
            }}
          >
            <Download className="h-3.5 w-3.5" />
            Export All
          </Button>
        )}
      </div>

      {/* 2x2 grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4" style={{ minHeight: "calc(100vh - 380px)" }}>
        {providers.map((p, i) => (
          <TranscriptionPanel
            key={i}
            panelIndex={i}
            transcript={p.transcript}
            status={p.status}
            latencyMs={p.processingTimeMs}
            wordCount={p.wordCount}
            error={p.error ?? undefined}
            onCopy={() => handleCopy(p.transcript)}
            onClear={() => p.reset()}
            onRetry={() => file && p.process(file)}
          />
        ))}
      </div>
    </ArenaLayout>
  );
};

export default Batch;
