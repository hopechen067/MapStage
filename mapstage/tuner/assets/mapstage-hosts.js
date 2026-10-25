/**
 * MapStage 宿主适配：把 stage.seek(t) 接到 iframe 宿主（Remotion 等）。HyperFrames 不接活地图，走烘焙视频，见 references/hosts.md。
 * 需要先加载 mapstage-story.js；挂在 window.MapStage.hosts 上。
 *
 *   var stage = await MapStage.mount(el, { preset, story, preserve: true });
 *   await stage.precache();
 *   MapStage.hosts.listen(stage);   // 被 iframe 嵌入，听 postMessage
 *
 * postMessage 协议（父页面 ⇄ host.html 的 iframe）：
 *   子 → 父  { source: 'mapstage', type: 'ready',  duration, fps, width, height, hash }
 *   父 → 子  { source: 'mapstage-host', type: 'seek', id, t }
 *   子 → 父  { source: 'mapstage', type: 'seeked', id, t }       // 地图 idle、标记与字体都落定之后
 *   子 → 父  { source: 'mapstage', type: 'error',  id, message }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else factory(root);
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  var hosts = {
    /** 作为 iframe 被父页面驱动。返回 detach()。 */
    listen: function (stage, opts) {
      opts = opts || {};
      var target = opts.target || root.parent;
      var info = opts.info || {};
      function post(msg) {
        msg.source = 'mapstage';
        if (target && target !== root) target.postMessage(msg, opts.origin || '*');
      }
      function onMessage(ev) {
        var d = ev.data;
        if (!d || d.source !== 'mapstage-host' || d.type !== 'seek') return;
        stage.seek(Number(d.t) || 0).then(
          function (t) { post({ type: 'seeked', id: d.id, t: t }); },
          function (e) { post({ type: 'error', id: d.id, message: String(e && e.message || e) }); }
        );
      }
      root.addEventListener('message', onMessage);
      post({
        type: 'ready',
        duration: stage.duration, fps: stage.fps,
        width: info.width || root.innerWidth, height: info.height || root.innerHeight, hash: info.hash || null,
      });
      return function detach() { root.removeEventListener('message', onMessage); };
    },
  };

  if (root.MapStage) root.MapStage.hosts = hosts;
  else root.MapStage = { hosts: hosts };
  return hosts;
});
