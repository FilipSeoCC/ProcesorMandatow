import { NextResponse } from "next/server";
import { writeAuditEvent } from "@/lib/audit";
import { loadAuthorityContext } from "@/lib/authority-context";
import {
  buildAuthorityResponsePdf,
  buildAuthorityReviewPackage,
} from "@/lib/authority-response";
import { verifyMember } from "@/lib/supabase-auth";
import { adminHeaders, getSupabaseServerEnv } from "@/lib/supabase-env";

export const runtime = "nodejs";
export const maxDuration = 120;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_SOURCE_BYTES = 28 * 1024 * 1024;

type PageRow = {
  storage_path: string;
  original_name: string;
  size_bytes: number;
};

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
    name:
      typeof body?.authorityName === "string"
        ? body.authorityName.trim().slice(0, 200)
        : "",
    address:
      typeof body?.authorityAddress === "string"
        ? body.authorityAddress.trim().slice(0, 500)
        : "",
  };
  if (!recipient.name || !recipient.address)
    return NextResponse.json(
      { error: "Uzupełnij nazwę i adres urzędu." },
      { status: 422 },
    );

  const resendKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  if (!resendKey || !from)
    return NextResponse.json(
      {
        error:
          "Wysyłka e-mail nie jest jeszcze skonfigurowana. Pobierz PDF i przekaż go ręcznie.",
      },
      { status: 503 },
    );

  const employeeEmail = member.email?.trim() || "";
  if (!EMAIL.test(employeeEmail))
    return NextResponse.json(
      { error: "Twoje konto nie ma poprawnego adresu e-mail." },
      { status: 422 },
    );

  const { url, secretKey } = getSupabaseServerEnv();
  if (!url || !secretKey)
    return NextResponse.json(
      { error: "Supabase nie jest skonfigurowany." },
      { status: 503 },
    );
  const headers = adminHeaders(secretKey);

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
    if (!context.responsibleTaxId || !context.responsibleAddress)
      return NextResponse.json(
        {
          error:
            "Uzupełnij NIP/PESEL oraz adres klienta w bazie klientów przed przygotowaniem pisma.",
        },
        { status: 422 },
      );

    const pagesResponse = await fetch(
      `${url}/rest/v1/mandate_document_pages?select=storage_path,original_name,size_bytes&document_id=eq.${encodeURIComponent(id)}&organization_id=eq.${member.organizationId}&order=page_number.asc`,
      {
        headers,
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!pagesResponse.ok)
      return NextResponse.json(
        { error: "Nie udało się pobrać skanu źródłowego." },
        { status: 502 },
      );
    const pages = (await pagesResponse.json()) as PageRow[];
    const sourceSize = pages.reduce(
      (sum, page) => sum + Math.max(0, page.size_bytes),
      0,
    );
    if (sourceSize > MAX_SOURCE_BYTES)
      return NextResponse.json(
        {
          error:
            "Skan jest zbyt duży do wysłania e-mailem. Pobierz PDF i przekaż załączniki ręcznie.",
        },
        { status: 413 },
      );

    const responsePdf = await buildAuthorityResponsePdf(context, recipient);
    const attachments: Array<{ filename: string; content: string }> = [
      {
        filename: `pismo-do-urzedu-${(context.caseNumber || id).replace(/[^a-zA-Z0-9_-]/g, "-")}.pdf`,
        content: responsePdf.toString("base64"),
      },
    ];
    for (const page of pages) {
      const fileResponse = await fetch(
        `${url}/storage/v1/object/mandate-documents/${page.storage_path}`,
        {
          headers,
          cache: "no-store",
          signal: AbortSignal.timeout(20_000),
        },
      );
      if (!fileResponse.ok)
        return NextResponse.json(
          { error: "Nie udało się pobrać załącznika sprawy." },
          { status: 502 },
        );
      attachments.push({
        filename: page.original_name || "wezwanie",
        content: Buffer.from(await fileResponse.arrayBuffer()).toString("base64"),
      });
    }

    const appUrl = process.env.APP_URL?.trim() || new URL(request.url).origin;
    const reviewPackage = buildAuthorityReviewPackage(context, recipient, appUrl);
    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `mandate-authority-package-${id}`,
      },
      body: JSON.stringify({
        from,
        to: [employeeEmail],
        subject: reviewPackage.subject.replace(/[\r\n]+/g, " "),
        html: reviewPackage.html,
        text: reviewPackage.text,
        attachments,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const result = (await emailResponse.json().catch(() => ({}))) as {
      id?: string;
      message?: string;
    };
    if (!emailResponse.ok || !result.id) {
      console.error("Resend authority package failed", emailResponse.status, result);
      return NextResponse.json(
        {
          error: "Nie udało się wysłać pakietu do pracownika.",
          detail: result.message,
        },
        { status: 502 },
      );
    }

    await writeAuditEvent({
      organizationId: member.organizationId,
      userId: member.userId,
      action: "authority_review_package_sent",
      entityType: "mandate_document",
      entityId: id,
      details: {
        employeeEmail,
        authorityName: recipient.name,
        resendId: result.id,
        attachmentCount: attachments.length,
      },
    }).catch((error) => console.error("Authority email audit failed", error));

    return NextResponse.json({
      ok: true,
      emailId: result.id,
      recipient: employeeEmail,
      attachmentCount: attachments.length,
    });
  } catch (error) {
    console.error("Authority review package failed", error);
    return NextResponse.json(
      { error: "Nie udało się przygotować pakietu do urzędu." },
      { status: 502 },
    );
  }
}
