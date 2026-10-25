# 更新记录 · Changelog

版本号从 0.1.0 起追溯编排（2026-10-25 定），同时标注日期。规划与阶段见 [mapstage/references/roadmap.md](mapstage/references/roadmap.md)。

## 0.3.0 · 2026-10-25

### 数据与许可

- **中国轮廓只用 Natural Earth 10m（公共领域）**：`china`、`xizang`、`zangnan`、海域及岛群全部重建，`region-isolate-data.js` 里不再有 geojson.cn 数据。藏南取 admin-1 西藏南侧的中国视角陆地；钓鱼岛、黄岩岛取自 `minor_islands`；东沙、中沙、曾母暗沙在 Natural Earth 里没有多边形，做成按公开坐标的示意小标记。
- 重建脚本 `patch-china-boundaries.mjs` 改为只读 Natural Earth 四个文件；官网构建的许可闸门保留，防止旧数据回流。
- `DATA-PROVENANCE.md`、`NOTICE.md`、`LICENSE-EXCEPTIONS.md`、`compliance.md` 同步。公开仓库的 git 历史里仍有旧数据，未重写。

### 官网与发布

- 首页「用 MapStage 做的镜头」换成长征系列第 14 期《西路军》的 36 秒地图段；视频铺满 16:9，去掉右侧黑边；hero 地图卡片与标题顶部对齐。
- README（中英文）重写：定位改为叙事地图舞台，补官网结构、本地运行、数据说明；`showcases/` 换成长征第 14 期的静帧和片段。
- 公开仓库 hopechen067/MapStage 同步到当前版本；Pages 工作流改为用 `mapstage/site/build.mjs` 构建并发布整个官网。
- 新增 Cloudflare Pages 镜像：https://mapstage1.pages.dev/ （连公开仓库 `master`，自动构建）。
- Runtime：Story 里可以选底图风格并开夜灯（#34）。

## 0.2.0 · 2026-10-24

### 新功能

- **Play 游戏地图**：`MapStageBoard` 给做游戏、做互动页的人提供同一张古卷地图，附三国示例（#28）。
- **示例与 API**：每个功能一个示例页，加逐函数 API 参考（#29）。
- **十段线**：全国镜头画十段线，作为「不画国界」的例外（#23）。
- **Studio 底图风格**：不带卫星的底图风格，加模拟夜灯（#31）。
- **官网外观**：新 logo（山字 M）和统一的站点样式（#32）。

### 修复

- 取景（fit）考虑镜头倾角和方位（#30），示例缩略图重拍（#33）。
- 浏览器校验脚本全量跑过，修掉过时的（#21、#26）。

### 工程

- 官网改为本地构建 `node mapstage/site/build.mjs`，不再依赖 GitHub Pages 工作流（#24）；skill 镜像到三个本地 agent 目录（#25）。
- 边界数据合规复核记录（#22），路线图收口（#20、#27）。

## 0.1.0 · 2026-10-20 至 10-22

### 10-22

- **Studio**：面板分页、矢量调色、去掉水系数据包（#16）。
- **局部拆出（Isolate）**：完整的中国轮廓、海上岛群、Natural Earth 10m 海岸线（#17）；拆出时的裁剪窗口跟随相机，性能优化（#18）。
- 约定 CI 在本地跑，不依赖 GitHub（#19）。
- P0.5 基础合并：拆出边缘、运行时 P2、Story（#15）。

### 10-20

- **P0 官网与 skill 重写**：首页、文档、示例库，`SKILL.md` 改成按层路由（#12）。
- **改名 `mapstage/`**，发布 preset v3（#13）。
- **P1 Story 运行时**：`MapStage.mount`、`validateStory`、`story.json` v1、河西走廊示例（#14）。
