# Region isolate · 局部拆出

Hide everything **outside** a polygon (country, corridor, province) with a parchment fill. Hillshade and satellite are worldwide rasters and cannot be `setFilter`’d by country — this layer is a **tiled world mask**: 8° solids far away, 1° solids near the region, and **hole-free trapezoids** on cells that intersect the silhouette (horizontal scanline of cell minus the clipped outline). Slab height and trap width **scale with the region bbox** (a 2° city uses ~0.008° slabs; China stays at the 0.04° / 0.12° cap) so pitched 3D views do not turn the cut into 4 km stairs or stretched 烂面. Adjacent traps overlap by a few hundred metres; the GeoJSON source uses `tolerance: 0` so MapLibre does not re-simplify those seams; a background-colored `region-edge-seal` line hides the remaining drape fringe. Large hole-fills or large concave rings on 3D terrain tear; a centroid grid makes a mosaic edge.

This is a **narrative silhouette**, not an official boundary.

## Data object

Global: `window.REGION_ISOLATE_DATA` from [`tuner/assets/region-isolate-data.js`](../tuner/assets/region-isolate-data.js).

Helpers: `window.REGION_ISOLATE` from [`tuner/assets/region-isolate.js`](../tuner/assets/region-isolate.js).

```js
window.REGION_ISOLATE_DATA = {
  version: 1,
  defaultId: 'china',
  regions: [
    {
      id: 'china',
      label: '中国',
      attribution: 'Natural Earth 10m China POV (public domain). …',
      feature: { type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: [/* … */] } }
    }
  ]
};
```

`null` / missing file: tuner shows a warning; **粘贴轮廓** still accepts GeoJSON.

Rebuild China (Natural Earth), 34 provinces, and the prefecture-city catalog:

```bash
cd mapstage/tuner
node scripts/fetch-city-catalog.mjs    # Overpass admin_level=5 → scripts/city-catalog.mjs
node scripts/build-region-isolate.mjs  # NE + OSM polygons → assets/region-isolate-data.js (~1.9 MB)
```

Catalog ids: `china`, 34 provinces (`beijing` … `taiwan`), and **336 prefecture-level divisions** (`c<OSM relation id>`, auto-fetched, parent-assigned by vertex-containment against province polygons; `zhangye` stays curated). Raw downloads cache under `scripts/_ne_cache` (gitignored) — reruns retry only failures. Province / city outlines are simplified OSM administrative boundaries used as isolate holes — not official legal borders. At isolate time, province/city rings smaller than 2% of the largest part are dropped so coastal OSM specks (Beijing/Tianjin fragments, tiny islets) do not become detached 3D blobs. Nation-scale China keeps rings ≥ 1 sq deg so **Hainan and Taiwan stay on the silhouette**; a feature with `properties.keepMaritimeIslands` / `completeTerritory` (the bundled `china`, `xizang`, `haiyu`) skips that cut and keeps Zangnan, Diaoyu and South China Sea islets. After `build-region-isolate.mjs`, run `patch-china-boundaries.mjs` and `patch-maritime-islands.mjs` to restore the complete-territory outline.

See root [`DATA-PROVENANCE.md`](../../DATA-PROVENANCE.md).

## Layer order

Insert **after** hillshade / optional satellite, **before** water and cities:

1. `background`
2. `hillshade`
3. optional `satellite`
4. **`region-mask-fill`** (world − region holes, `fill-color` = `mapstage.backgroundColor`)
5. **`region-outline`** (optional decorative line on the region)
6. lakes / rivers
7. city extrusions

## Preset fields

| Field | Default | Notes |
|-------|---------|--------|
| `ui.showRegionIsolate` | `false` | Off keeps existing Hexi / national looks |
| `ui.regionIsolateId` | `"china"` | Catalog id, or `"custom"` after paste |

## Terrain

Map projection isolate (**独立地形块**, tuner `vendor/maplibre-gl.js` patched 5.6.0): **one terrain mesh**. Inside-rim vertices snap XY onto the clip 0.5 contour (province silhouette). Outside-rim vertices snap just short of 0.5 (`land=lo-0.12`) and drop in Z — including stitch skirts — so mixed triangles stay a thin vertical wall instead of a cell-wide ramp or a hole at every DEM tile edge. When the axis gradient is degenerate (diagonal coasts) the snap walks the first 8-connected sample that crosses 0.5. Fully-outside floor discards. No second custom wall. Surround is dark void. Globe isolate still uses the parchment world mask. Keep `setTerrainEx` on. Frame with `AntiqueMapFx.reliefCameraForFeature`. Do **not** call `setTerrain(null)` merely because isolate is on.

