"use client";
import { useEffect, useRef, useState } from "react";
import { Camera, AlertTriangle, Activity, Footprints, BriefcaseBusiness, Bug, Upload, UserCheck, RefreshCw, CameraOff, Maximize2, Minimize2 } from "lucide-react";
import { useCameraWebSocket } from "../hooks/useCameraWebSocket";

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
  no_person:     "bg-gray-500",
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
  box: [number, number, number, number]; // normalized 0.0–1.0 [x1, y1, x2, y2]
  identity: {
    employee_id: string | null;
    session_id: string | null;
    correlation_delay: number | null;
  };
}

export default function CameraWidget({ cameraId, name }: { cameraId: string; name: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Debug & Check-In States
  const [cameraTrigger, setCameraTrigger] = useState(0);
  const [showDebug, setShowDebug] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [entryGate, setEntryGate] = useState("Gate-A");
  const [submittingCheckIn, setSubmittingCheckIn] = useState(false);
  const [checkInStatus, setCheckInStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [isUsingClip, setIsUsingClip] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

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
  });
  const [clipName, setClipName] = useState<string>("");

  const handleClipUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !videoRef.current) return;
    
    // Stop webcam tracks if active
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
    setClipName(file.name);
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
  const dotClass = ACTIVITY_DOT[activity] ?? "bg-gray-500";
  const label = ACTIVITY_LABEL[activity] ?? activity;

  return (
    <div className={isExpanded 
      ? "fixed inset-0 z-50 bg-gray-950/95 flex flex-col justify-center items-center p-4 backdrop-blur-md overflow-y-auto"
      : `relative bg-gray-900 rounded-xl overflow-hidden border transition-all duration-300 ${
          isIdleAlert ? "border-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.4)]" : "border-gray-800"
        }`
    }>
      <div className={isExpanded ? "w-full max-w-5xl bg-gray-900 rounded-xl border border-gray-800 p-4 space-y-4 shadow-2xl relative my-auto" : "w-full flex flex-col"}>
        
        {/* Header */}
        <div className="p-3 flex justify-between items-center bg-gray-800/40 border-b border-gray-800 rounded-t-xl">
          <div className="flex items-center gap-2">
            <Camera className="w-4 h-4 text-emerald-400" />
            <span className="text-sm font-semibold text-white">{name}</span>
          </div>
          <div className="flex items-center gap-2">
            {/* Expand / Minimize Toggle Button */}
            <button 
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-1.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition-colors"
              title={isExpanded ? "Minimize View" : "Expand View"}
            >
              {isExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            <button 
              onClick={() => setShowDebug(!showDebug)}
              className={`p-1.5 rounded hover:bg-gray-800 text-gray-400 hover:text-white transition-colors ${showDebug ? "bg-amber-500/20 text-amber-300 hover:text-amber-200" : "bg-gray-800"}`}
              title="Toggle Debug Menu"
            >
              <Bug className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Video + Canvas (Clean feed, no overlays covering it) */}
        <div className="relative bg-black border-b border-gray-800">
          <video ref={videoRef} className="w-full h-auto block" muted playsInline />
          <canvas ref={canvasRef} className="absolute top-0 left-0 w-full h-full pointer-events-none" />
        </div>

        {/* Footer (Moved outside the video frame) */}
        <div className="p-3 bg-gray-900/80 rounded-b-xl flex flex-col gap-3">
          {/* Status & Activity Indicators */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-800/60 pb-2">
            <div className="flex items-center gap-2">
              <div className={`w-2.5 h-2.5 rounded-full ${dotClass}`} />
              <span className="text-xs font-semibold text-gray-200 bg-gray-800 px-2.5 py-1 rounded-md">
                {label} {activity === "idle" && `(${Math.floor(idleSeconds)}s)`}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {detections.length > 0 && (
                <span className="text-xs font-bold bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 px-2 py-1 rounded-md">
                  👥 {detections.length} Detected
                </span>
              )}
            </div>
          </div>

          {/* Metric Details */}
          <div className="flex items-center justify-between text-[11px] text-gray-400">
            <div>FPS: <span className="text-gray-200 font-medium">{fps > 0 ? fps.toFixed(1) : "—"}</span></div>
            <div>mvmt: <span className="text-gray-200 font-medium">{movementScore.toFixed(4)}</span></div>
            <div>conf: <span className="text-gray-200 font-medium">{(confidence * 100).toFixed(0)}%</span></div>
            <div className="flex items-center gap-1 text-emerald-400">
              <Activity className="w-3 h-3 text-emerald-500 animate-pulse" />
              <span>Active Tracking</span>
            </div>
          </div>

          {/* Active Employee Badges */}
          {detections.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {detections.map((det) => (
                <span key={det.track_id}
                  className="text-xs font-bold px-2 py-1 rounded-md border"
                  style={{ color: det.activity_colour, borderColor: det.activity_colour + "40", background: det.activity_colour + "15" }}
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
            <div className="flex items-center gap-2 text-amber-400 bg-amber-500/10 px-3 py-2 rounded-lg border border-amber-500/20 w-full animate-pulse">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              <span className="text-xs font-bold">Idle Alert: Track idle for {Math.floor(idleSeconds)}s</span>
            </div>
          )}
        </div>

        {/* Debug Menu */}
        {showDebug && (
          <div className="border-t border-gray-800 bg-gray-950 p-4 space-y-4 text-gray-300 relative z-20 rounded-b-xl">
            <div className="flex items-center justify-between border-b border-gray-800 pb-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-amber-500 flex items-center gap-1.5">
                <Bug className="w-3.5 h-3.5" /> Debug Menu
              </h4>
              {isUsingClip && (
                <span className="text-[10px] bg-amber-500/10 text-amber-400 px-1.5 py-0.5 rounded border border-amber-500/20 truncate max-w-[150px]">
                  Clip: {clipName}
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4">
              {/* Row 1: Clip Upload */}
              <div className="space-y-2">
                <h5 className="text-xs font-semibold text-gray-400 flex items-center gap-1">
                  <Upload className="w-3 h-3" /> Test Video Clip
                </h5>
                <div className="flex flex-col gap-2">
                  {!isUsingClip ? (
                    <label className="flex flex-col items-center justify-center h-20 border border-dashed border-gray-800 hover:border-gray-700 rounded-lg cursor-pointer hover:bg-gray-900/50 transition-all">
                      <div className="flex flex-col items-center justify-center pt-3 pb-3">
                        <Upload className="w-6 h-6 text-gray-500 mb-1" />
                        <p className="text-[11px] text-gray-500">Upload MP4 clip</p>
                      </div>
                      <input type="file" accept="video/*" className="hidden" onChange={handleClipUpload} />
                    </label>
                  ) : (
                    <button
                      onClick={() => {
                        if (videoRef.current) {
                          videoRef.current.src = "";
                          setIsUsingClip(false);
                          setClipName("");
                          setCameraTrigger(prev => prev + 1);
                        }
                      }}
                      className="flex items-center justify-center gap-1.5 py-2 px-3 bg-red-950/40 hover:bg-red-900/40 text-red-400 hover:text-red-300 border border-red-900/30 rounded-lg text-xs font-medium transition-all"
                    >
                      <CameraOff className="w-3.5 h-3.5" />
                      Reset to Webcam
                    </button>
                  )}
                </div>
              </div>

              {/* Row 2: Worker Check-In */}
              <div className="space-y-2">
                <h5 className="text-xs font-semibold text-gray-400 flex items-center gap-1">
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
                      className="flex-1 bg-gray-900 border border-gray-800 rounded px-2.5 py-1.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-amber-500"
                    />
                    <select
                      value={entryGate}
                      onChange={e => setEntryGate(e.target.value)}
                      className="bg-gray-900 border border-gray-800 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500"
                    >
                      {["Gate-A", "Gate-B", "Gate-C", "Gate-D"].map(g => (
                        <option key={g} value={g}>{g}</option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="submit"
                    disabled={submittingCheckIn || !employeeId.trim()}
                    className="w-full flex items-center justify-center gap-1 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium text-xs rounded transition-all"
                  >
                    {submittingCheckIn ? <RefreshCw className="w-3 h-3 animate-spin" /> : <UserCheck className="w-3 h-3" />}
                    Register & Match
                  </button>
                </form>
                {checkInStatus && (
                  <div className={`p-1.5 rounded text-[10px] border text-center ${
                    checkInStatus.ok ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" : "bg-red-500/10 border-red-500/20 text-red-400"
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
}
