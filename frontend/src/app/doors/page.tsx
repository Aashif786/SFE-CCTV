"use client";
import { useEffect, useState, useCallback } from "react";
import {
  Server, DoorClosed, Plus, Trash2, Edit2, CheckCircle2,
  AlertCircle, Loader2, RefreshCw, Send, ShieldAlert, Key, Check, Info,
  Camera, Video, Clock, ShieldCheck, Layers, Tag, GitFork, Download, Upload
} from "lucide-react";
import ConfigImportModal from "@/components/ConfigImportModal";

const API = "http://localhost:8001";

interface DoorStatus {
  ip: string;
  name: string;
  status: "Connected" | "Connecting" | "Error" | "Disconnected";
  last_error: string | null;
}

interface CameraItem {
  id: number;
  name: string;
  description?: string;
  location?: string;
  ip_address: string;
  enabled: boolean;
}

interface DoorConfig {
  ip: string;
  name: string;
  door_group?: string;
  username?: string;
  password?: string;
  cameras?: (number | string)[];
  portal_id?: string;
  portal_role?: "START" | "END" | "AUTO";
  correlation_window_seconds?: number;
}

interface SpatialPortal {
  id: string;
  facility_id: string;
  camera_id: string;
  local_id: string;
  role: "START" | "END" | "TRANSIT" | "STANDALONE";
  has_outgoing: boolean;
  has_incoming: boolean;
}

