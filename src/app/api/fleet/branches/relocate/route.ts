import { NextResponse } from "next/server";
import { verifyMember } from "@/lib/supabase-auth";
import { adminHeaders, getSupabaseServerEnv } from "@/lib/supabase-env";

export const runtime = "nodejs";

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request) {
  const member = await verifyMember(request, ["admin", "boss"]);
  if (!member)
    return NextResponse.json({ error: "Brak dostępu." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const vehicleId = text(body?.vehicleId, 64);
  const branchId = text(body?.branchId, 64);
  if (!vehicleId || !branchId)
    return NextResponse.json(
      { error: "Wybierz pojazd i oddział docelowy." },
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

  const vehicleResponse = await fetch(
    `${url}/rest/v1/vehicles?select=id,branch_id&organization_id=eq.${member.organizationId}&id=eq.${encodeURIComponent(vehicleId)}&limit=1`,
    { headers, cache: "no-store" },
  );
  const [vehicle] = vehicleResponse.ok
    ? ((await vehicleResponse.json()) as { id: string; branch_id: string | null }[])
    : [];
  if (!vehicle)
    return NextResponse.json({ error: "Nie znaleziono pojazdu." }, { status: 404 });
  if (vehicle.branch_id === branchId)
    return NextResponse.json({ ok: true });

  const updateVehicle = await fetch(
    `${url}/rest/v1/vehicles?id=eq.${vehicleId}&organization_id=eq.${member.organizationId}`,
    {
      method: "PATCH",
      headers: { ...jsonHeaders, Prefer: "return=minimal" },
      body: JSON.stringify({ branch_id: branchId }),
    },
  );
  if (!updateVehicle.ok)
    return NextResponse.json(
      { error: "Nie udało się przenieść pojazdu." },
      { status: 502 },
    );

  await fetch(`${url}/rest/v1/vehicle_relocations`, {
    method: "POST",
    headers: { ...jsonHeaders, Prefer: "return=minimal" },
    body: JSON.stringify({
      organization_id: member.organizationId,
      vehicle_id: vehicleId,
      from_branch_id: vehicle.branch_id,
      to_branch_id: branchId,
      relocated_by: member.userId,
    }),
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
