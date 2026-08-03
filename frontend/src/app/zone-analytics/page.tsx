"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Clock,
  Layers,
  Users,
  Filter,
  RefreshCw,
  Download,
  Calendar,
  Camera,
  Activity,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  Search,
  UserCheck,
} from "lucide-react";
import { useCameras } from "@/hooks/useCameras";

interface SummaryMetrics {
  total_visits: number;
  active_occupants?: number;
  total_occupancy_seconds: number;
  formatted_total_occupancy: string;
  average_dwell_seconds: number;
  formatted_average_dwell: string;
}

interface PerZoneMetric {
  zone_id: string;
  zone_name: string;
  zone_color: string;
  visit_count: number;
  total_occupancy_seconds: number;
  formatted_total_occupancy: string;
  average_dwell_seconds: number;
  formatted_average_dwell: string;
}

interface PerPersonMetric {
  person_identifier: string;
  visit_count: number;
  total_occupancy_seconds: number;
  formatted_total_occupancy: string;
  average_dwell_seconds: number;
  formatted_average_dwell: string;
}

interface VisitRecord {
  id: number;
  camera_id: string;
  zone_id: string;
  zone_name: string;
  zone_color: string;
  tracking_id: string;
  person_identifier: string | null;
  entry_time: string;
  exit_time: string | null;
  duration_seconds: number;
  formatted_duration: string;
  is_active: boolean;
}

