import { NextResponse } from "next/server";
import { verifyMember } from "@/lib/supabase-auth";
import { adminHeaders, getSupabaseServerEnv } from "@/lib/supabase-env";

export const runtime = "nodejs";

const writeRoles = ["admin", "boss", "user"] as const;

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const member = await verifyMember(request, [...writeRoles]);
  if (!member)
    return NextResponse.json({ error: "Brak dostępu." }, { status: 401 });
  const { url, secretKey } = getSupabaseServerEnv();
  if (!url || !secretKey)
    return NextResponse.json(
      { error: "Usługa jest tymczasowo niedostępna. Skontaktuj się z administratorem." },
      { status: 503 },
    );
  const headers = adminHeaders(secretKey);
  const jsonHeaders = { ...headers, "Content-Type": "application/json" };

  // Soft delete: vehicle_assignments and delivery_orders both reference
  // vehicles with "on delete restrict", so a hard delete would either be
  // blocked by any delivery history (leaving a confusing partial failure) or
  // — the previous bug here — irreversibly destroy the assignment history
  // via a pre-emptive delete before finding out the vehicle delete itself
  // would fail anyway. Marking the vehicle removed keeps all history intact
  // and sidesteps both FK constraints entirely.
  const closeAssignments = await fetch(
    `${url}/rest/v1/vehicle_assignments?organization_id=eq.${member.organizationId}&vehicle_id=eq.${encodeURIComponent(id)}&valid_to=is.null`,
    {
      method: "PATCH",
      headers: { ...jsonHeaders, Prefer: "return=minimal" },
      body: JSON.stringify({ valid_to: new Date().toISOString() }),
    },
  );
  if (!closeAssignments.ok)
    return NextResponse.json(
      { error: "Nie udało się zamknąć przypisania pojazdu." },
      { status: 502 },
    );
  const response = await fetch(
    `${url}/rest/v1/vehicles?id=eq.${encodeURIComponent(id)}&organization_id=eq.${member.organizationId}`,
    {
      method: "PATCH",
      headers: { ...jsonHeaders, Prefer: "return=minimal" },
      body: JSON.stringify({ status: "removed" }),
    },
  );
  if (!response.ok)
    return NextResponse.json(
      { error: "Nie udało się usunąć pojazdu." },
      { status: 502 },
    );
  return NextResponse.json({ ok: true });
}
