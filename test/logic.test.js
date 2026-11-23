'use strict';
// Runs the game logic from index.html's <script id="ewt-logic"> block. Usage: node test/logic.test.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const block = html.match(/<script id="ewt-logic">([\s\S]*?)<\/script>/);
if (!block) throw new Error('No <script id="ewt-logic"> block in index.html');
const win = {};
new Function('window', block[1])(win);
const E = win.EWT;

// Small seeded RNG so failures reproduce.
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
E.setRandom(mulberry32(12345));

let failed = 0, passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`ok   ${name}`); }
  catch (err) { failed++; console.log(`FAIL ${name}\n     ${err && err.stack ? err.stack.split('\n').slice(0, 3).join('\n     ') : err}`); }
}
const C = (rank, suit = 0) => ({ rank, suit });
const pileOf = (...ranks) => ranks.map((r, i) => C(r, i % 4));
const ALL_RULES = { double: true, sandwich: true, topbottom: true, tens: true, marriage: true, run: true };
const DEFAULT_RULES = { double: true, sandwich: true, topbottom: true, tens: false, marriage: false, run: false };
function randomPile(n) { const p = []; for (let i = 0; i < n; i++) p.push(E.newCard(E.randInt(1, 13))); return p; }
function randomRules() {
  const r = {}; for (const k of E.RULES) r[k] = Math.random() < 0.5;
  if (!E.RULES.some(k => r[k])) r.double = true;
  return r;
}

/* ---------- Pattern checks ---------- */
test('patternsOf: doubles, sandwiches, top-bottom', () => {
  assert.deepStrictEqual(E.patternsOf(pileOf(7, 7), DEFAULT_RULES), ['double']);
  assert.deepStrictEqual(E.patternsOf(pileOf(2, 7, 4, 7), DEFAULT_RULES), ['sandwich']);
  assert.deepStrictEqual(E.patternsOf(pileOf(7, 4, 7), DEFAULT_RULES), ['sandwich', 'topbottom']);
  assert.deepStrictEqual(E.patternsOf(pileOf(9, 2, 5, 9), DEFAULT_RULES), ['topbottom']);
  assert.deepStrictEqual(E.patternsOf(pileOf(9, 9), DEFAULT_RULES), ['double'], 'two cards is a double, not a top-bottom');
  assert.deepStrictEqual(E.patternsOf(pileOf(7), DEFAULT_RULES), []);
  assert.deepStrictEqual(E.patternsOf(pileOf(7, 8), DEFAULT_RULES), []);
});
test('patternsOf: tens, marriage, runs, priority order', () => {
  assert.deepStrictEqual(E.patternsOf(pileOf(3, 7), ALL_RULES), ['tens']);
  assert.deepStrictEqual(E.patternsOf(pileOf(1, 9), ALL_RULES), ['tens']);
  assert.deepStrictEqual(E.patternsOf(pileOf(5, 5), ALL_RULES), ['double', 'tens']);
  assert.deepStrictEqual(E.patternsOf(pileOf(12, 13), ALL_RULES), ['marriage']);
  assert.deepStrictEqual(E.patternsOf(pileOf(13, 12), ALL_RULES), ['marriage']);
  assert.deepStrictEqual(E.patternsOf(pileOf(5, 6, 7), ALL_RULES), ['run']);
  assert.deepStrictEqual(E.patternsOf(pileOf(7, 6, 5), ALL_RULES), ['run']);
  assert.deepStrictEqual(E.patternsOf(pileOf(12, 13, 1), ALL_RULES), ['run'], 'A high');
  assert.deepStrictEqual(E.patternsOf(pileOf(1, 2, 3), ALL_RULES), ['run'], 'A low');
  assert.deepStrictEqual(E.patternsOf(pileOf(13, 1, 2), ALL_RULES), [], 'no wrap-around');
  assert.deepStrictEqual(E.patternsOf(pileOf(3, 7), DEFAULT_RULES), [], 'disabled rules are ignored');
  assert.deepStrictEqual(E.patternsOf(pileOf(10, 10), ALL_RULES), ['double'], '10 + 10 is not tens');
});
test('targetCard always completes a pattern; lureCard and neutralCard never do', () => {
  for (let i = 0; i < 4000; i++) {
    const rules = randomRules(), pile = randomPile(E.randInt(1, 12));
    const t = E.targetCard(pile, rules);
    if (t) assert.ok(E.completes(pile, t, rules), 'target completes');
    const l = E.lureCard(pile, rules);
    if (l) assert.ok(!E.completes(pile, l, rules), 'lure is never a pattern');
    const n = E.neutralCard(pile, rules);
    assert.ok(!E.completes(pile, n, rules), 'neutral is never a pattern');
  }
});
test('falseKind names the near-miss', () => {
  assert.strictEqual(E.falseKind(pileOf(7, 8), DEFAULT_RULES).kind, 'oneoff');
  assert.strictEqual(E.falseKind(pileOf(6, 9), DEFAULT_RULES).kind, 'lookalike');
  assert.strictEqual(E.falseKind(pileOf(12, 13), DEFAULT_RULES).kind, 'face');
  assert.strictEqual(E.falseKind([C(4), C(7)], ALL_RULES).kind, 'sum');
  assert.strictEqual(E.falseKind([C(2, 1), C(9, 1)], DEFAULT_RULES).kind, 'suit');
  assert.strictEqual(E.falseKind([C(2, 1), C(11, 2)], DEFAULT_RULES).kind, 'other');
});

