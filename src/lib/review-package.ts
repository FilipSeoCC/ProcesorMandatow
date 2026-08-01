import "server-only";

type MandateMailData = {
  case_number: string | null;
  registration_number: string | null;
  event_at: string | null;
  letter_date: string | null;
  sender: string | null;
  responsible_name: string;
  responsible_email: string;
};

const escapeHtml = (value: string) =>
  value.replace(/&/g, (character) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]!,
  );

const display = (value: string | null | undefined) => value?.trim() || "—";

export function buildClientMessage(document: MandateMailData) {
  const registration = display(document.registration_number);
  const eventAt = display(document.event_at);
  const deadline = display(document.letter_date);
  return {
    subject: `Wezwanie dotyczące zdarzenia z udziałem pojazdu ${registration}`,
    text: `Dzień dobry,\n\notrzymaliśmy wezwanie dotyczące zdarzenia drogowego z udziałem pojazdu ${registration}, który w dniu ${eventAt} był przypisany do Państwa.\n\nProsimy o zapoznanie się z załączonym pismem i przekazanie informacji, kto użytkował pojazd we wskazanym czasie, zgodnie z warunkami umowy.\n\nData pisma: ${deadline}\nNumer sprawy: ${display(document.case_number)}\n\nW załączeniu przekazujemy kopię otrzymanego wezwania.\n\nW razie pytań prosimy o kontakt.\n\nZ poważaniem,\nBiuro obsługi floty`,
  };
}

export function buildReviewPackage(document: MandateMailData, appUrl: string, documentId: string) {
  const registration = display(document.registration_number);
  const client = display(document.responsible_name);
  const clientMessage = buildClientMessage(document);
  const caseNumber = display(document.case_number);
  const detailsUrl = `${appUrl.replace(/\/$/, "")}/?document=${encodeURIComponent(documentId)}`;
  const text = `Cześć,\n\nSystem przygotował wiadomość do przekazania klientowi w sprawie zdarzenia drogowego.\n\nPojazd: ${registration}\nData zdarzenia: ${display(document.event_at)}\nKlient dopasowany z historii pojazdu: ${client}\nNumer sprawy: ${caseNumber}\nOrgan: ${display(document.sender)}\n\nOtwórz sprawę w panelu: ${detailsUrl}\n\nPrzed przekazaniem sprawdź proszę zgodność danych oraz załącznik.\n\n---------------------------------------------\nGOTOWA TREŚĆ DO PRZESŁANIA KLIENTOWI\n---------------------------------------------\nTemat: ${clientMessage.subject}\n\n${clientMessage.text}`;
  const html = `<p>Cześć,</p><p>System przygotował wiadomość do przekazania klientowi w sprawie zdarzenia drogowego.</p><table><tr><td><strong>Pojazd:</strong></td><td>${escapeHtml(registration)}</td></tr><tr><td><strong>Data zdarzenia:</strong></td><td>${escapeHtml(display(document.event_at))}</td></tr><tr><td><strong>Klient:</strong></td><td>${escapeHtml(client)}</td></tr><tr><td><strong>Numer sprawy:</strong></td><td>${escapeHtml(caseNumber)}</td></tr><tr><td><strong>Organ:</strong></td><td>${escapeHtml(display(document.sender))}</td></tr></table><p><a href="${escapeHtml(detailsUrl)}">Otwórz sprawę w panelu</a></p><p>Przed przekazaniem sprawdź proszę zgodność danych oraz załącznik.</p><hr /><p><strong>GOTOWA TREŚĆ DO PRZESŁANIA KLIENTOWI</strong></p><p><strong>Temat:</strong> ${escapeHtml(clientMessage.subject)}</p><div style="white-space:pre-wrap">${escapeHtml(clientMessage.text)}</div>`;
  return { text, html, clientMessage };
}
