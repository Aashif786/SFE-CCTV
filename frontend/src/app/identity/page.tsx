"use client";
import { useEffect, useState, useCallback } from "react";
import {
  UserCheck, Clock, Wifi, RefreshCw, Send, Fingerprint,
  CheckCircle2, XCircle, Loader2, AlertTriangle, UserX
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
  WAITING_FOR_TRACK: "bg-amber-500/15 text-amber-300 border border-amber-500/30",
  MATCHED:           "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30",
  EXPIRED:           "bg-red-500/15 text-red-400 border border-red-500/30",
  ACTIVE:            "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30",
  CLOSED:            "bg-gray-500/15 text-gray-400 border border-gray-600/30",
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

export default function IdentityPage() {
  // Check-in form
  const [employeeId, setEmployeeId] = useState("");
  const [entryGate, setEntryGate] = useState("Gate-A");
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // Data
  const [sessions, setSessions] = useState<WorkerSession[]>([]);
  const [pending, setPending] = useState<IdentityEvent[]>([]);
  const [history, setHistory] = useState<IdentityEvent[]>([]);
  const [tab, setTab] = useState<"pending" | "history">("pending");
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(new Date());

  // ── Fetch data ────────────────────────────────────────────────────────

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

  // ── Submit check-in ───────────────────────────────────────────────────

  const handleCheckIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employeeId.trim()) return;
    setSubmitting(true);
    setSubmitResult(null);
    try {
      const res = await fetch(`${API}/api/identity/entry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: employeeId.trim(), entryGate }),
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json();
      setSubmitResult({ ok: true, msg: `✅ ${data.employee_id} queued — walk into frame within 5 seconds` });
      setEmployeeId("");
      refresh();
    } catch (err: any) {
      setSubmitResult({ ok: false, msg: `❌ ${err.message}` });
    } finally {
      setSubmitting(false);
      setTimeout(() => setSubmitResult(null), 6000);
    }
  };

  // ── UI ────────────────────────────────────────────────────────────────

  return (
    <div className="p-8 space-y-8 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-3">
            <Fingerprint className="w-7 h-7 text-emerald-400" />
            Identity Management
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Check in workers before they enter the camera frame.
            The system automatically links their identity to the detected pose.
          </p>
        </div>
        <button
          onClick={refresh}
          className="flex items-center gap-2 text-sm text-gray-400 hover:text-white bg-gray-800 px-3 py-2 rounded-lg border border-gray-700 hover:border-gray-600 transition-all"
        >
          <RefreshCw className="w-4 h-4" />
          <span className="text-xs text-gray-600">
            {lastRefresh.toLocaleTimeString()}
          </span>
        </button>
      </div>

      {/* ── Top row: Check-in + Active Sessions ──────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">

        {/* Check-in Panel */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h3 className="text-base font-semibold text-white mb-1 flex items-center gap-2">
            <Send className="w-4 h-4 text-emerald-400" />
            Worker Check-In
          </h3>
          <p className="text-xs text-gray-500 mb-5">
            Submit the employee ID, then walk into camera frame within 5 seconds.
          </p>

          <form onSubmit={handleCheckIn} className="space-y-4">
            <div>
              <label className="text-xs font-medium text-gray-400 mb-1 block">Employee ID</label>
              <input
                id="employee-id-input"
                type="text"
                placeholder="e.g. EMP001"
                value={employeeId}
                onChange={e => setEmployeeId(e.target.value)}
                required
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-600 focus:outline-none focus:border-emerald-500 transition-colors text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-400 mb-1 block">Entry Gate</label>
              <select
                id="entry-gate-select"
                value={entryGate}
                onChange={e => setEntryGate(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-emerald-500 transition-colors text-sm"
              >
                {["Gate-A", "Gate-B", "Gate-C", "Gate-D"].map(g => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </div>

            <button
              id="checkin-submit-btn"
              type="submit"
              disabled={submitting || !employeeId.trim()}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm transition-all"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserCheck className="w-4 h-4" />}
              {submitting ? "Registering…" : "Check In"}
            </button>
          </form>

          {submitResult && (
            <div className={`mt-4 px-4 py-3 rounded-lg text-sm border ${
              submitResult.ok
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                : "bg-red-500/10 border-red-500/30 text-red-400"
            }`}>
              {submitResult.msg}
            </div>
          )}

          {/* How-to steps */}
          <div className="mt-6 pt-5 border-t border-gray-800">
            <p className="text-xs font-medium text-gray-500 mb-3">HOW IT WORKS</p>
            <ol className="space-y-2 text-xs text-gray-400">
              {[
                "Enter the Employee ID and select the entry gate.",
                "Click Check In — the identity event is queued.",
                "Walk into the camera frame within 5 seconds.",
                "The system matches your identity to the detected pose.",
                "The camera overlay shows your Employee ID in green.",
              ].map((step, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="w-5 h-5 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center text-emerald-400 font-bold flex-shrink-0 mt-0.5">{i + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>

        {/* Active Sessions */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h3 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
            <Wifi className="w-4 h-4 text-emerald-400 animate-pulse" />
            Active Worker Sessions
            {sessions.length > 0 && (
              <span className="ml-auto text-xs font-bold bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full border border-emerald-500/30">
                {sessions.length} live
              </span>
            )}
          </h3>

          {loading ? (
            <div className="flex items-center gap-2 text-gray-500 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading…
            </div>
          ) : sessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <UserX className="w-10 h-10 text-gray-700 mb-3" />
              <p className="text-sm text-gray-500">No active sessions</p>
              <p className="text-xs text-gray-600 mt-1">Check in a worker and walk into frame</p>
            </div>
          ) : (
            <div className="space-y-3">
              {sessions.map(s => (
                <div key={s.session_id} className="bg-gray-800/60 border border-gray-700 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center">
                        <span className="text-emerald-400 font-bold text-xs">
                          {s.employee_id.replace("EMP", "")}
                        </span>
                      </div>
                      <div>
                        <div className="text-sm font-bold text-white">{s.employee_id}</div>
                        <div className="text-xs text-gray-500">Track: {s.current_track_id}</div>
                      </div>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full flex items-center gap-1 ${STATUS_PILL[s.status]}`}>
                      {STATUS_ICON[s.status as keyof typeof STATUS_ICON]}
                      {s.status}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-gray-500">
                    <div>Camera: <span className="text-gray-300">{s.camera_id}</span></div>
                    <div>Started: <span className="text-gray-300">{fmtTime(s.start_time)}</span></div>
                    <div>Correlation: <span className="text-gray-300">{s.correlation_delay_seconds.toFixed(2)}s delay</span></div>
                    <div>Duration: <span className="text-gray-300">{elapsed(s.start_time)}</span></div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Bottom row: Pending + History tabs ───────────────────────────── */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        {/* Tabs */}
        <div className="flex border-b border-gray-800">
          {(["pending", "history"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-6 py-4 text-sm font-medium transition-colors flex items-center gap-2 capitalize ${
                tab === t
                  ? "text-white border-b-2 border-emerald-500 bg-gray-800/50"
                  : "text-gray-500 hover:text-gray-300"
              }`}
            >
              {t === "pending" ? <AlertTriangle className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
              {t === "pending" ? "Pending" : "History"}
              {t === "pending" && pending.length > 0 && (
                <span className="bg-amber-500 text-black text-xs font-bold px-1.5 rounded-full">
                  {pending.length}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="p-6">
          {tab === "pending" && (
            pending.length === 0 ? (
              <div className="flex items-center gap-2 text-gray-500 text-sm py-4">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                No unmatched events — all identity events have been correlated.
              </div>
            ) : (
              <EventTable events={pending} />
            )
          )}
          {tab === "history" && (
            history.length === 0 ? (
              <p className="text-gray-500 text-sm py-4">No identity events matched or expired yet.</p>
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
          <tr className="text-xs text-gray-500 border-b border-gray-800">
            {["Employee", "Gate", "Timestamp", "Provider", "Status", "Track", "Delay"].map(h => (
              <th key={h} className="text-left pb-3 pr-4 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800/60">
          {events.map(ev => (
            <tr key={ev.event_id} className="hover:bg-gray-800/30 transition-colors">
              <td className="py-3 pr-4 font-bold text-white">{ev.employee_id}</td>
              <td className="py-3 pr-4 text-gray-400">{ev.entry_gate}</td>
              <td className="py-3 pr-4 text-gray-400">{fmtTime(ev.timestamp)}</td>
              <td className="py-3 pr-4 text-gray-500 text-xs">{ev.provider}</td>
              <td className="py-3 pr-4">
                <span className={`text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${STATUS_PILL[ev.correlation_status]}`}>
                  {STATUS_ICON[ev.correlation_status as keyof typeof STATUS_ICON]}
                  {ev.correlation_status.replace("_", " ")}
                </span>
              </td>
              <td className="py-3 pr-4 text-gray-500 text-xs font-mono">{ev.matched_track_id ?? "—"}</td>
              <td className="py-3 text-gray-400">
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
