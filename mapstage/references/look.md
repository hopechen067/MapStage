# 底图 Look · Preset v3

底图层只回答一个问题：**地图长什么样**。它不知道路线、地名和时间。所有外观参数收在一份 `preset.json`（v3）里，在调参台调好后导出。

## 工作流

1. 打开调参台 `/studio/`（拆出 / 水系 / 城池 / 卫星）或 `/studio/vector-layers.html`（皮肤编辑器）。
2. 调到满意，点「导出 JSON」（复制或下载）。
3. 写进视频工程的 `scene/preset.json`。宿主页面加载它，**不再回调参台**。
4. 终版只在生产宿主上渲染，调参台永远不是渲染宿主。

## Preset v3 结构

```json
{
  "id": "antique-default",
  "version": 3,
  "camera": { "center": [104, 35.5], "zoom": 4.2, "pitch": 28, "bearing": 0 },
  "mapstage": {
    "backgroundColor": "#c8c2b4",
    "terrainExaggeration": 1,
    "satellite": { "opacity": 0.7, "saturation": -0.08, "contrast": 0.02, "hueRotate": 12 },
    "hillshade": { "exaggeration": 0.42, "illuminationDirection": 315, "shadowColor": "#2c2824" },
    "water": { "riverLevel1": "rgba(42,105,120,0.95)", "riverL1Width": 1.8 }
  },
  "css": { "sepia": 0.08, "saturate": 0.98, "contrast": 1.03, "brightness": 1, "hueRotate": -1,
           "warmTintColor": "#9a8868", "warmTintAlpha": 0.04, "vignetteStrength": 0 },
  "ui": { "projection": "map", "showSatellite": true, "showRelief": false, "showWater": false },
  "isolate": { "enabled": false, "regionId": "china" },
  "cities": { "dataFile": "sites.json", "halfKm": 18, "renderMode": "fill-extrusion" }
}
```

| 段 | 内容 | 详表 |
|---|---|---|
| `camera` | 默认机位。Story 有镜头时以 Story 为准 | [镜头](camera.md) |
| `mapstage` | 底色、地形夸张、卫星调色、山影、水系配色与线宽 | [参数列表](参数列表说明.md) |
| `css` | 地图容器的 CSS 调色叠层 | 见下文 |
| `ui` | 投影（`map` / `globe`）与各图层开关 | |
| `isolate` | 区域拆出 | [区域拆出](region-isolate.md) |
| `cities` | 分级城池数据与渲染方式 | [城池分级](city-tier-schema.md) |

非 v3 的 preset 只打 warning 不报错；v2 缺的 `ui.projection` 等字段按默认值补齐。

## 皮肤 {#skins}

五套内置皮肤，定义在 `tuner/assets/vector-paint.js` 的 `SKINS`：

| id | 名称 | 特点 |
|---|---|---|
| `parchment` | 宣纸古卷 | 默认。宣纸底、黛青水 |
| `aged` | 陈旧羊皮 | 更黄更旧、深褐道路 |
| `ink` | 墨色山水 | 水墨淡彩、低饱和 |
| `silk` | 绢本重彩 | 暖绢底、朱红干道 |
| `night` | 暗夜星图 | 暗色底、金色路网 |

一套皮肤 = 15 个核心图层色 + 拆分层（从父色推导）+ 一组 CSS 调色。换皮肤只调 `setPaintProperty`，不重建 style。示例：[五套古卷皮肤](../site/examples/skins.html)。

## 底图样式 {#basemap}

皮肤只管矢量图层的颜色；**底图样式**再往下一层，决定「不用卫星时地面长什么样」：海拔设色（`color-relief`，Terrarium DEM 带海底高程，负值即海色）+ 山影配色 + 配套皮肤，夜景再加灯光。调参台「底图样式」一栏与叙事运行时用同一张表：`tuner/assets/tuner-vector.js` 的 `BASEMAP_STYLES`。

