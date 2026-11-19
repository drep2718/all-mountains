import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchExploreBounds, longitudeRanges } from "./explore";

const { db, chain, state } = vi.hoisted(() => {
  const state = { peaks: { data: [] as unknown[], error: null as null | { message: string } }, routes: { data: [] as unknown[], error: null as null | { message: string } } };
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const key of ["select", "in", "order", "limit", "abortSignal"]) chain[key] = vi.fn(() => chain);
  chain.then = vi.fn((resolve) => Promise.resolve(state.routes).then(resolve));
  const db = { rpc: vi.fn(() => Promise.resolve(state.peaks)), from: vi.fn(() => chain) };
  return { db, chain, state };
});
vi.mock("@/lib/supabase/client", () => ({ createClient: () => db }));
const bounds = { minLat: 39, maxLat: 40, minLng: -107, maxLng: -105, zoom: 8 };

beforeEach(() => {
  vi.clearAllMocks();
  state.peaks = { data: [{ slug: "mount-elbert-united-states" }], error: null };
  state.routes = { data: [{ id: 1, peak_slug: "mount-elbert-united-states" }], error: null };
});

describe("explore database contract", () => {
  it("uses the deployed RPC signature and loads trails through the visible peak slugs", async () => {
    const result = await fetchExploreBounds(bounds);
    expect(result.peaks).toHaveLength(1);
    expect(result.routes).toHaveLength(1);
    expect(db.rpc).toHaveBeenCalledExactlyOnceWith("peaks_in_bounds", { min_lat: 39, min_lng: -107, max_lat: 40, max_lng: -105, max_rows: 400 });
    expect(db.from).toHaveBeenCalledExactlyOnceWith("routes");
    expect(chain.in).toHaveBeenCalledWith("peak_slug", ["mount-elbert-united-states"]);
  });
  it("clears old trails at low zoom, in empty areas and while isolating a route", async () => {
    expect((await fetchExploreBounds({ ...bounds, zoom: 4 })).routes).toEqual([]);
    expect((await fetchExploreBounds(bounds, false)).routes).toEqual([]);
    state.peaks.data = [];
    expect(await fetchExploreBounds(bounds)).toEqual({ peaks: [], routes: [] });
    expect(db.from).not.toHaveBeenCalled();
  });
  it("surfaces resolved database errors instead of claiming the map is empty", async () => {
    state.peaks.error = { message: "PGRST202: no matching function" };
    await expect(fetchExploreBounds(bounds)).rejects.toThrow("Couldn't load peaks");
    state.peaks.error = null;
    state.routes.error = { message: "permission denied" };
    await expect(fetchExploreBounds(bounds)).rejects.toThrow("Couldn't load routes");
  });
  it("propagates rejected requests so the UI can stop loading and offer retry", async () => {
    db.rpc.mockRejectedValueOnce(new Error("network unreachable") as never);
    await expect(fetchExploreBounds(bounds)).rejects.toThrow("network unreachable");
  });
  it("deduplicates summits when a wrapped viewport needs two requests", async () => {
    const result = await fetchExploreBounds({ ...bounds, minLng: 170, maxLng: 190 });
    expect(db.rpc).toHaveBeenCalledTimes(2);
    expect(result.peaks).toHaveLength(1);
  });
});

describe("wrapped map bounds", () => {
  it("handles the antimeridian, repeated worlds and the whole world", () => {
    expect(longitudeRanges(170, 190)).toEqual([[170, 180], [-180, -170]]);
    expect(longitudeRanges(-190, -170)).toEqual([[170, 180], [-180, -170]]);
    expect(longitudeRanges(250, 260)).toEqual([[-110, -100]]);
    expect(longitudeRanges(-200, 200)).toEqual([[-180, 180]]);
    expect(longitudeRanges(170, -170)).toEqual([[170, 180], [-180, -170]]);
  });
});
