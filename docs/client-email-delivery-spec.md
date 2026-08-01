# Wysyłka pisma do klienta - kontrakt wdrożenia

## Zasada bezpieczeństwa

OCR i automatyczne dopasowanie wyłącznie przygotowują szkic. Pismo do klienta
może wysłać tylko rola `admin` lub `office`, po ręcznej akceptacji danych,
odbiorcy, treści i załączników.

## Dane pobierane automatycznie

| Fragment pisma | Źródło |
| --- | --- |
| Numer sprawy, organ, data i godzina zdarzenia | `mandate_documents` |
| Marka, model, rejestracja | `vehicles` po rejestracji dokumentu |
| Klient, e-mail, telefon, adres, NIP/PESEL | `customers`, przez `vehicle_assignments` obejmujące czas zdarzenia |
| Numer umowy | `vehicle_assignments.agreement_number` |
| Nazwa floty, e-mail i telefon biura | `organizations.name`, `contact_email`, `contact_phone` |
| Osoba przygotowująca | zalogowany użytkownik Supabase |

## Formularz admina: Dane biura

W ustawieniach organizacji dodaj sekcję „Dane nadawcy pism” z polami:

- nazwa firmy;
- e-mail Biura Obsługi Floty (wymagany przed wysyłką);
- telefon Biura Obsługi Floty (wymagany przed wysyłką);
- adres korespondencyjny (opcjonalny, potrzebny do PDF);
- domyślna stopka/podpis (opcjonalna).

## Formularz biura: Przed wysłaniem

Pokazuj kompaktowy, edytowalny podgląd z trzema blokami: „Dane zdarzenia”,
„Odbiorca” oraz „Wiadomość i załączniki”. Waliduj e-mail na blur i pokaż błąd
przy polu. Przycisk końcowy ma brzmieć „Wyślij do klienta” i wymagać modalnego
potwierdzenia z adresem odbiorcy. Zapisz użytkownika, datę, provider ID i kopię
zaakceptowanej treści; blokuj podwójną wysyłkę.

## Treść

Temat: `Rozliczenie naruszenia przepisów ruchu drogowego - sprawa nr [NUMER]`

Treść ma wykorzystywać polskie daty, markę/model/rejestrację, klienta oraz
kontakt biura. Nie wolno deklarować winy klienta ani automatycznie obciążać go
kwotą; prośba dotyczy kontaktu, ustalenia rozliczenia lub wskazania faktycznego
użytkownika pojazdu.

## Drugi typ korespondencji: odpowiedź do urzędu

W panelu sprawy dodaj niezależną akcję `Przygotuj odpowiedź do urzędu` obok
`Wyślij do klienta`. Pierwsza wersja wysyła gotowy pakiet na e-mail zalogowanego
pracownika; docelowa akcja `Wyślij do urzędu` wymaga dodatkowego, modalnego
potwierdzenia adresata oraz treści.

### Dodatkowe dane sprawy

- `authority_name`, `authority_email`, `authority_address` - zawsze do
  weryfikacji ręcznej, OCR może jedynie podpowiedzieć nazwę;
- `letter_date` - data wezwania urzędu;
- `customer.address` oraz `customer.tax_id` - dane wskazywanego użytkownika;
- `vehicle_assignments.agreement_number` i okres przypisania;
- `driver_license_number` - opcjonalne pole, tylko gdy osoba wskazywana jest
  faktycznie kierującym i dane są potwierdzone w bazie;
- osoba podpisująca: imię, nazwisko i stanowisko z profilu pracownika lub
  danych organizacji.

Nie wstawiaj numeru prawa jazdy, adresu ani PESEL/NIP, jeśli brakuje ich w
zweryfikowanej bazie. W przypadku klienta firmowego pismo ma wskazywać firmę i
osobę kontaktową wyłącznie, gdy jest to zgodne z umową oraz treścią wezwania.

### Szablon odpowiedzi do urzędu

`[Miejscowość], [DATA]`

`[NAZWA_FIRMY]`  
`[ADRES_FIRMY]`

`[NAZWA_URZĘDU]`  
`[ADRES_URZĘDU]`

`Znak sprawy: [NUMER_SPRAWY]`

`Dotyczy: wskazania użytkownika/kierującego pojazdem [REJESTRACJA]`

Odpowiadając na wezwanie z dnia `[DATA_WEZWANIA]`, dotyczące zdarzenia z dnia
`[DATA_I_GODZINA_ZDARZENIA]` z udziałem pojazdu `[MARKA_MODEL]` o numerze
rejestracyjnym `[REJESTRACJA]`, oświadczamy, że pojazd w tym czasie znajdował
się w dyspozycji niżej wskazanego podmiotu na podstawie umowy `[NUMER_UMOWY]`.

`Nazwa / imię i nazwisko: [KLIENT]`  
`Adres: [ADRES_KLIENTA]`  
`E-mail: [E_MAIL_KLIENTA]`  
`PESEL / NIP: [IDENTYFIKATOR - JEŚLI WYMAGANY]`  
`Nr prawa jazdy: [TYLKO JEŚLI POTWIERDZONY]`

Wszelką dalszą korespondencję prosimy kierować zgodnie z właściwym trybem
wskazanym przez organ. W załączeniu przekazujemy dokument potwierdzający okres
udostępnienia pojazdu, o ile został zweryfikowany przez pracownika.

`[IMIĘ I NAZWISKO OSOBY UPOWAŻNIONEJ]`  
`[STANOWISKO]`  
`[NAZWA_FIRMY]`
