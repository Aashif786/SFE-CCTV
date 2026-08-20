"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Radar,
  Search,
  Wifi,
  WifiOff,
  Camera,
  DoorClosed,
  Server,
  RefreshCw,
  Loader2,
  Plus,
  CheckCircle2,
  AlertTriangle,
  Globe,
  ArrowRight,
  Monitor,
  CircleDot,
  Network,
  HelpCircle,
  Download,
  Upload,
  Package,
  Layers,
  Sliders,
  Users,
  GitFork,
  FileText,
  Copy,
  Check,
  Info,
  ShieldCheck,
} from "lucide-react";
import CameraFormModal from "@/components/cameras/CameraFormModal";
import ConfigImportModal from "@/components/ConfigImportModal";
import type { CameraFormData } from "@/hooks/useCameras";

const API = typeof window === "undefined" ? "http://localhost:8000" : `http://${window.location.hostname}:8000`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface DiscoveredDevice {
  ip: string;
  open_ports: number[];
  device_type: string; // "Camera" | "Door Controller" | "Network Device" | etc.
  brand: string;
  model: string;
  serial: string;
  firmware: string;
  mac: string;
  hostname: string;
  already_configured: boolean;
  configured_as: string; // "camera" | "door" | ""
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
    case "Camera":
      return <Camera className={cls} />;
    case "Door Controller":
      return <DoorClosed className={cls} />;
    default:
      return <Monitor className={cls} />;
  }
}

