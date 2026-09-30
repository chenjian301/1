/**
 * 16-icons.js —— 程序自绘图标（阶段 A6 新增）
 *
 * 用户要求："每个 UI 按钮都做出对应的图标" + "装备内观（背包显示）"。
 * 小游戏包体里没有图集（贴图是阶段 E 的事），所以图标也**用基本图元画**：
 * 每个图标都在一个 s×s 的方框里、以 (cx, cy) 为中心，只用
 * fillRect / moveTo / lineTo / arc / fill / stroke —— 和 16-render.js 同一套纪律
 * （arcTo / ellipse / 虚线在冒烟测试的假 canvas 里没有实现）。
 *
 * 三组图标：
 *   1. **功能键与技能键**（`button`）：箱 / 包 / 会 / 营 / 设 / 自动 + 斩 / 疗 / 刺 / 旋；
 *   2. **装备内观**（`item` / `weapon` / `armor` / `boots` / `trinket`）：读的是
 *      09-equipment 的 look（造型 id + 三档配色），所以"装备长什么样"只有一份说法 ——
 *      人物身上由 16-render.js 画，背包里由这里画；
 *   3. **部位占位**（`slotPlaceholder`）与**阶色边框**（`frame`）：空部位也要看得出是哪个部位。
 *
 * 注意：本文件**不引入三角函数**（齿轮的斜齿用显式坐标的菱形），
 * 于是 check-minigame.ps1 的三角函数白名单一个字都不用改。
 */

