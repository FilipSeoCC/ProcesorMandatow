import "server-only";
import { adminHeaders } from "@/lib/supabase-env";

export type VehicleMatchResult =
  | { matched: true; responsibleName: string; responsibleTaxId: string; responsibleEmail: string }
  | { matched: false; reason: string };

// Exported so every write path stores/looks up plates the same way this
// matcher compares them — an exact-string lookup elsewhere would miss
// "WA 12345" vs "WA12345" and happily create a duplicate vehicle.
export function normalizePlate(value: string) {
  return value.replace(/[\s-]/g, "").toUpperCase();
}

// Shared by the manual "Zmien dopasowanie" endpoint and the automatic
// match run right after OCR extraction — plate + event date -> vehicle ->
// active assignment on that date -> customer.
export async function matchVehicleCustomer(
  url: string,
  secretKey: string,
  organizationId: string,
  registrationNumber: string | null,
  eventAt: string | null,
): Promise<VehicleMatchResult> {
  if (!registrationNumber || !eventAt)
    return { matched: false, reason: "Brak numeru rejestracyjnego lub daty zdarzenia." };
  const headers = adminHeaders(secretKey);

  const plate = normalizePlate(registrationNumber);
  const vehiclesResponse = await fetch(
    `${url}/rest/v1/vehicles?select=id,registration_number&organization_id=eq.${organizationId}`,
    { headers, cache: "no-store" },
  );
  const vehicles = (await vehiclesResponse.json().catch(() => [])) as Array<{
    id: string;
    registration_number: string;
  }>;
  const vehicle = vehicles.find(
    (item) => normalizePlate(item.registration_number) === plate,
  );
  if (!vehicle)
    return { matched: false, reason: "Nie znaleziono pojazdu o tym numerze rejestracyjnym we flocie." };

  // eventAt round-trips through a timestamptz column and comes back as
  // "...+00:00" (Postgres's offset notation) rather than "...Z" — the "+" is
  // a literal character here, but an unencoded "+" in a query string is
  // interpreted as a space, silently corrupting the timestamp and making
  // this filter match nothing even when a covering assignment exists.
  const eventAtParam = encodeURIComponent(eventAt);
  const assignmentsResponse = await fetch(
    `${url}/rest/v1/vehicle_assignments?select=customer_id,valid_from,valid_to&organization_id=eq.${organizationId}&vehicle_id=eq.${vehicle.id}&valid_from=lte.${eventAtParam}&or=(valid_to.is.null,valid_to.gt.${eventAtParam})&order=valid_from.desc&limit=1`,
    { headers, cache: "no-store" },
  );
  const assignments = (await assignmentsResponse.json().catch(() => [])) as Array<{
    customer_id: string;
  }>;
  const assignment = assignments[0];
  if (!assignment)
    return { matched: false, reason: "Brak przypisania klienta do tego pojazdu w dniu zdarzenia." };

  const customerResponse = await fetch(
    `${url}/rest/v1/customers?select=name,tax_id,email&organization_id=eq.${organizationId}&id=eq.${assignment.customer_id}`,
    { headers, cache: "no-store" },
  );
  const customers = (await customerResponse.json().catch(() => [])) as Array<{
    name: string;
    tax_id: string;
    email: string;
  }>;
  const customer = customers[0];
  if (!customer) return { matched: false, reason: "Nie znaleziono klienta." };

  return {
    matched: true,
    responsibleName: customer.name,
    responsibleTaxId: customer.tax_id,
    responsibleEmail: customer.email,
  };
}
