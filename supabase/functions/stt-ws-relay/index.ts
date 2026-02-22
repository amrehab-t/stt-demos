import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_PROVIDERS = ["elevenlabs", "gemini", "google", "soniox"];
const LANGUAGE_REGEX = /^[a-z]{2}(-[A-Z]{2})?$|^auto$/;

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

function buildUpstreamUrl(providerId: string, apiKey: string, language: string): string {
  switch (providerId) {
    case "elevenlabs": {
      // Token is injected dynamically after fetching a signed token
      const langParam = language && language !== "auto" ? `&language_code=${language}` : "";
      return `wss://api.elevenlabs.io/v1/speech-to-text/realtime?model_id=scribe_v2_realtime${langParam}`;
    }
    case "gemini":
      return `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(apiKey)}`;
    case "google":
      return `wss://speech.googleapis.com/v1/speech:streamingRecognize`;
    case "soniox":
      return `wss://api.soniox.com/transcribe-websocket`;
    default:
      throw new Error("Unsupported provider");
  }
}


function buildInitMessage(providerId: string, apiKey: string, language: string): string | null {
  switch (providerId) {
    case "soniox": {
      const msg: Record<string, any> = {
        api_key: apiKey,
        sample_rate_hertz: 16000,
        audio_format: "pcm_s16le",
      };
      if (language && language !== "auto") msg.language_code = language;
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
          model: "models/gemini-2.0-flash-exp",
          generation_config: { response_modalities: ["TEXT"] },
          system_instruction: {
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
    try {
      let upstreamUrl = buildUpstreamUrl(providerId, apiKey, safeLanguage);

      // ElevenLabs requires a signed token for WS auth (no header support in Deno)
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
    } catch (e) {
      console.error(`[stt-ws-relay] upstream constructor threw (${providerId}):`, e);
      clientWs.send(JSON.stringify({ type: "relay_error", message: "Failed to connect to provider. Please try again." }));
      clientWs.close(4000, "Failed to connect to provider");
      return;
    }

    upstreamWs.onopen = () => {
      const initMsg = buildInitMessage(providerId, apiKey, safeLanguage);
      if (initMsg) upstreamWs.send(initMsg);
    };

    upstreamWs.onmessage = (evt) => {
      const preview = typeof evt.data === "string" ? evt.data.slice(0, 300) : `[binary ${(evt.data as ArrayBuffer).byteLength}B]`;
      console.log(`[stt-ws-relay] upstream msg (${providerId}): ${preview}`);
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(evt.data);
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
      if (clientWs.readyState === WebSocket.OPEN) {
        if (evt.reason) {
          clientWs.send(JSON.stringify({ type: "relay_error", message: evt.reason }));
        }
        const safeCode = evt.code === 1000 || (evt.code >= 3000 && evt.code <= 4999) ? evt.code : 4001;
        clientWs.close(safeCode, evt.reason?.slice(0, 123) || "");
      }
    };

    clientWs.onmessage = (evt) => {
      if (upstreamWs.readyState !== WebSocket.OPEN) return;
      if (providerId === "elevenlabs" && evt.data instanceof ArrayBuffer) {
        const bytes = new Uint8Array(evt.data);
        const base64 = btoa(String.fromCharCode(...bytes));
        upstreamWs.send(JSON.stringify({ message_type: "input_audio_chunk", audio_base_64: base64 }));
      } else {
        upstreamWs.send(evt.data);
      }
    };

    clientWs.onclose = () => {
      if (upstreamWs.readyState === WebSocket.OPEN) {
        upstreamWs.close(1000, "Client disconnected");
      }
    };

    clientWs.onerror = (e) => {
      console.error(`[stt-ws-relay] client error:`, e);
      upstreamWs.close(4000, "Client error");
    };
  };

  return response;
});
