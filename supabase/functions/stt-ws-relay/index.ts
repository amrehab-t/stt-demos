import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_PROVIDERS = ["elevenlabs", "gemini", "gemini3", "google", "soniox"];
const LANGUAGE_REGEX = /^[a-z]{2}(-[A-Z]{2})?$|^auto$/;
const SONIOX_FINALIZE_TIMEOUT_MS = 5000;

const ISO639_1_TO_3: Record<string, string> = {
  en: "eng", es: "spa", fr: "fra", de: "deu", pt: "por",
  ja: "jpn", zh: "zho", ko: "kor", ar: "ara", hi: "hin",
  it: "ita", nl: "nld", ru: "rus",
};
function toIso3(lang: string): string {
  return ISO639_1_TO_3[lang] ?? lang;
}

function isAllowedOrigin(origin: string): boolean {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    return (
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname.endsWith(".lovable.app") ||
      url.hostname.endsWith(".supabase.co")
    );
  } catch {
    return false;
  }
}

function getAdminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}

async function decryptKey(adminClient: ReturnType<typeof getAdminClient>, encryptedKey: string): Promise<string> {
  const { data, error } = await adminClient.rpc("decrypt_api_key", {
    encrypted_key: encryptedKey,
    encryption_key: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  });
  if (error) throw error;
  return data;
}

// ── Soniox API version support ────────────────────────────────────────────────
type SonioxApiVersion = "current" | "legacy";

function buildUpstreamUrl(providerId: string, apiKey: string, language: string, sonioxApi?: SonioxApiVersion): string {
  switch (providerId) {
    case "elevenlabs": {
      const langParam = language && language !== "auto" ? `&language_code=${language}` : "";
      return `wss://api.elevenlabs.io/v1/speech-to-text/realtime?model_id=scribe_v2_realtime${langParam}`;
    }
    case "gemini":
      return `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(apiKey)}`;
    case "google":
      return `wss://speech.googleapis.com/v1/speech:streamingRecognize`;
    case "soniox":
      return sonioxApi === "legacy"
        ? `wss://api.soniox.com/transcribe-websocket`
        : `wss://stt-rt.soniox.com/transcribe-websocket`;
    default:
      throw new Error("Unsupported provider");
  }
}

function buildInitMessage(providerId: string, apiKey: string, language: string, sonioxApi?: SonioxApiVersion): string | null {
  switch (providerId) {
    case "soniox": {
      if (sonioxApi === "legacy") {
        const msg: Record<string, any> = {
          api_key: apiKey,
          sample_rate_hertz: 16000,
          num_audio_channels: 1,
        };
        if (language && language !== "auto") {
          msg.language_code = language;
        }
        return JSON.stringify(msg);
      }
      // Current API
      const msg: Record<string, any> = {
        api_key: apiKey,
        model: "stt-rt-preview",
        audio_format: "pcm_s16le",
        sample_rate: 16000,
        num_channels: 1,
      };
      if (language && language !== "auto") {
        msg.language_hints = [language];
      }
      return JSON.stringify(msg);
    }
    case "google":
      return JSON.stringify({
        streamingConfig: {
          config: {
            encoding: "LINEAR16",
            sampleRateHertz: 16000,
            languageCode: language === "auto" ? "en-US" : (language || "en-US"),
            enableAutomaticPunctuation: true,
          },
          interimResults: true,
        },
      });
    case "gemini":
      return JSON.stringify({
        setup: {
          model: "models/gemini-live-2.5-flash-native-audio",
          generationConfig: { responseModalities: ["TEXT"] },
          inputAudioTranscription: {},
          systemInstruction: {
            parts: [{ text: language === "auto"
              ? "You are a speech-to-text transcription engine. Transcribe all audio you receive to text, auto-detecting the language. Return only the transcription text."
              : `You are a speech-to-text transcription engine. Transcribe all audio you receive to text in ${language}. Return only the transcription text.` }],
          },
        },
      });
    case "elevenlabs":
      return null;
    default:
      return null;
  }
}

