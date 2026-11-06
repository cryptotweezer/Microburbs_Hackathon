// Pure address normalisation for City of Sydney listings (no network).
// Turns portal-style addresses ("15/2-26 Wattle Cres, Pyrmont NSW 2009") and G-NAF style
// addresses ("Unit 15, 2-26 Wattle Crescent, Pyrmont") into the same comparable key.

/** The 29 City of Sydney suburbs, using the exact SAL names the Microburbs API expects. */
export const CITY_OF_SYDNEY_SALS = [
  "Alexandria", "Barangaroo", "Beaconsfield (NSW)", "Camperdown (NSW)", "Centennial Park (NSW)",
  "Chippendale", "Darlinghurst", "Darlington (Sydney - NSW)", "Dawes Point", "Elizabeth Bay",
  "Erskineville", "Eveleigh", "Forest Lodge", "Glebe (NSW)", "Haymarket", "Millers Point",
  "Moore Park", "Potts Point", "Pyrmont", "Redfern", "Rosebery (NSW)", "Rushcutters Bay",
  "Surry Hills", "Sydney", "The Rocks (Sydney - NSW)", "Ultimo", "Waterloo (NSW)",
  "Woolloomooloo", "Zetland",
] as const;
export type Sal = (typeof CITY_OF_SYDNEY_SALS)[number];

/** Plain suburb name ("glebe") -> SAL name ("Glebe (NSW)"). */
const PLAIN_TO_SAL = new Map<string, Sal>(
  CITY_OF_SYDNEY_SALS.map((sal) => [sal.replace(/\s*\(.*\)$/, "").toLowerCase(), sal]),
);
// Longest names first so "Sydney" does not win over "The Rocks" style suffix checks.
const PLAIN_NAMES = [...PLAIN_TO_SAL.keys()].sort((a, b) => b.length - a.length);

export function toSal(suburb: string): Sal | null {
  const plain = suburb.trim().replace(/\s*\(.*\)$/, "").toLowerCase();
  return PLAIN_TO_SAL.get(plain) ?? null;
}

const STREET_TYPES: Record<string, string> = {
  st: "street", str: "street", rd: "road", ave: "avenue", av: "avenue", pde: "parade",
  hwy: "highway", cres: "crescent", cr: "crescent", cresc: "crescent", dr: "drive", drv: "drive",
  pl: "place", ln: "lane", la: "lane", tce: "terrace", ter: "terrace", ct: "court", cct: "circuit",
  cl: "close", sq: "square", wy: "way", bvd: "boulevard", blvd: "boulevard", bvde: "boulevarde",
  esp: "esplanade", gr: "grove", gdns: "gardens", pkwy: "parkway", prom: "promenade", wk: "walk",
  rw: "row", plz: "plaza", qy: "quay", wf: "wharf", wharf: "wharf",
};

const UNIT_WORDS = "unit|apartment|apt|flat|suite|ste|shop|villa|townhouse|penthouse|ph|studio|lot|u";
const UNIT_PREFIX = new RegExp(`^(?:${UNIT_WORDS})\\.?\\s*([a-z]?\\d+[a-z]?|[a-z]\\d*)(?=[\\s,/]|$)\\s*[,/]?\\s*`, "i");
const LEVEL_PREFIX = /^(?:level|lvl|floor|fl|l)\s*\d+[a-z]?\s*,?\s*/i;
const SLASH_UNIT = /^([a-z]?\d+[a-z]?)\s*\/\s*(.+)$/i;
const STREET_NUMBER = /^(\d+[a-z]?(?:\s*-\s*\d+[a-z]?)?)\s+(.+)$/i;
const WITHHELD = /(address (available )?on request|contact agent|undisclosed|withheld)/i;

export interface ParsedAddress {
  unit: string | null;
  number: string | null;
  street: string | null;
  suburb: Sal | null;
  /** True when the portal hides the street address. */
  withheld: boolean;
}

