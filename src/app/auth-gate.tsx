"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  Bug,
  CheckCircle2,
  FileText,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  ShieldCheck,
  X,
} from "lucide-react";
import styles from "./auth-gate.module.css";

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

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<"loading" | "guest" | "ready">(
    "loading",
  );
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [bugOpen, setBugOpen] = useState(false);
  const [bugDescription, setBugDescription] = useState("");
  const [bugStatus, setBugStatus] = useState<
    "idle" | "sending" | "sent" | "error"
  >("idle");
  const [bugError, setBugError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth", { cache: "no-store" })
      .then((response) => setStatus(response.ok ? "ready" : "guest"))
      .catch(() => setStatus("guest"));
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
        companyName: form.get("companyName"),
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

  async function signOut() {
    await fetch("/api/auth", { method: "DELETE" });
    setStatus("guest");
  }

  async function submitBugReport() {
    const description = bugDescription.trim();
    if (!description) {
      setBugStatus("error");
      setBugError("Opisz co się stało.");
      return;
    }
    setBugStatus("sending");
    setBugError(null);
    try {
      const token = storedAccessToken();
      const response = await fetch("/api/bug-reports", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ description, context: document.title }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(data.error || "Nie udało się wysłać zgłoszenia.");
      setBugStatus("sent");
      setBugDescription("");
      window.setTimeout(() => {
        setBugOpen(false);
        setBugStatus("idle");
      }, 1600);
    } catch (reason) {
      setBugStatus("error");
      setBugError(
        reason instanceof Error ? reason.message : "Nie udało się wysłać zgłoszenia.",
      );
    }
  }

  if (status === "loading")
    return (
      <main className={styles.loading}>
        <LoaderCircle />
        <span>Sprawdzamy bezpieczną sesję…</span>
      </main>
    );
  if (status === "ready")
    return (
      <>
        <button
          className={styles.mobileLogout}
          onClick={signOut}
          aria-label="Wyloguj"
        >
          <LogOut size={18} />
        </button>
        <button
          type="button"
          className={styles.reportBugButton}
          onClick={() => {
            setBugOpen(true);
            setBugStatus("idle");
            setBugError(null);
          }}
          aria-label="Zgłoś błąd"
          title="Zgłoś błąd"
        >
          <Bug size={18} />
        </button>
        {bugOpen && (
          <div
            className={styles.bugModalLayer}
            role="dialog"
            aria-modal="true"
            aria-labelledby="bug-report-title"
          >
            <button
              className={styles.bugModalBackdrop}
              onClick={() => setBugOpen(false)}
              aria-label="Zamknij"
            />
            <div className={styles.bugModal}>
              <header>
                <h2 id="bug-report-title">Zgłoś błąd</h2>
                <button onClick={() => setBugOpen(false)} aria-label="Zamknij">
                  <X size={19} />
                </button>
              </header>
              {bugStatus === "sent" ? (
                <div className={styles.bugSent} role="status">
                  <CheckCircle2 size={20} />
                  Zgłoszenie wysłane, dziękujemy.
                </div>
              ) : (
                <>
                  <label>
                    Co się stało?
                    <textarea
                      value={bugDescription}
                      onChange={(event) => setBugDescription(event.target.value)}
                      rows={5}
                      placeholder="Opisz problem — co robiłeś, co się stało, czego się spodziewałeś."
                    />
                  </label>
                  {bugStatus === "error" && bugError && (
                    <p className={styles.bugError} role="alert">
                      {bugError}
                    </p>
                  )}
                  <button
                    type="button"
                    className={styles.bugSubmit}
                    disabled={bugStatus === "sending"}
                    onClick={submitBugReport}
                  >
                    {bugStatus === "sending" ? "Wysyłam…" : "Wyślij zgłoszenie"}
                  </button>
                </>
              )}
            </div>
          </div>
        )}
        {children}
      </>
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
                Nazwa firmy
                <input
                  name="companyName"
                  required
                  minLength={2}
                  autoComplete="organization"
                />
              </label>
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
              autoComplete="email"
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