/* ---------- Settings and history stay backward compatible ---------- */
const V1_SETTINGS = { mode: 'comeback', rules: { double: true, sandwich: false, topbottom: true, tens: true, marriage: false, run: false }, pace: 650, adaptive: false, deck: 'real', memory: false, assist: true, length: 40, piles: 12 };
test('cleanSettings keeps every v1 field', () => {
  const s = E.cleanSettings(JSON.parse(JSON.stringify(V1_SETTINGS)));
  for (const k of Object.keys(V1_SETTINGS)) assert.deepStrictEqual(s[k], V1_SETTINGS[k], k);
});
test('cleanSettings fills defaults and rejects junk', () => {
  assert.deepStrictEqual(E.cleanSettings(null), E.DEFAULTS);
  const s = E.cleanSettings({ mode: 'nope', pace: 1, rules: { double: false, sandwich: false, topbottom: false }, length: 'x' });
  assert.strictEqual(s.mode, 'live');
  assert.strictEqual(s.pace, 900);
  assert.strictEqual(s.rules.double, true, 'at least one rule stays on');
  assert.strictEqual(s.length, 20);
});
const V1_HISTORY = [
  { at: 1763800000000, mode: 'live', acc: 85, avg: 412, falses: 2, pace: 820, deck: 'drill' },
  { at: 1763700000000, mode: 'comeback', acc: 75, avg: 380, falses: 1, pace: 900, deck: 'drill' },
  { at: 1763600000000, mode: 'live', acc: 60, avg: null, falses: 0, pace: 650, deck: 'real' },
];
test('cleanHistory keeps v1 entries unchanged', () => {
  assert.deepStrictEqual(E.cleanHistory(JSON.parse(JSON.stringify(V1_HISTORY))), V1_HISTORY);
  assert.deepStrictEqual(E.cleanHistory('junk'), []);
  assert.strictEqual(E.cleanHistory(Array.from({ length: 20 }, (_, i) => ({ at: i + 1 }))).length, 12);
});

