/**
 * 08-loot.js —— 六阶宝箱：掉落、等阶抽奖、保底（阶段 A2 新增）
 *
 * 规则（01-game-design §7 + balance.chests）：
 *   - 掉不掉：普通怪 `base 8% + band×1%`（上限 20%），精英固定 25%；
 *   - 掉哪一阶：按 tiers[].weight 抽，并按 `bandGrowth^band` 让高阶箱随距离变常见；
 *     精英至少给**专家箱**（balance.chests.drop.eliteMinTier）—— 兑现文档里"精英必出 ≥ 专家箱"；
 *   - **保底**：连续 50 箱未出「史诗」→ 下一箱强制 ≥ 史诗；连续 500 箱未出「神话」→ 强制 ≥ 神话。
 *     计数器存在存档里（chest_stat.pity_epic / pity_mythic，压到服务端时同一套语义）。
 *   - 面板只读这里：`countByTier(chests)` 按阶数出背包里有几口箱（A13 的宝箱清单读它，**不看袋子顺序**）。
 *
 * A14（用户："宝箱可以设置是否自动开启——对应不同等阶不同的开启按钮"）：本文件末尾挂着那一套
 * `defaultAutoFlags / autoEnabled / autoCount` —— 一阶一枚的**自动开启**开关（默认全关）。
 * 勾上的那一阶掉出来就当场开掉（真正开箱的 `autoOpenChest` 在 20-main），判定集中在这里，
 * 于是"开关表坏了 / 老存档没有这个字段怎么办"只有一个答案：当关。
 *
 * 归属（决策 #1）：宝箱与经验一样，只给**对该怪累计伤害最高**的玩家 —— 这里只负责"抽"，谁抽由
 * 07-combat 的 rewardWinnerId() 决定，两者拼起来才是完整规则。
 *
 * 阶段 B 起：抽奖必须在服务端做（客户端只发"开这个箱"），否则改包就能出神装。
 * 本文件的接口刻意设计成"传入 rng" —— 服务端换成服务端随机流即可，一行不用改。
 */

