import { useState, useRef, useCallback, useEffect } from "react";

interface UseAudioCaptureOptions {
  sampleRate?: number;
  onAudioChunk?: (pcm16: ArrayBuffer) => void;
}

export function useAudioCapture({ sampleRate = 16000, onAudioChunk }: UseAudioCaptureOptions = {}) {
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const onChunkRef = useRef(onAudioChunk);

  useEffect(() => {
    onChunkRef.current = onAudioChunk;
  }, [onAudioChunk]);

  const start = useCallback(async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate,
        },
      });
      streamRef.current = stream;

      const ctx = new AudioContext({ sampleRate });
      contextRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      // Use ScriptProcessor for broad compatibility (AudioWorklet would be better but adds complexity)
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        const float32 = e.inputBuffer.getChannelData(0);
        // Convert Float32 to PCM 16-bit
        const pcm16 = new Int16Array(float32.length);
        for (let i = 0; i < float32.length; i++) {
          const s = Math.max(-1, Math.min(1, float32[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        onChunkRef.current?.(pcm16.buffer);
      };

      source.connect(processor);
      processor.connect(ctx.destination);
      setIsRecording(true);
    } catch (e: any) {
      setError(e.message || "Microphone access denied");
    }
  }, [sampleRate]);

  const stop = useCallback(() => {
    processorRef.current?.disconnect();
    processorRef.current = null;
    contextRef.current?.close();
    contextRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setIsRecording(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (isRecording) stop();
    };
  }, []);

  return { isRecording, start, stop, error };
}
