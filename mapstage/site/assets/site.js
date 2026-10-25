/**
 * MapStage 官网外壳：页头 / 页脚 / 主题切换 / 代码复制与高亮。
 * 页面里放 <header data-site-header data-page="docs"></header> 与 <footer data-site-footer></footer>。
 * Browser: window.MapStageSite
 */
(function () {
  'use strict';

  var script = document.currentScript;
  var ROOT = new URL('../', script ? script.src : location.href).href;
  var GH = 'https://github.com/hopechen067/MapStage';

  var NAV = [
    { page: 'docs', label: '文档', href: 'docs/' },
    { page: 'examples', label: '示例', href: 'examples/' },
    { page: 'studio', label: '调参台', href: 'studio/' },
    { page: 'roadmap', label: '路线图', href: 'docs/?p=roadmap' },
  ];

  var FOOT = [
    {
      title: '开始',
      links: [
        ['概览', 'docs/'],
        ['安装 skill', 'docs/?p=install'],
        ['第一段路线', 'docs/?p=quickstart'],
        ['调参台 Studio', 'studio/'],
      ],
    },
    {
      title: '规范',
      links: [
        ['Preset 底图', 'docs/?p=look'],
        ['Story 叙事', 'docs/?p=story'],
        ['镜头', 'docs/?p=camera'],
        ['合规', 'docs/?p=compliance'],
      ],
    },
    {
      title: '项目',
      links: [
        ['GitHub', GH],
        ['路线图', 'docs/?p=roadmap'],
        ['长征经验', 'docs/?p=lessons'],
        ['数据来源', GH + '/blob/master/DATA-PROVENANCE.md'],
      ],
    },
  ];

  var ICON = {
    // 山河 M：一笔山脊写出 M，尾巴收成路线，朱红圆点是终点。独立文件见 assets/logo.svg
    logo:
      '<svg class="mark" viewBox="0 0 64 64" aria-hidden="true">' +
      '<path d="M7 52L19 15l13 24 12-20 7 18c1.6 4.4 3.6 7 7 8" fill="none" stroke="currentColor" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"/>' +
      '<circle cx="58" cy="45" r="5" fill="var(--seal)"/></svg>',
    gh:
      '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>',
    sun:
      '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/></svg>',
    moon:
      '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>',
    menu:
      '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  };

  function url(rel) {
    return /^https?:/i.test(rel) ? rel : new URL(rel, ROOT).href;
  }

  function store(key, val) {
    try {
      if (val === undefined) return localStorage.getItem(key);
      if (val === null) localStorage.removeItem(key);
      else localStorage.setItem(key, val);
    } catch (e) {
      return null;
    }
    return null;
  }

  function applyTheme(t) {
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
  }

  function effectiveDark() {
    var t = document.documentElement.getAttribute('data-theme');
    if (t) return t === 'dark';
    return !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  }

  applyTheme(store('mapstage-site-theme'));

  function mountHeader(el) {
    var page = el.getAttribute('data-page') || '';
    var links = NAV.map(function (n) {
      var cur = n.page === page ? ' aria-current="page"' : '';
      return '<a href="' + url(n.href) + '"' + cur + '>' + n.label + '</a>';
    }).join('');
    el.className = 'site-header';
    el.innerHTML =
      '<div class="wrap">' +
      '<a class="brand" href="' + url('') + '">' + ICON.logo + '<span class="wordmark">MapStage</span><small>历史视频的地图舞台</small></a>' +
      '<nav class="site-nav" id="site-nav" aria-label="主导航">' + links + '</nav>' +
      '<div class="header-tools">' +
      '<button class="icon-btn theme-btn" type="button" aria-label="切换明暗">' + (effectiveDark() ? ICON.sun : ICON.moon) + '</button>' +
      '<a class="icon-btn" href="' + GH + '" target="_blank" rel="noopener" aria-label="GitHub">' + ICON.gh + '</a>' +
      '<button class="icon-btn menu-btn" type="button" aria-label="菜单" aria-controls="site-nav" aria-expanded="false">' + ICON.menu + '</button>' +
      '</div></div>';
    var themeBtn = el.querySelector('.theme-btn');
    themeBtn.addEventListener('click', function () {
      var next = effectiveDark() ? 'light' : 'dark';
      applyTheme(next);
      store('mapstage-site-theme', next);
      themeBtn.innerHTML = effectiveDark() ? ICON.sun : ICON.moon;
      document.dispatchEvent(new CustomEvent('mapstage:theme', { detail: { dark: effectiveDark() } }));
    });
    var menuBtn = el.querySelector('.menu-btn');
    var nav = el.querySelector('.site-nav');
    menuBtn.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  function mountFooter(el) {
    el.className = 'site-footer contour';
    var cols = FOOT.map(function (c) {
      return '<div><h4>' + c.title + '</h4><ul>' + c.links.map(function (l) {
        var ext = /^https?:/i.test(l[1]) ? ' target="_blank" rel="noopener"' : '';
        return '<li><a href="' + url(l[1]) + '"' + ext + '>' + l[0] + '</a></li>';
      }).join('') + '</ul></div>';
    }).join('');
    el.innerHTML =
      '<div class="wrap"><div class="cols">' +
      '<div><a class="brand" href="' + url('') + '">' + ICON.logo + '<span class="wordmark">MapStage</span><small>历史视频的地图舞台</small></a>' +
      '<p style="margin:14px 0 0;max-width:320px">基于 MapLibre GL JS 的叙事地图引擎与 agent skill。底图、路线、镜头、合规规则，一份 JSON 驱动，逐帧可复现。</p></div>' +
      cols + '</div>' +
      '<div class="fine">MIT License · 地图瓦片与地形数据版权归各自提供方，见 DATA-PROVENANCE。示意性历史地图，不作为权威边界依据。</div></div>';
  }

  // ── 代码块：复制 + 轻量高亮 ─────────────────────────
  var KW = /\b(const|let|var|function|return|await|async|new|if|else|for|of|in|import|from|export|true|false|null|undefined)\b/g;

  function escHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /** HTML：标签 / 属性着色，<script> 内部按 js 处理 */
  function highlightHtml(code) {
    var out = [];
    var re = /(<script\b[^>]*>)([\s\S]*?)(<\/script>)|(<style\b[^>]*>)([\s\S]*?)(<\/style>)|(<!--[\s\S]*?-->)|(<\/?[\w-]+(?:\s[^>]*)?>|<!doctype[^>]*>)/gi;
    var last = 0;
    var m;
    function tag(t) {
      return '<span class="tok-t">' + escHtml(t).replace(/(\s)([\w:-]+)(=)("[^"]*"|'[^']*')/g, function (_, sp, k, eq, v) {
        return sp + '<span class="tok-a">' + k + '</span>' + eq + '<span class="tok-s">' + v + '</span>';
      }) + '</span>';
    }
    while ((m = re.exec(code))) {
      out.push(escHtml(code.slice(last, m.index)));
      if (m[1]) out.push(tag(m[1]) + highlight(m[2], 'js') + tag(m[3]));
      else if (m[4]) out.push(tag(m[4]) + escHtml(m[5]) + tag(m[6]));
      else if (m[7]) out.push('<span class="tok-c">' + escHtml(m[7]) + '</span>');
      else out.push(tag(m[8]));
      last = re.lastIndex;
    }
    out.push(escHtml(code.slice(last)));
    return out.join('');
  }

  function highlight(code, lang) {
    if (lang === 'html') return highlightHtml(code);
    var esc = escHtml(code);
    if (!/^(js|javascript|json|mjs|ts)$/.test(lang || '')) return esc;
    var parts = [];
    var re = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|\b(\d+(?:\.\d+)?)\b/g;
    var last = 0;
    var m;
    while ((m = re.exec(esc))) {
      parts.push(esc.slice(last, m.index).replace(KW, '<span class="tok-k">$1</span>'));
      if (m[1]) parts.push('<span class="tok-c">' + m[1] + '</span>');
      else if (m[2]) parts.push('<span class="tok-s">' + m[2] + '</span>');
      else parts.push('<span class="tok-n">' + m[3] + '</span>');
      last = re.lastIndex;
    }
    parts.push(esc.slice(last).replace(KW, '<span class="tok-k">$1</span>'));
    return parts.join('');
  }

  function copyText(text, btn) {
    function done(ok) {
      var old = btn.textContent;
      btn.textContent = ok ? '已复制' : '复制失败';
      setTimeout(function () { btn.textContent = old; }, 1400);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
    } else {
      done(false);
    }
  }

  /** <div class="code" data-lang="js" data-title="标题"><pre>原文</pre></div> → 带复制按钮的高亮块 */
  function enhanceCode(rootEl) {
    (rootEl || document).querySelectorAll('.code:not([data-ready])').forEach(function (box) {
      var pre = box.querySelector('pre');
      if (!pre) return;
      var raw = pre.textContent.replace(/^\n/, '').replace(/\s+$/, '');
      box.setAttribute('data-ready', '1');
      pre.innerHTML = '<code>' + highlight(raw, box.getAttribute('data-lang')) + '</code>';
      var head = document.createElement('div');
      head.className = 'code-head';
      head.innerHTML = '<span>' + (box.getAttribute('data-title') || box.getAttribute('data-lang') || '') + '</span>';
      var btn = document.createElement('button');
      btn.className = 'copy-btn';
      btn.type = 'button';
      btn.textContent = '复制';
      btn.addEventListener('click', function () { copyText(raw, btn); });
      head.appendChild(btn);
      box.insertBefore(head, pre);
    });
  }

  function boot() {
    document.querySelectorAll('[data-site-header]').forEach(mountHeader);
    document.querySelectorAll('[data-site-footer]').forEach(mountFooter);
    enhanceCode(document);
  }

  window.MapStageSite = { ROOT: ROOT, GH: GH, url: url, highlight: highlight, enhanceCode: enhanceCode, copyText: copyText, isDark: effectiveDark };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
