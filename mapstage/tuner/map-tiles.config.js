/**
 * Default tile config for the public tuner.
 * Basemap: EOX Sentinel-2 cloudless (public WMTS demo; follow EOX terms).
 * For other basemaps, use map-tiles.config.local.js (gitignored).
 */
window.MAP_TILE_CONFIG = {
  satellite: {
    enabled: true,
    // Note tile template order: {z}/{y}/{x} (not z/x/y)
    tiles: [
      'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg',
    ],
    tileSize: 256,
    maxzoom: 14,
    attribution:
      'Sentinel-2 cloudless © <a href="https://s2maps.eu">EOX</a> · modified Copernicus Sentinel data 2020',
    sourceId: 'basemapRaster',
    layerId: 'satellite',
  },
  terrain: {
    enabled: true,
    tiles: [
      'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
      'https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png',
    ],
    tileSize: 256,
    maxzoom: 15,
    encoding: 'terrarium',
    attribution: '© AWS Terrain Tiles (Terrarium)',
    sourceId: 'terrain',
  },
  // 夜光（「夜景」底图）。默认 = 自制夜光：scripts/bake-night-lights.mjs 用 GeoNames 居民点烘焙的
  // 墨卡托 PNG（assets/night-lights.png，bounds 与脚本一致）。可换成：
  //   NASA 低清城市灯光（等经纬全球图，浏览器里重投影）：
  //     image: 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r160/examples/textures/planets/earth_lights_2048.png',
  //     attribution: 'City lights: NASA Earth Observatory',
  //   NASA GIBS 高清瓦片（公共领域，maxzoom 8）：
  //     tiles: ['https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png'],
  //     attribution: 'VIIRS Black Marble: NASA',
  nightLights: {
    image: 'assets/night-lights.png',
    bounds: [60, -2, 150, 56],
    attribution: 'Night lights simulated from GeoNames (CC BY 4.0)',
  },
  uiAttribution: '底图：EOX Sentinel-2 cloudless · 地形 DEM：AWS Terrarium',
};
