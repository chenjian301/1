/**
 * 世界勘探器 —— `node tools/inspect-world.mjs [x] [y]`
 *
 * 为什么在阶段 A 就要有它：
 *   渲染层（A3）还没写，但"无限地图是否真的确定、分带是否真的越走越强、同一坐标是不是
 *   永远同一份内容"这些**必须现在就能看见**，而不是等有了画面才发现不对。
 *   它把纯逻辑层的输出直接画成 ASCII：每个 chunk 一格，字母 = 主题、数字 = 怪数。
 *
 * 两个顺手的用途：
 *   1. 调数值 —— 改 `shared/balance.json` 后立刻看分带、怪数与掉箱率怎么变；
 *   2. 现场自证确定性 —— 同一坐标连算两次逐字比较（跨进程的那道网在 `test-logic.mjs`）。
 *
 * 按世界坐标查：`node tools/inspect-world.mjs 5200 -3100`；不带参数 = 原点。
 */

import { balance } from '../src/core/balance.ts';
import { CHUNK_SIZE, bandOf, chunkLocalOf, chunkOfWorld, distanceToOrigin } from '../src/world/chunk.ts';
import { buildChunkDecor, themeForBand, themeIndexForBand } from '../src/world/terrain.ts';
import { buildChunkMonsters, chunkCenterBand, landmarksInChunkRect } from '../src/world/spawn.ts';

const seed = balance.season.worldSeed;
const args = process.argv.slice(2).map((value) => Number(value));
const x = Number.isFinite(args[0]) ? args[0] : 0;
const y = Number.isFinite(args[1]) ? args[1] : 0;

/** 主题字母（ASCII 单字符：绕开控制台编码问题） */
const THEME_LETTERS = ['g', 'd', 's', 'c', 'v'];
/** 地图半径：以查询点所在 chunk 为中心，画 (2R+1)×(2R+1) 个 chunk */
const RADIUS = 3;

const { cx, cy } = chunkOfWorld(x, y);
const local = chunkLocalOf(x, y);

/** 一个 chunk 的摘要（地图、详情、确定性自检共用同一份计算） */
function summarize(chunkX, chunkY) {
  const band = chunkCenterBand(chunkX, chunkY);
  const monsters = buildChunkMonsters(seed, chunkX, chunkY);
  return {
    band,
    theme: themeForBand(band),
    themeLetter: THEME_LETTERS[themeIndexForBand(band)],
    monsters,
    decor: buildChunkDecor(seed, chunkX, chunkY, band),
    elite: monsters.some((m) => m.elite),
  };
}

/* ------------------------------------------------------------------ 表头 */

console.log(`世界种子 ${seed}（赛季 ${balance.season.name}）  chunk ${CHUNK_SIZE}×${CHUNK_SIZE}  难度带宽 ${balance.world.bandSize}`);
console.log(`查询点  world(${x}, ${y})  距原点 ${distanceToOrigin(x, y).toFixed(1)}  难度带 band ${bandOf(x, y)}（${themeForBand(bandOf(x, y)).name}）`);
console.log(`所属 chunk (${cx}, ${cy})  chunk 内局部坐标 (${local.lx.toFixed(1)}, ${local.ly.toFixed(1)})`);

/* ------------------------------------------------------------------ ASCII 地图 */

console.log(`\n【附近 ${RADIUS * 2 + 1}×${RADIUS * 2 + 1} 个 chunk】字母=主题(g草原 d荒漠 s雪原 c焦土 v虚境) 数字=怪数  * =有精英  > =你所在的 chunk`);
console.log('            ' + Array.from({ length: RADIUS * 2 + 1 }, (_, i) => String(cx - RADIUS + i).padStart(5)).join(''));

for (let offsetY = RADIUS; offsetY >= -RADIUS; offsetY -= 1) {
  let row = `cy ${String(cy + offsetY).padStart(5)}   `;
  for (let offsetX = -RADIUS; offsetX <= RADIUS; offsetX += 1) {
    const summary = summarize(cx + offsetX, cy + offsetY);
    const here = offsetX === 0 && offsetY === 0 ? '>' : ' ';
    row += `${summary.themeLetter}${summary.monsters.length}${summary.elite ? '*' : ' '}${here}`;
  }
  console.log(row);
}

/* ------------------------------------------------------------------ 中心 chunk 详情 */

