# 介绍

MapStage 是给**历史视频**用的叙事地图引擎，同时也是一个 agent skill。它基于 [MapLibre GL JS](https://maplibre.org/)，把「古卷底图 + 路线行进 + 镜头 + 合规」收成三份声明式 JSON，由宿主按时间逐帧取画面。

它从两条视频线的制作记录里长出来：河西走廊系列（MapStage 本体）和长征 14 期 + 四渡赤水（另两套管线，规则后来并入 MapStage）。经验原文见 [长征系列地图经验](lessons-long-march.md)。

## 三层

| 层 | 管什么 | 文件 | 规范 |
|---|---|---|---|
| **Look** 底图 | 长什么样：皮肤、地形、卫星、水系、拆出 | `preset.json`（v3） | [底图 Look](look.md) |
| **Story** 叙事 | 讲什么：地点、路线、阵营、地名状态、镜头、字卡 | `story.json`（v1 草案） | [叙事 Story](story-spec.md) · [镜头](camera.md) |
| **Stage** 舞台 | 第几秒画什么：时间契约与渲染宿主 | `window.__mapstageSeek(t)` | [宿主与渲染](hosts.md) |

三层互不越界：换皮肤不动叙事，改口播节奏不动底图，换宿主（HyperFrames / Remotion / Playwright）不动前两层。

## 什么时候用

- 做历史、地理、战役类视频的地图段：路线行进、会师、包围、地名点亮、全国定位。
- 需要**可复现**的地图镜头：同一个时间点永远同一帧，可以断点续拍、局部重拍。
- 需要过平台审核的中国地图画面（默认合规，见 [合规](compliance.md)）。

不适合：交互式 Web 地图产品、导航、精确测绘。MapStage 的地图是示意性的，不是权威边界。

## 组成

- **调参台 Studio**：`/studio/`，实时调底图、导出 preset。只调参，不做终版渲染。
- **运行时**：`tuner/assets/map-fx.js`（地形、预缓存、`jumpTo` + `waitIdle`）、`vector-paint.js`（皮肤与矢量图层）、`region-isolate.js`（拆出）。见 [运行时 API](api.md)。
- **Story 运行时**：`tuner/assets/mapstage-story.js`（`window.MapStage`），一份 story.json 挂成逐帧可复现的画面；游戏和互动页用 `mapstage-board.js`（`window.MapStageBoard`）。见 [运行时 API](api.md) 和 [示例库](../site/examples/index.html)。
- **Skill**：`SKILL.md` + 本目录 `references/`。agent 读的和你现在读的是同一份文件。

## 硬规则一览

1. 不画省界和国界，不加雾化和暗角；全图时台湾、海南、南海诸岛、海岸线完整。
2. 录制路径只用 `jumpTo` + 等 idle，不用 `easeTo` / `flyTo`；录制前先预缓存所有机位。
3. 一句口播最多一次有目的的镜头移动，到位后停稳。
4. 地名出场后不卸载，只切普通 / 激活 / 变暗。
5. 地形源 `encoding: "terrarium"`；调参台不是渲染宿主。

下一步：[快速上手](quickstart.md)。
