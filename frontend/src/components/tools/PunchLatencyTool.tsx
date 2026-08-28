"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Timer,
  Play,
  Square,
  RefreshCw,
  Clock,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Server,
  Fingerprint,
  Zap,
  Activity,
  Cpu,
  Trash2,
  Info,
  Radio,
  ExternalLink,
  ChevronRight,
  DatabaseZap,
} from "lucide-react";

const API = typeof window === "undefined" ? "http://localhost:8001" : `http://${window.location.hostname}:8001`;

export interface PunchRecord {
  id: string;
  device_timestamp_raw: string;
  device_timestamp_iso: string;
  system_timestamp_iso: string;
  latency_ms: number;
  latency_seconds: number;
  employee_id: string;
  employee_name: string;
  card_no: string;
  door_name: string;
  device_ip: string;
  auth_type: string;
  source: string;
  direction: string;
  access_granted: boolean;
  major: number;
  minor: number;
  is_dry_run: boolean;
  recorded_at: string;
}

export interface LatencyStats {
  total_punches: number;
  history_count: number;
  avg_latency_ms: number;
  min_latency_ms: number;
  max_latency_ms: number;
  latest_punch: PunchRecord | null;
  history: PunchRecord[];
  waiting_listeners: number;
}

export default function PunchLatencyTool() {
  const [isListening, setIsListening] = useState(false);
  const [autoListen, setAutoListen] = useState(true);
  const [latestPunch, setLatestPunch] = useState<PunchRecord | null>(null);
  const [history, setHistory] = useState<PunchRecord[]>([]);
  const [stats, setStats] = useState<LatencyStats | null>(null);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [testingDryRun, setTestingDryRun] = useState(false);
  const [waitingElapsedSeconds, setWaitingElapsedSeconds] = useState(0);

  // AbortController ref for canceling long-poll request when user clicks Stop
  const abortControllerRef = useRef<AbortController | null>(null);
  const isListeningRef = useRef(isListening);
  isListeningRef.current = isListening;
  const autoListenRef = useRef(autoListen);
  autoListenRef.current = autoListen;

  // Timer for waiting state animation
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (isListening) {
      setWaitingElapsedSeconds(0);
      interval = setInterval(() => {
        setWaitingElapsedSeconds((s) => s + 1);
      }, 1000);
    } else {
      setWaitingElapsedSeconds(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isListening]);

  // Fetch current backend latency stats & history
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/tools/latency/status`);
      if (res.ok) {
        const data: LatencyStats = await res.json();
        setStats(data);
        if (data.latest_punch && !latestPunch) {
          setLatestPunch(data.latest_punch);
        }
        if (data.history) {
          setHistory(data.history);
        }
      }
    } catch (err) {
      console.error("Failed to fetch latency status:", err);
    } finally {
      setLoadingInitial(false);
    }
  }, [latestPunch]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // The long-polling loop that waits on the backend
  const startWaitingForPunch = useCallback(async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsListening(true);

    try {
      // Long-poll with 60 second timeout on backend
      const res = await fetch(`${API}/api/tools/latency/wait?timeout=60`, {
        signal: controller.signal,
      });

      if (res.ok) {
        const payload = await res.json();
        if (payload.status === "success" && payload.data) {
          const punch: PunchRecord = payload.data;
          setLatestPunch(punch);
          setHistory((prev) => [punch, ...prev.filter((p) => p.id !== punch.id)].slice(0, 50));
          fetchStatus();

          // If auto-listen is on, continue listening
          if (autoListenRef.current && isListeningRef.current) {
            setTimeout(() => {
              if (isListeningRef.current) {
                startWaitingForPunch();
              }
            }, 300);
            return;
          } else {
            setIsListening(false);
          }
        } else if (payload.status === "timeout") {
          // Timeout reached without punch; if still listening, loop again
          if (isListeningRef.current) {
            startWaitingForPunch();
            return;
          }
        }
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        console.error("Latency wait error:", err);
      }
      setIsListening(false);
    }
  }, [fetchStatus]);

  const stopWaiting = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsListening(false);
  };

  // Safe zero-DB dry-run test
  const handleDryRunTest = async () => {
    setTestingDryRun(true);
    try {
      const simulatedDelta = Math.round((Math.random() * 120 + 80) * 10) / 10;
      const res = await fetch(`${API}/api/tools/latency/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          simulated_latency_ms: simulatedDelta,
          door_name: "Turnstile Main Gate (Zero-DB Test)",
          device_ip: "192.168.1.231",
          employee_id: "EMP_DEMO",
          employee_name: "Demo Verification",
        }),
      });
      if (res.ok) {
        const payload = await res.json();
        if (payload.data) {
          setLatestPunch(payload.data);
          setHistory((prev) => [payload.data, ...prev].slice(0, 50));
          fetchStatus();
        }
      }
    } catch (err) {
      console.error("Dry run test failed:", err);
    } finally {
      setTestingDryRun(false);
    }
  };

  // Clear history
  const handleClear = async () => {
    try {
      await fetch(`${API}/api/tools/latency/clear`, { method: "POST" });
      setHistory([]);
      setLatestPunch(null);
      fetchStatus();
    } catch (err) {
      console.error("Failed to clear latency history:", err);
    }
  };

  // Helpers for latency grade & badge
  const getLatencyGrade = (ms: number) => {
    const abs = Math.abs(ms);
    if (abs < 300) {
      return {
        label: "EXCELLENT",
        description: "Ultra-low transit delay (<300ms). Perfect clock alignment.",
        color: "text-emerald-500",
        bg: "bg-emerald-500/10",
        border: "border-emerald-500/30",
      };
    }
    if (abs < 1000) {
      return {
        label: "GOOD",
        description: "Normal network push transit & controller packet dispatch.",
        color: "text-blue-500",
        bg: "bg-blue-500/10",
        border: "border-blue-500/30",
      };
    }
    if (abs < 3000) {
      return {
        label: "MODERATE DRIFT",
        description: "Mild clock skew or network queueing between reader and server.",
        color: "text-amber-500",
        bg: "bg-amber-500/10",
        border: "border-amber-500/30",
      };
    }
    return {
      label: "HIGH DRIFT / DELAY",
      description: "Significant time offset. Check NTP configuration on the Hikvision reader.",
      color: "text-rose-500",
      bg: "bg-rose-500/10",
      border: "border-rose-500/30",
    };
  };

  const grade = latestPunch ? getLatencyGrade(latestPunch.latency_ms) : null;

  return (
    <div className="space-y-8 animate-fadeIn">
      {/* Top Banner / Explainer */}
      <div className="bg-gradient-to-r from-blue-900/20 via-purple-900/15 to-emerald-900/20 border border-[hsl(var(--border))] rounded-2xl p-6 shadow-sm relative overflow-hidden">
        <div className="absolute right-0 top-0 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 text-xs font-bold uppercase tracking-wider">
              <Zap className="w-3.5 h-3.5" />
              Direct Backend Timestamp Subtraction (0ms UI Error)
            </div>
            <h3 className="text-2xl font-black text-[hsl(var(--text-primary))] tracking-tight flex items-center gap-2">
              ACS Punch Latency & Clock Drift Benchmark
            </h3>
            <p className="text-xs sm:text-sm text-[hsl(var(--text-muted))] leading-relaxed">
              Measures the exact delta between the <strong>Hikvision terminal timestamp</strong> and the{" "}
              <strong>backend server receipt time</strong>:{" "}
              <code className="px-1.5 py-0.5 rounded bg-black/20 text-emerald-400 font-mono text-xs">
                Δt = T(Server) - T(ACS Device)
              </code>
              . Calculated in Python with microsecond accuracy upon packet arrival.
            </p>
          </div>

          {/* Action Control Buttons */}
          <div className="flex flex-wrap items-center gap-3">
            {isListening ? (
              <button
                onClick={stopWaiting}
                className="flex items-center gap-2 px-5 py-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-all shadow-lg shadow-rose-600/25 active:scale-95"
              >
                <Square className="w-4 h-4 fill-current" />
                <span>Stop Listening</span>
              </button>
            ) : (
              <button
                onClick={startWaitingForPunch}
                className="flex items-center gap-2 px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all shadow-lg shadow-emerald-600/25 hover:shadow-emerald-600/40 active:scale-95 group"
              >
                <Play className="w-4 h-4 fill-current group-hover:translate-x-0.5 transition-transform" />
                <span>Wait for Punch</span>
              </button>
            )}

            {/* Zero-DB Dry Run Button */}
            <button
              onClick={handleDryRunTest}
              disabled={testingDryRun}
              title="Safe dry-run: tests the latency calculator without inserting any records into SQLite database"
              className="flex items-center gap-2 px-4 py-3 rounded-xl bg-[hsl(var(--bg-card))] hover:bg-[hsl(var(--bg-hover))] text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] border border-[hsl(var(--border))] text-xs font-semibold transition-all shadow-sm active:scale-95"
            >
              <DatabaseZap className="w-4 h-4 text-purple-400" />
              <span>{testingDryRun ? "Simulating..." : "Test Ping (Zero DB)"}</span>
            </button>

            {history.length > 0 && (
              <button
                onClick={handleClear}
                title="Clear in-memory punch history"
                className="p-3 rounded-xl bg-[hsl(var(--bg-card))] hover:bg-red-500/10 text-[hsl(var(--text-muted))] hover:text-red-500 border border-[hsl(var(--border))] transition-all"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Listening Status Bar */}
        <div className="mt-5 pt-4 border-t border-[hsl(var(--border))]/60 flex flex-wrap items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-3">
            <span
              className={`flex h-3 w-3 relative ${isListening ? "animate-ping" : ""}`}
            >
              <span
                className={`inline-flex rounded-full h-3 w-3 ${
                  isListening ? "bg-emerald-500" : "bg-gray-400 opacity-60"
                }`}
              />
            </span>
            <span className="font-semibold text-[hsl(var(--text-secondary))]">
              Status:{" "}
              {isListening ? (
                <span className="text-emerald-500 font-bold">
                  Listening on backend... ({waitingElapsedSeconds}s elapsed)
                </span>
              ) : (
                <span className="text-[hsl(var(--text-muted))]">Idle — Click &quot;Wait for Punch&quot; to begin</span>
              )}
            </span>
          </div>

          <label className="flex items-center gap-2 cursor-pointer select-none text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-secondary))]">
            <input
              type="checkbox"
              checked={autoListen}
              onChange={(e) => setAutoListen(e.target.checked)}
              className="rounded accent-emerald-500 border-[hsl(var(--border))]"
            />
            <span>Auto-listen for subsequent punches</span>
          </label>
        </div>
      </div>

      {/* Hero: Waiting State OR Latest Captured Punch */}
      {isListening && !latestPunch && (
        <div className="bg-[hsl(var(--bg-card))] border border-emerald-500/30 rounded-2xl p-12 text-center relative overflow-hidden shadow-lg">
          <div className="absolute inset-0 bg-emerald-500/[0.02] animate-pulse" />
          <div className="w-20 h-20 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mx-auto mb-4 relative">
            <Radio className="w-10 h-10 text-emerald-500 animate-pulse" />
            <div className="absolute inset-0 rounded-full border border-emerald-500/40 animate-ping opacity-40" />
          </div>
          <h4 className="text-xl font-extrabold text-[hsl(var(--text-primary))]">
            Waiting for punch on physical reader...
          </h4>
          <p className="text-xs text-[hsl(var(--text-muted))] max-w-md mx-auto mt-2 leading-relaxed">
            Swipe an RFID card or trigger face recognition on any configured Hikvision door terminal.
            The backend listener will intercept the event the microsecond it arrives.
          </p>
          <div className="inline-flex items-center gap-2 mt-4 px-4 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-mono text-xs">
            <Clock className="w-3.5 h-3.5" />
            Listening duration: {waitingElapsedSeconds}s
          </div>
        </div>
      )}

      {/* Hero: Latest Captured Punch Card */}
      {latestPunch && (
        <div className="bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] rounded-2xl p-6 sm:p-8 shadow-sm space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[hsl(var(--border))] pb-5">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
                <Timer className="w-6 h-6 text-emerald-500" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-emerald-500">
                    Latest Monitored Punch
                  </span>
                  {latestPunch.is_dry_run && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-500/10 text-purple-400 border border-purple-500/20">
                      Zero-DB Dry Run
                    </span>
                  )}
                </div>
                <h3 className="text-xl font-bold text-[hsl(var(--text-primary))] mt-0.5">
                  {latestPunch.door_name}
                </h3>
              </div>
            </div>

            {grade && (
              <div className={`px-4 py-2 rounded-xl border ${grade.bg} ${grade.border} flex items-center gap-2`}>
                <CheckCircle2 className={`w-4 h-4 ${grade.color}`} />
                <div>
                  <span className={`text-xs font-black uppercase tracking-wider ${grade.color}`}>
                    {grade.label}
                  </span>
                  <p className="text-[10px] text-[hsl(var(--text-muted))]">{grade.description}</p>
                </div>
              </div>
            )}
          </div>

          {/* Large Hero Metric & Timeline */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-center">
            {/* Massive Latency Display */}
            <div className="p-6 bg-[hsl(var(--bg-table-head))]/50 rounded-2xl border border-[hsl(var(--border))] text-center space-y-2 lg:col-span-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-[hsl(var(--text-muted))] block">
                Calculated Transit / Offset Latency
              </span>
              <div className="text-5xl sm:text-6xl font-black font-mono tracking-tight text-emerald-500">
                {latestPunch.latency_ms > 0 ? `+${latestPunch.latency_ms}` : latestPunch.latency_ms}
                <span className="text-2xl font-bold text-[hsl(var(--text-muted))] ml-1">ms</span>
              </div>
              <span className="text-xs text-[hsl(var(--text-muted))] font-mono block">
                ({latestPunch.latency_seconds > 0 ? `+${latestPunch.latency_seconds}` : latestPunch.latency_seconds} seconds)
              </span>
            </div>

            {/* Step-by-Step Subtraction Breakdown */}
            <div className="lg:col-span-2 space-y-3 bg-[hsl(var(--bg-table-head))]/30 p-5 rounded-2xl border border-[hsl(var(--border))]">
              <span className="text-xs font-bold uppercase tracking-wider text-[hsl(var(--text-secondary))] flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5 text-blue-400" />
                Timestamp Subtraction Equation
              </span>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1 text-xs">
                {/* Device Timestamp */}
                <div className="p-3 bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] rounded-xl space-y-1">
                  <span className="text-[10px] font-bold text-amber-500 uppercase tracking-wider block">
                    1. ACS Device Time
                  </span>
                  <div className="font-mono font-bold text-sm text-[hsl(var(--text-primary))] truncate">
                    {latestPunch.device_timestamp_raw}
                  </div>
                  <p className="text-[10px] text-[hsl(var(--text-muted))]">Hardware firmware internal clock</p>
                </div>

                {/* Subtraction Sign */}
                <div className="p-3 bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] rounded-xl space-y-1">
                  <span className="text-[10px] font-bold text-blue-500 uppercase tracking-wider block">
                    2. Backend Receipt Time
                  </span>
                  <div className="font-mono font-bold text-sm text-[hsl(var(--text-primary))] truncate">
                    {new Date(latestPunch.system_timestamp_iso).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                      fractionalSecondDigits: 3,
                    })}
                  </div>
                  <p className="text-[10px] text-[hsl(var(--text-muted))]">Server high-precision UTC</p>
                </div>

                {/* Result */}
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl space-y-1">
                  <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider block">
                    3. Exact Delta (Δt)
                  </span>
                  <div className="font-mono font-black text-sm text-emerald-500 truncate">
                    {latestPunch.latency_ms} ms
                  </div>
                  <p className="text-[10px] text-[hsl(var(--text-muted))]">Server - Device difference</p>
                </div>
              </div>
            </div>
          </div>

          {/* Detailed Metadata Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-2 text-xs">
            <div className="p-3.5 bg-[hsl(var(--bg-table-head))]/30 rounded-xl border border-[hsl(var(--border))] space-y-1">
              <span className="text-[10px] font-bold text-[hsl(var(--text-muted))] uppercase tracking-wider">
                Employee
              </span>
              <div className="font-bold text-[hsl(var(--text-primary))] truncate">
                {latestPunch.employee_id} ({latestPunch.employee_name})
              </div>
              <span className="text-[10px] text-[hsl(var(--text-muted))] font-mono">
                Card: {latestPunch.card_no}
              </span>
            </div>

            <div className="p-3.5 bg-[hsl(var(--bg-table-head))]/30 rounded-xl border border-[hsl(var(--border))] space-y-1">
              <span className="text-[10px] font-bold text-[hsl(var(--text-muted))] uppercase tracking-wider">
                Reader Terminal
              </span>
              <div className="font-bold text-[hsl(var(--text-primary))] truncate">
                {latestPunch.door_name}
              </div>
              <span className="text-[10px] text-[hsl(var(--text-muted))] font-mono">
                IP: {latestPunch.device_ip}
              </span>
            </div>

            <div className="p-3.5 bg-[hsl(var(--bg-table-head))]/30 rounded-xl border border-[hsl(var(--border))] space-y-1">
              <span className="text-[10px] font-bold text-[hsl(var(--text-muted))] uppercase tracking-wider">
                Auth Method
              </span>
              <div className="font-bold text-[hsl(var(--text-primary))] truncate">
                {latestPunch.auth_type}
              </div>
              <span className="text-[10px] text-emerald-500 font-semibold">
                Event [{latestPunch.major}:{latestPunch.minor}]
              </span>
            </div>

            <div className="p-3.5 bg-[hsl(var(--bg-table-head))]/30 rounded-xl border border-[hsl(var(--border))] space-y-1">
              <span className="text-[10px] font-bold text-[hsl(var(--text-muted))] uppercase tracking-wider">
                Direction & Source
              </span>
              <div className="font-bold text-[hsl(var(--text-primary))] flex items-center gap-1.5">
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                    latestPunch.direction === "EXIT"
                      ? "bg-rose-500/15 text-rose-500"
                      : "bg-emerald-500/15 text-emerald-500"
                  }`}
                >
                  {latestPunch.direction}
                </span>
                <span className="text-[10px] text-[hsl(var(--text-muted))]">{latestPunch.source}</span>
              </div>
              <span className="text-[10px] text-[hsl(var(--text-muted))] block">
                DB Safe: {latestPunch.is_dry_run ? "No write" : "Real punch"}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Aggregate Statistics Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="p-5 bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] rounded-2xl shadow-sm">
          <span className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--text-muted))] block">
            Average Latency
          </span>
          <div className="text-2xl font-black font-mono text-[hsl(var(--text-primary))] mt-1">
            {stats ? `${stats.avg_latency_ms} ms` : "—"}
          </div>
          <span className="text-[10px] text-[hsl(var(--text-muted))] mt-0.5 block">Across recorded punches</span>
        </div>

        <div className="p-5 bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] rounded-2xl shadow-sm">
          <span className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--text-muted))] block">
            Fastest Latency (Min)
          </span>
          <div className="text-2xl font-black font-mono text-emerald-500 mt-1">
            {stats && stats.min_latency_ms !== 0 ? `${stats.min_latency_ms} ms` : "—"}
          </div>
          <span className="text-[10px] text-[hsl(var(--text-muted))] mt-0.5 block">Best packet delivery</span>
        </div>

        <div className="p-5 bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] rounded-2xl shadow-sm">
          <span className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--text-muted))] block">
            Peak Latency (Max)
          </span>
          <div className="text-2xl font-black font-mono text-amber-500 mt-1">
            {stats && stats.max_latency_ms !== 0 ? `${stats.max_latency_ms} ms` : "—"}
          </div>
          <span className="text-[10px] text-[hsl(var(--text-muted))] mt-0.5 block">Highest recorded delta</span>
        </div>

        <div className="p-5 bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] rounded-2xl shadow-sm">
          <span className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--text-muted))] block">
            Monitored Punches
          </span>
          <div className="text-2xl font-black font-mono text-[hsl(var(--text-primary))] mt-1">
            {stats ? stats.total_punches : 0}
          </div>
          <span className="text-[10px] text-[hsl(var(--text-muted))] mt-0.5 block">Active live samples</span>
        </div>
      </div>

      {/* Recent Monitored Punches History Table */}
      <div className="bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] rounded-2xl p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-emerald-500" />
            <h3 className="font-bold text-[hsl(var(--text-primary))] text-base">
              Recent Latency Logs ({history.length})
            </h3>
          </div>
          <button
            onClick={fetchStatus}
            className="flex items-center gap-1.5 text-xs text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh</span>
          </button>
        </div>

        {history.length === 0 ? (
          <div className="p-10 border border-dashed border-[hsl(var(--border))] rounded-xl text-center">
            <Timer className="w-8 h-8 text-[hsl(var(--text-muted))] mx-auto mb-2 opacity-50" />
            <p className="text-xs font-semibold text-[hsl(var(--text-secondary))]">No latency punches logged yet</p>
            <p className="text-[11px] text-[hsl(var(--text-muted))] mt-1">
              Click <strong>&quot;Wait for Punch&quot;</strong> and perform a swipe at your Hikvision terminal, or click{" "}
              <strong>&quot;Test Ping (Zero DB)&quot;</strong> to test immediately.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-table-head))]/40 text-[hsl(var(--text-muted))] font-semibold">
                  <th className="py-2.5 px-3">Arrival Time</th>
                  <th className="py-2.5 px-3">Door / Reader</th>
                  <th className="py-2.5 px-3">Employee</th>
                  <th className="py-2.5 px-3">Device Time</th>
                  <th className="py-2.5 px-3">Backend Latency (Δt)</th>
                  <th className="py-2.5 px-3">Direction</th>
                  <th className="py-2.5 px-3">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[hsl(var(--border))] font-medium text-[hsl(var(--text-secondary))]">
                {history.map((p) => {
                  const g = getLatencyGrade(p.latency_ms);
                  return (
                    <tr
                      key={p.id}
                      className="hover:bg-[hsl(var(--bg-table-head))]/30 transition-colors"
                    >
                      <td className="py-2.5 px-3 font-mono text-[11px]">
                        {new Date(p.system_timestamp_iso).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                          fractionalSecondDigits: 3,
                        })}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="font-semibold text-[hsl(var(--text-primary))]">{p.door_name}</span>
                        <span className="text-[10px] text-[hsl(var(--text-muted))] block font-mono">
                          {p.device_ip}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="font-bold text-[hsl(var(--text-primary))]">{p.employee_id}</span>
                        <span className="text-[10px] text-[hsl(var(--text-muted))] block">
                          {p.employee_name}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[11px] text-[hsl(var(--text-muted))]">
                        {p.device_timestamp_raw}
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`inline-flex items-center gap-1 font-mono font-bold px-2 py-0.5 rounded text-xs border ${g.bg} ${g.border} ${g.color}`}
                        >
                          {p.latency_ms > 0 ? `+${p.latency_ms}` : p.latency_ms} ms
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            p.direction === "EXIT"
                              ? "bg-rose-500/10 text-rose-500 border border-rose-500/20"
                              : "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
                          }`}
                        >
                          {p.direction}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-[10px]">
                        {p.is_dry_run ? (
                          <span className="text-purple-400 font-semibold">Dry-Run</span>
                        ) : (
                          <span className="text-[hsl(var(--text-muted))] font-mono">{p.source}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Advisory & Technical Architecture Note */}
      <div className="p-5 bg-blue-500/5 border border-blue-500/15 rounded-2xl flex gap-3.5 text-xs text-[hsl(var(--text-secondary))]">
        <Info className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
        <div className="space-y-1 leading-relaxed">
          <strong className="text-[hsl(var(--text-primary))] block">
            Understanding Latency vs Clock Skew in Access Control Correlation
          </strong>
          <p className="text-[11px] text-[hsl(var(--text-muted))]">
            The calculated delta includes two factors: <strong>1. Network transit time</strong> (the milliseconds taken for the
            terminal to push the HTTP event to CALVISION), and <strong>2. Clock drift</strong> (the delta between the
            hardware reader&apos;s internal clock and this computer&apos;s system time).
          </p>
          <p className="text-[11px] text-[hsl(var(--text-muted))] pt-1">
            <strong>Database Safety Guaranteed:</strong> This latency monitor runs as a passive observer. It listens to incoming
            hardware events in memory without inserting synthetic mock records. Using the <em>&quot;Test Ping (Zero DB)&quot;</em> button
            simulates the pipeline completely in memory with zero database writes.
          </p>
        </div>
      </div>
    </div>
  );
}
