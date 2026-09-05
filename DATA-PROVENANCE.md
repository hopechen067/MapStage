# Data provenance

## Water overlay (`CHINA_WATER_DATA`) — not redistributed

This repository **does not ship** a China water / hydrography GeoJSON pack. This public repository and GitHub Pages must not publish `water-data.js` again.

| Path | Role |
|------|------|
| `china-antique-maplibre/tuner/assets/water-pack.json` | Shipped tiny flag (`enabled: false` by default). Set `enabled: true` only when you have a local pack |
| `china-antique-maplibre/tuner/assets/water-data.js` | **Optional, local only** — assigns `window.CHINA_WATER_DATA` (gitignored) |
| `china-antique-maplibre/tuner/assets/water-manifest.json` | Optional local metadata for your own pack (gitignored; not required by the loader) |

### Why nothing is bundled

A previous full-China rivers/lakes dump was removed from the public tree because upstream name, version, download URL, and redistributable license were **not fully documented**. Prefer safety over shipping a convenience demo layer: we do not redistribute that pack under MIT or otherwise.

### Expected schema (bring your own)

If you supply data, match the keys documented in [`china-antique-maplibre/references/water-overlay.md`](china-antique-maplibre/references/water-overlay.md):

- `riverLevel1` / `riverLevel2` / `riverLevel3` — LineString FeatureCollections  
- `chinaLakes` — Polygon FeatureCollection  
- `highlightWaterSystems` — optional narrative highlight subset  

Export as:

```js
window.CHINA_WATER_DATA = { /* FeatureCollections */ };
```

in `tuner/assets/water-data.js`, set `enabled: true` in `tuner/assets/water-pack.json`, serve the tuner over HTTP, and refresh. The loading UI and MapLibre layer wiring stay in place; with the default `enabled: false` the demo runs basemap + hillshade + CSS only and does not request the large pack.

Suggested open replacements (you must clear licensing yourself): self-derived OSM extracts, Natural Earth where applicable, or other hydrography you are allowed to use.

## Region isolate (`REGION_ISOLATE_DATA`)

Shipped for the globe / vector editor (`tuner/vector-layers.html`). Default isolate is **off**.

| Path | Role |
|------|------|
| `china-antique-maplibre/tuner/assets/region-isolate-data.js` | Demo region catalog (`window.REGION_ISOLATE_DATA`) |
| `china-antique-maplibre/tuner/assets/region-isolate.js` | Mask builder (`window.REGION_ISOLATE`) |

A **narrative silhouette** used to hide worldwide terrain outside a polygon. It is **not** an official national boundary.

The bundled `china` region is a simplified union of Natural Earth 50m admin-0 features `CHN`, `TWN`, `HKG`, and `MAC` (public domain). Tiny islets below the builder’s area threshold are dropped.

Provincial-level isolate modules plus curated city extras are simplified OpenStreetMap administrative polygons (ODbL). All are narrative silhouettes, not official borders.

Natural Earth is public domain. OSM extracts are © OpenStreetMap contributors, [ODbL 1.0](https://www.openstreetmap.org/copyright).

## Polar ice overlay

| Path | Role |
|------|------|
| `china-antique-maplibre/tuner/assets/polar-ice.geojson` | Tiny Antarctica / Greenland ice fill for globe poles |

Simplified from Natural Earth 50m admin-0 (`ATA`, `GRL`). Public domain. Used so polar DEM holes are not painted as tidal flat.

## Far landcover packs (optional)

| Path | Role |
|------|------|
| `china-antique-maplibre/tuner/assets/landcover-lowzoom.geojson` | Optional z0–z6 landcover (`farLandcover: 'full'`) |
| `china-antique-maplibre/tuner/assets/landcover-globe.geojson` | Simplified globe-safe subset |

Live globe / map editor default is `farLandcover: 'none'` (color-relief instead). Packs are © OpenStreetMap / [Protomaps](https://protomaps.com) landcover extracts — keep OSM attribution if you enable them.

## Sample settlements

`tuner/assets/sample-sites.json` — synthetic demo points only (no real administrative claims). MIT with the rest of the project code/docs.

## Tiles

Satellite and DEM tiles are **not** shipped as files. See `tuner/map-tiles.config.example.js` and NOTICE.md.
