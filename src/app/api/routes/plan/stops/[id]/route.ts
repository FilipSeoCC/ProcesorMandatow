import { NextResponse } from "next/server";
import { verifyMember } from "@/lib/supabase-auth";
import { adminHeaders, getSupabaseServerEnv } from "@/lib/supabase-env";

export const runtime = "nodejs";

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const member = await verifyMember(request, ["admin", "boss", "user"]);
  if (!member)
    return NextResponse.json({ error: "Brak dostępu." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const status = text(body?.status, 20);
  const notes = text(body?.notes, 300);
  if (status !== "delivered" && status !== "failed")
    return NextResponse.json({ error: "Nieprawidłowy status przystanku." }, { status: 422 });

  const { url, secretKey } = getSupabaseServerEnv();
  if (!url || !secretKey)
    return NextResponse.json(
      { error: "Supabase nie jest skonfigurowany." },
      { status: 503 },
    );
  const headers = adminHeaders(secretKey);
  const jsonHeaders = { ...headers, "Content-Type": "application/json" };

  const updateStop = await fetch(
    `${url}/rest/v1/route_stops?id=eq.${encodeURIComponent(id)}&organization_id=eq.${member.organizationId}`,
    {
      method: "PATCH",
      headers: { ...jsonHeaders, Prefer: "return=representation" },
      body: JSON.stringify({ status, notes, completed_at: new Date().toISOString() }),
    },
  );
  if (!updateStop.ok)
    return NextResponse.json({ error: "Nie udało się zapisać statusu przystanku." }, { status: 502 });
  const [stop] = (await updateStop.json()) as { delivery_order_id: string }[];
  if (!stop)
    return NextResponse.json({ error: "Nie znaleziono przystanku." }, { status: 404 });

  if (status === "delivered") {
    const markDelivered = await fetch(
      `${url}/rest/v1/delivery_orders?id=eq.${stop.delivery_order_id}&organization_id=eq.${member.organizationId}`,
      {
        method: "PATCH",
        headers: { ...jsonHeaders, Prefer: "return=minimal" },
        body: JSON.stringify({ delivered_at: new Date().toISOString() }),
      },
    );
    if (!markDelivered.ok)
      console.error("delivery_orders delivered_at update failed", markDelivered.status);
  }

  return NextResponse.json({ ok: true });
}
