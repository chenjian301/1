/**
 * 17-hud.js —— 吸顶 / 吸底 HUD（竖屏单手布局，01-game-design §2）
 *
 * 布局纪律：所有 y 坐标都由 `SCREEN.safeTop()` / `SCREEN.safeBottom()` 推出来，
 * 不写死数字 —— 长屏、刘海屏、手势条都能自动躲开。
 *
 * 画的东西：
 *   吸顶：等级 + 经验条（Lv.12 ▓▓▓░░ 1.2k/2.4k）、金币、战力、当前难度带
 *   其下：玩家血条（战斗反馈的第一优先级）
 *   右上：**小地图**（chunk 网格 + 小径 + 营地 + 地标 + 怪 + 公会锚点 + 玩家朝向）
 *   吸底右侧：四个圆形功能键「箱 / 包 / 会 / 设」（带角标）
 *   左下：摇杆由 15-input 自己画
 *   调试面板（可选）：FPS / chunk 数 / 活跃怪数 / 当前目标 / 世界种子 / 世界指纹
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

  /**
   * 底部右侧的圆形功能键。交给 15-input 做命中测试（同一份坐标，避免两处各算一套）。
   * `badge` 是右上角的小角标（宝箱数 / 背包装备数 / 有没有公会）。
   */
  function buttons(view) {
    var radius = 46;
    var gap = 18;
    var x = SCREEN.width() - BAL.input.attackButtonMargin - radius;
    var y = SCREEN.height() - SCREEN.safeBottom() - radius;
    var save = view && view.save ? view.save : null;
    var defs = [
      { id: 'chest', label: '箱', badge: save ? save.chests.length : 0 },
      { id: 'bag', label: '包', badge: save ? save.items.length : 0 },
      { id: 'guild', label: '会', badge: save && save.guild ? 1 : 0 },
      { id: 'menu', label: '设', badge: 0 }
    ];
    var list = [];
    for (var i = 0; i < defs.length; i += 1) {
      list.push({
        id: defs[i].id,
        label: defs[i].label,
        badge: defs[i].badge || 0,
        x: x,
        y: y - i * (radius * 2 + gap),
        r: radius
      });
    }
    return list;
  }

  /** 画按钮（按下时稍微放大 + 变色，给"按到了"的反馈） */
  function drawButtons(ctx, list, nowMs) {
    for (var i = 0; i < list.length; i += 1) {
      var button = list[i];
      var pressed = G.INPUT.isPressed(button.id, nowMs);
      ctx.globalAlpha = pressed ? 0.95 : 0.72;
      ctx.fillStyle = pressed ? '#ffd479' : '#1b2438';
      ctx.beginPath();
      ctx.arc(button.x, button.y, button.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = pressed ? '#fff3d0' : '#4d5f86';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(button.x, button.y, button.r, 0, Math.PI * 2);
      ctx.stroke();

      text(ctx, button.label, button.x, button.y, 34, pressed ? '#241a05' : '#dce6ff', 'center');

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
    var top = SCREEN.safeTop() + 128 + BAL.view.minimap.size + 26;
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
    var top = SCREEN.safeTop() + 128;
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

  /** 主绘制：view 由 20-main 组装（玩家、属性、存档、FPS、目标…） */
  function draw(ctx, view) {
    var width = SCREEN.width();
    var top = SCREEN.safeTop();
    var save = view.save;
    var stats = view.stats;

    // 吸顶条底
    ctx.fillStyle = 'rgba(8,12,24,0.6)';
    ctx.fillRect(0, 0, width, top + 118);

    // 第一行：等级 / 金币 / 战力 / 难度带
    text(ctx, 'Lv.' + save.level, 24, top + 26, 34, '#ffd479');
    text(ctx, '金币 ' + PROG.shortNumber(save.gold), 168, top + 26, 26, '#f2e6c8');
    text(ctx, '战力 ' + stats.power, 360, top + 26, 26, '#a9d5ff');
    text(ctx, PROG.bandLabel(G.CHUNK.bandOf(view.player.x, view.player.y)), width - 24, top + 26, 22, '#9fb4d8', 'right');

    // 经验条
    var need = PROG.xpToNext(save.level);
    bar(ctx, 24, top + 50, width - 48, 24, need > 0 ? save.exp / need : 0, '#4f8fd8');
    text(
      ctx,
      '经验 ' + PROG.shortNumber(save.exp) + ' / ' + PROG.shortNumber(need),
      36,
      top + 62,
      18,
      '#e8f1ff',
      'left'
    );

    // 血条（战斗反馈第一优先级）
    var hpRatio = stats.hpMax > 0 ? view.player.hp / stats.hpMax : 0;
    bar(ctx, 24, top + 82, width - 48, 26, hpRatio, view.player.dead ? '#6b6b6b' : '#e05c5c');
    text(
      ctx,
      (view.player.dead ? '复活中… ' : '生命 ') + Math.max(0, Math.round(view.player.hp)) + ' / ' + stats.hpMax,
      36,
      top + 95,
      18,
      '#ffecec'
    );

    // 升级/掉落等闪光提示
    if (view.flash && view.flash.until > view.now) {
      text(ctx, view.flash.text, width / 2, top + 176, 40, '#ffe08a', 'center');
    }

    drawMinimap(ctx, view);
    drawButtons(ctx, view.buttons, view.now);
    if (view.debug) drawDebug(ctx, view);
  }

  return {
    buttons: buttons,
    draw: draw,
    drawMinimap: drawMinimap,
    bar: bar,
    text: text
  };
})();
