# Procesor Mandatów — PoC

Responsywny prototyp interfejsu do obsługi korespondencji mandatowej dla firmy zarządzającej flotą pojazdów.

## Zakres demonstracji

- kolejka spraw z wyszukiwaniem i filtrami,
- podgląd zeskanowanego dokumentu,
- dane rozpoznane przez OCR wraz z poziomem pewności,
- dopasowanie użytkownika pojazdu na podstawie daty zdarzenia,
- korekta i zatwierdzanie danych,
- mobilne dodawanie zdjęcia lub pliku PDF/JPG.
- kartoteka floty z aktualnym przypisaniem pojazdu do klienta,
- import i aktualizacja pojazdów z plików CSV lub XML.

Minimalny zakres importu floty: `marka`, `model`, `nr_rej`, `klient`, `data_czas`.

## Podział urządzeń

- **telefon:** dedykowany skaner, kompletowanie stron i przekazanie dokumentu do bazy,
- **desktop:** OCR, kolejka spraw, zarządzanie flotą, dopasowanie klienta i dalsze procesowanie korespondencji.

Interfejs wykorzystuje dane przykładowe. PoC nie zawiera jeszcze backendu, OCR ani trwałego zapisu.

## Uruchomienie

```bash
npm install
npm run dev
```

Następnie otwórz [http://localhost:4173](http://localhost:4173).

## Technologie

- Next.js 16,
- React 19,
- TypeScript,
- CSS Modules,
- Lucide Icons.

## Mobilny planer dostaw

Na telefonie dolna nawigacja rozdziela dwa zadania: `Skaner` oraz `Dostawy`. Planer pozwala wybrać auta, ułożyć kolejność punktów, zmienić ją ręcznie i otworzyć gotową trasę w Google Maps.

Endpoint `POST /api/routes/optimize` działa w dwóch trybach:

- bez konfiguracji — lokalny algorytm demonstracyjny, dzięki któremu PoC działa od razu,
- z `GOOGLE_MAPS_SERVER_API_KEY` i `GOOGLE_CLOUD_PROJECT_ID` — Google Route Optimization API.

Skopiuj `.env.example` do `.env.local` i wpisz nowy, obrócony klucz. Sekret Google nie może mieć prefiksu `NEXT_PUBLIC_` ani trafić do repozytorium. Gdy Google jest skonfigurowane, Route Handler wymaga poprawnej sesji Supabase i roli `admin` albo `dispatcher`.

## Model danych Supabase

Plik `supabase/schema.sql` zawiera fundament bazy dla:

- organizacji i członkostw z rolami `admin`, `dispatcher`, `office`, `scanner`, `viewer`,
- klientów i pojazdów,
- historii przypisania pojazdu do klienta bez nakładających się okresów,
- zleceń dostawy, planów tras i przystanków,
- audytu oraz polityk Row Level Security rozdzielających odczyt i zapis według roli.
- prywatnego bucketa `mandate-documents` i metadanych stron dokumentu.

Po uruchomieniu schematu pierwszy zalogowany użytkownik tworzy firmę przez funkcję RPC `bootstrap_organization`. Skaner zapisuje pliki w Supabase tylko po zweryfikowaniu roli `admin`, `office` lub `scanner`; bez konfiguracji wyraźnie pokazuje tryb demonstracyjny.

Adresy dostaw są przekazywane do Google w celu wyznaczenia trasy. Przed wdrożeniem produkcyjnym należy ująć ten proces w dokumentacji RODO i właściwych umowach powierzenia.
