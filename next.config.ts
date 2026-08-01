import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  outputFileTracingIncludes: {
    "/api/documents/\\[id\\]/notice": [
      "./node_modules/@fontsource/noto-sans/files/noto-sans-latin-ext-400-normal.woff",
      "./node_modules/pdfkit/js/data/**/*",
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
        ],
      },
    ];
  },
  async redirects() {
    return [{ source: "/case-studies/voice-ai-analiza-rozmow", destination: "/case-studies/analiza-rozmow-ai-contact-center", permanent: true }];
  },
};

export default nextConfig;
