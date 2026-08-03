import { NextResponse } from "next/server";
import { verifyMember } from "@/lib/supabase-auth";
import { adminHeaders, getSupabaseServerEnv } from "@/lib/supabase-env";
import { normalizePlate } from "@/lib/vehicle-match";

export const runtime = "nodejs";

const readRoles = ["admin", "boss", "user"] as const;
const writeRoles = ["admin", "boss", "user"] as const;

type VehicleRow = {
  id: string;
  brand: string;
  model: string;
  registration_number: string;
};
type AssignmentRow = {
  id: string;
  vehicle_id: string;
  customer_id: string;
  valid_from: string;
  valid_to: string | null;
};
type CustomerRow = { id: string; name: string; email?: string; tax_id?: string };

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

// vehicle_assignment_no_overlap (a GiST exclusion constraint) is the thing
// actually guaranteeing no vehicle is double-booked across two customers at
// once — surface it as a real explanation instead of a generic 502 when it
// fires, since setting/extending an end date is exactly the kind of edit
// that can newly overlap a later assignment that already exists.
function isOverlapViolation(detail: string) {
  return detail.includes("23P01") || detail.includes("vehicle_assignment_no_overlap");
}

export async function GET(request: Request) {
  const member = await verifyMember(request, [...readRoles]);
  if (!member)
    return NextResponse.json({ error: "Brak dostępu." }, { status: 401 });
  const { url, secretKey } = getSupabaseServerEnv();
  if (!url || !secretKey)
    return NextResponse.json(
      { error: "Usługa jest tymczasowo niedostępna. Skontaktuj się z administratorem." },
      { status: 503 },
    );
  const headers = adminHeaders(secretKey);

  const vehiclesResponse = await fetch(
    `${url}/rest/v1/vehicles?select=id,brand,model,registration_number&organization_id=eq.${member.organizationId}&status=neq.removed&order=created_at.desc`,
    { headers, cache: "no-store" },
  );
  if (!vehiclesResponse.ok)
    return NextResponse.json(
      { error: "Nie udało się pobrać floty." },
      { status: 502 },
    );
  const vehicles = (await vehiclesResponse.json()) as VehicleRow[];

  // "Current" used to mean "open-ended" (valid_to is null). Now that an
  // assignment can have a planned end date, current has to mean "covers
  // this instant" instead — otherwise a vehicle whose contract has a known
  // end date would show its (former) customer forever, and one whose
  // contract hasn't started yet would show it too early.
  const nowIso = new Date().toISOString();
  const assignmentsResponse = await fetch(
    `${url}/rest/v1/vehicle_assignments?select=id,vehicle_id,customer_id,valid_from,valid_to&organization_id=eq.${member.organizationId}&valid_from=lte.${encodeURIComponent(nowIso)}&or=(valid_to.is.null,valid_to.gt.${encodeURIComponent(nowIso)})&order=valid_from.desc`,
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

  // Every role in the 3-role model does full fleet work now — no more
  // restricted scan-only tier that should have contact details hidden.
  const result = vehicles.map((vehicle) => {
    const assignment = assignmentByVehicle.get(vehicle.id);
    const customer = assignment ? customerById.get(assignment.customer_id) : undefined;
    return {
      id: vehicle.id,
      brand: vehicle.brand,
      model: vehicle.model,
      registration: vehicle.registration_number,
      customer: customer?.name ?? (assignment ? "" : "Flota wewnętrzna"),
      customerEmail: customer?.email ?? "",
      customerTaxId: customer?.tax_id ?? "",
      assignedAt: assignment?.valid_from ?? "",
      validTo: assignment?.valid_to ?? "",
      assignmentId: assignment?.id ?? "",
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
  const registration = normalizePlate(text(body?.registration, 15));
  const customerName = text(body?.customer, 200);
  const customerEmail = text(body?.customerEmail, 200);
  const customerTaxId = text(body?.customerTaxId, 20);
  // Set by the edit form (openEditVehicle) so the assignment being edited is
  // found by identity, not by guessing from vehicle_id+valid_from+customer.
  // That guess broke in two ways: sub-minute precision lost when a
  // datetime-local input round-trips a value that was originally created
  // with second-level precision (e.g. via CSV import), and — more
  // seriously — silently matching an unrelated CLOSED historical row that
  // happens to share the same customer+start, patching its valid_to while
  // leaving the vehicle's actual current assignment untouched. Absent
  // (add-vehicle flow, CSV/XML import) falls back to the previous heuristic
  // exactly as before.
  const assignmentId = text(body?.assignmentId, 60);
  const assignedAtRaw = text(body?.assignedAt, 40);
  const assignedAt = assignedAtRaw ? new Date(assignedAtRaw) : null;
  if (!brand || !model || !registration || !customerName || !assignedAt || Number.isNaN(assignedAt.valueOf()))
    return NextResponse.json(
      { error: "Uzupełnij wszystkie pola." },
      { status: 422 },
    );
  // Optional planned end of the agreement — leaving it blank keeps the
  // existing open-ended behavior (closed later, automatically, whenever the
  // next assignment for this vehicle starts).
  const validToRaw = text(body?.validTo, 40);
  const validTo = validToRaw ? new Date(validToRaw) : null;
  if (validToRaw && Number.isNaN(validTo?.valueOf()))
    return NextResponse.json(
      { error: "Nieprawidłowa data końca umowy." },
      { status: 422 },
    );
  if (validTo && validTo.valueOf() <= assignedAt.valueOf())
    return NextResponse.json(
      { error: "Data końca umowy musi być późniejsza niż data początku." },
      { status: 422 },
    );
  const { url, secretKey } = getSupabaseServerEnv();
  if (!url || !secretKey)
    return NextResponse.json(
      { error: "Usługa jest tymczasowo niedostępna. Skontaktuj się z administratorem." },
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

  // Compare the same way matchVehicleCustomer does, not by exact string: rows
  // written before plates were normalized (and CSV imports with a space or
  // dash) would otherwise miss here and create a second vehicle for the same
  // car — which also splits its assignment history in two.
  const existingVehicleResponse = await fetch(
    `${url}/rest/v1/vehicles?select=id,registration_number&organization_id=eq.${member.organizationId}`,
    { headers, cache: "no-store" },
  );
  const existingVehicles = existingVehicleResponse.ok
    ? ((await existingVehicleResponse.json()) as VehicleRow[])
    : [];
  let vehicleId =
    existingVehicles.find(
      (item) => normalizePlate(item.registration_number ?? "") === registration,
    )?.id ?? null;
  if (vehicleId) {
    await fetch(
      `${url}/rest/v1/vehicles?id=eq.${vehicleId}&organization_id=eq.${member.organizationId}`,
      {
        method: "PATCH",
        headers: { ...jsonHeaders, Prefer: "return=minimal" },
        body: JSON.stringify({ brand, model, status: "active" }),
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
  // date ranges per vehicle. Two lookups, not one, now that an assignment
  // can already have a planned end date at creation time:
  //  - "same start" finds the row this form submission is actually editing.
  //    When the edit form supplied assignmentId, look it up by id — exact
  //    identity, immune to the two ways matching by valid_from used to
  //    break: sub-minute precision lost when a datetime-local input
  //    round-trips a value originally created with second-level precision
  //    (e.g. CSV import), and silently matching an unrelated CLOSED
  //    historical row that happens to share the same customer+start.
  //    Without an assignmentId (add-vehicle flow, CSV/XML import, which
  //    never has one to send), fall back to the original valid_from match.
  //  - "open" finds a still-ongoing (no end date) assignment that needs to
  //    be auto-closed because a genuinely different assignment is starting
  //    now — unaffected by the above, and deliberately still scoped to
  //    valid_to=is.null: an assignment that already has a planned end
  //    doesn't need auto-closing, it already knows when it ends.
  // Without an assignmentId (CSV/XML import, which never has one), the
  // valid_from match is also restricted to rows that are still active or
  // open (not already closed) — otherwise a re-imported row whose date
  // happens to equal some unrelated, long-closed historical assignment's
  // start would get silently "matched" and have that dead row's valid_to
  // patched, while the vehicle's real current assignment stays untouched
  // with no error raised anywhere.
  const nowIso = new Date().toISOString();
  const [sameStartResponse, openResponse] = await Promise.all([
    fetch(
      assignmentId
        ? `${url}/rest/v1/vehicle_assignments?select=id,customer_id,valid_from,valid_to&organization_id=eq.${member.organizationId}&vehicle_id=eq.${vehicleId}&id=eq.${encodeURIComponent(assignmentId)}&limit=1`
        : `${url}/rest/v1/vehicle_assignments?select=id,customer_id,valid_from,valid_to&organization_id=eq.${member.organizationId}&vehicle_id=eq.${vehicleId}&valid_from=eq.${encodeURIComponent(assignedAtIso)}&or=(valid_to.is.null,valid_to.gt.${encodeURIComponent(nowIso)})&limit=1`,
      { headers, cache: "no-store" },
    ),
    fetch(
      `${url}/rest/v1/vehicle_assignments?select=id,valid_from&organization_id=eq.${member.organizationId}&vehicle_id=eq.${vehicleId}&valid_to=is.null&limit=1`,
      { headers, cache: "no-store" },
    ),
  ]);
  const sameStartRows = sameStartResponse.ok
    ? ((await sameStartResponse.json()) as Array<{ id: string; customer_id: string; valid_from: string; valid_to: string | null }>)
    : [];
  const assignmentAtThisStart = sameStartRows[0] ?? null;
  const sameAssignment = assignmentAtThisStart && assignmentAtThisStart.customer_id === customerId;
  const validToIso = validTo ? validTo.toISOString() : null;

  if (sameAssignment) {
    // Editing the assignment that's already in place (same vehicle, same
    // customer, same start) — only its end date can have changed. Compare
    // as dates, not raw strings: Postgres's "+00:00" and JS's toISOString()
    // "Z" suffix represent the same instant but never compare equal as text.
    const storedValidTo = assignmentAtThisStart.valid_to
      ? new Date(assignmentAtThisStart.valid_to).valueOf()
      : null;
    const nextValidTo = validTo ? validTo.valueOf() : null;
    if (storedValidTo !== nextValidTo) {
      const updateResponse = await fetch(
        `${url}/rest/v1/vehicle_assignments?id=eq.${assignmentAtThisStart.id}&organization_id=eq.${member.organizationId}`,
        {
          method: "PATCH",
          headers: { ...jsonHeaders, Prefer: "return=minimal" },
          body: JSON.stringify({ valid_to: validToIso }),
        },
      );
      if (!updateResponse.ok) {
        const detail = await updateResponse.text().catch(() => "");
        console.error("vehicle_assignments valid_to update failed", updateResponse.status, detail);
        return NextResponse.json(
          {
            error: isOverlapViolation(detail)
              ? "Ten pojazd ma już przypisanie w tym okresie. Skróć zakres albo popraw kolidujące przypisanie."
              : "Nie udało się zapisać daty końca umowy.",
          },
          { status: isOverlapViolation(detail) ? 422 : 502 },
        );
      }
    }
    return NextResponse.json({
      vehicle: { id: vehicleId, brand, model, registration, customer: customerName, assignedAt: assignedAtIso, validTo: validToIso ?? "" },
    });
  }

  if (assignmentId && assignmentAtThisStart) {
    // A specific row was identified (the edit form sent its id) but the
    // customer differs — a genuine reassignment, not an edit. Close that
    // exact row instead of falling back to the generic "any open
    // assignment" guess below: this correctly handles reassigning a
    // BOUNDED assignment too, which that heuristic can't see at all
    // (it's scoped to valid_to IS NULL).
    if (assignedAt.valueOf() <= new Date(assignmentAtThisStart.valid_from).valueOf())
      return NextResponse.json(
        { error: "Nowa data startu musi być późniejsza niż początek zamykanego przypisania." },
        { status: 422 },
      );
    const closeKnownResponse = await fetch(
      `${url}/rest/v1/vehicle_assignments?id=eq.${assignmentAtThisStart.id}&organization_id=eq.${member.organizationId}`,
      {
        method: "PATCH",
        headers: { ...jsonHeaders, Prefer: "return=minimal" },
        body: JSON.stringify({ valid_to: assignedAtIso }),
      },
    );
    if (!closeKnownResponse.ok) {
      const detail = await closeKnownResponse.text().catch(() => "");
      console.error("vehicle_assignments close-by-id failed", closeKnownResponse.status, detail);
      return NextResponse.json(
        {
          error: isOverlapViolation(detail)
            ? "Ten pojazd ma już przypisanie w tym okresie. Skróć zakres albo popraw kolidujące przypisanie."
            : "Nie udało się zamknąć poprzedniego przypisania auta.",
        },
        { status: isOverlapViolation(detail) ? 422 : 502 },
      );
    }
  } else {
    const existingOpenAssignments = openResponse.ok
      ? ((await openResponse.json()) as Array<{ id: string; valid_from: string }>)
      : [];
    const openAssignment = existingOpenAssignments[0] ?? null;
    if (openAssignment && assignedAt <= new Date(openAssignment.valid_from))
      return NextResponse.json(
        { error: "Nowe przypisanie musi zaczynać się po rozpoczęciu obecnego najmu. Historię wsteczną popraw przez dedykowaną edycję." },
        { status: 422 },
      );

    // Do not rewrite an open assignment: the history is needed to identify
    // the correct customer on the mandate event timestamp.
    if (openAssignment) {
      const closeResponse = await fetch(
        `${url}/rest/v1/vehicle_assignments?id=eq.${openAssignment.id}&organization_id=eq.${member.organizationId}`,
        {
          method: "PATCH",
          headers: { ...jsonHeaders, Prefer: "return=minimal" },
          body: JSON.stringify({ valid_to: assignedAtIso }),
        },
      );
      if (!closeResponse.ok) {
        const detail = await closeResponse.text().catch(() => "");
        console.error("vehicle_assignments close failed", closeResponse.status, detail);
        return NextResponse.json(
          {
            error: isOverlapViolation(detail)
              ? "Ten pojazd ma już przypisanie w tym okresie. Skróć zakres albo popraw kolidujące przypisanie."
              : "Nie udało się zamknąć poprzedniego przypisania auta.",
          },
          { status: isOverlapViolation(detail) ? 422 : 502 },
        );
      }
    }
  }

  const assignmentResponse = await fetch(`${url}/rest/v1/vehicle_assignments`, {
        method: "POST",
        headers: { ...jsonHeaders, Prefer: "return=minimal" },
        body: JSON.stringify({
          organization_id: member.organizationId,
          vehicle_id: vehicleId,
          customer_id: customerId,
          valid_from: assignedAtIso,
          valid_to: validToIso,
          source: "manual",
          created_by: member.userId,
        }),
      });
  if (!assignmentResponse.ok) {
    const detail = await assignmentResponse.text().catch(() => "");
    console.error("vehicle_assignments write failed", assignmentResponse.status, detail);
    if (isOverlapViolation(detail))
      return NextResponse.json(
        { error: "Ten pojazd ma już przypisanie w tym okresie. Skróć zakres albo popraw kolidujące przypisanie." },
        { status: 422 },
      );
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
      validTo: validToIso ?? "",
    },
  });
}
