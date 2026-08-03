import { NextResponse } from "next/server";
import { verifyMember } from "@/lib/supabase-auth";
import { adminHeaders, getSupabaseServerEnv } from "@/lib/supabase-env";
import { matchVehicleCustomer } from "@/lib/vehicle-match";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const member = await verifyMember(request, ["admin", "boss", "user"]);
  if (!member)
    return NextResponse.json({ error: "Brak dostępu." }, { status: 401 });
  const { url, secretKey } = getSupabaseServerEnv();
  if (!url || !secretKey)
    return NextResponse.json(
      { error: "Usługa jest tymczasowo niedostępna. Skontaktuj się z administratorem." },
      { status: 503 },
    );

  const docResponse = await fetch(
    `${url}/rest/v1/mandate_documents?select=registration_number,event_at&id=eq.${encodeURIComponent(id)}&organization_id=eq.${member.organizationId}`,
    { headers: adminHeaders(secretKey), cache: "no-store" },
  );
  const docs = (await docResponse.json().catch(() => [])) as Array<{
    registration_number: string | null;
    event_at: string | null;
  }>;
  const document = docs[0];
  if (!docResponse.ok || !document)
    return NextResponse.json({ error: "Nie znaleziono sprawy." }, { status: 404 });

  // Prefer whatever the reviewer currently has typed in the form over the
  // last-saved DB value — otherwise "Zmien dopasowanie" silently re-matches
  // stale data whenever the edit hasn't been confirmed yet.
  const body = await request.json().catch(() => null);
  const registrationNumber =
    typeof body?.registrationNumber === "string" && body.registrationNumber.trim()
      ? body.registrationNumber.trim()
      : document.registration_number;
  const eventAt =
    typeof body?.eventAt === "string" && body.eventAt.trim()
      ? body.eventAt.trim()
      : document.event_at;

  const result = await matchVehicleCustomer(
    url,
    secretKey,
    member.organizationId,
    registrationNumber,
    eventAt,
  );
  return NextResponse.json(result);
}
