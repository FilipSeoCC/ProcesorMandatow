import { NextResponse } from "next/server";
import { verifyMember } from "@/lib/supabase-auth";
import { adminHeaders, getSupabaseServerEnv } from "@/lib/supabase-env";

export const runtime = "nodejs";

const writeRoles = ["admin", "dispatcher", "office"] as const;
const readRoles = [...writeRoles, "scanner", "viewer"] as const;
const internalFleetLabel = "Flota wewnętrzna";

type FleetVehicle = {
  id: string;
  brand: string;
  model: string;
  registration: string;
  customer: string;
  assignedAt: string;
};
type VehicleRow = { id: string; brand: string; model: string; registration_number: string };
type AssignmentRow = { vehicle_id: string; customer_id: string; valid_from: string };
type CustomerRow = { id: string; name: string };

const demoVehicles: FleetVehicle[] = [
  { id: "1", brand: "Ford", model: "Transit Custom", registration: "WI 2847K", customer: "Nova Bud Sp. z o.o.", assignedAt: "2026-06-10T08:00" },
  { id: "2", brand: "Mercedes-Benz", model: "Sprinter 317", registration: "WW 91R2", customer: "Marcin Wiśniewski", assignedAt: "2026-05-22T12:30" },
  { id: "3", brand: "Renault", model: "Master", registration: "WX 5520M", customer: internalFleetLabel, assignedAt: "2026-07-18T09:00" },
  { id: "4", brand: "Volkswagen", model: "Crafter", registration: "WPR 77A9", customer: "Verto Group Sp. z o.o.", assignedAt: "2026-04-03T15:45" },
  { id: "5", brand: "Fiat", model: "Ducato", registration: "WA 4821P", customer: "Alto Serwis Sp. z o.o.", assignedAt: "2026-07-01T07:20" },
];

function isInternal(customer: string) {
  return !customer.trim() || customer.trim().toLowerCase() === internalFleetLabel.toLowerCase();
}
function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function GET(request: Request) {
  const { url, secretKey } = getSupabaseServerEnv();
  if (!url || !secretKey) return NextResponse.json({ mode: "demo", vehicles: demoVehicles });

  const member = await verifyMember(request, [...readRoles]);
  if (!member) return NextResponse.json({ error: "Brak dostępu." }, { status: 401 });

  const headers = { ...adminHeaders(secretKey), cache: "no-store" as const, signal: AbortSignal.timeout(10_000) };
  const [vehiclesResponse, assignmentsResponse] = await Promise.all([
    fetch(
      `${url}/rest/v1/vehicles?select=id,brand,model,registration_number&organization_id=eq.${member.organizationId}&status=neq.removed&order=created_at.desc`,
      headers,
    ),
    fetch(
      `${url}/rest/v1/vehicle_assignments?select=vehicle_id,customer_id,valid_from&organization_id=eq.${member.organizationId}&valid_to=is.null`,
      headers,
    ),
  ]);
  if (!vehiclesResponse.ok || !assignmentsResponse.ok)
    return NextResponse.json({ error: "Nie udało się pobrać floty." }, { status: 502 });

  const vehicles = (await vehiclesResponse.json()) as VehicleRow[];
  const assignments = (await assignmentsResponse.json()) as AssignmentRow[];
  const customerIds = [...new Set(assignments.map((row) => row.customer_id))];
  const customers = customerIds.length
    ? ((await (
        await fetch(
          `${url}/rest/v1/customers?select=id,name&organization_id=eq.${member.organizationId}&id=in.(${customerIds.join(",")})`,
          headers,
        )
      ).json()) as CustomerRow[])
    : [];
  const customerNameById = new Map(customers.map((row) => [row.id, row.name]));
  const assignmentByVehicle = new Map(assignments.map((row) => [row.vehicle_id, row]));

  const result: FleetVehicle[] = vehicles.map((row) => {
    const assignment = assignmentByVehicle.get(row.id);
    return {
      id: row.id,
      brand: row.brand,
      model: row.model,
      registration: row.registration_number,
      customer: assignment ? (customerNameById.get(assignment.customer_id) ?? internalFleetLabel) : internalFleetLabel,
      assignedAt: assignment?.valid_from ?? "",
    };
  });
  return NextResponse.json({ mode: "supabase", vehicles: result });
}

async function findOrCreateCustomer(
  url: string,
  secretKey: string,
  organizationId: string,
  name: string,
): Promise<string> {
  const headers = adminHeaders(secretKey);
  const existing = await fetch(
    `${url}/rest/v1/customers?select=id&organization_id=eq.${organizationId}&name=ilike.${encodeURIComponent(name)}&limit=1`,
    { headers, cache: "no-store", signal: AbortSignal.timeout(10_000) },
  );
  if (existing.ok) {
    const [row] = (await existing.json()) as Array<{ id: string }>;
    if (row) return row.id;
  }
  const created = await fetch(`${url}/rest/v1/customers`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ organization_id: organizationId, name }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!created.ok) throw new Error("Nie udało się zapisać klienta.");
  const [row] = (await created.json()) as Array<{ id: string }>;
  return row.id;
}

