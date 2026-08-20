"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  CircleDot,
  DoorOpen,
  GitFork,
  GripVertical,
  Info,
  Layers,
  Loader2,
  MapPin,
  Move,
  Network,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Sliders,
  Trash2,
  Video,
  X,
  ZoomIn,
  ZoomOut,
  Download,
  Upload,
} from "lucide-react";
import { useCameras } from "@/hooks/useCameras";
import ConfigImportModal from "@/components/ConfigImportModal";

type PortalShape = {
  id: string;
  polygon: [number, number][];
  enabled?: boolean;
};

type CameraLayout = {
  id: string;
  portals: PortalShape[];
};

type Facility = {
  id: string;
  cameras: CameraLayout[];
};

type Connection = {
  id: string;
  exitPortal: string; // fully-qualified: "facility:camera:portal"
  entryPortal: string; // fully-qualified: "facility:camera:portal"
  minTransitSeconds: number;
  maxTransitSeconds: number;
  minSimilarity?: number;
};

type Layout = {
  facilities: Facility[];
  connections: Connection[];
};

type CameraCanvasNode = {
  id: string; // "cam-node-cameraId"
  cameraId: string;
  cameraName: string;
  portals: { id: string; qualifiedId: string }[];
  x: number;
  y: number;
};

type CanvasEdge = {
  id: string;
  exitQualifiedId: string;
  entryQualifiedId: string;
  minTransitSeconds: number;
  maxTransitSeconds: number;
};

const apiBase = () =>
  typeof window === "undefined" ? "http://localhost:8000" : `http://${window.location.hostname}:8000`;

