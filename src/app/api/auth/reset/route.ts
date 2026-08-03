import { NextResponse } from "next/server";
import { getSupabaseServerEnv } from "@/lib/supabase-env";

const genericRequestMessage =
  "Jeśli to konto istnieje, wysłaliśmy na nie link do zresetowania hasła.";

// Ask Supabase to email a recovery link. Always responds with the same
// generic message regardless of whether the address is registered, so this
// can't be used to enumerate accounts.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { email?: string } | null;
  const email = body?.email?.trim().toLowerCase() ?? "";
  if (!/^\S+@\S+\.\S+$/.test(email))
    return NextResponse.json({ error: "Podaj poprawny adres e-mail." }, { status: 422 });

  const { url, publishableKey } = getSupabaseServerEnv();
  if (!url || !publishableKey)
    return NextResponse.json(
      { error: "Supabase nie jest skonfigurowany." },
      { status: 503 },
    );

  const origin = request.headers.get("origin") ?? new URL(request.url).origin;
  await fetch(`${url}/auth/v1/recover`, {
    method: "POST",
    headers: { apikey: publishableKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, options: { redirectTo: `${origin}/reset-hasla` } }),
    cache: "no-store",
  }).catch(() => null);

  return NextResponse.json({ message: genericRequestMessage });
}

// Set a new password using the recovery access token from the emailed link
// (the browser lands on /reset-hasla with it in the URL hash — there is no
// logged-in session cookie at this point, unlike the profile PATCH above).
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
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password: newPassword }),
    cache: "no-store",
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    return NextResponse.json(
      {
        error:
          data.msg ||
          data.error_description ||
          "Nie udało się zmienić hasła. Poproś o nowy link.",
      },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true });
}
