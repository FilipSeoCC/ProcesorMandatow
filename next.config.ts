import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [{ source: "/case-studies/voice-ai-analiza-rozmow", destination: "/case-studies/analiza-rozmow-ai-contact-center", permanent: true }];
  },
};

export default nextConfig;
