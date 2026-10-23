import type { Metadata } from "next";
import Script from "next/script";
import AuthGate from "@/components/AuthGate";
import "./globals.css";

export const metadata: Metadata = {
  title: "PDF Template Builder",
  description: "Turn any PDF into an editable, reusable template.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        {/* runtime settings (the backend address), read before the app starts */}
        <Script src="/config.js" strategy="beforeInteractive" />
        <AuthGate>{children}</AuthGate>
      </body>
    </html>
  );
}
