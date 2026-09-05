# Tuner · MapStage

Live CSS / paint tuner for **MapStage**.

## Start

```bash
cd mapstage/tuner
python -m http.server 8765
```

Open [http://localhost:8765/](http://localhost:8765/) for the merged map (`index.html`): 地图（卫星 + 城池）/ 地球（海拔设色 + 拆出）. No water overlay.

HTTP (or localhost) only — do not use `file://`.

## Tile config

| File | Role |
|------|------|
| `map-tiles.config.js` | Default public config (**satellite off**, Terrarium on) |
| `map-tiles.config.example.js` | Documented template |
| `map-tiles.config.local.js` | Optional personal overrides (**gitignored**) |

Enable a raster basemap only with tile URLs you are allowed to use. See repo root `NOTICE.md`.

## Verify assets

```bash
node verify.mjs
```

Checks for `index.html`, tile config, city assets, and default presets.

## Defaults

- Preset: `preset-antique-default.json` (copy: `presets/antique-default.json`)
- Sites: `assets/sample-sites.json`
- Water: OpenFreeMap / OpenMapTiles vector layers
- Public demo: GitHub Pages publishes this `tuner/` folder to the site root (`assets/…` paths stay relative)

Export JSON, then migrate into your MapLibre host. Do not host final renders on this page.
