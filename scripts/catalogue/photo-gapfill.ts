/**
 * Find a picture for the peaks that have none.
 *
 * The enrichment pass gets photos from a peak's Wikipedia article and its
 * Commons category. That leaves exactly the peaks it could not match to an
 * article with nothing at all — 105 of them, and not obscure ones: Bird Ridge
 * outside Anchorage, two dozen Japanese peaks, Flattop. They are unmatched
 * because their names are ambiguous or unromanised, not because nobody goes
 * there, so there are plenty of photographs. They just are not reachable by
 * following a link from an article that was never found.
 *
 * Commons geosearch finds them from the other direction: give it the summit
 * coordinate and it returns the files people geotagged near it. No article
 * needed. The risk is the opposite one — a geotagged file near a summit can be
 * a trail sign, a map board, or the view *from* the top with the mountain
 * itself out of frame — so candidates are scored, not taken on trust.
 *
 *   npx tsx scripts/catalogue/photo-gapfill.ts [--limit N] [--dry]
 *
 * Appends to data/catalogue/photos.ndjson and fills hero_photo_url in
 * peaks.ndjson. Safe to re-run: peaks that already have a photo are skipped.
 */

import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { commonsThumb, getJson, haversineM, norm, POLITE_MS, sleep } from "./sources.js";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DIR = path.join(ROOT, "data/catalogue");
const PEAKS = path.join(DIR, "peaks.ndjson");
const PHOTOS = path.join(DIR, "photos.ndjson");

/** Two at a time against Commons. It is a shared service and we are not paying. */
const CONCURRENCY = 2;

/**
 * Search radius. 10 km is the API's maximum, and it is the right number
 * anyway: a mountain is photographed from its approach, not from its summit
 * pixel, so a 1 km radius finds the summit cairn and misses the mountain.
 */
const RADIUS_M = 10_000;

/** Keep a few, so the gallery has something to scroll and one bad pick is diluted. */
const MAX_PER_PEAK = 4;

/**
 * Files to never show. Commons geotags documents as readily as photographs,
 * and a scanned topographic map of the area is a perfectly accurate thing to
 * find 300 m from a summit and a terrible thing to put on a peak page.
 */
const REJECT_TITLE =
  /\b(map|mapa|karte|carte|kaart|plan|diagram|chart|profile|sign|signpost|plaque|marker|logo|seal|coat[\s_-]?of[\s_-]?arms|flag|banner|poster|sticker|ticket|stamp|postcard|scan|sketch|drawing|painting|engraving|lithograph|portrait|grave|monument|memorial|church|chapel|museum|hotel|restaurant|parking|bus|train|station|antenna|mast|tower[\s_-]?detail|webcam|panorama[\s_-]?board|information)\b/i;

/** Extensions that are photographs. SVG is a drawing; TIFF is usually a scan. */
const PHOTO_EXT = /\.(jpe?g|png|webp)$/i;

interface Peak {
  region?: string | null;
  range_name?: string | null;
  country?: string | null;
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  hero_photo_url: string | null;
  [k: string]: unknown;
}

interface Photo {
  peak_slug: string;
  url: string;
  thumb_url: string;
  width: number | null;
  height: number | null;
  credit: string | null;
  license: string | null;
  sort_order: number;
}

interface GeoHit {
  title: string;
  lat: number;
  lon: number;
  dist: number;
}

interface ImageInfo {
  url?: string;
  thumburl?: string;
  width?: number;
  height?: number;
  extmetadata?: Record<string, { value?: string }>;
}

const plain = (s: string | undefined): string | null =>
  s ? s.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim() || null : null;

const readNd = <T,>(file: string): T[] =>
  readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as T);

/** Files geotagged within RADIUS_M of the summit. */
async function geosearch(peak: Peak): Promise<GeoHit[]> {
  const url =
    `https://commons.wikimedia.org/w/api.php?action=query&list=geosearch` +
    `&gscoord=${peak.latitude}%7C${peak.longitude}&gsradius=${RADIUS_M}` +
    `&gsnamespace=6&gslimit=100&gsprop=type%7Cname&format=json&origin=*`;
  const res = await getJson<{ query?: { geosearch?: GeoHit[] } }>(url).catch(() => null);
  return res?.query?.geosearch ?? [];
}

