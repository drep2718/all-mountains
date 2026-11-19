/**
 * Phase 2 — enrich the 1,032 curated peaks from Wikipedia / Wikidata / Commons.
 *
 * Writes local NDJSON, never the database. Resumable: re-running skips slugs
 * already written, so a network wobble costs you the remaining peaks, not the
 * run. Every enriched field is optional — a peak with no article still ends up
 * in the catalogue with its curated facts intact.
 *
 *   npx tsx scripts/catalogue/enrich-peaks.ts [--limit N] [--fresh] [--only slug,slug]
 *
 * Out:
 *   data/catalogue/peaks.ndjson     one enriched peak per line
 *   data/catalogue/photos.ndjson    one photo per line (peak_slug, url, credit, licence)
 *   data/catalogue/enrich-report.json
 */

import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { createReadStream } from "node:fs";
import path from "node:path";

import {
  NOT_PEAK_TYPES,
  PEAK_TYPES,
  POLITE_MS,
  baseName,
  getJson,
  haversineM,
  HttpError,
  matchScore,
  sleep,
  titleCandidates,
  wikidataFacts,
  wikidataLabel,
  type WikidataFacts,
} from "./sources.js";

const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT_DIR = path.join(ROOT, "data/catalogue");
const PEAKS_OUT = path.join(OUT_DIR, "peaks.ndjson");
const PHOTOS_OUT = path.join(OUT_DIR, "photos.ndjson");
const REPORT_OUT = path.join(OUT_DIR, "enrich-report.json");

const CONCURRENCY = 4;
/** MediaWiki caps gsradius at 10 km and returns HTTP 200 + an error body above it. */
const SEARCH_RADIUS_M = 10_000;
/** Below this the candidate is not plausibly the same mountain. */
const MIN_SCORE = 45;
/**
 * Hard gate. Title matching alone would happily pair our Mount Washington with
 * a same-named hill on another continent; the article's own coordinates settle
 * it. Generous enough for articles pinned to a trailhead or visitor centre.
 */
const MAX_DISTANCE_M = 25_000;
const MAX_PHOTOS = 6;

interface CuratedPeak {
  id: string;
  name: string;
  country: string;
  continent: string;
  region: string;
  elevation_m: number;
  elevation_ft: number;
  latitude: number;
  longitude: number;
  category: string;
  difficulty: string;
}

export interface EnrichedPeak extends CuratedPeak {
  wikipedia_title: string | null;
  wikipedia_url: string | null;
  wikidata_id: string | null;
  summary: string | null;
  hero_photo_url: string | null;
  prominence_m: number | null;
  isolation_km: number | null;
  range_name: string | null;
  commons_category: string | null;
  /** Wikidata's elevation, kept separately so we never silently overwrite the curated value. */
  elevation_wikidata_m: number | null;
  elevation_disagrees: boolean;
  match_score: number | null;
  /** Distance from the curated summit to the matched article's own coordinates. */
  match_distance_m: number | null;
  match_rejected: string | null;
  photo_count: number;
  enriched_at: string;
}

export interface CataloguePhoto {
  peak_slug: string;
  url: string;
  thumb_url: string;
  width: number | null;
  height: number | null;
  credit: string | null;
  license: string | null;
  sort_order: number;
}

// --- Wikipedia ------------------------------------------------------------

interface GeoHit {
  title: string;
  dist: number;
}

async function geosearch(lat: number, lng: number): Promise<GeoHit[]> {
  const data = await getJson<{ query?: { geosearch?: GeoHit[] } }>(
    `https://en.wikipedia.org/w/api.php?action=query&list=geosearch` +
      `&gscoord=${lat}%7C${lng}&gsradius=${SEARCH_RADIUS_M}&gslimit=20&format=json&origin=*`
  );
  return data.query?.geosearch ?? [];
}

/** Title search, for peaks whose article sits outside the geosearch radius. */
async function titleSearch(name: string): Promise<GeoHit[]> {
  const data = await getJson<{ query?: { search?: { title: string }[] } }>(
    `https://en.wikipedia.org/w/api.php?action=query&list=search` +
      `&srsearch=${encodeURIComponent(baseName(name))}&srlimit=5&format=json&origin=*`
  );
  return (data.query?.search ?? []).map((s) => ({ title: s.title, dist: 8000 }));
}

interface Summary {
  title: string;
  extract?: string;
  wikibase_item?: string;
  content_urls?: { desktop?: { page?: string } };
  originalimage?: { source?: string };
  thumbnail?: { source?: string };
  coordinates?: { lat: number; lon: number };
  type?: string;
}

