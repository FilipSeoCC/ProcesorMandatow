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
        amount_gross: amountGross,
        currency,
        payment_due_at: paymentDueAt,
        response_due_at: responseDueAt,
        financial_status: financialStatus,
        amount_confirmed_at: new Date().toISOString(),
        amount_confirmed_by: member.userId,
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
