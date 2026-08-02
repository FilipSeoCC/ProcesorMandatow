# Tematy na spotkanie z klientem — czego potrzebujemy

Stan na **2026-08-02**. Lista rzeczy, które musi dostarczyć/zdecydować klient,
żeby móc iść dalej z rozwojem FlotaFlow. Uporządkowane wg tego, co realnie
blokuje pracę, nie wg kolejności odkrycia.

---

## Priorytet 1 — blokuje architekturę, pytać jako pierwsze

### System, w którym prowadzą umowy najmu

**Pytanie do zadania wprost:** *„W czym dziś prowadzicie umowy najmu i czy to
ma API?"*

To jest decyzja, która przesądza o architekturze wszystkiego, co dalej (patrz
`docs/roadmap-automatyzacje.md`). Prawie każda automatyzacja z ich listy
(rozliczenie zwrotu, windykacja, refaktura, serwisy) wymaga pełnego obiektu
najmu — limit km, paliwo przy wydaniu/zwrocie, kaucja, oddział, protokół
stanu. Dziś FlotaFlow ma tylko dwie daty i numer umowy (`vehicle_assignments`).

Dwa warianty do wyboru z klientem:
- **A — FlotaFlow systemem źródłowym** dla najmów. Duży zakres, długi czas,
  konkurencja z tym, co już mają.
- **B — FlotaFlow warstwą nad ich systemem.** Zaciągamy najmy przez API/import,
  sami trzymamy tylko to, czego ich system nie ma. Rekomendowane — szybciej do
  wartości, spójne z pozycjonowaniem cenowym (moduł dokładany, nie zamiennik).

---

## Priorytet 2 — potrzebne do uruchomienia obecnego zakresu (mandaty + e-TOLL)

### e-TOLL — dostęp integracyjny

Proces (potwierdzony z klientem): konto e-TOLL Biznes → wniosek o dostęp
integracyjny / kontakt z pomocą techniczną e-TOLL → dane dostępowe (testowe i
produkcyjne) → dopiero wtedy integracja.

Od klienta potrzebujemy:
- Czy mają konto **e-TOLL Biznes** i kto nim administruje (osoba kontaktowa do
  wniosku).
- **NIP i dane spółki** do wniosku.
- Zgoda: **my** występujemy o dostęp w ich imieniu, czy oni składają wniosek i
  przekazują nam dane.
- Decyzja: **czy w ogóle chcemy API na start, czy najpierw eksport pliku** z
  Internetowego Konta Klienta. Rekomendacja: **zacząć od eksportu pliku** —
  pozwala zbudować i przetestować cały łańcuch (import → dopasowanie →
  rozliczenie) bez czekania na formalności integracyjne.

**Kontekst techniczny, który nie wymaga pytania klienta, ale warto mieć w
pamięci na spotkaniu:** rdzeń dopasowania transakcji do najmu jest już
napisany (`matchVehicleCustomer` — to samo, co robi dla mandatów papierowych).
Nowe jest tylko: import, deduplikacja transakcji, rozliczenie okresowe zamiast
pojedynczej sprawy. Przy tysiącach transakcji miesięcznie obecny model UI
(kolejka spraw, przegląd pozycja po pozycji) się nie nadaje — potrzebny ekran
**samych wyjątków**, nie pełna lista.

### Autostrady koncesyjne i strefy parkowania

e-TOLL obejmuje tylko wybrane drogi krajowe/ekspresowe powyżej 3,5 t DMC
(zespołu pojazdów — bus + przyczepa się łapie). Jeśli busy jeżdżą też płatnymi
autostradami koncesyjnymi (A1, A2, A4) albo parkują w strefach płatnych, to są
**osobne systemy, osobni operatorzy, osobne integracje**.

Do ustalenia z klientem:
- Którymi trasami faktycznie jeżdżą najczęściej.
- Czy mają tam konta rozliczeniowe (nazwy systemów do potwierdzenia z klientem
  — nie zgadujemy z naszej strony).
- Czy to w ogóle warto robić teraz, czy e-TOLL wystarczy na pierwszą wersję.

### Prawdziwe skany mandatów do testu skuteczności OCR

Jest gotowy scenariusz testowy (`docs/mvp-test-runbook.md`, próg 80% na
10–20 dokumentach), ale nikt go nie przeszedł na realnych pismach. Potrzebne:
**10–20 rzeczywistych dokumentów** (mandaty, wezwania e-TOLL, pisma od straży
miejskiej/policji) — najlepiej różnych organów i formatów, żeby test coś
znaczył. Bez tej liczby nie ma podstaw do rozmowy o wdrożeniu ani o cenie —
cała wartość produktu opiera się na tym, że człowiek nie przepisuje danych
ręcznie.

### Dane do pism wychodzących

