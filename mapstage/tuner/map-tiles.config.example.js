/**
 * Map tile configuration (EXAMPLE — copy to map-tiles.config.js).
 *
 * Defaults ship EOX Sentinel-2 in map-tiles.config.js. Do not hard-wire
 * vendor endpoints you are not allowed to redistribute.
 *
 * You may only enable satellite tiles if your use is allowed by that provider
 * (official key / contract / self-hosted cache). This project grants no tile license.
 *
 * Optional override file (gitignored): map-tiles.config.local.js
 * loaded after map-tiles.config.js if present — use for personal keys.
 *
 * Optional comparison image for the tuner's「参考图」pip / split view
 * (no image ships with the repo; the UI stays hidden unless this is set):
 *   window.MAPSTAGE_REF_SRC = 'my-reference.jpg';
 *   window.MAPSTAGE_REF_LABEL = '参考图 · 手绘古地图';
 */
window.MAP_TILE_CONFIG = {
  /**
   * Optional raster basemap (satellite or other).
   * Leave tiles empty / enabled:false for terrain + water + CSS-only demo.
   */
  satellite: {
    // OSS default (also in map-tiles.config.js): EOX Sentinel-2 cloudless
    enabled: true,
    tiles: [
      // Note {z}/{y}/{x} order for this WMTS template
      'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg',
    ],
    tileSize: 256,
    maxzoom: 14,
    attribution:
      'Sentinel-2 cloudless © <a href="https://s2maps.eu">EOX</a> · modified Copernicus Sentinel data 2020',
    // Source id used in MapLibre style (keep stable if you migrate presets)
    sourceId: 'basemapRaster',
    layerId: 'satellite',
    // Other basemaps (local only): tiles: ['https://YOUR-HOST/{z}/{x}/{y}.png'],
  },

  /**
   * Terrarium-encoded DEM (required for hillshade + setTerrain).
   * encoding MUST remain 'terrarium'.
   * vector-layers.html can A/B Mapterhorn (CC-BY, commercial OK with
   * attribution) without changing this production default.
   */
  terrain: {
    enabled: true,
    tiles: [
      'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
      'https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png',
    ],
    tileSize: 256,
    maxzoom: 15,
    // Optional: hillshade + color-relief LOD (default 12). Mesh still uses maxzoom.
    // visualMaxzoom: 12,
    encoding: 'terrarium',
    attribution: '© AWS Terrain Tiles (Terrarium)',
    sourceId: 'terrain',
  },

  /** Short label for the on-map attribution strip */
  uiAttribution: '底图：EOX Sentinel-2 cloudless · 地形 DEM：AWS Terrarium',
};
