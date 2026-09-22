// node tests/scoring.test.js
const assert = require('assert');
const path = require('path');
const data = require(path.join(__dirname, '..', 'data.json'));
const L = require(path.join(__dirname, '..', 'app.js'));

const ids = data.questionOrder;
const fill = (fn) => Object.fromEntries(ids.map((id) => [id, fn(id, data.questions[id])]));
const run = (answers) => { const t = L.tally(data, answers); return L.evaluate(data, t.scores, t.impact); };

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok  ' + name); }

test('全選最高分：五軸 100%，同分規則取 D', () => {
  const r = run(fill(() => 3));
  data.resistanceOrder.forEach((k) => assert.strictEqual(r.percent[k], 100));
  assert.strictEqual(r.top, 'D');
  assert.strictEqual(r.isLow, false);
  assert.deepStrictEqual(r.ranked, ['D', 'P', 'S', 'E', 'U']);
});

test('只有 E 全選最高，其餘最低：最大阻力 E', () => {
  const r = run(fill((id, q) => (q.resistance === 'E' ? 3 : 0)));
  assert.strictEqual(r.top, 'E');
  assert.strictEqual(r.percent.E, 100);
  assert.strictEqual(r.percent.D, 0);
  assert.strictEqual(r.isLow, false);
});

test('全選最低：低阻力型，行動取 D（順序第一）', () => {
  const r = run(fill(() => 0));
  assert.strictEqual(r.isLow, true);
  assert.strictEqual(r.top, 'D');
});

test('低阻力邊界：每個阻力 3/9 = 33% 仍屬低阻力，4/9 = 44% 不屬於', () => {
  const r = run(fill((id) => (id.endsWith('1') ? 3 : 0)));
  data.resistanceOrder.forEach((k) => assert.strictEqual(r.percent[k], 33));
  assert.strictEqual(r.isLow, true);
  const r2 = run(fill((id) => (id.endsWith('1') ? 3 : id === 'U2' ? 1 : 0)));
  assert.strictEqual(r2.isLow, false);
  assert.strictEqual(r2.top, 'U');
});

test('同分規則 1：D 與 S 同為 6 分，S 的第 3 題較高 → S 勝出', () => {
  const a = fill(() => 0);
  Object.assign(a, { D1: 3, D2: 3, D3: 0, S1: 1, S2: 2, S3: 3 });
  const r = run(a);
  assert.strictEqual(r.scores.D, 6);
  assert.strictEqual(r.scores.S, 6);
  assert.strictEqual(r.top, 'S');
  assert.deepStrictEqual(r.ranked.slice(0, 2), ['S', 'D']);
});

test('同分規則 2：P 與 U 同分且第 3 題同分 → 依 D P S E U 取 P', () => {
  const a = fill(() => 0);
  Object.assign(a, { P1: 2, P2: 1, P3: 2, U1: 1, U2: 2, U3: 2 });
  const r = run(a);
  assert.strictEqual(r.scores.P, r.scores.U);
  assert.strictEqual(r.impact.P, r.impact.U);
  assert.strictEqual(r.top, 'P');
});

test('hash 編碼與還原，同分資訊保留', () => {
  const a = fill(() => 0);
  Object.assign(a, { D1: 3, D2: 3, D3: 0, S1: 1, S2: 2, S3: 3 });
  const r = run(a);
  const hash = L.encodeHash(data, r, { commitment: 9, goal: 1, whyNow: 2 });
  assert.strictEqual(hash, 'r=D6-P0-S6-E0-U0&k=00300&c=9&g=1&w=2');
  const d = L.decodeHash(data, '#' + hash);
  const r2 = L.evaluate(data, d.scores, d.impact);
  assert.strictEqual(r2.top, 'S');
  assert.strictEqual(d.commitment, 9);
  assert.strictEqual(d.goal, 1);
  assert.strictEqual(d.whyNow, 2);
});

test('hash 範例格式 #r=D3-P7-S2-E5-U4&c=9 可還原（無 k 時依順序判定）', () => {
  const d = L.decodeHash(data, '#r=D3-P7-S2-E5-U4&c=9');
  assert.deepStrictEqual(d.scores, { D: 3, P: 7, S: 2, E: 5, U: 4 });
  assert.strictEqual(L.evaluate(data, d.scores, d.impact).top, 'P');
});

test('hash 非法值回傳 null', () => {
  assert.strictEqual(L.decodeHash(data, '#r=D99-P7-S2-E5-U4'), null);
  assert.strictEqual(L.decodeHash(data, '#r=D3-P7'), null);
  assert.strictEqual(L.decodeHash(data, '#foo=1'), null);
  assert.strictEqual(L.decodeHash(data, ''), null);
});

test('承諾度分流：9、10 → call；1 到 8 → dm', () => {
  [9, 10].forEach((c) => assert.strictEqual(L.ctaBranch(data, c), 'call'));
  [1, 2, 3, 4, 5, 6, 7, 8].forEach((c) => assert.strictEqual(L.ctaBranch(data, c), 'dm'));
});

test('題庫結構：15 題、每個阻力 3 題、每個阻力恰好 1 題 impact、3 個行動', () => {
  assert.strictEqual(ids.length, 15);
  data.resistanceOrder.forEach((k) => {
    const qs = ids.filter((id) => data.questions[id].resistance === k);
    assert.strictEqual(qs.length, 3);
    assert.strictEqual(qs.filter((id) => data.questions[id].impact).length, 1);
    assert.strictEqual(data.resistances[k].actions.length, 3);
  });
});

console.log(`\n${passed} passed`);
