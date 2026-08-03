import { NextResponse } from "next/server";
import { verifyMember } from "@/lib/supabase-auth";
import { adminHeaders, getSupabaseServerEnv } from "@/lib/supabase-env";

const validStatuses = new Set([
  "nowe",
  "w_trakcie",
  "rozwiazane",
  "brak_realizacji",
]);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const member = await verifyMember(request, ["admin"]);
  if (!member)
    return NextResponse.json({ error: "Brak dostępu." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const status = typeof body?.status === "string" ? body.status : "";
  if (!validStatuses.has(status))
    return NextResponse.json(
      { error: "Nieprawidłowy status." },
      { status: 422 },
    );
  const { url, secretKey } = getSupabaseServerEnv();
  if (!url || !secretKey)
    return NextResponse.json(
      { error: "Usługa jest tymczasowo niedostępna. Skontaktuj się z administratorem." },
      { status: 503 },
    );
  const response = await fetch(
    `${url}/rest/v1/bug_reports?id=eq.${encodeURIComponent(id)}&organization_id=eq.${member.organizationId}`,
    {
      method: "PATCH",
      headers: {
        ...adminHeaders(secretKey),
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ status, updated_at: new Date().toISOString() }),
    },
  );
  if (!response.ok)
    return NextResponse.json(
      { error: "Nie udało się zaktualizować statusu." },
      { status: 502 },
    );
  return NextResponse.json({ ok: true });
}
