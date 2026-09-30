/* AUTO-GENERATED FILE -- DO NOT EDIT.
 *
 * Assembled from douyin-minigame\src\*.js by tools\build-minigame.ps1.
 * Parts (in order): 00-config.js, 01-balance.js, 02-rng.js, 03-chunk.js, 04-terrain.js, 05-spawn.js, 06-progression.js, 07-combat.js, 08-loot.js, 09-equipment.js, 10-player.js, 11-save.js, 12-platform.js, 13-screen.js, 14-world.js, 15-input.js, 16-render.js, 17-hud.js, 18-panels.js, 19-selftest.js, 20-main.js
 * parts sha256 = b3c45440d8c0eeb45a073392254e620b37d972eac0b6b9e04f92ef0cda65d903
 *
 * Edit files under douyin-minigame\src\ and rebuild:
 *   powershell -ExecutionPolicy Bypass -File tools\build-minigame.ps1
 * or run the whole local loop (generate + build + static check + node selftest):
 *   tools\minigame-now.cmd
 *
 * NOTE: this header is ASCII on purpose (see tools\gen-minigame-balance.ps1).
 */
/**
 * 00-config.js —— 全局命名空间与工程配置（**手改这里，不要改生成物 game.js**）
 *
 * 为什么整个工程只有一个全局对象 `G`：
 *   小游戏入口必须是**一个自包含的 game.js**（官方模板与上一版工程都这么做：
 *   `require()` 的支持情况随基础库版本变化，而主包只允许一个入口文件）。
 *   所以 `src\*.js` 是"按名字排序后直接拼接"的源码分片，拼接后**共享同一个作用域**。
 *   共享作用域最怕两件事：名字撞车、以及"不知道谁定义了谁"。用 `G.模块名 = (function(){...})()`
 *   这一种写法把两者一起解决：模块内部全是函数作用域，对外只暴露一个 `G.xxx`。
 *
 * 三条红线（`tools\check-minigame.ps1` 会静态扫，违反直接 FAIL）：
 *   1. 逻辑层（02~11）**不许**出现 `tt.` —— 平台差异只允许待在 12-platform.js；
 *   2. 任何分片**不许**出现 `document` / `window` / `localStorage` / `require(` / `import `；
 *   3. 随机只准走 `G.RNG`，**不许** `Math.random`（无限地图要"同坐标同内容"）。
 *
 * 这个文件在拼接顺序里排第一（按文件名排序），所以它是**唯一**声明 `var G` 的地方。
 */

/** 全局命名空间：所有分片都往上面挂模块，拼接后就是一份"单文件多模块"的工程 */
var G = {};

/** 工程配置（与数值无关的东西放这里；数值一律在 shared/balance.json） */
G.CONFIG = {
  /**
   * 抖音云服务域名。留空 = 不发任何网络请求（默认，单机可玩）。
   * 部署完抖音云之后，把控制台给的访问域名粘到这里，末尾不要带斜杠，例如：
   *   cloudBase: 'https://1mfj3tamsd9m-env-XHvhMYJ9qm.service.douyincloud.run'
   * 粘贴完在游戏里点「设置 → 云后端」就能自测连通性（见 docs/douyin-cloud-deploy.md）。
   */
  cloudBase: 'https://1mfjj3tamsd9m-env-XHvhMYJ9qm.service.douyincloud.run',

  /** 是否显示调试入口（自检 / 云后端 / 存档 / 世界指纹）。上线前置 false 即可，代码不用删 */
  debug: true,

  /** 开箱后是否自动穿戴"战力更高"的装备（旧件自动分解成金币） */
  autoEquipBetter: true,

  /** 本地存档的 storage key（换名字 = 换一份存档，调试用） */
  saveKey: 'phaser-game-save-v1',

  /** 本机账号的 storage key（注册 / 登录后的账号记录，见 11-save.js 的 G.ACCOUNT） */
  accountKey: 'phaser-game-account-v1',

  /** 本机已占用昵称的注册表 key（同设备昵称不重复的第二道保险） */
  namesKey: 'phaser-game-names-v1',

  /** 逻辑帧固定 60Hz（渲染尽量跟着屏幕刷新，逻辑不跟着变，手感才稳定） */
  logicHz: 60,

  /** 单帧最多追赶多少逻辑步（切后台回来时避免"一顿狂算"） */
  maxCatchUpSteps: 5
};

/* AUTO-GENERATED FILE -- DO NOT EDIT.
 *
 * Source of truth: shared\balance.json -- the single place gameplay numbers live.
 * Regenerate after editing balance.json:
 *
 *   powershell -ExecutionPolicy Bypass -File tools\gen-minigame-balance.ps1
 *   powershell -ExecutionPolicy Bypass -File tools\build-minigame.ps1
 * (or simply run tools\minigame-now.cmd, which does both plus the checks)
 *
 * balance.json sha256, raw file format                  = b1382118064c6d2999aeb67a25bc00eb9ee263e37d2be33c4a9ffa2dba544661
 * balance.json sha256, normalised (BOM stripped, CRLF -> LF) = 34ae06dc4f051092afe6eab0f09cf714fb3ff3ed327ff933af6ab7a09c032afa
 * tools\check-minigame.ps1 fails if the normalised hash no longer matches balance.json.
 *
 * NOTE: this header is ASCII on purpose -- see tools\gen-minigame-balance.ps1.
 * The JSON body below is embedded verbatim, so non-ASCII text inside it (monster names,
 * the _readme line) is exactly what shared\balance.json contains.
 */

G.BAL_SOURCE_SHA256 = '34ae06dc4f051092afe6eab0f09cf714fb3ff3ed327ff933af6ab7a09c032afa';
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
    "_camp": "原点新手营地：玩家出生地 + 视觉安全区（阶段 A 只做外观，怪照样刷新）",
    "camp": { "radius": 900, "plazaPlate": 96, "fenceRadius": 824, "gateWidth": 220 },
    "_road": "路网：每 spanChunks 个 chunk 一个节点，节点连成 L 形小径（确定性，纯哈希）",
    "road": { "spanChunks": 6, "width": 46, "jitterChunks": 0.35 },
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

  "auto": {
    "_readme": "自动战斗按钮（A4）：开启后自动走向视野内最近的怪，进攻击距离就站住（出手仍由 14-world 的自动攻击负责）",
    "moveStopRatio": 0.82,
    "retargetMs": 500
  },

  "account": {
    "_readme": "账号与昵称（A4）：昵称长度按字符数算；唯一性先查本机注册表，配了云后端再查服务端",
    "nameMin": 2,
    "nameMax": 12,
    "nameRegistryCap": 200
  },

  "audio": {
    "_readme": "音频（A4）：声音文件由 tools\\gen-minigame-sfx.mjs 生成到 douyin-minigame\\audio\\（hit/crit/kill/hurt/levelup/chest/ui/camp/bgm）；这里是总开关与音量",
    "enabled": true,
    "sfxVolume": 0.6,
    "bgmVolume": 0.32
  },

  "input": {
    "stickRadius": 72,
    "knobDiameter": 34,
    "deadZone": 0.18,
    "pressFeedbackMs": 140,
    "zoneWidthRatio": 0.42,
    "zoneHeightRatio": 0.52,
    "attackButtonDiameter": 96,
    "attackButtonMargin": 28,
    "autoButtonDiameter": 96
  },

  "view": {
    "designWidth": 720,
    "minimap": { "size": 190, "margin": 18, "chunkRadius": 3 },
    "_panel": "面板卡片：宽 = 屏宽 - leftMargin - rightReserve（rightReserve 给右下功能键让位），高 = 屏高 x heightRatio。0.79 x 0.38 约等于 1/3 屏面积",
    "panel": {
      "leftMargin": 24,
      "rightReserve": 124,
      "heightRatio": 0.38,
      "headerHeight": 78,
      "rowHeight": 62,
      "touchSlop": 12,
      "dimAlpha": 0.32
    },
    "nameplate": { "barWidth": 104, "barHeight": 10, "offsetY": 30 },
    "hud": { "avatarRadius": 40, "expBarHeight": 20, "buttonLift": 46 },
    "damageNumberMs": 700,
    "_feel": "打击感（A4）：斩击特效时长 / 受击顿帧 / 暴击震屏 —— 都是表现层，不进任何随机流",
    "slashMs": 220,
    "slashCap": 24,
    "hitStopMs": { "normal": 45, "crit": 110, "hurt": 30 },
    "shake": { "critMs": 240, "critPower": 26, "hurtMs": 150, "hurtPower": 12 },
"cameraLerpPerTick": 0.22,
    "autosaveMs": 5000,
    "safeBottom": 120,
    "safeTop": 96,
    "loadRingChunks": 1,
    "chunkCacheLimit": 48,
    "hudDamageNumberCap": 40
  }
};

/**
 * 02-rng.js —— 确定性伪随机（core/rng.ts 的小游戏实现，逻辑逐位等价）
 *
 * 为什么必须自己写，而不用 Math.random：
 *   无限地图**不是数据，是函数**：`hash32(seed, cx, cy, salt) → 这个 chunk 的全部内容`。
 *   同一个坐标在手机、模拟器、将来的服务端必须算出**一模一样**的结果（决策 #1 的前提）。
 *   所以：
 *     1. 全程只做 32 位整数运算（Math.imul / >>> / ^），浮点只出现在最后一步（除以 2^32）；
 *     2. 哈希输入必须先是整数（世界坐标要先 Math.floor(x / chunkSize)）；
 *     3. 只有这里能出现随机数 —— `tools\check-minigame.ps1` 会静态扫 Math.random 并 FAIL。
 *
 * 与 TypeScript 版的关系：
 *   `src\core\rng.ts` 是参照实现（云上跑 tools\test-logic.mjs 用），本文件是**真正跑在小游戏里的那份**。
 *   两份的等价性由「世界指纹」锁住：tools\minigame-now.cmd 会算出同一个指纹，
 *   必须与 test-logic.mjs 里的 GOLDEN_FINGERPRINT 完全一致，否则说明有人只改了一边。
 */

G.RNG = (function () {
  'use strict';

  /**
   * 32 位混合：把 value 揉进 hash。全部运算都落在 int32/uint32 上。
   * 0x9e3779b1 是黄金比例常量的 32 位形式（取奇数让可逆性更好）。
   */
  function mix(hash, value) {
    var x = (hash ^ Math.imul(value | 0, 0x9e3779b1)) >>> 0;
    x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
    x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
    return (x ^ (x >>> 16)) >>> 0;
  }

  /**
   * 把若干**整数**揉成一个 uint32 哈希（变参：hash32(seed, cx, cy, salt, ...)）。
   * 非整数入参会被 `| 0` 截断 —— 这是兜底，不是许可（调用方必须先取整）。
   */
  function hash32() {
    var hash = 0x811c9dc5;
    for (var i = 0; i < arguments.length; i += 1) hash = mix(hash, arguments[i]);
    return hash >>> 0;
  }

  /** 只要 0..maxExclusive 的整数（比 next() 省一次除法，分布也更均匀） */
  function hashInt(values, maxExclusive) {
    if (maxExclusive <= 0) return 0;
    var hash = 0x811c9dc5;
    for (var i = 0; i < values.length; i += 1) hash = mix(hash, values[i]);
    return (hash >>> 0) % maxExclusive;
  }

  /**
   * mulberry32：32 位状态的快速伪随机流。
   * 只从"确定性种子"出发，所以同一个 chunk 每次生成的怪/装饰完全一致。
   */
  function Rng(seed) {
    this.state = seed >>> 0;
  }

  /** [0, 1) 均匀分布 */
  Rng.prototype.next = function () {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    var t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
    t = (t ^ (t + Math.imul(t ^ (t >>> 7), t | 61))) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  /** [min, max) 浮点 */
  Rng.prototype.float = function (min, max) {
    return min + this.next() * (max - min);
  };

  /** [min, max] 整数（含两端）；min > max 时自动交换，不会返回 NaN */
  Rng.prototype.int = function (min, max) {
    var lo = Math.ceil(Math.min(min, max));
    var hi = Math.floor(Math.max(min, max));
    return lo + Math.floor(this.next() * (hi - lo + 1));
  };

  /** 以概率 p 命中（p <= 0 恒 false，p >= 1 恒 true） */
  Rng.prototype.chance = function (p) {
    if (p <= 0) return false;
    if (p >= 1) return true;
    return this.next() < p;
  };

  /** 等概率取一个元素；空数组返回 undefined */
  Rng.prototype.pick = function (items) {
    if (!items || items.length === 0) return undefined;
    return items[this.int(0, items.length - 1)];
  };

  /** 按权重取下标（权重必须 > 0；全为非正时退化为等概率） */
  Rng.prototype.weightedIndex = function (weights) {
    var total = 0;
    var i;
    for (i = 0; i < weights.length; i += 1) if (weights[i] > 0) total += weights[i];
    if (total <= 0) return this.int(0, Math.max(0, weights.length - 1));

    var roll = this.next() * total;
    for (i = 0; i < weights.length; i += 1) {
      var w = weights[i] > 0 ? weights[i] : 0;
      if (roll < w) return i;
      roll -= w;
    }
    return weights.length - 1;
  };

  /** [min, max] 之间的浮点，保留 digits 位小数（词条数值要好看，也要可比较） */
  Rng.prototype.rounded = function (min, max, digits) {
    var scale = Math.pow(10, digits);
    return Math.round(this.float(min, max) * scale) / scale;
  };

  /** 派生一条独立子流：同一 chunk 内的不同用途（怪 / 装饰 / 地标）用不同盐，互不干扰 */
  Rng.prototype.fork = function (salt) {
    return new Rng(hash32(this.state >>> 0, salt | 0));
  };

  /** 从世界种子与 chunk 坐标派生该 chunk 的主随机流 */
  function chunkRng(worldSeed, cx, cy, salt) {
    return new Rng(hash32(worldSeed, cx | 0, cy | 0, salt | 0));
  }

  return {
    mix: mix,
    hash32: hash32,
    hashInt: hashInt,
    Rng: Rng,
    chunkRng: chunkRng
  };
})();

/**
 * 03-chunk.js —— chunk 数学：世界坐标 ↔ chunk ↔ 难度带（core 层，无任何平台依赖）
 *
 * 三条必须守住的规矩（`docs\design\02-architecture.md` §3）：
 *   1. 哈希输入必须是**整数**：`Math.floor(x / chunkSize)`，绝不拿浮点当哈希输入；
 *   2. 负坐标向负方向取整（`Math.floor` 而不是 `|0`）：`-0.5 / 512 → -1`，
 *      用 `|0` 会得到 0，于是整条 chunk 边界两侧的内容会错位；
 *   3. 距离一律用 `Math.sqrt(x*x + y*y)`，**不用 `Math.hypot`** —— hypot 的精度
 *      在实现之间不做保证，而难度带判定必须跨端一致（同为 IEEE 精确舍入的 sqrt 没这问题）。
 */

G.CHUNK = (function () {
  'use strict';

  var BAL = G.BAL;

  /** 一个 chunk 的世界边长（世界单位 = 设计像素） */
  var CHUNK_SIZE = BAL.world.chunkSize;

  /** 难度带的宽度：每 1000 世界单位一带 */
  var BAND_SIZE = BAL.world.bandSize;

  /** 世界坐标 → chunk 索引（负坐标也正确） */
  function chunkIndexOf(worldCoord) {
    return Math.floor(worldCoord / CHUNK_SIZE);
  }

  /** chunk 索引 → 该 chunk 最小角的世界坐标 */
  function chunkOrigin(chunkIndex) {
    return chunkIndex * CHUNK_SIZE;
  }

  /** chunk 的唯一键（运行时缓存与将来的服务端 AOI 订阅都用它） */
  function chunkKeyOf(cx, cy) {
    return cx + ',' + cy;
  }

  /** 世界坐标 → 所属 chunk */
  function chunkOfWorld(x, y) {
    return { cx: chunkIndexOf(x), cy: chunkIndexOf(y) };
  }

  /** 世界坐标 → chunk 内的局部坐标（调试面板用） */
  function chunkLocalOf(x, y) {
    return { lx: x - chunkOrigin(chunkIndexOf(x)), ly: y - chunkOrigin(chunkIndexOf(y)) };
  }

  /** 点到原点的距离（**不要**换成 Math.hypot，见文件头第 3 条） */
  function distanceToOrigin(x, y) {
    return Math.sqrt(x * x + y * y);
  }

  /** 两点距离的平方：比较远近时用它，省一次开方 */
  function distanceSq(ax, ay, bx, by) {
    var dx = ax - bx;
    var dy = ay - by;
    return dx * dx + dy * dy;
  }

  /** 两点距离 */
  function distance(ax, ay, bx, by) {
    return Math.sqrt(distanceSq(ax, ay, bx, by));
  }

  /** 难度带：原点周围是 band 0（新手带），越往外越强；band = floor(距原点距离 / 1000) */
  function bandOf(x, y) {
    return Math.floor(distanceToOrigin(x, y) / BAND_SIZE);
  }

  /**
   * 覆盖一个世界矩形的全部 chunk 索引（相机视野裁剪用）。
   * ring 是额外向外扩的圈数：预载一圈，跨 chunk 时画面才不空。
   */
  function chunksInRect(minX, minY, maxX, maxY, ring) {
    var cxMin = chunkIndexOf(minX) - ring;
    var cyMin = chunkIndexOf(minY) - ring;
    var cxMax = chunkIndexOf(maxX) + ring;
    var cyMax = chunkIndexOf(maxY) + ring;

    var out = [];
    for (var cy = cyMin; cy <= cyMax; cy += 1) {
      for (var cx = cxMin; cx <= cxMax; cx += 1) out.push({ cx: cx, cy: cy });
    }
    return out;
  }

  /** 世界坐标 → 过网络用的整数坐标（世界单位 ×10 取整，省带宽也免抖动） */
  function encodeWorldCoord(value) {
    return Math.round(value * 10);
  }

  /** 网络坐标 → 世界坐标 */
  function decodeWorldCoord(value) {
    return value / 10;
  }

  return {
    CHUNK_SIZE: CHUNK_SIZE,
    BAND_SIZE: BAND_SIZE,
    chunkIndexOf: chunkIndexOf,
    chunkOrigin: chunkOrigin,
    chunkKeyOf: chunkKeyOf,
    chunkOfWorld: chunkOfWorld,
    chunkLocalOf: chunkLocalOf,
    distanceToOrigin: distanceToOrigin,
    distanceSq: distanceSq,
    distance: distance,
    bandOf: bandOf,
    chunksInRect: chunksInRect,
    encodeWorldCoord: encodeWorldCoord,
    decodeWorldCoord: decodeWorldCoord
  };
})();

/**
 * 04-terrain.js —— 确定性地表与装饰（world/terrain.ts 的小游戏实现，逐位等价）
 *
 * 地表是"配色 + 噪声色块"，装饰是每 chunk 8~24 个纯视觉物件（**无碰撞**）。
 * 两者都由 chunk 哈希决定，所以"同一个坐标，所有人看到同一片地"。
 *
 * band 只影响**装饰种类权重**与**主题配色**，不参与位置/数量的随机流 ——
 * 因此同一个 chunk 无论从哪个方向看，装饰坐标都一样（只是草/石比例不同）。
 *
 * 另外两样"地图设计"的东西也在这里（都是**数据**，绘制在 16-render.js）：
 *   - 原点的新手营地（world.camp）：纯几何 + 手工摆位，无随机，所以不影响世界指纹；
 *   - 路网小径（world.road）：每 spanChunks 个 chunk 一个节点，节点连成 L 形小径 ——
 *     用自己的 ROAD_SALT 起一条**独立随机流**，与怪/装饰/地标/出生点互不干扰。
 */

G.TERRAIN = (function () {
  'use strict';

  var BAL = G.BAL;
  var RNG = G.RNG;
  var CHUNK = G.CHUNK;

  /** 装饰种类顺序（与每种主题的 decorWeights 一一对应，不能乱） */
  var DECOR_ORDER = ['grass', 'rock', 'tree'];

  /** 五套主题：原点草原 → 荒漠 → 雪原 → 焦土 → 虚境（再往外循环用虚境 + 色偏） */
  var TERRAIN_THEMES = [
    {
      id: 'grassland',
      name: '草原',
      ground: ['#28421f', '#2f4d24', '#365630'],
      decor: '#3d6b2f',
      accent: '#9ad46b',
      decorWeights: [60, 25, 15]
    },
    {
      id: 'desert',
      name: '荒漠',
      ground: ['#4a4028', '#54482c', '#5d5033'],
      decor: '#7d6a3c',
      accent: '#e8cc82',
      decorWeights: [25, 55, 20]
    },
    {
      id: 'snowfield',
      name: '雪原',
      ground: ['#3c4a56', '#45535f', '#4e5c68'],
      decor: '#93a8b8',
      accent: '#dff0ff',
      decorWeights: [20, 50, 30]
    },
    {
      id: 'scorch',
      name: '焦土',
      ground: ['#3f2a26', '#472f2a', '#4f3630'],
      decor: '#6b3f33',
      accent: '#ff9b5a',
      decorWeights: [30, 40, 30]
    },
    {
      id: 'void',
      name: '虚境',
      ground: ['#2b2340', '#332a4a', '#3b3154'],
      decor: '#5a4a86',
      accent: '#c9a6ff',
      decorWeights: [35, 30, 35]
    }
  ];

  /** 主题数量（band 超过最后一档后不再换主题，只做色偏） */
  var THEME_COUNT = TERRAIN_THEMES.length;

  /** band → 主题下标（band 4 之后固定最后一档） */
  function themeIndexForBand(band) {
    if (band <= 0) return 0;
    return Math.min(band, THEME_COUNT - 1);
  }

  /** band → 主题 */
  function themeForBand(band) {
    return TERRAIN_THEMES[themeIndexForBand(band)];
  }

  /**
   * band 超过最后一档时每多带一次的色偏强度（0~1）。
   * 渲染层用它把虚境往更暗/更紫推，让"越走越远"有视觉反馈，而不用为每一带手写配色。
   */
  function deepBandIntensity(band) {
    if (band < THEME_COUNT) return 0;
    var overflow = band - (THEME_COUNT - 1);
    return Math.min(0.6, overflow * 0.06);
  }

  /** 每种用途一个盐值：同一 chunk 里"怪"和"装饰"的随机流互不干扰 */
  var TERRAIN_SALT = 0x7e11a1;

  /** chunk 内每张地表块的噪声网格边长：512 / 64 = 8×8 块 */
  function tileCountPerChunk() {
    return Math.max(1, Math.round(CHUNK.CHUNK_SIZE / BAL.world.tileSize));
  }

  /**
   * 某张地表块用主题里的第几种颜色。
   * 纯整数哈希 → 0..2，**没有浮点参与**，所以跨端一定一致。
   */
  function groundVariant(seed, cx, cy, tileX, tileY) {
    return RNG.hash32(seed, cx, cy, tileX, tileY, 0x91a2) % 3;
  }

  /**
   * 生成一个 chunk 的全部装饰。
   *
   * band 必须由调用方传入（= bandOf(chunk 中心)）：主题决定"哪种装饰更常见"，
   * 而 band 是**位置**的函数、不能从 chunk 坐标推出来。
   */
  function buildChunkDecor(seed, cx, cy, band) {
    var rng = RNG.chunkRng(seed, cx, cy, TERRAIN_SALT);
    var theme = themeForBand(band);
    var count = rng.int(BAL.world.decorPerChunk.min, BAL.world.decorPerChunk.max);
    var originX = CHUNK.chunkOrigin(cx);
    var originY = CHUNK.chunkOrigin(cy);
    /** 边距：装饰不贴 chunk 边界，避免相邻 chunk 的装饰叠在一起像穿模 */
    var margin = 24;

    var out = [];
    for (var i = 0; i < count; i += 1) {
      var index = rng.weightedIndex(theme.decorWeights);
      out.push({
        kind: DECOR_ORDER[index],
        x: originX + rng.float(margin, CHUNK.CHUNK_SIZE - margin),
        y: originY + rng.float(margin, CHUNK.CHUNK_SIZE - margin),
        size: rng.rounded(0.8, 1.4, 2),
        flip: rng.chance(0.5),
        /** 所属难度带：渲染层按它选主题造型（松树 / 仙人掌 / 枯枝 / 水晶…） */
        band: band
      });
    }
    return out;
  }

  /* ---------------------------------------------------------------- 新手营地（原点） */

  /**
   * 营地常量（半径等）在 shared/balance.json 的 world.camp。
   * 它是**纯几何**：不参与任何随机流，所以加它不会动世界指纹，也不影响怪的位置。
   */
  var CAMP = BAL.world.camp;

  /** 营地中心 = 原点（玩家出生环的中心，也是"回家"的心智锚点） */
  function campCenter() {
    return { x: 0, y: 0, radius: CAMP.radius };
  }

  /** 某点是否落在营地石砖地内（渲染用；纯距离判断，无随机、无三角函数） */
  function isInCamp(x, y) {
    return CHUNK.distanceToOrigin(x, y) <= CAMP.radius;
  }

  /**
   * 营地道具：**手工摆位**（笛卡尔坐标，不用极角 —— 本文件不许出现三角函数），
   * 于是"同一个坐标，所有人看到同一个营地"是构造上成立的，不需要哈希。
   * 围栏（16-render 画）在 +y 方向留 gateWidth 宽的门，方便玩家走出去。
   */
  var CAMP_PROPS = [
    { kind: 'tent', x: -352, y: -168, scale: 1 },
    { kind: 'tent', x: 336, y: -216, scale: 0.9 },
    { kind: 'tent', x: -424, y: 246, scale: 1.1 },
    { kind: 'fire', x: 0, y: 0, scale: 1 },
    { kind: 'banner', x: 148, y: -326, scale: 1 },
    { kind: 'sign', x: -118, y: 468, scale: 1 },
    { kind: 'crate', x: 248, y: 302, scale: 0.95 },
    { kind: 'crate', x: 300, y: 246, scale: 0.8 },
    { kind: 'stump', x: -246, y: 384, scale: 1 },
    { kind: 'stump', x: -302, y: 318, scale: 0.85 }
  ];

  /** 营地道具（返回副本：渲染层只读，改了也不会污染地图形状） */
  function campProps() {
    return CAMP_PROPS.slice();
  }

  /* ---------------------------------------------------------------- 路网（小径） */

  /** 路网专用盐：与怪 / 装饰 / 地标 / 出生点的随机流互不干扰 */
  var ROAD_SALT = 0x4d1f2b;

  /** 路网节点间距（chunk 数） */
  function roadSpanChunks() {
    return BAL.world.road.spanChunks;
  }

  /**
   * 路网节点：每 span×span 个 chunk 一个，落在**网格交叉点**（gx×span 个 chunk 处）+ 一点抖动。
   * 为什么放交叉点而不是组中心：这样原点正好是个路口，出生点附近立刻能看到小径，
   * 而不是要走好几百像素才遇到第一条路。
   * ⚠️ 本函数里 rng 的调用顺序（x 先、y 后）不能改，否则所有节点会挪位。
   */
  function roadNodeFor(seed, gx, gy) {
    var span = roadSpanChunks();
    var jitter = BAL.world.road.jitterChunks;
    var rng = RNG.chunkRng(seed, gx, gy, ROAD_SALT);
    var cx = gx * span + rng.float(-jitter, jitter);
    var cy = gy * span + rng.float(-jitter, jitter);
    return { gx: gx, gy: gy, x: cx * CHUNK.CHUNK_SIZE, y: cy * CHUNK.CHUNK_SIZE };
  }

  /** chunk 索引 → 路网组下标（负坐标也正确） */
  function roadGroupOf(chunkIndex) {
    return Math.floor(chunkIndex / roadSpanChunks());
  }

  /**
   * L 形折法：先横后竖（true）还是先竖后横（false）。
   * `tie` 让"往右连"和"往下连"各掷一次，避免每个节点的拐弯方向雷同。
   */
  function roadBendHorizontalFirst(seed, gx, gy, tie) {
    return RNG.hash32(seed, gx, gy, ROAD_SALT, tie) % 2 === 0;
  }

  /** 线段是否可能落进矩形（粗判；画布自己会裁掉框外的部分，不必精确裁剪） */
  function segmentTouchesRect(x1, y1, x2, y2, minX, minY, maxX, maxY, pad) {
    if (x1 < minX - pad && x2 < minX - pad) return false;
    if (x1 > maxX + pad && x2 > maxX + pad) return false;
    if (y1 < minY - pad && y2 < minY - pad) return false;
    if (y1 > maxY + pad && y2 > maxY + pad) return false;
    return true;
  }

  /** 把一条 L 形连接（a → b，中间一个拐点）拆成最多两条直线段塞进 out */
  function pushRoadLink(out, a, b, horizontalFirst, width, minX, minY, maxX, maxY, pad) {
    var bend = horizontalFirst ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
    var pairs = [
      [a.x, a.y, bend.x, bend.y],
      [bend.x, bend.y, b.x, b.y]
    ];
    for (var i = 0; i < pairs.length; i += 1) {
      var p = pairs[i];
      if (p[0] === p[2] && p[1] === p[3]) continue;
      if (!segmentTouchesRect(p[0], p[1], p[2], p[3], minX, minY, maxX, maxY, pad)) continue;
      out.push({ x1: p[0], y1: p[1], x2: p[2], y2: p[3], width: width });
    }
  }

  /**
   * 视野矩形内的路网线段（渲染用）。
   * 每个节点向右邻、下邻各连一条 L 形小径 → 全局是一张**带环的网**（不是一棵树），
   * 走路时会不断遇到"岔路"，地图就有人修过的样子。
   * 纯横竖直角线，逐位确定 —— 断言见 19-selftest 的 checkMap。
   */
  function roadsInRect(seed, minX, minY, maxX, maxY) {
    var size = roadSpanChunks() * CHUNK.CHUNK_SIZE;
    var width = BAL.world.road.width;
    var pad = width * 4;
    var gxMin = Math.floor(minX / size) - 1;
    var gyMin = Math.floor(minY / size) - 1;
    var gxMax = Math.floor(maxX / size) + 1;
    var gyMax = Math.floor(maxY / size) + 1;

    var out = [];
    for (var gy = gyMin; gy <= gyMax; gy += 1) {
      for (var gx = gxMin; gx <= gxMax; gx += 1) {
        var node = roadNodeFor(seed, gx, gy);
        pushRoadLink(
          out,
          node,
          roadNodeFor(seed, gx + 1, gy),
          roadBendHorizontalFirst(seed, gx, gy, 0x9d),
          width,
          minX,
          minY,
          maxX,
          maxY,
          pad
        );
        pushRoadLink(
          out,
          node,
          roadNodeFor(seed, gx, gy + 1),
          roadBendHorizontalFirst(seed, gx, gy, 0x9e),
          width,
          minX,
          minY,
          maxX,
          maxY,
          pad
        );
      }
    }
    return out;
  }

  /* ---------------------------------------------------------------- 渲染辅助 */

  /**
   * 把 #rrggbb 往目标色混 `t`（0~1）。
   * TypeScript 版没有这个函数 —— 它是小游戏渲染层为"深带色偏"加的小工具，
   * 放在这里是因为配色数据就在本文件，换主题时只需要改一处。
   */
  function mixHex(hex, targetHex, t) {
    if (!(t > 0)) return hex;
    var k = t > 1 ? 1 : t;
    var parse = function (h) {
      return [
        parseInt(h.substring(1, 3), 16),
        parseInt(h.substring(3, 5), 16),
        parseInt(h.substring(5, 7), 16)
      ];
    };
    var a = parse(hex);
    var b = parse(targetHex);
    var to2 = function (v) {
      var s = Math.round(v).toString(16);
      return s.length < 2 ? '0' + s : s;
    };
    return '#' + to2(a[0] + (b[0] - a[0]) * k) + to2(a[1] + (b[1] - a[1]) * k) + to2(a[2] + (b[2] - a[2]) * k);
  }

  return {
    DECOR_ORDER: DECOR_ORDER,
    TERRAIN_THEMES: TERRAIN_THEMES,
    THEME_COUNT: THEME_COUNT,
    TERRAIN_SALT: TERRAIN_SALT,
    ROAD_SALT: ROAD_SALT,
    CAMP: CAMP,
    CAMP_PROPS: CAMP_PROPS,
    themeIndexForBand: themeIndexForBand,
    themeForBand: themeForBand,
    deepBandIntensity: deepBandIntensity,
    tileCountPerChunk: tileCountPerChunk,
    groundVariant: groundVariant,
    buildChunkDecor: buildChunkDecor,
    campCenter: campCenter,
    isInCamp: isInCamp,
    campProps: campProps,
    roadSpanChunks: roadSpanChunks,
    roadNodeFor: roadNodeFor,
    roadGroupOf: roadGroupOf,
    roadBendHorizontalFirst: roadBendHorizontalFirst,
    roadsInRect: roadsInRect,
    mixHex: mixHex
  };
})();

/**
 * 05-spawn.js —— chunk 内的确定性播种：怪与地标（world/spawn.ts 的小游戏实现，逐位等价）
 *
 * 铁律：位置、种类、等级、是否精英**全部由哈希决定**，不许有 Math.random。
 * 于是"同一坐标的同一只怪"在客户端与将来服务端是同一个实体（决策 #1 的前提）。
 *
 * ⚠️ 本文件里的**随机数调用顺序**不能改：第 N 次 rng 调用决定第 N 个数值，
 * 顺序一改，全世界的怪都会挪位置、世界指纹立刻不一致。
 * 大小/倍率全部来自 G.BAL（shared/balance.json），这里只写公式。
 */

G.SPAWN = (function () {
  'use strict';

  var BAL = G.BAL;
  var RNG = G.RNG;
  var CHUNK = G.CHUNK;

  /** 每个用途一个盐：怪、地标、出生点互不干扰 */
  var MONSTER_SALT = 0x3f7c01;
  var LANDMARK_SALT = 0x51d0b7;
  var SPAWN_SALT = 0x2ab9e3;

  /** 按权重取一种怪 */
  function pickKind(rng) {
    var kinds = BAL.monsters.kinds;
    var weights = [];
    for (var i = 0; i < kinds.length; i += 1) weights.push(kinds[i].weight);
    return kinds[rng.weightedIndex(weights)];
  }

  /**
   * 怪等级：`3 × band ± 2`，最低 1 级。
   * band 0 = 1~2 级（0 ± 2 之后被夹到 ≥1）；band n = 3n-2 ~ 3n+2。
   * ⚠️ 文档 01-game-design §5 写"band 0 = 1–3"，实际公式给 1~2 —— 这条差异仍在待拍板清单里。
   */
  function monsterLevelFor(band, rng) {
    var base = band * BAL.monsters.levelPerBand;
    var level = base + rng.int(-BAL.monsters.levelJitter, BAL.monsters.levelJitter);
    return level < 1 ? 1 : level;
  }

  /** 等级 → 属性（精英倍率另外乘，见 balance.monsters.elite） */
  function monsterStats(kind, level, elite) {
    var growth = level - 1;
    var eliteRules = BAL.monsters.elite;
    var hp = kind.hp * (1 + BAL.monsters.hpPerLevel * growth) * (elite ? eliteRules.hpMul : 1);
    var attack = kind.attack * (1 + BAL.monsters.attackPerLevel * growth) * (elite ? eliteRules.attackMul : 1);
    var defense = kind.defense * (elite ? eliteRules.defenseMul : 1);
    return {
      hpMax: Math.round(hp),
      attack: Math.round(attack),
      defense: Math.round(defense),
      radius: kind.radius * (elite ? eliteRules.radiusMul : 1)
    };
  }

  /**
   * chunk 的难度带按**chunk 中心**算：同一个 chunk 内 band 是常量，
   * 避免"站在边界上，怪一会儿 3 级一会儿 12 级"。
   */
  function chunkCenterBand(cx, cy) {
    return CHUNK.bandOf(
      CHUNK.chunkOrigin(cx) + CHUNK.CHUNK_SIZE / 2,
      CHUNK.chunkOrigin(cy) + CHUNK.CHUNK_SIZE / 2
    );
  }

  /** 稳定 ID：同一个 (seed, cx, cy, slot, attempt) 永远得到同一个数字 */
  function spawnId(seed, cx, cy, slot, attempt) {
    return RNG.hash32(seed, cx, cy, slot, MONSTER_SALT, attempt);
  }

  /**
   * 生成一个 chunk 的怪。
   *
   *   个体数 = monstersPerChunk.min..max（1~3，密度上限 —— 也是将来服务端 CPU 的护栏）；
   *   群怪（蝙蝠）成群出现：命中 swarm 时一次占掉 2~3 个名额；
   *   8% 概率出现 1 只精英（血 ×5、攻 ×1.6、掉率/经验/金币按 elite 倍率）；
   *   位置 = chunk 均分 3 个槽位 + 槽内抖动；同一群共享等级与巢穴，看起来才像"一群怪"。
   */
  function buildChunkMonsters(seed, cx, cy) {
    var rng = RNG.chunkRng(seed, cx, cy, MONSTER_SALT);
    var band = chunkCenterBand(cx, cy);
    var originX = CHUNK.chunkOrigin(cx);
    var originY = CHUNK.chunkOrigin(cy);

    var want = rng.int(BAL.world.monstersPerChunk.min, BAL.world.monstersPerChunk.max);
    var slots = 3;
    var cell = CHUNK.CHUNK_SIZE / slots;
    var inset = 28;

    var out = [];
    var budget = want;
    var slot = 0;
    var i;
    var k;

    while (budget > 0 && slot < slots) {
      var kind = pickKind(rng);
      var groupSize = 1;
      if (kind.swarm === true) {
        var swarm = BAL.monsters.swarmSize;
        groupSize = Math.min(budget, rng.int(swarm.min, swarm.max));
      }
      budget -= groupSize;

      var level = monsterLevelFor(band, rng);
      var stats = monsterStats(kind, level, false);
      var homeX = originX + slot * cell + rng.float(inset, cell - inset);
      var homeY = originY + rng.float(inset, CHUNK.CHUNK_SIZE - inset);
      var respawnMs = rng.int(BAL.world.respawnMs.min, BAL.world.respawnMs.max);

      for (i = 0; i < groupSize; i += 1) {
        var angle = rng.float(0, Math.PI * 2);
        var spread = groupSize > 1 ? rng.float(26, 64) : 0;

        // 同一 chunk 内 ID 必须唯一（"同距取 ID 小"的确定性依赖它）；撞了就再混一次
        var id = spawnId(seed, cx, cy, slot, 0);
        var attempt = 1;
        var collision = true;
        while (collision) {
          collision = false;
          for (k = 0; k < out.length; k += 1) if (out[k].id === id) collision = true;
          if (collision) {
            id = spawnId(seed, cx, cy, slot, attempt);
            attempt += 1;
          }
        }

        out.push({
          id: id,
          cx: cx,
          cy: cy,
          slot: out.length,
          kindId: kind.id,
          name: kind.name,
          level: level,
          band: band,
          elite: false,
          homeX: homeX,
          homeY: homeY,
          x: homeX + Math.cos(angle) * spread,
          y: homeY + Math.sin(angle) * spread,
          hpMax: stats.hpMax,
          attack: stats.attack,
          defense: stats.defense,
          radius: stats.radius,
          speed: kind.speed,
          attackRange: kind.attackRange,
          attackIntervalMs: kind.attackIntervalMs,
          ranged: kind.ranged,
          aggroRange: kind.aggroRange,
          leashRange: kind.leashRange,
          respawnMs: respawnMs
        });
      }
      slot += 1;
    }

    // 精英：整块 chunk 只掷一次骰子（8%），命中后指定其中一只（每 chunk 最多 1 只）
    if (out.length > 0 && rng.chance(BAL.world.eliteChance)) {
      var target = out[rng.int(0, out.length - 1)];
      var eliteKind = null;
      for (k = 0; k < BAL.monsters.kinds.length; k += 1) {
        if (BAL.monsters.kinds[k].id === target.kindId) eliteKind = BAL.monsters.kinds[k];
      }
      if (eliteKind) {
        var eliteStats = monsterStats(eliteKind, target.level, true);
        target.elite = true;
        target.hpMax = eliteStats.hpMax;
        target.attack = eliteStats.attack;
        target.defense = eliteStats.defense;
        target.radius = eliteStats.radius;
        target.name = eliteKind.name + '·精英';
      }
    }

    return out;
  }

  /** 第 n 个 chunk 属于第几组（地标按组生成）；负坐标也正确 */
  function landmarkGroupOf(chunkIndex, span) {
    return Math.floor(chunkIndex / span);
  }

  /** chunk 组 → 该组的地标（组内落在哪个 chunk、什么种类，全由哈希决定） */
  function landmarkForChunkGroup(seed, gx, gy) {
    var rng = RNG.chunkRng(seed, gx, gy, LANDMARK_SALT);
    var span = BAL.world.landmarkChunkSpan;
    var cx = gx * span + rng.int(0, span - 1);
    var cy = gy * span + rng.int(0, span - 1);
    var x = CHUNK.chunkOrigin(cx) + rng.float(80, CHUNK.CHUNK_SIZE - 80);
    var y = CHUNK.chunkOrigin(cy) + rng.float(80, CHUNK.CHUNK_SIZE - 80);
    return {
      kind: rng.chance(0.5) ? 'ruins' : 'obelisk',
      gx: gx,
      gy: gy,
      x: x,
      y: y,
      band: CHUNK.bandOf(x, y)
    };
  }

  /** 落在给定 chunk 矩形内的全部地标（渲染视锥裁剪用） */
  function landmarksInChunkRect(seed, cxMin, cyMin, cxMax, cyMax) {
    var span = BAL.world.landmarkChunkSpan;
    var gxMin = landmarkGroupOf(cxMin, span);
    var gyMin = landmarkGroupOf(cyMin, span);
    var gxMax = landmarkGroupOf(cxMax, span);
    var gyMax = landmarkGroupOf(cyMax, span);

    var out = [];
    for (var gy = gyMin; gy <= gyMax; gy += 1) {
      for (var gx = gxMin; gx <= gxMax; gx += 1) out.push(landmarkForChunkGroup(seed, gx, gy));
    }
    return out;
  }

  /**
   * 首次进入的随机出生点：距原点 300~800 的环内（决策 #5）。
   * 之后登录回到**上次离线位置**，所以本函数只在"还没出生过"时用。
   */
  function randomSpawnPoint(seed, characterIndex) {
    var rng = new RNG.Rng(RNG.hash32(seed, characterIndex, SPAWN_SALT));
    var ring = BAL.world.spawnRing;
    var radius = rng.float(ring.min, ring.max);
    var angle = rng.float(0, Math.PI * 2);
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  }

  /** 存档里的坐标是否可用（NaN 或离谱坐标视为无效，回退到随机出生） */
  function isUsableSpawn(x, y) {
    if (typeof x !== 'number' || typeof y !== 'number') return false;
    if (!isFinite(x) || !isFinite(y)) return false;
    if (x === 0 && y === 0) return false;
    return CHUNK.distanceToOrigin(x, y) <= 1000000;
  }

  return {
    MONSTER_SALT: MONSTER_SALT,
    LANDMARK_SALT: LANDMARK_SALT,
    SPAWN_SALT: SPAWN_SALT,
    pickKind: pickKind,
    monsterLevelFor: monsterLevelFor,
    monsterStats: monsterStats,
    chunkCenterBand: chunkCenterBand,
    spawnId: spawnId,
    buildChunkMonsters: buildChunkMonsters,
    landmarkGroupOf: landmarkGroupOf,
    landmarkForChunkGroup: landmarkForChunkGroup,
    landmarksInChunkRect: landmarksInChunkRect,
    randomSpawnPoint: randomSpawnPoint,
    isUsableSpawn: isUsableSpawn
  };
})();

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

/**
 * 07-combat.js —— 自动战斗的纯计算部分（阶段 A2 新增）
 *
 * 只做四件事，都不碰画布、不碰 tt，所以能在 node 里直接断言（决策 #7 的替代验证通道）：
 *   1. 选目标：**视野内最近**的可攻击怪；同距取 **ID 小**的（确定性，不然帧率一变目标就跳）；
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

  /** 选目标的视野半径（设计像素）：比怪的最大仇恨半径（380）大一截，够"自动战斗看得见" */
  function visionRange() {
    return BAL.combat.visionRange;
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
   * 选目标：视野内距离最近的活着的怪；同距取 ID 小的。
   * 用平方距离比较（省一次开方，也让比较保持整数）。
   */
  function pickTarget(x, y, monsters, range) {
    var best = null;
    var bestSq = range * range;
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
    visionRange: visionRange,
    attackIntervalMs: attackIntervalMs,
    rollDamage: rollDamage,
    monsterDamage: monsterDamage,
    pickTarget: pickTarget,
    creditHit: creditHit,
    rewardWinnerId: rewardWinnerId
  };
})();

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
      if (loadout[id] && loadout[id].main && loadout[id].affixes) result[id] = loadout[id];
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

  return {
    normalizeLoadout: normalizeLoadout,
    statsOf: statsOf,
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

/**
 * 11-save.js —— 本地存档 + 本机账号（阶段 A 的"数据不丢"靠它；阶段 B 再换成云存档）
 *
 * 阶段 A 只做**本地存档**（01-game-design §11：开发期自测不发网络请求）：
 *   - 首次进入：在距原点 300~800 的环内随机出生（决策 #5），之后登录回到**上次离线位置**；
 *   - 存档内容：角色名/等级/经验、金币、宝箱背包与保底计数、已穿装备、背包、公会、设置项、统计数据；
 *   - 读写全部走 `G.PLAT.storage`（`tt.setStorageSync` 的一层薄封装），
 *     所以本文件**不出现 tt 字样**，照样能在 node 里断言（红线见 00-config.js）。
 *
 * 另外本文件还挂了一个模块：`G.ACCOUNT`（注册 / 登录 / 昵称唯一性，A4 新增）。
 * 放在这里的原因：它和存档一样，是"本机持久化数据"，共用同一层存储封装；
 * 而**唯一性校验的网络那一半**仍在 20-main（这里只管规则与本地注册表，方便 node 断言）。
 *
 * 为什么存档要带 `v`（版本号）：小游戏更新后老存档必须能被读（或者干脆安全地丢弃），
 * 不能让玩家一升级就白屏。读档失败一律回落到"新号"，并把原始文本留在内存里便于排查。
 *   v1 → v2（A4）：多了 `name`（角色名）与 `settings`（自动战斗 / 音效开关），
 *   迁移是**就地补齐默认值**，不丢等级金币装备（见 normalize）。
 */

G.SAVE = (function () {
  'use strict';

  var BAL = G.BAL;
  var EQUIP = G.EQUIP;
  var SPAWN = G.SPAWN;

  /** 存档格式版本（改结构就必须 +1，并在这里写迁移） */
  var SCHEMA_VERSION = 2;

  /** 能被 normalize 接受的旧版本：v1（A3 及以前）就地升级到 v2，不丢数据 */
  var MIN_READABLE_VERSION = 1;

  /** 设置项的默认值：自动战斗默认**关**（用户要求"点击开启"），音效/震动默认开 */
  function defaultSettings() {
    return { autoBattle: false, sfx: true, bgm: true, vibrate: true };
  }

  /** 开一个新号（首次进入：随机出生点，决策 #5） */
  function create(seed, characterIndex) {
    var spawn = SPAWN.randomSpawnPoint(seed, characterIndex);
    return {
      v: SCHEMA_VERSION,
      /** 角色名（A4 之前没有这个字段，迁移时补空串 = 还没建角色，由登录流程填） */
      name: '',
      level: 1,
      exp: 0,
      gold: 0,
      spawned: true,
      x: spawn.x,
      y: spawn.y,
      /** 宝箱背包：[{ tier, level }]，满了自动分解（见 08-loot.js 的 bagCap） */
      chests: [],
      /** 保底计数：50 箱无史诗 / 500 箱无神话（服务端化时同名落库） */
      pity: { epic: 0, mythic: 0 },
      /** 已穿装备：{ weapon: item|null, ... } */
      loadout: EQUIP.emptyLoadout(),
      /** 背包里的装备（未穿戴），用于"分解换金币" */
      items: [],
      /** 装备 id 自增号：同一次掉落重放两次拿到同一个 id */
      nextItemId: 1,
      /** 号角数量（20 级后可在商城买；建公会消耗一个） */
      horns: 0,
      /** 公会（本地版：只有自己的会，成员列表是占位；阶段 D 才上服务端） */
      guild: null,
      /** 设置项（自动战斗 / 音效 / 震动）—— A4 起随存档走，换设备也记得 */
      settings: defaultSettings(),
      /** 统计（调试面板与将来的埋点用） */
      stats: { kills: 0, eliteKills: 0, opened: 0, playMs: 0, distance: 0 }
    };
  }

  /** 把一个可能是 null / 缺字段 / 类型不对的旧存档修成可用的（任何情况下不抛异常） */
  function normalize(raw, seed, characterIndex) {
    if (!raw || typeof raw !== 'object') return create(seed, characterIndex);
    // v1（A3 及以前）就地升级成 v2：多的 name / settings 补默认值，等级金币装备一件不丢。
    // 比 v1 更老或者比当前更新（比如玩家装回了旧包）一律当新号 —— 宁可从 1 级重来，也不白屏。
    if (typeof raw.v !== 'number' || raw.v < MIN_READABLE_VERSION || raw.v > SCHEMA_VERSION) {
      return create(seed, characterIndex);
    }

    var save = create(seed, characterIndex);
    save.name = G.ACCOUNT.sanitizeName(raw.name);
    save.settings = normalizeSettings(raw.settings);
    save.level = numberOr(raw.level, 1, 1, 9999);
    save.exp = numberOr(raw.exp, 0, 0, Infinity);
    save.gold = numberOr(raw.gold, 0, 0, Infinity);
    save.chests = [];
    if (raw.chests && raw.chests.length) {
      for (var i = 0; i < raw.chests.length && i < BAL.chests.bagCap; i += 1) {
        var chest = raw.chests[i];
        if (chest && chest.tier >= 1 && chest.tier <= BAL.chests.tiers.length) {
          save.chests.push({ tier: chest.tier, level: numberOr(chest.level, 1, 1, 9999) });
        }
      }
    }
    save.pity.epic = numberOr(raw.pity && raw.pity.epic, 0, 0, 100000);
    save.pity.mythic = numberOr(raw.pity && raw.pity.mythic, 0, 0, 100000);
    save.loadout = G.PLAYER.normalizeLoadout(raw.loadout);
    save.items = raw.items && raw.items.length ? raw.items.slice(0, BAL.chests.bagCap) : [];
    save.nextItemId = numberOr(raw.nextItemId, 1, 1, Infinity);
    save.horns = numberOr(raw.horns, 0, 0, 9999);
    save.guild = raw.guild && raw.guild.name ? raw.guild : null;

    // 坐标：存档里明显坏掉的（NaN / 离谱）就当新号重新出生，避免玩家卡在虚空里
    if (SPAWN.isUsableSpawn(raw.x, raw.y)) {
      save.x = raw.x;
      save.y = raw.y;
    }
    if (raw.stats) {
      save.stats = {
        kills: numberOr(raw.stats.kills, 0, 0, Infinity),
        eliteKills: numberOr(raw.stats.eliteKills, 0, 0, Infinity),
        opened: numberOr(raw.stats.opened, 0, 0, Infinity),
        playMs: numberOr(raw.stats.playMs, 0, 0, Infinity),
        distance: numberOr(raw.stats.distance, 0, 0, Infinity)
      };
    }
    return save;
  }

  function numberOr(value, fallback, min, max) {
    if (typeof value !== 'number' || !isFinite(value)) return fallback;
    if (value < min) return min;
    if (value > max) return max;
    return value;
  }

  /** 把任意坏输入修成一份合法设置（布尔字段只认 true/false，缺省取默认值） */
  function normalizeSettings(raw) {
    var settings = defaultSettings();
    if (!raw || typeof raw !== 'object') return settings;
    settings.autoBattle = raw.autoBattle === true;
    // 音效 / BGM / 震动默认开：只有明确写了 false 才关（老存档没有这三个字段）
    if (raw.sfx === false) settings.sfx = false;
    if (raw.bgm === false) settings.bgm = false;
    if (raw.vibrate === false) settings.vibrate = false;
    return settings;
  }

  /** 读档：没有 / 坏了 / 版本不符 → 返回 null，由调用方决定"开新号" */
  function loadRaw() {
    var text = G.PLAT.storageGet(G.CONFIG.saveKey);
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch (error) {
      return null;
    }
  }

  /** 读档（已完成归一化） */
  function load(seed, characterIndex) {
    return normalize(loadRaw(), seed, characterIndex);
  }

  /** 存档（每 5 秒自动调一次 + 切后台时调一次） */
  function write(save) {
    try {
      G.PLAT.storageSet(G.CONFIG.saveKey, JSON.stringify(save));
      return true;
    } catch (error) {
      return false;
    }
  }

  /** 清档（设置面板里的"重置存档"，调试与救砖用） */
  function clear() {
    G.PLAT.storageRemove(G.CONFIG.saveKey);
  }

  /** 宝箱背包：入包（满了返回 false，调用方把它分解成金币） */
  function pushChest(save, tier, level) {
    if (save.chests.length >= BAL.chests.bagCap) return false;
    save.chests.push({ tier: tier, level: level });
    return true;
  }

  /** 装备入包，并返回它的 id */
  function pushItem(save, item) {
    item.id = save.nextItemId;
    save.nextItemId += 1;
    save.items.push(item);
    return item.id;
  }

  /** 背包上限检查（背包装备与宝箱都按 chests.bagCap 算，够用且好记） */
  function bagFull(save) {
    return save.items.length >= BAL.chests.bagCap;
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION,
    create: create,
    normalize: normalize,
    load: load,
    loadRaw: loadRaw,
    write: write,
    clear: clear,
    pushChest: pushChest,
    pushItem: pushItem,
    bagFull: bagFull,
    defaultSettings: defaultSettings,
    normalizeSettings: normalizeSettings
  };
})();

/**
 * G.ACCOUNT —— 本机账号：注册 / 登录 / 昵称唯一性（A4 新增）
 *
 * 用户要求："打开游戏后增加注册、登录、创建角色、输入昵称等功能，并且昵称不能重复。"
 *
 * 三道关卡，从便宜到贵：
 *   1. **格式**：2~12 个字符，只允许 中文 / 字母 / 数字 / 下划线（空格与符号直接判非法）；
 *   2. **本机注册表**：这台设备上用过的昵称都记在 `CONFIG.namesKey` 里，重名直接拒（离线可用）；
 *   3. **服务端**：配了 `cloudBase` 时由 20-main 再打一次 `POST /api/name`（真·跨设备去重）。
 *      服务端不可达时**不阻断建号**，只在界面上写明"仅本机去重" —— 阶段 A 的铁律是单机可玩。
 *
 * 账号记录（`CONFIG.accountKey`）：
 *   { v, id, name, key, mode: 'douyin'|'local', openid, token, createdAt, lastLoginAt }
 *   - mode='douyin' 时 openid/token 来自服务端 `/api/profile`（真·code2session，见 svr/index.js）；
 *   - token 只用于将来阶段 B 的云存档鉴权，永不上屏、不进日志。
 *
 * 为什么昵称要单独存一张注册表：存档是可以被"重置"的，但**昵称占用不该跟着被释放** ——
 * 否则改名刷号就能绕过去重。注册表只增不减（上限 `account.nameRegistryCap`，超了丢最老的）。
 */
G.ACCOUNT = (function () {
  'use strict';

  var CONFIG = G.CONFIG;
  var BAL = G.BAL;

  /** 账号记录版本（结构变了就 +1；旧记录当没有，重新走一次登录） */
  var ACCOUNT_VERSION = 1;

  /** 保留名：不让玩家用，免得冒充系统 */
  var RESERVED = ['gm', 'admin', 'administrator', 'root', 'system', 'official', '官方', '客服', '管理员', '系统', '无名者', '测试', 'test'];

  /** 昵称词库：两段拼起来 + 两位数后缀（只用 G.RNG，可复现，不碰 Math.random） */
  var NAME_A = ['孤影', '夜行', '荒野', '赤月', '苍狼', '铁风', '碎星', '灰烬', '长夜', '疾风', '青云', '流火'];
  var NAME_B = ['旅人', '剑客', '猎手', '游侠', '拾荒者', '守望者', '行者', '流浪者', '铁匠', '学徒', '猎狼人'];

  /** 合法字符：中文（基本区）/ 字母 / 数字 / 下划线 */
  var LEGAL = /^[\u4e00-\u9fa5A-Za-z0-9_]+$/;
  var ILLEGAL = /[^\u4e00-\u9fa5A-Za-z0-9_]/g;

  function numberOr(value, fallback, min, max) {
    if (typeof value !== 'number' || !isFinite(value)) return fallback;
    if (value < min) return min;
    if (value > max) return max;
    return value;
  }

  /**
   * 昵称清洗：去掉空白与非法字符，再按**字符数**截到上限。
   * 数的是字符不是字节：中文名"孤影"是 2 个字符，不是 6 个字节。
   */
  function sanitizeName(raw) {
    if (typeof raw !== 'string') return '';
    var text = raw.replace(/\s+/g, '').replace(ILLEGAL, '');
    var chars = text.split('');
    if (chars.length > BAL.account.nameMax) text = chars.slice(0, BAL.account.nameMax).join('');
    return text;
  }

  /** 唯一性键：大小写与空白都不算数（Alice == alice） */
  function nameKey(name) {
    return sanitizeName(name).toLowerCase();
  }

  /**
   * 校验昵称能不能用 → `{ ok, name, reason }`。
   * reason: '' | 'empty' | 'illegal' | 'tooShort' | 'tooLong' | 'reserved' | 'taken'
   * 注意顺序：**先看非法字符，再看长度**，否则"超长的脏字符串"会被截断成合法昵称。
   */
  function validate(raw) {
    var text = typeof raw === 'string' ? raw.replace(/\s+/g, '') : '';
    var clean = sanitizeName(raw);
    if (!text) return { ok: false, name: clean, reason: 'empty' };
    if (!LEGAL.test(text)) return { ok: false, name: clean, reason: 'illegal' };
    var length = text.split('').length;
    if (length < BAL.account.nameMin) return { ok: false, name: clean, reason: 'tooShort' };
    if (length > BAL.account.nameMax) return { ok: false, name: clean, reason: 'tooLong' };
    if (RESERVED.indexOf(nameKey(clean)) >= 0) return { ok: false, name: clean, reason: 'reserved' };
    if (takenLocally(clean)) return { ok: false, name: clean, reason: 'taken' };
    return { ok: true, name: clean, reason: '' };
  }

  /** 校验失败的原因 → 给玩家看的一句话 */
  function reasonText(reason) {
    if (reason === 'empty') return '昵称不能为空';
    if (reason === 'illegal') return '昵称只能有中文、字母、数字和下划线';
    if (reason === 'tooShort') return '昵称至少 ' + BAL.account.nameMin + ' 个字符';
    if (reason === 'tooLong') return '昵称最多 ' + BAL.account.nameMax + ' 个字符';
    if (reason === 'reserved') return '这个昵称是保留名，换一个';
    if (reason === 'taken') return '昵称已被占用（本机已注册过），换一个';
    return '昵称不可用';
  }

  /* ------------------------------------------------------------ 本机昵称注册表 */

  function readRegistry() {
    var text = G.PLAT.storageGet(CONFIG.namesKey);
    var raw = null;
    if (text) {
      try {
        raw = JSON.parse(text);
      } catch (error) {
        raw = null;
      }
    }
    return raw && raw.names && raw.names.length ? raw.names.slice(0) : [];
  }

  function writeRegistry(names) {
    var capped = names;
    if (capped.length > BAL.account.nameRegistryCap) {
      capped = capped.slice(capped.length - BAL.account.nameRegistryCap);
    }
    try {
      G.PLAT.storageSet(CONFIG.namesKey, JSON.stringify({ v: 1, names: capped }));
      return true;
    } catch (error) {
      return false;
    }
  }

  /** 这个昵称在本机有没有被用过 */
  function takenLocally(name) {
    var key = nameKey(name);
    if (!key) return false;
    return readRegistry().indexOf(key) >= 0;
  }

  /** 记住一个昵称（建号成功后调用；重复调用幂等） */
  function remember(name) {
    var key = nameKey(name);
    if (!key) return false;
    var names = readRegistry();
    if (names.indexOf(key) >= 0) return true;
    names.push(key);
    return writeRegistry(names);
  }

  /** 本机注册表里的昵称数（自检与调试面板用） */
  function localNameCount() {
    return readRegistry().length;
  }

  /* ------------------------------------------------------------ 账号记录 */

  /** 读本机账号：没有 / 坏掉 / 还没起名 → null（调用方据此决定"去登录"还是"去创建角色"） */
  function load() {
    var text = G.PLAT.storageGet(CONFIG.accountKey);
    if (!text) return null;
    var raw = null;
    try {
      raw = JSON.parse(text);
    } catch (error) {
      return null;
    }
    if (!raw || typeof raw !== 'object' || raw.v !== ACCOUNT_VERSION) return null;
    var name = sanitizeName(raw.name);
    if (!name) return null;
    return {
      v: ACCOUNT_VERSION,
      id: typeof raw.id === 'string' ? raw.id : '',
      name: name,
      key: nameKey(name),
      mode: raw.mode === 'douyin' ? 'douyin' : 'local',
      openid: typeof raw.openid === 'string' ? raw.openid : '',
      token: typeof raw.token === 'string' ? raw.token : '',
      createdAt: numberOr(raw.createdAt, 0, 0, Infinity),
      lastLoginAt: numberOr(raw.lastLoginAt, 0, 0, Infinity)
    };
  }

  /**
   * 造一条账号记录（`at` 由调用方给时刻：世界时间或 Date.now —— 本模块自己不读时钟）。
   * id 的兜底值只做整数哈希，保证"同输入 → 同 id"，方便断言。
   */
  function create(fields) {
    var source = fields || {};
    var name = sanitizeName(source.name);
    var at = numberOr(source.at, 0, 0, Infinity);
    var mode = source.mode === 'douyin' ? 'douyin' : 'local';
    var fallbackId = 'local-' + G.RNG.hash32(nameKey(name).length, at | 0, 0x2b3d9f1).toString(16);
    return {
      v: ACCOUNT_VERSION,
      id: typeof source.id === 'string' && source.id ? source.id : fallbackId,
      name: name,
      key: nameKey(name),
      mode: mode,
      openid: typeof source.openid === 'string' ? source.openid : '',
      token: typeof source.token === 'string' ? source.token : '',
      createdAt: at,
      lastLoginAt: at
    };
  }

  /** 写账号记录（顺便把昵称记进注册表） */
  function persist(account) {
    if (!account || !account.name) return false;
    remember(account.name);
    try {
      G.PLAT.storageSet(CONFIG.accountKey, JSON.stringify(account));
      return true;
    } catch (error) {
      return false;
    }
  }

  /** 改几个字段并落盘（登录回来时更新 openid/token/lastLoginAt） */
  function update(account, fields) {
    if (!account) return null;
    var source = fields || {};
    var next = create({
      id: source.id ? source.id : account.id,
      name: source.name ? source.name : account.name,
      mode: source.mode ? source.mode : account.mode,
      openid: source.openid !== undefined ? source.openid : account.openid,
      token: source.token !== undefined ? source.token : account.token,
      at: source.at !== undefined ? source.at : account.lastLoginAt
    });
    next.createdAt = account.createdAt || next.createdAt;
    next.lastLoginAt = source.at !== undefined ? source.at : account.lastLoginAt;
    persist(next);
    return next;
  }

  /** 忘掉本机账号（调试 / 换号用）。昵称注册表**故意不清**：占用一旦发生就不该被释放 */
  function forget() {
    G.PLAT.storageRemove(CONFIG.accountKey);
  }

  /**
   * 随机昵称：从词库拼一个还没被占用的名字。
   * 40 次都撞（本机注册表塞满）时退化成"游侠 + 哈希尾巴"，保证有返回值。
   */
  function suggest(salt) {
    var at = numberOr(salt, 0, -Infinity, Infinity) | 0;
    var rng = new G.RNG.Rng(G.RNG.hash32(at, 0x5a17c3, 0x77c1));
    for (var attempt = 0; attempt < 40; attempt += 1) {
      var name = sanitizeName(rng.pick(NAME_A) + rng.pick(NAME_B) + rng.int(10, 99));
      if (validate(name).ok) return name;
    }
    return sanitizeName('游侠' + (Math.abs(at) % 10000));
  }

  return {
    ACCOUNT_VERSION: ACCOUNT_VERSION,
    sanitizeName: sanitizeName,
    nameKey: nameKey,
    validate: validate,
    reasonText: reasonText,
    load: load,
    create: create,
    persist: persist,
    update: update,
    forget: forget,
    suggest: suggest,
    remember: remember,
    takenLocally: takenLocally,
    localNameCount: localNameCount
  };
})();

/**
 * 12-platform.js —— 平台层：**全工程唯一允许出现 `tt.` 的文件**（架构铁律 #1）
 *
 * 为什么卡这么死：小游戏没有 DOM、没有 window，而云上跑断言时连 tt 都没有。
 * 只要"碰平台"的代码全部关在这一个文件里，02~11（逻辑层）就能在 node 里裸跑，
 * 于是"决策 #7 不做 web 端 ⇒ 失去 harness"这个坑被补上（见 tools\minigame-selftest.mjs）。
 *
 * 对外接口（上层只认这些，不认 tt / wx / window）：
 *   PLAT.available()      当前环境能不能真的跑（有主画布 = 能）
 *   PLAT.ctx() / canvas() 主画布与 2D 上下文
 *   PLAT.screen()         { cssW, cssH, dpr, safeArea }
 *   PLAT.onTouch(h)       触摸（小游戏用**全局** tt.onTouchStart，不是 canvas 事件）
 *   PLAT.storageGet/Set/Remove
 *   PLAT.vibrate(ms)      震动反馈（失败就当没有）
 *   PLAT.onShow(fn)       前后台切换（用来暂停 + 存档）
 *   PLAT.frame(fn)        每帧回调（requestAnimationFrame，带 setTimeout 兜底）
 *   PLAT.cloud(path, opt) 抖音云 HTTP（未配置 cloudBase 时直接 reject，**不发包**）
 *   PLAT.login()          tt.login 的 code（失败 resolve(null)，降级成本机账号）
 *   PLAT.editText(opt)    平台键盘输入（昵称用；没有这个 API 时 resolve(null)）
 *   PLAT.sfx(name)        音效（audio\*.wav，由 tools\gen-minigame-sfx.mjs 生成）
 *   PLAT.bgm(play)        背景音乐（首次触摸解锁后才会真的响）
 *   PLAT.setAudio(opt)    音量与开关（由 20-main 从 balance + 存档设置推过来）
 */

G.PLAT = (function () {
  'use strict';

  var CONFIG = G.CONFIG;

  /** 唯一的平台探测点：node 里跑自检时 tt 是 undefined，所有 tt 调用都必须先过这一关 */
  var hasTt = typeof tt !== 'undefined' && tt !== null;

  var systemInfo = null;
  var mainCanvas = null;
  var ctx = null;
  var memoryStore = {};
  var touchHandlers = null;
  var showHandlers = [];

  function initCanvas() {
    if (mainCanvas) return mainCanvas;
    if (hasTt && typeof tt.createCanvas === 'function') {
      try {
        // 小游戏里第一次调用 tt.createCanvas() 拿到的就是**主画布**（屏幕）
        mainCanvas = tt.createCanvas();
      } catch (error) {
        mainCanvas = null;
      }
    }
    // 部分基础库版本直接把主画布挂在全局（typeof 探测，避免 node 里直接报错）
    if (!mainCanvas && typeof canvas !== 'undefined' && canvas) mainCanvas = canvas;
    if (mainCanvas && typeof mainCanvas.getContext === 'function') ctx = mainCanvas.getContext('2d');
    return mainCanvas;
  }

  function info() {
    if (!systemInfo) {
      if (hasTt && typeof tt.getSystemInfoSync === 'function') {
        try {
          systemInfo = tt.getSystemInfoSync();
        } catch (error) {
          systemInfo = null;
        }
      }
      // 兜底：iPhone X 尺寸。只影响布局、不影响逻辑，所以宁可给默认值也不抛
      if (!systemInfo) systemInfo = { windowWidth: 375, windowHeight: 812, pixelRatio: 2 };
    }
    return systemInfo;
  }

  function screen() {
    var system = info();
    var area = system.safeArea;
    var cssW = system.windowWidth || 375;
    var cssH = system.windowHeight || 812;
    return {
      cssW: cssW,
      cssH: cssH,
      dpr: system.pixelRatio || 1,
      safeArea: area
        ? { top: area.top || 0, bottom: cssH - (area.bottom || cssH) }
        : { top: 0, bottom: 0 }
    };
  }

  function available() {
    return !!initCanvas() && !!ctx;
  }

  function storageGet(key) {
    if (hasTt && typeof tt.getStorageSync === 'function') {
      try {
        var value = tt.getStorageSync(key);
        return value === undefined || value === null || value === '' ? null : value;
      } catch (error) {
        return null;
      }
    }
    return memoryStore[key] || null;
  }

  function storageSet(key, value) {
    if (hasTt && typeof tt.setStorageSync === 'function') {
      try {
        tt.setStorageSync(key, value);
        return true;
      } catch (error) {
        return false;
      }
    }
    memoryStore[key] = value;
    return true;
  }

  function storageRemove(key) {
    if (hasTt && typeof tt.removeStorageSync === 'function') {
      try {
        tt.removeStorageSync(key);
      } catch (error) {
        /* 删不掉就算了，不值得打断游戏 */
      }
      return;
    }
    delete memoryStore[key];
  }

  /**
   * 触摸事件。
   * 小游戏里必须用**全局** tt.onTouchStart（不是 canvas.addEventListener）；
   * 这也是上一版"点 UI 顺带触发攻击"那个 bug 的修法：事件只在这一处收，再分发。
   */
  function onTouch(handlers) {
    touchHandlers = handlers;
    if (!hasTt) return false;
    if (typeof tt.offTouchStart === 'function') {
      try {
        // 先全注销再注册，避免热更新后同一次触摸被处理两遍
        tt.offTouchStart();
        tt.offTouchMove();
        tt.offTouchEnd();
        tt.offTouchCancel();
      } catch (error) {
        /* 没注册过就 off 失败，忽略 */
      }
    }
    var bind = function (name, fn) {
      if (typeof tt[name] !== 'function') return;
      tt[name](fn);
    };
    bind('onTouchStart', function (event) {
      if (touchHandlers && touchHandlers.start) touchHandlers.start(event);
    });
    bind('onTouchMove', function (event) {
      if (touchHandlers && touchHandlers.move) touchHandlers.move(event);
    });
    bind('onTouchEnd', function (event) {
      if (touchHandlers && touchHandlers.end) touchHandlers.end(event);
    });
    bind('onTouchCancel', function (event) {
      if (touchHandlers && touchHandlers.end) touchHandlers.end(event);
    });
    return true;
  }

  function vibrate(ms) {
    if (!hasTt || typeof tt.vibrateShort !== 'function') return;
    try {
      tt.vibrateShort({ duration: ms });
    } catch (error) {
      /* 震动失败不值得报错 */
    }
  }

  /** 前后台切换：切回来时校准时间，切出去时存档（19-main 里接） */
  function onShow(handler) {
    showHandlers.push(handler);
    if (hasTt && typeof tt.onShow === 'function') {
      tt.onShow(function () {
        for (var i = 0; i < showHandlers.length; i += 1) showHandlers[i](true);
      });
      tt.onHide(function () {
        for (var i = 0; i < showHandlers.length; i += 1) showHandlers[i](false);
      });
    }
  }

  /** 每帧回调：优先 requestAnimationFrame（小游戏里有全局实现），没有就用 setTimeout 兜底 */
  function frame(callback) {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(callback);
      return;
    }
    setTimeout(function () {
      callback(Date.now());
    }, 16);
  }

  /**
   * 抖音云 HTTP 调用（阶段 B 的入口，现在只给「设置 → 云后端」做连通性自测）。
   * 没填 cloudBase 就直接 reject —— **默认一个包都不发**，单机玩法不受影响。
   */
  function cloud(path, options) {
    return new Promise(function (resolve, reject) {
      if (!CONFIG.cloudBase) {
        reject(new Error('未配置云后端地址（douyin-minigame/src/00-config.js 的 cloudBase）'));
        return;
      }
      if (!hasTt || typeof tt.request !== 'function') {
        reject(new Error('当前环境不支持 tt.request'));
        return;
      }
      var opt = options || {};
      tt.request({
        url: CONFIG.cloudBase + path,
        method: opt.method || 'GET',
        data: opt.data,
        header: { 'content-type': 'application/json' },
        success: function (res) {
          resolve(res);
        },
        fail: function (err) {
          reject(err);
        }
      });
    });
  }

  /**
   * 平台登录：拿 `tt.login` 的 code —— 阶段 B 那条 `code → /api/profile → openid` 链路的第 0 步
   * （A4 就用它来区分"抖音账号"与"本机账号"）。
   *
   * 语义约定：**失败就 resolve(null)**，绝不 reject、绝不卡住玩家 ——
   * 拿不到 code 时界面会降级成"本机离线账号"，阶段 A 的单机玩法不受影响。
   */
  function login() {
    return new Promise(function (resolve) {
      if (!hasTt || typeof tt.login !== 'function') {
        resolve(null);
        return;
      }
      var done = false;
      var finish = function (value) {
        if (!done) {
          done = true;
          resolve(value);
        }
      };
      try {
        tt.login({
          success: function (res) {
            var code = res && typeof res.code === 'string' ? res.code : '';
            var anonymousCode = res && typeof res.anonymousCode === 'string' ? res.anonymousCode : '';
            finish(code || anonymousCode ? { code: code, anonymousCode: anonymousCode } : null);
          },
          fail: function () {
            finish(null);
          }
        });
      } catch (error) {
        finish(null);
      }
      // 兜底：部分基础库上 login 既不回 success 也不回 fail（比如没配 appid），3 秒后按失败处理
      setTimeout(function () {
        finish(null);
      }, 3000);
    });
  }

  /**
   * 文本输入：小游戏里没有 `<input>`，昵称只能靠平台键盘（`tt.showKeyboard`）。
   * 返回值：输入的字符串，或 null（= 玩家取消 / 当前基础库没有这个 API）。
   * 没有 API 时界面会自动退回"随机昵称 + 换一个"，所以这里不抛错。
   */
  function editText(options) {
    var opt = options || {};
    return new Promise(function (resolve) {
      if (!hasTt || typeof tt.showKeyboard !== 'function') {
        resolve(null);
        return;
      }
      var done = false;
      var value = typeof opt.defaultValue === 'string' ? opt.defaultValue : '';
      var finish = function (result) {
        if (done) return;
        done = true;
        if (hasTt && typeof tt.hideKeyboard === 'function') {
          try {
            tt.hideKeyboard({});
          } catch (error) {
            /* 键盘收不收得掉都不值得报错 */
          }
        }
        resolve(typeof result === 'string' && result ? result : null);
      };
      // 键盘确认 / 收起的回调是全局事件（不是 showKeyboard 的参数），两只都接上
      if (typeof tt.onKeyboardConfirm === 'function') {
        tt.onKeyboardConfirm(function (res) {
          if (res && typeof res.value === 'string') value = res.value;
        });
      }
      if (typeof tt.onKeyboardComplete === 'function') {
        tt.onKeyboardComplete(function (res) {
          if (res && typeof res.value === 'string') value = res.value;
          finish(value);
        });
      }
      try {
        tt.showKeyboard({
          defaultValue: value,
          maxLength: opt.maxLength || 12,
          multiple: false,
          confirmHold: false,
          confirmType: 'done',
          success: function (res) {
            if (res && typeof res.value === 'string') value = res.value;
          },
          fail: function () {
            finish(null);
          }
        });
      } catch (error) {
        finish(null);
      }
      // 兜底：有些基础库的 complete 事件不一定会回来，60 秒后按当前值收尾（不让 Promise 永远挂着）
      setTimeout(function () {
        finish(value);
      }, 60000);
    });
  }

  /* ---------------------------------------------------------------- 音频（A4） */

  /**
   * 音效文件（相对包根的路径）：由 `tools\gen-minigame-sfx.mjs` **生成**，不是下载来的素材
   * （决策 #10：不引入来源说不清的文件）。键名 = 代码里 PLAT.sfx('键名') 的名字。
   */
  var AUDIO_FILES = {
    hit: 'audio/hit.wav',
    crit: 'audio/crit.wav',
    kill: 'audio/kill.wav',
    hurt: 'audio/hurt.wav',
    levelup: 'audio/levelup.wav',
    chest: 'audio/chest.wav',
    ui: 'audio/ui.wav',
    camp: 'audio/camp.wav'
  };
  var BGM_FILE = 'audio/bgm.wav';

  /** 音频设置（由 20-main 从 balance + 存档设置推过来；平台层不认识"存档"这个东西） */
  var audio = { enabled: true, sfxEnabled: true, bgmEnabled: true, sfxVolume: 0.6, bgmVolume: 0.32 };
  var audioContexts = {};
  var bgmContext = null;
  var bgmPlaying = false;
  /** 小游戏要求"首次交互之后才能播"：解锁前不碰 BGM，音效照试（失败就算了） */
  var audioUnlocked = false;

  function audioSupported() {
    return hasTt && typeof tt.createInnerAudioContext === 'function';
  }

  function makeContext(file, volume, loop) {
    if (!audioSupported()) return null;
    try {
      var instance = tt.createInnerAudioContext();
      instance.src = file;
      instance.volume = volume;
      if (loop === true) instance.loop = true;
      return instance;
    } catch (error) {
      return null;
    }
  }

  function contextFor(name) {
    if (audioContexts[name]) return audioContexts[name];
    if (!AUDIO_FILES[name]) return null;
    var instance = makeContext(AUDIO_FILES[name], audio.sfxVolume, false);
    if (instance) audioContexts[name] = instance;
    return instance;
  }

  function stopBgm() {
    if (!bgmContext) return false;
    try {
      bgmContext.stop();
    } catch (error) {
      /* 停不掉不值得报错 */
    }
    bgmPlaying = false;
    return true;
  }

  /** 推设置：开关与音量（改设置后调一次即可；已经建好的上下文会同步音量） */
  function setAudio(options) {
    var source = options || {};
    if (source.enabled !== undefined) audio.enabled = source.enabled === true;
    if (source.sfxEnabled !== undefined) audio.sfxEnabled = source.sfxEnabled === true;
    if (source.bgmEnabled !== undefined) audio.bgmEnabled = source.bgmEnabled === true;
    if (typeof source.sfxVolume === 'number') audio.sfxVolume = source.sfxVolume;
    if (typeof source.bgmVolume === 'number') audio.bgmVolume = source.bgmVolume;
    for (var name in audioContexts) {
      if (Object.prototype.hasOwnProperty.call(audioContexts, name)) audioContexts[name].volume = audio.sfxVolume;
    }
    if (bgmContext) bgmContext.volume = audio.bgmVolume;
    // 关掉 BGM 开关时立刻停：否则玩家会以为"设置没生效"
    if (!audio.enabled || !audio.bgmEnabled) stopBgm();
    return audio;
  }

  /** 播一次音效（没有 tt / 文件缺失 / 关掉音效 → 静默返回 false，绝不抛） */
  function sfx(name) {
    if (!audio.enabled || !audio.sfxEnabled) return false;
    var instance = contextFor(name);
    if (!instance) return false;
    try {
      if (typeof instance.stop === 'function') instance.stop();
      if (typeof instance.seek === 'function') instance.seek(0);
      instance.play();
      return true;
    } catch (error) {
      return false;
    }
  }

  /** 背景音乐：play=true 循环播；play=false 停 */
  function bgm(play) {
    if (play !== true) return stopBgm();
    if (!audio.enabled || !audio.bgmEnabled || !audioUnlocked) return false;
    if (!bgmContext) bgmContext = makeContext(BGM_FILE, audio.bgmVolume, true);
    if (!bgmContext) return false;
    try {
      bgmContext.play();
      bgmPlaying = true;
      return true;
    } catch (error) {
      return false;
    }
  }

  /** 首次触摸时调一次（之后音效 / BGM 才算"解锁"，这是平台的硬要求） */
  function unlockAudio() {
    if (audioUnlocked) return false;
    audioUnlocked = true;
    return true;
  }

  function audioState() {
    var ready = [];
    for (var name in audioContexts) {
      if (Object.prototype.hasOwnProperty.call(audioContexts, name)) ready.push(name);
    }
    return {
      supported: audioSupported(),
      unlocked: audioUnlocked,
      bgmPlaying: bgmPlaying,
      enabled: audio.enabled,
      sfxEnabled: audio.sfxEnabled,
      bgmEnabled: audio.bgmEnabled,
      sfxVolume: audio.sfxVolume,
      bgmVolume: audio.bgmVolume,
      files: Object.keys(AUDIO_FILES).concat(['bgm']),
      loaded: ready
    };
  }

  return {
    hasTt: function () {
      return hasTt;
    },
    initCanvas: initCanvas,
    available: available,
    ctx: function () {
      return ctx;
    },
    canvas: function () {
      return mainCanvas;
    },
    screen: screen,
    onTouch: onTouch,
    storageGet: storageGet,
    storageSet: storageSet,
    storageRemove: storageRemove,
    vibrate: vibrate,
    onShow: onShow,
    frame: frame,
    cloud: cloud,
    login: login,
    editText: editText,
    setAudio: setAudio,
    sfx: sfx,
    bgm: bgm,
    stopBgm: stopBgm,
    unlockAudio: unlockAudio,
    audioSupported: audioSupported,
    audioState: audioState
  };
})();

/**
 * 13-screen.js —— 竖屏适配（core/screen 层）
 *
 * 设计稿宽度固定 **720**（balance.view.designWidth），逻辑高度随手机长短可变：
 *   scale  = 屏幕 CSS 宽 / 720          → 所有绘制都用"设计单位"，手机再窄也不会挤
 *   height = 屏幕 CSS 高 / scale         → 长屏手机逻辑高度更大（视野更长，不是拉扁）
 *
 * 三条排版纪律（01-game-design §2）：
 *   1. UI 一律**锚点布局**（吸顶 / 吸底），不许写死 y 坐标；
 *   2. 安全区：顶部至少留 `view.safeTop`、底部至少留 `view.safeBottom`（避开刘海与手势条）；
 *   3. 触摸坐标是**屏幕 CSS 像素**，必须除以 scale 才是设计单位 —— 直接当世界坐标用会错位。
 */

G.SCREEN = (function () {
  'use strict';

  var BAL = G.BAL;

  /** 设计稿宽度：手机再窄也不变，靠缩放适配 */
  var DESIGN_WIDTH = BAL.view.designWidth;

  var state = {
    cssW: 375,
    cssH: 812,
    dpr: 1,
    scale: 1,
    width: DESIGN_WIDTH,
    height: 1600,
    safeTop: BAL.view.safeTop,
    safeBottom: BAL.view.safeBottom
  };

  /**
   * 重新计算适配（启动时调一次；小游戏支持 tt.onWindowResize 的话以后也能热调）。
   * 传入的是 PLAT.screen() 的结果。
   */
  function resize(screenInfo) {
    state.cssW = screenInfo.cssW;
    state.cssH = screenInfo.cssH;
    state.dpr = screenInfo.dpr;
    state.scale = state.cssW / DESIGN_WIDTH;
    state.width = DESIGN_WIDTH;
    state.height = state.cssH / state.scale;
    // 安全区取"文档下限"与"系统安全区"的较大值：两根都用上，谁大听谁的
    var systemTop = screenInfo.safeArea ? screenInfo.safeArea.top / state.scale : 0;
    var systemBottom = screenInfo.safeArea ? screenInfo.safeArea.bottom / state.scale : 0;
    state.safeTop = Math.max(BAL.view.safeTop, systemTop);
    state.safeBottom = Math.max(BAL.view.safeBottom, systemBottom);
    return state;
  }

  /**
   * 画布尺寸 + 变换。
   * 主画布的 width/height 是**物理像素**（CSS × dpr），而绘制坐标是设计单位，
   * 所以这里一次把 scale 与 dpr 都折进 setTransform —— 渲染层从此不用关心两者。
   */
  function applyTo(canvas, ctx) {
    var pixelW = Math.max(1, Math.round(state.cssW * state.dpr));
    var pixelH = Math.max(1, Math.round(state.cssH * state.dpr));
    if (canvas.width !== pixelW) canvas.width = pixelW;
    if (canvas.height !== pixelH) canvas.height = pixelH;
    var k = state.scale * state.dpr;
    ctx.setTransform(k, 0, 0, k, 0, 0);
  }

  function width() {
    return state.width;
  }

  function height() {
    return state.height;
  }

  function scale() {
    return state.scale;
  }

  function safeTop() {
    return state.safeTop;
  }

  function safeBottom() {
    return state.safeBottom;
  }

  /** 屏幕 CSS 坐标（触摸事件给的）→ 设计单位坐标 */
  function pointer(cssX, cssY) {
    return { x: cssX / state.scale, y: cssY / state.scale };
  }

  /** 竖屏中轴：居中排版用 */
  function centerX() {
    return state.width / 2;
  }

  /** 自动选目标的视野半径（世界单位）：沿用 balance.combat.visionRange */
  function visionRadius() {
    return BAL.combat.visionRange;
  }

  return {
    DESIGN_WIDTH: DESIGN_WIDTH,
    resize: resize,
    applyTo: applyTo,
    width: width,
    height: height,
    scale: scale,
    safeTop: safeTop,
    safeBottom: safeBottom,
    pointer: pointer,
    centerX: centerX,
    visionRadius: visionRadius,
    state: state
  };
})();

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

/**
 * 15-input.js —— 输入层：浮动摇杆 + 圆形按钮（UI 层，只认设计单位坐标）
 *
 * 手感沿用上一版已验证的规则（balance.input）：
 *   - **浮动摇杆**：按下才出现，圆心 = 按下点（不用固定底盘，拇指落在哪就从哪推）；
 *   - 贴边夹取：摇杆帽超过 `stickRadius` 就被夹在圈上；
 *   - **死区** `deadZone`：抖一点不算移动，避免站着乱抖；
 *   - 按下有 `pressFeedbackMs` 的视觉反馈。
 *
 * 与上一版最大的不同（roadmap §四.4 踩过的坑）：触摸事件**只在这里收**，
 * 由 19-main 决定这一刻是"面板吃"还是"世界吃"，绝不让 UI 点击顺带触发攻击。
 *
 * 所有坐标都是**设计单位**（13-screen 已经把屏幕 CSS 像素换过来了）。
 */

G.INPUT = (function () {
  'use strict';

  var BAL = G.BAL;
  var SCREEN = G.SCREEN;

  var state = {
    /** 摇杆 */
    stick: {
      active: false,
      touchId: null,
      baseX: 0,
      baseY: 0,
      knobX: 0,
      knobY: 0,
      dx: 0,
      dy: 0,
      magnitude: 0,
      pressUntil: 0
    },
    /** 圆形按钮（由 19-main 每帧 setButtons 注册，坐标同为设计单位） */
    buttons: [],
    /** 正在按住的按钮（松手才触发点击） */
    pressedButtonId: null,
    pressedTouchId: null
  };

  var pressedFeedbackUntil = 0;

  function setButtons(list) {
    state.buttons = list || [];
  }

  function buttons() {
    return state.buttons;
  }

  /** 按钮命中测试：返回按钮对象或 null（圆形按钮，半径稍微放宽 6 设计像素，手指更好点） */
  function buttonAt(x, y) {
    for (var i = 0; i < state.buttons.length; i += 1) {
      var button = state.buttons[i];
      var dx = x - button.x;
      var dy = y - button.y;
      var r = button.r + 6;
      if (dx * dx + dy * dy <= r * r) return button;
    }
    return null;
  }

  /** 摇杆区（左下角的一块矩形，避开底部安全区）：只有落在这里才起摇杆 */
  function inStickZone(x, y) {
    var zoneW = SCREEN.width() * BAL.input.zoneWidthRatio;
    var zoneH = SCREEN.height() * BAL.input.zoneHeightRatio;
    return x >= 0 && x <= zoneW && y >= SCREEN.height() - SCREEN.safeBottom() - zoneH && y <= SCREEN.height();
  }

  function reset() {
    state.stick.active = false;
    state.stick.touchId = null;
    state.stick.dx = 0;
    state.stick.dy = 0;
    state.stick.magnitude = 0;
    state.pressedButtonId = null;
    state.pressedTouchId = null;
  }

  /**
   * 按下：先看按钮，再看摇杆区。
   * 返回 { button } 表示这一下落在按钮上（由调用方在松手时执行 onTap），
   * 返回 { stick: true } 表示起摇杆，返回 null 表示这一下不归输入层管。
   */
  function begin(pointer, nowMs) {
    var button = buttonAt(pointer.x, pointer.y);
    if (button) {
      state.pressedButtonId = button.id;
      state.pressedTouchId = pointer.id;
      pressedFeedbackUntil = nowMs + BAL.input.pressFeedbackMs;
      return { button: button };
    }
    if (!inStickZone(pointer.x, pointer.y)) return null;

    state.stick.active = true;
    state.stick.touchId = pointer.id;
    state.stick.baseX = pointer.x;
    state.stick.baseY = pointer.y;
    state.stick.knobX = pointer.x;
    state.stick.knobY = pointer.y;
    state.stick.dx = 0;
    state.stick.dy = 0;
    state.stick.magnitude = 0;
    return { stick: true };
  }

  function move(pointer) {
    if (!state.stick.active || pointer.id !== state.stick.touchId) return;
    var dx = pointer.x - state.stick.baseX;
    var dy = pointer.y - state.stick.baseY;
    var length = Math.sqrt(dx * dx + dy * dy);
    var radius = BAL.input.stickRadius;
    if (length > radius && length > 0.0001) {
      // 贴边夹取：摇杆帽最多推到圈上
      dx = (dx / length) * radius;
      dy = (dy / length) * radius;
      length = radius;
    }
    state.stick.knobX = state.stick.baseX + dx;
    state.stick.knobY = state.stick.baseY + dy;
    var magnitude = length / radius;
    if (magnitude < BAL.input.deadZone) {
      state.stick.dx = 0;
      state.stick.dy = 0;
      state.stick.magnitude = 0;
      return;
    }
    state.stick.magnitude = magnitude > 1 ? 1 : magnitude;
    state.stick.dx = dx / length;
    state.stick.dy = dy / length;
  }

  /** 松手：摇杆归零；按钮命中则返回它（调用方负责执行 onTap），没命中返回 null */
  function end(pointer) {
    if (state.stick.active && pointer.id === state.stick.touchId) {
      state.stick.active = false;
      state.stick.touchId = null;
      state.stick.dx = 0;
      state.stick.dy = 0;
      state.stick.magnitude = 0;
      return null;
    }
    if (state.pressedTouchId !== null && pointer.id === state.pressedTouchId) {
      var id = state.pressedButtonId;
      state.pressedButtonId = null;
      state.pressedTouchId = null;
      if (!id) return null;
      for (var i = 0; i < state.buttons.length; i += 1) {
        if (state.buttons[i].id === id) return state.buttons[i];
      }
      return null;
    }
    return null;
  }

  /** 当前移动方向（已归一化，含死区判定）：19-main 每帧读它驱动玩家 */
  function direction() {
    return { x: state.stick.dx, y: state.stick.dy, magnitude: state.stick.magnitude };
  }

  /** 摇杆是否处于按下态（绘制用：按下才画出来） */
  function stickActive() {
    return state.stick.active || pressedFeedbackUntil > 0;
  }

  /** 按钮是否处于按下反馈窗口（绘制用） */
  function isPressed(buttonId, nowMs) {
    return state.pressedButtonId === buttonId && nowMs < pressedFeedbackUntil + 200;
  }

  /** 画摇杆（圆形，符合"先用圆形代替外观"的阶段约定） */
  function draw(ctx) {
    var stick = state.stick;
    if (!stick.active) return;
    var radius = BAL.input.stickRadius;

    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(stick.baseX, stick.baseY, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(stick.baseX, stick.baseY, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.globalAlpha = 0.85;
    ctx.fillStyle = '#ffd479';
    ctx.beginPath();
    ctx.arc(stick.knobX, stick.knobY, BAL.input.knobDiameter / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  return {
    setButtons: setButtons,
    buttons: buttons,
    buttonAt: buttonAt,
    inStickZone: inStickZone,
    reset: reset,
    begin: begin,
    move: move,
    end: end,
    direction: direction,
    stickActive: stickActive,
    isPressed: isPressed,
    draw: draw,
    state: state
  };
})();

/**
 * 16-render.js —— 世界渲染（纯 Canvas 2D，**没有引擎**，决策 #7 + 02-architecture §1）
 *
 * 阶段 A3：实体从"圆"升级成**简单自绘角色**，地图从"色块 + 圆点"升级成**有设计感的地图**。
 * 一帧的顺序（20-main.renderTo 调用）：
 *   地表色块 + 营地石砖 → 小径路网 → 装饰（按主题换造型）→ 地标（废墟 / 石碑）→ 营地道具
 *   → 弹道 → 怪（4 种造型 + 朝向 + 走路）→ 目标环 → 玩家（小人 + 八方向 + 挥砍）→ 飘字
 *
 * 为什么仍然**不贴图**：包体与图集是阶段 E 的事（01-game-design §12），而"简单角色"用
 * 十几个基本图元就能画出来 —— 先把辨识度与手感做出来，以后换图集只动这一层。
 *
 * 三条纪律：
 *   1. 只画视野内的东西（02-architecture §9）：路网 / 营地先做矩形粗判，装饰与实体由 WORLD 裁剪；
 *   2. 动画相位只由 `G.WORLD.now()`（逻辑时间）推出来 —— 不用 Date.now，逻辑才可重放；
 *   3. 只用 moveTo/lineTo/arc/fillRect/… 这些**基础图元**（arcTo / ellipse / 虚线在冒烟测试的
 *      假 canvas 上下文里没有实现，用了会让 19-selftest 那道防线自己炸掉）。
 *
 * 相机与坐标：世界坐标 → 屏幕（设计单位）：
 *   sx = x - camera.x + SCREEN.width() / 2
 *   sy = y - camera.y + SCREEN.height() / 2
 */

G.RENDER = (function () {
  'use strict';

  var BAL = G.BAL;
  var CHUNK = G.CHUNK;
  var TERRAIN = G.TERRAIN;
  var SCREEN = G.SCREEN;

  /** 一圈（弧度）：省得到处写 Math.PI * 2 */
  var TAU = Math.PI * 2;

  /** 表现用常量（颜色 / 帧长这类东西不是玩法数值；玩法数值一律在 shared/balance.json） */
  var ACTOR_STYLE = {
    walkMs: 260,
    swingMs: 240,
    swingArc: 2.1,
    idleBobMs: 900,
    shadowRadius: 0.95
  };

  /** 怪的种类配色（自绘造型的主色；精英统一加金冠 + 金环） */
  var MONSTER_COLORS = {
    wolf: '#c96b3a',
    bat: '#8a6bd0',
    mage: '#4f8fd8',
    brute: '#8d939c'
  };

  var MONSTER_DARK = {
    wolf: '#7d3f1f',
    bat: '#523f86',
    mage: '#2f5a8c',
    brute: '#565b63'
  };

  /** 玩家配色（受伤时整体换成 PLAYER_FLASH 那一套，画法不用改） */
  var PLAYER_PALETTE = {
    skin: '#f0c49a',
    hair: '#3b2a20',
    tunic: '#4f7fd8',
    tunicDark: '#33569c',
    belt: '#e0c07a',
    boot: '#2b3550',
    weapon: '#e6eefc',
    guard: '#ffd479'
  };

  var PLAYER_FLASH = {
    skin: '#ffd7d7',
    hair: '#ffb0b0',
    tunic: '#ff9d9d',
    tunicDark: '#e06b6b',
    belt: '#ffd0d0',
    boot: '#c96b6b',
    weapon: '#ffffff',
    guard: '#ffffff'
  };

  /** 倒地时整套变灰（3 秒后原地复活，见 10-player.js） */
  var PLAYER_DOWN = {
    skin: '#8d8d94',
    hair: '#5c5c62',
    tunic: '#6a6f7d',
    tunicDark: '#4a4f5c',
    belt: '#7d7566',
    boot: '#3c3f49',
    weapon: '#9aa0ad',
    guard: '#8d8674'
  };

  /**
   * 装饰造型：按**主题**换形状（不是只换颜色）。
   * 值就是给每种主题的 草 / 石 / 树 各选一个画法 —— 于是"越走越远，地貌不一样"是看得见的。
   */
  var DECOR_STYLE = {
    grassland: { grass: 'tuft', rock: 'boulder', tree: 'broadleaf' },
    desert: { grass: 'shrub', rock: 'slab', tree: 'cactus' },
    snowfield: { grass: 'snowtuft', rock: 'snowrock', tree: 'pine' },
    scorch: { grass: 'ember', rock: 'charred', tree: 'deadwood' },
    void: { grass: 'tendril', rock: 'shard', tree: 'crystal' }
  };

  /** 营地配色（石砖地、围栏、帐篷…） */
  var CAMP_COLORS = {
    plate: ['#6f6a60', '#7b756a', '#66604f'],
    plateEdge: '#4a453c',
    fence: '#6b5333',
    fenceTop: '#8a6c43',
    canvas: '#b8563f',
    canvasDark: '#8c3f2d',
    wood: '#7a5a38',
    fire: '#ffb347',
    fireCore: '#fff0b8',
    glow: '#ffcb6b',
    banner: '#d8c07a'
  };

  /** 世界坐标 → 屏幕设计坐标 */
  function toScreen(camera, x, y) {
    return { x: x - camera.x + SCREEN.width() / 2, y: y - camera.y + SCREEN.height() / 2 };
  }

  /** 视野矩形（世界坐标）：渲染各处共用一份，别各算一套 */
  function viewRect(camera) {
    var width = SCREEN.width();
    var height = SCREEN.height();
    return {
      minX: camera.x - width / 2,
      minY: camera.y - height / 2,
      maxX: camera.x + width / 2,
      maxY: camera.y + height / 2,
      width: width,
      height: height
    };
  }

  function rectOverlaps(a, b) {
    return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
  }

  /**
   * 圆角矩形路径：只用 moveTo/lineTo/arc/closePath 四种基本图元。
   * 不用 arcTo / ellipse / 虚线 —— 假 canvas 上下文（19-selftest 的冒烟测试）里没有它们，
   * 用了会让"一进游戏就白屏"的那道防线自己先炸掉。
   */
  function roundRectPath(ctx, x, y, w, h, r) {
    var rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.arc(x + w - rr, y + rr, rr, -Math.PI / 2, 0);
    ctx.lineTo(x + w, y + h - rr);
    ctx.arc(x + w - rr, y + h - rr, rr, 0, Math.PI / 2);
    ctx.lineTo(x + rr, y + h);
    ctx.arc(x + rr, y + h - rr, rr, Math.PI / 2, Math.PI);
    ctx.lineTo(x, y + rr);
    ctx.arc(x + rr, y + rr, rr, Math.PI, Math.PI * 1.5);
    ctx.closePath();
  }

  /** 椭圆：用 translate + scale + arc 画（同样是为了不依赖 ellipse） */
  function ellipsePath(ctx, x, y, rx, ry) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, ry / (rx > 0 ? rx : 1));
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, TAU);
    ctx.restore();
  }

  /**
   * 朝向 → 0..7 的方向下标：0=下、1=左下、2=左、3=左上、4=上、5=右上、6=右、7=右下。
   * 纯函数（不碰画布），所以"转身对不对"能在 19-selftest 里断言，不必靠肉眼。
   */
  function facingIndex(facing) {
    var x = facing && isFinite(facing.x) ? facing.x : 0;
    var y = facing && isFinite(facing.y) ? facing.y : 1;
    if (x === 0 && y === 0) return 0;
    var index = Math.round((Math.atan2(y, x) - Math.PI / 2) / (Math.PI / 4));
    return ((index % 8) + 8) % 8;
  }

  /** 朝左的四个方向要镜像画：造型一律按"朝右"画，省一半代码 */
  function facesLeft(index) {
    return index >= 1 && index <= 3;
  }

  /** 背对镜头（往上走）时不画脸 —— 小小一笔，"转身"立刻看得出来 */
  function facesAway(index) {
    return index === 3 || index === 4 || index === 5;
  }

  /**
   * 走路相位 0..1：腿与手按它前后摆。
   * 相位只由**逻辑时间**算出来（不用 Date.now），所以它可重放、也能在无头环境里断言。
   */
  function walkPhase(nowMs, moving, periodMs) {
    if (!moving) return 0;
    var period = periodMs > 0 ? periodMs : ACTOR_STYLE.walkMs;
    return (((nowMs % period) + period) % period) / period;
  }

  /** 出手动画进度 0..1（1 = 已经打出去了）：由出手时刻与出手间隔推出来 */
  function swingPhase(nowMs, lastAttackAt, intervalMs) {
    if (!lastAttackAt) return 1;
    var span = intervalMs > 0 ? intervalMs : ACTOR_STYLE.swingMs;
    var elapsed = nowMs - lastAttackAt;
    if (elapsed < 0 || elapsed > span) return 1;
    return elapsed / span;
  }

  /** 地面投影：所有角色共用（没有影子的话，角色会像"贴纸"浮在地上） */
  function drawShadow(ctx, point, radius, alpha) {
    ctx.globalAlpha = alpha === undefined ? 0.3 : alpha;
    ctx.fillStyle = '#05070d';
    ellipsePath(ctx, point.x, point.y + radius * 0.55, radius * ACTOR_STYLE.shadowRadius, radius * 0.42);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  /**
   * 地表：每 chunk 一块主题底色 + 4×4 色块（颜色来自 groundVariant，位置与主题都由哈希决定），
   * 最后在原点盖上营地的石砖地。
   */
  function drawGround(ctx, camera) {
    var rect = viewRect(camera);
    var chunks = CHUNK.chunksInRect(rect.minX, rect.minY, rect.maxX, rect.maxY, 0);
    var seed = BAL.season.worldSeed;
    var block = CHUNK.CHUNK_SIZE / 4;

    for (var i = 0; i < chunks.length; i += 1) {
      var cx = chunks[i].cx;
      var cy = chunks[i].cy;
      var band = G.SPAWN.chunkCenterBand(cx, cy);
      var theme = TERRAIN.themeForBand(band);
      var tint = TERRAIN.deepBandIntensity(band);
      var ground = theme.ground;
      var origin = toScreen(camera, CHUNK.chunkOrigin(cx), CHUNK.chunkOrigin(cy));

      // 底色：深带用 accent 混一点，让"越走越远"有视觉反馈
      ctx.fillStyle = TERRAIN.mixHex(ground[0], '#000010', tint);
      ctx.fillRect(origin.x, origin.y, CHUNK.CHUNK_SIZE, CHUNK.CHUNK_SIZE);

      for (var by = 0; by < 4; by += 1) {
        for (var bx = 0; bx < 4; bx += 1) {
          // 取 8×8 噪声网格上的偶数格当代表，视觉效果一样但少画一大半
          var variant = TERRAIN.groundVariant(seed, cx, cy, bx * 2, by * 2);
          if (variant === 0) continue;
          ctx.fillStyle = TERRAIN.mixHex(ground[variant], '#000010', tint);
          ctx.fillRect(origin.x + bx * block, origin.y + by * block, block + 1, block + 1);
        }
      }
    }

    drawCampPlaza(ctx, camera, rect);
  }

  /**
   * 营地石砖地：原点半径 world.camp.radius 内的地面换成石板（地图最显眼的"设计感"地标）。
   * 只画**与视野相交**的那一块；砖的色调用整数哈希抽（同一块砖永远同一个色调，纯粹是"好看的一致"）。
   */
  function drawCampPlaza(ctx, camera, rect) {
    var camp = TERRAIN.campCenter();
    var campRect = {
      minX: camp.x - camp.radius,
      minY: camp.y - camp.radius,
      maxX: camp.x + camp.radius,
      maxY: camp.y + camp.radius
    };
    if (!rectOverlaps(rect, campRect)) return;

    // 底板：先铺一个整圆，免得砖缝里漏出草地（看着像"破了个洞"）
    var center = toScreen(camera, camp.x, camp.y);
    ctx.fillStyle = CAMP_COLORS.plateEdge;
    ctx.beginPath();
    ctx.arc(center.x, center.y, camp.radius, 0, TAU);
    ctx.fill();

    var plate = BAL.world.camp.plazaPlate;
    var seed = BAL.season.worldSeed;
    var inset = 3;
    var clampMinX = rect.minX > campRect.minX ? rect.minX : campRect.minX;
    var clampMaxX = rect.maxX < campRect.maxX ? rect.maxX : campRect.maxX;
    var clampMinY = rect.minY > campRect.minY ? rect.minY : campRect.minY;
    var clampMaxY = rect.maxY < campRect.maxY ? rect.maxY : campRect.maxY;
    var radiusSq = camp.radius * camp.radius;

    for (var py = Math.floor(clampMinY / plate) * plate; py <= clampMaxY; py += plate) {
      for (var px = Math.floor(clampMinX / plate) * plate; px <= clampMaxX; px += plate) {
        var dx = px + plate / 2 - camp.x;
        var dy = py + plate / 2 - camp.y;
        if (dx * dx + dy * dy > radiusSq) continue;
        var tone = G.RNG.hashInt([seed, Math.round(px / plate), Math.round(py / plate)], CAMP_COLORS.plate.length);
        var point = toScreen(camera, px, py);
        ctx.fillStyle = CAMP_COLORS.plate[tone];
        ctx.fillRect(point.x + inset, point.y + inset, plate - inset * 2, plate - inset * 2);
      }
    }
  }

  /**
   * 小径路网：把 04-terrain 算出的线段画成"有人常走"的土路。
   * 两遍 stroke —— 先描一圈暗边、再铺路面；不这么做，路会像贴在地上的一条色带。
   * 同一条路的所有线段攒进一个路径里，只两次 stroke（手机上省调用）。
   */
  function drawRoads(ctx, camera) {
    var rect = viewRect(camera);
    var segments = TERRAIN.roadsInRect(BAL.season.worldSeed, rect.minX, rect.minY, rect.maxX, rect.maxY);
    if (segments.length === 0) return;

    var band = G.SPAWN.chunkCenterBand(CHUNK.chunkIndexOf(camera.x), CHUNK.chunkIndexOf(camera.y));
    var theme = TERRAIN.themeForBand(band);
    var width = BAL.world.road.width;
    var surface = TERRAIN.mixHex('#6d5b45', theme.decor, 0.35);

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (var pass = 0; pass < 2; pass += 1) {
      ctx.globalAlpha = pass === 0 ? 0.45 : 0.85;
      ctx.strokeStyle = pass === 0 ? '#231d16' : surface;
      ctx.lineWidth = pass === 0 ? width + 10 : width;
      ctx.beginPath();
      for (var i = 0; i < segments.length; i += 1) {
        var a = toScreen(camera, segments[i].x1, segments[i].y1);
        var b = toScreen(camera, segments[i].x2, segments[i].y2);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /* ---------------------------------------------------------------- 营地（原点新手区） */

  /**
   * 营地：新手出生点 + 视觉上的"家"。
   * 注意它是**纯外观**（阶段 A 的取舍）：营地里的怪照样刷新 ——
   * 要不要做成"半径内不刷怪"的安全区，等阶段 B/C 服务端权威化时和公会锚点一起定
   * （01-game-design §10 的 safeRadius 就是同一个想法）。
   */
  function drawCamp(ctx, camera) {
    var camp = TERRAIN.campCenter();
    var rect = viewRect(camera);
    var reach = BAL.world.camp.fenceRadius + 200;
    var campRect = {
      minX: camp.x - reach,
      minY: camp.y - reach,
      maxX: camp.x + reach,
      maxY: camp.y + reach
    };
    if (!rectOverlaps(rect, campRect)) return;

    drawCampFence(ctx, camera, camp);
    var props = TERRAIN.campProps();
    var nowMs = G.WORLD.now();
    for (var i = 0; i < props.length; i += 1) {
      drawCampProp(ctx, toScreen(camera, props[i].x, props[i].y), props[i], nowMs);
    }

    var label = toScreen(camera, camp.x, camp.y - camp.radius + 44);
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = '#ffe6a8';
    ctx.font = '26px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('新手营地', label.x, label.y);
    ctx.globalAlpha = 1;
  }

  /**
   * 围栏：一圈木桩 + 两条横梁，+y 方向留 `gateWidth` 宽的门（玩家从门走出去）。
   * 本文件在 check-minigame 的三角函数白名单里，所以这里可以放心用 sin/cos 绕圆。
   */
  function drawCampFence(ctx, camera, camp) {
    var radius = BAL.world.camp.fenceRadius;
    var gate = BAL.world.camp.gateWidth / radius;
    var step = 56 / radius;
    var center = toScreen(camera, camp.x, camp.y);
    var start = Math.PI / 2 + gate / 2;
    var end = Math.PI / 2 - gate / 2 + TAU;
    var postHeight = 30;
    var angle;

    ctx.strokeStyle = CAMP_COLORS.fence;
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (angle = start; angle <= end; angle += step) {
      var x = center.x + Math.cos(angle) * radius;
      var y = center.y + Math.sin(angle) * radius;
      ctx.moveTo(x, y);
      ctx.lineTo(x, y - postHeight);
    }
    ctx.stroke();

    // 两条横梁：canvas 的变换在"建路径"时就生效，所以 save/translate/restore 就够
    ctx.strokeStyle = CAMP_COLORS.fenceTop;
    ctx.lineWidth = 4;
    var railHeights = [12, 22];
    for (var i = 0; i < railHeights.length; i += 1) {
      ctx.save();
      ctx.translate(center.x, center.y - railHeights[i]);
      ctx.beginPath();
      ctx.arc(0, 0, radius, start, end);
      ctx.stroke();
      ctx.restore();
    }
  }

  /** 营地道具：帐篷 / 篝火 / 旗 / 木牌 / 箱子 / 树桩（摆位数据在 04-terrain 的 CAMP_PROPS） */
  function drawCampProp(ctx, point, prop, nowMs) {
    var scale = prop.scale || 1;
    if (prop.kind === 'tent') drawTent(ctx, point, scale);
    else if (prop.kind === 'fire') drawCampfire(ctx, point, scale, nowMs);
    else if (prop.kind === 'banner') drawBanner(ctx, point, scale, nowMs);
    else if (prop.kind === 'sign') drawSign(ctx, point, scale);
    else if (prop.kind === 'crate') drawCrate(ctx, point, scale);
    else if (prop.kind === 'stump') drawStump(ctx, point, scale);
  }

  /** 帐篷：三角帆布（左亮右暗）+ 门洞 + 顶杆 */
  function drawTent(ctx, point, scale) {
    var w = 78 * scale;
    var h = 62 * scale;
    drawShadow(ctx, point, w * 0.45, 0.26);
    ctx.fillStyle = CAMP_COLORS.canvasDark;
    ctx.beginPath();
    ctx.moveTo(point.x - w / 2, point.y);
    ctx.lineTo(point.x + w / 2, point.y);
    ctx.lineTo(point.x + w * 0.16, point.y - h);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = CAMP_COLORS.canvas;
    ctx.beginPath();
    ctx.moveTo(point.x - w / 2, point.y);
    ctx.lineTo(point.x + w * 0.08, point.y);
    ctx.lineTo(point.x + w * 0.16, point.y - h);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#3a2418';
    ctx.beginPath();
    ctx.moveTo(point.x + w * 0.04, point.y);
    ctx.lineTo(point.x + w * 0.32, point.y);
    ctx.lineTo(point.x + w * 0.2, point.y - h * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = CAMP_COLORS.wood;
    ctx.lineWidth = 4 * scale;
    ctx.beginPath();
    ctx.moveTo(point.x + w * 0.16, point.y - h);
    ctx.lineTo(point.x + w * 0.16, point.y - h - 12 * scale);
    ctx.stroke();
  }

  /** 篝火：光晕 + 石圈 + 柴 + 两层火苗（抖动只跟逻辑时间走，不用 Date.now） */
  function drawCampfire(ctx, point, scale, nowMs) {
    var flick = Math.sin(nowMs / 130) * 0.5 + Math.sin(nowMs / 47) * 0.5;
    var i;
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = CAMP_COLORS.glow;
    ctx.beginPath();
    ctx.arc(point.x, point.y - 8 * scale, 58 * scale + flick * 4, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.fillStyle = '#6d675c';
    for (i = 0; i < 6; i += 1) {
      var angle = (i / 6) * TAU;
      ctx.beginPath();
      ctx.arc(point.x + Math.cos(angle) * 26 * scale, point.y + Math.sin(angle) * 13 * scale, 7 * scale, 0, TAU);
      ctx.fill();
    }

    ctx.strokeStyle = CAMP_COLORS.wood;
    ctx.lineWidth = 7 * scale;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(point.x - 20 * scale, point.y);
    ctx.lineTo(point.x + 20 * scale, point.y - 5 * scale);
    ctx.moveTo(point.x - 18 * scale, point.y - 9 * scale);
    ctx.lineTo(point.x + 15 * scale, point.y + 2 * scale);
    ctx.stroke();

    var height = 46 * scale + flick * 8;
    drawFlame(ctx, point.x, point.y - 6 * scale, 22 * scale, height, CAMP_COLORS.fire, flick);
    drawFlame(ctx, point.x, point.y - 6 * scale, 11 * scale, height * 0.6, CAMP_COLORS.fireCore, -flick);
  }

  /** 三角火苗：底边宽 w、高 h，顶端随 swing（-1..1）左右摆 */
  function drawFlame(ctx, x, y, w, h, color, swing) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x - w / 2, y);
    ctx.lineTo(x + w / 2, y);
    ctx.lineTo(x + swing * w * 0.5, y - h);
    ctx.closePath();
    ctx.fill();
  }

  /** 旗：木杆 + 会飘的布（布每时每刻都在动，让营地"活着"） */
  function drawBanner(ctx, point, scale, nowMs) {
    var wave = Math.sin(nowMs / 320) * 6 * scale;
    drawShadow(ctx, point, 13 * scale, 0.24);
    ctx.strokeStyle = CAMP_COLORS.wood;
    ctx.lineWidth = 7 * scale;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
    ctx.lineTo(point.x, point.y - 92 * scale);
    ctx.stroke();
    ctx.fillStyle = CAMP_COLORS.banner;
    ctx.beginPath();
    ctx.moveTo(point.x, point.y - 88 * scale);
    ctx.lineTo(point.x + 52 * scale + wave, point.y - 74 * scale);
    ctx.lineTo(point.x + 52 * scale + wave, point.y - 40 * scale);
    ctx.lineTo(point.x, point.y - 54 * scale);
    ctx.closePath();
    ctx.fill();
  }

  /** 木牌：写"新手营地"，给刚进游戏的玩家一个明确的心智锚点 */
  function drawSign(ctx, point, scale) {
    ctx.strokeStyle = CAMP_COLORS.wood;
    ctx.lineWidth = 8 * scale;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
    ctx.lineTo(point.x, point.y - 40 * scale);
    ctx.stroke();
    ctx.fillStyle = '#8c6a42';
    ctx.fillRect(point.x - 62 * scale, point.y - 40 * scale, 124 * scale, 40 * scale);
    ctx.strokeStyle = '#5d4527';
    ctx.lineWidth = 3;
    ctx.strokeRect(point.x - 62 * scale, point.y - 40 * scale, 124 * scale, 40 * scale);
    ctx.fillStyle = '#fff3d6';
    ctx.font = Math.round(24 * scale) + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('新手营地', point.x, point.y - 20 * scale);
  }

  /** 木箱：箱体 + 两条箱带（营地的补给堆） */
  function drawCrate(ctx, point, scale) {
    var size = 34 * scale;
    drawShadow(ctx, point, size * 0.5, 0.24);
    ctx.fillStyle = '#8a6a44';
    ctx.fillRect(point.x - size / 2, point.y - size, size, size);
    ctx.strokeStyle = '#5d4527';
    ctx.lineWidth = 3;
    ctx.strokeRect(point.x - size / 2, point.y - size, size, size);
    ctx.beginPath();
    ctx.moveTo(point.x - size / 2, point.y - size * 0.62);
    ctx.lineTo(point.x + size / 2, point.y - size * 0.62);
    ctx.moveTo(point.x, point.y - size);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
  }

  /** 树桩：年轮 + 柱身（营地里的零碎） */
  function drawStump(ctx, point, scale) {
    var r = 22 * scale;
    drawShadow(ctx, point, r * 0.9, 0.22);
    ctx.fillStyle = '#7d5c38';
    ctx.fillRect(point.x - r, point.y - r * 0.9, r * 2, r * 0.9);
    ctx.fillStyle = '#a4814f';
    ellipsePath(ctx, point.x, point.y - r * 0.9, r, r * 0.4);
    ctx.fill();
    ctx.strokeStyle = '#6b4d2c';
    ctx.lineWidth = 2;
    ellipsePath(ctx, point.x, point.y - r * 0.9, r * 0.55, r * 0.22);
    ctx.stroke();
  }

  /**
   * 装饰：按**主题造型**画（草 / 石 / 树 三种形状 × 五套主题），纯视觉、无碰撞。
   * 造型表在 DECOR_STYLE；每件装饰自带 band，所以"这块地是荒漠还是雪原"一眼就能看出来。
   */
  function drawDecor(ctx, camera, decor) {
    for (var i = 0; i < decor.length; i += 1) {
      var item = decor[i];
      var theme = TERRAIN.themeForBand(
        item.band === undefined
          ? G.SPAWN.chunkCenterBand(CHUNK.chunkIndexOf(item.x), CHUNK.chunkIndexOf(item.y))
          : item.band
      );
      var style = DECOR_STYLE[theme.id] || DECOR_STYLE.grassland;
      var point = toScreen(camera, item.x, item.y);
      if (item.kind === 'tree') drawTree(ctx, point, item.size, style.tree, theme);
      else if (item.kind === 'rock') drawRock(ctx, point, item.size, style.rock, theme);
      else drawGrass(ctx, point, item.size, style.grass, theme, item.flip);
    }
  }

  /** 草：五套主题五种长相（草簇 / 干枝 / 雪草 / 余烬 / 虚境触须） */
  function drawGrass(ctx, point, scale, kind, theme, flip) {
    var size = 15 * scale;
    var dir = flip ? -1 : 1;
    ctx.lineCap = 'round';
    if (kind === 'tuft' || kind === 'snowtuft') {
      ctx.strokeStyle = kind === 'snowtuft' ? '#dff0ff' : theme.decor;
      ctx.lineWidth = 3 * scale;
      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
      ctx.lineTo(point.x - size * 0.5 * dir, point.y - size);
      ctx.moveTo(point.x, point.y);
      ctx.lineTo(point.x + size * 0.15 * dir, point.y - size * 1.25);
      ctx.moveTo(point.x, point.y);
      ctx.lineTo(point.x + size * 0.7 * dir, point.y - size * 0.85);
      ctx.stroke();
      return;
    }
    if (kind === 'shrub') {
      ctx.strokeStyle = theme.decor;
      ctx.lineWidth = 2 * scale;
      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
      ctx.lineTo(point.x - size * 0.35 * dir, point.y - size * 0.8);
      ctx.moveTo(point.x, point.y);
      ctx.lineTo(point.x + size * 0.45 * dir, point.y - size * 0.9);
      ctx.stroke();
      ctx.fillStyle = theme.accent;
      ctx.beginPath();
      ctx.arc(point.x + size * 0.2 * dir, point.y - size * 0.45, 3 * scale, 0, TAU);
      ctx.fill();
      return;
    }
    if (kind === 'ember') {
      ctx.strokeStyle = theme.decor;
      ctx.lineWidth = 3 * scale;
      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
      ctx.lineTo(point.x - size * 0.4 * dir, point.y - size * 0.9);
      ctx.moveTo(point.x, point.y);
      ctx.lineTo(point.x + size * 0.5 * dir, point.y - size);
      ctx.stroke();
      ctx.fillStyle = theme.accent;
      ctx.beginPath();
      ctx.arc(point.x - size * 0.1 * dir, point.y - size * 0.35, 3.5 * scale, 0, TAU);
      ctx.fill();
      return;
    }
    // 虚境触须：折两下的一根细须
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 3 * scale;
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
    ctx.lineTo(point.x + size * 0.15 * dir, point.y - size * 0.7);
    ctx.lineTo(point.x - size * 0.1 * dir, point.y - size * 1.2);
    ctx.stroke();
  }

  /** 石：五套主题五种长相（圆石 / 石板 / 雪岩 / 焦岩 / 虚境碎片） */
  function drawRock(ctx, point, scale, kind, theme) {
    var size = kind === 'slab' ? 11 * scale : kind === 'shard' ? 13 * scale : 9 * scale;
    var i;
    if (kind === 'shard') {
      ctx.fillStyle = theme.decor;
      ctx.beginPath();
      ctx.moveTo(point.x, point.y - size * 2.1);
      ctx.lineTo(point.x + size * 0.7, point.y - size);
      ctx.lineTo(point.x + size * 0.2, point.y);
      ctx.lineTo(point.x - size * 0.6, point.y - size * 1.1);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = theme.accent;
      ctx.beginPath();
      ctx.moveTo(point.x, point.y - size * 2.1);
      ctx.lineTo(point.x + size * 0.25, point.y - size * 1.1);
      ctx.lineTo(point.x - size * 0.6, point.y - size * 1.1);
      ctx.closePath();
      ctx.fill();
      return;
    }
    if (kind === 'slab') {
      ctx.fillStyle = theme.decor;
      ctx.fillRect(point.x - size * 1.4, point.y - size * 0.7, size * 2.8, size * 0.7);
      ctx.fillStyle = theme.accent;
      ctx.fillRect(point.x - size * 1.1, point.y - size * 1.05, size * 2.2, size * 0.4);
      return;
    }
    // 圆石 / 雪岩 / 焦岩：一个五边形 + 三条棱线
    ctx.fillStyle = kind === 'charred' ? '#39231f' : theme.decor;
    ctx.beginPath();
    ctx.moveTo(point.x - size, point.y);
    ctx.lineTo(point.x - size * 0.7, point.y - size * 1.1);
    ctx.lineTo(point.x + size * 0.2, point.y - size * 1.5);
    ctx.lineTo(point.x + size, point.y - size * 0.6);
    ctx.lineTo(point.x + size * 0.8, point.y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = kind === 'snowrock' ? '#eaf6ff' : 'rgba(0,0,0,0.28)';
    ctx.lineWidth = 2.5 * scale;
    ctx.beginPath();
    for (i = -1; i <= 1; i += 1) {
      ctx.moveTo(point.x + i * size * 0.45, point.y - size * 1.2);
      ctx.lineTo(point.x + i * size * 0.7, point.y - size * 0.1);
    }
    ctx.stroke();
  }

  /** 树：五套主题五种长相（阔叶 / 仙人掌 / 松树 / 枯木 / 虚境水晶） */
  function drawTree(ctx, point, scale, kind, theme) {
    var h = 30 * scale;
    var w = 26 * scale;
    var layer;
    drawShadow(ctx, point, w * 0.6, 0.22);
    if (kind === 'cactus') {
      ctx.fillStyle = theme.decor;
      roundRectPath(ctx, point.x - w * 0.22, point.y - h * 1.6, w * 0.44, h * 1.6, w * 0.22);
      ctx.fill();
      ctx.fillRect(point.x - w * 0.85, point.y - h * 1.1, w * 0.63, w * 0.3);
      ctx.fillRect(point.x - w * 0.85, point.y - h * 1.1, w * 0.3, h * 0.55);
      ctx.fillRect(point.x + w * 0.22, point.y - h * 0.85, w * 0.63, w * 0.3);
      ctx.fillRect(point.x + w * 0.55, point.y - h * 1.25, w * 0.3, h * 0.7);
      return;
    }
    if (kind === 'crystal') {
      ctx.fillStyle = theme.decor;
      ctx.beginPath();
      ctx.moveTo(point.x, point.y - h * 1.7);
      ctx.lineTo(point.x + w * 0.45, point.y - h * 0.5);
      ctx.lineTo(point.x, point.y);
      ctx.lineTo(point.x - w * 0.45, point.y - h * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = theme.accent;
      ctx.beginPath();
      ctx.moveTo(point.x + w * 0.6, point.y - h * 0.95);
      ctx.lineTo(point.x + w * 0.95, point.y - h * 0.35);
      ctx.lineTo(point.x + w * 0.6, point.y);
      ctx.lineTo(point.x + w * 0.3, point.y - h * 0.4);
      ctx.closePath();
      ctx.fill();
      return;
    }
    // 树干：松树 / 阔叶 / 枯木共用
    ctx.fillStyle = kind === 'deadwood' ? '#4a3a2c' : '#5b4126';
    ctx.fillRect(point.x - w * 0.14, point.y - h, w * 0.28, h);
    if (kind === 'deadwood') {
      ctx.strokeStyle = '#4a3a2c';
      ctx.lineWidth = 4 * scale;
      ctx.beginPath();
      ctx.moveTo(point.x, point.y - h * 0.75);
      ctx.lineTo(point.x - w * 0.6, point.y - h * 1.15);
      ctx.moveTo(point.x, point.y - h * 0.95);
      ctx.lineTo(point.x + w * 0.55, point.y - h * 1.3);
      ctx.stroke();
      return;
    }
    if (kind === 'pine') {
      for (layer = 0; layer < 3; layer += 1) {
        var baseY = point.y - h * (0.55 + layer * 0.42);
        var tier = w * (0.95 - layer * 0.2);
        ctx.fillStyle = layer === 2 ? theme.accent : theme.decor;
        ctx.beginPath();
        ctx.moveTo(point.x - tier, baseY);
        ctx.lineTo(point.x + tier, baseY);
        ctx.lineTo(point.x, baseY - h * 0.62);
        ctx.closePath();
        ctx.fill();
      }
      return;
    }
    // 阔叶：一团圆冠 + 一点高光
    ctx.fillStyle = theme.decor;
    ctx.beginPath();
    ctx.arc(point.x, point.y - h * 1.15, w * 0.85, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = theme.accent;
    ctx.beginPath();
    ctx.arc(point.x - w * 0.25, point.y - h * 1.3, w * 0.34, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  /** 地标：废墟（断墙 + 倒柱）与石碑（底座 + 发光符文）—— 给"我走到新地方了"的反馈 */
  function drawLandmarks(ctx, camera, landmarks) {
    for (var i = 0; i < landmarks.length; i += 1) {
      var landmark = landmarks[i];
      var theme = TERRAIN.themeForBand(landmark.band);
      var point = toScreen(camera, landmark.x, landmark.y);
      var ruins = landmark.kind !== 'obelisk';

      // 地面光环：标出这块地标"占的地方"
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = theme.accent;
      ellipsePath(ctx, point.x, point.y, 62, 26);
      ctx.fill();
      ctx.globalAlpha = 1;

      if (ruins) drawRuins(ctx, point, theme);
      else drawObelisk(ctx, point, theme);

      ctx.globalAlpha = 0.8;
      ctx.fillStyle = '#ffffff';
      ctx.font = '20px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ruins ? '废墟' : '石碑', point.x, point.y + 62);
      ctx.globalAlpha = 1;
    }
  }

  /** 废墟：两段错落的墙 + 一根倒下的柱子 + 碎石 */
  function drawRuins(ctx, point, theme) {
    ctx.fillStyle = '#6b6459';
    ctx.fillRect(point.x - 46, point.y - 34, 40, 34);
    ctx.fillRect(point.x + 6, point.y - 22, 44, 22);
    ctx.fillStyle = '#7d766a';
    ctx.fillRect(point.x - 46, point.y - 40, 40, 7);
    ctx.fillRect(point.x + 6, point.y - 28, 44, 7);
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(point.x - 34, point.y - 34);
    ctx.lineTo(point.x - 30, point.y);
    ctx.moveTo(point.x - 16, point.y - 34);
    ctx.lineTo(point.x - 20, point.y);
    ctx.moveTo(point.x + 22, point.y - 22);
    ctx.lineTo(point.x + 26, point.y);
    ctx.stroke();

    ctx.fillStyle = '#8a8275';
    ctx.fillRect(point.x - 30, point.y + 6, 58, 12);
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = theme.accent;
    ellipsePath(ctx, point.x - 30, point.y + 12, 6, 6);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.fillStyle = '#5f594f';
    ctx.beginPath();
    ctx.arc(point.x + 40, point.y + 12, 6, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(point.x - 52, point.y + 16, 4, 0, TAU);
    ctx.fill();
  }

  /** 石碑：底座 + 碑身 + 发光符文 + 一束光柱（远远就能看见） */
  function drawObelisk(ctx, point, theme) {
    var glow = theme.accent;
    var r;
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.moveTo(point.x - 22, point.y);
    ctx.lineTo(point.x + 22, point.y);
    ctx.lineTo(point.x + 12, point.y - 122);
    ctx.lineTo(point.x - 12, point.y - 122);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.fillStyle = '#5d5750';
    ctx.fillRect(point.x - 30, point.y - 12, 60, 12);
    ctx.fillStyle = '#6f6862';
    ctx.beginPath();
    ctx.moveTo(point.x - 18, point.y - 12);
    ctx.lineTo(point.x + 18, point.y - 12);
    ctx.lineTo(point.x + 11, point.y - 86);
    ctx.lineTo(point.x - 11, point.y - 86);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = glow;
    for (r = 0; r < 3; r += 1) ctx.fillRect(point.x - 7, point.y - 30 - r * 18, 14, 4);
    ctx.beginPath();
    ctx.arc(point.x, point.y - 96, 7, 0, TAU);
    ctx.fill();
  }

  /**
   * 怪：四种造型各自自绘（朝向 + 走路/扇翅 + 受击闪白 + 精英金冠）+ 血条 + 名字。
   * 仅对"当前目标/精英"画文字 —— 画文字很贵，要省着用。
   */
  function drawMonsters(ctx, camera, monsters, targetId, nowMs) {
    var now = typeof nowMs === 'number' ? nowMs : G.WORLD.now();
    for (var i = 0; i < monsters.length; i += 1) {
      var monster = monsters[i];
      var point = toScreen(camera, monster.x, monster.y);
      var color = MONSTER_COLORS[monster.kindId] || '#c96b3a';
      var dark = MONSTER_DARK[monster.kindId] || '#7d3f1f';
      var index = facingIndex({ x: monster.dirX, y: monster.dirY });
      var moving = monster.state === 'chase' || monster.state === 'return';
      // 每只怪一个固定的相位偏移：同一张地图上的怪不会"齐步走"（id 是纯整数，可复现）
      var phase = walkPhase(now + (monster.id % 97) * 13, moving, ACTOR_STYLE.walkMs + (monster.id % 5) * 20);
      var flashing = monster.hurtUntil > 0 && now < monster.hurtUntil;

      // 仇恨提示：正在追 / 正在打的怪脚下加一圈暗色（一眼看出谁醒了）
      if (monster.state === 'chase' || monster.state === 'attack') {
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = dark;
        ellipsePath(ctx, point.x, point.y + monster.radius * 0.5, monster.radius + 10, monster.radius * 0.6);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      drawShadow(ctx, point, monster.radius * 0.9, 0.26);
      drawMonsterBody(
        ctx,
        point,
        monster,
        index,
        phase,
        flashing ? '#ffffff' : color,
        flashing ? '#ffd7d7' : dark
      );

      if (monster.elite) {
        ctx.strokeStyle = '#ffd479';
        ctx.lineWidth = 4;
        ellipsePath(ctx, point.x, point.y + monster.radius * 0.55, monster.radius + 8, monster.radius * 0.5);
        ctx.stroke();
        drawCrown(ctx, point.x, point.y - monster.radius * 2.5, monster.radius * 0.5);
      }

      // 血条：只在掉过血或正在交战时画；位置抬到新造型头顶之上
      if (monster.hp < monster.hpMax || monster.state === 'attack' || monster.state === 'chase') {
        var barW = Math.max(36, monster.radius * 2.4);
        var barY = point.y - monster.radius * 2.9 - 10;
        var ratio = monster.hpMax > 0 ? monster.hp / monster.hpMax : 0;
        if (ratio < 0) ratio = 0;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(point.x - barW / 2, barY, barW, 7);
        ctx.fillStyle = '#e05c5c';
        ctx.fillRect(point.x - barW / 2, barY, barW * ratio, 7);
      }

      if (monster.elite || monster.id === targetId) {
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.font = '18px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(monster.name + ' Lv.' + monster.level, point.x, point.y + monster.radius + 22);
      }
    }
  }

  /** 按种类分发造型：四种怪各有一套"简单角色"画法（都与朝向、走路相位挂钩） */
  function drawMonsterBody(ctx, point, monster, index, phase, color, dark) {
    if (monster.kindId === 'bat') drawBat(ctx, point, monster, index, phase, color, dark);
    else if (monster.kindId === 'mage') drawMage(ctx, point, monster, index, phase, color, dark);
    else if (monster.kindId === 'brute') drawBrute(ctx, point, monster, index, phase, color, dark);
    else drawWolf(ctx, point, monster, index, phase, color, dark);
  }

  /** 荒狼：四足 + 尾巴 + 尖耳 + 尖吻（四条腿交替摆动） */
  function drawWolf(ctx, point, monster, index, phase, color, dark) {
    var r = monster.radius;
    var flip = facesLeft(index) ? -1 : 1;
    var swing = Math.sin(phase * TAU) * r * 0.18;
    var legs = [-0.58, -0.22, 0.24, 0.6];
    var i;

    ctx.fillStyle = dark;
    for (i = 0; i < legs.length; i += 1) {
      var legSwing = i % 2 === 0 ? swing : -swing;
      ctx.fillRect(point.x + legs[i] * r * flip - r * 0.09, point.y - r * 0.5, r * 0.18, r * 0.5 + legSwing);
    }

    ctx.strokeStyle = dark;
    ctx.lineWidth = r * 0.18;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(point.x - r * 0.8 * flip, point.y - r * 0.8);
    ctx.lineTo(point.x - r * 1.25 * flip, point.y - r * (0.9 + Math.sin(phase * TAU) * 0.2));
    ctx.stroke();

    ctx.fillStyle = color;
    ellipsePath(ctx, point.x, point.y - r * 0.8, r, r * 0.5);
    ctx.fill();

    var headX = point.x + r * 0.72 * flip;
    var headY = point.y - r * 1.0;
    ctx.beginPath();
    ctx.arc(headX, headY, r * 0.42, 0, TAU);
    ctx.fill();
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.moveTo(headX, headY - r * 0.12);
    ctx.lineTo(headX + r * 0.6 * flip, headY + r * 0.1);
    ctx.lineTo(headX, headY + r * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(headX - r * 0.3 * flip, headY - r * 0.3);
    ctx.lineTo(headX - r * 0.08 * flip, headY - r * 0.8);
    ctx.lineTo(headX + r * 0.16 * flip, headY - r * 0.32);
    ctx.closePath();
    ctx.fill();
    if (!facesAway(index)) {
      ctx.fillStyle = '#ffef9f';
      ctx.beginPath();
      ctx.arc(headX + r * 0.14 * flip, headY - r * 0.04, r * 0.09, 0, TAU);
      ctx.fill();
    }
  }

  /** 血蝠：一对扇动的翅膀 + 悬停的身体（相位乘 2，翅膀比腿快一倍） */
  function drawBat(ctx, point, monster, index, phase, color, dark) {
    var r = monster.radius;
    var flap = Math.sin(phase * TAU * 2) * r * 0.35;
    var y = point.y - r * 1.3 + Math.sin(phase * TAU) * r * 0.16;
    var side;

    ctx.fillStyle = dark;
    for (side = -1; side <= 1; side += 2) {
      ctx.beginPath();
      ctx.moveTo(point.x + side * r * 0.25, y);
      ctx.lineTo(point.x + side * r * 1.25, y - r * 0.55 - flap);
      ctx.lineTo(point.x + side * r * 0.95, y + r * 0.35 - flap * 0.4);
      ctx.closePath();
      ctx.fill();
    }

    ctx.fillStyle = color;
    ellipsePath(ctx, point.x, y, r * 0.45, r * 0.6);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(point.x, y - r * 0.6, r * 0.34, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(point.x - r * 0.26, y - r * 0.75);
    ctx.lineTo(point.x - r * 0.14, y - r * 1.15);
    ctx.lineTo(point.x + r * 0.02, y - r * 0.8);
    ctx.closePath();
    ctx.moveTo(point.x + r * 0.26, y - r * 0.75);
    ctx.lineTo(point.x + r * 0.14, y - r * 1.15);
    ctx.lineTo(point.x - r * 0.02, y - r * 0.8);
    ctx.closePath();
    ctx.fill();

    if (!facesAway(index)) {
      ctx.fillStyle = '#ff8a8a';
      ctx.beginPath();
      ctx.arc(point.x - r * 0.14, y - r * 0.62, r * 0.08, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(point.x + r * 0.14, y - r * 0.62, r * 0.08, 0, TAU);
      ctx.fill();
    }
  }

  /** 游魂法师：长袍 + 兜帽 + 发光法杖（原地漂浮，没有腿） */
  function drawMage(ctx, point, monster, index, phase, color, dark) {
    var r = monster.radius;
    var flip = facesLeft(index) ? -1 : 1;
    var baseY = point.y + Math.sin(phase * TAU) * r * 0.14;

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(point.x - r * 0.85, baseY);
    ctx.lineTo(point.x + r * 0.85, baseY);
    ctx.lineTo(point.x + r * 0.42, baseY - r * 1.5);
    ctx.lineTo(point.x - r * 0.42, baseY - r * 1.5);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.arc(point.x, baseY - r * 1.6, r * 0.5, 0, TAU);
    ctx.fill();
    if (!facesAway(index)) {
      ctx.fillStyle = '#d9e8ff';
      ctx.beginPath();
      ctx.arc(point.x + r * 0.14 * flip, baseY - r * 1.6, r * 0.12, 0, TAU);
      ctx.fill();
    }

    ctx.strokeStyle = '#6a4a2c';
    ctx.lineWidth = r * 0.12;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(point.x + r * 0.7 * flip, baseY);
    ctx.lineTo(point.x + r * 0.95 * flip, baseY - r * 1.9);
    ctx.stroke();
    ctx.fillStyle = '#9ad4ff';
    ctx.beginPath();
    ctx.arc(point.x + r * 0.97 * flip, baseY - r * 2.02, r * 0.24, 0, TAU);
    ctx.fill();
  }

  /** 重甲兵：宽躯干 + 肩甲 + 头盔（面甲一条橙缝）+ 大锤 */
  function drawBrute(ctx, point, monster, index, phase, color, dark) {
    var r = monster.radius;
    var flip = facesLeft(index) ? -1 : 1;
    var swing = Math.sin(phase * TAU) * r * 0.22;

    ctx.fillStyle = dark;
    ctx.fillRect(point.x - r * 0.5, point.y - r * 0.7, r * 0.36, r * 0.7 + swing * 0.3);
    ctx.fillRect(point.x + r * 0.14, point.y - r * 0.7, r * 0.36, r * 0.7 - swing * 0.3);

    ctx.fillStyle = color;
    roundRectPath(ctx, point.x - r * 0.78, point.y - r * 1.75, r * 1.56, r * 1.1, r * 0.24);
    ctx.fill();

    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.arc(point.x - r * 0.78, point.y - r * 1.6, r * 0.34, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(point.x + r * 0.78, point.y - r * 1.6, r * 0.34, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(point.x, point.y - r * 2.0, r * 0.44, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#20242c';
    ctx.fillRect(point.x - r * 0.42, point.y - r * 2.06, r * 0.84, r * 0.16);
    if (!facesAway(index)) {
      ctx.fillStyle = '#ff9b5a';
      ctx.fillRect(point.x - r * 0.26 + r * 0.14 * flip, point.y - r * 2.05, r * 0.16, r * 0.1);
    }

    ctx.strokeStyle = '#5a4630';
    ctx.lineWidth = r * 0.16;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(point.x + r * 0.9 * flip, point.y - r * 1.5 + swing);
    ctx.lineTo(point.x + r * 1.2 * flip, point.y - r * 0.5 + swing);
    ctx.stroke();
    ctx.fillStyle = '#8d939c';
    ctx.fillRect(point.x + r * 1.2 * flip - r * 0.25, point.y - r * 0.8 + swing, r * 0.5, r * 0.5);
  }

  /** 精英金冠：三个小尖角（离远了也能看出"这只是精英"） */
  function drawCrown(ctx, x, y, size) {
    ctx.fillStyle = '#ffd479';
    ctx.beginPath();
    ctx.moveTo(x - size, y + size * 0.7);
    ctx.lineTo(x - size, y);
    ctx.lineTo(x - size * 0.5, y + size * 0.5);
    ctx.lineTo(x, y - size * 0.15);
    ctx.lineTo(x + size * 0.5, y + size * 0.5);
    ctx.lineTo(x + size, y);
    ctx.lineTo(x + size, y + size * 0.7);
    ctx.closePath();
    ctx.fill();
  }

  /** 自动战斗的目标环（哪只在被打，一眼可见） */
  function drawTargetRing(ctx, camera, target) {
    if (!target) return;
    var point = toScreen(camera, target.x, target.y);
    ctx.strokeStyle = '#ff6b6b';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(point.x, point.y, target.radius + 12, 0, Math.PI * 2);
    ctx.stroke();
  }

  /**
   * 玩家：自绘小人（八方向朝向 + 走路摆腿摆臂 + 出手挥砍 + 受击闪红 + 倒地躺平）。
   * `stats` 只用来推出手间隔，好让"挥砍"跟得上真正的攻速；`nowMs` 缺省取逻辑时间。
   */
  function drawPlayer(ctx, camera, player, stats, nowMs) {
    var now = typeof nowMs === 'number' ? nowMs : G.WORLD.now();
    var point = toScreen(camera, player.x, player.y);
    var index = facingIndex(player.facing);
    var moving = player.moving === true && player.dead !== true;
    var interval = stats && stats.attackSpeed > 0 ? 1000 / stats.attackSpeed : 0;
    var swing = player.dead ? 1 : swingPhase(now, player.lastAttackAt, interval);
    var flashing = player.dead !== true && player.hurtUntil > 0 && now < player.hurtUntil;
    var palette = player.dead ? PLAYER_DOWN : flashing ? PLAYER_FLASH : PLAYER_PALETTE;

    // 打击范围（淡淡一圈，帮助理解为什么"差一点就打不到"）
    ctx.globalAlpha = 0.1;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(point.x, point.y, BAL.player.attackRange, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 1;

    drawShadow(ctx, point, BAL.player.radius, player.dead ? 0.2 : 0.3);

    ctx.save();
    if (player.dead) {
      // 倒地：整个人绕脚踝转 90°，再压暗一点
      ctx.globalAlpha = 0.55;
      ctx.translate(point.x, point.y);
      ctx.rotate(-Math.PI / 2);
      ctx.translate(-point.x, -point.y);
    }
    drawHumanoid(ctx, point, BAL.player.radius, index, walkPhase(now, moving), palette, swing);
    ctx.restore();
  }

  /**
   * 简单小人：腿 → 身体 → 腰带 → 手臂 → 头 → 武器。
   * 造型一律按"朝右"画，朝左时 flip = -1 镜像；朝上（背对镜头）不画脸。
   */
  function drawHumanoid(ctx, point, r, index, phase, palette, swing) {
    var flip = facesLeft(index) ? -1 : 1;
    var away = facesAway(index);
    var legSwing = Math.sin(phase * TAU) * r * 0.5;
    var bob = Math.abs(Math.sin(phase * TAU)) * r * 0.14;
    var baseY = point.y - bob;

    ctx.fillStyle = palette.boot;
    roundRectPath(ctx, point.x - r * 0.4 + legSwing * 0.5, baseY - r * 0.9, r * 0.34, r * 0.9, r * 0.17);
    ctx.fill();
    roundRectPath(ctx, point.x + r * 0.06 - legSwing * 0.5, baseY - r * 0.9, r * 0.34, r * 0.9, r * 0.17);
    ctx.fill();

    ctx.fillStyle = palette.tunic;
    roundRectPath(ctx, point.x - r * 0.5, baseY - r * 1.95, r, r * 1.15, r * 0.28);
    ctx.fill();
    ctx.fillStyle = palette.tunicDark;
    ctx.fillRect(point.x + (flip > 0 ? r * 0.14 : -r * 0.48), baseY - r * 1.92, r * 0.34, r * 1.08);
    ctx.fillStyle = palette.belt;
    ctx.fillRect(point.x - r * 0.5, baseY - r * 1.0, r, r * 0.16);

    // 空着的那只手（与腿反向摆）
    ctx.fillStyle = palette.tunicDark;
    roundRectPath(ctx, point.x - r * 0.8 - legSwing * 0.5, baseY - r * 1.9, r * 0.3, r * 0.95, r * 0.15);
    ctx.fill();

    // 持剑手：位置固定，出手靠手腕旋转表现
    var handX = point.x + r * 0.66 * flip;
    var handY = baseY - r * 1.5;
    ctx.fillStyle = palette.skin;
    roundRectPath(ctx, handX - r * 0.15, handY - r * 0.1, r * 0.3, r * 0.85, r * 0.15);
    ctx.fill();
    drawWeapon(ctx, handX, handY, r, flip, -ACTOR_STYLE.swingArc * 0.55 + (1 - swing) * ACTOR_STYLE.swingArc, palette);

    var headY = baseY - r * 2.45;
    ctx.fillStyle = palette.skin;
    ctx.beginPath();
    ctx.arc(point.x + r * 0.06 * flip, headY, r * 0.5, 0, TAU);
    ctx.fill();
    ctx.fillStyle = palette.hair;
    ctx.beginPath();
    if (away) {
      // 背对镜头：整颗头都是头发（一眼看出"我在往上走"）
      ctx.arc(point.x, headY, r * 0.5, 0, TAU);
    } else {
      ctx.arc(point.x + r * 0.06 * flip, headY - r * 0.1, r * 0.5, Math.PI * 1.02, Math.PI * 2 - 0.02);
    }
    ctx.fill();
    if (!away) {
      ctx.fillStyle = '#20242c';
      ctx.beginPath();
      ctx.arc(point.x + r * 0.3 * flip, headY + r * 0.06, r * 0.09, 0, TAU);
      ctx.fill();
    }
  }

  /** 武器：一把短剑，绕手旋转（出手瞬间扫到最前，然后收回肩上） */
  function drawWeapon(ctx, handX, handY, r, flip, angle, palette) {
    var length = r * 1.5;
    var dx = Math.cos(angle) * length * flip;
    var dy = Math.sin(angle) * length;
    ctx.lineCap = 'round';
    ctx.strokeStyle = palette.weapon;
    ctx.lineWidth = r * 0.18;
    ctx.beginPath();
    ctx.moveTo(handX, handY);
    ctx.lineTo(handX + dx, handY + dy);
    ctx.stroke();
    ctx.strokeStyle = palette.guard;
    ctx.lineWidth = r * 0.16;
    ctx.beginPath();
    ctx.moveTo(handX - dy * 0.18, handY + dx * 0.18);
    ctx.lineTo(handX + dy * 0.18, handY - dx * 0.18);
    ctx.stroke();
  }

  /**
   * 左上角头像（HUD 用）：程序自绘的圆脸 + 护额。
   * `seed` 决定肤色/发色（纯整数取模，不占任何随机流，所以同一角色永远同一张脸）。
   */
  function drawAvatar(ctx, cx, cy, r, seed) {
    var hash = typeof seed === 'number' && isFinite(seed) ? Math.abs(Math.floor(seed)) : 0;
    var skins = ['#f0c9a0', '#e6b891', '#f7d9b6'];
    var hairs = ['#3a2b22', '#5b3a2f', '#26323f'];
    var skin = skins[hash % skins.length];
    var hair = hairs[(hash >>> 3) % hairs.length];

    ctx.fillStyle = '#1b2438';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#4d5f86';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.stroke();

    // 肩膀（上半圆，fill 会自动收口成弓形）
    ctx.fillStyle = '#2f4a6b';
    ctx.beginPath();
    ctx.arc(cx, cy + r * 1.02, r * 0.74, Math.PI, TAU);
    ctx.fill();

    // 脸
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(cx, cy + r * 0.02, r * 0.46, 0, TAU);
    ctx.fill();

    // 头发（上半圆压住额头）
    ctx.fillStyle = hair;
    ctx.beginPath();
    ctx.arc(cx, cy - r * 0.1, r * 0.48, Math.PI, TAU);
    ctx.fill();

    // 护额（一条横带：和主角的红色围巾呼应）
    ctx.fillStyle = '#c94f4f';
    ctx.fillRect(cx - r * 0.48, cy - r * 0.26, r * 0.96, r * 0.18);

    // 眼睛
    ctx.fillStyle = '#20242c';
    ctx.beginPath();
    ctx.arc(cx - r * 0.17, cy + r * 0.1, r * 0.075, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + r * 0.17, cy + r * 0.1, r * 0.075, 0, TAU);
    ctx.fill();
  }

  /**
   * 头顶名牌：角色名 + 血条（用户要求"玩家头顶添加角色名 + 血条"）。
   * 精英怪也复用同一份画法，所以参数是一个 info 对象而不是玩家对象：
   *   { x, y, radius, name, level, hp, hpMax, dead, color }
   * 血条宽度/高度/抬升量都在 `balance.view.nameplate`（一处数字，客户端与服务端将来共用）。
   */
  function drawNameplate(ctx, camera, info) {
    if (!info || !info.name) return;
    var point = toScreen(camera, info.x, info.y);
    var lift = (info.radius || 24) * 2.6 + BAL.view.nameplate.offsetY;
    var barW = info.barWidth || BAL.view.nameplate.barWidth;
    var barH = BAL.view.nameplate.barHeight;
    var barY = point.y - lift;
    var ratio = info.hpMax > 0 ? info.hp / info.hpMax : 0;
    if (!(ratio >= 0)) ratio = 0;
    if (ratio > 1) ratio = 1;

    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // 先描一圈深色再填字：亮色名字压在草地/石砖上也看得清
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.strokeText(info.name, point.x, barY - 16);
    ctx.fillStyle = info.dead ? '#c9c9c9' : info.color || '#ffffff';
    ctx.fillText(info.name, point.x, barY - 16);

    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(point.x - barW / 2 - 1, barY - 1, barW + 2, barH + 2);
    ctx.fillStyle = info.dead ? '#6b6b6b' : '#4fd06a';
    ctx.fillRect(point.x - barW / 2, barY, barW * ratio, barH);
  }

  /**
   * 斩击特效（A4 打击感）：一道随时间扫过去的弧，暴击再加四道向外飞的光刺。
   * 只用 moveTo/arc/lineTo/stroke —— 冒烟的假 canvas 认这些图元，所以"特效画不出来"也能被抓到。
   * 角度由效果自带的 dirX/dirY 现算（atan2 只在这里出现，生成层依旧没有任何三角函数）。
   */
  function drawEffects(ctx, camera, effects, nowMs) {
    var now = typeof nowMs === 'number' ? nowMs : G.WORLD.now();
    var list = effects || [];
    for (var i = 0; i < list.length; i += 1) {
      var effect = list[i];
      var life = (effect.until - now) / BAL.view.slashMs;
      if (!(life >= 0)) life = 0;
      if (life > 1) life = 1;
      if (life <= 0) continue;

      var point = toScreen(camera, effect.x, effect.y);
      var played = 1 - life;
      var angle = Math.atan2(effect.dirY, effect.dirX);
      var radius = effect.radius * (0.85 + 0.4 * played);
      var from = angle - 1.15 + played * 1.35;

      ctx.globalAlpha = life * (effect.crit ? 0.95 : 0.7);
      ctx.strokeStyle = effect.crit ? '#ffd479' : '#ffffff';
      ctx.lineWidth = effect.crit ? 10 : 6;
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, from, from + 1.5);
      ctx.stroke();

      // 内圈细刃：让弧看起来是"一把刀扫过去"，而不是一个圆圈
      ctx.globalAlpha = ctx.globalAlpha * 0.55;
      ctx.lineWidth = effect.crit ? 5 : 3;
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius * 0.74, from + 0.18, from + 1.24);
      ctx.stroke();

      if (effect.crit) {
        // 暴击：四道向外飞的光刺（角度是固定偏置，纯几何 —— 不占任何随机流）
        ctx.globalAlpha = life * 0.9;
        ctx.lineWidth = 4;
        ctx.beginPath();
        for (var k = 0; k < 4; k += 1) {
          var ray = angle - 0.6 + k * 0.42;
          var inner = radius * 0.9;
          var outer = inner + 26 * (0.5 + played);
          ctx.moveTo(point.x + Math.cos(ray) * inner, point.y + Math.sin(ray) * inner);
          ctx.lineTo(point.x + Math.cos(ray) * outer, point.y + Math.sin(ray) * outer);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }

  /** 远程弹道：一个小亮点沿直线飞 */
  function drawProjectiles(ctx, camera, shots) {
    ctx.fillStyle = '#9ad4ff';
    for (var i = 0; i < shots.length; i += 1) {
      var point = toScreen(camera, shots[i].x, shots[i].y);
      ctx.beginPath();
      ctx.arc(point.x, point.y, 7, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** 伤害飘字：向上飘 + 渐隐；暴击更大更黄 */
  function drawDamageNumbers(ctx, camera, numbers, nowMs) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (var i = 0; i < numbers.length; i += 1) {
      var number = numbers[i];
      var life = (number.until - nowMs) / BAL.view.damageNumberMs;
      if (life < 0) life = 0;
      var point = toScreen(camera, number.x, number.y);
      ctx.globalAlpha = life > 1 ? 1 : life;
      ctx.fillStyle = number.color;
      ctx.font = (number.crit ? 'bold 30px' : '24px') + ' sans-serif';
      ctx.fillText(number.text, point.x, point.y - (1 - life) * 42);
    }
    ctx.globalAlpha = 1;
  }

  return {
    MONSTER_COLORS: MONSTER_COLORS,
    MONSTER_DARK: MONSTER_DARK,
    PLAYER_PALETTE: PLAYER_PALETTE,
    ACTOR_STYLE: ACTOR_STYLE,
    DECOR_STYLE: DECOR_STYLE,
    roundRectPath: roundRectPath,
    ellipsePath: ellipsePath,
    toScreen: toScreen,
    viewRect: viewRect,
    facingIndex: facingIndex,
    facesLeft: facesLeft,
    facesAway: facesAway,
    walkPhase: walkPhase,
    swingPhase: swingPhase,
    drawGround: drawGround,
    drawRoads: drawRoads,
    drawCamp: drawCamp,
    drawDecor: drawDecor,
    drawLandmarks: drawLandmarks,
    drawMonsters: drawMonsters,
    drawTargetRing: drawTargetRing,
    drawPlayer: drawPlayer,
    drawAvatar: drawAvatar,
    drawNameplate: drawNameplate,
    drawEffects: drawEffects,
    drawProjectiles: drawProjectiles,
    drawDamageNumbers: drawDamageNumbers
  };
})();

/**
 * 17-hud.js —— 吸顶 / 吸底 HUD（竖屏单手布局，01-game-design §2）
 *
 * 布局纪律：所有 y 坐标都由 `SCREEN.safeTop()` / `SCREEN.safeBottom()` 推出来，
 * 不写死数字 —— 长屏、刘海屏、手势条都能自动躲开。
 *
 * 画的东西（A4 重排）：
 *   吸顶左：**头像 + 角色名 + 等级**（用户要求"左上角添加玩家头像，角色名，等级"）
 *   吸顶中：玩家血条 + 金币 / 战力 / 难度带 / 自动战斗状态
 *   吸顶右：**小地图**（chunk 网格 + 小径 + 营地 + 地标 + 怪 + 公会锚点 + 玩家朝向）
 *   吸底：**经验条**（用户要求"画面最下方添加经验条"）
 *   吸底右侧：五个圆形功能键「自动 / 箱 / 包 / 会 / 设」（带角标；自动是开关）
 *   左下：摇杆由 15-input 自己画
 *   调试面板（可选）：FPS / chunk 数 / 活跃怪数 / 当前目标 / 世界种子 / 世界指纹
 *
 * 两个"必须记住"的点：
 *   1. **功能键与面板卡片互不遮挡**：卡片右侧留了 `view.panel.rightReserve` 的位置，
 *      按钮整体抬升 `view.hud.buttonLift` 给经验条让位（见 18-panels 的卡片几何）；
 *   2. 按钮的坐标就是命中测试的坐标（15-input 只认这一份），所以画法与判定不会各算一套。
 */

G.HUD = (function () {
  'use strict';

  var BAL = G.BAL;
  var SCREEN = G.SCREEN;
  var PROG = G.PROG;
  var EQUIP = G.EQUIP;

  /** 小工具：画一行字 */
  function text(ctx, value, x, y, size, color, align) {
    ctx.font = size + 'px sans-serif';
    ctx.fillStyle = color;
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(value, x, y);
  }

  /** 进度条（底 + 前景），ratio 会被夹到 0..1 */
  function bar(ctx, x, y, w, h, ratio, color, back) {
    if (!(ratio >= 0)) ratio = 0;
    if (ratio > 1) ratio = 1;
    ctx.fillStyle = back || 'rgba(0,0,0,0.55)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w * ratio, h);
  }

  /** 吸顶区高度（头像那一块）：小地图与调试面板都从它往下排 */
  function plateHeight() {
    return SCREEN.safeTop() + 152;
  }

  /** 小地图左上角 y：吸顶条下面一点点，右侧留 margin */
  function minimapTop() {
    return SCREEN.safeTop() + 128;
  }

  /** 右侧留白（小地图 + 边距）：血条这类"横向要尽量宽"的元素别压到小地图上 */
  function rightReserve() {
    return BAL.view.minimap.size + BAL.view.minimap.margin * 2;
  }

  /**
   * 右下功能键：**自动 / 箱 / 包 / 会 / 设**（从下往上排，最常用/最需要拇指的排最低）。
   * `badge` 是右上角的小角标（宝箱数 / 背包装备数 / 有没有公会）；
   * `state` 只服务画法（'on' 时按钮点亮），命中测试与它无关。
   */
  function buttons(view) {
    var radius = 46;
    var gap = 18;
    var lift = BAL.view.hud.buttonLift;
    var x = SCREEN.width() - BAL.input.attackButtonMargin - radius;
    var y = SCREEN.height() - SCREEN.safeBottom() - lift - radius;
    var save = view && view.save ? view.save : null;
    var auto = !!(save && save.settings && save.settings.autoBattle === true);
    var defs = [
      { id: 'chest', label: '箱', badge: save ? save.chests.length : 0 },
      { id: 'bag', label: '包', badge: save ? save.items.length : 0 },
      { id: 'guild', label: '会', badge: save && save.guild ? 1 : 0 },
      { id: 'menu', label: '设', badge: 0 },
      { id: 'auto', label: auto ? '自动' : '手动', badge: 0, state: auto ? 'on' : 'off' }
    ];
    var list = [];
    for (var i = 0; i < defs.length; i += 1) {
      list.push({
        id: defs[i].id,
        label: defs[i].label,
        badge: defs[i].badge || 0,
        state: defs[i].state || '',
        x: x,
        y: y - i * (radius * 2 + gap),
        r: radius
      });
    }
    return list;
  }

  /** 画按钮（按下时稍微放大 + 变色；自动战斗开着时按钮常亮，一眼看出当前模式） */
  function drawButtons(ctx, view) {
    var list = view && view.buttons ? view.buttons : [];
    var nowMs = view && view.now ? view.now : 0;
    for (var i = 0; i < list.length; i += 1) {
      var button = list[i];
      var pressed = G.INPUT.isPressed(button.id, nowMs);
      var lit = button.state === 'on' || pressed;
      ctx.globalAlpha = pressed ? 0.95 : lit ? 0.88 : 0.72;
      ctx.fillStyle = pressed ? '#ffd479' : lit ? '#2f6b46' : '#1b2438';
      ctx.beginPath();
      ctx.arc(button.x, button.y, button.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = pressed ? '#fff3d0' : lit ? '#8ce99a' : '#4d5f86';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(button.x, button.y, button.r, 0, Math.PI * 2);
      ctx.stroke();

      text(ctx, button.label, button.x, button.y, 30, pressed ? '#241a05' : '#dce6ff', 'center');

      if (button.badge > 0) {
        ctx.fillStyle = '#ff6b6b';
        ctx.beginPath();
        ctx.arc(button.x + button.r * 0.72, button.y - button.r * 0.72, 20, 0, Math.PI * 2);
        ctx.fill();
        text(ctx, button.badge > 99 ? '99+' : String(button.badge), button.x + button.r * 0.72, button.y - button.r * 0.72, 20, '#ffffff', 'center');
      }
    }
  }

  /** 调试面板：人眼验收也要有据可依（04-decisions #7 的第三道关） */
  function drawDebug(ctx, view) {
    var lines = [
      'FPS ' + view.fps + '（逻辑 60Hz 固定步长）',
      'chunk 已装载 ' + view.chunks + ' / 上限 ' + BAL.view.chunkCacheLimit + '  活跃怪 ' + view.activeMonsters,
      '目标 ' + (view.target ? view.target.name + ' Lv.' + view.target.level + ' HP ' + Math.round(view.target.hp) : '无'),
      '坐标 ' + Math.round(view.player.x) + ', ' + Math.round(view.player.y) + '  难度带 ' + G.CHUNK.bandOf(view.player.x, view.player.y),
      '怪物击杀 ' + view.save.stats.kills + '（精英 ' + view.save.stats.eliteKills + '）开箱 ' + view.save.stats.opened,
      '世界种子 ' + BAL.season.worldSeed + '  指纹 ' + (view.fingerprint || '—'),
      '触摸 ' + (G.PLAT.hasTt() ? 'tt' : '桩') + '  存档 ' + (view.saveOk ? '正常' : '未写入')
    ];
    var top = minimapTop() + BAL.view.minimap.size + 26;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(12, top - 12, SCREEN.width() - 24, lines.length * 30 + 24);
    for (var i = 0; i < lines.length; i += 1) {
      text(ctx, lines[i], 24, top + i * 30, 20, '#bfe0ff');
    }
  }

  /**
   * 小地图（右上角）：附近 chunk 网格 + 小径路网 + 营地 + 地标 + 怪点 + 公会锚点 + 玩家朝向。
   * 它是"地图设计"的呈现层 —— 玩家要能一眼看出"我在哪、路往哪边走、还有什么没去过"。
   * 路网用的是**和小地图外面同一份数据**（G.TERRAIN.roadsInRect），不另画一套。
   */
  function drawMinimap(ctx, view) {
    var config = BAL.view.minimap;
    var size = config.size;
    var left = SCREEN.width() - size - config.margin;
    var top = minimapTop();
    var player = view.player;
    var halfWorld = config.chunkRadius * G.CHUNK.CHUNK_SIZE;
    var scale = size / (halfWorld * 2);
    var centerX = left + size / 2;
    var centerY = top + size / 2;
    var i;
    var point;

    function toMap(x, y) {
      return { x: centerX + (x - player.x) * scale, y: centerY + (y - player.y) * scale };
    }
    function insideMap(p) {
      return p.x >= left && p.x <= left + size && p.y >= top && p.y <= top + size;
    }

    ctx.save();
    ctx.globalAlpha = 0.62;
    ctx.fillStyle = '#101828';
    ctx.fillRect(left, top, size, size);
    ctx.globalAlpha = 1;

    // chunk 网格：按世界坐标对齐，跨 chunk 时格子不会"跟着玩家漂"
    ctx.strokeStyle = '#2c3a55';
    ctx.lineWidth = 1;
    ctx.beginPath();
    var firstX = Math.ceil((player.x - halfWorld) / G.CHUNK.CHUNK_SIZE) * G.CHUNK.CHUNK_SIZE;
    for (var gx = firstX; gx <= player.x + halfWorld; gx += G.CHUNK.CHUNK_SIZE) {
      var lineX = toMap(gx, player.y).x;
      ctx.moveTo(lineX, top);
      ctx.lineTo(lineX, top + size);
    }
    var firstY = Math.ceil((player.y - halfWorld) / G.CHUNK.CHUNK_SIZE) * G.CHUNK.CHUNK_SIZE;
    for (var gy = firstY; gy <= player.y + halfWorld; gy += G.CHUNK.CHUNK_SIZE) {
      var lineY = toMap(player.x, gy).y;
      ctx.moveTo(left, lineY);
      ctx.lineTo(left + size, lineY);
    }
    ctx.stroke();

    // 小径
    var segments = G.TERRAIN.roadsInRect(
      BAL.season.worldSeed,
      player.x - halfWorld,
      player.y - halfWorld,
      player.x + halfWorld,
      player.y + halfWorld
    );
    ctx.strokeStyle = '#8a7457';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (i = 0; i < segments.length; i += 1) {
      var a = toMap(segments[i].x1, segments[i].y1);
      var b = toMap(segments[i].x2, segments[i].y2);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();

    // 营地（原点）
    point = toMap(0, 0);
    if (insideMap(point)) {
      ctx.fillStyle = '#c9b08a';
      ctx.beginPath();
      ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    // 地标
    var landmarks = G.WORLD.landmarksInView();
    ctx.fillStyle = '#9ad4ff';
    for (i = 0; i < landmarks.length; i += 1) {
      point = toMap(landmarks[i].x, landmarks[i].y);
      if (!insideMap(point)) continue;
      ctx.fillRect(point.x - 2.5, point.y - 2.5, 5, 5);
    }

    // 怪（精英画大一点、金色）
    var monsters = G.WORLD.monstersInView();
    for (i = 0; i < monsters.length; i += 1) {
      point = toMap(monsters[i].x, monsters[i].y);
      if (!insideMap(point)) continue;
      ctx.fillStyle = monsters[i].elite ? '#ffd479' : '#ff8a8a';
      ctx.beginPath();
      ctx.arc(point.x, point.y, monsters[i].elite ? 3.4 : 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // 公会锚点（有公会才有）
    if (view.save && view.save.guild && view.save.guild.anchor) {
      point = toMap(view.save.guild.anchor.x, view.save.guild.anchor.y);
      if (insideMap(point)) {
        ctx.fillStyle = '#a9d5ff';
        ctx.beginPath();
        ctx.moveTo(point.x, point.y - 5);
        ctx.lineTo(point.x + 5, point.y);
        ctx.lineTo(point.x, point.y + 5);
        ctx.lineTo(point.x - 5, point.y);
        ctx.closePath();
        ctx.fill();
      }
    }

    // 玩家：一个朝向三角（朝向直接取 player.facing，不另算一套）
    var fx = player.facing.x;
    var fy = player.facing.y;
    var length = Math.sqrt(fx * fx + fy * fy);
    if (!(length > 0.0001)) {
      fx = 0;
      fy = 1;
      length = 1;
    }
    fx /= length;
    fy /= length;
    ctx.fillStyle = '#ffd479';
    ctx.beginPath();
    ctx.moveTo(centerX + fx * 9, centerY + fy * 9);
    ctx.lineTo(centerX - fx * 5 - fy * 5, centerY - fy * 5 + fx * 5);
    ctx.lineTo(centerX - fx * 5 + fy * 5, centerY - fy * 5 - fx * 5);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = '#4d5f86';
    ctx.lineWidth = 3;
    ctx.strokeRect(left, top, size, size);
    ctx.restore();
  }

  /**
   * 吸顶块：头像 + 角色名 + 等级 + 血条 + 一行状态。
   * 文字区宽度按 `rightReserve()` 扣掉右侧小地图，所以名字再长也撞不到地图。
   */
  function drawTop(ctx, view) {
    var width = SCREEN.width();
    var top = SCREEN.safeTop();
    var save = view.save;
    var stats = view.stats;
    var radius = BAL.view.hud.avatarRadius;
    var textLeft = 24 + radius * 2 + 18;
    var reserve = rightReserve();

    ctx.fillStyle = 'rgba(8,12,24,0.62)';
    ctx.fillRect(0, 0, width, plateHeight());

    // 头像（程序自绘；种子只跟角色名与等级有关 → 同一角色永远同一张脸）
    G.RENDER.drawAvatar(
      ctx,
      24 + radius,
      top + 46,
      radius,
      G.RNG.hash32(G.ACCOUNT.nameKey(save.name).length * 31, save.level | 0, 0x51a7c3)
    );

    // 角色名 + 等级
    text(ctx, save.name || '无名者', textLeft, top + 28, 32, '#ffffff');
    text(ctx, 'Lv.' + save.level, textLeft, top + 64, 26, '#ffd479');
    text(ctx, PROG.bandLabel(G.CHUNK.bandOf(view.player.x, view.player.y)), width - reserve, top + 64, 22, '#9fb4d8', 'right');

    // 血条（战斗反馈第一优先级）
    var hpRatio = stats.hpMax > 0 ? view.player.hp / stats.hpMax : 0;
    var barW = width - 48 - reserve;
    bar(ctx, 24, top + 92, barW, 24, hpRatio, view.player.dead ? '#6b6b6b' : '#e05c5c');
    text(
      ctx,
      (view.player.dead ? '复活中… ' : '生命 ') + Math.max(0, Math.round(view.player.hp)) + ' / ' + stats.hpMax,
      34,
      top + 104,
      18,
      '#ffecec'
    );

    // 第三行：金币 / 战力 / 自动战斗状态（一眼看出现在是手动还是自动）
    var auto = !!(save.settings && save.settings.autoBattle === true);
    text(
      ctx,
      '金币 ' + PROG.shortNumber(save.gold) + ' · 战力 ' + stats.power + ' · 自动战斗 ' + (auto ? '开' : '关'),
      24,
      top + 134,
      22,
      auto ? '#8ce99a' : '#f2e6c8'
    );
  }

  /** 吸底经验条：用户要求"画面最下方添加经验条"，所以它贴在最底（避开手势条） */
  function drawExpBar(ctx, view) {
    var save = view.save;
    var width = SCREEN.width();
    var height = BAL.view.hud.expBarHeight;
    var y = SCREEN.height() - SCREEN.safeBottom() - height;
    var need = PROG.xpToNext(save.level);
    bar(ctx, 0, y, width, height, need > 0 ? save.exp / need : 0, '#4f8fd8', 'rgba(8,12,24,0.72)');
    text(
      ctx,
      'Lv.' + save.level + ' 经验 ' + PROG.shortNumber(save.exp) + ' / ' + PROG.shortNumber(need),
      28,
      y + height / 2,
      16,
      '#e8f1ff',
      'left'
    );
  }

  /**
   * 主绘制：view 由 20-main 组装（玩家、属性、存档、FPS、目标…）。
   * **功能键不在这里画**（交给 `drawButtons`）：面板卡片只占 1/3 屏，
   * 按钮要压在卡片之上继续可用，所以 20-main 的绘制顺序是 HUD → 面板 → 按钮。
   */
  function draw(ctx, view) {
    drawTop(ctx, view);
    drawExpBar(ctx, view);

    // 升级/掉落等闪光提示（压在吸顶块下面，不挤血条）
    if (view.flash && view.flash.until > view.now) {
      text(ctx, view.flash.text, SCREEN.centerX(), plateHeight() + 46, 38, '#ffe08a', 'center');
    }

    drawMinimap(ctx, view);
    if (view.debug) drawDebug(ctx, view);
  }

  return {
    buttons: buttons,
    draw: draw,
    drawTop: drawTop,
    drawExpBar: drawExpBar,
    drawButtons: drawButtons,
    drawMinimap: drawMinimap,
    plateHeight: plateHeight,
    minimapTop: minimapTop,
    bar: bar,
    text: text
  };
})();

/**
 * 18-panels.js —— 自绘面板（开箱 / 背包 / 商城 / 公会 / 设置 / 自检）+ 标题与创建角色界面
 *
 * 小游戏没有 DOM，所以界面也是 canvas 画的（01-game-design §2 的最后一条）。
 *
 * **A4 的三处改动（都是用户直接提的需求）**：
 *   1. **只占约 1/3 屏**：面板从"全屏覆盖"改成一张卡片
 *      （宽 = 屏宽 − leftMargin − rightReserve，高 = 屏高 × heightRatio，见 balance.view.panel）；
 *   2. **打开面板时游戏不停止**：卡片之外的触摸照旧给 15-input（摇杆能推、功能键能按），
 *      世界也照旧跑（20-main 的 step 不再因为面板开着而 return）；
 *   3. **关闭按钮**：卡片右上角一个圆形 ✕；面板内容比卡片长时，在卡片内上下拖动可以滚。
 *
 * 卡片内的行是矩形（可点），卡片右上角的关闭键是圆的 —— 沿用"圆形 = 即时操作，矩形 = 菜单"的分工。
 *
 * 与输入层的关系：面板自己吃触摸（press / move / release 返回一个 action），
 * 20-main 负责执行 action —— 面板不直接改存档，这样以后把这些操作搬到服务端校验时，
 * 只需要换掉执行者，界面一行都不用改。
 *
 * action 清单（都由 20-main 处理）：
 *   { type: 'close' }              关掉当前面板（✕）
 *   { type: 'open', panel }        切换面板（'chest' | 'bag' | 'shop' | 'guild' | 'menu' | 'selftest'）
 *   { type: 'openChest', count }   开箱（真正的抽奖在 20-main：那里才动保底计数）
 *   { type: 'equip', itemId }      穿上背包里的某件装备
 *   { type: 'salvageAll' }         一键分解（只留比身上强的）
 *   { type: 'buyHorn' }            买号角（500 金币，20 级解锁）
 *   { type: 'createGuild' }        建公会（消耗一个号角）
 *   { type: 'renameGuild' }        换一个随机会名（canvas 里没有输入框）
 *   { type: 'teleportGuild' }      回到公会锚点（冷却 + 战斗中禁用）
 *   { type: 'selftest' }  { type: 'cloudPing' }  { type: 'toggleDebug' }  { type: 'resetSave' }
 */

G.PANELS = (function () {
  'use strict';

  var BAL = G.BAL;
  var SCREEN = G.SCREEN;
  var EQUIP = G.EQUIP;
  var LOOT = G.LOOT;
  var PROG = G.PROG;

  var current = null;
  var pressedRowId = null;

  /** 滚动与拖动状态：`scroll` 是内容相对视口向下滚过的距离（只增不减的纯数字，能断言） */
  var scroll = 0;
  var pressY = 0;
  var pressScroll = 0;
  var dragging = false;
  var pressedClose = false;

  /** 随机会名用的词（canvas 里没有输入框，用"换一个"代替打字；阶段 D 再接平台键盘） */
  var GUILD_A = ['铁血', '荒野', '星火', '长风', '夜航', '荒原', '钢齿', '灰烬'];
  var GUILD_B = ['兄弟会', '远征团', '守望者', '拾荒团', '游猎帮', '商队', '联盟'];

  var draftGuildName = '';

  /** 用世界时间做种子生成会名（本工程只允许 G.RNG 出随机，不许 Math.random） */
  function nextGuildName(salt) {
    var rng = new G.RNG.Rng(G.RNG.hash32((G.WORLD.now() | 0) + (salt | 0), 0x6d17, 0x3c1f));
    var a = GUILD_A[rng.int(0, GUILD_A.length - 1)];
    var b = GUILD_B[rng.int(0, GUILD_B.length - 1)];
    return a + b;
  }

  /* ------------------------------------------------------------- 卡片几何 */

  /**
   * 面板卡片：**只占约 1/3 屏**（用户要求"ui 不要铺满屏幕，只要占三分之一大小"）。
   *   width  = 屏宽 − leftMargin − rightReserve （右边留给右下功能键，互不遮挡）
   *   height = 屏高 × heightRatio
   *   位置   = 左贴 margin、上边贴在吸顶块下方（下半屏留给摇杆与拇指）
   * 0.79 × 0.38 ≈ 30% 屏面积。所有数字都在 balance.view.panel，改数值不用改代码。
   */
  function rect() {
    var config = BAL.view.panel;
    var width = SCREEN.width() - config.leftMargin - config.rightReserve;
    var height = SCREEN.height() * config.heightRatio;
    return { x: config.leftMargin, y: G.HUD.plateHeight() + 18, w: width, h: height };
  }

  /** 内容视口：卡片去掉标题栏之后的那块（行只在这里面绘制与命中） */
  function viewport() {
    var card = rect();
    var headerHeight = BAL.view.panel.headerHeight;
    return { x: card.x, y: card.y + headerHeight, w: card.w, h: card.h - headerHeight };
  }

  /** 行的起始 y（第一行的左上角） */
  function contentTop() {
    return viewport().y + 8;
  }

  /** 卡片右上角的关闭键（用户要求"添加关闭按钮"）：面板里唯一的圆形按钮 */
  function closeButton() {
    var card = rect();
    var radius = 26;
    return {
      id: 'panel:close',
      label: 'X',
      badge: 0,
      x: card.x + card.w - radius - 12,
      y: card.y + BAL.view.panel.headerHeight / 2,
      r: radius
    };
  }

  /** 卡片内可点行的最大滚动距离（内容比视口短就是 0 —— 短面板不该能拖动） */
  function maxScroll(view) {
    var built = buildRows(view);
    if (!built.length) return 0;
    var last = built[built.length - 1];
    var limit = last.y + last.h - (viewport().y + viewport().h);
    return limit > 0 ? limit : 0;
  }

  /** 设置滚动位置（自动夹到 [0, maxScroll]） */
  function setScroll(value, view) {
    var limit = maxScroll(view);
    if (!(value > 0)) value = 0;
    if (value > limit) value = limit;
    scroll = value;
    return scroll;
  }

  function scrollOffset() {
    return scroll;
  }

  /** 这一点在不在面板的"势力范围"里（卡片矩形 + 关闭键的圆）：不在就交给摇杆/功能键 */
  function contains(point) {
    if (!current || !point) return false;
    var button = closeButton();
    var dx = point.x - button.x;
    var dy = point.y - button.y;
    var reach = button.r + 12;
    if (dx * dx + dy * dy <= reach * reach) return true;
    var card = rect();
    return point.x >= card.x && point.x <= card.x + card.w && point.y >= card.y && point.y <= card.y + card.h;
  }

  function open(panel) {
    current = panel;
    pressedRowId = null;
    scroll = 0;
    dragging = false;
    pressedClose = false;
    if (panel === 'guild' && !draftGuildName) draftGuildName = nextGuildName(0);
  }

  function close() {
    current = null;
    pressedRowId = null;
    scroll = 0;
    dragging = false;
    pressedClose = false;
  }

  function isOpen() {
    return current !== null;
  }

  function panelId() {
    return current;
  }

  function tierColor(tier) {
    var colors = ['#c7c7c7', '#8ce99a', '#a9d5ff', '#d0a9ff', '#ff9b5a', '#ffd479'];
    return colors[tier - 1] || '#c7c7c7';
  }

  /** 面板里唯一的圆按钮：卡片右上角的关闭键。返回数组是为了和 HUD 的按钮同构 */
  function buttons() {
    if (!current) return [];
    return [closeButton()];
  }

  /**
   * 行布局（未加滚动偏移）：从卡片内容的顶部开始，每行高 = `balance.view.panel.rowHeight`。
   * 行高固定是有原因的：命中测试与滚动夹取都只要一次乘加，不用测量文本。
   * 行内两行字：主行 y+22（26px）、副行 y+44（18px）—— 加起来正好落在 62 的行带里。
   * 返回 [{ id, y, h, text, sub, color, action }]
   */
  function buildRows(view) {
    var list = [];
    if (!current) return list;
    var top = contentTop();
    var rowH = BAL.view.panel.rowHeight;
    var i;

    if (current === 'chest') {
      list.push({
        id: 'chest:open1',
        y: top,
        h: rowH,
        text: '开 1 个宝箱',
        sub: '保底计数：史诗 ' + view.save.pity.epic + '/' + BAL.chests.pity.epic + ' · 神话 ' + view.save.pity.mythic + '/' + BAL.chests.pity.mythic,
        color: '#ffd479',
        action: { type: 'openChest', count: 1 }
      });
      list.push({
        id: 'chest:open10',
        y: top + rowH,
        h: rowH,
        text: '开 10 个宝箱',
        sub: '背包 ' + view.save.chests.length + ' / ' + BAL.chests.bagCap + '（满了自动分解成金币）',
        color: '#ffd479',
        action: { type: 'openChest', count: 10 }
      });
      top += rowH * 2 + 24;
      for (i = 0; i < view.save.chests.length && i < 8; i += 1) {
        var chest = view.save.chests[i];
        list.push({
          id: 'chest:bag:' + i,
          y: top + i * 62,
          h: 62,
          text: LOOT.tierName(chest.tier) + '（掉落等级 ' + chest.level + '）',
          sub: '',
          color: tierColor(chest.tier),
          action: { type: 'openChest', count: 1 }
        });
      }
      if (view.save.chests.length === 0) {
        list.push({ id: 'chest:empty', y: top, h: 62, text: '还没有宝箱', sub: '去打怪：普通怪约 8% 掉箱，精英 25%', color: '#c7c7c7', action: null });
      }
      return list;
    }

    if (current === 'bag') {
      list.push({
        id: 'bag:salvageAll',
        y: top,
        h: rowH,
        text: '一键分解（每件都留最强的）',
        sub: '换金币 · 背包 ' + view.save.items.length + ' 件',
        color: '#ffd479',
        action: { type: 'salvageAll' }
      });
      top += rowH + 24;
      for (i = 0; i < view.save.items.length && i < 9; i += 1) {
        var item = view.save.items[i];
        var worn = view.save.loadout[item.slotId];
        var better = !worn || item.power > worn.power;
        list.push({
          id: 'bag:item:' + item.id,
          y: top + i * 62,
          h: 62,
          text: EQUIP.tierById(item.tier).name + ' ' + item.slotName + '（战力 ' + item.power + '）',
          sub: (better ? '↑ 更强' : '↓ 更弱') + ' · 需求 Lv.' + item.reqLevel + ' · 点一下穿上',
          color: better ? '#8ce99a' : '#c7c7c7',
          action: { type: 'equip', itemId: item.id }
        });
      }
      if (view.save.items.length === 0) {
        list.push({ id: 'bag:empty', y: top, h: 62, text: '背包是空的', sub: '开箱会自动穿上更强的装备，不要的在这里分解', color: '#c7c7c7', action: null });
      }
    }

    if (current === 'shop') {
      var unlocked = PROG.shopUnlocked(view.save.level);
      list.push({
        id: 'shop:horn',
        y: top,
        h: rowH,
        text: '公会号角 ' + BAL.shop.horn.priceGold + ' 金币',
        sub: unlocked
          ? '已持有 ' + view.save.horns + ' 个 · 建公会消耗 1 个'
          : '需要 ' + BAL.guild.shopUnlockLevel + ' 级解锁（现在 ' + view.save.level + ' 级）',
        color: unlocked ? '#ffd479' : '#8d8d8d',
        action: { type: 'buyHorn' }
      });
      list.push({
        id: 'shop:teleport',
        y: top + rowH,
        h: rowH,
        text: '回公会（免费）',
        sub: '冷却 ' + Math.round(BAL.guild.teleportCooldownMs / 1000) + ' 秒 · 战斗中 ' + Math.round(BAL.guild.teleportCombatLockMs / 1000) + ' 秒内不可用',
        color: '#a9d5ff',
        action: { type: 'teleportGuild' }
      });
      list.push({
        id: 'shop:note',
        y: top + rowH * 2,
        h: rowH,
        text: '首版不接真实支付（决策 #3）',
        sub: '号角只能用金币买；钻石字段保留但不投放',
        color: '#c7c7c7',
        action: null
      });
    }

    if (current === 'guild') {
      var levelOk = PROG.guildUnlocked(view.save.level);
      if (!view.save.guild) {
        list.push({
          id: 'guild:name',
          y: top,
          h: rowH,
          text: '公会名：' + draftGuildName,
          sub: '点一下换一个（canvas 里没有输入框，阶段 D 接平台键盘）',
          color: '#a9d5ff',
          action: { type: 'renameGuild' }
        });
        list.push({
          id: 'guild:create',
          y: top + rowH,
          h: rowH,
          text: '创建公会（消耗 1 个号角）',
          sub: !levelOk
            ? '需要 ' + BAL.guild.unlockLevel + ' 级（现在 ' + view.save.level + ' 级）'
            : view.save.horns > 0
              ? '持有号角 ' + view.save.horns + ' 个'
              : '还没有号角：商城 ' + BAL.shop.horn.priceGold + ' 金币',
          color: levelOk && view.save.horns > 0 ? '#8ce99a' : '#8d8d8d',
          action: { type: 'createGuild' }
        });
      } else {
        list.push({
          id: 'guild:info',
          y: top,
          h: rowH,
          text: view.save.guild.name,
          sub: '会长：我 · 成员 1 / ' + BAL.guild.memberCap,
          color: '#ffd479',
          action: null
        });
        list.push({
          id: 'guild:teleport',
          y: top + rowH,
          h: rowH,
          text: '回到公会锚点',
          sub: '锚点 (' + Math.round(view.save.guild.anchor.x) + ', ' + Math.round(view.save.guild.anchor.y) + ')',
          color: '#a9d5ff',
          action: { type: 'teleportGuild' }
        });
        list.push({
          id: 'guild:members',
          y: top + rowH * 2,
          h: rowH,
          text: '成员列表（阶段 D 上服务端）',
          sub: '现在只有你自己；邀请码 / 申请 / 踢人都在服务端做',
          color: '#c7c7c7',
          action: null
        });
      }
    }

    if (current === 'menu') {
      var settings = view.save.settings || { autoBattle: false, sfx: true, bgm: true, vibrate: true };
      var audio = view.audio || null;
      list.push({
        id: 'menu:selftest',
        y: top,
        h: rowH,
        text: '立即跑自检',
        sub: '地图确定性 / 伤害 / 掉箱 / 装备 / 升级曲线 / 账号与界面，三百多项断言当场出结果',
        color: '#8ce99a',
        action: { type: 'selftest' }
      });
      list.push({
        id: 'menu:cloud',
        y: top + rowH,
        h: rowH,
        text: '云后端连通性自测',
        sub: '部署抖音云后把域名填进 00-config.js 的 cloudBase，这里会调一次 /api/health',
        color: '#a9d5ff',
        action: { type: 'cloudPing' }
      });
      list.push({
        id: 'menu:debug',
        y: top + rowH * 2,
        h: rowH,
        text: (view.debug ? '关闭' : '打开') + '调试面板',
        sub: 'FPS / chunk 数 / 活跃怪 / 当前目标 / 世界种子',
        color: '#ffd479',
        action: { type: 'toggleDebug' }
      });
      list.push({
        id: 'menu:sfx',
        y: top + rowH * 3,
        h: rowH,
        text: '音效：' + (settings.sfx ? '开' : '关'),
        sub: '命中 / 暴击 / 击杀 / 受伤 / 升级 / 开箱（音量在 balance.audio，声音文件由工具生成）',
        color: settings.sfx ? '#8ce99a' : '#8d8d8d',
        action: { type: 'toggleSfx' }
      });
      list.push({
        id: 'menu:bgm',
        y: top + rowH * 4,
        h: rowH,
        text: '背景音乐：' + (settings.bgm ? '开' : '关'),
        sub: audio && audio.supported ? '首次触摸后才会响（平台要求）' : '当前环境没有音频接口（模拟器里可能如此）',
        color: settings.bgm ? '#8ce99a' : '#8d8d8d',
        action: { type: 'toggleBgm' }
      });
      list.push({
        id: 'menu:vibrate',
        y: top + rowH * 5,
        h: rowH,
        text: '震动：' + (settings.vibrate ? '开' : '关'),
        sub: '暴击与挨打时短震一下（暴击的手感一半在手上）',
        color: settings.vibrate ? '#8ce99a' : '#8d8d8d',
        action: { type: 'toggleVibrate' }
      });
      list.push({
        id: 'menu:reset',
        y: top + rowH * 6,
        h: rowH,
        text: '重置本地存档',
        sub: view.resetArmed ? '再点一次真的删（等级 / 装备 / 宝箱全清，角色名保留）' : '点一下先确认',
        color: view.resetArmed ? '#ff8a8a' : '#c7c7c7',
        action: { type: 'resetSave' }
      });
    }

    return list;
  }

  /**
   * 对外统一入口：在 buildRows 的结果上扣掉滚动偏移。
   * 绘制与命中都用它的原因：面板滚动最经典的 bug 就是"画的时候减了、点的时候没减"。
   */
  function rows(view) {
    var list = buildRows(view);
    if (scroll === 0) return list;
    for (var i = 0; i < list.length; i += 1) list[i].y -= scroll;
    return list;
  }

  /** 命中测试：点落在哪一行上（只认视口内的行；上下各放宽 6 设计像素，手指更好点） */
  function rowAt(point, view) {
    var area = viewport();
    if (point.y < area.y || point.y > area.y + area.h) return null;
    var list = rows(view);
    for (var i = 0; i < list.length; i += 1) {
      var row = list[i];
      if (point.y >= row.y - 6 && point.y <= row.y + row.h - 10 + 6) return row;
    }
    return null;
  }

  /**
   * 按下：先判关闭键，再判卡片内的行（松手时才算点击，中途滑走 / 滚动就取消）。
   */
  function press(point, view) {
    if (!current) return null;
    var button = closeButton();
    var dx = point.x - button.x;
    var dy = point.y - button.y;
    var reach = button.r + 12;
    if (dx * dx + dy * dy <= reach * reach) {
      pressedClose = true;
      return button.id;
    }
    pressedClose = false;
    var card = rect();
    if (point.x < card.x || point.x > card.x + card.w || point.y < card.y || point.y > card.y + card.h) {
      pressedRowId = null;
      return null;
    }
    pressY = point.y;
    pressScroll = scroll;
    dragging = false;
    var row = rowAt(point, view);
    pressedRowId = row ? row.id : null;
    return pressedRowId;
  }

  /**
   * 拖动：卡片内上下拖 = 滚动（内容比视口长才有得滚）。
   * 一旦超过 `touchSlop` 就把"按下命中的那一行"作废 —— 手指滑过一行不该算点了它。
   * 返回 true 表示这一下已经被面板消费（调用方不必再当摇杆处理）。
   */
  function move(point, view) {
    if (!current || pressedClose) return false;
    var dy = point.y - pressY;
    if (!dragging && Math.abs(dy) > BAL.view.panel.touchSlop) {
      dragging = true;
      pressedRowId = null;
    }
    if (!dragging) return false;
    setScroll(pressScroll - dy, view);
    return true;
  }

  /** 松手：关闭键 → close；拖动过 → 什么都不触发；否则命中行 → 该行的 action */
  function release(point, view) {
    if (!current) return null;
    if (pressedClose) {
      pressedClose = false;
      return { type: 'close' };
    }
    if (dragging) {
      dragging = false;
      pressedRowId = null;
      return null;
    }
    var row = rowAt(point, view);
    pressedRowId = null;
    if (row && row.action) return row.action;
    return null;
  }

  /** 标题下面的一行小字：让玩家知道自己在哪个面板、身上有多少钱 */
  function headerLine(view) {
    return 'Lv.' + view.save.level + ' · 金币 ' + view.save.gold + ' · 战力 ' + view.stats.power + ' · 宝箱 ' + view.save.chests.length;
  }

  /**
   * 面板主绘制：一层**很淡**的暗底（世界仍然看得见 —— "打开界面游戏不停止"的视觉表达）
   * 加一张约占 1/3 屏的卡片。卡片 = 标题栏（标题 + 右上关闭键）+ 内容视口（行；超长就滚）。
   *
   * 内容用 `moveTo/lineTo` 组成的矩形路径 clip 住：滚动时半行不会被画到卡片外的世界上。
   * 这也是"只用基础图元"约束下的正解 —— 假 canvas 只实现了 moveTo/lineTo/arc/fillRect 这一组。
   */
  function draw(ctx, view) {
    if (!current) return;
    var config = BAL.view.panel;
    var card = rect();
    var area = viewport();
    var i;

    ctx.fillStyle = 'rgba(6,10,20,' + config.dimAlpha + ')';
    ctx.fillRect(0, 0, SCREEN.width(), SCREEN.height());

    // 卡片底 + 描边（圆角走 16-render 的 roundRectPath：moveTo/lineTo/arc，冒烟的假 canvas 也认）
    ctx.fillStyle = 'rgba(12,18,32,0.95)';
    G.RENDER.roundRectPath(ctx, card.x, card.y, card.w, card.h, 18);
    ctx.fill();
    ctx.strokeStyle = '#3a4a6b';
    ctx.lineWidth = 3;
    G.RENDER.roundRectPath(ctx, card.x, card.y, card.w, card.h, 18);
    ctx.stroke();

    // 标题栏
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(card.x + 2, card.y + 2, card.w - 4, config.headerHeight - 4);
    G.HUD.text(ctx, titlesOf(current), card.x + 22, card.y + 32, 28, '#ffd479', 'left');
    G.HUD.text(ctx, headerLine(view), card.x + 22, card.y + 58, 18, '#9fb4d8', 'left');

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(area.x, area.y);
    ctx.lineTo(area.x + area.w, area.y);
    ctx.lineTo(area.x + area.w, area.y + area.h);
    ctx.lineTo(area.x, area.y + area.h);
    ctx.closePath();
    ctx.clip();

    var list = rows(view);
    for (i = 0; i < list.length; i += 1) {
      var row = list[i];
      // 视口外的行直接跳过（省落笔，也不让 clip 白算）
      if (row.y + row.h < area.y - 4 || row.y > area.y + area.h + 4) continue;
      var pressed = pressedRowId === row.id;
      ctx.fillStyle = pressed ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.05)';
      ctx.fillRect(area.x + 10, row.y, area.w - 20, row.h - 10);
      G.HUD.text(ctx, row.text, area.x + 24, row.y + (row.sub ? 22 : (row.h - 10) / 2), 26, row.color, 'left');
      if (row.sub) G.HUD.text(ctx, row.sub, area.x + 24, row.y + 44, 17, '#9fb4d8', 'left');
      if (!row.action) {
        // 不可点的行给个视觉标记，免得玩家一直点它
        ctx.globalAlpha = 0.5;
        G.HUD.text(ctx, '（说明）', area.x + area.w - 22, row.y + (row.h - 10) / 2, 17, '#8d9bb5', 'right');
        ctx.globalAlpha = 1;
      }
    }

    if (current === 'selftest' && view.selftest) {
      var lines = view.selftest.lines || [];
      var boxH = area.h - 96;
      var maxLines = Math.max(3, Math.floor(boxH / 20));
      var start = Math.max(0, lines.length - maxLines);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(area.x + 10, area.y + 6, area.w - 20, boxH);
      for (var k = start; k < lines.length; k += 1) {
        var line = lines[k];
        var color = line.indexOf('FAIL') >= 0 ? '#ff8a8a' : '#bfe0ff';
        G.HUD.text(ctx, line, area.x + 18, area.y + 18 + (k - start) * 20, 15, color, 'left');
      }
      G.HUD.text(
        ctx,
        view.selftest.checks + ' 项 · 失败 ' + view.selftest.failures + ' · 指纹 ' + view.selftest.fingerprint,
        area.x + 18,
        area.y + boxH + 22,
        18,
        view.selftest.failures === 0 ? '#8ce99a' : '#ff8a8a',
        'left'
      );
    }
    ctx.restore();

    // 滚动条：只有内容真的比视口长才画（让玩家知道"下面还有"）
    var limit = maxScroll(view);
    if (limit > 0) {
      var trackH = area.h - 16;
      var thumbH = Math.max(36, trackH * (area.h / (area.h + limit)));
      var thumbY = area.y + 8 + (trackH - thumbH) * (scroll / limit);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(area.x + area.w - 7, area.y + 8, 4, trackH);
      ctx.fillStyle = '#6d86b5';
      ctx.fillRect(area.x + area.w - 7, thumbY, 4, thumbH);
    }

    if (current === 'menu' && view.cloud) {
      G.HUD.text(ctx, view.cloud, card.x + 20, card.y + card.h - 14, 15, '#9fb4d8', 'left');
    }

    // 关闭键（圆的：和 HUD 的功能键同一套视觉，命中测试在 press/release 里用同一份坐标）
    var list2 = buttons();
    for (i = 0; i < list2.length; i += 1) {
      var button = list2[i];
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = pressedClose ? '#ffd479' : '#243149';
      ctx.beginPath();
      ctx.arc(button.x, button.y, button.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#4d5f86';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(button.x, button.y, button.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      G.HUD.text(ctx, button.label, button.x, button.y, 26, pressedClose ? '#241a05' : '#dce6ff', 'center');
    }
  }

  /** 面板标题（一个地方管住，免得标题与面板 id 各写一份） */
  function titlesOf(panel) {
    if (panel === 'chest') return '开箱';
    if (panel === 'bag') return '背包 / 装备';
    if (panel === 'shop') return '商城';
    if (panel === 'guild') return '公会';
    if (panel === 'menu') return '设置 / 调试';
    if (panel === 'selftest') return '自检结果';
    return String(panel);
  }

  return {
    open: open,
    close: close,
    isOpen: isOpen,
    panelId: panelId,
    buttons: buttons,
    rows: rows,
    buildRows: buildRows,
    rect: rect,
    viewport: viewport,
    contains: contains,
    maxScroll: maxScroll,
    setScroll: setScroll,
    scrollOffset: scrollOffset,
    press: press,
    move: move,
    release: release,
    tierColor: tierColor,
    nextGuildName: nextGuildName,
    draftGuildName: function () {
      return draftGuildName;
    },
    setDraftGuildName: function (name) {
      draftGuildName = name;
    },
    draw: draw
  };
})();

/**
 * G.LOGIN —— 标题 / 登录 / 创建角色界面（A4 新增）
 *
 * 用户要求："在打开游戏后增加注册，登录，创建角色，输入昵称等功能，并且昵称不能重复。"
 *
 * 它管的是**进游戏之前**的那两块屏，和 PANELS 同一套约定：
 *   界面只产生 action，由 20-main 执行（登录 = tt.login + /api/profile；建角色 = 校验昵称 + 写存档）。
 *   所以这里既不碰 tt、也不改存档 —— "昵称到底能不能用"于是可以在 node 里直接断言。
 *
 * action 清单：
 *   { type: 'login' }        登录：本机已有角色就直接进游戏，没有就去创建角色
 *   { type: 'typeName' }     调平台键盘输入昵称（tt.showKeyboard；没有这个 API 会退回随机名）
 *   { type: 'randomName' }   换一个随机昵称（canvas 里没有输入框时的兜底输入方式）
 *   { type: 'createRole' }   用当前昵称创建角色（先查本机注册表，配了云后端再查服务端）
 *   { type: 'newAccount' }   清掉本机账号（两步确认，调试用）
 *
 * 按钮是**矩形**（菜单语义，和面板卡片里的行同构）；游戏内的即时操作才用圆形 —— 这条分工
 * 让"点哪是哪"在两套界面里都成立。
 */
G.LOGIN = (function () {
  'use strict';

  var BAL = G.BAL;
  var SCREEN = G.SCREEN;

  var stage = 'welcome';
  var draft = '';
  var message = '';
  var busy = false;
  var pressedId = null;
  var armed = false;
  var hasAccount = false;

  /** 打开某一屏（'welcome' | 'createRole'） */
  function open(nextStage) {
    stage = nextStage === 'createRole' ? 'createRole' : 'welcome';
    busy = false;
    armed = false;
    pressedId = null;
    message = '';
    if (stage === 'createRole' && !draft) draft = G.ACCOUNT.suggest(G.WORLD.now() | 0);
  }

  function stageId() {
    return stage;
  }

  function draftName() {
    return draft;
  }

  function setDraftName(name) {
    draft = G.ACCOUNT.sanitizeName(name);
    return draft;
  }

  /** 换一个随机昵称（走 G.RNG：同一个世界时间给同一个名字，可复现） */
  function randomName(salt) {
    draft = G.ACCOUNT.suggest(typeof salt === 'number' ? salt : G.WORLD.now() | 0);
    message = '';
    return draft;
  }

  function setMessage(text) {
    message = text || '';
  }

  function setBusy(flag, text) {
    busy = flag === true;
    if (text !== undefined) message = text || '';
  }

  function isBusy() {
    return busy;
  }

  function setHasAccount(flag) {
    hasAccount = flag === true;
  }

  function isArmed() {
    return armed;
  }

  /** 卡片几何：和面板同一套边距（这是全屏界面，右边不用给功能键留位） */
  function rect() {
    var config = BAL.view.panel;
    var width = SCREEN.width() - config.leftMargin * 2;
    var height = SCREEN.height() * 0.34;
    return { x: config.leftMargin, y: SCREEN.height() * 0.3, w: width, h: height };
  }

  /** 矩形按钮：{ id, label, x, y, w, h }（命中测试与绘制共用同一份坐标） */
  function buttons() {
    var card = rect();
    var left = card.x + 24;
    var wide = card.w - 48;
    var list = [];
    if (stage === 'welcome') {
      list.push({
        id: 'login',
        label: hasAccount ? '继续游戏（登录）' : '登录 / 开始游戏',
        x: left,
        y: card.y + 196,
        w: wide,
        h: 78
      });
      list.push({
        id: 'newAccount',
        label: armed ? '再点一次：清掉本机账号' : '清掉本机账号（调试）',
        x: left,
        y: card.y + 292,
        w: wide,
        h: 54
      });
      return list;
    }
    list.push({ id: 'typeName', label: '输入昵称', x: left, y: card.y + 196, w: wide, h: 64 });
    list.push({ id: 'randomName', label: '换一个随机昵称', x: left, y: card.y + 270, w: wide, h: 58 });
    list.push({ id: 'createRole', label: '创建角色并进入游戏', x: left, y: card.y + 342, w: wide, h: 70 });
    return list;
  }

  function buttonAt(point) {
    var list = buttons();
    for (var i = 0; i < list.length; i += 1) {
      var button = list[i];
      if (point.x >= button.x && point.x <= button.x + button.w && point.y >= button.y && point.y <= button.y + button.h) {
        return button;
      }
    }
    return null;
  }

  /** 按下：记住被按住的按钮（松手才算点击，滑开就取消） */
  function press(point) {
    if (busy) return null;
    var button = buttonAt(point);
    pressedId = button ? button.id : null;
    return pressedId;
  }

  /** 松手：同一个按钮上松手才产生 action（"清账号"要求点两次） */
  function release(point) {
    if (busy || !pressedId) {
      pressedId = null;
      return null;
    }
    var button = buttonAt(point);
    var id = pressedId;
    pressedId = null;
    if (!button || button.id !== id) return null;
    if (id === 'newAccount') {
      if (!armed) {
        armed = true;
        message = '清掉本机账号只是调试用：存档不会删，昵称注册表也不会释放';
        return null;
      }
      armed = false;
      return { type: 'newAccount' };
    }
    return { type: id };
  }

  /** 画一个矩形按钮（菜单语义：比圆形更好放长文案） */
  function painted(ctx, button, pressed) {
    ctx.fillStyle = pressed ? '#ffd479' : '#1b2438';
    ctx.fillRect(button.x, button.y, button.w, button.h);
    ctx.strokeStyle = pressed ? '#fff3d0' : '#4d5f86';
    ctx.lineWidth = 3;
    ctx.strokeRect(button.x, button.y, button.w, button.h);
  }

  /** 一屏的字：标题 / 账号态 / 昵称 / 提示 / 按钮 */
  function draw(ctx, view) {
    var card = rect();
    var centerX = SCREEN.centerX();
    var account = view && view.account ? view.account : null;
    var save = view && view.save ? view.save : null;
    var name = stage === 'createRole' ? draft : (account && account.name) || '';

    ctx.fillStyle = '#0b1020';
    ctx.fillRect(0, 0, SCREEN.width(), SCREEN.height());

    G.HUD.text(ctx, '疯狂开宝箱', centerX, SCREEN.height() * 0.13, 52, '#ffd479', 'center');
    G.HUD.text(ctx, '竖屏 · 无限地图 · 自动战斗 · 刷宝', centerX, SCREEN.height() * 0.13 + 46, 22, '#9fb4d8', 'center');

    ctx.fillStyle = 'rgba(12,18,32,0.95)';
    G.RENDER.roundRectPath(ctx, card.x, card.y, card.w, card.h, 18);
    ctx.fill();
    ctx.strokeStyle = '#3a4a6b';
    ctx.lineWidth = 3;
    G.RENDER.roundRectPath(ctx, card.x, card.y, card.w, card.h, 18);
    ctx.stroke();

    // 头像：用昵称当种子 → 同一个名字永远同一张脸（视觉上"这就是我的角色"）
    G.RENDER.drawAvatar(ctx, centerX, card.y - 2, 46, G.RNG.hash32(G.ACCOUNT.nameKey(name).length * 31, 0x51a7c3));

    if (stage === 'welcome') {
      G.HUD.text(ctx, '登录后开始你的刷宝之旅', centerX, card.y + 60, 26, '#ffd479', 'center');
      G.HUD.text(
        ctx,
        account
          ? '本机账号：' + account.name + '（' + (account.mode === 'douyin' ? '抖音' : '本机') + '）'
          : '还没有账号：点下面的按钮登录 / 注册',
        centerX,
        card.y + 100,
        20,
        '#9fb4d8',
        'center'
      );
      G.HUD.text(
        ctx,
        save && save.name ? '当前角色：' + save.name + ' Lv.' + save.level : '还没有角色：登录后创建',
        centerX,
        card.y + 134,
        20,
        '#e8f1ff',
        'center'
      );
      if (message) G.HUD.text(ctx, message, centerX, card.y + 168, 17, '#8ce99a', 'center');
    } else {
      G.HUD.text(ctx, '创建角色：给角色起个名字', centerX, card.y + 34, 24, '#ffd479', 'center');
      // 昵称框（矩形，和按钮同一套视觉；真正的文字来自平台键盘或随机词库）
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(card.x + 24, card.y + 84, card.w - 48, 74);
      ctx.strokeStyle = '#4d5f86';
      ctx.lineWidth = 2;
      ctx.strokeRect(card.x + 24, card.y + 84, card.w - 48, 74);
      G.HUD.text(ctx, name || '（空）', centerX, card.y + 121, 34, '#ffffff', 'center');
      G.HUD.text(
        ctx,
        '昵称 ' + BAL.account.nameMin + '~' + BAL.account.nameMax + ' 个字符，只能用中文 / 字母 / 数字 / 下划线',
        centerX,
        card.y + 176,
        16,
        '#9fb4d8',
        'center'
      );
      if (message) {
        G.HUD.text(ctx, message, centerX, card.y + 204, 17, message.indexOf('占用') >= 0 ? '#ff8a8a' : '#8ce99a', 'center');
      }
    }

    if (busy) G.HUD.text(ctx, '请稍候…', centerX, card.y + card.h + 28, 20, '#ffd479', 'center');

    var list = buttons();
    for (var i = 0; i < list.length; i += 1) painted(ctx, list[i], pressedId === list[i].id);

    G.HUD.text(ctx, '没有抖音环境时会自动使用本机离线账号，单机照样能玩', centerX, card.y + card.h + 72, 16, '#6d86b5', 'center');
  }

  return {
    open: open,
    stageId: stageId,
    draftName: draftName,
    setDraftName: setDraftName,
    randomName: randomName,
    setMessage: setMessage,
    setBusy: setBusy,
    setHasAccount: setHasAccount,
    isArmed: isArmed,
    rect: rect,
    buttons: buttons,
    press: press,
    release: release,
    draw: draw
  };
})();

/**
 * 18-selftest.js —— 游戏内自检 / 调试断言（本工程唯一的"自动验证"入口）
 *
 * 为什么要在游戏里再写一遍断言：
 *   1. `tools\test-logic.mjs` 跑的是 `src\` 里的 TypeScript 参照实现；小游戏里真正跑的是
 *      本目录的 JS。两份实现之间不许漂移 —— **世界指纹**就是那把尺子：这里算出来的值必须
 *      等于 test-logic.mjs 里的 GOLDEN_FINGERPRINT（e9802f11），不等就说明"有人只改了一边"。
 *   2. 手感与渲染只能靠 IDE 模拟器 + 真机，但**最容易错的那部分逻辑**（地图确定性、伤害结算、
 *      掉箱、装备、升级曲线）在模拟器里点一下「设置 → 自检」就能看到 PASS/FAIL，不用装环境。
 *
 * 入口：runAll() 只做纯逻辑断言（不碰画布、不碰 tt），游戏内面板与
 * `tools\minigame-selftest.mjs`（node）共用同一份代码。
 *
 * 断言写法与 `tools\test-logic.mjs` 完全一致（section / ok / eq / near / between / same），
 * 这样两边的输出可以对着看。
 */

G.SELFTEST = (function () {
  'use strict';

  var BAL = G.BAL;
  var RNG = G.RNG;
  var SPAWN = G.SPAWN;
  var TERRAIN = G.TERRAIN;
  var PROG = G.PROG;
  var LOOT = G.LOOT;

  /** 世界指纹基准：与 tools\test-logic.mjs 的 GOLDEN_FINGERPRINT 必须是同一个字符串 */
  var GOLDEN_FINGERPRINT = 'e9802f11';

  var state = { checks: 0, failures: 0, lines: [] };

  function log(line) {
    state.lines.push(line);
  }

  function section(name) {
    log('');
    log('== ' + name + ' ==');
  }

  function ok(name, condition, detail) {
    state.checks += 1;
    if (condition) {
      log('  ok    ' + name);
      return true;
    }
    state.failures += 1;
    log('  FAIL  ' + name + (detail === undefined ? '' : ' -> ' + detail));
    return false;
  }

  function eq(name, actual, expected) {
    return ok(name, actual === expected, 'got ' + String(actual) + ', want ' + String(expected));
  }

  function near(name, actual, expected, tolerance) {
    var delta = Math.abs(actual - expected);
    return ok(name, delta <= tolerance, 'got ' + actual + ', want ' + expected + ' +-' + tolerance);
  }

  function between(name, actual, min, max) {
    return ok(name, actual >= min && actual <= max, 'got ' + actual + ', want ' + min + '..' + max);
  }

  /** 结构相等（确定性要求"逐位相同"，所以直接比 JSON 字符串） */
  function same(name, actual, expected) {
    var a = JSON.stringify(actual);
    var b = JSON.stringify(expected);
    return ok(name, a === b, 'got ' + a + ', want ' + b);
  }

  /** 把文本压成整数指纹（只做整数运算，才比得出跨机器漂移） */
  function fingerprintOf(text) {
    var hash = RNG.hash32(text.length, 0x5eed);
    for (var i = 0; i < text.length; i += 1) hash = RNG.hash32(hash, text.charCodeAt(i));
    return hash.toString(16);
  }

  /**
   * 世界指纹：把原点附近 3×3 chunk 的怪 + 装饰 + 地标压成一行再哈希。
   * 与 tools\test-logic.mjs 的 worldFingerprint 逐行对应 —— 改这里必须同步改那边。
   */
  function worldFingerprint(seed) {
    var parts = [];
    var cy;
    var cx;
    for (cy = -1; cy <= 1; cy += 1) {
      for (cx = -1; cx <= 1; cx += 1) {
        var band = SPAWN.chunkCenterBand(cx, cy);
        var monsters = SPAWN.buildChunkMonsters(seed, cx, cy);
        for (var i = 0; i < monsters.length; i += 1) {
          var m = monsters[i];
          parts.push('m' + m.kindId + ':' + m.level + ':' + (m.elite ? 1 : 0) + ':' + m.x.toFixed(3) + ':' + m.y.toFixed(3));
        }
        var decor = TERRAIN.buildChunkDecor(seed, cx, cy, band);
        for (var d = 0; d < decor.length; d += 1) {
          var item = decor[d];
          parts.push('d' + item.kind + ':' + item.x.toFixed(3) + ':' + item.y.toFixed(3) + ':' + item.size);
        }
        var landmark = SPAWN.landmarkForChunkGroup(seed, cx, cy);
        parts.push('l' + landmark.kind + ':' + landmark.x.toFixed(3) + ':' + landmark.y.toFixed(3));
      }
    }
    return fingerprintOf(parts.join('|'));
  }

  /** 每次 runAll 前复位计数器（面板可以反复点） */
  function reset() {
    state.checks = 0;
    state.failures = 0;
    state.lines = [];
  }

  /* -------------------------------------------------- 1. 数值表（只读校验） */

  function checkBalance() {
    section('数值表（shared/balance.json）');
    eq('世界种子写死（赛季制）', BAL.season.worldSeed, 20260930);
    eq('chunk 边长 512', BAL.world.chunkSize, 512);
    eq('难度带宽 1000', BAL.world.bandSize, 1000);
    eq('每 chunk 怪密度上限 = 3', BAL.world.monstersPerChunk.max, 3);
    eq('精英概率 8%', BAL.world.eliteChance, 0.08);
    eq('怪种类 = 4 种', BAL.monsters.kinds.length, 4);
    eq('近战/群怪/远程/重甲齐备', BAL.monsters.kinds.map(function (k) { return k.id; }).join(','), 'wolf,bat,mage,brute');
    eq('号角 500 金币（决策 #4）', BAL.shop.horn.priceGold, 500);
    eq('宝箱六阶', BAL.chests.tiers.length, 6);
    eq('宝箱阶名', BAL.chests.tiers.map(function (t) { return t.name; }).join('/'), '普通/专家/史诗/传说/神话/天赐');
    eq('保底：50 箱无史诗', BAL.chests.pity.epic, 50);
    eq('保底：500 箱无神话', BAL.chests.pity.mythic, 500);
    eq('宝箱背包上限 200', BAL.chests.bagCap, 200);
    eq('装备六部位', BAL.equipment.slots.length, 6);
    eq('装备词条数 1/2/3/4/5/5', BAL.equipment.tiers.map(function (t) { return t.affixes; }).join(','), '1,2,3,4,5,5');
    eq('装备末阶倍率 5.3', BAL.equipment.tiers[5].multiplier, 5.3);
    eq('公会人数上限 20', BAL.guild.memberCap, 20);
    eq('公会 / 商城解锁等级 20', BAL.guild.unlockLevel, 20);
    ok(
      '抢怪的两个缓解开关默认关闭（决策 #1）',
      BAL.combat.firstHitProtectionMs === 0 && BAL.combat.damageShareGate === 0,
      BAL.combat.firstHitProtectionMs + ' / ' + BAL.combat.damageShareGate
    );

    var descending = true;
    for (var i = 1; i < BAL.chests.tiers.length; i += 1) {
      if (BAL.chests.tiers[i].weight >= BAL.chests.tiers[i - 1].weight) descending = false;
    }
    ok('六阶箱权重严格递减', descending, BAL.chests.tiers.map(function (t) { return t.weight; }).join(','));

    var total = 0;
    for (var level = 1; level < BAL.progression.targetLevel; level += 1) total += PROG.xpToNext(level);
    ok(
      '1→20 级累计经验约 10 万（实测 ' + Math.round(total) + '）',
      total > 90000 && total < 115000,
      String(Math.round(total))
    );
  }

  /* ---------------------------------------- 2. chunk 数学（与 TS 侧逐条对应） */

  function checkChunk() {
    section('chunk 数学（03-chunk.js）');
    var C = G.CHUNK;
    eq('世界坐标 0 → chunk 0', C.chunkIndexOf(0), 0);
    eq('世界坐标 511.9 → chunk 0', C.chunkIndexOf(511.9), 0);
    eq('世界坐标 512 → chunk 1', C.chunkIndexOf(512), 1);
    eq('负坐标向负方向取整（-0.5 → -1，不能用 |0）', C.chunkIndexOf(-0.5), -1);
    eq('负坐标 -512 → -1', C.chunkIndexOf(-512), -1);
    eq('负坐标 -513 → -2', C.chunkIndexOf(-513), -2);
    eq('chunkKey 用逗号分隔', C.chunkKeyOf(-3, 7), '-3,7');
    same('chunkOfWorld 同时给出两轴（5200,-3100 → 10,-7）', C.chunkOfWorld(5200, -3100), { cx: 10, cy: -7 });

    eq('原点 = band 0', C.bandOf(0, 0), 0);
    eq('距原点 999 = band 0', C.bandOf(999, 0), 0);
    eq('距原点 1000 = band 1', C.bandOf(1000, 0), 1);
    eq('斜向按真实距离算（700,700 → band 0）', C.bandOf(700, 700), 0);
    eq('斜向 1000,1000 → band 1', C.bandOf(1000, 1000), 1);
    eq('负方向同样成立（-1000,0 → band 1）', C.bandOf(-1000, 0), 1);

    eq('distanceSq 是纯乘法（3,4 → 25）', C.distanceSq(0, 0, 3, 4), 25);
    eq('distance 正确开方（3,4 → 5）', C.distance(0, 0, 3, 4), 5);

    eq('矩形覆盖 3×3 个 chunk（无外圈）', C.chunksInRect(-100, -100, 512 + 100, 512 + 100, 0).length, 9);
    eq('加一圈预载后 5×5', C.chunksInRect(0, 0, 512 * 3 - 1, 512 * 3 - 1, 1).length, 25);
    eq('竖屏 2×4 视野加一圈 = 4×6', C.chunksInRect(0, 0, 512 * 2 - 1, 512 * 4 - 1, 1).length, 24);
  }

  /* ---------------------------------------- 3. 地表与装饰 */

  function checkTerrain() {
    section('确定性地表与装饰（04-terrain.js）');
    var seed = BAL.season.worldSeed;
    var decorations = TERRAIN.buildChunkDecor(seed, 3, 3, 0);
    between('装饰数量 8~24', decorations.length, BAL.world.decorPerChunk.min, BAL.world.decorPerChunk.max);
    same('同 chunk 两次装饰一致', TERRAIN.buildChunkDecor(seed, 3, 3, 0), decorations);
    eq(
      '装饰种类合法',
      decorations.every(function (d) { return TERRAIN.DECOR_ORDER.indexOf(d.kind) >= 0; }),
      true
    );
    eq('地表色块网格 8×8', TERRAIN.tileCountPerChunk(), 8);

    eq(
      'band 决定主题：0 草原 / 1 荒漠 / 4 虚境',
      TERRAIN.themeForBand(0).name + ',' + TERRAIN.themeForBand(1).name + ',' + TERRAIN.themeForBand(4).name,
      '草原,荒漠,虚境'
    );
    eq('band 超出主题档位后固定最后一档', TERRAIN.themeForBand(9).id, TERRAIN.themeForBand(4).id);

    var desert = TERRAIN.buildChunkDecor(seed, 3, 3, 1);
    eq(
      '换 band 只改种类权重、不改坐标（"同坐标同内容"的命门）',
      desert.map(function (d) { return d.x.toFixed(3) + ',' + d.y.toFixed(3); }).join(';'),
      decorations.map(function (d) { return d.x.toFixed(3) + ',' + d.y.toFixed(3); }).join(';')
    );

    var variants = {};
    for (var tileX = 0; tileX < 8; tileX += 1) {
      for (var tileY = 0; tileY < 8; tileY += 1) variants[TERRAIN.groundVariant(seed, 0, 0, tileX, tileY)] = true;
    }
    eq('地表色块在 8×8 网格上取到 3 种颜色', Object.keys(variants).length, 3);
  }

  /* ---------------------------------------- 4. 怪与地标的播种 */

  function checkSpawn() {
    section('怪与地标的确定性播种（05-spawn.js）');
    var seed = BAL.season.worldSeed;
    same('同 chunk 两次生成完全一致', SPAWN.buildChunkMonsters(seed, 12, -7), SPAWN.buildChunkMonsters(seed, 12, -7));
    ok(
      '相邻 chunk 内容不同（不是全局一样）',
      JSON.stringify(SPAWN.buildChunkMonsters(seed, 12, -7)) !== JSON.stringify(SPAWN.buildChunkMonsters(seed, 13, -7))
    );

    var chunk = SPAWN.buildChunkMonsters(seed, 0, 0);
    between('原点 chunk 怪数符合密度上限 1~3', chunk.length, 1, 3);
    eq(
      'band 0 的怪等级 1~2（文档写 1–3，实际公式给 1~2 —— 待拍板项）',
      chunk.every(function (m) { return m.level >= 1 && m.level <= 2; }),
      true
    );
    eq('同 chunk 内 ID 唯一', new Set(chunk.map(function (m) { return m.id; })).size, chunk.length);
    eq('精英每 chunk 至多 1 只', chunk.filter(function (m) { return m.elite; }).length <= 1, true);
    eq('等级下限被夹到 1', SPAWN.monsterLevelFor(0, new RNG.Rng(1)), 1);

    var far = SPAWN.buildChunkMonsters(seed, 20, 0);
    eq('远处 chunk 的 band 更高', far.every(function (m) { return m.band >= 9; }), true);
    ok(
      '远处怪等级随之提高',
      far.every(function (m) { return m.level > 3; }),
      far.map(function (m) { return m.level; }).join(',')
    );
    eq(
      '重生时间 15~30 秒（确定性伪随机）',
      chunk.every(function (m) {
        return m.respawnMs >= BAL.world.respawnMs.min && m.respawnMs <= BAL.world.respawnMs.max;
      }),
      true
    );

    var eliteChunks = 0;
    var sampled = 800;
    var i;
    for (i = 0; i < sampled; i += 1) {
      if (SPAWN.buildChunkMonsters(seed, 100 + i, 37).some(function (m) { return m.elite; })) eliteChunks += 1;
    }
    near('精英率 ≈ 8%', eliteChunks / sampled, 0.08, 0.03);

    var eliteSample = null;
    var plainSample = null;
    for (i = 0; i < 400 && !eliteSample; i += 1) {
      var monsters = SPAWN.buildChunkMonsters(seed, 200 + i, 11);
      var elite = null;
      var plain = null;
      var k;
      for (k = 0; k < monsters.length; k += 1) if (monsters[k].elite) elite = monsters[k];
      for (k = 0; k < monsters.length; k += 1) {
        if (!monsters[k].elite && elite && monsters[k].kindId === elite.kindId) plain = monsters[k];
      }
      if (elite && plain) {
        eliteSample = elite;
        plainSample = plain;
      }
    }
    ok('400 个 chunk 内能采到精英样本', eliteSample !== null && plainSample !== null);
    if (eliteSample && plainSample) {
      ok(
        '精英血量远高于同种普通怪（×5 量级）',
        eliteSample.hpMax > plainSample.hpMax * 3,
        eliteSample.hpMax + ' vs ' + plainSample.hpMax
      );
    }

    var landmark = SPAWN.landmarkForChunkGroup(seed, 0, 0);
    same('地标同组两次一致', landmark, SPAWN.landmarkForChunkGroup(seed, 0, 0));
    eq('5×5 chunk 范围内恰好 1 个地标', SPAWN.landmarksInChunkRect(seed, 0, 0, 4, 4).length, 1);
    eq('跨 3 个组（0..12 chunk）返回 9 个地标', SPAWN.landmarksInChunkRect(seed, 0, 0, 12, 12).length, 9);

    var spawnPoint = SPAWN.randomSpawnPoint(seed, 0);
    var radius = Math.sqrt(spawnPoint.x * spawnPoint.x + spawnPoint.y * spawnPoint.y);
    between('首次出生半径 300~800（决策 #5）', radius, 300, 800);
    eq('坏坐标视为不可用（回退随机出生）', SPAWN.isUsableSpawn(0, 0), false);
    eq('好坐标可用', SPAWN.isUsableSpawn(120, -340), true);
  }

  /* ---------------------------------------- 5. 等级 / 经验 / 金币 */

  function checkProgression() {
    section('等级 / 经验 / 金币曲线（06-progression.js）');
    eq('need(1) = 150', PROG.xpToNext(1), 150);
    near('need(4) = 150×4^1.5 = 1200', PROG.xpToNext(4), 1200, 0.001);
    var total = 0;
    for (var level = 1; level < 20; level += 1) total += PROG.xpToNext(level);
    ok('1→20 累计约 10 万（实测 ' + Math.round(total) + '）', total > 90000 && total < 115000, String(Math.round(total)));

    eq('band 0 的 1 级怪经验 180', PROG.monsterXp(1, 0, false), 180);
    eq('band 0 的 3 级怪经验 300', PROG.monsterXp(3, 0, false), 300);
    eq('精英经验 ×5', PROG.monsterXp(1, 0, true), 900);
    eq('band 加成 15%/带（1 带 → 207）', PROG.monsterXp(1, 1, false), 207);
    eq('band 0 的 1 级怪金币 7', PROG.monsterGold(1, 0, false), 7);
    eq('band 0 的 3 级怪金币 13', PROG.monsterGold(3, 0, false), 13);
    eq('精英金币 ×8', PROG.monsterGold(1, 0, true), 56);

    var xpState = { level: 1, exp: 0 };
    eq('刚好够升级就升', PROG.applyXp(xpState, 150), 1);
    eq('升级后等级 2', xpState.level, 2);
    eq('升级后余经验 0', xpState.exp, 0);
    eq(
      '一次给足三级的经验能连升',
      PROG.applyXp({ level: 1, exp: 0 }, 150 + PROG.xpToNext(2) + PROG.xpToNext(3)),
      3
    );
    eq('20 级解锁商城与公会', PROG.shopUnlocked(20) && PROG.guildUnlocked(20), true);
    eq('19 级还没解锁', PROG.shopUnlocked(19) || PROG.guildUnlocked(19), false);
    eq('紧凑数字 1234 → 1.2k', PROG.shortNumber(1234), '1.2k');
  }

  /* ---------------------------------------- 6. 战斗：伤害 / 选目标 / 归属 */

  function checkCombat() {
    section('自动战斗（07-combat.js）');
    var RNG_ = G.RNG;
    var COMBAT_ = G.COMBAT;

    var noCrit = new RNG_.Rng(1);
    var hit = COMBAT_.rollDamage(30, 0, 4, 0, 1.5, noCrit);
    eq('伤害 = max(1, 攻击 − 防御×0.6)（30 − 2.4 → 28）', hit.damage, 28);
    eq('暴击率 0 时不暴击', hit.crit, false);

    var alwaysCrit = new RNG_.Rng(1);
    var critHit = COMBAT_.rollDamage(30, 0, 4, 1, 1.5, alwaysCrit);
    eq('暴击率 1 必暴（27.6 × 1.5 = 41.4 → 41）', critHit.damage, 41);
    eq('暴击标记为真', critHit.crit, true);

    var bonusHit = COMBAT_.rollDamage(30, 0.25, 4, 0, 1.5, new RNG_.Rng(1));
    eq('增伤乘在攻击上（30×1.25 − 2.4 = 35.1 → 35）', bonusHit.damage, 35);

    var minHit = COMBAT_.rollDamage(5, 0, 100, 0, 1.5, new RNG_.Rng(1));
    eq('伤害下限为 1（不会出现 0 或负数）', minHit.damage, 1);

    var monsterHit = COMBAT_.monsterDamage({ attack: 12, elite: false }, { defense: 5, damageReduction: 0 }, new RNG_.Rng(1));
    eq('怪打玩家：12 − 5×0.6 = 9', monsterHit.damage, 9);
    var reduced = COMBAT_.monsterDamage({ attack: 12, elite: false }, { defense: 5, damageReduction: 0.5 }, new RNG_.Rng(1));
    eq('玩家减伤 50% 后 9 → 5', reduced.damage, 5);

    near('出手间隔 = 1000 / 攻速（1.6 → 625ms）', COMBAT_.attackIntervalMs(1.6), 625, 0.001);

    var near1 = { id: 7, x: 100, y: 0, state: 'idle' };
    var near2 = { id: 3, x: 120, y: 0, state: 'idle' };
    var far = { id: 1, x: 900, y: 0, state: 'idle' };
    var dead = { id: 2, x: 90, y: 0, state: 'dead' };
    eq('选目标：视野内最近的活怪', COMBAT_.pickTarget(0, 0, [far, near2, near1, dead], 540).id, 7);
    var tieA = { id: 9, x: 50, y: 0, state: 'idle' };
    var tieB = { id: 4, x: 50, y: 0, state: 'idle' };
    eq('同距取 ID 小的（确定性，帧率变了目标也不跳）', COMBAT_.pickTarget(0, 0, [tieA, tieB], 540).id, 4);
    eq('视野外没有目标', COMBAT_.pickTarget(0, 0, [far], 540), null);

    var monster = { id: 1, hpMax: 100, damageBy: {}, state: 'idle' };
    COMBAT_.creditHit(monster, 1, 30, 0);
    COMBAT_.creditHit(monster, 2, 70, 10);
    eq('奖励归累计伤害最高者（决策 #1）', COMBAT_.rewardWinnerId(monster, 1, 20), 2);
    eq('伤害归属记在怪身上', monster.damageBy[2], 70);
    eq('首击者被记下来（供"首击保护"开关用）', monster.firstHitBy, 1);

    var mine = { id: 1, hpMax: 100, damageBy: { 1: 100 }, state: 'idle' };
    eq('只有自己打时奖励归自己', COMBAT_.rewardWinnerId(mine, 1, 20), 1);
    eq('两个缓解开关默认关闭（首版按决策 #1 实现）', BAL.combat.firstHitProtectionMs === 0 && BAL.combat.damageShareGate === 0, true);
  }

  /* ---------------------------------------- 7. 六阶宝箱与保底 */

  function checkLoot() {
    section('六阶宝箱与保底（08-loot.js）');
    eq('band 0 普通怪掉箱率 8%', LOOT.dropChance(0, false), 0.08);
    eq('精英 25%', LOOT.dropChance(0, true), 0.25);
    near('band 7 → 15%（8% + 7×1%）', LOOT.dropChance(7, false), 0.15, 1e-9);
    eq('掉箱率上限 20%', LOOT.dropChance(50, false), BAL.chests.drop.cap);
    eq('背包上限 200', LOOT.bagCap(), 200);

    var weights = LOOT.tierWeights(0);
    var descending = true;
    for (var i = 1; i < weights.length; i += 1) if (weights[i] >= weights[i - 1]) descending = false;
    ok('六阶权重严格递减（普通箱占绝大多数）', descending, weights.join(','));
    ok('高阶箱随 band 变常见', LOOT.tierWeights(6)[5] > LOOT.tierWeights(0)[5]);

    // 8000 次抽样：普通箱应当占绝对多数，且六阶都能抽到
    var rng = new G.RNG.Rng(20260930);
    var counts = [0, 0, 0, 0, 0, 0, 0];
    var pity = { epic: 0, mythic: 0 };
    var rolls = 8000;
    for (var k = 0; k < rolls; k += 1) counts[LOOT.rollChestTier(0, false, rng, pity)] += 1;
    ok('普通箱(1 阶)占绝大多数', counts[1] / rolls > 0.8, (counts[1] / rolls).toFixed(3));
    ok('六阶箱能抽到（0.2% 量级）', counts[6] > 0, String(counts[6]));
    between('精英箱不低于 2 阶', LOOT.rollChestTier(0, true, rng, { epic: 0, mythic: 0 }), 2, 6);

    var pityEpic = { epic: BAL.chests.pity.epic, mythic: 0 };
    var forcedEpic = LOOT.rollChestTier(0, false, new G.RNG.Rng(7), pityEpic);
    ok('连续 50 箱未出史诗 → 强制 ≥ 史诗', forcedEpic >= 3, String(forcedEpic));
    eq('史诗保底兑现后计数清零', pityEpic.epic, 0);

    var pityMythic = { epic: 0, mythic: BAL.chests.pity.mythic };
    var forcedMythic = LOOT.rollChestTier(0, false, new G.RNG.Rng(9), pityMythic);
    ok('连续 500 箱未出神话 → 强制 ≥ 神话', forcedMythic >= 5, String(forcedMythic));

    var small = { epic: 0, mythic: 0 };
    LOOT.rollChestTier(0, false, new G.RNG.Rng(11), small);
    eq('抽过一箱保底计数就 +1', small.epic, 1);
    eq('箱子名带阶名', LOOT.tierName(4), '传说宝箱');
    eq('分解价值按阶给（4 阶 900 金币）', LOOT.salvageGold(4), 900);
  }

  /* ---------------------------------------- 8. 装备生成 / 词条 / 战力 */

  function checkEquipment() {
    section('装备生成 / 词条 / 战力（09-equipment.js）');
    var EQUIP_ = G.EQUIP;
    var rng = new G.RNG.Rng(1234);

    var t1 = EQUIP_.generate(1, 1, rng, 1);
    eq('1 阶 1 条词条', t1.affixes.length, 1);
    eq('1 阶等级门槛 1', t1.reqLevel, 1);
    ok('主属性数值 > 0', t1.main.value > 0, t1.main.stat + ' ' + t1.main.value);
    ok('战力 > 0', t1.power > 0, String(t1.power));

    var t3 = EQUIP_.generate(3, 8, new G.RNG.Rng(7), 2);
    eq('3 阶 3 条词条', t3.affixes.length, 3);
    eq('3 阶等级门槛 7', t3.reqLevel, 7);
    eq('词条不重复', new Set(t3.affixes.map(function (a) { return a.name; })).size, t3.affixes.length);

    var t6 = EQUIP_.generate(6, 20, new G.RNG.Rng(9), 3);
    eq('6 阶 = 5 条词条 + 1 条天赐专属', t6.affixes.length, 6);
    ok('第 6 条带"天赐"前缀', t6.affixes[5].name.indexOf('天赐') === 0, t6.affixes[5].name);
    eq('6 阶等级门槛 16', t6.reqLevel, 16);

    var again = EQUIP_.generate(3, 8, new G.RNG.Rng(7), 2);
    same('同种子同参数 → 同一件装备（可复现）', again, t3);

    var powerSum1 = 0;
    var powerSum6 = 0;
    var sample = new G.RNG.Rng(5150);
    for (var i = 0; i < 50; i += 1) {
      powerSum1 += EQUIP_.generate(1, 10, sample, 0).power;
      powerSum6 += EQUIP_.generate(6, 10, sample, 0).power;
    }
    ok('6 阶战力远超 1 阶（同等级同平均）', powerSum6 > powerSum1 * 3, powerSum6 / 50 + ' vs ' + powerSum1 / 50);

    var loadout = EQUIP_.emptyLoadout();
    eq('空装备栏战力 0', EQUIP_.armoryPower(loadout), 0);
    loadout[t1.slotId] = t1;
    eq('穿上后战力 = 该件战力', EQUIP_.armoryPower(loadout), t1.power);
    var totals = EQUIP_.totalsOf(loadout);
    ok('属性汇总里有主属性', totals[t1.main.stat] >= t1.main.value, String(totals[t1.main.stat]));
    eq('格式化百分比词条', EQUIP_.formatValue('critChance', 0.043), '+4.3% 暴击率');
  }

  /* ---------------------------------------- 9. 玩家属性 / 移动 / 死亡 */

  function checkPlayer() {
    section('玩家属性汇总与移动（10-player.js）');
    var PLAYER_ = G.PLAYER;
    var EQUIP_ = G.EQUIP;

    var naked1 = PLAYER_.statsOf(1, null);
    eq('1 级裸装攻击 30', naked1.attack, 30);
    eq('1 级裸装生命 600', naked1.hpMax, 600);
    eq('1 级裸装防御 5', naked1.defense, 5);
    near('基础攻速 1.6', naked1.attackSpeed, 1.6, 1e-9);
    near('基础暴击率 5%', naked1.critChance, 0.05, 1e-9);
    eq('基础战力 0（没装备）', naked1.power, 0);
    eq('移动速度 210', naked1.moveSpeed, 210);

    var naked20 = PLAYER_.statsOf(20, null);
    eq('20 级攻击 = 30 + 2×19 = 68', naked20.attack, 68);
    eq('20 级生命 = 600 × 1.19 = 714', naked20.hpMax, 714);

    var loadout = EQUIP_.emptyLoadout();
    var weapon = EQUIP_.generate(1, 1, new G.RNG.Rng(3), 1);
    loadout[weapon.slotId] = weapon;
    if (weapon.slotId === 'weapon') {
      eq('装备攻击是加算（68 + 装备攻击）', PLAYER_.statsOf(20, loadout).attack, 68 + weapon.main.value);
    } else {
      ok('装备主属性已计入', PLAYER_.statsOf(20, loadout)[weapon.main.stat] !== undefined);
    }

    var player = PLAYER_.create({ level: 1, exp: 0, x: 0, y: 0, loadout: loadout });
    PLAYER_.move(player, 1, 0, 1, naked1);
    near('1 秒朝右走 = 移动速度（210）', player.x, 210, 0.0001);
    PLAYER_.move(player, 3, 4, 0.5, naked1);
    near('斜向输入被归一化（3,4 → 0.6/0.8，0.5 秒走 84）', player.y, 84, 0.0001);

    PLAYER_.hurt(player, 100, player.x - 10, player.y, 0);
    eq('受击扣血', player.hp, 600 - 100);
    eq('受击进入"战斗中"（hurtMs=320：100ms 仍在战、500ms 已脱战）', PLAYER_.inCombat(player, 100) && !PLAYER_.inCombat(player, 500), true);

    PLAYER_.hurt(player, 99999, player.x - 10, player.y, 5000);
    eq('血量归零即倒地', player.dead, true);
    eq('倒地后 3 秒复活', player.respawnAt, 5000 + BAL.player.respawnDelayMs);
    PLAYER_.respawn(player, naked1);
    eq('复活半血（600 × 0.5）', player.hp, 300);
    eq('复活后不再处于倒地状态', player.dead, false);
  }

  /* ---------------------------------------- 10. 本地存档 */

  function checkSave() {
    section('本地存档（11-save.js + 12-platform 的内存存档桩）');
    var SAVE_ = G.SAVE;
    var seed = BAL.season.worldSeed;

    var fresh = SAVE_.create(seed, 1);
    eq('新号 1 级', fresh.level, 1);
    eq('新号无宝箱', fresh.chests.length, 0);
    eq('新号保底计数为 0', fresh.pity.epic + fresh.pity.mythic, 0);
    eq('新号有 6 个装备栏', Object.keys(fresh.loadout).length, 6);
    ok('出生点可用（决策 #5：首次随机出生）', G.SPAWN.isUsableSpawn(fresh.x, fresh.y), fresh.x + ',' + fresh.y);

    var broken = SAVE_.normalize({ v: 1, level: 99, x: NaN, y: 0, chests: [{ tier: 9 }, { tier: 3, level: 8 }] }, seed, 1);
    eq('存档修复：非法箱阶被丢掉', broken.chests.length, 1);
    eq('存档修复：保留合法箱子', broken.chests[0].tier, 3);
    eq('存档修复：坏坐标回退到随机出生点', G.SPAWN.isUsableSpawn(broken.x, broken.y), true);
    eq('存档版本不符 → 当新号处理', SAVE_.normalize({ v: 0, level: 50 }, seed, 1).level, 1);
    eq('null 存档 → 当新号处理', SAVE_.normalize(null, seed, 1).level, 1);

    var save = SAVE_.create(seed, 2);
    save.level = 7;
    save.gold = 1234;
    SAVE_.pushChest(save, 3, 9);
    eq('宝箱入包', save.chests.length, 1);
    eq('宝箱记下掉落等级（决定装备强度）', save.chests[0].level, 9);

    var item = G.EQUIP.generate(2, 9, new G.RNG.Rng(4), 0);
    var assignedId = SAVE_.pushItem(save, item);
    eq('装备入包并分配 id', item.id, assignedId);
    eq('自增号已推进', save.nextItemId, assignedId + 1);

    SAVE_.write(save);
    var reloaded = SAVE_.load(seed, 2);
    eq('存档写入后能读回（等级）', reloaded.level, 7);
    eq('存档写入后能读回（金币）', reloaded.gold, 1234);
    eq('存档写入后能读回（宝箱）', reloaded.chests.length, 1);
    eq('背包里的装备也存下来了', reloaded.items.length, save.items.length);
    SAVE_.clear();
    eq('清档后回到 1 级新号', SAVE_.load(seed, 2).level, 1);
  }

  /* ---------------------------------------- 11. 地图设计：营地与小径路网 */

  function checkMap() {
    section('地图设计：营地与小径路网（04-terrain.js）');
    var seed = BAL.season.worldSeed;
    var T = G.TERRAIN;

    var camp = T.campCenter();
    eq('营地中心在原点', camp.x + ',' + camp.y, '0,0');
    eq('营地半径来自 balance', camp.radius, BAL.world.camp.radius);
    eq('原点在营地内', T.isInCamp(0, 0), true);
    eq('砖地边界内一点仍在营地内', T.isInCamp(camp.radius - 1, 0), true);
    eq('砖地外一点不在营地内', T.isInCamp(camp.radius + 1, 0), false);
    eq('负方向同样成立', T.isInCamp(-(camp.radius - 1), 0), true);
    ok('围栏半径 < 砖地半径（围栏立在砖地上）', BAL.world.camp.fenceRadius < camp.radius, BAL.world.camp.fenceRadius + ' / ' + camp.radius);

    var propsA = T.campProps();
    var propsB = T.campProps();
    ok('营地道具每次完全一致（手工摆位，无随机）', JSON.stringify(propsA) === JSON.stringify(propsB));
    ok(
      '营地道具都在砖地内、且比例合法',
      propsA.every(function (p) {
        return isFinite(p.x) && isFinite(p.y) && p.scale > 0 && T.isInCamp(p.x, p.y);
      }),
      propsA.length + ' 件'
    );
    ok(
      '营地道具含篝火与帐篷（一眼认得出这是营地）',
      propsA.some(function (p) { return p.kind === 'fire'; }) && propsA.some(function (p) { return p.kind === 'tent'; })
    );
    propsB.push({ kind: 'hacked' });
    eq('campProps 返回的是副本（改它不会污染地图形状）', T.campProps().length, propsA.length);

    eq('路网节点间距 = balance', T.roadSpanChunks(), BAL.world.road.spanChunks);

    var node = T.roadNodeFor(seed, 2, -3);
    same('同一个路网节点永远算在同一个位置', T.roadNodeFor(seed, 2, -3), node);
    var nodeSpan = T.roadSpanChunks() * G.CHUNK.CHUNK_SIZE;
    var jitter = BAL.world.road.jitterChunks * G.CHUNK.CHUNK_SIZE;
    ok(
      '节点落在网格交叉点 ± 抖动（所以原点附近就有路）',
      Math.abs(node.x - 2 * nodeSpan) <= jitter + 1e-6 && Math.abs(node.y + 3 * nodeSpan) <= jitter + 1e-6,
      node.x.toFixed(1) + ',' + node.y.toFixed(1)
    );
    ok('相邻两组的节点不重合', T.roadNodeFor(seed, 2, -3).x !== T.roadNodeFor(seed, 3, -3).x);

    var roads = T.roadsInRect(seed, -1000, -1000, 1000, 1000);
    ok('出生点附近确实有路（地图不是空的）', roads.length > 0, 'segments=' + roads.length);
    same('同一个矩形两次取路完全一致（确定性）', T.roadsInRect(seed, -1000, -1000, 1000, 1000), roads);
    ok(
      '每段都是有限的横/竖直线段（无 NaN、无零长）',
      roads.every(function (s) {
        return (
          isFinite(s.x1) && isFinite(s.y1) && isFinite(s.x2) && isFinite(s.y2) && (s.y1 === s.y2) !== (s.x1 === s.x2)
        );
      })
    );
    ok('每段宽度 = balance.world.road.width', roads.every(function (s) { return s.width === BAL.world.road.width; }));
    ok(
      '粗筛生效：远处的路不会被带回来',
      T.roadsInRect(seed, 100000, 100000, 101000, 101000).every(function (s) {
        return Math.min(s.x1, s.x2) <= 101000 + BAL.world.road.width * 4;
      })
    );
    ok('退化矩形不抛异常（返回数组即可）', Array.isArray(T.roadsInRect(seed, 0, 0, 0, 0)));
  }

  /* ---------------------------------------- 12. 角色外观与地图绘制 */

  function checkLook() {
    section('角色外观与地图绘制（16-render.js / 17-hud.js）');
    var R = G.RENDER;

    // 朝向：0=下 1=左下 2=左 3=左上 4=上 5=右上 6=右 7=右下
    eq('朝下 → 0', R.facingIndex({ x: 0, y: 1 }), 0);
    eq('朝左下 → 1', R.facingIndex({ x: -1, y: 1 }), 1);
    eq('朝左 → 2', R.facingIndex({ x: -1, y: 0 }), 2);
    eq('朝左上 → 3', R.facingIndex({ x: -1, y: -1 }), 3);
    eq('朝上 → 4', R.facingIndex({ x: 0, y: -1 }), 4);
    eq('朝右上 → 5', R.facingIndex({ x: 1, y: -1 }), 5);
    eq('朝右 → 6', R.facingIndex({ x: 1, y: 0 }), 6);
    eq('朝右下 → 7', R.facingIndex({ x: 1, y: 1 }), 7);
    eq('零向量退回朝下（不产生 NaN）', R.facingIndex({ x: 0, y: 0 }), 0);
    eq('坏输入也退回朝下', R.facingIndex(null), 0);
    ok('朝左三向要镜像画', R.facesLeft(1) && R.facesLeft(2) && R.facesLeft(3) && !R.facesLeft(6));
    ok('朝上三向不画脸（背对镜头）', R.facesAway(3) && R.facesAway(4) && R.facesAway(5) && !R.facesAway(0));

    // 走路 / 挥砍相位只由逻辑时间推出来（不用 Date.now，逻辑可重放）
    eq('站着不动时走路相位为 0', R.walkPhase(1234, false), 0);
    between('走路相位落在 [0,1)', R.walkPhase(777, true), 0, 0.999999);
    ok('相位随时间推进', R.walkPhase(500, true, 260) !== R.walkPhase(800, true, 260));
    eq('出手那一刻 = 相位 0（正在劈）', R.swingPhase(1000, 1000, 600), 0);
    eq('出手间隔走完 = 相位 1（收招）', R.swingPhase(1600, 1000, 600), 1);
    eq('很久没出手 = 相位 1（静止姿势）', R.swingPhase(9999, 1000, 600), 1);
    eq('从没出手过 = 相位 1', R.swingPhase(1000, 0, 600), 1);

    // 真画一遍新加的东西：营地 / 路网 / 小地图都必须在假 canvas 上画得出来
    var ctx = fakeContext();
    R.drawRoads(ctx, { x: 0, y: 0 });
    R.drawCamp(ctx, { x: 0, y: 0 });
    ok('营地 + 路网能画出来（不是空转）', ctx.calls.count > 0, 'calls=' + ctx.calls.count);

    // 走到很远的地方：营地不该再画任何东西（视野粗判必须生效，否则每帧白画十几个图元）
    var far = fakeContext();
    R.drawCamp(far, { x: 200000, y: 200000 });
    eq('离营地很远时营地的绘制调用为 0', far.calls.count, 0);

    var hud = fakeContext();
    G.HUD.drawMinimap(hud, { player: { x: 0, y: 0, facing: { x: 1, y: 0 } }, save: { guild: null } });
    ok('小地图能画出来', hud.calls.count > 0, 'calls=' + hud.calls.count);
  }

  /* ---------------------------------------- 13. 账号 / 昵称 / 界面 / 自动战斗（A4） */

  /**
   * 账号与昵称（用户要求"增加注册、登录、创建角色、输入昵称，昵称不能重复"）。
   * 这里只测**本机能验证的部分**：清洗规则、校验原因、本机注册表去重、账号落盘、v1→v2 迁移。
   * "跨设备唯一"要服务端（svr 的 /api/name），由 douyin-cloud\svr\smoke.mjs 负责。
   */
  function checkAccount() {
    section('账号与昵称（11-save.js 的 G.ACCOUNT）');
    var ACCOUNT = G.ACCOUNT;
    var CONFIG = G.CONFIG;
    eq('昵称最短 2 个字符', BAL.account.nameMin, 2);
    eq('昵称最长 12 个字符', BAL.account.nameMax, 12);

    // 清洗：空白与非法字符去掉，按**字符数**截断（中文算 1 个字符，不是 3 个字节）
    eq('清洗：去掉空格', ACCOUNT.sanitizeName(' 孤 影 '), '孤影');
    eq('清洗：去掉符号', ACCOUNT.sanitizeName('孤影!!!'), '孤影');
    eq('清洗：超长按字符截断', ACCOUNT.sanitizeName('一二三四五六七八九十十一十二十三').length, 12);
    eq('中文按字符数算', ACCOUNT.sanitizeName('孤影').length, 2);
    ok('大小写与空白不影响唯一性', ACCOUNT.nameKey('Alice') === ACCOUNT.nameKey(' alice '));

    // 校验：不同原因要分得清（界面据此给不同提示）
    eq('空昵称被拒', ACCOUNT.validate('').reason, 'empty');
    eq('一个字符被拒', ACCOUNT.validate('孤').reason, 'tooShort');
    eq('十三个字符被拒', ACCOUNT.validate('一二三四五六七八九十十一十二十三').reason, 'tooLong');
    eq('带符号被拒', ACCOUNT.validate('孤影!').reason, 'illegal');
    eq('保留名被拒', ACCOUNT.validate('管理员').reason, 'reserved');
    ok('正常昵称通过', ACCOUNT.validate('孤影99').ok === true);
    ok('原因都有中文说明', ACCOUNT.reasonText('taken').indexOf('占用') >= 0);

    // 本机注册表：占用过就拒绝第二次 —— 这是"昵称不能重复"的离线那一半
    G.PLAT.storageRemove(CONFIG.namesKey);
    ok('没注册过就能用', ACCOUNT.validate('猎手01').ok === true);
    ACCOUNT.remember('猎手01');
    eq('注册过就被拒', ACCOUNT.validate('猎手01').reason, 'taken');
    eq('注册表里有 1 个名字', ACCOUNT.localNameCount(), 1);
    ACCOUNT.remember('猎手01');
    eq('重复 remember 幂等', ACCOUNT.localNameCount(), 1);
    ACCOUNT.remember('Alice');
    eq('大小写不同也是同一个名字', ACCOUNT.validate('alice').reason, 'taken');
    ok('随机昵称一定能生成且可用', ACCOUNT.validate(ACCOUNT.suggest(20260930)).ok === true);
    ok('同一个时刻的随机昵称相同（可复现）', ACCOUNT.suggest(7) === ACCOUNT.suggest(7));

    // 账号记录：没起名 = 还没注册完（load 返回 null），起名后才算数
    ACCOUNT.forget();
    ok('清掉账号后读不到', ACCOUNT.load() === null);
    var account = ACCOUNT.create({ name: '孤影99', mode: 'local', at: 1234 });
    ok('persist 落盘成功', ACCOUNT.persist(account) === true);
    var reloaded = ACCOUNT.load();
    ok('账号能读回', !!reloaded && reloaded.name === '孤影99', reloaded ? reloaded.name : 'null');
    eq('账号 id 有兜底值', reloaded.id.indexOf('local-'), 0);
    ok('persist 顺手登记昵称', ACCOUNT.takenLocally('孤影99'));
    var upgraded = ACCOUNT.update(reloaded, { mode: 'douyin', openid: 'o-1', token: 't-1', at: 2000 });
    ok('update 能补上 openid/token', ACCOUNT.load().openid === 'o-1' && upgraded.token === 't-1');
    eq('update 不覆盖创建时间', ACCOUNT.load().createdAt, 1234);

    // 存档 v1 → v2 迁移：只补 name / settings，等级金币宝箱一件不丢
    var v1 = {
      v: 1,
      level: 9,
      exp: 123,
      gold: 456,
      chests: [{ tier: 3, level: 5 }],
      pity: { epic: 4, mythic: 5 },
      horns: 2,
      stats: { kills: 7 }
    };
    var migrated = G.SAVE.normalize(v1, BAL.season.worldSeed, 1);
    eq('v1 存档迁移后版本 = 2', migrated.v, 2);
    eq('迁移不丢等级', migrated.level, 9);
    eq('迁移不丢金币', migrated.gold, 456);
    eq('迁移不丢宝箱', migrated.chests.length, 1);
    eq('迁移不丢号角', migrated.horns, 2);
    eq('迁移补上角色名（空 = 还没建角色）', migrated.name, '');
    eq('迁移补上设置项（自动战斗默认关）', migrated.settings.autoBattle, false);
    eq('认不出的版本照样开新号（不白屏）', G.SAVE.normalize({ v: 99, level: 5 }, BAL.season.worldSeed, 1).level, 1);
    eq('音效默认开', G.SAVE.normalize({ v: 2, settings: {} }, BAL.season.worldSeed, 1).settings.sfx, true);
    eq('写了 false 才关', G.SAVE.normalize({ v: 2, settings: { sfx: false } }, BAL.season.worldSeed, 1).settings.sfx, false);
    eq('坏设置不炸（回默认值）', G.SAVE.normalize({ v: 2, settings: 'nope' }, BAL.season.worldSeed, 1).settings.vibrate, true);
  }

  /**
   * 界面（用户要求三条）：面板只占 1/3 屏、有关闭按钮、打开时游戏不停止；
   * 另外验证登录 / 创建角色界面的按钮能产生正确的 action（界面逻辑不能只靠肉眼）。
   */
  function checkUi() {
    section('界面：卡片大小 / 关闭键 / 滚动 / 登录界面（A4）');
    var card = G.PANELS.rect();
    var ratio = (card.w * card.h) / (G.SCREEN.width() * G.SCREEN.height());
    between('面板卡片面积约为 1/3 屏', ratio, 0.28, 0.38);
    ok(
      '卡片完整落在屏幕内',
      card.x >= 0 && card.y >= 0 && card.x + card.w <= G.SCREEN.width() && card.y + card.h <= G.SCREEN.height(),
      JSON.stringify(card)
    );
    ok('卡片没有铺满屏幕', card.w < G.SCREEN.width() * 0.9 && card.h < G.SCREEN.height() * 0.6);

    var hudButtons = G.HUD.buttons({ save: { chests: [], items: [], guild: null, settings: { autoBattle: false } } });
    eq('右下功能键 5 个（多了「自动」）', hudButtons.length, 5);
    eq('「自动」按钮在最下（拇指位）', hudButtons[4].id, 'auto');
    var leftmost = hudButtons[0].x - hudButtons[0].r;
    ok('卡片与功能键不重叠', card.x + card.w <= leftmost + 1, Math.round(card.x + card.w) + ' vs ' + Math.round(leftmost));
    var expTop = G.SCREEN.height() - G.SCREEN.safeBottom() - BAL.view.hud.expBarHeight;
    ok(
      '经验条在最下方（在功能键下面）',
      expTop >= hudButtons[0].y + hudButtons[0].r,
      expTop + ' vs ' + Math.round(hudButtons[0].y + hudButtons[0].r)
    );
    ok('自动按钮带状态（开着会点亮）', hudButtons[4].state === 'off' && hudButtons[4].label.length > 0, hudButtons[4].label);

    // 假存档（12 件装备 → 背包内容一定比卡片长，才测得出滚动）
    var items = [];
    for (var k = 0; k < 12; k += 1) {
      items.push({ id: k + 1, tier: (k % 6) + 1, slotId: 'weapon', slotName: '武器', power: 10 + k, reqLevel: 1 });
    }
    var save = {
      level: 3,
      gold: 0,
      exp: 0,
      chests: [],
      items: items,
      loadout: {},
      pity: { epic: 0, mythic: 0 },
      guild: null,
      name: '自检者',
      settings: { autoBattle: false },
      stats: { kills: 0, eliteKills: 0, opened: 0 }
    };
    var view = {
      save: save,
      player: { x: 0, y: 0, hp: 100, dead: false },
      stats: { power: 0, hpMax: 100 },
      now: 0,
      buttons: hudButtons
    };

    // 命中范围：卡片内归面板，卡片外留给摇杆（这是"打开面板还能走位"的前提）
    G.PANELS.open('bag');
    var inside = { x: card.x + card.w / 2, y: card.y + card.h / 2 };
    var outside = { x: card.x + card.w / 2, y: card.y + card.h + 60 };
    ok('卡片中心属于面板', G.PANELS.contains(inside));
    ok('卡片下方的触摸不属于面板（留给摇杆）', !G.PANELS.contains(outside), JSON.stringify(outside));
    G.PANELS.close();
    ok('没开面板时不属于面板', !G.PANELS.contains(inside));

    // 关闭键：在卡片里，点击要能产生 close
    G.PANELS.open('bag');
    var close = G.PANELS.buttons()[0];
    ok('关闭键存在且在卡片内', close.id === 'panel:close' && G.PANELS.contains({ x: close.x, y: close.y }), close.label);
    G.PANELS.press({ x: close.x, y: close.y }, view);
    var closeAction = G.PANELS.release({ x: close.x, y: close.y }, view);
    ok('点关闭键 → { type: close }', !!closeAction && closeAction.type === 'close');

    // 滚动：内容超过视口才能滚，且夹在 [0, maxScroll]
    G.PANELS.open('bag');
    var limit = G.PANELS.maxScroll(view);
    ok('背包内容比卡片长（能滚）', limit > 0, String(limit));
    eq('滚动从 0 开始', G.PANELS.scrollOffset(), 0);
    eq('向上超界夹到 0', G.PANELS.setScroll(-500, view), 0);
    eq('向下超界夹到上限', G.PANELS.setScroll(limit + 500, view), limit);
    G.PANELS.setScroll(limit / 2, view);
    ok(
      '滚动后行坐标跟着变（画与点同一份坐标）',
      Math.round(G.PANELS.rows(view)[0].y) === Math.round(G.PANELS.buildRows(view)[0].y - limit / 2)
    );
    var firstRow = G.PANELS.rows(view)[0];
    G.PANELS.press({ x: card.x + card.w / 2, y: firstRow.y + 20 }, view);
    G.PANELS.move({ x: card.x + card.w / 2, y: firstRow.y - 20 }, view);
    ok('拖动算滚动，松手不触发任何 action', G.PANELS.release({ x: card.x + card.w / 2, y: firstRow.y - 20 }, view) === null);

    // 卡片能真的画出来（含 clip 路径 —— 老画法是全屏覆盖，不需要裁剪）
    var panelCtx = fakeContext();
    G.PANELS.draw(panelCtx, view);
    ok('面板卡片能画出来', panelCtx.calls.count > 20, 'calls=' + panelCtx.calls.count);
    G.PANELS.close();
    // 登录 / 创建角色界面
    var login = G.LOGIN;
    login.open('welcome');
    eq('欢迎界面有 2 个按钮', login.buttons().length, 2);
    eq('欢迎界面第一个是登录', login.buttons()[0].id, 'login');
    login.press({ x: login.buttons()[0].x + 5, y: login.buttons()[0].y + 5 });
    var loginAction = login.release({ x: login.buttons()[0].x + 5, y: login.buttons()[0].y + 5 });
    ok('点登录 → { type: login }', !!loginAction && loginAction.type === 'login');

    // 清账号要两次点击（第一步只是"上膛"）
    login.open('welcome');
    var clearButton = login.buttons()[1];
    login.press({ x: clearButton.x + 5, y: clearButton.y + 5 });
    eq('第一次点清账号不产生 action', login.release({ x: clearButton.x + 5, y: clearButton.y + 5 }), null);
    ok('第二次进入上膛态', login.isArmed());
    login.press({ x: clearButton.x + 5, y: clearButton.y + 5 });
    var clearAction = login.release({ x: clearButton.x + 5, y: clearButton.y + 5 });
    ok('再点一次才返回 newAccount', !!clearAction && clearAction.type === 'newAccount');

    // 创建角色界面：输入昵称 / 换一个 / 创建角色
    login.open('createRole');
    eq('创建角色界面有 3 个按钮', login.buttons().length, 3);
    eq(
      '按钮依次是 输入昵称 / 换一个 / 创建角色',
      login.buttons().map(function (button) { return button.id; }).join(','),
      'typeName,randomName,createRole'
    );
    ok('一进来就有一个随机昵称', login.draftName().length >= BAL.account.nameMin, login.draftName());
    var before = login.draftName();
    login.randomName(12345);
    ok('「换一个」能换出另一个昵称', login.draftName() !== before, before + ' -> ' + login.draftName());
    login.setDraftName(' 非法!名字 ');
    eq('输入框里的非法字符会被清掉', login.draftName(), '非法名字');
    var createButton = login.buttons()[2];
    login.press({ x: createButton.x + 5, y: createButton.y + 5 });
    var createAction = login.release({ x: createButton.x + 5, y: createButton.y + 5 });
    ok('点「创建角色」→ { type: createRole }', !!createAction && createAction.type === 'createRole');

    var loginCtx = fakeContext();
    login.draw(loginCtx, { save: save, account: null, stats: view.stats });
    ok('创建角色界面能画出来（防白屏）', loginCtx.calls.count > 20, 'calls=' + loginCtx.calls.count);
    login.open('welcome');
    var welcomeCtx = fakeContext();
    login.draw(welcomeCtx, { save: save, account: { name: '自检者', mode: 'local' }, stats: view.stats });
    ok('欢迎界面能画出来（防白屏）', welcomeCtx.calls.count > 20, 'calls=' + welcomeCtx.calls.count);
  }

  /**
   * 自动战斗按钮（用户要求："设置为按钮，点击开启；自动战斗时不仅会自动释放技能，
   * 还会自动走向最近的怪物"）。出手本来就是自动的（14-world.playerAttack），
   * 这里验的是**走位**那一半：目标选择、站住的时机、手动优先、开关写进存档。
   */
  function checkAuto() {
    section('自动战斗按钮（走位 / 手动优先 / 开关持久化）');
    var GAME = G.GAME;
    if (!GAME || typeof GAME.autoStep !== 'function') {
      ok('G.GAME 可用（20-main.js 已拼入）', false, '拿不到 GAME');
      return;
    }
    G.SAVE.clear();
    GAME.boot();
    GAME.beginPlaying('自检者');
    eq('创建角色后进入游戏界面', GAME.state.screen, 'playing');
    eq('存档里记下了角色名', GAME.state.save.name, '自检者');
    ok('昵称已登记进本机注册表', G.ACCOUNT.takenLocally('自检者'));

    // 开关默认关（"点击开启"），点一下开、再点一下关，并且写进存档（重开游戏还记得）
    eq('自动战斗默认关', GAME.state.save.settings.autoBattle, false);
    eq('点一次开启', GAME.toggleAutoBattle(), true);
    ok('开关写进了存档', G.SAVE.load(BAL.season.worldSeed, 1).settings.autoBattle === true);
    eq('再点一次关闭', GAME.toggleAutoBattle(), false);

    // 走位：把周边 chunk 装出来，然后只跑 autoStep（怪不跑 AI，落点才可断言）
    var player = GAME.state.player;
    var stats = GAME.state.stats;
    G.WORLD.ensureChunks(player.x, player.y, 2);
    var target = G.WORLD.pickTarget(player);
    ok('视野内选到了最近的怪', !!target);
    if (target) {
      var dxBefore = target.x - player.x;
      var dyBefore = target.y - player.y;
      var before = Math.sqrt(dxBefore * dxBefore + dyBefore * dyBefore);
      for (var i = 0; i < 240; i += 1) GAME.autoStep(player, stats, 1000 / 60);
      var dxAfter = target.x - player.x;
      var dyAfter = target.y - player.y;
      var after = Math.sqrt(dxAfter * dxAfter + dyAfter * dyAfter);
      var reach = target.radius + BAL.player.attackRange * BAL.auto.moveStopRatio;
      ok('自动走向最近的怪（距离变小）', after < before, Math.round(before) + ' -> ' + Math.round(after));
      ok('停在攻击距离上（不会叠进怪里）', after <= reach + 1, Math.round(after) + ' <= ' + Math.round(reach) + '+1');
      ok('停住时仍面向目标', player.facing.x * dxAfter + player.facing.y * dyAfter > 0);
      eq('目标记在 player.targetId 上（与出手共用同一只怪）', player.targetId, target.id);
    }
    ok('坐标没有 NaN / Infinity', isFinite(player.x) && isFinite(player.y));

    // 手动优先：摇杆推着的时候，step() 不该走"自动走位"那条分支
    GAME.state.save.settings.autoBattle = true;
    var stick = G.INPUT.state.stick;
    var x0 = player.x;
    stick.active = true;
    stick.dx = -1;
    stick.dy = 0;
    stick.magnitude = 1;
    GAME.step(1000 / 60);
    ok('手动摇杆优先于自动走位', player.x < x0, Math.round(x0) + ' -> ' + Math.round(player.x));
    stick.active = false;
    stick.dx = 0;
    stick.dy = 0;
    stick.magnitude = 0;
    GAME.state.save.settings.autoBattle = false;
  }

  /**
   * 打击感（用户要求"斩击特效 / 受击顿帧 / 暴击震屏"）。
   * 三件事都能在 node 里断言：特效到期会消失、顿帧按时长分档、震屏是纯函数；
   * 顿帧是否真的"冻住世界"也可以直接跑两步看世界时间。
   */
  function checkFeel() {
    section('打击感：斩击特效 / 受击顿帧 / 暴击震屏（A4）');
    var GAME = G.GAME;
    var WORLD = G.WORLD;
    between('斩击特效时长在 0.1~0.5 秒', BAL.view.slashMs, 100, 500);
    between('特效数量有上限（挂机不会堆爆）', BAL.view.slashCap, 4, 64);
    ok(
      '顿帧分档：普通 < 暴击，且都在 20~150ms',
      BAL.view.hitStopMs.normal < BAL.view.hitStopMs.crit && BAL.view.hitStopMs.normal >= 20 && BAL.view.hitStopMs.crit <= 150,
      BAL.view.hitStopMs.normal + ' / ' + BAL.view.hitStopMs.crit
    );
    ok('暴击震屏幅度 > 挨打震屏幅度', BAL.view.shake.critPower > BAL.view.shake.hurtPower);
    ok('挨打顿帧不长于普通命中（挨打只要一顿，不要卡）', BAL.view.hitStopMs.hurt <= BAL.view.hitStopMs.normal);

    if (!GAME || typeof GAME.applyHitFeedback !== 'function') {
      ok('G.GAME 可用（20-main.js 已拼入）', false, '拿不到 GAME');
      return;
    }
    G.SAVE.clear();
    GAME.boot();
    GAME.beginPlaying('打击感测试者');
    GAME.state.hitStopMs = 0;
    GAME.state.shake.power = 0;

    // 顿帧 + 震屏：直接喂 events，不用真去打一只怪（这就是把反馈做成函数的原因）
    var plain = GAME.applyHitFeedback({ hits: [{ damage: 10, crit: false }], playerHits: [] });
    eq('普通命中顿帧 = balance 值', plain.stop, BAL.view.hitStopMs.normal);
    eq('普通命中不震屏', GAME.state.shake.power, 0);

    GAME.state.hitStopMs = 0;
    var crit = GAME.applyHitFeedback({ hits: [{ damage: 99, crit: true }], playerHits: [] });
    eq('暴击顿帧 = balance 值且更长', crit.stop, BAL.view.hitStopMs.crit);
    ok('暴击比普通更"咬手"', crit.stop > plain.stop, crit.stop + ' > ' + plain.stop);
    eq('暴击开启震屏（幅度取 balance）', GAME.state.shake.power, BAL.view.shake.critPower);
    var mid = GAME.state.shake.until - GAME.state.shake.ms / 2;
    var offset = GAME.shakeOffset(mid);
    ok('震屏期间有位移', Math.abs(offset.x) + Math.abs(offset.y) > 0, JSON.stringify(offset));
    ok('震屏幅度不超过设定值', Math.abs(offset.x) <= BAL.view.shake.critPower + 0.001);
    var gone = GAME.shakeOffset(GAME.state.shake.until + 1);
    eq('震屏到点归零（x）', gone.x, 0);
    eq('震屏到点归零（y）', gone.y, 0);

    GAME.state.hitStopMs = 0;
    var hurt = GAME.applyHitFeedback({ hits: [], playerHits: [{ damage: 5 }] });
    eq('挨打也有顿帧', hurt.stop, BAL.view.hitStopMs.hurt);
    eq('挨打震一下（幅度更小）', GAME.state.shake.power, BAL.view.shake.hurtPower);

    // 顿帧真的会冻住世界
    GAME.state.hitStopMs = 100;
    var beforeStop = WORLD.now();
    GAME.step(1000 / 60);
    eq('顿帧期间世界时间不推进', WORLD.now(), beforeStop);
    GAME.state.hitStopMs = 0;
    GAME.step(1000 / 60);
    ok('顿帧结束后世界继续跑', WORLD.now() > beforeStop);

    // 斩击特效：开着自动战斗打一会儿，必然会看到刀光
    GAME.state.save.settings.autoBattle = true;
    var sawEffect = false;
    var i;
    for (i = 0; i < 1800 && !sawEffect; i += 1) {
      GAME.step(1000 / 60);
      if (WORLD.effects().length > 0) sawEffect = true;
    }
    ok('打架时会生成斩击特效', sawEffect, '特效数 ' + WORLD.effects().length);
    ok('特效数量不超上限', WORLD.effects().length <= BAL.view.slashCap, String(WORLD.effects().length));
    GAME.state.save.settings.autoBattle = false;

    // 画得出来 / 到期不画（假 canvas 能验"特效没白画，也不会画过期的东西"）
    var live = fakeContext();
    G.RENDER.drawEffects(
      live,
      { x: 0, y: 0 },
      [{ kind: 'slash', x: 0, y: 0, dirX: 1, dirY: 0, radius: 80, crit: true, startAt: WORLD.now(), until: WORLD.now() + 200 }],
      WORLD.now()
    );
    ok('斩击特效（含暴击光刺）画得出来', live.calls.count > 0, 'calls=' + live.calls.count);
    var dead = fakeContext();
    G.RENDER.drawEffects(
      dead,
      { x: 0, y: 0 },
      [{ kind: 'slash', x: 0, y: 0, dirX: 1, dirY: 0, radius: 80, crit: false, startAt: 0, until: 1 }],
      WORLD.now()
    );
    eq('过期特效不画任何东西（省落笔）', dead.calls.count, 0);
    for (i = 0; i < 90; i += 1) GAME.step(1000 / 60);
    ok('旧特效会被清掉（数组不会一直涨）', WORLD.effects().length <= 6, String(WORLD.effects().length));
  }

  /**
   * 音效与 BGM（用户要求"音效与 BGM"）。
   * 声音文件由 tools\gen-minigame-sfx.mjs 生成，路径写在 12-platform.js；这里验清单、开关与"没 tt 不炸"。
   * 真机上"响不响"只能靠耳朵，所以这一组保证的是**代码路径与开关逻辑**是对的。
   */
  function checkAudio() {
    section('音效与 BGM（12-platform.js 的 PLAT.sfx / PLAT.bgm）');
    between('音效音量在 0..1', BAL.audio.sfxVolume, 0, 1);
    ok(
      'BGM 音量不高于音效（别盖过打击反馈）',
      BAL.audio.bgmVolume <= BAL.audio.sfxVolume,
      BAL.audio.bgmVolume + ' vs ' + BAL.audio.sfxVolume
    );
    ok('音频总开关是显式布尔', BAL.audio.enabled === true || BAL.audio.enabled === false);

    var state = G.PLAT.audioState();
    eq('音频清单 = 8 个音效 + BGM', state.files.length, 9);
    var allKeys = true;
    var i;
    for (i = 0; i < state.files.length; i += 1) {
      if (!/^[a-z]+$/.test(state.files[i])) allKeys = false;
    }
    ok('清单里都是纯小写键名（路径由平台层拼）', allKeys, state.files.join(','));
    ok('没配 tt 时报告"不支持音频"', state.supported === false, String(state.supported));
    eq('没配 tt 时播音效静默返回 false（不抛）', G.PLAT.sfx('hit'), false);
    eq('没配 tt 时播 BGM 也静默返回 false', G.PLAT.bgm(true), false);
    eq('没配 tt 时停 BGM 静默返回 false', G.PLAT.stopBgm(), false);

    // 设置推下去：关掉音效 → 连平台层都不进
    G.PLAT.setAudio({ enabled: true, sfxEnabled: false, sfxVolume: 0.5, bgmVolume: 0.2 });
    var muted = G.PLAT.audioState();
    eq('关掉音效后 sfx 直接返回 false', G.PLAT.sfx('hit'), false);
    eq('音效音量被记下来（0.5）', muted.sfxVolume, 0.5);
    eq('BGM 音量被记下来（0.2）', muted.bgmVolume, 0.2);
    G.PLAT.setAudio({ sfxEnabled: true, sfxVolume: BAL.audio.sfxVolume, bgmVolume: BAL.audio.bgmVolume });

    // 设置面板的三个开关：写进存档 + 读得回来
    G.SAVE.clear();
    G.GAME.boot();
    G.GAME.beginPlaying('音频测试者');
    ok('音效默认开（老存档也当开）', G.GAME.state.save.settings.sfx === true);
    G.GAME.toggleSetting('sfx');
    eq('点一下关掉音效', G.GAME.state.save.settings.sfx, false);
    eq('关掉后写进了存档', G.SAVE.load(BAL.season.worldSeed, 1).settings.sfx, false);
    G.GAME.toggleSetting('sfx');
    eq('再点一下开回来', G.GAME.state.save.settings.sfx, true);
    G.GAME.toggleSetting('bgm');
    eq('BGM 能关', G.GAME.state.save.settings.bgm, false);
    G.GAME.toggleSetting('bgm');
    eq('BGM 能开回来', G.GAME.state.save.settings.bgm, true);
    G.GAME.toggleSetting('vibrate');
    eq('震动能关', G.GAME.state.save.settings.vibrate, false);
    G.GAME.toggleSetting('vibrate');
    eq('未知键返回 null（不会误改设置）', G.GAME.toggleSetting('nope'), null);
    var view = G.GAME.uiView();
    ok('uiView 带音频状态（设置面板要显示当前开关）', !!view.audio && view.audio.files.length === 9);
  }

  /* ---------------------------------------- 13. 冒烟：假 canvas 跑真帧 */

  /**
   * 假 canvas 上下文：只数调用次数，其余全是 no-op。
   * 它把"一进游戏就白屏 / 坐标全是 NaN"这类**只在真帧里暴露**的 bug 变成一条断言
   * ——上一版工程就是"静态检查全过、一进游戏白屏"，这是唯一的自动化防线。
   */
  function fakeContext() {
    var calls = { count: 0 };
    var noop = function () {
      calls.count += 1;
    };
    var ctx = {
      calls: calls,
      fillStyle: '#000000',
      strokeStyle: '#000000',
      lineWidth: 1,
      font: '10px sans-serif',
      textAlign: 'left',
      textBaseline: 'top',
      globalAlpha: 1
    };
    var names = [
      'save', 'restore', 'beginPath', 'closePath', 'fill', 'stroke', 'moveTo', 'lineTo',
      'arc', 'fillRect', 'strokeRect', 'clearRect', 'fillText', 'strokeText',
      'setTransform', 'translate', 'scale', 'rotate', 'clip', 'drawImage'
    ];
    for (var i = 0; i < names.length; i += 1) ctx[names[i]] = noop;
    ctx.measureText = function (text) {
      calls.count += 1;
      return { width: String(text).length * 10 };
    };
    return ctx;
  }

  /** 冒烟主体：新号 → boot → 先探索再站桩打怪 → 连画 31 帧 → 看账 */
  function smokeBody() {
    section('冒烟：假 canvas 跑 2100 步（走 10 秒 + 站桩 25 秒）');
    var GAME = G.GAME;
    if (!GAME || typeof GAME.boot !== 'function') {
      ok('G.GAME 可用（20-main.js 已拼入）', false, '拿不到 GAME');
      return;
    }
    var ctx = fakeContext();
    var world = G.WORLD;

    G.SAVE.clear(); // 干净起点（node 里 PLAT 的 storage 就是内存桩）
    GAME.boot();
    // A4：进入游戏要经过"登录 → 创建角色"，这条路就是界面上按「创建角色并进入游戏」走的那条
    GAME.beginPlaying('冒烟测试者');

    var player = GAME.state.player;
    ok('创建角色之后进入游戏界面', GAME.state.screen === 'playing', GAME.state.screen);
    ok('存档里记下了角色名（HUD / 头顶名牌要用）', GAME.state.save.name === '冒烟测试者', GAME.state.save.name);
    var startX = player.x;
    var startY = player.y;

    // 把摇杆"推到底、朝右下"（等价于手指按住不放），走完整的输入路径
    var stick = G.INPUT.state.stick;
    stick.active = true;
    stick.dx = 0.7071;
    stick.dy = 0.7071;
    stick.magnitude = 1;

    // 第一阶段：边走边找（600 步 ≈ 10 秒）—— 把周边 chunk 装出来、让怪进仇恨
    var stepsMove = 600;
    var sawMonster = false;
    var i;
    for (i = 0; i < stepsMove; i += 1) {
      GAME.step(1000 / 60);
      if (world.monstersInView().length > 0) sawMonster = true;
    }

    // 第二阶段：松手站桩（1500 步 ≈ 25 秒）—— 这才是自动战斗的真实场景：
    // 不推方向，怪会自己送上门，攻击范围内就自动开打（决策 #7 的"操作只剩移动"）
    stick.active = false;
    stick.dx = 0;
    stick.dy = 0;
    stick.magnitude = 0;
    for (i = 0; i < 1500; i += 1) {
      GAME.step(1000 / 60);
      if (world.monstersInView().length > 0) sawMonster = true;
    }

    for (i = 0; i < 31; i += 1) GAME.renderTo(ctx);

    // A4："打开面板游戏不停止" —— 面板开着连跑 60 个逻辑帧，世界时间必须照旧推进
    var worldBefore = world.now();
    G.PANELS.open('menu');
    for (i = 0; i < 60; i += 1) GAME.step(1000 / 60);
    ok('面板开着世界照旧推进（游戏不停止）', world.now() > worldBefore + 900, 'Δt=' + Math.round(world.now() - worldBefore));
    G.PANELS.close();

    var movedX = player.x - startX;
    var movedY = player.y - startY;
    var moved = Math.sqrt(movedX * movedX + movedY * movedY);
    var save = GAME.state.save;
    GAME.writeSave(); // 之前的断言只跑了逻辑步，没走 frame()，所以这里显式存一次
    var reloaded = G.SAVE.load(BAL.season.worldSeed, 1);

    ok('35 秒（走 10 秒 + 站桩 25 秒）跑完没抛异常', true);
    ok('视野里出现过怪（地图确实在生成内容）', sawMonster);
    ok('玩家确实移动了（摇杆 → 位移）', moved > 500, '位移 ' + Math.round(moved));
    ok('坐标没有 NaN / Infinity', isFinite(player.x) && isFinite(player.y));
    ok('站桩期间打死了怪（自动战斗真的在打）', save.stats.kills >= 1, 'kills=' + save.stats.kills);
    ok('等级被推上去了（经验结算生效，至少 Lv.2）', save.level >= 2, 'Lv.' + save.level);
    ok('渲染产生了真实绘制调用（防白屏）', ctx.calls.count > 500, 'calls=' + ctx.calls.count);
    ok(
      '已装载 chunk 不超上限',
      world.loadedChunkCount() <= BAL.view.chunkCacheLimit,
      world.loadedChunkCount() + ' / ' + BAL.view.chunkCacheLimit
    );
    ok('活跃怪受"只模拟附近"约束（≤ 60）', world.activeMonsterCount() <= 60, String(world.activeMonsterCount()));
    ok('经验 / 金币 / 宝箱至少动过一次', save.exp > 0 || save.gold > 0 || save.chests.length > 0);
    ok('存档写出后能读回同一等级', reloaded.level === save.level, reloaded.level + ' vs ' + save.level);
    stick.active = false;
    stick.dx = 0;
    stick.dy = 0;
    stick.magnitude = 0;
  }

  /**
   * 跑冒烟并把结果单独返回（不动 runAll 的统计）。
   * 只给 node / 命令行用：它会 `boot()`（重置世界 + 读档），在正在运行的游戏里调会影响进度，
   * 所以面板上的「自检」只跑 runAll()。
   */
  function runSmoke() {
    var saved = { checks: state.checks, failures: state.failures, lines: state.lines };
    state.checks = 0;
    state.failures = 0;
    state.lines = [];
    try {
      smokeBody();
    } catch (error) {
      ok('冒烟未抛异常', false, String(error && error.stack ? String(error.stack).split('\n')[0] : error));
    }
    var result = { checks: state.checks, failures: state.failures, lines: state.lines };
    state.checks = saved.checks;
    state.failures = saved.failures;
    state.lines = saved.lines;
    return result;
  }

  /**
   * 全部断言（游戏内面板与 tools\minigame-selftest.mjs 共用）。
   * 每组单独 try/catch：一组炸了不影响其它组，报错里能看出是哪一组。
   */
  function runAll() {
    reset();
    var groups = [
      checkBalance,
      checkChunk,
      checkTerrain,
      checkSpawn,
      checkProgression,
      checkCombat,
      checkLoot,
      checkEquipment,
      checkPlayer,
      checkSave,
      checkAccount,
      checkUi,
      checkMap,
      checkLook,
      checkAuto,
      checkFeel,
      checkAudio
    ];
    for (var i = 0; i < groups.length; i += 1) {
      try {
        groups[i]();
      } catch (error) {
        ok('分组「' + (groups[i].name || '匿名') + '」未抛异常', false, String(error && error.message ? error.message : error));
      }
    }

    section('世界指纹（跨实现回归网）');
    var fingerprint = worldFingerprint(BAL.season.worldSeed);
    if (GOLDEN_FINGERPRINT === 'PENDING') {
      log('  info  当前世界指纹 = ' + fingerprint);
      log('  info  首次运行：把上面这行抄回本文件的 GOLDEN_FINGERPRINT');
      state.checks += 1;
    } else {
      eq('世界指纹与基准一致（防浮点 / 三角函数 / 随机源漂移）', fingerprint, GOLDEN_FINGERPRINT);
      ok('基准值与 TypeScript 侧一致（e9802f11）', GOLDEN_FINGERPRINT === 'e9802f11', GOLDEN_FINGERPRINT);
    }

    log('');
    log('提示：渲染冒烟用 tools\\minigame-now.cmd 跑（node 会调 runSmoke；面板里只跑 runAll）。');

    return {
      checks: state.checks,
      failures: state.failures,
      lines: state.lines.slice(),
      fingerprint: fingerprint
    };
  }

  return {
    GOLDEN_FINGERPRINT: GOLDEN_FINGERPRINT,
    fingerprintOf: fingerprintOf,
    worldFingerprint: worldFingerprint,
    reset: reset,
    state: state,
    fakeContext: fakeContext,
    checkBalance: checkBalance,
    checkChunk: checkChunk,
    checkTerrain: checkTerrain,
    checkSpawn: checkSpawn,
    checkProgression: checkProgression,
    checkCombat: checkCombat,
    checkLoot: checkLoot,
    checkEquipment: checkEquipment,
    checkPlayer: checkPlayer,
    checkSave: checkSave,
    checkAccount: checkAccount,
    checkUi: checkUi,
    checkAuto: checkAuto,
    checkFeel: checkFeel,
    checkAudio: checkAudio,
    checkMap: checkMap,
    checkLook: checkLook,
    runSmoke: runSmoke,
    runAll: runAll
  };
})();

/**
 * 20-main.js —— 入口：流程状态机 + 固定步长主循环 + 玩法结算 + 触摸路由
 *
 * 主循环的规矩（上一版吃过亏的地方）：
 *   - **逻辑固定 60Hz、渲染跟着屏幕刷新**：手机上掉帧时逻辑不会变慢，手感与数值才稳定；
 *   - 单帧最多追赶 `CONFIG.maxCatchUpSteps` 步：切后台回来不会"一顿狂算"把怪全打一遍；
 *   - 时钟只在这里读（`Date.now` 仅允许出现在 12 / 20 两个文件，静态检查卡这条），
 *     逻辑层自己维护 `WORLD.now()`，所以逻辑可重放、能在 node 里断言。
 *
 * 触摸路由（只此一处，修上一版"点 UI 顺带攻击"的 bug）：
 *   ① 界面在登录 / 创建角色 → G.LOGIN 吃；
 *   ② 面板卡片开着且这一点落在**卡片里**（或关闭键上）→ 18-panels 吃；
 *   ③ 其余一律给 15-input（摇杆 + 右下圆形功能键）。
 *   第 ② 条的"卡片里"是 A4 的关键：卡片只占 1/3 屏，**卡片外面照旧能推摇杆**，
 *   加上 step() 不再因为面板开着而 return，"打开背包 / 设置时游戏不停止"才真的成立。
 *
 * 界面状态机（A4）：'welcome'（登录）→ 'createRole'（创建角色 / 输入昵称）→ 'playing'。
 *   只有 'playing' 才跑世界逻辑，登录界面上的世界是静止的（还没登录，不该被怪打）。
 *
 * 玩法结算（经验 / 金币 / 掉箱 / 开箱 / 装备 / 商城 / 公会）放在这里的原因：
 *   它是**改存档的唯一地方**。阶段 B 起把这些函数原样搬到服务端即可 ——
 *   抽奖用的 rng 已经是传入的，接口一行都不用改（决策 #1 的前提）。
 */

G.GAME = (function () {
  'use strict';

  var BAL = G.BAL;
  var CONFIG = G.CONFIG;
  var PLAT = G.PLAT;
  var SCREEN = G.SCREEN;
  var WORLD = G.WORLD;
  var PLAYER = G.PLAYER;
  var PROG = G.PROG;
  var LOOT = G.LOOT;
  var EQUIP = G.EQUIP;
  var SAVE = G.SAVE;
  var INPUT = G.INPUT;
  var HUD = G.HUD;
  var PANELS = G.PANELS;
  var RENDER = G.RENDER;

  var STEP_MS = 1000 / CONFIG.logicHz;

  var state = {
    running: false,
    save: null,
    player: null,
    stats: null,
    camera: { x: 0, y: 0 },
    /** 表现用的闪光提示（升级 / 掉箱 / 抢怪…），到点自己消失 */
    flash: { text: '', until: 0 },
    fps: 0,
    frames: 0,
    fpsSince: 0,
    lastTickAt: 0,
    accumulator: 0,
    autosaveAt: 0,
    saveOk: false,
    debug: false,
    resetArmed: false,
    selftest: null,
    cloud: '',
    fingerprint: '',
    now: 0,
    /** 当前界面：'welcome'（登录）/ 'createRole'（创建角色）/ 'playing'（游戏里）—— A4 */
    screen: 'welcome',
    /** 本机账号（G.ACCOUNT.load() 的结果；没登录时是 null）—— A4 */
    account: null,
    /** 这一次触摸落在面板卡片里（卡片外照旧给摇杆 / 功能键）—— A4 */
    panelTouch: false,
    /** 受击顿帧剩余时长（毫秒）：>0 时世界冻住 —— 打击感全靠它 —— A4 */
    hitStopMs: 0,
    /** 震屏状态：{ until, power, ms }（power=0 表示没在震）—— A4 */
    shake: { until: 0, power: 0, ms: 1 },
    /** 音频是否可用（平台层回报；调试面板与设置面板都看它）—— A4 */
    audioReady: false
  };

  /** 屏幕中央的一条提示（小游戏没有原生 toast，自绘最省事） */
  function flash(message, ms) {
    if (!message) return;
    state.flash.text = message;
    state.flash.until = state.now + (ms || 1600);
  }

  /* ------------------------------------------------- 打击感与音频（A4 新增） */

  /** 音量 / 开关推给平台层（boot、改设置、读档后各调一次；平台层不认识"存档"） */
  function syncAudio() {
    var settings = state.save && state.save.settings ? state.save.settings : SAVE.defaultSettings();
    PLAT.setAudio({
      enabled: BAL.audio.enabled === true,
      sfxEnabled: settings.sfx !== false,
      bgmEnabled: settings.bgm !== false,
      sfxVolume: BAL.audio.sfxVolume,
      bgmVolume: BAL.audio.bgmVolume
    });
    state.audioReady = PLAT.audioSupported();
    return state.audioReady;
  }

  /** 播一次音效（玩家关掉了音效就什么都不做；没有 tt 时平台层自己会静默） */
  function playSfx(name) {
    var settings = state.save && state.save.settings ? state.save.settings : null;
    if (settings && settings.sfx === false) return false;
    return PLAT.sfx(name);
  }

  /**
   * 命中反馈：**受击顿帧 + 震屏 + 音效 + 震动**四件事一起做（用户要的"打击感"就是这个）。
   * 做成一个独立函数的原因：自检可以直接喂一份假的 events 断言数值，不用真去打一只怪。
   *   - 普通命中 45ms / 暴击 110ms（balance.view.hitStopMs）——顿帧太短没感觉，太长会"卡"；
   *   - 挨打也有 30ms：让"我被打了"这件事在画面上一顿，比飘字更快被感知；
   *   - 暴击震屏 26px/240ms，挨打 12px/150ms（balance.view.shake）。
   */
  function applyHitFeedback(events) {
    var hits = events && events.hits ? events.hits : [];
    var hurt = events && events.playerHits ? events.playerHits : [];
    var stop = 0;
    var crit = false;
    for (var i = 0; i < hits.length; i += 1) {
      if (hits[i].crit) {
        crit = true;
        if (BAL.view.hitStopMs.crit > stop) stop = BAL.view.hitStopMs.crit;
      } else if (BAL.view.hitStopMs.normal > stop) {
        stop = BAL.view.hitStopMs.normal;
      }
    }
    if (crit) {
      playSfx('crit');
      setShake(BAL.view.shake.critMs, BAL.view.shake.critPower);
      if (state.save.settings.vibrate !== false) PLAT.vibrate(30);
    } else if (hits.length > 0) {
      playSfx('hit');
    }
    if (hurt.length > 0) {
      playSfx('hurt');
      if (BAL.view.hitStopMs.hurt > stop) stop = BAL.view.hitStopMs.hurt;
      setShake(BAL.view.shake.hurtMs, BAL.view.shake.hurtPower);
      if (state.save.settings.vibrate !== false) PLAT.vibrate(20);
    }
    if (stop > state.hitStopMs) state.hitStopMs = stop;
    return { stop: state.hitStopMs, crit: crit, hits: hits.length, hurt: hurt.length };
  }

  /** 开一次震屏（power=0 或 ms<=0 就等于没开） */
  function setShake(ms, power) {
    if (!(ms > 0) || !(power > 0)) return state.shake;
    state.shake.until = state.now + ms;
    state.shake.power = power;
    state.shake.ms = ms;
    return state.shake;
  }

  /**
   * 震屏偏移（纯函数，只吃时间）：正弦衰减，时间到就归零。
   * 直接偏相机而不是偏每个绘制调用 —— 世界层完全不用知道"屏幕在抖"。
   */
  function shakeOffset(nowMs) {
    if (!(state.shake.power > 0) || nowMs >= state.shake.until) return { x: 0, y: 0 };
    var remain = (state.shake.until - nowMs) / state.shake.ms;
    var damp = remain > 0 ? remain : 0;
    if (damp > 1) damp = 1;
    return {
      x: Math.sin(nowMs * 0.09) * state.shake.power * damp,
      y: Math.cos(nowMs * 0.13) * state.shake.power * damp
    };
  }

  /** 渲染用的相机（= 真实相机 + 震屏偏移）。逻辑层永远读 state.camera，读到的是干净坐标 */
  function shakeCamera(nowMs) {
    var offset = shakeOffset(nowMs);
    if (offset.x === 0 && offset.y === 0) return state.camera;
    return { x: state.camera.x + offset.x, y: state.camera.y + offset.y };
  }

  /* ---------------------------------------------------------------- 启动 */

  function boot() {
    SCREEN.resize(PLAT.screen());
    var canvas = PLAT.initCanvas();
    if (canvas) SCREEN.applyTo(canvas, PLAT.ctx());

    // 存档：首次进入随机出生（决策 #5），之后回上次离线位置
    state.save = SAVE.load(BAL.season.worldSeed, 1);
    state.player = PLAYER.create(state.save);
    state.stats = PLAYER.statsOf(state.save.level, state.save.loadout);
    state.player.hp = state.stats.hpMax;
    state.camera.x = state.player.x;
    state.camera.y = state.player.y;

    WORLD.reset(BAL.season.worldSeed);
    WORLD.ensureChunks(state.player.x, state.player.y);

    // 世界指纹启动时算一次并常驻调试面板：它是"两份实现没有漂移"的证据
    state.fingerprint = G.SELFTEST.worldFingerprint(BAL.season.worldSeed);

    INPUT.setButtons(HUD.buttons({ save: state.save }));
    PLAT.onTouch({ start: onTouchStart, move: onTouchMove, end: onTouchEnd });
    PLAT.onShow(onLifecycle);

    // 账号与界面（A4）：先读本机账号，再决定停在"登录 / 创建角色"还是直接进游戏
    state.account = G.ACCOUNT.load();
    if (!state.account && state.save.name) {
      // 老存档（v1 迁移过来的）自带角色名：补一条本机账号记录，玩家不用重新注册
      state.account = G.ACCOUNT.create({ name: state.save.name, mode: 'local', at: Math.round(state.now) });
      G.ACCOUNT.persist(state.account);
    }
    G.LOGIN.setHasAccount(!!state.account);
    if (state.account && state.save.name) {
      state.screen = 'playing';
    } else {
      state.screen = state.account ? 'createRole' : 'welcome';
      G.LOGIN.open(state.screen);
    }

    state.running = true;
    state.now = WORLD.now();
    state.lastTickAt = Date.now();
    state.autosaveAt = state.lastTickAt;
    // 音频设置推给平台层（音量 / 开关都来自 balance + 存档设置；BGM 等首次触摸解锁后才响）
    syncAudio();
    // 没有画布（node 里的自检 / 冒烟）就不挂主循环：同一份 boot() 既能上手机也能进测试
    if (PLAT.available()) PLAT.frame(frame);
    flash('点右下「设」→ 自检，可以当场验证全部逻辑', 3200);
  }

  /** 前后台切换：切出去先存档，切回来校准时间（防"一回来狂追帧"） */
  function onLifecycle(visible) {
    if (!visible) {
      writeSave();
      return;
    }
    state.lastTickAt = Date.now();
    state.accumulator = 0;
  }

  /** 存档（位置一起存：决策 #5 要求下次回到离线位置） */
  function writeSave() {
    if (!state.save || !state.player) return;
    state.save.x = state.player.x;
    state.save.y = state.player.y;
    state.saveOk = SAVE.write(state.save);
  }

  /* ------------------------------------------------ 账号 / 登录 / 建角色（A4 新增） */

  /**
   * 创建角色并进入游戏：**唯一的"进游戏"入口**（登录流程与 node 冒烟测试都走它）。
   * 只做本机能做的事：写存档里的角色名 + 登记账号 + 切界面。
   * 昵称唯一性里"服务端那一半"在 createRoleAction 里已经先做完，到这里名字必定可用。
   */
  function beginPlaying(rawName) {
    var name = G.ACCOUNT.sanitizeName(rawName) || G.ACCOUNT.suggest(Math.round(state.now));
    state.save.name = name;
    var account = state.account || G.ACCOUNT.create({ name: name, mode: 'local', at: Math.round(state.now) });
    state.account = G.ACCOUNT.update(account, { name: name, at: Math.round(state.now) });
    G.LOGIN.setHasAccount(true);
    state.screen = 'playing';
    state.panelTouch = false;
    PANELS.close();
    writeSave();
    flash('欢迎，' + name + '！点右下「自动」可开启自动战斗', 3600);
    return name;
  }

  /**
   * 昵称在服务端也占一个坑（只有配了 cloudBase 才发包）。
   * 约定：**服务端不可用不阻断建号** —— 返回 ok:true + source:'local' 并附一句说明，
   * 阶段 A 的铁律是"单机永远能玩"（决策 #10）。
   */
  function claimNameOnline(name) {
    return PLAT.cloud('/api/name', {
      method: 'POST',
      data: { name: name, account: state.account ? state.account.id : '' }
    })
      .then(function (res) {
        var body = res && res.data ? res.data : {};
        if (body.ok === true) return { ok: true, source: 'server' };
        if (body.error === 'name_taken') return { ok: false, source: 'server', reason: 'taken' };
        return { ok: true, source: 'local', note: '服务端未就绪（' + (body.error || 'unknown') + '）→ 仅本机去重' };
      })
      .catch(function () {
        return { ok: true, source: 'local', note: '连不上服务端 → 仅本机去重' };
      });
  }

  /** 登录：tt.login → /api/profile（真 code2session）→ 本机账号；任何一环失败都降级成本机离线账号 */
  function loginAction() {
    if (G.LOGIN.isBusy()) return;
    G.LOGIN.setBusy(true, '正在登录…');
    var settle = function (note) {
      G.LOGIN.setBusy(false, note || '');
      G.LOGIN.setHasAccount(!!state.account);
      if (state.save.name) {
        state.screen = 'playing';
        flash('欢迎回来，' + state.save.name, 2600);
      } else {
        state.screen = 'createRole';
        G.LOGIN.open('createRole');
      }
    };
    var localAccount = function (note) {
      state.account = G.ACCOUNT.create({ name: state.save.name || '', mode: 'local', at: Math.round(state.now) });
      settle(note);
    };

    if (!PLAT.hasTt()) {
      localAccount('测试环境没有平台登录接口 → 使用本机离线账号（正式包里会走抖音登录）');
      return;
    }
    PLAT.login().then(function (credentials) {
      if (!credentials) {
        localAccount('拿不到平台登录 code → 使用本机离线账号');
        return;
      }
      if (!CONFIG.cloudBase) {
        localAccount('已连上抖音，但没配云后端地址 → 使用本机离线账号');
        return;
      }
      return PLAT.cloud('/api/profile', {
        method: 'POST',
        data: { code: credentials.code, anonymousCode: credentials.anonymousCode }
      })
        .then(function (res) {
          var body = res && res.data ? res.data : {};
          if (body.ok !== true) {
            localAccount('云登录被拒（' + (body.error || 'unknown') + '）→ 本机离线账号');
            return;
          }
          state.account = G.ACCOUNT.create({
            id: body.account || '',
            name: state.save.name || '',
            mode: 'douyin',
            openid: body.openid || '',
            token: body.token || '',
            at: Math.round(state.now)
          });
          G.ACCOUNT.persist(state.account);
          settle('抖音账号登录成功' + (body.anonymous ? '（匿名 openid）' : ''));
        })
        .catch(function (error) {
          localAccount('连不上云后端：' + (error && error.message ? error.message : '未知错误') + ' → 本机离线账号');
        });
    });
  }

  /** 创建角色：先本地校验（格式 + 本机去重），再（可选）服务端占位，最后 beginPlaying */
  function createRoleAction() {
    if (G.LOGIN.isBusy()) return;
    var check = G.ACCOUNT.validate(G.LOGIN.draftName());
    if (!check.ok) {
      G.LOGIN.setMessage(G.ACCOUNT.reasonText(check.reason));
      return;
    }
    var finish = function (note) {
      beginPlaying(check.name);
      G.LOGIN.setBusy(false, note || '');
    };
    if (!PLAT.hasTt() || !CONFIG.cloudBase) {
      finish('昵称已在本机登记（离线去重）');
      return;
    }
    G.LOGIN.setBusy(true, '正在校验昵称…');
    claimNameOnline(check.name).then(function (result) {
      if (!result.ok) {
        G.LOGIN.setBusy(false, '昵称「' + check.name + '」已被占用，换一个');
        return;
      }
      finish(result.source === 'server' ? '昵称 ' + check.name + ' 已在服务端登记' : result.note);
    });
  }

  /** 平台键盘输入昵称（没有 showKeyboard 时退回随机昵称，并告诉玩家为什么） */
  function typeNameAction() {
    PLAT.editText({ defaultValue: G.LOGIN.draftName(), maxLength: BAL.account.nameMax }).then(function (value) {
      if (value === null || value === undefined) {
        G.LOGIN.randomName(Math.round(state.now) + 31);
        G.LOGIN.setMessage('平台键盘不可用 → 已换成随机昵称「' + G.LOGIN.draftName() + '」，可以一直点「换一个」');
        return;
      }
      G.LOGIN.setDraftName(value);
      var check = G.LOGIN.draftName() ? G.ACCOUNT.validate(G.LOGIN.draftName()) : { ok: false, reason: 'empty' };
      G.LOGIN.setMessage(check.ok ? '昵称可用：' + G.LOGIN.draftName() : G.ACCOUNT.reasonText(check.reason));
    });
  }

  /** 登录 / 创建角色界面上的按钮 → 动作（与 PANELS 的 action 同构，20-main 统一执行） */
  function handleLoginAction(action) {
    if (!action) return;
    if (action.type === 'login') loginAction();
    else if (action.type === 'createRole') createRoleAction();
    else if (action.type === 'typeName') typeNameAction();
    else if (action.type === 'randomName') {
      G.LOGIN.randomName(Math.round(state.now) + 17);
      G.LOGIN.setMessage('已换一个随机昵称：' + G.LOGIN.draftName());
    } else if (action.type === 'newAccount') {
      G.ACCOUNT.forget();
      state.account = null;
      G.LOGIN.setHasAccount(false);
      G.LOGIN.setMessage('本机账号已清除（存档与昵称注册表保留）');
    }
  }

  /**
   * 自动战斗的**走位**那一半（用户要求："自动战斗时不仅会自动释放技能，还会自动走向最近的怪物"）。
   * 出手由 14-world.playerAttack 负责（它本来就是自动的），这里只负责"走过去"：
   *   1. 摇杆只要推着就手动优先 —— 自动模式随时可以被玩家接管；
   *   2. 没有目标 / 目标死了就按"视野内最近"重选（与出手共用同一份 pickTarget / targetId）；
   *   3. 走到 `怪半径 + 攻击距离 × auto.moveStopRatio` 就站住：贴脸打容易被围殴，
   *      这个比例就是"贴上去"和"留半个身位"之间的取舍（在 balance 里，不在代码里）。
   * 返回当前目标（自检要断言"确实朝着最近的怪走了"）。
   */
  function autoStep(player, stats, dtMs) {
    var dtSec = dtMs / 1000;
    if (player.dead) {
      PLAYER.move(player, 0, 0, dtSec, stats);
      return null;
    }
    var target = WORLD.monsterById(player.targetId);
    if (!target && WORLD.now() >= player.targetAt) {
      target = WORLD.pickTarget(player);
      player.targetId = target ? target.id : 0;
      player.targetAt = WORLD.now();
    }
    if (!target) {
      PLAYER.move(player, 0, 0, dtSec, stats);
      return null;
    }
    var dx = target.x - player.x;
    var dy = target.y - player.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var reach = target.radius + BAL.player.attackRange * BAL.auto.moveStopRatio;
    if (dist <= reach || dist < 0.0001) {
      PLAYER.move(player, 0, 0, dtSec, stats);
      // 站住也要面向目标，否则会出现"背着脸砍"
      if (dist > 0.0001) {
        player.facing.x = dx / dist;
        player.facing.y = dy / dist;
      }
      return target;
    }
    PLAYER.move(player, dx, dy, dtSec, stats);
    return target;
  }

  /** 自动战斗开关（右下「自动」按钮）：写进存档，重开游戏还记得 */
  function toggleAutoBattle() {
    var settings = state.save.settings;
    settings.autoBattle = settings.autoBattle !== true;
    writeSave();
    flash(settings.autoBattle ? '自动战斗已开启：自动走向视野内最近的怪' : '自动战斗已关闭：手动摇杆走位', 2200);
    return settings.autoBattle;
  }

  /* ---------------------------------------------------------------- 逻辑步 */

  /**
   * 一个逻辑帧（固定 1/60 秒）。
   * A4 的两处关键改动：
   *   1. 只有 `screen === 'playing'` 才跑世界 —— 登录 / 创建角色界面上的世界是静止的；
   *   2. **面板开着不再暂停世界**（用户要求"打开背包、设置等界面时游戏不停止"）：
   *      卡片只占 1/3 屏、卡片外还能推摇杆，于是玩家可以边开着背包边跑图。
   *      代价写在 04-decisions #10：站着开箱会被怪打 —— 这是"不暂停"的必然结果。
   */
  function step(dtMs) {
    if (state.screen !== 'playing') return;

    // 受击顿帧（A4）：命中那一瞬间把世界冻住几十毫秒 —— 打击感的一半在这个数字上。
    // 顿帧期间连相机缓动都不推进，画面"咬"住一下才像真打到了东西。
    if (state.hitStopMs > 0) {
      state.hitStopMs -= dtMs;
      return;
    }

    var player = state.player;
    var stats = state.stats;

    if (player.dead) {
      if (WORLD.now() >= player.respawnAt) {
        PLAYER.respawn(player, stats);
        flash('已复活（原地、半血）', 1200);
      }
      PLAYER.move(player, 0, 0, dtMs / 1000, stats);
    } else {
      var direction = INPUT.direction();
      if (direction.magnitude > 0) {
        // 摇杆推得越满走得越快（magnitude 就是模拟量），这是"手感"的一半；手动永远优先
        PLAYER.move(player, direction.x * direction.magnitude, direction.y * direction.magnitude, dtMs / 1000, stats);
      } else if (state.save.settings.autoBattle) {
        // 自动战斗：自动走向视野内最近的怪（出手本来就有 14-world.playerAttack 负责）
        autoStep(player, stats, dtMs);
      } else {
        PLAYER.move(player, 0, 0, dtMs / 1000, stats);
      }
    }
    PLAYER.decayKnockback(player);

    var events = WORLD.update(dtMs, player, stats, state.camera, SCREEN.width(), SCREEN.height());
    applyHitFeedback(events);
    for (var i = 0; i < events.kills.length; i += 1) applyKill(events.kills[i]);
    if (events.playerDown) flash('被打倒了，3 秒后原地复活', 1600);

    // 相机缓动跟随（view.cameraLerpPerTick 是"每逻辑帧"的插值比例）
    state.camera.x += (player.x - state.camera.x) * BAL.view.cameraLerpPerTick;
    state.camera.y += (player.y - state.camera.y) * BAL.view.cameraLerpPerTick;

    state.save.stats.playMs += dtMs;
    state.now = WORLD.now();
  }

  /* ---------------------------------------------------------------- 结算 */

  /** 一次击杀的账：经验、金币、掉箱（决策 #1：只有"累计伤害最高者"能拿到） */
  function applyKill(kill) {
    var save = state.save;
    var monster = kill.monster;
    playSfx('kill');
    save.stats.kills += 1;
    if (monster.elite) save.stats.eliteKills += 1;

    if (!kill.mine) {
      flash('一只 ' + monster.name + ' 的奖励被抢走了（决策 #1 的规则）', 1600);
      return;
    }

    var xp = Math.round(PROG.monsterXp(monster.level, monster.band, monster.elite) * (1 + state.stats.xpBonus));
    var gold = Math.round(PROG.monsterGold(monster.level, monster.band, monster.elite) * (1 + state.stats.goldBonus));
    save.gold += gold;

    var levels = PROG.applyXp(save, xp);
    if (levels > 0) onLevelUp(levels);
    else flash('+' + xp + ' 经验 · +' + gold + ' 金币', 900);

    if (WORLD.rng().chance(LOOT.dropChance(monster.band, monster.elite))) {
      var tier = LOOT.rollChestTier(monster.band, monster.elite, WORLD.rng(), save.pity);
      if (SAVE.pushChest(save, tier, monster.level)) {
        flash(LOOT.tierName(tier) + ' 到手（背包 ' + save.chests.length + '/' + LOOT.bagCap() + '）', 1600);
      } else {
        var salvage = LOOT.salvageGold(tier);
        save.gold += salvage;
        flash('宝箱背包已满：' + LOOT.tierName(tier) + ' 自动分解 +' + salvage + ' 金币', 1800);
      }
    }
  }

  /** 升级：属性重算 + 血量按比例补 +（到 20 级时）提示商城与公会解锁 */
  function onLevelUp(levels) {
    var before = state.stats;
    state.stats = PLAYER.statsOf(state.save.level, state.save.loadout);
    PLAYER.onLevelUp(state.player, before, state.stats);
    var text = '升级！Lv.' + state.save.level + (levels > 1 ? '（连升 ' + levels + ' 级）' : '');
    if (PROG.shopUnlocked(state.save.level) && state.save.level - levels < BAL.guild.shopUnlockLevel) {
      text += ' · 商城与公会解锁';
    }
    playSfx('levelup');
    flash(text, 2200);
  }

  /* ---------------------------------------------------------------- 开箱与装备 */

  /**
   * 开箱时的装备等阶：以**箱阶为下限**，在同阶及以上按（band 调整过的）权重抽。
   * 这条规则兑现了 01-game-design §7 的"普通箱开出 ≥ 普通、天赐箱必是天赐"。
   */
  function rollEquipmentTier(chestTier, band) {
    var weights = LOOT.tierWeights(band);
    var pool = [];
    var poolWeights = [];
    for (var i = 0; i < BAL.equipment.tiers.length; i += 1) {
      var tier = BAL.equipment.tiers[i];
      if (tier.id >= chestTier) {
        pool.push(tier);
        poolWeights.push(weights[i]);
      }
    }
    return pool[WORLD.rng().weightedIndex(poolWeights)].id;
  }

  function removeItem(save, itemId) {
    for (var i = 0; i < save.items.length; i += 1) {
      if (save.items[i].id === itemId) {
        save.items.splice(i, 1);
        return true;
      }
    }
    return false;
  }

  /** 开一个箱：抽装备等阶 → 生成装备 →（默认）战力更高就直接穿上，否则进背包 */
  function openOneChest() {
    var save = state.save;
    if (save.chests.length === 0) return null;
    var chest = save.chests.shift();
    var band = CHUNK.bandOf(state.player.x, state.player.y);
    var tier = rollEquipmentTier(chest.tier, band);
    var item = EQUIP.generate(tier, chest.level, WORLD.rng(), 0);
    save.stats.opened += 1;

    var worn = save.loadout[item.slotId];
    if (CONFIG.autoEquipBetter && (!worn || item.power > worn.power)) {
      save.loadout[item.slotId] = item;
      if (worn) save.gold += LOOT.salvageGold(worn.tier);
      state.stats = PLAYER.statsOf(save.level, save.loadout);
      return { item: item, equipped: true };
    }
    SAVE.pushItem(save, item);
    return { item: item, equipped: false };
  }

  /** 开 N 箱：只报"最好的一件"，免得刷屏（每箱的结果都进背包/身上） */
  function openChests(count) {
    playSfx('chest');
    var results = [];
    for (var i = 0; i < count; i += 1) {
      var result = openOneChest();
      if (!result) break;
      results.push(result);
    }
    if (results.length === 0) {
      flash('没有宝箱：去打怪（普通怪约 8% 掉箱，精英 25%）', 1800);
      return;
    }
    var best = results[0];
    for (var k = 1; k < results.length; k += 1) {
      if (results[k].item.power > best.item.power) best = results[k];
    }
    flash(
      '开 ' +
        results.length +
        ' 箱：最好 ' +
        EQUIP.tierById(best.item.tier).name +
        ' ' +
        best.item.slotName +
        '（战力 ' +
        best.item.power +
        '）' +
        (best.equipped ? ' · 已穿上' : ' · 进了背包'),
      2800
    );
  }

  /** 穿上背包里的装备：旧件退回背包（不自动分解，交给"一键分解"处理） */
  function equipFromBag(itemId) {
    var save = state.save;
    var item = null;
    for (var i = 0; i < save.items.length; i += 1) {
      if (save.items[i].id === itemId) item = save.items[i];
    }
    if (!item) {
      flash('这件装备不在背包里', 1200);
      return;
    }
    if (save.level < item.reqLevel) {
      flash('等级不够：需要 Lv.' + item.reqLevel, 1400);
      return;
    }
    var worn = save.loadout[item.slotId];
    save.loadout[item.slotId] = item;
    removeItem(save, item.id);
    if (worn) save.items.push(worn);
    state.stats = PLAYER.statsOf(save.level, save.loadout);
    flash('已穿上 ' + EQUIP.tierById(item.tier).name + ' ' + item.slotName + '（战力 ' + state.stats.power + '）', 1800);
  }

  /** 一键分解：每个部位只留最强的一件，其余换成金币 */
  function salvageAll() {
    var save = state.save;
    var keep = {};
    var gold = 0;
    var i;
    for (i = 0; i < save.items.length; i += 1) {
      var item = save.items[i];
      if (!keep[item.slotId] || item.power > keep[item.slotId].power) keep[item.slotId] = item;
    }
    var remaining = [];
    for (i = 0; i < save.items.length; i += 1) {
      var candidate = save.items[i];
      if (keep[candidate.slotId] === candidate) remaining.push(candidate);
      else gold += LOOT.salvageGold(candidate.tier);
    }
    var sold = save.items.length - remaining.length;
    save.items = remaining;
    save.gold += gold;
    flash('分解 ' + sold + ' 件，+' + gold + ' 金币（每个部位留最强 1 件）', 2200);
  }

  /* ------------------------------------------------------- 商城 / 公会 / 设置 */

  /** 买号角：20 级解锁商城（balance.guild.shopUnlockLevel），500 金币（决策 #4） */
  function buyHorn() {
    var save = state.save;
    if (!PROG.shopUnlocked(save.level)) {
      flash('需要 ' + BAL.guild.shopUnlockLevel + ' 级才能进商城（现在 ' + save.level + ' 级）', 1800);
      return;
    }
    if (save.gold < BAL.shop.horn.priceGold) {
      flash('金币不够：还差 ' + (BAL.shop.horn.priceGold - save.gold) + ' 金币', 1800);
      return;
    }
    save.gold -= BAL.shop.horn.priceGold;
    save.horns += 1;
    flash('买到公会号角（持有 ' + save.horns + ' 个）', 1800);
  }

  /** 建公会：消耗一个号角，**锚点就设在你脚下**（决策 #5 的"据点 = 回城锚点"） */
  function createGuild() {
    var save = state.save;
    if (!PROG.guildUnlocked(save.level)) {
      flash('需要 ' + BAL.guild.unlockLevel + ' 级才能建公会', 1600);
      return;
    }
    if (save.horns <= 0) {
      flash('没有号角：商城 ' + BAL.shop.horn.priceGold + ' 金币', 1800);
      return;
    }
    save.horns -= 1;
    save.guild = {
      name: PANELS.draftGuildName() || PANELS.nextGuildName(WORLD.now() | 0),
      anchor: { x: state.player.x, y: state.player.y },
      createdAt: Math.round(WORLD.now()),
      teleportAt: 0,
      members: [{ id: 1, name: '我', role: 'leader' }]
    };
    PANELS.setDraftGuildName('');
    flash('公会「' + save.guild.name + '」已建立，锚点就在脚下', 2600);
  }

  /** 回公会锚点：冷却 + 战斗中禁用（balance.guild.teleportCooldownMs / teleportCombatLockMs） */
  function teleportGuild() {
    var save = state.save;
    if (!save.guild) {
      flash('还没有公会', 1400);
      return;
    }
    if (PLAYER.inCombat(state.player, WORLD.now())) {
      flash('战斗中不可传送（' + Math.round(BAL.guild.teleportCombatLockMs / 1000) + ' 秒内受过伤）', 1800);
      return;
    }
    var wait = BAL.guild.teleportCooldownMs - (WORLD.now() - (save.guild.teleportAt || 0));
    if (save.guild.teleportAt && wait > 0) {
      flash('冷却中：还要 ' + Math.ceil(wait / 1000) + ' 秒', 1600);
      return;
    }
    state.player.x = save.guild.anchor.x;
    state.player.y = save.guild.anchor.y;
    state.camera.x = state.player.x;
    state.camera.y = state.player.y;
    state.player.targetId = 0;
    save.guild.teleportAt = WORLD.now();
    WORLD.ensureChunks(state.player.x, state.player.y);
    flash('回到公会锚点', 1400);
  }

  /** 自检：跑 19-selftest 的全部断言，结果直接摆到面板上（人眼也能验收"逻辑没坏"） */
  function runSelftest() {
    var result = G.SELFTEST.runAll();
    state.selftest = {
      lines: result.lines,
      checks: result.checks,
      failures: result.failures,
      fingerprint: result.fingerprint
    };
    PANELS.open('selftest');
    flash(result.failures === 0 ? '自检全绿：' + result.checks + ' 项' : '自检有 ' + result.failures + ' 项失败', 2600);
  }

  /** 云后端连通性自测：没配 cloudBase 时不会发包（PLAT.cloud 直接 reject） */
  function cloudPing() {
    state.cloud = '正在请求 ' + (CONFIG.cloudBase || '(未配置 cloudBase)') + ' …';
    PLAT.cloud('/api/health')
      .then(function (res) {
        var body = res && res.data ? res.data : {};
        state.cloud =
          '云后端正常：' +
          (body.service || '?') +
          ' v' +
          (body.version || '?') +
          ' · balance v' +
          (body.balanceVersion || '?') +
          ' · ' +
          (body.time || '');
      })
      .catch(function (error) {
        state.cloud = '云后端不可用：' + (error && error.message ? error.message : '未知错误');
      });
  }

  /** 重置存档：两次点击确认（第一次只是"上膛"，避免误触把号删了） */
  function resetSave() {
    if (!state.resetArmed) {
      state.resetArmed = true;
      flash('再点一次「重置本地存档」确认删除', 2600);
      return;
    }
    state.resetArmed = false;
    var keepName = state.save ? state.save.name : '';
    SAVE.clear();
    state.save = SAVE.create(BAL.season.worldSeed, 1);
    // 角色名属于**账号**，不跟着存档一起清（否则玩家要重新起名，昵称也还占着）
    state.save.name = keepName;
    state.player = PLAYER.create(state.save);
    state.stats = PLAYER.statsOf(state.save.level, state.save.loadout);
    state.player.hp = state.stats.hpMax;
    state.camera.x = state.player.x;
    state.camera.y = state.player.y;
    WORLD.reset(BAL.season.worldSeed);
    WORLD.ensureChunks(state.player.x, state.player.y);
    writeSave();
    PANELS.close();
    flash('存档已重置', 1600);
  }

  /** 右下功能键 → 打开 / 收起面板；「自动」是开关（用户要求"自动战斗设置为按钮，点击开启"） */
  function onHudButton(id) {
    playSfx('ui');
    if (id === 'auto') {
      toggleAutoBattle();
      return;
    }
    if (id === 'chest') togglePanel('chest');
    else if (id === 'bag') togglePanel('bag');
    else if (id === 'guild') togglePanel('guild');
    else if (id === 'menu') togglePanel('menu');
  }

  /** 再点同一个功能键 = 收起面板（卡片只占 1/3 屏，功能键一直在，这是最顺手的关法） */
  function togglePanel(panel) {
    if (PANELS.isOpen() && PANELS.panelId() === panel) PANELS.close();
    else PANELS.open(panel);
  }

  /**
   * 设置开关（音效 / 背景音乐 / 震动）：写存档 + 立刻生效 + 给一句提示。
   * "立刻生效"是重点：关掉 BGM 必须马上静下来，否则玩家会以为设置没生效（04-decisions #10）。
   */
  function toggleSetting(key) {
    var settings = state.save.settings;
    if (key === 'sfx') {
      settings.sfx = settings.sfx === false;
      syncAudio();
      playSfx('ui');
      flash('音效已' + (settings.sfx ? '开启' : '关闭'), 1400);
    } else if (key === 'bgm') {
      settings.bgm = settings.bgm === false;
      syncAudio();
      if (settings.bgm) PLAT.bgm(true);
      else PLAT.stopBgm();
      flash('背景音乐已' + (settings.bgm ? '开启' : '关闭'), 1400);
    } else if (key === 'vibrate') {
      settings.vibrate = settings.vibrate === false;
      if (settings.vibrate) PLAT.vibrate(20);
      flash('震动已' + (settings.vibrate ? '开启' : '关闭'), 1400);
    } else {
      return null;
    }
    writeSave();
    return settings;
  }

  /** 面板 action → 具体操作（**唯一改存档的入口**，阶段 B 会被服务端接口替换） */
  function handleAction(action) {
    if (!action) return;
    var type = action.type;
    // 点一下界面就该有"咔"的一声（开箱那条有自己的声音，所以跳过）
    if (type !== 'openChest') playSfx('ui');
    if (type === 'close') PANELS.close();
    else if (type === 'open') PANELS.open(action.panel);
    else if (type === 'toggleSfx') toggleSetting('sfx');
    else if (type === 'toggleBgm') toggleSetting('bgm');
    else if (type === 'toggleVibrate') toggleSetting('vibrate');
    else if (type === 'openChest') openChests(action.count || 1);
    else if (type === 'equip') equipFromBag(action.itemId);
    else if (type === 'salvageAll') salvageAll();
    else if (type === 'buyHorn') buyHorn();
    else if (type === 'createGuild') createGuild();
    else if (type === 'renameGuild') PANELS.setDraftGuildName(PANELS.nextGuildName((WORLD.now() | 0) + 7));
    else if (type === 'teleportGuild') teleportGuild();
    else if (type === 'selftest') runSelftest();
    else if (type === 'cloudPing') cloudPing();
    else if (type === 'toggleDebug') state.debug = !state.debug;
    else if (type === 'resetSave') resetSave();
  }

  /* ---------------------------------------------------------------- 渲染 */

  /** 组装一份"界面视图"：HUD / 面板 / 调试面板都只读它（避免各处各取一套数据） */
  function uiView() {
    return {
      save: state.save,
      player: state.player,
      stats: state.stats,
      target: targetMonster(),
      fps: state.fps,
      chunks: WORLD.loadedChunkCount(),
      activeMonsters: WORLD.activeMonsterCount(),
      /**
       * 只有 HUD 的功能键在这里（面板的关闭键由 18-panels 自己命中）：
       * 卡片只占 1/3 屏，功能键必须一直可点，所以它不随面板开合而变。
       */
      buttons: HUD.buttons({ save: state.save }),
      debug: state.debug,
      flash: state.flash,
      now: state.now,
      resetArmed: state.resetArmed,
      selftest: state.selftest,
      cloud: state.cloud,
      fingerprint: state.fingerprint,
      saveOk: state.saveOk,
      /** A4：界面与账号（登录 / 创建角色屏要读；HUD 只读名字与等级） */
      screen: state.screen,
      account: state.account,
      autoBattle: !!(state.save.settings && state.save.settings.autoBattle === true),
      /** A4：音频状态（设置面板要显示开关的当前值与平台是否支持） */
      audio: PLAT.audioState()
    };
  }

  function targetMonster() {
    var monsters = WORLD.allMonsters();
    for (var i = 0; i < monsters.length; i += 1) {
      if (monsters[i].id === state.player.targetId && monsters[i].state !== 'dead') return monsters[i];
    }
    return null;
  }

  /** 一帧画面：登录界面 → 世界层 → 摇杆 → HUD → 面板卡片 → 功能键（压在最后的顺序见 renderTo） */
  function render() {
    var ctx = PLAT.ctx();
    var canvas = PLAT.canvas();
    if (!ctx || !canvas) return;
    SCREEN.applyTo(canvas, ctx);
    renderTo(ctx);
  }

  /**
   * 把整帧画到指定上下文上。
   * 单独拆出来是为了让 19-selftest 的**冒烟测试**能用一个"假 canvas 上下文"跑完整帧：
   * "一进游戏就白屏"这类 bug 只在真帧里暴露，而这个假上下文能把它变成一条断言。
   *
   * 绘制顺序（A4 起 HUD 被拆成两半，就是为了这条链）：
   *   世界 → 摇杆 → HUD（吸顶 + 经验条 + 小地图）→ 面板卡片 → **功能键**
   * 功能键放在最后：面板卡片只占 1/3 屏，右下那五个键要一直可用（点「包」能直接关掉背包）。
   * 登录 / 创建角色界面则整屏交给 G.LOGIN（世界不画，玩家还没进游戏）。
   */
  function renderTo(ctx) {
    var view = uiView();

    if (state.screen !== 'playing') {
      G.LOGIN.draw(ctx, view);
      return;
    }

    ctx.fillStyle = '#0b1020';
    ctx.fillRect(0, 0, SCREEN.width(), SCREEN.height());

    // 震屏：只偏渲染用的相机（state.camera 本身不动 → 逻辑层拿到的永远是干净坐标）
    var camera = shakeCamera(view.now);
    RENDER.drawGround(ctx, camera);
    RENDER.drawDecor(ctx, camera, WORLD.decorInView());
    RENDER.drawRoads(ctx, camera);
    RENDER.drawLandmarks(ctx, camera, WORLD.landmarksInView());
    RENDER.drawCamp(ctx, camera);
    RENDER.drawProjectiles(ctx, camera, WORLD.projectiles());
    RENDER.drawMonsters(ctx, camera, WORLD.monstersInView(), state.player.targetId, view.now);
    RENDER.drawTargetRing(ctx, camera, view.target);
    RENDER.drawPlayer(ctx, camera, state.player, state.stats, view.now);
    // 头顶名牌：角色名 + 血条（用户要求；玩家和精英怪共用同一份画法）
    RENDER.drawNameplate(ctx, camera, {
      x: state.player.x,
      y: state.player.y,
      radius: BAL.player.radius,
      name: state.save.name || '无名者',
      level: state.save.level,
      hp: state.player.hp,
      hpMax: state.stats.hpMax,
      dead: state.player.dead === true,
      color: '#ffeaa7'
    });
    // 斩击特效画在实体之上、飘字之下：刀光要盖住怪，伤害数字又要最清楚
    RENDER.drawEffects(ctx, camera, WORLD.effects(), view.now);
    RENDER.drawDamageNumbers(ctx, camera, WORLD.damageNumbers(), WORLD.now());

    INPUT.setButtons(view.buttons);
    INPUT.draw(ctx);
    HUD.draw(ctx, view);
    PANELS.draw(ctx, view);
    HUD.drawButtons(ctx, view);
  }

  /* ---------------------------------------------------------------- 触摸路由 */

  /** 取最后一根手指（竖屏单手为主，多指只服侍摇杆 + 一个按钮） */
  function touchPoint(event) {
    var list = [];
    if (event && event.touches && event.touches.length) list = event.touches;
    else if (event && event.changedTouches && event.changedTouches.length) list = event.changedTouches;
    if (!list.length) return null;
    var raw = list[list.length - 1];
    var point = SCREEN.pointer(raw.clientX, raw.clientY);
    point.id = raw.identifier === undefined || raw.identifier === null ? 0 : raw.identifier;
    return point;
  }

  /**
   * 按下：三层路由（见文件头）。
   * A4 的关键差别：**"面板开着"不再等于"全部触摸都给面板"** ——
   * 只有落在卡片矩形（或关闭键）里的那一下才归面板，其余照旧给摇杆 / 功能键。
   * 于是"打开背包时游戏不停止"不只是世界在跑，玩家也**真的还能走位**。
   */
  function onTouchStart(event) {
    var point = touchPoint(event);
    if (!point) return;
    // 首次触摸：解锁音频（平台硬要求"用户交互后才能播"），然后把 BGM 起起来
    if (PLAT.unlockAudio()) PLAT.bgm(true);
    if (state.screen !== 'playing') {
      G.LOGIN.press(point);
      return;
    }
    if (PANELS.isOpen() && PANELS.contains(point)) {
      state.panelTouch = true;
      PANELS.press(point, uiView());
      return;
    }
    state.panelTouch = false;
    INPUT.begin(point, WORLD.now());
  }

  function onTouchMove(event) {
    var point = touchPoint(event);
    if (!point) return;
    if (state.screen !== 'playing') return;
    if (state.panelTouch) {
      PANELS.move(point, uiView());
      return;
    }
    INPUT.move(point);
  }

  function onTouchEnd(event) {
    var point = touchPoint(event);
    if (!point) return;
    if (state.screen !== 'playing') {
      handleLoginAction(G.LOGIN.release(point));
      return;
    }
    if (state.panelTouch) {
      state.panelTouch = false;
      handleAction(PANELS.release(point, uiView()));
      return;
    }
    var button = INPUT.end(point);
    if (button) onHudButton(button.id);
  }

  /* ---------------------------------------------------------------- 主循环 */

  /**
   * 每帧：把真实经过的时间切成固定 1/60 的逻辑步（最多追赶 maxCatchUpSteps 步），
   * 然后渲染一次。掉帧时逻辑不变慢；切后台回来不会"一顿狂算"。
   */
  function frame(timestampMs) {
    if (!state.running) return;
    var stamp = typeof timestampMs === 'number' && timestampMs > 0 ? timestampMs : Date.now();
    var elapsed = stamp - state.lastTickAt;
    if (!(elapsed > 0)) elapsed = 0;
    if (elapsed > 250) elapsed = 250;
    state.lastTickAt = stamp;
    state.accumulator += elapsed;

    var steps = 0;
    while (state.accumulator >= STEP_MS && steps < CONFIG.maxCatchUpSteps) {
      step(STEP_MS);
      state.accumulator -= STEP_MS;
      steps += 1;
    }
    if (steps >= CONFIG.maxCatchUpSteps) state.accumulator = 0;

    state.frames += 1;
    if (!state.fpsSince) state.fpsSince = stamp;
    if (stamp - state.fpsSince >= 1000) {
      // ⚠️ 无头环境里的 FPS 不能当性能结论（上一版踩过，见 03-roadmap §四.3）
      state.fps = state.frames;
      state.frames = 0;
      state.fpsSince = stamp;
    }
    if (stamp - state.autosaveAt >= BAL.view.autosaveMs) {
      state.autosaveAt = stamp;
      writeSave();
    }

    render();
    PLAT.frame(frame);
  }

  /**
   * 入口。**拿不到画布就不启动主循环**（node 里跑自检 / 冒烟就是这种情况）：
   * 这条判断同时让 19-selftest 能在无平台环境里驱动 step() / render()，
   * 不必假装自己是一台手机。
   */
  function start() {
    if (!PLAT.available()) return false;
    boot();
    return true;
  }

  return {
    state: state,
    flash: flash,
    writeSave: writeSave,
    boot: boot,
    beginPlaying: beginPlaying,
    loginAction: loginAction,
    createRoleAction: createRoleAction,
    handleLoginAction: handleLoginAction,
    autoStep: autoStep,
    toggleAutoBattle: toggleAutoBattle,
    toggleSetting: toggleSetting,
    syncAudio: syncAudio,
    playSfx: playSfx,
    applyHitFeedback: applyHitFeedback,
    setShake: setShake,
    shakeOffset: shakeOffset,
    step: step,
    applyKill: applyKill,
    onLevelUp: onLevelUp,
    openChests: openChests,
    equipFromBag: equipFromBag,
    salvageAll: salvageAll,
    buyHorn: buyHorn,
    createGuild: createGuild,
    teleportGuild: teleportGuild,
    runSelftest: runSelftest,
    cloudPing: cloudPing,
    resetSave: resetSave,
    onTouchStart: onTouchStart,
    onTouchMove: onTouchMove,
    onTouchEnd: onTouchEnd,
    onHudButton: onHudButton,
    handleAction: handleAction,
    togglePanel: togglePanel,
    render: render,
    renderTo: renderTo,
    frame: frame,
    uiView: uiView,
    start: start
  };
})();

/**
 * 小游戏的入口文件就是拼出来的 game.js，所以这里直接起。
 * 拿不到画布（node 断言 / 冒烟）时 start() 返回 false，什么都不会发生 ——
 * 这正是"逻辑层与平台分离"带来的好处：同一份代码既能上手机也能进测试。
 */
G.GAME.start();

