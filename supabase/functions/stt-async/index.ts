import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_PROVIDERS = ["elevenlabs", "gemini", "google", "soniox", "whisper"];
const MAX_AUDIO_SIZE = 15_000_000; // ~10MB base64
const LANGUAGE_REGEX = /^[a-z]{2}(-[A-Z]{2})?$|^auto$/;
const MIME_TYPE_REGEX = /^audio\/[a-z0-9.+-]+$/;

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

async function transcribeWithProvider(
  providerId: string,
  apiKey: string,
  audioBase64: string,
  language: string,
  fileName: string,
  mimeType: string
): Promise<{ transcript: string; processingTimeMs: number; wordCount: number; error?: string }> {
  const start = Date.now();
  const audioBytes = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));

  try {
    switch (providerId) {
      case "elevenlabs": {
        const formData = new FormData();
        formData.append("file", new Blob([audioBytes], { type: mimeType }), fileName);
        formData.append("model_id", "scribe_v2");
        formData.append("tag_audio_events", "true");
        formData.append("diarize", "true");
        if (language && language !== "auto") {
          formData.append("language_code", toIso3(language));
        }

        const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
          method: "POST",
          headers: { "xi-api-key": apiKey },
          body: formData,
        });
        const data = await res.json();
        if (!res.ok) {
          return { transcript: "", processingTimeMs: Date.now() - start, wordCount: 0, error: `Provider returned HTTP ${res.status}` };
        }
        const text = data.text || "";
        return { transcript: text, processingTimeMs: Date.now() - start, wordCount: text.split(/\s+/).filter(Boolean).length };
      }

      case "gemini": {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{
                parts: [
                  { text: `Transcribe this audio to text. Language: ${language || "auto-detect"}. Return ONLY the transcription text, nothing else.` },
                  { inline_data: { mime_type: mimeType || "audio/wav", data: audioBase64 } },
                ],
              }],
            }),
          }
        );
        const data = await res.json();
        if (!res.ok) {
          return { transcript: "", processingTimeMs: Date.now() - start, wordCount: 0, error: `Provider returned HTTP ${res.status}` };
        }
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
        return { transcript: text, processingTimeMs: Date.now() - start, wordCount: text.split(/\s+/).filter(Boolean).length };
      }

      case "google": {
        let accessToken = apiKey;
        try {
          JSON.parse(apiKey);
        } catch {}

        const res = await fetch("https://speech.googleapis.com/v1/speech:recognize", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            config: {
              encoding: "LINEAR16",
              sampleRateHertz: 16000,
              languageCode: language || "en-US",
              enableAutomaticPunctuation: true,
            },
            audio: { content: audioBase64 },
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          return { transcript: "", processingTimeMs: Date.now() - start, wordCount: 0, error: `Provider returned HTTP ${res.status}` };
        }
        const text = data.results?.map((r: any) => r.alternatives?.[0]?.transcript).join(" ") || "";
        return { transcript: text, processingTimeMs: Date.now() - start, wordCount: text.split(/\s+/).filter(Boolean).length };
      }

      case "soniox": {
        const formData = new FormData();
        formData.append("file", new Blob([audioBytes], { type: mimeType }), fileName);

        const res = await fetch("https://api.soniox.com/v1/transcribe", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}` },
          body: formData,
        });
        const data = await res.json();
        if (!res.ok) {
          return { transcript: "", processingTimeMs: Date.now() - start, wordCount: 0, error: `Provider returned HTTP ${res.status}` };
        }
        const text = data.text || data.transcript || "";
        return { transcript: text, processingTimeMs: Date.now() - start, wordCount: text.split(/\s+/).filter(Boolean).length };
      }

      case "whisper": {
        const formData = new FormData();
        formData.append("file", new Blob([audioBytes], { type: mimeType }), fileName);
        formData.append("model", "whisper-1");
        if (language) formData.append("language", language);

        const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}` },
          body: formData,
        });
        const data = await res.json();
        if (!res.ok) {
          return { transcript: "", processingTimeMs: Date.now() - start, wordCount: 0, error: `Provider returned HTTP ${res.status}` };
        }
        const text = data.text || "";
        return { transcript: text, processingTimeMs: Date.now() - start, wordCount: text.split(/\s+/).filter(Boolean).length };
      }

      default:
        return { transcript: "", processingTimeMs: 0, wordCount: 0, error: "Unsupported provider" };
    }
  } catch (e) {
    console.error("[stt-async] transcription error:", e);
    return { transcript: "", processingTimeMs: Date.now() - start, wordCount: 0, error: "Transcription failed" };
  }
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
  const userId = user.id;

  try {
    const body = await req.json();
    const { provider_id, language, audio, file_name, mime_type } = body;

    // Validate provider_id
    if (!provider_id || typeof provider_id !== "string" || !ALLOWED_PROVIDERS.includes(provider_id)) {
      return new Response(JSON.stringify({ error: "Invalid or missing provider_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate audio
    if (!audio || typeof audio !== "string") {
      return new Response(JSON.stringify({ error: "audio data required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (audio.length > MAX_AUDIO_SIZE) {
      return new Response(JSON.stringify({ error: "Audio data too large (max ~10MB)" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate language
    const safeLanguage = (language && typeof language === "string" && LANGUAGE_REGEX.test(language)) ? language : "en";

    // Validate mime_type
    const safeMimeType = (mime_type && typeof mime_type === "string" && MIME_TYPE_REGEX.test(mime_type)) ? mime_type : "audio/wav";

    // Validate file_name
    const safeFileName = (file_name && typeof file_name === "string" && file_name.length <= 255)
      ? file_name.replace(/[^a-zA-Z0-9._-]/g, "_")
      : "audio.wav";

    // Get API key
    const { data: keyData } = await supabase
      .from("api_keys")
      .select("encrypted_key")
      .eq("user_id", userId)
      .eq("provider_id", provider_id)
      .single();

    if (!keyData) {
      return new Response(
        JSON.stringify({ error: `No API key configured for this provider. Add it in Settings.` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const adminClient = getAdminClient();
    const decryptedApiKey = await decryptKey(adminClient, keyData.encrypted_key);

    const result = await transcribeWithProvider(
      provider_id,
      decryptedApiKey,
      audio,
      safeLanguage,
      safeFileName,
      safeMimeType
    );

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[stt-async] Error:", e);
    return new Response(JSON.stringify({ error: "An unexpected error occurred. Please try again." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
