# STT Demo Platform — Lovable Build Spec

> **How to use this doc:** Answer every question in the **"Open Questions"** section first, then paste this entire file into Lovable as your initial prompt. Lovable should be able to scaffold the full app in one pass.

---

## Open Questions (Answer These Before Building)

Answer inline by replacing each `[ ]` with your choice or filling in the blank.

### Q1 — Deployment target
Where will this app run?
- [ ] Purely client-side (no server, API keys entered by the user in the browser)
- [ ] Full-stack with a backend (Supabase Edge Functions / Node server to proxy API calls)
- [ ] Both: client-side demo mode + optional backend for production use

### Q2 — Which providers to launch with?
Which STT providers should be included in v1? (check all that apply)
- [x] Eleven Labs Scribe v2 (WebSocket for real-time, REST for async)
- [x] Gemini Live API (WebSocket for real-time, REST for async)
- [x] Google Cloud Speech-to-Text (WebSocket for real-time, REST for async)
- [x] Soniox (WebSocket for real-time, REST for async)
- [x] OpenAI Whisper (REST for async, can be used in real-time with chunked streaming)

**Note:** All 5 providers work in BOTH modes. Real-time UI is a 2×2 grid (4 panels max), async is also 2×2 grid (4 panels max) for consistency. New providers can be added via config objects without UI changes.

### Q3 — Auth / API key management
How should API keys be handled?
- [ ] Users paste their own keys into a settings panel (no backend required)
- [ ] Keys stored server-side via environment variables (backend required)
- [ ] Supabase Vault for key storage per user

### Q4 — User accounts
- [ ] No auth — fully public demo, anyone can access
- [ ] Supabase Auth — users sign up, keys and history saved to their account
- [ ] Single password / magic-link for private team access

### Q5 — Visual style
- [ ] Dark-mode technical dashboard (think Vercel / Linear)
- [ ] Clean light SaaS (think Notion / Linear light)
- [ ] Minimal hacker terminal aesthetic
- [ ] No preference — Lovable decides

### Q6 — Languages / locales
- [ ] English only for UI and transcription demos
- [ ] Multi-language: UI in English, but transcription demo should support selecting a target language per provider

### Q7 — Metrics & benchmarking
Should the app display live latency, word error rate estimates, or cost-per-minute comparisons?
- [ ] Yes — show latency badge per provider, cost table
- [ ] Latency only (no cost info)
- [ ] No metrics — clean transcription view only

### Q8 — Export / history
- [ ] Save transcription sessions to browser localStorage
- [ ] Save to Supabase (requires auth)
- [ ] No saving — session only

---

## App Overview

**Product name:** STT Demo Platform (working title)

**One-liner:** A browser-based arena to benchmark Speech-to-Text APIs — pick any providers, pick any mode (real-time or async), compare side-by-side in a flexible 2×2 grid.

**Target user:** Developers and product teams evaluating STT providers for their products.

**Core value prop:**
- **Flexible provider selection:** Choose any 4 providers from the library (Eleven Labs, Gemini, Google, Soniox, Whisper)
- **Real-time mode:** Speak into your mic, see all selected providers transcribe simultaneously with live latency badges
- **Async mode:** Upload an audio file, watch all selected providers process it in parallel with detailed metrics
- **Scalable architecture:** Easy to add new providers without UI changes

---

## Screens & Features

### 1. Home / Landing
- Hero: single headline, one CTA ("Choose Your Mode")
- Two large buttons:
  - **Real-time Arena** — "4-way live transcription from your mic"
  - **Async Batch** — "Upload audio, get detailed transcription"
- Brief provider logos (Eleven Labs, Google, Gemini, Soniox for real-time; Whisper for async)
- No login wall by default (see Q4)

---

### 2a. Real-Time Arena (Main screen — Mode: Live)

**Header:**
- Mode toggle: [Real-time Arena] [Async Batch] (hard switch, resets the session)
- Settings gear → opens API key modal

**Control Panel (top bar):**
- Language selector (if Q6 = multi-language)
- **Record button:** Large, centered, dominant
  - Text: "🔴 START" (recording) or "⏹️ STOP" (idle)
  - On click: toggles microphone capture and broadcasts to all selected providers

**Transcription Arena (2×2 grid):**
- Exactly 4 panels in fixed positions (top-left, top-right, bottom-left, bottom-right)
- Each panel **header has a dropdown** to select which provider to use
  - Default: panels pre-fill with [Eleven Labs, Gemini, Google Cloud, Soniox] but users can change any
  - Dropdown shows all available providers (5 options: Eleven Labs, Gemini, Google Cloud, Soniox, Whisper)
  - Same provider can be selected in multiple panels (for testing different settings)
  - Clearing a panel = selecting "None" from dropdown
