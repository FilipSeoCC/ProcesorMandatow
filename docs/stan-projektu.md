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
| `supabase/migrations/*.sql` | Schemat, wersjonowany; **stosowany automatycznie w `npm run build`** |

---

## Co działa

- OCR pisma i ekstrakcja: numer rejestracyjny, data i **godzina** zdarzenia,
  numer sprawy, nadawca. Godzina ma znaczenie — pozwala rozróżnić dwa wydania
  tego samego auta w ciągu jednego dnia.
- Rozpoznawanie nadawcy (`src/lib/authority-detection.ts`) obejmuje też
  niemieckie, francuskie i hiszpańskie urzędy (Bußgeldstelle/Ordnungsamt,
  ANTAI/Préfecture, DGT/Ayuntamiento) — numer rejestracyjny jest zawsze
  polski, ale wezwanie może przyjść z zagranicy, jeśli auto dostało mandat
  poza Polską. Adres nadawcy dla tych krajów jest heurystyczny (jak dla
  polskich pism) — dokładność „best effort", nie 100%.
- Automatyczne dopasowanie klienta po OCR oraz ręczne „Zmień dopasowanie".
- Cykliczne dogrywanie dopasowań dla spraw, które nie trafiły za pierwszym razem
  (`/api/internal/documents/rematch`).
