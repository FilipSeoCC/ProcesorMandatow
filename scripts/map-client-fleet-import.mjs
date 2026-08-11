import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const aliases = {
  vehicleId: ["id", "vehicleid", "pojazdid", "idpojazdu", "vin"],
  customerId: ["id", "customerid", "clientid", "klientid", "idklienta", "nip", "pesel"],
  brand: ["marka", "brand", "manufacturer", "producent"],
  model: ["model", "vehiclemodel", "modelpojazdu"],
  registration: ["nrrej", "nrrejestracyjny", "numerrejestracyjny", "registration", "registrationnumber", "plate"],
  customer: ["klient", "customer", "client", "najemca", "nazwa", "nazwafirmy", "imienazwisko"],
  firstName: ["imie", "firstname", "givenname"],
  lastName: ["nazwisko", "lastname", "surname"],
  email: ["email", "mail", "adresmail", "adresemail"],
  taxId: ["nippesel", "nip", "pesel", "taxid"],
  validFrom: ["data", "czas", "dataczas", "dataod", "dataprzekazania", "validfrom", "assignedat", "od", "start"],
  validTo: ["datado", "datazakonczenia", "validto", "do", "koniec", "end"],
};

const usage = `Użycie:
  node scripts/map-client-fleet-import.mjs \\
    --vehicles pojazdy.csv \\
    --customers klienci.csv \\
    --assignments przypisania.csv \\
    [--out import-floty-klienta.csv] [--timezone Europe/Warsaw] [--dry-run]`;

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function parseCsvText(input) {
  const text = input.replace(/^\uFEFF/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const records = [];
  let record = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"' && quoted && text[index + 1] === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      record.push(cell.trim());
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      record.push(cell.trim());
      if (record.some(Boolean)) records.push(record);
      record = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell || record.length) {
    record.push(cell.trim());
    if (record.some(Boolean)) records.push(record);
  }
  if (quoted) throw new Error("Nie zamknięto cudzysłowu w pliku CSV.");
  if (records.length < 2) throw new Error("Plik CSV nie zawiera danych.");
  const headers = records[0].map(normalize);
  return records.slice(1).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])),
  );
}

function value(row, field, required = false) {
  const header = aliases[field].find((candidate) => Object.hasOwn(row, normalize(candidate)));
  const result = header ? String(row[normalize(header)] ?? "").trim() : "";
  if (required && !result) throw new Error(`Brakuje wartości pola „${field}”.`);
  return result;
}

function timeZoneOffsetMinutes(date, timeZone) {
  const offset = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
  })
    .formatToParts(date)
    .find((part) => part.type === "timeZoneName")?.value;
  const match = offset?.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/);
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0);
  return match[1] === "+" ? minutes : -minutes;
}

export function parseClientDate(input, timeZone = "Europe/Warsaw") {
  const raw = String(input ?? "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) {
    const instant = new Date(raw);
    if (Number.isNaN(instant.getTime())) throw new Error(`Nieprawidłowa data: ${raw}`);
    return instant.toISOString();
  }
  const match = raw.match(
    /^(?:(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})|(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}))(?:[ T](\d{1,2}):?(\d{2})?(?::(\d{2}))?)?$/,
  );
  if (!match) throw new Error(`Nieprawidłowy format daty: ${raw}`);
  const year = Number(match[1] ?? match[6]);
  const month = Number(match[2] ?? match[5]);
  const day = Number(match[3] ?? match[4]);
  const hour = Number(match[7] ?? 0);
  const minute = Number(match[8] ?? 0);
  const second = Number(match[9] ?? 0);
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  const guessedDate = new Date(utcGuess);
  if (
    guessedDate.getUTCFullYear() !== year ||
    guessedDate.getUTCMonth() !== month - 1 ||
    guessedDate.getUTCDate() !== day ||
    hour > 23 || minute > 59 || second > 59
  )
    throw new Error(`Nieprawidłowa data: ${raw}`);
  const offset = timeZoneOffsetMinutes(guessedDate, timeZone);
  return new Date(utcGuess - offset * 60_000).toISOString();
}

function indexBy(rows, field, label) {
  const result = new Map();
  for (const row of rows) {
    const id = value(row, field, true);
    if (result.has(id)) throw new Error(`Powielone ID w pliku ${label}: ${id}`);
    result.set(id, row);
  }
  return result;
}

