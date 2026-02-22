# STT Arena — Gemini + Google Fixes & Gemini 3 Flash Addition

**Date:** 2026-02-22
**Branch:** `claude/review-google-gemini-apis-uUCyv`
**Repo:** `amrehab-t/stt-demos`

---

## Context & Current State

This plan fixes all broken Gemini and Google Cloud STT functionality, adds Gemini 3 Flash as a
new provider, and introduces a lightweight provider adapter pattern in the relay for long-term
maintainability.

### Current bugs (Gemini)
| Bug | Root cause | Severity |
|---|---|---|
| Zero transcriptions from Gemini realtime | Relay sends raw binary; Gemini Live API requires JSON `realtimeInput` + base64 | **Critical** |
| Gemini realtime always fails on connect | Model `gemini-2.0-flash-exp` used in init message was shut down Dec 9, 2025 | **Critical** |
| Gemini realtime never returns transcript | Setup missing `inputAudioTranscription: {}` for native audio models | **High** |
| Init field names wrong (snake_case vs camelCase) | `generation_config`, `response_modalities`, `system_instruction` should be camelCase | **High** |
| No init delay before flushing audio | Gemini needs ~150ms after setup before accepting audio, like Soniox | **High** |
| Gemini async model retiring March 31 2026 | `gemini-2.0-flash` used in stt-async + stt-realtime | **High** |

### Current bugs (Google Cloud STT)
| Bug | Root cause | Severity |
|---|---|---|
| All Google async calls fail with 401 | Service account JSON used directly as Bearer token; needs OAuth2 JWT exchange | **Critical** |
| All Google realtime calls fail | Same auth problem + WebSocket can't send `Authorization` header (Deno limitation) | **Critical** |
| Google transcript shows duplicates | `parseProviderMessage` returns `mode: "append"` but Google sends cumulative-per-utterance — should be `replace_partial` | **Medium** |

### Model landscape (Feb 2026)
| Use case | Correct model ID |
|---|---|
| Gemini Live API (realtime WebSocket) | `gemini-live-2.5-flash-native-audio` |
| Gemini async (generateContent REST) | `gemini-2.5-flash` |
| Gemini 3 Flash async | `gemini-3-flash-preview` |
| Gemini 3 Flash realtime | **Not available on Live API** — use HTTP polling |

`gemini-3-flash-preview` supports `generateContent` REST only.
It does NOT support `BidiGenerateContent` (Live API WebSocket).
`gemini-live-2.5-flash-native-audio` is the current stable Live API model.

---

## Architecture: Provider Adapter Pattern

Rather than scattered `switch` blocks across 5 files, introduce a **provider adapter object**
inside the relay (`stt-ws-relay`) that co-locates all per-provider WS logic.

```typescript
interface ProviderAdapter {
  buildUpstreamUrl(apiKey: string, language: string): string | Promise<string>;
  buildSetupMessage(apiKey: string, language: string): string | null;
  encodeAudio(binary: ArrayBuffer): string | ArrayBuffer;  // output is what gets sent upstream
  needsInitDelay: boolean;       // wait 150ms after setup before flushing audio
  needsFinalize: boolean;        // send explicit end signal before closing
}
```

This is a **refactor** (Phase 4), not required for the critical fixes (Phases 1–3).
The critical fixes can be applied directly to the existing switch-case structure.

---

## Phase 1 — Fix Gemini Realtime (stt-ws-relay)

**File:** `supabase/functions/stt-ws-relay/index.ts`

### 1a. Fix `buildInitMessage` for Gemini

Replace the existing `case "gemini"` in `buildInitMessage` (currently lines 108–119):

