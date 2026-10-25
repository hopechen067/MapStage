# MapStage

历史视频的叙事地图引擎 + agent skill（MapLibre）。官网：https://hopechen067.github.io/MapStage/ 。规划与阶段见 `mapstage/references/roadmap.md`。

本文件是所有编码代理（Claude Code、Grok、Cursor 等）共用的项目规则；`CLAUDE.md` 只引用本文件。

## 这是什么

静态 HTML/JS。CDN：`maplibre-gl@5.6.0`，部分页 `three@0.160.0`。自定义 CSS `:root` 变量。三块工作面：

- `mapstage/site/`：官网（首页 / 文档壳 / 示例），部署为 Pages 根。文档内容不写在 site 里，直接渲染 `references/*.md`。
- `mapstage/tuner/`：调参台 Studio，部署在 `/studio/`。只调参，不做渲染宿主。
- `mapstage/references/` + `SKILL.md`：skill 规范，agent 和官网读同一份。

**没有** Next/Vite/Tailwind，**没有**应用级 `package.json` 构建步骤。引入打包器或第一个 npm 运行时依赖是重大决策，必须单独论证。

## 起服

官网：`node mapstage/site/serve.mjs`（默认 8770，布局与 Pages 一致：`/studio/` → tuner，`/references/` → references）。只调调参台时，在 `mapstage/tuner/` 下 `node _serve.cjs`（默认 8765，`PORT=8766 node _serve.cjs` 换端口）或 `python -m http.server`。先看端口上是否已有服务在跑，有就复用。这是本仓库正常工作方式，不是视频线禁止的「把 http.server 当 HyperFrames 观看地址」。

## 校验

不是 vitest/jest，全是纯 `node:assert` 脚本。以下命令在 `mapstage/tuner/` 下运行：

- **静态总校验**：`node verify.mjs` —— 检查必需文件、跑 `isolate-skirt-seam` / `map-fx` / `tuner-modules` 与官网 `md` / `stage-kit` 单测、检查 site 示例与文档源齐全、检查 tuner / site / references / SKILL 文本是干净 UTF-8。改完代码至少跑这个，末尾应为 `verify ok`。
- **单个单测**：`node assets/<name>.test.mjs`。`region-isolate*.test.mjs`、`terrain-island.test.mjs` 不在 verify.mjs 里，改到相关模块时单独跑。
- **浏览器实测**：先起服，再 `node ../runtime/verify-*.mjs http://127.0.0.1:<port>`。Playwright 由 `runtime/lib/pw.mjs` 自动从仓库根 `.preview-tools/node_modules` 找；截图输出到仓库根 `out/`（已 gitignore）。跑之前先看 `runtime/` 里实际有哪些脚本。官网冒烟 + 示例缩略图：起 `site/serve.mjs` 后 `node ../runtime/site-thumbs.mjs http://127.0.0.1:8770`。
  - 调参台类脚本的 URL 指向 `tuner/_serve.cjs` 的根（如 `http://127.0.0.1:8765`），它带 `/t/` 瓦片代理；宿主类（`verify-qa` / `verify-render` / `verify-shoot` / `verify-story-hexi`）指向 `site/serve.mjs` 的根。用 `site/serve.mjs` 的 `/studio` 跑调参台脚本会有假失败。
  - 多个浏览器同时跑会让地形等待超时（假失败），全量时按顺序跑。`verify-vector-overlay` 约 7.5 分钟、`verify-shoot` 约 3 分钟。
  - `verify-qilian-terrain`、`verify-vector-layers` 大量拉外网瓦片，网络慢时会超时或报图片加载失败，失败先看是不是网络。代理 / 同源相关的检查只在有本地 `map-tiles.config.local.js` 走 `/t/` 时才做。

## CI 只在本地跑

本项目不在 GitHub 上跑 CI（GitHub Actions 已停用，账户额度不可用）。

- 不要新增或改动 `.github/workflows/` 来跑测试、校验或构建；不要等、不要轮询、也不要去修 Actions 上的 check。
- PR 合并前的校验全部在本地跑，按上面「校验」一节：至少 `node verify.mjs`，加上相关单测和浏览器实测，结果写进 PR 描述。
- GitHub 上 PR 没有 check、或 Actions 显示失败 / 未启动，不算阻塞，也不要据此判断代码有问题。
- 私有仓库没有部署工作流，合到 `master` 不会上线官网；发布见下面「发布」。

## 编码（Windows 上踩过坑）

- 所有文本文件是 **UTF-8 + LF**（见 `.gitattributes`）。仓库里大量中文，曾两次被存成 GBK/CRLF 乱码。
- 不要用 PowerShell 的 `Set-Content` / `Out-File` / `>` 重定向写源码文件；用编辑工具或 Node 以 `utf8` 写入。
- 改完含中文的文件后跑 `node verify.mjs`，它会查出乱码。

## Git

- `origin` 是私有仓库，可以推；`public` remote 是公开仓库，push 已禁用，不要改动它、不要往它推。
- 私有仓库没有 Pages，推 `master` 不触发任何部署。
- `.preview-tools/`、`out/`、`promo/`、`tuner/_serve.*`、`*.local.js` 都是本地文件（gitignored），不要提交；`map-tiles.config.local.js` 可能含私人瓦片地址，不要外传。

## 发布（本地构建）

官网 https://hopechen067.github.io/MapStage/ 由**公开仓库** hopechen067/MapStage 提供，私有仓库没有 Pages。

- 构建：`node mapstage/site/build.mjs` → 仓库根 `out/_site`（布局同 `site/serve.mjs`，只拷 git 跟踪的文件，排除本地配置、测试、`water-data.js`）。
- 许可闸门：`region-isolate-data.js` 若再含 geojson.cn 图集数据（许可未确认）则拒绝构建；`--private` 只用于本地预览，产物不得外发。中国轮廓现已只用 Natural Earth（2026-10-25），闸门作为防回退保留。
- 预览：用任意静态服务器起 `out/_site`，再跑 `node mapstage/runtime/site-thumbs.mjs <URL>` 冒烟（它会重写 `site/examples/thumbs/*.jpg`，只是冒烟就别提交）。
- 上线要把产物推到公开仓库，必须用户逐次明确同意，且许可闸门通过。

## 视频线怎么用

视频工程复用本库，不要在单集里再叉一份。

skill 装在 `~/.claude/skills`、`~/.grok/skills`、`~/.codex/skills` 下的 `mapstage/`，都是安装副本，不要在那边改。改完仓库里的 `SKILL.md` / `references/` / 运行时后跑 `node mapstage/install-skill.mjs`（先 `--dry-run` 看会删哪些旧文件）同步三处。
