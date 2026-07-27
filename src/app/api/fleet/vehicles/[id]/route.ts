import { NextResponse } from "next/server";
import { verifyMember } from "@/lib/supabase-auth";
import { adminHeaders, getSupabaseServerEnv } from "@/lib/supabase-env";

export const runtime = "nodejs";

const writeRoles = ["admin", "dispatcher", "office"] as const;

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const member = await verifyMember(request, [...writeRoles]);
  if (!member)
    return NextResponse.json({ error: "Brak dostępu." }, { status: 401 });
  const { url, secretKey } = getSupabaseServerEnv();
  if (!url || !secretKey)
    return NextResponse.json(
      { error: "Supabase nie jest skonfigurowany." },
      { status: 503 },
    );
  const headers = adminHeaders(secretKey);

  await fetch(
    `${url}/rest/v1/vehicle_assignments?organization_id=eq.${member.organizationId}&vehicle_id=eq.${encodeURIComponent(id)}`,
    { method: "DELETE", headers },
  );
  const response = await fetch(
    `${url}/rest/v1/vehicles?id=eq.${encodeURIComponent(id)}&organization_id=eq.${member.organizationId}`,
    { method: "DELETE", headers },
  );
  if (!response.ok)
    return NextResponse.json(
      { error: "Nie udało się usunąć pojazdu." },
      { status: 502 },
    );
  return NextResponse.json({ ok: true });
}
