/**
 * MapStage Story 运行时（story.json v1，规范见 references/story-spec.md）。
 *
 *   const stage = await MapStage.mount(el, { preset, story });
 *   stage.duration;  await stage.seek(t);  await stage.precache();  stage.check(t);
 *
 * 纯函数部分（几何、镜头、校验、同屏计数）Node 可测：mapstage-story.test.mjs。
 * 地图部分依赖 window.maplibregl（5.6.0）、AntiqueVectorPaint（vector-paint.js）、AntiqueMapFx（map-fx.js）；
 * 用到底图样式（look.basemap）时还要 AntiqueTunerVector（tuner-vector.js），没加载就从同目录自动加载。
 * Browser: window.MapStage   Node: module.exports
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MapStage = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  // tuner 根目录（脚本在 <root>/assets/ 下）：vector-paint 里的资源路径（assets/polar-ice.geojson）相对它
  var SCRIPT_DIR = (function () {
    try {
      if (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) {
        return new URL('../', document.currentScript.src).href;
      }
    } catch (e) { /* ignore */ }
    return '';
  })();

  /** 阵营色：颜色表示「谁的行动」 */
  var SIDE_COLORS = { red: '#c0272d', enemy: '#5f7182', ally: '#7a1430', neutral: '#6a5a48' };
  var SAFE_AREA = [0.06, 0.22, 0.94, 0.78];
  var EARTH_R = 6371.0088;
  var DEFAULT_MOVE = 2.2;
  var LIMITS = { primary: 1, reaction: 2, active: 2, names: 2 };
  var ROLES = ['primary', 'reaction', 'background', 'residual', 'callout'];
  var SIDES = ['red', 'enemy', 'ally', 'neutral'];
  var TIERS = ['capital', 'large', 'medium', 'small', 'pass', 'station', 'ordos'];
  var CARD_KINDS = ['place', 'name', 'stamp', 'pair', 'table', 'photo', 'telegram', 'doc'];
  var CONFIDENCE = ['A', 'B', 'C'];

  // ── 几何（自 site/assets/stage-kit.js 迁入）──────────────
  function rad(d) { return (d * Math.PI) / 180; }
  function deg(r) { return (r * 180) / Math.PI; }

  function haversineKm(a, b) {
    var dLat = rad(b[1] - a[1]);
    var dLon = rad(b[0] - a[0]);
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  function bearingDeg(a, b) {
    var y = Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1]));
    var x = Math.cos(rad(a[1])) * Math.sin(rad(b[1])) -
      Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0]));
    return (deg(Math.atan2(y, x)) + 360) % 360;
  }

  function cumulative(coords) {
    var acc = [0];
    for (var i = 1; i < coords.length; i++) acc.push(acc[i - 1] + haversineKm(coords[i - 1], coords[i]));
    return acc;
  }

  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp01(t) { return t < 0 ? 0 : t > 1 ? 1 : t; }
  function smoothstep(t) { t = clamp01(t); return t * t * (3 - 2 * t); }

  /** 路线进度切片：t∈[0,1] 按里程推进 */
  function sliceRoute(coords, t) {
    var acc = cumulative(coords);
    var total = acc[acc.length - 1];
    var target = clamp01(t) * total;
    if (coords.length < 2 || total === 0) {
      return { line: coords.slice(0, 1), head: coords[0], bearing: 0, km: 0, totalKm: total };
    }
    var i = 1;
    while (i < acc.length - 1 && acc[i] < target) i++;
    var segLen = acc[i] - acc[i - 1];
    var f = segLen > 0 ? (target - acc[i - 1]) / segLen : 0;
    var a = coords[i - 1];
    var b = coords[i];
    var head = [lerp(a[0], b[0], f), lerp(a[1], b[1], f)];
    return { line: coords.slice(0, i).concat([head]), head: head, bearing: bearingDeg(a, b), km: target, totalKm: total };
  }

  /** 两点加弧：bend 是弦长的比例，默认 0.12 */
  function arc(a, b, opts) {
    opts = opts || {};
    var bend = opts.bend != null ? opts.bend : 0.12;
    var n = opts.steps || 32;
    var cx = (a[0] + b[0]) / 2 - (b[1] - a[1]) * bend;
    var cy = (a[1] + b[1]) / 2 + (b[0] - a[0]) * bend;
    var out = [];
    for (var i = 0; i <= n; i++) {
      var t = i / n;
      var u = 1 - t;
      out.push([u * u * a[0] + 2 * u * t * cx + t * t * b[0], u * u * a[1] + 2 * u * t * cy + t * t * b[1]]);
    }
    return out;
  }

  /** 各点到首尾连线的最大垂距（度）。≤ 0.4° 视为近共线 */
  function maxDeviation(coords) {
    if (coords.length < 3) return 0;
    var a = coords[0];
    var b = coords[coords.length - 1];
    var dx = b[0] - a[0];
    var dy = b[1] - a[1];
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var m = 0;
    for (var i = 1; i < coords.length - 1; i++) {
      var d = Math.abs((coords[i][0] - a[0]) * dy - (coords[i][1] - a[1]) * dx) / len;
      if (d > m) m = d;
    }
    return m;
  }

  /** curve:"auto"：只有两点或近共线才加弧；其余（真实线形）原样 */
  function shapeRoute(coords, curve) {
    if (curve === 'none' || coords.length < 2) return coords.slice();
    if (coords.length === 2 || maxDeviation(coords) <= 0.4) return arc(coords[0], coords[coords.length - 1]);
    return coords.slice();
  }

  function bbox(points) {
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    points.forEach(function (p) {
      if (p[0] < b[0]) b[0] = p[0];
      if (p[1] < b[1]) b[1] = p[1];
      if (p[0] > b[2]) b[2] = p[0];
      if (p[1] > b[3]) b[3] = p[1];
    });
    return b;
  }

  function safePadding(width, height, safe) {
    var s = safe || SAFE_AREA;
    return {
      left: Math.round(s[0] * width),
      top: Math.round(s[1] * height),
      right: Math.round((1 - s[2]) * width),
      bottom: Math.round((1 - s[3]) * height),
    };
  }

  // ── 俯仰感知取景（纯数学，海平面 Web Mercator，复刻 MapLibre 5.6 透视：tileSize 512、fov 36.87°）──
  // 不读地形、不看瓦片加载状态：同输入同机位。
  var FOV = 0.6435011087932844;

  function mercX(lng) { return (lng + 180) / 360; }
  function mercY(lat) { var s = Math.sin(rad(lat)); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI); }
  function unmercLng(x) { return x * 360 - 180; }
  function unmercLat(y) { return (Math.atan(Math.exp((0.5 - y) * 2 * Math.PI)) * 2 - Math.PI / 2) * 180 / Math.PI; }

  /** 地面点 → 屏幕像素（相机 { center, zoom, pitch, bearing }，视口 w×h，画面中心即 center）；在地平线后返回 null */
  function projectGround(lngLat, cam, w, h) {
    var ws = 512 * Math.pow(2, cam.zoom);
    var dx = (mercX(lngLat[0]) - mercX(cam.center[0])) * ws;
    var dy = (mercY(lngLat[1]) - mercY(cam.center[1])) * ws;
    var b = rad(cam.bearing || 0);
    var p = rad(cam.pitch || 0);
    var x = dx * Math.cos(b) + dy * Math.sin(b);
    var y = -dx * Math.sin(b) + dy * Math.cos(b);
    var D = 0.5 * h / Math.tan(FOV / 2);
    var depth = D - y * Math.sin(p);
    if (depth <= D * 0.05) return null;
    return { x: w / 2 + x * D / depth, y: h / 2 + y * Math.cos(p) * D / depth };
  }

  /** 屏幕像素 → 地面点（projectGround 的逆） */
  function unprojectGround(pt, cam, w, h) {
    var D = 0.5 * h / Math.tan(FOV / 2);
    var p = rad(cam.pitch || 0);
    var sx = pt.x - w / 2;
    var sy = pt.y - h / 2;
    var y = sy * D / (D * Math.cos(p) + sy * Math.sin(p));
    var x = sx * (D - y * Math.sin(p)) / D;
    var b = rad(cam.bearing || 0);
    var ws = 512 * Math.pow(2, cam.zoom);
    var dx = x * Math.cos(b) - y * Math.sin(b);
    var dy = x * Math.sin(b) + y * Math.cos(b);
    return [unmercLng(mercX(cam.center[0]) + dx / ws), unmercLat(mercY(cam.center[1]) + dy / ws)];
  }

  /**
   * 让 points 全部落进安全区（padding = {left,top,right,bottom} 像素）的相机，计入 pitch / bearing。
   * opts: { width, height, padding, pitch, bearing, maxZoom = 9 } → { center, zoom, pitch, bearing }
   */
  function fitCamera(points, opts) {
    var w = opts.width;
    var h = opts.height;
    var pad = opts.padding || { left: 0, top: 0, right: 0, bottom: 0 };
    var maxZoom = opts.maxZoom != null ? opts.maxZoom : 9;
    var L = pad.left, T = pad.top, R = w - pad.right, B = h - pad.bottom;
    var cam = { pitch: opts.pitch || 0, bearing: opts.bearing || 0 };
    var b = bbox(points);
    cam.center = [unmercLng((mercX(b[0]) + mercX(b[2])) / 2), unmercLat((mercY(b[1]) + mercY(b[3])) / 2)];
    cam.zoom = Math.min(maxZoom, 3);

    function extent() {
      var e = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
      for (var i = 0; i < points.length; i++) {
        var q = projectGround(points[i], cam, w, h);
        if (!q) return null;
        if (q.x < e.x0) e.x0 = q.x;
        if (q.x > e.x1) e.x1 = q.x;
        if (q.y < e.y0) e.y0 = q.y;
        if (q.y > e.y1) e.y1 = q.y;
      }
      return e;
    }
    // 把点群屏幕包围盒的中心挪到安全区中心
    function recenter(e) {
      var off = { x: w / 2 + (e.x0 + e.x1) / 2 - (L + R) / 2, y: h / 2 + (e.y0 + e.y1) / 2 - (T + B) / 2 };
      cam.center = unprojectGround(off, cam, w, h);
    }

    for (var it = 0; it < 60; it++) {
      var e = extent();
      if (!e) { cam.zoom -= 0.5; continue; }
      var sw = e.x1 - e.x0, sh = e.y1 - e.y0;
      var k = Math.min(sw > 1e-9 ? (R - L) / sw : Infinity, sh > 1e-9 ? (B - T) / sh : Infinity);
      var dz = isFinite(k) ? Math.log(k) / Math.LN2 : maxZoom - cam.zoom;
      recenter(e);
      var nz = Math.min(maxZoom, cam.zoom + Math.max(-4, Math.min(4, dz)));
      var done = Math.abs(nz - cam.zoom) < 1e-7;
      cam.zoom = nz;
      if (done) break;
    }
    // 兜底：仍有点出安全区就小步拉远（确定性步长）
    for (var g = 0; g < 400; g++) {
      var f = extent();
      if (f) {
        recenter(f);
        f = extent();
        if (f && f.x0 >= L - 0.5 && f.x1 <= R + 0.5 && f.y0 >= T - 0.5 && f.y1 <= B + 0.5) break;
      }
      cam.zoom -= 1 / 64;
    }
    return cam;
  }

  /** padding 可以是数字或 {top,right,bottom,left}；统一成对象 */
  function normPadding(p) {
    if (typeof p === 'number') return { left: p, top: p, right: p, bottom: p };
    p = p || {};
    return { left: p.left || 0, top: p.top || 0, right: p.right || 0, bottom: p.bottom || 0 };
  }

  /**
   * 镜头插值：shots = [{t, center, zoom, pitch, bearing, move?, push?, tilt?}]（t 为到位时刻，升序）。
   * 一句一动：关键帧之间 smoothstep，到位后停稳；push/tilt 让停稳段缓推。
   */
  function cameraAt(shots, time) {
    if (!shots.length) return null;
    if (time <= shots[0].t) return pick(shots[0], 0);
    for (var i = 1; i < shots.length; i++) {
      var a = shots[i - 1];
      var b = shots[i];
      var moveStart = b.t - (b.move != null ? b.move : Math.min(DEFAULT_MOVE, b.t - a.t));
      if (time < moveStart) return pick(a, (time - a.t) / Math.max(0.001, moveStart - a.t));
      if (time <= b.t) {
        var k = smoothstep((time - moveStart) / Math.max(0.001, b.t - moveStart));
        var pa = pick(a, 1);
        return {
          center: [lerp(pa.center[0], b.center[0], k), lerp(pa.center[1], b.center[1], k)],
          zoom: lerp(pa.zoom, b.zoom, k),
          pitch: lerp(pa.pitch, b.pitch || 0, k),
          bearing: lerp(pa.bearing, b.bearing || 0, k),
        };
      }
    }
    return pick(shots[shots.length - 1], 1);

    function pick(s, holdT) {
      var h = smoothstep(holdT);
      return {
        center: s.center.slice(),
        zoom: s.zoom + (s.push || 0) * h,
        pitch: (s.pitch || 0) + (s.tilt || 0) * h,
        bearing: s.bearing || 0,
      };
    }
  }

  // ── Story 数据：规范化与时间窗 ────────────────────────────
  function indexById(list) {
    var m = {};
    (list || []).forEach(function (x) { if (x && x.id != null) m[x.id] = x; });
    return m;
  }

  function moveOf(shot) { return shot.move != null ? shot.move : DEFAULT_MOVE; }

  /** 路线上图的时间窗 [from, to)；callout 不上图，返回 null */
  function routeWindow(route, duration) {
    if (route.role === 'callout') return null;
    var d = route.draw || [0, 0];
    var role = route.role || 'primary';
    // residual 画完后一直留到片尾；其余按 hold（缺省 = 画完即收）
    var to = role === 'residual' ? duration + 1 : (route.hold != null ? route.hold : d[1]);
    return [d[0], to];
  }

  function routePoints(route, sitesById) {
    if (route.coords) return route.coords.map(function (c) { return c.slice(); });
    return (route.via || []).map(function (id) { return sitesById[id] ? sitesById[id].lngLat.slice() : null; });
  }

  /** 每个地点在 t 时的三态：active 当句 · normal 讲过 · dim 还没讲到 */
  function labelStates(story, t) {
    var beats = (story.beats || []).slice().sort(function (a, b) { return a.t - b.t; });
    var mentioned = {};
    var later = {};
    var cur = null;
    beats.forEach(function (b) {
      (b.active || []).forEach(function (id) {
        if (b.t <= t) mentioned[id] = true;
        else later[id] = true;
      });
      if (b.t <= t) cur = b;
    });
    var active = {};
    var forcedDim = {};
    if (cur) {
      (cur.active || []).forEach(function (id) { active[id] = true; });
      (cur.dim || []).forEach(function (id) { forcedDim[id] = true; });
    }
    var out = {};
    (story.sites || []).forEach(function (s) {
      if (active[s.id]) out[s.id] = 'active';
      else if (forcedDim[s.id]) out[s.id] = 'dim';
      else if (mentioned[s.id]) out[s.id] = 'normal';
      else out[s.id] = later[s.id] ? 'dim' : 'normal';
    });
    return out;
  }

  /** t 时刻的同屏计数：primary / reaction / active / names */
  function countsAt(story, t) {
    var dur = story.duration;
    var c = { primary: 0, reaction: 0, active: 0, names: 0 };
    (story.routes || []).forEach(function (r) {
      var w = routeWindow(r, dur);
      if (!w || t < w[0] || t >= w[1]) return;
      if (r.role === 'primary' || r.role == null) c.primary++;
      else if (r.role === 'reaction') c.reaction++;
    });
    var st = labelStates(story, t);
    Object.keys(st).forEach(function (id) { if (st[id] === 'active') c.active++; });
    (story.cards || []).forEach(function (k) { if (k.kind === 'name' && t >= k.t0 && t < k.t1) c.names++; });
    return c;
  }

  /** 采样所有时间窗端点，逐区间检查同屏上限（区间内计数恒定） */
  function limitErrors(story) {
    var errs = [];
    var dur = story.duration;
    var pts = { 0: true };
    (story.routes || []).forEach(function (r) {
      var w = routeWindow(r, dur);
      if (w) { pts[w[0]] = true; pts[w[1]] = true; }
    });
    (story.beats || []).forEach(function (b) { pts[b.t] = true; });
    (story.cards || []).forEach(function (k) { pts[k.t0] = true; pts[k.t1] = true; });
    var times = Object.keys(pts).map(Number).filter(function (t) { return t >= 0 && t < dur; }).sort(function (a, b) { return a - b; });
    var seen = {};
    times.forEach(function (t) {
      var c = countsAt(story, t);
      [['primary', '主线路线'], ['reaction', '敌方反应路线'], ['active', '同屏 active 地名'], ['names', '部队名牌']].forEach(function (p) {
        if (c[p[0]] > LIMITS[p[0]] && !seen[p[0]]) {
          seen[p[0]] = true;
          errs.push('t=' + t + 's：' + p[1] + ' 同屏 ' + c[p[0]] + ' 个，上限 ' + LIMITS[p[0]]);
        }
      });
    });
    return errs;
  }

  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function isLngLat(p) { return Array.isArray(p) && p.length === 2 && isNum(p[0]) && isNum(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90; }

  /** 返回错误数组（不抛）。空数组 = 通过 */
  function lintStory(story) {
    var errs = [];
    if (!story || typeof story !== 'object') return ['story 必须是对象'];
    if (story.version !== 1) errs.push('version 必须是 1');
    if (!isNum(story.duration) || story.duration <= 0) errs.push('duration 必须是正数（秒）');
    ['sites', 'routes', 'beats', 'shots', 'cards'].forEach(function (k) {
      if (story[k] != null && !Array.isArray(story[k])) errs.push(k + ' 必须是数组');
    });
    if (errs.length) return errs;
    var dur = story.duration;
    var sites = story.sites || [];
    var routes = story.routes || [];
    var siteIds = indexById(sites);
    var routeIds = indexById(routes);

    // 唯一 id
    [['sites', sites], ['routes', routes]].forEach(function (p) {
      var seen = {};
      p[1].forEach(function (x) {
        if (!x.id) errs.push(p[0] + ' 里有条目缺 id');
        else if (seen[x.id]) errs.push(p[0] + ' 里 id 重复：' + x.id);
        seen[x.id] = true;
      });
    });

    // sites
    sites.forEach(function (s) {
      if (!isLngLat(s.lngLat)) errs.push('site ' + s.id + '：lngLat 必须是 [经度, 纬度]');
      if (!s.name) errs.push('site ' + s.id + '：缺 name');
      if (s.tier && TIERS.indexOf(s.tier) < 0) errs.push('site ' + s.id + '：tier 不认识（' + s.tier + '）');
      if (s.confidence && CONFIDENCE.indexOf(s.confidence) < 0) errs.push('site ' + s.id + '：confidence 只能是 A / B / C');
      if (s.confidence === 'C' && s.approx !== true) errs.push('site ' + s.id + '：confidence C 的地点必须 approx: true（不得精确落点）');
    });

    // routes
    routes.forEach(function (r) {
      var tag = 'route ' + r.id + '：';
      var role = r.role || 'primary';
      if (ROLES.indexOf(role) < 0) errs.push(tag + 'role 不认识（' + r.role + '）');
      if (r.side && SIDES.indexOf(r.side) < 0) errs.push(tag + 'side 不认识（' + r.side + '）');
      if ((r.via && r.coords) || (!r.via && !r.coords)) {
        errs.push(tag + 'via 和 coords 二选一');
      } else if (r.via) {
        r.via.forEach(function (id) { if (!siteIds[id]) errs.push(tag + 'via 引用了不存在的地点 ' + id); });
        if (r.via.length < 2) errs.push(tag + 'via 至少两个地点');
      } else if (!Array.isArray(r.coords) || r.coords.length < 2 || !r.coords.every(isLngLat)) {
        errs.push(tag + 'coords 必须是至少两个 [经度, 纬度]');
      }
      if (role !== 'callout' || r.draw) {
        var d = r.draw;
        if (!Array.isArray(d) || d.length !== 2 || !isNum(d[0]) || !isNum(d[1])) {
          if (role !== 'callout') errs.push(tag + 'draw 必须是 [t0, t1]');
        } else {
          if (d[0] < 0 || d[1] > dur || d[0] >= d[1]) errs.push(tag + 'draw ' + JSON.stringify(d) + ' 必须满足 0 ≤ t0 < t1 ≤ duration');
          if (r.hold != null && r.hold < d[1]) errs.push(tag + 'hold (' + r.hold + ') 不能早于画完时刻 ' + d[1]);
          if (r.hold != null && r.hold > dur) errs.push(tag + 'hold (' + r.hold + ') 超出 duration');
        }
      }
    });

    // hold 不越段：同角色（primary / reaction）里，后一段 draw 开始前，前一段必须已收
    ['primary', 'reaction'].forEach(function (role) {
      var list = routes.filter(function (r) { return (r.role || 'primary') === role && Array.isArray(r.draw); })
        .sort(function (a, b) { return a.draw[0] - b.draw[0]; });
      for (var i = 0; i < list.length - 1; i++) {
        var a = list[i];
        var b = list[i + 1];
        var hold = a.hold != null ? a.hold : a.draw[1];
        if (hold > b.draw[0]) {
          errs.push('route ' + a.id + '：hold ' + hold + ' 越进下一段 ' + b.id + ' 的 draw（' + b.draw[0] + '），hold 要按段末收');
        }
      }
    });

    // beats
    (story.beats || []).forEach(function (b, i) {
      if (!isNum(b.t) || b.t < 0 || b.t > dur) errs.push('beats[' + i + ']：t 必须在 0..duration');
      ['active', 'dim'].forEach(function (k) {
        (b[k] || []).forEach(function (id) { if (!siteIds[id]) errs.push('beats[' + i + '].' + k + ' 引用了不存在的地点 ' + id); });
      });
    });

    // shots
    var shots = (story.shots || []);
    shots.forEach(function (s, i) {
      var tag = 'shots[' + i + ']：';
      if (!isNum(s.t) || s.t < 0 || s.t > dur) errs.push(tag + 't 必须在 0..duration');
      if (i > 0 && isNum(s.t) && isNum(shots[i - 1].t) && s.t <= shots[i - 1].t) errs.push(tag + 't 必须严格升序');
      if (s.fit == null && !s.center) errs.push(tag + '需要 fit 或 center/zoom');
      if (typeof s.fit === 'string') {
        var m = /^route:(.+)$/.exec(s.fit);
        if (!m) errs.push(tag + 'fit 字符串必须是 route:<id>');
        else if (!routeIds[m[1]]) errs.push(tag + 'fit 引用了不存在的路线 ' + m[1]);
      } else if (Array.isArray(s.fit)) {
        if (!s.fit.length) errs.push(tag + 'fit 不能为空');
        s.fit.forEach(function (id) { if (!siteIds[id]) errs.push(tag + 'fit 引用了不存在的地点 ' + id); });
      }
      if (s.center && !isLngLat(s.center)) errs.push(tag + 'center 必须是 [经度, 纬度]');
      if (i > 0 && isNum(s.t) && isNum(shots[i - 1].t) && s.t > shots[i - 1].t) {
        var gap = s.t - shots[i - 1].t;
        if (gap < moveOf(s)) errs.push(tag + '与上一镜头只隔 ' + gap.toFixed(2) + 's，小于 move ' + moveOf(s) + 's（一句一动，动完停稳）');
      }
    });

    // cards
    (story.cards || []).forEach(function (k, i) {
      var tag = 'cards[' + i + ']：';
      if (CARD_KINDS.indexOf(k.kind) < 0) errs.push(tag + 'kind 不认识（' + k.kind + '）');
      if (!isNum(k.t0) || !isNum(k.t1) || k.t0 < 0 || k.t1 > dur || k.t0 >= k.t1) errs.push(tag + '时间窗必须满足 0 ≤ t0 < t1 ≤ duration');
      if (!k.text) errs.push(tag + '缺 text');
      var isStrs = function (a) { return Array.isArray(a) && a.length > 0 && a.every(function (x) { return typeof x === 'string'; }); };
      if (k.kind === 'photo' && (typeof k.src !== 'string' || !k.src)) errs.push(tag + 'photo 必须给 src（没有可靠照片就用 name 名牌，不用 AI 生成人像）');
      if (k.kind === 'table') {
        var rows = k.rows;
        if (!Array.isArray(rows) || !rows.length || !rows.every(isStrs)) {
          errs.push(tag + 'table 必须给 rows（非空的字符串行数组）');
        } else {
          var cols = rows[0].length;
          if (!rows.every(function (r) { return r.length === cols; })) errs.push(tag + 'table 每行列数必须一致');
          if (k.header !== undefined && !(isStrs(k.header) && k.header.length === cols)) errs.push(tag + 'table.header 必须是 ' + cols + ' 个字符串');
        }
      }
      if (k.lines !== undefined && !isStrs(k.lines)) errs.push(tag + 'lines 必须是非空的字符串数组');
    });

    // compliance
    var comp = story.compliance;
    if (comp && comp.full) {
      comp.full.forEach(function (w, i) {
        if (!Array.isArray(w) || w.length !== 2 || w[0] < 0 || w[1] > dur || w[0] >= w[1]) errs.push('compliance.full[' + i + ']：必须是 [t0, t1] 且在 duration 内');
      });
    }
    if (comp && comp.tenDash !== undefined && typeof comp.tenDash !== 'boolean') errs.push('compliance.tenDash：必须是 true / false');

    // look
    var look = story.look;
    if (look != null && (typeof look !== 'object' || Array.isArray(look))) errs.push('look 必须是对象');
    else if (look && look.basemap != null) {
      var TV = tunerVector();
      if (look.basemap === 'satellite') errs.push('look.basemap：叙事运行时没有卫星底图，去掉 basemap 即为默认皮肤外观');
      else if (typeof look.basemap !== 'string') errs.push('look.basemap 必须是字符串');
      else if (TV && !TV.BASEMAP_STYLES.some(function (b) { return b.id === look.basemap; })) {
        errs.push('look.basemap 不认识（' + look.basemap + '），可选：' +
          TV.BASEMAP_STYLES.filter(function (b) { return !b.satellite; }).map(function (b) { return b.id; }).join(' / '));
      }
    }

    try {
      errs = errs.concat(limitErrors(story));
    } catch (e) {
      errs.push('同屏上限检查失败（数据结构不完整）：' + e.message);
    }
    return errs;
  }

  /** 渲染前校验：任何一条不过都抛错（error.errors 是数组），不带病出片 */
  function validateStory(story) {
    var errs = lintStory(story);
    if (errs.length) {
      var e = new Error('Story 校验未通过（' + errs.length + ' 条）：\n' + errs.map(function (m, i) { return '  ' + (i + 1) + '. ' + m; }).join('\n'));
      e.name = 'StoryValidationError';
      e.errors = errs;
      throw e;
    }
    return { ok: true, errors: [] };
  }

  // ── 合规自检 ─────────────────────────────────────────────
  var COMPLIANCE_POINTS = [
    { id: 'taiwan', label: '台湾完整', pts: [[121.5, 25.3], [120.85, 21.9], [121.9, 24.6], [120.1, 23.1]] },
    { id: 'hainan', label: '海南完整', pts: [[110.6, 20.1], [109.5, 18.2], [108.6, 19.2], [111.05, 19.6]] },
    { id: 'nanhai', label: '南海诸岛在画内', pts: [[112.28, 3.97], [111.2, 16.5], [114.3, 10.0], [117.8, 15.1]] },
  ];

  /**
   * 南海十段线（全图镜头必画，是「不画国界」的唯一例外）。
   * 第 2–10 段：Natural Earth 10m admin-0 maritime indicator, China POV（公共领域），每段取起点 / 中点 / 终点；
   * 第 1 段（台湾以东）NE 没有，按 2013 年版标准地图的位置手工示意。
   */
  var TEN_DASH = [
    [[122.97, 23.7], [122.83, 24.72]],
    [[121.838, 21.725], [121.455, 21.306], [121.082, 20.878]],
    [[119.834, 18.814], [119.568, 18.312], [119.391, 17.775]],
    [[112.699, 3.669], [112.139, 3.461], [111.544, 3.402]],
    [[108.432, 7.367], [108.304, 6.781], [108.39, 6.186]],
    [[110.397, 12.624], [110.292, 12.052], [110.087, 11.504]],
    [[109.316, 16.587], [109.592, 16.083], [109.869, 15.576]],
    [[116.51, 8.118], [116.095, 7.699], [115.678, 7.279]],
    [[119.04, 12.362], [118.815, 11.824], [118.589, 11.285]],
    [[119.025, 15.898], [119.018, 15.326], [119.011, 14.751]],
  ];
  var TEN_DASH_ID = 'ms-ten-dash';
  // 默认深色；海面太暗（与深色的对比度 < 1.65）时换浅色。实测：宣纸 / 绢本 / 羊皮的蓝海 1.8–2.0 → 深色；
  // 夜景色阶的近黑海 1.45、水墨灰海 1.52、暗夜皮肤的海 1.59 → 浅色
  var TEN_DASH_INK = '#3b2e24';
  var TEN_DASH_LIGHT = '#e6d6ae';
  var TEN_DASH_MIN_CONTRAST = 1.65;

  /** 加十段线图层（id 不含 boundary / admin，不触发「不画国界」自检）；默认隐藏，按镜头切换 */
  function addTenDash(map, opts) {
    opts = opts || {};
    if (map.getLayer(TEN_DASH_ID)) return TEN_DASH_ID;
    map.addSource(TEN_DASH_ID, {
      type: 'geojson',
      data: { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: TEN_DASH } },
    });
    map.addLayer({
      id: TEN_DASH_ID,
      type: 'line',
      source: TEN_DASH_ID,
      layout: { 'line-cap': 'butt', visibility: opts.visible ? 'visible' : 'none' },
      paint: {
        // 全图缩放下压在蓝色海面上，要粗、要深，否则看不出来
        'line-color': opts.color || TEN_DASH_INK,
        'line-width': ['interpolate', ['linear'], ['zoom'], 2, 2.8, 5, 3.6, 8, 4.4],
      },
    }, opts.beforeId);
    return TEN_DASH_ID;
  }

  function setTenDashVisible(map, on) {
    if (!map.getLayer(TEN_DASH_ID)) return;
    var v = on ? 'visible' : 'none';
    if (map.getLayoutProperty(TEN_DASH_ID, 'visibility') !== v) map.setLayoutProperty(TEN_DASH_ID, 'visibility', v);
  }

  function complianceCheck(map, opts) {
    opts = opts || {};
    var style = map.getStyle();
    var layers = (style && style.layers) || [];
    var out = [];
    var borders = layers.filter(function (l) { return /boundary|admin/.test(l.id) || l['source-layer'] === 'boundary'; });
    out.push({ id: 'no-borders', label: '不画省界 / 国界', ok: borders.length === 0, note: borders.map(function (l) { return l.id; }).join(', ') });
    out.push({ id: 'no-fog', label: '无雾化', ok: !(style && (style.fog || (style.sky && style.sky['fog-color']))) });
    out.push({ id: 'no-vignette', label: '无暗角', ok: !map.getContainer().querySelector('.ms-vignette, .vignette') });
    if (opts.full) {
      var b = map.getBounds();
      COMPLIANCE_POINTS.forEach(function (c) {
        out.push({ id: c.id, label: c.label, ok: c.pts.every(function (p) { return b.contains(p); }) });
      });
      // story 里显式写 compliance.tenDash: false 才跳过（自担审核风险）
      if (opts.tenDash !== false) {
        var on = !!map.getLayer(TEN_DASH_ID) && map.getLayoutProperty(TEN_DASH_ID, 'visibility') !== 'none';
        out.push({ id: 'ten-dash', label: '十段线已画出', ok: on });
      }
    }
    return out;
  }

  function inFull(story, t) {
    var full = (story.compliance && story.compliance.full) || [];
    return full.some(function (w) { return t >= w[0] && t <= w[1]; });
  }

  // ── DOM / 地图 ───────────────────────────────────────────
  // 录制要求只取决于 t：所有样式一律不写 transition / animation
  var CSS =
    '.ms-root{overflow:hidden;--ms-u:1px}' +
    '.ms-map{position:absolute;inset:0}' +
    '.ms-cards{position:absolute;inset:0;pointer-events:none;z-index:5;font-family:"Noto Serif SC",serif}' +
    '.ms-label{display:flex;align-items:center;gap:6px;font:600 15px/1 "Noto Serif SC",serif;color:#2b2118;' +
    'text-shadow:0 0 3px #efe6d2,0 0 6px #efe6d2;white-space:nowrap;pointer-events:none}' +
    '.ms-label i{width:9px;height:9px;border-radius:50%;background:#2b2118;box-shadow:0 0 0 2px #efe6d2;flex:none}' +
    '.ms-label[data-tier=capital]{font-size:18px}.ms-label[data-tier=capital] i{width:11px;height:11px;border-radius:2px}' +
    '.ms-label[data-tier=pass] i{border-radius:2px;transform:rotate(45deg)}' +
    '.ms-label[data-state=active]{color:#8f1d16;font-size:1.12em}.ms-label[data-state=active] i{background:#c0272d;width:12px;height:12px}' +
    '.ms-label[data-state=dim]{color:#7d6f5d}.ms-label[data-state=dim] i{background:#9a8b76}' +
    '.ms-label[data-approx] b::after{content:"（约）";font-weight:400;font-size:.8em}' +
    '.ms-label[data-side=left]{flex-direction:row-reverse}' +
    '.ms-head{width:0;height:0;border-left:8px solid transparent;border-right:8px solid transparent;border-bottom:16px solid currentColor;filter:drop-shadow(0 0 2px #efe6d2)}' +
    '.ms-head[data-role=reaction]{border-left-width:6px;border-right-width:6px;border-bottom-width:12px}' +
    // 字卡：不透明底，压缩后不糊
    '.ms-card{position:absolute;display:none;background:#f1e7d0;color:#2b2118;border:calc(var(--ms-u)*2) solid #3a2c1e;' +
    'box-shadow:calc(var(--ms-u)*4) calc(var(--ms-u)*4) 0 rgba(43,33,24,.35)}' +
    '.ms-card b{display:block;font-weight:900;letter-spacing:.06em}.ms-card small{display:block;font-weight:600;color:#6a5a48}' +
    '.ms-card[data-kind=place]{left:calc(var(--ms-u)*96);top:calc(var(--ms-u)*70);padding:calc(var(--ms-u)*14) calc(var(--ms-u)*34)}' +
    '.ms-card[data-kind=place] b{font-size:calc(var(--ms-u)*64)}.ms-card[data-kind=place] small{font-size:calc(var(--ms-u)*26);margin-top:calc(var(--ms-u)*4)}' +
    '.ms-card[data-kind=name]{left:calc(var(--ms-u)*96);bottom:calc(var(--ms-u)*90);padding:calc(var(--ms-u)*10) calc(var(--ms-u)*28);border-left-width:calc(var(--ms-u)*14);border-left-color:#8f1d16}' +
    '.ms-card[data-kind=name] b{font-size:calc(var(--ms-u)*44)}.ms-card[data-kind=name] small{font-size:calc(var(--ms-u)*24)}' +
    '.ms-card[data-kind=stamp]{right:calc(var(--ms-u)*110);top:calc(var(--ms-u)*90);width:calc(var(--ms-u)*120);padding:calc(var(--ms-u)*12) 0;text-align:center;' +
    'background:#a3231a;color:#f6ecd6;border-color:#7a1a12;transform:rotate(-6deg);box-shadow:none}' +
    '.ms-card[data-kind=stamp] b{font-size:calc(var(--ms-u)*46);writing-mode:vertical-rl;margin:0 auto;letter-spacing:.18em}' +
    '.ms-card[data-kind=pair]{right:calc(var(--ms-u)*110);bottom:calc(var(--ms-u)*90);padding:calc(var(--ms-u)*12) calc(var(--ms-u)*40);text-align:center}' +
    '.ms-card[data-kind=pair] b{font-size:calc(var(--ms-u)*120);line-height:1.05;color:#8f1d16}.ms-card[data-kind=pair] small{font-size:calc(var(--ms-u)*26)}' +
    '.ms-card[data-kind=table],.ms-card[data-kind=photo],.ms-card[data-kind=telegram],.ms-card[data-kind=doc]{left:50%;top:50%;transform:translate(-50%,-50%);' +
    'text-align:center;max-width:78%}' +
    '.ms-card[data-kind=table] small,.ms-card[data-kind=photo] small,.ms-card[data-kind=telegram] small,.ms-card[data-kind=doc] small{font-size:calc(var(--ms-u)*22);margin-top:calc(var(--ms-u)*8)}' +
    // table：表头常亮，格子按 t 逐格点亮（未点亮的格留位不显字），片尾整表定格
    '.ms-card[data-kind=table]{padding:calc(var(--ms-u)*20) calc(var(--ms-u)*34)}' +
    '.ms-card[data-kind=table] b{font-size:calc(var(--ms-u)*38)}' +
    '.ms-tbl{border-collapse:collapse;margin:calc(var(--ms-u)*12) auto 0}' +
    '.ms-tbl th,.ms-tbl td{border:calc(var(--ms-u)*2) solid #3a2c1e;padding:calc(var(--ms-u)*8) calc(var(--ms-u)*22);font-size:calc(var(--ms-u)*30);font-weight:700;white-space:nowrap}' +
    '.ms-tbl th{background:#3a2c1e;color:#f1e7d0}.ms-tbl td[data-lit="0"]{color:transparent;background:#e3d5b4}.ms-tbl td[data-lit="1"]{background:#f6eedb}' +
    // photo：相框 + 资料照角标，出处放 sub
    '.ms-card[data-kind=photo]{padding:calc(var(--ms-u)*14) calc(var(--ms-u)*14) calc(var(--ms-u)*12);background:#f8f2e3;transform:translate(-50%,-50%) rotate(-1.2deg)}' +
    '.ms-card[data-kind=photo] img{display:block;max-width:calc(var(--ms-u)*760);max-height:calc(var(--ms-u)*420);border:calc(var(--ms-u)*2) solid #3a2c1e;filter:sepia(.28) contrast(.96)}' +
    '.ms-card[data-kind=photo] b{font-size:calc(var(--ms-u)*34);margin-top:calc(var(--ms-u)*10);letter-spacing:.04em}' +
    '.ms-tag{position:absolute;z-index:1;left:calc(var(--ms-u)*26);top:calc(var(--ms-u)*26);background:#a3231a;color:#f6ecd6;font:700 calc(var(--ms-u)*20)/1.4 "Noto Serif SC",serif;padding:0 calc(var(--ms-u)*10);letter-spacing:.2em}' +
    // telegram：窄纸条、虚线边、等宽字，电文按 t 逐字出现（未出现的字留位）
    '.ms-card[data-kind=telegram]{padding:0 0 calc(var(--ms-u)*22);background:#e9e0c6;border-style:dashed;text-align:left;min-width:calc(var(--ms-u)*520);max-width:calc(var(--ms-u)*820);' +
    'font-family:"Courier New","Noto Sans Mono CJK SC","Noto Serif SC",monospace}' +
    '.ms-card[data-kind=telegram] .ms-head-bar{background:#3a2c1e;color:#f1e7d0;font-size:calc(var(--ms-u)*22);font-weight:700;letter-spacing:.7em;padding:calc(var(--ms-u)*6) calc(var(--ms-u)*24)}' +
    '.ms-card[data-kind=telegram] b{font-size:calc(var(--ms-u)*32);line-height:1.55;font-weight:700;letter-spacing:.02em;white-space:pre-wrap;padding:calc(var(--ms-u)*18) calc(var(--ms-u)*30) 0}' +
    '.ms-card[data-kind=telegram] b i{font-style:normal;color:transparent}' +
    '.ms-card[data-kind=telegram] small{padding:0 calc(var(--ms-u)*30);text-align:right}' +
    // doc：红头标题 + 正文行 + 落款 + 印章
    '.ms-card[data-kind=doc]{padding:calc(var(--ms-u)*26) calc(var(--ms-u)*56) calc(var(--ms-u)*30);background:#f4ecd8;text-align:left;min-width:calc(var(--ms-u)*560);max-width:calc(var(--ms-u)*820)}' +
    '.ms-card[data-kind=doc] b{font-size:calc(var(--ms-u)*40);color:#8f1d16;text-align:center;padding-bottom:calc(var(--ms-u)*10);border-bottom:calc(var(--ms-u)*4) double #8f1d16;margin-bottom:calc(var(--ms-u)*12)}' +
    '.ms-doc-line{font-size:calc(var(--ms-u)*26);line-height:1.75;font-weight:600}' +
    '.ms-card[data-kind=doc] small{text-align:right;margin-top:calc(var(--ms-u)*14);padding-right:calc(var(--ms-u)*70)}' +
    '.ms-seal{position:absolute;right:calc(var(--ms-u)*34);bottom:calc(var(--ms-u)*18);width:calc(var(--ms-u)*64);height:calc(var(--ms-u)*64);border:calc(var(--ms-u)*4) solid #a3231a;color:#a3231a;' +
    'font:900 calc(var(--ms-u)*34)/calc(var(--ms-u)*56) "Noto Serif SC",serif;text-align:center;transform:rotate(-8deg)}';

  function ensureCss() {
    if (typeof document === 'undefined' || document.getElementById('ms-story-css')) return;
    var s = document.createElement('style');
    s.id = 'ms-story-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function findSkin(id) {
    var VP = root.AntiqueVectorPaint;
    return VP.SKINS.filter(function (s) { return s.id === id; })[0] || VP.SKINS[0];
  }

  // ── 底图样式（look.basemap = Studio「底图样式」的 id）────────
  // 样式表与写参数的逻辑只在 tuner-vector.js 一处（BASEMAP_STYLES / applyBasemapParams），这里只做映射
  function tunerVector() {
    if (root && root.AntiqueTunerVector) return root.AntiqueTunerVector;
    if (typeof module === 'object' && module.exports && typeof require === 'function') return require('./tuner-vector.js');
    return null;
  }

  var HILLSHADE_KEYS = ['exaggeration', 'shadowColor', 'highlightColor', 'accentColor'];
  var VECTOR_KEYS = ['relief', 'reliefOpacity', 'elevStops', 'landcover', 'lights', 'nightRaster', 'paint'];

  /** 这份 preset / story 是否用到底图样式（决定要不要加载 tuner-vector.js） */
  function wantsBasemap(preset, story) {
    var look = (story && story.look) || {};
    var ui = (preset && preset.ui) || {};
    var v = preset && preset.vector;
    return !!(look.basemap || (ui.basemapId && ui.basemapId !== 'satellite') ||
      (v && (v.relief || v.lights || v.nightRaster)));
  }

  /**
   * preset + story → 叙事运行时的外观（纯函数）。
   * 底图来源：story.look.basemap > preset.ui.basemapId；没有底图但 preset.vector 开了海拔设色 / 灯光（Studio 里改过色阶）
   * 就照 preset.vector 原样画。都没有 → basemap: null，保持原来的皮肤外观（不碰 relief / 山影）。
   * 叙事运行时没有卫星栅格：'satellite' 一律按原外观处理。
   */
  function resolveLook(preset, story, TV) {
    preset = preset || {};
    var look = (story && story.look) || {};
    var ui = preset.ui || {};
    var pv = preset.vector || null;
    var id = look.basemap || ui.basemapId || null;
    if (id === 'satellite') id = null;
    var fromPreset = !!pv && (!look.basemap || look.basemap === ui.basemapId);
    var custom = !id && !!pv && !!(pv.relief || pv.lights || pv.nightRaster);
    if (!id && !custom) {
      return { basemap: null, skinId: ui.skinId || look.skin || 'parchment' };
    }
    TV = TV || tunerVector();
    if (!TV) throw new Error('look.basemap 需要 tuner-vector.js（AntiqueTunerVector）');
    // 在一份草稿 params 上跑 Studio 同款 applyBasemapParams，再叠上 preset 里的实际值
    var p = { vector: {}, ui: {}, maplibre: { satellite: {}, hillshade: {} } };
    var style = null;
    if (id) {
      style = TV.applyBasemapParams(p, id);
      if (!style) throw new Error('look.basemap 不认识：' + id);
    }
    if (fromPreset || custom) {
      VECTOR_KEYS.forEach(function (k) { if (pv[k] !== undefined) p.vector[k] = pv[k]; });
      var hs = (preset.maplibre && preset.maplibre.hillshade) || {};
      HILLSHADE_KEYS.forEach(function (k) { if (hs[k] != null) p.maplibre.hillshade[k] = hs[k]; });
      if (typeof ui.showWater === 'boolean') p.ui.showWater = ui.showWater;
    }
    var skinId = look.basemap
      ? look.skin || (fromPreset && ui.skinId) || style.skinId
      : ui.skinId || look.skin || (style && style.skinId) || 'parchment';
    var v = p.vector;
    var hsOut = {};
    HILLSHADE_KEYS.forEach(function (k) { if (p.maplibre.hillshade[k] != null) hsOut[k] = p.maplibre.hillshade[k]; });
    var out = {
      basemap: id,
      skinId: skinId,
      paint: v.paint || null,
      relief: !!v.relief,
      reliefOpacity: v.reliefOpacity != null ? v.reliefOpacity : 1,
      elevStops: v.elevStops || null,
      hillshade: Object.keys(hsOut).length ? hsOut : null,
      landcover: !!v.landcover,
      water: p.ui.showWater !== false,
      lights: !!v.lights,
      nightRaster: !!v.nightRaster,
    };
    // 暗底：按十段线底下实际的海面颜色判断（不看皮肤 id：夜景配别的皮肤，海面照样近黑）
    out.sea = seaColor(out);
    out.dark = contrastRatio(TEN_DASH_INK, out.sea) < TEN_DASH_MIN_CONTRAST;
    return out;
  }

  function vectorPaint() {
    if (root && root.AntiqueVectorPaint) return root.AntiqueVectorPaint;
    if (typeof module === 'object' && module.exports && typeof require === 'function') return require('./vector-paint.js');
    return null;
  }

  /** 十段线（在海上）底下实际看到的颜色：画水系 → 海洋水面色；不画水系但开了海拔设色 → 色阶海面段；都没有 → 底色 */
  function seaColor(look) {
    var VP = vectorPaint();
    var paint = VP.normalizePaint(look.paint || findSkinIn(VP, look.skinId).paint);
    if (look.water) return paint.waterOcean || paint.water;
    if (look.relief) {
      var stops = look.elevStops || VP.DEFAULT_ELEVATION_STOPS;
      var sea = stops.filter(function (s) { return s.h < 0; });
      if (!sea.length) sea = stops.filter(function (s) { return s.h <= 0; });
      if (sea.length) {
        // 海面各段的平均亮度：十段线大多压在几千米深的海上
        var y = sea.reduce(function (a, s) { return a + luminance(s.color); }, 0) / sea.length;
        return greyOf(y);
      }
    }
    return paint.background;
  }

  function findSkinIn(VP, id) {
    return VP.SKINS.filter(function (s) { return s.id === id; })[0] || VP.SKINS[0];
  }

  /** WCAG 相对亮度 */
  function luminance(hex) {
    var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(String(hex));
    if (!m) return 0;
    var c = [m[1], m[2], m[3]].map(function (h) {
      var x = parseInt(h, 16) / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  /** 相对亮度 → 同亮度的灰（只用来回传 sea，便于检查） */
  function greyOf(y) {
    var x = y <= 0.0031308 ? y * 12.92 : 1.055 * Math.pow(y, 1 / 2.4) - 0.055;
    var h = Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16);
    if (h.length < 2) h = '0' + h;
    return '#' + h + h + h;
  }

  function contrastRatio(a, b) {
    var la = luminance(a);
    var lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  /** 夜光配置 → 数据源（同步）。等经纬全球图要在浏览器里重投影（见 prepareNight），这里返回 null */
  function nightSpec(input, base, TV) {
    TV = TV || tunerVector();
    var cfg = TV.resolveNightConfig(input);
    if (!cfg) return null;
    if (cfg.tiles.length) return TV.nightSourceSpec(cfg);
    if (!cfg.bounds) return null;
    base = base || SCRIPT_DIR;
    return TV.nightSourceSpec(cfg, base ? new URL(cfg.image, base).href : cfg.image);
  }

  /**
   * 把 resolveLook 的结果写进 VP.buildStyle 出来的 style（纯函数，就地改）。
   * opts.night = 夜光数据源（nightSpec / prepareNight 的结果），null = 不画夜光栅格（矢量灯光照画）。
   */
  function applyLookToStyle(style, look, opts) {
    opts = opts || {};
    if (!look || (!look.basemap && !look.relief && !look.lights && !look.nightRaster)) return style;
    var VP = opts.VP || root.AntiqueVectorPaint;
    var TV = opts.TV || tunerVector();
    var hide = {};
    if (!look.landcover) VP.LANDCOVER_NATIVE_IDS.concat(['vl-building']).forEach(function (id) { hide[id] = true; });
    if (!look.water) VP.overlayParts({ groups: ['water'] }).ids.water.forEach(function (id) { hide[id] = true; });
    style.layers.forEach(function (l) {
      if (hide[l.id]) { l.layout = l.layout || {}; l.layout.visibility = 'none'; }
      if (l.id === 'vl-relief') {
        l.layout = l.layout || {};
        l.layout.visibility = look.relief ? 'visible' : 'none';
        l.paint['color-relief-color'] = VP.elevationColorExpr(look.elevStops || VP.DEFAULT_ELEVATION_STOPS);
        l.paint['color-relief-opacity'] = look.reliefOpacity;
      }
      if (l.id === 'vl-hillshade' && look.hillshade) {
        var h = look.hillshade;
        if (h.exaggeration != null) l.paint['hillshade-exaggeration'] = Math.min(1, Math.max(0, +h.exaggeration || 0));
        if (h.shadowColor) l.paint['hillshade-shadow-color'] = h.shadowColor;
        if (h.highlightColor) l.paint['hillshade-highlight-color'] = h.highlightColor;
        if (h.accentColor) l.paint['hillshade-accent-color'] = h.accentColor;
      }
    });
    var night = look.nightRaster ? opts.night || null : null;
    if (night) {
      // 夜光栅格：山影之上（不被山影压暗）、水路之下
      style.sources[TV.NIGHT_SOURCE_ID] = night;
      var at = style.layers.map(function (l) { return l.id; }).indexOf('vl-hillshade');
      style.layers.splice(at >= 0 ? at + 1 : style.layers.length, 0, TV.nightLayerSpec(true));
    }
    if (look.lights) {
      TV.lightsParts(VP, { vector: { lights: true, nightRaster: !!night } }).layers.forEach(function (l) { style.layers.push(l); });
    }
    return style;
  }

  /**
   * 浏览器：建图前把夜光数据源准备好。图片源先整张载完（等经纬图顺带重投影），
   * 首帧 seek 时夜光已就位，不会出现「先暗后亮」的闪帧。失败 → null（只剩矢量灯光，逐帧仍确定）。
   */
  function prepareNight(input, base) {
    var TV = tunerVector();
    var cfg = TV.resolveNightConfig(input);
    if (!cfg) return Promise.resolve(null);
    if (cfg.tiles.length) return Promise.resolve(TV.nightSourceSpec(cfg));
    var url = new URL(cfg.image, base).href;
    return new Promise(function (resolve) {
      var img = new root.Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () {
        try {
          resolve(TV.nightSourceSpec(cfg, cfg.bounds ? url : TV.equirectToMercator(img, root.document)));
        } catch (e) {
          root.console.warn('[mapstage] 夜光图重投影失败', e);
          resolve(null);
        }
      };
      img.onerror = function () { root.console.warn('[mapstage] 夜光图加载失败：' + url); resolve(null); };
      img.src = url;
    });
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('加载失败：' + src)); };
      document.head.appendChild(s);
    });
  }

  /** 合规底图：删境界线图层、不加雾；preset 里的 vignetteStrength 在录制路径一律不使用 */
  function buildStyle(opts) {
    opts = opts || {};
    var VP = root.AntiqueVectorPaint;
    var look = opts.look;
    var night = opts.night;
    // 简写：buildStyle({ basemap: 'qinglv' })，皮肤取底图配套的（skin 可覆盖）；夜光只支持同步可得的源
    if (!look && opts.basemap) {
      look = resolveLook({}, { look: { basemap: opts.basemap, skin: opts.skin } });
      if (look.nightRaster && night === undefined) night = nightSpec(opts.nightLights, opts.assetBase);
    }
    var skin = findSkin(look && look.skinId ? look.skinId : opts.skin);
    var paint = look && look.paint ? VP.normalizePaint(look.paint) : skin.paint;
    var style = VP.buildStyle({ paint: paint, tileConfig: { terrain: VP.DEM_PRESETS.mapterhorn } });
    style.layers = style.layers.filter(function (l) { return !/^vl-boundary/.test(l.id); });
    applyLookToStyle(style, look, { VP: VP, night: night });
    if (style.sources.polarIce) {
      style.sources.polarIce.data = new URL(VP.POLAR_ICE_URL, opts.assetBase || SCRIPT_DIR || (typeof location !== 'undefined' ? location.href : 'http://localhost/')).href;
    }
    var ex = opts.terrain;
    if (ex === false) delete style.terrain;
    else style.terrain = { source: 'terrain', exaggeration: ex || 1 };
    style.glyphs = VP.GLYPHS_URL;
    return style;
  }

  function applyGrade(container, skin, presetCss) {
    var c = {};
    var base = skin.css || {};
    Object.keys(base).forEach(function (k) { c[k] = base[k]; });
    Object.keys(presetCss || {}).forEach(function (k) { c[k] = presetCss[k]; });
    var canvas = container.querySelector('.maplibregl-canvas-container') || container;
    canvas.style.filter = 'sepia(' + c.sepia + ') saturate(' + c.saturate + ') contrast(' + c.contrast + ') brightness(' + c.brightness + ') hue-rotate(' + c.hueRotate + 'deg)';
    var tint = document.createElement('div');
    tint.className = 'ms-tint';
    tint.style.cssText = 'position:absolute;inset:0;pointer-events:none;mix-blend-mode:soft-light;z-index:1';
    tint.style.background = c.warmTintColor;
    tint.style.opacity = c.warmTintAlpha;
    container.appendChild(tint);
  }

  function resolveShots(story, map, sitesById, routesById, size) {
    var pad = safePadding(size.w, size.h, story.safeArea);
    return (story.shots || []).map(function (s) {
      var out = { t: s.t, move: s.move, push: s.push, tilt: s.tilt };
      var pitch = s.pitch != null ? s.pitch : 40;
      var bearing = s.bearing || 0;
      if (s.fit != null) {
        var pts;
        if (typeof s.fit === 'string') pts = routePoints(routesById[s.fit.slice(6)], sitesById);
        else pts = s.fit.map(function (id) { return sitesById[id].lngLat; });
        var cam = fitCamera(pts, { width: size.w, height: size.h, padding: pad, pitch: pitch, bearing: bearing, maxZoom: s.maxZoom != null ? s.maxZoom : 9 });
        var zoom = cam.zoom;
        var lat = cam.center[1];
        if (s.maxSpan) {
          // maxSpan = 画面横向最大跨度（km），顶住上限时拉不再远
          var zMin = Math.log(78271.52 * Math.cos(rad(lat)) * size.w / (s.maxSpan * 1000)) / Math.LN2;
          if (zoom < zMin) zoom = zMin;
        }
        out.center = cam.center;
        out.zoom = zoom;
      } else {
        out.center = s.center.slice();
        out.zoom = s.zoom != null ? s.zoom : 5;
      }
      out.pitch = pitch;
      out.bearing = bearing;
      return out;
    });
  }

  function lineFeature(coords) {
    return { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } };
  }

  /** 角色画法 */
  var ROLE_STYLE = {
    primary: { width: 4.5, casing: true, head: true, ghost: true },
    reaction: { width: 2.5, band: 16, head: true, ghost: false },
    background: { width: 2.2, opacity: 0.55, static: true, ghost: false },
    residual: { width: 2.4, opacity: 0.6, ghost: false },
  };

  function mountRoute(map, route, sitesById, duration) {
    var role = route.role || 'primary';
    var rs = ROLE_STYLE[role];
    var color = SIDE_COLORS[route.side || 'red'];
    var coords = shapeRoute(routePoints(route, sitesById), route.curve);
    var id = 'ms-r-' + route.id;
    var win = routeWindow(route, duration);
    var width = route.width || rs.width;
    map.addSource(id + '-full', { type: 'geojson', data: lineFeature(coords) });
    map.addSource(id + '-prog', { type: 'geojson', data: lineFeature(coords.slice(0, 1)) });
    var layout = { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' };
    function L(suffix, source, paint) {
      map.addLayer({ id: id + suffix, type: 'line', source: id + source, layout: JSON.parse(JSON.stringify(layout)), paint: paint });
    }
    var showGhost = route.ghost != null ? route.ghost : rs.ghost;
    if (showGhost) L('-ghost', '-full', { 'line-color': color, 'line-width': width * 0.55, 'line-opacity': 0.28, 'line-dasharray': [1.2, 1.6] });
    if (rs.band) L('-band', '-prog', { 'line-color': color, 'line-width': rs.band, 'line-opacity': 0.3 });
    if (rs.casing) L('-casing', '-prog', { 'line-color': '#f3ead8', 'line-width': width + 3, 'line-opacity': 0.85 });
    L('-line', '-prog', { 'line-color': color, 'line-width': width, 'line-opacity': rs.opacity || 1 });
    var layerIds = [id + '-ghost', id + '-band', id + '-casing', id + '-line'].filter(function (l) { return map.getLayer(l); });
    var headEl = null;
    var head = null;
    if (rs.head) {
      headEl = document.createElement('div');
      headEl.className = 'ms-head';
      headEl.setAttribute('data-role', role);
      headEl.style.color = color;
      headEl.style.visibility = 'hidden';
      head = new root.maplibregl.Marker({ element: headEl, rotationAlignment: 'map', pitchAlignment: 'map' }).setLngLat(coords[0]).addTo(map);
    }
    var shown = null;
    return {
      id: route.id,
      render: function (t) {
        var vis = !!win && t >= win[0] && t < win[1];
        // ghost 在 draw 之前也要提前告诉观众去哪（只对 primary）
        var ghostVis = !!win && showGhost && t < win[1];
        if (shown === null || shown.vis !== vis || shown.ghost !== ghostVis) {
          layerIds.forEach(function (lid) {
            var on = /-ghost$/.test(lid) ? ghostVis : vis;
            map.setLayoutProperty(lid, 'visibility', on ? 'visible' : 'none');
          });
          shown = { vis: vis, ghost: ghostVis };
        }
        var p;
        if (rs.static) p = 1;
        else p = route.draw ? clamp01((t - route.draw[0]) / (route.draw[1] - route.draw[0])) : 1;
        var s = sliceRoute(coords, p);
        map.getSource(id + '-prog').setData(lineFeature(s.line));
        if (head) {
          head.setLngLat(s.head).setRotation(s.bearing);
          // 头部箭头只在行进中出现；画完后线留着，箭头收起
          headEl.style.visibility = vis && p > 0 && p < 1 ? 'visible' : 'hidden';
        }
      },
    };
  }

  function mountLabel(map, site) {
    var el = document.createElement('div');
    el.className = 'ms-label';
    el.setAttribute('data-state', 'normal');
    el.setAttribute('data-tier', site.tier || 'medium');
    if (site.approx || site.confidence === 'C') el.setAttribute('data-approx', '');
    var left = site.label && site.label.side === 'left';
    if (left) el.setAttribute('data-side', 'left');
    var i = document.createElement('i');
    var b = document.createElement('b');
    b.textContent = site.name;
    el.appendChild(i);
    el.appendChild(b);
    var marker = new root.maplibregl.Marker({ element: el, anchor: left ? 'right' : 'left', offset: [left ? 5 : -5, 0] }).setLngLat(site.lngLat).addTo(map);
    return { id: site.id, el: el, marker: marker };
  }

  function mountCard(layer, card) {
    var el = document.createElement('div');
    el.className = 'ms-card';
    el.setAttribute('data-kind', card.kind);
    var draw = null;
    var ready = null;
    var span = card.t1 - card.t0;
    function div(cls, text) { var d = document.createElement('div'); d.className = cls; if (text != null) d.textContent = text; return d; }

    var b = document.createElement('b');
    if (card.kind === 'photo') {
      // 照片：相框 + 资料照角标；图没加载完 seek 不放行（见 ready）
      el.appendChild(div('ms-tag', '资料照'));
      var img = document.createElement('img');
      img.alt = card.text;
      ready = new Promise(function (res) { img.onload = img.onerror = function () { res(); }; });
      img.src = card.src;
      el.appendChild(img);
      b.textContent = card.text;
      el.appendChild(b);
    } else if (card.kind === 'telegram') {
      // 电报：报头条 + 电文，按 t 逐字出现（前 60% 时长，之后整段定格）
      el.appendChild(div('ms-head-bar', '电报'));
      var full = String(card.text);
      var shown = document.createTextNode('');
      var rest = document.createElement('i');
      rest.textContent = full;
      b.appendChild(shown);
      b.appendChild(rest);
      el.appendChild(b);
      draw = function (t) {
        var n = Math.ceil(full.length * Math.max(0, Math.min(1, (t - card.t0) / (span * 0.6))));
        shown.nodeValue = full.slice(0, n);
        rest.textContent = full.slice(n);
      };
    } else if (card.kind === 'doc') {
      // 文献：红头标题 + 正文行 + 落款 + 印章
      b.textContent = card.text;
      el.appendChild(b);
      (card.lines || []).forEach(function (ln) { el.appendChild(div('ms-doc-line', ln)); });
      el.appendChild(div('ms-seal', card.seal || '印'));
    } else if (card.kind === 'table') {
      // 速查表：表头常亮，格子按 t 逐格点亮（前 70% 时长），之后整表定格
      b.textContent = card.text;
      el.appendChild(b);
      var tbl = document.createElement('table');
      tbl.className = 'ms-tbl';
      var cells = [];
      if (card.header) {
        var hr = document.createElement('tr');
        card.header.forEach(function (h) { var th = document.createElement('th'); th.textContent = h; hr.appendChild(th); });
        tbl.appendChild(hr);
      }
      card.rows.forEach(function (row) {
        var tr = document.createElement('tr');
        row.forEach(function (c) { var td = document.createElement('td'); td.textContent = c; td.setAttribute('data-lit', '0'); tr.appendChild(td); cells.push(td); });
        tbl.appendChild(tr);
      });
      el.appendChild(tbl);
      draw = function (t) {
        cells.forEach(function (td, k) {
          td.setAttribute('data-lit', t >= card.t0 + span * 0.7 * (k + 1) / cells.length ? '1' : '0');
        });
      };
    } else {
      b.textContent = card.text;
      el.appendChild(b);
    }
    if (card.sub) {
      var s = document.createElement('small');
      s.textContent = card.sub;
      el.appendChild(s);
    }
    layer.appendChild(el);
    return { t0: card.t0, t1: card.t1, el: el, draw: draw, ready: ready };
  }

  function waitSource(map, id, timeoutMs) {
    if (!map.getSource(id) || map.isSourceLoaded(id)) return Promise.resolve();
    return new Promise(function (resolve) {
      var timer = setTimeout(done, timeoutMs);
      function on() { if (map.isSourceLoaded(id)) done(); }
      function done() { clearTimeout(timer); map.off('sourcedata', on); resolve(); }
      map.on('sourcedata', on);
    });
  }

  /**
   * 挂载。返回 Promise<stage>；story 不合格时 reject（error.errors 是问题清单），不会渲染。
   * opts: { preset, story, expose = true, verifyCompliance = true, assetBase, interactive = false, preserve = false,
   *         nightLights（夜光数据源，写法同 map-tiles.config 的 nightLights；false = 不画夜光图） }
   */
  function mount(el, opts) {
    opts = opts || {};
    var base = opts.assetBase || SCRIPT_DIR || (typeof location !== 'undefined' ? location.href : 'http://localhost/');
    var needTV = wantsBasemap(opts.preset, opts.story);
    var nightCredit = '';
    return Promise.resolve().then(function () {
      if (!needTV || root.AntiqueTunerVector) return;
      return loadScript(new URL('assets/tuner-vector.js', base).href);
    }).then(function () {
      if (!needTV) return null;
      validateStory(opts.story);
      if (!resolveLook(opts.preset, opts.story).nightRaster) return null;
      var sl = opts.story.look || {};
      var cfg = opts.nightLights !== undefined ? opts.nightLights
        : sl.nightLights !== undefined ? sl.nightLights
          : root.MAP_TILE_CONFIG && root.MAP_TILE_CONFIG.nightLights;
      var nc = tunerVector().resolveNightConfig(cfg);
      nightCredit = nc && nc.attribution ? '夜光：' + nc.attribution : '';
      return prepareNight(cfg, base);
    }).then(function (night) {
      var story = opts.story;
      validateStory(story);
      if (typeof el === 'string') el = document.getElementById(el);
      var VP = root.AntiqueVectorPaint;
      var Fx = root.AntiqueMapFx;
      if (!root.maplibregl || !VP || !Fx) throw new Error('MapStage.mount 需要先加载 maplibre-gl 5.6.0、vector-paint.js 与 map-fx.js');
      ensureCss();

      var preset = opts.preset || {};
      var lookCfg = resolveLook(preset, story);
      var skinId = lookCfg.skinId;
      var skin = findSkin(skinId);
      var presetCss = {};
      Object.keys(preset.css || {}).forEach(function (k) { if (k !== 'vignetteStrength') presetCss[k] = preset.css[k]; });
      var look = preset.mapstage || preset.maplibre;
      var terrainEx = look && look.terrainExaggeration;
      var cam0 = preset.camera || {};

      el.classList.add('ms-root');
      if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
      var mapEl = document.createElement('div');
      mapEl.className = 'ms-map';
      el.appendChild(mapEl);
      var cardLayer = document.createElement('div');
      cardLayer.className = 'ms-cards';
      el.appendChild(cardLayer);
      var size = { w: el.clientWidth, h: el.clientHeight };
      el.style.setProperty('--ms-u', size.w / 1920 + 'px');

      var sites = story.sites || [];
      var sitesById = indexById(sites);
      var routesById = indexById(story.routes);

      var map = new root.maplibregl.Map({
        container: mapEl,
        canvasContextAttributes: opts.preserve ? { preserveDrawingBuffer: true } : undefined,
        style: buildStyle({ skin: skinId, look: lookCfg, night: night, terrain: (story.look && story.look.terrain != null ? story.look.terrain : terrainEx), assetBase: opts.assetBase }),
        center: cam0.center || [104, 35.5],
        zoom: cam0.zoom != null ? cam0.zoom : 4,
        pitch: cam0.pitch || 0,
        bearing: cam0.bearing || 0,
        maxPitch: 80,
        interactive: opts.interactive === true,
        // 夜光图（image 源）不带署名字段，GeoNames CC BY 署名挂在这里
        attributionControl: night && nightCredit ? { compact: true, customAttribution: nightCredit } : { compact: true },
        fadeDuration: 0,
      });

      return new Promise(function (resolve, reject) {
        map.once('error', function () { /* 瓦片错误不阻塞 load；idle 超时会告警 */ });
        map.once('load', function () {
          try {
            applyGrade(mapEl, skin, presetCss);
            var shots = resolveShots(story, map, sitesById, routesById, size);
            // 十段线在路线之下，只在 compliance.full 时段显示
            var tenDash = !(story.compliance && story.compliance.tenDash === false);
            // 暗底（夜景 / 暗夜）上深色十段线看不见，换浅色
            if (tenDash) addTenDash(map, lookCfg.dark ? { color: TEN_DASH_LIGHT } : null);
            var routes = (story.routes || []).filter(function (r) { return r.role !== 'callout'; })
              .map(function (r) { return mountRoute(map, r, sitesById, story.duration); });
            var labels = sites.map(function (s) { return mountLabel(map, s); });
            var cards = (story.cards || []).map(function (c) { return mountCard(cardLayer, c); });

            function render(t) {
              t = Math.max(0, Math.min(story.duration, t));
              if (shots.length) map.jumpTo(Fx.cameraToOpts(cameraAt(shots, t)));
              if (tenDash) setTenDashVisible(map, inFull(story, t));
              routes.forEach(function (r) { r.render(t); });
              var st = labelStates(story, t);
              labels.forEach(function (l) { l.el.setAttribute('data-state', st[l.id]); });
              cards.forEach(function (c) {
                var on = t >= c.t0 && t < c.t1;
                c.el.style.display = on ? 'block' : 'none';
                if (on && c.draw) c.draw(t);
              });
              return t;
            }

            var cardsReady = Promise.all(cards.map(function (c) { return c.ready; }).filter(Boolean));

            function seek(t) {
              // line-dasharray 等 cross-fade 属性看 zoomHistory：从上方还是下方越过整数级，虚线比例不同（帧结果依赖历史）。
              // 每次 seek 重置，让它只由本帧 zoom 决定
              if (map.style && map.style.zoomHistory) map.style.zoomHistory.first = true;
              // 有地形时图层先画进每块地形瓦片的纹理（tile.rtt）再贴到网格上，纹理跨帧复用：
              // 瓦片集合不变时沿用上一帧画的内容，近处边缘会差几十个像素。seek 时清掉，按本帧重画
              var tc = map.terrain && map.terrain.sourceCache;
              if (tc && tc.getRenderableTiles) tc.getRenderableTiles().forEach(function (tile) { tile.rtt = []; });
              var tt = render(t);
              return Fx.waitIdle(map, { force: true, timeoutMs: opts.timeoutMs || 12000 })
                .then(function () {
                  // MapLibre 在有地形时按深度图给 Marker 定遮挡透明度，且 100 ms 内只更新一次：
                  // 上一帧的节流还没过，这一帧的透明度就会沿用上一帧的值（帧结果依赖历史）。idle 后强制刷一遍。
                  // 位置同理：地形瓦片最后落地后再按最终高程重投影一次，免得带着亚像素偏差
                  labels.forEach(function (l) {
                    if (!l.marker) return;
                    l.marker.setLngLat(l.marker.getLngLat());
                    if (typeof l.marker._updateOpacity === 'function') l.marker._updateOpacity(true);
                  });
                  return cardsReady;
                })
                .then(function () {
                  // 夜光图已在建图前预载；这里兜底确认数据源已就位，否则首帧会拍到「还没有夜光」的一帧
                  if (night) return waitSource(map, tunerVector().NIGHT_SOURCE_ID, opts.timeoutMs || 12000);
                })
                .then(function () {
                  // 夜景光晕（heatmap）贴在地形上时，第一次到某个机位会晚一帧才画对（idle 时还是旧的）；
                  // 再画一帧等 idle，结果与重访时逐像素一致（verify-story-night.mjs）
                  if (!lookCfg.lights) return;
                  map.triggerRepaint();
                  return Fx.waitIdle(map, { force: true, timeoutMs: opts.timeoutMs || 12000 });
                })
                .then(function () {
                  // 字卡 / 地名首次出现时才会触发 webfont 子集下载；等它落地再交帧，否则会拍到回退字体
                  var d = root.document;
                  if (d && d.fonts && d.fonts.ready) { void cardLayer.offsetHeight; return d.fonts.ready; }
                })
                .then(function () { return tt; });
            }

            function sampleTimes(step) {
              var set = {};
              for (var x = 0; x <= story.duration + 1e-9; x += step) set[Math.min(story.duration, x)] = true;
              shots.forEach(function (s) { set[s.t] = true; });
              return Object.keys(set).map(Number).sort(function (a, b) { return a - b; });
            }

            function precache(popts) {
              popts = popts || {};
              var cams = sampleTimes(popts.step || 0.5).map(function (t) { return cameraAt(shots, t); });
              return Fx.precacheViewports(map, cams, { restore: false, timeoutMs: popts.timeoutMs }).then(function () {
                return seek(0);
              }).then(function () { return { count: cams.length }; });
            }

            function check(t) {
              render(t);
              var full = inFull(story, t);
              var issues = complianceCheck(map, { full: full, tenDash: tenDash });
              var counts = countsAt(story, t);
              ['primary', 'reaction', 'active', 'names'].forEach(function (k) {
                issues.push({ id: 'limit-' + k, label: '同屏 ' + k + ' ≤ ' + LIMITS[k], ok: counts[k] <= LIMITS[k], note: String(counts[k]) });
              });
              return { t: t, full: full, counts: counts, ok: issues.every(function (i) { return i.ok; }), issues: issues };
            }

            var stage = {
              duration: story.duration,
              fps: story.fps || 30,
              map: map,
              story: story,
              look: lookCfg,
              shots: shots,
              // 地名元素 { id: el }：交互页（Play）直接切 data-state，不经过 render(t)
              labels: labels.reduce(function (m, l) { m[l.id] = l.el; return m; }, {}),
              seek: seek,
              render: render,
              precache: precache,
              check: check,
              destroy: function () { map.remove(); el.classList.remove('ms-root'); mapEl.remove(); cardLayer.remove(); },
            };

            // compliance.full：每秒自检一次，不过就拒绝渲染
            if (opts.verifyCompliance !== false && story.compliance && story.compliance.full) {
              var bad = [];
              story.compliance.full.forEach(function (w) {
                for (var x = w[0]; x <= w[1] + 1e-9; x += 1) {
                  var r = check(Math.min(x, w[1]));
                  r.issues.filter(function (i) { return !i.ok; }).forEach(function (i) { bad.push('t=' + r.t + 's：' + i.label + '未通过'); });
                }
              });
              if (bad.length) {
                map.remove();
                var e = new Error('合规自检未通过：\n' + bad.map(function (m, i) { return '  ' + (i + 1) + '. ' + m; }).join('\n'));
                e.name = 'StoryComplianceError';
                e.errors = bad;
                throw e;
              }
            }

            render(0);
            if (opts.expose !== false) {
              root.__mapstageSeek = seek;
              root.__mapstageDuration = story.duration;
            }
            resolve(stage);
          } catch (err) {
            reject(err);
          }
        });
      });
    });
  }

  return {
    mount: mount,
    validateStory: validateStory,
    lintStory: lintStory,
    countsAt: countsAt,
    labelStates: labelStates,
    routeWindow: routeWindow,
    shapeRoute: shapeRoute,
    complianceCheck: complianceCheck,
    COMPLIANCE_POINTS: COMPLIANCE_POINTS,
    TEN_DASH: TEN_DASH,
    addTenDash: addTenDash,
    setTenDashVisible: setTenDashVisible,
    LIMITS: LIMITS,
    SIDE_COLORS: SIDE_COLORS,
    SAFE_AREA: SAFE_AREA,
    TEN_DASH_INK: TEN_DASH_INK,
    TEN_DASH_LIGHT: TEN_DASH_LIGHT,
    contrastRatio: contrastRatio,
    haversineKm: haversineKm,
    bearingDeg: bearingDeg,
    sliceRoute: sliceRoute,
    arc: arc,
    bbox: bbox,
    safePadding: safePadding,
    normPadding: normPadding,
    projectGround: projectGround,
    unprojectGround: unprojectGround,
    fitCamera: fitCamera,
    smoothstep: smoothstep,
    cameraAt: cameraAt,
    buildStyle: buildStyle,
    wantsBasemap: wantsBasemap,
    resolveLook: resolveLook,
    applyLookToStyle: applyLookToStyle,
    nightSpec: nightSpec,
  };
});
