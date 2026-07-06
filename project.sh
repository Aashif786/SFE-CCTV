
#!/bin/bash

# Worker Monitoring System - Project Generator
# Run this script in an empty directory to create the full project structure.

set -e

echo "Generating Worker Monitoring project..."

# ----------------------------------------------------------------------
# 1. Directories
# ----------------------------------------------------------------------
mkdir -p frontend/app/{dashboard/components,history,settings,api/{ws,alerts,workers,config}}
mkdir -p frontend/components/{ui,video}
mkdir -p frontend/lib
mkdir -p frontend/types
mkdir -p backend/src/{detectors,trackers,pose,activity,zones,db}

# ----------------------------------------------------------------------
# 2. Frontend: package.json
# ----------------------------------------------------------------------
cat > frontend/package.json << 'EOF'
{
  "name": "worker-monitor-frontend",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.39.0",
    "next": "14.2.3",
    "react": "^18",
    "react-dom": "^18",
    "recharts": "^2.12.0",
    "tailwind-merge": "^2.2.0",
    "class-variance-authority": "^0.7.0"
  },
  "devDependencies": {
    "@types/node": "^20",
    "@types/react": "^18",
    "@types/react-dom": "^18",
    "autoprefixer": "^10.0.1",
    "postcss": "^8",
    "tailwindcss": "^3.3.0",
    "typescript": "^5"
  }
}
EOF

# ----------------------------------------------------------------------
# 3. Frontend: next.config.js
# ----------------------------------------------------------------------
cat > frontend/next.config.js << 'EOF'
/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    typedRoutes: true,
  },
  // Allow WebSocket connections to backend
  async rewrites() {
    return [
      {
        source: '/api/ws/:path*',
        destination: 'http://localhost:8000/ws/:path*', // FastAPI backend
      },
    ];
  },
};

module.exports = nextConfig;
EOF

# ----------------------------------------------------------------------
# 4. Frontend: TypeScript config
# ----------------------------------------------------------------------
cat > frontend/tsconfig.json << 'EOF'
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
EOF

# ----------------------------------------------------------------------
# 5. Frontend: tailwind.config.js
# ----------------------------------------------------------------------
cat > frontend/tailwind.config.js << 'EOF'
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: { extend: {} },
  plugins: [],
};
EOF

# ----------------------------------------------------------------------
# 6. Frontend: postcss.config.js
# ----------------------------------------------------------------------
cat > frontend/postcss.config.js << 'EOF'
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
EOF

# ----------------------------------------------------------------------
# 7. Frontend: app/layout.tsx (root layout)
# ----------------------------------------------------------------------
cat > frontend/app/layout.tsx << 'EOF'
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Worker Activity Monitor',
  description: 'CCTV-based worker monitoring system',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-950 text-gray-100">{children}</body>
    </html>
  );
}
EOF

# ----------------------------------------------------------------------
# 8. Frontend: app/globals.css
# ----------------------------------------------------------------------
cat > frontend/app/globals.css << 'EOF'
@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  background: #0b0e14;
  color: #e0e5ee;
}
EOF

# ----------------------------------------------------------------------
# 9. Frontend: app/page.tsx (landing / dashboard)
# ----------------------------------------------------------------------
cat > frontend/app/page.tsx << 'EOF'
'use client';
import Dashboard from './dashboard/page';

export default function Home() {
  return <Dashboard />;
}
EOF

# ----------------------------------------------------------------------
# 10. Frontend: app/dashboard/page.tsx (main dashboard)
# ----------------------------------------------------------------------
cat > frontend/app/dashboard/page.tsx << 'EOF'
'use client';
import { useState, useEffect } from 'react';
import CameraGrid from './components/CameraGrid';
import AlertPanel from './components/AlertPanel';
import StatusChart from './components/StatusChart';

