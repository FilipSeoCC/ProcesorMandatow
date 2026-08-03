#!/usr/bin/env node
// Mapuje 3 przewidywane pliki od klienta (pojazdy / klienci / historia przypisań)
// na jeden CSV w formacie istniejącego importera Floty (marka;model;nr_rej;klient;data_czas).
// Wynikowy plik wgraj przez UI: Flota -> Importuj flotę (ma już podgląd + walidację).
//
// Użycie:
//   node scripts/map-client-fleet-import.mjs <pojazdy.csv> <klienci.csv> <historia.csv> [wynik.csv] [--dry-run]
//
// --dry-run: nie zapisuje pliku, tylko pokazuje podgląd wierszy i ostrzeżenia.
//
// Prawdziwy format kolumn klienta jest nieznany z góry — nazwy poniżej to zgadywane
// warianty PL/EN. Gdy przyjdą realne pliki, dopisz brakujące nazwy kolumn tutaj
// (ALIASES) zamiast zmieniać logikę skryptu.

import { readFileSync, writeFileSync } from "node:fs";

const ALIASES = {
  vehicle: {
    brand: ["marka", "brand", "producent", "manufacturer"],
    model: ["model"],
    registration: ["nrrej", "nrrejestracyjny", "numerrejestracyjny", "rejestracja", "registration", "plate", "vehicleid", "idpojazdu"],
  },
  customer: {
    id: ["id", "idklienta", "customerid", "klientid"],
    name: ["nazwa", "klient", "name", "customer", "firma", "nazwafirmy"],
  },
  assignment: {
    vehicleRef: ["nrrej", "nrrejestracyjny", "numerrejestracyjny", "rejestracja", "registration", "vehicleid", "idpojazdu", "pojazd"],
    customerRef: ["klient", "klientid", "customerid", "idklienta", "customer", "nazwaklienta"],
    validFrom: ["od", "datyod", "validfrom", "dataod", "dataprzekazania", "data", "start"],
  },
};

