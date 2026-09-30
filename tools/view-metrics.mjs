/**
 * view-metrics.mjs —— 一屏到底装得下多少格？（A8「一屏 128×128 格」口径的那把尺子）
 *
 * 为什么需要它：`view.cameraZoom` 一改，"玩家视角里有多少格"就变了，而**竖屏一屏不是正方形** ——
 * 横向格数 = `view.designWidth / (cameraZoom × world.tileSize)`（与设备无关的定值），
 * 竖向格数 = 横向 × 手机长宽比（随设备变）。改倍率 / tileSize / designWidth 之后跑一下，答案立刻出来，
 * 顺手把"一格与角色在屏幕上几 CSS px"打出来（A8 的标准就是靠这个数看清代价的）。
 *
 * A9 起它同时回答"拉远之后还看得见什么"：角色（演员层 `view.actorMinZoom` 之后）、
 * 地面上的粗色格（`view.lodGroundBlocks`）、装饰斑（`TERRAIN.decorBlobs`）各是几 CSS px，
 * 末尾还打一张**宏观地形文本预览**（每个字符 = 一个粗色格；远距档真的画出来的就是这些）。
 *
 * 用法（本机没有独立 node，用抖音开发者工具自带的 Electron 当 node）：
 *   powershell -ExecutionPolicy Bypass -File tools\minigame-node.ps1 tools\view-metrics.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const bundlePath = path.join(root, 'douyin-minigame', 'game.js');
const code = fs.readFileSync(bundlePath, 'utf8');
const G = new Function('console', 'tt', 'setTimeout', code + '\n; return G;')(console, undefined, setTimeout);

const tile = G.BAL.world.tileSize;
const chunk = G.BAL.world.chunkSize;
const designWidth = G.BAL.view.designWidth;
const playerRadius = G.BAL.player.radius;
const tiers = G.BAL.view.cameraTiers;
/** 默认格数（A11 之三：用户指定的 22 格）—— 开机就是这个视角，独立占一行 */
const defaultTiles = Math.round(G.BAL.view.zoomTiles);

console.log('designWidth=' + designWidth + '  tileSize=' + tile + '  chunkSize=' + chunk +
  '  tilesPerChunk=' + G.TERRAIN.tileCountPerChunk() +
  '  视角档位 ' + tiers.map((t) => t.name + '(' + t.tiles + '格)').join(' / '));

const cases = [
  ['16:9     360x640', 360, 640],
  ['19.5:9   375x812 (iPhone X class)', 375, 812],
  ['19.5:9   390x844 (iPhone 12/13)', 390, 844],
  ['20:9     393x873', 393, 873],
  ['Pixel    393x852', 393, 852],
  ['iPad     768x1024', 768, 1024]
];

const camera = { x: 0, y: 0 };

/**
 * 一个视角档位下的全部读数（A11）：三档各打一遍 —— "拉近一档能多看多少 / 能看清多少"就是这张表。
 * 每个档位都走**游戏里那条路径**切换（`GAME.setZoomTier`），所以读数与真机一致。
 */