const center = summarize(cx, cy);
console.log(`\n【你的 chunk (${cx}, ${cy}) 详情】band ${center.band} · ${center.theme.name} · 装饰 ${center.decor.length} 个 · 怪 ${center.monsters.length} 只`);
if (center.monsters.length === 0) {
  console.log('  （空 chunk：往旁边走一格就有，密度上限是每 chunk 1~3 只）');
}
for (const monster of center.monsters) {
  console.log(
    `  id ${String(monster.id).padStart(10)}  ${monster.name.padEnd(9)} Lv.${String(monster.level).padStart(2)} ${monster.elite ? '★精英' : '  普通'}` +
      `  HP ${String(monster.hpMax).padStart(5)}  攻 ${String(monster.attack).padStart(3)}  防 ${String(monster.defense).padStart(3)}` +
      `  ${monster.ranged ? '远程' : '近战'}  巢穴(${monster.homeX.toFixed(0)}, ${monster.homeY.toFixed(0)})  重生 ${(monster.respawnMs / 1000).toFixed(1)}s`,
  );
}

/* ------------------------------------------------------------------ 附近地标 */

const landmarks = landmarksInChunkRect(seed, cx - RADIUS, cy - RADIUS, cx + RADIUS, cy + RADIUS);
console.log(`\n【附近地标】每 ${balance.world.landmarkChunkSpan}×${balance.world.landmarkChunkSpan} 个 chunk 一个（也是以后公会锚点的候选点）`);
for (const landmark of landmarks) {
  console.log(
    `  ${landmark.kind === 'ruins' ? '废墟' : '石碑'}  world(${landmark.x.toFixed(0)}, ${landmark.y.toFixed(0)})` +
      `  chunk 组(${landmark.gx}, ${landmark.gy})  band ${landmark.band}  距原点 ${distanceToOrigin(landmark.x, landmark.y).toFixed(0)}`,
  );
}

/* ------------------------------------------------------------------ 现场自证确定性 */

function snapshot() {
  const rows = [];
  for (let offsetY = RADIUS; offsetY >= -RADIUS; offsetY -= 1) {
    for (let offsetX = -RADIUS; offsetX <= RADIUS; offsetX += 1) {
      const summary = summarize(cx + offsetX, cy + offsetY);
      rows.push(
        [
          cx + offsetX,
          cy + offsetY,
          summary.band,
          summary.themeLetter,
          summary.decor.length,
          summary.monsters.map((m) => `${m.id}:${m.level}:${m.elite ? 1 : 0}:${m.x.toFixed(3)}:${m.y.toFixed(3)}:${m.hpMax}`).join('/'),
        ].join('|'),
      );
    }
  }
  return rows.join('\n');
}

const first = snapshot();
const second = snapshot();
console.log(`\n【确定性】同一坐标连算两次：${first === second ? 'OK（逐字一致）' : '漂移！生成里混进了非确定性随机'}`);

/* ------------------------------------------------------------------ 分带速览 */

console.log('\n【分带速览】往东每 1000 世界单位一带：怪变强、箱变好（数值全部来自 shared/balance.json）');
for (let sample = 0; sample <= 6; sample += 1) {
  const sampleX = sample * 1000 + 512;
  const chunk = chunkOfWorld(sampleX, 512);
  const sampleBand = chunkCenterBand(chunk.cx, chunk.cy);
  const summary = summarize(chunk.cx, chunk.cy);
  const levels = summary.monsters.map((m) => m.level);
  const levelRange = levels.length === 0 ? '-' : `${Math.min(...levels)}~${Math.max(...levels)}`;
  const avgHp =
    summary.monsters.length === 0
      ? 0
      : Math.round(summary.monsters.reduce((sum, m) => sum + m.hpMax, 0) / summary.monsters.length);
  const dropRate = Math.min(balance.chests.drop.base + sampleBand * balance.chests.drop.perBand, balance.chests.drop.cap);
  console.log(
    `  x≈${String(sampleX).padStart(6)}  band ${String(sampleBand).padStart(2)}  ${themeForBand(sampleBand).name.padEnd(3)}` +
      `  怪 Lv.${levelRange.padStart(5)}  平均 HP ${String(avgHp).padStart(5)}  掉箱率 ${(dropRate * 100).toFixed(0)}%` +
      `  ${summary.elite ? '（含精英）' : ''}`,
  );
}

/* ------------------------------------------------------------------ 怎么用 */

console.log('\n用法：node tools/inspect-world.mjs [世界x] [世界y]   —— 换个坐标看同一套规则生成的另一片地。');

