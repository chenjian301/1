/**
 * perf-frame.mjs —— 数一帧到底有多少次绘制调用（02-architecture §9 的"每帧绘制调用 ≤ 900"预算）
 *
 * 为什么需要它：十九秒的冒烟只断言"画出来了、没 NaN"，不能回答"会不会画太多"。
 * 换外观（阶段 A3 的自绘角色 / 营地 / 路网 / 小地图）以后，这一层最容易悄悄翻倍，所以留一把尺子。
 * A6（Q版角色 + 装备外观 + 视角拉远 20% + 更细的地表）之后再量一次：最坏 **660**（A5 是 795）——
 * 视角拉远本来会让实体数上升，是靠"同色图元攒成一条路径再 fill"（地表一个 chunk 最多 3 次、
 * 营地石砖 3 次）把最坏值压下来的。
 *
 * 用法（本机没有独立 node，用抖音开发者工具自带的 Electron 当 node）：
 *   powershell -ExecutionPolicy Bypass -File tools\minigame-node.ps1 tools\perf-frame.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const bundlePath = path.join(root, 'douyin-minigame', 'game.js');
const code = fs.readFileSync(bundlePath, 'utf8');
const G = new Function('console', 'tt', 'setTimeout', code + '\n; return G;')(console, undefined, setTimeout);

/**
 * 预算（2026-09-30 实测后定）：一次"落笔" = 一次 fill / stroke / fillRect / fillText。
 * 原来是拍脑袋的 ≤ 400（"圆"时代）；换成自绘角色 + 营地 + 路网后实测最坏 ~730，
 * 而这些几乎全是纯色填充（无渐变/无阴影/无文字），所以把上限定在 900 并留下这把尺子。
 * 为什么不用"总调用数"：一次 fill 前面可能有 5~10 次 moveTo/lineTo，那个数只反映路径复杂度。
 */
const budget = 900;

/** 真正的"绘制调用" = 一次落笔（fill / stroke / fillRect / fillText…），不含建路径的 moveTo/lineTo */
const DRAW_OPS = ['fill', 'stroke', 'fillRect', 'strokeRect', 'fillText', 'strokeText', 'drawImage'];
const PATH_OPS = ['beginPath', 'closePath', 'moveTo', 'lineTo', 'rect', 'arc'];

const frames = [];
/** 当前在量哪一档（结果表里带上档名，一眼看出"贵在哪个视角"） */
let tierLabel = '';

function frameCalls(label) {
  const ctx = G.SELFTEST.fakeContext();
  const stats = { draw: 0, path: 0, all: 0 };
  const wrap = (names, key) => {
    for (const name of names) {
      const original = ctx[name];
      ctx[name] = function () {
        stats[key] += 1;
        return original.apply(this, arguments);
      };
    }
  };
  wrap(DRAW_OPS, 'draw');
  wrap(PATH_OPS, 'path');
  G.GAME.renderTo(ctx);
  stats.all = ctx.calls.count;
  frames.push({ label: tierLabel + label.trim(), draw: stats.draw });
  const verdict = stats.draw <= budget ? 'ok  ' : 'OVER';
  console.log(`  ${verdict} ${label}: 落笔 ${stats.draw} 次（预算 ${budget}）  建路径 ${stats.path} 次  总调用 ${stats.all}`);
  return stats;
}

G.SAVE.clear();
G.GAME.boot();
// A4 起 boot() 会停在"登录 / 创建角色"界面（世界不跑），所以要显式进游戏再量帧
G.GAME.beginPlaying('perf');

const TIERS = G.BAL.view.cameraTiers;
/** 默认格数（A11 之三：用户指定的 22 格）—— 滑块那一节要单独量一量"开机就是这个视角"的账 */
const defaultTiles = Math.round(G.BAL.view.zoomTiles);
const stick = G.INPUT.state.stick;
const cssPerDesign = 375 / G.BAL.view.designWidth;

/** 切档（与游戏里那一行同一条路径：GAME.setZoomTier）+ 相机归位 + 装载环跟上 */
function setTier(index) {
  G.GAME.setZoomTier(index, true);
  const player = G.GAME.state.player;
  G.GAME.state.camera.x = player.x;
  G.GAME.state.camera.y = player.y;
  G.WORLD.ensureChunks(player.x, player.y);
}

/** 把玩家挪到某处（相机跟上、chunk 装载跟上）—— 与游戏里传送那条路径一致 */
function teleport(px, py) {
  const player = G.GAME.state.player;
  player.x = px;
  player.y = py;
  player.dead = false;
  G.GAME.state.camera.x = px;
  G.GAME.state.camera.y = py;
  G.WORLD.ensureChunks(px, py);
}

