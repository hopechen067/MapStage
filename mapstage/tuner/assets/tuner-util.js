/**
 * Tuner pure helpers: clone, clamp/round, colour parsing, dotted-path
 * get/set, number formatting. No DOM, no map state.
 *
 * Browser: window.AntiqueTunerUtil
 * Node:    module.exports
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) root.AntiqueTunerUtil = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function deepClone(o) {
    return JSON.parse(JSON.stringify(o));
  }

  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  function round(v, d) {
    const p = Math.pow(10, d == null ? 2 : d);
    return Math.round(v * p) / p;
  }

  /** 解析 rgba()/#hex → { hex, a } */
  function parseColor(str) {
    if (!str) return { hex: '#000000', a: 1 };
    str = String(str).trim();
    const rgba = str.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/i);
    if (rgba) {
      const r = clamp(Math.round(+rgba[1]), 0, 255);
      const g = clamp(Math.round(+rgba[2]), 0, 255);
      const b = clamp(Math.round(+rgba[3]), 0, 255);
      const a = rgba[4] != null ? clamp(+rgba[4], 0, 1) : 1;
      return {
        hex: '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join(''),
        a: round(a, 3),
      };
    }
    let hex = str;
    if (/^#[0-9a-f]{3}$/i.test(hex)) {
      hex = '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
    }
    if (!/^#[0-9a-f]{6}$/i.test(hex)) hex = '#000000';
    return { hex: hex.toLowerCase(), a: 1 };
  }

  function toRgba(hex, a) {
    const c = parseColor(hex);
    const r = parseInt(c.hex.slice(1, 3), 16);
    const g = parseInt(c.hex.slice(3, 5), 16);
    const b = parseInt(c.hex.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + round(a, 3) + ')';
  }

  function hexToRgb(hex) {
    const c = parseColor(hex);
    return {
      r: parseInt(c.hex.slice(1, 3), 16),
      g: parseInt(c.hex.slice(3, 5), 16),
      b: parseInt(c.hex.slice(5, 7), 16),
    };
  }

  /** 路径读写 params 对象 */
  function getByPath(obj, path) {
    // 特殊：相机中心拆成 centerLng / centerLat
    if (path === 'camera.centerLng') return obj.camera.center[0];
    if (path === 'camera.centerLat') return obj.camera.center[1];
    if (path === 'camera.zoom') return obj.camera.zoom;
    if (path === 'camera.pitch') return obj.camera.pitch;
    if (path === 'camera.bearing') return obj.camera.bearing;

    if (path === 'backgroundColor') return obj.maplibre.backgroundColor;
    if (path === 'terrainExaggeration') return obj.maplibre.terrainExaggeration;

    const parts = path.split('.');
    if (parts[0] === 'satellite') return obj.maplibre.satellite[parts[1]];
    if (parts[0] === 'hillshade') return obj.maplibre.hillshade[parts[1]];
    if (parts[0] === 'water') return obj.maplibre.water[parts[1]];
    if (parts[0] === 'css') return obj.css[parts[1]];
    if (parts[0] === 'ui') return obj.ui[parts[1]];
    return undefined;
  }

  function setByPath(obj, path, value) {
    if (path === 'camera.centerLng') {
      obj.camera.center[0] = value;
      return;
    }
    if (path === 'camera.centerLat') {
      obj.camera.center[1] = value;
      return;
    }
    if (path === 'camera.zoom') {
      obj.camera.zoom = value;
      return;
    }
    if (path === 'camera.pitch') {
      obj.camera.pitch = value;
      return;
    }
    if (path === 'camera.bearing') {
      obj.camera.bearing = value;
      return;
    }
    if (path === 'backgroundColor') {
      obj.maplibre.backgroundColor = value;
      return;
    }
    if (path === 'terrainExaggeration') {
      obj.maplibre.terrainExaggeration = value;
      return;
    }

    const parts = path.split('.');
    if (parts[0] === 'satellite') obj.maplibre.satellite[parts[1]] = value;
    else if (parts[0] === 'hillshade') obj.maplibre.hillshade[parts[1]] = value;
    else if (parts[0] === 'water') obj.maplibre.water[parts[1]] = value;
    else if (parts[0] === 'css') obj.css[parts[1]] = value;
    else if (parts[0] === 'ui') obj.ui[parts[1]] = value;
  }

  function formatNum(v, range) {
    if (range) {
      const step = parseFloat(range.step) || 1;
      if (step >= 1) return String(Math.round(v));
      if (step >= 0.1) return String(round(v, 1));
      return String(round(v, 2));
    }
    return String(round(v, 2));
  }

  return {
    deepClone: deepClone,
    clamp: clamp,
    round: round,
    parseColor: parseColor,
    toRgba: toRgba,
    hexToRgb: hexToRgb,
    getByPath: getByPath,
    setByPath: setByPath,
    formatNum: formatNum,
  };
});
