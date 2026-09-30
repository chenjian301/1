/**
 * hud-preview.mjs —— HUD 布局预览（先把几何算成一张表，再生成一个能在浏览器里看的页面）
 *
 * 为什么需要它：
 *   布局只能靠人眼验收（01-game-design §2 的三条纪律、02-architecture §10 的验证策略），
 *   但"人眼验收"现在的代价是**开抖音 IDE → 等模拟器 → 手动点一遍**，
 *   而改一个 `view.hud.rowGap` 只想看"两条按钮挤不挤"时，这个代价太高。
 *   于是有了这个工具：**不复制任何坐标**，它加载的就是 `douyin-minigame\game.js` 本体 ——
 *   真几何、真按钮表、真的 `G.SCREEN` 适配，所以它永远不会和游戏长得不一样。
 *
 * 它做三件事：
 *   1. 在 node 里用真实代码把底部动作栏的坐标算出来，打印几个常见手机尺寸下的表
 *      （含"功能图标行与摇杆触发区重叠多少"这种真机才会疼的数）；
 *   2. 生成 `tools\hud-preview.html`（内联整个 bundle，无外部依赖、file:// 直接开），
 *      页面里可以换手机尺寸 / 换场景 / 开参考线 / 实时跑，还能导出 720x1600 的设计稿 PNG；
 *   3. 生成完立刻把页面里那段驱动脚本喂给一个 stub DOM + 假 canvas 跑一遍 ——
 *      "预览页白屏"会被误读成"游戏坏了"，所以这个产物也得有自动化验收。
 *
 * 用法（本机没有独立 node，用抖音开发者工具自带的 Electron 当 node）：
 *   tools\hud-preview.cmd                        ← 生成并打开浏览器（推荐）
 *   powershell -ExecutionPolicy Bypass -File tools\minigame-node.ps1 tools\hud-preview.mjs
 *
 * 生成的 .html 是**产物**：改完 src\ / balance.json 后重跑一次即可（已进 .gitignore）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const bundlePath = path.join(root, 'douyin-minigame', 'game.js');
const outPath = path.join(here, 'hud-preview.html');

if (!fs.existsSync(bundlePath)) {
  console.log('FAIL 找不到 douyin-minigame\\game.js（先跑 tools\\build-minigame.ps1）');
  process.exit(2);
}

const code = fs.readFileSync(bundlePath, 'utf8');

/* game.js 会被内联进 <script>，所以要确认它没有能提前关掉脚本的字符串 */
if (code.indexOf('</script') >= 0) {
  console.log('FAIL game.js 里出现了 </script，内联进 HTML 会截断脚本');
  process.exit(2);
}

const G = new Function('console', 'tt', 'setTimeout', code + '\n; return G;')(console, undefined, setTimeout);

/* 预览的是"当前 game.js"：src\ 比它新就提醒一句（避免对着旧快照量坐标） */
const srcDir = path.join(root, 'douyin-minigame', 'src');
const newestPart = fs.readdirSync(srcDir)
  .filter((name) => name.slice(-3) === '.js')
  .reduce((newest, name) => Math.max(newest, fs.statSync(path.join(srcDir, name)).mtimeMs), 0);
if (fs.statSync(bundlePath).mtimeMs < newestPart) {
  console.log('提示：game.js 比 src\\*.js 旧 → 先跑 tools\\minigame-now.cmd（重建）再看预览');
  console.log('');
}

/* ------------------------------------------------------------ 1. 先在 node 里算真几何 */

G.SAVE.clear();
G.GAME.boot();
G.GAME.beginPlaying('预览者');

const SCREENS = [
  { label: 'iPhone 375x812', cssW: 375, cssH: 812 },
  { label: 'iPhone 390x844', cssW: 390, cssH: 844 },
  { label: 'Android 360x780', cssW: 360, cssH: 780 },
  { label: '设计稿 720x1600', cssW: 720, cssH: 1600 }
];

function round(value) {
  return Math.round(value * 10) / 10;
}

/** 一个屏尺寸下，底部动作栏的完整坐标链（全部来自 17-hud.js 的导出） */
function geometry(cssW, cssH) {
  G.SCREEN.resize({ cssW: cssW, cssH: cssH, dpr: 1, safeArea: { top: 0, bottom: 0 } });
  const view = G.GAME.uiView();
  const inside = G.HUD.buttons({ save: G.GAME.state.save, inCamp: true });
  const outside = G.HUD.buttons({ save: G.GAME.state.save, inCamp: false });
  // 摇杆触发区：几何只有一个出处 —— 15-input.js 的 stickZone()。
  // A7 修订后它的下边**吸在吸底动作栏的顶边**（不再一路铺到屏幕最底），所以这一排按钮不再和摇杆抢手指。
  const zone = G.INPUT.stickZone();
  const zoneW = zone.right;
  const zoneTop = zone.top;
  // 面板卡片（2026-10-01 用户把 heightRatio 0.42 拖到 0.66 之后，最该盯的就是它到底有没有压到动作栏）
  const card = G.PANELS.rect();
  // A11 之二：设置面板里的**视角缩放轴**（滑动条）—— 圆钮滑到两头也不能越出轨道和卡片，
  // 所以这把尺子量的是"轨道 + 圆钮"两端的实际坐标（画与命中读的是同一份几何）。
  const sliderCfg = G.BAL.view.zoomSlider;
  G.PANELS.open('menu');
  const sliderRows = G.PANELS.rows(G.GAME.uiView()).filter((r) => r.id === 'menu:zoom');
  const sliderRow = sliderRows.length ? sliderRows[0] : null;
  let sliderOk = false;
  let sliderText = '设置面板里没有缩放轴那一行';
  if (sliderRow) {
    const trackX = sliderRow.x + sliderCfg.endPad;
    const trackW = sliderRow.w - sliderCfg.endPad * 2;
    sliderOk = trackX - sliderCfg.knobRadius >= card.x &&
      trackX + trackW + sliderCfg.knobRadius <= card.x + card.w &&
      sliderRow.y >= card.y &&
      sliderRow.y + sliderRow.h <= card.y + card.h;
    sliderText = '轨道 ' + Math.round(trackW) + ' 设计单位（' + Math.round(trackW * G.SCREEN.scale()) +
      ' CSS px）· 圆钮 ' + sliderCfg.knobRadius + ' · ' + (sliderOk ? '两端都在卡片里' : '⚠ 有越界');
  }
  G.PANELS.close();
  // 最左 / 最右要取 min / max：进了营地以后「营」不是数组第一个（它是追加在后面的），
  // 拿 inside[0] 会量成 chest 的左边缘，把"伸进摇杆区多少"少算一半
  const rowLeft = Math.min.apply(null, inside.map((b) => b.x - b.r));
  const rowRight = Math.max.apply(null, inside.map((b) => b.x + b.r));
  const rowTop = outside[0].y - outside[0].r;
  // 左侧边栏（本次新增）：它必须**整条在卡片左边** —— 20-main 的触摸路由是"卡片优先"，
  // 被卡片盖住就等于那两枚键点不到（自检也盯着同一条缝，这里再逐屏量一次）
  const rail = G.HUD.sideBarRect();
  const sideRight = rail ? rail.x + rail.w : 0;
  const sideGap = rail ? card.x - sideRight : 999;
  // 圆键越过屏幕边：半个键在屏外只是"不好按"（提醒），整个跑到屏外就是按不到（自检红）——
  // 拖 functionBar.slots / radius / gap 最容易拖出这种情况（整排宽 = 槽位 x 直径 + 间距，> 屏宽就顶出去）
  const over = inside
    .map((b) => ({ id: b.id, out: Math.max(b.r - b.x, b.x + b.r - G.SCREEN.width()) }))
    .filter((o) => o.out > 0.001);
  const fullyOff = inside
    .filter((b) => b.x + b.r <= 0 || b.x - b.r >= G.SCREEN.width())
    .map((b) => b.id);
  // 触发区与功能图标行的**真实**重叠：横向按 CSS px 报（肉眼可见的那种"压住"），
  // 纵向按设计单位报 —— A7 修订的验收标准就是"纵向 = 0"。
  const rowBottom = rowTop + outside[0].r * 2;
  const overlapH = Math.max(0, Math.min(zone.right, rowRight) - Math.max(zone.left, rowLeft));
  const overlapV = Math.max(0, Math.min(zone.bottom, rowBottom) - Math.max(zone.top, rowTop));
  return {
    scale: G.SCREEN.scale(),
    width: G.SCREEN.width(),
    height: G.SCREEN.height(),
    safeTop: G.SCREEN.safeTop(),
    safeBottom: G.SCREEN.safeBottom(),
    expTop: G.HUD.expTop(),
    skillRowY: G.HUD.skillRowY(),
    functionRowY: G.HUD.functionRowY(),
    bottomBarTop: G.HUD.bottomBarTop(),
    buttons: view.buttons,
    inside: inside,
    outside: outside,
    zone: zone,
    // 面板卡片：底边离"整条吸底动作栏的顶边"还有多少设计单位（>= 0 = 没压到功能键 / 技能键 / 经验条；
    // 卡片高 0.42 时是 404，0.66 时只剩 20 —— 再往上拖就会压住那一排键，力臂只有这么多）
    cardTop: card.y,
    cardBottom: card.y + card.h,
    panelGap: G.HUD.bottomBarTop() - (card.y + card.h),
    zoneOverlapCss: overlapH * G.SCREEN.scale(),
    zoneOverlapDesign: overlapV,
    // 纵向真的压上了吗？（A7 修订后应当是 no：那一排整体在触发区之下）
    rowInsideZone: overlapV > 0,
    // 有键顶出屏幕多少（设计单位 / CSS 像素）+ 是谁；整个跑出去的是 fullyOff
    overDesign: over.length ? Math.max.apply(null, over.map((o) => o.out)) : 0,
    overCss: over.length ? Math.max.apply(null, over.map((o) => o.out)) * G.SCREEN.scale() : 0,
    overIds: over.map((o) => o.id),
    fullyOff: fullyOff,
    bandCss: (G.SCREEN.height() - G.HUD.bottomBarTop()) * G.SCREEN.scale(),
    rowRightCss: rowRight * G.SCREEN.scale(),
    fixedSlot: inside[0].x === outside[0].x,
    sliderOk: sliderOk,
    sliderText: sliderText,
    // 左侧边栏（本次新增）：底板右边到卡片左边的缝（>= 0 才算没被盖住）
    sideBar: rail,
    sideBarGap: sideGap
  };
}

