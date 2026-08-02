import "server-only";
import { adminHeaders, getSupabaseServerEnv } from "@/lib/supabase-env";
import { processMandateOcr } from "@/lib/mandate-ocr";

type OcrPage = { storage_path: string; original_name: string; mime_type: string };

type QueueJobResult =
  | { processed: false }
  | { processed: true; documentId: string };

// One claimed document, start to finish. Throws only on queue-level problems
// (claim/storage); OCR failures are handled inside processMandateOcr, which
// marks the document ocr_failed rather than raising.
export async function processNextQueuedOcr(): Promise<QueueJobResult> {
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

// Vercel's Hobby plan caps cron schedules at once per day, so a worker that
// handled a single document per run would clear at most one backlog item every
// 24 hours. Instead we drain as much of the queue as fits in the function's
// time budget. Documents are claimed one at a time (claim_ocr_job uses FOR
// UPDATE SKIP LOCKED), so overlapping runs stay safe.
//
// The budget stays under the 60s ceiling Vercel's Hobby plan enforces
// regardless of the route's declared maxDuration; on a paid plan it can go
// higher.
const DEFAULT_BUDGET_MS = 45_000;
const MAX_JOBS_PER_RUN = 25;

export async function processQueuedOcrBatch(budgetMs = DEFAULT_BUDGET_MS) {
  const startedAt = Date.now();
  const documentIds: string[] = [];
  const failures: Array<{ documentId?: string; error: string }> = [];
  let stoppedBecause: "empty" | "budget" | "max-jobs" = "empty";

  while (true) {
    if (documentIds.length + failures.length >= MAX_JOBS_PER_RUN) {
      stoppedBecause = "max-jobs";
      break;
    }
    // Check before claiming, not after: a claimed document is already marked
    // "processing", and abandoning it here would leave it stuck until the
    // 15-minute stale-claim window in claim_ocr_job releases it.
    if (Date.now() - startedAt > budgetMs) {
      stoppedBecause = "budget";
      break;
    }
    let result: QueueJobResult;
    try {
      result = await processNextQueuedOcr();
    } catch (error) {
      // One unreadable document must not stop the rest of the queue. It stays
      // "processing" and is re-claimed once the stale window passes.
      const message = error instanceof Error ? error.message : "UNKNOWN";
      console.error("OCR queue job failed", message);
      failures.push({ error: message });
      // A broken queue or missing config is not per-document — retrying it in
      // a tight loop would just burn the budget producing the same error.
      if (message === "SUPABASE_NOT_CONFIGURED") throw error;
      if (message.startsWith("OCR_QUEUE_CLAIM_")) break;
      continue;
    }
    if (!result.processed) break;
    documentIds.push(result.documentId);
  }

  return {
    processed: documentIds.length,
    documentIds,
    failed: failures.length,
    failures,
    stoppedBecause,
    elapsedMs: Date.now() - startedAt,
  };
}
