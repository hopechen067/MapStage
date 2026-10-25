---
name: mapstage
description: MapStage — 历史视频的叙事地图舞台（MapLibre GL JS 5.6）。古卷底图 preset、路线行进、地名三态、按口播自动取景、平台合规（不画省界国界、无雾无暗角、台湾海南南海完整）、seek(t) 逐帧时间契约，供 HyperFrames / Remotion / Playwright 截帧。用户说「/mapstage」「做一段 X 从 A 到 B 的路线移动」「出一张全国定位图」「调古卷底图」「地图镜头」时使用。
---

# MapStage · 历史视频的地图舞台

给历史 / 地理 / 战役视频做**可逐帧复现**的地图镜头。三层，各一份规范：

| 层 | 文件 | 规范 |
|---|---|---|
| Look 底图 | `preset.json` v3（调参台导出） | [references/look.md](references/look.md) |
| Story 叙事 | `story.json` v1（地点 / 路线 / 地名节拍 / 镜头 / 字卡） | [references/story-spec.md](references/story-spec.md)、[references/camera.md](references/camera.md) |
| Stage 舞台 | `window.__mapstageSeek(t)` | [references/hosts.md](references/hosts.md) |

官网（文档即本目录 `references/`）：https://hopechen067.github.io/MapStage/

## 何时用

- 路线行进、会师、包围、地名点亮、全国 / 区域定位等地图段。
- 需要过国内视频平台审核的中国地图画面。
- 需要按时间逐帧截取、可断点续拍的地图镜头。

不用于：交互式 Web 地图产品、导航测绘、与地图无关的视频特效。

## 工作流（「/mapstage 做一段 X 从 A 到 B 的路线移动」）

