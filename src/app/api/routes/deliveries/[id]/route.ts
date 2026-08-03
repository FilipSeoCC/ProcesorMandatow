import { NextResponse } from "next/server";
import { verifyMember } from "@/lib/supabase-auth";
import { adminHeaders, getSupabaseServerEnv } from "@/lib/supabase-env";

export const runtime = "nodejs";

export async function DELETE(
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
  const response = await fetch(
    `${url}/rest/v1/delivery_orders?id=eq.${encodeURIComponent(id)}&organization_id=eq.${member.organizationId}`,
    { method: "DELETE", headers: adminHeaders(secretKey), cache: "no-store" },
  );
  if (!response.ok) {
    // route_stops has `on delete restrict` on delivery_order_id — a delivery
    // that's already part of a saved route plan can't be silently deleted.
    const detail = await response.text().catch(() => "");
    console.error("delivery_orders delete failed", response.status, detail);
    return NextResponse.json(
      {
        error:
          "Nie udało się usunąć dostawy — jest już częścią zapisanej trasy. Usuń ją z trasy albo zacznij nowe planowanie.",
      },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true });
}
