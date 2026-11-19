import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync("public/sw.js", "utf8");

async function download({ port = false, sourceClient = true, fail = false, cached = false, storageError = false, empty = false } = {}) {
  const handlers: Record<string, (event: unknown) => void> = {};
  const messages: { type: string; bytes: number; failed?: number }[] = [];
  const postMessage = vi.fn((m) => messages.push(m));
  const matchAll = vi.fn(async () => [{ postMessage }]);
  const fetch = vi.fn(async () => { if (fail) throw new Error("offline"); return new Response("four"); });
  const put = vi.fn(async () => {});
  runInNewContext(source, {
    self: { addEventListener: (name: string, fn: (event: unknown) => void) => { handlers[name] = fn; }, clients: { matchAll } },
    caches: { open: async () => { if (storageError) throw new Error("quota"); return { match: async () => cached ? new Response("four") : undefined, put }; } },
    fetch,
  });
  let work: Promise<unknown> | undefined;
  handlers.message({ data: { type: "CACHE_TILES", id: "test", urls: empty ? [] : ["tile-a", "tile-b"] }, ports: port ? [{ postMessage }] : [], source: sourceClient ? { postMessage } : null, waitUntil: (promise: Promise<unknown>) => { work = promise; } });
  await work;
  return { messages, matchAll, fetch, put };
}

describe("production service-worker download protocol", () => {
  it("replies through a MessageChannel before the page is controlled", async () => {
    const result = await download({ port: true, sourceClient: false });
    expect(result.messages.at(-1)).toMatchObject({ type: "CACHE_DONE", bytes: 8, failed: 0 });
    expect(result.matchAll).not.toHaveBeenCalled();
  });
  it("supports the original event.source caller", async () => {
    expect((await download()).messages.at(-1)?.type).toBe("CACHE_DONE");
  });
  it("awaits fallback broadcasts and includes uncontrolled windows", async () => {
    const result = await download({ sourceClient: false });
    expect(result.matchAll).toHaveBeenCalledWith({ includeUncontrolled: true, type: "window" });
    expect(result.messages.at(-1)?.type).toBe("CACHE_DONE");
  });
  it("reports missing map tiles as an error instead of an available download", async () => {
    expect((await download({ fail: true })).messages.at(-1)).toMatchObject({ type: "CACHE_ERROR", failed: 2 });
  });
  it("reports cache storage failure promptly", async () => {
    expect((await download({ storageError: true, port: true })).messages.at(-1)?.type).toBe("CACHE_ERROR");
  });
  it("counts cached bytes without needing a Content-Length header or refetching", async () => {
    const result = await download({ cached: true });
    expect(result.messages.at(-1)?.bytes).toBe(8);
    expect(result.fetch).not.toHaveBeenCalled();
    expect(result.put).not.toHaveBeenCalled();
  });
  it("completes an empty request rather than stranding the caller", async () => {
    expect((await download({ empty: true })).messages.at(-1)).toMatchObject({ type: "CACHE_DONE", bytes: 0 });
  });
});


describe("offline database response identity", () => {
  it("never substitutes a different query or single/array response for the requested peak", async () => {
    const handlers: Record<string, (event: unknown) => void> = {};
    const fullUrl = "https://example.supabase.co/rest/v1/peaks?select=*&slug=eq.whitney";
    const partialUrl = "https://example.supabase.co/rest/v1/peaks?select=slug&limit=6";
    const full = { elevation_m: 4421, slug: "whitney" };
    runInNewContext(source, {
      URL,
      self: { location: { origin: "http://localhost" }, addEventListener: (name: string, fn: (event: unknown) => void) => { handlers[name] = fn; } },
      fetch: async () => { throw new Error("offline"); },
      caches: { open: async () => ({ match: async (request: Request, options?: { ignoreSearch?: boolean }) => {
        if (options?.ignoreSearch) return new Response(JSON.stringify([{ slug: "wrong-partial-row" }]));
        return request.url === fullUrl ? new Response(JSON.stringify(full)) : undefined;
      } }) },
    });
    let response: Promise<Response> | undefined;
    handlers.fetch({ request: new Request(fullUrl), respondWith: (r: Promise<Response>) => { response = r; } });
    expect(await (await response!).json()).toEqual(full);
    handlers.fetch({ request: new Request(partialUrl), respondWith: (r: Promise<Response>) => { response = r; } });
    await expect(response).rejects.toThrow("offline");
  });
});


describe("fresh offline app code after a deployment", () => {
  it("bypasses an old cached HTML shell for explicit download refreshes", async () => {
    const handlers: Record<string, (event: unknown) => void> = {};
    const fetch = vi.fn(async () => new Response("new build HTML"));
    const open = vi.fn(async () => ({ match: async () => new Response("old build HTML") }));
    runInNewContext(source, {
      URL,
      self: { location: { origin: "http://localhost" }, addEventListener: (name: string, fn: (event: unknown) => void) => { handlers[name] = fn; } },
      fetch, caches: { open },
    });
    let response: Promise<Response> | undefined;
    handlers.fetch({ request: new Request("http://localhost/record", { cache: "reload" }), respondWith: (r: Promise<Response>) => { response = r; } });
    expect(await (await response!).text()).toBe("new build HTML");
    expect(open).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
