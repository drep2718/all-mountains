# SummitMind — scaffold notes

Phase 8 of the [platform roadmap]. Everything here is wired and typed; the
`TODO` blocks (each with a comment explaining the concept, a worked example
where it helps, and resource links) are yours to fill in — same convention
as DREPWS's scaffolded files.

## Layout

```
src/lib/summitmind/
  types.ts                    full — shared types every node/tool uses
  config.ts                   full — env var loading, see below for what to add
  clients/
    qdrant.ts                 full connection + collection setup · TODO: searchTrailContext()
    embeddings.ts             full — Voyage AI wrapper
    llm.ts                    full — Anthropic client
    langfuse.ts                full — tracing wrapper (no-ops until keys are set)
  tools/
    weather.ts                full fetch · TODO: raw forecast -> WeatherSnapshot
    hazardBulletin.ts         TODO: regional lookup + honest no-coverage fallback
    experience.ts             full Supabase query · TODO: logs -> ExperienceProfile
    tripReports.ts            full — community report fetch/submit/flag CRUD
  graph/
    state.ts                  full — the LangGraph state schema
    nodes/                    seven nodes, all TODO — this is the core logic
    index.ts                  TODO — the actual graph wiring (StateGraph topology)
src/app/api/summitmind/chat/route.ts   full — HTTP wiring, calls the compiled graph
src/components/summitmind/             full — chat UI, calls the API route
scripts/summitmind/ingest-trail-context.ts   full plumbing · TODO: chunk()
supabase/migrations/20260903000100_trip_reports.sql   full — trip_reports + flags tables, RLS
*.test.ts next to every TODO module   it.todo() stubs, matches repo's Vitest convention
```

## Build order that actually works

Don't start with `graph/index.ts` — there's nothing to wire yet. Suggested order:

1. `tools/weather.ts` + `graph/nodes/fetchWeather.ts` — smallest possible
   end-to-end slice, no Qdrant or embeddings needed yet.
2. `clients/qdrant.ts` (`searchTrailContext`) + `graph/nodes/retrieveContext.ts`
   — but ingest something first (`scripts/summitmind/ingest-trail-context.ts`,
   which needs its own `chunk()` filled in) or you'll be searching an empty
   collection.
3. `tools/hazardBulletin.ts` + `graph/nodes/fetchHazardBulletin.ts`
4. `graph/nodes/checkCommunityReports.ts` (its `tools/tripReports.ts` is
   already written — run the migration first: `supabase db push`)
5. `tools/experience.ts` + `graph/nodes/checkExperience.ts`
6. `graph/nodes/assessRisk.ts` — now you have real state shapes to branch on
7. `graph/nodes/synthesize.ts`
8. `graph/index.ts` — wire it all together last, once every node compiles

Fill in each node's `.test.ts` (`it.todo` → real assertions) as you implement
it, not after — that's the point of them being there already.

## New env vars (add to `.env.local`, not committed)

```
QDRANT_URL=http://localhost:6333
QDRANT_COLLECTION=summitmind_trail_context
ANTHROPIC_API_KEY=
VOYAGE_API_KEY=
LANGFUSE_PUBLIC_KEY=
LANGFUSE_SECRET_KEY=
LANGFUSE_BASE_URL=
OPEN_METEO_BASE_URL=https://api.open-meteo.com/v1
```

Only `ANTHROPIC_API_KEY` and `VOYAGE_API_KEY` are required to get the graph
running locally against a local Qdrant (`docker run -p 6333:6333 qdrant/qdrant`
is the fastest way to get one before Phase 4's cluster exists). Langfuse can
stay unset — it no-ops until keys are present.

## Dropping the panel into the app

`ChatPanel` takes `lat`/`lon` props — wire it to whatever the user is
currently looking at (selected peak, map center). Not pre-wired into a page
on purpose, since where it belongs in the nav is a product call, not a
scaffolding one.
