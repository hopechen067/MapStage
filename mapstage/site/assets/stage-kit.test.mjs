import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const kit = require('./stage-kit.js');

// 武威 → 张掖 → 酒泉 → 敦煌（河西走廊）
const hexi = [[102.64, 37.93], [100.45, 38.93], [98.49, 39.73], [94.66, 40.14]];

{
  const total = kit.sliceRoute(hexi, 1).totalKm;
  assert.ok(total > 700 && total < 850, 'hexi length ~760km, got ' + total);
  const half = kit.sliceRoute(hexi, 0.5);
  assert.ok(Math.abs(half.km - total / 2) < 1e-6, 'progress is by distance');
  assert.deepEqual(kit.sliceRoute(hexi, 0).line.length, 2);
  assert.deepEqual(kit.sliceRoute(hexi, 1).head, hexi[3]);
  assert.ok(half.bearing > 240 && half.bearing < 300, 'heading west-ish, got ' + half.bearing);
  assert.deepEqual(kit.sliceRoute(hexi, 2).head, hexi[3], 'clamped above 1');
}

{
  const a = [100, 30];
  const b = [110, 30];
  const pts = kit.arc(a, b, { bend: 0.1, steps: 10 });
  assert.equal(pts.length, 11);
  assert.deepEqual(pts[0], a);
  assert.deepEqual(pts[10], b);
  assert.ok(pts[5][1] > 30.4, 'arc bows sideways');
}

{
  const p = kit.safePadding(1920, 1080);
  assert.deepEqual(p, { left: 115, top: 238, right: 115, bottom: 238 });
}

{
  const shots = [
    { t: 0, center: [100, 30], zoom: 4, push: 0.2 },
    { t: 10, center: [110, 30], zoom: 6, move: 2 },
  ];
  const c0 = kit.cameraAt(shots, 0);
  assert.equal(c0.zoom, 4);
  const hold = kit.cameraAt(shots, 7.9);
  assert.deepEqual(hold.center, [100, 30], 'holds still until the move window');
  assert.ok(hold.zoom > 4.19, 'slow push during hold');
  const mid = kit.cameraAt(shots, 9);
  assert.ok(mid.center[0] > 104 && mid.center[0] < 106, 'smoothstep midway');
  assert.deepEqual(kit.cameraAt(shots, 99).center, [110, 30]);
}

{
  assert.equal(kit.SIDE_COLORS.red, '#c0272d');
  assert.equal(kit.SIDE_COLORS.enemy, '#5f7182');
  const b = kit.bbox(hexi);
  assert.deepEqual(b, [94.66, 37.93, 102.64, 40.14]);
}

console.log('stage-kit.test ok');
