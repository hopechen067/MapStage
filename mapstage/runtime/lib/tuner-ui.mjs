/**
 * Small UI helpers shared by the tuner verify scripts.
 *
 * The tuner opens with its side panel collapsed (#panel.collapsed is
 * translated off-screen with pointer-events:none), so panel buttons such as
 * 拆出 / 全国视角 / 地形隆起 are only clickable after the chrome's 调参
 * button opens it.
 */

/** Open the tuner side panel the way a user does (idempotent). */
export async function openTunerPanel(page) {
  const collapsed = await page.evaluate(() => {
    const p = document.getElementById('panel');
    return !!(p && p.classList.contains('collapsed'));
  });
  if (collapsed) await page.click('#btn-tuner');
  await page.waitForFunction(() => {
    const p = document.getElementById('panel');
    return !!(p && !p.classList.contains('collapsed'));
  }, null, { timeout: 5000 });
  // panel slides in over 0.2s; wait until it is actually hit-testable
  await page.waitForFunction(() => {
    const b = document.querySelector('#panel-tabs a');
    if (!b) return false;
    const r = b.getBoundingClientRect();
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return !!top && (top === b || b.contains(top));
  }, null, { timeout: 5000 });
}

/**
 * How the current isolate (拆出) is being rendered.
 *   'island' - terrain mesh clip (default whenever terrain is on); the
 *              parchment overlay layers stay hidden by design
 *   'mask'   - legacy overlay: region-mask-fill + region-edge-seal visible
 *   'off'    - neither, i.e. isolate is not actually applied
 */
export function isolateMode(page) {
  return page.evaluate(() => {
    const map = window.__tunerMap;
    const vis = (id) => (map.getLayer(id) ? map.getLayoutProperty(id, 'visibility') : null);
    const last = window.__islandLast;
    if (window.__tunerMaskKind === 'island' && last && last.ok && last.enabled) return 'island';
    if (vis('region-mask-fill') === 'visible' && vis('region-edge-seal') === 'visible') return 'mask';
    return 'off';
  });
}
