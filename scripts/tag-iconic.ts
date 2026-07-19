/**
 * Tag the ~100 iconic summits across US / Canada / Switzerland / Japan.
 *
 * Matches each curated peak to the NEAREST peak in the DB within 5 km (by
 * location, so kanji-named Japanese peaks still match) and sets is_iconic=true.
 *
 * Prereq — run once in the Supabase SQL Editor:
 *   ALTER TABLE peaks ADD COLUMN IF NOT EXISTS is_iconic BOOLEAN DEFAULT FALSE;
 *   CREATE INDEX IF NOT EXISTS peaks_iconic_idx ON peaks (is_iconic) WHERE is_iconic;
 *
 * Usage: npx tsx --env-file=.env.local scripts/tag-iconic.ts
 */

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

// [name, lat, lng]
const ICONIC: [string, number, number][] = [
  // ── United States (40) ──
  ["Mount Whitney", 36.5786, -118.2920], ["Mount Rainier", 46.8523, -121.7603],
  ["Mount Shasta", 41.4092, -122.1949], ["Mount Hood", 45.3736, -121.6960],
  ["Grand Teton", 43.7412, -110.8025], ["Longs Peak", 40.2549, -105.6151],
  ["Pikes Peak", 38.8405, -105.0442], ["Mount Elbert", 39.1178, -106.4453],
  ["Half Dome", 37.7460, -119.5330], ["El Capitan", 37.7340, -119.6377],
  ["Mount Washington", 44.2705, -71.3033], ["Mount Katahdin", 45.9044, -68.9216],
  ["Mount Mitchell", 35.7648, -82.2652], ["Mount Marcy", 44.1127, -73.9238],
  ["Mount St. Helens", 46.1912, -122.1944], ["Mount Adams", 46.2024, -121.4909],
  ["Mount Baker", 48.7767, -121.8144], ["Lassen Peak", 40.4882, -121.5049],
  ["San Jacinto Peak", 33.8147, -116.6794], ["San Gorgonio Mountain", 34.0993, -116.8250],
  ["Wheeler Peak (NM)", 36.5570, -105.4172], ["Humphreys Peak", 35.3464, -111.6780],
  ["Borah Peak", 44.1374, -113.7811], ["Gannett Peak", 43.1842, -109.6542],
  ["Kings Peak", 40.7764, -110.3729], ["Mount Timpanogos", 40.3908, -111.6456],
  ["Maroon Peak", 39.0708, -106.9890], ["Capitol Peak", 39.1500, -107.0831],
  ["Mount Massive", 39.1875, -106.4757], ["Blanca Peak", 37.5775, -105.4856],
  ["Granite Peak", 45.1633, -109.8074], ["Cloud Peak", 44.3821, -107.1745],
  ["Telescope Peak", 36.1697, -117.0891], ["Guadalupe Peak", 31.8912, -104.8603],
  ["Clingmans Dome", 35.5628, -83.4985], ["Mount Le Conte", 35.6537, -83.4419],
  ["Mount Mansfield", 44.5438, -72.8143], ["Wheeler Peak (NV)", 38.9858, -114.3141],
  ["Mount Sneffels", 38.0038, -107.7923], ["Lone Peak", 45.2786, -111.4508],
  // ── Canada (20) ──
  ["Mount Robson", 53.1092, -119.1558], ["Mount Assiniboine", 50.8697, -115.6503],
  ["Mount Temple", 51.3506, -116.2069], ["Mount Athabasca", 52.1875, -117.2564],
  ["Mount Victoria", 51.3833, -116.3167], ["Mount Rundle", 51.1447, -115.5250],
  ["Cascade Mountain", 51.2469, -115.5150], ["Mount Edith Cavell", 52.6875, -118.0619],
  ["Mount Sir Donald", 51.2942, -117.4425], ["Mount Columbia", 52.1500, -117.4500],
  ["Mount Garibaldi", 49.8506, -123.0044], ["Black Tusk", 49.9739, -123.0442],
  ["Stawamus Chief", 49.6858, -123.1408], ["Ha Ling Peak", 51.0669, -115.4022],
  ["Sulphur Mountain", 51.1494, -115.5744], ["Castle Mountain", 51.2700, -115.9200],
  ["Whistler Mountain", 50.0594, -122.9486], ["Grouse Mountain", 49.3800, -123.0817],
  ["Mount Logan", 60.5672, -140.4053], ["Mount Fairweather", 58.9064, -137.5219],
  // ── Switzerland (20) ──
  ["Matterhorn", 45.9763, 7.6586], ["Dufourspitze", 45.9369, 7.8669],
  ["Dom", 46.0939, 7.8589], ["Weisshorn", 46.1017, 7.7167],
  ["Eiger", 46.5775, 8.0053], ["Mönch", 46.5586, 7.9967],
  ["Jungfrau", 46.5367, 7.9625], ["Breithorn", 45.9414, 7.8014],
  ["Piz Bernina", 46.3828, 9.9083], ["Finsteraarhorn", 46.5372, 8.1261],
  ["Aletschhorn", 46.4650, 8.0136], ["Grand Combin", 45.9403, 7.2992],
  ["Dent Blanche", 46.0347, 7.6119], ["Obergabelhorn", 46.0453, 7.6675],
  ["Piz Palü", 46.3792, 9.9675], ["Titlis", 46.7717, 8.4372],
  ["Pilatus", 46.9789, 8.2525], ["Rigi", 47.0575, 8.4853],
  ["Säntis", 47.2492, 9.3431], ["Schilthorn", 46.5583, 7.8347],
  // ── Japan (20) ──
  ["Mount Fuji", 35.3606, 138.7274], ["Kitadake", 35.6744, 138.2389],
  ["Okuhotakadake", 36.2894, 137.6481], ["Yarigatake", 36.3419, 137.6475],
  ["Tateyama", 36.5725, 137.6197], ["Hakusan", 36.1553, 136.7714],
  ["Ontakesan", 35.8931, 137.4803], ["Tsurugidake", 36.6236, 137.6172],
  ["Norikuradake", 36.1061, 137.5536], ["Kiso-Komagatake", 35.7892, 137.8047],
  ["Akadake", 35.9708, 138.3703], ["Asamayama", 36.4061, 138.5231],
  ["Bandaisan", 37.6014, 140.0425], ["Tanigawadake", 36.8358, 138.9264],
  ["Nantaisan", 36.7658, 139.4919], ["Zaōzan", 38.1442, 140.4400],
  ["Daisen", 35.3708, 133.5464], ["Asosan", 32.8844, 131.1044],
  ["Takaosan", 35.6253, 139.2436], ["Kumotoriyama", 35.8542, 138.9436],
];

async function main() {
  console.log(`\n🥇 Tagging ${ICONIC.length} iconic summits...\n`);
  let matched = 0, missed = 0;

  for (const [label, lat, lng] of ICONIC) {
    // Nearest peak within 5 km
    const { data, error } = await supabase.rpc("nearby_peaks", { lat, lng, radius_km: 5, lim: 1 });
    if (error) { console.error(`  ${label}: RPC error — ${error.message}`); missed++; continue; }
    const peak = data?.[0];
    if (!peak) { console.log(`  ✗ ${label} — no peak within 5 km (not in imported data)`); missed++; continue; }

    const { error: upErr } = await supabase.from("peaks").update({ is_iconic: true }).eq("id", peak.id);
    if (upErr) { console.error(`  ${label}: update failed — ${upErr.message}`); missed++; continue; }
    console.log(`  ✓ ${label} → "${peak.name || peak.id}" (${peak.elevation ?? "?"}m)`);
    matched++;
  }

  console.log(`\n✅ Done. Matched ${matched}/${ICONIC.length}, missed ${missed}.`);
  if (missed) console.log("   (Misses are peaks outside your imported regions — e.g. Alaska.)");
}

main().catch((e) => { console.error(e); process.exit(1); });
