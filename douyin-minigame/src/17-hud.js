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
