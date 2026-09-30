/**
 * 无头逻辑断言 —— `node tools/test-logic.mjs`（决策 #7 的验证替代方案）。
 *
 * 为什么这个文件能存在：
 *   只做小游戏端意味着失去"浏览器端到端 harness"这条通道，而上一版恰恰是靠它抓到
 *   "静态检查全过、一进游戏就白屏"的致命错误。替代方案是把**逻辑层做成纯函数**
 *   （`core/` `world/` `game/` 里禁止出现 document / canvas / tt. / window），于是可以在
 *   node 里直接跑源码断言 —— 最容易错、也最值得断言的部分正是这些。
 *
 * 怎么跑：
 *   本机没有 Node（只编辑），在云服务器上跑：
 *     ssh myserver "cd D:\work\phaser-game; node tools/test-logic.mjs"
 *   Node 24 自带 TypeScript 类型擦除，所以**不需要编译**，直接 import `.ts`。
 *   ⚠️ 因此逻辑层只能写"可擦除语法"：不许 enum / namespace / 构造函数参数属性。
 *
 * 覆盖范围随阶段 A 推进而增长（A1：地图确定性；A2：战斗 / 掉落 / 装备；A3：渲染无关）。
 */

import { balance } from '../src/core/balance.ts';
import { hash32, Rng } from '../src/core/rng.ts';
import {
  BAND_SIZE,
  CHUNK_SIZE,
  bandOf,
  chunkIndexOf,
  chunkKeyOf,
  chunkOrigin,
  chunksInRect,
  distance,
  distanceSq,
} from '../src/world/chunk.ts';
import { DECOR_ORDER, buildChunkDecor, groundVariant, themeForBand } from '../src/world/terrain.ts';
import {
  buildChunkMonsters,
  chunkCenterBand,
  landmarkForChunkGroup,
  landmarksInChunkRect,
  monsterLevelFor,
  randomSpawnPoint,
} from '../src/world/spawn.ts';

/* ------------------------------------------------------------------ 断言框架 */

let checks = 0;
let failures = 0;

function section(name) {
  console.log(`\n== ${name} ==`);
}

function ok(name, condition, detail) {
  checks += 1;
  if (condition) {
    console.log(`  ok    ${name}`);
    return true;
  }
  failures += 1;
  console.log(`  FAIL  ${name}${detail === undefined ? '' : ` -> ${detail}`}`);
  return false;
}

function eq(name, actual, expected) {
  return ok(name, Object.is(actual, expected), `got ${String(actual)}, want ${String(expected)}`);
}

function near(name, actual, expected, tolerance) {
  const delta = Math.abs(actual - expected);
  return ok(name, delta <= tolerance, `got ${actual}, want ${expected} ±${tolerance} (Δ${delta.toFixed(6)})`);
}

function between(name, actual, min, max) {
  return ok(name, actual >= min && actual <= max, `got ${actual}, want ${min}..${max}`);
}

/** 结构相等（本工程的确定性要求"逐位相同"，所以直接比字符串） */
function same(name, actual, expected) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  return ok(name, a === b, `got ${a}, want ${b}`);
}

/** 把文本压成一个整数指纹：只用整数运算，才能比出跨机器漂移 */
function fingerprintOf(text) {
  let hash = hash32(text.length, 0x5eed);
  for (let i = 0; i < text.length; i += 1) hash = hash32(hash, text.charCodeAt(i));
  return hash.toString(16);
}

/**
 * 世界指纹：把原点附近 3×3 chunk 的怪 + 装饰 + 地标压成一行再哈希。
 *
 * `GOLDEN_FINGERPRINT` 是**跨进程 / 跨机器**的回归网：一旦有人不小心引入 `Math.random`、
 * 让三角函数参与生成，或把哈希输入从整数换成浮点，这里立刻 FAIL ——
 * 这类漂移在单机上跑一百次都发现不了（同一个进程里两次调用总是一致的）。
 * 首次运行时它是 'PENDING'，脚本会把算出来的值打出来，抄回来即可。
 */
const GOLDEN_FINGERPRINT = 'e9802f11';

