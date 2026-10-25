# Tuner · antique MapLibre

Live CSS / paint tuner for **MapStage**.

## Start

```bash
cd mapstage/tuner
python -m http.server 8765
```

Open [http://localhost:8765/](http://localhost:8765/).

Layout: top bar (site nav, **地图 | 地球** projection, light/dark, **导出**), scene pills over the map, and a parameter panel on the right that stays open next to the map (it does not cover it; on narrow screens it opens over the map). The panel has five sections reachable from its sticky tabs: 外观 (lighting, theme, satellite, hillshade, CSS grade), 图层 (switches + water colors), 镜头, 拆出 (region chips), 预设 (summary, local cache). Colors are the site's tokens and follow the site's light/dark choice (`localStorage` key `mapstage-site-theme`). `ui.viewMode` is `"map"` or `"globe"`. Recorded HyperFrames shots should stay on map + `jumpTo`.

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

Checks for `index.html`, `hexi-map-shot.html`, `assets/map-fx.js`, tile config, city/isolate assets, and default presets.

Production cut demo (HTTP): [hexi-map-shot.html](./hexi-map-shot.html) — precache then `jumpTo`, no `easeTo`.

## Defaults

- Preset: `preset-antique-default.json` (copy: `presets/antique-default.json`)
- Vector skins: the Studio **风格** tab (skins, elevation ramp, layer colours; switches live in **图层**; `assets/tuner-vector.js`) carries 5 switchable skins, 海拔设色 (20 editable stops), 等高线 and per-layer 图层颜色; `vector-layers.html` stays only as the 6.6 ESM experiment page (no longer in the nav, `?family=` deep links redirect to Studio). Skins (`assets/vector-paint.js` `SKINS`): 宣纸古卷 `parchment` (default) / 陈旧羊皮 `aged` / 墨色山水 `ink` / 绢本重彩 `silk` / 暗夜星图 `night`. Deep link `?family=skin&variant=ink`. Isolate / water / cities stay on `index.html` (patched MapLibre 5.6). A skin = 15 layer colors + CSS grade (sepia/warm-tint/vignette); exported JSON carries `family` + `skin` + `css` alongside `vector`. Terrain slider defaults to **真实海拔 1.0** (Terrarium metres 1:1, `setTerrainEx(..., { budget: false })`); 夸张 1.6 is the antique preset. Use the **祁连** scene (zoom≈10.6 · pitch≈70) to see the mesh — a China overview looks flat even at 1.6.
- Sites: `assets/sample-sites.json`
- Water / roads: OpenFreeMap vector tiles, no local data file (see root `DATA-PROVENANCE.md`)
- Region isolate: `assets/region-isolate.js` + `assets/region-isolate-data.js` (national-atlas China outline incl. Zangnan / islands + OSM silhouettes — `DATA-PROVENANCE.md`)
- Public demo: GitHub Pages publishes this `tuner/` folder to the site root (`assets/…` paths stay relative)

Export JSON, then migrate into HyperFrames. Do not host final renders on this page.
