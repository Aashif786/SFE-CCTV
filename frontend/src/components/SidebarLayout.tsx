"use client";

import { useState } from 'react';
import Link from 'next/link';
import {
  LayoutDashboard, History, Settings, Bell,
  Fingerprint, BarChart2, Menu, UserCheck, Sun, Moon, DoorClosed, Wifi,
  Video, SlidersHorizontal
} from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useTheme } from '@/context/ThemeContext';

export default function SidebarLayout({ children }: { children: React.ReactNode }) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const pathname = usePathname();
  const { theme, toggleTheme } = useTheme();

  const navLinks = [
    { href: "/",                    icon: LayoutDashboard,    label: "Dashboard" },
    { href: "/live-cameras",        icon: Video,              label: "Live Cameras" },
    { href: "/camera-management",   icon: SlidersHorizontal,  label: "Camera Management" },
    { href: "/live-checkins",       icon: UserCheck,          label: "Live Check-ins" },
    { href: "/doors",               icon: DoorClosed,         label: "Door Configs" },
    { href: "/history",             icon: History,            label: "History" },
    { href: "/alerts",              icon: Bell,               label: "Alerts" },
    { href: "/sessions",            icon: Wifi,               label: "Session Monitor" },
    { href: "/summary",             icon: BarChart2,          label: "Activity Summary" },
    { href: "/settings",            icon: Settings,           label: "Settings" },
  ];

  return (
    <div className="flex h-screen overflow-hidden bg-[hsl(var(--bg-page))]">
      {/* Sidebar */}
      <aside
        className={`${isSidebarOpen ? 'w-64' : 'w-0'} transition-all duration-300 ease-in-out
          bg-[hsl(var(--bg-sidebar))] border-r border-[hsl(var(--border))]
          flex flex-col z-20 overflow-hidden shrink-0 shadow-sm`}
      >
        {/* Logo */}
        <div className="p-5 flex items-center gap-3 border-b border-[hsl(var(--border))] whitespace-nowrap w-64 shrink-0">
          {/* Camera lens / aperture SVG mark */}
          <svg width="34" height="34" viewBox="0 0 34 34" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
            {/* Outer ring */}
            <circle cx="17" cy="17" r="15.5" stroke="#10b981" strokeWidth="1.5" strokeOpacity="0.5"/>
            {/* Lens body */}
            <circle cx="17" cy="17" r="9" fill="#10b981" fillOpacity="0.12" stroke="#10b981" strokeWidth="1.5"/>
            {/* Inner pupil */}
            <circle cx="17" cy="17" r="4.5" fill="#10b981"/>
            {/* Lens glint */}
            <circle cx="14.5" cy="14.5" r="1.5" fill="white" fillOpacity="0.5"/>
          </svg>
          <h1 className="tracking-tight leading-none">
            <span className="text-lg font-light text-[hsl(var(--text-primary))] tracking-widest">CAL</span><span className="text-lg font-extrabold text-emerald-500 tracking-wide">VISION</span>
          </h1>
        </div>

        {/* Nav Links */}
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto w-64 shrink-0">
          {navLinks.map(({ href, icon: Icon, label }) => {
            const isActive = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-150 ${
                  isActive
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold border border-emerald-500/20'
                    : 'text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-table-head))]'
                }`}
              >
                <Icon className="w-5 h-5 shrink-0" />
                <span className="font-medium">{label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Footer Status */}
        <div className="p-4 border-t border-[hsl(var(--border))] w-64 shrink-0">
          <div className="flex items-center gap-3 px-4 py-3">
            <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0">
              <div className="w-3 h-3 rounded-full bg-emerald-500" />
            </div>
            <div>
              <div className="text-sm font-medium text-[hsl(var(--text-primary))]">System Online</div>
              <div className="text-xs text-[hsl(var(--text-muted))]">Local Database connected</div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 relative z-10">
        {/* Header */}
        <header className="h-16 border-b border-[hsl(var(--border))] flex items-center justify-between px-4 sm:px-8 bg-[hsl(var(--bg-header))]/90 backdrop-blur-sm shrink-0 shadow-sm">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="p-2 text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-table-head))] rounded-lg transition-colors focus:outline-none"
              aria-label="Toggle Sidebar"
            >
              <Menu className="w-5 h-5" />
            </button>
            <h2 className="text-base font-semibold text-[hsl(var(--text-primary))]">System Dashboard</h2>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-sm text-[hsl(var(--text-muted))] hidden sm:inline">Activity Monitoring Active</span>

            {/* Theme Toggle */}
            <button
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              className="p-2 rounded-lg border border-[hsl(var(--border))] hover:border-[hsl(var(--border-strong))]
                bg-[hsl(var(--bg-table-head))] hover:bg-[hsl(var(--bg-input))]
                text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))]
                transition-all duration-200"
            >
              {theme === 'dark'
                ? <Sun className="w-4 h-4 text-amber-400" />
                : <Moon className="w-4 h-4 text-slate-600" />
              }
            </button>
          </div>
        </header>

        {/* Page Content */}
        <div className="flex-1 overflow-y-auto bg-[hsl(var(--bg-page))]">
          {children}
        </div>
      </main>
    </div>
  );
}