| id | 名称 | 地面 | 配套皮肤 | 适合 |
|---|---|---|---|---|
| `natural` | 自然 | 默认色阶，仿卫星的沉稳地色 | `parchment` | 通用叙事底图；想要「像卫星但没有现代建筑」时的首选 |
| `atlas` | 设色 | 地图集分层设色：绿平原 → 黄褐高原 → 雪峰 | `parchment` | 讲地形、讲海拔差（翻越高原、沿河谷行军），观众一眼读出高低 |
| `paper` | 古卷 | 宣纸褐调分层，海作淡青 | `aged` | 古代史、舆图感的总图 |
| `ink` | 水墨 | 灰阶分层 + 重山影 | `ink` | 山水意境、文人题材；字卡 / 红线在灰底上最跳 |
| `qinglv` | 青绿 | 绢底平原，石绿山腰，石青高山 | `silk` | 唐宋题材、开篇大全景，仿青绿山水 |
| `nightlights` | 夜景 | 近黑地形 + 城市灯光 + 夜光图 | `night` | 讲人口与城市分布、近现代工业化、「从太空看中国」式的开场 |
| `dusk` | 暗夜 | 暗底，高原渐金 | `night` | 夜袭、急行军等需要压暗情绪的段落；暗底上路线与地名更醒目 |

`satellite`（卫星）只在调参台里有；叙事运行时没有卫星栅格，`story.look.basemap` 不能写它。

用法：

