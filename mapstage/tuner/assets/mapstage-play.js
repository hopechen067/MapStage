/**
 * MapStage Play：回合制策略原型的规则引擎（草案，见 references/play.md）。
 *
 * 纯函数、无 DOM：state 是可 JSON 序列化的普通对象，apply 返回新 state + 事件列表，
 * 同一个 seed + 同一串操作永远得到同一局（可回放、可单测）。画面由页面按 state 重画。
 *
 * Browser: window.MapStagePlay · Node: require('./mapstage-play.js')
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MapStagePlay = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var SEASONS = ['春', '夏', '秋', '冬'];

  var DEFAULT_RULES = {
    recruit: 5,         // 征兵一次加多少（千人）
    cap: 60,            // 单城兵力上限（千人）
    growth: 1,          // 每回合每城自然增兵
    capitalGrowth: 2,   // 都城每回合自然增兵
    defense: 1.3,       // 守城加成
    retreat: 0.3,       // 攻城失败退回的比例
  };

  // ── 随机数：mulberry32，状态存在 state.rng 里 ────────────────
  function nextRandom(state) {
    var a = (state.rng + 0x6d2b79f5) >>> 0;
    state.rng = a;
    var t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  function rulesOf(scenario) {
    var r = {};
    Object.keys(DEFAULT_RULES).forEach(function (k) { r[k] = DEFAULT_RULES[k]; });
    Object.keys(scenario.rules || {}).forEach(function (k) { r[k] = scenario.rules[k]; });
    return r;
  }

  function neighbors(scenario, id) {
    var out = [];
    (scenario.links || []).forEach(function (l) {
      if (l[0] === id) out.push(l[1]);
      else if (l[1] === id) out.push(l[0]);
    });
    return out.sort();
  }

  // ── 剧本校验 ─────────────────────────────────────────────
  function lintScenario(sc) {
    var errs = [];
    if (!sc || typeof sc !== 'object') return ['scenario 必须是对象'];
    if (sc.version !== 1) errs.push('version 必须是 1');
    var sites = {};
    (sc.sites || []).forEach(function (s) { sites[s.id] = s; });
    var factions = {};
    (sc.factions || []).forEach(function (f) { factions[f.id] = f; });
    if (!Object.keys(factions).length) errs.push('factions 至少一个势力');
    (sc.factions || []).forEach(function (f) {
      if (!f.name) errs.push('faction ' + f.id + '：缺 name');
      if (!/^#[0-9a-f]{6}$/i.test(f.color || '')) errs.push('faction ' + f.id + '：color 必须是 #rrggbb');
      if (f.capital && !(sc.cities || {})[f.capital]) errs.push('faction ' + f.id + '：capital ' + f.capital + ' 不是城池');
    });
    if (!factions[sc.player]) errs.push('player 必须是一个势力 id');
    Object.keys(sc.cities || {}).forEach(function (id) {
      var c = sc.cities[id];
      if (!sites[id]) errs.push('city ' + id + '：sites 里没有这个地点');
      if (c.owner != null && !factions[c.owner]) errs.push('city ' + id + '：owner ' + c.owner + ' 不是势力');
      if (!(c.troops >= 0)) errs.push('city ' + id + '：troops 必须 ≥ 0');
    });
    var seen = {};
    (sc.links || []).forEach(function (l, i) {
      if (!Array.isArray(l) || l.length !== 2) { errs.push('links[' + i + '] 必须是 [城, 城]'); return; }
      l.forEach(function (id) { if (!(sc.cities || {})[id]) errs.push('links[' + i + '] 引用了不存在的城池 ' + id); });
      var key = l.slice().sort().join('|');
      if (seen[key]) errs.push('links[' + i + '] 重复：' + key);
      seen[key] = true;
    });
    return errs;
  }

  function validateScenario(sc) {
    var errs = lintScenario(sc);
    if (errs.length) {
      var e = new Error('剧本校验未通过（' + errs.length + ' 条）：\n' + errs.map(function (m, i) { return '  ' + (i + 1) + '. ' + m; }).join('\n'));
      e.name = 'ScenarioValidationError';
      e.errors = errs;
      throw e;
    }
    return true;
  }

  // ── 开局 ─────────────────────────────────────────────────
  function createGame(scenario, opts) {
    validateScenario(scenario);
    opts = opts || {};
    var cities = {};
    Object.keys(scenario.cities).sort().forEach(function (id) {
      var c = scenario.cities[id];
      cities[id] = { owner: c.owner || null, troops: c.troops };
    });
    return {
      turn: 1,
      year: scenario.startYear || 1,
      season: 0,
      player: opts.player || scenario.player,
      rng: (opts.seed != null ? opts.seed : 1) >>> 0,
      cities: cities,
      acted: {},
      winner: null,
    };
  }

  function dateLabel(state) { return state.year + '年 ' + SEASONS[state.season]; }

  function citiesOf(state, faction) {
    return Object.keys(state.cities).filter(function (id) { return state.cities[id].owner === faction; });
  }

  function alive(state, scenario) {
    return scenario.factions.filter(function (f) { return citiesOf(state, f.id).length > 0; }).map(function (f) { return f.id; });
  }

  /** 某城本回合能做的操作 */
  function actionsFor(state, scenario, id) {
    var c = state.cities[id];
    if (!c || state.winner || state.acted[id]) return [];
    var R = rulesOf(scenario);
    var out = [];
    if (c.troops < R.cap) out.push({ type: 'recruit', city: id });
    if (c.troops > 1) {
      neighbors(scenario, id).forEach(function (to) {
        out.push({ type: 'march', from: id, to: to, attack: state.cities[to].owner !== c.owner });
      });
    }
    return out;
  }

  // ── 结算 ─────────────────────────────────────────────────
  function doRecruit(state, R, id, events) {
    var c = state.cities[id];
    var n = Math.min(R.recruit, R.cap - c.troops);
    c.troops += n;
    state.acted[id] = true;
    events.push({ type: 'recruit', city: id, faction: c.owner, n: n });
  }

  function doMarch(state, scenario, R, from, to, n, events) {
    var a = state.cities[from];
    var d = state.cities[to];
    var faction = a.owner;
    a.troops -= n;
    state.acted[from] = true;
    if (d.owner === faction) {
      var moved = Math.min(n, R.cap - d.troops);
      d.troops += moved;
      a.troops += n - moved; // 超出上限的留在原地
      events.push({ type: 'march', from: from, to: to, faction: faction, n: moved });
      return;
    }
    var defender = d.owner;
    var atk = n * (0.85 + 0.3 * nextRandom(state));
    var def = d.troops * R.defense * (0.85 + 0.3 * nextRandom(state));
    var win = atk > def;
    var ev = { type: 'battle', from: from, to: to, attacker: faction, defender: defender, n: n, d: d.troops, win: win };
    if (win) {
      d.owner = faction;
      d.troops = Math.max(1, Math.round(n * (1 - def / atk)));
      state.acted[to] = true; // 刚打下的城本回合不能再动
      ev.left = d.troops;
    } else {
      d.troops = Math.max(1, Math.round(d.troops * (1 - atk / def)));
      var back = Math.round(n * R.retreat);
      a.troops = Math.min(R.cap, a.troops + back);
      ev.left = d.troops;
      ev.back = back;
    }
    events.push(ev);
    if (win && defender && citiesOf(state, defender).length === 0) events.push({ type: 'eliminated', faction: defender });
  }

  function checkWinner(state, scenario, events) {
    if (state.winner) return;
    var live = alive(state, scenario);
    if (live.indexOf(state.player) < 0) state.winner = live.length === 1 ? live[0] : 'none';
    else if (live.length === 1) state.winner = live[0];
    if (state.winner) events.push({ type: 'gameover', winner: state.winner, player: state.player });
  }

  /** 电脑势力：能稳赢就打最弱的邻城，后方兵往前线挪，否则征兵 */
  function aiTurn(state, scenario, faction, events) {
    var R = rulesOf(scenario);
    citiesOf(state, faction).sort().forEach(function (id) {
      if (state.acted[id] || state.winner) return;
      var c = state.cities[id];
      if (c.owner !== faction) return;
      var nb = neighbors(scenario, id);
      var enemies = nb.filter(function (to) { return state.cities[to].owner !== faction; });
      var send = Math.floor(c.troops * 0.8);
      var target = enemies
        .filter(function (to) { return send > state.cities[to].troops * R.defense * 1.15; })
        .sort(function (x, y) { return state.cities[x].troops - state.cities[y].troops || (x < y ? -1 : 1); })[0];
      if (target) { doMarch(state, scenario, R, id, target, send, events); checkWinner(state, scenario, events); return; }
      if (!enemies.length && c.troops > 6) {
        var front = nb.filter(function (to) {
          return neighbors(scenario, to).some(function (x) { return state.cities[x].owner !== faction; });
        }).sort(function (x, y) { return state.cities[x].troops - state.cities[y].troops || (x < y ? -1 : 1); })[0];
        if (front && state.cities[front].troops < R.cap) { doMarch(state, scenario, R, id, front, Math.floor(c.troops * 0.6), events); return; }
      }
      if (c.troops < R.cap) doRecruit(state, R, id, events);
    });
  }

  function endTurn(state, scenario, events) {
    var R = rulesOf(scenario);
    scenario.factions.forEach(function (f) {
      if (f.id === state.player || state.winner) return;
      if (citiesOf(state, f.id).length) aiTurn(state, scenario, f.id, events);
    });
    checkWinner(state, scenario, events);
    if (state.winner) return;
    var capitals = {};
    scenario.factions.forEach(function (f) { if (f.capital) capitals[f.capital] = f.id; });
    Object.keys(state.cities).forEach(function (id) {
      var c = state.cities[id];
      if (!c.owner) return;
      var g = capitals[id] === c.owner ? R.capitalGrowth : R.growth;
      c.troops = Math.min(R.cap, c.troops + g);
    });
    state.acted = {};
    state.turn += 1;
    state.season = (state.season + 1) % 4;
    if (state.season === 0) state.year += 1;
    events.push({ type: 'turn', turn: state.turn, date: dateLabel(state) });
  }

  /**
   * 玩家操作。action：
   *   { type: 'recruit', city }
   *   { type: 'march', from, to, troops }   到己方城是调兵，到他方城是攻城
   *   { type: 'end' }                        结束回合，电脑势力行动
   * 返回 { state, events }；不合法时抛错，原 state 不变。
   */
  function apply(state, scenario, action) {
    var s = clone(state);
    var events = [];
    var R = rulesOf(scenario);
    if (s.winner) throw new Error('本局已结束');
    if (action.type === 'end') {
      endTurn(s, scenario, events);
      return { state: s, events: events };
    }
    var id = action.type === 'recruit' ? action.city : action.from;
    var c = s.cities[id];
    if (!c) throw new Error('没有这座城：' + id);
    if (c.owner !== s.player) throw new Error(id + ' 不是你的城');
    if (s.acted[id]) throw new Error(id + ' 本回合已经行动过');
    if (action.type === 'recruit') {
      if (c.troops >= R.cap) throw new Error(id + ' 兵力已满');
      doRecruit(s, R, id, events);
    } else if (action.type === 'march') {
      if (neighbors(scenario, id).indexOf(action.to) < 0) throw new Error(id + ' 与 ' + action.to + ' 不相邻');
      var n = Math.floor(action.troops);
      if (!(n >= 1 && n <= c.troops - 1)) throw new Error('出兵数必须在 1 到 ' + (c.troops - 1) + ' 之间（城里至少留 1）');
      doMarch(s, scenario, R, id, action.to, n, events);
    } else {
      throw new Error('不认识的操作：' + action.type);
    }
    checkWinner(s, scenario, events);
    return { state: s, events: events };
  }

  /** 按顺序重放一串操作（存档 = seed + actions） */
  function replay(scenario, opts, actions) {
    var s = createGame(scenario, opts);
    (actions || []).forEach(function (a) { s = apply(s, scenario, a).state; });
    return s;
  }

  return {
    DEFAULT_RULES: DEFAULT_RULES,
    SEASONS: SEASONS,
    lintScenario: lintScenario,
    validateScenario: validateScenario,
    createGame: createGame,
    actionsFor: actionsFor,
    apply: apply,
    replay: replay,
    neighbors: neighbors,
    citiesOf: citiesOf,
    alive: alive,
    dateLabel: dateLabel,
    rulesOf: rulesOf,
  };
});
