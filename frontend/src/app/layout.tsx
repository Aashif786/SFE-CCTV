import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import SidebarLayout from "@/components/SidebarLayout";

import { CameraProvider } from "@/context/CameraContext";

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
        <CameraProvider>
          <SidebarLayout>
            {children}
          </SidebarLayout>
        </CameraProvider>
      </body>
    </html>
  );
}