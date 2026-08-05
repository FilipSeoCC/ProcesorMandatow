"use client";

import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock3,
  ExternalLink,
  LoaderCircle,
  MapPin,
  Navigation,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { buildNavigation } from "@/lib/navigation-url";
import plannerStyles from "./delivery-planner.module.css";
import styles from "./mobile-route.module.css";

type Stop = {
  stopId: string;
  vehicle: string;
  customer: string;
  address: string;
  latitude: number;
  longitude: number;
  serviceMinutes: number;
  status: "planned" | "delivered" | "failed";
  notes: string;
  windowStart: string | null;
  windowEnd: string | null;
};
type Plan = { id: string; distanceKm: number; durationMinutes: number; stops: Stop[] };

function formatWindow(windowStart: string | null, windowEnd: string | null) {
  if (!windowStart && !windowEnd) return null;
  const time = (value: string) =>
    new Date(value).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
  if (windowStart && windowEnd) return `${time(windowStart)}–${time(windowEnd)}`;
  return time(windowStart || windowEnd!);
}

export default function MobileRoute() {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"complete" | "failed" | null>(null);
  const [failureReason, setFailureReason] = useState("Klient nieobecny");
  const [stopActionLoading, setStopActionLoading] = useState(false);
  const [currentUserName, setCurrentUserName] = useState<string | null>(null);

  async function loadPlan() {
    setLoading(true);
    try {
      const response = await fetch("/api/routes/plan", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "Nie udało się pobrać trasy.");
        return;
      }
      setPlan(data.plan ?? null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount pattern used throughout this codebase
    loadPlan();
    fetch("/api/auth", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!data) return;
        const full = `${data.firstName ?? ""} ${data.lastName ?? ""}`.trim();
        setCurrentUserName(full || data.email || null);
      })
      .catch(() => {});
  }, []);

  const ordered = plan?.stops ?? [];
  const currentStop = ordered.find((item) => item.status === "planned");
  const remainingStops = ordered.filter((item) => item.status === "planned");
  const { url: navigationUrl, label: navigationLabel } = buildNavigation(remainingStops);

  async function confirmStopAction() {
    if (!currentStop || !pendingAction) return;
    setStopActionLoading(true);
    try {
      const status = pendingAction === "complete" ? "delivered" : "failed";
      const notes = pendingAction === "failed" ? failureReason : "";
      const response = await fetch(`/api/routes/plan/stops/${currentStop.stopId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, notes }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(data.error || "Nie udało się zapisać statusu dostawy.");
      setPlan((current) =>
        current
          ? {
              ...current,
              stops: current.stops.map((item) =>
                item.stopId === currentStop.stopId ? { ...item, status, notes } : item,
              ),
            }
          : current,
      );
      setPendingAction(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Nie udało się zapisać statusu dostawy.");
    } finally {
      setStopActionLoading(false);
    }
  }

  return (
    <div className={plannerStyles.planner}>
      <section className={styles.header}>
        <span>Moja trasa na dziś{currentUserName ? ` · ${currentUserName}` : ""}</span>
        <h1>Zadania dnia</h1>
      </section>
      {error && (
        <p className={plannerStyles.error}>
          <AlertTriangle size={17} />
          {error}
        </p>
      )}
      {loading ? (
        <p className={plannerStyles.loading}>
          <LoaderCircle className={plannerStyles.spin} size={17} />
          Ładowanie trasy…
        </p>
      ) : !plan || !ordered.length ? (
        <p className={plannerStyles.emptyState}>
          Brak zaplanowanej trasy na dziś — sprawdź z dyspozytorem.
        </p>
      ) : (
        <>
          {currentStop && (
            <section className={plannerStyles.currentStop}>
              <span>NAJBLIŻSZA DOSTAWA</span>
              <h2>{currentStop.customer}</h2>
              <strong>{currentStop.vehicle}</strong>
              <p>
                <MapPin size={15} />
                {currentStop.address}
              </p>
              {formatWindow(currentStop.windowStart, currentStop.windowEnd) && (
                <p>
                  <Clock3 size={15} />
                  {formatWindow(currentStop.windowStart, currentStop.windowEnd)}
                </p>
              )}
              <div>
                <button onClick={() => setPendingAction("complete")}>
                  <CheckCircle2 size={18} />
                  Auto wydane
                </button>
                <button onClick={() => setPendingAction("failed")}>
                  <XCircle size={18} />
                  Nie dostarczono
                </button>
              </div>
            </section>
          )}
          {!currentStop && (
            <section className={plannerStyles.finished}>
              <CheckCircle2 size={30} />
              <h2>Trasa zakończona</h2>
              <p>
                Wydano {ordered.filter((item) => item.status === "delivered").length} z{" "}
                {ordered.length} samochodów. Nieudane dostawy:{" "}
                {ordered.filter((item) => item.status === "failed").length}.
              </p>
            </section>
          )}
          <section className={plannerStyles.routeList}>
            {ordered.map((stop, index) => {
              const completed = stop.status === "delivered";
              const failed = stop.status === "failed";
              const active = currentStop?.stopId === stop.stopId;
              return (
                <article
                  key={stop.stopId}
                  className={`${completed ? plannerStyles.completedStop : ""} ${failed ? plannerStyles.failedStop : ""} ${active ? plannerStyles.activeStop : ""}`}
                >
                  <span className={plannerStyles.stopNo}>
                    {completed ? <Check size={16} /> : failed ? <XCircle size={16} /> : index + 1}
                  </span>
                  <div>
                    <strong>{stop.customer}</strong>
                    <b>{stop.vehicle}</b>
                    <small>
                      {stop.address}
                      {formatWindow(stop.windowStart, stop.windowEnd)
                        ? ` · ${formatWindow(stop.windowStart, stop.windowEnd)}`
                        : ""}{" "}
                      ·{" "}
                      {completed
                        ? "wydano"
                        : failed
                          ? "nie dostarczono"
                          : `${stop.serviceMinutes} min`}
                    </small>
                  </div>
                </article>
              );
            })}
          </section>
          <div className={plannerStyles.actions}>
            {currentStop ? (
              <a href={navigationUrl} rel="noreferrer">
                <Navigation size={19} />
                {navigationLabel}
                <ExternalLink size={15} />
              </a>
            ) : (
              <button disabled>Trasa zakończona</button>
            )}
          </div>
        </>
      )}
      {pendingAction && currentStop && (
        <div className={plannerStyles.confirmLayer} role="dialog" aria-modal="true" aria-labelledby="mobile-confirm-title">
          <button
            className={plannerStyles.confirmBackdrop}
            onClick={() => setPendingAction(null)}
            aria-label="Anuluj"
          />
          <section className={plannerStyles.confirmSheet}>
            <h2 id="mobile-confirm-title">
              {pendingAction === "complete" ? "Potwierdź wydanie auta" : "Dlaczego nie dostarczono?"}
            </h2>
            <p>
              <strong>{currentStop.vehicle}</strong>
              <br />
              {currentStop.customer}
            </p>
            {pendingAction === "failed" && (
              <label>
                Powód
                <select value={failureReason} onChange={(event) => setFailureReason(event.target.value)}>
                  <option>Klient nieobecny</option>
                  <option>Błędny adres</option>
                  <option>Klient odmówił odbioru</option>
                  <option>Problem z pojazdem</option>
                  <option>Inny powód</option>
                </select>
              </label>
            )}
            <div>
              <button onClick={() => setPendingAction(null)}>Anuluj</button>
              <button
                className={pendingAction === "complete" ? plannerStyles.confirmSuccess : plannerStyles.confirmFailure}
                disabled={stopActionLoading}
                onClick={confirmStopAction}
              >
                {stopActionLoading
                  ? "Zapisuję…"
                  : pendingAction === "complete"
                    ? "Potwierdź wydanie"
                    : "Zapisz nieudaną dostawę"}
              </button>
            </div>
            <small>Zapis trafia od razu do bazy — widoczny dla całego zespołu.</small>
          </section>
        </div>
      )}
    </div>
  );
}
