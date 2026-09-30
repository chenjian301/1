/**
 * 06-progression.js —— 等级 / 经验 / 金币曲线（阶段 A2 新增，公式来自 01-game-design §6）
 *
 * 硬指标（决策 #4）：1 级 → 20 级约 15 分钟。
 *   need(L)  = 150 × L^1.5            （1→20 累计约 10 万经验）
 *   经验     = (120 + 怪等级 × 60) × (1 + band × 0.15)，精英 ×5
 *   金币     = (4 + 怪等级 × 3)  × (1 + band × 0.10)，精英 ×8
 *   ⚠️ 这三个数是**估算**，要等实机跑一次拿"实测秒/只"反算才算校准（04-decisions #4）。
 *
 * 为什么升级曲线不取整：
 *   `need(L)` 保持浮点，累计值才与 tools\test-logic.mjs 里的断言（100703）逐位一致；
 *   取整只发生在**显示**上（经验条写 "1.2k/2.4k"），以及经验结算入账时。
 *   两边（TS 断言 / 这里）用同一个公式比同一个数，是"两份实现不许偷偷漂移"的锚点。
 */

G.PROG = (function () {
  'use strict';

  var BAL = G.BAL;

  /** 升到下一级还需要多少经验（不取整，见文件头） */
  function xpToNext(level) {
    if (level < 1) level = 1;
    return BAL.progression.needBase * Math.pow(level, BAL.progression.needExponent);
  }

  /** 1 级升到 targetLevel 需要的累计经验（自检用） */
  function totalXpFor(targetLevel) {
    var total = 0;
    for (var level = 1; level < targetLevel; level += 1) total += xpToNext(level);
    return total;
  }

  /** 击杀一只怪的经验（band 越高越多；精英乘 elite.xpMul） */
  function monsterXp(level, band, elite) {
    var base = BAL.progression.xpBase + level * BAL.progression.xpPerLevel;
    var value = base * (1 + band * BAL.progression.xpBandBonus);
    if (elite) value *= BAL.monsters.elite.xpMul;
    return Math.round(value);
  }

  /** 击杀一只怪的金币 */
  function monsterGold(level, band, elite) {
    var base = BAL.progression.goldBase + level * BAL.progression.goldPerLevel;
    var value = base * (1 + band * BAL.progression.goldBandBonus);
    if (elite) value *= BAL.monsters.elite.goldMul;
    return Math.round(value);
  }

  /** 等级带来的基础属性成长（装备词条另算，见 10-player.js） */
  function statsForLevel(level) {
    var grow = Math.max(0, level - 1);
    return {
      attack: BAL.progression.statPerLevel.attack * grow,
      hpPct: BAL.progression.statPerLevel.hpPct * grow
    };
  }

  /**
   * 结算经验：可能一次连升多级（攒了很多怪再一次性结算时会发生）。
   * `state` 是 { level, exp }，本函数就地修改并返回升级次数。
   */
  function applyXp(state, gain) {
    if (!(gain > 0)) return 0;
    state.exp += Math.round(gain);
    var levels = 0;
    while (state.exp >= xpToNext(state.level)) {
      state.exp -= xpToNext(state.level);
      state.level += 1;
      levels += 1;
    }
    return levels;
  }

  /** 战力文案用的紧凑数字：1234 → "1.2k"（经验条 / 金币显示用） */
  function shortNumber(value) {
    var v = Math.round(value);
    if (Math.abs(v) < 1000) return String(v);
    if (Math.abs(v) < 1000000) return (v / 1000).toFixed(1) + 'k';
    return (v / 1000000).toFixed(1) + 'M';
  }

  /** 20 级解锁商城与公会（balance.guild.shopUnlockLevel / unlockLevel） */
  function shopUnlocked(level) {
    return level >= BAL.guild.shopUnlockLevel;
  }

  /** 公会解锁（等级 + 持有号角，号角判定在 guild/shop 层） */
  function guildUnlocked(level) {
    return level >= BAL.guild.unlockLevel;
  }

  /** HUD 上的"我在哪一带"：band → "草原 · 第 3 带" */
  function bandLabel(band) {
    var theme = G.TERRAIN.themeForBand(band);
    return theme.name + ' · 第 ' + band + ' 带';
  }

  return {
    xpToNext: xpToNext,
    totalXpFor: totalXpFor,
    monsterXp: monsterXp,
    monsterGold: monsterGold,
    statsForLevel: statsForLevel,
    applyXp: applyXp,
    shortNumber: shortNumber,
    shopUnlocked: shopUnlocked,
    guildUnlocked: guildUnlocked,
    bandLabel: bandLabel
  };
})();