console.log('== 换屏幕尺寸：底部动作栏（设计单位，/scale 后是 CSS 像素）==');
console.log('');
const reports = [];
for (const screen of SCREENS) {
  const g = geometry(screen.cssW, screen.cssH);
  reports.push({ screen: screen, g: g });
  const s = Math.round(g.scale * 10000) / 10000;
  console.log(`${screen.label}  scale=${s}  逻辑屏 ${g.width}x${Math.round(g.height)}  安全区 ${g.safeTop}/${g.safeBottom}`);
  console.log(`   expTop=${round(g.expTop)}  skillRowY=${round(g.skillRowY)}  functionRowY=${round(g.functionRowY)}  bottomBarTop=${round(g.bottomBarTop)}`);
  console.log(`   底栏占高 ${Math.round(g.bandCss)} CSS px（含 ${Math.round(g.safeBottom * g.scale)} CSS 安全区）`);
  console.log(`   摇杆触发区 ${Math.round(g.zone.right * g.scale)}x${Math.round((g.zone.bottom - g.zone.top) * g.scale)} CSS px，上边 y=${Math.round(g.zone.top)} / 下边 y=${Math.round(g.zone.bottom)}（= bottomBarTop）设计单位`);
  console.log(`   与功能图标行重叠：横向 ${Math.round(g.zoneOverlapCss)} CSS px、纵向 ${round(g.zoneOverlapDesign)} 设计单位（0 = 不抢按钮）   固定槽位=${g.fixedSlot ? 'ok' : 'BROKEN'}`);
  console.log(`   面板卡片 y=${Math.round(g.cardTop)}..${Math.round(g.cardBottom)}（高 ${Math.round(g.cardBottom - g.cardTop)}）离动作栏顶边 ${round(g.panelGap)} 设计单位`);
  console.log(`   左侧边栏 y=${Math.round(g.sideBar.y)}..${Math.round(g.sideBar.y + g.sideBar.h)}  离卡片左边 ${round(g.sideBarGap)} 设计单位（>= 0 = 没被卡片盖住）`);
  console.log(`   视角缩放轴：${g.sliderText}（A11 之二：一屏 ${G.BAL.view.zoomSlider.minTiles}~${G.BAL.view.zoomSlider.maxTiles} 格）`);
  if (g.overIds.length) {
    console.log(`   ⚠ ${g.overIds.join(' / ')} 顶出屏幕边 ${round(g.overDesign)} 设计单位 = ${Math.round(g.overCss)} CSS px（整排比屏还宽：拖 slots / radius / gap 会这样）`);
  }
  console.log('');
}

const last = reports[reports.length - 1].g;
console.log('== 设计稿 720x1600：每个键的圆心（命中测试用的就是这一份）==');
console.log('');
const line = (list, title) => {
  console.log(title);
  for (const b of list) {
    console.log(`   ${b.id.padEnd(7)} ${b.label.padEnd(3)} x=${Math.round(b.x * 10) / 10}  y=${Math.round(b.y * 10) / 10}  r=${b.r}`);
  }
};
line(last.inside, '   在营地里（「营」固定占最左槽位 0）：');
line(last.outside, '   在营地外（其余 5 个键的 x 与上面完全一致）：');
console.log('');
console.log('   技能键：' + last.buttons.filter((b) => b.id.indexOf('skill') === 0).map((b) => `${b.label}(${Math.round(b.x)},${Math.round(b.y)})`).join(' '));
console.log('');
const worst = reports.reduce((a, b) => (b.g.zoneOverlapCss > a.g.zoneOverlapCss ? b : a));
const worstOver = reports.reduce((a, b) => (b.g.overDesign > a.g.overDesign ? b : a));
const worstGap = reports.reduce((a, b) => (b.g.panelGap < a.g.panelGap ? b : a));
console.log(`HUD-PREVIEW geometry ok=${last.fixedSlot && last.bottomBarTop < last.functionRowY && last.sliderOk} worstZoneOverlapCss=${Math.round(worst.g.zoneOverlapCss)} (${worst.screen.label}) worstButtonOverDesign=${round(worstOver.g.overDesign)} (${worstOver.screen.label}) worstPanelGap=${round(worstGap.g.panelGap)} (${worstGap.screen.label}) sliderOk=${last.sliderOk}`);
console.log('');

/* ------------------------------------------------------------ 2. 生成浏览器预览页 */

const CSS = [
  ':root { color-scheme: dark; }',
  '* { box-sizing: border-box; }',
  'body { margin: 0; background: #0f1420; color: #dfe6f5; font-family: "Microsoft YaHei", system-ui, sans-serif; }',
  'header { display: flex; align-items: baseline; gap: 14px; padding: 10px 16px; border-bottom: 1px solid #23304a; }',
  'header h1 { margin: 0; font-size: 15px; }',
  'header span { font-size: 12px; color: #8ea0c0; }',
  'main { display: flex; align-items: flex-start; gap: 18px; padding: 16px; }',
  '#stage-pane { flex: 1 1 auto; display: flex; flex-direction: column; align-items: center; }',
  '#phone { border: 10px solid #1c2436; border-radius: 30px; background: #0b1020; box-shadow: 0 12px 40px rgba(0,0,0,.5); transform-origin: top center; }',
  '#phone canvas { display: block; border-radius: 20px; }',
  '#legend { margin-top: 10px; font-size: 11px; line-height: 1.7; color: #8ea0c0; text-align: center; }',
  '#side { flex: 0 0 340px; display: flex; flex-direction: column; gap: 10px; }',
  '.card { padding: 10px 12px; border: 1px solid #24304a; border-radius: 10px; background: #151c2b; }',
  '.card h2 { margin: 0 0 8px; font-size: 12px; font-weight: 600; letter-spacing: .06em; color: #8ea0c0; }',
  '.row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }',
  'button { font: inherit; font-size: 12px; padding: 5px 9px; border: 1px solid #2f3d5c; border-radius: 7px; background: #1b2436; color: #cfe0ff; cursor: pointer; }',
  'button:hover { background: #233049; }',
  'button.on { border-color: #4d78ff; background: #2b5cff; color: #fff; }',
  'label { display: flex; align-items: center; gap: 6px; font-size: 12px; cursor: pointer; }',
  'input[type=number] { width: 66px; padding: 3px 5px; border: 1px solid #2f3d5c; border-radius: 6px; background: #0f1626; color: #dfe6f5; font: inherit; font-size: 12px; }',
  'pre { margin: 0; max-height: 300px; overflow: auto; font-family: Consolas, monospace; font-size: 11px; line-height: 1.5; white-space: pre-wrap; color: #a9c4ff; }',
  '.sw { display: inline-block; width: 10px; height: 10px; margin-right: 4px; border-radius: 2px; vertical-align: -1px; }',
  '.hint { font-size: 11px; line-height: 1.6; color: #8ea0c0; }',
  '#editKnobs { max-height: 250px; overflow: auto; margin: 4px 0 6px; }',
  '.grp { margin: 7px 0 3px; font-size: 11px; color: #6f82a6; letter-spacing: .05em; }',
  '.knob { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #b9c8e6; }',
  '.knob .k { flex: 1 1 auto; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }',
  '.knob input[type=range] { flex: 0 0 84px; }',
  '.knob b { min-width: 40px; text-align: right; color: #ffd479; font-weight: 600; }',
  '.knob.dirty b { color: #ff9a6b; }',
  '.knob button { padding: 1px 5px; }',
  '#changes { max-height: 130px; }',
  '#patch { max-height: 150px; }',
  '#patchBox { display: block; box-sizing: border-box; width: 100%; height: 46px; margin-top: 6px; padding: 4px 6px; border: 1px solid #2f3d5c; border-radius: 6px; background: #0f1626; color: #a9c4ff; font-family: Consolas, monospace; font-size: 11px; resize: vertical; }'
].join('\n');

const BODY = [
  '<header>',
  '  <h1>HUD 布局预览</h1>',
  '  <span id="meta">加载中…</span>',
  '</header>',
  '<main>',
  '  <div id="stage-pane">',
  '    <div id="wrap"><div id="phone"><canvas id="stage"></canvas></div></div>',
  '    <div id="legend"></div>',
  '  </div>',
  '  <div id="side">',
  '    <div class="card"><h2>场景①（静态：坐标不动，方便量）</h2><div class="row" id="scenarios"></div></div>',
  '    <div class="card"><h2>屏幕 / 缩放</h2><div class="row" id="screens"></div>',
  '      <div class="row" style="margin-top:6px"><label>宽 <input type="number" id="cssW" min="200" max="1400" step="1"></label>',
  '      <label>高 <input type="number" id="cssH" min="300" max="2400" step="1"></label>',
  '      <label>安全区上 <input type="number" id="safeTop" min="0" max="200" step="1"></label>',
  '      <label>安全区下 <input type="number" id="safeBottom" min="0" max="200" step="1"></label></div>',
  '      <div class="row" style="margin-top:6px"><button id="fit">适配窗口</button><button id="zoom1">100%</button>',
  '      <button id="zoom15">150%</button><button id="zoom05">50%</button></div></div>',
  '    <div class="card"><h2>参考线</h2><div class="row" id="guides"></div></div>',
  '    <div class="card"><h2>拖动改布局（改的是 balance 里的真数）</h2>',
  '      <div class="row"><button id="edit">拖动编辑：关</button>',
  '        <button id="copyPatch">复制改动 JSON</button><button id="dlPatch">下载 .json</button><button id="revert">全部还原</button></div>',
  '      <div class="hint">开启后画布上出现橙色手柄：拖 <b>横线</b> = 拖那条线本身（安全区 / 经验条顶边）；<b>↕</b> = 行距 / 半径；<b>↔</b> = 间距 / 摇杆。拖的时候画的是什么就动什么（页面用的就是 <b>G.HUD</b> 的真几何）。</div>',
  '      <div id="editKnobs"></div>',
  '      <pre id="changes">还没改动</pre>',
  '      <pre id="patch"></pre>',
  '      <textarea id="patchBox" spellcheck="false" placeholder="改动 JSON（手动 Ctrl+C 的兜底）"></textarea>',
  '      <div class="hint">「复制改动 JSON」→ 仓库里跑 <b>tools\\apply-hud-layout.cmd</b>（读剪贴板写进 shared\\balance.json，只替换那个数字）→ 再跑 <b>tools\\minigame-now.cmd</b>（重建 + 全量自检）。</div>',
  '      <div class="hint">拖安全区那两条线时注意：屏幕实际用的是 <b>max(这个数, 上面「安全区上/下」)</b>（系统刘海更大就听系统的），所以先把上面那两个输入框调小才看得出效果。</div>',
  '    </div>',
  '    <div class="card"><h2>运行 / 出图</h2><div class="row">',
  '      <button id="live">实时运行</button><button id="reset">重开一局</button><button id="png">导出 720x1600 PNG</button>',
  '    </div><div class="hint">实时：手拖画布 = 推摇杆走位；点按钮 = 真的开面板 / 切自动战斗。</div></div>',
  '    <div class="card"><h2>坐标（当前帧，设计单位）</h2><pre id="coords">…</pre></div>',
  '</div>',
  '</main>'
].join('\n');

const LEGEND = [
  '<div><span class="sw" style="background:#ff4d6d"></span>安全区（顶 / 底）</div>',
  '<div><span class="sw" style="background:#ffd479"></span>整条吸底动作栏的顶边 bottomBarTop()</div>',
  '<div><span class="sw" style="background:#7cf7ff"></span>经验条 expTop() · 技能行 skillRowY() · 功能行 functionRowY()</div>',
  '<div><span class="sw" style="background:#c08cff"></span>摇杆触发区（input.zoneWidthRatio 宽 × zoneHeightRatio 高，下边吸在底栏顶边）</div>',
  '<div><span class="sw" style="background:#9dff8a"></span>按钮圆心 + 半径（命中测试用的同一份坐标）</div>',
  '<div><span class="sw" style="background:#ff9a3c"></span>拖动编辑打开时：橙色手柄 = 可以直接拖的那个数</div>'
].join('\n');