function clean(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

/** Extracts a City of Sydney suburb from the tail of the address, returning it and the rest. */
function splitSuburb(raw: string, suburbHint?: string | null): { rest: string; suburb: Sal | null } {
  let s = clean(raw)
    .replace(/,?\s*australia$/i, "")
    .replace(/,?\s*\b\d{4}\s*$/, "")
    .replace(/,?\s*\bnsw\b\.?\s*$/i, "")
    .replace(/,?\s*\b\d{4}\s*$/, "")
    .replace(/[,\s]+$/, "");
  // Drop a trailing SAL suffix such as "(NSW)" or "(Sydney - NSW)".
  s = s.replace(/\s*\((?:[a-z -]*nsw)\)\s*$/i, "");

  const lower = s.toLowerCase();
  for (const name of PLAIN_NAMES) {
    if (lower === name || lower.endsWith(" " + name) || lower.endsWith("," + name)) {
      const rest = s.slice(0, s.length - name.length).replace(/[,\s]+$/, "");
      return { rest, suburb: PLAIN_TO_SAL.get(name)! };
    }
  }
  return { rest: s, suburb: suburbHint ? toSal(suburbHint) : null };
}

export function parseAddress(raw: string, suburbHint?: string | null): ParsedAddress {
  const { rest, suburb } = splitSuburb(raw, suburbHint);
  if (WITHHELD.test(raw)) return { unit: null, number: null, street: null, suburb, withheld: true };

  let s = clean(rest.replace(/,/g, ", "));
  let unit: string | null = null;

  s = s.replace(LEVEL_PREFIX, "");
  const u = UNIT_PREFIX.exec(s);
  if (u) {
    unit = u[1]!;
    s = s.slice(u[0].length);
  }
  s = s.replace(LEVEL_PREFIX, "");
  const slash = SLASH_UNIT.exec(s);
  if (slash) {
    unit = unit ?? slash[1]!;
    s = slash[2]!;
  }
  s = s.replace(/^,\s*/, "");

  const n = STREET_NUMBER.exec(s);
  if (!n) return { unit: unit?.toUpperCase() ?? null, number: null, street: null, suburb, withheld: !/\d/.test(s) };

  const words = n[2]!.replace(/[.,]/g, " ").toLowerCase().split(/\s+/).filter(Boolean);
  const last = words.length - 1;
  if (last > 0 && STREET_TYPES[words[last]!]) words[last] = STREET_TYPES[words[last]!]!;

  return {
    unit: unit ? unit.toUpperCase().replace(/^0+(?=\d)/, "") : null,
    number: n[1]!.replace(/\s+/g, "").toUpperCase(),
    street: words.join(" "),
    suburb,
    withheld: false,
  };
}

/** Building-level key: street number + street + suburb. */
export function buildingKey(p: ParsedAddress): string | null {
  if (!p.number || !p.street || !p.suburb) return null;
  return `${p.number}|${p.street}|${p.suburb}`.toLowerCase();
}

/**
 * Canonical unit for matching: portals write "B401" where G-NAF often has "401B" (building B).
 * Both forms map to "401b". The rest of the key (number, street, suburb) still has to match exactly.
 */
export function unitKey(unit: string | null | undefined): string {
  const u = (unit ?? "").toLowerCase();
  const m = /^([a-z]{1,2})(\d+)$/.exec(u);
  return m ? `${m[2]}${m[1]}` : u;
}

/** The other common spelling of a lettered unit ("B401" <-> "401B"), or null. */
export function swappedUnit(unit: string | null | undefined): string | null {
  const u = unit ?? "";
  const a = /^([A-Za-z]{1,2})(\d+)$/.exec(u);
  if (a) return `${a[2]}${a[1]!.toUpperCase()}`;
  const b = /^(\d+)([A-Za-z]{1,2})$/.exec(u);
  return b ? `${b[2]!.toUpperCase()}${b[1]}` : null;
}

/** Unit-level key; equals the building key for addresses without a unit. */
export function addressKey(p: ParsedAddress): string | null {
  const b = buildingKey(p);
  return b ? `${unitKey(p.unit)}|${b}` : null;
}

/**
 * Loose unit key: uses only the first number of a street range ("60-62" -> "60").
 * Portals and G-NAF disagree on ranges; callers must still require a unit and a unique match.
 */
export function looseKey(p: ParsedAddress): string | null {
  if (!p.unit || !p.number || !p.street || !p.suburb) return null;
  return `${unitKey(p.unit)}|${p.number.split("-")[0]}|${p.street}|${p.suburb}`.toLowerCase();
}

/** G-NAF style query string for the geocoder: "Unit 15, 2-26 Wattle Crescent, Pyrmont NSW". */
export function toGnafQuery(p: ParsedAddress): string | null {
  if (!p.number || !p.street || !p.suburb) return null;
  const title = (w: string) => w.replace(/\b[a-z]/g, (c) => c.toUpperCase());
  const suburb = p.suburb.replace(/\s*\(.*\)$/, "");
  return `${p.unit ? `Unit ${p.unit}, ` : ""}${p.number} ${title(p.street)}, ${suburb} NSW`;
}
