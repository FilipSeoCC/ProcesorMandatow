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
  //
  // Close every assignment that's ACTIVE right now, not just open-ended
  // ones: assignments can carry a planned end date since the "Umowa do
  // dnia" feature, so a vehicle can be deleted mid-contract while its
  // active assignment already has a future valid_to. valid_to=is.null
  // alone would miss that row entirely, leaving it (and the customer it
  // points at) valid for OCR matching on a vehicle no longer in the fleet.
  // A not-yet-started future assignment (valid_from in the future) is
  // deliberately left untouched — out of scope here.
  const nowIso = new Date().toISOString();
  const closeAssignments = await fetch(
    `${url}/rest/v1/vehicle_assignments?organization_id=eq.${member.organizationId}&vehicle_id=eq.${encodeURIComponent(id)}&valid_from=lte.${encodeURIComponent(nowIso)}&or=(valid_to.is.null,valid_to.gt.${encodeURIComponent(nowIso)})`,
    {
      method: "PATCH",
      headers: { ...jsonHeaders, Prefer: "return=minimal" },
      body: JSON.stringify({ valid_to: nowIso }),
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
