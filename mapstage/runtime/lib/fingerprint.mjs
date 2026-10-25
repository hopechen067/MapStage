/**
 * story + preset 指纹，算法与 site/host.html 里的 fingerprint() 逐字一致。
 * 截帧前（终版开工前）不用开浏览器就能知道「预览确认的那份数据」有没有被改过。
 */
export function fingerprint(text) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

/** 取 story 与 preset 原文并算指纹；story 是相对站点根的路径（或完整 URL / data: URL）。 */
export async function storyFingerprint(base, story) {
  const root = String(base).replace(/\/$/, '');
  const storyUrl = /^(https?|data):/.test(story) ? story : root + '/' + story.replace(/^\//, '');
  const storyText = await (await fetch(storyUrl)).text();
  const parsed = JSON.parse(storyText);
  let presetText = '{}';
  if (parsed.preset) presetText = await (await fetch(new URL(parsed.preset, storyUrl))).text();
  return { hash: fingerprint(storyText + '\n' + presetText), duration: parsed.duration, fps: parsed.fps || 30 };
}
