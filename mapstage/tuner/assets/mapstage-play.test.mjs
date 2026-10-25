import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const P = require('./mapstage-play.js');
const S = require('./mapstage-story.js');
const sanguo = JSON.parse(readFileSync(join(here, '..', '..', 'site', 'examples', 'play-sanguo.json'), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));

// 剧本合法，且地点能直接喂给 Story 运行时（地图、地名复用 MapStage.mount）
assert.deepEqual(P.lintScenario(sanguo), []);
assert.deepEqual(S.lintStory({ version: 1, duration: 1, sites: sanguo.sites }), []);

{
  const bad = clone(sanguo);
  bad.links.push(['chengdu', 'nowhere']);
  bad.cities.luoyang.owner = 'jin';
  bad.player = 'han';
  const errs = P.lintScenario(bad);
  assert.ok(errs.some((e) => e.includes('nowhere')));
  assert.ok(errs.some((e) => e.includes('jin')));
  assert.ok(errs.some((e) => e.includes('player')));
  assert.throws(() => P.createGame(bad), /剧本校验未通过/);
}

// 开局
const g0 = P.createGame(sanguo, { seed: 7 });
assert.equal(P.dateLabel(g0), '221年 春');
assert.deepEqual(P.citiesOf(g0, 'shu').sort(), ['chengdu', 'hanzhong', 'jiangzhou', 'yongan']);
assert.deepEqual(P.neighbors(sanguo, 'hanzhong'), ['changan', 'chengdu']);

// 征兵：加兵、本城本回合不能再动、原 state 不变
{
  const r = P.apply(g0, sanguo, { type: 'recruit', city: 'jiangzhou' });
  assert.equal(r.state.cities.jiangzhou.troops, 17);
  assert.equal(g0.cities.jiangzhou.troops, 12);
  assert.equal(r.events[0].type, 'recruit');
  assert.throws(() => P.apply(r.state, sanguo, { type: 'recruit', city: 'jiangzhou' }), /已经行动/);
  assert.deepEqual(P.actionsFor(r.state, sanguo, 'jiangzhou'), []);
}

// 非法操作一律抛错
assert.throws(() => P.apply(g0, sanguo, { type: 'recruit', city: 'luoyang' }), /不是你的城/);
assert.throws(() => P.apply(g0, sanguo, { type: 'march', from: 'chengdu', to: 'luoyang', troops: 5 }), /不相邻/);
assert.throws(() => P.apply(g0, sanguo, { type: 'march', from: 'chengdu', to: 'hanzhong', troops: 28 }), /至少留 1/);

// 调兵到己方城：兵力守恒（顶到上限的部分留在原地）
{
  const r = P.apply(g0, sanguo, { type: 'march', from: 'chengdu', to: 'hanzhong', troops: 20 });
  assert.equal(r.state.cities.hanzhong.troops, 38);
  assert.equal(r.state.cities.chengdu.troops, 8);
  const full = clone(g0);
  full.cities.hanzhong.troops = 55;
  const r2 = P.apply(full, sanguo, { type: 'march', from: 'chengdu', to: 'hanzhong', troops: 20 });
  assert.equal(r2.state.cities.hanzhong.troops, 60);
  assert.equal(r2.state.cities.chengdu.troops, 23);
}

// 攻城：压倒性兵力必胜，城易主；以少打多必败，退回一部分
{
  const s = clone(g0);
  s.cities.yongan.troops = 60;
  s.cities.jiangling.troops = 5;
  const win = P.apply(s, sanguo, { type: 'march', from: 'yongan', to: 'jiangling', troops: 59 });
  const ev = win.events.find((e) => e.type === 'battle');
  assert.equal(ev.win, true);
  assert.equal(win.state.cities.jiangling.owner, 'shu');
  assert.ok(win.state.cities.jiangling.troops >= 1);
  assert.equal(win.state.acted.jiangling, true);

  const t = clone(g0);
  t.cities.yongan.troops = 6;
  t.cities.jiangling.troops = 40;
  const lose = P.apply(t, sanguo, { type: 'march', from: 'yongan', to: 'jiangling', troops: 5 });
  const ev2 = lose.events.find((e) => e.type === 'battle');
  assert.equal(ev2.win, false);
  assert.equal(lose.state.cities.jiangling.owner, 'wu');
  assert.equal(lose.state.cities.yongan.troops, 1 + ev2.back);
}

// 结束回合：电脑行动、季节推进、自然增兵不超上限
{
  const r = P.apply(g0, sanguo, { type: 'end' });
  assert.equal(r.state.turn, 2);
  assert.equal(P.dateLabel(r.state), '221年 夏');
  assert.deepEqual(r.state.acted, {});
  assert.ok(r.events.some((e) => e.faction === 'wei' || e.attacker === 'wei'));
  assert.ok(r.events.some((e) => e.faction === 'wu' || e.attacker === 'wu'));
  Object.values(r.state.cities).forEach((c) => assert.ok(c.troops <= 60 && c.troops >= 1));
}

// 确定性：同 seed 同操作 → 同一局；换 seed 战斗结果可以不同
{
  const acts = [
    { type: 'recruit', city: 'jiangzhou' },
    { type: 'march', from: 'yongan', to: 'jiangling', troops: 13 },
    { type: 'end' }, { type: 'end' }, { type: 'end' }, { type: 'end' },
  ];
  const a = P.replay(sanguo, { seed: 42 }, acts);
  const b = P.replay(sanguo, { seed: 42 }, acts);
  assert.deepEqual(a, b);
  assert.equal(P.dateLabel(a), '222年 春');
}

// 跑满 200 回合（玩家只结束回合）：不抛错、兵力守界、最终分出胜负或继续，状态可序列化
{
  let s = P.createGame(sanguo, { seed: 3 });
  for (let i = 0; i < 200 && !s.winner; i++) {
    s = P.apply(s, sanguo, { type: 'end' }).state;
    Object.values(s.cities).forEach((c) => assert.ok(c.troops >= 1 && c.troops <= 60));
  }
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
  if (s.winner) assert.throws(() => P.apply(s, sanguo, { type: 'end' }), /已结束/);
}

// 灭国与胜负：只剩玩家一家时判胜
{
  const s = clone(g0);
  Object.keys(s.cities).forEach((id) => { if (id !== 'jiangling') s.cities[id].owner = 'shu'; });
  s.cities.yongan.troops = 60;
  s.cities.jiangling.troops = 1;
  const r = P.apply(s, sanguo, { type: 'march', from: 'yongan', to: 'jiangling', troops: 59 });
  assert.ok(r.events.some((e) => e.type === 'eliminated' && e.faction === 'wu'));
  assert.equal(r.state.winner, 'shu');
}

console.log('mapstage-play ok');
