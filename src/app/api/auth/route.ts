import { NextResponse } from "next/server";
import { adminHeaders, getSupabaseServerEnv } from "@/lib/supabase-env";
import { verifyMember } from "@/lib/supabase-auth";
import { writeAuditEvent } from "@/lib/audit";
import { buildRegistrationReceivedEmail } from "@/lib/account-emails";

type AuthSession = {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  user?: { id?: string; email?: string };
};
const allRoles = ["admin", "boss", "user"] as const;

function setSession(response: NextResponse, session: AuthSession) {
  const common = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
  };
  response.cookies.set("ff-access", session.access_token, {
    ...common,
    maxAge: Math.max(60, session.expires_in ?? 3600),
  });
  response.cookies.set("ff-refresh", session.refresh_token, {
    ...common,
    maxAge: 60 * 60 * 24 * 30,
  });
}

// RLS hides a pending member's own row from a user-token query
// (is_org_member/has_org_role both require status='active'), so it can't
// distinguish "pending" from "no membership at all". The login gate needs
// that distinction with certainty, so it looks the row up with the admin
// key instead, bypassing RLS.
async function membershipByUserId(userId: string) {
  const { url, secretKey } = getSupabaseServerEnv();
  if (!url || !secretKey) return null;
  const response = await fetch(
    `${url}/rest/v1/organization_members?select=organization_id,role,status&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
    { headers: adminHeaders(secretKey), cache: "no-store" },
  );
  if (!response.ok) return null;
  return (
    (
      (await response.json()) as Array<{
        organization_id: string;
        role: string;
        status: string;
      }>
    )[0] ?? null
  );
}

async function sendRegistrationReceivedEmail(email: string, name: string) {
  const resendKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  if (!resendKey || !from) return;
  const mail = buildRegistrationReceivedEmail(name);
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [email], subject: mail.subject, html: mail.html, text: mail.text }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (reason) {
    console.error("Resend registration-received email failed", reason);
  }
}

async function bootstrap(accessToken: string) {
  const { url, publishableKey } = getSupabaseServerEnv();
  if (!url || !publishableKey) return { ok: false, schemaMissing: false };
  const response = await fetch(`${url}/rest/v1/rpc/bootstrap_organization`, {
    method: "POST",
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ company_name: "FlotaFlow" }),
    cache: "no-store",
  });
  return {
    ok: response.ok,
    schemaMissing: response.status === 404 || response.status === 400,
  };
}

export async function GET(request: Request) {
  const member = await verifyMember(request, [...allRoles]);
  if (!member)
    return NextResponse.json({ authenticated: false }, { status: 401 });
  return NextResponse.json({
    authenticated: true,
    role: member.role,
    organizationId: member.organizationId,
    email: member.email,
    firstName: member.firstName,
    lastName: member.lastName,
    userId: member.userId,
  });
}

export async function PATCH(request: Request) {
  const member = await verifyMember(request, [...allRoles]);
  if (!member)
    return NextResponse.json({ error: "Brak dostępu." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as {
    newPassword?: string;
    firstName?: string;
    lastName?: string;
  } | null;
  const newPassword = body?.newPassword ?? "";
  const updatingPassword = newPassword.length > 0;
  const updatingName =
    typeof body?.firstName === "string" || typeof body?.lastName === "string";
  const firstName = body?.firstName?.trim() ?? "";
  const lastName = body?.lastName?.trim() ?? "";
  if (!updatingPassword && !updatingName)
    return NextResponse.json({ error: "Brak danych do zapisania." }, { status: 422 });
  if (updatingPassword && newPassword.length < 12)
    return NextResponse.json(
      { error: "Nowe hasło musi mieć minimum 12 znaków." },
      { status: 422 },
    );
  if (updatingName && (!firstName || !lastName))
    return NextResponse.json(
      { error: "Podaj imię i nazwisko." },
      { status: 422 },
    );
  const { url, publishableKey } = getSupabaseServerEnv();
  if (!url || !publishableKey)
    return NextResponse.json(
      { error: "Usługa jest tymczasowo niedostępna. Skontaktuj się z administratorem." },
      { status: 503 },
    );
  const response = await fetch(`${url}/auth/v1/user`, {
    method: "PUT",
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${member.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...(updatingPassword ? { password: newPassword } : {}),
      // Supabase merges this into the existing user_metadata rather than
      // replacing it, so unrelated fields set at signup (phone,
      // privacy_consent_at) survive an edit that only touches the name.
      ...(updatingName ? { data: { first_name: firstName, last_name: lastName } } : {}),
    }),
    cache: "no-store",
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    return NextResponse.json(
      {
        error:
          data.msg ||
          data.error_description ||
          (updatingPassword ? "Nie udało się zmienić hasła." : "Nie udało się zapisać danych."),
      },
      { status: 400 },
    );
  }
  await writeAuditEvent({
    organizationId: member.organizationId,
    userId: member.userId,
    action: updatingPassword ? "password_changed" : "name_changed",
    entityType: "user",
    entityId: member.userId,
  });
  return NextResponse.json({ ok: true });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    action?: string;
    email?: string;
    password?: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
    consent?: boolean;
  } | null;
  const email = body?.email?.trim().toLowerCase() ?? "";
  const password = body?.password ?? "";
  const signingUp = body?.action === "sign-up";
  const minimumPasswordLength = signingUp ? 12 : 8;
  if (!/^\S+@\S+\.\S+$/.test(email))
    return NextResponse.json(
      { error: "Podaj poprawny adres e-mail." },
      { status: 422 },
    );
  if (password.length < minimumPasswordLength)
    return NextResponse.json(
      { error: `Hasło musi mieć minimum ${minimumPasswordLength} znaków.` },
      { status: 422 },
    );
  const { url, publishableKey } = getSupabaseServerEnv();
  if (!url || !publishableKey)
    return NextResponse.json(
      { error: "Usługa jest tymczasowo niedostępna. Skontaktuj się z administratorem." },
      { status: 503 },
    );

  const firstName = body?.firstName?.trim() ?? "";
  const lastName = body?.lastName?.trim() ?? "";
  const phone = body?.phone?.trim() ?? "";
  if (signingUp) {
    if (!firstName || !lastName || !phone)
      return NextResponse.json(
        { error: "Podaj imię, nazwisko i numer telefonu." },
        { status: 422 },
      );
    if (!body?.consent)
      return NextResponse.json(
        { error: "Musisz zaakceptować politykę prywatności." },
        { status: 422 },
      );
  }
  const authUrl = signingUp
    ? `${url}/auth/v1/signup`
    : `${url}/auth/v1/token?grant_type=password`;
  const authResponse = await fetch(authUrl, {
    method: "POST",
    headers: { apikey: publishableKey, "Content-Type": "application/json" },
    body: JSON.stringify(
      signingUp
        ? {
            email,
            password,
            data: {
              first_name: firstName,
              last_name: lastName,
              phone,
              privacy_consent_at: new Date().toISOString(),
            },
          }
        : { email, password },
    ),
    cache: "no-store",
  });
  const authData = (await authResponse
    .json()
    .catch(() => ({}))) as Partial<AuthSession> & {
    msg?: string;
    message?: string;
    error_description?: string;
  };
  if (!authResponse.ok)
    return NextResponse.json(
      {
        error:
          authData.msg ||
          authData.message ||
          authData.error_description ||
          "Nie udało się zalogować.",
      },
      { status: authResponse.status === 429 ? 429 : 401 },
    );
  if (!authData.access_token || !authData.refresh_token)
    // This is the branch that actually fires today (Supabase's "Confirm
    // email" is on) — it's the one real users see right after registering.
    // The wording covers both steps in one go (confirm the address, then
    // wait for approval) since the "Zatwierdzono dostęp" notice that would
    // normally explain the second step is a Resend email and RESEND_API_KEY
    // is deliberately unconfigured (see docs/stan-projektu.md — parked
    // 2026-08-02). Don't shorten this back to just "confirm your email"
    // without restoring that email first.
    return NextResponse.json(
      {
        confirmationRequired: true,
        message:
          "Dziękujemy za rejestrację w FlotaFlow! Sprawdź skrzynkę e-mail i potwierdź adres, klikając w link w wiadomości. Po potwierdzeniu poczekaj na zatwierdzenie przez administratora — dostęp uzyskasz, gdy Admin z zespołu przyzna Ci rolę w systemie :)",
      },
      { status: 202 },
    );

  const userId = authData.user?.id;
  let member = userId ? await membershipByUserId(userId) : null;
  if (!member) {
    const created = await bootstrap(authData.access_token);
    if (!created.ok)
      return NextResponse.json(
        {
          error: created.schemaMissing
            ? "Brakuje schematu aplikacji w Supabase — migracje (supabase/migrations) nie zostały zastosowane na tej bazie."
            : "Nie udało się utworzyć organizacji.",
        },
        { status: 503 },
      );
    member = userId ? await membershipByUserId(userId) : null;
  }
  if (member?.status === "pending") {
    if (signingUp) {
      await sendRegistrationReceivedEmail(email, `${firstName} ${lastName}`.trim());
      return NextResponse.json(
        {
          pendingApproval: true,
          // Doesn't promise an email channel specifically: sendRegistrationReceivedEmail
          // above is a no-op without RESEND_API_KEY (parked 2026-08-02, see
          // docs/stan-projektu.md), and this branch fires only when Supabase's own
          // "Confirm email" is off — the wording has to stay true either way.
          message:
            "Dziękujemy za rejestrację! Twoje konto czeka na zatwierdzenie przez administratora.",
        },
        { status: 202 },
      );
    }
    return NextResponse.json(
      { error: "Twoje konto czeka na zatwierdzenie roli przez administratora." },
      { status: 403 },
    );
  }
  const response = NextResponse.json({
    authenticated: true,
    role: member?.role ?? "admin",
  });
  setSession(response, authData as AuthSession);
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ authenticated: false });
  response.cookies.set("ff-access", "", { path: "/", maxAge: 0 });
  response.cookies.set("ff-refresh", "", { path: "/", maxAge: 0 });
  return response;
}