/** 各层分别数（定位"贵在哪"）：A11 起按档位分别打一遍 —— 宏观色格与轮廓的代价就在这里 */
function layersAt(camera) {
  const layers = [
    ['地表 + 营地石砖', (ctx) => G.RENDER.drawGround(ctx, camera)],
    ['装饰', (ctx) => G.RENDER.drawDecor(ctx, camera, G.WORLD.decorInView())],
    ['小径路网', (ctx) => G.RENDER.drawRoads(ctx, camera)],
    ['地标', (ctx) => G.RENDER.drawLandmarks(ctx, camera, G.WORLD.landmarksInView())],
    ['营地道具 + 围栏', (ctx) => G.RENDER.drawCamp(ctx, camera)],
    ['怪', (ctx) => G.RENDER.drawMonsters(ctx, camera, G.WORLD.monstersInView(), 0)],
    ['玩家', (ctx) => G.RENDER.drawPlayer(ctx, camera, G.GAME.state.player, G.GAME.state.stats)],
    ['小地图 + HUD', (ctx) => G.HUD.draw(ctx, G.GAME.uiView())]
  ];
  const parts = [];
  for (const [name, draw] of layers) {
    const ctx = G.SELFTEST.fakeContext();
    let drawOps = 0;
    for (const op of DRAW_OPS) {
      const original = ctx[op];
      ctx[op] = function () {
        drawOps += 1;
        return original.apply(this, arguments);
      };
    }
    draw(ctx);
    parts.push(name + ' ' + drawOps);
  }
  console.log('    分层：' + parts.join(' · '));
  const stats = G.RENDER.macroStats ? G.RENDER.macroStats() : null;
  if (stats) console.log('    宏观：一块 ' + stats.blockTiles + ' 格地表（每 chunk ' + stats.blocks + ' 块）· 调色板槽 ' + stats.slots + ' · 装饰斑 ' + stats.blobs);
}

for (let t = 0; t < TIERS.length; t += 1) {
  const tier = TIERS[t];
  tierLabel = tier.name + '档 · ';
  setTier(t);
  console.log('');
  console.log('== ' + tier.name + '档（一屏 ' + tier.tiles + ' 格 · 一格 ' +
    (tier.zoom * G.BAL.world.tileSize * cssPerDesign).toFixed(2) + ' CSS px · 宏观一块 ' + tier.lodBlockTiles + ' 格地表）==');

  // 野外：推着摇杆走 10 秒（怪最多的时候）
  stick.active = true;
  stick.dx = 0.7071;
  stick.dy = 0.7071;
  stick.magnitude = 1;
  for (let i = 0; i < 600; i += 1) G.GAME.step(1000 / 60);
  stick.active = false;
  stick.dx = 0;
  stick.dy = 0;
  stick.magnitude = 0;
  frameCalls('  野外（走了 10 秒，怪最多的时候）');

  // 营地：石砖 + 围栏 + 10 件道具 + 标牌文字，是最"重"的一块地方
  teleport(0, 0);
  frameCalls('  站在原点营地里');
  layersAt({ x: 0, y: 0 });

  G.GAME.state.debug = true;
  frameCalls('  营地 + 调试面板打开（最坏情况）');
  G.GAME.state.debug = false;

  teleport(400000, 400000);
  frameCalls('  跑到很远的地方（深带主题）');
}

/* ------------------------------------------------- 滑块两端（A11 之二） */

/**
 * 缩放轴拖到"一屏 16 / 45 / 64 格"时也要在预算内 —— 档位表只覆盖 128 / 64 / 32，
 * 而玩家真正能拖到的每一格都得诚实（16~64 共 49 个位置；这里取两端 + 宏观档边界 45 格 + **默认格数**）。
 * 45 格是**最贵的那一点**：zoom = 0.5 刚好还在逐格档（阈值 lodZoom 之下才算宏观档），
 * 视野却有 45×97 格 ≈ 2.8×6 个 chunk —— 逐格档里能看到最多的地。
 * A11 之三起默认是 22 格（比 1:1 略近一点：zoom 1.0227），它是"每个新玩家开机就看到的那一帧"，
 * 所以单独占一行，跟最贵的 45 格放在一起比。
 */
const sliderTiles = [...new Set([G.BAL.view.zoomSlider.minTiles, defaultTiles, 45, G.BAL.view.zoomSlider.maxTiles])];
for (const tiles of sliderTiles) {
  G.GAME.setZoomTiles(tiles, true);
  const player = G.GAME.state.player;
  G.GAME.state.camera.x = player.x;
  G.GAME.state.camera.y = player.y;
  G.WORLD.ensureChunks(player.x, player.y);
  const k = G.RENDER.zoom();
  const isDefault = tiles === defaultTiles;
  tierLabel = '缩放轴 ' + tiles + ' 格' + (isDefault ? '（默认）' : '') + ' · ';
  console.log('');
  console.log('== 缩放轴：一屏 ' + tiles + ' 格' + (isDefault ? '（默认）' : '') + '（zoom ' + k.toFixed(6) + ' · 一格 ' +
    (k * G.BAL.world.tileSize * cssPerDesign).toFixed(2) + ' CSS px · 细节档 ' +
    G.RENDER.groundDetailAt(k) + ' · 演员层 ×' + G.RENDER.actorScale().toFixed(2) + '）==');
  teleport(0, 0);
  frameCalls('  站在原点营地里（石砖 + 围栏 + 道具 + 标牌文字）');
  teleport(400000, 400000);
  frameCalls('  跑到很远的地方（深带主题）');
}

/* ------------------------------------------------- 一句话结论（ASCII，GBK 控制台里也能看） */

const worst = frames.reduce((a, b) => (b.draw > a.draw ? b : a));
console.log('');
console.log(`PERF worst=${worst.draw} budget=${budget} verdict=${worst.draw <= budget ? 'PASS' : 'OVER'} (${worst.label})`);
