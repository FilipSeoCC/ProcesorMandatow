import PDFDocument from "pdfkit";
import path from "node:path";

export const PDF_PAGE = {
  width: 595.28,
  height: 841.89,
  margin: 52,
  contentWidth: 491.28,
};

export const PDF_COLORS = {
  ink: "#0f172a",
  navy: "#1e3a5f",
  blue: "#2563eb",
  blueSoft: "#eff6ff",
  slate: "#475569",
  muted: "#64748b",
  border: "#dbe3ee",
  surface: "#f8fafc",
  white: "#ffffff",
};

const notoSans = path.join(process.cwd(), "src", "assets", "NotoSans-Regular.ttf");

export const PDF_FONTS = {
  regular: notoSans,
  semibold: notoSans,
  bold: notoSans,
};

export type OrganizationLetterhead = {
  name: string;
  address: string;
  email: string;
  phone: string;
};

export function createBrandPdf(info: PDFKit.PDFDocumentOptions["info"]) {
  const document = new PDFDocument({
    size: "A4",
    margins: {
      top: PDF_PAGE.margin,
      right: PDF_PAGE.margin,
      bottom: PDF_PAGE.margin,
      left: PDF_PAGE.margin,
    },
    font: PDF_FONTS.regular,
    info,
    bufferPages: true,
  });
  document.registerFont("NotoRegular", PDF_FONTS.regular);
  document.registerFont("NotoSemibold", PDF_FONTS.semibold);
  document.registerFont("NotoBold", PDF_FONTS.bold);
  document.font("NotoRegular");
  return document;
}

export function collectPdf(document: PDFKit.PDFDocument) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
  });
}

type BrandTextOptions = PDFKit.Mixins.TextOptions & {
  size: number;
  color?: string;
  weight?: "regular" | "semibold" | "bold";
};

export function drawText(
  document: PDFKit.PDFDocument,
  text: string,
  x: number,
  y: number,
  { size, color = PDF_COLORS.ink, weight = "regular", ...options }: BrandTextOptions,
) {
  document.font("NotoRegular").fontSize(size).fillColor(color);
  if (weight === "regular") {
    document.text(text, x, y, options);
    return document;
  }

  // The bundled Unicode TTF is intentionally used for every weight because
  // subset WOFF files render Polish glyphs incorrectly in several PDF viewers.
  // A very light text stroke creates a reliable synthetic semibold/bold while
  // preserving one embedded font and serverless portability.
  const strokeWidth = weight === "bold" ? 0.26 : 0.14;
  document
    .save()
    .lineWidth(strokeWidth)
    .strokeColor(color)
    .text(text, x, y, { ...options, fill: true, stroke: true })
    .restore();
  return document;
}

export function formatDate(value: string | null | undefined, fallback = "Nie wskazano") {
  if (!value) return fallback;
  const calendarDate = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const date = calendarDate
    ? new Date(
        Date.UTC(
          Number(calendarDate[1]),
          Number(calendarDate[2]) - 1,
          Number(calendarDate[3]),
          12,
        ),
      )
    : new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  const formatted = new Intl.DateTimeFormat("pl-PL", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: calendarDate ? "UTC" : "Europe/Warsaw",
  }).format(date);
  return `${formatted} r.`;
}

export function formatDateTime(
  value: string | null | undefined,
  fallback = "Nie wskazano",
) {
  if (!value) return fallback;
  const wallClock = value.match(
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/,
  );
  if (wallClock) {
    return `${formatDate(wallClock[1])}, godz. ${wallClock[2]}:${wallClock[3]}`;
  }
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  const datePart = new Intl.DateTimeFormat("pl-PL", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Warsaw",
  }).format(date);
  const timePart = new Intl.DateTimeFormat("pl-PL", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Warsaw",
  }).format(date);
  return `${datePart} r., godz. ${timePart}`;
}

export function formatMoney(
  amount: string | number | null | undefined,
  currency = "PLN",
) {
  if (amount === null || amount === undefined || amount === "") return "Nie wskazano";
  const number = Number(amount);
  if (!Number.isFinite(number)) return String(amount);
  return new Intl.NumberFormat("pl-PL", {
    style: "currency",
    currency: currency || "PLN",
    minimumFractionDigits: 2,
  }).format(number);
}

export function cleanLine(value: string | null | undefined, fallback = "") {
  const normalized = value?.replace(/\s+/g, " ").trim() || "";
  return normalized || fallback;
}

