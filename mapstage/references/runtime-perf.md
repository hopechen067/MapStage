# Runtime performance · terrain / tiles / camera

Use [`tuner/assets/map-fx.js`](../tuner/assets/map-fx.js) — the one copy the tuner, Hexi shot page and production pages all load. Do **not** copy MapLibre defaults from `tuner/index.html`.

`window.AntiqueMapFx` (Node: `require('./map-fx.js')`).

## Modes

| mode | When | Notes |
|------|------|--------|
| `record` | HyperFrames / captured frames | `pixelRatio: 1`, `fadeDuration: 0`, `validateStyle: false` |
| `tuner` | Live sliders | Same tile cache / no expired refresh; keep 300ms label fade |

Shared: `maxTileCacheZoomLevels: 12`, `refreshExpiredTiles: false`, `cancelPendingTileRequestsWhileZooming: true`, `renderWorldCopies: false`, `raster-fade-duration: 0` on raster layers, `powerPreference: 'high-performance'`. Before `new Map()`, `setMaxParallelImageRequests(32)` (satellite + shared Terrarium DEM: one source for terrain + hillshade) and `setWorkerCount` 2–6 (0.75 × cores, cap 6 — big GeoJSON water parses in the worker pool). Tuner: debounce `localStorage` persist, coalesce paint updates on rAF, hide HTML river/lake labels while `.antique-lod-labels` (idle look unchanged).

Boot speed (tuner): water and roads are vector tiles, so there is no large hydrography file to parse at boot. Tile hosts get dynamic `<link rel="preconnect">` injected from the resolved `MAP_TILE_CONFIG` at boot (works for EOX / Gaode / local overrides alike).

## Hard rules

- **Recorded camera:** `AntiqueMapFx.jumpTo` then `waitIdle`. Never `easeTo` / `flyTo` on the capture path.
- **Optional fly:** only after `precacheViewports` (and `samplePath` for interpolated legs). GSAP `onUpdate` may call `jumpTo` (seek-safe). Tuner interactive `easeTo` must `map.stop()` first — `easeToCamera` does this.
- **Terrain:** `encoding: 'terrarium'`. Mutate exaggeration with `setTerrainEx` / `terrainRise` / `flattenTerrain`. **Never** call `setTerrain` from a generic paint update.
- **LOD budget** (`budgetTerrainEx`): zoom &lt; 6 → cap 1.6; zoom ≥ 6 → cap 1.2; zoom ≥ 8 **or** pitch ≥ 50 → cap 0.8. **Record path only.** Tuner slider / `terrainRise({ budget: false })` apply the requested value so close-up bulge still works.
- **Rise FX:** `terrainRise` is clock-paced (`waitPaint` = timeout + `triggerRepaint`). Do **not** wait on MapLibre `render` or `waitIdle` before a close-up rise — DEM tiles at zoom 11 stall those waits and leave exaggeration at ~0.1. Tuner: `waitIdle: false`, then `setTerrainEx(target)` when the rise promise settles. Pass `budget: false` or close-up LOD will cap at 0.8. Every step calls `setTerrain` (full terrain re-mesh); pass `maxSteps` (tuner uses 10) to cut mesh recomputes within the same duration, and throttle per-step DOM/city-reposition work — final step snaps exact.
- **Visible mesh:** MapLibre's own 3D example is zoom ~12 / pitch ~70 / `maxPitch: 85` / `style.terrain` + `style.sky` at `new Map()`. A China overview at pitch 28 looks like a tilted photo even when `getTerrain()` is 1.6. Tuner **地形隆起** flies to the Qilian front (`VIEW_RELIEF`) then raises exaggeration.
- **Tiles:** `precacheViewports(map, cameras)` before `timeline.play`. `waitIdle` times out (default 12s) instead of hanging.
- **Motion LOD:** hide `river-l3`; do not rebuild HTML river/lake markers until `moveend`.
- **Cities:** prefer `fill-extrusion`. Custom Three.js layer: `setContinuousRepaint(true)` only while the camera moves; one `triggerRepaint` after idle.
- **CSS sepia** on the whole WebGL canvas has a GPU tax. Keep it for the look; do not treat it as terrain.

## Production sequence

```js
var fx = window.AntiqueMapFx;
var map = fx.createMap(maplibregl, {
  container: 'map',
  style: style,
  camera: SHOTS[0],
  mode: 'record',
  maxPitch: 85,
  terrain: { sourceId: 'terrain', exaggeration: preset.mapstage.terrainExaggeration },
});
map.on('load', function () {
  fx.setTerrainEx(map, 'terrain', preset.mapstage.terrainExaggeration, { budget: false });
  fx.precacheViewports(map, SHOTS).then(function () {
    return fx.terrainRise(map, {
      sourceId: 'terrain',
      from: 0.4,
      to: preset.mapstage.terrainExaggeration,
      durationMs: 1800,
      waitIdle: false,
      budget: false,
    });
  }).then(function () {
    var tl = gsap.timeline({ paused: true });
    SHOTS.forEach(function (shot, i) {
      tl.call(function () {
        fx.jumpTo(map, shot);
      }, null, i * 3.6);
    });
    window.__timelines = window.__timelines || {};
    window.__timelines['hexi-map-shot'] = tl;
    if (!window.__hyperframes) tl.play();
  });
});
```

Worked example: [`tuner/hexi-map-shot.html`](../tuner/hexi-map-shot.html) (serve the tuner folder over HTTP).

## Verify

```bash
node mapstage/tuner/assets/map-fx.test.mjs
cd mapstage/tuner && node verify.mjs
```
