import PDFDocument from "pdfkit";
import path from "node:path";
import type { AuthorityContext } from "@/lib/authority-context";

export type AuthorityRecipient = {
  name: string;
  address: string;
};

const notoSans = path.join(
  process.cwd(),
  "src",
  "assets",
  "NotoSans-Regular.ttf",
);

const display = (value: string | null | undefined) => value?.trim() || "-";
const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (character) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[
      character
    ]!,
  );

function formatDate(value: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat("pl-PL", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }).format(date);
}

function formatDateTime(value: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat("pl-PL", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date);
}

function localityFromAddress(address: string) {
  const postalLocality = address.match(/\d{2}-\d{3}\s+([^,\n]+)\s*$/);
  if (postalLocality?.[1]) return postalLocality[1].trim();
  return address.split(/[,\n]/).map((part) => part.trim()).filter(Boolean).at(-1) || "-";
}

function drawFlotaFlowHeader(document: PDFKit.PDFDocument) {
  const x = 56;
  const y = 45;
  document.save();
  document.roundedRect(x, y, 28, 28, 7).fill("#2563eb");
  document.fillColor("#ffffff").font("NotoSans").fontSize(14).text("F", x, y + 5, {
    width: 28,
    align: "center",
  });
  document.fillColor("#0f172a").fontSize(14).text("FlotaFlow", x + 38, y + 2);
  document
    .fillColor("#64748b")
    .fontSize(7)
    .text("Biuro Obsługi Floty", x + 38, y + 19);
  document
    .strokeColor("#dbeafe")
    .lineWidth(1)
    .moveTo(x, y + 40)
    .lineTo(539, y + 40)
    .stroke();
  document.restore();
  document.y = y + 55;
}

export function buildAuthorityResponseText(
  context: AuthorityContext,
  recipient: AuthorityRecipient,
) {
  const vehicle = [context.vehicleBrand, context.vehicleModel]
    .filter(Boolean)
    .join(" ");
  return `Miejscowość, data: ${localityFromAddress(context.organizationAddress)}, ${new Date().toLocaleDateString("pl-PL")}

Nadawca:
${display(context.organizationName)}
${display(context.organizationAddress)}

Adresat:
${display(recipient.name)}
${display(recipient.address)}

Znak sprawy / nr pisma urzędowego: ${display(context.caseNumber)}

DOTYCZY: Wskazania użytkownika/kierującego pojazdem nr rej. ${display(context.registrationNumber)}

Odpowiadając na wezwanie z dnia ${formatDate(context.letterDate)} dotyczące naruszenia przepisów ruchu drogowego zarejestrowanego w dniu ${formatDateTime(context.eventAt)} z udziałem pojazdu ${vehicle ? `${vehicle}, ` : ""}nr rej. ${display(context.registrationNumber)}, niniejszym oświadczamy, że wyżej wymieniony pojazd w dacie zdarzenia znajdował się w dyspozycji niżej wskazanej osoby lub podmiotu na podstawie zawartej umowy:

Imię i nazwisko / nazwa: ${display(context.responsibleName)}
Adres e-mail: ${display(context.responsibleEmail)}
Adres zamieszkania / siedziby: ${display(context.responsibleAddress)}
PESEL / NIP: ${display(context.responsibleTaxId)}
Numer umowy: ${display(context.agreementNumber)}
Nr prawa jazdy: -

Wskazana osoba lub firma posiadała odpowiedzialność za użytkowanie pojazdu w podanym przedziale czasowym. W załączeniu przekazujemy kopię otrzymanego wezwania. Wszelką dalszą korespondencję w przedmiotowej sprawie prosimy kierować bezpośrednio do wyżej wskazanego użytkownika.

Z poważaniem,
${display(context.signerName)}
${display(context.signerPosition)}
${display(context.organizationName)}
${context.organizationEmail ? `e-mail: ${context.organizationEmail}` : ""}${context.organizationPhone ? ` | tel.: ${context.organizationPhone}` : ""}`;
}

export function buildAuthorityResponsePdf(
  context: AuthorityContext,
  recipient: AuthorityRecipient,
) {
  return new Promise<Buffer>((resolve, reject) => {
    const document = new PDFDocument({
      size: "A4",
      margin: 56,
      font: notoSans,
      info: {
        Title: `Wskazanie użytkownika pojazdu ${context.registrationNumber}`,
        Author: context.organizationName,
      },
    });
    const chunks: Buffer[] = [];
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
    document.registerFont("NotoSans", notoSans);
    drawFlotaFlowHeader(document);
    document
      .font("NotoSans")
      .fillColor("#0f172a")
      .fontSize(15)
      .text("OŚWIADCZENIE - WSKAZANIE UŻYTKOWNIKA POJAZDU", {
        align: "center",
      });
    document.moveDown(1).fontSize(9.5).text(buildAuthorityResponseText(context, recipient), {
      align: "left",
      lineGap: 1.5,
    });
    document.end();
  });
}

export function buildAuthorityReviewPackage(
  context: AuthorityContext,
  recipient: AuthorityRecipient,
  appUrl: string,
) {
  const detailsUrl = `${appUrl.replace(/\/$/, "")}/?document=${encodeURIComponent(context.documentId)}`;
  const letter = buildAuthorityResponseText(context, recipient);
  const subject = `[DO WYSŁANIA DO URZĘDU] Wskazanie użytkownika pojazdu ${display(context.registrationNumber)} · sprawa ${display(context.caseNumber)}`;
  const text = `Dzień dobry ${display(context.signerName)},

system przygotował osobny pakiet odpowiedzi do urzędu w sprawie ${display(context.caseNumber)}.

Adresat: ${display(recipient.name)}
Pojazd: ${display(context.registrationNumber)}
Data zdarzenia: ${formatDateTime(context.eventAt)}
Wskazany użytkownik: ${display(context.responsibleName)}

W załączeniu znajduje się gotowe pismo PDF oraz kopia dokumentu źródłowego. Przed wysłaniem do urzędu sprawdź dane adresata i osoby wskazanej.

Otwórz sprawę w panelu: ${detailsUrl}

---------------------------------------------
TREŚĆ PISMA DO URZĘDU
---------------------------------------------
${letter}`;
  const html = `<p>Dzień dobry ${escapeHtml(display(context.signerName))},</p><p>System przygotował osobny pakiet odpowiedzi do urzędu.</p><table><tr><td><strong>Adresat:</strong></td><td>${escapeHtml(display(recipient.name))}</td></tr><tr><td><strong>Pojazd:</strong></td><td>${escapeHtml(display(context.registrationNumber))}</td></tr><tr><td><strong>Data zdarzenia:</strong></td><td>${escapeHtml(formatDateTime(context.eventAt))}</td></tr><tr><td><strong>Wskazany użytkownik:</strong></td><td>${escapeHtml(display(context.responsibleName))}</td></tr></table><p>W załączeniu znajduje się gotowe pismo PDF oraz kopia dokumentu źródłowego. Przed wysłaniem do urzędu sprawdź dane adresata i osoby wskazanej.</p><p><a href="${escapeHtml(detailsUrl)}">Otwórz sprawę w panelu</a></p><hr/><p><strong>TREŚĆ PISMA DO URZĘDU</strong></p><div style="white-space:pre-wrap">${escapeHtml(letter)}</div>`;
  return { subject, text, html };
}
