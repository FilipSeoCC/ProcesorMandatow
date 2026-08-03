"use client";

import { Building2, CircleAlert, MapPin, Phone, Plus, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import styles from "./fleet-manager.module.css";

type Branch = { id: string; name: string; address: string; phone: string; hours: string };
type BranchVehicle = { id: string; label: string; branchId: string | null };

function storedAccessToken() {
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (!key?.startsWith("sb-") || !key.endsWith("-auth-token")) continue;
    try {
      const session = JSON.parse(localStorage.getItem(key) || "null");
      if (session?.access_token) return String(session.access_token);
    } catch {}
  }
  return null;
}

function authHeaders() {
  const token = storedAccessToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

const emptyForm = { name: "", address: "", phone: "", hours: "" };

export default function Branches() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [vehicles, setVehicles] = useState<BranchVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [relocatingId, setRelocatingId] = useState<string | null>(null);

  async function load() {
    try {
      const response = await fetch("/api/fleet/branches", {
        headers: authHeaders(),
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Nie udało się pobrać oddziałów.");
      setBranches(data.branches ?? []);
      setVehicles(data.vehicles ?? []);
      setLoadError(null);
    } catch (reason) {
      setLoadError(reason instanceof Error ? reason.message : "Nie udało się pobrać oddziałów.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    load();
  }, []);

  async function addBranch() {
    const name = form.name.trim();
    const address = form.address.trim();
    if (!name || !address) {
      setError("Podaj nazwę i adres oddziału.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/fleet/branches", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          name,
          address,
          phone: form.phone.trim(),
          hours: form.hours.trim(),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Nie udało się dodać oddziału.");
      await load();
      setForm(emptyForm);
      setAddOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Nie udało się dodać oddziału.");
    } finally {
      setSaving(false);
    }
  }

  async function removeBranch(id: string) {
    if (removingId) return;
    setRemovingId(id);
    try {
      const response = await fetch(`/api/fleet/branches/${id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (response.ok) await load();
    } finally {
      setRemovingId(null);
    }
  }

  async function relocate(vehicleId: string, branchId: string) {
    if (!branchId) return;
    setRelocatingId(vehicleId);
    try {
      const response = await fetch("/api/fleet/branches/relocate", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ vehicleId, branchId }),
      });
      if (response.ok)
        setVehicles((current) =>
          current.map((item) => (item.id === vehicleId ? { ...item, branchId } : item)),
        );
    } finally {
      setRelocatingId(null);
    }
  }

  return (
    <>
      <section className={styles.fleetCard}>
        <div className={styles.cardHeader}>
          <div>
            <h2>Oddziały</h2>
            <p>Lokalizacje floty i dane kontaktowe</p>
          </div>
          <div className={styles.headerActions}>
            <button
              type="button"
              className={styles.addVehicleButton}
              onClick={() => {
                setAddOpen(true);
                setError(null);
              }}
            >
              <Plus size={17} />
              Dodaj oddział
            </button>
          </div>
        </div>
        <div className={styles.summary} aria-label="Lista oddziałów">
          {branches.map((branch) => (
            <article key={branch.id}>
              <span className={styles.summaryIcon}>
                <Building2 size={20} />
              </span>
              <div>
                <small>{branch.name}</small>
                <strong style={{ fontSize: "13px" }}>{branch.address}</strong>
                {branch.phone && <p style={{ marginTop: 4, fontSize: 11, color: "#7b8a9e" }}>{branch.phone}</p>}
                {branch.hours && <p style={{ fontSize: 10, color: "#8b98aa" }}>{branch.hours}</p>}
              </div>
              <button
                type="button"
                className={styles.removeVehicle}
                disabled={removingId === branch.id}
                onClick={() => removeBranch(branch.id)}
                aria-label={`Usuń oddział ${branch.name}`}
              >
                <Trash2 size={15} />
              </button>
            </article>
          ))}
        </div>
        {loading && <div className={styles.empty}>Ładowanie oddziałów…</div>}
        {!loading && loadError && <div className={styles.empty}>{loadError}</div>}
        {!loading && !loadError && branches.length === 0 && (
          <div className={styles.empty}>Brak oddziałów. Dodaj pierwszy powyżej.</div>
        )}
      </section>

      <section className={styles.fleetCard} style={{ marginTop: 18 }}>
        <div className={styles.cardHeader}>
          <div>
            <h2>Relokacja pojazdów</h2>
            <p>Przenieś pojazd między oddziałami</p>
          </div>
        </div>
        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                <th>Pojazd</th>
                <th>Aktualny oddział</th>
              </tr>
            </thead>
            <tbody>
              {vehicles.map((vehicle) => (
                <tr key={vehicle.id}>
                  <td>
                    <code>{vehicle.label}</code>
                  </td>
                  <td>
                    <select
                      value={vehicle.branchId ?? ""}
                      disabled={relocatingId === vehicle.id || branches.length === 0}
                      onChange={(event) => relocate(vehicle.id, event.target.value)}
                    >
                      <option value="">Brak przypisania</option>
                      {branches.map((branch) => (
                        <option key={branch.id} value={branch.id}>
                          {branch.name}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className={styles.mobileCards}>
          {vehicles.map((vehicle) => (
            <article key={vehicle.id}>
              <code>{vehicle.label}</code>
              <div style={{ marginTop: 8 }}>
                <select
                  value={vehicle.branchId ?? ""}
                  disabled={relocatingId === vehicle.id || branches.length === 0}
                  onChange={(event) => relocate(vehicle.id, event.target.value)}
                >
                  <option value="">Brak przypisania</option>
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </select>
              </div>
            </article>
          ))}
        </div>
        {!loading && vehicles.length === 0 && (
          <div className={styles.empty}>Brak pojazdów we flocie.</div>
        )}
      </section>

      {addOpen && (
        <div className={styles.modalLayer} role="dialog" aria-modal="true" aria-labelledby="branch-add-title">
          <button className={styles.backdrop} onClick={() => setAddOpen(false)} aria-label="Zamknij" />
          <section className={styles.modal}>
            <header>
              <div>
                <span>Oddziały</span>
                <h2 id="branch-add-title">Dodaj oddział</h2>
              </div>
              <button onClick={() => setAddOpen(false)} aria-label="Zamknij">
                <X size={21} />
              </button>
            </header>
            <div className={styles.manualForm}>
              <label>
                Nazwa (miasto)
                <input
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="Warszawa"
                />
              </label>
              <label>
                Adres
                <input
                  value={form.address}
                  onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))}
                  placeholder="ul. Aleje Jerozolimskie 228, 02-495"
                />
              </label>
              <label>
                <Phone size={13} style={{ display: "inline", marginRight: 4 }} />
                Telefon
                <input
                  value={form.phone}
                  onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
                  placeholder="+48 517 628 083"
                />
              </label>
              <label>
                <MapPin size={13} style={{ display: "inline", marginRight: 4 }} />
                Godziny otwarcia
                <input
                  value={form.hours}
                  onChange={(event) => setForm((current) => ({ ...current, hours: event.target.value }))}
                  placeholder="pon-pt. 8:00-18:00, sb. 8:00 - 15:00"
                />
              </label>
            </div>
            {error && (
              <div className={styles.error} role="alert">
                <CircleAlert size={18} />
                <span>
                  <strong>Nie można dodać oddziału</strong>
                  <small>{error}</small>
                </span>
              </div>
            )}
            <footer>
              <button className={styles.cancel} onClick={() => setAddOpen(false)}>
                Anuluj
              </button>
              <button className={styles.confirm} disabled={saving} onClick={addBranch}>
                {saving ? "Zapisuję…" : "Dodaj oddział"}
              </button>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