```typescript
// BEFORE (broken — dead model, wrong field names, missing inputAudioTranscription)
case "gemini":
  return JSON.stringify({
    setup: {
      model: "models/gemini-2.0-flash-exp",
      generation_config: { response_modalities: ["TEXT"] },
      system_instruction: {
        parts: [{ text: "..." }],
      },
    },
  });

// AFTER
case "gemini":
  return JSON.stringify({
    setup: {
      model: "models/gemini-live-2.5-flash-native-audio",
      generationConfig: { responseModalities: ["TEXT"] },
      inputAudioTranscription: {},        // required: tells native audio model to return text
      systemInstruction: {
        parts: [{ text: language === "auto"
          ? "You are a speech-to-text transcription engine. Transcribe all audio you receive to text, auto-detecting the language. Return only the transcription text."
          : `You are a speech-to-text transcription engine. Transcribe all audio you receive to text in ${language}. Return only the transcription text.` }],
      },
    },
  });
```

### 1b. Fix audio forwarding for Gemini in `clientWs.onmessage`

Currently (lines 483–496), only ElevenLabs gets the binary→base64 JSON treatment.
Gemini falls through to raw binary send, which the API silently ignores.

```typescript
// BEFORE
if (providerId === "elevenlabs" && evt.data instanceof ArrayBuffer) {
  const bytes = new Uint8Array(evt.data);
  const base64 = btoa(String.fromCharCode(...bytes));
  const jsonMsg = JSON.stringify({ message_type: "input_audio_chunk", audio_base_64: base64 });
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

// AFTER
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
```

### 1c. Add 150ms init delay for Gemini

The non-Soniox `upstreamWs.onopen` handler (lines 393–411) immediately flushes buffered audio
after sending the init message. Gemini's native audio model needs time to process the setup
before it can accept audio — same behaviour as Soniox.

Change the `onopen` handler to be `async` and add the delay for Gemini:

```typescript
// BEFORE
upstreamWs.onopen = () => {
  const initMsg = buildInitMessage(providerId, apiKey, safeLanguage);
  if (initMsg) upstreamWs.send(initMsg);
  upstreamReady = true;
  if (audioQueue.length > 0) { /* flush */ }
  clientWs.send(JSON.stringify({ type: "relay_ready" }));
};

// AFTER
upstreamWs.onopen = async () => {
  const initMsg = buildInitMessage(providerId, apiKey, safeLanguage);
  if (initMsg) {
    upstreamWs.send(initMsg);
    if (providerId === "gemini" && audioQueue.length > 0) {
      console.log(`[stt-ws-relay] gemini: waiting 150ms for setup to process before flushing ${audioQueue.length} buffered packets`);
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  }
  upstreamReady = true;
  if (audioQueue.length > 0) {
    console.log(`[stt-ws-relay] flushing ${audioQueue.length} buffered audio packets (${providerId})`);
    while (audioQueue.length > 0) {
      upstreamWs.send(audioQueue.shift()!);
    }
  }
  if (clientWs.readyState === WebSocket.OPEN) {
    clientWs.send(JSON.stringify({ type: "relay_ready" }));
  }
};
```

### 1d. Verify Gemini response parser in useRealtimeProvider

The existing Gemini parser (`src/hooks/useRealtimeProvider.ts` lines 36–39) reads
`msg.serverContent?.modelTurn?.parts?.[0]?.text`. This is the correct path for TEXT mode responses
from the Live API. No change needed here — but confirm with raw message debug panel once deployed.

**Note on inputAudioTranscription responses:** When `inputAudioTranscription: {}` is included in
setup, the model may also send `{ serverContent: { inputTranscription: { text: "..." } } }` messages.
The parser should handle this path too:

```typescript
case "gemini": {
  // Primary: model text response
  const modelText = msg.serverContent?.modelTurn?.parts?.[0]?.text ?? "";
  // Fallback: input audio transcription (native audio models)
  const inputText = msg.serverContent?.inputTranscription?.text ?? "";
  const text = modelText || inputText;
  return text ? { text, isFinal: true, mode: "append" } : null;
}
```

---

## Phase 2 — Fix Gemini Async model (stt-async + stt-realtime)

### 2a. stt-async — upgrade model

**File:** `supabase/functions/stt-async/index.ts`, line 97.

```typescript
// BEFORE
`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`

// AFTER
`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`
```

### 2b. stt-realtime — upgrade model for Gemini HTTP polling fallback

**File:** `supabase/functions/stt-realtime/index.ts`, line 143.

