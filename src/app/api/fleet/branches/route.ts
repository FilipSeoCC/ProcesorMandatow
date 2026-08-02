import { NextResponse } from "next/server";
import { verifyMember } from "@/lib/supabase-auth";
import { adminHeaders, getSupabaseServerEnv } from "@/lib/supabase-env";

export const runtime = "nodejs";

// Whole "Oddziały" screen is admin/boss only per Filip's ask, unlike the rest
// of fleet management which every role can touch.
const roles = ["admin", "boss"] as const;

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

type BranchRow = { id: string; name: string; address: string; phone: string; hours: string };
type VehicleRow = {
  id: string;
  brand: string;
  model: string;
  registration_number: string;
  branch_id: string | null;
};

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
  const headers = adminHeaders(secretKey);

  const [branchesResponse, vehiclesResponse] = await Promise.all([
    fetch(
      `${url}/rest/v1/branches?select=id,name,address,phone,hours&organization_id=eq.${member.organizationId}&order=name.asc`,
      { headers, cache: "no-store" },
    ),
    fetch(
      `${url}/rest/v1/vehicles?select=id,brand,model,registration_number,branch_id&organization_id=eq.${member.organizationId}&order=brand.asc`,
      { headers, cache: "no-store" },
    ),
  ]);
  if (!branchesResponse.ok || !vehiclesResponse.ok)
    return NextResponse.json(
      { error: "Nie udało się pobrać oddziałów." },
      { status: 502 },
    );
  const branches = (await branchesResponse.json()) as BranchRow[];
  const vehicles = (await vehiclesResponse.json()) as VehicleRow[];

  return NextResponse.json({
    branches,
    vehicles: vehicles.map((vehicle) => ({
      id: vehicle.id,
      label: `${vehicle.brand} ${vehicle.model} · ${vehicle.registration_number}`,
      branchId: vehicle.branch_id,
    })),
  });
}

export async function POST(request: Request) {
  const member = await verifyMember(request, [...roles]);
  if (!member)
    return NextResponse.json({ error: "Brak dostępu." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const name = text(body?.name, 120);
  const address = text(body?.address, 200);
  const phone = text(body?.phone, 40);
  const hours = text(body?.hours, 120);
  if (!name || !address)
    return NextResponse.json(
      { error: "Podaj nazwę i adres oddziału." },
      { status: 422 },
    );
  const { url, secretKey } = getSupabaseServerEnv();
  if (!url || !secretKey)
    return NextResponse.json(
      { error: "Supabase nie jest skonfigurowany." },
      { status: 503 },
    );
  const response = await fetch(`${url}/rest/v1/branches`, {
    method: "POST",
    headers: {
      ...adminHeaders(secretKey),
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      organization_id: member.organizationId,
      name,
      address,
      phone,
      hours,
    }),
  });
  if (!response.ok)
    return NextResponse.json(
      { error: "Nie udało się dodać oddziału." },
      { status: 502 },
    );
  const [created] = (await response.json()) as BranchRow[];
  return NextResponse.json({ branch: created });
}
