import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import type { AppMode, PanelSelections } from "@/lib/types";
import { DEFAULT_PANEL_SELECTIONS } from "@/lib/types";

interface AppStateContextType {
  mode: AppMode;
  setMode: (mode: AppMode) => void;
  panelSelections: PanelSelections;
  setPanelProvider: (index: number, providerId: string | null) => void;
  language: string;
  setLanguage: (lang: string) => void;
  resetSession: () => void;
}

const AppStateContext = createContext<AppStateContextType | undefined>(undefined);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [mode, setModeRaw] = useState<AppMode>("realtime");
  const [panelSelections, setPanelSelections] = useState<PanelSelections>([
    ...DEFAULT_PANEL_SELECTIONS,
  ]);
  const [language, setLanguage] = useState("en");

  const resetSession = useCallback(() => {
    setPanelSelections([...DEFAULT_PANEL_SELECTIONS]);
  }, []);

  const setMode = useCallback(
    (newMode: AppMode) => {
      if (newMode !== mode) {
        resetSession();
        setModeRaw(newMode);
      }
    },
    [mode, resetSession]
  );

  const setPanelProvider = useCallback(
    (index: number, providerId: string | null) => {
      setPanelSelections((prev) => {
        const next = [...prev];
        next[index] = providerId;
        return next;
      });
    },
    []
  );

  return (
    <AppStateContext.Provider
      value={{
        mode,
        setMode,
        panelSelections,
        setPanelProvider,
        language,
        setLanguage,
        resetSession,
      }}
    >
      {children}
    </AppStateContext.Provider>
  );
}

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState must be used within AppStateProvider");
  return ctx;
}
