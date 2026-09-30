/**
 * 09-equipment.js —— 装备目录（六阶 × 十件）/ 词条 / 战力 / 外观（阶段 A2 新增，A6 改成目录驱动）
 *
 * A6 之前的做法：一件装备 = 等阶 + **随机抽一个部位** + 随机词条 —— 于是"武器"只是一个数值，
 * 既没有名字也没有外观，穿在身上看不出任何区别。
 * A6 起改为**目录驱动**：`balance.equipment.catalog` 里写死 60 件（六阶各 10 件），
 * 每件 = 名字 + 部位（武器 / 衣服 / 鞋子 / 饰品）+ 外观字段 + 阶内序号。
 * `generate()` 先在**该阶的那 10 件里抽一件**，再按等阶抽词条 ——
 * 于是每一件都有名字（"龙牙巨剑"）、有外观（造型 + 配色）、有自己的等级门槛。
 *
 * 四条"定在这里、别处不许再各定一套"的规则：
 *   1. **主属性随掉落等级走**：`(基础 + 每级成长 × (掉落等级-1)) × 等阶倍率 × 阶内系数`。
 *      "掉落等级"取那只怪（或那口箱）的等级 —— 越往远处走，同阶装备也越强，
 *      这正是无限地图"越远越好赚"的兑现方式。
 *   2. **同阶内越靠后越强**：`statMul = 1 + 阶内序号 × catalogStep.statMulPerIndex`（第 10 件 +18%），
 *      同时它的等级门槛也更高（见 requirementForItem）—— 这就是"装备的等级划分"。
 *   3. **外观是一份数据**（lookOfDef）：部位 + 造型 id + 三档配色（a 主色 / b 副色 / c 点缀）。
 *      画在人物身上的是 16-render.js，画成背包内观的是 16-icons.js —— 两边读**同一份 look**，
 *      所以"穿上什么就像什么"不会出现两套说法。
 *   4. **等级门槛 = 等阶门槛 + 阶内台阶**：`base + (阶-1) × perTier + floor(阶内序号 / itemsPerStep)`。
 *      穿之前一律先过 `canWear(item, level)`（20-main 的两个穿戴入口都走它）。
 *
 * 战力：主属性与词条按 `balance.equipment.powerWeights` 折算成一个数，
 * 只用来做"穿上会不会更强"的一眼判断（背包里 ↑↓），不参与任何战斗结算。
 *
 * 阶段 B 起：装备生成必须在服务端做（客户端只发"开这个箱"），否则改包就能出神装。
 * 目录本身就是一份 JSON，搬到服务端即可；这里所有随机都走**传入的 rng**，接口一行都不用改。
 */

