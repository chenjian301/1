/**
 * 07-skills.js —— 技能栏的纯逻辑（阶段 A5 新增）
 *
 * 用户要求：加技能栏（四个技能键）。本文件只做**不碰画布、不碰 tt** 的那一半，
 * 所以能在 node 里逐条断言（决策 #7 的替代验证通道）：
 *   1. 解锁：等级到了才给放（`skills.slots[].unlockLevel`）；
 *   2. 冷却：两道闸门 —— 每个技能自己的 `cooldownMs`，外加一条 `globalCooldownMs` 全局冷却
 *      （没有它，四个键会在同一帧里一起炸出去）；
 *   3. 选目标：范围技 = 玩家周围 `radius` 内的活怪（按装载顺序，确定性）；穿刺 = 攻击范围内最近的怪
 *      （复用 07-combat 的 pickTarget：同距取 ID 小）；治疗不选目标；
 *   4. 伤害：**不另写公式** —— 还是 COMBAT.rollDamage，只是把攻击乘上 `damageMul`
 *      （决策 #4：数字只有一处，公式也只有一处）；
 *   5. 自动释放：自动战斗开着时从左到右挑第一个"能用"的技能 —— 伤害技要有怪在打击范围内
 *      （免得空放），治疗只在血量低于 `skills.autoHealRatio` 时放。
 *
 * 为什么冷却不进存档：冷却记在 20-main 的**运行时**（`state.skillCooldowns`）。
 * 它是"这一刻能不能放"的手感数据，不是资产；写进存档反而会留下"改表刷冷却"的口子。
 * 阶段 B/C 换成服务端权威时，本文件一行都不用改（它不读写任何本地状态，只吃入参）。
 */

