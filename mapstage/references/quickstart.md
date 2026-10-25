# 快速上手

目标：五分钟内跑出一段「河西走廊 · 武威 → 敦煌」的路线行进，并能按时间逐帧取画面。

## 方式一：交给 agent

装好 skill（见 [安装](install.md)）后，对 agent 说：

```text
/mapstage 做一段河西走廊从武威到敦煌的路线移动，16 秒，完成后启动本地预览。
```

skill 会依次：查地点坐标 → 写 `story.json`（路线、地名、镜头）→ 选一套 preset → 生成宿主页面 → 起本地服务 → 出 960×540 低清预览给你看。确认后才出 1080p 终版。

## 方式二：自己写

### 1. 一个 html 文件

MapStage 没有 npm 包、没有构建步骤，几个脚本标签就够了。下面整份存成 `hexi.html`：

```html
<!doctype html>
<meta charset="utf-8">
<link rel="stylesheet" href="https://unpkg.com/maplibre-gl@5.6.0/dist/maplibre-gl.css">
<div id="stage" style="position:absolute;inset:0"></div>

<script src="https://unpkg.com/maplibre-gl@5.6.0/dist/maplibre-gl.js"></script>
<script src="studio/assets/vector-paint.js"></script>
<script src="studio/assets/map-fx.js"></script>
<script src="studio/assets/mapstage-story.js"></script>
<script>
  const story = {
    version: 1, id: 'hexi', duration: 16,
    sites: [
      { id: 'wuwei', name: '武威', lngLat: [102.64, 37.93], tier: 'large' },
      { id: 'zhangye', name: '张掖', lngLat: [100.45, 38.93], tier: 'large' },
      { id: 'dunhuang', name: '敦煌', lngLat: [94.66, 40.14], tier: 'large' },
    ],
    routes: [
      { id: 'hexi', side: 'red', role: 'primary', via: ['wuwei', 'zhangye', 'dunhuang'],
        curve: 'none', draw: [1, 14], hold: 16, ghost: true },
    ],
    beats: [
      { t: 0, active: ['wuwei'] },
      { t: 6, active: ['zhangye'] },
      { t: 13, active: ['dunhuang'] },
    ],
    shots: [
      { t: 0, fit: ['wuwei', 'zhangye'], pitch: 20 },
      { t: 12, fit: 'route:hexi', move: 3 },
    ],
  };
  MapStage.mount('stage', { story }).then((stage) => stage.seek(8));
</script>
```

`studio/assets/…` 是官网上调参台的目录：可以直接写官网的绝对地址，也可以把这几个脚本拷到自己项目里。本地仓库里起服后同样能用：

```bash
node mapstage/site/serve.mjs
```

打开 `http://127.0.0.1:8770/`，`/studio/` 是调参台，`/examples/` 是示例。

### 2. 看懂这份 story

- `sites`：地点。`tier` 决定字号和图标。
- `routes`：一条 `primary` 主线，`draw: [1, 14]` 表示第 1 秒开始画、第 14 秒画完，按**里程**匀速推进；`ghost` 先画出全程淡底。
- `beats`：地名三态，讲到哪个地名哪个高亮，讲过的保留、没讲到的变暗。
- `shots`：镜头。`fit` 给地点或路线，运行时按 16:9 安全区算机位，不用手写 `center` / `zoom`。

字段全集见 [叙事 Story](story-spec.md)，每个字段都有单独的示例。

### 3. 取帧

`mount` 会在页面上挂出 `window.__mapstageSeek(t)`：画出第 `t` 秒、等瓦片和字体落地才返回。同一个 `t` 永远是同一帧。

```js
// Playwright
await page.evaluate(() => window.__mapstageSeek(8));
await page.screenshot({ path: 'frame-0240.png' });
```

逐帧录制前先 `stage.precache()` 把所有机位走一遍，见 [运行时 API · Story](api-story.md#stage-precache)。

完整可运行版本见示例 [路线行进](../site/examples/route-march.html)、[逐帧时间契约](../site/examples/seek-contract.html) 和 [一份 story.json 出整段](../site/examples/story-hexi.html)。

## 下一步

- 每个功能一个示例 → [示例库](../site/examples/index.html)
- 每个函数的参数和返回值 → [运行时 API](api.md)
- 调一套自己的底图 → [底图 Look](look.md)
- 接 HyperFrames / Remotion → [宿主与渲染](hosts.md)
