# Water overlay

水系和道路来自 OpenFreeMap 矢量瓦片（OpenMapTiles 的 `water` / `waterway` / `transportation`），不依赖仓库内的任何数据文件。调参台、`vector-paint.js` 与 skill 都读同一套 `vl-*` 图层。

之前的「分级水系包」（`water-data.js` + `water-pack.json`，含高亮水系、河湖名标注、省内水系裁剪）已移除：数据不可再分发，且用得很少。

## 图层

| 图层 id | source-layer | 用途 |
|---------|--------------|------|
| `vl-water` / `vl-water-river` / `vl-water-pond` | `water` | 湖、河面、池塘（填充） |
| `vl-water-ocean` | `water` | 海洋，沿用皮肤色 |
| `vl-waterway` | `waterway` | 一级河（river） |
| `vl-waterway-canal` | `waterway` | 二级（canal） |
| `vl-waterway-stream` / `vl-waterway-drain` | `waterway` | 三级（stream / drain） |
| `vl-highway` / `vl-rail` / `vl-minor` … | `transportation` | 道路与铁路 |

叠层只带水系和道路，不带注记、建筑、省界国界。

## 参数

预设 `maplibre.water`：

- 湖与河面：`lakeFill`
- 河线颜色：`riverLevel1` / `riverLevel2` / `riverLevel3`
- 河线宽：`riverL1Width` / `riverL2Width` / `riverL3Width`（相对默认值缩放 `vl-*` 的基准线宽）

可见性：`ui.showWater`（水系）、`ui.showRoads`（道路）。

旧预设里的 `lakeOutline`、`highlightRiver`、`highlightWidth`、`qilianRiver`、`qilianWidth`、`ui.showHighlight`、`ui.showQilian`、`ui.showRiverLabels` 在读入时直接丢弃。

## 皮肤

`vector-paint.js` 的 `SKINS` 通过 `paint.water` / `waterway*` 给上面的图层上色；切皮肤会把 `lakeFill` 与 `riverLevel1/2/3` 写回水系面板（保留原 alpha）。

## 想要自己的水系数据

用你有权使用的 GeoJSON 自己加 source 和 layer 即可，仓库不再提供加载器。参见根目录 `DATA-PROVENANCE.md`。