G.SKILLS = (function () {
  'use strict';

  var BAL = G.BAL;
  var COMBAT = G.COMBAT;

  /** 技能表（shared\balance.json 的 skills.slots） */
  function slots() {
    return BAL.skills.slots;
  }

  function count() {
    return BAL.skills.slots.length;
  }

  /** 按序号取技能定义；越界返回 null（界面与结算都要能吃住坏输入） */
  function slotAt(index) {
    var list = slots();
    var i = typeof index === 'number' ? Math.floor(index) : -1;
    if (!(i >= 0) || i >= list.length) return null;
    return list[i];
  }

  /** 这个技能当前等级解锁了吗 */
  function unlocked(index, level) {
    var slot = slotAt(index);
    if (!slot) return false;
    return (level | 0) >= slot.unlockLevel;
  }

  /** 已解锁的技能个数（HUD 上的"2 / 4"与调试面板用） */
  function unlockedCount(level) {
    var total = 0;
    for (var i = 0; i < count(); i += 1) {
      if (unlocked(i, level)) total += 1;
    }
    return total;
  }

  /** 打击半径（范围技）或射程（穿刺）：界面画圈、自检断言都用它 */
  function reachOf(slot) {
    if (!slot) return 0;
    return slot.type === 'strike' ? slot.range : slot.radius;
  }

  /**
   * 选目标：范围技取玩家周围 `radius` 内的活怪（算上怪半径，越大越好打 —— 与普通攻击同一套手感）；
   * 穿刺取攻击范围内最近的一只；治疗不选目标。
   * 顺序 = 传进来的 monsters 顺序（= chunk 装载顺序 = 确定性），不做二次排序。
   */
  function pickTargets(slot, x, y, monsters) {
    var out = [];
    if (!slot || slot.type === 'heal') return out;
    var list = monsters || [];
    var i;
    if (slot.type === 'strike') {
      var nearest = COMBAT.pickTarget(x, y, list, slot.range);
      if (nearest) out.push(nearest);
      return out;
    }
    for (i = 0; i < list.length; i += 1) {
      var monster = list[i];
      if (!monster || monster.state === 'dead') continue;
      var dx = monster.x - x;
      var dy = monster.y - y;
      var reach = slot.radius + (monster.radius || 0);
      if (dx * dx + dy * dy <= reach * reach) out.push(monster);
    }
    return out;
  }

  /** 技能伤害：攻击 × damageMul 之后走同一份伤害公式（含暴击与最小值 1） */
  function rollDamage(slot, stats, target, rng) {
    var attack = stats.attack * (slot && slot.damageMul ? slot.damageMul : 1);
    return COMBAT.rollDamage(attack, stats.damageBonus, target.defense, stats.critChance, stats.critDamage, rng);
  }

  /** 治疗量 = 生命上限 × healRatio（至少 1 点，四舍五入到整数） */
  function healAmount(slot, stats) {
    if (!slot || !(slot.healRatio > 0)) return 0;
    var hpMax = stats.hpMax > 0 ? stats.hpMax : 0;
    var amount = Math.round(hpMax * slot.healRatio);
    return amount < 1 ? 1 : amount;
  }

  /** 还要等多久（毫秒，0 = 现在就能放）。冷却表是"能再放的时刻"数组 */
  function remainMs(cooldowns, index, nowMs) {
    var at = cooldowns && cooldowns[index] ? cooldowns[index] : 0;
    var remain = at - nowMs;
    return remain > 0 ? remain : 0;
  }

  function isReady(cooldowns, index, nowMs) {
    return remainMs(cooldowns, index, nowMs) <= 0;
  }

  /** 全局冷却（两次技能之间的最短间隔）过了吗 */
  function globalReady(globalAt, nowMs) {
    return nowMs >= (globalAt || 0);
  }

  /**
   * 能不能放：返回 `{ ok, reason }`，reason ∈ 'ok' | 'locked' | 'cooldown' | 'global'。
   * 判定顺序 = 提示的优先级：先看解锁（等级没到），再看**这个技能自己的冷却**，
   * 最后才是全局冷却 —— 同一帧连点同一个技能时，"还要 4 秒" 比 "手速太快" 更有用。
   */
  function canCast(cooldowns, globalAt, index, nowMs, level) {
    var slot = slotAt(index);
    if (!slot) return { ok: false, reason: 'locked', slot: null };
    if (!unlocked(index, level)) return { ok: false, reason: 'locked', slot: slot };
    if (!isReady(cooldowns, index, nowMs)) {
      return { ok: false, reason: 'cooldown', slot: slot, remainMs: remainMs(cooldowns, index, nowMs) };
    }
    if (!globalReady(globalAt, nowMs)) {
      return { ok: false, reason: 'global', slot: slot, remainMs: (globalAt || 0) - nowMs };
    }
    return { ok: true, reason: 'ok', slot: slot };
  }

  /**
   * 记一次释放：冷却从**放出去的那一刻**算起（世界时间，不是 Date.now —— 逻辑可重放）。
   * 纯函数：返回新的冷却表与全局冷却时刻，调用方自己塞回 state。
   */
  function markCast(cooldowns, globalAt, index, nowMs) {
    var slot = slotAt(index);
    var list = (cooldowns || []).slice();
    for (var i = list.length; i < count(); i += 1) list.push(0);
    if (list.length > count()) list.length = count();
    var at = nowMs > (globalAt || 0) ? nowMs : globalAt || 0;
    if (slot) list[index] = at + slot.cooldownMs;
    return {
      cooldowns: list,
      slotAt: at + (slot ? slot.cooldownMs : 0),
      globalAt: at + BAL.skills.globalCooldownMs
    };
  }

  /**
   * 自动释放挑哪个（-1 = 都不放）。喂进来的是一份**视角数据**而不是函数，方便自检直接构造：
   *   { cooldowns, globalAt, nowMs, level, hpRatio, x, y, monsters }
   * 规则（用户在阶段 A4 说过"自动战斗时不仅自动出手，还自动释放技能"）：
   *   - 全局冷却没好 → 一个都不放；
   *   - 从左到右：没解锁 / 自己在冷却里 → 跳过；
   *   - 治疗技：只有 hpRatio ≤ skills.autoHealRatio 才放（满血时别把治疗浪费掉）；
   *   - 伤害技：打击范围内得有活怪，否则跳过（空放既没伤害又白等冷却）。
   */
  function autoChoice(view) {
    var data = view || {};
    var nowMs = data.nowMs || 0;
    if (!globalReady(data.globalAt, nowMs)) return -1;
    for (var i = 0; i < count(); i += 1) {
      var slot = slotAt(i);
      if (!unlocked(i, data.level)) continue;
      if (!isReady(data.cooldowns, i, nowMs)) continue;
      if (slot.type === 'heal') {
        var ratio = typeof data.hpRatio === 'number' ? data.hpRatio : 1;
        if (ratio <= BAL.skills.autoHealRatio) return i;
        continue;
      }
      if (pickTargets(slot, data.x || 0, data.y || 0, data.monsters).length > 0) return i;
    }
    return -1;
  }

  return {
    slots: slots,
    count: count,
    slotAt: slotAt,
    unlocked: unlocked,
    unlockedCount: unlockedCount,
    reachOf: reachOf,
    pickTargets: pickTargets,
    rollDamage: rollDamage,
    healAmount: healAmount,
    remainMs: remainMs,
    isReady: isReady,
    globalReady: globalReady,
    canCast: canCast,
    markCast: markCast,
    autoChoice: autoChoice
  };
})();
