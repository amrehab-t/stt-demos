// ============================
// Provider Registry — the single source of truth
// All UI components read from this registry.
// To add a new provider, add a config object here. No UI changes required.
// ============================

export interface ProviderConfig {
  id: string;
  name: string;
  shortName: string;
  logo: string; // URL or emoji placeholder
  description: string;
  realtimeEndpoint: string;
  realtimeAuth: { type: string; headerName?: string };
  asyncEndpoint: string;
  asyncAuth: { type: string; headerName?: string };
  supportedLanguages: { code: string; name: string }[];
  signupUrl: string;
  costPerMinute?: string;
  latencyRange?: string;
  features?: string[];
}

export const SUPPORTED_LANGUAGES = [
  { code: "en", name: "English" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "pt", name: "Portuguese" },
  { code: "ja", name: "Japanese" },
  { code: "zh", name: "Chinese" },
  { code: "ko", name: "Korean" },
  { code: "ar", name: "Arabic" },
  { code: "hi", name: "Hindi" },
  { code: "it", name: "Italian" },
  { code: "nl", name: "Dutch" },
  { code: "ru", name: "Russian" },
] as const;

export const PROVIDERS: ProviderConfig[] = [
  {
    id: "elevenlabs",
    name: "Eleven Labs",
    shortName: "ElevenLabs",
    logo: "🔊",
    description: "Ultra-low latency streaming with speaker diarization",
    realtimeEndpoint: "wss://api.elevenlabs.io/v1/speech-to-text/realtime",
    realtimeAuth: { type: "header", headerName: "xi-api-key" },
    asyncEndpoint: "https://api.elevenlabs.io/v1/speech-to-text",
    asyncAuth: { type: "header", headerName: "xi-api-key" },
    supportedLanguages: SUPPORTED_LANGUAGES.map((l) => ({ ...l })),
    signupUrl: "https://elevenlabs.io/sign-up",
    costPerMinute: "$0.40",
    latencyRange: "~150ms",
    features: ["Speaker diarization", "90+ languages", "Audio event tagging"],
  },
  {
    id: "gemini",
    name: "Gemini Live",
    shortName: "Gemini",
    logo: "✨",
    description: "Multimodal streaming with intelligent VAD",
    realtimeEndpoint: "wss://generativelanguage.googleapis.com/ws",
    realtimeAuth: { type: "query-param" },
    asyncEndpoint: "https://generativelanguage.googleapis.com/v1beta",
    asyncAuth: { type: "query-param" },
    supportedLanguages: SUPPORTED_LANGUAGES.map((l) => ({ ...l })),
    signupUrl: "https://aistudio.google.com/apikey",
    costPerMinute: "$0.30",
    latencyRange: "~200ms",
    features: ["Multimodal", "Built-in VAD", "Intelligent chunking"],
  },
  {
    id: "google",
    name: "Google Cloud STT",
    shortName: "Google",
    logo: "🌐",
    description: "Enterprise-grade with 125+ languages",
    realtimeEndpoint: "wss://speech.googleapis.com/v1/speech:streamingRecognize",
    realtimeAuth: { type: "bearer" },
    asyncEndpoint: "https://speech.googleapis.com/v1/speech:recognize",
    asyncAuth: { type: "bearer" },
    supportedLanguages: SUPPORTED_LANGUAGES.map((l) => ({ ...l })),
    signupUrl: "https://console.cloud.google.com/speech",
    costPerMinute: "$0.36",
    latencyRange: "~250ms",
    features: ["125+ languages", "Enterprise SLA", "Custom vocabulary"],
  },
  {
    id: "soniox",
    name: "Soniox",
    shortName: "Soniox",
    logo: "🎯",
    description: "High accuracy with custom vocabulary support",
    realtimeEndpoint: "wss://api.soniox.com/transcribe-websocket",
    realtimeAuth: { type: "message" },
    asyncEndpoint: "https://api.soniox.com/transcribe",
    asyncAuth: { type: "header", headerName: "Authorization" },
    supportedLanguages: SUPPORTED_LANGUAGES.map((l) => ({ ...l })),
    signupUrl: "https://soniox.com/signup",
    costPerMinute: "$0.35",
    latencyRange: "~300ms",
    features: ["Custom vocabulary", "Enterprise accuracy", "Low-resource languages"],
  },
  {
    id: "whisper",
    name: "OpenAI Whisper",
    shortName: "Whisper",
    logo: "🤖",
    description: "Highest accuracy, 99+ languages, cost-effective",
    realtimeEndpoint: "https://api.openai.com/v1/audio/transcriptions",
    realtimeAuth: { type: "bearer" },
    asyncEndpoint: "https://api.openai.com/v1/audio/transcriptions",
    asyncAuth: { type: "bearer" },
    supportedLanguages: SUPPORTED_LANGUAGES.map((l) => ({ ...l })),
    signupUrl: "https://platform.openai.com/signup",
    costPerMinute: "$0.10",
    latencyRange: "~500ms",
    features: ["99% accuracy", "99+ languages", "Most cost-effective"],
  },
];

export function getProvider(id: string): ProviderConfig | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

export function getProviderName(id: string): string {
  return getProvider(id)?.name ?? "Unknown";
}
