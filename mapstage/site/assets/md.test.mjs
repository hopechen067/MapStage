import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const md = require('./md.js');

{
  const { html, toc } = md.render('# 镜头 Camera\n\n## 一句一动\n\n正文 `jumpTo` 与 **粗体**。');
  assert.match(html, /<h1 id="镜头-camera">镜头 Camera<\/h1>/);
  assert.match(html, /<h2 id="一句一动">/);
  assert.match(html, /<code>jumpTo<\/code>/);
  assert.match(html, /<strong>粗体<\/strong>/);
  assert.deepEqual(toc.map((t) => t.level), [1, 2]);
}

{
  const { html, toc } = md.render('## 皮肤 {#skins}');
  assert.match(html, /<h2 id="skins">皮肤<\/h2>/);
  assert.equal(toc[0].text, '皮肤');
}

{
  const { html } = md.render('同名\n\n## A\n\n## A');
  assert.match(html, /id="a"/);
  assert.match(html, /id="a-2"/);
}

{
  const { html } = md.render('- 一\n- 二\n  - 二·甲\n  - 二·乙\n- 三\n\n1. 第一\n2. 第二');
  assert.equal(html.split('<ul>').length - 1, 2, 'nested ul');
  assert.match(html, /<li>二<ul><li>二·甲<\/li><li>二·乙<\/li><\/ul><\/li><li>三<\/li>/);
  assert.match(html, /<ol><li>第一<\/li><li>第二<\/li><\/ol>/);
}

{
  const { html } = md.render('| 键 | 说明 |\n|---|:---:|\n| `a\\|b` | 竖线 |\n| x | <b> |');
  assert.match(html, /<th>键<\/th><th style="text-align:center">说明<\/th>/);
  assert.match(html, /<code>a\|b<\/code>/);
  assert.match(html, /&lt;b&gt;/, 'html escaped in cells');
}

{
  const { html } = md.render('```json\n{"a": "<x>"}\n```');
  assert.match(html, /<pre data-lang="json"><code>\{&quot;a&quot;: &quot;&lt;x&gt;&quot;\}<\/code><\/pre>/);
}

{
  const { html } = md.render('见 [镜头](camera.md#push) 与 [官网](https://maplibre.org)', {
    link: (h) => h.replace(/^(\w[\w-]*)\.md/, '?p=$1'),
  });
  assert.match(html, /<a href="\?p=camera#push">镜头<\/a>/);
  assert.match(html, /target="_blank"/);
}

{
  const { html } = md.render('> **注意** 不画省界\n> 第二行');
  assert.match(html, /<blockquote><p><strong>注意<\/strong> 不画省界 第二行<\/p><\/blockquote>/);
}

{
  const { meta, body } = md.frontMatter('---\nname: mapstage\ndescription: "x y"\n---\n# T');
  assert.equal(meta.name, 'mapstage');
  assert.equal(meta.description, 'x y');
  assert.equal(body, '# T');
}

{
  const { html } = md.render('- [x] 完成\n- [ ] 未完');
  assert.match(html, /class="task done"/);
  assert.match(html, /class="task"><\/span>未完/);
}

console.log('md.test ok');
