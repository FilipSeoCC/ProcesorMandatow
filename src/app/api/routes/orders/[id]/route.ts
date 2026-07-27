import { NextResponse } from "next/server";
import { verifyMember } from "@/lib/supabase-auth";
import { adminHeaders, getSupabaseServerEnv } from "@/lib/supabase-env";

export const runtime = "nodejs";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { url, secretKey } = getSupabaseServerEnv();
  if (!url || !secretKey) return NextResponse.json({ ok: true, mode: "demo" });

  const member = await verifyMember(request, ["admin", "dispatcher", "office", "scanner"]);
  if (!member) return NextResponse.json({ error: "Brak dostępu." }, { status: 401 });

  const response = await fetch(
    `${url}/rest/v1/delivery_orders?id=eq.${encodeURIComponent(id)}&organization_id=eq.${member.organizationId}`,
    {
      method: "DELETE",
      headers: { ...adminHeaders(secretKey), Prefer: "return=minimal" },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok)
    return NextResponse.json({ error: "Nie udało się usunąć dostawy." }, { status: 502 });
  return NextResponse.json({ ok: true });
}
