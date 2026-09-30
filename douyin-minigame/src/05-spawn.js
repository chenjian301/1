/**
 * 05-spawn.js —— chunk 内的确定性播种：怪与地标（world/spawn.ts 的小游戏实现，逐位等价）
 *
 * 铁律：位置、种类、等级、是否精英**全部由哈希决定**，不许有 Math.random。
 * 于是"同一坐标的同一只怪"在客户端与将来服务端是同一个实体（决策 #1 的前提）。
 *
 * ⚠️ 本文件里的**随机数调用顺序**不能改：第 N 次 rng 调用决定第 N 个数值，
 * 顺序一改，全世界的怪都会挪位置、世界指纹立刻不一致。
 * 大小/倍率全部来自 G.BAL（shared/balance.json），这里只写公式。
 */

G.SPAWN = (function () {
  'use strict';

  var BAL = G.BAL;
  var RNG = G.RNG;
  var CHUNK = G.CHUNK;

  /** 每个用途一个盐：怪、地标、出生点互不干扰 */
  var MONSTER_SALT = 0x3f7c01;
  var LANDMARK_SALT = 0x51d0b7;
  var SPAWN_SALT = 0x2ab9e3;

  /** 按权重取一种怪 */
  function pickKind(rng) {
    var kinds = BAL.monsters.kinds;
    var weights = [];
    for (var i = 0; i < kinds.length; i += 1) weights.push(kinds[i].weight);
    return kinds[rng.weightedIndex(weights)];
  }

  /**
   * 怪等级：`3 × band ± 2`，最低 1 级。
   * band 0 = 1~2 级（0 ± 2 之后被夹到 ≥1）；band n = 3n-2 ~ 3n+2。
   * ⚠️ 文档 01-game-design §5 写"band 0 = 1–3"，实际公式给 1~2 —— 这条差异仍在待拍板清单里。
   */
  function monsterLevelFor(band, rng) {
    var base = band * BAL.monsters.levelPerBand;
    var level = base + rng.int(-BAL.monsters.levelJitter, BAL.monsters.levelJitter);
    return level < 1 ? 1 : level;
  }

  /** 等级 → 属性（精英倍率另外乘，见 balance.monsters.elite） */
  function monsterStats(kind, level, elite) {
    var growth = level - 1;
    var eliteRules = BAL.monsters.elite;
    var hp = kind.hp * (1 + BAL.monsters.hpPerLevel * growth) * (elite ? eliteRules.hpMul : 1);
    var attack = kind.attack * (1 + BAL.monsters.attackPerLevel * growth) * (elite ? eliteRules.attackMul : 1);
    var defense = kind.defense * (elite ? eliteRules.defenseMul : 1);
    return {
      hpMax: Math.round(hp),
      attack: Math.round(attack),
      defense: Math.round(defense),
      radius: kind.radius * (elite ? eliteRules.radiusMul : 1)
    };
  }

  /**
   * chunk 的难度带按**chunk 中心**算：同一个 chunk 内 band 是常量，
   * 避免"站在边界上，怪一会儿 3 级一会儿 12 级"。
   */
  function chunkCenterBand(cx, cy) {
    return CHUNK.bandOf(
      CHUNK.chunkOrigin(cx) + CHUNK.CHUNK_SIZE / 2,
      CHUNK.chunkOrigin(cy) + CHUNK.CHUNK_SIZE / 2
    );
  }

  /** 稳定 ID：同一个 (seed, cx, cy, slot, attempt) 永远得到同一个数字 */
  function spawnId(seed, cx, cy, slot, attempt) {
    return RNG.hash32(seed, cx, cy, slot, MONSTER_SALT, attempt);
  }

  /**
   * 生成一个 chunk 的怪。
   *
   *   个体数 = monstersPerChunk.min..max（1~3，密度上限 —— 也是将来服务端 CPU 的护栏）；
   *   群怪（蝙蝠）成群出现：命中 swarm 时一次占掉 2~3 个名额；
   *   8% 概率出现 1 只精英（血 ×5、攻 ×1.6、掉率/经验/金币按 elite 倍率）；
   *   位置 = chunk 均分 3 个槽位 + 槽内抖动；同一群共享等级与巢穴，看起来才像"一群怪"。
   */
  function buildChunkMonsters(seed, cx, cy) {
    var rng = RNG.chunkRng(seed, cx, cy, MONSTER_SALT);
    var band = chunkCenterBand(cx, cy);
    var originX = CHUNK.chunkOrigin(cx);
    var originY = CHUNK.chunkOrigin(cy);

    var want = rng.int(BAL.world.monstersPerChunk.min, BAL.world.monstersPerChunk.max);
    var slots = 3;
    var cell = CHUNK.CHUNK_SIZE / slots;
    var inset = 28;

    var out = [];
    var budget = want;
    var slot = 0;
    var i;
    var k;

    while (budget > 0 && slot < slots) {
      var kind = pickKind(rng);
      var groupSize = 1;
      if (kind.swarm === true) {
        var swarm = BAL.monsters.swarmSize;
        groupSize = Math.min(budget, rng.int(swarm.min, swarm.max));
      }
      budget -= groupSize;

      var level = monsterLevelFor(band, rng);
      var stats = monsterStats(kind, level, false);
      var homeX = originX + slot * cell + rng.float(inset, cell - inset);
      var homeY = originY + rng.float(inset, CHUNK.CHUNK_SIZE - inset);
      var respawnMs = rng.int(BAL.world.respawnMs.min, BAL.world.respawnMs.max);

      for (i = 0; i < groupSize; i += 1) {
        var angle = rng.float(0, Math.PI * 2);
        var spread = groupSize > 1 ? rng.float(26, 64) : 0;

        // 同一 chunk 内 ID 必须唯一（"同距取 ID 小"的确定性依赖它）；撞了就再混一次
        var id = spawnId(seed, cx, cy, slot, 0);
        var attempt = 1;
        var collision = true;
        while (collision) {
          collision = false;
          for (k = 0; k < out.length; k += 1) if (out[k].id === id) collision = true;
          if (collision) {
            id = spawnId(seed, cx, cy, slot, attempt);
            attempt += 1;
          }
        }

        out.push({
          id: id,
          cx: cx,
          cy: cy,
          slot: out.length,
          kindId: kind.id,
          name: kind.name,
          level: level,
          band: band,
          elite: false,
          homeX: homeX,
          homeY: homeY,
          x: homeX + Math.cos(angle) * spread,
          y: homeY + Math.sin(angle) * spread,
          hpMax: stats.hpMax,
          attack: stats.attack,
          defense: stats.defense,
          radius: stats.radius,
          speed: kind.speed,
          attackRange: kind.attackRange,
          attackIntervalMs: kind.attackIntervalMs,
          ranged: kind.ranged,
          aggroRange: kind.aggroRange,
          leashRange: kind.leashRange,
          respawnMs: respawnMs
        });
      }
      slot += 1;
    }

    // 精英：整块 chunk 只掷一次骰子（8%），命中后指定其中一只（每 chunk 最多 1 只）
    if (out.length > 0 && rng.chance(BAL.world.eliteChance)) {
      var target = out[rng.int(0, out.length - 1)];
      var eliteKind = null;
      for (k = 0; k < BAL.monsters.kinds.length; k += 1) {
        if (BAL.monsters.kinds[k].id === target.kindId) eliteKind = BAL.monsters.kinds[k];
      }
      if (eliteKind) {
        var eliteStats = monsterStats(eliteKind, target.level, true);
        target.elite = true;
        target.hpMax = eliteStats.hpMax;
        target.attack = eliteStats.attack;
        target.defense = eliteStats.defense;
        target.radius = eliteStats.radius;
        target.name = eliteKind.name + '·精英';
      }
    }

    return out;
  }

  /** 第 n 个 chunk 属于第几组（地标按组生成）；负坐标也正确 */
  function landmarkGroupOf(chunkIndex, span) {
    return Math.floor(chunkIndex / span);
  }

  /** chunk 组 → 该组的地标（组内落在哪个 chunk、什么种类，全由哈希决定） */
  function landmarkForChunkGroup(seed, gx, gy) {
    var rng = RNG.chunkRng(seed, gx, gy, LANDMARK_SALT);
    var span = BAL.world.landmarkChunkSpan;
    var cx = gx * span + rng.int(0, span - 1);
    var cy = gy * span + rng.int(0, span - 1);
    var x = CHUNK.chunkOrigin(cx) + rng.float(80, CHUNK.CHUNK_SIZE - 80);
    var y = CHUNK.chunkOrigin(cy) + rng.float(80, CHUNK.CHUNK_SIZE - 80);
    return {
      kind: rng.chance(0.5) ? 'ruins' : 'obelisk',
      gx: gx,
      gy: gy,
      x: x,
      y: y,
      band: CHUNK.bandOf(x, y)
    };
  }

  /** 落在给定 chunk 矩形内的全部地标（渲染视锥裁剪用） */
  function landmarksInChunkRect(seed, cxMin, cyMin, cxMax, cyMax) {
    var span = BAL.world.landmarkChunkSpan;
    var gxMin = landmarkGroupOf(cxMin, span);
    var gyMin = landmarkGroupOf(cyMin, span);
    var gxMax = landmarkGroupOf(cxMax, span);
    var gyMax = landmarkGroupOf(cyMax, span);

    var out = [];
    for (var gy = gyMin; gy <= gyMax; gy += 1) {
      for (var gx = gxMin; gx <= gxMax; gx += 1) out.push(landmarkForChunkGroup(seed, gx, gy));
    }
    return out;
  }

  /**
   * 首次进入的随机出生点：距原点 300~800 的环内（决策 #5）。
   * 之后登录回到**上次离线位置**，所以本函数只在"还没出生过"时用。
   */
  function randomSpawnPoint(seed, characterIndex) {
    var rng = new RNG.Rng(RNG.hash32(seed, characterIndex, SPAWN_SALT));
    var ring = BAL.world.spawnRing;
    var radius = rng.float(ring.min, ring.max);
    var angle = rng.float(0, Math.PI * 2);
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  }

  /** 存档里的坐标是否可用（NaN 或离谱坐标视为无效，回退到随机出生） */
  function isUsableSpawn(x, y) {
    if (typeof x !== 'number' || typeof y !== 'number') return false;
    if (!isFinite(x) || !isFinite(y)) return false;
    if (x === 0 && y === 0) return false;
    return CHUNK.distanceToOrigin(x, y) <= 1000000;
  }

  return {
    MONSTER_SALT: MONSTER_SALT,
    LANDMARK_SALT: LANDMARK_SALT,
    SPAWN_SALT: SPAWN_SALT,
    pickKind: pickKind,
    monsterLevelFor: monsterLevelFor,
    monsterStats: monsterStats,
    chunkCenterBand: chunkCenterBand,
    spawnId: spawnId,
    buildChunkMonsters: buildChunkMonsters,
    landmarkGroupOf: landmarkGroupOf,
    landmarkForChunkGroup: landmarkForChunkGroup,
    landmarksInChunkRect: landmarksInChunkRect,
    randomSpawnPoint: randomSpawnPoint,
    isUsableSpawn: isUsableSpawn
  };
})();
