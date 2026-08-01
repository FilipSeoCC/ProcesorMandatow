import { NextResponse } from "next/server";
import { verifyMember } from "@/lib/supabase-auth";
import { adminHeaders, getSupabaseServerEnv } from "@/lib/supabase-env";

export const runtime = "nodejs";

const readRoles = ["admin", "dispatcher", "office", "scanner", "viewer"] as const;
const writeRoles = ["admin", "dispatcher", "office"] as const;

type VehicleRow = {
  id: string;
  brand: string;
  model: string;
  registration_number: string;
};
type AssignmentRow = {
  vehicle_id: string;
  customer_id: string;
  valid_from: string;
};
type CustomerRow = { id: string; name: string; email?: string; tax_id?: string };

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function GET(request: Request) {
  const member = await verifyMember(request, [...readRoles]);
  if (!member)
    return NextResponse.json({ error: "Brak dostępu." }, { status: 401 });
  const { url, secretKey } = getSupabaseServerEnv();
  if (!url || !secretKey)
    return NextResponse.json(
      { error: "Supabase nie jest skonfigurowany." },
      { status: 503 },
    );
  const headers = adminHeaders(secretKey);

  const vehiclesResponse = await fetch(
    `${url}/rest/v1/vehicles?select=id,brand,model,registration_number&organization_id=eq.${member.organizationId}&order=created_at.desc`,
    { headers, cache: "no-store" },
  );
  if (!vehiclesResponse.ok)
    return NextResponse.json(
      { error: "Nie udało się pobrać floty." },
      { status: 502 },
    );
  const vehicles = (await vehiclesResponse.json()) as VehicleRow[];

  const assignmentsResponse = await fetch(
    `${url}/rest/v1/vehicle_assignments?select=vehicle_id,customer_id,valid_from&organization_id=eq.${member.organizationId}&valid_to=is.null&order=valid_from.desc`,
    { headers, cache: "no-store" },
  );
  const assignments = assignmentsResponse.ok
    ? ((await assignmentsResponse.json()) as AssignmentRow[])
    : [];
  const assignmentByVehicle = new Map<string, AssignmentRow>();
  for (const assignment of assignments)
    if (!assignmentByVehicle.has(assignment.vehicle_id))
      assignmentByVehicle.set(assignment.vehicle_id, assignment);

  const customerIds = [
    ...new Set(assignments.map((assignment) => assignment.customer_id)),
  ];
  let customerById = new Map<string, CustomerRow>();
  if (customerIds.length) {
    const customersResponse = await fetch(
      `${url}/rest/v1/customers?select=id,name,email,tax_id&organization_id=eq.${member.organizationId}&id=in.(${customerIds.join(",")})`,
      { headers, cache: "no-store" },
    );
    if (customersResponse.ok) {
      const customers = (await customersResponse.json()) as CustomerRow[];
      customerById = new Map(customers.map((customer) => [customer.id, customer]));
    }
  }

  const mayReadCustomerContact = ["admin", "dispatcher", "office"].includes(member.role);
  const result = vehicles.map((vehicle) => {
    const assignment = assignmentByVehicle.get(vehicle.id);
    const customer = assignment ? customerById.get(assignment.customer_id) : undefined;
    return {
      id: vehicle.id,
      brand: vehicle.brand,
      model: vehicle.model,
      registration: vehicle.registration_number,
      customer: customer?.name ?? (assignment ? "" : "Flota wewnętrzna"),
      customerEmail: mayReadCustomerContact ? customer?.email ?? "" : "",
      customerTaxId: mayReadCustomerContact ? customer?.tax_id ?? "" : "",
      assignedAt: assignment?.valid_from ?? "",
    };
  });
  return NextResponse.json({ vehicles: result });
}

