import { useState, useRef, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { TranscriptChunk, ProviderStatus } from "@/lib/types";

interface UseRealtimeProviderOptions {
  providerId: string | null;
  language: string;
  enabled: boolean;
}

const WS_PROVIDERS = ["elevenlabs", "gemini", "google", "soniox"];
const CHUNK_INTERVAL_MS = 3000;

function parseProviderMessage(providerId: string, raw: string): { text: string; isFinal: boolean } | null {
  try {
    const msg = JSON.parse(raw);
    switch (providerId) {
      case "elevenlabs": {
        const text = msg.text ?? msg.words?.map((w: any) => w.text).join(" ") ?? "";
        return text ? { text, isFinal: msg.type === "transcript" } : null;
      }
      case "gemini": {
        const text = msg.serverContent?.modelTurn?.parts?.[0]?.text ?? "";
        return text ? { text, isFinal: true } : null;
      }
      case "google": {
        const result = msg.results?.[0];
        const text = result?.alternatives?.[0]?.transcript ?? "";
        return text ? { text, isFinal: result?.isFinal ?? false } : null;
      }
      case "soniox": {
        const text = (msg.words ?? [])
          .filter((w: any) => w.type === "word" || w.type === "punctuation")
          .map((w: any) => w.text)
          .join(" ");
        return text ? { text, isFinal: msg.final_proc_time_ms != null } : null;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

export function useRealtimeProvider({ providerId, language, enabled }: UseRealtimeProviderOptions) {
  const [transcript, setTranscript] = useState<TranscriptChunk[]>([]);
  const [status, setStatus] = useState<ProviderStatus>("idle");
  const [latencyMs, setLatencyMs] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [wordCount, setWordCount] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const sendTimeRef = useRef<number>(0);
  const enabledRef = useRef(enabled);
  const bufferRef = useRef<ArrayBuffer[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { enabledRef.current = enabled; }, [enabled]);

  const isWsProvider = providerId ? WS_PROVIDERS.includes(providerId) : false;

  // ── WebSocket path ──────────────────────────────────────────────────────────
  const connectWs = useCallback(async () => {
    if (!providerId || !WS_PROVIDERS.includes(providerId)) return;

    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) { setError("Not authenticated"); setStatus("error"); return; }

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
    const wssBase = supabaseUrl
      .replace("https://", "wss://")
      .replace("http://", "ws://");
    const wsUrl = `${wssBase}/functions/v1/stt-ws-relay?provider_id=${providerId}&language=${language}&token=${encodeURIComponent(token)}`;

    setStatus("connecting");
    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      if (enabledRef.current) setStatus("live");
    };

    ws.onmessage = (evt) => {
      const latency = Date.now() - sendTimeRef.current;
      setLatencyMs((prev) => [...prev, latency]);

      const parsed = parseProviderMessage(providerId, typeof evt.data === "string" ? evt.data : "");
      if (parsed?.text) {
        setTranscript((prev) => [...prev, { text: parsed.text, isFinal: parsed.isFinal, timestampMs: Date.now() }]);
        setWordCount((prev) => prev + parsed.text.split(/\s+/).filter(Boolean).length);
      }
    };

    ws.onerror = () => {
      setError("WebSocket error");
      setStatus("error");
    };

    ws.onclose = (evt) => {
      if (enabledRef.current && evt.code !== 1000) {
        setTimeout(() => { if (enabledRef.current) connectWs(); }, 1000);
      } else if (!enabledRef.current) {
        setStatus("idle");
      }
    };
  }, [providerId, language]);

  // ── Whisper HTTP fallback path ──────────────────────────────────────────────
  const sendBufferedAudio = useCallback(async () => {
    if (!providerId || bufferRef.current.length === 0) return;
    const totalLength = bufferRef.current.reduce((s, b) => s + b.byteLength, 0);
    const merged = new Uint8Array(totalLength);
    let offset = 0;
    for (const buf of bufferRef.current) { merged.set(new Uint8Array(buf), offset); offset += buf.byteLength; }
    bufferRef.current = [];
    const base64 = btoa(String.fromCharCode(...merged));
    const sendTime = Date.now();
    setStatus("live");
    try {
      const { data, error: fnError } = await supabase.functions.invoke("stt-realtime", {
        body: { provider_id: providerId, language, audio: base64 },
      });
      if (fnError) { setError(fnError.message); setStatus("error"); return; }
      if (data?.error) { setError(data.error); setStatus("error"); return; }
      setLatencyMs((prev) => [...prev, Date.now() - sendTime]);
      if (data?.transcript) {
        setTranscript((prev) => [...prev, { text: data.transcript, isFinal: data.isFinal ?? true, timestampMs: Date.now() }]);
        setWordCount((prev) => prev + data.transcript.split(/\s+/).filter(Boolean).length);
      }
      if (enabledRef.current) setStatus("live");
    } catch (e: any) { setError(e.message); setStatus("error"); }
  }, [providerId, language]);

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled || !providerId) {
      if (wsRef.current) { wsRef.current.close(1000, "disabled"); wsRef.current = null; }
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      if (!enabled) setStatus("idle");
      return;
    }

    if (isWsProvider) {
      connectWs();
    } else {
      setStatus("connecting");
      setTimeout(() => { if (enabledRef.current) setStatus("live"); }, 500);
      timerRef.current = setInterval(() => { if (enabledRef.current) sendBufferedAudio(); }, CHUNK_INTERVAL_MS);
    }

    return () => {
      if (wsRef.current) { wsRef.current.close(1000, "cleanup"); wsRef.current = null; }
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    };
  }, [enabled, providerId, connectWs, sendBufferedAudio, isWsProvider]);

  // ── addAudioChunk ──────────────────────────────────────────────────────────
  const addAudioChunk = useCallback((pcmBuffer: ArrayBuffer) => {
    if (!providerId || !enabledRef.current) return;
    if (isWsProvider) {
      sendTimeRef.current = Date.now();
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(pcmBuffer);
      }
    } else {
      bufferRef.current.push(pcmBuffer);
    }
  }, [providerId, isWsProvider]);

  const reset = useCallback(() => {
    setTranscript([]); setLatencyMs([]); setError(null); setWordCount(0); setStatus("idle");
    bufferRef.current = [];
    if (wsRef.current) { wsRef.current.close(1000, "reset"); wsRef.current = null; }
  }, []);

  return {
    transcript,
    fullText: transcript.map((t) => t.text).join(" "),
    status,
    latencyMs,
    error,
    wordCount,
    addAudioChunk,
    reset,
  };
}