```typescript
// BEFORE (also: audioBase64 is raw PCM but mime_type says audio/wav — wrong)
const res = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
  {
    body: JSON.stringify({
      contents: [{ parts: [
        { text: "..." },
        { inline_data: { mime_type: "audio/wav", data: audioBase64 } },  // BUG: audioBase64 is raw PCM
      ]}],
    }),
  }
);

// AFTER (use wavBytes for correct audio/wav pairing)
const wavBase64 = btoa(String.fromCharCode(...wavBytes));
const res = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [
        { text: language === "auto"
          ? "Transcribe this audio to text, auto-detecting the language. Return ONLY the transcription text, nothing else."
          : `Transcribe this audio to text in ${language}. Return ONLY the transcription text, nothing else.` },
        { inline_data: { mime_type: "audio/wav", data: wavBase64 } },
      ]}],
    }),
  }
);
```

---

## Phase 3 — Add Gemini 3 Flash provider

Gemini 3 Flash (`gemini-3-flash-preview`) uses `generateContent` REST only — no Live API support.
It follows the same pattern as Whisper: HTTP polling in realtime mode, REST in async mode.

### 3a. Add provider entry — `src/lib/providers.ts`

Add after the existing `gemini` entry:

```typescript
{
  id: "gemini3",
  name: "Gemini 3 Flash",
  shortName: "Gemini 3",
  logo: "⚡",
  description: "Frontier-class reasoning at Flash speed (preview)",
  realtimeEndpoint: "https://generativelanguage.googleapis.com/v1beta",  // HTTP polling
  realtimeAuth: { type: "query-param" },
  asyncEndpoint: "https://generativelanguage.googleapis.com/v1beta",
  asyncAuth: { type: "query-param" },
  supportedLanguages: SUPPORTED_LANGUAGES.map((l) => ({ ...l })),
  supportsAutoDetect: true,
  signupUrl: "https://aistudio.google.com/apikey",
  costPerMinute: "$0.50",      // $0.50 / 1M input tokens
  latencyRange: "~400ms",
  features: ["Frontier reasoning", "1M token context", "Agentic coding", "Free tier"],
},
```

### 3b. Add to ALLOWED_PROVIDERS — all edge functions

In all 4 edge function files, add `"gemini3"` to `ALLOWED_PROVIDERS`:

- `stt-ws-relay/index.ts` line 3: `["elevenlabs", "gemini", "gemini3", "google", "soniox"]`
  - **Note:** `gemini3` is in the allowed list but will never reach the WS relay in practice
    (the client uses HTTP polling for non-WS providers). Having it here is a safety guard.
- `stt-async/index.ts` line 3: `["elevenlabs", "gemini", "gemini3", "google", "soniox", "whisper"]`
- `stt-realtime/index.ts` line 3: `["elevenlabs", "gemini", "gemini3", "google", "soniox", "whisper"]`
- `manage-api-keys/index.ts` line 3: `["elevenlabs", "gemini", "gemini3", "google", "soniox", "whisper"]`

### 3c. Add `gemini3` to stt-realtime (HTTP polling realtime)

**File:** `supabase/functions/stt-realtime/index.ts`

Add a new `else if` branch in `handleRestChunked`, after the existing `gemini` case:

```typescript
} else if (providerId === "gemini3") {
  const wavBase64 = btoa(String.fromCharCode(...wavBytes));
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [
          { text: language === "auto"
            ? "Transcribe this audio to text, auto-detecting the language. Return ONLY the transcription text, nothing else."
            : `Transcribe this audio to text in ${language}. Return ONLY the transcription text, nothing else.` },
          { inline_data: { mime_type: "audio/wav", data: wavBase64 } },
        ]}],
      }),
    }
  );
  const data = await res.json();
  transcript = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  if (!res.ok) error = `Provider returned HTTP ${res.status}`;
```

### 3d. Add `gemini3` to stt-async

**File:** `supabase/functions/stt-async/index.ts`

Add a new `case "gemini3"` after `case "gemini"`:

