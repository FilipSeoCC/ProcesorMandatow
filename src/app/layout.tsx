import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { Inter } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "latin-ext"],
  display: "swap",
});

export const metadata: Metadata = {
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "FlotaFlow", statusBarStyle: "default" },
  title: "FlotaFlow — Procesor Mandatów",
  description: "Obsługa korespondencji mandatowej i e-TOLL dla floty pojazdów.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#172033",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // CSP nonces are generated per request, so the HTML shell must be rendered dynamically.
  await connection();

  return (
    <html lang="pl" className={inter.variable}>
      <body>
        <a href="#main-content" className="skip-link">Przejdź do treści</a>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
