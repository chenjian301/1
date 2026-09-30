/**
 * apply-hud-layout.mjs —— 把预览页拖出来的布局改动写回 shared\balance.json
 *
 * 为什么要有它（而不是让人手抄数字）：
 *   tools\hud-preview.html 里拖出来的**就是 balance 的 key**（view.hud.rowGap / skillBar.gap 之类），
 *   手抄进一个 400 行的嵌套 JSON 里既慢又容易串行 —— 比如 skillBar.gap 与 functionBar.gap
 *   长得一模一样，抄错一行就是"怎么游戏里跟我拖的不一样"。
 *
 * 为什么是"只替换那几个数字"而不是 JSON.stringify 写回去：
 *   balance.json 里有 _readme / 逐行注释键人排的缩进 / CRLF —— 重新序列化会把整个文件重排成
 *   一个几百行的大 diff，评审时反而看不见真正改了什么。所以这里先做一次**位置扫描**（自己写的
 *   极简 JSON 扫描器，记录每个叶子数字在原文里的起止），只把那几个数字的字面量换掉，其余字节
 *   一个不动；写完再 JSON.parse 一遍，和"期望的新对象"逐字节深比较，对不上就不落盘 ——
 *   宁可不改，也不改坏（改坏了 check-minigame.ps1 会拦，但那时人已经懵了）。
 *
 * 用法（正常不用手敲，tools\apply-hud-layout.cmd 会包好）：
 *   tools\apply-hud-layout.cmd                       读剪贴板（预览页点「复制改动 JSON」之后）
 *   tools\apply-hud-layout.cmd D:\path\patch.json    读文件（预览页点「下载 .json」之后）
 *   ... --dry                                        只看会改什么，不写盘
 *
 * 退出码：0 = 成功（含"没有变化"），2 = 失败（一条都没写）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const balancePath = path.join(root, 'shared', 'balance.json');

const argv = process.argv.slice(2);

function argValue(flag) {
  const index = argv.indexOf(flag);
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : null;
}

const dry = argv.indexOf('--dry') >= 0;
const fileArg = argValue('--file') || argv.filter((a) => a.toLowerCase().endsWith('.json'))[0] || null;

function fail(message) {
  console.log('FAIL ' + message);
  process.exit(2);
}

/* ------------------------------------------------------------------ 1. 读 patch */

if (!fileArg) fail('没有给 patch：用法 tools\\apply-hud-layout.cmd [patch.json]（不给路径就读剪贴板）');
if (!fs.existsSync(fileArg)) fail('找不到 patch 文件：' + fileArg);
const patchText = fs.readFileSync(fileArg, 'utf8').replace(/^\uFEFF/, '').trim();
if (!patchText) fail('patch 是空的（剪贴板里没有内容？先在预览页点一下「复制改动 JSON」）');

let patchDoc = null;
try {
  patchDoc = JSON.parse(patchText);
} catch (error) {
  fail('patch 不是合法 JSON：' + error.message);
}
if (patchDoc && patchDoc.tool && patchDoc.tool !== 'hud-preview') {
  fail('这份 JSON 不是 hud-preview 导出的（tool=' + patchDoc.tool + '）');
}
const entries = patchDoc && patchDoc.patch && typeof patchDoc.patch === 'object' ? patchDoc.patch : patchDoc;
if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
  fail('patch 里没有 { "路径": 新值 } 这张表');
}
const keys = Object.keys(entries);
if (!keys.length) fail('patch 里一处改动都没有（预览页上还没有改动？）');

/* --------------------------------------------------- 2. 扫 balance.json 的数字位置 */

/**
 * 极简 JSON 扫描器：把每个叶子标量在原文里的 [start, end) 记下来，path 用点号拼。
 * 不追求通用（balance.json 是我们自己生成的良构 JSON），但要能**原样定位**。
 */
function scanLeaves(text, pos, pathParts, out) {
  pos = skipSpace(text, pos);
  const ch = text[pos];
  if (ch === '{') {
    pos = skipSpace(text, pos + 1);
    if (text[pos] === '}') return pos + 1;
    for (;;) {
      pos = skipSpace(text, pos);
      if (text[pos] !== '"') throw new Error('第 ' + pos + ' 个字符：对象里期望一个 key');
      const keyEnd = stringEnd(text, pos);
      const key = JSON.parse(text.slice(pos, keyEnd));
      pos = skipSpace(text, keyEnd);
      if (text[pos] !== ':') throw new Error('第 ' + pos + ' 个字符：key 后面不是冒号');
      pos = scanLeaves(text, pos + 1, pathParts.concat([key]), out);
      pos = skipSpace(text, pos);
      if (text[pos] === ',') { pos += 1; continue; }
      if (text[pos] === '}') return pos + 1;
      throw new Error('第 ' + pos + ' 个字符：对象里期望 , 或 }');
    }
  }
  if (ch === '[') {
    pos = skipSpace(text, pos + 1);
    if (text[pos] === ']') return pos + 1;
    let index = 0;
    for (;;) {
      pos = scanLeaves(text, pos, pathParts.concat([String(index)]), out);
      index += 1;
      pos = skipSpace(text, pos);
      if (text[pos] === ',') { pos += 1; continue; }
      if (text[pos] === ']') return pos + 1;
      throw new Error('第 ' + pos + ' 个字符：数组里期望 , 或 ]');
    }
  }
  const start = pos;
  if (ch === '"') pos = stringEnd(text, pos);
  else while (pos < text.length && ',}] \t\r\n'.indexOf(text[pos]) < 0) pos += 1;
  out.push({ path: pathParts.join('.'), value: JSON.parse(text.slice(start, pos)), start: start, end: pos });
  return pos;
}

