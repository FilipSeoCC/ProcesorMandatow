"use client";

import {
  ArrowLeft,
  ArrowRight,
  Camera,
  CarFront,
  Check,
  CheckCircle2,
  FileCheck2,
  FileText,
  LoaderCircle,
  Route,
  ShieldCheck,
  Sparkles,
  UserRound,
  UsersRound,
} from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import styles from "./onboarding-gate.module.css";

type AppRole = "admin" | "boss" | "user";
export type OnboardingData = {
  required: boolean;
  completed: boolean;
  step: number;
  role: AppRole;
  email: string | null;
  firstName: string;
  lastName: string;
  phone: string;
};

const steps = ["Witaj", "Twoje dane", "Twój dostęp", "Gotowe"];

const roleDetails: Record<
  AppRole,
  { label: string; summary: string; permissions: string[] }
> = {
  admin: {
    label: "Administrator",
    summary: "Pełna kontrola nad organizacją, zespołem i procesem obsługi spraw.",
    permissions: [
      "Zarządzanie kontami i rolami",
      "Zatwierdzanie danych spraw",
      "Dostęp do floty, tras i raportów",
    ],
  },
  boss: {
    label: "Kierownik",
    summary: "Nadzór nad pracą operacyjną i zatwierdzanie przygotowanych spraw.",
    permissions: [
      "Zatwierdzanie danych spraw",
      "Zarządzanie pracą zespołu",
      "Dostęp do floty i planera tras",
    ],
  },
  user: {
    label: "Pracownik",
    summary: "Codzienna obsługa dokumentów, pojazdów i zadań terenowych.",
    permissions: [
      "Skanowanie i weryfikacja dokumentów",
      "Dopasowywanie pojazdu do klienta",
      "Praca z flotą i trasami dostaw",
    ],
  },
};

async function responseError(response: Response, fallback: string) {
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  return data.error || fallback;
}