const DRIVER = String.raw`
(function () {
  'use strict';

  var G = window.G;
  var meta = document.getElementById('meta');
  var canvas = document.getElementById('stage');
  var phone = document.getElementById('phone');
  var wrap = document.getElementById('wrap');
  var coordsEl = document.getElementById('coords');
  var ctx = canvas.getContext('2d');

  wrap.style.display = 'flex';
  wrap.style.justifyContent = 'center';
  document.getElementById('legend').innerHTML = LEGEND_HTML;

  if (!G || !G.GAME || !G.SCREEN || !G.HUD || !G.PANELS) {
    meta.textContent = 'bundle 没加载起来（game.js 缺失或语法错误）';
    return;
  }

  var SCENARIOS = [
    ['field', '野外'],
    ['camp', '原点营地'],
    ['bag', '背包'],
    ['chest', '开箱'],
    ['guild', '公会'],
    ['guildMembers', '公会成员'],
    ['shop', '商店'],
    ['enhance', '铁匠强化'],
    ['smith', '铁匠 NPC + 锻键'],
    ['stat', '属性'],
    ['menu', '设置'],
    ['selftest', '自检面板'],
    ['debug', 'F1 调试'],
    ['cooldown', '技能冷却中'],
    ['locked', '技能未解锁'],
    ['login', '登录页']
  ];
  var SCREENS = [
    ['375x812', 375, 812],
    ['390x844', 390, 844],
    ['360x780', 360, 780],
    ['412x915', 412, 915],
    ['720x1600', 720, 1600]
  ];
  var GUIDES = [
    ['safe', '安全区'],
    ['chain', '底栏四层'],
    ['discs', '按钮圆心 + 坐标'],
    ['zone', '摇杆触发区'],
    ['grid', '100 网格'],
    ['crosshair', '中轴']
  ];

  var cfg = {
    cssW: 390, cssH: 844, dpr: Math.min(2, window.devicePixelRatio || 1),
    safeTop: 0, safeBottom: 0,
    scenario: 'field', live: false, edit: false, zoom: 0,
    safe: true, chain: true, discs: true, zone: true, grid: false, crosshair: false
  };
  var base = null;
  var acc = 0;
  var lastTs = 0;

  /* ---------------------------------------------------------------- 小工具 */

  function mark(button, on) {
    button.className = on ? 'on' : '';
  }

  function addButton(host, text, onClick) {
    var button = document.createElement('button');
    button.textContent = text;
    button.addEventListener('click', onClick);
    host.appendChild(button);
    return button;
  }

  function design(value) {
    return Math.round(value * 10) / 10;
  }

  /* ---------------------------------------------------------------- 起一局 */

  function bootWorld() {
    G.SAVE.clear();
    G.GAME.boot();
    G.GAME.beginPlaying('预览者');
    // 与 tools\perf-frame.mjs 同一套脚本：先走 10 秒把周边 chunk / 怪铺出来，再站桩 4 秒
    var stick = G.INPUT.state.stick;
    stick.active = true;
    stick.dx = 0.7071;
    stick.dy = 0.7071;
    stick.magnitude = 1;
    for (var i = 0; i < 600; i += 1) G.GAME.step(1000 / 60);
    stick.active = false;
    stick.dx = 0;
    stick.dy = 0;
    stick.magnitude = 0;
    for (var j = 0; j < 240; j += 1) G.GAME.step(1000 / 60);
    base = {
      x: G.GAME.state.player.x,
      y: G.GAME.state.player.y,
      level: G.GAME.state.save.level,
      exp: G.GAME.state.save.exp
    };
  }

  /** 切场景：先回到"基准帧"，再按场景改状态 —— 所以换场景不会互相污染 */
  function applyScenario() {
    var state = G.GAME.state;
    G.PANELS.close();
    state.debug = false;
    state.screen = 'playing';
    state.player.x = base.x;
    state.player.y = base.y;
    state.camera.x = base.x;
    state.camera.y = base.y;
    state.save.level = base.level;
    state.save.exp = base.exp;
    // 公会也回到"没有公会"（换个场景不该带着上一个场景的公会）—— 本次新增
    state.save.guild = null;
    state.guild.note = '';
    state.guild.list = [];
    state.guild.listNote = '';

    if (cfg.scenario === 'camp') {
      state.player.x = 0;
      state.player.y = 0;
      state.camera.x = 0;
      state.camera.y = 0;
      G.WORLD.ensureChunks(0, 0);
    } else if (cfg.scenario === 'bag' || cfg.scenario === 'chest' || cfg.scenario === 'guild' ||
               cfg.scenario === 'shop' || cfg.scenario === 'stat' || cfg.scenario === 'menu' ||
               cfg.scenario === 'selftest') {
      G.PANELS.open(cfg.scenario);
    } else if (cfg.scenario === 'guildMembers') {
      // 公会成员（本次新增）：塞一份"服务端那份形状"的公会记录，看等级 / 公会信息 / 人员表排得怎么样。
      // 走 G.GUILD.normalizeRecord —— 与游戏里读服务端响应的是同一个函数，所以预览里的版面就是真版面。
      state.save.guild = G.GUILD.normalizeRecord(
        {
          id: 'preview-1',
          name: '铁血兄弟会',
          level: 3,
          exp: 250,
          expForNext: 100,
          anchor: { x: 1280, y: -640 },
          createdAt: 1,
          syncAt: G.WORLD.now(),
          remote: true,
          role: 'leader',
          members: [
            { name: state.save.name || '预览者', level: state.save.level, online: true, role: 'leader' },
            { name: '夜航拾荒团', level: Math.max(2, state.save.level - 3), online: true, role: 'member' },
            { name: '赤月游侠', level: Math.max(2, state.save.level - 8), online: false, role: 'member' }
          ]
        },
        { name: state.save.name || '预览者', level: state.save.level }
      );
      G.PANELS.open('guild');
    } else if (cfg.scenario === 'enhance') {
      // 铁匠强化面板（本次新增）：先把四件凑齐 + 手里放几颗强化石，否则四行全是"空"看不到东西。
      // 生成装备走 G.EQUIP.generate（传入 rng，不用 Math.random），与游戏里掉出来的是同一套数据。
      var slots = G.EQUIP.SLOT_IDS;
      for (var s = 0; s < slots.length; s += 1) {
        state.save.loadout[slots[s]] = G.EQUIP.generate(3, Math.max(5, state.save.level), new G.RNG.Rng(700 + s), 0);
      }
      state.save.stones = 7;
      G.PANELS.open('enhance');
    } else if (cfg.scenario === 'smith') {
      // 营地铁匠（本次新增）：站到他跟前 —— 画面里该看到铁砧 / 火星 + 头顶那枚「锻」键
      var smith = G.TERRAIN.smithSpot();
      state.player.x = smith.x + 60;
      state.player.y = smith.y + 70;
      state.camera.x = state.player.x;
      state.camera.y = state.player.y;
      G.WORLD.ensureChunks(state.player.x, state.player.y);
    } else if (cfg.scenario === 'debug') {
      state.debug = true;
    } else if (cfg.scenario === 'locked') {
      state.save.level = 1;
      state.save.exp = 0;
    } else if (cfg.scenario === 'cooldown') {
      for (var i = 0; i < 4; i += 1) G.GAME.castSkillSlot(i);
    } else if (cfg.scenario === 'login') {
      state.screen = 'login';
    }
  }

  /* ---------------------------------------------------------------- 渲染 */

  function layout() {
    G.SCREEN.resize({
      cssW: cfg.cssW,
      cssH: cfg.cssH,
      dpr: cfg.dpr,
      safeArea: { top: cfg.safeTop, bottom: cfg.safeBottom }
    });
    canvas.style.width = cfg.cssW + 'px';
    canvas.style.height = cfg.cssH + 'px';
    meta.textContent = '逻辑屏 ' + G.SCREEN.width() + 'x' + Math.round(G.SCREEN.height()) +
      '   scale ' + (Math.round(G.SCREEN.scale() * 10000) / 10000) +
      '   CSS ' + cfg.cssW + 'x' + cfg.cssH + ' @dpr' + cfg.dpr;
  }

  function zoomTo(factor) {
    cfg.zoom = factor;
    var scale = factor || Math.min(
      1,
      (window.innerHeight - 170) / (cfg.cssH + 24),
      (document.getElementById('stage-pane').clientWidth - 40) / (cfg.cssW + 24)
    );
    phone.style.transform = 'scale(' + scale + ')';
    wrap.style.width = Math.round(cfg.cssW * scale + 28) + 'px';
    wrap.style.height = Math.round(cfg.cssH * scale + 28) + 'px';
  }

  function draw() {
    layout();
    G.SCREEN.applyTo(canvas, ctx);
    G.GAME.renderTo(ctx);
    if (cfg.safe || cfg.chain || cfg.discs || cfg.zone || cfg.grid || cfg.crosshair) drawGuides();
    if (cfg.edit) drawHandles();
    dump();
  }

  /* ---------------------------------------------------------------- 参考线 */

  function resetTransform() {
    var k = G.SCREEN.scale() * cfg.dpr;
    ctx.setTransform(k, 0, 0, k, 0, 0);
  }

  function line(x1, y1, x2, y2, color, width, dash) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dash || []);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function tag(text, x, y, color) {
    ctx.font = '22px Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    var width = ctx.measureText(text).width + 12;
    ctx.fillStyle = 'rgba(6,10,20,0.74)';
    ctx.fillRect(x, y - 4, width, 28);
    ctx.fillStyle = color;
    ctx.fillText(text, x + 6, y);
  }

  function drawGuides() {
    resetTransform();
    var W = G.SCREEN.width();
    var H = G.SCREEN.height();
    var view = G.GAME.uiView();
    ctx.save();

    if (cfg.grid) {
      var thin = 'rgba(120,170,255,0.20)';
      var thick = 'rgba(120,170,255,0.45)';
      for (var gx = 0; gx <= W; gx += 100) line(gx, 0, gx, H, gx % 500 === 0 ? thick : thin, gx % 500 === 0 ? 2 : 1);
      for (var gy = 0; gy <= H; gy += 100) line(0, gy, W, gy, gy % 500 === 0 ? thick : thin, gy % 500 === 0 ? 2 : 1);
      tag('每格 100 设计单位 = ' + design(100 * G.SCREEN.scale()) + ' CSS px', 12, H / 2, '#8ab4ff');
    }

    if (cfg.crosshair) {
      line(W / 2, 0, W / 2, H, 'rgba(255,255,255,0.28)', 1, [12, 10]);
      tag('中轴 x=' + W / 2, W / 2 + 8, 8, '#cfd8ee');
    }

    if (cfg.safe) {
      var top = G.SCREEN.safeTop();
      var bottom = G.SCREEN.safeBottom();
      line(0, top, W, top, '#ff4d6d', 3, [16, 10]);
      line(0, H - bottom, W, H - bottom, '#ff4d6d', 3, [16, 10]);
      tag('safeTop ' + Math.round(top) + '（' + Math.round(top * G.SCREEN.scale()) + ' CSS）', 12, top + 8, '#ff8fa3');
      tag('safeBottom ' + Math.round(bottom) + '（' + Math.round(bottom * G.SCREEN.scale()) + ' CSS）', 12, H - bottom + 8, '#ff8fa3');
    }

    if (cfg.chain) {
      var expTop = G.HUD.expTop();
      var skillY = G.HUD.skillRowY();
      var funcY = G.HUD.functionRowY();
      var barTop = G.HUD.bottomBarTop();
      ctx.fillStyle = 'rgba(124,247,255,0.09)';
      ctx.fillRect(0, expTop, W, H - expTop);
      line(0, expTop, W, expTop, '#7cf7ff', 3);
      line(0, skillY, W, skillY, '#7cf7ff', 2, [14, 10]);
      line(0, funcY, W, funcY, '#7cf7ff', 2, [14, 10]);
      line(0, barTop, W, barTop, '#ffd479', 3, [18, 10]);
      tag('expTop ' + Math.round(expTop) + '  高 ' + G.BAL.view.hud.expBarHeight, 12, expTop + 6, '#7cf7ff');
      tag('skillRowY ' + Math.round(skillY) + '  r=' + G.BAL.view.skillBar.radius + '（技能名画在圆上方）', 12, skillY + 6, '#7cf7ff');
      tag('functionRowY ' + Math.round(funcY) + '  r=' + G.BAL.view.functionBar.radius, 12, funcY + 6, '#7cf7ff');
      tag('bottomBarTop ' + Math.round(barTop) + ' → 底栏占 ' + Math.round((H - barTop) * G.SCREEN.scale()) + ' CSS px', 12, barTop - 36, '#ffd479');
      tag('barGap ' + G.BAL.view.hud.barGap, W - 210, expTop + 44, '#ffd479');
      tag('rowGap ' + G.BAL.view.hud.rowGap, W - 210, skillY - 100, '#ffd479');
      tag('技能圆 ' + Math.round(skillY - G.BAL.view.skillBar.radius) + ' ~ ' + Math.round(skillY + G.BAL.view.skillBar.radius), W - 400, skillY + 34, '#9de9ff');
      tag('功能圆 ' + Math.round(funcY - G.BAL.view.functionBar.radius) + ' ~ ' + Math.round(funcY + G.BAL.view.functionBar.radius), W - 400, funcY + 34, '#9de9ff');
    }

    if (cfg.zone) {
      // 与 15-input.js 的 stickZone() 是**同一个函数**：宽 zoneWidthRatio、下边吸在吸底动作栏顶边（A7 修订）
      var stickZone = G.INPUT.stickZone();
      ctx.strokeStyle = '#c08cff';
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 8]);
      ctx.strokeRect(
        stickZone.left,
        stickZone.top,
        stickZone.right - stickZone.left,
        stickZone.bottom - stickZone.top
      );
      ctx.setLineDash([]);
      tag(
        '摇杆触发区 ' + Math.round((stickZone.right - stickZone.left) * G.SCREEN.scale()) + 'x' +
          Math.round((stickZone.bottom - stickZone.top) * G.SCREEN.scale()) + ' CSS（下边吸在底栏顶边）',
        12,
        stickZone.top + 8,
        '#d7b0ff'
      );
      tag(
        '摇杆半径 ' + G.BAL.input.stickRadius + '（上边 y=' + Math.round(stickZone.top) + ' / 下边 y=' + Math.round(stickZone.bottom) + '）',
        12,
        stickZone.top + 40,
        '#d7b0ff'
      );
    }

    if (cfg.discs) {
      var buttons = view.buttons;
      for (var i = 0; i < buttons.length; i += 1) {
        var b = buttons[i];
        ctx.strokeStyle = '#9dff8a';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(b.x - 10, b.y);
        ctx.lineTo(b.x + 10, b.y);
        ctx.moveTo(b.x, b.y - 10);
        ctx.lineTo(b.x, b.y + 10);
        ctx.stroke();
        tag(b.id + ' (' + Math.round(b.x) + ',' + Math.round(b.y) + ') r' + b.r, b.x + b.r + 6, b.y - 13, '#c9ffb8');
      }
    }

    ctx.restore();
    resetTransform();
  }

  /* ---------------------------------------------------------------- 坐标表 */

  function dump() {
    var view = G.GAME.uiView();
    var lines = [];
    lines.push('逻辑屏 ' + G.SCREEN.width() + ' x ' + Math.round(G.SCREEN.height()) +
      '   scale ' + (Math.round(G.SCREEN.scale() * 10000) / 10000) +
      '   safeTop ' + G.SCREEN.safeTop() + '  safeBottom ' + G.SCREEN.safeBottom());
    lines.push('expTop ' + design(G.HUD.expTop()) +
      '   skillRowY ' + design(G.HUD.skillRowY()) +
      '   functionRowY ' + design(G.HUD.functionRowY()) +
      '   bottomBarTop ' + design(G.HUD.bottomBarTop()));
    lines.push('底栏占高 ' + Math.round((G.SCREEN.height() - G.HUD.bottomBarTop()) * G.SCREEN.scale()) + ' CSS px');
    // 有键顶出屏幕边就直接摆在这张表上（拖动改布局最容易拖出来：整排宽 > 屏宽）
    var wide = G.HUD.buttons({ save: G.GAME.state.save, inCamp: true }).filter(function (b) {
      return b.x - b.r < 0 || b.x + b.r > G.SCREEN.width();
    });
    if (wide.length) {
      lines.push('⚠ 有键顶出屏幕：' + wide.map(function (b) {
        var side = b.x - b.r < 0 ? '左边' : '右边';
        var out = Math.max(b.r - b.x, b.x + b.r - G.SCREEN.width());
        return b.id + '（' + side + ' ' + Math.round(out) + ' 设计单位）';
      }).join('  '));
    }
    lines.push('');
    for (var i = 0; i < view.buttons.length; i += 1) {
      var b = view.buttons[i];
      lines.push((b.id + '        ').slice(0, 8) + (b.label + '   ').slice(0, 3) +
        ' x ' + design(b.x) + '   y ' + design(b.y) + '   r ' + b.r +
        (b.state ? '   ' + b.state : '') +
        (b.cool ? '   冷却 ' + Math.round(b.cool * 100) + '%' : '') +
        (b.lock ? '   未解锁 Lv.' + b.unlockLevel : ''));
    }
    coordsEl.textContent = lines.join('\n');
  }

  /* ---------------------------------------------------------------- 触摸转发 */

  function cssPoint(event) {
    var rect = canvas.getBoundingClientRect();
    return {
      clientX: (event.clientX - rect.left) / rect.width * cfg.cssW,
      clientY: (event.clientY - rect.top) / rect.height * cfg.cssH
    };
  }

  function synth(event) {
    var p = cssPoint(event);
    var touch = { clientX: p.clientX, clientY: p.clientY, identifier: 0 };
    return { touches: [touch], changedTouches: [touch] };
  }

  /** 事件 → 设计单位坐标：画布整体被 scale() 缩过，所以要再除以 SCREEN.scale() */
  function designPoint(event) {
    var p = cssPoint(event);
    var k = G.SCREEN.scale();
    return { x: p.clientX / k, y: p.clientY / k };
  }

  var dragging = false;      // 手在推摇杆 / 点按钮
  var editDragging = false;  // 手在拖布局手柄

  canvas.addEventListener('pointerdown', function (event) {
    var point = designPoint(event);
    if (cfg.edit) {
      // 编辑模式：先看是不是拖手柄；不是的话照常转发给游戏（所以开着编辑也能点按钮开面板）
      var handle = hitHandle(point);
      if (handle) {
        if (canvas.setPointerCapture) canvas.setPointerCapture(event.pointerId);
        editDragging = beginDrag(handle, point);
        draw();
        return;
      }
    }
    dragging = true;
    if (canvas.setPointerCapture) canvas.setPointerCapture(event.pointerId);
    G.GAME.onTouchStart(synth(event));
    if (!cfg.live) draw();
  });
  canvas.addEventListener('pointermove', function (event) {
    var point = designPoint(event);
    if (editDragging) {
      applyDrag(point);
      return;
    }
    if (cfg.edit) canvas.style.cursor = hitHandle(point) ? 'grab' : 'crosshair';
    if (!dragging) return;
    G.GAME.onTouchMove(synth(event));
    if (!cfg.live) draw();
  });
  canvas.addEventListener('pointerup', function (event) {
    if (editDragging) {
      editDragging = false;
      endDrag();
      draw();
      return;
    }
    dragging = false;
    G.GAME.onTouchEnd(synth(event));
    // 静态模式：点出来的新状态（开着的面板 / 自动战斗的开关）要立刻画出来
    if (!cfg.live) drawUi();
  });
  canvas.addEventListener('pointercancel', function () {
    dragging = false;
    if (editDragging) {
      editDragging = false;
      endDrag();
      draw();
    }
  });

  /** 静态模式重画：保留"手点出来的"界面状态，不动世界坐标 */
  function drawUi() {
    if (cfg.scenario === 'debug') G.GAME.state.debug = true;
    draw();
  }

  /* ---------------------------------------------------------------- 实时模式 */

  function loop(ts) {
    if (!cfg.live) return;
    var dt = lastTs ? Math.min(60, ts - lastTs) : 16.7;
    lastTs = ts;
    acc += dt;
    var steps = 0;
    while (acc >= 1000 / 60 && steps < 6) {
      G.GAME.step(1000 / 60);
      acc -= 1000 / 60;
      steps += 1;
    }
    draw();
    window.requestAnimationFrame(loop);
  }

  function setLive(on) {
    cfg.live = on;
    if (on && cfg.edit) setEdit(false);   // 一边拖手柄一边跑世界，看不清是谁动了
    mark(liveBtn, on);
    liveBtn.textContent = on ? '实时运行中（点一下暂停）' : '实时运行';
    if (on) {
      lastTs = 0;
      acc = 0;
      window.requestAnimationFrame(loop);
    }
  }

  /* ---------------------------------------------------------------- 导出 PNG */

  function exportPng() {
    var keepW = cfg.cssW;
    var keepH = cfg.cssH;
    var keepDpr = cfg.dpr;
    cfg.cssW = 720;
    cfg.cssH = 1600;
    cfg.dpr = 1;
    layout();
    G.SCREEN.applyTo(canvas, ctx);
    G.GAME.renderTo(ctx);
    if (cfg.safe || cfg.chain || cfg.discs || cfg.zone || cfg.grid || cfg.crosshair) drawGuides();
    var link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = 'hud-preview-720x1600.png';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    cfg.cssW = keepW;
    cfg.cssH = keepH;
    cfg.dpr = keepDpr;
    draw();
    zoomTo(cfg.zoom);
  }

  /* ---------------------------------------------------------------- 拖动改布局
   *
   * 一条纪律：**拖动改的就是 G.BAL 里那个数**（view.hud.rowGap 之类），改完立刻重画 ——
   * 页面画的仍然是 G.HUD.* 的真几何，所以"拖出来好看"就等于"游戏里就是这样"。
   *
   * 为什么只有这些数：每一个都在 src\*.js 里真的被读过（列进来之前逐个查过调用点）。
   * 反例：input.attackButtonDiameter 在 balance 里有、但没有任何地方读它 —— 放进来就是假手柄。
   * view.panel.heightRatio 与摇杆两个 ratio 是 0~1 的量，step 给 0.01；其余都是整数设计单位。
   *
   * 拖完之后：清单（path 旧 → 新）+ 一段 JSON → 复制 → 仓库里跑 tools\apply-hud-layout.cmd。
   * 页面自己**不写文件**（file:// 也拿不到 fs，更不该偷偷改仓库）。
   */

  var KNOB_GROUPS = [
    ['吸底动作栏（A7 四层）', [
      ['view.hud.expBarHeight', '经验条高 expBarHeight', 6, 60, 1],
      ['view.hud.barGap', '经验条 ↔ 技能行 barGap', 0, 60, 1],
      ['view.hud.captionGap', '说明文字离圆 captionGap', 0, 40, 1],
      ['view.hud.rowGap', '技能行 ↔ 功能行 rowGap', 0, 80, 1]
    ]],
    ['技能栏（贴底那一行）', [
      ['view.skillBar.radius', '技能键半径', 18, 70, 1],
      ['view.skillBar.gap', '技能键间距', 0, 60, 1],
      ['view.skillBar.nameSize', '技能名字号', 10, 32, 1],
      ['view.skillBar.margin', '整排离右边 margin（居中 = (720-整排宽)/2 ≈ 206）', 0, 240, 1]
    ]],
    ['功能栏（技能行上面一行）', [
      ['view.functionBar.radius', '功能键半径', 18, 80, 1],
      ['view.functionBar.gap', '功能键间距', 0, 60, 1],
      ['view.functionBar.slots', '固定槽位数（5~7）', 5, 7, 1]
    ]],
    // 左侧边栏（本次新增）：竖着两枚键（商 / 营），贴左边缘 —— 改 left / radius 之后
    // 记得让 view.panel.leftReserve 跟着走，否则面板卡片会盖住它（自检有一条断言盯着这条缝）
    ['左侧边栏（贴左边缘，竖排）', [
      ['view.sideBar.radius', '侧边栏键半径', 18, 70, 1],
      ['view.sideBar.gap', '两枚键的间距（要塞得下说明文字）', 0, 120, 1],
      ['view.sideBar.left', '离左边屏幕的距离', 0, 200, 1],
      ['view.sideBar.top', '第一枚离吸顶块的距离', 0, 120, 1],
      ['view.sideBar.pad', '底板四周余量', 0, 40, 1]
    ]],
    ['图标 / 吸顶 / 小地图', [
      ['view.icon.buttonSize', '圆键里的图标', 16, 80, 1],
      ['view.icon.captionSize', '圆键说明字号', 8, 30, 1],
      ['view.icon.rowSize', '面板行里的图标', 16, 80, 1],
      ['view.icon.slotSize', '部位格图标', 16, 90, 1],
      ['view.hud.avatarRadius', '头像半径', 16, 72, 1],
      ['view.minimap.size', '小地图边长', 80, 320, 1],
      ['view.minimap.margin', '小地图边距', 0, 60, 1]
    ]],
    ['面板卡片', [
      ['view.panel.leftMargin', '左边距', 0, 120, 1],
      ['view.panel.leftReserve', '左侧留给侧边栏（本次新增）', 0, 240, 1],
      ['view.panel.rightReserve', '右侧留给功能键', 0, 240, 1],
      ['view.panel.heightRatio', '高度占比', 0.15, 0.9, 0.01],
      ['view.panel.headerHeight', '标题栏高', 40, 140, 1],
      ['view.panel.rowHeight', '行高', 36, 120, 1]
    ]],
    ['视角缩放轴（A11 之二：设置面板里的滑块）', [
      ['view.zoomSlider.minTiles', '一屏最少几格（左端）', 8, 64, 1],
      ['view.zoomSlider.maxTiles', '一屏最多几格（右端）', 16, 128, 1],
      ['view.zoomSlider.trackHeight', '轨道高', 8, 40, 1],
      ['view.zoomSlider.knobRadius', '圆钮半径', 8, 36, 1],
      ['view.zoomSlider.endPad', '圆钮离轨道两端的余量（>= 圆钮半径）', 8, 48, 1]
    ]],
    ['安全区 / 摇杆', [
      ['view.safeTop', '安全区上（文档下限）', 0, 240, 1],
      ['view.safeBottom', '安全区下（文档下限）', 0, 300, 1],
      ['input.stickRadius', '摇杆半径', 30, 160, 1],
      ['input.zoneWidthRatio', '摇杆区宽比', 0.2, 1, 0.01],
      ['input.zoneHeightRatio', '摇杆区高比', 0.2, 0.9, 0.01]
    ]]
  ];

  var KNOBS = [];
  KNOB_GROUPS.forEach(function (group) {
    group[1].forEach(function (row) {
      KNOBS.push({ path: row[0], label: row[1], min: row[2], max: row[3], step: row[4], group: group[0] });
    });
  });

  var knobByPath = {};
  KNOBS.forEach(function (knob) { knobByPath[knob.path] = knob; });

  /** path（'view.hud.rowGap'）→ 值；只有最后一段是数字才算数（免得把字符串 / 对象拖坏） */
  function readPath(path) {
    var parts = path.split('.');
    var node = G.BAL;
    for (var i = 0; i < parts.length - 1; i += 1) {
      if (!node || typeof node[parts[i]] !== 'object' || node[parts[i]] === null) return null;
      node = node[parts[i]];
    }
    var last = parts[parts.length - 1];
    return node && typeof node[last] === 'number' ? node[last] : null;
  }

  function writePath(path, value) {
    var parts = path.split('.');
    var node = G.BAL;
    for (var i = 0; i < parts.length - 1; i += 1) {
      if (!node || typeof node[parts[i]] !== 'object' || node[parts[i]] === null) return false;
      node = node[parts[i]];
    }
    node[parts[parts.length - 1]] = value;
    return true;
  }

  /** 打开页面时的原值（还原用）；改动表只记"跟原值不一样"的那些 */
  var originals = {};
  var changes = {};
  KNOBS.forEach(function (knob) { originals[knob.path] = readPath(knob.path); });

  function quantize(knob, value) {
    var step = knob.step || 1;
    var out = Math.round(value / step) * step;
    out = Math.round(out * 1000) / 1000;
    if (out < knob.min) out = knob.min;
    if (out > knob.max) out = knob.max;
    return out;
  }

  /** 改一个数：夹到范围 → 按 step 量化 → 写进 G.BAL → 记进改动表 */
  function setKnob(path, value) {
    var knob = knobByPath[path];
    if (!knob) return false;
    var next = quantize(knob, value);
    writePath(path, next);
    if (next === originals[path]) delete changes[path];
    else changes[path] = next;
    return true;
  }

  /**
   * 一行圆键（按 x 排过）：技能行传 true，功能行传 false ——「营」是追加在最后的，按 x 排最稳。
   * **本次新增：侧边栏那两枚键（kind === 'side'）不算任何一行** —— 它们在左边缘竖着排，
   * 要是混进 funcs，那么 g.funcs[0] 会变成左上角那枚（x 更小），
   * 好几个手柄（rowGap / captionGap / funcRadius）就会跑到屏幕外或量错位置。
   */
  function circles(skill) {
    var list = G.GAME.uiView().buttons;
    var out = [];
    for (var i = 0; i < list.length; i += 1) {
      if (list[i].kind === 'side') continue;
      if ((list[i].id.indexOf('skill') === 0) === !!skill) out.push(list[i]);
    }
    sortByX(out);
    return out;
  }

  function sortByX(list) {
    list.sort(function (a, b) { return a.x - b.x; });
    return list;
  }

  /** 手柄要用的几何快照：全部来自 G.SCREEN / G.HUD / G.INPUT 的真值，一个都不另算 */
  function geom() {
    var W = G.SCREEN.width();
    var H = G.SCREEN.height();
    var bottom = G.SCREEN.safeBottom();
    // A7 修订：触发区的下边是"吸底动作栏顶边"，不再按 safeBottom 算 —— 直接问 15-input 要
    var zone = G.INPUT.stickZone();
    var zh = zone.bottom - zone.top;
    return {
      W: W,
      H: H,
      top: G.SCREEN.safeTop(),
      bottom: bottom,
      expTop: G.HUD.expTop(),
      barTop: G.HUD.bottomBarTop(),
      skillY: G.HUD.skillRowY(),
      funcY: G.HUD.functionRowY(),
      skills: circles(true),
      funcs: circles(false),
      iconGap: G.BAL.view.hud.captionGap + G.ICONS.size('captionSize'),
      nameGap: G.BAL.view.hud.captionGap + G.BAL.view.skillBar.nameSize,
      zoneW: zone.right - zone.left,
      zoneH: zh,
      zoneTop: zone.top,
      zoneBottom: zone.bottom,
      stick: G.BAL.input.stickRadius
    };
  }

  /** 摇杆预览的圆心：游戏里摇杆是"按下点就是圆心"，所以这里只是画一把半径尺子（摆在触发区下边往上一点） */
  function stickBase(g) {
    return { x: g.zoneW / 2, y: g.zoneBottom - 60 - g.stick };
  }

  var HIT_R = 34;   // 设计单位：375 屏上约 18 CSS px，手指够得着
  var drag = null;      // 正在拖的手柄（null = 没在拖）
  var knobRows = {};    // path -> { host, box, val }（面板里那一行滑杆）
  var guideBoxes = {};  // 参考线复选框（开编辑模式时顺手把三条打开）

  /** 当前这一屏真正能拖的手柄（位置现算；屏幕上不存在的键就没有手柄，比如登录页没有技能栏） */
  function handles() {
    var g = geom();
    var out = [];
    for (var i = 0; i < HANDLE_DEFS.length; i += 1) {
      var def = HANDLE_DEFS[i];
      var pos = null;
      try { pos = def.at(g); } catch (error) { pos = null; }
      if (!pos || !isFinite(pos.x) || !isFinite(pos.y)) continue;
      out.push({
        id: def.id,
        path: def.path,
        glyph: def.glyph,
        label: def.label,
        kind: def.glyph === '▬' ? 'line' : 'move',
        at: def.at,
        value: def.value,
        x: pos.x,
        y: pos.y
      });
    }
    return out;
  }

  /** 最近的哪个手柄（34 设计单位以内） */
  function hitHandle(p) {
    var list = handles();
    var best = null;
    var bestD = HIT_R * HIT_R;
    for (var i = 0; i < list.length; i += 1) {
      var dx = p.x - list[i].x;
      var dy = p.y - list[i].y;
      var dd = dx * dx + dy * dy;
      if (dd <= bestD) { bestD = dd; best = list[i]; }
    }
    return best;
  }

  function beginDrag(handle, p) {
    var start = readPath(handle.path);
    if (typeof start !== 'number') return false;
    drag = { handle: handle, start: { x: p.x, y: p.y }, startValue: start };
    return true;
  }

  /** 拖动中：改数 → 重画（画的就是真几何）→ 同步面板 */
  function applyDrag(p) {
    if (!drag) return;
    setKnob(drag.handle.path, drag.handle.value(drag, p, geom()));
    draw();
    refreshEdit();
  }

  function endDrag() {
    if (!drag) return;
    drag = null;
    refreshEdit();
  }

  /** 合成一次拖动（不经过鼠标事件的路径走这里）：自检用，也方便以后加"点一下微调" */
  function dragBy(id, dx, dy) {
    var list = handles();
    var pick = null;
    for (var i = 0; i < list.length; i += 1) if (list[i].id === id) pick = list[i];
    if (!pick) return false;
    if (!beginDrag(pick, { x: pick.x, y: pick.y })) return false;
    applyDrag({ x: pick.x + dx, y: pick.y + dy });
    endDrag();
    return true;
  }

  /** 画手柄：位置全部来自 handles()，和"拖了会改哪个数"是同一份数据 */
  function drawHandles() {
    resetTransform();
    var g = geom();
    var list = handles();
    var base = stickBase(g);
    ctx.save();
    // 摇杆半径尺子：游戏里摇杆圆心就是手指按下的点（没有固定位置），所以这里只画一把尺子
    ctx.strokeStyle = 'rgba(192,140,255,0.8)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.arc(base.x, base.y, g.stick, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    for (var i = 0; i < list.length; i += 1) {
      var h = list[i];
      var active = drag && drag.handle.id === h.id;
      var size = h.kind === 'line' ? 46 : 30;
      ctx.fillStyle = active ? '#ffd479' : '#ff9a3c';
      ctx.strokeStyle = '#0b1020';
      ctx.lineWidth = 2;
      ctx.fillRect(h.x - size / 2, h.y - size / 2, size, size);
      ctx.strokeRect(h.x - size / 2, h.y - size / 2, size, size);
      ctx.fillStyle = '#241a05';
      ctx.font = '18px Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(h.glyph, h.x, h.y + 1);
      var text = h.path + ' = ' + readPath(h.path) + (active ? '   ← 正在拖' : '   ' + h.label);
      tag(text, h.x + 20, h.y + 16, active ? '#ffd479' : '#ffcf9a');
    }
    ctx.restore();
    resetTransform();
  }

  /** 改动之后统一走这里：重画 + 同步面板 */
  function afterEdit() {
    draw();
    refreshEdit();
  }

  /** 把"当前值"写回面板：滑杆 / 数字 / 改动清单 / JSON */
  function refreshEdit() {
    var d = dom();
    for (var i = 0; i < KNOBS.length; i += 1) {
      var path = KNOBS[i].path;
      var row = knobRows[path];
      if (!row) continue;
      var value = readPath(path);
      row.box.value = String(value);
      row.val.textContent = String(value);
      row.host.className = 'knob' + (changes[path] === undefined ? '' : ' dirty');
    }
    var paths = Object.keys(changes).sort();
    if (!paths.length) {
      d.changes.textContent = '还没改动';
    } else {
      var lines = [];
      for (var j = 0; j < paths.length; j += 1) {
        lines.push((paths[j] + '                          ').slice(0, 26) + originals[paths[j]] + ' → ' + changes[paths[j]]);
      }
      d.changes.textContent = paths.length + ' 处改动\n' + lines.join('\n');
    }
    var text = JSON.stringify(patch(), null, 2);
    d.patch.textContent = paths.length ? text : '（还没有改动：拖一下画布上的橙色手柄，或者拉下面的滑杆）';
    d.box.value = text;
  }

  /** 导出用的 JSON：工具名 + 时间 + 干净的改动表（applier 认 tool 字段） */
  function patch() {
    var out = {
      tool: 'hud-preview',
      builtAt: String(nowStamp()),
      note: '写回：tools\\apply-hud-layout.cmd（读剪贴板）→ 再跑 tools\\minigame-now.cmd',
      patch: {}
    };
    var paths = Object.keys(changes).sort();
    for (var i = 0; i < paths.length; i += 1) out.patch[paths[i]] = changes[paths[i]];
    return out;
  }

  /** 时间戳（只为了让人看出这份 patch 是什么时候导出的） */
  function nowStamp() {
    var d = new Date();
    function pad(value) { return (value < 10 ? '0' : '') + value; }
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
      pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  /** 复制：先试 clipboard API（file:// 下可能被拦），不行就选中文本框让用户 Ctrl+C */
  function copyPatch() {
    var d = dom();
    var text = JSON.stringify(patch(), null, 2);
    var ok = false;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch (error) {
      ok = false;
    }
    if (!ok && d.box.focus) {
      d.box.focus();
      d.box.select();
      try { ok = !!(document.execCommand && document.execCommand('copy')); } catch (error2) { ok = false; }
    }
    d.copy.textContent = ok ? '已复制 ✓' : '复制失败 → 手动 Ctrl+C';
    if (window.setTimeout) {
      window.setTimeout(function () { d.copy.textContent = '复制改动 JSON'; }, 1800);
    }
    return ok;
  }

  function downloadPatch() {
    var text = JSON.stringify(patch(), null, 2);
    if (typeof Blob === 'undefined' || !window.URL || !window.URL.createObjectURL) { copyPatch(); return; }
    var link = document.createElement('a');
    link.href = window.URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    link.download = 'hud-layout-patch.json';
    document.body.appendChild(link);
    link.click();
    if (document.body.removeChild) document.body.removeChild(link);
  }

  /** 全部还原：把每个数写回"打开页面时的值"（改动表随之清空） */
  function revertAll() {
    var paths = Object.keys(changes);
    for (var i = 0; i < paths.length; i += 1) writePath(paths[i], originals[paths[i]]);
    changes = {};
    afterEdit();
  }

  /** 编辑模式的开关：和实时运行互斥（一边拖一边跑看不清谁动了） */
  function setEdit(on) {
    cfg.edit = !!on;
    if (cfg.edit && cfg.live) setLive(false);
    var d = dom();
    mark(d.btn, cfg.edit);
    d.btn.textContent = '拖动编辑：' + (cfg.edit ? '开（拖画布上的橙色手柄）' : '关');
    if (cfg.edit) {
      // 手柄要对着参考线才看得懂（安全区 / 底栏四层 / 摇杆区），顺手打开这三条
      ['safe', 'chain', 'zone'].forEach(function (key) {
        cfg[key] = true;
        if (guideBoxes[key]) guideBoxes[key].checked = true;
      });
    }
    canvas.style.cursor = cfg.edit ? 'crosshair' : 'default';
    afterEdit();
  }

  /** 面板元素懒取一次（自检里的假 DOM 也走这条路） */
  var editDom = null;
  function dom() {
    if (!editDom) {
      editDom = {
        btn: document.getElementById('edit'),
        knobs: document.getElementById('editKnobs'),
        changes: document.getElementById('changes'),
        patch: document.getElementById('patch'),
        box: document.getElementById('patchBox'),
        copy: document.getElementById('copyPatch')
      };
    }
    return editDom;
  }

  /**
   * 把拖动编辑的能力挂到 window 上：自检（假 DOM 里跑这个页面）靠它验证
   * "拖一下 → G.BAL 变 → G.HUD 的真几何跟着动 → 导出 JSON 对得上"这条链。
   */
  function initEdit() {
    window.HUD_EDIT = {
      KNOBS: KNOBS,
      paths: function () { return KNOBS.map(function (knob) { return knob.path; }); },
      value: readPath,
      set: function (path, value) { if (!setKnob(path, value)) return false; afterEdit(); return true; },
      handles: handles,
      dragBy: dragBy,
      begin: beginDrag,
      apply: applyDrag,
      end: endDrag,
      changes: function () { return JSON.parse(JSON.stringify(changes)); },
      originals: function () { return JSON.parse(JSON.stringify(originals)); },
      patch: patch,
      patchText: function () { return JSON.stringify(patch(), null, 2); },
      revertAll: revertAll,
      setEdit: setEdit,
      editing: function () { return cfg.edit; }
    };
  }

  /**
   * 可拖的手柄：位置每次现算（跟真几何走）；value() 只回答"拖到这儿该是多少"。
   *   follow（线 / 边缘）：拖到哪就是哪 —— 安全区、经验条顶边、摇杆区宽高比；
   *   delta（行距 / 半径 / 间距）：从按下那一刻的值上加減，步进手感更稳。
   * 登录页没有技能栏 → at() 会抛，handles() 把那几个手柄滤掉（缺失的就不画）。
   */
  var HANDLE_DEFS = [
    {
      id: 'safeTop', path: 'view.safeTop', glyph: '▬', label: '安全区上边（拖这条线）',
      at: function (g) { return { x: g.W - 46, y: g.top }; },
      value: function (d, p) { return p.y; }
    },
    {
      id: 'safeBottom', path: 'view.safeBottom', glyph: '▬', label: '安全区下边（拖这条线）',
      at: function (g) { return { x: g.W - 118, y: g.H - g.bottom }; },
      value: function (d, p, g) { return g.H - p.y; }
    },
    {
      id: 'expBarHeight', path: 'view.hud.expBarHeight', glyph: '▬', label: '经验条顶边（拖这条线）',
      at: function (g) { return { x: g.W - 190, y: g.expTop }; },
      value: function (d, p, g) { return g.H - g.bottom - p.y; }
    },
    {
      id: 'rowGap', path: 'view.hud.rowGap', glyph: '↕', label: '技能行 ↔ 功能行（往上拖 = 更大）',
      at: function (g) { return { x: g.funcs[0].x - g.funcs[0].r - 34, y: g.funcY }; },
      value: function (d, p) { return d.startValue - (p.y - d.start.y); }
    },
    {
      id: 'barGap', path: 'view.hud.barGap', glyph: '↕', label: '经验条 ↔ 技能行（往上拖 = 更大）',
      at: function (g) { return { x: g.skills[0].x - g.skills[0].r - 34, y: g.skillY }; },
      value: function (d, p) { return d.startValue - (p.y - d.start.y); }
    },
    {
      id: 'captionGap', path: 'view.hud.captionGap', glyph: '↕', label: '说明文字离圆（往上拖 = 更远）',
      at: function (g) { return { x: g.funcs[0].x, y: g.funcY + g.funcs[0].r + g.iconGap }; },
      value: function (d, p) { return d.startValue - (p.y - d.start.y); }
    },
    {
      id: 'skillRadius', path: 'view.skillBar.radius', glyph: '↕', label: '技能键半径（拖圆的上边）',
      at: function (g) { return { x: g.skills[g.skills.length - 1].x, y: g.skillY - g.skills[0].r }; },
      value: function (d, p) { return d.startValue - (p.y - d.start.y); }
    },
    {
      id: 'skillGap', path: 'view.skillBar.gap', glyph: '↔', label: '技能键间距（往右拖 = 更宽）',
      at: function (g) { return { x: (g.skills[0].x + g.skills[1].x) / 2, y: g.skillY }; },
      value: function (d, p) { return d.startValue + (p.x - d.start.x); }
    },
    {
      id: 'skillMargin', path: 'view.skillBar.margin', glyph: '↔', label: '整排离右边（往右拖 = 更贴边）',
      at: function (g) { return { x: g.W - 18, y: g.skillY }; },
      value: function (d, p) { return d.startValue - (p.x - d.start.x); }
    },
    {
      id: 'funcRadius', path: 'view.functionBar.radius', glyph: '↕', label: '功能键半径（拖圆的上边）',
      at: function (g) { return { x: g.funcs[0].x, y: g.funcY - g.funcs[0].r }; },
      value: function (d, p) { return d.startValue - (p.y - d.start.y); }
    },
    {
      id: 'funcGap', path: 'view.functionBar.gap', glyph: '↔', label: '功能键间距（整排居中，撑开 / 收拢）',
      at: function (g) { return { x: (g.funcs[0].x + g.funcs[1].x) / 2, y: g.funcY }; },
      value: function (d, p) { return d.startValue + (p.x - d.start.x); }
    },
    {
      id: 'stickRadius', path: 'input.stickRadius', glyph: '↔', label: '摇杆半径（拖圆的右边）',
      at: function (g) { var base = stickBase(g); return { x: base.x + g.stick, y: base.y }; },
      value: function (d, p) { return d.startValue + (p.x - d.start.x); }
    },
    {
      id: 'zoneWidth', path: 'input.zoneWidthRatio', glyph: '↔', label: '摇杆区宽比（拖右边）',
      at: function (g) { return { x: g.zoneW, y: g.zoneTop + g.zoneH / 2 }; },
      value: function (d, p, g) { return p.x / g.W; }
    },
    {
      id: 'zoneHeight', path: 'input.zoneHeightRatio', glyph: '↕', label: '摇杆区高比（拖上边）',
      at: function (g) { return { x: g.zoneW / 2, y: g.zoneTop }; },
      value: function (d, p, g) { return (g.H - g.bottom - p.y) / g.H; }
    }
  ];

  /* ---------------------------------------------------------------- 搭界面 */

  var scenarioHost = document.getElementById('scenarios');
  var screenHost = document.getElementById('screens');
  var guideHost = document.getElementById('guides');
  var cssWEl = document.getElementById('cssW');
  var cssHEl = document.getElementById('cssH');
  var safeTopEl = document.getElementById('safeTop');
  var safeBottomEl = document.getElementById('safeBottom');
  var liveBtn = document.getElementById('live');

  function buildUi() {
    SCENARIOS.forEach(function (item) {
      var button = addButton(scenarioHost, item[1], function () {
        cfg.scenario = item[0];
        Array.from(scenarioHost.children).forEach(function (child) { mark(child, child === button); });
        applyScenario();
        draw();
      });
      if (item[0] === cfg.scenario) mark(button, true);
    });

    SCREENS.forEach(function (item) {
      addButton(screenHost, item[0], function () {
        cfg.cssW = item[1];
        cfg.cssH = item[2];
        cssWEl.value = item[1];
        cssHEl.value = item[2];
        draw();
        zoomTo(cfg.zoom);
      });
    });

    GUIDES.forEach(function (item) {
      var label = document.createElement('label');
      var box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = !!cfg[item[0]];
      box.addEventListener('change', function () {
        cfg[item[0]] = box.checked;
        draw();
      });
      guideBoxes[item[0]] = box;
      label.appendChild(box);
      label.appendChild(document.createTextNode(item[1]));
      guideHost.appendChild(label);
    });

    cssWEl.value = cfg.cssW;
    cssHEl.value = cfg.cssH;
    safeTopEl.value = cfg.safeTop;
    safeBottomEl.value = cfg.safeBottom;
    cssWEl.addEventListener('change', function () { cfg.cssW = Number(cssWEl.value) || 390; draw(); zoomTo(cfg.zoom); });
    cssHEl.addEventListener('change', function () { cfg.cssH = Number(cssHEl.value) || 844; draw(); zoomTo(cfg.zoom); });
    safeTopEl.addEventListener('change', function () { cfg.safeTop = Number(safeTopEl.value) || 0; draw(); });
    safeBottomEl.addEventListener('change', function () { cfg.safeBottom = Number(safeBottomEl.value) || 0; draw(); });

    document.getElementById('fit').addEventListener('click', function () { zoomTo(0); });
    document.getElementById('zoom1').addEventListener('click', function () { zoomTo(1); });
    document.getElementById('zoom15').addEventListener('click', function () { zoomTo(1.5); });
    document.getElementById('zoom05').addEventListener('click', function () { zoomTo(0.5); });
    liveBtn.addEventListener('click', function () { setLive(!cfg.live); });
    document.getElementById('reset').addEventListener('click', function () {
      bootWorld();
      applyScenario();
      draw();
    });
    document.getElementById('png').addEventListener('click', exportPng);
    buildKnobs();
    document.getElementById('edit').addEventListener('click', function () { setEdit(!cfg.edit); });
    document.getElementById('copyPatch').addEventListener('click', copyPatch);
    document.getElementById('dlPatch').addEventListener('click', downloadPatch);
    document.getElementById('revert').addEventListener('click', revertAll);
    initEdit();
    refreshEdit();
    window.addEventListener('resize', function () { zoomTo(cfg.zoom); });
  }

  /**
   * 参数面板：一行 = 名字 + 滑杆 + 当前值 + ↺（还原这一个）。
   * 同一个数在画布上也有一条手柄 —— 两条路走的是同一个 setKnob()。
   */
  function buildKnobs() {
    var host = dom().knobs;
    var group = null;
    KNOBS.forEach(function (knob) {
      if (knob.group !== group) {
        group = knob.group;
        var title = document.createElement('div');
        title.className = 'grp';
        title.textContent = group;
        host.appendChild(title);
      }
      var row = document.createElement('div');
      row.className = 'knob';
      var name = document.createElement('span');
      name.className = 'k';
      name.textContent = knob.label;
      var box = document.createElement('input');
      box.type = 'range';
      box.min = String(knob.min);
      box.max = String(knob.max);
      box.step = String(knob.step);
      box.value = String(readPath(knob.path));
      box.addEventListener('input', function () {
        setKnob(knob.path, Number(box.value));
        afterEdit();
      });
      var val = document.createElement('b');
      val.textContent = String(readPath(knob.path));
      var back = document.createElement('button');
      back.textContent = '↺';
      back.addEventListener('click', function () {
        setKnob(knob.path, originals[knob.path]);
        afterEdit();
      });
      row.appendChild(name);
      row.appendChild(box);
      row.appendChild(val);
      row.appendChild(back);
      host.appendChild(row);
      knobRows[knob.path] = { host: row, box: box, val: val };
    });
  }

  /* ---------------------------------------------------------------- 起飞 */

  try {
    bootWorld();
    applyScenario();
    buildUi();
    draw();
    zoomTo(0);
  } catch (error) {
    meta.textContent = '初始化失败：' + (error && error.message ? error.message : error);
    coordsEl.textContent = String(error && error.stack ? error.stack : error);
  }



})();
`;

