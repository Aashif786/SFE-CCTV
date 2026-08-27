"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Video,
  Brain,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  Cpu,
  MemoryStick,
  Thermometer,
  Monitor,
  Loader2,
  AlertTriangle,
  Camera,
  RefreshCw,
  Check,
  ArrowRight,
  ArrowLeft,
  Zap,
  Maximize2,
} from "lucide-react";
import CameraTile from "@/components/cameras/CameraTile";
import AICameraTile from "@/components/cameras/AICameraTile";
import { useLiveCameras } from "@/hooks/useCameras";
import type { LiveCamera } from "@/hooks/useCameras";

// ── Local storage keys ────────────────────────────────────────────────────

const STORAGE_KEY = "calvision-ai-cameras";
const CCTV_ORDER_KEY = "calvision-cctv-order";
const AI_ORDER_KEY = "calvision-ai-order";

function loadAICameraIds(): number[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveAICameraIds(ids: number[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
}

function loadOrder(key: string): number[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveOrder(key: string, ids: number[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, JSON.stringify(ids));
}

/** Moves `draggedId` before or after `targetId` in the array. */
function reorderIds(
  ids: number[],
  draggedId: number,
  targetId: number,
  insertBefore: boolean
): number[] {
  const arr = [...ids];
  const fromIdx = arr.indexOf(draggedId);
  if (fromIdx === -1) return arr;
  arr.splice(fromIdx, 1);
  const newTargetIdx = arr.indexOf(targetId);
  if (newTargetIdx === -1) return arr;
  const insertIdx = insertBefore ? newTargetIdx : newTargetIdx + 1;
  arr.splice(insertIdx, 0, draggedId);
  return arr;
}

// ── Grid mode configuration ───────────────────────────────────────────────

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

// ── Toast types ───────────────────────────────────────────────────────────

interface Toast {
  id: string;
  message: string;
  type: "info" | "loading" | "success" | "error";
  icon?: React.ReactNode;
}

// ── System resources hook ─────────────────────────────────────────────────

interface SystemResources {
  cpu_percent: number;
  memory_percent: number;
  disk_percent: number;
  gpu: {
    available: boolean;
    name: string;
    utilization_percent: number;
    memory_used_mb: number;
    memory_total_mb: number;
    memory_percent: number;
    temperature_c: number;
  };
}

function useSystemResources(intervalMs: number = 1000) {
  const [resources, setResources] = useState<SystemResources | null>(null);

  useEffect(() => {
    const host =
      typeof window !== "undefined" ? window.location.hostname : "localhost";

    async function fetchResources() {
      try {
        const res = await fetch(`http://${host}:8001/api/system/resources`);
        if (res.ok) {
          setResources(await res.json());
        }
      } catch {
        // Silent fail — resource tracker is non-critical
      }
    }

    fetchResources();
    const interval = setInterval(fetchResources, intervalMs);
    return () => clearInterval(interval);
  }, [intervalMs]);

  return resources;
}

// ── Resource bar color helper ─────────────────────────────────────────────

function getResourceColor(percent: number): string {
  if (percent < 0) return "text-gray-400";
  if (percent < 50) return "text-emerald-600 dark:text-emerald-400";
  if (percent < 80) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

function getResourceBg(percent: number): string {
  if (percent < 0) return "bg-gray-500/20";
  if (percent < 50) return "bg-emerald-500/20";
  if (percent < 80) return "bg-amber-500/20";
  return "bg-red-500/20";
}

function getResourceFill(percent: number): string {
  if (percent < 0) return "bg-gray-400";
  if (percent < 50) return "bg-emerald-500";
  if (percent < 80) return "bg-amber-500";
  return "bg-red-500";
}

// ── Page Component ────────────────────────────────────────────────────────

export default function LiveCamerasPage() {
  const { cameras, loading, error, refetch } = useLiveCameras(3000);
  const resources = useSystemResources(1000);

  // AI camera set — persisted to localStorage
  const [aiCameraIds, setAICameraIds] = useState<Set<number>>(new Set());
  const [initialized, setInitialized] = useState(false);

  // Active expanded panel
  const [activePanel, setActivePanel] = useState<"cctv" | "ai">("cctv");
  // Delayed visual collapsed state — trails activePanel by 300ms (matches CSS transition)
  // This prevents the content swap from racing the width animation
  const [visuallyCCTVCollapsed, setVisuallyCCTVCollapsed] = useState(false);
  const [visuallyAICollapsed, setVisuallyAICollapsed] = useState(false);

  // Per-panel independent grid modes
  const [cctvGridMode, setCctvGridMode] = useState<GridMode>("auto");
  const [aiGridMode, setAiGridMode] = useState<GridMode>("auto");

  // Panel order (persisted)
  const [cctvOrder, setCctvOrder] = useState<number[]>([]);
  const [aiOrder, setAiOrder] = useState<number[]>([]);

  // Drag state
  const [expandedCameraId, setExpandedCameraId] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragSource, setDragSource] = useState<"cctv" | "ai" | null>(null);
  const [dragOverPanel, setDragOverPanel] = useState<"cctv" | "ai" | null>(null);
  const [draggedCameraId, setDraggedCameraId] = useState<number | null>(null);
  const [dragPosition, setDragPosition] = useState<{ x: number; y: number } | null>(null);
  const [dragPreviewCamera, setDragPreviewCamera] = useState<LiveCamera | null>(null);
  // Same-panel reorder insertion tracking
  const [dragOverCardId, setDragOverCardId] = useState<number | null>(null);
  const dragInsertBeforeRef = useRef<boolean>(true);

  // Toasts
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastIdCounter = useRef(0);

  // Load persisted AI camera IDs and panel orders on mount
  useEffect(() => {
    const saved = loadAICameraIds();
    setAICameraIds(new Set(saved));
    setCctvOrder(loadOrder(CCTV_ORDER_KEY));
    setAiOrder(loadOrder(AI_ORDER_KEY));
    setInitialized(true);
  }, []);

  // Persist AI camera IDs when they change
  useEffect(() => {
    if (initialized) {
      saveAICameraIds(Array.from(aiCameraIds));
    }
  }, [aiCameraIds, initialized]);

  // Sync visual CCTV collapsed state — delay expanded content until after width animation
  useEffect(() => {
    if (isDragging) {
      setVisuallyCCTVCollapsed(false);
      return;
    }
    if (activePanel !== "cctv") {
      setVisuallyCCTVCollapsed(true);
    } else {
      refetch();
      const t = setTimeout(() => setVisuallyCCTVCollapsed(false), 310);
      return () => clearTimeout(t);
    }
  }, [activePanel, isDragging, refetch]);

  // Sync visual AI collapsed state — delay expanded content until after width animation
  useEffect(() => {
    if (isDragging) {
      setVisuallyAICollapsed(false);
      return;
    }
    if (activePanel !== "ai") {
      setVisuallyAICollapsed(true);
    } else {
      const t = setTimeout(() => setVisuallyAICollapsed(false), 310);
      return () => clearTimeout(t);
    }
  }, [activePanel, isDragging]);

  // ── Toast helpers ─────────────────────────────────────────────────────

  const addToast = useCallback(
    (message: string, type: Toast["type"], icon?: React.ReactNode, duration = 2500) => {
      const id = `toast-${++toastIdCounter.current}`;
      setToasts((prev) => [...prev, { id, message, type, icon }]);
      if (duration > 0) {
        setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== id));
        }, duration);
      }
      return id;
    },
    []
  );

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // ── Camera lists ──────────────────────────────────────────────────────

  const cctvCameras = useMemo(() => {
    const filtered = cameras.filter((c) => !aiCameraIds.has(c.id));
    if (cctvOrder.length === 0) return filtered;
    return [...filtered].sort((a, b) => {
      const ai = cctvOrder.indexOf(a.id);
      const bi = cctvOrder.indexOf(b.id);
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  }, [cameras, aiCameraIds, cctvOrder]);

  const aiCameras = useMemo(() => {
    const filtered = cameras.filter((c) => aiCameraIds.has(c.id));
    if (aiOrder.length === 0) return filtered;
    return [...filtered].sort((a, b) => {
      const ai = aiOrder.indexOf(a.id);
      const bi = aiOrder.indexOf(b.id);
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  }, [cameras, aiCameraIds, aiOrder]);

  // ── Drag handlers ────────────────────────────────────────────────────

  const handleDragStart = useCallback(
    (e: React.DragEvent, cameraId: number, source: "cctv" | "ai") => {
      if (expandedCameraId !== null || (e.target as HTMLElement).closest(".fixed")) {
        e.preventDefault();
        return;
      }

      e.dataTransfer.setData("text/plain", String(cameraId));
      e.dataTransfer.setData("application/x-source", source);
      e.dataTransfer.effectAllowed = "move";

      // Suppress the default browser ghost image with a transparent 1×1 GIF
      const ghost = new Image();
      ghost.src =
        "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
      e.dataTransfer.setDragImage(ghost, 0, 0);

      // Find the camera object so we can render a preview
      const cam = cameras.find((c) => c.id === cameraId) ?? null;

      // Asynchronously update drag state so browser captures transparent ghost first
      setTimeout(() => {
        setIsDragging(true);
        setDragSource(source);
        setDraggedCameraId(cameraId);
        setDragPreviewCamera(cam);
        setDragPosition({ x: e.clientX, y: e.clientY });
      }, 0);
    },
    [cameras, expandedCameraId]
  );

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
    setDragSource(null);
    setDragOverPanel(null);
    setDraggedCameraId(null);
    setDragPosition(null);
    setDragPreviewCamera(null);
    setDragOverCardId(null);
  }, []);

  /** Called when hovering over a card in the SAME panel — tracks insertion position. */
  const handleCardDragOver = useCallback(
    (e: React.DragEvent, cardId: number, panel: "cctv" | "ai") => {
      // Only handle same-panel reorder
      if (dragSource !== panel) return;
      e.preventDefault();
      e.stopPropagation(); // Don't bubble to panel dragover
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      dragInsertBeforeRef.current = e.clientY < rect.top + rect.height / 2;
      setDragOverCardId(cardId);
    },
    [dragSource]
  );

  /** Called when dropping on a card in the SAME panel — performs reorder. */
  const handleCardDrop = useCallback(
    (e: React.DragEvent, targetCardId: number, panel: "cctv" | "ai") => {
      if (dragSource !== panel) return;
      e.preventDefault();
      e.stopPropagation();

      const draggedId = draggedCameraId;
      // Reset all drag state
      setIsDragging(false);
      setDragSource(null);
      setDragOverPanel(null);
      setDraggedCameraId(null);
      setDragPosition(null);
      setDragPreviewCamera(null);
      setDragOverCardId(null);

      if (!draggedId || draggedId === targetCardId) return;

      const currentIds =
        panel === "cctv"
          ? cctvCameras.map((c) => c.id)
          : aiCameras.map((c) => c.id);

      const newOrder = reorderIds(
        currentIds,
        draggedId,
        targetCardId,
        dragInsertBeforeRef.current
      );

      if (panel === "cctv") {
        setCctvOrder(newOrder);
        saveOrder(CCTV_ORDER_KEY, newOrder);
      } else {
        setAiOrder(newOrder);
        saveOrder(AI_ORDER_KEY, newOrder);
      }
    },
    [dragSource, draggedCameraId, cctvCameras, aiCameras]
  );

  // Track cursor position during drag via document-level dragover
  useEffect(() => {
    if (!isDragging) return;
    const onDragOver = (e: DragEvent) => {
      setDragPosition({ x: e.clientX, y: e.clientY });
    };
    document.addEventListener("dragover", onDragOver);
    return () => document.removeEventListener("dragover", onDragOver);
  }, [isDragging]);

  const handleDragOver = useCallback(
    (e: React.DragEvent, panel: "cctv" | "ai") => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDragOverPanel(panel);
    },
    []
  );

  const handleDragLeave = useCallback(
    (_e: React.DragEvent, panel: "cctv" | "ai") => {
      setDragOverPanel((prev) => (prev === panel ? null : prev));
    },
    []
  );

  const handleDrop = useCallback(
    async (e: React.DragEvent, targetPanel: "cctv" | "ai") => {
      e.preventDefault();
      const cameraIdStr = e.dataTransfer.getData("text/plain");
      const source = e.dataTransfer.getData("application/x-source") as "cctv" | "ai";
      const cameraId = parseInt(cameraIdStr, 10);

      setIsDragging(false);
      setDragSource(null);
      setDragOverPanel(null);
      setDraggedCameraId(null);
      setDragPosition(null);
      setDragPreviewCamera(null);
      setDragOverCardId(null);

      if (isNaN(cameraId)) return;
      // Same-panel drop on empty area → move to end (handled by card-level handler if on a card)
      if (source === targetPanel) {
        // Just re-append to end to handle empty-area drops
        if (source === "cctv") {
          const ids = cctvCameras.map((c) => c.id).filter((id) => id !== cameraId);
          const newOrder = [...ids, cameraId];
          setCctvOrder(newOrder);
          saveOrder(CCTV_ORDER_KEY, newOrder);
        } else {
          const ids = aiCameras.map((c) => c.id).filter((id) => id !== cameraId);
          const newOrder = [...ids, cameraId];
          setAiOrder(newOrder);
          saveOrder(AI_ORDER_KEY, newOrder);
        }
        return;
      }

      // Requirement 8: Automatically expand destination panel after drop
      setActivePanel(targetPanel);

      const cameraName =
        cameras.find((c) => c.id === cameraId)?.name ?? `Camera ${cameraId}`;

      if (targetPanel === "ai") {
        // CCTV → AI
        const moveToastId = addToast(
          `Moving ${cameraName} to AI Monitoring…`,
          "info",
          <ArrowRight className="w-5 h-5 animate-pulse text-blue-400" />
        );

        await new Promise((r) => setTimeout(r, 600));
        removeToast(moveToastId);

        const loadToastId = addToast(
          `Loading AI tracking model for ${cameraName}…`,
          "loading",
          <Loader2 className="w-5 h-5 animate-spin text-violet-400" />
        );

        setAICameraIds((prev) => {
          const next = new Set(Array.from(prev));
          next.add(cameraId);
          return next;
        });
        // Append to end of AI order
        setAiOrder((prev) => {
          const next = prev.filter((id) => id !== cameraId);
          next.push(cameraId);
          saveOrder(AI_ORDER_KEY, next);
          return next;
        });

        await new Promise((r) => setTimeout(r, 1000));
        removeToast(loadToastId);

        addToast(
          `AI Tracking Enabled for ${cameraName} ✓`,
          "success",
          <Check className="w-5 h-5 text-emerald-400" />
        );
      } else {
        // AI → CCTV
        const moveToastId = addToast(
          `Moving ${cameraName} to CCTV Monitoring…`,
          "info",
          <ArrowLeft className="w-5 h-5 animate-pulse text-blue-400" />
        );

        await new Promise((r) => setTimeout(r, 600));
        removeToast(moveToastId);

        setAICameraIds((prev) => {
          const next = new Set(Array.from(prev));
          next.delete(cameraId);
          return next;
        });
        // Append to end of CCTV order
        setCctvOrder((prev) => {
          const next = prev.filter((id) => id !== cameraId);
          next.push(cameraId);
          saveOrder(CCTV_ORDER_KEY, next);
          return next;
        });

        addToast(
          `AI Tracking Disabled for ${cameraName} ✓`,
          "success",
          <Check className="w-5 h-5 text-emerald-400" />
        );
      }
    },
    [cameras, addToast, removeToast, cctvCameras, aiCameras]
  );

  // ── Panel Width Calculation (Requirement 7) ──────────────────────────

  const getPanelWidths = () => {
    if (isDragging) {
      // Requirement 7: While dragging, split 50% / 50%
      return { cctv: "50%", ai: "50%" };
    }
    // Default ratio: active panel gets 90%, collapsed gets 10%
    return activePanel === "cctv"
      ? { cctv: "90%", ai: "10%" }
      : { cctv: "10%", ai: "90%" };
  };

  const widths = getPanelWidths();
  const isCCTVCollapsed = !isDragging && activePanel !== "cctv";
  const isAICollapsed = !isDragging && activePanel !== "ai";

  // ── Render Loading / Error States ────────────────────────────────────

  if (loading && cameras.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex items-center gap-3 text-[hsl(var(--text-secondary))]">
          <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
          <span className="text-sm font-medium">Loading cameras…</span>
        </div>
      </div>
    );
  }

  if (error && cameras.length === 0) {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <div className="flex items-center gap-3 text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/20 px-5 py-4 rounded-xl">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <div>
            <p className="font-medium">Failed to load cameras</p>
            <p className="text-sm opacity-80 mt-0.5">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[hsl(var(--bg-page))] text-[hsl(var(--text-primary))]">
      {/* ── Requirement 4: Header Consistency (h-16) & Resource Bar ── */}
      <div className="shrink-0 h-16 px-4 sm:px-8 border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] flex items-center justify-between gap-4">
        {/* Left: Page Title */}
        <div className="flex items-center gap-3">
          <Monitor className="w-5 h-5 text-emerald-500" />
          <div>
            <h2 className="text-base font-bold text-[hsl(var(--text-primary))] flex items-center gap-2">
              Live Cameras
            </h2>
          </div>
          <span className="text-xs font-semibold text-[hsl(var(--text-secondary))] bg-[hsl(var(--bg-table-head))] border border-[hsl(var(--border))] px-2 py-0.5 rounded-md">
            {cameras.length} Total Feeds
          </span>
        </div>

        {/* Right: Resource tracker */}
        <div className="flex items-center gap-5">
          {resources && (
            <div className="hidden md:flex items-center gap-4">
              {/* CPU */}
              <ResourceMini
                label="CPU"
                icon={<Cpu className="w-3.5 h-3.5" />}
                percent={resources.cpu_percent}
              />

              {/* Memory */}
              <ResourceMini
                label="RAM"
                icon={<MemoryStick className="w-3.5 h-3.5" />}
                percent={resources.memory_percent}
              />

              {/* GPU & VRAM */}
              {resources.gpu.available && (
                <>
                  <ResourceMini
                    label="GPU"
                    icon={<Zap className="w-3.5 h-3.5" />}
                    percent={resources.gpu.utilization_percent}
                  />
                  <ResourceMini
                    label="VRAM"
                    icon={<MemoryStick className="w-3.5 h-3.5" />}
                    percent={resources.gpu.memory_percent}
                    suffix={`${resources.gpu.memory_used_mb}/${resources.gpu.memory_total_mb}MB`}
                  />
                  {resources.gpu.temperature_c > 0 && (
                    <div className="flex items-center gap-1 text-xs text-[hsl(var(--text-muted))]">
                      <Thermometer className="w-3.5 h-3.5" />
                      <span
                        className={
                          resources.gpu.temperature_c > 80
                            ? "text-red-500 font-medium"
                            : resources.gpu.temperature_c > 65
                            ? "text-amber-500 font-medium"
                            : "text-[hsl(var(--text-secondary))]"
                        }
                      >
                        {resources.gpu.temperature_c}°C
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* AI active count badge */}
          <div className="flex items-center gap-2 text-xs pl-3 border-l border-[hsl(var(--border))]">
            <Brain className="w-4 h-4 text-violet-500" />
            <span className="font-bold text-violet-600 dark:text-violet-400">
              {aiCameras.length}
            </span>
            <span className="text-[hsl(var(--text-muted))] hidden sm:inline">
              AI Tracking
            </span>
          </div>

          <button
            onClick={refetch}
            className="flex items-center gap-1.5 text-xs font-medium text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] bg-[hsl(var(--bg-table-head))] hover:bg-[hsl(var(--bg-input))] border border-[hsl(var(--border))] px-3 py-1.5 rounded-lg transition-colors"
            title="Refresh Feeds"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {/* ── Main Dual Panel Split View ─────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* ── PANEL A: CCTV MONITORING ─────────────────────────────────── */}
        <div
          className="h-full overflow-hidden flex flex-col transition-[width] duration-300 ease-in-out relative bg-[hsl(var(--bg-page))]"
          style={{ width: widths.cctv, minWidth: isCCTVCollapsed ? "48px" : "220px" }}
          onDragOver={(e) => handleDragOver(e, "cctv")}
          onDragLeave={(e) => handleDragLeave(e, "cctv")}
          onDrop={(e) => handleDrop(e, "cctv")}
        >
          {/* Collapsed CCTV strip */}
          <button
            onClick={() => setActivePanel("cctv")}
            className={`h-full w-full flex flex-col items-center justify-between py-6 bg-[hsl(var(--bg-card))] hover:bg-[hsl(var(--bg-table-head))] border-r border-[hsl(var(--border))] transition-colors cursor-pointer group ${visuallyCCTVCollapsed ? "" : "hidden"}`}
            title="Expand CCTV Monitoring"
          >
            {/* Requirement 2: Differentiated Expand Button with Blue Accent */}
            <div className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 flex items-center justify-center group-hover:scale-105 transition-transform">
              <ChevronRight className="w-4 h-4" />
            </div>
            <div className="flex flex-col items-center gap-2">
              <Video className="w-5 h-5 text-blue-500" />
              <span className="text-xs font-bold uppercase tracking-widest text-[hsl(var(--text-secondary))] [writing-mode:vertical-lr] rotate-180">
                CCTV Monitoring
              </span>
            </div>
            <span className="text-xs font-bold text-blue-600 dark:text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded-md">
              {cctvCameras.length}
            </span>
          </button>

          {/* Expanded CCTV Panel */}
          <div className={`flex-1 flex flex-col overflow-hidden ${visuallyCCTVCollapsed ? "hidden" : ""}`}>
            <div className="shrink-0 h-16 px-4 sm:px-6 flex items-center justify-between bg-[hsl(var(--bg-card))] border-b border-[hsl(var(--border))] relative">
              <div className="flex items-center gap-3 min-w-0 flex-1 mr-4 lg:max-w-[35%] xl:max-w-[45%]">
                <div className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 flex items-center justify-center shrink-0">
                  <Video className="w-4 h-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-bold text-[hsl(var(--text-primary))] truncate whitespace-nowrap">
                    CCTV Monitoring
                  </h3>
                  <p className="text-[11px] text-[hsl(var(--text-muted))] truncate whitespace-nowrap">
                    Raw live video feeds without AI inference
                  </p>
                </div>
                <span className="text-xs font-bold text-blue-600 dark:text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded-md ml-1 shrink-0">
                  {cctvCameras.length}
                </span>
              </div>

              {/* Drag & Drop Hint in Panel Header — centered absolutely and collapses on drag */}
              <div className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 hidden lg:flex items-center gap-1.5 rounded-full bg-[hsl(var(--bg-table-head))] text-[11px] text-[hsl(var(--text-muted))] transition-all duration-300 ease-in-out ${
                isDragging
                  ? "scale-0 opacity-0 pointer-events-none max-w-0 px-0 py-0 border-0 overflow-hidden"
                  : "scale-100 opacity-100 px-3 py-1 border border-[hsl(var(--border))] max-w-[400px]"
              }`}>
                <GripVertical className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                <span className="truncate whitespace-nowrap">Drag feeds across panels to switch monitoring modes</span>
              </div>

              {/* Requirement 3: Per-Panel Independent Grid Selector */}
              <div className="flex items-center gap-1 bg-[hsl(var(--bg-table-head))] rounded-lg p-1 border border-[hsl(var(--border))]">
                {(Object.keys(GRID_LABELS) as GridMode[]).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setCctvGridMode(mode)}
                    className={`px-2 py-1 text-[11px] font-medium rounded-md transition-all ${
                      cctvGridMode === mode
                        ? "bg-[hsl(var(--bg-card))] text-[hsl(var(--text-primary))] shadow-sm"
                        : "text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-secondary))]"
                    }`}
                  >
                    {GRID_LABELS[mode]}
                  </button>
                ))}
              </div>
            </div>

            {/* Panel Content Area */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6">
              {/* Drag destination drop overlay */}
              {isDragging && dragSource === "ai" && (
                <div
                  className={`mb-4 border-2 border-dashed rounded-xl p-6 flex flex-col items-center justify-center gap-2 transition-all duration-200 ${
                    dragOverPanel === "cctv"
                      ? "border-blue-500 bg-blue-500/10"
                      : "border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-card))]/50"
                  }`}
                >
                  <ArrowLeft
                    className={`w-6 h-6 ${
                      dragOverPanel === "cctv"
                        ? "text-blue-500 animate-pulse"
                        : "text-[hsl(var(--text-muted))]"
                    }`}
                  />
                  <span
                    className={`text-sm font-semibold ${
                      dragOverPanel === "cctv"
                        ? "text-blue-500"
                        : "text-[hsl(var(--text-secondary))]"
                    }`}
                  >
                    Remove from AI Analysis
                  </span>
                  <span className="text-xs text-[hsl(var(--text-muted))]">
                    Drop camera here to return to raw CCTV view
                  </span>
                </div>
              )}

              {cctvCameras.length === 0 && !isDragging ? (
                <div className="flex flex-col items-center justify-center h-full text-center py-16">
                  <div className="w-12 h-12 rounded-full bg-[hsl(var(--bg-table-head))] flex items-center justify-center mb-3">
                    <Camera className="w-6 h-6 text-[hsl(var(--text-muted))]" />
                  </div>
                  <p className="text-sm font-semibold text-[hsl(var(--text-primary))]">
                    No cameras in CCTV mode
                  </p>
                  <p className="text-xs text-[hsl(var(--text-muted))] max-w-xs mt-1">
                    All cameras are currently undergoing active AI analysis. Drag a camera here to switch back to video-only.
                  </p>
                </div>
              ) : (
                <div className={`grid gap-4 ${GRID_CLASSES[cctvGridMode]}`}>
                  {cctvCameras.map((cam) => {
                    const isBeingDragged = draggedCameraId === cam.id;
                    const isDropTarget = dragOverCardId === cam.id && dragSource === "cctv";
                    const isThisExpanded = expandedCameraId === cam.id;
                    return (
                      <div
                        key={cam.id}
                        draggable={expandedCameraId === null}
                        onDragStart={(e) => handleDragStart(e, cam.id, "cctv")}
                        onDragEnd={handleDragEnd}
                        onDragOver={(e) => handleCardDragOver(e, cam.id, "cctv")}
                        onDrop={(e) => handleCardDrop(e, cam.id, "cctv")}
                        className={`relative group/card select-none transition-all duration-200 ${
                          isThisExpanded
                            ? "cursor-default"
                            : "cursor-grab active:cursor-grabbing"
                        } ${
                          isBeingDragged
                            ? "opacity-30 scale-95 pointer-events-none"
                            : "opacity-100 animate-in fade-in duration-300"
                        }`}
                      >
                        {/* Insertion indicator — top */}
                        {isDropTarget && dragInsertBeforeRef.current && (
                          <div className="absolute -top-2 left-0 right-0 z-20 flex items-center gap-1 pointer-events-none">
                            <div className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                            <div className="flex-1 h-0.5 rounded-full bg-blue-500 shadow-[0_0_6px_rgba(59,130,246,0.8)]" />
                          </div>
                        )}
                        <CameraTile
                          camera={cam}
                          onRefresh={refetch}
                          onExpandChange={(exp) => setExpandedCameraId(exp ? cam.id : null)}
                        />
                        {/* Insertion indicator — bottom */}
                        {isDropTarget && !dragInsertBeforeRef.current && (
                          <div className="absolute -bottom-2 left-0 right-0 z-20 flex items-center gap-1 pointer-events-none">
                            <div className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                            <div className="flex-1 h-0.5 rounded-full bg-blue-500 shadow-[0_0_6px_rgba(59,130,246,0.8)]" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Panel Split Divider Line */}
        <div className="w-px bg-[hsl(var(--border))] shrink-0 relative z-10" />

        {/* ── PANEL B: AI MONITORING ─────────────────────────────────── */}
        <div
          className="h-full overflow-hidden flex flex-col transition-[width] duration-300 ease-in-out relative bg-[hsl(var(--bg-page))]"
          style={{ width: widths.ai, minWidth: isAICollapsed ? "48px" : "220px" }}
          onDragOver={(e) => handleDragOver(e, "ai")}
          onDragLeave={(e) => handleDragLeave(e, "ai")}
          onDrop={(e) => handleDrop(e, "ai")}
        >
          {/* Collapsed AI strip */}
          <button
            onClick={() => setActivePanel("ai")}
            className={`h-full w-full flex flex-col items-center justify-between py-6 bg-[hsl(var(--bg-card))] hover:bg-[hsl(var(--bg-table-head))] border-l border-[hsl(var(--border))] transition-colors cursor-pointer group ${visuallyAICollapsed ? "" : "hidden"}`}
            title="Expand AI Monitoring"
          >
            {/* Requirement 2: Differentiated Expand Button with Violet/Emerald Accent */}
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 flex items-center justify-center group-hover:scale-105 transition-transform">
              <ChevronLeft className="w-4 h-4" />
            </div>
            <div className="flex flex-col items-center gap-2">
              <Brain className="w-5 h-5 text-violet-500" />
              <span className="text-xs font-bold uppercase tracking-widest text-[hsl(var(--text-secondary))] [writing-mode:vertical-lr] rotate-180">
                AI Monitoring
              </span>
            </div>
            <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-md">
              {aiCameras.length}
            </span>
          </button>

          {/* Expanded AI Panel */}
          <div className={`flex-1 flex flex-col overflow-hidden ${visuallyAICollapsed ? "hidden" : ""}`}>
            {/* Requirement 4: Panel Header height (h-16) */}
            <div className="shrink-0 h-16 px-4 sm:px-6 flex items-center justify-between bg-[hsl(var(--bg-card))] border-b border-[hsl(var(--border))] relative">
              <div className="flex items-center gap-3 min-w-0 flex-1 mr-4 lg:max-w-[35%] xl:max-w-[45%]">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 flex items-center justify-center shrink-0">
                  <Brain className="w-4 h-4 text-violet-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-bold text-[hsl(var(--text-primary))] truncate whitespace-nowrap">
                    AI Monitoring
                  </h3>
                  <p className="text-[11px] text-[hsl(var(--text-muted))] truncate whitespace-nowrap">
                    Live people tracking, pose estimation &amp; activity detection
                  </p>
                </div>
                <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-md ml-1 shrink-0">
                  {aiCameras.length}
                </span>
              </div>

              {/* Drag & Drop Hint in Panel Header — centered absolutely and collapses on drag */}
              <div className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 hidden lg:flex items-center gap-1.5 rounded-full bg-[hsl(var(--bg-table-head))] text-[11px] text-[hsl(var(--text-muted))] transition-all duration-300 ease-in-out ${
                isDragging
                  ? "scale-0 opacity-0 pointer-events-none max-w-0 px-0 py-0 border-0 overflow-hidden"
                  : "scale-100 opacity-100 px-3 py-1 border border-[hsl(var(--border))] max-w-[400px]"
              }`}>
                <GripVertical className="w-3.5 h-3.5 text-violet-500 shrink-0" />
                <span className="truncate whitespace-nowrap">Drag feeds across panels to switch monitoring modes</span>
              </div>

              {/* Requirement 3: Per-Panel Independent Grid Selector */}
              <div className="flex items-center gap-1 bg-[hsl(var(--bg-table-head))] rounded-lg p-1 border border-[hsl(var(--border))]">
                {(Object.keys(GRID_LABELS) as GridMode[]).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setAiGridMode(mode)}
                    className={`px-2 py-1 text-[11px] font-medium rounded-md transition-all ${
                      aiGridMode === mode
                        ? "bg-[hsl(var(--bg-card))] text-[hsl(var(--text-primary))] shadow-sm"
                        : "text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-secondary))]"
                    }`}
                  >
                    {GRID_LABELS[mode]}
                  </button>
                ))}
              </div>
            </div>

            {/* Panel Content Area */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6">
              {/* Drag destination drop overlay */}
              {isDragging && dragSource === "cctv" && (
                <div
                  className={`mb-4 border-2 border-dashed rounded-xl p-6 flex flex-col items-center justify-center gap-2 transition-all duration-200 ${
                    dragOverPanel === "ai"
                      ? "border-emerald-500 bg-emerald-500/10"
                      : "border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-card))]/50"
                  }`}
                >
                  <ArrowRight
                    className={`w-6 h-6 ${
                      dragOverPanel === "ai"
                        ? "text-emerald-500 animate-pulse"
                        : "text-[hsl(var(--text-muted))]"
                    }`}
                  />
                  <span
                    className={`text-sm font-semibold ${
                      dragOverPanel === "ai"
                        ? "text-emerald-500"
                        : "text-[hsl(var(--text-secondary))]"
                    }`}
                  >
                    Drop here for AI Analysis
                  </span>
                  <span className="text-xs text-[hsl(var(--text-muted))]">
                    Enable real-time worker pose estimation and activity tracking
                  </span>
                </div>
              )}

              {aiCameras.length === 0 && !isDragging ? (
                <div className="flex flex-col items-center justify-center h-full text-center py-16">
                  <div className="w-12 h-12 rounded-full bg-[hsl(var(--bg-table-head))] flex items-center justify-center mb-3">
                    <Brain className="w-6 h-6 text-violet-500 opacity-60" />
                  </div>
                  <p className="text-sm font-semibold text-[hsl(var(--text-primary))]">
                    No cameras in AI mode
                  </p>
                  <p className="text-xs text-[hsl(var(--text-muted))] max-w-xs mt-1">
                    Drag any camera card from the CCTV panel into this view to start live pose detection and worker tracking.
                  </p>
                </div>
              ) : (
                <div className={`grid gap-4 ${GRID_CLASSES[aiGridMode]}`}>
                  {aiCameras.map((cam) => {
                    const isBeingDragged = draggedCameraId === cam.id;
                    const isDropTarget = dragOverCardId === cam.id && dragSource === "ai";
                    const isThisExpanded = expandedCameraId === cam.id;
                    return (
                      <div
                        key={cam.id}
                        draggable={expandedCameraId === null}
                        onDragStart={(e) => handleDragStart(e, cam.id, "ai")}
                        onDragEnd={handleDragEnd}
                        onDragOver={(e) => handleCardDragOver(e, cam.id, "ai")}
                        onDrop={(e) => handleCardDrop(e, cam.id, "ai")}
                        className={`relative group/card select-none transition-all duration-200 ${
                          isThisExpanded
                            ? "cursor-default"
                            : "cursor-grab active:cursor-grabbing"
                        } ${
                          isBeingDragged
                            ? "opacity-30 scale-95 pointer-events-none"
                            : "opacity-100 animate-in fade-in duration-300"
                        }`}
                      >
                        {/* Insertion indicator — top */}
                        {isDropTarget && dragInsertBeforeRef.current && (
                          <div className="absolute -top-2 left-0 right-0 z-20 flex items-center gap-1 pointer-events-none">
                            <div className="w-2 h-2 rounded-full bg-violet-500 shrink-0" />
                            <div className="flex-1 h-0.5 rounded-full bg-violet-500 shadow-[0_0_6px_rgba(139,92,246,0.8)]" />
                          </div>
                        )}
                        <AICameraTile
                          camera={cam}
                          onRefresh={refetch}
                          onExpandChange={(exp) => setExpandedCameraId(exp ? cam.id : null)}
                        />
                        {/* Insertion indicator — bottom */}
                        {isDropTarget && !dragInsertBeforeRef.current && (
                          <div className="absolute -bottom-2 left-0 right-0 z-20 flex items-center gap-1 pointer-events-none">
                            <div className="w-2 h-2 rounded-full bg-violet-500 shrink-0" />
                            <div className="flex-1 h-0.5 rounded-full bg-violet-500 shadow-[0_0_6px_rgba(139,92,246,0.8)]" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Custom drag-follow card preview ──────────────────────────── */}
      {isDragging && dragPreviewCamera && dragPosition && (
        <div
          className="fixed z-[9999] pointer-events-none select-none"
          style={{
            left: dragPosition.x + 16,
            top: dragPosition.y - 24,
            transform: "rotate(-2deg)",
          }}
        >
          <div
            className={`
              flex items-center gap-3 px-4 py-3 rounded-2xl shadow-2xl border backdrop-blur-xl
              transition-none w-56
              ${
                dragSource === "ai"
                  ? "bg-violet-950/95 border-violet-500/60 shadow-[0_8px_40px_rgba(139,92,246,0.5)]"
                  : "bg-blue-950/95 border-blue-500/60 shadow-[0_8px_40px_rgba(59,130,246,0.5)]"
              }
            `}
          >
            {/* Icon */}
            <div
              className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center ${
                dragSource === "ai"
                  ? "bg-violet-500/20 text-violet-300"
                  : "bg-blue-500/20 text-blue-300"
              }`}
            >
              {dragSource === "ai" ? (
                <Brain className="w-4 h-4" />
              ) : (
                <Video className="w-4 h-4" />
              )}
            </div>

            {/* Name + badge */}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-white truncate">
                {dragPreviewCamera.name}
              </p>
              <span
                className={`text-[10px] font-semibold uppercase tracking-wide ${
                  dragSource === "ai" ? "text-violet-400" : "text-blue-400"
                }`}
              >
                {dragSource === "ai" ? "AI Feed" : "CCTV Feed"}
              </span>
            </div>

            {/* Grip icon */}
            <GripVertical
              className={`w-4 h-4 shrink-0 ${
                dragSource === "ai" ? "text-violet-400" : "text-blue-400"
              }`}
            />
          </div>
        </div>
      )}

      {/* ── Prominent Toast Notifications ─────────────────────────────── */}
      <div className="fixed bottom-8 right-8 z-50 flex flex-col gap-3 pointer-events-none max-w-md">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-center gap-3.5 px-6 py-4 rounded-2xl shadow-2xl border-2 backdrop-blur-xl transition-all duration-300 transform animate-in slide-in-from-bottom-5 fade-in ${
              toast.type === "success"
                ? "bg-emerald-950/95 border-emerald-500 text-emerald-100 shadow-[0_0_30px_rgba(16,185,129,0.45)]"
                : toast.type === "error"
                ? "bg-red-950/95 border-red-500 text-red-100 shadow-[0_0_30px_rgba(239,68,68,0.45)]"
                : toast.type === "loading"
                ? "bg-violet-950/95 border-violet-500 text-violet-100 shadow-[0_0_30px_rgba(139,92,246,0.45)]"
                : "bg-blue-950/95 border-blue-500 text-blue-100 shadow-[0_0_30px_rgba(59,130,246,0.45)]"
            }`}
          >
            {toast.icon && (
              <span
                className={`p-2 rounded-xl text-lg ${
                  toast.type === "success"
                    ? "bg-emerald-500/20 text-emerald-400"
                    : toast.type === "error"
                    ? "bg-red-500/20 text-red-400"
                    : toast.type === "loading"
                    ? "bg-violet-500/20 text-violet-400"
                    : "bg-blue-500/20 text-blue-400"
                }`}
              >
                {toast.icon}
              </span>
            )}
            <span className="text-sm sm:text-base font-bold tracking-wide">{toast.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function ResourceMini({
  label,
  icon,
  percent,
  suffix,
}: {
  label: string;
  icon: React.ReactNode;
  percent: number;
  suffix?: string;
}) {
  const safePercent = Math.max(0, Math.min(100, percent));
  const colorClass = getResourceColor(percent);
  const bgClass = getResourceBg(percent);
  const fillClass = getResourceFill(percent);

  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className={`${colorClass}`}>{icon}</span>
      <span className="text-[hsl(var(--text-muted))] font-medium">{label}</span>
      <div className={`w-12 h-1.5 rounded-full ${bgClass} overflow-hidden`}>
        <div
          className={`h-full rounded-full ${fillClass} transition-all duration-500`}
          style={{ width: percent >= 0 ? `${safePercent}%` : "0%" }}
        />
      </div>
      <span className={`font-mono font-semibold ${colorClass}`}>
        {percent >= 0 ? `${Math.round(percent)}%` : "—"}
      </span>
      {suffix && (
        <span className="text-[hsl(var(--text-muted))] hidden lg:inline">{suffix}</span>
      )}
    </div>
  );
}
