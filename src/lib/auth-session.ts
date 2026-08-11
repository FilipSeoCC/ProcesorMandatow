import "server-only";
import type { NextResponse } from "next/server";

export type AuthTokens = {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
};

const commonCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  priority: "high" as const,
};

export function setSessionCookies(response: NextResponse, session: AuthTokens) {
  response.cookies.set("ff-access", session.access_token, {
    ...commonCookieOptions,
    maxAge: Math.max(60, session.expires_in ?? 3600),
  });
  response.cookies.set("ff-refresh", session.refresh_token, {
    ...commonCookieOptions,
    maxAge: 60 * 60 * 24 * 30,
  });
  clearPendingMfaCookies(response);
}

export function setPendingMfaCookies(response: NextResponse, session: AuthTokens) {
  response.cookies.set("ff-mfa-access", session.access_token, {
    ...commonCookieOptions,
    maxAge: 10 * 60,
  });
  response.cookies.set("ff-mfa-refresh", session.refresh_token, {
    ...commonCookieOptions,
    maxAge: 10 * 60,
  });
  clearSessionCookies(response);
}

export function clearSessionCookies(response: NextResponse) {
  response.cookies.set("ff-access", "", { ...commonCookieOptions, maxAge: 0 });
  response.cookies.set("ff-refresh", "", { ...commonCookieOptions, maxAge: 0 });
}

export function clearPendingMfaCookies(response: NextResponse) {
  response.cookies.set("ff-mfa-access", "", { ...commonCookieOptions, maxAge: 0 });
  response.cookies.set("ff-mfa-refresh", "", { ...commonCookieOptions, maxAge: 0 });
}

export function cookieValue(request: Request, name: string) {
  const match = request.headers
    .get("cookie")
    ?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export function jwtAssuranceLevel(accessToken: string) {
  try {
    const payload = accessToken.split(".")[1];
    if (!payload) return "aal1";
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = JSON.parse(
      Buffer.from(normalized, "base64").toString("utf8"),
    ) as { aal?: string };
    return decoded.aal === "aal2" ? "aal2" : "aal1";
  } catch {
    return "aal1";
  }
}
