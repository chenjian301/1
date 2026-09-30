/**
 * 14-world.js —— 世界运行时：chunk 装载 / 怪物 AI / 自动战斗（阶段 A2 新增）
 *
 * 分工（与 02-architecture 的分层一致）：
 *   05-spawn.js 是**函数**：给定坐标算出内容（客户端与将来服务端共用同一份）；
 *   本文件是**状态**：谁活着、血多少、在追谁、何时重生 —— 阶段 A 跑在本地，
 *   阶段 C 整体搬到服务端（决策 #1 的"服务端权威"），客户端只留渲染需要的那一半。
 *
 * 三条设计取舍（写在这里，免得以后被当成"没优化"改掉）：
 *   1. **只模拟附近**：只有距玩家约 1200 单位内的怪跑 AI，远处的怪原样待着 ——
 *      这是手机的 CPU 预算，也正是将来服务端"没人订阅的区块不模拟"的同一套想法；
 *   2. **chunk 状态可丢弃**：玩家离开某 chunk 超过 `world.chunkIdleDropMs`（2 分钟）或
 *      总数超过 `view.chunkCacheLimit` 就按 LRU 丢掉，回来时**按坐标重新生成**。
 *      因为内容是坐标的函数，重生成的结果与第一次逐位一致（决策 #1 的前提）；
 *   3. **两条随机流分开**：世界生成只认 chunk 哈希（必须可复现），
 *      战斗/掉落/装备生成用本文件的运行时流 —— 混用会让地图不再可复现。
 */

