import { NextResponse } from "next/server";
import { verifyMember } from "@/lib/supabase-auth";
import { adminHeaders, getSupabaseServerEnv } from "@/lib/supabase-env";

export const runtime = "nodejs";

const writeRoles = ["admin", "dispatcher", "office", "scanner"] as const;
const allowedStatuses = ["completed", "failed"] as const;

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ planId: string; stopId: string }> },
) {
  const { planId, stopId } = await params;
  const body = await request.json().catch(() => null);
  const status = body?.status;
  if (!allowedStatuses.includes(status))
    return NextResponse.json({ error: "Nieprawidłowy status przystanku." }, { status: 422 });

  const { url, secretKey } = getSupabaseServerEnv();
  if (!url || !secretKey) return NextResponse.json({ ok: true, mode: "demo" });

  const member = await verifyMember(request, [...writeRoles]);
  if (!member) return NextResponse.json({ error: "Brak dostępu." }, { status: 401 });

  const response = await fetch(
    `${url}/rest/v1/route_stops?id=eq.${encodeURIComponent(stopId)}&route_plan_id=eq.${encodeURIComponent(planId)}&organization_id=eq.${member.organizationId}`,
    {
      method: "PATCH",
      headers: { ...adminHeaders(secretKey), "Content-Type": "application/json" },
      body: JSON.stringify({ status, completed_at: new Date().toISOString(), notes: text(body?.notes, 300) }),
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) return NextResponse.json({ error: "Nie udało się zapisać postępu przystanku." }, { status: 502 });
  return NextResponse.json({ ok: true });
}