/* ------------------------------------------------------------ 3. 拼成页面并落盘 */

const bundleScript = ['<script>', code, '</script>'].join('\n');
const driverScript = [
  '<script>',
  'var LEGEND_HTML = ' + JSON.stringify(LEGEND) + ';',
  DRIVER,
  '</script>'
].join('\n');

const html = [
  '<!doctype html>',
  '<html lang="zh-CN">',
  '<head>',
  '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
  '<title>HUD 布局预览 · 生成物（改 src\\ 后重跑 tools\\hud-preview.cmd）</title>',
  '<style>',
  CSS,
  '</style>',
  '</head>',
  '<body>',
  BODY,
  bundleScript,
  driverScript,
  '</body>',
  '</html>',
  ''
].join('\n');

fs.writeFileSync(outPath, html, 'utf8');

const kb = (text) => Math.round(text.length / 1024) + ' KB';
console.log('HUD-PREVIEW wrote ' + outPath + ' (' + kb(html) + '，其中 bundle ' + kb(code) + ')');
console.log('打开方式：tools\\hud-preview.cmd（会先重新生成再开浏览器）或直接双击上面这个 .html');

/* ------------------------------------------------------------ 4. 自查：假 DOM 跑一遍生成页里的驱动 */

/**
 * 为什么要在 node 里跑驱动的驱动：生成的 .html 是**产物**，
 * 它一旦语法错 / 初始化抛异常，人眼看到的就是一片空白，而"预览工具坏了"会被误读成"游戏坏了"。
 * 这里把页面里的那段 <script> 原样取出来，喂一个 stub DOM + 假 canvas 跑一遍 —— 不需要浏览器。
 */
