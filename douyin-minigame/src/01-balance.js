/* AUTO-GENERATED FILE -- DO NOT EDIT.
 *
 * Source of truth: shared\balance.json -- the single place gameplay numbers live.
 * Regenerate after editing balance.json:
 *
 *   powershell -ExecutionPolicy Bypass -File tools\gen-minigame-balance.ps1
 *   powershell -ExecutionPolicy Bypass -File tools\build-minigame.ps1
 * (or simply run tools\minigame-now.cmd, which does both plus the checks)
 *
 * balance.json sha256, raw file format                  = b2f18a320cf82c09c7120459a9e8446cf96a6a5ecfb4542e2b86c68fcdef55a8
 * balance.json sha256, normalised (BOM stripped, CRLF -> LF) = cc899c21acb586a1a19c7009e0beba10333fdcd19ddba8b0125ebbcfb8daa53b
 * tools\check-minigame.ps1 fails if the normalised hash no longer matches balance.json.
 *
 * NOTE: this header is ASCII on purpose -- see tools\gen-minigame-balance.ps1.
 * The JSON body below is embedded verbatim, so non-ASCII text inside it (monster names,
 * the _readme line) is exactly what shared\balance.json contains.
 */

G.BAL_SOURCE_SHA256 = 'cc899c21acb586a1a19c7009e0beba10333fdcd19ddba8b0125ebbcfb8daa53b';
G.BAL ={
  "_readme": "唯一真相：玩法数值与掉落表（决策 #4）。客户端与服务端共读这一份，谁都不许在代码里另写一套数字。改完必须重跑 tools/test-logic.mjs。",
  "version": 1,

  "season": {
    "name": "S1",
    "worldSeed": 20260930
  },

  "world": {
    "chunkSize": 512,
    "bandSize": 1000,
    "tileSize": 64,
    "monstersPerChunk": { "min": 1, "max": 3 },
    "eliteChance": 0.08,
    "eliteMaxPerChunk": 1,
    "decorPerChunk": { "min": 8, "max": 24 },
    "landmarkChunkSpan": 5,
    "respawnMs": { "min": 15000, "max": 30000 },
    "chunkIdleDropMs": 120000,
    "spawnRing": { "min": 300, "max": 800 }
  },

  "monsters": {
    "levelPerBand": 3,
    "levelJitter": 2,
    "hpPerLevel": 0.15,
    "attackPerLevel": 0.12,
    "swarmSize": { "min": 2, "max": 3 },
    "critChance": 0.02,
"critDamage": 1.5,
    "wanderSpeedRatio": 0.35,
    "kinds": [
      {
        "id": "wolf",
        "name": "荒狼",
        "weight": 40,
        "hp": 90,
        "attack": 12,
        "defense": 4,
        "speed": 118,
        "radius": 26,
        "attackRange": 46,
        "attackIntervalMs": 1100,
        "ranged": false,
        "aggroRange": 320,
        "leashRange": 900
      },
      {
        "id": "bat",
        "name": "血蝠",
        "weight": 30,
        "hp": 55,
        "attack": 9,
        "defense": 1,
        "speed": 150,
        "radius": 20,
        "attackRange": 42,
        "attackIntervalMs": 900,
        "ranged": false,
        "aggroRange": 260,
        "leashRange": 800,
        "swarm": true
      },
      {
        "id": "mage",
        "name": "游魂法师",
        "weight": 20,
        "hp": 70,
        "attack": 16,
        "defense": 2,
        "speed": 96,
        "radius": 24,
        "attackRange": 260,
        "attackIntervalMs": 1600,
        "ranged": true,
        "aggroRange": 380,
        "leashRange": 1000
      },
      {
        "id": "brute",
        "name": "重甲兵",
        "weight": 10,
        "hp": 220,
        "attack": 20,
        "defense": 10,
        "speed": 78,
        "radius": 32,
        "attackRange": 54,
        "attackIntervalMs": 1500,
        "ranged": false,
        "aggroRange": 300,
        "leashRange": 900
      }
    ],
    "elite": {
      "hpMul": 5,
      "attackMul": 1.6,
      "defenseMul": 2,
      "dropMul": 3.125,
      "xpMul": 5,
      "goldMul": 8,
      "radiusMul": 1.25
    }
  },

  "progression": {
    "needBase": 150,
    "needExponent": 1.5,
    "xpBase": 120,
    "xpPerLevel": 60,
    "xpBandBonus": 0.15,
    "goldBase": 4,
    "goldPerLevel": 3,
    "goldBandBonus": 0.1,
    "statPerLevel": { "attack": 2, "hpPct": 0.01 },
    "softLevelHint": 60,
    "targetLevel": 20,
    "targetMinutes": 15
  },

  "player": {
    "baseHp": 600,
    "baseAttack": 30,
    "baseDefense": 5,
    "moveSpeed": 210,
    "radius": 24,
    "attackRange": 72,
    "attackSpeed": 1.6,
    "critChance": 0.05,
    "critDamage": 1.5,
    "damageReduction": 0,
    "pickupRange": 90,
    "respawnDelayMs": 3000,
    "reviveHpRatio": 0.5
  },

  "combat": {
    "defenseFactor": 0.6,
    "targetIntervalMs": 100,
    "firstHitProtectionMs": 0,
    "damageShareGate": 0,
    "visionRange": 540,
"knockbackDecayPerTick": 0.18,
    "projectileMs": 220,
    "monsterKnockback": 60,
    "playerKnockback": 150,
    "hurtMs": 320,
    "dieMs": 1400
  },

  "chests": {
    "tiers": [
      { "id": 1, "name": "普通", "weight": 8800, "bandGrowth": 1.0, "salvageGold": 10 },
      { "id": 2, "name": "专家", "weight": 1000, "bandGrowth": 1.03, "salvageGold": 60 },
      { "id": 3, "name": "史诗", "weight": 180, "bandGrowth": 1.06, "salvageGold": 240 },
      { "id": 4, "name": "传说", "weight": 18, "bandGrowth": 1.09, "salvageGold": 900 },
      { "id": 5, "name": "神话", "weight": 1.8, "bandGrowth": 1.12, "salvageGold": 3600 },
      { "id": 6, "name": "天赐", "weight": 0.2, "bandGrowth": 1.15, "salvageGold": 12000 }
    ],
    "drop": { "base": 0.08, "perBand": 0.01, "cap": 0.2, "elite": 0.25, "eliteMinTier": 2 },
    "pity": { "epic": 50, "mythic": 500 },
    "bagCap": 200
  },

  "equipment": {
    "slots": [
      { "id": "weapon", "name": "武器", "mainStat": "attack" },
      { "id": "helmet", "name": "头盔", "mainStat": "hp" },
      { "id": "armor", "name": "护甲", "mainStat": "defense" },
      { "id": "gloves", "name": "手套", "mainStat": "attack" },
      { "id": "boots", "name": "鞋", "mainStat": "defense" },
      { "id": "trinket", "name": "饰品", "mainStat": "hp" }
    ],
    "tiers": [
      { "id": 1, "name": "普通", "affixes": 1, "multiplier": 1.0 },
      { "id": 2, "name": "专家", "affixes": 2, "multiplier": 1.35 },
      { "id": 3, "name": "史诗", "affixes": 3, "multiplier": 1.85 },
      { "id": 4, "name": "传说", "affixes": 4, "multiplier": 2.6 },
      { "id": 5, "name": "神话", "affixes": 5, "multiplier": 3.7 },
      { "id": 6, "name": "天赐", "affixes": 5, "multiplier": 5.3, "uniqueAffix": true }
    ],
    "mainStatBase": { "attack": 6, "hp": 40, "defense": 3 },
    "mainStatPerLevel": { "attack": 0.9, "hp": 6.5, "defense": 0.45 },
    "levelRequirement": { "perTier": 3, "base": 1 },
    "affixes": [
      { "id": "attack", "name": "攻击", "weight": 100, "min": 2, "max": 6, "percent": false },
      { "id": "hp", "name": "生命", "weight": 100, "min": 20, "max": 60, "percent": false },
      { "id": "defense", "name": "防御", "weight": 90, "min": 1, "max": 4, "percent": false },
      { "id": "attackSpeed", "name": "攻速", "weight": 45, "min": 0.02, "max": 0.06, "percent": true },
      { "id": "critChance", "name": "暴击率", "weight": 40, "min": 0.01, "max": 0.03, "percent": true },
      { "id": "critDamage", "name": "暴击伤害", "weight": 40, "min": 0.05, "max": 0.15, "percent": true },
      { "id": "damage", "name": "增伤", "weight": 30, "min": 0.02, "max": 0.08, "percent": true },
      { "id": "damageReduction", "name": "减伤", "weight": 30, "min": 0.01, "max": 0.05, "percent": true },
      { "id": "xpBonus", "name": "经验加成", "weight": 35, "min": 0.05, "max": 0.15, "percent": true },
      { "id": "goldBonus", "name": "金币加成", "weight": 35, "min": 0.05, "max": 0.15, "percent": true },
      { "id": "pickupRange", "name": "拾取范围", "weight": 25, "min": 10, "max": 30, "percent": false }
    ],
    "powerWeights": {
      "attack": 2,
      "hp": 0.4,
      "defense": 1.5,
      "attackSpeed": 200,
      "critChance": 400,
      "critDamage": 80,
      "damage": 300,
      "damageReduction": 300,
      "xpBonus": 20,
      "goldBonus": 20,
      "pickupRange": 0.2
    }
  },

  "shop": {
    "horn": { "id": "guild_horn", "name": "公会号角", "priceGold": 500 }
  },

  "guild": {
    "memberCap": 20,
    "anchorMinDistance": 2000,
    "teleportCooldownMs": 300000,
    "teleportCombatLockMs": 3000,
    "unlockLevel": 20,
    "shopUnlockLevel": 20
  },

  "input": {
    "stickRadius": 72,
    "knobDiameter": 34,
    "deadZone": 0.18,
    "pressFeedbackMs": 140,
    "zoneWidthRatio": 0.42,
    "zoneHeightRatio": 0.52,
    "attackButtonDiameter": 96,
    "attackButtonMargin": 28
  },

  "view": {
    "designWidth": 720,
    "damageNumberMs": 700,
"cameraLerpPerTick": 0.22,
    "autosaveMs": 5000,
    "safeBottom": 120,
    "safeTop": 96,
    "loadRingChunks": 1,
    "chunkCacheLimit": 48,
    "hudDamageNumberCap": 40
  }
};