// ---------------------------------------------------------------------------
// Device type color helper
// ---------------------------------------------------------------------------
function deviceColor(type: string) {
  switch (type) {
    case "Camera":
      return { bg: "bg-blue-500/10", text: "text-blue-600 dark:text-blue-400", border: "border-blue-500/20", icon: "text-blue-500" };
    case "Door Controller":
      return { bg: "bg-amber-500/10", text: "text-amber-600 dark:text-amber-400", border: "border-amber-500/20", icon: "text-amber-500" };
    default:
      return { bg: "bg-gray-500/10", text: "text-gray-600 dark:text-gray-400", border: "border-gray-500/20", icon: "text-gray-500" };
  }
}

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------
export default function ToolsPage() {
  const [mainTab, setMainTab] = useState<"backup" | "scanner">("backup");

  // Scanner states
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<ScanProgress>({ scanned: 0, total: 0, status: "idle" });
  const [devices, setDevices] = useState<DiscoveredDevice[]>([]);
  const [subnet, setSubnet] = useState("");
  const [customSubnet, setCustomSubnet] = useState("");
  const [hasScanned, setHasScanned] = useState(false);
  const [filter, setFilter] = useState<"all" | "unconfigured" | "cameras" | "doors">("all");
  const [addingIp, setAddingIp] = useState<string | null>(null);

  // Modal states
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedDeviceForCamera, setSelectedDeviceForCamera] = useState<DiscoveredDevice | null>(null);
  const [cameraInitialValues, setCameraInitialValues] = useState<Partial<CameraFormData> | null>(null);

  // Config Import Modal state
  const [importModalConfig, setImportModalConfig] = useState<{
    isOpen: boolean;
    title: string;
    configType: "all" | "cameras" | "doors" | "spatial_handoff" | "camera_zones" | "settings" | "employees";
  }>({
    isOpen: false,
    title: "",
    configType: "all",
  });

  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);

  const showToast = (ok: boolean, msg: string) => {
    setToast({ ok, msg });
    setTimeout(() => setToast(null), 3500);
  };

  // Fetch detected subnet and any existing scan results on mount
  useEffect(() => {
    fetch(`${API}/api/tools/subnet`)
      .then((res) => res.json())
      .then((data) => {
        setSubnet(data.subnet);
        setCustomSubnet((prev) => prev || data.subnet);
      })
      .catch(() => {});

    // Check for previous scan results or ongoing scan on backend
    fetch(`${API}/api/tools/scan/results`)
      .then((res) => res.json())
      .then((data) => {
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
        }
      } catch (err) {
        console.error("Failed to poll scan status:", err);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [scanning]);

  // Trigger network scan
  const startScan = async () => {
    try {
      setScanning(true);
      setHasScanned(true);
      const res = await fetch(`${API}/api/tools/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subnet: customSubnet || undefined }),
      });
      const data = await res.json();
      if (data.subnet) {
        setProgress((prev) => ({ ...prev, subnet: data.subnet, status: "scanning" }));
      }
    } catch (err) {
      console.error("Failed to start scan:", err);
      setScanning(false);
    }
  };

  // Open modal to add discovered device as camera
  const handleAddCamera = (device: DiscoveredDevice) => {
    setSelectedDeviceForCamera(device);
    setCameraInitialValues({
      name: device.hostname || (device.brand ? `${device.brand} Camera` : `Camera ${device.ip.split(".").slice(-2).join(".")}`),
      ip_address: device.ip,
      rtsp_port: 554,
      stream_path: "/Streaming/Channels/101",
      camera_brand: device.brand || "Hikvision",
      stream_type: "Main",
      location: "Office",
      building: "Main Building",
      enabled: true,
    });
    setModalOpen(true);
  };

  const handleCameraSaved = () => {
    setModalOpen(false);
    if (selectedDeviceForCamera) {
      setDevices((prev) =>
        prev.map((d) =>
          d.ip === selectedDeviceForCamera.ip
            ? { ...d, already_configured: true, configured_as: "camera", configured_name: cameraInitialValues?.name || "Camera" }
            : d
        )
      );
    }
    setSelectedDeviceForCamera(null);
    setCameraInitialValues(null);
  };

  // Quick-add door controller
  const handleAddDoor = async (device: DiscoveredDevice) => {
    setAddingIp(device.ip);
    try {
      const configRes = await fetch(`${API}/api/identity/doors/config`);
      const currentDoors = configRes.ok ? await configRes.json() : [];

      const newDoor = {
        ip: device.ip,
        name: device.hostname || `Door (${device.ip})`,
        door_group: "",
        username: "admin",
        password: "",
        cameras: [],
        portal_id: "",
        portal_role: "AUTO",
        correlation_window_seconds: 10,
      };

      const updated = [...currentDoors, newDoor];
      const saveRes = await fetch(`${API}/api/identity/doors/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });

      if (saveRes.ok) {
        setDevices((prev) =>
          prev.map((d) =>
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

  // Trigger JSON Export Download
  const handleExport = (type: string) => {
    const url = `${API}/api/system/export/${type}`;
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", "");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast(true, `Exported ${type} configuration successfully!`);
  };

  const openImportModal = (
    title: string,
    configType: "all" | "cameras" | "doors" | "spatial_handoff" | "camera_zones" | "settings" | "employees"
  ) => {
    setImportModalConfig({
      isOpen: true,
      title,
      configType,
    });
  };

  // Filtered devices for scanner
  const filteredDevices = devices.filter((d) => {
    switch (filter) {
      case "unconfigured":
        return !d.already_configured;
      case "cameras":
        return d.device_type === "Camera";
      case "doors":
        return d.device_type === "Door Controller";
      default:
        return true;
    }
  });

  const stats = {
    total: devices.length,
    unconfigured: devices.filter((d) => !d.already_configured).length,
    cameras: devices.filter((d) => d.device_type === "Camera").length,
    doors: devices.filter((d) => d.device_type === "Door Controller").length,
    other: devices.filter((d) => d.device_type !== "Camera" && d.device_type !== "Door Controller").length,
  };

  return (
    <div className="p-6 sm:p-8 space-y-8 max-w-7xl mx-auto">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl shadow-xl border text-sm font-medium flex items-center gap-2 animate-slideUp ${
            toast.ok
              ? "bg-emerald-600 text-white border-emerald-500"
              : "bg-red-600 text-white border-red-500"
          }`}
        >
          {toast.ok ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
          {toast.msg}
        </div>
      )}

      {/* Header & Main Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[hsl(var(--border))] pb-6">
        <div>
          <h2 className="text-3xl font-extrabold text-[hsl(var(--text-primary))] tracking-tight flex items-center gap-3">
            <Package className="w-8 h-8 text-emerald-500" />
            System Tools & Migration
          </h2>
          <p className="text-sm text-[hsl(var(--text-muted))] mt-1">
            Export and import all JSON configurations, backup database setups, and discover network devices.
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center p-1.5 bg-[hsl(var(--bg-card))] rounded-xl border border-[hsl(var(--border))] shadow-sm">
          <button
            onClick={() => setMainTab("backup")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              mainTab === "backup"
                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 shadow-sm"
                : "text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
            }`}
          >
            <Download className="w-4 h-4" />
            JSON Backup & Migration
          </button>
          <button
            onClick={() => setMainTab("scanner")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              mainTab === "scanner"
                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 shadow-sm"
                : "text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
            }`}
          >
            <Radar className="w-4 h-4" />
            Network Device Scanner
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: JSON BACKUP & CONFIG MIGRATION                                     */}
      {/* ========================================================================= */}
      {mainTab === "backup" && (
        <div className="space-y-8 animate-fadeIn">
          {/* Hero Master Bundle Card */}
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-500/10 via-[hsl(var(--bg-card))] to-teal-500/10 border border-emerald-500/30 p-6 sm:p-8 shadow-sm">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
              <div className="space-y-2 max-w-2xl">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                  <ShieldCheck className="w-3.5 h-3.5" /> Full System Backup & Restore
                </div>
                <h3 className="text-2xl font-bold text-[hsl(var(--text-primary))]">
                  Master Configuration Bundle
                </h3>
                <p className="text-sm text-[hsl(var(--text-secondary))] leading-relaxed">
                  Export or import your complete CALVISION installation in a single JSON file. Includes all{" "}
                  <strong>Cameras & RTSP credentials</strong>, <strong>Door ACS controllers</strong>,{" "}
                  <strong>Portal Flow layouts</strong>, <strong>Polygonal ROI Zones</strong>,{" "}
                  <strong>AI Detection Settings</strong>, and <strong>Employee Assignments</strong>.
                </p>
              </div>

              <div className="flex flex-wrap sm:flex-nowrap items-center gap-3 shrink-0">
                <button
                  onClick={() => handleExport("all")}
                  className="flex items-center gap-2 px-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm transition-all shadow-md shadow-emerald-500/20 active:scale-95"
                >
                  <Download className="w-4 h-4" />
                  Export Full Bundle JSON
                </button>
                <button
                  onClick={() => openImportModal("Import Master Configuration Bundle", "all")}
                  className="flex items-center gap-2 px-5 py-3 rounded-xl bg-[hsl(var(--bg-input))] hover:bg-[hsl(var(--bg-hover))] text-[hsl(var(--text-primary))] border border-[hsl(var(--border-strong))] font-bold text-sm transition-all active:scale-95"
                >
                  <Upload className="w-4 h-4 text-emerald-500" />
                  Import Master Bundle
                </button>
              </div>
            </div>
          </div>

          {/* Migration Info Alert */}
          <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/20 text-xs text-blue-600 dark:text-blue-400 flex items-start gap-3">
            <Info className="w-5 h-5 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <span className="font-bold block">Why push/pull alone doesn't sync configs:</span>
              <p className="text-[hsl(var(--text-secondary))] leading-relaxed">
                Database entries (Cameras, ROI Zones, Employees) are stored in PostgreSQL on your local machine, and{" "}
                <code className="px-1.5 py-0.5 rounded bg-[hsl(var(--bg-table-head))] font-mono">settings.json</code> &{" "}
                <code className="px-1.5 py-0.5 rounded bg-[hsl(var(--bg-table-head))] font-mono">.env</code> are git-ignored for security.
                Use <strong>Export Full Bundle</strong> here (or run{" "}
                <code className="px-1.5 py-0.5 rounded bg-[hsl(var(--bg-table-head))] font-mono">python backend/manage_configs.py export all</code>
                ) to migrate everything to any new machine in one click!
              </p>
            </div>
          </div>

          {/* Modular Config Cards Grid */}
          <div>
            <h3 className="text-lg font-bold text-[hsl(var(--text-primary))] mb-4 flex items-center gap-2">
              <Layers className="w-5 h-5 text-emerald-500" />
              Modular Configuration Exports & Imports
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {/* 1. Camera Configurations */}
              <div className="bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] rounded-2xl p-5 shadow-sm hover:border-blue-500/30 transition-all flex flex-col justify-between">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-500 border border-blue-500/20">
                      <Camera className="w-5 h-5" />
                    </div>
                    <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded bg-[hsl(var(--bg-input))] text-[hsl(var(--text-muted))]">
                      cameras.json
                    </span>
                  </div>
                  <h4 className="font-bold text-base text-[hsl(var(--text-primary))]">Camera Configurations</h4>
                  <p className="text-xs text-[hsl(var(--text-muted))] leading-relaxed">
                    RTSP streams, camera brands, IP addresses, credentials, location, and enabled states.
                  </p>
                </div>

                <div className="pt-5 mt-4 border-t border-[hsl(var(--border))] flex items-center gap-2">
                  <button
                    onClick={() => handleExport("cameras")}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/20 text-xs font-bold transition-all"
                  >
                    <Download className="w-3.5 h-3.5" /> Export JSON
                  </button>
                  <button
                    onClick={() => openImportModal("Import Cameras Configuration", "cameras")}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-[hsl(var(--bg-input))] hover:bg-[hsl(var(--bg-hover))] text-[hsl(var(--text-secondary))] border border-[hsl(var(--border))] text-xs font-semibold transition-all"
                  >
                    <Upload className="w-3.5 h-3.5" /> Import JSON
                  </button>
                </div>
              </div>

              {/* 2. Door & Access Control */}
              <div className="bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] rounded-2xl p-5 shadow-sm hover:border-amber-500/30 transition-all flex flex-col justify-between">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-500 border border-amber-500/20">
                      <DoorClosed className="w-5 h-5" />
                    </div>
                    <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded bg-[hsl(var(--bg-input))] text-[hsl(var(--text-muted))]">
                      doors.json
                    </span>
                  </div>
                  <h4 className="font-bold text-base text-[hsl(var(--text-primary))]">Door & Portal ACS</h4>
                  <p className="text-xs text-[hsl(var(--text-muted))] leading-relaxed">
                    Hikvision door controllers, access points, door groups, camera bindings, and correlation timers.
                  </p>
                </div>

                <div className="pt-5 mt-4 border-t border-[hsl(var(--border))] flex items-center gap-2">
                  <button
                    onClick={() => handleExport("doors")}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/20 text-xs font-bold transition-all"
                  >
                    <Download className="w-3.5 h-3.5" /> Export JSON
                  </button>
                  <button
                    onClick={() => openImportModal("Import Doors Configuration", "doors")}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-[hsl(var(--bg-input))] hover:bg-[hsl(var(--bg-hover))] text-[hsl(var(--text-secondary))] border border-[hsl(var(--border))] text-xs font-semibold transition-all"
                  >
                    <Upload className="w-3.5 h-3.5" /> Import JSON
                  </button>
                </div>
              </div>

              {/* 3. Spatial Handoff & Portal Flow */}
              <div className="bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] rounded-2xl p-5 shadow-sm hover:border-purple-500/30 transition-all flex flex-col justify-between">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="p-2.5 rounded-xl bg-purple-500/10 text-purple-500 border border-purple-500/20">
                      <GitFork className="w-5 h-5" />
                    </div>
                    <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded bg-[hsl(var(--bg-input))] text-[hsl(var(--text-muted))]">
                      spatial_handoff.json
                    </span>
                  </div>
                  <h4 className="font-bold text-base text-[hsl(var(--text-primary))]">Spatial Flow & Portals</h4>
                  <p className="text-xs text-[hsl(var(--text-muted))] leading-relaxed">
                    Inter-camera transit pathways, portal polygon coordinates, canvas positions, and handoff timing.
                  </p>
                </div>

                <div className="pt-5 mt-4 border-t border-[hsl(var(--border))] flex items-center gap-2">
                  <button
                    onClick={() => handleExport("spatial_handoff")}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 text-purple-600 dark:text-purple-400 border border-purple-500/20 text-xs font-bold transition-all"
                  >
                    <Download className="w-3.5 h-3.5" /> Export JSON
                  </button>
                  <button
                    onClick={() => openImportModal("Import Spatial Flow & Portals", "spatial_handoff")}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-[hsl(var(--bg-input))] hover:bg-[hsl(var(--bg-hover))] text-[hsl(var(--text-secondary))] border border-[hsl(var(--border))] text-xs font-semibold transition-all"
                  >
                    <Upload className="w-3.5 h-3.5" /> Import JSON
                  </button>
                </div>
              </div>

              {/* 4. Camera ROI & Workstation Zones */}
              <div className="bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] rounded-2xl p-5 shadow-sm hover:border-emerald-500/30 transition-all flex flex-col justify-between">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                      <Layers className="w-5 h-5" />
                    </div>
                    <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded bg-[hsl(var(--bg-input))] text-[hsl(var(--text-muted))]">
                      camera_zones.json
                    </span>
                  </div>
                  <h4 className="font-bold text-base text-[hsl(var(--text-primary))]">Camera ROI & Workstations</h4>
                  <p className="text-xs text-[hsl(var(--text-muted))] leading-relaxed">
                    All polygonal dwell zones, colors, vertex points, and rectangular workstation boundaries.
                  </p>
                </div>

                <div className="pt-5 mt-4 border-t border-[hsl(var(--border))] flex items-center gap-2">
                  <button
                    onClick={() => handleExport("camera_zones")}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-xs font-bold transition-all"
                  >
                    <Download className="w-3.5 h-3.5" /> Export JSON
                  </button>
                  <button
                    onClick={() => openImportModal("Import Camera ROI & Workstation Zones", "camera_zones")}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-[hsl(var(--bg-input))] hover:bg-[hsl(var(--bg-hover))] text-[hsl(var(--text-secondary))] border border-[hsl(var(--border))] text-xs font-semibold transition-all"
                  >
                    <Upload className="w-3.5 h-3.5" /> Import JSON
                  </button>
                </div>
              </div>

              {/* 5. AI Detection & Tracker Settings */}
              <div className="bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] rounded-2xl p-5 shadow-sm hover:border-cyan-500/30 transition-all flex flex-col justify-between">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="p-2.5 rounded-xl bg-cyan-500/10 text-cyan-500 border border-cyan-500/20">
                      <Sliders className="w-5 h-5" />
                    </div>
                    <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded bg-[hsl(var(--bg-input))] text-[hsl(var(--text-muted))]">
                      settings.json
                    </span>
                  </div>
                  <h4 className="font-bold text-base text-[hsl(var(--text-primary))]">AI & Tracker Settings</h4>
                  <p className="text-xs text-[hsl(var(--text-muted))] leading-relaxed">
                    YOLO model, BoT-SORT tracker hyperparameters, confidence threshold, EMA smoothing, and profiles.
                  </p>
                </div>

                <div className="pt-5 mt-4 border-t border-[hsl(var(--border))] flex items-center gap-2">
                  <button
                    onClick={() => handleExport("settings")}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-600 dark:text-cyan-400 border border-cyan-500/20 text-xs font-bold transition-all"
                  >
                    <Download className="w-3.5 h-3.5" /> Export JSON
                  </button>
                  <button
                    onClick={() => openImportModal("Import AI & Tracker Settings", "settings")}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-[hsl(var(--bg-input))] hover:bg-[hsl(var(--bg-hover))] text-[hsl(var(--text-secondary))] border border-[hsl(var(--border))] text-xs font-semibold transition-all"
                  >
                    <Upload className="w-3.5 h-3.5" /> Import JSON
                  </button>
                </div>
              </div>

              {/* 6. Employees & Zone Assignments */}
              <div className="bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] rounded-2xl p-5 shadow-sm hover:border-pink-500/30 transition-all flex flex-col justify-between">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="p-2.5 rounded-xl bg-pink-500/10 text-pink-500 border border-pink-500/20">
                      <Users className="w-5 h-5" />
                    </div>
                    <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded bg-[hsl(var(--bg-input))] text-[hsl(var(--text-muted))]">
                      employees.json
                    </span>
                  </div>
                  <h4 className="font-bold text-base text-[hsl(var(--text-primary))]">Employees & Work Zones</h4>
                  <p className="text-xs text-[hsl(var(--text-muted))] leading-relaxed">
                    Employee registry, departments, designations, tracking toggles, and designated work zone mappings.
                  </p>
                </div>

                <div className="pt-5 mt-4 border-t border-[hsl(var(--border))] flex items-center gap-2">
                  <button
                    onClick={() => handleExport("employees")}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-pink-500/10 hover:bg-pink-500/20 text-pink-600 dark:text-pink-400 border border-pink-500/20 text-xs font-bold transition-all"
                  >
                    <Download className="w-3.5 h-3.5" /> Export JSON
                  </button>
                  <button
                    onClick={() => openImportModal("Import Employees & Work Zones", "employees")}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-[hsl(var(--bg-input))] hover:bg-[hsl(var(--bg-hover))] text-[hsl(var(--text-secondary))] border border-[hsl(var(--border))] text-xs font-semibold transition-all"
                  >
                    <Upload className="w-3.5 h-3.5" /> Import JSON
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: NETWORK DEVICE SCANNER                                             */}
      {/* ========================================================================= */}
      {mainTab === "scanner" && (
        <div className="space-y-8 animate-fadeIn">
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
                      onChange={(e) => setCustomSubnet(e.target.value)}
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
                    <Radar className="w-4 h-4" />
                    Start Scan
                  </>
                )}
              </button>
            </div>

            {/* Progress Bar */}
            {scanning && (
              <div className="mt-4 pt-4 border-t border-[hsl(var(--border))] space-y-2">
                <div className="flex items-center justify-between text-xs text-[hsl(var(--text-muted))]">
                  <span>Scanning network...</span>
                  <span className="font-mono">
                    {progress.scanned} / {progress.total} hosts ({progress.total > 0 ? Math.round((progress.scanned / progress.total) * 100) : 0}%)
                  </span>
                </div>
                <div className="w-full h-2 bg-[hsl(var(--bg-table-head))] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 transition-all duration-300 rounded-full"
                    style={{
                      width: `${progress.total > 0 ? (progress.scanned / progress.total) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Results Section */}
          {hasScanned && (
            <>
              {/* Stats Bar & Filter */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-[hsl(var(--text-muted))]">Found:</span>
                  <span className="font-bold text-[hsl(var(--text-primary))]">{stats.total} devices</span>
                  <span className="text-[hsl(var(--text-muted))]">•</span>
                  <span className="text-amber-500 font-medium">{stats.unconfigured} unconfigured</span>
                  <span className="text-[hsl(var(--text-muted))]">•</span>
                  <span className="text-blue-500 font-medium">{stats.cameras} cameras</span>
                  <span className="text-[hsl(var(--text-muted))]">•</span>
                  <span className="text-amber-500 font-medium">{stats.doors} doors</span>
                </div>

                {/* Filter buttons */}
                <div className="flex items-center gap-1 bg-[hsl(var(--bg-card))] p-1 rounded-lg border border-[hsl(var(--border))]">
                  {(["all", "unconfigured", "cameras", "doors"] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setFilter(f)}
                      className={`px-3 py-1 rounded text-xs font-semibold transition-all capitalize ${
                        filter === f
                          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                          : "text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              {/* Devices Grid */}
              {filteredDevices.length === 0 ? (
                <div className="bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] rounded-xl p-12 text-center">
                  <WifiOff className="w-12 h-12 text-[hsl(var(--text-muted))] mx-auto mb-3 opacity-40" />
                  <h4 className="font-bold text-[hsl(var(--text-primary))] mb-1">No devices found</h4>
                  <p className="text-xs text-[hsl(var(--text-muted))]">
                    {filter !== "all"
                      ? `No devices matching the "${filter}" filter.`
                      : "No active devices responded on the scanned subnet."}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredDevices.map((device) => {
                    const colors = deviceColor(device.device_type);
                    const isAdding = addingIp === device.ip;

                    return (
                      <div
                        key={device.ip}
                        className={`bg-[hsl(var(--bg-card))] border rounded-xl p-5 shadow-sm transition-all hover:shadow-md ${
                          device.already_configured
                            ? "border-[hsl(var(--border))]"
                            : "border-amber-500/30 hover:border-amber-500/50"
                        }`}
                      >
                        {/* Device Header */}
                        <div className="flex items-start justify-between gap-3 mb-3">
                          <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-lg ${colors.bg} ${colors.icon} border ${colors.border}`}>
                              <DeviceIcon type={device.device_type} />
                            </div>
                            <div>
                              <h4 className="font-bold text-sm text-[hsl(var(--text-primary))] font-mono">
                                {device.ip}
                              </h4>
                              <p className="text-[11px] text-[hsl(var(--text-muted))]">
                                {device.hostname || device.brand || "Unknown host"}
                              </p>
                            </div>
                          </div>

                          {/* Device Type Badge */}
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${colors.bg} ${colors.text} border ${colors.border}`}
                          >
                            {device.device_type}
                          </span>
                        </div>

                        {/* Details */}
                        <div className="space-y-1.5 text-xs text-[hsl(var(--text-muted))] mb-4">
                          {device.model && (
                            <div className="flex items-center justify-between">
                              <span>Model</span>
                              <span className="font-mono text-[hsl(var(--text-secondary))]">{device.model}</span>
                            </div>
                          )}
                          {device.serial && (
                            <div className="flex items-center justify-between">
                              <span>Serial</span>
                              <span className="font-mono text-[hsl(var(--text-secondary))]">{device.serial}</span>
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
                              {device.open_ports.map((p) => (
                                <span
                                  key={p}
                                  className="font-mono px-1.5 py-0.5 rounded bg-[hsl(var(--bg-table-head))] text-[hsl(var(--text-secondary))] text-[10px]"
                                >
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
                            Already configured as {device.configured_as}
                            {device.configured_name ? ` — "${device.configured_name}"` : ""}
                          </div>
                        ) : (
                          <div className="pt-3 border-t border-[hsl(var(--border))]/50 flex items-center gap-2">
                            {(device.device_type === "Camera" ||
                              device.device_type === "Network Device" ||
                              device.device_type === "Hikvision Device") && (
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
                            {(device.device_type === "Door Controller" ||
                              device.device_type === "Network Device" ||
                              device.device_type === "Hikvision Device") && (
                              <button
                                onClick={() => handleAddDoor(device)}
                                disabled={isAdding}
                                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg
                                  bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400
                                  border border-amber-500/20 hover:border-amber-500/30
                                  text-xs font-semibold transition-all disabled:opacity-50"
                              >
                                {isAdding ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <DoorClosed className="w-3.5 h-3.5" />
                                )}
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
              <h3 className="text-lg font-bold text-[hsl(var(--text-primary))] mb-2">Ready to Scan</h3>
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

      {/* Config Import Modal */}
      <ConfigImportModal
        isOpen={importModalConfig.isOpen}
        onClose={() => setImportModalConfig((prev) => ({ ...prev, isOpen: false }))}
        title={importModalConfig.title}
        configType={importModalConfig.configType}
        onSuccess={() => {
          showToast(true, "Configuration imported successfully!");
        }}
      />
    </div>
  );
}