/* ---------- Mistake replay ---------- */
test('pileTail keeps the last five cards, rank and suit only', () => {
  const pile = [1, 2, 3, 4, 5, 6, 7].map(r => E.newCard(r, r % 4));
  assert.deepStrictEqual(E.pileTail(pile), [3, 4, 5, 6, 7].map(r => ({ rank: r, suit: r % 4 })));
  assert.deepStrictEqual(E.pileTail(pile.slice(0, 2)).length, 2);
});
test('mistakeLabel reads like the spec', () => {
  assert.strictEqual(E.mistakeLabel({ kind: 'missed', rule: 'sandwich', call: '7 · 4 · 7' }), 'Missed sandwich: 7 · 4 · 7');
  assert.strictEqual(E.mistakeLabel({ kind: 'late', rule: 'topbottom', call: 'bottom 9 · top 9' }), 'Late top-bottom: bottom 9 · top 9');
  const p = [C(7, 1), C(8, 2)];
  assert.strictEqual(E.mistakeLabel({ kind: 'false', fk: E.falseKind(p, DEFAULT_RULES), cards: p }), 'False slap: 8 on a 7 (one off)');
  const q = [C(8, 1), C(9, 2)];
  assert.strictEqual(E.mistakeLabel({ kind: 'false', fk: E.falseKind(q, DEFAULT_RULES), cards: q }), 'False slap: 9 on an 8 (one off)');
  const s = [C(2, 1), C(9, 1)];
  assert.strictEqual(E.mistakeLabel({ kind: 'false', bait: true, fk: E.falseKind(s, DEFAULT_RULES), cards: s }), 'Took the bait: 9 on a 2 (same suit)');
  assert.strictEqual(E.mistakeLabel({ kind: 'false', split: true, call: '7 · 4 · 7', cards: s }), 'False slap: your 7 · 4 · 7 came back split up');
  assert.strictEqual(E.mistakeLabel({ kind: 'missed', comeback: true, rule: 'double', call: '5 · 2 · 5' }), 'Missed comeback: 5 · 2 · 5');
});
test('mistakeTiming states your timing', () => {
  assert.strictEqual(E.mistakeTiming({ kind: 'missed', pace: 900 }), 'No slap in the 900 ms window');
  assert.strictEqual(E.mistakeTiming({ kind: 'late', ms: 1010, late: 110 }), '1010 ms, 110 ms after the next card landed');
  assert.strictEqual(E.mistakeTiming({ kind: 'false', ms: 240, bait: true, gap: 90, burned: 2 }), '240 ms after it landed · 90 ms after a flinch · burned 2');
  assert.strictEqual(E.mistakeTiming({ kind: 'late', who: 'Shark', whoMs: 296, ms: 340 }), 'Shark 296 ms, you 340 ms');
});

