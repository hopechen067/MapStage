# Water · public tuner vs optional overlay

## Public tuner (what GitHub Pages ships)

Demo water is **OpenFreeMap / OpenMapTiles** vector layers:

- source: `https://tiles.openfreemap.org/planet`
- `omt-ocean` / `omt-water` (`source-layer: water`)
- `omt-waterway` (`source-layer: waterway`)

These layers are always on. They are **not** driven by `mapstage.water.*` paint keys. Keep OpenFreeMap / OSM attribution.

This repository does **not** ship a China hydrography GeoJSON pack. GitHub Pages must not publish `water-data.js` / `water-manifest.json`. `tuner/assets/water-pack.json` stays `"enabled": false`.

## Optional local overlay (not in the public demo)

The tuner still understands `window.CHINA_WATER_DATA` if you supply a local pack under a license you control. The homepage has **no** overlay UI; export forces `ui.showWater` / `ui.showHighlight` to `false`.

If you enable it locally:

1. Place gitignored `tuner/assets/water-data.js` assigning `window.CHINA_WATER_DATA`.
2. Set `"enabled": true` in `tuner/assets/water-pack.json` (do not commit that for the public tree).
3. FeatureCollections: `riverLevel1` / `riverLevel2` / `riverLevel3` / `chinaLakes` / `highlightWaterSystems`.
4. Paint keys live under `mapstage.water` (see [`参数列表说明.md`](参数列表说明.md)).

**License:** this project does not ship or MIT-license a water pack. See root [`DATA-PROVENANCE.md`](../../DATA-PROVENANCE.md).
