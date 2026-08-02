import { NextResponse } from "next/server";
import { processQueuedOcrBatch } from "@/lib/ocr-queue";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    // Drains as much of the queue as the time budget allows rather than one
    // document per run — the cron only fires once a day on Vercel's Hobby
    // plan, so a single-document worker would never clear a backlog.
    return NextResponse.json(await processQueuedOcrBatch());
  } catch (error) {
    console.error("OCR queue worker failed", error);
    return NextResponse.json({ error: "OCR queue worker failed" }, { status: 502 });
  }
}
