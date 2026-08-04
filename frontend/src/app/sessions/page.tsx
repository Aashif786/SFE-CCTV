"use client";
import { useEffect, useState, useCallback } from "react";
import { formatTime, formatElapsed } from "@/lib/dateUtils";
import {
  Clock, Wifi, RefreshCw, CheckCircle2, XCircle, Loader2, AlertTriangle, UserX, UserCheck, MapPin, Search, X, Shield, Plus
} from "lucide-react";

const getApiBase = () => {
  const host = typeof window !== "undefined" ? window.location.hostname : "localhost";
  return `http://${host}:8000`;
};

// ── Types ─────────────────────────────────────────────────────────────────

interface IdentityEvent {
  event_id: string;
  employee_id: string;
  event_type: string;
  timestamp: string;
  entry_gate: string;
  provider: string;
  correlation_status: "WAITING_FOR_TRACK" | "MATCHED" | "EXPIRED";
  matched_track_id: string | null;
  matched_at: string | null;
  correlation_delay_seconds: number | null;
}

interface WorkerSession {
  session_id: string;
  employee_id: string | null;
  employee_name?: string | null;
  current_track_id: string;
  camera_id: string;
  is_correlated?: boolean;
  zone_id?: string;
  zone_name?: string;
  zone_color?: string;
  start_time: string;
  end_time?: string | null;
  status: "ACTIVE" | "CLOSED";
  dwell_seconds?: number;
  formatted_dwell?: string;
  correlation_delay_seconds?: number;
}

interface EmployeeOption {
  employee_id: string;
  name: string;
  department?: string;
  designation?: string;
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function SessionMonitorPage() {
  const [sessions, setSessions] = useState<WorkerSession[]>([]);
  const [pending, setPending] = useState<IdentityEvent[]>([]);
  const [history, setHistory] = useState<IdentityEvent[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [tab, setTab] = useState<"pending" | "history">("pending");
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [mounted, setMounted] = useState(false);

  // Manual Correlation Modal State
  const [isCorrelateModalOpen, setIsCorrelateModalOpen] = useState(false);
  const [selectedTrackForCorrelate, setSelectedTrackForCorrelate] = useState<{ track_id: string; camera_id: string } | null>(null);
  const [targetEmployeeId, setTargetEmployeeId] = useState("");
  const [correlating, setCorrelating] = useState(false);
  const [correlateError, setCorrelateError] = useState<string | null>(null);
  const [searchEmployeeQuery, setSearchEmployeeQuery] = useState("");

  useEffect(() => { setMounted(true); }, []);

  const refresh = useCallback(async () => {
    const api = getApiBase();
    try {
      let sRes = await fetch(`${api}/api/identity/sessions`).catch(() => null);
      if (!sRes || !sRes.ok) {
        sRes = await fetch(`http://localhost:8000/api/identity/sessions`).catch(() => null);
      }

      let pRes = await fetch(`${api}/api/identity/pending`).catch(() => null);
      if (!pRes || !pRes.ok) {
        pRes = await fetch(`http://localhost:8000/api/identity/pending`).catch(() => null);
      }

      let hRes = await fetch(`${api}/api/identity/history`).catch(() => null);
      if (!hRes || !hRes.ok) {
        hRes = await fetch(`http://localhost:8000/api/identity/history`).catch(() => null);
      }

      let eRes = await fetch(`${api}/api/identity/employees`).catch(() => null);
      if (!eRes || !eRes.ok) {
        eRes = await fetch(`http://localhost:8000/api/identity/employees`).catch(() => null);
      }

      if (sRes && sRes.ok) setSessions(await sRes.json());
      if (pRes && pRes.ok) setPending(await pRes.json());
      if (hRes && hRes.ok) setHistory(await hRes.json());
      if (eRes && eRes.ok) setEmployees(await eRes.json());

      setLastRefresh(new Date());
    } catch { /* backend offline */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [refresh]);

  // Execute manual correlation
  const handleExecuteManualCorrelate = async (empIdToAssign: string) => {
    if (!selectedTrackForCorrelate || !empIdToAssign.trim()) return;

    setCorrelating(true);
    setCorrelateError(null);
    const api = getApiBase();

    try {
      let res = await fetch(`${api}/api/identity/manual-correlate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          track_id: selectedTrackForCorrelate.track_id,
          camera_id: selectedTrackForCorrelate.camera_id,
          employee_id: empIdToAssign.trim().toUpperCase(),
        }),
      }).catch(() => null);

      if (!res || !res.ok) {
        res = await fetch(`http://localhost:8000/api/identity/manual-correlate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            track_id: selectedTrackForCorrelate.track_id,
            camera_id: selectedTrackForCorrelate.camera_id,
            employee_id: empIdToAssign.trim().toUpperCase(),
          }),
        }).catch(() => null);
      }

      if (!res || !res.ok) {
        const errData = await res?.json().catch(() => ({})) || {};
        throw new Error(errData.detail || "Manual correlation failed");
      }

      setIsCorrelateModalOpen(false);
      setSelectedTrackForCorrelate(null);
      setTargetEmployeeId("");
      refresh();
    } catch (e: any) {
      setCorrelateError(e.message || "Could not correlate employee");
    } finally {
      setCorrelating(false);
    }
  };

