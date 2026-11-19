import { afterEach, describe, expect, it, vi } from "vitest";
import { estimatePeakDownload, swReady } from "./offline";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("worker readiness", () => {
  it("returns immediately in development without waiting for a worker that never registers", async () => {
    vi.stubGlobal("navigator", { serviceWorker: { getRegistration: async () => undefined, ready: new Promise(() => {}) } });
    expect(await swReady()).toBeNull();
  });
  it("bounds the wait for a registration that never activates", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("navigator", { serviceWorker: { getRegistration: async () => ({}), ready: new Promise(() => {}) } });
    const ready = swReady();
    await vi.advanceTimersByTimeAsync(10000);
    expect(await ready).toBeNull();
  });
  it("uses an already active registration", async () => {
    const registration = { active: {} };
    vi.stubGlobal("navigator", { serviceWorker: { getRegistration: async () => registration } });
    expect(await swReady()).toBe(registration);
  });
});

describe("download estimates", () => {
  it("includes photographs and the lossless terrain instead of a flat per-tile guess", () => {
    const base = { routePolys: [], latitude: 36.5785, longitude: -118.2923, photoUrls: [] };
    const estimate = estimatePeakDownload(base);
    const withPhotos = estimatePeakDownload({ ...base, photoUrls: ["photo-a", "photo-b"] });
    expect(estimate.tileCount).toBeGreaterThan(0);
    expect(withPhotos.bytes - estimate.bytes).toBe(2 * 900 * 1024);
    expect(estimate.label).toMatch(/^~/);
  });
});
