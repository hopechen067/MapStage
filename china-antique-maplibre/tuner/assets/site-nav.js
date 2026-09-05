/**
 * Shared site chrome. Browser: window.AntiqueSiteNav
 * Contract: references/site/00-shared.md
 */
(function (root) {
  'use strict';

  var GH = 'https://github.com/hopechen067/china-antique-maplibre';

  var LINKS = [
    { page: 'home', label: '概览', href: 'home.html' },
    { page: 'browse', label: '目录', href: 'browse.html' },
    { page: 'edit', label: '编辑器', href: 'vector-layers.html' },
    { page: 'showcase', label: '成片', href: 'showcase.html' },
    { page: 'install', label: '安装', href: 'install.html' },
    { page: 'pricing', label: '定价', href: 'pricing.html' },
  ];

  var FOOT = [
    { page: 'legal', label: '许可', href: 'legal.html' },
    { page: 'github', label: 'GitHub', href: GH },
  ];

  function fxHref(family, variant) {
    return 'fx.html?family=' + encodeURIComponent(family) + '&variant=' + encodeURIComponent(variant);
  }

  function editorPage(family) {
    var f = String(family || '').trim();
    if (f === 'skin' || f === 'camera') return 'vector-layers.html';
    if (!f) return 'vector-layers.html';
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
    fxHref: fxHref,
    editorPage: editorPage,
    editorHref: editorHref,
    parseQuery: parseQuery,
    mount: mount,
    mountFooter: mountFooter,
  };
})(typeof window !== 'undefined' ? window : this);
