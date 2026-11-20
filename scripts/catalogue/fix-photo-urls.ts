/**
 * Repair the photo URLs already in the catalogue.
 *
 * Every one of the 5,628 rows had `thumb_url` identical to `url`, so the
 * galleries, the search results and the offline bundle were all pulling
 * 1920px images where a 640px one was meant to go. The derivation that was
 * supposed to shrink them looked for `/1600px-`, which Commons never returns
 * — it snaps thumbnail requests to its own width ladder. Every row also
 * carried a `?utm_source=commons.wikimedia.org` parameter, which splits the
 * CDN cache and buys nothing.
 *
 * Rewriting the file is safe: these are deterministic transforms of a URL,
 * no network involved, and `load-catalogue.ts` upserts on (peak_slug, url),
 * so changed URLs land as new rows.
 *
 *   npx tsx scripts/catalogue/fix-photo-urls.ts [--dry]
 *
 * Note the one consequence worth knowing: because the key includes the URL,
 * the stale 1920px rows stay in the database until they are deleted. The
 * loader reports the count so the difference is visible rather than silent.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { commonsThumb } from "./sources.js";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DIR = path.join(ROOT, "data/catalogue");
const PHOTOS = path.join(DIR, "photos.ndjson");
const PEAKS = path.join(DIR, "peaks.ndjson");

interface Photo {
  url: string;
  thumb_url: string;
  [k: string]: unknown;
}
interface Peak {
  hero_photo_url: string | null;
  [k: string]: unknown;
}

const readNd = <T,>(file: string): T[] =>
  readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as T);

function main() {
  const dry = process.argv.includes("--dry");

  const photos = readNd<Photo>(PHOTOS);
  let urlChanged = 0;
  let thumbChanged = 0;

  // 1280 for the lightbox, 500 for the grid — the two rungs of Commons'
  // ladder that match how the app actually shows a photo.
  const fixedPhotos = photos.map((p) => {
    const url = commonsThumb(p.url, 1280);
    const thumb_url = commonsThumb(p.thumb_url || p.url, 500);
    if (url !== p.url) urlChanged++;
    if (thumb_url !== p.thumb_url) thumbChanged++;
    return { ...p, url, thumb_url };
  });

  const peaks = readNd<Peak>(PEAKS);
  let heroChanged = 0;
  const fixedPeaks = peaks.map((p) => {
    if (!p.hero_photo_url) return p;
    const hero = commonsThumb(p.hero_photo_url, 1280);
    if (hero !== p.hero_photo_url) heroChanged++;
    return { ...p, hero_photo_url: hero };
  });

  const stillSame = fixedPhotos.filter((p) => p.url === p.thumb_url).length;

  console.log(`photos      ${photos.length}`);
  console.log(`  url rewritten    ${urlChanged}`);
  console.log(`  thumb rewritten  ${thumbChanged}`);
  console.log(`  thumb still == url  ${stillSame}`);
  console.log(`heroes rewritten   ${heroChanged}`);
  console.log(`\nbefore  ${photos[0].url}`);
  console.log(`after   ${fixedPhotos[0].url}`);
  console.log(`thumb   ${fixedPhotos[0].thumb_url}`);

  if (dry) {
    console.log("\n--dry: nothing written.");
    return;
  }
  writeFileSync(PHOTOS, fixedPhotos.map((p) => JSON.stringify(p)).join("\n") + "\n");
  writeFileSync(PEAKS, fixedPeaks.map((p) => JSON.stringify(p)).join("\n") + "\n");
  console.log("\nwritten.");
}

main();