- Each panel contains:
  - **Provider selector dropdown** (in header)
  - Provider logo (changes when dropdown selection changes)
  - Large live transcript text (words stream in as spoken, left-aligned)
  - Status indicator badge: Connecting / Live / Error / None
  - **Latency badge** (bottom-right): updates per chunk (e.g. "145ms") — if Q7 includes latency
  - Copy transcript button (bottom bar)
  - Clear button (bottom bar)
  - Error overlay (if provider fails) — shows error message, "retry" button, or "check API key" link

**Bottom Comparison Bar:**
- Real-time summary: Word count per provider, lowest latency provider, error count
- Updated every 2 seconds

---

### 2b. Async Batch (Main screen — Mode: Batch)

**Completely different layout from real-time.**

**Header:**
- Mode toggle: [Real-time Arena] [Async Batch] (hard switch, resets the session)
- Settings gear → opens API key modal

**Upload Zone (top, full-width prominent box):**
- Large drag-and-drop zone: "Drop audio file here or click to upload"
- Supported formats: `.mp3`, `.wav`, `.m4a`, `.ogg`, `.flac`
- Max file size: 25MB
- Language selector (if Q6 = multi-language) next to upload zone

**Provider Selection (below upload zone):**
- **2×2 grid of provider selector dropdowns** (same layout as real-time, but for async)
  - Each dropdown allows user to pick which provider to send the file to
  - Default: [Eleven Labs, Gemini, Google Cloud, Soniox] (but can swap for Whisper or leave empty)
  - Selecting same provider multiple times = batch multiple requests

**Processing State (after file upload):**
- One **result panel per selected provider**, in the 2×2 grid
- Each panel shows:
  - Provider name + logo (header)
  - Progress bar (0–100%) while processing
  - Status text: "Uploading...", "Processing...", "Done"
  - File name + size
  - Estimated time remaining (if API provides it)

**Result Panel (after processing complete):**
- Full transcript displayed in large, readable font
- Copy button + Export as `.txt` / `.json` buttons
- Metadata: Processing time, file duration, language, word count
- Retry button (if user wants to re-process with different settings)
- Error state: If provider fails, show error message + "retry" link

**Visual difference:** Async grid is **processing-focused**. Real-time is **streaming-focused**. Both use same 2×2 grid for consistency.

---

### 3. Settings / API Keys Modal
- **Dynamic provider list:** Rendered from provider registry (scalable for new providers)
- Text inputs for each provider's API key (loaded from registry)
- Keys stored in localStorage (encrypted) or Supabase Vault (see Q3)
- "Test connection" button per provider (tests both real-time and async endpoints if applicable)
- Link to each provider's free-tier signup (loaded from provider config)
- Status indicator: ✓ Connected / ✗ Invalid key / ⚠ Not configured

---

### 4. History Panel (if Q8 = save sessions)
- List of past sessions with timestamp, mode (Real-time / Async), provider(s) used, first 100 chars of transcript
- Click to expand full transcript
- Export as `.txt` or `.json`

---

### 5. Metrics / Benchmarks Page (if Q7 = yes)
- Static comparison table: latency, cost per minute, language count, features
- Data sourced from the research doc (can be hardcoded initially)
- **Real-time benchmark:** 4-way side-by-side latency comparison
- **Async benchmark:** Whisper processing time + accuracy metrics

---

## Technical Architecture

### Frontend
- **Framework:** React + TypeScript (Lovable default)
- **Styling:** Tailwind CSS + shadcn/ui components
- **State:** React Context or Zustand for:
  - Global app mode (real-time vs async)
  - Provider selections per panel (2×2 grid)
  - Current session transcript + metadata per provider
  - Provider connection status + latency
  - Available providers (config array, extensible)

**Provider-Agnostic Architecture (scalability):**
- **Provider registry:** Centralized config object listing all available providers with endpoints, auth, languages
- **Generic provider hooks:** `useRealtimeProvider(providerId)` and `useAsyncProvider(providerId)` instead of provider-specific hooks
  - These hooks automatically select the right endpoint (WebSocket for real-time, REST for async)
  - Same hook logic for any new provider without code changes
- **Panel component:** Generic `<TranscriptionPanel>` that accepts a `providerId` prop and auto-configures
- **Audio capture:** Web Audio API + `MediaRecorder` / `AudioWorklet` for PCM capture (real-time mode only)
- **Mode switching:** Hard reset on mode change (disconnect all WebSockets, clear transcript, reset state)

### Audio Pipeline (Real-Time Mode Only)
```
Microphone
  → getUserMedia()
  → AudioWorklet (resample to 16kHz PCM 16-bit mono)
  → Broadcast to all active provider WebSocket connections simultaneously
     (WebSocket endpoints determined by provider registry, not hardcoded)
```

