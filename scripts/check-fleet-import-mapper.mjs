import assert from "node:assert/strict";
import {
  buildImportRows,
  parseClientDate,
  parseCsvText,
  toCsv,
} from "./map-client-fleet-import.mjs";

assert.equal(parseClientDate("26.07.2026 10:30"), "2026-07-26T08:30:00.000Z");
assert.equal(parseClientDate("2026-12-26 10:30"), "2026-12-26T09:30:00.000Z");
assert.equal(parseClientDate("2026-07-26T10:30:00+02:00"), "2026-07-26T08:30:00.000Z");

const vehicles = parseCsvText(
  "ID;Marka;Model;Numer rejestracyjny\nV1;Ford;Transit;WI 1234A\nV2;Mercedes;Sprinter;WI9876K\n",
);
const customers = parseCsvText(
  'ID;Nazwa firmy;E-mail;NIP\nC1;"Przykładowy; Klient Sp. z o.o.";biuro@example.pl;5210000000\n',
);
const assignments = parseCsvText(
  "Pojazd ID;Klient ID;Data od;Data do\nV1;C1;26.07.2026 10:30;26.07.2027 10:30\nV2;BRAK;2026-08-01 12:00;\n",
);
const result = buildImportRows({ vehicles, customers, assignments });

assert.equal(result.rows.length, 1);
assert.equal(result.warnings.length, 1);
assert.deepEqual(result.rows[0], {
  marka: "Ford",
  model: "Transit",
  nr_rej: "WI1234A",
  klient: "Przykładowy; Klient Sp. z o.o.",
  data_czas: "2026-07-26T08:30:00.000Z",
  data_do: "2027-07-26T08:30:00.000Z",
  email_klienta: "biuro@example.pl",
  nip_pesel: "5210000000",
});
assert.match(toCsv(result.rows), /"Przykładowy; Klient Sp\. z o\.o\."/);

console.log("Mapper importu floty: wszystkie testy zakończone powodzeniem.");
