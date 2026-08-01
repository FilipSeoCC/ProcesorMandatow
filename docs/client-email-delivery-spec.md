# Wysyłka pisma do klienta - kontrakt wdrożenia

## Zasada bezpieczeństwa

OCR i automatyczne dopasowanie wyłącznie przygotowują szkic. Pismo do klienta
może wysłać tylko rola `admin` lub `office`, po ręcznej akceptacji danych,
odbiorcy, treści i załączników.

## Dane pobierane automatycznie

| Fragment pisma | Źródło |
| --- | --- |
| Numer sprawy, organ, data i godzina zdarzenia | `mandate_documents` |
| Marka, model, rejestracja | `vehicles` po rejestracji dokumentu |
| Klient, e-mail, telefon, adres, NIP/PESEL | `customers`, przez `vehicle_assignments` obejmujące czas zdarzenia |
| Numer umowy | `vehicle_assignments.agreement_number` |
| Nazwa floty, e-mail i telefon biura | `organizations.name`, `contact_email`, `contact_phone` |
| Osoba przygotowująca | zalogowany użytkownik Supabase |

## Formularz admina: Dane biura

W ustawieniach organizacji dodaj sekcję „Dane nadawcy pism” z polami:

- nazwa firmy;
- e-mail Biura Obsługi Floty (wymagany przed wysyłką);
- telefon Biura Obsługi Floty (wymagany przed wysyłką);
- adres korespondencyjny (opcjonalny, potrzebny do PDF);
- domyślna stopka/podpis (opcjonalna).

## Formularz biura: Przed wysłaniem

Pokazuj kompaktowy, edytowalny podgląd z trzema blokami: „Dane zdarzenia”,
„Odbiorca” oraz „Wiadomość i załączniki”. Waliduj e-mail na blur i pokaż błąd
przy polu. Przycisk końcowy ma brzmieć „Wyślij do klienta” i wymagać modalnego
potwierdzenia z adresem odbiorcy. Zapisz użytkownika, datę, provider ID i kopię
zaakceptowanej treści; blokuj podwójną wysyłkę.

## Treść

Temat: `Rozliczenie naruszenia przepisów ruchu drogowego - sprawa nr [NUMER]`

Treść ma wykorzystywać polskie daty, markę/model/rejestrację, klienta oraz
kontakt biura. Nie wolno deklarować winy klienta ani automatycznie obciążać go
kwotą; prośba dotyczy kontaktu, ustalenia rozliczenia lub wskazania faktycznego
użytkownika pojazdu.
