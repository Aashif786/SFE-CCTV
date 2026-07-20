"use client";
import { useState, useEffect, useCallback } from "react";
import {
  Radar, Search, Wifi, WifiOff, Camera, DoorClosed, Server,
  RefreshCw, Loader2, Plus, CheckCircle2, AlertTriangle, Globe,
  ArrowRight, Monitor, CircleDot, Network, HelpCircle
} from "lucide-react";
import CameraFormModal from "@/components/cameras/CameraFormModal";
import type { CameraFormData } from "@/hooks/useCameras";

const API = "http://localhost:8000";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface DiscoveredDevice {
  ip: string;
  open_ports: number[];
  device_type: string;       // "Camera" | "Door Controller" | "Network Device" | etc.
  brand: string;
  model: string;
  serial: string;
  firmware: string;
  mac: string;
  hostname: string;
  already_configured: boolean;
  configured_as: string;     // "camera" | "door" | ""
  configured_name: string;
}

interface ScanProgress {
  scanned: number;
  total: number;
  status: string;
  subnet?: string;
}

// ---------------------------------------------------------------------------
// Device type icon helper
// ---------------------------------------------------------------------------
function DeviceIcon({ type, className }: { type: string; className?: string }) {
  const cls = className || "w-5 h-5";
  switch (type) {
    case "Camera": return <Camera className={cls} />;
    case "Door Controller": return <DoorClosed className={cls} />;
    default: return <Monitor className={cls} />;
  }
}

