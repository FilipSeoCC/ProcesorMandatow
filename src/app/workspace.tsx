"use client";

import {
  Bell,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  FileText,
  Files,
  ImagePlus,
  Inbox,
  LayoutDashboard,
  Menu,
  MoreHorizontal,
  ScanLine,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { ChangeEvent, useEffect, useMemo, useState } from "react";
import FleetManager from "./fleet-manager";
import MobileCapture from "./mobile-capture";
import styles from "./workspace.module.css";

type CaseStatus = "Do weryfikacji" | "Dopasowano" | "Nowa";

type CaseItem = {
  id: string;
  documentId?: string;
  plate: string;
  sender: string;
  eventAt: string;
  receivedAt: string;
  deadline: string;
  status: CaseStatus;
  customer: string;
  agreement: string;
  previewUrl?: string | null;
  ocrStatus?: string;
};

// Statuses the background OCR job can still move on from by itself —
// worth polling for. Config/failure states need an explicit retry instead.
const pendingOcrStatuses = new Set(["uploaded", "processing"]);
const retryableOcrStatuses = new Set([
  "ocr_configuration_required",
  "ocr_failed",
]);

const demoCases: CaseItem[] = [
  {
    id: "SM/8421/26",
    plate: "WI 2847K",
    sender: "Straż Miejska m.st. Warszawy",
    eventAt: "18.07.2026, 14:32",
    receivedAt: "Dzisiaj, 09:14",
    deadline: "4 dni",
    status: "Do weryfikacji",
    customer: "Nova Bud Sp. z o.o.",
    agreement: "W/2026/0418",
  },
  {
    id: "CAN/1093/26",
    plate: "WW 91R2",
    sender: "CANARD",
    eventAt: "15.07.2026, 08:07",
    receivedAt: "Dzisiaj, 08:46",
    deadline: "8 dni",
    status: "Dopasowano",
    customer: "Marcin Wiśniewski",
    agreement: "W/2026/0381",
  },
  {
    id: "GITD/771/26",
    plate: "WX 5520M",
    sender: "Główny Inspektorat Transportu Drogowego",
    eventAt: "12.07.2026, 19:41",
    receivedAt: "Wczoraj, 15:20",
    deadline: "11 dni",
    status: "Nowa",
    customer: "—",
    agreement: "—",
  },
  {
    id: "SM/8134/26",
    plate: "WPR 77A9",
    sender: "Straż Miejska w Piasecznie",
    eventAt: "09.07.2026, 12:18",
    receivedAt: "Wczoraj, 11:08",
    deadline: "6 dni",
    status: "Dopasowano",
    customer: "Verto Group Sp. z o.o.",
    agreement: "W/2026/0356",
  },
];

const statusClass: Record<CaseStatus, string> = {
  "Do weryfikacji": styles.statusReview,
  Dopasowano: styles.statusMatched,
  Nowa: styles.statusNew,
};

export default function MandatyWorkspace() {
  const [activeView, setActiveView] = useState<"cases" | "fleet">("cases");
  const [fleetImportOpen, setFleetImportOpen] = useState(false);
  const [caseItems, setCaseItems] = useState<CaseItem[]>(demoCases);
  const [selectedId, setSelectedId] = useState(demoCases[0].id);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"Wszystkie" | CaseStatus>("Wszystkie");
  const [scanOpen, setScanOpen] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const selected =
    caseItems.find((item) => item.id === selectedId) ?? caseItems[0];
  const filtered = useMemo(
    () =>
      caseItems.filter((item) => {
        const matchesQuery = `${item.plate} ${item.id} ${item.sender}`
          .toLowerCase()
          .includes(query.toLowerCase());
        return (
          matchesQuery && (filter === "Wszystkie" || item.status === filter)
        );
      }),
    [caseItems, filter, query],
  );

  async function loadDocuments(preserveSelection: boolean) {
    const response = await fetch("/api/documents", { cache: "no-store" });
    if (!response.ok) return null;
    const result = (await response.json()) as {
      documents?: Array<{
        id: string;
        status: string;
        created_at: string;
        registration_number: string | null;
        event_at: string | null;
        case_number: string | null;
        sender: string | null;
        previewUrl: string | null;
      }>;
    };
    if (!result.documents?.length) return null;
    const mapped: CaseItem[] = result.documents.map((document) => ({
      id: document.case_number || document.id.slice(0, 13).toUpperCase(),
      documentId: document.id,
      plate: document.registration_number || "OCR…",
      sender: document.sender || "Nowy dokument z telefonu",
      eventAt: document.event_at || "Oczekuje na OCR",
      receivedAt: new Date(document.created_at).toLocaleString("pl-PL", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }),
      deadline: "—",
      status:
        document.status === "ready" ||
        document.status === "needs_review" ||
        document.status === "ocr_failed"
          ? "Do weryfikacji"
          : "Nowa",
      customer: "—",
      agreement: "—",
      previewUrl: document.previewUrl,
      ocrStatus: document.status,
    }));
    setCaseItems(mapped);
    setSelectedId((current) =>
      preserveSelection && mapped.some((item) => item.id === current)
        ? current
        : mapped[0].id,
    );
    return mapped;
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount pattern
    loadDocuments(false).catch(() => null);
  }, []);

  useEffect(() => {
    const hasPending = caseItems.some(
      (item) => item.ocrStatus && pendingOcrStatuses.has(item.ocrStatus),
    );
    if (!hasPending) return;
    const interval = window.setInterval(() => {
      loadDocuments(true).catch(() => null);
    }, 4000);
    return () => window.clearInterval(interval);
  }, [caseItems]);

  async function retryOcr() {
    if (!selected.documentId || retrying) return;
    setRetrying(true);
    try {
      const response = await fetch(
        `/api/documents/${selected.documentId}/retry`,
        { method: "POST" },
      );
      if (response.ok) await loadDocuments(true);
    } finally {
      setRetrying(false);
    }
  }

  function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (selectedFiles.length === 0) return;

    const unsupportedFile = selectedFiles.find(
      (file) => !/\.(pdf|jpe?g|png|tiff?|heic|heif)$/i.test(file.name),
    );
    if (unsupportedFile) {
      setUploadError(
        `Format pliku „${unsupportedFile.name}” nie jest obsługiwany.`,
      );
      return;
    }

    const invalidFile = selectedFiles.find(
      (file) => file.size > 15 * 1024 * 1024,
    );
    if (invalidFile) {
      setUploadError(`Plik „${invalidFile.name}” przekracza limit 15 MB.`);
      return;
    }

    if (uploadedFiles.length + selectedFiles.length > 10) {
      setUploadError("Jedna sprawa może zawierać maksymalnie 10 stron.");
      return;
    }

    setUploadError(null);
    setUploadedFiles((current) => [...current, ...selectedFiles]);
    setProcessing(true);
    window.setTimeout(() => setProcessing(false), 700);
  }

  function removeFile(index: number) {
    setUploadedFiles((current) =>
      current.filter((_, fileIndex) => fileIndex !== index),
    );
    setUploadError(null);
  }

  function handleSave() {
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  }

  async function signOut() {
    await fetch("/api/auth", { method: "DELETE" });
    window.location.reload();
  }

  async function uploadDesktopDocument() {
    if (!uploadedFiles.length || uploading) return;
    setUploading(true);
    setUploadError(null);
    try {
      const form = new FormData();
      uploadedFiles.forEach((file) => form.append("files", file));
      let token: string | null = null;
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        if (!key?.startsWith("sb-") || !key.endsWith("-auth-token")) continue;
        try {
          const session = JSON.parse(localStorage.getItem(key) || "null");
          if (session?.access_token) token = String(session.access_token);
        } catch {}
      }
      const response = await fetch("/api/documents/upload", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: form,
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Nie udało się przesłać dokumentu.");
      setUploadedFiles([]);
      setScanOpen(false);
      await loadDocuments(true);
    } catch (reason) {
      setUploadError(
        reason instanceof Error
          ? reason.message
          : "Nie udało się przesłać dokumentu.",
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className={styles.shell}>
      <MobileCapture />
      <header className={styles.mobileHeader}>
        <button
          className={styles.iconButton}
          onClick={() => setMobileMenu(true)}
          aria-label="Otwórz menu"
        >
          <Menu size={22} />
        </button>
        <Brand compact />
        <button className={styles.iconButton} aria-label="Powiadomienia">
          <Bell size={20} />
          <span className={styles.notificationDot} />
        </button>
      </header>

      <aside
        className={`${styles.sidebar} ${mobileMenu ? styles.sidebarOpen : ""}`}
        aria-label="Główna nawigacja"
      >
        <div className={styles.sidebarTop}>
          <Brand />
          <button
            className={`${styles.iconButton} ${styles.mobileOnly}`}
            onClick={() => setMobileMenu(false)}
            aria-label="Zamknij menu"
          >
            <X size={21} />
          </button>
        </div>
        <nav className={styles.nav}>
          <a href="#" className={styles.navItem}>
            <LayoutDashboard size={19} />
            Pulpit
          </a>
          <button
            type="button"
            onClick={() => {
              setActiveView("cases");
              setMobileMenu(false);
            }}
            className={`${styles.navItem} ${activeView === "cases" ? styles.navActive : ""}`}
          >
            <Inbox size={19} />
            Sprawy<span className={styles.navCount}>7</span>
          </button>
          <a href="#" className={styles.navItem}>
            <FileText size={19} />
            Dokumenty
          </a>
          <button
            type="button"
            onClick={() => {
              setActiveView("fleet");
              setMobileMenu(false);
            }}
            className={`${styles.navItem} ${activeView === "fleet" ? styles.navActive : ""}`}
          >
            <UsersRound size={19} />
            Flota
          </button>
        </nav>
        <div className={styles.sidebarFooter}>
          <div className={styles.securityNote}>
            <ShieldCheck size={18} />
            <span>
              <strong>Dane chronione</strong>
              <small>Sesja szyfrowana</small>
            </span>
          </div>
          <button
            className={styles.profileButton}
            onClick={signOut}
            title="Wyloguj"
          >
            <span className={styles.avatar}>AK</span>
            <span>
              <strong>Konto użytkownika</strong>
              <small>Kliknij, aby się wylogować</small>
            </span>
            <MoreHorizontal size={18} />
          </button>
        </div>
      </aside>
      {mobileMenu && (
        <button
          className={styles.backdrop}
          onClick={() => setMobileMenu(false)}
          aria-label="Zamknij menu"
        />
      )}

      <main id="main-content" className={styles.main}>
        <header className={styles.topbar}>
          <div>
            <p className={styles.eyebrow}>Operacje</p>
            <h1>
              {activeView === "cases"
                ? "Obsługa mandatów"
                : "Zarządzanie flotą"}
            </h1>
          </div>
          <div className={styles.topbarActions}>
            <button className={styles.helpButton}>
              <CircleHelp size={18} />
              Pomoc
            </button>
            <button className={styles.iconButton} aria-label="Powiadomienia">
              <Bell size={20} />
              <span className={styles.notificationDot} />
            </button>
            {activeView === "cases" ? (
              <button
                className={styles.primaryButton}
                onClick={() => setScanOpen(true)}
              >
                <ScanLine size={18} />
                Skanuj dokument
              </button>
            ) : (
              <button
                className={styles.primaryButton}
                onClick={() => setFleetImportOpen(true)}
              >
                <Upload size={18} />
                Importuj flotę
              </button>
            )}
          </div>
        </header>

        {activeView === "fleet" ? (
          <FleetManager
            importOpen={fleetImportOpen}
            onCloseImport={() => setFleetImportOpen(false)}
          />
        ) : (
          <>
            <section className={styles.metrics} aria-label="Podsumowanie spraw">
              <Metric
                label="Nowe dzisiaj"
                value="4"
                detail="2 oczekują na analizę"
                icon={<Inbox size={19} />}
              />
              <Metric
                label="Do weryfikacji"
                value="3"
                detail="Najstarsza: 2 dni"
                icon={<Clock3 size={19} />}
                tone="amber"
              />
              <Metric
                label="Dopasowane automatycznie"
                value="86%"
                detail="W ostatnich 30 dniach"
                icon={<CheckCircle2 size={19} />}
                tone="green"
              />
            </section>

            <section className={styles.workspace} id="sprawy">
              <div className={styles.casePanel}>
                <div className={styles.panelHeader}>
                  <div>
                    <h2>Kolejka spraw</h2>
                    <p>{filtered.length} z 7 aktywnych</p>
                  </div>
                  <button
                    className={styles.moreButton}
                    aria-label="Więcej opcji"
                  >
                    <MoreHorizontal size={20} />
                  </button>
                </div>
                <div className={styles.filters}>
                  <label className={styles.searchBox}>
                    <Search size={18} />
                    <span className={styles.srOnly}>Szukaj sprawy</span>
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Nr rej. lub numer sprawy"
                    />
                  </label>
                  <label className={styles.selectBox}>
                    <span className={styles.srOnly}>Filtr statusu</span>
                    <select
                      value={filter}
                      onChange={(event) =>
                        setFilter(event.target.value as typeof filter)
                      }
                    >
                      <option>Wszystkie</option>
                      <option>Nowa</option>
                      <option>Do weryfikacji</option>
                      <option>Dopasowano</option>
                    </select>
                    <ChevronDown size={16} />
                  </label>
                </div>
                <div className={styles.caseList}>
                  {filtered.map((item) => (
                    <button
                      key={item.id}
                      className={`${styles.caseItem} ${selectedId === item.id ? styles.caseSelected : ""}`}
                      onClick={() => setSelectedId(item.id)}
                    >
                      <span className={styles.caseItemTop}>
                        <strong className={styles.plate}>{item.plate}</strong>
                        <span
                          className={`${styles.status} ${statusClass[item.status]}`}
                        >
                          {item.status}
                        </span>
                      </span>
                      <span className={styles.sender}>{item.sender}</span>
                      <span className={styles.caseMeta}>
                        <span>{item.id}</span>
                        <span>{item.receivedAt}</span>
                      </span>
                    </button>
                  ))}
                  {filtered.length === 0 && (
                    <div className={styles.emptyState}>
                      <Search size={24} />
                      <strong>Brak pasujących spraw</strong>
                      <span>Zmień wyszukiwanie lub filtr.</span>
                    </div>
                  )}
                </div>
              </div>

              <div className={styles.detailPanel} key={selected.id}>
                <div className={styles.detailHeader}>
                  <div className={styles.detailTitle}>
                    <button
                      className={`${styles.iconButton} ${styles.mobileOnly}`}
                      aria-label="Wróć do listy"
                    >
                      <ChevronLeft size={20} />
                    </button>
                    <div>
                      <span className={styles.mono}>{selected.id}</span>
                      <h2>{selected.plate}</h2>
                    </div>
                  </div>
                  <div className={styles.detailActions}>
                    <span className={styles.deadline}>
                      <Clock3 size={15} />
                      Termin: {selected.deadline}
                    </span>
                    <button
                      className={styles.moreButton}
                      aria-label="Więcej opcji"
                    >
                      <MoreHorizontal size={20} />
                    </button>
                  </div>
                </div>

                <div className={styles.reviewGrid}>
                  <DocumentPreview src={selected.previewUrl} />
                  <div className={styles.dataPane}>
                    <div className={styles.analysisBanner}>
                      <span>
                        <CheckCircle2 size={18} />
                        <strong>
                          {selected.ocrStatus === "ready"
                            ? "Analiza zakończona"
                            : selected.ocrStatus === "ocr_failed" ||
                                selected.ocrStatus ===
                                  "ocr_configuration_required"
                              ? "Analiza wymaga ponowienia"
                              : selected.ocrStatus
                                ? "Analiza w toku"
                                : "Analiza zakończona"}
                        </strong>
                      </span>
                      <small>
                        {selected.ocrStatus === "ready"
                          ? "Dane OCR gotowe do weryfikacji"
                          : selected.ocrStatus
                            ? selected.ocrStatus.replaceAll("_", " ")
                            : "Rozpoznano 8 z 9 pól"}
                      </small>
                      {selected.ocrStatus &&
                        retryableOcrStatuses.has(selected.ocrStatus) && (
                          <button
                            type="button"
                            className={styles.textButton}
                            disabled={retrying}
                            onClick={retryOcr}
                          >
                            {retrying ? "Ponawiam…" : "Ponów analizę OCR"}
                          </button>
                        )}
                    </div>
                    <section className={styles.formSection}>
                      <div className={styles.sectionHeading}>
                        <div>
                          <p className={styles.eyebrow}>Dane zdarzenia</p>
                          <h3>Odczyt z dokumentu</h3>
                        </div>
                        <span className={styles.confidence}>92% pewności</span>
                      </div>
                      <div className={styles.formGrid}>
                        <Field
                          label="Numer rejestracyjny"
                          value={selected.plate}
                          confident
                        />
                        <Field
                          label="Data i godzina zdarzenia"
                          value={selected.eventAt}
                          confident
                        />
                        <Field label="Numer sprawy" value={selected.id} />
                        <Field label="Nadawca" value={selected.sender} wide />
                      </div>
                    </section>
                    <section className={styles.matchCard}>
                      <div className={styles.matchIcon}>
                        <UserRound size={21} />
                      </div>
                      <div className={styles.matchContent}>
                        <span className={styles.matchLabel}>
                          Dopasowany użytkownik pojazdu
                        </span>
                        <strong>{selected.customer}</strong>
                        <small>
                          Umowa {selected.agreement} · okres obejmuje datę
                          zdarzenia
                        </small>
                      </div>
                      <span className={styles.matchScore}>
                        <Check size={15} />
                        98%
                      </span>
                    </section>
                    <section className={styles.formSection}>
                      <div className={styles.sectionHeading}>
                        <div>
                          <p className={styles.eyebrow}>Dane do odpowiedzi</p>
                          <h3>Osoba odpowiedzialna</h3>
                        </div>
                        <button className={styles.textButton}>
                          Zmień dopasowanie
                        </button>
                      </div>
                      <div className={styles.formGrid}>
                        <Field
                          label="Nazwa / imię i nazwisko"
                          value={
                            selected.customer === "—"
                              ? "Brak dopasowania"
                              : selected.customer
                          }
                          wide
                          warning={selected.customer === "—"}
                        />
                        <Field
                          label="NIP / PESEL"
                          value={
                            selected.customer.includes("Sp. z o.o.")
                              ? "521•••••••7"
                              : "850••••••••"
                          }
                        />
                        <Field label="E-mail" value="biuro@klient.pl" />
                      </div>
                    </section>
                    <div className={styles.formFooter}>
                      <span>Ostatni zapis: dziś, 09:22</span>
                      <div>
                        <button className={styles.secondaryButton}>
                          Oznacz do wyjaśnienia
                        </button>
                        <button
                          className={styles.primaryButton}
                          onClick={handleSave}
                        >
                          {saved ? <Check size={18} /> : null}
                          {saved ? "Zapisano" : "Zatwierdź dane"}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </>
        )}
      </main>

      {activeView === "cases" ? (
        <button
          className={styles.mobileScanButton}
          onClick={() => setScanOpen(true)}
        >
          <Camera size={21} />
          Skanuj dokument
        </button>
      ) : (
        <button
          className={styles.mobileScanButton}
          onClick={() => setFleetImportOpen(true)}
        >
          <Upload size={21} />
          Importuj flotę
        </button>
      )}

      {scanOpen && (
        <div
          className={styles.modalLayer}
          role="dialog"
          aria-modal="true"
          aria-labelledby="scan-title"
        >
          <button
            className={styles.modalBackdrop}
            onClick={() => setScanOpen(false)}
            aria-label="Zamknij okno"
          />
          <div className={styles.scanModal}>
            <div className={styles.modalHandle} />
            <div className={styles.modalHeader}>
              <div>
                <p className={styles.eyebrow}>Nowa sprawa</p>
                <h2 id="scan-title">Dodaj dokument</h2>
              </div>
              <button
                className={styles.iconButton}
                onClick={() => setScanOpen(false)}
                aria-label="Zamknij"
              >
                <X size={21} />
              </button>
            </div>
            <p className={`${styles.modalIntro} ${styles.desktopInstruction}`}>
              Dodaj gotowy skan z komputera. Możesz wskazać jeden PDF albo kilka
              plików graficznych.
            </p>
            <p className={`${styles.modalIntro} ${styles.mobileInstruction}`}>
              Uruchom skaner i fotografuj strony po kolei. Po każdym zdjęciu
              wrócisz tutaj, aby dodać następną stronę.
            </p>

            <div className={styles.sourceGrid}>
              <label className={styles.cameraAction}>
                <input
                  type="file"
                  accept="image/*,.heic,.heif"
                  capture="environment"
                  onChange={handleFiles}
                />
                <span className={styles.cameraIcon}>
                  <ScanLine size={28} />
                </span>
                <span>
                  <strong>Uruchom skaner</strong>
                  <small>Zeskanuj dokument tylnym aparatem</small>
                </span>
              </label>
              <label className={styles.fileAction}>
                <input
                  type="file"
                  accept=".pdf,application/pdf,.jpg,.jpeg,.png,.tif,.tiff,.heic,.heif,image/jpeg,image/png,image/tiff,image/heic,image/heif"
                  multiple
                  onChange={handleFiles}
                />
                <span className={styles.fileIcon}>
                  <ImagePlus size={24} />
                </span>
                <span>
                  <strong>Dodaj skan z urządzenia</strong>
                  <small>PDF, JPG, PNG, TIFF lub HEIC</small>
                </span>
              </label>
            </div>

            {uploadError && (
              <p className={styles.uploadError} role="alert">
                {uploadError}
              </p>
            )}

            {processing && (
              <div className={styles.processingRow}>
                <span className={styles.spinner} />
                <span>
                  <strong>Dodajemy stronę…</strong>
                  <small>Nie zamykaj tego okna</small>
                </span>
              </div>
            )}

            {uploadedFiles.length > 0 && (
              <section
                className={styles.fileSection}
                aria-labelledby="added-pages-title"
              >
                <div className={styles.fileSectionHeader}>
                  <div>
                    <h3 id="added-pages-title">Dodane strony</h3>
                    <span>{uploadedFiles.length}/10</span>
                  </div>
                  <small>Sprawdź kolejność przed wysłaniem</small>
                </div>
                <ol className={styles.fileList}>
                  {uploadedFiles.map((file, index) => (
                    <li key={`${file.name}-${file.lastModified}-${index}`}>
                      <span className={styles.pageNumber}>{index + 1}</span>
                      <span className={styles.fileType}>
                        {file.type === "application/pdf" ? (
                          <Files size={19} />
                        ) : (
                          <ImagePlus size={19} />
                        )}
                      </span>
                      <span className={styles.fileName}>
                        <strong>{file.name || `Zdjęcie ${index + 1}`}</strong>
                        <small>
                          {(file.size / 1024 / 1024).toFixed(1)} MB · strona{" "}
                          {index + 1}
                        </small>
                      </span>
                      <button
                        type="button"
                        onClick={() => removeFile(index)}
                        aria-label={`Usuń stronę ${index + 1}`}
                      >
                        <Trash2 size={18} />
                      </button>
                    </li>
                  ))}
                </ol>
              </section>
            )}
            <div className={styles.scanTips}>
              <ShieldCheck size={18} />
              <span>
                <strong>Bezpieczne przesyłanie</strong>
                <small>
                  Zdjęcie nie zostanie zapisane w galerii przez aplikację.
                </small>
              </span>
            </div>
            <div className={styles.modalActions}>
              <button
                className={styles.secondaryButton}
                onClick={() => setScanOpen(false)}
              >
                Anuluj
              </button>
              <button
                className={styles.primaryButton}
                disabled={uploadedFiles.length === 0 || processing || uploading}
                onClick={uploadDesktopDocument}
              >
                <Upload size={18} />
                {uploading ? "Przesyłanie…" : "Wyślij"}{" "}
                {uploadedFiles.length > 0 ? `(${uploadedFiles.length})` : ""} do
                analizy
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={styles.brand}>
      <span className={styles.brandMark}>
        <FileText size={compact ? 18 : 20} />
      </span>
      <span>
        <strong>
          Flota<span>Flow</span>
        </strong>
        {!compact && <small>Obsługa dokumentów</small>}
      </span>
    </div>
  );
}

function Metric({
  label,
  value,
  detail,
  icon,
  tone = "blue",
}: {
  label: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
  tone?: "blue" | "amber" | "green";
}) {
  return (
    <article className={styles.metricCard}>
      <div className={`${styles.metricIcon} ${styles[`metric_${tone}`]}`}>
        {icon}
      </div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </article>
  );
}

function Field({
  label,
  value,
  wide = false,
  confident = false,
  warning = false,
}: {
  label: string;
  value: string;
  wide?: boolean;
  confident?: boolean;
  warning?: boolean;
}) {
  return (
    <label className={`${styles.field} ${wide ? styles.fieldWide : ""}`}>
      <span>
        {label}
        {confident && (
          <CheckCircle2 size={14} aria-label="Wysoka pewność odczytu" />
        )}
      </span>
      <input
        defaultValue={value}
        className={warning ? styles.inputWarning : ""}
      />
    </label>
  );
}

function DocumentPreview({ src }: { src?: string | null }) {
  return (
    <div className={styles.documentPane}>
      <div className={styles.documentToolbar}>
        <span>Strona 1 z 2</span>
        <div>
          <button aria-label="Poprzednia strona">
            <ChevronLeft size={17} />
          </button>
          <button aria-label="Następna strona">
            <ChevronRight size={17} />
          </button>
        </div>
      </div>
      <div className={styles.paperWrap}>
        {src ? (
          // The source is a short-lived signed Supabase URL, so it cannot be optimized at build time.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className={styles.scanImage}
            src={src}
            alt="Pierwsza strona zeskanowanego dokumentu"
          />
        ) : (
          <article
            className={styles.paper}
            aria-label="Podgląd przykładowego dokumentu"
          >
            <div className={styles.paperLogo}>SM</div>
            <p className={styles.paperKicker}>STRAŻ MIEJSKA M.ST. WARSZAWY</p>
            <div className={styles.paperRule} />
            <p className={styles.paperDate}>Warszawa, 21 lipca 2026 r.</p>
            <h4>
              WEZWANIE DO WSKAZANIA
              <br />
              UŻYTKOWNIKA POJAZDU
            </h4>
            <p>
              W związku z ujawnieniem naruszenia przepisów ruchu drogowego
              prosimy o wskazanie osoby, której powierzono pojazd:
            </p>
            <div className={styles.paperHighlight}>
              <span>Numer rejestracyjny</span>
              <strong>WI 2847K</strong>
            </div>
            <div className={styles.paperHighlight}>
              <span>Data i godzina zdarzenia</span>
              <strong>18.07.2026, 14:32</strong>
            </div>
            <p className={styles.paperText}>
              Odpowiedź należy przekazać w terminie 7 dni od dnia otrzymania
              niniejszego pisma.
            </p>
            <div className={styles.paperSignature}>
              Z upoważnienia
              <br />
              <strong>Starszy Inspektor</strong>
            </div>
          </article>
        )}
      </div>
    </div>
  );
}
