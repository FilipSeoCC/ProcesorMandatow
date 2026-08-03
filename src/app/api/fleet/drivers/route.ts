import { NextResponse } from "next/server";
import { verifyMember } from "@/lib/supabase-auth";
import { adminHeaders, getSupabaseServerEnv } from "@/lib/supabase-env";

export const runtime = "nodejs";

const readRoles = ["admin", "boss", "user"] as const;
const writeRoles = ["admin", "boss", "user"] as const;

const validStatuses = new Set(["Dostępny", "W trasie", "Urlop", "Nieaktywny"]);

type DriverRow = {
  id: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  license_number: string;
  license_valid_until: string | null;
  status: string;
};

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function toDriver(row: DriverRow) {
  return {
    id: row.id,
    name: `${row.first_name} ${row.last_name}`.trim(),
    phone: row.phone,
    email: row.email,
    status: row.status,
  };
}

export async function GET(request: Request) {
  const member = await verifyMember(request, [...readRoles]);
  if (!member)
    return NextResponse.json({ error: "Brak dostępu." }, { status: 401 });
  const { url, secretKey } = getSupabaseServerEnv();
  if (!url || !secretKey)
    return NextResponse.json(
      { error: "Usługa jest tymczasowo niedostępna. Skontaktuj się z administratorem." },
      { status: 503 },
    );
  const response = await fetch(
    `${url}/rest/v1/drivers?select=id,first_name,last_name,phone,email,license_number,license_valid_until,status&organization_id=eq.${member.organizationId}&order=created_at.desc`,
    { headers: adminHeaders(secretKey), cache: "no-store" },
  );
  if (!response.ok)
    return NextResponse.json(
      { error: "Nie udało się pobrać pracowników." },
      { status: 502 },
    );
  const rows = (await response.json()) as DriverRow[];
  return NextResponse.json({ employees: rows.map(toDriver) });
}

export async function POST(request: Request) {
  const member = await verifyMember(request, [...writeRoles]);
  if (!member)
    return NextResponse.json({ error: "Brak dostępu." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : null;
  const firstName = text(body?.firstName, 100);
  const lastName = text(body?.lastName, 100);
  const phone = text(body?.phone, 30);
  const email = text(body?.email, 200);
  const status = validStatuses.has(text(body?.status, 20))
    ? text(body?.status, 20)
    : "Dostępny";
  if (!firstName || !lastName || !phone)
    return NextResponse.json(
      { error: "Uzupełnij imię, nazwisko i telefon." },
      { status: 422 },
    );
  const { url, secretKey } = getSupabaseServerEnv();
  if (!url || !secretKey)
    return NextResponse.json(
      { error: "Usługa jest tymczasowo niedostępna. Skontaktuj się z administratorem." },
      { status: 503 },
    );
  const headers = {
    ...adminHeaders(secretKey),
    "Content-Type": "application/json",
  };
  const payload = {
    organization_id: member.organizationId,
    first_name: firstName,
    last_name: lastName,
    phone,
    email,
    status,
  };

  const response = id
    ? await fetch(
        `${url}/rest/v1/drivers?id=eq.${encodeURIComponent(id)}&organization_id=eq.${member.organizationId}`,
        {
          method: "PATCH",
          headers: { ...headers, Prefer: "return=representation" },
          body: JSON.stringify(payload),
        },
      )
    : await fetch(`${url}/rest/v1/drivers`, {
        method: "POST",
        headers: { ...headers, Prefer: "return=representation" },
        body: JSON.stringify(payload),
      });
  if (!response.ok)
    return NextResponse.json(
      { error: "Nie udało się zapisać pracownika." },
      { status: 502 },
    );
  const rows = (await response.json()) as DriverRow[];
  const row = rows[0];
  if (!row)
    return NextResponse.json(
      { error: "Nie znaleziono pracownika do edycji." },
      { status: 404 },
    );
  return NextResponse.json({ employee: toDriver(row) });
}
