"use client";
import { useEffect, useState, useCallback } from "react";
import { formatDateTime } from "@/lib/dateUtils";
import {
  UserCheck, Shield, Clock, Wifi, RefreshCw,
  CheckCircle2, AlertCircle, Loader2, Server
} from "lucide-react";

const API = "http://localhost:8000";

interface DoorStatus {
  ip: string;
  name: string;
  status: "Connected" | "Connecting" | "Error" | "Disconnected";
  last_error: string | null;
}

interface IdentityEvent {
  event_id: string;
  employee_id: string;
  employee_name?: string | null;
  event_type: string;
  timestamp: string;
  entry_gate: string;
  provider: string;
  correlation_status: "WAITING_FOR_TRACK" | "MATCHED" | "EXPIRED";
  allowed_cameras?: (string | number)[];
  matched_track_id: string | null;
  matched_camera_id?: string | null;
  matched_at: string | null;
  correlation_delay_seconds: number | null;
}


export default function LiveCheckinsPage() {
  const [doors, setDoors] = useState<DoorStatus[]>([]);
  const [events, setEvents] = useState<IdentityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [mounted, setMounted] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const [doorsRes, pendingRes, historyRes] = await Promise.all([
        fetch(`${API}/api/identity/doors`),
        fetch(`${API}/api/identity/pending`),
        fetch(`${API}/api/identity/history`),
      ]);

      if (doorsRes.ok) setDoors(await doorsRes.json());

      let mergedEvents: IdentityEvent[] = [];
      if (pendingRes.ok) mergedEvents = [...mergedEvents, ...await pendingRes.json()];
      if (historyRes.ok) mergedEvents = [...mergedEvents, ...await historyRes.json()];

      mergedEvents.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setEvents(mergedEvents);
      setLastRefresh(new Date());
    } catch (err) {
      console.error("Failed to fetch check-in dashboard data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setMounted(true);
    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const inEntries = events.filter(e => e.event_type === "ENTRY" || !e.event_type).length;
  const outEntries = events.filter(e => e.event_type === "EXIT").length;
  const pendingEntries = events.filter(e => e.correlation_status === "WAITING_FOR_TRACK").length;
  const onlineDoors = doors.filter(d => d.status === "Connected").length;

  const kpiCards = [
    {
      label: "Active Live Doors",
      value: <>{onlineDoors} <span className="text-[hsl(var(--text-muted))] text-lg font-normal">/ {doors.length}</span></>,
      sub: "ISAPI Alert Streams initialized",
      icon: Server,
      iconBg: "bg-emerald-500/10 border-emerald-500/20",
      iconColor: "text-emerald-600 dark:text-emerald-400",
      accent: "bg-emerald-500/40",
    },
    {
      label: "Check-ins Today (IN)",
      value: inEntries,
      sub: "Entries registered from IN gates",
      icon: UserCheck,
      iconBg: "bg-blue-500/10 border-blue-500/20",
      iconColor: "text-blue-600 dark:text-blue-400",
      accent: "bg-blue-500/40",
    },
    {
      label: "Check-outs Today (OUT)",
      value: outEntries,
      sub: "Exits registered from OUT gates",
      icon: UserCheck,
      iconBg: "bg-purple-500/10 border-purple-500/20",
      iconColor: "text-purple-600 dark:text-purple-400",
      accent: "bg-purple-500/40",
    },
    {
      label: "Awaiting Camera Track",
      value: pendingEntries,
      sub: "Queued for CCTV verification",
      icon: Loader2,
      iconBg: "bg-amber-500/10 border-amber-500/20",
      iconColor: "text-amber-600 dark:text-amber-400 animate-spin",
      accent: "bg-amber-500/40",
    },
  ];

  return (
    <div className="p-6 sm:p-8 space-y-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-3xl font-extrabold text-[hsl(var(--text-primary))] tracking-tight flex items-center gap-3">
            <UserCheck className="w-8 h-8 text-emerald-500" />
            Live Check-ins Dashboard
          </h2>
          <p className="text-sm text-[hsl(var(--text-muted))] mt-1">
            Real-time feed of employee card scans and face verifications across Hikvision terminals.
          </p>
        </div>
        <button
          onClick={fetchStatus}
          className="self-start sm:self-center flex items-center gap-2 text-xs font-semibold
            text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))]
            bg-[hsl(var(--bg-card))] px-4 py-2.5 rounded-lg
            border border-[hsl(var(--border))] hover:border-[hsl(var(--border-strong))]
            transition-all shadow-sm"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-emerald-500' : ''}`} />
          <span>Last Update: {mounted ? lastRefresh.toLocaleTimeString() : "--:--:--"}</span>
        </button>
      </div>

      {/* KPI Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {kpiCards.map(({ label, value, sub, icon: Icon, iconBg, iconColor, accent }) => (
          <div key={label} className="bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] rounded-xl p-5 shadow-sm relative overflow-hidden">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[hsl(var(--text-muted))] text-xs font-semibold tracking-wider uppercase">{label}</span>
              <div className={`w-7 h-7 rounded-lg ${iconBg} flex items-center justify-center border`}>
                <Icon className={`w-4 h-4 ${iconColor}`} />
              </div>
            </div>
            <div className="text-3xl font-black text-[hsl(var(--text-primary))]">{value}</div>
            <div className="text-xs text-[hsl(var(--text-muted))] mt-2">{sub}</div>
            <div className={`absolute bottom-0 left-0 w-full h-[3px] ${accent}`} />
          </div>
        ))}
      </div>

      <div className="lg:col-span-2 space-y-6">
        <div className="bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] rounded-xl p-6 shadow-sm flex flex-col h-full min-h-[500px]">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-emerald-500 animate-pulse" />
              <h3 className="font-bold text-[hsl(var(--text-primary))] text-base">Real-Time Access Stream</h3>
            </div>
            <span className="text-xs text-[hsl(var(--text-muted))] font-semibold">
              Showing last {events.length} logs
            </span>
          </div>

          {events.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center py-20 text-center">
              <Loader2 className="w-10 h-10 text-[hsl(var(--text-muted))] animate-spin mb-4" />
              <p className="text-sm text-[hsl(var(--text-secondary))] font-semibold">Awaiting events from terminals...</p>
              <p className="text-xs text-[hsl(var(--text-muted))] mt-1">Scan a card or trigger a manual injection to test.</p>
            </div>
          ) : (
            <div className="overflow-x-auto w-full max-h-[700px] overflow-y-auto pr-1">
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="border-b border-[hsl(var(--border))] text-xs font-bold uppercase tracking-wider text-[hsl(var(--text-muted))]">
                    <th className="pb-3 pr-4 pl-2">ID</th>
                    <th className="pb-3 pr-4">Name</th>
                    <th className="pb-3 pr-4">Date &amp; Time</th>
                    <th className="pb-3 pr-4">Type</th>
                    <th className="pb-3 pr-4">Gate</th>
                    <th className="pb-3 pr-4">Expected Cameras</th>
                    <th className="pb-3 pr-4 text-right">Status / Match</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[hsl(var(--border))]/40">
                  {events.map((event) => {
                    const allowedCams = event.allowed_cameras || [];
                    return (
                      <tr
                        key={event.event_id}
                        className="hover:bg-[hsl(var(--bg-table-head))]/50 transition-colors"
                      >
                        <td className="py-3.5 pr-4 pl-2 font-mono font-bold text-[hsl(var(--text-primary))] text-xs">
                          {event.employee_id}
                        </td>
                        <td className="py-3.5 pr-4 font-semibold text-[hsl(var(--text-primary))]">
                          {event.employee_name || "—"}
                        </td>
                        <td className="py-3.5 pr-4 text-xs text-[hsl(var(--text-muted))]">
                          {formatDateTime(event.timestamp)}
                        </td>
                        <td className="py-3.5 pr-4">
                          <span className={`text-[10px] font-black px-2 py-0.5 rounded border inline-block ${
                            event.event_type === "EXIT"
                              ? "bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20"
                              : "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20"
                          }`}>
                            {event.event_type === "EXIT" ? "OUT" : "IN"}
                          </span>
                        </td>
                        <td className="py-3.5 pr-4 text-xs font-semibold text-[hsl(var(--text-secondary))]">
                          {event.entry_gate}
                        </td>
                        <td className="py-3.5 pr-4">
                          {allowedCams.length === 0 ? (
                            <span className="text-[11px] text-[hsl(var(--text-muted))] italic">All cameras</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {allowedCams.map((cid) => (
                                <span key={cid} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-500/10 text-[hsl(var(--text-secondary))] font-mono font-medium border border-[hsl(var(--border))]">
                                  Cam {cid}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="py-3.5 pr-4 text-right">
                          <div className="flex flex-col items-end gap-1">
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${
                              event.correlation_status === "MATCHED"
                                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20"
                                : event.correlation_status === "WAITING_FOR_TRACK"
                                ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/20"
                                : "bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/20"
                            }`}>
                              {event.correlation_status === "MATCHED" && <CheckCircle2 className="w-3 h-3" />}
                              {event.correlation_status === "WAITING_FOR_TRACK" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                              {event.correlation_status === "EXPIRED" && <AlertCircle className="w-3 h-3" />}
                              {event.correlation_status.replace("_", " ")}
                            </span>
                            {event.matched_track_id && (
                              <span className="text-[10px] text-emerald-600 dark:text-emerald-400/90 font-mono">
                                {event.matched_camera_id ? `Cam ${event.matched_camera_id} ` : ""}Track {event.matched_track_id} ({event.correlation_delay_seconds?.toFixed(1)}s delay)
                              </span>
                            )}
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
      </div>
    </div>
  );
}
