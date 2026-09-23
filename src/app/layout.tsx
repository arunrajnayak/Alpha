import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Providers } from "./providers";
import Header from "@/components/layout/Header";
import OfflineBanner from "@/components/layout/OfflineBanner";
import DynamicTitle from "@/components/layout/DynamicTitle";
import MobileAppHandler from "@/components/layout/MobileAppHandler";
import MobileBottomNav from "@/components/layout/MobileBottomNav";
import PullToRefresh from "@/components/layout/PullToRefresh";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Analytics } from "@vercel/analytics/react";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "A🏃lpha",
  description: "Momentum-based Portfolio Dashboard with Analytics",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`dark ${inter.variable}`} suppressHydrationWarning>
      <body className="font-sans antialiased" suppressHydrationWarning>
        <Providers>
            <MobileAppHandler />
            <DynamicTitle />
            <div className="flex flex-col h-screen overflow-hidden">
                <Header />
                {/* Offline banner: shown when device has no network (Capacitor Network plugin) */}
                <OfflineBanner />
                <div
                  className="flex-grow w-full overflow-y-auto scroll-smooth"
                  style={{
                    paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 3.5rem)',
                  }}
                >
                    <PullToRefresh>
                      <main className="p-4 md:p-6 w-full max-w-[1400px] mx-auto pb-8 md:pb-6">
                          {children}
                      </main>
                    </PullToRefresh>
                </div>
                {/* Mobile bottom tab navigation */}
                <MobileBottomNav />
            </div>
            <SpeedInsights />
            <Analytics />
        </Providers>
      </body>
    </html>
  );
}
