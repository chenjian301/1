/**
 * 04-terrain.js —— 确定性地表与装饰（world/terrain.ts 的小游戏实现，逐位等价）
 *
 * 地表是"配色 + 噪声色块"，装饰是每 chunk 8~24 个纯视觉物件（**无碰撞**）。
 * 两者都由 chunk 哈希决定，所以"同一个坐标，所有人看到同一片地"。
 *
 * band 只影响**装饰种类权重**与**主题配色**，不参与位置/数量的随机流 ——
 * 因此同一个 chunk 无论从哪个方向看，装饰坐标都一样（只是草/石比例不同）。
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
        flip: rng.chance(0.5)
      });
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
    themeIndexForBand: themeIndexForBand,
    themeForBand: themeForBand,
    deepBandIntensity: deepBandIntensity,
    tileCountPerChunk: tileCountPerChunk,
    groundVariant: groundVariant,
    buildChunkDecor: buildChunkDecor,
    mixHex: mixHex
  };
})();
