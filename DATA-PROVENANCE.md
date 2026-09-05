# Data provenance

## Water

Demo water is the built-in **OpenFreeMap / OpenMapTiles** vector layers (`water` / `waterway`). This repository does **not** ship a separate China hydrography GeoJSON pack, and GitHub Pages must not publish `water-data.js`.

## Region isolate (`REGION_ISOLATE_DATA`)

Shipped for the globe / vector editor (`tuner/vector-layers.html`). Default isolate is **off**.

| Path | Role |
|------|------|
| `mapstage/tuner/assets/region-isolate-data.js` | Demo region catalog (`window.REGION_ISOLATE_DATA`) |
| `mapstage/tuner/assets/region-isolate.js` | Mask builder (`window.REGION_ISOLATE`) |

A **narrative silhouette** used to hide worldwide terrain outside a polygon. It is **not** an official national boundary.

The bundled `china` region is a simplified union of Natural Earth 50m admin-0 features `CHN`, `TWN`, `HKG`, and `MAC` (public domain). Tiny islets below the builder’s area threshold are dropped.

Provincial-level isolate modules plus curated city extras are simplified OpenStreetMap administrative polygons (ODbL). All are narrative silhouettes, not official borders.

Natural Earth is public domain. OSM extracts are © OpenStreetMap contributors, [ODbL 1.0](https://www.openstreetmap.org/copyright).

## Polar ice overlay

| Path | Role |
|------|------|
| `mapstage/tuner/assets/polar-ice.geojson` | Tiny Antarctica / Greenland ice fill for globe poles |

Simplified from Natural Earth 50m admin-0 (`ATA`, `GRL`). Public domain. Used so polar DEM holes are not painted as tidal flat.

## Far landcover packs (optional)

| Path | Role |
|------|------|
| `mapstage/tuner/assets/landcover-lowzoom.geojson` | Optional z0–z6 landcover (`farLandcover: 'full'`) |
| `mapstage/tuner/assets/landcover-globe.geojson` | Simplified globe-safe subset |

Live globe / map editor default is `farLandcover: 'none'` (color-relief instead). Packs are © OpenStreetMap / [Protomaps](https://protomaps.com) landcover extracts — keep OSM attribution if you enable them.

## Sample settlements

`tuner/assets/sample-sites.json` — synthetic demo points only (no real administrative claims). MIT with the rest of the project code/docs.

## Tiles

Satellite and DEM tiles are **not** shipped as files. See `tuner/map-tiles.config.example.js` and NOTICE.md.
