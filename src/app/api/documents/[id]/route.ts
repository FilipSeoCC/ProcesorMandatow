import { NextResponse } from "next/server";
import { verifyMember } from "@/lib/supabase-auth";
import { adminHeaders, getSupabaseServerEnv } from "@/lib/supabase-env";
import { writeAuditEvent } from "@/lib/audit";

export const runtime = "nodejs";

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function isoDate(value: unknown) {
  const input = text(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(input) && !Number.isNaN(new Date(`${input}T00:00:00Z`).valueOf())
    ? input
    : null;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const member = await verifyMember(request, ["admin", "office"]);
  if (!member)
    return NextResponse.json({ error: "Brak dostępu." }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body)
    return NextResponse.json({ error: "Nieprawidłowe dane." }, { status: 422 });

  // PATCH is a partial update: only touch what the caller actually sent.
  // Building the payload unconditionally meant the review form — which posts
  // six fields — silently nulled the case number and wiped every financial
  // field (amount, currency, due dates, settlement status) on every save.
  const sent = (key: string) =>
    Object.prototype.hasOwnProperty.call(body, key);
  const update: Record<string, unknown> = {};

  const registrationNumber = text(body.registrationNumber, 15).toUpperCase();
  const eventAt = text(body.eventAt, 30);
  const caseNumber = text(body.caseNumber, 80);
  const sender = text(body.sender, 200);
  const responsibleName = text(body.responsibleName, 200);
  const responsibleTaxId = text(body.responsibleTaxId, 20);
  const responsibleEmail = text(body.responsibleEmail, 200);
  const rawAmount = body.amountGross;
  const amountGross = rawAmount === "" || rawAmount === null || rawAmount === undefined
    ? null
    : typeof rawAmount === "number" && Number.isFinite(rawAmount) && rawAmount >= 0 && rawAmount <= 1_000_000
      ? Math.round(rawAmount * 100) / 100
      : Number.NaN;
  if (Number.isNaN(amountGross))
    return NextResponse.json({ error: "Kwota musi być liczbą od 0 do 1 000 000." }, { status: 422 });
  const currency = text(body.currency, 3).toUpperCase() || "PLN";
  if (!/^[A-Z]{3}$/.test(currency))
    return NextResponse.json({ error: "Waluta musi mieć kod ISO, np. PLN." }, { status: 422 });
  const paymentDueAt = isoDate(body.paymentDueAt);
  const responseDueAt = isoDate(body.responseDueAt);
  const financialStatus = text(body.financialStatus, 32) || "unknown";
  if (!["unknown", "not_applicable", "pending_review", "awaiting_payment", "settled", "cancelled"].includes(financialStatus))
    return NextResponse.json({ error: "Nieprawidłowy status rozliczenia." }, { status: 422 });

  if (sent("registrationNumber"))
    update.registration_number = registrationNumber || null;
  if (sent("eventAt")) update.event_at = eventAt || null;
  if (sent("caseNumber")) update.case_number = caseNumber || null;
  if (sent("sender")) update.sender = sender || null;
  if (sent("responsibleName")) update.responsible_name = responsibleName;
  if (sent("responsibleTaxId")) update.responsible_tax_id = responsibleTaxId;
  if (sent("responsibleEmail")) update.responsible_email = responsibleEmail;
  if (sent("amountGross")) {
    update.amount_gross = amountGross;
    update.amount_confirmed_at = new Date().toISOString();
    update.amount_confirmed_by = member.userId;
  }
  if (sent("currency")) update.currency = currency;
  if (sent("paymentDueAt")) update.payment_due_at = paymentDueAt;
  if (sent("responseDueAt")) update.response_due_at = responseDueAt;
  if (sent("financialStatus")) update.financial_status = financialStatus;
  // Confirming is the point of this endpoint, so it always stamps who/when.
  update.confirmed_at = new Date().toISOString();
  update.confirmed_by = member.userId;

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
      body: JSON.stringify(update),
    },
  );
  if (!response.ok) {
    // PostgREST explains exactly what it rejected (missing column, constraint,
    // bad type). Swallowing it left "Nie udało się zapisać sprawy" as the only
    // signal, which is indistinguishable from a network problem and hides the
    // most likely cause: schema.sql not applied to the live database.
    const detail = await response.text().catch(() => "");
    console.error("mandate_documents PATCH failed", response.status, detail);
    let message = "";
    try {
      message = (JSON.parse(detail) as { message?: string }).message ?? "";
    } catch {}
    return NextResponse.json(
      {
        error: message
          ? `Nie udało się zapisać sprawy: ${message}`
          : "Nie udało się zapisać sprawy.",
      },
      { status: 502 },
    );
  }
  await writeAuditEvent({
    organizationId: member.organizationId,
    userId: member.userId,
    action: "mandate_document_confirmed",
    entityType: "mandate_document",
    entityId: id,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const member = await verifyMember(request, ["admin", "office"]);
  if (!member)
    return NextResponse.json({ error: "Brak dostępu." }, { status: 401 });
  const { url, secretKey } = getSupabaseServerEnv();
  if (!url || !secretKey)
    return NextResponse.json(
      { error: "Supabase nie jest skonfigurowany." },
      { status: 503 },
    );
  const headers = adminHeaders(secretKey);

  const pagesResponse = await fetch(
    `${url}/rest/v1/mandate_document_pages?select=storage_path&document_id=eq.${encodeURIComponent(id)}&organization_id=eq.${member.organizationId}`,
    { headers, cache: "no-store" },
  );
  const pages = pagesResponse.ok
    ? ((await pagesResponse.json()) as Array<{ storage_path: string }>)
    : [];
  if (pages.length)
    await fetch(`${url}/storage/v1/object/mandate-documents`, {
      method: "DELETE",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ prefixes: pages.map((page) => page.storage_path) }),
    }).catch(() => null);

  const response = await fetch(
    `${url}/rest/v1/mandate_documents?id=eq.${encodeURIComponent(id)}&organization_id=eq.${member.organizationId}`,
    { method: "DELETE", headers },
  );
  if (!response.ok)
    return NextResponse.json(
      { error: "Nie udało się usunąć sprawy." },
      { status: 502 },
    );
  await writeAuditEvent({
    organizationId: member.organizationId,
    userId: member.userId,
    action: "mandate_document_deleted",
    entityType: "mandate_document",
    entityId: id,
    details: { pageCount: pages.length },
  });
  return NextResponse.json({ ok: true });
}