```typescript
case "gemini3": {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: language === "auto"
              ? "Transcribe this audio to text, auto-detecting the language. Return ONLY the transcription text, nothing else."
              : `Transcribe this audio to text in ${language}. Return ONLY the transcription text, nothing else.` },
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
```

### 3e. Add `gemini3` key test to manage-api-keys

**File:** `supabase/functions/manage-api-keys/index.ts`

Add after `case "gemini"` in `testProviderKey`:

```typescript
case "gemini3": {
  // Same endpoint as gemini — both use Gemini API keys from AI Studio
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
  );
  return res.ok ? { valid: true } : { valid: false, error: `HTTP ${res.status}` };
}
```

### 3f. useRealtimeProvider — gemini3 uses HTTP polling

**File:** `src/hooks/useRealtimeProvider.ts`, line 11:

```typescript
// BEFORE
const WS_PROVIDERS = ["elevenlabs", "gemini", "google", "soniox"];

// AFTER
const WS_PROVIDERS = ["elevenlabs", "gemini", "google", "soniox"];
// gemini3 is intentionally NOT in this list → uses HTTP polling via stt-realtime
```

No change needed — `gemini3` not being in `WS_PROVIDERS` automatically routes it through
the HTTP polling path (same as Whisper). No parser case needed since stt-realtime returns
a normalized `{ transcript, isFinal }` response already handled by `sendBufferedAudio`.

---

## Phase 4 — Fix Google Cloud STT OAuth2

Google requires OAuth2 access tokens, not service account JSON as Bearer tokens.
The fix requires JWT signing with the service account private key.

### 4a. Add `getGoogleAccessToken` helper function

This helper must be added to **both** `stt-async/index.ts` and `stt-realtime/index.ts`
(edge functions are isolated — no shared imports between them).

```typescript
/** Base64url encode a string or Uint8Array */
function base64url(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const binary = String.fromCharCode(...bytes);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/**
 * Exchange a Google service account JSON key for a short-lived OAuth2 access token.
 * Uses Deno's built-in crypto.subtle for RS256 JWT signing.
 * Token is valid for 1 hour.
 */
async function getGoogleAccessToken(serviceAccountJson: string): Promise<string> {
  const sa = JSON.parse(serviceAccountJson);
  const now = Math.floor(Date.now() / 1000);

  const headerB64 = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payloadB64 = base64url(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const signingInput = `${headerB64}.${payloadB64}`;

  // Import PEM private key (PKCS8)
  const pemBody = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");
  const keyBytes = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyBytes,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );
  const sigB64 = base64url(new Uint8Array(signature));
  const jwt = `${signingInput}.${sigB64}`;

  // Exchange JWT for access token
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const data = await resp.json();
  if (!data.access_token) {
    throw new Error(`Google OAuth2 token exchange failed: ${data.error ?? JSON.stringify(data)}`);
  }
  return data.access_token;
}
```

### 4b. Use access token in stt-async Google case

**File:** `supabase/functions/stt-async/index.ts`, `case "google"` (lines 121–149).

```typescript
case "google": {
  // apiKey is a service account JSON string — exchange for OAuth2 access token
  let accessToken: string;
  try {
    accessToken = await getGoogleAccessToken(apiKey);
  } catch (e) {
    return { transcript: "", processingTimeMs: Date.now() - start, wordCount: 0, error: `Google auth failed: ${(e as Error).message}` };
  }

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
        languageCode: language === "auto" ? "en-US" : (language || "en-US"),
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
```

### 4c. Fix Google realtime — move to HTTP polling

**The problem:** Deno's `WebSocket` constructor (like browser WebSocket) does not support custom
headers on the upgrade request. There is no way to send `Authorization: Bearer <token>` when
connecting to `wss://speech.googleapis.com`. This means **Google STT realtime via WebSocket
is not feasible** in the current relay architecture.

**Solution:** Remove Google from `WS_PROVIDERS`, making it use HTTP polling like Whisper.

**File:** `src/hooks/useRealtimeProvider.ts`
```typescript
// BEFORE
const WS_PROVIDERS = ["elevenlabs", "gemini", "google", "soniox"];

// AFTER
const WS_PROVIDERS = ["elevenlabs", "gemini", "soniox"];
// google is intentionally removed → uses HTTP polling via stt-realtime (same as Whisper)
```

