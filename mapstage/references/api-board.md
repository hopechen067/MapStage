# 运行时 API · Board

`window.MapStageBoard`，文件 `tuner/assets/mapstage-board.js`。给游戏和互动页用的地图接口：古卷底图、地形、地名、合规照旧，加上城池圈、连线、点选、行军动画。**规则由你自己写**，状态变了就整体调一次 `setCities` / `setLinks`。用法讲解见 [游戏地图 Play](play.md)。

```html
<script src="https://unpkg.com/maplibre-gl@5.6.0/dist/maplibre-gl.js"></script>
<script src="studio/assets/vector-paint.js"></script>
<script src="studio/assets/map-fx.js"></script>
<script src="studio/assets/mapstage-story.js"></script>
<script src="studio/assets/mapstage-board.js"></script>
```

## 创建

### MapStageBoard.create(el, opts) {#mapstageboard-create}

校验地点和连线后建地图，返回 `Promise<board>`。底层是一份只有地点的 story（走 [MapStage.mount](api-story.md#mapstage-mount)，`interactive: true`）。

| 参数 | 类型 | 说明 |
|---|---|---|
| `el` | `HTMLElement` \| `string` | 容器，要有确定宽高；尺寸变化会自动 `resize` |
| `opts.sites` | `array` | 必填，字段同 [story.sites](story-spec.md#sites)：`id`、`name`、`lngLat`、`tier`、`confidence`、`approx`、`label.side` |
| `opts.links` | `array` | 相邻关系 `[[a, b], …]`，可省。引用不存在的地点、两端相同、重复都会报错 |
| `opts.preset` | `object` | 同 mount |
| `opts.pitch` | `number` | 默认 20 |
| `opts.rotate` | `boolean` | 默认 `false`，禁用旋转 |
| `opts.pickRadius` | `number` | 点选容差（像素），默认 28 |
| `opts.padding` | `object` | `fit` 的边距，默认 `{ top: 60, bottom: 40, left: 80, right: 60 }` |
| `opts.radius` | `object` | 城池圈半径 = `min + sqrt(value) * scale`，默认 `{ min: 7, scale: 2.2 }` |
| `opts.fit` | `boolean` \| `string[]` | 默认 `true` 框住所有地点；给 id 数组只框这些；`false` 不动 |
| `opts.preserve` | `boolean` | 要截图时传 `true` |

```js
const board = await MapStageBoard.create('stage', { sites, links });
```

校验不过时 reject，`error.errors` 是清单。纯函数版 `MapStageBoard.lintBoard({ sites, links })` 只返回数组。

## 画状态

### board.setCities(patch) {#board-setcities}

局部更新城池样式，只传变了的城，字段合并；传 `null` 清掉一座城。返回 `board`，可以链式调用。

| 字段 | 说明 |
|---|---|
| `color` | 城池圈颜色。**没给 color 的城只显示地名，不画圈** |
| `value` | 圈的大小（兵力、人口…），半径按平方根放大 |
| `badge` | 地名下方的小徽标文字（数字或短字） |
| `ring` | 描边：`'select'` 选中 · `'target'` 目标 · `null` 普通。见 [RINGS](#mapstageboard-rings) |
| `label` | 地名状态：`'normal'` / `'active'` / `'dim'` |

```js
board.setCities({
  chengdu: { color: '#b8432f', value: 28, badge: 28, ring: 'select', label: 'active' },
  changan: null,
});
```

### board.getCity(id) {#board-getcity}

当前合并后的样式对象，没设置过返回 `null`。

### board.setLinks(style) {#board-setlinks}

连线样式函数 `style(a, b) → { color, width, hidden }`，每条连线调一次；缺省中性色细虚线。状态变了再调一次即可。

```js
board.setLinks((a, b) => (a === sel || b === sel ? { color: '#b8432f', width: 3 } : { width: 1 }));
```

### board.neighbors(id) {#board-neighbors}

与 `id` 相连的地点 id 数组（按 `links`）。

## 交互

### board.on(type, fn) {#board-on}

`type` 为 `'pick'`（点击）或 `'hover'`（悬停，地点变化时才触发）。回调拿到 `{ id, site, lngLat, point, originalEvent }`，**`id` 为 `null` 表示点在空地**。返回取消监听的函数。

```js
const off = board.on('pick', ({ id, site }) => {
  if (!id) return;          // 点在空地
  // 你的规则
});
```

## 动画与镜头

### board.march(from, to, opts) {#board-march}

从 `from` 到 `to` 画一条推进线，结束后收起，返回 `Promise`。`opts.color`、`opts.ms`（默认 520）、`opts.hold`（收起前停留，默认 160 ms）、`opts.curve`（默认 `'auto'`，两点加弧）。

```js
await board.march('chengdu', 'hanzhong', { color: '#b8432f' });
```

### board.focus(id, opts) {#board-focus}

镜头推到某地。`opts.zoom`（默认至少 6.5）、`opts.duration`（默认 600 ms）。

### board.fit(ids, opts) {#board-fit}

框住给定地点（缺省全部）。`opts.padding`、`opts.maxZoom`（默认 9）、`opts.duration`（默认 0）。

### board.destroy() {#board-destroy}

移除地图。

## 其它

| 成员 | 说明 |
|---|---|
| `board.map` | MapLibre 地图本身 |
| `board.stage` | 底层的 story stage |
| `board.sites` | `{ id: site }` |
| `board.links` | 连线数组副本 |

### MapStageBoard.RINGS {#mapstageboard-rings}

`{ select: { color: '#241b14', width: 3.5 }, target: { color: '#9a6b2c', width: 3 } }`。

### MapStageBoard.DEFAULTS {#mapstageboard-defaults}

`create` 的默认参数（`pitch`、`rotate`、`pickRadius`、`padding`、`radius`、`neutral`）。

纯函数（单测用）：`cityFeatures`、`linkFeatures`、`nearestSite`、`mergeCities`、`linkKey`。
