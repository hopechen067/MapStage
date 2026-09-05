# Tuner workflow

Live parameter page for MapStage.

## Start (HTTP only)

```bash
cd mapstage/tuner
python -m http.server 8765
```

Open `http://localhost:8765/`.

Do **not** open `index.html` via `file://` — preset fetch and site JSON will fail.

### Tiles

- Default: satellite **on**, Mapterhorn DEM **on** (`map-tiles.config.js`).
- Personal basemap/keys: `map-tiles.config.local.js` (gitignored). See `map-tiles.config.example.js`.
- Do not commit provider secrets. This project grants no tile license.

Optional smoke check:

```bash
node verify.mjs
```

Exit `0` if required assets exist; `1` otherwise.

## Load default preset

On boot the tuner loads (in order of preference):

1. Browser localStorage (if present)
2. [`preset-antique-default.json`](../tuner/preset-antique-default.json)
3. Built-in defaults (same antique v2 values)

Duplicate preset path for packs: [`presets/antique-default.json`](../tuner/presets/antique-default.json).

Use **重置预设** to return to antique default.

## Sliders & toggles

| Panel | What it drives |
|-------|----------------|
| Satellite | opacity / saturation / contrast / brightness / hue |
| Hillshade | exaggeration, light direction, shadow/highlight/accent |
| Water | lake + river colors/widths + `highlightRiver` |
| CSS | sepia, saturate, contrast, brightness, hue, warm tint, vignette |
| UI buttons | `showWater`, `showHighlight`, `showCities`, `showRef` |

Camera defaults to China overview `[104.0, 35.5]`, zoom `~4.2`. Use the China / regional view buttons only for framing while tuning.

## Export

1. **复制 JSON** or **下载 JSON**
2. Confirm root shape: `camera`, `maplibre`, `css`, `ui`, `cities`
3. Prefer keys `highlightRiver` / `highlightWidth` / `showHighlight`

## Migrate to HyperFrames

1. Create / open the HyperFrames MapStage scene.
2. Apply `mapstage.*` paint + terrain exaggeration + layer visibility from the export.
3. Apply `css.*` as the DOM filter / tint / vignette stack around the map canvas (same semantics as tuner).
4. Set initial camera from `camera` via `jumpTo` (no `easeTo` / `flyTo` on record path).
5. Load settlement data (`cities.dataFile` or your production sites JSON) with `HanCity3D` tiers.
6. Wait for `idle` (and tile readiness) before capturing frames.
7. Keep the tuner as a design tool only — **do not** host the final render there.

See [`tested-config.md`](tested-config.md) for layer order and Terrarium encoding.
