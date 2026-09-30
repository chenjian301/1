/**
 * 15-input.js —— 输入层：浮动摇杆 + 圆形按钮（UI 层，只认设计单位坐标）
 *
 * 手感沿用上一版已验证的规则（balance.input）：
 *   - **浮动摇杆**：按下才出现，圆心 = 按下点（不用固定底盘，拇指落在哪就从哪推）；
 *   - 贴边夹取：摇杆帽超过 `stickRadius` 就被夹在圈上；
 *   - **死区** `deadZone`：抖一点不算移动，避免站着乱抖；
 *   - 按下有 `pressFeedbackMs` 的视觉反馈。
 *
 * 与上一版最大的不同（roadmap §四.4 踩过的坑）：触摸事件**只在这里收**，
 * 由 19-main 决定这一刻是"面板吃"还是"世界吃"，绝不让 UI 点击顺带触发攻击。
 *
 * 所有坐标都是**设计单位**（13-screen 已经把屏幕 CSS 像素换过来了）。
 */

G.INPUT = (function () {
  'use strict';

  var BAL = G.BAL;
  var SCREEN = G.SCREEN;

  var state = {
    /** 摇杆 */
    stick: {
      active: false,
      touchId: null,
      baseX: 0,
      baseY: 0,
      knobX: 0,
      knobY: 0,
      dx: 0,
      dy: 0,
      magnitude: 0,
      pressUntil: 0
    },
    /** 圆形按钮（由 19-main 每帧 setButtons 注册，坐标同为设计单位） */
    buttons: [],
    /** 正在按住的按钮（松手才触发点击） */
    pressedButtonId: null,
    pressedTouchId: null
  };

  var pressedFeedbackUntil = 0;

  function setButtons(list) {
    state.buttons = list || [];
  }

  function buttons() {
    return state.buttons;
  }

  /** 按钮命中测试：返回按钮对象或 null（圆形按钮，半径稍微放宽 6 设计像素，手指更好点） */
  function buttonAt(x, y) {
    for (var i = 0; i < state.buttons.length; i += 1) {
      var button = state.buttons[i];
      var dx = x - button.x;
      var dy = y - button.y;
      var r = button.r + 6;
      if (dx * dx + dy * dy <= r * r) return button;
    }
    return null;
  }

  /** 摇杆区（左下角的一块矩形，避开底部安全区）：只有落在这里才起摇杆 */
  function inStickZone(x, y) {
    var zoneW = SCREEN.width() * BAL.input.zoneWidthRatio;
    var zoneH = SCREEN.height() * BAL.input.zoneHeightRatio;
    return x >= 0 && x <= zoneW && y >= SCREEN.height() - SCREEN.safeBottom() - zoneH && y <= SCREEN.height();
  }

  function reset() {
    state.stick.active = false;
    state.stick.touchId = null;
    state.stick.dx = 0;
    state.stick.dy = 0;
    state.stick.magnitude = 0;
    state.pressedButtonId = null;
    state.pressedTouchId = null;
  }

  /**
   * 按下：先看按钮，再看摇杆区。
   * 返回 { button } 表示这一下落在按钮上（由调用方在松手时执行 onTap），
   * 返回 { stick: true } 表示起摇杆，返回 null 表示这一下不归输入层管。
   */
  function begin(pointer, nowMs) {
    var button = buttonAt(pointer.x, pointer.y);
    if (button) {
      state.pressedButtonId = button.id;
      state.pressedTouchId = pointer.id;
      pressedFeedbackUntil = nowMs + BAL.input.pressFeedbackMs;
      return { button: button };
    }
    if (!inStickZone(pointer.x, pointer.y)) return null;

    state.stick.active = true;
    state.stick.touchId = pointer.id;
    state.stick.baseX = pointer.x;
    state.stick.baseY = pointer.y;
    state.stick.knobX = pointer.x;
    state.stick.knobY = pointer.y;
    state.stick.dx = 0;
    state.stick.dy = 0;
    state.stick.magnitude = 0;
    return { stick: true };
  }

  function move(pointer) {
    if (!state.stick.active || pointer.id !== state.stick.touchId) return;
    var dx = pointer.x - state.stick.baseX;
    var dy = pointer.y - state.stick.baseY;
    var length = Math.sqrt(dx * dx + dy * dy);
    var radius = BAL.input.stickRadius;
    if (length > radius && length > 0.0001) {
      // 贴边夹取：摇杆帽最多推到圈上
      dx = (dx / length) * radius;
      dy = (dy / length) * radius;
      length = radius;
    }
    state.stick.knobX = state.stick.baseX + dx;
    state.stick.knobY = state.stick.baseY + dy;
    var magnitude = length / radius;
    if (magnitude < BAL.input.deadZone) {
      state.stick.dx = 0;
      state.stick.dy = 0;
      state.stick.magnitude = 0;
      return;
    }
    state.stick.magnitude = magnitude > 1 ? 1 : magnitude;
    state.stick.dx = dx / length;
    state.stick.dy = dy / length;
  }

  /** 松手：摇杆归零；按钮命中则返回它（调用方负责执行 onTap），没命中返回 null */
  function end(pointer) {
    if (state.stick.active && pointer.id === state.stick.touchId) {
      state.stick.active = false;
      state.stick.touchId = null;
      state.stick.dx = 0;
      state.stick.dy = 0;
      state.stick.magnitude = 0;
      return null;
    }
    if (state.pressedTouchId !== null && pointer.id === state.pressedTouchId) {
      var id = state.pressedButtonId;
      state.pressedButtonId = null;
      state.pressedTouchId = null;
      if (!id) return null;
      for (var i = 0; i < state.buttons.length; i += 1) {
        if (state.buttons[i].id === id) return state.buttons[i];
      }
      return null;
    }
    return null;
  }

  /** 当前移动方向（已归一化，含死区判定）：19-main 每帧读它驱动玩家 */
  function direction() {
    return { x: state.stick.dx, y: state.stick.dy, magnitude: state.stick.magnitude };
  }

  /** 摇杆是否处于按下态（绘制用：按下才画出来） */
  function stickActive() {
    return state.stick.active || pressedFeedbackUntil > 0;
  }

  /** 按钮是否处于按下反馈窗口（绘制用） */
  function isPressed(buttonId, nowMs) {
    return state.pressedButtonId === buttonId && nowMs < pressedFeedbackUntil + 200;
  }

  /** 画摇杆（圆形，符合"先用圆形代替外观"的阶段约定） */
  function draw(ctx) {
    var stick = state.stick;
    if (!stick.active) return;
    var radius = BAL.input.stickRadius;

    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(stick.baseX, stick.baseY, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(stick.baseX, stick.baseY, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.globalAlpha = 0.85;
    ctx.fillStyle = '#ffd479';
    ctx.beginPath();
    ctx.arc(stick.knobX, stick.knobY, BAL.input.knobDiameter / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  return {
    setButtons: setButtons,
    buttons: buttons,
    buttonAt: buttonAt,
    inStickZone: inStickZone,
    reset: reset,
    begin: begin,
    move: move,
    end: end,
    direction: direction,
    stickActive: stickActive,
    isPressed: isPressed,
    draw: draw,
    state: state
  };
})();