G.LOOT = (function () {
  'use strict';

  var BAL = G.BAL;

  /** 六阶箱定义（1 普通 → 6 天赐） */
  function tiers() {
    return BAL.chests.tiers;
  }

  function tierById(id) {
    for (var i = 0; i < BAL.chests.tiers.length; i += 1) {
      if (BAL.chests.tiers[i].id === id) return BAL.chests.tiers[i];
    }
    return BAL.chests.tiers[0];
  }

  /** 这只怪掉不掉箱子 */
  function dropChance(band, elite) {
    if (elite) return BAL.chests.drop.elite;
    var chance = BAL.chests.drop.base + band * BAL.chests.drop.perBand;
    return chance > BAL.chests.drop.cap ? BAL.chests.drop.cap : chance;
  }

  /** 按 band 调整后的六阶权重：高阶箱随距离变常见（梯子的"越远越好赚"） */
  function tierWeights(band) {
    var weights = [];
    for (var i = 0; i < BAL.chests.tiers.length; i += 1) {
      var tier = BAL.chests.tiers[i];
      weights.push(tier.weight * Math.pow(tier.bandGrowth, band));
    }
    return weights;
  }

  /**
   * 抽一只箱子的**等阶**（怪死时调用一次）。
   * `pity` 是就地的保底计数器 { epic, mythic }，本函数会更新它。
   */
  function rollChestTier(band, elite, rng, pity) {
    var mytiers = BAL.chests.tiers;
    var minTier = 1;
    if (elite && BAL.chests.drop.eliteMinTier > 1) minTier = BAL.chests.drop.eliteMinTier;

    // 保底优先：神话保底 > 史诗保底（先看更稀有的那一个）
    var forced = 0;
    if (pity.mythic >= BAL.chests.pity.mythic) forced = 5;
    else if (pity.epic >= BAL.chests.pity.epic) forced = 3;

    var picked;
    if (forced > 0) {
      picked = forced;
      // 保底生效时就地重抽（仍按权重，但只在 ≥ 门槛的档位里抽）
      var weights = tierWeights(band);
      var pool = [];
      var poolWeights = [];
      for (var i = 0; i < mytiers.length; i += 1) {
        if (mytiers[i].id >= Math.max(forced, minTier)) {
          pool.push(mytiers[i]);
          poolWeights.push(weights[i]);
        }
      }
      picked = pool[rng.weightedIndex(poolWeights)].id;
    } else {
      var allWeights = tierWeights(band);
      var index = rng.weightedIndex(allWeights);
      picked = mytiers[index].id;
      if (picked < minTier) picked = minTier;
    }

    // 更新保底：没摸到史诗/神话就 +1，摸到了就清零
    if (picked >= 5) {
      pity.mythic = 0;
      pity.epic = 0;
    } else if (picked >= 3) {
      pity.epic = 0;
      pity.mythic += 1;
    } else {
      pity.epic += 1;
      pity.mythic += 1;
    }
    return picked;
  }

  /** 开箱结果里显示的箱子名（"传说宝箱"） */
  function tierName(tierId) {
    return tierById(tierId).name + '宝箱';
  }

  /** 分解价值（金币）：用该阶的 salvageGold */
  function salvageGold(tierId) {
    return tierById(tierId).salvageGold;
  }

  /** 宝箱背包是否已满（满了自动分解成金币，挂机一整晚也不会爆背包） */
  function bagFull(bagCount) {
    return bagCount >= BAL.chests.bagCap;
  }

  /** 宝箱背包上限 */
  function bagCap() {
    return BAL.chests.bagCap;
  }

  /**
   * 宝箱背包**按阶计数**（A13 的宝箱清单只读它）：返回长度 = 阶数的一串数，`[0]` 是一阶箱的个数。
   * 只数**合法阶号**的箱子（坏数据既不会多占一行，也不会把清单撑破），也不看袋子里的先后顺序 ——
   * 面板要的是"普通 × 12 / 天赐 × 1"，不是"第 8 口是什么"。
   */
  function countByTier(chests) {
    var counts = [];
    var i;
    for (i = 0; i < BAL.chests.tiers.length; i += 1) counts.push(0);
    for (i = 0; i < chests.length; i += 1) {
      var tier = chests[i] ? chests[i].tier : 0;
      if (tier >= 1 && tier <= counts.length) counts[tier - 1] += 1;
    }
    return counts;
  }

  /* ------------------------------------------------ A14：按阶的「自动开启」开关 */

  /**
   * 自动开启开关表的默认值（A14）：**一阶一枚、默认全关**。
   * 它是\"玩家勾的偏好\"而不是数值平衡，所以真正的家在存档 `settings.chestAuto`（11-save 的
   * `defaultSettings` 直接调这个函数）—— 两边永远同一份，改阶数也不会让开关表长度对不上。
   */
  function defaultAutoFlags() {
    var flags = [];
    for (var i = 0; i < BAL.chests.tiers.length; i += 1) flags.push(false);
    return flags;
  }

  /**
   * 这一阶勾了\"自动开启\"没有（A14）：就是 `flags[tier - 1] === true`。
   * 老存档没有这个字段 / 坏值 / 长度对不上 / 阶号离谱 —— 一律当**关**：宁可不开，也别替玩家花掉箱子。
   */
  function autoEnabled(flags, tierId) {
    if (!flags || typeof flags !== 'object') return false;
    if (!(tierId >= 1) || tierId > BAL.chests.tiers.length) return false;
    return flags[tierId - 1] === true;
  }

  /** 勾了几阶（0 = 全关）：宝箱面板小标题里那句\"自动 N 阶\"用的就是它 */
  function autoCount(flags) {
    var total = 0;
    for (var i = 0; i < BAL.chests.tiers.length; i += 1) {
      if (autoEnabled(flags, i + 1)) total += 1;
    }
    return total;
  }

  return {
    tiers: tiers,
    tierById: tierById,
    tierName: tierName,
    dropChance: dropChance,
    tierWeights: tierWeights,
    rollChestTier: rollChestTier,
    salvageGold: salvageGold,
    bagFull: bagFull,
    bagCap: bagCap,
    countByTier: countByTier,
    defaultAutoFlags: defaultAutoFlags,
    autoEnabled: autoEnabled,
    autoCount: autoCount
  };
})();
