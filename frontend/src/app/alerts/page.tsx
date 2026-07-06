"use client";
import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";

interface Alert {
  id: number;
  timestamp: string;
  message: string;
  resolved: boolean;
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);

  const fetchAlerts = async () => {
    try {
      const res = await fetch("http://localhost:8000/api/alerts");
      if (res.ok) {
        const data = await res.json();
        setAlerts(data);
      }
    } catch (err) {
      console.error("Failed to fetch alerts", err);
    }
  };

  useEffect(() => {
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 5000);
    return () => clearInterval(interval);
  }, []);

  const resolveAlert = async (id: number) => {
    try {
      await fetch(`http://localhost:8000/api/alerts/${id}/resolve`, {
        method: 'PUT'
      });
      fetchAlerts(); // Refresh list immediately
    } catch (err) {
      console.error("Failed to resolve alert", err);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <h2 className="text-2xl font-bold text-white mb-6">System Alerts</h2>
      
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <table className="w-full text-left text-sm text-gray-400">
          <thead className="bg-gray-800/50 text-gray-300">
            <tr>
              <th className="px-6 py-4 font-medium">Time</th>
              <th className="px-6 py-4 font-medium">Message</th>
              <th className="px-6 py-4 font-medium">Status</th>
              <th className="px-6 py-4 font-medium text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {alerts.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-6 py-8 text-center text-gray-500">
                  No alerts recorded yet.
                </td>
              </tr>
            ) : (
              alerts.map((alert) => (
                <tr key={alert.id} className="hover:bg-gray-800/20 transition-colors">
                  <td className="px-6 py-4">{new Date(alert.timestamp).toLocaleTimeString()}</td>
                  <td className="px-6 py-4">
                    <span className="flex items-center gap-2 text-red-400">
                      <AlertCircle className="w-4 h-4" />
                      {alert.message}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    {alert.resolved ? (
                      <span className="flex items-center gap-1 text-emerald-500">
                        <CheckCircle2 className="w-4 h-4" /> Resolved
                      </span>
                    ) : (
                      <span className="text-orange-500">Active</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right">
                    {!alert.resolved && (
                      <button 
                        onClick={() => resolveAlert(alert.id)}
                        className="text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-3 py-1.5 rounded-lg hover:bg-emerald-500/20 transition-colors"
                      >
                        Resolve
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
