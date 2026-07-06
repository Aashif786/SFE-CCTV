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

  return (
    <div className="space-y-6">
      {/* Top Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-gray-400 text-sm font-medium">Active Workers</h3>
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
              <Users className="w-4 h-4 text-emerald-500" />
            </div>
          </div>
          <div className="text-3xl font-bold text-white">{stats.active_workers}</div>
          <div className="text-xs text-emerald-500 mt-2 flex items-center gap-1">
            <span>Online across 1 zone</span>
          </div>
        </div>
        
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-gray-400 text-sm font-medium">Idle Alerts (Today)</h3>
            <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center">
              <AlertCircle className="w-4 h-4 text-red-500" />
            </div>
          </div>
          <div className="text-3xl font-bold text-white">{stats.idle_alerts}</div>
          <div className="text-xs text-gray-500 mt-2 flex items-center gap-1">
            <span>Threshold: &gt;{stats.idle_threshold_seconds}s</span>
          </div>
        </div>
        
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-gray-400 text-sm font-medium">Avg Productivity</h3>
            <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <Clock className="w-4 h-4 text-blue-500" />
            </div>
          </div>
          <div className="text-3xl font-bold text-white">{stats.avg_productivity}%</div>
          <div className="text-xs text-gray-500 mt-2 flex items-center gap-1">
            <span>Based on active time</span>
          </div>
        </div>
        
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-gray-400 text-sm font-medium">System Status</h3>
            <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center">
              <ShieldCheck className="w-4 h-4 text-indigo-500" />
            </div>
          </div>
          <div className="text-3xl font-bold text-white">{stats.system_status}</div>
          <div className="text-xs text-emerald-500 mt-2 flex items-center gap-1">
            <span>Backend Connected</span>
          </div>
        </div>
      </div>

      {/* Camera Grid */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-bold text-gray-200">Live Camera Feeds</h3>
          <div className="flex gap-2">
            <span className="px-3 py-1 text-xs font-medium bg-gray-800 text-gray-300 rounded-md border border-gray-700">Grid: 1x1</span>
          </div>
        </div>
        
        {/* We are only implementing a 1x1 for this demo but it scales by adding more to this grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
          <CameraWidget cameraId="cam-01" name="Assembly Line A (Demo Webcam)" />
          {/* Add more <CameraWidget /> components here for a 2x2 or 3x3 layout */}
        </div>
      </div>
    </div>
  );
}