function worldFingerprint(seed) {
  const parts = [];
  for (let cy = -1; cy <= 1; cy += 1) {
    for (let cx = -1; cx <= 1; cx += 1) {
      const band = chunkCenterBand(cx, cy);
      for (const monster of buildChunkMonsters(seed, cx, cy)) {
        parts.push(`m${monster.kindId}:${monster.level}:${monster.elite ? 1 : 0}:${monster.x.toFixed(3)}:${monster.y.toFixed(3)}`);
      }
      for (const decor of buildChunkDecor(seed, cx, cy, band)) {
        parts.push(`d${decor.kind}:${decor.x.toFixed(3)}:${decor.y.toFixed(3)}:${decor.size}`);
      }
      const landmark = landmarkForChunkGroup(seed, cx, cy);
      parts.push(`l${landmark.kind}:${landmark.x.toFixed(3)}:${landmark.y.toFixed(3)}`);
    }
  }
  return fingerprintOf(parts.join('|'));
}

/* ------------------------------------------------------------------ 数值表 */

section('数值表（shared/balance.json）');
{
  eq('版本号存在', typeof balance.version, 'number');
  eq('世界种子写入常量（赛季制）', balance.season.worldSeed, 20260930);
  eq('chunk 边长 512', balance.world.chunkSize, 512);
  eq('难度带宽 1000', balance.world.bandSize, 1000);
  eq('每 chunk 怪密度上限 = 3（服务端 CPU 护栏）', balance.world.monstersPerChunk.max, 3);
  eq('精英概率 8%', balance.world.eliteChance, 0.08);
  eq('怪种类 = 4 种', balance.monsters.kinds.length, 4);
  eq('近战 / 群怪 / 远程 / 重甲齐备', balance.monsters.kinds.map((k) => k.id).join(','), 'wolf,bat,mage,brute');
  eq('号角 500 金币（决策 #4）', balance.shop.horn.priceGold, 500);
  eq('宝箱六阶', balance.chests.tiers.length, 6);
  eq('宝箱阶名', balance.chests.tiers.map((t) => t.name).join('/'), '普通/专家/史诗/传说/神话/天赐');
  eq('保底：50 箱无史诗', balance.chests.pity.epic, 50);
  eq('保底：500 箱无神话', balance.chests.pity.mythic, 500);
  eq('宝箱背包上限 200', balance.chests.bagCap, 200);
  eq('装备四部位（武器 / 衣服 / 鞋子 / 饰品）', balance.equipment.slots.length, 4);
  eq(
    '部位顺序 = 武器 / 衣服 / 鞋子 / 饰品',
    balance.equipment.slots.map((s) => s.id).join(','),
    'weapon,armor,boots,trinket',
  );
  eq('装备目录 60 件（六阶 × 10 件）', balance.equipment.catalog.length, 60);
  ok(
    '营地不刷怪的半径 = 石砖地半径',
    balance.world.camp.monsterFreeRadius === balance.world.camp.radius,
    `${balance.world.camp.monsterFreeRadius} / ${balance.world.camp.radius}`,
  );
  ok(
    '视角倍率 0.5~1（拉远看得更多，又不会小到看不清）',
    balance.view.cameraZoom >= 0.5 && balance.view.cameraZoom <= 1,
    String(balance.view.cameraZoom),
  );
  eq('装备词条数曲线 1/2/3/4/5/5', balance.equipment.tiers.map((t) => t.affixes).join(','), '1,2,3,4,5,5');
  eq('装备数值倍率末档 5.3', balance.equipment.tiers[5].multiplier, 5.3);
  eq('公会人数上限 20', balance.guild.memberCap, 20);
  eq('公会 / 商城解锁等级 20', balance.guild.unlockLevel, 20);
  ok(
    '抢怪的两个缓解开关默认关闭（首版按决策 #1 实现）',
    balance.combat.firstHitProtectionMs === 0 && balance.combat.damageShareGate === 0,
    `${balance.combat.firstHitProtectionMs} / ${balance.combat.damageShareGate}`,
  );

  let descending = true;
  for (let i = 1; i < balance.chests.tiers.length; i += 1) {
    if (balance.chests.tiers[i].weight >= balance.chests.tiers[i - 1].weight) descending = false;
  }
  ok('六阶箱权重严格递减', descending, balance.chests.tiers.map((t) => t.weight).join(','));

  let totalXp = 0;
  for (let level = 1; level < balance.progression.targetLevel; level += 1) {
    totalXp += balance.progression.needBase * Math.pow(level, balance.progression.needExponent);
  }
  ok(
    `1→${balance.progression.targetLevel} 级累计经验约 10 万（实测 ${Math.round(totalXp)}）`,
    totalXp > 90000 && totalXp < 115000,
    String(Math.round(totalXp)),
  );
}

