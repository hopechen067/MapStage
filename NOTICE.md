# NOTICE — third-party components and services

This project wires several independent components. Comply with each license
and terms of service for your use case.

## Bundled / loaded at runtime

| Component | Role | Notes |
|-----------|------|--------|
| [MapLibre GL JS](https://maplibre.org/) | Map runtime | Open-source (BSD-style). CSS tuner (`index.html`) loads from unpkg. Globe / vector editor (`vector-layers.html`) uses patched `tuner/vendor/maplibre-gl.js` (5.6.0 + terrain-clip). |
| [maplibre-contour](https://github.com/onthegomap/maplibre-contour) | Optional contour protocol | Used by `vector-layers.html` (`tuner/vendor/maplibre-contour.min.js`). Follow upstream license. |
| [Three.js](https://threejs.org/) | Optional 3D settlement models | MIT. Loaded from unpkg in the CSS tuner demo. |
| `han-city-3d.js` | Settlement extrusion / custom layer | Project code; MIT under root LICENSE. |
| `region-isolate.js` / `region-isolate-data.js` | Region isolate mask | Helper is MIT. `china` (+ patched `xizang`) silhouettes use a Chinese-standard national atlas GeoJSON presentation (complete land incl. Zangnan, islands, ten-dash maritime line). Other provincial / city silhouettes are simplified OSM administrative polygons (ODbL). Narrative use; not official borders. |

## Not bundled — fetched or configured by you

| Resource | Role | Notes |
|----------|------|--------|
| [Mapterhorn](https://mapterhorn.com/attribution) DEM tiles | Hillshade / color-relief / 3D terrain | Default tuner DEM (Terrarium-encoded WebP, CC-BY / equivalent; keep attribution). Public CDN has no SLA. |
| [Mapterhorn](https://mapterhorn.com/attribution) DEM tiles | Globe / vector editor terrain | Default DEM for `vector-layers.html` (CC-BY / equivalent; must keep attribution). Public CDN has no SLA. |
| [OpenFreeMap](https://openfreemap.org) planet tiles | Vector editor overlay | OpenMapTiles schema via `https://tiles.openfreemap.org/planet`. OSM / OpenMapTiles attribution required. |
| Satellite / basemap tiles | Optional raster base | Configure only tile URLs you are allowed to use (official provider key, self-hosted cache, etc.). This repo does **not** grant a map-tile license. |

## Agent skill packaging

`mapstage/` is structured as an agent skill (`SKILL.md` + references).
Cursor / Codex / other hosts are not dependencies of the map stack.

## License scope

- Code & docs: MIT — root [LICENSE](LICENSE)
- Showcase media / third-party services / any user-supplied geodata: [LICENSE-EXCEPTIONS.md](LICENSE-EXCEPTIONS.md)
