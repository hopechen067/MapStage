---
name: mapstage
description: MapStage live tuner for map/globe projection, satellite, hypsometric relief, 3D terrain, region isolate, CSS color grade, and JSON presets.
---

# MapStage

Use this skill when building or tuning a MapStage scene: map/globe projection, satellite, hypsometric relief, Mapterhorn terrain, region isolate, CSS color grade, and JSON export.

## When to use

- Need a live MapStage tuner (map vs globe, satellite vs relief, isolate).
- Need to lock paint / CSS / camera, then export JSON into another host.
- Need tiered settlements (`capital` / `large` / `medium` / `small` / `pass` / `station` / `ordos`).

Do **not** use the tuner page as the final render host.

## Modes

| Mode | Purpose |
|------|---------|
| **Production stack** | Embed MapStage in your app: optional satellite/raster + Mapterhorn DEM (`encoding: 'terrarium'`) + hillshade + OpenFreeMap vector water + CSS filter + city extrusions. Drive look from exported JSON. |
| **Tuner** | HTTP page under `tuner/` (or the public demo) for sliders, projection, isolate, preset load/export. |

## Workflow

1. Open the tuner: public demo https://hopechen067.github.io/MapStage/ **or** `cd tuner && python -m http.server` and open the local URL printed in the terminal.
2. Tiles: default **EOX Sentinel-2 cloudless** (on) + **Mapterhorn** (`tuner/map-tiles.config.js`). Override with gitignored `map-tiles.config.local.js`.
3. Apply default preset [`tuner/preset-antique-default.json`](tuner/preset-antique-default.json) (same as [`tuner/presets/antique-default.json`](tuner/presets/antique-default.json)). Schema **version 3**.
4. Adjust projection / satellite / relief / isolate / CSS / cities until the look locks.
5. **Export JSON** (copy or download). Confirm `version: 3` plus `ui.projection`, `ui.showSatellite`, `ui.showRelief`, `ui.showCssFilter`, `isolate`.
6. **Migrate** those fields into the production MapStage scene (see references).
7. In production: `jumpTo` camera; wait for `idle`; optionally pre-cache tiles. **Avoid `easeTo` / `flyTo`** for recorded frames.
8. Always set DEM with **`encoding: 'terrarium'`**. Wrong encoding breaks hillshade/terrain.
9. Final frames render from the production host — **not** from the tuner UI.

## Hard rules

- **Tiles not bundled** — MapStage fetches DEM and basemap at runtime from **configured** URLs only.
- **Only use basemap endpoints you are allowed to use** — defaults are public demo tiles (EOX); swap via config when needed.
- **`encoding: 'terrarium'`** on the terrain source — mandatory.
- **No `easeTo` / `flyTo`** in recorded production paths; prefer `jumpTo` + `idle`.
- **Do not host final render on tuner.**
- **Water** on the public tuner is OpenFreeMap / OpenMapTiles vector layers (`water` / `waterway`). Export `ui.showWater` is always `false` (old GeoJSON overlay is off). Do not expect or commit `tuner/assets/water-data.js`.

## Repo vs skill

`git clone` of this GitHub repo pulls the **whole project**. The agent skill is only [`mapstage/`](https://github.com/hopechen067/MapStage/tree/master/mapstage). Install that folder with `npx skills add hopechen067/MapStage --skill mapstage -g` or `gh skill install hopechen067/MapStage mapstage --scope user`, or copy it into the host skills directory and reload. Agents do not auto-discover `mapstage/SKILL.md` from a clone.

## References

- [`references/参数列表说明.md`](references/参数列表说明.md) — parameter tables + v3 defaults
- [`references/tested-config.md`](references/tested-config.md) — sources, layer order, jumpTo + idle
- [`references/tuner-workflow.md`](references/tuner-workflow.md) — HTTP tuner → export → production
- [`references/city-tier-schema.md`](references/city-tier-schema.md) — settlement tiers
- [`schemas/map-preset.schema.json`](schemas/map-preset.schema.json)
- [`schemas/sample-sites.schema.json`](schemas/sample-sites.schema.json)
- [`tuner/`](tuner/) — live page, verify script, default preset, sample sites

## Agents

See [`agents/openai.yaml`](agents/openai.yaml) for display name / default prompt.
