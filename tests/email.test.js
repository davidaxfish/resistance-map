// node tests/email.test.js
const assert = require('assert');
const path = require('path');
const data = require(path.join(__dirname, '..', 'data.json'));
const Gw = require(path.join(__dirname, '..', 'email-gateway.gs'));
const Site = require(path.join(__dirname, '..', 'app.js'));

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok  ' + name); }

const good = {
  sessionId: 'abc-123', name: '小明', email: 'ming@example.com',
  scores: { D: 5, P: 7, S: 3, E: 4, U: 2 }, impact: { D: 2, P: 2, S: 1, E: 0, U: 1 }, commitment: 9,
  resultUrl: 'https://evil.example/phish'
};
const parse = (o) => Gw.parseInput_(JSON.stringify(o), data);
const build = (o) => Gw.buildEmail_(data, parse(o));

test('合法輸入通過驗證，並忽略瀏覽器傳來的 resultUrl', () => {
  const i = parse(good);
  assert.ok(i);
  assert.strictEqual(i.email, 'ming@example.com');
  assert.strictEqual(i.resultUrl, undefined);
});

test('拒絕：壞 Email、空稱呼、分數超出範圍、非整數、缺欄位、壞 JSON', () => {
  assert.strictEqual(parse({ ...good, email: 'bad' }), null);
  assert.strictEqual(parse({ ...good, email: 'a@b.c' }), null);
  assert.strictEqual(parse({ ...good, email: 'a@b.com, c@d.com' }), null);
  assert.strictEqual(parse({ ...good, email: 'a@b.com\nBcc: x@y.com' }), null);
  assert.strictEqual(parse({ ...good, name: '   ' }), null);
  assert.strictEqual(parse({ ...good, scores: { ...good.scores, D: 10 } }), null);
  assert.strictEqual(parse({ ...good, scores: { ...good.scores, P: -1 } }), null);
  assert.strictEqual(parse({ ...good, scores: { ...good.scores, S: 2.5 } }), null);
  const { U, ...fewer } = good.scores;
  assert.strictEqual(parse({ ...good, scores: fewer }), null);
  assert.strictEqual(Gw.parseInput_('{not json', data), null);
  assert.strictEqual(Gw.parseInput_('', data), null);
});

test('信件內容：主旨有稱呼、含 1on1 預約、Skool about、IG 連結與結果連結', () => {
  const m = build(good);
  assert.ok(m.subject.includes('小明'));
  assert.ok(m.html.includes('https://calendly.com/ring390/nothinkfit'));
  assert.ok(m.html.includes('https://www.skool.com/fu-system-3607/about'));
  assert.ok(m.html.includes('https://www.instagram.com/kmf_kuo/'));
  assert.ok(m.html.includes('預約 45－50 分鐘 1on1 診斷電話'));
  assert.ok(m.html.includes('體力成本'), 'P 最高');
  assert.ok(m.text.includes('https://calendly.com/ring390/nothinkfit'));
  assert.ok(m.text.includes('https://www.skool.com/fu-system-3607/about'));
  assert.ok(m.text.includes('https://www.instagram.com/kmf_kuo/'));
  assert.strictEqual(m.url, 'https://davidaxfish.github.io/resistance-map/#r=D5-P7-S3-E4-U2&k=22101&c=9');
  assert.ok(!m.html.includes('evil.example'));
});

test('預約、Skool、IG 連結都放在信的底部，位置在結果與行動之後', () => {
  const h = build(good).html;
  const at = (s) => h.indexOf(s);
  assert.ok(at('今天就能做的 3 件事') < at('calendly.com'));
  assert.ok(at('calendly.com') < at('skool.com'));
  assert.ok(at('skool.com') < at('instagram.com'));
});

test('HTML 跳脫：稱呼裡的 script 不會被執行', () => {
  const m = build({ ...good, name: '<script>alert(1)</script>"x' });
  assert.ok(!m.html.includes('<script>alert'));
  assert.ok(!m.subject.includes('<'));
  assert.ok(Gw.cleanName_('a'.repeat(80)).length === 30);
});

test('低阻力型使用低阻力文案', () => {
  const m = build({ ...good, scores: { D: 1, P: 0, S: 2, E: 1, U: 0 } });
  assert.ok(m.html.includes(data.lowType.title));
  assert.strictEqual(m.result.isLow, true);
});

test('判定結果和網站 app.js 完全一致（含同分規則），隨機 500 組', () => {
  const max = Site.maxScores(data);
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % (n + 1); };
  for (let t = 0; t < 500; t++) {
    const scores = {}, impact = {};
    data.resistanceOrder.forEach((k) => { scores[k] = rnd(max[k]); impact[k] = rnd(3); });
    const a = Site.evaluate(data, scores, impact);
    const b = Gw.evaluate_(data, scores, impact);
    assert.strictEqual(b.top, a.top);
    assert.deepStrictEqual(b.percent, a.percent);
    assert.strictEqual(b.isLow, a.isLow);
  }
});

test('信件文案通過文案規則（禁用詞、破折號、「不是…是…」、批評意志力）', () => {
  const t = build(good).text + JSON.stringify(data.email);
  assert.ok(!/底層邏輯|底層思維|第一性原理/.test(t));
  assert.ok(!/[—–]|──/.test(t));
  assert.ok(!/不是[^。！？\n"]{0,40}?是/.test(t));
  assert.ok(!/你很痛苦|你很失敗|意志力(不夠|太差|薄弱)/.test(t));
});

console.log(`\n${passed} passed`);
