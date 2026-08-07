"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, CircleDot, DoorOpen, Loader2, Network, RefreshCw, Save, Trash2 } from "lucide-react";
import { useCameras, type CameraInfo } from "@/hooks/useCameras";
import PortalPolygonEditor, { type PortalShape } from "@/components/cameras/PortalPolygonEditor";

type Connection = { id: string; exitPortal: string; entryPortal: string; minTransitSeconds: number; maxTransitSeconds: number; minSimilarity?: number };
type Facility = { id: string; cameras: { id: string; portals: PortalShape[] }[]; connections: Connection[] };
type Layout = { facilities: Facility[] };

const apiBase = () => typeof window === "undefined" ? "http://localhost:8000" : `http://${window.location.hostname}:8000`;

export default function PortalMappingPage() {
  const { cameras, loading: camerasLoading } = useCameras();
  const [layout, setLayout] = useState<Layout>({ facilities: [] });
  const [facilityId, setFacilityId] = useState("main-facility");
  const [cameraId, setCameraId] = useState<string | null>(null);
  const [frame, setFrame] = useState<string | null>(null);
  const [frameLoading, setFrameLoading] = useState(false);
  const [frameError, setFrameError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  const [route, setRoute] = useState({ exitPortal: "", entryPortal: "", minTransitSeconds: 3, maxTransitSeconds: 20 });

  const facility = useMemo(() => layout.facilities.find((item) => item.id === facilityId) ?? { id: facilityId, cameras: [], connections: [] }, [layout, facilityId]);
  const selectedCamera = cameras.find((camera) => String(camera.id) === cameraId);
  const selectedPortals = facility.cameras.find((camera) => camera.id === cameraId)?.portals ?? [];
  const allPortals = useMemo(() => facility.cameras.flatMap((camera) => camera.portals.map((portal) => ({ cameraId: camera.id, portal, key: `${camera.id}:${portal.id}` }))), [facility]);
  const exits = allPortals.filter((item) => item.portal.kind === "EXIT_PORTAL");
  const entries = allPortals.filter((item) => item.portal.kind === "ENTRY_PORTAL");

  const loadLayout = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`${apiBase()}/api/spatial-handoff/configuration`);
      if (!response.ok) throw new Error(`Server returned ${response.status}`);
      const data = await response.json() as Layout;
      setLayout({ facilities: data.facilities ?? [] });
      if (data.facilities?.[0]?.id) setFacilityId(data.facilities[0].id);
      setNotice(null);
    } catch (error: any) {
      setNotice({ error: true, text: `Could not load portal layout: ${error.message}` });
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadLayout(); }, [loadLayout]);
  useEffect(() => { if (!cameraId && cameras.length) setCameraId(String(cameras[0].id)); }, [cameraId, cameras]);
  useEffect(() => {
    if (!cameraId) return;
    let cancelled = false;
    setFrame(null); setFrameLoading(true); setFrameError(false);
    fetch(`${apiBase()}/api/cameras/${cameraId}/snapshot?format=json`)
      .then((response) => { if (!response.ok) throw new Error(); return response.json(); })
      .then((data) => { if (!cancelled) setFrame(data.image); })
      .catch(() => { if (!cancelled) setFrameError(true); })
      .finally(() => { if (!cancelled) setFrameLoading(false); });
    return () => { cancelled = true; };
  }, [cameraId]);

  const replaceFacility = (update: (current: Facility) => Facility) => setLayout((current) => {
    const existing = current.facilities.find((item) => item.id === facilityId);
    const next = update(existing ?? { id: facilityId, cameras: [], connections: [] });
    return { facilities: existing ? current.facilities.map((item) => item.id === facilityId ? next : item) : [...current.facilities, next] };
  });

  const updatePortals = (portals: PortalShape[]) => {
    if (!cameraId) return;
    replaceFacility((current) => {
      const cameraLayouts = current.cameras.some((camera) => camera.id === cameraId)
        ? current.cameras.map((camera) => camera.id === cameraId ? { ...camera, portals } : camera)
        : [...current.cameras, { id: cameraId, portals }];
      const types = new Map(cameraLayouts.flatMap((camera) => camera.portals.map((portal) => [`${camera.id}:${portal.id}`, portal.kind] as const)));
      return { ...current, cameras: cameraLayouts, connections: current.connections.filter((connection) => types.get(connection.exitPortal) === "EXIT_PORTAL" && types.get(connection.entryPortal) === "ENTRY_PORTAL") };
    });
  };

  const addRoute = () => {
    if (!route.exitPortal || !route.entryPortal || route.exitPortal === route.entryPortal) return setNotice({ error: true, text: "Choose two different portals: an exit and an entry." });
    if (route.minTransitSeconds < 0 || route.maxTransitSeconds < route.minTransitSeconds) return setNotice({ error: true, text: "The maximum transit time must be at least the minimum." });
    replaceFacility((current) => ({ ...current, connections: [...current.connections, { ...route, id: `route-${Date.now().toString(36)}`, minSimilarity: .72 }] }));
    setRoute((current) => ({ ...current, exitPortal: "", entryPortal: "" }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const response = await fetch(`${apiBase()}/api/spatial-handoff/configuration`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(layout) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail ?? `Server returned ${response.status}`);
      setLayout(data); setNotice({ error: false, text: "Portal layout saved. New handoffs are active." });
    } catch (error: any) { setNotice({ error: true, text: `Could not save layout: ${error.message}` }); }
    finally { setSaving(false); }
  };

  return <div className="p-5 sm:p-8 max-w-[1700px] mx-auto space-y-5">
    <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4"><div><div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-xs font-bold uppercase tracking-widest"><Network className="w-4 h-4" /> Spatial handoff</div><h1 className="mt-1 text-2xl font-bold text-[hsl(var(--text-primary))]">Portal Mapping</h1><p className="mt-1 text-sm text-[hsl(var(--text-muted))]">Draw editable entry and exit portals on a camera reference frame, then create handoff routes.</p></div><div className="flex flex-wrap items-center gap-2"><label className="text-xs font-semibold text-[hsl(var(--text-secondary))]">Facility</label><input value={facilityId} onChange={(event) => setFacilityId(event.target.value)} className="w-40 px-3 py-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] text-sm" /><button onClick={loadLayout} disabled={loading} className="p-2 rounded-lg border border-[hsl(var(--border))] hover:bg-[hsl(var(--bg-table-head))]" title="Reload saved configuration"><RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /></button><button onClick={save} disabled={saving || loading} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-semibold"><Save className="w-4 h-4" />{saving ? "Saving…" : "Save mapping"}</button></div></div>
    {notice && <div className={`rounded-xl border px-4 py-3 text-sm flex items-center gap-2 ${notice.error ? "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300" : "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"}`}><CircleDot className="w-4 h-4 shrink-0" />{notice.text}</div>}
    <div className="grid grid-cols-1 xl:grid-cols-[240px_minmax(0,1fr)_330px] gap-5 items-start">
      <section className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] overflow-hidden"><div className="px-4 py-3 border-b border-[hsl(var(--border))]"><h2 className="font-bold text-sm text-[hsl(var(--text-primary))]">Cameras</h2><p className="text-xs text-[hsl(var(--text-muted))] mt-0.5">Pick the frame to configure.</p></div><div className="p-2 max-h-[660px] overflow-y-auto">{camerasLoading ? <p className="p-4 text-sm text-[hsl(var(--text-muted))]"><Loader2 className="w-4 h-4 inline animate-spin mr-2" />Loading cameras</p> : cameras.map((camera) => { const active = cameraId === String(camera.id); const count = facility.cameras.find((item) => item.id === String(camera.id))?.portals.length ?? 0; return <button key={camera.id} onClick={() => setCameraId(String(camera.id))} className={`w-full text-left p-3 rounded-lg mb-1 ${active ? "bg-emerald-500/10 border border-emerald-500/25" : "hover:bg-[hsl(var(--bg-table-head))] border border-transparent"}`}><div className="flex items-center gap-2"><DoorOpen className={`w-4 h-4 ${active ? "text-emerald-500" : "text-[hsl(var(--text-muted))]"}`} /><span className="font-semibold text-sm text-[hsl(var(--text-primary))] truncate">{camera.name}</span></div><div className="pl-6 mt-1 text-xs text-[hsl(var(--text-muted))]">ID {camera.id} · {count} portals</div></button>; })}</div></section>
      <section className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] p-4 min-h-[660px]"><h2 className="font-bold text-sm text-[hsl(var(--text-primary))] mb-1">{selectedCamera?.name ?? "Select a camera"}</h2><p className="text-xs text-[hsl(var(--text-muted))] mb-4">Portal polygons remain editable until you save the mapping.</p><PortalPolygonEditor portals={selectedPortals} snapshot={frame} loading={frameLoading} error={frameError} onChange={updatePortals} /></section>
      <section className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))]"><div className="p-4 border-b border-[hsl(var(--border))]"><h2 className="font-bold text-sm text-[hsl(var(--text-primary))]">Connect portals</h2><p className="text-xs text-[hsl(var(--text-muted))] mt-0.5">An exit can link to multiple entries.</p></div><div className="p-4 space-y-3"><PortalSelect label="Exit portal" value={route.exitPortal} onChange={(value) => setRoute((current) => ({ ...current, exitPortal: value }))} records={exits} cameras={cameras} placeholder="Choose an exit" /><div className="flex justify-center"><ArrowRight className="w-4 h-4 text-[hsl(var(--text-muted))]" /></div><PortalSelect label="Entry portal" value={route.entryPortal} onChange={(value) => setRoute((current) => ({ ...current, entryPortal: value }))} records={entries} cameras={cameras} placeholder="Choose an entry" /><div className="grid grid-cols-2 gap-2"><NumberInput label="Min seconds" value={route.minTransitSeconds} onChange={(value) => setRoute((current) => ({ ...current, minTransitSeconds: value }))} /><NumberInput label="Max seconds" value={route.maxTransitSeconds} onChange={(value) => setRoute((current) => ({ ...current, maxTransitSeconds: value }))} /></div><button onClick={addRoute} className="w-full py-2 rounded-lg bg-slate-800 hover:bg-slate-700 dark:bg-slate-100 dark:hover:bg-white dark:text-slate-900 text-white text-xs font-bold">Add handoff route</button></div></section>
    </div>
    <section className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))]"><div className="p-4 border-b border-[hsl(var(--border))] flex items-center justify-between"><div><h2 className="font-bold text-sm text-[hsl(var(--text-primary))]">Active handoff routes</h2><p className="text-xs text-[hsl(var(--text-muted))] mt-0.5">Only explicit exit → entry routes are allowed to transfer a worker.</p></div><span className="text-xs font-bold px-2 py-1 rounded bg-[hsl(var(--bg-table-head))] text-[hsl(var(--text-muted))]">{facility.connections.length}</span></div><div className="divide-y divide-[hsl(var(--border))]">{facility.connections.length === 0 ? <p className="p-5 text-sm text-[hsl(var(--text-muted))]">No routes yet. Draw portals and link them above.</p> : facility.connections.map((connection) => <div key={connection.id} className="p-4 flex flex-col sm:flex-row sm:items-center gap-3"><div className="min-w-0 flex-1 grid sm:grid-cols-[1fr_auto_1fr] items-center gap-2 text-sm"><span className="font-semibold text-orange-700 dark:text-orange-300 truncate">{connection.exitPortal}</span><ArrowRight className="w-4 h-4 text-[hsl(var(--text-muted))]" /><span className="font-semibold text-green-700 dark:text-green-300 truncate">{connection.entryPortal}</span></div><span className="text-xs text-[hsl(var(--text-muted))]">{connection.minTransitSeconds}–{connection.maxTransitSeconds}s</span><button onClick={() => replaceFacility((current) => ({ ...current, connections: current.connections.filter((item) => item.id !== connection.id) }))} className="p-1.5 text-red-500 hover:bg-red-500/10 rounded-md"><Trash2 className="w-4 h-4" /></button></div>)}</div></section>
  </div>;
}

function PortalSelect({ label, value, onChange, records, cameras, placeholder }: { label: string; value: string; onChange: (value: string) => void; records: { cameraId: string; portal: PortalShape; key: string }[]; cameras: CameraInfo[]; placeholder: string }) {
  return <label className="block"><span className="block mb-1 text-[11px] font-bold text-[hsl(var(--text-secondary))]">{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className="w-full px-2.5 py-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-input))] text-xs"><option value="">{placeholder}</option>{records.map((item) => <option key={item.key} value={item.key}>{cameras.find((camera) => String(camera.id) === item.cameraId)?.name ?? `Camera ${item.cameraId}`} · {item.portal.id}</option>)}</select></label>;
}

function NumberInput({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <label><span className="block mb-1 text-[11px] font-bold text-[hsl(var(--text-secondary))]">{label}</span><input type="number" min="0" value={value} onChange={(event) => onChange(Number(event.target.value))} className="w-full px-2.5 py-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-input))] text-xs" /></label>;
}