**File:** `supabase/functions/stt-realtime/index.ts` — replace the existing Google case:

```typescript
} else if (providerId === "google") {
  let accessToken: string;
  try {
    accessToken = await getGoogleAccessToken(apiKey);
  } catch (e) {
    error = `Google auth failed: ${(e as Error).message}`;
    // fall through — transcript stays ""
    return new Response(JSON.stringify({ transcript: "", error, isFinal: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

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
        languageCode: language === "auto" ? "en-US" : (language || "en-US"),
        enableAutomaticPunctuation: true,
      },
      audio: { content: audioBase64 },  // raw PCM16 base64 — correct for LINEAR16
    }),
  });
  const data = await res.json();
  transcript = data.results?.map((r: any) => r.alternatives?.[0]?.transcript).join(" ") || "";
  if (!res.ok) error = `Provider returned HTTP ${res.status}`;
```

**File:** `supabase/functions/stt-ws-relay/index.ts`
- Remove `"google"` from `ALLOWED_PROVIDERS` (or keep it — it just won't be reached since client
  won't send Google to the relay once it's removed from WS_PROVIDERS). Keeping it is safe.

### 4d. Fix Google transcript mode in client parser

**File:** `src/hooks/useRealtimeProvider.ts`, `case "google"` in `parseProviderMessage`.

This change is still useful even when Google is HTTP-polling (the parsed mode doesn't apply to
HTTP polling results from stt-realtime, but correct it for future reference and in case Google
is ever moved back to WS):

```typescript
// BEFORE
case "google": {
  const result = msg.results?.[0];
  const text = result?.alternatives?.[0]?.transcript ?? "";
  return text ? { text, isFinal: result?.isFinal ?? false, mode: "append" } : null;
}

// AFTER — Google sends cumulative per-utterance (replace_partial, not append)
case "google": {
  const result = msg.results?.[0];
  const text = result?.alternatives?.[0]?.transcript ?? "";
  return text ? { text, isFinal: result?.isFinal ?? false, mode: "replace_partial" } : null;
}
```

---

## Phase 5 — Provider Adapter Pattern (Relay Refactor)

**File:** `supabase/functions/stt-ws-relay/index.ts`

This is a **structural refactor** — no behaviour changes. Do this after Phases 1–4 are
verified working.

### Adapter interface

```typescript
interface ProviderAdapter {
  /** Build the upstream WebSocket URL (may be async for token-fetch providers) */
  buildUpstreamUrl(apiKey: string, language: string): Promise<string>;
  /** Build the init/setup message to send immediately after upstream opens (null = none) */
  buildSetupMessage(apiKey: string, language: string): string | null;
  /** Encode a raw PCM ArrayBuffer into whatever the provider expects over WS */
  encodeAudio(binary: ArrayBuffer): string | ArrayBuffer;
  /** Wait this many ms after sending setup before flushing buffered audio */
  initDelayMs: number;
  /** Whether this provider requires an explicit end signal before closing upstream */
  requiresFinalize: boolean;
}
```

### Adapter implementations

