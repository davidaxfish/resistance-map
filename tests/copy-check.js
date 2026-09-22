// node tests/copy-check.js
// 1) 文案規則：禁用詞、破折號、「不是……是……」句型
// 2) 程式檔（app.js / index.html / style.css）不得出現中文
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const problems = [];
const copy = read('data.json');
const rules = [
  [/底層邏輯|底層思維|第一性原理|本質邏輯/g, '禁用詞（底層邏輯與同義詞）'],
  [/[—–]|──/g, '破折號'],
  [/不是[^。！？\n"]{0,40}?是/g, '「不是……是……」句型'],
  [/你很痛苦|你很失敗|意志力(不夠|太差|薄弱)/g, '直接指責或批評意志力'],
  [/[!?,:;]\s*[一-鿿]|[一-鿿][!?,;]/g, '中文旁的半型標點'],
  [/疾病|藥物|處方|診斷出|治療/g, '醫療相關字眼']
];
rules.forEach(([re, label]) => {
  const m = copy.match(re);
  if (m) problems.push(`data.json ${label}：${[...new Set(m)].join('、')}`);
});

['app.js', 'index.html', 'style.css'].forEach((f) => {
  const src = read(f).split('\n');
  src.forEach((line, i) => {
    if (/[㐀-鿿＀-￯　-〿]/.test(line)) problems.push(`${f}:${i + 1} 寫死的中文：${line.trim()}`);
  });
});

if (problems.length) {
  console.log('FAIL\n' + problems.join('\n'));
  process.exit(1);
}
console.log('copy-check: PASS（data.json 文案規則、程式檔無寫死中文）');
