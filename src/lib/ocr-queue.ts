import "server-only";
import { adminHeaders, getSupabaseServerEnv } from "@/lib/supabase-env";
import { processMandateOcr } from "@/lib/mandate-ocr";

type OcrPage = { storage_path: string; original_name: string; mime_type: string };

export async function processNextQueuedOcr() {
  const { url, secretKey } = getSupabaseServerEnv();
  if (!url || !secretKey) throw new Error("SUPABASE_NOT_CONFIGURED");
  const headers = { ...adminHeaders(secretKey), "Content-Type": "application/json" };
  const claimed = await fetch(`${url}/rest/v1/rpc/claim_ocr_job`, { method: "POST", headers, body: "{}", cache: "no-store" });
  const jobs = (await claimed.json().catch(() => [])) as Array<{ id: string; organization_id: string }>;
  const job = jobs[0];
  if (!claimed.ok) throw new Error(`OCR_QUEUE_CLAIM_${claimed.status}`);
  if (!job) return { processed: false };

  const pagesResponse = await fetch(`${url}/rest/v1/mandate_document_pages?select=storage_path,original_name,mime_type&document_id=eq.${job.id}&order=page_number.asc`, { headers, cache: "no-store" });
  const pages = (await pagesResponse.json().catch(() => [])) as OcrPage[];
  if (!pagesResponse.ok || !pages.length) throw new Error("OCR_QUEUE_PAGES_UNAVAILABLE");
  const files = await Promise.all(pages.map(async (page) => {
    const download = await fetch(`${url}/storage/v1/object/mandate-documents/${page.storage_path}`, { headers, cache: "no-store" });
    if (!download.ok) throw new Error(`OCR_QUEUE_STORAGE_${download.status}`);
    return { name: page.original_name, type: page.mime_type, bytes: await download.arrayBuffer() };
  }));
  await processMandateOcr(job.id, files, job.organization_id);
  return { processed: true, documentId: job.id };
}
