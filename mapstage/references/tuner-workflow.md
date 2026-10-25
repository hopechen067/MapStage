# Tuner workflow

Live parameter page for the antique MapLibre stack.

## Start (HTTP only)

```bash
cd mapstage/tuner
python -m http.server 8765
```

Open `http://localhost:8765/`.

The homepage is a showcase (left scenes, right lighting/theme/view, **地图 | 地球** toggle). Open **调参** for sliders, isolate chips, and JSON export. Recorded shots stay on map projection + `jumpTo`.

Do **not** open `index.html` via `file://` — preset fetch and site JSON will fail. Optional local water packs also need HTTP.

### Tiles

- Default: satellite **off**, Terrarium DEM **on** (`map-tiles.config.js`).
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
| Panel layout | five tabs, one visible at a time: **图层** (all on/off switches: 卫星 / 海拔设色 / 等高线 / 地表分类 / 水系 / 道路 / 高亮水系 / 河湖名 / 城池), **风格** (skin + lighting chips, then an accordion: 卫星 · 山影与地形 · 滤镜 · 海拔色阶 · 地表颜色 · 水系颜色), **镜头**, **拆出**, **预设** (copy / download / paste / reset JSON, reference image, diagnostics). `window.__studioShowTab('isolate')` switches tabs from scripts. |
| Palette data | skins, 海拔设色 (`relief`, 20 elevation stops), 等高线 (`contour`), 地表分类 (`landcover` + 26 layer colors), 设色不透明度. Exported under the `vector` key |
| CSS | sepia, saturate, contrast, brightness, hue, warm tint, vignette |
| UI buttons | `showWater`, `showHighlight`, `showCities`, `showRef` |

`vector` block (all optional, missing = off): `{ relief, reliefOpacity, contour, landcover, paint: {layerColorKey: "#hex"} | null, elevStops: [[metres, "#hex"], …] | null }`. `paint` / `elevStops` are overrides on top of the active skin (`ui.skinId`); switching skin clears `paint`. 海拔设色 needs a DEM and is hidden in globe projection. 区域边界与水体仍由 `water` / isolate 面板负责，图层颜色里不含省界 / 国界。

Camera defaults to China overview `[104.0, 35.5]`, zoom `~4.2`. Use the China / regional view buttons only for framing while tuning.

## Export

1. **复制 JSON** or **下载 JSON**
2. Confirm root shape: `camera`, `maplibre`, `css`, `ui`, `cities`
3. Prefer keys `highlightRiver` / `highlightWidth` / `showHighlight`

## Migrate to HyperFrames

1. Create / open the HyperFrames MapLibre scene.
2. Apply `maplibre.*` paint + terrain exaggeration + layer visibility from the export.
3. Apply `css.*` as the DOM filter / tint / vignette stack around the map canvas (same semantics as tuner).
4. Set initial camera from `camera` via `AntiqueMapFx.jumpTo` (no `easeTo` / `flyTo` on record path).
5. Load settlement data (`cities.dataFile` or your production sites JSON) with `HanCity3D` tiers.
6. `precacheViewports` then `waitIdle` before capturing frames. See [`runtime-perf.md`](runtime-perf.md).
7. Keep the tuner as a design tool only — **do not** host the final render there.

See [`tested-config.md`](tested-config.md) for layer order and Terrarium encoding. Reference cut: [`hexi-map-shot.html`](../tuner/hexi-map-shot.html).
