import { NextResponse } from "next/server";
import { verifyMember } from "@/lib/supabase-auth";
import { adminHeaders, getSupabaseServerEnv } from "@/lib/supabase-env";

export const runtime = "nodejs";

const writeRoles = ["admin", "dispatcher", "office", "scanner"] as const;
const readRoles = [...writeRoles, "viewer"] as const;

type DeliveryOrder = {
  id: string;
  vehicle: string;
  customer: string;
  address: string;
  latitude: number;
  longitude: number;
  serviceMinutes: number;
  priority: number;
};

const demoOrders: DeliveryOrder[] = [
  { id: "DST-104", vehicle: "Toyota Proace · WI 2847K", customer: "Nova Bud Sp. z o.o.", address: "Puławska 427, Warszawa", latitude: 52.1455, longitude: 21.0218, serviceMinutes: 20, priority: 4 },
  { id: "DST-105", vehicle: "Ford Transit · WW 91R2", customer: "Verto Group Sp. z o.o.", address: "Postępu 14, Warszawa", latitude: 52.1798, longitude: 20.9981, serviceMinutes: 25, priority: 3 },
  { id: "DST-106", vehicle: "Mercedes Vito · WX 5520M", customer: "ABC Instalacje", address: "Mickiewicza 22, Łomianki", latitude: 52.3342, longitude: 20.8862, serviceMinutes: 20, priority: 2 },
  { id: "DST-107", vehicle: "Renault Master · WPR 77A9", customer: "M-Projekt", address: "Sienkiewicza 31, Pruszków", latitude: 52.1692, longitude: 20.8026, serviceMinutes: 30, priority: 1 },
];

function today() {
  return new Date().toISOString().slice(0, 10);
}
function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function coordinate(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

export async function GET(request: Request) {
  const { url, secretKey } = getSupabaseServerEnv();
  if (!url || !secretKey)
    return NextResponse.json({ mode: "demo", date: today(), orders: demoOrders });

  const member = await verifyMember(request, [...readRoles]);
  if (!member) return NextResponse.json({ error: "Brak dostępu." }, { status: 401 });

  const date = new URL(request.url).searchParams.get("date") || today();
  const select =
    "id,vehicle_label,customer_name,address,latitude,longitude,service_minutes,priority";
  const response = await fetch(
    `${url}/rest/v1/delivery_orders?select=${select}&organization_id=eq.${member.organizationId}&planned_for=eq.${date}&order=created_at.asc`,
    { headers: adminHeaders(secretKey), cache: "no-store", signal: AbortSignal.timeout(10_000) },
  );
  if (!response.ok)
    return NextResponse.json({ error: "Nie udało się pobrać dostaw." }, { status: 502 });
  const rows = (await response.json()) as Array<{
    id: string;
    vehicle_label: string;
    customer_name: string;
    address: string;
    latitude: number;
    longitude: number;
    service_minutes: number;
    priority: number;
  }>;
  const orders: DeliveryOrder[] = rows.map((row) => ({
    id: row.id,
    vehicle: row.vehicle_label,
    customer: row.customer_name,
    address: row.address,
    latitude: row.latitude,
    longitude: row.longitude,
    serviceMinutes: row.service_minutes,
    priority: row.priority,
  }));
  return NextResponse.json({ mode: "supabase", date, orders });
}

export async function POST(request: Request) {
  const { url, secretKey } = getSupabaseServerEnv();
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Nieprawidłowe dane." }, { status: 422 });

  const customer = text(body.customer, 160);
  const vehicle = text(body.vehicle, 160) || "Nieprzypisany";
  const address = text(body.address, 300);
  const serviceMinutes = Number(body.serviceMinutes);
  const priority = Math.min(5, Math.max(1, Number(body.priority) || 3));
  if (!customer || !address)
    return NextResponse.json({ error: "Podaj klienta i adres dostawy." }, { status: 422 });
  if (!coordinate(body.latitude, -90, 90) || !coordinate(body.longitude, -180, 180))
    return NextResponse.json({ error: "Nieprawidłowe współrzędne adresu." }, { status: 422 });
  if (!Number.isFinite(serviceMinutes) || serviceMinutes < 0 || serviceMinutes > 240)
    return NextResponse.json(
      { error: "Czas obsługi musi być liczbą od 0 do 240 minut." },
      { status: 422 },
    );

  const shared = { vehicle, customer, address, latitude: body.latitude, longitude: body.longitude, serviceMinutes, priority };
  if (!url || !secretKey)
    return NextResponse.json({
      mode: "demo",
      order: { id: `DST-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, ...shared },
    });

  const member = await verifyMember(request, [...writeRoles]);
  if (!member) return NextResponse.json({ error: "Brak dostępu." }, { status: 401 });

  const plannedFor = text(body.plannedFor, 10) || today();
  const response = await fetch(`${url}/rest/v1/delivery_orders`, {
    method: "POST",
    headers: {
      ...adminHeaders(secretKey),
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      organization_id: member.organizationId,
      vehicle_label: vehicle,
      customer_name: customer,
      address,
      latitude: body.latitude,
      longitude: body.longitude,
      service_minutes: serviceMinutes,
      priority,
      planned_for: plannedFor,
      created_by: member.userId,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok)
    return NextResponse.json({ error: "Nie udało się zapisać dostawy." }, { status: 502 });
  const [row] = (await response.json()) as Array<{ id: string }>;
  return NextResponse.json({ mode: "supabase", order: { id: row.id, ...shared } });
}
