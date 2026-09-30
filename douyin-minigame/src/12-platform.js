/**
 * 12-platform.js —— 平台层：**全工程唯一允许出现 `tt.` 的文件**（架构铁律 #1）
 *
 * 为什么卡这么死：小游戏没有 DOM、没有 window，而云上跑断言时连 tt 都没有。
 * 只要"碰平台"的代码全部关在这一个文件里，02~11（逻辑层）就能在 node 里裸跑，
 * 于是"决策 #7 不做 web 端 ⇒ 失去 harness"这个坑被补上（见 tools\minigame-selftest.mjs）。
 *
 * 对外接口（上层只认这些，不认 tt / wx / window）：
 *   PLAT.available()      当前环境能不能真的跑（有主画布 = 能）
 *   PLAT.ctx() / canvas() 主画布与 2D 上下文
 *   PLAT.screen()         { cssW, cssH, dpr, safeArea }
 *   PLAT.onTouch(h)       触摸（小游戏用**全局** tt.onTouchStart，不是 canvas 事件）
 *   PLAT.storageGet/Set/Remove
 *   PLAT.vibrate(ms)      震动反馈（失败就当没有）
 *   PLAT.onShow(fn)       前后台切换（用来暂停 + 存档）
 *   PLAT.frame(fn)        每帧回调（requestAnimationFrame，带 setTimeout 兜底）
 *   PLAT.cloud(path, opt) 抖音云 HTTP（未配置 cloudBase 时直接 reject，**不发包**）
 */

