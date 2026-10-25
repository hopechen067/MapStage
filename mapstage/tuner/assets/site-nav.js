/**
 * Studio chrome nav. Browser: window.AntiqueSiteNav
 * Studio 部署在官网 /studio/ 下，站点链接用 ../
 */
(function (root) {
  'use strict';

  var GH = 'https://github.com/hopechen067/MapStage';

  var LINKS = [
    { page: 'home', label: '首页', href: '../' },
    { page: 'docs', label: '文档', href: '../docs/' },
    { page: 'examples', label: '示例', href: '../examples/' },
    { page: 'studio', label: '调参台', href: 'index.html' },
  ];

  var FOOT = [
    { page: 'github', label: 'GitHub', href: GH },
  ];

  function editorPage(family) {
    var f = String(family || '').trim();
    // 皮肤 / 海拔设色已并入调参台「配色」分区；vector-layers.html 仅作实验室页保留
    return 'index.html';
  }

  function editorHref(family, variant) {
    var f = String(family || '').trim();
    var page = editorPage(f);
    return page + '?family=' + encodeURIComponent(f) + '&variant=' + encodeURIComponent(variant);
  }

  function parseQuery() {
    var q = {};
    var s = String(root.location && root.location.search || '').replace(/^\?/, '');
    if (!s) return q;
    s.split('&').forEach(function (part) {
      if (!part) return;
      var i = part.indexOf('=');
      var rawK = i < 0 ? part : part.slice(0, i);
      var rawV = i < 0 ? '' : part.slice(i + 1);
      var k = decodeURIComponent(String(rawK).replace(/\+/g, ' ')).trim();
      var v = decodeURIComponent(String(rawV).replace(/\+/g, ' ')).trim();
      if (k) q[k] = v;
    });
    return q;
  }

  function fillLinks(host, page) {
    LINKS.forEach(function (item) {
      var a = document.createElement('a');
      a.className = 'nav-link' + (item.page === page ? ' is-active' : '');
      a.href = item.href;
      a.textContent = item.label;
      if (item.page === page) a.setAttribute('aria-current', 'page');
      host.appendChild(a);
    });
  }

  function mount(el, opts) {
    opts = opts || {};
    var page = opts.page || '';
    if (!el) return;
    el.innerHTML = '';
    var tag = (el.tagName || '').toLowerCase();
    if (tag === 'nav') {
      el.setAttribute('aria-label', '主导航');
      fillLinks(el, page);
    } else {
      var nav = document.createElement('nav');
      nav.setAttribute('aria-label', '主导航');
      fillLinks(nav, page);
      el.appendChild(nav);
    }
  }

  function mountFooter(el) {
    if (!el) return;
    FOOT.forEach(function (item) {
      var a = document.createElement('a');
      a.href = item.href;
      a.textContent = item.label;
      if (/^https?:/i.test(item.href)) {
        a.target = '_blank';
        a.rel = 'noopener';
      }
      el.appendChild(a);
    });
  }

  root.AntiqueSiteNav = {
    LINKS: LINKS,
    FOOT: FOOT,
    GH: GH,
    editorPage: editorPage,
    editorHref: editorHref,
    parseQuery: parseQuery,
    mount: mount,
    mountFooter: mountFooter,
  };
})(typeof window !== 'undefined' ? window : this);
