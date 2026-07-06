"use client";
import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';

interface Log {
  id: number;
  timestamp: string;
  status: string;
  idle_seconds: number;
}

export default function HistoryPage() {
  const [data, setData] = useState<any[]>([]);

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const res = await fetch("http://localhost:8000/api/history");
        if (res.ok) {
          const logs: Log[] = await res.json();
          
          // Aggregate logs by hour for the chart
          const grouped: Record<string, { active: number, idle: number }> = {};
          
          logs.forEach(log => {
            const date = new Date(log.timestamp);
            // Localize time for display
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
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white mb-6">Activity History</h2>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-gray-900 border border-gray-800 p-6 rounded-xl">
          <h3 className="text-lg font-medium text-gray-200 mb-4">Activity vs Idle Time (Events)</h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="time" stroke="#9CA3AF" />
                <YAxis stroke="#9CA3AF" />
                <Tooltip contentStyle={{ backgroundColor: '#111827', borderColor: '#374151' }} />
                <Bar dataKey="active" stackId="a" fill="#10B981" />
                <Bar dataKey="idle" stackId="a" fill="#EF4444" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        
        <div className="bg-gray-900 border border-gray-800 p-6 rounded-xl">
          <h3 className="text-lg font-medium text-gray-200 mb-4">Productivity Trend</h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="time" stroke="#9CA3AF" />
                <YAxis stroke="#9CA3AF" />
                <Tooltip contentStyle={{ backgroundColor: '#111827', borderColor: '#374151' }} />
                <Line type="monotone" dataKey="active" stroke="#3B82F6" strokeWidth={3} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
