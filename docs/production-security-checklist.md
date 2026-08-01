# Produkcyjne minimum bezpieczeństwa

## Przed wpuszczeniem pracowników

- Wyłącz publiczną rejestrację i wdroż zaproszenia wysyłane wyłącznie przez administratora.
- W Supabase Auth włącz potwierdzanie adresu e-mail oraz MFA (TOTP) dla administratorów.
- W Vercel ustaw ochronę przed nadużyciami dla `POST /api/auth` i limit żądań dla uploadu dokumentów.
- Dodaj oddzielne środowisko Supabase i Vercel dla testów; produkcji nie używa się do testowania zmian.
- Włącz alerty błędów Vercel i skonfiguruj retencję logów zgodną z polityką firmy.
- Skonfiguruj monitor uptime na `GET /api/health`: alarm przy HTTP 503 oznacza brak łączności z Supabase; wynik zawiera wyłącznie stan usług, bez danych ani sekretów.
- Potwierdź, że Storage buckets są prywatne, a `SUPABASE_SECRET_KEY` nie występuje w żadnej zmiennej `NEXT_PUBLIC_*`.

## Operacje

- Przeglądaj log audytowy przed usunięciem dokumentu lub zmianą danych sprawy.
- Rotuj klucze API natychmiast po ich ujawnieniu i co najmniej raz w roku.
- Przetestuj odtworzenie danych z backupu Supabase przed rozpoczęciem pracy produkcyjnej.
- Każdą zmianę bazy zapisuj jako migrację SQL i wdrażaj najpierw na środowisko testowe.

## OCR

- Dla produkcji przenieś OCR do trwałej kolejki z ponawianiem zadań. Uruchamianie OCR po odpowiedzi HTTP jest wystarczające dla PoC, ale nie gwarantuje przetworzenia dokumentu po limicie wykonania funkcji.
- Dodaj w Vercel `CRON_SECRET` jako zmienną Sensitive i zaplanuj wywołanie `GET /api/internal/ocr/process` z nagłówkiem `Authorization: Bearer <CRON_SECRET>`. Worker obsługuje jedno zadanie na wywołanie, ponawia nieudane OCR maksymalnie trzy razy i przejmuje porzucone zadania po 15 minutach.
