import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useAppState } from "@/contexts/AppStateContext";
import { Button } from "@/components/ui/button";
import { PROVIDERS } from "@/lib/providers";
import { SUPPORTED_LANGUAGES } from "@/lib/providers";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Settings, LogOut, Mic, Upload, BarChart3, History } from "lucide-react";
import type { AppMode } from "@/lib/types";

interface ArenaLayoutProps {
  children: React.ReactNode;
}

export function ArenaLayout({ children }: ArenaLayoutProps) {
  const { mode, setMode, language, setLanguage } = useAppState();
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const handleModeSwitch = (newMode: AppMode) => {
    setMode(newMode);
    navigate(newMode === "realtime" ? "/arena" : "/batch");
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top nav */}
      <nav className="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto flex items-center justify-between h-14 px-4">
          <div className="flex items-center gap-4">
            <span
              className="text-lg font-semibold tracking-tight text-foreground cursor-pointer"
              onClick={() => navigate("/")}
            >
              STT Arena
            </span>

            {/* Mode toggle */}
            <div className="flex items-center bg-secondary rounded-lg p-0.5">
              <Button
                size="sm"
                variant={mode === "realtime" ? "default" : "ghost"}
                className="gap-1.5 h-8 text-xs"
                onClick={() => handleModeSwitch("realtime")}
              >
                <Mic className="h-3.5 w-3.5" />
                Real-Time
              </Button>
              <Button
                size="sm"
                variant={mode === "async" ? "default" : "ghost"}
                className="gap-1.5 h-8 text-xs"
                onClick={() => handleModeSwitch("async")}
              >
                <Upload className="h-3.5 w-3.5" />
                Async
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Language selector */}
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger className="w-[130px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUPPORTED_LANGUAGES.map((l) => (
                  <SelectItem key={l.code} value={l.code}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate("/benchmarks")} title="Benchmarks">
              <BarChart3 className="h-4 w-4" />
            </Button>

            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate("/history")} title="History">
              <History className="h-4 w-4" />
            </Button>

            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate("/settings")} title="Settings">
              <Settings className="h-4 w-4" />
            </Button>

            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={signOut} title="Sign out">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </nav>

      {/* Content */}
      <main className="flex-1 container mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
