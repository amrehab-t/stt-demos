# Audio Providers Research - STT Demo Platform

**Last Updated**: February 21, 2026

## Overview
Comprehensive research on Speech-to-Text (STT) and audio processing providers with audio input capabilities. This document validates which providers support real-time audio streaming and async processing.

---

## Real-Time Audio Providers (Streaming)

### 1. **Eleven Labs Scribe v2** ✅
**Type**: Real-Time Speech-to-Text
- **Status**: Recently released with real-time capabilities
- **WebSocket Endpoint**: `wss://api.elevenlabs.io/v1/speech-to-text/realtime`
- **Latency**: ~150ms
- **Audio Format**: PCM 16-bit, 16kHz mono
- **Supported Languages**: 90+
- **Key Features**:
  - Real-time streaming via WebSocket
  - Speaker diarization
  - Word-level timestamps
  - Async mode also available
- **Use Case**: Real-time transcription with speaker identification
- **Documentation**: [Scribe v2 Documentation](https://elevenlabs.io/docs/overview/capabilities/speech-to-text)

### 2. **Gemini Live API** ✅
**Type**: Real-Time Multimodal Audio Processing
- **Status**: Production-ready
- **Purpose**: Not just an LLM - true real-time voice interaction
- **Audio Format**: 16-bit PCM, 16kHz mono (also supports 24kHz)
- **Models**: Gemini 2.5 Flash with Live API support
- **Key Features**:
  - Low-latency continuous audio streaming
  - Voice Activity Detection (VAD) with configurable settings
  - Automatic speaker detection
  - Returns text and audio responses
  - WebSocket-based streaming
- **Use Case**: Real-time voice conversations, audio understanding
- **Documentation**:
  - [Live API Guide](https://ai.google.dev/gemini-api/docs/live-guide)
  - [Native Audio Implementation](https://cloud.google.com/blog/topics/developers-practitioners/how-to-use-gemini-live-api-native-audio-in-vertex-ai)

### 3. **Google Cloud Speech-to-Text** ✅
**Type**: Real-Time & Async STT
- **Streaming Support**: Yes (gRPC bidirectional streaming)
- **Audio Format**: PCM 16-bit, various sample rates (8kHz, 16kHz, 48kHz)
- **Key Features**:
  - Real-time streaming recognition
  - Async batch processing
  - 125+ languages
  - Speaker identification
  - Punctuation auto-add

### 4. **Soniox** ✅
**Type**: Real-Time STT Platform
- **Streaming Support**: Yes (WebSocket)
- **Key Features**:
  - Low-latency real-time transcription
  - Custom vocabulary/terminology
  - Async mode available
  - Enterprise-grade accuracy

### 5. **Gladia** ✅
**Type**: Real-Time & Async STT
- **Streaming Support**: Yes
- **Key Features**:
  - Real-time transcription
  - Async batch processing
  - Multiple language support
  - Word-level timestamps

### 6. **OpenAI Realtime API** (Optional)
**Type**: Real-Time Voice Interaction
- **Status**: Available for compatible models
- **Use Case**: Voice conversations with GPT models

---

## Async-Only Providers (Batch/Upload)

### 1. **OpenAI Whisper API**
- **Type**: Async STT
- **Features**: Batch processing, multiple languages
- **Typical Use**: Post-call transcription, media processing

### 2. **Google Cloud Speech-to-Text (Batch Mode)**
- **Async Support**: Yes, via REST API
- **Use Case**: Bulk processing of audio files

---

## Complete Provider Matrix

| Provider | Real-Time | Async | Audio Input | WebSocket | Languages |
|----------|-----------|-------|-------------|-----------|-----------|
| Eleven Labs Scribe v2 | ✅ | ✅ | ✅ | ✅ | 90+ |
| Gemini Live API | ✅ | ✅ | ✅ | ✅ | 100+ |
| Google Cloud STT | ✅ | ✅ | ✅ | ✅ | 125+ |
| Soniox | ✅ | ✅ | ✅ | ✅ | Multiple |
| Gladia | ✅ | ✅ | ✅ | ✅ | Multiple |
| OpenAI Whisper | ❌ | ✅ | ✅ | ❌ | 99 |
| OpenAI Realtime | ✅ | ❌ | ✅ | ✅ | English focus |

---

## Key Findings for Demo Platform

### 1. **Both Eleven Labs Scribe v2 and Gemini Live accept audio input** ✅
   - Originally questioned, now validated through official documentation
   - Both are legitimate options for real-time audio processing

### 2. **Architecture Opportunities**
   - **Real-time demonstration**: Compare multiple streaming providers (Eleven Labs, Google, Soniox, Gladia, Gemini Live)
   - **Async demonstration**: Compare batch processors (Whisper, Google Batch, Eleven Labs async)
   - **LLM-powered**: Gemini Live for audio understanding beyond transcription

### 3. **Common Audio Format Standard**
   - PCM 16-bit, 16kHz mono is the most common format
   - Most providers support adaptive sample rates
   - WebSocket is the preferred streaming protocol

### 4. **Latency Expectations**
   - Real-time: 100-200ms typical
   - Eleven Labs Scribe v2: ~150ms
   - Gemini Live: Low-latency (exact metrics variable)

---

## Research Sources

- [Eleven Labs Scribe v2 Docs](https://elevenlabs.io/docs/overview/capabilities/speech-to-text)
- [Gemini Live API Guide](https://ai.google.dev/gemini-api/docs/live-guide)
- [Gemini Live Native Audio](https://cloud.google.com/blog/topics/developers-practitioners/how-to-use-gemini-live-api-native-audio-in-vertex-ai)
- [Google Cloud Speech-to-Text](https://cloud.google.com/speech-to-text)
- [Soniox Platform](https://soniox.com)
- [Gladia API](https://gladia.io)
- [OpenAI Whisper API](https://platform.openai.com/docs/guides/speech-to-text)

---

## Next Steps for Implementation

1. ✅ Validate audio provider capabilities (DONE)
2. Set up demo endpoints for each provider
3. Implement WebSocket clients for real-time providers
4. Create comparison benchmarks (latency, accuracy, cost)
5. Build UI to switch between providers
