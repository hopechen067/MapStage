# 运行时 API · Story

`window.MapStage`，文件 `tuner/assets/mapstage-story.js`。把一份 [story.json](story-spec.md) 挂成一段可逐帧复现的地图画面，外加一组纯函数（Node 下 `require` 也能用，可以写 `node:assert` 单测）。

```html
<script src="https://unpkg.com/maplibre-gl@5.6.0/dist/maplibre-gl.js"></script>
<script src="studio/assets/vector-paint.js"></script>
<script src="studio/assets/map-fx.js"></script>
<script src="studio/assets/mapstage-story.js"></script>
<!-- 用底图样式（look.basemap）时才需要；可省，mount 会从同目录自动加载 -->
<script src="studio/assets/tuner-vector.js"></script>
```

没有 npm 包、不用构建。示例里的完整代码都能直接复制成一个 html 文件运行，见 [示例库](../site/examples/index.html)。

## 挂载

### MapStage.mount(el, opts) {#mapstage-mount}

校验 story、建地图、挂路线 / 地名 / 字卡，返回一个 `stage`。校验不过直接 reject，不带病出片。

| 参数 | 类型 | 说明 |
|---|---|---|
| `el` | `HTMLElement` \| `string` | 容器或其 id。要有确定的宽高；字卡按 `宽 / 1920` 缩放 |
| `opts.story` | `object` | 必填，见 [Story 规范](story-spec.md) |
| `opts.preset` | `object` | 调参台导出的 preset：皮肤（`ui.skinId`）、调色（`css`）、地形夸张、默认机位（`camera`）。可省 |
| `opts.interactive` | `boolean` | 默认 `false`（录制）。交互页传 `true` |
| `opts.preserve` | `boolean` | `preserveDrawingBuffer`，要 `toDataURL` 截图时传 `true` |
| `opts.expose` | `boolean` | 默认 `true`：挂 `window.__mapstageSeek` / `__mapstageDuration` 给宿主 |
| `opts.verifyCompliance` | `boolean` | 默认 `true`：`compliance.full` 时段逐秒自检，不过就 reject（`StoryComplianceError`） |
| `opts.timeoutMs` | `number` | `seek` 等 idle 的超时，默认 12000 |
| `opts.assetBase` | `string` | 运行时附带数据（极地冰、夜光图、`tuner-vector.js`）的基准地址，缺省取 tuner 根目录（脚本的上一级） |
| `opts.nightLights` | `object` \| `false` | 夜景的夜光数据源，写法同 `map-tiles.config.js` 的 `nightLights`；优先于 `story.look.nightLights` 与页面上的 `MAP_TILE_CONFIG.nightLights`。`false` = 只留矢量灯光 |

**返回** `Promise<stage>`。reject 时 `error.errors` 是可读的错误清单。

```js
const stage = await MapStage.mount('stage', { story, preset });
await stage.precache();
await stage.seek(3.5);
```

