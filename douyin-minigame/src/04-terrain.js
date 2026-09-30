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
