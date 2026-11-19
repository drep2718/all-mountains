# Route importer follow-up — 2026-11-19

The original importer has exited. No second importer was started by Codex, and neither protected route NDJSON file was edited, staged or committed by Codex.

The original run reported 24 failed peaks. Together with the 70 peaks added after it started, there are **94 peaks without a completed route query**. This is distinct from successfully queried mountains that simply have no mapped path.

The current verified catalogue has been loaded: **1,102 peaks, 5,628 photos, 8,259 routes**. The audit passes.

For the importer owner, after confirming there is no importer process:

```sh
pgrep -fl "catalogue/import-routes"
# Only when no importer is running:
npx tsx scripts/catalogue/import-routes.ts
npx tsx scripts/catalogue/audit-catalogue.ts
npx tsx --env-file=.env.local scripts/catalogue/load-catalogue.ts
```

A plain resume uses the existing done log and queries the missing 94 only. Do not use `--fresh`. Do not use `--only` for already completed route slugs: that path bypasses the resume filter.

## Original failed peaks

- `bishop-peak-united-states` — Bishop Peak (United States)
- `black-balsam-knob-united-states` — Black Balsam Knob (United States)
- `cold-mountain-united-states` — Cold Mountain (United States)
- `mount-pisgah-united-states` — Mount Pisgah (United States)
- `looking-glass-rock-united-states` — Looking Glass Rock (United States)
- `santis-switzerland` — Säntis (Switzerland)
- `chaserrugg-switzerland` — Chäserrugg (Switzerland)
- `rigi-kulm-switzerland` — Rigi Kulm (Switzerland)
- `hoher-kasten-switzerland` — Hoher Kasten (Switzerland)
- `chasseral-switzerland` — Chasseral (Switzerland)
- `grossvenediger-austria` — Grossvenediger (Austria)
- `kitzsteinhorn-austria` — Kitzsteinhorn (Austria)
- `grossglockner-austria` — Grossglockner (Austria)
- `olperer-austria` — Olperer (Austria)
- `parseierspitze-austria` — Parseierspitze (Austria)
- `patscherkofel-austria` — Patscherkofel (Austria)
- `nordkette-hafelekarspitze-austria` — Nordkette (Hafelekarspitze) (Austria)
- `pachnes-lefka-ori-greece` — Pachnes (Lefka Ori) (Greece)
- `kintoki-yama-japan` — Kintoki-yama (Japan)
- `mount-fuji-japan` — Mount Fuji (Japan)
- `tekari-dake-japan` — Tekari-dake (Japan)
- `ibuki-yama-japan` — Ibuki-yama (Japan)
- `daisen-japan` — Daisen (Japan)
- `hyonosen-japan` — Hyonosen (Japan)

## Added peaks awaiting route queries

