# 叙事 Story · story.json v1

Story 层回答：**讲什么、第几秒讲到哪**。它把长征 14 期里每集手写的 `story_*.py`、四渡赤水的 `forceMovementRoutes.ts` 收成一份声明式 JSON。

> **状态：已实现（P1）。** 运行时 `tuner/assets/mapstage-story.js`（`window.MapStage`）、`validateStory`、`schemas/story.schema.json` 和示例 [story-hexi.json](../site/examples/story-hexi.json) 都在仓库里；[河西走廊示例](../site/examples/story-hexi.html)就是一份 story.json 直接出整段。`shots[].t` 是**到位时刻**（动作在 `t - move` 到 `t` 之间完成）。`compliance.full` 时间段由 `mount` 逐秒自检，不过就拒绝渲染。

## 总览

```json
{
  "version": 1,
  "id": "hexi-wuwei-dunhuang",
  "duration": 16,
  "fps": 30,
  "preset": "preset.json",
  "look":   { "skin": "parchment" },
  "sites":  [],
  "routes": [],
  "beats":  [],
  "shots":  [],
  "cards":  [],
  "compliance": { "profile": "cn-video" }
}
```

时间单位一律是**秒**（浮点），从 0 开始。宿主用 `t = frame / fps` 换算。

## look 外观 {#look}

```json
{ "basemap": "nightlights", "skin": "night", "terrain": 1.2 }
```

