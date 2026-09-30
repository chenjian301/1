/**
 * 08-loot.js —— 六阶宝箱：掉落、等阶抽奖、保底（阶段 A2 新增）
 *
 * 规则（01-game-design §7 + balance.chests）：
 *   - 掉不掉：普通怪 `base 8% + band×1%`（上限 20%），精英固定 25%；
 *   - 掉哪一阶：按 tiers[].weight 抽，并按 `bandGrowth^band` 让高阶箱随距离变常见；
 *     精英至少给**专家箱**（balance.chests.drop.eliteMinTier）—— 兑现文档里"精英必出 ≥ 专家箱"；
 *   - **保底**：连续 50 箱未出「史诗」→ 下一箱强制 ≥ 史诗；连续 500 箱未出「神话」→ 强制 ≥ 神话。
 *     计数器存在存档里（chest_stat.pity_epic / pity_mythic，压到服务端时同一套语义）。
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

  return {
    tiers: tiers,
    tierById: tierById,
    tierName: tierName,
    dropChance: dropChance,
    tierWeights: tierWeights,
    rollChestTier: rollChestTier,
    salvageGold: salvageGold,
    bagFull: bagFull,
    bagCap: bagCap
  };
})();
