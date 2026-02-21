import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { ProviderStatus } from "@/lib/types";

interface AsyncResult {
  transcript: string;
  processingTimeMs: number;
  wordCount: number;
  error?: string;
}

interface UseAsyncProviderOptions {
  providerId: string | null;
  language: string;
}

export function useAsyncProvider({ providerId, language }: UseAsyncProviderOptions) {
  const [status, setStatus] = useState<ProviderStatus>("idle");
  const [result, setResult] = useState<AsyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const process = useCallback(
    async (file: File) => {
      if (!providerId) {
        setError("No provider selected");
        return;
      }

      setStatus("uploading");
      setError(null);
      setResult(null);

      try {
        // Read file as base64
        const arrayBuffer = await file.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        const base64 = btoa(String.fromCharCode(...bytes));

        setStatus("processing");

        const { data, error: fnError } = await supabase.functions.invoke("stt-async", {
          body: {
            provider_id: providerId,
            language,
            audio: base64,
            file_name: file.name,
            mime_type: file.type || "audio/wav",
          },
        });

        if (fnError) {
          setError(fnError.message);
          setStatus("error");
          return;
        }

        if (data?.error) {
          setError(data.error);
          setStatus("error");
          return;
        }

        setResult({
          transcript: data.transcript || "",
          processingTimeMs: data.processingTimeMs || 0,
          wordCount: data.wordCount || 0,
        });
        setStatus("done");
      } catch (e: any) {
        setError(e.message);
        setStatus("error");
      }
    },
    [providerId, language]
  );

  const reset = useCallback(() => {
    setStatus("idle");
    setResult(null);
    setError(null);
  }, []);

  return {
    status,
    transcript: result?.transcript || "",
    processingTimeMs: result?.processingTimeMs,
    wordCount: result?.wordCount || 0,
    error,
    process,
    reset,
  };
}
