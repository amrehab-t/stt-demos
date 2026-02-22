import { Mic, Square } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AudioRecorderProps {
  isRecording: boolean;
  onStart: () => void;
  onStop: () => void;
  error?: string | null;
}

export function AudioRecorder({ isRecording, onStart, onStop, error }: AudioRecorderProps) {
  return (
    <div className="flex items-center gap-3">
      {isRecording ? (
        <Button
          onClick={onStop}
          variant="destructive"
          size="lg"
          className="gap-2"
        >
          <Square className="h-4 w-4 fill-current" />
          Stop Recording
        </Button>
      ) : (
        <Button
          onClick={onStart}
          size="lg"
          className="gap-2"
        >
          <Mic className="h-4 w-4" />
          Start Recording
        </Button>
      )}
      {isRecording && (
        <div className="flex items-center gap-2 text-sm text-live">
          <span className="h-2 w-2 rounded-full bg-live animate-pulse" />
          Recording…
        </div>
      )}
      {error && <span className="text-sm text-destructive">{error}</span>}
    </div>
  );
}
