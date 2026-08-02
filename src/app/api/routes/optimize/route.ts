import { NextResponse } from "next/server";
import { verifyMember } from "@/lib/supabase-auth";
import { gcpWorkloadIdentityClient } from "@/lib/gcp-oidc";

export const runtime = "nodejs";

type Point = { latitude: number; longitude: number };
type StopInput = Point & { id: string; customer: string; address: string; serviceMinutes: number; priority: number };
type OptimizeInput = { depot: Point & { address: string }; returnToDepot?: boolean; stops: StopInput[] };

function coordinate(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function valid(body: unknown): body is OptimizeInput {
  if (!body || typeof body !== "object") return false;
  const input = body as Partial<OptimizeInput>;
  if (!input.depot || !Array.isArray(input.stops) || input.stops.length < 2 || input.stops.length > 20) return false;
  if (!coordinate(input.depot.latitude, -90, 90) || !coordinate(input.depot.longitude, -180, 180)) return false;
  return input.stops.every((stop) => typeof stop?.id === "string" && stop.id.length <= 80 && typeof stop.customer === "string" && stop.customer.length <= 160 && typeof stop.address === "string" && stop.address.length <= 300 && coordinate(stop.latitude, -90, 90) && coordinate(stop.longitude, -180, 180) && Number.isFinite(stop.serviceMinutes) && stop.serviceMinutes >= 0 && stop.serviceMinutes <= 240 && Number.isFinite(stop.priority) && stop.priority >= 1 && stop.priority <= 5);
}

function distanceKm(a: Point, b: Point) {
  const radius = 6371;
  const lat = (b.latitude - a.latitude) * Math.PI / 180;
  const lon = (b.longitude - a.longitude) * Math.PI / 180;
  const x = Math.sin(lat / 2) ** 2 + Math.cos(a.latitude * Math.PI / 180) * Math.cos(b.latitude * Math.PI / 180) * Math.sin(lon / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function demo(input: OptimizeInput) {
  const remaining = [...input.stops];
  const ordered: StopInput[] = [];
  let cursor: Point = input.depot;
  let distance = 0;
  while (remaining.length) {
    remaining.sort((a, b) => distanceKm(cursor, a) - distanceKm(cursor, b) + (b.priority - a.priority) * 2);
    const next = remaining.shift()!;
    distance += distanceKm(cursor, next);
    ordered.push(next);
    cursor = next;
  }
  if (input.returnToDepot !== false) distance += distanceKm(cursor, input.depot);
  const service = ordered.reduce((sum, stop) => sum + stop.serviceMinutes, 0);
  return { mode: "demo" as const, orderedStopIds: ordered.map((stop) => stop.id), distanceKm: Math.round(distance), durationMinutes: Math.round(distance / 45 * 60) + service, skippedStopIds: [] };
}

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Nieprawidłowy JSON." }, { status: 400 }); }
  if (!valid(body)) return NextResponse.json({ error: "Podaj od 2 do 20 poprawnych punktów dostawy." }, { status: 422 });

  const audience = process.env.GOOGLE_WIF_AUDIENCE;
  const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
  if (!audience || !projectId) {
    if (process.env.ROUTE_OPTIMIZATION_DEMO_MODE === "true") return NextResponse.json(demo(body));
    return NextResponse.json({ error: "Planowanie tras nie jest skonfigurowane." }, { status: 503 });
  }
  const member = await verifyMember(request, ["admin", "boss", "user"]);
  if (!member) return NextResponse.json({ error: "Zaloguj się, aby użyć Google." }, { status: 401 });

  const now = new Date();
  const depotLocation = { latitude: body.depot.latitude, longitude: body.depot.longitude };
  const wholeSecondIso = (date: Date) => date.toISOString().replace(/\.\d+Z$/, "Z");
  const googleRequest = { model: { globalStartTime: wholeSecondIso(now), globalEndTime: wholeSecondIso(new Date(now.getTime() + 16 * 60 * 60 * 1000)), shipments: body.stops.map((stop) => ({ label: stop.id, penaltyCost: stop.priority * 1000, deliveries: [{ arrivalLocation: { latitude: stop.latitude, longitude: stop.longitude }, duration: `${stop.serviceMinutes * 60}s` }] })), vehicles: [{ label: "Wadim", startLocation: depotLocation, ...(body.returnToDepot === false ? {} : { endLocation: depotLocation }), costPerKilometer: 1, costPerTraveledHour: 25 }] }, populatePolylines: false };
  try {
    // Route Optimization API doesn't accept API keys — it requires a full
    // OAuth2/IAM principal, so we reuse the same WIF client as Document AI.
    const client = gcpWorkloadIdentityClient(audience);
    const { token } = await client.getAccessToken();
    if (!token) throw new Error("ROUTE_OPTIMIZATION_AUTH_FAILED");
    const response = await fetch(`https://routeoptimization.googleapis.com/v1/projects/${encodeURIComponent(projectId)}:optimizeTours`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(googleRequest), signal: AbortSignal.timeout(20_000), cache: "no-store" });
    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(`Google Route Optimization: ${response.status} ${errorBody.slice(0, 500)}`);
    }
    const result = await response.json() as { routes?: Array<{ visits?: Array<{ shipmentIndex?: number }>; metrics?: { travelDistanceMeters?: number; totalDuration?: string } }>; skippedShipments?: Array<{ index?: number }> };
    const route = result.routes?.[0];
    const orderedStopIds = (route?.visits ?? []).flatMap((visit) => visit.shipmentIndex === undefined ? [] : [body.stops[visit.shipmentIndex]?.id]).filter(Boolean);
    const durationSeconds = Number((route?.metrics?.totalDuration ?? "0s").replace("s", ""));
    return NextResponse.json({ mode: "google", orderedStopIds, distanceKm: Math.round((route?.metrics?.travelDistanceMeters ?? 0) / 1000), durationMinutes: Math.round(durationSeconds / 60), skippedStopIds: (result.skippedShipments ?? []).flatMap((item) => item.index === undefined ? [] : [body.stops[item.index]?.id]).filter(Boolean) });
  } catch (error) {
    console.error("Route optimization failed", error);
    return NextResponse.json({ error: "Google Route Optimization jest chwilowo niedostępny. Spróbuj ponownie." }, { status: 502 });
  }
}
