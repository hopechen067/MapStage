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

Wrong or missing `encoding` produces incorrect elevation and broken hillshade.

### Hillshade

- Type: `hillshade` layer on the Terrarium DEM source
- Paint: `exaggeration`, `illumination-direction`, `shadow-color`, `highlight-color`, `accent-color` from preset

### Water (optional)

- GeoJSON / in-memory FeatureCollections from `CHINA_WATER_DATA` when you supply a local pack (see [`water-overlay.md`](water-overlay.md))
- Layers: lakes fill/outline, river level 3 → 2 → 1, optional highlight systems
- **Not redistributed** in this repository — bring your own data under a license you control; see root `DATA-PROVENANCE.md`

## Layer order (bottom → top)

1. `background` (`maplibre.backgroundColor`)
2. Hillshade (when terrain enabled)
3. Optional satellite/raster basemap (when configured)
4. Lakes fill → lake outline
5. River level 3 → level 2 → level 1
6. Highlight rivers (when `ui.showHighlight`)
7. City fill-extrusion / custom 3D + HTML labels

CSS antique filter + warm tint + vignette sit **outside** MapLibre paint (DOM overlay on the canvas wrapper).

## Camera & tile readiness

For recorded / HyperFrames frames:

1. Set camera with **`jumpTo`** (or initial `center` / `zoom` / `pitch` / `bearing`).
2. Await map **`idle`** (and optionally `sourcedata` / custom tile wait) before capture.
3. Optionally pre-cache the viewport after `jumpTo` so basemap + DEM tiles are warm.

**Avoid `easeTo` / `flyTo`** on the production path — animation timing is non-deterministic across machines and pollutes frame capture.

## Checklist

- [ ] Terrain source has `encoding: 'terrarium'`
- [ ] Terrain exaggeration applied from preset
- [ ] Basemap tiles (if any) come from a configured, authorized endpoint
- [ ] Layer order matches table above
- [ ] Water visibility respects `ui.showWater` / `ui.showHighlight`
- [ ] Production camera uses `jumpTo` + `idle`
- [ ] Final render host ≠ tuner page
