/**
 * 09-equipment.js —— 装备生成 / 词条 / 战力（阶段 A2 新增）
 *
 * 一件装备 = `等阶（1..6） + 部位（6 种） + 等级门槛 + 主属性 + N 条词条`。
 * 等阶决定**词条条数**与**数值倍率**（balance.equipment.tiers）：
 *   普通 1 条 ×1.00 / 专家 2 ×1.35 / 史诗 3 ×1.85 / 传说 4 ×2.60 / 神话 5 ×3.70 / 天赐 5+专属 ×5.30
 *
 * 两条"文档没写死、由这里定下来"的规则（定在这里，别处不许再各定一套）：
 *   1. **主属性随掉落等级走**：`(基础 + 每级成长 × (掉落等级-1)) × 等阶倍率`。
 *      "掉落等级"取那只怪（或那口箱）的等级 —— 越往远处走，同阶装备也越强，
 *      这正是无限地图"越远越好赚"的兑现方式（等级门槛只由等阶决定，见 levelRequirement）。
 *   2. **战力** = 主属性与词条按 `balance.equipment.powerWeights` 折算成一个数，
 *      只用来做"穿上会不会更强"的一眼判断（背包里 ↑↓），不参与任何战斗结算。
 *
 * 阶段 B 起：装备生成必须在服务端做（客户端只发"开这个箱"），否则改包就能出神装。
 * 所以这里所有随机都走**传入的 rng**，接口一行都不用改。
 */

