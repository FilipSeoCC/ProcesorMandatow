import { NextResponse } from "next/server";
import { verifyMember } from "@/lib/supabase-auth";
import { adminHeaders, getSupabaseServerEnv } from "@/lib/supabase-env";

export const runtime = "nodejs";

const writeRoles = ["admin", "dispatcher", "office", "scanner"] as const;

type StopInput = { deliveryOrderId: string; position: number };
type StopRef = { deliveryOrderId: string; stopId: string };

function today() {
  return new Date().toISOString().slice(0, 10);
}
function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function coordinate(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}
function positiveInt(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const stops: unknown[] | null = Array.isArray(body?.stops) ? body.stops : null;
  const startAddress = text(body?.startAddress, 300);
  if (!stops || stops.length === 0 || !startAddress)
    return NextResponse.json({ error: "Podaj punkt startowy i przystanki trasy." }, { status: 422 });
  if (!coordinate(body?.startLatitude, -90, 90) || !coordinate(body?.startLongitude, -180, 180))
    return NextResponse.json({ error: "Nieprawidłowe współrzędne startu." }, { status: 422 });

  const parsedStops: StopInput[] = [];
  for (const raw of stops) {
    const candidate = raw as Record<string, unknown>;
    const deliveryOrderId = text(candidate?.deliveryOrderId, 80);
    if (!deliveryOrderId || !positiveInt(candidate?.position))
      return NextResponse.json({ error: "Nieprawidłowa lista przystanków." }, { status: 422 });
    parsedStops.push({ deliveryOrderId, position: candidate.position as number });
  }

  const { url, secretKey } = getSupabaseServerEnv();
  if (!url || !secretKey)
    return NextResponse.json({
      mode: "demo",
      planId: `demo-plan-${crypto.randomUUID()}`,
      stops: parsedStops.map((stop): StopRef => ({ deliveryOrderId: stop.deliveryOrderId, stopId: `demo-stop-${stop.deliveryOrderId}` })),
    });

  const member = await verifyMember(request, [...writeRoles]);
  if (!member) return NextResponse.json({ error: "Brak dostępu." }, { status: 401 });

  const headers = adminHeaders(secretKey);
  const planResponse = await fetch(`${url}/rest/v1/route_plans`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({
      organization_id: member.organizationId,
      planned_for: text(body?.plannedFor, 10) || today(),
      dispatcher_id: member.userId,
      start_address: startAddress,
      start_latitude: body.startLatitude,
      start_longitude: body.startLongitude,
      status: "active",
      optimization_source: text(body?.optimizationSource, 20) || "manual",
      distance_meters: Number.isFinite(body?.distanceMeters) ? body.distanceMeters : null,
      duration_seconds: Number.isFinite(body?.durationSeconds) ? body.durationSeconds : null,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!planResponse.ok) return NextResponse.json({ error: "Nie udało się zapisać planu trasy." }, { status: 502 });
  const [plan] = (await planResponse.json()) as Array<{ id: string }>;

  const stopsResponse = await fetch(`${url}/rest/v1/route_stops`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(
      parsedStops.map((stop) => ({
        organization_id: member.organizationId,
        route_plan_id: plan.id,
        delivery_order_id: stop.deliveryOrderId,
        position: stop.position,
        status: "planned",
      })),
    ),
    signal: AbortSignal.timeout(10_000),
  });
  if (!stopsResponse.ok) return NextResponse.json({ error: "Nie udało się zapisać przystanków trasy." }, { status: 502 });
  const rows = (await stopsResponse.json()) as Array<{ id: string; delivery_order_id: string }>;

  return NextResponse.json({
    mode: "supabase",
    planId: plan.id,
    stops: rows.map((row): StopRef => ({ deliveryOrderId: row.delivery_order_id, stopId: row.id })),
  });
}
