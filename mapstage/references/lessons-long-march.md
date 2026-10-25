# 长征系列地图经验

本页总结长征 14 期 + 全线连贯版、四渡赤水战役、MAPSTAGE 教程三条视频线里**和地图有关**的经验。每条后面是出处（视频工程里的记录文件，路径相对 `video/`）。MapStage 的默认规则大多来自这里。

## 先说结论

1. **长征系列没有用 MapStage。** 它跑的是 cz_render：Python story → `ep_data_*.js` → three.js（r169）页面 + 离线烘焙底图 JPG / 高程 → Playwright 分层截帧 → ffmpeg 合成。四渡赤水是 Remotion + MapLibre 的共享地图组件。MapStage 只在河西走廊和 MAPSTAGE 教程里用过。三套管线之间没有共用的适配层。
2. **每期复制一份 pkg。** 公共包 `_common` 在规划里（`长征/剩余12期规划.md` 第四节 I7），14 期仍是复制粘贴；ep01 的引擎还是从另一个系列迁来的，带着别的系列的配色残留。
3. 能复用的不是那套管线，而是**数据格式、规则、镜头算法和图元语义**——这正是 MapStage 的 Story 层要收的东西。
4. 地图被平台审核卡过三次（ep03 画面、ep11 封面、ep14 v3），合规必须是默认值，不能靠每期记得。

## 渲染管线

- 地图层 `m#####.jpg` 与 HUD 层 `h#####.png` 分开截，ffmpeg 合成。（`长征/ep01/cz_render/render.py`、`shoot_v4.py`、`composite.py`）
- 每集独立 LCC 投影（ep01 300 m/px，ep13 起 500 m/px），底图与高程离线烘焙，不用在线瓦片。（`长征/ep01/cz_render/src/geo.py`）
- 数据源：Terrarium DEM（z9–z14）、HydroRIVERS（水系）、OSM / Nominatim（地名，部分结果错，要手改）、Wikimedia Commons 公有领域照片。（`长征/ep02/修改说明_v2.md` 第九节、`长征/ep13/PROGRESS.md`）
- 水系曾复用本仓库的 `water-data.js` 三级河流重绘底图（该数据包已移除，现用 OpenFreeMap 矢量水系）。（`长征/ep02/PROGRESS.md` r15）
- 底图 LUT 在与上一期重叠区由 Python 标定，不手调。（`长征/ep03/work/map/mk/build_base.py`）
- 2026-10-17 全线总图放弃卫星图（用户反馈：带现代建筑），改程序化自然底图。（`长征/full/PROGRESS.md`）

## 地图视觉

- 配色：纸底 `#dacba8`、红军 `#c0272d`、国民党军 `#5f7182`、西路军 `#7a1430`、标签字 `#3a2412`。（`长征/ep02/shotlist_v2.md`、`ep14/pkg/cz_render/src/_ep14_head.py`）
- 字体：马善政（省名）、霞鹜文楷（标签）、Noto Serif SC Bold（大数字）；省名 72 / 56 / 40 px 按层级。（`长征/ep02/PROGRESS.md` r6）
- 河宽按实际宽度收窄（3.4 / 2.2 / 1.4 px）；500 m/px 大底图上不叠 river 图元，否则晕成大片蓝。（`长征/ep13/PROGRESS.md`）
- 河线先做屏幕空间 Chaikin 平滑；河段不能收细，否则首尾相接成一串蓝点。（`长征/ep02/PROGRESS.md` r12）
- 季节皮肤：烘焙 `skin.png`（R 海拔 / G 坡度 / B 水体），按日期关键帧插值稻田、落叶林、雪线。（`长征/ep07/PROGRESS.md`、`长征/连贯版_重编总纲.md` 第五节）
- 地图与三维之间用深褐叠暗过渡；两边雾色要一致，否则整屏跳色。（`长征/剩余12期规划.md` 第一节）

## 合规（审核整改）

- ep03 抖音判「画面」违规后定规：全片不画省界国界，不加雾化和暗角；出全图时台湾、海南、海岸线完整。（`长征/AGENTS.md`）
- ep14 v3 因雾化 + 省界 + 暗角未过审，v4 全部删除；2026-10-18 全 14 期统一清理，省名保留。（`长征/ep14/PROGRESS.md` v4、`长征/full/PROGRESS.md` 第四轮）
- ep11 封面与第 0 帧陷水举手被判违规：封面与片头 3 秒不放陷人、溺水、倒地、尸体。（`长征/ep11/PROGRESS.md` 审核）
- 文案同样被审：惨烈细节改写，三维里也不画。（`长征/full/PROGRESS.md`、`长征/ep02/修改说明_v2.md` 第七节）

→ 落到 MapStage：[合规](compliance.md)，默认开启 + 自检。

