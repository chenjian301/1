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
