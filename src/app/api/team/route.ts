import { NextResponse } from "next/server";
import { verifyMember } from "@/lib/supabase-auth";
import { getSupabaseServerEnv } from "@/lib/supabase-env";

export const runtime = "nodejs";

export async function GET(request: Request) {
  // This route exposes employee names and e-mail addresses. It is not needed
  // by scanner/viewer accounts and must not become an internal address book.
  const member = await verifyMember(request, ["admin"]);
  if (!member)
    return NextResponse.json({ error: "Brak dostępu." }, { status: 401 });
  const { url, secretKey } = getSupabaseServerEnv();
  if (!url || !secretKey)
    return NextResponse.json(
      { error: "Supabase nie jest skonfigurowany." },
      { status: 503 },
    );
  const adminAuthHeaders = {
    apikey: secretKey,
    Authorization: `Bearer ${secretKey}`,
  };

  const membersResponse = await fetch(
    `${url}/rest/v1/organization_members?select=user_id,role&organization_id=eq.${member.organizationId}`,
    { headers: adminAuthHeaders, cache: "no-store" },
  );
  if (!membersResponse.ok)
    return NextResponse.json(
      { error: "Nie udało się pobrać zespołu." },
      { status: 502 },
    );
  const members = (await membersResponse.json()) as Array<{
    user_id: string;
    role: string;
  }>;

  const team = await Promise.all(
    members.map(async (item) => {
      const userResponse = await fetch(
        `${url}/auth/v1/admin/users/${item.user_id}`,
        { headers: adminAuthHeaders, cache: "no-store" },
      );
      if (!userResponse.ok)
        return { userId: item.user_id, role: item.role, email: null, name: null };
      const user = (await userResponse.json()) as {
        email?: string;
        user_metadata?: { first_name?: string; last_name?: string };
      };
      const firstName = user.user_metadata?.first_name?.trim();
      const lastName = user.user_metadata?.last_name?.trim();
      const name = firstName || lastName ? `${firstName ?? ""} ${lastName ?? ""}`.trim() : null;
      return {
        userId: item.user_id,
        role: item.role,
        email: user.email ?? null,
        name,
      };
    }),
  );

  return NextResponse.json({ team });
}
