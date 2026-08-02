import { NextResponse } from "next/server";
import { writeAuditEvent } from "@/lib/audit";
import { loadAuthorityContext } from "@/lib/authority-context";
import { buildClientNoticePdf } from "@/lib/client-notice";
import { verifyMember } from "@/lib/supabase-auth";
import { getSupabaseServerEnv } from "@/lib/supabase-env";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(
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

  try {
    const context = await loadAuthorityContext(url, secretKey, member, id);
    if (!context)
      return NextResponse.json(
        { error: "Nie znaleziono sprawy." },
        { status: 404 },
      );
    if (!context.confirmedAt || !context.responsibleName)
      return NextResponse.json(
        { error: "Najpierw zatwierdź dane i odbiorcę zawiadomienia." },
        { status: 422 },
      );

    const pdf = await buildClientNoticePdf(context);
    await writeAuditEvent({
      organizationId: member.organizationId,
      userId: member.userId,
      action: "payment_notice_generated",
      entityType: "mandate_document",
      entityId: id,
    }).catch((error) => console.error("Client notice audit failed", error));

    const filenamePart = (context.caseNumber || id).replace(
      /[^a-zA-Z0-9_-]/g,
      "-",
    );
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="zawiadomienie-${filenamePart}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Client notice PDF failed", error);
    return NextResponse.json(
      { error: "Nie udało się przygotować zawiadomienia dla klienta." },
      { status: 502 },
    );
  }
}
