import PDFDocument from "pdfkit";
import path from "node:path";
import { NextResponse } from "next/server";
import { verifyMember } from "@/lib/supabase-auth";
import { adminHeaders, getSupabaseServerEnv } from "@/lib/supabase-env";
import { writeAuditEvent } from "@/lib/audit";

export const runtime = "nodejs";
const notoSans = path.join(
  process.cwd(),
  "src",
  "assets",
  "NotoSans-Regular.ttf",
);

function buildPdf(values: Record<string, string>) {
  return new Promise<Buffer>((resolve, reject) => {
    // PDFKit defaults to Helvetica, whose AFM metrics are loaded from its
    // package at runtime. Serverless bundles may omit those files, so set the
    // bundled Unicode font as the initial font before PDFKit creates a page.
    const document = new PDFDocument({ size: "A4", margin: 56, font: notoSans });
    const chunks: Buffer[] = [];
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
    document.registerFont("NotoSans", notoSans);
    document.font("NotoSans").fontSize(18).text("WEZWANIE DO ZAPŁATY", { align: "center" });
    document.moveDown(2).font("NotoSans").fontSize(11);
    document.text(`Data wystawienia: ${new Date().toLocaleDateString("pl-PL")}`);
    document.moveDown().text(values.responsible_name || "Odbiorca do uzupełnienia");
    document.text(values.responsible_email || "");
    document.moveDown().text("Dotyczy rozliczenia należności związanej z dokumentem mandatowym.");
    document.moveDown().text(`Numer sprawy: ${values.case_number || "-"}`);
    document.text(`Pojazd: ${values.registration_number || "-"}`);
    document.text(`Data zdarzenia: ${values.event_at || "-"}`);
    document.text(`Nadawca: ${values.sender || "-"}`);
    document.moveDown().text("Prosimy o kontakt z biurem floty w celu uzgodnienia sposobu rozliczenia należności.");
    document.moveDown(3).text("Z poważaniem,");
    document.text("FlotaFlow / Biuro obsługi floty");
    document.end();
  });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const member = await verifyMember(request, ["admin", "office"]);
  if (!member) return NextResponse.json({ error: "Brak dostępu." }, { status: 401 });
  const { url, secretKey } = getSupabaseServerEnv();
  if (!url || !secretKey) return NextResponse.json({ error: "Supabase nie jest skonfigurowany." }, { status: 503 });
  const response = await fetch(`${url}/rest/v1/mandate_documents?select=case_number,registration_number,event_at,sender,responsible_name,responsible_email,confirmed_at&id=eq.${encodeURIComponent(id)}&organization_id=eq.${member.organizationId}`, { headers: adminHeaders(secretKey), cache: "no-store" });
  const rows = (await response.json().catch(() => [])) as Array<Record<string, string>>;
  const document = rows[0];
  if (!response.ok || !document) return NextResponse.json({ error: "Nie znaleziono sprawy." }, { status: 404 });
  if (!document.confirmed_at || !document.responsible_name) return NextResponse.json({ error: "Najpierw zatwierdź dane i odbiorcę wezwania." }, { status: 422 });
  const pdf = await buildPdf(document);
  await writeAuditEvent({ organizationId: member.organizationId, userId: member.userId, action: "payment_notice_generated", entityType: "mandate_document", entityId: id });
  return new NextResponse(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="wezwanie-${(document.case_number || id).replace(/[^a-zA-Z0-9_-]/g, "-")}.pdf`, "Cache-Control": "no-store" } });
}
