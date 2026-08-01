@AGENTS.md

## Priorytet do dokończenia: wysyłka e-mail z aplikacji

Aktualny endpoint `POST /api/documents/[id]/review-package` wysyła przez
Resend pakiet sprawy wyłącznie na adres zalogowanego pracownika. To jest
bezpieczny etap MVP: pracownik otrzymuje gotowy szkic i sam decyduje, czy
przesłać go klientowi.

Kolejny etap do zaprojektowania i wdrożenia w UI oraz backendzie:

- utworzenie oraz edycja szkicu wiadomości do klienta z danych sprawy,
- ekran akceptacji z widocznym odbiorcą, treścią i załącznikami,
- dopiero po świadomym zatwierdzeniu pracownika wysyłka na e-mail klienta,
- zapis statusu, identyfikatora dostawcy e-mail, daty oraz użytkownika w
  historii sprawy; brak automatycznej wysyłki wyłącznie na podstawie OCR,
- obsługa błędu, ponowienia i blokada podwójnej wysyłki.

Nie wysyłaj pisma do klienta automatycznie po OCR lub samym dopasowaniu auta.