function normalize(value) {
  return String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeRegistration(value) {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function splitDelimited(line, delimiter) {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"' && quoted) { current += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === delimiter && !quoted) { cells.push(current.trim()); current = ""; }
    else current += char;
  }
  cells.push(current.trim());
  return cells;
}

function parseCsv(path) {
  const text = readFileSync(path, "utf8").replace(/^﻿/, "");
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error(`${path}: plik nie zawiera żadnych wierszy danych.`);
  const delimiter = (lines[0].match(/;/g)?.length ?? 0) >= (lines[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const headers = splitDelimited(lines[0], delimiter).map(normalize);
  const rows = lines.slice(1).map((line) => splitDelimited(line, delimiter));
  return { headers, rows };
}

function columnIndex(headers, aliasList) {
  return headers.findIndex((header) => aliasList.includes(header));
}

function pick(row, index) {
  return index >= 0 ? (row[index] ?? "").trim() : "";
}

function loadVehicles(path) {
  const { headers, rows } = parseCsv(path);
  const indexes = {
    brand: columnIndex(headers, ALIASES.vehicle.brand),
    model: columnIndex(headers, ALIASES.vehicle.model),
    registration: columnIndex(headers, ALIASES.vehicle.registration),
  };
  const missing = Object.entries(indexes).filter(([, index]) => index < 0).map(([field]) => field);
  if (missing.length) throw new Error(`${path}: nie znaleziono kolumn: ${missing.join(", ")}. Dopisz alias w ALIASES.vehicle.`);
  const byRegistration = new Map();
  const warnings = [];
  for (const row of rows) {
    const registration = pick(row, indexes.registration).toUpperCase();
    if (!registration) continue;
    const key = normalizeRegistration(registration);
    if (byRegistration.has(key)) {
      warnings.push(`Zduplikowany nr rejestracyjny "${registration}" w ${path} — użyto ostatniego wystąpienia, sprawdź plik wejściowy.`);
    }
    byRegistration.set(key, { brand: pick(row, indexes.brand), model: pick(row, indexes.model), registration });
  }
  return { byRegistration, warnings };
}

function loadCustomers(path) {
  const { headers, rows } = parseCsv(path);
  const indexes = { id: columnIndex(headers, ALIASES.customer.id), name: columnIndex(headers, ALIASES.customer.name) };
  if (indexes.name < 0) throw new Error(`${path}: nie znaleziono kolumny nazwy klienta. Dopisz alias w ALIASES.customer.name.`);
  const byId = new Map();
  const byName = new Map();
  for (const row of rows) {
    const name = pick(row, indexes.name);
    if (!name) continue;
    if (indexes.id >= 0) byId.set(pick(row, indexes.id), name);
    byName.set(normalize(name), name);
  }
  return { byId, byName };
}

function resolveCustomerName(ref, customers) {
  if (customers.byId.has(ref)) return customers.byId.get(ref);
  const byNormalizedName = customers.byName.get(normalize(ref));
  if (byNormalizedName) return byNormalizedName;
  return ref;
}

function loadAssignments(path) {
  const { headers, rows } = parseCsv(path);
  const indexes = {
    vehicleRef: columnIndex(headers, ALIASES.assignment.vehicleRef),
    customerRef: columnIndex(headers, ALIASES.assignment.customerRef),
    validFrom: columnIndex(headers, ALIASES.assignment.validFrom),
  };
  const missing = Object.entries(indexes).filter(([, index]) => index < 0).map(([field]) => field);
  if (missing.length) throw new Error(`${path}: nie znaleziono kolumn: ${missing.join(", ")}. Dopisz alias w ALIASES.assignment.`);
  return rows
    .map((row) => ({
      vehicleRef: pick(row, indexes.vehicleRef).toUpperCase(),
      customerRef: pick(row, indexes.customerRef),
      validFrom: pick(row, indexes.validFrom),
    }))
    .filter((row) => row.vehicleRef && row.customerRef && row.validFrom);
}

function buildImportRows(vehiclesPath, customersPath, assignmentsPath) {
  const { byRegistration: vehicles, warnings: vehicleWarnings } = loadVehicles(vehiclesPath);
  const customers = loadCustomers(customersPath);
  const assignments = loadAssignments(assignmentsPath);

  const warnings = [...vehicleWarnings];
  const byVehicle = new Map();
  for (const assignment of assignments) {
    const vehicleKey = normalizeRegistration(assignment.vehicleRef);
    const vehicle = vehicles.get(vehicleKey);
    if (!vehicle) { warnings.push(`Historia przypisań wskazuje nieznany pojazd "${assignment.vehicleRef}" — pominięto.`); continue; }
    const date = new Date(assignment.validFrom);
    if (Number.isNaN(date.getTime())) { warnings.push(`Nieprawidłowa data "${assignment.validFrom}" dla pojazdu ${assignment.vehicleRef} — pominięto.`); continue; }
    const customerName = resolveCustomerName(assignment.customerRef, customers);
    const list = byVehicle.get(vehicleKey) ?? [];
    list.push({ ...vehicle, customer: customerName, assignedAt: date.toISOString().slice(0, 16) });
    byVehicle.set(vehicleKey, list);
  }

  for (const [vehicleKey, vehicle] of vehicles) {
    if (!byVehicle.has(vehicleKey)) warnings.push(`Pojazd ${vehicle.registration} nie ma żadnej historii przypisań — nie ujęty w wyniku, dodaj ręcznie jako flotę wewnętrzną jeśli trzeba.`);
  }

  const outputRows = [...byVehicle.values()].flatMap((list) => list.sort((a, b) => a.assignedAt.localeCompare(b.assignedAt)));
  return { outputRows, warnings };
}

function toCsv(rows) {
  const escape = (value) => (value.includes(";") || value.includes('"') ? `"${value.replace(/"/g, '""')}"` : value);
  const header = "marka;model;nr_rej;klient;data_czas";
  const lines = rows.map((row) => [row.brand, row.model, row.registration, row.customer, row.assignedAt].map(escape).join(";"));
  return [header, ...lines].join("\n") + "\n";
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const [vehiclesPath, customersPath, assignmentsPath, outputPath = "import-floty-klienta.csv"] = args.filter((arg) => arg !== "--dry-run");
  if (!vehiclesPath || !customersPath || !assignmentsPath) {
    console.error("Użycie: node scripts/map-client-fleet-import.mjs <pojazdy.csv> <klienci.csv> <historia.csv> [wynik.csv] [--dry-run]");
    process.exit(1);
  }
  const { outputRows, warnings } = buildImportRows(vehiclesPath, customersPath, assignmentsPath);
  if (outputRows.length === 0) {
    console.error("Nie udało się złożyć żadnego wiersza — sprawdź ostrzeżenia poniżej i nazwy kolumn wejściowych.");
    warnings.forEach((warning) => console.error(`  - ${warning}`));
    process.exit(1);
  }

  if (dryRun) {
    console.log(`[dry-run] Złożono ${outputRows.length} wierszy, plik NIE został zapisany. Podgląd:\n`);
    console.log(toCsv(outputRows.slice(0, 10)));
    if (outputRows.length > 10) console.log(`… i ${outputRows.length - 10} kolejnych wierszy.`);
  } else {
    writeFileSync(outputPath, toCsv(outputRows), "utf8");
    console.log(`Zapisano ${outputRows.length} wierszy do ${outputPath}.`);
  }

  if (warnings.length) {
    console.log(`\n${warnings.length} ostrzeżeń (sprawdź przed importem):`);
    warnings.forEach((warning) => console.log(`  - ${warning}`));
  }
  if (!dryRun) console.log(`\nDalej: Flota -> Importuj flotę -> wybierz ${outputPath}, sprawdź podgląd, potwierdź.`);
}

main();