export default function OnboardingGate({
  children,
  initialData,
}: {
  children: React.ReactNode;
  initialData?: OnboardingData | null;
}) {
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">(
    initialData ? "ready" : "loading",
  );
  const [data, setData] = useState<OnboardingData | null>(initialData ?? null);
  const [step, setStep] = useState(() =>
    initialData ? Math.min(3, Math.max(0, initialData.step)) : 0,
  );
  const [open, setOpen] = useState(initialData?.required ?? false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [firstName, setFirstName] = useState(initialData?.firstName ?? "");
  const [lastName, setLastName] = useState(initialData?.lastName ?? "");
  const [phone, setPhone] = useState(initialData?.phone ?? "");
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (initialData) return;
    const controller = new AbortController();
    let active = true;
    const timeout = window.setTimeout(() => {
      controller.abort();
      if (active) setStatus("unavailable");
    }, 8_000);
    fetch("/api/auth/onboarding", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(await responseError(response, "Nie udało się odczytać konfiguracji."));
        return (await response.json()) as OnboardingData;
      })
      .then((nextData) => {
        if (!active) return;
        setData(nextData);
        setStep(Math.min(3, Math.max(0, nextData.step)));
        setFirstName(nextData.firstName);
        setLastName(nextData.lastName);
        setPhone(nextData.phone);
        setOpen(nextData.required);
        setStatus("ready");
      })
      // Onboarding must never become a second auth gate. If its endpoint is
      // temporarily unavailable, the already-authorized workspace still opens.
      .catch((reason) => {
        if (!active) return;
        if (reason instanceof DOMException && reason.name === "AbortError") {
          setStatus("unavailable");
          return;
        }
        setStatus("unavailable");
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [initialData]);

  useEffect(() => {
    function openOnboarding() {
      setStep(0);
      setError(null);
      setOpen(true);
    }
    window.addEventListener("flotaflow:open-onboarding", openOnboarding);
    return () => window.removeEventListener("flotaflow:open-onboarding", openOnboarding);
  }, []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const timer = window.setTimeout(() => headingRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, step]);

  async function saveProgress(nextStep: number, profile = false, complete = false) {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/onboarding", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          step: nextStep,
          complete,
          ...(profile ? { firstName, lastName, phone } : {}),
        }),
      });
      if (!response.ok)
        throw new Error(await responseError(response, "Nie udało się zapisać postępu."));
      if (complete) {
        setData((current) =>
          current ? { ...current, required: false, completed: true, step: 3 } : current,
        );
        setOpen(false);
      } else {
        setStep(nextStep);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Nie udało się zapisać postępu.");
    } finally {
      setSubmitting(false);
    }
  }

  function next(event?: FormEvent) {
    event?.preventDefault();
    if (step === 1 && (!firstName.trim() || !lastName.trim() || !phone.trim())) {
      setError("Uzupełnij imię, nazwisko i numer telefonu.");
      return;
    }
    if (step === 3) {
      void saveProgress(3, false, true);
      return;
    }
    void saveProgress(step + 1, step === 1);
  }

  function back() {
    if (step === 0 || submitting) return;
    void saveProgress(step - 1);
  }

  if (status === "loading")
    return (
      <main className={styles.loading} aria-live="polite">
        <span className={styles.loadingMark}>
          <FileText size={24} />
        </span>
        <LoaderCircle className={styles.spin} />
        <span>Przygotowujemy Twoje konto…</span>
      </main>
    );

  const showResume = status === "ready" && data?.required && !open;
  const role = roleDetails[data?.role ?? "user"];

  return (
    <>
      {children}
      {showResume && (
        <button
          type="button"
          className={styles.resumeButton}
          onClick={() => setOpen(true)}
        >
          <Sparkles size={18} />
          Dokończ konfigurację
        </button>
      )}
      {open && data && (
        <div className={styles.backdrop}>
          <section
            className={styles.shell}
            role="dialog"
            aria-modal="true"
            aria-labelledby="onboarding-title"
          >
            <aside className={styles.sidebar}>
              <div className={styles.brand}>
                <span className={styles.brandMark}>
                  <FileText size={21} />
                </span>
                <span>
                  <strong>FlotaFlow</strong>
                  <small>Centrum operacyjne floty</small>
                </span>
              </div>
              <div className={styles.progressLabel}>KONFIGURACJA KONTA</div>
              <ol className={styles.stepList}>
                {steps.map((label, index) => (
                  <li
                    key={label}
                    className={`${styles.stepItem} ${
                      index === step ? styles.stepActive : ""
                    } ${index < step ? styles.stepDone : ""}`}
                    aria-current={index === step ? "step" : undefined}
                  >
                    <span>{index < step ? <Check size={14} /> : index + 1}</span>
                    <strong>{label}</strong>
                  </li>
                ))}
              </ol>
              <div className={styles.securityNote}>
                <ShieldCheck size={18} />
                <span>
                  <strong>Bezpieczny zapis</strong>
                  <small>Postęp jest przypisany do Twojego konta.</small>
                </span>
              </div>
            </aside>

            <main className={styles.content}>
              <header className={styles.mobileHeader}>
                <div className={styles.brand}>
                  <span className={styles.brandMark}>
                    <FileText size={19} />
                  </span>
                  <strong>FlotaFlow</strong>
                </div>
                <div className={styles.mobileHeaderActions}>
                  <span>Krok {step + 1} z {steps.length}</span>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    disabled={submitting}
                  >
                    Później
                  </button>
                </div>
              </header>
              <div className={styles.mobileProgress} aria-hidden="true">
                <span style={{ width: `${((step + 1) / steps.length) * 100}%` }} />
              </div>
              <div className={styles.topline}>
                <span>Krok {step + 1} z {steps.length}</span>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={submitting}
                >
                  Dokończę później
                </button>
              </div>

              <form className={styles.screen} onSubmit={next} noValidate>
                {step === 0 && (
                  <>
                    <span className={styles.heroIcon}>
                      <Sparkles size={30} />
                    </span>
                    <span className={styles.kicker}>ZACZYNAMY</span>
                    <h1 id="onboarding-title" ref={headingRef} tabIndex={-1}>
                      Witaj{data.firstName ? `, ${data.firstName}` : ""} w FlotaFlow
                    </h1>
                    <p className={styles.lead}>
                      W kilka chwil pokażemy Ci najważniejsze funkcje i potwierdzimy dane konta.
                    </p>
                    <div className={styles.featureGrid}>
                      <article>
                        <Camera size={20} />
                        <span><strong>Skanuj dokumenty</strong><small>Telefonem lub z pliku</small></span>
                      </article>
                      <article>
                        <FileCheck2 size={20} />
                        <span><strong>Obsługuj sprawy</strong><small>OCR i dopasowanie klienta</small></span>
                      </article>
                      <article>
                        <Route size={20} />
                        <span><strong>Planuj dostawy</strong><small>Flota i zadania w jednym miejscu</small></span>
                      </article>
                    </div>
                  </>
                )}

                {step === 1 && (
                  <>
                    <span className={styles.kicker}>PROFIL UŻYTKOWNIKA</span>
                    <h1 id="onboarding-title" ref={headingRef} tabIndex={-1}>
                      Potwierdź swoje dane
                    </h1>
                    <p className={styles.lead}>
                      Będziemy ich używać w historii działań i dokumentach przygotowywanych przez system.
                    </p>
                    <div className={styles.formCard}>
                      <div className={styles.formGrid}>
                        <label>
                          Imię
                          <input
                            value={firstName}
                            onChange={(event) => {
                              setFirstName(event.target.value);
                              setError(null);
                            }}
                            autoComplete="given-name"
                            maxLength={80}
                            required
                          />
                        </label>
                        <label>
                          Nazwisko
                          <input
                            value={lastName}
                            onChange={(event) => {
                              setLastName(event.target.value);
                              setError(null);
                            }}
                            autoComplete="family-name"
                            maxLength={80}
                            required
                          />
                        </label>
                      </div>
                      <label>
                        Numer telefonu
                        <input
                          type="tel"
                          inputMode="tel"
                          value={phone}
                          onChange={(event) => {
                            setPhone(event.target.value);
                            setError(null);
                          }}
                          autoComplete="tel"
                          maxLength={40}
                          placeholder="+48 500 000 000"
                          required
                        />
                      </label>
                      <div className={styles.readonlyField}>
                        <span>Adres e-mail</span>
                        <strong>{data.email || "—"}</strong>
                      </div>
                    </div>
                  </>
                )}

                {step === 2 && (
                  <>
                    <span className={styles.kicker}>TWÓJ ZAKRES DOSTĘPU</span>
                    <h1 id="onboarding-title" ref={headingRef} tabIndex={-1}>
                      Rola: {role.label}
                    </h1>
                    <p className={styles.lead}>{role.summary}</p>
                    <div className={styles.roleCard}>
                      <div className={styles.roleHeader}>
                        <span><UserRound size={22} /></span>
                        <div>
                          <small>PRZYPISANA ROLA</small>
                          <strong>{role.label}</strong>
                        </div>
                        <ShieldCheck size={22} />
                      </div>
                      <ul>
                        {role.permissions.map((permission) => (
                          <li key={permission}>
                            <CheckCircle2 size={18} />
                            {permission}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className={styles.infoNote}>
                      <UsersRound size={19} />
                      <p>
                        Uprawnienia nadaje administrator. Jeśli zakres jest nieprawidłowy, skontaktuj się z osobą zarządzającą zespołem.
                      </p>
                    </div>
                  </>
                )}

                {step === 3 && (
                  <>
                    <span className={styles.finishIcon}>
                      <Check size={32} />
                    </span>
                    <span className={styles.kicker}>KONTO GOTOWE</span>
                    <h1 id="onboarding-title" ref={headingRef} tabIndex={-1}>
                      Możesz rozpocząć pracę
                    </h1>
                    <p className={styles.lead}>
                      Profil jest uzupełniony, a dostęp został dopasowany do Twojej roli.
                    </p>
                    <div className={styles.summaryGrid}>
                      <article><UserRound size={19} /><span><small>Użytkownik</small><strong>{`${firstName} ${lastName}`.trim()}</strong></span></article>
                      <article><ShieldCheck size={19} /><span><small>Rola</small><strong>{role.label}</strong></span></article>
                      <article><CarFront size={19} /><span><small>Środowisko</small><strong>FlotaFlow</strong></span></article>
                    </div>
                  </>
                )}

                <div className={styles.formStatus} aria-live="polite">
                  {error && <p role="alert">{error}</p>}
                </div>

                <footer className={styles.actions}>
                  <button
                    type="button"
                    className={`${styles.secondaryButton} ${step === 0 ? styles.hiddenAction : ""}`}
                    onClick={back}
                    disabled={submitting || step === 0}
                  >
                    <ArrowLeft size={18} />
                    Wstecz
                  </button>
                  <button type="submit" className={styles.primaryButton} disabled={submitting}>
                    {submitting ? (
                      <LoaderCircle className={styles.spin} size={19} />
                    ) : step === 3 ? (
                      <Check size={19} />
                    ) : (
                      <ArrowRight size={19} />
                    )}
                    {submitting
                      ? "Zapisuję…"
                      : step === 0
                        ? "Rozpocznij konfigurację"
                        : step === 3
                          ? "Przejdź do FlotaFlow"
                          : "Zapisz i przejdź dalej"}
                  </button>
                </footer>
              </form>
            </main>
          </section>
        </div>
      )}
      {status === "unavailable" && null}
    </>
  );
}