export async function POST(request: Request) {
  const member = await verifyMember(request, [...writeRoles]);
  if (!member)
    return NextResponse.json({ error: "Brak dostępu." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const brand = text(body?.brand, 80);
  const model = text(body?.model, 80);
  const registration = text(body?.registration, 15).toUpperCase();
  const customerName = text(body?.customer, 200);
  const customerEmail = text(body?.customerEmail, 200);
  const customerTaxId = text(body?.customerTaxId, 20);
  const assignedAtRaw = text(body?.assignedAt, 40);
  const assignedAt = assignedAtRaw ? new Date(assignedAtRaw) : null;
  if (!brand || !model || !registration || !customerName || !assignedAt || Number.isNaN(assignedAt.valueOf()))
    return NextResponse.json(
      { error: "Uzupełnij wszystkie pola." },
      { status: 422 },
    );
  const { url, secretKey } = getSupabaseServerEnv();
  if (!url || !secretKey)
    return NextResponse.json(
      { error: "Supabase nie jest skonfigurowany." },
      { status: 503 },
    );
  const headers = adminHeaders(secretKey);
  const jsonHeaders = { ...headers, "Content-Type": "application/json" };
  const assignedAtIso = assignedAt.toISOString();

  const existingCustomerResponse = await fetch(
    `${url}/rest/v1/customers?select=id,email,tax_id&organization_id=eq.${member.organizationId}&name=eq.${encodeURIComponent(customerName)}&limit=1`,
    { headers, cache: "no-store" },
  );
  const existingCustomers = existingCustomerResponse.ok
    ? ((await existingCustomerResponse.json()) as CustomerRow[])
    : [];
  const existingCustomer = existingCustomers[0] ?? null;
  let customerId = existingCustomer?.id ?? null;
  if (!customerId) {
    const createCustomer = await fetch(`${url}/rest/v1/customers`, {
      method: "POST",
      headers: { ...jsonHeaders, Prefer: "return=representation" },
      body: JSON.stringify({
        organization_id: member.organizationId,
        name: customerName,
        email: customerEmail,
        tax_id: customerTaxId,
      }),
    });
    if (!createCustomer.ok)
      return NextResponse.json(
        { error: "Nie udało się utworzyć klienta." },
        { status: 502 },
      );
    const created = (await createCustomer.json()) as CustomerRow[];
    customerId = created[0]?.id ?? null;
  } else if (
    (customerEmail && customerEmail !== existingCustomer?.email) ||
    (customerTaxId && customerTaxId !== existingCustomer?.tax_id)
  ) {
    await fetch(
      `${url}/rest/v1/customers?id=eq.${customerId}&organization_id=eq.${member.organizationId}`,
      {
        method: "PATCH",
        headers: { ...jsonHeaders, Prefer: "return=minimal" },
        body: JSON.stringify({
          ...(customerEmail ? { email: customerEmail } : {}),
          ...(customerTaxId ? { tax_id: customerTaxId } : {}),
        }),
      },
    );
  }
  if (!customerId)
    return NextResponse.json(
      { error: "Nie udało się ustalić klienta." },
      { status: 502 },
    );

  const existingVehicleResponse = await fetch(
    `${url}/rest/v1/vehicles?select=id&organization_id=eq.${member.organizationId}&registration_number=eq.${encodeURIComponent(registration)}&limit=1`,
    { headers, cache: "no-store" },
  );
  const existingVehicles = existingVehicleResponse.ok
    ? ((await existingVehicleResponse.json()) as VehicleRow[])
    : [];
  let vehicleId = existingVehicles[0]?.id ?? null;
  if (vehicleId) {
    await fetch(
      `${url}/rest/v1/vehicles?id=eq.${vehicleId}&organization_id=eq.${member.organizationId}`,
      {
        method: "PATCH",
        headers: { ...jsonHeaders, Prefer: "return=minimal" },
        body: JSON.stringify({ brand, model }),
      },
    );
  } else {
    const createVehicle = await fetch(`${url}/rest/v1/vehicles`, {
      method: "POST",
      headers: { ...jsonHeaders, Prefer: "return=representation" },
      body: JSON.stringify({
        organization_id: member.organizationId,
        brand,
        model,
        registration_number: registration,
      }),
    });
    if (!createVehicle.ok)
      return NextResponse.json(
        { error: "Nie udało się zapisać pojazdu." },
        { status: 502 },
      );
    const created = (await createVehicle.json()) as VehicleRow[];
    vehicleId = created[0]?.id ?? null;
  }
  if (!vehicleId)
    return NextResponse.json(
      { error: "Nie udało się ustalić pojazdu." },
      { status: 502 },
    );

  // vehicle_assignments has an exclusion constraint forbidding overlapping
  // date ranges per vehicle. If an open assignment already exists, update it
  // in place instead of closing + re-inserting — closing an assignment at
  // the exact instant it started (e.g. re-saving without changing the date)
  // would create a zero-width/duplicate range and violate the constraint.
  const existingAssignmentResponse = await fetch(
    `${url}/rest/v1/vehicle_assignments?select=id,customer_id,valid_from&organization_id=eq.${member.organizationId}&vehicle_id=eq.${vehicleId}&valid_to=is.null&limit=1`,
    { headers, cache: "no-store" },
  );
  const existingAssignments = existingAssignmentResponse.ok
    ? ((await existingAssignmentResponse.json()) as Array<{ id: string; customer_id: string; valid_from: string }>)
    : [];
  const currentAssignment = existingAssignments[0] ?? null;
  const sameAssignment = currentAssignment
    && currentAssignment.customer_id === customerId
    && new Date(currentAssignment.valid_from).valueOf() === assignedAt.valueOf();
  if (currentAssignment && !sameAssignment && assignedAt <= new Date(currentAssignment.valid_from))
    return NextResponse.json(
      { error: "Nowe przypisanie musi zaczynać się po rozpoczęciu obecnego najmu. Historię wsteczną popraw przez dedykowaną edycję." },
      { status: 422 },
    );

  // Do not rewrite an open assignment: the history is needed to identify the
  // correct customer on the mandate event timestamp.
  if (currentAssignment && !sameAssignment) {
    const closeResponse = await fetch(
      `${url}/rest/v1/vehicle_assignments?id=eq.${currentAssignment.id}&organization_id=eq.${member.organizationId}`,
      {
        method: "PATCH",
        headers: { ...jsonHeaders, Prefer: "return=minimal" },
        body: JSON.stringify({ valid_to: assignedAtIso }),
      },
    );
    if (!closeResponse.ok)
      return NextResponse.json({ error: "Nie udało się zamknąć poprzedniego przypisania auta." }, { status: 502 });
  }

  const assignmentResponse = sameAssignment
    ? { ok: true }
    : await fetch(`${url}/rest/v1/vehicle_assignments`, {
        method: "POST",
        headers: { ...jsonHeaders, Prefer: "return=minimal" },
        body: JSON.stringify({
          organization_id: member.organizationId,
          vehicle_id: vehicleId,
          customer_id: customerId,
          valid_from: assignedAtIso,
          source: "manual",
          created_by: member.userId,
        }),
      });
  if (!assignmentResponse.ok) {
    const detail = await assignmentResponse.text().catch(() => "");
    console.error("vehicle_assignments write failed", assignmentResponse.status, detail);
    return NextResponse.json(
      { error: "Nie udało się przypisać klienta do pojazdu." },
      { status: 502 },
    );
  }

  return NextResponse.json({
    vehicle: {
      id: vehicleId,
      brand,
      model,
      registration,
      customer: customerName,
      assignedAt: assignedAtIso,
    },
  });
}
