import { NextResponse } from "next/server";
import { verifyMember } from "@/lib/supabase-auth";
import { adminHeaders, getSupabaseServerEnv } from "@/lib/supabase-env";
import { writeAuditEvent } from "@/lib/audit";
import { buildRoleGrantedEmail } from "@/lib/account-emails";

async function sendRoleGrantedEmail(email: string, name: string, role: string, appUrl: string) {
  const resendKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  if (!resendKey || !from) return;
  const mail = buildRoleGrantedEmail(name, role, appUrl);
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [email], subject: mail.subject, html: mail.html, text: mail.text }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (reason) {
    console.error("Resend role-granted email failed", reason);
  }
}

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
    `${url}/rest/v1/organization_members?select=user_id,role,status&organization_id=eq.${member.organizationId}`,
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
    status: string;
  }>;

  const team = await Promise.all(
    members.map(async (item) => {
      const userResponse = await fetch(
        `${url}/auth/v1/admin/users/${item.user_id}`,
        { headers: adminAuthHeaders, cache: "no-store" },
      );
      if (!userResponse.ok)
        return { userId: item.user_id, role: item.role, status: item.status, email: null, name: null };
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
        status: item.status,
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

  const targetResponse = await fetch(
    `${url}/rest/v1/organization_members?select=role,status&organization_id=eq.${member.organizationId}&user_id=eq.${encodeURIComponent(targetUserId)}`,
    { headers, cache: "no-store" },
  );
  const targets = targetResponse.ok
    ? ((await targetResponse.json()) as Array<{ role: string; status: string }>)
    : [];
  const targetWasPending = targets[0]?.status === "pending";

  if (member.role === "boss" && targets[0]?.role === "admin")
    return NextResponse.json(
      { error: "Rola boss nie może zmieniać uprawnień administratora." },
      { status: 403 },
    );

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
      // Assigning a role IS the approval action for a pending account — no
      // separate "approve" step, matching Filip's ask that admin/boss grant
      // access and a role in one move.
      body: JSON.stringify({ role, status: "active" }),
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
  if (targetWasPending) {
    const userResponse = await fetch(`${url}/auth/v1/admin/users/${targetUserId}`, {
      headers,
      cache: "no-store",
    });
    if (userResponse.ok) {
      const user = (await userResponse.json()) as {
        email?: string;
        user_metadata?: { first_name?: string; last_name?: string };
      };
      if (user.email) {
        const name = [user.user_metadata?.first_name, user.user_metadata?.last_name]
          .filter(Boolean)
          .join(" ")
          .trim();
        const appUrl = process.env.APP_URL?.trim() || new URL(request.url).origin;
        await sendRoleGrantedEmail(user.email, name, role, appUrl);
      }
    }
  }
  return NextResponse.json({ ok: true });
}
