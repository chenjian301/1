/**
 * 17-hud.js —— 吸顶 / 吸底 HUD（竖屏单手布局，01-game-design §2）
 *
 * 布局纪律：所有 y 坐标都由 `SCREEN.safeTop()` / `SCREEN.safeBottom()` 推出来，
 * 不写死数字 —— 长屏、刘海屏、手势条都能自动躲开。
 *
 * 画的东西：
 *   吸顶：等级 + 经验条（Lv.12 ▓▓▓░░ 1.2k/2.4k）、金币、战力、当前难度带
 *   其下：玩家血条（战斗反馈的第一优先级）
 *   吸底右侧：四个圆形功能键「箱 / 包 / 会 / 设」（带角标，符合"先用圆形代替外观"）
 *   左下：摇杆由 15-input 自己画
 *   调试面板（可选）：FPS / chunk 数 / 活跃怪数 / 当前目标 / 世界种子
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
    var top = SCREEN.safeTop() + 150;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(12, top - 12, SCREEN.width() - 24, lines.length * 30 + 24);
    for (var i = 0; i < lines.length; i += 1) {
      text(ctx, lines[i], 24, top + i * 30, 20, '#bfe0ff');
    }
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

    drawButtons(ctx, view.buttons, view.now);
    if (view.debug) drawDebug(ctx, view);
  }

  return {
    buttons: buttons,
    draw: draw,
    bar: bar,
    text: text
  };
})();