/* ---------- Targeted practice ---------- */
const rts = (n, ms) => Array.from({ length: n }, () => ms);
function roundStats(by, falseKinds) {
  const out = { by: {}, falseKinds: falseKinds || {} };
  for (const k of E.RULES) out.by[k] = Object.assign({ seen: 0, hit: 0, late: 0, miss: 0, rts: [] }, by[k] || {});
  return out;
}
// Doubles fast and clean, sandwiches slow, top-bottoms missed a lot.
const WEAK = E.addRoundToWeak(null, roundStats({
  double: { hit: 20, rts: rts(20, 380) },
  sandwich: { hit: 18, late: 1, miss: 1, rts: rts(18, 560) },
  topbottom: { hit: 4, miss: 6, rts: rts(4, 470) },
}, { oneoff: 5, face: 2, suit: 1, other: 4 }));
test('addRoundToWeak accumulates across rounds and maps false-slap kinds', () => {
  const w2 = E.addRoundToWeak(WEAK, roundStats({ double: { hit: 2, miss: 1, rts: [400, 420] } }, { sum: 2 }));
  assert.deepStrictEqual(w2.rules.double, { caught: 22, late: 0, missed: 1, rtSum: 20 * 380 + 820, rtN: 22 });
  assert.deepStrictEqual(w2.falses, { oneoff: 5, lookalike: 2, neartens: 2, suit: 1 });
  assert.deepStrictEqual(E.cleanWeak('junk').falses, { oneoff: 0, lookalike: 0, neartens: 0, suit: 0 });
  assert.strictEqual(E.cleanWeak({ rules: { double: { caught: -4, rtSum: 'x' } } }).rules.double.caught, 0);
});
test('ruleShares sum to 1, keep every enabled rule, and favour the weakest', () => {
  const sh = E.ruleShares(WEAK, DEFAULT_RULES);
  assert.deepStrictEqual(Object.keys(sh).sort(), ['double', 'sandwich', 'topbottom']);
  assert.ok(Math.abs(Object.values(sh).reduce((a, b) => a + b, 0) - 1) < 1e-9);
  for (const v of Object.values(sh)) assert.ok(v >= 0.5 / 3 - 1e-9, 'floor keeps every rule in the mix');
  assert.ok(sh.double < sh.sandwich && sh.double < sh.topbottom, JSON.stringify(sh));
  const even = E.ruleShares(null, DEFAULT_RULES);
  for (const v of Object.values(even)) assert.ok(Math.abs(v - 1 / 3) < 1e-9, 'no data means an even mix');
  assert.deepStrictEqual(E.ruleShares(WEAK, { double: true }), { double: 1 });
});
test('lureShares favour the near-miss you fall for and skip near-tens without the tens rule', () => {
  const ls = E.lureShares(WEAK, DEFAULT_RULES);
  assert.deepStrictEqual(Object.keys(ls), ['oneoff', 'lookalike', 'suit']);
  assert.ok(ls.oneoff > ls.lookalike && ls.lookalike > ls.suit);
  assert.ok('neartens' in E.lureShares(WEAK, ALL_RULES));
});
test('focusPlan says what the round leans toward', () => {
  const slow = E.addRoundToWeak(null, roundStats({ double: { hit: 10, rts: rts(10, 380) }, sandwich: { hit: 10, rts: rts(10, 600) } }));
  const plan = E.focusPlan(slow, { double: true, sandwich: true });
  assert.strictEqual(E.focusText(plan), 'Extra sandwiches: your slowest rule.');
  const missy = E.addRoundToWeak(null, roundStats({ double: { hit: 10, rts: rts(10, 420) }, sandwich: { hit: 3, miss: 7, rts: rts(3, 400) } }, { oneoff: 4, suit: 1 }));
  assert.strictEqual(E.focusText(E.focusPlan(missy, { double: true, sandwich: true })), 'Extra sandwiches: the one you miss most. More one-off near-misses: the near-miss you slap most.');
  assert.strictEqual(E.focusText(E.focusPlan(null, DEFAULT_RULES)), 'No weak spot stands out yet, so the mix stayed even.');
});
test('targetCardFor completes the rule asked for; lureCardOf makes the near-miss asked for', () => {
  let made = 0, lures = 0;
  for (let i = 0; i < 3000; i++) {
    const pile = randomPile(E.randInt(1, 10));
    for (const rule of E.RULES) {
      const c = E.targetCardFor(pile, ALL_RULES, rule);
      if (c) { made++; assert.ok(E.patternsOf(pile.concat([c]), ALL_RULES).includes(rule), rule); }
    }
    for (const type of E.LURE_TYPES) {
      const c = E.lureCardOf(pile, ALL_RULES, type);
      if (!c) continue;
      lures++;
      assert.ok(!E.completes(pile, c, ALL_RULES), 'lure never completes');
      const kind = E.falseKind(pile.concat([c]), ALL_RULES).kind;
      assert.strictEqual({ oneoff: 'oneoff', lookalike: 'lookalike', face: 'lookalike', sum: 'neartens', suit: 'suit' }[kind], type);
    }
  }
  assert.ok(made > 3000 && lures > 3000, `${made} targets, ${lures} lures`);
});
test('drillCard with a focus plan leans toward the weak rule and keeps the same pattern rate', () => {
  function run(plan) {
    const counts = {}; let patterns = 0, cards = 0;
    let pile = [];
    for (let i = 0; i < 30000; i++) {
      const c = E.drillCard(pile, DEFAULT_RULES, plan);
      pile.push(c); cards++;
      const p = E.patternsOf(pile, DEFAULT_RULES)[0];
      if (p) { patterns++; counts[p] = (counts[p] || 0) + 1; pile = []; }
      else if (pile.length > 12) pile = [];
    }
    return { counts, rate: patterns / cards };
  }
  const slowSandwich = E.addRoundToWeak(null, roundStats({ double: { hit: 30, rts: rts(30, 360) }, sandwich: { hit: 30, rts: rts(30, 660) }, topbottom: { hit: 30, rts: rts(30, 380) } }));
  const plain = run(null), focus = run(E.focusPlan(slowSandwich, DEFAULT_RULES));
  const share = r => r.counts.sandwich / (r.counts.double + r.counts.sandwich + r.counts.topbottom);
  assert.ok(share(focus) > share(plain) + 0.08, `sandwich share ${share(plain).toFixed(2)} -> ${share(focus).toFixed(2)}`);
  for (const k of ['double', 'topbottom']) assert.ok(focus.counts[k] > 300, `${k} still dealt (${focus.counts[k]})`);
  assert.ok(Math.abs(focus.rate - plain.rate) < 0.05, `pattern rate ${plain.rate.toFixed(3)} vs ${focus.rate.toFixed(3)}`);
});

