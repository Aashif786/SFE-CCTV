import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import SidebarLayout from "@/components/SidebarLayout";
import { CameraProvider } from "@/context/CameraContext";
import { ThemeProvider } from "@/context/ThemeContext";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "CALVISION",
  description: "CALVISION — CCTV Worker Activity Monitoring System",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.className}`}>
        <ThemeProvider>
          <CameraProvider>
            <SidebarLayout>
              {children}
            </SidebarLayout>
          </CameraProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}