export function drawLetterhead(
  document: PDFKit.PDFDocument,
  organization: OrganizationLetterhead,
  documentKind: string,
) {
  const left = PDF_PAGE.margin;
  const right = PDF_PAGE.width - PDF_PAGE.margin;

  document.save().rect(0, 0, PDF_PAGE.width, 8).fill(PDF_COLORS.navy).restore();

  const logoY = 32;
  document
    .save()
    .roundedRect(left, logoY, 34, 34, 9)
    .fill(PDF_COLORS.blue)
    .restore();
  drawText(document, "F", left, logoY + 6, {
    size: 16,
    color: PDF_COLORS.white,
    weight: "bold",
    width: 34,
    align: "center",
  });
  drawText(document, cleanLine(organization.name, "FlotaFlow"), left + 44, logoY + 1, {
      size: 15,
      weight: "bold",
      width: 230,
  });
  drawText(document, "BIURO OBSŁUGI FLOTY", left + 44, logoY + 22, {
      size: 7.5,
      color: PDF_COLORS.muted,
      characterSpacing: 0.7,
      width: 230,
  });

  const contact = [
    cleanLine(organization.email),
    cleanLine(organization.phone),
    cleanLine(organization.address),
  ].filter(Boolean);
  if (contact.length) {
    drawText(document, contact.join("  •  "), right - 225, logoY + 2, {
        size: 7.5,
        color: PDF_COLORS.slate,
        width: 225,
        align: "right",
        lineGap: 2,
    });
  }

  document
    .save()
    .strokeColor(PDF_COLORS.border)
    .lineWidth(0.8)
    .moveTo(left, 80)
    .lineTo(right, 80)
    .stroke()
    .restore();

  drawText(document, documentKind.toUpperCase(), left, 90, {
      size: 7,
      color: PDF_COLORS.blue,
      weight: "semibold",
      characterSpacing: 1.1,
      width: PDF_PAGE.contentWidth,
  });
  document.y = 111;
}

export function drawDocumentTitle(
  document: PDFKit.PDFDocument,
  title: string,
  reference: string,
  issuedAt: string,
) {
  const y = document.y;
  drawText(document, title, PDF_PAGE.margin, y, {
    size: 19,
    weight: "bold",
    width: 330,
    lineGap: 1,
  });
  drawText(document, "DATA WYSTAWIENIA", 405, y + 1, {
    size: 7.2,
    color: PDF_COLORS.muted,
    width: 138,
    align: "right",
  });
  drawText(document, issuedAt, 390, y + 14, {
    size: 9,
    weight: "semibold",
    width: 153,
    align: "right",
  });
  drawText(document, "NUMER REFERENCYJNY", 390, y + 34, {
    size: 7.2,
    color: PDF_COLORS.muted,
    width: 153,
    align: "right",
  });
  drawText(document, reference, 390, y + 47, {
    size: 9,
    weight: "semibold",
    width: 153,
    align: "right",
  });
  document.y = Math.max(document.y, y + 76);
}

export function drawAddressCard(
  document: PDFKit.PDFDocument,
  options: {
    label: string;
    name: string;
    lines: string[];
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  },
) {
  const x = options.x ?? PDF_PAGE.margin;
  const y = options.y ?? document.y;
  const width = options.width ?? PDF_PAGE.contentWidth;
  const height = options.height ?? 76;
  document
    .save()
    .roundedRect(x, y, width, height, 8)
    .fill(PDF_COLORS.surface)
    .rect(x, y, 4, height)
    .fill(PDF_COLORS.blue)
    .restore();
  drawText(document, options.label.toUpperCase(), x + 18, y + 13, {
      size: 7,
      color: PDF_COLORS.muted,
      weight: "semibold",
      width: width - 34,
      characterSpacing: 0.9,
  });
  const nameSize = width < 300 ? 9.5 : 10.5;
  const name = cleanLine(options.name, "Dane do uzupełnienia");
  document.font("NotoRegular").fontSize(nameSize);
  const measuredNameHeight = document.heightOfString(name, {
    width: width - 34,
    lineGap: 0.5,
  });
  const nameHeight = Math.min(measuredNameHeight, width < 300 ? 27 : 19);
  drawText(document, name, x + 18, y + 29, {
      size: nameSize,
      weight: "semibold",
      width: width - 34,
      height: nameHeight,
      lineGap: 0.5,
      ellipsis: true,
  });
  const details = options.lines.map((line) => cleanLine(line)).filter(Boolean).join("  •  ");
  if (details) {
    const detailsY = y + 29 + nameHeight + 5;
    drawText(document, details, x + 18, detailsY, {
        size: 8,
        color: PDF_COLORS.slate,
        width: width - 34,
        lineGap: 1.5,
        height: Math.max(12, y + height - detailsY - 7),
        ellipsis: true,
    });
  }
  document.y = Math.max(document.y, y + height);
}

export function drawSectionLabel(
  document: PDFKit.PDFDocument,
  label: string,
  y = document.y,
) {
  drawText(document, label.toUpperCase(), PDF_PAGE.margin, y, {
      size: 7.5,
      color: PDF_COLORS.navy,
      weight: "semibold",
      characterSpacing: 0.9,
      width: PDF_PAGE.contentWidth,
  });
  document.y = y + 17;
}

