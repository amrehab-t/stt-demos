import { useState, useRef, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { TranscriptChunk, ProviderStatus } from "@/lib/types";

interface UseRealtimeProviderOptions {
  providerId: string | null;
  language: string;
  enabled: boolean;
}

// Accumulate PCM chunks and send every ~3 seconds for "pseudo-realtime"
const CHUNK_INTERVAL_MS = 3000;

export function useRealtimeProvider({ providerId, language, enabled }: UseRealtimeProviderOptions) {
  const [transcript, setTranscript] = useState<TranscriptChunk[]>([]);
  const [status, setStatus] = useState<ProviderStatus>("idle");
  const [latencyMs, setLatencyMs] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [wordCount, setWordCount] = useState(0);

  const bufferRef = useRef<ArrayBuffer[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const enabledRef = useRef(enabled);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const sendBufferedAudio = useCallback(async () => {
    if (!providerId || bufferRef.current.length === 0) return;

    // Merge all buffered chunks
    const totalLength = bufferRef.current.reduce((s, b) => s + b.byteLength, 0);
    const merged = new Uint8Array(totalLength);
    let offset = 0;
    for (const buf of bufferRef.current) {
      merged.set(new Uint8Array(buf), offset);
      offset += buf.byteLength;
    }
    bufferRef.current = [];

    // Convert to base64
    const base64 = btoa(String.fromCharCode(...merged));

    const sendTime = Date.now();
    setStatus("live");

    try {
      const { data, error: fnError } = await supabase.functions.invoke("stt-realtime", {
        body: { provider_id: providerId, language, audio: base64 },
      });

      if (fnError) {
        setError(fnError.message);
        setStatus("error");
        return;
      }

      if (data?.error) {
        setError(data.error);
        setStatus("error");
        return;
      }

      const latency = Date.now() - sendTime;
      setLatencyMs((prev) => [...prev, latency]);

      if (data?.transcript) {
        const chunk: TranscriptChunk = {
          text: data.transcript,
          isFinal: data.isFinal ?? true,
          timestampMs: Date.now(),
        };
        setTranscript((prev) => [...prev, chunk]);
        setWordCount((prev) => prev + (data.transcript.split(/\s+/).filter(Boolean).length));
      }

      if (enabledRef.current) {
        setStatus("live");
      }
    } catch (e: any) {
      setError(e.message);
      setStatus("error");
    }
  }, [providerId, language]);

  const addAudioChunk = useCallback((pcmBuffer: ArrayBuffer) => {
    if (!providerId || !enabledRef.current) return;
    bufferRef.current.push(pcmBuffer);
  }, [providerId]);

  // Start periodic sending when enabled
  useEffect(() => {
    if (enabled && providerId) {
      setStatus("connecting");
      // Small delay then set to live
      setTimeout(() => {
        if (enabledRef.current) setStatus("live");
      }, 500);

      timerRef.current = setInterval(() => {
        if (enabledRef.current) sendBufferedAudio();
      }, CHUNK_INTERVAL_MS);
    } else {
      // Send any remaining audio
      if (bufferRef.current.length > 0) {
        sendBufferedAudio();
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (!enabled) setStatus("idle");
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [enabled, providerId, sendBufferedAudio]);

  const reset = useCallback(() => {
    setTranscript([]);
    setLatencyMs([]);
    setError(null);
    setWordCount(0);
    setStatus("idle");
    bufferRef.current = [];
  }, []);

  const fullText = transcript.map((t) => t.text).join(" ");

  return {
    transcript,
    fullText,
    status,
    latencyMs,
    error,
    wordCount,
    addAudioChunk,
    reset,
  };
}