G.EQUIP = (function () {
  'use strict';

  var BAL = G.BAL;

  /** 部位顺序（与 balance.equipment.slots 一一对应，不许各写一套） */
  var SLOT_IDS = ['weapon', 'armor', 'boots', 'trinket'];

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

  /** 阶内序号缓存：目录是常量，算一次就够（键加前缀，避免和 Object 原名撞上） */
  var indexCache = null;

  function slotIds() {
    return SLOT_IDS;
  }

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

  /** 这个部位 id 是否存在（存档迁移与"穿装备"都要问它） */
  function hasSlot(slotId) {
    return slotById(slotId) !== null;
  }

  function statName(stat) {
    return STAT_NAMES[stat] || stat;
  }

  function isPercent(stat) {
    return PERCENT_STATS[stat] === true;
  }

  /* ------------------------------------------------------------ 目录（60 件） */

  function catalog() {
    return BAL.equipment.catalog;
  }

  function buildIndexCache() {
    indexCache = {};
    var tiers = BAL.equipment.tiers;
    for (var t = 0; t < tiers.length; t += 1) {
      var n = 0;
      for (var i = 0; i < BAL.equipment.catalog.length; i += 1) {
        var def = BAL.equipment.catalog[i];
        if (def.tier === tiers[t].id) {
          indexCache['#' + def.id] = n;
          n += 1;
        }
      }
    }
    return indexCache;
  }

  /** 一件目录装备在**自己那一阶里**的序号（0 起）：同阶内越靠后越强、门槛越高 */
  function indexInTier(defId) {
    if (!indexCache) buildIndexCache();
    var index = indexCache['#' + defId];
    return index === undefined ? 0 : index;
  }

  /** 某一阶的全部目录装备（按目录里的顺序；generate 就在这份里抽） */
  function catalogForTier(tierId) {
    var out = [];
    for (var i = 0; i < BAL.equipment.catalog.length; i += 1) {
      if (BAL.equipment.catalog[i].tier === tierId) out.push(BAL.equipment.catalog[i]);
    }
    return out;
  }

  function defById(defId) {
    for (var i = 0; i < BAL.equipment.catalog.length; i += 1) {
      if (BAL.equipment.catalog[i].id === defId) return BAL.equipment.catalog[i];
    }
    return null;
  }

  /** 阶内系数：第 1 件 ×1.00、第 10 件 ×(1 + 9 × step) */
  function statMulOf(def) {
    var step = BAL.equipment.catalogStep.statMulPerIndex;
    return 1 + indexInTier(def.id) * step;
  }

  /** 等阶门槛（只要这一阶的**最低**门槛时用它；具体到某一件见 requirementForItem） */
  function requirementFor(tierId) {
    var rule = BAL.equipment.levelRequirement;
    return rule.base + (tierId - 1) * rule.perTier;
  }

  /** 某一件的等级门槛：等阶门槛 + 阶内台阶（每 itemsPerStep 件上一级） */
  function requirementForItem(def) {
    var rule = BAL.equipment.levelRequirement;
    var step = rule.itemsPerStep > 0 ? rule.itemsPerStep : 4;
    return rule.base + (def.tier - 1) * rule.perTier + Math.floor(indexInTier(def.id) / step);
  }

  /** 等级够不够穿（界面只用它决定提示文案，真正的拦截在 20-main） */
  function canWear(item, level) {
    if (!item || !hasSlot(item.slotId)) return false;
    return level >= item.reqLevel;
  }

  /**
   * 外观描述（渲染层与图标层共用的一份数据）：{ slot, style, a, b, c, tier }
   * 三档配色对四个部位的语义：
   *   武器 a=刃 b=柄 c=护手 / 衣服 a=衣 b=边 / 鞋 a=鞋面 b=鞋底 / 饰品 a=宝石 b=金属
   */
  function lookOfDef(def) {
    if (!def) return null;
    if (def.slot === 'weapon') return { slot: 'weapon', style: def.weapon, a: def.blade, b: def.grip, c: def.guard, tier: def.tier };
    if (def.slot === 'armor') return { slot: 'armor', style: def.armor, a: def.cloth, b: def.trim, c: def.trim, tier: def.tier };
    if (def.slot === 'boots') return { slot: 'boots', style: def.boots, a: def.color, b: def.sole, c: def.color, tier: def.tier };
    return { slot: 'trinket', style: def.trinket, a: def.gem, b: def.metal, c: def.gem, tier: def.tier };
  }

  /** 空外观（四个部位都没有）—— 渲染层拿到的永远是一份完整结构，不用到处判空 */
  function emptyLook() {
    return { weapon: null, armor: null, boots: null, trinket: null };
  }

  /** 身上四件装备的外观（值就是上面那份 look），渲染与图标都读它 */
  function lookOf(loadout) {
    var look = emptyLook();
    if (!loadout) return look;
    for (var i = 0; i < SLOT_IDS.length; i += 1) {
      var item = loadout[SLOT_IDS[i]];
      if (item && item.look) look[SLOT_IDS[i]] = item.look;
    }
    return look;
  }

  /* ------------------------------------------------------------ 数值与词条 */

  /** 数值取整：百分比保留 4 位、生命取整、其余保留 1 位 */
  function tidy(stat, value) {
    if (isPercent(stat)) {
      var scaled = Math.round(value * 10000) / 10000;
      return scaled === 0 ? 0 : scaled;
    }
    if (stat === 'hp') return Math.round(value);
    return Math.round(value * 10) / 10;
  }

  /** 主属性数值：基础 + 每级成长 × (掉落等级-1)，再乘等阶倍率（阶内系数在 generate 里乘） */
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
   * 生成一件装备：**在该阶的 10 件里抽一件**（名字 / 部位 / 外观 / 等级门槛都随目录），
   * 再按等阶抽词条，主属性乘上阶内系数。
   * `id` 由调用方给（存档里的自增号），这样同一次掉落重放两次也拿到同一个 id。
   */
  function generate(tierId, level, rng, id) {
    var tier = tierById(tierId);
    var pool = catalogForTier(tier.id);
    if (pool.length === 0) pool = BAL.equipment.catalog;
    var def = pool[rng.int(0, pool.length - 1)];
    var slot = slotById(def.slot) || BAL.equipment.slots[0];
    if (!(level >= 1)) level = 1;

    var affixes = rollAffixes(tier.affixes, tier, rng);
    if (tier.uniqueAffix === true) affixes.push(rollUniqueAffix(tier, rng));

    var mul = statMulOf(def);
    var item = {
      id: id,
      defId: def.id,
      name: def.name,
      tier: tier.id,
      tierName: tier.name,
      slotId: def.slot,
      slotName: slot.name,
      level: level,
      reqLevel: requirementForItem(def),
      statMul: Math.round(mul * 1000) / 1000,
      main: {
        stat: slot.mainStat,
        name: statName(slot.mainStat),
        value: tidy(slot.mainStat, mainValue(slot.mainStat, level, tier) * mul)
      },
      affixes: affixes,
      look: lookOfDef(def)
    };
    item.power = powerOf(item);
    return item;
  }

  /** 一件装备的属性折成战斗加成（10-player.js 汇总 4 件时用） */
  function applyTo(totals, item) {
    if (!item) return totals;
    totals[item.main.stat] = (totals[item.main.stat] || 0) + item.main.value;
    for (var i = 0; i < item.affixes.length; i += 1) {
      var affix = item.affixes[i];
      totals[affix.id] = (totals[affix.id] || 0) + affix.value;
    }
    return totals;
  }

  /** 身上 4 件装备的加成总和 */
  function totalsOf(loadout) {
    var totals = {};
    if (!loadout) return totals;
    for (var i = 0; i < SLOT_IDS.length; i += 1) {
      applyTo(totals, loadout[SLOT_IDS[i]]);
    }
    return totals;
  }

  /** 空装备栏（4 个部位都是 null） */
  function emptyLoadout() {
    var loadout = {};
    for (var i = 0; i < SLOT_IDS.length; i += 1) loadout[SLOT_IDS[i]] = null;
    return loadout;
  }

  /** 装备总战力（HUD 上的「战力」就是它）；空装备栏（null）返回 0 */
  function armoryPower(loadout) {
    var power = 0;
    if (!loadout) return 0;
    for (var i = 0; i < SLOT_IDS.length; i += 1) {
      var item = loadout[SLOT_IDS[i]];
      if (item) power += item.power;
    }
    return power;
  }

  /** 显示用：`+12.5 攻击` / `+4.3% 暴击率` */
  function formatValue(stat, value) {
    if (isPercent(stat)) return '+' + (value * 100).toFixed(1) + '% ' + statName(stat);
    return '+' + (Math.round(value * 10) / 10) + ' ' + statName(stat);
  }

  /** 界面文案：`天赐 天命之剑`（阶名 + 装备名；卡面与提示共用一份） */
  function labelOf(item) {
    if (!item) return '空';
    return (item.tierName || tierById(item.tier).name) + ' ' + (item.name || item.slotName);
  }

  return {
    SLOT_IDS: SLOT_IDS,
    STAT_NAMES: STAT_NAMES,
    slotIds: slotIds,
    tierById: tierById,
    slotById: slotById,
    hasSlot: hasSlot,
    statName: statName,
    isPercent: isPercent,
    catalog: catalog,
    catalogForTier: catalogForTier,
    defById: defById,
    indexInTier: indexInTier,
    statMulOf: statMulOf,
    requirementFor: requirementFor,
    requirementForItem: requirementForItem,
    canWear: canWear,
    lookOfDef: lookOfDef,
    emptyLook: emptyLook,
    lookOf: lookOf,
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
    formatValue: formatValue,
    labelOf: labelOf
  };
})();