/* ------------------------------------------------------------------ 随机数 */

section('确定性随机（core/rng.ts）');
{
  eq('hash32 同输入同输出', hash32(1, 2, 3), hash32(1, 2, 3));
  ok('hash32 不同输入不同输出', hash32(1, 2, 3) !== hash32(3, 2, 1));
  ok('hash32 落在 uint32 区间', hash32(-1, -2, -3) >= 0 && hash32(-1, -2, -3) < 4294967296);

  const a = new Rng(20260930);
  const b = new Rng(20260930);
  let identical = true;
  for (let i = 0; i < 500; i += 1) {
    if (a.next() !== b.next()) identical = false;
  }
  ok('同种子 500 次抽取逐位相同', identical);

  const rng = new Rng(7);
  let inRange = true;
  for (let i = 0; i < 2000; i += 1) {
    const value = rng.next();
    if (value < 0 || value >= 1) inRange = false;
  }
  ok('next() ∈ [0,1)', inRange);

  const r2 = new Rng(11);
  let intOk = true;
  const seen = new Set();
  for (let i = 0; i < 5000; i += 1) {
    const value = r2.int(-2, 2);
    seen.add(value);
    if (value < -2 || value > 2 || !Number.isInteger(value)) intOk = false;
  }
  ok('int(-2,2) 只返回区间内整数', intOk, [...seen].sort().join(','));
  eq('int 的 5 个取值都能取到', seen.size, 5);
  eq('chance(0) 恒 false', new Rng(3).chance(0), false);
  eq('chance(1) 恒 true', new Rng(3).chance(1), true);
  eq('空数组 pick 返回 undefined', new Rng(3).pick([]), undefined);

  const r3 = new Rng(99);
  let hits = 0;
  const rounds = 20000;
  for (let i = 0; i < rounds; i += 1) {
    if (r3.weightedIndex([1, 9]) === 1) hits += 1;
  }
  near('weightedIndex 权重 1:9 → 约 90%', hits / rounds, 0.9, 0.012);

  eq('fork 同盐同流', new Rng(5).fork(1).next(), new Rng(5).fork(1).next());
  ok('fork 与父流不同', new Rng(5).fork(1).next() !== new Rng(5).next());
}

/* ------------------------------------------------------------------ chunk 数学 */

section('chunk 数学（world/chunk.ts）');
{
  eq('世界坐标 0 → chunk 0', chunkIndexOf(0), 0);
  eq('世界坐标 511.9 → chunk 0', chunkIndexOf(511.9), 0);
  eq('世界坐标 512 → chunk 1', chunkIndexOf(512), 1);
  eq('负坐标向负方向取整（-0.5 → -1，不能用 |0）', chunkIndexOf(-0.5), -1);
  eq('负坐标 -512 → -1', chunkIndexOf(-512), -1);
  eq('负坐标 -513 → -2', chunkIndexOf(-513), -2);
  eq('chunkKey 无歧义（逗号分隔）', chunkKeyOf(-3, 7), '-3,7');

  eq('原点 = band 0', bandOf(0, 0), 0);
  eq('距原点 999 = band 0', bandOf(999, 0), 0);
  eq('距原点 1000 = band 1', bandOf(1000, 0), 1);
  eq('斜向按真实距离算（700,700 → band 0）', bandOf(700, 700), 0);
  eq('斜向 1000,1000 → band 1', bandOf(1000, 1000), 1);
  eq('负方向同样成立（-1000,0 → band 1）', bandOf(-1000, 0), 1);

  eq('distanceSq 是纯乘法（3,4 → 25）', distanceSq(0, 0, 3, 4), 25);
  eq('distance 正确开方（3,4 → 5）', distance(0, 0, 3, 4), 5);

  eq('矩形覆盖 3×3 个 chunk（无外圈）', chunksInRect(-100, -100, CHUNK_SIZE + 100, CHUNK_SIZE + 100, 0).length, 9);
  eq('加一圈预载后 5×5（3×3 chunk 视野 + ring 1）', chunksInRect(0, 0, CHUNK_SIZE * 3 - 1, CHUNK_SIZE * 3 - 1, 1).length, 25);
  eq('单个 chunk 无外圈 = 1', chunksInRect(0, 0, CHUNK_SIZE - 1, CHUNK_SIZE - 1, 0).length, 1);
  eq('视野 2×4（竖屏 + chunk 512）加一圈 ≈ 4×6', chunksInRect(0, 0, CHUNK_SIZE * 2 - 1, CHUNK_SIZE * 4 - 1, 1).length, 24);
  eq('BAND_SIZE 与 chunk 尺寸解耦', BAND_SIZE, 1000);
}