/** Send the appropriate Soniox finalize signal based on API version */
function sendSonioxFinalize(ws: WebSocket, sonioxApi: SonioxApiVersion) {
  if (sonioxApi === "legacy") {
    ws.send(new Uint8Array(0));
  } else {
    ws.send("");
  }
}

/** Check if a Soniox upstream message indicates the stream is finished */
function isSonioxFinished(data: string, sonioxApi: SonioxApiVersion): boolean {
  try {
    const msg = JSON.parse(data);
    if (sonioxApi === "current" && msg.finished === true) return true;
    // Legacy: empty fw+nfw with tpt > 0 means done
    if (sonioxApi === "legacy" && msg.fw && msg.nfw && msg.fw.length === 0 && msg.nfw.length === 0 && (msg.tpt ?? 0) > 0) return true;
  } catch { /* ignore */ }
  return false;
}

// ── Soniox upstream connection with fallback ──────────────────────────────────
function connectSonioxUpstream(
  apiKey: string,
  language: string,
  timeoutMs: number,
): Promise<{ ws: WebSocket; apiVersion: SonioxApiVersion }> {
  return new Promise((resolve, reject) => {
    const currentUrl = buildUpstreamUrl("soniox", apiKey, language, "current");
    console.log(`[stt-ws-relay] soniox: trying current API: ${currentUrl.split("?")[0]}`);
    const ws = new WebSocket(currentUrl);
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        console.log(`[stt-ws-relay] soniox: current API timed out after ${timeoutMs}ms, falling back to legacy`);
        try { ws.close(); } catch { /* ignore */ }
        tryLegacy();
      }
    }, timeoutMs);

    ws.onopen = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        console.log(`[stt-ws-relay] soniox: current API connected`);
        resolve({ ws, apiVersion: "current" });
      }
    };

    ws.onerror = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        console.log(`[stt-ws-relay] soniox: current API failed, falling back to legacy`);
        try { ws.close(); } catch { /* ignore */ }
        tryLegacy();
      }
    };

    function tryLegacy() {
      const legacyUrl = buildUpstreamUrl("soniox", apiKey, language, "legacy");
      console.log(`[stt-ws-relay] soniox: trying legacy API: ${legacyUrl.split("?")[0]}`);
      const legacyWs = new WebSocket(legacyUrl);

      legacyWs.onopen = () => {
        console.log(`[stt-ws-relay] soniox: legacy API connected`);
        resolve({ ws: legacyWs, apiVersion: "legacy" });
      };

      legacyWs.onerror = (e) => {
        console.error(`[stt-ws-relay] soniox: legacy API also failed:`, e);
        try { legacyWs.close(); } catch { /* ignore */ }
        reject(new Error("Both Soniox endpoints unreachable"));
      };
    }
  });
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") || "";
  const corsHeaders = {
    "Access-Control-Allow-Origin": isAllowedOrigin(origin) ? origin : "*",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const upgrade = req.headers.get("upgrade") || "";
  if (upgrade.toLowerCase() !== "websocket") {
    return new Response(JSON.stringify({ error: "WebSocket upgrade required" }), {
      status: 426,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  const providerId = url.searchParams.get("provider_id") || "";
  const language = url.searchParams.get("language") || "en";
  const token = url.searchParams.get("token") || "";

  if (!ALLOWED_PROVIDERS.includes(providerId)) {
    return new Response(JSON.stringify({ error: "Invalid provider_id" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const safeLanguage = LANGUAGE_REGEX.test(language) ? language : "en";

  if (!token) {
    return new Response(JSON.stringify({ error: "Missing token" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Authenticate the user via their token
  const authClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  const { data: { user }, error: userError } = await authClient.auth.getUser();
  if (userError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Use admin client to fetch encrypted key (bypasses RLS)
  const adminClient = getAdminClient();

  const { data: keyData, error: keyError } = await adminClient
    .from("api_keys")
    .select("encrypted_key")
    .eq("user_id", user.id)
    .eq("provider_id", providerId)
    .single();

  if (keyError || !keyData) {
    return new Response(
      JSON.stringify({ error: "No API key configured for this provider. Add it in Settings." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  let apiKey: string;
  try {
    apiKey = await decryptKey(adminClient, keyData.encrypted_key);
  } catch (e) {
    console.error(`[stt-ws-relay] decrypt error (${providerId}):`, e);
    return new Response(JSON.stringify({ error: "Failed to retrieve API key" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { socket: clientWs, response } = Deno.upgradeWebSocket(req);

  clientWs.onopen = async () => {
    let upstreamWs: WebSocket;
    const audioQueue: (string | ArrayBuffer | Uint8Array)[] = [];
    let upstreamReady = false;
    let clientDisconnected = false;
    let sonioxApi: SonioxApiVersion = "current";
    let audioPacketCount = 0;
    let finalizeTimeoutId: ReturnType<typeof setTimeout> | null = null;

    // ── Helper: send finalize to Soniox upstream + set timeout ──────────────
    function triggerSonioxFinalize(reason: string) {
      if (upstreamWs.readyState !== WebSocket.OPEN) return;
      sendSonioxFinalize(upstreamWs, sonioxApi);
      console.log(`[stt-ws-relay] soniox finalize sent (${sonioxApi} API, ${reason})`);

      if (!finalizeTimeoutId) {
        finalizeTimeoutId = setTimeout(() => {
          console.log(`[stt-ws-relay] soniox finalize timeout (${SONIOX_FINALIZE_TIMEOUT_MS}ms), closing upstream`);
          if (upstreamWs.readyState === WebSocket.OPEN) {
            upstreamWs.close(1000, "Finalize timeout");
          }
        }, SONIOX_FINALIZE_TIMEOUT_MS);
      }
    }

    // ── Connect upstream ────────────────────────────────────────────────────
    try {
      if (providerId === "soniox") {
        // Try current endpoint first, fall back to legacy
        const result = await connectSonioxUpstream(apiKey, safeLanguage, 3000);
        upstreamWs = result.ws;
        sonioxApi = result.apiVersion;

        // The WS is already open (resolved in onopen), send init + flush
        const initMsg = buildInitMessage(providerId, apiKey, safeLanguage, sonioxApi);
        if (initMsg) upstreamWs.send(initMsg);
        console.log(`[stt-ws-relay] soniox init sent (${sonioxApi} API)`);

        // Send silence warm-up to prime Soniox's audio pipeline
        const silenceBuffer = new Uint8Array(320); // 10ms of 16kHz PCM16 silence
        upstreamWs.send(silenceBuffer);

        // Wait for Soniox to process init before flushing buffered audio
        const queueSize = audioQueue.length;
        if (queueSize > 0) {
          console.log(`[stt-ws-relay] soniox: waiting 150ms before flushing ${queueSize} buffered packets`);
          await new Promise(resolve => setTimeout(resolve, 150));
        }

        upstreamReady = true;

        if (audioQueue.length > 0) {
          console.log(`[stt-ws-relay] flushing ${audioQueue.length} buffered audio packets (soniox)`);
          while (audioQueue.length > 0) {
            upstreamWs.send(audioQueue.shift()!);
          }
        }

        // Signal client that relay is ready
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({ type: "relay_ready" }));
        }

        // If client already disconnected during upstream setup, finalize now
        if (clientDisconnected) {
          console.log(`[stt-ws-relay] soniox: client disconnected during setup, finalizing`);
          triggerSonioxFinalize("client gone during setup");
        }
      } else {
        // Non-Soniox providers: original connection logic
        let upstreamUrl = buildUpstreamUrl(providerId, apiKey, safeLanguage);

        if (providerId === "elevenlabs") {
          const tokenResp = await fetch("https://api.elevenlabs.io/v1/single-use-token/realtime_scribe", {
            method: "POST",
            headers: { "xi-api-key": apiKey },
          });
          if (!tokenResp.ok) {
            const body = await tokenResp.text();
            console.error(`[stt-ws-relay] ElevenLabs token fetch failed: ${tokenResp.status} ${body}`);
            clientWs.send(JSON.stringify({ type: "relay_error", message: `ElevenLabs authentication failed (HTTP ${tokenResp.status}). Check your API key.` }));
            clientWs.close(4000, "Failed to get ElevenLabs token");
            return;
          }
          const { token: signedToken } = await tokenResp.json();
          upstreamUrl += `&token=${encodeURIComponent(signedToken)}`;
        }

        console.log(`[stt-ws-relay] connecting upstream (${providerId}): ${upstreamUrl.split("?")[0]}`);
        upstreamWs = new WebSocket(upstreamUrl);
      }
    } catch (e) {
      console.error(`[stt-ws-relay] upstream connection failed (${providerId}):`, e);
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({ type: "relay_error", message: "Failed to connect to provider. Please try again." }));
        clientWs.close(4000, "Failed to connect to provider");
      }
      return;
    }

    // ── Non-Soniox providers: set up onopen (Soniox already handled above) ─
    if (providerId !== "soniox") {
      upstreamWs.onopen = async () => {
        console.log(`[stt-ws-relay] upstream open (${providerId})`);
        const initMsg = buildInitMessage(providerId, apiKey, safeLanguage);
        if (initMsg) {
          upstreamWs.send(initMsg);
          // Gemini's native audio model needs time to process the setup message
          // before it can accept audio — same behaviour as Soniox
          if (providerId === "gemini" && audioQueue.length > 0) {
            console.log(`[stt-ws-relay] gemini: waiting 150ms for setup to process before flushing ${audioQueue.length} buffered packets`);
            await new Promise((resolve) => setTimeout(resolve, 150));
          }
        }
        upstreamReady = true;

        if (audioQueue.length > 0) {
          console.log(`[stt-ws-relay] flushing ${audioQueue.length} buffered audio packets (${providerId})`);
          while (audioQueue.length > 0) {
            upstreamWs.send(audioQueue.shift()!);
          }
        }

        // Signal client that relay is ready
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({ type: "relay_ready" }));
        }
      };
    }

    // ── Upstream → Client ───────────────────────────────────────────────────
    upstreamWs.onmessage = (evt) => {
      const preview = typeof evt.data === "string" ? evt.data.slice(0, 300) : `[binary ${(evt.data as ArrayBuffer).byteLength}B]`;
      console.log(`[stt-ws-relay] upstream→client (${providerId}): ${preview}`);

      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(evt.data);
      } else if (clientDisconnected) {
        console.log(`[stt-ws-relay] upstream msg after client disconnect (${providerId}), discarding`);
      }

      // Detect Soniox finished signal → close upstream cleanly
      if (providerId === "soniox" && typeof evt.data === "string") {
        if (isSonioxFinished(evt.data, sonioxApi)) {
          console.log(`[stt-ws-relay] soniox finished signal received, closing upstream`);
          if (finalizeTimeoutId) { clearTimeout(finalizeTimeoutId); finalizeTimeoutId = null; }
          upstreamWs.close(1000, "Transcription finished");
        }
      }
    };

    upstreamWs.onerror = (e) => {
      console.error(`[stt-ws-relay] upstream error (${providerId}):`, JSON.stringify(e));
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({ type: "relay_error", message: "Failed to connect to provider. Check your API key and try again." }));
      }
      clientWs.close(4000, "Upstream error");
    };

    upstreamWs.onclose = (evt) => {
      console.log(`[stt-ws-relay] upstream closed (${providerId}): code=${evt.code} reason="${evt.reason}" wasClean=${evt.wasClean}`);
      if (finalizeTimeoutId) { clearTimeout(finalizeTimeoutId); finalizeTimeoutId = null; }
      if (clientWs.readyState === WebSocket.OPEN) {
        // Don't send relay_error for clean closes (normal finalize flow)
        if (evt.reason && evt.code !== 1000) {
          clientWs.send(JSON.stringify({ type: "relay_error", message: evt.reason }));
        }
        const safeCode = evt.code === 1000 || (evt.code >= 3000 && evt.code <= 4999) ? evt.code : 4001;
        clientWs.close(safeCode, evt.reason?.slice(0, 123) || "");
      }
    };

    // ── Client → Upstream ───────────────────────────────────────────────────
    clientWs.onmessage = (evt) => {
      // Handle finalize control message (sent by client before stopping)
      if (typeof evt.data === "string") {
        try {
          const ctrl = JSON.parse(evt.data);
          if (ctrl.type === "finalize") {
            console.log(`[stt-ws-relay] finalize control received (${providerId})`);
            if (providerId === "soniox" && upstreamWs.readyState === WebSocket.OPEN) {
              // Flush any remaining buffered audio first
              while (audioQueue.length > 0) {
                upstreamWs.send(audioQueue.shift()!);
              }
              triggerSonioxFinalize("client finalize control");
            }
            return;
          }
        } catch { /* not JSON control, treat as data */ }
      }

      // Audio forwarding with diagnostic logging
      audioPacketCount++;
      if (audioPacketCount % 50 === 1) {
        const size = evt.data instanceof ArrayBuffer ? evt.data.byteLength : (typeof evt.data === "string" ? evt.data.length : 0);
        console.log(`[stt-ws-relay] audio #${audioPacketCount} (${providerId}), ${size}B`);
      }

      if ((providerId === "elevenlabs" || providerId === "gemini") && evt.data instanceof ArrayBuffer) {
        const bytes = new Uint8Array(evt.data);
        const base64 = btoa(String.fromCharCode(...bytes));
        const jsonMsg = providerId === "elevenlabs"
          ? JSON.stringify({ message_type: "input_audio_chunk", audio_base_64: base64 })
          : JSON.stringify({ realtimeInput: { mediaChunks: [{ mimeType: "audio/pcm;rate=16000", data: base64 }] } });
        if (upstreamWs.readyState === WebSocket.OPEN) {
          upstreamWs.send(jsonMsg);
        } else {
          audioQueue.push(jsonMsg);
        }
      } else if (upstreamReady && upstreamWs.readyState === WebSocket.OPEN) {
        upstreamWs.send(evt.data);
      } else {
        audioQueue.push(evt.data);
      }
    };

    // ── Client disconnect (safety net) ──────────────────────────────────────
    clientWs.onclose = () => {
      console.log(`[stt-ws-relay] client closed (${providerId}), upstream=${upstreamWs?.readyState}, queue=${audioQueue.length}`);
      clientDisconnected = true;

      if (!upstreamWs) return;

      if (upstreamWs.readyState === WebSocket.OPEN) {
        if (providerId === "soniox") {
          // Flush any remaining buffered audio
          while (audioQueue.length > 0) {
            upstreamWs.send(audioQueue.shift()!);
          }
          triggerSonioxFinalize("client disconnect safety net");
          // Don't close upstream — let finalize timeout handle it
        } else {
          upstreamWs.close(1000, "Client disconnected");
        }
      } else if (upstreamWs.readyState === WebSocket.CONNECTING) {
        if (providerId === "soniox") {
          // For Soniox, the connectSonioxUpstream promise will resolve
          // and the clientDisconnected check above will handle finalize.
          // But if we're using a non-Soniox path that hasn't resolved yet,
          // just close it.
          console.log(`[stt-ws-relay] soniox: upstream still connecting, will finalize on open`);
        } else {
          // Non-Soniox: close the connecting upstream
          try { upstreamWs.close(1000, "Client disconnected before upstream ready"); } catch { /* ignore */ }
        }
      }
    };

    clientWs.onerror = (e) => {
      console.error(`[stt-ws-relay] client error (${providerId}):`, e);
      if (upstreamWs.readyState === WebSocket.OPEN) {
        upstreamWs.close(4000, "Client error");
      }
    };
  };

  return response;
});