export function drawDataGrid(
  document: PDFKit.PDFDocument,
  rows: Array<{ label: string; value: string; emphasis?: boolean }>,
  y = document.y,
) {
  const x = PDF_PAGE.margin;
  const gap = 12;
  const columnWidth = (PDF_PAGE.contentWidth - gap) / 2;
  const rowHeight = 38;
  const rowCount = Math.ceil(rows.length / 2);
  const height = rowCount * rowHeight + 8;
  document
    .save()
    .roundedRect(x, y, PDF_PAGE.contentWidth, height, 8)
    .fill(PDF_COLORS.surface)
    .restore();

  rows.forEach((row, index) => {
    const column = index % 2;
    const rowIndex = Math.floor(index / 2);
    const cellX = x + 14 + column * (columnWidth + gap);
    const cellY = y + 10 + rowIndex * rowHeight;
    drawText(document, row.label.toUpperCase(), cellX, cellY, {
        size: 7,
        color: PDF_COLORS.muted,
        width: columnWidth - 22,
        characterSpacing: 0.35,
    });
    drawText(document, cleanLine(row.value, "Nie wskazano"), cellX, cellY + 13, {
        size: row.emphasis ? 11 : 9,
        color: row.emphasis ? PDF_COLORS.blue : PDF_COLORS.ink,
        weight: row.emphasis ? "bold" : "semibold",
        width: columnWidth - 22,
        ellipsis: true,
        height: 17,
    });
  });
  document.y = y + height;
}

export function drawNoticeBox(
  document: PDFKit.PDFDocument,
  title: string,
  text: string,
  y = document.y,
) {
  const x = PDF_PAGE.margin;
  const height = 62;
  document
    .save()
    .roundedRect(x, y, PDF_PAGE.contentWidth, height, 8)
    .fill(PDF_COLORS.blueSoft)
    .strokeColor("#bfdbfe")
    .lineWidth(0.7)
    .stroke()
    .restore();
  drawText(document, title.toUpperCase(), x + 16, y + 12, {
      size: 8,
      color: PDF_COLORS.blue,
      weight: "semibold",
      width: PDF_PAGE.contentWidth - 32,
      characterSpacing: 0.55,
  });
  drawText(document, text, x + 16, y + 28, {
      size: 8.5,
      color: PDF_COLORS.navy,
      width: PDF_PAGE.contentWidth - 32,
      lineGap: 1.5,
      height: 28,
      ellipsis: true,
  });
  document.y = y + height;
}

export function drawSignature(
  document: PDFKit.PDFDocument,
  options: {
    name: string;
    position: string;
    organization: string;
    y?: number;
  },
) {
  const x = 338;
  const y = options.y ?? document.y;
  drawText(document, "Z poważaniem", x, y, {
    size: 8,
    color: PDF_COLORS.muted,
    width: 205,
  });
  document
    .save()
    .strokeColor(PDF_COLORS.border)
    .lineWidth(0.7)
    .moveTo(x, y + 41)
    .lineTo(543, y + 41)
    .stroke()
    .restore();
  drawText(document, cleanLine(options.name, "Osoba upoważniona"), x, y + 48, {
    size: 9,
    weight: "semibold",
    width: 205,
  });
  drawText(
    document,
    [cleanLine(options.position), cleanLine(options.organization)]
      .filter(Boolean)
      .join("  •  "),
    x,
    y + 64,
    { size: 7.5, color: PDF_COLORS.muted, width: 205, lineGap: 1 },
  );
  document.y = Math.max(document.y, y + 88);
}

export function drawFooter(
  document: PDFKit.PDFDocument,
  organization: OrganizationLetterhead,
  reference: string,
) {
  // Keep the footer above PDFKit's bottom-margin threshold. Text placed lower
  // than this can silently create an additional page in server-side renders.
  const y = 765;
  const left = PDF_PAGE.margin;
  const right = PDF_PAGE.width - PDF_PAGE.margin;
  document
    .save()
    .strokeColor(PDF_COLORS.border)
    .lineWidth(0.7)
    .moveTo(left, y)
    .lineTo(right, y)
    .stroke()
    .restore();
  drawText(
    document,
    [cleanLine(organization.name, "FlotaFlow"), cleanLine(organization.email), cleanLine(organization.phone)]
      .filter(Boolean)
      .join("  •  "),
    left,
    y + 10,
    { size: 6.8, color: PDF_COLORS.muted, width: 340 },
  );
  drawText(document, `Dokument: ${reference}`, 392, y + 10, {
      size: 6.8,
      color: PDF_COLORS.muted,
      width: 151,
      align: "right",
  });
}
