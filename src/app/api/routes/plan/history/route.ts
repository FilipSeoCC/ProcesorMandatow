import { NextResponse } from "next/server";
import { verifyMember } from "@/lib/supabase-auth";
import { adminHeaders, getSupabaseServerEnv } from "@/lib/supabase-env";

export const runtime = "nodejs";

const roles = ["admin", "boss", "user"] as const;

type PlanRow = {
  id: string;
  planned_for: string;
  status: string;
  optimization_source: string;
  distance_meters: number | null;
  duration_seconds: number | null;
  dispatcher_id: string | null;
  assigned_user_id: string | null;
  created_at: string;
};
type StopRow = { route_plan_id: string; status: string };

// List view for "whoever planned it can check what happened during the day"
// plus a foundation for future boss-facing reporting — aggregate counts per
// plan, not the full stop-by-stop detail (that's GET .../history/[id]).
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

  const plansResponse = await fetch(
    `${url}/rest/v1/route_plans?select=id,planned_for,status,optimization_source,distance_meters,duration_seconds,dispatcher_id,assigned_user_id,created_at&organization_id=eq.${member.organizationId}&order=created_at.desc&limit=30`,
    { headers, cache: "no-store" },
  );
  if (!plansResponse.ok)
    return NextResponse.json(
      { error: "Nie udało się pobrać historii tras." },
      { status: 502 },
    );
  const plans = (await plansResponse.json()) as PlanRow[];
  if (!plans.length) return NextResponse.json({ plans: [] });

  const planIds = plans.map((plan) => plan.id);
  const stopsResponse = await fetch(
    `${url}/rest/v1/route_stops?select=route_plan_id,status&organization_id=eq.${member.organizationId}&route_plan_id=in.(${planIds.join(",")})`,
    { headers, cache: "no-store" },
  );
  const stops = stopsResponse.ok ? ((await stopsResponse.json()) as StopRow[]) : [];
  const countsByPlan = new Map<string, { total: number; delivered: number; failed: number }>();
  for (const stop of stops) {
    const counts = countsByPlan.get(stop.route_plan_id) ?? { total: 0, delivered: 0, failed: 0 };
    counts.total += 1;
    if (stop.status === "delivered") counts.delivered += 1;
    if (stop.status === "failed") counts.failed += 1;
    countsByPlan.set(stop.route_plan_id, counts);
  }

  return NextResponse.json({
    plans: plans.map((plan) => {
      const counts = countsByPlan.get(plan.id) ?? { total: 0, delivered: 0, failed: 0 };
      return {
        id: plan.id,
        plannedFor: plan.planned_for,
        status: plan.status,
        mode: plan.optimization_source,
        dispatcherId: plan.dispatcher_id,
        assignedUserId: plan.assigned_user_id,
        createdAt: plan.created_at,
        distanceKm: plan.distance_meters ? Math.round(plan.distance_meters / 1000) : 0,
        durationMinutes: plan.duration_seconds ? Math.round(plan.duration_seconds / 60) : 0,
        totalStops: counts.total,
        deliveredCount: counts.delivered,
        failedCount: counts.failed,
      };
    }),
  });
}
