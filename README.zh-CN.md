# MapStage

[English](README.md) | **中文**

面向中国历史地图与短视频制作的开源 **古卷羊皮纸** MapLibre 方案（HyperFrames 或其他 MapLibre 宿主均可）。

## 在线演示

**→ https://hopechen067.github.io/MapStage/**  
交互调参器（EOX 卫星底图 + Mapterhorn 地形需联网。无需安装。）

### 演示视频

本栈在真实地图叙事片中的效果示例（**河西走廊 · 河西四郡**）。低分辨率短片，由 GitHub Pages 提供流式播放：

https://hopechen067.github.io/MapStage/media/hexi-ep07-demo-480p.mp4

<video
  controls
  playsinline
  preload="metadata"
  width="720"
  src="https://hopechen067.github.io/MapStage/media/hexi-ep07-demo-480p.mp4">
</video>

更长片段（约 36 秒）：[showcases/hexi-ep07/hexi-ep07-map-clip.mp4](showcases/hexi-ep07/hexi-ep07-map-clip.mp4)

## 更新说明

- **地图 / 地球** 投影切换；卫星与海拔设色互相独立；可选区域拆出（独立地形块）。
- 山影与三维地形改为 **Mapterhorn** DEM（原先为 AWS Terrarium）。
- 水系用 OpenFreeMap 矢量水；中国水系包不再随仓库分发。
- 古卷 CSS 滤镜可开关；复制 JSON 含当前相机与资源开关。
- 开源仓库更名为 **MapStage**。

## 效果展示

河西四郡成片静帧，以及当前调参器截图。

<table>
  <tr>
    <td align="center" width="50%">
      <img src="showcases/hexi-ep07/still-01-open.jpg" alt="武威 · 绿洲与石羊河" />
      <br /><sub>武威 · 绿洲 / 石羊河</sub>
    </td>
    <td align="center" width="50%">
      <img src="showcases/hexi-ep07/still-03-commanderies.jpg" alt="酒泉 · 地形与水系" />
      <br /><sub>酒泉 · 地形 + 水系</sub>
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <img src="showcases/hexi-ep07/still-02-corridor.jpg" alt="走廊视角" />
      <br /><sub>河西走廊地图镜头</sub>
    </td>
    <td align="center" width="50%">
      <img src="showcases/hexi-ep07/still-05-close.jpg" alt="近景城站" />
      <br /><sub>城站近景</sub>
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <img src="showcases/preview-tuner-china.jpg" alt="调参器全国地图视角" />
      <br /><sub>调参器 · 全国 / 地图投影</sub>
    </td>
    <td align="center" width="50%">
      <img src="showcases/preview-tuner-hexi.jpg" alt="调参器河西三维地形" />
      <br /><sub>调参器 · 河西俯仰</sub>
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <img src="showcases/preview-tuner-globe.jpg" alt="调参器地球投影" />
      <br /><sub>调参器 · 地球</sub>
    </td>
    <td align="center" width="50%">
      <img src="showcases/preview-tuner-isolate.jpg" alt="调参器拆出中国" />
      <br /><sub>调参器 · 拆出中国</sub>
    </td>
  </tr>
</table>

更多文件：[showcases/hexi-ep07/](showcases/hexi-ep07/)