export default function DoorConfigsPage() {
  const [doors, setDoors] = useState<DoorStatus[]>([]);
  const [configs, setConfigs] = useState<DoorConfig[]>([]);
  const [cameras, setCameras] = useState<CameraItem[]>([]);
  const [trackingMode, setTrackingMode] = useState<string>("NORMAL");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [mounted, setMounted] = useState(false);

  // Form states
  const [ip, setIp] = useState("");
  const [name, setName] = useState("");
  const [doorGroup, setDoorGroup] = useState("");
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [selectedCameras, setSelectedCameras] = useState<(number | string)[]>([]);
  const [portals, setPortals] = useState<SpatialPortal[]>([]);
  const [portalId, setPortalId] = useState<string>("");
  const [portalRole, setPortalRole] = useState<"START" | "END" | "AUTO">("AUTO");
  const [correlationWindow, setCorrelationWindow] = useState<number>(10);
  const [editingIp, setEditingIp] = useState<string | null>(null);
  const [importModalOpen, setImportModalOpen] = useState(false);

  const handleExportDoors = () => {
    const apiBase = typeof window === "undefined" ? "http://localhost:8001" : `http://${window.location.hostname}:8001`;
    const url = `${apiBase}/api/identity/doors/export`;
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", "doors.json");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Simulator states
  const [simEmployeeId, setSimEmployeeId] = useState("");
  const [simGate, setSimGate] = useState("");
  const [simType, setSimType] = useState<"ENTRY" | "EXIT">("ENTRY");
  const [simulating, setSimulating] = useState(false);
  const [simResult, setSimResult] = useState<{ ok: boolean; msg: string; allowed?: string[] } | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [statusRes, configRes, camerasRes] = await Promise.all([
        fetch(`${API}/api/identity/doors`),
        fetch(`${API}/api/identity/doors/config`),
        fetch(`${API}/api/cameras`)
      ]);

      if (statusRes.ok) setDoors(await statusRes.json());
      if (configRes.ok) {
        const cfgs: DoorConfig[] = await configRes.json();
        setConfigs(cfgs);
        if (cfgs.length > 0 && !simGate) {
          setSimGate(cfgs[0].name);
        }
      }
      if (camerasRes.ok) {
        const cams = await camerasRes.json();
        setCameras(cams);
      }

      fetch(`${API}/api/spatial-handoff/portals`)
        .then(r => r.json())
        .then(d => { if (Array.isArray(d)) setPortals(d); })
        .catch(() => {});

      fetch(`${API}/api/settings/tracking-mode`)
        .then(r => r.json())
        .then(d => { if (d.tracking_mode) setTrackingMode(d.tracking_mode); })
        .catch(() => {});

      setLastRefresh(new Date());
    } catch (err) {
      console.error("Failed to fetch door data:", err);
    } finally {
      setLoading(false);
    }
  }, [simGate]);

  useEffect(() => {
    setMounted(true);
    fetchData();
    const interval = setInterval(fetchData, 4000);
    return () => clearInterval(interval);
  }, [fetchData]);


  const toggleCamera = (camId: number) => {
    setSelectedCameras(prev =>
      prev.includes(camId) ? prev.filter(id => id !== camId) : [...prev, camId]
    );
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ip.trim() || !name.trim()) return;

    setSaving(true);
    let updatedConfigs = [...configs];

    const doorItem: DoorConfig = {
      ip: ip.trim(),
      name: name.trim(),
      door_group: doorGroup.trim(),
      username: username.trim(),
      password: password,
      cameras: selectedCameras,
      portal_id: portalId.trim(),
      portal_role: portalRole,
      correlation_window_seconds: Number(correlationWindow) || 10
    };

    if (editingIp) {
      updatedConfigs = updatedConfigs.map(c => c.ip === editingIp ? doorItem : c);
    } else {
      if (configs.some(c => c.ip === doorItem.ip)) {
        alert("A door ACS with this IP already exists.");
        setSaving(false);
        return;
      }
      updatedConfigs.push(doorItem);
    }

    try {
      const res = await fetch(`${API}/api/identity/doors/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedConfigs)
      });

      if (res.ok) {
        setConfigs(updatedConfigs);
        resetForm();
        fetchData();
      } else {
        alert("Failed to save configuration.");
      }
    } catch (err) {
      console.error("Error saving configs:", err);
      alert("Network error while saving.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (targetIp: string) => {
    if (!confirm("Are you sure you want to delete this Door ACS configuration?")) return;

    setSaving(true);
    const updatedConfigs = configs.filter(c => c.ip !== targetIp);

    try {
      const res = await fetch(`${API}/api/identity/doors/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedConfigs)
      });

      if (res.ok) {
        setConfigs(updatedConfigs);
        fetchData();
      } else {
        alert("Failed to delete configuration.");
      }
    } catch (err) {
      console.error("Error deleting config:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (c: DoorConfig) => {
    setEditingIp(c.ip);
    setIp(c.ip);
    setName(c.name);
    setDoorGroup(c.door_group || "");
    setUsername(c.username || "admin");
    setPassword(c.password || "");
    setSelectedCameras(c.cameras || []);
    setPortalId(c.portal_id || "");
    setPortalRole(c.portal_role || "AUTO");
    setCorrelationWindow(c.correlation_window_seconds ?? 10);
  };

  const resetForm = () => {
    setEditingIp(null);
    setIp("");
    setName("");
    setDoorGroup("");
    setUsername("admin");
    setPassword("");
    setSelectedCameras([]);
    setPortalId("");
    setPortalRole("AUTO");
    setCorrelationWindow(10);
  };

  const handleSimulate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!simEmployeeId.trim() || !simGate) return;

    setSimulating(true);
    setSimResult(null);

    const targetDoor = configs.find(c => c.name === simGate || c.ip === simGate);
    const allowedCams = targetDoor?.cameras || [];

    try {
      const res = await fetch(`${API}/api/identity/entry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: simEmployeeId.trim().toUpperCase(),
          entryGate: simGate,
          eventType: simType,
          allowedCameras: allowedCams,
          correlationWindowSeconds: targetDoor?.correlation_window_seconds || 10
        })
      });

      if (res.ok) {
        const data = await res.json();
        const camsStr = allowedCams.length > 0
          ? allowedCams.map(c => `Cam ${c}`).join(", ")
          : "All enabled cameras";

        setSimResult({
          ok: true,
          msg: `Simulated ${simType} scan for ${data.employee_id} at "${simGate}". Person expected in [${camsStr}] within ${targetDoor?.correlation_window_seconds || 10}s.`,
          allowed: allowedCams.map(String)
        });
        setSimEmployeeId("");
      } else {
        throw new Error("API returned error status");
      }
    } catch (err: any) {
      setSimResult({
        ok: false,
        msg: `Failed to inject simulated event: ${err.message}`
      });
    } finally {
      setSimulating(false);
      setTimeout(() => setSimResult(null), 8000);
    }
  };

  const getStatus = (ip: string) => {
    const door = doors.find(d => d.ip === ip);
    return door ? door.status : "Disconnected";
  };

  const getLastError = (ip: string) => {
    const door = doors.find(d => d.ip === ip);
    return door ? door.last_error : null;
  };

  const getCameraName = (camId: number | string) => {
    const cam = cameras.find(c => String(c.id) === String(camId));
    return cam ? `${cam.name} (Cam ${cam.id})` : `Camera ${camId}`;
  };

  // Group configs by door_group for display
  const grouped = configs.reduce<Record<string, DoorConfig[]>>((acc, cfg) => {
    const grp = cfg.door_group?.trim() || "";
    if (!acc[grp]) acc[grp] = [];
    acc[grp].push(cfg);
    return acc;
  }, {});

  const activeSimDoor = configs.find(c => c.name === simGate || c.ip === simGate);
  const activeSimCams = activeSimDoor?.cameras || [];

  return (
    <div className="p-6 sm:p-8 space-y-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-3xl font-extrabold text-[hsl(var(--text-primary))] tracking-tight flex items-center gap-3">
            <DoorClosed className="w-8 h-8 text-emerald-500" />
            Door ACS Configuration
          </h2>
          <p className="text-sm text-[hsl(var(--text-muted))] mt-1">
            Each Door ACS unit (access controller) is configured independently with its own camera set.
            Multiple ACS units on the same physical door are grouped by Door Group label.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 self-start sm:self-center">
          {/* Tracking Mode Switcher */}
          <button
            onClick={async () => {
              const nextMode = trackingMode === "DOOR_BASED" ? "NORMAL" : "DOOR_BASED";
              try {
                const res = await fetch(`${API}/api/settings/tracking-mode`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ tracking_mode: nextMode }),
                });
                if (res.ok) {
                  const data = await res.json();
                  setTrackingMode(data.tracking_mode);
                }
              } catch (err) {
                console.error("Failed to toggle tracking mode:", err);
              }
            }}
            className={`flex items-center gap-2 text-xs font-bold px-3.5 py-2.5 rounded-lg border transition-all shadow-sm ${
              trackingMode === "DOOR_BASED"
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20"
                : "bg-blue-500/10 border-blue-500/30 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20"
            }`}
            title="Click to toggle system tracking mode between Normal Tracking and Door-Based Tracking"
          >
            <span className="w-2 h-2 rounded-full animate-pulse bg-current" />
            <span>Mode: {trackingMode === "DOOR_BASED" ? "Door-Based Tracking" : "Normal Tracking"}</span>
            <span className="text-[10px] underline ml-1 opacity-80">(Switch)</span>
          </button>

          <button
            onClick={fetchData}
            className="flex items-center gap-2 text-xs font-semibold
              text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))]
              bg-[hsl(var(--bg-card))] px-4 py-2.5 rounded-lg
              border border-[hsl(var(--border))] hover:border-[hsl(var(--border-strong))]
              transition-all shadow-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-emerald-500' : ''}`} />
            <span>Last Poll: {mounted ? lastRefresh.toLocaleTimeString() : "--:--:--"}</span>
          </button>

          <button
            onClick={handleExportDoors}
            className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg bg-[hsl(var(--bg-card))] hover:bg-[hsl(var(--bg-hover))] text-[hsl(var(--text-secondary))] border border-[hsl(var(--border))] text-xs font-bold transition-all shadow-sm active:scale-95"
            title="Export doors.json"
          >
            <Download className="w-3.5 h-3.5 text-amber-500" />
            Export doors.json
          </button>

          <button
            onClick={() => setImportModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg bg-[hsl(var(--bg-card))] hover:bg-[hsl(var(--bg-hover))] text-[hsl(var(--text-secondary))] border border-[hsl(var(--border))] text-xs font-bold transition-all shadow-sm active:scale-95"
            title="Import doors.json"
          >
            <Upload className="w-3.5 h-3.5 text-emerald-500" />
            Import doors.json
          </button>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

        {/* Left Column: Configured ACS list */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] rounded-xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Server className="w-5 h-5 text-emerald-500" />
                <h3 className="font-bold text-[hsl(var(--text-primary))] text-base">Configured ACS Units</h3>
              </div>
              <span className="text-xs text-[hsl(var(--text-muted))] font-semibold">
                {configs.length} Configured
              </span>
            </div>

            {configs.length === 0 ? (
              <div className="bg-[hsl(var(--bg-table-head))]/30 rounded-lg p-10 border border-dashed border-[hsl(var(--border-strong))] text-center">
                <AlertCircle className="w-10 h-10 text-[hsl(var(--text-muted))] mx-auto mb-3" />
                <p className="text-sm text-[hsl(var(--text-secondary))] font-semibold">No ACS units configured yet</p>
                <p className="text-xs text-[hsl(var(--text-muted))] mt-1">
                  Use the panel on the right to register your first Door ACS controller and assign its cameras.
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {Object.entries(grouped).map(([grp, acs_list]) => (
                  <div key={grp || "__ungrouped__"}>
                    {/* Door Group header */}
                    {grp && (
                      <div className="flex items-center gap-2 mb-2 px-1">
                        <Layers className="w-3.5 h-3.5 text-blue-400" />
                        <span className="text-xs font-bold text-blue-500 dark:text-blue-400 uppercase tracking-widest">
                          {grp}
                        </span>
                        <div className="flex-1 h-px bg-blue-500/20" />
                        <span className="text-[10px] text-[hsl(var(--text-muted))]">{acs_list.length} ACS unit{acs_list.length !== 1 ? "s" : ""}</span>
                      </div>
                    )}
                    <div className="grid grid-cols-1 gap-3">
                      {acs_list.map((cfg) => {
                        const status = getStatus(cfg.ip);
                        const lastError = getLastError(cfg.ip);
                        const cams = cfg.cameras || [];
                        const windowSec = cfg.correlation_window_seconds ?? 10;

                        return (
                          <div
                            key={cfg.ip}
                            className="p-5 bg-[hsl(var(--bg-table-head))]/40 border border-[hsl(var(--border))] rounded-xl flex flex-col gap-3 relative hover:border-[hsl(var(--border-strong))] transition-all"
                          >
                            <div className="flex items-start justify-between">
                              <div>
                                <div className="flex items-center gap-2.5 flex-wrap">
                                  <h4 className="font-bold text-[hsl(var(--text-primary))] text-base">{cfg.name}</h4>
                                  <span className="text-xs px-2 py-0.5 rounded-full bg-slate-500/10 text-[hsl(var(--text-muted))] font-mono font-medium border border-[hsl(var(--border))]">
                                    {cfg.ip}
                                  </span>
                                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 font-semibold border border-blue-500/20 flex items-center gap-1">
                                    <Clock className="w-3 h-3" />
                                    {windowSec}s Window
                                  </span>
                                </div>
                              </div>
                              <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1.5 ${
                                status === "Connected"
                                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20"
                                  : status === "Connecting"
                                  ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20"
                                  : "bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20"
                              }`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${
                                  status === "Connected" ? "bg-emerald-500 animate-pulse"
                                  : status === "Connecting" ? "bg-amber-500 animate-spin"
                                  : "bg-red-500"
                                }`} />
                                {status}
                              </span>
                            </div>

                            {/* Assigned Cameras */}
                            <div className="p-3 bg-[hsl(var(--bg-card))] border border-emerald-500/20 rounded-lg">
                              <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 mb-1.5">
                                <Camera className="w-3.5 h-3.5 text-emerald-500" />
                                <span>Assigned Cameras</span>
                                <span className="ml-auto text-[10px] text-[hsl(var(--text-muted))] font-normal">
                                  Person expected here after card swipe
                                </span>
                              </div>
                              {cams.length === 0 ? (
                                <span className="text-[11px] text-[hsl(var(--text-muted))] italic">All cameras (unrestricted)</span>
                              ) : (
                                <div className="flex flex-wrap gap-1.5">
                                  {cams.map(cid => (
                                    <span key={cid} className="text-[11px] px-2 py-0.5 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 rounded font-medium border border-emerald-500/30 flex items-center gap-1">
                                      <Video className="w-3 h-3 text-emerald-500" />
                                      {getCameraName(cid)}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>

                            {/* Associated Portal & Pathway Role */}
                            <div className="p-3 bg-[hsl(var(--bg-card))] border border-purple-500/20 rounded-lg">
                              <div className="flex items-center gap-1.5 text-xs font-semibold text-purple-600 dark:text-purple-400 mb-1.5">
                                <GitFork className="w-3.5 h-3.5 text-purple-500" />
                                <span>Associated Portal & Pathway Role</span>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                {cfg.portal_id ? (
                                  <span className="text-[11px] px-2.5 py-0.5 bg-purple-500/10 text-purple-700 dark:text-purple-300 rounded font-medium border border-purple-500/30">
                                    {cfg.portal_id}
                                  </span>
                                ) : (
                                  <span className="text-[11px] text-[hsl(var(--text-muted))] italic">Automatic (nearest camera portal)</span>
                                )}
                                <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${
                                  cfg.portal_role === "START"
                                    ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30"
                                    : cfg.portal_role === "END"
                                    ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30"
                                    : "bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/30"
                                }`}>
                                  {cfg.portal_role === "START" ? "START Node (Register Appearance)" : cfg.portal_role === "END" ? "END Node (Match Appearance)" : "AUTO (Topology)"}
                                </span>
                              </div>
                            </div>

                            {lastError && (
                              <div className="p-2.5 bg-red-500/5 rounded-lg border border-red-500/10 text-[11px] text-red-600 dark:text-red-400 font-mono break-all leading-relaxed">
                                <span className="font-semibold block mb-0.5">Connection Error:</span>
                                {lastError}
                              </div>
                            )}

                            <div className="flex items-center justify-between text-[11px] text-[hsl(var(--text-muted))] border-t border-[hsl(var(--border))]/50 pt-2 mt-1">
                              <div className="flex items-center gap-1">
                                <Key className="w-3.5 h-3.5 text-[hsl(var(--text-muted))]" />
                                <span>Auth User: <span className="text-[hsl(var(--text-secondary))] font-medium">{cfg.username || "admin"}</span></span>
                              </div>

                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => handleEdit(cfg)}
                                  className="p-1.5 text-[hsl(var(--text-secondary))] hover:text-emerald-500 hover:bg-[hsl(var(--bg-table-head))] border border-[hsl(var(--border))] rounded transition-all flex items-center gap-1 text-xs"
                                  title="Edit ACS & Camera Assignments"
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                  <span>Edit</span>
                                </button>
                                <button
                                  onClick={() => handleDelete(cfg.ip)}
                                  disabled={saving}
                                  className="p-1.5 text-[hsl(var(--text-muted))] hover:text-red-500 hover:bg-red-500/5 border border-[hsl(var(--border))] rounded transition-all disabled:opacity-50 flex items-center gap-1 text-xs"
                                  title="Delete ACS"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  <span>Delete</span>
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Architecture Guide */}
          <div className="bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] rounded-xl p-6 shadow-sm text-xs space-y-4 text-[hsl(var(--text-secondary))]">
            <h4 className="font-bold text-[hsl(var(--text-primary))] text-sm flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-500" />
              ACS-Centric Event Correlation
            </h4>
            <p className="leading-relaxed">
              Each physical door has independent Door ACS units on either side. When a card is swiped,
              the correlation engine looks for the employee on the cameras assigned to <strong>that specific ACS</strong> — not the other side.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
              <div className="p-3 bg-[hsl(var(--bg-table-head))]/30 border border-emerald-500/20 rounded-lg space-y-1">
                <span className="font-bold text-emerald-600 dark:text-emerald-400 block text-xs">1. Card Swipe</span>
                <p className="text-[11px] text-[hsl(var(--text-muted))] leading-relaxed">
                  Employee taps card at a Door ACS unit. The ACS reports the event to this system.
                </p>
              </div>
              <div className="p-3 bg-[hsl(var(--bg-table-head))]/30 border border-blue-500/20 rounded-lg space-y-1">
                <span className="font-bold text-blue-600 dark:text-blue-400 block text-xs">2. Camera Lookup</span>
                <p className="text-[11px] text-[hsl(var(--text-muted))] leading-relaxed">
                  System resolves which cameras are assigned to <em>that ACS unit</em> and creates a timed expectation.
                </p>
              </div>
              <div className="p-3 bg-[hsl(var(--bg-table-head))]/30 border border-purple-500/20 rounded-lg space-y-1">
                <span className="font-bold text-purple-600 dark:text-purple-400 block text-xs">3. Track Match</span>
                <p className="text-[11px] text-[hsl(var(--text-muted))] leading-relaxed">
                  When the person appears on a matched camera within the correlation window, the Track ID is bound to the Employee ID.
                </p>
              </div>
            </div>
            <div className="p-3 bg-blue-500/5 border border-blue-500/15 rounded-lg flex gap-2">
              <Info className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />
              <p className="text-[11px] text-[hsl(var(--text-muted))] leading-relaxed">
                <strong className="text-[hsl(var(--text-secondary))]">Door Group</strong> — Use the optional Door Group label to visually group multiple ACS units that belong to the same physical door (e.g. "Main Entrance Side A" and "Main Entrance Side B" both in group "Main Entrance").
              </p>
            </div>
          </div>
        </div>

        {/* Right Column: Add / Edit Form + Simulator */}
        <div className="space-y-6 lg:col-span-1">
          {/* Add / Edit Form */}
          <div className="bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] rounded-xl p-6 shadow-sm">
            <h3 className="font-bold text-[hsl(var(--text-primary))] text-base mb-4 flex items-center gap-2">
              <Plus className="w-5 h-5 text-emerald-500" />
              {editingIp ? "Edit ACS & Camera Assignments" : "Add Door ACS Unit"}
            </h3>

            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[hsl(var(--text-secondary))] mb-1.5 uppercase tracking-wider">IP Address</label>
                <input
                  type="text"
                  placeholder="e.g. 192.168.1.231"
                  value={ip}
                  onChange={e => setIp(e.target.value)}
                  disabled={!!editingIp}
                  required
                  className="w-full bg-[hsl(var(--bg-input))] border border-[hsl(var(--border-strong))]
                    rounded-lg px-3.5 py-2.5 text-[hsl(var(--text-primary))] text-xs
                    focus:outline-none focus:border-emerald-500 transition-colors disabled:opacity-50"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[hsl(var(--text-secondary))] mb-1.5 uppercase tracking-wider">ACS Unit Name</label>
                <input
                  type="text"
                  placeholder="e.g. Main Entrance — Side A"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  required
                  className="w-full bg-[hsl(var(--bg-input))] border border-[hsl(var(--border-strong))]
                    rounded-lg px-3.5 py-2.5 text-[hsl(var(--text-primary))] text-xs
                    focus:outline-none focus:border-emerald-500 transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[hsl(var(--text-secondary))] mb-1.5 uppercase tracking-wider flex items-center gap-1">
                  <Tag className="w-3 h-3 text-blue-400" />
                  Door Group <span className="text-[10px] normal-case font-normal text-[hsl(var(--text-muted))]">(optional — groups ACS units visually)</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. Main Entrance"
                  value={doorGroup}
                  onChange={e => setDoorGroup(e.target.value)}
                  className="w-full bg-[hsl(var(--bg-input))] border border-[hsl(var(--border-strong))]
                    rounded-lg px-3.5 py-2.5 text-[hsl(var(--text-primary))] text-xs
                    focus:outline-none focus:border-blue-400 transition-colors"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[hsl(var(--text-secondary))] mb-1.5 uppercase tracking-wider">Username</label>
                  <input
                    type="text"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    required
                    className="w-full bg-[hsl(var(--bg-input))] border border-[hsl(var(--border-strong))]
                      rounded-lg px-3 py-2 text-[hsl(var(--text-primary))] text-xs
                      focus:outline-none focus:border-emerald-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[hsl(var(--text-secondary))] mb-1.5 uppercase tracking-wider">Password</label>
                  <input
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="w-full bg-[hsl(var(--bg-input))] border border-[hsl(var(--border-strong))]
                      rounded-lg px-3 py-2 text-[hsl(var(--text-primary))] text-xs
                      focus:outline-none focus:border-emerald-500 transition-colors"
                  />
                </div>
              </div>

              {/* Assigned Cameras */}
              <div className="pt-1">
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider flex items-center gap-1">
                    <Camera className="w-3.5 h-3.5 text-emerald-500" />
                    Assigned Cameras
                  </label>
                  <span className="text-[10px] text-[hsl(var(--text-muted))]">{selectedCameras.length} selected</span>
                </div>
                <div className="bg-[hsl(var(--bg-input))] border border-[hsl(var(--border-strong))] rounded-lg p-2.5 max-h-44 overflow-y-auto space-y-1.5">
                  {cameras.length === 0 ? (
                    <span className="text-xs text-[hsl(var(--text-muted))] italic">No cameras found.</span>
                  ) : (
                    cameras.map(c => {
                      const isSelected = selectedCameras.some(id => String(id) === String(c.id));
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => toggleCamera(c.id)}
                          className={`w-full text-left px-2.5 py-1.5 rounded text-xs flex items-center justify-between transition-all ${
                            isSelected
                              ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-semibold border border-emerald-500/30"
                              : "text-[hsl(var(--text-secondary))] hover:bg-[hsl(var(--bg-table-head))] border border-transparent"
                          }`}
                        >
                          <span className="flex items-center gap-2">
                            <Video className={`w-3.5 h-3.5 ${isSelected ? "text-emerald-500" : "text-[hsl(var(--text-muted))]"}`} />
                            <span>{c.name} (Cam {c.id})</span>
                          </span>
                          {isSelected && <Check className="w-3.5 h-3.5 text-emerald-500" />}
                        </button>
                      );
                    })
                  )}
                </div>
                <p className="text-[10px] text-[hsl(var(--text-muted))] mt-1">
                  Leave empty to allow matching on any active camera.
                </p>
              </div>

              {/* Associated Portal Selection */}
              <div>
                <label className="block text-xs font-semibold text-[hsl(var(--text-secondary))] mb-1.5 uppercase tracking-wider flex items-center gap-1">
                  <GitFork className="w-3.5 h-3.5 text-purple-500" />
                  Associated Portal (Optional)
                </label>
                <select
                  value={portalId}
                  onChange={e => setPortalId(e.target.value)}
                  className="w-full bg-[hsl(var(--bg-input))] border border-[hsl(var(--border-strong))]
                    rounded-lg px-3 py-2 text-[hsl(var(--text-primary))] text-xs
                    focus:outline-none focus:border-purple-500 transition-colors"
                >
                  <option value="">Auto-select nearest camera portal</option>
                  {portals
                    .filter(p => selectedCameras.length === 0 || selectedCameras.some(c => String(c) === String(p.camera_id)))
                    .map(p => (
                      <option key={p.id} value={p.id}>
                        {p.id} ({p.role} Node)
                      </option>
                    ))}
                </select>
                <span className="text-[10px] text-[hsl(var(--text-muted))] mt-1 block">
                  Link this Door ACS to a spatial portal from the Portal Flow diagram.
                </span>
              </div>

              {/* Pathway Node Role */}
              <div>
                <label className="block text-xs font-semibold text-[hsl(var(--text-secondary))] mb-1.5 uppercase tracking-wider">
                  Pathway Role
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setPortalRole("AUTO")}
                    className={`py-2 px-2.5 rounded-lg text-xs font-semibold border transition-all text-center ${
                      portalRole === "AUTO"
                        ? "bg-blue-500/20 text-blue-600 dark:text-blue-400 border-blue-500/40"
                        : "border-[hsl(var(--border))] text-[hsl(var(--text-secondary))] hover:bg-[hsl(var(--bg-table-head))]"
                    }`}
                  >
                    AUTO
                  </button>
                  <button
                    type="button"
                    onClick={() => setPortalRole("START")}
                    className={`py-2 px-2.5 rounded-lg text-xs font-semibold border transition-all text-center ${
                      portalRole === "START"
                        ? "bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/40"
                        : "border-[hsl(var(--border))] text-[hsl(var(--text-secondary))] hover:bg-[hsl(var(--bg-table-head))]"
                    }`}
                  >
                    START Node
                  </button>
                  <button
                    type="button"
                    onClick={() => setPortalRole("END")}
                    className={`py-2 px-2.5 rounded-lg text-xs font-semibold border transition-all text-center ${
                      portalRole === "END"
                        ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/40"
                        : "border-[hsl(var(--border))] text-[hsl(var(--text-secondary))] hover:bg-[hsl(var(--bg-table-head))]"
                    }`}
                  >
                    END Node
                  </button>
                </div>
                <p className="text-[10px] text-[hsl(var(--text-muted))] mt-1">
                  {portalRole === "START" && "START: Person appearance is captured & registered on check-in for downstream transitions."}
                  {portalRole === "END" && "END: Person appearance is matched from incoming pathway connections."}
                  {portalRole === "AUTO" && "AUTO: Engine dynamically selects strategy based on Portal Flow topology."}
                </p>
              </div>

              {/* Correlation Window */}
              <div>
                <label className="block text-xs font-semibold text-[hsl(var(--text-secondary))] mb-1.5 uppercase tracking-wider flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5 text-blue-500" />
                  Correlation Window (Seconds)
                </label>
                <input
                  type="number"
                  min="2"
                  max="120"
                  value={correlationWindow}
                  onChange={e => setCorrelationWindow(Number(e.target.value))}
                  required
                  className="w-full bg-[hsl(var(--bg-input))] border border-[hsl(var(--border-strong))]
                    rounded-lg px-3.5 py-2.5 text-[hsl(var(--text-primary))] text-xs
                    focus:outline-none focus:border-emerald-500 transition-colors"
                />
                <span className="text-[10px] text-[hsl(var(--text-muted))] mt-1 block">
                  Max seconds after card swipe for the person to appear on an assigned camera.
                </span>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  disabled={saving || !ip.trim() || !name.trim()}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg
                    bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed
                    text-white font-semibold text-xs transition-all shadow-sm"
                >
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  <span>{editingIp ? "Save Changes" : "Register ACS Unit"}</span>
                </button>

                {editingIp && (
                  <button
                    type="button"
                    onClick={resetForm}
                    className="px-3 py-2.5 rounded-lg border border-[hsl(var(--border))]
                      text-[hsl(var(--text-secondary))] hover:bg-[hsl(var(--bg-table-head))] text-xs font-semibold"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </form>
          </div>

          {/* Event Simulator */}
          <div className="bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] rounded-xl p-6 shadow-sm">
            <h3 className="font-bold text-[hsl(var(--text-primary))] text-base mb-1.5 flex items-center gap-2">
              <Send className="w-4 h-4 text-emerald-500" />
              Event Simulator(Legacy)
            </h3>
            <p className="text-xs text-[hsl(var(--text-muted))] mb-4">
              Inject a simulated card swipe to test ACS → camera correlation with live feeds.
            </p>

            <form onSubmit={handleSimulate} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[hsl(var(--text-secondary))] mb-1.5 uppercase tracking-wider">Employee ID</label>
                <input
                  type="text"
                  placeholder="e.g. EMP001"
                  value={simEmployeeId}
                  onChange={e => setSimEmployeeId(e.target.value)}
                  required
                  className="w-full bg-[hsl(var(--bg-input))] border border-[hsl(var(--border-strong))]
                    rounded-lg px-3.5 py-2.5 text-[hsl(var(--text-primary))] text-xs
                    focus:outline-none focus:border-emerald-500 transition-colors"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[hsl(var(--text-secondary))] mb-1.5 uppercase tracking-wider">ACS Unit</label>
                  <select
                    value={simGate}
                    onChange={e => setSimGate(e.target.value)}
                    required
                    className="w-full bg-[hsl(var(--bg-input))] border border-[hsl(var(--border-strong))]
                      rounded-lg px-3 py-2 text-[hsl(var(--text-primary))] text-xs
                      focus:outline-none focus:border-emerald-500 transition-colors"
                  >
                    {configs.length === 0 ? (
                      <option value="">No configured ACS units</option>
                    ) : (
                      configs.map(c => (
                        <option key={c.ip} value={c.name}>{c.name}</option>
                      ))
                    )}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[hsl(var(--text-secondary))] mb-1.5 uppercase tracking-wider">Direction</label>
                  <select
                    value={simType}
                    onChange={e => setSimType(e.target.value as "ENTRY" | "EXIT")}
                    className="w-full bg-[hsl(var(--bg-input))] border border-[hsl(var(--border-strong))]
                      rounded-lg px-3 py-2 text-[hsl(var(--text-primary))] text-xs
                      focus:outline-none focus:border-emerald-500 transition-colors"
                  >
                    <option value="ENTRY">ENTRY (Check-in)</option>
                    <option value="EXIT">EXIT (Check-out)</option>
                  </select>
                </div>
              </div>

              {/* Preview of cameras for this ACS */}
              <div className="p-2.5 bg-[hsl(var(--bg-table-head))]/40 border border-[hsl(var(--border))] rounded-lg text-[11px] space-y-1">
                <span className="font-semibold text-[hsl(var(--text-secondary))] block">
                  Cameras for this ACS unit:
                </span>
                {activeSimCams.length === 0 ? (
                  <span className="text-[hsl(var(--text-muted))] italic">All cameras (unrestricted)</span>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {activeSimCams.map(cid => (
                      <span key={cid} className="px-1.5 py-0.5 rounded font-mono text-[10px] font-semibold border
                        bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/25">
                        Cam {cid}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={simulating || !simEmployeeId.trim() || !simGate}
                className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-lg
                  bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed
                  text-white font-semibold text-xs transition-all shadow-sm"
              >
                {simulating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                <span>Simulate {simType} Event</span>
              </button>
            </form>

            {simResult && (
              <div className={`mt-4 px-4 py-3 rounded-lg text-xs border ${
                simResult.ok
                  ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-700 dark:text-emerald-400"
                  : "bg-red-500/10 border-red-500/25 text-red-600 dark:text-red-400"
              }`}>
                {simResult.msg}
              </div>
            )}
          </div>
        </div>

      </div>

      {/* Config Import Modal */}
      <ConfigImportModal
        isOpen={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        title="Import Doors & ACS Configuration"
        configType="doors"
        onSuccess={() => {
          fetchData();
        }}
      />
    </div>
  );
}