- Story：`"look": { "basemap": "qinglv" }`，见 [Story 规范 · look](story-spec.md#look)。调参台导出的 preset 里有 `ui.basemapId` 与 `vector.*` 时，`mount` 也照着画（改过的色阶、山影配色一并带上）。
- 不用 story：`MapStage.buildStyle({ basemap: 'qinglv' })`；要先加载 `studio/assets/tuner-vector.js`（`mount` 会自动加载，`buildStyle` 是同步的不会）。
- 叙事运行时不画道路，底图样式的道路开关不生效；十段线按底下实际的海面颜色定深浅：画水系看海洋水面色，不画水系看色阶的海面段（h < 0）；与默认深色的对比度低于 1.65 就换浅色（夜景的近黑海、水墨 / 暗夜皮肤的海），与皮肤 id 无关——夜景配宣纸皮肤照样是浅色。
- 地球视图（`globe`）下不画海拔设色，与调参台一致。

### 夜景与夜光图 {#night-lights}

夜景由三层叠成，压在山影之上、路线与地名之下：

1. **夜光图**（`night-lights`，栅格）：远景的「城市灯海」。z ≤ 6.5 全亮，z8 起淡出，z9.5 完全交给矢量灯光——原图只有 z6 精度，拉近会糊成灰白雾。
2. **城市光晕**（`vl-lights-glow`，heatmap）：OpenFreeMap 地名点按城 > 镇 > 村加权。有夜光图时只在近景补细节。
3. **灯区与干道**（`vl-lights-urban` / `vl-lights-roads`）：居民 / 商业用地的暖色块、高速与国省道的发光线。

**夜光图是模拟的，不是卫星实测。** 默认图 `tuner/assets/night-lights.png` 由 `tuner/scripts/bake-night-lights.mjs` 从 GeoNames 居民点（CC BY 4.0）烘焙：按「人口^0.8」累加到 z6 墨卡托网格、按聚落规模高斯扩散、再对数压亮。范围 60°E–150°E、2°S–56°N，覆盖台湾、海南与南海诸岛（单测会查）。局限：

- 亮度反映的是**居民点数量与人口**，不是真实用电与照明。工业区、港口、油气田、高速公路这些实际很亮的地方不会特别亮；人口多但电力少的地方反而偏亮。
- 中国用全部村镇（约 88 万点），周边国家只有人口 ≥ 500 的城镇，**境外会显得偏暗、偏稀**。不要拿它对比各国发展水平。
- 是今天的居民点分布，不是任何历史年份的；讲古代时它只是氛围，不能当「当时的人口分布」用。
- 精度 z6（约 2.4 km/像素），只适合全国到省级的远景。

需要实测夜光时，在 `map-tiles.config.js` 的 `nightLights`（调参台）或 `story.look.nightLights` / `mount` 的 `opts.nightLights`（叙事）换源，写法三选一：`image + bounds`（已是墨卡托的图）、只给 `image`（等经纬全球图，浏览器里重投影）、`tiles`（如 NASA GIBS VIIRS Black Marble，maxzoom 8）。换源后注意署名与许可。`false` 关掉夜光图，只留矢量灯光。

**逐帧契约。** `mount` 在建图前把夜光图整张载完（等经纬图顺带重投影），`seek(t)` 再确认数据源已就位才交帧，夜光图层不淡入（`raster-fade-duration: 0`），所以首帧不会先暗后亮。城市光晕（heatmap）贴在地形上时第一次到某个机位会晚一帧才画对，所以开了灯光的 `seek` 在 idle 后多画一帧再交（每帧多十几毫秒），首次访问与重访逐像素一致。载入失败时退回「只有矢量灯光」，画面仍逐帧确定。验收脚本：`runtime/verify-story-night.mjs`。示例：[底图样式与夜景](../site/examples/look-basemap.html)。

> **暗角不生效。** 皮肤和 preset 里的 `vignetteStrength` 是历史字段；平台审核把暗角判为违规画面（长征 ep14），MapStage 录制路径一律按 0 处理。默认 preset 的 0.1 将在下一版改成 0。

## 地形 {#terrain}

- 地形源必须 `encoding: "terrarium"`。默认 **Mapterhorn**（`tiles.mapterhorn.com`，512 瓦片，CC-BY，可商用需署名），备选 AWS Terrarium 30 m。
- MapLibre ≥ 5：山影图层与 `setTerrain` **共用同一个 source id**，DEM 只下载一次；老宿主可用 `terrain.dualSource: true` 恢复两源。
- `style.terrain` 与 `style.sky` 在 `new Map()` 时就写进 style（见 `enableStyleTerrain`）。
- 夸张：真实海拔 1.0；古卷 preset 1.6；长征经验 2.0 是上限，3.4 把山变成尖刺；陡峡谷近景反而要降到 0.65。
- 网格起伏要 **zoom ≈ 10–12、pitch ≈ 70** 才看得出来。全国视角 pitch 28 时再夸张也像一张斜放的照片——这时要的是画面变化，不是更高的山（见 [镜头](camera.md)）。
- 调参台滑杆走 `setTerrainEx(…, { budget: false })`；样式更新里不要无条件 `setTerrain`，只用 `setTerrainEx` / `terrainRise`。

示例：[真实地形](../site/examples/terrain.html)。

## 卫星、水系与城池

- **卫星**：可选，默认 EOX Sentinel-2 cloudless（公开演示瓦片，遵守 EOX 条款）。长征全线总图放弃了卫星图——近景会露出现代建筑，叙事底图用程序化自然底色更稳。
- **水系**：OpenFreeMap 矢量 `water` / `waterway`，颜色与线宽由预设 `maplibre.water` 和皮肤驱动，见 [水系叠加](water-overlay.md)。
- 河宽按**实际宽度**给，不按像素写死：500 m/px 的大范围底图上 5 px 的河等于 2.5 km 宽，会晕成大片蓝。全国视角不叠细河。
- **城池**：七级 tier（`capital` / `large` / `medium` / `small` / `pass` / `station` / `ordos`），`fill-extrusion` 或 Three.js 汉式城模型。

## 地球视角 {#globe}

`ui.projection: "globe"`（MapLibre 5 globe 投影）适合开场定位；路线段切回 `map` 录制，地形与拆出在平面上最稳。示例：[地球视角](../site/examples/globe.html)。

## 录制要求

- `pixelRatio: 1`，`raster-fade-duration: 0`。
- 城池 custom layer 只在镜头移动或首次地形贴合时 `triggerRepaint`；优先 `fill-extrusion`。
- 录制前 `precacheViewports` 把所有机位走一遍，再 `jumpTo` + `waitIdle`。详见 [宿主与渲染](hosts.md)。
