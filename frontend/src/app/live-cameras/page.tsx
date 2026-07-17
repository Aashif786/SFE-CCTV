"use client";

import { useState, useMemo } from "react";
import {
  Video,
  Grid3X3,
  LayoutGrid,
  Maximize2,
  Wifi,
  WifiOff,
  Camera,
  RefreshCw,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import CameraTile from "@/components/cameras/CameraTile";
import { useLiveCameras, useCameraActions } from "@/hooks/useCameras";
import type { LiveCamera } from "@/hooks/useCameras";

// ---------------------------------------------------------------------------
// Grid layout options
// ---------------------------------------------------------------------------

type GridMode = "auto" | "1x1" | "2x2" | "3x3" | "4x4";

const GRID_CLASSES: Record<GridMode, string> = {
  auto: "grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
  "1x1": "grid-cols-1 max-w-4xl mx-auto",
  "2x2": "grid-cols-1 md:grid-cols-2",
  "3x3": "grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
  "4x4": "grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
};

const GRID_LABELS: Record<GridMode, string> = {
  auto: "Auto",
  "1x1": "1×1",
  "2x2": "2×2",
  "3x3": "3×3",
  "4x4": "4×4",
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function LiveCamerasPage() {
  const { cameras, loading, error, refetch } = useLiveCameras(3000);
  const [gridMode, setGridMode] = useState<GridMode>("auto");
  const [selectedCamera, setSelectedCamera] = useState<LiveCamera | null>(null);
  const [filterStatus, setFilterStatus] = useState<"all" | "online" | "offline">("all");

  // Stats
  const stats = useMemo(() => {
    const online = cameras.filter((c) => c.status === "ONLINE").length;
    const offline = cameras.filter((c) => c.status !== "ONLINE").length;
    const avgFps = cameras.filter((c) => c.fps > 0).reduce((s, c) => s + c.fps, 0) / (cameras.filter(c => c.fps > 0).length || 1);
    return { total: cameras.length, online, offline, avgFps };
  }, [cameras]);

  // Filter
  const filteredCameras = useMemo(() => {
    if (filterStatus === "online") return cameras.filter((c) => c.status === "ONLINE");
    if (filterStatus === "offline") return cameras.filter((c) => c.status !== "ONLINE");
    return cameras;
  }, [cameras, filterStatus]);

  // Single camera view
  if (selectedCamera) {
    const liveData = cameras.find((c) => c.id === selectedCamera.id) || selectedCamera;
    return (
      <div className="p-6 sm:p-8 space-y-6 max-w-6xl mx-auto">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSelectedCamera(null)}
            className="flex items-center gap-2 text-sm font-medium text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] bg-[hsl(var(--bg-table-head))] hover:bg-[hsl(var(--bg-input))] border border-[hsl(var(--border))] px-3 py-2 rounded-lg transition-colors"
          >
            <Grid3X3 className="w-4 h-4" />
            Back to Grid
          </button>
          <h2 className="text-xl font-bold text-[hsl(var(--text-primary))]">{liveData.name}</h2>
        </div>
        <CameraTile camera={liveData} onRefresh={refetch} />
      </div>
    );
  }

  return (
    <div className="p-6 sm:p-8 space-y-6">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-[hsl(var(--text-primary))] flex items-center gap-2.5">
            <Video className="w-6 h-6 text-emerald-500" />
            Live Cameras
          </h2>
          <p className="text-sm text-[hsl(var(--text-muted))] mt-1">
            Real-time monitoring dashboard
          </p>
        </div>
        <button
          onClick={refetch}
          className="flex items-center gap-2 text-sm font-medium text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] bg-[hsl(var(--bg-table-head))] hover:bg-[hsl(var(--bg-input))] border border-[hsl(var(--border))] px-3 py-2 rounded-lg transition-colors self-start"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* ── Stats bar ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Total Cameras"
          value={stats.total}
          icon={<Camera className="w-4 h-4 text-blue-500" />}
          bg="bg-blue-500/10"
        />
        <StatCard
          label="Online"
          value={stats.online}
          icon={<Wifi className="w-4 h-4 text-emerald-500" />}
          bg="bg-emerald-500/10"
          valueColor="text-emerald-600 dark:text-emerald-400"
        />
        <StatCard
          label="Offline"
          value={stats.offline}
          icon={<WifiOff className="w-4 h-4 text-red-500" />}
          bg="bg-red-500/10"
          valueColor={stats.offline > 0 ? "text-red-600 dark:text-red-400" : undefined}
        />
        <StatCard
          label="Avg FPS"
          value={stats.avgFps > 0 ? stats.avgFps.toFixed(0) : "—"}
          icon={<Video className="w-4 h-4 text-indigo-500" />}
          bg="bg-indigo-500/10"
        />
      </div>

      {/* ── Toolbar ────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Filter */}
        <div className="flex items-center gap-2">
          {(["all", "online", "offline"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilterStatus(f)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-all ${
                filterStatus === f
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                  : "text-[hsl(var(--text-secondary))] border-[hsl(var(--border))] hover:bg-[hsl(var(--bg-table-head))]"
              }`}
            >
              {f === "all" ? "All" : f === "online" ? `Online (${stats.online})` : `Offline (${stats.offline})`}
            </button>
          ))}
        </div>

        {/* Grid selector */}
        <div className="flex items-center gap-1 bg-[hsl(var(--bg-table-head))] rounded-lg p-1 border border-[hsl(var(--border))]">
          {(Object.keys(GRID_LABELS) as GridMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setGridMode(mode)}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-all ${
                gridMode === mode
                  ? "bg-[hsl(var(--bg-card))] text-[hsl(var(--text-primary))] shadow-sm"
                  : "text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-secondary))]"
              }`}
            >
              {GRID_LABELS[mode]}
            </button>
          ))}
        </div>
      </div>

      {/* ── Loading state ──────────────────────────────────────────── */}
      {loading && cameras.length === 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <SkeletonTile key={i} />
          ))}
        </div>
      )}

      {/* ── Error state ────────────────────────────────────────────── */}
      {error && (
        <div className="flex items-center gap-3 text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/20 px-5 py-4 rounded-xl">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <div>
            <p className="font-medium">Failed to load cameras</p>
            <p className="text-sm opacity-80 mt-0.5">{error}. Is the backend running?</p>
          </div>
        </div>
      )}

      {/* ── Camera Grid ────────────────────────────────────────────── */}
      {filteredCameras.length > 0 && (
        <div className={`grid gap-4 ${GRID_CLASSES[gridMode]}`}>
          {filteredCameras.map((cam) => (
            <div
              key={cam.id}
              className="cursor-pointer"
              onDoubleClick={() => setSelectedCamera(cam)}
            >
              <CameraTile camera={cam} onRefresh={refetch} />
            </div>
          ))}
        </div>
      )}

      {/* ── Empty state ────────────────────────────────────────────── */}
      {!loading && !error && filteredCameras.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-2xl bg-[hsl(var(--bg-table-head))] flex items-center justify-center mb-4">
            <Camera className="w-8 h-8 text-[hsl(var(--text-muted))]" />
          </div>
          <h3 className="text-lg font-semibold text-[hsl(var(--text-primary))] mb-1">
            {filterStatus !== "all" ? "No matching cameras" : "No cameras configured"}
          </h3>
          <p className="text-sm text-[hsl(var(--text-muted))] max-w-sm">
            {filterStatus !== "all"
              ? "Try a different filter or check your camera connections."
              : "Go to Camera Management to add your first camera."}
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  icon,
  bg,
  valueColor,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  bg: string;
  valueColor?: string;
}) {
  return (
    <div className="bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] rounded-xl p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-[hsl(var(--text-muted))]">{label}</span>
        <div className={`w-7 h-7 rounded-lg ${bg} flex items-center justify-center`}>{icon}</div>
      </div>
      <div className={`text-2xl font-bold ${valueColor || "text-[hsl(var(--text-primary))]"}`}>{value}</div>
    </div>
  );
}

function SkeletonTile() {
  return (
    <div className="bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] rounded-xl overflow-hidden shadow-sm animate-pulse">
      <div className="px-3 py-2.5 flex justify-between items-center bg-[hsl(var(--bg-table-head))]/60 border-b border-[hsl(var(--border))]">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-gray-400/40" />
          <div className="h-3.5 w-28 bg-gray-400/20 rounded" />
        </div>
        <div className="h-3.5 w-16 bg-gray-400/20 rounded" />
      </div>
      <div className="aspect-video bg-gradient-to-br from-gray-800/40 to-gray-900/40" />
      <div className="px-3 py-2 border-t border-[hsl(var(--border))]/60">
        <div className="flex items-center justify-between">
          <div className="h-3 w-20 bg-gray-400/20 rounded" />
          <div className="h-3 w-12 bg-gray-400/20 rounded" />
        </div>
      </div>
    </div>
  );
}
