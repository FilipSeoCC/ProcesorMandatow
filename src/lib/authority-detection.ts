export type DetectedAuthority = {
  name: string;
  address: string;
  confidence: number;
  source: "ocr" | "stored" | "none";
};

type AuthorityRule = {
  pattern: RegExp;
  canonicalName?: string;
  confidence: number;
};

const AUTHORITY_RULES: AuthorityRule[] = [
  {
    pattern: /centrum automatycznego nadzoru nad ruchem drogowym/i,
    canonicalName: "Centrum Automatycznego Nadzoru nad Ruchem Drogowym",
    confidence: 0.99,
  },
  {
    pattern: /główny inspektorat transportu drogowego/i,
    canonicalName: "Główny Inspektorat Transportu Drogowego",
    confidence: 0.99,
  },
  {
    pattern: /\bcanard\b/i,
    canonicalName: "Centrum Automatycznego Nadzoru nad Ruchem Drogowym (CANARD)",
    confidence: 0.96,
  },
  {
    pattern: /(?:wojewódzki|główny)?\s*inspektorat transportu drogowego/i,
    confidence: 0.94,
  },
  {
    pattern: /straż (?:miejska|gminna)/i,
    confidence: 0.94,
  },
  {
    pattern:
      /(?:komenda (?:główna|stołeczna|wojewódzka|powiatowa|miejska|rejonowa) policji|\bpolicja\b)/i,
    confidence: 0.92,
  },
  {
    pattern:
      /(?:naczelnik\s+)?(?:[\p{L}-]+\s+){0,6}(?:urząd skarbowy|urzędu skarbowego)/iu,
    confidence: 0.94,
  },
  {
    pattern: /urząd (?:miasta|gminy|miejski|marszałkowski)/i,
    confidence: 0.9,
  },
  {
    pattern: /(?:zarząd dróg miejskich|miejski zarząd dróg)/i,
    confidence: 0.9,
  },
  // Niemcy — sprawy zza granicy trafiają na polski numer rejestracyjny, ale
  // list piszą niemieckie urzędy, więc potrzebują własnych wzorców nazwy.
  {
    pattern: /zentrale\s+bußgeldstelle|bußgeldstelle|bussgeldstelle/i,
    confidence: 0.94,
  },
  {
    pattern: /landesamt für zentrale polizeiliche dienste/i,
    canonicalName: "Landesamt für Zentrale Polizeiliche Dienste",
    confidence: 0.97,
  },
  {
    pattern: /ordnungsamt/i,
    confidence: 0.9,
  },
  {
    pattern: /polizei(?:präsidium|direktion|inspektion|behörde)/i,
    confidence: 0.92,
  },
  {
    pattern: /regierungspräsidium/i,
    confidence: 0.88,
  },
  // Francja
  {
    pattern:
      /agence nationale de traitement automatisé des infractions|\bantai\b/i,
    canonicalName:
      "Agence Nationale de Traitement Automatisé des Infractions (ANTAI)",
    confidence: 0.97,
  },
  {
    pattern: /officier du ministère public/i,
    confidence: 0.9,
  },
  {
    pattern: /préfecture(?:\s+de police)?/i,
    confidence: 0.88,
  },
  {
    pattern: /centre automatisé de constatation des infractions routières/i,
    confidence: 0.94,
  },
  // Hiszpania
  {
    pattern: /dirección general de tráfico|\bdgt\b/i,
    canonicalName: "Dirección General de Tráfico (DGT)",
    confidence: 0.97,
  },
  {
    pattern: /jefatura (?:provincial|local) de tráfico/i,
    confidence: 0.92,
  },
  {
    pattern: /ayuntamiento de\s+[\p{L}\s-]+/iu,
    confidence: 0.88,
  },
];

// Numer rejestracyjny jest zawsze polski (flota nie ma zagranicznych
// pojazdów), ale nadawcą wezwania bywa zagraniczny urząd — Niemcy/Francja/
// Hiszpania to najczęstsze kraje tranzytowe. Kod pocztowy i słowa-granice
// muszą rozpoznawać też te formaty, inaczej adres i granice sekcji nigdy się
// nie znajdą, nawet jeśli sama nazwa urzędu złapie się na wzorzec wyżej.
const ADDRESS_START =
  /^(?:ul(?:ica)?\.?|al(?:eja|e)?\.?|aleje|pl(?:ac)?\.?|rondo|os(?:iedle)?\.?|skrytka pocztowa|straße|str\.?|platz|allee|weg|rue|avenue|av\.?|boulevard|bd\.?|place|allée|calle|c\/\.?|avenida|avda\.?|plaza|paseo)\s+/i;
