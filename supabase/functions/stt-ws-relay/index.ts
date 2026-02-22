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
    case "elevenlabs":
      return `wss://api.elevenlabs.io/v1/speech-to-text/stream-input?xi-api-key=${encodeURIComponent(apiKey)}&model_id=scribe_v2&language_code=${toIso3(language)}`;
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

function buildUpstreamHeaders(providerId: string, apiKey: string): Record<string, string> {
  switch (providerId) {
    case "google":
      return { Authorization: `Bearer ${apiKey}` };
    default:
      return {};
  }
}

function buildInitMessage(providerId: string, apiKey: string, language: string): string | null {
  switch (providerId) {
    case "soniox":
      return JSON.stringify({
        api_key: apiKey,
        language_code: language || "en",
        model: "nova-2",
      });
    case "google":
      return JSON.stringify({
        streamingConfig: {
          config: {
            encoding: "LINEAR16",
            sampleRateHertz: 16000,
            languageCode: language || "en-US",
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
            parts: [{ text: `You are a speech-to-text transcription engine. Transcribe all audio you receive to text in ${language || "en"}. Return only the transcription text.` }],
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

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: keyData } = await supabase
    .from("api_keys")
    .select("encrypted_key")
    .eq("user_id", user.id)
    .eq("provider_id", providerId)
    .single();

  if (!keyData) {
    return new Response(
      JSON.stringify({ error: "No API key configured for this provider. Add it in Settings." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const adminClient = getAdminClient();
  let apiKey: string;
  try {
    apiKey = await decryptKey(adminClient, keyData.encrypted_key);
  } catch {
    return new Response(JSON.stringify({ error: "Failed to retrieve API key" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { socket: clientWs, response } = Deno.upgradeWebSocket(req);

  clientWs.onopen = async () => {
    let upstreamWs: WebSocket;
    try {
      const upstreamUrl = buildUpstreamUrl(providerId, apiKey, safeLanguage);
      upstreamWs = new WebSocket(upstreamUrl);
    } catch (e) {
      clientWs.close(1011, "Failed to connect to provider");
      return;
    }

    upstreamWs.onopen = () => {
      const initMsg = buildInitMessage(providerId, apiKey, safeLanguage);
      if (initMsg) upstreamWs.send(initMsg);
    };

    upstreamWs.onmessage = (evt) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(evt.data);
      }
    };

    upstreamWs.onerror = (e) => {
      console.error(`[stt-ws-relay] upstream error (${providerId}):`, e);
      clientWs.close(1011, "Upstream error");
    };

    upstreamWs.onclose = (evt) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.close(evt.code, evt.reason);
      }
    };

    clientWs.onmessage = (evt) => {
      if (upstreamWs.readyState === WebSocket.OPEN) {
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
      upstreamWs.close(1011, "Client error");
    };
  };

  return response;
});
