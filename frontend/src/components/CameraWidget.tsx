"use client";
import { useEffect, useRef, useState } from "react";
import { Camera, AlertTriangle, Activity, Footprints, BriefcaseBusiness } from "lucide-react";

// ── Activity display helpers ──────────────────────────────────────────────
const ACTIVITY_LABEL: Record<string, string> = {
  working:       "Working",
  walking:       "Walking",
  idle:          "Idle",
  using_mobile:  "📱 On Phone",
  no_person:     "No Person",
  unknown:       "Unknown",
};

const ACTIVITY_COLOUR: Record<string, string> = {
  working:       "#10b981",  // emerald
  walking:       "#3b82f6",  // blue
  idle:          "#f59e0b",  // amber
  using_mobile:  "#ec4899",  // pink
  no_person:     "#6b7280",  // gray
  unknown:       "#8b5cf6",  // violet
};

const ACTIVITY_DOT: Record<string, string> = {
  working:       "bg-emerald-500 animate-pulse",
  walking:       "bg-blue-500 animate-pulse",
  idle:          "bg-amber-500",
  using_mobile:  "bg-pink-500 animate-pulse",
  no_person:     "bg-gray-500",
  unknown:       "bg-violet-500",
};

export default function CameraWidget({ cameraId, name }: { cameraId: string; name: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [activity, setActivity] = useState("connecting");
  const [idleSeconds, setIdleSeconds] = useState(0);
  const [movementScore, setMovementScore] = useState(0);
  const [confidence, setConfidence] = useState(0);
  const [idleThreshold, setIdleThreshold] = useState(10);
  // Identity
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    let isMounted = true;
    let stream: MediaStream | null = null;

    async function startCamera() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: "user" },
        });
        if (!isMounted) { stream.getTracks().forEach((t) => t.stop()); return; }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch (err: any) {
        if (err?.name !== "AbortError") {
          console.error("Camera error:", err);
          setActivity("offline");
        }
      }
    }

    startCamera();

    const ws = new WebSocket("ws://localhost:8000/ws");
    wsRef.current = ws;

    ws.onopen = () => { if (isMounted) setActivity("connected"); };

    ws.onmessage = (event) => {
      if (!isMounted) return;
      try {
        const data = JSON.parse(event.data);
        const act: string = data.activity ?? data.status ?? "unknown";

        if (isMounted) {
          setActivity(act);
          setIdleSeconds(data.idle_seconds ?? 0);
          setMovementScore(data.movement_score ?? 0);
          setConfidence(data.confidence ?? 0);
          if (data.idle_threshold_seconds !== undefined) {
            setIdleThreshold(data.idle_threshold_seconds);
          }
          // Identity — clear when no person, set when matched
          if (data.identity?.employee_id) {
            setEmployeeId(data.identity.employee_id);
            setSessionId(data.identity.session_id ?? null);
          } else if (act === "no_person") {
            setEmployeeId(null);
            setSessionId(null);
          }
        }

        const canvas = canvasRef.current;
        const video  = videoRef.current;
        if (!canvas || !video) return;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const rect = video.getBoundingClientRect();
        canvas.width  = rect.width;
        canvas.height = rect.height;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const colour = ACTIVITY_COLOUR[act] ?? "#6b7280";

        // ── Draw workstation zone boundary ──────────────────────────────
        if (data.zone && data.zone.length === 4) {
          const [zx1, zy1, zx2, zy2] = data.zone;
          const px = zx1 * canvas.width;
          const py = zy1 * canvas.height;
          const pw = (zx2 - zx1) * canvas.width;
          const ph = (zy2 - zy1) * canvas.height;
          // Only draw when the zone isn't full-frame
          if (zx1 > 0.001 || zy1 > 0.001 || zx2 < 0.999 || zy2 < 0.999) {
            ctx.strokeStyle = "rgba(251,191,36,0.6)";  // amber dashed
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

        // ── Bounding box ─────────────────────────────────────────────────
        if (data.boxes?.length > 0) {
          data.boxes.forEach((box: number[]) => {
            ctx.strokeStyle = colour;
            ctx.lineWidth = 3;
            ctx.strokeRect(box[0], box[1], box[2] - box[0], box[3] - box[1]);
            // Label pill
            const label = ACTIVITY_LABEL[act] ?? act;
            const pillW = ctx.measureText(label).width + 24;
            ctx.fillStyle = colour;
            ctx.fillRect(box[0], box[1] - 26, pillW, 26);
            ctx.fillStyle = "#ffffff";
            ctx.font = "bold 13px Arial";
            ctx.fillText(label, box[0] + 8, box[1] - 8);
          });
        }

        // ── Skeleton ─────────────────────────────────────────────────────
        if (data.keypoints?.length > 0) {
          const pts = (data.keypoints as [number, number][]).map(([px, py]) => [
            px * canvas.width,
            py * canvas.height,
          ]);

          const connections = [
            [11,12],[11,13],[13,15],[12,14],[14,16],
            [11,23],[12,24],[23,25],[25,27],[24,26],[26,28],
          ];

          ctx.strokeStyle = colour;
          ctx.lineWidth = 2;
          connections.forEach(([i1, i2]) => {
            if (pts[i1] && pts[i2]) {
              ctx.beginPath();
              ctx.moveTo(pts[i1][0], pts[i1][1]);
              ctx.lineTo(pts[i2][0], pts[i2][1]);
              ctx.stroke();
            }
          });

          ctx.fillStyle = colour;
          pts.forEach((p) => {
            ctx.beginPath();
            ctx.arc(p[0], p[1], 4, 0, 2 * Math.PI);
            ctx.fill();
          });
        }

        // ── Hip-centre position dot ───────────────────────────────────────
        if (data.worker_position && data.worker_position.length === 2) {
          const [hx, hy] = data.worker_position as [number, number];
          ctx.beginPath();
          ctx.arc(hx * canvas.width, hy * canvas.height, 7, 0, 2 * Math.PI);
          ctx.fillStyle = "rgba(255,255,255,0.9)";
          ctx.fill();
          ctx.strokeStyle = colour;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      } catch (e) {
        console.error("WS message error", e);
      }
    };

    ws.onclose = () => { if (isMounted) setActivity("disconnected"); };

    const sendFrame = () => {
      if (!isMounted) return;
      if (wsRef.current?.readyState !== WebSocket.OPEN) return;
      const video = videoRef.current;
      if (!video || !video.srcObject) return;
      const c = document.createElement("canvas");
      c.width = 640; c.height = 480;
      const cx = c.getContext("2d");
      if (!cx) return;
      cx.drawImage(video, 0, 0, 640, 480);
      const imageData = c.toDataURL("image/jpeg", 0.7).split(",")[1];
      wsRef.current?.send(JSON.stringify({ image: imageData, camera_id: cameraId }));
    };

    intervalRef.current = setInterval(sendFrame, 200); // 5 FPS

    return () => {
      isMounted = false;
      if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [cameraId]);

  const isIdleAlert = (activity === "idle" || activity === "using_mobile") && idleSeconds > idleThreshold;
  const dotClass = ACTIVITY_DOT[activity] ?? "bg-gray-500";
  const label = ACTIVITY_LABEL[activity] ?? activity;

  return (
    <div className={`relative bg-gray-900 rounded-xl overflow-hidden border transition-all duration-300
      ${isIdleAlert ? "border-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.4)]" : "border-gray-800"}`}>

      {/* Header */}
      <div className="absolute top-0 left-0 w-full p-3 flex justify-between items-center bg-gradient-to-b from-black/80 to-transparent z-10">
        <div className="flex items-center gap-2">
          <Camera className="w-4 h-4 text-gray-300" />
          <span className="text-sm font-medium text-white">{name}</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Employee badge — visible when identity is resolved */}
          {employeeId && (
            <span className="text-xs font-bold bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 px-2 py-1 rounded-md backdrop-blur-md">
              👤 {employeeId}
            </span>
          )}
          <div className={`w-2 h-2 rounded-full ${dotClass}`} />
          <span className="text-xs text-gray-300 bg-black/50 px-2 py-1 rounded-md backdrop-blur-md">
            {label}
          </span>
        </div>
      </div>

      {/* Video + Canvas */}
      <div className="relative aspect-video bg-black">
        <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
        <canvas ref={canvasRef} className="absolute top-0 left-0 w-full h-full pointer-events-none" />
      </div>

      {/* Footer */}
      <div className="absolute bottom-0 left-0 w-full p-3 bg-gradient-to-t from-black/90 to-transparent z-10 flex justify-between items-end">
        <div className="space-y-1">
          {isIdleAlert && (
            <div className="flex items-center gap-2 text-amber-400 bg-amber-500/10 px-3 py-1.5 rounded-lg backdrop-blur-md border border-amber-500/20">
              <AlertTriangle className="w-4 h-4 animate-bounce" />
              <span className="text-sm font-bold">Idle Alert: {Math.floor(idleSeconds)}s</span>
            </div>
          )}
          {/* Show unidentified warning when person is in frame but not matched */}
          {activity !== "no_person" && activity !== "connecting" && !employeeId && (
            <div className="flex items-center gap-2 text-violet-400 bg-violet-500/10 px-3 py-1.5 rounded-lg backdrop-blur-md border border-violet-500/20">
              <span className="text-xs">⚠ Unidentified — use Check-In panel</span>
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="text-xs text-gray-400">FPS: ~5</div>
          <div className="text-xs text-gray-500">
            mvmt: <span className="text-gray-300">{movementScore.toFixed(4)}</span>
          </div>
          <div className="text-xs text-gray-500">
            conf: <span className="text-gray-300">{(confidence * 100).toFixed(0)}%</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-emerald-400">
            <Activity className="w-3 h-3" />
            <span>AI Processing</span>
          </div>
        </div>
      </div>
    </div>
  );
}
