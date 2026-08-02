import { NextResponse } from "next/server";
import { getSupabaseServerEnv } from "@/lib/supabase-env";

export const runtime = "nodejs";

export async function GET() {
  const { url, secretKey } = getSupabaseServerEnv();
  const checks = {
    supabase: false,
    ocrConfigured: Boolean(
      process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID &&
        process.env.GOOGLE_CLOUD_PROJECT_ID &&
        process.env.GOOGLE_WIF_AUDIENCE,
    ),
    ocrQueueConfigured: Boolean(process.env.CRON_SECRET),
    // Route planning needs both: geocoding is API-key based (classic Maps
    // Geocoding API), optimization is WIF based. Losing either one breaks the
    // planner, and it used to fail silently in production with this endpoint
    // still reporting "ok".
    geocodeConfigured: Boolean(process.env.GOOGLE_MAPS_SERVER_API_KEY),
    routeOptimizationConfigured: Boolean(
      process.env.GOOGLE_WIF_AUDIENCE && process.env.GOOGLE_CLOUD_PROJECT_ID,
    ),
    emailConfigured: Boolean(
      process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL,
    ),
  };

  if (url && secretKey) {
    try {
      const response = await fetch(`${url}/rest/v1/`, {
        headers: { apikey: secretKey },
        cache: "no-store",
        signal: AbortSignal.timeout(5_000),
      });
      checks.supabase = response.ok;
    } catch {}
  }

  // The flags were previously computed and then dropped from the response, so
  // a missing key looked identical to a healthy deploy. They are booleans, never
  // values — nothing here reveals a secret. HTTP status still tracks Supabase
  // only, so the uptime monitor keeps its documented meaning.
  return NextResponse.json(
    { status: checks.supabase ? "ok" : "degraded", checks },
    { status: checks.supabase ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
