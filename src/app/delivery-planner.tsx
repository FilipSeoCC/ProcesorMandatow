"use client";

import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CarFront,
  Check,
  CheckCircle2,
  Clock3,
  ExternalLink,
  History,
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
  windowStart: string | null;
  windowEnd: string | null;
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
  windowStart: string | null;
  windowEnd: string | null;
};
type Plan = {
  id: string;
  startAddress: string;
  mode: string;
  distanceKm: number;
  durationMinutes: number;
  stops: PlanStop[];
};
type TeamMember = { userId: string; role: string; status: string; email: string | null; name: string | null };
type OptimizeWarning = { skippedCustomers: string[]; warning?: string };
type FleetVehicle = {
  id: string;
  brand: string;
  model: string;
  registration: string;
  customer: string;
};
type HistoryPlanSummary = {
  id: string;
  plannedFor: string;
  status: string;
  mode: string;
  dispatcherId: string | null;
  assignedUserId: string | null;
  createdAt: string;
  distanceKm: number;
  durationMinutes: number;
  totalStops: number;
  deliveredCount: number;
  failedCount: number;
};
type PlanDetail = {
  id: string;
  mode: string;
  distanceKm: number;
  durationMinutes: number;
  stops: Array<{
    stopId: string;
    vehicle: string;
    customer: string;
    address: string;
    status: string;
    notes: string;
  }>;
};
const depot = {
  address: "Aleje Jerozolimskie 228, 02-495 Warszawa",
  latitude: 52.18798,
  longitude: 20.91054,
};

// Deliveries are always "for today," so the add-delivery form only asks for
// a time of day — combine it with today's date to get the full timestamp
// window_start/window_end actually need.
function todayAt(time: string) {
  if (!time) return undefined;
  return new Date(`${new Date().toISOString().slice(0, 10)}T${time}:00`).toISOString();
}

function formatWindow(windowStart: string | null, windowEnd: string | null) {
  if (!windowStart && !windowEnd) return null;
  const time = (value: string) =>
    new Date(value).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
  if (windowStart && windowEnd) return `${time(windowStart)}–${time(windowEnd)}`;
  return time(windowStart || windowEnd!);
}

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

