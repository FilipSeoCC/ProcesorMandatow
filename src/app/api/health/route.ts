import { NextResponse } from "next/server";
import { adminHeaders, getSupabaseServerEnv } from "@/lib/supabase-env";

export const runtime = "nodejs";

// Columns tied to specific past incidents: schema.sql adds them, but nothing
// applies it automatically, and forgetting to run it in Supabase SQL Editor
// after a deploy has already caused real 502s/500s ("Zatwierdź dane", OCR
// retry) with no signal until a user hit the broken endpoint. This is not a
// full schema diff — just a canary. Add a group here whenever new columns a
// live endpoint depends on land in schema.sql.
const SCHEMA_CHECKS: Record<string, { table: string; columns: string[] }> = {
  financialFields: {
    table: "mandate_documents",
    columns: [
      "amount_gross",
      "currency",
      "payment_due_at",
      "response_due_at",
      "financial_status",
      "amount_confirmed_at",
      "amount_confirmed_by",
    ],
  },
  ocrQueueFields: {
    table: "mandate_documents",
    columns: ["ocr_attempt_count", "ocr_last_attempt_at", "ocr_next_retry_at"],
  },
  reviewPackageFields: {
    table: "mandate_documents",
    columns: [
      "review_package_sent_at",
      "review_package_sent_by",
      "review_package_email",
      "review_package_resend_id",
    ],
  },
  approvalGate: {
    table: "organization_members",
    columns: ["status"],
  },
};

async function columnsPresent(
  url: string,
  secretKey: string,
  table: string,
  columns: string[],
) {
  // Asking PostgREST to select a column that doesn't exist in the underlying
  // table fails the query (Postgres error 42703), so a 200 here is proof the
  // whole group exists — no need for a separate information_schema query,
  // which PostgREST doesn't expose anyway.
  const response = await fetch(
    `${url}/rest/v1/${table}?select=${columns.join(",")}&limit=1`,
    {
      headers: adminHeaders(secretKey),
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    },
  ).catch(() => null);
  return Boolean(response?.ok);
}

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

  let schema: { ok: boolean; missing: string[] } = { ok: true, missing: [] };

  if (url && secretKey) {
    try {
      const response = await fetch(`${url}/rest/v1/`, {
        headers: { apikey: secretKey },
        cache: "no-store",
        signal: AbortSignal.timeout(5_000),
      });
      checks.supabase = response.ok;
    } catch {}

    // Only probe schema once we know Supabase itself answers — otherwise
    // every group would fail for the same reason and just add noise/latency
    // on top of an outage the "supabase" flag already reports.
    if (checks.supabase) {
      const results = await Promise.all(
        Object.entries(SCHEMA_CHECKS).map(
          async ([name, spec]) =>
            [
              name,
              await columnsPresent(url, secretKey, spec.table, spec.columns),
            ] as const,
        ),
      );
      const missing = results.filter(([, present]) => !present).map(([name]) => name);
      schema = { ok: missing.length === 0, missing };
    }
  }

  // The flags were previously computed and then dropped from the response, so
  // a missing key looked identical to a healthy deploy. They are booleans, never
  // values — nothing here reveals a secret. HTTP status still tracks Supabase
  // only, so the uptime monitor keeps its documented meaning; schema drift is
  // a targeted feature-level failure, not an outage.
  return NextResponse.json(
    { status: checks.supabase ? "ok" : "degraded", checks, schema },
    { status: checks.supabase ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
