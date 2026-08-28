"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  Brain,
  Activity,
  AlertTriangle,
  Loader2,
  Wifi,
  WifiOff,
  RefreshCw,
  Users,
  Maximize2,
  Minimize2,
} from "lucide-react";
import type { LiveCamera } from "@/hooks/useCameras";
import { useCameraActions } from "@/hooks/useCameras";
import {
  useAICameraStream,
  type AIDetection,
  type AIStreamStatus,
} from "@/hooks/useAICameraStream";

const ACTIVITY_LABEL: Record<string, string> = {
  working:        "Working",
  walking:        "Walking",
  idle:           "Idle",
  using_phone:    "Using Phone",
  meeting:        "Meeting",
  away_from_desk: "Away From Desk",
  no_person:      "No Person",
  unknown:        "Unknown",
};

const ACTIVITY_DOT: Record<string, string> = {
  working:        "bg-emerald-500 animate-pulse",
  walking:        "bg-blue-500 animate-pulse",
  idle:           "bg-amber-500",
  using_phone:    "bg-violet-500 animate-pulse",
  meeting:        "bg-cyan-500 animate-pulse",
  away_from_desk: "bg-orange-500",
  no_person:      "bg-gray-400",
  unknown:        "bg-gray-500",
};

// ── Skeleton connections ────────────────────────────────────────────────────

const CONNECTIONS = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28],
];

// ── Component ───────────────────────────────────────────────────────────────

interface AICameraTileProps {
  camera: LiveCamera;
  onRefresh?: () => void;
  onExpandChange?: (isExpanded: boolean) => void;
}

