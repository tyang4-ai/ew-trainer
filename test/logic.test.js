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

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
