/**
 * Shared plumbing for the catalogue build: polite HTTP, retries, and the
 * name-matching that decides which Wikipedia article is actually *this* peak.
 *
 * Nothing here touches the database. The catalogue is built into local files
 * first, verified, and only then loaded — so a bad enrichment run costs a file,
 * not a production table.
 */

export const UA =
  "AllMountains/1.0 (hiking catalogue build; +https://github.com/drep2718/all-mountains)";

/** Wikimedia asks for <=200 req/s but is happier well below; be a good citizen. */
export const POLITE_MS = 120;

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class HttpError extends Error {
  constructor(readonly status: number, readonly url: string) {
    super(`HTTP ${status} ${url.slice(0, 120)}`);
  }
}

/**
 * GET JSON with retry. Backs off on 429/5xx, gives up on 4xx (a 404 means the
 * article genuinely isn't there, and retrying won't conjure it).
 */
export async function getJson<T = unknown>(
  url: string,
  { tries = 4, timeoutMs = 25_000 }: { tries?: number; timeoutMs?: number } = {}
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < tries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: ctrl.signal,
      });
      if (res.ok) {
        const body = (await res.json()) as T & { error?: { code?: string; info?: string } };
        // MediaWiki answers a bad request with HTTP 200 and an `error` object —
        // the same silent-failure shape as Overpass's `remark`, which once cost
        // us an entire country's import. Treat it as the failure it is.
        if (body && typeof body === "object" && "error" in body && body.error) {
          throw new HttpError(400, `${body.error.code}: ${body.error.info} — ${url.slice(0, 90)}`);
        }
        return body as T;
      }
      // 404/400 are final answers; 429 and 5xx are worth another go.
      if (res.status < 500 && res.status !== 429) throw new HttpError(res.status, url);
      lastErr = new HttpError(res.status, url);
    } catch (e) {
      lastErr = e;
      if (e instanceof HttpError && e.status < 500 && e.status !== 429) throw e;
    } finally {
      clearTimeout(timer);
    }
    await sleep(500 * 2 ** attempt + Math.random() * 250);
  }
  throw lastErr;
}

// --- name matching ---------------------------------------------------------

/** "Mount Adams (Washington)" → "Mount Adams" */
export const baseName = (n: string) => n.replace(/\s*\([^)]*\)\s*$/, "").trim();

/** "Mount Adams (Washington)" → "Washington" */
export const qualifier = (n: string) => n.match(/\(([^)]*)\)\s*$/)?.[1]?.trim() ?? null;

export const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Articles that sit on a summit's coordinates but are not the summit.
 *
 * This matters more than it looks: a plain nearest-article lookup for Mount
 * Rainier returns "Cascade Range" at 4 m, with the real peak 123 m away. Left
 * unchecked, every peak in the catalogue would inherit its mountain range's
 * description and photo.
 */
const NOT_A_PEAK =
  /^(list of|lists of|geography of|history of|climate of|outline of|index of|timeline of)\b/i;
const RELATED_BUT_WRONG =
  /\b(national park|wilderness|recreation area|state park|provincial park|glacier|lake|river|valley|avalanche|eruption|disaster|ski (resort|area)|cable car|railway|tunnel|hut|refuge|observatory|transmitter|massacre|airport)\b/i;

/** Higher is better. Negative means "almost certainly not this peak". */
export function matchScore(peakName: string, title: string, distanceM: number): number {
  const full = norm(peakName);
  const base = norm(baseName(peakName));
  const t = norm(title);
  const qual = qualifier(peakName);

  let s: number;
  if (t === full) s = 100;
  else if (t === base) s = 96;
  else if (qual && t === `${base} ${norm(qual)}`) s = 94;
  else if (t.startsWith(base + " ") || t === base) {
    // "Mount Adams Wilderness" also starts with "mount adams" — charge for the
    // extra words so the plainer title wins.
    const extra = t.slice(base.length).trim().split(" ").filter(Boolean).length;
    s = 86 - 6 * extra;
    if (qual && t.includes(norm(qual))) s += 8;
  } else if (t.includes(base)) s = 62;
  else {
    const want = new Set(base.split(" "));
    const hit = t.split(" ").filter((w) => want.has(w)).length;
    s = (38 * hit) / Math.max(want.size, 1);
  }

  if (NOT_A_PEAK.test(title)) s -= 80;
  if (RELATED_BUT_WRONG.test(title)) s -= 45;
  s -= Math.min(15, distanceM / 600); // mild tiebreak, never decisive

  return s;
}