/**
 * Last resort: Commons full-text search by name, ignoring coordinates.
 *
 * Geosearch finds nothing for the handful of peaks remote enough that nobody
 * has uploaded a geotagged photograph near them — Mount Clemenceau in the
 * Columbia Icefield, Mount Wood in the St. Elias. Photographs of them do
 * exist; they simply have no coordinates attached, which is exactly what you
 * would expect of a mountain reached by ski plane rather than by someone with
 * a phone.
 *
 * A matching name is NOT sufficient, which this learned twice over on one
 * peak. Searching "Mount Wood" for the Yukon summit first returned
 * File:Mount Wood.jpg — Mount Wood in California, 3,500 km away, spelled
 * identically. Adding a coordinate check removed that one and promoted
 * File:Mount Wood, BC Canada.jpg, a British Columbia peak 1,200 km south,
 * which passed only because it carries no coordinates at all.
 *
 * So the name has to be corroborated by place, from one of two sources: the
 * file's own coordinates, when it has them, or its categories and
 * description mentioning the peak's region, range or country. A file that
 * offers neither is rejected, even though that leaves the peak with no
 * photograph. A picture of the wrong mountain is not a smaller error than a
 * missing one — it is a larger one, because nothing about the page shows it
 * is wrong.
 */
const NAME_SEARCH_MAX_KM = 50;

async function nameSearch(peak: Peak): Promise<GeoHit[]> {
  const res = await getJson<{ query?: { search?: { title: string }[] } }>(
    `https://commons.wikimedia.org/w/api.php?action=query&list=search` +
      `&srsearch=${encodeURIComponent(peak.name)}&srnamespace=6&srlimit=40&format=json&origin=*`
  ).catch(() => null);

  const name = norm(peak.name);
  if (!name) return [];
  const named = (res?.query?.search ?? []).filter((s) =>
    norm(s.title.replace(/^File:/, "")).includes(name)
  );
  if (!named.length) return [];

  // Coordinates, categories and description in one request — everything
  // needed to decide whether this is the right mountain.
  await sleep(POLITE_MS);
  const meta = await getJson<{
    query?: {
      pages?: Record<
        string,
        {
          title?: string;
          coordinates?: { lat: number; lon: number }[];
          categories?: { title: string }[];
          imageinfo?: { extmetadata?: Record<string, { value?: string }> }[];
        }
      >;
    };
  }>(
    `https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*` +
      `&prop=coordinates%7Ccategories%7Cimageinfo&iiprop=extmetadata&cllimit=max` +
      `&titles=${encodeURIComponent(named.slice(0, 40).map((s) => s.title).join("|"))}`
  ).catch(() => null);

  // The place words that would corroborate this peak, longer than three
  // characters so "USA" or a two-letter region cannot match by accident.
  const places = [peak.region, peak.range_name, peak.country]
    .filter((p): p is string => typeof p === "string" && p.length > 3)
    .map(norm);

  const out: GeoHit[] = [];
  for (const p of Object.values(meta?.query?.pages ?? {})) {
    if (!p.title) continue;

    const at = p.coordinates?.[0];
    if (at) {
      const d = haversineM(peak.latitude, peak.longitude, at.lat, at.lon);
      // It said where it is, and it is somewhere else.
      if (d > NAME_SEARCH_MAX_KM * 1000) continue;
      out.push({ title: p.title, lat: at.lat, lon: at.lon, dist: d });
      continue;
    }

    // No coordinates: look for the peak's region, range or country in the
    // categories and description.
    const text = norm(
      [
        ...(p.categories ?? []).map((c) => c.title),
        p.imageinfo?.[0]?.extmetadata?.ImageDescription?.value ?? "",
      ].join(" ")
    );
    if (!places.length || !places.some((pl) => text.includes(pl))) continue;

    // `dist` feeds the distance term in `score`; nothing is known here, so
    // give it a neutral value rather than inventing a proximity.
    out.push({ title: p.title, lat: peak.latitude, lon: peak.longitude, dist: 5000 });
  }
  return out;
}

/**
 * How much this file looks like a photograph *of this mountain*.
 *
 * Distance is a weak signal on its own — the best shot of a peak is usually
 * taken some way from it — so the name carries most of the weight. A file
 * whose title contains the peak's name was almost certainly uploaded as a
 * picture of that peak, wherever the camera stood.
 */
function score(hit: GeoHit, peak: Peak): number {
  const title = hit.title.replace(/^File:/, "");
  if (!PHOTO_EXT.test(title)) return -1;
  if (REJECT_TITLE.test(title)) return -1;

  let s = 0;
  const t = norm(title);
  const name = norm(peak.name);
  if (name && t.includes(name)) s += 100;
  // Japanese peaks are filed under 山 / 岳 as often as romanised names, and the
  // romanisation we hold rarely matches. The bare distance has to carry those.
  for (const w of name.split(/\s+/).filter((w) => w.length > 3)) {
    if (t.includes(w)) s += 15;
  }
  if (/\b(summit|peak|mountain|mount|ridge|view|from|trail|alpine|valley)\b/i.test(title)) s += 8;
  // Closer is better, but gently: 10 km out is worth about 20 points less
  // than standing on the cairn, not disqualifying.
  s += Math.max(0, 20 - hit.dist / 500);
  return s;
}

