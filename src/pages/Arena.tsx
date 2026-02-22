import { useCallback, useRef, useState } from "react";
import { ArenaLayout } from "@/components/ArenaLayout";
import { TranscriptionPanel } from "@/components/TranscriptionPanel";
import { AudioRecorder } from "@/components/AudioRecorder";
import { ComparisonBar } from "@/components/ComparisonBar";
import { useAudioCapture } from "@/hooks/useAudioCapture";
import { useRealtimeProvider } from "@/hooks/useRealtimeProvider";
import { useAppState } from "@/contexts/AppStateContext";
import { useToast } from "@/hooks/use-toast";

const Arena = () => {
  const [isRecording, setIsRecording] = useState(false);
  const { panelSelections, language } = useAppState();
  const { toast } = useToast();

  const p0 = useRealtimeProvider({ providerId: panelSelections[0], language, enabled: isRecording });
  const p1 = useRealtimeProvider({ providerId: panelSelections[1], language, enabled: isRecording });
  const p2 = useRealtimeProvider({ providerId: panelSelections[2], language, enabled: isRecording });
  const p3 = useRealtimeProvider({ providerId: panelSelections[3], language, enabled: isRecording });
  const providers = [p0, p1, p2, p3];
  const providersRef = useRef(providers);
  providersRef.current = providers;

  const onAudioChunk = useCallback((pcm: ArrayBuffer) => {
    providersRef.current.forEach((p) => p.addAudioChunk(pcm));
  }, []);

  const { start, stop, error: micError } = useAudioCapture({ onAudioChunk });

  const handleStart = async () => {
    console.log("[Arena] handleStart — panelSelections:", panelSelections, "language:", language);
    providers.forEach((p) => p.reset());
    const started = await start();
    console.log("[Arena] mic started:", started);
    if (started) {
      setIsRecording(true);
    }
  };

  const handleStop = () => {
    console.log("[Arena] handleStop");
    stop();
    setIsRecording(false);
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied to clipboard" });
  };

  const avgLatency = (arr: number[]) =>
    arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : undefined;

  return (
    <ArenaLayout>
      <div className="flex items-center justify-center mb-6">
        <AudioRecorder
          isRecording={isRecording}
          onStart={handleStart}
          onStop={handleStop}
          error={micError}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4" style={{ minHeight: "calc(100vh - 280px)" }}>
        {providers.map((p, i) => (
          <TranscriptionPanel
            key={i}
            panelIndex={i}
            transcript={p.fullText}
            status={p.status}
            latencyMs={avgLatency(p.latencyMs)}
            wordCount={p.wordCount}
            error={p.error ?? undefined}
            onCopy={() => handleCopy(p.fullText)}
            onClear={() => p.reset()}
          />
        ))}
      </div>

      <div className="mt-4">
        <ComparisonBar
          panels={providers.map((p, i) => ({
            providerId: panelSelections[i],
            wordCount: p.wordCount,
            latencyMs: p.latencyMs,
            status: p.status,
          }))}
        />
      </div>
    </ArenaLayout>
  );
};

export default Arena;