// Polska: XX-XXX. Niemcy/Francja/Hiszpania: pięć cyfr bez myślnika.
const POSTAL_CODE = /\b\d{2}-\d{3}\b|\b\d{5}\b/;
// "do"/"an"/"a"/"à" są też zwykłymi, częstymi słowami/przedrostkami (np.
// "Ayuntamiento", "Anlage", "dokument") — bez wymogu dwukropka złapałyby
// prawie każdą linię zaczynającą się na tę literę i przerywałyby szukanie
// adresu za wcześnie. Dwukropek wymagany tylko dla tych krótkich etykiet;
// pełne słowa (adresat, empfänger, destinataire...) same są wystarczająco
// swoiste, dwukropek zostaje opcjonalny jak dotychczas.
const SECTION_BOUNDARY =
  /^(?:adresat|odbiorca|sygnatura|znak sprawy|numer sprawy|nr sprawy|data|dotyczy|empfänger|aktenzeichen|geschäftszeichen|datum|betrifft|betreff|destinataire|référence|objet|concernant|destinatario|referencia|expediente|fecha|asunto)\s*[:：]?|^(?:do|an|a|à)\s*[:：]/i;
const BODY_NOISE =
  /(?:w związku z|niniejszym|prosimy|zawiadamiamy|ujawnieniem naruszenia|urządzeni[ea] rejestrując|pojazd|wykroczen|in verbindung mit|hiermit|bitten|teilen.{0,3}mit|feststellung|messgerät|fahrzeug|verstoß|verkehrsordnungswidrigkeit|en relation avec|par la présente|informons|constatation|infraction|véhicule|appareil|en relación con|por medio de|informamos|constatación|infracción|vehículo|dispositivo)/i;

function cleanLine(value: string) {
  return value
    .replace(/[\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s|:;,_-]+|[\s|:;,_-]+$/g, "")
    .trim();
}

function nameFromLine(line: string, rule: AuthorityRule) {
  if (rule.canonicalName) return rule.canonicalName;
  const withoutLabel = line.replace(
    /^(?:nadawca|organ|wystawca|adresat|absender|behörde|aussteller|expéditeur|autorité|remitente|autoridad)\s*[:：-]\s*/i,
    "",
  );
  const withoutAddress = withoutLabel
    .split(
      /\s{2,}|\s+(?=(?:ul\.?|al\.?|aleje|plac|pl\.?|straße|str\.?|platz|rue|avenue|av\.?|calle|avenida|avda\.?|\d{2}-\d{3}|\d{5})\s)/i,
    )[0]
    .replace(/[,:;\s-]+$/g, "")
    .trim();
  if (
    withoutAddress.length < 4 ||
    withoutAddress.length > 150 ||
    BODY_NOISE.test(withoutAddress)
  )
    return "";
  return withoutAddress;
}

function matchingRule(line: string) {
  return AUTHORITY_RULES.find((rule) => rule.pattern.test(line));
}

export function isPlausibleAuthorityName(value: string | null | undefined) {
  const line = cleanLine(value ?? "");
  if (!line || line.length > 150 || BODY_NOISE.test(line)) return false;
  const rule = matchingRule(line);
  return Boolean(rule && nameFromLine(line, rule));
}

function extractAddress(lines: string[], authorityIndex: number) {
  const from = Math.max(0, authorityIndex - 2);
  const to = Math.min(lines.length - 1, authorityIndex + 8);
  const candidates: Array<{ index: number; line: string }> = [];

  for (let index = from; index <= to; index += 1) {
    if (index === authorityIndex) continue;
    const line = lines[index];
    if (!line) continue;
    if (index > authorityIndex && SECTION_BOUNDARY.test(line)) break;
    candidates.push({ index, line });
  }

  const postal = candidates
    .filter(({ line }) => POSTAL_CODE.test(line))
    .sort(
      (left, right) =>
        Math.abs(left.index - authorityIndex) -
        Math.abs(right.index - authorityIndex),
    )[0];
  if (!postal) return "";

  if (ADDRESS_START.test(postal.line)) return postal.line.slice(0, 300);
  const street = candidates
    .filter(
      ({ index, line }) =>
        ADDRESS_START.test(line) && Math.abs(index - postal.index) <= 3,
    )
    .sort(
      (left, right) =>
        Math.abs(left.index - postal.index) - Math.abs(right.index - postal.index),
    )[0];

  return [street?.line, postal.line].filter(Boolean).join(", ").slice(0, 300);
}

export function detectAuthorityFromOcr(
  rawText: string | null | undefined,
  storedSender?: string | null,
): DetectedAuthority {
  const lines = (rawText ?? "")
    .replace(/\r/g, "")
    .split("\n")
    .map(cleanLine)
    .filter(Boolean)
    .slice(0, 80);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const rule = matchingRule(line);
    if (!rule || BODY_NOISE.test(line)) continue;
    const name = nameFromLine(line, rule);
    if (!name) continue;
    return {
      name,
      address: extractAddress(lines, index),
      confidence: rule.confidence,
      source: "ocr",
    };
  }

  const stored = cleanLine(storedSender ?? "");
  if (isPlausibleAuthorityName(stored)) {
    const rule = matchingRule(stored)!;
    return {
      name: nameFromLine(stored, rule),
      address: "",
      confidence: Math.min(0.82, rule.confidence),
      source: "stored",
    };
  }

  return { name: "", address: "", confidence: 0, source: "none" };
}
