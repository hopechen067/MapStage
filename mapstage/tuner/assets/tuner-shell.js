/**
 * Studio shell: everything around the map that is not a tuning parameter.
 * Nav links, light/dark theme, panel tab scroll-spy, switch aria state and
 * keeping the map canvas sized to the space the panel leaves.
 *
 * Runs after tuner-app.js. It only touches chrome DOM and never writes params.
 */
(function () {
  'use strict';

  var THEME_KEY = 'mapstage-site-theme'; // shared with the site (same origin)

  function $(id) { return document.getElementById(id); }

  // ---- nav ---------------------------------------------------------------
  function mountNav() {
    var host = $('chrome-nav');
    if (host && window.AntiqueSiteNav) window.AntiqueSiteNav.mount(host, { page: 'studio' });
  }

  // ---- theme -------------------------------------------------------------
  var ICON_SUN =
    '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  var ICON_MOON =
    '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>';

  function effectiveDark() {
    var t = document.documentElement.getAttribute('data-theme');
    if (t) return t === 'dark';
    return !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  }

  function bindTheme() {
    var btn = $('btn-theme');
    if (!btn) return;
    function paint() { btn.innerHTML = effectiveDark() ? ICON_SUN : ICON_MOON; }
    paint();
    btn.addEventListener('click', function () {
      var next = effectiveDark() ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* private mode */ }
      paint();
    });
  }

  // ---- panel tabs: one section at a time ------------------------------------
  var TAB_KEY = 'mapstage-studio-tab';
  var TAB_ALIAS = { 'sec-color': 'sec-look' }; // 配色 已并入 风格

  function bindTabs() {
    var body = $('panel-body');
    var tabs = Array.prototype.slice.call(document.querySelectorAll('#panel-tabs a'));
    if (!body || !tabs.length) return;
    var ids = tabs.map(function (a) { return a.getAttribute('href').slice(1); });

    function show(i, remember) {
      if (i < 0 || i >= ids.length) i = 0;
      tabs.forEach(function (a, j) {
        a.classList.toggle('active', i === j);
        a.setAttribute('aria-selected', i === j ? 'true' : 'false');
      });
      ids.forEach(function (id, j) {
        var sec = $(id);
        if (sec) sec.classList.toggle('active', i === j);
      });
      body.scrollTop = 0;
      if (remember) {
        try { sessionStorage.setItem(TAB_KEY, ids[i]); } catch (e) { /* private mode */ }
      }
    }

    tabs.forEach(function (a, i) {
      a.addEventListener('click', function (ev) {
        ev.preventDefault();
        show(i, true);
      });
    });

    var want = String(location.hash || '').slice(1);
    if (!want) {
      try { want = sessionStorage.getItem(TAB_KEY) || ''; } catch (e) { want = ''; }
    }
    want = TAB_ALIAS[want] || want;
    body.setAttribute('data-panes', '1');
    show(Math.max(0, ids.indexOf(want)), false);
    // 外部可切换分区（脚本 / 深链）：window.__studioShowTab('isolate')
    window.__studioShowTab = function (name) {
      var i = ids.indexOf('sec-' + name);
      if (i >= 0) show(i, true);
      return i >= 0;
    };
  }

  // ---- switches: mirror .on / .active into aria-pressed -----------------------
  function bindSwitches() {
    var sw = Array.prototype.slice.call(document.querySelectorAll('button.tgl'));
    function sync(el) {
      el.setAttribute('aria-pressed', el.classList.contains('on') || el.classList.contains('active') ? 'true' : 'false');
    }
    var mo = new MutationObserver(function (list) {
      list.forEach(function (m) { sync(m.target); });
    });
    sw.forEach(function (el) {
      sync(el);
      mo.observe(el, { attributes: true, attributeFilter: ['class'] });
    });
  }

  // ---- panel open/close: the map gives the space back -------------------------
  function bindPanel() {
    var panel = $('panel');
    var wrap = $('map-wrap');
    if (!panel || !wrap) return;

    function resizeMap() {
      var m = window.__tunerMap;
      if (m && typeof m.resize === 'function') m.resize();
    }
    new MutationObserver(resizeMap).observe(panel, { attributes: true, attributeFilter: ['class'] });
    if (window.ResizeObserver) new ResizeObserver(resizeMap).observe(wrap);
  }

  function init() {
    mountNav();
    bindTheme();
    bindTabs();
    bindSwitches();
    bindPanel();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
