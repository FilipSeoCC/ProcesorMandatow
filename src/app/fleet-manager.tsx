"use client";

import { CarFront, CheckCircle2, CircleAlert, Download, FileSpreadsheet, Plus, Search, Trash2, Upload, X } from "lucide-react";
import { ChangeEvent, useEffect, useMemo, useState } from "react";
import styles from "./fleet-manager.module.css";

export type FleetVehicle = {
  id: string;
  brand: string;
  model: string;
  registration: string;
  customer: string;
  assignedAt: string;
};

const headerAliases: Record<keyof Omit<FleetVehicle, "id">, string[]> = {
  brand: ["marka", "brand", "manufacturer", "producent"],
  model: ["model", "vehiclemodel", "modelpojazdu"],
  registration: ["nrrej", "nrrejestracyjny", "numerrejestracyjny", "registration", "registrationnumber", "plate"],
  customer: ["klient", "customer", "uzytkownik", "najemca", "firma"],
  assignedAt: ["data", "czas", "dataczas", "dataprzekazania", "assignedat", "od", "start"],
};

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function splitDelimited(line: string, delimiter: string) {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"' && quoted) { current += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === delimiter && !quoted) { cells.push(current.trim()); current = ""; }
    else current += char;
  }
  cells.push(current.trim());
  return cells;
}

function findColumn(headers: string[], field: keyof Omit<FleetVehicle, "id">) {
  return headers.findIndex((header) => headerAliases[field].includes(normalize(header)));
}