/**
 * A 404 means the article genuinely isn't at that title. Anything else — a
 * rate-limit, a timeout, a 503 — means try again later. Collapsing the two
 * into `null` recorded Mount Shasta as "no article", which is nonsense; the
 * distinction is what makes the retry pass possible.
 */
class Transient extends Error {}

async function summary(title: string): Promise<Summary | null> {
  try {
    return await getJson<Summary>(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`
    );
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return null;
    throw new Transient(String(e).slice(0, 120));
  }
}

// --- Commons --------------------------------------------------------------

interface ImageInfo {
  url?: string;
  thumburl?: string;
  width?: number;
  height?: number;
  extmetadata?: Record<string, { value?: string }>;
}

/** Strip the HTML Commons puts in its attribution fields. */
const plain = (s: string | undefined): string | null =>
  s ? s.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim() || null : null;

async function commonsPhotos(category: string, slug: string): Promise<CataloguePhoto[]> {
  let files: string[] = [];
  try {
    const list = await getJson<{ query?: { categorymembers?: { title: string }[] } }>(
      `https://commons.wikimedia.org/w/api.php?action=query&list=categorymembers` +
        `&cmtitle=${encodeURIComponent("Category:" + category)}&cmtype=file&cmlimit=${MAX_PHOTOS * 3}` +
        `&format=json&origin=*`
    );
    files = (list.query?.categorymembers ?? [])
      .map((m) => m.title)
      .filter((t) => /\.(jpe?g|png|webp)$/i.test(t))
      .slice(0, MAX_PHOTOS * 2);
  } catch {
    return [];
  }
  if (!files.length) return [];

  const info = await getJson<{
    query?: { pages?: Record<string, { title?: string; imageinfo?: ImageInfo[] }> };
  }>(
    `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(files.join("|"))}` +
      `&prop=imageinfo&iiprop=url%7Csize%7Cextmetadata&iiurlwidth=1600&format=json&origin=*`
  ).catch(() => null);

  const pages = Object.values(info?.query?.pages ?? {});
  const out: CataloguePhoto[] = [];
  for (const p of pages) {
    const ii = p.imageinfo?.[0];
    if (!ii?.url) continue;
    // Landscape-ish only; portrait shots of summit signs make poor heroes.
    if (ii.width && ii.height && ii.width / ii.height < 1.1) continue;
    out.push({
      peak_slug: slug,
      url: ii.thumburl || ii.url,
      thumb_url: (ii.thumburl || ii.url).replace("/1600px-", "/640px-"),
      width: ii.width ?? null,
      height: ii.height ?? null,
      credit: plain(ii.extmetadata?.Artist?.value),
      license: plain(ii.extmetadata?.LicenseShortName?.value),
      sort_order: out.length,
    });
    if (out.length >= MAX_PHOTOS) break;
  }
  return out;
}

// --- per-peak pipeline ----------------------------------------------------

type Picked = { sum: Summary; facts: WikidataFacts | null; score: number; distanceM: number | null };

/**
 * Validate one candidate article against the curated peak.
 *
 * Three independent gates, because any one of them alone has a known failure:
 *   name     — "Cascade Range" sits 4 m from Rainier's summit; distance can't tell them apart
 *   distance — "Mount Washington" exists in several countries; the name can't tell them apart
 *   type     — a national park or a list article passes both of the above
 */
