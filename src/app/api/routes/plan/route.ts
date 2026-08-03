import { NextResponse } from "next/server";
import { verifyMember } from "@/lib/supabase-auth";
import { adminHeaders, getSupabaseServerEnv } from "@/lib/supabase-env";
import { loadPlanView, type PlanRow } from "@/lib/route-plan-view";

export const runtime = "nodejs";

const roles = ["admin", "boss", "user"] as const;

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

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
      { error: "Usługa jest tymczasowo niedostępna. Skontaktuj się z administratorem." },
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
      { error: "Usługa jest tymczasowo niedostępna. Skontaktuj się z administratorem." },
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
