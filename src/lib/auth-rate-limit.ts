import "server-only";
import { createHmac } from "node:crypto";
import { adminHeaders, getSupabaseServerEnv } from "@/lib/supabase-env";

type LimitRule = {
  scope: string;
  subject?: string | null;
  limit: number;
  windowSeconds: number;
};

export type RateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
  degraded: boolean;
};

function requestIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (
    request.headers.get("x-real-ip")?.trim() ||
    request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
    forwarded ||
    "unknown"
  );
}

function rateLimitKeyHash(pepper: string, key: string) {
  return createHmac("sha256", pepper).update(key).digest("hex");
}

export async function consumeAuthRateLimits(
  request: Request,
  rules: LimitRule[],
): Promise<RateLimitResult> {
  const { url, secretKey } = getSupabaseServerEnv();
  if (!url || !secretKey) return { allowed: true, retryAfterSeconds: 0, degraded: true };

  const pepper = process.env.AUTH_RATE_LIMIT_SECRET?.trim() || secretKey;
  const ip = requestIp(request);
  const checks = rules.flatMap((rule) => {
    const keys = [`ip:${ip}`];
    if (rule.subject) keys.push(`subject:${rule.subject.trim().toLowerCase()}`);
    return keys.map(async (key) => {
      const keyHash = rateLimitKeyHash(pepper, key);
      const response = await fetch(`${url}/rest/v1/rpc/consume_auth_rate_limit`, {
        method: "POST",
        headers: {
          ...adminHeaders(secretKey),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          p_scope: rule.scope,
          p_key_hash: keyHash,
          p_limit: rule.limit,
          p_window_seconds: rule.windowSeconds,
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) throw new Error(`rate-limit RPC HTTP ${response.status}`);
      const rows = (await response.json()) as Array<{
        allowed?: boolean;
        retry_after_seconds?: number;
      }>;
      return {
        allowed: rows[0]?.allowed !== false,
        retryAfterSeconds: Math.max(0, Number(rows[0]?.retry_after_seconds) || 0),
      };
    });
  });

  try {
    const results = await Promise.all(checks);
    return {
      allowed: results.every((item) => item.allowed),
      retryAfterSeconds: Math.max(0, ...results.map((item) => item.retryAfterSeconds)),
      degraded: false,
    };
  } catch (reason) {
    // Supabase Auth still applies its provider-level limits. We log the
    // degraded application limiter instead of causing a total login outage
    // during a staged migration or a transient database failure.
    console.error("Application auth rate limiter unavailable", reason);
    return { allowed: true, retryAfterSeconds: 0, degraded: true };
  }
}

export async function clearAuthRateLimits(
  request: Request,
  scope: string,
  subject?: string | null,
) {
  const { url, secretKey } = getSupabaseServerEnv();
  if (!url || !secretKey) return;
  const pepper = process.env.AUTH_RATE_LIMIT_SECRET?.trim() || secretKey;
  const keys = [`ip:${requestIp(request)}`];
  if (subject) keys.push(`subject:${subject.trim().toLowerCase()}`);
  await Promise.all(
    keys.map((key) =>
      fetch(
        `${url}/rest/v1/auth_rate_limits?scope=eq.${encodeURIComponent(scope)}&key_hash=eq.${rateLimitKeyHash(pepper, key)}`,
        {
          method: "DELETE",
          headers: { ...adminHeaders(secretKey), Prefer: "return=minimal" },
          cache: "no-store",
          signal: AbortSignal.timeout(5_000),
        },
      ),
    ),
  ).catch((reason) => console.error("Could not clear successful auth attempt counters", reason));
}

export function rateLimitedResponse(result: RateLimitResult) {
  return new Response(
    JSON.stringify({ error: "Zbyt wiele prób. Odczekaj chwilę i spróbuj ponownie." }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(Math.max(1, result.retryAfterSeconds)),
        "Cache-Control": "no-store",
      },
    },
  );
}
