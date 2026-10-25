/**
 * 古地图色调调参器 (tuner/index.html) — map, panel and state wiring.
 * Stateless helpers live in tuner-util.js / tuner-params.js;
 * styles live in tuner.css.
 */
(function () {
  'use strict';

  // Stateless helpers: assets/tuner-util.js, tuner-params.js
  const {
    deepClone, round, parseColor, toRgba, hexToRgb, getByPath, setByPath, formatNum,
  } = window.AntiqueTunerUtil;
  const {
    PRESET_ID, STORAGE_KEY, DEFAULT_PARAMS, VIEW_CHINA, VIEW_RELIEF, BASELINE_REF,
    mergeParams, MAP_MIN_ZOOM, GLOBE_MIN_ZOOM, GLOBE_CAM, LIGHTING, THEMES, globeSky,
  } = window.AntiqueTunerParams;

  // ============================================================
  // 瓦片主机预热
  // ============================================================

  // 按实际瓦片配置预热连接(高德 webst / S3 Terrarium / EOX 任一组合),
  // 每组主机省 1-2 个 RTT;静态 head 里的 EOX preconnect 覆盖不到本地换源场景
  (function preconnectTileHosts() {
    try {
      var cfg = window.MAP_TILE_CONFIG;
      var seen = {};
      if (cfg) {
        [cfg.satellite, cfg.terrain].forEach(function (block) {
          if (block && block.enabled && Array.isArray(block.tiles)) {
            block.tiles.forEach(function (u) {
              try {
                var uo = new URL(u);
                seen[uo.origin] = true;
              } catch (e) {
                /* ignore */
              }
            });
          }
        });
      }
      Object.keys(seen)
        .slice(0, 6)
        .forEach(function (origin) {
          var link = document.createElement('link');
          link.rel = 'preconnect';
          link.href = origin;
          link.crossOrigin = 'anonymous';
          document.head.appendChild(link);
        });
    } catch (e) {
      /* ignore */
    }
  })();

  // ============================================================
  // 工具函数
  // ============================================================

  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () {
      el.classList.remove('show');
    }, 1800);
  }

  // ============================================================
  // 状态
  // ============================================================
  let params = deepClone(DEFAULT_PARAMS);
  let map = null;
  let mapReady = false;
  let isolateMaskKind = '';
  let isolateMaskRegion = '';
  let isolateVisLast = '';
  let islandClipSig = '';
  let islandWallSig = '';
  let islandWallGen = 0;
  let islandWallsNeedSettle = false;
  let islandMotionKey = '';


  let customIsolateFeature = null;
  // OpenFreeMap 矢量水系 / 道路的图层 id（buildMapStyle 里由 AntiqueVectorPaint.overlayParts 生成）
  let vectorOverlayIds = { water: [], roads: [] };
  let vectorCtl = null;
  /** 面板控件 + 地图都按 params.vector 重写一遍（预设导入 / 重置 / 投影切换后用） */
  function syncVector() {
    if (!vectorCtl) return;
    vectorCtl.syncUi();
    vectorCtl.applyToMap();
  }
  let vectorOverlayWidthSig = '';
  let syncingFromMap = false; // 防止相机回写时循环
  let hanCityLayer = null; // MapLibre custom layer 实例（含 setVisible）
  let terrainRising = false;

  // 尝试从 localStorage 恢复。
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      params = mergeParams(DEFAULT_PARAMS, saved);
      // 旧默认羊皮纸底 → 黑色；用户自定义过的其它底色不改
      var prevBg = params.maplibre && params.maplibre.backgroundColor;
      if (prevBg && String(prevBg).toLowerCase() === '#c8c2b4') {
        params.maplibre.backgroundColor = '#000000';
      }
    }
  } catch (e) {
    console.warn('localStorage 读取失败', e);
  }

  function exportParams() {
    // 导出结构与 preset-antique-default.json 对齐
    const out = {
      id: params.id || PRESET_ID,
      label: params.label || DEFAULT_PARAMS.label,
      version: params.version || 1,
      season: params.season || null,
      camera: {
        center: [round(params.camera.center[0], 4), round(params.camera.center[1], 4)],
        zoom: round(params.camera.zoom, 2),
        pitch: round(params.camera.pitch, 1),
        bearing: round(params.camera.bearing, 1),
      },
      mapstage: {
        backgroundColor: params.maplibre.backgroundColor,
        terrainExaggeration: round(params.maplibre.terrainExaggeration, 3),
        satellite: {
          opacity: round(params.maplibre.satellite.opacity, 3),
          saturation: round(params.maplibre.satellite.saturation, 3),
          contrast: round(params.maplibre.satellite.contrast, 3),
          brightnessMin: round(params.maplibre.satellite.brightnessMin, 3),
          brightnessMax: round(params.maplibre.satellite.brightnessMax, 3),
          hueRotate: round(params.maplibre.satellite.hueRotate, 1),
        },
        hillshade: {
          exaggeration: round(params.maplibre.hillshade.exaggeration, 3),
          illuminationDirection: Math.round(params.maplibre.hillshade.illuminationDirection),
          shadowColor: params.maplibre.hillshade.shadowColor,
          highlightColor: params.maplibre.hillshade.highlightColor,
          accentColor: params.maplibre.hillshade.accentColor,
        },
        water: {
          lakeFill: params.maplibre.water.lakeFill,
          riverLevel3: params.maplibre.water.riverLevel3,
          riverLevel2: params.maplibre.water.riverLevel2,
          riverLevel1: params.maplibre.water.riverLevel1,
          riverL3Width: round(params.maplibre.water.riverL3Width, 2),
          riverL2Width: round(params.maplibre.water.riverL2Width, 2),
          riverL1Width: round(params.maplibre.water.riverL1Width, 2),
        },
      },
      css: {
        sepia: round(params.css.sepia, 3),
        saturate: round(params.css.saturate, 3),
        contrast: round(params.css.contrast, 3),
        brightness: round(params.css.brightness, 3),
        hueRotate: round(params.css.hueRotate, 1),
        warmTintAlpha: round(params.css.warmTintAlpha, 3),
        warmTintColor: params.css.warmTintColor,
        vignetteStrength: round(params.css.vignetteStrength, 3),
      },
      ui: {
        showWater: !!(params.ui && params.ui.showWater),
        showRoads: !(params.ui && params.ui.showRoads === false),
        showCities: params.ui && params.ui.showCities !== false,
        showRef: !!(params.ui && params.ui.showRef),
        showRegionIsolate: !!(params.ui && params.ui.showRegionIsolate),
        regionIsolateId: (params.ui && params.ui.regionIsolateId) || 'china',
        viewMode: (params.ui && params.ui.viewMode) === 'globe' ? 'globe' : 'map',
        sceneId: (params.ui && params.ui.sceneId) || 'china',
        lightingId: (params.ui && params.ui.lightingId) || 'night',
        themeId: (params.ui && params.ui.themeId) || 'antique',
        islandSideColor: (params.ui && params.ui.islandSideColor) || '#6d4a36',
        skin: (params.ui && params.ui.skinId) || undefined,
        basemapId: (params.ui && params.ui.basemapId) || undefined,
      },
      cities: {
        dataFile: (params.cities && params.cities.dataFile) || 'assets/sample-sites.json',
        halfKm: round((params.cities && params.cities.halfKm) != null ? params.cities.halfKm : 18, 2),
        renderMode: (params.cities && params.cities.renderMode) || 'fill-extrusion',
      },
      vector: exportVector(),
    };
    return out;
  }

  function exportVector() {
    const v = params.vector || DEFAULT_PARAMS.vector;
    const o = {
      relief: !!v.relief,
      reliefOpacity: round(v.reliefOpacity != null ? v.reliefOpacity : 1, 2),
      contour: !!v.contour,
      landcover: !!v.landcover,
      lights: !!v.lights,
      nightRaster: !!v.nightRaster,
    };
    if (v.paint) o.paint = deepClone(v.paint);
    if (v.elevStops) o.elevStops = deepClone(v.elevStops);
    return o;
  }

  let persistTimer = 0;
  function persistNow() {
    persistTimer = 0;
    try {
      const data = exportParams();
      data.ui = params.ui;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('localStorage 写入失败', e);
    }
  }
  function persist() {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(persistNow, 280);
  }
  window.addEventListener('pagehide', persistNow);

  // ============================================================
  // CSS 滤镜 & 叠层
  // ============================================================
  function buildCssFilter() {
    const c = params.css;
    return (
      'sepia(' + c.sepia + ') ' +
      'saturate(' + c.saturate + ') ' +
      'contrast(' + c.contrast + ') ' +
      'brightness(' + c.brightness + ') ' +
      'hue-rotate(' + c.hueRotate + 'deg)'
    );
  }

  function applyCssOverlays() {
    const filterEl = document.getElementById('map-canvas-filter');
    const warmEl = document.getElementById('warm-tint');
    const vigEl = document.getElementById('vignette');
    const c = params.css;
    let sepia = c.sepia;
    let sat = c.saturate;
    let con = c.contrast;
    let bri = c.brightness;
    let hue = c.hueRotate;
    let warmA = c.warmTintAlpha;
    let vig = c.vignetteStrength;
    if (params.ui.viewMode === 'globe' && map && typeof map.getZoom === 'function') {
      const z = map.getZoom();
      if (z < 5) {
        const t = Math.max(0, (z - 1.5) / 3.5);
        sepia = sepia * t;
        sat = 1 + (sat - 1) * t;
        con = 1 + (con - 1) * t;
        bri = 1 + (bri - 1) * t;
        hue = hue * t;
        warmA = warmA * (0.25 + 0.75 * t);
        vig = vig * (0.3 + 0.7 * t);
      }
    }
    filterEl.style.filter =
      'sepia(' + sepia + ') saturate(' + sat + ') contrast(' + con + ') brightness(' + bri +
      ') hue-rotate(' + hue + 'deg)';

    const rgb = hexToRgb(params.css.warmTintColor);
    warmEl.style.background =
      'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + warmA + ')';

    vigEl.style.background =
      'radial-gradient(ellipse at center, transparent 42%, rgba(46,28,16,' + vig + ') 100%)';

    const filterStr = filterEl.style.filter;
    const stCss = document.getElementById('st-css');
    if (stCss) stCss.textContent = filterStr;
    const cssSum = document.getElementById('css-summary');
    if (cssSum) {
      cssSum.textContent =
        'filter: ' + filterStr + ';\n' +
        'warm-tint: ' + warmEl.style.background + ' / soft-light;\n' +
        'vignette: strength ' + vig;
    }
  }

  // ============================================================
  // MapLibre 图层更新
  // ============================================================
  function safeSetPaint(layerId, prop, value) {
    if (!mapReady || !map.getLayer(layerId)) return;
    try {
      map.setPaintProperty(layerId, prop, value);
    } catch (e) {
      console.warn('setPaint', layerId, prop, e);
    }
  }

  function isolateCatalogAvailable() {
    const api = window.REGION_ISOLATE;
    if (!api) return false;
    return api.listRegions(window.REGION_ISOLATE_DATA).length > 0;
  }

  function currentIsolateFeature() {
    const api = window.REGION_ISOLATE;
    if (!api) return null;
    let feat = null;
    if (params.ui.regionIsolateId === 'custom' && customIsolateFeature) {
      feat = customIsolateFeature;
    } else {
      const region = api.findRegion(window.REGION_ISOLATE_DATA, params.ui.regionIsolateId);
      feat = region && region.feature ? region.feature : null;
    }
    if (!feat) return null;
    if (typeof api.narrativeFeature === 'function') {
      return api.narrativeFeature(feat) || feat;
    }
    return feat;
  }

  function hasIsolateFeature() {
    return !!currentIsolateFeature();
  }

  /**
   * 选中的始终 zoom 到目标地：全国 → 全国视角；省 / 市 / 自定义 → relief 相机框住轮廓。
   * 仅在用户切换区域时调用（页面加载恢复预设时不抢相机）。
   */
  function frameIsolateRegion() {
    if (!mapReady || !map) return;
    const F = window.AntiqueMapFx;
    if (!F || typeof F.easeToCamera !== 'function') return;
    const id = params.ui.regionIsolateId;
    if (!id || id === 'china') {
      F.easeToCamera(map, {
        center: [103.6, 35.2],
        zoom: 3.85,
        pitch: 46,
        bearing: -16,
      }, 900);
      return;
    }
    const feat = currentIsolateFeature();
    if (!feat) return;
    const cam = F.reliefCameraForFeature(map, feat, { bearing: 12 });
    if (cam) F.easeToCamera(map, cam, 900);
  }

  function applyTerrainForIsolate() {
    if (!mapReady || !map || terrainRising) return;
    const tcfg = window.__tunerTileConfig;
    const F = window.AntiqueMapFx;
    try {
      if (tcfg && tcfg.terrain && tcfg.terrain.enabled) {
        if (F) {
          F.setTerrainEx(map, tcfg.terrain.sourceId || 'terrain', params.maplibre.terrainExaggeration, {
            budget: false,
          });
        } else {
          map.setTerrain({
            source: tcfg.terrain.sourceId || 'terrain',
            exaggeration: params.maplibre.terrainExaggeration,
          });
        }
        updateFxStatus();
      }
    } catch (e) {
      console.warn('setTerrain failed', e);
    }
  }

  function updateFxStatus() {
    const el = document.getElementById('st-fx');
    if (!el || !map) return;
    const t = typeof map.getTerrain === 'function' ? map.getTerrain() : null;
    const ex = t && t.exaggeration != null ? t.exaggeration : 'off';
    el.textContent = '夸张 ' + ex + ' · 调用 setTerrain ×' + (map.__antiqueSetTerrainCount || 0);
  }

  function onMotionLodChange(moving) {
    if (moving) return;
    if (!terrainRising) applyTerrainForIsolate();
  }

  function updateIsolateSelect() {
    const sel = document.getElementById('isolate-region');
    if (!sel) return;
    const api = window.REGION_ISOLATE;
    const regions = api ? api.listRegions(window.REGION_ISOLATE_DATA) : [];
    const prev = params.ui.regionIsolateId || 'china';
    const citiesByParent = {};
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

    // 下拉：optgroup 按省分组（省 + 其地级市）
    sel.innerHTML = '';
    function addOption(host, id, label) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = label;
      host.appendChild(opt);
    }
    const ogNation = document.createElement('optgroup');
    ogNation.label = '全国';
    const nation = regions.filter(function (r) { return r.kind === 'nation' || r.id === 'china'; });
    nation.forEach(function (r) { addOption(ogNation, r.id, r.label || r.id); });
    sel.appendChild(ogNation);

    const groupOrder = [
      { id: 'north', label: '华北' },
      { id: 'northeast', label: '东北' },
      { id: 'east', label: '华东' },
      { id: 'central', label: '中南' },
      { id: 'southwest', label: '西南' },
      { id: 'northwest', label: '西北' },
      { id: 'special', label: '港澳台' },
      { id: 'maritime', label: '海域' },
    ];
    const provinces = regions.filter(function (r) {
      return r.kind !== 'nation' && r.id !== 'china' && r.kind !== 'city';
    });
    const orderedProvinces = [];
    groupOrder.forEach(function (meta) {
      provinces
        .filter(function (p) { return p.group === meta.id; })
        .forEach(function (p) { orderedProvinces.push(p); });
    });
    provinces
      .filter(function (p) { return !p.group || !groupOrder.some(function (m) { return m.id === p.group; }); })
      .forEach(function (p) { orderedProvinces.push(p); });

    orderedProvinces.forEach(function (p) {
      const og = document.createElement('optgroup');
      og.label = p.label || p.id;
      addOption(og, p.id, (p.label || p.id) + '（全省）');
      (citiesByParent[p.id] || []).forEach(function (c) {
        addOption(og, c.id, c.label || c.id);
      });
      sel.appendChild(og);
    });
    if (customIsolateFeature) addOption(ogNation, 'custom', '粘贴轮廓');

    const ids = [];
    for (let i = 0; i < sel.options.length; i++) ids.push(sel.options[i].value);
    if (ids.indexOf(prev) >= 0) sel.value = prev;
    else if (ids.length) {
      sel.value = ids[0];
      params.ui.regionIsolateId = ids[0];
    }
    sel.disabled = ids.length === 0;

    // 芯片行：全国 + 34 省（市级不铺平，放到省份下的子行）
    const row = document.getElementById('isolate-region-btns');
    if (row) {
      row.innerHTML = '';
      function addChip(host, r) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn' + (r.id === sel.value ? ' active' : '');
        btn.textContent = r.label || r.id;
        btn.dataset.isolateId = r.id;
        btn.addEventListener('click', function () {
          params.ui.regionIsolateId = r.id;
          sel.value = r.id;
          if (!params.ui.showRegionIsolate) params.ui.showRegionIsolate = true;
          updateRegionIsolate();
          frameIsolateRegion();
          persist();
        });
        host.appendChild(btn);
      }
      if (nation.length) {
        const g = document.createElement('div');
        g.className = 'isolate-group';
        const lab = document.createElement('span');
        lab.className = 'isolate-group-label';
        lab.textContent = '全国';
        g.appendChild(lab);
        nation.forEach(function (r) { addChip(g, r); });
        row.appendChild(g);
      }
      groupOrder.forEach(function (meta) {
        const list = provinces.filter(function (p) { return p.group === meta.id; });
        if (!list.length) return;
        const g = document.createElement('div');
        g.className = 'isolate-group';
        const lab = document.createElement('span');
        lab.className = 'isolate-group-label';
        lab.textContent = meta.label;
        g.appendChild(lab);
        list.forEach(function (p) { addChip(g, p); });
        row.appendChild(g);
      });
      const leftover = provinces.filter(function (p) {
        return !p.group || !groupOrder.some(function (m) { return m.id === p.group; });
      });
      if (leftover.length) {
        const g = document.createElement('div');
        g.className = 'isolate-group';
        leftover.forEach(function (p) { addChip(g, p); });
        row.appendChild(g);
      }
    }

    // 市级子行：选中省 / 省内市时展示该省的地级市
    const cityRow = document.getElementById('isolate-city-btns');
    if (cityRow) {
      cityRow.innerHTML = '';
      const active = regions.filter(function (r) { return r.id === sel.value; })[0];
      let parentProv = null;
      if (active && active.kind === 'city' && active.parentId) {
        parentProv = regions.filter(function (r) { return r.id === active.parentId; })[0] || null;
      } else if (active && active.kind === 'province') {
        parentProv = active;
      }
      const cityList = parentProv ? citiesByParent[parentProv.id] || [] : [];
      if (parentProv && cityList.length) {
        cityRow.style.display = '';
        const lab = document.createElement('span');
        lab.className = 'isolate-group-label';
        lab.textContent = parentProv.label + ' · 市级';
        cityRow.appendChild(lab);
        cityList.forEach(function (c) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'btn' + (c.id === sel.value ? ' active' : '');
          btn.textContent = c.label || c.id;
          btn.dataset.isolateId = c.id;
          btn.addEventListener('click', function () {
            params.ui.regionIsolateId = c.id;
            sel.value = c.id;
            if (!params.ui.showRegionIsolate) params.ui.showRegionIsolate = true;
            updateRegionIsolate();
            frameIsolateRegion();
            persist();
          });
          cityRow.appendChild(btn);
        });
      } else {
        cityRow.style.display = 'none';
      }
    }
  }

  function updateIsolateUi() {
    const btn = document.getElementById('btn-isolate');
    if (btn) {
      btn.classList.toggle('active', !!params.ui.showRegionIsolate);
      btn.disabled = !hasIsolateFeature() && !isolateCatalogAvailable();
    }
    updateIsolateSelect();
    const warn = document.getElementById('isolate-warn');
    if (warn) {
      warn.style.display = isolateCatalogAvailable() ? 'none' : 'block';
    }
  }

  function isolateUsesIsland() {
    return !!(
      params.ui.showRegionIsolate &&
      hasIsolateFeature() &&
      params.ui.viewMode !== 'globe' &&
      window.AntiqueTerrainIsland &&
      window.AntiqueTerrainIsland.patched()
    );
  }

  function isolateWantedMaskKind() {
    if (!(params.ui.showRegionIsolate && hasIsolateFeature())) return 'empty';
    if (isolateUsesIsland()) return 'island';
    if (params.ui.viewMode === 'globe') return 'simple';
    if (map && typeof map.getZoom === 'function' && map.getZoom() < 4.5) return 'simple';
    return 'tiled';
  }

  function islandVoidColor() {
    const Island = window.AntiqueTerrainIsland;
    return (Island && (Island.VOID || Island.PAPER)) || '#14110e';
  }

  function applyIslandVoidPaint() {
    if (!map || typeof map.setPaintProperty !== 'function') return;
    const color = isolateUsesIsland() ? islandVoidColor() : params.maplibre.backgroundColor;
    if (map.getLayer && map.getLayer('background')) {
      map.setPaintProperty('background', 'background-color', color);
    }
    const canvas = typeof map.getCanvas === 'function' ? map.getCanvas() : null;
    if (canvas && canvas.style) canvas.style.background = color;
  }

  function currentIslandClipSig() {
    if (!isolateUsesIsland()) return 'off';
    const Island = window.AntiqueTerrainIsland;
    const feat = currentIsolateFeature();
    const merc =
      feat && Island && Island.clipMercatorBbox
        ? Island.clipMercatorBbox(map, feat)
        : feat && Island && Island.mercatorBbox
          ? Island.mercatorBbox(feat)
          : null;
    const box = merc
      ? [merc.x0, merc.y0, merc.x1, merc.y1].map(function (n) { return Number(n).toFixed(5); }).join(',')
      : 'nobox';
    let verts = 0;
    try {
      const g = feat && feat.geometry;
      const polys = g && g.type === 'Polygon' ? [g.coordinates] : (g && g.coordinates) || [];
      for (let p = 0; p < polys.length; p++) verts += ((polys[p] && polys[p][0]) || []).length;
    } catch (e) {
      verts = 0;
    }
    return 'on:' + String(params.ui.regionIsolateId || '') + ':' + box + ':' + verts;
  }

  function currentIslandWallSig() {
    if (!isolateUsesIsland() || !map) return 'off';
    const t = typeof map.getTerrain === 'function' ? map.getTerrain() : null;
    const ex = t && t.exaggeration != null ? t.exaggeration : 0;
    const z = typeof map.getZoom === 'function' ? map.getZoom() : 0;
    const Island = window.AntiqueTerrainIsland;
    const feat = currentIsolateFeature();
    const merc =
      Island && Island.clipMercatorBbox ? Island.clipMercatorBbox(map, feat) : null;
    const box = merc
      ? [merc.x0, merc.y0, merc.x1, merc.y1]
          .map(function (n) { return Number(n).toFixed(4); })
          .join(',')
      : '';
    const pitch = typeof map.getPitch === 'function' ? map.getPitch() : 0;
    const bearing = typeof map.getBearing === 'function' ? map.getBearing() : 0;
    return (
      'on:' +
      String(params.ui.regionIsolateId || '') +
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

  function scheduleIslandWalls(force) {
    const Island = window.AntiqueTerrainIsland;
    if (!Island || !map) return;
    void force;
    islandWallGen += 1;
    islandWallsNeedSettle = false;
    // FM-0903-14: mesh drop-down is the visible skirt. Overlay walls
    // sit on the block top as a pale fence ? never sync them live.
    // FM-0903-16: do not wait-idle + repaint on camera settle; overlay is gone.
    Island.syncWalls(map, maplibregl, null);
    islandWallSig = isolateUsesIsland() ? 'mesh-only' : 'off';
  }

  function islandMotionCheapKey() {
    if (!map) return 'nomap';
    const canvas = typeof map.getCanvas === 'function' ? map.getCanvas() : null;
    return (
      String(params.ui.regionIsolateId || '') +
      ':' +
      Math.floor(map.getZoom()) +
      ':' +
      ((canvas && canvas.clientWidth) || 0) +
      'x' +
      ((canvas && canvas.clientHeight) || 0)
    );
  }

  function shouldApplyTerrainIsland() {
    if (!isolateUsesIsland()) return !!(islandClipSig && islandClipSig !== 'off');
    // Always re-check: clipMercatorBbox is cheap and keeps the live window
    // while it still covers the view, so setClip only runs when the camera
    // actually leaves it. A zoom-band shortcut here left stale windows.
    return true;
  }

  function islandSideRgba() {
    const hex = (params.ui && params.ui.islandSideColor) || '#6d4a36';
    const p = parseColor(hex);
    const h = String(p.hex || '#6d4a36').replace('#', '');
    const n = parseInt(h, 16);
    if (!isFinite(n)) return [0.427, 0.29, 0.212, 1];
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
  }

  function applyIslandSideColor() {
    const clip = window.__antiqueTerrainClip;
    if (!clip) return;
    clip.sideColor = islandSideRgba();
    if (map && map.triggerRepaint) map.triggerRepaint();
  }

  function applyTerrainIsland(opts) {
    opts = opts || {};
    const Island = window.AntiqueTerrainIsland;
    if (!Island || !map) return;
    const wrap = document.getElementById('map-wrap');
    const use = isolateUsesIsland();
    const clipSig = currentIslandClipSig();
    try {
      if (opts.forceClip || clipSig !== islandClipSig) {
        if (use) {
          window.__islandLast = Island.setClip(map, currentIsolateFeature(), {
            force: !!opts.forceClip,
          });
          if (window.__islandLast && window.__islandLast.ok === false) {
            return;
          }
          islandWallsNeedSettle = false;
          Island.syncWalls(map, maplibregl, null);
          if (typeof map.setSky === 'function') map.setSky(Island.islandSky());
          if (wrap) wrap.classList.add('is-island');
          applyIslandVoidPaint();
          applyIslandSideColor();
          islandClipSig = clipSig;
          islandMotionKey = islandMotionCheapKey();
        } else {
          window.__islandLast = Island.clearClip(map);
          islandWallGen += 1;
          islandWallsNeedSettle = false;
          Island.syncWalls(map, maplibregl, null);
          islandWallSig = 'off';
          islandMotionKey = '';
          if (wrap) wrap.classList.remove('is-island');
          applyIslandVoidPaint();
          if (typeof map.setSky === 'function') {
            if (params.ui.viewMode === 'globe') map.setSky(globeSky());
            else if (window.AntiqueMapFx) map.setSky(window.AntiqueMapFx.antiqueSky());
          }
          islandClipSig = clipSig;
        }
      }
      if (opts.forceWalls) scheduleIslandWalls(true);
    } catch (e) {
      window.__islandLast = { ok: false, reason: String(e && e.message ? e.message : e) };
      console.warn('applyTerrainIsland', e);
    }
  }

  function updateRegionIsolate() {
    if (!mapReady || !map) return;
    const island = isolateUsesIsland();
    const vis =
      params.ui.showRegionIsolate && hasIsolateFeature() && !island ? 'visible' : 'none';
    const outlineVis =
      params.ui.showRegionIsolate && hasIsolateFeature() && !island ? 'visible' : 'none';
    const feat = params.ui.showRegionIsolate && hasIsolateFeature() ? currentIsolateFeature() : null;
    const api = window.REGION_ISOLATE;
    const kind = isolateWantedMaskKind();
    const regionKey = (params.ui.regionIsolateId || '') + (feat && feat.properties && feat.properties.id ? feat.properties.id : '');
    const regionChanged = regionKey !== isolateMaskRegion || outlineVis !== isolateVisLast;
    const maskChanged = kind !== isolateMaskKind || regionChanged;
    if (map.getSource('region-mask') && api && maskChanged) {
      var mask = null;
      // Island clip already discards exterior terrain; tiled parchment
      // setData of scanline trapezoids freezes the main thread.
      if (feat && kind !== 'island' && kind !== 'empty') {
        mask =
          kind === 'simple' && typeof api.buildSimpleMaskGeoJSON === 'function'
            ? api.buildSimpleMaskGeoJSON(feat)
            : api.buildMaskGeoJSON(feat);
      }
      map.getSource('region-mask').setData(
        mask || { type: 'FeatureCollection', features: [] }
      );
      isolateMaskKind = kind;
      isolateMaskRegion = regionKey;
      window.__tunerMaskKind = kind;
    }
    if (map.getSource('region-outline') && api && regionChanged) {
      const outline = feat ? api.featureFromUnknown(feat) : null;
      map.getSource('region-outline').setData(
        outline || { type: 'FeatureCollection', features: [] }
      );
    }
    isolateVisLast = outlineVis;
    if (map.getLayer('region-mask-fill')) {
      map.setLayoutProperty('region-mask-fill', 'visibility', vis);
      map.setPaintProperty('region-mask-fill', 'fill-color', params.maplibre.backgroundColor);
      map.setPaintProperty('region-mask-fill', 'fill-outline-color', params.maplibre.backgroundColor);
    }
    if (map.getLayer('region-edge-seal')) {
      map.setLayoutProperty('region-edge-seal', 'visibility', vis);
      map.setPaintProperty('region-edge-seal', 'line-color', params.maplibre.backgroundColor);
    }
    if (map.getLayer('region-outline')) {
      map.setLayoutProperty('region-outline', 'visibility', outlineVis);
    }
    applyTerrainForIsolate();
    applyTerrainIsland();
    restackIsolateAboveOverlays();
    updateIsolateUi();
    updateCitiesVisibility();
  }

  function isolateKeepsPoint(lng, lat) {
    if (!params.ui.showRegionIsolate) return true;
    const feat = currentIsolateFeature();
    const api = window.REGION_ISOLATE;
    if (!feat || !api || typeof api.pointInFeature !== 'function') return true;
    return api.pointInFeature(lng, lat, feat);
  }

  function restackIsolateAboveOverlays() {
    if (!mapReady || !map || !map.getLayer('region-mask-fill')) return;
    try {
      map.moveLayer('region-mask-fill');
    } catch (e) {
      /* ignore */
    }
    if (map.getLayer('region-edge-seal')) {
      try {
        map.moveLayer('region-edge-seal');
      } catch (eSeal) {
        /* ignore */
      }
    }
    if (map.getLayer('region-outline')) {
      try {
        map.moveLayer('region-outline');
      } catch (e2) {
        /* ignore */
      }
    }
  }

  function addRegionIsolateLayers() {
    if (!map.getSource('region-mask')) {
      map.addSource('region-mask', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        tolerance: 0,
        buffer: 256,
      });
    }
    if (!map.getSource('region-outline')) {
      map.addSource('region-outline', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        tolerance: 0,
        buffer: 256,
      });
    }
    const vis = params.ui.showRegionIsolate && hasIsolateFeature() && !isolateUsesIsland() ? 'visible' : 'none';
    // Island clip already has a 3d skirt; a draped 2d outline reads as a
    // gold fence on the satellite top. Match updateRegionIsolate / workbench.
    const outlineVis = vis;
    if (!map.getLayer('region-mask-fill')) {
      map.addLayer({
        id: 'region-mask-fill',
        type: 'fill',
        source: 'region-mask',
        paint: {
          'fill-color': params.maplibre.backgroundColor,
          'fill-outline-color': params.maplibre.backgroundColor,
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
        layout: {
          visibility: vis,
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': params.maplibre.backgroundColor,
          'line-width': 5.5,
          'line-opacity': 1,
          'line-blur': 0.45,
        },
      });
    }
    if (!map.getLayer('region-outline')) {
      map.addLayer({
        id: 'region-outline',
        type: 'line',
        source: 'region-outline',
        paint: {
          'line-color': 'rgba(72, 58, 42, 0.5)',
          'line-width': 1.15,
        },
        layout: { visibility: outlineVis },
      });
    }
    updateRegionIsolate();
  }

  let applyMapStylesRaf = 0;
  function applyMapStyles() {
    if (!mapReady) return;
    if (applyMapStylesRaf) return;
    applyMapStylesRaf = requestAnimationFrame(function () {
      applyMapStylesRaf = 0;
      applyMapStylesNow();
    });
  }
  function applyMapStylesNow() {
    if (!mapReady) return;
    const m = params.maplibre;
    const s = m.satellite;
    const h = m.hillshade;
    const w = m.water;

    safeSetPaint(
      'background',
      'background-color',
      isolateUsesIsland() ? islandVoidColor() : m.backgroundColor
    );

    if (map.getLayer('region-mask-fill')) {
      map.setPaintProperty('region-mask-fill', 'fill-color', m.backgroundColor);
      map.setPaintProperty('region-mask-fill', 'fill-outline-color', m.backgroundColor);
    }
    if (map.getLayer('region-edge-seal')) {
      map.setPaintProperty('region-edge-seal', 'line-color', m.backgroundColor);
    }

    // 卫星
    safeSetPaint('satellite', 'raster-opacity', s.opacity);
    safeSetPaint('satellite', 'raster-saturation', s.saturation);
    safeSetPaint('satellite', 'raster-contrast', s.contrast);
    safeSetPaint('satellite', 'raster-brightness-min', s.brightnessMin);
    safeSetPaint('satellite', 'raster-brightness-max', s.brightnessMax);
    safeSetPaint('satellite', 'raster-hue-rotate', s.hueRotate);

    // 山影 — keep visible; isolate clip discards off-island mesh, not this layer
    if (map.getLayer && map.getLayer('hillshade')) {
      try {
        map.setLayoutProperty('hillshade', 'visibility', 'visible');
      } catch (eHillVis) { /* ignore */ }
    }
    safeSetPaint('hillshade', 'hillshade-exaggeration', Math.min(1, Math.max(0, +h.exaggeration || 0)));
    safeSetPaint('hillshade', 'hillshade-illumination-direction', h.illuminationDirection);
    safeSetPaint('hillshade', 'hillshade-shadow-color', h.shadowColor);
    safeSetPaint('hillshade', 'hillshade-highlight-color', h.highlightColor);
    safeSetPaint('hillshade', 'hillshade-accent-color', h.accentColor);

    // 水系
    applyVectorWaterPaint(w);

    updateWaterVisibility();
    updatePaintSummary();
  }

  // 矢量水系颜色 / 线宽跟水系面板走：lakeFill → 湖 / 河面 / 池塘（海洋沿用皮肤色）；
  // riverLevel1/2/3 → waterway river / canal / stream+drain；
  // 线宽 = VP 基准线宽 × (面板值 / 默认值)，随 zoom 插值
  const VECTOR_WATER_FILLS = ['vl-water', 'vl-water-river', 'vl-water-pond'];
  const VECTOR_WATER_LINES = [
    ['vl-waterway', 'riverLevel1', 'riverL1Width'],
    ['vl-waterway-canal', 'riverLevel2', 'riverL2Width'],
    ['vl-waterway-stream', 'riverLevel3', 'riverL3Width'],
    ['vl-waterway-drain', 'riverLevel3', 'riverL3Width'],
  ];
  function applyVectorWaterPaint(w) {
    if (!mapReady || !map) return;
    const VP = window.AntiqueVectorPaint;
    VECTOR_WATER_FILLS.forEach(function (id) {
      safeSetPaint(id, 'fill-color', w.lakeFill);
    });
    const defW = DEFAULT_PARAMS.maplibre.water;
    let sig = '';
    VECTOR_WATER_LINES.forEach(function (row) {
      safeSetPaint(row[0], 'line-color', w[row[1]]);
      sig += row[0] + ':' + round(vectorWidthMult(w, defW, row[2]), 3) + ';';
    });
    if (!VP || typeof VP.overlayLineWidthFor !== 'function' || sig === vectorOverlayWidthSig) return;
    vectorOverlayWidthSig = sig;
    VECTOR_WATER_LINES.forEach(function (row) {
      const expr = VP.overlayLineWidthFor(row[0], vectorWidthMult(w, defW, row[2]));
      if (expr) safeSetPaint(row[0], 'line-width', expr);
    });
  }
  function vectorWidthMult(w, defW, key) {
    return defW[key] > 0 && w[key] > 0 ? w[key] / defW[key] : 1;
  }

  function setVectorOverlayVisibility(group, on) {
    if (!mapReady || !map) return;
    const vis = on ? 'visible' : 'none';
    (vectorOverlayIds[group] || []).forEach(function (id) {
      if (!map.getLayer(id)) return;
      if (map.getLayoutProperty(id, 'visibility') !== vis) map.setLayoutProperty(id, 'visibility', vis);
    });
  }

  function updateRoadsVisibility() {
    if (!mapReady) return;
    setVectorOverlayVisibility('roads', params.ui.showRoads !== false);
    const btn = document.getElementById('btn-roads');
    if (btn) btn.classList.toggle('active', params.ui.showRoads !== false);
  }

  function updateWaterVisibility() {
    if (!mapReady) return;
    setVectorOverlayVisibility('water', !!params.ui.showWater);
    updateRoadsVisibility();
    document.getElementById('btn-water').classList.toggle('active', params.ui.showWater);
    updateCitiesVisibility();
  }

  function updateCitiesVisibility() {
    const show = params.ui.showCities !== false && params.ui.viewMode !== 'globe';
    if (hanCityLayer && typeof hanCityLayer.setKeepPoint === 'function') {
      hanCityLayer.setKeepPoint(params.ui.showRegionIsolate ? isolateKeepsPoint : null);
    }
    if (hanCityLayer && typeof hanCityLayer.setVisible === 'function') {
      hanCityLayer.setVisible(show);
    } else if (mapReady && map && map.getLayer('han-city-3d')) {
      try {
        map.setLayoutProperty('han-city-3d', 'visibility', show ? 'visible' : 'none');
      } catch (e) {
        /* custom layer 可能无 layout */
      }
    }
    const btn = document.getElementById('btn-cities');
    if (btn) btn.classList.toggle('active', show);
  }

  function applyCamera(animate) {
    if (!mapReady) return;
    const c = params.camera;
    const cam = {
      center: c.center.slice(),
      zoom: c.zoom,
      pitch: c.pitch,
      bearing: c.bearing,
    };
    const F = window.AntiqueMapFx;
    if (F) {
      F.applyCamera(map, cam, {
        animate: !!animate,
        duration: 900,
        lod: { onChange: onMotionLodChange },
      });
      return;
    }
    if (animate) {
      if (typeof map.stop === 'function') map.stop();
      map.easeTo(Object.assign({ duration: 900 }, cam));
    } else {
      map.jumpTo(cam);
    }
  }

  function updatePaintSummary() {
    const m = params.maplibre;
    const s = m.satellite;
    const h = m.hillshade;
    const text =
      'bg ' + m.backgroundColor +
      ' · terrain ' + m.terrainExaggeration +
      '\nsat op ' + s.opacity +
      ' sat ' + s.saturation +
      ' con ' + s.contrast +
      ' hue ' + s.hueRotate +
      '\nbmin ' + s.brightnessMin +
      ' bmax ' + s.brightnessMax +
      '\nhill ex ' + h.exaggeration +
      ' dir ' + h.illuminationDirection +
      '\nshadow ' + h.shadowColor +
      ' hi ' + h.highlightColor +
      ' acc ' + h.accentColor +
      '\nlake ' + m.water.lakeFill +
      '\nriverL3 ' + m.water.riverLevel3 +
      ' w' + m.water.riverL3Width +
      '\nriverL1 ' + m.water.riverLevel1 +
      ' w' + m.water.riverL1Width;
    document.getElementById('paint-summary').textContent = text;
  }

  // ============================================================
  // UI 绑定：控件 ↔ params
  // ============================================================
  function refreshAllControls() {
    document.querySelectorAll('.ctrl').forEach(function (el) {
      const key = el.dataset.key;
      const type = el.dataset.type || 'number';
      const value = getByPath(params, key);

      if (type === 'color') {
        const parsed = parseColor(value);
        const colorInput = el.querySelector('input[type="color"]');
        const hexInput = el.querySelector('input.hex');
        if (colorInput) colorInput.value = parsed.hex;
        if (hexInput) hexInput.value = parsed.hex;
      } else if (type === 'rgba') {
        const parsed = parseColor(value);
        const colorInput = el.querySelector('input[type="color"]');
        const hexInput = el.querySelector('input.hex');
        const alphaInput = el.querySelector('input.alpha');
        const alphaVal = el.querySelector('.alpha-val');
        if (colorInput) colorInput.value = parsed.hex;
        if (hexInput) hexInput.value = parsed.hex;
        if (alphaInput) alphaInput.value = parsed.a;
        if (alphaVal) alphaVal.textContent = String(parsed.a);
      } else {
        const range = el.querySelector('input[type="range"]');
        const valEl = el.querySelector('.val');
        if (range && value != null) range.value = value;
        if (valEl && value != null) {
          valEl.textContent = formatNum(value, range);
        }
      }
    });

    if (vectorCtl) vectorCtl.syncUi();
    document.getElementById('st-preset').textContent = params.id || PRESET_ID;
    document.getElementById('btn-ref').classList.toggle('active', !!params.ui.showRef);
    document.getElementById('btn-water').classList.toggle('active', !!params.ui.showWater);
    const rdBtn = document.getElementById('btn-roads');
    if (rdBtn) rdBtn.classList.toggle('active', params.ui.showRoads !== false);
    const cBtn = document.getElementById('btn-cities');
    if (cBtn) cBtn.classList.toggle('active', params.ui.showCities !== false);
    updateIsolateUi();
    updatePresetStatus();
    updateRefImage();
    updateRefCompare();
    applyCssOverlays();
  }

  function bindControls() {
    document.querySelectorAll('.ctrl').forEach(function (el) {
      const key = el.dataset.key;
      const type = el.dataset.type || 'number';

      if (type === 'color') {
        const colorInput = el.querySelector('input[type="color"]');
        const hexInput = el.querySelector('input.hex');

        function commit(hex) {
          const p = parseColor(hex);
          setByPath(params, key, p.hex);
          colorInput.value = p.hex;
          hexInput.value = p.hex;
          onParamChange(key);
        }

        colorInput.addEventListener('input', function () {
          commit(colorInput.value);
        });
        hexInput.addEventListener('change', function () {
          commit(hexInput.value);
        });
      } else if (type === 'rgba') {
        const colorInput = el.querySelector('input[type="color"]');
        const hexInput = el.querySelector('input.hex');
        const alphaInput = el.querySelector('input.alpha');
        const alphaVal = el.querySelector('.alpha-val');

        function commitRgba() {
          const hex = colorInput.value;
          const a = parseFloat(alphaInput.value);
          const rgba = toRgba(hex, a);
          setByPath(params, key, rgba);
          hexInput.value = parseColor(hex).hex;
          alphaVal.textContent = String(round(a, 2));
          onParamChange(key);
        }

        colorInput.addEventListener('input', commitRgba);
        alphaInput.addEventListener('input', commitRgba);
        hexInput.addEventListener('change', function () {
          const p = parseColor(hexInput.value);
          colorInput.value = p.hex;
          commitRgba();
        });
      } else {
        const range = el.querySelector('input[type="range"]');
        const valEl = el.querySelector('.val');
        range.addEventListener('input', function () {
          let v = parseFloat(range.value);
          setByPath(params, key, v);
          valEl.textContent = formatNum(v, range);
          onParamChange(key);
        });
      }
    });
  }

  function onParamChange(key) {
    // CSS 相关
    if (key && key.indexOf('css.') === 0) {
      applyCssOverlays();
    }

    // 相机
    if (key && key.indexOf('camera.') === 0) {
      applyCamera(false);
    } else if (key === 'terrainExaggeration') {
      if (map) map.__antiqueRiseGen = (map.__antiqueRiseGen || 0) + 1;
      terrainRising = false;
      applyTerrainForIsolate();
    } else if (key === 'ui.islandSideColor') {
      applyIslandSideColor();
    } else {
      applyMapStyles();
    }

    // CSS 叠层始终同步
    if (!key || key.indexOf('css.') !== 0) {
      // map 样式也可能影响 summary
    }

    persist();
  }

  // ============================================================
  // 参考图对比
  // ============================================================
  function updateRefImage() {
    const img = document.getElementById('ref-img');
    const label = document.getElementById('ref-label');
    if (!img || !label) return;
    if (!BASELINE_REF.src) {
      ['ref-compare', 'btn-ref', 'btn-ref-mode'].forEach(function (id) {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
      });
      if (params && params.ui) params.ui.showRef = false;
      return;
    }
    img.src = BASELINE_REF.src;
    img.alt = '手绘古地图参考';
    label.textContent = BASELINE_REF.label;
    img.onerror = function () {
      img.style.display = 'none';
      const box = document.getElementById('ref-compare');
      if (box) box.style.display = 'none';
      if (params && params.ui) params.ui.showRef = false;
      const btn = document.getElementById('btn-ref');
      if (btn) btn.classList.remove('active');
    };
  }

  function updatePresetStatus() {
    const st = document.getElementById('st-preset');
    if (st) st.textContent = params.id || PRESET_ID;
  }

  function applyBaseline() {
    params = deepClone(DEFAULT_PARAMS);
    params.season = null;
    updateRefImage();
    refreshAllControls();
    applyCssOverlays();
    applyMapStylesNow();
    applyCamera(true);
    updatePresetStatus();
    updateRefCompare();
    syncVector();
    persist();
    toast('已回到 antique-default 基线');
  }

  function updateRefCompare() {
    const box = document.getElementById('ref-compare');
    const modeBtn = document.getElementById('btn-ref-mode');
    box.classList.toggle('visible', !!params.ui.showRef);
    box.classList.remove('pip', 'split');
    box.classList.add(params.ui.refMode === 'split' ? 'split' : 'pip');
    modeBtn.textContent =
      '对比模式：' + (params.ui.refMode === 'split' ? '左右分屏' : '画中画');
    document.getElementById('btn-ref').classList.toggle('active', !!params.ui.showRef);
    updateRefImage();
  }

  // ============================================================
  // 按钮
  // ============================================================
  function bindButtons() {
    document.getElementById('btn-reset').addEventListener('click', function () {
      applyBaseline();
    });

    document.getElementById('btn-copy').addEventListener('click', async function () {
      const json = JSON.stringify(exportParams(), null, 2);
      try {
        await navigator.clipboard.writeText(json);
        toast('已复制 JSON 到剪贴板');
      } catch (e) {
        // fallback
        const ta = document.createElement('textarea');
        ta.value = json;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        toast('已复制 JSON');
      }
    });

    document.getElementById('btn-download').addEventListener('click', function () {
      const json = JSON.stringify(exportParams(), null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'map-antique-params-' + Date.now() + '.json';
      a.click();
      URL.revokeObjectURL(url);
      toast('已下载 JSON');
    });

    document.getElementById('btn-paste').addEventListener('click', async function () {
      try {
        const text = await navigator.clipboard.readText();
        const obj = JSON.parse(text);
        params = mergeParams(DEFAULT_PARAMS, obj);
        if (obj.ui) Object.assign(params.ui, (function (src) { var copy = {}; Object.keys(src).forEach(function (k) { if (k !== '__proto__' && k !== 'constructor' && k !== 'prototype') copy[k] = src[k]; }); return copy; })(obj.ui));
        if (Object.prototype.hasOwnProperty.call(obj, 'season')) {
          params.season = obj.season;
        }
        updateRefImage();
        refreshAllControls();
        applyCssOverlays();
        applyMapStylesNow();
        updateRegionIsolate();
        applyCamera(true);
        updatePresetStatus();
        updateRefCompare();
        syncVector();
        persist();
        toast('已从剪贴板应用参数');
      } catch (e) {
        toast('粘贴失败：剪贴板非有效 JSON');
        console.warn(e);
      }
    });

    document.getElementById('btn-ref').addEventListener('click', function () {
      params.ui.showRef = !params.ui.showRef;
      updateRefCompare();
      persist();
    });

    document.getElementById('btn-ref-mode').addEventListener('click', function () {
      params.ui.refMode = params.ui.refMode === 'split' ? 'pip' : 'split';
      if (!params.ui.showRef) params.ui.showRef = true;
      updateRefCompare();
      persist();
    });

    document.getElementById('btn-water').addEventListener('click', function () {
      params.ui.showWater = !params.ui.showWater;
      updateWaterVisibility();
      syncLookToggles();
      persist();
    });

    document.getElementById('btn-roads').addEventListener('click', function () {
      params.ui.showRoads = params.ui.showRoads === false;
      updateRoadsVisibility();
      syncLookToggles();
      persist();
    });

    document.getElementById('btn-isolate').addEventListener('click', function () {
      if (!hasIsolateFeature()) {
        toast('没有可拆出的轮廓：先选区域或粘贴 GeoJSON');
        return;
      }
      params.ui.showRegionIsolate = !params.ui.showRegionIsolate;
      updateRegionIsolate();
      if (params.ui.showRegionIsolate) frameIsolateRegion();
      persist();
      syncLookToggles();
      toast(
        params.ui.showRegionIsolate
          ? isolateUsesIsland()
            ? '拆出开 · 独立地形块（轮廓外地形切除）'
            : '拆出开 · 区外羊皮纸遮盖，区内可地形隆起'
          : '拆出关'
      );
    });

    document.getElementById('isolate-region').addEventListener('change', function (ev) {
      params.ui.regionIsolateId = ev.target.value;
      if (params.ui.showRegionIsolate) updateRegionIsolate();
      else updateIsolateSelect();
      frameIsolateRegion();
      persist();
    });

    document.getElementById('btn-isolate-paste').addEventListener('click', async function () {
      const api = window.REGION_ISOLATE;
      if (!api) {
        toast('拆出模块未加载');
        return;
      }
      try {
        const text = await navigator.clipboard.readText();
        const obj = JSON.parse(text);
        const feat = api.featureFromUnknown(obj);
        if (!feat) {
          toast('剪贴板需为 Polygon / MultiPolygon / Feature');
          return;
        }
        customIsolateFeature = feat;
        params.ui.regionIsolateId = 'custom';
        params.ui.showRegionIsolate = true;
        updateIsolateSelect();
        updateRegionIsolate();
        frameIsolateRegion();
        persist();
        toast('已应用粘贴轮廓');
      } catch (e) {
        toast('粘贴轮廓失败：不是有效 GeoJSON');
        console.warn(e);
      }
    });

    document.getElementById('btn-cities').addEventListener('click', function () {
      params.ui.showCities = !(params.ui.showCities !== false);
      updateCitiesVisibility();
      persist();
      syncLookToggles();
      toast(params.ui.showCities !== false ? '城池点位开' : '城池点位关');
    });

    document.getElementById('btn-china').addEventListener('click', function () {
      params.camera = {
        center: VIEW_CHINA.center.slice(),
        zoom: VIEW_CHINA.zoom,
        pitch: VIEW_CHINA.pitch,
        bearing: VIEW_CHINA.bearing,
      };
      refreshCameraControlsOnly();
      applyCamera(true);
      persist();
      toast('全国视角');
    });

    document.getElementById('btn-terrain-rise').addEventListener('click', function () {
      const F = window.AntiqueMapFx;
      const tcfg = window.__tunerTileConfig;
      const btn = document.getElementById('btn-terrain-rise');
      if (!F || !map || !tcfg || !tcfg.terrain || !tcfg.terrain.enabled) {
        toast('地形不可用');
        return;
      }
      if (terrainRising) {
        toast('正在隆起');
        return;
      }

      const targetEx = params.maplibre.terrainExaggeration;
      const sourceId = tcfg.terrain.sourceId || 'terrain';

      function setTerrainSliderUi(ex, opts) {
        params.maplibre.terrainExaggeration = ex;
        const wrap = document.querySelector('[data-key="terrainExaggeration"]');
        if (wrap) {
          const range = wrap.querySelector('input[type="range"]');
          const valEl = wrap.querySelector('.val');
          if (range) range.value = String(ex);
          if (valEl) valEl.textContent = formatNum(ex, range);
        }
        if (!(opts && opts.skipSummary)) updatePaintSummary();
        updateFxStatus();
      }

      function ensureRiseCamera() {
        var cam = null;
        if (params.ui.showRegionIsolate && hasIsolateFeature()) {
          cam = F.reliefCameraForFeature(map, currentIsolateFeature(), { bearing: 12 });
        }
        if (!cam) {
          cam = {
            center: VIEW_RELIEF.center.slice(),
            zoom: VIEW_RELIEF.zoom,
            pitch: VIEW_RELIEF.pitch,
            bearing: VIEW_RELIEF.bearing,
          };
        }
        params.camera.center = cam.center.slice();
        params.camera.zoom = cam.zoom;
        params.camera.pitch = cam.pitch;
        params.camera.bearing = cam.bearing;
        refreshCameraControlsOnly();
        return new Promise(function (resolve) {
          var done = false;
          function finish() {
            if (done) return;
            done = true;
            resolve();
          }
          map.once('moveend', finish);
          setTimeout(finish, 1000);
          F.applyCamera(map, cam, {
            animate: true,
            duration: 800,
            lod: { onChange: onMotionLodChange },
          });
        });
      }

      terrainRising = true;
      if (btn) btn.disabled = true;
      toast(
        params.ui.showRegionIsolate && hasIsolateFeature()
          ? '拆出区域内隆起地形…'
          : '飞到祁连北坡近景后隆起…'
      );
      ensureRiseCamera().then(function () {
        var curT = typeof map.getTerrain === 'function' ? map.getTerrain() : null;
        var fromEx = 0.2;
        if (params.ui.showRegionIsolate && curT && Number(curT.exaggeration) > 0.2) {
          fromEx = Number(curT.exaggeration);
        }
        var riseStep = 0;
        return F.terrainRise(map, {
          sourceId: sourceId,
          from: fromEx,
          to: targetEx,
          durationMs: fromEx >= targetEx - 0.05 ? 0 : 1400,
          maxSteps: 10,
          waitIdle: false,
          budget: false,
          onStep: function (ex, t) {
            riseStep++;
            setTerrainSliderUi(ex, { skipSummary: riseStep !== 10 && t < 1 });
            // 城池贴地重定位开销大:隆起期间每 3 步跟一次,末帧精确归位
            if (t >= 1 || riseStep % 3 === 0) {
              if (hanCityLayer && typeof hanCityLayer.repositionToTerrain === 'function') {
                try {
                  hanCityLayer.repositionToTerrain();
                } catch (e) {
                  console.warn('repositionToTerrain', e);
                }
              }
            }
          },
        });
      }).then(function (r) {
        F.setTerrainEx(map, sourceId, targetEx, { budget: false });
        setTerrainSliderUi(targetEx);
        persist();
        toast(
          r && r.aborted
            ? '隆起已中断，已强制套用滑杆夸张'
            : ('隆起 ' + (r && r.from) + '→' + targetEx + ' · setTerrain ×' + (map.__antiqueSetTerrainCount || 0))
        );
      }).catch(function (err) {
        console.warn(err);
        try {
          F.setTerrainEx(map, sourceId, targetEx, { budget: false });
          setTerrainSliderUi(targetEx);
        } catch (e2) {
          /* ignore */
        }
        toast('隆起失败，已强制套用滑杆夸张');
      }).then(function () {
        terrainRising = false;
        if (btn) btn.disabled = false;
        updateFxStatus();
        if (params.ui.showRegionIsolate) applyTerrainIsland({ forceWalls: true });
      });
    });

    document.getElementById('btn-clear-storage').addEventListener('click', function () {
      localStorage.removeItem(STORAGE_KEY);
      toast('已清除本地缓存（当前参数仍保留在界面）');
    });

  }

  function refreshCameraControlsOnly() {
    ['camera.centerLng', 'camera.centerLat', 'camera.zoom', 'camera.pitch', 'camera.bearing'].forEach(
      function (key) {
        const el = document.querySelector('.ctrl[data-key="' + key + '"]');
        if (!el) return;
        const range = el.querySelector('input[type="range"]');
        const valEl = el.querySelector('.val');
        const value = getByPath(params, key);
        if (range) range.value = value;
        if (valEl) valEl.textContent = formatNum(value, range);
      }
    );
  }

  // ============================================================
  // 地图初始化（瓦片端点来自 map-tiles.config*.js，默认无商业卫星热链）
  // ============================================================
  function resolveTileConfig() {
    const cfg = window.MAP_TILE_CONFIG || {};
    const satIn = cfg.satellite || {};
    const terIn = cfg.terrain || {};
    const satTiles = Array.isArray(satIn.tiles)
      ? satIn.tiles.filter(function (u) { return typeof u === 'string' && u.length > 0; })
      : [];
    const terTiles = Array.isArray(terIn.tiles)
      ? terIn.tiles.filter(function (u) { return typeof u === 'string' && u.length > 0; })
      : [
          'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
          'https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png',
        ];
    const satEnabled = satIn.enabled !== false && satTiles.length > 0;
    const terEnabled = terIn.enabled !== false && terTiles.length > 0;
    return {
      satellite: {
        enabled: satEnabled,
        tiles: satTiles,
        tileSize: satIn.tileSize || 256,
        maxzoom: satIn.maxzoom != null ? satIn.maxzoom : 18,
        attribution: satIn.attribution || '',
        sourceId: satIn.sourceId || 'basemapRaster',
        layerId: satIn.layerId || 'satellite',
      },
      terrain: {
        enabled: terEnabled,
        tiles: terTiles,
        tileSize: terIn.tileSize || 256,
        maxzoom: terIn.maxzoom != null ? terIn.maxzoom : 15,
        encoding: terIn.encoding || 'terrarium',
        attribution: terIn.attribution || '© AWS Terrain Tiles (Terrarium)',
        sourceId: terIn.sourceId || 'terrain',
      },
      nightLights: window.AntiqueTunerVector
        ? window.AntiqueTunerVector.resolveNightConfig(cfg.nightLights)
        : null,
      uiAttribution:
        cfg.uiAttribution ||
        (satEnabled
          ? '底图：已配置栅格 · 地形 DEM：Terrarium'
          : '底图：未配置卫星 · 地形 DEM：Terrarium'),
    };
  }

  function buildMapStyle(tileCfg) {
    const sources = {};
    const layers = [
      {
        id: 'background',
        type: 'background',
        paint: {
          'background-color': params.maplibre.backgroundColor,
        },
      },
    ];

    if (tileCfg.terrain.enabled) {
      const demSpec = {
        type: 'raster-dem',
        tiles: tileCfg.terrain.tiles,
        tileSize: tileCfg.terrain.tileSize,
        maxzoom: tileCfg.terrain.maxzoom,
        encoding: tileCfg.terrain.encoding || 'terrarium',
        attribution: tileCfg.terrain.attribution,
      };
      const demId = tileCfg.terrain.sourceId;
      // MapLibre 5.x warns when hillshade + 3D terrain share one raster-dem
      // source (quality / flashing). Isolate drapes hillshade onto clipped
      // terrain RTT; a dedicated source keeps hillshade FBOs stable.
      // Set terrain.dualSource = false to share one DEM cache (fewer requests).
      sources[demId] = demSpec;
      const useDualHill = tileCfg.terrain.dualSource !== false;
      if (useDualHill) {
        sources[demId + '-hillshade'] = Object.assign({}, demSpec);
      }
    }

    if (tileCfg.satellite.enabled) {
      sources[tileCfg.satellite.sourceId] = {
        type: 'raster',
        tiles: tileCfg.satellite.tiles,
        tileSize: tileCfg.satellite.tileSize,
        maxzoom: tileCfg.satellite.maxzoom,
        attribution: tileCfg.satellite.attribution,
      };
      layers.push({
        id: tileCfg.satellite.layerId || 'satellite',
        type: 'raster',
        source: tileCfg.satellite.sourceId,
        paint: {
          'raster-opacity': params.maplibre.satellite.opacity,
          'raster-saturation': params.maplibre.satellite.saturation,
          'raster-contrast': params.maplibre.satellite.contrast,
          'raster-brightness-min': params.maplibre.satellite.brightnessMin,
          'raster-brightness-max': params.maplibre.satellite.brightnessMax,
          'raster-hue-rotate': params.maplibre.satellite.hueRotate,
          'raster-fade-duration': 0,
        },
      });
    }

    // 矢量配色（海拔设色 / 图层颜色）：卫星之上、山影之下；默认全隐藏，不请求瓦片。
    const TV = window.AntiqueTunerVector;
    const VPbase = window.AntiqueVectorPaint;
    if (TV && VPbase && typeof VPbase.buildStyle === 'function') {
      const base = TV.baseParts(VPbase, tileCfg, params);
      Object.keys(base.sources).forEach(function (id) { sources[id] = base.sources[id]; });
      base.layers.forEach(function (layer) { layers.push(layer); });
    }

    // Hillshade above satellite so relief stays visible at 0.7 raster opacity.
    if (tileCfg.terrain.enabled) {
      const shadeId =
        tileCfg.terrain.dualSource === false
          ? tileCfg.terrain.sourceId
          : tileCfg.terrain.sourceId + '-hillshade';
      layers.push({
        id: 'hillshade',
        type: 'hillshade',
        source: shadeId,
        layout: { visibility: 'visible' },
        paint: {
          'hillshade-exaggeration': Math.min(1, Math.max(0, +params.maplibre.hillshade.exaggeration || 0)),
          'hillshade-illumination-direction': params.maplibre.hillshade.illuminationDirection,
          'hillshade-shadow-color': params.maplibre.hillshade.shadowColor,
          'hillshade-highlight-color': params.maplibre.hillshade.highlightColor,
          'hillshade-accent-color': params.maplibre.hillshade.accentColor,
          'hillshade-illumination-anchor': 'viewport',
        },
      });
    }

    // OpenFreeMap 矢量水系 / 道路：压在卫星与山影之上；region-mask / region-outline、
    // 水系包、城池等覆盖层都在 map ready 之后 addLayer，天然排在它们上面。
    const VP = window.AntiqueVectorPaint;
    if (VP && typeof VP.overlayParts === 'function') {
      const overlay = VP.overlayParts({
        groups: ['water', 'roads'],
        paint: window.AntiqueTunerVector
          ? window.AntiqueTunerVector.effectivePaint(VP, params.vector, params.ui && params.ui.skinId)
          : null,
        visible: { water: !!params.ui.showWater, roads: params.ui.showRoads !== false },
      });
      sources[overlay.sourceId] = overlay.source;
      overlay.layers.forEach(function (layer) { layers.push(layer); });
      vectorOverlayIds = overlay.ids;
      // 夜景灯光：与水路同一矢量源，压在最上面
      if (TV && typeof TV.lightsParts === 'function') {
        TV.lightsParts(VP, params).layers.forEach(function (layer) { layers.push(layer); });
      }
    }

    const style = { version: 8, sources: sources, layers: layers };
    // 等高线标注要字形
    if (VPbase && VPbase.GLYPHS_URL) style.glyphs = VPbase.GLYPHS_URL;
    return style;
  }

  function initMap() {
    const tileCfg = resolveTileConfig();
    window.__tunerTileConfig = tileCfg;
    const attrEl = document.getElementById('attribution-note');
    if (attrEl) {
      attrEl.textContent =
        tileCfg.uiAttribution + ' · 水系/道路：OpenFreeMap © OpenMapTiles © OpenStreetMap' +
        (tileCfg.nightLights && tileCfg.nightLights.attribution ? ' · 夜光：' + tileCfg.nightLights.attribution : '');
    }
    if (!tileCfg.satellite.enabled) {
      console.info(
        '[tuner] satellite basemap disabled — set tiles in map-tiles.config.js ' +
          'or map-tiles.config.local.js (see map-tiles.config.example.js). ' +
          'This project does not grant map-tile rights.'
      );
    }
    if (!tileCfg.terrain.enabled) {
      console.warn('[tuner] terrain DEM disabled — hillshade/setTerrain unavailable');
    }

    const cam = params.camera;
    const style = buildMapStyle(tileCfg);
    const F = window.AntiqueMapFx;
    if (F) {
      map = F.createMap(maplibregl, {
        container: 'map',
        style: style,
        camera: {
          center: cam.center,
          zoom: cam.zoom,
          pitch: cam.pitch,
          bearing: cam.bearing,
        },
        mode: 'tuner',
        maxPitch: 85,
        mapOptions: {
          minZoom: params.ui.viewMode === 'globe' ? GLOBE_MIN_ZOOM : MAP_MIN_ZOOM,
        },
        terrain: tileCfg.terrain.enabled
          ? {
              sourceId: tileCfg.terrain.sourceId,
              exaggeration: params.maplibre.terrainExaggeration,
            }
          : null,
      });
    } else {
      map = new maplibregl.Map({
        container: 'map',
        style: style,
        center: cam.center,
        zoom: cam.zoom,
        pitch: cam.pitch,
        bearing: cam.bearing,
        maxPitch: 85,
        minZoom: params.ui.viewMode === 'globe' ? GLOBE_MIN_ZOOM : MAP_MIN_ZOOM,
        attributionControl: true,
      });
    }

    window.__tunerMap = map;

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(
      new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }),
      'bottom-left'
    );

    function onMapReady() {
      if (mapReady) return;
      mapReady = true;
      try {
        applyTerrainForIsolate();
      } catch (e) {
        console.warn('setTerrain 失败（其余图层仍可用）', e);
      }
      try {
        addRegionIsolateLayers();
      } catch (e) {
        console.warn('拆出蒙版添加失败', e);
      }
      try {
        addHanCityLayer();
      } catch (e) {
        console.warn('城池层添加失败', e);
      }
      applyCssOverlays();
      applyMapStylesNow();
      syncVector();
      if (F && tileCfg.terrain.enabled && typeof map.setSky === 'function') {
        try {
          if (isolateUsesIsland()) map.setSky(window.AntiqueTerrainIsland.islandSky());
          else map.setSky(F.antiqueSky());
        } catch (e) {
          console.warn('setSky', e);
        }
      }
      try { applyViewMode({ frame: false }); } catch (eVm) { console.warn('viewMode', eVm); }
      updatePaintSummary();
      updateCitiesVisibility();
      updatePresetStatus();
      if (F) {
        F.waitIdle(map, { timeoutMs: 15000 }).then(function () {
          if (hanCityLayer && typeof hanCityLayer.repositionToTerrain === 'function') {
            hanCityLayer.repositionToTerrain();
          }
          map.triggerRepaint();
          updateFxStatus();
          if (params.ui.showRegionIsolate) applyTerrainIsland({ forceWalls: true });
        });
      }
    }

    // style.load 先于 load：不因 DEM 瓦片失败而一直卡在未就绪
    map.once('style.load', onMapReady);
    map.on('load', onMapReady);

    // 用户交互同步相机到面板
    map.on('movestart', function (e) {
      if (e && e.originalEvent) stopGlobeSpin();
      if (map.__antiqueMotionLod) return;
      if (e && e.originalEvent && window.AntiqueMapFx) {
        map.__antiqueUserDrag = true;
        window.AntiqueMapFx.setMotionLod(map, true, { onChange: onMotionLodChange });
      }
    });

    // The clip window follows the camera while it moves. Applying only on
    // moveend left the lead edge of the land unrasterized mid-drag (a block
    // sliced off with a straight edge). The sig check is cheap; setClip only
    // runs when the view leaves the live window.
    map.on('move', function () {
      if (terrainRising || !isolateUsesIsland()) return;
      if (shouldApplyTerrainIsland()) applyTerrainIsland();
    });

    map.on('moveend', function () {
      if (syncingFromMap) return;
      if (globeSpinRaf) {
        params.camera.bearing = round(map.getBearing(), 1);
        return;
      }
      const c = map.getCenter();
      params.camera.center = [round(c.lng, 4), round(c.lat, 4)];
      params.camera.zoom = round(map.getZoom(), 2);
      params.camera.pitch = round(map.getPitch(), 1);
      params.camera.bearing = round(map.getBearing(), 1);
      refreshCameraControlsOnly();
      if (params.ui.viewMode === 'globe') applyCssOverlays();
      if (params.ui.showRegionIsolate && isolateWantedMaskKind() !== isolateMaskKind) {
        updateRegionIsolate();
      }
      if (isolateUsesIsland() && shouldApplyTerrainIsland()) applyTerrainIsland();
      if (islandWallsNeedSettle && isolateUsesIsland()) {
        islandWallsNeedSettle = false;
        scheduleIslandWalls(true);
      }
      if (map.__antiqueUserDrag && window.AntiqueMapFx) {
        map.__antiqueUserDrag = false;
        window.AntiqueMapFx.setMotionLod(map, false, { onChange: onMotionLodChange });
      } else if (!map.__antiqueMotionLod) {
        applyTerrainForIsolate();
      }
      persist();
    });

    map.on('error', function (e) {
      console.warn('MapLibre error', e && e.error);
    });
  }

  /**
   * 多级城池点位（大/中/小城 + 关卡 + 驿站 + 牙帐）
   * 仅加载 params.cities.dataFile（默认 assets/sample-sites.json）；失败回退内置
   */
  async function addHanCityLayer() {
    if (!map) return;
    if (typeof window.HanCity3D === 'undefined') {
      console.warn('[han-city-3d] HanCity3D 未加载，跳过城池层');
      return;
    }
    if (map.getLayer('han-city-extrude-plinth') || map.getLayer('han-city-3d')) return;

    function normalizeSite(c) {
      return {
        id: c.id,
        name: c.name,
        lng: c.lng,
        lat: c.lat,
        tier: c.tier || 'medium',
        modelType: c.modelType,
        scale: c.scale,
        halfKm: c.halfKm,
        heightScale: c.heightScale,
        palette: c.palette,
        bearing: c.bearing,
        group: c.group,
        role: c.role,
        label: c.label,
        note: c.note,
      };
    }

    var cities = null;
    var sitesUrl =
      (params.cities && params.cities.dataFile) || 'assets/sample-sites.json';
    try {
      var resN = await fetch(sitesUrl);
      if (resN.ok) {
        var dataN = await resN.json();
        var list = Array.isArray(dataN)
          ? dataN
          : dataN && Array.isArray(dataN.sites)
            ? dataN.sites
            : dataN && Array.isArray(dataN.cities)
              ? dataN.cities
              : null;
        if (list && list.length) {
          cities = list.map(normalizeSite);
          console.info('[han-city-3d] 加载 ' + sitesUrl + ' · ' + cities.length + ' 点');
        }
      }
    } catch (e) {
      console.info('[han-city-3d] ' + sitesUrl + ' 不可用，使用内置示例');
    }

    try {
      var halfKmGlobal =
        params.cities && params.cities.halfKm != null ? params.cities.halfKm : 18;
      var cityList = cities || (window.HanCity3D.FALLBACK_CITIES || []).map(function (c) {
        return normalizeSite(Object.assign({ tier: 'medium', modelType: 'commandery' }, c));
      });

      if (typeof window.HanCity3D.addExtrusionCities === 'function') {
        hanCityLayer = window.HanCity3D.addExtrusionCities(map, maplibregl, {
          cities: cityList,
          halfKm: halfKmGlobal,
          visible: params.ui.showCities !== false,
        });
      } else if (typeof window.THREE !== 'undefined') {
        hanCityLayer = window.HanCity3D.createCustomLayer(maplibregl, window.THREE, {
          id: 'han-city-3d',
          cities: cityList,
          visible: params.ui.showCities !== false,
          palette: window.HanCity3D.DEFAULT_PALETTE,
          visualScale: 80,
          altitudeBoost: 400,
        });
        map.addLayer(hanCityLayer);
      } else {
        console.warn('[han-city-3d] 无 extrusion 也无 THREE，跳过');
        return;
      }
      updateCitiesVisibility();
      restackIsolateAboveOverlays();
      map.once('idle', function () {
        if (hanCityLayer && typeof hanCityLayer.repositionToTerrain === 'function') {
          hanCityLayer.repositionToTerrain();
        }
        restackIsolateAboveOverlays();
        map.triggerRepaint();
      });
    } catch (err) {
      console.warn('[han-city-3d] 添加城池层失败', err);
      hanCityLayer = null;
    }
  }

  // ============================================================
  // Showcase：场景 / 投影 / 光照 / 主题
  // ============================================================
  let SHOW_SCENES = [];
  let globeSpinRaf = 0;
  let lastMapCam = null;

  function stopGlobeSpin() {
    if (globeSpinRaf) cancelAnimationFrame(globeSpinRaf);
    globeSpinRaf = 0;
  }

  function startGlobeSpin() {
    // Idle spin used map.setBearing every animation frame. On globe that
    // re-subdivides terrain + fills 60×/s and freezes the tab. Off until
    // we have a cheap path (user can still drag the globe).
    stopGlobeSpin();
  }

  function syncViewModeUi() {
    const mode = params.ui.viewMode === 'globe' ? 'globe' : 'map';
    document.querySelectorAll('#viewmode-seg button').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-mode') === mode);
    });
    const proj = document.getElementById('chrome-proj');
    if (proj) proj.textContent = mode === 'globe' ? 'GLOBE' : 'MAP';
  }

  function syncLookToggles() {
    function setSw(id, on) {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.toggle('on', !!on);
      el.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    setSw('sw-sat', (params.maplibre.satellite.opacity || 0) > 0.05);
    document.querySelectorAll('#lighting-grid .chip').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-light') === (params.ui.lightingId || 'night'));
    });
    document.querySelectorAll('#theme-grid .chip').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-theme') === (params.ui.themeId || 'antique'));
    });
  }

  function syncSceneUi() {
    const id = params.ui.sceneId;
    document.querySelectorAll('#scene-list .scene-item').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-scene') === id);
    });
  }

  function applyViewMode(opts) {
    opts = opts || {};
    const mode = params.ui.viewMode === 'globe' ? 'globe' : 'map';
    params.ui.viewMode = mode;
    syncViewModeUi();
    if (!mapReady || !map || typeof map.setProjection !== 'function') return;
    let cur = 'mercator';
    try {
      const p = map.getProjection && map.getProjection();
      cur = (p && p.type) || 'mercator';
    } catch (e) { /* older builds */ }
    const want = mode === 'globe' ? 'globe' : 'mercator';
    if (cur !== want) {
      if (want === 'globe' && cur !== 'globe') {
        lastMapCam = {
          center: [map.getCenter().lng, map.getCenter().lat],
          zoom: map.getZoom(),
          pitch: map.getPitch(),
          bearing: map.getBearing(),
        };
      }
      try {
        map.setProjection({ type: want });
      } catch (e) {
        console.warn('setProjection', e);
      }
    }
    if (typeof map.setSky === 'function') {
      try {
        if (isolateUsesIsland()) map.setSky(window.AntiqueTerrainIsland.islandSky());
        else if (mode === 'globe') map.setSky(globeSky());
        else if (window.AntiqueMapFx) map.setSky(window.AntiqueMapFx.antiqueSky());
      } catch (e2) { /* ignore */ }
    }
    if (mode === 'globe') {
      try { map.setMinZoom(GLOBE_MIN_ZOOM); } catch (e3) { /* ignore */ }
      if (opts.frame !== false) {
        const z = map.getZoom();
        if (z < 1.2 || z > 5.5 || opts.forceFrame) {
          const c = map.getCenter();
          const F = window.AntiqueMapFx;
          const cam = {
            center: [c.lng, c.lat],
            zoom: Math.min(2.4, Math.max(1.6, z > 6 ? 2.0 : z)),
            pitch: Math.min(map.getPitch(), 28),
            bearing: map.getBearing(),
          };
          if (opts.forceFrame) {
            cam.center = GLOBE_CAM.center.slice();
            cam.zoom = GLOBE_CAM.zoom;
            cam.pitch = GLOBE_CAM.pitch;
            cam.bearing = GLOBE_CAM.bearing;
          }
          if (F) F.jumpTo(map, cam);
          else map.jumpTo(cam);
          params.camera.center = cam.center;
          params.camera.zoom = cam.zoom;
          params.camera.pitch = cam.pitch;
          params.camera.bearing = cam.bearing;
        }
      }
    } else {
      try { map.setMinZoom(MAP_MIN_ZOOM); } catch (e4) { /* ignore */ }
      stopGlobeSpin();
      const zNow = map.getZoom();
      const leavingGlobe = cur === 'globe';
      if (opts.forceFrame || leavingGlobe || zNow < MAP_MIN_ZOOM) {
        var back = lastMapCam && lastMapCam.zoom >= MAP_MIN_ZOOM ? lastMapCam : {
          center: VIEW_CHINA.center.slice(),
          zoom: VIEW_CHINA.zoom,
          pitch: VIEW_CHINA.pitch,
          bearing: VIEW_CHINA.bearing,
        };
        if (back.zoom < MAP_MIN_ZOOM) back.zoom = VIEW_CHINA.zoom;
        const Fmap = window.AntiqueMapFx;
        if (Fmap) Fmap.jumpTo(map, back);
        else map.jumpTo(back);
        params.camera = {
          center: back.center.slice(),
          zoom: back.zoom,
          pitch: back.pitch,
          bearing: back.bearing,
        };
      }
    }
    applyCssOverlays();
    updateCitiesVisibility();
    if (params.ui.showRegionIsolate) {
      try { updateRegionIsolate(); } catch (eIso) { /* ignore */ }
    }
    if (vectorCtl && mapReady) vectorCtl.applyToMap();
    persist();
  }

  function applyLighting(id) {
    const spec = LIGHTING[id] || LIGHTING.night;
    params.ui.lightingId = LIGHTING[id] ? id : 'night';
    params.maplibre.hillshade.illuminationDirection = spec.illuminationDirection;
    params.maplibre.hillshade.shadowColor = spec.shadowColor;
    params.maplibre.hillshade.highlightColor = spec.highlightColor;
    applyMapStylesNow();
    refreshAllControls();
    syncLookToggles();
    persist();
  }

  function applyTheme(id) {
    const spec = THEMES[id] || THEMES.antique;
    params.ui.themeId = THEMES[id] ? id : 'antique';
    Object.keys(spec).forEach(function (k) { params.css[k] = spec[k]; });
    applyCssOverlays();
    refreshAllControls();
    syncLookToggles();
    persist();
  }

  function applySkinFromCatalog(id) {
    var VP = window.AntiqueVectorPaint;
    if (!VP || !id) return;
    var skin = VP.SKINS.filter(function (s) { return s.id === id; })[0];
    if (!skin) return;
    params.ui.skinId = id;
    if (params.vector) params.vector.paint = null;
    var c = skin.css || {};
    Object.keys(c).forEach(function (k) {
      if (Object.prototype.hasOwnProperty.call(params.css, k)) params.css[k] = c[k];
    });
    applyCssOverlays();
    if (map && typeof VP.applyVectorPaint === 'function') {
      try { VP.applyVectorPaint(map, VP.normalizePaint(skin.paint)); } catch (eSk) { /* raster stack may lack vector layers */ }
    }
    if (skin.paint && skin.paint.water && params.maplibre && params.maplibre.water) {
      params.maplibre.water.lakeFill = skin.paint.water;
      // 矢量河道颜色由水系面板的 riverLevel1/2/3 驱动，皮肤要一并写回（保留原 alpha）
      var skinColors = VP.normalizePaint(skin.paint);
      [['riverLevel1', 'waterway'], ['riverLevel2', 'waterwayCanal'], ['riverLevel3', 'waterwayStream']].forEach(function (row) {
        var prevA = parseColor(params.maplibre.water[row[0]]).a;
        params.maplibre.water[row[0]] = toRgba(skinColors[row[1]], prevA);
      });
      applyMapStylesNow();
    }
    refreshAllControls();
  }

  function applyScene(id) {
    const scene = SHOW_SCENES.filter(function (s) { return s.id === id; })[0];
    if (!scene) return;
    stopGlobeSpin();
    params.ui.sceneId = id;
    if (scene.viewMode) params.ui.viewMode = scene.viewMode;
    const u = scene.ui || {};
    if (u.showWater != null) params.ui.showWater = !!u.showWater;
    if (u.showRoads != null) params.ui.showRoads = !!u.showRoads;
    if (u.showCities != null) params.ui.showCities = !!u.showCities;
    if (scene.isolateId) {
      params.ui.showRegionIsolate = true;
      params.ui.regionIsolateId = scene.isolateId;
    } else if (u.showRegionIsolate != null) {
      params.ui.showRegionIsolate = !!u.showRegionIsolate;
    } else {
      params.ui.showRegionIsolate = false;
    }
    // 场景默认带卫星；当前是无卫星底图（选了无卫星样式，或改过色阶后样式取消选中、
    // 但卫星仍关着只看海拔设色）就保持无卫星，除非场景本身就是看卫星的
    const satScene = !!(scene.paintPatch && scene.paintPatch.satellite);
    const noSatStyle = params.ui.basemapId
      ? params.ui.basemapId !== 'satellite'
      : !!(params.vector && params.vector.relief) && (params.maplibre.satellite.opacity || 0) <= 0.05;
    if (satScene && noSatStyle && window.AntiqueTunerVector) {
      // 与点「卫星」按钮同一路径：样式参数 + 皮肤
      const satStyle = window.AntiqueTunerVector.applyBasemapParams(params, 'satellite');
      if (satStyle && satStyle.skinId) applySkinFromCatalog(satStyle.skinId);
      syncVector();
      updateRoadsVisibility();
    }
    params.maplibre.satellite.opacity = noSatStyle && !satScene ? 0 : DEFAULT_PARAMS.maplibre.satellite.opacity;
    // 底图样式明确关掉的水系 / 路网（如夜景），场景不再打开
    const keepStyle = noSatStyle && !satScene && window.AntiqueTunerVector
      ? window.AntiqueTunerVector.BASEMAP_STYLES.filter(function (s) { return s.id === params.ui.basemapId; })[0]
      : null;
    if (keepStyle && keepStyle.showWater === false) params.ui.showWater = false;
    if (keepStyle && keepStyle.showRoads === false) params.ui.showRoads = false;
    updateRoadsVisibility();
    if (satScene) {
      Object.keys(scene.paintPatch.satellite).forEach(function (k) {
        params.maplibre.satellite[k] = scene.paintPatch.satellite[k];
      });
    }
    applyViewMode({ frame: false, forceFrame: scene.viewMode === 'globe' });
    updateRegionIsolate();
    updateIsolateUi();
    if (scene.camera) {
      params.camera = {
        center: scene.camera.center.slice(),
        zoom: scene.camera.zoom,
        pitch: scene.camera.pitch,
        bearing: scene.camera.bearing,
      };
      applyCamera(true);
    } else if (params.ui.showRegionIsolate) {
      frameIsolateRegion();
    }
    applyMapStylesNow();
    updateCitiesVisibility();
    if (scene.spin && params.ui.viewMode === 'globe') startGlobeSpin();
    if (scene.rise && params.ui.viewMode !== 'globe') {
      const riseBtn = document.getElementById('btn-terrain-rise');
      if (riseBtn) setTimeout(function () { riseBtn.click(); }, 1100);
    }
    syncSceneUi();
    syncLookToggles();
    persist();
  }

  function renderSceneList() {
    const host = document.getElementById('scene-list');
    if (!host) return;
    host.innerHTML = '';
    SHOW_SCENES.forEach(function (s) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'scene-item';
      b.setAttribute('data-scene', s.id);
      b.innerHTML = '<strong>' + s.title + '</strong><span>' + (s.blurb || '') + '</span>';
      if (s.blurb) b.title = s.blurb;
      b.addEventListener('click', function () { applyScene(s.id); });
      host.appendChild(b);
    });
    syncSceneUi();
  }

  function setPanelOpen(open) {
    const panel = document.getElementById('panel');
    panel.classList.toggle('collapsed', !open);
    const tuner = document.getElementById('btn-tuner');
    if (tuner) tuner.classList.toggle('active', !!open);
  }

  function bindShowcase() {
    document.querySelectorAll('#viewmode-seg button').forEach(function (b) {
      b.addEventListener('click', function () {
        const mode = b.getAttribute('data-mode');
        params.ui.viewMode = mode;
        stopGlobeSpin();
        applyViewMode({ forceFrame: mode === 'globe' });
        if (mode === 'globe' && params.ui.sceneId === 'globe') startGlobeSpin();
      });
    });
    const tunerBtn = document.getElementById('btn-tuner');
    if (tunerBtn) {
      tunerBtn.addEventListener('click', function () {
        const panel = document.getElementById('panel');
        setPanelOpen(panel.classList.contains('collapsed'));
      });
    }
    // 窄屏上面板盖住地图，默认只露地图；宽屏默认展开
    if (window.matchMedia && window.matchMedia('(max-width: 900px)').matches) setPanelOpen(false);
    const copyBtn = document.getElementById('btn-chrome-copy');
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        const real = document.getElementById('btn-copy');
        if (real) real.click();
      });
    }
    document.querySelectorAll('#lighting-grid .chip').forEach(function (b) {
      b.addEventListener('click', function () { applyLighting(b.getAttribute('data-light')); });
    });
    document.querySelectorAll('#theme-grid .chip').forEach(function (b) {
      b.addEventListener('click', function () { applyTheme(b.getAttribute('data-theme')); });
    });
    function bindSw(id, fn) {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('click', fn);
    }
    bindSw('sw-sat', function () {
      const on = (params.maplibre.satellite.opacity || 0) <= 0.05;
      params.maplibre.satellite.opacity = on ? 0.7 : 0;
      applyMapStylesNow();
      syncLookToggles();
      persist();
    });
  }

  async function loadScenes() {
    try {
      const res = await fetch('scenes.json');
      if (res.ok) {
        const json = await res.json();
        if (json && Array.isArray(json.scenes)) SHOW_SCENES = json.scenes;
      }
    } catch (e) {
      console.info('scenes.json 未加载');
    }
    if (!SHOW_SCENES.length) {
      SHOW_SCENES = [
        { id: 'china', title: '全国古卷', blurb: '倾角地形', camera: VIEW_CHINA, ui: { showWater: true, showCities: true } },
        { id: 'globe', title: '地球·古卷', blurb: '球面', viewMode: 'globe', spin: true, camera: GLOBE_CAM, ui: { showCities: false } },
      ];
    }
    renderSceneList();
  }

  // ============================================================
  // 启动：优先尝试加载外部 preset JSON，再初始化
  // ============================================================
  async function boot() {
    // 若 localStorage 无数据，尝试 fetch 默认 preset 文件
    const hasLocal = !!localStorage.getItem(STORAGE_KEY);
    if (!hasLocal) {
      try {
        const res = await fetch('preset-antique-default.json');
        if (res.ok) {
          const preset = await res.json();
          params = mergeParams(DEFAULT_PARAMS, preset);
          params.season = null;
        }
      } catch (e) {
        // file:// 或离线时忽略，使用内嵌 DEFAULT_PARAMS
        console.info('未加载外部 preset 文件，使用内嵌默认值');
      }
    }

    bindControls();
    bindButtons();
    bindShowcase();
    if (window.AntiqueTunerVector) {
      vectorCtl = window.AntiqueTunerVector.mount({
        params: function () { return params; },
        map: function () { return map; },
        isReady: function () { return mapReady; },
        tileConfig: function () { return window.__tunerTileConfig; },
        persist: persist,
        toast: toast,
        applySkin: applySkinFromCatalog,
        afterBasemap: function () { applyMapStylesNow(); updateRoadsVisibility(); refreshAllControls(); syncLookToggles(); },
        afterPaint: function () { applyVectorWaterPaint(params.maplibre.water); },
      });
    }
    await loadScenes();
    updateIsolateSelect();
    updateIsolateUi();
    refreshAllControls();
    updatePresetStatus();
    updateRefImage();
    syncLookToggles();
    syncViewModeUi();
    initMap();
  }

  boot();
})();
