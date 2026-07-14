"use client";
import { useEffect, useState } from "react";
import CameraWidget from "@/components/CameraWidget";
import { Users, AlertCircle, Clock, ShieldCheck } from "lucide-react";

export default function Dashboard() {
  const [stats, setStats] = useState({
    active_workers: 0,
    idle_alerts: 0,
    avg_productivity: 100,
    system_status: "Connecting...",
    idle_threshold_seconds: 10
  });

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch("http://localhost:8000/api/stats");
        if (res.ok) {
          const data = await res.json();
          setStats(data);
        }
      } catch (err) {
        setStats(prev => ({ ...prev, system_status: "Offline" }));
      }
    };

    fetchStats();
    const interval = setInterval(fetchStats, 5000);
    return () => clearInterval(interval);
  }, []);

  const statCards = [
    {
      label: "Active Workers",
      value: stats.active_workers,
      sub: "Online across 1 zone",
      subColor: "text-emerald-600 dark:text-emerald-500",
      icon: Users,
      iconBg: "bg-emerald-500/10",
      iconColor: "text-emerald-600 dark:text-emerald-500",
    },
    {
      label: "Idle Alerts (Today)",
      value: stats.idle_alerts,
      sub: `Threshold: >${stats.idle_threshold_seconds}s`,
      subColor: "text-slate-500 dark:text-gray-500",
      icon: AlertCircle,
      iconBg: "bg-red-500/10",
      iconColor: "text-red-500",
    },
    {
      label: "Avg Productivity",
      value: `${stats.avg_productivity}%`,
      sub: "Based on active time",
      subColor: "text-slate-500 dark:text-gray-500",
      icon: Clock,
      iconBg: "bg-blue-500/10",
      iconColor: "text-blue-500",
    },
    {
      label: "System Status",
      value: stats.system_status,
      sub: "Backend Connected",
      subColor: "text-emerald-600 dark:text-emerald-500",
      icon: ShieldCheck,
      iconBg: "bg-indigo-500/10",
      iconColor: "text-indigo-500",
    },
  ];

  return (
    <div className="p-6 sm:p-8 space-y-8 max-w-7xl mx-auto">
      {/* Top Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {statCards.map(({ label, value, sub, subColor, icon: Icon, iconBg, iconColor }) => (
          <div key={label} className="bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] rounded-xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[hsl(var(--text-secondary))] text-sm font-medium">{label}</h3>
              <div className={`w-8 h-8 rounded-lg ${iconBg} flex items-center justify-center`}>
                <Icon className={`w-4 h-4 ${iconColor}`} />
              </div>
            </div>
            <div className="text-3xl font-bold text-[hsl(var(--text-primary))]">{value}</div>
            <div className={`text-xs ${subColor} mt-2`}>{sub}</div>
          </div>
        ))}
      </div>

      {/* Camera Grid */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-bold text-[hsl(var(--text-primary))]">Live Camera Feeds</h3>
          <div className="flex gap-2">
            <span className="px-3 py-1 text-xs font-medium bg-[hsl(var(--bg-table-head))] text-[hsl(var(--text-secondary))] rounded-md border border-[hsl(var(--border))]">
              Grid: 1x1
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
          <CameraWidget cameraId="cam-01" name="Assembly Line A (Demo Webcam)" />
          {/* Add more <CameraWidget /> components here for a 2x2 or 3x3 layout */}
        </div>
      </div>
    </div>
  );
}