async function consider(
  peak: CuratedPeak,
  title: string,
  score: number
): Promise<Picked | { rejected: string }> {
  const sum = await summary(title);
  await sleep(POLITE_MS);
  if (!sum) return { rejected: `${title}: no article` };
  if (sum.type === "disambiguation") return { rejected: `${title}: disambiguation page` };

  let distanceM: number | null = null;
  if (sum.coordinates) {
    distanceM = haversineM(peak.latitude, peak.longitude, sum.coordinates.lat, sum.coordinates.lon);
    if (distanceM > MAX_DISTANCE_M) {
      return { rejected: `${title}: ${(distanceM / 1000) | 0} km away — different mountain` };
    }
  }

  if (!sum.wikibase_item) {
    // No Wikidata entity. Accept only on a strong name match that also passed
    // the coordinate check; otherwise we have nothing to verify against.
    if (score >= 90 && distanceM != null) return { sum, facts: null, score, distanceM };
    return { rejected: `${title}: no wikidata entity` };
  }

  let facts: WikidataFacts | null;
  try {
    facts = await wikidataFacts(sum.wikibase_item);
  } catch (e) {
    throw new Transient(`wikidata ${sum.wikibase_item}: ${String(e).slice(0, 90)}`);
  }
  await sleep(POLITE_MS);
  if (!facts) return { rejected: `${title}: wikidata has no claims` };

  const types = facts.instanceOf;
  if (types.some((t) => NOT_PEAK_TYPES.has(t)) && score < 90) {
    // The type gate exists for the Cascade-Range-at-4-metres case: an article
    // sitting on the summit's coordinates that is not the summit. There the
    // name score is ~0, so the gate fires. But plenty of real climbs are typed
    // as massifs — Mount Hua is "mountain range" because Huashan has five
    // peaks — and for those the name matches exactly. A strong name match means
    // this *is* the article the peak refers to, whatever Wikidata calls it.
    return { rejected: `${title}: is ${types.join("/")}, not a summit` };
  }
  const looksLikePeak =
    types.some((t) => PEAK_TYPES.has(t)) ||
    facts.prominenceM != null ||
    (facts.elevationM != null && distanceM != null && distanceM < 5_000);
  if (!looksLikePeak) {
    return { rejected: `${title}: unrecognised type ${types.join("/") || "(none)"}` };
  }
  return { sum, facts, score, distanceM };
}

async function pickArticle(peak: CuratedPeak): Promise<Picked | { rejected: string }> {
  const tried = new Set<string>();
  /** Kept with their score so the report names the best near-miss, not the first. */
  const reasons: { score: number; why: string }[] = [];

  // 1. Direct title probes. Exact and near-exact titles resolve in one call and
  //    are far more reliable than search — "Mount Hua (South Peak)" finds
  //    "Mount Hua" instantly, where search offered "Mount Hua Sect" (a fictional
  //    martial-arts school that happens to share the name).
  for (const title of titleCandidates(peak.name)) {
    if (tried.has(title.toLowerCase())) continue;
    tried.add(title.toLowerCase());
    const score = matchScore(peak.name, title, 0);
    let r: Awaited<ReturnType<typeof consider>>;
    try { r = await consider(peak, title, score); }
    catch (e) { if (e instanceof Transient) throw e; throw e; }
    if (!("rejected" in r)) return r;
    reasons.push({ score, why: r.rejected });
  }

  // 2. Everything near the summit, ranked by name.
  const hits = await geosearch(peak.latitude, peak.longitude).catch(() => []);
  const ranked = hits
    .map((h) => ({ ...h, score: matchScore(peak.name, h.title, h.dist) }))
    .sort((a, b) => b.score - a.score);
  for (const c of ranked.slice(0, 4)) {
    if (c.score < MIN_SCORE || tried.has(c.title.toLowerCase())) continue;
    tried.add(c.title.toLowerCase());
    const r = await consider(peak, c.title, c.score);
    if (!("rejected" in r)) return r;
    reasons.push({ score: c.score, why: r.rejected });
  }

  // 3. Full-text search, still coordinate-gated.
  const found = await titleSearch(peak.name).catch(() => []);
  for (const h of found.slice(0, 3)) {
    const score = matchScore(peak.name, h.title, 0);
    if (score < MIN_SCORE || tried.has(h.title.toLowerCase())) continue;
    tried.add(h.title.toLowerCase());
    const r = await consider(peak, h.title, score);
    if (!("rejected" in r)) return r;
    reasons.push({ score, why: r.rejected });
  }

  reasons.sort((a, b) => b.score - a.score);
  return { rejected: reasons[0]?.why ?? "no candidate articles" };
}

const rangeCache = new Map<string, string | null>();

