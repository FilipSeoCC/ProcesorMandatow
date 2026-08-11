/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS smoke-test runner */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const sourcePath = path.join(
  process.cwd(),
  "src",
  "lib",
  "authority-detection.ts",
);
const output = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const loaded = { exports: {} };
new Function("exports", "module", "require", output)(
  loaded.exports,
  loaded,
  require,
);
const { detectAuthorityFromOcr } = loaded.exports;

const canard = detectAuthorityFromOcr(`
Centrum Automatycznego Nadzoru nad Ruchem Drogowym
ul. Przykładowa 10
00-001 Warszawa
Sygnatura sprawy: CAN/2026/001
`);
assert.equal(
  canard.name,
  "Centrum Automatycznego Nadzoru nad Ruchem Drogowym",
);
assert.equal(canard.address, "ul. Przykładowa 10, 00-001 Warszawa");
assert.equal(canard.source, "ocr");

const bodySentence = detectAuthorityFromOcr(
  "W związku z ujawnieniem naruszenia przepisów przez urządzenie rejestrujące, wzywamy do odpowiedzi.",
  "W związku z ujawnieniem naruszenia przepisów przez urządzenie rejestrujące, w",
);
assert.equal(bodySentence.name, "");
assert.equal(bodySentence.source, "none");

const municipalGuard = detectAuthorityFromOcr(`
STRAŻ MIEJSKA M.ST. WARSZAWY
ul. Młynarska 43/45
01-170 Warszawa
Adresat:
FlotaFlow Sp. z o.o.
`);
assert.equal(municipalGuard.name, "STRAŻ MIEJSKA M.ST. WARSZAWY");
assert.equal(
  municipalGuard.address,
  "ul. Młynarska 43/45, 01-170 Warszawa",
);

const taxOffice = detectAuthorityFromOcr(`
Naczelnik Pierwszego Urzędu Skarbowego Warszawa-Śródmieście
ul. Lindleya 14
02-013 Warszawa
`);
assert.match(taxOffice.name, /Urzędu Skarbowego/);
assert.equal(taxOffice.address, "ul. Lindleya 14, 02-013 Warszawa");

const gitd = detectAuthorityFromOcr(
  "GŁÓWNY INSPEKTORAT TRANSPORTU DROGOWEGO\nZnak sprawy: ABC/123",
);
assert.equal(gitd.name, "Główny Inspektorat Transportu Drogowego");

console.log("Authority detection: 5 scenarios passed.");
