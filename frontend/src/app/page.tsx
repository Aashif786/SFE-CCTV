"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  Users,
  AlertCircle,
  Clock,
  ShieldCheck,
  Cpu,
  Video,
  Layers,
  UserCheck,
  Zap,
  RefreshCw,
  Plus,
  Activity,
  ArrowRight,
  Maximize2,
  SlidersHorizontal,
  Bell,
  CheckCircle2,
  Radio,
} from "lucide-react";
import { useLiveCameras } from "@/hooks/useCameras";
import type { LiveCamera } from "@/hooks/useCameras";
import AICameraTile from "@/components/cameras/AICameraTile";
import CameraTile from "@/components/cameras/CameraTile";

const AI_STORAGE_KEY = "calvision-ai-cameras";

function loadAICameraIds(): number[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(AI_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveAICameraIds(ids: number[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(AI_STORAGE_KEY, JSON.stringify(ids));
}

interface StatsData {
  active_workers: number;
  idle_alerts: number;
  avg_productivity: number;
  system_status: string;
  idle_threshold_seconds: number;
}

interface ResourceData {
  cpu_percent: number;
  memory_percent?: number;
  ram_percent?: number;
  disk_percent?: number;
  memory_used_mb?: number;
  memory_total_mb?: number;
}

interface ActiveSession {
  session_id: string;
  employee_id: string;
  current_track_id: string;
  camera_id: string;
  start_time: string;
  correlation_delay_seconds: number;
}

interface AlertItem {
  id: number;
  message: string;
  timestamp: string;
  resolved: boolean;
}

export default function Dashboard() {
  const { cameras: liveCameras, loading: camerasLoading, refetch: refetchCameras } = useLiveCameras(3000);

  const [stats, setStats] = useState<StatsData>({
    active_workers: 0,
    idle_alerts: 0,
    avg_productivity: 100,
    system_status: "Connecting...",
    idle_threshold_seconds: 10,
  });

  const [resources, setResources] = useState<ResourceData>({
    cpu_percent: 0,
    ram_percent: 0,
    memory_percent: 0,
    memory_used_mb: 0,
    memory_total_mb: 0,
  });

  const [activeSessions, setActiveSessions] = useState<ActiveSession[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [aiCameraIds, setAiCameraIds] = useState<number[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [gridMode, setGridMode] = useState<"auto" | "1x1" | "2x2">("auto");

  // Load saved AI camera toggles
  useEffect(() => {
    setAiCameraIds(loadAICameraIds());
  }, []);

  const toggleAI = (camId: number) => {
    setAiCameraIds((prev) => {
      const next = prev.includes(camId) ? prev.filter((id) => id !== camId) : [...prev, camId];
      saveAICameraIds(next);
      return next;
    });
  };

  const getApiBase = () => {
    const host = typeof window !== "undefined" ? window.location.hostname : "localhost";
    return `http://${host}:8001`;
  };

  const fetchDashboardData = useCallback(async () => {
    const api = getApiBase();
    try {
      const [statsRes, resRes, sessionRes, alertRes] = await Promise.all([
        fetch(`${api}/api/stats`).catch(() => null),
        fetch(`${api}/api/resources`).catch(() => null),
        fetch(`${api}/api/identity/sessions`).catch(() => null),
        fetch(`${api}/api/alerts`).catch(() => null),
      ]);


      if (statsRes && statsRes.ok) {
        const data = await statsRes.json();
        setStats(data);
      } else {
        setStats((prev) => ({ ...prev, system_status: "Offline" }));
      }

      if (resRes && resRes.ok) {
        const resData = await resRes.json();
        setResources(resData);
      }

      if (sessionRes && sessionRes.ok) {
        const sessData = await sessionRes.json();
        setActiveSessions(sessData);
      }

      if (alertRes && alertRes.ok) {
        const alertData = await alertRes.json();
        setAlerts(Array.isArray(alertData) ? alertData.slice(0, 5) : []);
      }
    } catch (err) {
      setStats((prev) => ({ ...prev, system_status: "Offline" }));
    }
  }, []);

  useEffect(() => {
    fetchDashboardData();
    const interval = setInterval(fetchDashboardData, 4000);
    return () => clearInterval(interval);
  }, [fetchDashboardData]);

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([fetchDashboardData(), refetchCameras()]);
    setTimeout(() => setIsRefreshing(false), 500);
  };

  const onlineCamerasCount = liveCameras.filter((c) => c.status === "ONLINE").length;

  return (
    <div className="p-6 sm:p-8 space-y-8 max-w-[1600px] mx-auto min-h-screen">
      {/* ── Top Command Bar ────────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[hsl(var(--border))]">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[hsl(var(--text-primary))]">
              Command Center
            </h1>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
              Live AI Pipeline
            </span>
          </div>
          <p className="text-sm text-[hsl(var(--text-secondary))] mt-1">
            Real-time Multi-Camera AI Video Intelligence & Workforce Occupancy Tracking
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] text-xs font-medium text-[hsl(var(--text-secondary))]">
            <Zap className="w-3.5 h-3.5 text-amber-500" />
            <span>CUDA Accelerated</span>
          </div>

          <button
            onClick={handleManualRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg bg-[hsl(var(--bg-card))] hover:bg-[hsl(var(--bg-table-head))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] transition-all active:scale-95 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-emerald-500 ${isRefreshing ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* ── KPI Metric Cards ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {/* Card 1: Active Workers */}
        <div className="relative overflow-hidden bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] rounded-2xl p-5 shadow-sm transition-all hover:shadow-md">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--text-muted))]">
              Active Workers
            </span>
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
              <Users className="w-5 h-5 text-emerald-500" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-[hsl(var(--text-primary))]">
              {stats.active_workers}
            </span>
            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
              On-camera now
            </span>
          </div>
          <div className="mt-3 pt-3 border-t border-[hsl(var(--border))] flex items-center justify-between text-xs text-[hsl(var(--text-secondary))]">
            <span>{onlineCamerasCount} AI Streams active</span>
            <span className="text-emerald-500 font-medium">100% Tracking</span>
          </div>
        </div>

        {/* Card 2: Idle Alerts Today */}
        <div className="relative overflow-hidden bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] rounded-2xl p-5 shadow-sm transition-all hover:shadow-md">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--text-muted))]">
              Idle Alerts (Today)
            </span>
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 flex items-center justify-center border border-amber-500/20">
              <AlertCircle className="w-5 h-5 text-amber-500" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-[hsl(var(--text-primary))]">
              {stats.idle_alerts}
            </span>
            <span className="text-xs font-medium text-[hsl(var(--text-muted))]">
              Threshold &gt;{stats.idle_threshold_seconds}s
            </span>
          </div>
          <div className="mt-3 pt-3 border-t border-[hsl(var(--border))] flex items-center justify-between text-xs text-[hsl(var(--text-secondary))]">
            <span>Auto-logged to DB</span>
            <Link href="/alerts" className="text-blue-500 hover:underline flex items-center gap-1 font-medium">
              View Log <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </div>

        {/* Card 3: Productivity Score */}
        <div className="relative overflow-hidden bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] rounded-2xl p-5 shadow-sm transition-all hover:shadow-md">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--text-muted))]">
              Avg Productivity
            </span>
            <div className="w-9 h-9 rounded-xl bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
              <Clock className="w-5 h-5 text-blue-500" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-[hsl(var(--text-primary))]">
              {stats.avg_productivity}%
            </span>
            <span className="text-xs font-medium text-blue-500">Working vs Idle</span>
          </div>
          <div className="mt-3 w-full bg-[hsl(var(--bg-table-head))] h-2 rounded-full overflow-hidden border border-[hsl(var(--border))]">
            <div
              className="bg-gradient-to-r from-blue-500 to-emerald-500 h-full transition-all duration-500"
              style={{ width: `${Math.min(100, Math.max(0, stats.avg_productivity))}%` }}
            />
          </div>
        </div>

        {/* Card 4: System Health & GPU */}
        <div className="relative overflow-hidden bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] rounded-2xl p-5 shadow-sm transition-all hover:shadow-md">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--text-muted))]">
              System Health
            </span>
            <div className="w-9 h-9 rounded-xl bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20">
              <Cpu className="w-5 h-5 text-indigo-500" />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  stats.system_status === "Healthy" ? "bg-emerald-500" : "bg-red-500"
                }`}
              />
              <span className="text-lg font-bold text-[hsl(var(--text-primary))]">
                {stats.system_status}
              </span>
            </div>
            <span className="text-xs font-mono text-[hsl(var(--text-muted))]">
              RAM {(resources?.ram_percent ?? resources?.memory_percent ?? 0).toFixed(0)}%
            </span>
          </div>
          <div className="mt-3 pt-3 border-t border-[hsl(var(--border))] flex items-center justify-between text-xs text-[hsl(var(--text-secondary))]">
            <span>CPU: {(resources?.cpu_percent ?? 0).toFixed(0)}%</span>
            <span className="font-mono text-emerald-500">FastAPI Async</span>
          </div>
        </div>
      </div>

      {/* ── Main Live Camera Feeds Grid ────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[hsl(var(--bg-card))] p-4 rounded-2xl border border-[hsl(var(--border))] shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
              <Video className="w-4 h-4 text-emerald-500" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-[hsl(var(--text-primary))]">
                Live IP Camera Feeds
              </h2>
              <p className="text-xs text-[hsl(var(--text-muted))]">
                {onlineCamerasCount} of {liveCameras.length} IP streams connected with live AI overlays
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            {/* Grid Layout Switcher */}
            <div className="flex items-center bg-[hsl(var(--bg-table-head))] p-1 rounded-lg border border-[hsl(var(--border))] text-xs font-medium">
              <button
                onClick={() => setGridMode("auto")}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  gridMode === "auto"
                    ? "bg-[hsl(var(--bg-card))] text-[hsl(var(--text-primary))] font-bold shadow-sm"
                    : "text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
                }`}
              >
                Auto
              </button>
              <button
                onClick={() => setGridMode("1x1")}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  gridMode === "1x1"
                    ? "bg-[hsl(var(--bg-card))] text-[hsl(var(--text-primary))] font-bold shadow-sm"
                    : "text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
                }`}
              >
                1×1
              </button>
              <button
                onClick={() => setGridMode("2x2")}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  gridMode === "2x2"
                    ? "bg-[hsl(var(--bg-card))] text-[hsl(var(--text-primary))] font-bold shadow-sm"
                    : "text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
                }`}
              >
                2×2
              </button>
            </div>

            <Link
              href="/camera-management"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-all shadow-sm"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>Manage Cameras</span>
            </Link>
          </div>
        </div>

        {/* Live Camera Grid Render */}
        {camerasLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 min-h-[300px]">
            {[1, 2].map((i) => (
              <div
                key={i}
                className="h-[320px] rounded-2xl bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] animate-pulse flex items-center justify-center text-[hsl(var(--text-muted))] text-sm"
              >
                Loading camera stream {i}...
              </div>
            ))}
          </div>
        ) : liveCameras.length === 0 ? (
          /* Empty State CTA */
          <div className="bg-[hsl(var(--bg-card))] border border-dashed border-[hsl(var(--border-strong))] rounded-2xl p-12 text-center space-y-4 shadow-sm">
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center mx-auto border border-emerald-500/20">
              <Video className="w-7 h-7" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-[hsl(var(--text-primary))]">
                No IP Cameras Configured
              </h3>
              <p className="text-sm text-[hsl(var(--text-muted))] max-w-md mx-auto mt-1">
                Add your RTSP IP CCTV cameras to start real-time multi-person pose detection and workstation dwell tracking.
              </p>
            </div>
            <Link
              href="/camera-management"
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white shadow-md transition-all active:scale-95"
            >
              <Plus className="w-4 h-4" />
              <span>Add IP Camera</span>
            </Link>
          </div>
        ) : (
          <div
            className={`grid gap-6 ${
              gridMode === "1x1"
                ? "grid-cols-1 max-w-4xl mx-auto"
                : gridMode === "2x2"
                ? "grid-cols-1 md:grid-cols-2"
                : "grid-cols-1 md:grid-cols-2 xl:grid-cols-3"
            }`}
          >
            {liveCameras.map((cam) => {
              const isAIEnabled = aiCameraIds.includes(cam.id);
              return isAIEnabled ? (
                <AICameraTile
                  key={cam.id}
                  camera={cam}
                  onRefresh={refetchCameras}
                />
              ) : (
                <CameraTile
                  key={cam.id}
                  camera={cam}
                  onRefresh={refetchCameras}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* ── Active Worker Sessions & Zone Occupancy Dual Grid ──────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column (2 cols): Active Worker Sessions Table */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
                <UserCheck className="w-4 h-4 text-blue-500" />
              </div>
              <h3 className="text-lg font-bold text-[hsl(var(--text-primary))]">
                Active Named Sessions ({activeSessions.length})
              </h3>
            </div>
            <Link
              href="/live-checkins"
              className="text-xs font-semibold text-blue-500 hover:underline flex items-center gap-1"
            >
              Live Check-ins <ArrowRight className="w-3 h-3" />
            </Link>
          </div>

          <div className="bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] rounded-2xl overflow-hidden shadow-sm">
            {activeSessions.length === 0 ? (
              <div className="p-8 text-center text-sm text-[hsl(var(--text-muted))]">
                No active employee sessions correlated yet today. RFID/NFC scans will bind automatically to camera tracks.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm border-collapse">
                  <thead>
                    <tr className="bg-[hsl(var(--bg-table-head))] border-b border-[hsl(var(--border))] text-[hsl(var(--text-muted))] text-xs uppercase font-semibold">
                      <th className="py-3 px-4">Employee ID</th>
                      <th className="py-3 px-4">Track ID</th>
                      <th className="py-3 px-4">Camera ID</th>
                      <th className="py-3 px-4">Match Delay</th>
                      <th className="py-3 px-4">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[hsl(var(--border))]">
                    {activeSessions.map((s) => (
                      <tr key={s.session_id} className="hover:bg-[hsl(var(--bg-table-head))]/50 transition-colors">
                        <td className="py-3 px-4 font-bold text-emerald-600 dark:text-emerald-400">
                          {s.employee_id}
                        </td>
                        <td className="py-3 px-4 font-mono text-xs text-[hsl(var(--text-secondary))]">
                          Track #{s.current_track_id}
                        </td>
                        <td className="py-3 px-4 text-xs font-medium text-[hsl(var(--text-primary))]">
                          {s.camera_id}
                        </td>
                        <td className="py-3 px-4 text-xs text-[hsl(var(--text-secondary))]">
                          {s.correlation_delay_seconds}s
                        </td>
                        <td className="py-3 px-4">
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            ACTIVE
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Right Column (1 col): Recent System & Idle Alerts Stream */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-amber-500/10 flex items-center justify-center border border-amber-500/20">
                <Bell className="w-4 h-4 text-amber-500" />
              </div>
              <h3 className="text-lg font-bold text-[hsl(var(--text-primary))]">
                Recent Alerts ({alerts.length})
              </h3>
            </div>
            <Link href="/alerts" className="text-xs font-semibold text-amber-500 hover:underline flex items-center gap-1">
              All Alerts <ArrowRight className="w-3 h-3" />
            </Link>
          </div>

          <div className="bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] rounded-2xl p-4 shadow-sm space-y-3">
            {alerts.length === 0 ? (
              <div className="py-8 text-center text-xs text-[hsl(var(--text-muted))] flex flex-col items-center justify-center gap-2">
                <CheckCircle2 className="w-8 h-8 text-emerald-500/40" />
                <span>No unresolved alerts today</span>
              </div>
            ) : (
              alerts.map((a) => (
                <div
                  key={a.id}
                  className="p-3 rounded-xl bg-[hsl(var(--bg-page))] border border-[hsl(var(--border))] space-y-1"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5" />
                      Idle Alert
                    </span>
                    <span className="text-[10px] text-[hsl(var(--text-muted))]">
                      {a.timestamp ? new Date(a.timestamp).toLocaleTimeString() : "Just now"}
                    </span>
                  </div>
                  <p className="text-xs text-[hsl(var(--text-primary))] leading-relaxed">
                    {a.message}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}