/** Attribution and real dimensions for the chosen files, in one request. */
async function imageInfo(titles: string[]): Promise<Map<string, ImageInfo>> {
  if (!titles.length) return new Map();
  const res = await getJson<{
    query?: { pages?: Record<string, { title?: string; imageinfo?: ImageInfo[] }> };
  }>(
    `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(titles.join("|"))}` +
      `&prop=imageinfo&iiprop=url%7Csize%7Cextmetadata&iiurlwidth=1600&format=json&origin=*`
  ).catch(() => null);

  const out = new Map<string, ImageInfo>();
  for (const p of Object.values(res?.query?.pages ?? {})) {
    if (p.title && p.imageinfo?.[0]) out.set(p.title, p.imageinfo[0]);
  }
  return out;
}

async function photosFor(peak: Peak): Promise<Photo[]> {
  let hits = await geosearch(peak);
  if (!hits.length) {
    await sleep(POLITE_MS);
    hits = await nameSearch(peak);
  }
  if (!hits.length) return [];

  const ranked = hits
    .map((h) => ({ h, s: score(h, peak) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s)
    // Ask for more than we need: the landscape filter below rejects some.
    .slice(0, MAX_PER_PEAK * 3);
  if (!ranked.length) return [];

  await sleep(POLITE_MS);
  const info = await imageInfo(ranked.map((r) => r.h.title));

  const out: Photo[] = [];
  for (const { h } of ranked) {
    const ii = info.get(h.title);
    if (!ii?.url) continue;
    // Portrait shots of summit signs and selfies make poor heroes — the same
    // rule the Commons-category path uses.
    if (ii.width && ii.height && ii.width / ii.height < 1.1) continue;
    // A thumbnail this small is a sprite or an icon, not a photograph.
    if (ii.width && ii.width < 800) continue;
    const url = ii.thumburl || ii.url;
    out.push({
      peak_slug: peak.id,
      url: commonsThumb(url, 1280),
      thumb_url: commonsThumb(url, 500),
      width: ii.width ?? null,
      height: ii.height ?? null,
      credit: plain(ii.extmetadata?.Artist?.value),
      license: plain(ii.extmetadata?.LicenseShortName?.value),
      sort_order: out.length,
    });
    if (out.length >= MAX_PER_PEAK) break;
  }
  return out;
}

async function main() {
  const dry = process.argv.includes("--dry");
  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;

  const peaks = readNd<Peak>(PEAKS);
  const existing = readNd<Photo>(PHOTOS);
  const have = new Set(existing.map((p) => p.peak_slug));

  const queue = peaks
    .filter((p) => !have.has(p.id) && p.latitude != null && p.longitude != null)
    .slice(0, limit);

  console.log(
    `${peaks.length} peaks · ${have.size} already have a photo · ${queue.length} to search\n`
  );
  if (!queue.length) {
    console.log("nothing to do.");
    return;
  }

  const found = new Map<string, Photo[]>();
  let done = 0;
  const started = Date.now();

  const worker = async () => {
    for (;;) {
      const peak = queue.shift();
      if (!peak) return;
      try {
        const got = await photosFor(peak);
        if (got.length) found.set(peak.id, got);
      } catch (e) {
        process.stdout.write(`\n  ${peak.id}: ${String(e).slice(0, 80)}\n`);
      }
      done++;
      const rate = (Date.now() - started) / done;
      const eta = Math.round((rate * (queue.length + 1)) / 1000);
      process.stdout.write(
        `\r  ${done} searched · ${found.size} found · eta ${Math.floor(eta / 60)}m${String(eta % 60).padStart(2, "0")}s   `
      );
      await sleep(POLITE_MS);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const rows = [...found.values()].flat();
  console.log(`\n\nfound ${rows.length} photos for ${found.size} peaks`);
  for (const [slug, ps] of [...found].slice(0, 8)) {
    console.log(`  ${slug}: ${decodeURIComponent(ps[0].url.split("/").pop() ?? "").slice(0, 70)}`);
  }

  if (dry) {
    console.log("\n--dry: nothing written.");
    return;
  }
  if (!rows.length) return;

  appendFileSync(PHOTOS, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

  // Give these peaks a hero too, so the page opens on the photograph rather
  // than falling through to the satellite tile.
  let heroes = 0;
  const updated = peaks.map((p) => {
    const got = found.get(p.id);
    if (!got?.length || p.hero_photo_url) return p;
    heroes++;
    return { ...p, hero_photo_url: got[0].url };
  });
  writeFileSync(PEAKS, updated.map((p) => JSON.stringify(p)).join("\n") + "\n");

  console.log(`wrote ${rows.length} photo rows · set ${heroes} hero images`);
  console.log(`coverage now ${have.size + found.size}/${peaks.length}`);
}

main().catch((e) => {
  console.error("\n" + String(e));
  process.exitCode = 1;
});
