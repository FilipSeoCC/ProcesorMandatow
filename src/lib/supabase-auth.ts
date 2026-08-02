import "server-only";
import { getSupabaseServerEnv } from "@/lib/supabase-env";

// Simplified to 3 roles (Filip's call): admin = full access incl. team/role
// management, boss = everything a user can do plus confirming case data
// (the one action that commits the org to a client/authority), user = all
// day-to-day case/fleet/route work minus confirming. Old finer-grained
// values (dispatcher/office/scanner/viewer) are migrated to 'user' by
// schema.sql; don't reintroduce them without updating the RLS policies too.
export type AppRole = "admin" | "boss" | "user";
export type VerifiedMember = {
  userId: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  organizationId: string;
  role: AppRole;
  accessToken: string;
};

export async function verifyMember(
  request: Request,
  allowed: AppRole[],
): Promise<VerifiedMember | null> {
  const { url: supabaseUrl, publishableKey: anonKey } = getSupabaseServerEnv();
  const cookieToken = request.headers
    .get("cookie")
    ?.match(/(?:^|;\s*)ff-access=([^;]+)/)?.[1];
  const authorization =
    request.headers.get("authorization") ??
    (cookieToken ? `Bearer ${decodeURIComponent(cookieToken)}` : null);
  const origin = request.headers.get("origin");
  if (cookieToken && origin && origin !== new URL(request.url).origin) return null;
  const accessToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!supabaseUrl || !anonKey || !accessToken) return null;

  const commonHeaders = {
    apikey: anonKey,
    Authorization: `Bearer ${accessToken}`,
  };
  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: commonHeaders,
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!userResponse.ok) return null;
  const user = (await userResponse.json()) as {
    id?: string;
    email?: string;
    user_metadata?: { first_name?: string; last_name?: string };
  };
  if (!user.id) return null;

  const memberResponse = await fetch(
    `${supabaseUrl}/rest/v1/organization_members?select=organization_id,role&user_id=eq.${encodeURIComponent(user.id)}&limit=1`,
    {
      headers: commonHeaders,
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    },
  );
  if (!memberResponse.ok) return null;
  const memberships = (await memberResponse.json()) as Array<{
    organization_id: string;
    role: AppRole;
  }>;
  const membership = memberships[0];
  if (!membership || !allowed.includes(membership.role)) return null;
  return {
    userId: user.id,
    email: user.email ?? null,
    firstName: user.user_metadata?.first_name ?? null,
    lastName: user.user_metadata?.last_name ?? null,
    organizationId: membership.organization_id,
    role: membership.role,
    accessToken,
  };
}
