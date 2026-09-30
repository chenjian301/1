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
  /** 公会的规则与记录（本次新增）—— 名字 / 等级 / 成员表的唯一实现 */
  var GUILD = G.GUILD;
  var SAVE = G.SAVE;

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
    eq('装备四部位（武器 / 衣服 / 鞋子 / 饰品）', BAL.equipment.slots.length, 4);
    eq(
      '部位顺序 = 武器 / 衣服 / 鞋子 / 饰品',
      BAL.equipment.slots.map(function (s) { return s.id; }).join(','),
      'weapon,armor,boots,trinket'
    );
    eq('装备目录 60 件（六阶 × 10 件）', BAL.equipment.catalog.length, 60);
    eq('营地不刷怪的半径 = 石砖地半径', BAL.world.camp.monsterFreeRadius, BAL.world.camp.radius);
    // A11：视角倍率不再是一个数，而是**三档表**（远 128 格 / 中 64 格 / 近 32 格）——
    // 每档的 zoom 必须等于 designWidth / (tiles × tileSize)，否则"一屏几格"这句话就是假的。
    var tierCount = BAL.view.cameraTiers.length;
    eq('视角档位三档（远 / 中 / 近）', tierCount, 3);
    var tierMathOk = true;
    var tierAscending = true;
    var tierNames = [];
    var ti;
    for (ti = 0; ti < tierCount; ti += 1) {
      var tierEntry = BAL.view.cameraTiers[ti];
      if (Math.abs(BAL.view.designWidth / (tierEntry.zoom * BAL.world.tileSize) - tierEntry.tiles) > 0.05) tierMathOk = false;
      if (ti > 0 && tierEntry.zoom <= BAL.view.cameraTiers[ti - 1].zoom) tierAscending = false;
      tierNames.push(tierEntry.name + tierEntry.tiles);
      between('第 ' + (ti + 1) + ' 档 zoom 在 0.1~1（< 1 = 拉远、看得更广）', tierEntry.zoom, 0.1, 1);
    }
    eq('三档的名字与格数', tierNames.join(' / '), '远128 / 中64 / 近32');
    ok('每档的 zoom = designWidth / (tiles × tileSize)（"一屏几格"只有这一种算法）', tierMathOk);
    ok('越拉近倍率越大（远 < 中 < 近）', tierAscending);
    near(
      '远档就是 A8 标准：横向正好 128 格',
      BAL.view.designWidth / (BAL.view.cameraTiers[0].zoom * BAL.world.tileSize),
      128,
      0.05
    );
    ok(
      '启动档位在表内，而且默认不是远档（A11 用户：要更清晰 → 默认中档）',
      BAL.view.cameraTier >= 0 && BAL.view.cameraTier < tierCount && BAL.view.cameraTier > 0,
      String(BAL.view.cameraTier)
    );
    ok(
      '省笔档阈值只对远 / 中生效（两档都在它以下），近档走逐格档',
      BAL.view.lodZoom > BAL.view.cameraTiers[0].zoom &&
        BAL.view.lodZoom > BAL.view.cameraTiers[1].zoom &&
        BAL.view.lodZoom <= BAL.view.cameraTiers[2].zoom,
      BAL.view.lodZoom + ' vs ' + tierNames.join(' / ')
    );
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
    eq(
      '地表色块网格 16×16（A7 修订：world.tileSize = 32，块从 102 世界单位缩到 51，肉眼不再是一格一格的方块）',
      TERRAIN.tileCountPerChunk(),
      16
    );

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

    /* A9：宏观斑（远距档用聚合出来的"草甸 / 石滩 / 林地"代替逐件装饰）。
       命门是**同一片地**：斑必须是从同一条装饰流里算出来的（主种类与质心都对得上），
       而不是另画一套示意 —— 否则"远看有林子、走过去树没了"。 */
    var blobs = TERRAIN.decorBlobs(seed, 3, 3, 0, 2);
    ok('宏观斑画得出来（远距档不是一片纯色）', blobs.length > 0, 'blobs=' + blobs.length);
    ok('宏观斑最多 maxBlobs 个', blobs.length <= 2, 'blobs=' + blobs.length);
    ok(
      '宏观斑的种类都来自这个 chunk 的真实装饰',
      blobs.every(function (b) { return TERRAIN.DECOR_ORDER.indexOf(b.kind) >= 0; }),
      true
    );
    same('同 chunk 两次聚合一致（确定性）', TERRAIN.decorBlobs(seed, 3, 3, 0, 2), blobs);
    ok(
      '斑半径落在 48~150 世界单位（远距档 ≈ 4~14 CSS px：看得见又不糊成一团）',
      blobs.every(function (b) { return b.r >= 48 && b.r <= 150; }),
      blobs.map(function (b) { return b.r.toFixed(1); }).join(',')
    );
    ok(
      '斑的件数不超过真实装饰数（聚合不会"生"出装饰）',
      blobs.every(function (b) { return b.count >= 2 && b.count <= decorations.length; }),
      true
    );

    // 主种类与质心必须与真实装饰一致（这才是"聚合"而不是"另画一套"）
    var countByKind = { grass: 0, rock: 0, tree: 0 };
    var di;
    for (di = 0; di < decorations.length; di += 1) countByKind[decorations[di].kind] += 1;
    var topKind = TERRAIN.DECOR_ORDER[0];
    for (di = 1; di < TERRAIN.DECOR_ORDER.length; di += 1) {
      if (countByKind[TERRAIN.DECOR_ORDER[di]] > countByKind[topKind]) topKind = TERRAIN.DECOR_ORDER[di];
    }
    eq('最大那个斑的种类 = 真实装饰里最多的那种（远看那片林子就是那片林子）', blobs[0].kind, topKind);
    var sumX2 = 0;
    var sumY2 = 0;
    var count2 = 0;
    for (di = 0; di < decorations.length; di += 1) {
      if (decorations[di].kind !== blobs[0].kind) continue;
      sumX2 += decorations[di].x;
      sumY2 += decorations[di].y;
      count2 += 1;
    }
    near('斑的横坐标 = 那种装饰的质心', blobs[0].x, sumX2 / count2, 0.001);
    near('斑的纵坐标 = 那种装饰的质心', blobs[0].y, sumY2 / count2, 0.001);

    var grid = TERRAIN.tileCountPerChunk();
    var variants = {};
    var shades = {};
    var structureMismatch = 0;
    for (var tileX = 0; tileX < grid; tileX += 1) {
      for (var tileY = 0; tileY < grid; tileY += 1) {
        var variant = TERRAIN.groundVariant(seed, 0, 0, tileX, tileY);
        var level = G.RENDER.groundLevel(seed, 0, 0, tileX, tileY);
        variants[variant] = true;
        shades[level] = true;
        if (Math.floor(level / 2) !== variant) structureMismatch += 1;
      }
    }
    eq('地表色块在 16×16 网格上取到 3 种结构色', Object.keys(variants).length, 3);
    eq('每张块再分亮 / 暗两档 → 6 档色（16-render.GROUND_LEVELS）', Object.keys(shades).length, 6);
    eq('色档的高位就是 groundVariant（结构不随亮暗档漂移）', structureMismatch, 0);
    eq(
      '同一张块两次取档一致（纯哈希，画面不会闪）',
      G.RENDER.groundLevel(seed, 0, 0, 5, 9),
      G.RENDER.groundLevel(seed, 0, 0, 5, 9)
    );
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
    eq('选目标：范围内最近的活怪（死的跳过）', COMBAT_.pickTarget(0, 0, [far, near2, near1, dead], 540).id, 7);
    var tieA = { id: 9, x: 50, y: 0, state: 'idle' };
    var tieB = { id: 4, x: 50, y: 0, state: 'idle' };
    eq('同距取 ID 小的（确定性，帧率变了目标也不跳）', COMBAT_.pickTarget(0, 0, [tieA, tieB], 540).id, 4);
    eq('给了距离上限时，上限之外的怪不算目标', COMBAT_.pickTarget(0, 0, [far], 540), null);

    // A7 修订（用户要求"自动战斗盯全地图最近的怪"）：默认 targetRange = 0 = **不限距离**。
    // 写死 540 时屏幕外的怪一个都选不到，自动走位就停在原地发呆。
    eq('选目标距离上限默认 0（0 = 不限距离）', BAL.combat.targetRange, 0);
    var beyondScreen = { id: 11, x: 3000, y: 0, state: 'idle' };
    eq('旧上限（540）下，3000 外的怪选不到', COMBAT_.pickTarget(0, 0, [beyondScreen], 540), null);
    eq(
      '默认规则下，3000 外的怪照样是目标（全地图）',
      COMBAT_.pickTarget(0, 0, [beyondScreen], COMBAT_.targetRange()).id,
      11
    );
    eq('不限距离时仍然"最近的"优先', COMBAT_.pickTarget(0, 0, [beyondScreen, near1], COMBAT_.targetRange()).id, 7);

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

    // A13：宝箱背包按阶计数（面板上那一列「× 数量」只读这一个数）
    var bagCounts = LOOT.countByTier([
      { tier: 1, level: 3 },
      { tier: 1, level: 9 },
      { tier: 6, level: 9 },
      { tier: 6, level: 1 },
      { tier: 4, level: 2 }
    ]);
    eq('按阶计数：普通 2 / 传说 1 / 天赐 2，其余 0（与袋子顺序无关）', bagCounts.join(','), '2,0,0,1,0,2');
    eq('一串数正好六阶（清单恒六行就靠它）', bagCounts.length, BAL.chests.tiers.length);
    eq('坏阶号与空记录不占位（只有合法阶号算数）', LOOT.countByTier([{ tier: 0 }, { tier: 7 }, null, { tier: 3, level: 1 }]).join(','), '0,0,1,0,0,0');
    eq('空袋子 → 六阶全是 0（清单照样六行）', LOOT.countByTier([]).join(','), '0,0,0,0,0,0');
  }

  /* ---------------------------------------- 8. 装备生成 / 词条 / 战力 */

  /**
   * 装备（A6 起是**目录驱动**：六阶 × 10 件 = 60 件，每件有名字 / 部位 / 外观 / 等级门槛）。
   * 这一组盯三件事：① 目录本身合法（部位对得上、门槛单调、同阶越靠后越强）；
   * ② 生成出来的东西与目录一致（名字 / 外观 / 门槛都跟着那一件走）；
   * ③ 穿上之后的属性汇总与战力口径没变。
   */
  function checkEquipment() {
    section('装备目录 / 生成 / 词条 / 战力 / 外观（09-equipment.js）');
    var EQUIP_ = G.EQUIP;
    var rng = new G.RNG.Rng(1234);
    var c;

    // ① 目录：60 件、id 唯一、部位合法、每阶 10 件、四个部位都有货
    var catalog = EQUIP_.catalog();
    var seen = {};
    var dup = 0;
    var badSlot = 0;
    var noName = 0;
    var noStyle = 0;
    var noColor = 0;
    var tierCount = [];
    for (c = 0; c < catalog.length; c += 1) {
      var entry = catalog[c];
      if (seen['#' + entry.id]) dup += 1;
      seen['#' + entry.id] = true;
      if (!EQUIP_.hasSlot(entry.slot)) badSlot += 1;
      if (!entry.name || entry.name.length === 0) noName += 1;
      var entryLook = EQUIP_.lookOfDef(entry);
      if (!entryLook || !entryLook.style) noStyle += 1;
      if (!entryLook || !entryLook.a || !entryLook.b) noColor += 1;
      tierCount[entry.tier] = (tierCount[entry.tier] || 0) + 1;
    }
    eq('目录 id 不重复', dup, 0);
    eq('目录里每个部位都合法', badSlot, 0);
    eq('每阶 10 件', tierCount.slice(1).join(','), '10,10,10,10,10,10');
    eq('每件都有名字', noName, 0);
    eq('每件都有造型 id（渲染与图标都读它）', noStyle, 0);
    eq('每件都有配色（缺色的装备画不出来）', noColor, 0);
    var tier1 = EQUIP_.catalogForTier(1);
    var covered = 0;
    for (c = 0; c < EQUIP_.SLOT_IDS.length; c += 1) {
      var slotId = EQUIP_.SLOT_IDS[c];
      for (var d = 0; d < tier1.length; d += 1) {
        if (tier1[d].slot === slotId) covered += 1;
      }
    }
    ok('1 阶 10 件把四个部位都覆盖到了', covered === tier1.length, String(covered));

    // ② 等级门槛：等阶越高越高，同阶内越靠后越高（这就是"装备的等级划分"）
    eq('1 阶门槛从 1 起', EQUIP_.requirementFor(1), 1);
    eq('6 阶门槛 16', EQUIP_.requirementFor(6), 16);
    ok(
      '同阶内门槛单调不降',
      EQUIP_.requirementForItem(tier1[9]) >= EQUIP_.requirementForItem(tier1[0]),
      EQUIP_.requirementForItem(tier1[0]) + ' -> ' + EQUIP_.requirementForItem(tier1[9])
    );
    ok(
      '同阶内越靠后越强（阶内系数）',
      EQUIP_.statMulOf(tier1[9]) > EQUIP_.statMulOf(tier1[0]),
      EQUIP_.statMulOf(tier1[0]) + ' -> ' + EQUIP_.statMulOf(tier1[9])
    );
    ok(
      '最高门槛不超过目标等级 20（不然开出来穿不上）',
      EQUIP_.requirementForItem(EQUIP_.defById('t6_destinyblade')) <= BAL.progression.targetLevel,
      String(EQUIP_.requirementForItem(EQUIP_.defById('t6_destinyblade')))
    );

    var t1 = EQUIP_.generate(1, 1, rng, 1);
    eq('1 阶 1 条词条', t1.affixes.length, 1);
    ok('生成的东西来自目录', EQUIP_.defById(t1.defId) !== null, t1.defId);
    eq('门槛取自目录那一件', t1.reqLevel, EQUIP_.requirementForItem(EQUIP_.defById(t1.defId)));
    ok('带名字', !!t1.name && t1.name.length > 0, t1.name);
    ok('带外观（部位 + 造型 + 配色）', !!(t1.look && t1.look.style && t1.look.a), JSON.stringify(t1.look));
    ok('主属性数值 > 0', t1.main.value > 0, t1.main.stat + ' ' + t1.main.value);
    ok('战力 > 0', t1.power > 0, String(t1.power));
    eq('等级够就能穿', EQUIP_.canWear(t1, 99), true);
    eq('等级不够穿不上', EQUIP_.canWear(t1, t1.reqLevel - 1), false);
    eq('部位不存在（老存档的头盔）穿不上', EQUIP_.canWear({ slotId: 'helmet', reqLevel: 1 }, 99), false);

    var t3 = EQUIP_.generate(3, 8, new G.RNG.Rng(7), 2);
    eq('3 阶 3 条词条', t3.affixes.length, 3);
    ok('3 阶门槛 ≥ 7', t3.reqLevel >= 7, String(t3.reqLevel));
    eq('词条不重复', new Set(t3.affixes.map(function (a) { return a.name; })).size, t3.affixes.length);

    var t6 = EQUIP_.generate(6, 20, new G.RNG.Rng(9), 3);
    eq('6 阶 = 5 条词条 + 1 条天赐专属', t6.affixes.length, 6);
    ok('第 6 条带"天赐"前缀', t6.affixes[5].name.indexOf('天赐') === 0, t6.affixes[5].name);
    ok('6 阶门槛 ≥ 16', t6.reqLevel >= 16, String(t6.reqLevel));

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

    // 掉 200 次必须四个部位都出得来（"装备类型分为四类"不能只是写在文档里）
    var slotHits = { weapon: 0, armor: 0, boots: 0, trinket: 0 };
    var cover = new G.RNG.Rng(777);
    for (i = 0; i < 200; i += 1) slotHits[EQUIP_.generate(2, 5, cover, 0).slotId] += 1;
    ok(
      '200 次掉落覆盖四个部位',
      slotHits.weapon > 0 && slotHits.armor > 0 && slotHits.boots > 0 && slotHits.trinket > 0,
      JSON.stringify(slotHits)
    );

    var loadout = EQUIP_.emptyLoadout();
    eq('空装备栏战力 0', EQUIP_.armoryPower(loadout), 0);
    loadout[t1.slotId] = t1;
    eq('穿上后战力 = 该件战力', EQUIP_.armoryPower(loadout), t1.power);
    var totals = EQUIP_.totalsOf(loadout);
    ok('属性汇总里有主属性', totals[t1.main.stat] >= t1.main.value, String(totals[t1.main.stat]));
    eq('格式化百分比词条', EQUIP_.formatValue('critChance', 0.043), '+4.3% 暴击率');
    eq('界面文案 = 阶名 + 装备名', EQUIP_.labelOf(t1), EQUIP_.tierById(1).name + ' ' + t1.name);

    // ③ 外观汇总：渲染层每帧读的就是这一份
    var look = EQUIP_.lookOf(loadout);
    eq('外观只跟着穿上的那一件走', look[t1.slotId] === t1.look, true);
    var rest = 0;
    for (c = 0; c < EQUIP_.SLOT_IDS.length; c += 1) {
      if (EQUIP_.SLOT_IDS[c] !== t1.slotId && look[EQUIP_.SLOT_IDS[c]] === null) rest += 1;
    }
    eq('没穿的部位在外观里是 null', rest, 3);
    var nothing = EQUIP_.lookOf(null);
    ok(
      '没穿装备时外观是四个 null（渲染层不用到处判空）',
      nothing.weapon === null && nothing.armor === null && nothing.boots === null && nothing.trinket === null
    );
    eq('饰品主属性是暴击率（A6：四部位各有各的定位）', EQUIP_.slotById('trinket').mainStat, 'critChance');
  }

  /* ---------------------------------------- 8b. 开箱必出装备（A7 修订 2） */

  /**
   * 开箱必出装备（用户原话："打开宝箱必定出装备"）。
   *
   * 代码里本来就**每箱生成一件装备**（设计 §7：开箱 = 抽装备等阶 → 生成具体装备），这一组把
   * "必有产出"锁成断言，顺带守住两条容易出事的边：
   *   ① **不吞箱**：装备先生成、箱子后扣（生成失败时箱子原样还在）；开 N 箱箱数正好减 N；
   *   ② **不吞装备**：每件产出都必须落在"身上或背包里"（换装时旧件折算成金币是允许的，新件不许凭空消失）；
   * 再加两条坏数据兜底：箱阶越界（99）/ tier 缺失时也照样出装备，不许空手。
   */
  function checkChestOpen() {
    section('开箱必出装备（20-main 的 openOneChest / openChests）');
    var GAME = G.GAME;
    if (!GAME || typeof GAME.openOneChest !== 'function') {
      ok('G.GAME 的 openOneChest 可用（20-main.js 已拼入）', false, '拿不到 GAME');
      return;
    }
    G.SAVE.clear();
    GAME.boot();
    // **不要**在这里调 beginPlaying：它会注册本机账号并把 G.LOGIN 的 hasAccount 置 true，
    // 而后面的 checkUi 有一条"欢迎页按钮写「登录 / 开始游戏」"的断言依赖此刻还没有账号
    // （本组排在 checkUi 前面，踩过一次）。boot() 已经给齐 state.save / player / stats，
    // 开箱这条链只需要这三样。
    var save = GAME.state.save;
    var i;

    save.chests = [];
    for (i = 1; i <= 6; i += 1) save.chests.push({ tier: i, level: 5 });
    var openedBefore = save.stats.opened;

    var produced = 0; // 真的出装备的箱数（要等于 6）
    var missing = 0; // 一件都没出的箱数（要等于 0）
    var kept = 0; // 产出落在"身上或背包里"的件数（要等于 6）
    var higherTier = 0; // 产出等阶不低于箱阶的件数（要等于 6）
    for (i = 0; i < 6; i += 1) {
      var chestTier = save.chests[0].tier;
      var result = GAME.openOneChest();
      if (!result || !result.item) {
        missing += 1;
        continue;
      }
      produced += 1;
      if (result.item.tier >= chestTier) higherTier += 1;
      if (save.items.indexOf(result.item) >= 0 || save.loadout[result.item.slotId] === result.item) kept += 1;
    }
    eq('六阶各开一箱：一件都没漏（没有空箱）', produced, 6);
    eq('也没出现"箱没了、装备也没有"的情况', missing, 0);
    eq('箱数正好减 6（不多扣）', save.chests.length, 0);
    eq('每件产出都落在身上或背包里（不吞装备）', kept, 6);
    eq('产出等阶不低于箱阶（六阶各一件都守规则）', higherTier, 6);
    eq('开箱流水计数 +6', save.stats.opened - openedBefore, 6);

    eq('背包里没箱时开箱返回 null（不白扣）', GAME.openOneChest(), null);

    // 坏数据兜底：这两种脏箱在老存档 / 改包里都可能出现，必须照样出装备
    save.chests.push({ tier: 99, level: 7 });
    var weird = GAME.openOneChest();
    ok(
      '箱阶越界照样出装备（回落合法阶，不许空手）',
      !!weird && !!weird.item,
      weird && weird.item ? 'tier ' + weird.item.tier : 'null'
    );
    save.chests.push({ level: 7 });
    var dirty = GAME.openOneChest();
    ok(
      'tier 缺失的脏箱也照样出装备',
      !!dirty && !!dirty.item,
      dirty && dirty.item ? 'tier ' + dirty.item.tier : 'null'
    );
    eq('脏箱也照样从背包里扣掉（箱子数对得上）', save.chests.length, 0);

    // 箱不够时的开 10 箱：只开现有的，不空转也不报错
    save.chests = [{ tier: 3, level: 9 }];
    GAME.openChests(10);
    eq('要开 10 箱但只剩 1 箱 → 开完为止，不报错', save.chests.length, 0);
    eq('累计开箱计数 = 6 + 2 + 1', save.stats.opened - openedBefore, 9);
  }

  /* ---------------------------------------- 8c. 按阶开箱与自动开启（A14） */

  /**
   * A14（用户："宝箱可以设置是否自动开启——对应不同等阶不同的开启按钮"）。
   *
   * 界面上那两枚按阶控件（清单每行的「全开」+「自动」勾选）画得对不对、点得到点不到，
   * 在 `checkPanelLayout` 里断言；这一组管**逻辑与存档**：
   *   ① `settings.chestAuto` 的形状（一阶一枚）：新号全关、老存档没有这个字段 → 全关、
   *      坏值一律当**关**（宁可不开，也别替玩家把箱子花掉）；
   *   ② 「全开」= 只开这一阶：开 N 箱正好扣掉这一阶的 N 口，别的阶一口都不动，
   *      这一阶空了就开 0 箱（不报错、也不误开别的阶）；
   *   ③ 「自动开启」= 箱子掉出来就**当场开**：不进背包、不占 bagCap，
   *      入账走和手点开箱同一个 `grantEquipment`；
   *   ④ 掉箱那条路的接线：勾上 → 箱子直接开掉不进背包；没勾 → 照旧进背包（升级前后行为只差一个勾）。
   */
  function checkChestAuto() {
    section('按阶开箱与自动开启（A14：清单每行的「全开」+「自动」勾选）');
    var GAME = G.GAME;
    var LOOT_ = G.LOOT;
    if (
      !GAME ||
      !LOOT_ ||
      typeof GAME.openChestsOfTier !== 'function' ||
      typeof GAME.autoOpenChest !== 'function' ||
      typeof GAME.toggleChestAuto !== 'function' ||
      typeof LOOT_.autoEnabled !== 'function'
    ) {
      ok('GAME.openChestsOfTier / autoOpenChest / toggleChestAuto / LOOT.autoEnabled 可用（A14 的入口都导出了）', false, '拿不到入口');
      return;
    }
    var tierTotal = BAL.chests.tiers.length;
    var allOff = 'false,false,false,false,false,false';

    // 1. 纯函数：一阶一枚、默认全关；坏数据一律当关
    eq('默认勾选表 = 一阶一枚、全关', LOOT_.defaultAutoFlags().join(','), allOff);
    eq('默认勾选表长度 = 阶数（改阶数不会让两边对不上）', LOOT_.defaultAutoFlags().length, tierTotal);
    eq('「自动开启」判定：勾上的那一阶为真 / 没勾的为假', LOOT_.autoEnabled([false, true], 2) + ',' + LOOT_.autoEnabled([false, true], 1), 'true,false');
    eq(
      '老存档没有这个字段 / 不是数组 / 值不是 true → 一律当关',
      LOOT_.autoEnabled(null, 1) + ',' + LOOT_.autoEnabled('x', 1) + ',' + LOOT_.autoEnabled([1, 'yes'], 1) + ',' + LOOT_.autoEnabled([undefined, true], 1),
      'false,false,false,false'
    );
    eq('阶号离谱（0 / 越界）也当关', LOOT_.autoEnabled([true], 0) + ',' + LOOT_.autoEnabled([true], 99), 'false,false');
    eq('勾了几阶（清单小标题读它）', LOOT_.autoCount([true, false, true]), 2);

    // 2. 存档：新号全关、老存档补齐全关、坏值当关，长度永远跟阶数对齐
    eq('新号的设置里就有这个字段，且全关', G.SAVE.defaultSettings().chestAuto.join(','), allOff);
    eq('老存档没有 chestAuto → 迁移成"全关"（升级后行为与 A13 一模一样）', G.SAVE.normalizeSettings({ sfx: true }).chestAuto.join(','), allOff);
    eq(
      '存档里明确的 true 原样保留，其余当关',
      G.SAVE.normalizeSettings({ chestAuto: [true, false, 'yes'] }).chestAuto.join(','),
      'true,false,false,false,false,false'
    );
    eq('坏值（不是数组）当全关', G.SAVE.normalizeSettings({ chestAuto: 'x' }).chestAuto.join(','), allOff);
    eq('长度永远 = 阶数（多给的项丢掉）', G.SAVE.normalizeSettings({ chestAuto: [true, true, true, true, true, true, true, true] }).chestAuto.length, tierTotal);

    // 3. 运行时：「自动」勾选写进存档（重开还记得）
    G.SAVE.clear();
    GAME.boot();
    var save = GAME.state.save;
    var openedBefore = save.stats.opened;
    eq('开机后六个勾选全关', GAME.chestAutoFlags().join(','), allOff);
    GAME.toggleChestAuto(3);
    eq('切换第三阶 = 勾上（勾选表按阶号对齐）', GAME.chestAutoFlags().join(','), 'false,false,true,false,false,false');
    eq('勾选写进存档（重开还记得）', G.SAVE.load(BAL.season.worldSeed, 1).settings.chestAuto.join(','), 'false,false,true,false,false,false');
    GAME.toggleChestAuto(3);
    eq('再点一下又关掉', GAME.chestAutoFlags().join(','), allOff);
    var threwToggle = '';
    try {
      GAME.toggleChestAuto(0);
      GAME.toggleChestAuto(99);
      GAME.toggleChestAuto('x');
      GAME.toggleChestAuto();
    } catch (error) {
      threwToggle = String(error && error.message ? error.message : error);
    }
    eq('越界 / 非数字 / 缺参的阶号都不炸（界面上按空不该炸）', threwToggle, '');

    // 4. 「全开」只开这一阶：别的阶一口都不动
    save.chests = [{ tier: 2, level: 4 }, { tier: 5, level: 6 }, { tier: 2, level: 7 }, { tier: 2, level: 4 }];
    eq('「全开」返回真开了几箱（三口二阶）', GAME.openChestsOfTier(2), 3);
    eq('别的阶一口都不动（还剩那口五阶的）', save.chests.length + ':' + save.chests[0].tier, '1:5');
    eq('开箱流水只 +3', save.stats.opened - openedBefore, 3);
    eq('这一阶空了 → 再点「全开」开 0 箱（不报错）', GAME.openChestsOfTier(2), 0);
    eq('阶号离谱也是 0（按钮越界点不出来，这里兜底）', GAME.openChestsOfTier(0) + ',' + GAME.openChestsOfTier(99), '0,0');
    eq('「全开」不会顺手开别的阶（五阶那口还在）', save.chests.length, 1);

    // 5. 「自动开启」：没进过背包的箱子也能开（掉出来就当场开）
    save.chests = [];
    save.settings.chestAuto = LOOT_.defaultAutoFlags();
    var autoed = GAME.autoOpenChest(4, 8);
    ok('自动开启一阶 → 直接开出一件装备（背包里本来就没有箱子）', !!autoed && !!autoed.item, autoed && autoed.item ? 'tier ' + autoed.item.tier : 'null');
    ok('产出的等阶不低于箱阶（同一条 rollEquipmentTier 规则）', !!autoed && autoed.item.tier >= 4, autoed && autoed.item ? 'tier ' + autoed.item.tier : 'null');
    ok(
      '产出落在身上或背包里（与手点开箱共用 grantEquipment）',
      !!autoed && (save.items.indexOf(autoed.item) >= 0 || save.loadout[autoed.item.slotId] === autoed.item)
    );
    eq('自动开箱照样计入开箱流水', save.stats.opened - openedBefore, 4);
    eq('阶号离谱的自动开启开不出东西（不白给装备）', GAME.autoOpenChest(0, 5), null);

    // 6. 掉箱那条路的接线：勾上 → 箱子不进背包；没勾 → 照旧进背包
    var realDropChance = LOOT_.dropChance;
    LOOT_.dropChance = function () {
      return 1; // 强制掉箱（chance(1) 恒真，见 02-rng）
    };
    var killed = { mine: true, monster: { name: '测试怪', level: 6, band: 1, elite: false } };
    var openedOff = save.stats.opened;
    save.chests = [];
    GAME.applyKill(killed);
    eq('没勾自动开启：箱子照旧进背包（满包的自动分解那条老路一个字都没动）', save.chests.length, 1);
    eq('没勾自动开启：开箱流水不动', save.stats.opened - openedOff, 0);
    save.settings.chestAuto = [true, true, true, true, true, true];
    save.chests = [];
    var openedOn = save.stats.opened;
    GAME.applyKill(killed);
    eq('勾上自动开启：箱子**不进背包**（不掉出来就进包）', save.chests.length, 0);
    eq('勾上自动开启：当场开掉（开箱流水 +1）', save.stats.opened - openedOn, 1);
    LOOT_.dropChance = realDropChance;
    save.settings.chestAuto = LOOT_.defaultAutoFlags();
    eq('还原之后又回到"进背包"（勾选是唯一的开关）', GAME.state.save.settings.chestAuto.join(','), allOff);
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

    // A6：属性面板的行数据（每行把"等级基础"与"装备加成"分开写）
    var rows = PLAYER_.breakdown(20, loadout);
    ok('属性行数 ≥ 10', rows.length >= 10, String(rows.length));
    var labels = rows.map(function (row) { return row.label; }).join(',');
    ok(
      '含攻击 / 生命上限 / 防御 / 攻速 / 暴击率',
      labels.indexOf('攻击') >= 0 &&
        labels.indexOf('生命上限') >= 0 &&
        labels.indexOf('防御') >= 0 &&
        labels.indexOf('攻速') >= 0 &&
        labels.indexOf('暴击率') >= 0,
      labels
    );
    var powerRow = null;
    var r;
    var broken = '';
    for (r = 0; r < rows.length; r += 1) {
      if (rows[r].label === '战力') powerRow = rows[r];
      if (!rows[r].sub || rows[r].sub.indexOf('NaN') >= 0 || String(rows[r].value).indexOf('NaN') >= 0) broken += rows[r].label + ';';
    }
    ok('战力一行与属性快照一致', !!powerRow && powerRow.value === String(PLAYER_.statsOf(20, loadout).power), powerRow ? powerRow.value : 'null');
    eq('每行都有说明而且没有 NaN', broken, '');
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
    eq('新号有 4 个装备栏（武器 / 衣服 / 鞋子 / 饰品）', Object.keys(fresh.loadout).length, 4);
    eq('新号没有强化石（本次新增：商城买的）', fresh.stones, 0);
    ok('出生点可用（决策 #5：首次随机出生）', G.SPAWN.isUsableSpawn(fresh.x, fresh.y), fresh.x + ',' + fresh.y);

    var broken = SAVE_.normalize({ v: 1, level: 99, x: NaN, y: 0, chests: [{ tier: 9 }, { tier: 3, level: 8 }] }, seed, 1);
    eq('存档修复：非法箱阶被丢掉', broken.chests.length, 1);
    eq('存档修复：保留合法箱子', broken.chests[0].tier, 3);
    eq('存档修复：坏坐标回退到随机出生点', G.SPAWN.isUsableSpawn(broken.x, broken.y), true);
    eq('存档版本不符 → 当新号处理', SAVE_.normalize({ v: 0, level: 50 }, seed, 1).level, 1);
    eq('null 存档 → 当新号处理', SAVE_.normalize(null, seed, 1).level, 1);

    // 强化石 / 强化等级（本次新增）：都是"可选字段 + 默认值"，所以 v2 的老存档照样读得进来
    eq('缺 stones 字段的 v2 老存档 → 0 颗', SAVE_.normalize({ v: 2, level: 5 }, seed, 1).stones, 0);
    eq('存档里的强化石能读回', SAVE_.normalize({ v: 2, stones: 12 }, seed, 1).stones, 12);
    eq('负的强化石被夹回 0', SAVE_.normalize({ v: 2, stones: -5 }, seed, 1).stones, 0);
    eq('离谱的强化石被夹回上限', SAVE_.normalize({ v: 2, stones: 1e9 }, seed, 1).stones, 999999);
    var badGear = SAVE_.normalize(
      {
        v: 2,
        items: [{ id: 1, slotId: 'weapon', main: { stat: 'attack', value: 5 }, affixes: [], enhance: 999 }],
        loadout: {
          weapon: { id: 2, slotId: 'weapon', main: { stat: 'attack', value: 5 }, affixes: [], enhance: -3 }
        }
      },
      seed,
      1
    );
    eq('背包里那件的坏强化等级被夹到上限（不许白送 +999）', badGear.items[0].enhance, G.EQUIP.maxEnhance());
    eq('身上那件的负强化等级夹回 0', badGear.loadout.weapon.enhance, 0);
    eq('老存档没有 enhance 字段 → 0 级（不炸）', G.EQUIP.enhanceLevel({ main: { stat: 'attack', value: 5 }, affixes: [] }), 0);

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

    /* ---------------------------------------------- A6：视角倍率 / Q版外观 / 图标 */

    // 视角倍率：viewRect 必须跟着放大，否则边缘会缺一块（最容易漏的一条）。
    // A11 之二起倍率的唯一来源是**缩放轴**（`view.zoomTiles`，默认 22 格），档位只提供"落在档位上时的精确值"。
    var camRect = R.viewRect({ x: 0, y: 0 });
    var k = R.zoom();
    var camTier = R.tier();
    var camTiles = Math.round(BAL.view.zoomTiles);
    eq(
      '视角倍率取自缩放轴（designWidth / (格数 × tileSize)；正落在档位上时取表里的精确值）',
      k,
      camTiles === camTier.tiles ? camTier.zoom : BAL.view.designWidth / (camTiles * BAL.world.tileSize)
    );
    eq(
      'tier() 给出的就是离当前格数最近的那一档（宏观规格 / 装载环挂在它上面）',
      camTier.tiles,
      BAL.view.cameraTiers[BAL.view.cameraTier].tiles
    );
    near('视野宽 = 屏宽 / 倍率', camRect.width, G.SCREEN.width() / k, 1e-9);
    near('视野高 = 屏高 / 倍率', camRect.height, G.SCREEN.height() / k, 1e-9);
    // A6 的原意是"拉远之后视野比屏幕大"。默认改成 22 格（略近：zoom 1.0227）之后这条不再恒真，
    // 所以按**倍率**验这条更普适的规律：zoom < 1 → 视野比屏幕大，zoom > 1 → 比屏幕小
    // （一屏 22.5 格才是 1:1；拉远到 64 / 128 格时视野才真的比屏幕大）。
    ok(
      '视野随倍率走：倍率 < 1 时视野比屏幕大、> 1 时比屏幕小（"扩大视角"真的生效）',
      (k < 1) === (camRect.width > G.SCREEN.width()) && (k > 1) === (camRect.width < G.SCREEN.width()),
      'zoom=' + k.toFixed(4) + ' 视野=' + Math.round(camRect.width) + ' 屏宽=' + G.SCREEN.width()
    );

    /* A8 / A11：一屏几格由**缩放轴**说了算（默认 22 格，滑块 16~64，预设档位 128 / 64 / 32），
       竖屏永远不可能是正方形：横向 = 格数，竖向 = 格数 × 手机长宽比。 */
    near('视野宽 = 当前格数 × tileSize（世界单位）', camRect.width, camTiles * BAL.world.tileSize, 1e-6);
    ok(
      '竖屏下竖向视野必然更长（格数是短边，不是正方形）',
      camRect.height > camRect.width,
      Math.round(camRect.height) + ' vs ' + Math.round(camRect.width)
    );
    eq('0.8 倍率 = 全细节档（A6 的观感就是逐格档）', R.groundDetailAt(0.8), 'high');
    eq('远档 = 宏观档（省笔档）', R.groundDetailAt(BAL.view.cameraTiers[0].zoom), 'low');
    eq('中档 = 宏观档', R.groundDetailAt(BAL.view.cameraTiers[1].zoom), 'low');
    eq('近档 = 逐格档（一格 22.5 设计 px，够画 16×16 色格）', R.groundDetailAt(BAL.view.cameraTiers[2].zoom), 'high');
    eq(
      '宏观色格边长按档位给（远 4 格 / 中 1 格 / 近 1 格地表）',
      R.lodBlockTiles(),
      BAL.view.cameraTiers[BAL.view.cameraTier].lodBlockTiles
    );
    eq('每 chunk 的色格数 = 每 chunk 的格数 ÷ 色格边长', R.lodBlocks(), G.TERRAIN.tileCountPerChunk() / R.lodBlockTiles());

    // 宏观档的账：低倍率下地表按"同 band 跨 chunk 批量落笔"，fill 次数比 chunk 数还少；
    // 把阈值压到 0（= 关掉宏观档）立刻回到逐格档（每 chunk 一次 fillRect + 6 档路径）。
    // 相机取在很远的地方，营地石砖的视野粗判会直接返回，于是这里数的正好只有"地表"这一层。
    // A11：这一段量的是 A9 的账（"一整屏 171 个 chunk 的落笔比 chunk 数还少"），所以显式切到**远档**来数 ——
    // 默认档已经换成中档（视野小 4 倍），拿它去比"落笔比 chunk 少"就不公平了：那是批量化的功劳，不是视野的。
    var savedTierForLod = BAL.view.cameraTier;
    var savedTilesForLod = BAL.view.zoomTiles;
    // A11 之二：倍率由**缩放轴**（`view.zoomTiles`）说了算，档位只负责"宏观规格 / 装载环" ——
    // 所以这里要同时把缩放轴放到远档的格数上（真机上切档走 GAME.setZoomTier，它一次写两处）。
    BAL.view.cameraTier = 0;
    BAL.view.zoomTiles = BAL.view.cameraTiers[0].tiles;
    var farCam = { x: 200000, y: 200000 };
    var farRect = R.viewRect(farCam);
    var farChunks = G.CHUNK.chunksInRect(farRect.minX, farRect.minY, farRect.maxX, farRect.maxY, 0).length;
    var lowGround = countGroundFills(farCam);
    var lowMacro = R.macroStats();
    log(
      '  info  宏观档（一屏 ' + farChunks + ' 个 chunk）：落笔 ' + lowGround.fills +
        ' 次、建路径 ' + lowGround.all + ' 次；调色板槽 ' + lowMacro.slots + ' 组、装饰斑 ' + lowMacro.blobs + ' 个'
    );
    ok(
      '宏观档：地表按同 band 跨 chunk 批量落笔（一整屏 171 个 chunk 的落笔比 chunk 数还少）',
      lowGround.fills > 0 && lowGround.fills < farChunks,
      'fills=' + lowGround.fills + ' chunks=' + farChunks
    );
    ok(
      '宏观档的落笔上限 = 调色板槽 ×（6 档地表 + 3 种斑）—— 随 band 组数走，不随 chunk 数走',
      lowGround.fills <= lowMacro.slots * 9,
      'fills=' + lowGround.fills + ' slots=' + lowMacro.slots
    );
    ok(
      '宏观档：粗色格真的建了路径（地表有纹理，不是每 chunk 一片纯色）',
      lowGround.all >= farChunks * 4,
      'all=' + lowGround.all + ' chunks=' + farChunks
    );
    ok(
      '宏观档的调色板槽 = 视野里的 band 组数（同 band 才共用一次落笔）',
      lowMacro.slots >= 1 && lowMacro.slots <= 40,
      'slots=' + lowMacro.slots
    );
    ok(
      '宏观装饰斑：整屏至少一半的 chunk 有可读的"草甸 / 石滩 / 林地"',
      lowMacro.blobs >= farChunks / 2,
      'blobs=' + lowMacro.blobs + ' chunks=' + farChunks
    );
    var savedBlobs = BAL.view.lodDecorBlobs;
    BAL.view.lodDecorBlobs = 0;
    countGroundFills(farCam);
    var noBlobs = R.macroStats().blobs;
    BAL.view.lodDecorBlobs = savedBlobs;
    eq('宏观装饰斑也是一个数就能关掉（lodDecorBlobs = 0 → 一个斑都不画）', noBlobs, 0);
    var savedLodZoom = BAL.view.lodZoom;
    BAL.view.lodZoom = 0;
    var highGround = countGroundFills(farCam);
    BAL.view.lodZoom = savedLodZoom;
    ok(
      '关掉宏观档（lodZoom = 0）后地表回到逐格档（每 chunk 一次 fillRect + 6 档路径）',
      highGround.rects >= farChunks && highGround.fills >= farChunks,
      'rects=' + highGround.rects + ' fills=' + highGround.fills + ' chunks=' + farChunks
    );
    var decorCtx = fakeContext();
    R.drawDecor(decorCtx, farCam, [{ x: 200000, y: 200000, kind: 'grass', size: 1, flip: false, band: 0 }]);
    eq('省笔档：装饰整层跳过（拉远后一件装饰只剩 1~2 CSS px）', decorCtx.calls.count, 0);
    eq('省笔档阈值已复位（自检不许把 balance 改坏给后面的组看）', BAL.view.lodZoom, savedLodZoom);
    BAL.view.cameraTier = savedTierForLod;
    BAL.view.zoomTiles = savedTilesForLod;
    eq('临时切到远档量完就切回来（自检不许把 balance 改坏给后面的组看）', BAL.view.cameraTier, savedTierForLod);
    ok('世界层缩放包夹成对出现（beginWorld / endWorld）', typeof R.beginWorld === 'function' && typeof R.endWorld === 'function');

    /* ---------------------------------------------- A9：演员层最小观感尺寸（view.actorMinZoom） */

    // 用户："还有人物的大小"。一屏 128 格（远档）把世界压缩了 4.55 倍，角色（半径 24）只剩 ~4 CSS px；
    // 这一层给"点状的东西"一个观感下限：屏幕上的半径 = 世界半径 × actorMinZoom。
    // A11 之二起倍率的唯一来源是**缩放轴**（`view.zoomTiles`），所以这里显式把倍率放到**远档**那一格数上
    // —— A9 讲的账本来就是那个最大压缩比下的账，量完再放回去。
    var savedTilesForActor = BAL.view.zoomTiles;
    var savedTierForActor = BAL.view.cameraTier;
    BAL.view.cameraTier = 0;
    BAL.view.zoomTiles = BAL.view.cameraTiers[0].tiles;
    var kActor = R.zoom();
    var actorScale = R.actorScale();
    near('演员层放大倍数 = actorMinZoom / zoom', actorScale, BAL.view.actorMinZoom / kActor, 1e-9);
    near(
      '角色在屏幕上的半径（设计 px）= 半径 × actorMinZoom',
      BAL.player.radius * actorScale * kActor,
      BAL.player.radius * BAL.view.actorMinZoom,
      1e-9
    );
    ok(
      '角色在屏幕上的观感尺寸有 A6 同款（>= 18 设计 px 半径 ≈ 手机 9 CSS px）',
      BAL.player.radius * actorScale * kActor >= 18 && BAL.player.radius * actorScale * kActor <= 24,
      (BAL.player.radius * actorScale * kActor).toFixed(1) + ' 设计 px = ' + (BAL.player.radius * actorScale * kActor * 0.52).toFixed(1) + ' CSS px'
    );
    var savedActorMin = BAL.view.actorMinZoom;
    var savedTierZoom = BAL.view.cameraTiers[0].zoom;
    BAL.view.cameraTiers[0].zoom = savedActorMin; // 把远档的倍率抬到 0.8（= actorMinZoom）
    eq('倍率抬到 actorMinZoom 时这一层完全不生效（就是 1 倍，观感本来就够）', R.actorScale(), 1);
    BAL.view.cameraTiers[0].zoom = savedTierZoom;
    BAL.view.actorMinZoom = 0; // 关掉演员层
    eq('actorMinZoom = 0 → 一个像素都不放大（可一键回退到"角色 4 CSS px"）', R.actorScale(), 1);
    BAL.view.actorMinZoom = savedActorMin;
    near(
      '演员层与档位倍率都复位（自检不许把 balance 改坏给后面的组看）',
      BAL.view.actorMinZoom + R.zoom(),
      savedActorMin + savedTierZoom,
      1e-12
    );
    BAL.view.cameraTier = savedTierForActor;
    BAL.view.zoomTiles = savedTilesForActor;
    eq(
      '默认 ' + BAL.view.zoomTiles + ' 格时倍率已高于 actorMinZoom → 演员层不放大（角色按世界尺寸画，A11 之三 近距离视角的顺带好处）',
      R.actorScale(),
      1
    );

    // 演员层是"成对 save / restore"的：不配平的话缩放会漏给后面的怪 / 名牌 / HUD（画面会整体错位）
    var depthCtx = fakeContext();
    var depth = 0;
    var rawSave = depthCtx.save;
    var rawRestore = depthCtx.restore;
    depthCtx.save = function () {
      depth += 1;
      return rawSave.apply(this, arguments);
    };
    depthCtx.restore = function () {
      depth -= 1;
      return rawRestore.apply(this, arguments);
    };
    var depthCam = { x: 0, y: 0 };
    R.drawPlayer(
      depthCtx,
      depthCam,
      { x: 0, y: 0, radius: BAL.player.radius, facing: { x: 1, y: 0 }, moving: false, hp: 10, hpMax: 10, hurtUntil: 0 },
      { attackSpeed: 1.2 },
      1000,
      null
    );
    eq('玩家画完 save / restore 配平（演员层缩放不许漏出去）', depth, 0);
    R.drawMonsters(
      depthCtx,
      depthCam,
      [{ id: 7, kindId: 'brute', x: 60, y: 0, radius: 30, dirX: -1, dirY: 0, state: 'chase', hp: 5, hpMax: 10, level: 3, name: '石拳巨怪', elite: true, hurtUntil: 0 }],
      7,
      1000
    );
    eq('怪画完 save / restore 配平（含精英圈 / 王冠 / 血条 / 名字）', depth, 0);
    ok('演员层的身体真的画了（不是空转）', depthCtx.calls.count > 0, 'calls=' + depthCtx.calls.count);
    var zoomCtx = fakeContext();
    R.beginWorld(zoomCtx);
    R.endWorld(zoomCtx);
    ok('缩放包夹在假 canvas 上也能用（save + 3 次变换 + restore）', zoomCtx.calls.count >= 2, 'calls=' + zoomCtx.calls.count);

    // 装备外观：穿满四件要画得出来，而且比裸装多画东西（含武器造型 / 衣服款式 / 鞋 / 饰品）
    var full = {
      weapon: { slot: 'weapon', style: 'greatsword', a: '#ffd479', b: '#6b2f2f', c: '#fff3d0', tier: 6 },
      armor: { slot: 'armor', style: 'plate', a: '#ffd479', b: '#ffffff', c: '#ffffff', tier: 6 },
      boots: { slot: 'boots', style: 'plateboot', a: '#ffd479', b: '#6b5a36', c: '#ffd479', tier: 6 },
      trinket: { slot: 'trinket', style: 'orb', a: '#ffffff', b: '#ffd479', c: '#ffffff', tier: 6 }
    };
    var dressed = fakeContext();
    R.drawPlayer(dressed, { x: 0, y: 0 }, { x: 0, y: 0, facing: { x: 1, y: 0 } }, { attackSpeed: 1.6 }, 0, full);
    ok('穿满四件装备的玩家画得出来', dressed.calls.count > 0, 'calls=' + dressed.calls.count);
    var naked = fakeContext();
    R.drawPlayer(naked, { x: 0, y: 0 }, { x: 0, y: 0, facing: { x: 1, y: 0 } }, { attackSpeed: 1.6 }, 0);
    ok('不传外观也能画（默认裸装）', naked.calls.count > 0, 'calls=' + naked.calls.count);
    ok(
      '穿装备比裸装多画东西（外观真的接上了）',
      dressed.calls.count > naked.calls.count,
      dressed.calls.count + ' vs ' + naked.calls.count
    );
    // 八种武器造型与四种饰品造型都要画得出来（不然"每件装备都有外观"是空话）
    var weaponStyles = ['sword', 'greatsword', 'dagger', 'spear', 'axe', 'hammer', 'staff', 'scythe'];
    var weaponMiss = [];
    for (var ws = 0; ws < weaponStyles.length; ws += 1) {
      var wctx = fakeContext();
      G.ICONS.weapon(wctx, { slot: 'weapon', style: weaponStyles[ws], a: '#fff', b: '#000', c: '#888', tier: 1 }, 0, 0, 44);
      if (wctx.calls.count < 2) weaponMiss.push(weaponStyles[ws]);
    }
    ok('八种武器造型图标都画得出来', weaponMiss.length === 0, weaponMiss.join(','));
    var trinketStyles = ['amulet', 'ring', 'orb', 'crown'];
    var trinketMiss = [];
    for (var ts = 0; ts < trinketStyles.length; ts += 1) {
      var tctx = fakeContext();
      G.ICONS.trinket(tctx, { slot: 'trinket', style: trinketStyles[ts], a: '#fff', b: '#000', c: '#888', tier: 1 }, 0, 0, 44);
      if (tctx.calls.count < 2) trinketMiss.push(trinketStyles[ts]);
    }
    ok('四种饰品造型图标都画得出来', trinketMiss.length === 0, trinketMiss.join(','));

    // 每个按键都真的有一张图标（"每个 UI 按钮都做出对应的图标"）
    var iconKeys = ['chest', 'bag', 'guild', 'camp', 'menu', 'auto', 'attack', 'login', 'user', 'keyboard', 'dice', 'trash', 'stat', 'skill0', 'skill1', 'skill2', 'skill3'];
    var iconMiss = [];
    for (var ik = 0; ik < iconKeys.length; ik += 1) {
      var ictx = fakeContext();
      G.ICONS.button(ictx, iconKeys[ik], 0, 0, 40, '#ffffff');
      if (ictx.calls.count < 2) iconMiss.push(iconKeys[ik]);
    }
    ok('每个按钮 id 都有图标（而且不是空转）', iconMiss.length === 0, iconMiss.join(','));
    var itemMiss = [];
    for (var si = 0; si < G.EQUIP.SLOT_IDS.length; si += 1) {
      var sctx = fakeContext();
      G.ICONS.item(sctx, { slot: G.EQUIP.SLOT_IDS[si], style: 'x', a: '#fff', b: '#000', c: '#888', tier: 2 }, 0, 0, 44);
      var gctx = fakeContext();
      G.ICONS.slotPlaceholder(gctx, G.EQUIP.SLOT_IDS[si], 0, 0, 44);
      if (sctx.calls.count < 2 || gctx.calls.count < 2) itemMiss.push(G.EQUIP.SLOT_IDS[si]);
    }
    ok('四个部位的内观与空位剪影都画得出来', itemMiss.length === 0, itemMiss.join(','));
    var frameCtx = fakeContext();
    G.ICONS.frame(frameCtx, 0, 0, 44, 6, false, 0);
    ok('阶色边框画得出来', frameCtx.calls.count >= 2, 'calls=' + frameCtx.calls.count);
    eq('阶色只有一份（面板转发 icons 那份）', G.PANELS.tierColor(6), G.ICONS.TIER_COLORS[5]);
    eq('发光色也只有一份（icons 读 balance.equipment.tiers[].glow）', G.ICONS.tierGlow(6).join(','), BAL.equipment.tiers[5].glow.join(','));
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
      stones: 3,
      stats: { kills: 7 }
    };
    var migrated = G.SAVE.normalize(v1, BAL.season.worldSeed, 1);
    eq('v1 存档迁移后版本 = 2', migrated.v, 2);
    eq('迁移不丢等级', migrated.level, 9);
    eq('迁移不丢金币', migrated.gold, 456);
    eq('迁移不丢宝箱', migrated.chests.length, 1);
    eq('迁移不丢号角', migrated.horns, 2);
    eq('迁移不丢强化石（本次新增的字段，v1 存档里其实不会有）', migrated.stones, 3);
    eq('迁移补上角色名（空 = 还没建角色）', migrated.name, '');
    eq('迁移补上设置项（自动战斗默认关）', migrated.settings.autoBattle, false);
    eq('认不出的版本照样开新号（不白屏）', G.SAVE.normalize({ v: 99, level: 5 }, BAL.season.worldSeed, 1).level, 1);
    eq('音效默认开', G.SAVE.normalize({ v: 2, settings: {} }, BAL.season.worldSeed, 1).settings.sfx, true);
    eq('写了 false 才关', G.SAVE.normalize({ v: 2, settings: { sfx: false } }, BAL.season.worldSeed, 1).settings.sfx, false);
    eq('坏设置不炸（回默认值）', G.SAVE.normalize({ v: 2, settings: 'nope' }, BAL.season.worldSeed, 1).settings.vibrate, true);
  }

  /**
   * 界面（用户要求三条）：面板只占一部分屏（A4 是 1/3 屏，2026-10-01 改成 2/3 屏高）、
   * 有关闭按钮、打开时游戏不停止；另外验证登录 / 创建角色界面的按钮能产生正确的 action
   * （界面逻辑不能只靠肉眼）。
   */
  function checkUi() {
    section('界面：卡片大小 / 关闭键 / 滚动 / 登录界面（A4）');
    var card = G.PANELS.rect();
    var ratio = (card.w * card.h) / (G.SCREEN.width() * G.SCREEN.height());
    // 2026-10-01 用户布局改动（`tools\hud-preview.html` 拖出来后跑 `tools\apply-hud-layout.cmd` 写回）：
    // 卡片从"约 1/3 屏"（屏高 0.42 ≈ 面积 0.38）改成"约 2/3 屏高"—— 目的很直白：背包内容约 1492
    // 设计 px，卡片高一点就少滚一截（视口 ~580 → ~964）。面积跟着 balance 走，所以这条断言
    // 只是"别把卡片拖到铺满屏幕"的看门狗。**本次改动：下限从 0.52 放到 0.44** ——
    // 卡片左边让出了 `view.panel.leftReserve`（左侧边栏的宽度，见 balance.view.sideBar），
    // 于是它是"窄一点的 2/3 屏高"（720x1600 下 0.4877），高度那一维没变。
    between('面板卡片面积约为 2/3 屏高（用户 2026-10-01 从 1/3 屏改过来）', ratio, 0.44, 0.66);
    ok(
      '卡片完整落在屏幕内',
      card.x >= 0 && card.y >= 0 && card.x + card.w <= G.SCREEN.width() && card.y + card.h <= G.SCREEN.height(),
      JSON.stringify(card)
    );
    ok(
      '卡片没有铺满屏幕（左右留着边距、下面留着整条吸底动作栏）',
      card.w < G.SCREEN.width() * 0.95 && card.h < G.SCREEN.height() * 0.7,
      Math.round(card.w) + 'x' + Math.round(card.h) + ' / ' + G.SCREEN.width() + 'x' + Math.round(G.SCREEN.height())
    );

    var hudButtons = G.HUD.buttons({ save: { chests: [], items: [], guild: null, settings: { autoBattle: false } } });
    // 本次改动：底部那一行只剩 箱 / 包 / 会 / 设 / 自动（「商」挪进左边侧边栏），
    // 侧边栏的两枚键追加在**最后**（自检与预览都在数这份表，追加最安全）
    eq('底部功能图标 5 枚 + 左侧边栏 2 枚', hudButtons.length, 7);
    eq('「自动」仍是底部那一行的最后一枚', hudButtons[4].id, 'auto');
    var hudRow = hudButtons.filter(function (button) { return button.kind !== 'side'; });
    var hudSide = hudButtons.filter(function (button) { return button.kind === 'side'; });
    eq('底部那一行是 5 枚（箱 / 包 / 会 / 设 / 自动）', hudRow.length, 5);
    eq('侧边栏是 2 枚（商 / 营）', hudSide.length, 2);
    eq('侧边栏第一枚是「商」（商城）', hudSide[0].id, 'sideShop');
    eq('侧边栏第二枚是「营」（回到营地）', hudSide[1].id, 'sideCamp');
    ok(
      '「商」在「营」上面（用户要求：回到营地按钮放在商城下面）',
      hudSide[1].y > hudSide[0].y + hudSide[0].r && hudSide[0].x === hudSide[1].x,
      '商 y=' + Math.round(hudSide[0].y) + ' 营 y=' + Math.round(hudSide[1].y)
    );
    ok(
      '侧边栏贴左边缘、整条在屏内，且两枚圆之间塞得下说明文字',
      hudSide[0].x - hudSide[0].r >= 0 &&
        hudSide[1].x + hudSide[1].r < G.SCREEN.width() / 2 &&
        hudSide[1].y - hudSide[1].r >
          hudSide[0].y + hudSide[0].r + BAL.view.hud.captionGap + G.ICONS.size('captionSize') - 1,
      Math.round(hudSide[0].x) + ',' + Math.round(hudSide[0].y) + ' / ' + Math.round(hudSide[1].x) + ',' + Math.round(hudSide[1].y)
    );
    ok(
      '侧边栏的底板把两枚键都框住了（HUD.sideBarRect）',
      (function () {
        var rail = G.HUD.sideBarRect();
        return (
          !!rail &&
          rail.x <= hudSide[0].x - hudSide[0].r &&
          rail.x + rail.w >= hudSide[0].x + hudSide[0].r &&
          rail.y <= hudSide[0].y - hudSide[0].r &&
          rail.y + rail.h >= hudSide[1].y + hudSide[1].r
        );
      })(),
      JSON.stringify(G.HUD.sideBarRect())
    );
    ok(
      '侧边栏整条都在面板卡片左边（否则面板打开时那两枚键会被卡片吃掉触摸）',
      G.HUD.sideBarRect().x + G.HUD.sideBarRect().w <= card.x,
      Math.round(G.HUD.sideBarRect().x + G.HUD.sideBarRect().w) + ' <= ' + Math.round(card.x)
    );
    // 角标读的还是手里的强化石（跟着「商」一起挪进了侧边栏）
    eq('「商」的角标读的就是手里的强化石（0 颗时没有角标）', hudSide[0].badge, 0);
    var hudWithStones = G.HUD.buttons({
      save: { chests: [], items: [], guild: null, stones: 7, settings: { autoBattle: false } }
    });
    eq('手里有石头时「商」的角标就是石头的数量', hudWithStones[5].badge, 7);
    eq('底部那一行没有「商」了（同一个商城不会出现两次）', hudRow.map(function (b) { return b.id; }).indexOf('shop'), -1);
    var lastHudButton = hudRow[hudRow.length - 1];
    ok(
      '功能图标排成一行（A7 换位：从右侧竖列改成底部一行）',
      hudRow[0].y === lastHudButton.y && hudRow[0].x < lastHudButton.x,
      hudRow.map(function (button) { return Math.round(button.x); }).join(',')
    );
    ok(
      '功能图标整排在屏幕内（7 槽 + gap 20 收窄后的账）',
      hudRow[0].x - hudRow[0].r >= 0 && lastHudButton.x + lastHudButton.r <= G.SCREEN.width(),
      Math.round(hudRow[0].x - hudRow[0].r) + ' .. ' + Math.round(lastHudButton.x + lastHudButton.r)
    );
    ok(
      '卡片与整条吸底动作栏不重叠（卡片底边压在它上面）',
      card.y + card.h <= G.HUD.bottomBarTop(),
      Math.round(card.y + card.h) + ' <= ' + Math.round(G.HUD.bottomBarTop())
    );
    ok(
      '经验条在最下方（在两行键下面）',
      G.HUD.expTop() >= hudRow[0].y + hudRow[0].r + BAL.view.hud.captionGap + G.ICONS.size('captionSize'),
      Math.round(G.HUD.expTop()) + ' vs ' + Math.round(hudRow[0].y + hudRow[0].r)
    );
    ok('自动按钮带状态（开着会点亮）', hudRow[4].state === 'off' && hudRow[4].label.length > 0, hudRow[4].label);

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

    /* ------------------------------ A6：登录按钮上的字 / 背包内观 / 属性面板 */

    // A6 修的 bug：登录 / 注册页面的按钮上**要真的有字**（以前只画了框，文案漏画）
    function textsOfLogin(stageId) {
      var texts = [];
      var ctx2 = fakeContext();
      var original = ctx2.fillText;
      ctx2.fillText = function (value) {
        texts.push(String(value));
        return original.apply(this, arguments);
      };
      login.open(stageId);
      login.draw(ctx2, { save: save, account: null, stats: view.stats });
      return texts;
    }
    var welcomeTexts = textsOfLogin('welcome');
    var welcomeButtons = login.buttons();
    var missingText = [];
    for (var b = 0; b < welcomeButtons.length; b += 1) {
      if (welcomeTexts.indexOf(welcomeButtons[b].label) < 0) missingText.push(welcomeButtons[b].id);
    }
    ok('登录页每个按钮都把文案画出来了', missingText.length === 0, missingText.join(','));
    ok('登录页能看到「登录 / 开始游戏」这几个字', welcomeTexts.join('|').indexOf('登录 / 开始游戏') >= 0, welcomeTexts.join('|'));
    var iconless = welcomeButtons.filter(function (button) { return !button.icon; });
    eq('登录页按钮都带图标 id', iconless.length, 0);
    var createTexts = textsOfLogin('createRole');
    var createButtons = login.buttons();
    missingText = [];
    for (b = 0; b < createButtons.length; b += 1) {
      if (createTexts.indexOf(createButtons[b].label) < 0) missingText.push(createButtons[b].id);
    }
    ok('创建角色页每个按钮都把文案画出来了', missingText.length === 0, missingText.join(','));
    ok('创建角色页能看到按钮文字', createTexts.join('|').indexOf('创建角色并进入游戏') >= 0, createTexts.join('|'));
    eq('创建角色页按钮都带图标 id', createButtons.filter(function (button) { return !button.icon; }).length, 0);
    login.open('welcome');

    // 背包面板：四个部位（带内观图标）+ 属性入口
    G.PANELS.open('bag');
    var bagRows = G.PANELS.rows(view);
    var slotRows = 0;
    var gearIcons = 0;
    var bagIds = [];
    for (b = 0; b < bagRows.length; b += 1) {
      bagIds.push(bagRows[b].id);
      if (bagRows[b].id.indexOf('bag:slot:') === 0) {
        slotRows += 1;
        if (bagRows[b].icon && bagRows[b].icon.kind === 'gear') gearIcons += 1;
      }
    }
    eq('背包面板列出 4 个装备部位', slotRows, 4);
    eq('四个部位都用"装备内观"图标', gearIcons, 4);
    ok('背包面板有「角色属性」入口', bagIds.indexOf('bag:stat') >= 0, bagIds.join(','));
    var bagCtx = fakeContext();
    G.PANELS.draw(bagCtx, view);
    ok('背包面板（含内观图标）画得出来', bagCtx.calls.count > 40, 'calls=' + bagCtx.calls.count);
    G.PANELS.close();

    // 属性面板：一行一项，数值来自 PLAYER.breakdown（等级基础 + 装备加成分开写）
    G.PANELS.open('stat');
    var statRows = G.PANELS.rows(view);
    ok('属性面板有 10 项以上', statRows.length >= 10, String(statRows.length));
    var statText = statRows.map(function (row) { return row.text + '/' + row.sub; }).join('|');
    ok('属性面板含攻击', statText.indexOf('攻击') >= 0, statText);
    ok('属性面板含生命上限', statText.indexOf('生命上限') >= 0);
    ok('属性面板含暴击率与暴击伤害', statText.indexOf('暴击率') >= 0 && statText.indexOf('暴击伤害') >= 0);
    ok('属性面板写清了「装备」加成', statText.indexOf('装备') >= 0);
    var statCtx = fakeContext();
    G.PANELS.draw(statCtx, view);
    ok('属性面板画得出来', statCtx.calls.count > 40, 'calls=' + statCtx.calls.count);
    G.PANELS.close();

    // 设置面板：A6 多了「角色属性」一行，而且能打开属性面板
    G.PANELS.open('menu');
    var menuIds = G.PANELS.rows(view).map(function (row) { return row.id; });
    ok('设置面板有「角色属性」入口', menuIds.indexOf('menu:stat') >= 0, menuIds.join(','));
    var openStat = null;
    var menuRows = G.PANELS.rows(view);
    for (b = 0; b < menuRows.length; b += 1) {
      if (menuRows[b].id === 'menu:stat') openStat = menuRows[b].action;
    }
    ok('那一行的 action 是打开属性面板', !!openStat && openStat.type === 'open' && openStat.panel === 'stat', JSON.stringify(openStat));
    G.PANELS.close();
  }

  /**
   * 把玩家挪到"营地之外、确定有怪"的地方（A6 新增）。
   *
   * A6 起营地半径内不刷怪，于是"站在出生点原地打怪"的测试必然抓不到目标 ——
   * 这里直接用**生成层**（05-spawn，不受营地过滤影响）取某个 chunk 的巢穴坐标，
   * 把玩家放到它旁边，再正常装载 chunk。这样断言不用碰运气，也不依赖出生点在哪。
   */
  function standOutsideCamp(game, cx, cy) {
    var spawn = G.SPAWN.buildChunkMonsters(BAL.season.worldSeed, cx, cy);
    var player = game.state.player;
    if (spawn.length) {
      player.x = spawn[0].homeX + 140;
      player.y = spawn[0].homeY;
    } else {
      player.x = G.CHUNK.chunkOrigin(cx) + G.CHUNK.CHUNK_SIZE / 2;
      player.y = G.CHUNK.chunkOrigin(cy) + G.CHUNK.CHUNK_SIZE / 2;
    }
    player.dead = false;
    player.hp = game.state.stats.hpMax;
    game.state.camera.x = player.x;
    game.state.camera.y = player.y;
    G.WORLD.ensureChunks(player.x, player.y, 2);
    return player;
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

    // 走位：把玩家挪到营地外（A6 起营地里不刷怪），然后只跑 autoStep（怪不跑 AI，落点才可断言）
    var player = standOutsideCamp(GAME, 6, 6);
    var stats = GAME.state.stats;
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

    // A7 修订（用户要求"自动战斗找全地图最近的怪"）：把玩家丢到离**所有**已装载的怪都超过 3000 的地方
    // —— 旧规则（上限 540）这里一定是 null，自动走位会站着发呆；新规则照样盯住最近那只并走过去。
    var loaded = G.WORLD.allMonsters();
    var alive = [];
    var maxMonsterX = -Infinity;
    var maxMonsterY = -Infinity;
    for (var mi = 0; mi < loaded.length; mi += 1) {
      if (loaded[mi].state === 'dead') continue;
      alive.push(loaded[mi]);
      if (loaded[mi].x > maxMonsterX) maxMonsterX = loaded[mi].x;
      if (loaded[mi].y > maxMonsterY) maxMonsterY = loaded[mi].y;
    }
    ok('已装载的怪里至少有一只活的（下面几条全靠它）', alive.length > 0, 'alive=' + alive.length);
    if (alive.length) {
      var backX = player.x;
      var backY = player.y;
      player.x = maxMonsterX + 3000;
      player.y = maxMonsterY + 3000;
      ok('旧上限（540）在这个位置一个目标都选不到', G.COMBAT.pickTarget(player.x, player.y, alive, 540) === null);
      var farTarget = G.WORLD.pickTarget(player);
      ok('不限距离时仍盯住最近的那只怪', !!farTarget, farTarget ? 'id=' + farTarget.id : 'null');
      if (farTarget) {
        var farBefore = Math.sqrt(
          (farTarget.x - player.x) * (farTarget.x - player.x) + (farTarget.y - player.y) * (farTarget.y - player.y)
        );
        ok('  —— 距离确实在 3000 那一档（真的是"全地图"）', farBefore > 540, Math.round(farBefore));
        player.targetId = 0; // 清掉上一个目标，逼 autoStep 重新选（== "目标死了 / 丢了"那条路）
        for (var fk = 0; fk < 120; fk += 1) GAME.autoStep(player, stats, 1000 / 60);
        var farAfter = Math.sqrt(
          (farTarget.x - player.x) * (farTarget.x - player.x) + (farTarget.y - player.y) * (farTarget.y - player.y)
        );
        ok(
          '自动走位朝 3000 外的那只怪走（距离变小）',
          farAfter < farBefore,
          Math.round(farBefore) + ' -> ' + Math.round(farAfter)
        );
      }
      player.x = backX;
      player.y = backY;
      player.targetId = 0;
    }

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
    ok('暴击震屏有一档设定值（幅度 > 0）', BAL.view.shake.critPower > 0 && BAL.view.shake.critMs > 0);
    ok(
      'A7 修订 2：balance 里已没有"挨打震屏"字段（受伤不抖屏）',
      BAL.view.shake.hurtMs === undefined && BAL.view.shake.hurtPower === undefined,
      JSON.stringify(BAL.view.shake)
    );
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
    GAME.state.shake.power = 0;
    var hurt = GAME.applyHitFeedback({ hits: [], playerHits: [{ damage: 5 }] });
    eq('挨打也有顿帧', hurt.stop, BAL.view.hitStopMs.hurt);
    eq('A7 修订 2：挨打不再震屏（震屏只留给暴击）', GAME.state.shake.power, 0);
    eq('挨打也不许把相机的震屏偏移带起来', GAME.shakeOffset(GAME.state.now).x, 0);

    // 顿帧真的会冻住世界
    GAME.state.hitStopMs = 100;
    var beforeStop = WORLD.now();
    GAME.step(1000 / 60);
    eq('顿帧期间世界时间不推进', WORLD.now(), beforeStop);
    GAME.state.hitStopMs = 0;
    GAME.step(1000 / 60);
    ok('顿帧结束后世界继续跑', WORLD.now() > beforeStop);

    // 斩击特效：开着自动战斗打一会儿，必然会看到刀光
    // A6：营地里不刷怪，所以先站到"确定有怪"的地方（见 standOutsideCamp）
    standOutsideCamp(GAME, 6, 7);
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
    eq('音频清单 = 10 个音效 + BGM（A5 多了 cast / mend）', state.files.length, 11);
    ok('技能音效在清单里（cast / mend）', state.files.indexOf('cast') >= 0 && state.files.indexOf('mend') >= 0, state.files.join(','));
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
    ok('uiView 带音频状态（设置面板要显示当前开关）', !!view.audio && view.audio.files.length === 11);
  }

  /**
   * 营地交互入口（用户要求"营地的交互入口（回血 / 商店 / 传送）"）。
   * 三件事都能断言：治疗按缺失血量收钱、满血不收、钱不够不给治；
   * 传送会把人放到原点、短冷却内第二次被拒；「营」按钮只在营地里出现。
   */
  /* ------------------- 14b. 铁匠强化 + 商城的强化石 + 背包分页（本次新增） */

  /**
   * 用户要求三件事：① 商城里能买到强化石（100 金币一颗，越往上强化吃的石头越多）；
   * ② 公会营地里有一个铁匠NPC；③ 他给**已穿**的装备强化（+1 → +10，每级翻倍）；
   * 顺带把 A 版背包那句"只列出前 15 件"改成**一页 15 件、拖格子翻页**。
   *
   * 这一组盯四件事：
   *   ① 规则只有一份（`balance.enhance`）：成本 = baseStones x growth^等级，坏数据（+999 / 负数 /
   *      字符串）不许白送等级 —— 改包与坏存档都拦在这里；
   *   ② 改存档只有两条入口（`buyStone` / `enhanceItem`）：金币与石头只在它们里面动，强化只动
   *      **身上那一件**，别的部位与背包一个字节都不变；
   *   ③ 界面：强化面板（四行 + 石头 + 去商城）、商城的强化石行、营地面板的铁匠行，点了要开对面板；
   *   ④ 入口：走到铁匠跟前才多出那枚「锻」键 —— **走远了必须消失**，否则在野外摸到那一块屏幕
   *      会莫名其妙弹出强化面板（这类"按钮钉在世界上"的 bug 只能靠断言盯住）。
   */
  function checkEnhance() {
    section('铁匠强化 / 强化石 / 背包分页（本次新增）');
    var rule = BAL.enhance;
    var E = G.EQUIP;
    var GAME = G.GAME;

    function rowById(list, id) {
      for (var n = 0; n < list.length; n += 1) {
        if (list[n].id === id) return list[n];
      }
      return null;
    }

    /* ---- ① 数值规则：全在 balance，代码里没有第二个数 ---- */
    eq('上限 = balance.enhance.maxLevel（用户要求 +1 到 +10）', E.maxEnhance(), rule.maxLevel);
    eq('上限就是 10', rule.maxLevel, 10);
    eq('每级翻倍（growth = 2）', rule.growth, 2);
    eq('+1 要 1 颗（baseStones = 1）', rule.baseStones, 1);
    ok('每级都给主属性加成（statPerLevel > 0）', rule.statPerLevel > 0, String(rule.statPerLevel));
    eq('强化石 100 金币一颗（用户给的价）', BAL.shop.stone.priceGold, 100);
    eq('号角没被顺手改价（还是 500）', BAL.shop.horn.priceGold, 500);
    var costs = [];
    for (var k = 0; k < rule.maxLevel; k += 1) costs.push(E.enhanceCost(k));
    eq('每级成本 = 1,2,4,...,512（用户："+1 一个、+2 两个、+3 四个，依此类推"）', costs.join(','), '1,2,4,8,16,32,64,128,256,512');
    eq('满级后没得升（成本 0）', E.enhanceCost(rule.maxLevel), 0);
    eq('负等级按 0 算（不炸也不白送）', E.enhanceCost(-3), 1);

    /* ---- ② 坏数据：缺字段 / 字符串 / NaN / 负数 / 越界 ---- */
    eq('没有 enhance 字段 = 0 级', E.enhanceLevel({}), 0);
    eq('null = 0 级', E.enhanceLevel(null), 0);
    eq('字符串 = 0 级（改包改不出等级）', E.enhanceLevel({ enhance: '3' }), 0);
    eq('NaN = 0 级', E.enhanceLevel({ enhance: NaN }), 0);
    eq('负数 = 0 级', E.enhanceLevel({ enhance: -4 }), 0);
    eq('超出上限 = 上限', E.enhanceLevel({ enhance: 999 }), rule.maxLevel);
    eq('小数向下取整（2.7 → 2）', E.enhanceLevel({ enhance: 2.7 }), 2);

    /* ---- ③ 加成 / 战力 / 文案：同一个倍率，主属性涨、词条不动 ---- */
    var sword = E.generate(1, 1, new G.RNG.Rng(9), 0);
    eq('刚掉出来的装备是 0 级（generate 里就写死）', sword.enhance, 0);
    var baseMain = sword.main.value;
    var basePower = sword.power;
    var baseAffix = sword.affixes.length ? sword.affixes[0].value : 0;
    var baseAttack = E.totalsOf({ weapon: sword }).attack;
    eq('0 级的强化标记是空串（所有拼接都不用先判断）', E.enhanceTag(sword), '');
    eq('0 级时 labelOf 与以前逐字一样（老断言与老界面都不受影响）', E.labelOf(sword), E.tierById(1).name + ' ' + sword.name);
    eq('applyEnhance 返回新的等级', E.applyEnhance(sword), 1);
    eq('等级写在装备自己身上', E.enhanceLevel(sword), 1);
    eq('主属性数值没被就地改掉（改的是倍率）', sword.main.value, baseMain);
    ok('战力涨了（powerOf 也吃强化）', sword.power > basePower, basePower + ' → ' + sword.power);
    ok('属性汇总按同一个倍率涨（applyTo 与 powerOf 同源）', E.totalsOf({ weapon: sword }).attack > baseAttack, baseAttack + ' → ' + E.totalsOf({ weapon: sword }).attack);
    eq('词条一个字没动', sword.affixes.length ? sword.affixes[0].value : 0, baseAffix);
    eq('强化标记变成 +1', E.enhanceTag(sword), ' +1');
    ok('labelOf 也带上 +1（背包 / 装备槽 / 提示一次到位）', E.labelOf(sword).indexOf(' +1') > 0, E.labelOf(sword));
    eq('下一级要 2 颗', E.nextEnhanceCost(sword), 2);
    while (E.canEnhance(sword)) E.applyEnhance(sword);
    eq('一路升到 +10 就停', E.enhanceLevel(sword), rule.maxLevel);
    eq('满级后再调也还是 10（不越界）', E.applyEnhance(sword), rule.maxLevel);
    eq('满级时 nextEnhanceCost = 0', E.nextEnhanceCost(sword), 0);
    eq('满级主属性倍率 = 1 + 10 x statPerLevel', E.enhanceMul(sword), 1 + rule.maxLevel * rule.statPerLevel);
    eq('canEnhance 对空装备返回 false', E.canEnhance(null), false);

    /* ---- ④ 强化面板：四行 + 石头一行 + 去商城一行 ---- */
    G.PANELS.open('enhance');
    var smithView = {
      save: {
        level: 12,
        gold: 500,
        exp: 0,
        name: '铁匠面板测试者',
        chests: [],
        items: [],
        pity: { epic: 0, mythic: 0 },
        guild: null,
        stones: 3,
        loadout: E.emptyLoadout(),
        settings: { autoBattle: false },
        stats: { kills: 0, eliteKills: 0, opened: 0 }
      },
      player: { x: 0, y: 0, hp: 100, dead: false },
      stats: { power: 0, hpMax: 100 },
      now: 0
    };
    smithView.save.loadout.weapon = E.generate(1, 3, new G.RNG.Rng(21), 0);
    var smithRows = G.PANELS.rows(smithView);
    var smithIds = smithRows.map(function (row) { return row.id; }).join(',');
    ok('强化面板有"强化石 N 颗"那一行', smithIds.indexOf('enhance:stones') >= 0, smithIds);
    ok(
      '四个部位各一行（武器 / 衣服 / 鞋子 / 饰品）',
      smithIds.indexOf('enhance:weapon') >= 0 &&
        smithIds.indexOf('enhance:armor') >= 0 &&
        smithIds.indexOf('enhance:boots') >= 0 &&
        smithIds.indexOf('enhance:trinket') >= 0,
      smithIds
    );
    ok('末尾一行跳去商城买石头', smithIds.indexOf('enhance:shop') >= 0, smithIds);
    var enhanceWeaponRow = rowById(smithRows, 'enhance:weapon');
    ok(
      '穿了装备的那一行可以点（action = enhance + 部位）',
      !!enhanceWeaponRow.action &&
        enhanceWeaponRow.action.type === 'enhance' &&
        enhanceWeaponRow.action.slotId === 'weapon',
      JSON.stringify(enhanceWeaponRow.action)
    );
    ok(
      '行里写清了下一级要几颗、以及强化后的战力',
      enhanceWeaponRow.sub.indexOf('1 颗强化石') >= 0 && enhanceWeaponRow.sub.indexOf('战力') >= 0,
      enhanceWeaponRow.sub
    );
    ok(
      '那一行带装备内观图标（与背包格同一套画法）',
      !!enhanceWeaponRow.icon && enhanceWeaponRow.icon.kind === 'gear',
      JSON.stringify(enhanceWeaponRow.icon)
    );
    var enhanceArmorRow = rowById(smithRows, 'enhance:armor');
    ok(
      '空部位那一行不可点，并直说先去背包穿上',
      enhanceArmorRow.action === null && enhanceArmorRow.sub.indexOf('穿上') >= 0,
      enhanceArmorRow.sub
    );
    smithView.save.stones = 0;
    var brokeRow = rowById(G.PANELS.rows(smithView), 'enhance:weapon');
    ok('石头不够时那一行照样能点（点了会提示还差几颗）', !!brokeRow.action, JSON.stringify(brokeRow.action));
    var maxedItem = E.generate(1, 3, new G.RNG.Rng(21), 0);
    while (E.canEnhance(maxedItem)) E.applyEnhance(maxedItem);
    smithView.save.loadout.weapon = maxedItem;
    var maxedRow = rowById(G.PANELS.rows(smithView), 'enhance:weapon');
    ok('满级那一行不可点，并写明已满级', maxedRow.action === null && maxedRow.sub.indexOf('满级') >= 0, maxedRow.sub);
    smithView.save.loadout.weapon = null;
    var noneRow = rowById(G.PANELS.rows(smithView), 'enhance:weapon');
    ok('没穿装备那一行也画得出来（不炸）', !!noneRow && noneRow.text.indexOf('空') > 0, noneRow ? noneRow.text : 'null');
    var smithCtx = fakeContext();
    G.PANELS.draw(smithCtx, smithView);
    ok('强化面板画得出来', smithCtx.calls.count > 20, 'calls=' + smithCtx.calls.count);
    G.PANELS.close();

    /* ---- ⑤ 两条"改存档"的入口：商城买石头 / 铁匠强化 ---- */
    G.SAVE.clear();
    GAME.boot();
    GAME.beginPlaying('强化入口测试者');
    var save = GAME.state.save;
    eq('开局没有强化石', save.stones, 0);
    save.level = BAL.guild.shopUnlockLevel;
    save.gold = 1000;
    GAME.buyStone();
    eq('买一颗扣 100 金币', save.gold, 900);
    eq('手里有 1 颗', save.stones, 1);
    GAME.buyStone();
    eq('再买一颗还是 100 金币（不是越买越贵）', save.gold, 800);
    save.gold = 0;
    GAME.buyStone();
    eq('金币不够就买不到（数量不变）', save.stones, 2);
    eq('买不起时金币不会被扣成负的', save.gold, 0);
    save.level = BAL.guild.shopUnlockLevel - 1;
    GAME.buyStone();
    eq('没到解锁等级时商城是锁着的', save.stones, 2);

    save.level = 3;
    var worn = E.generate(1, 3, new G.RNG.Rng(31), 0);
    var spare = E.generate(1, 3, new G.RNG.Rng(32), 0);
    save.loadout.weapon = worn;
    save.items = [spare];
    GAME.state.stats = G.PLAYER.statsOf(save.level, save.loadout);
    // 抽到的可能是武器 / 衣服 / 鞋子 / 饰品里任意一件，所以断言按**它自己的主属性**来
    // （主属性 → 属性快照里的字段名只差一个 hp → hpMax）
    var statsKey = worn.main.stat === 'hp' ? 'hpMax' : worn.main.stat;
    var powerBefore = GAME.state.stats.power;
    var mainStatBefore = GAME.state.stats[statsKey];
    save.stones = 1;
    eq('强化 +1 成功', GAME.enhanceItem('weapon'), true);
    eq('石头扣掉了', save.stones, 0);
    eq('等级记在装备上', worn.enhance, 1);
    ok('战力涨了（属性快照跟着重算）', GAME.state.stats.power > powerBefore, powerBefore + ' → ' + GAME.state.stats.power);
    ok(
      '那条主属性也涨了（' + worn.main.stat + '）',
      GAME.state.stats[statsKey] > mainStatBefore,
      mainStatBefore + ' → ' + GAME.state.stats[statsKey]
    );
    eq('背包里那件一个字没动（等级不会被继承）', spare.enhance, 0);
    eq('石头不够时强化被拒', GAME.enhanceItem('weapon'), false);
    eq('被拒时等级没变', worn.enhance, 1);
    eq('被拒时一颗石头也不倒扣', save.stones, 0);
    eq('部位不存在时直接返回 false', GAME.enhanceItem('helmet'), false);
    eq('空部位强化被拒（不花石头）', GAME.enhanceItem('armor'), false);
    save.stones = 5000;
    for (var n = 0; n < 20; n += 1) GAME.enhanceItem('weapon');
    eq('连点 20 次也只到 +' + rule.maxLevel, worn.enhance, rule.maxLevel);
    eq('满级后再点：返回 false（不扣石头）', GAME.enhanceItem('weapon'), false);
    ok('满级后的误点没吃掉石头', save.stones > 0, String(save.stones));
    // 面板发出来的 action 也走同一条路：handleAction({type:'unequip'}) → 20-main 的 unequipSlot
    // （equip / unequip 都没有单独导出：界面永远只发 action，这两条也顺便验了）
    GAME.handleAction({ type: 'unequip', slotId: 'weapon' });
    var backInBag = null;
    for (var b = 0; b < save.items.length; b += 1) {
      if (save.items[b].id === worn.id) backInBag = save.items[b];
    }
    ok(
      '脱下来：等级跟着这件装备走（存在装备身上，不存部位）',
      !!backInBag && backInBag.enhance === rule.maxLevel,
      backInBag ? String(backInBag.enhance) : 'null'
    );
    eq('脱下后那个部位空了', save.loadout.weapon, null);
    GAME.handleAction({ type: 'equip', itemId: worn.id });
    // 注意：equip 会把它放回**它自己的部位**（slotId），而上面是硬塞进 weapon 槽的 —— 所以这里按 slotId 查
    eq('再穿回去：还是 +' + rule.maxLevel, E.enhanceLevel(save.loadout[worn.slotId]), rule.maxLevel);
    save.stones = 5;
    var stonesBeforeEmptyAction = save.stones;
    GAME.handleAction({ type: 'enhance', slotId: 'boots' });
    eq('强化面板的 action 走通（空部位只提示、不扣石头）', save.stones, stonesBeforeEmptyAction);

    /* ---- ⑥ 营地铁匠：摆位 / 距离 / 那枚「锻」键 ---- */
    var smith = G.TERRAIN.smithSpot();
    ok('营地摆位表里有一个铁匠（kind = forge）', !!smith && smith.kind === 'forge', JSON.stringify(smith));
    ok('铁匠站在营地砖地里', !!smith && G.TERRAIN.isInCamp(smith.x, smith.y), smith ? smith.x + ',' + smith.y : 'null');
    ok(
      'talkRadius 是正数（balance.world.camp.smith —— 数值只有那一份）',
      BAL.world.camp.smith.talkRadius > 0,
      String(BAL.world.camp.smith.talkRadius)
    );
    GAME.state.player.x = smith.x + 30;
    GAME.state.player.y = smith.y + 40;
    GAME.state.camera.x = GAME.state.player.x;
    GAME.state.camera.y = GAME.state.player.y;
    ok('走到跟前：nearSmith = true', GAME.nearSmith() === true);
    var smithButton = GAME.smithButton();
    ok(
      '跟前多出一枚「锻」键（挂在铁匠头顶，按相机投影算）',
      !!smithButton && smithButton.id === 'smith' && smithButton.label === '锻' && smithButton.r > 0,
      JSON.stringify(smithButton)
    );
    var nearIds = GAME.uiView().buttons.map(function (btn) { return btn.id; }).join(',');
    ok('这枚键真的进了 uiView 的按钮表（输入层只认那一份）', nearIds.indexOf('smith') >= 0, nearIds);
    GAME.onHudButton('smith');
    eq('点「锻」打开的是强化面板', G.PANELS.panelId(), 'enhance');
    G.PANELS.close();
    GAME.state.player.x = smith.x + BAL.world.camp.smith.talkRadius + 60;
    ok('走远一点：nearSmith = false', GAME.nearSmith() === false);
    eq('走远了那枚键就不见了（野外不会误弹面板）', GAME.smithButton(), null);
    var farIds = GAME.uiView().buttons.map(function (btn) { return btn.id; }).join(',');
    ok('按钮表里也没有 smith', farIds.indexOf('smith') < 0, farIds);

    /* ---- ⑦ 三个界面入口：营地面板的铁匠行 / 商城的强化石行 ---- */
    G.PANELS.open('camp');
    var campRows = G.PANELS.rows(GAME.uiView());
    var campIds = campRows.map(function (row) { return row.id; }).join(',');
    ok('营地面板有铁匠那一行', campIds.indexOf('camp:smith') >= 0, campIds);
    var campSmithRow = rowById(campRows, 'camp:smith');
    ok(
      '那一行点了开的是强化面板（走不到他跟前也能开）',
      !!campSmithRow.action && campSmithRow.action.type === 'open' && campSmithRow.action.panel === 'enhance',
      JSON.stringify(campSmithRow ? campSmithRow.action : null)
    );
    G.PANELS.close();
    G.PANELS.open('shop');
    var shopRows = G.PANELS.rows(GAME.uiView());
    var stoneRow = rowById(shopRows, 'shop:stone');
    ok(
      '商城里有强化石那一行（写着 100 金币）',
      !!stoneRow && stoneRow.text.indexOf(String(BAL.shop.stone.priceGold)) >= 0,
      stoneRow ? stoneRow.text : 'null'
    );
    ok(
      '那一行点了买到的是石头（action = buyStone）',
      !!stoneRow.action && stoneRow.action.type === 'buyStone',
      JSON.stringify(stoneRow ? stoneRow.action : null)
    );
    G.PANELS.close();

    /* ---- ⑧ 背包分页：一页 15 件，拖格子上下翻页 ---- */
    var pagingItems = [];
    for (var p = 0; p < 40; p += 1) {
      pagingItems.push({
        id: p + 1,
        tier: (p % 6) + 1,
        slotId: 'weapon',
        slotName: '武器',
        power: 10 + p,
        reqLevel: 1,
        name: '分页测试剑' + (p + 1),
        look: null,
        enhance: 0,
        main: { stat: 'attack', value: 5 },
        affixes: []
      });
    }
    var layout = BAL.view.panel.layout;
    var pagingView = {
      save: {
        level: 30,
        gold: 0,
        exp: 0,
        name: '分页测试者',
        chests: [],
        items: pagingItems,
        loadout: E.emptyLoadout(),
        pity: { epic: 0, mythic: 0 },
        guild: null,
        stones: 0,
        settings: { autoBattle: false },
        stats: { kills: 0, eliteKills: 0, opened: 0 }
      },
      player: { x: 0, y: 0, hp: 100, dead: false },
      stats: { power: 0, hpMax: 100 },
      skills: { slots: [] },
      now: 0
    };
    function pageItems(list) {
      var out = [];
      for (var q = 0; q < list.length; q += 1) {
        if (list[q].id.indexOf('bag:item:') === 0) out.push(list[q]);
      }
      return out;
    }
    G.PANELS.open('bag');
    var page1 = G.PANELS.rows(pagingView);
    var pageState = G.PANELS.bagScroll();
    eq('一页 15 件（gridColumns x gridRows）', pageState.columns * pageState.visibleRows, 15);
    eq('40 件 = 8 排 → 最多能翻到第 6 排开头', pageState.maxRow, 5);
    eq('打开背包时在第一页', pageState.row, 0);
    var pagingTitle = rowById(page1, 'title:背包');
    ok(
      '标题写清了这一页是哪几排（不再说只列出前 15 件）',
      !!pagingTitle && pagingTitle.sub.indexOf('共 8 排') >= 0 && pagingTitle.sub.indexOf('第 1–3') >= 0,
      pagingTitle ? pagingTitle.sub : 'null'
    );
    var page1Items = pageItems(page1);
    eq('第一页正好 15 件', page1Items.length, 15);
    eq('第一页从第 1 件开始', page1Items[0].id, 'bag:item:1');
    var grid = pageState.gridRect;
    ok('算出了格子那一块（翻页手势的势力范围）', !!grid && grid.w > 0 && grid.h > 0, JSON.stringify(grid));
    var pitch = layout.gridCellHeight + layout.cellGap;
    var midX = grid.x + grid.w / 2;
    G.PANELS.press({ x: midX, y: grid.y + 30 }, pagingView);
    G.PANELS.move({ x: midX, y: grid.y + 30 - pitch * 2 }, pagingView);
    eq('往上拖两行 → 从第 3 排开头开始（bagRow = 2）', G.PANELS.bagScroll().row, 2);
    eq(
      '拖过之后松手不触发任何 action（手指滑过不该把装备穿上）',
      G.PANELS.release({ x: midX, y: grid.y + 30 - pitch * 2 }, pagingView),
      null
    );
    eq('翻页后列的是第 11 件开头（2 排 x 5 列 = 10 件之后）', pageItems(G.PANELS.rows(pagingView))[0].id, 'bag:item:11');
    G.PANELS.press({ x: midX, y: grid.y + 30 }, pagingView);
    G.PANELS.move({ x: midX, y: grid.y + 30 + pitch * 6 }, pagingView);
    eq('往下拖到头：夹回第 1 排', G.PANELS.bagScroll().row, 0);
    G.PANELS.release({ x: midX, y: grid.y + 30 + pitch * 6 }, pagingView);
    G.PANELS.press({ x: midX, y: grid.y + 30 }, pagingView);
    G.PANELS.move({ x: midX, y: grid.y + 30 - pitch * 60 }, pagingView);
    eq('往上拖到底：夹在最后一排开头（8 排 - 3 排 = 第 6 排）', G.PANELS.bagScroll().row, 5);
    G.PANELS.release({ x: midX, y: grid.y + 30 - pitch * 60 }, pagingView);
    var lastPageItems = pageItems(G.PANELS.rows(pagingView));
    eq('最后一页从第 26 件开始（40 件只剩 15 件可列）', lastPageItems[0].id, 'bag:item:26');
    eq('最后一页把剩下的都列出来了', lastPageItems.length, 15);
    var tapRow = rowById(G.PANELS.rows(pagingView), 'bag:item:26');
    var tapPoint = { x: tapRow.x + tapRow.w / 2, y: tapRow.y + tapRow.h / 2 - 4 };
    G.PANELS.press(tapPoint, pagingView);
    var tapAction = G.PANELS.release(tapPoint, pagingView);
    ok('格子上点一下（没拖）= 穿上那一件（老手感没变）', !!tapAction && tapAction.type === 'equip', JSON.stringify(tapAction));
    eq('这一下没改动页码', G.PANELS.bagScroll().row, 5);
    var bagPanelCtx = fakeContext();
    G.PANELS.draw(bagPanelCtx, pagingView);
    ok('翻到最后一页的背包画得出来', bagPanelCtx.calls.count > 40, 'calls=' + bagPanelCtx.calls.count);
    G.PANELS.close();
    G.PANELS.open('bag');
    eq('关掉再打开 → 回到第一页（看最新的装备）', G.PANELS.bagScroll().row, 0);
    G.PANELS.close();

    /* ---- ⑨ 装备变少时页码要夹回来（穿了 / 分解了之后不该停在空页上） ---- */
    G.PANELS.open('bag');
    G.PANELS.rows(pagingView);
    G.PANELS.press({ x: midX, y: grid.y + 30 }, pagingView);
    G.PANELS.move({ x: midX, y: grid.y + 30 - pitch * 60 }, pagingView);
    G.PANELS.release({ x: midX, y: grid.y + 30 - pitch * 60 }, pagingView);
    eq('先翻到最后一页', G.PANELS.bagScroll().row, 5);
    pagingView.save.items = pagingItems.slice(0, 12);
    G.PANELS.rows(pagingView);
    eq('背包只剩 12 件 → 页码夹回第 1 排', G.PANELS.bagScroll().row, 0);
    eq('12 件就一排都不用翻（maxRow = 0）', G.PANELS.bagScroll().maxRow, 0);
    G.PANELS.close();
  }

  function checkCamp() {
    section('营地交互入口：治疗 / 商店 / 传送（A4）');
    var GAME = G.GAME;
    var T = G.TERRAIN;
    between('治疗单价在 0..1 金币/点血', BAL.world.camp.heal.goldPerHp, 0, 1);
    between('营地传送冷却 3~60 秒（短到好用、长到不能刷）', BAL.world.camp.teleportCooldownMs, 3000, 60000);

    G.SAVE.clear();
    GAME.boot();
    GAME.beginPlaying('营地测试者');

    // 出生点不一定在营地里：先传送到营地中心（同时验传送本身）
    GAME.state.player.x = 6000;
    GAME.state.player.y = -6000;
    GAME.state.player.hurtUntil = 0;
    GAME.state.save.camp = { teleportAt: 0, used: false };
    ok('离营地很远时不在营地内', GAME.inCamp() === false);
    ok('传送回营地成功', GAME.teleportCamp() === true);
    eq('传送把人放到营地中心 x', Math.round(GAME.state.player.x), T.campCenter().x);
    eq('传送把人放到营地中心 y', Math.round(GAME.state.player.y), T.campCenter().y);
    ok('回到原点后判定在营地内', GAME.inCamp() === true);
    ok('传送写下了冷却标记', GAME.state.save.camp.used === true && GAME.state.save.camp.teleportAt >= 0);
    ok('冷却内第二次传送被拒', GAME.teleportCamp() === false);

    // 治疗：满血不收钱；掉血后按缺失量收；钱不够不给治
    var player = GAME.state.player;
    var stats = GAME.state.stats;
    player.hp = stats.hpMax;
    var goldBefore = GAME.state.save.gold;
    eq('满血治疗返回 false（不白花钱）', GAME.campHeal(), false);
    eq('满血治疗不扣钱', GAME.state.save.gold, goldBefore);

    player.hp = Math.round(stats.hpMax * 0.25);
    GAME.state.save.gold = 100000;
    var missing = stats.hpMax - player.hp;
    var expectCost = Math.max(BAL.world.camp.heal.minGold, Math.ceil(missing * BAL.world.camp.heal.goldPerHp));
    ok('掉血后能治疗', GAME.campHeal() === true);
    eq('治疗后满血', Math.round(player.hp), stats.hpMax);
    eq('治疗扣了该扣的金币', GAME.state.save.gold, 100000 - expectCost);

    player.hp = 1;
    GAME.state.save.gold = 0;
    eq('金币不够时治疗被拒', GAME.campHeal(), false);
    eq('被拒时血量没变', player.hp, 1);

    // HUD 的「营」按钮只在营地里出现（否则底部那一行会一直多一个键）
    var inside = G.HUD.buttons({ save: GAME.state.save, inCamp: true });
    var outside = G.HUD.buttons({ save: GAME.state.save, inCamp: false });
    // 底部那一行：营地外 5 枚（箱 / 包 / 会 / 设 / 自动），营地里多一枚「营」；
    // 侧边栏的 2 枚（商 / 营）在两种情况下都在，追加在最后 —— 本次改动
    eq('营地内多一个功能键', inside.length, 8);
    eq('营地外的功能键是 7 个（5 枚底部 + 侧边栏 2 枚）', outside.length, 7);
    ok('多出来的那个是「营」', inside[5].id === 'camp' && inside[5].label === '营');
    ok(
      '「营」占最左那个固定槽位（进出营地时其余键一个都不动）',
      inside[5].x < inside[0].x && inside[0].x === outside[0].x && inside[0].y === outside[0].y,
      Math.round(inside[5].x) + ' < ' + Math.round(inside[0].x)
    );
    ok(
      '「营」不伸到屏幕外（gap 收窄到 20 之后的最左那枚键）',
      inside[5].x - inside[5].r >= 0 && inside[4].x === outside[4].x,
      Math.round(inside[5].x - inside[5].r) + ' .. ' + Math.round(inside[4].x + inside[4].r)
    );
    ok(
      '侧边栏两枚键在两种情况下坐标一模一样（它不属于底部那一行）',
      inside[6].id === 'sideShop' &&
        outside[5].id === 'sideShop' &&
        inside[6].x === outside[5].x &&
        inside[6].y === outside[5].y &&
        inside[7].id === 'sideCamp' &&
        outside[6].id === 'sideCamp',
      inside[6].id + '/' + inside[7].id + ' vs ' + outside[5].id + '/' + outside[6].id
    );
    ok('uiView 会带上 inCamp（供 HUD 判断）', GAME.uiView().inCamp === true);

    // 营地面板：治疗 / 商店 / 传送三行都在，而且能画出来
    G.PANELS.open('camp');
    var view = GAME.uiView();
    view.save = GAME.state.save;
    var ids = G.PANELS.rows(view).map(function (row) { return row.id; }).join(',');
    ok('营地面板有治疗行', ids.indexOf('camp:heal') >= 0, ids);
    ok('营地面板有商店行（跳到商城）', ids.indexOf('camp:shop') >= 0, ids);
    ok('营地面板有传送行', ids.indexOf('camp:teleport') >= 0, ids);
    var ctx = fakeContext();
    G.PANELS.draw(ctx, view);
    ok('营地面板能画出来', ctx.calls.count > 20, 'calls=' + ctx.calls.count);
    G.PANELS.close();

    // 传送与治疗都会存档（重开游戏冷却不会被刷掉）
    var reloaded = G.SAVE.load(BAL.season.worldSeed, 1);
    ok('营地冷却标记写进了存档', reloaded.camp.used === true, JSON.stringify(reloaded.camp));

    /* ---------------------------------------------- A6：营地不刷怪（真正的安全区） */

    // ① 生成层照旧有"落在营地里的怪" —— 说明下面那道过滤真的在做事（不是本来就空）
    var genInCamp = 0;
    var genTotal = 0;
    var gx;
    var gy;
    var m;
    for (gx = -2; gx <= 2; gx += 1) {
      for (gy = -2; gy <= 2; gy += 1) {
        var generated = G.SPAWN.buildChunkMonsters(BAL.season.worldSeed, gx, gy);
        genTotal += generated.length;
        for (m = 0; m < generated.length; m += 1) {
          if (T.isInCamp(generated[m].homeX, generated[m].homeY)) genInCamp += 1;
        }
      }
    }
    ok('生成层里确实有落在营地里的怪（过滤不是空转）', genInCamp > 0, genInCamp + ' / ' + genTotal);

    // ② 装载之后：营地里一只怪都不能有；营地外照旧有怪
    GAME.state.player.x = 0;
    GAME.state.player.y = 0;
    GAME.state.player.dead = false;
    GAME.state.player.hp = GAME.state.stats.hpMax;
    GAME.state.camera.x = 0;
    GAME.state.camera.y = 0;
    G.WORLD.ensureChunks(0, 0, 2);
    var loadedMonsters = G.WORLD.allMonsters();
    var loadedInCamp = 0;
    for (m = 0; m < loadedMonsters.length; m += 1) {
      if (T.isInCamp(loadedMonsters[m].homeX, loadedMonsters[m].homeY)) loadedInCamp += 1;
    }
    eq('装载后营地里一只怪都没有', loadedInCamp, 0);
    ok('营地外照样有怪（不是把怪全禁了）', loadedMonsters.length > 0, String(loadedMonsters.length));

    // ③ 屏障：把一只怪摆到营地边上让它"往里挤"，下一步必须被推回安全半径之外并转身回家
    var intruder = loadedMonsters.length > 0 ? loadedMonsters[0] : null;
    if (intruder) {
      intruder.state = 'idle';
      intruder.hp = intruder.hpMax;
      intruder.x = 120;
      intruder.y = 0;
      intruder.knockX = 0;
      intruder.knockY = 0;
      G.WORLD.update(1000 / 60, GAME.state.player, GAME.state.stats, GAME.state.camera, G.SCREEN.width(), G.SCREEN.height());
      var intruderDist = G.CHUNK.distanceToOrigin(intruder.x, intruder.y);
      ok(
        '闯进营地的怪被推回安全半径之外',
        intruderDist >= BAL.world.camp.monsterFreeRadius - 0.001,
        Math.round(intruderDist) + ' / ' + BAL.world.camp.monsterFreeRadius
      );
      eq('而且它转身回家（state = return）', intruder.state, 'return');
    } else {
      ok('闯进营地的怪被推回安全半径之外', false, '装载不到任何怪，跳过');
    }
  }

  /**
   * 技能栏的纯逻辑（用户要求"四个技能栏"，A5）：表结构 / 解锁 / 两道冷却闸门 /
   * 选目标 / 伤害与治疗 / 自动释放的取舍。全部不碰世界，直接构造数据断言。
   * 运行时那一半（真放一次、HUD、特效、存档计数）在 checkSkillsRuntime。
   */
  function checkSkills() {
    section('技能栏：四个技能键 / 冷却 / 自动释放（A5）');
    var SK = G.SKILLS;
    if (!SK || typeof SK.autoChoice !== 'function') {
      ok('G.SKILLS 可用（07-skills.js 已拼入）', false, '拿不到 SKILLS');
      return;
    }

    // 1. 表结构（数字仍然只有 shared\balance.json 一处，决策 #4）
    eq('技能栏 = 4 个（用户要求）', SK.count(), 4);
    between('全局冷却 100~800ms', BAL.skills.globalCooldownMs, 100, 800);
    between('治疗线在 30%~90% 血（自动释放的触发点）', BAL.skills.autoHealRatio, 0.3, 0.9);
    between('技能特效时长 120~600ms', BAL.skills.castEffectMs, 120, 600);
    var ids = [];
    var keys = [];
    var minCooldown = 0;
    var unlockAscending = true;
    var i;
    for (i = 0; i < SK.count(); i += 1) {
      var info = SK.slotAt(i);
      ids.push(info.id);
      keys.push(info.key);
      if (minCooldown === 0 || info.cooldownMs < minCooldown) minCooldown = info.cooldownMs;
      if (i > 0 && info.unlockLevel < SK.slotAt(i - 1).unlockLevel) unlockAscending = false;
      ok('第 ' + (i + 1) + ' 个技能有名 / 有键面字 / 有类型', !!info.name && !!info.key && !!info.type, JSON.stringify(info));
    }
    eq('技能 id 固定（改表要同步改这条）', ids.join(','), 'cleave,mend,pierce,whirl');
    eq('键面字是四个大字（斩 / 疗 / 刺 / 旋）', keys.join(','), '斩,疗,刺,旋');
    ok('冷却都 ≥ 1 秒', minCooldown >= 1000, String(minCooldown));
    ok(
      '全局冷却短于最短的技能冷却（否则小技能会被自己卡住）',
      BAL.skills.globalCooldownMs < minCooldown,
      BAL.skills.globalCooldownMs + ' vs ' + minCooldown
    );
    ok('解锁等级递增（从左到右解锁，正好也是自动释放的顺序）', unlockAscending);
    between('最后一个技能的解锁等级不超过目标等级', SK.slotAt(3).unlockLevel, 1, BAL.progression.targetLevel);
    ok(
      '伤害技倍率 ≥ 1，且穿刺比旋风更狠（单体定位靠数字说话）',
      SK.slotAt(0).damageMul >= 1 && SK.slotAt(2).damageMul > SK.slotAt(3).damageMul && SK.slotAt(3).damageMul >= 1,
      SK.slotAt(0).damageMul + ' / ' + SK.slotAt(2).damageMul + ' / ' + SK.slotAt(3).damageMul
    );
    between('治疗比例在 10%~60%（不能一口回满）', SK.slotAt(1).healRatio, 0.1, 0.6);
    ok(
      '范围技有半径、穿刺有更远的射程',
      SK.reachOf(SK.slotAt(0)) > 0 && SK.reachOf(SK.slotAt(2)) > SK.reachOf(SK.slotAt(0)),
      SK.reachOf(SK.slotAt(0)) + ' / ' + SK.reachOf(SK.slotAt(2))
    );

    // 2. 解锁
    eq('Lv.1 解锁 1 个', SK.unlockedCount(1), 1);
    ok('Lv.1 能放横扫、不能放旋风', SK.unlocked(0, 1) === true && SK.unlocked(3, 1) === false);
    eq('Lv.20 四个全解锁（技能栏全亮）', SK.unlockedCount(20), 4);
    ok(
      '越界序号取不到技能（坏输入不炸）',
      SK.slotAt(9) === null && SK.slotAt(-1) === null && SK.canCast([0], 0, 9, 0, 99).ok === false
    );

    // 3. 两道冷却闸门（自己的冷却 + 全局冷却）
    var cds = [0, 0, 0, 0];
    ok('初始四个技能都能放', SK.canCast(cds, 0, 0, 1000, 20).ok === true);
    var stamped = SK.markCast(cds, 0, 0, 1000);
    eq('放完记下"能再放的时刻" = 现在 + 该技能冷却', stamped.cooldowns[0], 1000 + SK.slotAt(0).cooldownMs);
    eq('同时记下全局冷却', stamped.globalAt, 1000 + BAL.skills.globalCooldownMs);
    eq('公共冷却内放别的技能 → global', SK.canCast(stamped.cooldowns, stamped.globalAt, 3, 1010, 20).reason, 'global');
    eq(
      '公共冷却过了、自己还在冷却 → cooldown',
      SK.canCast(stamped.cooldowns, stamped.globalAt, 0, 1000 + BAL.skills.globalCooldownMs + 10, 20).reason,
      'cooldown'
    );
    ok(
      '公共冷却过了就能放别的技能',
      SK.canCast(stamped.cooldowns, stamped.globalAt, 3, 1000 + BAL.skills.globalCooldownMs, 20).ok === true
    );
    ok('冷却到点就能再放', SK.canCast(stamped.cooldowns, 0, 0, 1000 + SK.slotAt(0).cooldownMs, 20).ok === true);
    eq('等级不够时判定为 locked（提示优先说解锁而不是冷却）', SK.canCast(cds, 0, 3, 99999, 1).reason, 'locked');
    ok('markCast 是纯函数：不动原数组', cds[0] === 0 && cds.length === 4);
    eq('剩余冷却毫秒可读（HUD 要画扇形与读秒）', SK.remainMs(stamped.cooldowns, 0, 1500), 1000 + SK.slotAt(0).cooldownMs - 1500);

    // 4. 选目标
    var aoe = SK.slotAt(0);
    var strike = SK.slotAt(2);
    var close = { id: 1, x: 100, y: 0, radius: 20, state: 'idle' };
    var edge = { id: 2, x: aoe.radius, y: 0, radius: 0, state: 'idle' };
    var beyond = { id: 5, x: aoe.radius + 1, y: 0, radius: 0, state: 'idle' };
    var dead = { id: 3, x: 60, y: 0, radius: 20, state: 'dead' };
    var far = { id: 4, x: 6000, y: 0, radius: 20, state: 'idle' };
    eq('范围技只圈半径内的活怪（边界算上、死的不算）', SK.pickTargets(aoe, 0, 0, [close, edge, beyond, dead, far]).length, 2);
    eq('范围技保住传进来的顺序（确定性）', SK.pickTargets(aoe, 0, 0, [close, edge, dead])[0].id, 1);
    eq('穿刺只打一只', SK.pickTargets(strike, 0, 0, [close, far]).length, 1);
    eq('穿刺打最近的那只', SK.pickTargets(strike, 0, 0, [close, { id: 9, x: 60, y: 0, radius: 0, state: 'idle' }])[0].id, 9);
    eq('射程外一个都不打', SK.pickTargets(strike, 0, 0, [far]).length, 0);
    eq('治疗不选目标（它不走怪）', SK.pickTargets(SK.slotAt(1), 0, 0, [close]).length, 0);

    // 5. 伤害与治疗（都走既有公式，不另写第二份）
    var stats = { attack: 30, damageBonus: 0, critChance: 0, critDamage: 1.5, hpMax: 600 };
    var dummy = { id: 1, defense: 4, radius: 24, state: 'idle' };
    var plain = G.COMBAT.rollDamage(stats.attack, 0, dummy.defense, 0, 1.5, new G.RNG.Rng(1));
    var skillHit = SK.rollDamage(aoe, stats, dummy, new G.RNG.Rng(1));
    ok('技能伤害高于普攻（倍率真的生效）', skillHit.damage > plain.damage, skillHit.damage + ' vs ' + plain.damage);
    eq('同一个随机流 → 同一份伤害（可重放）', SK.rollDamage(aoe, stats, dummy, new G.RNG.Rng(1)).damage, skillHit.damage);
    eq(
      '技能伤害也有"至少 1 点"的底线',
      SK.rollDamage(strike, { attack: 0.1, damageBonus: 0, critChance: 0, critDamage: 1.5 }, { defense: 9999 }, new G.RNG.Rng(1)).damage,
      1
    );
    eq('治疗量 = 生命上限 × healRatio', SK.healAmount(SK.slotAt(1), stats), Math.round(600 * SK.slotAt(1).healRatio));
    ok('生命上限极小时治疗量也至少 1 点', SK.healAmount(SK.slotAt(1), { hpMax: 1 }) >= 1);

    // 6. 自动释放的取舍（纯函数，直接构造视角数据断言）
    eq(
      '自动释放：从左到右挑第一个能用的（横扫）',
      SK.autoChoice({ cooldowns: [0, 0, 0, 0], globalAt: 0, nowMs: 1000, level: 20, hpRatio: 1, x: 0, y: 0, monsters: [close] }),
      0
    );
    eq(
      '范围里没怪就不放伤害技（免得空放白等冷却）',
      SK.autoChoice({ cooldowns: [0, 0, 0, 0], globalAt: 0, nowMs: 1000, level: 1, hpRatio: 1, x: 0, y: 0, monsters: [far] }),
      -1
    );
    eq(
      '满血不放治疗',
      SK.autoChoice({ cooldowns: [99999, 0, 99999, 99999], globalAt: 0, nowMs: 1000, level: 20, hpRatio: 1, x: 0, y: 0, monsters: [] }),
      -1
    );
    eq(
      '掉到治疗线以下就放治疗',
      SK.autoChoice({ cooldowns: [99999, 0, 99999, 99999], globalAt: 0, nowMs: 1000, level: 20, hpRatio: 0.5, x: 0, y: 0, monsters: [] }),
      1
    );
    eq(
      '公共冷却没好时一个都不放',
      SK.autoChoice({ cooldowns: [0, 0, 0, 0], globalAt: 2000, nowMs: 1000, level: 20, hpRatio: 0.5, x: 0, y: 0, monsters: [close] }),
      -1
    );
    eq(
      '自己的冷却里就跳过它、用下一个可用的',
      SK.autoChoice({ cooldowns: [99999, 99999, 0, 0], globalAt: 0, nowMs: 1000, level: 20, hpRatio: 1, x: 0, y: 0, monsters: [close] }),
      2
    );
  }

  /**
   * 技能栏的运行时那一半（A5）：真放一次会怎么结算、自动释放怎么落地、HUD 画不画得出来。
   * 断言点：扣血与账面一致、伤害归属记在我头上（决策 #1）、特效种类正确、两道冷却生效、
   * 存档记次数、四个技能键在屏幕里且不压功能键。
   */
  function checkSkillsRuntime() {
    section('技能栏：真放一次 + 自动释放 + HUD（A5）');
    var GAME = G.GAME;
    if (!GAME || typeof GAME.castSkillSlot !== 'function') {
      ok('G.GAME 可用（20-main.js 已拼入）', false, '拿不到 GAME');
      return;
    }
    G.SAVE.clear();
    GAME.boot();
    GAME.beginPlaying('技能测试者');
    var player = GAME.state.player;
    GAME.state.skillCooldowns = [];
    GAME.state.skillGlobalAt = 0;

    // 1. 视图：四个栏位，Lv.1 只有第一个亮
    var view = GAME.skillView();
    eq('技能栏视图 = 4 个栏位（HUD 要画四个键）', view.slots.length, 4);
    eq('Lv.1 第一个栏位可用（亮着）', view.slots[0].state, 'ready');
    eq('Lv.1 最后一个栏位是锁的', view.slots[3].state, 'lock');
    eq('锁着的栏位没有冷却（画锁，不画读秒）', view.slots[3].cool, 0);

    // 2. 等级不够：点锁着的技能被拒，而且不进冷却（按空不罚）
    eq('等级不够时点锁着的技能 → locked', GAME.castSkillSlot(3).reason, 'locked');
    eq('解锁前不进冷却', GAME.state.skillCooldowns[3] || 0, 0);

    // 3. 真放一次横扫：先站到营地外有怪的地方（A6），再把怪搬到脚边（血拉高，免得被打死影响断言）
    standOutsideCamp(GAME, 7, 7);
    var target = G.WORLD.pickTarget(player);
    ok('附近有怪可以打（技能要有对象）', !!target);
    if (target) {
      target.x = player.x + 40;
      target.y = player.y;
      target.hpMax = 100000;
      target.hp = 100000;
      var damageBefore = target.damageBy[player.id] || 0;
      var cast = GAME.castSkillSlot(0);
      eq('横扫放出去了', cast.ok, true);
      ok('打到至少 1 只（范围技圈到了脚边的怪）', cast.targets >= 1, String(cast.targets));
      var hitDamage = -1;
      var i;
      for (i = 0; i < cast.hits.length; i += 1) {
        if (cast.hits[i].id === target.id) hitDamage = cast.hits[i].damage;
      }
      eq('目标掉的血 = 技能账上的那一下（没有各算一套公式）', 100000 - target.hp, hitDamage);
      ok('伤害归属记在我头上（技能也能拿奖励，决策 #1）', (target.damageBy[player.id] || 0) > damageBefore);
      var effects = G.WORLD.effects();
      var sawRing = false;
      for (i = 0; i < effects.length; i += 1) {
        if (effects[i].kind === 'ring') sawRing = true;
      }
      ok('范围技的特效是 ring（16-render 按 kind 分派）', sawRing, String(effects.length));
      ok('特效数组不超上限（挂机不会堆爆）', effects.length <= BAL.view.slashCap, String(effects.length));
      eq('放完立刻再点同一个 → cooldown', GAME.castSkillSlot(0).reason, 'cooldown');
    }

    // 4. 两道冷却 + 存档计数（与有没有怪无关：判定不过就不放，过了就一定记冷却）
    GAME.state.save.level = 20;
    GAME.state.stats = G.PLAYER.statsOf(20, GAME.state.save.loadout);
    GAME.state.skillCooldowns = [];
    GAME.state.skillGlobalAt = 0;
    eq('20 级四个技能全解锁（技能栏全亮）', GAME.skillView().unlocked, 4);
    eq('20 级放横扫成功', GAME.castSkillSlot(0).ok, true);
    ok('横扫进了冷却（HUD 会画扇形）', GAME.state.skillCooldowns[0] > 0, String(GAME.state.skillCooldowns[0]));
    eq('同一刻连点第二个技能 → global（公共冷却先拦一道）', GAME.castSkillSlot(2).reason, 'global');
    ok('技能次数记在存档里', GAME.state.save.stats.skillCasts >= 1, String(GAME.state.save.stats.skillCasts));
    GAME.writeSave();
    eq(
      '技能次数能读回来（新增字段不影响存档兼容）',
      G.SAVE.load(BAL.season.worldSeed, 1).stats.skillCasts,
      GAME.state.save.stats.skillCasts
    );

    // 5. 治疗：掉血后放疗愈会回血，快满血时不会溢出
    GAME.state.player.hp = 10;
    GAME.state.skillCooldowns = [];
    GAME.state.skillGlobalAt = 0;
    var healAmount = G.SKILLS.healAmount(G.SKILLS.slotAt(1), GAME.state.stats);
    var healCast = GAME.castSkillSlot(1);
    eq('疗愈放出去了', healCast.ok, true);
    eq('回血量 = 生命上限 × 比例', healCast.healed, healAmount);
    eq('血量真的加上去了', Math.round(GAME.state.player.hp), 10 + healAmount);
    ok('治疗不走伤害循环（没有目标也不影响它）', healCast.targets === 0 && healCast.kills === 0);

    GAME.state.player.hp = GAME.state.stats.hpMax - 1;
    GAME.state.skillCooldowns = [];
    GAME.state.skillGlobalAt = 0;
    var capped = GAME.castSkillSlot(1);
    eq('回血不会超过生命上限', Math.round(GAME.state.player.hp), GAME.state.stats.hpMax);
    eq('只回了缺的那一点点（如实记账）', capped.healed, 1);

    // 6. 自动战斗会顺带自动放技能（A4 的需求真正落地）
    GAME.state.save.settings.autoBattle = true;
    GAME.state.skillCooldowns = [];
    GAME.state.skillGlobalAt = 0;
    var castsBefore = GAME.state.save.stats.skillCasts;
    var autoName = '';
    var ticks;
    for (ticks = 0; ticks < 1500 && !autoName; ticks += 1) {
      GAME.step(1000 / 60);
      if (GAME.state.save.stats.skillCasts > castsBefore) autoName = GAME.state.lastSkill;
    }
    ok('自动战斗时会自动放技能', !!autoName, String(autoName));
    ok('自动释放也写冷却（不会每帧连放）', GAME.state.skillCooldowns.length === 4, JSON.stringify(GAME.state.skillCooldowns));
    GAME.state.save.settings.autoBattle = false;

    // 7. HUD：四个技能键、在屏幕里、不压功能键，画得出来
    var hud = {
      save: GAME.state.save,
      skills: GAME.skillView(),
      now: G.WORLD.now()
    };
    hud.buttons = G.HUD.skillButtons(hud);
    eq('HUD 给出 4 个技能键', hud.buttons.length, 4);
    eq(
      '技能键 id = skill0..3（与 onHudButton 的分派一致）',
      hud.buttons.map(function (button) { return button.id; }).join(','),
      'skill0,skill1,skill2,skill3'
    );
    ok('技能键带键面字 / 技能名 / 半径', hud.buttons[0].label.length > 0 && !!hud.buttons[0].name && hud.buttons[0].r > 0);
    ok('四个技能键排在同一行、从左到右', hud.buttons[0].y === hud.buttons[3].y && hud.buttons[0].x < hud.buttons[3].x);
    ok(
      '技能栏整排在屏幕内',
      hud.buttons[0].x - hud.buttons[0].r >= 0 && hud.buttons[3].x + hud.buttons[3].r <= G.SCREEN.width(),
      Math.round(hud.buttons[0].x - hud.buttons[0].r) + ' .. ' + Math.round(hud.buttons[3].x + hud.buttons[3].r)
    );
    // A7：技能栏下沉到屏幕最底，功能图标占它原来那一行
    var functionButtons = G.HUD.buttons({ save: GAME.state.save });
    ok(
      '技能行在功能图标行下面（A7 换位：技能下沉到最底）',
      hud.buttons[0].y - hud.buttons[0].r > functionButtons[0].y + functionButtons[0].r,
      Math.round(hud.buttons[0].y - hud.buttons[0].r) + ' > ' + Math.round(functionButtons[0].y + functionButtons[0].r)
    );
    ok(
      '两行之间刚好空出一行说明（功能键的字 + 技能键的字，谁也不压谁）',
      functionButtons[0].y + functionButtons[0].r + BAL.view.hud.captionGap + G.ICONS.size('captionSize') <=
        hud.buttons[0].y - hud.buttons[0].r - BAL.view.hud.captionGap - BAL.view.skillBar.nameSize,
      Math.round(functionButtons[0].y + functionButtons[0].r) + ' / ' + Math.round(hud.buttons[0].y - hud.buttons[0].r)
    );
    ok(
      '技能栏贴屏幕最底（圆的下沿离经验条只有 barGap）',
      Math.abs(hud.buttons[0].y + hud.buttons[0].r + BAL.view.hud.barGap - G.HUD.expTop()) < 0.01,
      Math.round(hud.buttons[0].y + hud.buttons[0].r) + ' + ' + BAL.view.hud.barGap + ' = ' + Math.round(G.HUD.expTop())
    );
    ok('技能名画在圆上方（A7：下面那一线留给经验条）', hud.buttons[0].captionAbove === true);
    var uiButtons = GAME.uiView().buttons;
    // 功能键 5（营地内 6）+ 侧边栏 2 + 铁匠那枚「锻」（只在跟前才有）+ 勾选框 4 + 技能键 4
    var expectedUiButtons = 4 + 4 + 5 + 2 + (GAME.inCamp() ? 1 : 0) + (GAME.smithButton() ? 1 : 0);
    ok(
      'uiView 把技能键与自动释放勾选框并进同一份按钮表（输入层只认这一份）',
      uiButtons.length === expectedUiButtons,
      String(uiButtons.length) + ' / ' + expectedUiButtons
    );
    eq(
      '按钮表末尾四个就是技能栏',
      uiButtons[uiButtons.length - 4].id + '..' + uiButtons[uiButtons.length - 1].id,
      'skill0..skill3'
    );
    eq(
      '四枚勾选框排在技能键前面（命中取第一个 → 点框不会顺手放技能）',
      uiButtons[uiButtons.length - 8].id + '..' + uiButtons[uiButtons.length - 5].id,
      'skillAuto0..skillAuto3'
    );
    var skillCtx = fakeContext();
    G.HUD.drawButtons(skillCtx, hud);
    ok('技能栏画得出来（含冷却扇形 / 读秒 / 名字）', skillCtx.calls.count > 20, 'calls=' + skillCtx.calls.count);

    // 8. 技能特效在假 canvas 上画得出来 / 过期不画
    var now = G.WORLD.now();
    var ringCtx = fakeContext();
    G.RENDER.drawEffects(
      ringCtx,
      { x: 0, y: 0 },
      [{ kind: 'ring', x: 0, y: 0, dirX: 1, dirY: 0, radius: 210, startAt: now, until: now + BAL.skills.castEffectMs }],
      now
    );
    ok('范围技特效（ring）画得出来', ringCtx.calls.count > 0, 'calls=' + ringCtx.calls.count);
    var boltCtx = fakeContext();
    G.RENDER.drawEffects(
      boltCtx,
      { x: 0, y: 0 },
      [{ kind: 'bolt', x: 0, y: 0, dirX: 1, dirY: 0, radius: 300, startAt: now, until: now + BAL.skills.castEffectMs }],
      now
    );
    ok('穿刺特效（bolt）画得出来', boltCtx.calls.count > 0, 'calls=' + boltCtx.calls.count);
    var mendCtx = fakeContext();
    G.RENDER.drawEffects(
      mendCtx,
      { x: 0, y: 0 },
      [{ kind: 'mend', x: 0, y: 0, dirX: 1, dirY: 0, radius: 96, startAt: now, until: now + BAL.skills.castEffectMs }],
      now
    );
    ok('治疗特效（mend）画得出来', mendCtx.calls.count > 0, 'calls=' + mendCtx.calls.count);
    var expiredCtx = fakeContext();
    G.RENDER.drawEffects(expiredCtx, { x: 0, y: 0 }, [{ kind: 'ring', x: 0, y: 0, radius: 210, startAt: 0, until: 1 }], now);
    eq('过期技能特效不画任何东西（省落笔）', expiredCtx.calls.count, 0);
  }

  /**
   * A10 之一：技能键右上角的「自动释放」勾选（用户要求"给四个技能位置做一个是否自动释放的勾选位置"）。
   *
   * 断言点：默认全开（于是 A5 的行为不变）、老存档 / 坏值不炸、四枚框的几何贴着技能圆（斜对角 ≈ r）、
   * 点框只切换勾选而**不会顺手放技能**（id 前缀的分派顺序）、勾选写进存档、
   * 关掉之后自动战斗真的不再放它、而手动点那个键仍然能放。
   */
  function checkSkillAuto() {
    section('技能自动释放勾选（A10：四个技能位各一枚勾选框）');
    var GAME = G.GAME;
    var SK = G.SKILLS;
    if (!GAME || !SK || typeof GAME.toggleSkillAuto !== 'function') {
      ok('GAME.toggleSkillAuto 可用（20-main 已导出）', false, '拿不到入口');
      return;
    }

    // 1. 存档：默认全开、缺项补齐、坏值不炸
    G.SAVE.clear();
    GAME.boot();
    GAME.beginPlaying('勾选测试');
    eq('新号默认：四个技能都勾上自动释放（A5 的行为一个字都不变）', GAME.skillAutoFlags().join(','), 'true,true,true,true');
    eq('勾选表长度 = 技能表长度', GAME.state.save.settings.skillAuto.length, SK.count());
    eq('老存档没有 skillAuto → 迁移补齐全开', G.SAVE.normalizeSettings({ sfx: true }).skillAuto.join(','), 'true,true,true,true');
    eq('坏值（不是数组）不炸 → 回全开', G.SAVE.normalizeSettings({ skillAuto: 'nope' }).skillAuto.length, SK.count());
    eq('只有明确写了 false 才算关', G.SAVE.normalizeSettings({ skillAuto: [false] }).skillAuto.join(','), 'false,true,true,true');
    eq('缺项当"勾上"（坏数据不该悄悄改玩家的自动释放）', SK.autoEnabled([false], 2), true);
    eq('autoCount 数得对', SK.autoCount([false, true, false, true]), 2);

    // 2. 四枚勾选框的几何：与技能键同一份出处（balance.view.skillBar.autoBox）
    var hud = { save: GAME.state.save, skills: GAME.skillView(), now: G.WORLD.now() };
    var skillButtons = G.HUD.skillButtons(hud);
    var autoButtons = G.HUD.skillAutoButtons(hud);
    eq('HUD 给出四枚勾选框', autoButtons.length, 4);
    eq(
      '勾选框 id = skillAuto0..3（与 onHudButton 的分派一致）',
      autoButtons.map(function (button) { return button.id; }).join(','),
      'skillAuto0,skillAuto1,skillAuto2,skillAuto3'
    );
    ok(
      '框心在技能圆的右上角（+x / −y）',
      autoButtons[0].x > skillButtons[0].x && autoButtons[0].y < skillButtons[0].y,
      Math.round(autoButtons[0].x) + ',' + Math.round(autoButtons[0].y)
    );
    var boxDx = autoButtons[0].x - skillButtons[0].x;
    var boxDy = autoButtons[0].y - skillButtons[0].y;
    var boxDistance = Math.sqrt(boxDx * boxDx + boxDy * boxDy);
    ok(
      '框心正好落在圆周附近（既显眼，又不吃掉圆里的图标）',
      Math.abs(boxDistance - skillButtons[0].r) < skillButtons[0].r * 0.06,
      boxDistance.toFixed(1) + ' vs r=' + skillButtons[0].r
    );
    ok(
      '四枚框整排在屏幕里，而且都在吸底动作栏里（不压摇杆区、不压功能键）',
      autoButtons[0].x - autoButtons[0].r >= 0 &&
        autoButtons[3].x + autoButtons[3].r <= G.SCREEN.width() &&
        autoButtons[0].y - autoButtons[0].r > G.HUD.bottomBarTop(),
      Math.round(autoButtons[0].y - autoButtons[0].r) + ' > ' + Math.round(G.HUD.bottomBarTop())
    );
    var boxView = { save: GAME.state.save, skills: GAME.skillView(), now: G.WORLD.now() };
    boxView.buttons = G.HUD.skillButtons(boxView);
    var boxOnCtx = fakeContext();
    G.HUD.drawButtons(boxOnCtx, boxView);
    boxView.skills.slots[0].auto = false;
    boxView.buttons = G.HUD.skillButtons(boxView);
    var boxOffCtx = fakeContext();
    G.HUD.drawButtons(boxOffCtx, boxView);
    hud.skills.slots[0].auto = true;
    ok(
      '勾上与没勾两条分支都画得出来（对勾 / 「自」）',
      boxOnCtx.calls.count > 20 && boxOffCtx.calls.count > 20,
      'on=' + boxOnCtx.calls.count + ' off=' + boxOffCtx.calls.count
    );
    // 勾选框**只在按钮表里占命中位置**，画法归技能键那一趟（否则会多画 4 个圆按钮压上去，还白花落笔）
    var autoOnly = G.HUD.skillAutoButtons(boxView);
    var bothCtx = fakeContext();
    G.HUD.drawButtons(bothCtx, {
      save: GAME.state.save,
      skills: GAME.skillView(),
      now: G.WORLD.now(),
      buttons: autoOnly.concat(G.HUD.skillButtons(boxView))
    });
    var onlyCtx = fakeContext();
    G.HUD.drawButtons(onlyCtx, {
      save: GAME.state.save,
      skills: GAME.skillView(),
      now: G.WORLD.now(),
      buttons: G.HUD.skillButtons(boxView)
    });
    var boxCost = bothCtx.calls.count - onlyCtx.calls.count;
    eq('勾选框只画一次（按钮表里那 4 个只占命中位置：两张按钮表的落笔数一模一样）', boxCost, 0);

    // 3. 点框 = 切换勾选（不是放技能），而且写进存档
    var castsBeforeAuto = GAME.state.save.stats.skillCasts || 0;
    GAME.onHudButton('skillAuto0');
    eq('点勾选框 → 那个技能关掉自动释放', GAME.skillAutoFlags().join(','), 'false,true,true,true');
    eq('点勾选框没有放技能（前缀先判 skillAuto 的顺序是对的）', GAME.state.save.stats.skillCasts || 0, castsBeforeAuto);
    eq('勾选写进存档（重开还记得）', G.SAVE.load(BAL.season.worldSeed, 1).settings.skillAuto.join(','), 'false,true,true,true');
    eq('skillView 把勾选带给界面', GAME.skillView().slots[0].auto, false);
    eq('autoCount 跟着一起变（调试面板读它）', GAME.skillView().autoCount, 3);
    GAME.onHudButton('skillAuto0');
    eq('再点一下又勾上', GAME.skillAutoFlags().join(','), 'true,true,true,true');
    var threwAuto = '';
    try {
      GAME.onHudButton('skillAuto9');
    } catch (error) {
      threwAuto = String(error && error.message ? error.message : error);
    }
    eq('越界的勾选框 id 不炸', threwAuto, '');

    // 4. 纯逻辑：autoChoice 跳过没勾的技能（没传勾选表 = 全勾，老调用方行为不变）
    var close = { id: 1, x: 60, y: 0, radius: 20, state: 'idle' };
    eq(
      '关掉横扫 → 自动挑下一个能用的（穿刺）',
      SK.autoChoice({ cooldowns: [0, 0, 0, 0], globalAt: 0, nowMs: 1000, level: 20, auto: [false, true, true, true], hpRatio: 1, x: 0, y: 0, monsters: [close] }),
      2
    );
    eq(
      '四个都没勾 → 一个都不放（连治疗也不放）',
      SK.autoChoice({ cooldowns: [0, 0, 0, 0], globalAt: 0, nowMs: 1000, level: 20, auto: [false, false, false, false], hpRatio: 0.2, x: 0, y: 0, monsters: [close] }),
      -1
    );
    eq(
      '没传勾选表 = 全勾',
      SK.autoChoice({ cooldowns: [0, 0, 0, 0], globalAt: 0, nowMs: 1000, level: 20, hpRatio: 1, x: 0, y: 0, monsters: [close] }),
      0
    );

    // 5. 运行时：关掉之后自动战斗不再放它，手动点仍然能放
    GAME.state.save.level = 20;
    GAME.state.stats = G.PLAYER.statsOf(20, GAME.state.save.loadout);
    GAME.state.save.settings.autoBattle = true;
    GAME.state.save.settings.skillAuto = [false, false, false, false];
    GAME.state.skillCooldowns = [];
    GAME.state.skillGlobalAt = 0;
    var ticksBefore = GAME.state.save.stats.skillCasts || 0;
    for (var autoTicks = 0; autoTicks < 300; autoTicks += 1) GAME.step(1000 / 60);
    eq('四个都关掉后，自动战斗不再自动放技能', GAME.state.save.stats.skillCasts || 0, ticksBefore);
    GAME.state.player.dead = false;
    GAME.state.player.hp = GAME.state.stats.hpMax;
    var manual = GAME.castSkillSlot(2);
    ok('手动点那个键照样能放（勾选只管自动释放）', manual.ok === true, JSON.stringify(manual.reason));
    GAME.state.save.settings.autoBattle = false;
    GAME.onHudButton('skillAuto2');
    eq('从勾选框重新勾上', GAME.skillAutoFlags()[2], true);
  }

  /**
   * A11：相机与视角（用户："地图、相机视角还需要优化，需要让地图更加细节，玩家视角更加清晰"）。
   *
   * 断言点：档位切换与持久化（`settings.zoomTier` ↔ `view.cameraTier`）、越界夹取、
   * 装载环跟着档位走、**相机锁定以角色为中心**（A11 之三，用户："视角没有锁定以角色为中心"：
   * 前瞻已关 = 0、跟随是每帧贴合、跑起来相机与玩家逐字节相等、角色画在屏幕正中，
   * 而且逻辑层的玩家坐标一个字节都没被改）、**玩家标记**（屏幕尺寸恒定，与档位无关）、
   * **小地图**（半径永远比一屏宽一点 + 视野框跟着相机与档位走）。
   */
  function checkCamera() {
    section('相机与视角（A11 之三：锁定以角色为中心 / 三档 / 玩家标记 / 小地图视野框）');
    var GAME = G.GAME;
    var R = G.RENDER;
    if (!GAME || typeof GAME.setZoomTier !== 'function' || typeof R.lodBlockTiles !== 'function') {
      ok('GAME.setZoomTier / RENDER.lodBlockTiles 可用（A11 的入口都导出了）', false, '拿不到入口');
      return;
    }
    var savedTier = BAL.view.cameraTier;
    var savedTiles = BAL.view.zoomTiles;
    var tierTotal = BAL.view.cameraTiers.length;
    G.SAVE.clear();
    GAME.boot();
    GAME.beginPlaying('相机测试');
    GAME.state.player.x = 0;
    GAME.state.player.y = 0;

    // 1. 开机时应用存档里的档位（boot 里走的就是 setZoomTier）
    eq('新号默认档 = balance.view.cameraTier（' + BAL.view.cameraTiers[BAL.view.cameraTier].name + '档）', GAME.state.save.settings.zoomTier, BAL.view.cameraTier);
    eq('开机后渲染层倍率 = 默认格数的倍率（A11 之三：默认一屏 ' + BAL.view.zoomTiles + ' 格）', R.zoom(), BAL.view.designWidth / (BAL.view.zoomTiles * BAL.world.tileSize));
    eq('老存档没有 zoomTier → 迁移成默认档', G.SAVE.normalizeSettings({ sfx: true }).zoomTier, BAL.view.cameraTier);
    eq('坏档位（越界）夹到合法范围', G.SAVE.normalizeSettings({ zoomTier: 99 }).zoomTier, tierTotal - 1);

    // 2. 三档都能切：写 view.cameraTier + 写存档 + 倍率跟着变
    var i;
    var seen = [];
    for (i = 0; i < tierTotal; i += 1) {
      GAME.setZoomTier(i, true);
      seen.push(GAME.zoomView().name + ':' + R.zoom());
    }
    ok(
      '三档的倍率逐档变大（档名与倍率对得上）',
      BAL.view.cameraTiers[0].zoom < BAL.view.cameraTiers[1].zoom && BAL.view.cameraTiers[1].zoom < BAL.view.cameraTiers[2].zoom,
      seen.join(' / ')
    );
    eq('越界档位（大）夹到最后一档', GAME.setZoomTier(9, true), tierTotal - 1);
    eq('越界档位（小）夹到第一档', GAME.setZoomTier(-5, true), 0);
    GAME.setZoomTier(2, true);
    eq('切档写回 view.cameraTier（渲染层读的就是它）', BAL.view.cameraTier, 2);
    eq('切档也写进存档（重开还记得）', GAME.state.save.settings.zoomTier, 2);
    var zoomInfo = GAME.zoomView();
    ok(
      'zoomView 给出人话（档名 / 一屏几格 / 一格几 CSS px）',
      !!zoomInfo.name && zoomInfo.tiles > 0 && zoomInfo.tileCssPx > 0,
      JSON.stringify(zoomInfo)
    );

    // 3. 装载环跟着档位走（近档视野小，同样的环就能把屏幕填满）
    var rings = [];
    for (i = 0; i < tierTotal; i += 1) {
      GAME.setZoomTier(i, true);
      rings.push(G.WORLD.loadRing());
    }
    eq(
      '装载环跟着档位走（表里写几就是几）',
      rings.join(','),
      BAL.view.cameraTiers.map(function (tier) { return tier.loadRing; }).join(',')
    );
    GAME.setZoomTiles(BAL.view.zoomTiles, true);

    // 4. A11 之三：**视角锁定以角色为中心**（用户："视角没有锁定以角色为中心"）
    var player = GAME.state.player;
    eq('前瞻关掉了（balance 里的 cameraLookAhead = 0）', BAL.view.cameraLookAhead, 0);
    ok('相机跟随是锁定（cameraLerpPerTick >= 1 = 每逻辑帧直接贴合）', BAL.view.cameraLerpPerTick >= 1, String(BAL.view.cameraLerpPerTick));
    eq('初始前瞻为 0（镜头正对人物）', Math.abs(GAME.state.cameraLook.x) + Math.abs(GAME.state.cameraLook.y), 0);
    var playerXBefore = player.x;
    var stick = G.INPUT.state.stick;
    stick.active = true;
    stick.dx = 1;
    stick.dy = 0;
    stick.magnitude = 1;
    for (i = 0; i < 120; i += 1) GAME.step(1000 / 60);
    stick.active = false;
    stick.dx = 0;
    stick.dy = 0;
    stick.magnitude = 0;
    ok(
      '推满摇杆也不产生前瞻（锁定：前瞻恒为 0，不是"慢慢衰减"）',
      GAME.state.cameraLook.x === 0 && GAME.state.cameraLook.y === 0,
      GAME.state.cameraLook.x + ',' + GAME.state.cameraLook.y
    );
    eq(
      '跑起来相机与玩家**逐字节相等**（镜头不落后）',
      GAME.state.camera.x + ',' + GAME.state.camera.y,
      player.x + ',' + player.y
    );
    ok(
      '锁定只动相机：玩家坐标该走还是走（逻辑没被污染）',
      player.x > playerXBefore,
      Math.round(player.x) + ' > ' + Math.round(playerXBefore)
    );
    var center = R.toScreen(GAME.state.camera, player.x, player.y);
    ok(
      '角色画在屏幕正中（锁定以角色为中心：' + Math.round(G.SCREEN.width() / 2) + ',' + Math.round(G.SCREEN.height() / 2) + '）',
      Math.abs(center.x - G.SCREEN.width() / 2) < 1e-9 && Math.abs(center.y - G.SCREEN.height() / 2) < 1e-9,
      center.x + ',' + center.y
    );
    for (i = 0; i < 900; i += 1) GAME.step(1000 / 60);
    eq(
      '停下来之后照样逐字节贴合（不飘）',
      GAME.state.camera.x + ',' + GAME.state.camera.y,
      player.x + ',' + player.y
    );
    // 自动战斗（镜头朝目标跑）也锁定：A11 那种"朝要打的那只前移"不再有
    var savedAutoBattle = GAME.state.save.settings.autoBattle;
    GAME.state.save.settings.autoBattle = true;
    for (i = 0; i < 120; i += 1) GAME.step(1000 / 60);
    GAME.state.save.settings.autoBattle = savedAutoBattle;
    eq(
      '自动战斗里也锁定（镜头不朝着目标偏）',
      GAME.state.cameraLook.x + ',' + GAME.state.cameraLook.y + '|' + GAME.state.camera.x + ',' + GAME.state.camera.y,
      '0,0|' + player.x + ',' + player.y
    );
    GAME.state.cameraLook.x = 123;
    GAME.state.cameraLook.y = 456;
    GAME.setZoomTier(0, true);
    ok(
      '换档时相机归位（前瞻清零 + 相机贴合玩家）',
      GAME.state.cameraLook.x === 0 && GAME.state.cameraLook.y === 0 && Math.abs(GAME.state.camera.x - GAME.state.player.x) < 1e-9,
      GAME.state.cameraLook.x + ',' + GAME.state.cameraLook.y
    );
    // 5. 玩家标记：屏幕尺寸恒定（与档位无关），死了画成灰的
    var markRadii = [];
    for (i = 0; i < tierTotal; i += 1) {
      GAME.setZoomTier(i, true);
      var markCtx = fakeContext();
      var arcs = [];
      var rawArc = markCtx.arc;
      markCtx.arc = function (x, y, r) {
        arcs.push(r);
        return rawArc.apply(this, arguments);
      };
      R.drawPlayerMark(markCtx, { x: 100, y: 100 }, 0, false);
      var maxR = 0;
      for (var a = 0; a < arcs.length; a += 1) {
        if (arcs[a] > maxR) maxR = arcs[a];
      }
      markRadii.push(Math.round(maxR));
      ok('第 ' + (i + 1) + ' 档：玩家标记画得出来（一圈细环）', markCtx.calls.count > 0, 'calls=' + markCtx.calls.count);
    }
    eq(
      '玩家标记的屏幕尺寸恒定（换档不变：' + BAL.view.playerMarkRadius + ' 设计 px 半径）',
      markRadii.join(','),
      [BAL.view.playerMarkRadius, BAL.view.playerMarkRadius, BAL.view.playerMarkRadius].join(',')
    );
    var deadMarkCtx = fakeContext();
    R.drawPlayerMark(deadMarkCtx, { x: 0, y: 0 }, 0, true);
    ok('倒地时标记照样画（画成灰的：还看得见"我躺哪"）', deadMarkCtx.calls.count > 0, 'calls=' + deadMarkCtx.calls.count);
    var playerLayerCtx = fakeContext();
    R.drawPlayer(playerLayerCtx, { x: 0, y: 0 }, GAME.state.player, GAME.state.stats, 0, null);
    ok('玩家那一层整体画得出来（标记 + 影子 + 身体）', playerLayerCtx.calls.count > 20, 'calls=' + playerLayerCtx.calls.count);

    // 6. 小地图：半径必须装得下整屏；视野框跟着相机与档位走
    var frameWidths = [];
    for (i = 0; i < tierTotal; i += 1) {
      GAME.setZoomTier(i, true);
      var radius = G.HUD.minimapRadius();
      var covered = radius * 2 * G.CHUNK.CHUNK_SIZE;
      var span = G.RENDER.viewRect({ x: 0, y: 0 });
      var need = span.width > span.height ? span.width : span.height;
      ok(
        '第 ' + (i + 1) + ' 档：小地图覆盖 ' + covered + ' 单位 ≥ 一屏的 ' + Math.round(need) + '（横竖都装得下）',
        covered >= need,
        covered + ' vs ' + Math.round(need)
      );
      var frame = G.HUD.minimapViewRect(GAME.uiView());
      frameWidths.push(Math.round(frame.w));
      ok(
        '第 ' + (i + 1) + ' 档：视野框画得进小地图（宽高都不超）',
        frame.w <= BAL.view.minimap.size + 1 && frame.h <= BAL.view.minimap.size + 1,
        Math.round(frame.w) + 'x' + Math.round(frame.h) + ' vs ' + BAL.view.minimap.size
      );
    }
    ok(
      '越拉近视野框越小（屏幕上看到的世界确实变少了）',
      frameWidths[0] > frameWidths[1] && frameWidths[1] > frameWidths[2],
      frameWidths.join(' > ')
    );
    var baseFrame = G.HUD.minimapViewRect(GAME.uiView());
    var savedCameraX = GAME.state.camera.x;
    GAME.state.camera.x = savedCameraX + 400;
    var shiftedFrame = G.HUD.minimapViewRect(GAME.uiView());
    GAME.state.camera.x = savedCameraX;
    ok(
      '视野框跟着相机走（相机前移 → 框也前移）',
      Math.abs(shiftedFrame.x - baseFrame.x) > 1,
      Math.round(baseFrame.x) + ' → ' + Math.round(shiftedFrame.x)
    );

    GAME.setZoomTier(savedTier, true);
    GAME.setZoomTiles(savedTiles, true);
    eq('自检跑完把档位还原（不许把 balance 改坏给后面的组看）', BAL.view.cameraTier, savedTier);
    eq('自检跑完也把缩放轴还原（下一组看到的还是默认那一格数）', BAL.view.zoomTiles, savedTiles);
  }

  /**
   * A11 之二：设置面板里的**视角缩放滚动轴**（用户："玩家设置中添加视角缩放滚动轴，可以缩到16-64"）。
   *
   * 断言点分三层，正好是它要经过的三层：
   *   1. **数值层**：范围就是用户说的 16 ~ 64 格，**默认值 = 用户指定的 22 格**（A11 之三：比近档 32 格
   *      再近一点；22 不是预设档位，档名如实显示「自定义」）；倍率满足唯一的等式 `designWidth / (格数 × tileSize)`；
   *      落在预设档位上时与表里的数**精确相等**（128 / 64 / 32 不漂）；最近的档位跟着走（宏观规格不乱跳）；
   *      越界一律夹回 16 ~ 128。
   *   2. **存档层**：老存档没有 `zoomTiles` → 跟着档位迁移；坏值 / 小数 / 越界各自夹对；
   *      松手（非静默）落盘，**重开还记得**（`GAME.boot` 会把它应用回渲染层）。
   *   3. **界面层**：设置面板里真有这一行（`kind = 'slider'`、落在卡片视口里、读数写得出来）；
   *      按最左 / 最右 = 16 / 64 格；**拖动不吃滚动**；拖动中 `sliderDrag()` 报当前格数；
   *      松手才产出 `{ type: 'setZoomTiles' }`，执行后立刻生效。
   */
  function checkZoomSlider() {
    section('视角缩放滚动轴（A11 之二 / 之三：设置面板里的滑块，默认一屏 22 格，范围 16~64 格）');
    var GAME = G.GAME;
    var R = G.RENDER;
    var config = BAL.view.zoomSlider;
    if (!GAME || typeof GAME.setZoomTiles !== 'function' || typeof G.PANELS.sliderDrag !== 'function') {
      ok('GAME.setZoomTiles / PANELS.sliderDrag 可用（A11 之二的入口都导出了）', false, '拿不到入口');
      return;
    }

    // 1. 数值层：范围 / 口径 / 夹取
    eq('缩放轴范围 = 用户指定的 16 ~ 64 格', config.minTiles + '~' + config.maxTiles, '16~64');
    ok(
      '滑块上限不超过表里最远那一档（一屏 128 格仍由预设提供，不进滑块）',
      config.maxTiles <= BAL.view.cameraTiers[0].tiles,
      config.maxTiles + ' vs ' + BAL.view.cameraTiers[0].tiles
    );
    ok('轨道两端留的余量放得下圆钮（滑到头圆钮也不越出轨道）', config.endPad >= config.knobRadius, config.endPad + ' vs ' + config.knobRadius);

    var savedTier = BAL.view.cameraTier;
    var savedTiles = BAL.view.zoomTiles;
    G.SAVE.clear();
    GAME.boot();
    GAME.beginPlaying('缩放轴测试');
    eq('新号默认缩放轴 = balance.view.zoomTiles（用户指定的 22 格）', GAME.state.save.settings.zoomTiles, BAL.view.zoomTiles);
    eq('开机后渲染层倍率就是这一格数的倍率', R.zoom(), BAL.view.designWidth / (BAL.view.zoomTiles * BAL.world.tileSize));

    // A11 之三：默认值就是用户要的 22 格 —— 而且它一路走到界面上（不是只改了表）
    eq('默认格数 = 用户指定的 22 格', BAL.view.zoomTiles, 22);
    ok(
      '默认 22 格落在滑块范围里（拖到两头都不用改默认）',
      BAL.view.zoomTiles >= config.minTiles && BAL.view.zoomTiles <= config.maxTiles,
      BAL.view.zoomTiles + ' vs ' + config.minTiles + '~' + config.maxTiles
    );
    eq('默认档 = 离默认格数最近的那一档（近档）', GAME.state.save.settings.zoomTier, GAME.nearestZoomTier(BAL.view.zoomTiles));
    ok(
      '默认 22 格不是预设档位 → 档名如实显示「自定义」（不硬套一个「近」）',
      GAME.zoomView().custom === true && GAME.zoomView().name === '自定义',
      GAME.zoomView().name + ' / tiles=' + GAME.zoomView().tiles
    );
    G.PANELS.open('menu');
    var bootRows = G.PANELS.rows(GAME.uiView());
    var bootRow = null;
    for (var k = 0; k < bootRows.length; k += 1) {
      if (bootRows[k].id === 'menu:zoom') bootRow = bootRows[k];
    }
    ok(
      '开机时那一行写的就是默认 22 格（默认值真的走到界面上了）',
      !!bootRow && String(bootRow.valueText).indexOf('一屏 22 格') >= 0,
      bootRow ? bootRow.valueText : '缺这一行'
    );
    G.PANELS.close();

    var i;
    var stepTiles = [config.minTiles, 32, 45, config.maxTiles];
    var mathBad = [];
    for (i = 0; i < stepTiles.length; i += 1) {
      var applied = GAME.setZoomTiles(stepTiles[i], true);
      var expect = BAL.view.designWidth / (stepTiles[i] * BAL.world.tileSize);
      if (applied !== stepTiles[i]) mathBad.push('set ' + stepTiles[i] + ' -> ' + applied);
      if (Math.abs(R.zoom() - expect) > 1e-12) mathBad.push(stepTiles[i] + ' 格: zoom ' + R.zoom() + ' != ' + expect);
      if (Math.abs(R.viewRect({ x: 0, y: 0 }).width - stepTiles[i] * BAL.world.tileSize) > 1e-6) {
        mathBad.push(stepTiles[i] + ' 格: 视野宽不是 ' + stepTiles[i] + ' 格');
      }
    }
    ok('拖到任何一格：倍率 = designWidth / (格数 × tileSize)，视野宽 = 格数 × tileSize', mathBad.length === 0, mathBad.join('; '));

    var exact = true;
    for (i = 0; i < BAL.view.cameraTiers.length; i += 1) {
      GAME.setZoomTiles(BAL.view.cameraTiers[i].tiles, true);
      if (R.zoom() !== BAL.view.cameraTiers[i].zoom) exact = false;
    }
    ok('落在预设档位上时倍率与表里的数**精确相等**（128 / 64 / 32 不会漂成小数）', exact, String(R.zoom()));

    GAME.setZoomTiles(64, true);
    eq('拖到 64 格 → 最近的档位是「中」（宏观规格取中档）', BAL.view.cameraTier, 1);
    eq('正好落在档位上时档名照旧', GAME.zoomView().name, BAL.view.cameraTiers[1].name);
    GAME.setZoomTiles(40, true);
    eq('拖到 40 格（两档之间）→ 最近的档位是「近」', BAL.view.cameraTier, 2);
    eq('两档之间时档名不再冒充一档，显示「自定义」', GAME.zoomView().name, '自定义');
    eq('自定义视角报出的格数就是滑块上的格数', GAME.zoomView().tiles, 40);
    eq(
      '拖到两档之间：存档里的档位也跟着写成最近的档（两个字段永远自洽，不会一个说「中」一个说 40 格）',
      GAME.state.save.settings.zoomTier,
      GAME.nearestZoomTier(40)
    );
    eq(
      '两档之间时宏观色格 / 装载环按最近的档位走（不会每拖一下乱跳）',
      R.lodBlockTiles() + ',' + G.WORLD.loadRing(),
      BAL.view.cameraTiers[2].lodBlockTiles + ',' + BAL.view.cameraTiers[2].loadRing
    );
    eq('越界（3 格）夹到下限', GAME.setZoomTiles(3, true), config.minTiles);
    eq('越界（999 格）夹到上限 = 表里最远那一档', GAME.setZoomTiles(999, true), BAL.view.cameraTiers[0].tiles);

    // 2. 存档层：迁移 / 夹取 / 重开还记得
    GAME.setZoomTiles(64, true);
    eq('老存档没有 zoomTiles → 跟着档位迁移（近档 = 32）', G.SAVE.normalizeSettings({ zoomTier: 2 }).zoomTiles, BAL.view.cameraTiers[2].tiles);
    eq('坏值（字符串）→ 用 balance 里的当前值', G.SAVE.normalizeSettings({ zoomTiles: 'x' }).zoomTiles, BAL.view.zoomTiles);
    eq('越界（3 格）在存档层也夹到下限', G.SAVE.normalizeSettings({ zoomTiles: 3 }).zoomTiles, config.minTiles);
    eq('越界（999 格）在存档层也夹到上限', G.SAVE.normalizeSettings({ zoomTiles: 999 }).zoomTiles, BAL.view.cameraTiers[0].tiles);
    eq('小数取整（37.4 → 37 格：界面上的数永远是整的）', G.SAVE.normalizeSettings({ zoomTiles: 37.4 }).zoomTiles, 37);
    eq('默认设置里就有缩放轴（新号 / 迁移都不会缺字段）', G.SAVE.defaultSettings().zoomTiles, BAL.view.zoomTiles);

    GAME.setZoomTiles(48, false);
    var reloaded = G.SAVE.load(BAL.season.worldSeed, 1);
    eq('松手（非静默）才写存档：一屏 48 格', reloaded.settings.zoomTiles, 48);
    GAME.boot();
    eq('重开还记得缩放轴（boot 把它应用回了渲染层）', BAL.view.zoomTiles, 48);
    eq('重开后倍率还是同一个', R.zoom(), BAL.view.designWidth / (48 * BAL.world.tileSize));
    GAME.beginPlaying('缩放轴测试');

    // 3. 界面层：设置面板里那一行真的能拖
    var view = GAME.uiView();
    G.PANELS.open('menu');
    var vp = G.PANELS.viewport();
    var sliderRow = null;
    var menuRows = G.PANELS.rows(view);
    for (i = 0; i < menuRows.length; i += 1) {
      if (menuRows[i].id === 'menu:zoom') sliderRow = menuRows[i];
    }
    ok('设置面板里有「视角缩放」这一行', !!sliderRow && sliderRow.kind === 'slider', sliderRow ? sliderRow.kind : '缺这一行');
    if (sliderRow) {
      // 行被滚动挡在视口外就先滚进来（真机上玩家也是先滚到它）
      if (sliderRow.y < vp.y || sliderRow.y + sliderRow.h > vp.y + vp.h) {
        G.PANELS.setScroll(G.PANELS.maxScroll(view), view);
        menuRows = G.PANELS.rows(view);
        for (i = 0; i < menuRows.length; i += 1) {
          if (menuRows[i].id === 'menu:zoom') sliderRow = menuRows[i];
        }
      }
      ok(
        '滑块那一行在卡片视口里（用户真的点得到）',
        sliderRow.y >= vp.y - 6 && sliderRow.y + sliderRow.h <= vp.y + vp.h + 6,
        Math.round(sliderRow.y) + '..' + Math.round(sliderRow.y + sliderRow.h) + ' vs ' + Math.round(vp.y) + '..' + Math.round(vp.y + vp.h)
      );
      ok(
        '读数写得出来（一屏 48 格 + 一格几 CSS px）',
        String(sliderRow.valueText).indexOf('一屏 48 格') >= 0 && String(sliderRow.valueText).indexOf('CSS px') > 0,
        sliderRow.valueText
      );
      ok('那一行的副标题写清了范围（16 ~ 64 格）', String(sliderRow.sub).indexOf('16 ~ 64') > 0, sliderRow.sub);

      var trackX = vp.x + 10 + config.endPad;
      var trackW = vp.w - 20 - config.endPad * 2;
      var trackY = sliderRow.y + sliderRow.h / 2;
      var scrollBefore = G.PANELS.scrollOffset();
      G.PANELS.press({ x: trackX, y: trackY }, view);
      var dragLeft = G.PANELS.sliderDrag();
      eq('按在轨道最左 → 立刻是下限 16 格（点轨道就跳到那一点）', dragLeft ? dragLeft.tiles : -1, config.minTiles);
      G.PANELS.move({ x: trackX + trackW, y: trackY }, view);
      eq('往右拖到最右 → 上限 64 格', G.PANELS.sliderDrag().tiles, config.maxTiles);
      eq('拖滑块不吃滚动（卡片内容原地不动）', G.PANELS.scrollOffset(), scrollBefore);
      var dragAction = G.PANELS.release({ x: trackX + trackW, y: trackY }, view);
      ok(
        '松手才产出 action（拖到哪就是哪）',
        !!dragAction && dragAction.type === 'setZoomTiles' && dragAction.tiles === config.maxTiles,
        JSON.stringify(dragAction)
      );
      eq('松手后拖动状态归零', G.PANELS.sliderDrag(), null);
      GAME.handleAction(dragAction);
      eq('松手交出 action → 真机上立刻生效（一屏 64 格）', BAL.view.zoomTiles, config.maxTiles);
      eq('执行 action 也写进存档', GAME.state.save.settings.zoomTiles, config.maxTiles);

      // 点轨道中间 = 跳到中间那一格（不必拖）
      G.PANELS.press({ x: trackX + trackW / 2, y: trackY }, view);
      var midAction = G.PANELS.release({ x: trackX + trackW / 2, y: trackY }, view);
      eq(
        '点轨道正中 → 取中间那一格（16 + (64-16)/2 = 40）',
        midAction ? midAction.tiles : -1,
        Math.round(config.minTiles + (config.maxTiles - config.minTiles) / 2)
      );
    }

    // 画得出来：圆钮按 knobRadius 画（画法与命中共用一份规格）
    var knobRadii = [];
    var sliderCtx = fakeContext();
    var rawArc = sliderCtx.arc;
    sliderCtx.arc = function (x, y, r) {
      knobRadii.push(r);
      return rawArc.apply(this, arguments);
    };
    G.PANELS.draw(sliderCtx, view);
    ok('设置面板（含缩放轴）画得出来', sliderCtx.calls.count > 40, 'calls=' + sliderCtx.calls.count);
    ok('圆钮按 balance 里的 knobRadius 画', knobRadii.indexOf(config.knobRadius) >= 0, knobRadii.join(','));
    G.PANELS.close();

    BAL.view.cameraTier = savedTier;
    BAL.view.zoomTiles = savedTiles;
    eq('自检跑完把缩放轴还原（不许把 balance 改坏给后面的组看）', BAL.view.zoomTiles, savedTiles);
  }

  /**
  /**
   * 装备等阶的发光（用户：给不同等阶的装备添加发光颜色，分别为白色，蓝色，紫色，金色，红色，炫彩）。
   * 只验**本机能验的部分**：颜色表在 balance 且顺序与用户点名的六色一致、画法规格齐全、
   * 有货就发光 / 空位与等级不够的不发光 / 关掉开关退回阶色描边、炫彩随时间换色、
   * 角色预览那束光取身上最高那一阶、图例每一格带自己的阶号、面板画布上真的落了这些笔。
   */
  function checkTierGlow() {
    section('装备等阶发光（用户：白 / 蓝 / 紫 / 金 / 红 / 炫彩）');
    var tiers = BAL.equipment.tiers;
    var config = BAL.view.iconGlow;
    var i;
    if (!config || typeof G.ICONS.tierGlow !== 'function' || typeof G.ICONS.heroGlow !== 'function') {
      ok('balance.view.iconGlow 与 G.ICONS 的发光入口都在（不然界面上只剩阶色描边）', false, '拿不到配置或入口');
      return;
    }

    // 1. 颜色表：在 balance、与用户点名的六色一一对应、末阶是炫彩
    eq('六阶各有一个 glow（一阶一色，末阶一串）', tiers.map(function (t) { return t.glow.length; }).join(','), '1,1,1,1,1,6');
    eq(
      '发光色 = 白 / 蓝 / 紫 / 金 / 红 / 炫彩（用户点名的顺序）',
      tiers.map(function (t) { return t.glow[0]; }).join(','),
      '#ffffff,#3f8cff,#a855f7,#ffd479,#ff4d4d,#ff4d4d'
    );
    var badColor = [];
    for (i = 0; i < tiers.length; i += 1) {
      for (var j = 0; j < tiers[i].glow.length; j += 1) {
        if (!/^#[0-9a-f]{6}$/.test(tiers[i].glow[j])) badColor.push(tiers[i].id + ':' + tiers[i].glow[j]);
      }
    }
    eq('每个发光色都是 #rrggbb 写法（画布认得）', badColor.join(','), '');
    ok('末阶是炫彩（是一串颜色，不是一种）', G.ICONS.tierGlow(6).length >= 3, String(G.ICONS.tierGlow(6).length));
    eq('icons 读的就是 balance 那一份（颜色不许两处各写一套）', G.ICONS.tierGlow(6).join(','), tiers[5].glow.join(','));
    eq('前五阶也转发同一份', G.ICONS.tierGlow(3).join(','), tiers[2].glow.join(','));
    eq(
      '认不出的阶退化成第一阶（99 / 0 都不炸）',
      G.ICONS.tierGlow(99).join(',') + '|' + G.ICONS.tierGlow(0).join(','),
      '#ffffff|#ffffff'
    );

    // 2. 画法规格：尺寸与节奏只在 balance
    ok(
      '发光规格全在 balance.view.iconGlow（代码不写死数字）',
      config.layers >= 2 && config.spreadRatio > 0 && config.alpha > 0 && config.pulseMs > 0 && config.spinMs > 0,
      JSON.stringify(config)
    );
    eq('总开关默认开着（enabled = true）', config.enabled, true);

    // 3. 画：有货就发光、空位 / 等级不够的不发光、关掉开关就退回阶色描边
    var shineCtx = fakeContext();
    eq('发光层数 = balance.view.iconGlow.layers', G.ICONS.glowRing(shineCtx, 0, 0, 44, 6, 0), config.layers);
    ok('发光真的落笔了（每层一条描边）', shineCtx.calls.count >= config.layers * 2, 'calls=' + shineCtx.calls.count);
    var litCtx = fakeContext();
    G.ICONS.frame(litCtx, 0, 0, 44, 6, false, 0);
    var dimCtx = fakeContext();
    G.ICONS.frame(dimCtx, 0, 0, 44, 6, true, 0);
    var savedEnabled = config.enabled;
    config.enabled = false;
    var offCtx = fakeContext();
    G.ICONS.frame(offCtx, 0, 0, 44, 6, false, 0);
    var offDimCtx = fakeContext();
    G.ICONS.frame(offDimCtx, 0, 0, 44, 6, true, 0);
    config.enabled = savedEnabled;
    ok('有装的格子比空位多画发光那几笔', litCtx.calls.count > dimCtx.calls.count, litCtx.calls.count + ' vs ' + dimCtx.calls.count);
    eq('空位 / 等级不够的格子不发光（落笔 = 关掉发光时一样多）', dimCtx.calls.count, offDimCtx.calls.count);
    eq('关掉开关也等于空位的落笔（一个发光笔数都不多）', offCtx.calls.count, dimCtx.calls.count);
    ok('开关是可回滚的：开回来的落笔又比关掉时多', litCtx.calls.count > offCtx.calls.count, litCtx.calls.count + ' vs ' + offCtx.calls.count);
    eq('自检跑完把开关还原（不许改坏给后面的组看）', config.enabled, savedEnabled);

    // 4. 呼吸与炫彩流动（纯函数，逐点断言）
    between('呼吸夹在 [1 - pulseAmp, 1]（最暗到最亮）', G.ICONS.glowPulse(config.pulseMs / 2), 1 - config.pulseAmp - 1e-9, 1);
    ok(
      '周期整数倍处亮度相同（是周期呼吸，不会越走越暗）',
      G.ICONS.glowPulse(0) === G.ICONS.glowPulse(config.pulseMs * 3),
      G.ICONS.glowPulse(0) + ' vs ' + G.ICONS.glowPulse(config.pulseMs * 3)
    );
    ok(
      '一个周期里真的在变（不是恒等式）',
      G.ICONS.glowPulse(0) !== G.ICONS.glowPulse(config.pulseMs / 2),
      G.ICONS.glowPulse(0) + ' vs ' + G.ICONS.glowPulse(config.pulseMs / 2)
    );
    ok('炫彩同一时刻每层颜色不同（三层挂三色）', G.ICONS.glowColorAt(6, 0, 0) !== G.ICONS.glowColorAt(6, 1, 0));
    ok(
      '炫彩随时间换格（过一个 spinMs 就换色）',
      G.ICONS.glowColorAt(6, 0, 0) !== G.ICONS.glowColorAt(6, 0, config.spinMs),
      G.ICONS.glowColorAt(6, 0, 0) + ' vs ' + G.ICONS.glowColorAt(6, 0, config.spinMs)
    );
    ok('炫彩只在末阶那串颜色里取（不跑出颜色表）', tiers[5].glow.indexOf(G.ICONS.glowColorAt(6, 2, config.spinMs * 7)) >= 0);
    ok('单色阶不随时间变（白就是白）', G.ICONS.glowColorAt(1, 0, 0) === G.ICONS.glowColorAt(1, 0, 12345));

    // 5. 角色预览那束光：取身上最高那一阶
    eq('光身板 → 不发光', G.ICONS.lookTier(G.EQUIP.emptyLook()), 0);
    var mixedLook = { weapon: { tier: 2 }, armor: null, boots: { tier: 5 }, trinket: { tier: 1 } };
    eq('四件里取最高那一阶（神话 > 专家）', G.ICONS.lookTier(mixedLook), 5);
    var bareCtx = fakeContext();
    eq('光身板不画光晕（返回 0）', G.ICONS.heroGlow(bareCtx, 0, 0, 70, G.EQUIP.emptyLook(), 0), 0);
    eq('光身板一个圆都不画', bareCtx.calls.count, 0);
    var heroCtx = fakeContext();
    eq('预览给角色画光晕，并返回发光用的阶', G.ICONS.heroGlow(heroCtx, 0, 0, 70, mixedLook, 0), 5);
    ok(
      '光晕真的落笔了（每层 3 笔：beginPath / arc / fill）',
      heroCtx.calls.count >= config.haloLayers * 3,
      'calls=' + heroCtx.calls.count
    );

    // 6. 界面接线：宝箱清单每行带阶号、面板画布上真的落了这些笔
    var GAME = G.GAME;
    if (!GAME || typeof GAME.boot !== 'function') return;
    G.SAVE.clear();
    GAME.boot();
    GAME.beginPlaying('发光测试');
    // 六阶各放一口箱（A13 的清单本来就恒六行；"每阶都有货"= 六行都该发光）
    for (i = 1; i <= 6; i += 1) GAME.state.save.chests.push({ tier: i, level: 9 });
    G.PANELS.open('chest');
    var chestRows = G.PANELS.rows(GAME.uiView());
    var chestTierIds = [];
    for (i = 0; i < chestRows.length; i += 1) {
      if (chestRows[i].id.indexOf('chest:tier:') === 0) chestTierIds.push(chestRows[i].tier);
    }
    eq('宝箱清单每一行都带自己的阶号（发光色从阶号取）', chestTierIds.join(','), '1,2,3,4,5,6');
    var chestCtx = fakeContext();
    G.PANELS.draw(chestCtx, GAME.uiView());
    var chestLit = chestCtx.calls.count;
    config.enabled = false;
    var chestOffCtx = fakeContext();
    G.PANELS.draw(chestOffCtx, GAME.uiView());
    config.enabled = savedEnabled;
    ok('宝箱面板的画布上真的落了发光笔（清单 6 行的小箱）', chestLit > chestOffCtx.calls.count, chestLit + ' vs ' + chestOffCtx.calls.count);

    G.PANELS.close();

    // 7. 背包：四个装备槽 + 背包格都带阶号（发光就按它取），面板也画得出来
    GAME.state.save.items.push({ id: 1, tier: 6, slotId: 'weapon', power: 99, reqLevel: 1, look: null, main: { stat: 'attack', value: 5 }, affixes: [] });
    GAME.state.save.items.push({ id: 2, tier: 1, slotId: 'boots', power: 5, reqLevel: 1, look: null, main: { stat: 'attack', value: 1 }, affixes: [] });
    G.PANELS.open('bag');
    var bagRows = G.PANELS.rows(GAME.uiView());
    var glowCells = 0;
    for (i = 0; i < bagRows.length; i += 1) {
      if ((bagRows[i].kind || 'row') === 'cell' && bagRows[i].tier > 0 && bagRows[i].dim !== true) glowCells += 1;
    }
    ok('背包里有货的格子都带阶号（发光按它取；空位不带）', glowCells >= 2, 'glowing=' + glowCells);
    var bagCtx = fakeContext();
    G.PANELS.draw(bagCtx, GAME.uiView());
    var bagLit = bagCtx.calls.count;
    config.enabled = false;
    var bagOffCtx = fakeContext();
    G.PANELS.draw(bagOffCtx, GAME.uiView());
    config.enabled = savedEnabled;
    G.PANELS.close();
    ok('背包面板的画布上也落了发光笔（背包格 + 有装的装备槽）', bagLit > bagOffCtx.calls.count, bagLit + ' vs ' + bagOffCtx.calls.count);
    ok('背包面板画得出来（新版面 + 发光）', bagLit > 200, 'calls=' + bagLit);
    eq('自检跑完把发光开关还原（enabled = true）', BAL.view.iconGlow.enabled, true);
  }

  /**
   * A10 之二：背包 / 宝箱 / 属性三个面板的新版面。用户的原话就是验收标准：
   * "上方放置角色预览图，预览图四角放四个装备槽，下面三排做背包栏格子，背包栏格子下方显示角色属性"。
   *
   * 断言点照着这句话拆：预览块在不在、四角是不是四个装备槽、背包格是不是三排、属性网格在不在；
   * 再加宝箱的两个大按钮 / 两条保底条 / 六阶宝箱清单（A13：一阶一行 × 数量），以及"大块背景吃不到触摸、
   * 格子只命中自己那一格"这条最容易写错的交互（A10 的面板第一次出现"背景 + 格子"混排）。
   */
  function checkPanelLayout() {
    section('面板版面（A10：背包 / 宝箱 / 属性照参考图重排）');
    var config = BAL.view.panel.layout;
    ok(
      '版面尺寸全在 balance.view.panel.layout（代码不写死数字）',
      !!config && config.gridRows === 3 && config.gridColumns === 5 && config.statColumns === 2 && config.chestTierHeight > 0,
      JSON.stringify(config)
    );

    // 一份"有货"的假存档：4 件穿在身上 + 12 件背包 + 两档箱子 + 保底计数
    var layoutSlots = G.EQUIP.SLOT_IDS;
    var loadout = G.EQUIP.emptyLoadout();
    var i;
    for (i = 0; i < layoutSlots.length; i += 1) {
      loadout[layoutSlots[i]] = {
        id: 100 + i,
        tier: i + 1,
        slotId: layoutSlots[i],
        power: 20 + i,
        reqLevel: 1,
        look: null,
        main: { stat: 'attack', value: 5 },
        affixes: []
      };
    }
    var layoutItems = [];
    for (i = 0; i < 12; i += 1) {
      layoutItems.push({
        id: i + 1,
        tier: (i % 6) + 1,
        slotId: layoutSlots[i % 4],
        power: 10 + i,
        reqLevel: 1,
        look: null,
        main: { stat: 'attack', value: 3 },
        affixes: []
      });
    }
    var save = {
      level: 12,
      gold: 1234,
      exp: 40,
      name: '版面测试者',
      chests: [{ tier: 1, level: 3 }, { tier: 6, level: 9 }],
      items: layoutItems,
      loadout: loadout,
      pity: { epic: 12, mythic: 340 },
      guild: null,
      settings: { autoBattle: false },
      stats: { kills: 0, eliteKills: 0, opened: 0 }
    };
    var layoutSkills = [];
    for (i = 0; i < 4; i += 1) {
      layoutSkills.push({ index: i, name: '技能' + (i + 1), key: '斩', unlocked: true, auto: i !== 3, cool: 0, remainMs: 0 });
    }
    var view = {
      save: save,
      player: { x: 0, y: 0, hp: 100, dead: false },
      stats: { power: 120, hpMax: 900 },
      skills: { level: 12, unlocked: 4, total: 4, autoCount: 3, slots: layoutSkills },
      now: 0
    };

    function firstOf(list, prefix) {
      for (var k = 0; k < list.length; k += 1) {
        if (list[k].id.indexOf(prefix) === 0) return list[k];
      }
      return null;
    }
    function kindCount(list, kind) {
      var total = 0;
      for (var k = 0; k < list.length; k += 1) {
        if ((list[k].kind || 'row') === kind) total += 1;
      }
      return total;
    }

    /* ---- 背包：角色预览（四角四个装备槽）→ 技能条 → 三排背包格 → 属性网格 ---- */
    G.PANELS.open('bag');
    var bagRows = G.PANELS.rows(view);
    var preview = firstOf(bagRows, 'bag:preview');
    ok('背包顶部是角色预览块', !!preview && preview.kind === 'preview' && bagRows[0].id === 'bag:preview');
    ok('预览块自己不吃触摸（点了不会穿透到压在上面的格子）', preview.hit === false);
    var layoutSlotRows = [];
    for (i = 0; i < bagRows.length; i += 1) {
      if (bagRows[i].id.indexOf('bag:slot:') === 0) layoutSlotRows.push(bagRows[i]);
    }
    eq('四角的四个装备槽（武器 / 衣服 / 鞋子 / 饰品）', layoutSlotRows.length, 4);
    ok(
      '四个槽真的落在预览图的四个角',
      layoutSlotRows[0].x < preview.x + preview.w / 2 &&
        layoutSlotRows[1].x > preview.x + preview.w / 2 &&
        layoutSlotRows[0].y < preview.y + preview.h / 2 &&
        layoutSlotRows[2].y > preview.y + preview.h / 2,
      layoutSlotRows.map(function (row) { return Math.round(row.x) + ',' + Math.round(row.y); }).join(' | ')
    );
    eq('三排五列 = 15 个背包格（有货的是真格子，其余画空框）', kindCount(bagRows, 'cell') - 4, 15);
    eq('技能条四个技能（每个带一枚自动释放勾选）', kindCount(bagRows, 'chip'), 4);
    eq('属性网格与属性面板是同一份数据（PLAYER.breakdown）', kindCount(bagRows, 'stat'), G.PLAYER.breakdown(12, loadout).length);
    ok(
      '背包里仍然有「角色属性」入口与一键分解（A6 的入口不丢）',
      !!firstOf(bagRows, 'bag:stat') && !!firstOf(bagRows, 'bag:salvageAll')
    );
    var bagCtx = fakeContext();
    G.PANELS.draw(bagCtx, view);
    ok('背包新版面画得出来（含角色预览）', bagCtx.calls.count > 200, 'calls=' + bagCtx.calls.count);

    // 命中①：预览里角色身上不吃触摸（背景块的 hit: false）
    var heroPoint = { x: preview.x + preview.w / 2, y: preview.y + preview.h / 2 };
    G.PANELS.press(heroPoint, view);
    eq('点预览里角色身上什么都不触发', G.PANELS.release(heroPoint, view), null);
    // 命中②：四角的装备槽（压在预览之上，点得到）
    var slotPoint = { x: layoutSlotRows[0].x + layoutSlotRows[0].w / 2, y: layoutSlotRows[0].y + layoutSlotRows[0].w / 2 };
    G.PANELS.press(slotPoint, view);
    var unequipAction = G.PANELS.release(slotPoint, view);
    ok('点四角的装备槽 → { type: unequip }', !!unequipAction && unequipAction.type === 'unequip', JSON.stringify(unequipAction));
    // 命中③：背包格只命中自己那一格（先把那一排滚进视口 —— 内容本来就比卡片长）
    var bagArea = G.PANELS.viewport();
    var firstCell = firstOf(G.PANELS.buildRows(view), 'bag:item:');
    G.PANELS.setScroll(firstCell.y - bagArea.y - 10, view);
    var scrolledRows = G.PANELS.rows(view);
    var targetCell = null;
    for (i = 0; i < scrolledRows.length; i += 1) {
      if (scrolledRows[i].id.indexOf('bag:item:') === 0 && scrolledRows[i].y + scrolledRows[i].h < bagArea.y + bagArea.h - 6) targetCell = scrolledRows[i];
    }
    ok('滚到背包格那一排后，至少有一格完整落在视口里', !!targetCell);
    var cellPoint = { x: targetCell.x + targetCell.w / 2, y: targetCell.y + 20 };
    var equipAction = G.PANELS.release(cellPoint, view);
    ok('点背包格 → { type: equip }', !!equipAction && equipAction.type === 'equip', JSON.stringify(equipAction));
    G.PANELS.setScroll(0, view);
    /* ---- 宝箱：两个大按钮 → 两条保底条 → 六阶宝箱清单（A13：一阶一行 × 数量）→ 点开箱 ---- */
    G.PANELS.open('chest');
    var chestRows = G.PANELS.rows(view);
    var openOne = firstOf(chestRows, 'chest:open1');
    var openTen = firstOf(chestRows, 'chest:open10');
    ok(
      '两个大按钮（开 1 个 / 开 10 个：一整块能按的板，不再是一行字）',
      !!openOne && !!openTen && openOne.kind === 'button' && openTen.kind === 'button' && openTen.x > openOne.x
    );
    var pityEpic = firstOf(chestRows, 'chest:pityEpic');
    var pityMythic = firstOf(chestRows, 'chest:pityMythic');
    ok('两条保底进度条（不吃触摸，只汇报进度）', !!pityEpic && !!pityMythic && pityEpic.kind === 'bar' && pityEpic.hit === false);
    ok(
      '保底条的进度 = 计数 / 上限',
      Math.abs(pityEpic.ratio - 12 / 50) < 1e-9 && Math.abs(pityMythic.ratio - 340 / 500) < 1e-9,
      pityEpic.ratio + ' / ' + pityMythic.ratio
    );
    // A13（用户："宝箱背包不需要格子，直接放不同等阶宝箱×数量"）：格子与图例换成一阶一行的清单
    var chestListing = [];
    var chestCountSum = 0;
    var chestShareSum = 0;
    for (i = 0; i < chestRows.length; i += 1) {
      if (chestRows[i].id.indexOf('chest:tier:') !== 0) continue;
      chestListing.push(chestRows[i]);
      chestCountSum += chestRows[i].count;
      chestShareSum += chestRows[i].share;
    }
    eq('宝箱清单恒六行（一阶一行，与 balance.chests.tiers 同序）', chestListing.map(function (row) { return row.tier; }).join(','), '1,2,3,4,5,6');
    eq('宝箱背包里再没有格子了（用户：宝箱背包不需要格子）', kindCount(chestRows, 'cell'), 0);
    eq('「× 数量」之和 = 存档里的箱子数', chestCountSum, save.chests.length);
    ok(
      '数量落在它自己那一阶上（普通 1 / 天赐 1，其余 0）',
      chestListing[0].count === 1 && chestListing[5].count === 1 && chestListing[2].count === 0,
      chestListing.map(function (row) { return row.count; }).join(',')
    );
    ok(
      '没有的阶照样占一行，并标成 dim（A12 的"没货不发光"纪律）',
      chestListing[2].icon.dim === true && chestListing[0].icon.dim === false,
      JSON.stringify(chestListing[2].icon)
    );
    ok('掉落占比仍是从权重算出来的（六行加起来 100%）', Math.abs(chestShareSum - 100) < 0.6, chestShareSum.toFixed(2) + '%');
    ok(
      '没有的阶照样占一行，也照样叫得出名字（普通 → 天赐）',
      chestListing[0].text === '普通宝箱' && chestListing[5].text === '天赐宝箱',
      chestListing.map(function (row) { return row.text; }).join(',')
    );
    ok('清单是只读的（不吃触摸：开箱仍然只走上面那两个大按钮）', chestListing[0].hit === false);
    eq('六行清单在卡片里一屏装得下（宝箱面板不用滚）', G.PANELS.maxScroll(view), 0);
    var chestCtx = fakeContext();
    G.PANELS.draw(chestCtx, view);
    ok('宝箱新版面画得出来', chestCtx.calls.count > 200, 'calls=' + chestCtx.calls.count);
    var listingPoint = { x: chestListing[5].x + chestListing[5].w / 2, y: chestListing[5].y + 24 };
    ok('点清单那一行什么都不发生（袋子里的箱子按掉落顺序排，点"传说"开出来的可能是别的阶）', G.PANELS.release(listingPoint, view) === null);
    // A13 与 A12 的交界：清单上"没有的阶"不发光 —— 六阶各一口箱时，发光那几笔比只有一口箱时多
    var glowConfig = BAL.view.iconGlow;
    var glowEnabled = glowConfig.enabled;
    function chestGlowStrokes(targetView) {
      var lit = fakeContext();
      G.PANELS.draw(lit, targetView);
      var litCount = lit.calls.count;
      glowConfig.enabled = false;
      var off = fakeContext();
      G.PANELS.draw(off, targetView);
      glowConfig.enabled = glowEnabled;
      return litCount - off.calls.count;
    }
    var keptChests = save.chests;
    save.chests = [{ tier: 6, level: 9 }];
    var sparseGlow = chestGlowStrokes(view);
    save.chests = [];
    for (i = 1; i <= 6; i += 1) save.chests.push({ tier: i, level: 3 });
    var fullGlow = chestGlowStrokes(view);
    save.chests = [];
    G.PANELS.open('chest');
    ok('背包空的时候清单还在，并给一行"还没有宝箱"的提示', !!firstOf(G.PANELS.rows(view), 'chest:empty'));
    save.chests = keptChests;
    ok('清单上"没有的阶"不发光（六阶都有货比只有一口箱多出五行的光）', fullGlow > sparseGlow * 3, fullGlow + ' vs ' + sparseGlow);
    glowConfig.enabled = glowEnabled;
    G.PANELS.open('chest');
    var openTenAction = G.PANELS.release({ x: openTen.x + openTen.w / 2, y: openTen.y + 20 }, view);
    ok('点「开 10 个」→ { type: openChest, count: 10 }', !!openTenAction && openTenAction.count === 10, JSON.stringify(openTenAction));

    /* ---- A14：清单每行右侧两枚按阶控件（「全开」按钮 + 「自动」勾选）---- */
    // 用户："宝箱可以设置是否自动开启——对应不同等阶不同的开启按钮"
    G.PANELS.open('chest');
    var a14Rows = G.PANELS.rows(view);
    var tierOpens = [];
    var tierAutos = [];
    for (i = 0; i < a14Rows.length; i += 1) {
      if (a14Rows[i].id.indexOf('chest:tierOpen:') === 0) tierOpens.push(a14Rows[i]);
      if (a14Rows[i].id.indexOf('chest:tierAuto:') === 0) tierAutos.push(a14Rows[i]);
    }
    eq('六阶各一枚「全开」按钮（清单六行 → 六个按钮）', tierOpens.length, 6);
    eq('六阶各一枚「自动」勾选', tierAutos.length, 6);
    eq(
      '两枚控件都按阶排（普通 → 天赐，与清单同序）',
      tierOpens.map(function (row) { return row.tier; }).join(','),
      '1,2,3,4,5,6'
    );
    ok(
      '两枚控件都长在**自己那一行**的右端（「全开」在最右，勾选在它左边，勾选左边才是「× 数量」）',
      tierOpens[0].y < tierOpens[1].y &&
        tierAutos[0].y < tierAutos[1].y &&
        tierOpens[0].x > tierAutos[0].x + tierAutos[0].w &&
        tierAutos[0].x - chestListing[0].countRight === 12,
      '全开 x=' + tierOpens[0].x + ' · 勾选 x=' + tierAutos[0].x + ' · 数量右边界=' + chestListing[0].countRight
    );
    ok(
      '六个等阶六种按钮颜色（用户要的"对应不同等阶不同的开启按钮"）',
      tierOpens[0].color === chestListing[0].color &&
        tierOpens[5].color === chestListing[5].color &&
        tierOpens[0].color !== tierOpens[5].color,
      tierOpens
        .map(function (row) { return row.tier + '=' + row.color; })
        .join(' ')
    );
    ok(
      '每一阶的按钮自己知道这一阶有几口箱（点了要开几口）',
      tierOpens[0].count === 1 && tierOpens[5].count === 1 && tierOpens[2].count === 0,
      tierOpens
        .map(function (row) { return row.count; })
        .join(',')
    );
    var openTier1 = G.PANELS.release({ x: tierOpens[0].x + tierOpens[0].w / 2, y: tierOpens[0].y + tierOpens[0].h / 2 }, view);
    ok(
      '点第一阶的「全开」→ { type: openChestTier, tier: 1 }（点哪一阶就开哪一阶）',
      !!openTier1 && openTier1.type === 'openChestTier' && openTier1.tier === 1,
      JSON.stringify(openTier1)
    );
    var openTier6 = G.PANELS.release({ x: tierOpens[5].x + 4, y: tierOpens[5].y + tierOpens[5].h - 4 }, view);
    ok(
      '按在第六阶按钮的边角上也命中同一阶（画与点共用 `tierControls` 那一份几何）',
      !!openTier6 && openTier6.type === 'openChestTier' && openTier6.tier === 6,
      JSON.stringify(openTier6)
    );
    ok(
      '这一阶一口箱子也没有：按钮还在，但**不产出 action**（点了没反应，也不会误开别的阶）',
      tierOpens[2].action === null &&
        G.PANELS.release({ x: tierOpens[2].x + tierOpens[2].w / 2, y: tierOpens[2].y + 20 }, view) === null
    );
    ok(
      '清单行身照旧点不出东西（"按阶开箱"只走那枚显式按钮，不靠点行）',
      G.PANELS.release({ x: tierAutos[0].x - 30, y: tierAutos[0].y + 40 }, view) === null
    );
    var autoPick3 = G.PANELS.release({ x: tierAutos[2].x + tierAutos[2].side / 2, y: tierAutos[2].y + tierAutos[2].side / 2 }, view);
    ok(
      '点「自动」勾选 → { type: toggleChestAuto, tier: 3 }（**空的那一阶也能勾**：先勾上，之后掉出来就自动开）',
      !!autoPick3 && autoPick3.type === 'toggleChestAuto' && autoPick3.tier === 3,
      JSON.stringify(autoPick3)
    );
    eq(
      '老存档没有 settings.chestAuto → 六个勾选全是关的（升级后行为与 A13 一模一样）',
      tierAutos
        .map(function (row) { return row.on ? '1' : '0'; })
        .join(''),
      '000000'
    );
    // 勾选状态跟着存档走：第三阶勾上 → 只有它亮，小标题也报一句"自动 N 阶"
    save.settings.chestAuto = [false, false, true, false, false, false];
    G.PANELS.open('chest');
    var recheckedRows = G.PANELS.rows(view);
    var autoPicks = [];
    for (i = 0; i < recheckedRows.length; i += 1) {
      if (recheckedRows[i].id.indexOf('chest:tierAuto:') === 0) autoPicks.push(recheckedRows[i].on ? '1' : '0');
    }
    eq('勾选状态直接读存档（第三阶勾上 → 只有第三阶亮）', autoPicks.join(''), '001000');
    var chestTitle = firstOf(recheckedRows, 'title:宝箱背包');
    ok(
      '清单小标题补一句"自动 N 阶"（勾了几阶心里有数）',
      !!chestTitle && chestTitle.sub.indexOf('自动 1 阶') > 0,
      chestTitle ? chestTitle.sub : '拿不到小标题'
    );
    delete save.settings.chestAuto;

    /* ---- 属性：抬头 + 一行一张属性卡 ---- */
    G.PANELS.open('stat');
    var statCards = G.PANELS.rows(view);
    ok(
      '属性面板第一块是抬头（头像 + 等级 + 经验条 + 战力）',
      statCards[0].id === 'stat:head' && statCards[0].kind === 'header' && statCards[0].hit === false
    );
    ok('一行一张属性卡（10 项以上）', kindCount(statCards, 'statCard') >= 10, String(kindCount(statCards, 'statCard')));
    var iconless = [];
    var statText = '';
    for (i = 0; i < statCards.length; i += 1) {
      if (statCards[i].kind !== 'statCard') continue;
      if (!statCards[i].iconKey) iconless.push(statCards[i].id);
      statText += statCards[i].text + '/' + statCards[i].sub + '|';
    }
    eq('每张属性卡都带图标名', iconless.length, 0);
    ok('属性面板仍然写清了「装备」加成与「攻击」（A6 的验收点不丢）', statText.indexOf('装备') >= 0 && statText.indexOf('攻击') >= 0);
    var statCtx = fakeContext();
    G.PANELS.draw(statCtx, view);
    ok('属性新版面画得出来', statCtx.calls.count > 200, 'calls=' + statCtx.calls.count);
    G.PANELS.close();

    /* ---- A10 新画的两块：属性图标与角色预览 ---- */
    var breakdown = G.PLAYER.breakdown(12, loadout);
    var missingIcons = [];
    for (i = 0; i < breakdown.length; i += 1) {
      var iconCtx = fakeContext();
      G.ICONS.statIcon(iconCtx, breakdown[i].icon, 0, 0, 40, '#ffffff');
      if (iconCtx.calls.count === 0) missingIcons.push(breakdown[i].label);
    }
    eq('属性定义里的每一项都有画得出来的图标', missingIcons.length, 0);
    var heroCtx = fakeContext();
    G.RENDER.drawHeroPreview(heroCtx, 100, 100, config.heroRadius, G.EQUIP.lookOf(loadout), 0, 0);
    ok('角色预览画得出来（与地图上同一个小人、同一份 look）', heroCtx.calls.count > 30, 'calls=' + heroCtx.calls.count);
    var bareHeroCtx = fakeContext();
    G.RENDER.drawHeroPreview(bareHeroCtx, 100, 100, 40, null, 0, 0);
    ok('光身板（look 为空）也画得出来，不白屏', bareHeroCtx.calls.count > 20, 'calls=' + bareHeroCtx.calls.count);
    var unknownIconCtx = fakeContext();
    G.ICONS.statIcon(unknownIconCtx, '认不出的图标名', 0, 0, 40, '#ffffff');
    ok('认不出的图标名退化成圆环（不留白格）', unknownIconCtx.calls.count > 0, 'calls=' + unknownIconCtx.calls.count);
  }

  /**
   * 界面入口（A5 补的回归网）：**玩家真正会点的每一个入口**都点一遍。
   *
   * 为什么必须单开一组：2026-09-30 真机验收时，"点登录"当场抛 `G.LOGIN.isBusy is not a function` ——
   * 函数写了、也用了，但**漏在 return 的导出清单里**。逻辑断言看不见这种错（自检直接调
   * `beginPlaying`，从来不点登录键），静态检查也看不见（名字在文件里到处都是）。
   * 所以这里改验"**入口存在且能跑通**"：① G.LOGIN 的接口面；② 真走一遍登录 → 创建角色；
   * ③ 把 HUD 上的每一个键（功能键 + 技能键）都按一遍。
   */
  function checkEntryPoints() {
    section('界面入口：登录链路与每个按键（防"函数没导出"这类只在真机上暴露的错）');
    var GAME = G.GAME;
    var login = G.LOGIN;
    if (!GAME || !login) {
      ok('G.GAME / G.LOGIN 可用', false, '拿不到模块');
      return;
    }

    // ① 接口面：20-main 的登录 / 创建角色链路上会调的每一个名字
    var api = [
      'open', 'stageId', 'draftName', 'setDraftName', 'randomName', 'setMessage',
      'setBusy', 'isBusy', 'setHasAccount', 'isArmed', 'rect', 'buttons', 'press', 'release', 'draw'
    ];
    var i;
    var missing = [];
    for (i = 0; i < api.length; i += 1) {
      if (typeof login[api[i]] !== 'function') missing.push(api[i]);
    }
    ok('G.LOGIN 的接口全都导出了（漏一个就等于玩家点不动）', missing.length === 0, missing.join(','));

    // ② 真走一遍：模拟器里点的就是「登录 / 开始游戏」→「创建角色并进入游戏」
    G.SAVE.clear();
    GAME.boot();
    var threw = '';
    try {
      GAME.loginAction();
    } catch (error) {
      threw = String(error && error.message ? error.message : error);
    }
    eq('点「登录 / 开始游戏」不抛异常', threw, '');
    eq('没有角色名时停在创建角色界面', GAME.state.screen, 'createRole');
    ok('创建角色界面上已经有一个建议昵称（模拟器没有键盘也能玩）', login.draftName().length > 0, login.draftName());

    login.setDraftName('');
    try {
      GAME.createRoleAction();
    } catch (error) {
      threw = String(error && error.message ? error.message : error);
    }
    eq('空名字点「创建角色」不抛异常（只提示）', threw, '');
    ok('空名字被拒（还没进游戏）', GAME.state.screen === 'createRole');

    login.setDraftName('入口测试者');
    try {
      GAME.createRoleAction();
    } catch (error) {
      threw = String(error && error.message ? error.message : error);
    }
    eq('填了名字再点「创建角色」不抛异常', threw, '');
    eq('创建成功 → 进入游戏', GAME.state.screen, 'playing');
    eq('角色名写进存档', GAME.state.save.name, '入口测试者');
    ok('账号也登记了（本机注册表里能找到）', G.ACCOUNT.takenLocally('入口测试者'));

    // ③ 每个按键都按一遍（功能键 5~6 个 + 技能键 4 个）
    var view = GAME.uiView();
    var ids = [];
    for (i = 0; i < view.buttons.length; i += 1) ids.push(view.buttons[i].id);
    ok('按钮表里有功能键与技能键', ids.length >= 9 && ids.indexOf('skill0') >= 0, ids.join(','));
    threw = '';
    for (i = 0; i < ids.length; i += 1) {
      try {
        GAME.onHudButton(ids[i]);
      } catch (error) {
        threw = ids[i] + ': ' + String(error && error.message ? error.message : error);
      }
    }
    eq('每个键都能按（不抛异常）', threw, '');
    G.PANELS.close();
  }

  /* ---------------------------------------- 14. 摇杆触发区（A7 修订：让开底栏） */

  /**
   * 用户反馈"摇杆区别压住底部按钮"。这句话的可断言形态是：
   * **触发区的下边 = 吸底动作栏的顶边 `HUD.bottomBarTop()`** —— 于是整条底栏（功能键 / 技能键 / 经验条）
   * 一个点都不在触发区里，而栏上方仍是"整块左下角"。几何只有 `15-input.stickZone()` 一份出处
   * （`tools\hud-preview.mjs` 画的框读的也是它）。
   */
  function checkInput() {
    section('摇杆触发区（避开底部功能栏）');
    var INPUT_ = G.INPUT;
    var SCREEN_ = G.SCREEN;
    var HUD_ = G.HUD;
    var PROBE_X = 40; // 左下角里的一个横坐标（落在触发区宽度内）

    var zone = INPUT_.stickZone();
    var barTop = HUD_.bottomBarTop();
    ok(
      '触发区是矩形 {left,right,top,bottom}',
      !!zone && zone.right > zone.left && zone.bottom > zone.top,
      JSON.stringify(zone)
    );
    eq('左边缘贴屏幕左边', zone.left, 0);
    near('宽度 = 屏宽 × input.zoneWidthRatio', zone.right, SCREEN_.width() * BAL.input.zoneWidthRatio, 0.001);
    near('高度 = 屏高 × input.zoneHeightRatio', zone.bottom - zone.top, SCREEN_.height() * BAL.input.zoneHeightRatio, 0.001);
    near('下边 = 吸底动作栏顶边（唯一出处）', zone.bottom, barTop, 0.001);
    ok('触发区不再一直铺到屏幕最底（用户反馈的那一条）', zone.bottom < SCREEN_.height(), Math.round(zone.bottom) + ' < ' + Math.round(SCREEN_.height()));
    ok(
      '  —— 底栏顶边落在屏幕下半（触发区确实在拇指够得着的地方）',
      barTop > SCREEN_.height() * 0.5 && barTop < SCREEN_.height(),
      Math.round(barTop) + ' / ' + Math.round(SCREEN_.height())
    );

    ok('栏顶上方 1 像素仍是摇杆区', INPUT_.inStickZone(PROBE_X, barTop - 1) === true);
    ok('栏顶往下 1 像素就不算了（点功能键不会顺手推摇杆）', INPUT_.inStickZone(PROBE_X, barTop + 1) === false);

    var functionButtons = HUD_.buttons({ save: { chests: [], items: [], guild: null, settings: { autoBattle: false } } });
    var intruders = [];
    for (var i = 0; i < functionButtons.length; i += 1) {
      // 侧边栏的两枚键**故意**落在触发区里（贴在左边缘中上部，那里正是拇指按得最舒服的位置）：
      // 按钮优先于摇杆（15-input 的 begin 先问 buttonAt），所以"点得到、不会变成推摇杆"；
      // 代价是**贴边没点准**时会起摇杆 —— 与底部那一行"整排退出触发区"的取舍不同，
      // 这里要的是"一眼看得见的常驻侧栏"，见 balance.view.sideBar 的 _readme。
      if (functionButtons[i].kind === 'side') continue;
      if (INPUT_.inStickZone(functionButtons[i].x, functionButtons[i].y)) intruders.push(functionButtons[i].id);
    }
    eq('功能键一个都不在摇杆区里（侧边栏那两枚除外：它们就是要贴在左边缘）', intruders.join(','), '');
    var sideKeys = functionButtons.filter(function (b) { return b.kind === 'side'; });
    eq('侧边栏两枚键确实在触发区里（按钮优先，所以仍然点得到）', sideKeys.length === 2 && INPUT_.inStickZone(sideKeys[0].x, sideKeys[0].y) === true, true);
    ok(
      '整条底栏压在触发区之下（功能键圆上沿 = 底栏顶边）',
      zone.bottom <= functionButtons[0].y - functionButtons[0].r + 0.001,
      Math.round(zone.bottom) + ' <= ' + Math.round(functionButtons[0].y - functionButtons[0].r)
    );
    ok(
      '最下面一行的技能键也在触发区之下',
      zone.bottom <= HUD_.skillRowY() - BAL.view.skillBar.radius + 0.001,
      Math.round(zone.bottom) + ' <= ' + Math.round(HUD_.skillRowY() - BAL.view.skillBar.radius)
    );
    ok('经验条同样在触发区之外', zone.bottom <= HUD_.expTop() + 0.001);
    ok('触发区上边之外不算', INPUT_.inStickZone(PROBE_X, zone.top - 1) === false);
    ok('屏幕外（左边界外）不算', INPUT_.inStickZone(-1, zone.top + 10) === false);
    var insideX = SCREEN_.width() * BAL.input.zoneWidthRatio * 0.5;
    ok(
      '宽度之内（zoneWidthRatio = ' + BAL.input.zoneWidthRatio + '）整条都算',
      INPUT_.inStickZone(insideX, barTop - 1) === true
    );
    ok(
      '宽度之外不算',
      INPUT_.inStickZone(SCREEN_.width() * BAL.input.zoneWidthRatio + 1, barTop - 1) === false
    );

    // 走真输入路径按两下：栏上方起摇杆、栏里"不归输入层管"（按钮由 20-main 分派）
    INPUT_.setButtons([]);
    INPUT_.reset();
    var above = INPUT_.begin({ id: 1, x: PROBE_X, y: barTop - 1 }, 0);
    ok('栏上方按下 → 起摇杆', !!above && above.stick === true, JSON.stringify(above));
    INPUT_.end({ id: 1, x: PROBE_X, y: barTop - 1 });
    var inBar = INPUT_.begin({ id: 2, x: PROBE_X, y: barTop + 1 }, 0);
    ok('栏里按下 → 不归输入层管（不会变成"想点技能却推了摇杆"）', inBar === null, JSON.stringify(inBar));
    INPUT_.reset();
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
      'rect', 'setTransform', 'translate', 'scale', 'rotate', 'clip', 'drawImage'
    ];
    for (var i = 0; i < names.length; i += 1) ctx[names[i]] = noop;
    ctx.measureText = function (text) {
      calls.count += 1;
      return { width: String(text).length * 10 };
    };
    return ctx;
  }

  /**
   * 只数和地表有关的两种落笔：`fill`（色档 / 细纹，攒路径后一次画完）与 `fillRect`（每 chunk 的底色）。
   * A8 省笔档的差别正好就在这两个数上：全细节 = 1 次 fillRect + 最多 6 次 fill / chunk，
   * 省笔档 = 只有 1 次 fillRect。函数声明会提升，所以上面的 checkLook 可以先写后用。
   */
  function countGroundFills(camera) {
    var ctx = fakeContext();
    var fills = 0;
    var rects = 0;
    var rawFill = ctx.fill;
    var rawRect = ctx.fillRect;
    ctx.fill = function () {
      fills += 1;
      return rawFill.apply(this, arguments);
    };
    ctx.fillRect = function () {
      rects += 1;
      return rawRect.apply(this, arguments);
    };
    G.RENDER.drawGround(ctx, camera);
    return { fills: fills, rects: rects, all: ctx.calls.count };
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

    // A11 之三：这条阈值还受**受击顿帧**牵制 —— 顿帧期间 `step` 直接 return，连世界时钟都冻住，
    // 于是面板开着这一秒里挨几下就少几十毫秒（相机不再偏向前进方向后，附近的怪换了，挨的几下也跟着换）。
    // "游戏不停止"的真意是"时钟照走"，所以除了下面这条宽松阈值，再加一条**逐帧对账**的精确断言。
    var worldBefore = world.now();
    G.PANELS.open('menu');
    var advanceExpected = 0;
    for (i = 0; i < 60; i += 1) {
      // 顿帧那一帧 `step` 直接 return（连世界时钟都不推），所以"该走的毫秒"要把它扣掉
      if (!(GAME.state.hitStopMs > 0)) advanceExpected += 1000 / 60;
      GAME.step(1000 / 60);
    }
    ok('面板开着世界照旧推进（游戏不停止）', world.now() > worldBefore + 600, 'Δt=' + Math.round(world.now() - worldBefore));
    near(
      '面板开着时世界时钟走的毫秒 = 没被顿帧冻住的那几帧之和（逐帧对账：既不暂停、也不多走）',
      world.now() - worldBefore,
      advanceExpected,
      1e-9
    );
    log('  info  面板开着的这 1 秒里世界时钟走了 ' + Math.round(world.now() - worldBefore) + 'ms（差额 = 受击顿帧冻住的那些毫秒）');
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
    // A11 之三：活跃区 = 屏幕框 ± 1200 世界单位（14-world 的 activeRect，与视角倍率无关）。
    // 相机以前会朝"前进方向"偏 240 单位，活跃框因此偏向那一侧；改成锁定在角色身上之后两侧的怪都算数，
    // 实测 60 → 62。阈值跟着放到 72 —— 它离"全图都跑 AI"还差着十万八千里。
    ok(
      '活跃怪受"只模拟附近"约束（≤ 72；实测 ' + world.activeMonsterCount() + ' / 已装载 chunk ' + world.loadedChunkCount() + '）',
      world.activeMonsterCount() <= 72,
      String(world.activeMonsterCount())
    );
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
  /**
   * 公会（本次新增）—— 用户要求："创建公会需要自己输入公会名，公会页面显示公会人员，公会等级，公会信息。"
   *
   * 四段：
   *   ① **规则**（11-save 的 `G.GUILD`）：名字与昵称同一套字符规则、等级 = 1 + floor(成员等级之和 /
   *      levelDivisor) 封顶 levelCap、老存档就地升级、坏值一律夹回合法区间；
   *   ② **服务端那份变成本地镜像**（`fromServer`）：ok 才换，remote / syncAt / role 三个本地字段对；
   *   ③ **界面**：没有公会时是"输入名 → 创建（+ 随机名）+ 加入"，有公会时是"等级 + 信息 + 人员表"；
   *   ④ **入口与闸门**：侧边栏两枚键各开各的；建会四道拦截（等级 / 号角 / 名字 / 已有公会）一个都不许漏。
   */
  function checkGuild() {
    section('公会：名字 / 等级 / 人员 / 服务端镜像（本次新增）');
    var rules = BAL.guild;

    /* ① 规则：名字与昵称同一套字符规则 */
    var limits = GUILD.limits();
    eq(
      '公会名长度与昵称同一对数（复用 ACCOUNT.validate 的前提）',
      limits.nameMin === BAL.account.nameMin && limits.nameMax === BAL.account.nameMax,
      true
    );
    eq('公会人数上限就是 balance 里那个数', limits.memberCap, rules.memberCap);
    eq('等级公式的三个数都在 balance 里', limits.levelDivisor === rules.levelDivisor && limits.levelCap === rules.levelCap, true);
    eq('空白会被清掉（"铁血 兄弟会"与"铁血兄弟会"是同一个名字）', GUILD.validate('铁血 兄弟会').name, '铁血兄弟会');
    eq('合法名字通过', GUILD.validate('铁血兄弟会').ok, true);
    eq('空名字不通过', GUILD.validate('').reason, 'empty');
    eq('一个字的太短', GUILD.validate('甲').reason, 'tooShort');
    eq('超过 12 个字太长', GUILD.validate('一二三四五六七八九十十一十二十三').reason, 'tooLong');
    eq('符号非法', GUILD.validate('abc!@#').reason, 'illegal');
    eq('保留名不给用', GUILD.validate('管理员').reason, 'reserved');
    // 关键差别：公会名的唯一性是**全服**的，本机昵称注册表不该拦它
    G.ACCOUNT.remember('占用者甲');
    eq('本机昵称注册表里占用的名字，公会名还能用（唯一性只归服务端管）', GUILD.validate('占用者甲').ok, true);
    eq('失败文案里写的是"公会名"', GUILD.reasonText('tooShort').indexOf('公会名') >= 0, true);

    /* 等级：唯一的一处算法 */
    var lv1 = GUILD.levelFrom(0);
    eq('0 经验 = 1 级', lv1.level, 1);
    eq('1 级时进度条是 0', lv1.pct, 0);
    var lv3 = GUILD.levelFrom(250);
    eq('250 点（= 成员等级之和）= 3 级', lv3.level, 3);
    eq('250 点在 3 级里的进度是 50%', lv3.pct, 0.5);
    eq('经验再多也封顶在 levelCap', GUILD.levelFrom(99999).level, rules.levelCap);
    eq('满级时进度条钉在满格', GUILD.levelFrom(99999).pct, 1);
    eq('坏输入（null）当 0 算', GUILD.levelFrom(null).level, 1);
    eq('成员等级之和按加法算（坏成员当 1 级）', GUILD.sumLevels([{ level: 5 }, { level: 7.9 }, null]), 13.9);

    /* 老存档就地升级 + 坏值夹回 */
    var legacy = GUILD.normalizeRecord({ name: '老会', anchor: { x: 12, y: -8 }, teleportAt: 99 }, { name: '阿甲', level: 30 });
    ok('老存档（只有 name/anchor/teleportAt）也能升级成完整记录', !!legacy && legacy.members.length === 1, JSON.stringify(legacy));
    eq(
      '补出来的第一位就是会长（用"我"的名字与等级）',
      legacy.members[0].name + '/' + legacy.members[0].level + '/' + legacy.members[0].role,
      '阿甲/30/leader'
    );
    eq('锚点原样保留', legacy.anchor.x + ',' + legacy.anchor.y, '12,-8');
    eq('回城冷却原样保留（它在本地，不进服务端）', legacy.teleportAt, 99);
    eq('本机自建的会 remote=false', legacy.remote, false);
    eq('没有名字 = 没有公会', GUILD.normalizeRecord({ anchor: { x: 1, y: 2 } }), null);
    var dirty = GUILD.normalizeRecord(
      {
        name: '脏会',
        level: 999,
        exp: -5,
        members: [{ name: '甲', level: -3 }, { name: '' }, { name: '乙', level: 8, role: 'leader' }]
      },
      { name: '我', level: 1 }
    );
    eq('坏等级被夹回 levelCap', dirty.level, rules.levelCap);
    eq('坏经验被夹回 0', dirty.exp, 0);
    eq('空名字的成员被丢掉（只剩两个）', dirty.members.length, 2);
    eq('负等级当 1 级', dirty.members.filter(function (m) { return m.name === '甲'; })[0].level, 1);
    var many = [];
    for (var mi = 0; mi < rules.memberCap + 10; mi += 1) many.push({ name: '成员' + mi, level: 5 });
    eq('成员表被截到人数上限', GUILD.normalizeRecord({ name: '大会', members: many }).members.length, rules.memberCap);
    var built = GUILD.create('铁血兄弟会', { name: '阿甲', level: 12 }, { x: 3, y: 4 }, 1000);
    eq(
      'create 出的会：我是会长、锚点与建会时间都对',
      built.members[0].role + '/' + built.anchor.x + '/' + built.createdAt + '/' + built.role,
      'leader/3/1000/leader'
    );

    /* ② 服务端那份 → 本地镜像 */
    var serverBody = {
      ok: true,
      role: 'leader',
      guild: {
        id: 'g-1',
        name: '铁血兄弟会',
        level: 3,
        exp: 250,
        expForNext: 100,
        memberCap: rules.memberCap,
        anchor: { x: 100, y: 200 },
        members: [
          { name: '阿甲', level: 12, online: true, role: 'leader' },
          { name: '阿乙', level: 9, online: false, role: 'member' },
          { name: '阿丙', level: 20, online: true, role: 'member' }
        ]
      }
    };
    var mirrored = GUILD.fromServer(serverBody, { name: '阿甲', level: 12 }, 5000);
    ok('服务端那份能变成本地镜像', !!mirrored, JSON.stringify(mirrored));
    eq('镜像记着服务端公会 id', mirrored.id, 'g-1');
    eq('镜像 remote=true（服务端真的有这条公会）', mirrored.remote, true);
    eq('同步时刻记在本地（世界时间）', mirrored.syncAt, 5000);
    eq('等级取服务端那份（3 级）', mirrored.level, 3);
    eq('成员数对得上', mirrored.members.length, 3);
    eq('在线人数数得出来', GUILD.countOnline(mirrored), 2);
    eq('成员摘要一行话', GUILD.memberText(mirrored), '成员 3 / ' + rules.memberCap + ' · 在线 2');
    eq('会长认得出来', (GUILD.leaderOf(mirrored) || {}).name, '阿甲');
    eq('我是不是会长', GUILD.isLeader(mirrored), true);
    eq(
      '人员表顺序：会长第一、其余在线的先、同级按名字',
      GUILD.sortedMembers(mirrored)
        .map(function (m) { return m.name; })
        .join(','),
      '阿甲,阿丙,阿乙'
    );
    eq('ok 不是 true 时不给镜像（保护本机那份）', GUILD.fromServer({ ok: false, guild: serverBody.guild }, { name: '甲' }, 1), null);
    eq('响应里没有 guild 时也不给镜像', GUILD.fromServer({ ok: true }, { name: '甲' }, 1), null);

    /* ③ 界面：没有公会 = 输入名 / 创建 / 加入；有公会 = 等级 / 信息 / 人员 */
    var game = G.GAME;
    var save = game.state.save;
    var before = {
      level: save.level,
      horns: save.horns,
      guild: save.guild,
      x: game.state.player.x,
      y: game.state.player.y
    };
    save.guild = null;
    save.level = rules.unlockLevel;
    save.horns = 1;
    game.state.guild.note = '';
    G.PANELS.setDraftGuildName('');
    G.PANELS.setJoinDraftName('');
    G.PANELS.open('guild');
    var view = game.uiView();
    var rows = G.PANELS.rows(view);
    var ids = rows.map(function (row) { return row.id; }).join(',');
    ok('没有公会时：有一行「公会名」（点它打字）', ids.indexOf('guild:name') >= 0, ids);
    ok('没有公会时：有「创建公会」那一行', ids.indexOf('guild:create') >= 0, ids);
    ok('没有公会时：有「随机取一个名字」兜底', ids.indexOf('guild:randomName') >= 0, ids);
    ok('没有公会时：有「加入公会」那两行', ids.indexOf('guild:joinName') >= 0 && ids.indexOf('guild:join') >= 0, ids);
    ok('没有公会时：有「刷新公会列表」那一行', ids.indexOf('guild:listRefresh') >= 0, ids);
    var nameRow = rows.filter(function (row) { return row.id === 'guild:name'; })[0];
    ok('公会名那一行点下去是「打字」（不是换一个随机的）', nameRow.action.type === 'typeGuildName', JSON.stringify(nameRow.action));
    ok('名字还空着时那一行如实写"还没输入"', nameRow.text.indexOf('还没输入') >= 0, nameRow.text);
    var createRow = rows.filter(function (row) { return row.id === 'guild:create'; })[0];
    ok('「创建公会」那一行点下去是 createGuild', createRow.action.type === 'createGuild', JSON.stringify(createRow.action));
    eq('加入那一行点下去是 joinGuild', rows.filter(function (row) { return row.id === 'guild:join'; })[0].action.type, 'joinGuild');

    /* ④ 入口与闸门：先验四道拦截，再验真的建起来 */
    eq('没输入名字 → 建不了', game.createGuild(), false);
    eq('被拦下时号角一个都没扣', save.horns, 1);
    eq('被拦下时存档里没有公会', save.guild, null);
    G.PANELS.setDraftGuildName('甲');
    eq('名字太短也建不了', game.createGuild(), false);
    G.PANELS.setDraftGuildName('铁血兄弟会');
    save.level = rules.unlockLevel - 1;
    eq('等级不够建不了', game.createGuild(), false);
    save.level = rules.unlockLevel;
    save.horns = 0;
    eq('没有号角建不了', game.createGuild(), false);
    save.horns = 1;
    eq('名字 / 等级 / 号角都够了 → 建会成功（测试环境没有平台网络接口，走本机路径）', game.createGuild(), true);
    eq('建会扣掉一个号角', save.horns, 0);
    ok('存档里真的有公会了', !!(save.guild && save.guild.name === '铁血兄弟会'), JSON.stringify(save.guild));
    eq('会长是我（名字/等级来自存档）', save.guild.members[0].name + '/' + save.guild.members[0].role, save.name + '/leader');
    eq(
      '锚点就是建会时脚下',
      Math.round(save.guild.anchor.x) + ',' + Math.round(save.guild.anchor.y),
      Math.round(before.x) + ',' + Math.round(before.y)
    );
    ok('本机路径下 remote=false（连不上服务端时本机这份就是唯一真相）', save.guild.remote === false);
    ok('建会那一刻给了提示（面板上那行"服务端"说明）', game.state.guild.note.indexOf('本机建立') >= 0, game.state.guild.note);
    eq('草稿在建会成功后清掉', G.PANELS.draftGuildName(), '');
    eq('已经在一个会里时再建一次被拦下（不白扣号角）', game.createGuild(), false);

    // 有公会时的面板：等级 / 信息 / 人员表
    view = game.uiView();
    rows = G.PANELS.rows(view);
    ids = rows.map(function (row) { return row.id; }).join(',');
    ok('有公会时：有「公会等级」那一行', ids.indexOf('guild:level') >= 0, ids);
    ok('有公会时：有「公会信息」那一行（会长 / 我的身份 / 人数）', ids.indexOf('guild:info') >= 0, ids);
    ok('有公会时：有「据点锚点」那一行', ids.indexOf('guild:anchor') >= 0, ids);
    ok('有公会时：有「公会人员」这一块（一人一行）', ids.indexOf('guild:member:0') >= 0, ids);
    ok('有公会时：有「回到公会锚点」与「刷新成员」', ids.indexOf('guild:teleport') >= 0 && ids.indexOf('guild:sync') >= 0, ids);
    ok('有公会时：会长那一行说明"首版不能退会"', ids.indexOf('guild:leaderNote') >= 0, ids);
    var levelRow = rows.filter(function (row) { return row.id === 'guild:level'; })[0];
    ok(
      '等级那一行真的写着等级与升级进度',
      levelRow.text.indexOf('公会等级 Lv.') >= 0 && levelRow.sub.indexOf('成员等级之和') >= 0,
      levelRow.text + ' | ' + levelRow.sub
    );
    var memberRow = rows.filter(function (row) { return row.id === 'guild:member:0'; })[0];
    ok(
      '人员那一行写着会长 + 名字 + 等级 + 在线状态',
      memberRow.text.indexOf('会长') === 0 && memberRow.sub.indexOf('Lv.') >= 0,
      memberRow.text + ' | ' + memberRow.sub
    );
    var ctx = fakeContext();
    G.PANELS.draw(ctx, view);
    ok('公会面板能画出来（没有公会 / 有公会两种都不炸）', ctx.calls.count > 40, 'calls=' + ctx.calls.count);
    G.PANELS.close();

    /* 侧边栏两枚键：各开各的（用户要求：商城在侧边栏，回到营地放在它下面） */
    G.PANELS.close();
    game.onHudButton('sideShop');
    eq('点侧边栏「商」→ 开商城面板', G.PANELS.panelId(), 'shop');
    game.onHudButton('sideShop');
    eq('再点一下同一个键 → 收起来（与底部功能键同一套规矩）', G.PANELS.isOpen(), false);
    // 回到营地：把玩家挪远再点侧边栏那枚键 —— 应当回到营地中心（与营地面板那一行同一条路）
    game.state.player.x = 40000;
    game.state.player.y = -25000;
    game.state.player.hurtUntil = -1;
    save.camp = { teleportAt: 0, used: false };
    game.onHudButton('sideCamp');
    var center = G.TERRAIN.campCenter();
    eq(
      '点侧边栏「营」→ 回到营地中心',
      Math.round(game.state.player.x) + ',' + Math.round(game.state.player.y),
      Math.round(center.x) + ',' + Math.round(center.y)
    );
    ok('回营地这一下写进了存档（重开也刷不掉冷却）', save.camp.used === true, JSON.stringify(save.camp));

    /* 云路径的五条断言：测试环境没有平台网络接口，所以"连不上"这件事本身要表现得克制 */
    eq('测试环境里 guildCloudReady() 是 false（没有平台网络接口就绝不发包）', game.guildCloudReady(), false);
    eq('连不上时 syncGuild 返回 false（不发包、不报错）', game.syncGuild(false), false);
    ok('连不上时给玩家一句人话', game.state.guild.note.indexOf('cloudBase') >= 0, game.state.guild.note);
    eq('连不上时 guildList 也是 false', game.guildList(false), false);
    ok('公会列表拿不到时有说明（面板上那块不会空着不解释）', game.state.guild.listNote.length > 0, game.state.guild.listNote);
    game.state.guild.autoAt = 0;
    game.state.now = 12345;
    G.PANELS.open('guild');
    game.guildAutoSync();
    eq('公会面板开着时自动刷新会记下时间（不是每帧都发包）', game.state.guild.autoAt, 12345);
    game.guildAutoSync();
    game.state.now = 12400;
    game.guildAutoSync();
    eq('间隔没到就不会再发一次（syncIntervalMs 之内的重复调用被挡掉）', game.state.guild.autoAt, 12345);
    G.PANELS.close();
    eq('错误码 → 中文文案：重名', game.guildErrorText({ error: 'name_taken' }), '这个公会名全服已经有人用了，换一个');
    eq('错误码 → 中文文案：人满', game.guildErrorText({ error: 'guild_full' }).indexOf('人满') >= 0, true);
    eq('错误码 → 中文文案：会长不能退', game.guildErrorText({ error: 'owner_cannot_leave' }).indexOf('会长') >= 0, true);
    eq(
      '错误码 → 中文文案：非法名字走 GUILD.reasonText',
      game.guildErrorText({ error: 'invalid_name', reason: 'tooShort' }).indexOf('至少') >= 0,
      true
    );

    /* 存档往返：公会（含成员表）能过一遍读写 */
    SAVE.write(save);
    var reloaded = SAVE.load(BAL.season.worldSeed, 1);
    ok('公会写进存档、读回来还在', !!(reloaded.guild && reloaded.guild.name === '铁血兄弟会'), JSON.stringify(reloaded.guild));
    eq('成员表原样回来', reloaded.guild.members.length, save.guild.members.length);
    eq('会长身份原样回来', reloaded.guild.role, 'leader');
    eq('锚点原样回来', Math.round(reloaded.guild.anchor.x), Math.round(save.guild.anchor.x));

    // 收尾：把这一节改过的状态还回去（后面的自检段还要用这份存档）
    save.guild = before.guild;
    save.level = before.level;
    save.horns = before.horns;
    game.state.player.x = before.x;
    game.state.player.y = before.y;
    game.state.guild.note = '';
    game.state.guild.list = [];
    game.state.guild.listNote = '';
    game.state.guild.autoAt = 0;
    G.PANELS.setDraftGuildName('');
    G.PANELS.setJoinDraftName('');
    G.PANELS.close();
    SAVE.write(save);
  }

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
      checkChestOpen,
      checkChestAuto,
      checkPlayer,
      checkSave,
      checkAccount,
      checkUi,
      checkInput,
      checkMap,
      checkLook,
      checkAuto,
      checkFeel,
      checkAudio,
      checkCamp,
      checkEnhance,
      checkGuild,
      checkSkills,
      checkSkillsRuntime,
      checkSkillAuto,
      checkPanelLayout,
      checkCamera,
      checkZoomSlider,
      checkTierGlow,
      checkEntryPoints
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
    checkChestOpen: checkChestOpen,
    checkChestAuto: checkChestAuto,
    checkPlayer: checkPlayer,
    checkSave: checkSave,
    checkAccount: checkAccount,
    checkUi: checkUi,
    checkInput: checkInput,
    checkAuto: checkAuto,
    checkFeel: checkFeel,
    checkAudio: checkAudio,
    checkCamp: checkCamp,
    checkGuild: checkGuild,
    checkSkills: checkSkills,
    checkSkillsRuntime: checkSkillsRuntime,
    checkSkillAuto: checkSkillAuto,
    checkPanelLayout: checkPanelLayout,
    checkCamera: checkCamera,
    checkTierGlow: checkTierGlow,
    checkEntryPoints: checkEntryPoints,
    checkMap: checkMap,
    checkLook: checkLook,
    runSmoke: runSmoke,
    runAll: runAll
  };
})();