```typescript
const adapters: Record<string, ProviderAdapter> = {
  elevenlabs: {
    async buildUpstreamUrl(apiKey, language) {
      const tokenResp = await fetch("https://api.elevenlabs.io/v1/single-use-token/realtime_scribe", {
        method: "POST",
        headers: { "xi-api-key": apiKey },
      });
      if (!tokenResp.ok) throw new Error(`ElevenLabs auth failed: HTTP ${tokenResp.status}`);
      const { token } = await tokenResp.json();
      const langParam = language && language !== "auto" ? `&language_code=${language}` : "";
      return `wss://api.elevenlabs.io/v1/speech-to-text/realtime?model_id=scribe_v2_realtime${langParam}&token=${encodeURIComponent(token)}`;
    },
    buildSetupMessage: () => null,
    encodeAudio(binary) {
      const b64 = btoa(String.fromCharCode(...new Uint8Array(binary)));
      return JSON.stringify({ message_type: "input_audio_chunk", audio_base_64: b64 });
    },
    initDelayMs: 0,
    requiresFinalize: false,
  },

  gemini: {
    async buildUpstreamUrl(apiKey) {
      return `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(apiKey)}`;
    },
    buildSetupMessage(_, language) {
      return JSON.stringify({
        setup: {
          model: "models/gemini-live-2.5-flash-native-audio",
          generationConfig: { responseModalities: ["TEXT"] },
          inputAudioTranscription: {},
          systemInstruction: {
            parts: [{ text: language === "auto"
              ? "You are a speech-to-text transcription engine. Transcribe all audio you receive to text. Return only the transcription."
              : `Transcribe all audio to text in ${language}. Return only the transcription.` }],
          },
        },
      });
    },
    encodeAudio(binary) {
      const b64 = btoa(String.fromCharCode(...new Uint8Array(binary)));
      return JSON.stringify({ realtimeInput: { mediaChunks: [{ mimeType: "audio/pcm;rate=16000", data: b64 }] } });
    },
    initDelayMs: 150,
    requiresFinalize: false,
  },

  soniox: {
    // Note: Soniox has its own connectSonioxUpstream() with dual-version fallback.
    // The adapter pattern wraps the common-path case; Soniox's custom logic stays separate.
    async buildUpstreamUrl(_, __, sonioxApi = "current") {
      return sonioxApi === "legacy"
        ? "wss://api.soniox.com/transcribe-websocket"
        : "wss://stt-rt.soniox.com/transcribe-websocket";
    },
    buildSetupMessage(apiKey, language) { /* same as current buildInitMessage */ },
    encodeAudio: (binary) => binary,  // raw binary
    initDelayMs: 150,
    requiresFinalize: true,
  },
};
```

The relay's main `clientWs.onopen` then becomes:

```typescript
clientWs.onopen = async () => {
  const adapter = adapters[providerId];
  // 1. Build upstream URL (may fetch tokens)
  const upstreamUrl = await adapter.buildUpstreamUrl(apiKey, safeLanguage);
  upstreamWs = new WebSocket(upstreamUrl);

  upstreamWs.onopen = async () => {
    // 2. Send setup/init
    const setup = adapter.buildSetupMessage(apiKey, safeLanguage);
    if (setup) upstreamWs.send(setup);
    // 3. Init delay
    if (adapter.initDelayMs > 0 && audioQueue.length > 0) {
      await new Promise(r => setTimeout(r, adapter.initDelayMs));
    }
    // 4. Flush queued audio
    upstreamReady = true;
    while (audioQueue.length > 0) upstreamWs.send(audioQueue.shift()!);
    // 5. Signal ready
    if (clientWs.readyState === WebSocket.OPEN)
      clientWs.send(JSON.stringify({ type: "relay_ready" }));
  };
  // ...rest of onmessage/onerror/onclose
};

// Audio forwarding uses adapter.encodeAudio:
clientWs.onmessage = (evt) => {
  if (evt.data instanceof ArrayBuffer) {
    const encoded = adapter.encodeAudio(evt.data);
    if (upstreamReady && upstreamWs.readyState === WebSocket.OPEN) {
      upstreamWs.send(encoded);
    } else {
      audioQueue.push(encoded);
    }
  }
};
```

Soniox keeps its custom `connectSonioxUpstream()` path (not covered by the adapter) because
the dual-version fallback and finalize protocol are too specific to generalize cleanly.

---

## Deployment Order

Deploy edge functions **after** each phase that touches them:

```bash
# After Phase 1 (Gemini relay fixes):
supabase functions deploy stt-ws-relay --no-verify-jwt

# After Phase 2 (Gemini async model upgrade):
supabase functions deploy stt-async --no-verify-jwt
supabase functions deploy stt-realtime --no-verify-jwt

# After Phase 3 (Gemini 3 Flash provider):
supabase functions deploy stt-async --no-verify-jwt
supabase functions deploy stt-realtime --no-verify-jwt
supabase functions deploy manage-api-keys --no-verify-jwt