**Key constraint:** All real-time providers require **PCM 16-bit, 16kHz mono**. The AudioWorklet resampler normalizes once, upstream of all WebSocket connections.

**Async mode:**
```
File Upload
  → Read as ArrayBuffer
  → Send to all selected provider REST endpoints (determined by provider registry)
  → Collect results as they return
```

**Scalability:** Audio pipeline doesn't know about specific providers — it reads from the provider registry and connects to whatever endpoints are configured.

### Provider Integration Details

All providers support both real-time (WebSocket) and async (REST) modes. Choose the appropriate endpoint based on mode.

#### Eleven Labs Scribe v2

| Mode | Protocol | Endpoint | Notes |
|---|---|---|---|
| Real-time | WebSocket | `wss://api.elevenlabs.io/v1/speech-to-text/realtime` | Auth via `xi-api-key` header, stream PCM 16-bit 16kHz |
| Async | REST | `https://api.elevenlabs.io/v1/speech-to-text` | POST audio file, returns full transcript |

#### Gemini Live API

| Mode | Protocol | Endpoint | Notes |
|---|---|---|---|
| Real-time | WebSocket | Google AI SDK (`@google/genai`) | Uses `BidiGenerateContent` stream |
| Async | REST | Google AI SDK REST endpoint | Send audio chunks in request body |

#### Google Cloud Speech-to-Text

| Mode | Protocol | Endpoint | Notes |
|---|---|---|---|
| Real-time | WebSocket | `wss://speech.googleapis.com/...` | gRPC-web compatible, stream PCM |
| Async | REST | `https://speech.googleapis.com/v1/speech:recognize` | POST audio file via REST API |

#### Soniox

| Mode | Protocol | Endpoint | Notes |
|---|---|---|---|
| Real-time | WebSocket | `wss://api.soniox.com/transcribe-websocket` | Auth via token in first message |
| Async | REST | `https://api.soniox.com/transcribe` | POST audio file, returns transcript |

#### OpenAI Whisper

| Mode | Protocol | Endpoint | Notes |
|---|---|---|---|
| Real-time | REST (chunked) | `https://api.openai.com/v1/audio/transcriptions` | Can chunk file and stream, or collect all then send once |
| Async | REST | `https://api.openai.com/v1/audio/transcriptions` | Standard batch API, best for large files |

**Scalability note:** To add a new provider, create a config object with:
```typescript
{
  id: 'provider-id',
  name: 'Provider Name',
  logo: 'url-to-logo',
  realtimeEndpoint: 'wss://...',
  realtimeAuth: {...},
  asyncEndpoint: 'https://...',
  asyncAuth: {...},
  supportedLanguages: [...]
}
```
No UI changes required.

### Backend (if Q1 requires it)
- **Supabase Edge Functions** — proxy API calls, hide keys server-side
- One Edge Function per provider or a single multiplexed function
- CORS handled at function level

---

## Data Models

```typescript
// Provider configuration (scalable for new providers)
interface ProviderConfig {
  id: string;  // 'elevenlabs' | 'gemini' | 'google' | 'soniox' | 'whisper'
  name: string;
  logo: string;
  realtimeEndpoint: string;
  realtimeAuth: { type: string; [key: string]: any };
  asyncEndpoint: string;
  asyncAuth: { type: string; [key: string]: any };
  supportedLanguages: string[];
  description?: string;
}

// App State
interface AppState {
  mode: 'realtime' | 'async';
  currentSession?: TranscriptionSession;
  panelProviders: (string | null)[];  // 2×2 grid: 4 provider IDs (can be duplicates or null)
  availableProviders: ProviderConfig[];  // All registered providers
}

// Session
interface TranscriptionSession {
  id: string;
  mode: 'realtime' | 'async';
  startedAt: Date;
  endedAt?: Date;
  providers: ProviderResult[];  // One per active panel
}

// Per-provider result (works for both modes)
interface ProviderResult {
  panelId: string;  // Which panel is this result from? (0-3)
  providerId: string;  // Which provider? (extensible: elevenlabs | gemini | google | soniox | whisper | ...)
  transcript: TranscriptChunk[];
  latencyMs: number[];  // one per chunk (real-time) or null (async)
  processingTimeMs?: number;  // async mode or real-time total
  status: 'connecting' | 'live' | 'done' | 'error' | 'empty';
  error?: string;
}

// Transcript chunk (streaming word/sentence in real-time, full text in async)
interface TranscriptChunk {
  text: string;
  isFinal: boolean;
  timestampMs: number;
}
```

---

## Non-Functional Requirements

