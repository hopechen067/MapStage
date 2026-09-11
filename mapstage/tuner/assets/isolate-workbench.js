/**
 * Isolate workbench for the layers editor.
 * Map projection → patched terrain clip (island). Globe → parchment mask.
 * Browser: window.AntiqueIsolateWorkbench
 */
(function (root) {
  'use strict';

  var GROUP_ORDER = [
    { id: 'north', label: '华北' },
    { id: 'northeast', label: '东北' },
    { id: 'east', label: '华东' },
    { id: 'central', label: '中南' },
    { id: 'southwest', label: '西南' },
    { id: 'northwest', label: '西北' },
    { id: 'special', label: '港澳台' },
  ];
  var EMPTY = { type: 'FeatureCollection', features: [] };

  function hexRgba(hex) {
    var h = String(hex || '#6d4a36').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    if (!isFinite(n)) return [0.427, 0.29, 0.212, 1];
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
  }

  var ISOLATE_DATA_REL = 'assets/region-isolate-data.js?v=20260911-searchfix';
  var isolateDataPromise = null;

  function isolateDataSrc() {
    var base = root.__TUNER_BASE__ || '';
    if (base && base.charAt(base.length - 1) !== '/') base += '/';
    return base + ISOLATE_DATA_REL;
  }

  function ensureIsolateData() {
    if (root.REGION_ISOLATE_DATA) return Promise.resolve(root.REGION_ISOLATE_DATA);
    if (isolateDataPromise) return isolateDataPromise;
    isolateDataPromise = new Promise(function (resolve, reject) {
      var src = isolateDataSrc();
      var existing = document.querySelector('script[data-antique-isolate-data="1"]');
      function ok() {
        if (root.REGION_ISOLATE_DATA) resolve(root.REGION_ISOLATE_DATA);
        else {
          isolateDataPromise = null;
          reject(new Error('REGION_ISOLATE_DATA missing'));
        }
      }
      function fail() {
        isolateDataPromise = null;
        reject(new Error('isolate data failed: ' + src));
      }
      if (existing) {
        existing.addEventListener('load', ok);
        existing.addEventListener('error', fail);
        return;
      }
      var s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.setAttribute('data-antique-isolate-data', '1');
      s.onload = ok;
      s.onerror = fail;
      document.head.appendChild(s);
    });
    return isolateDataPromise;
  }

  function mount(opts) {
    opts = opts || {};
    var map = opts.map;
    var maplibregl = opts.maplibregl || root.maplibregl;
    var FX = opts.FX || root.AntiqueMapFx;
    var state = {
      enabled: !!opts.enabled,
      regionId: opts.regionId || 'china',
      sideColor: opts.sideColor || '#6d4a36',
      customFeature: opts.customFeature || null,
    };
    var islandClipSig = '';
    var islandWallSig = '';
    var islandWallGen = 0;
    var islandWallsNeedSettle = false;
    var islandMotionKey = '';
    var isolateMaskKind = '';
    var isolateMaskRegion = '';
    var isolateVisLast = '';
    var ready = false;

    function getViewMode() {
      return opts.getViewMode ? opts.getViewMode() : 'map';
    }
    function toast(msg) {
      if (opts.toast) opts.toast(msg);
    }
    function emit() {
      syncToggleUi();
      if (opts.onChange) opts.onChange(getState());
    }
    function wrapEl() {
      return opts.wrapEl || document.getElementById('map') || document.body;
    }

    function currentFeature() {
      var api = root.REGION_ISOLATE;
      if (!api) return null;
      var feat = null;
      if (state.regionId === 'custom' && state.customFeature) feat = state.customFeature;
      else {
        var region = api.findRegion(root.REGION_ISOLATE_DATA, state.regionId);
        feat = region && region.feature ? region.feature : null;
      }
      if (!feat) return null;
      if (typeof api.narrativeFeature === 'function') return api.narrativeFeature(feat) || feat;
      return feat;
    }

    function hasFeature() {
      return !!currentFeature();
    }

    function usesIsland() {
      return !!(
        state.enabled &&
        hasFeature() &&
        getViewMode() !== 'globe' &&
        root.AntiqueTerrainIsland &&
        root.AntiqueTerrainIsland.patched()
      );
    }

    function wantedMaskKind() {
      if (!(state.enabled && hasFeature())) return 'empty';
      if (usesIsland()) return 'island';
      if (getViewMode() === 'globe') return 'simple';
      if (map && typeof map.getZoom === 'function' && map.getZoom() < 4.5) return 'simple';
      return 'tiled';
    }

    function voidColor() {
      var Island = root.AntiqueTerrainIsland;
      return (Island && (Island.VOID || Island.PAPER)) || '#14110e';
    }

    function applyVoidPaint() {
      if (!map) return;
      var island = usesIsland();
      var voidCol = voidColor();
      var mapBg = '#04070d';
      var canvas = typeof map.getCanvas === 'function' ? map.getCanvas() : null;
      if (canvas && canvas.style) canvas.style.background = island ? voidCol : mapBg;
      var wrap = wrapEl();
      if (wrap && wrap.classList) wrap.classList.toggle('is-island', island);
      document.documentElement.classList.toggle('is-island', island);
    }

    function applySideColor() {
      var clip = root.__antiqueTerrainClip;
      if (!clip) return;
      clip.sideColor = hexRgba(state.sideColor);
      if (map && map.triggerRepaint) map.triggerRepaint();
    }

    function clipSig() {
      if (!usesIsland()) return 'off';
      var Island = root.AntiqueTerrainIsland;
      var feat = currentFeature();
      var merc = feat && Island && Island.clipMercatorBbox
        ? Island.clipMercatorBbox(map, feat)
        : feat && Island && Island.mercatorBbox
          ? Island.mercatorBbox(feat)
          : null;
      var box = merc
        ? [merc.x0, merc.y0, merc.x1, merc.y1].map(function (n) { return Number(n).toFixed(5); }).join(',')
        : 'nobox';
      var verts = 0;
      try {
        var g = feat && feat.geometry;
        var polys = g && g.type === 'Polygon' ? [g.coordinates] : (g && g.coordinates) || [];
        for (var p = 0; p < polys.length; p++) verts += ((polys[p] && polys[p][0]) || []).length;
      } catch (e) { verts = 0; }
      return 'on:' + state.regionId + ':' + box + ':' + verts;
    }

    function wallSig() {
      if (!usesIsland() || !map) return 'off';
      var t = typeof map.getTerrain === 'function' ? map.getTerrain() : null;
      var ex = t && t.exaggeration != null ? t.exaggeration : 0;
      var z = typeof map.getZoom === 'function' ? map.getZoom() : 0;
      var Island = root.AntiqueTerrainIsland;
      var feat = currentFeature();
      var merc = Island && Island.clipMercatorBbox ? Island.clipMercatorBbox(map, feat) : null;
      var box = merc
        ? [merc.x0, merc.y0, merc.x1, merc.y1].map(function (n) { return Number(n).toFixed(4); }).join(',')
        : '';
      var pitch = typeof map.getPitch === 'function' ? map.getPitch() : 0;
      var bearing = typeof map.getBearing === 'function' ? map.getBearing() : 0;
      return (
        'on:' +
        state.regionId +
        ':' +
        ex +
        ':' +
        box +
        ':' +
        (Math.round(z * 2) / 2) +
        ':' +
        Math.round(pitch) +
        ':' +
        Math.round(bearing)
      );
    }

    function scheduleWalls(force) {
      var Island = root.AntiqueTerrainIsland;
      if (!Island || !map) return;
      void force;
      islandWallGen += 1;
      islandWallsNeedSettle = false;
      // FM-0903-14: mesh drop-down is the visible skirt. Overlay walls
      // sit on the block top as a pale fence — never sync them live.
      // FM-0903-16: do not wait-idle + repaint on camera settle.
      Island.syncWalls(map, maplibregl, null);
      islandWallSig = usesIsland() ? 'mesh-only' : 'off';
    }

    function applyIsland(forceOpts) {
      forceOpts = forceOpts || {};
      var Island = root.AntiqueTerrainIsland;
      if (!Island || !map) return;
      var use = usesIsland();
      var canvas = typeof map.getCanvas === 'function' ? map.getCanvas() : null;
      var motionKey =
        state.regionId +
        ':' +
        Math.floor(map.getZoom()) +
        ':' +
        ((canvas && canvas.clientWidth) || 0);
      if (
        !forceOpts.forceClip &&
        use &&
        islandClipSig &&
        islandClipSig.indexOf('on:') === 0 &&
        typeof Island.featureFitsClipTexture === 'function' &&
        Island.featureFitsClipTexture(map, currentFeature()) &&
        motionKey === islandMotionKey
      ) {
        return;
      }
      var sig = clipSig();
      try {
        if (forceOpts.forceClip || sig !== islandClipSig) {
          if (use) {
            root.__islandLast = Island.setClip(map, currentFeature(), { force: !!forceOpts.forceClip });
            if (root.__islandLast && root.__islandLast.ok === false) {
              // Clip failed → drop island mode and fall through to silhouette mask
              // so the viewport is never a blank void.
              try { Island.clearClip(map); } catch (eClr) { /* ignore */ }
              islandClipSig = 'fallback-mask';
              islandMotionKey = '';
              applyVoidPaint();
              sync();
              return;
            }
            applyVoidPaint();
            applySideColor();
            islandWallsNeedSettle = false;
            Island.syncWalls(map, maplibregl, null);
            if (typeof map.setSky === 'function') map.setSky(Island.islandSky());
            islandClipSig = sig;
            islandMotionKey = motionKey;
          } else {
            root.__islandLast = Island.clearClip(map);
            islandWallGen += 1;
            islandWallsNeedSettle = false;
            Island.syncWalls(map, maplibregl, null);
            islandWallSig = 'off';
            islandMotionKey = '';
            applyVoidPaint();
            if (typeof map.setSky === 'function') {
              if (getViewMode() === 'globe' && opts.globeSky) map.setSky(opts.globeSky());
              else if (FX && FX.antiqueSky) map.setSky(FX.antiqueSky());
            }
            islandClipSig = sig;
          }
        }
        if (forceOpts.forceWalls) scheduleWalls(true);
      } catch (e) {
        root.__islandLast = { ok: false, reason: String(e && e.message ? e.message : e) };
        console.warn('isolate applyIsland', e);
      }
    }

    function ensureLayers() {
      if (!map) return;
      if (!map.getSource('region-mask')) {
        map.addSource('region-mask', {
          type: 'geojson',
          data: EMPTY,
          tolerance: 0,
          buffer: 256,
        });
      }
      if (!map.getSource('region-outline')) {
        map.addSource('region-outline', {
          type: 'geojson',
          data: EMPTY,
          tolerance: 0,
          buffer: 256,
        });
      }
      if (!map.getSource('region-maritime')) {
        map.addSource('region-maritime', {
          type: 'geojson',
          data: EMPTY,
          tolerance: 0,
          buffer: 256,
        });
      }
      var vis =
        state.enabled && hasFeature() && wantedMaskKind() !== 'empty' && wantedMaskKind() !== 'island'
          ? 'visible'
          : 'none';
      var outlineVis =
        state.enabled && hasFeature() && wantedMaskKind() !== 'island' ? 'visible' : 'none';
      var maritimeVis = state.enabled && hasFeature() ? 'visible' : 'none';
      var bg = usesIsland()
        ? voidColor()
        : (opts.getBackground ? opts.getBackground() : '#04070d');
      if (!map.getLayer('region-mask-fill')) {
        map.addLayer({
          id: 'region-mask-fill',
          type: 'fill',
          source: 'region-mask',
          paint: {
            'fill-color': bg,
            'fill-outline-color': bg,
            'fill-opacity': 1,
            'fill-antialias': true,
          },
          layout: { visibility: vis },
        });
      }
      if (!map.getLayer('region-edge-seal')) {
        map.addLayer({
          id: 'region-edge-seal',
          type: 'line',
          source: 'region-outline',
          layout: { visibility: vis, 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': bg, 'line-width': 5.5, 'line-opacity': 1, 'line-blur': 0.45 },
        });
      }
      if (!map.getLayer('region-outline')) {
        map.addLayer({
          id: 'region-outline',
          type: 'line',
          source: 'region-outline',
          paint: { 'line-color': 'rgba(72, 58, 42, 0.5)', 'line-width': 1.15 },
          layout: { visibility: outlineVis },
        });
      }
      // Soft glow under 十段线 so 海域 reads on the black isolate void.
      if (!map.getLayer('region-maritime-glow')) {
        map.addLayer({
          id: 'region-maritime-glow',
          type: 'line',
          source: 'region-maritime',
          layout: {
            visibility: maritimeVis,
            'line-join': 'round',
            'line-cap': 'round',
          },
          paint: {
            'line-color': 'rgba(255, 214, 140, 0.35)',
            'line-width': 6.5,
            'line-blur': 1.2,
          },
        });
      }
      if (!map.getLayer('region-maritime-line')) {
        map.addLayer({
          id: 'region-maritime-line',
          type: 'line',
          source: 'region-maritime',
          layout: {
            visibility: maritimeVis,
            'line-join': 'round',
            'line-cap': 'round',
          },
          paint: {
            // Bright dash: ten-dash maritime claim on isolate void / dark basemap.
            'line-color': 'rgba(255, 220, 150, 0.98)',
            'line-width': 3.1,
            'line-dasharray': [1.6, 1.1],
          },
        });
      }
      // Flat silhouette underlay — always drawn under island terrain so a
      // black WebGL/terrain failure still shows China land + islands.
      if (!map.getSource('region-silhouette')) {
        map.addSource('region-silhouette', {
          type: 'geojson',
          data: EMPTY,
          tolerance: 0,
          buffer: 256,
        });
      }
      if (!map.getLayer('region-silhouette-fill')) {
        map.addLayer(
          {
            id: 'region-silhouette-fill',
            type: 'fill',
            source: 'region-silhouette',
            layout: { visibility: state.enabled && hasFeature() ? 'visible' : 'none' },
            paint: {
              'fill-color': 'rgba(196, 150, 96, 0.22)',
              'fill-outline-color': 'rgba(236, 210, 150, 0.55)',
            },
          },
          map.getLayer('satellite') ? 'satellite' : undefined
        );
      }
      if (!map.getLayer('region-silhouette-line')) {
        map.addLayer({
          id: 'region-silhouette-line',
          type: 'line',
          source: 'region-silhouette',
          layout: {
            visibility: state.enabled && hasFeature() ? 'visible' : 'none',
            'line-join': 'round',
            'line-cap': 'round',
          },
          paint: {
            'line-color': 'rgba(236, 210, 150, 0.9)',
            'line-width': 1.6,
          },
        });
      }
    }

    function currentMaritimeLines() {
      var api = root.REGION_ISOLATE;
      if (!api || !root.REGION_ISOLATE_DATA) return null;
      var region = api.findRegion(root.REGION_ISOLATE_DATA, state.regionId);
      return region && region.maritimeLines ? region.maritimeLines : null;
    }

    function restack() {
      [
        'region-mask-fill',
        'region-edge-seal',
        'region-outline',
        'region-silhouette-fill',
        'region-silhouette-line',
        'region-maritime-glow',
        'region-maritime-line',
      ].forEach(function (id) {
        if (map.getLayer && map.getLayer(id)) {
          try { map.moveLayer(id); } catch (e) { /* ignore */ }
        }
      });
    }

    function sync() {
      if (!map || !ready) return;
      ensureLayers();
      var island = usesIsland();
      var kind = wantedMaskKind();
      var vis = state.enabled && hasFeature() && kind !== 'empty' && kind !== 'island' ? 'visible' : 'none';
      var outlineVis = state.enabled && hasFeature() && !island ? 'visible' : 'none';
      var feat = state.enabled && hasFeature() ? currentFeature() : null;
      var api = root.REGION_ISOLATE;
      var regionKey = state.regionId + (feat && feat.properties && feat.properties.id ? feat.properties.id : '');
      var regionChanged = regionKey !== isolateMaskRegion || outlineVis !== isolateVisLast;
      var maskChanged = kind !== isolateMaskKind || regionChanged;
      if (map.getSource('region-mask') && api && maskChanged) {
        var mask = null;
        if (feat && kind !== 'empty' && kind !== 'island') {
          mask = kind === 'simple' && typeof api.buildSimpleMaskGeoJSON === 'function'
            ? api.buildSimpleMaskGeoJSON(feat)
            : api.buildMaskGeoJSON(feat);
        }
        map.getSource('region-mask').setData(mask || EMPTY);
        isolateMaskKind = kind;
        isolateMaskRegion = regionKey;
        root.__tunerMaskKind = kind;
      }
      if (map.getSource('region-outline') && api && regionChanged) {
        var outline = feat ? api.featureFromUnknown(feat) : null;
        map.getSource('region-outline').setData(outline || EMPTY);
      }
      if (map.getSource('region-maritime')) {
        var maritime = state.enabled ? currentMaritimeLines() : null;
        map.getSource('region-maritime').setData(maritime || EMPTY);
      }
      var marVis =
        state.enabled && hasFeature() && currentMaritimeLines() ? 'visible' : 'none';
      if (map.getLayer('region-maritime-glow')) {
        map.setLayoutProperty('region-maritime-glow', 'visibility', marVis);
      }
      if (map.getLayer('region-maritime-line')) {
        map.setLayoutProperty('region-maritime-line', 'visibility', marVis);
      }
      if (map.getSource('region-silhouette')) {
        var sil = feat ? (api && api.featureFromUnknown ? api.featureFromUnknown(feat) : feat) : null;
        map.getSource('region-silhouette').setData(sil || EMPTY);
      }
      var silVis = state.enabled && hasFeature() ? 'visible' : 'none';
      if (map.getLayer('region-silhouette-fill')) {
        map.setLayoutProperty('region-silhouette-fill', 'visibility', silVis);
      }
      if (map.getLayer('region-silhouette-line')) {
        map.setLayoutProperty('region-silhouette-line', 'visibility', silVis);
      }
      isolateVisLast = outlineVis;
      var bg = island ? voidColor() : (opts.getBackground ? opts.getBackground() : '#04070d');
      if (map.getLayer('region-mask-fill')) {
        map.setLayoutProperty('region-mask-fill', 'visibility', vis);
        map.setPaintProperty('region-mask-fill', 'fill-color', bg);
        map.setPaintProperty('region-mask-fill', 'fill-outline-color', island ? 'rgba(0,0,0,0)' : bg);
      }
      if (map.getLayer('region-edge-seal')) {
        map.setLayoutProperty('region-edge-seal', 'visibility', island ? 'none' : vis);
        map.setPaintProperty('region-edge-seal', 'line-color', bg);
      }
      if (map.getLayer('region-outline')) {
        map.setLayoutProperty('region-outline', 'visibility', outlineVis);
      }
      applyIsland();
      restack();
      updateSeasHint(false);
      root.__vectorIsolateState = getState();
    }

    function frameRegion(extra) {
      if (!map || !FX) return;
      extra = extra || {};
      var id = state.regionId;
      var jump = typeof FX.easeToCamera === 'function' ? FX.easeToCamera : null;
      var to = typeof FX.jumpTo === 'function' ? FX.jumpTo.bind(FX, map) : function (cam) { map.jumpTo(cam); };
      // Full China framing includes 藏南 + SCS islands + 十段线 (not mainland-only).
      if (!id || id === 'china') {
        var chinaCam = extra.seas
          ? { center: [114.2, 15.8], zoom: 3.55, pitch: 42, bearing: -12 }
          : { center: [108.0, 28.5], zoom: 3.25, pitch: 44, bearing: -14 };
        if (jump) jump(map, chinaCam, 900);
        else to(chinaCam);
        return;
      }
      var feat = currentFeature();
      if (!feat || typeof FX.reliefCameraForFeature !== 'function') return;
      var cam = FX.reliefCameraForFeature(map, feat, { bearing: 12 });
      if (!cam) return;
      if (jump) jump(map, cam, 900);
      else to(cam);
    }

    function frameSeas() {
      if (state.regionId !== 'china') {
        setRegion('china', { frame: false, enable: true });
      } else if (!state.enabled) {
        setEnabled(true, false);
      }
      // Allow setRegion async path to settle, then frame seas.
      setTimeout(function () {
        frameRegion({ seas: true });
        updateSeasHint(true);
      }, 50);
    }

    function updateSeasHint(flash) {
      var el = opts.seasHintEl || document.getElementById('vl-isolate-seas-hint');
      if (!el) return;
      var show =
        state.enabled &&
        state.regionId === 'china' &&
        !!currentMaritimeLines();
      el.style.display = show ? 'block' : 'none';
      if (flash && show) {
        el.classList.add('flash');
        setTimeout(function () { el.classList.remove('flash'); }, 1200);
      }
    }

    function addOption(host, id, label) {
      var opt = document.createElement('option');
      opt.value = id;
      opt.textContent = label;
      host.appendChild(opt);
    }

    function regionSearchQuery() {
      var el = opts.searchEl || document.getElementById('vl-isolate-region-search');
      return el ? String(el.value || '').trim().toLowerCase() : '';
    }

    function labelMatchesQuery(label, q) {
      if (!q) return true;
      return String(label || '').toLowerCase().indexOf(q) >= 0;
    }

    function renderSelect() {
      var sel = opts.selectEl || document.getElementById('vl-isolate-region');
      if (!sel) return;
      var api = root.REGION_ISOLATE;
      var regions = api ? api.listRegions(root.REGION_ISOLATE_DATA) : [];
      var prev = state.regionId || 'china';
      var q = regionSearchQuery();
      if (!regions.length) {
        sel.innerHTML = '';
        var ogStub = document.createElement('optgroup');
        ogStub.label = '全国';
        addOption(ogStub, prev, prev === 'china' ? '中国' : prev);
        sel.appendChild(ogStub);
        sel.value = prev;
        sel.disabled = false;
        var cityRowStub = opts.cityRowEl || document.getElementById('vl-isolate-cities');
        if (cityRowStub) cityRowStub.style.display = 'none';
        return;
      }
      var citiesByParent = {};
      regions.forEach(function (r) {
        if (r && r.kind === 'city' && r.parentId) {
          (citiesByParent[r.parentId] || (citiesByParent[r.parentId] = [])).push(r);
        }
      });
      Object.keys(citiesByParent).forEach(function (k) {
        citiesByParent[k].sort(function (a, b) {
          return a.label.localeCompare(b.label, 'zh');
        });
      });
      sel.innerHTML = '';
      var ogNation = document.createElement('optgroup');
      ogNation.label = '全国';
      var nation = regions.filter(function (r) { return r.kind === 'nation' || r.id === 'china'; });
      nation.forEach(function (r) {
        var nLabel = r.label || r.id;
        if (labelMatchesQuery(nLabel, q) || r.id === prev) addOption(ogNation, r.id, nLabel);
      });
      if (state.customFeature && (labelMatchesQuery('粘贴轮廓', q) || prev === 'custom')) {
        addOption(ogNation, 'custom', '粘贴轮廓');
      }
      if (ogNation.children.length) sel.appendChild(ogNation);
      var provinces = regions.filter(function (r) {
        return r.kind !== 'nation' && r.id !== 'china' && r.kind !== 'city';
      });
      var ordered = [];
      GROUP_ORDER.forEach(function (meta) {
        provinces.filter(function (p) { return p.group === meta.id; }).forEach(function (p) { ordered.push(p); });
      });
      provinces.filter(function (p) {
        return !p.group || !GROUP_ORDER.some(function (m) { return m.id === p.group; });
      }).forEach(function (p) { ordered.push(p); });
      ordered.forEach(function (p) {
        var pLabel = p.label || p.id;
        var provinceOptLabel = pLabel + '（全省）';
        var cities = citiesByParent[p.id] || [];
        var provinceHit = !q || labelMatchesQuery(pLabel, q) || labelMatchesQuery(provinceOptLabel, q);
        var matchedCities = cities.filter(function (c) {
          return !q || labelMatchesQuery(c.label || c.id, q) || c.id === prev;
        });
        var keepSelectedProvince = prev === p.id;
        if (!provinceHit && !matchedCities.length && !keepSelectedProvince) return;
        var showCities = provinceHit ? cities : matchedCities;
        if (!q) showCities = cities;
        var og = document.createElement('optgroup');
        og.label = pLabel;
        if (provinceHit || keepSelectedProvince) addOption(og, p.id, provinceOptLabel);
        showCities.forEach(function (c) {
          addOption(og, c.id, c.label || c.id);
        });
        if (og.children.length) sel.appendChild(og);
      });
      var ids = [];
      for (var i = 0; i < sel.options.length; i++) ids.push(sel.options[i].value);
      if (q && !ids.length) {
        var ogEmpty = document.createElement('optgroup');
        ogEmpty.label = '无匹配';
        addOption(ogEmpty, '', '无匹配「' + regionSearchQueryRaw() + '」');
        sel.appendChild(ogEmpty);
        sel.options[0].disabled = true;
      }
      if (ids.indexOf(prev) >= 0) sel.value = prev;
      else if (!q && ids.length) {
        sel.value = ids[0];
        state.regionId = ids[0];
      }
      sel.disabled = false;
      // Keep a visible listbox so typing visibly shrinks options (closed
      // native <select> looks inert while filtering).
      var visible = ids.length || (q ? 1 : 0);
      sel.size = Math.max(6, Math.min(14, visible || 6));
      sel.classList.toggle('is-filtering', !!q);

      var cityRow = opts.cityRowEl || document.getElementById('vl-isolate-cities');
      if (cityRow) {
        cityRow.innerHTML = '';
        var active = regions.filter(function (r) { return r.id === (sel.value || prev); })[0];
        var parentProv = null;
        if (active && active.kind === 'city' && active.parentId) {
          parentProv = regions.filter(function (r) { return r.id === active.parentId; })[0] || null;
        } else if (active && active.kind === 'province') {
          parentProv = active;
        }
        var cityList = parentProv ? citiesByParent[parentProv.id] || [] : [];
        if (q) {
          cityList = cityList.filter(function (c) {
            return labelMatchesQuery(c.label || c.id, q);
          });
        }
        if (parentProv && cityList.length) {
          cityRow.style.display = '';
          var lab = document.createElement('span');
          lab.className = 'isolate-group-label';
          lab.textContent = parentProv.label + ' · 市级' + (q ? '（筛选）' : '');
          cityRow.appendChild(lab);
          cityList.forEach(function (c) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn' + (c.id === sel.value ? ' active' : '');
            btn.textContent = c.label || c.id;
            btn.addEventListener('click', function () { setRegion(c.id, { frame: true, enable: true }); });
            cityRow.appendChild(btn);
          });
        } else {
          cityRow.style.display = 'none';
        }
      }
      renderRegionResults(regions, citiesByParent, q, prev);
    }

    function regionSearchQueryRaw() {
      var el = opts.searchEl || document.getElementById('vl-isolate-region-search');
      return el ? String(el.value || '').trim() : '';
    }

    function renderRegionResults(regions, citiesByParent, q, prev) {
      var host = opts.resultsEl || document.getElementById('vl-isolate-region-results');
      if (!host) return;
      host.innerHTML = '';
      host.hidden = false;
      var rows = [];
      function pushRow(id, label, meta) {
        rows.push({ id: id, label: label, meta: meta || '' });
      }
      regions.forEach(function (r) {
        if (!r) return;
        if (r.kind === 'nation' || r.id === 'china') {
          if (labelMatchesQuery(r.label || r.id, q) || r.id === prev) {
            pushRow(r.id, r.label || r.id, '全国');
          }
          return;
        }
        if (r.kind === 'city') return;
        var pLabel = r.label || r.id;
        var cities = citiesByParent[r.id] || [];
        var provinceHit = !q || labelMatchesQuery(pLabel, q);
        var matchedCities = cities.filter(function (c) {
          return !q || labelMatchesQuery(c.label || c.id, q) || c.id === prev;
        });
        if (!provinceHit && !matchedCities.length && r.id !== prev) return;
        if (provinceHit || r.id === prev) pushRow(r.id, pLabel + '（全省）', pLabel);
        (provinceHit && q ? cities : matchedCities).forEach(function (c) {
          if (!q) return; // full tree lives in the listbox; results list is for search hits
          pushRow(c.id, c.label || c.id, pLabel);
        });
        if (!q && r.id === prev) {
          // no-op: idle state uses native listbox
        }
      });
      if (!q) {
        host.hidden = true;
        host.innerHTML = '';
        return;
      }
      if (!rows.length) {
        var empty = document.createElement('div');
        empty.className = 'isolate-result empty';
        empty.textContent = '无匹配「' + regionSearchQueryRaw() + '」';
        host.appendChild(empty);
        return;
      }
      // Deduplicate by id while preserving order
      var seen = {};
      rows.forEach(function (row) {
        if (seen[row.id]) return;
        seen[row.id] = true;
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'isolate-result' + (row.id === prev ? ' active' : '');
        btn.setAttribute('data-region-id', row.id);
        btn.innerHTML = '<span class="isolate-result-label"></span><span class="isolate-result-meta"></span>';
        btn.querySelector('.isolate-result-label').textContent = row.label;
        btn.querySelector('.isolate-result-meta').textContent = row.meta;
        btn.addEventListener('click', function () {
          setRegion(row.id, { frame: true, enable: true });
        });
        host.appendChild(btn);
      });
    }

    function syncToggleUi() {
      var sw = opts.toggleEl || document.getElementById('sw-isolate');
      if (sw) {
        sw.classList.toggle('on', !!state.enabled);
        sw.setAttribute('aria-pressed', state.enabled ? 'true' : 'false');
      }
      var side = opts.sideColorEl || document.getElementById('vl-island-side');
      if (side && side.value && side.value !== state.sideColor) side.value = state.sideColor;
      renderSelect();
    }

    function applyEnabled(on, frame) {
      state.enabled = !!on;
      if (state.enabled && getViewMode() === 'globe' && opts.onNeedMap) opts.onNeedMap();
      sync();
      if (frame && state.enabled) frameRegion();
      emit();
    }

    function setEnabled(on, frame) {
      if (on) {
        ensureIsolateData()
          .then(function () { applyEnabled(true, frame); })
          .catch(function (e) {
            console.warn('[isolate] data', e);
            toast('拆出轮廓未加载');
          });
        return;
      }
      applyEnabled(false, frame);
    }

    function applyRegion(id, extra) {
      extra = extra || {};
      state.regionId = id || 'china';
      if (extra.enable) state.enabled = true;
      if (state.enabled && getViewMode() === 'globe' && extra.enable && opts.onNeedMap) opts.onNeedMap();
      sync();
      if (extra.frame !== false && state.enabled) frameRegion();
      emit();
    }

    function setRegion(id, extra) {
      extra = extra || {};
      if (extra.enable || state.enabled) {
        ensureIsolateData()
          .then(function () { applyRegion(id, extra); })
          .catch(function (e) {
            console.warn('[isolate] data', e);
            toast('拆出轮廓未加载');
          });
        return;
      }
      applyRegion(id, extra);
    }

    function setSideColor(hex) {
      state.sideColor = hex || '#6d4a36';
      applySideColor();
      emit();
    }

    function toggle() {
      if (state.enabled) {
        applyEnabled(false, true);
        toast('拆出关');
        return getState();
      }
      ensureIsolateData()
        .then(function () {
          if (!hasFeature()) {
            toast('没有可拆出的轮廓');
            return;
          }
          applyEnabled(true, true);
          toast(usesIsland()
            ? '拆出开 · 独立地形块，皮肤不变'
            : '拆出开 · 区外遮盖，皮肤不变');
        })
        .catch(function (e) {
          console.warn('[isolate] data', e);
          toast('拆出轮廓未加载');
        });
      return getState();
    }

    function pasteGeoJSON(obj) {
      var api = root.REGION_ISOLATE;
      if (!api) {
        toast('拆出模块未加载');
        return null;
      }
      var feat = api.featureFromUnknown(obj);
      if (!feat) {
        toast('需为 Polygon / MultiPolygon / Feature');
        return null;
      }
      state.customFeature = feat;
      state.regionId = 'custom';
      state.enabled = true;
      sync();
      frameRegion();
      emit();
      toast('已应用粘贴轮廓');
      return getState();
    }

    function getState() {
      return {
        enabled: !!state.enabled,
        regionId: state.regionId,
        island: usesIsland(),
        patched: !!(root.AntiqueTerrainIsland && root.AntiqueTerrainIsland.patched()),
        sideColor: state.sideColor,
        maskKind: isolateMaskKind || wantedMaskKind(),
      };
    }

    function prefetchIsolateData() {
      ensureIsolateData()
        .then(function () {
          // Render even before start()/map load so search works immediately.
          renderSelect();
        })
        .catch(function () { /* keep stub select until retry */ });
    }

    function bind() {
      var sw = opts.toggleEl || document.getElementById('sw-isolate');
      if (sw && !sw._isoBound) {
        sw._isoBound = true;
        sw.addEventListener('click', function () { toggle(); });
        sw.addEventListener('pointerenter', prefetchIsolateData);
      }
      var sel = opts.selectEl || document.getElementById('vl-isolate-region');
      if (sel && !sel._isoBound) {
        sel._isoBound = true;
        sel.addEventListener('change', function (ev) {
          setRegion(ev.target.value, { frame: true, enable: true });
        });
        sel.addEventListener('pointerenter', prefetchIsolateData);
        sel.addEventListener('focus', prefetchIsolateData);
      }
      var search = opts.searchEl || document.getElementById('vl-isolate-region-search');
      if (search && !search._isoBound) {
        search._isoBound = true;
        var onSearch = function () {
          // Synchronous path when data already in page — avoids “typed but
          // nothing happened” while a Promise microtask is pending.
          if (root.REGION_ISOLATE_DATA) {
            renderSelect();
            return;
          }
          ensureIsolateData()
            .then(function () { renderSelect(); })
            .catch(function () { renderSelect(); });
        };
        search.addEventListener('input', onSearch);
        search.addEventListener('search', onSearch);
        search.addEventListener('pointerenter', prefetchIsolateData);
        search.addEventListener('focus', prefetchIsolateData);
      }
      var paste = opts.pasteEl || document.getElementById('btn-isolate-paste');
      if (paste && !paste._isoBound) {
        paste._isoBound = true;
        paste.addEventListener('click', function () {
          if (!navigator.clipboard || !navigator.clipboard.readText) {
            toast('无法读剪贴板');
            return;
          }
          navigator.clipboard.readText().then(function (text) {
            try { pasteGeoJSON(JSON.parse(text)); } catch (e) {
              toast('粘贴轮廓失败：不是有效 GeoJSON');
            }
          }).catch(function () { toast('无法读剪贴板'); });
        });
      }
      var side = opts.sideColorEl || document.getElementById('vl-island-side');
      if (side && !side._isoBound) {
        side._isoBound = true;
        side.addEventListener('input', function () { setSideColor(side.value); });
      }
      var seasBtn = opts.seasBtnEl || document.getElementById('btn-isolate-seas');
      if (seasBtn && !seasBtn._isoBound) {
        seasBtn._isoBound = true;
        seasBtn.addEventListener('click', function () { frameSeas(); });
      }
    }

    function start() {
      ready = true;
      bind();
      function go() {
        syncToggleUi();
        ensureLayers();
        sync();
        if (map && !map._antiqueIsoMoveBound) {
          map._antiqueIsoMoveBound = true;
          map.on('moveend', function () {
            if (!ready || !usesIsland()) return;
            applyIsland();
          });
        }
        if (state.enabled) frameRegion();
        emit();
      }
      if (state.enabled) {
        ensureIsolateData().then(go).catch(function (e) {
          console.warn('[isolate] data', e);
          go();
        });
      } else {
        go();
      }
    }

    function setMap(nextMap) {
      map = nextMap || null;
      if (ready) {
        ensureLayers();
        sync();
      }
    }

    // Bind search/select immediately — do not wait for map `load` / start().
    // Otherwise typing into the search box looks dead until WebGL is ready.
    bind();
    prefetchIsolateData();

    return {
      start: start,
      sync: sync,
      toggle: toggle,
      setEnabled: setEnabled,
      setRegion: setRegion,
      setSideColor: setSideColor,
      setMap: setMap,
      pasteGeoJSON: pasteGeoJSON,
      frameRegion: frameRegion,
      frameSeas: frameSeas,
      getState: getState,
      currentFeature: currentFeature,
    };
  }

  root.AntiqueIsolateWorkbench = {
    mount: mount,
    ensureIsolateData: ensureIsolateData,
  };
})(typeof window !== 'undefined' ? window : this);
