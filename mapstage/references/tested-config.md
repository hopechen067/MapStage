# Tested config · Terrarium + optional basemap

Production-proven stack for the antique parchment look. No project-specific paths.

## Sources

### Satellite / raster basemap

- Type: `raster` tiles
- **Default public config:** EOX Sentinel-2 cloudless (`s2cloudless-2020`, template `{z}/{y}/{x}`, maxzoom ~14)
- Public EOX WMTS typically requires attribution and has use restrictions; for other basemaps use `map-tiles.config.local.js`
- Configure via `tuner/map-tiles.config.js` or gitignored `map-tiles.config.local.js`
- Layer id defaults to `satellite`; paint from preset `maplibre.satellite.*`

### Terrain DEM (AWS Terrarium)

- Type: `raster-dem`
- Tiles: AWS Terrarium terrain-rgb style endpoints (default demo URLs in config)
- **Required:** `"encoding": "terrarium"`
- Wire with `map.setTerrain({ source, exaggeration })` using `maplibre.terrainExaggeration`
- Isolate on: **keep terrain**. Frame with `reliefCameraForFeature`. Do not `setTerrain(null)` for the mask.

Wrong or missing `encoding` produces incorrect elevation and broken hillshade.

### Hillshade

- Type: `hillshade` layer
- **MapLibre ≥ 5.x: share the SAME `raster-dem` source id between `setTerrain` and the hillshade layer** — one SourceCache, every DEM tile downloads once (measured −58% DEM requests on a pitched close-up). The old "second source id" rule applies to older MapLibre only; set `terrain.dualSource: true` in the tile config to restore the dual-source layout if a host shows hillshade artifacts.
- Paint: `exaggeration`, `illumination-direction`, `shadow-color`, `highlight-color`, `accent-color` from preset

### Local tile cache proxy (dev)

`_serve.cjs` serves `/t/<allowlisted-host>/<path>` — first hit forwards upstream and caches to `tuner/_tile_cache/` (gitignored), later hits return from disk with `Cache-Control: max-age=604800`. Point tile URLs at the relative proxy path (port-agnostic) in `map-tiles.config.local.js` for repeat-view tuning; remote/GitHub Pages keeps direct HTTPS URLs.

### Water (optional)

- Layers: lakes fill/outline, river level 3 → 2 → 1, optional highlight systems
- **Not redistributed** in this repository — bring your own data under a license you control; see root `DATA-PROVENANCE.md`

## Layer order (bottom → top)

1. `background` (`maplibre.backgroundColor`)
2. Optional satellite/raster basemap (when configured)
3. Hillshade (when terrain enabled) — **above** satellite so shade is visible; shares the terrain DEM source id (MapLibre ≥ 5.x)
4. Region isolate mask (when `ui.showRegionIsolate`) — world fill with region holes, then optional outline
5. Vector water (lakes, waterway) and roads — OpenFreeMap `vl-*` layers
6. City fill-extrusion / custom 3D + HTML labels

CSS antique filter + warm tint + vignette sit **outside** MapLibre paint (DOM overlay on the canvas wrapper).

## Camera & tile readiness

Use [`tuner/assets/map-fx.js`](../tuner/assets/map-fx.js) (`AntiqueMapFx`). Full contract: [`runtime-perf.md`](runtime-perf.md).

For recorded / HyperFrames frames:

1. `createMap(..., { mode: 'record' })` — `pixelRatio: 1`, `raster-fade-duration: 0`.
2. `precacheViewports(map, shots)` before the timeline plays.
3. Set camera with **`jumpTo`**, then **`waitIdle`** before capture.
4. Terrain exaggeration: `setTerrainEx` / `terrainRise` only (never from a paint loop). Isolate keeps terrain; `reliefCameraForFeature` frames the hole.

**Avoid `easeTo` / `flyTo`** on the production path — animation timing is non-deterministic across machines and pollutes frame capture. Tuner may `easeTo` after `map.stop()`.

## Checklist

- [ ] Terrain source has `encoding: 'terrarium'`
- [ ] Terrain exaggeration applied from preset
- [ ] Basemap tiles (if any) come from a configured, authorized endpoint
- [ ] Layer order matches table above
- [ ] Water visibility respects `ui.showWater`
- [ ] Region isolate (if used) sits after satellite and **keeps** `setTerrain` / `reliefCameraForFeature`
- [ ] Production camera uses `jumpTo` + `waitIdle` (via `AntiqueMapFx`)
- [ ] Viewports precached before recorded motion
- [ ] Final render host ≠ tuner page
