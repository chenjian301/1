/**
 * 10-player.js —— 玩家：属性汇总、移动、受伤、升级、复活（阶段 A2 新增）
 *
 * 属性汇总的**唯一入口**：等级基础 + 6 件装备，算出一份"战斗用属性快照"。
 * 这样做的原因（04-decisions #7 的替代验证通道）：战斗、掉落、界面都只读这份快照，
 * 于是"数值对不对"可以在 node 里一次性断言，不用跑画面。
 *
 * 公式（balance.player + balance.progression）：
 *   attack        = (baseAttack + 2×级差) × (1 + 增伤) + 装备攻击      ← 增伤是乘算，装备攻击是加算
 *   hpMax         = baseHp × (1 + 1%×级差) + 装备生命
 *   defense       = baseDefense + 装备防御
 *   attackSpeed   = base 攻速 × (1 + 装备攻速)
 *   critChance    = 5% + 装备暴击率（上限 100%）
 *   critDamage    = 1.5 + 装备暴击伤害
 *   damageReduction = 装备减伤（上限 75%，防止"无敌套"）
 *   pickupRange   = base + 装备拾取范围
 *
 * 死亡规则：血量归零 → 3 秒（player.respawnDelayMs）后在原地满血复活，
 * 只扣时间不扣东西 —— 首版不做死亡惩罚（01-game-design §6）。
 */

