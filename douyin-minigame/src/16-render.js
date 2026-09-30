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
    drawProjectiles: drawProjectiles,
    drawDamageNumbers: drawDamageNumbers
  };
})();
