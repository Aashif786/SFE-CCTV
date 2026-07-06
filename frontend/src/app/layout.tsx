import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Link from 'next/link';
import { Activity, LayoutDashboard, History, Settings, Bell } from 'lucide-react';

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Worker Monitor",
  description: "Worker Activity Monitoring System",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} bg-gray-950 text-white`}>
        <div className="flex h-screen overflow-hidden">
          {/* Sidebar */}
          <aside className="w-64 bg-gray-900 border-r border-gray-800 flex flex-col z-20">
            <div className="p-6 flex items-center gap-3 border-b border-gray-800">
              <Activity className="text-emerald-500 w-8 h-8" />
              <h1 className="text-xl font-bold tracking-tight">Worker<span className="text-emerald-500">Mon</span></h1>
            </div>
            
            <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
              <Link href="/" className="flex items-center gap-3 px-4 py-3 rounded-lg bg-gray-800 text-white hover:bg-gray-750 transition-colors">
                <LayoutDashboard className="w-5 h-5" />
                <span className="font-medium">Dashboard</span>
              </Link>
              <Link href="/history" className="flex items-center gap-3 px-4 py-3 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors">
                <History className="w-5 h-5" />
                <span className="font-medium">History</span>
              </Link>
              <Link href="/alerts" className="flex items-center gap-3 px-4 py-3 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors">
                <Bell className="w-5 h-5" />
                <span className="font-medium">Alerts</span>
              </Link>
              <Link href="/settings" className="flex items-center gap-3 px-4 py-3 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors">
                <Settings className="w-5 h-5" />
                <span className="font-medium">Settings</span>
              </Link>
            </nav>
            
            <div className="p-4 border-t border-gray-800">
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center">
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
          <main className="flex-1 flex flex-col relative z-10">
            <header className="h-16 border-b border-gray-800 flex items-center justify-between px-8 bg-gray-900/50 backdrop-blur-sm">
              <h2 className="text-lg font-semibold text-gray-200">System Dashboard</h2>
              <div className="flex items-center gap-4">
                <span className="text-sm text-gray-400">Activity Monitoring Active</span>
              </div>
            </header>
            <div className="flex-1 overflow-y-auto">
              {children}
            </div>
          </main>
        </div>
      </body>
    </html>
  );
}