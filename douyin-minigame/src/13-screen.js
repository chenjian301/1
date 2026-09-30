/**
 * 13-screen.js —— 竖屏适配（core/screen 层）
 *
 * 设计稿宽度固定 **720**（balance.view.designWidth），逻辑高度随手机长短可变：
 *   scale  = 屏幕 CSS 宽 / 720          → 所有绘制都用"设计单位"，手机再窄也不会挤
 *   height = 屏幕 CSS 高 / scale         → 长屏手机逻辑高度更大（视野更长，不是拉扁）
 *
 * 三条排版纪律（01-game-design §2）：
 *   1. UI 一律**锚点布局**（吸顶 / 吸底），不许写死 y 坐标；
 *   2. 安全区：顶部至少留 `view.safeTop`、底部至少留 `view.safeBottom`（避开刘海与手势条）；
 *   3. 触摸坐标是**屏幕 CSS 像素**，必须除以 scale 才是设计单位 —— 直接当世界坐标用会错位。
 */

G.SCREEN = (function () {
  'use strict';

  var BAL = G.BAL;

  /** 设计稿宽度：手机再窄也不变，靠缩放适配 */
  var DESIGN_WIDTH = BAL.view.designWidth;

  var state = {
    cssW: 375,
    cssH: 812,
    dpr: 1,
    scale: 1,
    width: DESIGN_WIDTH,
    height: 1600,
    safeTop: BAL.view.safeTop,
    safeBottom: BAL.view.safeBottom
  };

  /**
   * 重新计算适配（启动时调一次；小游戏支持 tt.onWindowResize 的话以后也能热调）。
   * 传入的是 PLAT.screen() 的结果。
   */
  function resize(screenInfo) {
    state.cssW = screenInfo.cssW;
    state.cssH = screenInfo.cssH;
    state.dpr = screenInfo.dpr;
    state.scale = state.cssW / DESIGN_WIDTH;
    state.width = DESIGN_WIDTH;
    state.height = state.cssH / state.scale;
    // 安全区取"文档下限"与"系统安全区"的较大值：两根都用上，谁大听谁的
    var systemTop = screenInfo.safeArea ? screenInfo.safeArea.top / state.scale : 0;
    var systemBottom = screenInfo.safeArea ? screenInfo.safeArea.bottom / state.scale : 0;
    state.safeTop = Math.max(BAL.view.safeTop, systemTop);
    state.safeBottom = Math.max(BAL.view.safeBottom, systemBottom);
    return state;
  }

  /**
   * 画布尺寸 + 变换。
   * 主画布的 width/height 是**物理像素**（CSS × dpr），而绘制坐标是设计单位，
   * 所以这里一次把 scale 与 dpr 都折进 setTransform —— 渲染层从此不用关心两者。
   */
  function applyTo(canvas, ctx) {
    var pixelW = Math.max(1, Math.round(state.cssW * state.dpr));
    var pixelH = Math.max(1, Math.round(state.cssH * state.dpr));
    if (canvas.width !== pixelW) canvas.width = pixelW;
    if (canvas.height !== pixelH) canvas.height = pixelH;
    var k = state.scale * state.dpr;
    ctx.setTransform(k, 0, 0, k, 0, 0);
  }

  function width() {
    return state.width;
  }

  function height() {
    return state.height;
  }

  function scale() {
    return state.scale;
  }

  function safeTop() {
    return state.safeTop;
  }

  function safeBottom() {
    return state.safeBottom;
  }

  /** 屏幕 CSS 坐标（触摸事件给的）→ 设计单位坐标 */
  function pointer(cssX, cssY) {
    return { x: cssX / state.scale, y: cssY / state.scale };
  }

  /** 竖屏中轴：居中排版用 */
  function centerX() {
    return state.width / 2;
  }

  /** 自动选目标的视野半径（世界单位）：沿用 balance.combat.visionRange */
  function visionRadius() {
    return BAL.combat.visionRange;
  }

  return {
    DESIGN_WIDTH: DESIGN_WIDTH,
    resize: resize,
    applyTo: applyTo,
    width: width,
    height: height,
    scale: scale,
    safeTop: safeTop,
    safeBottom: safeBottom,
    pointer: pointer,
    centerX: centerX,
    visionRadius: visionRadius,
    state: state
  };
})();
