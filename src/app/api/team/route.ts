import { NextResponse } from "next/server";
import { verifyMember } from "@/lib/supabase-auth";
import { adminHeaders, getSupabaseServerEnv } from "@/lib/supabase-env";
import { writeAuditEvent } from "@/lib/audit";

export const runtime = "nodejs";

const ASSIGNABLE_ROLES = new Set(["admin", "boss", "user"]);

export async function GET(request: Request) {
  // This route exposes employee names and e-mail addresses. Plain 'user'
  // accounts don't need it and it must not become an internal address book.
  const member = await verifyMember(request, ["admin", "boss"]);
  if (!member)
    return NextResponse.json({ error: "Brak dostępu." }, { status: 401 });
  const { url, secretKey } = getSupabaseServerEnv();
  if (!url || !secretKey)
    return NextResponse.json(
      { error: "Supabase nie jest skonfigurowany." },
      { status: 503 },
    );
  const adminAuthHeaders = {
    apikey: secretKey,
    Authorization: `Bearer ${secretKey}`,
  };

  const membersResponse = await fetch(
    `${url}/rest/v1/organization_members?select=user_id,role&organization_id=eq.${member.organizationId}`,
    { headers: adminAuthHeaders, cache: "no-store" },
  );
  if (!membersResponse.ok)
    return NextResponse.json(
      { error: "Nie udało się pobrać zespołu." },
      { status: 502 },
    );
  const members = (await membersResponse.json()) as Array<{
    user_id: string;
    role: string;
  }>;

  const team = await Promise.all(
    members.map(async (item) => {
      const userResponse = await fetch(
        `${url}/auth/v1/admin/users/${item.user_id}`,
        { headers: adminAuthHeaders, cache: "no-store" },
      );
      if (!userResponse.ok)
        return { userId: item.user_id, role: item.role, email: null, name: null };
      const user = (await userResponse.json()) as {
        email?: string;
        user_metadata?: { first_name?: string; last_name?: string };
      };
      const firstName = user.user_metadata?.first_name?.trim();
      const lastName = user.user_metadata?.last_name?.trim();
      const name = firstName || lastName ? `${firstName ?? ""} ${lastName ?? ""}`.trim() : null;
      return {
        userId: item.user_id,
        role: item.role,
        email: user.email ?? null,
        name,
      };
    }),
  );

  return NextResponse.json({ team });
}

export async function PATCH(request: Request) {
  const member = await verifyMember(request, ["admin", "boss"]);
  if (!member)
    return NextResponse.json({ error: "Brak dostępu." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as {
    userId?: string;
    role?: string;
  } | null;
  const targetUserId = typeof body?.userId === "string" ? body.userId : "";
  const role = typeof body?.role === "string" ? body.role : "";
  if (!targetUserId || !ASSIGNABLE_ROLES.has(role))
    return NextResponse.json(
      { error: "Podaj użytkownika i jedną z ról: admin, boss, user." },
      { status: 422 },
    );
  // Boss can grant at most boss/user — never admin, and never touch an
  // existing admin's role (demoting one would be a de facto admin action).
  // Only 'admin' manages other admins.
  if (member.role === "boss" && role === "admin")
    return NextResponse.json(
      { error: "Rola boss może nadawać najwyżej uprawnienia boss." },
      { status: 403 },
    );

  const { url, secretKey } = getSupabaseServerEnv();
  if (!url || !secretKey)
    return NextResponse.json(
      { error: "Supabase nie jest skonfigurowany." },
      { status: 503 },
    );
  const headers = adminHeaders(secretKey);

  if (member.role === "boss") {
    const targetResponse = await fetch(
      `${url}/rest/v1/organization_members?select=role&organization_id=eq.${member.organizationId}&user_id=eq.${encodeURIComponent(targetUserId)}`,
      { headers, cache: "no-store" },
    );
    const targets = targetResponse.ok
      ? ((await targetResponse.json()) as Array<{ role: string }>)
      : [];
    if (targets[0]?.role === "admin")
      return NextResponse.json(
        { error: "Rola boss nie może zmieniać uprawnień administratora." },
        { status: 403 },
      );
  }

  // Refuse to demote the last admin — otherwise a lone admin could lock
  // everyone (including themselves) out of role management permanently.
  if (targetUserId === member.userId && role !== "admin") {
    const adminsResponse = await fetch(
      `${url}/rest/v1/organization_members?select=user_id&organization_id=eq.${member.organizationId}&role=eq.admin`,
      { headers, cache: "no-store" },
    );
    const admins = adminsResponse.ok
      ? ((await adminsResponse.json()) as Array<{ user_id: string }>)
      : [];
    if (admins.length <= 1)
      return NextResponse.json(
        { error: "Nie możesz odebrać sobie roli administratora jako jedynemu adminowi." },
        { status: 422 },
      );
  }

  const response = await fetch(
    `${url}/rest/v1/organization_members?organization_id=eq.${member.organizationId}&user_id=eq.${encodeURIComponent(targetUserId)}`,
    {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ role }),
    },
  );
  if (!response.ok)
    return NextResponse.json(
      { error: "Nie udało się zmienić roli." },
      { status: 502 },
    );
  await writeAuditEvent({
    organizationId: member.organizationId,
    userId: member.userId,
    action: "member_role_changed",
    entityType: "organization_member",
    entityId: targetUserId,
    details: { role },
  });
  return NextResponse.json({ ok: true });
}