/* ---------- Fake flinches ---------- */
test('flinchPlan: off never flinches, lots flinches more than some, real patterns get a late flinch', () => {
  const rate = (level, pat) => { let n = 0; for (let i = 0; i < 20000; i++) if (E.flinchPlan(level, pat)) n++; return n / 20000; };
  assert.strictEqual(rate('off', false) + rate('off', true), 0);
  const some = rate('some', false), lots = rate('lots', false);
  assert.ok(Math.abs(some - 0.12) < 0.015 && Math.abs(lots - 0.3) < 0.015, `${some} ${lots}`);
  assert.ok(rate('lots', true) > rate('some', true) && rate('some', true) > 0.05);
  for (let i = 0; i < 2000; i++) {
    const plain = E.flinchPlan('lots', false), late = E.flinchPlan('lots', true);
    if (plain) assert.ok(plain.delay >= 20 && plain.delay <= 140);
    if (late) assert.ok(late.delay >= 220 && late.delay <= 340, 'a beat late on real patterns');
  }
});
test('tookBait counts false slaps within 300 ms after a flinch', () => {
  assert.strictEqual(E.tookBait(1000, 800), true);
  assert.strictEqual(E.tookBait(1100, 800), true);
  assert.strictEqual(E.tookBait(1101, 800), false);
  assert.strictEqual(E.tookBait(790, 800), false, 'before the flinch');
  assert.strictEqual(E.tookBait(1000, null), false);
});
test('cleanSettings accepts flinch levels and defaults to off', () => {
  assert.strictEqual(E.cleanSettings({}).flinch, 'off');
  assert.strictEqual(E.cleanSettings({ flinch: 'lots' }).flinch, 'lots');
  assert.strictEqual(E.cleanSettings({ flinch: 'always' }).flinch, 'off');
});

/* ---------- Match: dealing, challenges, slaps, burns ---------- */
const seats = n => Array.from({ length: n }, (_, i) => ({ name: i ? 'Bot ' + i : 'You', bot: i ? 'club' : null }));
const cardKey = c => c.rank * 10 + c.suit;
function allCards(m) { return [...m.pile, ...m.burn, ...m.players.flatMap(p => p.hand)]; }
// A match with hand-picked hands (ranks only), for walking through the rules step by step.
function rigged(hands, first = 0, burn = 1) {
  const m = E.newMatch(seats(hands.length), { first, burn });
  m.players.forEach((p, i) => { p.hand = hands[i].map((r, j) => E.newCard(r, (i + j) % 4)); });
  return m;
}
function playOut(m) { const nx = E.matchNext(m); assert.strictEqual(nx.type, 'play', JSON.stringify(nx)); return E.matchPlay(m, nx.by); }

