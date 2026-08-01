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
];

const ADDRESS_START =
  /^(?:ul(?:ica)?\.?|al(?:eja|e)?\.?|aleje|pl(?:ac)?\.?|rondo|os(?:iedle)?\.?|skrytka pocztowa)\s+/i;
const POSTAL_CODE = /\b\d{2}-\d{3}\b/;
const SECTION_BOUNDARY =
  /^(?:do|adresat|odbiorca|sygnatura|znak sprawy|numer sprawy|nr sprawy|data|dotyczy)\s*[:：]?/i;
const BODY_NOISE =
  /(?:w związku z|niniejszym|prosimy|zawiadamiamy|ujawnieniem naruszenia|urządzeni[ea] rejestrując|pojazd|wykroczen)/i;

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
    /^(?:nadawca|organ|wystawca|adresat)\s*[:：-]\s*/i,
    "",
  );
  const withoutAddress = withoutLabel
    .split(/\s{2,}|\s+(?=(?:ul\.?|al\.?|aleje|plac|pl\.?|\d{2}-\d{3})\s)/i)[0]
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