// ---------------------------------------------------------------------------
// Device type color helper
// ---------------------------------------------------------------------------
function deviceColor(type: string) {
  switch (type) {
    case "Camera": return { bg: "bg-blue-500/10", text: "text-blue-600 dark:text-blue-400", border: "border-blue-500/20", icon: "text-blue-500" };
    case "Door Controller": return { bg: "bg-amber-500/10", text: "text-amber-600 dark:text-amber-400", border: "border-amber-500/20", icon: "text-amber-500" };
    default: return { bg: "bg-gray-500/10", text: "text-gray-600 dark:text-gray-400", border: "border-gray-500/20", icon: "text-gray-500" };
  }
}

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------
export default function ToolsPage() {
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<ScanProgress>({ scanned: 0, total: 0, status: "idle" });
  const [devices, setDevices] = useState<DiscoveredDevice[]>([]);
  const [subnet, setSubnet] = useState("");
  const [customSubnet, setCustomSubnet] = useState("");
  const [hasScanned, setHasScanned] = useState(false);
  const [filter, setFilter] = useState<"all" | "unconfigured" | "cameras" | "doors">("all");
  const [addingIp, setAddingIp] = useState<string | null>(null);

  // Modal state for adding camera
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedDeviceForCamera, setSelectedDeviceForCamera] = useState<DiscoveredDevice | null>(null);
  const [cameraInitialValues, setCameraInitialValues] = useState<Partial<CameraFormData> | null>(null);

  // Fetch detected subnet and any existing scan results on mount
  useEffect(() => {
    fetch(`${API}/api/tools/subnet`)
      .then(res => res.json())
      .then(data => {
        setSubnet(data.subnet);
        setCustomSubnet(prev => prev || data.subnet);
      })
      .catch(() => {});

    // Check for previous scan results or ongoing scan on backend
    fetch(`${API}/api/tools/scan/results`)
      .then(res => res.json())
      .then(data => {
        if (data.progress) {
          setProgress(data.progress);
          if (data.progress.subnet) {
            setCustomSubnet(data.progress.subnet);
          }
        }
        if (data.in_progress) {
          setScanning(true);
        } else if (data.devices && data.devices.length > 0) {
          setDevices(data.devices);
          setHasScanned(true);
        }
      })
      .catch(() => {});
  }, []);

  // Poll for scan progress while scanning
  useEffect(() => {
    if (!scanning) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API}/api/tools/scan/results`);
        const data = await res.json();
        setProgress(data.progress);

        if (!data.in_progress) {
          setScanning(false);
          setDevices(data.devices || []);
          setHasScanned(true);
          clearInterval(interval);
        }
      } catch {}
    }, 800);
    return () => clearInterval(interval);
  }, [scanning]);

  const startScan = async () => {
    setScanning(true);
    setDevices([]);
    setProgress({ scanned: 0, total: 0, status: "scanning" });
    setHasScanned(false);
    try {
      const targetSubnet = customSubnet.trim() || subnet;
      await fetch(`${API}/api/tools/scan?subnet=${encodeURIComponent(targetSubnet)}`, { method: "POST" });
    } catch (err) {
      console.error("Failed to start scan:", err);
      setScanning(false);
    }
  };

  // Open Add Camera modal with prefilled data directly on this page
  const handleAddCamera = (device: DiscoveredDevice) => {
    setSelectedDeviceForCamera(device);
    const validBrands = ["Hikvision", "Dahua", "Uniview", "Axis", "Hanwha", "Other"];
    const brand = validBrands.includes(device.brand) ? device.brand : "Hikvision";
    const ipSuffix = device.ip.split(".").pop();
    const defaultName = device.model
      ? device.model
      : `${device.brand !== "Unknown" ? device.brand : "Camera"}-${ipSuffix}`;

    setCameraInitialValues({
      ip_address: device.ip,
      camera_brand: brand,
      name: defaultName,
      rtsp_port: 554,
      stream_path: "/Streaming/Channels/101",
      username: "admin",
      password: "",
      enabled: true,
      recording_enabled: false,
    });
    setModalOpen(true);
  };

  const handleCameraSaved = () => {
    if (selectedDeviceForCamera) {
      const savedName = cameraInitialValues?.name || "Camera";
      setDevices(prev =>
        prev.map(d =>
          d.ip === selectedDeviceForCamera.ip
            ? { ...d, already_configured: true, configured_as: "camera", configured_name: savedName }
            : d
        )
      );
    }
    // Re-sync backend scan results
    fetch(`${API}/api/tools/scan/results`)
      .then(res => res.json())
      .then(data => {
        if (data.devices) setDevices(data.devices);
      })
      .catch(() => {});
  };

  const handleAddDoor = async (device: DiscoveredDevice) => {
    setAddingIp(device.ip);
    try {
      // Fetch current door configs
      const res = await fetch(`${API}/api/identity/doors/config`);
      const currentDoors = await res.json();
      
      // Add new door
      const newDoor = {
        ip: device.ip,
        name: device.model ? `${device.model}` : `Door-${device.ip.split('.').pop()}`,
        username: "admin",
        password: "",
      };
      
      const updated = [...currentDoors, newDoor];
      const saveRes = await fetch(`${API}/api/identity/doors/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });

      if (saveRes.ok) {
        // Update local state to show as configured
        setDevices(prev =>
          prev.map(d =>
            d.ip === device.ip
              ? { ...d, already_configured: true, configured_as: "door", configured_name: newDoor.name }
              : d
          )
        );
      }
    } catch (err) {
      console.error("Failed to add door:", err);
    } finally {
      setAddingIp(null);
    }
  };

  // Filtered devices
  const filteredDevices = devices.filter(d => {
    switch (filter) {
      case "unconfigured": return !d.already_configured;
      case "cameras": return d.device_type === "Camera";
      case "doors": return d.device_type === "Door Controller";
      default: return true;
    }
  });

  const stats = {
    total: devices.length,
    unconfigured: devices.filter(d => !d.already_configured).length,
    cameras: devices.filter(d => d.device_type === "Camera").length,
    doors: devices.filter(d => d.device_type === "Door Controller").length,
    other: devices.filter(d => d.device_type !== "Camera" && d.device_type !== "Door Controller").length,
  };

  return (
    <div className="p-6 sm:p-8 space-y-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-3xl font-extrabold text-[hsl(var(--text-primary))] tracking-tight flex items-center gap-3">
            <Radar className="w-8 h-8 text-emerald-500" />
            Network Device Scanner
          </h2>
          <p className="text-sm text-[hsl(var(--text-muted))] mt-1">
            Discover unconfigured cameras, door controllers, and other IP devices on your network.
          </p>
        </div>
      </div>

      {/* Scan Controls */}
      <div className="bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] rounded-xl p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row items-start sm:items-end gap-4">
          {/* Subnet Input */}
          <div className="flex-1 min-w-0">
            <label className="block text-xs font-semibold text-[hsl(var(--text-secondary))] mb-1.5 uppercase tracking-wider">
              Target Subnet (CIDR)
            </label>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[hsl(var(--text-muted))]" />
                <input
                  type="text"
                  value={customSubnet}
                  onChange={e => setCustomSubnet(e.target.value)}
                  placeholder="e.g. 192.168.1.0/24"
                  disabled={scanning}
                  className="w-full bg-[hsl(var(--bg-input))] border border-[hsl(var(--border-strong))]
                    rounded-lg pl-10 pr-3.5 py-2.5 text-[hsl(var(--text-primary))] text-sm
                    focus:outline-none focus:border-emerald-500 transition-colors disabled:opacity-50
                    font-mono"
                />
              </div>
            </div>
            {subnet && (
              <p className="text-[11px] text-[hsl(var(--text-muted))] mt-1.5 flex items-center gap-1">
                <Network className="w-3 h-3" />
                Auto-detected: <span className="font-mono font-medium text-[hsl(var(--text-secondary))]">{subnet}</span>
              </p>
            )}
          </div>

          {/* Scan Button */}
          <button
            onClick={startScan}
            disabled={scanning}
            className="flex items-center gap-2 px-6 py-2.5 rounded-lg
              bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed
              text-white font-semibold text-sm transition-all shadow-sm whitespace-nowrap"
          >
            {scanning ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Scanning...
              </>
            ) : (
              <>
                <Search className="w-4 h-4" />
                Start Scan
              </>
            )}
          </button>
        </div>

        {/* Progress Bar */}
        {scanning && progress.total > 0 && (
          <div className="mt-5 space-y-2">
            <div className="flex items-center justify-between text-xs text-[hsl(var(--text-secondary))]">
              <span className="flex items-center gap-1.5">
                <Radar className="w-3.5 h-3.5 text-emerald-500 animate-pulse" />
                Scanning <span className="font-mono font-bold">{progress.subnet || customSubnet}</span>
              </span>
              <span className="font-mono">
                {progress.scanned} / {progress.total} hosts
              </span>
            </div>
            <div className="w-full h-2 bg-[hsl(var(--bg-table-head))] rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all duration-300 ease-out"
                style={{ width: `${progress.total > 0 ? (progress.scanned / progress.total) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Results Section */}
      {(hasScanned || devices.length > 0) && (
        <>
          {/* Stats Row */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              { label: "Total Found", value: stats.total, icon: CircleDot, color: "text-[hsl(var(--text-primary))]" },
              { label: "Unconfigured", value: stats.unconfigured, icon: AlertTriangle, color: stats.unconfigured > 0 ? "text-amber-500" : "text-emerald-500" },
              { label: "Cameras", value: stats.cameras, icon: Camera, color: "text-blue-500" },
              { label: "Door Controllers", value: stats.doors, icon: DoorClosed, color: "text-amber-500" },
              { label: "Other Devices", value: stats.other, icon: Monitor, color: "text-gray-500" },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] rounded-xl p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-1">
                  <Icon className={`w-4 h-4 ${color}`} />
                  <span className="text-xs text-[hsl(var(--text-muted))] font-medium">{label}</span>
                </div>
                <span className={`text-2xl font-extrabold ${color}`}>{value}</span>
              </div>
            ))}
          </div>

          {/* Filter Tabs */}
          <div className="flex items-center gap-2 flex-wrap">
            {(["all", "unconfigured", "cameras", "doors"] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all border ${
                  filter === f
                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25"
                    : "bg-[hsl(var(--bg-card))] text-[hsl(var(--text-secondary))] border-[hsl(var(--border))] hover:border-[hsl(var(--border-strong))]"
                }`}
              >
                {f === "all" ? `All (${stats.total})` : 
                 f === "unconfigured" ? `Unconfigured (${stats.unconfigured})` :
                 f === "cameras" ? `Cameras (${stats.cameras})` :
                 `Doors (${stats.doors})`}
              </button>
            ))}
          </div>

          {/* Device Cards */}
          {filteredDevices.length === 0 ? (
            <div className="bg-[hsl(var(--bg-card))] border border-dashed border-[hsl(var(--border-strong))] rounded-xl p-10 text-center">
              <HelpCircle className="w-10 h-10 text-[hsl(var(--text-muted))] mx-auto mb-3" />
              <p className="text-sm text-[hsl(var(--text-secondary))] font-semibold">
                {filter === "all" ? "No devices found on this subnet" : `No ${filter} devices found`}
              </p>
              <p className="text-xs text-[hsl(var(--text-muted))] mt-1">
                Try adjusting the subnet range or ensure devices are powered on and connected.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredDevices.map(device => {
                const colors = deviceColor(device.device_type);
                const isAdding = addingIp === device.ip;

                return (
                  <div
                    key={device.ip}
                    className={`bg-[hsl(var(--bg-card))] border rounded-xl p-5 shadow-sm transition-all hover:shadow-md ${
                      device.already_configured
                        ? "border-emerald-500/20 opacity-75"
                        : "border-[hsl(var(--border))] hover:border-[hsl(var(--border-strong))]"
                    }`}
                  >
                    {/* Header */}
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-lg ${colors.bg} flex items-center justify-center`}>
                          <DeviceIcon type={device.device_type} className={`w-5 h-5 ${colors.icon}`} />
                        </div>
                        <div>
                          <code className="text-sm font-bold text-[hsl(var(--text-primary))] font-mono">{device.ip}</code>
                          <div className={`text-[11px] font-semibold ${colors.text}`}>
                            {device.device_type}
                          </div>
                        </div>
                      </div>

                      {/* Status Badge */}
                      {device.already_configured ? (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          Configured
                        </span>
                      ) : (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          New
                        </span>
                      )}
                    </div>

                    {/* Device Details */}
                    <div className="space-y-1.5 text-xs text-[hsl(var(--text-muted))] mb-4">
                      {device.brand !== "Unknown" && (
                        <div className="flex items-center justify-between">
                          <span>Brand</span>
                          <span className="font-medium text-[hsl(var(--text-secondary))]">{device.brand}</span>
                        </div>
                      )}
                      {device.model && (
                        <div className="flex items-center justify-between">
                          <span>Model</span>
                          <span className="font-mono font-medium text-[hsl(var(--text-secondary))]">{device.model}</span>
                        </div>
                      )}
                      {device.mac && (
                        <div className="flex items-center justify-between">
                          <span>MAC</span>
                          <span className="font-mono text-[hsl(var(--text-secondary))]">{device.mac}</span>
                        </div>
                      )}
                      {device.firmware && (
                        <div className="flex items-center justify-between">
                          <span>Firmware</span>
                          <span className="font-mono text-[hsl(var(--text-secondary))]">{device.firmware}</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between">
                        <span>Open Ports</span>
                        <div className="flex gap-1">
                          {device.open_ports.map(p => (
                            <span key={p} className="font-mono px-1.5 py-0.5 rounded bg-[hsl(var(--bg-table-head))] text-[hsl(var(--text-secondary))] text-[10px]">
                              {p}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    {device.already_configured ? (
                      <div className="pt-3 border-t border-[hsl(var(--border))]/50 text-xs text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Already configured as {device.configured_as}{device.configured_name ? ` — "${device.configured_name}"` : ""}
                      </div>
                    ) : (
                      <div className="pt-3 border-t border-[hsl(var(--border))]/50 flex items-center gap-2">
                        {(device.device_type === "Camera" || device.device_type === "Network Device" || device.device_type === "Hikvision Device") && (
                          <button
                            onClick={() => handleAddCamera(device)}
                            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg
                              bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 dark:text-blue-400
                              border border-blue-500/20 hover:border-blue-500/30
                              text-xs font-semibold transition-all"
                          >
                            <Camera className="w-3.5 h-3.5" />
                            Add as Camera
                          </button>
                        )}
                        {(device.device_type === "Door Controller" || device.device_type === "Network Device" || device.device_type === "Hikvision Device") && (
                          <button
                            onClick={() => handleAddDoor(device)}
                            disabled={isAdding}
                            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg
                              bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400
                              border border-amber-500/20 hover:border-amber-500/30
                              text-xs font-semibold transition-all disabled:opacity-50"
                          >
                            {isAdding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <DoorClosed className="w-3.5 h-3.5" />}
                            Add as Door
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Empty State — before first scan */}
      {!hasScanned && !scanning && devices.length === 0 && (
        <div className="bg-[hsl(var(--bg-card))] border border-dashed border-[hsl(var(--border-strong))] rounded-xl p-16 text-center">
          <div className="w-20 h-20 rounded-2xl bg-emerald-500/10 flex items-center justify-center mx-auto mb-5">
            <Radar className="w-10 h-10 text-emerald-500" />
          </div>
          <h3 className="text-lg font-bold text-[hsl(var(--text-primary))] mb-2">
            Ready to Scan
          </h3>
          <p className="text-sm text-[hsl(var(--text-muted))] max-w-md mx-auto leading-relaxed">
            Click <strong>Start Scan</strong> to probe your local network for cameras, Hikvision door controllers,
            and other IP devices. The scanner checks common ports (RTSP 554, HTTP 80/443) and identifies Hikvision
            devices via ISAPI.
          </p>
          <div className="mt-6 flex items-center justify-center gap-6 text-xs text-[hsl(var(--text-muted))]">
            <span className="flex items-center gap-1.5">
              <Camera className="w-4 h-4 text-blue-500" /> RTSP Cameras
            </span>
            <span className="flex items-center gap-1.5">
              <DoorClosed className="w-4 h-4 text-amber-500" /> Door Controllers
            </span>
            <span className="flex items-center gap-1.5">
              <Monitor className="w-4 h-4 text-gray-500" /> Other Devices
            </span>
          </div>
        </div>
      )}

      {/* Add Camera Modal */}
      <CameraFormModal
        isOpen={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setSelectedDeviceForCamera(null);
          setCameraInitialValues(null);
        }}
        onSaved={handleCameraSaved}
        initialValues={cameraInitialValues}
      />
    </div>
  );
}
