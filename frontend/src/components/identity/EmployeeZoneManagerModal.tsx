"use client";

import { useEffect, useState, useCallback } from "react";
import { X, Layers, CheckCircle2, Loader2, Save, MapPin } from "lucide-react";

interface ZoneItem {
  id: string;
  name: string;
  camera_id: string;
  color: string;
}

interface EmployeeZoneAssignment {
  camera_id: string;
  zone_id: string;
  zone_name?: string;
  is_designated: boolean;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  employeeId: string;
  onSaved?: () => void;
}

export default function EmployeeZoneManagerModal({ isOpen, onClose, employeeId, onSaved }: Props) {
  const [allZones, setAllZones] = useState<ZoneItem[]>([]);
  const [assignedZoneIds, setAssignedZoneIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getApiBase = () => {
    const host = typeof window !== "undefined" ? window.location.hostname : "localhost";
    return `http://${host}:8000`;
  };

  const fetchData = useCallback(async () => {
    if (!employeeId) return;
    setLoading(true);
    setError(null);
    const api = getApiBase();
    try {
      let zonesRes = await fetch(`${api}/api/zones`).catch(() => null);
      if (!zonesRes || !zonesRes.ok) {
        zonesRes = await fetch(`http://localhost:8000/api/zones`).catch(() => null);
      }

      let empZonesRes = await fetch(`${api}/api/identity/employees/${employeeId}/zones`).catch(() => null);
      if (!empZonesRes || !empZonesRes.ok) {
        empZonesRes = await fetch(`http://localhost:8000/api/identity/employees/${employeeId}/zones`).catch(() => null);
      }

      let zoneList: ZoneItem[] = [];
      if (zonesRes && zonesRes.ok) {
        const raw = await zonesRes.json();
        // Handle list of camera zone dicts
        zoneList = Array.isArray(raw)
          ? raw.map((z: any) => ({
              id: z.zone_id || z.id,
              name: z.name || `Zone ${z.zone_id}`,
              camera_id: z.camera_id,
              color: z.color || "#3B82F6",
            }))
          : [];
      }
      setAllZones(zoneList);

      const assignedSet = new Set<string>();
      if (empZonesRes && empZonesRes.ok) {
        const empZones: EmployeeZoneAssignment[] = await empZonesRes.json();
        empZones.forEach((ez) => {
          if (ez.is_designated) {
            assignedSet.add(`${ez.camera_id}:${ez.zone_id}`);
          }
        });
      }
      setAssignedZoneIds(assignedSet);
    } catch (e: any) {
      setError(e.message || "Failed to load zone assignments");
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => {
    if (isOpen) {
      fetchData();
    }
  }, [isOpen, fetchData]);

  if (!isOpen) return null;

  const toggleZone = (camId: string, zoneId: string) => {
    const key = `${camId}:${zoneId}`;
    setAssignedZoneIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    const api = getApiBase();
    try {
      const payload: EmployeeZoneAssignment[] = [];
      assignedZoneIds.forEach((key) => {
        const [camId, zoneId] = key.split(":");
        const zoneObj = allZones.find((z) => z.camera_id === camId && z.id === zoneId);
        payload.push({
          camera_id: camId,
          zone_id: zoneId,
          zone_name: zoneObj?.name || `Zone ${zoneId}`,
          is_designated: true,
        });
      });

      const res = await fetch(`${api}/api/identity/employees/${employeeId}/zones`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error(`Server returned ${res.status}`);

      if (onSaved) onSaved();
      onClose();
    } catch (e: any) {
      setError(e.message || "Failed to save designated zones");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-6 border-b border-[hsl(var(--border))] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
              <Layers className="w-5 h-5 text-emerald-500" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-[hsl(var(--text-primary))]">
                Assign Designated Work Zones
              </h3>
              <p className="text-xs text-[hsl(var(--text-muted))]">
                Employee: <span className="font-semibold text-emerald-500">{employeeId}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-table-head))] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-2 text-sm text-[hsl(var(--text-muted))]">
              <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
              <span>Loading camera zones…</span>
            </div>
          ) : error ? (
            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 text-xs">
              {error}
            </div>
          ) : allZones.length === 0 ? (
            <div className="p-8 text-center text-xs text-[hsl(var(--text-muted))]">
              No polygonal camera zones configured yet. Draw camera zones in Zone Analytics first.
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-[hsl(var(--text-muted))]">
                Select the work zones where employee <span className="font-bold text-[hsl(var(--text-primary))]">{employeeId}</span> is expected to perform duties. Active time inside these zones counts as <span className="text-emerald-500 font-semibold">Productive Time</span>.
              </p>

              <div className="grid grid-cols-1 gap-2.5">
                {allZones.map((z) => {
                  const key = `${z.camera_id}:${z.id}`;
                  const isChecked = assignedZoneIds.has(key);
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => toggleZone(z.camera_id, z.id)}
                      className={`p-3.5 rounded-xl border text-left flex items-center justify-between transition-all ${
                        isChecked
                          ? "bg-emerald-500/10 border-emerald-500 text-emerald-600 dark:text-emerald-400 font-medium"
                          : "bg-[hsl(var(--bg-input))] border-[hsl(var(--border))] text-[hsl(var(--text-secondary))] hover:border-[hsl(var(--border-strong))]"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className="w-3.5 h-3.5 rounded-full shrink-0 border border-black/20"
                          style={{ backgroundColor: z.color }}
                        />
                        <div>
                          <div className="text-sm font-bold text-[hsl(var(--text-primary))]">
                            {z.name}
                          </div>
                          <div className="text-xs text-[hsl(var(--text-muted))] flex items-center gap-1 mt-0.5">
                            <MapPin className="w-3 h-3" />
                            <span>Camera: {z.camera_id}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {isChecked ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Assigned Work Zone
                          </span>
                        ) : (
                          <span className="text-xs text-[hsl(var(--text-muted))]">
                            Click to assign
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[hsl(var(--border))] bg-[hsl(var(--bg-card-2))] flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-[hsl(var(--bg-input))] text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] border border-[hsl(var(--border))]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || loading}
            className="flex items-center gap-2 px-5 py-2 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm disabled:opacity-50 transition-all"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            <span>Save Designated Zones</span>
          </button>
        </div>
      </div>
    </div>
  );
}
