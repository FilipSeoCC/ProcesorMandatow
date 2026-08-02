# Roadmapa automatyzacji — lista życzeń klienta

Zapisane 2026-08-02. **Nic z tego nie jest wdrożone.** Dokument istnieje po to,
żeby przy powrocie do tematu nie zaczynać od zera i nie podejmować drugi raz
tych samych decyzji.

Źródło: zrzut ekranu z panelu klienta („Włączone automatyzacje", 7/8 aktywnych).
Klient to firma **wynajmu / CFM**, nie flota pracownicza — świadczą o tym kaucje,
oddziały, zwroty i relokacje. To potwierdza pozycjonowanie: rynek zachodni
(Fleetio, fleetster, Chevin) zakłada, że kierowca jest pracownikiem, a tu
kierowcą jest klient.

## Lista z panelu klienta

| # | Nazwa | Co ma robić |
|---|---|---|
| 1 | Windykacja-drabinka | Sekwencja przypomnień o płatności: e-mail → SMS → telefon, eskalacja w czasie |
| 2 | Automatyczne rozliczenie zwrotu | Nadlimit km, paliwo, ubytki, rozliczenie kaucji bez ręcznej pracy |
| 3 | Planowanie serwisów i opon | Przeglądy i wymiana opon, rezerwacja okien postoju między najmami |
| 4 | Dyspozytornia floty | Sugestie relokacji aut między oddziałami wg popytu i zwrotów |
| 5 | Karty paliwowe → TCO | Zaciąganie transakcji z kart i doliczanie do kosztu posiadania pojazdu |
| 6 | Refaktura mandatów i e-TOLL | Dopasowanie mandatów i opłat drogowych do najmu, refaktura na klienta |
| 7 | Scoring ryzyka | Ocena klienta przy rezerwacji, automatyczna wysokość kaucji |
| 8 | Sygnał „kiedy sprzedać" | Moment wymiany auta, gdy koszty i przebieg biją prognozowaną wartość |

Pozycja 8 była **wyłączona** na zrzucie — pozostałe włączone.

## Co już mamy

Pozycja **6 to w połowie nasze obecne MVP**. `matchVehicleCustomer` robi
dokładnie rdzeń tej funkcji: mandat → pojazd → kto miał auto w dacie zdarzenia →
klient. Brakuje tylko warstwy rozliczeniowej (refaktura) i drugiego źródła
danych (e-TOLL zamiast skanu pisma).

`vehicle_assignments` (pojazd, klient, `valid_from`/`valid_to`,
`agreement_number`) jest **protoplastą najmu**, ale to za mało dla reszty listy.

## Główna decyzja do podjęcia, zanim cokolwiek zaczniemy

**Czy FlotaFlow staje się systemem źródłowym dla najmów, czy warstwą automatyzacji
nad systemem klienta?**

Prawie każda pozycja z listy potrzebuje pełnego obiektu **najmu**: data od/do,
limit km, stan paliwa przy wydaniu i zwrocie, kaucja, cena, oddział, protokół
stanu. Dziś mamy z tego dwie daty i numer umowy.

- **Wariant A — jesteśmy systemem źródłowym.** Budujemy pełny model najmu,
  rezerwacji, cennika, protokołów. To de facto budowa systemu wynajmu od zera.
  Duży zakres, długi czas, i wchodzimy w konkurencję z systemami, które klient
  najpewniej już ma.
- **Wariant B — jesteśmy warstwą nad ich systemem.** Zaciągamy najmy przez API
  lub import, a sami trzymamy tylko to, czego ich system nie ma: dopasowania,
  automatyzacje, rozliczenia. Zdecydowanie szybciej do wartości i spójne z
  pozycjonowaniem cenowym (moduł dokładany, nie zamiennik).

**Rekomendacja: wariant B**, dopóki klient nie powie wprost, że chce wymienić
swój system wynajmu. Pierwsze pytanie na najbliższym spotkaniu powinno brzmieć:
*„w czym dziś prowadzicie umowy najmu i czy to ma API?"*. Odpowiedź przesądza
o architekturze wszystkiego poniżej.

## Zależności

Kolejność nie jest dowolna — część pozycji nie ma sensu bez wcześniejszych.

```
              [ NAJEM ]  ← fundament, bez tego nic z listy nie działa
                 │
      ┌──────────┼───────────┬────────────┐
      │          │           │            │
    (2) zwrot  (6) refaktura (3) serwisy  (7) scoring
      │          │                          ▲
      └────┬─────┘                          │
           │                          historia klienta
      [ ROZLICZENIA / FAKTURY ]
           │
        (1) windykacja

    (5) karty paliwowe → [ TCO / koszty pojazdu ] → (8) kiedy sprzedać

    (4) dyspozytornia ← wymaga oddziałów (multi-location) + sygnału popytu
```

Wnioski z tego grafu:

- **Bez modelu najmu nie ruszamy nic** poza (5), które jest niezależne.
- **(1) windykacja wymaga faktur** — nie da się jej zrobić przed (2) i (6).
- **(8) zależy od (5)** — sygnał sprzedaży bez danych o kosztach to wróżenie.
- **(4) wymaga oddziałów**, których model danych w ogóle dziś nie zna
  (`organizations` to najemca systemu, nie oddział floty).

## Uwagi per pozycja

**(6) Refaktura mandatów i e-TOLL** — najbliżej tego, co mamy. e-TOLL ma API dla
podmiotów, więc to import transakcji + to samo dopasowanie po dacie i pojeździe
co przy mandatach. Największa nowa część to refaktura, czyli dotknięcie
rozliczeń. Naturalny następny krok po obecnym MVP.

**(5) Karty paliwowe → TCO** — technicznie najprostsze i niezależne od najmu:
import transakcji (Orlen, Shell, BP mają pliki/API) i księgowanie kosztu na
pojazd. Wymaga rejestru kosztów pojazdu, którego nie mamy. Dobry kandydat na
„szybką wartość" równolegle do prac nad najmem.

**(2) Automatyczne rozliczenie zwrotu** — prawdopodobnie **największa realna
oszczędność pracy** po stronie klienta, ale wymaga danych, których dziś nie
zbieramy w ogóle: stan licznika i paliwa przy wydaniu i zwrocie, protokół
uszkodzeń. To znaczy, że wymaga też **aplikacji dla osoby wydającej auto** —
zdjęcia, podpis, checklist. Duży kawałek, ale to jest ten, na który klient
najpewniej najbardziej czeka.

**(3) Planowanie serwisów i opon** — kalendarzowo trudne: trzeba znaleźć okno
postoju między najmami, czyli potrzebny jest *przyszły* harmonogram rezerwacji,
nie tylko historia. Silnie zależne od wariantu A/B.

**(7) Scoring ryzyka** — **uwaga prawna**. Automatyczna ocena klienta wpływająca
na wysokość kaucji to zautomatyzowane podejmowanie decyzji w rozumieniu art. 22
RODO. Wymaga podstawy prawnej, informowania klienta, prawa do interwencji
człowieka i wyjaśnienia decyzji. Nie da się tego zrobić „przy okazji" — to
osobny wątek prawny, nie tylko techniczny.

**(1) Windykacja-drabinka** — SMS i telefon wchodzą w prawo telekomunikacyjne i
zgody marketingowe (choć windykacja własnych należności to inna podstawa niż
marketing). Trzeba to skonsultować, zanim zbudujemy automat dzwoniący.

**(4) Dyspozytornia** — najbardziej spekulatywne. „Sugeruje relokacje w oparciu o
popyt" zakłada, że umiemy prognozować popyt per oddział. Bez danych
historycznych z ich systemu to nie ma szans zadziałać. Odłożyć najdalej.

**(8) Kiedy sprzedać** — wymaga wyceny rynkowej pojazdu (Eurotax/DAT/Otomoto) plus
TCO z (5). Klient sam to wyłączył, więc najwyraźniej też widzi to jako odległe.

## Proponowana kolejność

1. **Dokończyć obecne MVP do produkcji** — invite flow, testy OCR, znana
   skuteczność. Bez tego rozmowa o rozbudowie jest przedwczesna.
2. **Ustalić wariant A/B** (pytanie o system najmu i jego API).
3. **(5) Karty paliwowe → TCO** — niezależne, szybka widoczna wartość, buduje
   rejestr kosztów potrzebny później.
4. **(6) Refaktura mandatów + e-TOLL** — rozszerzenie tego, co już działa.
5. **(2) Rozliczenie zwrotu** — największa oszczędność, ale wymaga aplikacji
   wydawania auta.
6. **(1) Windykacja** — dopiero gdy są faktury z (2) i (6).
7. Reszta wg tego, co wyjdzie z rozmów.

## Czego świadomie tu nie ma

Telematyki i GPS. Cała ta lista da się zrobić bez montowania czegokolwiek w
autach, co jest przewagą kosztową względem Samsary i podobnych. Jeśli klient
zapyta o lokalizację w czasie rzeczywistym, to jest zmiana kategorii produktu i
osobna decyzja.
