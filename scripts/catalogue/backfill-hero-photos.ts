/**
 * Give every peak's gallery a good opening picture.
 *
 * A Commons category is ordered by filename, not by quality, so its first
 * image is often a townscape with the mountain somewhere behind it — Mount
 * Whitney's led with a street in Lone Pine. Wikipedia's lead image is a
 * considered editorial choice and is almost always the better opener.
 *
 * We already store that image's URL as `hero_photo_url`, but a bare URL
 * carries no author or licence, and Commons images must not be displayed
 * without attribution. For 577 of 810 peaks the lead image isn't in the
 * category we harvested, so it has no row and can't be shown.
 *
 * This fetches the attribution for exactly those files and writes them as
 * photo rows with sort_order -1, so the gallery opens on them legitimately.
 *
 *   npx tsx scripts/catalogue/backfill-hero-photos.ts [--limit N]
 *
 * Appends to data/catalogue/photos.ndjson. Safe to re-run: existing
 * (peak, url) pairs are skipped.
 */

import { appendFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { getJson, POLITE_MS, sleep } from "./sources.js";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DIR = path.join(ROOT, "data/catalogue");
const PEAKS = path.join(DIR, "peaks.ndjson");
const PHOTOS = path.join(DIR, "photos.ndjson");

const CONCURRENCY = 4;

interface Peak {
  id: string;
  name: string;
  hero_photo_url: string | null;
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

/** The Commons filename inside any of its URL forms. */
function fileKey(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop();
    if (!last) return null;
    return decodeURIComponent(last.replace(/^\d+px-/, ""));
  } catch {
    return null;
  }
}

const plain = (s: string | undefined): string | null =>
  s ? s.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim() || null : null;

interface ImageInfo {
  url?: string;
  thumburl?: string;
  width?: number;
  height?: number;
  extmetadata?: Record<string, { value?: string }>;
}

async function attribution(file: string, slug: string): Promise<Photo | null> {
  const data = await getJson<{
    query?: { pages?: Record<string, { imageinfo?: ImageInfo[]; missing?: string }> };
  }>(
    `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent("File:" + file)}` +
      `&prop=imageinfo&iiprop=url%7Csize%7Cextmetadata&iiurlwidth=1600&format=json&origin=*`
  ).catch(() => null);

  const page = Object.values(data?.query?.pages ?? {})[0];
  const ii = page?.imageinfo?.[0];
  // A lead image uploaded locally to en.wikipedia rather than Commons has no
  // page here. Nothing to attribute, so nothing to show.
  if (!ii?.url || page?.missing !== undefined) return null;

  const url = ii.thumburl || ii.url;
  return {
    peak_slug: slug,
    url,
    thumb_url: url.replace("/1600px-", "/640px-"),
    width: ii.width ?? null,
    height: ii.height ?? null,
    credit: plain(ii.extmetadata?.Artist?.value),
    license: plain(ii.extmetadata?.LicenseShortName?.value),
    // Negative so it sorts ahead of the harvested category images.
    sort_order: -1,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const limit = Number(argv[argv.indexOf("--limit") + 1]) || Infinity;

  const peaks = readFileSync(PEAKS, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Peak);

  const existing = existsSync(PHOTOS)
    ? readFileSync(PHOTOS, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Photo)
    : [];

  const haveFiles = new Map<string, Set<string>>();
  for (const p of existing) {
    const k = fileKey(p.url);
    if (!k) continue;
    const set = haveFiles.get(p.peak_slug) ?? new Set<string>();
    set.add(k.toLowerCase());
    haveFiles.set(p.peak_slug, set);
  }

  const todo = peaks
    .filter((p) => {
      const k = fileKey(p.hero_photo_url);
      return k && !haveFiles.get(p.id)?.has(k.toLowerCase());
    })
    .slice(0, limit === Infinity ? undefined : limit);

  console.log(`\n${todo.length} peaks whose lead image has no attributed row\n`);
  if (!todo.length) return;

  let done = 0,
    added = 0,
    missing = 0;
  let cursor = 0;

  async function worker() {
    for (;;) {
      const i = cursor++;
      if (i >= todo.length) return;
      const peak = todo[i];
      const file = fileKey(peak.hero_photo_url)!;
      try {
        const photo = await attribution(file, peak.id);
        if (photo && (photo.credit || photo.license)) {
          appendFileSync(PHOTOS, JSON.stringify(photo) + "\n");
          added++;
        } else {
          // No attribution available ⇒ not displayable. Leave it out.
          missing++;
        }
      } catch {
        missing++;
      }
      done++;
      if (done % 10 === 0 || done === todo.length) {
        process.stdout.write(`\r  ${done}/${todo.length}  attributed ${added}  skipped ${missing}   `);
      }
      await sleep(POLITE_MS);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(
    `\n\nadded ${added} attributed lead images · ${missing} had none (left out rather than shown unattributed)`
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
