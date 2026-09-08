# Tuner · MapStage

Live CSS / paint tuner for **MapStage**.

## Start

Public demo (no local server): [https://hopechen067.github.io/MapStage/](https://hopechen067.github.io/MapStage/)

To preview on your own computer, start a local HTTP server in this folder, then open the local URL printed in the terminal:

```bash
cd mapstage/tuner
python -m http.server
```

Merged map (`index.html`): 地图 / 地球 · 卫星图 · 海拔设色 · 拆出. OpenFreeMap vector water is built-in (no GeoJSON overlay panel).

HTTP (or localhost) only — do not use `file://`.

## Tile config

| File | Role |
|------|------|
| `map-tiles.config.js` | Default public config (**satellite on**, Mapterhorn DEM on) |
| `map-tiles.config.example.js` | Documented template |
| `map-tiles.config.local.js` | Optional personal overrides (**gitignored**) |

Enable a raster basemap only with tile URLs you are allowed to use. See repo root `NOTICE.md`.

## Verify assets

```bash
node verify.mjs
```

Checks for `index.html`, tile config, city assets, default v3 presets, and 地图/地球 + 拆出 + 海拔设色.

## Defaults

- Preset: `preset-antique-default.json` (copy: `presets/antique-default.json`), **version 3**
- Sites: `assets/sample-sites.json`
- Water: OpenFreeMap / OpenMapTiles vector layers
- Public demo: GitHub Pages publishes this `tuner/` folder to the site root (`assets/…` paths stay relative)

Export JSON, then migrate into your MapStage host. Do not host final renders on this page.