| 字段 | 说明 |
|---|---|
| `basemap` | 底图样式 id，与调参台「底图样式」同一张表（`tuner-vector.js` 的 `BASEMAP_STYLES`）：`natural` / `atlas` / `paper` / `ink` / `qinglv` / `nightlights` / `dusk`。决定海拔设色、山影配色、配套皮肤、水系开关，夜景再加灯光与夜光图。各样式用途见 [底图样式](look.md#basemap)。`satellite` 不可用（叙事运行时没有卫星栅格，校验会报错）。**优先于** preset 的 `ui.basemapId` |
| `skin` | 皮肤 id：`parchment` / `aged` / `ink` / `silk` / `night`，见 [SKINS](api-look.md#antiquevectorpaint-skins)。没写 `basemap` 时 preset 的 `ui.skinId` 优先；写了 `basemap` 时 `look.skin` 覆盖底图配套皮肤 |
| `terrain` | 地形夸张，`false` 关闭；缺省取 preset 里的值，再缺省 1 |
| `nightLights` | 夜景的夜光数据源，写法同 `map-tiles.config.js` 的 `nightLights`（`image + bounds` / 等经纬 `image` / `tiles`）。缺省用仓库自带的 `assets/night-lights.png`（GeoNames 模拟）。`mount` 的 `opts.nightLights` 优先于它 |

可省。不写 `basemap`、preset 里也没有非卫星的 `ui.basemapId` 时，外观与以前完全一样（只换皮肤）。

**preset 兼容。** 调参台导出的 preset 里有 `ui.basemapId` 和 `vector.*`（`relief` / `elevStops` / `reliefOpacity` / `lights` / `nightRaster` / `landcover` / `paint`），运行时照着画：

- `story.look.basemap` 没写，或与 `ui.basemapId` 相同 → 用 preset 里的实际值（含改过的色阶、`maplibre.hillshade` 配色、`ui.showWater`）。
- `story.look.basemap` 与 preset 不同 → 按该底图样式的默认值画，preset 的 `vector` 与皮肤不带过去。
- preset 的 `ui.basemapId` 为空但 `vector.relief` / `lights` / `nightRaster` 开着（调参台里改过色阶后 id 会清空）→ 照 `vector.*` 原样画。
- `ui.basemapId: "satellite"` → 当作没有底图样式。

叙事运行时**不画道路**（历史视频里现代路网是穿帮），底图样式里的 `showRoads` 不生效；夜景的「干道发光线」属于灯光，照画。

示例：[切换古卷皮肤](../site/examples/skins.html)、[底图样式与夜景](../site/examples/look-basemap.html)。

## sites 地点 {#sites}

```json
{ "id": "dunhuang", "name": "敦煌", "lngLat": [94.66, 40.14], "tier": "capital",
  "approx": false, "confidence": "A", "label": { "side": "right" }, "source": "OSM" }
```

| 字段 | 说明 |
|---|---|
| `lngLat` | WGS84 `[经度, 纬度]`。注意四渡赤水坐标表是「纬度,经度」，导入时要换序 |
| `tier` | `capital` / `large` / `medium` / `small` / `pass` / `station` / `ordos`，决定字号与图标 |
| `confidence` | `A` 正史可考 / `B` 互证 / `C` 推测。**C 级不得精确落点**，自动视为 `approx` |
| `approx` | 位置约，标签加「（约）」。史学有争议的地点（如汉玉门关）必须为 true |
| `label.side` | `right`（默认）/ `left`，两点太近时用来避让 |

坐标来源优先级：本地坐标表 > OSM / Nominatim（有错，要人工核）> 估算。来源写进 `source`。

## routes 路线 {#routes}

```json
{ "id": "red-main", "side": "red", "role": "primary",
  "via": ["wuwei", "zhangye", "jiuquan", "dunhuang"],
  "curve": "auto", "draw": [1.0, 11.0], "hold": 11.0, "ghost": true,
  "label": { "text": "红一方面军", "mode": "visible" }, "confidence": "A" }
```

| 字段 | 说明 |
|---|---|
| `side` | `red` 红军 `#c0272d` · `enemy` 国民党军 / 马家军 `#5f7182` · `ally` 西路军等 `#7a1430` · `neutral`。**颜色表示「谁的行动」**：猜测的红军去向也用红色（虚线），不换色 |
| `role` | `primary` 主线 · `reaction` 敌方反应 · `background` 背景 · `residual` 残影 · `callout` 只在弹窗里提 |
| `via` / `coords` | 经停点 id 列表，或直接给坐标数组。二选一 |
| `curve` | `auto`：只有两点或近共线（≤ 0.4°）才加弧；`none`：真实线形（河段、封锁线） |
| `draw` | `[t0, t1]` 行进窗口。按**里程**匀速推进，窗口外停在起点 / 终点 |
| `hold` | 线画完后保留到何时；**按段末收**，不拖进下一段 |
| `ghost` | 全程淡底虚线（先告诉观众要去哪） |
| `label.mode` | `visible` / `calloutOnly` / `hidden` |

角色 → 画法（四渡赤水分级表）：

| role | 默认画法 |
|---|---|
| `primary` | 实线 + 头部箭头 + 行进动画 |
| `reaction` | 压力带或短促箭头，起点只标方位示意，不点名不标番号 |
| `background` | 淡色静态线 |
| `residual` | 已走过的残影 |
| `callout` | 不上地图，只在弹窗里出现 |

**同屏上限**：`primary` ≤ 1、`reaction` ≤ 2、部队名牌 ≤ 2。超出时运行时报错，不静默裁掉。

番号的可信度另分四级：实 / 互证 / 一说 / 综述。不确定的写「约」或「一说」，不硬标。

## beats 地名节拍 {#labels}

```json
[
  { "t": 0,   "active": ["wuwei"] },
  { "t": 4.2, "active": ["zhangye"] },
  { "t": 9.8, "active": ["dunhuang"], "dim": [] }
]
```

地名三态：`active` 当句讲到 · `normal` 讲过 · `dim` 还没讲到。规则：

- **出场后不卸载。** 河名、城名、城池图标一旦出现，到片尾都在，只切三态。
- 变暗用颜色，不用透明度（压缩后半透明字会糊）。
- 同屏 `active` ≤ 2。
- 省名用小字（72 / 56 / 40 px 按层级），不压战场标签。

示例：[地名三态](../site/examples/labels.html)。

## shots 镜头 {#shots}

```json
[
  { "t": 0,   "fit": ["wuwei", "dunhuang"], "pitch": 40 },
  { "t": 6.5, "fit": ["zhangye", "jiuquan"], "move": 2.2, "push": 0.06, "tilt": 3 },
  { "t": 12,  "fit": "route:red-main", "maxSpan": 16000 }
]
```

`fit` 给地点 id 列表或 `route:<id>`，运行时按安全区反算机位；也可以直接给 `center` / `zoom` / `pitch` / `bearing`。规则见 [镜头](camera.md)。

## cards 字卡 {#cards}

```json
{ "t0": 3, "t1": 7, "kind": "name", "text": "张掖", "sub": "古称甘州", "source": "党史B 第三章" }
```

`kind`：`place` 地名卡 · `name` 人名 / 名牌 · `stamp` 印章 · `pair` 大字数字 · `table` 速查表（逐格点亮，片尾整表定格）· `photo` 照片卡（注「资料照」）· `telegram` 电报 · `doc` 文献。没有可靠照片时用名牌，不用 AI 生成人像。

`table` / `photo` / `telegram` / `doc` 各有专门版式，字段如下（都只取决于 `t`，不用 transition，逐帧可复现）：

| kind | 额外字段 | 画法 |
|---|---|---|
| `table` | `rows`（必填，字符串行数组，列数一致）、`header` | 表头常亮；格子在窗口前 70% 逐格点亮，之后整表定格。`text` 是表标题 |
| `photo` | `src`（必填） | 相框 + 「资料照」角标；`text` 是图注，`sub` 放出处。图没加载完，`seek` 不放行 |
| `telegram` | — | 报头条 + 等宽字；`text` 是电文（可含 `\n`），窗口前 60% 逐字出现，之后整段定格；`sub` 放发报人 / 日期 |
| `doc` | `lines`、`seal` | 红头标题（`text`）+ 正文行 + 落款（`sub`）+ 印章（`seal`，默认「印」） |

```json
{ "t0": 8, "t1": 13, "kind": "table", "text": "速查表标题", "header": ["列 A", "列 B"], "rows": [["a1", "b1"], ["a2", "b2"]] }
{ "t0": 4, "t1": 8,  "kind": "telegram", "text": "（此处放有出处的电文原文）", "sub": "发报人 · 日期" }
```

弹窗（四渡赤水）分决策窗 / 敌判窗 / 战术窗 / 结果窗，同屏 1 个、不超过 3 行，弹窗期间地图停 1–2 秒。

## compliance 合规 {#compliance}

```json
{ "profile": "cn-video", "full": [[0, 3], [14, 16]] }
```

`full` 标出哪些时间段是全图，自检时要求台湾 / 海南 / 南海诸岛在画内；这些时段自动画南海十段线（`tenDash` 默认 `true`，写 `false` 才关，自担审核风险）。规则见 [合规](compliance.md)。

## 运行时校验

`MapStage.validateStory(story)` 在渲染前跑，任何一条不过都**拒绝渲染**而不是带病出片：

- [ ] 所有 `via` / `fit` / `active` 引用的 id 都存在
- [ ] `confidence: "C"` 的地点都是 `approx`
- [ ] 任一时刻 `primary` ≤ 1、`reaction` ≤ 2、`active` ≤ 2
- [ ] 路线 `hold` 不超过下一段 `draw[0]`
- [ ] `full` 时间段内合规自检全过
- [ ] 镜头相邻关键帧间至少隔 `move` 秒（一句一动）
