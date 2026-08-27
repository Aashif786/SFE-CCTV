"use client";
import { useState, useEffect, useCallback, useRef } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CameraInfo {
  id: number;
  name: string;
  description: string | null;
  location: string | null;
  building: string | null;
  floor: string | null;
  zone: string | null;
  door_name: string | null;
  ip_address: string;
  rtsp_port: number;
  stream_path: string;
  username: string;
  camera_brand: string | null;
  stream_type: string;
  enabled: boolean;
  recording_enabled: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export interface LiveCamera {
  id: number;
  name: string;
  description: string | null;
  location: string | null;
  building: string | null;
  floor: string | null;
  zone: string | null;
  door_name: string | null;
  camera_brand: string | null;
  stream_type: string;
  enabled: boolean;
  status: string;           // ONLINE | OFFLINE | STARTING | RECONNECTING …
  fps: number;
  last_frame_time: string | null;
  error_message: string;
  reconnect_count: number;
  stream: string;           // e.g. /api/streams/1
}

export interface CameraFormData {
  name: string;
  description: string;
  location: string;
  building: string;
  floor: string;
  zone: string;
  door_name: string;
  ip_address: string;
  rtsp_port: number;
  stream_path: string;
  username: string;
  password: string;
  camera_brand: string;
  stream_type: string;
  enabled: boolean;
  recording_enabled: boolean;
}

export interface TestResult {
  status: "success" | "failed";
  message: string;
  resolution?: { width: number; height: number };
}

// ---------------------------------------------------------------------------
// API base
// ---------------------------------------------------------------------------

function getApiBase(): string {
  const host = typeof window !== "undefined" ? window.location.hostname : "localhost";
  return `http://${host}:8001`;
}

// ---------------------------------------------------------------------------
// useCameras — fetch & auto-refresh camera list (CRUD table)
// ---------------------------------------------------------------------------

export function useCameras() {
  const [cameras, setCameras] = useState<CameraInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCameras = useCallback(async () => {
    try {
      const res = await fetch(`${getApiBase()}/api/cameras`);
      if (!res.ok) throw new Error(`Server ${res.status}`);
      const data = await res.json();
      setCameras(data);
      setError(null);
    } catch (e: any) {
      setError(e.message || "Failed to fetch cameras");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCameras();
  }, [fetchCameras]);

  return { cameras, loading, error, refetch: fetchCameras };
}

// ---------------------------------------------------------------------------
// useLiveCameras — live dashboard with auto-refresh
// ---------------------------------------------------------------------------

export function useLiveCameras(refreshMs: number = 3000) {
  const [cameras, setCameras] = useState<LiveCamera[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchLive = useCallback(async () => {
    try {
      const res = await fetch(`${getApiBase()}/api/cameras/live`);
      if (!res.ok) throw new Error(`Server ${res.status}`);
      const data = await res.json();
      setCameras(data);
      setError(null);
    } catch (e: any) {
      setError(e.message || "Failed to fetch live cameras");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLive();
    intervalRef.current = setInterval(fetchLive, refreshMs);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchLive, refreshMs]);

  return { cameras, loading, error, refetch: fetchLive };
}

// ---------------------------------------------------------------------------
// useCameraActions — CRUD + operations
// ---------------------------------------------------------------------------

export function useCameraActions() {
  const api = getApiBase();

  const createCamera = async (data: CameraFormData): Promise<CameraInfo> => {
    const res = await fetch(`${api}/api/cameras`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Server ${res.status}`);
    }
    return res.json();
  };

  const updateCamera = async (id: number, data: Partial<CameraFormData>): Promise<CameraInfo> => {
    const res = await fetch(`${api}/api/cameras/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Server ${res.status}`);
    }
    return res.json();
  };

  const deleteCamera = async (id: number): Promise<void> => {
    const res = await fetch(`${api}/api/cameras/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Server ${res.status}`);
    }
  };

  const testConnection = async (id: number): Promise<TestResult> => {
    const res = await fetch(`${api}/api/cameras/${id}/test`, { method: "POST" });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Server ${res.status}`);
    }
    return res.json();
  };

  const restartStream = async (id: number): Promise<void> => {
    const res = await fetch(`${api}/api/cameras/${id}/restart`, { method: "POST" });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Server ${res.status}`);
    }
  };

  const getSnapshotUrl = (id: number): string => {
    return `${api}/api/cameras/${id}/snapshot?t=${Date.now()}`;
  };

  const getStreamUrl = (id: number): string => {
    return `${api}/api/streams/${id}`;
  };

  return {
    createCamera,
    updateCamera,
    deleteCamera,
    testConnection,
    restartStream,
    getSnapshotUrl,
    getStreamUrl,
  };
}
