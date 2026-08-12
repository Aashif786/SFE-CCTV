"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, Loader2, Pencil, Plus, RotateCcw, Trash2, Undo2, VideoOff } from "lucide-react";

export type PortalPoint = [number, number];
export type PortalShape = {
  id: string;
  polygon: PortalPoint[];
  enabled?: boolean;
  direction?: PortalPoint;
  minDirectionCosine?: number;
};

type Props = {
  portals: PortalShape[];
  snapshot: string | null;
  loading: boolean;
  error: boolean;
  onChange: (portals: PortalShape[]) => void;
};

const PORTAL_COLOR = "#f97316";

function portalId() {
  return `portal-${Date.now().toString(36)}`;
}

function distance(px: number, py: number, x: number, y: number, width: number, height: number) {
  return Math.hypot(px - x * width, py - y * height);
}

function containsPoint(px: number, py: number, points: PortalPoint[], width: number, height: number) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    const intersects = yi * height > py !== yj * height > py && px < ((xj - xi) * width * (py - yi * height)) / ((yj - yi) * height) + xi * width;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** An editable, camera-frame polygon editor adapted for spatial portals. */
export default function PortalPolygonEditor({ portals, snapshot, loading, error, onChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 1280, height: 720 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [points, setPoints] = useState<PortalPoint[]>([]);
  const [cursor, setCursor] = useState<PortalPoint | null>(null);
  const [nearStart, setNearStart] = useState(false);
  const [dragging, setDragging] = useState<{ id: string; index: number } | null>(null);
  const [hovered, setHovered] = useState<{ id: string; index: number } | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editName, setEditName] = useState<string>("");

  useEffect(() => {
    if (!snapshot) { imageRef.current = null; return; }
    const image = new Image();
    image.onload = () => {
      imageRef.current = image;
      setCanvasSize({ width: image.naturalWidth || 1280, height: image.naturalHeight || 720 });
    };
    image.src = snapshot;
  }, [snapshot]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const { width, height } = canvas;
    context.clearRect(0, 0, width, height);
    if (imageRef.current) context.drawImage(imageRef.current, 0, 0, width, height);
    else { context.fillStyle = "#0f172a"; context.fillRect(0, 0, width, height); }

    portals.forEach((portal) => {
      if (portal.polygon.length < 2) return;
      const selected = portal.id === selectedId;
      const color = PORTAL_COLOR;
      context.beginPath();
      portal.polygon.forEach(([x, y], index) => index ? context.lineTo(x * width, y * height) : context.moveTo(x * width, y * height));
      context.closePath();
      context.globalAlpha = selected ? 0.35 : 0.22;
      context.fillStyle = color;
      context.fill();
      context.globalAlpha = 1;
      context.strokeStyle = color;
      context.lineWidth = selected ? 3.5 : 2.5;
      context.setLineDash(selected ? [] : [6, 4]);
      context.stroke();
      context.setLineDash([]);

      const centerX = portal.polygon.reduce((total, [x]) => total + x, 0) / portal.polygon.length * width;
      const centerY = portal.polygon.reduce((total, [, y]) => total + y, 0) / portal.polygon.length * height;
      const labelText = `Portal · ${portal.id}`;
      context.font = "bold 12px Inter, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";

      const textWidth = context.measureText(labelText).width;
      const padX = 8;
      const padY = 4;
      const bgW = textWidth + padX * 2;
      const bgH = 20;

      context.fillStyle = "rgba(15, 23, 42, 0.9)";
      if (typeof context.roundRect === "function") {
        context.beginPath();
        context.roundRect(centerX - bgW / 2, centerY - bgH / 2, bgW, bgH, 4);
        context.fill();
        context.strokeStyle = color;
        context.lineWidth = 1.5;
        context.stroke();
      } else {
        context.fillRect(centerX - bgW / 2, centerY - bgH / 2, bgW, bgH);
      }

      context.fillStyle = "#ffffff";
      context.fillText(labelText, centerX, centerY);

      portal.polygon.forEach(([x, y], index) => {
        context.beginPath();
        const isHovered = hovered?.id === portal.id && hovered.index === index;
        context.arc(x * width, y * height, isHovered ? 8 : (selected ? 6 : 5), 0, Math.PI * 2);
        context.fillStyle = color;
        context.fill();
        context.strokeStyle = "#ffffff";
        context.lineWidth = 2;
        context.stroke();
      });
    });

    if (drawing && points.length) {
      const color = PORTAL_COLOR;
      context.beginPath();
      points.forEach(([x, y], index) => index ? context.lineTo(x * width, y * height) : context.moveTo(x * width, y * height));
      if (cursor) context.lineTo((nearStart && points.length >= 3 ? points[0][0] : cursor[0]) * width, (nearStart && points.length >= 3 ? points[0][1] : cursor[1]) * height);
      context.strokeStyle = nearStart ? "#22c55e" : color;
      context.lineWidth = 2.5;
      context.setLineDash([5, 3]);
      context.stroke();
      context.setLineDash([]);
      points.forEach(([x, y], index) => {
        context.beginPath();
        context.arc(x * width, y * height, index === 0 ? 8 : 5, 0, Math.PI * 2);
        context.fillStyle = index === 0 ? "#22c55e" : color;
        context.fill();
        context.strokeStyle = "#fff";
        context.lineWidth = 2;
        context.stroke();
      });
    }
  }, [portals, selectedId, hovered, drawing, points, cursor, nearStart]);

  useEffect(() => { draw(); }, [draw]);

  const finish = useCallback(() => {
    if (points.length < 3) return;
    const next: PortalShape = { id: portalId(), polygon: points, enabled: true };
    onChange([...portals, next]);
    setSelectedId(next.id);
    setPoints([]);
    setDrawing(false);
    setNearStart(false);
  }, [points, onChange, portals]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter" && drawing) finish();
      if (event.key === "Escape") { setDrawing(false); setPoints([]); setNearStart(false); }
      if (drawing && points.length && ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" || event.key === "Backspace" && (event.target as HTMLElement)?.tagName !== "INPUT")) {
        event.preventDefault();
        setPoints((current) => current.slice(0, -1));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drawing, points.length, finish]);

  const canvasPoint = (event: React.MouseEvent<HTMLCanvasElement>): PortalPoint => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return [(event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height];
  };

  const onMouseDown = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const point = canvasPoint(event);
    for (const portal of portals) for (let index = 0; index < portal.polygon.length; index++) {
      const [x, y] = portal.polygon[index];
      if (distance(point[0] * canvas.width, point[1] * canvas.height, x, y, canvas.width, canvas.height) < 12) {
        setDragging({ id: portal.id, index }); setSelectedId(portal.id); return;
      }
    }
    if (drawing) {
      if (points.length >= 3 && nearStart) { finish(); return; }
      setPoints((current) => [...current, point]);
      return;
    }
    for (const portal of portals) if (portal.polygon.length >= 3 && containsPoint(point[0] * canvas.width, point[1] * canvas.height, portal.polygon, canvas.width, canvas.height)) { setSelectedId(portal.id); return; }
    setSelectedId(null); setDrawing(true); setPoints([point]);
  };

  const onMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const point = canvasPoint(event);
    setCursor(point);
    if (dragging) {
      onChange(portals.map((portal) => portal.id !== dragging.id ? portal : { ...portal, polygon: portal.polygon.map((vertex, index) => index === dragging.index ? point : vertex) }));
      return;
    }
    if (drawing && points.length >= 3) setNearStart(distance(point[0] * canvas.width, point[1] * canvas.height, points[0][0], points[0][1], canvas.width, canvas.height) <= 16);
    else setNearStart(false);
    for (const portal of portals) for (let index = 0; index < portal.polygon.length; index++) {
      const [x, y] = portal.polygon[index];
      if (distance(point[0] * canvas.width, point[1] * canvas.height, x, y, canvas.width, canvas.height) < 12) { setHovered({ id: portal.id, index }); return; }
    }
    setHovered(null);
  };

  const deleteVertex = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const point = canvasPoint(event);
    onChange(portals.map((portal) => {
      const index = portal.polygon.findIndex(([x, y]) => distance(point[0] * canvas.width, point[1] * canvas.height, x, y, canvas.width, canvas.height) < 12);
      return index < 0 || portal.polygon.length <= 3 ? portal : { ...portal, polygon: portal.polygon.filter((_, vertexIndex) => vertexIndex !== index) };
    }));
  };

  const updateIndex = (index: number, updates: Partial<PortalShape>) => onChange(portals.map((portal, idx) => idx === index ? { ...portal, ...updates } : portal));

  const startEditing = (index: number, currentId: string) => {
    setEditingIndex(index);
    setEditName(currentId);
  };

  const commitEditing = (index: number) => {
    if (editingIndex !== index) return;
    const targetPortal = portals[index];
    if (!targetPortal) {
      setEditingIndex(null);
      return;
    }
    const formattedName = editName.trim().replace(/\s+/g, "-");
    const finalId = formattedName || targetPortal.id;
    const oldId = targetPortal.id;

    if (finalId !== oldId) {
      onChange(portals.map((portal, idx) => idx === index ? { ...portal, id: finalId } : portal));
      if (selectedId === oldId) {
        setSelectedId(finalId);
      }
    }
    setEditingIndex(null);
  };

  const duplicate = (portal: PortalShape) => {
    const copied = { ...portal, id: `${portal.id}-copy`, polygon: portal.polygon.map(([x, y]) => [Math.min(.98, x + .02), Math.min(.98, y + .02)] as PortalPoint) };
    onChange([...portals, copied]); setSelectedId(copied.id);
  };

  return <div className="flex flex-col gap-4 h-full min-h-0">
    <div className="flex items-center gap-2 flex-wrap">
      {drawing ? <><span className="text-xs text-amber-500 font-semibold animate-pulse">Click the frame to place points. Click the first point or press Enter to close.</span><button onClick={finish} disabled={points.length < 3} className="editor-primary"><Check className="w-3.5 h-3.5" /> Finish portal ({points.length})</button><button onClick={() => setPoints((current) => current.slice(0, -1))} disabled={!points.length} className="editor-secondary"><Undo2 className="w-3.5 h-3.5" /> Undo</button><button onClick={() => setPoints([])} disabled={!points.length} className="editor-secondary"><RotateCcw className="w-3.5 h-3.5" /> Clear</button><button onClick={() => { setDrawing(false); setPoints([]); }} className="editor-secondary">Cancel</button></> : <><button onClick={() => { setDrawing(true); setPoints([]); setSelectedId(null); }} className="editor-primary"><Plus className="w-3.5 h-3.5" /> New portal</button></>}
    </div>
    <div className="flex flex-col lg:flex-row gap-4 flex-1 min-h-0">
      <div className="relative flex-1 min-h-[360px] flex items-center justify-center rounded-xl overflow-hidden border border-[hsl(var(--border))] bg-[#0d1117] p-1">
        {loading && <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 text-slate-300 text-sm"><Loader2 className="w-5 h-5 animate-spin" /> Loading reference frame…</div>}
        {error && !loading && <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 text-slate-400"><VideoOff className="w-10 h-10 opacity-50" /><p className="text-sm">No recent camera frame</p></div>}
        <canvas ref={canvasRef} width={canvasSize.width} height={canvasSize.height} className="max-w-full max-h-[590px] object-contain rounded-lg shadow-lg" style={{ aspectRatio: `${canvasSize.width} / ${canvasSize.height}`, cursor: nearStart ? "pointer" : drawing ? "crosshair" : dragging ? "grabbing" : hovered ? "grab" : "default" }} onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseLeave={() => { setCursor(null); setNearStart(false); }} onMouseUp={() => setDragging(null)} onDoubleClick={deleteVertex} />
      </div>
      <div className="w-full lg:w-64 shrink-0 flex flex-col gap-2 max-h-[590px] overflow-y-auto">
        <h3 className="text-xs font-bold uppercase tracking-wider text-[hsl(var(--text-muted))]">Portals ({portals.length})</h3>
        {!portals.length && !drawing && <p className="text-xs text-[hsl(var(--text-muted))]">Create a portal boundary, then draw it on the frame.</p>}
        {portals.map((portal, index) => {
          const isSelected = selectedId === portal.id;
          const isEditing = editingIndex === index;
          return (
            <div key={`${portal.id}-${index}`} onClick={() => setSelectedId(portal.id)} className={`rounded-xl border p-3 cursor-pointer ${isSelected ? "border-emerald-500/60 bg-emerald-500/5" : "border-[hsl(var(--border))] bg-[hsl(var(--bg-input))]"}`}>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: PORTAL_COLOR }} />
                {isEditing ? (
                  <input
                    autoFocus
                    value={editName}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => setEditName(event.target.value.replace(/\s+/g, "-"))}
                    onBlur={() => commitEditing(index)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") commitEditing(index);
                      else if (event.key === "Escape") setEditingIndex(null);
                    }}
                    className="min-w-0 flex-1 text-xs font-semibold bg-transparent border-b border-emerald-500 outline-none text-[hsl(var(--text-primary))]"
                  />
                ) : (
                  <span className="min-w-0 flex-1 text-xs font-semibold truncate text-[hsl(var(--text-primary))]">{portal.id}</span>
                )}
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (isEditing) commitEditing(index);
                    else startEditing(index, portal.id);
                  }}
                  className="text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] p-1"
                  title="Edit portal name"
                >
                  <Pencil className="w-3 h-3" />
                </button>
              </div>
              {isSelected && (
                <div onClick={(event) => event.stopPropagation()} className="mt-3 space-y-2">
                  <label className="flex items-center justify-between text-xs text-[hsl(var(--text-secondary))]">
                    Enabled
                    <input type="checkbox" checked={portal.enabled !== false} onChange={(event) => updateIndex(index, { enabled: event.target.checked })} />
                  </label>
                  <p className="text-[10px] text-[hsl(var(--text-muted))]">{portal.polygon.length} vertices · drag to move · double-click a vertex to remove</p>
                  <div className="flex gap-1.5">
                    <button onClick={() => duplicate(portal)} className="editor-secondary"><Copy className="w-3 h-3" /> Duplicate</button>
                    <button onClick={() => { onChange(portals.filter((_, itemIdx) => itemIdx !== index)); if (selectedId === portal.id) setSelectedId(null); }} className="editor-danger"><Trash2 className="w-3 h-3" /> Delete</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
    <p className="text-[10px] text-center text-[hsl(var(--text-muted))]">Click to add vertices · Click the first point or press Enter to close · Ctrl/Cmd+Z or Backspace to undo · Drag vertices to reposition · Double-click a vertex to remove it</p>
    <style jsx>{`.editor-primary{display:inline-flex;align-items:center;gap:.375rem;padding:.375rem .75rem;border-radius:.5rem;background:#10b981;color:white;font-size:.75rem;font-weight:600}.editor-primary:disabled{opacity:.4}.editor-secondary{display:inline-flex;align-items:center;gap:.25rem;padding:.3rem .55rem;border-radius:.375rem;border:1px solid hsl(var(--border));background:hsl(var(--bg-card));font-size:.7rem;color:hsl(var(--text-secondary))}.editor-secondary:disabled{opacity:.4}.editor-danger{display:inline-flex;align-items:center;gap:.25rem;padding:.3rem .55rem;border-radius:.375rem;border:1px solid rgba(239,68,68,.35);font-size:.7rem;color:#ef4444}`}</style>
  </div>;
}