Rebuild the patched MapLibre bundle from the unminified 5.6.0-dev download:

```bash
# place maplibre-gl-dev.js at mapstage/.cache/maplibre/maplibre-gl-dev.js
node tuner/scripts/patch-maplibre-terrain-clip.mjs
```

## Tuner

- **拆出** — toggle. Map projection uses the independent terrain clip and **does not** `setData` the tiled parchment mask (that GeoJSON freezes the main thread). Globe still builds the cheap simple mask.
- region `<select>` — optgroups per province (`甘肃（全省）` + its cities); `ui.regionIsolateId` takes province ids or city ids (`c<relId>`)
- province chip row — 全国 + 34 省; selecting a province (or one of its cities) reveals a per-province **市级 chip row**
- **粘贴轮廓** — clipboard GeoJSON: `Polygon` / `MultiPolygon` / `Feature` / `FeatureCollection` (first polygon). In-memory only (`id: custom`)
- **选中即飞**:every region change (chip / select / paste / toggling 拆出 on) eases the camera to the target — `reliefCameraForFeature` for provinces/cities/custom, `VIEW_CHINA` for `china`. Page-load preset restore does not move the camera.

## HyperFrames / production recipe

Do **not** render finals on the tuner. On a patched MapLibre (`__ANTIQUE_TERRAIN_CLIP_PATCH`), map-projection isolate should clip the terrain mesh (`AntiqueTerrainIsland.setClip`) and **must not** `setData` `buildMaskGeoJSON` — that tiled trapezoid collection freezes the main thread. Globe / unpatched hosts still use the parchment fill below.

Copy this into the production MapLibre style after satellite **only when you are on the parchment-mask path** (globe, or unpatched MapLibre):

```js
map.addSource('region-mask', {
  type: 'geojson',
  data: maskFeature,
  tolerance: 0,
  buffer: 256,
});
map.addSource('region-outline', {
  type: 'geojson',
  data: regionFeature,
  tolerance: 0,
  buffer: 256,
});
map.addLayer({
  id: 'region-mask-fill',
  type: 'fill',
  source: 'region-mask',
  paint: {
    'fill-color': preset.mapstage.backgroundColor,
    'fill-outline-color': preset.mapstage.backgroundColor,
    'fill-opacity': 1,
  },
});
map.addLayer({
  id: 'region-edge-seal',
  type: 'line',
  source: 'region-outline',
  layout: { 'line-join': 'round', 'line-cap': 'round' },
  paint: {
    'line-color': preset.mapstage.backgroundColor,
    'line-width': 5.5,
  },
});
map.addLayer({
  id: 'region-outline',
  type: 'line',
  source: 'region-outline',
  paint: { 'line-color': 'rgba(72, 58, 42, 0.5)', 'line-width': 1.15 },
});
if (preset.ui.showRegionIsolate) {
  fx.setTerrainEx(map, 'terrain', preset.mapstage.terrainExaggeration, { budget: false });
  var cam = fx.reliefCameraForFeature(map, regionFeature);
  if (cam) fx.jumpTo(map, cam);
}
```

`regionFeature` = `REGION_ISOLATE.narrativeFeature(raw)` (drops OSM speck rings). `maskFeature` = `REGION_ISOLATE.buildMaskGeoJSON(regionFeature)`. Camera: `jumpTo` + `idle`.

Swap the polygon for Hexi, a province, or a dynasty extent — the engine does not hard-code which islands or lines belong on the silhouette.

## Water per region (v2)

Selecting a **province / city / custom** polygon (anything but `china`) re-sets every water source to `REGION_ISOLATE.filterCollection(raw, feature)` — rivers are line-clipped at the boundary, lakes keep whole polygons with a vertex hit, and the river-name catalog is rebuilt from the **clipped** layers (`buildRegionRiverLabels`: top trunk names at overview zoom, L2 tributary names from zoom ~9.5). Switching back to `china` / isolate-off restores the full datasets and the national label catalog.

Performance: `filterCollection` bbox-prefilters features and uses a y-slab edge index, so a full-China clip lands in tens of ms; the tuner additionally caches clipped collections per region id (revisits ≈ 10 ms). First clip of a corridor province (Gansu, Neimenggu) is the slowest at a few hundred ms on low-end hardware.

The parchment mask still restacks **above** water (`restackIsolateAboveOverlays`), so any boundary-crossing residue stays hidden; the clip keeps the data honest inside the hole.

## Limits (v2)

- City layers are not point-in-polygon clipped; HTML river/lake/city labels filter by anchor point (`isolateKeepsPoint`) instead.
- Not used on the hand-drawn China image skill (that base has no neighbors).
