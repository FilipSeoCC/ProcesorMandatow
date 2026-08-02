import { NextResponse } from "next/server";
import { verifyMember } from "@/lib/supabase-auth";
import { adminHeaders, getSupabaseServerEnv } from "@/lib/supabase-env";

export const runtime = "nodejs";

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

// Covers both the manual up/down arrows and "Przełóż na koniec" — both are
// "here is the full new stop order," handled by the reorder_route_stops RPC
// (schema.sql) so the unique(route_plan_id, position) constraint never sees
// a transient collision from sequential client-driven PATCHes.
export async function POST(request: Request) {
  const member = await verifyMember(request, ["admin", "boss", "user"]);
  if (!member)
    return NextResponse.json({ error: "Brak dostępu." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const planId = text(body?.planId, 64);
  const stopIds = Array.isArray(body?.stopIds)
    ? (body.stopIds as unknown[]).filter((item): item is string => typeof item === "string")
    : [];
  if (!planId || stopIds.length < 2)
    return NextResponse.json({ error: "Brak danych do zmiany kolejności." }, { status: 422 });

  const { url, secretKey } = getSupabaseServerEnv();
  if (!url || !secretKey)
    return NextResponse.json(
      { error: "Supabase nie jest skonfigurowany." },
      { status: 503 },
    );

  const response = await fetch(`${url}/rest/v1/rpc/reorder_route_stops`, {
    method: "POST",
    headers: { ...adminHeaders(secretKey), "Content-Type": "application/json" },
    body: JSON.stringify({
      p_route_plan_id: planId,
      p_organization_id: member.organizationId,
      p_stop_ids: stopIds,
    }),
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error("reorder_route_stops failed", response.status, detail);
    return NextResponse.json(
      { error: "Nie udało się zmienić kolejności przystanków." },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true });
}
