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
- [ ] Eleven Labs Scribe v2 (WebSocket, ~150ms latency)
- [ ] Gemini Live API (WebSocket, multimodal)
- [ ] Google Cloud Speech-to-Text (gRPC/WebSocket)
- [ ] Soniox (WebSocket)
- [ ] Gladia (WebSocket)
- [ ] OpenAI Whisper (async/batch only)
- [ ] All of the above

### Q3 — Auth / API key management
How should API keys be handled?
- [ ] Users paste their own keys into a settings panel (no backend required)
- [ ] Keys stored server-side via environment variables (backend required)
- [ ] Supabase Vault for key storage per user

### Q4 — User accounts
- [ ] No auth — fully public demo, anyone can access
- [ ] Supabase Auth — users sign up, keys and history saved to their account
- [ ] Single password / magic-link for private team access

### Q5 — Comparison mode
Should users be able to run multiple providers simultaneously on the same audio for side-by-side comparison?
- [ ] Yes — side-by-side panels, same microphone feed split to all selected providers
- [ ] No — one provider at a time, switchable via a dropdown

### Q6 — Async / file upload mode
Beyond real-time microphone streaming, should the app also accept file uploads for batch transcription?
- [ ] Yes — support both mic streaming and audio file upload
- [ ] No — microphone / real-time only

### Q7 — Visual style
- [ ] Dark-mode technical dashboard (think Vercel / Linear)
- [ ] Clean light SaaS (think Notion / Linear light)
- [ ] Minimal hacker terminal aesthetic
- [ ] No preference — Lovable decides

### Q8 — Languages / locales
- [ ] English only for UI and transcription demos
- [ ] Multi-language: UI in English, but transcription demo should support selecting a target language per provider

### Q9 — Metrics & benchmarking
Should the app display live latency, word error rate estimates, or cost-per-minute comparisons?
- [ ] Yes — show latency badge per provider, cost table
- [ ] Latency only (no cost info)
- [ ] No metrics — clean transcription view only

### Q10 — Export / history
- [ ] Save transcription sessions to browser localStorage
- [ ] Save to Supabase (requires auth)
- [ ] No saving — session only

---

## App Overview

**Product name:** STT Demo Platform (working title)

**One-liner:** A browser-based playground to compare the world's best real-time Speech-to-Text APIs — side by side, live from your microphone.

**Target user:** Developers and product teams evaluating STT providers for their products.

**Core value prop:** Instead of reading docs for five different providers, users can speak once and see all transcriptions appear in real time, with latency and quality visible at a glance.

---

## Screens & Features

### 1. Home / Landing
- Hero: single headline, one CTA ("Start Demo")
- Brief provider logo strip (Eleven Labs, Google, Gemini, Soniox, Gladia, OpenAI)
- No login wall by default (see Q4)

### 2. Demo Playground (main screen)
**Layout:** Split into a control panel (left/top) and transcription panels (right/main)

**Control Panel contains:**
- Provider selector — checkboxes or multi-select chips for each STT provider
- Language selector (if Q8 = multi-language)
- Record button (large, prominent) — starts/stops microphone capture
- File upload dropzone (if Q6 = yes)
- Settings gear → opens API key modal (if Q3 = client-side keys)

**Transcription Panels:**
- One panel per selected provider, rendered in a responsive grid (2-col on desktop, stacked on mobile)
- Each panel shows:
  - Provider name + logo
  - Live transcript text (streaming, words appear as spoken)
  - Status indicator: Connecting / Live / Error
  - Latency badge (ms, updated per response chunk) — if Q9 includes latency
  - Copy transcript button
  - Clear button

**Comparison bar (if Q5 = side-by-side):**
- Bottom summary row: which provider produced the most words, lowest latency

### 3. Settings / API Keys Modal
- Text inputs for each provider's API key
- Keys stored in localStorage (encrypted) or Supabase Vault (see Q3)
- "Test connection" button per provider
- Link to each provider's free-tier signup

### 4. History Panel (if Q10 = save sessions)
- List of past sessions with timestamp, provider used, first 100 chars of transcript
- Click to expand full transcript
- Export as `.txt` or `.json`

### 5. Metrics / Benchmarks Page (if Q9 = yes)
- Static comparison table: latency, cost per minute, language count, features
- Data sourced from the research doc (can be hardcoded initially)
- "Live benchmark" button: runs a standard 30-second test audio through all providers and plots results

---

