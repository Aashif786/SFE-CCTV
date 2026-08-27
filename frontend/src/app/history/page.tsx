"use client";
import { useEffect, useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';

interface Log {
  id: number;
  timestamp: string;
  status: string;
  idle_seconds: number;
}

export default function HistoryPage() {
  const [data, setData] = useState<any[]>([]);
  const { theme } = useTheme();

  // Theme-aware chart colors
  const chartGrid    = theme === 'dark' ? '#374151' : '#e2e8f0';
  const chartAxis    = theme === 'dark' ? '#9CA3AF' : '#64748b';
  const tooltipBg    = theme === 'dark' ? '#111827' : '#ffffff';
  const tooltipBorder = theme === 'dark' ? '#374151' : '#e2e8f0';
  const tooltipText  = theme === 'dark' ? '#f1f5f9' : '#1e293b';

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const res = await fetch("http://localhost:8001/api/history");
        if (res.ok) {
          const logs: Log[] = await res.json();
          
          const grouped: Record<string, { active: number, idle: number }> = {};
          logs.forEach(log => {
            const date = new Date(log.timestamp);
            const hour = date.getHours().toString().padStart(2, '0') + ':00';
            if (!grouped[hour]) grouped[hour] = { active: 0, idle: 0 };
            if (log.status === 'active') {
               grouped[hour].active += 1;
            } else {
               grouped[hour].idle += 1;
            }
          });
          
          const chartData = Object.keys(grouped).sort().map(time => ({
            time,
            active: grouped[time].active,
            idle: grouped[time].idle
          }));
          
          if (chartData.length === 0) {
             setData([{ time: new Date().getHours().toString().padStart(2, '0') + ':00', active: 0, idle: 0 }]);
          } else {
             setData(chartData);
          }
        }
      } catch (err) {
        console.error("Failed to fetch history", err);
      }
    };
    
    fetchHistory();
    const interval = setInterval(fetchHistory, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="p-6 sm:p-8 space-y-8 max-w-7xl mx-auto">
      <h2 className="text-2xl font-bold text-[hsl(var(--text-primary))]">Activity History</h2>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] p-6 rounded-xl shadow-sm">
          <h3 className="text-lg font-medium text-[hsl(var(--text-primary))] mb-4">Activity vs Idle Time (Events)</h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} />
                <XAxis dataKey="time" stroke={chartAxis} tick={{ fill: chartAxis }} />
                <YAxis stroke={chartAxis} tick={{ fill: chartAxis }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: tooltipBg,
                    borderColor: tooltipBorder,
                    color: tooltipText,
                    borderRadius: '8px',
                  }}
                  labelStyle={{ color: tooltipText }}
                />
                <Bar dataKey="active" stackId="a" fill="#10B981" />
                <Bar dataKey="idle" stackId="a" fill="#EF4444" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        
        <div className="bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] p-6 rounded-xl shadow-sm">
          <h3 className="text-lg font-medium text-[hsl(var(--text-primary))] mb-4">Productivity Trend</h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} />
                <XAxis dataKey="time" stroke={chartAxis} tick={{ fill: chartAxis }} />
                <YAxis stroke={chartAxis} tick={{ fill: chartAxis }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: tooltipBg,
                    borderColor: tooltipBorder,
                    color: tooltipText,
                    borderRadius: '8px',
                  }}
                  labelStyle={{ color: tooltipText }}
                />
                <Line type="monotone" dataKey="active" stroke="#3B82F6" strokeWidth={3} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
