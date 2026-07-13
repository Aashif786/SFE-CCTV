"use client";
import { createContext, useContext, useState, ReactNode } from "react";

interface CameraState {
  clipUrl: string | null;
  clipName: string;
  setClip: (url: string | null, name: string) => void;
  showDebug: boolean;
  setShowDebug: (show: boolean) => void;
}

const CameraContext = createContext<CameraState>({
  clipUrl: null,
  clipName: "",
  setClip: () => {},
  showDebug: false,
  setShowDebug: () => {},
});

export const CameraProvider = ({ children }: { children: ReactNode }) => {
  const [clipUrl, setClipUrl] = useState<string | null>(null);
  const [clipName, setClipName] = useState<string>("");
  const [showDebug, setShowDebug] = useState<boolean>(false);

  const setClip = (url: string | null, name: string) => {
    setClipUrl(url);
    setClipName(name);
  };

  return (
    <CameraContext.Provider value={{ clipUrl, clipName, setClip, showDebug, setShowDebug }}>
      {children}
    </CameraContext.Provider>
  );
};

export const useCameraState = () => useContext(CameraContext);
