import "server-only";
import { adminHeaders, getSupabaseServerEnv } from "@/lib/supabase-env";
import { matchVehicleCustomer } from "@/lib/vehicle-match";
import { gcpWorkloadIdentityClient } from "@/lib/gcp-oidc";

type OcrFile = { name: string; type: string; bytes: ArrayBuffer };
type ExtractedFields = {
  registrationNumber: string | null;
  eventAt: string | null;
  letterDate: string | null;
  caseNumber: string | null;
  sender: string | null;
  confidence: Record<string, number>;
};

function documentAiConfig() {
  const audience = process.env.GOOGLE_WIF_AUDIENCE;
  const processorId = process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID;
  const location = process.env.GOOGLE_DOCUMENT_AI_LOCATION || "eu";
  const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
  if (!audience || !processorId || !projectId) return null;
  return { audience, processorId, location, projectId };
}

const datePattern =
  /\b(?:\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}|\d{1,2}[.\-/]\d{1,2}[.\-/]\d{4})\b/g;

function isoDate(value: string) {
  const ymd = value.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})$/);
  const dmy = value.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/);
  const [year, month, day] = ymd
    ? [ymd[1], ymd[2], ymd[3]]
    : dmy
      ? [dmy[3], dmy[2], dmy[1]]
      : [];
  if (!year || !month || !day) return null;
  const date = new Date(
    `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T00:00:00Z`,
  );
  return Number.isNaN(date.valueOf()) ? null : date.toISOString().slice(0, 10);
}

function dateNear(text: string, labels: RegExp) {
  for (const match of text.matchAll(datePattern)) {
    const context = text.slice(
      Math.max(0, (match.index ?? 0) - 100),
      (match.index ?? 0) + match[0].length + 40,
    );
    if (labels.test(context)) return isoDate(match[0]);
  }
  return null;
}

export function extractMandateFields(rawText: string): ExtractedFields {
  const text = rawText.replace(/\r/g, "").replace(/[ \t]+/g, " ");
  const plateContextMatch = text.match(
    /(?:nr|numer)[\s\S]{0,35}rejestracyj(?:ny|nego|nym)[\s\S]{0,60}?\b([A-Z]{1,6}[ -]?[A-Z0-9]{2,6})\b/i,
  );
  // A real plate always has a digit — a label match without one is a false
  // positive (e.g. the regex latching onto a nearby word), so fall through.
  const plateContext =
    plateContextMatch && /\d/.test(plateContextMatch[1]) ? plateContextMatch : null;
  const plateFallback =
    text
      .match(/\b[A-Z]{1,6}[ -]?[A-Z0-9]{2,6}\b/g)
      ?.find(
        (candidate) => /\d/.test(candidate) && !/^nr\b/i.test(candidate),
      ) ?? null;
  const registrationNumber =
    (plateContext?.[1] || plateFallback)?.replace(/[ -]/g, "").toUpperCase() ??
    null;
  const allDates = [...text.matchAll(datePattern)]
    .map((match) => isoDate(match[0]))
    .filter(Boolean) as string[];
  const eventAtContext = dateNear(text, /zdarzen|naruszen|wykroczen|ujawnion/i);
  const eventAt = eventAtContext ?? allDates[0] ?? null;
  const letterDate =
    dateNear(
      text,
      /wystaw|sporządz|wezwanie z dnia|miejscowość|warszawa|kraków|poznań|wrocław|gdańsk/i,
    ) ??
    allDates.find((date) => date !== eventAt) ??
    null;
  const caseNumber =
    text.match(
      /(?:znak|sygnatura|numer|nr)\s*(?:sprawy|pisma)?\s*[:.#]?\s*([A-Z0-9][A-Z0-9/_\-.]{4,})/i,
    )?.[1] ?? null;
  const senderLines = text
    .split("\n")
    .slice(0, 12)
    .map((line) => line.trim());
  const sender =
    senderLines.find((line) =>
      /straż miejska|inspektorat transportu|canard|policj|urząd/i.test(line),
    ) ??
    senderLines.find((line) =>
      /sp\.?\s*z\.?\s*[o0]\.?\s*[o0]\.?|s\.a\.|spółka/i.test(line),
    ) ??
    null;
  return {
    registrationNumber,
    eventAt,
    letterDate,
    caseNumber,
    sender,
    confidence: {
      registrationNumber: plateContext ? 0.94 : registrationNumber ? 0.68 : 0,
      eventAt: eventAtContext ? 0.86 : eventAt ? 0.4 : 0,
      letterDate: letterDate ? 0.72 : 0,
      caseNumber: caseNumber ? 0.7 : 0,
      sender: sender ? 0.76 : 0,
    },
  };
}

async function readWithDocumentAi(file: OcrFile) {
  const config = documentAiConfig();
  if (!config) throw new Error("OCR_NOT_CONFIGURED");
  const client = gcpWorkloadIdentityClient(config.audience);
  const { token } = await client.getAccessToken();
  if (!token) throw new Error("OCR_AUTH_FAILED");
  const endpoint = `https://${config.location}-documentai.googleapis.com/v1/projects/${config.projectId}/locations/${config.location}/processors/${config.processorId}:process`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      rawDocument: {
        content: Buffer.from(file.bytes).toString("base64"),
        mimeType: file.type || "application/octet-stream",
      },
    }),
    signal: AbortSignal.timeout(55_000),
  });
  const result = (await response.json().catch(() => ({}))) as {
    document?: { text?: string };
    error?: { message?: string };
  };
  if (!response.ok)
    throw new Error(
      `DOCUMENT_AI_${response.status}:${result.error?.message || "processing failed"}`,
    );
  return result.document?.text ?? "";
}

