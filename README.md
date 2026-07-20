# All Mountains 🏔️

Mobile-first PWA for discovering and logging mountain summits — AllTrails meets PeakVisor.

**Live:** https://all-mountains.vercel.app

## Features
- 134k+ peaks and curated hiking trails across the US, Canada, Switzerland, and Japan
- Clustered terrain map (Mapbox GL) — peaks load as you pan/zoom
- Trail detail: distance, est. time, elevation, route type, peaks crossed, map thumbnails
- Iconic Top 100 summits highlighted in gold + filterable
- Summit logbook with photos, filters (difficulty, length, route type, features)
- Google + email auth (Supabase)

## Stack
Next.js (App Router) · Supabase (Postgres + PostGIS + Auth + Storage) · Mapbox GL JS · TanStack Query · Tailwind

## Development
```bash
npm install
npm run dev
```
Requires `.env.local` with `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_MAPBOX_TOKEN` (+ `SUPABASE_SERVICE_ROLE_KEY` for import scripts).

Data import & enrichment scripts live in `scripts/` — see `IMPORT_RUNBOOK.md`.

## Deploy
Pushes to `main` auto-deploy to production via Vercel.