const written = fs.readFileSync(outPath, 'utf8');
const scriptOpen = written.lastIndexOf('<script>');
const scriptClose = written.lastIndexOf('</script>');
if (scriptOpen < 0 || scriptClose < 0 || scriptClose < scriptOpen) {
  console.log('FAIL 生成的页面里找不到驱动 <script> 段');
  process.exit(1);
}
const driverCode = written.slice(scriptOpen + '<script>'.length, scriptClose);

const ctx = G.SELFTEST.fakeContext();
// setLineDash 只有预览页的参考线会用（src\*.js 里没人调它），所以这个计数专指"参考线画了没有"
let dashes = 0;
ctx.setLineDash = function () { dashes += 1; ctx.calls.count += 1; };
let arcs = 0;
const rawArc = ctx.arc;
ctx.arc = function () {
  arcs += 1;
  ctx.calls.count += 1;
  return rawArc.apply(this, arguments);
};

const elements = {};
function stubElement(id) {
  return {
    id: id,
    style: {},
    children: [],
    className: '',
    textContent: '',
    innerHTML: '',
    value: '',
    clientWidth: 800,
    clientHeight: 1200,
    appendChild(child) { this.children.push(child); return child; },
    addEventListener() {},
    getContext() { return ctx; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 390, height: 844 }; },
    toDataURL() { return 'data:image/png;base64,'; }
  };
}
const documentStub = {
  getElementById(id) {
    if (!elements[id]) elements[id] = stubElement(id);
    return elements[id];
  },
  createElement(tag) { return stubElement(tag); },
  createTextNode(text) { return { text: text }; },
  body: stubElement('body')
};
const windowStub = {
  G: G,
  innerWidth: 1600,
  innerHeight: 900,
  devicePixelRatio: 2,
  requestAnimationFrame() { return 0; },
  addEventListener() {}
};