export default function Dashboard() {
  const [workers, setWorkers] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [threshold, setThreshold] = useState(15);

  // Simulate WebSocket connection
  useEffect(() => {
    // In real app, connect to backend WebSocket
    const interval = setInterval(() => {
      // mock data
      setWorkers((prev) => [
        ...prev,
        { id: 'w1', status: 'active', x: 0.2, y: 0.3 },
      ]);
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="p-6">
      <header className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">🛡️ Worker Activity Monitor</h1>
        <div className="flex items-center gap-4">
          <label className="text-sm text-gray-400">
            Idle threshold:
            <input
              type="range"
              min="5"
              max="60"
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              className="ml-2"
            />
            <span className="ml-2 font-mono">{threshold}s</span>
          </label>
        </div>
      </header>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <CameraGrid workers={workers} />
        </div>
        <div className="space-y-6">
          <AlertPanel alerts={alerts} />
          <StatusChart workers={workers} />
        </div>
      </div>
    </div>
  );
}
EOF

# ----------------------------------------------------------------------
# 11. Frontend: app/dashboard/components/CameraGrid.tsx
# ----------------------------------------------------------------------
cat > frontend/app/dashboard/components/CameraGrid.tsx << 'EOF'
'use client';
import { useState } from 'react';
import WorkerOver';
import WorkerOverlay from './Workerlay from './WorkerOverlayOverlay';

// Simulated camera feeds';

// Simulated camera feeds - - in production in production, replace, replace with actual video with actual video elements elements

const CAMconst CAMERAS =ERAS = [
  [
  { id: 'cam1', name: ' { id: 'cam1', name: 'Assembly Line A'Assembly Line A' },
  { id },
  { id: 'cam2: 'cam2', name: '', name: 'Machining Zone B' },
  {Machining Zone B' },
  { id: 'cam3', name: id: 'cam3', name: 'Quality Control C' },
  { id: 'cam 'Quality Control C' },
  { id: 'cam4', name:4', name: 'Pack 'Packaging Area D' },
aging Area D' },
];

export default function Camera];

export default function CameraGrid({ workers }: { workers: anyGrid({ workers }: { workers: any[] }) {
 [] }) {
  return (
    <div className="grid return (
    <div className="grid grid-cols- grid-cols-2 gap-42 gap-4">
      {CAMERAS.map((">
      {CAMERAS.map((cam) =>cam) => (
        <div key={cam.id} (
        <div key={cam.id} className="bg className="bg-gray-900-gray-900 rounded-xl overflow-hidden border border-gray- rounded-xl overflow-hidden border border-gray-800">
          <div className800">
          <div className="bg-gray-800 px="bg-gray-800 px-4-4 py-2 text-sm py-2 text-sm font-medium flex justify-between font-medium flex justify-between">
            <span>📹 {cam">
            <span>📹 {cam.name}</.name}</spanspan>
            <span className>
            <span className="text-gray-400="text-gray-400">
              {workers.filter">
              {workers.filter((((w) => ww) => w.camId.camId === === cam.id).length cam.id).length} workers
           } workers
            </span>
          </span>
          </div>
          <div className </div>
          <div className="relative aspect-v="relative aspect-video bg-gray-950">
           ideo bg-gray-950">
            {/* Simulated {/* Simulated video feed background video feed background */}
            <div className */}
            <div className="absolute inset-="absolute inset-0 bg-gradient-to-br0 bg-gradient-to-br from-gray-800 from-gray-800 to-gray to-gray-950 opacity-950 opacity-50-50" />
            {/* Worker overl" />
            {/*ays */}
            { Worker overlays */}
            {workers
              .workers
              .filter((w)filter((w) => w.cam => w.camId === cam.idId === cam.id)
              .map)
              .map((w) => (
                <Worker((w) => (
                <WorkerOverlay key={w.id} worker={w}Overlay key={w.id} />
              ))}
            worker={w} />
              ))}
            <div className="absolute bottom-2 <div className="absolute bottom left-2 text-xs text-gray-500-2 left-2 text-xs text-gray-500">
              SIMUL">
              SIMATED FEED
            </ULATED FEdiv>
          </ED
            </div>
          </div>
        </div>
        </div>
     div>
      ))}
    </div>
  );
}
EOF ))}
    </div>
  );
}
EOF

# -----------------------------------------------------------------

# ----------------------------------------------------------------------
# -----
# 12. Frontend12. Frontend: app/dashboard/components: app/dashboard/components/WorkerOver/WorkerOverlay.tsx
# ---------------------------------------------------------------------lay.tsx
# ----------------------------------------------------------------------
cat > frontend/app/dashboard/components-
cat > frontend/WorkerOverlay/app/dashboard/components/WorkerOverlay.tsx << '.tsx << 'EOF'
EOF'
'use client';

interface WorkerProps'use client';

interface WorkerProps {
  worker: {
    id: string;
    {
  worker: {
    id: string;
    status: 'active status: 'active' | 'idle';
   ' | 'idle';
    x: number x: number;
    y: number;
    width?:;
    y: number;
    width?: number;
    height number;
    height?: number;
   ?: number;
    idleTime?: number;
  };
 idleTime?: number;
  };
}

export default function WorkerOverlay({ worker}

export default function WorkerOverlay({ worker }: WorkerProps) }: WorkerProps) {
  const isId {
  const isle = worker.statusIdle = worker.status === 'idle === 'idle';
  const color';
  const color = isId = isIdle ? '#efle ? '#ef4444' : '#4444' : '#22c5522c55e';
  conste';
  const x x = worker = worker.x * 100.x * 100;
  const y = worker.y *;
  const y 100;
  = worker.y * 100;
  const w = ( const w = (worker.width || worker.width || 0.08)0.08) * 100 * 100;
 ;
  const h = const h = (worker.height || (worker.height || 0.18 0.18) * 100) * 100;

  return;

  return (
    <div (
    <div
      className="absolute border-
      className="absolute border-2 rounded2 rounded transition transition-all duration-all duration-300"
     -300"
      style={{
        left style={{
        left: `${x: `${x}%`,
       }%`,
        top: `${y}%`,
        top: `${y}%`,
        width: `${w width: `${w}%}%`,
       `,
        height: `${h height: `${h}%`,
       }%`,
        borderColor borderColor: color: color,
        backgroundColor,
        backgroundColor: is: isIdle ? 'Idle ? 'rgba(rgba(239,68,68239,68,68,0.15,0.15)' : 'rgba(34,)' : 'rgba(34,197,94,0.15)197,94,',
      }}
   0.15)',
      }}
    >
      <div >
      <div
        className="
        className="absolute -topabsolute -top--6 left6 left-0 text-0 text-xs bg-xs bg-black/70-black/70 px-1.5 py px-1.5 py-0.5-0.5 rounded whitespace-nowrap"
        rounded whitespace-nowrap style={{ color:"
        style={{ color: color }}
      color }}
      >
        { >
        {worker.idworker.id.slice(-.slice(-4)} {isId4)} {isIdle ? `le ? `⏱⏱️${Math.floor️${Math.floor(worker.idle(worker.idleTime || 0)}s` :Time || 0)}s` : '✅ '✅'}
      </div>
    </div'}
      </div>
    </div>
  );
>
  );
}
EOF

# ----------------------------------------------------------------------
# }
EOF

# ----------------------------------------------------------------------
# 13. Frontend13. Frontend: app/dashboard/components/AlertPanel: app/dashboard/components/AlertPanel.tsx
#.tsx
# ----------------------------------------------------------------------
cat > front ----------------------------------------------------------------------
cat > frontend/append/app/dashboard/components//dashboard/components/AlertPanel.tsxAlertPanel.tsx << 'EOF << 'EOF'
'use client'
'use client';

interface Alert {
  id:';

interface Alert string;
  worker {
  id: string;
  workerId: stringId: string;
  message: string;
  message: string;
  timestamp:;
  timestamp: number;
}

export number;
}

export default function AlertPanel default function AlertPanel({ alerts }: {({ alerts }: { alerts: Alert[] alerts: Alert[] }) {
  return (
    <div className="bg-gray }) {
  return (
    <div-900 rounded-xl className="bg-gray-900 rounded-xl border border-gray- border border-gray-800 p800 p-4-4">
      <h">
      <h3 className="font3 className="font-medium-medium text-gray text-gray-300-300 mb-3 mb-3 flex items-center gap flex items-center gap-2">
        🔔 Alerts-2">
        🔔 Alerts
        <span
        <span className="bg-red-600 className="bg-red-600 text text-xs-xs px px-2 py--2 py-0.5 rounded0.5 rounded-full-full">
          {alerts">
          {alerts.length}
        </.length}
        </span>
      </h3>
     span>
      </h3>
      <div className=" <div className="space-y-2 max-h-60space-y-2 max-h-60 overflow-y-auto overflow-y-auto">
        {alerts.length === 0">
        {alerts.length ===  ? (
         0 ? (
          <div <div className="text-sm text-gray-500 className="text-sm text-gray-500 italic">No italic alerts</div">No alerts</div>
        ) :>
        ) : (
          alerts.slice().reverse().map (
          alerts.slice().reverse().map((a) =>((a) => (
            <div key={a (
            <div key={a.id.id} className="text} className="text-sm bg-gray-sm bg-gray-800 p-2-800 p-2 rounded border rounded border-l-4 border-l-4 border-y-yellow-500ellow-500">
              <div">
              <div className="flex justify-between">
                className="flex justify <span>{a.message-between">
                <span}</span>
                <span>{a.message}</span>
                <span className=" className="text-xstext-xs text-gray-400 text-gray-400">
                  {new">
                  {new Date(a.timestamp Date(a.timestamp).toLocaleTime).toLocaleTimeString()}
               String()}
                </span </span>
             >
              </div>
            </div>
            </div>
          ))
        )}
      </div>
          ))
        )}
      </div>
 </div>
       </div>
  </div>
  );
}
EOF );
}
EOF

# ---------------------------------------------------------------------

# ----------------------------------------------------------------------
# 14.-
# 14. Frontend: app/dashboard/components/ Frontend: app/dashboard/components/StatusChart.tsxStatusChart.tsx
# ----------------------------------------------------------------------
cat > front
# ----------------------------------------------------------------------
cat > frontend/app/dashboardend/app/dashboard/components/StatusChart.tsx/components/StatusChart.tsx << ' << 'EOF'
'EOF'
'use clientuse client';
import { useEffect';
import { useEffect, useState } from, useState } from 'react';
import { 'react';
import LineChart, Line { LineChart, Line, XAxis,, XAxis, YAxis, Tooltip, Responsive YAxis, Tooltip, ResponsiveContainer } from 'Container } from 'recharts';

export defaultrecharts';

export default function StatusChart function StatusChart({ workers }: {({ workers }: { workers: any[] workers: any[] }) {
  const [data, set }) {
  const [data, setData] = useStateData] = useState<{ time: string<{ time: string; active: number; active: number; idle: number }[]>(; idle: number }[]>([][]);

  useEffect(());

  useEffect(() => {
 => {
    //    // Simulate Simulate adding adding a a data point every 5 data point every 5 seconds
    const interval seconds
    const interval = setInterval(() => {
      = setInterval(() => {
      const active = workers const active = workers.filter(w => w.filter(w => w.status === 'active.status === 'active').length;
     ').length;
      const idle = workers.filter(w => w const idle = workers.filter(w => w.status === 'id.status === 'idlele').length;
      setData(').length;
      setData(prev => {
       prev => {
        const const newData = [
          ...prev,
 new          { time: new Date().toData = [
          ...prev,
          { time: new Date().toLocaleTimeString(),LocaleTimeString(), active, active, idle idle }
        ];
        }
        ];
        if if (newData.length (newData.length > 20) > 20) newData.shift newData.shift();
        return new();
        return newData;
     Data;
      });
    }, });
    }, 500 5000);
    return0);
    return () => clearInterval () => clearInterval(interval);
 (interval);
  }, [workers]);

 },  return (
    <div [workers]);

  return (
    <div className="bg-gray className="bg-gray-900 rounded-xl border border-900 rounded-xl border border-gray-800 p-4-gray-800 p-4">
      <h3 className="font">
      <h-medium text-gray-3 className="font-medium text-gray-300 mb-3300 mb-3">Activity Trend</h3">Activity Trend</h3>
      <Respons>
      <ResponsiveContainer width="100%" height={iveContainer width="100%" height={120}>
       120}>
        <LineChart data={data}>
          <LineChart data={data}>
          <XAxis dataKey <XAxis dataKey="time" tick={{="time" tick={{ fill fill: '#6: '#6b7280b7280', fontSize: 10 }} />
         ', fontSize: 10 }} />
          <YAxis tick <YAxis tick={{ fill: '#6b728={{ fill: '#6b7280', fontSize: 0', fontSize: 10 }} />
          <Tooltip10 }} />
          <Tooltip />
          <Line type />
          <Line type="monotone" data="monotone" dataKey="active" stroke="#Key="active" stroke="#22c55e" strokeWidth={22c55e2} dot" strokeWidth={2} dot={={false} />
          <Line type="false} />
          <Line type="monotone"monotone" dataKey="id dataKey="idle" stroke="#le" stroke="#ef4444"ef4444" strokeWidth={2} dot={false strokeWidth={2} dot={false} />
        </} />
        </LineChart>
     LineChart>
      </Respons </ResponsiveContainer>
   iveContainer>
    </div>
 </div>
   );
}
EOF );
}
EOF

# ----------------------------------------------------------------------
# 15

# ----------------------------------------------------------------------
# 15. Frontend:. Frontend: API API routes ( routes (placeholder)
#placeholder)
# ----------------------------------------------------------------------
cat ----------------------------------------------------------------------
cat > frontend/app/api/ws/ > frontend/app/api/ws/route.ts << 'route.ts << 'EOF'
importEOF'
import { NextResponse } from 'next/server { NextResponse } from 'next/server';

export async';

export async function GET() function GET() {
  // Web {
  // WebSocket upgradeSocket upgrade handled by backend handled by backend;; this is this is a a placeholder placeholder.
  return NextResponse.
  return NextResponse.json({ message.json({ message: 'WebSocket endpoint -: 'WebSocket endpoint - connect to backend' connect to backend' });
}
EOF });
}
EOF



cat > frontendcat > frontend/app/api/alerts/app/api/alerts/route.ts/route.ts << 'EOF'
import << 'EOF'
import { NextResponse } { NextResponse } from 'next/server from 'next/server';

export async function GET() {
 ';

export async function GET() {
  return NextResponse.json return NextResponse.json([]);
([]);
}
EOF

cat >}
EOF

cat > frontend/app/api frontend/app/api/workers/route/workers/route.ts << 'EOF.ts << 'EOF'
import { Next'
import { NextResponse } from 'Response } from 'next/server';

exportnext/server';

export async function GET() {
  return Next async function GET()Response.json([] {
  return NextResponse.json([]);
}
EOF

cat);
}
EOF

cat > frontend/app > frontend/app/api/config/route.ts << '/api/config/route.ts << 'EOF'
import {EOF'
import { NextResponse } from NextResponse } from 'next/server 'next/server';

export async function GET() {
  return NextResponse.json({';

export async function GET() {
  return NextResponse.json({ threshold: 15 threshold: 15, break, breakMode: falseMode: false });
 });
}

export async function POST(request: Request}

export async function POST(request: Request) {
  const) {
  const body = await request.json();
  return body = await request.json();
  return NextResponse.json({ NextResponse.json({ success success:: true, config: body });
 true, config: body });
}
EOF

# -----------------------------------------------------------------}
EOF

# ----------------------------------------------------------------------
# 16. Frontend-----
# 16. Frontend: lib: lib/supabase.ts
#/supabase.ts
# ----------------------------------------------------------------------
cat ----------------------------------------------------------------------
cat > frontend/lib > frontend/lib/supabase.ts << 'EOF/supabase.ts << 'EOF'
import { createClient'
import { createClient } from '@supabase/s } from '@supabase/supabaseupabase-js';

const-js';

const supabaseUrl = supabaseUrl = process.env.NEXT process.env.NEXT_PUBLIC_SU_PUBLIC_SUPABASE_URL || '';
const supabasePABASE_URL || '';
const supabaseKey =Key = process.env.NEXT process.env.NEXT_PUBLIC_PUBLIC_SUPABASE_AN_SUPABASE_ANON_KEY || 'ON_KEY || '';

export const supabase = createClient';

export const supabase = createClient(supabaseUrl(supabaseUrl, supabaseKey, supabaseKey);
EOF

);
EOF

# ----------------------------------------------------------------------
## ----------------------------------------------------------------------
# 17. Front 17. Frontend: lib/websocket.ts (end: lib/websocket.ts (utility)
# -----------------------------------------------------------------utility)
# ----------------------------------------------------------------------
cat >-----
cat > frontend/lib/websocket.ts frontend/lib/websocket.ts << 'EOF'
export << 'EOF'
export class WebSocketClient class WebSocketClient {
  private {
  private ws: Web ws: WebSocket | null = null;
  privateSocket | null = null;
 url: string  private url: string;

  constructor(url: string;

  constructor(url: string)) {
    this.url = {
    this.url = url;
  url;
  }

  connect(on }

  connect(onMessage: (data: any)Message: (data: any) => void) => void) {
    this.ws {
    this.ws = new WebSocket = new WebSocket(this.url);
    this.ws.on(this.url);
   message = (event this.ws.onmessage = (event) => {
     ) => {
      try {
        const try {
        const data = JSON.parse data = JSON.parse(event.data);
        onMessage(data);
     (event.data);
        onMessage(data);
      } catch ( } catch (e) {
       e) {
        console.error('WS parse console.error('WS parse error', e error', e);
      }
   );
      }
    };
    return this.ws;
  };
    return this.ws;
  }

  disconnect() }

  disconnect() {
    if (this {
    if (this.ws).ws) {
      this.w {
      this.ws.close();
     s.close();
      this.ws = this.ws = null;
    null;
    }
  }
}
EOF }
  }
}
EOF

# ----------------------------------------------------------------------
# 18

# ----------------------------------------------------------------------
# 18. Frontend:. Frontend: types/index.ts
# ----------------------------------------------------------------- types/index.ts
# ----------------------------------------------------------------------
cat >-----
cat > frontend/types/index frontend/types/index.ts << 'EOF.ts << 'EOF'
export interface Worker {
  id'
export interface: string;
  Worker {
  id: string;
  camId: string camId: string;
  status: 'active';
  status: 'active' | 'idle | 'idle';
  x: number;
 ';
  x: y: number;
  number;
  y: number;
  width: number;
 width: number  height: number;
  idleTime;
  height: number;
  idleTime?: number;
?: number;
}

export interface Alert}

export interface Alert {
  id: string {
  id: string;
  workerId;
  workerId: string;
 : string;
  message: string;
  message: string;
  timestamp: number timestamp: number;
  resolved;
  resolved?:?: boolean;
}

export boolean;
}

export interface Config {
  idle interface Config {
  idleThresholdSeconds: numberThresholdSeconds: number;
  break;
  breakMode: booleanMode: boolean;
  zones;
  zones: Array<{ id: string; name: Array<{ id: string; name: string; camera: string; cameraId:Id: string }>;
 string }>;
}
EOF

# -----------------------------------------------------------------}
EOF

# ----------------------------------------------------------------------
# -----
# 19.19. Backend Backend: requirements.txt
# ---------------------------------------------------------------------: requirements.txt
-
cat > backend/requirements.txt << '# ----------------------------------------------------------------------
cat > backend/requirements.txt << 'EOF'
fastapiEOF'
fastapi==0.111==0.111.0
uvicorn==.00.29
uvicorn==0.29.0
op.0
opencv-pythonencv-python==4.9==4.9.0.80.0.80
ultralytics==8.2
ultralytics==.0
media8.2.0
mediapipe==0.10.11pipe==0.10.11
numpy
numpy==1.26.4
sup==1.26.4
abase==2supabase==2.4.5.4
python-d.5
python-dotenv==1otenv==1.0.1.0.1

EOF

# ----------------------------------------------------------------------
# 20. Backend:EOF

# ----------------------------------------------------------------------
# 20. Back Dockerfile (end: Dockerfile (for containerfor containerized inference)
# -----------------------------------------------------------------ized inference)
# ----------------------------------------------------------------------
cat >-----
cat > backend/Dockerfile << 'EOF backend/Dockerfile << 'EOF'
FROM python:3'
FROM python:3.10-slim

WORK.10-slim

WORKDIR /appDIR /app
COPY requirements.txt .
RUN pip install --
COPY requirements.txt .
RUN pip install --no-cache-dno-cache-dir -r requirementsir -r requirements.txt

COPY src/ ./.txt

COPY src/ ./srcsrc/
CMD ["uvicorn/
CMD ["uvicorn", "src.main", "src.main:app", "--:app", "--host", "0.0.0host", "0.0.0.0", "--port", "800.0", "--port", "8000"]
EOF0"]
EOF

# ---------------------------------------------------------------------

# ----------------------------------------------------------------------
# 21. Backend: src-
# 21. Backend:/main.py ( src/main.py (FastAPI entry pointFastAPI entry)
# ----------------------------------------------------------------- point)
# ----------------------------------------------------------------------
cat >-----
cat > backend/src/main.py backend/src/main.py << 'EOF << 'EOF'
from fastapi import'
from fastapi import FastAPI, FastAPI, Web WebSocket, WebSocketDisconnectSocket, WebSocketDisconnect
import cv
import2
import numpy cv2
import numpy as np
import json
import as as np
import json
import asyncio
fromyncio
from datetime import datetime

# Import local datetime import datetime

# modules (place Import localholders)
# from modules (placeholders)
# from detectors.y detectors.yolo_detectorolo_detector import YOLODetector
# import YOLODetector
# from trackers from trackers.bytet.bytetrack import ByteTrackrack import ByteTrackTrackerTracker
# from pose
# from pose..mediapipe_pose import Posemediapipe_pose import PoseEstimator
#Estimator
# from activity.scorer from activity.scorer import ActivityScorer
# from zones import ActivityScorer
# from zones.zone_mapper import. ZoneMapper
#zone_mapper import ZoneMapper
# from db.sup from db.supabase_client import SupabaseClient

appabase_client import SupabaseClient

app = FastAPI(title = FastAPI(title="Worker="Worker Monitoring Back Monitoring Backendend")

@app")

@app.get("/")
async def root.get("/")
async def root():
    return {"():
    return {"messagemessage": "Worker Monitoring API",": "Worker Monitoring API", "status": " "status": "runningrunning"}

@app"}

@app.websocket("/ws/{camera.websocket("/ws/{camera_id}")
async def_id}")
async def websocket_end websocket_endpoint(websocket: WebSocket,point(websocket: WebSocket, camera_id: str camera_id: str):
):
    await websocket.accept    await websocket.accept()
    print(f"()
    print(f"WebSocket connected for camera {WebSocket connected for camera {camera_id}camera_id}")

    # Simulate")

    # Simulate video processing loop video processing loop
    try
    try:
        while True:
        while True:
            # In:
            # In real implementation: real implementation: read read frame, detect, track frame, detect, track, score,, score, etc.
            # For etc.
            # For now, send mock now, send mock data every data every 2 seconds
            mock 2 seconds
            mock__workers = [
workers = [
                {
                    "id":                {
                    "id": f"w{ f"w{np.random.randint(100np.random.randint(1000,99990,9999)}",
                    "camId": camera)}",
                    "camId": camera_id,
                    "_id,
                    "status": np.random.choice(["active",status": np.random.choice(["active", "idle"], "idle"], p p=[0.7=[0.7, 0.3]),
                    ", 0.3]),
                    "x": np.randomx": np.random.uniform(0.uniform(0.1, 0..1, 0.85),
85),
                    "y                    "y": np.random.un": np.random.uniform(0.1, 0iform(0.1, 0.8),
                   .8),
                    "width": np "width": np.random.uniform(0.04,.random.uniform(0.04, 0.10 0.10),
                    "height": np.random.un),
                    "height": np.random.uniform(0.iform(0.12, 012, 0.22),
                    "id.22),
                    "idleTimeleTime": np.random.randint": np.random.randint((0, 30) if np0, 30) if np.random.random.random.random() > 0.() > 0.55 else 0 else 0,
                }
               ,
                }
                for _ in range(np.random.randint( for _ in range(np.random.randint(2, 6))
            ]
           2, 6))
            ]
            await websocket.send await websocket.send_text(json_text(json.dumps({
                "camera_id.dumps({
                "camera_id": camera_id": camera_id,
                "timestamp":,
                "timestamp": datetime.utcnow(). datetime.utcnow().isoformat(),
               isoformat(),
                "workers": mock "workers": mock_workers
           _workers
            }))
            await }))
            await asyncio.sleep asyncio.sleep(2)
    except Web(2)
    except WebSocketDisconnectSocketDisconnect:
        print(f"WebSocket disconnected for camera {c:
        print(f"WebSocket disconnectedamera_id}")
    for camera {camera_id}")
    except Exception as e except Exception as e:
        print(f:
        print(f"Error: {e}")
"Error: {e}")
        await webs        await websocket.closeocket.close()
EOF

# ----------------------------------------------------------------------
#()
EOF

# ----------------------------------------------------------------------
# 22 22. Backend: Place. Backend: Placeholder modules (soholder modules (so imports imports won won't break)
#'t break)
# ----------------------------------------------------------------------
cat ----------------------------------------------------------------------
cat > backend/src > backend/src/detectors/yolo_det/detectors/yolo_detector.py << 'EOFector.py << 'EOF'
# Y'
# YOLOvOLOv8 detector wrapper
class8 detector wrapper
class YOLOD YOLODetector:
    def __init__(etector:
   self, model_path def __init__(self, model_path="yolov="yolov8n.pt"):
        self.model8n.pt"):
        self.model_path =_path = model_path
        model_path
        # # self self.model = YOLO.model = YOLO(model_path)(model_path)  # uncomment when  # uncomment when ult ultralytics installed

    def detect(self, frame):
       ralytics installed

    def detect(self, frame):
        # return # return detections
        return []
EOF

cat detections
        return []
EOF

cat > backend/src/trackers/by > backend/src/trackers/bytetrack.pytetrack.py << 'EOF'
# ByteTrack tracker wrapper << 'EOF'
# ByteTrack tracker wrapper
class ByteTrack
class ByteTrackTracker:
    def __init__(self):
        passTracker:
    def __init__(self):
        pass

    def update

    def update(self, detections,(self, detections, frame):
        # return tracks frame):
        #
        return return tracks
        return []
EOF

cat > []
EOF

cat > backend/src/pose backend/src/pose/mediapipe_/mediapipe_pose.py << 'EOF'
# Mediapose.py << 'EOF'
# MediaPipe posePipe pose estimator
class PoseEstimator:
    estimator
class PoseEstimator:
    def __init__( def __init__(self):
        passself):
        pass

    def estimate

    def estimate(self, frame(self, frame):
        # return key):
        # return keypoints
        return {}
EOF

catpoints
        return {}
EOF

cat > backend/src/activity/scorer.py > backend/src/activity/scorer.py << 'EOF << 'EOF'
# Activity scoring'
# Activity scoring engine
class ActivityScorer:
    engine
class ActivityScorer:
    def __ def __init__(self):
        passinit__(self

    def score(self):
        pass

    def score(self, detections, detections, tracks, pose, tracks, pose_data):
        # return_data):
        # return activity scores per activity scores per worker
        return {}
 worker
        return {}
EOF

catEOF

cat > backend/src/activity > backend/src/activity/idle_manager.py/idle_manager.py << 'EOF << 'EOF'
# Manages idle tim'
# Manages idle timers and alerters and alert generation
class generation
class Id IdleManager:
   leManager:
    def __init__( def __init__(self, threshold_seconds=15self, threshold_seconds=15):
        self.threshold = threshold_seconds):
        self.threshold = threshold_seconds
       
        self.idle_timers = self.idle_timers = {}

    def update {}

    def update(self, worker_id(self, worker_id, is, is_active):
        #_active):
        # update timer, update timer, return return alert if threshold alert if threshold exceeded
        pass
EOF

cat > exceeded
        pass
EOF

cat > backend/src/z backend/src/zones/zone_mones/zone_mapper.py << 'EOF'
# Mapsapper.py << 'EOF'
# Maps worker worker positions to zones
class ZoneMapper positions to zones
class ZoneMapper:
    def __init:
    def __init__(self,__(self, zone_definitions=None zone_definitions=None):
        self.zones = zone_def):
        self.zones = zone_definitions orinitions or {}

    def get_zone(self, x, y, {}

    def get_zone(self, x, y, camera_id):
        camera_id):
        # return zone id # return zone id
        return None
        return None
EOF

cat > backend/src/d
EOF

cat > backend/src/db/supabaseb/supabase_client.py << '_client.py << 'EOF'
# SupEOF'
# Supabase client for storing eventsabase client for storing events and alerts and alerts
class
class SupabaseClient SupabaseClient:
    def __init__(self, url:
    def __init__(self, url=None=None, key=None, key=None):
        self.url):
        self.url = url
        self.key = = url
        self.key = key key
        # self.client = create
        # self.client = create_client(url, key_client(url, key)

    def insert_worker_state)

    def insert_worker(self, data_state(self, data):
        pass

   ):
        pass

    def insert_ def insert_alert(self, alertalert(self, alert):
        pass):
        pass
EOF

# ----------------------------------------------------------------------

EOF

# ----------------------------------------------------------------------
# # 23. docker-com23. docker-compose.yml (for local development with Redis &pose.yml (for local development with Redis & Postgres)
# Postgres)
# ----------------------------------------------------------------------
cat > docker-compose.yml << 'EOF ----------------------------------------------------------------------
cat > docker-compose.yml << 'EOF'
version: ''
version: '3.8'

services:
  redis3.8'

services:
  redis:
    image: redis:7:
    image: redis:7-alpine
   -alpine
    ports:
      - ports:
      - "6379: "6379:6379"
    volumes6379"
   :
      - redis_data volumes:
      - redis_data:/data

 :/data

  postgres:
    image: postgres postgres:
    image: postgres:15-al:15-alpine
    environmentpine
    environment:
      POSTGRES_USER: monitor:
      POSTGRES_USER: monitor
      POSTGR
      POSTGRES_PASSWORD: monitor
      POSTES_PASSWORD: monitor
      POSTGRES_DBGRES_DB: monitor
    ports: monitor
    ports:
      - "543:
      - "5432:54322:5432"
    volumes"
    volumes:
      - postgres_data:/var/lib:
      - postgres_data:/var/lib/postgres/postgresql/dataql/data

volumes:
  redis_data

volumes:
  redis_data:
  postgres_data:
  postgres_data:
EOF

#:
EOF

# ----------------------------------------------------------------------
# ----------------------------------------------------------------------
# 24. README.md 24. README.md
# ---------------------------------------------------------------------
# ----------------------------------------------------------------------
cat > README.md << 'EOF-
cat > README.md << 'EOF'
# Worker'
# Worker Activity Monitoring Activity Monitoring System System

## Overview
A

## Overview
A CCTV-based worker CCTV-based worker activity monitoring system with activity monitoring system with real real-time detection, tracking-time detection, pose, tracking, pose estimation, and idle estimation, and idle alerts.

## Project Structure
- alerts.

## Project Structure
- `frontend/` - Next.js `frontend/ 14 dashboard` - Next.js 14 dashboard
- `
- `backend/backend/` -` - FastAPI inference service
- `docker FastAPI inference service
- `docker-compose.yml` - local-compose.yml` - local Redis Redis & Postgres & Postgres

## Getting Started

### Pr

## Getting Started

### Prerequisites
- Nodeerequisites
- Node.js .js 18+
- Python 3.1018+
- Python 3.10+
- Docker+
- Docker (optional (optional)

)