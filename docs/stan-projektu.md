# Stan projektu FlotaFlow — brief dla kolejnego agenta

Stan na **2026-08-02**. Ten plik opisuje, co jest zrobione, co jest zepsute i co
czeka. Zacznij od niego, potem `AGENTS.md` i `.agents/log.md` (szczegóły
techniczne, chronologicznie).

---

## Czym to jest i dla kogo

Klient prowadzi **wynajem busów**. Najemcy podpinają przyczepę pod hak i wtedy
**zespół pojazdów przekracza 3,5 t DMC**, co uruchamia obowiązek e-TOLL. Najemcy
o tym nie wiedzą albo się nie przejmują, więc kara trafia do właściciela
pojazdu, który musi ustalić, kto miał auto w danym momencie, i przerzucić na
niego koszt.

To samo dotyczy mandatów i wezwań od straży miejskiej czy policji.

FlotaFlow automatyzuje ten łańcuch: **skan pisma → OCR → numer rejestracyjny i
data zdarzenia → dopasowanie do najmu → dane klienta → wezwanie PDF i pakiet do
przekazania dalej**.

**Kluczowa różnica względem zachodniej konkurencji** (Fleetio, fleetster,
Chevin): tamte zakładają, że kierowca jest **pracownikiem**. Tutaj kierowcą jest
**klient wynajmujący auto**, więc efektem jest wskazanie kierującego i refaktura,
a nie notatka w aktach pracownika. To jest nisza i jednocześnie powód, dla
którego gotowe systemy tego nie obsługują w polskich realiach.

---

## Architektura w skrócie

Next.js 16 (App Router, React 19, TypeScript) · Supabase (Postgres + Auth +
Storage, RLS po `organization_id` i roli) · Google Document AI (OCR) i Route
Optimization przez Vercel OIDC Workload Identity Federation · Vercel.

Kod serwerowy rozmawia z Supabase **wyłącznie przez REST z kluczem
service-role** (`adminHeaders()`), nigdy klientem SDK. Dostęp autoryzuje
`verifyMember(request, [role...])`.

Miejsca, które warto znać, zanim cokolwiek ruszysz:

| Plik | Rola |
|---|---|
| `src/lib/mandate-ocr.ts` | OCR + ekstrakcja pól z pisma (regexy pod polskie formaty) |
| `src/lib/vehicle-match.ts` | **Serce aplikacji** — rejestracja + data → pojazd → przypisanie → klient |
| `src/lib/ocr-queue.ts` | Kolejka ponawiania OCR, obrabia partię na wywołanie |
| `src/app/workspace.tsx` | Prawie całe UI zalogowanej aplikacji (~2600 linii) |
| `src/app/employees.tsx` | Widok **Pracownicy** — kierowcy (wszyscy) + tabela kont/ról (admin/boss) |
| `src/lib/account-emails.ts` | Szablony dwóch maili rejestracyjnych (Resend) |
| `supabase/schema.sql` | Schemat; **wymaga ręcznego uruchomienia w Supabase** |

---

## Co działa

- OCR pisma i ekstrakcja: numer rejestracyjny, data i **godzina** zdarzenia,
  numer sprawy, nadawca. Godzina ma znaczenie — pozwala rozróżnić dwa wydania
  tego samego auta w ciągu jednego dnia.
- Automatyczne dopasowanie klienta po OCR oraz ręczne „Zmień dopasowanie".
- Cykliczne dogrywanie dopasowań dla spraw, które nie trafiły za pierwszym razem
  (`/api/internal/documents/rematch`).