const problems = [];
try {
  new Function('window', 'document', 'console', driverCode)(windowStub, documentStub, console);
} catch (error) {
  problems.push('驱动抛异常：' + (error && error.message ? error.message : error));
}

const meta = elements.meta ? String(elements.meta.textContent) : '';
const coordsText = elements.coords ? String(elements.coords.textContent) : '';
const scenarioCount = elements.scenarios ? elements.scenarios.children.length : 0;
const screenCount = elements.screens ? elements.screens.children.length : 0;
const guideCount = elements.guides ? elements.guides.children.length : 0;
// 预览页默认开在「野外」场景（没有营地键），而坐标表里是"功能键 + 技能键"合并的一份
const skillCount = last.buttons.filter((button) => button.id.indexOf('skill') === 0).length;
const buttonCount = last.outside.length + skillCount;
// 页面自己算出来的坐标表里，应该正好有 buttonCount 行按钮（每行都带 " x " 与 " r "）
const coordRows = coordsText.split('\n').filter((row) => row.indexOf(' x ') > 0 && row.indexOf(' r ') > 0);

if (meta.indexOf('初始化失败') === 0) problems.push('页面初始化失败：' + meta);
if (coordsText.indexOf('bottomBarTop') < 0 || coordsText.indexOf('expTop') < 0) problems.push('坐标表没算出来');
// 摇杆触发区（A7 修订）：下边必须正好吸在吸底动作栏顶边，并且和功能图标行**纵向不重叠**
const zoneNow = G.INPUT.stickZone();
if (Math.abs(zoneNow.bottom - G.HUD.bottomBarTop()) > 0.001) {
  problems.push('摇杆触发区下边没吸在底栏顶边（' + round(zoneNow.bottom) + ' vs ' + round(G.HUD.bottomBarTop()) + '）');
}
if (zoneNow.bottom >= G.SCREEN.height()) problems.push('摇杆触发区还铺到屏幕最底（应当停在底栏顶边）');
if (last.zoneOverlapDesign !== 0) problems.push('功能图标行纵向还压着摇杆触发区 ' + round(last.zoneOverlapDesign) + ' 设计单位');
if (coordsText.indexOf('\n') < 0) problems.push('坐标表没有换行（\\n 在嵌入时被吃掉了？）');
if (coordRows.length !== buttonCount) problems.push('坐标表里 ' + coordRows.length + ' 行按钮（应为 ' + buttonCount + '）');
if (scenarioCount !== 16) problems.push('场景按钮 ' + scenarioCount + ' 个（应为 16 —— A15 的「铁匠强化」「铁匠 NPC」，本次新增「公会成员」）');
if (screenCount !== 5) problems.push('屏幕按钮 ' + screenCount + ' 个（应为 5）');
if (guideCount !== 6) problems.push('参考线开关 ' + guideCount + ' 个（应为 6）');
if (dashes < 7) problems.push('参考线没画出来（setLineDash 只被调了 ' + dashes + ' 次，至少 2 条安全区 + 3 条底栏 + 1 个摇杆框）');
if (ctx.calls.count < 500) problems.push('整帧没画几笔（drawCalls=' + ctx.calls.count + '，防白屏）');

