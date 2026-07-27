import { NextResponse } from "next/server";
import { verifyMember } from "@/lib/supabase-auth";
import { adminHeaders, getSupabaseServerEnv } from "@/lib/supabase-env";

const allRoles = ["admin", "dispatcher", "office", "scanner", "viewer"] as const;

export async function GET(request: Request) {
  const member = await verifyMember(request, ["admin"]);
  if (!member)
    return NextResponse.json({ error: "Brak dostępu." }, { status: 401 });
  const { url, secretKey } = getSupabaseServerEnv();
  if (!url || !secretKey)
    return NextResponse.json(
      { error: "Supabase nie jest skonfigurowany." },
      { status: 503 },
    );
  const response = await fetch(
    `${url}/rest/v1/bug_reports?select=*&organization_id=eq.${member.organizationId}&order=created_at.desc&limit=200`,
    { headers: adminHeaders(secretKey), cache: "no-store" },
  );
  if (!response.ok)
    return NextResponse.json(
      { error: "Nie udało się pobrać zgłoszeń." },
      { status: 502 },
    );
  return NextResponse.json({ reports: await response.json() });
}

export async function POST(request: Request) {
  const member = await verifyMember(request, [...allRoles]);
  if (!member)
    return NextResponse.json({ error: "Brak dostępu." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const description =
    typeof body?.description === "string" ? body.description.trim() : "";
  const context = typeof body?.context === "string" ? body.context.trim() : "";
  if (!description || description.length > 4000)
    return NextResponse.json(
      { error: "Opisz problem (maksymalnie 4000 znaków)." },
      { status: 422 },
    );
  const { url, secretKey } = getSupabaseServerEnv();
  if (!url || !secretKey)
    return NextResponse.json(
      { error: "Supabase nie jest skonfigurowany." },
      { status: 503 },
    );
  const response = await fetch(`${url}/rest/v1/bug_reports`, {
    method: "POST",
    headers: {
      ...adminHeaders(secretKey),
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      organization_id: member.organizationId,
      reporter_id: member.userId,
      reporter_email: member.email ?? "",
      description,
      context: context.slice(0, 300),
    }),
  });
  if (!response.ok)
    return NextResponse.json(
      { error: "Nie udało się wysłać zgłoszenia." },
      { status: 502 },
    );
  return NextResponse.json({ ok: true });
}
