/**
 * 18-selftest.js —— 游戏内自检 / 调试断言（本工程唯一的"自动验证"入口）
 *
 * 为什么要在游戏里再写一遍断言：
 *   1. `tools\test-logic.mjs` 跑的是 `src\` 里的 TypeScript 参照实现；小游戏里真正跑的是
 *      本目录的 JS。两份实现之间不许漂移 —— **世界指纹**就是那把尺子：这里算出来的值必须
 *      等于 test-logic.mjs 里的 GOLDEN_FINGERPRINT（e9802f11），不等就说明"有人只改了一边"。
 *   2. 手感与渲染只能靠 IDE 模拟器 + 真机，但**最容易错的那部分逻辑**（地图确定性、伤害结算、
 *      掉箱、装备、升级曲线）在模拟器里点一下「设置 → 自检」就能看到 PASS/FAIL，不用装环境。
 *
 * 入口：runAll() 只做纯逻辑断言（不碰画布、不碰 tt），游戏内面板与
 * `tools\minigame-selftest.mjs`（node）共用同一份代码。
 *
 * 断言写法与 `tools\test-logic.mjs` 完全一致（section / ok / eq / near / between / same），
 * 这样两边的输出可以对着看。
 */

G.SELFTEST = (function () {
  'use strict';

  var BAL = G.BAL;
  var RNG = G.RNG;
  var SPAWN = G.SPAWN;
  var TERRAIN = G.TERRAIN;
  var PROG = G.PROG;
  var LOOT = G.LOOT;

  /** 世界指纹基准：与 tools\test-logic.mjs 的 GOLDEN_FINGERPRINT 必须是同一个字符串 */
  var GOLDEN_FINGERPRINT = 'e9802f11';

  var state = { checks: 0, failures: 0, lines: [] };

  function log(line) {
    state.lines.push(line);
  }

  function section(name) {
    log('');
    log('== ' + name + ' ==');
  }

  function ok(name, condition, detail) {
    state.checks += 1;
    if (condition) {
      log('  ok    ' + name);
      return true;
    }
    state.failures += 1;
    log('  FAIL  ' + name + (detail === undefined ? '' : ' -> ' + detail));
    return false;
  }

  function eq(name, actual, expected) {
    return ok(name, actual === expected, 'got ' + String(actual) + ', want ' + String(expected));
  }

  function near(name, actual, expected, tolerance) {
    var delta = Math.abs(actual - expected);
    return ok(name, delta <= tolerance, 'got ' + actual + ', want ' + expected + ' +-' + tolerance);
  }

  function between(name, actual, min, max) {
    return ok(name, actual >= min && actual <= max, 'got ' + actual + ', want ' + min + '..' + max);
  }

  /** 结构相等（确定性要求"逐位相同"，所以直接比 JSON 字符串） */
  function same(name, actual, expected) {
    var a = JSON.stringify(actual);
    var b = JSON.stringify(expected);
    return ok(name, a === b, 'got ' + a + ', want ' + b);
  }

  /** 把文本压成整数指纹（只做整数运算，才比得出跨机器漂移） */
  function fingerprintOf(text) {
    var hash = RNG.hash32(text.length, 0x5eed);
    for (var i = 0; i < text.length; i += 1) hash = RNG.hash32(hash, text.charCodeAt(i));
    return hash.toString(16);
  }

  /**
   * 世界指纹：把原点附近 3×3 chunk 的怪 + 装饰 + 地标压成一行再哈希。
   * 与 tools\test-logic.mjs 的 worldFingerprint 逐行对应 —— 改这里必须同步改那边。
   */
  function worldFingerprint(seed) {
    var parts = [];
    var cy;
    var cx;
    for (cy = -1; cy <= 1; cy += 1) {
      for (cx = -1; cx <= 1; cx += 1) {
        var band = SPAWN.chunkCenterBand(cx, cy);
        var monsters = SPAWN.buildChunkMonsters(seed, cx, cy);
        for (var i = 0; i < monsters.length; i += 1) {
          var m = monsters[i];
          parts.push('m' + m.kindId + ':' + m.level + ':' + (m.elite ? 1 : 0) + ':' + m.x.toFixed(3) + ':' + m.y.toFixed(3));
        }
        var decor = TERRAIN.buildChunkDecor(seed, cx, cy, band);
        for (var d = 0; d < decor.length; d += 1) {
          var item = decor[d];
          parts.push('d' + item.kind + ':' + item.x.toFixed(3) + ':' + item.y.toFixed(3) + ':' + item.size);
        }
        var landmark = SPAWN.landmarkForChunkGroup(seed, cx, cy);
        parts.push('l' + landmark.kind + ':' + landmark.x.toFixed(3) + ':' + landmark.y.toFixed(3));
      }
    }
    return fingerprintOf(parts.join('|'));
  }

  /** 每次 runAll 前复位计数器（面板可以反复点） */
  function reset() {
    state.checks = 0;
    state.failures = 0;
    state.lines = [];
  }

  /* -------------------------------------------------- 1. 数值表（只读校验） */

  function checkBalance() {
    section('数值表（shared/balance.json）');
    eq('世界种子写死（赛季制）', BAL.season.worldSeed, 20260930);
    eq('chunk 边长 512', BAL.world.chunkSize, 512);
    eq('难度带宽 1000', BAL.world.bandSize, 1000);
    eq('每 chunk 怪密度上限 = 3', BAL.world.monstersPerChunk.max, 3);
    eq('精英概率 8%', BAL.world.eliteChance, 0.08);
    eq('怪种类 = 4 种', BAL.monsters.kinds.length, 4);
    eq('近战/群怪/远程/重甲齐备', BAL.monsters.kinds.map(function (k) { return k.id; }).join(','), 'wolf,bat,mage,brute');
    eq('号角 500 金币（决策 #4）', BAL.shop.horn.priceGold, 500);
    eq('宝箱六阶', BAL.chests.tiers.length, 6);
    eq('宝箱阶名', BAL.chests.tiers.map(function (t) { return t.name; }).join('/'), '普通/专家/史诗/传说/神话/天赐');
    eq('保底：50 箱无史诗', BAL.chests.pity.epic, 50);
    eq('保底：500 箱无神话', BAL.chests.pity.mythic, 500);
    eq('宝箱背包上限 200', BAL.chests.bagCap, 200);
    eq('装备六部位', BAL.equipment.slots.length, 6);
    eq('装备词条数 1/2/3/4/5/5', BAL.equipment.tiers.map(function (t) { return t.affixes; }).join(','), '1,2,3,4,5,5');
    eq('装备末阶倍率 5.3', BAL.equipment.tiers[5].multiplier, 5.3);
    eq('公会人数上限 20', BAL.guild.memberCap, 20);
    eq('公会 / 商城解锁等级 20', BAL.guild.unlockLevel, 20);
    ok(
      '抢怪的两个缓解开关默认关闭（决策 #1）',
      BAL.combat.firstHitProtectionMs === 0 && BAL.combat.damageShareGate === 0,
      BAL.combat.firstHitProtectionMs + ' / ' + BAL.combat.damageShareGate
    );

    var descending = true;
    for (var i = 1; i < BAL.chests.tiers.length; i += 1) {
      if (BAL.chests.tiers[i].weight >= BAL.chests.tiers[i - 1].weight) descending = false;
    }
    ok('六阶箱权重严格递减', descending, BAL.chests.tiers.map(function (t) { return t.weight; }).join(','));

    var total = 0;
    for (var level = 1; level < BAL.progression.targetLevel; level += 1) total += PROG.xpToNext(level);
    ok(
      '1→20 级累计经验约 10 万（实测 ' + Math.round(total) + '）',
      total > 90000 && total < 115000,
      String(Math.round(total))
    );
  }

  /* ---------------------------------------- 2. chunk 数学（与 TS 侧逐条对应） */

  function checkChunk() {
    section('chunk 数学（03-chunk.js）');
    var C = G.CHUNK;
    eq('世界坐标 0 → chunk 0', C.chunkIndexOf(0), 0);
    eq('世界坐标 511.9 → chunk 0', C.chunkIndexOf(511.9), 0);
    eq('世界坐标 512 → chunk 1', C.chunkIndexOf(512), 1);
    eq('负坐标向负方向取整（-0.5 → -1，不能用 |0）', C.chunkIndexOf(-0.5), -1);
    eq('负坐标 -512 → -1', C.chunkIndexOf(-512), -1);
    eq('负坐标 -513 → -2', C.chunkIndexOf(-513), -2);
    eq('chunkKey 用逗号分隔', C.chunkKeyOf(-3, 7), '-3,7');
    same('chunkOfWorld 同时给出两轴（5200,-3100 → 10,-7）', C.chunkOfWorld(5200, -3100), { cx: 10, cy: -7 });

    eq('原点 = band 0', C.bandOf(0, 0), 0);
    eq('距原点 999 = band 0', C.bandOf(999, 0), 0);
    eq('距原点 1000 = band 1', C.bandOf(1000, 0), 1);
    eq('斜向按真实距离算（700,700 → band 0）', C.bandOf(700, 700), 0);
    eq('斜向 1000,1000 → band 1', C.bandOf(1000, 1000), 1);
    eq('负方向同样成立（-1000,0 → band 1）', C.bandOf(-1000, 0), 1);

    eq('distanceSq 是纯乘法（3,4 → 25）', C.distanceSq(0, 0, 3, 4), 25);
    eq('distance 正确开方（3,4 → 5）', C.distance(0, 0, 3, 4), 5);

    eq('矩形覆盖 3×3 个 chunk（无外圈）', C.chunksInRect(-100, -100, 512 + 100, 512 + 100, 0).length, 9);
    eq('加一圈预载后 5×5', C.chunksInRect(0, 0, 512 * 3 - 1, 512 * 3 - 1, 1).length, 25);
    eq('竖屏 2×4 视野加一圈 = 4×6', C.chunksInRect(0, 0, 512 * 2 - 1, 512 * 4 - 1, 1).length, 24);
  }

  /* ---------------------------------------- 3. 地表与装饰 */

  function checkTerrain() {
    section('确定性地表与装饰（04-terrain.js）');
    var seed = BAL.season.worldSeed;
    var decorations = TERRAIN.buildChunkDecor(seed, 3, 3, 0);
    between('装饰数量 8~24', decorations.length, BAL.world.decorPerChunk.min, BAL.world.decorPerChunk.max);
    same('同 chunk 两次装饰一致', TERRAIN.buildChunkDecor(seed, 3, 3, 0), decorations);
    eq(
      '装饰种类合法',
      decorations.every(function (d) { return TERRAIN.DECOR_ORDER.indexOf(d.kind) >= 0; }),
      true
    );
    eq('地表色块网格 8×8', TERRAIN.tileCountPerChunk(), 8);

    eq(
      'band 决定主题：0 草原 / 1 荒漠 / 4 虚境',
      TERRAIN.themeForBand(0).name + ',' + TERRAIN.themeForBand(1).name + ',' + TERRAIN.themeForBand(4).name,
      '草原,荒漠,虚境'
    );
    eq('band 超出主题档位后固定最后一档', TERRAIN.themeForBand(9).id, TERRAIN.themeForBand(4).id);

    var desert = TERRAIN.buildChunkDecor(seed, 3, 3, 1);
    eq(
      '换 band 只改种类权重、不改坐标（"同坐标同内容"的命门）',
      desert.map(function (d) { return d.x.toFixed(3) + ',' + d.y.toFixed(3); }).join(';'),
      decorations.map(function (d) { return d.x.toFixed(3) + ',' + d.y.toFixed(3); }).join(';')
    );

    var variants = {};
    for (var tileX = 0; tileX < 8; tileX += 1) {
      for (var tileY = 0; tileY < 8; tileY += 1) variants[TERRAIN.groundVariant(seed, 0, 0, tileX, tileY)] = true;
    }
    eq('地表色块在 8×8 网格上取到 3 种颜色', Object.keys(variants).length, 3);
  }

  /* ---------------------------------------- 4. 怪与地标的播种 */

  function checkSpawn() {
    section('怪与地标的确定性播种（05-spawn.js）');
    var seed = BAL.season.worldSeed;
    same('同 chunk 两次生成完全一致', SPAWN.buildChunkMonsters(seed, 12, -7), SPAWN.buildChunkMonsters(seed, 12, -7));
    ok(
      '相邻 chunk 内容不同（不是全局一样）',
      JSON.stringify(SPAWN.buildChunkMonsters(seed, 12, -7)) !== JSON.stringify(SPAWN.buildChunkMonsters(seed, 13, -7))
    );

    var chunk = SPAWN.buildChunkMonsters(seed, 0, 0);
    between('原点 chunk 怪数符合密度上限 1~3', chunk.length, 1, 3);
    eq(
      'band 0 的怪等级 1~2（文档写 1–3，实际公式给 1~2 —— 待拍板项）',
      chunk.every(function (m) { return m.level >= 1 && m.level <= 2; }),
      true
    );
    eq('同 chunk 内 ID 唯一', new Set(chunk.map(function (m) { return m.id; })).size, chunk.length);
    eq('精英每 chunk 至多 1 只', chunk.filter(function (m) { return m.elite; }).length <= 1, true);
    eq('等级下限被夹到 1', SPAWN.monsterLevelFor(0, new RNG.Rng(1)), 1);

    var far = SPAWN.buildChunkMonsters(seed, 20, 0);
    eq('远处 chunk 的 band 更高', far.every(function (m) { return m.band >= 9; }), true);
    ok(
      '远处怪等级随之提高',
      far.every(function (m) { return m.level > 3; }),
      far.map(function (m) { return m.level; }).join(',')
    );
    eq(
      '重生时间 15~30 秒（确定性伪随机）',
      chunk.every(function (m) {
        return m.respawnMs >= BAL.world.respawnMs.min && m.respawnMs <= BAL.world.respawnMs.max;
      }),
      true
    );

    var eliteChunks = 0;
    var sampled = 800;
    var i;
    for (i = 0; i < sampled; i += 1) {
      if (SPAWN.buildChunkMonsters(seed, 100 + i, 37).some(function (m) { return m.elite; })) eliteChunks += 1;
    }
    near('精英率 ≈ 8%', eliteChunks / sampled, 0.08, 0.03);

    var eliteSample = null;
    var plainSample = null;
    for (i = 0; i < 400 && !eliteSample; i += 1) {
      var monsters = SPAWN.buildChunkMonsters(seed, 200 + i, 11);
      var elite = null;
      var plain = null;
      var k;
      for (k = 0; k < monsters.length; k += 1) if (monsters[k].elite) elite = monsters[k];
      for (k = 0; k < monsters.length; k += 1) {
        if (!monsters[k].elite && elite && monsters[k].kindId === elite.kindId) plain = monsters[k];
      }
      if (elite && plain) {
        eliteSample = elite;
        plainSample = plain;
      }
    }
    ok('400 个 chunk 内能采到精英样本', eliteSample !== null && plainSample !== null);
    if (eliteSample && plainSample) {
      ok(
        '精英血量远高于同种普通怪（×5 量级）',
        eliteSample.hpMax > plainSample.hpMax * 3,
        eliteSample.hpMax + ' vs ' + plainSample.hpMax
      );
    }

    var landmark = SPAWN.landmarkForChunkGroup(seed, 0, 0);
    same('地标同组两次一致', landmark, SPAWN.landmarkForChunkGroup(seed, 0, 0));
    eq('5×5 chunk 范围内恰好 1 个地标', SPAWN.landmarksInChunkRect(seed, 0, 0, 4, 4).length, 1);
    eq('跨 3 个组（0..12 chunk）返回 9 个地标', SPAWN.landmarksInChunkRect(seed, 0, 0, 12, 12).length, 9);

    var spawnPoint = SPAWN.randomSpawnPoint(seed, 0);
    var radius = Math.sqrt(spawnPoint.x * spawnPoint.x + spawnPoint.y * spawnPoint.y);
    between('首次出生半径 300~800（决策 #5）', radius, 300, 800);
    eq('坏坐标视为不可用（回退随机出生）', SPAWN.isUsableSpawn(0, 0), false);
    eq('好坐标可用', SPAWN.isUsableSpawn(120, -340), true);
  }

  /* ---------------------------------------- 5. 等级 / 经验 / 金币 */

  function checkProgression() {
    section('等级 / 经验 / 金币曲线（06-progression.js）');
    eq('need(1) = 150', PROG.xpToNext(1), 150);
    near('need(4) = 150×4^1.5 = 1200', PROG.xpToNext(4), 1200, 0.001);
    var total = 0;
    for (var level = 1; level < 20; level += 1) total += PROG.xpToNext(level);
    ok('1→20 累计约 10 万（实测 ' + Math.round(total) + '）', total > 90000 && total < 115000, String(Math.round(total)));

    eq('band 0 的 1 级怪经验 180', PROG.monsterXp(1, 0, false), 180);
    eq('band 0 的 3 级怪经验 300', PROG.monsterXp(3, 0, false), 300);
    eq('精英经验 ×5', PROG.monsterXp(1, 0, true), 900);
    eq('band 加成 15%/带（1 带 → 207）', PROG.monsterXp(1, 1, false), 207);
    eq('band 0 的 1 级怪金币 7', PROG.monsterGold(1, 0, false), 7);
    eq('band 0 的 3 级怪金币 13', PROG.monsterGold(3, 0, false), 13);
    eq('精英金币 ×8', PROG.monsterGold(1, 0, true), 56);

    var xpState = { level: 1, exp: 0 };
    eq('刚好够升级就升', PROG.applyXp(xpState, 150), 1);
    eq('升级后等级 2', xpState.level, 2);
    eq('升级后余经验 0', xpState.exp, 0);
    eq(
      '一次给足三级的经验能连升',
      PROG.applyXp({ level: 1, exp: 0 }, 150 + PROG.xpToNext(2) + PROG.xpToNext(3)),
      3
    );
    eq('20 级解锁商城与公会', PROG.shopUnlocked(20) && PROG.guildUnlocked(20), true);
    eq('19 级还没解锁', PROG.shopUnlocked(19) || PROG.guildUnlocked(19), false);
    eq('紧凑数字 1234 → 1.2k', PROG.shortNumber(1234), '1.2k');
  }

  /* ---------------------------------------- 6. 战斗：伤害 / 选目标 / 归属 */

  function checkCombat() {
    section('自动战斗（07-combat.js）');
    var RNG_ = G.RNG;
    var COMBAT_ = G.COMBAT;

    var noCrit = new RNG_.Rng(1);
    var hit = COMBAT_.rollDamage(30, 0, 4, 0, 1.5, noCrit);
    eq('伤害 = max(1, 攻击 − 防御×0.6)（30 − 2.4 → 28）', hit.damage, 28);
    eq('暴击率 0 时不暴击', hit.crit, false);

    var alwaysCrit = new RNG_.Rng(1);
    var critHit = COMBAT_.rollDamage(30, 0, 4, 1, 1.5, alwaysCrit);
    eq('暴击率 1 必暴（27.6 × 1.5 = 41.4 → 41）', critHit.damage, 41);
    eq('暴击标记为真', critHit.crit, true);

    var bonusHit = COMBAT_.rollDamage(30, 0.25, 4, 0, 1.5, new RNG_.Rng(1));
    eq('增伤乘在攻击上（30×1.25 − 2.4 = 35.1 → 35）', bonusHit.damage, 35);

    var minHit = COMBAT_.rollDamage(5, 0, 100, 0, 1.5, new RNG_.Rng(1));
    eq('伤害下限为 1（不会出现 0 或负数）', minHit.damage, 1);

    var monsterHit = COMBAT_.monsterDamage({ attack: 12, elite: false }, { defense: 5, damageReduction: 0 }, new RNG_.Rng(1));
    eq('怪打玩家：12 − 5×0.6 = 9', monsterHit.damage, 9);
    var reduced = COMBAT_.monsterDamage({ attack: 12, elite: false }, { defense: 5, damageReduction: 0.5 }, new RNG_.Rng(1));
    eq('玩家减伤 50% 后 9 → 5', reduced.damage, 5);

    near('出手间隔 = 1000 / 攻速（1.6 → 625ms）', COMBAT_.attackIntervalMs(1.6), 625, 0.001);

    var near1 = { id: 7, x: 100, y: 0, state: 'idle' };
    var near2 = { id: 3, x: 120, y: 0, state: 'idle' };
    var far = { id: 1, x: 900, y: 0, state: 'idle' };
    var dead = { id: 2, x: 90, y: 0, state: 'dead' };
    eq('选目标：视野内最近的活怪', COMBAT_.pickTarget(0, 0, [far, near2, near1, dead], 540).id, 7);
    var tieA = { id: 9, x: 50, y: 0, state: 'idle' };
    var tieB = { id: 4, x: 50, y: 0, state: 'idle' };
    eq('同距取 ID 小的（确定性，帧率变了目标也不跳）', COMBAT_.pickTarget(0, 0, [tieA, tieB], 540).id, 4);
    eq('视野外没有目标', COMBAT_.pickTarget(0, 0, [far], 540), null);

    var monster = { id: 1, hpMax: 100, damageBy: {}, state: 'idle' };
    COMBAT_.creditHit(monster, 1, 30, 0);
    COMBAT_.creditHit(monster, 2, 70, 10);
    eq('奖励归累计伤害最高者（决策 #1）', COMBAT_.rewardWinnerId(monster, 1, 20), 2);
    eq('伤害归属记在怪身上', monster.damageBy[2], 70);
    eq('首击者被记下来（供"首击保护"开关用）', monster.firstHitBy, 1);

    var mine = { id: 1, hpMax: 100, damageBy: { 1: 100 }, state: 'idle' };
    eq('只有自己打时奖励归自己', COMBAT_.rewardWinnerId(mine, 1, 20), 1);
    eq('两个缓解开关默认关闭（首版按决策 #1 实现）', BAL.combat.firstHitProtectionMs === 0 && BAL.combat.damageShareGate === 0, true);
  }

  /* ---------------------------------------- 7. 六阶宝箱与保底 */

  function checkLoot() {
    section('六阶宝箱与保底（08-loot.js）');
    eq('band 0 普通怪掉箱率 8%', LOOT.dropChance(0, false), 0.08);
    eq('精英 25%', LOOT.dropChance(0, true), 0.25);
    near('band 7 → 15%（8% + 7×1%）', LOOT.dropChance(7, false), 0.15, 1e-9);
    eq('掉箱率上限 20%', LOOT.dropChance(50, false), BAL.chests.drop.cap);
    eq('背包上限 200', LOOT.bagCap(), 200);

    var weights = LOOT.tierWeights(0);
    var descending = true;
    for (var i = 1; i < weights.length; i += 1) if (weights[i] >= weights[i - 1]) descending = false;
    ok('六阶权重严格递减（普通箱占绝大多数）', descending, weights.join(','));
    ok('高阶箱随 band 变常见', LOOT.tierWeights(6)[5] > LOOT.tierWeights(0)[5]);

    // 8000 次抽样：普通箱应当占绝对多数，且六阶都能抽到
    var rng = new G.RNG.Rng(20260930);
    var counts = [0, 0, 0, 0, 0, 0, 0];
    var pity = { epic: 0, mythic: 0 };
    var rolls = 8000;
    for (var k = 0; k < rolls; k += 1) counts[LOOT.rollChestTier(0, false, rng, pity)] += 1;
    ok('普通箱(1 阶)占绝大多数', counts[1] / rolls > 0.8, (counts[1] / rolls).toFixed(3));
    ok('六阶箱能抽到（0.2% 量级）', counts[6] > 0, String(counts[6]));
    between('精英箱不低于 2 阶', LOOT.rollChestTier(0, true, rng, { epic: 0, mythic: 0 }), 2, 6);

    var pityEpic = { epic: BAL.chests.pity.epic, mythic: 0 };
    var forcedEpic = LOOT.rollChestTier(0, false, new G.RNG.Rng(7), pityEpic);
    ok('连续 50 箱未出史诗 → 强制 ≥ 史诗', forcedEpic >= 3, String(forcedEpic));
    eq('史诗保底兑现后计数清零', pityEpic.epic, 0);

    var pityMythic = { epic: 0, mythic: BAL.chests.pity.mythic };
    var forcedMythic = LOOT.rollChestTier(0, false, new G.RNG.Rng(9), pityMythic);
    ok('连续 500 箱未出神话 → 强制 ≥ 神话', forcedMythic >= 5, String(forcedMythic));

    var small = { epic: 0, mythic: 0 };
    LOOT.rollChestTier(0, false, new G.RNG.Rng(11), small);
    eq('抽过一箱保底计数就 +1', small.epic, 1);
    eq('箱子名带阶名', LOOT.tierName(4), '传说宝箱');
    eq('分解价值按阶给（4 阶 900 金币）', LOOT.salvageGold(4), 900);
  }

  /* ---------------------------------------- 8. 装备生成 / 词条 / 战力 */

  function checkEquipment() {
    section('装备生成 / 词条 / 战力（09-equipment.js）');
    var EQUIP_ = G.EQUIP;
    var rng = new G.RNG.Rng(1234);

    var t1 = EQUIP_.generate(1, 1, rng, 1);
    eq('1 阶 1 条词条', t1.affixes.length, 1);
    eq('1 阶等级门槛 1', t1.reqLevel, 1);
    ok('主属性数值 > 0', t1.main.value > 0, t1.main.stat + ' ' + t1.main.value);
    ok('战力 > 0', t1.power > 0, String(t1.power));

    var t3 = EQUIP_.generate(3, 8, new G.RNG.Rng(7), 2);
    eq('3 阶 3 条词条', t3.affixes.length, 3);
    eq('3 阶等级门槛 7', t3.reqLevel, 7);
    eq('词条不重复', new Set(t3.affixes.map(function (a) { return a.name; })).size, t3.affixes.length);

    var t6 = EQUIP_.generate(6, 20, new G.RNG.Rng(9), 3);
    eq('6 阶 = 5 条词条 + 1 条天赐专属', t6.affixes.length, 6);
    ok('第 6 条带"天赐"前缀', t6.affixes[5].name.indexOf('天赐') === 0, t6.affixes[5].name);
    eq('6 阶等级门槛 16', t6.reqLevel, 16);

    var again = EQUIP_.generate(3, 8, new G.RNG.Rng(7), 2);
    same('同种子同参数 → 同一件装备（可复现）', again, t3);

    var powerSum1 = 0;
    var powerSum6 = 0;
    var sample = new G.RNG.Rng(5150);
    for (var i = 0; i < 50; i += 1) {
      powerSum1 += EQUIP_.generate(1, 10, sample, 0).power;
      powerSum6 += EQUIP_.generate(6, 10, sample, 0).power;
    }
    ok('6 阶战力远超 1 阶（同等级同平均）', powerSum6 > powerSum1 * 3, powerSum6 / 50 + ' vs ' + powerSum1 / 50);

    var loadout = EQUIP_.emptyLoadout();
    eq('空装备栏战力 0', EQUIP_.armoryPower(loadout), 0);
    loadout[t1.slotId] = t1;
    eq('穿上后战力 = 该件战力', EQUIP_.armoryPower(loadout), t1.power);
    var totals = EQUIP_.totalsOf(loadout);
    ok('属性汇总里有主属性', totals[t1.main.stat] >= t1.main.value, String(totals[t1.main.stat]));
    eq('格式化百分比词条', EQUIP_.formatValue('critChance', 0.043), '+4.3% 暴击率');
  }

  /* ---------------------------------------- 9. 玩家属性 / 移动 / 死亡 */

  function checkPlayer() {
    section('玩家属性汇总与移动（10-player.js）');
    var PLAYER_ = G.PLAYER;
    var EQUIP_ = G.EQUIP;

    var naked1 = PLAYER_.statsOf(1, null);
    eq('1 级裸装攻击 30', naked1.attack, 30);
    eq('1 级裸装生命 600', naked1.hpMax, 600);
    eq('1 级裸装防御 5', naked1.defense, 5);
    near('基础攻速 1.6', naked1.attackSpeed, 1.6, 1e-9);
    near('基础暴击率 5%', naked1.critChance, 0.05, 1e-9);
    eq('基础战力 0（没装备）', naked1.power, 0);
    eq('移动速度 210', naked1.moveSpeed, 210);

    var naked20 = PLAYER_.statsOf(20, null);
    eq('20 级攻击 = 30 + 2×19 = 68', naked20.attack, 68);
    eq('20 级生命 = 600 × 1.19 = 714', naked20.hpMax, 714);

    var loadout = EQUIP_.emptyLoadout();
    var weapon = EQUIP_.generate(1, 1, new G.RNG.Rng(3), 1);
    loadout[weapon.slotId] = weapon;
    if (weapon.slotId === 'weapon') {
      eq('装备攻击是加算（68 + 装备攻击）', PLAYER_.statsOf(20, loadout).attack, 68 + weapon.main.value);
    } else {
      ok('装备主属性已计入', PLAYER_.statsOf(20, loadout)[weapon.main.stat] !== undefined);
    }

    var player = PLAYER_.create({ level: 1, exp: 0, x: 0, y: 0, loadout: loadout });
    PLAYER_.move(player, 1, 0, 1, naked1);
    near('1 秒朝右走 = 移动速度（210）', player.x, 210, 0.0001);
    PLAYER_.move(player, 3, 4, 0.5, naked1);
    near('斜向输入被归一化（3,4 → 0.6/0.8，0.5 秒走 84）', player.y, 84, 0.0001);

    PLAYER_.hurt(player, 100, player.x - 10, player.y, 0);
    eq('受击扣血', player.hp, 600 - 100);
    eq('受击进入"战斗中"（hurtMs=320：100ms 仍在战、500ms 已脱战）', PLAYER_.inCombat(player, 100) && !PLAYER_.inCombat(player, 500), true);

    PLAYER_.hurt(player, 99999, player.x - 10, player.y, 5000);
    eq('血量归零即倒地', player.dead, true);
    eq('倒地后 3 秒复活', player.respawnAt, 5000 + BAL.player.respawnDelayMs);
    PLAYER_.respawn(player, naked1);
    eq('复活半血（600 × 0.5）', player.hp, 300);
    eq('复活后不再处于倒地状态', player.dead, false);
  }

  /* ---------------------------------------- 10. 本地存档 */

  function checkSave() {
    section('本地存档（11-save.js + 12-platform 的内存存档桩）');
    var SAVE_ = G.SAVE;
    var seed = BAL.season.worldSeed;

    var fresh = SAVE_.create(seed, 1);
    eq('新号 1 级', fresh.level, 1);
    eq('新号无宝箱', fresh.chests.length, 0);
    eq('新号保底计数为 0', fresh.pity.epic + fresh.pity.mythic, 0);
    eq('新号有 6 个装备栏', Object.keys(fresh.loadout).length, 6);
    ok('出生点可用（决策 #5：首次随机出生）', G.SPAWN.isUsableSpawn(fresh.x, fresh.y), fresh.x + ',' + fresh.y);

    var broken = SAVE_.normalize({ v: 1, level: 99, x: NaN, y: 0, chests: [{ tier: 9 }, { tier: 3, level: 8 }] }, seed, 1);
    eq('存档修复：非法箱阶被丢掉', broken.chests.length, 1);
    eq('存档修复：保留合法箱子', broken.chests[0].tier, 3);
    eq('存档修复：坏坐标回退到随机出生点', G.SPAWN.isUsableSpawn(broken.x, broken.y), true);
    eq('存档版本不符 → 当新号处理', SAVE_.normalize({ v: 0, level: 50 }, seed, 1).level, 1);
    eq('null 存档 → 当新号处理', SAVE_.normalize(null, seed, 1).level, 1);

    var save = SAVE_.create(seed, 2);
    save.level = 7;
    save.gold = 1234;
    SAVE_.pushChest(save, 3, 9);
    eq('宝箱入包', save.chests.length, 1);
    eq('宝箱记下掉落等级（决定装备强度）', save.chests[0].level, 9);

    var item = G.EQUIP.generate(2, 9, new G.RNG.Rng(4), 0);
    var assignedId = SAVE_.pushItem(save, item);
    eq('装备入包并分配 id', item.id, assignedId);
    eq('自增号已推进', save.nextItemId, assignedId + 1);

    SAVE_.write(save);
    var reloaded = SAVE_.load(seed, 2);
    eq('存档写入后能读回（等级）', reloaded.level, 7);
    eq('存档写入后能读回（金币）', reloaded.gold, 1234);
    eq('存档写入后能读回（宝箱）', reloaded.chests.length, 1);
    eq('背包里的装备也存下来了', reloaded.items.length, save.items.length);
    SAVE_.clear();
    eq('清档后回到 1 级新号', SAVE_.load(seed, 2).level, 1);
  }

  /* ---------------------------------------- 11. 地图设计：营地与小径路网 */

  function checkMap() {
    section('地图设计：营地与小径路网（04-terrain.js）');
    var seed = BAL.season.worldSeed;
    var T = G.TERRAIN;

    var camp = T.campCenter();
    eq('营地中心在原点', camp.x + ',' + camp.y, '0,0');
    eq('营地半径来自 balance', camp.radius, BAL.world.camp.radius);
    eq('原点在营地内', T.isInCamp(0, 0), true);
    eq('砖地边界内一点仍在营地内', T.isInCamp(camp.radius - 1, 0), true);
    eq('砖地外一点不在营地内', T.isInCamp(camp.radius + 1, 0), false);
    eq('负方向同样成立', T.isInCamp(-(camp.radius - 1), 0), true);
    ok('围栏半径 < 砖地半径（围栏立在砖地上）', BAL.world.camp.fenceRadius < camp.radius, BAL.world.camp.fenceRadius + ' / ' + camp.radius);

    var propsA = T.campProps();
    var propsB = T.campProps();
    ok('营地道具每次完全一致（手工摆位，无随机）', JSON.stringify(propsA) === JSON.stringify(propsB));
    ok(
      '营地道具都在砖地内、且比例合法',
      propsA.every(function (p) {
        return isFinite(p.x) && isFinite(p.y) && p.scale > 0 && T.isInCamp(p.x, p.y);
      }),
      propsA.length + ' 件'
    );
    ok(
      '营地道具含篝火与帐篷（一眼认得出这是营地）',
      propsA.some(function (p) { return p.kind === 'fire'; }) && propsA.some(function (p) { return p.kind === 'tent'; })
    );
    propsB.push({ kind: 'hacked' });
    eq('campProps 返回的是副本（改它不会污染地图形状）', T.campProps().length, propsA.length);

    eq('路网节点间距 = balance', T.roadSpanChunks(), BAL.world.road.spanChunks);

    var node = T.roadNodeFor(seed, 2, -3);
    same('同一个路网节点永远算在同一个位置', T.roadNodeFor(seed, 2, -3), node);
    var nodeSpan = T.roadSpanChunks() * G.CHUNK.CHUNK_SIZE;
    var jitter = BAL.world.road.jitterChunks * G.CHUNK.CHUNK_SIZE;
    ok(
      '节点落在网格交叉点 ± 抖动（所以原点附近就有路）',
      Math.abs(node.x - 2 * nodeSpan) <= jitter + 1e-6 && Math.abs(node.y + 3 * nodeSpan) <= jitter + 1e-6,
      node.x.toFixed(1) + ',' + node.y.toFixed(1)
    );
    ok('相邻两组的节点不重合', T.roadNodeFor(seed, 2, -3).x !== T.roadNodeFor(seed, 3, -3).x);

    var roads = T.roadsInRect(seed, -1000, -1000, 1000, 1000);
    ok('出生点附近确实有路（地图不是空的）', roads.length > 0, 'segments=' + roads.length);
    same('同一个矩形两次取路完全一致（确定性）', T.roadsInRect(seed, -1000, -1000, 1000, 1000), roads);
    ok(
      '每段都是有限的横/竖直线段（无 NaN、无零长）',
      roads.every(function (s) {
        return (
          isFinite(s.x1) && isFinite(s.y1) && isFinite(s.x2) && isFinite(s.y2) && (s.y1 === s.y2) !== (s.x1 === s.x2)
        );
      })
    );
    ok('每段宽度 = balance.world.road.width', roads.every(function (s) { return s.width === BAL.world.road.width; }));
    ok(
      '粗筛生效：远处的路不会被带回来',
      T.roadsInRect(seed, 100000, 100000, 101000, 101000).every(function (s) {
        return Math.min(s.x1, s.x2) <= 101000 + BAL.world.road.width * 4;
      })
    );
    ok('退化矩形不抛异常（返回数组即可）', Array.isArray(T.roadsInRect(seed, 0, 0, 0, 0)));
  }

  /* ---------------------------------------- 12. 角色外观与地图绘制 */

  function checkLook() {
    section('角色外观与地图绘制（16-render.js / 17-hud.js）');
    var R = G.RENDER;

    // 朝向：0=下 1=左下 2=左 3=左上 4=上 5=右上 6=右 7=右下
    eq('朝下 → 0', R.facingIndex({ x: 0, y: 1 }), 0);
    eq('朝左下 → 1', R.facingIndex({ x: -1, y: 1 }), 1);
    eq('朝左 → 2', R.facingIndex({ x: -1, y: 0 }), 2);
    eq('朝左上 → 3', R.facingIndex({ x: -1, y: -1 }), 3);
    eq('朝上 → 4', R.facingIndex({ x: 0, y: -1 }), 4);
    eq('朝右上 → 5', R.facingIndex({ x: 1, y: -1 }), 5);
    eq('朝右 → 6', R.facingIndex({ x: 1, y: 0 }), 6);
    eq('朝右下 → 7', R.facingIndex({ x: 1, y: 1 }), 7);
    eq('零向量退回朝下（不产生 NaN）', R.facingIndex({ x: 0, y: 0 }), 0);
    eq('坏输入也退回朝下', R.facingIndex(null), 0);
    ok('朝左三向要镜像画', R.facesLeft(1) && R.facesLeft(2) && R.facesLeft(3) && !R.facesLeft(6));
    ok('朝上三向不画脸（背对镜头）', R.facesAway(3) && R.facesAway(4) && R.facesAway(5) && !R.facesAway(0));

    // 走路 / 挥砍相位只由逻辑时间推出来（不用 Date.now，逻辑可重放）
    eq('站着不动时走路相位为 0', R.walkPhase(1234, false), 0);
    between('走路相位落在 [0,1)', R.walkPhase(777, true), 0, 0.999999);
    ok('相位随时间推进', R.walkPhase(500, true, 260) !== R.walkPhase(800, true, 260));
    eq('出手那一刻 = 相位 0（正在劈）', R.swingPhase(1000, 1000, 600), 0);
    eq('出手间隔走完 = 相位 1（收招）', R.swingPhase(1600, 1000, 600), 1);
    eq('很久没出手 = 相位 1（静止姿势）', R.swingPhase(9999, 1000, 600), 1);
    eq('从没出手过 = 相位 1', R.swingPhase(1000, 0, 600), 1);

    // 真画一遍新加的东西：营地 / 路网 / 小地图都必须在假 canvas 上画得出来
    var ctx = fakeContext();
    R.drawRoads(ctx, { x: 0, y: 0 });
    R.drawCamp(ctx, { x: 0, y: 0 });
    ok('营地 + 路网能画出来（不是空转）', ctx.calls.count > 0, 'calls=' + ctx.calls.count);

    // 走到很远的地方：营地不该再画任何东西（视野粗判必须生效，否则每帧白画十几个图元）
    var far = fakeContext();
    R.drawCamp(far, { x: 200000, y: 200000 });
    eq('离营地很远时营地的绘制调用为 0', far.calls.count, 0);

    var hud = fakeContext();
    G.HUD.drawMinimap(hud, { player: { x: 0, y: 0, facing: { x: 1, y: 0 } }, save: { guild: null } });
    ok('小地图能画出来', hud.calls.count > 0, 'calls=' + hud.calls.count);
  }

  /* ---------------------------------------- 13. 账号 / 昵称 / 界面 / 自动战斗（A4） */

  /**
   * 账号与昵称（用户要求"增加注册、登录、创建角色、输入昵称，昵称不能重复"）。
   * 这里只测**本机能验证的部分**：清洗规则、校验原因、本机注册表去重、账号落盘、v1→v2 迁移。
   * "跨设备唯一"要服务端（svr 的 /api/name），由 douyin-cloud\svr\smoke.mjs 负责。
   */
  function checkAccount() {
    section('账号与昵称（11-save.js 的 G.ACCOUNT）');
    var ACCOUNT = G.ACCOUNT;
    var CONFIG = G.CONFIG;
    eq('昵称最短 2 个字符', BAL.account.nameMin, 2);
    eq('昵称最长 12 个字符', BAL.account.nameMax, 12);

    // 清洗：空白与非法字符去掉，按**字符数**截断（中文算 1 个字符，不是 3 个字节）
    eq('清洗：去掉空格', ACCOUNT.sanitizeName(' 孤 影 '), '孤影');
    eq('清洗：去掉符号', ACCOUNT.sanitizeName('孤影!!!'), '孤影');
    eq('清洗：超长按字符截断', ACCOUNT.sanitizeName('一二三四五六七八九十十一十二十三').length, 12);
    eq('中文按字符数算', ACCOUNT.sanitizeName('孤影').length, 2);
    ok('大小写与空白不影响唯一性', ACCOUNT.nameKey('Alice') === ACCOUNT.nameKey(' alice '));

    // 校验：不同原因要分得清（界面据此给不同提示）
    eq('空昵称被拒', ACCOUNT.validate('').reason, 'empty');
    eq('一个字符被拒', ACCOUNT.validate('孤').reason, 'tooShort');
    eq('十三个字符被拒', ACCOUNT.validate('一二三四五六七八九十十一十二十三').reason, 'tooLong');
    eq('带符号被拒', ACCOUNT.validate('孤影!').reason, 'illegal');
    eq('保留名被拒', ACCOUNT.validate('管理员').reason, 'reserved');
    ok('正常昵称通过', ACCOUNT.validate('孤影99').ok === true);
    ok('原因都有中文说明', ACCOUNT.reasonText('taken').indexOf('占用') >= 0);

    // 本机注册表：占用过就拒绝第二次 —— 这是"昵称不能重复"的离线那一半
    G.PLAT.storageRemove(CONFIG.namesKey);
    ok('没注册过就能用', ACCOUNT.validate('猎手01').ok === true);
    ACCOUNT.remember('猎手01');
    eq('注册过就被拒', ACCOUNT.validate('猎手01').reason, 'taken');
    eq('注册表里有 1 个名字', ACCOUNT.localNameCount(), 1);
    ACCOUNT.remember('猎手01');
    eq('重复 remember 幂等', ACCOUNT.localNameCount(), 1);
    ACCOUNT.remember('Alice');
    eq('大小写不同也是同一个名字', ACCOUNT.validate('alice').reason, 'taken');
    ok('随机昵称一定能生成且可用', ACCOUNT.validate(ACCOUNT.suggest(20260930)).ok === true);
    ok('同一个时刻的随机昵称相同（可复现）', ACCOUNT.suggest(7) === ACCOUNT.suggest(7));

    // 账号记录：没起名 = 还没注册完（load 返回 null），起名后才算数
    ACCOUNT.forget();
    ok('清掉账号后读不到', ACCOUNT.load() === null);
    var account = ACCOUNT.create({ name: '孤影99', mode: 'local', at: 1234 });
    ok('persist 落盘成功', ACCOUNT.persist(account) === true);
    var reloaded = ACCOUNT.load();
    ok('账号能读回', !!reloaded && reloaded.name === '孤影99', reloaded ? reloaded.name : 'null');
    eq('账号 id 有兜底值', reloaded.id.indexOf('local-'), 0);
    ok('persist 顺手登记昵称', ACCOUNT.takenLocally('孤影99'));
    var upgraded = ACCOUNT.update(reloaded, { mode: 'douyin', openid: 'o-1', token: 't-1', at: 2000 });
    ok('update 能补上 openid/token', ACCOUNT.load().openid === 'o-1' && upgraded.token === 't-1');
    eq('update 不覆盖创建时间', ACCOUNT.load().createdAt, 1234);

    // 存档 v1 → v2 迁移：只补 name / settings，等级金币宝箱一件不丢
    var v1 = {
      v: 1,
      level: 9,
      exp: 123,
      gold: 456,
      chests: [{ tier: 3, level: 5 }],
      pity: { epic: 4, mythic: 5 },
      horns: 2,
      stats: { kills: 7 }
    };
    var migrated = G.SAVE.normalize(v1, BAL.season.worldSeed, 1);
    eq('v1 存档迁移后版本 = 2', migrated.v, 2);
    eq('迁移不丢等级', migrated.level, 9);
    eq('迁移不丢金币', migrated.gold, 456);
    eq('迁移不丢宝箱', migrated.chests.length, 1);
    eq('迁移不丢号角', migrated.horns, 2);
    eq('迁移补上角色名（空 = 还没建角色）', migrated.name, '');
    eq('迁移补上设置项（自动战斗默认关）', migrated.settings.autoBattle, false);
    eq('认不出的版本照样开新号（不白屏）', G.SAVE.normalize({ v: 99, level: 5 }, BAL.season.worldSeed, 1).level, 1);
    eq('音效默认开', G.SAVE.normalize({ v: 2, settings: {} }, BAL.season.worldSeed, 1).settings.sfx, true);
    eq('写了 false 才关', G.SAVE.normalize({ v: 2, settings: { sfx: false } }, BAL.season.worldSeed, 1).settings.sfx, false);
    eq('坏设置不炸（回默认值）', G.SAVE.normalize({ v: 2, settings: 'nope' }, BAL.season.worldSeed, 1).settings.vibrate, true);
  }

  /**
   * 界面（用户要求三条）：面板只占 1/3 屏、有关闭按钮、打开时游戏不停止；
   * 另外验证登录 / 创建角色界面的按钮能产生正确的 action（界面逻辑不能只靠肉眼）。
   */
  function checkUi() {
    section('界面：卡片大小 / 关闭键 / 滚动 / 登录界面（A4）');
    var card = G.PANELS.rect();
    var ratio = (card.w * card.h) / (G.SCREEN.width() * G.SCREEN.height());
    between('面板卡片面积约为 1/3 屏', ratio, 0.28, 0.38);
    ok(
      '卡片完整落在屏幕内',
      card.x >= 0 && card.y >= 0 && card.x + card.w <= G.SCREEN.width() && card.y + card.h <= G.SCREEN.height(),
      JSON.stringify(card)
    );
    ok('卡片没有铺满屏幕', card.w < G.SCREEN.width() * 0.9 && card.h < G.SCREEN.height() * 0.6);

    var hudButtons = G.HUD.buttons({ save: { chests: [], items: [], guild: null, settings: { autoBattle: false } } });
    eq('右下功能键 5 个（多了「自动」）', hudButtons.length, 5);
    eq('「自动」按钮在最下（拇指位）', hudButtons[4].id, 'auto');
    var leftmost = hudButtons[0].x - hudButtons[0].r;
    ok('卡片与功能键不重叠', card.x + card.w <= leftmost + 1, Math.round(card.x + card.w) + ' vs ' + Math.round(leftmost));
    var expTop = G.SCREEN.height() - G.SCREEN.safeBottom() - BAL.view.hud.expBarHeight;
    ok(
      '经验条在最下方（在功能键下面）',
      expTop >= hudButtons[0].y + hudButtons[0].r,
      expTop + ' vs ' + Math.round(hudButtons[0].y + hudButtons[0].r)
    );
    ok('自动按钮带状态（开着会点亮）', hudButtons[4].state === 'off' && hudButtons[4].label.length > 0, hudButtons[4].label);

    // 假存档（12 件装备 → 背包内容一定比卡片长，才测得出滚动）
    var items = [];
    for (var k = 0; k < 12; k += 1) {
      items.push({ id: k + 1, tier: (k % 6) + 1, slotId: 'weapon', slotName: '武器', power: 10 + k, reqLevel: 1 });
    }
    var save = {
      level: 3,
      gold: 0,
      exp: 0,
      chests: [],
      items: items,
      loadout: {},
      pity: { epic: 0, mythic: 0 },
      guild: null,
      name: '自检者',
      settings: { autoBattle: false },
      stats: { kills: 0, eliteKills: 0, opened: 0 }
    };
    var view = {
      save: save,
      player: { x: 0, y: 0, hp: 100, dead: false },
      stats: { power: 0, hpMax: 100 },
      now: 0,
      buttons: hudButtons
    };

    // 命中范围：卡片内归面板，卡片外留给摇杆（这是"打开面板还能走位"的前提）
    G.PANELS.open('bag');
    var inside = { x: card.x + card.w / 2, y: card.y + card.h / 2 };
    var outside = { x: card.x + card.w / 2, y: card.y + card.h + 60 };
    ok('卡片中心属于面板', G.PANELS.contains(inside));
    ok('卡片下方的触摸不属于面板（留给摇杆）', !G.PANELS.contains(outside), JSON.stringify(outside));
    G.PANELS.close();
    ok('没开面板时不属于面板', !G.PANELS.contains(inside));

    // 关闭键：在卡片里，点击要能产生 close
    G.PANELS.open('bag');
    var close = G.PANELS.buttons()[0];
    ok('关闭键存在且在卡片内', close.id === 'panel:close' && G.PANELS.contains({ x: close.x, y: close.y }), close.label);
    G.PANELS.press({ x: close.x, y: close.y }, view);
    var closeAction = G.PANELS.release({ x: close.x, y: close.y }, view);
    ok('点关闭键 → { type: close }', !!closeAction && closeAction.type === 'close');

    // 滚动：内容超过视口才能滚，且夹在 [0, maxScroll]
    G.PANELS.open('bag');
    var limit = G.PANELS.maxScroll(view);
    ok('背包内容比卡片长（能滚）', limit > 0, String(limit));
    eq('滚动从 0 开始', G.PANELS.scrollOffset(), 0);
    eq('向上超界夹到 0', G.PANELS.setScroll(-500, view), 0);
    eq('向下超界夹到上限', G.PANELS.setScroll(limit + 500, view), limit);
    G.PANELS.setScroll(limit / 2, view);
    ok(
      '滚动后行坐标跟着变（画与点同一份坐标）',
      Math.round(G.PANELS.rows(view)[0].y) === Math.round(G.PANELS.buildRows(view)[0].y - limit / 2)
    );
    var firstRow = G.PANELS.rows(view)[0];
    G.PANELS.press({ x: card.x + card.w / 2, y: firstRow.y + 20 }, view);
    G.PANELS.move({ x: card.x + card.w / 2, y: firstRow.y - 20 }, view);
    ok('拖动算滚动，松手不触发任何 action', G.PANELS.release({ x: card.x + card.w / 2, y: firstRow.y - 20 }, view) === null);

    // 卡片能真的画出来（含 clip 路径 —— 老画法是全屏覆盖，不需要裁剪）
    var panelCtx = fakeContext();
    G.PANELS.draw(panelCtx, view);
    ok('面板卡片能画出来', panelCtx.calls.count > 20, 'calls=' + panelCtx.calls.count);
    G.PANELS.close();
    // 登录 / 创建角色界面
    var login = G.LOGIN;
    login.open('welcome');
    eq('欢迎界面有 2 个按钮', login.buttons().length, 2);
    eq('欢迎界面第一个是登录', login.buttons()[0].id, 'login');
    login.press({ x: login.buttons()[0].x + 5, y: login.buttons()[0].y + 5 });
    var loginAction = login.release({ x: login.buttons()[0].x + 5, y: login.buttons()[0].y + 5 });
    ok('点登录 → { type: login }', !!loginAction && loginAction.type === 'login');

    // 清账号要两次点击（第一步只是"上膛"）
    login.open('welcome');
    var clearButton = login.buttons()[1];
    login.press({ x: clearButton.x + 5, y: clearButton.y + 5 });
    eq('第一次点清账号不产生 action', login.release({ x: clearButton.x + 5, y: clearButton.y + 5 }), null);
    ok('第二次进入上膛态', login.isArmed());
    login.press({ x: clearButton.x + 5, y: clearButton.y + 5 });
    var clearAction = login.release({ x: clearButton.x + 5, y: clearButton.y + 5 });
    ok('再点一次才返回 newAccount', !!clearAction && clearAction.type === 'newAccount');

    // 创建角色界面：输入昵称 / 换一个 / 创建角色
    login.open('createRole');
    eq('创建角色界面有 3 个按钮', login.buttons().length, 3);
    eq(
      '按钮依次是 输入昵称 / 换一个 / 创建角色',
      login.buttons().map(function (button) { return button.id; }).join(','),
      'typeName,randomName,createRole'
    );
    ok('一进来就有一个随机昵称', login.draftName().length >= BAL.account.nameMin, login.draftName());
    var before = login.draftName();
    login.randomName(12345);
    ok('「换一个」能换出另一个昵称', login.draftName() !== before, before + ' -> ' + login.draftName());
    login.setDraftName(' 非法!名字 ');
    eq('输入框里的非法字符会被清掉', login.draftName(), '非法名字');
    var createButton = login.buttons()[2];
    login.press({ x: createButton.x + 5, y: createButton.y + 5 });
    var createAction = login.release({ x: createButton.x + 5, y: createButton.y + 5 });
    ok('点「创建角色」→ { type: createRole }', !!createAction && createAction.type === 'createRole');

    var loginCtx = fakeContext();
    login.draw(loginCtx, { save: save, account: null, stats: view.stats });
    ok('创建角色界面能画出来（防白屏）', loginCtx.calls.count > 20, 'calls=' + loginCtx.calls.count);
    login.open('welcome');
    var welcomeCtx = fakeContext();
    login.draw(welcomeCtx, { save: save, account: { name: '自检者', mode: 'local' }, stats: view.stats });
    ok('欢迎界面能画出来（防白屏）', welcomeCtx.calls.count > 20, 'calls=' + welcomeCtx.calls.count);
  }

  /**
   * 自动战斗按钮（用户要求："设置为按钮，点击开启；自动战斗时不仅会自动释放技能，
   * 还会自动走向最近的怪物"）。出手本来就是自动的（14-world.playerAttack），
   * 这里验的是**走位**那一半：目标选择、站住的时机、手动优先、开关写进存档。
   */
  function checkAuto() {
    section('自动战斗按钮（走位 / 手动优先 / 开关持久化）');
    var GAME = G.GAME;
    if (!GAME || typeof GAME.autoStep !== 'function') {
      ok('G.GAME 可用（20-main.js 已拼入）', false, '拿不到 GAME');
      return;
    }
    G.SAVE.clear();
    GAME.boot();
    GAME.beginPlaying('自检者');
    eq('创建角色后进入游戏界面', GAME.state.screen, 'playing');
    eq('存档里记下了角色名', GAME.state.save.name, '自检者');
    ok('昵称已登记进本机注册表', G.ACCOUNT.takenLocally('自检者'));

    // 开关默认关（"点击开启"），点一下开、再点一下关，并且写进存档（重开游戏还记得）
    eq('自动战斗默认关', GAME.state.save.settings.autoBattle, false);
    eq('点一次开启', GAME.toggleAutoBattle(), true);
    ok('开关写进了存档', G.SAVE.load(BAL.season.worldSeed, 1).settings.autoBattle === true);
    eq('再点一次关闭', GAME.toggleAutoBattle(), false);

    // 走位：把周边 chunk 装出来，然后只跑 autoStep（怪不跑 AI，落点才可断言）
    var player = GAME.state.player;
    var stats = GAME.state.stats;
    G.WORLD.ensureChunks(player.x, player.y, 2);
    var target = G.WORLD.pickTarget(player);
    ok('视野内选到了最近的怪', !!target);
    if (target) {
      var dxBefore = target.x - player.x;
      var dyBefore = target.y - player.y;
      var before = Math.sqrt(dxBefore * dxBefore + dyBefore * dyBefore);
      for (var i = 0; i < 240; i += 1) GAME.autoStep(player, stats, 1000 / 60);
      var dxAfter = target.x - player.x;
      var dyAfter = target.y - player.y;
      var after = Math.sqrt(dxAfter * dxAfter + dyAfter * dyAfter);
      var reach = target.radius + BAL.player.attackRange * BAL.auto.moveStopRatio;
      ok('自动走向最近的怪（距离变小）', after < before, Math.round(before) + ' -> ' + Math.round(after));
      ok('停在攻击距离上（不会叠进怪里）', after <= reach + 1, Math.round(after) + ' <= ' + Math.round(reach) + '+1');
      ok('停住时仍面向目标', player.facing.x * dxAfter + player.facing.y * dyAfter > 0);
      eq('目标记在 player.targetId 上（与出手共用同一只怪）', player.targetId, target.id);
    }
    ok('坐标没有 NaN / Infinity', isFinite(player.x) && isFinite(player.y));

    // 手动优先：摇杆推着的时候，step() 不该走"自动走位"那条分支
    GAME.state.save.settings.autoBattle = true;
    var stick = G.INPUT.state.stick;
    var x0 = player.x;
    stick.active = true;
    stick.dx = -1;
    stick.dy = 0;
    stick.magnitude = 1;
    GAME.step(1000 / 60);
    ok('手动摇杆优先于自动走位', player.x < x0, Math.round(x0) + ' -> ' + Math.round(player.x));
    stick.active = false;
    stick.dx = 0;
    stick.dy = 0;
    stick.magnitude = 0;
    GAME.state.save.settings.autoBattle = false;
  }

  /**
   * 打击感（用户要求"斩击特效 / 受击顿帧 / 暴击震屏"）。
   * 三件事都能在 node 里断言：特效到期会消失、顿帧按时长分档、震屏是纯函数；
   * 顿帧是否真的"冻住世界"也可以直接跑两步看世界时间。
   */
  function checkFeel() {
    section('打击感：斩击特效 / 受击顿帧 / 暴击震屏（A4）');
    var GAME = G.GAME;
    var WORLD = G.WORLD;
    between('斩击特效时长在 0.1~0.5 秒', BAL.view.slashMs, 100, 500);
    between('特效数量有上限（挂机不会堆爆）', BAL.view.slashCap, 4, 64);
    ok(
      '顿帧分档：普通 < 暴击，且都在 20~150ms',
      BAL.view.hitStopMs.normal < BAL.view.hitStopMs.crit && BAL.view.hitStopMs.normal >= 20 && BAL.view.hitStopMs.crit <= 150,
      BAL.view.hitStopMs.normal + ' / ' + BAL.view.hitStopMs.crit
    );
    ok('暴击震屏幅度 > 挨打震屏幅度', BAL.view.shake.critPower > BAL.view.shake.hurtPower);
    ok('挨打顿帧不长于普通命中（挨打只要一顿，不要卡）', BAL.view.hitStopMs.hurt <= BAL.view.hitStopMs.normal);

    if (!GAME || typeof GAME.applyHitFeedback !== 'function') {
      ok('G.GAME 可用（20-main.js 已拼入）', false, '拿不到 GAME');
      return;
    }
    G.SAVE.clear();
    GAME.boot();
    GAME.beginPlaying('打击感测试者');
    GAME.state.hitStopMs = 0;
    GAME.state.shake.power = 0;

    // 顿帧 + 震屏：直接喂 events，不用真去打一只怪（这就是把反馈做成函数的原因）
    var plain = GAME.applyHitFeedback({ hits: [{ damage: 10, crit: false }], playerHits: [] });
    eq('普通命中顿帧 = balance 值', plain.stop, BAL.view.hitStopMs.normal);
    eq('普通命中不震屏', GAME.state.shake.power, 0);

    GAME.state.hitStopMs = 0;
    var crit = GAME.applyHitFeedback({ hits: [{ damage: 99, crit: true }], playerHits: [] });
    eq('暴击顿帧 = balance 值且更长', crit.stop, BAL.view.hitStopMs.crit);
    ok('暴击比普通更"咬手"', crit.stop > plain.stop, crit.stop + ' > ' + plain.stop);
    eq('暴击开启震屏（幅度取 balance）', GAME.state.shake.power, BAL.view.shake.critPower);
    var mid = GAME.state.shake.until - GAME.state.shake.ms / 2;
    var offset = GAME.shakeOffset(mid);
    ok('震屏期间有位移', Math.abs(offset.x) + Math.abs(offset.y) > 0, JSON.stringify(offset));
    ok('震屏幅度不超过设定值', Math.abs(offset.x) <= BAL.view.shake.critPower + 0.001);
    var gone = GAME.shakeOffset(GAME.state.shake.until + 1);
    eq('震屏到点归零（x）', gone.x, 0);
    eq('震屏到点归零（y）', gone.y, 0);

    GAME.state.hitStopMs = 0;
    var hurt = GAME.applyHitFeedback({ hits: [], playerHits: [{ damage: 5 }] });
    eq('挨打也有顿帧', hurt.stop, BAL.view.hitStopMs.hurt);
    eq('挨打震一下（幅度更小）', GAME.state.shake.power, BAL.view.shake.hurtPower);

    // 顿帧真的会冻住世界
    GAME.state.hitStopMs = 100;
    var beforeStop = WORLD.now();
    GAME.step(1000 / 60);
    eq('顿帧期间世界时间不推进', WORLD.now(), beforeStop);
    GAME.state.hitStopMs = 0;
    GAME.step(1000 / 60);
    ok('顿帧结束后世界继续跑', WORLD.now() > beforeStop);

    // 斩击特效：开着自动战斗打一会儿，必然会看到刀光
    GAME.state.save.settings.autoBattle = true;
    var sawEffect = false;
    var i;
    for (i = 0; i < 1800 && !sawEffect; i += 1) {
      GAME.step(1000 / 60);
      if (WORLD.effects().length > 0) sawEffect = true;
    }
    ok('打架时会生成斩击特效', sawEffect, '特效数 ' + WORLD.effects().length);
    ok('特效数量不超上限', WORLD.effects().length <= BAL.view.slashCap, String(WORLD.effects().length));
    GAME.state.save.settings.autoBattle = false;

    // 画得出来 / 到期不画（假 canvas 能验"特效没白画，也不会画过期的东西"）
    var live = fakeContext();
    G.RENDER.drawEffects(
      live,
      { x: 0, y: 0 },
      [{ kind: 'slash', x: 0, y: 0, dirX: 1, dirY: 0, radius: 80, crit: true, startAt: WORLD.now(), until: WORLD.now() + 200 }],
      WORLD.now()
    );
    ok('斩击特效（含暴击光刺）画得出来', live.calls.count > 0, 'calls=' + live.calls.count);
    var dead = fakeContext();
    G.RENDER.drawEffects(
      dead,
      { x: 0, y: 0 },
      [{ kind: 'slash', x: 0, y: 0, dirX: 1, dirY: 0, radius: 80, crit: false, startAt: 0, until: 1 }],
      WORLD.now()
    );
    eq('过期特效不画任何东西（省落笔）', dead.calls.count, 0);
    for (i = 0; i < 90; i += 1) GAME.step(1000 / 60);
    ok('旧特效会被清掉（数组不会一直涨）', WORLD.effects().length <= 6, String(WORLD.effects().length));
  }

  /**
   * 音效与 BGM（用户要求"音效与 BGM"）。
   * 声音文件由 tools\gen-minigame-sfx.mjs 生成，路径写在 12-platform.js；这里验清单、开关与"没 tt 不炸"。
   * 真机上"响不响"只能靠耳朵，所以这一组保证的是**代码路径与开关逻辑**是对的。
   */
  function checkAudio() {
    section('音效与 BGM（12-platform.js 的 PLAT.sfx / PLAT.bgm）');
    between('音效音量在 0..1', BAL.audio.sfxVolume, 0, 1);
    ok(
      'BGM 音量不高于音效（别盖过打击反馈）',
      BAL.audio.bgmVolume <= BAL.audio.sfxVolume,
      BAL.audio.bgmVolume + ' vs ' + BAL.audio.sfxVolume
    );
    ok('音频总开关是显式布尔', BAL.audio.enabled === true || BAL.audio.enabled === false);

    var state = G.PLAT.audioState();
    eq('音频清单 = 8 个音效 + BGM', state.files.length, 9);
    var allKeys = true;
    var i;
    for (i = 0; i < state.files.length; i += 1) {
      if (!/^[a-z]+$/.test(state.files[i])) allKeys = false;
    }
    ok('清单里都是纯小写键名（路径由平台层拼）', allKeys, state.files.join(','));
    ok('没配 tt 时报告"不支持音频"', state.supported === false, String(state.supported));
    eq('没配 tt 时播音效静默返回 false（不抛）', G.PLAT.sfx('hit'), false);
    eq('没配 tt 时播 BGM 也静默返回 false', G.PLAT.bgm(true), false);
    eq('没配 tt 时停 BGM 静默返回 false', G.PLAT.stopBgm(), false);

    // 设置推下去：关掉音效 → 连平台层都不进
    G.PLAT.setAudio({ enabled: true, sfxEnabled: false, sfxVolume: 0.5, bgmVolume: 0.2 });
    var muted = G.PLAT.audioState();
    eq('关掉音效后 sfx 直接返回 false', G.PLAT.sfx('hit'), false);
    eq('音效音量被记下来（0.5）', muted.sfxVolume, 0.5);
    eq('BGM 音量被记下来（0.2）', muted.bgmVolume, 0.2);
    G.PLAT.setAudio({ sfxEnabled: true, sfxVolume: BAL.audio.sfxVolume, bgmVolume: BAL.audio.bgmVolume });

    // 设置面板的三个开关：写进存档 + 读得回来
    G.SAVE.clear();
    G.GAME.boot();
    G.GAME.beginPlaying('音频测试者');
    ok('音效默认开（老存档也当开）', G.GAME.state.save.settings.sfx === true);
    G.GAME.toggleSetting('sfx');
    eq('点一下关掉音效', G.GAME.state.save.settings.sfx, false);
    eq('关掉后写进了存档', G.SAVE.load(BAL.season.worldSeed, 1).settings.sfx, false);
    G.GAME.toggleSetting('sfx');
    eq('再点一下开回来', G.GAME.state.save.settings.sfx, true);
    G.GAME.toggleSetting('bgm');
    eq('BGM 能关', G.GAME.state.save.settings.bgm, false);
    G.GAME.toggleSetting('bgm');
    eq('BGM 能开回来', G.GAME.state.save.settings.bgm, true);
    G.GAME.toggleSetting('vibrate');
    eq('震动能关', G.GAME.state.save.settings.vibrate, false);
    G.GAME.toggleSetting('vibrate');
    eq('未知键返回 null（不会误改设置）', G.GAME.toggleSetting('nope'), null);
    var view = G.GAME.uiView();
    ok('uiView 带音频状态（设置面板要显示当前开关）', !!view.audio && view.audio.files.length === 9);
  }

  /* ---------------------------------------- 13. 冒烟：假 canvas 跑真帧 */

  /**
   * 假 canvas 上下文：只数调用次数，其余全是 no-op。
   * 它把"一进游戏就白屏 / 坐标全是 NaN"这类**只在真帧里暴露**的 bug 变成一条断言
   * ——上一版工程就是"静态检查全过、一进游戏白屏"，这是唯一的自动化防线。
   */
  function fakeContext() {
    var calls = { count: 0 };
    var noop = function () {
      calls.count += 1;
    };
    var ctx = {
      calls: calls,
      fillStyle: '#000000',
      strokeStyle: '#000000',
      lineWidth: 1,
      font: '10px sans-serif',
      textAlign: 'left',
      textBaseline: 'top',
      globalAlpha: 1
    };
    var names = [
      'save', 'restore', 'beginPath', 'closePath', 'fill', 'stroke', 'moveTo', 'lineTo',
      'arc', 'fillRect', 'strokeRect', 'clearRect', 'fillText', 'strokeText',
      'setTransform', 'translate', 'scale', 'rotate', 'clip', 'drawImage'
    ];
    for (var i = 0; i < names.length; i += 1) ctx[names[i]] = noop;
    ctx.measureText = function (text) {
      calls.count += 1;
      return { width: String(text).length * 10 };
    };
    return ctx;
  }

  /** 冒烟主体：新号 → boot → 先探索再站桩打怪 → 连画 31 帧 → 看账 */
  function smokeBody() {
    section('冒烟：假 canvas 跑 2100 步（走 10 秒 + 站桩 25 秒）');
    var GAME = G.GAME;
    if (!GAME || typeof GAME.boot !== 'function') {
      ok('G.GAME 可用（20-main.js 已拼入）', false, '拿不到 GAME');
      return;
    }
    var ctx = fakeContext();
    var world = G.WORLD;

    G.SAVE.clear(); // 干净起点（node 里 PLAT 的 storage 就是内存桩）
    GAME.boot();
    // A4：进入游戏要经过"登录 → 创建角色"，这条路就是界面上按「创建角色并进入游戏」走的那条
    GAME.beginPlaying('冒烟测试者');

    var player = GAME.state.player;
    ok('创建角色之后进入游戏界面', GAME.state.screen === 'playing', GAME.state.screen);
    ok('存档里记下了角色名（HUD / 头顶名牌要用）', GAME.state.save.name === '冒烟测试者', GAME.state.save.name);
    var startX = player.x;
    var startY = player.y;

    // 把摇杆"推到底、朝右下"（等价于手指按住不放），走完整的输入路径
    var stick = G.INPUT.state.stick;
    stick.active = true;
    stick.dx = 0.7071;
    stick.dy = 0.7071;
    stick.magnitude = 1;

    // 第一阶段：边走边找（600 步 ≈ 10 秒）—— 把周边 chunk 装出来、让怪进仇恨
    var stepsMove = 600;
    var sawMonster = false;
    var i;
    for (i = 0; i < stepsMove; i += 1) {
      GAME.step(1000 / 60);
      if (world.monstersInView().length > 0) sawMonster = true;
    }

    // 第二阶段：松手站桩（1500 步 ≈ 25 秒）—— 这才是自动战斗的真实场景：
    // 不推方向，怪会自己送上门，攻击范围内就自动开打（决策 #7 的"操作只剩移动"）
    stick.active = false;
    stick.dx = 0;
    stick.dy = 0;
    stick.magnitude = 0;
    for (i = 0; i < 1500; i += 1) {
      GAME.step(1000 / 60);
      if (world.monstersInView().length > 0) sawMonster = true;
    }

    for (i = 0; i < 31; i += 1) GAME.renderTo(ctx);

    // A4："打开面板游戏不停止" —— 面板开着连跑 60 个逻辑帧，世界时间必须照旧推进
    var worldBefore = world.now();
    G.PANELS.open('menu');
    for (i = 0; i < 60; i += 1) GAME.step(1000 / 60);
    ok('面板开着世界照旧推进（游戏不停止）', world.now() > worldBefore + 900, 'Δt=' + Math.round(world.now() - worldBefore));
    G.PANELS.close();

    var movedX = player.x - startX;
    var movedY = player.y - startY;
    var moved = Math.sqrt(movedX * movedX + movedY * movedY);
    var save = GAME.state.save;
    GAME.writeSave(); // 之前的断言只跑了逻辑步，没走 frame()，所以这里显式存一次
    var reloaded = G.SAVE.load(BAL.season.worldSeed, 1);

    ok('35 秒（走 10 秒 + 站桩 25 秒）跑完没抛异常', true);
    ok('视野里出现过怪（地图确实在生成内容）', sawMonster);
    ok('玩家确实移动了（摇杆 → 位移）', moved > 500, '位移 ' + Math.round(moved));
    ok('坐标没有 NaN / Infinity', isFinite(player.x) && isFinite(player.y));
    ok('站桩期间打死了怪（自动战斗真的在打）', save.stats.kills >= 1, 'kills=' + save.stats.kills);
    ok('等级被推上去了（经验结算生效，至少 Lv.2）', save.level >= 2, 'Lv.' + save.level);
    ok('渲染产生了真实绘制调用（防白屏）', ctx.calls.count > 500, 'calls=' + ctx.calls.count);
    ok(
      '已装载 chunk 不超上限',
      world.loadedChunkCount() <= BAL.view.chunkCacheLimit,
      world.loadedChunkCount() + ' / ' + BAL.view.chunkCacheLimit
    );
    ok('活跃怪受"只模拟附近"约束（≤ 60）', world.activeMonsterCount() <= 60, String(world.activeMonsterCount()));
    ok('经验 / 金币 / 宝箱至少动过一次', save.exp > 0 || save.gold > 0 || save.chests.length > 0);
    ok('存档写出后能读回同一等级', reloaded.level === save.level, reloaded.level + ' vs ' + save.level);
    stick.active = false;
    stick.dx = 0;
    stick.dy = 0;
    stick.magnitude = 0;
  }

  /**
   * 跑冒烟并把结果单独返回（不动 runAll 的统计）。
   * 只给 node / 命令行用：它会 `boot()`（重置世界 + 读档），在正在运行的游戏里调会影响进度，
   * 所以面板上的「自检」只跑 runAll()。
   */
  function runSmoke() {
    var saved = { checks: state.checks, failures: state.failures, lines: state.lines };
    state.checks = 0;
    state.failures = 0;
    state.lines = [];
    try {
      smokeBody();
    } catch (error) {
      ok('冒烟未抛异常', false, String(error && error.stack ? String(error.stack).split('\n')[0] : error));
    }
    var result = { checks: state.checks, failures: state.failures, lines: state.lines };
    state.checks = saved.checks;
    state.failures = saved.failures;
    state.lines = saved.lines;
    return result;
  }

  /**
   * 全部断言（游戏内面板与 tools\minigame-selftest.mjs 共用）。
   * 每组单独 try/catch：一组炸了不影响其它组，报错里能看出是哪一组。
   */
  function runAll() {
    reset();
    var groups = [
      checkBalance,
      checkChunk,
      checkTerrain,
      checkSpawn,
      checkProgression,
      checkCombat,
      checkLoot,
      checkEquipment,
      checkPlayer,
      checkSave,
      checkAccount,
      checkUi,
      checkMap,
      checkLook,
      checkAuto,
      checkFeel,
      checkAudio
    ];
    for (var i = 0; i < groups.length; i += 1) {
      try {
        groups[i]();
      } catch (error) {
        ok('分组「' + (groups[i].name || '匿名') + '」未抛异常', false, String(error && error.message ? error.message : error));
      }
    }

    section('世界指纹（跨实现回归网）');
    var fingerprint = worldFingerprint(BAL.season.worldSeed);
    if (GOLDEN_FINGERPRINT === 'PENDING') {
      log('  info  当前世界指纹 = ' + fingerprint);
      log('  info  首次运行：把上面这行抄回本文件的 GOLDEN_FINGERPRINT');
      state.checks += 1;
    } else {
      eq('世界指纹与基准一致（防浮点 / 三角函数 / 随机源漂移）', fingerprint, GOLDEN_FINGERPRINT);
      ok('基准值与 TypeScript 侧一致（e9802f11）', GOLDEN_FINGERPRINT === 'e9802f11', GOLDEN_FINGERPRINT);
    }

    log('');
    log('提示：渲染冒烟用 tools\\minigame-now.cmd 跑（node 会调 runSmoke；面板里只跑 runAll）。');

    return {
      checks: state.checks,
      failures: state.failures,
      lines: state.lines.slice(),
      fingerprint: fingerprint
    };
  }

  return {
    GOLDEN_FINGERPRINT: GOLDEN_FINGERPRINT,
    fingerprintOf: fingerprintOf,
    worldFingerprint: worldFingerprint,
    reset: reset,
    state: state,
    fakeContext: fakeContext,
    checkBalance: checkBalance,
    checkChunk: checkChunk,
    checkTerrain: checkTerrain,
    checkSpawn: checkSpawn,
    checkProgression: checkProgression,
    checkCombat: checkCombat,
    checkLoot: checkLoot,
    checkEquipment: checkEquipment,
    checkPlayer: checkPlayer,
    checkSave: checkSave,
    checkAccount: checkAccount,
    checkUi: checkUi,
    checkAuto: checkAuto,
    checkFeel: checkFeel,
    checkAudio: checkAudio,
    checkMap: checkMap,
    checkLook: checkLook,
    runSmoke: runSmoke,
    runAll: runAll
  };
})();
