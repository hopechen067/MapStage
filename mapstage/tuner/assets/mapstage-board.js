/**
 * MapStage Board：给游戏 / 交互页用的地图接口（见 references/play.md）。
 *
 * MapStage 只管地图：古卷底图、地形、地名、合规、城池圈、连线、行军动画、点选。
 * 规则（谁的城、多少兵、能不能打）由使用者自己写，每次状态变了调 setCities / setLinks 重画。
 *
 * Browser: window.MapStageBoard（需先加载 maplibre-gl 5.6.0、vector-paint.js、map-fx.js、mapstage-story.js）
 * Node: require('./mapstage-board.js') 只用纯函数部分（单测）
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MapStageBoard = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var DEFAULTS = {
    pitch: 20,
    rotate: false,
    pickRadius: 28,          // 点选容差（像素）
    padding: { top: 60, bottom: 40, left: 80, right: 60 },
    radius: { min: 7, scale: 2.2 },   // 城池圈半径 = min + sqrt(value) * scale
    neutral: '#7d6f5d',
  };
  var RINGS = {
    select: { color: '#241b14', width: 3.5 },
    target: { color: '#9a6b2c', width: 3 },
  };
  var LABEL_STATES = ['normal', 'active', 'dim'];

  function linkKey(a, b) { return a < b ? a + '|' + b : b + '|' + a; }

  /** 校验 sites + links；sites 字段与 story.json 相同 */
  function lintBoard(opts) {
    var errs = [];
    var sites = (opts && opts.sites) || [];
    if (!sites.length) errs.push('sites 至少一个地点');
    var ids = {};
    sites.forEach(function (s) { ids[s.id] = true; });
    var seen = {};
    ((opts && opts.links) || []).forEach(function (l, i) {
      if (!Array.isArray(l) || l.length !== 2) { errs.push('links[' + i + '] 必须是 [地点, 地点]'); return; }
      l.forEach(function (id) { if (!ids[id]) errs.push('links[' + i + '] 引用了不存在的地点 ' + id); });
      if (l[0] === l[1]) errs.push('links[' + i + '] 两端相同：' + l[0]);
      var k = linkKey(l[0], l[1]);
      if (seen[k]) errs.push('links[' + i + '] 重复：' + k);
      seen[k] = true;
    });
    return errs;
  }

  function radiusOf(value, r) {
    if (value == null) return r.min;
    return r.min + Math.sqrt(Math.max(0, value)) * r.scale;
  }

  /** 城池圈 GeoJSON：只画 setCities 里给了 color 的地点 */
  function cityFeatures(sites, cities, opts) {
    opts = opts || {};
    var r = opts.radius || DEFAULTS.radius;
    var out = [];
    sites.forEach(function (s) {
      var c = cities[s.id];
      if (!c || !c.color) return;
      var ring = RINGS[c.ring] || { color: '#efe6d2', width: 1.5 };
      out.push({
        type: 'Feature',
        properties: { id: s.id, color: c.color, r: radiusOf(c.value, r), stroke: ring.color, sw: ring.width },
        geometry: { type: 'Point', coordinates: s.lngLat.slice() },
      });
    });
    return { type: 'FeatureCollection', features: out };
  }

  /** 连线 GeoJSON：style(a, b) 返回 { color, width, hidden }，缺省用中性色细线 */
  function linkFeatures(sitesById, links, style, neutral) {
    var out = [];
    links.forEach(function (l) {
      var st = (style && style(l[0], l[1])) || {};
      if (st.hidden) return;
      out.push({
        type: 'Feature',
        properties: { a: l[0], b: l[1], color: st.color || neutral || DEFAULTS.neutral, w: st.width || 1.6 },
        geometry: { type: 'LineString', coordinates: [sitesById[l[0]].lngLat.slice(), sitesById[l[1]].lngLat.slice()] },
      });
    });
    return { type: 'FeatureCollection', features: out };
  }

  /** 屏幕上离 point 最近、且在 radius 像素内的地点 id；projected: [{ id, x, y }] */
  function nearestSite(projected, point, radius) {
    var best = null;
    var bd = radius;
    projected.forEach(function (p) {
      var d = Math.hypot(p.x - point.x, p.y - point.y);
      if (d < bd) { bd = d; best = p.id; }
    });
    return best;
  }

  /** 合并一份局部更新；值为 null 表示清掉该城的样式 */
  function mergeCities(cur, patch) {
    var next = {};
    Object.keys(cur).forEach(function (id) { next[id] = cur[id]; });
    Object.keys(patch || {}).forEach(function (id) {
      if (patch[id] === null) { delete next[id]; return; }
      var c = {};
      Object.keys(next[id] || {}).forEach(function (k) { c[k] = next[id][k]; });
      Object.keys(patch[id]).forEach(function (k) { c[k] = patch[id][k]; });
      if (c.label != null && LABEL_STATES.indexOf(c.label) < 0) throw new Error('city ' + id + '：label 只能是 ' + LABEL_STATES.join(' / '));
      if (c.ring != null && !RINGS[c.ring]) throw new Error('city ' + id + '：ring 只能是 select / target / null');
      next[id] = c;
    });
    return next;
  }

  // ── 浏览器部分 ──────────────────────────────────────────
  /**
   * 创建一张游戏地图。返回 Promise<board>。
   * opts: { preset, sites, links, pitch, rotate, pickRadius, padding, radius, fit = true }
   */
  function create(el, opts) {
    opts = opts || {};
    var errs = lintBoard(opts);
    if (errs.length) {
      var e = new Error('Board 校验未通过（' + errs.length + ' 条）：\n' + errs.map(function (m, i) { return '  ' + (i + 1) + '. ' + m; }).join('\n'));
      e.errors = errs;
      return Promise.reject(e);
    }
    var MS = root.MapStage;
    if (!MS || !root.maplibregl) return Promise.reject(new Error('MapStageBoard.create 需要先加载 maplibre-gl 5.6.0、vector-paint.js、map-fx.js、mapstage-story.js'));
    if (typeof el === 'string') el = document.getElementById(el);
    var o = {};
    Object.keys(DEFAULTS).forEach(function (k) { o[k] = DEFAULTS[k]; });
    Object.keys(opts).forEach(function (k) { if (opts[k] !== undefined) o[k] = opts[k]; });
    var sites = opts.sites;
    var links = opts.links || [];
    var byId = {};
    sites.forEach(function (s) { byId[s.id] = s; });
    // 地图 = 一份只有地点的 story：底图、地形、地名、合规全走 Story 运行时
    var story = { version: 1, id: 'board', duration: 1, fps: 30, sites: sites, compliance: { profile: 'cn-video' } };

    return MS.mount(el, { preset: opts.preset, story: story, interactive: true, preserve: opts.preserve, expose: false }).then(function (stage) {
      var map = stage.map;
      // 外层布局可能在挂载后才排好：容器一变就让地图跟上
      if (typeof ResizeObserver !== 'undefined') new ResizeObserver(function () { map.resize(); }).observe(el);
      map.resize();
      if (!o.rotate) { map.dragRotate.disable(); map.touchZoomRotate.disableRotation(); }

      var empty = { type: 'FeatureCollection', features: [] };
      map.addSource('board-links', { type: 'geojson', data: empty });
      map.addLayer({ id: 'board-links', type: 'line', source: 'board-links', layout: { 'line-cap': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'w'], 'line-opacity': 0.75, 'line-dasharray': [2, 1.5] } });
      map.addSource('board-cities', { type: 'geojson', data: empty });
      map.addLayer({ id: 'board-cities', type: 'circle', source: 'board-cities',
        paint: { 'circle-color': ['get', 'color'], 'circle-radius': ['get', 'r'], 'circle-opacity': 0.55,
          'circle-stroke-color': ['get', 'stroke'], 'circle-stroke-width': ['get', 'sw'], 'circle-pitch-alignment': 'map' } });
      map.addSource('board-fx', { type: 'geojson', data: empty });
      map.addLayer({ id: 'board-fx', type: 'line', source: 'board-fx', layout: { 'line-cap': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': 5, 'line-opacity': 0.95 } });

      var cities = {};
      var linkStyle = null;
      var badges = {};
      var handlers = { pick: [], hover: [] };

      function badgeEl(id) {
        if (badges[id]) return badges[id];
        var b = document.createElement('div');
        b.className = 'ms-badge';
        b.style.cssText = 'font:700 11px/1 ui-monospace,Consolas,monospace;color:#fff;padding:2px 4px;border-radius:3px;pointer-events:none;box-shadow:0 0 0 1px #efe6d2';
        new root.maplibregl.Marker({ element: b, anchor: 'top', offset: [0, 9] }).setLngLat(byId[id].lngLat).addTo(map);
        badges[id] = b;
        return b;
      }

      function drawCities() {
        map.getSource('board-cities').setData(cityFeatures(sites, cities, o));
        sites.forEach(function (s) {
          var c = cities[s.id] || {};
          stage.labels[s.id].setAttribute('data-state', c.label || 'normal');
          if (c.badge != null) {
            var b = badgeEl(s.id);
            b.textContent = String(c.badge);
            b.style.background = c.color || o.neutral;
            b.style.display = '';
          } else if (badges[s.id]) badges[s.id].style.display = 'none';
        });
      }

      function drawLinks() {
        map.getSource('board-links').setData(linkFeatures(byId, links, linkStyle, o.neutral));
      }

      function pickAt(point) {
        return nearestSite(sites.map(function (s) { var p = map.project(s.lngLat); return { id: s.id, x: p.x, y: p.y }; }), point, o.pickRadius);
      }

      function emit(type, e) {
        var id = pickAt(e.point);
        handlers[type].forEach(function (fn) { fn({ id: id, site: id ? byId[id] : null, lngLat: e.lngLat, point: e.point, originalEvent: e.originalEvent }); });
      }
      map.on('click', function (e) { emit('pick', e); });
      var lastHover;
      map.on('mousemove', function (e) {
        if (!handlers.hover.length) return;
        var id = pickAt(e.point);
        map.getCanvas().style.cursor = id ? 'pointer' : '';
        if (id !== lastHover) { lastHover = id; emit('hover', e); }
      });

      function fit(ids, fopts) {
        fopts = fopts || {};
        var pts = (ids || sites.map(function (s) { return s.id; })).map(function (id) { return byId[id].lngLat; });
        // 自己按 pitch / bearing 算机位：map.fitBounds 在 MapLibre 5.6 下不计俯仰，近处的点会被裁掉
        var c = map.getContainer();
        var cam = MS.fitCamera(pts, {
          width: c.clientWidth, height: c.clientHeight, padding: MS.normPadding(fopts.padding || o.padding),
          pitch: o.pitch, bearing: map.getBearing(), maxZoom: fopts.maxZoom || 9,
        });
        map.easeTo({ center: cam.center, zoom: cam.zoom, pitch: cam.pitch, bearing: cam.bearing, duration: fopts.duration || 0 });
      }

      var board = {
        map: map,
        stage: stage,
        sites: byId,
        links: links.slice(),
        /** 局部更新城池样式：{ id: { color, value, badge, label, ring } }；null 清掉 */
        setCities: function (patch) { cities = mergeCities(cities, patch); drawCities(); return board; },
        getCity: function (id) { return cities[id] || null; },
        /** 连线样式：style(a, b) → { color, width, hidden } */
        setLinks: function (style) { linkStyle = style; drawLinks(); return board; },
        neighbors: function (id) {
          return links.filter(function (l) { return l[0] === id || l[1] === id; }).map(function (l) { return l[0] === id ? l[1] : l[0]; });
        },
        /** 监听 pick（点击）/ hover；回调拿到 { id, site, lngLat, point }，id 为 null 表示没点中地点。返回取消函数 */
        on: function (type, fn) {
          if (!handlers[type]) throw new Error('只支持 pick / hover');
          handlers[type].push(fn);
          return function () { handlers[type] = handlers[type].filter(function (f) { return f !== fn; }); };
        },
        /** 行军动画：from → to 画一条推进线，结束后收起。返回 Promise */
        march: function (from, to, mopts) {
          mopts = mopts || {};
          var coords = MS.shapeRoute([byId[from].lngLat, byId[to].lngLat], mopts.curve || 'auto');
          var ms = mopts.ms != null ? mopts.ms : 520;
          var color = mopts.color || '#b3332a';
          var src = map.getSource('board-fx');
          return new Promise(function (done) {
            var t0 = performance.now();
            function step(now) {
              var p = ms > 0 ? Math.min(1, (now - t0) / ms) : 1;
              src.setData({ type: 'Feature', properties: { color: color }, geometry: { type: 'LineString', coordinates: MS.sliceRoute(coords, MS.smoothstep(p)).line } });
              if (p < 1) requestAnimationFrame(step);
              else setTimeout(function () { src.setData(empty); done(); }, mopts.hold != null ? mopts.hold : 160);
            }
            requestAnimationFrame(step);
          });
        },
        fit: fit,
        /** 镜头推到某地 */
        focus: function (id, fopts) {
          fopts = fopts || {};
          map.easeTo({ center: byId[id].lngLat, zoom: fopts.zoom != null ? fopts.zoom : Math.max(map.getZoom(), 6.5), duration: fopts.duration != null ? fopts.duration : 600 });
        },
        destroy: function () { stage.destroy(); },
      };
      drawLinks();
      drawCities();
      if (o.fit !== false) fit(Array.isArray(o.fit) ? o.fit : null);
      return board;
    });
  }

  return {
    create: create,
    lintBoard: lintBoard,
    cityFeatures: cityFeatures,
    linkFeatures: linkFeatures,
    nearestSite: nearestSite,
    mergeCities: mergeCities,
    linkKey: linkKey,
    DEFAULTS: DEFAULTS,
    RINGS: RINGS,
  };
});