G.PLAYER = (function () {
  'use strict';

  var BAL = G.BAL;
  var PROG = G.PROG;
  var EQUIP = G.EQUIP;

  /** 6 件装备都为空时的一份干净装备栏（存档坏了也能开局） */
  function normalizeLoadout(loadout) {
    var result = EQUIP.emptyLoadout();
    if (!loadout) return result;
    for (var i = 0; i < BAL.equipment.slots.length; i += 1) {
      var id = BAL.equipment.slots[i].id;
      // 强化等级（本次新增）：老存档没有这个字段 = 0 级；坏值夹回 [0, 上限]
      if (loadout[id] && loadout[id].main && loadout[id].affixes) result[id] = EQUIP.normalizeEnhance(loadout[id]);
    }
    return result;
  }

  /**
   * 属性快照：战斗、掉落、界面都用它，避免各处各算一套。
   * `loadout` 可为空（那就是"光身板"的数值，正好当基准线）。
   */
  function statsOf(level, loadout) {
    var grow = PROG.statsForLevel(level);
    var totals = EQUIP.totalsOf(loadout);
    var bonuses = BAL.player;

    var damageBonus = totals.damage || 0;
    var attack = (bonuses.baseAttack + grow.attack) * (1 + damageBonus) + (totals.attack || 0);
    var hpMax = Math.round(bonuses.baseHp * (1 + grow.hpPct) + (totals.hp || 0));
    var critChance = bonuses.critChance + (totals.critChance || 0);
    if (critChance > 1) critChance = 1;
    var damageReduction = bonuses.damageReduction + (totals.damageReduction || 0);
    if (damageReduction > 0.75) damageReduction = 0.75;

    return {
      level: level,
      hpMax: hpMax < 1 ? 1 : hpMax,
      attack: Math.round(attack * 10) / 10,
      defense: Math.round((bonuses.baseDefense + (totals.defense || 0)) * 10) / 10,
      attackSpeed: bonuses.attackSpeed * (1 + (totals.attackSpeed || 0)),
      critChance: critChance,
      critDamage: bonuses.critDamage + (totals.critDamage || 0),
      damageBonus: damageBonus,
      damageReduction: damageReduction,
      pickupRange: bonuses.pickupRange + (totals.pickupRange || 0),
      moveSpeed: bonuses.moveSpeed,
      xpBonus: totals.xpBonus || 0,
      goldBonus: totals.goldBonus || 0,
      power: EQUIP.armoryPower(loadout)
    };
  }

  /** 建一个玩家运行时对象（不是存档；存档在 11-save.js） */
  function create(save) {
    return {
      id: 1,
      level: save.level,
      exp: save.exp,
      x: save.x,
      y: save.y,
      hp: BAL.player.baseHp,
      facing: { x: 0, y: 1 },
      moving: false,
      dead: false,
      respawnAt: 0,
      lastAttackAt: 0,
      targetId: 0,
      /** 上次"重选目标"的时刻（每 combat.targetIntervalMs 重算一次，见 14-world.playerAttack） */
      targetAt: 0,
      knockX: 0,
      knockY: 0,
      hurtUntil: 0
    };
  }

  /** 把玩家血量夹在 [0, hpMax]（升级时会顺便"补满新增的那部分"） */
  function clampHp(player, stats) {
    if (player.hp > stats.hpMax) player.hp = stats.hpMax;
    if (player.hp < 0) player.hp = 0;
    return player.hp;
  }

  /** 升级回调：血量上限涨了，按同样比例回一点血，避免升级后反而更"脆" */
  function onLevelUp(player, statsBefore, statsAfter) {
    var ratio = statsBefore.hpMax > 0 ? player.hp / statsBefore.hpMax : 1;
    player.hp = Math.min(statsAfter.hpMax, Math.round(ratio * statsAfter.hpMax + (statsAfter.hpMax - statsBefore.hpMax)));
  }

  /** 移动：dtSec 秒内朝 (dx, dy)（已归一化）走 moveSpeed；带击退惯性 */
  function move(player, dx, dy, dtSec, stats) {
    var length = Math.sqrt(dx * dx + dy * dy);
    if (length > 0.0001) {
      var nx = dx / length;
      var ny = dy / length;
      player.x += nx * stats.moveSpeed * dtSec;
      player.y += ny * stats.moveSpeed * dtSec;
      player.facing.x = nx;
      player.facing.y = ny;
      player.moving = true;
    } else {
      player.moving = false;
    }
    player.x += player.knockX * dtSec;
    player.y += player.knockY * dtSec;
  }

  /** 每逻辑帧衰减击退速度（表现用，不影响数值平衡） */
  function decayKnockback(player) {
    var decay = 1 - BAL.combat.knockbackDecayPerTick;
    if (decay < 0) decay = 0;
    player.knockX *= decay;
    player.knockY *= decay;
    if (Math.abs(player.knockX) < 1) player.knockX = 0;
    if (Math.abs(player.knockY) < 1) player.knockY = 0;
  }

  /** 被怪打：扣血 + 击退 + 记录受击时间（"战斗中不可传送"要用它） */
  function hurt(player, damage, fromX, fromY, nowMs) {
    player.hp = Math.max(0, player.hp - damage);
    player.hurtUntil = nowMs + BAL.combat.hurtMs;
    var dx = player.x - fromX;
    var dy = player.y - fromY;
    var length = Math.sqrt(dx * dx + dy * dy);
    if (length > 0.0001) {
      player.knockX = (dx / length) * BAL.combat.playerKnockback;
      player.knockY = (dy / length) * BAL.combat.playerKnockback;
    }
    if (player.hp <= 0) {
      player.dead = true;
      player.respawnAt = nowMs + BAL.player.respawnDelayMs;
    }
    return player.hp;
  }

  /** 复活：原地、按 reviveHpRatio 回血（默认 50%） */
  function respawn(player, stats) {
    player.dead = false;
    player.hp = Math.max(1, Math.round(stats.hpMax * BAL.player.reviveHpRatio));
    player.knockX = 0;
    player.knockY = 0;
    return player.hp;
  }

  /** 是否处于"战斗中"（3 秒内受过伤）：公会传送的门槛之一 */
  function inCombat(player, nowMs) {
    return player.hurtUntil > nowMs;
  }

  /**
   * 属性面板 / 背包属性网格的行数据（A6；A10 每一行多了 `icon`）。
   * 一行一项，副行把"等级基础"与"装备加成"分开写 —— 玩家一眼就知道该练级还是该去开箱。
   * `icon` 是 16-icons 的图标名（'attack' / 'hp' / …）：**图标名跟着属性定义走**，
   * 于是加一项属性时不会出现"面板里有数值但没图标"的漏网项。
   *
   * 放在这里而不是 18-panels 的原因与 statsOf 一样：属性公式只能有一份，
   * 面板只负责排版（界面层不读玩法公式，决策 #4）。
   */
  function breakdown(level, loadout) {
    var stats = statsOf(level, loadout);
    var grow = PROG.statsForLevel(level);
    var totals = EQUIP.totalsOf(loadout);
    var base = BAL.player;
    var pct = function (value) {
      return (value * 100).toFixed(1) + '%';
    };
    return [
      { icon: 'level', label: '等级', value: 'Lv.' + level, sub: '升到下一级还需 ' + Math.round(PROG.xpToNext(level)) + ' 经验' },
      {
        icon: 'power',
        label: '战力',
        value: String(stats.power),
        sub: '四件装备战力之和（只用来一眼比较强弱，不参与战斗结算）',
        color: '#ffd479'
      },
      {
        icon: 'attack',
        label: '攻击',
        value: String(stats.attack),
        sub: '等级基础 ' + Math.round((base.baseAttack + grow.attack) * 10) / 10 + ' ＋ 装备 ' + (totals.attack || 0)
      },
      {
        icon: 'hp',
        label: '生命上限',
        value: String(stats.hpMax),
        sub: '等级基础 ' + Math.round(base.baseHp * (1 + grow.hpPct)) + ' ＋ 装备 ' + (totals.hp || 0)
      },
      { icon: 'defense', label: '防御', value: String(stats.defense), sub: '基础 ' + base.baseDefense + ' ＋ 装备 ' + (totals.defense || 0) },
      {
        icon: 'attackSpeed',
        label: '攻速',
        value: stats.attackSpeed.toFixed(2) + ' 次/秒',
        sub: '基础 ' + base.attackSpeed + ' ×（1 ＋ 装备攻速 ' + pct(totals.attackSpeed || 0) + '）'
      },
      {
        icon: 'crit',
        label: '暴击率',
        value: pct(stats.critChance),
        sub: '基础 ' + pct(base.critChance) + ' ＋ 装备 ' + pct(totals.critChance || 0) + '（上限 100%）'
      },
      {
        icon: 'critDamage',
        label: '暴击伤害',
        value: Math.round(stats.critDamage * 100) + '%',
        sub: '基础 ' + Math.round(base.critDamage * 100) + '% ＋ 装备 ' + Math.round((totals.critDamage || 0) * 100) + '%'
      },
      { icon: 'damage', label: '增伤', value: pct(stats.damageBonus), sub: '装备词条合计（乘算在攻击上）' },
      { icon: 'reduce', label: '减伤', value: pct(stats.damageReduction), sub: '装备词条合计（上限 75%，防止无敌套）' },
      { icon: 'move', label: '移动速度', value: String(stats.moveSpeed), sub: '固定值：装备不影响走位手感' },
      {
        icon: 'pickup',
        label: '拾取范围',
        value: String(stats.pickupRange),
        sub: '基础 ' + base.pickupRange + ' ＋ 装备 ' + (totals.pickupRange || 0)
      },
      { icon: 'xp', label: '经验加成', value: pct(stats.xpBonus), sub: '装备词条合计' },
      { icon: 'gold', label: '金币加成', value: pct(stats.goldBonus), sub: '装备词条合计' }
    ];
  }

  return {
    normalizeLoadout: normalizeLoadout,
    statsOf: statsOf,
    breakdown: breakdown,
    create: create,
    clampHp: clampHp,
    onLevelUp: onLevelUp,
    move: move,
    decayKnockback: decayKnockback,
    hurt: hurt,
    respawn: respawn,
    inCombat: inCombat
  };
})();
