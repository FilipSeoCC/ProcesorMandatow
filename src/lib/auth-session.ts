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
  clearLegacyMfaCookies(response);
}

export function clearSessionCookies(response: NextResponse) {
  response.cookies.set("ff-access", "", { ...commonCookieOptions, maxAge: 0 });
  response.cookies.set("ff-refresh", "", { ...commonCookieOptions, maxAge: 0 });
  clearLegacyMfaCookies(response);
}

function clearLegacyMfaCookies(response: NextResponse) {
  response.cookies.set("ff-mfa-access", "", { ...commonCookieOptions, maxAge: 0 });
  response.cookies.set("ff-mfa-refresh", "", { ...commonCookieOptions, maxAge: 0 });
}

export function cookieValue(request: Request, name: string) {
  const match = request.headers
    .get("cookie")
    ?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}
