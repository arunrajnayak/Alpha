import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Providers } from "./providers";
import Header from "@/components/layout/Header";
import DynamicTitle from "@/components/layout/DynamicTitle";
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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`dark ${inter.variable}`} suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </head>
      <body className="font-sans antialiased" suppressHydrationWarning>
        <Providers>
            <DynamicTitle />
            <div className="flex flex-col h-screen overflow-hidden">
                <Header />
                <div className="flex-grow w-full overflow-y-auto scroll-smooth">
                    <main className="p-4 md:p-6 w-full max-w-[1400px] mx-auto">
                        {children}
                    </main>
                </div>
            </div>
            <SpeedInsights />
            <Analytics />
        </Providers>
      </body>
    </html>
  );
}
