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
  const member = await verifyMember(request, ["admin", "office", "scanner"]);
  if (!member)
    return NextResponse.json({ error: "Brak dostępu." }, { status: 401 });
  const { url, secretKey } = getSupabaseServerEnv();
  if (!url || !secretKey)
    return NextResponse.json(
      { error: "Supabase nie jest skonfigurowany." },
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

  const result = await matchVehicleCustomer(
    url,
    secretKey,
    member.organizationId,
    document.registration_number,
    document.event_at,
  );
  return NextResponse.json(result);
}
