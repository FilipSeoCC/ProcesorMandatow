import type { AuthorityContext } from "@/lib/authority-context";
import {
  PDF_COLORS,
  PDF_PAGE,
  cleanLine,
  collectPdf,
  createBrandPdf,
  drawAddressCard,
  drawDataGrid,
  drawDocumentTitle,
  drawFooter,
  drawLetterhead,
  drawNoticeBox,
  drawSectionLabel,
  drawSignature,
  drawText,
  formatDate,
  formatDateTime,
} from "@/lib/pdf-brand";

export type AuthorityRecipient = {
  name: string;
  address: string;
};

const display = (value: string | null | undefined) =>
  cleanLine(value, "Nie wskazano");

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (character) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[
      character
    ]!,
  );

function localityFromAddress(address: string) {
  const postalLocality = address.match(/\d{2}-\d{3}\s+([^,\n]+)\s*$/);
  if (postalLocality?.[1]) return postalLocality[1].trim();
  return (
    address
      .split(/[,\n]/)
      .map((part) => part.trim())
      .filter(Boolean)
      .at(-1) || "Miejscowość"
  );
}

function vehicleName(context: AuthorityContext) {
  return [context.vehicleBrand, context.vehicleModel, context.registrationNumber]
    .map((value) => cleanLine(value))
    .filter(Boolean)
    .join(" • ");
}

function authorityReference(context: AuthorityContext) {
  return cleanLine(context.caseNumber) || `FLF-${context.documentId.slice(0, 8).toUpperCase()}`;
}

export function buildAuthorityResponseText(
  context: AuthorityContext,
  recipient: AuthorityRecipient,
) {
  const vehicle = [context.vehicleBrand, context.vehicleModel]
    .filter(Boolean)
    .join(" ");
  return `Miejscowość, data: ${localityFromAddress(context.organizationAddress)}, ${formatDate(new Date().toISOString())}

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
Nr prawa jazdy: Nie wskazano

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
  const reference = authorityReference(context);
  const organization = {
    name: context.organizationName,
    address: context.organizationAddress,
    email: context.organizationEmail,
    phone: context.organizationPhone,
  };
  const document = createBrandPdf({
    Title: `Wskazanie użytkownika pojazdu ${context.registrationNumber}`,
    Author: cleanLine(context.organizationName, "FlotaFlow"),
    Subject: `Odpowiedź do organu, sprawa ${reference}`,
  });
  const result = collectPdf(document);

  drawLetterhead(document, organization, "Odpowiedź do organu");
  drawDocumentTitle(
    document,
    "Oświadczenie o wskazaniu użytkownika pojazdu",
    reference,
    formatDate(new Date().toISOString()),
  );

  const cardGap = 12;
  const cardWidth = (PDF_PAGE.contentWidth - cardGap) / 2;
  drawAddressCard(document, {
    label: "Nadawca",
    name: context.organizationName,
    lines: [context.organizationAddress, context.organizationEmail, context.organizationPhone],
    x: PDF_PAGE.margin,
    y: 188,
    width: cardWidth,
    height: 82,
  });
  drawAddressCard(document, {
    label: "Adresat",
    name: recipient.name,
    lines: [recipient.address],
    x: PDF_PAGE.margin + cardWidth + cardGap,
    y: 188,
    width: cardWidth,
    height: 82,
  });

  drawSectionLabel(document, "Odpowiedź na wezwanie", 289);
  drawText(
    document,
    `Dotyczy: wskazania użytkownika pojazdu nr rej. ${display(context.registrationNumber)}`,
    PDF_PAGE.margin,
    307,
    {
      size: 9.5,
      color: PDF_COLORS.navy,
      weight: "semibold",
      width: PDF_PAGE.contentWidth,
    },
  );
  document
    .fillColor(PDF_COLORS.ink)
    .font("NotoRegular")
    .fontSize(8.8)
    .text(
      `Odpowiadając na wezwanie z dnia ${formatDate(context.letterDate)}, dotyczące zdarzenia zarejestrowanego w dniu ${formatDateTime(context.eventAt)} z udziałem pojazdu ${vehicleName(context) || "wskazanego w sprawie"}, oświadczamy, że pojazd znajdował się wówczas w dyspozycji niżej wskazanej osoby lub podmiotu na podstawie zawartej umowy.`,
      PDF_PAGE.margin,
      331,
      {
        width: PDF_PAGE.contentWidth,
        lineGap: 2.2,
        align: "justify",
      },
    );

  drawSectionLabel(document, "Dane wskazanego użytkownika", 407);
  drawDataGrid(
    document,
    [
      { label: "Imię i nazwisko / nazwa", value: context.responsibleName, emphasis: true },
      { label: "PESEL / NIP", value: context.responsibleTaxId },
      { label: "Adres e-mail", value: context.responsibleEmail },
      { label: "Adres zamieszkania / siedziby", value: context.responsibleAddress },
      { label: "Pojazd", value: vehicleName(context) },
      { label: "Numer umowy", value: context.agreementNumber },
    ],
    425,
  );

  drawNoticeBox(
    document,
    "Podstawa wskazania",
    "Dane ustalono na podstawie historii wydania pojazdu i okresu obowiązywania przypisania w systemie zarządzania flotą.",
    557,
  );

  document
    .fillColor(PDF_COLORS.ink)
    .font("NotoRegular")
    .fontSize(8.7)
    .text(
      "Wskazana osoba lub firma odpowiadała za użytkowanie pojazdu w podanym przedziale czasowym. Wszelką dalszą korespondencję w przedmiotowej sprawie prosimy kierować bezpośrednio do wskazanego użytkownika.",
      PDF_PAGE.margin,
      637,
      {
        width: PDF_PAGE.contentWidth,
        lineGap: 2.1,
        align: "justify",
      },
    );

  drawText(document, "ZAŁĄCZNIK", PDF_PAGE.margin, 700, {
    size: 7.4,
    color: PDF_COLORS.muted,
    weight: "semibold",
    characterSpacing: 0.8,
  });
  drawText(
    document,
    "Kopia otrzymanego wezwania / dokumentu źródłowego",
    PDF_PAGE.margin,
    715,
    { size: 8.3, width: 245 },
  );

  drawSignature(document, {
    name: context.signerName,
    position: context.signerPosition,
    organization: context.organizationName,
    y: 685,
  });
  drawFooter(document, organization, reference);
  document.end();
  return result;
}

export function buildAuthorityReviewPackage(
  context: AuthorityContext,
  recipient: AuthorityRecipient,
  appUrl: string,
) {
  const detailsUrl = `${appUrl.replace(/\/$/, "")}/?document=${encodeURIComponent(context.documentId)}`;
  const letter = buildAuthorityResponseText(context, recipient);
  const subject = `[DO WYSŁANIA DO URZĘDU] Wskazanie użytkownika pojazdu ${display(context.registrationNumber)} - sprawa ${display(context.caseNumber)}`;
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
