# Tested config · Mapterhorn + OpenFreeMap

Production-proven stack for the antique parchment look. No project-specific paths.

## Sources

### Satellite / raster basemap

- Type: `raster` tiles
- **Default public config:** EOX Sentinel-2 cloudless (`s2cloudless-2020`, template `{z}/{y}/{x}`, maxzoom ~14), **enabled**
- Public EOX WMTS typically requires attribution and has use restrictions; for other basemaps use `map-tiles.config.local.js`
- Configure via `tuner/map-tiles.config.js` or gitignored `map-tiles.config.local.js`
- Layer id defaults to `satellite`; paint from preset `mapstage.satellite.*`; visibility from `ui.showSatellite`

### Terrain DEM (Mapterhorn)

- Type: `raster-dem`
- Tiles: `https://tiles.mapterhorn.com/{z}/{x}/{y}.webp` (Terrarium-encoded WebP)
- Mesh `maxzoom` ~17; visual hillshade / color-relief often uses a separate `terrainVisual` source with a lower `visualMaxzoom`
- **Required:** `"encoding": "terrarium"`
- Wire with `map.setTerrain({ source, exaggeration })` using `mapstage.terrainExaggeration` (default `1`)

Wrong or missing `encoding` produces incorrect elevation and broken hillshade.

### Hillshade

- Type: `hillshade` layer on the visual DEM source
- Paint: `exaggeration` (clamp `0…1`), `illumination-direction`, `shadow-color`, `highlight-color`, `accent-color` from preset

### Hypsometric relief

- Type: `color-relief` (`vl-relief`) on the same visual DEM source
- Visibility from `ui.showRelief` (default off)
- Color ramp from `AntiqueVectorPaint.elevationColorExpr()`

### Water (OpenFreeMap / OpenMapTiles)

- Vector source: `https://tiles.openfreemap.org/planet`
- Layers: `omt-ocean` (`water` class ocean), `omt-water` (other water), `omt-waterway`
- Always on in the public tuner. Not gated by `ui.showWater`.
- Keep OpenFreeMap / OSM attribution.

The old GeoJSON overlay (`CHINA_WATER_DATA` / `water-data.js`) is **not** shipped. See [`water-overlay.md`](water-overlay.md).

### Isolate

- `isolate.enabled` + `isolate.regionId` (default `china`)
- Map projection: clipped terrain island. Globe: parchment mask.
- Silhouettes are narrative, not official borders. See root `DATA-PROVENANCE.md`.

## Layer order (bottom → top)

1. `background` (`mapstage.backgroundColor`)
2. Color-relief (when `ui.showRelief`)
3. Hillshade (when terrain enabled)
4. Satellite / raster basemap (when configured and `ui.showSatellite`)
5. OpenFreeMap ocean → inland water → waterway
6. Isolate island / mask (when `isolate.enabled`)
7. City fill-extrusion / custom 3D + HTML labels

CSS antique filter + warm tint + vignette sit **outside** MapStage paint (DOM overlay on the canvas wrapper), gated by `ui.showCssFilter`.

## Camera & tile readiness

For recorded / HyperFrames frames:

1. Set camera with **`jumpTo`** (or initial `center` / `zoom` / `pitch` / `bearing`).
2. Set projection from `ui.projection` (`mercator` vs `globe`) **before** capture.
3. Await map **`idle`** (and optionally `sourcedata` / custom tile wait) before capture.
4. Optionally pre-cache the viewport after `jumpTo` so basemap + DEM tiles are warm.

**Avoid `easeTo` / `flyTo`** on the production path — animation timing is non-deterministic across machines and pollutes frame capture.

## Checklist

- [ ] Terrain source has `encoding: 'terrarium'`
- [ ] DEM is Mapterhorn (or another Terrarium DEM you are allowed to use)
- [ ] Terrain exaggeration applied from preset
- [ ] Basemap tiles (if any) come from a configured, authorized endpoint
- [ ] `ui.projection` / `ui.showSatellite` / `ui.showRelief` / `isolate` applied
- [ ] Layer order matches table above
- [ ] Production camera uses `jumpTo` + `idle`
- [ ] Final render host ≠ tuner page
