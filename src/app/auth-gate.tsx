"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  Eye,
  EyeOff,
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
  const [mode, setMode] = useState<"sign-in" | "sign-up" | "reset">("sign-in");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  function switchMode(next: "sign-in" | "sign-up" | "reset") {
    setMode(next);
    setError(null);
    setMessage(null);
    setShowPassword(false);
  }

  useEffect(() => {
    const controller = new AbortController();
    // Some privacy extensions terminate fetches without resolving or rejecting
    // the promise. A state fallback keeps the gate from becoming a permanent
    // loading screen in that case.
    const timeout = window.setTimeout(() => {
      controller.abort();
      setStatus("guest");
    }, 10_000);
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

    if (mode === "reset") {
      const response = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.get("email") }),
      });
      const result = await response.json().catch(() => ({}));
      setSubmitting(false);
      if (!response.ok) {
        setError(result.error || "Nie udało się wysłać linku do resetu hasła.");
        return;
      }
      setMessage(result.message);
      return;
    }

    if (mode === "sign-up" && form.get("password") !== form.get("confirmPassword")) {
      setSubmitting(false);
      setError("Hasła nie są identyczne.");
      return;
    }

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
    if (response.ok && !result.confirmationRequired && !result.pendingApproval) {
      setStatus("ready");
      return;
    }
    if (result.confirmationRequired || result.pendingApproval) {
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
          <h1>
            {mode === "sign-in"
              ? "Zaloguj się"
              : mode === "sign-up"
                ? "Utwórz konto"
                : "Zresetuj hasło"}
          </h1>
          <p>
            {mode === "sign-in"
              ? "Uzyskaj dostęp do dokumentów, floty i tras dostaw."
              : mode === "sign-up"
                ? "Utwórz konto, aby uzyskać dostęp do dokumentów, floty i tras dostaw."
                : "Podaj adres e-mail konta — wyślemy na niego link do ustawienia nowego hasła."}
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
          {mode !== "reset" && (
            <label>
              Hasło
              <div className={styles.passwordField}>
                <input
                  name="password"
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={mode === "sign-up" ? 12 : 8}
                  autoComplete={
                    mode === "sign-in" ? "current-password" : "new-password"
                  }
                />
                <button
                  type="button"
                  className={styles.passwordToggle}
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? "Ukryj hasło" : "Pokaż hasło"}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </label>
          )}
          {mode === "sign-up" && (
            <label>
              Powtórz hasło
              <div className={styles.passwordField}>
                <input
                  name="confirmPassword"
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={12}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  className={styles.passwordToggle}
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? "Ukryj hasło" : "Pokaż hasło"}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </label>
          )}
          {mode === "sign-up" && <p className={styles.hint}>Minimum 12 znaków.</p>}
          {mode === "sign-in" && (
            <button
              type="button"
              className={styles.forgot}
              onClick={() => switchMode("reset")}
            >
              Nie pamiętasz hasła?
            </button>
          )}
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
                : mode === "sign-up"
                  ? "Utwórz konto"
                  : "Wyślij link do resetu hasła"}
          </button>
        </form>
        <button
          className={styles.switch}
          onClick={() =>
            switchMode(mode === "sign-up" ? "sign-in" : mode === "reset" ? "sign-in" : "sign-up")
          }
        >
          {mode === "sign-in"
            ? "Nie masz konta? Utwórz pierwsze konto"
            : mode === "sign-up"
              ? "Masz już konto? Zaloguj się"
              : "Wróć do logowania"}
        </button>
        <footer>
          <ShieldCheck size={15} />
          Sesja jest przechowywana w bezpiecznym ciasteczku HttpOnly.
        </footer>
      </section>
    </main>
  );
}
