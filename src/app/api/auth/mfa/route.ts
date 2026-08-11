import { NextResponse } from "next/server";
import {
  clearPendingMfaCookies,
  cookieValue,
  jwtAssuranceLevel,
  setSessionCookies,
  type AuthTokens,
} from "@/lib/auth-session";
import {
  clearAuthRateLimits,
  consumeAuthRateLimits,
  rateLimitedResponse,
} from "@/lib/auth-rate-limit";
import { getSupabaseServerEnv } from "@/lib/supabase-env";

export const runtime = "nodejs";

type Factor = {
  id: string;
  factor_type?: string;
  status?: string;
};

function authHeaders(publishableKey: string, accessToken: string) {
  return {
    apikey: publishableKey,
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
}

async function pendingSession(request: Request) {
  const accessToken = cookieValue(request, "ff-mfa-access");
  const refreshToken = cookieValue(request, "ff-mfa-refresh");
  const { url, publishableKey } = getSupabaseServerEnv();
  if (!url || !publishableKey || !accessToken || !refreshToken) return null;
  const response = await fetch(`${url}/auth/v1/user`, {
    headers: authHeaders(publishableKey, accessToken),
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) return null;
  const user = (await response.json()) as { id?: string; factors?: Factor[] };
  if (!user.id) return null;
  return { url, publishableKey, accessToken, refreshToken, user };
}

export async function GET(request: Request) {
  const session = await pendingSession(request);
  if (!session)
    return NextResponse.json({ error: "Sesja MFA wygasła. Zaloguj się ponownie." }, { status: 401 });
  const verified = session.user.factors?.filter(
    (factor) => factor.factor_type === "totp" && factor.status === "verified",
  ) ?? [];
  return NextResponse.json({
    mfaRequired: jwtAssuranceLevel(session.accessToken) !== "aal2",
    enrollmentRequired: verified.length === 0,
  });
}

export async function POST(request: Request) {
  const session = await pendingSession(request);
  if (!session)
    return NextResponse.json({ error: "Sesja MFA wygasła. Zaloguj się ponownie." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as {
    action?: string;
    factorId?: string;
    code?: string;
  } | null;

  if (body?.action === "enroll") {
    const verified = session.user.factors?.some(
      (factor) => factor.factor_type === "totp" && factor.status === "verified",
    );
    if (verified)
      return NextResponse.json({ error: "Uwierzytelnianie MFA jest już skonfigurowane." }, { status: 409 });

    const staleFactors = session.user.factors?.filter(
      (factor) => factor.factor_type === "totp" && factor.status !== "verified",
    ) ?? [];
    await Promise.all(
      staleFactors.map((factor) =>
        fetch(`${session.url}/auth/v1/factors/${encodeURIComponent(factor.id)}`, {
          method: "DELETE",
          headers: authHeaders(session.publishableKey, session.accessToken),
          cache: "no-store",
        }),
      ),
    );
    const response = await fetch(`${session.url}/auth/v1/factors`, {
      method: "POST",
      headers: authHeaders(session.publishableKey, session.accessToken),
      body: JSON.stringify({ factor_type: "totp", friendly_name: "FlotaFlow" }),
      cache: "no-store",
    });
    const data = (await response.json().catch(() => ({}))) as {
      id?: string;
      totp?: { qr_code?: string; secret?: string; uri?: string };
      msg?: string;
    };
    if (!response.ok || !data.id || !data.totp?.qr_code)
      return NextResponse.json(
        { error: data.msg || "Nie udało się rozpocząć konfiguracji MFA." },
        { status: response.status || 502 },
      );
    return NextResponse.json({
      factorId: data.id,
      qrCode: data.totp.qr_code,
      secret: data.totp.secret ?? "",
    });
  }

  if (body?.action !== "verify" || !/^\d{6}$/.test(body.code ?? ""))
    return NextResponse.json({ error: "Podaj sześciocyfrowy kod z aplikacji." }, { status: 422 });

  const limiter = await consumeAuthRateLimits(request, [
    { scope: "mfa", subject: session.user.id, limit: 8, windowSeconds: 15 * 60 },
  ]);
  if (!limiter.allowed) return rateLimitedResponse(limiter);

  const verifiedFactor = session.user.factors?.find(
    (factor) => factor.factor_type === "totp" && factor.status === "verified",
  );
  const factorId = body.factorId || verifiedFactor?.id;
  if (!factorId)
    return NextResponse.json({ error: "Brak skonfigurowanego składnika MFA." }, { status: 409 });

  const challengeResponse = await fetch(
    `${session.url}/auth/v1/factors/${encodeURIComponent(factorId)}/challenge`,
    {
      method: "POST",
      headers: authHeaders(session.publishableKey, session.accessToken),
      body: "{}",
      cache: "no-store",
    },
  );
  const challenge = (await challengeResponse.json().catch(() => ({}))) as {
    id?: string;
    msg?: string;
  };
  if (!challengeResponse.ok || !challenge.id)
    return NextResponse.json(
      { error: challenge.msg || "Nie udało się utworzyć wyzwania MFA." },
      { status: challengeResponse.status || 502 },
    );

  const verifyResponse = await fetch(
    `${session.url}/auth/v1/factors/${encodeURIComponent(factorId)}/verify`,
    {
      method: "POST",
      headers: authHeaders(session.publishableKey, session.accessToken),
      body: JSON.stringify({ challenge_id: challenge.id, code: body.code }),
      cache: "no-store",
    },
  );
  const verified = (await verifyResponse.json().catch(() => ({}))) as Partial<AuthTokens> & {
    msg?: string;
  };
  if (!verifyResponse.ok || !verified.access_token || !verified.refresh_token)
    return NextResponse.json(
      { error: verified.msg || "Nieprawidłowy albo wygasły kod MFA." },
      { status: verifyResponse.status === 429 ? 429 : 401 },
    );
  if (jwtAssuranceLevel(verified.access_token) !== "aal2")
    return NextResponse.json({ error: "Supabase nie podniósł poziomu sesji do AAL2." }, { status: 502 });

  await clearAuthRateLimits(request, "mfa", session.user.id);
  const response = NextResponse.json({ ok: true });
  setSessionCookies(response, verified as AuthTokens);
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  clearPendingMfaCookies(response);
  return response;
}
