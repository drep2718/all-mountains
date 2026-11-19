import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The service worker deletes every cache not in its KEEP list when it
 * activates. If the names in offline.ts drift from the ones in sw.js, the
 * worker throws away exactly the data a user downloaded for a mountain — and
 * nothing fails loudly at the time. These names are a contract; assert it.
 */
const sw = readFileSync(path.join(process.cwd(), "public/sw.js"), "utf8");
const lib = readFileSync(path.join(process.cwd(), "src/lib/offline.ts"), "utf8");

const swConst = (name: string) => {
  const direct = sw.match(new RegExp(`const ${name} = "([^"]+)"`));
  if (direct) return direct[1];
  const templated = sw.match(new RegExp(`const ${name} = \`([^\`]+)\``));
  if (!templated) return null;
  const version = sw.match(/const VERSION = "([^"]+)"/)?.[1] ?? "";
  return templated[1].replace("${VERSION}", version);
};

const libConst = (name: string) => lib.match(new RegExp(`${name} = "([^"]+)"`))?.[1] ?? null;

describe("service worker cache names stay in sync with offline.ts", () => {
  it("shell cache matches", () => {
    expect(libConst("SHELL_CACHE")).toBe(swConst("SHELL"));
  });

  it("tile cache matches", () => {
    expect(libConst("TILE_CACHE")).toBe(swConst("TILES"));
  });

  it("image cache matches", () => {
    expect(libConst("IMAGE_CACHE")).toBe(swConst("IMAGES"));
  });

  it("every cache offline.ts writes to is in the worker's KEEP list", () => {
    const keep = sw.match(/const KEEP = \[([^\]]+)\]/)?.[1] ?? "";
    for (const name of ["SHELL", "TILES", "IMAGES"]) {
      expect(keep, `${name} missing from KEEP — downloads would be deleted on update`)
        .toContain(name);
    }
  });

  it("tile and image caches are unversioned so updates never delete downloads", () => {
    expect(swConst("TILES")).not.toMatch(/v\d+$/);
    expect(swConst("IMAGES")).not.toMatch(/v\d+$/);
  });
});
