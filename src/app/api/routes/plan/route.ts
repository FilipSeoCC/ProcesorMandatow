import { NextResponse } from "next/server";
import { verifyMember } from "@/lib/supabase-auth";
import { adminHeaders, getSupabaseServerEnv } from "@/lib/supabase-env";

export const runtime = "nodejs";

const roles = ["admin", "boss", "user"] as const;

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

type PlanRow = {
  id: string;
  start_address: string;
  start_latitude: number;
  start_longitude: number;
  optimization_source: string;
  distance_meters: number | null;
  duration_seconds: number | null;
};
type StopRow = {
  id: string;
  delivery_order_id: string;
  position: number;
  status: string;
  notes: string;
};
type DeliveryRow = {
  id: string;
  vehicle_id: string;
  customer_id: string;
  address: string;
  latitude: number;
  longitude: number;
  service_minutes: number;
};
type VehicleRow = { id: string; brand: string; model: string; registration_number: string };
type CustomerRow = { id: string; name: string };

async function loadPlanView(
  url: string,
  secretKey: string,
  organizationId: string,
  plan: PlanRow,
) {
  const headers = adminHeaders(secretKey);
  const stopsResponse = await fetch(
    `${url}/rest/v1/route_stops?select=id,delivery_order_id,position,status,notes&organization_id=eq.${organizationId}&route_plan_id=eq.${plan.id}&order=position.asc`,
    { headers, cache: "no-store" },
  );
  const stops = stopsResponse.ok ? ((await stopsResponse.json()) as StopRow[]) : [];
  const deliveryIds = stops.map((stop) => stop.delivery_order_id);
  const deliveriesResponse = deliveryIds.length
    ? await fetch(
        `${url}/rest/v1/delivery_orders?select=id,vehicle_id,customer_id,address,latitude,longitude,service_minutes&organization_id=eq.${organizationId}&id=in.(${deliveryIds.join(",")})`,
        { headers, cache: "no-store" },
      )
    : null;
  const deliveries = deliveriesResponse?.ok
    ? ((await deliveriesResponse.json()) as DeliveryRow[])
    : [];
  const deliveryById = new Map(deliveries.map((item) => [item.id, item]));
  const vehicleIds = [...new Set(deliveries.map((item) => item.vehicle_id))];
  const customerIds = [...new Set(deliveries.map((item) => item.customer_id))];
  const [vehiclesResponse, customersResponse] = await Promise.all([
    vehicleIds.length
      ? fetch(
          `${url}/rest/v1/vehicles?select=id,brand,model,registration_number&organization_id=eq.${organizationId}&id=in.(${vehicleIds.join(",")})`,
          { headers, cache: "no-store" },
        )
      : null,
    customerIds.length
      ? fetch(
          `${url}/rest/v1/customers?select=id,name&organization_id=eq.${organizationId}&id=in.(${customerIds.join(",")})`,
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

  return {
    id: plan.id,
    startAddress: plan.start_address,
    startLatitude: plan.start_latitude,
    startLongitude: plan.start_longitude,
    mode: plan.optimization_source,
    distanceKm: plan.distance_meters ? Math.round(plan.distance_meters / 1000) : 0,
    durationMinutes: plan.duration_seconds ? Math.round(plan.duration_seconds / 60) : 0,
    stops: stops.map((stop) => {
      const delivery = deliveryById.get(stop.delivery_order_id);
      const vehicle = delivery ? vehicleById.get(delivery.vehicle_id) : undefined;
      return {
        stopId: stop.id,
        deliveryId: stop.delivery_order_id,
        status: stop.status,
        notes: stop.notes,
        vehicle: vehicle
          ? `${vehicle.brand} ${vehicle.model} · ${vehicle.registration_number}`
          : "Nieznany pojazd",
        customer: delivery ? customerById.get(delivery.customer_id)?.name ?? "Nieznany klient" : "—",
        address: delivery?.address ?? "",
        latitude: delivery?.latitude ?? 0,
        longitude: delivery?.longitude ?? 0,
        serviceMinutes: delivery?.service_minutes ?? 0,
      };
    }),
  };
}

export async function GET(request: Request) {
  const member = await verifyMember(request, [...roles]);
  if (!member)
    return NextResponse.json({ error: "Brak dostępu." }, { status: 401 });
  const { url, secretKey } = getSupabaseServerEnv();
  if (!url || !secretKey)
    return NextResponse.json(
      { error: "Supabase nie jest skonfigurowany." },
      { status: 503 },
    );
  const today = new Date().toISOString().slice(0, 10);
  const planResponse = await fetch(
    `${url}/rest/v1/route_plans?select=id,start_address,start_latitude,start_longitude,optimization_source,distance_meters,duration_seconds&organization_id=eq.${member.organizationId}&planned_for=eq.${today}&status=eq.active&order=created_at.desc&limit=1`,
    { headers: adminHeaders(secretKey), cache: "no-store" },
  );
  if (!planResponse.ok)
    return NextResponse.json({ error: "Nie udało się pobrać trasy." }, { status: 502 });
  const [plan] = (await planResponse.json()) as PlanRow[];
  if (!plan) return NextResponse.json({ plan: null });
  return NextResponse.json({
    plan: await loadPlanView(url, secretKey, member.organizationId, plan),
  });
}

export async function POST(request: Request) {
  const member = await verifyMember(request, [...roles]);
  if (!member)
    return NextResponse.json({ error: "Brak dostępu." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const startAddress = text(body?.startAddress, 300);
  const startLatitude = Number(body?.startLatitude);
  const startLongitude = Number(body?.startLongitude);
  const distanceMeters = Number(body?.distanceMeters);
  const durationSeconds = Number(body?.durationSeconds);
  const optimizationSource = text(body?.optimizationSource, 20) || "manual";
  const stopOrder = Array.isArray(body?.stopOrder)
    ? (body.stopOrder as unknown[]).filter((item): item is string => typeof item === "string")
    : [];
  if (
    !startAddress ||
    !Number.isFinite(startLatitude) ||
    !Number.isFinite(startLongitude) ||
    stopOrder.length < 2
  )
    return NextResponse.json(
      { error: "Brak danych trasy lub za mało zaplanowanych dostaw." },
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
  const today = new Date().toISOString().slice(0, 10);

  // One active plan per org per day. Older ones aren't deleted (they may
  // already have delivery history on their stops) — just superseded, so GET
  // never picks them up again.
  await fetch(
    `${url}/rest/v1/route_plans?organization_id=eq.${member.organizationId}&planned_for=eq.${today}&status=eq.active`,
    {
      method: "PATCH",
      headers: { ...jsonHeaders, Prefer: "return=minimal" },
      body: JSON.stringify({ status: "superseded" }),
    },
  );

  const createPlan = await fetch(`${url}/rest/v1/route_plans`, {
    method: "POST",
    headers: { ...jsonHeaders, Prefer: "return=representation" },
    body: JSON.stringify({
      organization_id: member.organizationId,
      planned_for: today,
      dispatcher_id: member.userId,
      start_address: startAddress,
      start_latitude: startLatitude,
      start_longitude: startLongitude,
      status: "active",
      optimization_source: optimizationSource,
      distance_meters: Number.isFinite(distanceMeters) ? Math.round(distanceMeters) : null,
      duration_seconds: Number.isFinite(durationSeconds) ? Math.round(durationSeconds) : null,
    }),
  });
  if (!createPlan.ok) {
    const detail = await createPlan.text().catch(() => "");
    console.error("route_plans insert failed", createPlan.status, detail);
    return NextResponse.json({ error: "Nie udało się zapisać trasy." }, { status: 502 });
  }
  const [plan] = (await createPlan.json()) as PlanRow[];

  const createStops = await fetch(`${url}/rest/v1/route_stops`, {
    method: "POST",
    headers: { ...jsonHeaders, Prefer: "return=minimal" },
    body: JSON.stringify(
      stopOrder.map((deliveryId, index) => ({
        organization_id: member.organizationId,
        route_plan_id: plan.id,
        delivery_order_id: deliveryId,
        position: index + 1,
      })),
    ),
  });
  if (!createStops.ok) {
    const detail = await createStops.text().catch(() => "");
    console.error("route_stops insert failed", createStops.status, detail);
    // Roll back the otherwise-empty plan rather than leaving a route with no
    // stops behind for GET to trip over.
    await fetch(
      `${url}/rest/v1/route_plans?id=eq.${plan.id}&organization_id=eq.${member.organizationId}`,
      { method: "DELETE", headers },
    );
    return NextResponse.json(
      { error: "Nie udało się zapisać przystanków trasy." },
      { status: 502 },
    );
  }

  return NextResponse.json({
    plan: await loadPlanView(url, secretKey, member.organizationId, plan),
  });
}

// "Zmień dostawy" abandons the active plan without computing a new one — its
// stops just aren't superseded by a fresh POST, so without this the plan
// would silently reappear on next load even though the driver meant to start
// over. Deliveries already marked delivered/failed keep that state; only
// "planned" ones become selectable again since GET /deliveries only excludes
// delivered_at is not null.
export async function DELETE(request: Request) {
  const member = await verifyMember(request, [...roles]);
  if (!member)
    return NextResponse.json({ error: "Brak dostępu." }, { status: 401 });
  const { url, secretKey } = getSupabaseServerEnv();
  if (!url || !secretKey)
    return NextResponse.json(
      { error: "Supabase nie jest skonfigurowany." },
      { status: 503 },
    );
  const today = new Date().toISOString().slice(0, 10);
  await fetch(
    `${url}/rest/v1/route_plans?organization_id=eq.${member.organizationId}&planned_for=eq.${today}&status=eq.active`,
    {
      method: "PATCH",
      headers: {
        ...adminHeaders(secretKey),
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ status: "superseded" }),
    },
  );
  return NextResponse.json({ ok: true });
}