底图样式：`story.look.basemap` → preset 的 `ui.basemapId` / `vector.*`，规则见 [Story 规范 · look](story-spec.md#look)，解析结果在 `stage.look`。用到底图样式时 `mount` 自动加载 `tuner-vector.js`；夜景的夜光图在建图前整张载完，首帧不闪。

皮肤取值顺序：没有底图样式时 `preset.ui.skinId` → `story.look.skin` → `parchment`；有底图样式时见 [look](story-spec.md#look)。地形：`story.look.terrain`（`false` 关闭）→ preset 里的夸张值 → 1。

## stage 实例

### stage.render(t) {#stage-render}

同步画出时刻 `t`（秒）的画面：机位、十段线、路线、地名三态、字卡。不等瓦片，适合拖动预览和按时钟播放。返回夹到 `0..duration` 后的 `t`。

### stage.seek(t) {#stage-seek}

`render(t)` 之后等地图 idle、等字卡图片和字体落地才 resolve。**同一个 t 永远是同一帧**，宿主逐帧截图用它。和 `window.__mapstageSeek(t)` 是同一个函数。

```js
for (let f = 0; f < stage.duration * 30; f++) {
  await stage.seek(f / 30);
  // 截图
}
```

### stage.precache(opts) {#stage-precache}

按 `opts.step`（默认 0.5 秒）采样所有机位走一遍、等瓦片落地，最后回到 `seek(0)`。返回 `Promise<{ count }>`。逐像素一致的前提是先 precache。

### stage.check(t) {#stage-check}

同步：把画面推到 `t`，返回 `{ t, full, ok, counts, issues }`。`issues` 是合规项（见 [complianceCheck](#mapstage-compliancecheck)）加同屏上限（`limit-primary` 等），每项 `{ id, label, ok, note }`。

### stage.destroy() {#stage-destroy}

移除地图和叠层，容器恢复原样。换皮肤、换 story 时先 destroy 再 mount。

### stage 的其它字段 {#stage-fields}

| 字段 | 说明 |
|---|---|
| `duration` / `fps` | 来自 story |
| `map` | MapLibre 地图本身，需要更多控制时直接用 |
| `story` | 校验过的 story |
| `look` | 实际生效的底图外观，见 [resolveLook](#mapstage-resolvelook) |
| `shots` | 解析后的镜头（`fit` 已换算成 `center` / `zoom`） |
| `labels` | `{ 地点 id: 元素 }`，交互页可以直接改 `data-state` |

## 校验

### MapStage.validateStory(story) {#mapstage-validatestory}

通过返回 `{ ok: true, errors: [] }`；不过就抛 `StoryValidationError`，`error.errors` 是全部问题。`mount` 会先调它。检查项：引用缺失、`via` / `coords` 二选一、`draw` / `hold` 范围、同角色 `hold` 越段、C 级未标 `approx`、镜头不升序或间隔小于 `move`、字卡字段、同屏上限。

```js
try { MapStage.validateStory(story); }
catch (e) { console.log(e.errors); }
```

### MapStage.lintStory(story) {#mapstage-lintstory}

同上，只返回错误字符串数组，不抛。编辑器里实时提示用。

### MapStage.LIMITS {#mapstage-limits}

同屏上限：`{ primary: 1, reaction: 2, active: 2, names: 2 }`。

### MapStage.countsAt(story, t) {#mapstage-countsat}

`t` 时刻的同屏计数 `{ primary, reaction, active, names }`。

## 合规

### MapStage.buildStyle(opts) {#mapstage-buildstyle}

合规底图 style：古卷矢量底图 + 远景地表 + 极地冰 + 地形 + 山影，**删掉境界线图层、不加雾**。不想用 story 时，直接交给 `new maplibregl.Map({ style })`。

| 参数 | 说明 |
|---|---|
| `skin` | 皮肤 id，见 [SKINS](api-look.md#antiquevectorpaint-skins)，默认 `parchment` |
| `basemap` | 底图样式 id（见 [底图样式](look.md#basemap)），皮肤随之换成配套的，`skin` 可覆盖。要先加载 `tuner-vector.js`。夜光图只支持带 `bounds` 的墨卡托图或瓦片（同步可得）且不预载——逐帧截图请用 `mount` |
| `nightLights` | 同 mount |
| `look` / `night` | 进阶：直接给 `resolveLook` 的结果和夜光数据源，代替 `basemap` |
| `terrain` | 地形夸张，默认 1；`false` 不要地形 |
| `assetBase` | 同 mount |

```js
const map = new maplibregl.Map({
  container: 'map',
  style: MapStage.buildStyle({ skin: 'ink', terrain: 1.2 }),
  center: [104, 35.5], zoom: 4,
});
```

注意：画布调色（sepia / 暖色叠层）是 `mount` 按皮肤加的，`buildStyle` 只给 style。

### MapStage.resolveLook(preset, story) {#mapstage-resolvelook}

纯函数：把 preset 与 story 的外观字段解析成运行时实际用的底图外观。没有底图样式时返回 `{ basemap: null, skinId }`（外观与旧版一致）；否则返回：

| 字段 | 说明 |
|---|---|
| `basemap` | 底图样式 id；preset 里只有改过的 `vector.*` 时为 `null` |
| `skinId` / `paint` | 皮肤与自定义配色（`paint` 为空 = 用皮肤配色） |
| `relief` / `reliefOpacity` / `elevStops` | 海拔设色开关、不透明度、色阶 `[{ h, color }]`（`null` = 默认色阶） |
| `hillshade` | 山影 `{ exaggeration, shadowColor, highlightColor, accentColor }` |
| `landcover` / `water` | 地表、水系画不画 |
| `lights` / `nightRaster` | 矢量灯光、夜光图 |
| `sea` / `dark` | 十段线底下实际的海面颜色（水系开着取海洋水面色，否则取色阶海面段的平均亮度），以及它是否暗到要把十段线换成浅色（与深色 `TEN_DASH_INK` 对比度 < 1.65） |

```js
MapStage.resolveLook({}, { look: { basemap: 'nightlights' } }).nightRaster;   // true
```

配套的 `MapStage.applyLookToStyle(style, look, { night })` 把结果写进 style，`MapStage.nightSpec(nightLights)` 给出同步可得的夜光数据源；`buildStyle({ basemap })` 就是这三步。

### MapStage.complianceCheck(map, opts) {#mapstage-compliancecheck}

返回检查项数组 `{ id, label, ok, note }`：不画省界国界、无雾、无暗角；`opts.full` 为真时再查台湾 / 海南 / 南海诸岛是否在画内、十段线是否画出（`opts.tenDash: false` 跳过）。

### MapStage.COMPLIANCE_POINTS {#mapstage-compliance_points}

全图检查用的锚点：`taiwan` / `hainan` / `nanhai`，每个 `{ id, label, pts }`。

### MapStage.addTenDash(map, opts) {#mapstage-addtendash}

加十段线图层（默认隐藏），返回图层 id。`opts.visible`、`opts.color`、`opts.beforeId`。`setTenDashVisible(map, on)` 切显隐。`mount` 会自动加，只在 `compliance.full` 时段显示。数据 `MapStage.TEN_DASH`。

## 路线与地名

### MapStage.sliceRoute(coords, p) {#mapstage-sliceroute}

按**里程**切路线：`p` 是 0–1 的进度。返回 `{ line, head, bearing, km, totalKm }`：已走部分、头部点、头部朝向（度）、已走里程、总里程（km）。

```js
const s = MapStage.sliceRoute(coords, MapStage.smoothstep(p));
map.getSource('walked').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: s.line } });
```

### MapStage.shapeRoute(coords, curve) {#mapstage-shaperoute}

`curve: 'auto'`：两点或近共线（最大垂距 ≤ 0.4°）时换成弧线，否则原样；`'none'` 原样返回。

### MapStage.arc(a, b, opts) {#mapstage-arc}

两点之间的二次贝塞尔弧，`opts.bend`（弦长比例，默认 0.12）、`opts.steps`（默认 32）。

### MapStage.routeWindow(route, duration) {#mapstage-routewindow}

路线上图的时间窗 `[from, to)`：`draw[0]` 到 `hold`（缺省 `draw[1]`）；`residual` 留到片尾；`callout` 返回 `null`。

### MapStage.labelStates(story, t) {#mapstage-labelstates}

每个地点在 `t` 时的状态 `{ id: 'active' | 'normal' | 'dim' }`：当句讲到 / 讲过 / 还没讲到。

### MapStage.SIDE_COLORS {#mapstage-side_colors}

`{ red: '#c0272d', enemy: '#5f7182', ally: '#7a1430', neutral: '#6a5a48' }`。颜色表示「谁的行动」，不按喜好换。

## 镜头

### MapStage.cameraAt(shots, t) {#mapstage-cameraat}

一句一动的镜头插值：镜头在 `t - move` 到 `t` 之间 smoothstep 过去，到位后按 `push` / `tilt` 缓推。`shots` 要先解析成 `center` / `zoom`（用 `stage.shots`）。返回 `{ center, zoom, pitch, bearing }`。

### MapStage.safePadding(width, height, safe) {#mapstage-safepadding}

安全区比例 → MapLibre padding（像素）。`safe` 缺省 [SAFE_AREA](#mapstage-safe_area)。

### MapStage.fitCamera(points, opts) {#mapstage-fitcamera}

求让 `points`（`[[lng, lat], …]`）全部落进安全区的机位，计入俯仰和朝向；`shots[].fit` 与 `board.fit()` 都走它。`opts`：`width` / `height`（画布像素）、`padding`（`{ left, top, right, bottom }` 像素，常用 [safePadding](#mapstage-safepadding)）、`pitch`、`bearing`、`maxZoom`（缺省 9）。返回 `{ center, zoom, pitch, bearing }`，可直接 `map.jumpTo`。纯数学、不读地形，同输入同机位；不要改用 `map.cameraForBounds`，它不计俯仰。

`MapStage.projectGround(lngLat, cam, w, h)` / `MapStage.unprojectGround(pt, cam, w, h)` 是它用的海平面投影与逆投影；`MapStage.normPadding(p)` 把数字或部分字段的 padding 统一成对象。

### MapStage.SAFE_AREA {#mapstage-safe_area}

16:9 安全区 `[左, 上, 右, 下]` 比例：`[0.06, 0.22, 0.94, 0.78]`。上下留给字幕和字卡。

### MapStage.bbox(points) {#mapstage-bbox}

`[[lng, lat], …]` → `[minLng, minLat, maxLng, maxLat]`。

## 工具函数

### MapStage.haversineKm(a, b) {#mapstage-haversinekm}

两点大圆距离（km）。`bearingDeg(a, b)` 给 a → b 的方位角（度）。

### MapStage.smoothstep(t) {#mapstage-smoothstep}

0–1 缓入缓出，`t` 超出范围会被夹住。路线推进、镜头插值都用它。
