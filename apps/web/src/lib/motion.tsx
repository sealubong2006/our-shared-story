import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { MotionConfig } from "motion/react";

const STORAGE_KEY = "family-album:animations";

interface MotionSettings {
  animationsOn: boolean;
  setAnimationsOn: (on: boolean) => void;
}

const MotionSettingsContext = createContext<MotionSettings | null>(null);

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

/**
 * Global animation setting. "Off" disables non-essential motion everywhere; the OS
 * reduced-motion preference is always respected as well (MotionConfig reducedMotion="user").
 */
export function MotionSettingsProvider({ children }: { children: ReactNode }) {
  const [animationsOn, setAnimationsOnState] = useState(readStored);

  useEffect(() => {
    document.documentElement.dataset.animations = animationsOn ? "on" : "off";
  }, [animationsOn]);

  const setAnimationsOn = (on: boolean) => {
    setAnimationsOnState(on);
    try {
      localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
    } catch {
      // Storage unavailable (private mode): the setting still applies for this visit.
    }
  };

  return (
    <MotionSettingsContext.Provider value={{ animationsOn, setAnimationsOn }}>
      <MotionConfig reducedMotion={animationsOn ? "user" : "always"}>{children}</MotionConfig>
    </MotionSettingsContext.Provider>
  );
}

export function useMotionSettings(): MotionSettings {
  const ctx = useContext(MotionSettingsContext);
  if (!ctx) throw new Error("useMotionSettings must be used inside MotionSettingsProvider");
  return ctx;
}