G.EQUIP = (function () {
  'use strict';

  var BAL = G.BAL;

  /** 属性中文名（渲染、日志、自检共用一份，避免两处写两套） */
  var STAT_NAMES = {
    attack: '攻击',
    hp: '生命',
    defense: '防御',
    attackSpeed: '攻速',
    critChance: '暴击率',
    critDamage: '暴击伤害',
    damage: '增伤',
    damageReduction: '减伤',
    xpBonus: '经验加成',
    goldBonus: '金币加成',
    pickupRange: '拾取范围'
  };

  /** 百分比词条（显示成 x.x%，战力权重也按百分点放大） */
  var PERCENT_STATS = {
    attackSpeed: true,
    critChance: true,
    critDamage: true,
    damage: true,
    damageReduction: true,
    xpBonus: true,
    goldBonus: true
  };

  function tierById(tierId) {
    for (var i = 0; i < BAL.equipment.tiers.length; i += 1) {
      if (BAL.equipment.tiers[i].id === tierId) return BAL.equipment.tiers[i];
    }
    return BAL.equipment.tiers[0];
  }

  function slotById(slotId) {
    for (var i = 0; i < BAL.equipment.slots.length; i += 1) {
      if (BAL.equipment.slots[i].id === slotId) return BAL.equipment.slots[i];
    }
    return null;
  }

  function statName(stat) {
    return STAT_NAMES[stat] || stat;
  }

  function isPercent(stat) {
    return PERCENT_STATS[stat] === true;
  }

  /** 等级门槛：base + (等阶-1) × perTier → 天赐 = 1 + 5×3 = 16 级 */
  function requirementFor(tierId) {
    var rule = BAL.equipment.levelRequirement;
    return rule.base + (tierId - 1) * rule.perTier;
  }

  /** 数值取整：百分比保留 4 位、生命取整、其余保留 1 位 */
  function tidy(stat, value) {
    if (isPercent(stat)) {
      var scaled = Math.round(value * 10000) / 10000;
      return scaled === 0 ? 0 : scaled;
    }
    if (stat === 'hp') return Math.round(value);
    return Math.round(value * 10) / 10;
  }

  /** 主属性数值：基础 + 每级成长 × (掉落等级-1)，再乘等阶倍率 */
  function mainValue(stat, level, tier) {
    var base = BAL.equipment.mainStatBase[stat] || 0;
    var per = BAL.equipment.mainStatPerLevel[stat] || 0;
    return tidy(stat, (base + per * (level - 1)) * tier.multiplier);
  }

  /** 抽词条：按权重**不放回**地抽，凑够条数（同一条词条不重复出现） */
  function rollAffixes(count, tier, rng) {
    var pool = BAL.equipment.affixes.slice();
    var weights = [];
    var i;
    for (i = 0; i < pool.length; i += 1) weights.push(pool[i].weight);

    var out = [];
    for (i = 0; i < count && pool.length > 0; i += 1) {
      var index = rng.weightedIndex(weights);
      var def = pool[index];
      var raw = rng.rounded(def.min, def.max, 4) * tier.multiplier;
      out.push({ id: def.id, name: statName(def.id), value: tidy(def.id, raw), percent: def.percent === true });
      pool.splice(index, 1);
      weights.splice(index, 1);
    }
    return out;
  }

  /** 天赐专属词条：在词条池里再抽一条并把数值翻倍（六阶的"稀有背书"） */
  function rollUniqueAffix(tier, rng) {
    var defs = BAL.equipment.affixes;
    var def = defs[rng.int(0, defs.length - 1)];
    var raw = rng.rounded(def.min, def.max, 4) * tier.multiplier * 2;
    return {
      id: def.id,
      name: '天赐·' + statName(def.id),
      value: tidy(def.id, raw),
      percent: def.percent === true,
      unique: true
    };
  }

  /** 把主属性 + 词条折算成战力（同一条词条再次出现时叠加，天赐专属就是靠这个翻倍） */
  function powerOf(item) {
    var weights = BAL.equipment.powerWeights;
    var power = (weights[item.main.stat] || 0) * item.main.value;
    for (var i = 0; i < item.affixes.length; i += 1) {
      var affix = item.affixes[i];
      power += (weights[affix.id] || 0) * affix.value;
    }
    return Math.round(power);
  }

  /**
   * 生成一件装备。
   * `id` 由调用方给（存档里的自增号），这样同一次掉落重放两次也拿到同一个 id。
   */
  function generate(tierId, level, rng, id) {
    var tier = tierById(tierId);
    var slots = BAL.equipment.slots;
    var slot = slots[rng.int(0, slots.length - 1)];
    if (!(level >= 1)) level = 1;

    var affixes = rollAffixes(tier.affixes, tier, rng);
    if (tier.uniqueAffix === true) affixes.push(rollUniqueAffix(tier, rng));

    var item = {
      id: id,
      tier: tier.id,
      tierName: tier.name,
      slotId: slot.id,
      slotName: slot.name,
      level: level,
      reqLevel: requirementFor(tier.id),
      main: {
        stat: slot.mainStat,
        name: statName(slot.mainStat),
        value: mainValue(slot.mainStat, level, tier)
      },
      affixes: affixes
    };
    item.power = powerOf(item);
    return item;
  }

  /** 一件装备的属性折成战斗加成（10-player.js 汇总 6 件时用） */
  function applyTo(totals, item) {
    if (!item) return totals;
    totals[item.main.stat] = (totals[item.main.stat] || 0) + item.main.value;
    for (var i = 0; i < item.affixes.length; i += 1) {
      var affix = item.affixes[i];
      totals[affix.id] = (totals[affix.id] || 0) + affix.value;
    }
    return totals;
  }

  /** 身上 6 件装备的加成总和 */
  function totalsOf(loadout) {
    var totals = {};
    if (!loadout) return totals;
    for (var i = 0; i < BAL.equipment.slots.length; i += 1) {
      applyTo(totals, loadout[BAL.equipment.slots[i].id]);
    }
    return totals;
  }

  /** 空装备栏（6 个部位都是 null） */
  function emptyLoadout() {
    var loadout = {};
    for (var i = 0; i < BAL.equipment.slots.length; i += 1) loadout[BAL.equipment.slots[i].id] = null;
    return loadout;
  }

  /** 装备总战力（HUD 上的「战力」就是它）；空装备栏（null）返回 0 */
  function armoryPower(loadout) {
    var power = 0;
    if (!loadout) return 0;
    for (var i = 0; i < BAL.equipment.slots.length; i += 1) {
      var item = loadout[BAL.equipment.slots[i].id];
      if (item) power += item.power;
    }
    return power;
  }

  /** 显示用：`+12.5 攻击` / `+4.3% 暴击率` */
  function formatValue(stat, value) {
    if (isPercent(stat)) return '+' + (value * 100).toFixed(1) + '% ' + statName(stat);
    return '+' + (Math.round(value * 10) / 10) + ' ' + statName(stat);
  }

  return {
    STAT_NAMES: STAT_NAMES,
    tierById: tierById,
    slotById: slotById,
    statName: statName,
    isPercent: isPercent,
    requirementFor: requirementFor,
    tidy: tidy,
    mainValue: mainValue,
    rollAffixes: rollAffixes,
    rollUniqueAffix: rollUniqueAffix,
    powerOf: powerOf,
    generate: generate,
    applyTo: applyTo,
    totalsOf: totalsOf,
    emptyLoadout: emptyLoadout,
    armoryPower: armoryPower,
    formatValue: formatValue
  };
})();
