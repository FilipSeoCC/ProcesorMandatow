"use client";

import { CircleAlert, Phone, Plus, Search, Trash2, UsersRound, X } from "lucide-react";
import { useMemo, useState } from "react";
import styles from "./fleet-manager.module.css";

export type Employee = {
  id: string;
  name: string;
  phone: string;
  email: string;
  license: string;
  licenseUntil: string;
  status: "Dostępny" | "W trasie" | "Urlop" | "Nieaktywny";
};

const initialEmployees: Employee[] = [
  { id: "1", name: "Wadim Kowalczyk", phone: "+48 500 111 222", email: "wadim@flotaflow.pl", license: "12345/26/2020", licenseUntil: "2029-04-10", status: "Dostępny" },
  { id: "2", name: "Adam Piotrowski", phone: "+48 500 222 333", email: "adam@flotaflow.pl", license: "98765/25/2019", licenseUntil: "2028-11-02", status: "W trasie" },
  { id: "3", name: "Marta Zawadzka", phone: "+48 500 333 444", email: "marta@flotaflow.pl", license: "55221/24/2021", licenseUntil: "2027-06-18", status: "Urlop" },
];

function normalize(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("pl-PL", { dateStyle: "medium" }).format(date);
}

const statusClass: Record<Employee["status"], string> = {
  "Dostępny": styles.activeStatus,
  "W trasie": styles.statusOnRoute,
  "Urlop": styles.statusOnLeave,
  "Nieaktywny": styles.statusInactive,
};

