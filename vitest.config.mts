import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Vitest needs the same `@/` alias the app uses.
 *
 * Without it a lib that imports a sibling as "@/lib/x" cannot be unit-tested
 * at all — the suite fails to collect with "Cannot find package". Half the
 * lib files used relative paths and half used the alias, so which modules
 * were testable depended on which style their author happened to pick.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    environment: "node",
  },
});