async function enrichOne(peak: CuratedPeak): Promise<{ peak: EnrichedPeak; photos: CataloguePhoto[] }> {
  const blank: EnrichedPeak = {
    ...peak,
    wikipedia_title: null,
    wikipedia_url: null,
    wikidata_id: null,
    summary: null,
    hero_photo_url: null,
    prominence_m: null,
    isolation_km: null,
    range_name: null,
    commons_category: null,
    elevation_wikidata_m: null,
    elevation_disagrees: false,
    match_score: null,
    match_distance_m: null,
    match_rejected: null,
    photo_count: 0,
    enriched_at: new Date().toISOString(),
  };

  let picked: Awaited<ReturnType<typeof pickArticle>>;
  try {
    picked = await pickArticle(peak);
  } catch (e) {
    // Marked RETRY so --retry-misses picks it up; a permanent miss is not.
    return { peak: { ...blank, match_rejected: `RETRY ${String(e).slice(0, 140)}` }, photos: [] };
  }
  if ("rejected" in picked) return { peak: { ...blank, match_rejected: picked.rejected }, photos: [] };

  const { sum, facts, score, distanceM } = picked;

  let rangeName: string | null = null;
  if (facts?.rangeQid) {
    if (!rangeCache.has(facts.rangeQid)) {
      rangeCache.set(facts.rangeQid, await wikidataLabel(facts.rangeQid).catch(() => null));
      await sleep(POLITE_MS);
    }
    rangeName = rangeCache.get(facts.rangeQid) ?? null;
  }

  const photos = facts?.commonsCategory
    ? await commonsPhotos(facts.commonsCategory, peak.id).catch(() => [])
    : [];
  if (facts?.commonsCategory) await sleep(POLITE_MS);

  const hero = sum.originalimage?.source ?? photos[0]?.url ?? sum.thumbnail?.source ?? null;

  // Wikidata elevation is recorded, never substituted: the curated value is the
  // one a human chose. A big gap is flagged for review instead.
  const wdElev = facts?.elevationM ?? null;
  const disagrees =
    wdElev != null && Math.abs(wdElev - peak.elevation_m) > Math.max(100, peak.elevation_m * 0.08);

  return {
    peak: {
      ...blank,
      wikipedia_title: sum.title,
      wikipedia_url: sum.content_urls?.desktop?.page ?? null,
      wikidata_id: facts?.qid ?? null,
      summary: sum.extract ?? null,
      hero_photo_url: hero,
      prominence_m: facts?.prominenceM != null ? Math.round(facts.prominenceM) : null,
      isolation_km: facts?.isolationKm ?? null,
      range_name: rangeName,
      commons_category: facts?.commonsCategory ?? null,
      elevation_wikidata_m: wdElev != null ? Math.round(wdElev) : null,
      elevation_disagrees: disagrees,
      match_score: Math.round(score * 10) / 10,
      match_distance_m: distanceM != null ? Math.round(distanceM) : null,
      match_rejected: null,
      photo_count: photos.length,
    },
    photos,
  };
}

// --- resume ---------------------------------------------------------------

async function alreadyDone(file: string): Promise<Set<string>> {
  const done = new Set<string>();
  try {
    await stat(file);
  } catch {
    return done;
  }
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      done.add((JSON.parse(line) as { id: string }).id);
    } catch {
      /* a half-written final line from a killed run — ignore it */
    }
  }
  return done;
}

/**
 * Re-enrich every peak that has no article and rewrite peaks.ndjson/photos.ndjson
 * in place. Runs single-threaded and slowly on purpose: the point is to be
 * gentler than the main pass, not faster.
 */
