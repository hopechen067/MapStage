# MapLibre 官方文档对照盘点

对照 [roadmap.md](roadmap.md) 的阶段与待办，以及本引擎已经在跑的栈。方案与开通顺序见 [maplibre-optimization-and-enablement.md](maplibre-optimization-and-enablement.md)。

| 项 | 值 |
|----|----|
| 写于 | 2026-08-29 |
| 官方文档快照 | MapLibre GL JS **6.6.0** 文档站（examples / guides / API / plugins）+ Style Spec |
| 入口 | https://maplibre.org/maplibre-gl-js/docs/examples/ |
| 本库生产 JS | 调参台：`tuner/vendor/maplibre-gl.js` **patched 5.6.0-dev**；成片模板：unpkg **5.6.0 未打补丁**；矢量实验室：unpkg **6.6.0 ESM** |

本文不改对外卖点、不引入 npm、不把 `flyTo` 写成商品。硬约束仍以 [SKILL.md](../SKILL.md)、[runtime-perf.md](runtime-perf.md)、[tested-config.md](tested-config.md) 为准。

---

## 1. 读了哪些官方材料

文档站分成六块。下面每块都过完目录；example 以 Overview 全表为准，高价值页另开正文。

| 块 | URL | 对本库的结论 |
|----|-----|--------------|
| Introduction | `/docs/` | 官方默认已是 **v6 ESM**（`maplibre-gl.mjs` + worker）。CDN 无 bundler 时 worker 走 Blob URL。我们生产仍是 **v5 UMD 补丁包**。 |
| Examples Overview | `/docs/examples/` | 约 140 个示例，六类：Basics / Sources / Layers / Annotations / Interactivity / 3D·Globe。第 4 节全表分流。 |
| Guides | `/docs/guides/` | 真正有用的是 [large-data](https://maplibre.org/maplibre-gl-js/docs/guides/large-data/)（大 GeoJSON）和 [v5→v6](https://maplibre.org/maplibre-gl-js/docs/guides/v5-to-v6-migration-guide/)。Leaflet / OpenLayers / Mapbox 迁移与本库无关。 |
| Style Spec | `/maplibre-style-spec/` | 根属性、sources、layers（10 种）、terrain、sky、projection、light、glyphs/sprite。第 5 节。 |
| API | `/docs/API/` | `MapOptions`、`GeoJSONSource`（`setData` / `updateData`）、`CustomLayerInterface`、全局函数 `prewarm` / `setMaxParallelImageRequests` / `setWorkerCount`。 |
| Plugins | `/docs/plugins/` | 第 6 节。多数 UI 插件不进视频线。 |

抽读的 example 正文：`3d-terrain`、`add-a-hillshade-layer`、`add-a-color-relief-layer`、`sky-fog-terrain`、`display-a-globe-with-an-atmosphere`、`display-a-globe-with-a-fill-extrusion-layer`、`level-of-detail-control`、`display-performance-metrics`、`fill-extrusion-rounded-corners`。

---

## 2. 我们「想做 / 需要做」的权威来源

不要按 MapLibre 图层类型排优先级。按导演选镜头的六个顶类（见 [roadmap.md](roadmap.md)）排。

| 顶类 | 现在 | 视频刚需缺口 |
|------|------|----------------|
| `stage` 展台 | home / tuner / vector-layers / hexi-map-shot | 站点深链与成片栏目是产品事，不是 MapLibre 缺口 |
| `skin` 皮肤 | 矢量实验室 5 套；tuner CSS grade | 换皮管道已通；分层设色只在 6.6 页上 |
| `camera` 地球与镜头 | globe / isolate 岛 / `terrainRise` | 国→省→市一条过门未包装；录屏必须 `jumpTo` |
| `city` 城邑 | 七级 fill-extrusion + Three 兜底 | **缺 zoom LOD 包装**；夜城 / 营造中未做 |
| `march` 行军 | **几乎没有** | **缺口最大**：路线、箭头、部队、`routeProgress` |
| `climate` 气候与态势 | 水系 + HTML 河名 | 雾/沙尘是 canvas；控制区/热力未做 |

引擎硬需求（视频线，不是 tuner UX）：

1. Terrarium DEM + 可选授权栅格 + hillshade + CSS 古卷滤镜
2. `createMap({ mode: 'record' })` → `precacheViewports` → `jumpTo` + `waitIdle`
3. isolate 在 patched 5.6 上 **保留地形并裁网格**，禁止为此 `setTerrain(null)`
4. 水系可关、可本地 pack，**不进 MIT**
5. 成片宿主 ≠ tuner；成片时不打 license

---

## 3. 版本与官方默认的裂缝

官方 example 全部写成 `maplibre-gl@6.6.0` ESM。我们是 **三套运行时并存**。

| 页面 | JS | 后果 |
|------|----|------|
| `tuner/index.html` | patched 5.6.0 UMD | 地形岛 clip **只在这里** |
| `tuner/hexi-map-shot.html` | unpkg 5.6.0 **未打补丁** | 河西成片模板 **没有** 岛裁切 |
| `tuner/vector-layers.html` | unpkg **6.6.0** ESM | `color-relief`、新 hillshade 算法、globe 与官方一致；**不能**跑岛补丁 |

（旧展台 `home.html`、`fx.html` 等货架页已随官网重写删除；官网示例页在 `site/examples/`，不属于调参台运行时。）

Style Spec 对关键能力的 GL JS 版本（与「必须升 6」不是一回事）：

| 能力 | Spec 标注 GL JS | 本库 |
|------|-----------------|------|
| `color-relief` | **5.6.0** | 只用在 6.6 页。vendor 5.6 源码里 **已经有** `paint_color-relief` |
| `hillshade-method`（含 multidirectional） | 5.5.0 | vendor 已有；tuner **从未设**，一直 implicit `standard` |
| `style.state` / `setGlobalStateProperty` | 5.6.0 | 未用。城状态、行军开关适合这条 |
| `line-gradient` + `lineMetrics` | 0.45.0 | **未用**。行军墨线/流光的官方原语 |
| `line-dasharray` | 0.10.0；**与 line-gradient 互斥** | 未用。虚线官道要单独一层 |
| `line-layer-opacity` | **6.0.0** | 未用。多路重叠路线要 6.x |
| `fill-extrusion-rounded-corner-distance` | **6.2.0** | 未用。汉城圆角要 6.x + 岛补丁移植 |
| `symbol-height-offset` | **6.6.0** | 未用。城标浮在地形上要 6.6 |
| glyphs 可省略、走本地字体 | 5.11.0 | 我们用 HTML Marker 绕开 glyphs，合理 |
| `font-faces` | GL JS **未实现**（#6637） | 不要等它做中文 |
| 官方 3D Terrain example | 双份 `raster-dem`（terrain + hillshade） | 我们 **共用一份**（实测 DEM 请求 −58%）。`terrain.dualSource` 是逃生门 |

v5→v6 迁移对生产路径的硬点：UMD 消失、必须 `type="module"`、bundler 要 `setWorkerUrl`、`styleimagemissing` 改 `setMissingStyleImageResolver`、嵌套 GeoJSON 属性不再是 JSON 字符串。**岛补丁未移植前，生产不要升 6。**

---

## 4. 官方 example 全表分流

图例：**在用** = 生产或 tuner 已按此原语工作；**该接** = 对齐「要做」且不违反录屏硬规则；**tuner 可玩** = 只许交互页；**明确不做** = 和古卷/视频线冲或官方已警告不确定。

### 4.1 Map Basics — Camera & Animation

| Example | 分流 | 说明 |
|---------|------|------|
| Display a map / satellite / MLT | 在用（栅格） | MLT 编码与本栈无关 |
| Display a non-interactive map | 在用 | `hexi-map-shot` `interactive: false` |
| Check WebGL / attribution position | 忽略 | 不阻塞 |
| **Jump to a series of locations** | **在用** | 成片唯一合法相机原语 |
| Fly to / slowly fly / fly on scroll | 明确不做（商品） | tuner `easeToCamera` 可留；home `flyTo` 仅展台 |
| Set pitch and bearing | 在用 | `maxPitch: 85`（官方默认 60） |
| Animate a line / point / point along route | **该接（数据层）** | 官方用每帧 `setData`。**录屏改 canvas `routeProgress`**，不要抄 example 的 rAF |
| Animate camera around a point | tuner 可玩 | 录屏用预缓存关键帧 |
| Customize camera animations | 明确不做（成片） | AnimationOptions 非确定 |
| Fit bounds / fit LineString | 在用 | `reliefCameraForFeature` ← `cameraForBounds` |
| Hash routing | tuner 可玩 | 成片禁 URL 时钟 |
| **Level of Detail Control** | **该接（试验）** | `setSourceTileLodParams`；高 pitch 河西近景瓦片过密 |
| Offset vanishing point (padding) | 近 | HUD / 签条压画面时 |
| Render world copies | 在用 `false` | 矢量实验室 globe 改 `true` |
| Restrict panning / maxBounds | tuner 可玩 | |
| Set center above ground | 近 | `centerClampedToGround` / elevation；近景俯冲 |
| Enter 360° photosphere / first-person walk | 明确不做 | |
| Customize transform constrain | 忽略 | |

### 4.2 Sources

| Example | 分流 | 说明 |
|---------|------|------|
| Vector tile source | 在用（仅 vector-layers） | OpenFreeMap，不是生产古卷底 |
| GeoJSON line / polygon / points / multi-geom | 在用 | 水、isolate、城 footprint |
| View local GeoJSON | tuner 可玩 | 已有粘贴 polygon |
| Raster / WMS | 在用 raster | WMS 非默认 |
| Canvas source | **该接（行军/尘土）** | 与 map-story-assets 同构；官方是地理四角贴画布 |
| Image source / animate images | 另一 skill | 手绘底图不在本库 isolate 路径 |
| Video source | 明确不做 | 成片确定性 |
| COG raster | 远 | 自有 DEM 时再议 |
| Live realtime / update feature / update polygons | 明确不做（成片） | `updateData` 可给 tuner 编辑器 |

### 4.3 Layers — 样式与地形

| Example | 分流 | 说明 |
|---------|------|------|
| Icon / generated icon / stretchable / GPU icon / remote SVG / fallback | 该接（箭头家族） | 要 glyphs/sprite 或 `addImage`；现全是 HTML Marker |
| **Elevate symbols above terrain** | **该接（6.6）** | `symbol-height-offset`；城标、关隘 |
| Custom style layer | 在用 | `han-city-3d`、`region-island-walls` |
| Fill pattern | 近 | 控制区斜纹、营造中脚手架 |
| Data-driven line / zoom-color buildings | 该接 | 兵力映宽度、夜城 |
| **Gradient line / gradient dashed line** | **该接** | 行军主原语。注意 **gradient 与 dasharray 互斥** |
| Filter / global state / toggle list | 该接 | `style.state` 切城状态、行军可见性 |
| Heatmap / clusters / HTML clusters | 远（态势热力） | 不要用 OSM 点冒充部队 |
| Time slider | 近 | 朝代/战役时刻；成片仍是 jumpTo 链 |
| 3D Terrain / hybrid satellite | 在用 | 官方双 DEM vs 我们单 DEM：见 §3 |
| Hillshade / **multidirectional hillshade** | 该接 | `hillshade-method` 已在 5.5，tuner 没暴露 |
| **Color relief** | 该接（生产） | Spec 5.6；不必等 6.6 |
| Contour lines | 远 | `maplibre-contour`；气候第二波 |
| Sky, Fog, Terrain | 在用（黑天空） | 晨雾/沙尘不要靠 sky 冒充，用 canvas |
| Buildings 3D / indoor / **rounded corners** | 部分 | 汉城用自己的 extrusion；**禁止 OSM 真楼**。圆角要 6.2 |
| three.js / babylon / 3D tiles / quantized-mesh | 明确不做（默认） | Three 只保留城兜底；quantized-mesh 换数据源会打爆 Terrarium 合同 |
| Globe ± atmosphere ± extrusion ± custom | 在用（展台） | 成片文档：**录屏留 mercator** |

### 4.4 Annotations & Labels

| Example | 分流 | 说明 |
|---------|------|------|
| Marker / custom / draggable / animate | 在用（河名、城名） | 无 glyphs 的正确绕路 |
| Popup * | tuner 可玩 | 成片不要 DOM 弹层 |
| Rich text / web fonts / local fonts / variable placement | 近（6.x 城标） | 中文优先 `localIdeographFontFamily` 或继续 HTML |
| Change language / RTL / locale | 忽略 | |
| Locally generated ideographs | 近 | 若上 symbol 中文 |

### 4.5 Interactivity & Extensions

| Example | 分流 | 说明 |
|---------|------|------|
| queryRenderedFeatures / hover feature-state / mouse coords | tuner 可玩 | 成片无指针 |
| **Display Performance Metrics** | **该接（tuner）** | `load` / `idle` / `render` FPS；不要开进 record |
| PMTiles protocol | 近 | 自托管水系/矢量；`addProtocol` |
| addProtocol transform properties | 近 | 瓦片改写、本地代理之上 |
| Geocoder / draw / terra-draw / deck.gl / sync maps | 明确不做（引擎） | 编辑器已有粘贴 GeoJSON |
| Cooperative gestures / geolocate / fullscreen / game controls | 明确不做 | |

---

## 5. Style Spec：已用 vs 闲置但值钱

图层类型十种。本库实际：`background` `raster` `hillshade` `fill` `line` `fill-extrusion` `custom`（API 层，不在 spec enum）+ 实验室 `color-relief`。

**从未用：** `symbol` `circle` `heatmap`。

| Spec 能力 | 状态 | 对齐哪个顶类 |
|-----------|------|----------------|
| `raster-dem` + `encoding: terrarium` | 在用，强制 | camera |
| `geojson` `buffer` / `tolerance` / `maxzoom` | 水系 **未设** source maxzoom | climate 性能 |
| `geojson.lineMetrics` | 未开 | march 渐变线 |
| `vector` + `encoding: mlt` | 未用 | 不优先 |
| `image` / `video` / `canvas` source | 未用 | canvas source ≈ 行军贴地 |
| `style.sky` + `atmosphere-blend` | 在用 | camera globe |
| `style.light` | **未设** | city 夜城挤出受光 |
| `style.terrain` 写进 `new Map()` | 在用 | 官方 3d-terrain 同样要求 |
| `style.projection` interpolate globe→mercator | 实验室/展台有 setProjection | camera 过门 |
| `style.state` | 未用 | city / march 开关 |
| `glyphs` / `sprite` | 有意不用 | 上箭头 icon 才需要 |
| `transition` | record 应 0 | 已靠 fadeDuration / raster-fade |
| `fill-extrusion-vertical-gradient` | 默认 true，未调 | city |
| `hillshade-illumination-altitude` | 未暴露 | skin / 日照感 |
| `hillshade-method` | 未暴露 | skin |
| `symbol-placement: line` | 未用 | march 箭头沿路 |

`MapOptions` 我们已经对齐或有意偏离的：

| 选项 | 官方默认 | 我们 | 是否改 |
|------|----------|------|--------|
| `maxPitch` | 60 | 85 | 保持 85（官方 3D 例同样） |
| `maxTileCacheZoomLevels` | 5 | 12 | 保持；预缓存依赖 |
| `pixelRatio` | `devicePixelRatio` | record=1 | 保持 |
| `refreshExpiredTiles` | true | false | 保持 |
| `renderWorldCopies` | true | false | 保持（中国框） |
| `cancelPendingTileRequestsWhileZooming` | true | true | 保持 |
| `validateStyle` | true | record=false | 保持 |
| `fadeDuration` | 300 | record=0 | 保持 |
| `zoomLevelsToOverscale` | v6 默认 4 | 未设（5.x 行为不同） | 升 6 时要回归测试标注 |
| `terrainSkirtLength` | auto | 未设 | 岛边缘缝时再关 |
| `collectResourceTiming` | false | false | tuner 诊断可临时 true |
| `localIdeographFontFamily` | `'sans-serif'` | 未设 | 上 symbol 中文时 |

---

## 6. 官方插件：只开对视频有用的

| 插件 | 分流 |
|------|------|
| **maplibre-preload** | 对照我们的 `precacheViewports`。官方是 fly/ease 前预取；我们已是 jumpTo 链。不要叠两套，除非测出漏瓦。 |
| **PMTiles** (`addProtocol`) | 近。水系/自有矢量单文件托管，仍禁止把瓦片本身当 Pro 商品。 |
| **maplibre-contour** | 远。气候第二波。 |
| **maplibre-gl-mask-plugin** | **不要替换** 岛补丁。Globe 蒙版我们已有 GeoJSON hole。 |
| **maplibre-three-plugin** | 不换。已有 CustomLayer。 |
| turf | 该接。测地线、沿线点、长度 → `routeProgress`。**不要为 tuner 加应用级 npm**；成片页可跟 HyperFrames 已有依赖，或预计算进 GeoJSON。 |
| maplibre-gl-video-export | 明确不做。成片走 HyperFrames，不走浏览器录像插件。 |
| deck.gl / L7 / echarts | 明确不做。 |
| geocoder / draw / compare / geolocate / legend | tuner 以后再说；不是引擎缺口。 |
| maplibre-label-callout | 近。HUD 引线；现有 CSS 蓝图可先撑。 |
| quantized-mesh 3dtiles-terrain | 明确不做。合同是 Terrarium。 |

---

## 7. 官方性能指南 vs 本库水系

[large-data](https://maplibre.org/maplibre-gl-js/docs/guides/large-data/) 对 7.6 MB 水系几乎是逐条打中：

| 官方建议 | 本库现状 |
|----------|----------|
| 删无用 properties、坐标降到 ~6 位、简化几何、minify | pack 在本地；未作为发布门 |
| **URL 加载 GeoJSON，不要嵌进 JS** | 水系已改用矢量瓦片；`region-isolate-data.js` 仍是嵌进 JS 的 GeoJSON |
| 分块 2–3 份 | 已按 lakes / L3 / L2 / L1 / highlight 分 source，这点对齐 |
| 矢量瓦片 / Martin | **未做**。全国河网的正确终态 |
| cluster | 水系是线，不适用；城点以后远距可用 |
| 关 overlap 计算 | 我们没用 symbol，这条暂空 |
| source `maxzoom` 降到 ~12 | **未设**（GeoJSON 默认 18） |
| layer `minzoom` > 0 | 已设 3 |

isolate 已吸取过官方没写但我们踩过的坑：tiled `buildMaskGeoJSON` `setData` 会冻主线程。patched 路径禁止再走。

---

## 8. 和「要做」对齐后的真实差距（一句话）

MapLibre 已经提供行军、城状态、分层设色、多光源山影、高 pitch LOD、symbol 贴地高度的 **原语**。本库缺的不是再找一个渲染引擎，而是：

1. **生产仍锁在 patched 5.6**，6.x 原语（圆角挤出、symbol 高度、line-layer-opacity）进不了河西成片页。
2. **行军家族完全没接** 官方 `line` / `line-gradient` / `lineMetrics` / `symbol-placement: line`，也还没接 canvas `routeProgress`。
3. **5.5–5.6 里已有的** `hillshade-method`、`color-relief`、`style.state` 生产没用上。
4. 水系仍按「整包 GeoJSON」活，和官方 large-data 终态（URL + source maxzoom + 最终矢量瓦片）差一截。
5. 成片模板没用岛补丁，和调参台不是同一 MapLibre。
