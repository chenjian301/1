/**
 * 11-save.js —— 本地存档（阶段 A 的"数据不丢"靠它；阶段 B 再换成云存档）
 *
 * 阶段 A 只做**本地存档**（01-game-design §11：开发期自测不发网络请求）：
 *   - 首次进入：在距原点 300~800 的环内随机出生（决策 #5），之后登录回到**上次离线位置**；
 *   - 存档内容：等级/经验、金币、宝箱背包与保底计数、已穿装备、背包、公会、统计数据；
 *   - 读写全部走 `G.PLAT.storage`（`tt.setStorageSync` 的一层薄封装），
 *     所以本文件**不出现 tt 字样**，照样能在 node 里断言（红线见 00-config.js）。
 *
 * 为什么存档要带 `v`（版本号）：小游戏更新后老存档必须能被读（或者干脆安全地丢弃），
 * 不能让玩家一升级就白屏。读档失败一律回落到"新号"，并把原始文本留在内存里便于排查。
 */

G.SAVE = (function () {
  'use strict';

  var BAL = G.BAL;
  var EQUIP = G.EQUIP;
  var SPAWN = G.SPAWN;

  /** 存档格式版本（改结构就必须 +1，并在这里写迁移） */
  var SCHEMA_VERSION = 1;

  /** 开一个新号（首次进入：随机出生点，决策 #5） */
  function create(seed, characterIndex) {
    var spawn = SPAWN.randomSpawnPoint(seed, characterIndex);
    return {
      v: SCHEMA_VERSION,
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
      /** 统计（调试面板与将来的埋点用） */
      stats: { kills: 0, eliteKills: 0, opened: 0, playMs: 0, distance: 0 }
    };
  }

  /** 把一个可能是 null / 缺字段 / 类型不对的旧存档修成可用的（任何情况下不抛异常） */
  function normalize(raw, seed, characterIndex) {
    if (!raw || typeof raw !== 'object') return create(seed, characterIndex);
    if (raw.v !== SCHEMA_VERSION) return create(seed, characterIndex);

    var save = create(seed, characterIndex);
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
    bagFull: bagFull
  };
})();
