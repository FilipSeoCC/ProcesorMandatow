import { NextResponse } from "next/server";
import { writeAuditEvent } from "@/lib/audit";
import { buildReviewPackage } from "@/lib/review-package";
import { verifyMember } from "@/lib/supabase-auth";
import { adminHeaders, getSupabaseServerEnv } from "@/lib/supabase-env";

export const runtime = "nodejs";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ATTACHMENT_BYTES = 28 * 1024 * 1024;

type DocumentRow = {
  case_number: string | null;
  registration_number: string | null;
  event_at: string | null;
  letter_date: string | null;
  sender: string | null;
  responsible_name: string;
  responsible_email: string;
  confirmed_at: string | null;
  review_package_sent_at: string | null;
};

type PageRow = { storage_path: string; original_name: string; mime_type: string; size_bytes: number };

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const member = await verifyMember(request, ["admin", "boss", "user"]);
  if (!member) return NextResponse.json({ error: "Brak dostępu." }, { status: 401 });

  const resendKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  if (!resendKey || !from)
    return NextResponse.json({ error: "Wysyłka e-mail nie jest jeszcze skonfigurowana." }, { status: 503 });

  const recipient = member.email?.trim() || "";
  if (!recipient)
    return NextResponse.json({ error: "Twoje konto nie ma poprawnego adresu e-mail." }, { status: 422 });
  if (!EMAIL.test(recipient))
    return NextResponse.json({ error: "Twoje konto nie ma poprawnego adresu e-mail." }, { status: 422 });
  const recipientName = [member.firstName, member.lastName].filter(Boolean).join(" ").trim();

  const { url, secretKey } = getSupabaseServerEnv();
  if (!url || !secretKey) return NextResponse.json({ error: "Usługa jest tymczasowo niedostępna. Skontaktuj się z administratorem." }, { status: 503 });
  const headers = adminHeaders(secretKey);
  const documentResponse = await fetch(`${url}/rest/v1/mandate_documents?select=case_number,registration_number,event_at,letter_date,sender,responsible_name,responsible_email,confirmed_at,review_package_sent_at&id=eq.${encodeURIComponent(id)}&organization_id=eq.${member.organizationId}`, { headers, cache: "no-store" });
  const documents = (await documentResponse.json().catch(() => [])) as DocumentRow[];
  const document = documents[0];
  if (!documentResponse.ok || !document) return NextResponse.json({ error: "Nie znaleziono sprawy." }, { status: 404 });
  if (!document.confirmed_at || !document.responsible_name || !document.responsible_email)
    return NextResponse.json({ error: "Najpierw zatwierdź dane klienta i odbiorcy." }, { status: 422 });
  if (document.review_package_sent_at)
    return NextResponse.json({ error: "Pakiet został już wysłany na Twoją skrzynkę dla tej sprawy." }, { status: 409 });

  const pagesResponse = await fetch(`${url}/rest/v1/mandate_document_pages?select=storage_path,original_name,mime_type,size_bytes&document_id=eq.${encodeURIComponent(id)}&organization_id=eq.${member.organizationId}&order=page_number.asc`, { headers, cache: "no-store" });
  const pages = pagesResponse.ok ? ((await pagesResponse.json()) as PageRow[]) : [];
  const rawSize = pages.reduce((sum, page) => sum + Math.max(0, page.size_bytes), 0);
  const attachments: Array<{ filename: string; content: string }> = [];
  if (pages.length && rawSize <= MAX_ATTACHMENT_BYTES) {
    for (const page of pages) {
      const fileResponse = await fetch(`${url}/storage/v1/object/mandate-documents/${page.storage_path}`, { headers, cache: "no-store", signal: AbortSignal.timeout(20_000) });
      if (!fileResponse.ok) return NextResponse.json({ error: "Nie udało się pobrać załącznika sprawy." }, { status: 502 });
      attachments.push({ filename: page.original_name || "wezwanie", content: Buffer.from(await fileResponse.arrayBuffer()).toString("base64") });
    }
  }

  const appUrl = process.env.APP_URL?.trim() || new URL(request.url).origin;
  const packageMail = buildReviewPackage(document, appUrl, id, recipientName);
  const subject = `[DO PRZESŁANIA] Wezwanie dotyczące pojazdu ${(document.registration_number || "bez rejestracji").replace(/[\r\n]+/g, " ")} · sprawa ${(document.case_number || id).replace(/[\r\n]+/g, " ")}`;
  const emailResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json", "Idempotency-Key": `mandate-review-package-${id}` },
    body: JSON.stringify({ from, to: [recipient], subject, html: packageMail.html, text: packageMail.text, ...(attachments.length ? { attachments } : {}) }),
    signal: AbortSignal.timeout(25_000),
  });
  const result = (await emailResponse.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!emailResponse.ok || !result.id) {
    console.error("Resend review package failed", emailResponse.status, result);
    return NextResponse.json({ error: "Nie udało się wysłać pakietu e-mail.", detail: result.message ?? undefined }, { status: 502 });
  }

  const sentAt = new Date().toISOString();
  const update = await fetch(`${url}/rest/v1/mandate_documents?id=eq.${encodeURIComponent(id)}&organization_id=eq.${member.organizationId}&review_package_sent_at=is.null`, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ status: "review_package_sent", review_package_sent_at: sentAt, review_package_sent_by: member.userId, review_package_email: recipient, review_package_resend_id: result.id }),
  });
  if (!update.ok) console.error("Review package state update failed", update.status);
  await writeAuditEvent({ organizationId: member.organizationId, userId: member.userId, action: "mandate_review_package_sent", entityType: "mandate_document", entityId: id, details: { recipient, resendId: result.id, attachmentIncluded: attachments.length > 0 } });
  return NextResponse.json({ ok: true, emailId: result.id, recipient, sentAt, attachmentIncluded: attachments.length > 0 });
}
