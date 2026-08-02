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
  address: "Aleje Jerozolimskie 228, 02-495 Warszawa",
  latitude: 52.18798,
  longitude: 20.91054,
};
const routeDraftKey = "flotaflow-route-draft-v1";
const initialDeliveries: Delivery[] = [
  {
    id: "DST-104",
    vehicle: "Toyota Proace · WI 2847K",
    customer: "Nova Bud Sp. z o.o.",
    address: "Puławska 427, Warszawa",
    latitude: 52.1455,
    longitude: 21.0218,
    serviceMinutes: 20,
    priority: 4,
  },
  {
    id: "DST-105",
    vehicle: "Ford Transit · WW 91R2",
    customer: "Verto Group Sp. z o.o.",
    address: "Postępu 14, Warszawa",
    latitude: 52.1798,
    longitude: 20.9981,
    serviceMinutes: 25,
    priority: 3,
  },
  {
    id: "DST-106",
    vehicle: "Mercedes Vito · WX 5520M",
    customer: "ABC Instalacje",
    address: "Mickiewicza 22, Łomianki",
    latitude: 52.3342,
    longitude: 20.8862,
    serviceMinutes: 20,
    priority: 2,
  },
  {
    id: "DST-107",
    vehicle: "Renault Master · WPR 77A9",
    customer: "M-Projekt",
    address: "Sienkiewicza 31, Pruszków",
    latitude: 52.1692,
    longitude: 20.8026,
    serviceMinutes: 30,
    priority: 1,
  },
];

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
  const [deliveries, setDeliveries] = useState(initialDeliveries);
  const [selected, setSelected] = useState<string[]>(
    initialDeliveries.map((item) => item.id),
  );
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
        // eslint-disable-next-line react-hooks/set-state-in-effect -- restores the saved route draft on mount; localStorage cannot be read during render
        setSelected(draft.selected);
        setResult(draft.result);
        setCompletedIds(
          Array.isArray(draft.completedIds) ? draft.completedIds : [],
        );
        setFailedIds(Array.isArray(draft.failedIds) ? draft.failedIds : []);
        setRouteDirty(Boolean(draft.routeDirty));
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
        }),
      );
  }, [completedIds, draftReady, failedIds, result, routeDirty, selected]);

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
      const response = await fetch("/api/routes/geocode", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ address }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Nie udało się znaleźć adresu.");
      const id = `DST-${Date.now().toString(36).toUpperCase()}`;
      setDeliveries((current) => [
        ...current,
        {
          id,
          vehicle: addForm.vehicle.trim() || "Nieprzypisany",
          customer,
          address: data.formattedAddress || address,
          latitude: data.latitude,
          longitude: data.longitude,
          serviceMinutes,
          priority: Math.min(5, Math.max(1, priority || 3)),
        },
      ]);
      setSelected((current) => [...current, id]);
      setResult(null);
      setRouteDirty(false);
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

  function removeDelivery(id: string) {
    setDeliveries((current) => current.filter((item) => item.id !== id));
    setSelected((current) => current.filter((item) => item !== id));
    setResult(null);
    setRouteDirty(false);
  }

  function toggle(id: string) {
    setResult(null);
    setRouteDirty(false);
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
    if (pendingAction === "complete")
      setCompletedIds((current) => [...current, currentStop.id]);
    else setFailedIds((current) => [...current, currentStop.id]);
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
  // Navigate to the address, not to raw coordinates. Google reverse-geocodes a
  // bare lat/lng to the nearest named place, so the driver was shown things
  // like a school instead of "Postępu 14" and could not tell whether the pin
  // was right. The address here is Google's own formatted_address from the
  // geocoding step, so it resolves back to the same point.
  // One navigation link covering everything still to deliver, in the order we
  // optimized — sending only the next stop threw away the whole point of
  // planning the route. Addresses rather than raw lat/lng, because Google
  // reverse-geocodes bare coordinates to the nearest named place and the
  // driver ends up staring at some unrelated building.
  const mapsPoint = (stop: { address: string; latitude: number; longitude: number }) =>
    stop.address?.trim() || `${stop.latitude},${stop.longitude}`;
  const remainingStops = ordered.filter(
    (item) => !completedIds.includes(item.id) && !failedIds.includes(item.id),
  );
  // Google's URL API accepts at most 9 intermediate waypoints; beyond that it
  // silently drops the tail, so we hand over one batch and the driver reopens
  // the link once those are done.
  const WAYPOINT_LIMIT = 9;
  const navigationUrl = (() => {
    if (!remainingStops.length) return "";
    const capped = remainingStops.slice(0, WAYPOINT_LIMIT + 1);
    const destination = mapsPoint(capped[capped.length - 1]);
    const waypoints = capped.slice(0, -1).map(mapsPoint);
    const base = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
      destination,
    )}&travelmode=driving`;
    return waypoints.length
      ? `${base}&waypoints=${encodeURIComponent(waypoints.join("|"))}`
      : `${base}&dir_action=navigate`;
  })();
  const navigationLabel =
    remainingStops.length > 1
      ? `Nawiguj całą trasą (${Math.min(remainingStops.length, WAYPOINT_LIMIT + 1)})`
      : "Nawiguj do klienta";

  return (
    <div
      className={`${styles.planner} ${result ? styles.plannerWithActions : ""}`}
    >
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
              // No target="_blank" here on purpose: the app runs installed as a
              // standalone PWA (manifest.ts) and WebKit's standalone mode has no
              // "new tab" to open into, so target="_blank" links silently do
              // nothing on iOS — this is what made "Nawiguj" look unresponsive.
              // Navigating in the same context lets the OS hand off to the
              // native Maps app instead, which is the actual desired behavior.
              <a href={navigationUrl} rel="noreferrer">
                <Navigation size={19} />
                {navigationLabel}
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
                  Postęp zostanie zachowany na tym telefonie. Zapis centralny
                  uruchomi się po podłączeniu Supabase.
                </small>
              </section>
            </div>
          )}
        </>
      )}
    </div>
  );
}
