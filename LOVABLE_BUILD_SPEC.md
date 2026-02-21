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
- [x] Eleven Labs Scribe v2 (WebSocket, ~150ms latency) — **Real-time only**
- [x] Gemini Live API (WebSocket, multimodal) — **Real-time only**
- [x] Google Cloud Speech-to-Text (WebSocket) — **Real-time only**
- [x] Soniox (WebSocket) — **Real-time only**
- [x] OpenAI Whisper (async/batch only) — **Async only**

**Note:** Gladia removed for simplicity. Real-time limited to 4 providers for 2×2 grid layout.

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

**One-liner:** A browser-based arena to benchmark Speech-to-Text APIs — choose your mode: live 4-way real-time comparison from your mic, or batch async transcription via file upload.

**Target user:** Developers and product teams evaluating STT providers for their products.

**Core value prop:**
- **Real-time mode:** Speak once, see 4 providers transcribe simultaneously in a 2×2 grid with live latency badges.
- **Async mode:** Upload an audio file and watch Whisper process it with detailed analytics.

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
- **Provider selector:** 4 large toggle buttons, one per real-time provider (Eleven Labs, Gemini, Google Cloud, Soniox)
  - All start **enabled** by default
  - Toggling off removes that provider's panel
  - Cannot disable all — at least one must remain active
- Language selector (if Q6 = multi-language)
- **Record button:** Large, centered, dominant
  - Text: "🔴 START" (recording) or "⏹️ STOP" (idle)
  - On click: toggles microphone capture and broadcasts to all enabled providers

**Transcription Arena (2×2 grid):**
- Exactly 4 panels, one per provider in fixed positions (top-left, top-right, bottom-left, bottom-right)
- Each panel contains:
  - Provider name + logo (header)
  - Large live transcript text (words stream in as spoken, left-aligned)
  - Status indicator badge: Connecting / Live / Error
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

**Upload Zone (center, full-width prominent box):**
- Large drag-and-drop zone: "Drop audio file here or click to upload"
- Supported formats: `.mp3`, `.wav`, `.m4a`, `.ogg`, `.flac`
- Max file size: 25MB
- Language selector (if Q6 = multi-language) above the upload zone

**Processing State:**
- Once file is selected/uploaded, show:
  - File name + size
  - Progress bar (0–100%)
  - Status text: "Uploading...", "Processing...", "Done"
  - Cancel button (while processing)

**Result Panel (after processing):**
- Full-width text result
- Transcript displayed in large, readable font
- Copy button + Export as `.txt` / `.json` buttons
- Metadata: File name, duration, language, processing time
- Retry button (if user wants to re-process with different settings)

**Visual difference:** Async is **minimal, focused, single-column**. Real-time is **multi-column grid, constant streaming**.

---

### 3. Settings / API Keys Modal
- Text inputs for each provider's API key:
  - Real-time providers: Eleven Labs, Gemini, Google Cloud, Soniox
  - Async provider: OpenAI (for Whisper)
- Keys stored in localStorage (encrypted) or Supabase Vault (see Q3)
- "Test connection" button per provider
- Link to each provider's free-tier signup

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
  - Active providers in each mode
  - Current session transcript + metadata
  - Provider connection status + latency
- **Audio capture:** Web Audio API + `MediaRecorder` / `AudioWorklet` for PCM capture (real-time mode only)
- **WebSocket clients:** One hook per real-time provider (`useElevenLabsSTT`, `useGeminiLive`, `useGoogleCloudSTT`, `useSoniox`)
- **Async client:** One hook for Whisper (`useWhisperAsync`)
- **Mode switching:** Hard reset on mode change (disconnect all WebSockets, clear transcript, reset state)

### Audio Pipeline (Real-Time Mode Only)
```
Microphone
  → getUserMedia()
  → AudioWorklet (resample to 16kHz PCM 16-bit mono)
  → Broadcast to all 4 active provider WebSocket connections simultaneously
```

**Key constraint:** All real-time providers require **PCM 16-bit, 16kHz mono**. The AudioWorklet resampler should normalize once, upstream of all WebSocket connections.

**Async mode:** File upload → read entire file as ArrayBuffer → send to Whisper REST API in one request.

