"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  Maximize2,
  Minimize2,
  Camera,
  CameraOff,
  RefreshCw,
  Download,
  Info,
  Settings,
  MapPin,
  DoorOpen,
  X,
  Wifi,
  WifiOff,
  Loader2,
} from "lucide-react";
import type { LiveCamera } from "@/hooks/useCameras";
import { useCameraActions } from "@/hooks/useCameras";

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<string, { dot: string; label: string; color: string }> = {
  ONLINE:       { dot: "bg-emerald-500 animate-pulse", label: "Online",       color: "text-emerald-500" },
  OFFLINE:      { dot: "bg-red-500",                   label: "Offline",      color: "text-red-500" },
  STARTING:     { dot: "bg-blue-500 animate-pulse",    label: "Starting",     color: "text-blue-500" },
  RECONNECTING: { dot: "bg-amber-500 animate-pulse",   label: "Reconnecting", color: "text-amber-500" },
  ERROR:        { dot: "bg-red-500",                   label: "Error",        color: "text-red-500" },
  AUTH_FAILED:  { dot: "bg-red-500",                   label: "Auth Failed",  color: "text-red-500" },
  STOPPED:      { dot: "bg-gray-400",                  label: "Stopped",      color: "text-gray-400" },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface CameraTileProps {
  camera: LiveCamera;
  onRefresh?: () => void;
  onOpenSettings?: (camera: LiveCamera) => void;
  onExpandChange?: (isExpanded: boolean) => void;
}

export default function CameraTile({ camera, onRefresh, onOpenSettings, onExpandChange }: CameraTileProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [streamKey, setStreamKey] = useState(() => Date.now());
  const [mounted, setMounted] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const { restartStream, getStreamUrl, getSnapshotUrl } = useCameraActions();

  useEffect(() => {
    setMounted(true);
  }, []);

  const isOnline = camera.status === "ONLINE";
  const statusCfg = STATUS_CONFIG[camera.status] || STATUS_CONFIG.STOPPED;
  const streamUrl = getStreamUrl(camera.id);

  // Sync expanded state changes to parent callback
  useEffect(() => {
    onExpandChange?.(isExpanded);
  }, [isExpanded, onExpandChange]);

  // Close on Escape key when expanded
  useEffect(() => {
    if (!isExpanded) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsExpanded(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isExpanded]);

  // ── Manage MJPEG stream src & clean up HTTP connections on unmount ───
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;

    if (isOnline) {
      setImgError(false);
      // Force fresh timestamp on mount & expand so browser opens a clean new MJPEG connection
      img.src = `${streamUrl}?t=${Date.now()}`;
    } else {
      img.src = "";
      img.removeAttribute("src");
    }

    return () => {
      // CRITICAL: Close persistent HTTP/1.1 MJPEG stream to avoid browser connection limit exhaustion
      if (img) {
        img.src = "";
        img.removeAttribute("src");
      }
    };
  }, [streamUrl, streamKey, isOnline, isExpanded]);

  // ── Handlers ──────────────────────────────────────────────────────────

  const handleRestart = useCallback(async () => {
    setRestarting(true);
    setImgError(false);
    setStreamKey(Date.now());
    try {
      await restartStream(camera.id);
      onRefresh?.();
    } catch (e) {
      console.error("Restart failed:", e);
    } finally {
      setTimeout(() => setRestarting(false), 1500);
    }
  }, [camera.id, restartStream, onRefresh]);

  const handleSnapshot = useCallback(() => {
    const url = getSnapshotUrl(camera.id);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${camera.name.replace(/\s+/g, "_")}_snapshot.jpg`;
    link.target = "_blank";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [camera.id, camera.name, getSnapshotUrl]);

  const handleFullscreen = useCallback(() => {
    setStreamKey(Date.now());
    setIsExpanded((v) => !v);
  }, []);

  // ── Render ────────────────────────────────────────────────────────────

  const tileContent = (
    <div
      draggable={false}
      onDragStart={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onDoubleClick={handleFullscreen}
      title={isExpanded ? "Double click to minimize" : "Double click to expand feed"}
      className={
        isExpanded
          ? "w-full max-w-6xl bg-[hsl(var(--bg-card))] rounded-xl border border-[hsl(var(--border))] shadow-2xl relative my-auto overflow-hidden select-none cursor-default"
          : `relative bg-[hsl(var(--bg-card))] rounded-xl overflow-hidden border transition-shadow transition-colors duration-200 cursor-pointer
             ${camera.status === "OFFLINE" || camera.status === "ERROR" || camera.status === "AUTH_FAILED"
               ? "border-red-500/30"
               : "border-[hsl(var(--border))]"
             } shadow-sm hover:shadow-md hover:border-[hsl(var(--border-strong))] group`
      }
    >
      {/* ── Header ───────────────────────────────────────────────── */}
      <div className="px-3 py-2.5 flex justify-between items-center bg-[hsl(var(--bg-table-head))]/60 border-b border-[hsl(var(--border))]">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`w-2 h-2 rounded-full shrink-0 ${statusCfg.dot}`} />
          <span className="text-sm font-semibold text-[hsl(var(--text-primary))] truncate">
            {camera.name}
          </span>
        </div>
        <div
          className="flex items-center gap-1 shrink-0"
          onDoubleClick={(e) => e.stopPropagation()}
        >
          {/* FPS badge */}
          {isOnline && camera.fps > 0 && (
            <span className="text-[10px] font-mono font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">
              {camera.fps.toFixed(0)} fps
            </span>
          )}
          {/* Action buttons */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowInfo(!showInfo);
            }}
            onDoubleClick={(e) => e.stopPropagation()}
            className="p-1 rounded text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-table-head))] transition-colors"
            title="Camera Info"
          >
            <Info className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleSnapshot();
            }}
            onDoubleClick={(e) => e.stopPropagation()}
            disabled={!isOnline}
            className="p-1 rounded text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-table-head))] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Snapshot"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleRestart();
            }}
            onDoubleClick={(e) => e.stopPropagation()}
            disabled={restarting}
            className="p-1 rounded text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-table-head))] transition-colors disabled:opacity-50"
            title="Reconnect Stream"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${restarting ? "animate-spin" : ""}`} />
          </button>
          {onOpenSettings && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onOpenSettings(camera);
              }}
              onDoubleClick={(e) => e.stopPropagation()}
              className="p-1 rounded text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-table-head))] transition-colors"
              title="Camera Settings"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleFullscreen();
            }}
            onDoubleClick={(e) => e.stopPropagation()}
            className="p-1 rounded text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-table-head))] transition-colors"
            title={isExpanded ? "Exit Fullscreen" : "Fullscreen"}
          >
            {isExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* ── Video Area ───────────────────────────────────────────── */}
      <div className="relative bg-black aspect-video">
        {isOnline && !imgError ? (
          /* MJPEG stream via <img> */
          <img
            ref={imgRef}
            alt={camera.name}
            draggable={false}
            className="w-full h-full object-cover block select-none pointer-events-auto"
            onError={() => setImgError(true)}
          />
        ) : (
          /* Offline / Error / Connecting overlay */
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-gray-900 to-gray-950">
            <div className="w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center">
              <CameraOff className="w-7 h-7 text-red-500/70" />
            </div>
            <span className={`text-sm font-medium ${statusCfg.color}`}>
              {camera.status === "STARTING"
                ? "Starting stream…"
                : camera.status === "RECONNECTING"
                ? "Reconnecting…"
                : statusCfg.label}
            </span>
            {camera.error_message && (
              <span className="text-[11px] text-gray-500 max-w-[200px] text-center leading-tight">
                {camera.error_message.length > 80
                  ? camera.error_message.slice(0, 80) + "…"
                  : camera.error_message}
              </span>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleRestart();
              }}
              onDoubleClick={(e) => e.stopPropagation()}
              disabled={restarting}
              className="mt-1 flex items-center gap-1.5 text-xs font-medium text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 px-3 py-1.5 rounded-lg transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${restarting ? "animate-spin" : ""}`} />
              Reconnect
            </button>
          </div>
        )}

        {/* Live indicator badge */}
        {isOnline && !imgError && (
          <div className="absolute top-2 left-2 flex items-center gap-1.5 bg-black/60 backdrop-blur-sm px-2 py-1 rounded-md z-10 pointer-events-none select-none">
            <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            <span className="text-[10px] font-bold text-white tracking-wider">LIVE</span>
          </div>
        )}
      </div>

      {/* ── Footer ───────────────────────────────────────────────── */}
      <div className="px-3 py-2 bg-[hsl(var(--bg-card))]/90 border-t border-[hsl(var(--border))]/60">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 text-[11px] text-[hsl(var(--text-muted))] min-w-0">
            {camera.location && (
              <span className="flex items-center gap-1 truncate">
                <MapPin className="w-3 h-3 shrink-0" />
                {camera.location}
              </span>
            )}
            {camera.door_name && (
              <span className="flex items-center gap-1 truncate">
                <DoorOpen className="w-3 h-3 shrink-0" />
                {camera.door_name}
              </span>
            )}
            {camera.zone && !camera.door_name && (
              <span className="truncate">{camera.zone}</span>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {isOnline ? (
              <Wifi className="w-3 h-3 text-emerald-500" />
            ) : (
              <WifiOff className="w-3 h-3 text-red-400" />
            )}
            <span className={`text-[10px] font-semibold ${statusCfg.color}`}>
              {statusCfg.label}
            </span>
          </div>
        </div>

        {/* Last updated */}
        {camera.last_frame_time && (
          <div className="text-[10px] text-[hsl(var(--text-muted))] mt-1">
            Last frame: {new Date(camera.last_frame_time).toLocaleTimeString()}
          </div>
        )}
      </div>

      {/* ── Info panel ───────────────────────────────────────────── */}
      {showInfo && (
        <div
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          className="border-t border-[hsl(var(--border))] bg-[hsl(var(--bg-code))] px-3 py-3 space-y-2 animate-in slide-in-from-top-1"
        >
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold uppercase tracking-wider text-[hsl(var(--text-secondary))]">
              Camera Information
            </h4>
            <button onClick={() => setShowInfo(false)} className="text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
            <InfoRow label="Camera ID" value={`#${camera.id}`} />
            <InfoRow label="Brand" value={camera.camera_brand || "—"} />
            <InfoRow label="Stream" value={camera.stream_type} />
            <InfoRow label="Building" value={camera.building || "—"} />
            <InfoRow label="Floor" value={camera.floor || "—"} />
            <InfoRow label="Zone" value={camera.zone || "—"} />
            <InfoRow label="Door" value={camera.door_name || "—"} />
            <InfoRow label="Reconnects" value={String(camera.reconnect_count)} />
          </div>
          {camera.description && (
            <p className="text-[11px] text-[hsl(var(--text-muted))] border-t border-[hsl(var(--border))] pt-2 mt-2">
              {camera.description}
            </p>
          )}
        </div>
      )}
    </div>
  );

  // Fullscreen wrapper
  if (isExpanded) {
    const fullscreenModal = (
      <div
        draggable={false}
        onDragStart={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        className="fixed inset-0 z-[9999] bg-black/85 dark:bg-gray-950/95 flex items-center justify-center p-6 backdrop-blur-md select-none"
        onClick={handleFullscreen}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-6xl"
        >
          {tileContent}
        </div>
      </div>
    );

    if (mounted && typeof document !== "undefined") {
      return createPortal(fullscreenModal, document.body);
    }
    return fullscreenModal;
  }

  return tileContent;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span className="text-[hsl(var(--text-muted))]">{label}</span>
      <span className="text-[hsl(var(--text-secondary))] font-medium">{value}</span>
    </>
  );
}