export default function Employees() {
  const [employees, setEmployees] = useState(initialEmployees);
  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
    license: "",
    licenseUntil: "",
    status: "Dostępny" as Employee["status"],
  });

  const filtered = useMemo(
    () =>
      employees.filter((employee) =>
        `${employee.name} ${employee.phone} ${employee.email}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [employees, query],
  );

  function addEmployee() {
    const firstName = form.firstName.trim();
    const lastName = form.lastName.trim();
    const phone = form.phone.trim();
    const license = form.license.trim();
    if (!firstName || !lastName || !phone || !license || !form.licenseUntil) {
      setError("Uzupełnij imię, nazwisko, telefon, numer i datę ważności prawa jazdy.");
      return;
    }
    const name = `${firstName} ${lastName}`;
    if (employees.some((employee) => normalize(employee.name) === normalize(name))) {
      setError("Pracownik o tym imieniu i nazwisku już istnieje.");
      return;
    }
    if (new Date(form.licenseUntil) < new Date()) {
      setError("Data ważności prawa jazdy musi przypadać w przyszłości.");
      return;
    }
    setEmployees((current) => [
      { id: `employee-${Date.now()}`, name, phone, email: form.email.trim(), license, licenseUntil: form.licenseUntil, status: form.status },
      ...current,
    ]);
    setForm({ firstName: "", lastName: "", phone: "", email: "", license: "", licenseUntil: "", status: "Dostępny" });
    setError(null);
    setAddOpen(false);
  }

  function removeEmployee(id: string) {
    setEmployees((current) => current.filter((employee) => employee.id !== id));
  }

  return (
    <>
      <section className={styles.summary} aria-label="Podsumowanie zespołu">
        <article>
          <span className={styles.summaryIcon}>
            <UsersRound size={21} />
          </span>
          <div>
            <small>Wszyscy pracownicy</small>
            <strong>{employees.length}</strong>
          </div>
        </article>
        <article>
          <span className={styles.summaryIcon}>
            <Phone size={21} />
          </span>
          <div>
            <small>Dostępni dzisiaj</small>
            <strong>{employees.filter((employee) => employee.status === "Dostępny").length}</strong>
          </div>
        </article>
        <article>
          <span className={styles.summaryIcon}>
            <CircleAlert size={21} />
          </span>
          <div>
            <small>Prawo jazdy wygasa &lt;60 dni</small>
            <strong>
              {
                employees.filter((employee) => {
                  const days = (new Date(employee.licenseUntil).getTime() - now) / 86_400_000;
                  return days >= 0 && days <= 60;
                }).length
              }
            </strong>
          </div>
        </article>
      </section>

      <section className={styles.fleetCard}>
        <div className={styles.cardHeader}>
          <div>
            <h2>Baza kierowców i pracowników</h2>
            <p>Zespół wykorzystywany przy planowaniu tras i dostaw</p>
          </div>
          <div className={styles.headerActions}>
            <label className={styles.search}>
              <Search size={18} />
              <span className={styles.srOnly}>Szukaj pracownika</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Imię, telefon lub e-mail" />
            </label>
            <button
              type="button"
              className={styles.addVehicleButton}
              onClick={() => { setAddOpen(true); setError(null); }}
            >
              <Plus size={17} />
              Dodaj pracownika
            </button>
          </div>
        </div>
        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                <th>Pracownik</th>
                <th>Kontakt</th>
                <th>Prawo jazdy</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((employee) => (
                <tr key={employee.id}>
                  <td>
                    <strong>{employee.name}</strong>
                    <span>ID: PR-{employee.id.slice(-4).toUpperCase()}</span>
                  </td>
                  <td>
                    {employee.phone}
                    <br />
                    <span>{employee.email || "Brak e-maila"}</span>
                  </td>
                  <td>
                    <code>{employee.license}</code>
                    <br />
                    <span>ważne do {formatDate(employee.licenseUntil)}</span>
                  </td>
                  <td>
                    <span className={statusClass[employee.status]}>{employee.status}</span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className={styles.removeVehicle}
                      onClick={() => removeEmployee(employee.id)}
                      aria-label={`Usuń pracownika ${employee.name}`}
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className={styles.mobileCards}>
          {filtered.map((employee) => (
            <article key={employee.id}>
              <div>
                <code>{employee.phone}</code>
                <span className={statusClass[employee.status]}>{employee.status}</span>
                <button
                  type="button"
                  className={styles.removeVehicle}
                  onClick={() => removeEmployee(employee.id)}
                  aria-label={`Usuń pracownika ${employee.name}`}
                >
                  <Trash2 size={15} />
                </button>
              </div>
              <h3>{employee.name}</h3>
              <p>{employee.email || "Brak e-maila"}</p>
              <small>Prawo jazdy ważne do {formatDate(employee.licenseUntil)}</small>
            </article>
          ))}
        </div>
        {filtered.length === 0 && <div className={styles.empty}>Nie znaleziono pracowników.</div>}
      </section>

      {addOpen && (
        <div className={styles.modalLayer} role="dialog" aria-modal="true" aria-labelledby="employee-add-title">
          <button className={styles.backdrop} onClick={() => setAddOpen(false)} aria-label="Zamknij" />
          <section className={styles.modal}>
            <header>
              <div>
                <span>Struktura zespołu</span>
                <h2 id="employee-add-title">Dodaj kierowcę</h2>
              </div>
              <button onClick={() => setAddOpen(false)} aria-label="Zamknij">
                <X size={21} />
              </button>
            </header>
            <div className={styles.manualForm}>
              <label>
                Imię
                <input value={form.firstName} onChange={(event) => setForm((current) => ({ ...current, firstName: event.target.value }))} placeholder="Adam" />
              </label>
              <label>
                Nazwisko
                <input value={form.lastName} onChange={(event) => setForm((current) => ({ ...current, lastName: event.target.value }))} placeholder="Nowak" />
              </label>
              <label>
                Telefon
                <input value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} placeholder="+48 500 000 000" />
              </label>
              <label>
                Adres e-mail
                <input type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} placeholder="adam@firma.pl" />
              </label>
              <label>
                Numer prawa jazdy
                <input value={form.license} onChange={(event) => setForm((current) => ({ ...current, license: event.target.value }))} placeholder="00000/00/0000" />
              </label>
              <label>
                Ważne do
                <input type="date" value={form.licenseUntil} onChange={(event) => setForm((current) => ({ ...current, licenseUntil: event.target.value }))} />
              </label>
              <label>
                Status
                <select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as Employee["status"] }))}>
                  <option>Dostępny</option>
                  <option>W trasie</option>
                  <option>Urlop</option>
                  <option>Nieaktywny</option>
                </select>
              </label>
            </div>
            {error && (
              <div className={styles.error} role="alert">
                <CircleAlert size={18} />
                <span>
                  <strong>Nie można dodać pracownika</strong>
                  <small>{error}</small>
                </span>
              </div>
            )}
            <footer>
              <button className={styles.cancel} onClick={() => setAddOpen(false)}>
                Anuluj
              </button>
              <button className={styles.confirm} onClick={addEmployee}>
                Dodaj kierowcę
              </button>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
