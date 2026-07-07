"use client";
import { useEffect, useState, useCallback } from "react";
import { Clock, RefreshCw, BarChart2 } from "lucide-react";

const API = "http://localhost:8000";

// ── Types ─────────────────────────────────────────────────────────────────

interface EmployeeDailySummary {
  employee_id: string;
  date: string;
  working_seconds: number;
  idle_seconds: number;
  walking_seconds: number;
  using_mobile_seconds: number;
  total_seconds: number;
  check_in_count: number;
  first_seen: string | null;
  last_seen: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function formatDuration(totalSeconds: number) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function ActivitySummaryPage() {
  const [dailySummaries, setDailySummaries] = useState<EmployeeDailySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  
  // Default to today in YYYY-MM-DD
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    return new Date().toISOString().split('T')[0];
  });

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/identity/employees/daily?date=${selectedDate}`);
      if (res.ok) setDailySummaries(await res.json());
      setLastRefresh(new Date());
    } catch { /* backend may not be running */ }
    finally { setLoading(false); }
  }, [selectedDate]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000); // refresh every 5s
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <div className="p-8 space-y-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-3">
            <BarChart2 className="w-7 h-7 text-emerald-400" />
            Activity Summary
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Aggregated daily breakdown of time spent on camera per employee.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500 transition-colors"
          />
          <button
            onClick={refresh}
            className="flex items-center gap-2 text-sm text-gray-400 hover:text-white bg-gray-800 px-3 py-2 rounded-lg border border-gray-700 hover:border-gray-600 transition-all"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            <span className="text-xs text-gray-600">
              {lastRefresh.toLocaleTimeString()}
            </span>
          </button>
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-white mb-6 flex items-center gap-2">
          <Clock className="w-5 h-5 text-emerald-400" />
          {selectedDate === new Date().toISOString().split('T')[0] ? "Today's Activity" : `Activity for ${selectedDate}`}
        </h3>
        
        {loading && dailySummaries.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-500">Loading data...</div>
        ) : dailySummaries.length === 0 ? (
          <div className="py-12 text-center border border-dashed border-gray-800 rounded-lg bg-gray-800/20">
            <p className="text-gray-400 text-sm">No closed sessions for {selectedDate}.</p>
            <p className="text-gray-500 text-xs mt-2">Activity time is calculated and updated when a worker's camera session ends.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-800">
            <table className="w-full text-sm text-left">
              <thead className="bg-gray-800/80">
                <tr className="text-xs text-gray-400 uppercase tracking-wider">
                  <th className="py-4 pl-6 pr-4 font-semibold">Employee ID</th>
                  <th className="py-4 pr-4 font-semibold">Total Time</th>
                  <th className="py-4 pr-4 font-semibold text-emerald-400">Working</th>
                  <th className="py-4 pr-4 font-semibold text-amber-400">Idle</th>
                  <th className="py-4 pr-4 font-semibold text-blue-400">Walking</th>
                  <th className="py-4 pr-4 font-semibold text-pink-400">Mobile</th>
                  <th className="py-4 pr-6 font-semibold">Check-ins</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {dailySummaries.map(sum => (
                  <tr key={sum.employee_id} className="hover:bg-gray-800/40 transition-colors bg-gray-900">
                    <td className="py-4 pl-6 pr-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                          <span className="text-emerald-400 font-bold text-xs">
                            {sum.employee_id.replace("EMP", "")}
                          </span>
                        </div>
                        <span className="font-bold text-white">{sum.employee_id}</span>
                      </div>
                    </td>
                    <td className="py-4 pr-4 text-gray-300 font-medium">
                      {formatDuration(sum.total_seconds)}
                    </td>
                    <td className="py-4 pr-4">
                      <div className="inline-flex items-center px-2 py-1 rounded-md bg-emerald-500/10 text-emerald-400 font-medium border border-emerald-500/20">
                        {formatDuration(sum.working_seconds)}
                      </div>
                    </td>
                    <td className="py-4 pr-4">
                      <div className="inline-flex items-center px-2 py-1 rounded-md bg-amber-500/10 text-amber-400 font-medium border border-amber-500/20">
                        {formatDuration(sum.idle_seconds)}
                      </div>
                    </td>
                    <td className="py-4 pr-4">
                      <div className="inline-flex items-center px-2 py-1 rounded-md bg-blue-500/10 text-blue-400 font-medium border border-blue-500/20">
                        {formatDuration(sum.walking_seconds)}
                      </div>
                    </td>
                    <td className="py-4 pr-4">
                      <div className="inline-flex items-center px-2 py-1 rounded-md bg-pink-500/10 text-pink-400 font-medium border border-pink-500/20">
                        {formatDuration(sum.using_mobile_seconds)}
                      </div>
                    </td>
                    <td className="py-4 pr-6 text-gray-500 font-medium text-center">
                      <span className="bg-gray-800 px-2 py-1 rounded-md">{sum.check_in_count}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