/** Great-circle distance in metres. */
export function haversineM(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): number {
  const R = 6_371_000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) *
      Math.cos((bLat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * Japanese and Chinese summits are listed in romaji/pinyin ("Takao-san",
 * "Emei Shan") but their English articles are "Mount Takao", "Mount Emei".
 * 178 of the 1,032 peaks are in this group, so the variants are not optional.
 */
const JP_SUFFIX =
  /[-\s](san|zan|yama|dake|take|ga-take|ga-dake|mine|no-mine|jima|shima)$/i;
const CN_SUFFIX = /[-\s](shan|feng|ding)$/i;

export function titleCandidates(name: string): string[] {
  const out: string[] = [];
  const push = (s: string | null | undefined) => {
    const v = s?.trim();
    if (v && !out.some((o) => o.toLowerCase() === v.toLowerCase())) out.push(v);
  };

  push(name);
  const b = baseName(name);
  push(b);

  // "Yari-ga-take" → "Yari";  "Takao-san" → "Takao";  "Emei Shan" → "Emei"
  let stem = b.replace(/[-\s](ga-take|ga-dake|no-mine)$/i, "");
  stem = stem.replace(JP_SUFFIX, "").replace(CN_SUFFIX, "").trim();
  if (stem && stem.toLowerCase() !== b.toLowerCase()) {
    push(`Mount ${stem}`);
    push(stem);
  }

  // "Mount X" ⇄ "X" both directions, plus the "Mt." spelling.
  const noMount = b.replace(/^(mount|mt\.?|monte|mont|pico|pic|piz|cerro)\s+/i, "").trim();
  if (noMount && noMount.toLowerCase() !== b.toLowerCase()) push(noMount);
  if (!/^(mount|mt\.?)\s/i.test(b)) push(`Mount ${b}`);

  // Hyphen/space spelling drift: "Pen-y-ghent" vs "Pen y Ghent".
  if (b.includes("-")) push(b.replace(/-/g, " "));

  return out.slice(0, 6);
}

// --- Wikidata type gate ----------------------------------------------------

/**
 * `instance of` (P31) values that mean "this is a summit".
 * Checked against the matched entity so a range, park or list can never win.
 */
export const PEAK_TYPES = new Set([
  "Q8502", // mountain
  "Q54050", // hill
  "Q207326", // volcano  (also Q169358 stratovolcano etc. below)
  "Q169358", // stratovolcano
  "Q131681", // shield volcano
  "Q1245089", // cinder cone
  "Q35509", // cave? no — kept out
  "Q1437459", // summit / peak
  "Q770546", // massif
  "Q271669", // landform (broad, accepted as last resort)
  "Q150784", // butte
  "Q1210950", // mesa
  "Q190429", // depression? excluded below
  "Q4421", // forest? excluded below
]);
// Trim the ones that slipped into the list above as obvious non-peaks.
for (const bad of ["Q35509", "Q190429", "Q4421"]) PEAK_TYPES.delete(bad);

/** Types that positively disqualify a candidate. */
export const NOT_PEAK_TYPES = new Set([
  "Q46831", // mountain range
  "Q13406463", // Wikimedia list article
  "Q4167410", // disambiguation page
  "Q46169", // ? kept for safety
  "Q22698", // park
  "Q473972", // protected area
  "Q33837", // archipelago
  "Q23397", // lake
  "Q4022", // river
  "Q8514", // desert
  "Q35666", // glacier
]);

export interface WikidataFacts {
  qid: string;
  instanceOf: string[];
  elevationM: number | null;
  prominenceM: number | null;
  isolationKm: number | null;
  rangeQid: string | null;
  commonsCategory: string | null;
  imageFile: string | null;
}

type Claim = { mainsnak?: { datavalue?: { value?: unknown } } };
type Entity = { claims?: Record<string, Claim[]> };

/**
 * Wikidata quantities carry a unit, and mountains are recorded in whichever
 * unit the local editors used. Reading `amount` alone gives you Mount Adams
 * with a prominence of 8,116 — which is feet.
 */
const UNIT_TO_M: Record<string, number> = {
  Q11573: 1, // metre
  Q3710: 0.3048, // foot
  Q828224: 1000, // kilometre
  Q253276: 1609.344, // mile
  Q174789: 0.01, // centimetre
  Q174728: 0.01, // centimetre (alt)
};
const UNIT_TO_KM: Record<string, number> = {
  Q828224: 1, // kilometre
  Q11573: 0.001, // metre
  Q253276: 1.609344, // mile
  Q93318: 1.852, // nautical mile
};

const unitId = (v: unknown): string | null => {
  const u = (v as { unit?: string })?.unit;
  if (typeof u !== "string" || !u.includes("/")) return null;
  return u.split("/").pop() ?? null;
};

/** Quantity → metres, respecting the claim's unit. Unknown unit ⇒ null, not a guess. */
const metres = (v: unknown): number | null => {
  const a = (v as { amount?: string })?.amount;
  if (typeof a !== "string") return null;
  const n = Number(a);
  if (!Number.isFinite(n)) return null;
  const u = unitId(v);
  if (u === null) return n; // unitless claims are metres in practice
  const factor = UNIT_TO_M[u];
  return factor === undefined ? null : n * factor;
};

const kilometres = (v: unknown): number | null => {
  const a = (v as { amount?: string })?.amount;
  if (typeof a !== "string") return null;
  const n = Number(a);
  if (!Number.isFinite(n)) return null;
  const u = unitId(v);
  if (u === null) return n;
  const factor = UNIT_TO_KM[u];
  return factor === undefined ? null : n * factor;
};
const qid = (v: unknown): string | null => (v as { id?: string })?.id ?? null;
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

export async function wikidataFacts(id: string): Promise<WikidataFacts | null> {
  const data = await getJson<{ entities?: Record<string, Entity> }>(
    `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(id)}&props=claims&format=json&origin=*`
  );
  const ent = data.entities?.[id];
  if (!ent?.claims) return null;
  const c = ent.claims;
  const first = (p: string) => c[p]?.[0]?.mainsnak?.datavalue?.value;

  return {
    qid: id,
    instanceOf: (c.P31 ?? [])
      .map((x) => qid(x.mainsnak?.datavalue?.value))
      .filter((x): x is string => !!x),
    // P2044 elevation, P2660 topographic prominence, P2659 topographic isolation
    elevationM: metres(first("P2044")),
    prominenceM: metres(first("P2660")),
    isolationKm: kilometres(first("P2659")),
    rangeQid: qid(first("P4552")),
    commonsCategory: str(first("P373")),
    imageFile: str(first("P18")),
  };
}

/** Resolve a Wikidata QID to its English label (used for range names). */
export async function wikidataLabel(id: string): Promise<string | null> {
  const data = await getJson<{
    entities?: Record<string, { labels?: { en?: { value?: string } } }>;
  }>(
    `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(id)}&props=labels&languages=en&format=json&origin=*`
  );
  return data.entities?.[id]?.labels?.en?.value ?? null;
}
