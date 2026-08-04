"use client";
import { useEffect, useState, useCallback } from "react";
import {
  Clock, Wifi, RefreshCw, CheckCircle2, XCircle, Loader2, AlertTriangle, UserX
} from "lucide-react";

const API = "http://localhost:8000";

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
  employee_id: string;
  current_track_id: string;
  camera_id: string;
  start_time: string;
  end_time: string | null;
  status: "ACTIVE" | "CLOSED";
  correlation_delay_seconds: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────

const STATUS_PILL: Record<string, string> = {
  WAITING_FOR_TRACK: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30",
  MATCHED:           "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30",
  EXPIRED:           "bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30",
  ACTIVE:            "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30",
  CLOSED:            "bg-gray-500/15 text-gray-600 dark:text-gray-400 border border-gray-500/30",
};

const STATUS_ICON = {
  WAITING_FOR_TRACK: <Loader2 className="w-3 h-3 animate-spin" />,
  MATCHED:           <CheckCircle2 className="w-3 h-3" />,
  EXPIRED:           <XCircle className="w-3 h-3" />,
  ACTIVE:            <Wifi className="w-3 h-3 animate-pulse" />,
  CLOSED:            <XCircle className="w-3 h-3" />,
};

function fmtTime(iso: string) {
  return new Date(iso + "Z").toLocaleTimeString();
}

