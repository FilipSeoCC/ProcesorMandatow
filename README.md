# FlotaFlow — Procesor Mandatów

> Część portfolio [AIOps](https://www.ai-ops.pl) — wdrożenia AI i automatyzacja procesów dla firm. Zobacz [żywe demo](https://procesor-mandatow.vercel.app/).

Aplikacja dla firm wynajmujących pojazdy (busy, przyczepy), do których trafiają mandaty i wezwania (e-TOLL, straż miejska, policja, GITD) wystawione na właściciela auta, mimo że w danym momencie z pojazdu korzystał klient. FlotaFlow automatyzuje cały łańcuch: **skan pisma → OCR → numer rejestracyjny i data zdarzenia → dopasowanie do historii wynajmu → dane klienta → wezwanie PDF i pakiet do przekazania dalej**.

Pełny opis stanu projektu (co działa, co jest zepsute, pułapki) jest w [`docs/stan-projektu.md`](docs/stan-projektu.md).

## Funkcje

- Skan dokumentu z telefonu → OCR (Google Document AI) → wyciągnięcie numeru rejestracyjnego, daty i godziny zdarzenia,
- automatyczne dopasowanie klienta na podstawie historii wynajmu pojazdu, z ręcznym „Zmień dopasowanie" i cykliczną kolejką ponawiania,
- kartoteka floty i pracowników (kierowców), import/aktualizacja z CSV/XML,
- generowanie wezwania PDF, pakietu do pracownika (e-mail przez Resend) i osobnego pisma do urzędu,
- planer tras dostaw oparty o Google Route Optimization,
- log audytowy, zgłaszanie błędów ze zrzutem ekranu (stały przycisk w rogu, dla każdej roli; lista zgłoszeń — tylko admin),
- każdy użytkownik może sam poprawić swoje imię i nazwisko w Ustawieniach,
- otwarta rejestracja z bramką zatwierdzania — nowe konto nie loguje się, dopóki admin/boss nie nada mu roli,
- role: `admin` (pełny dostęp, zarządzanie kontami), `boss` (jak user + zatwierdzanie spraw i nowych kont), `user` (codzienna obsługa spraw), zarządzanie w widoku **Pracownicy**,
- pełna funkcjonalność na telefonie, te same widoki co na desktopie.

## Uruchomienie lokalnie

```bash
npm install
npm run dev
```

Otwórz [http://localhost:4173](http://localhost:4173). Skopiuj `.env.example` do `.env.local` i uzupełnij zmienne — patrz sekcja niżej.

## Technologie

- Next.js 16 (App Router), React 19, TypeScript,
- Supabase (Postgres + Auth + Storage, RLS wg roli i organizacji),
- Google Document AI (OCR) i Google Route Optimization API przez Vercel OIDC Workload Identity Federation,
- Resend (e-mail),
- Vercel (hosting, cron).

## Konfiguracja produkcyjna

Zmienne środowiskowe (patrz `.env.example`) trzeba ustawić w Vercelu:

- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` — baza i auth,
- `GOOGLE_DOCUMENT_AI_PROCESSOR_ID`, `GOOGLE_DOCUMENT_AI_LOCATION`, `GOOGLE_WIF_AUDIENCE`, `GOOGLE_CLOUD_PROJECT_ID` — OCR i planer tras (WIF, bez klucza),
- `GOOGLE_MAPS_SERVER_API_KEY` — **osobny** klucz do geokodowania adresów w planerze tras (Maps Geocoding API — inne API niż Route Optimization, nadal wymaga klucza),
- `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `MANDATE_REVIEW_EMAIL`, `APP_URL` — wysyłka pakietu do pracownika,
- `CRON_SECRET` — odblokowuje kolejkę ponawiania OCR i auto-dopasowania (`/api/internal/*`, harmonogram w `vercel.json`),
- `ROUTE_OPTIMIZATION_DEMO_MODE` — czy planer tras ma cichym trybem demo zastępować brak konfiguracji Google (domyślnie `false` — bez konfiguracji zwraca błąd zamiast fałszywego wyniku).

Sprawdź stan konfiguracji bez logowania: `curl https://procesor-mandatow.vercel.app/api/health`.

## Model danych Supabase

`supabase/schema.sql` to pełny schemat — **nie jest automatycznie stosowany**, trzeba go ręcznie uruchomić w Supabase SQL Editor po każdej zmianie (wszystko jest idempotentne, `add column if not exists`/`update`). Zawiera: organizacje i członkostwa z rolami, klientów i pojazdów, historię przypisań pojazd→klient (z ograniczeniem wykluczającym nakładające się okresy), zlecenia dostawy i trasy, dokumenty mandatowe z polami finansowymi, log audytowy, RLS.

Pierwsze konto zakłada organizację i zostaje adminem (`bootstrap_organization`), od razu aktywnym. Rejestracja jest zawsze otwarta (bez zaproszenia), ale każde kolejne konto ląduje ze statusem `pending` i rolą `user` — nie może się zalogować, dopóki admin/boss nie nada mu roli w tabeli kont na ekranie **Pracownicy** (ta akcja jednocześnie ustawia status na `active`). Rejestrujący się dostaje od razu e-mail z potwierdzeniem, a drugi — o przyznanym dostępie — dopiero po zatwierdzeniu.

---

Zbudowane przez [AIOps](https://www.ai-ops.pl) — konsulting i wdrożenia AI dla firm w Polsce.
