# 游戏地图 Play

Play 层回答：**做游戏、做互动页的人，怎么用上这张古卷地图**。

MapStage 只管地图：古卷底图、地形、地名、合规，加上游戏常用的城池圈、连线、点选、行军动画。**规则由你自己写**，回合制、卡牌、答题、互动叙事都行。MapStage 不关心你的规则，只按你给的状态画图。

> **状态：v0。** 地图接口 `tuner/assets/mapstage-board.js` 可以用，接口名可能还会微调。示例：[最小用法](../examples/board-basic.html)、[三分天下](../examples/play-sanguo.html)。

## 适合做什么

| 适合 | 不适合 |
|---|---|
| 城池级回合制策略（类似早期三国志大地图） | 即时制，几百支部队同时移动 |
| 历史互动叙事、地理答题、行军路线选择 | 战斗场景、3D 小兵、骨骼动画、粒子 |
| 给视频做互动配套，与视频共用同一套地点数据 | 商业发行级的完整游戏（走 Godot / Unity，MapStage 只导出素材） |

MapLibre 是地图渲染器，不是游戏引擎。几十座城、几十条行军动画没有压力；超出左栏的需求先停下来论证。

## 上手 {#quickstart}

### 1. 加载脚本

```html
<link rel="stylesheet" href="https://unpkg.com/maplibre-gl@5.6.0/dist/maplibre-gl.css">
<script src="https://unpkg.com/maplibre-gl@5.6.0/dist/maplibre-gl.js"></script>
<script src="studio/assets/vector-paint.js"></script>
<script src="studio/assets/map-fx.js"></script>
<script src="studio/assets/mapstage-story.js"></script>
<script src="studio/assets/mapstage-board.js"></script>
```

没有 npm 包，也不用构建，脚本挂在全局 `window.MapStageBoard` 上。地图容器要有确定的宽高。

### 2. 准备地点和连线

```js
const sites = [
  { id: 'chengdu', name: '成都', lngLat: [104.07, 30.67], tier: 'capital', confidence: 'B' },
  { id: 'hanzhong', name: '汉中', lngLat: [107.03, 33.07], tier: 'medium', confidence: 'B' },
  { id: 'changan', name: '长安', lngLat: [108.94, 34.27], tier: 'large', confidence: 'B' },
];
const links = [['chengdu', 'hanzhong'], ['hanzhong', 'changan']];
```

