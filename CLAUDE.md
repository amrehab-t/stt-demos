# CLAUDE.md — STT Arena Platform

## What this project is

**Audio Arena Champions** — a side-by-side speech-to-text benchmarking platform. Users record audio (or upload files) and see transcripts from up to 4 STT providers simultaneously, with live latency and word count comparisons.

Originally built on [Lovable](https://lovable.dev) as `Widebot-AI/audio-arena-champions`, cloned into this repo (`amrehab-t/stt-demos`) for further development.

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite 5 |
| UI | shadcn/ui (Radix primitives), Tailwind CSS 3, Lucide icons |
| Routing | React Router v6 |
| State | React Context (`AppStateContext`, `AuthContext`) + TanStack Query |
| Backend | Supabase (Postgres + Auth + Edge Functions) |
| Edge Functions | Deno (TypeScript), deployed on Supabase |
| Testing | Vitest + Testing Library |

---

## Dev commands

```bash
npm run dev          # Start Vite dev server
npm run build        # Production build
npm run lint         # ESLint
npm run test         # Run Vitest once
npm run test:watch   # Vitest watch mode
```

---

## Environment variables

Stored in `.env` (committed — contains only the anon/public key, not secrets):

```
VITE_SUPABASE_PROJECT_ID=fnjotsnlywzxrcaevayk
VITE_SUPABASE_URL=https://fnjotsnlywzxrcaevayk.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<anon key>
```

The Supabase client is at `src/integrations/supabase/client.ts` — import as:
```ts
import { supabase } from "@/integrations/supabase/client";
```

---

## Directory structure

```
src/
  App.tsx                        # Router + provider tree
  main.tsx                       # Entry point
  index.css                      # Global styles
  vite-env.d.ts

  pages/
    Index.tsx                    # Landing page (public)
    Auth.tsx                     # Sign up / sign in
    Arena.tsx                    # Real-time 4-panel transcription
    Batch.tsx                    # Async file upload transcription
    Benchmarks.tsx               # Static + live benchmarks, cost calculator
    History.tsx                  # Past sessions list + detail
    Settings.tsx                 # API key management per provider
    Admin.tsx                    # User approval panel (admin only, unprotected route)
    NotFound.tsx                 # 404

  components/
    ArenaLayout.tsx              # Shell with nav, mode toggle, language selector
    AudioRecorder.tsx            # Record button UI + mic error display
    TranscriptionPanel.tsx       # Single provider panel (transcript, status, stats)
    ComparisonBar.tsx            # Bottom bar showing cross-provider stats
    NavLink.tsx                  # Styled nav link
    ProtectedRoute.tsx           # Redirects unauthenticated users to /auth
    ui/                          # shadcn/ui generated components (do not edit manually)

  hooks/
    useAudioCapture.ts           # Mic access + PCM 16-bit 16kHz conversion
    useRealtimeProvider.ts       # WebSocket relay for WS providers (elevenlabs, gemini, soniox), HTTP polling for gemini3/google/whisper
    useAsyncProvider.ts          # Sends file to stt-async edge function
    useApiKeys.ts                # CRUD for API keys via manage-api-keys edge function
    use-toast.ts                 # Toast hook
    use-mobile.tsx               # Responsive breakpoint hook

  contexts/
    AuthContext.tsx              # Supabase auth session, user state
    AppStateContext.tsx          # mode (realtime|async), panelSelections[4], language

  lib/
    types.ts                     # Core types: AppMode, ProviderStatus, TranscriptChunk, etc.
    providers.ts                 # PROVIDERS registry — single source of truth for all providers
    utils.ts                     # cn() utility (clsx + tailwind-merge)

  integrations/supabase/
    client.ts                    # Supabase client singleton
    types.ts                     # Auto-generated DB types

supabase/
  config.toml                   # Supabase local config
  functions/
    manage-api-keys/index.ts    # GET/POST/DELETE API keys (encrypt/decrypt with pgcrypto)
    stt-realtime/index.ts       # HTTP polling path for whisper, gemini3, google (includes OAuth2 JWT for Google)
    stt-ws-relay/index.ts       # True WebSocket relay for ElevenLabs, Gemini 2.5, Soniox
    stt-async/index.ts          # Full file transcription
    check-user-status/index.ts  # Returns approved + role for current user
    admin-users/index.ts        # Admin: list users, approve/reject
  migrations/
    20260221221304_...sql       # Core schema: profiles, api_keys, sessions, session_results
    20260221225349_...sql       # Roles: app_role enum, user_roles table, has_role(), is_approved()
    20260221230254_...sql       # Fix: DELETE policies on sessions + session_results
    20260221231017_...sql       # Encryption: pgcrypto, encrypt_api_key(), decrypt_api_key()
```

---

## Provider registry (`src/lib/providers.ts`)

Single source of truth. All UI reads from `PROVIDERS` array — no UI changes needed to add a provider.

| ID | Name | Real-time mode | Async endpoint |
|---|---|---|---|
| `elevenlabs` | Eleven Labs | WebSocket → `wss://api.elevenlabs.io/v1/speech-to-text/realtime` | `https://api.elevenlabs.io/v1/speech-to-text` |
| `gemini` | Gemini 2.5 Flash Live | WebSocket → `wss://generativelanguage.googleapis.com/ws` (BidiGenerateContent, model: `gemini-live-2.5-flash-native-audio`) | `gemini-2.5-flash` generateContent REST |
| `gemini3` | Gemini 3 Flash | HTTP polling → `gemini-3-flash-preview` generateContent REST | `gemini-3-flash-preview` generateContent REST |
| `google` | Google Cloud STT | HTTP polling → `https://speech.googleapis.com/v1/speech:recognize` (OAuth2 JWT) | `/v1/speech:recognize` (OAuth2 JWT) |
| `soniox` | Soniox | WebSocket → `wss://stt-rt.soniox.com/transcribe-websocket` (fallback: `api.soniox.com`) | `https://api.soniox.com/v1/transcribe` |
| `whisper` | OpenAI Whisper | HTTP polling → `https://api.openai.com/v1/audio/transcriptions` | `https://api.openai.com/v1/audio/transcriptions` |

**WebSocket providers** (use `stt-ws-relay`): `elevenlabs`, `gemini`, `soniox`
**HTTP polling providers** (use `stt-realtime` every 3s): `gemini3`, `google`, `whisper`

Default panel order: `[elevenlabs, gemini, google, soniox]`

---

## Database schema

### Tables

**`profiles`** — auto-created on signup via trigger
- `user_id` (FK → auth.users), `display_name`, `approved` (bool, default false), timestamps

**`api_keys`** — one row per (user, provider)
- `user_id`, `provider_id`, `encrypted_key` (pgp_sym_encrypt via pgcrypto), `status` (configured|invalid|not_configured)

**`sessions`**
- `user_id`, `mode` (realtime|async), `language`, `started_at`, `ended_at`

**`session_results`**
- `session_id`, `panel_index`, `provider_id`, `transcript`, `latency_ms` (JSONB array), `processing_time_ms`, `word_count`, `status`, `error`

**`user_roles`**
- `user_id`, `role` (app_role enum: admin|moderator|user)

### Key functions (SECURITY DEFINER)
- `encrypt_api_key(plain_key, encryption_key)` — pgp_sym_encrypt → base64
- `decrypt_api_key(encrypted_key, encryption_key)` — base64 → pgp_sym_decrypt (falls back to plaintext on failure)
- `has_role(user_id, role)` — used in RLS policies
- `is_approved(user_id)` — checks profiles.approved
- `handle_new_user()` — trigger: auto-inserts profile on auth.users INSERT

All tables have RLS enabled. Encryption key = `SUPABASE_SERVICE_ROLE_KEY` (used as both the Supabase admin key and the pgcrypto symmetric key).

---

## Edge functions

All functions enforce:
- CORS: `localhost`, `127.0.0.1`, `*.lovable.app`, `*.supabase.co`
- Auth: Bearer token validated via `supabase.auth.getUser()`
- Input validation on all fields

### `manage-api-keys`
- `GET` → list provider_id + status for current user
- `POST` → save key (encrypts with pgcrypto before storing) or `action: "test"` (validates key against provider API)
- `DELETE` → remove key

Test endpoints per provider:
- ElevenLabs: `GET /v1/user`
- Gemini / Gemini3: `GET /v1beta/models?key=...` (both use Gemini API keys; `gemini3` case falls through to same test)
- Google: validates JSON structure of service account key (no live call — OAuth2 exchange would require the live token endpoint)
- Soniox: `GET /v1/models`
- Whisper: `GET /v1/models`

### `stt-realtime`
HTTP polling path for non-WebSocket providers: `whisper`, `gemini3`, `google`. Accepts `{ provider_id, language, audio: base64_pcm }`. Wraps PCM in a WAV header and calls provider REST endpoints.

Minimum audio size: 1600 bytes (silently returns empty transcript below this).
Max audio size: 5MB base64.

Google uses this path (not the WS relay) because Deno's `WebSocket` constructor does not support custom headers — making it impossible to send `Authorization: Bearer <token>` on the WebSocket upgrade request. The function performs a full Google OAuth2 JWT exchange on each call via `getGoogleAccessToken()`.

### `stt-ws-relay`
True WebSocket relay for ElevenLabs, Gemini, and Soniox. The client opens a WebSocket to this function, which authenticates, decrypts the user's API key, then opens an upstream WebSocket to the provider and relays frames bidirectionally.

URL: `wss://<project>.supabase.co/functions/v1/stt-ws-relay?provider_id=...&language=...&token=...`

**Audio buffering**: The relay queues audio packets received from the client until the upstream WebSocket is connected and the init/config message has been sent. This prevents audio loss during the connection setup window. Once upstream is ready, buffered packets are flushed in order.

**Provider-specific behavior in the relay**:
- **ElevenLabs**: Fetches a signed single-use token via REST, wraps PCM binary as base64 JSON (`input_audio_chunk`)
- **Gemini**: Sends setup message (`models/gemini-live-2.5-flash-native-audio`, camelCase fields, `inputAudioTranscription: {}`). Wraps PCM binary as base64 JSON `realtimeInput.mediaChunks` with `mimeType: "audio/pcm;rate=16000"`. Waits 150ms after setup before flushing buffered audio (same as Soniox) to let the model process the config.
- **Soniox**: Uses `connectSonioxUpstream()` with auto-fallback (current → legacy). Sends API-version-appropriate init message, forwards raw binary audio. Uses finalize protocol on disconnect (see below).

**Soniox finalize protocol**: The client sends `{ type: "finalize" }` control message before closing its WS. The relay then sends the Soniox end signal (empty string for current API, `Uint8Array(0)` for legacy), waits up to 5 seconds for the `finished: true` response, and only then closes upstream. A server-side safety net in `clientWs.onclose` handles unexpected disconnects (tab close, network failure) the same way.

**Client-side audio buffering**: `useRealtimeProvider` buffers audio chunks in `pendingAudioRef` while the WS is still in `CONNECTING` state. On `ws.onopen`, buffered chunks are flushed. This prevents audio loss during the relay connection setup window.

**Relay-ready handshake**: The relay sends `{ type: "relay_ready" }` to the client after upstream is connected, init is sent, and buffered audio is flushed. The client stays in `"connecting"` status until this signal arrives, then transitions to `"live"`. This prevents the UI from showing "live" before the provider is actually ready to receive audio.

**Soniox silence warm-up**: After sending the Soniox init message, the relay sends a 320-byte silence buffer (10ms of 16kHz PCM16) before the 150ms delay. This primes the Soniox engine so it doesn't miss the first words of real audio.

**ElevenLabs audio buffering**: ElevenLabs audio chunks received while upstream is not yet OPEN are queued (as base64 JSON) and flushed on upstream open, rather than dropped. This prevents audio loss during the signed-token fetch window.

### `stt-async`
Accepts `{ provider_id, language, audio: base64, file_name, mime_type }`.
Max audio: 15MB base64 (~10MB file).
Returns `{ transcript, processingTimeMs, wordCount, error? }`.

### `check-user-status`
Returns `{ approved, is_admin, roles, display_name }` for current user.

### `admin-users`
Admin-only. `GET` → all profiles with emails. `POST { user_id, action: "approve"|"reject" }` → sets `profiles.approved`.

---

## Auth flow

1. User signs up on `/auth` → Supabase creates auth user → trigger creates `profiles` row (`approved: false`)
2. `ProtectedRoute` checks `AuthContext` — redirects to `/auth` if no session
3. `/admin` route is **not** wrapped in `ProtectedRoute` (handles its own auth check)
4. User approval status checked via `check-user-status` edge function

Test credentials (auto-confirm enabled on this Supabase project):
- Email: `test@stt.arena` / Password: (set during initial signup)

---

## Audio pipeline (real-time mode)

```
Mic → getUserMedia()
    → AudioContext (16kHz)
    → ScriptProcessorNode (4096 frames)
    → Float32 → PCM Int16 conversion
    → useAudioCapture.onAudioChunk(ArrayBuffer)
        → broadcast to all 4 useRealtimeProvider instances
            → WebSocket providers (elevenlabs, gemini, soniox):
                → WebSocket to stt-ws-relay edge function
                → relay upstream to provider WSS endpoint
            → HTTP polling providers (gemini3, google, whisper):
                → buffer accumulation (3s window)
                → base64 encode → POST stt-realtime edge function
```

`useAudioCapture` uses `ScriptProcessorNode` (deprecated but broadly compatible). An AudioWorklet would be better but adds complexity.

---

## Known issues / technical debt

### 1. Google Cloud STT realtime latency
Google was moved off WebSocket to HTTP polling (same as Whisper) because Deno's `WebSocket` constructor cannot send custom headers, making `Authorization: Bearer` on the WS upgrade impossible. This means ~3s transcript latency in realtime mode. True streaming would require gRPC, which is not available in Deno edge functions without a library.

### 2. Whisper / Gemini 3 / Google use HTTP polling
These providers have no WebSocket path. They use `stt-realtime` (HTTP polling every 3s). Real-time latency is bounded by the 3s buffer window plus provider processing time.

### 3. Gemini 3 Flash preview status
`gemini-3-flash-preview` is a preview model ID. Monitor the Gemini API changelog for the stable ID (likely `gemini-3-flash` or `gemini-3-flash-001`). Update the model string in `stt-async` and `stt-realtime` when stable is released.

### 4. Gemini 3 Flash has no Live API support
`gemini-3-flash-preview` does not support `BidiGenerateContent` (the Live API WebSocket). When Google adds support, move `"gemini3"` into `WS_PROVIDERS` in `useRealtimeProvider.ts` and add a relay case in `stt-ws-relay`.

### 5. Google OAuth2 token not cached
`getGoogleAccessToken()` in `stt-realtime` and `stt-async` performs a full JWT sign + token exchange on every call. Tokens are valid for 1 hour. Edge function instances are stateless so in-memory caching isn't reliable, but for high-volume use a KV store (Supabase `pg_secrets` or Deno KV) could cache the token until near expiry.

### 6. Soniox uses auto-fallback endpoint strategy
The relay tries `wss://stt-rt.soniox.com/transcribe-websocket` (current API) first with a 3-second timeout, then falls back to `wss://api.soniox.com/transcribe-websocket` (legacy). As of Feb 2026, the current API connects successfully from Supabase Deno edge functions.

### 7. Supabase MCP server not configured
The Supabase MCP server requires `SUPABASE_ACCESS_TOKEN` to be set. Currently not configured, so edge function logs and management must be done via the Supabase CLI or dashboard. Deploy edge functions with: `supabase functions deploy <name> --no-verify-jwt`. The Supabase CLI is installed and authenticated — direct CLI deploy works without MCP.

---

## WebSocket lifecycle (useRealtimeProvider)

**Language/provider switching**: When `language` or `providerId` changes, `connectWs` is recreated via `useCallback` deps → the main `useEffect` re-runs. The hook must:
1. Null out `onmessage`/`onclose`/`onerror` on the old WS before closing (prevents stale handlers firing into new state)
2. Close the old WS with code 1000
3. Reset all state (`transcript`, `latencyMs`, `error`, `wordCount`, `rawMessages`, `pendingAudioRef`, `chunkCountRef`)
4. Open a new WS

**Status lifecycle**: `idle` → `connecting` (on WS open) → `live` (on `relay_ready` from relay) → `done`/`error` (on close/error)

**Raw messages**: All string messages from the relay are captured in `rawMessages` state (capped at 200). Available via expandable "Raw (N)" panel in TranscriptionPanel for debugging provider responses.

---

## Session auto-save (Arena.tsx)

When recording stops, a `useEffect` watches all provider statuses. Once all active providers have settled (`idle`/`done`/`error`), it writes to `sessions` + `session_results` tables. An 8-second safety timeout forces save if any provider hangs. Requires authenticated user. Toast confirms save.

---

## Context state

`AppStateContext` holds:
- `mode: "realtime" | "async"` — switching mode calls `resetSession()` which resets panel selections
- `panelSelections: (string | null)[]` — 4 slots, each holds a provider ID or null
- `language: string` — ISO 639-1 code, default `"en"`

`AuthContext` holds Supabase session + user object, listens to `onAuthStateChange`.

---

## Implementation phases (from `.lovable/plan.md`)

- **Phase 1** ✅ — UI scaffolding, auth, provider registry, DB schema, placeholder pages
- **Phase 2** ✅ — `manage-api-keys` edge function, Settings page wired
- **Phase 3** ✅ — `useAudioCapture`, `stt-ws-relay` (true WebSocket), `stt-realtime` (HTTP fallback), `useRealtimeProvider`, Arena wired.
- **Phase 4** ✅ — `stt-async`, `useAsyncProvider`, Batch page
- **Phase 5** ✅ — History page
- **Phase 6** — Benchmarks enhancements (live benchmark run, recharts bar chart, cost calculator)
- **Phase 7** — Polish: mode visual distinction, responsive, a11y, error isolation, skeletons

---

## Adding a new STT provider

1. Add entry to `PROVIDERS` array in `src/lib/providers.ts`
2. If WebSocket-capable: add `case` to `stt-ws-relay/index.ts` (`buildUpstreamUrl`, `buildInitMessage`)
3. If HTTP-only: add `case` to `stt-realtime/index.ts` → `handleRestChunked()`
4. Add `case "newprovider"` to `stt-async/index.ts` → `transcribeWithProvider()`
5. Add `case "newprovider"` to `manage-api-keys/index.ts` → `testProviderKey()`
6. Add provider ID to `ALLOWED_PROVIDERS` in all relevant edge functions
7. Add response parser `case` to `parseProviderMessage()` in `src/hooks/useRealtimeProvider.ts` — set `mode: "replace"` if provider sends cumulative full-stream messages (like Soniox), `"replace_partial"` if cumulative per-utterance (like ElevenLabs), `"append"` if incremental

---

## Soniox integration details

Soniox has **two** WebSocket API versions. The relay (`stt-ws-relay`) tries the current API first, falls back to legacy automatically via `connectSonioxUpstream()`.

### Current API (`stt-rt.soniox.com`) — primary
- **Endpoint**: `wss://stt-rt.soniox.com/transcribe-websocket`
- **Init fields**: `api_key`, `model` (`"stt-rt-preview"`), `audio_format` (`"pcm_s16le"`), `sample_rate` (16000), `num_channels` (1), `language_hints` (array)
- **Response format**: `{ tokens: [{ text, is_final, start_ms, end_ms, confidence, speaker }], final_audio_proc_ms, total_audio_proc_ms, finished }`
- **End signal**: Send empty string `""`
- **Status**: Reachable from Supabase Deno edge functions as of Feb 2026

### Legacy API (`api.soniox.com`) — fallback
- **Endpoint**: `wss://api.soniox.com/transcribe-websocket`
- **Init fields**: `api_key`, `sample_rate_hertz`, `num_audio_channels`, `language_code`
- **NO** `model`, `audio_format`, `sample_rate`, `num_channels` (these cause `Cannot find field` errors)
- **Response format**: `{ fw: [...], nfw: [...], fpt: number, tpt: number, spks: [...] }`
- **End signal**: Send empty buffer `Uint8Array(0)`

### Critical: Soniox sends cumulative token arrays
**Both API versions send ALL tokens from the beginning of the stream in every message**, not just new tokens. The client-side parser returns `mode: "replace"` for Soniox, and the `onmessage` handler replaces the entire transcript (not appends). Word count is set absolutely, not incremented. **Appending Soniox messages causes massive duplication.**

### Client-side parser (`useRealtimeProvider.ts`)
`parseProviderMessage` returns `{ text, isFinal, mode }` where `mode` is:
- `"replace"` for Soniox (cumulative full-stream tokens) — entire transcript is replaced each message
- `"replace_partial"` for ElevenLabs, Google (cumulative per-utterance) — replaces last non-final entry, keeps committed entries
- `"append"` for Gemini, Whisper (incremental) — transcript is appended

Gemini parser checks **both** `serverContent.modelTurn.parts[0].text` (text response) and `serverContent.inputTranscription.text` (native audio transcription) — whichever is non-empty wins. The `inputAudioTranscription: {}` field in the setup message enables the latter path on native audio models.

Handles both Soniox formats:
- Current API: reads `msg.tokens[].text` and `msg.tokens[].is_final`
- Legacy API: reads `msg.fw` and `msg.nfw` arrays, extracts `w.t` or `w.text`

### Soniox async (`stt-async`)
Uses REST endpoint `https://api.soniox.com/v1/transcribe` with `Authorization: Bearer <key>` and multipart form upload. Returns `{ text }` or `{ transcript }`.

### Key learnings
- `stt-rt.soniox.com` was previously unreachable from Supabase Deno but now works (Feb 2026). The relay still has auto-fallback to `api.soniox.com` as insurance.
- Mixing field names across API versions causes silent failures or `Cannot find field` errors
- Audio buffering is critical at TWO levels: relay-side (`audioQueue`) and client-side (`pendingAudioRef`). Without either, packets are silently dropped during connection setup. The relay adds a 150ms delay between Soniox init and queue flush to allow init processing.
- Soniox requires a proper finalize protocol — sending the end signal then immediately closing the upstream WS loses all final tokens. Must wait for `finished: true` (or timeout).
- Soniox cumulative token responses MUST replace (not append) transcript state, or the UI shows massive word duplication.
