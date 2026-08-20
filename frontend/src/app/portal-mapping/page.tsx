"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CircleDot, DoorOpen, GitFork, Loader2, Network, RefreshCw, Save } from "lucide-react";
import { useCameras } from "@/hooks/useCameras";
import PortalPolygonEditor, { type PortalShape } from "@/components/cameras/PortalPolygonEditor";

type Facility = { id: string; cameras: { id: string; portals: PortalShape[] }[] };
type Layout = { facilities: Facility[]; connections: any[] };

const apiBase = () => typeof window === "undefined" ? "http://localhost:8000" : `http://${window.location.hostname}:8000`;

export default function PortalMappingPage() {
  const { cameras, loading: camerasLoading } = useCameras();
  const [layout, setLayout] = useState<Layout>({ facilities: [], connections: [] });
  const [facilityId, setFacilityId] = useState("main-facility");
  const [cameraId, setCameraId] = useState<string | null>(null);
  const [frame, setFrame] = useState<string | null>(null);
  const [frameLoading, setFrameLoading] = useState(false);
  const [frameError, setFrameError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);

  const facility = useMemo(
    () => layout.facilities.find((item) => item.id === facilityId) ?? { id: facilityId, cameras: [] },
    [layout, facilityId]
  );

  const selectedCamera = cameras.find((camera) => String(camera.id) === cameraId);
  const selectedPortals = facility.cameras.find((camera) => camera.id === cameraId)?.portals ?? [];

  const loadLayout = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`${apiBase()}/api/spatial-handoff/configuration`);
      if (!response.ok) throw new Error(`Server returned ${response.status}`);
      const data = await response.json() as Layout;
      setLayout({ facilities: data.facilities ?? [], connections: data.connections ?? [] });
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

  const replaceFacility = (update: (current: Facility) => Facility) =>
    setLayout((current) => {
      const existing = current.facilities.find((item) => item.id === facilityId);
      const next = update(existing ?? { id: facilityId, cameras: [] });
      return {
        ...current,
        facilities: existing
          ? current.facilities.map((item) => (item.id === facilityId ? next : item))
          : [...current.facilities, next],
      };
    });

  const updatePortals = (portals: PortalShape[]) => {
    if (!cameraId) return;
    replaceFacility((current) => {
      const cameraLayouts = current.cameras.some((camera) => camera.id === cameraId)
        ? current.cameras.map((camera) => (camera.id === cameraId ? { ...camera, portals } : camera))
        : [...current.cameras, { id: cameraId, portals }];
      const validKeys = new Set(
        cameraLayouts.flatMap((camera) =>
          camera.portals.map((portal) => `${facilityId}:${camera.id}:${portal.id}`)
        )
      );
      setLayout((prev) => ({
        ...prev,
        connections: prev.connections.filter(
          (c) => validKeys.has(c.exitPortal) && validKeys.has(c.entryPortal)
        ),
      }));
      return { ...current, cameras: cameraLayouts };
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      const response = await fetch(`${apiBase()}/api/spatial-handoff/configuration`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(layout),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail ?? `Server returned ${response.status}`);
      setLayout({ facilities: data.facilities ?? [], connections: data.connections ?? [] });
      setNotice({ error: false, text: "Portal layout saved." });
    } catch (error: any) {
      setNotice({ error: true, text: `Could not save layout: ${error.message}` });
    } finally { setSaving(false); }
  };

  return (
    <div className="p-5 sm:p-8 max-w-[1700px] mx-auto space-y-5">
      {/* Header */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-xs font-bold uppercase tracking-widest">
            <Network className="w-4 h-4" /> Spatial Portals
          </div>
          <h1 className="mt-1 text-2xl font-bold text-[hsl(var(--text-primary))]">Portal Mapping</h1>
          <p className="mt-1 text-sm text-[hsl(var(--text-muted))]">Draw spatial boundary portals on reference camera snapshot frames.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/portal-flow"
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-sm font-semibold transition-colors"
          >
            <GitFork className="w-4 h-4" />
            Portal Flow Topology →
          </Link>
          <div className="h-6 w-px bg-[hsl(var(--border))]" />
          <label className="text-xs font-semibold text-[hsl(var(--text-secondary))]">Facility</label>
          <input value={facilityId} onChange={(e) => setFacilityId(e.target.value)} className="w-36 px-3 py-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] text-sm" />
          <button onClick={loadLayout} disabled={loading} className="p-2 rounded-lg border border-[hsl(var(--border))] hover:bg-[hsl(var(--bg-table-head))]" title="Reload saved configuration">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button onClick={save} disabled={saving || loading} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-semibold">
            <Save className="w-4 h-4" />{saving ? "Saving…" : "Save portals"}
          </button>
        </div>
      </div>

      {notice && (
        <div className={`rounded-xl border px-4 py-3 text-sm flex items-center gap-2 ${notice.error ? "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300" : "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"}`}>
          <CircleDot className="w-4 h-4 shrink-0" />{notice.text}
        </div>
      )}

      {/* Two-column grid: cameras | frame editor */}
      <div className="grid grid-cols-1 xl:grid-cols-[260px_minmax(0,1fr)] gap-5 items-start">
        {/* Camera list */}
        <section className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] overflow-hidden">
          <div className="px-4 py-3 border-b border-[hsl(var(--border))]">
            <h2 className="font-bold text-sm text-[hsl(var(--text-primary))]">Cameras</h2>
            <p className="text-xs text-[hsl(var(--text-muted))] mt-0.5">Pick frame to map portals.</p>
          </div>
          <div className="p-2 max-h-[660px] overflow-y-auto">
            {camerasLoading
              ? <p className="p-4 text-sm text-[hsl(var(--text-muted))]"><Loader2 className="w-4 h-4 inline animate-spin mr-2" />Loading cameras</p>
              : cameras.map((camera) => {
                const active = cameraId === String(camera.id);
                const portalCount = facility.cameras.find((item) => item.id === String(camera.id))?.portals.length ?? 0;
                return (
                  <button key={camera.id} onClick={() => setCameraId(String(camera.id))}
                    className={`w-full text-left p-3 rounded-lg mb-1 ${active ? "bg-emerald-500/10 border border-emerald-500/25" : "hover:bg-[hsl(var(--bg-table-head))] border border-transparent"}`}>
                    <div className="flex items-center gap-2">
                      <DoorOpen className={`w-4 h-4 ${active ? "text-emerald-500" : "text-[hsl(var(--text-muted))]"}`} />
                      <span className="font-semibold text-sm text-[hsl(var(--text-primary))] truncate">{camera.name}</span>
                    </div>
                    <div className="pl-6 mt-1 text-xs text-[hsl(var(--text-muted))]">
                      {portalCount} portal{portalCount !== 1 ? "s" : ""} defined
                    </div>
                  </button>
                );
              })}
          </div>
        </section>

        {/* Frame editor */}
        <section className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] p-4 min-h-[660px]">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h2 className="font-bold text-sm text-[hsl(var(--text-primary))]">{selectedCamera?.name ?? "Select a camera"}</h2>
              <p className="text-xs text-[hsl(var(--text-muted))] mt-0.5">Draw polygon boundary shapes over doorways or transit zones.</p>
            </div>
            <Link href="/portal-flow" className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold hover:underline">
              Manage flow connections →
            </Link>
          </div>
          <PortalPolygonEditor portals={selectedPortals} snapshot={frame} loading={frameLoading} error={frameError} onChange={updatePortals} />
        </section>
      </div>
    </div>
  );
}


