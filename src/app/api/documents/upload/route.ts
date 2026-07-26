import { NextResponse } from "next/server";
import { verifyMember } from "@/lib/supabase-auth";
import { adminHeaders, getSupabaseServerEnv } from "@/lib/supabase-env";

export const runtime = "nodejs";

const allowedExtensions = new Set(["pdf", "jpg", "jpeg", "png", "tif", "tiff", "heic", "heif"]);

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const files = form?.getAll("files").filter((item): item is File => item instanceof File) ?? [];
  if (!files.length || files.length > 10) return NextResponse.json({ error: "Dodaj od 1 do 10 plików." }, { status: 422 });
  const invalid = files.find((file) => {
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    return !allowedExtensions.has(extension) || file.size <= 0 || file.size > 15 * 1024 * 1024;
  });
  if (invalid) return NextResponse.json({ error: `Nieprawidłowy plik: ${invalid.name}.` }, { status: 422 });
  if (files.reduce((sum, file) => sum + file.size, 0) > 50 * 1024 * 1024) return NextResponse.json({ error: "Dokument przekracza łączny limit 50 MB." }, { status: 413 });

  const { url: supabaseUrl, secretKey: serviceKey } = getSupabaseServerEnv();
  if (!supabaseUrl || !serviceKey) return NextResponse.json({ mode: "demo", documentId: `DEMO-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, pages: files.length });

  const member = await verifyMember(request, ["admin", "office", "scanner"]);
  if (!member) return NextResponse.json({ error: "Brak uprawnień do przesyłania dokumentów." }, { status: 401 });

  const documentId = crypto.randomUUID();
  const serviceHeaders = adminHeaders(serviceKey);
  const storedPaths: string[] = [];
  try {
    for (const [index, file] of files.entries()) {
      const extension = file.name.split(".").pop()!.toLowerCase();
      const path = `${member.organizationId}/${documentId}/${String(index + 1).padStart(2, "0")}.${extension}`;
      const upload = await fetch(`${supabaseUrl}/storage/v1/object/mandate-documents/${path}`, { method: "POST", headers: { ...serviceHeaders, "Content-Type": file.type || "application/octet-stream", "x-upsert": "false" }, body: file, signal: AbortSignal.timeout(30_000) });
      if (!upload.ok) throw new Error(`Storage upload failed: ${upload.status}`);
      storedPaths.push(path);
    }
    const documentInsert = await fetch(`${supabaseUrl}/rest/v1/mandate_documents`, { method: "POST", headers: { ...serviceHeaders, "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify({ id: documentId, organization_id: member.organizationId, uploaded_by: member.userId, page_count: files.length, status: "uploaded" }), signal: AbortSignal.timeout(10_000) });
    if (!documentInsert.ok) throw new Error(`Document insert failed: ${documentInsert.status}`);
    const pagesInsert = await fetch(`${supabaseUrl}/rest/v1/mandate_document_pages`, { method: "POST", headers: { ...serviceHeaders, "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify(files.map((file, index) => ({ organization_id: member.organizationId, document_id: documentId, page_number: index + 1, storage_path: storedPaths[index], original_name: file.name, mime_type: file.type || "application/octet-stream", size_bytes: file.size }))), signal: AbortSignal.timeout(10_000) });
    if (!pagesInsert.ok) throw new Error(`Pages insert failed: ${pagesInsert.status}`);
    return NextResponse.json({ mode: "supabase", documentId, pages: files.length });
  } catch (error) {
    console.error("Document upload failed", error);
    if (storedPaths.length) await fetch(`${supabaseUrl}/storage/v1/object/mandate-documents`, { method: "DELETE", headers: { ...serviceHeaders, "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: storedPaths }) }).catch(() => null);
    return NextResponse.json({ error: "Nie udało się bezpiecznie zapisać dokumentu." }, { status: 502 });
  }
}