G.WORLD = (function () {
  'use strict';

  var BAL = G.BAL;
  var CHUNK = G.CHUNK;
  var TERRAIN = G.TERRAIN;
  var SPAWN = G.SPAWN;
  var COMBAT = G.COMBAT;
  var PLAYER = G.PLAYER;

  /** 世界种子（赛季常量） */
  var seed = BAL.season.worldSeed;

  /** 运行时随机流：战斗、掉落、装备生成都从这里取（与地图生成流分开，见文件头第 3 条） */
  var rng = new G.RNG.Rng(G.RNG.hash32(seed, 0xa11ce));

  /** 已装载的 chunk：key → 状态 */
  var chunks = {};

  /** LRU 顺序（先装载的在前面） */
  var order = [];

  /** 飘字与弹道（表现层数据，因为要和伤害结算同帧产生，所以放在这里） */
  var damageNumbers = [];
  var projectiles = [];

  /** 斩击特效（A4 打击感）：同样是与结算同帧产生的表现层数据，不参与任何随机流 */
  var effects = [];

  /** 当前逻辑时间（毫秒，由 update 累加）—— 不用 Date.now，逻辑才可重放 */
  var nowMs = 0;

  /** 本帧视野（update 传入，供渲染与 AI 共用同一份） */
  var view = { x: 0, y: 0, w: BAL.view.designWidth, h: 1600 };

  function reset(worldSeed) {
    if (typeof worldSeed === 'number') seed = worldSeed;
    rng = new G.RNG.Rng(G.RNG.hash32(seed, 0xa11ce));
    chunks = {};
    order = [];
    damageNumbers = [];
    projectiles = [];
    effects = [];
    nowMs = 0;
  }

  function setView(camera, screenW, screenH) {
    view.x = camera.x;
    view.y = camera.y;
    view.w = screenW;
    view.h = screenH;
  }

  /** 活跃区：屏幕矩形往四边各扩 1200，只有落在这里面的怪才跑 AI（文件头取舍 #1） */
  function activeRect() {
    var margin = 1200;
    return {
      minX: view.x - view.w / 2 - margin,
      minY: view.y - view.h / 2 - margin,
      maxX: view.x + view.w / 2 + margin,
      maxY: view.y + view.h / 2 + margin
    };
  }

  /* ---------------------------------------------------------------- chunk 装载 */

  function loadChunk(cx, cy) {
    var key = CHUNK.chunkKeyOf(cx, cy);
    var band = SPAWN.chunkCenterBand(cx, cy);
    var spawned = SPAWN.buildChunkMonsters(seed, cx, cy);
    var monsters = [];
    for (var i = 0; i < spawned.length; i += 1) {
      var source = spawned[i];
      monsters.push({
        id: source.id,
        cx: source.cx,
        cy: source.cy,
        slot: source.slot,
        kindId: source.kindId,
        name: source.name,
        level: source.level,
        band: source.band,
        elite: source.elite,
        homeX: source.homeX,
        homeY: source.homeY,
        x: source.x,
        y: source.y,
        hpMax: source.hpMax,
        hp: source.hpMax,
        attack: source.attack,
        defense: source.defense,
        radius: source.radius,
        speed: source.speed,
        attackRange: source.attackRange,
        attackIntervalMs: source.attackIntervalMs,
        ranged: source.ranged,
        aggroRange: source.aggroRange,
        leashRange: source.leashRange,
        respawnMs: source.respawnMs,
        state: 'idle',
        attackAt: 0,
        respawnAt: 0,
        wanderAt: 0,
        wanderX: 0,
        wanderY: 0,
        /** 朝向（表现用；由 moveToward / 攻击分支更新） */
        dirX: 0,
        dirY: 1,
        knockX: 0,
        knockY: 0,
        hurtUntil: 0,
        damageBy: {},
        firstHitAt: undefined,
        firstHitBy: undefined
      });
    }
    chunks[key] = {
      cx: cx,
      cy: cy,
      band: band,
      decor: TERRAIN.buildChunkDecor(seed, cx, cy, band),
      monsters: monsters,
      lastSeenAt: nowMs
    };
    order.push(key);
    return chunks[key];
  }

  function unloadChunk(key) {
    // 状态直接丢弃：内容是坐标的函数，回来时按同样规则重新生成
    delete chunks[key];
    var index = order.indexOf(key);
    if (index >= 0) order.splice(index, 1);
  }

  /**
   * 保证玩家所在 chunk 周围 ring 圈已装载，并清理"太久没看"与超出上限的 chunk。
   * ring 默认 = `view.loadRingChunks`（预载一圈，跨 chunk 时画面才不空）。
   */
  function ensureChunks(px, py, ring) {
    if (!(ring >= 0)) ring = BAL.view.loadRingChunks;
    var center = CHUNK.chunkOfWorld(px, py);
    var wanted = {};
    var dx;
    var dy;
    var key;
    for (dy = -ring; dy <= ring; dy += 1) {
      for (dx = -ring; dx <= ring; dx += 1) {
        key = CHUNK.chunkKeyOf(center.cx + dx, center.cy + dy);
        wanted[key] = true;
        if (chunks[key]) chunks[key].lastSeenAt = nowMs;
        else loadChunk(center.cx + dx, center.cy + dy);
      }
    }

    // 1) 看不见超过 chunkIdleDropMs 的卸掉（文档 §5：离开该 chunk 2 分钟后状态丢弃）
    var keys = order.slice();
    for (var i = 0; i < keys.length; i += 1) {
      var chunk = chunks[keys[i]];
      if (!chunk) continue;
      if (!wanted[keys[i]] && nowMs - chunk.lastSeenAt > BAL.world.chunkIdleDropMs) unloadChunk(keys[i]);
    }

    // 2) 仍超上限就按 LRU 丢最老的（内存护栏）；视野内的往后挪，不丢
    var guard = 0;
    while (order.length > BAL.view.chunkCacheLimit && guard < 200) {
      guard += 1;
      var oldest = order[0];
      if (wanted[oldest]) order.push(order.shift());
      else unloadChunk(oldest);
    }
  }

  /* ---------------------------------------------------------------- 战斗循环 */

  /** 飘字：超过 view.hudDamageNumberCap 就丢最老的（护栏，挂机时数字会刷屏） */
  function spawnDamageNumber(x, y, text, color, crit) {
    if (damageNumbers.length >= BAL.view.hudDamageNumberCap) damageNumbers.shift();
    damageNumbers.push({
      x: x,
      y: y,
      text: text,
      color: color,
      crit: crit === true,
      until: nowMs + BAL.view.damageNumberMs
    });
  }

  /**
   * 斩击特效（A4 打击感）：在玩家与目标之间溅出一道弧线。
   * 表现层数据 —— 不参与任何随机流，也不影响世界指纹；数量有上限（balance.view.slashCap），
   * 挂机时不会因为"一秒挥三次刀"把特效堆到卡帧。
   */
  function spawnSlash(player, target, crit) {
    var dx = target.x - player.x;
    var dy = target.y - player.y;
    var length = Math.sqrt(dx * dx + dy * dy);
    var dirX = length > 0.0001 ? dx / length : player.facing.x;
    var dirY = length > 0.0001 ? dy / length : player.facing.y;
    if (effects.length >= BAL.view.slashCap) effects.shift();
    effects.push({
      kind: 'slash',
      x: player.x + dirX * BAL.player.radius * 1.2,
      y: player.y + dirY * BAL.player.radius * 1.2,
      dirX: dirX,
      dirY: dirY,
      radius: BAL.player.radius + BAL.player.attackRange * 0.72,
      crit: crit === true,
      startAt: nowMs,
      until: nowMs + BAL.view.slashMs
    });
  }

  /** 清掉过期的特效（每帧一次，和飘字同一个套路） */
  function cullEffects() {
    for (var i = effects.length - 1; i >= 0; i -= 1) {
      if (effects[i].until <= nowMs) effects.splice(i, 1);
    }
  }

  /** 朝目标点走一步（不转向、不寻路 —— 无限地图没有地形阻挡，见 01-game-design §4） */
  function moveToward(entity, tx, ty, step) {
    var dx = tx - entity.x;
    var dy = ty - entity.y;
    var length = Math.sqrt(dx * dx + dy * dy);
    if (length < 1 || step <= 0) return;
    var nx = dx / length;
    var ny = dy / length;
    entity.x += nx * step;
    entity.y += ny * step;
    // 朝向只服务表现（16-render 按它决定怪的脸朝哪边）；不参与任何生成与结算
    entity.dirX = nx;
    entity.dirY = ny;
  }

  /** 怪打到玩家：结算伤害 → 扣血 → 击退 → 飘红字（数字用 COMBAT 的同一份公式） */
  function hurtPlayer(monster, player, stats, events) {
    var hit = COMBAT.monsterDamage(monster, stats, rng);
    PLAYER.hurt(player, hit.damage, monster.x, monster.y, nowMs);
    spawnDamageNumber(player.x, player.y - BAL.player.radius - 24, '-' + hit.damage, '#ff8a8a', hit.crit);
    events.playerHits.push({ monsterId: monster.id, damage: hit.damage, crit: hit.crit, hp: player.hp });
    if (player.dead) events.playerDown = true;
  }

  /**
   * 怪死：先算**奖励归属**再把它标记为死亡。
   * 归属规则见 07-combat.rewardWinnerId（决策 #1：累计伤害最高者得经验与宝箱；
   * 两个缓解开关默认关闭，打开后这里立刻生效，不用改调用方）。
   */
  function killMonster(monster, playerId, events) {
    monster.hp = 0;
    monster.state = 'dead';
    monster.respawnAt = nowMs + monster.respawnMs;
    var winnerId = COMBAT.rewardWinnerId(monster, playerId, nowMs);
    events.kills.push({ monster: monster, winnerId: winnerId, mine: winnerId === playerId });
  }

  /**
   * 单只怪的一帧：
   *   死亡 → 计时重生（回到巢穴、满血、清掉伤害归属）
   *   脱战 → 距巢穴超过 leashRange 就回家（防止被拖到天边）
   *   攻击 → 进攻击距离就按 attackIntervalMs 出手（远程发弹道，近战直接结算）
   *   追击 → 进仇恨距离就跟过来
   *   游荡 → 没目标时在巢穴附近慢慢晃（速度乘 monsters.wanderSpeedRatio）
   */
  function updateMonster(monster, player, stats, events, dtSec) {
    if (monster.state === 'dead') {
      if (nowMs >= monster.respawnAt) {
        monster.hp = monster.hpMax;
        monster.x = monster.homeX;
        monster.y = monster.homeY;
        monster.state = 'idle';
        monster.attackAt = 0;
        monster.knockX = 0;
        monster.knockY = 0;
        monster.damageBy = {};
        monster.firstHitAt = undefined;
        monster.firstHitBy = undefined;
      }
      return;
    }

    var decay = 1 - BAL.combat.knockbackDecayPerTick;
    monster.knockX *= decay;
    monster.knockY *= decay;
    if (Math.abs(monster.knockX) < 1) monster.knockX = 0;
    if (Math.abs(monster.knockY) < 1) monster.knockY = 0;
    monster.x += monster.knockX * dtSec;
    monster.y += monster.knockY * dtSec;

    if (player.dead) {
      monster.state = 'idle';
      return;
    }

    var dx = player.x - monster.x;
    var dy = player.y - monster.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var homeDx = monster.x - monster.homeX;
    var homeDy = monster.y - monster.homeY;
    var homeDist = Math.sqrt(homeDx * homeDx + homeDy * homeDy);

    if (homeDist > monster.leashRange) {
      monster.state = 'return';
      moveToward(monster, monster.homeX, monster.homeY, monster.speed * dtSec);
      return;
    }

    if (dist <= monster.attackRange) {
      monster.state = 'attack';
      // 站桩开打时朝向仍要对着玩家（否则怪会"背着脸"挥爪）
      if (dist > 0.0001) {
        monster.dirX = dx / dist;
        monster.dirY = dy / dist;
      }
      if (nowMs >= monster.attackAt) {
        monster.attackAt = nowMs + monster.attackIntervalMs;
        if (monster.ranged) {
          // 远程：先出手再飞一会儿（弹道只是表现，命中判定在 updateProjectiles）
          projectiles.push({
            monster: monster,
            fromX: monster.x,
            fromY: monster.y,
            toX: player.x,
            toY: player.y,
            x: monster.x,
            y: monster.y,
            startAt: nowMs,
            ms: BAL.combat.projectileMs
          });
        } else {
          hurtPlayer(monster, player, stats, events);
        }
      }
      return;
    }

    if (dist <= monster.aggroRange) {
      monster.state = 'chase';
      moveToward(monster, player.x, player.y, monster.speed * dtSec);
      return;
    }

    monster.state = 'idle';
    if (nowMs >= monster.wanderAt) {
      monster.wanderAt = nowMs + 1200 + rng.int(0, 1600);
      var angle = rng.float(0, Math.PI * 2);
      var radius = rng.float(20, 140);
      monster.wanderX = monster.homeX + Math.cos(angle) * radius;
      monster.wanderY = monster.homeY + Math.sin(angle) * radius;
    }
    if (monster.wanderX || monster.wanderY) {
      moveToward(monster, monster.wanderX, monster.wanderY, monster.speed * BAL.monsters.wanderSpeedRatio * dtSec);
    }
  }

  /* ------------------------------------------------ 读接口（渲染、面板、自检都要用） */

  /** 已装载的全部怪（含视野外一圈；AI 与渲染都从这里取） */
  function allMonsters() {
    var out = [];
    for (var i = 0; i < order.length; i += 1) {
      var chunk = chunks[order[i]];
      if (!chunk) continue;
      for (var k = 0; k < chunk.monsters.length; k += 1) out.push(chunk.monsters[k]);
    }
    return out;
  }

  function inRect(entity, margin) {
    return (
      entity.x >= view.x - view.w / 2 - margin &&
      entity.x <= view.x + view.w / 2 + margin &&
      entity.y >= view.y - view.h / 2 - margin &&
      entity.y <= view.y + view.h / 2 + margin
    );
  }

  /** 屏幕矩形内的活着的怪（渲染裁剪） */
  function monstersInView(pad) {
    var margin = pad || 80;
    var out = [];
    for (var i = 0; i < order.length; i += 1) {
      var chunk = chunks[order[i]];
      if (!chunk) continue;
      for (var k = 0; k < chunk.monsters.length; k += 1) {
        var monster = chunk.monsters[k];
        if (monster.state === 'dead') continue;
        if (inRect(monster, margin)) out.push(monster);
      }
    }
    return out;
  }

  /** 屏幕矩形内的装饰（纯视觉，无碰撞） */
  function decorInView(pad) {
    var margin = pad || 40;
    var out = [];
    for (var i = 0; i < order.length; i += 1) {
      var chunk = chunks[order[i]];
      if (!chunk) continue;
      for (var k = 0; k < chunk.decor.length; k += 1) {
        if (inRect(chunk.decor[k], margin)) out.push(chunk.decor[k]);
      }
    }
    return out;
  }

  /** 屏幕矩形内的地标（每 5×5 chunk 一个，给"我走到新地方了"的反馈） */
  function landmarksInView() {
    var center = CHUNK.chunkOfWorld(view.x, view.y);
    var halfW = Math.ceil(view.w / 2 / CHUNK.CHUNK_SIZE) + 1;
    var halfH = Math.ceil(view.h / 2 / CHUNK.CHUNK_SIZE) + 1;
    var all = SPAWN.landmarksInChunkRect(
      seed,
      center.cx - halfW,
      center.cy - halfH,
      center.cx + halfW,
      center.cy + halfH
    );
    var out = [];
    for (var i = 0; i < all.length; i += 1) {
      if (inRect(all[i], 200)) out.push(all[i]);
    }
    return out;
  }

  function loadedChunkCount() {
    return order.length;
  }

  /** 正在跑 AI 的怪数量（调试面板用，用来确认"只模拟附近"生效） */
  function activeMonsterCount() {
    var rect = activeRect();
    var monsters = allMonsters();
    var count = 0;
    for (var i = 0; i < monsters.length; i += 1) {
      var monster = monsters[i];
      if (monster.state === 'dead') continue;
      if (monster.x < rect.minX || monster.x > rect.maxX || monster.y < rect.minY || monster.y > rect.maxY) continue;
      count += 1;
    }
    return count;
  }

  /**
   * 玩家出手（自动战斗的"出手"这一半）：
   *   1. 当前目标还活着就继续打（不每帧跳目标，手感才稳）；否则按"视野内最近"重选；
   *   2. 攻击距离 = `player.attackRange`，但按**中心距 − 怪半径**算（怪越大越好打，符合直觉）；
   *   3. 出手间隔 = `1000 / 攻速`（balance.player.attackSpeed，1.6 次/秒）；
   *   4. 伤害、暴击、归属全部走 07-combat，两个抢怪开关也是在那里读 balance 的。
   */
  function playerAttack(player, stats, monsters, events) {
    var i;
    var target = null;
    // 选目标（01-game-design §4）：每 `combat.targetIntervalMs`（0.1 秒）重算一次"**视野内最近**"；
    // 两次重算之间沿用当前目标（省 CPU，也免得目标每帧乱跳）——
    // ⚠️ 不能只在"目标死了"时重选：否则会锁着一只远处的怪，站在近怪堆里一直打不到。
    var due = nowMs - player.targetAt >= BAL.combat.targetIntervalMs;
    if (!due && player.targetId) {
      for (i = 0; i < monsters.length; i += 1) {
        var current = monsters[i];
        if (current.id !== player.targetId || current.state === 'dead') continue;
        var cdx = current.x - player.x;
        var cdy = current.y - player.y;
        if (Math.sqrt(cdx * cdx + cdy * cdy) <= COMBAT.visionRange()) target = current;
      }
    }
    if (!target) {
      target = COMBAT.pickTarget(player.x, player.y, monsters, COMBAT.visionRange());
      player.targetId = target ? target.id : 0;
      player.targetAt = nowMs;
    }
    if (!target) return;

    var dx = target.x - player.x;
    var dy = target.y - player.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist - target.radius > BAL.player.attackRange) return;
    if (nowMs < player.lastAttackAt + COMBAT.attackIntervalMs(stats.attackSpeed)) return;
    player.lastAttackAt = nowMs;

    var hit = COMBAT.rollDamage(stats.attack, stats.damageBonus, target.defense, stats.critChance, stats.critDamage, rng);
    target.hp -= hit.damage;
    target.hurtUntil = nowMs + BAL.combat.hurtMs;
    COMBAT.creditHit(target, player.id, hit.damage, nowMs);
    spawnDamageNumber(target.x, target.y - target.radius - 18, String(hit.damage), hit.crit ? '#ffd479' : '#ffffff', hit.crit);
    // 打击感的数据那一半：斩击特效 + 把"谁被打了一下"记进 events（20-main 据此做顿帧 / 震屏 / 音效）
    spawnSlash(player, target, hit.crit);
    events.hits.push({ damage: hit.damage, crit: hit.crit === true, x: target.x, y: target.y });

    if (dist > 0.0001) {
      // 击退：从玩家往外推（数值见 combat.monsterKnockback，秒为单位、在 updateMonster 里衰减）
      target.knockX = (dx / dist) * BAL.combat.monsterKnockback;
      target.knockY = (dy / dist) * BAL.combat.monsterKnockback;
    }
    if (target.hp <= 0) killMonster(target, player.id, events);
  }

  /** 远程弹道：飞到期就结算一次伤害（阶段 A 简化为"到点必中"，命中判定不做落点校验） */
  function updateProjectiles(player, stats, events) {
    for (var i = projectiles.length - 1; i >= 0; i -= 1) {
      var shot = projectiles[i];
      var t = (nowMs - shot.startAt) / shot.ms;
      if (t >= 1) {
        projectiles.splice(i, 1);
        if (!player.dead && shot.monster && shot.monster.state !== 'dead') hurtPlayer(shot.monster, player, stats, events);
        continue;
      }
      shot.x = shot.fromX + (shot.toX - shot.fromX) * t;
      shot.y = shot.fromY + (shot.toY - shot.fromY) * t;
    }
  }

  /**
   * 一个逻辑帧（固定 1/60 秒，由 20-main 驱动）：
   *   推进时间 → 装载视野 chunk → 附近怪各跑一帧 AI → 玩家出手 → 弹道结算 → 清理过期飘字。
   * 返回的 `events` 是**给玩法层的账单**：本帧杀了谁（含归属）、玩家挨了几下，
   * 经验/金币/宝箱的结算在 20-main（因为那要动存档与保底计数）。
   */
  function update(dtMs, player, stats, camera, screenW, screenH) {
    nowMs += dtMs;
    setView(camera, screenW, screenH);
    ensureChunks(player.x, player.y);

    var events = { kills: [], playerHits: [], playerDown: false, target: null, hits: [] };
    var rect = activeRect();
    var dtSec = dtMs / 1000;
    var monsters = allMonsters();
    var i;

    for (i = 0; i < monsters.length; i += 1) {
      var monster = monsters[i];
      // 死掉的怪即使很远也要跑（重生计时）；活着的怪只跑"活跃区"内的（文件头取舍 #1）
      if (
        monster.state !== 'dead' &&
        (monster.x < rect.minX || monster.x > rect.maxX || monster.y < rect.minY || monster.y > rect.maxY)
      ) {
        continue;
      }
      updateMonster(monster, player, stats, events, dtSec);
    }

    if (!player.dead) playerAttack(player, stats, monsters, events);

    // 当前目标（HUD 要画目标环与名字）
    for (i = 0; i < monsters.length; i += 1) {
      if (monsters[i].id === player.targetId && monsters[i].state !== 'dead') events.target = monsters[i];
    }

    updateProjectiles(player, stats, events);
    cullEffects();

    for (i = damageNumbers.length - 1; i >= 0; i -= 1) {
      if (damageNumbers[i].until <= nowMs) damageNumbers.splice(i, 1);
    }
    return events;
  }

  /* ------------------------------------------------ 自动战斗走位（A4 新增） */

  /**
   * 视野内最近的可攻击怪。
   * 与 `playerAttack` 共用 07-combat 的同一份 pickTarget —— 走位与出手**必须**选同一只怪，
   * 否则会出现"走过去打另一只"的鬼畜现象。
   */
  function pickTarget(player) {
    return COMBAT.pickTarget(player.x, player.y, allMonsters(), COMBAT.visionRange());
  }

  /** 按 id 取怪（走位每帧都要目标的实时坐标；死了 / 该 chunk 被卸掉就当没有） */
  function monsterById(id) {
    if (!id) return null;
    var monsters = allMonsters();
    for (var i = 0; i < monsters.length; i += 1) {
      if (monsters[i].id === id && monsters[i].state !== 'dead') return monsters[i];
    }
    return null;
  }

  return {
    reset: reset,
    setView: setView,
    ensureChunks: ensureChunks,
    allMonsters: allMonsters,
    monstersInView: monstersInView,
    pickTarget: pickTarget,
    monsterById: monsterById,
    decorInView: decorInView,
    landmarksInView: landmarksInView,
    loadedChunkCount: loadedChunkCount,
    activeMonsterCount: activeMonsterCount,
    update: update,
    rng: function () {
      return rng;
    },
    seed: function () {
      return seed;
    },
    now: function () {
      return nowMs;
    },
    damageNumbers: function () {
      return damageNumbers;
    },
    projectiles: function () {
      return projectiles;
    },
    effects: function () {
      return effects;
    }
  };
})();
