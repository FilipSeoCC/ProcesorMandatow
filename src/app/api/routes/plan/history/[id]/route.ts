import { NextResponse } from "next/server";
import { verifyMember } from "@/lib/supabase-auth";
import { adminHeaders, getSupabaseServerEnv } from "@/lib/supabase-env";
import { loadPlanView, type PlanRow } from "@/lib/route-plan-view";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const member = await verifyMember(request, ["admin", "boss", "user"]);
  if (!member)
    return NextResponse.json({ error: "Brak dostępu." }, { status: 401 });
  const { url, secretKey } = getSupabaseServerEnv();
  if (!url || !secretKey)
    return NextResponse.json(
      { error: "Usługa jest tymczasowo niedostępna. Skontaktuj się z administratorem." },
      { status: 503 },
    );
  const planResponse = await fetch(
    `${url}/rest/v1/route_plans?select=id,start_address,start_latitude,start_longitude,optimization_source,distance_meters,duration_seconds,planned_for,status,dispatcher_id,created_at&organization_id=eq.${member.organizationId}&id=eq.${encodeURIComponent(id)}&limit=1`,
    { headers: adminHeaders(secretKey), cache: "no-store" },
  );
  if (!planResponse.ok)
    return NextResponse.json({ error: "Nie udało się pobrać trasy." }, { status: 502 });
  const [plan] = (await planResponse.json()) as PlanRow[];
  if (!plan) return NextResponse.json({ error: "Nie znaleziono trasy." }, { status: 404 });
  return NextResponse.json({
    plan: await loadPlanView(url, secretKey, member.organizationId, plan),
  });
}
