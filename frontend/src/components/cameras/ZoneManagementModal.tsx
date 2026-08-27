"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  X,
  Upload,
  Download,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  FileCode,
  Layers,
  RefreshCw,
  Plus,
  Info,
} from "lucide-react";
import type { LiveCamera, CameraInfo } from "@/hooks/useCameras";
import PolygonZoneEditor from "./PolygonZoneEditor";

interface ZoneItem {
  id: string;
  name: string;
  color: string;
  description?: string | null;
  points: [number, number][];
  enabled: boolean;
}

interface ZoneManagementModalProps {
  camera: { id: number; name: string } | null;
  isOpen: boolean;
  onClose: () => void;
  onZonesUpdated?: () => void;
}

export default function ZoneManagementModal({
  camera,
  isOpen,
  onClose,
  onZonesUpdated,
}: ZoneManagementModalProps) {
  const [zones, setZones] = useState<ZoneItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [rawJsonText, setRawJsonText] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"list" | "upload" | "editor">("list");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchZones = useCallback(async () => {
    if (!camera) return;
    setLoading(true);
    setError(null);
    try {
      const host =
        typeof window !== "undefined" ? window.location.hostname : "localhost";
      const res = await fetch(`http://${host}:8001/api/camera-zones/${camera.id}`);
      if (res.ok) {
        const data = await res.json();
        setZones(data.zones || []);
      } else {
        setError("Failed to fetch camera zones");
      }
    } catch (err: any) {
      setError("Network error fetching zones");
    } finally {
      setLoading(false);
    }
  }, [camera]);

  useEffect(() => {
    if (isOpen && camera) {
      fetchZones();
      setError(null);
      setSuccessMsg(null);
      setActiveTab("list");
    }
  }, [isOpen, camera, fetchZones]);

  if (!isOpen || !camera) return null;

  const handleFileUpload = async (file: File) => {
    setError(null);
    setSuccessMsg(null);
    setLoading(true);

    try {
      const text = await file.text();
      // Client-side quick check
      try {
        const parsed = JSON.parse(text);
        if (!parsed || (typeof parsed !== "object")) {
          throw new Error("Uploaded file is not a valid JSON object or array");
        }
      } catch (jsonErr: any) {
        setError(`JSON Error: ${jsonErr.message}`);
        setLoading(false);
        return;
      }

      const host =
        typeof window !== "undefined" ? window.location.hostname : "localhost";
      const res = await fetch(`http://${host}:8001/api/camera-zones/${camera.id}/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: text,
      });

      const result = await res.json();

      if (res.ok) {
        setSuccessMsg(result.message || "Zone configuration saved successfully!");
        setZones(result.zones || []);
        onZonesUpdated?.();
        setActiveTab("list");
      } else {
        setError(result.detail || "Failed to upload zone configuration");
      }
    } catch (err: any) {
      setError(`Upload failed: ${err.message || "Network error"}`);
    } finally {
      setLoading(false);
    }
  };

  const handleTextUpload = async () => {
    if (!rawJsonText.trim()) {
      setError("Please paste a JSON configuration first");
      return;
    }

    const dummyFile = new File([rawJsonText], "pasted_zones.json", {
      type: "application/json",
    });
    await handleFileUpload(dummyFile);
  };

  const handleExport = () => {
    const host =
      typeof window !== "undefined" ? window.location.hostname : "localhost";
    window.open(`http://${host}:8001/api/camera-zones/${camera.id}/export`, "_blank");
  };

  const handleClearAll = async () => {
    if (!confirm(`Are you sure you want to delete all zones for ${camera.name}?`)) return;

    setLoading(true);
    setError(null);
    try {
      const host =
        typeof window !== "undefined" ? window.location.hostname : "localhost";
      const res = await fetch(`http://${host}:8001/api/camera-zones/${camera.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setZones([]);
        setSuccessMsg("All zones cleared for this camera");
        onZonesUpdated?.();
      } else {
        setError("Failed to clear zones");
      }
    } catch (err: any) {
      setError("Network error clearing zones");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteSingle = async (zoneId: string) => {
    setLoading(true);
    setError(null);
    try {
      const host =
        typeof window !== "undefined" ? window.location.hostname : "localhost";
      const res = await fetch(
        `http://${host}:8001/api/camera-zones/${camera.id}/zone/${zoneId}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        setZones((prev) => prev.filter((z) => z.id !== zoneId));
        setSuccessMsg(`Deleted zone '${zoneId}'`);
        onZonesUpdated?.();
      } else {
        setError("Failed to delete zone");
      }
    } catch (err: any) {
      setError("Network error deleting zone");
    } finally {
      setLoading(false);
    }
  };

  const sampleJson = JSON.stringify(
    {
      cameraId: `CAM-${camera.id}`,
      zones: [
        {
          id: "zone_a",
          name: "Assembly Area",
          color: "#3B82F6",
          description: "Main worker assembly section",
          points: [
            [142, 93],
            [401, 81],
            [430, 287],
            [170, 315],
          ],
        },
        {
          id: "zone_b",
          name: "Inspection",
          color: "#10B981",
          description: "Quality assurance area",
          points: [
            [470, 120],
            [690, 110],
            [710, 330],
            [480, 340],
          ],
        },
      ],
    },
    null,
    2
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className={`bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] rounded-2xl w-full overflow-hidden shadow-2xl flex flex-col transition-all duration-200 ${
        activeTab === "editor" ? "w-[96vw] max-w-[1700px] h-[94vh]" : "max-w-2xl max-h-[90vh]"
      }`}>
        {/* Header */}
        <div className="px-6 py-3.5 border-b border-[hsl(var(--border))] flex items-center justify-between bg-[hsl(var(--bg-table-head))] shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-violet-500/10 border border-violet-500/20 text-violet-500 flex items-center justify-center">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-bold text-[hsl(var(--text-primary))]">
                Zone Configuration
              </h3>
              <p className="text-xs text-[hsl(var(--text-muted))]">
                {camera.name} (Camera ID: {camera.id})
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-card))] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-page))] px-6 shrink-0">
          <button
            onClick={() => setActiveTab("list")}
            className={`py-2.5 px-4 text-xs font-bold border-b-2 transition-colors flex items-center gap-2 ${
              activeTab === "list"
                ? "border-violet-500 text-violet-600 dark:text-violet-400"
                : "border-transparent text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
            }`}
          >
            <Layers className="w-4 h-4" />
            Configured Zones ({zones.length})
          </button>
          <button
            onClick={() => setActiveTab("upload")}
            className={`py-2.5 px-4 text-xs font-bold border-b-2 transition-colors flex items-center gap-2 ${
              activeTab === "upload"
                ? "border-violet-500 text-violet-600 dark:text-violet-400"
                : "border-transparent text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
            }`}
          >
            <Upload className="w-4 h-4" />
            Upload / Replace JSON
          </button>
          <button
            onClick={() => setActiveTab("editor")}
            className={`py-2.5 px-4 text-xs font-bold border-b-2 transition-colors flex items-center gap-2 ${
              activeTab === "editor"
                ? "border-blue-500 text-blue-600 dark:text-blue-400"
                : "border-transparent text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
            }`}
          >
            <Plus className="w-4 h-4" />
            Polygon Editor
          </button>
        </div>

        {/* Feedback Banners */}
        {error && (
          <div className="mx-6 mt-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs flex items-start gap-2.5 shrink-0">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="font-medium">{error}</span>
          </div>
        )}

        {successMsg && (
          <div className="mx-6 mt-3 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs flex items-center gap-2.5 shrink-0">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span className="font-medium">{successMsg}</span>
          </div>
        )}

        {/* Tab Content */}
        <div className={`flex-1 min-h-0 ${activeTab === "editor" ? "p-3 sm:p-4 flex flex-col overflow-hidden" : "p-6 overflow-y-auto"}`}>

          {activeTab === "list" && (
            <div className="space-y-4">
              {/* Controls bar */}
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-[hsl(var(--text-muted))] font-medium">
                  {zones.length === 0
                    ? "No polygonal zones configured for this camera"
                    : `${zones.length} zone(s) active`}
                </span>
                <div className="flex items-center gap-2">
                  {zones.length > 0 && (
                    <>
                      <button
                        onClick={handleExport}
                        className="px-3 py-1.5 rounded-lg border border-[hsl(var(--border))] text-xs font-medium bg-[hsl(var(--bg-table-head))] hover:bg-[hsl(var(--bg-card))] text-[hsl(var(--text-primary))] flex items-center gap-1.5 transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" /> Export JSON
                      </button>
                      <button
                        onClick={handleClearAll}
                        className="px-3 py-1.5 rounded-lg border border-red-500/20 text-xs font-medium bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400 flex items-center gap-1.5 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Clear All
                      </button>
                    </>
                  )}
                  <button
                    onClick={fetchZones}
                    disabled={loading}
                    className="p-1.5 rounded-lg border border-[hsl(var(--border))] text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
                    title="Refresh Zones"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
                  </button>
                </div>
              </div>

              {/* Zones list */}
              {zones.length === 0 ? (
                <div className="py-12 text-center border-2 border-dashed border-[hsl(var(--border))] rounded-2xl p-8 bg-[hsl(var(--bg-page))]">
                  <div className="w-12 h-12 rounded-full bg-violet-500/10 text-violet-500 flex items-center justify-center mx-auto mb-3">
                    <FileCode className="w-6 h-6" />
                  </div>
                  <h4 className="text-sm font-bold text-[hsl(var(--text-primary))]">
                    No Zones Configured
                  </h4>
                  <p className="text-xs text-[hsl(var(--text-muted))] max-w-sm mx-auto mt-1 mb-4">
                    Upload a JSON file containing polygon definitions to enable zone-based dwell tracking for this camera.
                  </p>
                  <button
                    onClick={() => setActiveTab("upload")}
                    className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-xs font-bold inline-flex items-center gap-2 shadow-lg shadow-violet-500/20 transition-all"
                  >
                    <Upload className="w-4 h-4" /> Upload JSON Configuration
                  </button>
                </div>
              ) : (
                <div className="grid gap-3">
                  {zones.map((z) => (
                    <div
                      key={z.id}
                      className="p-4 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-page))] flex items-center justify-between gap-4"
                    >
                      <div className="flex items-center gap-3.5 min-w-0">
                        <div
                          className="w-4 h-4 rounded-full shrink-0 shadow-sm border border-white/20"
                          style={{ backgroundColor: z.color || "#3B82F6" }}
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-[hsl(var(--text-primary))] truncate">
                              {z.name}
                            </span>
                            <span className="text-[10px] font-mono font-bold bg-[hsl(var(--bg-table-head))] border border-[hsl(var(--border))] px-2 py-0.5 rounded text-[hsl(var(--text-muted))]">
                              ID: {z.id}
                            </span>
                          </div>
                          <p className="text-xs text-[hsl(var(--text-muted))] mt-0.5 truncate">
                            {z.description || `${z.points?.length || 0} polygon vertices`}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-xs font-semibold text-[hsl(var(--text-muted))] bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] px-2.5 py-1 rounded-md">
                          {z.points?.length || 0} pts
                        </span>
                        <button
                          onClick={() => handleDeleteSingle(z.id)}
                          className="p-1.5 rounded-lg text-red-500 hover:bg-red-500/10 transition-colors"
                          title="Delete Zone"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === "upload" && (
            <div className="space-y-5">
              {/* Drag and Drop Zone File Upload */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                    handleFileUpload(e.dataTransfer.files[0]);
                  }
                }}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all duration-200 ${
                  dragOver
                    ? "border-violet-500 bg-violet-500/10 scale-[0.99]"
                    : "border-[hsl(var(--border-strong))] hover:border-violet-500/50 bg-[hsl(var(--bg-page))]"
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      handleFileUpload(e.target.files[0]);
                    }
                  }}
                />
                <div className="w-12 h-12 rounded-full bg-violet-500/10 text-violet-500 flex items-center justify-center mx-auto mb-3">
                  <Upload className="w-6 h-6" />
                </div>
                <h4 className="text-sm font-bold text-[hsl(var(--text-primary))]">
                  Drop camera zone JSON file here
                </h4>
                <p className="text-xs text-[hsl(var(--text-muted))] mt-1">
                  or click to select file from your computer (.json)
                </p>
              </div>

              {/* Paste JSON section */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-[hsl(var(--text-primary))] flex items-center gap-1.5">
                    <FileCode className="w-4 h-4 text-violet-500" />
                    Or Paste JSON Structure Directly:
                  </label>
                  <button
                    onClick={() => setRawJsonText(sampleJson)}
                    className="text-[11px] font-semibold text-violet-600 dark:text-violet-400 hover:underline"
                  >
                    Load Sample Template
                  </button>
                </div>
                <textarea
                  value={rawJsonText}
                  onChange={(e) => setRawJsonText(e.target.value)}
                  placeholder={`{\n  "zones": [\n    {\n      "id": "zone_a",\n      "name": "Assembly",\n      "color": "#3B82F6",\n      "points": [[100, 100], [300, 100], [300, 300], [100, 300]]\n    }\n  ]\n}`}
                  rows={7}
                  className="w-full font-mono text-xs p-3.5 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-page))] text-[hsl(var(--text-primary))] focus:outline-none focus:ring-2 focus:ring-violet-500/50"
                />
                <button
                  onClick={handleTextUpload}
                  disabled={loading || !rawJsonText.trim()}
                  className="w-full py-2.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-lg shadow-violet-500/20 transition-all"
                >
                  {loading ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" />
                  )}
                  Save &amp; Validate Zone Config
                </button>
              </div>

              {/* Requirements box */}
              <div className="p-4 rounded-xl bg-[hsl(var(--bg-table-head))] border border-[hsl(var(--border))] text-xs space-y-1.5 text-[hsl(var(--text-muted))]">
                <div className="flex items-center gap-1.5 font-bold text-[hsl(var(--text-primary))] mb-1">
                  <Info className="w-4 h-4 text-blue-500" /> Validation Requirements:
                </div>
                <p>• Polygon vertices: Minimum 3 points required per zone</p>
                <p>• Unique IDs: Each zone must have a distinct non-empty ID</p>
                <p>• Coordinates: Points can be normalized (0.0 – 1.0) or pixel values</p>
              </div>
            </div>
          )}

          {/* TAB: POLYGON EDITOR */}
          {activeTab === "editor" && (
            <div className="h-full flex flex-col">
              <PolygonZoneEditor
                cameraId={String(camera.id)}
                onSave={() => {
                  fetchZones();
                  setSuccessMsg("Zones saved successfully!");
                  onZonesUpdated?.();
                }}
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-[hsl(var(--border))] bg-[hsl(var(--bg-table-head))] flex items-center justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-bold border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] hover:bg-[hsl(var(--bg-table-head))] text-[hsl(var(--text-primary))] transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
