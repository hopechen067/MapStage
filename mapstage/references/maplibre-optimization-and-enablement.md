# MapLibre 优化方案与后续开通指导

依据 [maplibre-official-gap.md](maplibre-official-gap.md)。优先级仍以 [roadmap.md](roadmap.md) 的阶段为准；录屏合同仍以 [runtime-perf.md](runtime-perf.md) 为准。

| 项 | 值 |
|----|----|
| 写于 | 2026-08-29 |
| 原则 | 先补齐 **5.6 上已能做且视频要** 的；6.x 只在岛补丁移植后进生产 |
| 不做 | 应用级 npm 进 `tuner/`；`flyTo` 当商品；OSM 楼当汉城；成片 `fetch('/license')` |

---

## 0. 怎么用这份指导

每一条开通都写成同一张卡片：

- **开什么** — 用户能看见的能力或 SKU
- **官方原语** — example / spec / API
- **接到哪** — 文件
- **录屏约束** — 违反哪条就停
- **完成证据** — 怎样算开通，而不是「代码里有个开关」

未列进波次的官方能力默认 **不开**。

---

## 1. 版本策略（所有开通的前提）

```text
生产录屏（河西、isolate 岛、terrainRise）
  └── patched MapLibre 5.6.0 UMD   tuner/vendor/maplibre-gl.js
        补丁脚本：tuner/scripts/patch-maplibre-terrain-clip.mjs

皮肤实验室
  └── 允许 6.6.0 ESM（已是 vector-layers.html）

成片模板 hexi-map-shot.html
  └── 今天：未打补丁的 5.6.0 CDN  ← 这是缺陷，不是策略
```

**规则**