G.PLAT = (function () {
  'use strict';

  var CONFIG = G.CONFIG;

  /** 唯一的平台探测点：node 里跑自检时 tt 是 undefined，所有 tt 调用都必须先过这一关 */
  var hasTt = typeof tt !== 'undefined' && tt !== null;

  var systemInfo = null;
  var mainCanvas = null;
  var ctx = null;
  var memoryStore = {};
  var touchHandlers = null;
  var showHandlers = [];

  function initCanvas() {
    if (mainCanvas) return mainCanvas;
    if (hasTt && typeof tt.createCanvas === 'function') {
      try {
        // 小游戏里第一次调用 tt.createCanvas() 拿到的就是**主画布**（屏幕）
        mainCanvas = tt.createCanvas();
      } catch (error) {
        mainCanvas = null;
      }
    }
    // 部分基础库版本直接把主画布挂在全局（typeof 探测，避免 node 里直接报错）
    if (!mainCanvas && typeof canvas !== 'undefined' && canvas) mainCanvas = canvas;
    if (mainCanvas && typeof mainCanvas.getContext === 'function') ctx = mainCanvas.getContext('2d');
    return mainCanvas;
  }

  function info() {
    if (!systemInfo) {
      if (hasTt && typeof tt.getSystemInfoSync === 'function') {
        try {
          systemInfo = tt.getSystemInfoSync();
        } catch (error) {
          systemInfo = null;
        }
      }
      // 兜底：iPhone X 尺寸。只影响布局、不影响逻辑，所以宁可给默认值也不抛
      if (!systemInfo) systemInfo = { windowWidth: 375, windowHeight: 812, pixelRatio: 2 };
    }
    return systemInfo;
  }

  function screen() {
    var system = info();
    var area = system.safeArea;
    var cssW = system.windowWidth || 375;
    var cssH = system.windowHeight || 812;
    return {
      cssW: cssW,
      cssH: cssH,
      dpr: system.pixelRatio || 1,
      safeArea: area
        ? { top: area.top || 0, bottom: cssH - (area.bottom || cssH) }
        : { top: 0, bottom: 0 }
    };
  }

  function available() {
    return !!initCanvas() && !!ctx;
  }

  function storageGet(key) {
    if (hasTt && typeof tt.getStorageSync === 'function') {
      try {
        var value = tt.getStorageSync(key);
        return value === undefined || value === null || value === '' ? null : value;
      } catch (error) {
        return null;
      }
    }
    return memoryStore[key] || null;
  }

  function storageSet(key, value) {
    if (hasTt && typeof tt.setStorageSync === 'function') {
      try {
        tt.setStorageSync(key, value);
        return true;
      } catch (error) {
        return false;
      }
    }
    memoryStore[key] = value;
    return true;
  }

  function storageRemove(key) {
    if (hasTt && typeof tt.removeStorageSync === 'function') {
      try {
        tt.removeStorageSync(key);
      } catch (error) {
        /* 删不掉就算了，不值得打断游戏 */
      }
      return;
    }
    delete memoryStore[key];
  }

  /**
   * 触摸事件。
   * 小游戏里必须用**全局** tt.onTouchStart（不是 canvas.addEventListener）；
   * 这也是上一版"点 UI 顺带触发攻击"那个 bug 的修法：事件只在这一处收，再分发。
   */
  function onTouch(handlers) {
    touchHandlers = handlers;
    if (!hasTt) return false;
    if (typeof tt.offTouchStart === 'function') {
      try {
        // 先全注销再注册，避免热更新后同一次触摸被处理两遍
        tt.offTouchStart();
        tt.offTouchMove();
        tt.offTouchEnd();
        tt.offTouchCancel();
      } catch (error) {
        /* 没注册过就 off 失败，忽略 */
      }
    }
    var bind = function (name, fn) {
      if (typeof tt[name] !== 'function') return;
      tt[name](fn);
    };
    bind('onTouchStart', function (event) {
      if (touchHandlers && touchHandlers.start) touchHandlers.start(event);
    });
    bind('onTouchMove', function (event) {
      if (touchHandlers && touchHandlers.move) touchHandlers.move(event);
    });
    bind('onTouchEnd', function (event) {
      if (touchHandlers && touchHandlers.end) touchHandlers.end(event);
    });
    bind('onTouchCancel', function (event) {
      if (touchHandlers && touchHandlers.end) touchHandlers.end(event);
    });
    return true;
  }

  function vibrate(ms) {
    if (!hasTt || typeof tt.vibrateShort !== 'function') return;
    try {
      tt.vibrateShort({ duration: ms });
    } catch (error) {
      /* 震动失败不值得报错 */
    }
  }

  /** 前后台切换：切回来时校准时间，切出去时存档（19-main 里接） */
  function onShow(handler) {
    showHandlers.push(handler);
    if (hasTt && typeof tt.onShow === 'function') {
      tt.onShow(function () {
        for (var i = 0; i < showHandlers.length; i += 1) showHandlers[i](true);
      });
      tt.onHide(function () {
        for (var i = 0; i < showHandlers.length; i += 1) showHandlers[i](false);
      });
    }
  }

  /** 每帧回调：优先 requestAnimationFrame（小游戏里有全局实现），没有就用 setTimeout 兜底 */
  function frame(callback) {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(callback);
      return;
    }
    setTimeout(function () {
      callback(Date.now());
    }, 16);
  }

  /**
   * 抖音云 HTTP 调用（阶段 B 的入口，现在只给「设置 → 云后端」做连通性自测）。
   * 没填 cloudBase 就直接 reject —— **默认一个包都不发**，单机玩法不受影响。
   */
  function cloud(path, options) {
    return new Promise(function (resolve, reject) {
      if (!CONFIG.cloudBase) {
        reject(new Error('未配置云后端地址（douyin-minigame/src/00-config.js 的 cloudBase）'));
        return;
      }
      if (!hasTt || typeof tt.request !== 'function') {
        reject(new Error('当前环境不支持 tt.request'));
        return;
      }
      var opt = options || {};
      tt.request({
        url: CONFIG.cloudBase + path,
        method: opt.method || 'GET',
        data: opt.data,
        header: { 'content-type': 'application/json' },
        success: function (res) {
          resolve(res);
        },
        fail: function (err) {
          reject(err);
        }
      });
    });
  }

  return {
    hasTt: function () {
      return hasTt;
    },
    initCanvas: initCanvas,
    available: available,
    ctx: function () {
      return ctx;
    },
    canvas: function () {
      return mainCanvas;
    },
    screen: screen,
    onTouch: onTouch,
    storageGet: storageGet,
    storageSet: storageSet,
    storageRemove: storageRemove,
    vibrate: vibrate,
    onShow: onShow,
    frame: frame,
    cloud: cloud
  };
})();
