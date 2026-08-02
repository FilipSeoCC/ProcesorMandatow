import { NextResponse } from "next/server";
import { verifyMember } from "@/lib/supabase-auth";
import { adminHeaders, getSupabaseServerEnv } from "@/lib/supabase-env";
import { writeAuditEvent } from "@/lib/audit";

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
      { error: "Supabase nie jest skonfigurowany." },
      { status: 503 },
    );

  const checkResponse = await fetch(
    `${url}/rest/v1/mandate_documents?select=confirmed_at&id=eq.${encodeURIComponent(id)}&organization_id=eq.${member.organizationId}`,
    { headers: adminHeaders(secretKey), cache: "no-store" },
  );
  const rows = (await checkResponse.json().catch(() => [])) as Array<{
    confirmed_at: string | null;
  }>;
  if (!checkResponse.ok || !rows[0])
    return NextResponse.json({ error: "Nie znaleziono sprawy." }, { status: 404 });
  if (!rows[0].confirmed_at)
    return NextResponse.json(
      { error: "Najpierw zatwierdź dane sprawy." },
      { status: 422 },
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
        resolved_at: new Date().toISOString(),
        resolved_by: member.userId,
      }),
    },
  );
  if (!response.ok)
    return NextResponse.json(
      { error: "Nie udało się oznaczyć sprawy jako zrealizowanej." },
      { status: 502 },
    );
  await writeAuditEvent({
    organizationId: member.organizationId,
    userId: member.userId,
    action: "mandate_document_resolved",
    entityType: "mandate_document",
    entityId: id,
  });
  return NextResponse.json({ ok: true });
}
