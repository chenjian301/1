/**
 * 11-save.js —— 本地存档 + 本机账号（阶段 A 的"数据不丢"靠它；阶段 B 再换成云存档）
 *
 * 阶段 A 只做**本地存档**（01-game-design §11：开发期自测不发网络请求）：
 *   - 首次进入：在距原点 300~800 的环内随机出生（决策 #5），之后登录回到**上次离线位置**；
 *   - 存档内容：角色名/等级/经验、金币、宝箱背包与保底计数、已穿装备、背包、公会、设置项、统计数据；
 *   - 读写全部走 `G.PLAT.storageGet / storageSet / storageRemove`（`tt.setStorageSync` 的一层薄封装），
 *     所以本文件**不出现 tt 字样**，照样能在 node 里断言（红线见 00-config.js）。
 *
 * 另外本文件还挂了两个模块：`G.ACCOUNT`（注册 / 登录 / 昵称唯一性，A4 新增）与
 * `G.GUILD`（公会规则与本地记录，本次新增）。
 * 放在这里的原因：它们和存档一样，是"本机持久化数据"，共用同一层存储封装；
 * 而**唯一性校验 / 成员表同步的网络那一半**仍在 20-main（这里只管规则与本地记录，方便 node 断言）。
 *
 * 为什么存档要带 `v`（版本号）：小游戏更新后老存档必须能被读（或者干脆安全地丢弃），
 * 不能让玩家一升级就白屏。读档失败一律回落到"新号"，并把原始文本留在内存里便于排查。
 *   v1 → v2（A4）：多了 `name`（角色名）与 `settings`（自动战斗 / 音效开关），
 *   迁移是**就地补齐默认值**，不丢等级金币装备（见 normalize）。
 *   v2 保持不变（本次新增）：`stones`（强化石）与装备上的 `enhance`（强化等级）都是
 *   **可选字段 + 明确的默认值**（0），老存档读进来就是"没买过石头、没强化过"，
 *   和 A10 的 skillAuto / A14 的 chestAuto 是同一类改动，所以不升版本号 ——
 *   升版本号意味着老存档会被**整份丢掉**（normalize 里 v 不认识就当新号），
 *   那才是真的丢数据。两条默认值都在 normalize / normalizeEnhance 里补齐。
 */

