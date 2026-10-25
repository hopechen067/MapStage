# 宿主与渲染 Hosts

舞台层只有一个约定：**页面暴露 `seek(t)`，宿主按帧调用、等它 resolve 后截图。** 三种宿主都走这个约定，地图页面不关心是谁在调它。

## 时间契约 {#seek}

```js
window.__mapstageSeek(t)      // t 秒 → Promise，地图 idle 后 resolve
window.__mapstageDuration     // 总时长（秒）
```

- `seek(t)` 把镜头、路线进度、地名状态、字卡**全部**摆到第 t 秒，只依赖 t，不依赖上一帧。所以可以跳着拍、倒着拍、断点续拍。
- resolve 的时机是 MapLibre `idle`（瓦片加载完、没有动画）；12 s 超时放行并告警，不让一张慢瓦片卡死整条截帧。
- 录制前先把所有机位 seek 一遍（预缓存）。实测：冷缓存的第一遍和之后只有 1/8 帧逐像素一致；预缓存后正序、倒序重拍 8/8 一致。

示例：[逐帧时间契约](../site/examples/seek-contract.html)。

没有宿主时（本地预览）页面自播：`requestAnimationFrame` 驱动同一个 `render(t)`。

## HyperFrames

**不要把活地图直接放进 HyperFrames。** 实测（hyperframes 0.7.109）：

- HF 的确定性契约禁止实时地图，lint / render 会报 `live_map_detected`。
- 把 `__timelines[id].seek` 接到 `__mapstageSeek` 能通过注册检查，但 HF 不等 seek 返回的 Promise，也不等 MapLibre 加载。渲染出来是黑底，只有 DOM 字卡露出来。
- HF 只等 45 s 让时间线出现；冷缓存的 `mount + precache` 在 HF 的浏览器里超过这个时间，就会报 `sub_timeline_readiness_timeout`。

做法：地图先烘成视频，HF 只合成。

```bash
node runtime/render.mjs preview --story examples/story-hexi.json --out ../out/hexi   # 先出预览
node runtime/render.mjs approve --out ../out/hexi
node runtime/render.mjs final   --out ../out/hexi                                    # final.mp4
```

把 `final.mp4` 作为 `<video class="clip" src="map.mp4">` 放进 composition，标题、字幕、转场用 HF 自己的 clip。模板 `templates/hyperframes/index.html`，`hyperframes lint` 0 error 0 warning；实测 960×540@10fps 渲出的帧里，地图、地名、字卡、路线都在。

要无字卡的底图，用 `runtime/shoot.mjs --layers map` 单独拍地图层，字卡由 HF 自己的 DOM 重做。

生产宿主是视频工程里的 `scene/serve.py`（例如 `127.0.0.1:8767`，把 `/mapstage/` 映射到 skill 的 `tuner/`）。端口已 200 就复用，不要重复起服。

## Remotion

全片只放**一个**共享地图组件，Scene 只提供精灵、标签、弹窗、Canvas 特效层（四渡赤水的做法）。

现成组件 `templates/remotion/MapStageScene.tsx`：iframe 嵌 `site/host.html`，用 `postMessage` 驱动，不用把 MapLibre 打进 Remotion 的 bundle。

```tsx
<Sequence from={0} durationInFrames={16 * fps}>
  <MapStageScene hostUrl="http://127.0.0.1:8770" story="examples/story-hexi.json" />
</Sequence>
```

- `host.html?story=…&precache=1` 先把所有机位 seek 一遍，再发 `ready`；组件用 `delayRender` 等它（默认 300 s）。
- 每一帧发 `{source:'mapstage-host', type:'seek', t}`，等 `seeked`（地图 idle、标记与字体落定）后 `continueRender`；单帧默认 60 s 超时，超时 `cancelRender`，不静默拍坏帧。
- 协议见 `tuner/assets/mapstage-hosts.js` 头部。
- 实测（Remotion 4.0.484，960×540 单帧 38–40）：和 `shoot.mjs` 同一帧的平均像素差约 1.3/255（内容一致，细节有编码差）。

`npm run lint` 只证明工程链路没断，验收必须看实际帧。

## 两段出片：预览 → 终版 {#two-stage}

`runtime/render.mjs`。先出低清预览给人看，确认后才出 1080p。

| 命令 | 做什么 |
| --- | --- |
| `preview --story <json> --out <dir> [--audio a.mp3]` | 960×540@10fps 截帧 → QA → mp4（crf23）→ 接触表 `preview-contact.jpg` |
| `approve --out <dir>` | 记下确认的是哪一份 story + preset（指纹）。预览 QA 没过会拒绝，除非 `--allow-qa-fail` |
| `final --out <dir>` | 1920×1080@30fps，crf18。没确认、或确认之后 story / preset 又改过，直接拒绝，要求重出预览 |
| `status --out <dir>` | 看当前走到哪一步 |

`--layers map,hud` 用 ffmpeg 把地图层和 HUD 层叠合。`node runtime/verify-render.mjs http://127.0.0.1:8770` 校验这些闸门。

## Playwright 截帧

仓库自带截帧器 `runtime/shoot.mjs`，宿主页是 `site/host.html`（无界面，只铺 story 并暴露 `seek`）：

```bash
node site/serve.mjs &                                   # 8770
node runtime/shoot.mjs --story examples/story-hexi.json --out ../out/hexi --mode preview
node runtime/shoot.mjs --story examples/story-hexi.json --out ../out/hexi-final --mode final --layers map,hud
node runtime/shoot.mjs --out ../out/hexi --i0 40 --i1 60       # 只重拍 [40, 60) 并覆盖
```

