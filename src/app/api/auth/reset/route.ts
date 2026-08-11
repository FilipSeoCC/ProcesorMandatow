import { NextResponse } from "next/server";
import { consumeAuthRateLimits, rateLimitedResponse } from "@/lib/auth-rate-limit";
import { validateNewPassword } from "@/lib/password-security";
import { getSupabaseServerEnv } from "@/lib/supabase-env";

const genericRequestMessage =
  "Jeśli to konto istnieje, wysłaliśmy na nie link do zresetowania hasła.";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { email?: string } | null;
  const email = body?.email?.trim().toLowerCase() ?? "";
  if (!/^\S+@\S+\.\S+$/.test(email))
    return NextResponse.json({ error: "Podaj poprawny adres e-mail." }, { status: 422 });

  const limiter = await consumeAuthRateLimits(request, [
    { scope: "password-reset", subject: email, limit: 6, windowSeconds: 60 * 60 },
  ]);
  if (!limiter.allowed) return rateLimitedResponse(limiter);

  const { url, publishableKey } = getSupabaseServerEnv();
  if (!url || !publishableKey)
    return NextResponse.json({ error: "Usługa jest tymczasowo niedostępna." }, { status: 503 });

  const origin = request.headers.get("origin") ?? new URL(request.url).origin;
  await fetch(`${url}/auth/v1/recover`, {
    method: "POST",
    headers: { apikey: publishableKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, options: { redirectTo: `${origin}/reset-hasla` } }),
    cache: "no-store",
  }).catch(() => null);
  return NextResponse.json({ message: genericRequestMessage });
}

export async function PUT(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { accessToken?: string; newPassword?: string }
    | null;
  const accessToken = body?.accessToken?.trim() ?? "";
  const newPassword = body?.newPassword ?? "";
  if (!accessToken)
    return NextResponse.json(
      { error: "Brak albo wygasły link do resetu hasła. Poproś o nowy." },
      { status: 401 },
    );
  const passwordError = await validateNewPassword(newPassword);
  if (passwordError)
    return NextResponse.json({ error: passwordError }, { status: 422 });

  const limiter = await consumeAuthRateLimits(request, [
    {
      scope: "password-recovery-complete",
      subject: accessToken.slice(-24),
      limit: 6,
      windowSeconds: 15 * 60,
    },
  ]);
  if (!limiter.allowed) return rateLimitedResponse(limiter);

  const { url, publishableKey } = getSupabaseServerEnv();
  if (!url || !publishableKey)
    return NextResponse.json({ error: "Usługa jest tymczasowo niedostępna." }, { status: 503 });
  const response = await fetch(`${url}/auth/v1/user`, {
    method: "PUT",
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password: newPassword }),
    cache: "no-store",
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return NextResponse.json(
      {
        error: String(
          data.msg || data.error_description || "Nie udało się zmienić hasła. Poproś o nowy link.",
        ),
      },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true });
}
