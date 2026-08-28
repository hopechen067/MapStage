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

### Sample settlements

`tuner/assets/sample-sites.json` — synthetic demo points only (no real administrative claims). MIT with the rest of the project code/docs.

## Tiles

Satellite and DEM tiles are **not** shipped as files. See `tuner/map-tiles.config.example.js` and NOTICE.md.