  // Filter employees for modal dropdown
  const filteredEmployeesForModal = employees.filter((emp) =>
    emp.name.toLowerCase().includes(searchEmployeeQuery.toLowerCase()) ||
    emp.employee_id.toLowerCase().includes(searchEmployeeQuery.toLowerCase()) ||
    (emp.department && emp.department.toLowerCase().includes(searchEmployeeQuery.toLowerCase()))
  );

  return (
    <div className="p-6 sm:p-8 space-y-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[hsl(var(--text-primary))] tracking-tight flex items-center gap-3">
            <Wifi className="w-8 h-8 text-emerald-500 animate-pulse" />
            Session Monitor
          </h1>
          <p className="text-xs sm:text-sm text-[hsl(var(--text-muted))] mt-1">
            Real-time monitoring of all active camera tracks, current work zones, dwell durations, and manual employee correlation.
          </p>
        </div>
        <button
          onClick={refresh}
          className="flex items-center gap-2 text-xs sm:text-sm text-[hsl(var(--text-secondary))]
            hover:text-[hsl(var(--text-primary))] bg-[hsl(var(--bg-table-head))]
            px-3.5 py-2 rounded-xl border border-[hsl(var(--border))]
            hover:border-[hsl(var(--border-strong))] transition-all shadow-sm shrink-0"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin text-emerald-500" : ""}`} />
          <span>
            {mounted ? lastRefresh.toLocaleTimeString() : "--:--:--"}
          </span>
        </button>
      </div>

      {/* Active Camera Tracks & Sessions Panel */}
      <div className="bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] rounded-2xl p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-[hsl(var(--border))] pb-4">
          <h2 className="text-base sm:text-lg font-bold text-[hsl(var(--text-primary))] flex items-center gap-2.5">
            <Wifi className="w-5 h-5 text-emerald-500 animate-pulse" />
            <span>Active Camera Tracks & Sessions</span>
            {sessions.length > 0 && (
              <span className="text-xs font-bold bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 px-2.5 py-0.5 rounded-full border border-emerald-500/30">
                {sessions.length} live track{sessions.length !== 1 ? "s" : ""}
              </span>
            )}
          </h2>
          <span className="text-xs text-[hsl(var(--text-muted))] hidden sm:inline">
            Monitors both correlated workers and unassigned camera tracks
          </span>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2 text-[hsl(var(--text-muted))] text-sm">
            <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
            <span>Loading active tracks…</span>
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center border border-dashed border-[hsl(var(--border-strong))] rounded-2xl bg-[hsl(var(--bg-table-head))]/20">
            <UserX className="w-10 h-10 text-[hsl(var(--text-muted))] mb-3" />
            <p className="text-sm text-[hsl(var(--text-secondary))] font-semibold">No active camera tracks detected</p>
            <p className="text-xs text-[hsl(var(--text-muted))] mt-1">
              Active tracks will appear automatically as personnel enter RTSP camera feeds.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {sessions.map((s) => {
              const isCorrelated = Boolean(s.employee_id);
              const zoneColor = s.zone_color || "#3B82F6";

              return (
                <div
                  key={s.session_id}
                  className="bg-[hsl(var(--bg-table-head))]/60 border border-[hsl(var(--border))] rounded-2xl p-5 hover:border-[hsl(var(--border-strong))] transition-all shadow-sm space-y-3 flex flex-col justify-between"
                >
                  <div>
                    {/* Card Header: Track ID + Status Pill */}
                    <div className="flex items-center justify-between border-b border-[hsl(var(--border))]/60 pb-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-extrabold flex items-center justify-center text-xs shrink-0 font-mono">
                          #{s.current_track_id}
                        </div>
                        <div>
                          <div className="text-sm font-bold text-[hsl(var(--text-primary))] flex items-center gap-1.5">
                            <span>Track #{s.current_track_id}</span>
                          </div>
                          <div className="text-[11px] text-[hsl(var(--text-muted))] font-medium">
                            Camera: <span className="text-emerald-500 font-semibold">{s.camera_id}</span>
                          </div>
                        </div>
                      </div>

                      {/* Correlation Status Badge */}
                      {isCorrelated ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                          <CheckCircle2 className="w-3 h-3" />
                          Correlated
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                          <AlertTriangle className="w-3 h-3" />
                          Unassigned
                        </span>
                      )}
                    </div>

                    {/* Card Body Details */}
                    <div className="space-y-2.5 pt-3 text-xs">
                      {/* Employee Info */}
                      <div className="flex items-start justify-between">
                        <span className="text-[hsl(var(--text-muted))] font-medium">Assigned Worker:</span>
                        <div className="text-right">
                          {isCorrelated ? (
                            <div>
                              <span className="font-bold text-emerald-600 dark:text-emerald-400">
                                {s.employee_id}
                              </span>
                              {s.employee_name && (
                                <div className="text-[11px] text-[hsl(var(--text-secondary))]">
                                  {s.employee_name}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-[hsl(var(--text-muted))] italic">
                              Unassigned / Anonymous
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Current Zone */}
                      <div className="flex items-center justify-between">
                        <span className="text-[hsl(var(--text-muted))] font-medium">Current Work Zone:</span>
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg text-[11px] font-bold bg-[hsl(var(--bg-input))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))]">
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: zoneColor }}
                          />
                          <span>{s.zone_name || "Common Area"}</span>
                        </span>
                      </div>

                      {/* Dwell Time */}
                      <div className="flex items-center justify-between">
                        <span className="text-[hsl(var(--text-muted))] font-medium">Zone Dwell Time:</span>
                        <span className="font-bold text-emerald-600 dark:text-emerald-400 font-mono text-xs">
                          {s.formatted_dwell || "00:00"}
                        </span>
                      </div>

                      {/* Entry Time */}
                      <div className="flex items-center justify-between">
                        <span className="text-[hsl(var(--text-muted))] font-medium">Track Detected:</span>
                        <span className="text-[hsl(var(--text-secondary))] font-mono text-[11px]">
                          {formatTime(s.start_time)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Manual Correlation Action */}
                  <div className="pt-3 border-t border-[hsl(var(--border))]/50">
                    <button
                      onClick={() => {
                        setSelectedTrackForCorrelate({ track_id: s.current_track_id, camera_id: s.camera_id });
                        setIsCorrelateModalOpen(true);
                      }}
                      className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs shadow-sm transition-all"
                    >
                      <UserCheck className="w-3.5 h-3.5" />
                      <span>{isCorrelateModalOpen && selectedTrackForCorrelate?.track_id === s.current_track_id ? "Assigning..." : "Assign / Correlate Employee"}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Bottom: Pending + History tabs */}
      <div className="bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] rounded-2xl overflow-hidden shadow-sm">
        {/* Tabs */}
        <div className="flex border-b border-[hsl(var(--border))]">
          {(["pending", "history"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-6 py-4 text-xs sm:text-sm font-medium transition-colors flex items-center gap-2 capitalize ${
                tab === t
                  ? "text-[hsl(var(--text-primary))] border-b-2 border-emerald-500 bg-[hsl(var(--bg-table-head))]/60 font-semibold"
                  : "text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-secondary))] hover:bg-[hsl(var(--bg-table-head))]/40"
              }`}
            >
              {t === "pending" ? <AlertTriangle className="w-4 h-4 text-amber-500" /> : <Clock className="w-4 h-4 text-blue-500" />}
              {t === "pending" ? "Pending Access Events" : "Correlation History"}
              {t === "pending" && pending.length > 0 && (
                <span className="bg-amber-500 text-white text-[11px] font-bold px-2 py-0.5 rounded-full">
                  {pending.length}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="p-6">
          {tab === "pending" && (
            pending.length === 0 ? (
              <div className="flex items-center gap-2 text-[hsl(var(--text-muted))] text-xs sm:text-sm py-4">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                No unmatched access control events — all door scans are correlated.
              </div>
            ) : (
              <EventTable events={pending} />
            )
          )}
          {tab === "history" && (
            history.length === 0 ? (
              <p className="text-[hsl(var(--text-muted))] text-xs sm:text-sm py-4">
                No identity events matched or expired yet.
              </p>
            ) : (
              <EventTable events={[...history].reverse()} />
            )
          )}
        </div>
      </div>

      {/* Manual Correlation Modal */}
      {isCorrelateModalOpen && selectedTrackForCorrelate && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="p-6 border-b border-[hsl(var(--border))] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
                  <UserCheck className="w-5 h-5 text-emerald-500" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-[hsl(var(--text-primary))]">
                    Manual Employee Correlation
                  </h3>
                  <p className="text-xs text-[hsl(var(--text-muted))] mt-0.5">
                    Assigning Track <span className="font-mono font-bold text-emerald-500">#{selectedTrackForCorrelate.track_id}</span> on Camera <span className="font-bold text-[hsl(var(--text-primary))]">{selectedTrackForCorrelate.camera_id}</span>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsCorrelateModalOpen(false)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 space-y-4 flex-1 overflow-y-auto">
              {correlateError && (
                <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 text-xs">
                  {correlateError}
                </div>
              )}

              {/* Custom Employee ID Input */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[hsl(var(--text-muted))] mb-1">
                  Specify Employee ID (e.g. CDE139)
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Enter Employee ID, e.g. CDE139"
                    value={targetEmployeeId}
                    onChange={(e) => setTargetEmployeeId(e.target.value)}
                    className="flex-1 bg-[hsl(var(--bg-input))] border border-[hsl(var(--border-strong))] rounded-xl px-4 py-2 text-sm text-[hsl(var(--text-primary))] focus:outline-none focus:border-emerald-500 font-mono"
                  />
                  <button
                    type="button"
                    disabled={!targetEmployeeId.trim() || correlating}
                    onClick={() => handleExecuteManualCorrelate(targetEmployeeId)}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs shadow-sm disabled:opacity-50 transition-all flex items-center gap-1.5 shrink-0"
                  >
                    {correlating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    <span>Assign ID</span>
                  </button>
                </div>
              </div>

              <div className="relative border-t border-[hsl(var(--border))] pt-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-bold uppercase tracking-wider text-[hsl(var(--text-muted))]">
                    Or Select from Registered Employees ({employees.length})
                  </label>
                </div>

                {/* Employee Search */}
                <div className="relative mb-3">
                  <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[hsl(var(--text-muted))]" />
                  <input
                    type="text"
                    placeholder="Filter employees by name or ID…"
                    value={searchEmployeeQuery}
                    onChange={(e) => setSearchEmployeeQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 text-xs bg-[hsl(var(--bg-input))] border border-[hsl(var(--border-strong))] rounded-xl text-[hsl(var(--text-primary))] focus:outline-none focus:border-emerald-500"
                  />
                </div>

                {/* Employee List Options */}
                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {filteredEmployeesForModal.length === 0 ? (
                    <div className="p-4 text-center text-xs text-[hsl(var(--text-muted))]">
                      No matching registered employees found.
                    </div>
                  ) : (
                    filteredEmployeesForModal.map((emp) => (
                      <button
                        key={emp.employee_id}
                        type="button"
                        onClick={() => handleExecuteManualCorrelate(emp.employee_id)}
                        disabled={correlating}
                        className="w-full p-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-input))] hover:bg-emerald-500/10 hover:border-emerald-500/30 text-left flex items-center justify-between transition-all group"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-extrabold flex items-center justify-center text-xs shrink-0">
                            {emp.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                          </div>
                          <div>
                            <div className="text-sm font-bold text-[hsl(var(--text-primary))] group-hover:text-emerald-500 transition-colors">
                              {emp.name}
                            </div>
                            <div className="text-xs text-[hsl(var(--text-muted))]">
                              {emp.department || "General"} {emp.designation ? `• ${emp.designation}` : ""}
                            </div>
                          </div>
                        </div>

                        <span className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                          {emp.employee_id}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-[hsl(var(--border))] bg-[hsl(var(--bg-card-2))] flex items-center justify-end">
              <button
                type="button"
                onClick={() => setIsCorrelateModalOpen(false)}
                className="px-4 py-2 text-xs font-semibold rounded-xl bg-[hsl(var(--bg-input))] text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] border border-[hsl(var(--border))]"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Shared event table ────────────────────────────────────────────────────

function EventTable({ events }: { events: IdentityEvent[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs sm:text-sm">
        <thead>
          <tr className="text-xs text-[hsl(var(--text-muted))] border-b border-[hsl(var(--border))] font-bold uppercase tracking-wider text-[11px]">
            {["Employee", "Gate", "Timestamp", "Provider", "Status", "Matched Track", "Delay"].map((h) => (
              <th key={h} className="pb-3 pr-4 font-semibold">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[hsl(var(--border))]/60">
          {events.map((ev) => (
            <tr key={ev.event_id} className="hover:bg-[hsl(var(--bg-table-head))]/50 transition-colors">
              <td className="py-3 pr-4 font-bold text-[hsl(var(--text-primary))]">{ev.employee_id}</td>
              <td className="py-3 pr-4 text-[hsl(var(--text-secondary))]">{ev.entry_gate}</td>
              <td className="py-3 pr-4 text-[hsl(var(--text-secondary))] text-xs font-mono">{formatTime(ev.timestamp)}</td>
              <td className="py-3 pr-4 text-[hsl(var(--text-muted))] text-xs">{ev.provider}</td>
              <td className="py-3 pr-4">
                <span className={`text-xs px-2.5 py-0.5 rounded-full inline-flex items-center gap-1 font-semibold ${
                  ev.correlation_status === "WAITING_FOR_TRACK"
                    ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30"
                    : ev.correlation_status === "MATCHED"
                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30"
                    : "bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30"
                }`}>
                  {ev.correlation_status === "WAITING_FOR_TRACK" && <Loader2 className="w-3 h-3 animate-spin" />}
                  {ev.correlation_status === "MATCHED" && <CheckCircle2 className="w-3 h-3" />}
                  {ev.correlation_status === "EXPIRED" && <XCircle className="w-3 h-3" />}
                  {ev.correlation_status.replace("_", " ")}
                </span>
              </td>
              <td className="py-3 pr-4 text-[hsl(var(--text-muted))] text-xs font-mono">{ev.matched_track_id ?? "—"}</td>
              <td className="py-3 text-[hsl(var(--text-secondary))] font-mono">
                {ev.correlation_delay_seconds != null
                  ? `${ev.correlation_delay_seconds.toFixed(2)}s`
                  : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
