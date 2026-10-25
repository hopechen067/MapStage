/**
 * MapStage 站点示例工具包（薄封装）。Story 运行时已正式化为 tuner/assets/mapstage-story.js（window.MapStage），
 * 纯函数从那里取；这里只保留示例页用的零散地图助手（createMap / addRoute / addLabel / exposeSeek …）。规范见 references/story-spec.md。
 * 纯函数部分（几何、进度、取景）Node 可测：stage-kit.test.mjs。
 * 地图部分依赖 window.maplibregl（5.6.0）与 window.AntiqueVectorPaint（studio/assets/vector-paint.js）。
 * Browser: window.MapStageKit   Node: module.exports
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MapStageKit = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  /** 阵营色：长征 / 四渡赤水两期定下的约定，箭头与牌子同色 */
  var SIDE_COLORS = {
    red: '#c0272d',
    enemy: '#5f7182',
    ally: '#7a1430',
    neutral: '#6a5a48',
  };
  // 纯函数已迁入正式运行时 tuner/assets/mapstage-story.js（MapStage），这里只做别名
  var MS = typeof module === 'object' && module.exports ? require('../../tuner/assets/mapstage-story.js') : root.MapStage;
  if (!MS) throw new Error('stage-kit.js 需要先加载 mapstage-story.js（studio/assets/mapstage-story.js）');
  var haversineKm = MS.haversineKm;
  var bearingDeg = MS.bearingDeg;
  var sliceRoute = MS.sliceRoute;
  var arc = MS.arc;
  var bbox = MS.bbox;
  var safePadding = MS.safePadding;
  var smoothstep = MS.smoothstep;
  var cameraAt = MS.cameraAt;
  var SAFE_AREA = MS.SAFE_AREA;

  // ── 地图 ─────────────────────────────────────────────
  function studioUrl(rel) {
    var base = root.MapStageSite ? root.MapStageSite.url('studio/') : 'studio/';
    return new URL(rel, base).href;
  }

  function findSkin(id) {
    var VP = root.AntiqueVectorPaint;
    return VP.SKINS.filter(function (s) { return s.id === id; })[0] || VP.SKINS[0];
  }

  /** 底图样式（Studio 同款，需先加载 studio/assets/tuner-vector.js）：返回 MapStage.resolveLook 的结果，没给 basemap 返回 null */
  function basemapLook(opts) {
    if (!opts || !opts.basemap) return null;
    return MS.resolveLook({}, { look: { basemap: opts.basemap, skin: opts.skin } });
  }

  /** 示例页用的皮肤 id：给了底图就用底图配套皮肤 */
  function skinOf(opts) {
    var look = basemapLook(opts);
    return (look && look.skinId) || (opts && opts.skin) || 'parchment';
  }

  /**
   * 合规底图：去掉境界线图层（省界 / 国界一律不画），不加暗角。
   * opts: { skin, basemap（Studio 底图样式 id，如 'qinglv' / 'nightlights'）, nightLights, terrain: 夸张系数 | false, globe, roads }
   * 夜景的夜光图在这里同步挂上（只支持带 bounds 的墨卡托图或瓦片）；逐帧截图请用 MapStage.mount，它会先把夜光预载完。
   */
  function buildStyle(opts) {
    opts = opts || {};
    var VP = root.AntiqueVectorPaint;
    var look = basemapLook(opts);
    var skin = findSkin(skinOf(opts));
    var style = VP.buildStyle({
      paint: skin.paint,
      tileConfig: { terrain: VP.DEM_PRESETS.mapterhorn },
    });
    if (look) {
      var night = look.nightRaster && !opts.globe ? MS.nightSpec(opts.nightLights, studioUrl('./')) : null;
      MS.applyLookToStyle(style, look, { VP: VP, night: night });
      // 地球视图下 color-relief 不画（与 Studio 一致）
      if (opts.globe) style.layers.forEach(function (l) { if (l.id === 'vl-relief') l.layout.visibility = 'none'; });
    }
    style.layers = style.layers.filter(function (l) {
      if (/^vl-boundary/.test(l.id)) return false;
      if (opts.roads === false && /^vl-(highway|trunk|major|secondary|tertiary|minor|service|path|track|rail|transit|ferry)$/.test(l.id)) return false;
      return true;
    });
    if (style.sources.polarIce) style.sources.polarIce.data = studioUrl(VP.POLAR_ICE_URL);
    if (opts.terrain === false) delete style.terrain;
    else style.terrain = { source: 'terrain', exaggeration: opts.terrain || 1 };
    if (opts.globe) style.projection = { type: 'globe' };
    style.glyphs = VP.GLYPHS_URL;
    return style;
  }

  /** 皮肤的 CSS 调色：滤镜 + 暖色叠层；合规要求不加暗角，所以 vignette 一律忽略 */
  function applyGrade(container, skinId) {
    var c = findSkin(skinId).css;
    var canvas = container.querySelector('.maplibregl-canvas-container') || container;
    canvas.style.filter =
      'sepia(' + c.sepia + ') saturate(' + c.saturate + ') contrast(' + c.contrast + ') brightness(' + c.brightness + ') hue-rotate(' + c.hueRotate + 'deg)';
    var tint = container.querySelector('.ms-tint');
    if (!tint) {
      tint = document.createElement('div');
      tint.className = 'ms-tint';
      tint.style.cssText = 'position:absolute;inset:0;pointer-events:none;mix-blend-mode:soft-light;z-index:1';
      container.appendChild(tint);
    }
    tint.style.background = c.warmTintColor;
    tint.style.opacity = c.warmTintAlpha;
  }

  function createMap(container, opts) {
    opts = opts || {};
    if (typeof container === 'string') container = document.getElementById(container);
    var map = new root.maplibregl.Map({
      container: container,
      canvasContextAttributes: opts.preserve ? { preserveDrawingBuffer: true } : undefined,
      style: buildStyle(opts),
      center: opts.center || [104, 35.5],
      zoom: opts.zoom != null ? opts.zoom : 3.6,
      pitch: opts.pitch || 0,
      bearing: opts.bearing || 0,
      maxPitch: 80,
      interactive: opts.interactive !== false,
      attributionControl: { compact: true },
      fadeDuration: 0,
    });
    if (opts.navigation !== false && opts.interactive !== false) {
      map.addControl(new root.maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    }
    map.once('load', function () { applyGrade(container, skinOf(opts)); });
    return map;
  }

  /** 换皮肤：只改颜色与调色，不重建 style */
  function setSkin(map, skinId) {
    var VP = root.AntiqueVectorPaint;
    VP.applyVectorPaint(map, findSkin(skinId).paint);
    applyGrade(map.getContainer(), skinId);
  }

  // ── 地名：三态 normal / active / dim，出现后不卸载 ─────────
  var LABEL_CSS =
    '.ms-label{display:flex;align-items:center;gap:6px;font:600 15px/1 "Noto Serif SC",serif;color:#2b2118;' +
    'text-shadow:0 0 3px #efe6d2,0 0 6px #efe6d2;white-space:nowrap;pointer-events:none;transition:color .25s,transform .25s}' +
    '.ms-label i{width:9px;height:9px;border-radius:50%;background:#2b2118;box-shadow:0 0 0 2px #efe6d2;flex:none;transition:background .25s,transform .25s}' +
    '.ms-label[data-tier=capital]{font-size:18px}.ms-label[data-tier=capital] i{width:11px;height:11px;border-radius:2px}' +
    '.ms-label[data-state=active]{color:#8f1d16;transform:scale(1.12)}.ms-label[data-state=active] i{background:#c0272d;transform:scale(1.25)}' +
    '.ms-label[data-state=dim]{color:#7d6f5d}.ms-label[data-state=dim] i{background:#9a8b76}' +
    '.ms-label[data-approx] b::after{content:"（约）";font-weight:400;font-size:.8em}' +
    '.ms-label[data-side=left]{flex-direction:row-reverse}' +
    '.ms-head{width:0;height:0;border-left:8px solid transparent;border-right:8px solid transparent;border-bottom:16px solid currentColor;filter:drop-shadow(0 0 2px #efe6d2)}';

  function ensureCss() {
    if (typeof document === 'undefined' || document.getElementById('ms-kit-css')) return;
    var s = document.createElement('style');
    s.id = 'ms-kit-css';
    s.textContent = LABEL_CSS;
    document.head.appendChild(s);
  }

  function addLabel(map, site) {
    ensureCss();
    var el = document.createElement('div');
    el.className = 'ms-label';
    el.setAttribute('data-state', site.state || 'normal');
    el.setAttribute('data-tier', site.tier || 'city');
    if (site.approx) el.setAttribute('data-approx', '');
    if (site.side === 'left') el.setAttribute('data-side', 'left');
    el.innerHTML = '<i></i><b>' + site.name + '</b>';
    var marker = new root.maplibregl.Marker({ element: el, anchor: site.side === 'left' ? 'right' : 'left', offset: [site.side === 'left' ? 5 : -5, 0] })
      .setLngLat(site.lngLat)
      .addTo(map);
    return {
      el: el,
      marker: marker,
      setState: function (st) { el.setAttribute('data-state', st); },
    };
  }

  // ── 路线：全程淡底 + 已走实线 + 同色头部箭头 ─────────────
  function addRoute(map, route) {
    ensureCss();
    var id = route.id;
    var color = route.color || SIDE_COLORS[route.side || 'red'];
    var full = { type: 'Feature', geometry: { type: 'LineString', coordinates: route.coords } };
    map.addSource(id + '-full', { type: 'geojson', data: full });
    map.addSource(id + '-prog', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: route.coords.slice(0, 1) } } });
    map.addLayer({
      id: id + '-ghost', type: 'line', source: id + '-full',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': color, 'line-width': route.width ? route.width * 0.6 : 2.2, 'line-opacity': route.ghost === false ? 0 : 0.28, 'line-dasharray': [1.2, 1.6] },
    });
    map.addLayer({
      id: id + '-casing', type: 'line', source: id + '-prog',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#f3ead8', 'line-width': (route.width || 4) + 3, 'line-opacity': 0.85 },
    });
    map.addLayer({
      id: id + '-line', type: 'line', source: id + '-prog',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': color, 'line-width': route.width || 4 },
    });
    var headEl = document.createElement('div');
    headEl.className = 'ms-head';
    headEl.style.color = color;
    var head = new root.maplibregl.Marker({ element: headEl, rotationAlignment: 'map', pitchAlignment: 'map' })
      .setLngLat(route.coords[0])
      .addTo(map);
    function seek(t) {
      var s = sliceRoute(route.coords, t);
      map.getSource(id + '-prog').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: s.line } });
      head.setLngLat(s.head).setRotation(s.bearing);
      headEl.style.visibility = t <= 0 ? 'hidden' : 'visible';
      return s;
    }
    seek(0);
    return { id: id, seek: seek, head: head };
  }

  /**
   * 宿主时间契约：注册 window.__mapstageSeek(t)（秒），HyperFrames / Playwright 逐帧调用；
   * 返回的 Promise 在地图 idle 后 resolve，保证截帧拿到的是画完的画面。
   */
  function exposeSeek(map, duration, render, opts) {
    var timeoutMs = (opts && opts.timeoutMs) || 12000;
    function seek(t) {
      render(Math.max(0, Math.min(duration, t)));
      return new Promise(function (resolve) {
        var done = false;
        function finish() {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(t);
        }
        // 与 map-fx waitIdle 一致：超时也放行（并告警），不让一张慢瓦片卡死整条截帧
        var timer = setTimeout(function () {
          console.warn('[mapstage] seek(' + t + ') idle timeout ' + timeoutMs + 'ms');
          finish();
        }, timeoutMs);
        map.once('idle', finish);
        map.triggerRepaint();
      });
    }
    root.__mapstageSeek = seek;
    root.__mapstageDuration = duration;
    return seek;
  }

  /** 预览自播（非录制）：requestAnimationFrame 驱动同一个 render(t) */
  function play(duration, render, opts) {
    opts = opts || {};
    var start = null;
    var raf = null;
    var offset = opts.from || 0;
    function tick(ts) {
      if (start == null) start = ts;
      var t = offset + (ts - start) / 1000;
      if (t >= duration) {
        if (opts.loop) { start = ts; offset = 0; t = 0; }
        else { render(duration); if (opts.onEnd) opts.onEnd(); return; }
      }
      render(t);
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return function stop() { if (raf) cancelAnimationFrame(raf); };
  }

  var COMPLIANCE_POINTS = MS.COMPLIANCE_POINTS;
  var complianceCheck = MS.complianceCheck;
  var addTenDash = MS.addTenDash;
  var setTenDashVisible = MS.setTenDashVisible;

  return {
    complianceCheck: complianceCheck,
    addTenDash: addTenDash,
    setTenDashVisible: setTenDashVisible,
    COMPLIANCE_POINTS: COMPLIANCE_POINTS,
    SIDE_COLORS: SIDE_COLORS,
    SAFE_AREA: SAFE_AREA,
    haversineKm: haversineKm,
    bearingDeg: bearingDeg,
    sliceRoute: sliceRoute,
    arc: arc,
    bbox: bbox,
    safePadding: safePadding,
    smoothstep: smoothstep,
    cameraAt: cameraAt,
    buildStyle: buildStyle,
    applyGrade: applyGrade,
    createMap: createMap,
    setSkin: setSkin,
    addLabel: addLabel,
    addRoute: addRoute,
    exposeSeek: exposeSeek,
    play: play,
  };
});
