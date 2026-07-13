"use client";
import { useEffect, useState, useCallback } from "react";
import { Clock, RefreshCw, BarChart2, Trash2 } from "lucide-react";

const API = "http://localhost:8000";

// ── Types ─────────────────────────────────────────────────────────────────

interface EmployeeDailySummary {
  employee_id: string;
  date: string;
  working_seconds: number;
  idle_seconds: number;
  walking_seconds: number;
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
  const [mounted, setMounted] = useState(false);
  const [sortBy, setSortBy] = useState<string>("employee_id");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc" | "default">("default");
  
  const handleSort = (field: string) => {
    if (sortBy !== field) {
      setSortBy(field);
      setSortOrder("asc");
    } else {
      if (sortOrder === "asc") {
        setSortOrder("desc");
      } else if (sortOrder === "desc") {
        setSortBy("employee_id");
        setSortOrder("default");
      } else {
        setSortOrder("asc");
      }
    }
  };

  const getSortedSummaries = () => {
    const sorted = [...dailySummaries];
    const field = sortOrder === "default" ? "employee_id" : sortBy;
    const order = sortOrder === "default" ? "asc" : sortOrder;

    sorted.sort((a, b) => {
      let valA = a[field as keyof EmployeeDailySummary];
      let valB = b[field as keyof EmployeeDailySummary];

      if (valA === null || valA === undefined) return order === "asc" ? 1 : -1;
      if (valB === null || valB === undefined) return order === "asc" ? -1 : 1;

      if (typeof valA === "string" && typeof valB === "string") {
        return order === "asc" 
          ? valA.localeCompare(valB) 
          : valB.localeCompare(valA);
      } else {
        const numA = valA as number;
        const numB = valB as number;
        return order === "asc" ? numA - numB : numB - numA;
      }
    });
    return sorted;
  };

  const renderSortIndicator = (field: string) => {
    if (sortBy === field && sortOrder !== "default") {
      return sortOrder === "asc" ? " ↑" : " ↓";
    }
    if (field === "employee_id" && sortOrder === "default") {
      return " ↑";
    }
    return "";
  };
  
  useEffect(() => {
    setMounted(true);
  }, []);

  // Default to today in YYYY-MM-DD
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    return new Date().toISOString().split('T')[0];
  });

  const handleDelete = async (employeeId: string) => {
    if (!confirm(`Are you sure you want to delete the daily summary for ${employeeId} on ${selectedDate}?`)) {
      return;
    }
    try {
      const res = await fetch(`${API}/api/identity/employees/daily?employee_id=${employeeId}&date=${selectedDate}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setDailySummaries(prev => prev.filter(sum => sum.employee_id !== employeeId));
      } else {
        alert("Failed to delete the summary record.");
      }
    } catch (err) {
      console.error(err);
      alert("Error deleting summary record.");
    }
  };

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
              {mounted ? lastRefresh.toLocaleTimeString() : "--:--:--"}
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
                  <th 
                    onClick={() => handleSort("employee_id")}
                    className="py-4 pl-6 pr-4 font-semibold cursor-pointer select-none hover:text-white transition-colors"
                  >
                    Employee ID{renderSortIndicator("employee_id")}
                  </th>
                  <th 
                    onClick={() => handleSort("total_seconds")}
                    className="py-4 pr-4 font-semibold cursor-pointer select-none hover:text-white transition-colors"
                  >
                    Total Time{renderSortIndicator("total_seconds")}
                  </th>
                  <th 
                    onClick={() => handleSort("working_seconds")}
                    className="py-4 pr-4 font-semibold text-emerald-400 cursor-pointer select-none hover:text-emerald-300 transition-colors"
                  >
                    Working{renderSortIndicator("working_seconds")}
                  </th>
                  <th 
                    onClick={() => handleSort("idle_seconds")}
                    className="py-4 pr-4 font-semibold text-amber-400 cursor-pointer select-none hover:text-amber-300 transition-colors"
                  >
                    Idle{renderSortIndicator("idle_seconds")}
                  </th>
                  <th 
                    onClick={() => handleSort("walking_seconds")}
                    className="py-4 pr-4 font-semibold text-blue-400 cursor-pointer select-none hover:text-blue-300 transition-colors"
                  >
                    Walking{renderSortIndicator("walking_seconds")}
                  </th>
                  <th 
                    onClick={() => handleSort("check_in_count")}
                    className="py-4 pr-4 font-semibold cursor-pointer select-none hover:text-white transition-colors"
                  >
                    Check-ins{renderSortIndicator("check_in_count")}
                  </th>
                  <th className="py-4 pr-6 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {getSortedSummaries().map(sum => (
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
                    <td className="py-4 pr-4 text-gray-500 font-medium">
                      <span className="bg-gray-800 px-2 py-1 rounded-md">{sum.check_in_count}</span>
                    </td>
                    <td className="py-4 pr-6 text-right">
                      <button
                        onClick={() => handleDelete(sum.employee_id)}
                        className="text-gray-500 hover:text-red-400 p-1.5 rounded-lg hover:bg-red-500/10 border border-transparent hover:border-red-500/20 transition-all"
                        title="Delete Record"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
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