function reportTier(index) {
  const tier = tiers[index];
  G.GAME.setZoomTier(index, true);
  const zoom = G.RENDER.zoom();
  const blocks = G.RENDER.lodBlocks();
  const macroBlock = chunk / blocks;
  const actorScale = G.RENDER.actorScale();
  const detail = G.RENDER.groundDetailAt(zoom);
  const mapRadius = G.HUD.minimapRadius();

  console.log('');
  console.log('== ' + tier.name + '档（一屏横向 ' + tier.tiles + ' 格）==');
  console.log('  zoom=' + zoom + '   横向格数 = designWidth / (zoom × tileSize) = ' +
    (designWidth / (zoom * tile)).toFixed(2) + ' 格   一格 = ' +
    (tile * zoom * (375 / designWidth)).toFixed(2) + ' CSS px');
  console.log('  细节档 = ' + detail + '（阈值 view.lodZoom = ' + G.BAL.view.lodZoom + '）：' +
    (detail === 'high'
      ? '逐格档 —— 每 chunk ' + G.TERRAIN.tileCountPerChunk() + '×' + G.TERRAIN.tileCountPerChunk() + ' 色格 + 细纹 + 逐件装饰'
      : '宏观档 —— 色格 ' + blocks + ' 格（' + macroBlock + ' 世界单位 ≈ ' +
        (macroBlock * zoom * (375 / designWidth)).toFixed(2) + ' CSS px）+ 地形轮廓 + ≤' +
        G.BAL.view.lodDecorBlobs + ' 个装饰斑/chunk'));
  console.log('  演员层 view.actorMinZoom = ' + G.BAL.view.actorMinZoom + ' → 放大 ' + actorScale.toFixed(3) +
    ' 倍   角色直径 = ' + (playerRadius * 2 * actorScale * zoom * (375 / designWidth)).toFixed(2) + ' CSS px' +
    '（不放大就只有 ' + (playerRadius * 2 * zoom * (375 / designWidth)).toFixed(2) + '）');
  console.log('  小地图 = 半径 ' + mapRadius + ' chunk（' + (mapRadius * 2 + 1) + '×' + (mapRadius * 2 + 1) + ' chunk = ' +
    ((mapRadius * 2 + 1) * chunk) / tile + '×' + ((mapRadius * 2 + 1) * chunk) / tile + ' 格宽，永远比一屏宽一点）');

  for (const c of cases) {
  const cssW = c[1];
  G.SCREEN.resize({ cssW: cssW, cssH: c[2], dpr: 2, safeArea: null });
  const r = G.RENDER.viewRect(camera);
  const cssPerDesign = cssW / G.SCREEN.width();
  console.log(
    c[0].padEnd(36) +
    ' design=' + G.SCREEN.width().toFixed(1) + 'x' + G.SCREEN.height().toFixed(1) +
    '  world=' + r.width.toFixed(1) + 'x' + r.height.toFixed(1) +
    '  tiles=' + (r.width / tile).toFixed(2) + 'x' + (r.height / tile).toFixed(2) +
    '  full=' + Math.floor(r.width / tile) + 'x' + Math.floor(r.height / tile) +
    '  chunks=' + (r.width / chunk).toFixed(2) + 'x' + (r.height / chunk).toFixed(2) +
    '  一格=' + (tile * zoom * cssPerDesign).toFixed(2) + 'CSSpx' +
    '  粗色格=' + (macroBlock * zoom * cssPerDesign).toFixed(2) + 'CSSpx' +
    '  角色=' + (playerRadius * 2 * actorScale * zoom * cssPerDesign).toFixed(2) + 'CSSpx' +
    '（无演员层 ' + (playerRadius * 2 * zoom * cssPerDesign).toFixed(2) + '）'
  );
}

// 小地图覆盖多大 / 每 chunk 画多少格：都跟着视角档位变，所以现在由 reportTier 按档位打（见下）

/**
 * 宏观地形文本预览（A9；A11 起按档位各打一遍）：**这一档真正画出来的东西**。
 * 每字符 = 一个色格（`world.chunkSize / RENDER.lodBlocks()` 世界单位）：
 *   0..5 = 色档（同一份地表哈希的粗抽样，0 最暗）  g/r/T = 草甸 / 石滩 / 林地的装饰斑（TERRAIN.decorBlobs）
 * 远档是 4 格一块、中档 2 格一块：同一片地，字符数一样但每个字符代表的世界更小 = **细节翻倍**。
 * 一片纯色 = 宏观档没生效；看不清结构就说明该往近档切。
 */
  {
    const seed2 = G.BAL.season.worldSeed;
    const previewBlocks = blocks;
    const blockWorld = chunk / previewBlocks;
    const step = Math.max(1, Math.round(G.TERRAIN.tileCountPerChunk() / previewBlocks));
    const letters = { grass: 'g', rock: 'r', tree: 'T' };
    const cols = 32;
    const rows = 18;
    const bx0 = -Math.floor(cols / 2);
    const by0 = -Math.floor(rows / 2);
    const cells = {};

    for (let oy = 0; oy < rows; oy += 1) {
      for (let ox = 0; ox < cols; ox += 1) {
        const bx = bx0 + ox;
        const by = by0 + oy;
        const cx = Math.floor((bx * blockWorld) / chunk);
        const cy = Math.floor((by * blockWorld) / chunk);
        const lx = ((bx % previewBlocks) + previewBlocks) % previewBlocks;
        const ly = ((by % previewBlocks) + previewBlocks) % previewBlocks;
        cells[by + ',' + bx] = String(G.RENDER.groundLevel(seed2, cx, cy, lx * step, ly * step));
      }
    }

    // 装饰斑：落在哪个色格里就写在那个字符上（与渲染层同一份聚合）
    const cxMin = Math.floor((bx0 * blockWorld) / chunk) - 1;
    const cxMax = Math.floor(((bx0 + cols) * blockWorld) / chunk) + 1;
    const cyMin = Math.floor((by0 * blockWorld) / chunk) - 1;
    const cyMax = Math.floor(((by0 + rows) * blockWorld) / chunk) + 1;
    for (let ccx = cxMin; ccx <= cxMax; ccx += 1) {
      for (let ccy = cyMin; ccy <= cyMax; ccy += 1) {
        const band = G.SPAWN.chunkCenterBand(ccx, ccy);
        const blobs = G.TERRAIN.decorBlobs(seed2, ccx, ccy, band, G.BAL.view.lodDecorBlobs);
        for (const b of blobs) {
          const bx = Math.floor(b.x / blockWorld);
          const by = Math.floor(b.y / blockWorld);
          const key = by + ',' + bx;
          if (cells[key] !== undefined) cells[key] = letters[b.kind] || '?';
        }
        // 玩家 / 营地那一格
        if (ccx === 0 && ccy === 0) {
          const camp = G.TERRAIN.campCenter();
          cells[Math.floor(camp.y / blockWorld) + ',' + Math.floor(camp.x / blockWorld)] = '@';
        }
      }
    }

    console.log('');
    console.log('  地形预览（每字符 = 一个色格 ' + blockWorld + ' 世界单位 ≈ ' +
      (blockWorld * zoom * (375 / G.BAL.view.designWidth)).toFixed(1) + ' CSS px；@ = 原点新手营地）');
    for (let oy = 0; oy < rows; oy += 1) {
      let line = '';
      for (let ox = 0; ox < cols; ox += 1) line += cells[by0 + oy + ',' + (bx0 + ox)];
      console.log('  ' + line);
    }
    console.log('  图例：0..5 = 地表色档（0 最暗、5 最亮）  g / r / T = 草甸 / 石滩 / 林地斑  @ = 营地');
  }
}

