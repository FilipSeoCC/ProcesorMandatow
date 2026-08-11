"use client";

import { FormEvent, useEffect, useState } from "react";
import { Eye, EyeOff, FileText, LoaderCircle, LockKeyhole, ShieldCheck } from "lucide-react";
import styles from "./auth-gate.module.css";
import OnboardingGate, { type OnboardingData } from "./onboarding-gate";

function readOnboardingData(value: unknown): OnboardingData | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Partial<OnboardingData>;
  if (
    typeof data.required !== "boolean" ||
    typeof data.completed !== "boolean" ||
    typeof data.step !== "number" ||
    !data.role ||
    !["admin", "boss", "user"].includes(data.role)
  )
    return null;
  return {
    required: data.required,
    completed: data.completed,
    step: data.step,
    role: data.role,
    email: typeof data.email === "string" ? data.email : null,
    firstName: typeof data.firstName === "string" ? data.firstName : "",
    lastName: typeof data.lastName === "string" ? data.lastName : "",
    phone: typeof data.phone === "string" ? data.phone : "",
  };
}

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<"loading" | "guest" | "mfa" | "ready">("loading");
  const [mode, setMode] = useState<"sign-in" | "sign-up" | "reset">("sign-in");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [onboardingData, setOnboardingData] = useState<OnboardingData | null>(null);
  const [mfaEnrollmentRequired, setMfaEnrollmentRequired] = useState(false);
  const [mfaFactorId, setMfaFactorId] = useState("");
  const [mfaQrCode, setMfaQrCode] = useState("");
  const [mfaSecret, setMfaSecret] = useState("");
  const [mfaCode, setMfaCode] = useState("");

  function switchMode(next: "sign-in" | "sign-up" | "reset") {
    setMode(next);
    setError(null);
    setMessage(null);
    setShowPassword(false);
  }

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      controller.abort();
      setStatus("guest");
    }, 10_000);
    async function checkSession() {
      const response = await fetch("/api/auth", { cache: "no-store", signal: controller.signal });
      if (response.ok) {
        const result = (await response.json().catch(() => ({}))) as { onboarding?: unknown };
        setOnboardingData(readOnboardingData(result.onboarding));
        setStatus("ready");
        return;
      }
      const mfaResponse = await fetch("/api/auth/mfa", {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!mfaResponse.ok) {
        setStatus("guest");
        return;
      }
      const mfa = (await mfaResponse.json()) as { enrollmentRequired?: boolean };
      setMfaEnrollmentRequired(Boolean(mfa.enrollmentRequired));
      setStatus("mfa");
    }
    checkSession()
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
      if (!response.ok) setError(result.error || "Nie udało się wysłać linku do resetu hasła.");
      else setMessage(result.message);
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
    if (result.mfaRequired) {
      setMfaEnrollmentRequired(Boolean(result.enrollmentRequired));
      setMfaFactorId("");
      setMfaQrCode("");
      setMfaCode("");
      setStatus("mfa");
      return;
    }
    if (response.ok && !result.confirmationRequired && !result.pendingApproval) {
      setOnboardingData(readOnboardingData(result.onboarding));
      setStatus("ready");
      return;
    }
    if (result.confirmationRequired || result.pendingApproval) {
      setMessage(result.message);
      return;
    }
    setError(result.error || "Nie udało się połączyć z usługą logowania.");
  }

  async function beginMfaEnrollment() {
    setSubmitting(true);
    setError(null);
    const response = await fetch("/api/auth/mfa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "enroll" }),
    });
    const result = await response.json().catch(() => ({}));
    setSubmitting(false);
    if (!response.ok) {
      setError(result.error || "Nie udało się rozpocząć konfiguracji MFA.");
      return;
    }
    setMfaFactorId(result.factorId ?? "");
    setMfaQrCode(result.qrCode ?? "");
    setMfaSecret(result.secret ?? "");
  }

  async function verifyMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const response = await fetch("/api/auth/mfa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "verify", factorId: mfaFactorId, code: mfaCode }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      setSubmitting(false);
      setError(result.error || "Nieprawidłowy kod MFA.");
      return;
    }
    const session = await fetch("/api/auth", { cache: "no-store" });
    const sessionData = await session.json().catch(() => ({}));
    setSubmitting(false);
    if (!session.ok) {
      setError("Sesja MFA nie została aktywowana. Zaloguj się ponownie.");
      setStatus("guest");
      return;
    }
    setOnboardingData(readOnboardingData(sessionData.onboarding));
    setStatus("ready");
  }

  if (status === "loading")
    return <main className={styles.loading}><LoaderCircle /><span>Sprawdzamy bezpieczną sesję…</span></main>;
  if (status === "ready")
    return <OnboardingGate initialData={onboardingData}>{children}</OnboardingGate>;
  if (status === "mfa")
    return (
      <main className={styles.page}>
        <section className={styles.card}>
          <BrandHeader />
          <div className={styles.intro}>
            <span><ShieldCheck size={20} /></span>
            <h1>Weryfikacja dwuetapowa</h1>
            <p>
              {mfaEnrollmentRequired && !mfaQrCode
                ? "Konto administratora lub bossa wymaga ochrony kodem TOTP."
                : "Wpisz sześciocyfrowy kod z aplikacji uwierzytelniającej."}
            </p>
          </div>
          {mfaEnrollmentRequired && !mfaQrCode ? (
            <button className={styles.submit} disabled={submitting} onClick={beginMfaEnrollment}>
              {submitting ? <LoaderCircle className={styles.spin} /> : <ShieldCheck size={19} />}
              Skonfiguruj MFA
            </button>
          ) : (
            <form onSubmit={verifyMfa}>
              {mfaQrCode && (
                <div className={styles.mfaSetup}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={mfaQrCode} alt="Kod QR do konfiguracji MFA" />
                  <p>Zeskanuj kod w Google Authenticator, Microsoft Authenticator lub 1Password.</p>
                  {mfaSecret && <code>{mfaSecret}</code>}
                </div>
              )}
              <label>Kod jednorazowy
                <input
                  value={mfaCode}
                  onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                />
              </label>
              {error && <p className={styles.error} role="alert">{error}</p>}
              <button className={styles.submit} disabled={submitting || mfaCode.length !== 6}>
                {submitting ? <LoaderCircle className={styles.spin} /> : <ShieldCheck size={19} />}
                Potwierdź kod
              </button>
            </form>
          )}
          {error && mfaEnrollmentRequired && !mfaQrCode && <p className={styles.error}>{error}</p>}
          <button
            className={styles.switch}
            onClick={async () => {
              await fetch("/api/auth/mfa", { method: "DELETE" });
              setStatus("guest");
            }}
          >Wróć do logowania</button>
        </section>
      </main>
    );

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <BrandHeader />
        <div className={styles.intro}>
          <span><LockKeyhole size={20} /></span>
          <h1>{mode === "sign-in" ? "Zaloguj się" : mode === "sign-up" ? "Utwórz konto" : "Zresetuj hasło"}</h1>
          <p>
            {mode === "sign-in"
              ? "Uzyskaj dostęp do dokumentów, floty i tras dostaw."
              : mode === "sign-up"
                ? "Po rejestracji boss lub administrator zaakceptuje konto i nada rolę."
                : "Podaj adres e-mail konta — wyślemy link do ustawienia nowego hasła."}
          </p>
        </div>
        <form onSubmit={submit}>
          {mode === "sign-up" && <>
            <label>Imię<input name="firstName" required autoComplete="given-name" /></label>
            <label>Nazwisko<input name="lastName" required autoComplete="family-name" /></label>
            <label>Numer telefonu<input name="phone" type="tel" required autoComplete="tel" inputMode="tel" /></label>
          </>}
          <label>Adres e-mail
            <input name="email" type="email" required autoComplete="username" inputMode="email" />
          </label>
          {mode !== "reset" && <label>Hasło
            <div className={styles.passwordField}>
              <input
                name="password"
                type={showPassword ? "text" : "password"}
                required
                minLength={mode === "sign-up" ? 12 : 1}
                maxLength={128}
                autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
              />
              <button type="button" className={styles.passwordToggle} onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Ukryj hasło" : "Pokaż hasło"}>
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </label>}
          {mode === "sign-up" && <label>Powtórz hasło
            <input name="confirmPassword" type={showPassword ? "text" : "password"} required minLength={12} maxLength={128} autoComplete="new-password" />
          </label>}
          {mode === "sign-up" && <p className={styles.hint}>Minimum 12 znaków; hasło nie może występować w publicznych wyciekach.</p>}
          {mode === "sign-in" && <button type="button" className={styles.forgot} onClick={() => switchMode("reset")}>Nie pamiętasz hasła?</button>}
          {mode === "sign-up" && <label className={styles.consentLabel}>
            <input type="checkbox" name="consent" required />
            <span>Akceptuję <a href="/polityka-prywatnosci" target="_blank" rel="noopener noreferrer">politykę prywatności</a> i zgadzam się na przetwarzanie danych w celu obsługi konta.</span>
          </label>}
          {error && <p className={styles.error} role="alert">{error}</p>}
          {message && <p className={styles.message} role="status">{message}</p>}
          <button className={styles.submit} disabled={submitting}>
            {submitting ? <LoaderCircle className={styles.spin} /> : <ShieldCheck size={19} />}
            {submitting ? "Łączenie…" : mode === "sign-in" ? "Zaloguj bezpiecznie" : mode === "sign-up" ? "Utwórz konto" : "Wyślij link do resetu hasła"}
          </button>
        </form>
        <button className={styles.switch} onClick={() => switchMode(mode === "sign-up" || mode === "reset" ? "sign-in" : "sign-up")}>
          {mode === "sign-in" ? "Nie masz konta? Zarejestruj się" : mode === "sign-up" ? "Masz już konto? Zaloguj się" : "Wróć do logowania"}
        </button>
        <footer><ShieldCheck size={15} />Sesja jest przechowywana w bezpiecznym ciasteczku HttpOnly.</footer>
      </section>
    </main>
  );
}

function BrandHeader() {
  return (
    <header>
      <span><FileText size={24} /></span>
      <div><strong>Flota<i>Flow</i></strong><small>Bezpieczny panel operacyjny</small></div>
    </header>
  );
}
