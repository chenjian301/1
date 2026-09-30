/**
 * 07-combat.js —— 自动战斗的纯计算部分（阶段 A2 新增）
 *
 * 只做四件事，都不碰画布、不碰 tt，所以能在 node 里直接断言（决策 #7 的替代验证通道）：
 *   1. 选目标：**距离最近**的可攻击怪（默认全地图，见 `combat.targetRange`）；
 *      同距取 **ID 小**的（确定性，不然帧率一变目标就跳）；
 *   2. 伤害：`max(1, 攻击 × (1 + 增伤) − 目标防御 × 0.6)`，暴击再 ×暴击伤害；
 *   3. 伤害归属：累计到怪身上（决策 #1 —— 奖励归**累计伤害最高**的玩家）；
 *   4. 抢怪缓解的两个**预留开关**：`combat.firstHitProtectionMs`（首击保护）与
 *      `combat.damageShareGate`（伤害门槛）。首版两个都是 0 = 关闭，逻辑已就位：
 *      将来要开，只改 shared\balance.json 的两个数字，不用动代码（决策 #1 的要求）。
 *
 * 客户端与将来的服务端都用这一份：服务端权威结算时只是把 rng 换成服务端的流。
 */

G.COMBAT = (function () {
  'use strict';

  var BAL = G.BAL;

  /**
   * 选目标的距离上限（设计像素）。
   * `0` = **不限距离**：在**已装载的全部怪**里找最近的那只（A7 修订，用户要求"找全地图最近的怪"）。
   * 只有真的想限制"只看眼前一圈"时才把它调成正数。
   */
  function targetRange() {
    return BAL.combat.targetRange;
  }

  /** 出手间隔（毫秒）= 1000 / 攻速 */
  function attackIntervalMs(attackSpeed) {
    if (!(attackSpeed > 0)) return 1000;
    return 1000 / attackSpeed;
  }

  /**
   * 一次伤害结算（同一份公式客户端/服务端共用）。
   * rng 由调用方注入：本地用状态随机流，服务端用服务端自己的流（决策 #1）。
   */
  function rollDamage(attack, damageBonus, targetDefense, critChance, critDamage, rng) {
    var crit = rng.chance(critChance);
    var raw = attack * (1 + damageBonus) - targetDefense * BAL.combat.defenseFactor;
    if (crit) raw *= critDamage;
    var damage = Math.round(raw);
    if (damage < 1) damage = 1;
    return { damage: damage, crit: crit };
  }

  /** 怪对玩家的伤害：防御同样按 defenseFactor 抵扣，再乘玩家减伤 */
  function monsterDamage(monster, playerStats, rng) {
    var crit = rng.chance(BAL.monsters.critChance);
    var raw = monster.attack - playerStats.defense * BAL.combat.defenseFactor;
    if (crit) raw *= BAL.monsters.critDamage;
    var damage = Math.max(1, Math.round(raw));
    var reduced = damage * (1 - playerStats.damageReduction);
    return { damage: Math.max(1, Math.round(reduced)), crit: crit };
  }

  /**
   * 选目标：**距离最近**的活着的怪；同距取 ID 小的。
   * `range <= 0` = 不限距离（默认）：在传进来的**全部怪**（= 已装载的怪）里找最近的 ——
   * A7 修订，用户要求"自动战斗找全地图最近的怪"（之前写死视野 540，屏幕外一格的怪就当看不见）。
   * 用平方距离比较（省一次开方，也让比较保持整数）。
   */
  function pickTarget(x, y, monsters, range) {
    var best = null;
    var bestSq = range > 0 ? range * range : Infinity;
    for (var i = 0; i < monsters.length; i += 1) {
      var monster = monsters[i];
      if (!monster || monster.state === 'dead') continue;
      var dx = monster.x - x;
      var dy = monster.y - y;
      var sq = dx * dx + dy * dy;
      if (sq > bestSq) continue;
      if (best === null || sq < bestSq || (sq === bestSq && monster.id < best.id)) {
        best = monster;
        bestSq = sq;
      }
    }
    return best;
  }

  /** 记一笔伤害归属（第一次被打时打上首击时间，供"首击保护"开关用） */
  function creditDamage(monster, playerId, damage, nowMs) {
    if (!monster.damageBy) monster.damageBy = {};
    if (monster.firstHitAt === undefined) monster.firstHitAt = nowMs;
    monster.damageBy[playerId] = (monster.damageBy[playerId] || 0) + damage;
  }

  /**
   * 这只怪的奖励该给谁（**决策 #1 的核心**）。
   *
   * 首版规则：累计伤害最高的玩家拿走经验 + 宝箱，其余参与者在这次结算里什么都拿不到
   * （抢怪是设计内行为）。两个缓解开关都读 shared\balance.json：
   *   - firstHitProtectionMs > 0：首击者在保护期内独占（这里只做"资格判定"）；
   *   - damageShareGate > 0：伤害不足怪物最大生命 X% 的玩家没有资格。
   */
  function rewardWinnerId(monster, playerId, nowMs) {
    var damages = monster.damageBy || {};
    var lastHitByMe = damages[playerId] || 0;
    var mine = lastHitByMe;

    // 开关 2：伤害门槛（0 = 关闭）
    if (BAL.combat.damageShareGate > 0) {
      var need = monster.hpMax * BAL.combat.damageShareGate;
      if (mine < need) return null;
    }

    // 开关 1：首击保护（0 = 关闭）——保护期内只有首击者有资格
    if (BAL.combat.firstHitProtectionMs > 0 && monster.firstHitAt !== undefined) {
      var protector = monster.firstHitBy;
      if (protector !== undefined && protector !== playerId) {
        if (nowMs - monster.firstHitAt < BAL.combat.firstHitProtectionMs) return null;
      }
    }

    // 首版规则：累计伤害最高者（同值取 ID 小，保证两端结果一致）
    var bestId = null;
    var bestDamage = -1;
    for (var key in damages) {
      if (!Object.prototype.hasOwnProperty.call(damages, key)) continue;
      var value = damages[key];
      var idNumber = Number(key);
      if (value > bestDamage || (value === bestDamage && bestId !== null && idNumber < bestId)) {
        bestDamage = value;
        bestId = idNumber;
      }
    }
    return bestId;
  }

  /** 把"这个人打出了这一下"记进归属（含首击者） */
  function creditHit(monster, playerId, damage, nowMs) {
    if (monster.firstHitBy === undefined) monster.firstHitBy = playerId;
    creditDamage(monster, playerId, damage, nowMs);
  }

  return {
    targetRange: targetRange,
    attackIntervalMs: attackIntervalMs,
    rollDamage: rollDamage,
    monsterDamage: monsterDamage,
    pickTarget: pickTarget,
    creditHit: creditHit,
    rewardWinnerId: rewardWinnerId
  };
})();