/* ------------------------------------------------------------------ 播种 */

section('怪与地标的确定性播种（world/spawn.ts）');
{
  const seed = balance.season.worldSeed;
  same('同 chunk 两次生成完全一致', buildChunkMonsters(seed, 12, -7), buildChunkMonsters(seed, 12, -7));
  ok(
    '相邻 chunk 内容不同（不是全图一样）',
    JSON.stringify(buildChunkMonsters(seed, 12, -7)) !== JSON.stringify(buildChunkMonsters(seed, 13, -7)),
  );

  const chunk = buildChunkMonsters(seed, 0, 0);
  between('原点 chunk 怪数符合密度上限（1~3）', chunk.length, 1, 3);
  eq('band 0 的怪等级 1~3', chunk.every((m) => m.level >= 1 && m.level <= 3), true);
  eq('chunk 内所有怪同属一个 band（按 chunk 中心算）', chunk.every((m) => m.band === chunkCenterBand(0, 0)), true);
  eq('同 chunk 内 ID 唯一', new Set(chunk.map((m) => m.id)).size, chunk.length);
  eq('精英每 chunk 至多 1 只', chunk.filter((m) => m.elite).length <= 1, true);
  eq('等级下限被夹到 1', monsterLevelFor(0, new Rng(1)), 1);

  const far = buildChunkMonsters(seed, 20, 0);
  eq('远处 chunk 的 band 更高', far.every((m) => m.band >= 9), true);
  ok('远处怪等级随之提高', far.every((m) => m.level > 3), far.map((m) => m.level).join(','));

  eq(
    '怪的位置落在本 chunk 内（含群怪铺开半径）',
    chunk.every((m) => m.x >= -80 && m.x <= CHUNK_SIZE + 80 && m.y >= -80 && m.y <= CHUNK_SIZE + 80),
    true,
  );
  eq(
    '巢穴 = 重生点，都在 chunk 内',
    chunk.every((m) => m.homeX >= 0 && m.homeX <= CHUNK_SIZE && m.homeY >= 0 && m.homeY <= CHUNK_SIZE),
    true,
  );
  eq(
    '重生时间 15~30 秒（确定性伪随机）',
    chunk.every((m) => m.respawnMs >= balance.world.respawnMs.min && m.respawnMs <= balance.world.respawnMs.max),
    true,
  );

  let eliteChunks = 0;
  let totalMonsters = 0;
  const sampled = 2000;
  for (let i = 0; i < sampled; i += 1) {
    const monsters = buildChunkMonsters(seed, 100 + i, 37);
    totalMonsters += monsters.length;
    if (monsters.some((m) => m.elite)) eliteChunks += 1;
  }
  near('精英率 ≈ 8%', eliteChunks / sampled, 0.08, 0.015);
  between('平均怪数落在 1~3', totalMonsters / sampled, 1, 3);

  let eliteHpChecked = false;
  for (let i = 0; i < 400 && !eliteHpChecked; i += 1) {
    const monsters = buildChunkMonsters(seed, 200 + i, 11);
    const elite = monsters.find((m) => m.elite);
    const plain = monsters.find((m) => !m.elite && elite !== undefined && m.kindId === elite.kindId);
    if (elite && plain) {
      ok('精英血量远高于同种普通怪（×5 量级）', elite.hpMax > plain.hpMax * 3, `${elite.hpMax} vs ${plain.hpMax}`);
      eliteHpChecked = true;
    }
  }
  ok('400 个 chunk 内能采到精英样本', eliteHpChecked);

  const landmark = landmarkForChunkGroup(seed, 0, 0);
  same('地标同组两次一致', landmark, landmarkForChunkGroup(seed, 0, 0));
  eq('5×5 chunk 范围内恰好 1 个地标', landmarksInChunkRect(seed, 0, 0, 4, 4).length, 1);
  const groupLandmark = landmarksInChunkRect(seed, 0, 0, 4, 4)[0];
  ok(
    '地标落在该组的 chunk 范围内',
    groupLandmark.x >= 0 && groupLandmark.x < CHUNK_SIZE * 5 && groupLandmark.y >= 0 && groupLandmark.y < CHUNK_SIZE * 5,
    `${groupLandmark.x},${groupLandmark.y}`,
  );
  eq('跨 3 个组（0..12 chunk）返回 9 个地标', landmarksInChunkRect(seed, 0, 0, 12, 12).length, 9);

  const spawnPoint = randomSpawnPoint(seed, 0);
  const radius = Math.sqrt(spawnPoint.x * spawnPoint.x + spawnPoint.y * spawnPoint.y);
  between('首次出生半径 300~800（决策 #5）', radius, 300, 800);
  same('出生点同参数同结果', randomSpawnPoint(seed, 0), spawnPoint);
  ok('不同角色序号出生点不同', JSON.stringify(randomSpawnPoint(seed, 1)) !== JSON.stringify(spawnPoint));
}