Aplikacja generuje PDF-y wezwań i pism do organu. Potrzebne:
- Dane spółki do stopki pism (nazwa, adres, NIP, osoba do kontaktu).
- Wzór/treść, jakiej dotąd używali ręcznie — do porównania z tym, co generuje
  system.

### Struktura pracowników i ich adresy mailowe — do nadania ról i uprawnień

Rejestracja w aplikacji jest samoobsługowa (każdy zakłada konto sam), ale
**dostęp trzeba nadać ręcznie** — nowe konto czeka na zatwierdzenie przez
admina/boss, który wybiera mu rolę (`admin` / `boss` / `user`) na ekranie
Pracownicy. Żeby to zrobić świadomie, a nie na wyczucie, potrzebujemy od
klienta:
- **Listy osób, które mają korzystać z aplikacji**, z adresami e-mail, na
  które się zarejestrują (to jest jedyny sposób rozpoznania konta — brak
  jeszcze mechanizmu zaproszeń po imieniu i nazwisku, patrz niżej).
- **Dla każdej osoby: jaką rolę powinna mieć** — `admin` (pełny dostęp,
  zarządzanie kontami), `boss` (jak `user`, plus zatwierdzanie spraw i
  zatwierdzanie nowych kont), `user` (codzienna obsługa spraw/floty/tras).
- Jeśli chcą **oddziały/dyspozytornię** (już wdrożone MVP, dostęp
  admin/boss) — kto z listy powinien mieć do tego dostęp, czyli kto realnie
  potrzebuje roli `boss`, a nie tylko `user`.

Przy okazji zanotować: rejestracja dziś nie zbiera imienia/nazwiska w sposób
gwarantowany dla wszystkich (starsze konta zakładane ręcznie mogły tego nie
mieć) — jeśli klient chce, żeby filtry i lista pracowników zawsze pokazywały
prawdziwe imię i nazwisko, a nie e-mail, warto to ustalić jako wymóg przy
zakładaniu kont (to już częściowo zrobione w kodzie — patrz osobne zadanie
w kolejce).

---

## Priorytet 3 — nie blokuje niczego teraz, ale warto zasygnalizować

### Domena pocztowa — świadomie zaparkowane

Filip nie ma domeny pocztowej, więc wysyłka maili transakcyjnych (powiadomienie
o przyznaniu dostępu, pakiet do pracownika ze skanem) jest **celowo wyłączona**.
Aplikacja działa bez tego — informacje o zatwierdzeniu konta pokazują się
wprost w interfejsie zamiast mailem. Jeśli/gdy pojawi się sens biznesowy, tania
domena z pocztą w pakiecie (~30–60 zł/rok, np. home.pl/OVH) odblokowuje to
jednym ruchem. Nie wymaga decyzji teraz.

### Karty paliwowe — jeśli interesuje ich pozycja „TCO" z roadmapy

Który dostawca kart (Shell, BP, Orlen…) i czy mają dostęp do eksportu
transakcji. Nie pilne — dobrze wiedzieć na przyszłość, żeby ocenić, z czym
będziemy integrować, gdy przyjdzie kolej na tę funkcję.

### Struktura oddziałów — jeśli interesuje ich „dyspozytornia"

Dziś model danych nie zna pojęcia oddziału. Jeśli to ma sens biznesowy: ile
mają lokalizacji i jak dziś decydują o relokacji aut między nimi.

### Podstawa prawna dla scoringu ryzyka / automatycznej kaucji

To nie jest pytanie techniczne. Automatyczne ustalanie kaucji na podstawie
oceny klienta to zautomatyzowane podejmowanie decyzji w rozumieniu **art. 22
RODO** — wymaga podstawy prawnej, informowania klientów, prawa do interwencji
człowieka. Klient (lub jego prawnik) musi to potwierdzić, zanim ktokolwiek
zacznie to kodować. Zasygnalizować teraz, żeby nie było niespodzianki później.

### Windykacja przez SMS/telefon

Automatyczna sekwencja przypomnień e-mail → SMS → telefon wchodzi w prawo
telekomunikacyjne i zgody. Windykacja własnych należności ma inną podstawę
prawną niż marketing, ale i tak wymaga konsultacji przed zbudowaniem automatu
dzwoniącego/wysyłającego SMS-y.

---

## Skrót na start spotkania

Jeśli czasu mało, dwa pytania otwierają resztę rozmowy:

1. **„W czym dziś prowadzicie umowy najmu i czy to ma API?"** — przesądza
   architekturę.
2. **„Macie konto e-TOLL Biznes i kto może złożyć wniosek o dostęp
   integracyjny?"** — przesądza, kiedy można zacząć pracę nad tym modułem.

Reszta listy to rzeczy do zebrania w tle, nie tematy wymagające decyzji na
miejscu.
