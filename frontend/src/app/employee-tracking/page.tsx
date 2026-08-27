"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Users,
  Search,
  Plus,
  Shield,
  Layers,
  MapPin,
  CheckCircle2,
  XCircle,
  Loader2,
  RefreshCw,
  Trash2,
  Filter,
  UserPlus,
  X,
  AlertCircle,
  Radio
} from "lucide-react";
import EmployeeZoneManagerModal from "@/components/identity/EmployeeZoneManagerModal";

interface ZoneAssignment {
  id: number;
  camera_id: string;
  zone_id: string;
  zone_name: string;
}

interface Employee {
  id: number;
  employee_id: string;
  name: string;
  department: string;
  designation: string;
  is_tracked: boolean;
  status: "ACTIVE" | "CHECKED_IN" | "OFFLINE";
  assigned_zones: ZoneAssignment[];
  assigned_cameras: string[];
}

export default function EmployeeTrackingPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [trackingMode, setTrackingMode] = useState<string>("TRACK_ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDept, setSelectedDept] = useState("ALL");
  const [selectedEmpForZone, setSelectedEmpForZone] = useState<string | null>(null);
  const [isZoneModalOpen, setIsZoneModalOpen] = useState(false);

  // Add Employee Modal
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newEmpId, setNewEmpId] = useState("");
  const [newName, setNewName] = useState("");
  const [newDept, setNewDept] = useState("Engineering");
  const [newDesignation, setNewDesignation] = useState("Software Engineer");
  const [newIsTracked, setNewIsTracked] = useState(true);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const getApiBase = () => {
    const host = typeof window !== "undefined" ? window.location.hostname : "localhost";
    return `http://${host}:8001`;
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const api = getApiBase();
    try {
      let empRes = await fetch(`${api}/api/identity/employees`).catch(() => null);
      if (!empRes || !empRes.ok) {
        empRes = await fetch(`http://localhost:8001/api/identity/employees`).catch(() => null);
      }
      if (!empRes || !empRes.ok) {
        empRes = await fetch(`http://127.0.0.1:8001/api/identity/employees`).catch(() => null);
      }

      if (empRes && empRes.ok) {
        const empData = await empRes.json();
        setEmployees(empData);
      } else {
        throw new Error("Failed to fetch employee list from backend API");
      }

      let settingsRes = await fetch(`${api}/api/settings`).catch(() => null);
      if (!settingsRes || !settingsRes.ok) {
        settingsRes = await fetch(`http://localhost:8001/api/settings`).catch(() => null);
      }

      if (settingsRes && settingsRes.ok) {
        const settingsData = await settingsRes.json();
        if (settingsData.tracking_mode) {
          setTrackingMode(settingsData.tracking_mode);
        }
      }
    } catch (e: any) {
      setError(e.message || "Failed to load employees");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Toggle individual tracking for an employee
  const handleToggleTracking = async (empId: string, currentTracked: boolean) => {
    if (trackingMode === "TRACK_ALL") return; // Read-only in TRACK_ALL mode

    const api = getApiBase();
    const nextTracked = !currentTracked;

    // Optimistic UI update
    setEmployees((prev) =>
      prev.map((emp) =>
        emp.employee_id === empId ? { ...emp, is_tracked: nextTracked } : emp
      )
    );

    try {
      let res = await fetch(`${api}/api/identity/employees/${empId}/tracking`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_tracked: nextTracked }),
      }).catch(() => null);

      if (!res || !res.ok) {
        res = await fetch(`http://localhost:8001/api/identity/employees/${empId}/tracking`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ is_tracked: nextTracked }),
        }).catch(() => null);
      }

      if (!res || !res.ok) throw new Error("Failed to update tracking status");
    } catch (e: any) {
      // Revert optimistic update
      setEmployees((prev) =>
        prev.map((emp) =>
          emp.employee_id === empId ? { ...emp, is_tracked: currentTracked } : emp
        )
      );
      alert(e.message || "Could not update tracking status");
    }
  };

  // Delete employee
  const handleDeleteEmployee = async (empId: string) => {
    if (!confirm(`Are you sure you want to delete employee ${empId}?`)) return;

    const api = getApiBase();
    try {
      let res = await fetch(`${api}/api/identity/employees/${empId}`, {
        method: "DELETE",
      }).catch(() => null);
      if (!res || !res.ok) {
        res = await fetch(`http://localhost:8001/api/identity/employees/${empId}`, {
          method: "DELETE",
        }).catch(() => null);
      }
      if (!res || !res.ok) throw new Error("Failed to delete employee");
      setEmployees((prev) => prev.filter((e) => e.employee_id !== empId));
    } catch (e: any) {
      alert(e.message || "Delete failed");
    }
  };

  // Add new employee submission
  const handleAddEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmpId.trim() || !newName.trim()) {
      setAddError("Employee ID and Name are required");
      return;
    }

    setAdding(true);
    setAddError(null);
    const api = getApiBase();
    try {
      let res = await fetch(`${api}/api/identity/employees`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: newEmpId.trim().toUpperCase(),
          name: newName.trim(),
          department: newDept.trim(),
          designation: newDesignation.trim(),
          is_tracked: newIsTracked,
        }),
      }).catch(() => null);

      if (!res || !res.ok) {
        res = await fetch(`http://localhost:8001/api/identity/employees`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            employee_id: newEmpId.trim().toUpperCase(),
            name: newName.trim(),
            department: newDept.trim(),
            designation: newDesignation.trim(),
            is_tracked: newIsTracked,
          }),
        }).catch(() => null);
      }

      if (!res || !res.ok) {
        const errData = await res?.json().catch(() => ({})) || {};
        throw new Error(errData.detail || "Failed to create employee");
      }

      setIsAddModalOpen(false);
      setNewEmpId("");
      setNewName("");
      fetchData();
    } catch (err: any) {
      setAddError(err.message || "Failed to create employee");
    } finally {
      setAdding(false);
    }
  };

  // Department options
  const departments = Array.from(
    new Set(employees.map((e) => e.department || "General"))
  );

  // Filtered employees
  const filteredEmployees = employees.filter((e) => {
    const matchesSearch =
      e.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      e.employee_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (e.department && e.department.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (e.designation && e.designation.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesDept = selectedDept === "ALL" || e.department === selectedDept;

    return matchesSearch && matchesDept;
  });

  // KPI Statistics
  const totalEmployees = employees.length;
  const trackedCount = employees.filter((e) => e.is_tracked).length;
  const activeCount = employees.filter((e) => e.status === "ACTIVE").length;
  const assignedZoneCount = employees.filter((e) => e.assigned_zones.length > 0).length;

  const [syncing, setSyncing] = useState(false);

  const handleSyncHikvision = async () => {
    setSyncing(true);
    const api = getApiBase();
    try {
      let res = await fetch(`${api}/api/identity/employees/sync`, { method: "POST" }).catch(() => null);
      if (!res || !res.ok) {
        res = await fetch(`http://localhost:8001/api/identity/employees/sync`, { method: "POST" }).catch(() => null);
      }
      if (res && res.ok) {
        const data = await res.json();
        alert(`Successfully synced ${data.synced_count} real employees from Hikvision ACS!`);
        fetchData();
      } else {
        throw new Error("Sync returned non-200 status");
      }
    } catch (e: any) {
      alert(e.message || "Failed to sync employees from Hikvision ACS");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="p-6 sm:p-8 space-y-8 max-w-7xl mx-auto">
        {/* Title & Mode Banner Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-[hsl(var(--border))] pb-6">
          <div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
                <Users className="w-5 h-5 text-emerald-500" />
              </div>
              <div>
                <h1 className="text-2xl sm:text-3xl font-extrabold text-[hsl(var(--text-primary))] tracking-tight">
                  Employee Zone & Tracking Management
                </h1>
                <p className="text-xs sm:text-sm text-[hsl(var(--text-muted))] mt-0.5">
                  Central repository for employee tracking preferences, productive work zone assignments, and live presence.
                </p>
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={fetchData}
              className="p-2.5 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-table-head))] hover:bg-[hsl(var(--bg-input))] text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] transition-all"
              title="Refresh Employees"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin text-emerald-500" : ""}`} />
            </button>
            <button
              onClick={handleSyncHikvision}
              disabled={syncing}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs sm:text-sm shadow-sm transition-all disabled:opacity-50"
              title="Sync real employees from Hikvision ACS door controllers & Artemis Gateway"
            >
              <RefreshCw className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} />
              <span>{syncing ? "Syncing..." : "Sync Hikvision ACS"}</span>
            </button>
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs sm:text-sm shadow-sm transition-all"
            >
              <UserPlus className="w-4 h-4" />
              <span>Add Employee</span>
            </button>
          </div>
        </div>

        {/* Global Tracking Mode Switcher Banner */}
        <div
          className={`p-4 rounded-2xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 transition-all ${
            trackingMode === "NORMAL" || trackingMode === "TRACK_ALL"
              ? "bg-blue-500/10 border-blue-500/20 text-blue-600 dark:text-blue-400"
              : "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400"
          }`}
        >
          <div className="flex items-center gap-3">
            <Radio className="w-5 h-5 shrink-0" />
            <div>
              <div className="text-sm font-bold flex items-center gap-2">
                <span>
                  Active System Mode:{" "}
                  {trackingMode === "NORMAL" || trackingMode === "TRACK_ALL"
                    ? "Normal Tracking (Track All People)"
                    : "Door-Based Tracking"}
                </span>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-white/20">
                  {trackingMode === "DOOR_BASED" || trackingMode === "TRACK_SPECIFIC" ? "DOOR_BASED" : "NORMAL"}
                </span>
              </div>
              <p className="text-xs opacity-90 mt-0.5">
                {trackingMode === "NORMAL" || trackingMode === "TRACK_ALL"
                  ? "All detected individuals are tracked and shown across feeds. Standard open monitoring without check-in gating."
                  : "Tracks only employees who checked in through a Door ACS. Follows them on designated cameras and connected portals via Portal Flow."}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={async () => {
                const nextMode = (trackingMode === "NORMAL" || trackingMode === "TRACK_ALL") ? "DOOR_BASED" : "NORMAL";
                const api = getApiBase();
                try {
                  const res = await fetch(`${api}/api/settings/tracking-mode`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ tracking_mode: nextMode }),
                  });
                  if (res.ok) {
                    const data = await res.json();
                    setTrackingMode(data.tracking_mode);
                  }
                } catch (err) {
                  console.error("Failed to switch tracking mode:", err);
                }
              }}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 ${
                trackingMode === "NORMAL" || trackingMode === "TRACK_ALL"
                  ? "bg-blue-600 hover:bg-blue-500 text-white"
                  : "bg-emerald-600 hover:bg-emerald-500 text-white"
              }`}
            >
              <span>Switch to {(trackingMode === "NORMAL" || trackingMode === "TRACK_ALL") ? "Door-Based Tracking" : "Normal Tracking"}</span>
            </button>
            <a
              href="/settings"
              className="text-xs font-semibold underline px-2 hover:opacity-80 transition-opacity"
            >
              Settings &rarr;
            </a>
          </div>
        </div>

        {/* Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-5 rounded-2xl bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] shadow-sm space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[hsl(var(--text-muted))] uppercase tracking-wider">
                Total Employees
              </span>
              <Users className="w-5 h-5 text-emerald-500" />
            </div>
            <div className="text-2xl font-extrabold text-[hsl(var(--text-primary))]">
              {totalEmployees}
            </div>
            <p className="text-xs text-[hsl(var(--text-muted))]">Registered personnel</p>
          </div>

          <div className="p-5 rounded-2xl bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] shadow-sm space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[hsl(var(--text-muted))] uppercase tracking-wider">
                Tracked Personnel
              </span>
              <Shield className="w-5 h-5 text-blue-500" />
            </div>
            <div className="text-2xl font-extrabold text-[hsl(var(--text-primary))]">
              {trackingMode === "TRACK_ALL" ? totalEmployees : trackedCount}
            </div>
            <p className="text-xs text-[hsl(var(--text-muted))]">
              {trackingMode === "TRACK_ALL" ? "All employees (TRACK_ALL)" : `${trackedCount} of ${totalEmployees} enabled`}
            </p>
          </div>

          <div className="p-5 rounded-2xl bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] shadow-sm space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[hsl(var(--text-muted))] uppercase tracking-wider">
                Work Zones Assigned
              </span>
              <Layers className="w-5 h-5 text-purple-500" />
            </div>
            <div className="text-2xl font-extrabold text-[hsl(var(--text-primary))]">
              {assignedZoneCount}
            </div>
            <p className="text-xs text-[hsl(var(--text-muted))]">Employees with productive zones</p>
          </div>

          <div className="p-5 rounded-2xl bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] shadow-sm space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[hsl(var(--text-muted))] uppercase tracking-wider">
                Active On-Camera
              </span>
              <span className="flex h-3 w-3 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
              </span>
            </div>
            <div className="text-2xl font-extrabold text-emerald-600 dark:text-emerald-400">
              {activeCount}
            </div>
            <p className="text-xs text-[hsl(var(--text-muted))]">Currently in live feed</p>
          </div>
        </div>

        {/* Filter Controls Bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 rounded-2xl bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))]">
          {/* Search Box */}
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[hsl(var(--text-muted))]" />
            <input
              type="text"
              placeholder="Search by name, ID, or dept…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 text-xs sm:text-sm bg-[hsl(var(--bg-input))] border border-[hsl(var(--border-strong))] rounded-xl text-[hsl(var(--text-primary))] focus:outline-none focus:border-emerald-500 transition-colors"
            />
          </div>

          {/* Department Filter */}
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Filter className="w-4 h-4 text-[hsl(var(--text-muted))]" />
            <select
              value={selectedDept}
              onChange={(e) => setSelectedDept(e.target.value)}
              className="px-3 py-2 text-xs sm:text-sm bg-[hsl(var(--bg-input))] border border-[hsl(var(--border-strong))] rounded-xl text-[hsl(var(--text-primary))] focus:outline-none focus:border-emerald-500"
            >
              <option value="ALL">All Departments</option>
              {departments.map((dept) => (
                <option key={dept} value={dept}>
                  {dept}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Employee Table */}
        <div className="bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] rounded-2xl overflow-hidden shadow-sm">
          {loading ? (
            <div className="p-16 flex flex-col items-center justify-center gap-3 text-sm text-[hsl(var(--text-muted))]">
              <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
              <span>Loading employees & zone assignments…</span>
            </div>
          ) : error ? (
            <div className="p-8 text-center text-sm text-red-500 flex flex-col items-center gap-2">
              <AlertCircle className="w-8 h-8 text-red-500" />
              <span>{error}</span>
            </div>
          ) : filteredEmployees.length === 0 ? (
            <div className="p-16 text-center text-sm text-[hsl(var(--text-muted))]">
              No employees matching filters found.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs sm:text-sm border-collapse">
                <thead>
                  <tr className="bg-[hsl(var(--bg-table-head))] border-b border-[hsl(var(--border))] text-[hsl(var(--text-muted))] font-bold uppercase tracking-wider text-[11px]">
                    <th className="py-4 px-6">Employee</th>
                    <th className="py-4 px-6">Department & Title</th>
                    <th className="py-4 px-6">Assigned Work Zone(s)</th>
                    <th className="py-4 px-6">Individual Tracking</th>
                    <th className="py-4 px-6">Status</th>
                    <th className="py-4 px-6 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[hsl(var(--border))]">
                  {filteredEmployees.map((emp) => {
                    const isTrackAll = trackingMode === "TRACK_ALL";
                    const isEffectivelyTracked = isTrackAll || emp.is_tracked;

                    return (
                      <tr
                        key={emp.employee_id}
                        className="hover:bg-[hsl(var(--bg-table-head))]/50 transition-colors"
                      >
                        {/* Employee Name & ID */}
                        <td className="py-4 px-6">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-extrabold flex items-center justify-center text-xs shrink-0">
                              {emp.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                            </div>
                            <div>
                              <div className="font-bold text-[hsl(var(--text-primary))]">
                                {emp.name}
                              </div>
                              <div className="text-[11px] text-emerald-600 dark:text-emerald-400 font-mono">
                                {emp.employee_id}
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Department & Designation */}
                        <td className="py-4 px-6">
                          <div>
                            <span className="inline-block px-2.5 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 mb-1">
                              {emp.department}
                            </span>
                            <div className="text-xs text-[hsl(var(--text-muted))]">
                              {emp.designation}
                            </div>
                          </div>
                        </td>

                        {/* Assigned Zone(s) */}
                        <td className="py-4 px-6">
                          {emp.assigned_zones.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5 max-w-xs">
                              {emp.assigned_zones.map((z, idx) => (
                                <span
                                  key={idx}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20"
                                >
                                  <MapPin className="w-3 h-3 shrink-0" />
                                  <span>{z.zone_name}</span>
                                </span>
                              ))}
                            </div>
                          ) : (
                            <button
                              onClick={() => {
                                setSelectedEmpForZone(emp.employee_id);
                                setIsZoneModalOpen(true);
                              }}
                              className="text-xs text-[hsl(var(--text-muted))] hover:text-emerald-500 flex items-center gap-1 italic hover:underline"
                            >
                              <Plus className="w-3 h-3" /> Assign Work Zones
                            </button>
                          )}
                        </td>

                        {/* Tracking Toggle */}
                        <td className="py-4 px-6">
                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              disabled={isTrackAll}
                              onClick={() => handleToggleTracking(emp.employee_id, emp.is_tracked)}
                              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                isEffectivelyTracked ? "bg-emerald-500" : "bg-gray-300 dark:bg-gray-700"
                              } ${isTrackAll ? "opacity-60 cursor-not-allowed" : ""}`}
                              title={
                                isTrackAll
                                  ? "Tracking toggles are read-only when 'Track All People' mode is enabled in Settings."
                                  : "Click to toggle tracking for this employee"
                              }
                            >
                              <span
                                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                                  isEffectivelyTracked ? "translate-x-5" : "translate-x-0"
                                }`}
                              />
                            </button>
                            <span className="text-xs font-semibold text-[hsl(var(--text-secondary))]">
                              {isTrackAll ? (
                                <span className="text-emerald-600 dark:text-emerald-400">All Tracked</span>
                              ) : emp.is_tracked ? (
                                <span className="text-emerald-500">ON</span>
                              ) : (
                                <span className="text-gray-400">OFF</span>
                              )}
                            </span>
                          </div>
                        </td>

                        {/* Status */}
                        <td className="py-4 px-6">
                          {emp.status === "ACTIVE" ? (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-extrabold bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                              Active On-Camera
                            </span>
                          ) : emp.status === "CHECKED_IN" ? (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/30">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Checked In
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-[hsl(var(--bg-table-head))] text-[hsl(var(--text-muted))] border border-[hsl(var(--border))]">
                              <XCircle className="w-3.5 h-3.5" />
                              Offline
                            </span>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="py-4 px-6 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => {
                                setSelectedEmpForZone(emp.employee_id);
                                setIsZoneModalOpen(true);
                              }}
                              className="px-3 py-1.5 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-table-head))] hover:bg-emerald-500/10 hover:border-emerald-500/30 text-xs font-semibold text-[hsl(var(--text-secondary))] hover:text-emerald-500 transition-all flex items-center gap-1.5"
                            >
                              <Layers className="w-3.5 h-3.5" />
                              <span>Assign Zones</span>
                            </button>

                            <button
                              onClick={() => handleDeleteEmployee(emp.employee_id)}
                              className="p-1.5 rounded-lg text-[hsl(var(--text-muted))] hover:text-red-500 hover:bg-red-500/10 transition-colors"
                              title="Delete Employee"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

      {/* Employee Zone Manager Modal */}
      {selectedEmpForZone && (
        <EmployeeZoneManagerModal
          isOpen={isZoneModalOpen}
          onClose={() => {
            setIsZoneModalOpen(false);
            setSelectedEmpForZone(null);
          }}
          employeeId={selectedEmpForZone}
          onSaved={fetchData}
        />
      )}

      {/* Add Employee Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-[hsl(var(--border))] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
                  <UserPlus className="w-5 h-5 text-emerald-500" />
                </div>
                <h3 className="text-lg font-bold text-[hsl(var(--text-primary))]">
                  Add New Employee
                </h3>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddEmployee} className="p-6 space-y-4">
              {addError && (
                <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 text-xs">
                  {addError}
                </div>
              )}

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[hsl(var(--text-muted))] mb-1">
                  Employee ID *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. EMP009"
                  value={newEmpId}
                  onChange={(e) => setNewEmpId(e.target.value)}
                  className="w-full bg-[hsl(var(--bg-input))] border border-[hsl(var(--border-strong))] rounded-xl px-4 py-2 text-sm text-[hsl(var(--text-primary))] focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[hsl(var(--text-muted))] mb-1">
                  Full Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Sarah Connor"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full bg-[hsl(var(--bg-input))] border border-[hsl(var(--border-strong))] rounded-xl px-4 py-2 text-sm text-[hsl(var(--text-primary))] focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[hsl(var(--text-muted))] mb-1">
                  Department
                </label>
                <input
                  type="text"
                  placeholder="e.g. Engineering"
                  value={newDept}
                  onChange={(e) => setNewDept(e.target.value)}
                  className="w-full bg-[hsl(var(--bg-input))] border border-[hsl(var(--border-strong))] rounded-xl px-4 py-2 text-sm text-[hsl(var(--text-primary))] focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[hsl(var(--text-muted))] mb-1">
                  Designation / Role
                </label>
                <input
                  type="text"
                  placeholder="e.g. Senior Software Engineer"
                  value={newDesignation}
                  onChange={(e) => setNewDesignation(e.target.value)}
                  className="w-full bg-[hsl(var(--bg-input))] border border-[hsl(var(--border-strong))] rounded-xl px-4 py-2 text-sm text-[hsl(var(--text-primary))] focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex items-center justify-between pt-2">
                <span className="text-xs font-bold uppercase tracking-wider text-[hsl(var(--text-muted))]">
                  Initial Tracking Enabled
                </span>
                <button
                  type="button"
                  onClick={() => setNewIsTracked(!newIsTracked)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ${
                    newIsTracked ? "bg-emerald-500" : "bg-gray-300 dark:bg-gray-700"
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ${
                      newIsTracked ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-[hsl(var(--border))]">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold rounded-xl bg-[hsl(var(--bg-input))] text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] border border-[hsl(var(--border))]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={adding}
                  className="flex items-center gap-2 px-5 py-2 text-xs font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm disabled:opacity-50 transition-all"
                >
                  {adding && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Save Employee</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
