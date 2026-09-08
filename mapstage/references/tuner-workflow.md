# Tuner workflow

Live parameter page for MapStage.

## Start (HTTP only)

Public demo (same files GitHub Pages publishes from `tuner/`):

https://hopechen067.github.io/MapStage/

Local:

```bash
cd mapstage/tuner
python -m http.server
```

Open the local URL printed in the terminal.

Do **not** open `index.html` via `file://` — preset fetch and site JSON will fail.

### Tiles

- Default: satellite **on** (EOX Sentinel-2), Mapterhorn DEM **on** (`map-tiles.config.js`).
- Personal basemap/keys: `map-tiles.config.local.js` (gitignored). See `map-tiles.config.example.js`.
- Do not commit provider secrets. This project grants no tile license.

Optional smoke check:

```bash
node verify.mjs
```

Exit `0` if required assets exist and the default preset is v3; `1` otherwise.

## Load default preset

On boot the tuner loads (in order of preference):

1. Browser localStorage (if present)
2. [`preset-antique-default.json`](../tuner/preset-antique-default.json)
3. Built-in defaults (same antique v3 values)

Duplicate preset path for packs: [`presets/antique-default.json`](../tuner/presets/antique-default.json).

Use **重置预设** to return to antique default.

## Sliders & toggles

| Panel | What it drives |
|-------|----------------|
| 投影 | `ui.projection` — `map` (mercator) / `globe` |
| 卫星图 | `ui.showSatellite` + satellite paint sliders |
| 海拔设色 | `ui.showRelief` (Mapterhorn `color-relief`) |
| 拆出 | `isolate.enabled` + `isolate.regionId` |
| Hillshade | exaggeration, light direction, shadow/highlight/accent |
| CSS | sepia, saturate, contrast, brightness, hue, warm tint, vignette; `ui.showCssFilter` |
| 城池点位 | `ui.showCities` |
| 相机 | live `center` / `zoom` / `pitch` / `bearing` (also updates on map drag) |

Camera defaults to China overview `[104.0, 35.5]`, zoom `~4.2`. **全国视角** jumps to that frame.

OpenFreeMap vector water is always on. There is no homepage water overlay panel.

## Export

1. **复制 JSON** or **下载 JSON**
2. Confirm root shape: `version: 3`, `camera`, `mapstage`, `css`, `ui`, `isolate`, `cities`
3. `ui` must include `projection`, `showSatellite`, `showRelief`, `showCssFilter`
4. `ui.showWater` / `ui.showHighlight` are exported `false` on the public tuner

Share compact form (URL/hash) uses `format: 'cam-v3'`.

## Migrate to production MapStage

1. Create / open the production MapStage scene (e.g. HyperFrames).
2. Apply `mapstage.*` paint + terrain exaggeration + satellite / relief visibility from the export.
3. Apply `css.*` as the DOM filter / tint / vignette stack around the map canvas (honor `ui.showCssFilter`).
4. Set `ui.projection` (`setProjection`) and `isolate` before capture.
5. Set initial camera from `camera` via `jumpTo` (no `easeTo` / `flyTo` on record path).
6. Load settlement data (`cities.dataFile` or your production sites JSON) with `HanCity3D` tiers.
7. Wait for `idle` (and tile readiness) before capturing frames.
8. Keep the tuner as a design tool only — **do not** host the final render there.

See [`tested-config.md`](tested-config.md) for layer order and Terrarium encoding.
