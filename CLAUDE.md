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
VITE_SUPABASE_PROJECT_ID=wcgueplbxwxpfvupnpqa
VITE_SUPABASE_URL=https://wcgueplbxwxpfvupnpqa.supabase.co
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
    useRealtimeProvider.ts       # Polls stt-realtime edge function every 3s (pseudo-realtime)
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
    stt-realtime/index.ts       # REST-based chunked transcription (NOT true WebSocket)
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

| ID | Name | Real-time endpoint (registered) | Async endpoint |
|---|---|---|---|
| `elevenlabs` | Eleven Labs | `wss://api.elevenlabs.io/v1/speech-to-text/realtime` | `https://api.elevenlabs.io/v1/speech-to-text` |
| `gemini` | Gemini Live | `wss://generativelanguage.googleapis.com/ws` | Gemini generateContent REST |
| `google` | Google Cloud STT | `wss://speech.googleapis.com/v1/speech:streamingRecognize` | `/v1/speech:recognize` |
| `soniox` | Soniox | `wss://api.soniox.com/transcribe-websocket` | `https://api.soniox.com/v1/transcribe` |
| `whisper` | OpenAI Whisper | (REST only) | `https://api.openai.com/v1/audio/transcriptions` |

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
- CORS: only `*.lovable.app` origins (hardcoded — **needs updating** for non-Lovable deployments)
- Auth: Bearer token validated against Supabase
- Input validation on all fields

### `manage-api-keys`
- `GET` → list provider_id + status for current user
- `POST` → save key (encrypts with pgcrypto before storing) or `action: "test"` (validates key against provider API)
- `DELETE` → remove key

Test endpoints per provider:
- ElevenLabs: `GET /v1/user`
- Gemini: `GET /v1beta/models?key=...`
- Google: validates JSON structure of service account key (no live call)
- Soniox: `GET /v1/models`
- Whisper: `GET /v1/models`

### `stt-realtime`
Accepts `{ provider_id, language, audio: base64_pcm }`. Wraps PCM in a WAV header and calls the **async REST** endpoint — not a true WebSocket relay. See known issues below.

Minimum audio size: 1600 bytes (silently returns empty transcript below this).
Max audio size: 5MB base64.

### `stt-async`
Accepts `{ provider_id, language, audio: base64, file_name, mime_type }`.
Max audio: 15MB base64 (~10MB file).
Returns `{ transcript, processingTimeMs, wordCount, error? }`.

Note: uses `supabase.auth.getClaims(token)` (not `getUser()`) — different auth pattern from `stt-realtime`.

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
- Email: `test@sttarena.com` / Password: `TestArena123!`

---

## Audio pipeline (real-time mode)

```
Mic → getUserMedia()
    → AudioContext (16kHz)
    → ScriptProcessorNode (4096 frames)
    → Float32 → PCM Int16 conversion
    → useAudioCapture.onAudioChunk(ArrayBuffer)
        → broadcast to all 4 useRealtimeProvider instances
            → buffer accumulation (3s window)
            → base64 encode
            → POST stt-realtime edge function
            → update transcript state
```

`useAudioCapture` uses `ScriptProcessorNode` (deprecated but broadly compatible). An AudioWorklet would be better but adds complexity.

---

## Known issues / technical debt

### 1. Real-time is fake (pseudo-realtime)
`useRealtimeProvider.ts` accumulates PCM for 3 seconds then sends a batch HTTP POST to `stt-realtime`. It does **not** open a WebSocket. The `realtimeEndpoint` URLs in `providers.ts` are registered but never used.

**Plan**: `stt-realtime` should accept a WebSocket upgrade, open a persistent connection to the provider's WSS endpoint, and relay frames bidirectionally.

### 2. ElevenLabs language code mapping is broken
`stt-realtime/index.ts:99` and `stt-async/index.ts:65`: only maps `"en"` → `"eng"`. ElevenLabs Scribe v2 requires ISO 639-3 codes (`spa`, `fra`, `deu`, etc.). All other languages are passed raw (ISO 639-1) and will fail.

### 3. Soniox missing from `stt-realtime`
`stt-realtime/index.ts` has no `case "soniox"` — falls through to `error = "Unsupported provider"` even though it's in `ALLOWED_PROVIDERS`.

### 4. CORS hardcoded to `.lovable.app`
All edge functions check `origin.endsWith(".lovable.app")`. Running from `localhost` or any other domain will hit the CORS fallback. Update `isAllowedOrigin()` in each function for local dev or custom domains.

### 5. Google Cloud STT uses Bearer token directly
The async function passes the raw API key as a Bearer token. Google Cloud actually requires OAuth2 or a service account JWT — not an API key. The manage-api-keys test validates JSON structure only.

### 6. `stt-async` uses `getClaims()`, `stt-realtime` uses `getUser()`
Inconsistent auth patterns across edge functions.

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
- **Phase 3** ✅ (partial) — `useAudioCapture`, `stt-realtime` (pseudo), `useRealtimeProvider`, Arena wired. True WebSocket relay not implemented.
- **Phase 4** ✅ — `stt-async`, `useAsyncProvider`, Batch page
- **Phase 5** ✅ — History page
- **Phase 6** — Benchmarks enhancements (live benchmark run, recharts bar chart, cost calculator)
- **Phase 7** — Polish: mode visual distinction, responsive, a11y, error isolation, skeletons

---

## Adding a new STT provider

1. Add entry to `PROVIDERS` array in `src/lib/providers.ts`
2. Add `case "newprovider"` to `stt-realtime/index.ts` → `handleRestChunked()`
3. Add `case "newprovider"` to `stt-async/index.ts` → `transcribeWithProvider()`
4. Add `case "newprovider"` to `manage-api-keys/index.ts` → `testProviderKey()`
5. Add provider ID to `ALLOWED_PROVIDERS` in all three edge functions