export default function DeliveryPlanner({
  employeeLabel,
  currentUserName,
  currentUserId,
  team = [],
}: {
  employeeLabel?: (userId?: string | null) => string;
  currentUserName?: string;
  currentUserId?: string | null;
  team?: TeamMember[];
}) {
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
    windowStart: "",
    windowEnd: "",
  });
  // Every employee now gets their own route for the day — this is "whose
  // route today," defaulting to the person using the planner. Only shown as
  // a picker once there's actually more than one active team member.
  const [assignedUserId, setAssignedUserId] = useState(currentUserId ?? "");
  const activeTeam = team.filter((member) => member.status === "active");
  const [geocoding, setGeocoding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [uncertainGeocode, setUncertainGeocode] = useState<{
    latitude: number;
    longitude: number;
    formattedAddress: string;
  } | null>(null);
  const [routeDirty, setRouteDirty] = useState(false);
  const [pendingAction, setPendingAction] = useState<
    "complete" | "failed" | null
  >(null);
  const [failureReason, setFailureReason] = useState("Klient nieobecny");
  const [stopActionLoading, setStopActionLoading] = useState(false);
  const [changingDeliveries, setChangingDeliveries] = useState(false);
  const [screen, setScreen] = useState<"plan" | "history" | "historyDetail">("plan");
  const [historyPlans, setHistoryPlans] = useState<HistoryPlanSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyDetail, setHistoryDetail] = useState<PlanDetail | null>(null);
  const [historyDetailLoading, setHistoryDetailLoading] = useState(false);

  const ordered = plan?.stops ?? [];
  const currentStop = ordered.find((item) => item.status === "planned");
  const routeStarted = ordered.some((item) => item.status !== "planned");

  // Returns the fresh list on success so callers that need to verify a
  // specific id landed (addDelivery) don't have to re-read stale state.
  async function loadDeliveries(): Promise<Delivery[] | null> {
    setDeliveriesLoading(true);
    try {
      const response = await fetch("/api/routes/deliveries", {
        headers: authHeaders(),
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        // Previously silent on failure — the list stayed stale with no
        // indication anything was wrong, which is how "3 wybrane auta" with
        // an empty, un-refreshed list underneath became possible.
        setError(data.error || "Nie udało się odświeżyć listy dostaw.");
        return null;
      }
      const fresh: Delivery[] = data.deliveries ?? [];
      setDeliveries(fresh);
      setSelected((current) => current.filter((id) => fresh.some((item) => item.id === id)));
      return fresh;
    } finally {
      setDeliveriesLoading(false);
    }
  }

  async function loadPlan(forUserId?: string) {
    setPlanLoading(true);
    try {
      const query = forUserId ? `?userId=${encodeURIComponent(forUserId)}` : "";
      const response = await fetch(`/api/routes/plan${query}`, {
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
    fetch("/api/fleet/vehicles", { headers: authHeaders(), cache: "no-store" })
      .then((response) => response.json())
      .then((data) => setFleetVehicles(data.vehicles ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    // currentUserId often resolves after this component mounts (parent's own
    // account fetch) — pick it up as the default assignee without clobbering
    // a dispatcher's already-made manual selection.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing a default from a prop that resolves after mount, same pattern as elsewhere in this file
    if (currentUserId) setAssignedUserId((current) => current || currentUserId);
  }, [currentUserId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reload the right employee's route whenever the selection changes
    loadPlan(assignedUserId || undefined);
  }, [assignedUserId]);

  async function loadHistory() {
    setHistoryLoading(true);
    try {
      const response = await fetch("/api/routes/plan/history", {
        headers: authHeaders(),
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) setHistoryPlans(data.plans ?? []);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function openHistoryDetail(id: string) {
    setScreen("historyDetail");
    setHistoryDetailLoading(true);
    try {
      const response = await fetch(`/api/routes/plan/history/${id}`, {
        headers: authHeaders(),
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) setHistoryDetail(data.plan ?? null);
    } finally {
      setHistoryDetailLoading(false);
    }
  }

  function openHistory() {
    setScreen("history");
    if (!historyPlans.length) loadHistory();
  }

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
    if (addForm.windowStart && addForm.windowEnd && addForm.windowStart > addForm.windowEnd) {
      setAddError("Okno czasowe „od” musi być wcześniejsze niż „do”.");
      return;
    }
    setGeocoding(true);
    setAddError(null);
    try {
      // A confirmed uncertain match skips re-geocoding and uses the address
      // the user already approved in the confirmation step below.
      let resolved = uncertainGeocode;
      if (!resolved) {
        const geocodeResponse = await fetch("/api/routes/geocode", {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ address }),
        });
        const geocodeData = await geocodeResponse.json();
        if (!geocodeResponse.ok)
          throw new Error(geocodeData.error || "Nie udało się znaleźć adresu.");
        // Google returns status "OK" even for a typo'd address if it can
        // guess what you meant — partialMatch is the only signal that
        // happened. Stop here and make the user look at what it actually
        // resolved to before planning a route around it.
        if (geocodeData.partialMatch) {
          setUncertainGeocode({
            latitude: geocodeData.latitude,
            longitude: geocodeData.longitude,
            formattedAddress: geocodeData.formattedAddress,
          });
          return;
        }
        resolved = {
          latitude: geocodeData.latitude,
          longitude: geocodeData.longitude,
          formattedAddress: geocodeData.formattedAddress || address,
        };
      }
      const createResponse = await fetch("/api/routes/deliveries", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          vehicleId: addForm.vehicleId,
          customer,
          address: resolved.formattedAddress,
          latitude: resolved.latitude,
          longitude: resolved.longitude,
          serviceMinutes,
          priority: Math.min(5, Math.max(1, priority || 3)),
          windowStart: todayAt(addForm.windowStart),
          windowEnd: todayAt(addForm.windowEnd),
        }),
      });
      const createData = await createResponse.json().catch(() => ({}));
      if (!createResponse.ok)
        throw new Error(createData.error || "Nie udało się dodać dostawy.");
      const fresh = await loadDeliveries();
      // The refreshed list is the source of truth for what actually exists —
      // trusting the create response alone let selected end up pointing at a
      // delivery that, for whatever reason, wasn't actually there to select.
      if (!fresh?.some((item) => item.id === createData.id)) {
        setAddError(
          "Dostawa została zapisana, ale nie pojawiła się na liście — odśwież stronę i sprawdź, zanim zaplanujesz trasę.",
        );
        return;
      }
      setSelected((current) => [...current, createData.id]);
      setUncertainGeocode(null);
      setAddForm({
        customer: "",
        vehicleId: "",
        address: "",
        serviceMinutes: "20",
        priority: "3",
        windowStart: "",
        windowEnd: "",
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
    const delivery = deliveries.find((item) => item.id === id);
    if (
      !window.confirm(
        `Usunąć dostawę dla ${delivery?.customer ?? "tego klienta"}? Tej operacji nie można cofnąć.`,
      )
    )
      return;
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
      const assigneeLabel =
        assignedUserId && assignedUserId !== currentUserId
          ? employeeLabel?.(assignedUserId)
          : currentUserName;
      const response = await fetch("/api/routes/optimize", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ depot, returnToDepot: true, stops, employeeLabel: assigneeLabel }),
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
          assignedUserId: assignedUserId || undefined,
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
      const query = assignedUserId ? `?userId=${encodeURIComponent(assignedUserId)}` : "";
      await fetch(`/api/routes/plan${query}`, { method: "DELETE", headers: authHeaders() });
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
        <span>Plan dnia{currentUserName ? ` · ${currentUserName}` : ""}</span>
        <h1>Dostawy samochodów</h1>
        <p>
          Wybierz auta z placu, a system ułoży możliwie krótką kolejność dostaw.
        </p>
        {activeTeam.length > 1 && (
          <label className={styles.assigneePicker}>
            Trasa dla
            <select
              value={assignedUserId}
              onChange={(event) => setAssignedUserId(event.target.value)}
            >
              {activeTeam.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {(member.name || member.email || "Nieznany") +
                    (member.userId === currentUserId ? " (Ja)" : "")}
                </option>
              ))}
            </select>
          </label>
        )}
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
        {screen === "plan" && (
          <button type="button" className={styles.historyLink} onClick={openHistory}>
            <History size={15} />
            Historia tras
          </button>
        )}
      </section>
      {screen === "history" ? (
        <>
          <button
            type="button"
            className={styles.historyBack}
            onClick={() => setScreen("plan")}
          >
            <ArrowLeft size={15} />
            Wróć do dzisiejszej trasy
          </button>
          {historyLoading ? (
            <p className={styles.loading}>
              <LoaderCircle className={styles.spin} size={17} />
              Ładowanie historii…
            </p>
          ) : !historyPlans.length ? (
            <p className={styles.emptyState}>Brak zapisanych tras z poprzednich dni.</p>
          ) : (
            <div className={styles.historyList}>
              {historyPlans.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={styles.historyCard}
                  onClick={() => openHistoryDetail(item.id)}
                >
                  <div>
                    <strong>
                      {new Date(item.plannedFor).toLocaleDateString("pl-PL", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                      })}
                    </strong>
                    <small>
                      Kierowca: {employeeLabel ? employeeLabel(item.assignedUserId) : "—"} ·{" "}
                      {item.distanceKm} km · {Math.floor(item.durationMinutes / 60)} h{" "}
                      {item.durationMinutes % 60} min
                    </small>
                  </div>
                  <span className={styles.historyStats}>
                    <b>{item.deliveredCount} wydane</b>
                    {item.failedCount > 0 && <i>{item.failedCount} nieudane</i>}
                    <span>/ {item.totalStops}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </>
      ) : screen === "historyDetail" ? (
        <>
          <button
            type="button"
            className={styles.historyBack}
            onClick={() => {
              setScreen("history");
              setHistoryDetail(null);
            }}
          >
            <ArrowLeft size={15} />
            Wróć do historii
          </button>
          {historyDetailLoading || !historyDetail ? (
            <p className={styles.loading}>
              <LoaderCircle className={styles.spin} size={17} />
              Ładowanie trasy…
            </p>
          ) : (
            <>
              <div className={styles.historyDetailHeader}>
                <strong>
                  {historyDetail.distanceKm} km · {Math.floor(historyDetail.durationMinutes / 60)} h{" "}
                  {historyDetail.durationMinutes % 60} min
                </strong>
                <span>
                  {historyDetail.mode === "google" ? "Google Optimization" : "Tryb demonstracyjny"}{" "}
                  · {historyDetail.stops.length} dostaw
                </span>
              </div>
              <section className={styles.routeList}>
                {historyDetail.stops.map((stop, index) => {
                  const completed = stop.status === "delivered";
                  const failed = stop.status === "failed";
                  return (
                    <article
                      key={stop.stopId}
                      className={`${completed ? styles.completedStop : ""} ${failed ? styles.failedStop : ""}`}
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
                        <strong>{stop.customer}</strong>
                        <b>{stop.vehicle}</b>
                        <small>
                          {stop.address} ·{" "}
                          {completed ? "wydano" : failed ? "nie dostarczono" : "zaplanowano"}
                        </small>
                        {failed && stop.notes && (
                          <small className={styles.historyStopNotes}>Powód: {stop.notes}</small>
                        )}
                      </div>
                    </article>
                  );
                })}
              </section>
            </>
          )}
        </>
      ) : busy ? (
        <p className={styles.loading}>
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
                  setUncertainGeocode(null);
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
                    disabled={!fleetVehicles.length}
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
                {!fleetVehicles.length && (
                  <p className={styles.addStopFormHint}>
                    Brak pojazdów we flocie — dodaj przynajmniej jeden w zakładce „Flota&rdquo;,
                    zanim zaplanujesz dostawę.
                  </p>
                )}
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
                    onChange={(event) => {
                      // Editing the address invalidates any pending
                      // "is this really what you meant?" confirmation — don't
                      // let a stale approved address survive an edit.
                      setUncertainGeocode(null);
                      setAddForm((current) => ({
                        ...current,
                        address: event.target.value,
                      }));
                    }}
                    placeholder="Ulica, numer, miasto"
                  />
                </label>
                {uncertainGeocode && (
                  <p className={styles.addStopFormHint}>
                    Google nie jest pewne tego adresu. Najbliższe dopasowanie:{" "}
                    <strong>{uncertainGeocode.formattedAddress}</strong>. Sprawdź, czy to
                    właściwe miejsce, zanim dodasz dostawę — kliknij przycisk poniżej ponownie,
                    żeby je zatwierdzić, albo popraw adres powyżej.
                  </p>
                )}
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
                <div className={styles.addStopRow}>
                  <label>
                    Okno czasowe od
                    <input
                      type="time"
                      value={addForm.windowStart}
                      onChange={(event) =>
                        setAddForm((current) => ({
                          ...current,
                          windowStart: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Okno czasowe do
                    <input
                      type="time"
                      value={addForm.windowEnd}
                      onChange={(event) =>
                        setAddForm((current) => ({
                          ...current,
                          windowEnd: event.target.value,
                        }))
                      }
                    />
                  </label>
                </div>
                {addError && <p className={styles.error}>{addError}</p>}
                <button
                  type="button"
                  className={styles.addStopSubmit}
                  disabled={geocoding || !fleetVehicles.length}
                  onClick={addDelivery}
                >
                  {geocoding ? (
                    <LoaderCircle className={styles.spin} size={17} />
                  ) : (
                    <Plus size={17} />
                  )}
                  {geocoding
                    ? "Wyszukuję adres…"
                    : uncertainGeocode
                      ? "Potwierdź adres i dodaj"
                      : "Dodaj do listy"}
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
                      {formatWindow(delivery.windowStart, delivery.windowEnd) && (
                        <small>
                          <Clock3 size={13} />
                          {formatWindow(delivery.windowStart, delivery.windowEnd)}
                        </small>
                      )}
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
                <p className={styles.emptyState}>Brak dostaw do zaplanowania. Dodaj pierwszą powyżej.</p>
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
                      {delivery.address}
                      {formatWindow(delivery.windowStart, delivery.windowEnd)
                        ? ` · ${formatWindow(delivery.windowStart, delivery.windowEnd)}`
                        : ""}{" "}
                      ·{" "}
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
