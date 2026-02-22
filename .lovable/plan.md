

# Full Implementation Plan: STT Demo Platform (Phases 2-7)

## Test Credentials

Since the app uses email/password auth, you just need to sign up on the auth page. I will **enable auto-confirm** so you can sign in immediately without checking your email. Use any credentials you like, for example:

- **Email:** `test@sttarena.com`  
- **Password:** `TestArena123!`

(Or any email/password you prefer -- just sign up on the `/auth` page and you're in.)

---

## Current State (Phase 1 -- Done)

- Landing page, Auth (sign up/in), Provider Registry, Database schema (profiles, api_keys, sessions, session_results with RLS), AppState context, ArenaLayout with mode toggle + language selector, TranscriptionPanel component, placeholder pages for Arena, Batch, Benchmarks, Settings
- **Missing:** Everything is UI scaffolding only. No edge functions, no working API key save/load, no audio pipeline, no WebSocket/REST integration, no history page.

---

## Phase 2: API Key Management (Edge Function + Settings UI)

### 2a. Edge Function: `manage-api-keys`
- Single edge function handling CRUD for API keys
- Endpoints: `POST` (save key), `GET` (list keys + statuses), `DELETE` (remove key)
- Keys stored in `api_keys` table (the `encrypted_key` column stores the raw key for now -- true encryption via pgcrypto can be added later)
- Validates user auth via JWT from the request
- Returns key status per provider (configured / not_configured)

### 2b. Settings Page Wired Up
- On mount: fetch all user API keys via the edge function, show status badges (green check / yellow warning)
- Save button: calls edge function to upsert the key for that provider
- Test button: calls a lightweight provider-specific validation (e.g., a minimal API call to verify the key works)
- Delete button: remove a key
- Real status badges reflecting database state

---

## Phase 3: Real-Time Arena (Audio Pipeline + WebSocket Proxy)

### 3a. Audio Capture Hook: `useAudioCapture`
- `getUserMedia()` to capture mic
- AudioWorklet processor to resample to PCM 16-bit, 16kHz, mono
- Returns start/stop controls and an `onAudioChunk` callback that fires with raw PCM buffers
- Shared across all panels -- single mic capture, broadcast to all

### 3b. Edge Function: `stt-realtime`
- Accepts WebSocket upgrade from the browser
- Params: `providerId`, `language`
- Reads user's API key from `api_keys` table
- Opens a WebSocket/connection to the target provider's real-time endpoint
- Relays PCM audio chunks from browser to provider, relays transcript chunks back
- Each provider has slightly different handshake/protocol -- handled via a provider adapter pattern inside the edge function:
  - **ElevenLabs:** Send config JSON first, then binary PCM frames, receive JSON transcript events
  - **Gemini:** Use BidiGenerateContent setup message, send audio parts, receive text parts
  - **Google Cloud STT:** Send streaming recognize config, stream audio, receive results
  - **Soniox:** Send auth token in first message, then PCM, receive transcript JSON
  - **Whisper:** Chunked REST approach -- accumulate ~5s of audio, send as file to transcriptions endpoint, return result (pseudo-realtime)

### 3c. Real-Time Provider Hook: `useRealtimeProvider(providerId)`
- Generic hook that:
  1. Opens WebSocket to our `stt-realtime` edge function with `providerId` param
  2. Sends PCM chunks received from `useAudioCapture`
  3. Receives transcript chunks, updates state
  4. Tracks latency per chunk (time between sending audio and receiving transcript)
  5. Handles connection status (connecting / live / error)
  6. Reconnect on error with backoff

### 3d. Arena Page Fully Wired
- Record button starts/stops `useAudioCapture`
- Each panel with a selected provider instantiates `useRealtimeProvider(providerId)`
- Audio chunks broadcast to all active provider hooks simultaneously
- TranscriptionPanel receives live transcript, status, latency, wordCount as props
- Copy button copies transcript to clipboard
- Clear button resets panel transcript
- Bottom comparison bar shows live stats: word count per provider, lowest latency, error count (updates every 2s)

### 3e. Session Persistence
- On record start: create a session row in `sessions` table
- On record stop: update `ended_at`, save each panel's result to `session_results`

---

## Phase 4: Async Batch Mode (File Upload + REST Proxy)

### 4a. Edge Function: `stt-async`
- Accepts POST with: `providerId`, `language`, audio file (as base64 or multipart)
- Reads user's API key from `api_keys` table
- Calls the provider's async REST endpoint:
  - **ElevenLabs:** POST to `/v1/speech-to-text` with audio file
  - **Gemini:** POST to generativelanguage REST endpoint with audio content
  - **Google Cloud:** POST to `/v1/speech:recognize` with audio content
  - **Soniox:** POST to `/transcribe` with audio file
  - **Whisper:** POST to `/v1/audio/transcriptions` with audio file
- Returns: transcript text, processing time, word count, or error

### 4b. Async Provider Hook: `useAsyncProvider(providerId)`
- Generic hook that:
  1. Sends file to `stt-async` edge function with `providerId`
  2. Tracks upload progress (if possible) and processing status
  3. Returns transcript, processing time, word count, error
  4. Supports retry

### 4c. Batch Page Fully Wired
- After file upload, a "Process" button sends the file to all selected providers in parallel
- Each panel shows: progress state (uploading / processing / done / error)
- On completion: full transcript, metadata (processing time, word count, language)
- Copy + Export buttons (.txt and .json download)
- Retry button per panel
- Session saved to database on completion

---

## Phase 5: History Page

### 5a. New Route: `/history`
- Add to App.tsx routes (protected)
- Add nav link in ArenaLayout

### 5b. History Page UI
- Fetch all user sessions from `sessions` + `session_results` tables
- List view: timestamp, mode badge (Real-time / Async), providers used, first 100 chars of transcript
- Click to expand: full transcript per provider, latency data, processing time
- Export session as `.txt` or `.json`
- Delete session button

---

## Phase 6: Benchmarks Page Enhancement

The current benchmarks page is static and already functional. Enhancements:
- Add a "Run Live Benchmark" button that triggers a short recording (real-time) or test file (async) across all providers and displays actual measured latency
- Visual bar chart for latency comparison (using recharts, already installed)
- Cost calculator: input audio minutes, see estimated cost per provider

---

## Phase 7: Polish and Accessibility

- **Mode visual distinction:** Real-time mode gets a subtle red/warm accent (live feel), Async mode gets blue/cool accent
- **Responsive:** Ensure 2x2 grid collapses to single column on mobile
- **Accessibility:** `aria-live="polite"` on transcript regions (already in place), keyboard-navigable record button, proper focus management on modals
- **Error isolation:** Each panel catches its own errors independently
- **Loading states:** Skeleton loaders for settings page, history page
- **Toast notifications:** Success/error feedback for key save, session save, copy actions

---

## Technical Details: File-by-File Changes

### New Files
| File | Purpose |
|---|---|
| `supabase/functions/manage-api-keys/index.ts` | CRUD for API keys per user |
| `supabase/functions/stt-realtime/index.ts` | WebSocket proxy for real-time STT |
| `supabase/functions/stt-async/index.ts` | REST proxy for async STT |
| `src/hooks/useAudioCapture.ts` | Mic capture + PCM resampling hook |
| `src/hooks/useRealtimeProvider.ts` | Generic WebSocket STT hook |
| `src/hooks/useAsyncProvider.ts` | Generic REST STT hook |
| `src/hooks/useApiKeys.ts` | Hook for fetching/saving API keys |
| `src/pages/History.tsx` | Session history page |
| `src/components/ComparisonBar.tsx` | Bottom stats bar for arena |
| `src/components/AudioRecorder.tsx` | Record button + audio capture component |

### Modified Files
| File | Changes |
|---|---|
| `src/pages/Settings.tsx` | Wire up save/load/test/delete with edge function |
| `src/pages/Arena.tsx` | Integrate audio capture, realtime hooks, session persistence |
| `src/pages/Batch.tsx` | Integrate file upload to async hook, show results, export |
| `src/pages/Benchmarks.tsx` | Add recharts bar chart, cost calculator, live benchmark button |
| `src/components/TranscriptionPanel.tsx` | Accept richer props for async mode (progress bar, export) |
| `src/components/ArenaLayout.tsx` | Add History nav link |
| `src/App.tsx` | Add `/history` route |
| `src/contexts/AppStateContext.tsx` | Add session tracking state (current session ID, results per panel) |
| `supabase/config.toml` | Add edge function configs with `verify_jwt = false` |

### Database Migration
- Enable auto-confirm for email signups (so you can test immediately)
- No new tables needed (schema is already complete)

---

## Implementation Order

Due to the size of this work, I will implement it in sequential messages:

1. **Message 1:** Enable auto-confirm + `manage-api-keys` edge function + Settings page wired up
2. **Message 2:** `useAudioCapture` hook + `stt-realtime` edge function + `useRealtimeProvider` hook + Arena fully wired
3. **Message 3:** `stt-async` edge function + `useAsyncProvider` hook + Batch page fully wired
4. **Message 4:** History page + Benchmarks enhancements + final polish

Each message will be a working increment you can test.

