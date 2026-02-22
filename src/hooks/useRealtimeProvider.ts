import { useState, useRef, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { TranscriptChunk, ProviderStatus } from "@/lib/types";

interface UseRealtimeProviderOptions {
  providerId: string | null;
  language: string;
  enabled: boolean;
}

// google is intentionally excluded: standard WebSocket can't send Authorization headers,
// and Google STT requires OAuth2. Google uses HTTP polling (same as Whisper).
const WS_PROVIDERS = ["elevenlabs", "gemini", "soniox"];
const CHUNK_INTERVAL_MS = 3000;
const SONIOX_FINALIZE_TIMEOUT_MS = 5000;

/** Strip XML-like tags from provider error messages (e.g. Soniox's <organization_balance_exhausted>) */
function cleanErrorMessage(msg: string): string {
  return msg.replace(/<[^>]+>/g, "").trim();
}

interface ParsedMessage {
  text: string;
  isFinal: boolean;
  /** "replace" = cumulative full-stream (Soniox), "replace_partial" = cumulative per-utterance (ElevenLabs), "append" = incremental */
  mode: "append" | "replace" | "replace_partial";
}

function parseProviderMessage(providerId: string, raw: string): ParsedMessage | null {
  try {
    const msg = JSON.parse(raw);
    switch (providerId) {
      case "elevenlabs": {
        if (msg.message_type !== "partial_transcript" && msg.message_type !== "committed_transcript") return null;
        const text = msg.text ?? "";
        return text ? { text, isFinal: msg.message_type === "committed_transcript", mode: "replace_partial" } : null;
      }
      case "gemini": {
        // Native audio model may return transcript via inputAudioTranscription OR modelTurn
        const modelText = msg.serverContent?.modelTurn?.parts?.[0]?.text ?? "";
        const inputText = msg.serverContent?.inputTranscription?.text ?? "";
        const text = modelText || inputText;
        return text ? { text, isFinal: true, mode: "append" } : null;
      }
      case "google": {
        // Google STT sends cumulative per-utterance: same utterance revised until isFinal
        const result = msg.results?.[0];
        const text = result?.alternatives?.[0]?.transcript ?? "";
        return text ? { text, isFinal: result?.isFinal ?? false, mode: "replace_partial" } : null;
      }
      case "soniox": {
        // Current API: cumulative { tokens: [...] } — each message has ALL tokens
        if (msg.tokens) {
          const tokens = msg.tokens as any[];
          const finalText = tokens.filter((t) => t.is_final).map((t) => t.text).join("");
          const nonFinalText = tokens.filter((t) => !t.is_final).map((t) => t.text).join("");
          const text = finalText + nonFinalText;
          const isFinal = tokens.length > 0 && tokens.every((t) => t.is_final);
          return text ? { text, isFinal, mode: "replace" } : null;
        }
        // Legacy: cumulative { fw: [...], nfw: [...] }
        const fw = msg.fw ?? [];
        const nfw = msg.nfw ?? [];
        const allWords = [...fw, ...nfw];
        const text = allWords.map((w: any) => w.t ?? w.text ?? "").join(" ");
        const isFinal = fw.length > 0 && nfw.length === 0;
        return text ? { text, isFinal, mode: "replace" } : null;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/** Check if a Soniox message is the finished signal */
function isSonioxFinished(raw: string): boolean {
  try {
    const msg = JSON.parse(raw);
    // Current API: { finished: true }
    if (msg.finished === true) return true;
    // Legacy: empty fw+nfw with tpt > 0
    if (msg.fw && msg.nfw && msg.fw.length === 0 && msg.nfw.length === 0 && (msg.tpt ?? 0) > 0) return true;
  } catch { /* ignore */ }
  return false;
}

export function useRealtimeProvider({ providerId, language, enabled }: UseRealtimeProviderOptions) {
  const [transcript, setTranscript] = useState<TranscriptChunk[]>([]);
  const [status, setStatus] = useState<ProviderStatus>("idle");
  const [latencyMs, setLatencyMs] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [wordCount, setWordCount] = useState(0);
  const [rawMessages, setRawMessages] = useState<Array<{ ts: number; raw: string }>>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const sendTimeRef = useRef<number>(0);
  const enabledRef = useRef(enabled);
  const bufferRef = useRef<ArrayBuffer[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fatalErrorRef = useRef(false);
  const finalizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chunkCountRef = useRef(0);
  /** Buffer audio chunks while WS is still connecting */
  const pendingAudioRef = useRef<ArrayBuffer[]>([]);

  useEffect(() => { enabledRef.current = enabled; }, [enabled]);

  const isWsProvider = providerId ? WS_PROVIDERS.includes(providerId) : false;

  /** Clean up the finalize timeout */
  const clearFinalizeTimeout = useCallback(() => {
    if (finalizeTimeoutRef.current) {
      clearTimeout(finalizeTimeoutRef.current);
      finalizeTimeoutRef.current = null;
    }
  }, []);

  // ── WebSocket path ──────────────────────────────────────────────────────────
  const connectWs = useCallback(async () => {
    if (!providerId || !WS_PROVIDERS.includes(providerId)) return;

    // Clean up existing WS before opening a new one (e.g., language switch)
    if (wsRef.current) {
      const oldWs = wsRef.current;
      oldWs.onmessage = null;
      oldWs.onclose = null;
      oldWs.onerror = null;
      oldWs.close(1000, "reconnecting");
      wsRef.current = null;
    }
    // Reset state for the new connection
    setTranscript([]); setLatencyMs([]); setError(null); setWordCount(0); setRawMessages([]);
    pendingAudioRef.current = []; chunkCountRef.current = 0;
    clearFinalizeTimeout();

    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) { setError("Not authenticated"); setStatus("error"); return; }

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
    const wssBase = supabaseUrl
      .replace("https://", "wss://")
      .replace("http://", "ws://");
    const wsUrl = `${wssBase}/functions/v1/stt-ws-relay?provider_id=${providerId}&language=${language}&token=${encodeURIComponent(token)}`;

    console.log(`[useRealtimeProvider:${providerId}] connecting to relay`);
    fatalErrorRef.current = false;
    setStatus("connecting");
    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      console.log(`[useRealtimeProvider:${providerId}] WS open`);
      // Status stays "connecting" until relay sends relay_ready
      // Flush any audio chunks that arrived while WS was connecting
      if (pendingAudioRef.current.length > 0) {
        console.log(`[useRealtimeProvider:${providerId}] flushing ${pendingAudioRef.current.length} buffered chunks`);
        for (const buf of pendingAudioRef.current) {
          ws.send(buf);
        }
        pendingAudioRef.current = [];
      }
    };

    ws.onmessage = (evt) => {
      // Diagnostic logging
      if (typeof evt.data === "string") {
        console.log(`[useRealtimeProvider:${providerId}] msg (${evt.data.length}ch): ${evt.data.slice(0, 200)}`);
      } else {
        console.log(`[useRealtimeProvider:${providerId}] binary msg (${(evt.data as ArrayBuffer).byteLength}B)`);
      }

      if (typeof evt.data === "string") {
        try {
          const msg = JSON.parse(evt.data);
          if (msg.type === "relay_error") {
            const errorMsg = cleanErrorMessage(msg.message || "Provider error");
            console.error(`[useRealtimeProvider:${providerId}] relay error: ${errorMsg}`);
            setError(errorMsg);
            setStatus("error");
            fatalErrorRef.current = true;
            return;
          }
          if (msg.type === "relay_ready") {
            console.log(`[useRealtimeProvider:${providerId}] relay_ready received`);
            if (enabledRef.current) setStatus("live");
            return;
          }
        } catch { /* not JSON, continue to provider parser */ }
      }

      // Capture raw message for debug panel (relay control messages already returned above)
      if (typeof evt.data === "string") {
        setRawMessages(prev => {
          const updated = [...prev, { ts: Date.now(), raw: evt.data as string }];
          return updated.length > 200 ? updated.slice(-200) : updated;
        });
      }

      const latency = Date.now() - sendTimeRef.current;
      setLatencyMs((prev) => [...prev, latency]);

      const parsed = parseProviderMessage(providerId, typeof evt.data === "string" ? evt.data : "");
      if (parsed?.text) {
        if (parsed.mode === "replace") {
          // Cumulative full-stream mode (Soniox): replace entire transcript
          setTranscript([{ text: parsed.text, isFinal: parsed.isFinal, timestampMs: Date.now() }]);
          setWordCount(parsed.text.split(/\s+/).filter(Boolean).length);
        } else if (parsed.mode === "replace_partial") {
          // Cumulative per-utterance mode (ElevenLabs): replace last non-final entry
          let newWordCount = 0;
          setTranscript((prev) => {
            const now = Date.now();
            const entry = { text: parsed.text, isFinal: parsed.isFinal, timestampMs: now };
            const lastIdx = prev.length - 1;
            let updated;
            if (lastIdx >= 0 && !prev[lastIdx].isFinal) {
              updated = [...prev.slice(0, lastIdx), entry];
            } else {
              updated = [...prev, entry];
            }
            newWordCount = updated.map(t => t.text).join(" ").split(/\s+/).filter(Boolean).length;
            return updated;
          });
          setWordCount(newWordCount);
        } else {
          // Incremental mode (Gemini, Google, Whisper): append
          setTranscript((prev) => [...prev, { text: parsed.text, isFinal: parsed.isFinal, timestampMs: Date.now() }]);
          setWordCount((prev) => prev + parsed.text.split(/\s+/).filter(Boolean).length);
        }
      }

      // Detect Soniox finished signal → close WS gracefully
      if (providerId === "soniox" && typeof evt.data === "string" && isSonioxFinished(evt.data)) {
        console.log(`[useRealtimeProvider:${providerId}] finished signal received, closing WS`);
        clearFinalizeTimeout();
        ws.close(1000, "finished");
        wsRef.current = null;
      }
    };

    ws.onerror = () => {
      console.error(`[useRealtimeProvider:${providerId}] WS error`);
      if (!fatalErrorRef.current) {
        setError("WebSocket connection failed");
        setStatus("error");
      }
    };

    ws.onclose = (evt) => {
      console.log(`[useRealtimeProvider:${providerId}] WS closed — code:${evt.code} reason:"${evt.reason}"`);
      clearFinalizeTimeout();
      if (fatalErrorRef.current) {
        // Don't reconnect on provider errors (auth, billing, etc.)
        return;
      }
      if (evt.reason && evt.code !== 1000) {
        setError(cleanErrorMessage(evt.reason));
        setStatus("error");
      }
      if (enabledRef.current && evt.code !== 1000) {
        setTimeout(() => { if (enabledRef.current && !fatalErrorRef.current) connectWs(); }, 2000);
      } else if (!enabledRef.current) {
        setStatus("idle");
      }
    };
  }, [providerId, language, clearFinalizeTimeout]);

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
      if (wsRef.current) {
        const ws = wsRef.current;
        if (providerId === "soniox" && ws.readyState === WebSocket.OPEN) {
          // Send finalize control message before closing, keep WS open for final tokens
          console.log(`[useRealtimeProvider:${providerId}] sending finalize before close`);
          ws.send(JSON.stringify({ type: "finalize" }));
          finalizeTimeoutRef.current = setTimeout(() => {
            console.log(`[useRealtimeProvider:${providerId}] finalize timeout, force-closing WS`);
            if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
              wsRef.current.close(1000, "finalize-timeout");
            }
            wsRef.current = null;
          }, SONIOX_FINALIZE_TIMEOUT_MS);
        } else {
          ws.close(1000, "disabled");
          wsRef.current = null;
        }
      }
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
      clearFinalizeTimeout();
      if (wsRef.current) {
        wsRef.current.onmessage = null;
        wsRef.current.onclose = null;
        wsRef.current.onerror = null;
        if (providerId === "soniox" && wsRef.current.readyState === WebSocket.OPEN) {
          try { wsRef.current.send(JSON.stringify({ type: "finalize" })); } catch { /* ignore */ }
        }
        wsRef.current.close(1000, "cleanup");
        wsRef.current = null;
      }
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    };
  }, [enabled, providerId, connectWs, sendBufferedAudio, isWsProvider, clearFinalizeTimeout]);

  // ── addAudioChunk ──────────────────────────────────────────────────────────
  const addAudioChunk = useCallback((pcmBuffer: ArrayBuffer) => {
    if (!providerId || !enabledRef.current) return;
    if (isWsProvider) {
      chunkCountRef.current++;
      sendTimeRef.current = Date.now();
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(pcmBuffer);
        if (chunkCountRef.current % 50 === 1) {
          console.log(`[useRealtimeProvider:${providerId}] sent chunk #${chunkCountRef.current} (${pcmBuffer.byteLength}B)`);
        }
      } else if (wsRef.current?.readyState === WebSocket.CONNECTING) {
        // Buffer audio while WS is still connecting — will be flushed on open
        pendingAudioRef.current.push(pcmBuffer);
        if (chunkCountRef.current <= 3) {
          console.log(`[useRealtimeProvider:${providerId}] buffering chunk #${chunkCountRef.current} (WS connecting)`);
        }
      }
    } else {
      bufferRef.current.push(pcmBuffer);
    }
  }, [providerId, isWsProvider]);

  const reset = useCallback(() => {
    setTranscript([]); setLatencyMs([]); setError(null); setWordCount(0); setRawMessages([]); setStatus("idle");
    bufferRef.current = [];
    pendingAudioRef.current = [];
    chunkCountRef.current = 0;
    fatalErrorRef.current = false;
    clearFinalizeTimeout();
    if (wsRef.current) { wsRef.current.close(1000, "reset"); wsRef.current = null; }
  }, [clearFinalizeTimeout]);

  return {
    transcript,
    fullText: transcript.map((t) => t.text).join(" "),
    status,
    latencyMs,
    error,
    wordCount,
    addAudioChunk,
    reset,
    rawMessages,
  };
}
