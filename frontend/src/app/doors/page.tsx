"use client";
import { useEffect, useState, useCallback } from "react";
import {
  Server, DoorClosed, Plus, Trash2, Edit2, CheckCircle2,
  AlertCircle, Loader2, RefreshCw, Send, ShieldAlert, Key, Check, Info
} from "lucide-react";

const API = "http://localhost:8000";

interface DoorStatus {
  ip: string;
  name: string;
  status: "Connected" | "Connecting" | "Error" | "Disconnected";
  last_error: string | null;
}

interface DoorConfig {
  ip: string;
  name: string;
  username?: string;
  password?: string;
}

export default function DoorConfigsPage() {
  const [doors, setDoors] = useState<DoorStatus[]>([]);
  const [configs, setConfigs] = useState<DoorConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  
  // Form states
  const [ip, setIp] = useState("");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [editingIp, setEditingIp] = useState<string | null>(null);
  
  // Simulator states
  const [simEmployeeId, setSimEmployeeId] = useState("");
  const [simGate, setSimGate] = useState("");
  const [simType, setSimType] = useState<"ENTRY" | "EXIT">("ENTRY");
  const [simulating, setSimulating] = useState(false);
  const [simResult, setSimResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [statusRes, configRes] = await Promise.all([
        fetch(`${API}/api/identity/doors`),
        fetch(`${API}/api/identity/doors/config`)
      ]);
      
      if (statusRes.ok) setDoors(await statusRes.json());
      if (configRes.ok) {
        const cfgs = await configRes.json();
        setConfigs(cfgs);
        if (cfgs.length > 0 && !simGate) {
          setSimGate(cfgs[0].name); // default simulator gate
        }
      }
      setLastRefresh(new Date());
    } catch (err) {
      console.error("Failed to fetch door data:", err);
    } finally {
      setLoading(false);
    }
  }, [simGate]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 4000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ip.trim() || !name.trim()) return;

    setSaving(true);
    let updatedConfigs = [...configs];

    const doorItem: DoorConfig = {
      ip: ip.trim(),
      name: name.trim(),
      username: username.trim(),
      password: password
    };

    if (editingIp) {
      updatedConfigs = updatedConfigs.map(c => c.ip === editingIp ? doorItem : c);
    } else {
      // Check if IP already exists
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
  };

  const resetForm = () => {
    setEditingIp(null);
    setIp("");
    setName("");
    setUsername("admin");
    setPassword("");
  };

  const handleSimulate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!simEmployeeId.trim() || !simGate) return;

    setSimulating(true);
    setSimResult(null);

    try {
      const res = await fetch(`${API}/api/identity/entry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: simEmployeeId.trim().toUpperCase(),
          entryGate: simGate,
          eventType: simType
        })
      });

      if (res.ok) {
        const data = await res.json();
        setSimResult({
          ok: true,
          msg: `Simulated ${simType} scan for ${data.employee_id} at ${simGate} successfully!`
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
      setTimeout(() => setSimResult(null), 5000);
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

  return (
    <div className="p-6 sm:p-8 space-y-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-3xl font-extrabold text-[hsl(var(--text-primary))] tracking-tight flex items-center gap-3">
            <DoorClosed className="w-8 h-8 text-emerald-500" />
            Door Configurations
          </h2>
          <p className="text-sm text-[hsl(var(--text-muted))] mt-1">
            Manage live door terminals, configure connection parameters, and run diagnostics utilities.
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
          <span>Last Poll: {lastRefresh.toLocaleTimeString()}</span>
        </button>
      </div>

      {/* Main Grid: Management & Add / Simulation */}
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
                <p className="text-xs text-[hsl(var(--text-muted))] mt-1">Use the panel on the right to add your first door terminal.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {configs.map((cfg) => {
                  const status = getStatus(cfg.ip);
                  const lastError = getLastError(cfg.ip);
                  
                  return (
                    <div
                      key={cfg.ip}
                      className="p-5 bg-[hsl(var(--bg-table-head))]/40 border border-[hsl(var(--border))] rounded-xl flex flex-col gap-3 relative hover:border-[hsl(var(--border-strong))] transition-all"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <h4 className="font-bold text-[hsl(var(--text-primary))] text-sm">{cfg.name}</h4>
                          <code className="text-xs text-[hsl(var(--text-muted))] block mt-0.5">{cfg.ip}</code>
                        </div>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1.5 ${
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

                      {lastError && (
                        <div className="p-2.5 bg-red-500/5 rounded-lg border border-red-500/10 text-[11px] text-red-600 dark:text-red-400 font-mono break-all leading-relaxed">
                          <span className="font-semibold block mb-0.5">Connection Error:</span>
                          {lastError}
                        </div>
                      )}

                      <div className="flex items-center gap-1 text-[11px] text-[hsl(var(--text-muted))] border-t border-[hsl(var(--border))]/50 pt-2 mt-auto">
                        <Key className="w-3.5 h-3.5 text-[hsl(var(--text-muted))]" />
                        <span>User: <span className="text-[hsl(var(--text-secondary))] font-medium">{cfg.username || "admin"}</span></span>
                      </div>

                      {/* Config Actions */}
                      <div className="absolute bottom-4 right-4 flex items-center gap-2">
                        <button
                          onClick={() => handleEdit(cfg)}
                          className="p-1.5 text-[hsl(var(--text-secondary))] hover:text-emerald-500 hover:bg-[hsl(var(--bg-table-head))] border border-[hsl(var(--border))] rounded transition-all"
                          title="Edit Credentials"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(cfg.ip)}
                          disabled={saving}
                          className="p-1.5 text-[hsl(var(--text-muted))] hover:text-red-500 hover:bg-red-500/5 border border-[hsl(var(--border))] rounded transition-all disabled:opacity-50"
                          title="Delete Door"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Guidelines Box */}
          <div className="bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] rounded-xl p-6 shadow-sm text-xs space-y-4 text-[hsl(var(--text-secondary))]">
            <h4 className="font-bold text-[hsl(var(--text-primary))] text-sm flex items-center gap-2">
              <Info className="w-4 h-4 text-emerald-500" />
              Deployment &amp; IP Network Details
            </h4>
            <p className="leading-relaxed">
              These door status nodes query the Hikvision Access Control Event API (`/ISAPI/AccessControl/AcsEvent`) using HTTP digest authentication. To deploy a terminal successfully:
            </p>
            <ul className="list-disc pl-5 space-y-2 text-[hsl(var(--text-muted))] leading-relaxed">
              <li>Ensure the physical Hikvision door controller IP is reachable from the CALVISION server host.</li>
              <li>AcsEvent log listening operates in a non-blocking daemon thread pool updated dynamically on save.</li>
              <li>Events are auto-buffered in-memory and committed asynchronously when workers walk within range of CCTVs.</li>
            </ul>
          </div>
        </div>

        {/* Right Column: Add Form + Simulator */}
        <div className="space-y-6 lg:col-span-1">
          {/* Add / Edit Form */}
          <div className="bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] rounded-xl p-6 shadow-sm">
            <h3 className="font-bold text-[hsl(var(--text-primary))] text-base mb-4 flex items-center gap-2">
              <Plus className="w-5 h-5 text-emerald-500" />
              {editingIp ? "Edit Terminal" : "Add Door Controller"}
            </h3>

            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[hsl(var(--text-secondary))] mb-1.5 uppercase tracking-wider">IP Address</label>
                <input
                  type="text"
                  placeholder="e.g. 192.168.1.100"
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
                <label className="block text-xs font-semibold text-[hsl(var(--text-secondary))] mb-1.5 uppercase tracking-wider">Gate/Door Name</label>
                <input
                  type="text"
                  placeholder="e.g. Assembly-Gate-A"
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

              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  disabled={saving || !ip.trim() || !name.trim()}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg
                    bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed
                    text-white font-semibold text-xs transition-all shadow-sm"
                >
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  <span>{editingIp ? "Save Changes" : "Register Door"}</span>
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
              Inject a simulated card swipe/face scan event to test CCTV camera correlation and logs.
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
                  <label className="block text-xs font-semibold text-[hsl(var(--text-secondary))] mb-1.5 uppercase tracking-wider">Sim Gate</label>
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
                    <option value="ENTRY">ENTRY (IN)</option>
                    <option value="EXIT">EXIT (OUT)</option>
                  </select>
                </div>
              </div>

              <button
                type="submit"
                disabled={simulating || !simEmployeeId.trim() || !simGate}
                className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-lg
                  bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed
                  text-white font-semibold text-xs transition-all shadow-sm"
              >
                {simulating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                <span>Simulate Event</span>
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