/* ------------------------------------------------------------ 5. 自查：拖动改布局 */

/**
 * 这一节验的是"拖一下 → G.BAL 变 → G.HUD 的真几何跟着动 → 导出 JSON 对得上"这条链，
 * 不是"按钮画出来没有"。所以它直接调页面挂出来的 window.HUD_EDIT —— 鼠标事件走的就是这几个函数。
 * 假 DOM 里点不了按钮，能点的就是这份 API（这也正是把它挂到 window 上的原因）。
 */
const edit = windowStub.HUD_EDIT;
const editInfo = { knobs: 0, handles: 0, moved: 0 };
if (!edit) {
  problems.push('window.HUD_EDIT 没挂上（拖动编辑的入口）');
} else {
  editInfo.knobs = edit.KNOBS.length;
  const paths = edit.paths();
  if (editInfo.knobs < 24) problems.push('可调数字只有 ' + editInfo.knobs + ' 个（预期 ≥24）');
  for (const path of paths) {
    if (typeof edit.value(path) !== 'number') problems.push('可调数字 ' + path + ' 在 G.BAL 里不是数字（拖了也不会动）');
  }

  const handleList = edit.handles();
  editInfo.handles = handleList.length;
  if (handleList.length < 12) problems.push('画布手柄只有 ' + handleList.length + ' 个（预期 ≥12）');
  const screenW = G.SCREEN.width();
  const screenH = G.SCREEN.height();
  for (const handle of handleList) {
    if (paths.indexOf(handle.path) < 0) problems.push('手柄 ' + handle.id + ' 改的 ' + handle.path + ' 不在可调表里');
    if (!isFinite(handle.x) || !isFinite(handle.y)) problems.push('手柄 ' + handle.id + ' 的位置不是有限数');
    if (handle.x < 0 || handle.x > screenW + 40) problems.push('手柄 ' + handle.id + ' 横着跑出屏幕（x=' + round(handle.x) + '）');
    if (handle.y < 0 || handle.y > screenH + 40) problems.push('手柄 ' + handle.id + ' 竖着跑出屏幕（y=' + round(handle.y) + '）');
  }

  // 0) 先记下"还没动过"的 G.BAL（第 4 步还原时要拿它逐字节比对）
  const snapshot = JSON.stringify(G.BAL);

  // 1) 往上拖功能行 30 设计单位：functionRowY 必须真的往上走 30，而且改的是 view.hud.rowGap
  const rowGapBefore = edit.value('view.hud.rowGap');
  const funcYBefore = G.HUD.functionRowY();
  if (!edit.dragBy('rowGap', 0, -30)) problems.push('拖 rowGap 手柄失败');
  const moved = round(funcYBefore - G.HUD.functionRowY());
  if (Math.abs(moved - 30) > 0.001) problems.push('拖功能行 30，functionRowY 只动了 ' + moved);
  else editInfo.moved += 1;
  if (edit.value('view.hud.rowGap') !== rowGapBefore + 30) problems.push('rowGap 没按拖动量变（' + edit.value('view.hud.rowGap') + '）');

  // 2) 改动必须出现在导出 JSON 里（不然"拖完还要手抄数字"，这个工具就白做了）
  const patchJson = edit.patch();
  if (patchJson.tool !== 'hud-preview') problems.push('导出 JSON 少了 tool 标记（applier 就认它）');
  if (!patchJson.patch || patchJson.patch['view.hud.rowGap'] !== rowGapBefore + 30) {
    problems.push('导出 JSON 里没有 rowGap 这一处改动');
  }
  if (edit.patchText().indexOf('"view.hud.rowGap"') < 0) problems.push('复制用的文本里没有这次改动');

  // 3) 安全区那条线是 follow 模式：拖到哪就是哪（不是加减 40，是"线上那个点"）
  const safeBefore = edit.value('view.safeBottom');
  if (!edit.dragBy('safeBottom', 0, -40)) problems.push('拖 safeBottom 手柄失败');
  if (Math.abs(edit.value('view.safeBottom') - (safeBefore + 40)) > 0.001) problems.push('拖安全区下边，safeBottom 没跟着线走');

  // 4) 还原：G.BAL 要逐字节回到打开页面时的样子（这是"试错不脏仓库"的底线）
  edit.revertAll();
  if (JSON.stringify(G.BAL) !== snapshot) problems.push('还原之后 G.BAL 与改动前不一致');
  if (Math.abs(G.HUD.functionRowY() - funcYBefore) > 0.001) problems.push('还原之后 functionRowY 没回到原值');
  if (JSON.stringify(edit.changes()) !== '{}') problems.push('还原之后改动清单没清空');

  // 5) 编辑模式开关本身（浏览器里就是那一堆橙色手柄 + 摇杆尺子）
  edit.setEdit(true);
  if (!edit.editing()) problems.push('setEdit(true) 之后没进编辑模式');
  edit.setEdit(false);
  if (edit.editing()) problems.push('setEdit(false) 之后没退出编辑模式');
}

