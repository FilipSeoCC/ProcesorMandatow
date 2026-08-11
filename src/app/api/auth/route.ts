import { NextResponse } from "next/server";
import { writeAuditEvent } from "@/lib/audit";
import {
  clearAuthRateLimits,
  consumeAuthRateLimits,
  rateLimitedResponse,
} from "@/lib/auth-rate-limit";
import {
  clearPendingMfaCookies,
  clearSessionCookies,
  jwtAssuranceLevel,
  setPendingMfaCookies,
  setSessionCookies,
  type AuthTokens,
} from "@/lib/auth-session";
import { validateNewPassword } from "@/lib/password-security";
import { verifyMember } from "@/lib/supabase-auth";
import { adminHeaders, getSupabaseServerEnv } from "@/lib/supabase-env";

export const runtime = "nodejs";

type Factor = { id?: string; factor_type?: string; status?: string };
type AuthSession = AuthTokens & {
  user?: {
    id?: string;
    email?: string;
    factors?: Factor[];
    user_metadata?: {
      first_name?: string;
      last_name?: string;
      phone?: string;
      onboarding_version?: number | string;
      onboarding_step?: number | string;
      onboarding_completed_at?: string;
    };
  };
};
const allRoles = ["admin", "boss", "user"] as const;

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
        role: "admin" | "boss" | "user";
        status: string;
      }>
    )[0] ?? null
  );
}

async function bootstrap(accessToken: string) {
  const { url, publishableKey } = getSupabaseServerEnv();
  if (!url || !publishableKey) return false;
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
  return response.ok;
}

function onboardingPayload(input: {
  role: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  version?: number | string | null;
  step?: number | string | null;
  completedAt?: string | null;
}) {
  const version = input.version == null ? Number.NaN : Number(input.version);
  const rawStep = Number(input.step);
  const step = Number.isInteger(rawStep) ? Math.min(3, Math.max(0, rawStep)) : 0;
  const required = version === 0;
  return {
    required,
    completed: !required,
    step,
    role: input.role,
    email: input.email ?? null,
    firstName: input.firstName ?? "",
    lastName: input.lastName ?? "",
    phone: input.phone ?? "",
    completedAt: input.completedAt ?? null,
  };
}

function authError(data: Record<string, unknown>, fallback: string) {
  return String(data.msg || data.message || data.error_description || fallback);
}

async function passwordLogin(url: string, key: string, email: string, password: string) {
  const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    cache: "no-store",
  });
  return {
    response,
    data: (await response.json().catch(() => ({}))) as Partial<AuthSession> &
      Record<string, unknown>,
  };
}

export async function GET(request: Request) {
  const member = await verifyMember(request, [...allRoles]);
  if (!member) return NextResponse.json({ authenticated: false }, { status: 401 });
  return NextResponse.json({
    authenticated: true,
    role: member.role,
    organizationId: member.organizationId,
    email: member.email,
    firstName: member.firstName,
    lastName: member.lastName,
    phone: member.phone,
    userId: member.userId,
    onboarding: onboardingPayload({
      role: member.role,
      email: member.email,
      firstName: member.firstName,
      lastName: member.lastName,
      phone: member.phone,
      version: member.onboardingVersion,
      step: member.onboardingStep,
      completedAt: member.onboardingCompletedAt,
    }),
  });
}