1. 未把 `__ANTIQUE_TERRAIN_CLIP_PATCH` 移植到 6.x 之前，**禁止**把 `index.html` / `map-fx.js` 生产路径升到 6。
2. `color-relief`、`hillshade-method`、`style.state` 标在 Spec **5.6 / 5.5**。先在 vendor 5.6 上开，不要拿它们当升 6 的理由。
3. 只有这些才构成升 6 的正当理由：`fill-extrusion-rounded-corner-distance`（6.2）、`symbol-height-offset`（6.6）、`line-layer-opacity`（6.0）、官方 ESM worker 合同、v6 `zoomLevelsToOverscale` 默认。
4. 升 6 时按 [v5-to-v6-migration-guide](https://maplibre.org/maplibre-gl-js/docs/guides/v5-to-v6-migration-guide/)：`<script type="module">`、禁止默认 import、嵌套 GeoJSON 不要 `JSON.parse`、缺图用 `setMissingStyleImageResolver`。

**P0 版本债（先于新功能）**

| ID | 做 | 证据 |
|----|----|------|
| V1 | `hexi-map-shot.html` 与生产同一份 patched vendor（或明确文档：该模板不能拍岛） | 河西 isolate 镜头网格被裁、周围是虚空而不是未裁 DEM |
| V2 | ~~`home.html` 展台文案~~ 已作废：展台页已删除。官网示例不展示 isolate；若以后展示，要区分「羊皮纸蒙版」与「地形岛」 | 实现路径写在 `region-isolate.md` |
| V3 | `vector-layers.html` 继续 6.6，当作皮肤实验室，不并进 `AntiqueMapFx` record 默认 | vector 页不调用岛 clip |

---

## 2. 优化方案（已有堆栈，不新开顶类）

目标：同样的古卷中国地图，更稳、更省瓦片、更接近官方 large-data / 3D terrain 写法。**不**在这一节做行军。

### O1 · 水系 GeoJSON 按官方 large-data 收口

官方：[Optimising large GeoJSON](https://maplibre.org/maplibre-gl-js/docs/guides/large-data/)。

| 步骤 | 改哪 | 做法 |
|------|------|------|
| 1 | `tuner/assets/tuner-app.js` `addWaterLayers` | 每个 water source 设 `maxzoom: 12`（线）/ `14`（湖）。层上已有 `minzoom: 3`，保留 |
| 2 | 同源 options | 需要渐变高亮时再给 **highlight** source 开 `lineMetrics: true`；L1–L3 默认不要开（浪费） |
| 3 | 加载 | 中期：pack 改为 `data: './assets/water-l1.geojson'` URL，而不是 7.6 MB 塞进 JS。`async` 脚本只是权宜 |
| 4 | 终态 | tippecanoe / PMTiles，按河级分 `source-layer`。许可仍走 `DATA-PROVENANCE.md`，不进 MIT |

录屏：motion LOD 继续藏 `river-l3`；不要为了「更顺」去 `easeTo`。

证据：同一河西近景，Network 里 GeoJSON-vt 切片次数下降；`waitIdle` 不再被 L3 拖满 12s（对比改前 HAR 或 `verify.mjs` 时长）。

### O2 · 山影用上 5.5 已有的算法，而不是只调五色

官方：`add-a-hillshade-layer`、`hillshade-method` spec。

| 步骤 | 做法 |
|------|------|
| 1 | preset `maplibre.hillshade.method`：`standard`（默认，兼容旧 JSON）\| `igor`（少压底图，古卷更干净）\| `multidirectional` |
| 2 | 暴露 `hillshade-illumination-altitude`（默认 45） |
| 3 | 扩 `schemas/map-preset.schema.json` 与 [参数列表说明.md](参数列表说明.md) |
| 4 | **不要**把 exaggeration 抬过 1（tuner 已 clamp；超限 style 加载失败） |

共用 DEM vs 官方双 source：保持共用。质量差时用已有 `terrain.dualSource: true`。在 `tested-config.md` 加一句：官方 example 为画质双开；我们为请求数单开。

证据：同一 preset 导出 JSON 含 `method`；igor 与 standard 各一张静帧。

### O3 · 分层设色接到生产 5.6，而不是只放在 6.6 实验室

官方：`add-a-color-relief-layer`。Spec：GL JS 5.6.0。vendor 已有 shader。

| 步骤 | 做法 |
|------|------|
| 1 | 在 tuner 卫星之下、hillshade 之下（或按皮肤）加 `color-relief` 层，source = 现有 `terrain` DEM |
| 2 | paint 从 `AntiqueVectorPaint` 的 elevation stops 抽一套古卷色（赭/青绿），不要实验室那条彩虹 |
| 3 | `ui.showRelief` 默认关；卫星开时自动降 opacity，避免脏 |
| 4 | 不升 6、不换 DEM 编码 |

证据：patched 5.6 的 `index.html` 能开关分层设色；`hexi-map-shot` 可选同一层；vector-layers 彩虹仍只是实验室。

### O4 · 高 pitch LOD（河西隆起）

官方：`level-of-detail-control` → `map.setSourceTileLodParams(maxZoomLevelsOnScreen, tileCountRatio)`。

| 步骤 | 做法 |
|------|------|
| 1 | 仅 `pitch >= 50` 或 zoom≥8 时收紧（与 `budgetTerrainEx` 同触发） |
| 2 | tuner 加只读 HUD 或隐藏滑杆，默认不改官方手感 |
| 3 | record 路径先 A/B：默认 vs 更狠的 ratio。看 DEM 请求数和山脊破碎 |

证据：祁连 `VIEW_RELIEF` 镜头 Network 瓦片数对比表；肉眼山脊不断裂才收。

### O5 · tuner 性能 HUD（官方 metrics example）

官方：`display-performance-metrics`（`load` / 首次 `idle` / `render` FPS）。

只开 tuner。record 禁止订阅每帧 `render` 去写 DOM。

证据：调参台角上三数；`mode:'record'` 页面没有该 DOM。

### O6 · `prewarm` 与现有 precache 的分工

官方全局函数 `prewarm()`：提前建 worker / WebGL 资源。我们的 `precacheViewports` 是 **跳镜头暖瓦片**。

| | `prewarm` | `precacheViewports` |
|--|-----------|---------------------|
| 何时 | 第一个 `new Map()` 之前 | timeline.play 之前 |
| 暖什么 | 运行时 | 指定相机下的 DEM/栅格 |

开通：`hexi-map-shot` / 生产页在 `createMap` 前调一次 `maplibregl.prewarm()`。不要引入 `maplibre-preload` 插件叠第三套。

证据：冷启动到首次 `idle` 的 ms（O5 HUD 或 Playwright）。

### O7 · 城挤出受光（`style.light`）

官方 globe+atmosphere example 设了 `light.anchor: 'map'`。挤出颜色吃这组光，不是 CSS 滤镜。

开通：preset `maplibre.light: { anchor, position, color, intensity }`。夜城变体先改 light + extrusion 色，不上 Three。

证据：同一 footprint，白天/夜城两帧，墙面受光方向变。

### O8 · 文档自洽（零代码，但会挡开通）

当前仓库里和代码不一致、优化时容易改错的：

| 文档仍写 | 代码实际 |
|----------|----------|
| 旧 skill 拷贝：isolate → `setTerrain(null)` | 保留地形 + 岛 clip |
| `water-overlay.md`：水系走矢量瓦片，已无 pack | — |
| `tuner-workflow.md`：卫星默认关 | `map-tiles.config.js` 可为 `enabled: true` |

改文档或改默认，二选一钉死。以 [tested-config.md](tested-config.md) 为生产清单。

### O9 · GeoJSON isolate 蒙版（Globe / 未打补丁）

不要「优化」成再 `setData` 精细 trapezoid。官方没有这个坑的 example。继续：map+patch → clip；globe → 便宜 hole fill。

---

## 3. 后续开通指导（按波次，按顶类）

波次对齐 [roadmap.md](roadmap.md) 的阶段，每条都落到 MapLibre 原语。

### 波次 A — 视频刚需，且 5.6 就能做（先做）

#### A1 · 路线家族 `route.*`（缺口最大）

| | |
|--|--|
| 开什么 | 至少 3 线型：墨线实、虚线流光、官道双线 |
| 官方 | `Add a GeoJSON line`；`Create a gradient line`；`line-gap-width`（双线）；`line-dasharray` |
| 接到哪 | 新 `runtime/map-route.js`（或 `tuner/assets/map-route.js`）+ preset `maplibre.routes[]`；schema 先扩再画 UI |
| 录屏 | **禁止** example 里每帧 `setData` 长线。进度用 **canvas `routeProgress`** 或预切好的 LineString 关键帧 + `jumpTo`。GSAP 只改 progress 数，地图用 `triggerRepaint` |
| 互斥 | `line-gradient` **不能**和 `line-dasharray` 同层。流光虚线 = 底层实线/渐变 + 上层 dash，或全部 canvas |
| `lineMetrics` | 只给需要 gradient 的那一个 GeoJSON source |
| 完成证据 | 河西走廊一条 `routeId` 的 GeoJSON；tuner 三芯片切线型；`hexi-map-shot` 能 `jumpTo` 三段且线在画布上（截帧） |

不要：CSS `@keyframes` dash；`flyTo` 沿线；deck.gl arc。

#### A2 · 箭头家族 `arrow.*`

| | |
|--|--|
| 开什么 | 三角 / 燕尾 / 矛头，沿 `routeId`，可随 `routeProgress` |
| 官方 | `symbol-placement: line` + `addImage`；或 canvas 画箭头（更控录屏） |
| 5.6 现实 | 无 glyphs/sprite 时 **先 canvas / Marker**。symbol 线箭头放到波次 C（6.6 + sprite） |
| 录屏 | 箭头位置 = 沿线插值点（turf 可预计算进 JSON，避免 tuner npm） |
| 完成证据 | 三箭头变体切同一条路；静帧能看出箭头类型，不是换了个 emoji |

#### A3 · 部队 `unit` + 尘土

| | |
|--|--|
| 开什么 | map-story-assets 已有单位，沿 `routeProgress` |
| 官方 | 地理投影后画；`Animate a point along a route` 只借鉴公式，不借鉴 rAF `setData` |
| 接到哪 | 成片 HTML `project` → `Unit.draw`；tuner 可只放一个进度滑杆 |
| 录屏 | 禁止 3D 骨骼；禁止 OSM cluster 冒充军队 |
| 完成证据 | 同一 progress=0.3 / 0.7 两帧，部队在线路不同位置；seek 可逆 |

#### A4 · 拆出级联（包装，不是新渲染器）

| | |
|--|--|
| 开什么 | 中国 → 甘肃 → 张掖 一条过门 |
| 官方 | `Jump to a series of locations` + 已有 `reliefCameraForFeature` |
| 接到哪 | `scenes.json` 或新 scene pack；runtime 已有 isolate + island |
| 录屏 | 每段 `jumpTo` + `waitIdle`；中间不要 `flyTo`。预缓存三国相机 |
| 完成证据 | 三镜头模板页；isolate 多边形变了且地形仍在（patched） |

#### A5 · 城 zoom LOD 包装

| | |
|--|--|
| 开什么 | 远：色块+名；中：extrusion；近：维持 extrusion（Three 仍兜底） |
| 官方 | 层 `minzoom` / `maxzoom`；`setFilter` / `style.state` |
| 接到哪 | `han-city-3d.js` 三层或 layout zoom；**不要**每帧拆 layer |
| 录屏 | 自定义 Three 层继续：只在相机动时 `setContinuousRepaint` |
| 完成证据 | 同一批城，z=5 只有点名、z=8 挤出、z=12 仍挤出且不掉帧说明 |

#### A6 · 城状态 2 个：夜城、营造中

| | |
|--|--|
| 开什么 | 同 footprint 换 paint / light，不上新几何 |
| 官方 | `feature-state` 或 `style.state`（5.6）；`fill-extrusion-color` 已支持 feature-state |
| 营造中 | `fill-pattern` 或降低 height + 透明度 |
| 完成证据 | 芯片切状态不重载 GeoJSON；导出 JSON 有 `city.state` |

#### A7 · 皮肤再 3 套

只改 paint + CSS，走现有 `AntiqueVectorPaint.SKINS`。**深链 `family=skin` 必须走 SKINS，禁止 THEMES 近似**（site/00-shared.md）。

不必等 MapLibre 新图层。

---

### 波次 B — 气候 / 镜头语法，仍尽量 5.6

| ID | 开什么 | 官方原语 | 约束 | 证据 |
|----|--------|----------|------|------|
| B1 | 干流流动感 | 上层 dash **或** canvas，不要 CSS | 与 A1 互斥表相同 | 高亮河有方向感，L3 仍静 |
| B2 | 控制区 / 包围弧 | `fill` + `line`；pattern 斜纹 | 主键仍是 `routeId` / 区域 id | 一张圈地静帧 |
| B3 | 雾 / 沙尘 | **canvas overlay**，不是把 `sky.fog-color` 当成沙尘 | sky 继续管地平线 | 河西一镜有尘、isolate 外虚空不被尘填满 |
| B4 | globe→mercator 过门 | `projection.type` interpolate（spec） | **录屏默认 mercator**；过门只给展台或预烘焙关键帧 | 展台能看；shot 页无 globe |
| B5 | padding 避 HUD | `fitBounds` padding / `jumpTo` 前设 padding | | 签条不挡祁连主脊 |

---

### 波次 C — 必须 6.x + 岛补丁移植之后

移植清单（开通 C 的闸门，不是功能本身）：

1. 对 6.6 `maplibre-gl-dev` / ESM 重跑 `patch-maplibre-terrain-clip.mjs`（脚本必改：UMD 假设失效）。
2. 回归：isolate 中国/甘肃网格裁切、墙、虚空 sky、禁止精细 mask `setData`。
3. `hexi-map-shot` 改吃同一 vendor。
4. 迁移指南：module script、worker Blob、nested properties。

闸门过了再开：

| ID | 开什么 | Spec | 备注 |
|----|--------|------|------|
| C1 | 汉城圆角 | `fill-extrusion-rounded-corner-distance` 6.2 | 小城关隘 2–4m；不要 OSM 楼 |
| C2 | 城标浮空 | `symbol-height-offset` 6.6 | 同时决定是否弃 HTML 城名 |
| C3 | 多路重叠不脏 | `line-layer-opacity` 6.0 | 三路分兵 |
| C4 | 本地/Web 字体 symbol | glyphs 可省略（5.11）+ `localIdeographFontFamily` | 中文；`font-faces` GL JS 还没有 |
| C5 | 沿路 symbol 箭头 | `symbol-placement: line` | 可替换 A2 的 canvas 箭头 |

---

### 波次 D — 有数据/许可才开（引擎已准备原语）

| ID | 开什么 | 官方 | 闸门 |
|----|--------|------|------|
| D1 | 水系 PMTiles / MVT | PMTiles example、`addProtocol`、vector source | 许可写进 DATA-PROVENANCE；瓦片不当商品 |
| D2 | 等高线 | `maplibre-contour` 或 raster-dem contour example | 气候第二波；默认关 |
| D3 | 自有高分辨率 DEM | raster-dem `encoding: custom` 或换 URL | 仍 **禁止** 默默改掉 terrarium 合同 |
| D4 | 手绘底 `image` source | Animate a series of images | **另一 skill**；本库 isolate 文档写明未接 |

---

## 4. 明确不开（官方有、我们也不接）

来自 examples / plugins，避免以后「文档里有就做」。

- `flyTo` / `easeTo` 当 SKU 或成片相机
- OSM `fill-extrusion` 真楼当汉城
- quantized-mesh / 3D Tiles 地形替换 Terrarium
- Video source、COG（无自有数据时）、photosphere、第一人称
- Geolocate、cooperative gestures、hash 成片、deck.gl、L7
- maplibre-gl-video-export 代替 HyperFrames
- maplibre-gl-mask-plugin 代替岛补丁
- heatmap 冒充部队
- 为目录/tuner 引入第一个应用级 npm
- 成片时 `pixelRatio` 跟 device、或订阅 `render` 写 HUD

---

## 5. 接到编辑器 / schema 的顺序

tuner 不是成片宿主。开通功能时 UI 按层打开：

```text
现在已有：皮肤、卫星/山影/CSS、水系开关、城开关、省/市拆出、隆起、导出 JSON
A 完成后：路线 GeoJSON + 线型 + 箭头芯片 + routeProgress 滑杆
B 完成后：控制区开关、雾/尘开关（canvas）
C 完成后：圆角、symbol 高度（可藏在高级）
```

preset 扩字段顺序：`schema` → `AntiqueMapFx` / 新 runtime 模块 → tuner 滑杆 → `hexi-map-shot` 只读消费。禁止只在 HTML 里长出没有 schema 的键。

导出继续一份 JSON。新键：`maplibre.hillshade.method`、`maplibre.relief`、`maplibre.light`、`maplibre.routes`、`ui.cityLod`、`ui.cityState`。

---

## 6. 每条开通的验收命令

现有门：

```bash
node mapstage/tuner/assets/map-fx.test.mjs
cd mapstage/tuner && node verify.mjs
```

新能力至少补一种证据（按改动面选）：

| 面 | 证据 |
|----|------|
| 水系 maxzoom / 加载 | verify 仍绿；可选 HAR |
| 山影 method / color-relief | tuner 截同一相机两档 |
| 路线 / 箭头 / 部队 | 成片 HTML 两 progress 截帧 + 时间轴 seek 不裂 |
| 岛 + 级联 | patched 页三镜头；未打补丁页不假装能裁网格 |
| 升 6 | 岛回归 + record `jumpTo` 仍工作 |

没有截帧或测试的「已开通」不算开通。

---

## 7. 建议开工顺序（把波次排成一周单位）

不要平行铺 6 个顶类。依赖是：

```text
V1 成片页吃 patched vendor
  → O2 hillshade-method + O7 light（小、全是 paint）
  → O3 color-relief 上 5.6 生产（皮肤立刻变厚）
  → O1 水系 source maxzoom（防 A 波路线再叠一层大 GeoJSON）
  → A1 路线 + A2 箭头（canvas）+ A3 部队     ← 视频线从这里开始能讲战争
  → A4 级联包装 + A5 LOD + A6 夜城
  → O4 LOD 瓦片试验 + O5 HUD + O6 prewarm
  → A7 三套新皮肤（管道已热）
  → B 气候/过门
  → 岛补丁移植 6.x 闸门
  → C 圆角 / symbol 高度
  → D 瓦片化水系（有许可再做）
```

O8 文档自洽随时可做，不挡代码。

---

## 8. 和现有合同的交叉检查

开通时若与下列文件冲突，**改方案或先改合同**，不要静默改行为：

- `SKILL.md` — Terrarium、jumpTo、record pixelRatio、isolate 保地形
- `tuner/assets/map-fx.js` — 禁止 paint 循环 `setTerrain`；rise 不 `waitIdle`
- `references/tested-config.md` — 层序：bg → 卫星 →（relief）→ hillshade → isolate → 水 → 城 → **路线/箭头应在水上、城下或按叙事再钉一行**
- `references/region-isolate.md` — 禁止精细 mask `setData`
- `DATA-PROVENANCE.md` — 水、自定义路线数据许可
- `AGENTS.md` — tuner 无应用级 npm

层序建议（A 波之后写入 tested-config）：

1. background  
2. 可选 color-relief  
3. 可选 satellite  
4. hillshade  
5. isolate 岛 / globe 蒙版  
6. lakes → rivers L3–L1 → highlight  
7. **routes（底线）→ routes dash → 控制区 fill**  
8. city extrusion  
9. **canvas：箭头、部队、尘土、雾**（DOM 在 canvas 上，不进 style.layers）  
10. HTML 名标（motion LOD 可藏）