# After Phase 4 (Google OAuth2):
supabase functions deploy stt-async --no-verify-jwt
supabase functions deploy stt-realtime --no-verify-jwt
# No relay deploy needed (Google moved to HTTP polling)
```

---

## Summary: Files Changed Per Phase

| File | Ph1 | Ph2 | Ph3 | Ph4 | Ph5 |
|---|---|---|---|---|---|
| `supabase/functions/stt-ws-relay/index.ts` | ✅ | — | ✅ (allowed list) | — | ✅ |
| `supabase/functions/stt-async/index.ts` | — | ✅ | ✅ | ✅ | — |
| `supabase/functions/stt-realtime/index.ts` | — | ✅ | ✅ | ✅ | — |
| `supabase/functions/manage-api-keys/index.ts` | — | — | ✅ | — | — |
| `src/lib/providers.ts` | — | — | ✅ | — | — |
| `src/hooks/useRealtimeProvider.ts` | ✅ (parser) | — | — | ✅ (WS_PROVIDERS) | — |

---

## Testing Checklist

After deploying each phase, verify:

### Phase 1 (Gemini realtime)
- [ ] Open Arena, select Gemini panel, start recording
- [ ] Status transitions: `connecting` → `live` (requires `relay_ready` signal)
- [ ] Speak for 5 seconds — transcript should appear
- [ ] Check raw message panel: should see `serverContent` JSON objects
- [ ] No `relay_error` messages in raw panel

### Phase 2 (Gemini async model)
- [ ] Open Batch page, upload an audio file, select Gemini
- [ ] Transcription completes without error
- [ ] No model-not-found errors

### Phase 3 (Gemini 3 Flash)
- [ ] Gemini 3 Flash appears as option in panel selector in Arena
- [ ] Settings page shows Gemini 3 Flash API key slot (uses same key as Gemini — Gemini API keys work for both)
- [ ] Realtime: HTTP polling mode, status shows `connecting` → `live`
- [ ] Async: Batch page transcription works with Gemini 3 panel

### Phase 4 (Google OAuth2)
- [ ] Settings: Google panel accepts service account JSON and marks as valid (JSON structure validation — no live API call)
- [ ] Arena + Batch: Google transcriptions return transcript (not 401 error)
- [ ] Google panel in Arena uses HTTP polling (no WS connection in browser devtools)

---

## Known Remaining Limitations After All Phases

1. **Google realtime latency**: HTTP polling every 3 seconds means ~3s transcript delay vs true
   streaming. This is the same trade-off as Whisper. To get true streaming Google STT would
   require a gRPC implementation, which is not feasible in Deno edge functions without a gRPC
   library.

2. **Gemini 3 Flash realtime**: HTTP polling (same reason — no Live API support for this model).
   When Google releases Gemini 3 Flash for the Live API, just add `"gemini3"` to `WS_PROVIDERS`
   and add a relay case in `stt-ws-relay`.

3. **Google API key type**: The Settings UI label for Google should clarify the key must be a
   **service account JSON** (not a simple API key string). Consider updating the
   `description` or adding a help tooltip in the Settings page.

4. **Gemini 3 Flash preview status**: `gemini-3-flash-preview` is a preview model.
   Monitor [ai.google.dev/gemini-api/docs/changelog](https://ai.google.dev/gemini-api/docs/changelog)
   for the stable model ID — it will likely become `gemini-3-flash` or `gemini-3-flash-001`.

---

## Sources
- [Gemini 3 Developer Guide](https://ai.google.dev/gemini-api/docs/gemini-3)
- [Gemini Live API capabilities guide](https://ai.google.dev/gemini-api/docs/live-guide)
- [Gemini 2.5 Flash + Live API — Vertex AI](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash-live-api)
- [Gemini models list](https://ai.google.dev/gemini-api/docs/models)
- [Gemini Live API reference](https://ai.google.dev/api/live)
- [Gemini 3 Flash forum confirmation](https://discuss.ai.google.dev/t/request-full-allowlist-access-for-gemini-3-preview-models-gemini-3-flash-preview-gemini-3-pro-image-preview/116091)