G.ICONS = (function () {
  'use strict';

  var BAL = G.BAL;
  var TAU = Math.PI * 2;

  /** 六阶阶色（唯一一份：18-panels 的 tierColor 也读它，免得两处各写一套颜色） */
  var TIER_COLORS = ['#c7c7c7', '#8ce99a', '#a9d5ff', '#d0a9ff', '#ff9b5a', '#ffd479'];

  /** 图标里的"暗色"（锁扣 / 门洞 / 中心孔这类负形） */
  var DARK = '#1b2438';

  function tierColor(tier) {
    return TIER_COLORS[tier - 1] || '#c7c7c7';
  }

  /* ------------------------------------------------------------ 基本图元 */

  function rect(ctx, x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  }

  /** 多边形填充：points = [[x,y], ...]（只用 moveTo/lineTo/closePath/fill） */
  function poly(ctx, points, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (var i = 1; i < points.length; i += 1) ctx.lineTo(points[i][0], points[i][1]);
    ctx.closePath();
    ctx.fill();
  }

  function circle(ctx, x, y, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }

  function ring(ctx, x, y, r, color, width) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.stroke();
  }

  function bar(ctx, x1, y1, x2, y2, color, width) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  /** 一小段圆弧（横扫 / 旋风 / 自动这类"绕圈"的语义都靠它） */
  function arc(ctx, x, y, r, from, to, color, width) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(x, y, r, from, to);
    ctx.stroke();
  }

  /** 三角形（箭头 / 枪尖 / 宝石切面都用它） */
  function triangle(ctx, ax, ay, bx, by, cx2, cy2, color) {
    poly(ctx, [[ax, ay], [bx, by], [cx2, cy2]], color);
  }

  /* ------------------------------------------------------------ 功能键图标 */

  /** 开箱：箱体 + 梯形盖 + 锁带 */
  function chest(ctx, cx, cy, s, color) {
    var w = s * 0.88;
    var h = s * 0.6;
    var x = cx - w / 2;
    var y = cy - h * 0.3;
    rect(ctx, x, y + h * 0.44, w, h * 0.56, color);
    poly(ctx, [[x, y + h * 0.46], [x + w, y + h * 0.46], [x + w * 0.87, y], [x + w * 0.13, y]], color);
    rect(ctx, cx - w * 0.08, y + h * 0.3, w * 0.16, h * 0.72, DARK);
    rect(ctx, x, y + h * 0.8, w, h * 0.08, DARK);
    circle(ctx, cx, y + h * 0.62, s * 0.06, '#fff3d0');
  }

  /** 背包：方包 + 两条背带 + 束带 */
  function bag(ctx, cx, cy, s, color) {
    var w = s * 0.66;
    var h = s * 0.66;
    var x = cx - w / 2;
    var y = cy - h * 0.18;
    rect(ctx, x, y, w, h, color);
    bar(ctx, x + w * 0.26, y, x + w * 0.36, y - h * 0.4, color, s * 0.07);
    bar(ctx, x + w * 0.74, y, x + w * 0.64, y - h * 0.4, color, s * 0.07);
    rect(ctx, x, y + h * 0.4, w, h * 0.12, DARK);
    rect(ctx, cx - w * 0.09, y + h * 0.36, w * 0.18, h * 0.2, DARK);
  }

  /** 公会：盾牌 + 中间的星 */
  function guild(ctx, cx, cy, s, color) {
    var w = s * 0.66;
    var top = cy - s * 0.42;
    poly(
      ctx,
      [[cx - w / 2, top], [cx + w / 2, top], [cx + w / 2, cy + s * 0.06], [cx, cy + s * 0.44], [cx - w / 2, cy + s * 0.06]],
      color
    );
    var d = s * 0.16;
    poly(ctx, [[cx, cy - s * 0.22], [cx + d, cy - s * 0.02], [cx, cy + s * 0.2], [cx - d, cy - s * 0.02]], DARK);
  }

  /** 营地：三角帐篷 + 门洞 + 顶杆 */
  function camp(ctx, cx, cy, s, color) {
    var w = s * 0.9;
    var h = s * 0.66;
    poly(ctx, [[cx - w / 2, cy + h * 0.52], [cx + w / 2, cy + h * 0.52], [cx, cy - h * 0.48]], color);
    poly(ctx, [[cx - w * 0.13, cy + h * 0.52], [cx + w * 0.13, cy + h * 0.52], [cx, cy - h * 0.02]], DARK);
    bar(ctx, cx, cy - h * 0.48, cx, cy - h * 0.48 - s * 0.12, color, s * 0.06);
  }

  /** 设置：齿轮（4 个正齿 + 4 个斜齿用显式坐标，不引入三角函数） */
  function menu(ctx, cx, cy, s, color) {
    var outer = s * 0.34;
    var tooth = s * 0.11;
    var i;
    var sign = [1, -1];
    for (i = 0; i < 2; i += 1) {
      rect(ctx, cx - tooth / 2, cy + sign[i] * outer - tooth / 2, tooth, tooth, color);
      rect(ctx, cx + sign[i] * outer - tooth / 2, cy - tooth / 2, tooth, tooth, color);
    }
    var d = outer * 0.76;
    var k = tooth * 0.62;
    for (i = 0; i < 4; i += 1) {
      var sx = i === 0 || i === 3 ? 1 : -1;
      var sy = i < 2 ? -1 : 1;
      poly(
        ctx,
        [
          [cx + sx * d, cy + sy * d - k],
          [cx + sx * d + k, cy + sy * d],
          [cx + sx * d, cy + sy * d + k],
          [cx + sx * d - k, cy + sy * d]
        ],
        color
      );
    }
    circle(ctx, cx, cy, outer * 0.86, color);
    circle(ctx, cx, cy, s * 0.11, DARK);
  }

  /** 自动战斗：一把小剑 + 一圈环绕箭头（"它自己在打"） */
  function auto(ctx, cx, cy, s, color) {
    rect(ctx, cx - s * 0.05, cy - s * 0.06, s * 0.1, s * 0.44, color);
    rect(ctx, cx - s * 0.16, cy - s * 0.1, s * 0.32, s * 0.07, color);
    triangle(ctx, cx, cy - s * 0.44, cx + s * 0.11, cy - s * 0.16, cx - s * 0.11, cy - s * 0.16, color);
    arc(ctx, cx, cy, s * 0.42, -0.35, 2.1, color, s * 0.07);
    arc(ctx, cx, cy, s * 0.42, Math.PI - 0.35, Math.PI + 2.1, color, s * 0.07);
    triangle(ctx, cx + s * 0.44, cy + s * 0.1, cx + s * 0.3, cy + s * 0.18, cx + s * 0.52, cy + s * 0.24, color);
  }

  /** 攻击：斜劈的刀 + 一道光（留给以后的手动攻击键） */
  function attack(ctx, cx, cy, s, color) {
    bar(ctx, cx - s * 0.3, cy + s * 0.3, cx + s * 0.26, cy - s * 0.26, color, s * 0.14);
    triangle(ctx, cx + s * 0.44, cy - s * 0.44, cx + s * 0.46, cy - s * 0.14, cx + s * 0.14, cy - s * 0.46, color);
    bar(ctx, cx - s * 0.34, cy + s * 0.16, cx - s * 0.14, cy + s * 0.36, '#ffd479', s * 0.08);
  }

  /* ------------------------------------------------------------ 技能键图标 */

  /** 横扫：两道弧 + 一个箭头（范围技） */
  function cleave(ctx, cx, cy, s, color) {
    arc(ctx, cx - s * 0.12, cy + s * 0.12, s * 0.44, -1.5, 0.5, color, s * 0.11);
    arc(ctx, cx - s * 0.12, cy + s * 0.12, s * 0.26, -1.5, 0.5, color, s * 0.08);
    triangle(ctx, cx + s * 0.2, cy - s * 0.34, cx + s * 0.42, cy - s * 0.24, cx + s * 0.22, cy - s * 0.06, color);
  }

  /** 疗愈：十字 + 一道光环 */
  function mend(ctx, cx, cy, s, color) {
    rect(ctx, cx - s * 0.1, cy - s * 0.34, s * 0.2, s * 0.68, color);
    rect(ctx, cx - s * 0.34, cy - s * 0.1, s * 0.68, s * 0.2, color);
    ring(ctx, cx, cy, s * 0.46, color, s * 0.06);
  }

  /** 穿刺：长枪 + 速度线（单体远距离） */
  function pierce(ctx, cx, cy, s, color) {
    bar(ctx, cx - s * 0.4, cy + s * 0.36, cx + s * 0.24, cy - s * 0.2, color, s * 0.1);
    triangle(ctx, cx + s * 0.46, cy - s * 0.46, cx + s * 0.4, cy - s * 0.14, cx + s * 0.14, cy - s * 0.4, color);
    bar(ctx, cx - s * 0.38, cy + s * 0.06, cx - s * 0.18, cy + s * 0.2, color, s * 0.06);
  }

  /** 旋风：中心圆 + 三道环绕弧（周身范围） */
  function whirl(ctx, cx, cy, s, color) {
    circle(ctx, cx, cy, s * 0.16, color);
    arc(ctx, cx, cy, s * 0.38, 0.2, 1.9, color, s * 0.1);
    arc(ctx, cx, cy, s * 0.38, Math.PI + 0.2, Math.PI + 1.9, color, s * 0.1);
    arc(ctx, cx, cy, s * 0.46, -1.3, -0.4, color, s * 0.07);
  }

  /* ------------------------------------------------------------ 装备内观 */

  /** 空部位用的"幽灵款式"：只给个剪影，玩家一眼知道这里是武器 / 衣服 / 鞋 / 饰品 */
  var GHOST_STYLE = { weapon: 'sword', armor: 'tunic', boots: 'boot', trinket: 'amulet' };

  function ghostLook(slotId, color) {
    return { slot: slotId, style: GHOST_STYLE[slotId] || 'sword', a: color, b: color, c: color, tier: 1 };
  }

  /** 武器：柄 + 护手 + 按造型画刃（剑 / 短刃 / 巨剑 / 枪 / 斧 / 锤 / 法杖 / 镰） */
  function weapon(ctx, look, cx, cy, s) {
    var style = (look && look.style) || 'sword';
    var blade = (look && look.a) || '#dbe4f2';
    var grip = (look && look.b) || '#6b4a2c';
    var guard = (look && look.c) || '#c8ccd6';
    var bottom = cy + s * 0.46;
    var tip = cy - s * 0.46;

    rect(ctx, cx - s * 0.055, bottom - s * 0.24, s * 0.11, s * 0.24, grip);
    rect(ctx, cx - s * 0.085, bottom - s * 0.03, s * 0.17, s * 0.06, grip);

    if (style === 'spear') {
      bar(ctx, cx, bottom - s * 0.04, cx, cy - s * 0.18, grip, s * 0.08);
      rect(ctx, cx - s * 0.09, cy - s * 0.24, s * 0.18, s * 0.07, guard);
      triangle(ctx, cx, tip, cx + s * 0.15, cy - s * 0.1, cx - s * 0.15, cy - s * 0.1, blade);
      return;
    }
    if (style === 'staff') {
      bar(ctx, cx, bottom - s * 0.02, cx, cy - s * 0.2, grip, s * 0.08);
      ring(ctx, cx, cy - s * 0.32, s * 0.16, guard, s * 0.05);
      circle(ctx, cx, cy - s * 0.32, s * 0.1, blade);
      return;
    }
    if (style === 'hammer') {
      bar(ctx, cx, bottom - s * 0.04, cx, cy - s * 0.18, grip, s * 0.09);
      rect(ctx, cx - s * 0.25, cy - s * 0.44, s * 0.5, s * 0.26, blade);
      rect(ctx, cx - s * 0.25, cy - s * 0.22, s * 0.5, s * 0.07, guard);
      return;
    }
    if (style === 'axe') {
      bar(ctx, cx, bottom - s * 0.04, cx, cy - s * 0.32, grip, s * 0.09);
      poly(ctx, [[cx - s * 0.02, cy - s * 0.46], [cx - s * 0.34, cy - s * 0.33], [cx - s * 0.34, cy - s * 0.02], [cx - s * 0.02, cy - s * 0.1]], blade);
      poly(ctx, [[cx + s * 0.02, cy - s * 0.46], [cx + s * 0.34, cy - s * 0.33], [cx + s * 0.34, cy - s * 0.02], [cx + s * 0.02, cy - s * 0.1]], guard);
      return;
    }
    if (style === 'scythe') {
      bar(ctx, cx, bottom - s * 0.04, cx, cy - s * 0.4, grip, s * 0.08);
      arc(ctx, cx + s * 0.18, cy - s * 0.34, s * 0.24, Math.PI * 0.5, Math.PI * 1.4, blade, s * 0.09);
      return;
    }

    var wide = style === 'greatsword';
    var short = style === 'dagger';
    var w = wide ? s * 0.22 : short ? s * 0.12 : s * 0.16;
    var bladeTop = short ? cy - s * 0.2 : tip;
    rect(ctx, cx - (wide ? s * 0.3 : s * 0.22), cy - s * 0.3, wide ? s * 0.6 : s * 0.44, s * 0.09, guard);
    poly(
      ctx,
      [
        [cx - w / 2, cy - s * 0.26],
        [cx + w / 2, cy - s * 0.26],
        [cx + w / 2, bladeTop + s * 0.1],
        [cx, bladeTop],
        [cx - w / 2, bladeTop + s * 0.1]
      ],
      blade
    );
    bar(ctx, cx, cy - s * 0.22, cx, bladeTop + s * 0.13, 'rgba(255,255,255,0.3)', s * 0.03);
  }

  /** 衣服：躯干 + 领口 + 腰带，按款式加肩甲 / 锁环 / 长摆 / 披风 / 皮带 */
  function armor(ctx, look, cx, cy, s) {
    var style = (look && look.style) || 'tunic';
    var cloth = (look && look.a) || '#4f7fd8';
    var trim = (look && look.b) || '#e0c07a';
    var light = 'rgba(255,255,255,0.18)';

    if (style === 'cloak') {
      poly(ctx, [[cx - s * 0.4, cy - s * 0.36], [cx + s * 0.4, cy - s * 0.36], [cx + s * 0.3, cy + s * 0.42], [cx - s * 0.3, cy + s * 0.42]], cloth);
      rect(ctx, cx - s * 0.4, cy - s * 0.38, s * 0.8, s * 0.08, trim);
      poly(ctx, [[cx - s * 0.1, cy - s * 0.3], [cx + s * 0.1, cy - s * 0.3], [cx, cy - s * 0.12]], DARK);
      return;
    }

    poly(ctx, [[cx - s * 0.3, cy - s * 0.34], [cx + s * 0.3, cy - s * 0.34], [cx + s * 0.24, cy + s * 0.3], [cx - s * 0.24, cy + s * 0.3]], cloth);
    poly(ctx, [[cx - s * 0.1, cy - s * 0.34], [cx + s * 0.1, cy - s * 0.34], [cx, cy - s * 0.18]], DARK);
    rect(ctx, cx - s * 0.26, cy + s * 0.12, s * 0.52, s * 0.08, trim);
    rect(ctx, cx - s * 0.05, cy + s * 0.12, s * 0.1, s * 0.08, DARK);

    if (style === 'plate') {
      poly(ctx, [[cx - s * 0.44, cy - s * 0.3], [cx - s * 0.26, cy - s * 0.34], [cx - s * 0.26, cy - s * 0.04], [cx - s * 0.44, cy - s * 0.08]], trim);
      poly(ctx, [[cx + s * 0.44, cy - s * 0.3], [cx + s * 0.26, cy - s * 0.34], [cx + s * 0.26, cy - s * 0.04], [cx + s * 0.44, cy - s * 0.08]], trim);
      bar(ctx, cx - s * 0.2, cy - s * 0.16, cx + s * 0.2, cy - s * 0.16, light, s * 0.04);
    } else if (style === 'mail') {
      bar(ctx, cx - s * 0.22, cy - s * 0.2, cx + s * 0.22, cy - s * 0.2, light, s * 0.035);
      bar(ctx, cx - s * 0.22, cy - s * 0.08, cx + s * 0.22, cy - s * 0.08, light, s * 0.035);
      bar(ctx, cx - s * 0.2, cy + s * 0.04, cx + s * 0.2, cy + s * 0.04, light, s * 0.035);
    } else if (style === 'robe') {
      poly(ctx, [[cx - s * 0.24, cy + s * 0.3], [cx + s * 0.24, cy + s * 0.3], [cx + s * 0.32, cy + s * 0.46], [cx - s * 0.32, cy + s * 0.46]], cloth);
      rect(ctx, cx - s * 0.32, cy + s * 0.44, s * 0.64, s * 0.05, trim);
    } else if (style === 'leather') {
      bar(ctx, cx - s * 0.18, cy - s * 0.28, cx + s * 0.14, cy + s * 0.06, trim, s * 0.05);
      bar(ctx, cx + s * 0.18, cy - s * 0.28, cx - s * 0.14, cy + s * 0.06, trim, s * 0.05);
    } else {
      bar(ctx, cx - s * 0.2, cy - s * 0.02, cx + s * 0.2, cy - s * 0.02, light, s * 0.035);
    }
  }

  /** 一只鞋：小腿 + 脚掌 + 鞋底，按款式加绑带 / 胫甲 / 膝甲 */
  function bootOne(ctx, x, baseY, s, h, color, sole, style) {
    var w = s * 0.3;
    var top = baseY - h;
    rect(ctx, x - w * 0.5, top, w, h * 0.72, color);
    poly(ctx, [[x - w * 0.5, top + h * 0.66], [x + w * 1.1, top + h * 0.66], [x + w * 1.1, top + h * 0.9], [x - w * 0.5, top + h * 0.9]], color);
    rect(ctx, x - w * 0.5, top + h * 0.9, w * 1.6, h * 0.12, sole);

    if (style === 'sandal') {
      bar(ctx, x - w * 0.5, top + h * 0.3, x + w * 0.5, top + h * 0.3, sole, s * 0.05);
      bar(ctx, x - w * 0.5, top + h * 0.55, x + w * 0.5, top + h * 0.55, sole, s * 0.05);
    } else if (style === 'greave') {
      bar(ctx, x, top + h * 0.08, x, top + h * 0.64, sole, s * 0.05);
      rect(ctx, x - w * 0.6, top - s * 0.03, w * 1.2, s * 0.06, sole);
    } else if (style === 'plateboot') {
      circle(ctx, x, top - s * 0.14, s * 0.1, sole);
      rect(ctx, x - w * 0.55, top + h * 0.2, w * 1.1, s * 0.05, sole);
    } else {
      bar(ctx, x - w * 0.3, top + h * 0.14, x + w * 0.3, top + h * 0.14, 'rgba(255,255,255,0.2)', s * 0.04);
    }
  }

  /** 鞋子：两只并排（一眼看出是"一双鞋"） */
  function boots(ctx, look, cx, cy, s) {
    var style = (look && look.style) || 'boot';
    var color = (look && look.a) || '#2b3550';
    var sole = (look && look.b) || '#1b2438';
    var h = style === 'greave' || style === 'plateboot' ? s * 0.64 : s * 0.5;
    var baseY = cy + h * 0.5;
    bootOne(ctx, cx - s * 0.17, baseY, s, h, color, sole, style);
    bootOne(ctx, cx + s * 0.17, baseY, s, h, color, sole, style);
  }

  /** 饰品：项链 / 指环 / 宝珠 / 头冠 */
  function trinket(ctx, look, cx, cy, s) {
    var style = (look && look.style) || 'amulet';
    var gem = (look && look.a) || '#ffd479';
    var metal = (look && look.b) || '#c0c7d6';
    var d = s * 0.17;

    if (style === 'ring') {
      ring(ctx, cx, cy + s * 0.1, s * 0.28, metal, s * 0.1);
      poly(ctx, [[cx, cy - s * 0.24], [cx + d, cy - s * 0.02], [cx, cy + s * 0.2], [cx - d, cy - s * 0.02]], gem);
      return;
    }
    if (style === 'orb') {
      ring(ctx, cx, cy, s * 0.38, metal, s * 0.05);
      circle(ctx, cx, cy, s * 0.24, gem);
      circle(ctx, cx - s * 0.08, cy - s * 0.09, s * 0.07, 'rgba(255,255,255,0.75)');
      return;
    }
    if (style === 'crown') {
      poly(
        ctx,
        [
          [cx - s * 0.38, cy + s * 0.22],
          [cx - s * 0.38, cy - s * 0.1],
          [cx - s * 0.18, cy + s * 0.04],
          [cx, cy - s * 0.26],
          [cx + s * 0.18, cy + s * 0.04],
          [cx + s * 0.38, cy - s * 0.1],
          [cx + s * 0.38, cy + s * 0.22]
        ],
        metal
      );
      rect(ctx, cx - s * 0.4, cy + s * 0.24, s * 0.8, s * 0.09, metal);
      circle(ctx, cx, cy - s * 0.02, s * 0.06, gem);
      circle(ctx, cx - s * 0.26, cy + s * 0.08, s * 0.05, gem);
      circle(ctx, cx + s * 0.26, cy + s * 0.08, s * 0.05, gem);
      return;
    }
    // 项链（默认）：一道链 + 一颗坠
    arc(ctx, cx, cy - s * 0.04, s * 0.3, Math.PI * 1.12, Math.PI * 1.88, metal, s * 0.06);
    poly(ctx, [[cx, cy + s * 0.02], [cx + d, cy + s * 0.24], [cx, cy + s * 0.46], [cx - d, cy + s * 0.24]], gem);
    circle(ctx, cx - s * 0.05, cy + s * 0.18, s * 0.045, 'rgba(255,255,255,0.7)');
  }

  /**
   * 装备内观（背包 / 部位格都用它）：按 look.slot 分派。
   * look 为空 = "这里没有装备"，画一个很淡的点，格子不会空得莫名其妙。
   */
  function item(ctx, look, cx, cy, s) {
    if (!look) {
      circle(ctx, cx, cy, s * 0.2, 'rgba(109,134,181,0.45)');
      return;
    }
    if (look.slot === 'weapon') return weapon(ctx, look, cx, cy, s);
    if (look.slot === 'armor') return armor(ctx, look, cx, cy, s);
    if (look.slot === 'boots') return boots(ctx, look, cx, cy, s);
    return trinket(ctx, look, cx, cy, s);
  }

  /** 空部位的剪影占位（统一压淡，和真装备区分得开） */
  function slotPlaceholder(ctx, slotId, cx, cy, s, color) {
    item(ctx, ghostLook(slotId, color || 'rgba(140,164,208,0.5)'), cx, cy, s * 0.84);
  }

  /** 八边形路径（不依赖 roundRectPath，加载顺序更自由） */
  function path(ctx, points) {
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (var i = 1; i < points.length; i += 1) ctx.lineTo(points[i][0], points[i][1]);
    ctx.closePath();
  }

  /** 装备格 / 图标外框：阶色描边（dim = 空位或等级不够时压淡） */
  function frame(ctx, x, y, size, tier, dim) {
    var k = size * 0.2;
    var points = [
      [x + k, y],
      [x + size - k, y],
      [x + size, y + k],
      [x + size, y + size - k],
      [x + size - k, y + size],
      [x + k, y + size],
      [x, y + size - k],
      [x, y + k]
    ];
    path(ctx, points);
    ctx.fillStyle = 'rgba(12,18,32,0.86)';
    ctx.fill();
    ctx.strokeStyle = dim ? 'rgba(109,134,181,0.65)' : tierColor(tier || 1);
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  /* ------------------------------------------------------------ 登录 / 系统图标 */

  /** 登录：一扇门 + 走出去的箭头 */
  function login(ctx, cx, cy, s, color) {
    var w = s * 0.44;
    var h = s * 0.76;
    var x = cx - s * 0.36;
    var y = cy - h / 2;
    poly(ctx, [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], color);
    circle(ctx, x + w * 0.72, cy, s * 0.05, DARK);
    bar(ctx, cx + s * 0.16, cy, cx + s * 0.44, cy, color, s * 0.08);
    triangle(ctx, cx + s * 0.52, cy, cx + s * 0.32, cy - s * 0.15, cx + s * 0.32, cy + s * 0.15, color);
  }

  /** 创建角色：一个人头 + 肩膀 */
  function user(ctx, cx, cy, s, color) {
    circle(ctx, cx, cy - s * 0.18, s * 0.22, color);
    arc(ctx, cx, cy + s * 0.46, s * 0.34, Math.PI, TAU, color, s * 0.14);
  }

  /** 输入昵称：键盘（一排排小方块） */
  function keyboard(ctx, cx, cy, s, color) {
    var w = s * 0.78;
    var h = s * 0.52;
    var x = cx - w / 2;
    var y = cy - h / 2;
    var i;
    var j;
    rect(ctx, x, y, w, h, color);
    for (i = 0; i < 3; i += 1) {
      for (j = 0; j < 4; j += 1) {
        rect(ctx, x + w * 0.08 + j * w * 0.22, y + h * 0.14 + i * h * 0.27, w * 0.14, h * 0.18, DARK);
      }
    }
  }

  /** 换一个随机的：骰子（三个点） */
  function dice(ctx, cx, cy, s, color) {
    var w = s * 0.64;
    var x = cx - w / 2;
    var y = cy - w / 2;
    rect(ctx, x, y, w, w, color);
    circle(ctx, x + w * 0.3, y + w * 0.3, w * 0.09, DARK);
    circle(ctx, x + w * 0.5, y + w * 0.5, w * 0.09, DARK);
    circle(ctx, x + w * 0.7, y + w * 0.7, w * 0.09, DARK);
  }

  /** 清账号：垃圾桶 */
  function trash(ctx, cx, cy, s, color) {
    var w = s * 0.5;
    var x = cx - w / 2;
    rect(ctx, cx - w * 0.74, cy - s * 0.4, w * 1.48, s * 0.1, color);
    rect(ctx, x, cy - s * 0.28, w, s * 0.1, color);
    poly(ctx, [[x, cy - s * 0.16], [x + w, cy - s * 0.16], [x + w * 0.84, cy + s * 0.42], [x + w * 0.16, cy + s * 0.42]], color);
    bar(ctx, cx, cy - s * 0.06, cx, cy + s * 0.3, DARK, s * 0.06);
  }

  /** 属性：三根高低柱子（一眼看出"数值面板"） */
  function stat(ctx, cx, cy, s, color) {
    var baseY = cy + s * 0.4;
    var w = s * 0.2;
    rect(ctx, cx - s * 0.36, baseY - s * 0.28, w, s * 0.28, color);
    rect(ctx, cx - w / 2, baseY - s * 0.54, w, s * 0.54, color);
    rect(ctx, cx + s * 0.16, baseY - s * 0.78, w, s * 0.78, color);
  }

  /* ------------------------------------------------------------ 按钮图标分发 */

  var SKILL_ICONS = [cleave, mend, pierce, whirl];

  function skillIcon(index, ctx, cx, cy, s, color) {
    var fn = SKILL_ICONS[index % SKILL_ICONS.length];
    fn(ctx, cx, cy, s, color);
  }

  /** 一个键 id → 一个图标（HUD 的功能键与技能键走这里，未知 id 退化成圆环） */
  function button(ctx, id, cx, cy, s, color) {
    if (id === 'chest') return chest(ctx, cx, cy, s, color);
    if (id === 'bag') return bag(ctx, cx, cy, s, color);
    if (id === 'guild') return guild(ctx, cx, cy, s, color);
    if (id === 'camp') return camp(ctx, cx, cy, s, color);
    if (id === 'menu') return menu(ctx, cx, cy, s, color);
    if (id === 'auto') return auto(ctx, cx, cy, s, color);
    if (id === 'attack') return attack(ctx, cx, cy, s, color);
    if (id === 'login') return login(ctx, cx, cy, s, color);
    if (id === 'user') return user(ctx, cx, cy, s, color);
    if (id === 'keyboard') return keyboard(ctx, cx, cy, s, color);
    if (id === 'dice') return dice(ctx, cx, cy, s, color);
    if (id === 'trash') return trash(ctx, cx, cy, s, color);
    if (id === 'stat') return stat(ctx, cx, cy, s, color);
    if (typeof id === 'string' && id.indexOf('skill') === 0) {
      skillIcon(Number(id.slice(5)) || 0, ctx, cx, cy, s, color);
      return;
    }
    ring(ctx, cx, cy, s * 0.36, color, s * 0.08);
  }

  /** 图标尺寸统一从 balance.view.icon 取（改大小不用改代码） */
  function size(key) {
    var config = BAL.view.icon;
    return config && config[key] ? config[key] : 40;
  }

  return {
    TIER_COLORS: TIER_COLORS,
    tierColor: tierColor,
    size: size,
    frame: frame,
    item: item,
    slotPlaceholder: slotPlaceholder,
    weapon: weapon,
    armor: armor,
    boots: boots,
    trinket: trinket,
    chest: chest,
    bag: bag,
    guild: guild,
    camp: camp,
    menu: menu,
    auto: auto,
    attack: attack,
    cleave: cleave,
    mend: mend,
    pierce: pierce,
    whirl: whirl,
    login: login,
    user: user,
    keyboard: keyboard,
    dice: dice,
    trash: trash,
    stat: stat,
    skillIcon: skillIcon,
    button: button
  };
})();
