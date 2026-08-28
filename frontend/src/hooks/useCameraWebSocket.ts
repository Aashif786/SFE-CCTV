import { useEffect, useRef, useState } from "react";

export interface Detection {
  track_id: number;
  employee_id?: string | null;
  status?: string;
  bbox?: [number, number, number, number];
  activity: string;
  activity_colour?: string;
  idle_seconds?: number;
  keypoints?: [number, number][];
  box: [number, number, number, number];
  worker_position?: [number, number] | null;
  identity?: { employee_id: string } | null;
}

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

interface UseCameraWebSocketProps {
  cameraId: string;
  cameraTrigger: number;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  clipUrl?: string | null;
}

export function useCameraWebSocket({
  cameraId,
  cameraTrigger,
  videoRef,
  canvasRef,
  clipUrl,
}: UseCameraWebSocketProps) {
  const [activity, setActivity] = useState<string>("offline");
  const [idleSeconds, setIdleSeconds] = useState<number>(0);
  const [movementScore, setMovementScore] = useState<number>(0);
  const [confidence, setConfidence] = useState<number>(0);
  const [idleThreshold, setIdleThreshold] = useState<number>(10);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [fps, setFps] = useState<number>(0);

  const wsRef = useRef<WebSocket | null>(null);
  const lastMsgTimeRef = useRef<number>(0);
  // Pre-allocated offscreen capture canvas — reused every frame to avoid DOM alloc + GC churn
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const captureCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  // Cached overlay canvas dimensions — only resize GPU buffer when video size actually changes
  const cachedOverlayW = useRef<number>(0);
  const cachedOverlayH = useRef<number>(0);

  useEffect(() => {
    let isMounted = true;
    let stream: MediaStream | null = null;

    // Pre-allocate the offscreen capture canvas once per mount
    const offscreen = document.createElement("canvas");
    offscreen.width = 1280;
    offscreen.height = 720;
    captureCanvasRef.current = offscreen;
    captureCtxRef.current = offscreen.getContext("2d");

    async function startCamera() {
      if (clipUrl) return; // Skip webcam if clip is provided
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            facingMode: "user"
          },
        });
        if (!isMounted) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (videoRef.current) {
          videoRef.current.src = "";
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

    let ws: WebSocket | null = null;
    const wsTimeout = setTimeout(() => {
      if (!isMounted) return;

      const host = typeof window !== "undefined" ? window.location.hostname : "localhost";
      const wsInstance = new WebSocket(`ws://${host}:8001/ws`);
      ws = wsInstance;
      wsRef.current = wsInstance;

      wsInstance.onopen = () => {
        if (isMounted) {
          setActivity("connected");
          // Kick off the first frame immediately on connection
          sendFrame();
        }
      };

      wsInstance.onmessage = (event) => {
        if (!isMounted) return;
        try {
          const now = performance.now();
          if (lastMsgTimeRef.current > 0) {
            const delta = now - lastMsgTimeRef.current;
            const currentFps = 1000 / delta;
            setFps((prev) => prev === 0 ? currentFps : prev * 0.95 + currentFps * 0.05);
          }
          lastMsgTimeRef.current = now;

          const data = JSON.parse(event.data);
          const act: string = data.activity ?? data.status ?? "unknown";

          setActivity(act);
          setIdleSeconds(data.idle_seconds ?? 0);
          setMovementScore(data.movement_score ?? 0);
          setConfidence(data.confidence ?? 0);
          if (data.idle_threshold_seconds !== undefined) {
            setIdleThreshold(data.idle_threshold_seconds);
          }
          setDetections(data.detections ?? []);

          const canvas = canvasRef.current;
          const video  = videoRef.current;
          if (!canvas || !video) {
            sendFrame();
            return;
          }

          const ctx = canvas.getContext("2d");
          if (!ctx) {
            sendFrame();
            return;
          }

          // Only reallocate the canvas GPU backing buffer when the video element
          // actually changes size — prevents the per-message buffer flush overhead.
          const rect = video.getBoundingClientRect();
          if (rect.width !== cachedOverlayW.current || rect.height !== cachedOverlayH.current) {
            canvas.width  = rect.width;
            canvas.height = rect.height;
            cachedOverlayW.current = rect.width;
            cachedOverlayH.current = rect.height;
          }
          ctx.clearRect(0, 0, canvas.width, canvas.height);

          // ── Draw workstation zone boundary ──────────────────────────────
          if (data.zone && data.zone.length === 4) {
            const [zx1, zy1, zx2, zy2] = data.zone;
            const px = zx1 * canvas.width;
            const py = zy1 * canvas.height;
            const pw = (zx2 - zx1) * canvas.width;
            const ph = (zy2 - zy1) * canvas.height;
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

          // ── Draw polygon zones overlay ──────────────────────────────────
          const zones: Array<{ id: string; name: string; color: string; points: [number, number][]; enabled?: boolean }> = data.zones ?? [];
          zones.forEach(zone => {
            if (!zone.points || zone.points.length < 3) return;
            if (zone.enabled === false) return;
            const pts = zone.points;
            const color = zone.color ?? "#3b82f6";
            ctx.beginPath();
            pts.forEach(([nx, ny], i) => {
              const px = nx <= 1.0 ? nx * canvas.width : nx;
              const py = ny <= 1.0 ? ny * canvas.height : ny;
              if (i === 0) ctx.moveTo(px, py);
              else ctx.lineTo(px, py);
            });
            ctx.closePath();
            // Semi-transparent fill
            ctx.globalAlpha = 0.12;
            ctx.fillStyle = color;
            ctx.fill();
            ctx.globalAlpha = 1;
            // Dashed stroke
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5;
            ctx.setLineDash([5, 3]);
            ctx.stroke();
            ctx.setLineDash([]);
            // Zone label at centroid
            const cx = pts.reduce((s, [x]) => s + (x <= 1.0 ? x * canvas.width : x), 0) / pts.length;
            const cy = pts.reduce((s, [, y]) => s + (y <= 1.0 ? y * canvas.height : y), 0) / pts.length;
            ctx.font = "bold 10px Inter, Arial, sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillStyle = "rgba(0,0,0,0.6)";
            ctx.fillText(zone.name, cx + 1, cy + 1);
            ctx.fillStyle = color;
            ctx.fillText(zone.name, cx, cy);
            ctx.textAlign = "left";
          });

          // ── Draw each tracked person ────────────────────────────────────
          const dets: Detection[] = data.detections ?? [];
          dets.forEach((det) => {
            const colour = det.activity_colour ?? "#6b7280";
            const label  = ACTIVITY_LABEL[det.activity] ?? det.status ?? det.activity;
            const rawEmpId = det.employee_id || det.identity?.employee_id || null;
            const empId  = rawEmpId ? rawEmpId.trim() : null;
            const [bx1n, by1n, bx2n, by2n] = det.bbox ?? det.box;
            const bx1 = bx1n * canvas.width;
            const by1 = by1n * canvas.height;
            const bx2 = bx2n * canvas.width;
            const by2 = by2n * canvas.height;

            const personH = by2 - by1;
            const personW = bx2 - bx1;
            const personScale = Math.max(0.2, Math.min(1.0, personH / 360));
            const lineW   = Math.max(0.5, 2.0 * personScale);
            const dotR    = Math.max(1.0, 4.0 * personScale);
            const boxW    = Math.max(1.0, 2.5 * personScale);
            const hipR    = Math.max(2.0, 6.0 * personScale);
            const fontSize = Math.max(8, Math.round(11 * personScale));
            const pillH    = Math.max(16, Math.round(22 * personScale));

            // Bounding box
            ctx.strokeStyle = colour;
            ctx.lineWidth = boxW;
            ctx.strokeRect(bx1, by1, personW, personH);

            // Activity pill
            const actLabel = empId ? `${empId} · ${label}` : `Track-${det.track_id} · ${label}`;
            ctx.font = `bold ${fontSize}px Arial`;
            const pillW_px = ctx.measureText(actLabel).width + 12;
            ctx.fillStyle = colour;
            ctx.fillRect(bx1, by1 - pillH, pillW_px, pillH);
            ctx.fillStyle = "#ffffff";
            ctx.fillText(actLabel, bx1 + 6, by1 - pillH / 3);

            // Skeleton
            if (det.keypoints && det.keypoints.length > 0) {
              const pts = det.keypoints.map(([px, py]) => [
                px * canvas.width,
                py * canvas.height,
              ]);
              const connections = [
                [11,12],[11,13],[13,15],[12,14],[14,16],
                [11,23],[12,24],[23,25],[25,27],[24,26],[26,28],
              ];
              ctx.strokeStyle = colour;
              ctx.lineWidth = lineW;
              connections.forEach(([i1, i2]) => {
                const kp1 = det.keypoints![i1];
                const kp2 = det.keypoints![i2];
                if (kp1 && kp2 && kp1[0] > 0.01 && kp1[1] > 0.01 && kp2[0] > 0.01 && kp2[1] > 0.01) {
                  ctx.beginPath();
                  ctx.moveTo(pts[i1][0], pts[i1][1]);
                  ctx.lineTo(pts[i2][0], pts[i2][1]);
                  ctx.stroke();
                }
              });

              // Draw joint dots
              ctx.fillStyle = colour;
              pts.forEach((p, idx) => {
                const kp = det.keypoints![idx];
                if (kp && kp[0] > 0.01 && kp[1] > 0.01) {
                  ctx.beginPath(); // new path per circle prevents orange polygon fills
                  ctx.arc(p[0], p[1], dotR, 0, 2 * Math.PI);
                  ctx.fill();
                }
              });
            }

            // Hip-centre dot
            if (det.worker_position && det.worker_position[0] > 0.01 && det.worker_position[1] > 0.01) {
              const [hx, hy] = det.worker_position;
              ctx.beginPath();
              ctx.arc(hx * canvas.width, hy * canvas.height, hipR, 0, 2 * Math.PI);
              ctx.fillStyle = "rgba(255,255,255,0.9)";
              ctx.fill();
              ctx.strokeStyle = colour;
              ctx.lineWidth = Math.max(1, lineW);
              ctx.stroke();
            }
          });
        } catch (e) {
          console.error("WS message error", e);
        }

        // Response-driven loop: send next frame immediately after rendering this response.
        // No setInterval — ensures at most one in-flight frame at a time, eliminating queue buildup.
        sendFrame();
      };

      wsInstance.onclose = () => {
        if (isMounted) {
          setActivity("disconnected");
          setFps(0);
          lastMsgTimeRef.current = 0;
        }
      };
    }, 50);

    /**
     * Capture and send the current video frame.
     *
     * Called once when the WebSocket opens, then again at the END of each
     * onmessage handler — this is the "response-driven" loop.
     * It guarantees at most one in-flight frame at a time, so frames can
     * never accumulate in the WebSocket send buffer and create latency debt.
     */
    function sendFrame() {
      if (!isMounted) return;
      if (wsRef.current?.readyState !== WebSocket.OPEN) return;
      const video = videoRef.current;
      if (!video || (!video.srcObject && !video.src)) return;
      const cx = captureCtxRef.current;
      const canvas = captureCanvasRef.current;
      if (!cx || !canvas) return;

      const vW = video.videoWidth || 1280;
      const vH = video.videoHeight || 720;
      if (canvas.width !== vW || canvas.height !== vH) {
        canvas.width = vW;
        canvas.height = vH;
      }

      cx.drawImage(video, 0, 0, vW, vH);
      const imageData = canvas
        .toDataURL("image/jpeg", 0.85)
        .split(",")[1];
      wsRef.current?.send(JSON.stringify({ image: imageData, camera_id: cameraId }));
    }

    return () => {
      isMounted = false;
      clearTimeout(wsTimeout);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      captureCanvasRef.current = null;
      captureCtxRef.current = null;
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (videoRef.current) {
        videoRef.current.srcObject = null;
        videoRef.current.src = "";
      }
    };
  }, [cameraId, cameraTrigger, videoRef, canvasRef, clipUrl]);

  return {
    activity,
    idleSeconds,
    movementScore,
    confidence,
    idleThreshold,
    detections,
    fps,
  };
}