export default function ZoneAnalyticsPage() {
  const { cameras } = useCameras();
  const [selectedCamera, setSelectedCamera] = useState<string>("all");
  const [selectedZone, setSelectedZone] = useState<string>("all");
  const [personSearch, setPersonSearch] = useState<string>("");
  const [timeRange, setTimeRange] = useState<string>("today");

  const [summary, setSummary] = useState<SummaryMetrics | null>(null);
  const [perZone, setPerZone] = useState<PerZoneMetric[]>([]);
  const [perPerson, setPerPerson] = useState<PerPersonMetric[]>([]);
  const [visits, setVisits] = useState<VisitRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState<number>(0);
  const limit = 20;

  const fetchAnalytics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const host =
        typeof window !== "undefined" ? window.location.hostname : "localhost";

      const queryParams = new URLSearchParams();
      if (selectedCamera !== "all") queryParams.append("camera_id", selectedCamera);
      if (selectedZone !== "all") queryParams.append("zone_id", selectedZone);
      if (personSearch.trim()) queryParams.append("person_identifier", personSearch.trim());

      // Date range filtering
      const now = new Date();
      if (timeRange === "today") {
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        queryParams.append("start_date", startOfDay.toISOString());
      } else if (timeRange === "7d") {
        const d7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        queryParams.append("start_date", d7.toISOString());
      } else if (timeRange === "30d") {
        const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        queryParams.append("start_date", d30.toISOString());
      }

      // Fetch summary
      const sumRes = await fetch(`http://${host}:8000/api/zone-analytics/summary?${queryParams.toString()}`);
      if (sumRes.ok) {
        const sumData = await sumRes.json();
        setSummary(sumData.summary);
        setPerZone(sumData.per_zone || []);
        setPerPerson(sumData.per_person || []);
      } else {
        setError("Failed to load analytics summary");
      }

      // Fetch visits log
      queryParams.append("limit", String(limit));
      queryParams.append("offset", String(page * limit));
      const visitsRes = await fetch(`http://${host}:8000/api/zone-analytics/visits?${queryParams.toString()}`);
      if (visitsRes.ok) {
        const visitsData = await visitsRes.json();
        setVisits(visitsData.visits || []);
      }
    } catch (err: any) {
      setError("Network error loading analytics");
    } finally {
      setLoading(false);
    }
  }, [selectedCamera, selectedZone, personSearch, timeRange, page]);

  useEffect(() => {
    fetchAnalytics();
    const timer = setInterval(() => {
      fetchAnalytics();
    }, 3000);
    return () => clearInterval(timer);
  }, [fetchAnalytics]);

  // Export CSV
  const handleExportCSV = () => {
    if (!visits || visits.length === 0) return;
    const headers = ["ID", "Camera", "Zone", "Person/Track ID", "Entry Time", "Exit Time", "Duration (s)", "Status"];
    const rows = visits.map((v) => [
      v.id,
      v.camera_id,
      v.zone_name,
      v.person_identifier || `Track-${v.tracking_id}`,
      v.entry_time,
      v.exit_time || "Active",
      v.duration_seconds,
      v.is_active ? "ACTIVE" : "COMPLETED",
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `zone_dwell_report_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const activeOccupantsCount = useMemo(() => {
    if (summary?.active_occupants !== undefined) {
      return summary.active_occupants;
    }
    return visits.filter((v) => v.is_active).length;
  }, [summary, visits]);

  return (
    <div className="p-6 sm:p-8 space-y-6 max-w-7xl mx-auto text-[hsl(var(--text-primary))]">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2.5">
            <Clock className="w-6 h-6 text-violet-500" />
            Zone Analytics &amp; Dwell Time
          </h2>
          <p className="text-sm text-[hsl(var(--text-muted))] mt-1">
            Real-time and historical dwell duration analytics per camera zone
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExportCSV}
            disabled={visits.length === 0}
            className="flex items-center gap-2 bg-[hsl(var(--bg-card))] hover:bg-[hsl(var(--bg-table-head))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] px-4 py-2.5 rounded-xl font-medium text-sm transition-colors shadow-sm disabled:opacity-50"
          >
            <Download className="w-4 h-4 text-violet-500" /> Export CSV Report
          </button>
          <button
            onClick={fetchAnalytics}
            disabled={loading}
            className="p-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white transition-colors shadow-sm"
            title="Refresh Data"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="p-4 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 shadow-sm">
        {/* Camera Filter */}
        <div>
          <label className="text-[11px] font-bold text-[hsl(var(--text-muted))] uppercase tracking-wider block mb-1.5 flex items-center gap-1">
            <Camera className="w-3.5 h-3.5 text-blue-500" /> Camera
          </label>
          <select
            value={selectedCamera}
            onChange={(e) => {
              setSelectedCamera(e.target.value);
              setPage(0);
            }}
            className="w-full bg-[hsl(var(--bg-page))] border border-[hsl(var(--border))] rounded-xl px-3 py-2 text-xs font-medium text-[hsl(var(--text-primary))] focus:outline-none focus:ring-2 focus:ring-violet-500/50"
          >
            <option value="all">All Cameras</option>
            {cameras.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} (ID: {c.id})
              </option>
            ))}
          </select>
        </div>

        {/* Time Range */}
        <div>
          <label className="text-[11px] font-bold text-[hsl(var(--text-muted))] uppercase tracking-wider block mb-1.5 flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5 text-emerald-500" /> Time Period
          </label>
          <select
            value={timeRange}
            onChange={(e) => {
              setTimeRange(e.target.value);
              setPage(0);
            }}
            className="w-full bg-[hsl(var(--bg-page))] border border-[hsl(var(--border))] rounded-xl px-3 py-2 text-xs font-medium text-[hsl(var(--text-primary))] focus:outline-none focus:ring-2 focus:ring-violet-500/50"
          >
            <option value="today">Today</option>
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
            <option value="all">All Time</option>
          </select>
        </div>

        {/* Zone Selector */}
        <div>
          <label className="text-[11px] font-bold text-[hsl(var(--text-muted))] uppercase tracking-wider block mb-1.5 flex items-center gap-1">
            <Layers className="w-3.5 h-3.5 text-violet-500" /> Zone
          </label>
          <select
            value={selectedZone}
            onChange={(e) => {
              setSelectedZone(e.target.value);
              setPage(0);
            }}
            className="w-full bg-[hsl(var(--bg-page))] border border-[hsl(var(--border))] rounded-xl px-3 py-2 text-xs font-medium text-[hsl(var(--text-primary))] focus:outline-none focus:ring-2 focus:ring-violet-500/50"
          >
            <option value="all">All Zones</option>
            {perZone.map((z) => (
              <option key={z.zone_id} value={z.zone_id}>
                {z.zone_name} ({z.zone_id})
              </option>
            ))}
          </select>
        </div>

        {/* Person Search */}
        <div>
          <label className="text-[11px] font-bold text-[hsl(var(--text-muted))] uppercase tracking-wider block mb-1.5 flex items-center gap-1">
            <Users className="w-3.5 h-3.5 text-amber-500" /> Person / Employee ID
          </label>
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--text-muted))]" />
            <input
              type="text"
              value={personSearch}
              onChange={(e) => {
                setPersonSearch(e.target.value);
                setPage(0);
              }}
              placeholder="Search ID..."
              className="w-full bg-[hsl(var(--bg-page))] border border-[hsl(var(--border))] rounded-xl pl-9 pr-3 py-2 text-xs font-medium text-[hsl(var(--text-primary))] focus:outline-none focus:ring-2 focus:ring-violet-500/50"
            />
          </div>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Visits */}
        <div className="p-5 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-[hsl(var(--text-muted))]">Total Zone Visits</p>
            <h3 className="text-2xl font-bold mt-1">{summary?.total_visits || 0}</h3>
            <p className="text-[11px] text-emerald-500 font-medium mt-1 flex items-center gap-1">
              <TrendingUp className="w-3.5 h-3.5" /> Logged visits
            </p>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-500 flex items-center justify-center">
            <Users className="w-6 h-6" />
          </div>
        </div>

        {/* Total Occupancy */}
        <div className="p-5 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-[hsl(var(--text-muted))]">Total Occupancy Time</p>
            <h3 className="text-2xl font-bold mt-1">
              {summary?.formatted_total_occupancy || "00:00"}
            </h3>
            <p className="text-[11px] text-[hsl(var(--text-muted))] mt-1">Cumulative dwell duration</p>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 flex items-center justify-center">
            <Clock className="w-6 h-6" />
          </div>
        </div>

        {/* Avg Dwell Time */}
        <div className="p-5 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-[hsl(var(--text-muted))]">Average Dwell Time</p>
            <h3 className="text-2xl font-bold mt-1">
              {summary?.formatted_average_dwell || "00:00"}
            </h3>
            <p className="text-[11px] text-[hsl(var(--text-muted))] mt-1">Per visit duration</p>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-violet-500/10 border border-violet-500/20 text-violet-500 flex items-center justify-center">
            <Activity className="w-6 h-6" />
          </div>
        </div>

        {/* Currently Active Occupants */}
        <div className="p-5 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-[hsl(var(--text-muted))]">Active Occupants</p>
            <h3 className="text-2xl font-bold mt-1">{activeOccupantsCount}</h3>
            <p className="text-[11px] text-emerald-500 font-medium mt-1 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> Inside zones right now
            </p>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-500 flex items-center justify-center">
            <UserCheck className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Per-Zone Breakdown & Per-Person Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Zone Breakdown */}
        <div className="p-6 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] shadow-sm flex flex-col h-[420px]">
          <div className="flex items-center justify-between shrink-0 mb-4">
            <h3 className="text-base font-bold flex items-center gap-2">
              <Layers className="w-5 h-5 text-violet-500" />
              Zone Dwell Breakdown
            </h3>
            <span className="text-xs text-[hsl(var(--text-muted))]">{perZone.length} zones</span>
          </div>

          {perZone.length === 0 ? (
            <p className="text-xs text-[hsl(var(--text-muted))] py-6 text-center">
              No zone dwell data available for selected filters.
            </p>
          ) : (
            <div className="space-y-3 overflow-y-auto flex-1 pr-1.5 custom-scrollbar">
              {perZone.map((z) => (
                <div
                  key={z.zone_id}
                  className="p-3.5 rounded-xl bg-[hsl(var(--bg-page))] border border-[hsl(var(--border))] space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <span
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ backgroundColor: z.zone_color || "#3B82F6" }}
                      />
                      <span className="text-xs font-bold text-[hsl(var(--text-primary))]">
                        {z.zone_name}
                      </span>
                    </div>
                    <div className="text-xs font-semibold text-[hsl(var(--text-secondary))]">
                      {z.visit_count} visit(s) · Avg: {z.formatted_average_dwell}
                    </div>
                  </div>

                  {/* Progress Occupancy Bar */}
                  <div className="w-full bg-[hsl(var(--bg-table-head))] h-2 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${Math.min(
                          100,
                          summary?.total_occupancy_seconds
                            ? (z.total_occupancy_seconds / summary.total_occupancy_seconds) * 100
                            : 0
                        )}%`,
                        backgroundColor: z.zone_color || "#3B82F6",
                      }}
                    />
                  </div>
                  <div className="flex justify-end text-[10px] text-[hsl(var(--text-muted))]">
                    Total Occupancy: {z.formatted_total_occupancy}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Person Breakdown */}
        <div className="p-6 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] shadow-sm flex flex-col h-[420px]">
          <div className="flex items-center justify-between shrink-0 mb-4">
            <h3 className="text-base font-bold flex items-center gap-2">
              <Users className="w-5 h-5 text-emerald-500" />
              Person Dwell Metrics
            </h3>
            <span className="text-xs text-[hsl(var(--text-muted))]">{perPerson.length} person(s)</span>
          </div>

          {perPerson.length === 0 ? (
            <p className="text-xs text-[hsl(var(--text-muted))] py-6 text-center">
              No person identity dwell data recorded yet.
            </p>
          ) : (
            <div className="overflow-y-auto flex-1 pr-1.5 custom-scrollbar">
              <table className="w-full text-xs border-separate border-spacing-0">
                <thead className="sticky top-0 bg-[hsl(var(--bg-card))] z-10">
                  <tr className="border-b border-[hsl(var(--border))] text-[hsl(var(--text-muted))] text-left">
                    <th className="pb-3 pt-1 font-bold uppercase bg-[hsl(var(--bg-card))] border-b border-[hsl(var(--border))]">Person / Employee</th>
                    <th className="pb-3 pt-1 font-bold uppercase text-center bg-[hsl(var(--bg-card))] border-b border-[hsl(var(--border))]">Visits</th>
                    <th className="pb-3 pt-1 font-bold uppercase text-right bg-[hsl(var(--bg-card))] border-b border-[hsl(var(--border))]">Avg Dwell</th>
                    <th className="pb-3 pt-1 font-bold uppercase text-right bg-[hsl(var(--bg-card))] border-b border-[hsl(var(--border))]">Total Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[hsl(var(--border))]/50">
                  {perPerson.map((p) => (
                    <tr key={p.person_identifier}>
                      <td className="py-2.5 font-bold text-[hsl(var(--text-primary))] flex items-center gap-2">
                        <UserCheck className="w-4 h-4 text-emerald-500 shrink-0" />
                        <span>{p.person_identifier}</span>
                      </td>
                      <td className="py-2.5 text-center font-medium">{p.visit_count}</td>
                      <td className="py-2.5 text-right font-mono">{p.formatted_average_dwell}</td>
                      <td className="py-2.5 text-right font-mono font-bold text-emerald-500">
                        {p.formatted_total_occupancy}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Historical Visit Log Table */}
      <div className="p-6 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold flex items-center gap-2">
            <Clock className="w-5 h-5 text-violet-500" />
            Detailed Zone Visit History Log
          </h3>
          <span className="text-xs text-[hsl(var(--text-muted))] font-medium">
            Page {page + 1}
          </span>
        </div>

        {visits.length === 0 ? (
          <div className="py-12 text-center text-xs text-[hsl(var(--text-muted))]">
            No visit logs found matching current filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-[hsl(var(--bg-table-head))] border-b border-[hsl(var(--border))] text-[hsl(var(--text-muted))] uppercase">
                  <th className="px-4 py-3 text-left">Zone</th>
                  <th className="px-4 py-3 text-left">Camera</th>
                  <th className="px-4 py-3 text-left">Track / Employee</th>
                  <th className="px-4 py-3 text-left">Entry Time</th>
                  <th className="px-4 py-3 text-left">Exit Time</th>
                  <th className="px-4 py-3 text-right">Dwell Duration</th>
                  <th className="px-4 py-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[hsl(var(--border))]/60">
                {visits.map((v) => (
                  <tr key={v.id} className="hover:bg-[hsl(var(--bg-table-head))]/40 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 font-bold">
                        <span
                          className="w-3 h-3 rounded-full shrink-0"
                          style={{ backgroundColor: v.zone_color || "#3B82F6" }}
                        />
                        {v.zone_name}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-[hsl(var(--text-secondary))]">
                      Camera #{v.camera_id}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-semibold text-[hsl(var(--text-primary))]">
                        {v.person_identifier || `Track-${v.tracking_id}`}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[hsl(var(--text-secondary))]">
                      {new Date(v.entry_time).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-[hsl(var(--text-secondary))]">
                      {v.exit_time ? new Date(v.exit_time).toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-violet-500">
                      {v.formatted_duration}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          v.is_active
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                            : "bg-gray-500/10 text-gray-500 dark:text-gray-400 border border-gray-500/20"
                        }`}
                      >
                        {v.is_active ? "ACTIVE" : "COMPLETED"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination controls */}
        <div className="flex items-center justify-between pt-2">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-3 py-1.5 rounded-lg border border-[hsl(var(--border))] text-xs font-semibold disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-xs text-[hsl(var(--text-muted))]">Page {page + 1}</span>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={visits.length < limit}
            className="px-3 py-1.5 rounded-lg border border-[hsl(var(--border))] text-xs font-semibold disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