`sites` 和 [story.json 的 sites](story-spec.md#sites) 是同一套字段：`tier` 决定字号和图标，`confidence` 为 C 的地点必须 `approx: true`（自动标「约」）。`links` 是相邻关系，不需要可以不给。

### 3. 创建地图

```js
const preset = await (await fetch('studio/presets/antique-default.json')).json();
const board = await MapStageBoard.create(document.getElementById('map'), { preset, sites, links });
```

创建时会先校验 sites 和 links，引用不存在的地点、重复连线都会直接报错。默认视野自动框住所有地点，并禁用旋转。

### 4. 状态变了就重画

```js
board.setCities({
  chengdu: { color: '#b8432f', value: 28, badge: 28, ring: 'select', label: 'active' },
  changan: { color: '#3f5f8a', value: 22, badge: 22 },
});
board.setLinks((a, b) => ({ color: '#b8432f', width: 2 }));
```

`setCities` 只传变了的城，字段会合并；传 `null` 清掉。没给 `color` 的城只显示地名，不画圈。

### 5. 接玩家输入、播动画

```js
board.on('pick', ({ id, site }) => {
  if (!id) return;            // 点在空地
  // 你的规则：选中、出兵、答题……
});
await board.march('chengdu', 'hanzhong', { color: '#b8432f' });
board.focus('hanzhong');
```

推荐的写法是「**状态 → 画面**」：规则只改你自己的状态对象，每次改完都整体调一次 `setCities` / `setLinks`，不要在地图上零碎地改。这和视频线的 `seek(t)` 是一个道理：画面只取决于状态。

## API {#api}

`MapStageBoard.create(el, opts)` → `Promise<board>`

| opts | 默认 | 说明 |
|---|---|---|
| `preset` | — | 底图 preset（调参台导出） |
| `sites` / `links` | — / `[]` | 地点与相邻关系 |
| `fit` | `true` | `true` 框住全部地点；也可以传地点 id 数组；`false` 不动镜头 |
| `padding` | `{ top: 60, bottom: 40, left: 80, right: 60 }` | 取景留白（像素） |
| `pitch` | `20` | 俯仰角 |
| `rotate` | `false` | 是否允许旋转 |
| `pickRadius` | `28` | 点选容差（像素） |
| `radius` | `{ min: 7, scale: 2.2 }` | 城池圈半径 = `min + sqrt(value) × scale` |

| board | 说明 |
|---|---|
| `setCities(patch)` | `{ id: { color, value, badge, ring, label } }`；`ring`：`'select'` / `'target'` / `null`；`label`：`'normal'` / `'active'` / `'dim'`（地名三态） |
| `getCity(id)` | 当前样式 |
| `setLinks(style)` | `style(a, b)` 返回 `{ color, width, hidden }`；返回空用中性色细线 |
| `neighbors(id)` | 相邻地点 |
| `on('pick' \| 'hover', fn)` | 回调 `{ id, site, lngLat, point }`，`id` 为 `null` 表示没点中；返回取消函数 |
| `march(from, to, { color, ms, curve, hold })` | 行军推进线，返回 Promise |
| `fit(ids?, { padding, duration })` | 框住若干地点 |
| `focus(id, { zoom, duration })` | 镜头推到某地 |
| `map` / `stage` / `sites` | MapLibre 地图、Story 舞台、地点表，需要更多控制时直接用 |
| `destroy()` | 卸载 |

纯函数 `lintBoard`、`cityFeatures`、`linkFeatures`、`nearestSite`、`mergeCities` 也导出，可以在 Node 里单测。

## 合规 {#compliance}

游戏画面同样按 [合规](compliance.md) 处理，board 已经替你管了大部分：

- 底图不画现代省界、国界（Story 运行时删掉了境界线图层）。
- **势力只用城池圈和连线上色。** 不要用 `board.map` 自己加势力范围面，免得被看成边界线。
- 出现全国视角时，台湾、海南、南海诸岛与海岸线必须完整。
- 用今地估算的古地名坐标，`confidence` 不得标 A；有争议的地点标「约」。
- 网页 demo 不涉及发行；国内商业发行另有版号与地图审核，届时单独评估。

## 附：示例规则 mapstage-play.js {#rules}

[三分天下](../examples/play-sanguo.html) 用的规则引擎，**可选**，演示怎么把规则和地图分开。纯函数、不碰页面，同一个 seed 加同一串操作永远是同一局（存档 = `{ seed, actions }`）。

剧本 `scenario.json`：

```json
{
  "version": 1, "id": "sanguo-221", "startYear": 221, "player": "shu",
  "factions": [{ "id": "shu", "name": "蜀", "color": "#b8432f", "capital": "chengdu" }],
  "sites":  [{ "id": "chengdu", "name": "成都", "lngLat": [104.07, 30.67], "tier": "capital", "confidence": "B" }],
  "cities": { "chengdu": { "owner": "shu", "troops": 28 } },
  "links":  [["chengdu", "hanzhong"]],
  "rules":  { "recruit": 5, "cap": 60 }
}
```

规则：一回合一季；每城每回合只能征兵或沿连线出兵一次；攻城时攻方兵力乘 0.85–1.15 的随机系数，守方兵力乘城防加成（默认 1.3）再乘同样的随机系数，大者胜；电脑能稳赢就打最弱的邻城，否则往前线调兵或征兵；只剩一家时结束。

| 函数 | 说明 |
|---|---|
| `createGame(sc, { seed })` | 开局 |
| `apply(state, sc, action)` | `recruit` / `march` / `end`，返回 `{ state, events }`，非法操作抛错 |
| `actionsFor(state, sc, id)` | 某城本回合能做的操作 |
| `replay(sc, { seed }, actions)` | 重放存档 |

要做自己的玩法，通常是自己写规则，只拿 board 画图；这份规则当参考即可。
