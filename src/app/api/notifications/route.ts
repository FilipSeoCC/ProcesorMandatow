import { NextResponse } from "next/server";
import { verifyMember } from "@/lib/supabase-auth";
import { adminHeaders, getSupabaseServerEnv } from "@/lib/supabase-env";

export const runtime = "nodejs";

// Only bug reports feed the bell right now, and only admin can see those
// (matches /api/bug-reports). If another notification source is added later,
// this stays a single shared "last opened the bell" mark rather than one per
// source — simpler "mark all as read" semantics.
const roles = ["admin"] as const;

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
  const response = await fetch(
    `${url}/rest/v1/organization_members?select=notifications_seen_at&organization_id=eq.${member.organizationId}&user_id=eq.${member.userId}&limit=1`,
    { headers: adminHeaders(secretKey), cache: "no-store" },
  );
  const [row] = response.ok
    ? ((await response.json()) as { notifications_seen_at: string | null }[])
    : [];
  return NextResponse.json({ seenAt: row?.notifications_seen_at ?? null });
}

export async function POST(request: Request) {
  const member = await verifyMember(request, [...roles]);
  if (!member)
    return NextResponse.json({ error: "Brak dostępu." }, { status: 401 });
  const { url, secretKey } = getSupabaseServerEnv();
  if (!url || !secretKey)
    return NextResponse.json(
      { error: "Usługa jest tymczasowo niedostępna. Skontaktuj się z administratorem." },
      { status: 503 },
    );
  const seenAt = new Date().toISOString();
  const response = await fetch(
    `${url}/rest/v1/organization_members?organization_id=eq.${member.organizationId}&user_id=eq.${member.userId}`,
    {
      method: "PATCH",
      headers: {
        ...adminHeaders(secretKey),
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ notifications_seen_at: seenAt }),
    },
  );
  if (!response.ok)
    return NextResponse.json(
      { error: "Nie udało się zapisać powiadomień jako przeczytanych." },
      { status: 502 },
    );
  return NextResponse.json({ seenAt });
}
