// Core data models for the STT platform

export type AppMode = "realtime" | "async";

export type ProviderStatus =
  | "idle"
  | "connecting"
  | "live"
  | "uploading"
  | "processing"
  | "done"
  | "error";

export type ApiKeyStatus = "configured" | "invalid" | "not_configured";

export interface TranscriptChunk {
  text: string;
  isFinal: boolean;
  timestampMs: number;
}

export interface ProviderResult {
  panelIndex: number;
  providerId: string;
  transcript: TranscriptChunk[];
  latencyMs: number[];
  processingTimeMs?: number;
  status: ProviderStatus;
  error?: string;
  wordCount: number;
}

export interface TranscriptionSession {
  id: string;
  mode: AppMode;
  startedAt: Date;
  endedAt?: Date;
  language: string;
  providers: ProviderResult[];
}

// Panel grid: 4 panels, each can hold a provider ID or null
export type PanelSelections = (string | null)[];

export const DEFAULT_PANEL_SELECTIONS: PanelSelections = [
  "elevenlabs",
  "gemini",
  "google",
  "soniox",
];