export default function PortalFlowPage() {
  const { cameras, loading: camerasLoading } = useCameras();
  const [layout, setLayout] = useState<Layout>({ facilities: [], connections: [] });
  const [facilityId, setFacilityId] = useState("main-facility");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  const [importModalOpen, setImportModalOpen] = useState(false);

  const handleExportFlow = () => {
    const url = `${apiBase()}/api/spatial-handoff/export`;
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", "spatial_handoff.json");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setNotice({ error: false, text: "Exported spatial flow layout successfully!" });
  };

  // Left Panel Search
  const [searchQuery, setSearchQuery] = useState("");

  // Canvas State: Camera-Centric Nodes, Flow Edges & Panning
  const [cameraNodes, setCameraNodes] = useState<CameraCanvasNode[]>([]);
  const [canvasEdges, setCanvasEdges] = useState<CanvasEdge[]>([]);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0 });

  // Interaction State
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null); // qualifiedId
  const [mouseCanvasPos, setMouseCanvasPos] = useState<{ x: number; y: number } | null>(null);
  const [editingEdgeId, setEditingEdgeId] = useState<string | null>(null);
  const [editingTransit, setEditingTransit] = useState({ min: 3, max: 20 });
  const [showSavedModal, setShowSavedModal] = useState(false);

  const canvasRef = useRef<HTMLDivElement>(null);

  const facility = useMemo(
    () => layout.facilities.find((item) => item.id === facilityId) ?? { id: facilityId, cameras: [] },
    [layout, facilityId]
  );

  // Camera Library for Left Panel
  const cameraLibrary = useMemo(() => {
    return facility.cameras.map((camLayout) => {
      const camMeta = cameras.find((c) => String(c.id) === camLayout.id);
      const cameraName = camMeta?.name ?? `Camera ${camLayout.id}`;
      return {
        facilityId,
        cameraId: camLayout.id,
        cameraName,
        portals: camLayout.portals.map((p) => ({
          id: p.id,
          qualifiedId: `${facilityId}:${camLayout.id}:${p.id}`,
        })),
      };
    });
  }, [facility, facilityId, cameras]);

  const filteredCameraLibrary = useMemo(() => {
    if (!searchQuery) return cameraLibrary;
    const q = searchQuery.toLowerCase();
    return cameraLibrary.filter(
      (c) =>
        c.cameraName.toLowerCase().includes(q) ||
        c.cameraId.toLowerCase().includes(q) ||
        c.portals.some((p) => p.id.toLowerCase().includes(q))
    );
  }, [cameraLibrary, searchQuery]);

  // Load Configuration & Auto-populate Canvas with Camera Nodes
  const loadLayout = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`${apiBase()}/api/spatial-handoff/configuration`);
      if (!response.ok) throw new Error(`Server returned ${response.status}`);
      const data = (await response.json()) as Layout;
      setLayout({ facilities: data.facilities ?? [], connections: data.connections ?? [] });

      const fac = data.facilities?.[0] ?? { id: "main-facility", cameras: [] };
      const facilityIdStr = fac.id || "main-facility";
      setFacilityId(facilityIdStr);

      // Extract connections from both top-level and facility-nested keys
      const rawConnectionsList: any[] = [
        ...(data.connections ?? []),
        ...(fac.cameras ? fac.cameras.flatMap((c: any) => c.connections ?? []) : []),
        ...((fac as any).connections ?? []),
      ];

      const seen = new Set<string>();
      const initialEdges: CanvasEdge[] = [];
      rawConnectionsList.forEach((c, idx) => {
        const exitP = String(c.exitPortal || c.exit_portal_id || "");
        const entryP = String(c.entryPortal || c.entry_portal_id || "");
        if (!exitP || !entryP) return;
        const exitQ = exitP.startsWith(`${facilityIdStr}:`) ? exitP : `${facilityIdStr}:${exitP}`;
        const entryQ = entryP.startsWith(`${facilityIdStr}:`) ? entryP : `${facilityIdStr}:${entryP}`;
        const key = `${exitQ}->${entryQ}`;
        if (seen.has(key)) return;
        seen.add(key);
        initialEdges.push({
          id: c.id || `flow-edge-${idx}`,
          exitQualifiedId: exitQ,
          entryQualifiedId: entryQ,
          minTransitSeconds: Number(c.minTransitSeconds ?? 3),
          maxTransitSeconds: Number(c.maxTransitSeconds ?? 20),
        });
      });

      const savedPositions = (data as any).canvasPositions ?? {};

      // Auto-populate Camera Nodes on Canvas in organized columns (or saved positions)
      const initialCameraNodes: CameraCanvasNode[] = [];
      const colWidth = 280;

      (fac.cameras ?? []).forEach((cam: any, camIdx: number) => {
        const camMeta = cameras.find((c) => String(c.id) === String(cam.id));
        const cameraName = camMeta?.name ?? `Camera ${cam.id}`;
        const portals = (cam.portals ?? []).map((p: any) => ({
          id: p.id,
          qualifiedId: `${facilityIdStr}:${cam.id}:${p.id}`,
        }));

        const savedPos = savedPositions[String(cam.id)];
        const posX = savedPos?.x ?? (60 + camIdx * colWidth);
        const posY = savedPos?.y ?? 70;

        initialCameraNodes.push({
          id: `cam-node-${cam.id}`,
          cameraId: String(cam.id),
          cameraName,
          portals,
          x: posX,
          y: posY,
        });
      });

      setCameraNodes(initialCameraNodes);
      setCanvasEdges(initialEdges);
      setNotice(null);
    } catch (error: any) {
      setNotice({ error: true, text: `Could not load configuration: ${error.message}` });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLayout();
  }, [loadLayout]);

  // Update Camera names once camera list metadata arrives
  useEffect(() => {
    if (!cameras.length) return;
    setCameraNodes((prev) =>
      prev.map((node) => {
        const camMeta = cameras.find((c) => String(c.id) === node.cameraId);
        return camMeta ? { ...node, cameraName: camMeta.name } : node;
      })
    );
  }, [cameras]);

  // Add Camera Node to Canvas
  const addCameraToCanvas = (cameraId: string, dropX?: number, dropY?: number) => {
    const camLib = cameraLibrary.find((c) => c.cameraId === cameraId);
    if (!camLib) return;

    // Check if camera node is already on canvas
    const existing = cameraNodes.find((n) => n.cameraId === cameraId);
    if (existing) {
      setNotice({ error: false, text: `Camera '${camLib.cameraName}' is already on the canvas.` });
      return;
    }

    const defaultX = dropX ?? 60 + cameraNodes.length * 280;
    const defaultY = dropY ?? 70;

    const newNode: CameraCanvasNode = {
      id: `cam-node-${cameraId}-${Date.now()}`,
      cameraId: camLib.cameraId,
      cameraName: camLib.cameraName,
      portals: camLib.portals,
      x: defaultX,
      y: defaultY,
    };

    setCameraNodes((prev) => [...prev, newNode]);
  };

  // Remove Camera Node from Canvas
  const removeCameraNode = (nodeId: string, cameraId: string) => {
    setCameraNodes((prev) => prev.filter((n) => n.id !== nodeId));
    // Remove edges belonging to this camera's portals
    const camPrefix = `${facilityId}:${cameraId}:`;
    setCanvasEdges((prev) =>
      prev.filter((e) => !e.exitQualifiedId.startsWith(camPrefix) && !e.entryQualifiedId.startsWith(camPrefix))
    );
  };

  // Canvas Mouse Panning & Drag Handlers
  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest(".camera-node-card") || target.closest("button") || target.closest("input")) {
      return;
    }
    setIsPanning(true);
    panStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  };

  const handleDragStartFromLibrary = (e: React.DragEvent, cameraId: string) => {
    e.dataTransfer.setData("application/camera-id", cameraId);
  };

  const handleCanvasDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  const handleCanvasDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const cameraId = e.dataTransfer.getData("application/camera-id");
    if (!cameraId || !canvasRef.current) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const dropX = (e.clientX - rect.left - pan.x) / zoom - 120;
    const dropY = (e.clientY - rect.top - pan.y) / zoom - 30;

    addCameraToCanvas(cameraId, Math.max(20, dropX), Math.max(20, dropY));
  };

  // Canvas Camera Node Dragging
  const handleNodeMouseDown = (e: React.MouseEvent, nodeId: string, initialX: number, initialY: number) => {
    e.stopPropagation();
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    setDraggingNodeId(nodeId);
    setDragOffset({
      x: (e.clientX - rect.left - pan.x) / zoom - initialX,
      y: (e.clientY - rect.top - pan.y) / zoom - initialY,
    });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();

    if (isPanning) {
      setPan({
        x: e.clientX - panStartRef.current.x,
        y: e.clientY - panStartRef.current.y,
      });
      return;
    }

    const mouseX = (e.clientX - rect.left - pan.x) / zoom;
    const mouseY = (e.clientY - rect.top - pan.y) / zoom;

    setMouseCanvasPos({ x: mouseX, y: mouseY });

    if (draggingNodeId) {
      const nextX = Math.max(10, (e.clientX - rect.left - pan.x) / zoom - dragOffset.x);
      const nextY = Math.max(10, (e.clientY - rect.top - pan.y) / zoom - dragOffset.y);
      setCameraNodes((prev) =>
        prev.map((node) => (node.id === draggingNodeId ? { ...node, x: nextX, y: nextY } : node))
      );
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
    setDraggingNodeId(null);
  };

  // Handle Portal Port Connection Click (Click OUT -> Click IN)
  const handlePortClick = (qualifiedId: string, type: "out" | "in") => {
    if (type === "out") {
      if (connectingFrom === qualifiedId) {
        setConnectingFrom(null);
      } else {
        setConnectingFrom(qualifiedId);
        setNotice({
          error: false,
          text: "Select an arrival (In) port on another camera portal to complete the flow pathway.",
        });
      }
    } else if (type === "in") {
      if (connectingFrom && connectingFrom !== qualifiedId) {
        const existing = canvasEdges.find(
          (e) => e.exitQualifiedId === connectingFrom && e.entryQualifiedId === qualifiedId
        );
        if (!existing) {
          const newEdge: CanvasEdge = {
            id: `edge-${Date.now().toString(36)}`,
            exitQualifiedId: connectingFrom,
            entryQualifiedId: qualifiedId,
            minTransitSeconds: 3,
            maxTransitSeconds: 20,
          };
          setCanvasEdges((prev) => [...prev, newEdge]);
        }
        setConnectingFrom(null);
        setNotice(null);
      }
    }
  };

  const deleteEdge = (edgeId: string) => {
    setCanvasEdges((prev) => prev.filter((e) => e.id !== edgeId));
    if (editingEdgeId === edgeId) setEditingEdgeId(null);
  };

  const saveTransitTime = () => {
    if (!editingEdgeId) return;
    setCanvasEdges((prev) =>
      prev.map((e) =>
        e.id === editingEdgeId
          ? {
              ...e,
              minTransitSeconds: Math.max(0, editingTransit.min),
              maxTransitSeconds: Math.max(editingTransit.min, editingTransit.max),
            }
          : e
      )
    );
    setEditingEdgeId(null);
  };

  // Save Flow Topology
  const saveFlow = async () => {
    setSaving(true);
    try {
      const connectionsPayload: Connection[] = canvasEdges.map((e) => ({
        id: e.id,
        exitPortal: e.exitQualifiedId,
        entryPortal: e.entryQualifiedId,
        minTransitSeconds: e.minTransitSeconds,
        maxTransitSeconds: e.maxTransitSeconds,
        minSimilarity: 0.72,
      }));

      const canvasPositions: Record<string, { x: number; y: number }> = {};
      cameraNodes.forEach((node) => {
        canvasPositions[node.cameraId] = { x: Math.round(node.x), y: Math.round(node.y) };
      });

      const payload: Layout & { canvasPositions?: Record<string, { x: number; y: number }> } = {
        facilities: layout.facilities,
        connections: connectionsPayload,
        canvasPositions,
      };

      const response = await fetch(`${apiBase()}/api/spatial-handoff/configuration`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail ?? `Server returned ${response.status}`);

      setLayout({ facilities: data.facilities ?? [], connections: data.connections ?? [] });
      setNotice({ error: false, text: "Flow topology saved! Active in multi-camera tracking engine." });
    } catch (error: any) {
      setNotice({ error: true, text: `Could not save flow topology: ${error.message}` });
    } finally {
      setSaving(false);
    }
  };

  const autoOrganizeCameraNodes = () => {
    setCameraNodes((prev) =>
      prev.map((node, idx) => ({
        ...node,
        x: 60 + idx * 280,
        y: 70,
      }))
    );
  };

  /** Calculate anchor coordinates for a portal port inside a camera node */
  const getPortCoordinates = (qualifiedId: string, type: "out" | "in") => {
    if (canvasRef.current) {
      const canvasRect = canvasRef.current.getBoundingClientRect();
      // Try finding port handle element by data attribute
      const safeId = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(qualifiedId) : qualifiedId;
      const el = canvasRef.current.querySelector(`[data-port-id="${safeId}"][data-port-type="${type}"]`);
      if (el) {
        const portRect = el.getBoundingClientRect();
        const x = (portRect.left + portRect.width / 2 - canvasRect.left - pan.x) / zoom;
        const y = (portRect.top + portRect.height / 2 - canvasRect.top - pan.y) / zoom;
        return { x, y };
      }
    }

    // Fallback mathematical calculation
    for (const node of cameraNodes) {
      const portalIndex = node.portals.findIndex((p) => p.qualifiedId === qualifiedId);
      if (portalIndex !== -1) {
        const nodeWidth = 240;
        const headerHeight = 44;
        const containerPaddingTop = 8;
        const portalRowHeight = 36;
        const portalGap = 4;
        const portalCenterY =
          node.y +
          headerHeight +
          containerPaddingTop +
          portalIndex * (portalRowHeight + portalGap) +
          portalRowHeight / 2;
        const portX = type === "out" ? node.x + nodeWidth : node.x;
        return { x: portX, y: portalCenterY };
      }
    }
    return null;
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden bg-[hsl(var(--bg-page))]">
      {/* LEFT SIDE: Camera Viewer / Node Library */}
      <aside className="w-80 border-r border-[hsl(var(--border))] bg-[hsl(var(--bg-sidebar))] flex flex-col shrink-0 overflow-hidden shadow-sm z-10">
        {/* Panel Header */}
        <div className="p-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-card))]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[hsl(var(--text-secondary))]">
              <Video className="w-4 h-4 text-emerald-500" /> Camera Library
            </div>
            <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-[hsl(var(--bg-table-head))] text-[hsl(var(--text-muted))]">
              {cameraLibrary.length} cameras
            </span>
          </div>
          <p className="text-[11px] text-[hsl(var(--text-muted))] mt-1">
            Drag cameras onto the canvas to create portal flows between them.
          </p>

          {/* Search Bar */}
          <div className="relative mt-3">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--text-muted))]" />
            <input
              type="text"
              placeholder="Search camera or portal…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-input))] text-xs focus:outline-none focus:border-emerald-500"
            />
          </div>
        </div>

        {/* Camera Cards List */}
        <div className="flex-1 p-3 overflow-y-auto space-y-3">
          {camerasLoading ? (
            <div className="p-4 text-center text-xs text-[hsl(var(--text-muted))]">
              <Loader2 className="w-4 h-4 inline animate-spin mr-2" /> Loading cameras…
            </div>
          ) : filteredCameraLibrary.length === 0 ? (
            <div className="p-6 text-center text-xs text-[hsl(var(--text-muted))] space-y-2">
              <p>No cameras match search query.</p>
              <Link href="/portal-mapping" className="text-emerald-500 font-semibold underline">
                Define portals in Portal Mapping →
              </Link>
            </div>
          ) : (
            filteredCameraLibrary.map((cam) => {
              const isOnCanvas = cameraNodes.some((n) => n.cameraId === cam.cameraId);

              return (
                <div
                  key={cam.cameraId}
                  draggable
                  onDragStart={(e) => handleDragStartFromLibrary(e, cam.cameraId)}
                  className={`p-3 rounded-xl border cursor-grab active:cursor-grabbing flex flex-col gap-2 group transition-all select-none ${
                    isOnCanvas
                      ? "border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300"
                      : "border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] hover:border-orange-500/50 hover:bg-orange-500/5"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <GripVertical className="w-4 h-4 text-[hsl(var(--text-muted))] group-hover:text-orange-500 shrink-0" />
                      <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" />
                      <span className="font-bold text-xs truncate text-[hsl(var(--text-primary))]">
                        {cam.cameraName}
                      </span>
                    </div>

                    {isOnCanvas ? (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                        On Canvas
                      </span>
                    ) : (
                      <button
                        onClick={() => addCameraToCanvas(cam.cameraId)}
                        className="px-2 py-1 bg-emerald-600 text-white rounded text-[10px] font-bold hover:bg-emerald-700"
                        title="Add Camera to Canvas"
                      >
                        + Add
                      </button>
                    )}
                  </div>

                  {/* Portals list inside Camera card */}
                  <div className="pl-6 pt-1 border-t border-[hsl(var(--border))]/50 space-y-1">
                    {cam.portals.length === 0 ? (
                      <p className="text-[10px] text-[hsl(var(--text-muted))] italic">No portals defined</p>
                    ) : (
                      cam.portals.map((p) => (
                        <div key={p.id} className="flex items-center gap-1.5 text-[11px] text-[hsl(var(--text-secondary))]">
                          <span className="w-1.5 h-1.5 rounded-full bg-orange-500 shrink-0" />
                          <span className="font-mono truncate">{p.id}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* RIGHT SIDE: Camera-Centric Portal Flow Canvas (n8n Style) */}
      <main
        className="flex-1 flex flex-col min-w-0 bg-[hsl(var(--bg-page))] relative overflow-hidden"
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      >
        {/* Canvas Top Action Bar */}
        <header className="h-14 border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-card))]/90 backdrop-blur-md px-6 flex items-center justify-between shrink-0 z-20">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-xs font-bold text-[hsl(var(--text-primary))]">
              <GitFork className="w-4 h-4 text-emerald-500" />
              Camera Flow Canvas
            </div>
            <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
              {cameraNodes.length} Cameras · {canvasEdges.length} Pathways
            </span>
          </div>

          <div className="flex items-center gap-3">
            {/* Zoom Controls */}
            <div className="flex items-center gap-1 bg-[hsl(var(--bg-input))] p-1 rounded-lg border border-[hsl(var(--border))]">
              <button
                onClick={() => setZoom((z) => Math.max(0.6, z - 0.1))}
                className="p-1 text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))]"
                title="Zoom Out"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="text-[11px] font-mono text-[hsl(var(--text-muted))] w-10 text-center">
                {Math.round(zoom * 100)}%
              </span>
              <button
                onClick={() => setZoom((z) => Math.min(1.4, z + 0.1))}
                className="p-1 text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))]"
                title="Zoom In"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => {
                  setZoom(1);
                  setPan({ x: 0, y: 0 });
                }}
                className="p-1 text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))]"
                title="Reset View"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>

            <button
              onClick={() => {
                autoOrganizeCameraNodes();
                setPan({ x: 0, y: 0 });
              }}
              className="px-3 py-1.5 rounded-lg border border-[hsl(var(--border))] hover:bg-[hsl(var(--bg-table-head))] text-xs font-semibold text-[hsl(var(--text-primary))]"
              title="Organize cameras in grid"
            >
              Auto-Layout
            </button>

            <button
              onClick={() => {
                setCameraNodes([]);
                setCanvasEdges([]);
              }}
              className="px-3 py-1.5 rounded-lg border border-red-500/30 text-xs font-semibold text-red-500 hover:bg-red-500/10"
            >
              Clear Canvas
            </button>

            <button
              onClick={() => setShowSavedModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-xs font-semibold text-emerald-600 dark:text-emerald-400"
              title="View all saved flow pathways"
            >
              <Layers className="w-3.5 h-3.5" /> Saved Pathways ({canvasEdges.length})
            </button>

            <div className="h-5 w-px bg-[hsl(var(--border))]" />

            <button
              onClick={handleExportFlow}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] hover:bg-[hsl(var(--bg-hover))] text-xs font-semibold text-[hsl(var(--text-secondary))] shadow-sm"
              title="Export spatial_handoff.json"
            >
              <Download className="w-3.5 h-3.5 text-purple-500" /> Export Flow JSON
            </button>

            <button
              onClick={() => setImportModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] hover:bg-[hsl(var(--bg-hover))] text-xs font-semibold text-[hsl(var(--text-secondary))] shadow-sm"
              title="Import spatial_handoff.json"
            >
              <Upload className="w-3.5 h-3.5 text-emerald-500" /> Import Flow JSON
            </button>

            <div className="h-5 w-px bg-[hsl(var(--border))]" />

            <button
              onClick={saveFlow}
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold shadow-sm transition-all"
            >
              <Save className="w-3.5 h-3.5" /> {saving ? "Saving Flow…" : "Save Flow"}
            </button>
          </div>
        </header>

        {/* Notice Banner */}
        {notice && (
          <div
            className={`px-6 py-2.5 text-xs flex items-center justify-between border-b ${
              notice.error
                ? "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300"
                : "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
            }`}
          >
            <div className="flex items-center gap-2">
              <CircleDot className="w-3.5 h-3.5 shrink-0" />
              <span>{notice.text}</span>
            </div>
            <button onClick={() => setNotice(null)} className="opacity-70 hover:opacity-100">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Canvas Drop Zone & Mouse Pan Area */}
        <div
          ref={canvasRef}
          onMouseDown={handleCanvasMouseDown}
          onDragOver={handleCanvasDragOver}
          onDrop={handleCanvasDrop}
          className={`flex-1 relative overflow-hidden select-none bg-slate-950/5 dark:bg-slate-950/40 ${
            isPanning ? "cursor-grabbing" : draggingNodeId ? "cursor-move" : "cursor-grab"
          }`}
          style={{
            backgroundImage: "radial-gradient(circle, rgba(16, 185, 129, 0.15) 1px, transparent 1px)",
            backgroundSize: "24px 24px",
            backgroundPosition: `${pan.x}px ${pan.y}px`,
          }}
        >
          {cameraNodes.length === 0 ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-[hsl(var(--text-muted))] gap-3 pointer-events-none">
              <div className="w-16 h-16 rounded-2xl border-2 border-dashed border-[hsl(var(--border))] flex items-center justify-center text-[hsl(var(--text-muted))]">
                <Video className="w-8 h-8 opacity-40" />
              </div>
              <div className="text-center space-y-1">
                <p className="text-sm font-bold text-[hsl(var(--text-primary))]">Drag & Drop Cameras Here</p>
                <p className="text-xs">Drag camera entries from the left sidebar onto this flow canvas.</p>
              </div>
            </div>
          ) : (
            <div
              className="absolute inset-0 origin-top-left min-w-[3000px] min-h-[2000px]"
              style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
            >
              {/* SVG Overlay for Portal-to-Portal Edges */}
              <svg className="absolute inset-0 w-full h-full pointer-events-none z-10 overflow-visible">
                <defs>
                  <marker
                    id="arrow-orange"
                    viewBox="0 0 10 10"
                    refX="8"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#f97316" />
                  </marker>
                </defs>

                {/* Render Flow Edges between Portals */}
                {canvasEdges.map((edge) => {
                  const srcPt = getPortCoordinates(edge.exitQualifiedId, "out");
                  const dstPt = getPortCoordinates(edge.entryQualifiedId, "in");
                  if (!srcPt || !dstPt) return null;

                  const x1 = srcPt.x;
                  const y1 = srcPt.y;
                  const x2 = dstPt.x;
                  const y2 = dstPt.y;

                  const dx = Math.abs(x2 - x1) * 0.5;
                  const cp1x = x1 + Math.max(dx, 40);
                  const cp1y = y1;
                  const cp2x = x2 - Math.max(dx, 40);
                  const cp2y = y2;
                  const pathData = `M ${x1} ${y1} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x2} ${y2}`;

                  const midX = (x1 + x2) / 2;
                  const midY = (y1 + y2) / 2;

                  return (
                    <g key={edge.id}>
                      {/* Connection curve */}
                      <path
                        d={pathData}
                        fill="none"
                        stroke="#f97316"
                        strokeWidth="2.5"
                        strokeDasharray="6,4"
                        markerEnd="url(#arrow-orange)"
                        className="transition-all"
                      />

                      {/* Transit Badge */}
                      <foreignObject
                        x={midX - 34}
                        y={midY - 12}
                        width="68"
                        height="24"
                        className="overflow-visible pointer-events-auto"
                      >
                        <button
                          onClick={() => {
                            setEditingEdgeId(edge.id);
                            setEditingTransit({ min: edge.minTransitSeconds, max: edge.maxTransitSeconds });
                          }}
                          title="Click to edit transit window or delete edge"
                          className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-slate-900/90 text-orange-300 border border-orange-500/40 hover:bg-orange-500 hover:text-white shadow-sm transition-all"
                        >
                          {edge.minTransitSeconds}s–{edge.maxTransitSeconds}s
                        </button>
                      </foreignObject>
                    </g>
                  );
                })}

                {/* Connecting Line from Output handle to mouse position */}
                {connectingFrom && mouseCanvasPos && (
                  (() => {
                    const srcPt = getPortCoordinates(connectingFrom, "out");
                    if (!srcPt) return null;
                    const x1 = srcPt.x;
                    const y1 = srcPt.y;
                    const x2 = mouseCanvasPos.x;
                    const y2 = mouseCanvasPos.y;
                    const dx = Math.abs(x2 - x1) * 0.5;
                    const pathData = `M ${x1} ${y1} C ${x1 + Math.max(dx, 40)} ${y1}, ${x2 - Math.max(dx, 40)} ${y2}, ${x2} ${y2}`;

                    return (
                      <path
                        d={pathData}
                        fill="none"
                        stroke="#10b981"
                        strokeWidth="2.5"
                        strokeDasharray="4,4"
                        className="animate-pulse"
                      />
                    );
                  })()
                )}
              </svg>

              {/* Render Camera Node Cards */}
              {cameraNodes.map((camNode) => {
                return (
                  <div
                    key={camNode.id}
                    style={{ left: `${camNode.x}px`, top: `${camNode.y}px`, width: "240px" }}
                    onMouseDown={(e) => handleNodeMouseDown(e, camNode.id, camNode.x, camNode.y)}
                    className="camera-node-card absolute rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))]/95 backdrop-blur-md shadow-xl transition-shadow select-none hover:border-emerald-500/50 z-20"
                  >
                    {/* Camera Node Header */}
                    <div className="h-11 px-3 border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-table-head))]/70 flex items-center justify-between rounded-t-xl cursor-move">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Move className="w-3.5 h-3.5 text-[hsl(var(--text-muted))] shrink-0" />
                        <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" />
                        <span className="font-bold text-xs text-[hsl(var(--text-primary))] truncate">
                          {camNode.cameraName}
                        </span>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeCameraNode(camNode.id, camNode.cameraId);
                        }}
                        className="p-1 text-[hsl(var(--text-muted))] hover:text-red-500 rounded"
                        title="Remove camera node"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Camera Node Portals List */}
                    <div className="p-2 space-y-1">
                      {camNode.portals.length === 0 ? (
                        <p className="text-[11px] text-[hsl(var(--text-muted))] p-2 text-center italic">
                          No portals in camera
                        </p>
                      ) : (
                        camNode.portals.map((portal) => {
                          const isConnectingSrc = connectingFrom === portal.qualifiedId;

                          return (
                            <div
                              key={portal.id}
                              className={`h-9 px-2 rounded-lg border text-xs flex items-center justify-between relative transition-colors ${
                                isConnectingSrc
                                  ? "border-emerald-500 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                                  : "border-[hsl(var(--border))]/70 bg-[hsl(var(--bg-input))]"
                              }`}
                            >
                              {/* Left Port: IN (Arrival Handle) */}
                              <button
                                data-port-id={portal.qualifiedId}
                                data-port-type="in"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handlePortClick(portal.qualifiedId, "in");
                                }}
                                title={`Arrival Handle for ${portal.id} — Click to complete pathway`}
                                className="absolute -left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-emerald-500 border-2 border-white dark:border-slate-900 shadow-sm flex items-center justify-center hover:scale-125 transition-transform"
                              >
                                <div className="w-1 h-1 rounded-full bg-white" />
                              </button>

                              <div className="flex items-center gap-1.5 pl-1 truncate">
                                <span className="w-1.5 h-1.5 rounded-full bg-orange-500 shrink-0" />
                                <span className="font-mono text-xs font-semibold truncate text-[hsl(var(--text-primary))]">
                                  {portal.id}
                                </span>
                              </div>

                              {/* Right Port: OUT (Departure Handle) */}
                              <button
                                data-port-id={portal.qualifiedId}
                                data-port-type="out"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handlePortClick(portal.qualifiedId, "out");
                                }}
                                title={`Departure Handle for ${portal.id} — Click to start pathway`}
                                className={`absolute -right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-2 border-white dark:border-slate-900 shadow-sm flex items-center justify-center hover:scale-125 transition-transform ${
                                  isConnectingSrc ? "bg-emerald-500 ring-4 ring-emerald-500/40" : "bg-orange-500"
                                }`}
                              >
                                <div className="w-1 h-1 rounded-full bg-white" />
                              </button>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {/* Transit Window Edit Modal */}
      {editingEdgeId && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-[hsl(var(--border))] pb-2.5">
              <h3 className="font-bold text-sm text-[hsl(var(--text-primary))]">Edit Transit Window</h3>
              <button
                onClick={() => setEditingEdgeId(null)}
                className="text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-[hsl(var(--text-secondary))] mb-1">
                  Min Seconds
                </label>
                <input
                  type="number"
                  min="0"
                  value={editingTransit.min}
                  onChange={(e) => setEditingTransit((prev) => ({ ...prev, min: Number(e.target.value) }))}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-input))] text-xs font-semibold"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-[hsl(var(--text-secondary))] mb-1">
                  Max Seconds
                </label>
                <input
                  type="number"
                  min="0"
                  value={editingTransit.max}
                  onChange={(e) => setEditingTransit((prev) => ({ ...prev, max: Number(e.target.value) }))}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-input))] text-xs font-semibold"
                />
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-[hsl(var(--border))] pt-3">
              <button
                onClick={() => deleteEdge(editingEdgeId)}
                className="px-3 py-1.5 rounded-lg border border-red-500/30 text-xs font-semibold text-red-500 hover:bg-red-500/10 inline-flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete Edge
              </button>

              <button
                onClick={saveTransitTime}
                className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Saved Flow Pathways Modal Drawer */}
      {showSavedModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-[hsl(var(--border))] pb-3">
              <div className="flex items-center gap-2">
                <Layers className="w-5 h-5 text-emerald-500" />
                <h3 className="font-bold text-base text-[hsl(var(--text-primary))]">Saved Flow Pathways</h3>
              </div>
              <button
                onClick={() => setShowSavedModal(false)}
                className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-[hsl(var(--text-muted))]">
              Active pathways linking departure camera portals to arrival camera portals in the spatial handoff engine.
            </p>

            <div className="divide-y divide-[hsl(var(--border))] border border-[hsl(var(--border))] rounded-xl max-h-[380px] overflow-y-auto">
              {canvasEdges.length === 0 ? (
                <p className="p-6 text-sm text-center text-[hsl(var(--text-muted))]">
                  No saved flow pathways yet. Draw pathways between camera portal ports on the canvas, then click Save Flow.
                </p>
              ) : (
                canvasEdges.map((edge, idx) => {
                  const exitParts = edge.exitQualifiedId.split(":");
                  const entryParts = edge.entryQualifiedId.split(":");
                  const exitCamId = exitParts[1] ?? exitParts[0];
                  const exitPortalId = exitParts[2] ?? exitParts[1];
                  const entryCamId = entryParts[1] ?? entryParts[0];
                  const entryPortalId = entryParts[2] ?? entryParts[1];

                  const exitCamMeta = cameras.find((c) => String(c.id) === exitCamId);
                  const entryCamMeta = cameras.find((c) => String(c.id) === entryCamId);
                  const exitName = exitCamMeta?.name ?? `Camera ${exitCamId}`;
                  const entryName = entryCamMeta?.name ?? `Camera ${entryCamId}`;

                  return (
                    <div key={edge.id || idx} className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-[hsl(var(--bg-table-head))]/40 transition-colors">
                      <div className="flex items-center gap-3 text-xs font-semibold">
                        <div className="flex items-center gap-1.5 text-orange-600 dark:text-orange-400">
                          <span className="w-2 h-2 rounded-full bg-orange-500 shrink-0" />
                          <span>{exitName}</span>
                          <span className="font-mono text-[hsl(var(--text-muted))]">({exitPortalId})</span>
                        </div>
                        <ArrowRight className="w-4 h-4 text-[hsl(var(--text-muted))]" />
                        <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                          <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                          <span>{entryName}</span>
                          <span className="font-mono text-[hsl(var(--text-muted))]">({entryPortalId})</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0 text-xs">
                        <span className="font-mono text-[11px] bg-[hsl(var(--bg-table-head))] px-2.5 py-1 rounded border border-[hsl(var(--border))]">
                          {edge.minTransitSeconds}s – {edge.maxTransitSeconds}s
                        </span>
                        <button
                          onClick={() => deleteEdge(edge.id)}
                          className="p-1.5 text-red-500 hover:bg-red-500/10 rounded-md transition-colors"
                          title="Remove pathway"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="flex items-center justify-between border-t border-[hsl(var(--border))] pt-4">
              <span className="text-xs text-[hsl(var(--text-muted))] font-mono">
                Persisted in: backend/spatial_handoff.json
              </span>
              <button
                onClick={() => setShowSavedModal(false)}
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Config Import Modal */}
      <ConfigImportModal
        isOpen={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        title="Import Spatial Flow & Portal Layout"
        configType="spatial_handoff"
        onSuccess={() => {
          window.location.reload();
        }}
      />
    </div>
  );
}
