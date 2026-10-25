# Data provenance

## Water and roads

Water and roads are drawn from the OpenFreeMap vector tiles (OpenMapTiles schema, © OpenMapTiles, © OpenStreetMap contributors, ODbL). No hydrography file is stored in this repository. The former optional `water-data.js` pack (graded rivers, lakes, highlight systems) had no cleared upstream license and was removed; see [references/water-overlay.md](mapstage/references/water-overlay.md).

## Region isolate (`REGION_ISOLATE_DATA`)

| Path | Role |
|------|------|
| `mapstage/tuner/assets/region-isolate-data.js` | Demo region catalog (`window.REGION_ISOLATE_DATA`) |
| `mapstage/tuner/assets/region-isolate.js` | Mask builder (`window.REGION_ISOLATE`) |
| `mapstage/tuner/scripts/build-region-isolate.mjs` | Rebuilds the base catalog (Natural Earth China placeholder + OSM provinces/cities). Run `patch-china-boundaries.mjs` afterwards to restore the complete-territory `china` / `xizang` |
| `mapstage/tuner/scripts/patch-china-boundaries.mjs` | Replaces `china` and `xizang` with the national-atlas silhouette (Zangnan, Taiwan, Diaoyu, SCS islands, ten-dash line) |
| `mapstage/tuner/scripts/patch-maritime-islands.mjs` | Builds the `haiyu` group and island-group modules (dongsha / xisha / zhongsha / huangyan / nansha / zengmu / diaoyu) |

### What it is

A **narrative silhouette** used to hide worldwide hillshade/satellite outside a polygon. It is **not** an official national boundary.

The bundled `china` nation silhouette is built from Natural Earth only (public domain): land and coastline come from 10m admin-0 "China POV" (`ne_10m_admin_0_countries_chn.geojson`; includes Zangnan, Taiwan, Hong Kong, Macao), Diaoyu and Huangyan islets from `ne_10m_minor_islands`, and the ten-dash line from `ne_10m_admin_0_boundary_lines_maritime_indicator_chn`. Dongsha, Zhongsha and Zengmu Ansha have no Natural Earth polygon (atoll / submerged bank); they are small schematic markers at their published coordinates. `xizang` is the Natural Earth admin-1 Xizang shape plus the PRC land (China POV) south of it, so Tibet includes Zangnan (藏南); `zangnan` is that southern extent alone. Result: full PRC land extent including Zangnan, Taiwan / Hong Kong / Macao, Diaoyu, and South China Sea island groups, plus the ten-dash maritime line (`maritimeLines`). Features carry `keepMaritimeIslands` / `completeTerritory`, so `narrativeFeature` keeps islets down to ~1e-6 deg² instead of the 1 deg² cut. It is a **narrative** complete-territory outline for isolate / terrain-island demos — not an official survey product.

Rebuild with `node mapstage/tuner/scripts/patch-china-boundaries.mjs <dir>` where `<dir>` holds the four Natural Earth GeoJSON files named in the script header (then `patch-maritime-islands.mjs`). It needs the dev-only `polygon-clipping` package: `npm i polygon-clipping` in a scratch dir and set `POLYGON_CLIPPING_DIR` (default `out/geotool`).

The 34 provincial-level isolate modules (22 provinces, 5 autonomous regions, 4 municipalities, Hong Kong, Macao, Taiwan) plus curated city extra `zhangye` are simplified OpenStreetMap administrative polygons (ODbL), except `xizang`, which is patched from the same atlas so Tibet includes Zangnan. Province relation IDs live in `tuner/scripts/province-catalog.mjs` (Gansu remains [153314](https://www.openstreetmap.org/relation/153314); Zhangye [165803](https://www.openstreetmap.org/relation/165803)).

The **336 prefecture-level city modules** (`c<relation id>`) were auto-fetched by `tuner/scripts/fetch-city-catalog.mjs`: Overpass query `admin_level=5` within China area 270056, polygons simplified from `polygons.openstreetmap.fr`, each assigned to its province by vertex-containment. Regenerate via `fetch-city-catalog.mjs` + `build-region-isolate.mjs` (raw downloads cache under `tuner/scripts/_ne_cache`, gitignored). All are narrative silhouettes, not official borders.

### License status

The China / Tibet / maritime silhouettes were rebuilt from Natural Earth only (2026-10-25); no geojson.cn data remains in `region-isolate-data.js`. The earlier geojson.cn (`100000.json`) version had no stated reuse or redistribution terms and may still exist in git history, including the public repository's history (see the 2026-10-23 review in [compliance.md](mapstage/references/compliance.md)). Natural Earth land / coast is public domain. Polar ice remains Natural Earth (public domain). OSM extracts are © OpenStreetMap contributors, [ODbL 1.0](https://www.openstreetmap.org/copyright). The generated JS silhouettes are for narrative isolate masks, not official boundaries. Rebuild:

```bash
cd mapstage/tuner
node scripts/build-region-isolate.mjs
```

## South China Sea ten-dash line

`TEN_DASH` in `mapstage/tuner/assets/mapstage-story.js` (drawn on full-China shots): dashes 2–10 are Natural Earth 10m admin-0 maritime indicator, China POV (`ne_10m_admin_0_boundary_lines_maritime_indicator_chn`, public domain; start / mid / end point of each dash). Natural Earth has no dash east of Taiwan, so that one is hand-placed after the 2013 standard map. Schematic, not a survey product. The `china.maritimeLines` copy inside `region-isolate-data.js` (from geojson.cn) is not used for rendering.

## Sample settlements

`tuner/assets/sample-sites.json` — synthetic demo points only (no real administrative claims). MIT with the rest of the project code/docs.

## Night lights

`mapstage/tuner/assets/night-lights.png` — simulated night lights for China and its neighbours (bounds 60°E–150°E, 2°S–56°N, Web Mercator z6). It is **not** satellite night imagery: `mapstage/tuner/scripts/bake-night-lights.mjs` derives it from GeoNames populated places (`CN`, `TW`, `HK`, `MO` country dumps plus `cities500` for neighbours), weighting settlements by population and blurring them into glow. GeoNames data is CC BY 4.0 (https://www.geonames.org/); attribution is shown in the Studio attribution strip. Optional alternatives (NASA city lights / GIBS VIIRS Black Marble) are configured in `map-tiles.config.js` and not shipped.

## Tiles

Satellite and DEM tiles are **not** shipped as files. See `tuner/map-tiles.config.example.js` and NOTICE.md.
