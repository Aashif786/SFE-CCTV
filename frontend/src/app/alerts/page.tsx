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
      fetchAlerts();
    } catch (err) {
      console.error("Failed to resolve alert", err);
    }
  };

  return (
    <div className="p-6 sm:p-8 space-y-8 max-w-4xl mx-auto">
      <h2 className="text-2xl font-bold text-[hsl(var(--text-primary))]">System Alerts</h2>
      
      <div className="bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] rounded-xl overflow-hidden shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-[hsl(var(--bg-table-head))] border-b border-[hsl(var(--border))]">
            <tr className="text-[hsl(var(--text-secondary))]">
              <th className="px-6 py-4 font-semibold">Time</th>
              <th className="px-6 py-4 font-semibold">Message</th>
              <th className="px-6 py-4 font-semibold">Status</th>
              <th className="px-6 py-4 font-semibold text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[hsl(var(--border))]">
            {alerts.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-6 py-10 text-center text-[hsl(var(--text-muted))]">
                  No alerts recorded yet.
                </td>
              </tr>
            ) : (
              alerts.map((alert) => (
                <tr
                  key={alert.id}
                  className="hover:bg-[hsl(var(--bg-table-head))]/60 transition-colors text-[hsl(var(--text-secondary))]"
                >
                  <td className="px-6 py-4 text-[hsl(var(--text-muted))] text-xs font-mono">
                    {new Date(alert.timestamp).toLocaleTimeString()}
                  </td>
                  <td className="px-6 py-4">
                    <span className="flex items-center gap-2 text-red-500 dark:text-red-400 font-medium">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      {alert.message}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    {alert.resolved ? (
                      <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium">
                        <CheckCircle2 className="w-4 h-4" /> Resolved
                      </span>
                    ) : (
                      <span className="text-orange-500 dark:text-orange-400 font-medium">Active</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right">
                    {!alert.resolved && (
                      <button
                        onClick={() => resolveAlert(alert.id)}
                        className="text-xs bg-emerald-500/10 text-emerald-700 dark:text-emerald-400
                          border border-emerald-500/30 px-3 py-1.5 rounded-lg
                          hover:bg-emerald-500/20 transition-colors font-medium"
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