## 镜头

- 机位由口播反算：`camfit.py` 按当句主体求最小视距，投影到安全区 `(0.06, 0.22, 0.94, 0.78)`，默认俯角 40°。（`长征/ep14/pkg/cz_render/src/camfit.py`）
- 一句最多一次有目的移动，到位稳住；去掉无目的偏航后机位 59 → 38。（`长征/ep02/PROGRESS.md` r8）
- 到位后缓推（视距缩 6–7%）+ 俯仰 3°；垂直夸张 2.0，3.4 会把山变成尖刺。（`长征/ep02/PROGRESS.md` r11）
- 全线总览 `maxw` 默认 3400 不够，整条长征要 16000。（`长征/ep12/PROGRESS.md`）
- 「地图平淡」是画面没变化，不是地形不够起伏；夸大地形被否，改用 tint、印章、跟飞、拉远、压暗。（`长征/ep04/PROGRESS.md` r7）
- 窄谷（腊子口）方位放宽到 180°、俯角 55–65°；日志出现 relax / WIDEN 的机位必须拍静帧。（`长征/ep12/PROGRESS.md`）
- 三维窗：相邻机位距离 > 25 m 才压暗，坡道 0.9–0.95 s；人物机位 ≥ 11.5 m。（`长征/ep09/PROGRESS.md`、`ep10/PROGRESS.md`、`ep11/PROGRESS.md`）

→ 落到 MapStage：[镜头](camera.md)。

## 动线与图元

- 路线 `cv()` 自然三次样条加弧，只给两点或近共线（≤ 0.4°）的线加；河段与封锁线保持真实线形。（`长征/ep02/PROGRESS.md` r11）
- 颜色表示「谁的行动」：猜测的红军去向也用红色虚线；敌方一律灰蓝；箭头牌子与箭头同色。（`长征/ep06/PROGRESS.md` r4）
- 敌军箭头起点只标方位示意，不点名不标番号；番号分实 / 互证 / 一说 / 综述四级。（`长征/ep05/enemy_movements.md`）
- 两军调动表列：段 / 方 / 番号 / 动作 / 时间 / 分级 / 出处。（`长征/ep03/enemy_movements.md`）
- 箭头和行军线的 hold 按段末收，不拖进下一段。（`长征/ep13/PROGRESS.md`）
- 会师：两队取景取中点，来路末端截到离主路最近的点再接驳。（`长征/ep10/PROGRESS.md` 达维会师）
- 图元清单：place / route / arr / march / unit / clash / chip、cz_card（名字卡）/ cz_stamp（印章）/ cz_pair（大字数字）/ cz_tbl（速查表，逐格点亮、片尾整表定格）/ cz_pho（照片卡）/ cz_tele（电报）/ cz_doc（文献）。新图元必须登记进渲染顺序表，否则静默不画。（`长征/ep14/pkg/cz_render/src/_ep14_head.py`、`长征/ep02/PROGRESS.md` r12）
- 坐标：`PL = {地名: (lon, lat)}`，`APPROX` 集合标「位置约」；时间轴来自 `timing_full.json` 的 segs。（`长征/ep14/pkg/cz_render/src/_ep14_map.py`）
- 无可靠照片用名牌；非当地当时的照片注「资料照」。（`长征/ep10/PROGRESS.md`）

四渡赤水补充的表达纪律（`四渡赤水战役/AGENTS.md`、`*画面表达重构方案.md`、`*routeId画面角色分级表.md`）：

- 河名、城名、城池图标一旦出现不得消失，只切普通 / 激活 / 变暗。
- 路线角色 `primary / reaction / background / residual / calloutOnly`；每段最多 1 条红军 primary、1–2 条敌方 reaction。
- 同屏部队名牌 ≤ 2、功能标签 ≤ 2、战略弹窗 1 个且 ≤ 3 行。
- sprite 必须全实，不用透明度表达弱化；canvas 只画河线、雾、粒子、电波，不手画城市和部队。
- 坐标 WGS84，A / B / C 可信度，C 级不得精确落点。
- 已验收素材只新建版本、不覆盖；以 manifest 为准，不凭文件名取用。
- 注意：代码里的角色枚举（`main-action / feint / pursuit …`）和文档（`primary / reaction …`）已经漂移——这正是要有单一规范的原因。

→ 落到 MapStage：[叙事 Story](story-spec.md)。

## 踩坑

