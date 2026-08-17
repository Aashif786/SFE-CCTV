"use client";
import { useEffect, useState, useCallback } from "react";
import {
  Server, DoorClosed, Plus, Trash2, Edit2, CheckCircle2,
  AlertCircle, Loader2, RefreshCw, Send, ShieldAlert, Key, Check, Info,
  Camera, Video, ArrowRightCircle, ArrowLeftCircle, Clock, ShieldCheck
} from "lucide-react";

const API = "http://localhost:8000";

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
  username?: string;
  password?: string;
  check_in_cameras?: (number | string)[];
  check_out_cameras?: (number | string)[];
  correlation_window_seconds?: number;
}

export default function DoorConfigsPage() {
  const [doors, setDoors] = useState<DoorStatus[]>([]);
  const [configs, setConfigs] = useState<DoorConfig[]>([]);
  const [cameras, setCameras] = useState<CameraItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [mounted, setMounted] = useState(false);

  
  // Form states
  const [ip, setIp] = useState("");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [checkInCameras, setCheckInCameras] = useState<(number | string)[]>([]);
  const [checkOutCameras, setCheckOutCameras] = useState<(number | string)[]>([]);
  const [correlationWindow, setCorrelationWindow] = useState<number>(10);
  const [editingIp, setEditingIp] = useState<string | null>(null);
  
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
          setSimGate(cfgs[0].name); // default simulator gate
        }
      }
      if (camerasRes.ok) {
        const cams = await camerasRes.json();
        setCameras(cams);
      }
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


  const toggleCheckInCam = (camId: number) => {
    setCheckInCameras(prev =>
      prev.includes(camId) ? prev.filter(id => id !== camId) : [...prev, camId]
    );
  };

  const toggleCheckOutCam = (camId: number) => {
    setCheckOutCameras(prev =>
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
      username: username.trim(),
      password: password,
      check_in_cameras: checkInCameras,
      check_out_cameras: checkOutCameras,
      correlation_window_seconds: Number(correlationWindow) || 10
    };

    if (editingIp) {
      updatedConfigs = updatedConfigs.map(c => c.ip === editingIp ? doorItem : c);
    } else {
      if (configs.some(c => c.ip === doorItem.ip)) {
        alert("A door controller with this IP already exists.");
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
    if (!confirm("Are you sure you want to delete this door controller configuration?")) return;
    
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
    setUsername(c.username || "admin");
    setPassword(c.password || "");
    setCheckInCameras(c.check_in_cameras || []);
    setCheckOutCameras(c.check_out_cameras || []);
    setCorrelationWindow(c.correlation_window_seconds ?? 10);
  };

  const resetForm = () => {
    setEditingIp(null);
    setIp("");
    setName("");
    setUsername("admin");
    setPassword("");
    setCheckInCameras([]);
    setCheckOutCameras([]);
    setCorrelationWindow(10);
  };

  const handleSimulate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!simEmployeeId.trim() || !simGate) return;

    setSimulating(true);
    setSimResult(null);

    // Find selected gate config
    const targetDoor = configs.find(c => c.name === simGate || c.ip === simGate);
    const expectedCams = targetDoor
      ? (simType === "EXIT" ? (targetDoor.check_out_cameras || []) : (targetDoor.check_in_cameras || []))
      : [];

    try {
      const res = await fetch(`${API}/api/identity/entry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: simEmployeeId.trim().toUpperCase(),
          entryGate: simGate,
          eventType: simType,
          allowedCameras: expectedCams,
          correlationWindowSeconds: targetDoor?.correlation_window_seconds || 10
        })
      });

      if (res.ok) {
        const data = await res.json();
        const camsStr = expectedCams.length > 0 
          ? expectedCams.map(c => `Cam ${c}`).join(", ") 
          : "All enabled cameras";

        setSimResult({
          ok: true,
          msg: `Simulated ${simType} scan for ${data.employee_id} at "${simGate}". Person is now expected in [${camsStr}] within ${targetDoor?.correlation_window_seconds || 10}s!`,
          allowed: expectedCams.map(String)
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

  // Helper to get camera name by id
  const getCameraName = (camId: number | string) => {
    const cam = cameras.find(c => String(c.id) === String(camId));
    return cam ? `${cam.name} (Cam ${cam.id})` : `Camera ${camId}`;
  };

  // Selected gate config for simulator preview
  const activeSimDoor = configs.find(c => c.name === simGate || c.ip === simGate);
  const activeSimAllowedCams = activeSimDoor 
    ? (simType === "EXIT" ? (activeSimDoor.check_out_cameras || []) : (activeSimDoor.check_in_cameras || []))
    : [];

  return (
    <div className="p-6 sm:p-8 space-y-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-3xl font-extrabold text-[hsl(var(--text-primary))] tracking-tight flex items-center gap-3">
            <DoorClosed className="w-8 h-8 text-emerald-500" />
            Door &amp; Event Correlation Configurations
          </h2>
          <p className="text-sm text-[hsl(var(--text-muted))] mt-1">
            Configure door terminals and map independent check-in and check-out camera expectations for physical event correlation.
          </p>
        </div>
        <button
          onClick={fetchData}
          className="self-start sm:self-center flex items-center gap-2 text-xs font-semibold
            text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))]
            bg-[hsl(var(--bg-card))] px-4 py-2.5 rounded-lg
            border border-[hsl(var(--border))] hover:border-[hsl(var(--border-strong))]
            transition-all shadow-sm"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-emerald-500' : ''}`} />
          <span>Last Poll: {mounted ? lastRefresh.toLocaleTimeString() : "--:--:--"}</span>
        </button>

      </div>

      {/* Main Grid: Terminals List & Add / Simulation */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Column: Configured Terminals list */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] rounded-xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Server className="w-5 h-5 text-emerald-500" />
                <h3 className="font-bold text-[hsl(var(--text-primary))] text-base">Connected Terminals</h3>
              </div>
              <span className="text-xs text-[hsl(var(--text-muted))] font-semibold">
                {configs.length} Configured
              </span>
            </div>

            {configs.length === 0 ? (
              <div className="bg-[hsl(var(--bg-table-head))]/30 rounded-lg p-10 border border-dashed border-[hsl(var(--border-strong))] text-center">
                <AlertCircle className="w-10 h-10 text-[hsl(var(--text-muted))] mx-auto mb-3" />
                <p className="text-sm text-[hsl(var(--text-secondary))] font-semibold">No configured doors yet</p>
                <p className="text-xs text-[hsl(var(--text-muted))] mt-1">Use the panel on the right to register your first door controller and configure its cameras.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {configs.map((cfg) => {
                  const status = getStatus(cfg.ip);
                  const lastError = getLastError(cfg.ip);
                  const inCams = cfg.check_in_cameras || [];
                  const outCams = cfg.check_out_cameras || [];
                  const windowSec = cfg.correlation_window_seconds ?? 10;
                  
                  return (
                    <div
                      key={cfg.ip}
                      className="p-5 bg-[hsl(var(--bg-table-head))]/40 border border-[hsl(var(--border))] rounded-xl flex flex-col gap-3 relative hover:border-[hsl(var(--border-strong))] transition-all"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-2.5">
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

                      {/* Camera Mappings Display */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                        {/* Check-In Cameras */}
                        <div className="p-3 bg-[hsl(var(--bg-card))] border border-emerald-500/20 rounded-lg">
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 mb-1.5">
                            <ArrowRightCircle className="w-3.5 h-3.5 text-emerald-500" />
                            <span>Check-in Expected Cameras (ENTRY)</span>
                          </div>
                          {inCams.length === 0 ? (
                            <span className="text-[11px] text-[hsl(var(--text-muted))] italic">All cameras (unrestricted)</span>
                          ) : (
                            <div className="flex flex-wrap gap-1.5">
                              {inCams.map(cid => (
                                <span key={cid} className="text-[11px] px-2 py-0.5 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 rounded font-medium border border-emerald-500/30 flex items-center gap-1">
                                  <Video className="w-3 h-3 text-emerald-500" />
                                  {getCameraName(cid)}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Check-Out Cameras */}
                        <div className="p-3 bg-[hsl(var(--bg-card))] border border-purple-500/20 rounded-lg">
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-purple-600 dark:text-purple-400 mb-1.5">
                            <ArrowLeftCircle className="w-3.5 h-3.5 text-purple-500" />
                            <span>Check-out Expected Cameras (EXIT)</span>
                          </div>
                          {outCams.length === 0 ? (
                            <span className="text-[11px] text-[hsl(var(--text-muted))] italic">None configured (auto-close)</span>
                          ) : (
                            <div className="flex flex-wrap gap-1.5">
                              {outCams.map(cid => (
                                <span key={cid} className="text-[11px] px-2 py-0.5 bg-purple-500/10 text-purple-700 dark:text-purple-300 rounded font-medium border border-purple-500/30 flex items-center gap-1">
                                  <Video className="w-3 h-3 text-purple-500" />
                                  {getCameraName(cid)}
                                </span>
                              ))}
                            </div>
                          )}
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

                        {/* Config Actions */}
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleEdit(cfg)}
                            className="p-1.5 text-[hsl(var(--text-secondary))] hover:text-emerald-500 hover:bg-[hsl(var(--bg-table-head))] border border-[hsl(var(--border))] rounded transition-all flex items-center gap-1 text-xs"
                            title="Edit Door & Camera Mappings"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                            <span>Edit</span>
                          </button>
                          <button
                            onClick={() => handleDelete(cfg.ip)}
                            disabled={saving}
                            className="p-1.5 text-[hsl(var(--text-muted))] hover:text-red-500 hover:bg-red-500/5 border border-[hsl(var(--border))] rounded transition-all disabled:opacity-50 flex items-center gap-1 text-xs"
                            title="Delete Door"
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
            )}
          </div>

          {/* Event Correlation Architecture Guide */}
          <div className="bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] rounded-xl p-6 shadow-sm text-xs space-y-4 text-[hsl(var(--text-secondary))]">
            <h4 className="font-bold text-[hsl(var(--text-primary))] text-sm flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-500" />
              Event-Driven Camera Correlation Logic
            </h4>
            <p className="leading-relaxed">
              When a person checks in or checks out at a door terminal, the system establishes an event-driven expectation:
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div className="p-3 bg-[hsl(var(--bg-table-head))]/30 border border-emerald-500/20 rounded-lg space-y-1">
                <span className="font-bold text-emerald-600 dark:text-emerald-400 block text-xs">1. Check-In (ENTRY) Path</span>
                <p className="text-[11px] text-[hsl(var(--text-muted))] leading-relaxed">
                  Person scans card / face at terminal &rarr; System creates an active expectation exclusively for the door&apos;s <strong>Check-in cameras</strong> within the configured time window. Detections on other cameras will NOT match this entry.
                </p>
              </div>
              <div className="p-3 bg-[hsl(var(--bg-table-head))]/30 border border-purple-500/20 rounded-lg space-y-1">
                <span className="font-bold text-purple-600 dark:text-purple-400 block text-xs">2. Check-Out (EXIT) Path</span>
                <p className="text-[11px] text-[hsl(var(--text-muted))] leading-relaxed">
                  Person scans out &rarr; System looks for the person in the door&apos;s <strong>Check-out cameras</strong> to record departure, and closes active tracking sessions cleanly.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Add / Edit Form + Simulator */}
        <div className="space-y-6 lg:col-span-1">
          {/* Add / Edit Form */}
          <div className="bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] rounded-xl p-6 shadow-sm">
            <h3 className="font-bold text-[hsl(var(--text-primary))] text-base mb-4 flex items-center gap-2">
              <Plus className="w-5 h-5 text-emerald-500" />
              {editingIp ? "Edit Door & Camera Mappings" : "Add Door Controller"}
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
                <label className="block text-xs font-semibold text-[hsl(var(--text-secondary))] mb-1.5 uppercase tracking-wider">Gate / Door Name</label>
                <input
                  type="text"
                  placeholder="e.g. Entrance Gate 01"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  required
                  className="w-full bg-[hsl(var(--bg-input))] border border-[hsl(var(--border-strong))]
                    rounded-lg px-3.5 py-2.5 text-[hsl(var(--text-primary))] text-xs
                    focus:outline-none focus:border-emerald-500 transition-colors"
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

              {/* Check-In Cameras Selection */}
              <div className="pt-1">
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider flex items-center gap-1">
                    <ArrowRightCircle className="w-3.5 h-3.5 text-emerald-500" />
                    Check-in Cameras (ENTRY)
                  </label>
                  <span className="text-[10px] text-[hsl(var(--text-muted))]">{checkInCameras.length} selected</span>
                </div>
                <div className="bg-[hsl(var(--bg-input))] border border-[hsl(var(--border-strong))] rounded-lg p-2.5 max-h-36 overflow-y-auto space-y-1.5">
                  {cameras.length === 0 ? (
                    <span className="text-xs text-[hsl(var(--text-muted))] italic">No cameras found.</span>
                  ) : (
                    cameras.map(c => {
                      const isSelected = checkInCameras.some(id => String(id) === String(c.id));
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => toggleCheckInCam(c.id)}
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
              </div>

              {/* Check-Out Cameras Selection */}
              <div className="pt-1">
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-purple-600 dark:text-purple-400 uppercase tracking-wider flex items-center gap-1">
                    <ArrowLeftCircle className="w-3.5 h-3.5 text-purple-500" />
                    Check-out Cameras (EXIT)
                  </label>
                  <span className="text-[10px] text-[hsl(var(--text-muted))]">{checkOutCameras.length} selected</span>
                </div>
                <div className="bg-[hsl(var(--bg-input))] border border-[hsl(var(--border-strong))] rounded-lg p-2.5 max-h-36 overflow-y-auto space-y-1.5">
                  {cameras.length === 0 ? (
                    <span className="text-xs text-[hsl(var(--text-muted))] italic">No cameras found.</span>
                  ) : (
                    cameras.map(c => {
                      const isSelected = checkOutCameras.some(id => String(id) === String(c.id));
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => toggleCheckOutCam(c.id)}
                          className={`w-full text-left px-2.5 py-1.5 rounded text-xs flex items-center justify-between transition-all ${
                            isSelected
                              ? "bg-purple-500/20 text-purple-700 dark:text-purple-300 font-semibold border border-purple-500/30"
                              : "text-[hsl(var(--text-secondary))] hover:bg-[hsl(var(--bg-table-head))] border border-transparent"
                          }`}
                        >
                          <span className="flex items-center gap-2">
                            <Video className={`w-3.5 h-3.5 ${isSelected ? "text-purple-500" : "text-[hsl(var(--text-muted))]"}`} />
                            <span>{c.name} (Cam {c.id})</span>
                          </span>
                          {isSelected && <Check className="w-3.5 h-3.5 text-purple-500" />}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Correlation Window Seconds */}
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
                  Time allowed after scan for the person to appear on the configured camera(s).
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
                  <span>{editingIp ? "Save Changes" : "Register Door & Mappings"}</span>
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

          {/* Check-in Simulation Panel */}
          <div className="bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] rounded-xl p-6 shadow-sm">
            <h3 className="font-bold text-[hsl(var(--text-primary))] text-base mb-1.5 flex items-center gap-2">
              <Send className="w-4 h-4 text-emerald-500" />
              Event Simulator
            </h3>
            <p className="text-xs text-[hsl(var(--text-muted))] mb-4">
              Inject a simulated card swipe/face scan to test camera correlation with live feeds.
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
                  <label className="block text-xs font-semibold text-[hsl(var(--text-secondary))] mb-1.5 uppercase tracking-wider">Gate</label>
                  <select
                    value={simGate}
                    onChange={e => setSimGate(e.target.value)}
                    required
                    className="w-full bg-[hsl(var(--bg-input))] border border-[hsl(var(--border-strong))]
                      rounded-lg px-3 py-2 text-[hsl(var(--text-primary))] text-xs
                      focus:outline-none focus:border-emerald-500 transition-colors"
                  >
                    {configs.length === 0 ? (
                      <option value="">No configured gates</option>
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

              {/* Preview of allowed cameras for this simulated event */}
              <div className="p-2.5 bg-[hsl(var(--bg-table-head))]/40 border border-[hsl(var(--border))] rounded-lg text-[11px] space-y-1">
                <span className="font-semibold text-[hsl(var(--text-secondary))] block">
                  Expected Cameras for this event:
                </span>
                {activeSimAllowedCams.length === 0 ? (
                  <span className="text-[hsl(var(--text-muted))] italic">
                    {simType === "ENTRY" ? "All cameras (unrestricted)" : "No exit cameras (immediate session close)"}
                  </span>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {activeSimAllowedCams.map(cid => (
                      <span key={cid} className={`px-1.5 py-0.5 rounded font-mono text-[10px] font-semibold border ${
                        simType === "ENTRY" 
                          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/25"
                          : "bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/25"
                      }`}>
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
    </div>
  );
}
