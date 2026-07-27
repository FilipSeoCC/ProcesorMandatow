import { NextResponse } from "next/server";
import { verifyMember } from "@/lib/supabase-auth";
import { adminHeaders, getSupabaseServerEnv } from "@/lib/supabase-env";

export const runtime = "nodejs";

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const member = await verifyMember(request, ["admin", "office", "scanner"]);
  if (!member)
    return NextResponse.json({ error: "Brak dostępu." }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body)
    return NextResponse.json({ error: "Nieprawidłowe dane." }, { status: 422 });

  const registrationNumber = text(body.registrationNumber, 15).toUpperCase();
  const eventAt = text(body.eventAt, 10);
  const caseNumber = text(body.caseNumber, 80);
  const sender = text(body.sender, 200);
  const responsibleName = text(body.responsibleName, 200);
  const responsibleTaxId = text(body.responsibleTaxId, 20);
  const responsibleEmail = text(body.responsibleEmail, 200);

  const { url, secretKey } = getSupabaseServerEnv();
  if (!url || !secretKey)
    return NextResponse.json(
      { error: "Supabase nie jest skonfigurowany." },
      { status: 503 },
    );

  const response = await fetch(
    `${url}/rest/v1/mandate_documents?id=eq.${encodeURIComponent(id)}&organization_id=eq.${member.organizationId}`,
    {
      method: "PATCH",
      headers: {
        ...adminHeaders(secretKey),
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        registration_number: registrationNumber || null,
        event_at: eventAt || null,
        case_number: caseNumber || null,
        sender: sender || null,
        responsible_name: responsibleName,
        responsible_tax_id: responsibleTaxId,
        responsible_email: responsibleEmail,
        confirmed_at: new Date().toISOString(),
        confirmed_by: member.userId,
      }),
    },
  );
  if (!response.ok)
    return NextResponse.json(
      { error: "Nie udało się zapisać sprawy." },
      { status: 502 },
    );
  return NextResponse.json({ ok: true });
}