- inset 路线先按 2.5 px 拆段再投影，否则相机身后的端点被夹到近平面，红线斜穿画面。（`长征/ep03/PROGRESS.md` r19）
- 所有地点离底图边缘 > 400 px，否则露出灰色远景。（`长征/ep05/PROGRESS.md`）
- `hideTerrain` 的时间范围必须逐窗口对齐，写成一条会把中间地图段的地形也隐掉。（`长征/ep04/PROGRESS.md`）
- 白天加色精灵 + 点光源过曝成彩虹圈：精灵乘 `(1.1 − 0.65·LUM)`，点光源乘 `max(0.12, 1.3 − 1.25·LUM)`。（`长征/ep12/PROGRESS.md`）
- Blender Base Color 是线性值，glTF 按线性读，要统一 sRGB → 线性，否则人物被提亮成白块。（`长征/ep03/PROGRESS.md` r19）
- meshopt 会把平移烤进节点，直接覆盖 position 会拉回原点；path 的 key 是相对 s0 的偏移。（`长征/ep03/PROGRESS.md`、`ep12/PROGRESS.md`）
- 速度：骑兵 70 m/s 太快改 8 m/s；步兵走近距离也要压。（`长征/ep12/PROGRESS.md`、`ep07/PROGRESS.md`）
- 程序化细纹理远处混叠成白噪点，只在 1080 整帧上暴露；用 `fwidth` 远处淡出。（`长征/ep11/PROGRESS.md`、`ep12/PROGRESS.md`）
- 点精灵 0.55 m 糊成白条，改 0.10 m + 7 px 上限、密度 ×0.4。（`长征/ep10/PROGRESS.md`）
- heredoc 里的 `\n` 会被展开截断代码；压成一行的 JS 里写 `//` 注释会整页报错。（`长征/ep12/PROGRESS.md`、`ep14/PROGRESS.md`）

## 渲染与 QA

- 预览 960×540@10，终版 1920×1080@30 crf18；预览 5–15 分钟 / 期，终版 35–50 分钟 / 期。（`长征/ep14/PROGRESS.md`、`ep13/PROGRESS.md`）
- `shoot_v4` 跳过已存在的帧：改了模型不删旧帧会混进旧画面；局部掉帧用 `--i0 / --i1` 重拍再拼接。（`长征/ep14/PROGRESS.md`、`ep12/PROGRESS.md`）
- GPU 光栅化长序列返回旧 tile：固定 `--disable-gpu-rasterization`。（`长征/ep01/cz_render/shoot_v4.py`）
- 硬切判据：0.1 s 取样差值 > 28；整表淡出 0.45 s 会被判硬切，1.3 s 才过。（`长征/ep07/PROGRESS.md`、`full/PROGRESS.md`）
- 大底图 inset 单张约 680 MB，与渲染并行 OOM，`-j 1`；瓦片下载无超时会卡 15 分钟。（`长征/full/PROGRESS.md`、`ep08/PROGRESS.md`）
- 前 5 秒不放回顾或空地图，第 0 帧压大数字加重击。（`长征/ep03/PROGRESS.md` r20）

→ 落到 MapStage：[宿主与渲染](hosts.md)。

## MapStage 在视频里的实际用法

- 生产宿主 `scene/serve.py`（`127.0.0.1:8767`），把 `/mapstage/` 映射到 skill 的 `tuner/`；端口已 200 就复用，禁止无故 `--force-new`。（`MAPSTAGE教程/AGENTS.md`）
- 调参用线上调参台，导出 v3 JSON 写入 `scene/preset.json`；`route.json` 含 line / stops / shots / follow（zoom、pitch、lookAheadKm）。（`MAPSTAGE教程/scene/`）
- 页面暴露 `window.__mapstageSeek(t)` 与 `window.__timelines[id]`，HyperFrames 逐帧驱动；没有宿主时自播。（`MAPSTAGE教程/scene/app.js`）
- skill 只装在 `.grok/skills/mapstage`，`.claude/skills` 下没有——换 agent 就断。

## 抽象成 MapStage 能力

| 长征 / 四渡里的做法 | MapStage 对应 | 状态 |
|---|---|---|
| route + cv + draw / hold | `routes[]` + `addRoute` | 原型（MapStageKit） |
| camfit.fit + Rig 缓推 | `shots[].fit` + `cameraAt` | 原型 |
| place / pname 三态、APPROX | `sites[]` + `beats[]` + `addLabel` | 原型 |
| 合规清理 | `complianceCheck` + 默认底图 | 原型 |
| shoot_v4 分层截帧 / 续拍 / 局部重拍 | Stage 截帧器 | P2 |
| enemy_movements 分级表 | `routes[].confidence` + 番号分级 | 规范已定 |
| cz_card / stamp / pair / tbl | `cards[]` | P1 |
| 季节皮肤 skin.png | Look 层季节关键帧 | P3 |
| 三维窗协议（hideTerrain、叠暗、plan / shot3） | Stage 转场 | P3 |
| QA 阈值（硬切、冻帧、露底） | Stage QA | P2 |