- Flota i pracownicy — realny zapis do bazy, edycja, import CSV/XML floty.
- Generowanie wezwania PDF, pakietu do pracownika i pisma do urzędu.
- Log audytowy, zgłaszanie błędów ze zrzutem ekranu, panel administracyjny.
- Otwarta rejestracja (bez zaproszenia) z bramką zatwierdzania — nowe konto nie
  loguje się, dopóki admin/boss nie nada mu roli. Zarządzanie kontami/rolami
  scalone z widokiem **Pracownicy** (tabela kont, widoczna dla admin/boss;
  kierowcy widoczni dla wszystkich) — 3 role: `admin`/`boss`/`user`.
- Planer tras oparty o Google Route Optimization.
- Pełna aplikacja na telefonie — te same funkcje co na desktopie.

---

## Co jest zepsute albo niedokończone — czytaj przed planowaniem

### 1. ~~Nie da się dodać drugiego użytkownika~~ — rozwiązane 2026-08-02

Filip zdecydował: rejestracja jest zawsze otwarta (bez zaproszenia), ale nie
loguje od razu. Model ról uproszczony do trzech:

- `admin` — pełny dostęp, w tym zarządzanie kontami/rolami,
- `boss` — to co `user`, plus zatwierdzanie spraw („Zatwierdź dane") i
  zatwierdzanie nowych kont (może nadać najwyżej `boss`, nie rusza adminów),
- `user` — cała codzienna obsługa spraw/floty/tras, bez zatwierdzania.

Stare, drobniejsze role (`dispatcher`, `office`, `scanner`, `viewer`) zostają w
enumie bazy tylko dla zgodności wstecznej (migracja w `schema.sql` przepisuje
istniejące rekordy na `user`) — **nie używaj ich ponownie** w RLS ani
w sprawdzaniu ról w endpointach.

**Bramka zatwierdzania (dodana 2026-08-02)**: `organization_members` ma teraz
kolumnę `status` (`pending`/`active`, domyślnie `active` — istniejące konta nie
są dotknięte). Każde nowe samodzielnie zarejestrowane konto dostaje
`role='user', status='pending'` i **nie może się zalogować** —
`is_org_member`/`has_org_role` w SQL i sprawdzenie w `POST /api/auth` (branch
logowania) wymagają `status='active'`. Admin/boss nadaje rolę w tabeli kont na
ekranie **Pracownicy** (`PATCH /api/team`), co jednocześnie ustawia
`status='active'` — to jest cała "akceptacja konta", nie ma osobnego kroku.
Dwa maile przez Resend: od razu po rejestracji ("dziękujemy, czekaj na
zatwierdzenie") i po nadaniu roli ("masz dostęp") — patrz
`src/lib/account-emails.ts`. Pierwszy użytkownik organizacji (nie ma kogo
zatwierdzać) zawsze ląduje jako `admin`/`active`.

Zabezpieczenie: nie da się odebrać roli admina samemu sobie, jeśli jest się
jedynym adminem w organizacji.

### 2. Zero testów

Brak skryptu `test` i jakiegokolwiek pliku testowego. Najbardziej opłacalne do
pokrycia jest `extractMandateFields` — czysta funkcja tekst → pola, w której
znaleziono już dwa realne błędy (regex daty gubił `15.07.2026r.`, a ekstraktor
łapał model auta zamiast rejestracji).

### 3. Nieznana skuteczność OCR

Jest gotowy scenariusz w `docs/mvp-test-runbook.md` z kryterium 80 % na 10–20
pismach, ale **nikt go nie przeszedł na prawdziwych dokumentach**. Bez tej
liczby nie ma podstaw ani do wdrożenia, ani do rozmowy o cenie — cała wartość
produktu opiera się na tym, że człowiek nie przepisuje danych ręcznie.

### 4. Planer tras nie zapisuje nic do bazy

`delivery-planner.tsx` trzyma wszystko w stanie lokalnym i `localStorage`. W
interfejsie jest to nawet napisane wprost. Albo podpiąć do bazy, albo ukryć —
zostawienie tak wprowadza użytkownika w błąd.

Ręczna zmiana kolejności przystanków (strzałki góra/dół) działa poprawnie —
sprawdzone i potwierdzone 2026-08-02. Przycisk "Nawiguj" wcześniej wyglądał na
zepsuty z innego powodu: `target="_blank"` na linku do Google Maps nic nie
robi w trybie `standalone` PWA (`manifest.ts`) na iOS — usunięte.

### 5. Brakuje `RESEND_API_KEY` na produkcji

Sprawdzasz jednym żądaniem, bez logowania:

```bash
curl -s https://procesor-mandatow.vercel.app/api/health
```

Stan na 2026-08-02 (po dodaniu `CRON_SECRET` — `ocrQueueConfigured` jest już
`true`, kolejka OCR i auto-dopasowanie działają):

- `emailConfigured: false` — brak `RESEND_API_KEY`/`RESEND_FROM_EMAIL`.
  Wysyłka pakietu do pracownika (`review-package`) zwraca 503, a oba nowe
  maile rejestracyjne (`src/lib/account-emails.ts` — "dziękujemy za
  rejestrację" i "przyznano dostęp") po prostu **nie wysyłają się w ogóle i
  nie zgłaszają błędu** (funkcje `sendRegistrationReceivedEmail`/
  `sendRoleGrantedEmail` cicho wracają, gdy brakuje kluczy) — reszta flow
  (blokada logowania, nadanie roli) działa niezależnie od tego. Trzeba
  ustawić te dwie zmienne w Vercelu, żeby którakolwiek wysyłka mailem
  faktycznie zadziałała.

### 6. Schemat bazy trzeba wgrywać ręcznie

`supabase/schema.sql` nie jest nigdzie automatycznie stosowany. **To już raz
wywołało awarię na produkcji**: kod zapisywał kolumny, których nie było w żywej
bazie, przez co „Zatwierdź dane" zwracało 502, a ponawianie OCR 500. Po każdej
zmianie schematu **uruchom go w Supabase SQL Editor** (wszystko jest na
`add column if not exists`, więc jest idempotentne).

---

## Pułapki, które już raz kosztowały czas

Nie odkrywaj ich drugi raz.

**`vehicle_assignments` ma ograniczenie wykluczające nakładające się zakresy dat
per pojazd** (GiST) plus `check(valid_to > valid_from)`. Zmiana przypisania musi
zamknąć stary wiersz i wstawić nowy — **nigdy nadpisywać w miejscu**, bo to
kasuje historię, na której opiera się całe dopasowywanie mandatów wstecz. Z tego
samego powodu **nie zrównoleglaj importu CSV floty** — równoległe żądania dla
tego samego pojazdu biją się o to ograniczenie.

**Tablice rejestracyjne normalizuj przez `normalizePlate()`** z
`vehicle-match.ts`. Porównanie dokładnym stringiem gdziekolwiek indziej tworzy
duplikaty pojazdów („WA 12345" ≠ „WA12345") i rozbija historię przypisań na dwie.

**Composite foreign keys.** Kilka tabel odwołuje się do par `(organization_id,
id)`. Masowe UPDATE-y między organizacjami wymagają tymczasowego odroczenia tych
ograniczeń w transakcji — zwykła kolejność operacji nie wystarczy.

**PATCH `/api/documents/[id]` jest częściowy.** Aktualizuje wyłącznie pola
obecne w żądaniu. Wcześniej przepisywał cały rekord, przez co każdy zapis
formularza kasował numer sprawy i zerował dane finansowe. Nie wracaj do
budowania pełnego obiektu.

**Nie zwracaj ogólnych komunikatów błędu.** Kilka awarii było niediagnozowalnych,
bo kod połykał prawdziwy powód: geokodowanie mapowało każdą odmowę Google na
„Nie znaleziono tego adresu" (a chodziło o wyłączone API), a zapis sprawy na
„Nie udało się zapisać sprawy" (a chodziło o brakującą kolumnę). Przepuszczaj
komunikat ze źródła.

**`GOOGLE_MAPS_SERVER_API_KEY` jest nadal potrzebny.** Tylko Route Optimization
przeszło na WIF; geokodowanie adresów używa klasycznego Maps Geocoding API z
kluczem. W logu jest sprostowanie błędnej notatki, która doprowadziła do
skasowania tej zmiennej i unieruchomienia planera.

**Zmienne środowiskowe wymagają redeploya, uprawnienia klucza Google nie.**

---

## Co dalej

Kolejność, którą uważam za właściwą:

1. ~~Zapraszanie użytkowników i zarządzanie rolami~~ — zrobione 2026-08-02 (patrz wyżej).
2. ~~`CRON_SECRET` w Vercelu~~ — ustawione 2026-08-02, kolejka OCR i auto-dopasowanie działają.
3. **`RESEND_API_KEY`/`RESEND_FROM_EMAIL` w Vercelu** — bez tego żadna wysyłka mailem (pakiet do pracownika, dwa maile rejestracyjne) nie działa.
4. **Przejście runbooka OCR na prawdziwych pismach** — poznanie realnej skuteczności.
5. **Testy `extractMandateFields`**.
6. **Planer tras** — podpiąć do bazy albo ukryć.

Dalsze plany produktowe (lista automatyzacji od klienta: windykacja, rozliczenie
zwrotu, serwisy, dyspozytornia, karty paliwowe, refaktura mandatów i e-TOLL,
scoring, sygnał sprzedaży) opisane są w **`docs/roadmap-automatyzacje.md`** wraz
z zależnościami i blokującą decyzją architektoniczną. **Nic z tamtej listy nie
jest zaczęte i nie należy zaczynać bez rozmowy z Filipem.**

### e-TOLL — najbliższe naturalne rozszerzenie

Transakcja e-TOLL ma numer rejestracyjny i znacznik czasu, czyli dokładnie to,
czego potrzebuje `matchVehicleCustomer`. **Rdzeń jest już napisany** — dochodzi
import, deduplikacja i rozliczenie okresowe, odpada OCR.

Dwie rzeczy, o których trzeba pamiętać:

- **Skala.** Mandatów są dziesiątki miesięcznie, przejazdów mogą być tysiące.
  Obecny model UI (kolejka spraw, weryfikacja pozycja po pozycji) się do tego
  nie nadaje — potrzebne jest przetwarzanie automatyczne z ekranem **samych
  wyjątków** i agregacja per klient i okres. Import musi być idempotentny, bo
  pliki bywają wysyłane ponownie i nachodzą zakresami.
- **Zacznij od eksportu pliku, nie od API.** Cały łańcuch przetestujesz bez
  czekania na dostępy; integrację automatyczną podmienisz później.

---

## Zasady pracy w tym repozytorium

Nad projektem pracują **dwa agenty** (Claude i Codex), nie zawsze jednocześnie.

- **Przed startem przeczytaj `.agents/log.md`** — ostatnie wpisy pokazują, co
  robił ten drugi i co zostawił otwarte. Zdarzyło się już, że oba agenty
  niezależnie napisały tę samą integrację (wymianę tokenu Google OIDC),
  bo żaden nie sprawdził logu.
- **Po skończeniu dopisz wpis** — ścieżki plików, co zmienione, dlaczego, co
  wymaga sprawdzenia. Bez sekretów, plik jest w repo.
- **Nie pchaj bezpośrednio na `main` bez weryfikacji.** Minimum: `npx tsc
  --noEmit`, `npx eslint <zmienione pliki>`, `npm run build`. Vercel deployuje
  automatycznie z każdego pusha na `main`, więc niesprawdzony commit trafia
  wprost na produkcję.
- **Filip pisze po polsku i oczekuje odpowiedzi po polsku.** Komentarze w
  kodzie i wpisy w logu po angielsku, dokumentacja w `docs/` po polsku.
