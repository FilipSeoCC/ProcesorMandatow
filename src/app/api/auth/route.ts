import { NextResponse } from "next/server";
import { getSupabaseServerEnv } from "@/lib/supabase-env";
import { verifyMember } from "@/lib/supabase-auth";
import { writeAuditEvent } from "@/lib/audit";

type AuthSession = {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  user?: { email?: string };
};
const allRoles = [
  "admin",
  "dispatcher",
  "office",
  "scanner",
  "viewer",
] as const;

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

async function membership(accessToken: string) {
  const { url, publishableKey } = getSupabaseServerEnv();
  if (!url || !publishableKey) return null;
  const response = await fetch(
    `${url}/rest/v1/organization_members?select=organization_id,role&limit=1`,
    {
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
    },
  );
  if (!response.ok) return null;
  return (
    (
      (await response.json()) as Array<{
        organization_id: string;
        role: string;
      }>
    )[0] ?? null
  );
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
  } | null;
  const newPassword = body?.newPassword ?? "";
  if (newPassword.length < 12)
    return NextResponse.json(
      { error: "Nowe hasło musi mieć minimum 12 znaków." },
      { status: 422 },
    );
  const { url, publishableKey } = getSupabaseServerEnv();
  if (!url || !publishableKey)
    return NextResponse.json(
      { error: "Supabase nie jest skonfigurowany." },
      { status: 503 },
    );
  const response = await fetch(`${url}/auth/v1/user`, {
    method: "PUT",
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${member.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password: newPassword }),
    cache: "no-store",
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    return NextResponse.json(
      { error: data.msg || data.error_description || "Nie udało się zmienić hasła." },
      { status: 400 },
    );
  }
  await writeAuditEvent({
    organizationId: member.organizationId,
    userId: member.userId,
    action: "password_changed",
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
  if (!/^\S+@\S+\.\S+$/.test(email) || password.length < minimumPasswordLength)
    return NextResponse.json(
      { error: `Podaj poprawny e-mail i hasło mające minimum ${minimumPasswordLength} znaków.` },
      { status: 422 },
    );
  const { url, publishableKey } = getSupabaseServerEnv();
  if (!url || !publishableKey)
    return NextResponse.json(
      { error: "Supabase nie jest skonfigurowany." },
      { status: 503 },
    );

  const firstName = body?.firstName?.trim() ?? "";
  const lastName = body?.lastName?.trim() ?? "";
  const phone = body?.phone?.trim() ?? "";
  if (signingUp) {
    if (process.env.ALLOW_PUBLIC_SIGNUP !== "true")
      return NextResponse.json(
        { error: "Rejestracja jest dostępna wyłącznie na zaproszenie." },
        { status: 403 },
      );
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
    return NextResponse.json(
      {
        confirmationRequired: true,
        message: "Sprawdź skrzynkę e-mail i potwierdź konto.",
      },
      { status: 202 },
    );

  let member = await membership(authData.access_token);
  if (!member) {
    const created = await bootstrap(authData.access_token);
    if (!created.ok)
      return NextResponse.json(
        {
          error: created.schemaMissing
            ? "Brakuje schematu aplikacji w Supabase. Uruchom plik supabase/schema.sql w SQL Editorze."
            : "Nie udało się utworzyć organizacji.",
        },
        { status: 503 },
      );
    member = await membership(authData.access_token);
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
