import { NextResponse } from "next/server";
import { verifyMember } from "@/lib/supabase-auth";
import { adminHeaders, getSupabaseServerEnv } from "@/lib/supabase-env";

export const runtime = "nodejs";

const allRoles = ["admin", "dispatcher", "office", "scanner", "viewer"] as const;

export async function GET(request: Request) {
  const member = await verifyMember(request, ["admin"]);
  if (!member)
    return NextResponse.json({ error: "Brak dostępu." }, { status: 401 });
  const { url, secretKey } = getSupabaseServerEnv();
  if (!url || !secretKey)
    return NextResponse.json(
      { error: "Supabase nie jest skonfigurowany." },
      { status: 503 },
    );
  const response = await fetch(
    `${url}/rest/v1/bug_reports?select=*&organization_id=eq.${member.organizationId}&order=created_at.desc&limit=200`,
    { headers: adminHeaders(secretKey), cache: "no-store" },
  );
  if (!response.ok)
    return NextResponse.json(
      { error: "Nie udało się pobrać zgłoszeń." },
      { status: 502 },
    );
  const reports = (await response.json()) as Array<{ attachment_path?: string }>;
  const withUrls = await Promise.all(
    reports.map(async (report) => {
      if (!report.attachment_path) return { ...report, attachmentUrl: null };
      const signed = await fetch(
        `${url}/storage/v1/object/sign/bug-reports/${report.attachment_path}`,
        {
          method: "POST",
          headers: {
            ...adminHeaders(secretKey),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ expiresIn: 600 }),
          signal: AbortSignal.timeout(8_000),
        },
      );
      if (!signed.ok) return { ...report, attachmentUrl: null };
      const signedBody = (await signed.json()) as {
        signedURL?: string;
        signedUrl?: string;
      };
      const path = signedBody.signedURL || signedBody.signedUrl;
      const attachmentUrl = path
        ? path.startsWith("http")
          ? path
          : `${url}/storage/v1${path}`
        : null;
      return { ...report, attachmentUrl };
    }),
  );
  return NextResponse.json({ reports: withUrls });
}

const allowedAttachmentTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

export async function POST(request: Request) {
  const member = await verifyMember(request, [...allRoles]);
  if (!member)
    return NextResponse.json({ error: "Brak dostępu." }, { status: 401 });
  const form = await request.formData().catch(() => null);
  const description = (form?.get("description")?.toString() ?? "").trim();
  const context = (form?.get("context")?.toString() ?? "").trim();
  const attachment = form?.get("attachment");
  if (!description || description.length > 4000)
    return NextResponse.json(
      { error: "Opisz problem (maksymalnie 4000 znaków)." },
      { status: 422 },
    );
  const file = attachment instanceof File && attachment.size > 0 ? attachment : null;
  if (file && !allowedAttachmentTypes.has(file.type))
    return NextResponse.json(
      { error: "Załącznik musi być obrazem (PNG, JPG, WEBP lub GIF)." },
      { status: 422 },
    );
  if (file && file.size > 8 * 1024 * 1024)
    return NextResponse.json(
      { error: "Zrzut ekranu przekracza limit 8 MB." },
      { status: 413 },
    );
  const { url, secretKey } = getSupabaseServerEnv();
  if (!url || !secretKey)
    return NextResponse.json(
      { error: "Supabase nie jest skonfigurowany." },
      { status: 503 },
    );

  const reportId = crypto.randomUUID();
  let attachmentPath = "";
  if (file) {
    const extension = file.type.split("/")[1] || "png";
    attachmentPath = `${member.organizationId}/${reportId}.${extension}`;
    const upload = await fetch(
      `${url}/storage/v1/object/bug-reports/${attachmentPath}`,
      {
        method: "POST",
        headers: {
          ...adminHeaders(secretKey),
          "Content-Type": file.type,
          "x-upsert": "false",
        },
        body: file,
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!upload.ok)
      return NextResponse.json(
        { error: "Nie udało się przesłać zrzutu ekranu." },
        { status: 502 },
      );
  }
  const response = await fetch(`${url}/rest/v1/bug_reports`, {
    method: "POST",
    headers: {
      ...adminHeaders(secretKey),
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      id: reportId,
      organization_id: member.organizationId,
      reporter_id: member.userId,
      reporter_email: member.email ?? "",
      description,
      context: context.slice(0, 300),
      attachment_path: attachmentPath,
      attachment_mime_type: file?.type ?? "",
    }),
  });
  if (!response.ok)
    return NextResponse.json(
      { error: "Nie udało się wysłać zgłoszenia." },
      { status: 502 },
    );
  return NextResponse.json({ ok: true });
}
