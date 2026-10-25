# 示例约定

官网每个示例都是 `site/examples/<id>.html` 一个**能单独打开、能整份复制走**的页面；`view.html?id=<id>` 负责外壳（说明、活地图、完整代码、用到的 API）。一个示例只讲一件事。

## 新增一个示例

1. 在 `site/examples/examples.js` 的 `LIST` 里加一行：`id`、`group`、`title`、`blurb`、`api`、`spec`，有时间轴的再加 `thumb`（缩略图 seek 到的秒数）。
2. 写 `site/examples/<id>.html`，骨架照下面抄。
3. 起服后拍缩略图并冒烟：`node runtime/site-thumbs.mjs http://127.0.0.1:8770 <id>`（输出 `site/examples/thumbs/<id>.jpg`，有 pageerror 会失败）。
4. 在 `tuner/` 下跑 `node verify.mjs`，末尾应为 `verify ok`。

`api` 里的写法会自动链到文档锚点：`MapStage.mount` → 运行时 API · Story，`stage.seek` → 同页实例方法，`MapStageBoard.create` / `board.setCities` → 运行时 API · Board，`AntiqueVectorPaint.*` / `AntiqueMapFx.*` → 运行时 API · 底图，`story.routes` 等 → Story 规范对应小节。

## 页面骨架

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>示例标题 · MapStage 示例</title>
  <link rel="stylesheet" href="https://unpkg.com/maplibre-gl@5.6.0/dist/maplibre-gl.css">
  <style>
    html, body { margin: 0; height: 100%; overflow: hidden; background: #c8c2b4; font: 13px/1.4 system-ui, sans-serif; }
    #stage { position: absolute; inset: 0; }
    .ui { position: absolute; top: 12px; left: 12px; z-index: 10; display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
          max-width: calc(100% - 48px); padding: 8px 10px; background: rgba(251, 248, 241, 0.92); color: #241b14;
          border: 1px solid #ddd2bf; border-radius: 8px; }
    .ui button { font: inherit; padding: 5px 10px; border: 1px solid #ddd2bf; border-radius: 6px; background: #fff; color: inherit; cursor: pointer; }
    .ui button[aria-pressed=true] { background: #241b14; color: #fbf8f1; border-color: #241b14; }
    .ui input[type=range] { width: 200px; accent-color: #b3332a; }
    .ui output { font: 12px ui-monospace, Consolas, monospace; min-width: 52px; }
  </style>
</head>
<body>
  <div id="stage"></div>
  <div class="ui">…控件…</div>

  <script src="https://unpkg.com/maplibre-gl@5.6.0/dist/maplibre-gl.js"></script>
  <script src="../studio/assets/vector-paint.js"></script>
  <script src="../studio/assets/map-fx.js"></script>
  <script src="../studio/assets/mapstage-story.js"></script>
  <!-- 游戏地图再加 ../studio/assets/mapstage-board.js -->
  <script>
    // 一两行说明这个示例演示什么
    …
  </script>
</body>
</html>
```

规则：

- **只用正式运行时**：`MapStage`、`MapStageBoard`、`AntiqueVectorPaint`、`AntiqueMapFx`、`maplibregl`。不要用 `site/assets/stage-kit.js`，不要引官网的 `site.css` / `site.js`。
- **路径只写相对路径**：运行时 `../studio/assets/…`，preset `../studio/presets/antique-default.json`，同目录数据 `./xxx.json`。查看页展示和复制代码时会自动换成本站绝对地址，复制出去照样能跑。
- 做逐帧 / 逐像素比较的示例，把 `#stage` 锁成 16:9（`margin: auto; aspect-ratio: 16 / 9; max-width: 100%; max-height: 100%`）：story 按 16:9 设计，非 16:9 的大画布上实测逐帧会不一致。
- 地图容器固定是 `#stage` 全屏；控件放一个 `.ui` 浮层（拍缩略图时会被隐藏）。不需要的 CSS 行可以删。
- 挂出句柄：Story 示例 `window.stage = stage`，游戏地图 `window.board = board`，不用 story 的 `window.map = map`，方便在控制台里试。注意 `<div id="stage">` 在 mount 完成前本身就是 `window.stage`，判断就绪要看 `window.stage.map`。
- **不自动播放**。有时间轴的示例 mount 后直接 `show(thumb)` 停在一个有内容的时刻，按「播放」才动；`thumb` 和注册表里写的一致。
- 数据写在页面里（`const story = {…}`），短到一屏能看完；只有整段 story 这种大数据才单独放 `./xxx.json`。
- 注释用中文，少而准：说清「为什么这样写」，不复述代码。
- 文件 UTF-8 + LF。

## 时间轴示例的播放控件

```js
MapStage.mount($('stage'), { story }).then((stage) => {
  window.stage = stage;
  $('t').max = stage.duration;
  const show = (t) => { stage.render(t); $('t').value = t; $('read').textContent = t.toFixed(1) + ' s'; };
  $('t').oninput = () => show(Number($('t').value));
  let raf = null;
  $('play').onclick = () => {
    if (raf) { cancelAnimationFrame(raf); raf = null; $('play').textContent = '播放'; return; }
    const t0 = performance.now() - Number($('t').value) * 1000;
    const tick = (now) => { show(((now - t0) / 1000) % stage.duration); raf = requestAnimationFrame(tick); };
    $('play').textContent = '暂停';
    raf = requestAnimationFrame(tick);
  };
  show(8);
});
```

`stage.render(t)` 同步画一帧，适合预览拖动；录制和逐帧比较用 `await stage.seek(t)`（等 idle、等字体）。

## 写 story 时容易被校验拒绝的地方

`MapStage.mount` 先跑 `validateStory`，不过就 reject。常见原因：

- 相邻 `shots` 的间隔必须 ≥ 后一个镜头的 `move`（缺省 2.2 秒）。
- 同一时刻 `primary` 路线 ≤ 1、`reaction` ≤ 2、`active` 地名 ≤ 2、`name` 字卡 ≤ 2。
- 同角色前一段的 `hold`（缺省 = `draw[1]`）不能晚于后一段的 `draw[0]`。
- `confidence: 'C'` 的地点必须 `approx: true`。
- `via` 和 `coords` 二选一；`draw` 必须在 `0..duration` 内。
- `photo` 字卡必须给 `src`；`table` 字卡每行列数一致。