for (let i = 0; i < tiers.length; i += 1) reportTier(i);

/* ------------------------------------------------- 缩放轴（A11 之二）：滑块两端也要有读数 */

/**
 * 设置面板里的滚动轴能拖到 16 ~ 64 格之间**每一格**（档位表只有 128 / 64 / 32），
 * 所以这里按"滑块端点 + 中间一点"各打一行：一格几 CSS px / 细节档 / 角色观感 / 小地图半径。
 * 45 格是分界线：zoom = 0.5 正好等于 `view.lodZoom`，再远一格地表就换成宏观档了。
 * A11 之三起**默认是 22 格**（比 1:1 略近：一屏 22.5 格才是 1:1）—— 它是每个新玩家开机就看到的读数。
 */
console.log('');
console.log('== 缩放轴（设置面板里的滑块，一屏 ' + G.BAL.view.zoomSlider.minTiles + '~' +
  G.BAL.view.zoomSlider.maxTiles + ' 格；默认一屏 ' + defaultTiles + ' 格）==');
const sliderTiles = [...new Set([G.BAL.view.zoomSlider.minTiles, defaultTiles, 40, 45, G.BAL.view.zoomSlider.maxTiles])];
for (const tiles of sliderTiles) {
  G.GAME.setZoomTiles(tiles, true);
  const zoom = G.RENDER.zoom();
  const rect = G.RENDER.viewRect({ x: 0, y: 0 });
  console.log('  ' + String(tiles).padStart(3) + ' 格' + (tiles === defaultTiles ? '（默认）' : '') + '  zoom=' + zoom.toFixed(6) +
    '  一格=' + (tile * zoom * (375 / designWidth)).toFixed(2) + ' CSS px' +
    '  视野=' + (rect.width / tile).toFixed(0) + 'x' + (rect.height / tile).toFixed(0) + ' 格' +
    '  细节档=' + G.RENDER.groundDetailAt(zoom) +
    '  角色=' + (playerRadius * 2 * G.RENDER.actorScale() * zoom * (375 / designWidth)).toFixed(2) + ' CSS px' +
    '  小地图=' + G.HUD.minimapRadius() + ' chunk' +
    '  档名=' + G.GAME.zoomView().name);
}
G.GAME.setZoomTier(G.BAL.view.cameraTier, true);

