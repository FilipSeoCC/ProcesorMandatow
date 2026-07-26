"use client";

import { AlertTriangle, ArrowDown, ArrowUp, CarFront, Check, Clock3, ExternalLink, LoaderCircle, MapPin, Navigation, Route, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import styles from "./delivery-planner.module.css";

type Delivery = { id: string; vehicle: string; customer: string; address: string; latitude: number; longitude: number; serviceMinutes: number; priority: number };
type Optimization = { mode: "demo" | "google"; orderedStopIds: string[]; distanceKm: number; durationMinutes: number; skippedStopIds: string[]; warning?: string };
const depot = { address: "Plac floty, Warszawa", latitude: 52.1924, longitude: 20.9358 };
const initialDeliveries: Delivery[] = [
  { id: "DST-104", vehicle: "Toyota Proace · WI 2847K", customer: "Nova Bud Sp. z o.o.", address: "Puławska 427, Warszawa", latitude: 52.1455, longitude: 21.0218, serviceMinutes: 20, priority: 4 },
  { id: "DST-105", vehicle: "Ford Transit · WW 91R2", customer: "Verto Group Sp. z o.o.", address: "Postępu 14, Warszawa", latitude: 52.1798, longitude: 20.9981, serviceMinutes: 25, priority: 3 },
  { id: "DST-106", vehicle: "Mercedes Vito · WX 5520M", customer: "ABC Instalacje", address: "Mickiewicza 22, Łomianki", latitude: 52.3342, longitude: 20.8862, serviceMinutes: 20, priority: 2 },
  { id: "DST-107", vehicle: "Renault Master · WPR 77A9", customer: "M-Projekt", address: "Sienkiewicza 31, Pruszków", latitude: 52.1692, longitude: 20.8026, serviceMinutes: 30, priority: 1 },
];

export default function DeliveryPlanner() {
  const [deliveries] = useState(initialDeliveries);
  const [selected, setSelected] = useState<string[]>(initialDeliveries.map((item) => item.id));
  const [result, setResult] = useState<Optimization | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ordered = useMemo(() => result ? result.orderedStopIds.map((id) => deliveries.find((item) => item.id === id)).filter((item): item is Delivery => Boolean(item)) : deliveries.filter((item) => selected.includes(item.id)), [deliveries, result, selected]);

  function toggle(id: string) { setResult(null); setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]); }
  function move(index: number, direction: -1 | 1) {
    const next = [...ordered]; const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setResult((current) => current ? { ...current, mode: "demo", orderedStopIds: next.map((item) => item.id), warning: "Kolejność zmieniona ręcznie — przelicz trasę przed startem." } : current);
  }
  async function optimize() {
    const stops = deliveries.filter((item) => selected.includes(item.id));
    if (stops.length < 2) { setError("Wybierz przynajmniej dwie dostawy."); return; }
    setLoading(true); setError(null);
    try {
      const response = await fetch("/api/routes/optimize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ depot, returnToDepot: true, stops }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Nie udało się ułożyć trasy.");
      setResult(data);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Nie udało się ułożyć trasy."); } finally { setLoading(false); }
  }
  const mapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(depot.address)}&destination=${encodeURIComponent(depot.address)}&waypoints=${ordered.map((item) => encodeURIComponent(item.address)).join("%7C")}&travelmode=driving`;

  return <div className={styles.planner}>
    <section className={styles.hero}><span>Plan dnia · Wadim</span><h1>Dostawy samochodów</h1><p>Wybierz auta z placu, a system ułoży możliwie krótką kolejność dostaw.</p><div><span><CarFront size={18} /><b>{selected.length}</b><small>wybrane auta</small></span><span><MapPin size={18} /><b>{deliveries.length}</b><small>punkty dzisiaj</small></span></div></section>
    {!result ? <>
      <section className={styles.depot}><span><MapPin size={19} /></span><div><small>START I POWRÓT</small><strong>{depot.address}</strong></div></section>
      <section className={styles.section}><header><div><h2>Auta do wydania</h2><p>Zaznacz dzisiejsze dostawy</p></div><span>{selected.length}/{deliveries.length}</span></header><div className={styles.deliveryList}>{deliveries.map((delivery) => <button key={delivery.id} className={`${styles.delivery} ${selected.includes(delivery.id) ? styles.selected : ""}`} onClick={() => toggle(delivery.id)}><span className={styles.checkbox}>{selected.includes(delivery.id) && <Check size={15} />}</span><span className={styles.deliveryBody}><strong>{delivery.vehicle}</strong><b>{delivery.customer}</b><small><MapPin size={13} />{delivery.address}</small></span><span className={styles.duration}><Clock3 size={13} />{delivery.serviceMinutes} min</span></button>)}</div></section>
      {error && <p className={styles.error}><AlertTriangle size={17} />{error}</p>}
      <button className={styles.optimize} onClick={optimize} disabled={loading || selected.length < 2}>{loading ? <LoaderCircle className={styles.spin} size={21} /> : <Sparkles size={21} />}{loading ? "Układam najlepszą trasę…" : "Zoptymalizuj trasę"}</button>
    </> : <>
      <section className={styles.summary}><div><span><Route size={18} />Trasa gotowa</span><strong>{result.distanceKm} km</strong><small>około {Math.floor(result.durationMinutes / 60)} h {result.durationMinutes % 60} min · {ordered.length} dostawy</small></div><em>{result.mode === "google" ? "Google Optimization" : "Tryb demonstracyjny"}</em></section>
      {result.warning && <p className={styles.warning}><AlertTriangle size={16} />{result.warning}</p>}
      <section className={styles.routeList}><div className={styles.routePoint}><span>START</span><div><strong>{depot.address}</strong><small>Plac floty</small></div></div>{ordered.map((delivery, index) => <article key={delivery.id}><span className={styles.stopNo}>{index + 1}</span><div><strong>{delivery.customer}</strong><b>{delivery.vehicle}</b><small>{delivery.address} · {delivery.serviceMinutes} min</small></div><span className={styles.moveButtons}><button onClick={() => move(index, -1)} disabled={index === 0} aria-label="Przenieś wyżej"><ArrowUp size={17} /></button><button onClick={() => move(index, 1)} disabled={index === ordered.length - 1} aria-label="Przenieś niżej"><ArrowDown size={17} /></button></span></article>)}<div className={styles.routePoint}><span>KONIEC</span><div><strong>{depot.address}</strong><small>Powrót na plac</small></div></div></section>
      <div className={styles.actions}><button onClick={() => setResult(null)}>Zmień dostawy</button><a href={mapsUrl} target="_blank" rel="noopener noreferrer"><Navigation size={19} />Rozpocznij<ExternalLink size={15} /></a></div>
    </>}
  </div>;
}
