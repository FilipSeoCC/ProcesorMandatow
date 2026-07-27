import { NextResponse } from "next/server";
import { verifyMember } from "@/lib/supabase-auth";
import { adminHeaders, getSupabaseServerEnv } from "@/lib/supabase-env";

export const runtime = "nodejs";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { url, secretKey } = getSupabaseServerEnv();
  if (!url || !secretKey) return NextResponse.json({ ok: true, mode: "demo" });

  const member = await verifyMember(request, ["admin", "dispatcher", "office"]);
  if (!member) return NextResponse.json({ error: "Brak dostępu." }, { status: 401 });

  const headers = { ...adminHeaders(secretKey), "Content-Type": "application/json" };
  const closedAssignment = await fetch(
    `${url}/rest/v1/vehicle_assignments?organization_id=eq.${member.organizationId}&vehicle_id=eq.${encodeURIComponent(id)}&valid_to=is.null`,
    { method: "PATCH", headers, body: JSON.stringify({ valid_to: new Date().toISOString() }), signal: AbortSignal.timeout(10_000) },
  );
  if (!closedAssignment.ok) return NextResponse.json({ error: "Nie udało się zamknąć przypisania pojazdu." }, { status: 502 });

  const removed = await fetch(`${url}/rest/v1/vehicles?id=eq.${encodeURIComponent(id)}&organization_id=eq.${member.organizationId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ status: "removed" }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!removed.ok) return NextResponse.json({ error: "Nie udało się usunąć pojazdu." }, { status: 502 });
  return NextResponse.json({ ok: true });
}
