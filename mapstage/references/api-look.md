# 运行时 API · 底图

底图层两个全局：`AntiqueVectorPaint`（`tuner/assets/vector-paint.js`，古卷矢量底图的皮肤与图层）和 `AntiqueMapFx`（`tuner/assets/map-fx.js`，建图、地形、等 idle、预缓存）。做视频或游戏一般用不到它们，`MapStage.mount` / `MapStageBoard.create` 已经包好；需要细调底图时再直接用。

## AntiqueVectorPaint

### AntiqueVectorPaint.SKINS {#antiquevectorpaint-skins}

五套皮肤，每套 `{ id, label, blurb, paint, css }`：`paint` 是矢量图层配色，`css` 是画布调色（sepia、饱和度、暖色叠层）。

| id | 名称 |
|---|---|
| `parchment` | 宣纸古卷（默认） |
| `aged` | 陈旧羊皮 |
| `ink` | 墨色山水 |
| `silk` | 绢本重彩 |
| `night` | 暗夜星图 |

```js
AntiqueVectorPaint.SKINS.map((s) => s.id);   // ['parchment', 'aged', 'ink', 'silk', 'night']
```

在 story 里用 `look.skin` 选皮肤；不用 story 时交给 [MapStage.buildStyle](api-story.md#mapstage-buildstyle) 的 `skin`。

### AntiqueVectorPaint.applyVectorPaint(map, paint, keys) {#antiquevectorpaint-applyvectorpaint}

只改矢量图层的颜色，不重建 style、不重新加载瓦片。`keys` 给颜色字段名数组时只改这几项。返回规范化后的完整配色。画布调色（`css`）不在这里改。

```js
const ink = AntiqueVectorPaint.SKINS.find((s) => s.id === 'ink');
AntiqueVectorPaint.applyVectorPaint(map, ink.paint);
```

### AntiqueVectorPaint.setHillshade(map, on) {#antiquevectorpaint-sethillshade}

山影开关。

### AntiqueVectorPaint.setRoads(map, on) {#antiquevectorpaint-setroads}

道路开关（OpenMapTiles `transportation` 全部图层）。历史题材一般关掉现代道路。

### AntiqueVectorPaint.setLandcover(map, on) {#antiquevectorpaint-setlandcover}

植被、农田、沙地等地表图层开关。

### AntiqueVectorPaint.setBuildingExtrusion(map, on) {#antiquevectorpaint-setbuildingextrusion}

建筑拉伸（近景用），打开时隐藏平面建筑。

### AntiqueVectorPaint.buildStyle(opts) {#antiquevectorpaint-buildstyle}

底层的完整 style 生成器：`{ paint, tileConfig, contourTiles }`。**含境界线图层**，视频和公开页面请用 [MapStage.buildStyle](api-story.md#mapstage-buildstyle)，它会删掉境界线、去雾。

### AntiqueVectorPaint.overlayParts(opts) {#antiquevectorpaint-overlayparts}

只取水系 / 道路图层（`opts.groups: ['water', 'roads']`），叠到卫星图等其它底图上。返回 `sourceId` / `source` / `layers` 等字段，自己 `addSource` + `addLayer`。

### 常量 {#antiquevectorpaint-constants}

| 常量 | 说明 |
|---|---|
| `DEM_PRESETS` | `mapterhorn`（默认）/ `terrarium` 两套 DEM |
| `VIEW_RELIEF` | 祁连山前，看得出地形网格的机位 |
| `GLYPHS_URL` | 字体地址 |
| `TERRAIN_EXAGGERATION` / `TERRAIN_REAL_EXAGGERATION` | 默认夸张 / 真实海拔 |

## AntiqueMapFx

### AntiqueMapFx.setTerrainEx(map, sourceId, ex, view) {#antiquemapfx-setterrainex}

设置地形夸张。会量化（避免每帧微小变化触发重算），值没变就跳过；默认按 zoom / pitch 自动限额（zoom ≥ 8 或 pitch ≥ 50 时不超过 0.8，zoom ≥ 6 时不超过 1.2），`view.budget: false` 关闭限额。`sourceId` 用 `'terrain'`（MapStage 底图的地形源）。

```js
AntiqueMapFx.setTerrainEx(map, 'terrain', 1.6, { budget: false });
```

### AntiqueMapFx.waitIdle(map, opts) {#antiquemapfx-waitidle}

等地图 idle（瓦片加载完）。`opts.timeoutMs` 默认 12000，超时 resolve `{ ok: false }` 并告警，不会永远挂住；`opts.force` 即使当前已就绪也再等一轮。

### AntiqueMapFx.precacheViewports(map, cameras, opts) {#antiquemapfx-precacheviewports}

逐个 `jumpTo` + `waitIdle`，把要录的机位提前走一遍。`opts.restore`（默认 `true`）结束后回到原机位。返回 `Promise<{ count, restored }>`。`stage.precache()` 就是用它。

### AntiqueMapFx.jumpTo(map, camera) {#antiquemapfx-jumpto}

`{ center, zoom, pitch, bearing }` → `map.jumpTo`，缺的字段不动。`cameraToOpts(camera)` 只做转换。

### AntiqueMapFx.readView(map) {#antiquemapfx-readview}

读当前机位 `{ center, zoom, pitch, bearing }`，可以直接贴进 story 的 `shots`。

```js
copy(JSON.stringify(AntiqueMapFx.readView(stage.map)));
```

### AntiqueMapFx.createMap(maplibregl, opts) {#antiquemapfx-createmap}

调参台用的建图函数：`{ container, style, camera, mode, terrain }`。`mode: 'record'` 时 `pixelRatio: 1`、关淡入。一般用 `MapStage.mount` 就够了。

### 只给交互预览用 {#antiquemapfx-preview-only}

`easeToCamera`、`setMotionLod`（运动时降级）、`terrainRise`（地形升起动画）是调参台交互用的，**录制路径禁止**：它们依赖真实时间，逐帧不可复现。录制只用 `seek(t)` / `jumpTo`。
