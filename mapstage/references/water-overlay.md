# Water overlay · CHINA_WATER_DATA

Optional MapLibre water layers. Hydrography data is **not redistributed** in this repository (license / redistribution risk). The tuner keeps the loader and paint UI so you can supply your own pack locally.

**License:** this project does not ship or MIT-license a water pack. See root [`DATA-PROVENANCE.md`](../../DATA-PROVENANCE.md).

## Data object (user-supplied)

1. Place a local file at `tuner/assets/water-data.js` (gitignored) that assigns:

```js
window.CHINA_WATER_DATA = { /* FeatureCollections */ };
```

2. Set `"enabled": true` in the shipped `tuner/assets/water-pack.json` (default is `false` so the demo never fetches a missing large pack).

Optional local metadata file: `tuner/assets/water-manifest.json` (also gitignored; not required by the loader).

With the default pack flag the demo boots normally: basemap + Terrarium hillshade + antique CSS; water toggles simply have no layers.

### Layers (FeatureCollections)

| Key | Geometry | Role |
|-----|----------|------|
| `riverLevel1` | LineString | Major rivers |
| `riverLevel2` | LineString | Secondary rivers |
| `riverLevel3` | LineString | Minor / screen-level rivers |
| `chinaLakes` | Polygon | Lakes |
| `highlightWaterSystems` | LineString | Narrative highlight subset (alias: legacy `qilianWaterSystems`) |

If you build a highlight subset, document keyword groups yourself (e.g. 黑河, 石羊, 疏勒). Geographic river names in keywords are OK.

## MapLibre paint keys

From preset `maplibre.water`:

- Lakes: `lakeFill`, `lakeOutline`
- Rivers: `riverLevel3` → `riverLevel2` → `riverLevel1` (+ widths)
- Highlight: `highlightRiver`, `highlightWidth`

Visibility:

- `ui.showWater` — all water
- `ui.showHighlight` — highlight systems only (requires water on)

## Label rules

HTML markers (not symbol layers) for river / lake names:

| Class | Rule |
|-------|------|
| Main rivers | Short catalog of trunk names; show from lower zoom (~`3.8`) |
| Tributaries / side | `minZoom` **9.5** (≈ 20 km scale at mid-latitudes) |
| Main lakes | Named anchors (empty `name` polygons matched by centroid); show from ~`3.8` |
| Side lakes | Higher minZoom (~`6.0`); optional |

Implementation notes:

- Prefer main tier first when decluttering.
- Side river labels can respect `showHighlight` when they belong to highlight systems only — keep production rules consistent with the tuner.
- Labels use light text-shadow for readability on parchment; no heavy chips/cards.

## Antique colors (v2 defaults)

Teal parchment water (see preset):

- Lake fill `rgba(50,118,138,0.9)` / outline `rgba(90,110,105,0.8)`
- Rivers L3 / L2 / L1: `rgba(48,112,128,0.55)` → `rgba(45,110,125,0.88)` → `rgba(42,105,120,0.95)`
- Highlight: `rgba(38,100,118,1)`, width `2.4`

Tune live in the tuner when a local pack is present; export JSON for HyperFrames.

## Enabling locally

1. Produce GeoJSON FeatureCollections matching the keys above (use data you may license).
2. Export as `window.CHINA_WATER_DATA = { ... }` in `tuner/assets/water-data.js`.
3. Set `enabled: true` in `tuner/assets/water-pack.json`.
4. Serve `tuner/` over HTTP and refresh — `ensureWaterData()` loads the file when enabled.
5. Run `node verify.mjs` (public default keeps `enabled: false`; validates a local `water-data.js` if present).
