"use client";
import { useEffect, useState, useCallback } from "react";
import {
  UserCheck, Shield, Clock, Wifi, RefreshCw,
  CheckCircle2, AlertCircle, Loader2, ArrowRight, Server, Play, StopCircle
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
  matched_track_id: string | null;
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

      if (doorsRes.ok) {
        setDoors(await doorsRes.json());
      }
      
      let mergedEvents: IdentityEvent[] = [];
      if (pendingRes.ok) {
        const pending = await pendingRes.json();
        mergedEvents = [...mergedEvents, ...pending];
      }
      if (historyRes.ok) {
        const history = await historyRes.json();
        mergedEvents = [...mergedEvents, ...history];
      }

      // Sort by timestamp descending (newest first)
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

  // Statistics calculation
  const totalEntries = events.length;
  const inEntries = events.filter(e => e.event_type === "ENTRY" || !e.event_type).length;
  const outEntries = events.filter(e => e.event_type === "EXIT").length;
  const pendingEntries = events.filter(e => e.correlation_status === "WAITING_FOR_TRACK").length;
  const onlineDoors = doors.filter(d => d.status === "Connected").length;

  const getInitials = (id: string) => {
    return id.substring(0, 3).toUpperCase();
  };

  const getAvatarColor = (id: string) => {
    const hash = id.split("").reduce((acc, char) => char.charCodeAt(0) + acc, 0);
    const colors = [
      "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30",
      "bg-blue-500/10 text-blue-400 border border-blue-500/30",
      "bg-amber-500/10 text-amber-400 border border-amber-500/30",
      "bg-purple-500/10 text-purple-400 border border-purple-500/30",
      "bg-rose-500/10 text-rose-400 border border-rose-500/30",
      "bg-cyan-500/10 text-cyan-400 border border-cyan-500/30",
    ];
    return colors[hash % colors.length];
  };

  return (
    <div className="p-6 sm:p-8 space-y-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-3xl font-extrabold text-white tracking-tight flex items-center gap-3">
            <UserCheck className="w-8 h-8 text-emerald-400" />
            Live Check-ins Dashboard
          </h2>
          <p className="text-sm text-gray-400 mt-1">
            Real-time feed of employee card scans and face verifications across Hikvision terminals.
          </p>
        </div>
        <button
          onClick={fetchStatus}
          className="self-start sm:self-center flex items-center gap-2 text-xs font-semibold text-gray-400 hover:text-white bg-gray-900 px-4 py-2.5 rounded-lg border border-gray-800 hover:border-gray-700 transition-all shadow-md shadow-black/20"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-emerald-400' : ''}`} />
          <span>Last Update: {mounted ? lastRefresh.toLocaleTimeString() : "--:--:--"}</span>
        </button>
      </div>

      {/* KPI Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 shadow-lg relative overflow-hidden group">
          <div className="flex items-center justify-between mb-3">
            <span className="text-gray-400 text-xs font-semibold tracking-wider uppercase">Active Live Doors</span>
            <div className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
              <Server className="w-4 h-4 text-emerald-400" />
            </div>
          </div>
          <div className="text-3xl font-black text-white">{onlineDoors} <span className="text-gray-600 text-lg">/ {doors.length}</span></div>
          <div className="text-xs text-gray-500 mt-2">
            ISAPI Alert Streams initialized
          </div>
          <div className="absolute bottom-0 left-0 w-full h-[3px] bg-emerald-500/40"></div>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 shadow-lg relative overflow-hidden">
          <div className="flex items-center justify-between mb-3">
            <span className="text-gray-400 text-xs font-semibold tracking-wider uppercase">Check-ins Today (IN)</span>
            <div className="w-7 h-7 rounded-lg bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
              <UserCheck className="w-4 h-4 text-blue-400" />
            </div>
          </div>
          <div className="text-3xl font-black text-white">{inEntries}</div>
          <div className="text-xs text-gray-500 mt-2">
            Entries registered from IN gates
          </div>
          <div className="absolute bottom-0 left-0 w-full h-[3px] bg-blue-500/40"></div>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 shadow-lg relative overflow-hidden">
          <div className="flex items-center justify-between mb-3">
            <span className="text-gray-400 text-xs font-semibold tracking-wider uppercase">Check-outs Today (OUT)</span>
            <div className="w-7 h-7 rounded-lg bg-purple-500/10 flex items-center justify-center border border-purple-500/20">
              <UserCheck className="w-4 h-4 text-purple-400" />
            </div>
          </div>
          <div className="text-3xl font-black text-white">{outEntries}</div>
          <div className="text-xs text-gray-500 mt-2">
            Exits registered from OUT gates
          </div>
          <div className="absolute bottom-0 left-0 w-full h-[3px] bg-purple-500/40"></div>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 shadow-lg relative overflow-hidden">
          <div className="flex items-center justify-between mb-3">
            <span className="text-gray-400 text-xs font-semibold tracking-wider uppercase">Awaiting Camera Track</span>
            <div className="w-7 h-7 rounded-lg bg-amber-500/10 flex items-center justify-center border border-amber-500/20">
              <Loader2 className="w-4 h-4 text-amber-400 animate-spin" />
            </div>
          </div>
          <div className="text-3xl font-black text-white">{pendingEntries}</div>
          <div className="text-xs text-gray-500 mt-2">
            Queued for CCTV verification
          </div>
          <div className="absolute bottom-0 left-0 w-full h-[3px] bg-amber-500/40"></div>
        </div>
      </div>

      {/* Main Content Body */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Column: Door Status & Diagnostics */}
        <div className="space-y-6 lg:col-span-1">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 shadow-xl">
            <div className="flex items-center gap-2 mb-4">
              <Server className="w-5 h-5 text-emerald-400" />
              <h3 className="font-bold text-white text-base">Terminal Statuses</h3>
            </div>
            
            {doors.length === 0 ? (
              <div className="bg-gray-950/50 rounded-lg p-6 border border-gray-800/80 text-center">
                <AlertCircle className="w-8 h-8 text-gray-600 mx-auto mb-2" />
                <p className="text-sm text-gray-400 font-semibold">No configured doors</p>
                <p className="text-xs text-gray-500 mt-1">Configure HIKVISION_DOORS inside .env</p>
              </div>
            ) : (
              <div className="space-y-4">
                {doors.map((door) => (
                  <div
                    key={door.ip}
                    className="p-4 bg-gray-950/60 rounded-xl border border-gray-800 flex flex-col gap-2 hover:border-gray-700 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="font-semibold text-white text-sm">{door.name}</h4>
                        <code className="text-xs text-gray-500">{door.ip}</code>
                      </div>
                      
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1.5 ${
                        door.status === "Connected" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" :
                        door.status === "Connecting" ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" :
                        "bg-red-500/10 text-red-400 border border-red-500/20"
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${
                          door.status === "Connected" ? "bg-emerald-400 animate-pulse" :
                          door.status === "Connecting" ? "bg-amber-400 animate-spin" :
                          "bg-red-400"
                        }`}></span>
                        {door.status}
                      </span>
                    </div>

                    {door.last_error && (
                      <div className="mt-1 p-2 bg-red-500/5 rounded-lg border border-red-500/10 text-[11px] text-red-400 font-mono break-all">
                        {door.last_error}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Guidelines Box */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 shadow-xl text-xs space-y-4 text-gray-400">
            <h4 className="font-bold text-white text-sm flex items-center gap-2">
              <Shield className="w-4 h-4 text-emerald-400" />
              Security & Matching System
            </h4>
            <p>
              When a worker triggers a valid scan at a door, the event is immediately captured by the background stream listener.
            </p>
            <div className="p-3 bg-gray-950 rounded-lg border border-gray-800 font-mono space-y-1.5 text-gray-500">
              <div className="flex items-center gap-1.5 text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                <span>1. Card/Face Scan Verified</span>
              </div>
              <div className="flex items-center gap-1.5 text-blue-400">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400"></span>
                <span>2. Stream pushes XML to Python</span>
              </div>
              <div className="flex items-center gap-1.5 text-amber-400">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
                <span>3. Wait 5s for track overlap</span>
              </div>
              <div className="flex items-center gap-1.5 text-gray-400">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400"></span>
                <span>4. Camera lock-on / Session active</span>
              </div>
            </div>
            <p className="text-gray-500">
              Only successful entry scans with a valid employee ID block are registered. Invalid scans are silently discarded.
            </p>
          </div>
        </div>

        {/* Right Column: Live Timeline */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 shadow-xl flex flex-col h-full min-h-[500px]">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-emerald-400 animate-pulse" />
                <h3 className="font-bold text-white text-base">Real-Time Access Stream</h3>
              </div>
              
              <span className="text-xs text-gray-500 font-semibold">Showing last {events.length} logs</span>
            </div>

            {events.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center py-20 text-center">
                <Loader2 className="w-10 h-10 text-gray-700 animate-spin mb-4" />
                <p className="text-sm text-gray-400 font-semibold">Awaiting events from terminals...</p>
                <p className="text-xs text-gray-500 mt-1">Scan a card or trigger a manual injection to test.</p>
              </div>
            ) : (
              <div className="overflow-x-auto w-full max-h-[700px] overflow-y-auto pr-1">
                <table className="w-full text-left text-sm text-gray-300 border-collapse">
                  <thead>
                    <tr className="border-b border-gray-800 text-xs font-bold uppercase tracking-wider text-gray-400">
                      <th className="pb-3 pr-4 pl-2">ID</th>
                      <th className="pb-3 pr-4">Name</th>
                      <th className="pb-3 pr-4">Date & Time</th>
                      <th className="pb-3 pr-4">Type</th>
                      <th className="pb-3 pr-4">Gate</th>
                      <th className="pb-3 pr-4 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/40">
                    {events.map((event) => (
                      <tr 
                        key={event.event_id}
                        className="hover:bg-gray-950/40 transition-colors"
                      >
                        <td className="py-3.5 pr-4 pl-2 font-mono font-bold text-white text-xs">
                          {event.employee_id}
                        </td>
                        <td className="py-3.5 pr-4 font-semibold text-gray-100">
                          {event.employee_name || "—"}
                        </td>
                        <td className="py-3.5 pr-4 text-xs text-gray-400">
                          {new Date(event.timestamp).toLocaleDateString()} &middot; {new Date(event.timestamp).toLocaleTimeString()}
                        </td>
                        <td className="py-3.5 pr-4">
                          <span className={`text-[10px] font-black px-2 py-0.5 rounded border inline-block ${
                            event.event_type === "EXIT" 
                              ? "bg-purple-500/10 text-purple-400 border-purple-500/20" 
                              : "bg-blue-500/10 text-blue-400 border-blue-500/20"
                          }`}>
                            {event.event_type === "EXIT" ? "OUT" : "IN"}
                          </span>
                        </td>
                        <td className="py-3.5 pr-4 text-xs font-semibold text-gray-300">
                          {event.entry_gate}
                        </td>
                        <td className="py-3.5 pr-4 text-right">
                          <div className="flex flex-col items-end gap-1">
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${
                              event.correlation_status === "MATCHED" ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/20" :
                              event.correlation_status === "WAITING_FOR_TRACK" ? "bg-amber-500/15 text-amber-300 border border-amber-500/20" :
                              "bg-red-500/15 text-red-400 border border-red-500/20"
                            }`}>
                              {event.correlation_status === "MATCHED" && <CheckCircle2 className="w-3 h-3" />}
                              {event.correlation_status === "WAITING_FOR_TRACK" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                              {event.correlation_status === "EXPIRED" && <AlertCircle className="w-3 h-3" />}
                              {event.correlation_status.replace("_", " ")}
                            </span>
                            {event.matched_track_id && (
                              <span className="text-[10px] text-emerald-400/80 font-mono">
                                Track {event.matched_track_id} ({event.correlation_delay_seconds?.toFixed(1)}s delay)
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
