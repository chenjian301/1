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
