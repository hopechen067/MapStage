# 路线图

2026-10-19 重新规划。起因：总结长征系列时发现，地图类视频的三条管线（cz_render、Remotion 四渡赤水、MapStage）各写一套，规则散在各集的 PROGRESS 里，MapStage 本身也有四个名字、两个编辑器入口、公私两版漂移。经验原文见 [长征系列地图经验](lessons-long-march.md)。

## 定位

**MapStage = 历史视频的地图舞台。** 一个 MapLibre 引擎 + 一个 agent skill，三层：

- **Look 底图**：preset v3，调参台导出。
- **Story 叙事**：story.json v1，地点 / 路线 / 地名节拍 / 镜头 / 字卡 / 合规。
- **Stage 舞台**：`seek(t)` 时间契约 + 截帧与 QA。

不做：交互式 Web 地图产品、付费货架、导航与测绘。

**例外：Play 游戏地图**（2026-10-24 起）。给做游戏、做互动页的人提供同一张古卷地图（`MapStageBoard`）：MapStage 只管地图，规则由使用者自己写。不做通用交互地图产品，完整商业游戏也不在 MapLibre 上做，见 [游戏地图](play.md)。

## 已定的决策

| 决策 | 结论 |
|---|---|
| 主线仓库 | 私有仓库为源，目录与 skill 改名 `mapstage`；公开仓库 hopechen067/MapStage 只做发布副本 |
| 名称 | 只叫 MapStage。「china-antique-maplibre」「古卷地图」「一卷山河」「古地图色调调参器」全部退役 |
| 官网 | 参考 MapLibre：首页 / 文档 / 示例 / 调参台。删除定价、目录、货架、成片页 |
| 文档来源 | 官网文档直接渲染 `references/*.md`，人和 agent 读同一份，不再维护两份 |
| 语言 | 中文为主，标题与 API 名附英文 |
| 构建 | 仍然没有打包器、没有 npm 运行时依赖；MapLibre 固定 5.6.0 |

## 站点结构

| 路径 | 内容 | 源 |
|---|---|---|
| `/` | 首页：活地图 hero（可拖时间轴）、三层、一句话出片、内置规则、示例、宿主、作品 | `site/index.html` |
| `/docs/?p=…` | 文档（侧栏 + 本页目录 + 翻页） | `site/docs/index.html` + `references/*.md` |
| `/examples/` | 示例库，按 Look / Story / Stage / Play 筛选，每个示例一页、带源码 | `site/examples/` |
| `/studio/` | 调参台（原 tuner），只调参不渲染 | `tuner/` |

本地：`node mapstage/site/serve.mjs` → `http://127.0.0.1:8770/`，布局与 Pages 一致。

## 阶段

### P0 · 规划 + 官网 + skill 重写（本次）

- [x] 长征 / 四渡赤水 / MAPSTAGE 教程地图经验总结
- [x] 新官网：首页、文档壳、8 个活示例、示例库
- [x] 文档：介绍、快速上手、安装、Look、Story 草案、镜头、合规、宿主、API、经验、路线图
- [x] `SKILL.md` 重写为路由式（三层 + 硬规则 + 引用）
- [x] 删除旧货架页（home / browse / fx / edit / install / pricing / legal / showcase、catalog）
- [x] Pages 部署改为 `site/` 为根、`tuner/` 进 `/studio/`、`references/` 随站发布

### P0.5 · 改名与同步

- [x] 目录 `china-antique-maplibre/` → `mapstage/`；部署工作流、`AGENTS.md`、校验脚本路径同步
- [~] v3 preset 与 schema 已升（结构沿用调参台的 `maplibre` 键，schema 兼容 `mapstage` 键）；Mapterhorn 默认 DEM、OpenFreeMap 矢量水系已在 tuner 中
- [x] 默认 preset `vignetteStrength` 改 0（合规）
- [ ] skill 同时装到 `~/.claude/skills`、`~/.grok/skills`、`~/.codex/skills`
- [ ] 公开仓库同步（只推发布副本，不推私有内容）

### P1 · Story 运行时

- [x] `tuner/assets/mapstage-story.js`：`MapStage.mount(el, { preset, story })`、`seek(t)`、`precache()`、`check(t)`
- [x] `validateStory`：引用完整、C 级坐标必为 approx、同屏上限、hold 不越段、一句一动
- [x] 路线角色画法（primary / reaction / background / residual / callout）
- [x] 字卡 `cards[]`：place / name / stamp / pair / table / photo / telegram / doc（八种都有专门版式；table 逐格点亮、telegram 逐字出现，均只取决于 t）
- [x] `schemas/story.schema.json` + Node 单测
- [x] 把 MapStageKit 的原型能力迁进来，示例改用正式运行时

验收：用 story.json 重做「河西走廊 · 武威 → 敦煌」，与 MAPSTAGE 教程成片对比；同屏上限违规时拒绝渲染。

### P2 · 舞台：宿主适配与 QA

- [x] Playwright 截帧器：分层、断点续拍、`--i0/--i1` 局部重拍、GPU 光栅化关闭（`runtime/shoot.mjs` + `site/host.html`，验收 `runtime/verify-shoot.mjs`）
- [x] Remotion 组件模板（`templates/remotion/MapStageScene.tsx`，iframe + postMessage，实测与截帧同帧）；HyperFrames 实测不接活地图（`live_map_detected`、黑底），改走烘焙视频合成（`templates/hyperframes/index.html`，见 hosts.md）
- [x] QA：硬切 / 冻帧 / 露底检测、合规逐帧自检、四类导出帧（`runtime/qa.mjs`，验收 `runtime/verify-qa.mjs`）
- [x] 960 预览 → 1080 终版的两段流程（`runtime/render.mjs`，闸门验收 `runtime/verify-render.mjs`），已写进 map-history-episode skill 的 render-chain.md