async function retryPass(curated: CuratedPeak[], limit: number, only: Set<string> | null) {
  const existing = (await readFile(PEAKS_OUT, "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as EnrichedPeak);

  const failed = existing.filter((p) => !p.wikipedia_title && (!only || only.has(p.id))).slice(0, limit === Infinity ? undefined : limit);
  console.log(`retrying ${failed.length} peaks with no article (of ${existing.length})\n`);
  if (!failed.length) return;

  const bySlug = new Map(curated.map((c) => [c.id, c]));
  const fixedPeaks = new Map<string, EnrichedPeak>();
  const fixedPhotos: CataloguePhoto[] = [];
  let recovered = 0;

  for (let i = 0; i < failed.length; i++) {
    const curatedPeak = bySlug.get(failed[i].id);
    if (!curatedPeak) continue;
    try {
      const { peak, photos } = await enrichOne(curatedPeak);
      if (peak.wikipedia_title) {
        recovered++;
        fixedPeaks.set(peak.id, peak);
        fixedPhotos.push(...photos);
      }
    } catch {
      /* still failing — leave the original row alone */
    }
    process.stdout.write(`\r  ${i + 1}/${failed.length}  recovered ${recovered}   `);
    await sleep(600); // deliberately slow
  }

  const merged = existing.map((p) => fixedPeaks.get(p.id) ?? p);
  await writeFile(PEAKS_OUT, merged.map((p) => JSON.stringify(p)).join("\n") + "\n");

  if (fixedPhotos.length) {
    const prior = (await readFile(PHOTOS_OUT, "utf8").catch(() => ""))
      .split("\n").filter(Boolean);
    await writeFile(PHOTOS_OUT, [...prior, ...fixedPhotos.map((p) => JSON.stringify(p))].join("\n") + "\n");
  }

  const matched = merged.filter((p) => p.wikipedia_title).length;
  console.log(
    `\n\nrecovered ${recovered}. now ${matched}/${merged.length} matched (${((100 * matched) / merged.length).toFixed(1)}%)`
  );
}

async function main() {
  const argv = process.argv.slice(2);
  const limit = Number(argv[argv.indexOf("--limit") + 1]) || Infinity;
  const fresh = argv.includes("--fresh");
  const onlyArg = argv.indexOf("--only");
  const only = onlyArg > -1 ? new Set(argv[onlyArg + 1].split(",")) : null;
  /**
   * Re-run only the peaks that failed, rewriting their rows in place.
   * Transient failures (rate limits, timeouts) are the bulk of the misses on a
   * 1,032-peak run at concurrency 4; a quieter second pass recovers most.
   */
  const retryMisses = argv.includes("--retry-misses");

  await mkdir(OUT_DIR, { recursive: true });
  if (fresh) {
    await rm(PEAKS_OUT, { force: true });
    await rm(PHOTOS_OUT, { force: true });
  }

  const curated = JSON.parse(
    await readFile(path.join(ROOT, "data/curated-peaks.json"), "utf8")
  ) as CuratedPeak[];

  if (retryMisses) return retryPass(curated, limit, only);

  const done = await alreadyDone(PEAKS_OUT);
  let queue = curated.filter((p) => !done.has(p.id));
  if (only) queue = queue.filter((p) => only.has(p.id));
  queue = queue.slice(0, limit === Infinity ? undefined : limit);

  console.log(
    `\ncurated ${curated.length} · already enriched ${done.size} · this run ${queue.length}\n`
  );
  if (!queue.length) {
    console.log("nothing to do");
    return;
  }

  const peaksFh = createWriteStream(PEAKS_OUT, { flags: "a" });
  const photosFh = createWriteStream(PHOTOS_OUT, { flags: "a" });

  let ok = 0,
    missed = 0,
    withPhoto = 0,
    processed = 0;
  const misses: { id: string; why: string }[] = [];
  const started = Date.now();

  let cursor = 0;
  async function worker() {
    for (;;) {
      const i = cursor++;
      if (i >= queue.length) return;
      const peak = queue[i];
      try {
        const { peak: enriched, photos } = await enrichOne(peak);
        peaksFh.write(JSON.stringify(enriched) + "\n");
        for (const ph of photos) photosFh.write(JSON.stringify(ph) + "\n");
        if (enriched.wikipedia_title) ok++;
        else {
          missed++;
          misses.push({ id: peak.id, why: enriched.match_rejected ?? "unknown" });
        }
        if (photos.length) withPhoto++;
      } catch (e) {
        missed++;
        misses.push({ id: peak.id, why: String(e).slice(0, 120) });
        peaksFh.write(
          JSON.stringify({
            ...peak,
            match_rejected: String(e).slice(0, 200),
            enriched_at: new Date().toISOString(),
            photo_count: 0,
          }) + "\n"
        );
      }
      processed++;
      if (processed % 10 === 0 || processed === queue.length) {
        const rate = processed / ((Date.now() - started) / 1000);
        const eta = Math.round((queue.length - processed) / Math.max(rate, 0.01));
        process.stdout.write(
          `\r  ${processed}/${queue.length}  matched ${ok}  photos ${withPhoto}  missed ${missed}  eta ${Math.floor(eta / 60)}m${String(eta % 60).padStart(2, "0")}s   `
        );
      }
      await sleep(POLITE_MS);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  peaksFh.end();
  photosFh.end();

  const report = {
    ran_at: new Date().toISOString(),
    processed,
    matched: ok,
    missed,
    with_photo: withPhoto,
    match_rate: +(ok / processed).toFixed(3),
    photo_rate: +(withPhoto / processed).toFixed(3),
    misses: misses.slice(0, 80),
  };
  await writeFile(REPORT_OUT, JSON.stringify(report, null, 2));

  console.log(
    `\n\nmatched ${ok}/${processed} (${(100 * ok) / processed | 0}%) · with photos ${withPhoto} (${(100 * withPhoto) / processed | 0}%) · missed ${missed}`
  );
  if (misses.length) {
    console.log("\nfirst misses:");
    for (const m of misses.slice(0, 12)) console.log(`   ${m.id.padEnd(44)} ${m.why}`);
  }
  console.log(`\nreport → ${path.relative(ROOT, REPORT_OUT)}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
