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
  formatMoney,
} from "@/lib/pdf-brand";

function internalReference(context: AuthorityContext) {
  return cleanLine(context.caseNumber) || `FLF-${context.documentId.slice(0, 8).toUpperCase()}`;
}

function vehicleName(context: AuthorityContext) {
  return [context.vehicleBrand, context.vehicleModel, context.registrationNumber]
    .map((value) => cleanLine(value))
    .filter(Boolean)
    .join(" • ");
}

function credibleAuthority(value: string) {
  const normalized = cleanLine(value);
  if (!normalized || normalized.length > 140) return "Zgodnie z załączonym zawiadomieniem";
  if (/^(w związku|dotyczy|prosimy|data|zawiadamia)/i.test(normalized)) {
    return "Zgodnie z załączonym zawiadomieniem";
  }
  return normalized;
}

export function buildClientNoticePdf(context: AuthorityContext) {
  const reference = internalReference(context);
  const organization = {
    name: context.organizationName,
    address: context.organizationAddress,
    email: context.organizationEmail,
    phone: context.organizationPhone,
  };
  const document = createBrandPdf({
    Title: `Rozliczenie zdarzenia - ${context.registrationNumber}`,
    Author: cleanLine(context.organizationName, "FlotaFlow"),
    Subject: `Zdarzenie drogowe, sprawa ${reference}`,
  });
  const result = collectPdf(document);

  drawLetterhead(document, organization, "Korespondencja do klienta");
  drawDocumentTitle(
    document,
    "Zawiadomienie o zdarzeniu drogowym",
    reference,
    formatDate(new Date().toISOString()),
  );

  drawAddressCard(document, {
    label: "Adresat",
    name: context.responsibleName,
    lines: [context.responsibleAddress, context.responsibleEmail],
    y: 188,
    height: 76,
  });

  drawSectionLabel(document, "Przedmiot zawiadomienia", 284);
  document
    .fillColor(PDF_COLORS.ink)
    .font("NotoRegular")
    .fontSize(9.3)
    .text(
      `Szanowni Państwo, informujemy, że w odniesieniu do pojazdu ${vehicleName(context) || "wskazanego w sprawie"} wpłynęło zawiadomienie dotyczące zdarzenia z dnia ${formatDateTime(context.eventAt)}. Zgodnie z historią wydania pojazdu pozostawał on w tym czasie w Państwa dyspozycji.`,
      PDF_PAGE.margin,
      304,
      {
        width: PDF_PAGE.contentWidth,
        lineGap: 2.5,
        align: "justify",
      },
    );

  drawSectionLabel(document, "Dane sprawy", 363);
  drawDataGrid(
    document,
    [
      { label: "Numer rejestracyjny", value: context.registrationNumber, emphasis: true },
      { label: "Data i godzina zdarzenia", value: formatDateTime(context.eventAt) },
      { label: "Numer sprawy organu", value: cleanLine(context.caseNumber, "Nie wskazano") },
      { label: "Data pisma", value: formatDate(context.letterDate) },
      { label: "Organ / nadawca", value: credibleAuthority(context.sender) },
      {
        label: "Kwota wskazana w dokumencie",
        value: formatMoney(context.amountGross, context.currency),
        emphasis: Boolean(context.amountGross),
      },
    ],
    382,
  );

  drawNoticeBox(
    document,
    "Wymagane działanie",
    "Prosimy o niezwłoczny kontakt z Biurem Obsługi Floty w celu potwierdzenia użytkownika pojazdu oraz ustalenia dalszego sposobu obsługi i rozliczenia sprawy.",
    512,
  );

  document
    .fillColor(PDF_COLORS.ink)
    .font("NotoRegular")
    .fontSize(9.1)
    .text(
      "W załączeniu przekazujemy kopię otrzymanego zawiadomienia. Prosimy o zweryfikowanie danych i zachowanie numeru referencyjnego w dalszej korespondencji. Niniejsze pismo ma charakter informacyjny; podstawę dalszych czynności stanowi dokument wystawiony przez właściwy organ oraz postanowienia umowy dotyczącej użytkowania pojazdu.",
      PDF_PAGE.margin,
      595,
      {
        width: PDF_PAGE.contentWidth,
        lineGap: 2.5,
        align: "justify",
      },
    );

  drawText(document, "ZAŁĄCZNIK", PDF_PAGE.margin, 679, {
    size: 7.5,
    color: PDF_COLORS.muted,
    weight: "semibold",
    characterSpacing: 0.8,
  });
  drawText(
    document,
    "Kopia dokumentu źródłowego dotyczącego zdarzenia",
    PDF_PAGE.margin,
    694,
    { size: 8.5, width: 245 },
  );

  drawSignature(document, {
    name: context.signerName,
    position: context.signerPosition,
    organization: context.organizationName,
    y: 664,
  });
  drawFooter(document, organization, reference);
  document.end();
  return result;
}
