# Namierzanie lokalizacji kierowcy — analiza, nic nie wdrożone

Zapisane 2026-08-02, jako odpowiedź na pytanie: dyspozytor planuje trasę,
daje aplikację kierowcy, w trakcie dnia coś trzeba zmienić — jak to ograć,
skoro kierowca w Mapach i tak zaczyna nawigację od swojej bieżącej lokalizacji.

## Co już mamy — zanim zaczniemy dokładać nowe rzeczy

Zanim ktokolwiek buduje GPS-tracking, warto zauważyć: **część problemu jest
już rozwiązana**. Status każdego przystanku (`route_stops.status`) jest
zapisany w bazie i widoczny z dowolnego urządzenia — dyspozytor, otwierając
plan trasy z biura, już dziś widzi, które przystanki są zrobione, który jest
„najbliższą dostawą" (pierwszy `planned`), i ile zostało. To jest **grube
przybliżenie pozycji kierowcy** („jest gdzieś między przystankiem 3 a 4") bez
żadnego GPS-a, bo to dokładnie ten problem, który wczoraj rozwiązaliśmy
podpinając planer do bazy zamiast `localStorage`.

To, czego **nie mamy**, to precyzyjna pozycja *między* przystankami — np.
„kierowca jest teraz 5 minut od następnego adresu" albo „skręcił nie tam".

## Dlaczego samo Maps już robi właściwą rzecz

Link „Nawiguj" nie ustawia `origin` — to celowe, nie przeoczenie. Bez `origin`
Google Maps sam używa bieżącej lokalizacji GPS urządzenia jako punktu startu.
To jest **poprawne zachowanie dla nawigacji na żywo**: kierowca zawsze
nawiguje od tego, gdzie faktycznie jest, a nie od miejsca, gdzie dyspozytor
sądził, że będzie. Ustawienie sztywnego `origin` byłoby błędem, nie fixem.

Realny problem nie jest więc po stronie kierowcy/Map — jest po stronie
**dyspozytora, który nie widzi, gdzie kierowca faktycznie jest**, więc zmiana
trasy w trakcie dnia to strzelanie po ciemku (może wysłać kierowcę z powrotem
tam, skąd właśnie przyjechał).

## Twarde ograniczenie techniczne — przeczytaj przed planowaniem

**Ciągłe śledzenie GPS w tle nie jest realnie osiągalne jako PWA**, ani na
iOS, ani solidnie na Androidzie. Safari na iOS (a ta aplikacja działa jako
zainstalowany PWA, patrz `manifest.ts`) **nie daje** stronom internetowym
dostępu do lokalizacji, gdy karta/PWA nie jest na pierwszym planie —
uprawnienie do geolokalizacji działa tylko wtedy, gdy aplikacja jest aktywnie
otwarta na ekranie. To nie jest kwestia implementacji, tylko twarde
ograniczenie platformy. Prawdziwe „śledzenie w tle jak w aplikacji kurierskiej"
wymagałoby natywnej aplikacji (Swift/Kotlin albo React Native) — osobny,
znacznie większy projekt.

Nie warto projektować niczego zakładającego ciągłe tło, dopóki nie zapadnie
świadoma decyzja o budowie natywnej aplikacji.

## Rekomendowane podejście — fazowo, od najtańszego

### Faza 1 (rekomendowana na start): jednorazowe „Zgłoś lokalizację"

Przycisk w aplikacji kierowcy: „Zgłoś swoją lokalizację". Kierowca klika,
przeglądarka pyta o zgodę (jeśli jeszcze nie pytała w tej sesji), jedno
zapytanie `navigator.geolocation.getCurrentPosition()`, zapis do bazy z
znacznikiem czasu. Dyspozytor w widoku trasy widzi „Ostatnia znana lokalizacja:
12 min temu, w pobliżu [adres z reverse geocoding]".

Zalety: zero problemów z tłem (działa dokładnie tak samo jak reszta appki),
zgoda jawna i jednorazowa (łatwe do uzasadnienia prawnie — kierowca sam
decyduje, kiedy się zgłosić), minimalny koszt implementacji (jedna kolumna
lub mała tabela, jeden endpoint, jeden przycisk).

Wystarcza to do scenariusza z pytania: dyspozytor przed zmianą trasy prosi
kierowcę (telefonicznie albo przez appkę) o zgłoszenie pozycji, widzi ją,
podejmuje świadomą decyzję o przełożeniu przystanków.

### Faza 2 (opcjonalnie, jeśli Faza 1 okaże się niewystarczająca): ping w tle aplikacji (nie w tle systemu)

Automatyczne zgłaszanie pozycji co kilka minut, ale **tylko dopóki aplikacja
jest otwarta na ekranie kierowcy** (nie prawdziwe tło systemowe — patrz
ograniczenie wyżej). Wymaga:
- jawnego przełącznika „Udostępniaj lokalizację" (kierowca włącza na początku
  trasy, może wyłączyć),
- widocznego, stałego wskaźnika, że śledzenie jest aktywne — nigdy po cichu,
  zarówno ze względu na zaufanie użytkownika, jak i prawdopodobny wymóg RODO,
- zatrzymania się automatycznie po zakończeniu trasy albo po zamknięciu appki.

To jest realna praca (nowy typ zapisu co N minut, UI toggle, wskaźnik stanu),
warta zrobienia dopiero jeśli ręczne „Zgłoś lokalizację" z Fazy 1 okaże się w
praktyce zbyt rzadkie/niewygodne.

### Odrzucone: ciągłe śledzenie w tle systemowym

Wymaga natywnej aplikacji. Nie projektować w ramach obecnego PWA — to byłaby
praca zmarnowana, bo platforma i tak na to nie pozwoli.

## Dane osobowe — zanim to wdrożymy

Lokalizacja pracownika to dane osobowe w rozumieniu RODO, a śledzenie
pracowników ma dodatkowe wymogi (informowanie, cel, proporcjonalność,
możliwe konsultacje z przedstawicielami załogi w niektórych jurysdykcjach).
Nawet Faza 1 (jednorazowe, na żądanie) powinna mieć jasny komunikat, po co
te dane są zbierane i jak długo są przechowywane, zanim trafi do
prawdziwych kierowców.

## Rekomendacja

Zacząć od Fazy 1, jeśli w ogóle — to jest tani, jawny, zgodny z ograniczeniami
platformy krok, który rozwiązuje dokładnie opisany scenariusz (dyspozytor
potrzebuje wiedzieć, gdzie jest kierowca, żeby świadomie przełożyć trasę).
Nie budować Fazy 2 ani tym bardziej pełnego trackingu, dopóki nie okaże się,
że ręczne zgłaszanie realnie nie wystarcza w praktyce.