- Flota i pracownicy — realny zapis do bazy, edycja, import CSV/XML floty.
- Generowanie wezwania PDF, pakietu do pracownika i pisma do urzędu.
- Log audytowy, zgłaszanie błędów ze zrzutem ekranu (stały przycisk w lewym
  dolnym rogu, nad kartą konta — dla każdej roli; lista/panel zgłoszeń w
  zakładce „Błędy" — tylko `admin`).
- Każdy użytkownik może sam zmienić swoje imię i nazwisko w Ustawieniach
  (`PATCH /api/auth` z `firstName`/`lastName`) — nie ma już hardkodowanej mapy
  nadpisań e-mail→imię w `workspace.tsx` (był tam realny błąd: konto
  fkedziora@wenet.pl wyświetlało się jako „user Kędziora").
- Reset zapomnianego hasła mailem (`/api/auth/reset`, `/reset-hasla`) —
  wykorzystuje wbudowany mechanizm Supabase, działa niezależnie od
  zaparkowanego `RESEND_API_KEY` (patrz punkt 5 niżej).
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
enumie bazy tylko dla zgodności wstecznej (migracja w baseline
`supabase/migrations/` przepisuje istniejące rekordy na `user`) — **nie
używaj ich ponownie** w RLS ani w sprawdzaniu ról w endpointach.

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

### 4. ~~Planer tras nie zapisuje nic do bazy~~ — rozwiązane, ale ma otwarte luki (patrz niżej)

`route_plans`/`route_stops`/`delivery_orders` to prawdziwe tabele (patrz
`supabase/schema.sql`), planer jest w pełni podpięty pod bazę, jest historia
tras (`/api/routes/plan/history` + `[id]`, ekran "Historia tras" w
`delivery-planner.tsx`). To nie jest już otwarty temat.

**Otwarte luki, zdiagnozowane 2026-08-03, nic jeszcze nie zaimplementowane:**

Filip: pojazd nie powinien dać się wybrać do nowej dostawy, dopóki ma
nierozwiązaną (kierowca nie potwierdził) poprzednią — i to jest ok, że przy
braku wolnego pojazdu planer blokuje. Ale: (a) nic dziś faktycznie tego nie
pilnuje po stronie serwera — `POST /api/routes/deliveries` przyjmie ten sam
`vehicleId` drugi raz bez żadnego sprawdzenia, `GET /api/fleet/vehicles` nie
zwraca informacji, że pojazd jest zajęty; (b) jeśli kierowca nigdy nie
potwierdzi dostawy (`route_stops.status` zostaje `'planned'` na zawsze), auto
utknie bez żadnego powiadomienia dla nikogo — trzeba nawigacyjny
badge/przypomnienie; (c) **realny bug znaleziony przy analizie**: `GET/POST/DELETE
/api/routes/plan` filtrują "aktywny plan" po `planned_for=eq.<dzisiaj>` — plan
z wczoraj, który nie został dokończony (nadal ma `status='active'` i
nierozwiązane stopy), staje się niewidoczny i niezarządzalny przez UI (nie
pokaże się w GET, nie da się go superseded'ować przez "Zmień dostawy"), a jego
pojazdy zostają zajęte bez żadnego sposobu na odblokowanie poza ręcznym SQL.
Napraw przez usunięcie filtra `planned_for` z tych trzech miejsc — inwariant
powinien być "jeden aktywny plan na organizację", nie "na dzień". `planned_for`
zostaje jako metadana, nie jako klucz zapytania.
(d) reorder (`move()` w `delivery-planner.tsx`) chowa strzałki góra/dół
całkowicie po `routeStarted` (dowolny stop już rozwiązany) — trzeba pozwolić
zmieniać kolejność **tylko wśród stopów `status==='planned'`**, trzymając
rozwiązane (`delivered`/`failed`) na ich bezwzględnych pozycjach; istniejący
RPC `reorder_route_stops` (`POST /api/routes/plan/reorder`) już przyjmuje
pełną tablicę id, nie trzeba go zmieniać, tylko to, co UI do niego wysyła.
(e) doklejenie nowej dostawy do **już aktywnego** planu bez resetowania całej
trasy nie istnieje — dziś jedyna opcja w trakcie dnia to "Zmień dostawy", które
kasuje/supersede'uje cały plan (`DELETE /api/routes/plan`); potrzebny osobny
`POST /api/routes/plan/stops` doklejający jeden `route_stop` na koniec
istniejącego aktywnego planu.

Ręczna zmiana kolejności przystanków (strzałki góra/dół, dopóki trasa nie
wystartowała) działa poprawnie — sprawdzone i potwierdzone 2026-08-02.
Przycisk "Nawiguj" wcześniej wyglądał na zepsuty z innego powodu:
`target="_blank"` na linku do Google Maps nic nie robi w trybie `standalone`
PWA (`manifest.ts`) na iOS — usunięte.

### 5. `RESEND_API_KEY` — świadomie zaparkowane (**nie zaczynaj od nowa bez pytania Filipa**)

Filip nie ma domeny pocztowej. Zdecydował **2026-08-02, żeby to zaparkować**,
nie próbować obejść.

Sprawdzasz jednym żądaniem, bez logowania:

```bash
curl -s https://procesor-mandatow.vercel.app/api/health
```

`emailConfigured: false` jest **oczekiwane** i zostaje tak, dopóki Filip nie
zdecyduje inaczej. Wysyłka pakietu do pracownika (`review-package`) zwraca
503, a oba maile rejestracyjne (`src/lib/account-emails.ts` —
"dziękujemy za rejestrację" i "przyznano dostęp") po prostu **nie wysyłają
się w ogóle i nie zgłaszają błędu** (funkcje `sendRegistrationReceivedEmail`/
`sendRoleGrantedEmail` cicho wracają, gdy brakuje kluczy) — reszta flow
(blokada logowania, nadanie roli) działa niezależnie od tego.

**Sprawdzone i odrzucone alternatywy — nie proponuj ich ponownie:**

- ~~Edycja treści szablonu Supabase Auth "Confirm signup" bez SMTP~~ —
  **niemożliwe**. Pole Subject/Body w panelu (Supabase/Vercel) jest
  wyszarzone, dopóki nie skonfigurujesz custom SMTP. Współdzielony mailer
  Supabase wysyła wyłącznie domyślną, angielską treść — nie da się
  spersonalizować bez tego samego SMTP/domeny, którego próbujemy uniknąć.
- ~~Nadużycie innego typu maila Supabase (np. reset hasła) jako powiadomienia
  "przyznano dostęp"~~ — odrzucone: user klikający link trafiłby w
  prawdziwy formularz zmiany hasła, nie w informację o dostępie. Myląca
  ścieżka, nie wdrażać.
- Żadnego sposobu wysłania załącznika (skan mandatu w `review-package`) bez
  SMTP nie ma — to twarde ograniczenie Supabase Auth, nie kwestia konfiguracji.

**Jeśli temat wróci**, realne opcje są tylko dwie: zostać przy domyślnym
angielskim mailu Supabase (zero kosztu, brak polskiej treści), albo
skonfigurować SMTP/Resend całościowo — nie ma pośredniej, darmowej ścieżki.
Tania domena z pocztą w pakiecie (~30–60 zł/rok, np. home.pl/OVH) odblokowuje
to jednym ruchem, gdy Filip zdecyduje się to zrobić.

### 6. ~~Schemat bazy trzeba wgrywać ręcznie~~ — rozwiązane 2026-08-02

To już raz wywołało awarię na produkcji: kod zapisywał kolumny, których nie
było w żywej bazie, przez co „Zatwierdź dane" zwracało 502, a ponawianie OCR
500 — bo `supabase/schema.sql` trzeba było wkleić do SQL Editora ręcznie i
osobno pilnować kolejności względem pusha kodu.

Teraz schemat żyje w `supabase/migrations/*.sql` (Supabase CLI, cały dawny
`schema.sql` stał się pierwszą migracją — `20260802000000_baseline_schema.sql`).
`package.json`'s `build` script odpala `supabase db push --db-url
"$SUPABASE_DB_URL" --include-all` **przed** `next build` — migracje stosują
się automatycznie przy każdym deployu, kod i schemat zawsze razem, zero
pamiętania o kolejności. Nowa zmiana schematu = nowy plik w
`supabase/migrations/` (np. `npx supabase migration new nazwa`), commitowany
zwykłym pushem.

**Wymaga `SUPABASE_DB_URL` w Vercelu** (connection string z hasłem do bazy,
z Supabase Dashboard → Database → Connection string — **nie** klucz
REST/Auth). Dopóki ta zmienna nie jest ustawiona, `npm run build` (a więc
każdy deploy) będzie się wywalać na tym kroku — patrz `.agents/log.md` po
szczegóły i status wdrożenia.

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
2. ~~`CRON_SECRET` w Vercelu~~ — ustawione i **zweryfikowane** 2026-08-02 (ręczne "Run" w panelu Cron Jobs, 200 w logach), kolejka OCR i auto-dopasowanie realnie działają.
3. ~~`RESEND_API_KEY`/`RESEND_FROM_EMAIL` w Vercelu~~ — **zaparkowane 2026-08-02**, patrz punkt 5 wyżej. Nie odgrzewaj bez pytania Filipa.
4. **Przejście runbooka OCR na prawdziwych pismach** — poznanie realnej skuteczności.
5. **Testy `extractMandateFields`**.
6. ~~Planer tras — podpiąć do bazy albo ukryć~~ — zrobione, patrz punkt 4 wyżej.
7. **Planer tras: blokada zajętego pojazdu + przypomnienie dla kierowcy + edycja
   trasy w trakcie dnia** — zdiagnozowane 2026-08-03, plan i konkretne miejsca w
   kodzie opisane w punkcie 4 wyżej i w `.agents/log.md` (wpis z 2026-08-03).
   Nic jeszcze nie zaimplementowane — zacznij tu, to jest kolejka Filipa.
8. **`SUPABASE_DB_URL` w Vercelu** — patrz punkt 6 wyżej (automatyczne
   migracje schematu). Bez tej zmiennej `npm run build` sam sobie poradzi
   (pomija migrację z ostrzeżeniem), ale schemat wróci do ręcznego wgrywania.

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
