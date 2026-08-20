# All Mountains — AllTrails Parity Acceptance Criteria

Autonomous loop run. Every criterion must be **mechanically verified** by
`.loop/verify.sh` (exit 0 = all green). No criterion passes on assertion alone.

Designated regions (hard constraint): **US, CA, CH, JP only.** Never import `ALL`.

---

## A. DATA COMPLETENESS

| ID | Criterion | Threshold |
|----|-----------|-----------|
| A1 | Peaks in DB | ≥ 130,000 |
| A2 | Trails/routes in DB | ≥ 25,000 (from 2,486 baseline) |
| A3 | Trails with real geometry | 100% of routes have non-null geometry |
| A4 | Trails linked to peaks | ≥ 5,000 route_peaks links |
| A5 | Every designated region has trails | US, CA, CH, JP each ≥ 500 |
| A6 | Named trails only surfaced | 0 unnamed routes in browse queries |

## B. GPS TRACKING (safety-critical)

| ID | Criterion | Verify |
|----|-----------|--------|
| B1 | Start/stop a recording | `useTracker` hook exists w/ start,pause,resume,stop |
| B2 | Live stats | distance, duration, elevation gain, pace, current speed |
| B3 | High-accuracy GPS | `enableHighAccuracy:true`, watchPosition (not one-shot) |
| B4 | GPS noise filtered | accuracy gate + jitter rejection before distance accrues |
| B5 | Survives backgrounding | state persisted to localStorage on every fix; resumes on reload |
| B6 | Off-route warning | distance-to-trail computed; warns past threshold |
| B7 | Saved activity | completed track persists to DB with geometry |
| B8 | GPX export | recorded track downloadable as valid GPX 1.1 |
| B9 | Permission/error states | denied, unavailable, timeout all handled visibly |

## C. OFFLINE (safety-critical)

| ID | Criterion | Verify |
|----|-----------|--------|
| C1 | Service worker registered | SW file served + registers on load |
| C2 | App shell works offline | precached routes respond offline |
| C3 | Map tiles cached per-trail | explicit "Download" per trail caches its tiles |
| C4 | Trail data cached offline | geometry + peak data readable with no network |
| C5 | Download progress + size | user sees % and MB |
| C6 | Manage/delete downloads | list of downloaded trails, removable |
| C7 | Offline indicator | app visibly reports offline state |

## D. ALLTRAILS PARITY

| ID | Criterion |
|----|-----------|
| D1 | Search any mountain → peaks + trails (DONE) |
| D2 | Filters: distance, elevation, difficulty, route type, length (DONE) |
| D3 | Sort incl. "Most popular" (DONE) |
| D4 | Lists holding peaks + trails (DONE) |
| D5 | Trail detail: elevation profile chart |
| D6 | Reviews + star ratings, aggregate per trail |
| D7 | Activity/logbook feed of completed hikes |
| D8 | Navigation: directions to trailhead |

## E. ENGINEERING QUALITY (non-negotiable)

| ID | Criterion | Verify |
|----|-----------|--------|
| E1 | `tsc --noEmit` clean | 0 errors |
| E2 | Production build passes | `next build` exit 0 |
| E3 | ESLint clean | 0 errors |
| E4 | Zero console errors on every route | browser check |
| E5 | No secrets committed | scan staged diff |
| E6 | Every new module < 400 lines | file length check |
| E7 | Pushed to GitHub | working tree clean, origin/main == HEAD |
