import { NextResponse } from "next/server";
import { writeAuditEvent } from "@/lib/audit";
import { loadAuthorityContext } from "@/lib/authority-context";
import { buildAuthorityResponsePdf } from "@/lib/authority-response";
import { verifyMember } from "@/lib/supabase-auth";
import { getSupabaseServerEnv } from "@/lib/supabase-env";

export const runtime = "nodejs";
export const maxDuration = 60;

const cleanRecipientField = (value: unknown, maxLength: number) =>
  typeof value === "string" ? value.trim().slice(0, maxLength) : "";

function authorityPdfErrorMessage(error: unknown) {
  if (
    error instanceof Error &&
    error.message.startsWith("AUTHORITY_CONTEXT_")
  )
    return "Nie udało się pobrać podstawowych danych sprawy z Supabase. Sprawdź, czy wdrożono aktualny schemat bazy.";
  return "Nie udało się przygotować pisma do urzędu.";
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const member = await verifyMember(request, ["admin", "office"]);
  if (!member)
    return NextResponse.json({ error: "Brak dostępu." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    authorityName?: unknown;
    authorityAddress?: unknown;
  } | null;
  const recipient = {
    name: cleanRecipientField(body?.authorityName, 200),
    address: cleanRecipientField(body?.authorityAddress, 500),
  };
  if (!recipient.name || !recipient.address)
    return NextResponse.json(
      { error: "Uzupełnij nazwę i adres urzędu." },
      { status: 422 },
    );

  const { url, secretKey } = getSupabaseServerEnv();
  if (!url || !secretKey)
    return NextResponse.json(
      { error: "Supabase nie jest skonfigurowany." },
      { status: 503 },
    );

  try {
    const context = await loadAuthorityContext(
      url,
      secretKey,
      member,
      id,
    );
    if (!context)
      return NextResponse.json(
        { error: "Nie znaleziono sprawy." },
        { status: 404 },
      );
    if (!context.confirmedAt || !context.responsibleName)
      return NextResponse.json(
        { error: "Najpierw zatwierdź dane sprawy i wskazanego użytkownika." },
        { status: 422 },
      );

    const pdf = await buildAuthorityResponsePdf(context, recipient);
    await writeAuditEvent({
      organizationId: member.organizationId,
      userId: member.userId,
      action: "authority_response_generated",
      entityType: "mandate_document",
      entityId: id,
      details: { authorityName: recipient.name },
    }).catch((error) => console.error("Authority PDF audit failed", error));

    const filename = `pismo-do-urzedu-${(context.caseNumber || id).replace(/[^a-zA-Z0-9_-]/g, "-")}.pdf`;
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Authority response PDF failed", error);
    return NextResponse.json(
      { error: authorityPdfErrorMessage(error) },
      { status: 502 },
    );
  }
}
