# Test MVP: mandat od zdjęcia do klienta

1. Przygotuj 10–20 dokumentów, do których firma ma uprawnienie, oraz tabelę oczekiwanych wyników: numer rejestracyjny, data zdarzenia i właściwy klient.
2. Zaimportuj do floty pojazdy oraz przypisania klientów obejmujące datę każdego zdarzenia.
3. Na iPhone otwórz aplikację w Safari, zaloguj się jako `scanner` lub `office`, zrób zdjęcie każdej strony i wyślij dokument.
4. Na desktopie sprawdź kolejkę: dokument ma przejść przez `uploaded` / `processing` do `ready`, `needs_review` albo `ocr_failed`.
5. Dla każdego dokumentu zapisz wynik: poprawny numer rejestracyjny, poprawna data zdarzenia, poprawnie wskazany klient oraz czas od uploadu do wyniku.
6. Jeśli OCR zawiedzie, użyj „Uruchom OCR ponownie”; worker kolejki ponowi nieudane zadanie maksymalnie trzy razy.
7. Po ręcznej korekcie zatwierdź dane, pobierz wezwanie PDF i sprawdź wpis w `audit_events`.

## Kryterium PoC

PoC jest zaliczony, gdy co najmniej 80% dokumentów daje poprawny numer rejestracyjny i datę zdarzenia bez ręcznego przepisywania, a każdy przypadek niepewny trafia do weryfikacji zamiast do błędnego klienta.