export function buildImportRows({ vehicles, customers, assignments, timeZone = "Europe/Warsaw" }) {
  const vehicleById = indexBy(vehicles, "vehicleId", "pojazdów");
  const customerById = indexBy(customers, "customerId", "klientów");
  const warnings = [];
  const rows = [];
  for (const assignment of assignments) {
    const vehicleId = value(assignment, "vehicleId", true);
    const customerId = value(assignment, "customerId", true);
    const vehicle = vehicleById.get(vehicleId);
    const customer = customerById.get(customerId);
    if (!vehicle || !customer) {
      warnings.push(
        `Pominięto przypisanie ${vehicleId} → ${customerId}: brak ${!vehicle ? "pojazdu" : "klienta"}.`,
      );
      continue;
    }
    const customerName =
      value(customer, "customer") ||
      [value(customer, "firstName"), value(customer, "lastName")].filter(Boolean).join(" ");
    if (!customerName) throw new Error(`Klient ${customerId} nie ma nazwy ani imienia i nazwiska.`);
    rows.push({
      marka: value(vehicle, "brand", true),
      model: value(vehicle, "model", true),
      nr_rej: value(vehicle, "registration", true).toUpperCase().replace(/\s+/g, ""),
      klient: customerName,
      data_czas: parseClientDate(value(assignment, "validFrom", true), timeZone),
      data_do: parseClientDate(value(assignment, "validTo"), timeZone),
      email_klienta: value(customer, "email"),
      nip_pesel: value(customer, "taxId"),
    });
  }
  rows.sort((left, right) =>
    left.nr_rej.localeCompare(right.nr_rej, "pl") ||
    left.data_czas.localeCompare(right.data_czas),
  );
  const seenRegistrationStarts = new Set();
  for (const row of rows) {
    const key = `${row.nr_rej}|${row.data_czas}`;
    if (seenRegistrationStarts.has(key))
      warnings.push(`Powielone przypisanie pojazdu ${row.nr_rej} od ${row.data_czas}.`);
    seenRegistrationStarts.add(key);
  }
  return { rows, warnings };
}

function csvCell(input) {
  const text = String(input ?? "").replace(/\r?\n/g, " ").trim();
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows) {
  const headers = ["marka", "model", "nr_rej", "klient", "data_czas", "data_do", "email_klienta", "nip_pesel"];
  return [headers.join(";"), ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(";"))].join("\n") + "\n";
}

function argumentsFrom(argv) {
  const options = { timeZone: "Europe/Warsaw", out: "import-floty-klienta.csv", dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run") options.dryRun = true;
    else if (["--vehicles", "--customers", "--assignments", "--out", "--timezone"].includes(argument)) {
      const next = argv[index + 1];
      if (!next) throw new Error(`Brakuje wartości po ${argument}.`);
      const key = argument === "--timezone" ? "timeZone" : argument.slice(2);
      options[key] = next;
      index += 1;
    } else throw new Error(`Nieznany argument: ${argument}`);
  }
  for (const required of ["vehicles", "customers", "assignments"])
    if (!options[required]) throw new Error(`Brakuje argumentu --${required}.`);
  return options;
}

export function main(argv = process.argv.slice(2)) {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(usage);
    return { rows: [], warnings: [] };
  }
  const options = argumentsFrom(argv);
  const result = buildImportRows({
    vehicles: parseCsvText(readFileSync(resolve(options.vehicles), "utf8")),
    customers: parseCsvText(readFileSync(resolve(options.customers), "utf8")),
    assignments: parseCsvText(readFileSync(resolve(options.assignments), "utf8")),
    timeZone: options.timeZone,
  });
  for (const warning of result.warnings) console.warn(`OSTRZEŻENIE: ${warning}`);
  if (options.dryRun) {
    console.log(`Gotowych wierszy: ${result.rows.length}`);
    console.log(toCsv(result.rows.slice(0, 5)));
    return result;
  }
  const outputPath = resolve(options.out);
  writeFileSync(outputPath, toCsv(result.rows), "utf8");
  console.log(`Zapisano ${result.rows.length} wierszy do ${outputPath}`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    console.error(`\n${usage}`);
    process.exitCode = 1;
  }
}
