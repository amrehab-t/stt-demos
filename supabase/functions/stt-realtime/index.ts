import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_PROVIDERS = ["elevenlabs", "gemini", "google", "soniox", "whisper"];
const MAX_AUDIO_SIZE = 5_000_000; // ~3.3MB base64 per chunk
const LANGUAGE_REGEX = /^[a-z]{2}(-[A-Z]{2})?$|^auto$/;

const ISO639_1_TO_3: Record<string, string> = {
  en: "eng", es: "spa", fr: "fra", de: "deu", pt: "por",
  ja: "jpn", zh: "zho", ko: "kor", ar: "ara", hi: "hin",
  it: "ita", nl: "nld", ru: "rus",
};
function toIso3(lang: string): string {
  return ISO639_1_TO_3[lang] ?? lang;
}

const ENCRYPTION_KEY = () => Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function getAdminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}

async function decryptKey(adminClient: any, encryptedKey: string): Promise<string> {
  const { data, error } = await adminClient.rpc("decrypt_api_key", {
    encrypted_key: encryptedKey,
    encryption_key: ENCRYPTION_KEY(),
  });
  if (error) throw error;
  return data;
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

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": isAllowedOrigin(origin) ? origin : "*",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  };
}

/** Wrap raw PCM-16 LE mono 16kHz into a minimal WAV container */
function pcmToWav(pcmBytes: Uint8Array, sampleRate = 16000, channels = 1, bitsPerSample = 16): Uint8Array {
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const dataSize = pcmBytes.length;
  const headerSize = 44;
  const wav = new Uint8Array(headerSize + dataSize);
  const view = new DataView(wav.buffer);

  wav.set([0x52,0x49,0x46,0x46], 0);
  view.setUint32(4, 36 + dataSize, true);
  wav.set([0x57,0x41,0x56,0x45], 8);

  wav.set([0x66,0x6d,0x74,0x20], 12);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  wav.set([0x64,0x61,0x74,0x61], 36);
  view.setUint32(40, dataSize, true);
  wav.set(pcmBytes, headerSize);

  return wav;
}

async function handleRestChunked(
  providerId: string,
  apiKey: string,
  language: string,
  audioBase64: string,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const pcmBytes = Uint8Array.from(atob(audioBase64), c => c.charCodeAt(0));
  
  if (pcmBytes.length < 1600) {
    return new Response(
      JSON.stringify({ transcript: "", error: null, isFinal: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const wavBytes = pcmToWav(pcmBytes);
  let transcript = "";
  let error = null;

  try {
    if (providerId === "elevenlabs") {
      const formData = new FormData();
      const blob = new Blob([wavBytes], { type: "audio/wav" });
      formData.append("file", blob, "audio.wav");
      formData.append("model_id", "scribe_v2");
      formData.append("language_code", toIso3(language));

      const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
        method: "POST",
        headers: { "xi-api-key": apiKey },
        body: formData,
      });
      const data = await res.json();
      
      if (!res.ok) {
        error = `Provider returned HTTP ${res.status}`;
      } else {
        transcript = data.text || "";
      }
    } else if (providerId === "whisper") {
      const formData = new FormData();
      const blob = new Blob([wavBytes], { type: "audio/wav" });
      formData.append("file", blob, "audio.wav");
      formData.append("model", "whisper-1");
      formData.append("language", language || "en");

      const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: formData,
      });
      const data = await res.json();
      transcript = data.text || "";
      if (!res.ok) error = `Provider returned HTTP ${res.status}`;
    } else if (providerId === "gemini") {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: `Transcribe this audio to text. Language: ${language}. Return ONLY the transcription, nothing else.` },
                { inline_data: { mime_type: "audio/wav", data: audioBase64 } },
              ],
            }],
          }),
        }
      );
      const data = await res.json();
      transcript = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      if (!res.ok) error = `Provider returned HTTP ${res.status}`;
    } else if (providerId === "google") {
      const res = await fetch("https://speech.googleapis.com/v1/speech:recognize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          config: {
            encoding: "LINEAR16",
            sampleRateHertz: 16000,
            languageCode: language || "en-US",
          },
          audio: { content: audioBase64 },
        }),
      });
      const data = await res.json();
      transcript = data.results?.map((r: any) => r.alternatives?.[0]?.transcript).join(" ") || "";
      if (!res.ok) error = `Provider returned HTTP ${res.status}`;
    } else if (providerId === "soniox") {
      const formData = new FormData();
      const blob = new Blob([wavBytes], { type: "audio/wav" });
      formData.append("file", blob, "audio.wav");
      if (language && language !== "auto") {
        formData.append("language", language);
      }

      const res = await fetch("https://api.soniox.com/v1/transcribe", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        error = `Provider returned HTTP ${res.status}`;
      } else {
        transcript = data.text || data.transcript || "";
      }
    } else {
      error = "Unsupported provider";
    }
  } catch (e) {
    console.error("[stt-realtime] transcription error:", e);
    error = "Transcription failed";
  }

  return new Response(
    JSON.stringify({ transcript, error, isFinal: true }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const { provider_id, language, audio } = body;

    // Validate provider_id
    if (!provider_id || typeof provider_id !== "string" || !ALLOWED_PROVIDERS.includes(provider_id)) {
      return new Response(JSON.stringify({ error: "Invalid or missing provider_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate language
    const safeLanguage = (language && typeof language === "string" && LANGUAGE_REGEX.test(language)) ? language : "en";

    // Get user's API key for this provider
    const { data: keyData } = await supabase
      .from("api_keys")
      .select("encrypted_key")
      .eq("user_id", user.id)
      .eq("provider_id", provider_id)
      .single();

    if (!keyData) {
      return new Response(
        JSON.stringify({ error: "No API key configured for this provider. Add it in Settings." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const adminClient = getAdminClient();
    const decryptedApiKey = await decryptKey(adminClient, keyData.encrypted_key);

    if (!audio || typeof audio !== "string") {
      return new Response(JSON.stringify({ error: "audio data required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (audio.length > MAX_AUDIO_SIZE) {
      return new Response(JSON.stringify({ error: "Audio chunk too large" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return handleRestChunked(provider_id, decryptedApiKey, safeLanguage, audio, corsHeaders);
  } catch (e) {
    console.error("[stt-realtime] Error:", e);
    return new Response(JSON.stringify({ error: "An unexpected error occurred. Please try again." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
