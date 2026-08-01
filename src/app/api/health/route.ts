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

  return NextResponse.json(
    { status: checks.supabase ? "ok" : "degraded", checks },
    { status: checks.supabase ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