G.SAVE = (function () {
  'use strict';

  var BAL = G.BAL;
  var EQUIP = G.EQUIP;
  var SPAWN = G.SPAWN;
  /** 08-loot 在 11-save 之前装载（bundle 顺序），自动开启开关表的默认形状由它出 */
  var LOOT = G.LOOT;

  /** 存档格式版本（改结构就必须 +1，并在这里写迁移） */
  var SCHEMA_VERSION = 2;

  /** 能被 normalize 接受的旧版本：v1（A3 及以前）就地升级到 v2，不丢数据 */
  var MIN_READABLE_VERSION = 1;

  /**
   * 设置项的默认值：自动战斗默认**关**（用户要求"点击开启"），音效 / BGM / 震动默认开；
   * A10 新增的 `skillAuto`（四个技能键右上角的"自动释放"勾选）默认**全开** ——
   * 于是 A5 的行为一个字都不变，玩家想关哪个就关哪个。
   */
  function defaultSettings() {
    var skillAuto = [];
    for (var i = 0; i < BAL.skills.slots.length; i += 1) skillAuto.push(true);
    return {
      autoBattle: false,
      sfx: true,
      bgm: true,
      vibrate: true,
      skillAuto: skillAuto,
      /**
       * A14：按阶的「自动开启」宝箱勾选（一阶一枚，默认**全关**）—— 勾上的那一阶掉出来就当场开掉
       * （开箱在 20-main 的 `autoOpenChest`），没勾的照旧进背包等玩家点。
       * 形状（长度 = 阶数、全 false）由 08-loot 的 `defaultAutoFlags` 出，别在两处各写一份。
       */
      chestAuto: LOOT.defaultAutoFlags(),
      /** A11：视角档位（0 远 / 1 中 / 2 近）—— 默认取 `balance.view.cameraTier`（中档） */
      zoomTier: numberOr(BAL.view.cameraTier, 0, 0, BAL.view.cameraTiers.length - 1),
      /** A11 之二：视角缩放轴（一屏横向多少格）—— 默认取 `balance.view.zoomTiles`（中档 = 64 格） */
      zoomTiles: clampZoomTiles(BAL.view.zoomTiles)
    };
  }

  /**
   * 视角缩放轴的合法范围（格，A11 之二）：下限取 `view.zoomSlider.minTiles`（16）——
   * 再近一屏就装不下 2×2 个 chunk，怪会贴到脸上；上限取**表里最远那一档**（128），
   * 于是滑块虽然只画到 64 格，远档那个"一屏 128 格"的标准值仍然能被存档表达。
   */
  function zoomTilesMin() {
    return Math.max(1, Math.round(BAL.view.zoomSlider.minTiles));
  }

  function zoomTilesMax() {
    var tiers = BAL.view.cameraTiers;
    var max = Math.round(BAL.view.zoomSlider.maxTiles);
    for (var i = 0; i < tiers.length; i += 1) {
      if (tiers[i].tiles > max) max = tiers[i].tiles;
    }
    return max >= zoomTilesMin() ? max : zoomTilesMin();
  }

  /** 把任意输入夹成合法格数（非数字 → 取 balance 里的当前值；一律取整 —— 界面上的数是整的） */
  function clampZoomTiles(value) {
    return Math.round(numberOr(value, BAL.view.zoomTiles, zoomTilesMin(), zoomTilesMax()));
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
      /** 强化石（本次新增：商城 100 金币一颗，营地铁匠强化装备时消耗） */
      stones: 0,
      /**
       * 公会（本次新增的形状）：
       *   { id, name, level, exp, expForNext, levelCap, memberCap, members[], role, anchor, createdAt, syncAt, remote, teleportAt }
       * —— 服务端有这条公会时，本地这份是它的**镜像**；连不上云时它就是唯一真相
       * （规则与归一化见文件末的 `G.GUILD`）。新号还没有公会，所以是 null。
       */
      guild: null,
      /** 营地传送冷却（A4）：`used` 而不是"时间 > 0"—— 世界时间 0 也是合法时刻，别让第一帧传送漏掉冷却 */
      camp: { teleportAt: 0, used: false },
      /** 设置项（自动战斗 / 音效 / 震动）—— A4 起随存档走，换设备也记得 */
      settings: defaultSettings(),
      /** 统计（调试面板与将来的埋点用） */
      stats: { kills: 0, eliteKills: 0, opened: 0, playMs: 0, distance: 0, skillCasts: 0 }
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
    // A6：部位从 6 个（含头盔 / 手套）收敛成 4 个 —— 老存档里那两件的部位已经不存在了，
    // 直接丢掉：留着也穿不上，还会在背包里占一行看不懂的格子。
    save.items = [];
    if (raw.items && raw.items.length) {
      for (var k = 0; k < raw.items.length && save.items.length < BAL.chests.bagCap; k += 1) {
        var rawItem = raw.items[k];
        // 强化等级（本次新增）：缺字段 = 0 级；坏值（+999）被夹回上限 —— 见 09-equipment 的 normalizeEnhance
        if (rawItem && G.EQUIP.hasSlot(rawItem.slotId) && rawItem.main && rawItem.affixes) {
          save.items.push(G.EQUIP.normalizeEnhance(rawItem));
        }
      }
    }
    save.nextItemId = numberOr(raw.nextItemId, 1, 1, Infinity);
    save.horns = numberOr(raw.horns, 0, 0, 9999);
    // 强化石（本次新增）：v2 的老存档没有这个字段，缺省 0 —— 不补这一行的话读档后它是 undefined，
    // 商城里买第一颗会变成 NaN（"NaN 颗强化石"在真机上就是这么出现的）
    save.stones = numberOr(raw.stones, 0, 0, 999999);
    save.guild = G.GUILD.normalizeRecord(raw.guild, { name: save.name, level: save.level });
    save.camp = {
      teleportAt: numberOr(raw.camp && raw.camp.teleportAt, 0, 0, Infinity),
      used: !!(raw.camp && raw.camp.used === true)
    };

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
        distance: numberOr(raw.stats.distance, 0, 0, Infinity),
        skillCasts: numberOr(raw.stats.skillCasts, 0, 0, Infinity)
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
    // A10：技能自动释放的勾选。长度按技能表取（多出来的截掉、少了的补 true），
    // 只有明确写了 false 才关 —— 老存档没有这个字段，于是升级后四个技能照样会自动放。
    if (raw.skillAuto && typeof raw.skillAuto === 'object') {
      for (var i = 0; i < settings.skillAuto.length; i += 1) {
        if (raw.skillAuto[i] === false) settings.skillAuto[i] = false;
      }
    }
    // A11：视角档位（老存档没有这个字段 → 用默认档；坏值 / 越界夹到合法范围）
    settings.zoomTier = numberOr(raw.zoomTier, settings.zoomTier, 0, BAL.view.cameraTiers.length - 1);
    // A11 之二：视角缩放轴（一屏几格）。老存档没有这个字段 → 跟着档位走（中档 64 / 近档 32…），
    // 于是升级上来的号视角与升级前一模一样；坏值 / 越界（甚至 NaN）一律夹回 16 ~ 128。
    var tierTiles = BAL.view.cameraTiers[settings.zoomTier]
      ? BAL.view.cameraTiers[settings.zoomTier].tiles
      : BAL.view.zoomTiles;
    settings.zoomTiles = clampZoomTiles(raw.zoomTiles === undefined ? tierTiles : raw.zoomTiles);
    // A14：按阶的「自动开启」勾选（一阶一枚）。长度按阶数取，**只有明确写了 true 才开** ——
    // 老存档没有这个字段，于是升级后行为与 A13 一模一样（全关：箱子照旧进背包等玩家点）。
    settings.chestAuto = LOOT.defaultAutoFlags();
    if (raw.chestAuto && typeof raw.chestAuto === 'object') {
      for (var k = 0; k < settings.chestAuto.length; k += 1) {
        if (raw.chestAuto[k] === true) settings.chestAuto[k] = true;
      }
    }
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
    clampZoomTiles: clampZoomTiles,
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
 * G.GUILD —— 公会的**规则与本地记录**（本次新增）
 *
 * 用户要求："创建公会需要自己输入公会名，公会页面显示公会人员，公会等级，公会信息。"
 *
 * 为什么规则落在这个文件（而不是 18-panels）：面板只该负责排版，真正要能断言的是**数据形状** ——
 *   1. `validate`：公会名与昵称**同一套字符规则**（直接复用 G.ACCOUNT.validate）；
 *   2. `levelFrom`：公会等级的唯一算法 —— `level = 1 + floor(成员等级之和 / levelDivisor)`，封顶 levelCap；
 *      服务端 `douyin-cloud\svr\index.js` 用**同一道式子重算一遍**（客户端这份管手感，服务端那份管权威）；
 *   3. `normalizeRecord` / `fromServer`：把"存档里可能缺字段的老记录"和"服务端回的那一份"都收拾成
 *      同一个形状 —— 于是 18-panels / 20-main 只认一种公会对象，不会出现"某个字段这处有那处没有"。
 *
 * 记录形状（存在 `save.guild`）：
 *   { id, name, level, exp, expForNext, levelCap, memberCap, members[], role, anchor, createdAt, syncAt, remote, teleportAt }
 *   - `members` 每人 `{ name, level, online, role: 'leader'|'member', at }`（`at` = 入会时刻，0 = 不知道）；
 *   - `remote: true` = 服务端真有这条公会（本地这份是**镜像**）；false = 离线自建（连不上云时的唯一真相，
 *     单人玩法照旧成立 —— 决策 #10"单机永远能玩"）；
 *   - `teleportAt` = **本机**的回城冷却，刻意不减不传不上服务端：它是防滥用闸门，跟着存档走。
 *
 * 老存档（A15 以前的 `{ name, anchor, teleportAt }`）走 `normalizeRecord` 原地升级：补一名"我"当会长、
 * 等级按 1 级重算，下一次与服务端同步就会被真实数据覆盖 —— 所以不需要动 SCHEMA_VERSION。
 */
G.GUILD = (function () {
  'use strict';

  var BAL = G.BAL;

  /** 规则数字只有一份出处：`balance.guild`（改数值不用改代码） */
  function limits() {
    var config = BAL.guild;
    return {
      nameMin: config.nameMin,
      nameMax: config.nameMax,
      levelDivisor: config.levelDivisor,
      levelCap: config.levelCap,
      memberCap: config.memberCap,
      onlineWindowMs: config.onlineWindowMs
    };
  }

  function numberOr(value, fallback, min, max) {
    if (typeof value !== 'number' || !isFinite(value)) return fallback;
    if (value < min) return min;
    if (value > max) return max;
    return value;
  }

  /**
   * 公会名校验 → `{ ok, name, reason }`。
   *
   * 直接借 `G.ACCOUNT.validate`：字符集（中文 / 字母 / 数字 / 下划线）、长度、保留名全是同一套，
   * 连"先看非法字符再看长度"的顺序也一起继承（否则超长的脏串会被截断成一个合法名字）。
   * 只有一点不同：**本机昵称注册表不参与** —— 昵称去重是"这台设备上没人用过"，
   * 而公会名的唯一性是**全服**的，只有服务端说了算（`POST /api/guild/create` 的 409 name_taken）。
   */
  function validate(raw) {
    var check = G.ACCOUNT.validate(raw);
    if (!check.ok && check.reason === 'taken') return { ok: true, name: check.name, reason: '' };
    return check;
  }

  /** 校验失败的原因 → 给玩家看的一句话（把昵称那套文案里的"昵称"换成"公会名"） */
  function reasonText(reason) {
    var config = limits();
    if (reason === 'empty') return '公会名不能为空，点「输入公会名」打字';
    if (reason === 'illegal') return '公会名只能有中文、字母、数字和下划线';
    if (reason === 'tooShort') return '公会名至少 ' + config.nameMin + ' 个字符';
    if (reason === 'tooLong') return '公会名最多 ' + config.nameMax + ' 个字符';
    if (reason === 'reserved') return '这个公会名是保留名，换一个';
    if (reason === 'taken') return '这个公会名全服已有人用，换一个';
    return '公会名不可用';
  }

  /**
   * 公会等级（用户要求"公会页面显示公会等级"）：`level = 1 + floor(成员等级之和 / levelDivisor)`，封顶 levelCap。
   *
   * 为什么用"成员等级之和"而不是另立一套公会经验：服务端**本来就存着每个账号的存档**（`saves` 表里有 level），
   * 所以"公会多强"是现成的、不需要任何新的上报接口，客户端也伪造不了。
   * 返回 `{ level, exp, expForNext, into, pct }` —— `pct` 是升级进度条要的比例（满级恒 1）。
   */
  function levelFrom(totalMemberLevel) {
    var config = limits();
    var exp = 0;
    if (typeof totalMemberLevel === 'number' && isFinite(totalMemberLevel) && totalMemberLevel > 0) {
      exp = Math.floor(totalMemberLevel);
    }
    var level = 1 + Math.floor(exp / config.levelDivisor);
    if (level > config.levelCap) level = config.levelCap;
    var into = exp - (level - 1) * config.levelDivisor;
    if (into < 0) into = 0;
    // 满级之后进度条钉在满格：再涨也不会"溢出到下一级"（levelCap 是硬上限）
    if (level >= config.levelCap) into = config.levelDivisor;
    return {
      level: level,
      exp: exp,
      expForNext: config.levelDivisor,
      into: into,
      pct: into / config.levelDivisor
    };
  }

  /** 成员等级之和（levelFrom 的输入；坏成员一律当 1 级） */
  function sumLevels(members) {
    var total = 0;
    if (!members) return 0;
    for (var i = 0; i < members.length; i += 1) {
      total += numberOr(members[i] && members[i].level, 1, 1, 9999);
    }
    return total;
  }

  /** 一条成员记录收拾干净（名字走昵称清洗；role 只认会长 / 成员两档） */
  function normalizeMember(raw) {
    if (!raw) return null;
    var name = G.ACCOUNT.sanitizeName(raw.name);
    if (!name) return null;
    return {
      name: name,
      level: numberOr(raw.level, 1, 1, 9999),
      online: raw.online === true,
      role: raw.role === 'leader' ? 'leader' : 'member',
      at: numberOr(raw.at, 0, 0, Infinity)
    };
  }

  /**
   * 公会记录归一化：任何缺字段 / 坏值 / 老版本形状都修成可用的（**名字都没有就当"没有公会"**）。
   * `self` 是"我"（`{ name, level }`）—— 老存档里没有成员表，得用我来补第一位会长；
   * 等级优先读记录里的（服务端同步过的就是权威值），没有才按成员等级之和现算。
   */
  function normalizeRecord(raw, self) {
    if (!raw || typeof raw !== 'object') return null;
    var name = G.ACCOUNT.sanitizeName(raw.name);
    if (!name) return null;
    var config = limits();
    var me = self || {};
    var members = [];
    if (raw.members && raw.members.length) {
      for (var i = 0; i < raw.members.length && members.length < config.memberCap; i += 1) {
        var member = normalizeMember(raw.members[i]);
        if (member) members.push(member);
      }
    }
    if (!members.length) {
      members.push({
        name: G.ACCOUNT.sanitizeName(me.name) || name,
        level: numberOr(me.level, 1, 1, 9999),
        online: true,
        role: 'leader',
        at: 0
      });
    }
    var anchor =
      raw.anchor && isFinite(raw.anchor.x) && isFinite(raw.anchor.y)
        ? { x: raw.anchor.x, y: raw.anchor.y }
        : { x: 0, y: 0 };
    var stats = levelFrom(sumLevels(members));
    return {
      id: typeof raw.id === 'string' ? raw.id : '',
      name: name,
      // 等级 / 经验都夹在合法区间里：服务端回什么就是什么，但坏值不许把界面搞乱
      level: numberOr(raw.level, stats.level, 1, config.levelCap),
      exp: numberOr(raw.exp, stats.exp, 0, Infinity),
      expForNext: numberOr(raw.expForNext, stats.expForNext, 1, Infinity),
      levelCap: config.levelCap,
      memberCap: config.memberCap,
      members: members,
      role: raw.role === 'member' ? 'member' : 'leader',
      anchor: anchor,
      createdAt: numberOr(raw.createdAt, 0, 0, Infinity),
      syncAt: numberOr(raw.syncAt, 0, 0, Infinity),
      remote: raw.remote === true,
      // 回城冷却（本机闸门）：**不跟着服务端走**，缺字段 = 从没传送过
      teleportAt: numberOr(raw.teleportAt, 0, 0, Infinity)
    };
  }

  /** 离线自建公会：会长就是"我"，锚点取创建时脚下，`remote:false` */
  function create(name, self, anchor, at) {
    var me = self || {};
    return normalizeRecord(
      {
        name: name,
        anchor: anchor || { x: 0, y: 0 },
        createdAt: at || 0,
        role: 'leader',
        members: [{ name: me.name, level: me.level, online: true, role: 'leader', at: at || 0 }]
      },
      me
    );
  }

  /**
   * 服务端的公会对象 → 本地镜像（`POST /api/guild/*` 与 `GET /api/guild/mine` 的响应都走这里）。
   * 约定：`body.guild` 里带的就是权威数据（名字 / 成员 / 等级 / 锚点），`body.role` 是"我的身份"。
   * 返回 null = 这份响应不能用（调用方保留本机那份，绝不拿半截数据覆盖存档）。
   */
  function fromServer(body, self, now) {
    if (!body || body.ok !== true || !body.guild) return null;
    var record = normalizeRecord(body.guild, self);
    if (!record) return null;
    record.id = typeof body.guild.id === 'string' ? body.guild.id : record.id;
    record.remote = true;
    record.syncAt = numberOr(now, 0, 0, Infinity);
    record.role = body.role === 'member' ? 'member' : record.role;
    return record;
  }

  /** 会长的成员记录（成员列表第一行永远是它） */
  function leaderOf(record) {
    if (!record || !record.members) return null;
    for (var i = 0; i < record.members.length; i += 1) {
      if (record.members[i].role === 'leader') return record.members[i];
    }
    return record.members.length ? record.members[0] : null;
  }

  function isLeader(record) {
    return !!record && record.role === 'leader';
  }

  function countOnline(record) {
    if (!record || !record.members) return 0;
    var count = 0;
    for (var i = 0; i < record.members.length; i += 1) {
      if (record.members[i].online === true) count += 1;
    }
    return count;
  }

  /**
   * 成员列表的显示顺序：**会长第一**，其余"在线的排前面、同级按名字稳排"。
   * 排序必须给定序（`localeCompare` 在真机与 node 上可能不同）：这里按 code point 比，结果可复现。
   */
  function sortedMembers(record) {
    if (!record || !record.members) return [];
    var list = record.members.slice(0);
    list.sort(function (a, b) {
      if (a.role !== b.role) return a.role === 'leader' ? -1 : 1;
      if (a.online !== b.online) return a.online ? -1 : 1;
      if (a.level !== b.level) return b.level - a.level;
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });
    return list;
  }

  /** 一行摘要："成员 3 / 20 · 在线 2"（面板抬头、提示语都用它，措辞只有一处） */
  function memberText(record) {
    if (!record) return '没有公会';
    return '成员 ' + record.members.length + ' / ' + record.memberCap + ' · 在线 ' + countOnline(record);
  }

  return {
    limits: limits,
    validate: validate,
    reasonText: reasonText,
    levelFrom: levelFrom,
    sumLevels: sumLevels,
    normalizeMember: normalizeMember,
    normalizeRecord: normalizeRecord,
    create: create,
    fromServer: fromServer,
    leaderOf: leaderOf,
    isLeader: isLeader,
    countOnline: countOnline,
    sortedMembers: sortedMembers,
    memberText: memberText
  };
})();