function skipSpace(text, pos) {
  while (pos < text.length && ' \t\r\n'.indexOf(text[pos]) >= 0) pos += 1;
  return pos;
}

function stringEnd(text, pos) {
  let i = pos + 1;
  while (i < text.length) {
    if (text[i] === '\\') { i += 2; continue; }
    if (text[i] === '"') return i + 1;
    i += 1;
  }
  throw new Error('第 ' + pos + ' 个字符：字符串没有收尾引号');
}

function setPath(target, key, value) {
  const parts = key.split('.');
  let node = target;
  for (let i = 0; i < parts.length - 1; i += 1) node = node[parts[i]];
  node[parts[parts.length - 1]] = value;
}

if (!fs.existsSync(balancePath)) fail('找不到 ' + balancePath);
const rawFile = fs.readFileSync(balancePath, 'utf8');
const bom = rawFile.charCodeAt(0) === 0xFEFF ? '\uFEFF' : '';
const text = bom ? rawFile.slice(1) : rawFile;

let before = null;
try {
  before = JSON.parse(text);
} catch (error) {
  fail('shared\\balance.json 现在就不是合法 JSON（先修它）：' + error.message);
}

const leaves = [];
try {
  scanLeaves(text, 0, [], leaves);
} catch (error) {
  fail('扫描 balance.json 失败：' + error.message);
}
const byPath = new Map();
for (const leaf of leaves) if (!byPath.has(leaf.path)) byPath.set(leaf.path, leaf);

/** 路径写错时给个提示：优先"同一末段的其他路径"，其次末段互为前缀的（gapp -> gap） */
function suggest(key) {
  const tail = key.split('.').pop();
  let loose = null;
  for (const known of byPath.keys()) {
    if (known === key) continue;
    const knownTail = known.split('.').pop();
    if (knownTail === tail) return known;
    if (!loose && (knownTail.indexOf(tail) === 0 || tail.indexOf(knownTail) === 0)) loose = known;
  }
  return loose;
}

/* ------------------------------------------------------------- 3. 逐条校验 + 改文本 */

const plan = [];
for (const key of keys) {
  const leaf = byPath.get(key);
  if (!leaf) {
    const hint = suggest(key);
    fail('balance.json 里没有 ' + key + (hint ? '（是不是想写 ' + hint + '？）' : ''));
  }
  if (typeof leaf.value !== 'number') {
    fail(key + ' 当前不是数字（' + JSON.stringify(leaf.value) + '），不敢动它');
  }
  const next = entries[key];
  if (typeof next !== 'number' || !isFinite(next)) {
    fail(key + ' 的新值不是有限数字：' + JSON.stringify(next));
  }
  plan.push({ path: key, from: leaf.value, to: next, start: leaf.start, end: leaf.end });
}

// 从后往前替换：前面那些位置才不会因为长度变化而移位
let nextText = text;
for (const item of plan.slice().sort((a, b) => b.start - a.start)) {
  nextText = nextText.slice(0, item.start) + String(item.to) + nextText.slice(item.end);
}

// 落盘前先验：结果必须与"把 patch 应用在解析结果上"完全一致
let after = null;
try {
  after = JSON.parse(nextText);
} catch (error) {
  fail('替换之后不是合法 JSON（已放弃，没有写盘）：' + error.message);
}
const expected = JSON.parse(JSON.stringify(before));
for (const item of plan) setPath(expected, item.path, item.to);
if (JSON.stringify(after) !== JSON.stringify(expected)) {
  fail('替换结果与期望的结构不一致（已放弃，没有写盘）—— 这份 patch 与 balance.json 对不上');
}

const changed = plan.filter((item) => item.from !== item.to);
const width = plan.reduce((max, item) => Math.max(max, item.path.length), 0);

if (!changed.length) {
  console.log('APPLY-HUD-LAYOUT ok  没有变化（patch 里的值就是 balance.json 现在的值，一个字节都没动）');
  process.exit(0);
}
if (dry) {
  console.log('APPLY-HUD-LAYOUT ok  --dry：只列出会改什么，没有写盘');
  for (const item of changed) console.log('   ' + item.path.padEnd(width) + '  ' + item.from + ' -> ' + item.to);
  process.exit(0);
}

fs.writeFileSync(balancePath, bom + nextText, 'utf8');
console.log('APPLY-HUD-LAYOUT ok  shared\\balance.json 改了 ' + changed.length + ' 个数（只替换字面量，其余字节没动）');
for (const item of changed) console.log('   ' + item.path.padEnd(width) + '  ' + item.from + ' -> ' + item.to);
console.log('');
console.log('下一步：tools\\minigame-now.cmd  （重新生成 01-balance.js + 重建 game.js + 全量自检）');

