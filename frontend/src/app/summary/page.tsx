"use client";

import { useEffect, useState, useCallback } from "react";
import { formatTime } from "@/lib/dateUtils";
import { Clock, RefreshCw, BarChart2, Trash2, Layers, CheckCircle2, Award } from "lucide-react";
import EmployeeZoneManagerModal from "@/components/identity/EmployeeZoneManagerModal";

const API = "http://localhost:8001";

interface EmployeeDailySummary {
  employee_id: string;
  date: string;
  working_seconds: number;
  idle_seconds: number;
  walking_seconds: number;
  designated_zone_seconds?: number;
  outside_zone_seconds?: number;
  common_area_seconds?: number;
  break_seconds?: number;
  total_seconds: number;
  productivity_score?: number;
  check_in_count: number;
  first_seen: string | null;
  last_seen: string | null;
}

function formatDuration(totalSeconds: number) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export default function ActivitySummaryPage() {
  const [dailySummaries, setDailySummaries] = useState<EmployeeDailySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [mounted, setMounted] = useState(false);
  const [sortBy, setSortBy] = useState<string>("employee_id");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc" | "default">("default");
  const [selectedDate, setSelectedDate] = useState<string>(() => new Date().toISOString().split("T")[0]);

  // Zone Manager Modal state
  const [selectedEmpForZoneModal, setSelectedEmpForZoneModal] = useState<string | null>(null);

  const handleSort = (field: string) => {
    if (sortBy !== field) {
      setSortBy(field);
      setSortOrder("asc");
    } else {
      if (sortOrder === "asc") setSortOrder("desc");
      else if (sortOrder === "desc") {
        setSortBy("employee_id");
        setSortOrder("default");
      } else setSortOrder("asc");
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
        return order === "asc" ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      return order === "asc" ? (valA as number) - (valB as number) : (valB as number) - (valA as number);
    });
    return sorted;
  };

  const renderSortIndicator = (field: string) => {
    if (sortBy === field && sortOrder !== "default") return sortOrder === "asc" ? " ↑" : " ↓";
    if (field === "employee_id" && sortOrder === "default") return " ↑";
    return "";
  };

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleDelete = async (employeeId: string) => {
    if (!confirm(`Are you sure you want to delete the daily summary for ${employeeId} on ${selectedDate}?`)) return;
    try {
      const res = await fetch(`${API}/api/identity/employees/daily?employee_id=${employeeId}&date=${selectedDate}`, {
        method: "DELETE",
      });
      if (res.ok) setDailySummaries((prev) => prev.filter((sum) => sum.employee_id !== employeeId));
      else alert("Failed to delete the summary record.");
    } catch (err) {
      console.error(err);
      alert("Error deleting summary record.");
    }
  };

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/identity/productivity?date=${selectedDate}`);
      if (res.ok) setDailySummaries(await res.json());
      setLastRefresh(new Date());
    } catch {
      /* backend error */
    } finally {
      setLoading(false);
    }
  }, [selectedDate]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  const thColBase =
    "py-4 pr-4 font-semibold cursor-pointer select-none transition-colors text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]";

  return (
    <div className="p-6 sm:p-8 space-y-8 max-w-7xl mx-auto">
      {/* Zone Manager Modal */}
      <EmployeeZoneManagerModal
        isOpen={!!selectedEmpForZoneModal}
        employeeId={selectedEmpForZoneModal || ""}
        onClose={() => setSelectedEmpForZoneModal(null)}
        onSaved={refresh}
      />

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-[hsl(var(--text-primary))] flex items-center gap-3">
            <BarChart2 className="w-7 h-7 text-emerald-500" />
            Designated Work Zone Productivity Analytics
          </h2>
          <p className="text-sm text-[hsl(var(--text-muted))] mt-1">
            Calculates individual employee productivity based on time spent inside assigned work zones.
          </p>
        </div>

        <div className="flex items-center gap-4">
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="bg-[hsl(var(--bg-input))] border border-[hsl(var(--border-strong))] rounded-lg px-3 py-2 text-[hsl(var(--text-primary))] text-sm focus:outline-none focus:border-emerald-500 transition-colors"
          />
          <button
            onClick={refresh}
            className="flex items-center gap-2 text-sm text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] bg-[hsl(var(--bg-table-head))] px-3 py-2 rounded-lg border border-[hsl(var(--border))] hover:border-[hsl(var(--border-strong))] transition-all"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            <span className="text-xs text-[hsl(var(--text-muted))]">
              {mounted ? formatTime(lastRefresh) : "--:--:--"}
            </span>
          </button>
        </div>
      </div>

      <div className="bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] rounded-2xl p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-[hsl(var(--text-primary))] mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-emerald-500" />
            <span>
              {selectedDate === new Date().toISOString().split("T")[0]
                ? "Today's Productivity Breakdown"
                : `Productivity for ${selectedDate}`}
            </span>
          </div>
          <span className="text-xs text-[hsl(var(--text-muted))] font-normal">
            Click &quot;Work Zones&quot; on any row to assign expected workstation zones
          </span>
        </h3>

        {loading && dailySummaries.length === 0 ? (
          <div className="py-8 text-center text-sm text-[hsl(var(--text-muted))]">Loading data...</div>
        ) : dailySummaries.length === 0 ? (
          <div className="py-12 text-center border border-dashed border-[hsl(var(--border-strong))] rounded-2xl bg-[hsl(var(--bg-table-head))]/40">
            <p className="text-[hsl(var(--text-secondary))] text-sm">No recorded daily summaries for {selectedDate}.</p>
            <p className="text-[hsl(var(--text-muted))] text-xs mt-2">
              Productivity metrics accumulate automatically as worker sessions complete.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[hsl(var(--border))]">
            <table className="w-full text-sm text-left border-collapse">
              <thead className="bg-[hsl(var(--bg-table-head))] border-b border-[hsl(var(--border))]">
                <tr className="text-xs uppercase tracking-wider">
                  <th onClick={() => handleSort("employee_id")} className={`${thColBase} pl-6`}>
                    Employee ID{renderSortIndicator("employee_id")}
                  </th>
                  <th onClick={() => handleSort("productivity_score")} className={`${thColBase} text-emerald-600 dark:text-emerald-400`}>
                    Zone Score %{renderSortIndicator("productivity_score")}
                  </th>
                  <th onClick={() => handleSort("designated_zone_seconds")} className={`${thColBase} text-emerald-500`}>
                    Productive Time (Work Zone){renderSortIndicator("designated_zone_seconds")}
                  </th>
                  <th onClick={() => handleSort("outside_zone_seconds")} className={`${thColBase} text-amber-500`}>
                    Outside Work Zone{renderSortIndicator("outside_zone_seconds")}
                  </th>
                  <th onClick={() => handleSort("working_seconds")} className={thColBase}>
                    Active Time{renderSortIndicator("working_seconds")}
                  </th>
                  <th onClick={() => handleSort("idle_seconds")} className={thColBase}>
                    Idle Time{renderSortIndicator("idle_seconds")}
                  </th>
                  <th onClick={() => handleSort("total_seconds")} className={thColBase}>
                    Total Tracked{renderSortIndicator("total_seconds")}
                  </th>
                  <th className="py-4 pr-6 font-semibold text-right text-[hsl(var(--text-muted))]">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[hsl(var(--border))]">
                {getSortedSummaries().map((sum) => {
                  const score = sum.productivity_score ?? 100;
                  return (
                    <tr key={sum.employee_id} className="hover:bg-[hsl(var(--bg-table-head))]/60 transition-colors bg-[hsl(var(--bg-card))]">
                      <td className="py-4 pl-6 pr-4">
                        <div className="font-bold text-emerald-600 dark:text-emerald-400">
                          {sum.employee_id}
                        </div>
                      </td>
                      <td className="py-4 pr-4">
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2.5 py-1 rounded-full text-xs font-extrabold border ${
                              score >= 70
                                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                                : score >= 40
                                ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                                : "bg-red-500/10 text-red-500 border-red-500/20"
                            }`}
                          >
                            {score}%
                          </span>
                        </div>
                      </td>
                      <td className="py-4 pr-4">
                        <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-semibold border border-emerald-500/20 text-xs">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          {formatDuration(sum.designated_zone_seconds || sum.working_seconds)}
                        </div>
                      </td>
                      <td className="py-4 pr-4">
                        <div className="inline-flex items-center px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-400 font-medium border border-amber-500/20 text-xs">
                          {formatDuration(sum.outside_zone_seconds || 0)}
                        </div>
                      </td>
                      <td className="py-4 pr-4 text-xs font-medium text-[hsl(var(--text-secondary))]">
                        {formatDuration(sum.working_seconds)}
                      </td>
                      <td className="py-4 pr-4 text-xs font-medium text-amber-500">
                        {formatDuration(sum.idle_seconds)}
                      </td>
                      <td className="py-4 pr-4 text-xs font-mono text-[hsl(var(--text-secondary))]">
                        {formatDuration(sum.total_seconds)}
                      </td>
                      <td className="py-4 pr-6 text-right space-x-2">
                        <button
                          onClick={() => setSelectedEmpForZoneModal(sum.employee_id)}
                          className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 transition-all"
                          title="Assign Designated Work Zones"
                        >
                          <Layers className="w-3.5 h-3.5" />
                          <span>Work Zones</span>
                        </button>

                        <button
                          onClick={() => handleDelete(sum.employee_id)}
                          className="text-[hsl(var(--text-muted))] hover:text-red-500 dark:hover:text-red-400 p-1.5 rounded-lg hover:bg-red-500/10 border border-transparent hover:border-red-500/20 transition-all"
                          title="Delete Record"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
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
  );
}