function parseCsv(text: string): FleetVehicle[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error("Plik CSV nie zawiera żadnych pojazdów.");
  const delimiter = (lines[0].match(/;/g)?.length ?? 0) >= (lines[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const headers = splitDelimited(lines[0], delimiter);
  const indexes = {
    brand: findColumn(headers, "brand"), model: findColumn(headers, "model"), registration: findColumn(headers, "registration"),
    customer: findColumn(headers, "customer"), assignedAt: findColumn(headers, "assignedAt"),
  };
  if (Object.values(indexes).some((index) => index < 0)) throw new Error("Brakuje wymaganej kolumny: marka, model, nr_rej, klient lub data_czas.");
  return lines.slice(1).map((line, rowIndex) => {
    const cells = splitDelimited(line, delimiter);
    return {
      id: `import-${Date.now()}-${rowIndex}`,
      brand: cells[indexes.brand]?.trim() ?? "", model: cells[indexes.model]?.trim() ?? "",
      registration: cells[indexes.registration]?.trim().toUpperCase() ?? "", customer: cells[indexes.customer]?.trim() ?? "",
      assignedAt: cells[indexes.assignedAt]?.trim() ?? "",
    };
  });
}

function elementText(element: Element, aliases: string[]) {
  const child = Array.from(element.children).find((item) => aliases.includes(normalize(item.tagName)));
  return child?.textContent?.trim() ?? "";
}

function parseXml(text: string): FleetVehicle[] {
  const document = new DOMParser().parseFromString(text, "application/xml");
  if (document.querySelector("parsererror")) throw new Error("Plik XML ma nieprawidłową strukturę.");
  const rows = Array.from(document.querySelectorAll("vehicle, pojazd, auto, row"));
  if (rows.length === 0) throw new Error("Nie znaleziono elementów <pojazd>, <auto>, <vehicle> ani <row>.");
  return rows.map((row, index) => ({
    id: `import-${Date.now()}-${index}`,
    brand: elementText(row, headerAliases.brand), model: elementText(row, headerAliases.model),
    registration: elementText(row, headerAliases.registration).toUpperCase(), customer: elementText(row, headerAliases.customer),
    assignedAt: elementText(row, headerAliases.assignedAt),
  }));
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("pl-PL", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export default function FleetManager({ importOpen, onCloseImport }: { importOpen: boolean; onCloseImport: () => void }) {
  const [vehicles, setVehicles] = useState<FleetVehicle[]>([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(true);
  const [vehiclesError, setVehiclesError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<FleetVehicle[]>([]);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualForm, setManualForm] = useState({
    brand: "",
    model: "",
    registration: "",
    customer: "",
    assignedAt: new Date().toISOString().slice(0, 16),
  });
  const [manualError, setManualError] = useState<string | null>(null);
  const [manualSaving, setManualSaving] = useState(false);

  const filtered = useMemo(() => vehicles.filter((vehicle) => `${vehicle.brand} ${vehicle.model} ${vehicle.registration} ${vehicle.customer}`.toLowerCase().includes(query.toLowerCase())), [query, vehicles]);
  const invalidRows = preview.filter((row) => !row.brand || !row.model || !row.registration || !row.customer || !row.assignedAt || Number.isNaN(new Date(row.assignedAt).getTime()));

  useEffect(() => {
    let cancelled = false;
    fetch("/api/fleet/vehicles")
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (!response.ok)
          throw new Error(data?.error || "Nie udało się pobrać floty.");
        return data;
      })
      .then((data) => {
        if (cancelled) return;
        if (Array.isArray(data?.vehicles)) setVehicles(data.vehicles);
      })
      .catch((reason) => {
        if (!cancelled)
          setVehiclesError(
            reason instanceof Error ? reason.message : "Nie udało się pobrać floty.",
          );
      })
      .finally(() => {
        if (!cancelled) setVehiclesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(null); setImported(null); setPreview([]); setFileName(file.name);
    if (file.size > 5 * 1024 * 1024) {
      setError("Plik przekracza limit 5 MB.");
      return;
    }
    try {
      const text = await file.text();
      const rows = file.name.toLowerCase().endsWith(".xml") ? parseXml(text) : parseCsv(text);
      setPreview(rows);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Nie udało się odczytać pliku.");
    }
  }

  async function confirmImport() {
    if (invalidRows.length > 0 || preview.length === 0) return;
    setImporting(true);
    try {
      const response = await fetch("/api/fleet/vehicles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vehicles: preview.map(({ brand, model, registration, customer, assignedAt }) => ({ brand, model, registration, customer, assignedAt })) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Nie udało się zaimportować floty.");
      setVehicles((current) => {
        const importedIds = new Set((data.vehicles as FleetVehicle[]).map((row) => row.id));
        return [...(data.vehicles as FleetVehicle[]), ...current.filter((row) => !importedIds.has(row.id))];
      });
      setImported(preview.length); setPreview([]); setFileName(""); setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Nie udało się zaimportować floty.");
    } finally {
      setImporting(false);
    }
  }

  async function addVehicle() {
    const brand = manualForm.brand.trim();
    const model = manualForm.model.trim();
    const registration = manualForm.registration.trim().toUpperCase();
    const customer = manualForm.customer.trim();
    if (!brand || !model || !registration || !customer || !manualForm.assignedAt) {
      setManualError("Uzupełnij wszystkie pola.");
      return;
    }
    if (vehicles.some((vehicle) => normalize(vehicle.registration) === normalize(registration))) {
      setManualError("Pojazd z tym numerem rejestracyjnym już istnieje.");
      return;
    }
    setManualSaving(true);
    try {
      const response = await fetch("/api/fleet/vehicles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vehicles: [{ brand, model, registration, customer, assignedAt: manualForm.assignedAt }] }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Nie udało się dodać pojazdu.");
      const [created] = data.vehicles as FleetVehicle[];
      setVehicles((current) => [created, ...current]);
      setManualForm({ brand: "", model: "", registration: "", customer: "", assignedAt: new Date().toISOString().slice(0, 16) });
      setManualError(null);
      setManualOpen(false);
    } catch (reason) {
      setManualError(reason instanceof Error ? reason.message : "Nie udało się dodać pojazdu.");
    } finally {
      setManualSaving(false);
    }
  }

  async function removeVehicle(id: string) {
    const previous = vehicles;
    setVehicles((current) => current.filter((vehicle) => vehicle.id !== id));
    try {
      const response = await fetch(`/api/fleet/vehicles/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Nie udało się usunąć pojazdu.");
      }
    } catch (reason) {
      setVehicles(previous);
      setError(reason instanceof Error ? reason.message : "Nie udało się usunąć pojazdu.");
    }
  }

  function downloadTemplate() {
    const content = "marka;model;nr_rej;klient;data_czas\nFord;Transit;WI1234A;Przykładowy Klient Sp. z o.o.;2026-07-26T10:30";
    const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "szablon-floty.csv"; link.click(); URL.revokeObjectURL(url);
  }

  return <>
    <section className={styles.summary} aria-label="Podsumowanie floty">
      <article><span className={styles.summaryIcon}><CarFront size={21} /></span><div><small>Wszystkie pojazdy</small><strong>{vehicles.length}</strong></div></article>
      <article><span className={styles.summaryIcon}><CheckCircle2 size={21} /></span><div><small>Przypisane do klientów</small><strong>{vehicles.filter((item) => item.customer !== "Flota wewnętrzna").length}</strong></div></article>
      <article><span className={styles.summaryIcon}><FileSpreadsheet size={21} /></span><div><small>Ostatnia aktualizacja</small><strong>Dzisiaj</strong></div></article>
    </section>

    <section className={styles.fleetCard}>
      <div className={styles.cardHeader}><div><h2>Kartoteka pojazdów</h2><p>Aktualne przypisanie samochodów do klientów</p></div><div className={styles.headerActions}><label className={styles.search}><Search size={18} /><span className={styles.srOnly}>Szukaj pojazdu</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Marka, nr rej. lub klient" /></label><button type="button" className={styles.addVehicleButton} onClick={() => { setManualOpen(true); setManualError(null); }}><Plus size={17} />Dodaj pojazd</button></div></div>
      <div className={styles.tableWrap}><table><thead><tr><th>Pojazd</th><th>Numer rejestracyjny</th><th>Aktualny klient</th><th>Przekazano od</th><th>Status</th><th /></tr></thead><tbody>{filtered.map((vehicle) => <tr key={vehicle.id}><td><strong>{vehicle.brand}</strong><span>{vehicle.model}</span></td><td><code>{vehicle.registration}</code></td><td>{vehicle.customer}</td><td>{formatDate(vehicle.assignedAt)}</td><td><span className={styles.activeStatus}>Aktywny</span></td><td><button type="button" className={styles.removeVehicle} onClick={() => removeVehicle(vehicle.id)} aria-label={`Usuń pojazd ${vehicle.registration}`}><Trash2 size={16} /></button></td></tr>)}</tbody></table></div>
      <div className={styles.mobileCards}>{filtered.map((vehicle) => <article key={vehicle.id}><div><code>{vehicle.registration}</code><span className={styles.activeStatus}>Aktywny</span><button type="button" className={styles.removeVehicle} onClick={() => removeVehicle(vehicle.id)} aria-label={`Usuń pojazd ${vehicle.registration}`}><Trash2 size={15} /></button></div><h3>{vehicle.brand} {vehicle.model}</h3><p>{vehicle.customer}</p><small>Od {formatDate(vehicle.assignedAt)}</small></article>)}</div>
      {vehiclesLoading && vehicles.length === 0 && <div className={styles.empty}>Ładowanie floty…</div>}
      {!vehiclesLoading && vehiclesError && (
        <div className={styles.empty}>
          <CircleAlert size={18} />
          {vehiclesError}
        </div>
      )}
      {!vehiclesLoading && !vehiclesError && filtered.length === 0 && <div className={styles.empty}>Nie znaleziono pojazdów.</div>}
    </section>

    {manualOpen && <div className={styles.modalLayer} role="dialog" aria-modal="true" aria-labelledby="fleet-manual-title"><button className={styles.backdrop} onClick={() => setManualOpen(false)} aria-label="Zamknij" /><section className={styles.modal}>
      <header><div><span>Nowy pojazd</span><h2 id="fleet-manual-title">Dodaj pojazd ręcznie</h2></div><button onClick={() => setManualOpen(false)} aria-label="Zamknij"><X size={21} /></button></header>
      <div className={styles.manualForm}>
        <label>Marka<input value={manualForm.brand} onChange={(event) => setManualForm((current) => ({ ...current, brand: event.target.value }))} placeholder="Np. Ford" /></label>
        <label>Model<input value={manualForm.model} onChange={(event) => setManualForm((current) => ({ ...current, model: event.target.value }))} placeholder="Np. Transit Custom" /></label>
        <label>Numer rejestracyjny<input value={manualForm.registration} onChange={(event) => setManualForm((current) => ({ ...current, registration: event.target.value }))} placeholder="WI 1234A" /></label>
        <label>Klient<input value={manualForm.customer} onChange={(event) => setManualForm((current) => ({ ...current, customer: event.target.value }))} placeholder="Nazwa klienta lub imię i nazwisko" /></label>
        <label>Data i czas przekazania<input type="datetime-local" value={manualForm.assignedAt} onChange={(event) => setManualForm((current) => ({ ...current, assignedAt: event.target.value }))} /></label>
      </div>
      {manualError && <div className={styles.error} role="alert"><CircleAlert size={18} /><span><strong>Nie można dodać pojazdu</strong><small>{manualError}</small></span></div>}
      <footer><button className={styles.cancel} onClick={() => setManualOpen(false)}>Anuluj</button><button className={styles.confirm} disabled={manualSaving} onClick={addVehicle}>{manualSaving ? "Zapisywanie…" : "Dodaj pojazd"}</button></footer>
    </section></div>}

    {importOpen && <div className={styles.modalLayer} role="dialog" aria-modal="true" aria-labelledby="fleet-import-title"><button className={styles.backdrop} onClick={onCloseImport} aria-label="Zamknij import" /><section className={styles.modal}>
      <header><div><span>Import danych</span><h2 id="fleet-import-title">Dodaj lub zaktualizuj flotę</h2></div><button onClick={onCloseImport} aria-label="Zamknij"><X size={21} /></button></header>
      <p className={styles.intro}>Wymagane pola: <strong>marka, model, nr rej., klient oraz data i czas przekazania</strong>.</p>
      <div className={styles.importActions}><label><input type="file" accept=".csv,text/csv,.xml,application/xml,text/xml" onChange={handleImportFile} /><span><Upload size={23} /><strong>Wybierz CSV lub XML</strong><small>Maksymalnie 5 MB</small></span></label><button onClick={downloadTemplate}><Download size={19} /><span><strong>Pobierz szablon CSV</strong><small>Gotowe nazwy kolumn</small></span></button></div>
      {error && <div className={styles.error} role="alert"><CircleAlert size={18} /><span><strong>Nie można zaimportować pliku</strong><small>{error}</small></span></div>}
      {imported !== null && <div className={styles.success}><CheckCircle2 size={18} />Zaimportowano {imported} pojazdów.</div>}
      {preview.length > 0 && <div className={styles.preview}><div className={styles.previewHeader}><div><h3>Podgląd importu</h3><span>{fileName}</span></div><strong>{preview.length} wierszy</strong></div>{invalidRows.length > 0 && <div className={styles.error}><CircleAlert size={18} /><span><strong>{invalidRows.length} niekompletnych wierszy</strong><small>Uzupełnij wymagane pola w pliku i załaduj go ponownie.</small></span></div>}<div className={styles.previewTable}><table><thead><tr><th>Marka / model</th><th>Nr rej.</th><th>Klient</th><th>Data i czas</th></tr></thead><tbody>{preview.slice(0, 5).map((row) => <tr key={row.id}><td>{row.brand} {row.model}</td><td>{row.registration}</td><td>{row.customer}</td><td>{row.assignedAt}</td></tr>)}</tbody></table></div></div>}
      <footer><button className={styles.cancel} onClick={onCloseImport}>Anuluj</button><button className={styles.confirm} disabled={preview.length === 0 || invalidRows.length > 0 || importing} onClick={confirmImport}>{importing ? "Importowanie…" : `Importuj ${preview.length > 0 ? `${preview.length} pojazdów` : "flotę"}`}</button></footer>
    </section></div>}
  </>;
}