test('newMatch deals all 52 cards evenly round the table', () => {
  for (const [n, sizes] of [[2, [26, 26]], [3, [18, 17, 17]], [4, [13, 13, 13, 13]]]) {
    const m = E.newMatch(seats(n));
    assert.deepStrictEqual(m.players.map(p => p.hand.length), sizes);
    assert.strictEqual(new Set(allCards(m).map(cardKey)).size, 52);
    assert.strictEqual(m.turn, 1, 'the seat after you plays first');
  }
});
test('J gives the next player 1 try; when it runs out the face card player collects and leads', () => {
  const m = rigged([[11, 9], [5, 6, 7]]);
  playOut(m);
  assert.deepStrictEqual(m.challenge && [m.challenge.by, m.challenge.left], [0, 1]);
  assert.strictEqual(m.turn, 1);
  playOut(m);
  assert.deepStrictEqual(E.matchNext(m), { type: 'collect', by: 0, why: 'face' });
  const res = E.matchCollect(m, 0);
  assert.strictEqual(res.count, 2);
  assert.deepStrictEqual(m.players[0].hand.map(c => c.rank), [9, 11, 5], 'pile goes under the hand in play order');
  assert.strictEqual(m.turn, 0);
  assert.strictEqual(m.challenge, null);
});
test('Q, K and A give 2, 3 and 4 tries; a face card in reply passes the challenge back', () => {
  for (const [face, tries] of [[12, 2], [13, 3], [1, 4]]) {
    const m = rigged([[face], [2, 3, 4, 5, 6]]);
    playOut(m);
    for (let i = 0; i < tries; i++) playOut(m);
    assert.deepStrictEqual(E.matchNext(m), { type: 'collect', by: 0, why: 'face' }, `${face} gives ${tries}`);
  }
  const m = rigged([[13, 2, 3], [4, 12, 5]]);
  playOut(m); playOut(m); playOut(m); // K, 4, Q: now player 0 owes 2
  assert.deepStrictEqual([m.challenge.by, m.challenge.left, m.turn], [1, 2, 0]);
});
test('a responder who runs out mid-challenge hands the remaining tries to the next player', () => {
  const m = rigged([[12, 9], [4], [5, 6]]);
  playOut(m); // Q by 0
  playOut(m); // 4 by 1, who is now empty
  assert.strictEqual(m.challenge.left, 1);
  assert.deepStrictEqual(E.matchNext(m), { type: 'play', by: 2 });
  playOut(m); // 5 by 2
  assert.deepStrictEqual(E.matchNext(m), { type: 'collect', by: 0, why: 'face' });
});
test('a face card nobody else can answer goes straight to its player', () => {
  const m = rigged([[13, 9], []]);
  playOut(m);
  assert.deepStrictEqual(E.matchNext(m), { type: 'collect', by: 0, why: 'face' });
});
test('nobody left to play: the last player collects', () => {
  const m = rigged([[7], []]);
  playOut(m);
  assert.deepStrictEqual(E.matchNext(m), { type: 'collect', by: 0, why: 'empty' });
});
test('players with no cards are skipped, stay in until the pile is won, then go out', () => {
  const m = rigged([[2, 3], [], [4, 5]]);
  playOut(m);
  assert.deepStrictEqual(E.matchNext(m), { type: 'play', by: 2 });
  assert.strictEqual(m.players[1].out, false, 'still in while the pile is live');
  const res = E.matchCollect(m, 2);
  assert.deepStrictEqual(res.knocked, [1]);
  assert.strictEqual(m.players[1].out, true);
});
test('false slaps burn face down under the pile and never change the top-bottom card', () => {
  const m = rigged([[9, 4, 6], [7, 8, 10]], 0, 2);
  playOut(m); playOut(m);
  const bottom = m.pile[0];
  const r = E.matchBurn(m, 1);
  assert.deepStrictEqual(r, { burned: 2, out: false });
  assert.strictEqual(m.pile[0], bottom);
  assert.strictEqual(m.burn.length, 2);
  assert.strictEqual(m.players[1].hand.length, 0);
  E.matchCollect(m, 0);
  assert.strictEqual(m.players[0].hand.length, 2 + 2 + 2, 'winner gets the pile and the burned cards');
});
test('a false slap with no cards knocks you out, and voids a face card you laid', () => {
  const m = rigged([[13], [2, 3, 4]]);
  playOut(m); // K by 0, who is now empty
  const r = E.matchBurn(m, 0);
  assert.deepStrictEqual(r, { burned: 0, out: true });
  assert.strictEqual(m.challenge, null);
  assert.deepStrictEqual(E.matchOver(m), { winner: 1 });
  assert.strictEqual(E.matchResult(m, 'out'), 'lost');
});
test('matchResult for a timed match: most cards in hand wins, ties draw', () => {
  const m = rigged([[2, 3, 4], [5, 6], [7]]);
  assert.strictEqual(E.matchResult(m, 'time'), 'won');
  m.players[1].hand.push(E.newCard(8));
  assert.strictEqual(E.matchResult(m, 'time'), 'draw');
  m.players[1].hand.push(E.newCard(9));
  assert.strictEqual(E.matchResult(m, 'time'), 'lost');
});
test('2,000 random games keep every card, never let an empty or out player play, and finish', () => {
  let finished = 0, steps = 0;
  for (let g = 0; g < 2000; g++) {
    const m = E.newMatch(seats(2 + (g % 3)), { burn: 1 + (g % 2) });
    for (let s = 0; s < 20000; s++) {
      const nx = E.matchNext(m);
      if (nx.type === 'collect') {
        assert.ok(!m.players[nx.by].out, 'collector is in the game');
        E.matchCollect(m, nx.by);
      } else {
        assert.ok(m.players[nx.by].hand.length > 0 && !m.players[nx.by].out, 'player has cards');
        E.matchPlay(m, nx.by);
        const alive = E.matchAlive(m), who = alive[Math.floor(Math.random() * alive.length)];
        if (E.patternsOf(m.pile, DEFAULT_RULES).length && Math.random() < 0.7) E.matchCollect(m, who);
        else if (Math.random() < 0.08) E.matchBurn(m, who);
      }
      const cards = allCards(m);
      assert.strictEqual(cards.length, 52);
      assert.strictEqual(new Set(cards.map(cardKey)).size, 52);
      for (const p of m.players) assert.ok(!(p.out && p.hand.length), 'out players hold nothing');
      steps++;
      if (E.matchOver(m)) { finished++; break; }
    }
  }
  console.log(`     ${finished} of 2000 games finished, ${Math.round(steps / 2000)} steps on average`);
  assert.ok(finished >= 1990);
});

