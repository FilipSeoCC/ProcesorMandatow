import { NextResponse } from "next/server";
import { verifyMember } from "@/lib/supabase-auth";
import { adminHeaders, getSupabaseServerEnv } from "@/lib/supabase-env";

export const runtime = "nodejs";

const roles = ["admin", "boss", "user"] as const;

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function isoTimestampOrNull(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  return Number.isNaN(Date.parse(value)) ? undefined : value;
}

type DeliveryRow = {
  id: string;
  vehicle_id: string;
  customer_id: string;
  address: string;
  latitude: number;
  longitude: number;
  service_minutes: number;
  priority: number;
  window_start: string | null;
  window_end: string | null;
};
type VehicleRow = { id: string; brand: string; model: string; registration_number: string };
type CustomerRow = { id: string; name: string; email?: string };

export async function GET(request: Request) {
  const member = await verifyMember(request, [...roles]);
  if (!member)
    return NextResponse.json({ error: "Brak dostępu." }, { status: 401 });
  const { url, secretKey } = getSupabaseServerEnv();
  if (!url || !secretKey)
    return NextResponse.json(
      { error: "Usługa jest tymczasowo niedostępna. Skontaktuj się z administratorem." },
      { status: 503 },
    );
  const headers = adminHeaders(secretKey);

  // delivered_at is null: still needs planning. A failed attempt leaves it
  // null on purpose — the delivery is retryable, not done.
  const deliveriesResponse = await fetch(
    `${url}/rest/v1/delivery_orders?select=id,vehicle_id,customer_id,address,latitude,longitude,service_minutes,priority,window_start,window_end&organization_id=eq.${member.organizationId}&delivered_at=is.null&order=created_at.asc`,
    { headers, cache: "no-store" },
  );
  if (!deliveriesResponse.ok)
    return NextResponse.json(
      { error: "Nie udało się pobrać dostaw." },
      { status: 502 },
    );
  const deliveries = (await deliveriesResponse.json()) as DeliveryRow[];

  const vehicleIds = [...new Set(deliveries.map((item) => item.vehicle_id))];
  const customerIds = [...new Set(deliveries.map((item) => item.customer_id))];
  const [vehiclesResponse, customersResponse] = await Promise.all([
    vehicleIds.length
      ? fetch(
          `${url}/rest/v1/vehicles?select=id,brand,model,registration_number&organization_id=eq.${member.organizationId}&id=in.(${vehicleIds.join(",")})`,
          { headers, cache: "no-store" },
        )
      : null,
    customerIds.length
      ? fetch(
          `${url}/rest/v1/customers?select=id,name&organization_id=eq.${member.organizationId}&id=in.(${customerIds.join(",")})`,
          { headers, cache: "no-store" },
        )
      : null,
  ]);
  const vehicleById = new Map(
    vehiclesResponse?.ok
      ? ((await vehiclesResponse.json()) as VehicleRow[]).map((item) => [item.id, item])
      : [],
  );
  const customerById = new Map(
    customersResponse?.ok
      ? ((await customersResponse.json()) as CustomerRow[]).map((item) => [item.id, item])
      : [],
  );

  return NextResponse.json({
    deliveries: deliveries.map((item) => {
      const vehicle = vehicleById.get(item.vehicle_id);
      return {
        id: item.id,
        vehicleId: item.vehicle_id,
        vehicle: vehicle
          ? `${vehicle.brand} ${vehicle.model} · ${vehicle.registration_number}`
          : "Nieznany pojazd",
        customer: customerById.get(item.customer_id)?.name ?? "Nieznany klient",
        address: item.address,
        latitude: item.latitude,
        longitude: item.longitude,
        serviceMinutes: item.service_minutes,
        priority: item.priority,
        windowStart: item.window_start,
        windowEnd: item.window_end,
      };
    }),
  });
}

export async function POST(request: Request) {
  const member = await verifyMember(request, [...roles]);
  if (!member)
    return NextResponse.json({ error: "Brak dostępu." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const vehicleId = text(body?.vehicleId, 64);
  const customerName = text(body?.customer, 200);
  const address = text(body?.address, 300);
  const latitude = Number(body?.latitude);
  const longitude = Number(body?.longitude);
  const serviceMinutes = Number(body?.serviceMinutes);
  const priority = Number(body?.priority);
  const windowStart = isoTimestampOrNull(body?.windowStart);
  const windowEnd = isoTimestampOrNull(body?.windowEnd);
  if (
    !vehicleId ||
    !customerName ||
    !address ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    !Number.isFinite(serviceMinutes) ||
    serviceMinutes < 0 ||
    serviceMinutes > 240 ||
    windowStart === undefined ||
    windowEnd === undefined ||
    (windowStart && windowEnd && Date.parse(windowStart) > Date.parse(windowEnd))
  )
    return NextResponse.json(
      { error: "Uzupełnij pojazd, klienta, adres i czas obsługi." },
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

  const vehicleResponse = await fetch(
    `${url}/rest/v1/vehicles?select=id&organization_id=eq.${member.organizationId}&id=eq.${encodeURIComponent(vehicleId)}&limit=1`,
    { headers, cache: "no-store" },
  );
  const vehicles = vehicleResponse.ok ? ((await vehicleResponse.json()) as { id: string }[]) : [];
  if (!vehicles.length)
    return NextResponse.json(
      { error: "Nie znaleziono wybranego pojazdu we flocie." },
      { status: 422 },
    );

  // Same find-or-create pattern as /api/fleet/vehicles: a delivery names a
  // customer by free text, but the table needs a real customer_id.
  const existingCustomerResponse = await fetch(
    `${url}/rest/v1/customers?select=id&organization_id=eq.${member.organizationId}&name=eq.${encodeURIComponent(customerName)}&limit=1`,
    { headers, cache: "no-store" },
  );
  const existingCustomers = existingCustomerResponse.ok
    ? ((await existingCustomerResponse.json()) as { id: string }[])
    : [];
  let customerId = existingCustomers[0]?.id ?? null;
  if (!customerId) {
    const createCustomer = await fetch(`${url}/rest/v1/customers`, {
      method: "POST",
      headers: { ...jsonHeaders, Prefer: "return=representation" },
      body: JSON.stringify({ organization_id: member.organizationId, name: customerName }),
    });
    if (!createCustomer.ok)
      return NextResponse.json({ error: "Nie udało się utworzyć klienta." }, { status: 502 });
    const created = (await createCustomer.json()) as { id: string }[];
    customerId = created[0]?.id ?? null;
  }
  if (!customerId)
    return NextResponse.json({ error: "Nie udało się ustalić klienta." }, { status: 502 });

  const createDelivery = await fetch(`${url}/rest/v1/delivery_orders`, {
    method: "POST",
    headers: { ...jsonHeaders, Prefer: "return=representation" },
    body: JSON.stringify({
      organization_id: member.organizationId,
      vehicle_id: vehicleId,
      customer_id: customerId,
      address,
      latitude,
      longitude,
      service_minutes: Math.round(serviceMinutes),
      priority: Math.min(5, Math.max(1, Math.round(priority) || 3)),
      window_start: windowStart,
      window_end: windowEnd,
    }),
  });
  if (!createDelivery.ok) {
    const detail = await createDelivery.text().catch(() => "");
    console.error("delivery_orders insert failed", createDelivery.status, detail);
    return NextResponse.json({ error: "Nie udało się dodać dostawy." }, { status: 502 });
  }
  const [created] = (await createDelivery.json()) as { id: string }[];
  return NextResponse.json({ id: created.id });
}
