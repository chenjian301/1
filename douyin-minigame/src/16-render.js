/**
 * 16-render.js —— 世界渲染（纯 Canvas 2D，**没有引擎**，决策 #7 + 02-architecture §1）
 *
 * 阶段 A3：实体从"圆"升级成**简单自绘角色**，地图从"色块 + 圆点"升级成**有设计感的地图**。
 * 阶段 A6（本轮）：**Q版** 角色（大头 + 大眼 + 腮红）+ **装备外观**（穿的什么就像什么）+
 * **视角倍率**（把世界层整体拉远，UI 不变）+ **更细的地表**（16×16 色块与细纹）。
 * 阶段 A8：默认倍率压到 0.176（用户标准「一屏横向 128 格」）→ 世界层实体密度翻了 ~20 倍，
 * 地表与装饰改走 `view.lodZoom` 省笔档（远到一格只有几像素时，色档 / 细纹 / 装饰都是亚像素噪点）。
 * 阶段 A9（用户："视角的格子变多了，地图的刻画要更加细节，还有人物的大小"）：
 *   - **宏观档**（`lodZoom` 以下）：地表按粗色格抽样 + 同色跨 chunk 批量落笔，
 *     装饰由 `TERRAIN.decorBlobs` 聚合成"草甸 / 石滩 / 林地"斑 —— 逐格细节看不见，宏观结构要看得见；
 *   - **演员层最小观感尺寸**（`view.actorMinZoom`）：点状的东西（角色 / 怪 / 身上的动画 / 选中指示）
 *     反向放大，观感不低于它；面状的东西（地表 / 范围环 / AoE）保持世界尺寸。
 * 阶段 A11（用户："地图、相机视角还需要优化，需要让地图更加细节，玩家视角更加清晰"）：
 *   - **三个视角档位**（`view.cameraTiers`：远 128 格 / 中 64 格 / 近 32 格，默认中档）——
 *     拉近一档，地表的斑驳细一倍（宏观色格按 **tile 数**给：远 4 格 / 中 2 格，手机上 11.7 → 5.9 CSS px）；
 *   - **宏观调色板往主题主色收一收**（`view.lodBlend`）：色格变小之后不再是一张噪声马赛克，
 *     而是"同一片地带淡淡斑驳"的纹理；结构交给装饰斑的轮廓（三种斑都描边）与路网；
 *   - **玩家标记**（`view.playerMark*`）：脚下常亮的一圈细环，**屏幕尺寸恒定** —— 任何档位都找得到"我"。
 * 一帧的顺序（20-main.renderTo 调用）：
 *   地表色块 + 营地石砖 → 小径路网 → 装饰（按主题换造型）→ 地标（废墟 / 石碑）→ 营地道具
 *   → 弹道 → 怪（4 种造型 + 朝向 + 走路）→ 目标环 → 玩家（标记环 + 小人 + 八方向 + 挥砍 + 装备外观）→ 飘字
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
 * 视角倍率不改变这条公式 —— 它由 `beginWorld` 绕屏幕中心缩一次画布来完成，
 * 于是半径 / 线宽 / 字体一起缩放，视觉上是"镜头拉远"而不是"UI 变小"。
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
    banner: '#d8c07a',
    stone: '#6d675c',
    iron: '#5d6470',
    ironTop: '#828b99'
  };

  /** 世界坐标 → 屏幕设计坐标 */
  function toScreen(camera, x, y) {
    return { x: x - camera.x + SCREEN.width() / 2, y: y - camera.y + SCREEN.height() / 2 };
  }

  /**
   * 当前视角档位（A11）：`balance.view.cameraTiers[balance.view.cameraTier]`。
   * 每档 = { id, name, tiles（一屏横向多少格）, zoom, lodBlocks }；
   * 运行时档位由 20-main 按存档里的 `settings.zoomTier` 写入 `view.cameraTier`（一个整数），
   * 渲染层只读它 —— 界面层不读存档那条纪律没破。
   */
  function tier() {
    var tiers = BAL.view.cameraTiers;
    if (!tiers || !tiers.length) return null;
    var index = Math.floor(BAL.view.cameraTier);
    if (!(index >= 0) || index >= tiers.length) index = 0;
    return tiers[index];
  }

  /**
   * 视角倍率（< 1 = 镜头拉远、看得更广）：**只缩放世界层** —— HUD / 面板 / 按钮保持原尺寸。
   *
   * 口径只有一条：**一屏横向多少格** → `zoom = designWidth / (tiles × world.tileSize)`。
   *   - 落在预设档位上（`view.zoomTiles` == 这一档的 `tiles`）时直接返回表里的 `zoom`：
   *     表是数值的单一出处，128 / 64 / 32 这三个标准值因此永远是精确数（自检逐档验这条等式）；
   *   - 拖到两档之间（A11 之二：设置面板里的视角缩放轴，16~64 格）才按上面那条式子现算。
   *
   * 为什么不让档位表直接承接连续值：档位还要给宏观色格边长 / 装载环 / 小地图半径定规格，
   * 那些"档"级别的数字不该跟着每拖一下乱跳（见 `lodBlockTiles` / 14-world 的 `loadRing`）。
   */
  function zoom() {
    var current = tier();
    var tiles = Math.round(BAL.view.zoomTiles);
    if (current && tiles === current.tiles && current.zoom > 0) return current.zoom;
    if (tiles > 0) {
      var derived = BAL.view.designWidth / (tiles * BAL.world.tileSize);
      if (derived > 0 && isFinite(derived)) return derived;
    }
    return current && current.zoom > 0 ? current.zoom : 1;
  }

  /** 这一档宏观色格的边长（按 tile 数，A11）：远 4 格 / 中 1 格 / 近 1 格（1 = 逐格） */
  function lodBlockTiles() {
    var current = tier();
    var width = current ? Math.round(current.lodBlockTiles) : 4;
    return width >= 1 ? width : 1;
  }

  /**
   * 这一档每 chunk 的宏观色格数 = 每 chunk 的格数 ÷ 色格边长（A11）：远 16/4 = 4、中 16/1 = 16。
   *
   * 这是"地图更细节"的关键数字：色格的**世界尺寸**从远档的 128 单位（4 格）缩到中档的 32 单位（1 格），
   * 于是中档在手机上每 5.9 CSS px 就换一次色 —— 地表看得见的斑驳细一倍，而视野只小了 4 倍**面积**
   * （64×139 格 vs 128×277 格），换来的清晰度是实打实的。
   * 近档 1 格 = 逐格，它走 high 细节（见 `groundDetailAt`），根本不进宏观档。
   */
  function lodBlocks() {
    var blocks = Math.round(TERRAIN.tileCountPerChunk() / lodBlockTiles());
    return blocks >= 1 ? blocks : 1;
  }

  /**
   * 地表 / 装饰的细节档（A8，`balance.view.lodZoom`）：
   * zoom 低于阈值时一格在屏幕上不足 ~9 CSS px，6 档色、土斑细纹、装饰全都只是亚像素噪点 ——
   * 于是走**宏观档**（A9/A11）：地表按本档的 `lodBlocks` 抽样、同色跨 chunk 批量落笔，
   * 装饰换成宏观斑（`TERRAIN.decorBlobs`），逐件装饰整层跳过。
   * 三个档位里远 / 中走宏观档，近档（0.703 > 0.5）走逐格档。
   * 纯函数（只看传入的倍率），自检可以直接断言每一档，不用去改 balance。
   */
  function groundDetailAt(k) {
    var threshold = BAL.view.lodZoom;
    return threshold > 0 && k < threshold ? 'low' : 'high';
  }

  function lowDetail() {
    return groundDetailAt(zoom()) === 'low';
  }

  /**
   * 演员层缩放（A9，`balance.view.actorMinZoom`）：用户"还有人物的大小"。
   *
   * 一屏 128 格意味着镜头拉远了 4.55 倍：角色（半径 24）只剩 ~4 CSS px，怪也是。于是给
   * **点状的东西**（角色 / 怪的身体与影子 / 身上的动画 / 选中与仇恨指示 / 弹道）一个最小观感倍率 ——
   * zoom 低于它时按 `actorMinZoom / zoom` 反向放大，观感不再低于这个倍率（0.8 = 与 A6 时代一样大）。
   *
   * 代价是有意接受的：世界被压缩了 4.55 倍而角色没有，所以"角色看起来比脚下的地大"。
   * **面状的东西一律不放大**（地表 / 路 / 营地 / 地标 / 攻击范围与 AoE 环）：它们的尺寸是世界比例，
   * 放大就等于骗人。`actorMinZoom = 0` 或放开到 ≥ zoom 时本层完全不生效（回到"角色 4 CSS px"）。
   */
  function actorScale() {
    var k = zoom();
    var floorZoom = BAL.view.actorMinZoom;
    if (!(floorZoom > 0) || k >= floorZoom) return 1;
    return floorZoom / k;
  }

  /**
   * 以屏幕点为中心把后面画的东西放大 `scale` 倍（= 把角色"画大"而不是"挪位置"）。
   * 与 `beginWorld` 同一个套路：只动画布变换，坐标公式一个字不改。
   * **必须成对 restore**（自检里有一条 save/restore 配平的断言，防的就是"缩放漏进 HUD"）。
   */
  function beginActor(ctx, point, scale) {
    ctx.save();
    if (scale !== 1) {
      ctx.translate(point.x, point.y);
      ctx.scale(scale, scale);
      ctx.translate(-point.x, -point.y);
    }
  }

  /**
   * 世界层开始 / 结束：绕屏幕中心缩放一次。
   * 好处是 `toScreen` 的公式一个字都不用改，而且**半径、线宽、字体都跟着缩放** ——
   * 于是"视野变大"不会变成"UI 变大"。
   */
  function beginWorld(ctx) {
    var k = zoom();
    ctx.save();
    if (k !== 1) {
      ctx.translate(SCREEN.width() / 2, SCREEN.height() / 2);
      ctx.scale(k, k);
      ctx.translate(-SCREEN.width() / 2, -SCREEN.height() / 2);
    }
    return k;
  }

  function endWorld(ctx) {
    ctx.restore();
  }

  /** 视野矩形（世界坐标）：渲染各处共用一份，别各算一套（含视角倍率） */
  function viewRect(camera) {
    var k = zoom();
    var width = SCREEN.width() / k;
    var height = SCREEN.height() / k;
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
   * 地表细度（A7 修订）：网格边长 = `world.tileSize`，块数 = `TERRAIN.tileCountPerChunk()`。
   *
   * 之前这里写死 5×5：块边长 102 世界单位（手机上约 42 CSS px）—— 那就是"一眼看见像素块"的来源。
   * 现在 tileSize = 32 → 16×16，块边长 51 世界单位（约 13 CSS px），按档攒路径而不是按块。
   */
  var GROUND_LEVELS = 6; // 3 种结构色 × 亮 / 暗 2 档：同档的块攒成一条路径 → 每 chunk 最多 6 次落笔
  var GROUND_SHADE = 0.07; // 亮暗档往黑 / 白混多少：够把接缝揉开，又不会花
  var GROUND_SPECKS = 40; // 每 chunk 的细纹（土斑 / 草籽）：更密的细纹让块的边界看不出来

  /** 一块复用的色档缓存（一个 chunk 内 blocks² 张块）：每帧不新建数组，GC 不抖 */
  var levelCache = null;

  /** 一块复用的 6 档颜色（每个 chunk 按主题重算一次） */
  var groundColors = [];

  /**
   * 一张地表块的色档 0..5：低 1 位 = 亮 / 暗，高 2 位 = 结构色（`TERRAIN.groundVariant` 的那 3 种）。
   * 纯整数哈希 —— 和地图本身一样"同一坐标永远同一档"，所以画面不会闪（改 tileSize 也不动它）。
   */
  function groundLevel(seed, cx, cy, tx, ty) {
    return TERRAIN.groundVariant(seed, cx, cy, tx, ty) * 2 + G.RNG.hashInt([seed, cx, cy, tx, ty, 0x2f], 2);
  }

  /** 把一个 chunk 的色档整张算出来（每块只哈希一次，下面 6 档各扫一遍它） */
  function groundLevels(seed, cx, cy, blocks) {
    var need = blocks * blocks;
    if (!levelCache || levelCache.length < need) levelCache = new Uint8Array(need);
    for (var by = 0; by < blocks; by += 1) {
      for (var bx = 0; bx < blocks; bx += 1) levelCache[by * blocks + bx] = groundLevel(seed, cx, cy, bx, by);
    }
    return levelCache;
  }

  /* ---------------------------------------------------------------- 远距宏观档（A9） */

  /**
   * 远距宏观档的地表 / 装饰（A9）：用户"视角的格子变多了，地图的刻画要更加细节"。
   *
   * 一屏 128 格时，一格只有 ~2.9 CSS px —— **"更细"这条路已经走到头了**（16×16 色档、土斑、
   * 逐件装饰全是亚像素噪点）。所以这一档换的是**细节的层级**：把同一份地表哈希**粗抽样**成
   * `view.lodGroundBlocks ×` 这么多格（4×4 → 每格 128 世界单位 ≈ 11.8 CSS px），
   * 于是 128 格的视野里有一屏"有纹理的地"，而不是一片纯色；远看与近看是同一片地，只是抽样更粗。
   *
   * 落笔的账：粗色格按"同 band（= 同主题同色偏）"攒进同一个槽，最后每槽每档一次 fill ——
   * 一整屏 139 个 chunk 的**地表落笔反而比"每 chunk 一次 fillRect"更少**（见 perf-frame 实测）。
   */
  var MACRO_SHADE = 0.09; // 粗色格的亮暗差：比近景（0.07）略强，11.8 CSS px 的格子要靠它才看得出纹理
  var MACRO_SLOT_MAX = 40; // 一帧最多几组"同主题同色偏"的 chunk（band = 距原点 1000 一个，一屏通常 3~9 组）
  var MACRO_CACHE_MAX = 1024; // chunk 级宏观斑缓存上限（满了整片清掉重来）

  /** 复用的粗色档缓存（一个 chunk 内 blocks² 格） */
  var macroLevelsBuf = null;

  /** 每帧复用的调色板槽：[{ band, colors }]，colors = 6 档地表色 + 草 / 石 / 树三个斑色 */
  var macroSlots = [];
  var macroSlotUsed = 0;

  /** 每个（槽 × 档）一串数字 [x, y, w, h]；每个（槽 × 种类）一串数字 [x, y, rx, ry] —— 复用，不每帧新建 */
  var macroRuns = [];
  var macroBlobsOf = [];

  /** chunk 级宏观斑缓存（每个 chunk 只跑一次装饰流）+ 上一次画了几个斑（自检用） */
  var macroChunkCache = null;
  var macroChunkCount = 0;
  var macroBlobDrawn = 0;

  /**
   * 把一个 chunk 的粗色档整张算出来：在同一个 16×16 色档场里按 `step` 隔点抽样。
   * 缓存复用（不每帧新建数组），哈希只跑 blocks² 次。
   */
  function macroLevels(seed, cx, cy, blocks) {
    var need = blocks * blocks;
    if (!macroLevelsBuf || macroLevelsBuf.length < need) macroLevelsBuf = new Uint8Array(need);
    var step = Math.max(1, Math.round(TERRAIN.tileCountPerChunk() / blocks));
    for (var by = 0; by < blocks; by += 1) {
      for (var bx = 0; bx < blocks; bx += 1) {
        macroLevelsBuf[by * blocks + bx] = groundLevel(seed, cx, cy, bx * step, by * step);
      }
    }
    return macroLevelsBuf;
  }

  /**
   * 一个槽的 9 个颜色：0..5 = 6 档地表色（口径与近景同一份），6..8 = 草 / 石 / 树三个斑色。
   *
   * A11（用户："地图更加细节"）：每一档都先往**本主题的主色**（`theme.ground[0]`）混 `view.lodBlend` ——
   * 因为色格变小了（中档一块只有 2 格地表 = 手机上 5.9 CSS px），要是每块都用满对比的原色，
   * 远看就是一张**噪声马赛克**；往主色收一收，就变成"同一片地、带淡淡斑驳"的纹理，
   * 结构感交给装饰斑（草甸 / 石滩 / 林地）与路网去说。近档走逐格档，不受这里影响。
   */
  function macroColors(theme, tint, out) {
    var blend = BAL.view.lodBlend >= 0 && BAL.view.lodBlend <= 1 ? BAL.view.lodBlend : 0;
    var dominant = TERRAIN.mixHex(theme.ground[0], '#000010', tint);
    for (var level = 0; level < GROUND_LEVELS; level += 1) {
      var base = TERRAIN.mixHex(theme.ground[level >> 1], level & 1 ? '#ffffff' : '#000010', MACRO_SHADE);
      out[level] = TERRAIN.mixHex(TERRAIN.mixHex(base, dominant, blend), '#000010', tint);
    }
    out[6] = TERRAIN.mixHex(theme.ground[1], theme.accent, 0.16); // 草甸：底色往主题点缀色走一点
    out[7] = TERRAIN.mixHex(theme.ground[2], '#ffffff', 0.2); // 石滩：亮一点的岩色
    out[8] = TERRAIN.mixHex(theme.decor, '#000010', 0.12); // 林地：主题装饰色压暗 = 树冠
  }

  /**
   * 取（或新建）本帧的一个调色板槽：**同一个 band 的 chunk 共用一份颜色**。
   * 这就是"跨 chunk 批量落笔"的前提 —— 一屏里同色的 chunk 全攒进同一条路径。
   */
  function macroSlotFor(band, theme, tint) {
    for (var i = 0; i < macroSlotUsed; i += 1) if (macroSlots[i].band === band) return i;
    if (macroSlotUsed >= MACRO_SLOT_MAX) return 0; // 兜底（band 数是"距原点 / 1000"，一屏到不了 40 组）
    var slot = macroSlots[macroSlotUsed];
    if (!slot) {
      slot = { band: band, colors: [] };
      macroSlots[macroSlotUsed] = slot;
    }
    slot.band = band;
    macroColors(theme, tint, slot.colors);
    macroSlotUsed += 1;
    return macroSlotUsed - 1;
  }

  /** 把一条矩形记进（槽 × 档）那串数字 —— 之后再统一 beginPath / rect / fill */
  function macroPushRun(index, x, y, w, h) {
    var runs = macroRuns[index];
    if (!runs) {
      runs = [];
      macroRuns[index] = runs;
    }
    runs.push(x, y, w, h);
  }

  /**
   * 一个 chunk 的宏观斑（带缓存）：同一个 chunk 只跑一次 `TERRAIN.decorBlobs`。
   * 键用整数（`(cx + 8192) * 16384 + (cy + 8192)`）—— 每帧 139 次查找不产生字符串。
   * 走到 ±8192 个 chunk（≈ ±419 万世界单位）以外理论上会撞键，撞了也只是那几个斑长得像，不影响玩法。
   */
  function macroBlobsAt(seed, cx, cy, band, maxBlobs) {
    if (!macroChunkCache) macroChunkCache = {};
    var key = (cx + 8192) * 16384 + (cy + 8192);
    var hit = macroChunkCache[key];
    if (hit && hit.band === band && hit.maxBlobs === maxBlobs) return hit.blobs;
    var blobs = TERRAIN.decorBlobs(seed, cx, cy, band, maxBlobs);
    if (macroChunkCount >= MACRO_CACHE_MAX) {
      macroChunkCache = {};
      macroChunkCount = 0;
    }
    macroChunkCache[key] = { band: band, maxBlobs: maxBlobs, blobs: blobs };
    macroChunkCount += 1;
    return blobs;
  }

  /**
   * 宏观档的装饰斑：把每个 chunk 的**真实装饰**聚合成 1~2 个"草甸 / 石滩 / 林地"斑，
   * 按（槽 × 种类）攒路径 —— 一整屏的林子与石滩只花几次落笔。
   * 走进去看到的是同一片（同一个随机流，见 `TERRAIN.decorBlobs`），所以"远看有林子"不会落空。
   */
  function drawMacroBlobs(ctx, camera, chunks, seed, maxBlobs) {
    var i;
    var j;
    var slot;
    var kind;
    var band;
    var blobs;
    var blob;
    var point;
    var path;
    var index;
    var drawn = 0;

    for (i = 0; i < chunks.length; i += 1) {
      band = G.SPAWN.chunkCenterBand(chunks[i].cx, chunks[i].cy);
      blobs = macroBlobsAt(seed, chunks[i].cx, chunks[i].cy, band, maxBlobs);
      if (blobs.length === 0) continue;
      slot = macroSlotFor(band, TERRAIN.themeForBand(band), TERRAIN.deepBandIntensity(band));
      for (j = 0; j < blobs.length; j += 1) {
        blob = blobs[j];
        kind = blob.kind === 'tree' ? 2 : blob.kind === 'rock' ? 1 : 0;
        index = slot * 3 + kind;
        path = macroBlobsOf[index];
        if (!path) {
          path = [];
          macroBlobsOf[index] = path;
        }
        point = toScreen(camera, blob.x, blob.y);
        // 贴在地上的一片 → 扁椭圆（ry = 0.68 rx）：远看才是"地上一块植被"，不是飘着的气球
        path.push(point.x, point.y, blob.r, blob.r * 0.68);
        drawn += 1;
      }
    }

    for (slot = 0; slot < macroSlotUsed; slot += 1) {
      for (kind = 0; kind < 3; kind += 1) {
        path = macroBlobsOf[slot * 3 + kind];
        if (!path || path.length === 0) continue;
        ctx.globalAlpha = kind === 2 ? 0.5 : 0.4;
        ctx.fillStyle = macroSlots[slot].colors[6 + kind];
        ctx.beginPath();
        for (j = 0; j < path.length; j += 4) ellipsePath(ctx, path[j], path[j + 1], path[j + 2], path[j + 3]);
        ctx.fill();
        // A11：三种斑都沿同一条路径描一圈深色边（fill 不清路径，所以只多一次 stroke）——
        // "林子 / 石滩 / 草甸"的轮廓因此看得出来：地图上的**结构**就是这些斑 + 路网 + 营地。
        ctx.globalAlpha = kind === 2 ? 0.3 : 0.18;
        ctx.strokeStyle = TERRAIN.mixHex(macroSlots[slot].colors[6 + kind], '#000010', 0.45);
        ctx.lineWidth = kind === 2 ? 3 : 2;
        ctx.stroke();
        path.length = 0;
      }
    }
    ctx.globalAlpha = 1;
    macroBlobDrawn = drawn;
  }

  /**
   * 宏观档的地表：色格（跨 chunk 同色批量落笔）+ 装饰斑。
   *
   * 与近景逐格档的两处差别，都是"这个尺度上什么才看得见"决定的：
   *   1. 色格是**粗抽样**（`lodBlocks()`² 而不是 16²）：远档一块 4 格地表、中档一块 2 格 ——
   *      远近视同一片地（同一个 `groundLevel` 哈希），只是抽样更粗；
   *   2. 攒路径的范围从"一个 chunk"放大到"整个调色板槽"（= 所有同 band 的 chunk），
   *      于是 139 个 chunk 只花几十次 fill，反而比"每 chunk 一次 fillRect"更省。
   */
  function drawGroundMacro(ctx, camera, chunks, seed) {
    var blocks = lodBlocks();
    var block = CHUNK.CHUNK_SIZE / blocks;
    var blobLimit = BAL.view.lodDecorBlobs > 0 ? Math.round(BAL.view.lodDecorBlobs) : 0;
    var i;
    var bx;
    var by;
    var level;
    var start;
    var slot;
    var origin;
    var band;
    var theme;
    var tint;
    var levels;
    var runs;
    var j;
    var cx;
    var cy;

    macroSlotUsed = 0;
    macroBlobDrawn = 0;

    for (i = 0; i < chunks.length; i += 1) {
      cx = chunks[i].cx;
      cy = chunks[i].cy;
      band = G.SPAWN.chunkCenterBand(cx, cy);
      theme = TERRAIN.themeForBand(band);
      tint = TERRAIN.deepBandIntensity(band);
      slot = macroSlotFor(band, theme, tint);
      origin = toScreen(camera, CHUNK.chunkOrigin(cx), CHUNK.chunkOrigin(cy));
      levels = macroLevels(seed, cx, cy, blocks);

      // 底色（第 0 档）整块先记上：第 0 档因此不参与下面的粗色格（与近景同一个口径）
      macroPushRun(slot * GROUND_LEVELS, origin.x, origin.y, CHUNK.CHUNK_SIZE, CHUNK.CHUNK_SIZE);

      for (by = 0; by < blocks; by += 1) {
        bx = 0;
        while (bx < blocks) {
          level = levels[by * blocks + bx];
          if (level === 0) {
            bx += 1;
            continue;
          }
          start = bx;
          while (bx < blocks && levels[by * blocks + bx] === level) bx += 1;
          macroPushRun(
            slot * GROUND_LEVELS + level,
            origin.x + start * block,
            origin.y + by * block,
            (bx - start) * block,
            block
          );
        }
      }
    }

    // 落笔：每个（槽 × 档）一次 fill —— 一整屏的地表于是只花几十笔
    for (i = 0; i < macroSlotUsed; i += 1) {
      for (level = 0; level < GROUND_LEVELS; level += 1) {
        runs = macroRuns[i * GROUND_LEVELS + level];
        if (!runs || runs.length === 0) continue;
        ctx.beginPath();
        for (j = 0; j < runs.length; j += 4) ctx.rect(runs[j], runs[j + 1], runs[j + 2], runs[j + 3]);
        ctx.fillStyle = macroSlots[i].colors[level];
        ctx.fill();
        runs.length = 0; // 复用这串数字（下一帧从 0 开始攒）
      }
    }

    if (blobLimit > 0) drawMacroBlobs(ctx, camera, chunks, seed, blobLimit);
  }

  /** 自检用：上一次宏观档的规模（几个调色板槽 = 几组主题 / 色偏、几个装饰斑、每 chunk 几个色格） */
  function macroStats() {
    return { slots: macroSlotUsed, blobs: macroBlobDrawn, blocks: lodBlocks(), blockTiles: lodBlockTiles() };
  }

  /**
   * 地表：每 chunk 一块主题底色 + `tileSize` 网格的色块（结构色 × 亮暗档，全部来自哈希），
   * 最后在原点盖上营地的石砖地。
   *
   * A6 的做法差别：同档的色块**攒进一条路径**再一次性 fill。于是网格从 5×5 变成 16×16 之后，
   * 每 chunk 的落笔还是 7 次（底色 + 5 档 + 细纹），块却从 25 张变成 256 张 —— 一格一格的接缝由
   * 亮暗档 + 每 chunk 40 道细纹揉开，远看是"一片有细节的地"，不是"一堆方块"。
   * 性能账见 `tools\perf-frame.mjs`（落笔预算 900）。
   * A8：倍率压到 0.176（一屏 128 格）之后，视野里的 chunk 从 ~15 涨到 ~171 —— 逐格档在这个
   * 尺度上既看不见又贵，于是远距档整个交给 `drawGroundMacro`（粗色格 + 装饰斑）。
   */
  function drawGround(ctx, camera) {
    var rect = viewRect(camera);
    var chunks = CHUNK.chunksInRect(rect.minX, rect.minY, rect.maxX, rect.maxY, 0);
    var seed = BAL.season.worldSeed;
    var blocks = TERRAIN.tileCountPerChunk();
    var block = CHUNK.CHUNK_SIZE / blocks;
    var level;

    // A9 远距宏观档：一格只剩 ~2.9 CSS px，逐格色档 / 土斑 / 逐件装饰都成了亚像素噪点 ——
    // 换成"同一份哈希的粗抽样 + 装饰斑"（细节从"更细"转向"更大"）
    if (lowDetail()) {
      drawGroundMacro(ctx, camera, chunks, seed);
      drawCampPlaza(ctx, camera, rect);
      return;
    }

    for (var i = 0; i < chunks.length; i += 1) {
      var cx = chunks[i].cx;
      var cy = chunks[i].cy;
      var band = G.SPAWN.chunkCenterBand(cx, cy);
      var theme = TERRAIN.themeForBand(band);
      var tint = TERRAIN.deepBandIntensity(band);
      var ground = theme.ground;
      var origin = toScreen(camera, CHUNK.chunkOrigin(cx), CHUNK.chunkOrigin(cy));

      var levels = groundLevels(seed, cx, cy, blocks);

      // 6 档颜色：结构色（ground[0..2]）先按亮 / 暗混一点，再叠深带的暗罩
      for (level = 0; level < GROUND_LEVELS; level += 1) {
        var base = TERRAIN.mixHex(ground[level >> 1], level & 1 ? '#ffffff' : '#000010', GROUND_SHADE);
        groundColors[level] = TERRAIN.mixHex(base, '#000010', tint);
      }

      // 底色 = 最暗那一档，整块先铺满（第 0 档因此不用再建路径）
      ctx.fillStyle = groundColors[0];
      ctx.fillRect(origin.x, origin.y, CHUNK.CHUNK_SIZE, CHUNK.CHUNK_SIZE);

      for (level = 1; level < GROUND_LEVELS; level += 1) {
        var any = false;
        ctx.beginPath();
        for (var by = 0; by < blocks; by += 1) {
          // 同一行里相邻的同档块合成一个矩形（rect 一次画完）：路径长度几乎减半
          var runStart = -1;
          for (var bx = 0; bx <= blocks; bx += 1) {
            var same = bx < blocks && levels[by * blocks + bx] === level;
            if (same) {
              if (runStart < 0) runStart = bx;
              continue;
            }
            if (runStart < 0) continue;
            ctx.rect(origin.x + runStart * block, origin.y + by * block, (bx - runStart) * block, block);
            any = true;
            runStart = -1;
          }
        }
        if (!any) continue;
        ctx.fillStyle = groundColors[level];
        ctx.fill();
      }

      // 细纹：土斑 / 草籽（位置是纯哈希 → 同一块地永远同一撮，不会闪）
      ctx.beginPath();
      for (var s = 0; s < GROUND_SPECKS; s += 1) {
        var hx = G.RNG.hashInt([seed, cx, cy, s, 0x5b], 4096) / 4096;
        var hy = G.RNG.hashInt([seed, cx, cy, s, 0x7c], 4096) / 4096;
        var sx = origin.x + hx * CHUNK.CHUNK_SIZE;
        var sy = origin.y + hy * CHUNK.CHUNK_SIZE;
        var len = 2 + G.RNG.hashInt([seed, cx, cy, s, 0x11], 3);
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + len, sy);
        ctx.lineTo(sx + len, sy - len * 0.5);
        ctx.lineTo(sx, sy - len * 0.5);
        ctx.closePath();
      }
      ctx.fillStyle = TERRAIN.mixHex(theme.decor, '#000010', 0.3 + tint);
      ctx.fill();
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
    var tone;
    var any;

    // A6：同一色调的石板攒进一条路径（站在广场上原本要 200 次落笔，现在 3 次）
    for (tone = 0; tone < CAMP_COLORS.plate.length; tone += 1) {
      any = false;
      ctx.beginPath();
      for (var py = Math.floor(clampMinY / plate) * plate; py <= clampMaxY; py += plate) {
        for (var px = Math.floor(clampMinX / plate) * plate; px <= clampMaxX; px += plate) {
          var dx = px + plate / 2 - camp.x;
          var dy = py + plate / 2 - camp.y;
          if (dx * dx + dy * dy > radiusSq) continue;
          if (G.RNG.hashInt([seed, Math.round(px / plate), Math.round(py / plate)], CAMP_COLORS.plate.length) !== tone) continue;
          var stone = toScreen(camera, px, py);
          ctx.moveTo(stone.x + inset, stone.y + inset);
          ctx.lineTo(stone.x + plate - inset, stone.y + inset);
          ctx.lineTo(stone.x + plate - inset, stone.y + plate - inset);
          ctx.lineTo(stone.x + inset, stone.y + plate - inset);
          ctx.closePath();
          any = true;
        }
      }
      if (!any) continue;
      ctx.fillStyle = CAMP_COLORS.plate[tone];
      ctx.fill();
    }

    // 广场纹章（A6 加的细节）：中心一圈石环 + 一枚菱形刻纹，站在原点一眼就知道这是营地中心
    var centerStone = toScreen(camera, camp.x, camp.y);
    ctx.strokeStyle = CAMP_COLORS.plateEdge;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(centerStone.x, centerStone.y, 168, 0, TAU);
    ctx.stroke();
    var mark = 30;
    ctx.fillStyle = CAMP_COLORS.banner;
    ctx.beginPath();
    ctx.moveTo(centerStone.x, centerStone.y - mark);
    ctx.lineTo(centerStone.x + mark, centerStone.y);
    ctx.lineTo(centerStone.x, centerStone.y + mark);
    ctx.lineTo(centerStone.x - mark, centerStone.y);
    ctx.closePath();
    ctx.fill();
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

  /** 营地道具：帐篷 / 篝火 / 旗 / 木牌 / 箱子 / 树桩 / 铁匠的铁砧（摆位数据在 04-terrain 的 CAMP_PROPS） */
  function drawCampProp(ctx, point, prop, nowMs) {
    var scale = prop.scale || 1;
    if (prop.kind === 'tent') drawTent(ctx, point, scale);
    else if (prop.kind === 'fire') drawCampfire(ctx, point, scale, nowMs);
    else if (prop.kind === 'banner') drawBanner(ctx, point, scale, nowMs);
    else if (prop.kind === 'sign') drawSign(ctx, point, scale);
    else if (prop.kind === 'crate') drawCrate(ctx, point, scale);
    else if (prop.kind === 'stump') drawStump(ctx, point, scale);
    // 铁匠（本次新增）：营地里唯一"会干活"的一件 —— 站在旁边屏幕上会多一枚「锻」键（20-main）
    else if (prop.kind === 'forge') drawForge(ctx, point, scale, nowMs);
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

  /**
   * 铁匠（本次新增，用户要求"在公会营地里增加铁匠NPC"）：一台**铁砧 + 炭炉 + 斜靠的锤子**，
   * 头顶挂一块「铁匠」小牌 —— 走近一眼看出"这个人能敲东西"。
   * 炉火的抖动只跟**逻辑时间**走（与篝火同一套写法；16-render 在三角函数白名单里）。
   */
  function drawForge(ctx, point, scale, nowMs) {
    var s = scale;
    var flick = Math.sin(nowMs / 120) * 0.5 + Math.sin(nowMs / 61) * 0.5;
    var i;
    drawShadow(ctx, point, 40 * s, 0.24);

    // ① 石台
    ctx.fillStyle = CAMP_COLORS.stone;
    ctx.beginPath();
    ctx.moveTo(point.x - 40 * s, point.y);
    ctx.lineTo(point.x + 40 * s, point.y);
    ctx.lineTo(point.x + 30 * s, point.y - 20 * s);
    ctx.lineTo(point.x - 30 * s, point.y - 20 * s);
    ctx.closePath();
    ctx.fill();

    // ② 铁砧：腰身 + 台面（上沿亮一档，看得出是金属）
    ctx.fillStyle = CAMP_COLORS.iron;
    ctx.beginPath();
    ctx.moveTo(point.x - 18 * s, point.y - 20 * s);
    ctx.lineTo(point.x + 18 * s, point.y - 20 * s);
    ctx.lineTo(point.x + 12 * s, point.y - 44 * s);
    ctx.lineTo(point.x - 12 * s, point.y - 44 * s);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(point.x - 34 * s, point.y - 58 * s);
    ctx.lineTo(point.x + 30 * s, point.y - 56 * s);
    ctx.lineTo(point.x + 22 * s, point.y - 42 * s);
    ctx.lineTo(point.x - 36 * s, point.y - 44 * s);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = CAMP_COLORS.ironTop;
    ctx.beginPath();
    ctx.moveTo(point.x - 34 * s, point.y - 58 * s);
    ctx.lineTo(point.x + 30 * s, point.y - 56 * s);
    ctx.lineTo(point.x + 30 * s, point.y - 50 * s);
    ctx.lineTo(point.x - 34 * s, point.y - 52 * s);
    ctx.closePath();
    ctx.fill();

    // ③ 炭炉：光晕 + 炉身 + 两支火苗（复用的是篝火那两支的画法）
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = CAMP_COLORS.glow;
    ctx.beginPath();
    ctx.arc(point.x - 46 * s, point.y - 12 * s, 24 * s + flick * 3, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = CAMP_COLORS.wood;
    ctx.beginPath();
    ctx.moveTo(point.x - 60 * s, point.y);
    ctx.lineTo(point.x - 32 * s, point.y);
    ctx.lineTo(point.x - 36 * s, point.y - 18 * s);
    ctx.lineTo(point.x - 56 * s, point.y - 18 * s);
    ctx.closePath();
    ctx.fill();
    var flameHeight = 20 * s + flick * 5;
    drawFlame(ctx, point.x - 46 * s, point.y - 16 * s, 16 * s, flameHeight, CAMP_COLORS.fire, flick);
    drawFlame(ctx, point.x - 46 * s, point.y - 16 * s, 8 * s, flameHeight * 0.6, CAMP_COLORS.fireCore, -flick);

    // ④ 斜靠在砧边的锤子
    ctx.strokeStyle = CAMP_COLORS.wood;
    ctx.lineWidth = 6 * s;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(point.x + 22 * s, point.y);
    ctx.lineTo(point.x + 44 * s, point.y - 44 * s);
    ctx.stroke();
    ctx.fillStyle = CAMP_COLORS.iron;
    ctx.beginPath();
    ctx.moveTo(point.x + 36 * s, point.y - 42 * s);
    ctx.lineTo(point.x + 56 * s, point.y - 60 * s);
    ctx.lineTo(point.x + 44 * s, point.y - 72 * s);
    ctx.lineTo(point.x + 26 * s, point.y - 54 * s);
    ctx.closePath();
    ctx.fill();

    // ⑤ 火星：三颗往上飘（位置只由逻辑时间决定，重放同一个时刻一定同画面）
    for (i = 0; i < 3; i += 1) {
      var rise = (nowMs / 600 + i / 3) % 1;
      ctx.globalAlpha = 0.8 * (1 - rise);
      ctx.fillStyle = '#ffd479';
      ctx.beginPath();
      ctx.arc(point.x - 18 * s + i * 17 * s, point.y - 62 * s - rise * 34 * s, 3 * s, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // ⑥ 名牌「铁匠」：与营地那块「新手营地」同一套写法（跟着世界缩放，站在近处才看得清）
    ctx.globalAlpha = 0.78;
    ctx.fillStyle = '#ffd479';
    ctx.font = '24px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('铁匠', point.x, point.y - 88 * s);
    ctx.globalAlpha = 1;
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
    // A8/A9 远距档：拉远到 `view.lodZoom` 以下之后，一件装饰只有 1~2 CSS px（纯噪点）——
    // 整层跳过，交给 `drawGroundMacro` 的宏观斑（草甸 / 石滩 / 林地）去表达"这里是什么地"
    if (lowDetail()) return;
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
      // A9 演员层：怪也一起放大（不然玩家看得到自己、看不到怪）
      var scale = actorScale();

      beginActor(ctx, point, scale);

      // 仇恨提示：正在追 / 正在打的怪脚下加一圈暗色（一眼看出谁醒了）
      if (monster.state === 'chase' || monster.state === 'attack') {
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = dark;
        ellipsePath(ctx, point.x, point.y + monster.radius * 0.5 * scale, (monster.radius + 10) * scale, monster.radius * 0.6 * scale);
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
        ellipsePath(ctx, point.x, point.y + monster.radius * 0.55 * scale, (monster.radius + 8) * scale, monster.radius * 0.5 * scale);
        ctx.stroke();
        drawCrown(ctx, point.x, point.y - monster.radius * 2.5 * scale, monster.radius * 0.5 * scale);
      }

      ctx.restore(); // 身体画完就恢复：血条与名字是**设计像素**（字号不跟着放大 4.55 倍）

      // 血条：只在掉过血或正在交战时画；抬升量跟着演员层放大（否则会被放大后的身体盖住），
      // 条宽与字号仍是设计像素 —— 一眼能读，而不会被放大成一条糊上去的横幅。
      if (monster.hp < monster.hpMax || monster.state === 'attack' || monster.state === 'chase') {
        var barW = Math.max(36, monster.radius * 2.4);
        var barY = point.y - (monster.radius * 2.9 + 10) * scale;
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
        ctx.fillText(monster.name + ' Lv.' + monster.level, point.x, point.y + (monster.radius + 22) * scale);
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
      // A6：眼睛放大 + 一点高光（Q版的脸一半靠眼睛）
      ctx.fillStyle = '#ffef9f';
      ctx.beginPath();
      ctx.arc(headX + r * 0.16 * flip, headY - r * 0.04, r * 0.15, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#20242c';
      ctx.beginPath();
      ctx.arc(headX + r * 0.21 * flip, headY - r * 0.02, r * 0.08, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.arc(headX + r * 0.1 * flip, headY - r * 0.11, r * 0.045, 0, TAU);
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
      drawEyes(ctx, point.x, y - r * 0.62, r * 0.14, r * 0.17, 0, '#b8352f');
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
      drawEyes(ctx, point.x, baseY - r * 1.6, r * 0.12, r * 0.17, r * 0.03 * flip, '#6fd0ff');
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
      // A6：面甲里两道发光的眼（宽一点、成对，比原来那条缝更"有表情"）
      ctx.fillStyle = '#ff9b5a';
      ctx.fillRect(point.x - r * 0.32 + r * 0.12 * flip, point.y - r * 2.1, r * 0.2, r * 0.14);
      ctx.fillRect(point.x + r * 0.12 + r * 0.12 * flip, point.y - r * 2.1, r * 0.2, r * 0.14);
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

  /** 自动战斗的目标环（哪只在被打，一眼可见）；A9：跟着演员层放大，环正好箍住放大后的怪 */
  function drawTargetRing(ctx, camera, target) {
    if (!target) return;
    var point = toScreen(camera, target.x, target.y);
    ctx.strokeStyle = '#ff6b6b';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(point.x, point.y, (target.radius + 12) * actorScale(), 0, Math.PI * 2);
    ctx.stroke();
  }

  /** 空外观（没穿装备）：渲染层不读玩法数据，四件装备都由 20-main 传进来 */
  var EMPTY_LOOK = { weapon: null, armor: null, boots: null, trinket: null };

  /** 颜色压暗：TERRAIN.mixHex 是工程里唯一一份调色实现，这里只是给它一个短名字 */
  function shade(hex, t) {
    if (!hex || hex.indexOf('#') !== 0) return hex || '#000000';
    return TERRAIN.mixHex(hex, '#000010', t);
  }

  /** Q版大眼睛：白眼球 + 黑瞳 + 一点高光（玩家与怪共用，眼神才统一） */
  function drawEyes(ctx, x, y, size, gap, pupilDx, pupilColor) {
    for (var i = -1; i <= 1; i += 2) {
      var ex = x + i * gap;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(ex, y, size, 0, TAU);
      ctx.fill();
      ctx.fillStyle = pupilColor || '#20242c';
      ctx.beginPath();
      ctx.arc(ex + pupilDx, y + size * 0.12, size * 0.58, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.arc(ex - size * 0.32 + pupilDx, y - size * 0.3, size * 0.2, 0, TAU);
      ctx.fill();
    }
  }

  /**
   * 玩家标记（A11，用户："玩家视角更加清晰"）：脚下常亮的一圈细环。
   *
   * 为什么需要它：视角拉到远档（128 格一屏）时，"我在哪"是第一个会丢的信息 ——
   * 角色本身靠演员层保持 ~20 CSS px，但它周围的地、怪、装饰全在同一片低对比的色块里。
   * 一圈**屏幕尺寸恒定**的金色细环（+ 很轻的呼吸感）就能把它钉住，而且不骗人：
   * 它是指示物（和名牌 / 血条同一条纪律），不是范围，所以不随演员层放大。
   * 呼吸只用 `Math.sin`（纯视觉，16-render 在三角白名单里），不参与任何随机流。
   */
  function drawPlayerMark(ctx, point, nowMs, dead) {
    var radius = BAL.view.playerMarkRadius;
    if (!(radius > 0)) return;
    var pulse = 1 + Math.sin(((nowMs % 1600) / 1600) * TAU) * 0.08;
    ctx.globalAlpha = dead ? 0.22 : 0.46;
    ctx.strokeStyle = dead ? '#8d9bb5' : '#ffe08a';
    ctx.lineWidth = BAL.view.playerMarkWidth;
    ellipsePath(ctx, point.x, point.y + radius * 0.18, radius * pulse, radius * 0.34 * pulse);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /**
   * 玩家：自绘 Q版小人（八方向朝向 + 走路摆腿摆臂 + 出手挥砍 + 受击闪红 + 倒地躺平）。
   * `stats` 只用来推出手间隔，好让"挥砍"跟得上真正的攻速；`nowMs` 缺省取逻辑时间。
   * `look` = 身上四件装备的外观（09-equipment 的 lookOf，20-main 每帧传进来）：
   * 衣服改配色与款式、鞋子改脚、饰品多一笔、武器换造型 —— 穿什么就像什么。
   */
  function drawPlayer(ctx, camera, player, stats, nowMs, look) {
    var now = typeof nowMs === 'number' ? nowMs : G.WORLD.now();
    var point = toScreen(camera, player.x, player.y);
    var index = facingIndex(player.facing);
    var moving = player.moving === true && player.dead !== true;
    var interval = stats && stats.attackSpeed > 0 ? 1000 / stats.attackSpeed : 0;
    var swing = player.dead ? 1 : swingPhase(now, player.lastAttackAt, interval);
    var flashing = player.dead !== true && player.hurtUntil > 0 && now < player.hurtUntil;
    var palette = player.dead ? PLAYER_DOWN : flashing ? PLAYER_FLASH : PLAYER_PALETTE;
    var scale = actorScale();

    // 打击范围（淡淡一圈，帮助理解为什么"差一点就打不到"）：**世界比例**，不跟着演员层放大。
    // A9：宏观视角下角色被放大 4.55 倍，这一圈会被身体整个盖住 —— 那时干脆不画
    // （它本来就只剩 ~8 CSS px，判断不了任何东西），而不是把它也放大成"假的攻击范围"。
    if (scale === 1) {
      ctx.globalAlpha = 0.1;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(point.x, point.y, BAL.player.attackRange, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // A9 演员层：影子与身体一起放大（"角色多大，影子就多大"，不然像浮在地上）
    // A11：先画玩家标记（屏幕尺寸恒定的一圈细环），它压在影子与身体之下
    drawPlayerMark(ctx, point, now, player.dead === true);
    beginActor(ctx, point, scale);

    drawShadow(ctx, point, BAL.player.radius, player.dead ? 0.2 : 0.3);

    ctx.save();
    if (player.dead) {
      // 倒地：整个人绕脚踝转 90°，再压暗一点（在演员层放大后的坐标系里转，绕的还是脚踝）
      ctx.globalAlpha = 0.55;
      ctx.translate(point.x, point.y);
      ctx.rotate(-Math.PI / 2);
      ctx.translate(-point.x, -point.y);
    }
    drawHumanoid(ctx, point, BAL.player.radius, index, walkPhase(now, moving), palette, swing, look || EMPTY_LOOK);
    ctx.restore();
    ctx.restore();
  }

  /**
   * Q版小人（A6 重画）：大头 + 短身 + 短腿，眼睛占掉小半张脸。
   * 画法顺序：披风 → 腿 / 鞋 → 躯干 → 衣服款式 → 腰带 → 手臂 → 头 / 脸 / 饰品 → 武器。
   * 造型一律按"朝右"画，朝左时 flip = -1 镜像；背对镜头不画脸。
   */
  function drawHumanoid(ctx, point, r, index, phase, palette, swing, look) {
    var flip = facesLeft(index) ? -1 : 1;
    var away = facesAway(index);
    var armor = look.armor;
    var boots = look.boots;
    var cloth = armor ? armor.a : palette.tunic;
    var clothDark = armor ? shade(armor.a, 0.34) : palette.tunicDark;
    var trim = armor ? armor.b : palette.belt;
    var bootColor = boots ? boots.a : palette.boot;
    var soleColor = boots ? boots.b : palette.boot;
    var legSwing = Math.sin(phase * TAU) * r * 0.42;
    var bob = Math.abs(Math.sin(phase * TAU)) * r * 0.12;
    var baseY = point.y - bob;
    var leg;

    // 披风：画在身体后面（只有 cloak 款式有）
    if (armor && armor.style === 'cloak') {
      ctx.fillStyle = clothDark;
      ctx.beginPath();
      ctx.moveTo(point.x - r * 0.6, baseY - r * 1.95);
      ctx.lineTo(point.x + r * 0.6, baseY - r * 1.95);
      ctx.lineTo(point.x + r * 0.8, baseY - r * 0.4);
      ctx.lineTo(point.x - r * 0.8, baseY - r * 0.4);
      ctx.closePath();
      ctx.fill();
    }

    // 腿 + 鞋（Q版：腿短、鞋大）
    for (leg = -1; leg <= 1; leg += 2) {
      var legX = point.x + leg * r * 0.22 + leg * legSwing * 0.35;
      ctx.fillStyle = palette.skin;
      roundRectPath(ctx, legX - r * 0.15, baseY - r * 0.96, r * 0.3, r * 0.7, r * 0.14);
      ctx.fill();
      ctx.fillStyle = bootColor;
      roundRectPath(ctx, legX - r * 0.2, baseY - r * 0.44, r * 0.4, r * 0.44, r * 0.14);
      ctx.fill();
      ctx.fillStyle = soleColor;
      ctx.fillRect(legX - r * 0.2, baseY - r * 0.12, r * 0.42, r * 0.12);
      if (boots && boots.style === 'sandal') {
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(legX - r * 0.2, baseY - r * 0.3, r * 0.4, r * 0.06);
      } else if (boots && (boots.style === 'greave' || boots.style === 'plateboot')) {
        ctx.fillStyle = soleColor;
        ctx.fillRect(legX - r * 0.22, baseY - r * 0.68, r * 0.44, r * 0.1);
      }
    }

    // 躯干（短而圆）
    ctx.fillStyle = cloth;
    roundRectPath(ctx, point.x - r * 0.58, baseY - r * 2.0, r * 1.16, r * 1.2, r * 0.32);
    ctx.fill();
    drawArmorDetail(ctx, point, baseY, r, armor, clothDark, trim);

    // 腰带
    ctx.fillStyle = trim;
    ctx.fillRect(point.x - r * 0.58, baseY - r * 1.02, r * 1.16, r * 0.16);

    // 后手（与腿反向摆）
    ctx.fillStyle = clothDark;
    roundRectPath(ctx, point.x - r * 0.82 - legSwing * 0.4, baseY - r * 1.92, r * 0.3, r * 0.9, r * 0.15);
    ctx.fill();

    // 持械手：位置固定，出手靠手腕旋转表现
    var handX = point.x + r * 0.7 * flip;
    var handY = baseY - r * 1.55;
    ctx.fillStyle = palette.skin;
    roundRectPath(ctx, handX - r * 0.16, handY - r * 0.1, r * 0.32, r * 0.82, r * 0.15);
    ctx.fill();
    drawWeapon(ctx, handX, handY, r, flip, -ACTOR_STYLE.swingArc * 0.55 + (1 - swing) * ACTOR_STYLE.swingArc, palette, look.weapon);

    // 大头（Q版的关键：头几乎和躯干一样大）
    var headY = baseY - r * 2.72;
    var headR = r * 0.74;
    var headX = point.x + r * 0.06 * flip;
    ctx.fillStyle = palette.skin;
    ctx.beginPath();
    ctx.arc(headX, headY, headR, 0, TAU);
    ctx.fill();

    ctx.fillStyle = palette.hair;
    ctx.beginPath();
    if (away) {
      // 背对镜头：整颗头都是头发（一眼看出"我在往上走"）
      ctx.arc(point.x, headY, headR, 0, TAU);
    } else {
      ctx.arc(headX, headY - headR * 0.14, headR * 1.02, Math.PI * 1.02, Math.PI * 2 - 0.02);
    }
    ctx.fill();

    if (!away) {
      // 两撮呆毛（Q版的可爱税只花一次落笔）
      ctx.beginPath();
      ctx.arc(headX - headR * 0.58, headY - headR * 0.78, headR * 0.26, 0, TAU);
      ctx.arc(headX + headR * 0.62, headY - headR * 0.7, headR * 0.22, 0, TAU);
      ctx.fill();

      drawEyes(ctx, headX, headY + headR * 0.12, headR * 0.24, headR * 0.42, r * 0.04 * flip, '#20242c');

      // 腮红
      ctx.fillStyle = 'rgba(255,155,155,0.55)';
      ctx.beginPath();
      ctx.arc(headX - headR * 0.62, headY + headR * 0.44, headR * 0.17, 0, TAU);
      ctx.arc(headX + headR * 0.66, headY + headR * 0.42, headR * 0.17, 0, TAU);
      ctx.fill();
    }

    drawTrinket(ctx, point, headX, headY, headR, r, flip, look.trinket);
  }

  /** 衣服款式细节：肩甲 / 锁环 / 长摆 / 交叉皮带 / 领口（底色由躯干铺好，这里只加"款式"） */
  function drawArmorDetail(ctx, point, baseY, r, armor, clothDark, trim) {
    var style = armor ? armor.style : 'tunic';
    var i;
    var y;
    if (style === 'plate') {
      ctx.fillStyle = trim;
      ctx.beginPath();
      ctx.arc(point.x - r * 0.62, baseY - r * 1.76, r * 0.3, 0, TAU);
      ctx.arc(point.x + r * 0.62, baseY - r * 1.76, r * 0.3, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.fillRect(point.x - r * 0.4, baseY - r * 1.7, r * 0.8, r * 0.12);
      return;
    }
    if (style === 'mail') {
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = r * 0.07;
      ctx.beginPath();
      for (i = 0; i < 3; i += 1) {
        y = baseY - r * 1.74 + i * r * 0.22;
        ctx.moveTo(point.x - r * 0.4, y);
        ctx.lineTo(point.x + r * 0.4, y);
      }
      ctx.stroke();
      return;
    }
    if (style === 'robe') {
      ctx.fillStyle = clothDark;
      ctx.beginPath();
      ctx.moveTo(point.x - r * 0.52, baseY - r * 1.0);
      ctx.lineTo(point.x + r * 0.52, baseY - r * 1.0);
      ctx.lineTo(point.x + r * 0.66, baseY - r * 0.46);
      ctx.lineTo(point.x - r * 0.66, baseY - r * 0.46);
      ctx.closePath();
      ctx.fill();
      return;
    }
    if (style === 'leather') {
      ctx.strokeStyle = trim;
      ctx.lineWidth = r * 0.09;
      ctx.beginPath();
      ctx.moveTo(point.x - r * 0.4, baseY - r * 1.9);
      ctx.lineTo(point.x + r * 0.34, baseY - r * 1.2);
      ctx.moveTo(point.x + r * 0.4, baseY - r * 1.9);
      ctx.lineTo(point.x - r * 0.34, baseY - r * 1.2);
      ctx.stroke();
      return;
    }
    // tunic / cloak：领口（一个倒三角）
    ctx.fillStyle = trim;
    ctx.beginPath();
    ctx.moveTo(point.x - r * 0.2, baseY - r * 2.0);
    ctx.lineTo(point.x + r * 0.2, baseY - r * 2.0);
    ctx.lineTo(point.x, baseY - r * 1.66);
    ctx.closePath();
    ctx.fill();
  }

  /**
   * 饰品外观：项链 / 指环 / 宝珠 / 头冠各画"多出来的那一笔"，不改角色本体 ——
   * 于是戴什么都还是同一个角色，只是身上多了一点东西。
   */
  function drawTrinket(ctx, point, headX, headY, headR, r, flip, trinket) {
    if (!trinket) return;
    var style = trinket.style || 'amulet';
    var orbX;
    var orbY;
    var w;
    if (style === 'ring') {
      ctx.strokeStyle = trinket.b;
      ctx.lineWidth = r * 0.09;
      ctx.beginPath();
      ctx.arc(point.x + r * 0.82 * flip, headY + r * 0.62, r * 0.14, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = trinket.a;
      ctx.beginPath();
      ctx.arc(point.x + r * 0.82 * flip, headY + r * 0.48, r * 0.08, 0, TAU);
      ctx.fill();
      return;
    }
    if (style === 'orb') {
      orbX = point.x - r * 0.9 * flip;
      orbY = headY - r * 0.1;
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = trinket.a;
      ctx.beginPath();
      ctx.arc(orbX, orbY, r * 0.28, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = trinket.a;
      ctx.beginPath();
      ctx.arc(orbX, orbY, r * 0.16, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = trinket.b;
      ctx.lineWidth = r * 0.05;
      ctx.beginPath();
      ctx.arc(orbX, orbY, r * 0.24, 0, TAU);
      ctx.stroke();
      return;
    }
    if (style === 'crown') {
      w = headR * 0.72;
      ctx.fillStyle = trinket.b;
      ctx.beginPath();
      ctx.moveTo(headX - w, headY - headR * 0.58);
      ctx.lineTo(headX - w, headY - headR * 0.98);
      ctx.lineTo(headX - w * 0.4, headY - headR * 0.72);
      ctx.lineTo(headX, headY - headR * 1.1);
      ctx.lineTo(headX + w * 0.4, headY - headR * 0.72);
      ctx.lineTo(headX + w, headY - headR * 0.98);
      ctx.lineTo(headX + w, headY - headR * 0.58);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = trinket.a;
      ctx.beginPath();
      ctx.arc(headX, headY - headR * 0.84, headR * 0.12, 0, TAU);
      ctx.fill();
      return;
    }
    // 项链（默认）：颈前一线 + 一颗宝石
    ctx.strokeStyle = trinket.b;
    ctx.lineWidth = r * 0.07;
    ctx.beginPath();
    ctx.moveTo(point.x - r * 0.3, headY + r * 0.66);
    ctx.lineTo(point.x, headY + r * 1.0);
    ctx.lineTo(point.x + r * 0.3, headY + r * 0.66);
    ctx.stroke();
    ctx.fillStyle = trinket.a;
    ctx.beginPath();
    ctx.arc(point.x, headY + r * 1.06, r * 0.13, 0, TAU);
    ctx.fill();
  }

  /**
   * 武器（A6 按造型画）：剑 / 巨剑 / 短刃 / 枪 / 斧 / 锤 / 法杖 / 镰，绕手腕旋转。
   *
   * 方向单位向量 (ux, uy) 与它的垂直向量 (px, py) 是两根"轴"，所有造型都用它们搭：
   * 沿轴摆长度、沿垂轴摆宽度 —— 于是加武器只需要加一个分支，旋转逻辑一个字都不用动。
   */
  function drawWeapon(ctx, handX, handY, r, flip, angle, palette, weapon) {
    var style = (weapon && weapon.style) || 'sword';
    var bladeColor = (weapon && weapon.a) || palette.weapon;
    var gripColor = (weapon && weapon.b) || '#7a5a38';
    var guardColor = (weapon && weapon.c) || palette.guard;
    var reach = style === 'spear' ? 2.0 : style === 'staff' ? 1.9 : style === 'greatsword' ? 1.75 : style === 'dagger' ? 1.0 : 1.5;
    var dx = Math.cos(angle) * r * reach * flip;
    var dy = Math.sin(angle) * r * reach;
    var len = Math.sqrt(dx * dx + dy * dy);
    if (!(len > 0.0001)) return;

    var ux = dx / len;
    var uy = dy / len;
    var px = -uy;
    var py = ux;
    var tipX = handX + ux * len;
    var tipY = handY + uy * len;
    var half = style === 'greatsword' ? 0.34 : 0.26;

    ctx.lineCap = 'round';

    // 柄：所有武器都有（法杖与枪另画长杆）
    ctx.strokeStyle = gripColor;
    ctx.lineWidth = r * 0.14;
    ctx.beginPath();
    ctx.moveTo(handX - ux * r * 0.2, handY - uy * r * 0.2);
    ctx.lineTo(handX + ux * r * 0.34, handY + uy * r * 0.34);
    ctx.stroke();

    if (style === 'staff') {
      ctx.strokeStyle = gripColor;
      ctx.lineWidth = r * 0.12;
      ctx.beginPath();
      ctx.moveTo(handX, handY);
      ctx.lineTo(handX + ux * len * 0.86, handY + uy * len * 0.86);
      ctx.stroke();
      ctx.fillStyle = bladeColor;
      ctx.beginPath();
      ctx.arc(tipX, tipY, r * 0.2, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = guardColor;
      ctx.lineWidth = r * 0.06;
      ctx.beginPath();
      ctx.arc(tipX, tipY, r * 0.3, 0, TAU);
      ctx.stroke();
      return;
    }

    if (style === 'spear') {
      ctx.strokeStyle = gripColor;
      ctx.lineWidth = r * 0.1;
      ctx.beginPath();
      ctx.moveTo(handX - ux * r * 0.6, handY - uy * r * 0.6);
      ctx.lineTo(handX + ux * len * 0.86, handY + uy * len * 0.86);
      ctx.stroke();
      ctx.fillStyle = bladeColor;
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(handX + ux * len * 0.7 + px * r * 0.2, handY + uy * len * 0.7 + py * r * 0.2);
      ctx.lineTo(handX + ux * len * 0.7 - px * r * 0.2, handY + uy * len * 0.7 - py * r * 0.2);
      ctx.closePath();
      ctx.fill();
      return;
    }

    if (style === 'axe') {
      ctx.strokeStyle = gripColor;
      ctx.lineWidth = r * 0.12;
      ctx.beginPath();
      ctx.moveTo(handX - ux * r * 0.4, handY - uy * r * 0.4);
      ctx.lineTo(handX + ux * len * 0.78, handY + uy * len * 0.78);
      ctx.stroke();
      ctx.fillStyle = bladeColor;
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(handX + ux * len * 0.6 + px * r * 0.5, handY + uy * len * 0.6 + py * r * 0.5);
      ctx.lineTo(handX + ux * len * 0.6, handY + uy * len * 0.6);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = guardColor;
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(handX + ux * len * 0.6 - px * r * 0.5, handY + uy * len * 0.6 - py * r * 0.5);
      ctx.lineTo(handX + ux * len * 0.6, handY + uy * len * 0.6);
      ctx.closePath();
      ctx.fill();
      return;
    }

    if (style === 'hammer') {
      ctx.strokeStyle = gripColor;
      ctx.lineWidth = r * 0.12;
      ctx.beginPath();
      ctx.moveTo(handX - ux * r * 0.4, handY - uy * r * 0.4);
      ctx.lineTo(handX + ux * len * 0.72, handY + uy * len * 0.72);
      ctx.stroke();
      ctx.fillStyle = bladeColor;
      ctx.beginPath();
      ctx.moveTo(handX + ux * len * 0.72 + px * r * 0.3, handY + uy * len * 0.72 + py * r * 0.3);
      ctx.lineTo(tipX + px * r * 0.3, tipY + py * r * 0.3);
      ctx.lineTo(tipX - px * r * 0.3, tipY - py * r * 0.3);
      ctx.lineTo(handX + ux * len * 0.72 - px * r * 0.3, handY + uy * len * 0.72 - py * r * 0.3);
      ctx.closePath();
      ctx.fill();
      return;
    }

    if (style === 'scythe') {
      ctx.strokeStyle = gripColor;
      ctx.lineWidth = r * 0.11;
      ctx.beginPath();
      ctx.moveTo(handX - ux * r * 0.4, handY - uy * r * 0.4);
      ctx.lineTo(handX + ux * len * 0.9, handY + uy * len * 0.9);
      ctx.stroke();
      ctx.fillStyle = bladeColor;
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(handX + ux * len * 0.6 + px * r * 0.62, handY + uy * len * 0.6 + py * r * 0.62);
      ctx.lineTo(handX + ux * len * 0.45 + px * r * 0.66, handY + uy * len * 0.45 + py * r * 0.66);
      ctx.lineTo(handX + ux * len * 0.72, handY + uy * len * 0.72);
      ctx.closePath();
      ctx.fill();
      return;
    }

    // 剑 / 巨剑 / 短刃：护手 + 刃 + 一道高光
    ctx.strokeStyle = guardColor;
    ctx.lineWidth = r * 0.14;
    ctx.beginPath();
    ctx.moveTo(handX + ux * r * 0.34 - px * r * half, handY + uy * r * 0.34 - py * r * half);
    ctx.lineTo(handX + ux * r * 0.34 + px * r * half, handY + uy * r * 0.34 + py * r * half);
    ctx.stroke();

    ctx.strokeStyle = bladeColor;
    ctx.lineWidth = r * (style === 'greatsword' ? 0.3 : style === 'dagger' ? 0.14 : 0.2);
    ctx.beginPath();
    ctx.moveTo(handX + ux * r * 0.4, handY + uy * r * 0.4);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = r * 0.05;
    ctx.beginPath();
    ctx.moveTo(handX + ux * r * 0.5 - px * r * 0.05, handY + uy * r * 0.5 - py * r * 0.05);
    ctx.lineTo(handX + ux * len * 0.9 - px * r * 0.05, handY + uy * len * 0.9 - py * r * 0.05);
    ctx.stroke();
  }

  /**
   * 角色预览（A10，用户要求"上方放置角色预览图"）：把同一个小人按**指定像素半径**画在界面里。
   *
   * 与 drawPlayer 共用 `drawHumanoid` 和同一份 look（09-equipment 的 lookOf），所以
   * "穿上什么就像什么"在面板里与地图上完全一致 —— 绝不会变成两套说法。
   * 与 drawPlayer 的差别只有三点，而且都是"界面层必须自己说了算"的部分：
   *   1. **不读相机**：(cx, cy) 就是屏幕设计坐标（cy 是脚底）；
   *   2. **不读 zoom / actorScale**：尺寸由调用方给 —— 面板里的角色不该随镜头远近变大变小；
   *   3. 不画攻击范围环、不做受击闪红：预览要的是"我现在长什么样"。
   * `index` 是八方向下标（0 = 面向镜头，见 facingIndex），`phase` 是走路相位（0 = 站定）。
   */
  function drawHeroPreview(ctx, cx, cy, radius, look, index, phase) {
    var point = { x: cx, y: cy };
    drawShadow(ctx, point, radius, 0.3);
    drawHumanoid(
      ctx,
      point,
      radius,
      typeof index === 'number' ? index : 0,
      typeof phase === 'number' ? phase : 0,
      PLAYER_PALETTE,
      1,
      look || EMPTY_LOOK
    );
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
    // A9：抬升量跟着演员层放大（角色被放大 4.55 倍后，名牌得跟着离开头顶）；条宽与字号仍是设计像素
    var lift = ((info.radius || 24) * 2.6 + BAL.view.nameplate.offsetY) * actorScale();
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
   * 技能特效（A5）之一：一圈向外扩的冲击环 —— 范围技（青色）与治疗（绿色）共用这份画法。
   * 颜色由调用方给，形状只由播到几成决定，所以同一条特效在 60Hz 与 30Hz 下看着一样。
   */
  function drawSkillRing(ctx, point, effect, played, life, color) {
    var radius = effect.radius * (0.35 + 0.65 * played);
    ctx.globalAlpha = life * 0.85;
    ctx.strokeStyle = color;
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.globalAlpha = life * 0.45;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius * 0.62, 0, Math.PI * 2);
    ctx.stroke();
  }

  /** 技能特效之二：从玩家指向目标的一道亮线 + 命中处的一圈光（穿刺） */
  function drawSkillBolt(ctx, point, effect, played, life, angle) {
    var length = effect.radius * (0.55 + 0.45 * played);
    var tipX = point.x + Math.cos(angle) * length;
    var tipY = point.y + Math.sin(angle) * length;
    ctx.globalAlpha = life * 0.9;
    ctx.strokeStyle = '#ffe08a';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();

    ctx.globalAlpha = life * 0.7;
    ctx.strokeStyle = '#fff3d0';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(tipX, tipY, 20 * (0.6 + played), 0, Math.PI * 2);
    ctx.stroke();
  }

  /**
   * 斩击特效（A4 打击感）：一道随时间扫过去的弧，暴击再加四道向外飞的光刺。
   * 只用 moveTo/arc/lineTo/stroke —— 冒烟的假 canvas 认这些图元，所以"特效画不出来"也能被抓到。
   * 角度由效果自带的 dirX/dirY 现算（atan2 只在这里出现，生成层依旧没有任何三角函数）。
   * A5 起这里同时负责技能特效（kind = ring / bolt / mend），按 `effect.kind` 分派。
   */
  function drawEffects(ctx, camera, effects, nowMs) {
    var now = typeof nowMs === 'number' ? nowMs : G.WORLD.now();
    var list = effects || [];
    for (var i = 0; i < list.length; i += 1) {
      var effect = list[i];
      // 每种特效自己的时长：斩击 = view.slashMs，技能 = skills.castEffectMs。
      // 用 startAt/until 反推而不是写死常数 —— 以后再加特效不会画成"瞬间消失"。
      var span = effect.until - (effect.startAt === undefined ? effect.until - BAL.view.slashMs : effect.startAt);
      var life = span > 0 ? (effect.until - now) / span : 0;
      if (!(life >= 0)) life = 0;
      if (life > 1) life = 1;
      if (life <= 0) continue;

      var point = toScreen(camera, effect.x, effect.y);
      var played = 1 - life;
      var angle = Math.atan2(effect.dirY, effect.dirX);
      var kind = effect.kind || 'slash';

      // 技能特效（A5）：只用 arc / moveTo / lineTo 这一组基础图元（假 canvas 只实现了这些）
      if (kind === 'ring') {
        drawSkillRing(ctx, point, effect, played, life, '#7fd7ff');
        ctx.globalAlpha = 1;
        continue;
      }
      if (kind === 'bolt') {
        drawSkillBolt(ctx, point, effect, played, life, angle);
        ctx.globalAlpha = 1;
        continue;
      }
      if (kind === 'mend') {
        drawSkillRing(ctx, point, effect, played, life, '#8ce99a');
        ctx.globalAlpha = 1;
        continue;
      }

      // A9：刀光跟着演员层放大 —— 它是"手上的刀扫过去"，必须贴住被放大的身体；
      // 上面已经 continue 掉的 ring / mend / bolt 是技能特效（含真实 AoE 半径），保持世界尺寸
      var radius = effect.radius * (0.85 + 0.4 * played) * actorScale();
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

  /** 远程弹道：一个小亮点沿直线飞；A9：亮点跟着演员层放大（否则宏观视角下只有 1 px） */
  function drawProjectiles(ctx, camera, shots) {
    ctx.fillStyle = '#9ad4ff';
    var scale = actorScale();
    for (var i = 0; i < shots.length; i += 1) {
      var point = toScreen(camera, shots[i].x, shots[i].y);
      ctx.beginPath();
      ctx.arc(point.x, point.y, 7 * scale, 0, Math.PI * 2);
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
    tier: tier,
    zoom: zoom,
    lodBlocks: lodBlocks,
    lodBlockTiles: lodBlockTiles,
    groundDetailAt: groundDetailAt,
    actorScale: actorScale,
    beginActor: beginActor,
    macroStats: macroStats,
    beginWorld: beginWorld,
    endWorld: endWorld,
    facingIndex: facingIndex,
    facesLeft: facesLeft,
    facesAway: facesAway,
    walkPhase: walkPhase,
    swingPhase: swingPhase,
    groundLevel: groundLevel,
    drawGround: drawGround,
    drawRoads: drawRoads,
    drawCamp: drawCamp,
    drawDecor: drawDecor,
    drawLandmarks: drawLandmarks,
    drawMonsters: drawMonsters,
    drawTargetRing: drawTargetRing,
    drawPlayer: drawPlayer,
    drawPlayerMark: drawPlayerMark,
    drawHeroPreview: drawHeroPreview,
    drawAvatar: drawAvatar,
    drawNameplate: drawNameplate,
    drawEffects: drawEffects,
    drawProjectiles: drawProjectiles,
    drawDamageNumbers: drawDamageNumbers
  };
})();