/* ---------- Bots ---------- */
function botStats(key, ctx, n = 20000) {
  let slaps = 0, sum = 0;
  for (let i = 0; i < n; i++) { const rt = E.botReaction(key, ctx); if (rt !== null) { slaps++; sum += rt; } }
  return { rate: slaps / n, mean: slaps ? sum / slaps : null };
}
test('bot profiles: speed and miss rate on real patterns', () => {
  for (const [key, rt, miss] of [['casual', 520, 0.2], ['club', 400, 0.08], ['shark', 300, 0.03]]) {
    const s = botStats(key, { valid: true, ownCard: false, hasCards: true });
    assert.ok(Math.abs(s.mean - rt) < 12, `${key} mean ${s.mean}`);
    assert.ok(Math.abs(1 - s.rate - miss) < 0.012, `${key} miss ${1 - s.rate}`);
  }
  const casualFalse = botStats('casual', { valid: false, hasCards: true }).rate;
  assert.ok(casualFalse > 0 && casualFalse < 0.02, 'Casual rarely false-slaps');
});
test('Spammer slaps nearly every card while it has cards, and never false-slaps without', () => {
  const s = botStats('spammer', { valid: false, hasCards: true });
  assert.ok(s.rate > 0.85 && Math.abs(s.mean - 200) < 10, JSON.stringify(s));
  assert.strictEqual(botStats('spammer', { valid: false, hasCards: false }).rate, 0);
});
test('Counter knows its own deck: about 170 ms when its own card makes the pattern', () => {
  const own = botStats('counter', { valid: true, ownCard: true, hasCards: true });
  const other = botStats('counter', { valid: true, ownCard: false, hasCards: true });
  assert.ok(Math.abs(own.mean - 170) < 8 && own.rate === 1, JSON.stringify(own));
  assert.ok(Math.abs(other.mean - 300) < 12, 'Shark speed otherwise');
});
test('slapRace: the earliest slap wins', () => {
  assert.deepStrictEqual(E.slapRace([{ who: 0, rt: 340 }, { who: 2, rt: 296 }, { who: 1, rt: null }]).winner, 2);
  assert.strictEqual(E.slapRace([{ who: 0, rt: null }]).winner, null);
});

/* ---------- Ladder, settings and history ---------- */
test('ladder: beating a bot one-on-one unlocks the next', () => {
  assert.deepStrictEqual(E.ladderUnlocked(E.cleanLadder(null)), ['casual']);
  assert.deepStrictEqual(E.ladderUnlocked(E.cleanLadder({ beaten: { casual: true } })), ['casual', 'club']);
  assert.deepStrictEqual(E.ladderUnlocked(E.cleanLadder({ beaten: { casual: true, club: true, shark: 'yes' } })), ['casual', 'club', 'shark']);
});
test('cleanSettings: match settings default sensibly and reject bad lineups', () => {
  const d = E.cleanSettings({});
  assert.deepStrictEqual([d.matchOpp, d.ladderBot, d.matchLen, d.burn], ['ladder', 'casual', 'full', 1]);
  assert.strictEqual(E.cleanSettings({ mode: 'match' }).mode, 'match');
  assert.deepStrictEqual(E.cleanSettings({ freeBots: { shark: 3 } }).freeBots, { casual: 0, club: 0, shark: 3, spammer: 0, counter: 0 });
  assert.deepStrictEqual(E.cleanSettings({ freeBots: { shark: 4 } }).freeBots, d.freeBots, 'more than 3 bots');
  assert.deepStrictEqual(E.cleanSettings({ freeBots: { shark: 2, club: 2 } }).freeBots, d.freeBots, 'total over 3');
  assert.deepStrictEqual(E.cleanSettings({ freeBots: {} }).freeBots, d.freeBots, 'no bots');
  assert.strictEqual(E.cleanSettings({ burn: 3 }).burn, 1);
  for (const k of Object.keys(V1_SETTINGS)) assert.deepStrictEqual(E.cleanSettings(V1_SETTINGS)[k], V1_SETTINGS[k], 'v1 fields survive: ' + k);
});
test('cleanHistory keeps match entries and their new fields', () => {
  const h = E.cleanHistory([{ at: 5, mode: 'match', acc: 40, avg: 380, falses: 2, pace: 900, deck: 'real', result: 'won', opp: 'Shark' }, { at: 4, mode: 'match', result: 'maybe' }]);
  assert.deepStrictEqual(h[0], { at: 5, mode: 'match', acc: 40, avg: 380, falses: 2, pace: 900, deck: 'real', result: 'won', opp: 'Shark' });
  assert.strictEqual('result' in h[1], false);
  assert.strictEqual(E.cleanHistory([{ at: 1, mode: 'bogus' }])[0].mode, 'live');
});