/* ------------------------------------------------------------------ 地表与装饰 */

section('确定性地表与装饰（world/terrain.ts）');
{
  const seed = balance.season.worldSeed;
  const decorations = buildChunkDecor(seed, 3, 3, 0);
  between('装饰数量 8~24', decorations.length, balance.world.decorPerChunk.min, balance.world.decorPerChunk.max);
  same('同 chunk 两次装饰一致', buildChunkDecor(seed, 3, 3, 0), decorations);
  eq(
    '装饰坐标都在 chunk 内（按该 chunk 的世界原点判定）',
    decorations.every(
      (d) =>
        d.x >= chunkOrigin(3) &&
        d.x <= chunkOrigin(3) + CHUNK_SIZE &&
        d.y >= chunkOrigin(3) &&
        d.y <= chunkOrigin(3) + CHUNK_SIZE,
    ),
    true,
  );
  eq('装饰种类合法', decorations.every((d) => DECOR_ORDER.includes(d.kind)), true);

  eq(
    'band 决定主题：0 草原 / 1 荒漠 / 4 虚境',
    `${themeForBand(0).name},${themeForBand(1).name},${themeForBand(4).name}`,
    '草原,荒漠,虚境',
  );
  eq('band 超出主题档位后固定最后一档', themeForBand(9).id, themeForBand(4).id);

  const grassland = buildChunkDecor(seed, 3, 3, 0);
  const desert = buildChunkDecor(seed, 3, 3, 1);
  eq(
    '换 band 只改种类权重、不改坐标（否则"同坐标同内容"就破了）',
    desert.map((d) => `${d.x.toFixed(3)},${d.y.toFixed(3)}`).join(';'),
    grassland.map((d) => `${d.x.toFixed(3)},${d.y.toFixed(3)}`).join(';'),
  );

  let grass = 0;
  let rock = 0;
  for (let i = 0; i < 300; i += 1) {
    for (const decor of buildChunkDecor(seed, i, 5, 0)) {
      if (decor.kind === 'grass') grass += 1;
      if (decor.kind === 'rock') rock += 1;
    }
  }
  ok('草原主题以草为主（权重 60 : 25）', grass > rock * 1.5, `grass=${grass} rock=${rock}`);

  const variants = new Set();
  for (let tileX = 0; tileX < 8; tileX += 1) {
    for (let tileY = 0; tileY < 8; tileY += 1) variants.add(groundVariant(seed, 0, 0, tileX, tileY));
  }
  eq('地表色块在 8×8 网格上取到 3 种颜色', variants.size, 3);
  eq('地表色块同参数同结果', groundVariant(seed, 0, 0, 3, 4), groundVariant(seed, 0, 0, 3, 4));
}

/* ------------------------------------------------------------------ 跨机器指纹 */

section('世界指纹（跨进程回归网）');
{
  const fingerprint = worldFingerprint(balance.season.worldSeed);
  if (GOLDEN_FINGERPRINT === 'PENDING') {
    console.log(`  info  当前世界指纹 = ${fingerprint}`);
    console.log('  info  首次运行：把上面这行抄进本文件顶部的 GOLDEN_FINGERPRINT');
    checks += 1;
  } else {
    eq('世界指纹与基准一致（防浮点 / 三角函数 / 随机源漂移）', fingerprint, GOLDEN_FINGERPRINT);
  }
}

/* ------------------------------------------------------------------ 汇总 */

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}  ${checks - failures}/${checks} 项通过`);
if (failures > 0) console.log(`共 ${failures} 项失败（见上面的 FAIL 行）`);
process.exit(failures === 0 ? 0 : 1);

