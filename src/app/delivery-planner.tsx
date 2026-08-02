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
import { useEffect, useState } from "react";
import styles from "./delivery-planner.module.css";

type Delivery = {
  id: string;
  vehicleId: string;
  vehicle: string;
  customer: string;
  address: string;
  latitude: number;
  longitude: number;
  serviceMinutes: number;
  priority: number;
};
type PlanStop = {
  stopId: string;
  deliveryId: string;
  vehicle: string;
  customer: string;
  address: string;
  latitude: number;
  longitude: number;
  serviceMinutes: number;
  status: "planned" | "delivered" | "failed";
  notes: string;
};
type Plan = {
  id: string;
  startAddress: string;
  mode: string;
  distanceKm: number;
  durationMinutes: number;
  stops: PlanStop[];
};
type OptimizeWarning = { skippedCustomers: string[]; warning?: string };
type FleetVehicle = {
  id: string;
  brand: string;
  model: string;
  registration: string;
  customer: string;
};
const depot = {
  address: "Aleje Jerozolimskie 228, 02-495 Warszawa",
  latitude: 52.18798,
  longitude: 20.91054,
};

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

export default function DeliveryPlanner() {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [deliveriesLoading, setDeliveriesLoading] = useState(true);
  const [fleetVehicles, setFleetVehicles] = useState<FleetVehicle[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [planLoading, setPlanLoading] = useState(true);
  const [optimizeWarning, setOptimizeWarning] = useState<OptimizeWarning | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({
    customer: "",
    vehicleId: "",
    address: "",
    serviceMinutes: "20",
    priority: "3",
  });
  const [geocoding, setGeocoding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [routeDirty, setRouteDirty] = useState(false);
  const [pendingAction, setPendingAction] = useState<
    "complete" | "failed" | null
  >(null);
  const [failureReason, setFailureReason] = useState("Klient nieobecny");
  const [stopActionLoading, setStopActionLoading] = useState(false);
  const [changingDeliveries, setChangingDeliveries] = useState(false);

  const ordered = plan?.stops ?? [];
  const currentStop = ordered.find((item) => item.status === "planned");
  const routeStarted = ordered.some((item) => item.status !== "planned");

  async function loadDeliveries() {
    setDeliveriesLoading(true);
    try {
      const response = await fetch("/api/routes/deliveries", {
        headers: authHeaders(),
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        setDeliveries(data.deliveries ?? []);
        setSelected((current) =>
          current.filter((id) =>
            (data.deliveries ?? []).some((item: Delivery) => item.id === id),
          ),
        );
      }
    } finally {
      setDeliveriesLoading(false);
    }
  }

  async function loadPlan() {
    setPlanLoading(true);
    try {
      const response = await fetch("/api/routes/plan", {
        headers: authHeaders(),
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) setPlan(data.plan ?? null);
    } finally {
      setPlanLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount pattern used throughout this codebase
    loadDeliveries();
    loadPlan();
    fetch("/api/fleet/vehicles", { headers: authHeaders(), cache: "no-store" })
      .then((response) => response.json())
      .then((data) => setFleetVehicles(data.vehicles ?? []))
      .catch(() => {});
  }, []);

  async function addDelivery() {
    const customer = addForm.customer.trim();
    const address = addForm.address.trim();
    const serviceMinutes = Number(addForm.serviceMinutes);
    const priority = Number(addForm.priority);
    if (!addForm.vehicleId) {
      setAddError("Wybierz pojazd z floty.");
      return;
    }
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
      const geocodeResponse = await fetch("/api/routes/geocode", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ address }),
      });
      const geocodeData = await geocodeResponse.json();
      if (!geocodeResponse.ok)
        throw new Error(geocodeData.error || "Nie udało się znaleźć adresu.");
      const createResponse = await fetch("/api/routes/deliveries", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          vehicleId: addForm.vehicleId,
          customer,
          address: geocodeData.formattedAddress || address,
          latitude: geocodeData.latitude,
          longitude: geocodeData.longitude,
          serviceMinutes,
          priority: Math.min(5, Math.max(1, priority || 3)),
        }),
      });
      const createData = await createResponse.json().catch(() => ({}));
      if (!createResponse.ok)
        throw new Error(createData.error || "Nie udało się dodać dostawy.");
      await loadDeliveries();
      setSelected((current) => [...current, createData.id]);
      setAddForm({
        customer: "",
        vehicleId: "",
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
    const response = await fetch(`/api/routes/deliveries/${id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(data.error || "Nie udało się usunąć dostawy.");
      return;
    }
    setDeliveries((current) => current.filter((item) => item.id !== id));
    setSelected((current) => current.filter((item) => item !== id));
  }

  function toggle(id: string) {
    setSelected((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  }

  async function persistOrder(stopIds: string[]) {
    if (!plan) return;
    setRouteDirty(true);
    const response = await fetch("/api/routes/plan/reorder", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ planId: plan.id, stopIds }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(data.error || "Nie udało się zapisać nowej kolejności.");
    }
  }

  function move(index: number, direction: -1 | 1) {
    const next = [...ordered];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setPlan((current) => (current ? { ...current, stops: next } : current));
    persistOrder(next.map((item) => item.stopId));
  }

  function postponeCurrent() {
    if (!currentStop) return;
    const next = [
      ...ordered.filter((item) => item.stopId !== currentStop.stopId),
      currentStop,
    ];
    setPlan((current) => (current ? { ...current, stops: next } : current));
    persistOrder(next.map((item) => item.stopId));
  }

  async function confirmStopAction() {
    if (!currentStop || !pendingAction) return;
    setStopActionLoading(true);
    try {
      const status = pendingAction === "complete" ? "delivered" : "failed";
      const notes = pendingAction === "failed" ? failureReason : "";
      const response = await fetch(`/api/routes/plan/stops/${currentStop.stopId}`, {
        method: "PATCH",
        headers: authHeaders(),
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
      setError(
        reason instanceof Error ? reason.message : "Nie udało się zapisać statusu dostawy.",
      );
    } finally {
      setStopActionLoading(false);
    }
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
      const response = await fetch("/api/routes/optimize", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ depot, returnToDepot: true, stops }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Nie udało się ułożyć trasy.");
      if (data.orderedStopIds.length < 2) {
        setError(
          "Za mało dostaw dało się zaplanować — sprawdź adresy i spróbuj ponownie.",
        );
        return;
      }
      const saveResponse = await fetch("/api/routes/plan", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          startAddress: depot.address,
          startLatitude: depot.latitude,
          startLongitude: depot.longitude,
          distanceMeters: data.distanceKm * 1000,
          durationSeconds: data.durationMinutes * 60,
          optimizationSource: data.mode,
          stopOrder: data.orderedStopIds,
        }),
      });
      const saveData = await saveResponse.json().catch(() => ({}));
      if (!saveResponse.ok)
        throw new Error(saveData.error || "Nie udało się zapisać trasy.");
      setPlan(saveData.plan);
      setOptimizeWarning(
        data.warning || data.skippedStopIds?.length
          ? {
              warning: data.warning,
              skippedCustomers: (data.skippedStopIds ?? []).map(
                (id: string) => deliveries.find((item) => item.id === id)?.customer ?? id,
              ),
            }
          : null,
      );
      setRouteDirty(false);
      await loadDeliveries();
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

  async function changeDeliveries() {
    setChangingDeliveries(true);
    try {
      await fetch("/api/routes/plan", { method: "DELETE", headers: authHeaders() });
      setPlan(null);
      setOptimizeWarning(null);
      setRouteDirty(false);
      await loadDeliveries();
    } finally {
      setChangingDeliveries(false);
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
  const remainingStops = ordered.filter((item) => item.status === "planned");
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

  const busy = deliveriesLoading || planLoading;

  return (
    <div
      className={`${styles.planner} ${plan ? styles.plannerWithActions : ""}`}
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
      {busy ? (
        <p className={styles.error} style={{ background: "transparent", color: "#64748b" }}>
          <LoaderCircle className={styles.spin} size={17} />
          Ładowanie planu…
        </p>
      ) : !plan ? (
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
                  Pojazd
                  <select
                    value={addForm.vehicleId}
                    onChange={(event) => {
                      const vehicleId = event.target.value;
                      const vehicle = fleetVehicles.find((item) => item.id === vehicleId);
                      setAddForm((current) => ({
                        ...current,
                        vehicleId,
                        customer:
                          current.customer || (vehicle && vehicle.customer !== "Flota wewnętrzna"
                            ? vehicle.customer
                            : current.customer),
                      }));
                    }}
                  >
                    <option value="">
                      {fleetVehicles.length ? "Wybierz pojazd z floty…" : "Brak pojazdów we flocie"}
                    </option>
                    {fleetVehicles.map((vehicle) => (
                      <option key={vehicle.id} value={vehicle.id}>
                        {vehicle.brand} {vehicle.model} · {vehicle.registration}
                      </option>
                    ))}
                  </select>
                </label>
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
              {!deliveries.length && (
                <p className={styles.error} style={{ background: "transparent", color: "#64748b" }}>
                  Brak dostaw do zaplanowania. Dodaj pierwszą powyżej.
                </p>
              )}
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
                  ? `${ordered.filter((item) => item.status === "delivered").length}/${ordered.length}`
                  : routeDirty
                    ? "—"
                    : `${plan.distanceKm} km`}
              </strong>
              <small>
                {routeStarted
                  ? `${ordered.filter((item) => item.status === "failed").length} nieudane · ${remainingStops.length} pozostałe`
                  : routeDirty
                    ? "Przelicz czas i dystans przed startem"
                    : `około ${Math.floor(plan.durationMinutes / 60)} h ${plan.durationMinutes % 60} min · ${ordered.length} dostawy`}
              </small>
            </div>
            <em>
              {plan.mode === "google" ? "Google Optimization" : "Tryb demonstracyjny"}
            </em>
          </section>
          {optimizeWarning?.warning && (
            <p className={styles.warning}>
              <AlertTriangle size={16} />
              {optimizeWarning.warning}
            </p>
          )}
          {!!optimizeWarning?.skippedCustomers.length && (
            <p className={styles.error}>
              <AlertTriangle size={17} />
              Nie udało się zaplanować: {optimizeWarning.skippedCustomers.join(", ")}.
              Zmień dane przed rozpoczęciem.
            </p>
          )}
          {currentStop && !routeDirty && !optimizeWarning?.skippedCustomers.length && (
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
                Wydano {ordered.filter((item) => item.status === "delivered").length} z{" "}
                {ordered.length} samochodów. Nieudane dostawy:{" "}
                {ordered.filter((item) => item.status === "failed").length}.
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
              const completed = delivery.status === "delivered";
              const failed = delivery.status === "failed";
              const active = currentStop?.stopId === delivery.stopId;
              return (
                <article
                  key={delivery.stopId}
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
            <button onClick={changeDeliveries} disabled={changingDeliveries}>
              {changingDeliveries ? "Zapisuję…" : "Zmień dostawy"}
            </button>
            {routeDirty ? (
              <button className={styles.recalculate} onClick={optimize}>
                <Sparkles size={18} />
                Przelicz trasę
              </button>
            ) : optimizeWarning?.skippedCustomers.length ? (
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
        </>
      )}
    </div>
  );
}