## 下一步（2026-10-22 规划）

顺序：收口 → P1 验收 → P3。每项一个分支一个 PR；CI 只在本地跑（见 `AGENTS.md`）。

### 收口

1. [x] `runtime/` 浏览器校验脚本全量跑一遍，修掉过时脚本（已知 `verify-gansu-zhangye` 在 island 模式下仍断言遮罩可见；`verify-vector-overlay` 约 7.5 分钟，压时长或标成慢测试）；顺带清理 `tuner/_preview/` 下引用已删页面的脚本。目标：有一套可信的本地校验。（#21 已完成；2026-10-24 复跑 `verify-vector-layers` 通过，`verify-qilian-terrain` 修掉异步读值后通过）
2. [~] 合规与许可复核：按 [compliance.md](compliance.md) 核 #17 换上的边界（Natural Earth 10m 中国视角 + geojson.cn 图集补充），完成 `region-isolate-data.js` 的再分发许可复核（`DATA-PROVENANCE.md`）。2026-10-23 已复核：画面规则符合；十段线已在全图镜头渲染（#23）；geojson.cn 许可不明、审图号待定（见 compliance.md「边界数据复核」），数据暂不可公开分发。2026-10-24 定：先不上线，等要上线时再做公开版（建议只用 Natural Earth 轮廓）。 **2026-10-25：中国轮廓已改为只用 Natural Earth，geojson.cn 阻塞解除；剩审图号判断和公开仓库历史处理。**
3. [~] 发布方式：2026-10-24 定为本地构建（`node mapstage/site/build.mjs`，见 AGENTS.md「发布」），私有仓库的 Pages 工作流已删除（私有仓库本来就没有 Pages，官网在公开仓库）。实际上线仍卡在第 2 项的数据许可和公开仓库推送授权。原记录：Pages 自 2026-09 起未能部署（Actions 额度不可用），官网停在旧版。二选一：恢复 Actions 额度，或本地构建后推 `gh-pages` 分支（先实测是否同样依赖 Actions）。
4. [~] P0.5 余项：skill 装到三处 ✔（2026-10-24，`node mapstage/install-skill.mjs` 镜像同步，见 AGENTS.md）；公开仓库同步仍卡在第 2 项的数据许可。
5. [~] 零碎：`patch-zangnan-region.py` 已删（只是一行 print 的空壳，藏南由 `patch-china-boundaries.mjs` 处理）；本地备份分支 `backup/p05-wip-all` 已删（内容已全部在 master）；**#18 的拆出性能待用户亲手复测**，可与 P1 并行。

收口小结（2026-10-24）：能在私有仓库里做完的都已完成；剩下的公开上线一组（第 2、3、4 项后半）统一卡在 geojson.cn 许可，按决定延后。

### P1 验收

- [ ] 用 story.json 重做「河西走廊 · 武威 → 敦煌」，与 MAPSTAGE 教程成片对比；同屏上限违规时拒绝渲染。跑通 Story → 截帧 → QA → 两段出片全链路。

### P3 · 表现力

- [ ] 三维窗协议：叠暗过渡、雾色一致、机位规划兜底
- [ ] 会师、包围、切尾等战役模板
- [ ] 季节皮肤（海拔 / 坡度 / 水体烘焙 + 日期关键帧）
- [ ] 拆出侧壁台阶与竖刺（来自地形网格单元）：只在海岸附近加密网格（要改 patch 过的 MapLibre 网格生成和 `verify.mjs` 的 128 约束），或接受现状。待定。

### Play · 游戏地图（2026-10-24 新增）

重点是地图接口，游戏只是示例。文档见 [play.md](play.md)。

- [x] 地图接口 `tuner/assets/mapstage-board.js`：城池圈、连线、点选、行军动画、取景，复用 Story 运行时的底图与地名三态；单测 `mapstage-board.test.mjs` 进 verify
- [x] 示例「游戏地图 · 最小用法」（无规则）
- [x] 示例规则引擎 `tuner/assets/mapstage-play.js`：纯函数、seed 可回放；单测 `mapstage-play.test.mjs` 进 verify
- [x] 示例「三分天下 · 221 年」：17 城、魏蜀吴，征兵 / 调兵 / 攻城 / 电脑行动，存档 = seed + actions
- [ ] board 补齐：hover 提示框、多段路线（沿连线走多城）、地名之外的自定义图标、镜头跟随
- [ ] 地点数据：把常用朝代的城池坐标整理成可直接引用的数据包（坐标可信度照 Story 规则）
- [ ] 示例规则只在有人用时再加深（数值、难度、武将粮草）
- [ ] 对局回放成视频：actions → story 的 routes / beats → 现成截帧管线
- [ ] 决定是否另起 Godot / Unity 线（只在要做完整商业游戏时）：MapStage 改为导出古卷贴图、高度图、城池数据

## 遗留清理（已完成）

- [x] 调参台 `tuner-app.js` 的 `applyCatalogDeepLink` 仍去取已删除的 `catalog.json`（404 后 no-op，但 `?family=` 深链会跳过 localStorage 恢复）
- [x] `references/maplibre-official-gap.md`、`maplibre-optimization-and-enablement.md` 里指向已删页面的链接
- [x] `index.html`（调参台）引用不存在的 `_ref_handdrawn_preview.jpg`

未完成的三项（`_preview/`、许可复核、runtime 全量）已并入上面「收口」。

## 怎么提需求

在 GitHub 开 issue，写清楚：哪一层（Look / Story / Stage）、哪一集用到、期望画面（附截图或参考视频帧）。