function elapsed(iso: string) {
  const secs = Math.round((Date.now() - new Date(iso + "Z").getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s ago`;
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function SessionMonitorPage() {
  const [sessions, setSessions] = useState<WorkerSession[]>([]);
  const [pending, setPending] = useState<IdentityEvent[]>([]);
  const [history, setHistory] = useState<IdentityEvent[]>([]);
  const [tab, setTab] = useState<"pending" | "history">("pending");
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const refresh = useCallback(async () => {
    try {
      const [sRes, pRes, hRes] = await Promise.all([
        fetch(`${API}/api/identity/sessions`),
        fetch(`${API}/api/identity/pending`),
        fetch(`${API}/api/identity/history`),
      ]);
      if (sRes.ok) setSessions(await sRes.json());
      if (pRes.ok) setPending(await pRes.json());
      if (hRes.ok) setHistory(await hRes.json());
      setLastRefresh(new Date());
    } catch { /* backend may not be running */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <div className="p-6 sm:p-8 space-y-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-extrabold text-[hsl(var(--text-primary))] tracking-tight flex items-center gap-3">
            <Wifi className="w-8 h-8 text-emerald-500 animate-pulse" />
            Session Monitor
          </h2>
          <p className="text-sm text-[hsl(var(--text-muted))] mt-1">
            Real-time tracking of active named worker camera sessions and CCTV correlation history.
          </p>
        </div>
        <button
          onClick={refresh}
          className="flex items-center gap-2 text-sm text-[hsl(var(--text-secondary))]
            hover:text-[hsl(var(--text-primary))] bg-[hsl(var(--bg-table-head))]
            px-3 py-2 rounded-lg border border-[hsl(var(--border))]
            hover:border-[hsl(var(--border-strong))] transition-all shadow-sm"
        >
          <RefreshCw className="w-4 h-4" />
          <span className="text-xs text-[hsl(var(--text-muted))]">
            {mounted ? lastRefresh.toLocaleTimeString() : "--:--:--"}
          </span>
        </button>
      </div>

      {/* Active Sessions Panel - Redesigned to take full width with responsive grid */}
      <div className="bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] rounded-xl p-6 shadow-sm">
        <h3 className="text-base font-bold text-[hsl(var(--text-primary))] mb-4 flex items-center gap-2">
          <Wifi className="w-4 h-4 text-emerald-500 animate-pulse" />
          Active Worker Sessions
          {sessions.length > 0 && (
            <span className="ml-auto text-xs font-bold bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 rounded-full border border-emerald-500/30">
              {sessions.length} live
            </span>
          )}
        </h3>

        {loading ? (
          <div className="flex items-center gap-2 text-[hsl(var(--text-muted))] text-sm py-6">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading…
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center border border-dashed border-[hsl(var(--border-strong))] rounded-xl bg-[hsl(var(--bg-table-head))]/20">
            <UserX className="w-10 h-10 text-[hsl(var(--text-muted))] mb-3" />
            <p className="text-sm text-[hsl(var(--text-secondary))] font-semibold">No active sessions</p>
            <p className="text-xs text-[hsl(var(--text-muted))] mt-1">Awaiting employee entry card scan or facial recognition detection.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {sessions.map(s => (
              <div key={s.session_id} className="bg-[hsl(var(--bg-table-head))]/60 border border-[hsl(var(--border))] rounded-xl p-5 hover:border-[hsl(var(--border-strong))] transition-all shadow-sm">
                <div className="flex items-center justify-between mb-3 border-b border-[hsl(var(--border))]/50 pb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center shrink-0">
                      <span className="text-emerald-600 dark:text-emerald-400 font-bold text-xs">
                        {s.employee_id.replace("EMP", "")}
                      </span>
                    </div>
                    <div>
                      <div className="text-sm font-bold text-[hsl(var(--text-primary))]">{s.employee_id}</div>
                      <div className="text-[10px] text-[hsl(var(--text-muted))] font-mono">Track: {s.current_track_id}</div>
                    </div>
                  </div>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1 ${STATUS_PILL[s.status]}`}>
                    {STATUS_ICON[s.status as keyof typeof STATUS_ICON]}
                    {s.status}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-xs text-[hsl(var(--text-muted))]">
                  <div>Camera: <span className="text-[hsl(var(--text-secondary))] font-medium">{s.camera_id}</span></div>
                  <div>Started: <span className="text-[hsl(var(--text-secondary))] font-medium">{fmtTime(s.start_time)}</span></div>
                  <div>Correlation: <span className="text-[hsl(var(--text-secondary))] font-medium">{s.correlation_delay_seconds.toFixed(2)}s delay</span></div>
                  <div>Duration: <span className="text-[hsl(var(--text-secondary))] font-medium">{elapsed(s.start_time)}</span></div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bottom: Pending + History tabs */}
      <div className="bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] rounded-xl overflow-hidden shadow-sm">
        {/* Tabs */}
        <div className="flex border-b border-[hsl(var(--border))]">
          {(["pending", "history"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-6 py-4 text-sm font-medium transition-colors flex items-center gap-2 capitalize ${
                tab === t
                  ? "text-[hsl(var(--text-primary))] border-b-2 border-emerald-500 bg-[hsl(var(--bg-table-head))]/60 font-semibold"
                  : "text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-secondary))] hover:bg-[hsl(var(--bg-table-head))]/40"
              }`}
            >
              {t === "pending" ? <AlertTriangle className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
              {t === "pending" ? "Pending Correlation" : "Correlation History"}
              {t === "pending" && pending.length > 0 && (
                <span className="bg-amber-500 text-white text-xs font-bold px-1.5 rounded-full">
                  {pending.length}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="p-6">
          {tab === "pending" && (
            pending.length === 0 ? (
              <div className="flex items-center gap-2 text-[hsl(var(--text-muted))] text-sm py-4">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                No unmatched events — all identity events have been correlated.
              </div>
            ) : (
              <EventTable events={pending} />
            )
          )}
          {tab === "history" && (
            history.length === 0 ? (
              <p className="text-[hsl(var(--text-muted))] text-sm py-4">No identity events matched or expired yet.</p>
            ) : (
              <EventTable events={[...history].reverse()} />
            )
          )}
        </div>
      </div>
    </div>
  );
}

// ── Shared event table ────────────────────────────────────────────────────

function EventTable({ events }: { events: IdentityEvent[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-[hsl(var(--text-muted))] border-b border-[hsl(var(--border))]">
            {["Employee", "Gate", "Timestamp", "Provider", "Status", "Track", "Delay"].map(h => (
              <th key={h} className="text-left pb-3 pr-4 font-semibold">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[hsl(var(--border))]/60">
          {events.map(ev => (
            <tr key={ev.event_id} className="hover:bg-[hsl(var(--bg-table-head))]/50 transition-colors">
              <td className="py-3 pr-4 font-bold text-[hsl(var(--text-primary))]">{ev.employee_id}</td>
              <td className="py-3 pr-4 text-[hsl(var(--text-secondary))]">{ev.entry_gate}</td>
              <td className="py-3 pr-4 text-[hsl(var(--text-secondary))] text-xs">{fmtTime(ev.timestamp)}</td>
              <td className="py-3 pr-4 text-[hsl(var(--text-muted))] text-xs">{ev.provider}</td>
              <td className="py-3 pr-4">
                <span className={`text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${
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
              <td className="py-3 text-[hsl(var(--text-secondary))]">
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