// 6) 圆键不许整个跑到屏幕外（"半个在屏外"只是提醒，整个跑出去就是按不到了）；
//    顺手验这把尺子本身：把功能栏撑宽（7 槽 + 间距 60）必须测得出"顶出屏幕"
const savedSlots = G.BAL.view.functionBar.slots;
const savedGap = G.BAL.view.functionBar.gap;
G.BAL.view.functionBar.slots = 7;
G.BAL.view.functionBar.gap = 60;
const stretched = geometry(390, 844);
G.BAL.view.functionBar.slots = savedSlots;
G.BAL.view.functionBar.gap = savedGap;
for (const report of reports) {
  if (report.g.fullyOff.length) {
    problems.push(report.screen.label + '：' + report.g.fullyOff.join(' / ') + ' 整个跑到屏幕外，按不到了');
  }
}
if (!(stretched.overDesign > 20)) problems.push('把功能栏撑宽应该测得出顶出屏幕，尺子没报（' + round(stretched.overDesign) + '）');
if (stretched.fullyOff.indexOf('camp') < 0) problems.push('撑到 7 槽 + 间距 60 时最左那个键整个在屏幕外，却漏判了');
if (stretched.overIds.indexOf('camp') < 0) problems.push('顶出屏幕的键名单里没有 camp');

// 7) 面板卡片底边不许压到整条吸底动作栏。
//    2026-10-01 用户把 heightRatio 0.42 → 0.66（约 2/3 屏高）之后，四个屏里余量最小的是 390x844
//    （约 64 设计单位 ≈ 35 CSS px）——"卡片再高一点就压住功能键"，所以这条要盯着，不能只靠自检里
//    那个只跑 720x1600 的断言。改卡片高 / 吸顶块高 / 功能键半径都会动这个数。
for (const report of reports) {
  if (report.g.panelGap < 0) {
    problems.push(report.screen.label + '：面板卡片底边压到吸底动作栏 ' + round(-report.g.panelGap) +
      ' 设计单位（调小 view.panel.heightRatio，或调小 view.panel.layout.previewHeight）');
  }
}

// 8) 左侧边栏（本次新增）不许被面板卡片盖住 —— 卡片左边那一条 view.panel.leftReserve 就是为它让的。
//    盖住 = 那两枚键（商城 / 回营地）点不到，因为 20-main 的触摸路由先给卡片。
for (const report of reports) {
  if (!report.g.sideBar) problems.push(report.screen.label + '：侧边栏几何算不出来（HUD.sideBarRect）');
  else if (report.g.sideBarGap < 0) {
    problems.push(report.screen.label + '：侧边栏被面板卡片盖住 ' + round(-report.g.sideBarGap) +
      ' 设计单位（把 view.panel.leftReserve 调到 >= 侧边栏的宽度）');
  }
}

console.log('');
console.log('HUD-PREVIEW check scenarios=' + scenarioCount + ' screens=' + screenCount + ' guides=' + guideCount +
  ' coordRows=' + coordRows.length + ' guideDashes=' + dashes + ' arcs=' + arcs + ' drawCalls=' + ctx.calls.count +
  ' knobs=' + editInfo.knobs + ' handles=' + editInfo.handles + ' dragged=' + editInfo.moved);
if (problems.length) {
  for (const problem of problems) console.log('FAIL ' + problem);
  process.exit(1);
}
console.log('HUD-PREVIEW check ok（假 DOM 跑通生成页：坐标表 / 场景 / 参考线 / 拖动改布局都在）');