async function updateDocument(
  documentId: string,
  values: Record<string, unknown>,
) {
  const { url, secretKey } = getSupabaseServerEnv();
  if (!url || !secretKey) return;
  const response = await fetch(
    `${url}/rest/v1/mandate_documents?id=eq.${encodeURIComponent(documentId)}`,
    {
      method: "PATCH",
      headers: {
        ...adminHeaders(secretKey),
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(values),
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) throw new Error(`OCR_UPDATE_${response.status}`);
}

export async function processMandateOcr(
  documentId: string,
  files: OcrFile[],
  organizationId: string,
) {
  if (!documentAiConfig()) {
    await updateDocument(documentId, {
      status: "ocr_configuration_required",
      ocr_error: "Google Document AI is not configured",
    });
    return;
  }
  try {
    await updateDocument(documentId, { status: "processing", ocr_error: "" });
    const pageTexts = await Promise.all(files.map(readWithDocumentAi));
    const rawText = pageTexts.join("\n\n--- PAGE ---\n\n").trim();
    const fields = extractMandateFields(rawText);
    const ready = Boolean(fields.registrationNumber && fields.eventAt);

    // Auto-match the vehicle's responsible customer right away so the
    // reviewer opens a case that's already pre-filled, not just OCR text —
    // this is the actual automation the app exists for.
    let match: { name: string; taxId: string; email: string } | null = null;
    if (ready) {
      const { url, secretKey } = getSupabaseServerEnv();
      if (url && secretKey) {
        const result = await matchVehicleCustomer(
          url,
          secretKey,
          organizationId,
          fields.registrationNumber,
          fields.eventAt,
        );
        if (result.matched)
          match = {
            name: result.responsibleName,
            taxId: result.responsibleTaxId,
            email: result.responsibleEmail,
          };
      }
    }

    await updateDocument(documentId, {
      status: ready ? "ready" : "needs_review",
      ocr_text: rawText,
      registration_number: fields.registrationNumber,
      event_at: fields.eventAt,
      letter_date: fields.letterDate,
      case_number: fields.caseNumber,
      sender: fields.sender,
      extraction_confidence: fields.confidence,
      ocr_error: "",
      processed_at: new Date().toISOString(),
      ...(match
        ? {
            responsible_name: match.name,
            responsible_tax_id: match.taxId,
            responsible_email: match.email,
          }
        : {}),
    });
  } catch (error) {
    console.error("Mandate OCR failed", error);
    await updateDocument(documentId, {
      status: "ocr_failed",
      ocr_error:
        error instanceof Error
          ? error.message.slice(0, 500)
          : "Unknown OCR error",
      processed_at: new Date().toISOString(),
    }).catch(() => null);
  }
}
