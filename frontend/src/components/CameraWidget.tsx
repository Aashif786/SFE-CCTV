"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  Camera, AlertTriangle, Activity, Upload, UserCheck,
  RefreshCw, CameraOff, Maximize2, Minimize2, Bug, Footprints, BriefcaseBusiness
} from "lucide-react";
import { useCameraWebSocket } from "../hooks/useCameraWebSocket";
import { useCameraState } from "../context/CameraContext";

// ── Activity display helpers ──────────────────────────────────────────────
const ACTIVITY_LABEL: Record<string, string> = {
  working:       "Working",
  walking:       "Walking",
  idle:          "Idle",
  no_person:     "No Person",
  unknown:       "Unknown",
};

const ACTIVITY_COLOUR: Record<string, string> = {
  working:       "#10b981",  // emerald
  walking:       "#3b82f6",  // blue
  idle:          "#f59e0b",  // amber
  no_person:     "#6b7280",  // gray
  unknown:       "#8b5cf6",  // violet
};

const ACTIVITY_DOT: Record<string, string> = {
  working:       "bg-emerald-500 animate-pulse",
  walking:       "bg-blue-500 animate-pulse",
  idle:          "bg-amber-500",
  no_person:     "bg-gray-400",
  unknown:       "bg-violet-500",
};

// ── Per-track detection shape ────────────────────────────────────────────
interface Detection {
  track_id: number;
  activity: string;
  activity_colour: string;
  movement_score: number;
  confidence: number;
  idle_seconds: number;
  worker_position: [number, number] | null;
  keypoints: [number, number][];
  box: [number, number, number, number];
  identity: {
    employee_id: string | null;
    session_id: string | null;
    correlation_delay: number | null;
  };
}

