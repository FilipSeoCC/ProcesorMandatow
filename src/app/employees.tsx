"use client";

import { CircleAlert, ChevronDown, Phone, Plus, Search, ShieldCheck, Trash2, UsersRound, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import styles from "./fleet-manager.module.css";
import wstyles from "./workspace.module.css";

export type Employee = {
  id: string;
  name: string;
  phone: string;
  email: string;
  status: "Dostępny" | "W trasie" | "Urlop" | "Nieaktywny";
};

export type TeamMember = {
  userId: string;
  role: string;
  email: string | null;
  name: string | null;
};

type TeamProps = {
  team: TeamMember[];
  teamPending: { userId: string; role: "admin" | "boss" | "user" } | null;
  teamUpdating: string | null;
  teamError: string | null;
  viewerRole: string | null;
  onStagePendingRole: (userId: string, role: "admin" | "boss" | "user") => void;
  onConfirmRole: (userId: string, role: "admin" | "boss" | "user") => void;
  onCancelRole: () => void;
};

function normalize(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const statusClass: Record<Employee["status"], string> = {
  "Dostępny": styles.activeStatus,
  "W trasie": styles.activeStatus,
  "Urlop": styles.activeStatus,
  "Nieaktywny": styles.activeStatus,
};

const emptyForm = {
  firstName: "",
  lastName: "",
  phone: "",
  email: "",
  status: "Dostępny" as Employee["status"],
};

export default function Employees({
  team,
  teamPending,
  teamUpdating,
  teamError,
  viewerRole,
  onStagePendingRole,
  onConfirmRole,
  onCancelRole,
}: TeamProps) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  async function loadEmployees() {
    try {
      const response = await fetch("/api/fleet/drivers", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Nie udało się pobrać pracowników.");
      setEmployees(data.employees ?? []);
      setLoadError(null);
    } catch (reason) {
      setLoadError(reason instanceof Error ? reason.message : "Nie udało się pobrać pracowników.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount pattern
    loadEmployees();
  }, []);

  const filtered = useMemo(
    () =>
      employees.filter((employee) =>
        `${employee.name} ${employee.phone} ${employee.email}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [employees, query],
  );

  function openAdd() {
    setEditingId(null);
    setForm(emptyForm);
    setError(null);
    setAddOpen(true);
  }

  function openEdit(employee: Employee) {
    const [firstName, ...rest] = employee.name.split(" ");
    setEditingId(employee.id);
    setForm({
      firstName: firstName ?? "",
      lastName: rest.join(" "),
      phone: employee.phone,
      email: employee.email,
      status: employee.status,
    });
    setError(null);
    setAddOpen(true);
  }

  async function saveEmployee() {
    const firstName = form.firstName.trim();
    const lastName = form.lastName.trim();
    const phone = form.phone.trim();
    if (!firstName || !lastName || !phone) {
      setError("Uzupełnij imię, nazwisko i telefon.");
      return;
    }
    const name = `${firstName} ${lastName}`;
    if (
      !editingId &&
      employees.some((employee) => normalize(employee.name) === normalize(name))
    ) {
      setError("Pracownik o tym imieniu i nazwisku już istnieje.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/fleet/drivers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingId,
          firstName,
          lastName,
          phone,
          email: form.email.trim(),
          status: form.status,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Nie udało się zapisać pracownika.");
      await loadEmployees();
      setForm(emptyForm);
      setEditingId(null);
      setAddOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Nie udało się zapisać pracownika.");
    } finally {
      setSaving(false);
    }
  }

  async function removeEmployee(id: string) {
    if (removingId) return;
    setRemovingId(id);
    try {
      const response = await fetch(`/api/fleet/drivers/${id}`, { method: "DELETE" });
      if (response.ok) setEmployees((current) => current.filter((employee) => employee.id !== id));
    } finally {
      setRemovingId(null);
    }
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
            <small>Nieaktywni</small>
            <strong>{employees.filter((employee) => employee.status === "Nieaktywny").length}</strong>
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
              onClick={openAdd}
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
                    <span className={statusClass[employee.status]}>{employee.status}</span>
                  </td>
                  <td className={styles.rowActions}>
                    <button
                      type="button"
                      className={styles.editVehicle}
                      onClick={() => openEdit(employee)}
                      aria-label={`Edytuj pracownika ${employee.name}`}
                    >
                      Edytuj
                    </button>
                    <button
                      type="button"
                      className={styles.removeVehicle}
                      disabled={removingId === employee.id}
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
                <span className={styles.mobileCardRight}>
                  <span className={statusClass[employee.status]}>{employee.status}</span>
                  <span className={styles.mobileRowActions}>
                    <button
                      type="button"
                      className={styles.editVehicle}
                      onClick={() => openEdit(employee)}
                      aria-label={`Edytuj pracownika ${employee.name}`}
                    >
                      Edytuj
                    </button>
                    <button
                      type="button"
                      className={styles.removeVehicle}
                      disabled={removingId === employee.id}
                      onClick={() => removeEmployee(employee.id)}
                      aria-label={`Usuń pracownika ${employee.name}`}
                    >
                      <Trash2 size={15} />
                    </button>
                  </span>
                </span>
              </div>
              <h3>{employee.name}</h3>
              <p>{employee.email || "Brak e-maila"}</p>
            </article>
          ))}
        </div>
        {loading && <div className={styles.empty}>Ładowanie zespołu…</div>}
        {!loading && loadError && <div className={styles.empty}>{loadError}</div>}
        {!loading && !loadError && filtered.length === 0 && <div className={styles.empty}>Nie znaleziono pracowników.</div>}
      </section>

      {(viewerRole === "admin" || viewerRole === "boss") && (
        <section className={styles.fleetCard} aria-label="Konta i uprawnienia">
          <div className={styles.cardHeader}>
            <div>
              <h2>Konta i uprawnienia</h2>
              <p>
                Nowe konta rejestrują się samodzielnie z rolą &bdquo;user&rdquo;
                (bez zatwierdzania spraw). Nadaj &bdquo;boss&rdquo; albo
                &bdquo;admin&rdquo; poniżej.
              </p>
            </div>
          </div>
          {teamError && <p className={wstyles.uploadError}>{teamError}</p>}
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>Konto</th>
                  <th>Rola</th>
                  <th>Akcje</th>
                </tr>
              </thead>
              <tbody>
                {team.map((member) => {
                  const locked = viewerRole === "boss" && member.role === "admin";
                  const pending =
                    teamPending?.userId === member.userId ? teamPending.role : null;
                  const saving = teamUpdating === member.userId;
                  return (
                    <tr key={member.userId}>
                      <td>
                        <strong>{member.name || member.email || member.userId}</strong>
                        {member.name && member.email && <span>{member.email}</span>}
                      </td>
                      <td>
                        {locked ? (
                          <span className={styles.activeStatus}>
                            <ShieldCheck size={12} /> Admin
                          </span>
                        ) : (
                          <label className={wstyles.selectBox}>
                            <span className={wstyles.srOnly}>Rola</span>
                            <select
                              value={pending ?? member.role}
                              disabled={saving}
                              onChange={(event) =>
                                onStagePendingRole(
                                  member.userId,
                                  event.target.value as "admin" | "boss" | "user",
                                )
                              }
                            >
                              <option value="user">User (pracownik)</option>
                              <option value="boss">Boss (kierownik/szef)</option>
                              {viewerRole === "admin" && <option value="admin">Admin</option>}
                            </select>
                            <ChevronDown size={16} />
                          </label>
                        )}
                      </td>
                      <td className={styles.rowActions}>
                        {!locked && pending && pending !== member.role && (
                          <>
                            <button
                              type="button"
                              className={wstyles.primaryButton}
                              disabled={saving}
                              onClick={() => onConfirmRole(member.userId, pending)}
                            >
                              {saving ? "Zapisuję…" : "Zatwierdź"}
                            </button>
                            <button
                              type="button"
                              className={wstyles.secondaryButton}
                              disabled={saving}
                              onClick={onCancelRole}
                            >
                              Anuluj
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className={styles.mobileCards}>
            {team.map((member) => {
              const locked = viewerRole === "boss" && member.role === "admin";
              const pending =
                teamPending?.userId === member.userId ? teamPending.role : null;
              const saving = teamUpdating === member.userId;
              return (
                <article key={member.userId}>
                  <h3>{member.name || member.email || member.userId}</h3>
                  {member.name && member.email && <p>{member.email}</p>}
                  {locked ? (
                    <span className={styles.activeStatus}>
                      <ShieldCheck size={12} /> Admin
                    </span>
                  ) : (
                    <>
                      <label className={wstyles.selectBox}>
                        <span className={wstyles.srOnly}>Rola</span>
                        <select
                          value={pending ?? member.role}
                          disabled={saving}
                          onChange={(event) =>
                            onStagePendingRole(
                              member.userId,
                              event.target.value as "admin" | "boss" | "user",
                            )
                          }
                        >
                          <option value="user">User (pracownik)</option>
                          <option value="boss">Boss (kierownik/szef)</option>
                          {viewerRole === "admin" && <option value="admin">Admin</option>}
                        </select>
                        <ChevronDown size={16} />
                      </label>
                      {pending && pending !== member.role && (
                        <span className={styles.mobileRowActions}>
                          <button
                            type="button"
                            className={wstyles.primaryButton}
                            disabled={saving}
                            onClick={() => onConfirmRole(member.userId, pending)}
                          >
                            {saving ? "Zapisuję…" : "Zatwierdź"}
                          </button>
                          <button
                            type="button"
                            className={wstyles.secondaryButton}
                            disabled={saving}
                            onClick={onCancelRole}
                          >
                            Anuluj
                          </button>
                        </span>
                      )}
                    </>
                  )}
                </article>
              );
            })}
          </div>
          {team.length === 0 && <div className={styles.empty}>Brak kont w zespole.</div>}
        </section>
      )}

      {addOpen && (
        <div className={styles.modalLayer} role="dialog" aria-modal="true" aria-labelledby="employee-add-title">
          <button className={styles.backdrop} onClick={() => setAddOpen(false)} aria-label="Zamknij" />
          <section className={styles.modal}>
            <header>
              <div>
                <span>Struktura zespołu</span>
                <h2 id="employee-add-title">{editingId ? "Edytuj pracownika" : "Dodaj pracownika"}</h2>
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
                  <strong>Nie można zapisać pracownika</strong>
                  <small>{error}</small>
                </span>
              </div>
            )}
            <footer>
              <button className={styles.cancel} onClick={() => setAddOpen(false)}>
                Anuluj
              </button>
              <button className={styles.confirm} disabled={saving} onClick={saveEmployee}>
                {saving ? "Zapisuję…" : editingId ? "Zapisz zmiany" : "Dodaj pracownika"}
              </button>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
