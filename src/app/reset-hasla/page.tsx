"use client";

import { FormEvent, useEffect, useState } from "react";
import { FileText, LoaderCircle, LockKeyhole, ShieldCheck } from "lucide-react";
import styles from "../auth-gate.module.css";

export default function ResetHasloPage() {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    // Supabase redirects here with the recovery token in the URL hash
    // (never the query string), so it only ever exists client-side.
    const params = new URLSearchParams(window.location.hash.slice(1));
    const token = params.get("type") === "recovery" ? params.get("access_token") : null;
    if (token) window.history.replaceState(null, "", window.location.pathname);
    // Deferred a tick so setState isn't called synchronously in the effect
    // body (matches the pattern the sibling auth-status effect uses above).
    Promise.resolve().then(() => {
      setAccessToken(token);
      setChecked(true);
    });
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    const response = await fetch("/api/auth/reset", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken, newPassword: password }),
    });
    const result = await response.json().catch(() => ({}));
    setSubmitting(false);
    if (!response.ok) {
      setError(result.error || "Nie udało się zmienić hasła.");
      return;
    }
    setDone(true);
  }

  if (!checked)
    return (
      <main className={styles.loading}>
        <LoaderCircle />
        <span>Sprawdzamy link…</span>
      </main>
    );

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <header>
          <span>
            <FileText size={24} />
          </span>
          <div>
            <strong>
              Flota<i>Flow</i>
            </strong>
            <small>Ustaw nowe hasło</small>
          </div>
        </header>

        {!accessToken ? (
          <>
            <p className={styles.error} role="alert" style={{ marginTop: 24 }}>
              Ten link do resetu hasła jest nieprawidłowy albo już wygasł. Poproś o
              nowy na ekranie logowania.
            </p>
            <button className={styles.switch} onClick={() => (window.location.href = "/")}>
              Wróć do logowania
            </button>
          </>
        ) : done ? (
          <>
            <p className={styles.message} role="status" style={{ marginTop: 24 }}>
              Hasło zostało zmienione. Możesz się teraz zalogować.
            </p>
            <button className={styles.switch} onClick={() => (window.location.href = "/")}>
              Przejdź do logowania
            </button>
          </>
        ) : (
          <>
            <div className={styles.intro}>
              <span>
                <LockKeyhole size={20} />
              </span>
              <h1>Nowe hasło</h1>
              <p>Ustaw nowe hasło do swojego konta FlotaFlow.</p>
            </div>
            <form onSubmit={submit}>
              <label>
                Nowe hasło
                <input
                  type="password"
                  required
                  minLength={12}
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <p className={styles.hint}>Minimum 12 znaków.</p>
              {error && (
                <p className={styles.error} role="alert">
                  {error}
                </p>
              )}
              <button className={styles.submit} disabled={submitting}>
                {submitting ? (
                  <LoaderCircle className={styles.spin} />
                ) : (
                  <ShieldCheck size={19} />
                )}
                {submitting ? "Zapisywanie…" : "Zapisz nowe hasło"}
              </button>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
