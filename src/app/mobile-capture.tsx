"use client";

import {
  Camera,
  Check,
  CheckCircle2,
  FilePlus2,
  FileText,
  Route,
  ScanLine,
  Send,
  ShieldCheck,
  Trash2,
  Upload,
  Wifi,
  WifiOff,
} from "lucide-react";
import { ChangeEvent, useEffect, useState } from "react";
import DeliveryPlanner from "./delivery-planner";
import styles from "./mobile-capture.module.css";

type Transfer = {
  id: string;
  pages: number;
  time: string;
  status: "Przesłano" | "Analizowanie";
};

type Page = { id: string; file: File; name: string };

function extensionOf(fileName: string) {
  const match = fileName.match(/\.[^.]+$/);
  return match ? match[0] : "";
}

function renamedFile(file: File, displayName: string) {
  const trimmed = displayName.trim();
  if (!trimmed) return file;
  return new File([file], `${trimmed}${extensionOf(file.name)}`, {
    type: file.type,
    lastModified: file.lastModified,
  });
}

export default function MobileCapture() {
  const [activeTab, setActiveTab] = useState<"scanner" | "routes">("scanner");
  const [online, setOnline] = useState(true);
  const [pages, setPages] = useState<Page[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [sentMode, setSentMode] = useState<"demo" | "supabase">("demo");
  const [ocrQueued, setOcrQueued] = useState(false);
  const [transfers, setTransfers] = useState<Transfer[]>([
    { id: "DOC-1048", pages: 2, time: "Dzisiaj, 09:14", status: "Przesłano" },
    {
      id: "DOC-1047",
      pages: 1,
      time: "Dzisiaj, 08:46",
      status: "Analizowanie",
    },
    { id: "DOC-1046", pages: 3, time: "Wczoraj, 15:20", status: "Przesłano" },
  ]);

  useEffect(() => {
    const syncConnection = () => setOnline(navigator.onLine);
    const syncView = () =>
      setActiveTab(
        new URL(window.location.href).searchParams.get("view") === "deliveries"
          ? "routes"
          : "scanner",
      );
    syncConnection();
    syncView();
    window.addEventListener("online", syncConnection);
    window.addEventListener("offline", syncConnection);
    window.addEventListener("popstate", syncView);
    return () => {
      window.removeEventListener("online", syncConnection);
      window.removeEventListener("offline", syncConnection);
      window.removeEventListener("popstate", syncView);
    };
  }, []);

  function changeTab(tab: "scanner" | "routes") {
    setActiveTab(tab);
    const url = new URL(window.location.href);
    if (tab === "routes") url.searchParams.set("view", "deliveries");
    else url.searchParams.delete("view");
    window.history.pushState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function addFiles(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!selected.length) return;
    const invalid = selected.find(
      (file) =>
        !/\.(pdf|jpe?g|png|tiff?|heic|heif)$/i.test(file.name) ||
        file.size > 15 * 1024 * 1024,
    );
    if (invalid) {
      setError(
        `Nie można dodać pliku „${invalid.name}”. Sprawdź format i limit 15 MB.`,
      );
      return;
    }
    if (pages.length + selected.length > 10) {
      setError("Jedno pismo może zawierać maksymalnie 10 stron.");
      return;
    }
    setError(null);
    setSent(false);
    setOcrQueued(false);
    setPages((current) => [
      ...current,
      ...selected.map((file, offset) => ({
        id: `${Date.now()}-${current.length + offset}`,
        file,
        name: `Dokument ${current.length + offset + 1}`,
      })),
    ]);
  }

  async function sendToDatabase() {
    if (!pages.length || sending) return;
    setSending(true);
    setError(null);
    try {
      const form = new FormData();
      pages.forEach((page) =>
        form.append("files", renamedFile(page.file, page.name)),
      );
      const response = await fetch("/api/documents/upload", {
        method: "POST",
        body: form,
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Nie udało się przesłać dokumentu.");
      const now = new Date();
      setTransfers((current) => [
        {
          id: String(result.documentId).slice(0, 13),
          pages: pages.length,
          time: `Dzisiaj, ${now.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })}`,
          status: "Analizowanie",
        },
        ...current,
      ]);
      setPages([]);
      setSending(false);
      setSentMode(result.mode === "supabase" ? "supabase" : "demo");
      setOcrQueued(result.ocrStatus === "queued");
      setSent(true);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Nie udało się przesłać dokumentu.",
      );
      setSending(false);
    }
  }

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <span>
            <FileText size={19} />
          </span>
          <div>
            <strong>
              Flota<span>Flow</span>
            </strong>
            <small>
              {activeTab === "scanner" ? "Skaner dokumentów" : "Planer dostaw"}
            </small>
          </div>
        </div>
        <span className={online ? styles.online : styles.offline} role="status">
          {online ? <Wifi size={14} /> : <WifiOff size={14} />}
          {online ? "Online" : "Offline"}
        </span>
      </header>

      {activeTab === "routes" ? (
        <DeliveryPlanner />
      ) : (
        <main>
          <section className={styles.intro}>
            <p>Nowe pismo</p>
            <h1>Zeskanuj dokument</h1>
            <span>
              Fotografuj kolejno wszystkie strony, a następnie prześlij je do
              panelu biurowego.
            </span>
          </section>

          {sent && (
            <div className={styles.sent} role="status">
              <CheckCircle2 size={22} />
              <span>
                <strong>
                  {sentMode === "supabase"
                    ? "Dokument został przekazany"
                    : "Tryb demonstracyjny"}
                </strong>
                <small>
                  {sentMode === "supabase"
                    ? ocrQueued
                      ? "Skan zapisany. OCR jest w kolejce — sprawdź wynik na komputerze za chwilę."
                      : "Pojawi się automatycznie w kolejce na komputerze."
                    : "Pliki nie zostały zapisane — podłącz Supabase, aby uruchomić transfer."}
                </small>
              </span>
            </div>
          )}

          <section className={styles.scannerCard}>
            <label className={styles.scanButton}>
              <input
                type="file"
                accept="image/*,.heic,.heif"
                capture="environment"
                onChange={addFiles}
              />
              <span className={styles.scanIcon}>
                <ScanLine size={38} />
              </span>
              <strong>
                {pages.length ? "Skanuj następną stronę" : "Uruchom skaner"}
              </strong>
              <small>Otworzy tylny aparat telefonu</small>
            </label>
            <div className={styles.divider}>
              <span>lub</span>
            </div>
            <label className={styles.fileButton}>
              <input
                type="file"
                accept=".pdf,application/pdf,.jpg,.jpeg,.png,.tif,.tiff,.heic,.heif,image/*"
                multiple
                onChange={addFiles}
              />
              <Upload size={18} />
              <span>Dodaj plik z telefonu</span>
            </label>
          </section>

          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}

          {pages.length > 0 && (
            <section className={styles.pages}>
              <div className={styles.sectionTitle}>
                <div>
                  <h2>Strony dokumentu</h2>
                  <span>{pages.length}/10</span>
                </div>
                <small>Sprawdź kompletność pisma, kliknij nazwę by zmienić</small>
              </div>
              <ol>
                {pages.map((page, index) => (
                  <li key={page.id}>
                    <span className={styles.pageNo}>{index + 1}</span>
                    <span className={styles.fileIcon}>
                      <FilePlus2 size={20} />
                    </span>
                    <span className={styles.fileInfo}>
                      <input
                        className={styles.nameInput}
                        value={page.name}
                        aria-label={`Nazwa strony ${index + 1}`}
                        onChange={(event) => {
                          const value = event.target.value;
                          setPages((current) =>
                            current.map((item) =>
                              item.id === page.id
                                ? { ...item, name: value }
                                : item,
                            ),
                          );
                        }}
                      />
                      <small>
                        {(page.file.size / 1024 / 1024).toFixed(1)} MB
                      </small>
                    </span>
                    <button
                      onClick={() =>
                        setPages((current) =>
                          current.filter((item) => item.id !== page.id),
                        )
                      }
                      aria-label={`Usuń stronę ${index + 1}`}
                    >
                      <Trash2 size={19} />
                    </button>
                  </li>
                ))}
              </ol>
              <button
                className={styles.sendButton}
                disabled={sending}
                onClick={sendToDatabase}
              >
                {sending ? (
                  <span className={styles.spinner} />
                ) : (
                  <Send size={20} />
                )}
                {sending
                  ? "Przesyłanie…"
                  : `Przekaż ${pages.length} ${pages.length === 1 ? "stronę" : "strony"} do bazy`}
              </button>
            </section>
          )}

          <div className={styles.security}>
            <ShieldCheck size={18} />
            <span>
              <strong>Bezpieczny transfer</strong>
              <small>Dokumenty są przesyłane szyfrowanym połączeniem.</small>
            </span>
          </div>

          <section className={styles.recent}>
            <div className={styles.sectionTitle}>
              <div>
                <h2>Ostatnie transfery</h2>
              </div>
              <small>Na tym urządzeniu</small>
            </div>
            <div>
              {transfers.slice(0, 4).map((transfer) => (
                <article key={transfer.id}>
                  <span className={styles.transferIcon}>
                    {transfer.status === "Przesłano" ? (
                      <Check size={18} />
                    ) : (
                      <Camera size={18} />
                    )}
                  </span>
                  <div>
                    <strong>{transfer.id}</strong>
                    <small>
                      {transfer.pages}{" "}
                      {transfer.pages === 1 ? "strona" : "strony"} ·{" "}
                      {transfer.time}
                    </small>
                  </div>
                  <span
                    className={
                      transfer.status === "Przesłano"
                        ? styles.done
                        : styles.processing
                    }
                  >
                    {transfer.status}
                  </span>
                </article>
              ))}
            </div>
          </section>
        </main>
      )}
      <nav className={styles.bottomNav} aria-label="Nawigacja mobilna">
        <button
          className={activeTab === "scanner" ? styles.activeNav : ""}
          onClick={() => changeTab("scanner")}
          aria-current={activeTab === "scanner" ? "page" : undefined}
        >
          <ScanLine size={20} />
          <span>Skaner</span>
        </button>
        <button
          className={activeTab === "routes" ? styles.activeNav : ""}
          onClick={() => changeTab("routes")}
          aria-current={activeTab === "routes" ? "page" : undefined}
        >
          <Route size={20} />
          <span>Dostawy</span>
        </button>
      </nav>
    </div>
  );
}
