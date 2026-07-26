import { NextResponse } from "next/server";
import { verifyMember } from "@/lib/supabase-auth";
import { adminHeaders, getSupabaseServerEnv } from "@/lib/supabase-env";

type DocumentRow = {
  id: string;
  status: string;
  created_at: string;
  registration_number: string | null;
  event_at: string | null;
  letter_date: string | null;
  case_number: string | null;
  sender: string | null;
  extraction_confidence: Record<string, number>;
  mandate_document_pages: Array<{ storage_path: string; page_number: number }>;
};

export async function GET(request: Request) {
  const member = await verifyMember(request, ["admin", "office", "scanner"]);
  if (!member)
    return NextResponse.json({ error: "Brak dostępu." }, { status: 401 });
  const { url, secretKey } = getSupabaseServerEnv();
  if (!url || !secretKey)
    return NextResponse.json(
      { error: "Supabase nie jest skonfigurowany." },
      { status: 503 },
    );
  const select =
    "id,status,created_at,registration_number,event_at,letter_date,case_number,sender,extraction_confidence,mandate_document_pages(storage_path,page_number)";
  const response = await fetch(
    `${url}/rest/v1/mandate_documents?select=${encodeURIComponent(select)}&organization_id=eq.${member.organizationId}&order=created_at.desc&limit=50`,
    {
      headers: adminHeaders(secretKey),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok)
    return NextResponse.json(
      {
        error:
          response.status === 400
            ? "Schemat OCR nie został jeszcze zaktualizowany."
            : "Nie udało się pobrać dokumentów.",
      },
      { status: 502 },
    );
  const documents = (await response.json()) as DocumentRow[];
  const items = await Promise.all(
    documents.map(async (document) => {
      const firstPage = [...document.mandate_document_pages].sort(
        (a, b) => a.page_number - b.page_number,
      )[0];
      let previewUrl: string | null = null;
      if (firstPage) {
        const signed = await fetch(
          `${url}/storage/v1/object/sign/mandate-documents/${firstPage.storage_path}`,
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
        if (signed.ok) {
          const body = (await signed.json()) as {
            signedURL?: string;
            signedUrl?: string;
          };
          const path = body.signedURL || body.signedUrl;
          if (path)
            previewUrl = path.startsWith("http")
              ? path
              : `${url}/storage/v1${path}`;
        }
      }
      return { ...document, previewUrl };
    }),
  );
  return NextResponse.json({ documents: items });
}
