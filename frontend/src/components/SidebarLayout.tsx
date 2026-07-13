"use client";

import { useState } from 'react';
import Link from 'next/link';
import { Activity, LayoutDashboard, History, Settings, Bell, Fingerprint, BarChart2, Menu, UserCheck } from 'lucide-react';
import { usePathname } from 'next/navigation';

export default function SidebarLayout({ children }: { children: React.ReactNode }) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const pathname = usePathname();

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside 
        className={`${isSidebarOpen ? 'w-64' : 'w-0'} transition-all duration-300 ease-in-out bg-gray-900 border-r border-gray-800 flex flex-col z-20 overflow-hidden shrink-0`}
      >
        <div className="p-6 flex items-center justify-between gap-3 border-b border-gray-800 whitespace-nowrap w-64 shrink-0">
          <div className="flex items-center gap-3">
            <Activity className="text-emerald-500 w-8 h-8 shrink-0" />
            <h1 className="text-xl font-bold tracking-tight">Worker<span className="text-emerald-500">Mon</span></h1>
          </div>
        </div>
        
        <nav className="flex-1 p-4 space-y-2 overflow-y-auto w-64 shrink-0">
          <Link href="/" className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${pathname === '/' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}>
            <LayoutDashboard className="w-5 h-5 shrink-0" />
            <span className="font-medium">Dashboard</span>
          </Link>
          <Link href="/live-checkins" className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${pathname === '/live-checkins' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}>
            <UserCheck className="w-5 h-5 shrink-0" />
            <span className="font-medium">Live Check-ins</span>
          </Link>
          <Link href="/history" className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${pathname === '/history' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}>
            <History className="w-5 h-5 shrink-0" />
            <span className="font-medium">History</span>
          </Link>
          <Link href="/alerts" className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${pathname === '/alerts' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}>
            <Bell className="w-5 h-5 shrink-0" />
            <span className="font-medium">Alerts</span>
          </Link>
          <Link href="/identity" className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${pathname === '/identity' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}>
            <Fingerprint className="w-5 h-5 shrink-0" />
            <span className="font-medium">Identity Simulator</span>
          </Link>
          <Link href="/summary" className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${pathname === '/summary' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}>
            <BarChart2 className="w-5 h-5 shrink-0" />
            <span className="font-medium">Activity Summary</span>
          </Link>
          <Link href="/settings" className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${pathname === '/settings' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}>
            <Settings className="w-5 h-5 shrink-0" />
            <span className="font-medium">Settings</span>
          </Link>
        </nav>
        
        <div className="p-4 border-t border-gray-800 w-64 shrink-0">
          <div className="flex items-center gap-3 px-4 py-3">
            <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0">
              <div className="w-3 h-3 rounded-full bg-emerald-500"></div>
            </div>
            <div>
              <div className="text-sm font-medium">System Online</div>
              <div className="text-xs text-gray-500">Local Database connected</div>
            </div>
          </div>
        </div>
      </aside>
      
      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 relative z-10">
        <header className="h-16 border-b border-gray-800 flex items-center justify-between px-4 sm:px-8 bg-gray-900/50 backdrop-blur-sm shrink-0">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors focus:outline-none"
              aria-label="Toggle Sidebar"
            >
              <Menu className="w-5 h-5" />
            </button>
            <h2 className="text-lg font-semibold text-gray-200">System Dashboard</h2>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-400 hidden sm:inline">Activity Monitoring Active</span>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
