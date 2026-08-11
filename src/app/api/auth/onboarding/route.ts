import { NextResponse } from "next/server";
import { writeAuditEvent } from "@/lib/audit";
import { verifyMember } from "@/lib/supabase-auth";
import { getSupabaseServerEnv } from "@/lib/supabase-env";

export const runtime = "nodejs";

const roles = ["admin", "boss", "user"] as const;
const onboardingVersion = 1;
const lastStep = 3;

type UserMetadata = {
  first_name?: unknown;
  last_name?: unknown;
  phone?: unknown;
  onboarding_version?: unknown;
  onboarding_step?: unknown;
  onboarding_completed_at?: unknown;
};

function textValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function stepValue(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) ? Math.min(lastStep, Math.max(0, parsed)) : 0;
}

async function loadMetadata(url: string, publishableKey: string, accessToken: string) {
  const response = await fetch(`${url}/auth/v1/user`, {
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) return null;
  const user = (await response.json()) as { user_metadata?: UserMetadata };
  return user.user_metadata ?? {};
}

export async function GET(request: Request) {
  const member = await verifyMember(request, [...roles]);
  if (!member)
    return NextResponse.json({ error: "Brak dostępu." }, { status: 401 });

  const { url, publishableKey } = getSupabaseServerEnv();
  if (!url || !publishableKey)
    return NextResponse.json(
      { error: "Usługa jest tymczasowo niedostępna." },
      { status: 503 },
    );

  const metadata = await loadMetadata(url, publishableKey, member.accessToken);
  if (!metadata)
    return NextResponse.json(
      { error: "Nie udało się odczytać konfiguracji konta." },
      { status: 502 },
    );

  const storedVersion =
    metadata.onboarding_version == null
      ? Number.NaN
      : Number(metadata.onboarding_version);
  // Only accounts explicitly marked at signup are forced through onboarding.
  // This avoids interrupting legacy production users after deployment.
  const required = storedVersion === 0;

  return NextResponse.json({
    required,
    completed: !required,
    step: stepValue(metadata.onboarding_step),
    role: member.role,
    email: member.email,
    firstName: textValue(metadata.first_name) || member.firstName || "",
    lastName: textValue(metadata.last_name) || member.lastName || "",
    phone: textValue(metadata.phone),
    completedAt: textValue(metadata.onboarding_completed_at) || null,
  });
}

export async function PATCH(request: Request) {
  const member = await verifyMember(request, [...roles]);
  if (!member)
    return NextResponse.json({ error: "Brak dostępu." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    step?: unknown;
    firstName?: unknown;
    lastName?: unknown;
    phone?: unknown;
    complete?: unknown;
  } | null;
  if (!body)
    return NextResponse.json({ error: "Brak danych do zapisania." }, { status: 422 });

  const step = stepValue(body.step);
  const complete = body.complete === true;
  const profileSupplied =
    body.firstName !== undefined || body.lastName !== undefined || body.phone !== undefined;
  const firstName = textValue(body.firstName);
  const lastName = textValue(body.lastName);
  const phone = textValue(body.phone);

  if (profileSupplied && (!firstName || !lastName || !phone))
    return NextResponse.json(
      { error: "Podaj imię, nazwisko i numer telefonu." },
      { status: 422 },
    );
  if (firstName.length > 80 || lastName.length > 80 || phone.length > 40)
    return NextResponse.json(
      { error: "Podane dane są zbyt długie." },
      { status: 422 },
    );

  const { url, publishableKey } = getSupabaseServerEnv();
  if (!url || !publishableKey)
    return NextResponse.json(
      { error: "Usługa jest tymczasowo niedostępna." },
      { status: 503 },
    );

  const completedAt = complete ? new Date().toISOString() : undefined;
  const response = await fetch(`${url}/auth/v1/user`, {
    method: "PUT",
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${member.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      data: {
        onboarding_step: complete ? lastStep : step,
        ...(complete
          ? {
              onboarding_version: onboardingVersion,
              onboarding_completed_at: completedAt,
            }
          : {}),
        ...(profileSupplied
          ? { first_name: firstName, last_name: lastName, phone }
          : {}),
      },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });

  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as {
      msg?: string;
      error_description?: string;
    };
    return NextResponse.json(
      {
        error:
          data.msg ||
          data.error_description ||
          "Nie udało się zapisać konfiguracji konta.",
      },
      { status: 400 },
    );
  }

  if (complete) {
    await writeAuditEvent({
      organizationId: member.organizationId,
      userId: member.userId,
      action: "onboarding_completed",
      entityType: "user",
      entityId: member.userId,
      details: { version: onboardingVersion },
    });
  }

  return NextResponse.json({
    ok: true,
    step: complete ? lastStep : step,
    completed: complete,
    completedAt: completedAt ?? null,
  });
}
