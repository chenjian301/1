/* AUTO-GENERATED FILE -- DO NOT EDIT.
 *
 * Source of truth: shared\balance.json -- the single place gameplay numbers live.
 * Regenerate after editing balance.json:
 *
 *   powershell -ExecutionPolicy Bypass -File tools\gen-minigame-balance.ps1
 *   powershell -ExecutionPolicy Bypass -File tools\build-minigame.ps1
 * (or simply run tools\minigame-now.cmd, which does both plus the checks)
 *
 * balance.json sha256, raw file format                  = d29c8acbe5f197d10b0316e0a708ea844ea4ca1c8c446a3a1c764d032366d355
 * balance.json sha256, normalised (BOM stripped, CRLF -> LF) = 6d240e9c7d8268988beb07c62b4310ed982f165a07f391a918fdff20686a991b
 * tools\check-minigame.ps1 fails if the normalised hash no longer matches balance.json.
 *
 * NOTE: this header is ASCII on purpose -- see tools\gen-minigame-balance.ps1.
 * The JSON body below is embedded verbatim, so non-ASCII text inside it (monster names,
 * the _readme line) is exactly what shared\balance.json contains.
 */

G.BAL_SOURCE_SHA256 = '6d240e9c7d8268988beb07c62b4310ed982f165a07f391a918fdff20686a991b';
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
    "_tileSize": "一张地表块的边长（世界单位）：chunk 内的地表网格 = chunkSize / tileSize。64 = 8×8、块边长 102 世界单位（手机上约 42 CSS px，肉眼就是\"方块\"）；32 = 16×16、块边长 51，配上 16-render 的亮暗档与细纹（土斑 / 草籽）就看不到像素块了。只影响渲染，不影响世界指纹。",
    "tileSize": 32,
    "monstersPerChunk": { "min": 1, "max": 3 },
    "eliteChance": 0.08,
    "eliteMaxPerChunk": 1,
    "decorPerChunk": { "min": 8, "max": 24 },
    "landmarkChunkSpan": 5,
    "_camp": "原点新手营地：玩家出生地 + 真正的安全区（A6 起怪物不在营地里刷新，也走不进来）",
    "camp": {
      "radius": 900,
      "plazaPlate": 96,
      "fenceRadius": 824,
      "gateWidth": 220,
      "_monsterFree": "安全半径（A6）：装载 chunk 时跳过巢穴落在这里面的怪 —— 过滤发生在装载层，生成层的数据一个字都没动，所以世界指纹不变；已经在外面的怪走进来会被推到边上并回家",
      "monsterFreeRadius": 900,
      "_interact": "营地交互入口（A4）：治疗按缺失血量收金币；回营地中心有短冷却 + 战斗中禁用",
      "heal": { "goldPerHp": 0.05, "minGold": 1 },
      "teleportCooldownMs": 10000,
      "_smith": "营地铁匠（本次新增，用户要求「在公会营地里增加铁匠NPC，可以进行装备强化」）：他是营地里**一件手工摆位的道具**（kind = forge，坐标写在 04-terrain 的 CAMP_PROPS —— 和帐篷 / 篝火 / 木牌一样不消耗任何随机流，所以世界指纹不变），画法在 16-render 的 drawForge。走到他 talkRadius 以内时，20-main 按相机把这条线投影到屏幕上、多出一枚「锻」圆键（点它开强化面板）；营地面板里也有一行同样的入口 —— 两条路都进 18-panels 的 enhance 面板",
      "smith": { "talkRadius": 260 }
    },
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
    "_targetRange": "选目标的距离上限（设计像素）：**0 = 不限距离** —— 在已装载的全部怪里找最近的那只（用户要求：自动战斗盯\"全地图最近的怪\"，而不是只看视野内）。调成正数就退回\"只看眼前一圈\"，自动走位也只会在圈里找。",
    "targetRange": 0,
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
    "bagCap": 200,
    "_autoOpen": "自动开启（A14，用户：\"宝箱可以设置是否自动开启——对应不同等阶不同的开启按钮\"）：**一阶一枚勾选**，勾上的那一阶一掉出来就当场开掉（`20-main.autoOpenChest`：照旧先出装备再结算，只是不经过背包 —— 于是也不吃 bagCap），没勾的照旧进背包等玩家点。开关表存在存档 `settings.chestAuto`（默认**全关**，写在 11-save 的 defaultSettings：不设的时候行为与 A13 一模一样），判定走 08-loot 的 `autoEnabled`。对应的**开启按钮也是一阶一枚**：宝箱清单每行右侧那枚「全开」，由 20-main 的 `openChestsOfTier` 把这**一阶**的箱子全开掉（颜色用该阶的阶色）"
  },

  "equipment": {
    "slots": [
      { "id": "weapon", "name": "武器", "mainStat": "attack" },
      { "id": "armor", "name": "衣服", "mainStat": "hp" },
      { "id": "boots", "name": "鞋子", "mainStat": "defense" },
      { "id": "trinket", "name": "饰品", "mainStat": "critChance" }
    ],
    "tiers": [
      { "id": 1, "name": "普通", "affixes": 1, "multiplier": 1.0, "glow": ["#ffffff"] },
      { "id": 2, "name": "专家", "affixes": 2, "multiplier": 1.35, "glow": ["#3f8cff"] },
      { "id": 3, "name": "史诗", "affixes": 3, "multiplier": 1.85, "glow": ["#a855f7"] },
      { "id": 4, "name": "传说", "affixes": 4, "multiplier": 2.6, "glow": ["#ffd479"] },
      { "id": 5, "name": "神话", "affixes": 5, "multiplier": 3.7, "glow": ["#ff4d4d"] },
      { "id": 6, "name": "天赐", "affixes": 5, "multiplier": 5.3, "uniqueAffix": true, "glow": ["#ff4d4d", "#ffa64d", "#ffe066", "#5ce65c", "#4dc3ff", "#b06bff"] }
    ],
    "_glow": "六阶**发光色**（用户：\"给不同等阶的装备添加发光颜色，分别为白色，蓝色，紫色，金色，红色，炫彩\"）：颜色挂在这一阶的 glow 上（一阶一个颜色，六阶天赐是一串 = **炫彩**），由 16-icons 的 frame / glowRing 给装备格 / 背包格 / 箱子格画外发光，背包面板的角色预览也取**身上最高那一阶**画一束光。画法规格在 view.iconGlow。**阶色**（16-icons 的 TIER_COLORS：框的描边与名字颜色）是另一件事 —— 框还是阶色，发光是后加的一层，两者不要混成一件",
    "_catalog": "六阶各 10 件（武器 3 / 衣服 3 / 鞋 2 / 饰品 2）共 60 件：宝箱开出来的装备就是从这里抽的。外观字段（weapon/armor/boots/trinket + 配色）由 16-render.js 画在角色身上、由 16-icons.js 画成背包内观（程序自绘，不贴图）。同一阶里越靠后越强（statMul = 1 + index*statMulPerIndex），等级门槛也越高。",
    "mainStatBase": { "attack": 6, "hp": 40, "defense": 3, "critChance": 0.008 },
    "mainStatPerLevel": { "attack": 0.9, "hp": 6.5, "defense": 0.45, "critChance": 0.0006 },
    "levelRequirement": { "perTier": 3, "base": 1, "itemsPerStep": 4 },
    "catalogStep": { "statMulPerIndex": 0.02 },
    "catalog": [
      { "id": "t1_woodsword", "name": "木剑", "tier": 1, "slot": "weapon", "weapon": "sword", "blade": "#c9a06a", "grip": "#7a5a38", "guard": "#b98b4e" },
      { "id": "t1_knife", "name": "猎刀", "tier": 1, "slot": "weapon", "weapon": "dagger", "blade": "#d8dde6", "grip": "#6b4a2c", "guard": "#9aa0ad" },
      { "id": "t1_stonehammer", "name": "石锤", "tier": 1, "slot": "weapon", "weapon": "hammer", "blade": "#9aa0ad", "grip": "#7a5a38", "guard": "#8d939c" },
      { "id": "t1_clothrobe", "name": "粗布衣", "tier": 1, "slot": "armor", "armor": "robe", "cloth": "#8d7d63", "trim": "#c8b48c" },
      { "id": "t1_leathera", "name": "皮革甲", "tier": 1, "slot": "armor", "armor": "leather", "cloth": "#8a5a34", "trim": "#c9a06a" },
      { "id": "t1_hemptunic", "name": "麻布袍", "tier": 1, "slot": "armor", "armor": "tunic", "cloth": "#a99a7c", "trim": "#7d6a4a" },
      { "id": "t1_strawsandals", "name": "草鞋", "tier": 1, "slot": "boots", "boots": "sandal", "color": "#b59a5e", "sole": "#6b5a36" },
      { "id": "t1_clothboots", "name": "布靴", "tier": 1, "slot": "boots", "boots": "boot", "color": "#6d6a7a", "sole": "#3f3d4a" },
      { "id": "t1_woodbeads", "name": "木珠串", "tier": 1, "slot": "trinket", "trinket": "amulet", "gem": "#c9a06a", "metal": "#7a5a38" },
      { "id": "t1_copperring", "name": "铜指环", "tier": 1, "slot": "trinket", "trinket": "ring", "gem": "#e0a76a", "metal": "#b98b4e" },
      { "id": "t2_ironsword", "name": "铁剑", "tier": 2, "slot": "weapon", "weapon": "sword", "blade": "#dbe4f2", "grip": "#5a3f28", "guard": "#c8ccd6" },
      { "id": "t2_ironlance", "name": "铁枪", "tier": 2, "slot": "weapon", "weapon": "spear", "blade": "#dbe4f2", "grip": "#6b4a2c", "guard": "#c8ccd6" },
      { "id": "t2_waraxe", "name": "战斧", "tier": 2, "slot": "weapon", "weapon": "axe", "blade": "#cfd6e2", "grip": "#5a3f28", "guard": "#8d939c" },
      { "id": "t2_chainmail", "name": "锁子甲", "tier": 2, "slot": "armor", "armor": "mail", "cloth": "#8d939c", "trim": "#c8ccd6" },
      { "id": "t2_ironplate", "name": "铁片胸甲", "tier": 2, "slot": "armor", "armor": "plate", "cloth": "#9aa0ad", "trim": "#dbe4f2" },
      { "id": "t2_leathercloak", "name": "皮风衣", "tier": 2, "slot": "armor", "armor": "cloak", "cloth": "#7a5a38", "trim": "#c9a06a" },
      { "id": "t2_irongreaves", "name": "铁靴", "tier": 2, "slot": "boots", "boots": "greave", "color": "#8d939c", "sole": "#4a4f5c" },
      { "id": "t2_travelerboots", "name": "旅人靴", "tier": 2, "slot": "boots", "boots": "boot", "color": "#6b4a2c", "sole": "#3f2e1c" },
      { "id": "t2_moonpendant", "name": "银月坠", "tier": 2, "slot": "trinket", "trinket": "amulet", "gem": "#dbe4f2", "metal": "#c8ccd6" },
      { "id": "t2_ironring", "name": "铁镶戒", "tier": 2, "slot": "trinket", "trinket": "ring", "gem": "#9ad4ff", "metal": "#8d939c" },
      { "id": "t3_fineblade", "name": "精铁长剑", "tier": 3, "slot": "weapon", "weapon": "sword", "blade": "#eaf2ff", "grip": "#3f2e1c", "guard": "#ffd479" },
      { "id": "t3_mithrilknife", "name": "秘银短刃", "tier": 3, "slot": "weapon", "weapon": "dagger", "blade": "#cdd7ff", "grip": "#2f3a5c", "guard": "#9ad4ff" },
      { "id": "t3_runewarhammer", "name": "符文战锤", "tier": 3, "slot": "weapon", "weapon": "hammer", "blade": "#c9a6ff", "grip": "#3f2e1c", "guard": "#ffd479" },
      { "id": "t3_mithrilmail", "name": "秘银锁甲", "tier": 3, "slot": "armor", "armor": "mail", "cloth": "#6f8fd8", "trim": "#cdd7ff" },
      { "id": "t3_runerobe", "name": "符文法袍", "tier": 3, "slot": "armor", "armor": "robe", "cloth": "#4f5fa8", "trim": "#c9a6ff" },
      { "id": "t3_lionleather", "name": "狮纹皮甲", "tier": 3, "slot": "armor", "armor": "leather", "cloth": "#b57a3a", "trim": "#ffd479" },
      { "id": "t3_galewindgreaves", "name": "疾风长靴", "tier": 3, "slot": "boots", "boots": "greave", "color": "#6f8fd8", "sole": "#2f3a5c" },
      { "id": "t3_runegreaves", "name": "符文战靴", "tier": 3, "slot": "boots", "boots": "plateboot", "color": "#c9a6ff", "sole": "#4a3a6b" },
      { "id": "t3_starpendant", "name": "星辉吊坠", "tier": 3, "slot": "trinket", "trinket": "amulet", "gem": "#9ad4ff", "metal": "#cdd7ff" },
      { "id": "t3_bluering", "name": "蓝瞳指环", "tier": 3, "slot": "trinket", "trinket": "ring", "gem": "#6fd0ff", "metal": "#9aa0ad" },
      { "id": "t4_dragonfang", "name": "龙牙巨剑", "tier": 4, "slot": "weapon", "weapon": "greatsword", "blade": "#ffd8a8", "grip": "#6b2f2f", "guard": "#ffd479" },
      { "id": "t4_thunderlance", "name": "雷鸣长枪", "tier": 4, "slot": "weapon", "weapon": "spear", "blade": "#9ad4ff", "grip": "#2f3a5c", "guard": "#ffd479" },
      { "id": "t4_flameaxe", "name": "烈焰战斧", "tier": 4, "slot": "weapon", "weapon": "axe", "blade": "#ff9b5a", "grip": "#5a2f1c", "guard": "#ffd479" },
      { "id": "t4_dragonscale", "name": "龙鳞重铠", "tier": 4, "slot": "armor", "armor": "plate", "cloth": "#b8563f", "trim": "#ffd479" },
      { "id": "t4_thunderrobe", "name": "雷霆法袍", "tier": 4, "slot": "armor", "armor": "robe", "cloth": "#3f5fa8", "trim": "#9ad4ff" },
      { "id": "t4_shadowcloak", "name": "影袭斗篷", "tier": 4, "slot": "armor", "armor": "cloak", "cloth": "#2f2f4a", "trim": "#a9d5ff" },
      { "id": "t4_skystepgreaves", "name": "踏空战靴", "tier": 4, "slot": "boots", "boots": "plateboot", "color": "#8d939c", "sole": "#3a2f2a" },
      { "id": "t4_thunderboots", "name": "疾雷软靴", "tier": 4, "slot": "boots", "boots": "boot", "color": "#3f4f8c", "sole": "#2a2f4a" },
      { "id": "t4_dragonheart", "name": "龙心坠饰", "tier": 4, "slot": "trinket", "trinket": "amulet", "gem": "#ff8a5a", "metal": "#ffd479" },
      { "id": "t4_thundercrown", "name": "雷冠指环", "tier": 4, "slot": "trinket", "trinket": "crown", "gem": "#9ad4ff", "metal": "#ffd479" },
      { "id": "t5_frostmoon", "name": "霜月神剑", "tier": 5, "slot": "weapon", "weapon": "greatsword", "blade": "#dff0ff", "grip": "#3a4a6b", "guard": "#9ad4ff" },
      { "id": "t5_voidstaff", "name": "虚空法杖", "tier": 5, "slot": "weapon", "weapon": "staff", "blade": "#c9a6ff", "grip": "#33234a", "guard": "#6fd0ff" },
      { "id": "t5_skyhammer", "name": "天陨战锤", "tier": 5, "slot": "weapon", "weapon": "hammer", "blade": "#c9a6ff", "grip": "#4a3a6b", "guard": "#ffd479" },
      { "id": "t5_divineplate", "name": "神纹圣铠", "tier": 5, "slot": "armor", "armor": "plate", "cloth": "#e8e2c8", "trim": "#ffd479" },
      { "id": "t5_moonrobe", "name": "月华仙袍", "tier": 5, "slot": "armor", "armor": "robe", "cloth": "#4a5fa8", "trim": "#dff0ff" },
      { "id": "t5_stararmor", "name": "星辰战衣", "tier": 5, "slot": "armor", "armor": "mail", "cloth": "#3f4f8c", "trim": "#c9a6ff" },
      { "id": "t5_divinegreaves", "name": "神行仙靴", "tier": 5, "slot": "boots", "boots": "greave", "color": "#dff0ff", "sole": "#4a5fa8" },
      { "id": "t5_cloudboots", "name": "踏云靴", "tier": 5, "slot": "boots", "boots": "boot", "color": "#e8f1ff", "sole": "#8d9bb5" },
      { "id": "t5_oracleeye", "name": "神谕之眼", "tier": 5, "slot": "trinket", "trinket": "orb", "gem": "#6fd0ff", "metal": "#dff0ff" },
      { "id": "t5_zodiacring", "name": "星象戒", "tier": 5, "slot": "trinket", "trinket": "ring", "gem": "#c9a6ff", "metal": "#e8e2c8" },
      { "id": "t6_destinyblade", "name": "天命之剑", "tier": 6, "slot": "weapon", "weapon": "greatsword", "blade": "#fff3d0", "grip": "#6b2f2f", "guard": "#ffd479" },
      { "id": "t6_creationstaff", "name": "创世法杖", "tier": 6, "slot": "weapon", "weapon": "staff", "blade": "#ffe6a8", "grip": "#3a2f5c", "guard": "#ffffff" },
      { "id": "t6_meteoraxe", "name": "星陨神斧", "tier": 6, "slot": "weapon", "weapon": "axe", "blade": "#ffd479", "grip": "#4a2f2f", "guard": "#fff3d0" },
      { "id": "t6_blessedplate", "name": "天赐圣铠", "tier": 6, "slot": "armor", "armor": "plate", "cloth": "#ffd479", "trim": "#ffffff" },
      { "id": "t6_apocalyprobe", "name": "天启圣袍", "tier": 6, "slot": "armor", "armor": "robe", "cloth": "#fff3d0", "trim": "#ffd479" },
      { "id": "t6_eternalarmor", "name": "永恒战衣", "tier": 6, "slot": "armor", "armor": "mail", "cloth": "#e8e2c8", "trim": "#fff3d0" },
      { "id": "t6_destinygreaves", "name": "天命战靴", "tier": 6, "slot": "boots", "boots": "plateboot", "color": "#ffd479", "sole": "#6b5a36" },
      { "id": "t6_lightsteps", "name": "流光仙履", "tier": 6, "slot": "boots", "boots": "boot", "color": "#ffffff", "sole": "#ffd479" },
      { "id": "t6_eternalheart", "name": "永恒之心", "tier": 6, "slot": "trinket", "trinket": "amulet", "gem": "#ffffff", "metal": "#ffd479" },
      { "id": "t6_blessedring", "name": "天赐星环", "tier": 6, "slot": "trinket", "trinket": "ring", "gem": "#fff3d0", "metal": "#ffffff" }
    ],
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
    "_readme": "商城（A4 起）：一件货一个价，买卖只在 20-main 里做（金币只在那里扣）。horn = 建公会用；stone = 铁匠强化用（本次新增，100 金币一颗）",
    "horn": { "id": "guild_horn", "name": "公会号角", "priceGold": 500 },
    "stone": { "id": "enhance_stone", "name": "强化石", "priceGold": 100 }
  },

  "guild": {
    "memberCap": 20,
    "anchorMinDistance": 2000,
    "teleportCooldownMs": 300000,
    "teleportCombatLockMs": 3000,
    "unlockLevel": 20,
    "shopUnlockLevel": 20,
    "_readme": "公会（本次新增，用户要求「创建公会需要自己输入公会名，公会页面显示公会人员、公会等级、公会信息」）：名字与昵称**同一套字符规则**（nameMin/nameMax，上服务端时服务端再验一遍 —— 客户端那份管手感，服务端那份管权威）；memberCap = 人数上限（含会长）；levelDivisor / levelCap = 公会**等级**的唯一算法：level = 1 + floor(成员等级之和 / levelDivisor)，封顶 levelCap —— 用成员等级而不是另立一套公会经验，是因为服务端**本来就存着每个账号的存档**（saves 表里有 level），于是\"公会多强\"不需要任何新的上报接口，也不能被客户端伪造；onlineWindowMs = 多久没跟服务端说过话就算离线（服务端自己的 presence 窗口，两边用同一个数）；syncIntervalMs = 公会面板打开时自动刷新服务端成员的间隔",
    "nameMin": 2,
    "nameMax": 12,
    "levelDivisor": 100,
    "levelCap": 10,
    "onlineWindowMs": 120000,
    "syncIntervalMs": 15000
  },

  "enhance": {
    "_readme": "铁匠强化（本次新增，用户要求「强化等级+1到+10，每次强化消耗强化石，强化石可以在商城购买（100金币一个），强化等级越高消耗的强化石越多，比如+1需要1个，+2需要2个，+3需要4个，依此类推」）：**每级翻倍**（baseStones x growth^当前等级），所以 +0 升到 +10 一共 1+2+4+...+512 = 1023 颗。每一级给这件装备的**主属性**再加 statPerLevel（0.1 = 每级 +10%，+10 正好翻倍），战力随主属性重算 —— 于是「强化」和「换装备」是同一把尺子（背包里的 ↑↓ 直接可读）。等级存在**装备自己身上**（item.enhance），所以它跟着这件装备走：卖了就没了、换一件就是另一套等级。规则本身只有 09-equipment 一处实现，20-main 的 enhanceItem 是唯一改存档的入口",
    "maxLevel": 10,
    "baseStones": 1,
    "growth": 2,
    "statPerLevel": 0.1
  },

  "auto": {
    "_readme": "自动战斗按钮（A4）：开启后自动走向全地图最近的怪（combat.targetRange = 0 = 不限距离），进攻击距离就站住（出手仍由 14-world 的自动攻击负责）",
    "moveStopRatio": 0.82,
    "retargetMs": 500
  },

  "skills": {
    "_readme": "技能栏（A5）：四个技能键，点一下放（冷却按毫秒）。冷却记在运行时，不进存档；自动战斗开着时从左到右自动放，治疗只在血量低于 autoHealRatio 时放",
    "globalCooldownMs": 300,
    "autoHealRatio": 0.6,
    "castEffectMs": 320,
    "healEffectRadius": 96,
    "slots": [
      { "id": "cleave", "name": "横扫", "key": "斩", "type": "aoe", "unlockLevel": 1, "cooldownMs": 4000, "damageMul": 1.6, "radius": 210 },
      { "id": "mend", "name": "疗愈", "key": "疗", "type": "heal", "unlockLevel": 4, "cooldownMs": 22000, "healRatio": 0.4 },
      { "id": "pierce", "name": "穿刺", "key": "刺", "type": "strike", "unlockLevel": 7, "cooldownMs": 7000, "damageMul": 2.6, "range": 420 },
      { "id": "whirl", "name": "旋风", "key": "旋", "type": "aoe", "unlockLevel": 10, "cooldownMs": 12000, "damageMul": 1.1, "radius": 330 }
    ]
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
    "stickRadius": 160,
    "knobDiameter": 34,
    "deadZone": 0.18,
    "pressFeedbackMs": 140,
    "zoneWidthRatio": 1,
    "zoneHeightRatio": 0.68,
    "attackButtonDiameter": 96,
    "autoButtonDiameter": 96
  },

  "view": {
    "designWidth": 720,
    "_cameraTiers": "视角档位（A11，用户：\"地图、相机视角还需要优化，需要让地图更加细节，玩家视角更加清晰\"）：每档由**一屏横向多少格**定义，zoom = designWidth / (tiles × world.tileSize)（自检逐档验这个等式）。lodBlockTiles = 这一档宏观地表的色格边长（**按 tile 数**，1 = 逐格）；每档的细节与代价见 lodBlockTiles / lodBlend 的说明。cameraTier 是启动档位（0 远 / 1 中 / 2 近）—— **A11 之三起默认改成近档**（默认一屏 22 格离它最近；换档同时把缩放轴放到那一档的格数上，两个入口因此永远指向同一个倍率），运行时由存档里的 settings.zoomTier 覆盖",
    "cameraTiers": [
      { "id": "far", "name": "远", "tiles": 128, "zoom": 0.17578125, "lodBlockTiles": 4, "loadRing": 1 },
      { "id": "mid", "name": "中", "tiles": 64, "zoom": 0.3515625, "lodBlockTiles": 1, "loadRing": 2 },
      { "id": "near", "name": "近", "tiles": 32, "zoom": 0.703125, "lodBlockTiles": 1, "loadRing": 2 }
    ],
    "cameraTier": 2,
    "_zoomTiles": "视角缩放轴当前值（A11 之二，用户：\"玩家设置中添加视角缩放滚动轴，可以缩到16-64\"）：单位是**一屏横向多少格**，运行时倍率唯一的来源 —— zoom = designWidth / (zoomTiles × world.tileSize)。正落在某个预设档位上时（zoomTiles == 那一档的 tiles）直接返回表里的 zoom，所以 128 / 64 / 32 这三个标准值永远是精确数（自检逐档验这条等式）；拖到两档之间才现算。设置面板里的滚动轴写它，存档 settings.zoomTiles 记它。**A11 之三：默认值 = 用户指定的 22 格**（比近档 32 格再近一档：人物更大、脚下地表的斑驳看得更清；22 不是预设档位，档名因此如实显示「自定义」，而不是硬套一个「近」）",
    "zoomTiles": 22,
    "_zoomSlider": "视角缩放轴（设置面板里那一行可以拖的滑动条，A11 之二）：minTiles ~ maxTiles = 用户指定的 16 ~ 64 格（左 = 拉近看细节、右 = 拉远看范围），**按整格走**（一屏 16..64 格 = 49 个位置，界面上的数始终是整数）。trackHeight / knobRadius / endPad 是画法规格：endPad = 圆钮圆心离轨道两端的距离（>= knobRadius，保证滑到头时圆钮也不越出轨道）。minTiles 同时是**硬下限**（再近一屏就装不下 2x2 个 chunk，怪会贴到脸上）；maxTiles 只限制**滑块** —— 远档 128 格仍由 cameraTiers 的预设提供（本版没有界面入口，留给工具与自检）",
    "zoomSlider": { "minTiles": 16, "maxTiles": 64, "trackHeight": 22, "knobRadius": 20, "endPad": 26 },
    "_lodZoom": "地表 / 装饰的细节档（A8）：zoom 低于此值时一格已不足 ~9 CSS px，16×16 的逐格色档、土斑、一件一件的装饰全是亚像素噪点 —— 地表改成按本档的 lodBlocks 粗抽样 + 同色跨 chunk 批量落笔，装饰改成宏观斑（见 lodDecorBlobs）。**三个视角档位里只有远(0.176)与中(0.352)低于它**，近档(0.703)走真正的逐格档。没有这一档，128 格视野会把地表落笔从 62 顶到 ~700，直接把 900 的预算吃掉",
    "lodZoom": 0.5,
    "_actorMinZoom": "演员层最小观感倍率（A9，用户：\"还有人物的大小\"）：zoom 低于它时，**点状的东西**（角色 / 怪的身体与影子 / 身上的动画 / 选中与仇恨指示 / 弹道）按 actorMinZoom / zoom 反向放大，观感不再低于这个倍率。0.8 = 与 A6 时代的角色一样大（手机上直径 ~20 CSS px）—— **三个视角档位下角色都是这个大小**（远档放大 4.55 倍、中档 2.27 倍、近档 1.14 倍），所以换档只换\"看得到多少地\"，不换\"我看得清不清\"。**面状的东西一律不放大**：地表 / 路 / 营地 / 地标 / 攻击范围与 AoE 环仍是世界尺寸 —— 所以攻击范围环在宏观视角下会被放大的身体盖住，那时干脆不画它",
    "actorMinZoom": 0.8,
    "_lodBlockTiles": "宏观档色格的边长（**按 tile 数**算，A11）：远档 4 格（手机上 11.7 CSS px，再细就是亚像素噪点）、中档 **1 格**（= 逐格采样，手机上 5.9 CSS px —— 同样是\"一屏\"，地表的斑驳比远档细一倍）、近档 1 格（它其实走逐格档，见 lodZoom）。色格少了对比就会糊，所以每一档都往本主题的主色混 view.lodBlend 收一收（见 16-render 的 macroColors）",
    "lodBlend": 0.45,
    "_lodDecorBlobs": "宏观档的装饰斑（A9）：每 chunk 最多几个\"草甸 / 石滩 / 林地\"斑（由该 chunk **真实的**装饰流聚合而来，见 TERRAIN.decorBlobs）—— 装饰不再一件一件画（亚像素噪点），但植被结构在 128 格视野里看得出来。0 = 退回\"远距没有装饰\"",
    "lodDecorBlobs": 2,
    "_icon": "程序自绘图标尺寸（A6）：功能键圆里一个、面板行左侧一个、部位格一个",
    "icon": { "buttonSize": 57, "rowSize": 80, "captionSize": 17, "slotSize": 60 },
    "_iconGlow": "装备等阶发光的画法规格（用户：\"给不同等阶的装备添加发光颜色，分别为白色，蓝色，紫色，金色，红色，炫彩\"）：颜色本身在 equipment.tiers[].glow（那是装备的属性），这里只有\"怎么画\" —— enabled = 总开关（关掉就退回\"只有阶色描边\"，自检会验这一条）、layers = 往外画几层八角环（越外越淡）、spreadRatio = 最外一层的外扩量（= 框边长 × 它 —— 背包格 / 装备槽 / 行图标的尺寸不同，按比例才不会一大一小）、lineWidth = 每层描边的粗细、alpha = 最内一层的不透明度、pulseMs + pulseAmp = 呼吸的周期与幅度（**三角波**，16-icons 是 trig-free 的，不许用 sin）、spinMs = 炫彩阶每过这么久换一个颜色格（层与层再错开一位 = 看着像在流动）、haloRadiusMul + haloLayers + haloAlpha = 角色预览脚下那束光（半径 = 面板的 heroRadius × haloRadiusMul，颜色取身上最高那一阶）",
    "iconGlow": {
      "enabled": true,
      "layers": 3,
      "spreadRatio": 0.09,
      "lineWidth": 2,
      "alpha": 0.42,
      "pulseMs": 1500,
      "pulseAmp": 0.45,
      "spinMs": 900,
      "haloRadiusMul": 1.9,
      "haloLayers": 3,
      "haloAlpha": 0.22
    },
    "minimap": { "size": 252, "margin": 39, "chunkRadius": 3 },
    "_panel": "面板卡片：宽 = 屏宽 - leftMargin - rightReserve（rightReserve 给右下功能键让位），高 = 屏高 x heightRatio。**2026-10-01 用户布局改动：heightRatio 0.42 -> 0.66**（卡片从「约 1/3 屏」变成「约 2/3 屏高」：0.90 宽 x 0.66 高 约等于 59% 屏面积）。目的很直白 —— 背包内容约 1492 设计 px，卡片里的视口从 ~580 变成 ~964，少滚一截；底边仍然压在整条吸底动作栏之上（实测 1284 <= 1304 设计单位，再高就要压到功能键了）。想回老样子就把 heightRatio 改回 0.42",
    "panel": {
      "leftMargin": 25,
      "rightReserve": 48,
      "_leftReserve": "卡片左边再让出的宽度（本次新增）：= 左侧边栏的整条宽度（圆心 62 + 半径 41 + 底板 pad 12 = 115，再留一点缝）。**为什么必须让**：20-main 的三层触摸路由是\"卡片优先于输入层\"，卡片盖住侧边栏就等于侧边栏点不到；让开之后侧边栏永远露在卡片外（自检有一条断言盯着这条缝）。改侧边栏的 left / radius / pad 时这个数要跟着改",
      "leftReserve": 115,
      "heightRatio": 0.66,
      "headerHeight": 92,
      "rowHeight": 120,
      "touchSlop": 12,
      "dimAlpha": 0.32,
      "_layout": "面板内的版面尺寸（A10，用户要求\"背包 / 宝箱 / 属性做成参考图那样\"）：背包 = 角色预览（四角四个装备槽）+ 技能自动释放条 + gridRows × gridColumns 的背包格 + statColumns 列的属性网格；宝箱 = 两个大按钮 + 两条保底进度条 + **六阶宝箱清单**（A13，用户：\"宝箱背包不需要格子，直接放不同等阶宝箱×数量\"：一阶一行 = 阶色箱子 + 阶名 + × 数量 + 掉落占比，固定 chestTierHeight × 六行，**没有的阶也照样占一行**；箱子格与六阶图例在 A13 撤掉了 —— 清单一行就把\"哪一阶、几个、多少概率\"说完）；属性 = 头像抬头 + 一行一张的属性卡（图标 + 数值 + 基础/装备）；宝箱清单每行右侧还有**两枚按阶的控件**（A14，用户：\"宝箱可以设置是否自动开启——对应不同等阶不同的开启按钮\"）：一枚「全开」按钮（chestOpenWidth × chestOpenHeight，开掉**这一阶**的全部箱子）+ 一枚「自动」勾选（chestAutoSide 的方框，勾上 = 这一阶掉出来就当场开），两者之间留 chestControlGap，数量文字排在它们左边。**尺寸只在这里改**，18-panels 只负责按它排版",
      "layout": {
        "cellGap": 8,
        "slotSize": 110,
        "slotInset": 16,
        "previewHeight": 340,
        "heroRadius": 70,
        "skillChipHeight": 84,
        "titleHeight": 44,
        "gridColumns": 5,
        "gridRows": 3,
        "gridCellHeight": 118,
        "statColumns": 2,
        "statCellHeight": 54,
        "statCardHeight": 92,
        "chestTierHeight": 92,
        "chestOpenWidth": 104,
        "chestOpenHeight": 62,
        "chestAutoSide": 32,
        "chestControlGap": 16,
        "bigButtonHeight": 92,
        "barHeight": 28,
        "iconSize": 44
      }
    },
    "nameplate": { "barWidth": 104, "barHeight": 10, "offsetY": 30 },
    "_hud": "吸底动作栏（A7）：经验条 —— barGap —— 技能栏 —— rowGap —— 功能图标栏，四层叠在一起；captionGap 是圆键旁边那行说明文字离圆的距离（算两行行距用的是同一个数）",
    "hud": { "avatarRadius": 45, "expBarHeight": 23, "barGap": 31, "captionGap": 10, "rowGap": 4 },
    "_skillBar": "技能栏（A7）：四个技能键**贴屏幕最底**（经验条正上方）、整排靠屏幕右边；margin 是整排右边离屏边的距离；技能名画在圆**上方**。A10 起每个键的右上角再挂一个「自动释放」勾选框（autoBox：side = 边长，offsetX / offsetY = 框心相对圆心的偏移，按半径的比例算 —— 0.7 × 0.7 的斜对角正好落在圆周上），勾上的那个才会被自动战斗放出去",
    "skillBar": { "radius": 53, "gap": 60, "nameSize": 13, "margin": 59, "autoBox": { "side": 38, "offsetX": 0.7, "offsetY": 0.7 } },
    "_functionBar": "功能图标栏（A7）：箱 / 包 / 会 / 设 / 自动，站在营地里再多一个「营」（占最左那个槽位）—— slots 是**固定**槽位数（整排按它居中），所以进出营地时其余键一个都不动。**2026-10-01 用户布局改动：slots 6 -> 7**：营地外那 5 个键因此正好居中（占槽位 1..5）。**A15 新增（商城键）：箱 / 包 / 会 / 设 / 自动 / 商 占槽位 1..6，gap 35 -> 20**（**本次改动：那枚「商」挪去了左边侧边栏**，所以这一行只剩 箱 / 包 / 会 / 设 / 自动 —— slot 6 空着，其余键的坐标一个都没动；侧边栏见 `_sideBar`） —— 新来的那枚「商」写死占槽位 6（与「营」写死占槽位 0 同一条纪律：进出营地 / 开关面板时其余键的坐标一个都不动），可是整排宽 = slots x 2 x radius + (slots-1) x gap = 7x82 + 6x35 = 784 设计单位 > 屏宽 720，槽位 6 的圆心会被推到屏外 32 单位（一小半按不到），于是整排收窄一档：7x82 + 6x20 = 694 设计单位 <= 720，营地外的 6 个键与营地里的「营」（槽位 0，圆心 x = 54）整套都在屏内 —— 上一版那个已知代价（「营」露在屏幕左边外 32 设计单位）也顺手消掉了",
    "functionBar": { "slots": 7, "radius": 41, "gap": 20 },
    "_sideBar": "左侧边栏（本次新增，用户要求「回到营地按钮设置在左边侧边栏，商城下面」）：贴左边缘**竖着排**的圆键 —— 上面那枚是「商」（商城），它下面那枚是「营」（回营地）。它与底部功能栏共用同一套画法与命中表（圆 + 圆下方说明），只是排成了一列。left = 圆心离左边屏幕的距离；top = 第一枚键的**上沿**离 `HUD.plateHeight()` 的距离（取 18 = 与面板卡片顶边齐平：卡片也是 plateHeight + 18 起画，于是侧边栏的第一枚键与卡片抬头在同一条水平线上）；gap = 两枚圆的间距 —— 它比功能栏的 20 大得多，因为这一列要**塞得下圆下方那行说明文字**（captionGap + captionSize ≈ 27），否则第二枚的圆会压到第一枚的字上；pad = 那条半透明底板的四周余量（`HUD.sideBarRect` 由第一枚与最后一枚键推出来）。**代价只有一处**：面板卡片要在左边让出这么宽（view.panel.leftReserve），否则卡片会盖住侧边栏（20-main 的三层路由先给卡片，盖住就等于点不到）",
    "sideBar": { "radius": 41, "gap": 58, "left": 62, "top": 18, "pad": 12 },
    "damageNumberMs": 700,
    "_feel": "打击感（A4）：斩击特效时长 / 受击顿帧 / 暴击震屏 —— 都是表现层，不进任何随机流。A7 修订 2（用户：去掉受伤震屏）：shake 只剩暴击那一档，挨打仍有 30ms 顿帧 + 音效 + 手机震动，但不再抖屏幕 —— 所以这里没有 hurtMs / hurtPower",
    "slashMs": 220,
    "slashCap": 24,
    "hitStopMs": { "normal": 45, "crit": 110, "hurt": 30 },
    "shake": { "critMs": 240, "critPower": 26 },
    "_cameraLerpPerTick": "相机跟随的插值比例（每逻辑帧）：1 = **锁定**，每帧直接把相机放到玩家位置上（角色恒在屏幕正中，A11 之三 用户：\"视角没有锁定以角色为中心\"）；小于 1 = 缓动跟随（镜头落后玩家一点点，换来坐标跳变时的顺滑）。**这个数只在\"缓动\"时才有意义** —— 传送 / 复活 / 读档 / 换档 / 拖缩放轴都走 snapCamera 直接贴合，所以缓动再小也不会把镜头丢在后面",
    "cameraLerpPerTick": 1,
    "_cameraLook": "相机前瞻（A11）：镜头往\"正在走的方向 / 正在打的目标\"前移 cameraLookAhead 世界单位（每逻辑帧按 cameraLookLerp 插值），屏幕正中因此是\"我 + 我要去的地方\"。**纯表现**：只动渲染用的相机，逻辑层读到的玩家坐标一个字节都不变（传送 / 复活 / 读档时前瞻归零）。**A11 之三：关掉了（= 0）** —— 用户原话\"视角没有锁定以角色为中心\"。原因：0.175 的远档里 240 单位只占半屏的 5.9%（看不出），但默认一屏 22 格时它占半屏的 **34%**、16 格时 47%，角色会被推到屏幕边上。锁定以角色为中心是硬要求，机制留着（改成非 0 就恢复），规则见 04-decisions #22",
    "cameraLookAhead": 0,
    "cameraLookLerp": 0.06,
    "_playerMark": "玩家标记（A11）：脚下常亮的一圈细环 + 四个刻度，**屏幕尺寸恒定**（不随视角档位变）—— 任何档位都能一眼找到\"我\"。它是指示物不是范围，所以按屏幕尺寸画（与名牌 / 血条同一条纪律）",
    "playerMarkRadius": 30,
    "playerMarkWidth": 2.5,
    "autosaveMs": 5000,
    "safeBottom": 0,
    "safeTop": 0,
    "_loadRingChunks": "装载环的兜底半径（A11 起通常走档位里的 loadRing）：以玩家所在 chunk 为中心预载几圈 —— 跨 chunk 时画面才不会突然空一块。环越大，视野里\"有装饰有怪\"的范围越大，代价是同时装载的 chunk（与怪）更多",
    "loadRingChunks": 1,
    "chunkCacheLimit": 48,
    "hudDamageNumberCap": 40
  }
};
