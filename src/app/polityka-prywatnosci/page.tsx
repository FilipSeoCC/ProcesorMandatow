import { FileText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Polityka prywatności — FlotaFlow",
  description: "Informacja o przetwarzaniu danych osobowych w systemie FlotaFlow.",
};

const sections: Array<{ id: string; title: string; body: React.ReactNode }> = [
  {
    id: "administrator",
    title: "Administrator danych",
    body: (
      <>
        <p>
          Administratorem danych osobowych przetwarzanych w systemie FlotaFlow jest
          podmiot prowadzący wdrożenie aplikacji dla danej organizacji (operator floty).
        </p>
        <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
          Dokument roboczy — przed uruchomieniem produkcyjnym administrator musi
          uzupełnić tu pełną nazwę firmy, adres siedziby, NIP oraz adres e-mail
          kontaktowy w sprawach ochrony danych.
        </p>
      </>
    ),
  },
  {
    id: "zakres",
    title: "Zakres przetwarzanych danych",
    body: (
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <h3 className="text-[13px] font-bold text-[#172033]">Konta użytkowników</h3>
          <p>Imię, nazwisko, adres e-mail, numer telefonu, rola w organizacji oraz dane uwierzytelniające.</p>
        </div>
        <div>
          <h3 className="text-[13px] font-bold text-[#172033]">Dokumenty mandatowe</h3>
          <p>Skan dokumentu, odczytane dane OCR (numer rejestracyjny, data zdarzenia, nadawca, numer sprawy).</p>
        </div>
        <div>
          <h3 className="text-[13px] font-bold text-[#172033]">Osoby odpowiedzialne za pojazd</h3>
          <p>Imię i nazwisko lub nazwa firmy, NIP/PESEL oraz adres e-mail osoby wskazanej jako użytkownik pojazdu.</p>
        </div>
        <div>
          <h3 className="text-[13px] font-bold text-[#172033]">Flota i trasy</h3>
          <p>Dane pojazdów, przypisania do klientów oraz adresy tras dostaw wprowadzone w planerze.</p>
        </div>
        <div>
          <h3 className="text-[13px] font-bold text-[#172033]">Zgłoszenia błędów</h3>
          <p>Opis zgłoszenia, kontekst techniczny oraz adres e-mail osoby zgłaszającej.</p>
        </div>
      </div>
    ),
  },
  {
    id: "cele",
    title: "Cele i podstawy przetwarzania",
    body: (
      <p>
        Dane przetwarzane są w celu obsługi konta i dostępu do aplikacji (art. 6 ust. 1
        lit. b RODO — wykonanie umowy), identyfikacji osoby odpowiedzialnej za pojazd
        i przesłania jej wezwania do zapłaty (art. 6 ust. 1 lit. f RODO — uzasadniony
        interes administratora związany z prowadzoną działalnością transportową) oraz
        wypełnienia obowiązków prawnych związanych z obsługą korespondencji urzędowej
        (art. 6 ust. 1 lit. c RODO).
      </p>
    ),
  },
  {
    id: "odbiorcy",
    title: "Odbiorcy danych",
    body: (
      <p>
        Dane mogą być powierzane dostawcom infrastruktury technicznej wykorzystywanym
        do działania aplikacji: hosting i utrzymanie aplikacji (Vercel), baza danych
        i uwierzytelnianie (Supabase), rozpoznawanie tekstu na skanach dokumentów
        (Google Cloud Document AI) oraz geokodowanie adresów tras (Google Maps
        Platform). Dostawcy przetwarzają dane wyłącznie na polecenie administratora,
        na podstawie zawartych z nimi umów.
      </p>
    ),
  },
  {
    id: "retencja",
    title: "Okres przechowywania",
    body: (
      <p>
        Dane konta przechowywane są przez czas posiadania dostępu do aplikacji.
        Dane dokumentów mandatowych i osób odpowiedzialnych za pojazd przechowywane
        są przez okres niezbędny do zakończenia sprawy oraz wynikający z przepisów
        o przedawnieniu roszczeń i obowiązków archiwizacyjnych administratora.
      </p>
    ),
  },
  {
    id: "prawa",
    title: "Prawa osób, których dane dotyczą",
    body: (
      <p>
        Osobie, której dane dotyczą, przysługuje prawo dostępu do danych, ich
        sprostowania, usunięcia, ograniczenia przetwarzania, przenoszenia danych oraz
        wniesienia sprzeciwu wobec przetwarzania, a także prawo wniesienia skargi do
        Prezesa Urzędu Ochrony Danych Osobowych. Zakres poszczególnych praw zależy od
        podstawy prawnej przetwarzania danej kategorii danych.
      </p>
    ),
  },
  {
    id: "bezpieczenstwo",
    title: "Bezpieczeństwo danych",
    body: (
      <p>
        Dostęp do danych w aplikacji jest ograniczony do zalogowanych członków
        organizacji, z uprawnieniami zależnymi od przypisanej roli, i wymuszany na
        poziomie bazy danych (reguły Row Level Security). Połączenia z aplikacją są
        szyfrowane, a hasła i tokeny dostępu nie są nigdzie przechowywane w postaci
        jawnej.
      </p>
    ),
  },
  {
    id: "kontakt",
    title: "Zmiany i kontakt",
    body: (
      <p>
        Niniejsza polityka może być aktualizowana wraz z rozwojem aplikacji. Pytania
        dotyczące przetwarzania danych osobowych należy kierować do administratora
        wskazanego w sekcji &bdquo;Administrator danych&rdquo; powyżej.
      </p>
    ),
  },
];

export default function PolitykaPrywatnosciPage() {
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-5 py-10 text-[14px] leading-relaxed text-[#40516a] sm:px-8">
      <Link
        href="/"
        className="mb-8 inline-flex items-center gap-2 text-[13px] font-semibold text-[#2563eb]"
      >
        <FileText size={18} />
        Flota<i>Flow</i> — wróć do aplikacji
      </Link>
      <p className="text-[11px] font-bold uppercase tracking-wide text-[#2563eb]">
        Prywatność i RODO
      </p>
      <h1 className="mt-1 text-[26px] font-extrabold text-[#172033]">
        Polityka prywatności FlotaFlow
      </h1>
      <p className="mt-2 text-[13px] text-[#7a8798]">
        Informacja o przetwarzaniu danych osobowych w systemie obsługi korespondencji
        mandatowej. Wersja z 27 lipca 2026 r.
      </p>
      <div className="mt-10 flex flex-col gap-8">
        {sections.map((section, index) => (
          <section key={section.id} id={section.id}>
            <div className="flex items-baseline gap-3">
              <span className="text-[11px] font-bold text-[#b9c5d5]">
                {String(index + 1).padStart(2, "0")}
              </span>
              <h2 className="text-[16px] font-bold text-[#172033]">{section.title}</h2>
            </div>
            <div className="mt-2 pl-7">{section.body}</div>
          </section>
        ))}
      </div>
    </main>
  );
}