export default function CameraWidget({ cameraId, name }: { cameraId: string; name: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [cameraTrigger, setCameraTrigger] = useState(0);
  const [employeeId, setEmployeeId] = useState("");
  const [entryGate, setEntryGate] = useState("Gate-A");
  const [submittingCheckIn, setSubmittingCheckIn] = useState(false);
  const [checkInStatus, setCheckInStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [mounted, setMounted] = useState(false);

  const { clipUrl, clipName, setClip, showDebug, setShowDebug } = useCameraState();
  const [isUsingClip, setIsUsingClip] = useState(!!clipUrl);

  useEffect(() => {
    setMounted(true);
  }, []);

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

  useEffect(() => {
    if (clipUrl && videoRef.current && !videoRef.current.src.includes(clipUrl)) {
      videoRef.current.src = clipUrl;
      videoRef.current.loop = true;
      videoRef.current.muted = true;
      videoRef.current.play().catch(err => console.error("Video play error:", err));
      setIsUsingClip(true);
    }
  }, [clipUrl]);

  const {
    activity,
    idleSeconds,
    movementScore,
    confidence,
    idleThreshold,
    detections,
    fps,
  } = useCameraWebSocket({
    cameraId,
    cameraTrigger,
    videoRef,
    canvasRef,
    clipUrl,
  });

  const handleClipUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !videoRef.current) return;
    if (videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(t => t.stop());
      videoRef.current.srcObject = null;
    }
    const url = URL.createObjectURL(file);
    videoRef.current.src = url;
    videoRef.current.loop = true;
    videoRef.current.muted = true;
    videoRef.current.play().catch(err => console.error("Video play error:", err));
    setIsUsingClip(true);
    setClip(url, file.name);
  };

  const handleDebugToggle = async () => {
    const nextShowDebug = !showDebug;
    setShowDebug(nextShowDebug);
    if (nextShowDebug && !isUsingClip) {
      try {
        const host = typeof window !== "undefined" ? window.location.hostname : "localhost";
        const res = await fetch(`http://${host}:8000/api/test_clips`);
        if (res.ok) {
          const clips = await res.json();
          if (Array.isArray(clips) && clips.length > 0) {
            const firstClip = clips[0];
            const url = `http://${host}:8000/test_clips/${firstClip}?t=${Date.now()}`;
            if (videoRef.current && videoRef.current.srcObject) {
              const stream = videoRef.current.srcObject as MediaStream;
              stream.getTracks().forEach(t => t.stop());
              videoRef.current.srcObject = null;
            }
            setClip(url, firstClip);
          }
        }
      } catch (err) {
        console.error("Error auto-loading first test clip:", err);
      }
    }
  };

  const handleCheckIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employeeId.trim()) return;
    setSubmittingCheckIn(true);
    setCheckInStatus(null);
    try {
      const host = typeof window !== "undefined" ? window.location.hostname : "localhost";
      const res = await fetch(`http://${host}:8000/api/identity/entry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: employeeId.trim(), entryGate }),
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json();
      setCheckInStatus({ ok: true, msg: `✅ ${data.employee_id} queued` });
      setEmployeeId("");
    } catch (err: any) {
      setCheckInStatus({ ok: false, msg: `❌ ${err.message}` });
    } finally {
      setSubmittingCheckIn(false);
      setTimeout(() => setCheckInStatus(null), 4000);
    }
  };

  const isIdleAlert = activity === "idle" && idleSeconds > idleThreshold;
  const dotClass = ACTIVITY_DOT[activity] ?? "bg-gray-400";
  const label = ACTIVITY_LABEL[activity] ?? activity;

  const tileContent = (
    <div
      draggable={false}
      onDragStart={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onDoubleClick={() => setIsExpanded((v) => !v)}
      title={isExpanded ? "Double click to minimize" : "Double click to expand feed"}
      className={
        isExpanded
          ? "w-full max-w-5xl bg-[hsl(var(--bg-card))] rounded-xl border border-[hsl(var(--border))] shadow-2xl relative my-auto overflow-hidden select-none cursor-default"
          : `relative bg-[hsl(var(--bg-card))] rounded-xl overflow-hidden border transition-all duration-300 cursor-pointer ${
              isIdleAlert
                ? "border-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.3)]"
                : "border-[hsl(var(--border))]"
            } shadow-sm`
      }
    >
      <div className="w-full flex flex-col">
        {/* Header */}
        <div className="p-3 flex justify-between items-center bg-[hsl(var(--bg-table-head))]/60 border-b border-[hsl(var(--border))] rounded-t-xl">
          <div className="flex items-center gap-2">
            <Camera className="w-4 h-4 text-emerald-500" />
            <span className="text-sm font-semibold text-[hsl(var(--text-primary))]">{name}</span>
          </div>
          <div
            className="flex items-center gap-2"
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsExpanded(!isExpanded);
              }}
              onDoubleClick={(e) => e.stopPropagation()}
              className="p-1.5 rounded bg-[hsl(var(--bg-table-head))] hover:bg-[hsl(var(--border))]
                text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] transition-colors"
              title={isExpanded ? "Minimize View" : "Expand View"}
            >
              {isExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleDebugToggle();
              }}
              onDoubleClick={(e) => e.stopPropagation()}
              className={`p-1.5 rounded transition-colors ${
                showDebug
                  ? "bg-amber-500/20 text-amber-600 dark:text-amber-300 hover:bg-amber-500/30"
                  : "bg-[hsl(var(--bg-table-head))] text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))]"
              }`}
              title="Toggle Debug Menu"
            >
              <Bug className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Video + Canvas */}
        <div className="relative bg-black border-b border-[hsl(var(--border))]">
          <video
            ref={videoRef}
            draggable={false}
            className="w-full h-auto block select-none"
            muted
            playsInline
            crossOrigin="anonymous"
          />
          <canvas
            ref={canvasRef}
            draggable={false}
            className="absolute top-0 left-0 w-full h-full pointer-events-none"
          />
        </div>

        {/* Footer */}
        <div className="p-3 bg-[hsl(var(--bg-card))]/90 rounded-b-xl flex flex-col gap-3">
          {/* Status & Activity Indicators */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[hsl(var(--border))]/60 pb-2">
            <div className="flex items-center gap-2">
              <div className={`w-2.5 h-2.5 rounded-full ${dotClass}`} />
              <span className="text-xs font-semibold text-[hsl(var(--text-primary))] bg-[hsl(var(--bg-table-head))] px-2.5 py-1 rounded-md border border-[hsl(var(--border))]">
                {label} {activity === "idle" && `(${Math.floor(idleSeconds)}s)`}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {detections.length > 0 && (
                <span className="text-xs font-bold bg-emerald-500/20 border border-emerald-500/40 text-emerald-700 dark:text-emerald-300 px-2 py-1 rounded-md">
                  👥 {detections.length} Detected
                </span>
              )}
            </div>
          </div>

          {/* Metric Details */}
          <div className="flex items-center justify-between text-[11px] text-[hsl(var(--text-muted))]">
            <div>FPS: <span className="text-[hsl(var(--text-secondary))] font-medium">{fps > 0 ? fps.toFixed(1) : "—"}</span></div>
            <div>mvmt: <span className="text-[hsl(var(--text-secondary))] font-medium">{movementScore.toFixed(4)}</span></div>
            <div>conf: <span className="text-[hsl(var(--text-secondary))] font-medium">{(confidence * 100).toFixed(0)}%</span></div>
            <div className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
              <Activity className="w-3 h-3 animate-pulse" />
              <span>Active Tracking</span>
            </div>
          </div>

          {/* Active Employee Badges */}
          {detections.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {detections.map((det) => (
                <span
                  key={det.track_id}
                  className="text-xs font-bold px-2 py-1 rounded-md border"
                  style={{
                    color: det.activity_colour,
                    borderColor: det.activity_colour + "40",
                    background: det.activity_colour + "15",
                  }}
                >
                  {det.identity.employee_id
                    ? `👤 ${det.identity.employee_id}`
                    : `❓ Track-${det.track_id}`}
                </span>
              ))}
            </div>
          )}

          {/* Idle Alert Bar */}
          {isIdleAlert && (
            <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 bg-amber-500/10 px-3 py-2 rounded-lg border border-amber-500/20 w-full animate-pulse">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              <span className="text-xs font-bold">Idle Alert: Track idle for {Math.floor(idleSeconds)}s</span>
            </div>
          )}
        </div>

        {/* Debug Menu */}
        {showDebug && (
          <div
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            className="border-t border-[hsl(var(--border))] bg-[hsl(var(--bg-code))] p-4 space-y-4 text-[hsl(var(--text-secondary))] relative z-20 rounded-b-xl"
          >
            <div className="flex items-center justify-between border-b border-[hsl(var(--border))] pb-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-amber-600 dark:text-amber-500 flex items-center gap-1.5">
                <Bug className="w-3.5 h-3.5" /> Debug Menu
              </h4>
              {isUsingClip && (
                <span className="text-[10px] bg-amber-500/10 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded border border-amber-500/20 truncate max-w-[150px]">
                  Clip: {clipName}
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4">
              {/* Clip Upload */}
              <div className="space-y-2">
                <h5 className="text-xs font-semibold text-[hsl(var(--text-secondary))] flex items-center gap-1">
                  <Upload className="w-3 h-3" /> Test Video Clip
                </h5>
                <div className="flex flex-col gap-2">
                  {!isUsingClip ? (
                    <label className="flex flex-col items-center justify-center h-20 border border-dashed border-[hsl(var(--border-strong))] hover:border-emerald-500/50 rounded-lg cursor-pointer hover:bg-emerald-500/5 transition-all">
                      <div className="flex flex-col items-center justify-center pt-3 pb-3">
                        <Upload className="w-6 h-6 text-[hsl(var(--text-muted))] mb-1" />
                        <p className="text-[11px] text-[hsl(var(--text-muted))]">Upload MP4 clip</p>
                      </div>
                      <input type="file" accept="video/*" className="hidden" onChange={handleClipUpload} />
                    </label>
                  ) : (
                    <button
                      onClick={() => {
                        if (videoRef.current) {
                          videoRef.current.src = "";
                          setIsUsingClip(false);
                          setClip(null, "");
                          setCameraTrigger(prev => prev + 1);
                        }
                      }}
                      className="flex items-center justify-center gap-1.5 py-2 px-3
                        bg-red-500/10 hover:bg-red-500/20
                        text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300
                        border border-red-500/20 rounded-lg text-xs font-medium transition-all"
                    >
                      <CameraOff className="w-3.5 h-3.5" />
                      Reset to Webcam
                    </button>
                  )}
                </div>
              </div>

              {/* Worker Check-In */}
              <div className="space-y-2">
                <h5 className="text-xs font-semibold text-[hsl(var(--text-secondary))] flex items-center gap-1">
                  <UserCheck className="w-3 h-3" /> Worker Check-In
                </h5>
                <form onSubmit={handleCheckIn} className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="EMP ID (e.g. EMP001)"
                      value={employeeId}
                      onChange={e => setEmployeeId(e.target.value)}
                      required
                      className="flex-1 bg-[hsl(var(--bg-input))] border border-[hsl(var(--border-strong))]
                        rounded px-2.5 py-1.5 text-xs text-[hsl(var(--text-primary))]
                        placeholder:text-[hsl(var(--text-placeholder))]
                        focus:outline-none focus:border-amber-500"
                    />
                    <select
                      value={entryGate}
                      onChange={e => setEntryGate(e.target.value)}
                      className="bg-[hsl(var(--bg-input))] border border-[hsl(var(--border-strong))]
                        rounded px-2 py-1.5 text-xs text-[hsl(var(--text-primary))]
                        focus:outline-none focus:border-amber-500"
                    >
                      {["Gate-A", "Gate-B", "Gate-C", "Gate-D"].map(g => (
                        <option key={g} value={g}>{g}</option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="submit"
                    disabled={submittingCheckIn || !employeeId.trim()}
                    className="w-full flex items-center justify-center gap-1 py-1.5
                      bg-amber-600 hover:bg-amber-500
                      disabled:opacity-50 disabled:cursor-not-allowed
                      text-white font-medium text-xs rounded transition-all"
                  >
                    {submittingCheckIn ? <RefreshCw className="w-3 h-3 animate-spin" /> : <UserCheck className="w-3 h-3" />}
                    Register &amp; Match
                  </button>
                </form>
                {checkInStatus && (
                  <div className={`p-1.5 rounded text-[10px] border text-center ${
                    checkInStatus.ok
                      ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-400"
                      : "bg-red-500/10 border-red-500/20 text-red-600 dark:text-red-400"
                  }`}>
                    {checkInStatus.msg}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
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
        className="fixed inset-0 z-[9999] bg-black/80 dark:bg-gray-950/95 flex flex-col justify-center items-center p-4 backdrop-blur-md overflow-y-auto select-none"
        onClick={() => setIsExpanded(false)}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-5xl"
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
