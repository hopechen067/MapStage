/**
 * han-city-3d.js
 * 汉代墨线方城 · MapLibre custom layer + Three.js 程序化模型
 *
 * 导出：
 *   window.HanCity3D = {
 *     createModel(THREE, palette?),
 *     createCustomLayer(maplibregl, THREE, options?),
 *     DEFAULT_PALETTE,
 *     FALLBACK_CITIES
 *   }
 */
(function (global) {
  'use strict';

  /** 羊皮纸 + 墨线古地图色板 */
  var DEFAULT_PALETTE = {
    wall: 0xc4a878,
    wallDark: 0xb89562,
    roof: 0x3a2818,
    roofDark: 0x2a1a10,
    wood: 0x5a4630,
    ground: 0xa88858,
    ink: 0x1e140c,
    plinth: 0x8a6a40,
  };

  /** sample sites loaded from JSON */
  var FALLBACK_CITIES = [];

  // —— 城池几何尺度（米，真实感建模）——
  // 叙事地图上再用 visualScale 放大（默认 ~28× → 约 30 km 足迹，zoom 5–7 可读）
  var FOOTPRINT = 1100;
  // zoom≈5 时约 1 像素≈3.8km；80×→足迹≈88km，广域视图可辨方城剪影
  var DEFAULT_VISUAL_SCALE = 80;
  var WALL_H = 55;
  var WALL_T = 42;
  var TOWER_W = 90;
  var TOWER_H = 95;
  var GATE_W = 220;
  var GATE_D = 110;
  var GATE_H = 100;

  function matStd(THREE, color, opts) {
    opts = opts || {};
    return new THREE.MeshStandardMaterial({
      color: color,
      roughness: opts.roughness != null ? opts.roughness : 0.88,
      metalness: opts.metalness != null ? opts.metalness : 0.02,
      emissive: opts.emissive != null ? opts.emissive : color,
      emissiveIntensity: opts.emissiveIntensity != null ? opts.emissiveIntensity : 0.06,
      flatShading: !!opts.flatShading,
      side: opts.side != null ? opts.side : THREE.FrontSide,
    });
  }

  /** 四棱锥庑殿/歇山感屋顶（径向 4 段圆锥 + 旋转对齐） */
  function makePyramidRoof(THREE, width, depth, height, material) {
    var geo = new THREE.ConeGeometry(0.5, 1, 4);
    var mesh = new THREE.Mesh(geo, material);
    mesh.scale.set(width * 1.12, height, depth * 1.12);
    mesh.rotation.y = Math.PI / 4;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    return mesh;
  }

  /** 墨线描边（低开销 EdgesGeometry） */
  function addInkEdges(THREE, mesh, inkColor) {
    try {
      var eg = new THREE.EdgesGeometry(mesh.geometry, 28);
      var lines = new THREE.LineSegments(
        eg,
        new THREE.LineBasicMaterial({
          color: inkColor != null ? inkColor : DEFAULT_PALETTE.ink,
          transparent: true,
          opacity: 0.72,
        })
      );
      // 跟随非均匀缩放
      lines.scale.copy(mesh.scale);
      // 若 mesh 自身有旋转，edges 作为子节点继承
      mesh.add(lines);
      // Cone 等已 scale 的 mesh：Edges 基于未缩放几何，重置 scale 用 1
      if (mesh.scale.x !== 1 || mesh.scale.y !== 1 || mesh.scale.z !== 1) {
        lines.scale.set(1, 1, 1);
      }
    } catch (e) {
      /* ignore */
    }
  }

  function boxMesh(THREE, w, h, d, material, y) {
    var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    m.position.y = y != null ? y : h / 2;
    m.castShadow = false;
    m.receiveShadow = false;
    return m;
  }

  /**
   * 程序化汉代墨线方城（Y-up，单位：米）
   * 足迹约 FOOTPRINT × FOOTPRINT
   */
  function createModel(THREE, palette) {
    var p = Object.assign({}, DEFAULT_PALETTE, palette || {});
    var root = new THREE.Group();
    root.name = 'han-ink-commandery';

    var matWall = matStd(THREE, p.wall, { roughness: 0.92, emissiveIntensity: 0.05 });
    var matWallDark = matStd(THREE, p.wallDark, { roughness: 0.9, emissiveIntensity: 0.04 });
    var matRoof = matStd(THREE, p.roof, { roughness: 0.78, emissiveIntensity: 0.08, flatShading: true });
    var matRoofDark = matStd(THREE, p.roofDark, { roughness: 0.8, emissiveIntensity: 0.06, flatShading: true });
    var matWood = matStd(THREE, p.wood, { roughness: 0.85, emissiveIntensity: 0.05 });
    var matGround = matStd(THREE, p.ground, { roughness: 0.95, emissiveIntensity: 0.03 });
    var matPlinth = matStd(THREE, p.plinth, { roughness: 0.94, emissiveIntensity: 0.03 });

    // 台基
    var plinth = boxMesh(THREE, FOOTPRINT * 1.12, 14, FOOTPRINT * 1.12, matPlinth, 7);
    root.add(plinth);

    // 内院地面
    var yard = boxMesh(THREE, FOOTPRINT - WALL_T * 2 - 8, 4, FOOTPRINT - WALL_T * 2 - 8, matGround, 15);
    root.add(yard);

    var half = FOOTPRINT / 2;
    var wallY = 14 + WALL_H / 2;

    // 四面城垣（南墙中间留门洞）
    // 北
    var north = boxMesh(THREE, FOOTPRINT, WALL_H, WALL_T, matWall, wallY);
    north.position.z = -half + WALL_T / 2;
    root.add(north);
    // 东
    var east = boxMesh(THREE, WALL_T, WALL_H, FOOTPRINT, matWallDark, wallY);
    east.position.x = half - WALL_T / 2;
    root.add(east);
    // 西
    var west = boxMesh(THREE, WALL_T, WALL_H, FOOTPRINT, matWallDark, wallY);
    west.position.x = -half + WALL_T / 2;
    root.add(west);
    // 南：左右两段 + 门楼
    var gateGap = GATE_W * 0.95;
    var southSegW = (FOOTPRINT - gateGap) / 2;
    var southL = boxMesh(THREE, southSegW, WALL_H, WALL_T, matWall, wallY);
    southL.position.set(-half + southSegW / 2, wallY, half - WALL_T / 2);
    root.add(southL);
    var southR = boxMesh(THREE, southSegW, WALL_H, WALL_T, matWall, wallY);
    southR.position.set(half - southSegW / 2, wallY, half - WALL_T / 2);
    root.add(southR);

    // 女墙顶（细条）
    function parapet(w, d, x, z) {
      var m = boxMesh(THREE, w, 10, d, matWood, 14 + WALL_H + 5);
      m.position.x = x;
      m.position.z = z;
      root.add(m);
    }
    parapet(FOOTPRINT, 8, 0, -half + WALL_T / 2);
    parapet(8, FOOTPRINT, half - WALL_T / 2, 0);
    parapet(8, FOOTPRINT, -half + WALL_T / 2, 0);
    parapet(southSegW, 8, -half + southSegW / 2, half - WALL_T / 2);
    parapet(southSegW, 8, half - southSegW / 2, half - WALL_T / 2);

    // 四角楼
    var corners = [
      [half - TOWER_W / 2, half - TOWER_W / 2],
      [half - TOWER_W / 2, -half + TOWER_W / 2],
      [-half + TOWER_W / 2, half - TOWER_W / 2],
      [-half + TOWER_W / 2, -half + TOWER_W / 2],
    ];
    for (var i = 0; i < corners.length; i++) {
      var cx = corners[i][0];
      var cz = corners[i][1];
      var body = boxMesh(THREE, TOWER_W, TOWER_H, TOWER_W, matWall, 14 + TOWER_H / 2);
      body.position.x = cx;
      body.position.z = cz;
      root.add(body);

      var cap = boxMesh(THREE, TOWER_W * 1.08, 12, TOWER_W * 1.08, matWood, 14 + TOWER_H + 6);
      cap.position.x = cx;
      cap.position.z = cz;
      root.add(cap);

      var roof = makePyramidRoof(THREE, TOWER_W * 1.25, TOWER_W * 1.25, 48, matRoof);
      roof.position.set(cx, 14 + TOWER_H + 12 + 24, cz);
      root.add(roof);
    }

    // 南门楼（两重檐）
    var gateBaseY = 14;
    var gateBody = boxMesh(THREE, GATE_W, GATE_H, GATE_D, matWall, gateBaseY + GATE_H / 2);
    gateBody.position.z = half - GATE_D * 0.35;
    root.add(gateBody);

    // 门洞（暗色凹进）
    var gateArch = boxMesh(
      THREE,
      GATE_W * 0.38,
      GATE_H * 0.55,
      GATE_D * 0.5,
      matStd(THREE, p.ink, { roughness: 1, emissiveIntensity: 0.02 }),
      gateBaseY + GATE_H * 0.32
    );
    gateArch.position.z = half - GATE_D * 0.1;
    root.add(gateArch);

    // 下层檐
    var eave1 = boxMesh(THREE, GATE_W * 1.2, 10, GATE_D * 1.25, matWood, gateBaseY + GATE_H * 0.55);
    eave1.position.z = gateBody.position.z;
    root.add(eave1);
    var roof1 = makePyramidRoof(THREE, GATE_W * 1.28, GATE_D * 1.35, 36, matRoof);
    roof1.position.set(0, gateBaseY + GATE_H * 0.55 + 5 + 18, gateBody.position.z);
    root.add(roof1);

    // 上层楼体 + 檐
    var upper = boxMesh(THREE, GATE_W * 0.72, GATE_H * 0.42, GATE_D * 0.7, matWallDark, gateBaseY + GATE_H + GATE_H * 0.21);
    upper.position.z = gateBody.position.z;
    root.add(upper);
    var eave2 = boxMesh(THREE, GATE_W * 0.95, 8, GATE_D * 0.95, matWood, gateBaseY + GATE_H + GATE_H * 0.42);
    eave2.position.z = gateBody.position.z;
    root.add(eave2);
    var roof2 = makePyramidRoof(THREE, GATE_W * 1.0, GATE_D * 1.0, 42, matRoofDark);
    roof2.position.set(0, gateBaseY + GATE_H + GATE_H * 0.42 + 4 + 21, gateBody.position.z);
    root.add(roof2);

    // 中央主殿
    var hallW = 280;
    var hallD = 200;
    var hallH = 70;
    var hall = boxMesh(THREE, hallW, hallH, hallD, matWall, 16 + hallH / 2);
    root.add(hall);
    var hallEave = boxMesh(THREE, hallW * 1.15, 10, hallD * 1.15, matWood, 16 + hallH);
    root.add(hallEave);
    var hallRoof = makePyramidRoof(THREE, hallW * 1.22, hallD * 1.22, 55, matRoof);
    hallRoof.position.y = 16 + hallH + 5 + 27;
    root.add(hallRoof);

    // 两侧配殿
    var sideW = 140;
    var sideD = 110;
    var sideH = 48;
    [-1, 1].forEach(function (sign) {
      var sx = sign * 280;
      var side = boxMesh(THREE, sideW, sideH, sideD, matWallDark, 16 + sideH / 2);
      side.position.x = sx;
      root.add(side);
      var se = boxMesh(THREE, sideW * 1.12, 8, sideD * 1.12, matWood, 16 + sideH);
      se.position.x = sx;
      root.add(se);
      var sr = makePyramidRoof(THREE, sideW * 1.2, sideD * 1.2, 36, matRoof);
      sr.position.set(sx, 16 + sideH + 4 + 18, 0);
      root.add(sr);
    });

    // 内院甬道（木色细条，增加层次）
    var path = boxMesh(THREE, 48, 3, FOOTPRINT * 0.35, matWood, 16.5);
    path.position.z = FOOTPRINT * 0.12;
    root.add(path);

    // 轻量墨线：仅给主墙/门楼加边，控制 draw call
    [north, east, west, gateBody, hall].forEach(function (m) {
      addInkEdges(THREE, m, p.ink);
    });

    root.userData.footprintMeters = FOOTPRINT;
    root.userData.modelId = 'han-ink-commandery-v001';
    return root;
  }

  function asFlat16(m) {
    if (!m) return null;
    if (Array.isArray(m) || ArrayBuffer.isView(m)) {
      if (m.length >= 16) return m;
      return null;
    }
    // mat4-like object / nested
    if (m.elements && m.elements.length >= 16) return m.elements;
    try {
      var arr = [];
      for (var i = 0; i < 16; i++) {
        if (m[i] == null) return null;
        arr.push(m[i]);
      }
      return arr;
    } catch (e) {
      return null;
    }
  }

  function extractMatrix(args) {
    if (!args) return null;
    // MapLibre v5：render(gl, args) 中 args.defaultProjectionData.mainMatrix
    if (args.defaultProjectionData) {
      var a =
        asFlat16(args.defaultProjectionData.mainMatrix) ||
        asFlat16(args.defaultProjectionData.projectionMatrix);
      if (a) return a;
    }
    if (args.modelViewProjectionMatrix) {
      var b = asFlat16(args.modelViewProjectionMatrix);
      if (b) return b;
    }
    // 部分版本第二参直接就是 16 元矩阵
    var c = asFlat16(args);
    if (c) return c;
    return null;
  }

  function resolveAltitude(map, lng, lat, fallback) {
    try {
      if (map && typeof map.queryTerrainElevation === 'function') {
        var e = map.queryTerrainElevation({ lng: lng, lat: lat }, { exaggerated: true });
        if (typeof e === 'number' && isFinite(e)) return e;
        // 部分版本返回非 exaggerated
        e = map.queryTerrainElevation({ lng: lng, lat: lat });
        if (typeof e === 'number' && isFinite(e)) return e;
      }
    } catch (err) {
      /* ignore */
    }
    return fallback != null ? fallback : 1600;
  }

  /**
   * 将米制 Y-up 模型放到 Mercator 坐标
   * MapLibre：X 东、Y 南、Z 上；Three 默认 Y 上 → 绕 X 转 90°，并 scale(s,-s,s)
   */
  function placeCityInstance(THREE, maplibregl, map, model, city) {
    var lng = city.lng;
    var lat = city.lat;
    var alt = resolveAltitude(map, lng, lat, city.altitude != null ? city.altitude : 1600);
    var mc = maplibregl.MercatorCoordinate.fromLngLat([lng, lat], alt);
    var s = mc.meterInMercatorCoordinateUnits();

    var g = model.clone(true);
    g.userData = {
      id: city.id,
      name: city.name,
      lng: lng,
      lat: lat,
    };
    g.name = city.name || city.id;

    // 经典 three.js + maplibre 变换
    g.position.set(mc.x, mc.y, mc.z);
    g.scale.set(s, -s, s);
    g.rotation.set(Math.PI / 2, 0, 0);

    // 南门朝南：模型 +Z 为南，旋转后与地图南向对齐（已由 rotationX 处理）
    return g;
  }

  /**
   * 创建 MapLibre custom layer
   * options:
   *   id, cities, visible, palette, altitudeBoost, visualScale
   * visualScale: 叙事放大倍数，默认 28（~30km 足迹，广域视图可读）
   */
  function createCustomLayer(maplibregl, THREE, options) {
    options = options || {};
    var layerId = options.id || 'han-city-3d';
    var cities = options.cities && options.cities.length ? options.cities : FALLBACK_CITIES;
    var palette = options.palette || null;
    var altitudeBoost = options.altitudeBoost != null ? options.altitudeBoost : 120;
    var visualScale = options.visualScale != null ? options.visualScale : DEFAULT_VISUAL_SCALE;

    var state = {
      map: null,
      renderer: null,
      scene: null,
      camera: null,
      citiesRoot: null,
      cityGroups: [],
      markers: [],
      visible: options.visible !== false,
      model: null,
      visualScale: visualScale,
      matrixWarned: false,
    };

    function applyPlacement(g, lng, lat, alt) {
      var mc = maplibregl.MercatorCoordinate.fromLngLat([lng, lat], alt);
      var s = mc.meterInMercatorCoordinateUnits() * state.visualScale;
      g.position.set(mc.x, mc.y, mc.z);
      // MapLibre mercator: scale Y 取负以配合 rotationX
      g.scale.set(s, -s, s);
      g.rotation.set(Math.PI / 2, 0, 0);
    }

    function syncLabelMarkers(map, show) {
      // 清理旧 markers
      for (var i = 0; i < state.markers.length; i++) {
        try {
          state.markers[i].remove();
        } catch (e) {
          /* ignore */
        }
      }
      state.markers = [];
      if (!show || !map) return;
      for (var j = 0; j < cities.length; j++) {
        var c = cities[j];
        var el = document.createElement('div');
        el.className = 'han-city-label';
        el.textContent = c.name || c.id;
        el.style.cssText =
          'font:600 12px/1.2 \"Segoe UI\",\"Microsoft YaHei\",sans-serif;' +
          'color:#f0e0c0;padding:3px 8px;border-radius:4px;' +
          'background:rgba(26,18,10,0.72);border:1px solid rgba(180,140,80,0.45);' +
          'white-space:nowrap;pointer-events:none;letter-spacing:0.04em;' +
          'text-shadow:0 1px 2px rgba(0,0,0,0.6);transform:translateY(-8px);';
        var mk = new maplibregl.Marker({ element: el, anchor: 'bottom' })
          .setLngLat([c.lng, c.lat])
          .addTo(map);
        state.markers.push(mk);
      }
    }

    var layer = {
      id: layerId,
      type: 'custom',
      renderingMode: '3d',

      onAdd: function (map, gl) {
        state.map = map;
        state.camera = new THREE.Camera();
        state.scene = new THREE.Scene();

        // 古卷暖光（略提亮度，避免在 sepia 滤镜下发黑）
        var amb = new THREE.AmbientLight(0xfff0d8, 1.05);
        state.scene.add(amb);
        var sun = new THREE.DirectionalLight(0xffe0b0, 1.1);
        sun.position.set(0.55, 1.1, 0.4).normalize();
        state.scene.add(sun);
        var fill = new THREE.DirectionalLight(0xd0c0a0, 0.45);
        fill.position.set(-0.55, 0.35, -0.55).normalize();
        state.scene.add(fill);

        state.renderer = new THREE.WebGLRenderer({
          canvas: map.getCanvas(),
          context: gl,
          antialias: true,
        });
        state.renderer.autoClear = false;
        if ('outputColorSpace' in state.renderer && THREE.SRGBColorSpace) {
          state.renderer.outputColorSpace = THREE.SRGBColorSpace;
        }

        state.model = createModel(THREE, palette);
        state.citiesRoot = new THREE.Group();
        state.citiesRoot.name = 'han-city-sites';
        state.scene.add(state.citiesRoot);

        for (var i = 0; i < cities.length; i++) {
          var c = cities[i];
          var baseAlt = resolveAltitude(map, c.lng, c.lat, 1600);
          var alt = baseAlt + altitudeBoost;
          var inst = state.model.clone(true);
          inst.userData = {
            id: c.id,
            name: c.name,
            lng: c.lng,
            lat: c.lat,
          };
          inst.name = c.name || c.id;
          applyPlacement(inst, c.lng, c.lat, alt);
          state.citiesRoot.add(inst);
          state.cityGroups.push(inst);
        }

        state.citiesRoot.visible = state.visible;
        syncLabelMarkers(map, state.visible);

        // 保证每帧触发 custom layer（部分浏览器 idle 后不重绘）
        map.triggerRepaint();
      },

      onRemove: function () {
        syncLabelMarkers(null, false);
        try {
          if (state.renderer) state.renderer.dispose();
        } catch (e) {
          /* ignore */
        }
        state.renderer = null;
        state.scene = null;
        state.camera = null;
        state.citiesRoot = null;
        state.cityGroups = [];
        state.map = null;
      },

      render: function (gl, args) {
        if (!state.renderer || !state.scene || !state.camera) return;
        if (!state.visible) return;

        var mat = extractMatrix(args);
        if (!mat) {
          if (!state.matrixWarned) {
            state.matrixWarned = true;
            console.warn(
              '[han-city-3d] 无法解析投影矩阵，args=',
              args && typeof args === 'object' ? Object.keys(args) : typeof args
            );
          }
          return;
        }

        var flat = Array.from ? Array.from(mat) : [];
        if (!flat.length) {
          for (var i = 0; i < 16; i++) flat.push(mat[i]);
        }
        var m = new THREE.Matrix4().fromArray(flat);
        state.camera.projectionMatrix.copy(m);
        if (state.camera.projectionMatrixInverse) {
          try {
            state.camera.projectionMatrixInverse.copy(m).invert();
          } catch (e) {
            /* ignore */
          }
        }

        // 与 MapLibre 共享 context：清深度并关掉深度测，避免城池被地形深度遮住
        state.renderer.resetState();
        try {
          gl.disable(gl.DEPTH_TEST);
          gl.disable(gl.STENCIL_TEST);
          gl.disable(gl.CULL_FACE);
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        } catch (e2) {
          /* ignore */
        }
        state.renderer.render(state.scene, state.camera);
        state.renderer.resetState();
        if (state.map) state.map.triggerRepaint();
      },

      /** 外部开关 */
      setVisible: function (v) {
        state.visible = !!v;
        if (state.citiesRoot) state.citiesRoot.visible = state.visible;
        syncLabelMarkers(state.map, state.visible);
        if (state.map) state.map.triggerRepaint();
      },

      getVisible: function () {
        return state.visible;
      },

      getCityGroups: function () {
        return state.cityGroups.slice();
      },

      setVisualScale: function (sc) {
        state.visualScale = sc > 0 ? sc : DEFAULT_VISUAL_SCALE;
        this.repositionToTerrain();
      },

      /** DEM 就绪后按地形海拔重定位（避免城池陷地） */
      repositionToTerrain: function () {
        if (!state.map || !state.cityGroups.length) return;
        for (var i = 0; i < state.cityGroups.length; i++) {
          var g = state.cityGroups[i];
          var ud = g.userData || {};
          if (ud.lng == null || ud.lat == null) continue;
          var alt = resolveAltitude(state.map, ud.lng, ud.lat, 1600) + altitudeBoost;
          applyPlacement(g, ud.lng, ud.lat, alt);
        }
        if (state.map) state.map.triggerRepaint();
      },
    };

    return layer;
  }

  /**
   * 五级默认尺度（halfKm=半边长 km 叙事足迹）
   * capital > large > medium > small；pass/station/ordos 为异形
   */
  var TIER_DEFAULTS = {
    capital: { modelType: 'commandery', halfKm: 30, heightScale: 1.35, labelSize: 13 },
    large: { modelType: 'commandery', halfKm: 22, heightScale: 1.15, labelSize: 12 },
    medium: { modelType: 'commandery', halfKm: 18, heightScale: 1.0, labelSize: 12 },
    small: { modelType: 'commandery', halfKm: 10, heightScale: 0.7, labelSize: 11 },
    pass: { modelType: 'pass', halfKm: 8, heightScale: 1.1, labelSize: 11 },
    station: { modelType: 'station', halfKm: 4, heightScale: 0.55, labelSize: 10 },
    ordos: { modelType: 'ordos', halfKm: 16, heightScale: 0.85, labelSize: 12 },
  };

  var PALETTES = {
    han: {
      wall: '#c4a878',
      tower: '#b89562',
      gate: '#5a4630',
      hall: '#3a2818',
      plinth: '#8a6a40',
    },
    foreign: {
      wall: '#a89878',
      tower: '#8f7a55',
      gate: '#4a3a28',
      hall: '#2e2418',
      plinth: '#7a6540',
    },
    ordos: {
      wall: '#6b5340',
      tower: '#5a4535',
      gate: '#3d2e22',
      hall: '#8b6914',
      plinth: '#5c4a38',
      tent: '#7a5c3a',
      tentDark: '#4a3828',
    },
  };

  function degLat(km) {
    return km / 110.574;
  }
  function degLng(km, lat) {
    return km / (111.32 * Math.cos((lat * Math.PI) / 180));
  }
  function rectRing(lng, lat, halfL, halfW) {
    var dLat = degLat(halfW);
    var dLng = degLng(halfL, lat);
    return [
      [lng - dLng, lat - dLat],
      [lng + dLng, lat - dLat],
      [lng + dLng, lat + dLat],
      [lng - dLng, lat + dLat],
      [lng - dLng, lat - dLat],
    ];
  }
  /** 绕中心旋转的矩形（关卡用） */
  function rotatedRectRing(lng, lat, halfL, halfW, bearingDeg) {
    var rad = ((bearingDeg || 0) * Math.PI) / 180;
    var cos = Math.cos(rad);
    var sin = Math.sin(rad);
    var corners = [
      [-halfL, -halfW],
      [halfL, -halfW],
      [halfL, halfW],
      [-halfL, halfW],
      [-halfL, -halfW],
    ];
    return corners.map(function (p) {
      var x = p[0] * cos - p[1] * sin;
      var y = p[0] * sin + p[1] * cos;
      return [lng + degLng(x, lat), lat + degLat(y)];
    });
  }
  function regularPolygonRing(lng, lat, radiusKm, sides, rotDeg) {
    var n = sides || 8;
    var rot = (((rotDeg || 0) * Math.PI) / 180);
    var ring = [];
    for (var i = 0; i <= n; i++) {
      var a = rot + (i / n) * Math.PI * 2;
      ring.push([lng + degLng(radiusKm * Math.cos(a), lat), lat + degLat(radiusKm * Math.sin(a))]);
    }
    return ring;
  }

  function resolveSiteParams(site, globalHalfKm) {
    var tier = site.tier || 'medium';
    var def = TIER_DEFAULTS[tier] || TIER_DEFAULTS.medium;
    var modelType = site.modelType || def.modelType || 'commandery';
    var halfKm =
      site.halfKm != null
        ? site.halfKm
        : def.halfKm != null
          ? def.halfKm
          : globalHalfKm != null
            ? globalHalfKm
            : 18;
    if (site.scale != null && site.halfKm == null) {
      halfKm = (def.halfKm != null ? def.halfKm : 18) * site.scale;
    }
    var heightScale =
      site.heightScale != null
        ? site.heightScale
        : def.heightScale != null
          ? def.heightScale
          : 1;
    var paletteKey = site.palette || (modelType === 'ordos' ? 'ordos' : 'han');
    var colors = PALETTES[paletteKey] || PALETTES.han;
    return {
      modelType: modelType,
      halfKm: halfKm,
      heightScale: heightScale,
      colors: colors,
      labelSize: site.labelSize || def.labelSize || 12,
      bearing: site.bearing != null ? site.bearing : 0,
    };
  }

  function feat(kind, height, color, name, id, ringCoords) {
    return {
      type: 'Feature',
      properties: {
        kind: kind,
        height: height,
        base: 0,
        color: color,
        name: name || '',
        id: id || '',
      },
      geometry: { type: 'Polygon', coordinates: [ringCoords] },
    };
  }

  /** 汉式 / 城郭国方城 */
  function buildCommanderyFeatures(site, p) {
    var features = [];
    var lng = site.lng;
    var lat = site.lat;
    var halfKm = p.halfKm;
    var hs = p.heightScale;
    var col = p.colors;
    var name = site.name;
    var id = site.id;

    function hollowWall(outerH, halfOuter) {
      var t = halfOuter * 0.12;
      var o = halfOuter;
      var parts = [
        { cx: 0, cy: o - t / 2, hx: o, hy: t / 2 },
        { cx: 0, cy: -(o - t / 2), hx: o, hy: t / 2 },
        { cx: o - t / 2, cy: 0, hx: t / 2, hy: o - t },
        { cx: -(o - t / 2), cy: 0, hx: t / 2, hy: o - t },
      ];
      return parts.map(function (part) {
        var clng = lng + degLng(part.cx, lat);
        var clat = lat + degLat(part.cy);
        return feat(
          'wall',
          outerH,
          col.wall,
          name,
          id,
          rectRing(clng, clat, part.hx, part.hy)
        );
      });
    }

    features = features.concat(hollowWall(Math.round(900 * hs), halfKm));

    // 首都加一层内城，强化规模
    if (site.tier === 'capital' || site.role === 'capital') {
      features = features.concat(hollowWall(Math.round(1050 * hs), halfKm * 0.55));
      features.push(
        feat(
          'hall',
          Math.round(1500 * hs),
          col.hall,
          name,
          id,
          rectRing(lng, lat + degLat(halfKm * 0.05), halfKm * 0.18, halfKm * 0.14)
        )
      );
    }

    var corner = halfKm * 0.78;
    var corners = [
      [corner, corner],
      [corner, -corner],
      [-corner, corner],
      [-corner, -corner],
    ];
    for (var k = 0; k < corners.length; k++) {
      var clng = lng + degLng(corners[k][0], lat);
      var clat = lat + degLat(corners[k][1]);
      features.push(
        feat(
          'tower',
          Math.round(1400 * hs),
          col.tower,
          name,
          id,
          rectRing(clng, clat, halfKm * 0.12, halfKm * 0.12)
        )
      );
    }

    features.push(
      feat(
        'gate',
        Math.round(1600 * hs),
        col.gate,
        name,
        id,
        rectRing(lng, lat - degLat(halfKm * 0.92), halfKm * 0.22, halfKm * 0.1)
      )
    );
    features.push(
      feat(
        'hall',
        Math.round(1100 * hs),
        col.hall,
        name,
        id,
        rectRing(lng, lat + degLat(halfKm * 0.08), halfKm * 0.28, halfKm * 0.18)
      )
    );
    features.push(
      feat(
        'plinth',
        Math.round(200 * hs),
        col.plinth,
        name,
        id,
        rectRing(lng, lat, halfKm * 1.08, halfKm * 1.08)
      )
    );
    return features;
  }

  /** 关卡：长墙 + 门墩 + 两侧墩台 */
  function buildPassFeatures(site, p) {
    var features = [];
    var lng = site.lng;
    var lat = site.lat;
    var halfKm = p.halfKm;
    var hs = p.heightScale;
    var col = p.colors;
    var bearing = p.bearing;
    var name = site.name;
    var id = site.id;
    var wallLen = halfKm * 2.2;
    var wallDepth = halfKm * 0.22;

    features.push(
      feat(
        'plinth',
        Math.round(120 * hs),
        col.plinth,
        name,
        id,
        rotatedRectRing(lng, lat, wallLen * 0.55, wallDepth * 1.4, bearing)
      )
    );
    features.push(
      feat(
        'wall',
        Math.round(900 * hs),
        col.wall,
        name,
        id,
        rotatedRectRing(lng, lat, wallLen * 0.5, wallDepth * 0.5, bearing)
      )
    );
    features.push(
      feat(
        'gate',
        Math.round(1500 * hs),
        col.gate,
        name,
        id,
        rotatedRectRing(lng, lat, halfKm * 0.28, wallDepth * 0.95, bearing)
      )
    );

    var rad = (bearing * Math.PI) / 180;
    var offset = halfKm * 0.85;
    var sideOffsets = [
      [offset * Math.cos(rad), offset * Math.sin(rad)],
      [-offset * Math.cos(rad), -offset * Math.sin(rad)],
    ];
    for (var i = 0; i < sideOffsets.length; i++) {
      var sx = sideOffsets[i][0];
      var sy = sideOffsets[i][1];
      features.push(
        feat(
          'tower',
          Math.round(1300 * hs),
          col.tower,
          name,
          id,
          rotatedRectRing(
            lng + degLng(sx, lat),
            lat + degLat(sy),
            halfKm * 0.18,
            halfKm * 0.18,
            bearing
          )
        )
      );
    }
    return features;
  }

  /** 驿站：小台基 + 厅 + 望楼 */
  function buildStationFeatures(site, p) {
    var features = [];
    var lng = site.lng;
    var lat = site.lat;
    var halfKm = p.halfKm;
    var hs = p.heightScale;
    var col = p.colors;
    var name = site.name;
    var id = site.id;

    features.push(
      feat(
        'plinth',
        Math.round(100 * hs),
        col.plinth,
        name,
        id,
        rectRing(lng, lat, halfKm * 1.1, halfKm * 0.85)
      )
    );
    features.push(
      feat(
        'wall',
        Math.round(450 * hs),
        col.wall,
        name,
        id,
        rectRing(lng, lat, halfKm * 0.95, halfKm * 0.7)
      )
    );
    features.push(
      feat(
        'hall',
        Math.round(700 * hs),
        col.hall,
        name,
        id,
        rectRing(lng, lat + degLat(halfKm * 0.05), halfKm * 0.45, halfKm * 0.28)
      )
    );
    features.push(
      feat(
        'tower',
        Math.round(950 * hs),
        col.tower,
        name,
        id,
        rectRing(lng + degLng(halfKm * 0.55, lat), lat - degLat(halfKm * 0.35), halfKm * 0.2, halfKm * 0.2)
      )
    );
    return features;
  }

  /** 毡帐营地：中心大帐 + 环帐 + 低台，非汉式方城 */
  function buildOrdosFeatures(site, p) {
    var features = [];
    var lng = site.lng;
    var lat = site.lat;
    var halfKm = p.halfKm;
    var hs = p.heightScale;
    var col = p.colors;
    var name = site.name;
    var id = site.id;

    features.push(
      feat(
        'plinth',
        Math.round(80 * hs),
        col.plinth,
        name,
        id,
        regularPolygonRing(lng, lat, halfKm * 1.05, 12, 0)
      )
    );
    // 中心大帐
    features.push(
      feat(
        'hall',
        Math.round(1100 * hs),
        col.hall || col.tent,
        name,
        id,
        regularPolygonRing(lng, lat, halfKm * 0.42, 10, 12)
      )
    );
    // 中帐略抬高尖顶感（第二层）
    features.push(
      feat(
        'tower',
        Math.round(1450 * hs),
        col.tentDark || col.gate,
        name,
        id,
        regularPolygonRing(lng, lat, halfKm * 0.22, 8, 20)
      )
    );
    // 环绕副帐
    var ringR = halfKm * 0.72;
    var n = 8;
    for (var i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2;
      var clng = lng + degLng(ringR * Math.cos(a), lat);
      var clat = lat + degLat(ringR * Math.sin(a));
      features.push(
        feat(
          'wall',
          Math.round(650 * hs),
          col.tent || col.wall,
          name,
          id,
          regularPolygonRing(clng, clat, halfKm * 0.16, 8, i * 15)
        )
      );
    }
    // 外围低篱示意
    features.push(
      feat(
        'gate',
        Math.round(280 * hs),
        col.gate,
        name,
        id,
        regularPolygonRing(lng, lat, halfKm * 0.95, 16, 0)
      )
    );
    return features;
  }

  /**
   * 统一构建：按 site.modelType / tier 分发
   * 兼容旧调用 buildExtrusionFeatures(cities, halfKm)
   */
  function buildExtrusionFeatures(cities, halfKmOrOptions) {
    var globalHalfKm = 18;
    if (typeof halfKmOrOptions === 'number') globalHalfKm = halfKmOrOptions;
    else if (halfKmOrOptions && halfKmOrOptions.halfKm != null) globalHalfKm = halfKmOrOptions.halfKm;

    var features = [];
    for (var i = 0; i < cities.length; i++) {
      var site = cities[i];
      if (site.lng == null || site.lat == null) continue;
      var p = resolveSiteParams(site, globalHalfKm);
      var part = [];
      if (p.modelType === 'pass') part = buildPassFeatures(site, p);
      else if (p.modelType === 'station') part = buildStationFeatures(site, p);
      else if (p.modelType === 'ordos') part = buildOrdosFeatures(site, p);
      else part = buildCommanderyFeatures(site, p);
      features = features.concat(part);
    }
    return { type: 'FeatureCollection', features: features };
  }

  function labelStyleForSite(site) {
    var p = resolveSiteParams(site, 18);
    var size = p.labelSize || 12;
    var isOrdos = p.modelType === 'ordos';
    var isPass = p.modelType === 'pass';
    var isStation = p.modelType === 'station';
    var bg = isOrdos
      ? 'rgba(40,28,18,0.78)'
      : isStation
        ? 'rgba(26,20,14,0.65)'
        : 'rgba(26,18,10,0.72)';
    var border = isOrdos
      ? 'rgba(160,120,60,0.5)'
      : isPass
        ? 'rgba(140,110,70,0.5)'
        : 'rgba(180,140,80,0.45)';
    return (
      'font:600 ' +
      size +
      'px/1.2 "Segoe UI","Microsoft YaHei",sans-serif;' +
      'color:#f0e0c0;padding:3px 8px;border-radius:4px;' +
      'background:' +
      bg +
      ';border:1px solid ' +
      border +
      ';' +
      'white-space:nowrap;pointer-events:none;letter-spacing:0.04em;' +
      'text-shadow:0 1px 2px rgba(0,0,0,0.6);transform:translateY(-10px);'
    );
  }

  /**
   * 在 map 上挂 extrusion 城池 + 标签（可靠路径，优先使用）
   * 返回 { setVisible, remove, markers }
   */
  function addExtrusionCities(map, maplibregl, options) {
    options = options || {};
    var cities = options.cities && options.cities.length ? options.cities : FALLBACK_CITIES;
    var halfKm = options.halfKm != null ? options.halfKm : 18;
    var sourceId = options.sourceId || 'han-city-extrude-src';
    var layerId = options.layerId || 'han-city-extrude';
    var visible = options.visible !== false;
    var fc = buildExtrusionFeatures(cities, halfKm);
    var markers = [];

    if (map.getSource(sourceId)) {
      map.getSource(sourceId).setData(fc);
    } else {
      map.addSource(sourceId, { type: 'geojson', data: fc });
    }

    function ensureLayer(id, filter, opacity) {
      if (map.getLayer(id)) return;
      map.addLayer({
        id: id,
        type: 'fill-extrusion',
        source: sourceId,
        filter: filter,
        paint: {
          'fill-extrusion-color': ['get', 'color'],
          'fill-extrusion-height': ['get', 'height'],
          'fill-extrusion-base': ['get', 'base'],
          'fill-extrusion-opacity': opacity,
        },
        layout: { visibility: visible ? 'visible' : 'none' },
      });
    }

    ensureLayer(layerId + '-plinth', ['==', ['get', 'kind'], 'plinth'], 0.88);
    ensureLayer(layerId + '-wall', ['==', ['get', 'kind'], 'wall'], 0.92);
    ensureLayer(
      layerId + '-tower',
      ['in', ['get', 'kind'], ['literal', ['tower', 'gate', 'hall']]],
      0.95
    );

    function clearMarkers() {
      for (var i = 0; i < markers.length; i++) {
        try {
          markers[i].remove();
        } catch (e) {
          /* ignore */
        }
      }
      markers = [];
    }

    function syncMarkers(show) {
      clearMarkers();
      if (!show) return;
      for (var j = 0; j < cities.length; j++) {
        var c = cities[j];
        if (c.label === false) continue;
        var el = document.createElement('div');
        el.className = 'han-city-label tier-' + (c.tier || 'medium');
        el.textContent = c.name || c.id;
        el.style.cssText = labelStyleForSite(c);
        markers.push(
          new maplibregl.Marker({ element: el, anchor: 'bottom' })
            .setLngLat([c.lng, c.lat])
            .addTo(map)
        );
      }
    }

    syncMarkers(visible);

    var layerIds = [layerId + '-plinth', layerId + '-wall', layerId + '-tower'];

    return {
      type: 'extrusion',
      setVisible: function (v) {
        var vis = v ? 'visible' : 'none';
        for (var i = 0; i < layerIds.length; i++) {
          if (map.getLayer(layerIds[i])) {
            map.setLayoutProperty(layerIds[i], 'visibility', vis);
          }
        }
        syncMarkers(!!v);
      },
      getVisible: function () {
        return visible;
      },
      getCities: function () {
        return cities.slice();
      },
      remove: function () {
        clearMarkers();
        for (var i = 0; i < layerIds.length; i++) {
          if (map.getLayer(layerIds[i])) map.removeLayer(layerIds[i]);
        }
        if (map.getSource(sourceId)) map.removeSource(sourceId);
      },
      repositionToTerrain: function () {
        /* extrusion 自动贴地形 */
      },
    };
  }

  var api = {
    createModel: createModel,
    createCustomLayer: createCustomLayer,
    addExtrusionCities: addExtrusionCities,
    buildExtrusionFeatures: buildExtrusionFeatures,
    buildCommanderyFeatures: buildCommanderyFeatures,
    buildPassFeatures: buildPassFeatures,
    buildStationFeatures: buildStationFeatures,
    buildOrdosFeatures: buildOrdosFeatures,
    resolveSiteParams: resolveSiteParams,
    TIER_DEFAULTS: TIER_DEFAULTS,
    DEFAULT_PALETTE: DEFAULT_PALETTE,
    FALLBACK_CITIES: FALLBACK_CITIES,
  };

  global.HanCity3D = api;
})(typeof window !== 'undefined' ? window : this);