| 参数 | 说明 |
|---|---|
| `--mode preview` | 960×540 @10 fps，jpg q80（默认） |
| `--mode final` | 1920×1080 @30 fps，jpg q92 |
| `--layers full` | 一张完整画面 `f#####.jpg`（默认） |
| `--layers map,hud` | 地图层 `m#####.jpg`（含地名、路线、归属标注）+ 字卡层 `h#####.png`（透明底），交给 ffmpeg 合成 |
| `--i0 / --i1` | 只拍 [i0, i1)，**覆盖**已有帧；不带时续拍并跳过已有帧 |
| `--force` | 忽略旧帧和旧清单，全部重拍 |
| `--swiftshader` | CPU 软件光栅，逐字节可复现（比默认慢） |

- 输出目录里的 `shoot.json` 记录 story + preset 指纹、fps、尺寸、图层、格式。续拍时指纹或设置对不上就**拒绝**，不让新旧画面混进同一个序列。
- 每帧先写 `.part` 再改名，中途被杀不会留下半张图。
- 截帧前自动 `precache()`；有 seek 触发 12 s idle 超时放行时，结束时会提醒。
- 验收：`node runtime/verify-shoot.mjs http://127.0.0.1:8770`（续拍 / 局部重拍 / 混帧保护 / 分层 / 两次独立会话逐字节一致）。

可复现性：`seek(t)` 在 idle 之后还会强制刷新地名 Marker 的位置与遮挡透明度（MapLibre 有地形时按深度图算遮挡，且 100 ms 内只更新一次，不刷新就会沿用上一帧的值），并等 webfont 落地。自己写宿主时直接用 `seek`，不要绕过它去截 canvas。

长征系列的 `shoot_v4.py` 做法（保留作参考）：

```js
const browser = await chromium.launch({ args: ['--disable-gpu-rasterization', '--use-gl=angle'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.goto(url);
for (let f = from; f < to; f++) {
  const path = `frames/m${String(f).padStart(5, '0')}.jpg`;
  if (existsSync(path)) continue;                       // 断点续拍
  await page.evaluate((t) => window.__mapstageSeek(t), f / fps);
  await page.screenshot({ path, type: 'jpeg', quality: 92 });
}
```

- `--disable-gpu-rasterization`：GPU 光栅化在长序列里偶尔返回旧瓦片，固定用 CPU。
- 地图层与 HUD 层分开截（`m#####.jpg` / `h#####.png`），ffmpeg 合成。
- **断点续拍会跳过已有帧**：改了模型或数据，先删旧帧，不然新旧画面混在一起。
- 局部出问题用 `--i0 / --i1` 只重拍那一段，再 ffmpeg 拼接，不整片重渲。

## 预览与终版

| 阶段 | 规格 | 用途 |
|---|---|---|
| 低清预览 | 960×540 @ 10 fps | 看节奏、构图、合规；等用户确认 |
| 终版 | 1920×1080 @ 30 fps，crf 18 | 确认后才出 |

- 程序化细纹理（水面涟漪、岩壁噪点）**只在 1080 整帧上暴露**，960 预览看不出——终版前必须抽 1080 整帧检查。
- 参考耗时：预览 5–15 分钟 / 期，终版 35–50 分钟 / 期（长征 ep13 2824 s）。

## QA 判据

截完帧直接跑 `runtime/qa.mjs`，对截帧目录逐项检查并导出验收帧，任何一项不过退出码为 1：

```bash
node runtime/qa.mjs ../out/hexi            # --base 默认 http://127.0.0.1:8770
node runtime/qa.mjs ../out/hexi --cut 28 --freeze 3 --void 0.005 --void-step 1
```

- 导出：`<dir>/qa/` 下 `caption`（第一张字卡中间帧）、`nocaption`（分层截时是同一帧的纯地图层，否则取字卡最少的一帧）、`peak`（同屏字卡最多）、`handoff`（第一次镜头运动的中点）和 `report.json`。
- 露底不靠颜色猜：宿主页把底色层改成品红，逐帧数纯品红（和画布透明、地平线以上）的占比。底图本身是米色 / 沙色，和底色太近，按色匹配会大面积误报。
- 合规是对**每一帧**调 `stage.check(t)`，不只是 `compliance.full` 的逐秒自检。
- 验收：`node runtime/verify-qa.mjs http://127.0.0.1:8770`，用合成帧证明硬切 / 冻帧 / 缺帧 / 露底都抓得到、干净序列不误报，并用 80° 俯仰的真地图帧验证露底探针。

| 检查 | 判据 | 来源 |
|---|---|---|
| 硬切 | 0.1 s 取样，相邻帧差 > 28 判硬切 | 长征 ep07 |
| 黑场 | 整表淡出时长要与黑场一致（0.45 s 会被判硬切，1.3 s 才过） | 长征 full |
| 冻帧 / 露底 | 底图外灰色远景露出即失败 | 长征 ep05 |
| 合规 | `complianceCheck` 在全图时段逐帧通过 | [合规](compliance.md) |
| 导出帧 | 字幕帧、无字帧、峰值帧、交接帧各导一张 | 四渡赤水 |

## 资源与性能

- 大底图 inset 单张约 680 MB，和渲染并行跑多进程会 OOM，这时 `-j 1`。
- 瓦片下载必须带超时，否则卡住 15 分钟。
- Chrome 多进程截帧注意内存；城池 custom layer 只在需要时 `triggerRepaint`。

## 调参台不是宿主

`/studio/` 只用来调参、导出 preset。它带调试面板、localStorage 状态和交互控件，**任何终版帧都不从调参台出**。