/* ---------- Mental math ---------- */
test('mathQuestion: Zetamac ranges, exact answers, only the enabled types', () => {
  const ALL = { add: true, sub: true, mul: true, div: true };
  const seen = {};
  let prev = null;
  for (let i = 0; i < 20000; i++) {
    const q = E.mathQuestion(ALL, prev);
    seen[q.type] = (seen[q.type] || 0) + 1;
    if (prev) assert.notStrictEqual(q.text, prev.text, 'no immediate repeat');
    prev = q;
    if (q.type === 'add') { assert.ok(q.x >= 2 && q.x <= 100 && q.y >= 2 && q.y <= 100); assert.strictEqual(q.answer, q.x + q.y); }
    if (q.type === 'sub') { assert.ok(q.y >= 2 && q.y <= 100 && q.answer >= 2 && q.answer <= 100); assert.strictEqual(q.x - q.y, q.answer); }
    if (q.type === 'mul') {
      const [s, l] = q.x <= 12 && q.y >= 2 && q.y <= 100 ? [q.x, q.y] : [q.y, q.x];
      assert.ok(s >= 2 && s <= 12 && l >= 2 && l <= 100, q.text);
      assert.strictEqual(q.answer, q.x * q.y);
    }
    if (q.type === 'div') { assert.ok(q.y >= 2 && q.y <= 12 && q.answer >= 2 && q.answer <= 100); assert.strictEqual(q.x, q.y * q.answer); }
    assert.ok(/^\d+ [+−×÷] \d+$/.test(q.text), q.text);
  }
  assert.deepStrictEqual(Object.keys(seen).sort(), ['add', 'div', 'mul', 'sub']);
  for (let i = 0; i < 500; i++) assert.strictEqual(E.mathQuestion({ mul: true }).type, 'mul');
  assert.strictEqual(E.mathQuestion({}).type, 'add', 'falls back to addition');
});
test('mathSummary: score, average per type, slowest questions', () => {
  const s = E.mathSummary([
    { type: 'add', text: '2 + 3', answer: 5, ms: 1000 },
    { type: 'add', text: '40 + 41', answer: 81, ms: 3000 },
    { type: 'div', text: '84 ÷ 7', answer: 12, ms: 6200 },
  ]);
  assert.strictEqual(s.score, 3);
  assert.strictEqual(s.avg, 3400);
  assert.deepStrictEqual(s.byType, [{ type: 'add', n: 2, avg: 2000 }, { type: 'div', n: 1, avg: 6200 }]);
  assert.deepStrictEqual(s.slowest[0], { text: '84 ÷ 7', answer: 12, ms: 6200 });
  assert.deepStrictEqual(E.mathSummary([]), { score: 0, avg: null, byType: [], slowest: [] });
});
test('math settings: hidden unless turned on, durations, at least one type', () => {
  assert.strictEqual(E.cleanSettings({ mode: 'math' }).mode, 'live', 'Math needs the extra drill turned on');
  assert.strictEqual(E.cleanSettings({ mode: 'math', extraMath: true }).mode, 'math');
  assert.strictEqual(E.cleanSettings({}).mathDur, 120);
  assert.strictEqual(E.cleanSettings({ mathDur: 180 }).mathDur, 180);
  assert.strictEqual(E.cleanSettings({ mathDur: 90 }).mathDur, 120);
  assert.deepStrictEqual(E.cleanSettings({ mathOps: { add: false, sub: false, mul: false, div: false } }).mathOps, { add: true, sub: false, mul: false, div: false });
  assert.deepStrictEqual(E.cleanMathBest({ best: { 60: 21, 120: 'x', 999: 4 } }), { best: { 60: 21, 120: 0, 180: 0 } });
  const h = E.cleanHistory([{ at: 9, mode: 'math', acc: 0, avg: 2400, falses: 0, pace: 0, deck: 'drill', score: 44, dur: 120 }]);
  assert.deepStrictEqual(h[0], { at: 9, mode: 'math', acc: 0, avg: 2400, falses: 0, pace: 0, deck: 'drill', score: 44, dur: 120 });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
