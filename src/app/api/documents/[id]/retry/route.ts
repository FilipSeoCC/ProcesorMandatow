import { NextResponse } from "next/server";
import { verifyMember } from "@/lib/supabase-auth";
import { adminHeaders, getSupabaseServerEnv } from "@/lib/supabase-env";
import {
  markMandateOcrProcessing,
  processMandateOcr,
} from "@/lib/mandate-ocr";
import { after } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

type PageRow = {
  storage_path: string;
  page_number: number;
  original_name: string;
  mime_type: string;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: documentId } = await params;
  const member = await verifyMember(request, ["admin", "boss", "user"]);
  if (!member)
    return NextResponse.json({ error: "Brak dostępu." }, { status: 401 });
  const { url, secretKey } = getSupabaseServerEnv();
  if (!url || !secretKey)
    return NextResponse.json(
      { error: "Usługa jest tymczasowo niedostępna. Skontaktuj się z administratorem." },
      { status: 503 },
    );

  const documentResponse = await fetch(
    `${url}/rest/v1/mandate_documents?select=confirmed_at,resolved_at&id=eq.${encodeURIComponent(documentId)}&organization_id=eq.${encodeURIComponent(member.organizationId)}&limit=1`,
    {
      headers: adminHeaders(secretKey),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!documentResponse.ok)
    return NextResponse.json(
      { error: "Nie udało się sprawdzić stanu sprawy." },
      { status: 502 },
    );
  const documents = (await documentResponse.json()) as Array<{
    confirmed_at: string | null;
    resolved_at: string | null;
  }>;
  const document = documents[0];
  if (!document)
    return NextResponse.json(
      { error: "Sprawa nie istnieje lub nie masz do niej dostępu." },
      { status: 404 },
    );
  if (document.resolved_at)
    return NextResponse.json(
      { error: "Nie można ponowić OCR dla zrealizowanej sprawy." },
      { status: 409 },
    );
  if (document.confirmed_at)
    return NextResponse.json(
      { error: "Nie można ponowić OCR po zatwierdzeniu danych sprawy." },
      { status: 409 },
    );

  const pagesResponse = await fetch(
    `${url}/rest/v1/mandate_document_pages?select=storage_path,page_number,original_name,mime_type&document_id=eq.${encodeURIComponent(documentId)}&organization_id=eq.${encodeURIComponent(member.organizationId)}&order=page_number.asc`,
    {
      headers: adminHeaders(secretKey),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!pagesResponse.ok)
    return NextResponse.json(
      { error: "Nie udało się pobrać stron dokumentu." },
      { status: 502 },
    );
  const pages = (await pagesResponse.json()) as PageRow[];
  if (!pages.length)
    return NextResponse.json(
      { error: "Sprawa nie istnieje lub nie masz do niej dostępu." },
      { status: 404 },
    );

  const files = await Promise.all(
    pages.map(async (page) => {
      const download = await fetch(
        `${url}/storage/v1/object/mandate-documents/${page.storage_path}`,
        {
          headers: adminHeaders(secretKey),
          signal: AbortSignal.timeout(20_000),
        },
      );
      if (!download.ok)
        throw new Error(`Storage download failed: ${download.status}`);
      return {
        name: page.original_name,
        type: page.mime_type,
        bytes: await download.arrayBuffer(),
      };
    }),
  ).catch(() => null);

  if (!files)
    return NextResponse.json(
      { error: "Nie udało się pobrać oryginalnych plików." },
      { status: 502 },
    );

  const started = await markMandateOcrProcessing(documentId);
  if (!started)
    return NextResponse.json(
      { error: "Sprawa została w międzyczasie zatwierdzona lub zrealizowana." },
      { status: 409 },
    );
  after(() => processMandateOcr(documentId, files, member.organizationId));
  return NextResponse.json({ ocrStatus: "processing" });
}
