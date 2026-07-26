import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "latin-ext"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Procesor Mandatów — PoC",
  description: "Responsywny prototyp obsługi korespondencji mandatowej dla floty pojazdów.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#172033",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pl" className={inter.variable}>
      <body>
        <a href="#main-content" className="skip-link">Przejdź do treści</a>
        {children}
      </body>
    </html>
  );
}
