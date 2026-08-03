"use client";

/**
 * PolygonZoneEditor
 * 
 * Full-featured canvas-based polygon editor for configuring per-camera zones.
 * 
 * Features:
 *  - Loads live camera snapshot as canvas background
 *  - Click to add vertices to the current polygon
 *  - Drag vertices to move them
 *  - Double-click a vertex to delete it
 *  - Click "Finish Zone" or press Enter to save the current polygon
 *  - Click a polygon interior to select it
 *  - Inline rename, color picker, zone type dropdown
 *  - Duplicate and delete per zone
 *  - Saves all zones to backend via upsert API
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Plus,
  Save,
  Trash2,
  Copy,
  Check,
  Loader2,
  CameraOff,
  Pencil,
  ChevronDown,
} from "lucide-react";

const API = "http://localhost:8000";

// ── Types ────────────────────────────────────────────────────────────────────

interface Vertex {
  x: number; // 0.0 – 1.0 (normalised)
  y: number;
}

interface Zone {
  id: string;
  name: string;
  color: string;
  zone_type: string;
  points: Vertex[];
  enabled: boolean;
}

const ZONE_TYPES = [
  { id: "general",      label: "General" },
  { id: "workstation",  label: "Workstation" },
  { id: "meeting_room", label: "Meeting Room" },
  { id: "walkway",      label: "Walkway" },
  { id: "restricted",   label: "Restricted Area" },
  { id: "storage",      label: "Storage Area" },
];

const PALETTE = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444",
  "#8b5cf6", "#06b6d4", "#f97316", "#ec4899",
  "#84cc16", "#6366f1",
];

function uid() {
  return `zone_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ── Hit-test helpers ─────────────────────────────────────────────────────────

function distToPoint(px: number, py: number, vx: number, vy: number, cw: number, ch: number) {
  return Math.hypot(px - vx * cw, py - vy * ch);
}

function pointInPolygon(px: number, py: number, pts: Vertex[], cw: number, ch: number) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x * cw, yi = pts[i].y * ch;
    const xj = pts[j].x * cw, yj = pts[j].y * ch;
    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// ── Main Component ───────────────────────────────────────────────────────────

interface Props {
  cameraId: string;
  onSave?: () => void;
}

export default function PolygonZoneEditor({ cameraId, onSave }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bgImageRef = useRef<HTMLImageElement | null>(null);
  const animRef = useRef<number>(0);

  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(true);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);

  const [zones, setZones] = useState<Zone[]>([]);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);          // actively placing vertices
  const [currentPoly, setCurrentPoly] = useState<Vertex[]>([]);

  const [dragging, setDragging] = useState<{ zoneId: string; vertexIdx: number } | null>(null);
  const [hoverVertex, setHoverVertex] = useState<{ zoneId: string; vertexIdx: number } | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "error">("idle");

  const [editingNameId, setEditingNameId] = useState<string | null>(null);

  // ── Load snapshot ──────────────────────────────────────────────────────────

  useEffect(() => {
    setSnapshotLoading(true);
    setSnapshotError(null);
    fetch(`${API}/api/cameras/${cameraId}/snapshot?format=json`)
      .then(r => {
        if (!r.ok) throw new Error(`Camera ${cameraId} offline or no frame available`);
        return r.json();
      })
      .then(data => setSnapshot(data.image))
      .catch(e => setSnapshotError(e.message))
      .finally(() => setSnapshotLoading(false));
  }, [cameraId]);

  // ── Load existing zones ────────────────────────────────────────────────────

  useEffect(() => {
    fetch(`${API}/api/camera-zones/${cameraId}`)
      .then(r => r.json())
      .then(data => {
        const loaded: Zone[] = (data.zones ?? []).map((z: any) => ({
          id: z.id,
          name: z.name,
          color: z.color ?? "#3b82f6",
          zone_type: z.zone_type ?? "general",
          points: (z.points ?? []).map(([x, y]: [number, number]) => ({ x, y })),
          enabled: z.enabled ?? true,
        }));
        setZones(loaded);
      })
      .catch(() => {});
  }, [cameraId]);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Enter" && drawing && currentPoly.length >= 3) {
        finishCurrentPolygon();
      }
      if (e.key === "Escape") {
        setDrawing(false);
        setCurrentPoly([]);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  // ── Draw loop ──────────────────────────────────────────────────────────────

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background image
    if (bgImageRef.current) {
      ctx.drawImage(bgImageRef.current, 0, 0, canvas.width, canvas.height);
    } else {
      ctx.fillStyle = "#111827";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    const W = canvas.width;
    const H = canvas.height;

    // Draw saved zones
    zones.forEach(zone => {
      if (zone.points.length < 2) return;
      const isSelected = zone.id === selectedZoneId;

      ctx.beginPath();
      zone.points.forEach((pt, i) => {
        const x = pt.x * W, y = pt.y * H;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();

      // Fill
      ctx.globalAlpha = isSelected ? 0.22 : 0.12;
      ctx.fillStyle = zone.color;
      ctx.fill();
      ctx.globalAlpha = 1;

      // Stroke
      ctx.strokeStyle = zone.color;
      ctx.lineWidth = isSelected ? 2.5 : 1.5;
      ctx.setLineDash(isSelected ? [] : [5, 3]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Label (centroid)
      const cx = zone.points.reduce((s, p) => s + p.x, 0) / zone.points.length * W;
      const cy = zone.points.reduce((s, p) => s + p.y, 0) / zone.points.length * H;
      ctx.font = "bold 12px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(0,0,0,0.65)";
      ctx.fillText(zone.name, cx + 1, cy + 1);
      ctx.fillStyle = zone.color;
      ctx.fillText(zone.name, cx, cy);

      // Vertices
      zone.points.forEach((pt, vi) => {
        const x = pt.x * W, y = pt.y * H;
        const isHovered = hoverVertex?.zoneId === zone.id && hoverVertex?.vertexIdx === vi;
        ctx.beginPath();
        ctx.arc(x, y, isHovered ? 7 : 5, 0, Math.PI * 2);
        ctx.fillStyle = isSelected ? zone.color : "rgba(255,255,255,0.7)";
        ctx.fill();
        ctx.strokeStyle = zone.color;
        ctx.lineWidth = 2;
        ctx.stroke();
      });
    });

    // Draw in-progress polygon
    if (drawing && currentPoly.length > 0) {
      ctx.beginPath();
      currentPoly.forEach((pt, i) => {
        const x = pt.x * W, y = pt.y * H;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Vertices for in-progress polygon
      currentPoly.forEach((pt, i) => {
        const x = pt.x * W, y = pt.y * H;
        ctx.beginPath();
        ctx.arc(x, y, i === 0 ? 7 : 5, 0, Math.PI * 2);
        ctx.fillStyle = i === 0 ? "#10b981" : "#ffffff";
        ctx.fill();
        ctx.strokeStyle = "#000";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      });
    }

    animRef.current = requestAnimationFrame(draw);
  }, [zones, selectedZoneId, drawing, currentPoly, hoverVertex]);

  useEffect(() => {
    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [draw]);

  const [canvasDims, setCanvasDims] = useState<{ width: number; height: number }>({ width: 1280, height: 720 });

  // ── Load background image ─────────────────────────────────────────────────

  useEffect(() => {
    if (!snapshot) { bgImageRef.current = null; return; }
    const img = new Image();
    img.onload = () => {
      bgImageRef.current = img;
      if (img.naturalWidth && img.naturalHeight) {
        setCanvasDims({ width: img.naturalWidth, height: img.naturalHeight });
      }
    };
    img.src = snapshot;
  }, [snapshot]);

  // ── Canvas event handlers ─────────────────────────────────────────────────

  const getCanvasPoint = (e: React.MouseEvent<HTMLCanvasElement>): Vertex => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
  };

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const W = canvasRef.current!.width;
    const H = canvasRef.current!.height;
    const pt = getCanvasPoint(e);

    // Check if clicking on an existing vertex (drag start)
    for (const zone of zones) {
      for (let vi = 0; vi < zone.points.length; vi++) {
        const v = zone.points[vi];
        if (distToPoint(pt.x * W, pt.y * H, v.x, v.y, W, H) < 12) {
          setDragging({ zoneId: zone.id, vertexIdx: vi });
          setSelectedZoneId(zone.id);
          return;
        }
      }
    }

    if (drawing) {
      // Add vertex to current polygon
      setCurrentPoly(prev => [...prev, pt]);
      return;
    }

    // Click on zone interior to select it
    for (const zone of zones) {
      if (zone.points.length >= 3 && pointInPolygon(pt.x * W, pt.y * H, zone.points, W, H)) {
        setSelectedZoneId(zone.id);
        return;
      }
    }

    // Clicked on empty space — auto-start drawing a new zone
    setSelectedZoneId(null);
    setDrawing(true);
    setCurrentPoly([pt]);
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const W = canvasRef.current!.width;
    const H = canvasRef.current!.height;
    const pt = getCanvasPoint(e);

    if (dragging) {
      setZones(prev =>
        prev.map(z =>
          z.id === dragging.zoneId
            ? {
                ...z,
                points: z.points.map((v, i) =>
                  i === dragging.vertexIdx ? pt : v
                ),
              }
            : z
        )
      );
      return;
    }

    // Hover detection
    for (const zone of zones) {
      for (let vi = 0; vi < zone.points.length; vi++) {
        const v = zone.points[vi];
        if (distToPoint(pt.x * W, pt.y * H, v.x, v.y, W, H) < 12) {
          setHoverVertex({ zoneId: zone.id, vertexIdx: vi });
          return;
        }
      }
    }
    setHoverVertex(null);
  };

  const handleCanvasMouseUp = () => { setDragging(null); };

  const handleCanvasDblClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const W = canvasRef.current!.width;
    const H = canvasRef.current!.height;
    const pt = getCanvasPoint(e);

    // Delete vertex on double-click
    setZones(prev =>
      prev.map(zone => {
        const hitIdx = zone.points.findIndex(
          v => distToPoint(pt.x * W, pt.y * H, v.x, v.y, W, H) < 12
        );
        if (hitIdx === -1) return zone;
        if (zone.points.length <= 3) return zone; // keep minimum 3
        return { ...zone, points: zone.points.filter((_, i) => i !== hitIdx) };
      })
    );
  };

  // ── Zone management actions ───────────────────────────────────────────────

  const startNewZone = () => {
    setDrawing(true);
    setCurrentPoly([]);
    setSelectedZoneId(null);
  };

  const finishCurrentPolygon = () => {
    if (currentPoly.length < 3) return;
    const nextColorIdx = zones.length % PALETTE.length;
    const newZone: Zone = {
      id: uid(),
      name: `Zone ${zones.length + 1}`,
      color: PALETTE[nextColorIdx],
      zone_type: "general",
      points: currentPoly,
      enabled: true,
    };
    setZones(prev => [...prev, newZone]);
    setSelectedZoneId(newZone.id);
    setCurrentPoly([]);
    setDrawing(false);
  };

  const deleteZone = (id: string) => {
    setZones(prev => prev.filter(z => z.id !== id));
    if (selectedZoneId === id) setSelectedZoneId(null);
  };

  const duplicateZone = (id: string) => {
    const src = zones.find(z => z.id === id);
    if (!src) return;
    const dup: Zone = {
      ...src,
      id: uid(),
      name: `${src.name} (Copy)`,
      points: src.points.map(p => ({ x: p.x + 0.02, y: p.y + 0.02 })),
    };
    setZones(prev => [...prev, dup]);
    setSelectedZoneId(dup.id);
  };

  const updateZoneField = (id: string, field: keyof Zone, value: string | boolean) => {
    setZones(prev =>
      prev.map(z => (z.id === id ? { ...z, [field]: value } : z))
    );
  };

  // ── Save all zones to backend ─────────────────────────────────────────────

  const handleSave = async () => {
    setSaving(true);
    setSaveStatus("idle");
    try {
      // Delete all existing zones first by clearing them, then upsert each
      await fetch(`${API}/api/camera-zones/${cameraId}`, { method: "DELETE" });

      for (const zone of zones) {
        const res = await fetch(`${API}/api/camera-zones/${cameraId}/zone`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            zone_id: zone.id,
            name: zone.name,
            color: zone.color,
            zone_type: zone.zone_type,
            points: zone.points.map(p => [p.x, p.y]),
            enabled: zone.enabled,
          }),
        });
        if (!res.ok) throw new Error(`Failed to save zone ${zone.name}`);
      }
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 3000);
      onSave?.();
    } catch (err: any) {
      console.error(err);
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 4000);
    } finally {
      setSaving(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const selectedZone = zones.find(z => z.id === selectedZoneId);

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Top toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        {drawing ? (
          <>
            <span className="text-xs text-amber-400 font-medium animate-pulse">
              🖊️ Click on the image to place vertices. Press <kbd className="px-1 py-0.5 rounded bg-white/10 text-xs">Enter</kbd> or
            </span>
            <button
              onClick={finishCurrentPolygon}
              disabled={currentPoly.length < 3}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 text-white text-xs font-semibold hover:bg-emerald-400 disabled:opacity-40 transition-all"
            >
              <Check className="w-3 h-3" /> Finish Zone ({currentPoly.length} pts)
            </button>
            <button
              onClick={() => { setDrawing(false); setCurrentPoly([]); }}
              className="px-3 py-1.5 rounded-lg border border-[hsl(var(--border))] text-xs text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] transition-all"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            onClick={startNewZone}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500 text-white text-xs font-semibold hover:bg-blue-400 transition-all"
          >
            <Plus className="w-3 h-3" /> New Zone
          </button>
        )}

        <div className="ml-auto flex items-center gap-2">
          {saveStatus === "saved" && (
            <span className="flex items-center gap-1 text-xs text-emerald-400 font-semibold">
              <Check className="w-3 h-3" /> Saved
            </span>
          )}
          {saveStatus === "error" && (
            <span className="text-xs text-red-400 font-semibold">Save failed</span>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-emerald-500 text-white text-xs font-semibold hover:bg-emerald-400 disabled:opacity-50 transition-all"
          >
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
            Save All Zones
          </button>
        </div>
      </div>

      {/* Main layout: canvas + side panel */}
      <div className="flex gap-4 flex-1 min-h-0">

        {/* Canvas */}
        <div className="relative flex-1 flex items-center justify-center rounded-xl overflow-hidden border border-[hsl(var(--border))] bg-[#0d1117] min-h-0 p-1">
          {snapshotLoading && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 text-[hsl(var(--text-muted))] text-sm">
              <Loader2 className="w-5 h-5 animate-spin text-blue-500" /> Loading snapshot…
            </div>
          )}
          {snapshotError && !snapshotLoading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[hsl(var(--text-muted))]">
              <CameraOff className="w-10 h-10 opacity-40" />
              <p className="text-sm">{snapshotError}</p>
              <p className="text-xs opacity-60">You can still draw zones; they&apos;ll be saved correctly.</p>
            </div>
          )}
          <canvas
            ref={canvasRef}
            width={canvasDims.width}
            height={canvasDims.height}
            className="max-w-full max-h-full object-contain rounded-lg shadow-lg"
            style={{
              aspectRatio: `${canvasDims.width} / ${canvasDims.height}`,
              cursor: drawing ? "crosshair" : dragging ? "grabbing" : hoverVertex ? "grab" : "default",
            }}
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={handleCanvasMouseMove}
            onMouseUp={handleCanvasMouseUp}
            onDoubleClick={handleCanvasDblClick}
          />
        </div>

        {/* Side Panel */}
        <div className="w-64 flex-shrink-0 flex flex-col gap-3 overflow-y-auto">
          <h4 className="text-xs font-semibold text-[hsl(var(--text-muted))] uppercase tracking-wider">
            Zones ({zones.length})
          </h4>

          {zones.length === 0 && !drawing && (
            <p className="text-xs text-[hsl(var(--text-muted))] leading-relaxed">
              No zones yet. Click &quot;New Zone&quot; and draw on the image.
            </p>
          )}

          {zones.map(zone => (
            <div
              key={zone.id}
              onClick={() => setSelectedZoneId(zone.id)}
              className={`rounded-xl border p-3 cursor-pointer transition-all ${
                selectedZoneId === zone.id
                  ? "border-blue-500/60 bg-blue-500/5"
                  : "border-[hsl(var(--border))] hover:border-[hsl(var(--border-strong))] bg-[hsl(var(--bg-input))]"
              }`}
            >
              {/* Zone header: color dot + name */}
              <div className="flex items-center gap-2 mb-2">
                <div
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{ backgroundColor: zone.color }}
                />
                {editingNameId === zone.id ? (
                  <input
                    autoFocus
                    className="flex-1 text-xs font-semibold bg-transparent border-b border-[hsl(var(--border-strong))] outline-none text-[hsl(var(--text-primary))]"
                    value={zone.name}
                    onChange={e => updateZoneField(zone.id, "name", e.target.value)}
                    onBlur={() => setEditingNameId(null)}
                    onKeyDown={e => e.key === "Enter" && setEditingNameId(null)}
                  />
                ) : (
                  <span className="flex-1 text-xs font-semibold text-[hsl(var(--text-primary))] truncate">
                    {zone.name}
                  </span>
                )}
                <button
                  onClick={e => { e.stopPropagation(); setEditingNameId(zone.id); }}
                  className="text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] transition-colors"
                >
                  <Pencil className="w-3 h-3" />
                </button>
              </div>

              {/* Only show detailed controls for selected zone */}
              {selectedZoneId === zone.id && (
                <div className="space-y-2 mt-2" onClick={e => e.stopPropagation()}>
                  {/* Color picker */}
                  <div>
                    <label className="text-[10px] text-[hsl(var(--text-muted))] uppercase tracking-wider">Color</label>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {PALETTE.map(c => (
                        <button
                          key={c}
                          onClick={() => updateZoneField(zone.id, "color", c)}
                          className="w-5 h-5 rounded-full border-2 transition-all"
                          style={{
                            backgroundColor: c,
                            borderColor: zone.color === c ? "#fff" : "transparent",
                          }}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Zone type */}
                  <div>
                    <label className="text-[10px] text-[hsl(var(--text-muted))] uppercase tracking-wider">Zone Type</label>
                    <select
                      value={zone.zone_type}
                      onChange={e => updateZoneField(zone.id, "zone_type", e.target.value)}
                      className="w-full mt-1 text-xs bg-[hsl(var(--bg-card))] border border-[hsl(var(--border-strong))] rounded-md px-2 py-1 text-[hsl(var(--text-primary))] focus:outline-none focus:border-blue-500"
                    >
                      {ZONE_TYPES.map(t => (
                        <option key={t.id} value={t.id}>{t.label}</option>
                      ))}
                    </select>
                  </div>

                  {/* Vertex count */}
                  <p className="text-[10px] text-[hsl(var(--text-muted))]">
                    {zone.points.length} vertices · Dbl-click vertex to delete
                  </p>

                  {/* Zone actions */}
                  <div className="flex gap-1.5 pt-1">
                    <button
                      onClick={() => duplicateZone(zone.id)}
                      className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] border border-[hsl(var(--border))] hover:border-[hsl(var(--border-strong))] transition-all"
                    >
                      <Copy className="w-3 h-3" /> Duplicate
                    </button>
                    <button
                      onClick={() => deleteZone(zone.id)}
                      className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] text-red-400 hover:text-red-300 border border-red-500/20 hover:border-red-500/50 transition-all"
                    >
                      <Trash2 className="w-3 h-3" /> Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Help footer */}
      <p className="text-[10px] text-[hsl(var(--text-muted))] text-center">
        Click to add vertices · Drag vertices to reposition · Double-click to delete a vertex · Press Esc to cancel drawing
      </p>
    </div>
  );
}
