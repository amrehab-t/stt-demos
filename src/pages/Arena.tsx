import { useCallback, useEffect, useRef, useState } from "react";
import { ArenaLayout } from "@/components/ArenaLayout";
import { TranscriptionPanel } from "@/components/TranscriptionPanel";
import { AudioRecorder } from "@/components/AudioRecorder";
import { ComparisonBar } from "@/components/ComparisonBar";
import { useAudioCapture } from "@/hooks/useAudioCapture";
import { useRealtimeProvider } from "@/hooks/useRealtimeProvider";
import { useAppState } from "@/contexts/AppStateContext";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

const Arena = () => {
  const [isRecording, setIsRecording] = useState(false);
  const { panelSelections, language } = useAppState();
  const { user } = useAuth();
  const { toast } = useToast();
  const sessionStartRef = useRef<Date | null>(null);
  const savePendingRef = useRef(false);

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
    sessionStartRef.current = new Date();
    savePendingRef.current = false;
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
    savePendingRef.current = true;
  };

  // Auto-save session when recording stops and all providers have settled
  useEffect(() => {
    if (isRecording || !savePendingRef.current || !user) return;

    const activeProviders = providers.filter((_, i) => panelSelections[i] != null);
    if (activeProviders.length === 0) {
      savePendingRef.current = false;
      return;
    }

    const allSettled = activeProviders.every(
      (p) => p.status === "idle" || p.status === "done" || p.status === "error"
    );

    if (!allSettled) {
      // Safety timeout: force save after 8s even if providers haven't settled
      const timeout = setTimeout(() => {
        if (savePendingRef.current) {
          console.log("[Arena] safety timeout: saving with current state");
          savePendingRef.current = false;
          doSave();
        }
      }, 8000);
      return () => clearTimeout(timeout);
    }

    savePendingRef.current = false;
    doSave();

    async function doSave() {
      try {
        const { data: session, error: sessionError } = await supabase
          .from("sessions")
          .insert({
            user_id: user!.id,
            mode: "realtime" as string,
            language,
            started_at: sessionStartRef.current?.toISOString() ?? new Date().toISOString(),
            ended_at: new Date().toISOString(),
          })
          .select("id")
          .single();

        if (sessionError || !session) {
          console.error("[Arena] session save error:", sessionError);
          return;
        }

        const results = providersRef.current
          .map((p, i) => ({
            session_id: session.id,
            panel_index: i,
            provider_id: panelSelections[i]!,
            transcript: p.fullText || null,
            latency_ms: p.latencyMs as any,
            word_count: p.wordCount,
            status: p.status,
            error: p.error || null,
          }))
          .filter((r) => r.provider_id != null);

        if (results.length > 0) {
          const { error: resultsError } = await supabase
            .from("session_results")
            .insert(results);
          if (resultsError) console.error("[Arena] results save error:", resultsError);
        }

        console.log("[Arena] session saved:", session.id);
        toast({ title: "Session saved" });
      } catch (e) {
        console.error("[Arena] save error:", e);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRecording, user, p0.status, p1.status, p2.status, p3.status]);

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
            rawMessages={p.rawMessages}
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
