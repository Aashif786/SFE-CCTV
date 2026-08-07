"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, Loader2, Pencil, Plus, RotateCcw, Trash2, Undo2, VideoOff } from "lucide-react";

export type PortalKind = "ENTRY_PORTAL" | "EXIT_PORTAL";
export type PortalPoint = [number, number];
export type PortalShape = {
  id: string;
  kind: PortalKind;
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

const colorFor = (kind: PortalKind) => kind === "ENTRY_PORTAL" ? "#22c55e" : "#f97316";
const labelFor = (kind: PortalKind) => kind === "ENTRY_PORTAL" ? "Entry" : "Exit";

function portalId(kind: PortalKind) {
  return `${kind === "ENTRY_PORTAL" ? "entry" : "exit"}-${Date.now().toString(36)}`;
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
  const [drawingKind, setDrawingKind] = useState<PortalKind>("ENTRY_PORTAL");
  const [points, setPoints] = useState<PortalPoint[]>([]);
  const [cursor, setCursor] = useState<PortalPoint | null>(null);
  const [nearStart, setNearStart] = useState(false);
  const [dragging, setDragging] = useState<{ id: string; index: number } | null>(null);
  const [hovered, setHovered] = useState<{ id: string; index: number } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

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
      const color = colorFor(portal.kind);
      context.beginPath();
      portal.polygon.forEach(([x, y], index) => index ? context.lineTo(x * width, y * height) : context.moveTo(x * width, y * height));
      context.closePath();
      context.globalAlpha = selected ? 0.28 : 0.14;
      context.fillStyle = color;
      context.fill();
      context.globalAlpha = 1;
      context.strokeStyle = color;
      context.lineWidth = selected ? 3 : 1.5;
      context.setLineDash(selected ? [] : [5, 3]);
      context.stroke();
      context.setLineDash([]);
      const centerX = portal.polygon.reduce((total, [x]) => total + x, 0) / portal.polygon.length * width;
      const centerY = portal.polygon.reduce((total, [, y]) => total + y, 0) / portal.polygon.length * height;
      context.font = "bold 12px Inter, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillStyle = "rgba(0,0,0,0.7)";
      context.fillText(`${labelFor(portal.kind)} · ${portal.id}`, centerX + 1, centerY + 1);
      context.fillStyle = color;
      context.fillText(`${labelFor(portal.kind)} · ${portal.id}`, centerX, centerY);
      portal.polygon.forEach(([x, y], index) => {
        context.beginPath();
        const isHovered = hovered?.id === portal.id && hovered.index === index;
        context.arc(x * width, y * height, isHovered ? 7 : 5, 0, Math.PI * 2);
        context.fillStyle = selected ? color : "rgba(255,255,255,0.85)";
        context.fill();
        context.strokeStyle = color;
        context.lineWidth = 2;
        context.stroke();
      });
    });

    if (drawing && points.length) {
      const color = colorFor(drawingKind);
      context.beginPath();
      points.forEach(([x, y], index) => index ? context.lineTo(x * width, y * height) : context.moveTo(x * width, y * height));
      if (cursor) context.lineTo((nearStart && points.length >= 3 ? points[0][0] : cursor[0]) * width, (nearStart && points.length >= 3 ? points[0][1] : cursor[1]) * height);
      context.strokeStyle = nearStart ? "#22c55e" : color;
      context.lineWidth = 2;
      context.setLineDash([4, 3]);
      context.stroke();
      context.setLineDash([]);
      points.forEach(([x, y], index) => {
        context.beginPath();
        context.arc(x * width, y * height, index === 0 ? 7 : 5, 0, Math.PI * 2);
        context.fillStyle = index === 0 ? "#22c55e" : color;
        context.fill();
        context.strokeStyle = "#fff";
        context.stroke();
      });
    }
  }, [portals, selectedId, hovered, drawing, points, cursor, nearStart, drawingKind]);

  useEffect(() => { draw(); }, [draw]);

  const finish = useCallback(() => {
    if (points.length < 3) return;
    const next: PortalShape = { id: portalId(drawingKind), kind: drawingKind, polygon: points, enabled: true };
    onChange([...portals, next]);
    setSelectedId(next.id);
    setPoints([]);
    setDrawing(false);
    setNearStart(false);
  }, [points, drawingKind, onChange, portals]);

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

  const update = (id: string, updates: Partial<PortalShape>) => onChange(portals.map((portal) => portal.id === id ? { ...portal, ...updates } : portal));
  const duplicate = (portal: PortalShape) => {
    const copied = { ...portal, id: `${portal.id}-copy`, polygon: portal.polygon.map(([x, y]) => [Math.min(.98, x + .02), Math.min(.98, y + .02)] as PortalPoint) };
    onChange([...portals, copied]); setSelectedId(copied.id);
  };

  return <div className="flex flex-col gap-4 h-full min-h-0">
    <div className="flex items-center gap-2 flex-wrap">
      {drawing ? <><span className="text-xs text-amber-500 font-semibold animate-pulse">Click the frame to place points. Click the first point or press Enter to close.</span><button onClick={finish} disabled={points.length < 3} className="editor-primary"><Check className="w-3.5 h-3.5" /> Finish portal ({points.length})</button><button onClick={() => setPoints((current) => current.slice(0, -1))} disabled={!points.length} className="editor-secondary"><Undo2 className="w-3.5 h-3.5" /> Undo</button><button onClick={() => setPoints([])} disabled={!points.length} className="editor-secondary"><RotateCcw className="w-3.5 h-3.5" /> Clear</button><button onClick={() => { setDrawing(false); setPoints([]); }} className="editor-secondary">Cancel</button></> : <><select value={drawingKind} onChange={(event) => setDrawingKind(event.target.value as PortalKind)} className="px-2.5 py-1.5 text-xs rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-input))]"><option value="ENTRY_PORTAL">Entry portal</option><option value="EXIT_PORTAL">Exit portal</option></select><button onClick={() => { setDrawing(true); setPoints([]); setSelectedId(null); }} className="editor-primary"><Plus className="w-3.5 h-3.5" /> New portal</button></>}
    </div>
    <div className="flex flex-col lg:flex-row gap-4 flex-1 min-h-0">
      <div className="relative flex-1 min-h-[360px] flex items-center justify-center rounded-xl overflow-hidden border border-[hsl(var(--border))] bg-[#0d1117] p-1">
        {loading && <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 text-slate-300 text-sm"><Loader2 className="w-5 h-5 animate-spin" /> Loading reference frame…</div>}
        {error && !loading && <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 text-slate-400"><VideoOff className="w-10 h-10 opacity-50" /><p className="text-sm">No recent camera frame</p></div>}
        <canvas ref={canvasRef} width={canvasSize.width} height={canvasSize.height} className="max-w-full max-h-[590px] object-contain rounded-lg shadow-lg" style={{ aspectRatio: `${canvasSize.width} / ${canvasSize.height}`, cursor: nearStart ? "pointer" : drawing ? "crosshair" : dragging ? "grabbing" : hovered ? "grab" : "default" }} onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseLeave={() => { setCursor(null); setNearStart(false); }} onMouseUp={() => setDragging(null)} onDoubleClick={deleteVertex} />
      </div>
      <div className="w-full lg:w-64 shrink-0 flex flex-col gap-2 max-h-[590px] overflow-y-auto">
        <h3 className="text-xs font-bold uppercase tracking-wider text-[hsl(var(--text-muted))]">Portals ({portals.length})</h3>
        {!portals.length && !drawing && <p className="text-xs text-[hsl(var(--text-muted))]">Create an entry or exit portal, then draw it on the frame.</p>}
        {portals.map((portal) => <div key={portal.id} onClick={() => setSelectedId(portal.id)} className={`rounded-xl border p-3 cursor-pointer ${selectedId === portal.id ? "border-emerald-500/60 bg-emerald-500/5" : "border-[hsl(var(--border))] bg-[hsl(var(--bg-input))]"}`}><div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full" style={{ backgroundColor: colorFor(portal.kind) }} />{editingId === portal.id ? <input autoFocus value={portal.id} onClick={(event) => event.stopPropagation()} onChange={(event) => update(portal.id, { id: event.target.value.replace(/\s+/g, "-") })} onBlur={() => setEditingId(null)} onKeyDown={(event) => event.key === "Enter" && setEditingId(null)} className="min-w-0 flex-1 text-xs font-semibold bg-transparent border-b outline-none" /> : <span className="min-w-0 flex-1 text-xs font-semibold truncate text-[hsl(var(--text-primary))]">{portal.id}</span>}<button onClick={(event) => { event.stopPropagation(); setEditingId(portal.id); }} className="text-[hsl(var(--text-muted))]"><Pencil className="w-3 h-3" /></button></div>{selectedId === portal.id && <div onClick={(event) => event.stopPropagation()} className="mt-3 space-y-2"><label className="block text-[10px] uppercase tracking-wider text-[hsl(var(--text-muted))]">Portal type<select value={portal.kind} onChange={(event) => update(portal.id, { kind: event.target.value as PortalKind })} className="mt-1 w-full px-2 py-1.5 text-xs rounded border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))]"><option value="ENTRY_PORTAL">Entry portal</option><option value="EXIT_PORTAL">Exit portal</option></select></label><label className="flex items-center justify-between text-xs text-[hsl(var(--text-secondary))]">Enabled<input type="checkbox" checked={portal.enabled !== false} onChange={(event) => update(portal.id, { enabled: event.target.checked })} /></label><p className="text-[10px] text-[hsl(var(--text-muted))]">{portal.polygon.length} vertices · drag to move · double-click a vertex to remove</p><div className="flex gap-1.5"><button onClick={() => duplicate(portal)} className="editor-secondary"><Copy className="w-3 h-3" /> Duplicate</button><button onClick={() => { onChange(portals.filter((item) => item.id !== portal.id)); setSelectedId(null); }} className="editor-danger"><Trash2 className="w-3 h-3" /> Delete</button></div></div>}</div>)}
      </div>
    </div>
    <p className="text-[10px] text-center text-[hsl(var(--text-muted))]">Click to add vertices · Click the first point or press Enter to close · Ctrl/Cmd+Z or Backspace to undo · Drag vertices to reposition · Double-click a vertex to remove it</p>
    <style jsx>{`.editor-primary{display:inline-flex;align-items:center;gap:.375rem;padding:.375rem .75rem;border-radius:.5rem;background:#10b981;color:white;font-size:.75rem;font-weight:600}.editor-primary:disabled{opacity:.4}.editor-secondary{display:inline-flex;align-items:center;gap:.25rem;padding:.3rem .55rem;border-radius:.375rem;border:1px solid hsl(var(--border));background:hsl(var(--bg-card));font-size:.7rem;color:hsl(var(--text-secondary))}.editor-secondary:disabled{opacity:.4}.editor-danger{display:inline-flex;align-items:center;gap:.25rem;padding:.3rem .55rem;border-radius:.375rem;border:1px solid rgba(239,68,68,.35);font-size:.7rem;color:#ef4444}`}</style>
  </div>;
}
