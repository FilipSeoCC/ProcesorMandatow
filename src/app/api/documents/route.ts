import { NextResponse } from "next/server";
import { verifyMember } from "@/lib/supabase-auth";
import { adminHeaders, getSupabaseServerEnv } from "@/lib/supabase-env";
import { detectAuthorityFromOcr } from "@/lib/authority-detection";

type DocumentRow = {
  id: string;
  status: string;
  created_at: string;
  uploaded_by: string | null;
  registration_number: string | null;
  event_at: string | null;
  letter_date: string | null;
  case_number: string | null;
  sender: string | null;
  extraction_confidence: Record<string, number>;
  ocr_text: string | null;
  responsible_name: string;
  responsible_tax_id: string;
  responsible_email: string;
  confirmed_at: string | null;
  resolved_at: string | null;
  mandate_document_pages: Array<{ storage_path: string; page_number: number }>;
};

export async function GET(request: Request) {
  const member = await verifyMember(request, ["admin", "boss", "user"]);
  if (!member)
    return NextResponse.json({ error: "Brak dostępu." }, { status: 401 });
  const { url, secretKey } = getSupabaseServerEnv();
  if (!url || !secretKey)
    return NextResponse.json(
      { error: "Supabase nie jest skonfigurowany." },
      { status: 503 },
    );
  // With the 3-role model every member (admin/boss/user) does full case
  // work, so there's no more restricted "scan only" tier that should have
  // OCR text and customer identifiers hidden from it.
  const select =
    "id,status,created_at,uploaded_by,registration_number,event_at,letter_date,case_number,sender,extraction_confidence,ocr_text,responsible_name,responsible_tax_id,responsible_email,confirmed_at,resolved_at,mandate_document_pages(storage_path,page_number)";
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
      const authority = detectAuthorityFromOcr(
        document.ocr_text,
        document.sender,
      );
      return {
        ...document,
        sender: authority.name || null,
        authority_name: authority.name || null,
        authority_address: authority.address || null,
        authority_confidence: authority.confidence,
        authority_source: authority.source,
        previewUrl,
      };
    }),
  );
  return NextResponse.json({ documents: items });
}
