// Mapbox Geocoding — turn a town/state name into coordinates + a bounding box.

export interface GeocodeResult {
  name: string;        // full place name
  center: [number, number]; // [lng, lat]
  bbox: [number, number, number, number] | null; // [minLng, minLat, maxLng, maxLat]
}

// ~0.15° box (~15 km) synthesized around a point-only result (mountains/POIs
// rarely carry a bbox), so "Mount Shasta" both flies the map there and gives
// list pages a sensible area to filter by.
const POINT_SPAN = 0.15;

export async function geocode(query: string): Promise<GeocodeResult[]> {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token || query.trim().length < 2) return [];

  // `poi` pulls in named natural features (mountains, lakes, parks) so you can
  // search ANY mountain by name even when it isn't a summit node in our DB.
  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json` +
    `?types=place,region,district,locality,poi&limit=8&access_token=${token}`;

  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();

  return (data.features || [])
    // Drop weak matches — this is what removes the "Mount, Cornwall" /
    // "Shastar, Hamirpur" style noise from a search like "Mount Shasta".
    .filter((f: { relevance?: number }) => (f.relevance ?? 1) >= 0.8)
    .slice(0, 4)
    .map(
      (f: { place_name: string; text?: string; center: [number, number]; bbox?: number[] }) => {
        const [lng, lat] = f.center;
        return {
          name: f.place_name,
          center: f.center,
          bbox:
            f.bbox && f.bbox.length === 4
              ? (f.bbox as [number, number, number, number])
              : [lng - POINT_SPAN, lat - POINT_SPAN, lng + POINT_SPAN, lat + POINT_SPAN],
        };
      }
    );
}

export interface PlaceContext {
  region: string | null;  // state / province
  place: string | null;   // nearest town/city
  country: string | null;
}

// Reverse-geocode a coordinate to its state, nearest town, and country.
export async function reverseGeocode(lat: number, lng: number): Promise<PlaceContext> {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const empty = { region: null, place: null, country: null };
  if (!token) return empty;

  // No `types` filter — for remote points that returns nothing. We take the
  // full result hierarchy and pull region / place / country from the features
  // and their context arrays.
  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json` +
    `?access_token=${token}`;
  const res = await fetch(url);
  if (!res.ok) return empty;
  const data = await res.json();

  const out: PlaceContext = { ...empty };
  for (const f of data.features || []) {
    const type = (f.place_type || [])[0];
    if (type === "region" && !out.region) out.region = f.text;
    if ((type === "place" || type === "locality") && !out.place) out.place = f.text;
    if (type === "country" && !out.country) out.country = f.text;
    for (const c of f.context || []) {
      if (typeof c.id !== "string") continue;
      if (c.id.startsWith("region") && !out.region) out.region = c.text;
      if (c.id.startsWith("place") && !out.place) out.place = c.text;
      if (c.id.startsWith("country") && !out.country) out.country = c.text;
    }
  }
  return out;
}
