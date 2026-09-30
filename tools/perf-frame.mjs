/**
 * perf-frame.mjs —— 数一帧到底有多少次绘制调用（02-architecture §9 的"每帧绘制调用 ≤ 400"预算）
 *
 * 为什么需要它：十九秒的冒烟只断言"画出来了、没 NaN"，不能回答"会不会画太多"。
 * 换外观（阶段 A3 的自绘角色 / 营地 / 路网 / 小地图）以后，这一层最容易悄悄翻倍，所以留一把尺子。
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
const PATH_OPS = ['beginPath', 'closePath', 'moveTo', 'lineTo', 'arc'];

const frames = [];

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
  frames.push({ label, draw: stats.draw });
  const verdict = stats.draw <= budget ? 'ok  ' : 'OVER';
  console.log(`  ${verdict} ${label}: 落笔 ${stats.draw} 次（预算 ${budget}）  建路径 ${stats.path} 次  总调用 ${stats.all}`);
  return stats;
}

G.SAVE.clear();
G.GAME.boot();

const stick = G.INPUT.state.stick;
stick.active = true;
stick.dx = 0.7071;
stick.dy = 0.7071;
stick.magnitude = 1;
for (let i = 0; i < 600; i += 1) G.GAME.step(1000 / 60);

console.log('== 每帧绘制调用 ==');
frameCalls('走了 10 秒之后（怪最多的时候）');

stick.active = false;
stick.dx = 0;
stick.dy = 0;
stick.magnitude = 0;

// 营地：石砖 + 围栏 + 10 件道具 + 标牌文字，是最"重"的一块地方
G.GAME.state.player.x = 0;
G.GAME.state.player.y = 0;
G.GAME.state.camera.x = 0;
G.GAME.state.camera.y = 0;
G.WORLD.ensureChunks(0, 0);
frameCalls('站在原点营地里');

/* ------------------------------------------------- 各层分别数（定位"贵在哪"） */

console.log('');
console.log('== 营地里各层的落笔次数 ==');
const camera = { x: 0, y: 0 };
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
  console.log(`  ${name}: ${drawOps}`);
}

G.GAME.state.debug = true;
frameCalls('营地里 + 调试面板打开（最坏情况）');
G.GAME.state.debug = false;

G.GAME.state.player.x = 400000;
G.GAME.state.player.y = 400000;
G.GAME.state.camera.x = 400000;
G.GAME.state.camera.y = 400000;
G.WORLD.ensureChunks(400000, 400000);
frameCalls('跑到很远的地方（深带主题）');

/* ------------------------------------------------- 一句话结论（ASCII，GBK 控制台里也能看） */

const worst = frames.reduce((a, b) => (b.draw > a.draw ? b : a));
console.log('');
console.log(`PERF worst=${worst.draw} budget=${budget} verdict=${worst.draw <= budget ? 'PASS' : 'OVER'} (${worst.label})`);
