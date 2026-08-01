import { NextResponse } from "next/server";
import { processNextQueuedOcr } from "@/lib/ocr-queue";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await processNextQueuedOcr());
  } catch (error) {
    console.error("OCR queue worker failed", error);
    return NextResponse.json({ error: "OCR queue worker failed" }, { status: 502 });
  }
}