### Provider Integration Details

#### Real-Time Providers (WebSocket, Streaming)

| Provider | Protocol | Endpoint | Notes |
|---|---|---|---|
| Eleven Labs Scribe v2 | WebSocket | `wss://api.elevenlabs.io/v1/speech-to-text/realtime` | Auth via `xi-api-key` header |
| Gemini Live API | WebSocket | Google AI SDK (`@google/genai`) | Uses `BidiGenerateContent` stream |
| Google Cloud Speech-to-Text | WebSocket | `wss://speech.googleapis.com/...` | gRPC-web compatible |
| Soniox | WebSocket | `wss://api.soniox.com/transcribe-websocket` | Auth via token in first message |

#### Async Provider (REST, File-based)

| Provider | Protocol | Endpoint | Notes |
|---|---|---|---|
| OpenAI Whisper | REST / fetch | `https://api.openai.com/v1/audio/transcriptions` | Async only — send audio file after selection |

### Backend (if Q1 requires it)
- **Supabase Edge Functions** — proxy API calls, hide keys server-side
- One Edge Function per provider or a single multiplexed function
- CORS handled at function level

---

## Data Models

```typescript
// App State
interface AppState {
  mode: 'realtime' | 'async';  // Hard switch between modes
  currentSession?: TranscriptionSession;
}

// Session (Real-Time)
interface TranscriptionSession {
  id: string;
  mode: 'realtime' | 'async';
  startedAt: Date;
  endedAt?: Date;
  providers: ProviderResult[];
}

// Per-provider result (Real-Time: 4 active; Async: Whisper only)
interface ProviderResult {
  provider: 'elevenlabs' | 'gemini' | 'google' | 'soniox' | 'whisper';
  transcript: TranscriptChunk[];
  latencyMs: number[];  // one per chunk (real-time) or null (async)
  status: 'connecting' | 'live' | 'done' | 'error';
  error?: string;
  processingTimeMs?: number;  // async mode only
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
- **Error handling:** Clear error state in each provider panel if it fails (bad key, quota exceeded, network drop) — never crash the whole app. In async mode, Whisper failure is blocking (show error, offer retry).
- **Accessibility:** Keyboard navigable record button (real-time), ARIA labels on live transcript regions (`aria-live="polite"`), file input accessible in async mode

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

### Real-Time Providers (4-way Arena)
The following providers support real-time audio input via WebSocket:

- **Eleven Labs Scribe v2** — ~150ms latency, 90+ languages, speaker diarization
- **Gemini Live API** — multimodal, VAD built-in, returns text + audio
- **Google Cloud Speech-to-Text** — 125+ languages, most mature API, ~200ms latency
- **Soniox** — enterprise accuracy, custom vocabulary, ~300ms latency

**Audio standard:** PCM 16-bit, 16kHz, mono

### Async Provider
- **OpenAI Whisper** — REST API, batch processing, ~99% accuracy on English, supports 99+ languages

---

## Lovable Prompt (paste after answering open questions above)

Once you've filled in your answers, prepend the following to this file and paste everything into Lovable:

```
Build a React + TypeScript + Tailwind + shadcn/ui app using the spec below.

This is a dual-mode STT benchmarking platform:

1. **Real-Time Arena:** 4-way live transcription in a 2×2 grid from the user's microphone.
   Scaffold WebSocket hooks for Eleven Labs, Gemini, Google Cloud STT, and Soniox.
   Implement the AudioWorklet resampler to broadcast PCM 16-bit 16kHz mono to all 4 simultaneously.
   Show live latency badges and transcript streaming.

2. **Async Batch:** Single file upload to OpenAI Whisper.
   Completely different layout from real-time — minimal, centered, single-column.
   Show processing progress and full transcript result.

Scaffold all screens, both modes, all provider hooks, the AudioWorklet pipeline, and wire up the UI.
Use placeholder API calls where real provider keys are needed.
Follow the data models exactly.

MODE SWITCHING: Hard reset on mode change (disconnect WebSockets, clear state, fresh session).
Modes should look completely different visually.

[PASTE REST OF THIS DOCUMENT]
```