## Technical Architecture

### Frontend
- **Framework:** React + TypeScript (Lovable default)
- **Styling:** Tailwind CSS + shadcn/ui components
- **State:** React Context or Zustand for global provider/session state
- **Audio capture:** Web Audio API + `MediaRecorder` / `AudioWorklet` for PCM capture
- **WebSocket clients:** One hook per provider (`useElevenLabsSTT`, `useGeminiLive`, etc.)

### Audio Pipeline
```
Microphone
  → getUserMedia()
  → AudioWorklet (resample to 16kHz PCM 16-bit mono)
  → Broadcast to all active provider WebSocket connections
```

**Key constraint:** All providers require **PCM 16-bit, 16kHz mono**. The AudioWorklet resampler should handle this normalization once, upstream of all provider connections.

### Provider Integration Details

| Provider | Protocol | Endpoint | Notes |
|---|---|---|---|
| Eleven Labs Scribe v2 | WebSocket | `wss://api.elevenlabs.io/v1/speech-to-text/realtime` | Auth via `xi-api-key` header |
| Gemini Live API | WebSocket | Google AI SDK (`@google/genai`) | Uses `BidiGenerateContent` stream |
| Google Cloud STT | WebSocket / gRPC-web | `wss://speech.googleapis.com/...` | May need backend proxy for gRPC |
| Soniox | WebSocket | `wss://api.soniox.com/transcribe-websocket` | Auth via token in first message |
| Gladia | WebSocket | Gladia SDK | Init via REST, then WebSocket |
| OpenAI Whisper | REST / fetch | `https://api.openai.com/v1/audio/transcriptions` | Async only — send chunks on stop |

### Backend (if Q1 requires it)
- **Supabase Edge Functions** — proxy API calls, hide keys server-side
- One Edge Function per provider or a single multiplexed function
- CORS handled at function level

---

## Data Models

```typescript
// Session
interface TranscriptionSession {
  id: string;
  startedAt: Date;
  endedAt?: Date;
  providers: ProviderResult[];
}

// Per-provider result
interface ProviderResult {
  provider: 'elevenlabs' | 'gemini' | 'google' | 'soniox' | 'gladia' | 'whisper';
  transcript: TranscriptChunk[];
  latencyMs: number[];  // one per chunk
  status: 'connecting' | 'live' | 'done' | 'error';
  error?: string;
}

// Transcript chunk (streaming word/sentence)
interface TranscriptChunk {
  text: string;
  isFinal: boolean;
  timestampMs: number;
}
```

---

## Non-Functional Requirements

- **Browser support:** Chrome 110+, Edge 110+, Firefox 120+ (Web Audio API required)
- **Mobile:** Responsive layout, mic access works on iOS Safari 16.4+
- **No audio stored server-side** — audio bytes only travel from browser to provider APIs directly (client-side mode) or through ephemeral Edge Function (backend mode)
- **Error handling:** Clear error state in each panel if a provider fails (bad key, quota exceeded, network drop) — never crash the whole app
- **Accessibility:** Keyboard navigable record button, ARIA labels on live transcript regions (`aria-live="polite"`)

---

## Nice-to-Haves (Post-v1)

- Speaker diarization visualization (Eleven Labs supports this)
- Word-level highlight synchronized to audio playback
- Shareable session links (public transcript URLs)
- Export to SRT subtitle format
- Custom vocabulary input per provider

---

## Reference Research

The following providers have been validated as supporting real-time audio input via WebSocket:

- **Eleven Labs Scribe v2** — ~150ms latency, 90+ languages, speaker diarization
- **Gemini Live API** — multimodal, VAD built-in, returns text + audio
- **Google Cloud STT** — 125+ languages, most mature API
- **Soniox** — enterprise accuracy, custom vocabulary
- **Gladia** — word-level timestamps, async + real-time

Common audio standard across all providers: **PCM 16-bit, 16kHz, mono**.

---

## Lovable Prompt (paste after answering open questions above)

Once you've filled in your answers, prepend the following to this file and paste everything into Lovable:

```
Build a React + TypeScript + Tailwind + shadcn/ui app using the spec below.
Scaffold all screens, provider WebSocket hooks, the AudioWorklet resampler pipeline,
and wire up the UI. Use placeholder API calls where real provider keys are needed.
Follow the data models exactly. Prioritize the Demo Playground screen first.

[PASTE REST OF THIS DOCUMENT]
```
