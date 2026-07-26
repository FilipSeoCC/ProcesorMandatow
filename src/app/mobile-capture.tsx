"use client";

import { Camera, Check, CheckCircle2, FilePlus2, FileText, Route, ScanLine, Send, ShieldCheck, Trash2, Upload, Wifi } from "lucide-react";
import { ChangeEvent, useState } from "react";
import DeliveryPlanner from "./delivery-planner";
import styles from "./mobile-capture.module.css";

type Transfer = { id: string; pages: number; time: string; status: "Przesłano" | "Analizowanie" };

function storedAccessToken() {
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (!key?.startsWith("sb-") || !key.endsWith("-auth-token")) continue;
    try { const session = JSON.parse(localStorage.getItem(key) || "null"); if (session?.access_token) return String(session.access_token); } catch {}
  }
  return null;
}

export default function MobileCapture() {
  const [activeTab, setActiveTab] = useState<"scanner" | "routes">("scanner");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [sentMode, setSentMode] = useState<"demo" | "supabase">("demo");
  const [transfers, setTransfers] = useState<Transfer[]>([
    { id: "DOC-1048", pages: 2, time: "Dzisiaj, 09:14", status: "Przesłano" },
    { id: "DOC-1047", pages: 1, time: "Dzisiaj, 08:46", status: "Analizowanie" },
    { id: "DOC-1046", pages: 3, time: "Wczoraj, 15:20", status: "Przesłano" },
  ]);

  function addFiles(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!selected.length) return;
    const invalid = selected.find((file) => !/\.(pdf|jpe?g|png|tiff?|heic|heif)$/i.test(file.name) || file.size > 15 * 1024 * 1024);
    if (invalid) { setError(`Nie można dodać pliku „${invalid.name}”. Sprawdź format i limit 15 MB.`); return; }
    if (files.length + selected.length > 10) { setError("Jedno pismo może zawierać maksymalnie 10 stron."); return; }
    setError(null); setSent(false); setFiles((current) => [...current, ...selected]);
  }

  async function sendToDatabase() {
    if (!files.length || sending) return;
    setSending(true);
    setError(null);
    try {
      const form = new FormData();
      files.forEach((file) => form.append("files", file));
      const token = storedAccessToken();
      const response = await fetch("/api/documents/upload", { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : undefined, body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Nie udało się przesłać dokumentu.");
      const now = new Date();
      setTransfers((current) => [{ id: String(result.documentId).slice(0, 13), pages: files.length, time: `Dzisiaj, ${now.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })}`, status: "Analizowanie" }, ...current]);
      setFiles([]); setSending(false); setSentMode(result.mode === "supabase" ? "supabase" : "demo"); setSent(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Nie udało się przesłać dokumentu.");
      setSending(false);
    }
  }

  return <div className={styles.app}>
    <header className={styles.header}>
      <div className={styles.brand}><span><FileText size={19} /></span><div><strong>Flota<span>Flow</span></strong><small>{activeTab === "scanner" ? "Skaner dokumentów" : "Planer dostaw"}</small></div></div>
      <span className={styles.online}><Wifi size={14} />Online</span>
    </header>

    {activeTab === "routes" ? <DeliveryPlanner /> : <main>
      <section className={styles.intro}><p>Nowe pismo</p><h1>Zeskanuj dokument</h1><span>Fotografuj kolejno wszystkie strony, a następnie prześlij je do panelu biurowego.</span></section>

      {sent && <div className={styles.sent} role="status"><CheckCircle2 size={22} /><span><strong>{sentMode === "supabase" ? "Dokument został przekazany" : "Tryb demonstracyjny"}</strong><small>{sentMode === "supabase" ? "Pojawi się automatycznie w kolejce na komputerze." : "Pliki nie zostały zapisane — podłącz Supabase, aby uruchomić transfer."}</small></span></div>}

      <section className={styles.scannerCard}>
        <label className={styles.scanButton}>
          <input type="file" accept="image/*,.heic,.heif" capture="environment" onChange={addFiles} />
          <span className={styles.scanIcon}><ScanLine size={38} /></span>
          <strong>{files.length ? "Skanuj następną stronę" : "Uruchom skaner"}</strong>
          <small>Otworzy tylny aparat telefonu</small>
        </label>
        <div className={styles.divider}><span>lub</span></div>
        <label className={styles.fileButton}>
          <input type="file" accept=".pdf,application/pdf,.jpg,.jpeg,.png,.tif,.tiff,.heic,.heif,image/*" multiple onChange={addFiles} />
          <Upload size={18} /><span>Dodaj plik z telefonu</span>
        </label>
      </section>

      {error && <p className={styles.error} role="alert">{error}</p>}

      {files.length > 0 && <section className={styles.pages}>
        <div className={styles.sectionTitle}><div><h2>Strony dokumentu</h2><span>{files.length}/10</span></div><small>Sprawdź kompletność pisma</small></div>
        <ol>{files.map((file, index) => <li key={`${file.name}-${file.lastModified}-${index}`}><span className={styles.pageNo}>{index + 1}</span><span className={styles.fileIcon}><FilePlus2 size={20} /></span><span className={styles.fileInfo}><strong>{file.name || `Zdjęcie ${index + 1}`}</strong><small>{(file.size / 1024 / 1024).toFixed(1)} MB</small></span><button onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Usuń stronę ${index + 1}`}><Trash2 size={19} /></button></li>)}</ol>
        <button className={styles.sendButton} disabled={sending} onClick={sendToDatabase}>{sending ? <span className={styles.spinner} /> : <Send size={20} />}{sending ? "Przesyłanie…" : `Przekaż ${files.length} ${files.length === 1 ? "stronę" : "strony"} do bazy`}</button>
      </section>}

      <div className={styles.security}><ShieldCheck size={18} /><span><strong>Bezpieczny transfer</strong><small>Dokumenty są przesyłane szyfrowanym połączeniem.</small></span></div>

      <section className={styles.recent}><div className={styles.sectionTitle}><div><h2>Ostatnie transfery</h2></div><small>Na tym urządzeniu</small></div><div>{transfers.slice(0, 4).map((transfer) => <article key={transfer.id}><span className={styles.transferIcon}>{transfer.status === "Przesłano" ? <Check size={18} /> : <Camera size={18} />}</span><div><strong>{transfer.id}</strong><small>{transfer.pages} {transfer.pages === 1 ? "strona" : "strony"} · {transfer.time}</small></div><span className={transfer.status === "Przesłano" ? styles.done : styles.processing}>{transfer.status}</span></article>)}</div></section>
    </main>}
    <nav className={styles.bottomNav} aria-label="Nawigacja mobilna">
      <button className={activeTab === "scanner" ? styles.activeNav : ""} onClick={() => setActiveTab("scanner")}><ScanLine size={20} /><span>Skaner</span></button>
      <button className={activeTab === "routes" ? styles.activeNav : ""} onClick={() => setActiveTab("routes")}><Route size={20} /><span>Dostawy</span></button>
    </nav>
  </div>;
}
