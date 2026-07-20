<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# All Mountains — Project Guide

Mobile-first PWA (AllTrails-style): discover peaks/trails, log summits. Live at https://all-mountains.vercel.app. Pushes to `main` auto-deploy via Vercel.

## Token discipline (read first)
- **Search semantically before opening files**: `grepai search "query"` returns the relevant files/snippets — use it instead of grep/glob exploration. Daemon: `grepai watch` (auto-starts indexing).
- **Prefix noisy commands with `rtk`** to compress output: `rtk git diff`, `rtk npm run build`, `rtk npx tsc --noEmit`. Same exit codes, 60–90% fewer tokens.
- Don't re-read files you just edited. Don't cat package-lock.json, *.log, or public/ binaries.

## Architecture (memorize, don't re-derive)
- **Stack**: Next.js App Router + TS + Tailwind v4 (tokens in `src/app/globals.css` `@theme inline`), Supabase (Postgres + PostGIS + Auth + Storage), Mapbox GL JS, TanStack Query (30min staleTime, `src/components/Providers.tsx`).
- **Data**: `peaks` (134k, US/CA/CH/JP, `is_iconic` flags top-100), `routes` (trails, simplified geometry JSONB + PostGIS `path`), `route_peaks` junction, `profiles`, `summit_logs`. RPCs: `peaks_in_bounds`, `routes_in_bounds`, `nearby_peaks`, `link_route_peaks`.
- **Pages**: `/explore` (map, viewport-loaded peaks+routes, `?peak=`/`?route=` fly-to/isolate), `/peaks` + `/peaks/[id]`, `/routes` + `/routes/[id]`, `/logbook`, `/profile`, auth in `(auth)/`.
- **Key libs**: `src/lib/filters.ts` (shared FilterSheet state), `staticMap.ts` (route thumbnails via Mapbox Static API), `peakImage.ts` (photo_url → satellite fallback), `geocode.ts` (search + reverse).
- **Imports/enrichment**: `scripts/*.ts` run with `npx tsx --env-file=.env.local`. See IMPORT_RUNBOOK.md. Never import with country arg `ALL`.

## Rules
- Semantic color tokens only (`bg-surface`, `text-ink`, `text-pine-500`…) — never raw hex in components; add tokens to globals.css.
- `.env.local` never committed. Service-role key is scripts-only, never shipped to client.
- Supabase free tier: 500 MB DB cap — check size before bulk imports.
- Verify UI changes in the browser (mobile 375px first), then `npx next build` before pushing.
- Difficulty derives from elevation in `src/lib/types.ts::getDifficulty` — single source of truth.
