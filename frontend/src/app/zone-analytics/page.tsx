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
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
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

  // Log-specific filters & pagination
  const [visitStatusFilter, setVisitStatusFilter] = useState<string>("all");
  const [logSearch, setLogSearch] = useState<string>("");
  const [pageSize, setPageSize] = useState<number>(20);
  const [totalVisitsCount, setTotalVisitsCount] = useState<number>(0);
  const [page, setPage] = useState<number>(0);

  const [summary, setSummary] = useState<SummaryMetrics | null>(null);
  const [perZone, setPerZone] = useState<PerZoneMetric[]>([]);
  const [perPerson, setPerPerson] = useState<PerPersonMetric[]>([]);
  const [visits, setVisits] = useState<VisitRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

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

      // Fetch visits log with pagination and log filters
      const visitParams = new URLSearchParams(queryParams);
      if (visitStatusFilter !== "all") {
        visitParams.append("status", visitStatusFilter);
      }
      if (logSearch.trim()) {
        visitParams.append("person_identifier", logSearch.trim());
      }
      visitParams.append("limit", String(pageSize));
      visitParams.append("offset", String(page * pageSize));

      const visitsRes = await fetch(`http://${host}:8000/api/zone-analytics/visits?${visitParams.toString()}`);
      if (visitsRes.ok) {
        const visitsData = await visitsRes.json();
        setVisits(visitsData.visits || []);
        setTotalVisitsCount(visitsData.total || 0);
      }
    } catch (err: any) {
      setError("Network error loading analytics");
    } finally {
      setLoading(false);
    }
  }, [selectedCamera, selectedZone, personSearch, timeRange, visitStatusFilter, logSearch, pageSize, page]);

  useEffect(() => {
    fetchAnalytics();
    const timer = setInterval(() => {
      fetchAnalytics();
    }, 3000);
    return () => clearInterval(timer);
  }, [fetchAnalytics]);

  // Derived available zones
  const availableZones = useMemo(() => {
    return perZone.map((z) => ({ zone_id: z.zone_id, zone_name: z.zone_name }));
  }, [perZone]);

  const activeOccupantsCount = useMemo(() => {
    return summary?.active_occupants ?? 0;
  }, [summary]);

  const totalPages = Math.max(1, Math.ceil(totalVisitsCount / pageSize));
  const startItem = totalVisitsCount === 0 ? 0 : page * pageSize + 1;
  const endItem = Math.min(totalVisitsCount, (page + 1) * pageSize);

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto min-h-screen">
      {/* Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-[hsl(var(--border))]">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-[hsl(var(--text-primary))] flex items-center gap-3">
            <Layers className="w-7 h-7 text-violet-500" />
            Zone Occupancy Analytics
          </h1>
          <p className="text-xs text-[hsl(var(--text-muted))] mt-1">
            Real-time dwell tracking, zone occupancy duration, and visit logs across facility CCTV feeds
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchAnalytics()}
            disabled={loading}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] text-xs font-semibold text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-card-hover))] transition-colors shadow-sm disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-violet-500 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Global Filter Bar */}
      <div className="p-4 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] shadow-sm grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-center">
        {/* Camera Selector */}
        <div className="space-y-1">
          <label className="text-[11px] font-semibold text-[hsl(var(--text-muted))] flex items-center gap-1.5">
            <Camera className="w-3.5 h-3.5 text-violet-500" /> Camera Feed
          </label>
          <select
            value={selectedCamera}
            onChange={(e) => {
              setSelectedCamera(e.target.value);
              setSelectedZone("all");
              setPage(0);
            }}
            className="w-full bg-[hsl(var(--bg-page))] border border-[hsl(var(--border))] rounded-xl px-3 py-2 text-xs font-medium text-[hsl(var(--text-primary))] focus:outline-none focus:ring-2 focus:ring-violet-500/50"
          >
            <option value="all">All Enabled Cameras</option>
            {cameras.map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {/* Zone Selector */}
        <div className="space-y-1">
          <label className="text-[11px] font-semibold text-[hsl(var(--text-muted))] flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-emerald-500" /> Specific Zone
          </label>
          <select
            value={selectedZone}
            onChange={(e) => {
              setSelectedZone(e.target.value);
              setPage(0);
            }}
            className="w-full bg-[hsl(var(--bg-page))] border border-[hsl(var(--border))] rounded-xl px-3 py-2 text-xs font-medium text-[hsl(var(--text-primary))] focus:outline-none focus:ring-2 focus:ring-violet-500/50"
          >
            <option value="all">All Configured Zones</option>
            {availableZones.map((z) => (
              <option key={z.zone_id} value={z.zone_id}>
                {z.zone_name}
              </option>
            ))}
          </select>
        </div>

        {/* Time Range */}
        <div className="space-y-1">
          <label className="text-[11px] font-semibold text-[hsl(var(--text-muted))] flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-amber-500" /> Time Window
          </label>
          <select
            value={timeRange}
            onChange={(e) => {
              setTimeRange(e.target.value);
              setPage(0);
            }}
            className="w-full bg-[hsl(var(--bg-page))] border border-[hsl(var(--border))] rounded-xl px-3 py-2 text-xs font-medium text-[hsl(var(--text-primary))] focus:outline-none focus:ring-2 focus:ring-violet-500/50"
          >
            <option value="today">Today (00:00 - Now)</option>
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
            <option value="all">All Historical Data</option>
          </select>
        </div>

        {/* Person / Employee ID Search */}
        <div className="space-y-1">
          <label className="text-[11px] font-semibold text-[hsl(var(--text-muted))] flex items-center gap-1.5">
            <UserCheck className="w-3.5 h-3.5 text-blue-500" /> Filter Person ID
          </label>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[hsl(var(--text-muted))] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={personSearch}
              onChange={(e) => {
                setPersonSearch(e.target.value);
                setPage(0);
              }}
              placeholder="Search person..."
              className="w-full bg-[hsl(var(--bg-page))] border border-[hsl(var(--border))] rounded-xl pl-9 pr-3 py-2 text-xs font-medium text-[hsl(var(--text-primary))] focus:outline-none focus:ring-2 focus:ring-violet-500/50"
            />
          </div>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-[hsl(var(--text-muted))]">Total Zone Visits</p>
            <h3 className="text-2xl font-bold mt-1">{summary?.total_visits || 0}</h3>
          </div>
          <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-500 flex items-center justify-center">
            <Users className="w-5 h-5" />
          </div>
        </div>
        <div className="p-5 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-[hsl(var(--text-muted))]">Occupancy Time</p>
            <h3 className="text-2xl font-bold mt-1">{summary?.formatted_total_occupancy || "00:00"}</h3>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 flex items-center justify-center">
            <Clock className="w-5 h-5" />
          </div>
        </div>
        <div className="p-5 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-[hsl(var(--text-muted))]">Avg Dwell</p>
            <h3 className="text-2xl font-bold mt-1">{summary?.formatted_average_dwell || "00:00"}</h3>
          </div>
          <div className="w-10 h-10 rounded-xl bg-violet-500/10 border border-violet-500/20 text-violet-500 flex items-center justify-center">
            <Activity className="w-5 h-5" />
          </div>
        </div>
        <div className="p-5 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-[hsl(var(--text-muted))]">Active Occupants</p>
            <h3 className="text-2xl font-bold mt-1">{activeOccupantsCount}</h3>
          </div>
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-500 flex items-center justify-center">
            <UserCheck className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Historical Visit Log Table with Enhanced Pagination & Filters */}
      <div className="p-6 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] shadow-sm space-y-4">
        {/* Table Title & Filter Controls Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-[hsl(var(--border))]">
          <div className="flex items-center gap-3">
            <h3 className="text-base font-bold flex items-center gap-2">
              <Clock className="w-5 h-5 text-violet-500" />
              Detailed Zone Visit History Log
            </h3>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/20">
              {totalVisitsCount} records
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Status Filter Buttons */}
            <div className="flex items-center bg-[hsl(var(--bg-page))] border border-[hsl(var(--border))] rounded-xl p-1 text-xs">
              <button
                onClick={() => {
                  setVisitStatusFilter("all");
                  setPage(0);
                }}
                className={`px-3 py-1 rounded-lg font-medium transition-all ${
                  visitStatusFilter === "all"
                    ? "bg-[hsl(var(--bg-card))] text-[hsl(var(--text-primary))] shadow-sm"
                    : "text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
                }`}
              >
                All
              </button>
              <button
                onClick={() => {
                  setVisitStatusFilter("active");
                  setPage(0);
                }}
                className={`px-3 py-1 rounded-lg font-medium transition-all ${
                  visitStatusFilter === "active"
                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shadow-sm"
                    : "text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
                }`}
              >
                Active Only
              </button>
              <button
                onClick={() => {
                  setVisitStatusFilter("completed");
                  setPage(0);
                }}
                className={`px-3 py-1 rounded-lg font-medium transition-all ${
                  visitStatusFilter === "completed"
                    ? "bg-[hsl(var(--bg-card))] text-[hsl(var(--text-primary))] shadow-sm"
                    : "text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
                }`}
              >
                Completed
              </button>
            </div>

            {/* Table Search */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[hsl(var(--text-muted))] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={logSearch}
                onChange={(e) => {
                  setLogSearch(e.target.value);
                  setPage(0);
                }}
                placeholder="Search track / ID..."
                className="bg-[hsl(var(--bg-page))] border border-[hsl(var(--border))] rounded-xl pl-9 pr-3 py-1.5 text-xs font-medium text-[hsl(var(--text-primary))] focus:outline-none focus:ring-2 focus:ring-violet-500/50 w-44"
              />
            </div>

            {/* Rows Per Page Selector */}
            <div className="flex items-center gap-1.5 text-xs text-[hsl(var(--text-muted))]">
              <span>Show</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(0);
                }}
                className="bg-[hsl(var(--bg-page))] border border-[hsl(var(--border))] rounded-xl px-2 py-1.5 text-xs font-semibold text-[hsl(var(--text-primary))] focus:outline-none"
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>
          </div>
        </div>

        {/* Visit Log Table */}
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
                  <th className="px-4 py-3 text-left">Track / ID</th>
                  <th className="px-4 py-3 text-left">Entry Time</th>
                  <th className="px-4 py-3 text-left">Exit Time</th>
                  <th className="px-4 py-3 text-right">Dwell</th>
                  <th className="px-4 py-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[hsl(var(--border))]/60">
                {visits.map((v) => (
                  <tr key={v.id} className="hover:bg-[hsl(var(--bg-table-head))]/40 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 font-bold">
                        <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: v.zone_color || "#3B82F6" }} />
                        {v.zone_name}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-[hsl(var(--text-secondary))]">#{v.camera_id}</td>
                    <td className="px-4 py-3">
                      <span className="font-semibold text-[hsl(var(--text-primary))]">
                        {v.person_identifier || `Track-${v.tracking_id}`}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[hsl(var(--text-secondary))]">
                      {v.entry_time ? new Date(v.entry_time).toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-3 text-[hsl(var(--text-secondary))]">
                      {v.exit_time ? new Date(v.exit_time).toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-violet-500">
                      {v.formatted_duration}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                          v.is_active
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                            : "bg-gray-500/10 text-gray-500 dark:text-gray-400 border border-gray-500/20"
                        }`}
                      >
                        {v.is_active && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />}
                        {v.is_active ? "ACTIVE" : "COMPLETED"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Enhanced Pagination Controls Bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-3 border-t border-[hsl(var(--border))]">
          <div className="text-xs text-[hsl(var(--text-muted))]">
            Showing <span className="font-semibold text-[hsl(var(--text-primary))]">{startItem}</span> to{" "}
            <span className="font-semibold text-[hsl(var(--text-primary))]">{endItem}</span> of{" "}
            <span className="font-semibold text-[hsl(var(--text-primary))]">{totalVisitsCount}</span> entries
          </div>

          <div className="flex items-center gap-1.5">
            {/* First Page */}
            <button
              onClick={() => setPage(0)}
              disabled={page === 0}
              title="First Page"
              className="p-1.5 rounded-lg border border-[hsl(var(--border))] text-xs font-semibold text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-card-hover))] disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            >
              <ChevronsLeft className="w-4 h-4" />
            </button>

            {/* Previous Page */}
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              title="Previous Page"
              className="p-1.5 rounded-lg border border-[hsl(var(--border))] text-xs font-semibold text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-card-hover))] disabled:opacity-30 disabled:hover:bg-transparent transition-colors flex items-center gap-1 pr-2"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>Prev</span>
            </button>

            {/* Page Numbers Indicator */}
            <span className="px-3 py-1 rounded-lg bg-[hsl(var(--bg-page))] border border-[hsl(var(--border))] text-xs font-bold text-[hsl(var(--text-primary))]">
              {page + 1} / {totalPages}
            </span>

            {/* Next Page */}
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              title="Next Page"
              className="p-1.5 rounded-lg border border-[hsl(var(--border))] text-xs font-semibold text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-card-hover))] disabled:opacity-30 disabled:hover:bg-transparent transition-colors flex items-center gap-1 pl-2"
            >
              <span>Next</span>
              <ChevronRight className="w-4 h-4" />
            </button>

            {/* Last Page */}
            <button
              onClick={() => setPage(totalPages - 1)}
              disabled={page >= totalPages - 1}
              title="Last Page"
              className="p-1.5 rounded-lg border border-[hsl(var(--border))] text-xs font-semibold text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-card-hover))] disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            >
              <ChevronsRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