1. **问清三件事**（缺就问，不猜）：起止与经停点、时长或对应口播、用在哪个视频工程 / 宿主。
2. **坐标**：优先工程里的坐标表，其次 OSM / Nominatim（要人工核）。WGS84 `[lng, lat]`；不确定的点 `confidence: "C"` + `approx: true`，不精确落点。
3. **写 story.json**：`sites` → `routes`（`side` 定阵营色，`role` 定主次，`draw` 定行进窗口）→ `beats`（地名三态）→ `shots`（用 `fit` 给地点，让运行时按安全区反算，不手写机位）。按 [story-spec.md](references/story-spec.md) 的校验清单自查。
4. **选底图**：默认 `parchment` 皮肤 + 真实地形 1.0（夸张 ≤ 2.0）。要换地面风格用 `story.look.basemap`（`natural` / `atlas` / `paper` / `ink` / `qinglv` / `nightlights` / `dusk`，用途见 [look.md#basemap](references/look.md#basemap)）；夜景的夜光是 GeoNames 模拟的，不能当实测数据讲。要精调就让用户开调参台 `/studio/` 导出 preset v3。
5. **起预览**：宿主页面走 HTTP（不能 `file://`）。先看端口上是否已有服务，有就复用。本地官网 / 示例：`node site/serve.mjs`（8770）。
6. **低清预览**：960×540@10 给用户看节奏、构图；跑合规自检。**停在这里等用户确认。**
7. **终版**：确认后 1920×1080@30，`precacheViewports` 后逐帧 `seek` + 截图；抽 1080 整帧检查细纹理。

起步模板：`site/examples/route-march.html`（路线行进）、`seek-contract.html`（时间契约）、`camera-fit.html`（自动取景）。工具函数在 `site/assets/stage-kit.js`（`MapStageKit`，Story 运行时原型）。

## 硬规则

**合规**（默认开启，见 [compliance.md](references/compliance.md)）
- 不画省界、国界；不加雾化、暗角（`vignetteStrength` 录制按 0）。
- 全图时台湾、海南、南海诸岛、海岸线完整，不用裁切躲开。
- 封面和片头 3 秒不放陷人、溺水、倒地、尸体。

**镜头**（见 [camera.md](references/camera.md)）
- 一句口播最多一次有目的移动，到位停稳，只缓推 6–7% + 俯仰 3°。
- 机位由地点集合按安全区 `[0.06, 0.22, 0.94, 0.78]` 反算；全线总览单独放宽上限。
- 「地图平淡」靠画面变化解决，不靠加大地形夸张。

**叙事**（见 [story-spec.md](references/story-spec.md)）
- 地名出场后不卸载，只切 normal / active / dim；变暗用颜色不用透明度。
- 颜色表示谁的行动：红军 `#c0272d`、敌方 `#5f7182`、西路军 `#7a1430`；箭头与牌子同色。
- 同屏 primary 路线 ≤ 1、reaction ≤ 2、部队名牌 ≤ 2、弹窗 1 个 ≤ 3 行。超了报错，不静默裁。

**录制**（见 [hosts.md](references/hosts.md)）
- 只用 `jumpTo` + 等 idle；录制路径禁止 `easeTo` / `flyTo`。
- 录制前预缓存所有机位（冷缓存第一遍与之后的帧不一致）。
- `pixelRatio: 1`、`raster-fade-duration: 0`；无头 Chrome 加 `--disable-gpu-rasterization`。
- 调参台 `/studio/`（`tuner/`）只调参，**永远不做终版渲染宿主**。
- 出片走 `runtime/render.mjs`：先 `preview`（960×540）给人看，`approve` 之后才 `final`（1080p）；确认后数据改了会拒绝。
- HyperFrames 不要直接跑活地图（实测黑底），把烘好的视频当 `<video>` 合成；Remotion 用 `templates/remotion/MapStageScene.tsx`。

**地形与瓦片**（见 [look.md](references/look.md)）
- raster-dem 源必须 `encoding: "terrarium"`（默认 Mapterhorn，备选 AWS Terrarium）。MapLibre ≥ 5 山影与地形共用一个 source id；`terrain.dualSource: true` 恢复两源。
- `style.terrain` + `style.sky` 在 `new Map()` 时写入（`enableStyleTerrain`）。网格起伏要 zoom ≈ 10–12、pitch ≈ 70 才看得出。
- 样式更新里不要无条件 `setTerrain`，只用 `setTerrainEx` / `terrainRise`；调参滑杆 `setTerrainEx(…, { budget: false })`。
- 瓦片不打包，运行时只从配置的 URL 取；只用有权使用的源。私人源写 `tuner/map-tiles.config.local.js`（gitignored，不外传）。
- 城池 custom layer 只在镜头移动或首次地形贴合时 `triggerRepaint`，优先 fill-extrusion。

**区域拆出**（平面投影，见 [region-isolate.md](references/region-isolate.md)）
- 拆出开启时把地形网格裁到轮廓（补丁版 MapLibre `tuner/vendor/`）：**一张网格**——内圈顶点 XY 吸附到裁剪 0.5 等值线；外圈顶点吸附到略短于 0.5 处并在 Z 上下沉（含拼接裙边），让混合三角形成为细竖墙；斜海岸轴向梯度为零时退到第一个 8 邻接交点；完全在外的底面丢弃。
- 不丢弃瓦片边缘的混合裙边面；不加第二道等值线墙；保留 `setTerrainEx`；此模式下**不要** `setData` 瓦片化羊皮纸遮罩（会冻住调参台）；不因拆出开启就 `flattenTerrain` / `setTerrain(null)`。
- 地球投影的拆出仍用「世界减多边形」羊皮纸遮罩。默认关闭；开启后用 `reliefCameraForFeature` 取景。演示中国轮廓取自 Natural Earth 10m 中国视角（含藏南、钓鱼岛、南海诸岛、十段线），是叙事轮廓，不是官方边界。

**数据**
- 水系 / 道路：OpenFreeMap 矢量瓦片（`vl-water*` / `vl-waterway*` / `vl-highway` 等），仓库不带水系数据文件，见 [water-overlay.md](references/water-overlay.md)。旧预设里的高亮水系 / 河湖名 / 湖描边键（`highlightRiver`、`showHighlight`、`showRiverLabels`、`lakeOutline`、`qilian*`）读入时丢弃。

## 参考

- 入门：[overview](references/overview.md) · [quickstart](references/quickstart.md) · [install](references/install.md)
- 规范：[look](references/look.md) · [story-spec](references/story-spec.md) · [camera](references/camera.md) · [compliance](references/compliance.md) · [hosts](references/hosts.md)
- API：[api.md](references/api.md)（`AntiqueMapFx` / `AntiqueVectorPaint` / `REGION_ISOLATE` / `MapStageKit`）
- 参数与配置：[参数列表说明](references/参数列表说明.md) · [tested-config](references/tested-config.md) · [runtime-perf](references/runtime-perf.md) · [city-tier-schema](references/city-tier-schema.md) · [water-overlay](references/water-overlay.md) · [tuner-workflow](references/tuner-workflow.md)
- 背景：[lessons-long-march](references/lessons-long-march.md)（规则从哪来）· [roadmap](references/roadmap.md)
- Schema：[map-preset](schemas/map-preset.schema.json) · [sample-sites](schemas/sample-sites.schema.json)
- 调参台源码：`tuner/index.html`（拆出 / 水系 / 城池 / 卫星）、`tuner/assets/tuner-vector.js`（配色：皮肤 / 海拔设色 / 等高线 / 图层颜色，已并入调参台；`vector-layers.html` 仅作 6.6 实验页保留）；样式 `tuner/assets/tuner.css`（token 与官网 `site.css` 一致），顶栏 / 分区导航 / 明暗 `tuner/assets/tuner-shell.js`，状态 `tuner/assets/tuner-app.js`，纯函数 `tuner-util.js` / `tuner-params.js`（`tuner-modules.test.mjs`）。

## 校验

在 `tuner/` 下 `node verify.mjs`，末尾应为 `verify ok`（必需文件、单测、UTF-8 / 内联脚本解析）。官网单测：`node site/assets/md.test.mjs`、`node site/assets/stage-kit.test.mjs`。浏览器冒烟：起 `site/serve.mjs` 后 `node runtime/site-thumbs.mjs http://127.0.0.1:8770`。
