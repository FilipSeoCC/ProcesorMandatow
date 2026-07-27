import { NextResponse } from "next/server";
import { verifyMember } from "@/lib/supabase-auth";
import { adminHeaders, getSupabaseServerEnv } from "@/lib/supabase-env";

export const runtime = "nodejs";

function normalizePlate(value: string) {
  return value.replace(/[\s-]/g, "").toUpperCase();
}

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
  if (!document.registration_number || !document.event_at)
    return NextResponse.json(
      { matched: false, reason: "Brak numeru rejestracyjnego lub daty zdarzenia." },
    );

  const plate = normalizePlate(document.registration_number);
  const vehiclesResponse = await fetch(
    `${url}/rest/v1/vehicles?select=id,registration_number&organization_id=eq.${member.organizationId}`,
    { headers: adminHeaders(secretKey), cache: "no-store" },
  );
  const vehicles = (await vehiclesResponse.json().catch(() => [])) as Array<{
    id: string;
    registration_number: string;
  }>;
  const vehicle = vehicles.find(
    (item) => normalizePlate(item.registration_number) === plate,
  );
  if (!vehicle)
    return NextResponse.json({
      matched: false,
      reason: "Nie znaleziono pojazdu o tym numerze rejestracyjnym we flocie.",
    });

  const assignmentsResponse = await fetch(
    `${url}/rest/v1/vehicle_assignments?select=customer_id,valid_from,valid_to&organization_id=eq.${member.organizationId}&vehicle_id=eq.${vehicle.id}&valid_from=lte.${document.event_at}&or=(valid_to.is.null,valid_to.gte.${document.event_at})`,
    { headers: adminHeaders(secretKey), cache: "no-store" },
  );
  const assignments = (await assignmentsResponse.json().catch(() => [])) as Array<{
    customer_id: string;
  }>;
  const assignment = assignments[0];
  if (!assignment)
    return NextResponse.json({
      matched: false,
      reason: "Brak przypisania klienta do tego pojazdu w dniu zdarzenia.",
    });

  const customerResponse = await fetch(
    `${url}/rest/v1/customers?select=name,tax_id,email&organization_id=eq.${member.organizationId}&id=eq.${assignment.customer_id}`,
    { headers: adminHeaders(secretKey), cache: "no-store" },
  );
  const customers = (await customerResponse.json().catch(() => [])) as Array<{
    name: string;
    tax_id: string;
    email: string;
  }>;
  const customer = customers[0];
  if (!customer)
    return NextResponse.json({ matched: false, reason: "Nie znaleziono klienta." });

  return NextResponse.json({
    matched: true,
    responsibleName: customer.name,
    responsibleTaxId: customer.tax_id,
    responsibleEmail: customer.email,
  });
}
