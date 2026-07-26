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