- `mount-lucania-canada` — Mount Lucania (Canada)
- `mount-steele-canada` — Mount Steele (Canada)
- `mount-logan-canada` — Mount Logan (Canada)
- `king-peak-canada` — King Peak (Canada)
- `mount-hubbard-canada` — Mount Hubbard (Canada)
- `mount-vancouver-canada` — Mount Vancouver (Canada)
- `mount-alverstone-canada` — Mount Alverstone (Canada)
- `mount-kennedy-canada` — Mount Kennedy (Canada)
- `mount-wood-canada` — Mount Wood (Canada)
- `mount-waddington-canada` — Mount Waddington (Canada)
- `mount-assiniboine-canada` — Mount Assiniboine (Canada)
- `mount-columbia-canada` — Mount Columbia (Canada)
- `mount-robson-canada` — Mount Robson (Canada)
- `mount-temple-canada` — Mount Temple (Canada)
- `mount-clemenceau-canada` — Mount Clemenceau (Canada)
- `mount-athabasca-canada` — Mount Athabasca (Canada)
- `mount-forbes-canada` — Mount Forbes (Canada)
- `mount-alberta-canada` — Mount Alberta (Canada)
- `mount-edith-cavell-canada` — Mount Edith Cavell (Canada)
- `mount-victoria-canada` — Mount Victoria (Canada)
- `stawamus-chief-canada` — Stawamus Chief (Canada)
- `mount-garibaldi-canada` — Mount Garibaldi (Canada)
- `mount-seymour-canada` — Mount Seymour (Canada)
- `grouse-mountain-canada` — Grouse Mountain (Canada)
- `cheam-peak-canada` — Cheam Peak (Canada)
- `golden-ears-canada` — Golden Ears (Canada)
- `crown-mountain-canada` — Crown Mountain (North Shore Mountains) (Canada)
- `the-lions-canada` — The Lions (peaks) (Canada)
- `mount-arrowsmith-canada` — Mount Arrowsmith (Canada)
- `golden-hinde-canada` — Golden Hinde (Canada)
- `mount-washington-canada` — Mount Washington (British Columbia) (Canada)
- `mount-jacques-cartier-canada` — Mount Jacques-Cartier (Canada)
- `mount-caubvick-canada` — Mount Caubvick (Canada)
- `mount-benson-canada` — Mount Benson (British Columbia) (Canada)
- `mount-odin-canada` — Mount Odin (Canada)
- `barbeau-peak-canada` — Barbeau Peak (Canada)
- `mount-thor-canada` — Mount Thor (Canada)
- `mount-rundle-canada` — Mount Rundle (Canada)
- `ha-ling-peak-canada` — Ha Ling Peak (Canada)
- `aconcagua-argentina` — Aconcagua (Argentina)
- `vinson-massif-antarctica` — Vinson Massif (Antarctica)
- `puncak-jaya-indonesia` — Puncak Jaya (Indonesia)
- `cirque-peak-canada` — Cirque Peak (Canada)
- `mount-kilimanjaro-tanzania` — Mount Kilimanjaro (Tanzania)
- `lhotse-nepal` — Lhotse (Nepal)
- `mount-kosciuszko-australia` — Mount Kosciuszko (Australia)
- `kangchenjunga-nepal` — Kangchenjunga (Nepal)
- `makalu-nepal` — Makalu (Nepal)
- `dhaulagiri-nepal` — Dhaulagiri (Nepal)
- `manaslu-nepal` — Manaslu (Nepal)
- `annapurna-nepal` — Annapurna (Nepal)
- `ama-dablam-nepal` — Ama Dablam (Nepal)
- `mera-peak-nepal` — Mera Peak (Nepal)
- `island-peak-nepal` — Island Peak (Nepal)
- `nanga-parbat-pakistan` — Nanga Parbat (Pakistan)
- `broad-peak-pakistan` — Broad Peak (Pakistan)
- `fitz-roy-argentina` — Fitz Roy (Argentina)
- `cerro-torre-argentina` — Cerro Torre (Argentina)
- `cotopaxi-ecuador` — Cotopaxi (Ecuador)
- `chimborazo-ecuador` — Chimborazo (Ecuador)
- `ojos-del-salado-chile` — Ojos del Salado (Chile)
- `huascaran-peru` — Huascarán (Peru)
- `mount-kenya-kenya` — Mount Kenya (Kenya)
- `toubkal-morocco` — Toubkal (Morocco)
- `ras-dashen-ethiopia` — Ras Dashen (Ethiopia)
- `aoraki-mount-cook-new-zealand` — Aoraki / Mount Cook (New Zealand)
- `mount-taranaki-new-zealand` — Mount Taranaki (New Zealand)
- `mount-aspiring-tititea-new-zealand` — Mount Aspiring / Tititea (New Zealand)
- `mount-wilhelm-papua-new-guinea` — Mount Wilhelm (Papua New Guinea)
- `mount-stanley-uganda` — Mount Stanley (Uganda)
