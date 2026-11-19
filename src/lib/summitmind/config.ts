/**
 * SummitMind — environment config.
 *
 * Add these to `.env.local` (not committed) alongside your existing Supabase/Mapbox vars:
 *
 *   QDRANT_URL=http://localhost:6333          # or the in-cluster Service DNS name once deployed
 *   QDRANT_COLLECTION=summitmind_trail_context
 *   ANTHROPIC_API_KEY=sk-ant-...
 *   LANGFUSE_PUBLIC_KEY=pk-lf-...
 *   LANGFUSE_SECRET_KEY=sk-lf-...
 *   LANGFUSE_BASE_URL=http://localhost:3030    # self-hosted, Phase 8 of the roadmap
 *   OPEN_METEO_BASE_URL=https://api.open-meteo.com/v1
 *
 * Same pattern as src/lib/supabase/client.ts — read once here, never call
 * process.env directly from inside a node or tool file.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name} (check .env.local)`);
  }
  return value;
}

/**
 * Read lazily, via getters.
 *
 * A module must not throw while being imported. Calling `required()` at module
 * scope meant that merely importing this file — which Next.js does for every
 * route it collects page data for — aborted the whole production build with
 * "Missing required env var: QDRANT_URL". The variables are now demanded at
 * the moment they are used, so the app builds and deploys with SummitMind
 * unconfigured, and only a request that actually reaches it fails, with the
 * same clear message.
 */
export const summitMindConfig = {
  qdrant: {
    get url() {
      return required("QDRANT_URL");
    },
    get collection() {
      return process.env.QDRANT_COLLECTION ?? "summitmind_trail_context";
    },
  },
  anthropic: {
    get apiKey() {
      return required("ANTHROPIC_API_KEY");
    },
    get model() {
      return process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5";
    },
  },
  langfuse: {
    get publicKey() {
      return process.env.LANGFUSE_PUBLIC_KEY;
    },
    get secretKey() {
      return process.env.LANGFUSE_SECRET_KEY;
    },
    get baseUrl() {
      return process.env.LANGFUSE_BASE_URL;
    },
    get enabled() {
      return Boolean(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY);
    },
  },
  openMeteo: {
    get baseUrl() {
      return process.env.OPEN_METEO_BASE_URL ?? "https://api.open-meteo.com/v1";
    },
  },
} as const;

/** True when SummitMind has everything it needs; lets a route 503 politely. */
export function isSummitMindConfigured(): boolean {
  return Boolean(process.env.QDRANT_URL && process.env.ANTHROPIC_API_KEY);
}
