import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_PROVIDERS = ["elevenlabs", "gemini", "google", "soniox", "whisper"];
const ALLOWED_ACTIONS = ["test"];
const MAX_API_KEY_LENGTH = 10000;

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

function getAdminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}

const ENCRYPTION_KEY = () => Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function encryptKey(adminClient: any, plainKey: string): Promise<string> {
  const { data, error } = await adminClient.rpc("encrypt_api_key", {
    plain_key: plainKey,
    encryption_key: ENCRYPTION_KEY(),
  });
  if (error) throw error;
  return data;
}

async function decryptKey(adminClient: any, encryptedKey: string): Promise<string> {
  const { data, error } = await adminClient.rpc("decrypt_api_key", {
    encrypted_key: encryptedKey,
    encryption_key: ENCRYPTION_KEY(),
  });
  if (error) throw error;
  return data;
}

async function getUser(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const token = authHeader.replace("Bearer ", "");
  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims) return null;

  return { userId: data.claims.sub as string, supabase };
}

async function testProviderKey(providerId: string, apiKey: string): Promise<{ valid: boolean; error?: string }> {
  try {
    switch (providerId) {
      case "elevenlabs": {
        const res = await fetch("https://api.elevenlabs.io/v1/user", {
          headers: { "xi-api-key": apiKey },
        });
        return res.ok ? { valid: true } : { valid: false, error: `HTTP ${res.status}` };
      }
      case "gemini": {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
        );
        return res.ok ? { valid: true } : { valid: false, error: `HTTP ${res.status}` };
      }
      case "google": {
        try {
          const parsed = JSON.parse(apiKey);
          if (parsed.type === "service_account" && parsed.project_id) {
            return { valid: true };
          }
          return { valid: false, error: "Invalid service account JSON" };
        } catch {
          return { valid: false, error: "Not valid JSON — expected service account key" };
        }
      }
      case "soniox": {
        const res = await fetch("https://api.soniox.com/v1/models", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        return res.ok ? { valid: true } : { valid: false, error: `HTTP ${res.status}` };
      }
      case "whisper": {
        const res = await fetch("https://api.openai.com/v1/models", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        return res.ok ? { valid: true } : { valid: false, error: `HTTP ${res.status}` };
      }
      default:
        return { valid: false, error: "Unknown provider" };
    }
  } catch (e) {
    console.error("[manage-api-keys] testProviderKey error:", e);
    return { valid: false, error: "Key validation failed" };
  }
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const auth = await getUser(req);
  if (!auth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { userId, supabase } = auth;
  const adminClient = getAdminClient();

  try {
    if (req.method === "GET") {
      const { data, error } = await supabase
        .from("api_keys")
        .select("provider_id, status, updated_at")
        .eq("user_id", userId);

      if (error) throw error;
      return new Response(JSON.stringify({ keys: data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (req.method === "POST") {
      const body = await req.json();
      const { provider_id, api_key, action } = body;

      if (!provider_id || typeof provider_id !== "string" || !ALLOWED_PROVIDERS.includes(provider_id)) {
        return new Response(JSON.stringify({ error: "Invalid or missing provider_id" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (action !== undefined && !ALLOWED_ACTIONS.includes(action)) {
        return new Response(JSON.stringify({ error: "Invalid action" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (action === "test") {
        let keyToTest = api_key;
        if (!keyToTest) {
          // Fetch encrypted key and decrypt it
          const { data } = await supabase
            .from("api_keys")
            .select("encrypted_key")
            .eq("user_id", userId)
            .eq("provider_id", provider_id)
            .single();
          if (!data) {
            return new Response(JSON.stringify({ valid: false, error: "No key saved" }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          keyToTest = await decryptKey(adminClient, data.encrypted_key);
        }

        const result = await testProviderKey(provider_id, keyToTest);

        if (!api_key && result.valid) {
          await supabase
            .from("api_keys")
            .update({ status: "configured" })
            .eq("user_id", userId)
            .eq("provider_id", provider_id);
        } else if (!api_key && !result.valid) {
          await supabase
            .from("api_keys")
            .update({ status: "invalid" })
            .eq("user_id", userId)
            .eq("provider_id", provider_id);
        }

        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Save action — encrypt before storing
      if (!api_key || typeof api_key !== "string") {
        return new Response(JSON.stringify({ error: "api_key required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (api_key.length > MAX_API_KEY_LENGTH) {
        return new Response(JSON.stringify({ error: "api_key too long" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const encryptedApiKey = await encryptKey(adminClient, api_key);

      const { data: existing } = await supabase
        .from("api_keys")
        .select("id")
        .eq("user_id", userId)
        .eq("provider_id", provider_id)
        .single();

      if (existing) {
        const { error } = await supabase
          .from("api_keys")
          .update({
            encrypted_key: encryptedApiKey,
            status: "configured",
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("api_keys").insert({
          user_id: userId,
          provider_id,
          encrypted_key: encryptedApiKey,
          status: "configured",
        });
        if (error) throw error;
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (req.method === "DELETE") {
      const body = await req.json();
      const { provider_id } = body;

      if (!provider_id || typeof provider_id !== "string" || !ALLOWED_PROVIDERS.includes(provider_id)) {
        return new Response(JSON.stringify({ error: "Invalid or missing provider_id" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { error } = await supabase
        .from("api_keys")
        .delete()
        .eq("user_id", userId)
        .eq("provider_id", provider_id);

      if (error) throw error;

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[manage-api-keys] Error:", e);
    return new Response(JSON.stringify({ error: "An unexpected error occurred. Please try again." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