export default function AICameraTile({ camera, onRefresh, onExpandChange }: AICameraTileProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [streamKey, setStreamKey] = useState(() => Date.now());
  const [mounted, setMounted] = useState(false);
  const { restartStream, getStreamUrl } = useCameraActions();

  useEffect(() => {
    setMounted(true);
  }, []);

  const isOnline = camera.status === "ONLINE";
  const streamUrl = getStreamUrl(camera.id);

  // Sync expanded state to parent
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

  // Connect to server-side AI WebSocket
  const {
    status: aiStatus,
    detections,
    activity,
    activityColour,
    idleSeconds,
    idleThreshold,
    confidence,
    movementScore,
    detectionCount,
    zone,
    zones,
    fps: aiFps,
    image,
  } = useAICameraStream(isOnline ? camera.id : null);

  const isIdleAlert = activity === "idle" && idleSeconds > idleThreshold;
  const dotClass = ACTIVITY_DOT[activity] ?? "bg-gray-400";
  const label = ACTIVITY_LABEL[activity] ?? activity;

  const handleFullscreen = useCallback(() => {
    setIsExpanded((v) => {
      const next = !v;
      onExpandChange?.(next);
      return next;
    });
  }, [onExpandChange]);

  // ── Manage stream image src & clean up HTTP connections on unmount ───
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;

    if (isOnline) {
      if (image) {
        setImgError(false);
        img.src = image;
      }
    } else {
      img.src = "";
      img.removeAttribute("src");
    }

    return () => {
      if (img) {
        img.src = "";
        img.removeAttribute("src");
      }
    };
  }, [image, isOnline]);

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

  function hexToRgba(hex: string, alpha: number): string {
    let c = (hex || "#3B82F6").replace("#", "");
    if (c.length === 3) c = c.split("").map((x) => x + x).join("");
    const num = parseInt(c, 16);
    if (isNaN(num)) return `rgba(59, 130, 246, ${alpha})`;
    return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, ${alpha})`;
  }

  // ── Draw detection overlay on canvas ────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const cw = canvas.width;
    const ch = canvas.height;

    // Handle canvas resolution matching display aspect
    if (
      canvas.clientWidth > 0 &&
      canvas.clientHeight > 0 &&
      (cw !== canvas.clientWidth || ch !== canvas.clientHeight)
    ) {
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!isOnline) return;

    // ── 0. Draw configured Polygon Zones overlay ───────────────────────────
    if (zones && zones.length > 0) {
      zones.forEach((z) => {
        if (!z.points || z.points.length < 3) return;
        if (z.enabled === false) return;

        // Check if points are in pixel coordinates or normalized
        const maxPx = Math.max(...z.points.map((pt) => pt[0]));
        const maxPy = Math.max(...z.points.map((pt) => pt[1]));
        const isPixel = maxPx > 1.0 || maxPy > 1.0;

        const canvasPoints: [number, number][] = z.points.map(([px, py]) => [
          isPixel ? px : px * cw,
          isPixel ? py : py * ch,
        ]);

        ctx.beginPath();
        ctx.moveTo(canvasPoints[0][0], canvasPoints[0][1]);
        for (let i = 1; i < canvasPoints.length; i++) {
          ctx.lineTo(canvasPoints[i][0], canvasPoints[i][1]);
        }
        ctx.closePath();

        // Semi-transparent fill & border
        ctx.fillStyle = hexToRgba(z.color, 0.18);
        ctx.fill();
        ctx.strokeStyle = z.color;
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Zone Name Label Tag
        const firstPt = canvasPoints[0];
        ctx.font = "bold 11px Arial";
        const tagText = z.name;
        const tagWidth = ctx.measureText(tagText).width + 12;
        ctx.fillStyle = z.color;
        ctx.fillRect(firstPt[0], firstPt[1], tagWidth, 18);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(tagText, firstPt[0] + 6, firstPt[1] + 13);
      });
    }

    // ── 1. Draw single camera-assigned zone (fallback/deprecated) ───────────
    if (zone && zone.length === 4 && (!zones || zones.length === 0)) {
      const [zx1, zy1, zx2, zy2] = zone;
      const px = zx1 * cw;
      const py = zy1 * ch;
      const pw = (zx2 - zx1) * cw;
      const ph = (zy2 - zy1) * ch;
      if (zx1 > 0.001 || zy1 > 0.001 || zx2 < 0.999 || zy2 < 0.999) {
        ctx.strokeStyle = "rgba(251,191,36,0.6)";
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 6]);
        ctx.strokeRect(px, py, pw, ph);
        ctx.setLineDash([]);
        ctx.fillStyle = "rgba(251,191,36,0.08)";
        ctx.fillRect(px, py, pw, ph);
        ctx.fillStyle = "rgba(251,191,36,0.85)";
        ctx.font = "11px Arial";
        ctx.fillText("Workstation", px + 6, py + 16);
      }
    }

    if (detections.length === 0) return;

    // Draw each tracked person
    detections.forEach((det: AIDetection) => {
      const colour = det.activity_colour || "#10b981";
      const actLabel =
        det.activity === "idle" && det.idle_seconds > 0
          ? `Idle ${Math.floor(det.idle_seconds)}s`
          : ACTIVITY_LABEL[det.activity] ?? det.activity;

      const empId = det.identity?.employee_id
        ? `👤 ${det.identity.employee_id}`
        : null;

      const [bx1n, by1n, bx2n, by2n] = det.box;
      const bx1 = bx1n * cw;
      const by1 = by1n * ch;
      const bx2 = bx2n * cw;
      const by2 = by2n * ch;

      const personH = by2 - by1;
      const personW = bx2 - bx1;
      const personScale = Math.max(0.2, Math.min(1.0, personH / 360));
      const lineW = Math.max(0.5, 2.0 * personScale);
      const dotR = Math.max(1.0, 4.0 * personScale);
      const boxW = Math.max(1.0, 2.5 * personScale);
      const hipR = Math.max(2.0, 6.0 * personScale);
      const fontSize = Math.max(8, Math.round(11 * personScale));
      const pillH = Math.max(16, Math.round(22 * personScale));

      // Bounding box
      ctx.strokeStyle = colour;
      ctx.lineWidth = boxW;
      ctx.strokeRect(bx1, by1, personW, personH);

      // Activity pill
      const pillLabel = empId
        ? `${empId} · ${actLabel}`
        : `Track-${det.track_id} · ${actLabel}`;
      ctx.font = `bold ${fontSize}px Arial`;
      const pillW = ctx.measureText(pillLabel).width + 12;
      ctx.fillStyle = colour;
      ctx.fillRect(bx1, by1 - pillH, pillW, pillH);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(pillLabel, bx1 + 6, by1 - pillH / 3);

      // Zone Dwell Badge on top of bounding box if person is in a zone
      if (det.zone_status) {
        const zoneTag = `📍 ${det.zone_status.zone_name} (${det.zone_status.formatted_dwell})`;
        ctx.font = `bold ${Math.max(8, fontSize - 1)}px Arial`;
        const zPillW = ctx.measureText(zoneTag).width + 10;
        const zPillH = Math.max(14, pillH - 2);
        ctx.fillStyle = det.zone_status.zone_color || "#3B82F6";
        ctx.fillRect(bx1, by1 - pillH - zPillH - 2, zPillW, zPillH);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(zoneTag, bx1 + 5, by1 - pillH - 5);
      }

      // Skeleton
      if (det.keypoints && det.keypoints.length > 0) {
        const pts = det.keypoints.map(([px, py]) => [px * cw, py * ch]);

        ctx.strokeStyle = colour;
        ctx.lineWidth = lineW;
        CONNECTIONS.forEach(([i1, i2]) => {
          const kp1 = det.keypoints![i1];
          const kp2 = det.keypoints![i2];
          if (
            kp1 &&
            kp2 &&
            kp1[0] > 0.01 &&
            kp1[1] > 0.01 &&
            kp2[0] > 0.01 &&
            kp2[1] > 0.01
          ) {
            ctx.beginPath();
            ctx.moveTo(pts[i1][0], pts[i1][1]);
            ctx.lineTo(pts[i2][0], pts[i2][1]);
            ctx.stroke();
          }
        });

        // Joint dots
        ctx.fillStyle = colour;
        pts.forEach((p, idx) => {
          const kp = det.keypoints![idx];
          if (kp && kp[0] > 0.01 && kp[1] > 0.01) {
            ctx.beginPath();
            ctx.arc(p[0], p[1], dotR, 0, 2 * Math.PI);
            ctx.fill();
          }
        });
      }

      // Foot Position Indicator Dot (bottom-center)
      if (det.foot_position) {
        const [fx, fy] = det.foot_position;
        const footPx = fx * cw;
        const footPy = fy * ch;
        ctx.beginPath();
        ctx.arc(footPx, footPy, Math.max(3, dotR + 1), 0, 2 * Math.PI);
        ctx.fillStyle = det.zone_status?.zone_color || "#10B981";
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else if (
        det.worker_position &&
        det.worker_position[0] > 0.01 &&
        det.worker_position[1] > 0.01
      ) {
        const [hx, hy] = det.worker_position;
        ctx.beginPath();
        ctx.arc(hx * cw, hy * ch, hipR, 0, 2 * Math.PI);
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.fill();
        ctx.strokeStyle = colour;
        ctx.lineWidth = Math.max(1, lineW);
        ctx.stroke();
      }
    });
  }, [detections, zone, zones, isOnline]);

  // ── Status indicator ──────────────────────────────────────────────────

  const statusBadge = (() => {
    switch (aiStatus) {
      case "connecting":
        return (
          <span className="flex items-center gap-1.5 text-[10px] font-medium text-blue-500 dark:text-blue-400">
            <Loader2 className="w-3 h-3 animate-spin" /> Connecting…
          </span>
        );
      case "loading":
        return (
          <span className="flex items-center gap-1.5 text-[10px] font-medium text-amber-500 dark:text-amber-400">
            <Loader2 className="w-3 h-3 animate-spin" /> Loading model…
          </span>
        );
      case "tracking":
        return (
          <span className="flex items-center gap-1.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
            <Activity className="w-3 h-3 animate-pulse" /> AI Active
          </span>
        );
      case "offline":
        return (
          <span className="flex items-center gap-1.5 text-[10px] font-medium text-red-500 dark:text-red-400">
            <WifiOff className="w-3 h-3" /> Stream Offline
          </span>
        );
      case "error":
        return (
          <span className="flex items-center gap-1.5 text-[10px] font-medium text-red-500 dark:text-red-400">
            <AlertTriangle className="w-3 h-3" /> Error
          </span>
        );
      default:
        return (
          <span className="flex items-center gap-1.5 text-[10px] font-medium text-[hsl(var(--text-muted))]">
            <WifiOff className="w-3 h-3" /> Disconnected
          </span>
        );
    }
  })();

  const tileContent = (
    <div
      ref={containerRef}
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
          : `relative bg-[hsl(var(--bg-card))] rounded-xl overflow-hidden border shadow-sm hover:shadow-md hover:border-[hsl(var(--border-strong))] group cursor-pointer transition-shadow transition-colors duration-200 ${
              isIdleAlert
                ? "border-amber-500/60 shadow-[0_0_15px_rgba(245,158,11,0.25)]"
                : aiStatus === "tracking"
                ? "border-emerald-500/30 hover:border-emerald-500/50"
                : "border-[hsl(var(--border))]"
            }`
      }
    >
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="px-3 py-2.5 flex justify-between items-center bg-[hsl(var(--bg-table-head))]/60 border-b border-[hsl(var(--border))]">
        <div className="flex items-center gap-2 min-w-0">
          <Brain className="w-3.5 h-3.5 text-violet-500 dark:text-violet-400 shrink-0" />
          <span className="text-xs font-semibold text-[hsl(var(--text-primary))] truncate">
            {camera.name}
          </span>
        </div>
        <div
          className="flex items-center gap-1.5 shrink-0"
          onDoubleClick={(e) => e.stopPropagation()}
        >
          {aiStatus === "tracking" && aiFps > 0 && (
            <span className="text-[10px] font-mono font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">
              {aiFps.toFixed(0)} fps
            </span>
          )}
          {statusBadge}
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

      {/* ── Video Area + Canvas Overlay ─────────────────────────────────── */}
      <div className="relative bg-black aspect-video">
        {isOnline && !imgError ? (
          <>
            {/* MJPEG stream */}
            <img
              ref={imgRef}
              alt={camera.name}
              draggable={false}
              className="w-full h-full object-cover block select-none pointer-events-auto"
              onError={() => setImgError(true)}
            />
            {/* Detection overlay canvas */}
            <canvas
              ref={canvasRef}
              draggable={false}
              className="absolute top-0 left-0 w-full h-full pointer-events-none z-10"
            />
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-gray-900 to-gray-950">
            <div className="w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center">
              <WifiOff className="w-7 h-7 text-red-500/70" />
            </div>
            <span className="text-sm font-medium text-red-400">Offline</span>
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

        {/* Detection count badge */}
        {detectionCount > 0 && aiStatus === "tracking" && (
          <div className="absolute top-2 right-2 flex items-center gap-1 bg-black/60 backdrop-blur-sm px-2 py-1 rounded-md z-20 pointer-events-none select-none">
            <Users className="w-3 h-3 text-emerald-400" />
            <span className="text-[10px] font-bold text-white">
              {detectionCount}
            </span>
          </div>
        )}
      </div>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <div className="px-3 py-2 bg-[hsl(var(--bg-card))]/90 border-t border-[hsl(var(--border))]/60">
        {/* Activity status row */}
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${dotClass}`} />
            <span className="text-[11px] font-semibold text-[hsl(var(--text-primary))]">
              {label}
              {activity === "idle" && ` (${Math.floor(idleSeconds)}s)`}
            </span>
          </div>
          {detections.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {detections.slice(0, 3).map((det) => (
                <span
                  key={det.track_id}
                  className="text-[9px] font-bold px-1.5 py-0.5 rounded border"
                  style={{
                    color: det.activity_colour,
                    borderColor: det.activity_colour + "40",
                    background: det.activity_colour + "15",
                  }}
                >
                  {det.identity?.employee_id
                    ? `👤 ${det.identity.employee_id}`
                    : `T-${det.track_id}`}
                </span>
              ))}
              {detections.length > 3 && (
                <span className="text-[9px] text-[hsl(var(--text-muted))] font-medium">
                  +{detections.length - 3}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Metrics row */}
        <div className="flex items-center justify-between text-[10px] text-[hsl(var(--text-muted))]">
          <div className="flex gap-3">
            <span>
              mvmt:{" "}
              <span className="text-[hsl(var(--text-secondary))] font-medium">
                {movementScore.toFixed(4)}
              </span>
            </span>
            <span>
              conf:{" "}
              <span className="text-[hsl(var(--text-secondary))] font-medium">
                {(confidence * 100).toFixed(0)}%
              </span>
            </span>
          </div>
          <span className="text-[hsl(var(--text-muted))]">
            {camera.location && `📍 ${camera.location}`}
          </span>
        </div>
      </div>

      {/* Idle alert bar */}
      {isIdleAlert && (
        <div className="px-3 py-2 border-t border-amber-500/20 bg-amber-500/10 flex items-center gap-2 animate-pulse">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
          <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400">
            Idle Alert: {Math.floor(idleSeconds)}s
          </span>
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
