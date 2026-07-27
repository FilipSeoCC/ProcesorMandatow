"use client";

import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CarFront,
  Check,
  CheckCircle2,
  Clock3,
  ExternalLink,
  LoaderCircle,
  MapPin,
  Navigation,
  Plus,
  RotateCcw,
  Route,
  Sparkles,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import styles from "./delivery-planner.module.css";

type Delivery = {
  id: string;
  vehicle: string;
  customer: string;
  address: string;
  latitude: number;
  longitude: number;
  serviceMinutes: number;
  priority: number;
};
type Optimization = {
  mode: "demo" | "google";
  orderedStopIds: string[];
  distanceKm: number;
  durationMinutes: number;
  skippedStopIds: string[];
  warning?: string;
};
const depot = {
  address: "Plac floty, Warszawa",
  latitude: 52.1924,
  longitude: 20.9358,
};
const routeDraftKey = "flotaflow-route-draft-v1";

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

export default function DeliveryPlanner() {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [deliveriesLoading, setDeliveriesLoading] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [result, setResult] = useState<Optimization | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({
    customer: "",
    vehicle: "",
    address: "",
    serviceMinutes: "20",
    priority: "3",
  });
  const [geocoding, setGeocoding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [routeDirty, setRouteDirty] = useState(false);
  const [completedIds, setCompletedIds] = useState<string[]>([]);
  const [failedIds, setFailedIds] = useState<string[]>([]);
  const [planId, setPlanId] = useState<string | null>(null);
  const [stopIdByDelivery, setStopIdByDelivery] = useState<Record<string, string>>({});
  const [draftReady, setDraftReady] = useState(false);
  const [pendingAction, setPendingAction] = useState<
    "complete" | "failed" | null
  >(null);
  const [failureReason, setFailureReason] = useState("Klient nieobecny");
  const ordered = useMemo(
    () =>
      result
        ? result.orderedStopIds
            .map((id) => deliveries.find((item) => item.id === id))
            .filter((item): item is Delivery => Boolean(item))
        : deliveries.filter((item) => selected.includes(item.id)),
    [deliveries, result, selected],
  );
  const currentStop = ordered.find(
    (item) => !completedIds.includes(item.id) && !failedIds.includes(item.id),
  );
  const routeStarted = completedIds.length > 0 || failedIds.length > 0;

  useEffect(() => {
    try {
      const draft = JSON.parse(localStorage.getItem(routeDraftKey) || "null");
      if (draft?.result?.orderedStopIds && Array.isArray(draft.selected)) {
        setSelected(draft.selected);
        setResult(draft.result);
        setCompletedIds(
          Array.isArray(draft.completedIds) ? draft.completedIds : [],
        );
        setFailedIds(Array.isArray(draft.failedIds) ? draft.failedIds : []);
        setRouteDirty(Boolean(draft.routeDirty));
        setPlanId(typeof draft.planId === "string" ? draft.planId : null);
        setStopIdByDelivery(
          draft.stopIdByDelivery && typeof draft.stopIdByDelivery === "object"
            ? draft.stopIdByDelivery
            : {},
        );
      }
    } catch {}
    setDraftReady(true);
  }, []);

  useEffect(() => {
    if (!draftReady) return;
    if (!result) localStorage.removeItem(routeDraftKey);
    else
      localStorage.setItem(
        routeDraftKey,
        JSON.stringify({
          selected,
          result,
          completedIds,
          failedIds,
          routeDirty,
          planId,
          stopIdByDelivery,
        }),
      );
  }, [completedIds, draftReady, failedIds, planId, result, routeDirty, selected, stopIdByDelivery]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const token = storedAccessToken();
        const response = await fetch("/api/routes/orders", {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.error || "Nie udało się pobrać dostaw.");
        if (cancelled) return;
        setDeliveries(data.orders);
        setSelected((current) =>
          current.length
            ? current
            : data.orders.map((item: Delivery) => item.id),
        );
      } catch (reason) {
        if (!cancelled)
          setError(
            reason instanceof Error
              ? reason.message
              : "Nie udało się pobrać dostaw.",
          );
      } finally {
        if (!cancelled) setDeliveriesLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function addDelivery() {
    const customer = addForm.customer.trim();
    const address = addForm.address.trim();
    const serviceMinutes = Number(addForm.serviceMinutes);
    const priority = Number(addForm.priority);
    if (!customer || !address) {
      setAddError("Podaj klienta i adres dostawy.");
      return;
    }
    if (!Number.isFinite(serviceMinutes) || serviceMinutes < 0 || serviceMinutes > 240) {
      setAddError("Czas obsługi musi być liczbą od 0 do 240 minut.");
      return;
    }
    setGeocoding(true);
    setAddError(null);
    try {
      const token = storedAccessToken();
      const authHeader: Record<string, string> = token
        ? { Authorization: `Bearer ${token}` }
        : {};
      const geocodeResponse = await fetch("/api/routes/geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ address }),
      });
      const geocodeData = await geocodeResponse.json();
      if (!geocodeResponse.ok)
        throw new Error(geocodeData.error || "Nie udało się znaleźć adresu.");

      const orderResponse = await fetch("/api/routes/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({
          customer,
          vehicle: addForm.vehicle.trim(),
          address: geocodeData.formattedAddress || address,
          latitude: geocodeData.latitude,
          longitude: geocodeData.longitude,
          serviceMinutes,
          priority: Math.min(5, Math.max(1, priority || 3)),
        }),
      });
      const orderData = await orderResponse.json();
      if (!orderResponse.ok)
        throw new Error(orderData.error || "Nie udało się dodać dostawy.");
      const created: Delivery = orderData.order;
      setDeliveries((current) => [...current, created]);
      setSelected((current) => [...current, created.id]);
      setResult(null);
      setRouteDirty(false);
      setPlanId(null);
      setStopIdByDelivery({});
      setAddForm({
        customer: "",
        vehicle: "",
        address: "",
        serviceMinutes: "20",
        priority: "3",
      });
      setAddOpen(false);
    } catch (reason) {
      setAddError(
        reason instanceof Error ? reason.message : "Nie udało się dodać dostawy.",
      );
    } finally {
      setGeocoding(false);
    }
  }

  async function removeDelivery(id: string) {
    try {
      const token = storedAccessToken();
      const response = await fetch(
        `/api/routes/orders/${encodeURIComponent(id)}`,
        {
          method: "DELETE",
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        },
      );
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Nie udało się usunąć dostawy.");
      }
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Nie udało się usunąć dostawy.",
      );
      return;
    }
    setDeliveries((current) => current.filter((item) => item.id !== id));
    setSelected((current) => current.filter((item) => item !== id));
    setResult(null);
    setRouteDirty(false);
    setPlanId(null);
    setStopIdByDelivery({});
  }

  function toggle(id: string) {
    setResult(null);
    setRouteDirty(false);
    setPlanId(null);
    setStopIdByDelivery({});
    setSelected((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  }
  function move(index: number, direction: -1 | 1) {
    const next = [...ordered];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setResult((current) =>
      current
        ? {
            ...current,
            orderedStopIds: next.map((item) => item.id),
            warning:
              "Kolejność zmieniona ręcznie — przelicz trasę przed startem.",
          }
        : current,
    );
    setRouteDirty(true);
  }
  function confirmStopAction() {
    if (!currentStop || !pendingAction) return;
    const status = pendingAction === "complete" ? "completed" : "failed";
    if (status === "completed")
      setCompletedIds((current) => [...current, currentStop.id]);
    else setFailedIds((current) => [...current, currentStop.id]);
    const stopId = stopIdByDelivery[currentStop.id];
    if (planId && stopId) {
      const token = storedAccessToken();
      fetch(
        `/api/routes/plans/${encodeURIComponent(planId)}/stops/${encodeURIComponent(stopId)}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            status,
            notes: status === "failed" ? failureReason : "",
          }),
        },
      ).catch((reason) => console.error("Nie udało się zapisać postępu przystanku", reason));
    }
    setPendingAction(null);
  }
  function postponeCurrent() {
    if (!currentStop) return;
    setResult((current) =>
      current
        ? {
            ...current,
            orderedStopIds: [
              ...current.orderedStopIds.filter((id) => id !== currentStop.id),
              currentStop.id,
            ],
            warning: "Bieżąca dostawa została przeniesiona na koniec planu.",
          }
        : current,
    );
  }
  async function optimize() {
    const stops = deliveries.filter((item) => selected.includes(item.id));
    if (stops.length < 2) {
      setError("Wybierz przynajmniej dwie dostawy.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const token = storedAccessToken();
      const response = await fetch("/api/routes/optimize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ depot, returnToDepot: true, stops }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Nie udało się ułożyć trasy.");
      setResult(data);
      setCompletedIds([]);
      setFailedIds([]);
      setRouteDirty(false);
      setPlanId(null);
      setStopIdByDelivery({});
      try {
        const planResponse = await fetch("/api/routes/plans", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            startAddress: depot.address,
            startLatitude: depot.latitude,
            startLongitude: depot.longitude,
            distanceMeters: Math.round(data.distanceKm * 1000),
            durationSeconds: Math.round(data.durationMinutes * 60),
            optimizationSource: data.mode,
            stops: (data.orderedStopIds as string[]).map(
              (deliveryOrderId, index) => ({ deliveryOrderId, position: index + 1 }),
            ),
          }),
        });
        const planData = await planResponse.json();
        if (planResponse.ok) {
          setPlanId(planData.planId);
          setStopIdByDelivery(
            Object.fromEntries(
              (planData.stops as Array<{ deliveryOrderId: string; stopId: string }>).map(
                (stop) => [stop.deliveryOrderId, stop.stopId],
              ),
            ),
          );
        }
      } catch (reason) {
        console.error("Nie udało się zapisać planu trasy", reason);
      }
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Nie udało się ułożyć trasy.",
      );
    } finally {
      setLoading(false);
    }
  }
  const navigationUrl = currentStop
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${currentStop.latitude},${currentStop.longitude}`)}&travelmode=driving&dir_action=navigate`
    : "";

  return (
    <div className={styles.planner}>
      <section className={styles.hero}>
        <span>Plan dnia · Wadim</span>
        <h1>Dostawy samochodów</h1>
        <p>
          Wybierz auta z placu, a system ułoży możliwie krótką kolejność dostaw.
        </p>
        <div>
          <span>
            <CarFront size={18} />
            <b>{selected.length}</b>
            <small>wybrane auta</small>
          </span>
          <span>
            <MapPin size={18} />
            <b>{deliveries.length}</b>
            <small>punkty dzisiaj</small>
          </span>
        </div>
      </section>
      {!result ? (
        <>
          <section className={styles.depot}>
            <span>
              <MapPin size={19} />
            </span>
            <div>
              <small>START I POWRÓT</small>
              <strong>{depot.address}</strong>
            </div>
          </section>
          <section className={styles.section}>
            <header>
              <div>
                <h2>Auta do wydania</h2>
                <p>Zaznacz dzisiejsze dostawy</p>
              </div>
              <button
                type="button"
                className={styles.addStopButton}
                onClick={() => {
                  setAddOpen((current) => !current);
                  setAddError(null);
                }}
              >
                {addOpen ? <X size={16} /> : <Plus size={16} />}
                Dodaj dostawę
              </button>
            </header>
            {addOpen && (
              <div className={styles.addStopForm}>
                <label>
                  Klient
                  <input
                    value={addForm.customer}
                    onChange={(event) =>
                      setAddForm((current) => ({
                        ...current,
                        customer: event.target.value,
                      }))
                    }
                    placeholder="Nazwa klienta"
                  />
                </label>
                <label>
                  Adres dostawy
                  <input
                    value={addForm.address}
                    onChange={(event) =>
                      setAddForm((current) => ({
                        ...current,
                        address: event.target.value,
                      }))
                    }
                    placeholder="Ulica, numer, miasto"
                  />
                </label>
                <label>
                  Pojazd (opcjonalnie)
                  <input
                    value={addForm.vehicle}
                    onChange={(event) =>
                      setAddForm((current) => ({
                        ...current,
                        vehicle: event.target.value,
                      }))
                    }
                    placeholder="Np. Ford Transit · WI 2847K"
                  />
                </label>
                <div className={styles.addStopRow}>
                  <label>
                    Czas obsługi (min)
                    <input
                      type="number"
                      min={0}
                      max={240}
                      value={addForm.serviceMinutes}
                      onChange={(event) =>
                        setAddForm((current) => ({
                          ...current,
                          serviceMinutes: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Priorytet (1-5)
                    <input
                      type="number"
                      min={1}
                      max={5}
                      value={addForm.priority}
                      onChange={(event) =>
                        setAddForm((current) => ({
                          ...current,
                          priority: event.target.value,
                        }))
                      }
                    />
                  </label>
                </div>
                {addError && <p className={styles.error}>{addError}</p>}
                <button
                  type="button"
                  className={styles.addStopSubmit}
                  disabled={geocoding}
                  onClick={addDelivery}
                >
                  {geocoding ? (
                    <LoaderCircle className={styles.spin} size={17} />
                  ) : (
                    <Plus size={17} />
                  )}
                  {geocoding ? "Wyszukuję adres…" : "Dodaj do listy"}
                </button>
              </div>
            )}
            {deliveriesLoading && deliveries.length === 0 && (
              <p className={styles.loading}>
                <LoaderCircle className={styles.spin} size={17} />
                Ładowanie dzisiejszych dostaw…
              </p>
            )}
            <div className={styles.deliveryList}>
              {deliveries.map((delivery) => (
                <div
                  key={delivery.id}
                  className={`${styles.delivery} ${selected.includes(delivery.id) ? styles.selected : ""}`}
                >
                  <button
                    className={styles.deliveryMain}
                    onClick={() => toggle(delivery.id)}
                  >
                    <span className={styles.checkbox}>
                      {selected.includes(delivery.id) && <Check size={15} />}
                    </span>
                    <span className={styles.deliveryBody}>
                      <strong>{delivery.vehicle}</strong>
                      <b>{delivery.customer}</b>
                      <small>
                        <MapPin size={13} />
                        {delivery.address}
                      </small>
                    </span>
                    <span className={styles.duration}>
                      <Clock3 size={13} />
                      {delivery.serviceMinutes} min
                    </span>
                  </button>
                  <button
                    type="button"
                    className={styles.removeStop}
                    onClick={() => removeDelivery(delivery.id)}
                    aria-label={`Usuń dostawę ${delivery.customer}`}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          </section>
          {error && (
            <p className={styles.error}>
              <AlertTriangle size={17} />
              {error}
            </p>
          )}
          <button
            className={styles.optimize}
            onClick={optimize}
            disabled={loading || selected.length < 2}
          >
            {loading ? (
              <LoaderCircle className={styles.spin} size={21} />
            ) : (
              <Sparkles size={21} />
            )}
            {loading ? "Układam najlepszą trasę…" : "Zoptymalizuj trasę"}
          </button>
        </>
      ) : (
        <>
          <section className={styles.summary}>
            <div>
              <span>
                <Route size={18} />
                {routeStarted
                  ? "Realizacja trasy"
                  : routeDirty
                    ? "Trasa zmieniona"
                    : "Trasa gotowa"}
              </span>
              <strong>
                {routeStarted
                  ? `${completedIds.length}/${ordered.length}`
                  : routeDirty
                    ? "—"
                    : `${result.distanceKm} km`}
              </strong>
              <small>
                {routeStarted
                  ? `${failedIds.length} nieudane · ${ordered.length - completedIds.length - failedIds.length} pozostałe`
                  : routeDirty
                    ? "Przelicz czas i dystans przed startem"
                    : `około ${Math.floor(result.durationMinutes / 60)} h ${result.durationMinutes % 60} min · ${ordered.length} dostawy`}
              </small>
            </div>
            <em>
              {result.mode === "google"
                ? "Google Optimization"
                : "Tryb demonstracyjny"}
            </em>
          </section>
          {result.warning && (
            <p className={styles.warning}>
              <AlertTriangle size={16} />
              {result.warning}
            </p>
          )}
          {result.skippedStopIds.length > 0 && (
            <p className={styles.error}>
              <AlertTriangle size={17} />
              Nie udało się zaplanować:{" "}
              {result.skippedStopIds
                .map(
                  (id) =>
                    deliveries.find((item) => item.id === id)?.customer ?? id,
                )
                .join(", ")}
              . Zmień dane przed rozpoczęciem.
            </p>
          )}
          {currentStop && !routeDirty && result.skippedStopIds.length === 0 && (
            <section className={styles.currentStop}>
              <span>NAJBLIŻSZA DOSTAWA</span>
              <h2>{currentStop.customer}</h2>
              <strong>{currentStop.vehicle}</strong>
              <p>
                <MapPin size={15} />
                {currentStop.address}
              </p>
              <div>
                <button onClick={() => setPendingAction("complete")}>
                  <CheckCircle2 size={18} />
                  Auto wydane
                </button>
                <button onClick={() => setPendingAction("failed")}>
                  <XCircle size={18} />
                  Nie dostarczono
                </button>
                <button onClick={postponeCurrent}>
                  <RotateCcw size={18} />
                  Przełóż na koniec
                </button>
              </div>
            </section>
          )}
          {!currentStop && !routeDirty && (
            <section className={styles.finished}>
              <CheckCircle2 size={30} />
              <h2>Trasa zakończona</h2>
              <p>
                Wydano {completedIds.length} z {ordered.length} samochodów.
                Nieudane dostawy: {failedIds.length}.
              </p>
            </section>
          )}
          <section className={styles.routeList}>
            <div className={styles.routePoint}>
              <span>START</span>
              <div>
                <strong>{depot.address}</strong>
                <small>Plac floty</small>
              </div>
            </div>
            {ordered.map((delivery, index) => {
              const completed = completedIds.includes(delivery.id);
              const failed = failedIds.includes(delivery.id);
              const active = currentStop?.id === delivery.id;
              return (
                <article
                  key={delivery.id}
                  className={`${completed ? styles.completedStop : ""} ${failed ? styles.failedStop : ""} ${active ? styles.activeStop : ""}`}
                >
                  <span className={styles.stopNo}>
                    {completed ? (
                      <Check size={16} />
                    ) : failed ? (
                      <XCircle size={16} />
                    ) : (
                      index + 1
                    )}
                  </span>
                  <div>
                    <strong>{delivery.customer}</strong>
                    <b>{delivery.vehicle}</b>
                    <small>
                      {delivery.address} ·{" "}
                      {completed
                        ? "wydano"
                        : failed
                          ? "nie dostarczono"
                          : `${delivery.serviceMinutes} min`}
                    </small>
                  </div>
                  {!routeStarted && (
                    <span className={styles.moveButtons}>
                      <button
                        onClick={() => move(index, -1)}
                        disabled={index === 0}
                        aria-label="Przenieś wyżej"
                      >
                        <ArrowUp size={17} />
                      </button>
                      <button
                        onClick={() => move(index, 1)}
                        disabled={index === ordered.length - 1}
                        aria-label="Przenieś niżej"
                      >
                        <ArrowDown size={17} />
                      </button>
                    </span>
                  )}
                </article>
              );
            })}
            <div className={styles.routePoint}>
              <span>KONIEC</span>
              <div>
                <strong>{depot.address}</strong>
                <small>Powrót na plac</small>
              </div>
            </div>
          </section>
          <div className={styles.actions}>
            <button
              onClick={() => {
                setResult(null);
                setCompletedIds([]);
                setFailedIds([]);
                setPlanId(null);
                setStopIdByDelivery({});
                localStorage.removeItem(routeDraftKey);
              }}
            >
              Zmień dostawy
            </button>
            {routeDirty ? (
              <button className={styles.recalculate} onClick={optimize}>
                <Sparkles size={18} />
                Przelicz trasę
              </button>
            ) : result.skippedStopIds.length > 0 ? (
              <button disabled>Popraw plan</button>
            ) : currentStop ? (
              <a href={navigationUrl} target="_blank" rel="noopener noreferrer">
                <Navigation size={19} />
                Nawiguj do klienta
                <ExternalLink size={15} />
              </a>
            ) : (
              <button disabled>Trasa zakończona</button>
            )}
          </div>
          {pendingAction && currentStop && (
            <div
              className={styles.confirmLayer}
              role="dialog"
              aria-modal="true"
              aria-labelledby="confirm-action-title"
            >
              <button
                className={styles.confirmBackdrop}
                onClick={() => setPendingAction(null)}
                aria-label="Anuluj"
              />
              <section className={styles.confirmSheet}>
                <h2 id="confirm-action-title">
                  {pendingAction === "complete"
                    ? "Potwierdź wydanie auta"
                    : "Dlaczego nie dostarczono?"}
                </h2>
                <p>
                  <strong>{currentStop.vehicle}</strong>
                  <br />
                  {currentStop.customer}
                </p>
                {pendingAction === "failed" && (
                  <label>
                    Powód
                    <select
                      value={failureReason}
                      onChange={(event) => setFailureReason(event.target.value)}
                    >
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
                    className={
                      pendingAction === "complete"
                        ? styles.confirmSuccess
                        : styles.confirmFailure
                    }
                    onClick={confirmStopAction}
                  >
                    {pendingAction === "complete"
                      ? "Potwierdź wydanie"
                      : "Zapisz nieudaną dostawę"}
                  </button>
                </div>
                <small>
                  Postęp zostanie zachowany na tym telefonie i zsynchronizowany
                  z centralnym systemem.
                </small>
              </section>
            </div>
          )}
        </>
      )}
    </div>
  );
}