- **Browser support:** Chrome 110+, Edge 110+, Firefox 120+ (Web Audio API required for real-time; standard fetch for async)
- **Mobile:** Responsive layout, mic access works on iOS Safari 16.4+ (real-time mode)
- **No audio stored server-side** — audio bytes only travel from browser to provider APIs directly (client-side mode) or through ephemeral Edge Function (backend mode)
- **Mode isolation:** Switching modes must reset all state, disconnect all WebSockets, clear transcript
- **Error handling:** Clear error state in each provider panel if it fails (bad key, quota exceeded, network drop) — never crash the whole app. Other panels continue operating.
- **Accessibility:** Keyboard navigable record button (real-time), ARIA labels on live transcript regions (`aria-live="polite"`), file input accessible in async mode

**Scalability Requirements:**
- **Provider-agnostic:** Adding a new provider should require only adding a config object, no React component or hook changes
- **Grid flexibility:** 2×2 grid should support empty panels, duplicate providers, and any combination
- **Generic hooks:** `useRealtimeProvider()` and `useAsyncProvider()` should work for any provider in the registry
- **Config-driven:** All provider metadata, endpoints, auth methods stored in a centralized provider registry (can be loaded from server)

---

## Nice-to-Haves (Post-v1)

- Speaker diarization visualization in real-time (Eleven Labs supports this)
- Word-level timestamps + audio playback sync (real-time mode)
- Shareable session links (public transcript URLs)
- Export to SRT subtitle format (async mode)
- Custom vocabulary per provider (real-time mode)
- Confidence scores per word in async mode
- Side-by-side mode comparison table (latency, word count, error rate)

---

## Reference Research

All 5 providers support BOTH real-time (WebSocket) and async (REST) modes:

### Eleven Labs Scribe v2
- **Real-time:** WebSocket streaming, ~150ms latency, 90+ languages, speaker diarization
- **Async:** REST endpoint for batch file uploads
- **Strength:** Low latency, speaker diarization support

### Gemini Live API
- **Real-time:** WebSocket streaming, multimodal (audio + text), VAD built-in
- **Async:** REST endpoint for file uploads
- **Strength:** Multimodal, intelligent chunking

### Google Cloud Speech-to-Text
- **Real-time:** gRPC-web compatible, 125+ languages
- **Async:** REST endpoint for batch operations
- **Strength:** Most mature API, language support, enterprise-grade

### Soniox
- **Real-time:** WebSocket streaming, enterprise accuracy, custom vocabulary, ~300ms latency
- **Async:** REST endpoint for batch uploads
- **Strength:** High accuracy, custom vocabulary support

### OpenAI Whisper
- **Real-time:** Can be used with chunked streaming via REST
- **Async:** REST endpoint optimized for batch, ~99% accuracy on English, 99+ languages
- **Strength:** Highest accuracy, multilingual, cost-effective

**Common audio standard for real-time:** PCM 16-bit, 16kHz, mono

---

## Lovable Prompt (paste after answering open questions above)

Once you've filled in your answers, prepend the following to this file and paste everything into Lovable:

```
Build a React + TypeScript + Tailwind + shadcn/ui app using the spec below.

CRITICAL: Build with a PROVIDER-AGNOSTIC, SCALABLE architecture. Adding new providers should require only config changes, NOT code changes.

## Key Architecture Points

1. **Provider Registry:** Centralized config object (can be hardcoded initially, designed to load from server later) containing all provider metadata:
   - id, name, logo, endpoints (real-time WebSocket + async REST), auth methods, supported languages
   - No hardcoded provider-specific logic in components

2. **Generic Provider Hooks:** Instead of useElevenLabsSTT(), useGeminiLive(), etc.:
   - useRealtimeProvider(providerId) — automatically uses the right WebSocket endpoint
   - useAsyncProvider(providerId) — automatically uses the right REST endpoint
   - Same logic for any provider, old or new

3. **Generic Panel Component:** <TranscriptionPanel providerId={id} mode={mode} />
   - Automatically configures itself based on provider config
   - No hardcoded UI per provider

## Implementation Details

**Dual-mode platform:**
1. **Real-Time Arena:** 2×2 grid of panels, each with a provider dropdown. User speaks, all selected providers transcribe simultaneously from WebSocket streams.
   - Broadcast PCM 16-bit 16kHz mono to all active providers
   - Show live latency badges
   - Transcripts stream as spoken

2. **Async Batch:** 2×2 grid of panels (same layout), each with provider dropdown. User uploads file, all selected providers process it via REST APIs.
   - Show progress bars
   - Display results when done
   - Allow retry per provider

**Flexibility:**
- Users can select any provider for any panel (5 providers: Eleven Labs, Gemini, Google, Soniox, Whisper)
- Same provider can be used multiple times
- Panels can be left empty (None)

MODE SWITCHING: Hard reset on mode change (disconnect WebSockets, clear state, fresh session). Modes should look visually different.

Follow the data models exactly, especially ProviderConfig and the extensible provider ID system.

[PASTE REST OF THIS DOCUMENT]
```