export async function PATCH(request: Request) {
  const member = await verifyMember(request, [...allRoles]);
  if (!member) return NextResponse.json({ error: "Brak dostępu." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as {
    currentPassword?: string;
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
  if (updatingName && (!firstName || !lastName))
    return NextResponse.json({ error: "Podaj imię i nazwisko." }, { status: 422 });

  const { url, publishableKey } = getSupabaseServerEnv();
  if (!url || !publishableKey)
    return NextResponse.json({ error: "Usługa jest tymczasowo niedostępna." }, { status: 503 });

  let updateAccessToken = member.accessToken;
  if (updatingPassword) {
    const passwordError = await validateNewPassword(newPassword);
    if (passwordError)
      return NextResponse.json({ error: passwordError }, { status: 422 });
    if (!body?.currentPassword || !member.email)
      return NextResponse.json({ error: "Podaj obecne hasło." }, { status: 422 });
    const limiter = await consumeAuthRateLimits(request, [
      { scope: "password-change", subject: member.userId, limit: 6, windowSeconds: 15 * 60 },
    ]);
    if (!limiter.allowed) return rateLimitedResponse(limiter);
    const verification = await passwordLogin(
      url,
      publishableKey,
      member.email,
      body.currentPassword,
    );
    if (!verification.response.ok || verification.data.user?.id !== member.userId)
      return NextResponse.json({ error: "Obecne hasło jest nieprawidłowe." }, { status: 401 });
    if (!verification.data.access_token)
      return NextResponse.json({ error: "Nie udało się odświeżyć bezpiecznej sesji." }, { status: 401 });
    updateAccessToken = verification.data.access_token;
  }

  const response = await fetch(`${url}/auth/v1/user`, {
    method: "PUT",
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${updateAccessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...(updatingPassword ? { password: newPassword } : {}),
      ...(updatingName ? { data: { first_name: firstName, last_name: lastName } } : {}),
    }),
    cache: "no-store",
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return NextResponse.json(
      { error: authError(data, "Nie udało się zapisać danych konta.") },
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
  if (!/^\S+@\S+\.\S+$/.test(email))
    return NextResponse.json({ error: "Podaj poprawny adres e-mail." }, { status: 422 });
  if (!signingUp && password.length < 1)
    return NextResponse.json({ error: "Podaj hasło." }, { status: 422 });

  const limiter = await consumeAuthRateLimits(request, [
    {
      scope: signingUp ? "self-signup" : "login",
      subject: email,
      limit: signingUp ? 5 : 10,
      windowSeconds: signingUp ? 60 * 60 : 15 * 60,
    },
  ]);
  if (!limiter.allowed) return rateLimitedResponse(limiter);

  const { url, publishableKey } = getSupabaseServerEnv();
  if (!url || !publishableKey)
    return NextResponse.json({ error: "Usługa jest tymczasowo niedostępna." }, { status: 503 });

  const firstName = body?.firstName?.trim() ?? "";
  const lastName = body?.lastName?.trim() ?? "";
  const phone = body?.phone?.trim() ?? "";
  if (signingUp) {
    const passwordError = await validateNewPassword(password);
    if (passwordError)
      return NextResponse.json({ error: passwordError }, { status: 422 });
    if (!firstName || !lastName || !phone)
      return NextResponse.json({ error: "Podaj imię, nazwisko i numer telefonu." }, { status: 422 });
    if (!body?.consent)
      return NextResponse.json({ error: "Musisz zaakceptować politykę prywatności." }, { status: 422 });
    const signupResponse = await fetch(`${url}/auth/v1/signup`, {
      method: "POST",
      headers: {
        apikey: publishableKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        password,
        data: {
          first_name: firstName,
          last_name: lastName,
          phone,
          privacy_consent_at: new Date().toISOString(),
          onboarding_version: 0,
          onboarding_step: 0,
        },
      }),
      cache: "no-store",
    });
    const signupData = (await signupResponse.json().catch(() => ({}))) as
      Partial<AuthSession> & Record<string, unknown>;
    if (!signupResponse.ok)
      return NextResponse.json(
        { error: authError(signupData, "Nie udało się utworzyć konta.") },
        { status: signupResponse.status === 429 ? 429 : 400 },
      );
    if (!signupData.access_token || !signupData.refresh_token)
      return NextResponse.json(
        {
          confirmationRequired: true,
          message:
            "Konto zostało utworzone. Potwierdź adres e-mail, a następnie poczekaj na akceptację i nadanie roli przez bossa lub administratora.",
        },
        { status: 202 },
      );
  }

  const login = await passwordLogin(url, publishableKey, email, password);
  const authData = login.data;
  if (!login.response.ok || !authData.access_token || !authData.refresh_token)
    return NextResponse.json(
      { error: authError(authData, "Nieprawidłowy e-mail lub hasło.") },
      { status: login.response.status === 429 ? 429 : 401 },
    );
  await clearAuthRateLimits(request, signingUp ? "self-signup" : "login", email);
  const userId = authData.user?.id;
  let member = userId ? await membershipByUserId(userId) : null;
  if (!member && userId) {
    const bootstrapped = await bootstrap(authData.access_token);
    if (!bootstrapped)
      return NextResponse.json(
        { error: "Nie udało się zgłosić konta do akceptacji." },
        { status: 503 },
      );
    member = await membershipByUserId(userId);
  }
  if (!member || member.status !== "active")
    return NextResponse.json(
      {
        pendingApproval: true,
        message: "Konto czeka na akceptację i nadanie roli przez bossa lub administratora.",
      },
      { status: 403 },
    );

  const verifiedFactor = authData.user?.factors?.some(
    (factor) => factor.factor_type === "totp" && factor.status === "verified",
  );
  const privileged = member.role === "admin" || member.role === "boss";
  if ((privileged || verifiedFactor) && jwtAssuranceLevel(authData.access_token) !== "aal2") {
    const response = NextResponse.json({
      mfaRequired: true,
      enrollmentRequired: privileged && !verifiedFactor,
      email: authData.user?.email ?? email,
    });
    setPendingMfaCookies(response, authData as AuthSession);
    return response;
  }

  const metadata = authData.user?.user_metadata;
  const response = NextResponse.json({
    authenticated: true,
    role: member.role,
    email: authData.user?.email ?? email,
    firstName: metadata?.first_name ?? "",
    lastName: metadata?.last_name ?? "",
    phone: metadata?.phone ?? "",
    onboarding: onboardingPayload({
      role: member.role,
      email: authData.user?.email ?? email,
      firstName: metadata?.first_name,
      lastName: metadata?.last_name,
      phone: metadata?.phone,
      version: metadata?.onboarding_version,
      step: metadata?.onboarding_step,
      completedAt: metadata?.onboarding_completed_at,
    }),
  });
  setSessionCookies(response, authData as AuthSession);
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ authenticated: false });
  clearSessionCookies(response);
  clearPendingMfaCookies(response);
  return response;
}
