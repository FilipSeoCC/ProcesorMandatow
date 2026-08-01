"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  FileText,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import styles from "./auth-gate.module.css";

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<"loading" | "guest" | "ready">(
    "loading",
  );
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10_000);
    fetch("/api/auth", { cache: "no-store", signal: controller.signal })
      .then((response) => setStatus(response.ok ? "ready" : "guest"))
      .catch(() => setStatus("guest"))
      .finally(() => window.clearTimeout(timeout));
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: mode,
        email: form.get("email"),
        password: form.get("password"),
        firstName: form.get("firstName"),
        lastName: form.get("lastName"),
        phone: form.get("phone"),
        consent: form.get("consent") === "on",
      }),
    });
    const result = await response.json().catch(() => ({}));
    setSubmitting(false);
    if (response.ok && !result.confirmationRequired) {
      setStatus("ready");
      return;
    }
    if (result.confirmationRequired) {
      setMessage(result.message);
      return;
    }
    setError(result.error || "Nie udało się połączyć z Supabase.");
  }

  if (status === "loading")
    return (
      <main className={styles.loading}>
        <LoaderCircle />
        <span>Sprawdzamy bezpieczną sesję…</span>
      </main>
    );
  if (status === "ready") return <>{children}</>;
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
            <small>Bezpieczny panel operacyjny</small>
          </div>
        </header>
        <div className={styles.intro}>
          <span>
            <LockKeyhole size={20} />
          </span>
          <h1>{mode === "sign-in" ? "Zaloguj się" : "Utwórz konto"}</h1>
          <p>
            {mode === "sign-in"
              ? "Uzyskaj dostęp do dokumentów, floty i tras dostaw."
              : "Utwórz konto, aby uzyskać dostęp do dokumentów, floty i tras dostaw."}
          </p>
        </div>
        <form onSubmit={submit}>
          {mode === "sign-up" && (
            <>
              <label>
                Imię
                <input name="firstName" required autoComplete="given-name" />
              </label>
              <label>
                Nazwisko
                <input name="lastName" required autoComplete="family-name" />
              </label>
              <label>
                Numer telefonu
                <input
                  name="phone"
                  type="tel"
                  required
                  autoComplete="tel"
                  inputMode="tel"
                />
              </label>
            </>
          )}
          <label>
            Adres e-mail
            <input
              name="email"
              type="email"
              required
              autoComplete="username"
              inputMode="email"
            />
          </label>
          <label>
            Hasło
            <input
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete={
                mode === "sign-in" ? "current-password" : "new-password"
              }
            />
          </label>
          {mode === "sign-up" && (
            <label className={styles.consentLabel}>
              <input type="checkbox" name="consent" required />
              <span>
                Akceptuję{" "}
                <a
                  href="/polityka-prywatnosci"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  politykę prywatności
                </a>{" "}
                i zgadzam się na przetwarzanie moich danych w celu obsługi konta.
              </span>
            </label>
          )}
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          {message && (
            <p className={styles.message} role="status">
              {message}
            </p>
          )}
          <button className={styles.submit} disabled={submitting}>
            {submitting ? (
              <LoaderCircle className={styles.spin} />
            ) : (
              <ShieldCheck size={19} />
            )}
            {submitting
              ? "Łączenie…"
              : mode === "sign-in"
                ? "Zaloguj bezpiecznie"
                : "Utwórz konto"}
          </button>
        </form>
        <button
          className={styles.switch}
          onClick={() => {
            setMode(mode === "sign-in" ? "sign-up" : "sign-in");
            setError(null);
            setMessage(null);
          }}
        >
          {mode === "sign-in"
            ? "Nie masz konta? Utwórz pierwsze konto"
            : "Masz już konto? Zaloguj się"}
        </button>
        <footer>
          <ShieldCheck size={15} />
          Sesja jest przechowywana w bezpiecznym ciasteczku HttpOnly.
        </footer>
      </section>
    </main>
  );
}
