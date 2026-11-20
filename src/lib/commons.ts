/**
 * Ask Commons for an image at the size you are actually going to draw.
 *
 * `peaks.hero_photo_url` is stored at 1,280 px because the peak page shows
 * it full width. A grid of 24 cards drawing the same URL into a 300 px box
 * downloads 24 full-size photographs to display thumbnails — several
 * megabytes to paint a page that needs a few hundred kilobytes.
 *
 * This is the browser-side twin of `commonsThumb` in the catalogue
 * scripts. The two are kept apart deliberately: that one runs in Node over
 * NDJSON during a build, this one runs per render, and sharing a module
 * across that boundary would drag the build-time code into the bundle.
 * What must stay in step is the width ladder, which is why it is stated
 * here with the same measurement behind it.
 *
 * Commons serves only these widths; every other value returns 400.
 */
const COMMONS_WIDTHS = [120, 250, 500, 960, 1280, 1920];

/** The narrowest allowed width that is still at least `want`. */
function snap(want: number): number {
  return COMMONS_WIDTHS.find((w) => w >= want) ?? COMMONS_WIDTHS[COMMONS_WIDTHS.length - 1];
}

/**
 * Re-point a stored Commons thumbnail URL at a different width.
 *
 * Anything that is not a Commons thumbnail URL — a Mapbox satellite
 * fallback, say — is returned untouched.
 */
export function commonsWidth(url: string | null | undefined, want: number): string | null {
  if (!url) return null;
  const m = url.match(/^(.*\/thumb\/.*?)\/\d+px-([^/?]+)(\?.*)?$/);
  if (!m) return url;
  return `${m[1]}/${snap(want)}px-${m[2]}`;
}
