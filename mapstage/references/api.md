# 运行时 API

所有运行时都是 UMD 脚本：浏览器挂到 `window.*`，Node 下 `module.exports`（纯函数部分可以用 `node:assert` 测）。依赖 MapLibre GL JS **5.6.0**，没有 npm 包、不用构建。

每个函数的签名、参数、返回值和用法分三页写，函数下面列出用到它的示例：

| 页面 | 全局名 | 用来做什么 |
|---|---|---|
| [Story](api-story.md) | `MapStage` | 一份 story.json 挂成逐帧可复现的画面：mount / seek / precache / check，校验与合规，路线和镜头的纯函数 |
| [Board](api-board.md) | `MapStageBoard` | 游戏与互动页：城池、连线、点选、行军动画 |
| [底图](api-look.md) | `AntiqueVectorPaint`、`AntiqueMapFx` | 皮肤、图层开关、地形夸张、等 idle、预缓存 |

想先看效果，去 [示例库](../site/examples/index.html)：每个功能一个能直接复制运行的页面。

## 全部全局名

| 全局名 | 文件 | 状态 |
|---|---|---|
| `MapStage` | `tuner/assets/mapstage-story.js` | 稳定（P1） |
| `MapStageBoard` | `tuner/assets/mapstage-board.js` | v0，接口名可能微调 |
| `AntiqueVectorPaint` | `tuner/assets/vector-paint.js` | 稳定 |
| `AntiqueMapFx` | `tuner/assets/map-fx.js` | 稳定 |
| `REGION_ISOLATE` | `tuner/assets/region-isolate.js` | 稳定 |
| `AntiqueTerrainIsland` | `tuner/assets/terrain-island.js` | 需补丁版 MapLibre（`tuner/vendor/`） |
| `HanCity3D` | `tuner/assets/han-city-3d.js` | 需 Three.js 0.160 |
| `MapStageKit` | `site/assets/stage-kit.js` | 官网首页的内部小工具，不对外，示例不再使用 |

## 加载顺序

```html
<link rel="stylesheet" href="https://unpkg.com/maplibre-gl@5.6.0/dist/maplibre-gl.css">
<script src="https://unpkg.com/maplibre-gl@5.6.0/dist/maplibre-gl.js"></script>
<script src="studio/assets/vector-paint.js"></script>   <!-- AntiqueVectorPaint -->
<script src="studio/assets/map-fx.js"></script>         <!-- AntiqueMapFx -->
<script src="studio/assets/mapstage-story.js"></script> <!-- MapStage -->
<script src="studio/assets/mapstage-board.js"></script> <!-- MapStageBoard，只有游戏页需要 -->
```

`studio/` 是官网上调参台的目录，脚本可以直接从官网引用，也可以拷到自己项目里。

## REGION_ISOLATE

区域拆出：把一个国家 / 走廊 / 自定义多边形之外的地方藏起来。

| 函数 | 说明 |
|---|---|
| `listRegions(data)` / `findRegion(data, id)` | 内置轮廓（`region-isolate-data.js`） |
| `buildMaskGeoJSON(feature)` | 世界减多边形的遮罩（地球视角用） |
| `pointInFeature(pt, feature)` | 点是否在区域内 |

平面投影下拆出走地形岛裁剪（补丁版 MapLibre），细节见 [区域拆出](region-isolate.md)。