| 项目 | 说明 |
|------|------|
| Skill 目录 | `china-antique-maplibre` |
| 运行时 | [MapLibre GL JS](https://maplibre.org/) |
| 默认底图 | **EOX Sentinel-2 cloudless**（公开演示 WMTS，请自行遵守图源条款） |
| 地形 / 山影 | **Mapterhorn** DEM（运行时拉取；Terrarium 编码） |
| 水系 | OpenFreeMap 矢量水；可选中国水系包**不随仓库分发** — 见 [DATA-PROVENANCE.md](DATA-PROVENANCE.md) |
| 风格 | 古卷 CSS 调参、地图/地球、拆出地形块、`HanCity3D` 城池 |
| 许可证 | 代码/文档 [MIT](LICENSE)；展示媒体与第三方条款见 [LICENSE-EXCEPTIONS.md](LICENSE-EXCEPTIONS.md) / [NOTICE.md](NOTICE.md) |
| 在线演示 | [在线演示](https://hopechen067.github.io/MapStage/) — Pages 将 `china-antique-maplibre/tuner` 发布到站点根路径 |

## 快速拉取（安装）

### 1）克隆仓库

```bash
git clone https://github.com/hopechen067/MapStage.git
cd MapStage
```

之后更新：

```bash
cd MapStage
git pull
```

### 2）安装为 Agent Skill（复制目录）

Skill 本体在 `china-antique-maplibre/` 文件夹。把它复制到你的 agent skills 目录，然后重载 skills。

**Windows（PowerShell）** — 按你用的宿主选路径：

```powershell
# Grok 等常用用户 skills 目录
$src = ".\china-antique-maplibre"
$dst = Join-Path $env:USERPROFILE ".grok\skills\china-antique-maplibre"
New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null
Copy-Item -Recurse -Force $src $dst
```

```powershell
# Codex 用户 skills（若你用 Codex）
$src = ".\china-antique-maplibre"
$dst = Join-Path $env:USERPROFILE ".codex\skills\china-antique-maplibre"
New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null
Copy-Item -Recurse -Force $src $dst
```

**macOS / Linux：**

```bash
git clone https://github.com/hopechen067/MapStage.git
cp -R MapStage/china-antique-maplibre ~/.grok/skills/china-antique-maplibre
# 或：~/.codex/skills/china-antique-maplibre
```

一条命令（Unix：克隆 + 装 skill）：

```bash
git clone --depth 1 https://github.com/hopechen067/MapStage.git \
  && cp -R MapStage/china-antique-maplibre ~/.grok/skills/china-antique-maplibre
```

### 3）复制给 Agent 的话术

```text
请使用 china-antique-maplibre skill。
在线调参：https://hopechen067.github.io/MapStage/
仓库：https://github.com/hopechen067/MapStage
我会在 demo 里调好风格后导出 JSON，请按 SKILL.md / references 应用到地图场景（jumpTo + idle，encoding terrarium）。
```

风格流程：打开 [在线演示](https://hopechen067.github.io/MapStage/) → 调参 → **复制 JSON** → 粘贴给 agent。

## 快速开始（本机调参）

仅在你要**本机离线**跑调参器时需要；用公网 demo 可跳过。

```bash
cd china-antique-maplibre/tuner

# 方式 A — Python 3
python -m http.server 8765

# 方式 B — Node
npx --yes serve -l 8765
```

服务启动后在本机打开：`http://127.0.0.1:8765/`  
公网分享请用 [在线演示](#在线演示)。

**不要**用 `file://` 打开 `index.html`。

可选检查：

```bash
cd china-antique-maplibre/tuner
node verify.mjs
```

## 功能

- **可配置栅格底图** — 默认 [EOX Sentinel-2 cloudless](https://s2maps.eu)；其他源用 gitignore 的 `map-tiles.config.local.js`。
- **Mapterhorn 山影 + 三维地形** — Terrarium 编码；地图/地球投影；可选区域拆出。
- **矢量水系** — OpenFreeMap / OpenMapTiles。可选中国水系包**不**随仓库再分发（自备数据；见 DATA-PROVENANCE.md）。
- **古卷 CSS 调参** — sepia / 暖调 / 暗角 / 画笔；滤镜可关；导出 JSON 预设。
- **城池分级** — 都城 / 大城 / 中城 / 小城 / 关隘 / 驿站 / 都护等。

## 配置地图瓦片

1. 阅读 [NOTICE.md](NOTICE.md)。
2. 默认：`tuner/map-tiles.config.js`（EOX + Mapterhorn）。
3. 个人端点：`map-tiles.config.local.js`（不提交）。见 `map-tiles.config.example.js`。

EOX 公共瓦片多为非商用 + 需署名（约 10 m）。本项目不授予任何商业图商权利。

## 瓦片不随仓库打包

卫星与 DEM 仅在运行时按配置请求。

## 署名与合规

- 遵守所用底图 / DEM / CDN 条款。
- **水系数据：** 本仓库不附带；你本地放入的数据包仍适用你自己的许可 — [DATA-PROVENANCE.md](DATA-PROVENANCE.md)、[LICENSE-EXCEPTIONS.md](LICENSE-EXCEPTIONS.md)。
- **MapLibre / Three.js：** 再分发时遵循其许可证。
- **展示图：** 默认保留权利的演示媒体（见 [LICENSE-EXCEPTIONS.md](LICENSE-EXCEPTIONS.md)）。

## 安装为 Agent Skill

1. 将 `china-antique-maplibre` 复制到 skills 目录。  
2. 重载 skills，使 `SKILL.md` 生效。  
3. 让 agent 应用古卷地图栈、打开调参器或迁移导出预设。

## 目录结构

```
.
├── LICENSE
├── LICENSE-EXCEPTIONS.md      # 展示媒体 / 第三方 / 自备地理数据（非 MIT）
├── NOTICE.md
├── DATA-PROVENANCE.md
├── SECURITY.md
├── README.md / README.zh-CN.md
├── showcases/                 # 文档用截图与示例帧
└── china-antique-maplibre/
    ├── SKILL.md
    ├── agents/openai.yaml
    ├── references/
    ├── schemas/
    └── tuner/                 # 发布到 GitHub Pages 站点根路径
```

## 贡献 / 安全

- 优先小而清晰的改动。  
- 勿提交 API key 或 `map-tiles.config.local.js`。  
- 见 [SECURITY.md](SECURITY.md)。

## 延伸阅读

- [`china-antique-maplibre/SKILL.md`](china-antique-maplibre/SKILL.md)  
- [`china-antique-maplibre/references/参数列表说明.md`](china-antique-maplibre/references/参数列表说明.md)  
- [`china-antique-maplibre/references/tuner-workflow.md`](china-antique-maplibre/references/tuner-workflow.md)  
- [`china-antique-maplibre/references/tested-config.md`](china-antique-maplibre/references/tested-config.md)  
