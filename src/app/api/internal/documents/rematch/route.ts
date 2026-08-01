import { NextResponse } from "next/server";
import { adminHeaders, getSupabaseServerEnv } from "@/lib/supabase-env";
import { matchVehicleCustomer } from "@/lib/vehicle-match";
import { writeAuditEvent } from "@/lib/audit";

export const runtime = "nodejs";
export const maxDuration = 60;

// Automatic matching runs once, right after OCR — if the vehicle/customer
// assignment didn't exist in the fleet yet at that moment, the document is
// stuck with no match until someone manually clicks "Zmien dopasowanie".
// This sweeps documents that have everything matching needs (plate + event
// date) but never got a match, and retries — cheap, idempotent, no external
// API cost, so no need for the claim/backoff machinery the OCR queue uses.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { url, secretKey } = getSupabaseServerEnv();
  if (!url || !secretKey)
    return NextResponse.json(
      { error: "Supabase nie jest skonfigurowany." },
      { status: 503 },
    );
  const headers = adminHeaders(secretKey);

  const candidatesResponse = await fetch(
    `${url}/rest/v1/mandate_documents?select=id,organization_id,registration_number,event_at&responsible_name=eq.&registration_number=not.is.null&event_at=not.is.null&confirmed_at=is.null&order=created_at.asc&limit=25`,
    { headers, cache: "no-store" },
  );
  const candidates = (await candidatesResponse.json().catch(() => [])) as Array<{
    id: string;
    organization_id: string;
    registration_number: string;
    event_at: string;
  }>;
  if (!candidatesResponse.ok)
    return NextResponse.json({ error: "Nie udało się pobrać spraw." }, { status: 502 });

  let matched = 0;
  for (const doc of candidates) {
    const result = await matchVehicleCustomer(
      url,
      secretKey,
      doc.organization_id,
      doc.registration_number,
      doc.event_at,
    );
    if (!result.matched) continue;
    const updateResponse = await fetch(
      `${url}/rest/v1/mandate_documents?id=eq.${encodeURIComponent(doc.id)}`,
      {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({
          responsible_name: result.responsibleName,
          responsible_tax_id: result.responsibleTaxId,
          responsible_email: result.responsibleEmail,
        }),
      },
    );
    if (!updateResponse.ok) continue;
    matched += 1;
    await writeAuditEvent({
      organizationId: doc.organization_id,
      userId: null,
      action: "mandate_document_auto_rematched",
      entityType: "mandate_document",
      entityId: doc.id,
    });
  }

  return NextResponse.json({ scanned: candidates.length, matched });
}
