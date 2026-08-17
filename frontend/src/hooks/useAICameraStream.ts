"use client";
import { useEffect, useRef, useState, useCallback } from "react";

/**
 * Receive-only WebSocket hook for server-side AI camera detection.
 *
 * Connects to `ws://host:8000/ws/camera/{cameraId}`. The backend reads
 * frames from the RTSP stream buffer and runs YOLO tracking — the client
 * never sends frames. This hook receives detection JSON and exposes it
 * for rendering overlays on the MJPEG <img>.
 */

export interface CameraZone {
  id: string;
  name: string;
  color: string;
  description?: string | null;
  points: [number, number][];
  enabled: boolean;
}

export interface ZoneStatus {
  zone_id: string;
  zone_name: string;
  zone_color: string;
  dwell_seconds: number;
  formatted_dwell: string;
  entry_time: string;
}

export interface AIDetection {
  track_id: number;
  activity: string;
  activity_colour: string;
  activity_display_name?: string;
  movement_score: number;
  confidence: number;
  idle_seconds: number;
  worker_position: [number, number] | null;
  foot_position?: [number, number] | null;
  zone_status?: ZoneStatus | null;
  keypoints: [number, number][];
  box: [number, number, number, number];
  identity: {
    employee_id: string | null;
    session_id: string | null;
    correlation_delay: number | null;
  };
}

export type AIStreamStatus =
  | "connecting"
  | "loading"
  | "tracking"
  | "offline"
  | "error"
  | "disconnected";

interface UseAICameraStreamResult {
  status: AIStreamStatus;
  detections: AIDetection[];
  activity: string;
  activityColour: string;
  idleSeconds: number;
  idleThreshold: number;
  confidence: number;
  movementScore: number;
  detectionCount: number;
  zone: number[];
  zones: CameraZone[];
  fps: number;
  image: string | null;
  disconnect: () => void;
}

export function useAICameraStream(
  cameraId: number | null
): UseAICameraStreamResult {
  const [status, setStatus] = useState<AIStreamStatus>("connecting");
  const [detections, setDetections] = useState<AIDetection[]>([]);
  const [activity, setActivity] = useState("no_person");
  const [activityColour, setActivityColour] = useState("#6b7280");
  const [idleSeconds, setIdleSeconds] = useState(0);
  const [idleThreshold, setIdleThreshold] = useState(10);
  const [confidence, setConfidence] = useState(0);
  const [movementScore, setMovementScore] = useState(0);
  const [detectionCount, setDetectionCount] = useState(0);
  const [zone, setZone] = useState<number[]>([0, 0, 1, 1]);
  const [zones, setZones] = useState<CameraZone[]>([]);
  const [fps, setFps] = useState(0);
  const [image, setImage] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const lastMsgTimeRef = useRef<number>(0);
  const mountedRef = useRef(true);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      try {
        wsRef.current.send(JSON.stringify({ action: "stop" }));
      } catch {
        // ignore if already closed
      }
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    if (cameraId === null) {
      setStatus("disconnected");
      return;
    }

    setStatus("connecting");
    setDetections([]);
    setActivity("no_person");
    setZones([]);
    setFps(0);
    setImage(null);
    lastMsgTimeRef.current = 0;

    let reconnectTimer: NodeJS.Timeout | null = null;
    const host =
      typeof window !== "undefined" ? window.location.hostname : "localhost";
    const wsUrl = `ws://${host}:8000/ws/camera/${cameraId}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      if (mountedRef.current) {
        setStatus("loading");
      }
    };

    ws.onmessage = (event) => {
      if (!mountedRef.current) return;
      try {
        const now = performance.now();
        if (lastMsgTimeRef.current > 0) {
          const delta = now - lastMsgTimeRef.current;
          const currentFps = 1000 / delta;
          setFps((prev) =>
            prev === 0 ? currentFps : prev * 0.9 + currentFps * 0.1
          );
        }
        lastMsgTimeRef.current = now;

        const data = JSON.parse(event.data);

        if (data.error) {
          setStatus("error");
          return;
        }

        const newStatus = data.status as AIStreamStatus;
        setStatus(newStatus || "tracking");

        if (data.detections) {
          setDetections(data.detections);
        }
        setActivity(data.activity ?? "no_person");
        setActivityColour(data.activity_colour ?? "#6b7280");
        setIdleSeconds(data.idle_seconds ?? 0);
        setConfidence(data.confidence ?? 0);
        setMovementScore(data.movement_score ?? 0);
        setDetectionCount(data.detection_count ?? 0);
        if (data.idle_threshold_seconds !== undefined) {
          setIdleThreshold(data.idle_threshold_seconds);
        }
        if (data.zone) {
          setZone(data.zone);
        }
        if (data.zones) {
          setZones(data.zones);
        }
        if (data.image) {
          setImage(data.image);
        }
      } catch (e) {
        console.error("[useAICameraStream] message parse error:", e);
      }
    };

    ws.onclose = () => {
      if (mountedRef.current) {
        setStatus("disconnected");
        setFps(0);
        lastMsgTimeRef.current = 0;
      }
    };

    ws.onerror = () => {
      if (mountedRef.current) {
        setStatus("error");
      }
    };

    return () => {
      mountedRef.current = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (wsRef.current) {
        const socket = wsRef.current;
        wsRef.current = null;
        if (socket.readyState === WebSocket.CONNECTING) {
          socket.onopen = () => {
            try {
              socket.close();
            } catch {
              // ignore
            }
          };
          socket.onmessage = null;
          socket.onerror = null;
        } else if (socket.readyState === WebSocket.OPEN) {
          try {
            socket.close();
          } catch {
            // ignore
          }
        }
      }
    };
  }, [cameraId]);

  return {
    status,
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
    fps,
    image,
    disconnect,
  };
}