async function upsertVehicleRow(
  url: string,
  secretKey: string,
  organizationId: string,
  createdBy: string,
  row: { brand: string; model: string; registration: string; customer: string; assignedAt: string },
): Promise<FleetVehicle> {
  const headers = adminHeaders(secretKey);
  const registration = row.registration.trim().toUpperCase();

  const existingVehicle = await fetch(
    `${url}/rest/v1/vehicles?select=id&organization_id=eq.${organizationId}&registration_number=eq.${encodeURIComponent(registration)}&limit=1`,
    { headers, cache: "no-store", signal: AbortSignal.timeout(10_000) },
  );
  if (!existingVehicle.ok) throw new Error("Nie udało się sprawdzić floty.");
  const [existingRow] = (await existingVehicle.json()) as Array<{ id: string }>;

  let vehicleId = existingRow?.id;
  if (vehicleId) {
    const updated = await fetch(`${url}/rest/v1/vehicles?id=eq.${vehicleId}`, {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ brand: row.brand, model: row.model, status: "active" }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!updated.ok) throw new Error("Nie udało się zaktualizować pojazdu.");
  } else {
    const created = await fetch(`${url}/rest/v1/vehicles`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify({ organization_id: organizationId, brand: row.brand, model: row.model, registration_number: registration }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!created.ok) throw new Error("Nie udało się zapisać pojazdu.");
    [{ id: vehicleId }] = (await created.json()) as Array<{ id: string }>;
  }

  const openAssignment = await fetch(
    `${url}/rest/v1/vehicle_assignments?select=id,customer_id,valid_from&organization_id=eq.${organizationId}&vehicle_id=eq.${vehicleId}&valid_to=is.null&limit=1`,
    { headers, cache: "no-store", signal: AbortSignal.timeout(10_000) },
  );
  if (!openAssignment.ok) throw new Error("Nie udało się sprawdzić przypisania pojazdu.");
  const [current] = (await openAssignment.json()) as Array<{ id: string; customer_id: string; valid_from: string }>;
  const internal = isInternal(row.customer);
  const customerId = internal ? null : await findOrCreateCustomer(url, secretKey, organizationId, row.customer.trim());

  if (current && (internal || current.customer_id !== customerId)) {
    const closedAt = new Date(row.assignedAt) > new Date(current.valid_from) ? row.assignedAt : new Date(new Date(current.valid_from).getTime() + 60_000).toISOString();
    const closed = await fetch(`${url}/rest/v1/vehicle_assignments?id=eq.${current.id}`, {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ valid_to: closedAt }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!closed.ok) throw new Error("Nie udało się zamknąć poprzedniego przypisania.");
  }
  if (!internal && (!current || current.customer_id !== customerId)) {
    const created = await fetch(`${url}/rest/v1/vehicle_assignments`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        organization_id: organizationId,
        vehicle_id: vehicleId,
        customer_id: customerId,
        valid_from: row.assignedAt,
        source: "manual",
        created_by: createdBy,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!created.ok) throw new Error("Nie udało się zapisać przypisania pojazdu.");
  }

  return { id: vehicleId!, brand: row.brand, model: row.model, registration, customer: internal ? internalFleetLabel : row.customer.trim(), assignedAt: row.assignedAt };
}

export async function POST(request: Request) {
  const { url, secretKey } = getSupabaseServerEnv();
  const body = await request.json().catch(() => null);
  const rows: unknown[] | null = Array.isArray(body?.vehicles) ? body.vehicles : null;
  if (!rows || rows.length === 0) return NextResponse.json({ error: "Brak danych pojazdów." }, { status: 422 });

  const normalized = rows.map((row) => {
    const candidate = row as Record<string, unknown>;
    return {
      brand: text(candidate?.brand, 80),
      model: text(candidate?.model, 80),
      registration: text(candidate?.registration, 20),
      customer: text(candidate?.customer, 160),
      assignedAt: text(candidate?.assignedAt, 40),
    };
  });
  const invalid = normalized.find((row) => !row.brand || !row.model || !row.registration || Number.isNaN(new Date(row.assignedAt).getTime()));
  if (invalid) return NextResponse.json({ error: "Uzupełnij markę, model, numer rejestracyjny i datę przekazania." }, { status: 422 });

  if (!url || !secretKey)
    return NextResponse.json({
      mode: "demo",
      vehicles: normalized.map((row, index) => ({ id: `demo-${index}-${row.registration}`, ...row, customer: isInternal(row.customer) ? internalFleetLabel : row.customer })),
    });

  const member = await verifyMember(request, [...writeRoles]);
  if (!member) return NextResponse.json({ error: "Brak dostępu." }, { status: 401 });

  const results: FleetVehicle[] = [];
  for (const row of normalized) {
    try {
      results.push(await upsertVehicleRow(url, secretKey, member.organizationId, member.userId, row));
    } catch (reason) {
      return NextResponse.json({ error: reason instanceof Error ? reason.message : "Nie udało się zapisać floty." }, { status: 502 });
    }
  }
  return NextResponse.json({ mode: "supabase", vehicles: results });
}
