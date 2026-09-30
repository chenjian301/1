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
 *   PLAT.login()          tt.login 的 code（失败 resolve(null)，降级成本机账号）
 *   PLAT.editText(opt)    平台键盘输入（昵称用；没有这个 API 时 resolve(null)）
 *   PLAT.sfx(name)        音效（audio\*.wav，由 tools\gen-minigame-sfx.mjs 生成）
 *   PLAT.bgm(play)        背景音乐（首次触摸解锁后才会真的响）
 *   PLAT.setAudio(opt)    音量与开关（由 20-main 从 balance + 存档设置推过来）
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

  /**
   * 平台登录：拿 `tt.login` 的 code —— 阶段 B 那条 `code → /api/profile → openid` 链路的第 0 步
   * （A4 就用它来区分"抖音账号"与"本机账号"）。
   *
   * 语义约定：**失败就 resolve(null)**，绝不 reject、绝不卡住玩家 ——
   * 拿不到 code 时界面会降级成"本机离线账号"，阶段 A 的单机玩法不受影响。
   */
  function login() {
    return new Promise(function (resolve) {
      if (!hasTt || typeof tt.login !== 'function') {
        resolve(null);
        return;
      }
      var done = false;
      var finish = function (value) {
        if (!done) {
          done = true;
          resolve(value);
        }
      };
      try {
        tt.login({
          success: function (res) {
            var code = res && typeof res.code === 'string' ? res.code : '';
            var anonymousCode = res && typeof res.anonymousCode === 'string' ? res.anonymousCode : '';
            finish(code || anonymousCode ? { code: code, anonymousCode: anonymousCode } : null);
          },
          fail: function () {
            finish(null);
          }
        });
      } catch (error) {
        finish(null);
      }
      // 兜底：部分基础库上 login 既不回 success 也不回 fail（比如没配 appid），3 秒后按失败处理
      setTimeout(function () {
        finish(null);
      }, 3000);
    });
  }

  /**
   * 文本输入：小游戏里没有 `<input>`，昵称只能靠平台键盘（`tt.showKeyboard`）。
   * 返回值：输入的字符串，或 null（= 玩家取消 / 当前基础库没有这个 API）。
   * 没有 API 时界面会自动退回"随机昵称 + 换一个"，所以这里不抛错。
   */
  function editText(options) {
    var opt = options || {};
    return new Promise(function (resolve) {
      if (!hasTt || typeof tt.showKeyboard !== 'function') {
        resolve(null);
        return;
      }
      var done = false;
      var value = typeof opt.defaultValue === 'string' ? opt.defaultValue : '';
      var finish = function (result) {
        if (done) return;
        done = true;
        if (hasTt && typeof tt.hideKeyboard === 'function') {
          try {
            tt.hideKeyboard({});
          } catch (error) {
            /* 键盘收不收得掉都不值得报错 */
          }
        }
        resolve(typeof result === 'string' && result ? result : null);
      };
      // 键盘确认 / 收起的回调是全局事件（不是 showKeyboard 的参数），两只都接上
      if (typeof tt.onKeyboardConfirm === 'function') {
        tt.onKeyboardConfirm(function (res) {
          if (res && typeof res.value === 'string') value = res.value;
        });
      }
      if (typeof tt.onKeyboardComplete === 'function') {
        tt.onKeyboardComplete(function (res) {
          if (res && typeof res.value === 'string') value = res.value;
          finish(value);
        });
      }
      try {
        tt.showKeyboard({
          defaultValue: value,
          maxLength: opt.maxLength || 12,
          multiple: false,
          confirmHold: false,
          confirmType: 'done',
          success: function (res) {
            if (res && typeof res.value === 'string') value = res.value;
          },
          fail: function () {
            finish(null);
          }
        });
      } catch (error) {
        finish(null);
      }
      // 兜底：有些基础库的 complete 事件不一定会回来，60 秒后按当前值收尾（不让 Promise 永远挂着）
      setTimeout(function () {
        finish(value);
      }, 60000);
    });
  }

  /* ---------------------------------------------------------------- 音频（A4） */

  /**
   * 音效文件（相对包根的路径）：由 `tools\gen-minigame-sfx.mjs` **生成**，不是下载来的素材
   * （决策 #10：不引入来源说不清的文件）。键名 = 代码里 PLAT.sfx('键名') 的名字。
   */
  var AUDIO_FILES = {
    hit: 'audio/hit.wav',
    crit: 'audio/crit.wav',
    kill: 'audio/kill.wav',
    hurt: 'audio/hurt.wav',
    levelup: 'audio/levelup.wav',
    chest: 'audio/chest.wav',
    ui: 'audio/ui.wav',
    camp: 'audio/camp.wav',
    cast: 'audio/cast.wav',
    mend: 'audio/mend.wav'
  };
  var BGM_FILE = 'audio/bgm.wav';

  /** 音频设置（由 20-main 从 balance + 存档设置推过来；平台层不认识"存档"这个东西） */
  var audio = { enabled: true, sfxEnabled: true, bgmEnabled: true, sfxVolume: 0.6, bgmVolume: 0.32 };
  var audioContexts = {};
  var bgmContext = null;
  var bgmPlaying = false;
  /** 小游戏要求"首次交互之后才能播"：解锁前不碰 BGM，音效照试（失败就算了） */
  var audioUnlocked = false;

  function audioSupported() {
    return hasTt && typeof tt.createInnerAudioContext === 'function';
  }

  function makeContext(file, volume, loop) {
    if (!audioSupported()) return null;
    try {
      var instance = tt.createInnerAudioContext();
      instance.src = file;
      instance.volume = volume;
      if (loop === true) instance.loop = true;
      return instance;
    } catch (error) {
      return null;
    }
  }

  function contextFor(name) {
    if (audioContexts[name]) return audioContexts[name];
    if (!AUDIO_FILES[name]) return null;
    var instance = makeContext(AUDIO_FILES[name], audio.sfxVolume, false);
    if (instance) audioContexts[name] = instance;
    return instance;
  }

  function stopBgm() {
    if (!bgmContext) return false;
    try {
      bgmContext.stop();
    } catch (error) {
      /* 停不掉不值得报错 */
    }
    bgmPlaying = false;
    return true;
  }

  /** 推设置：开关与音量（改设置后调一次即可；已经建好的上下文会同步音量） */
  function setAudio(options) {
    var source = options || {};
    if (source.enabled !== undefined) audio.enabled = source.enabled === true;
    if (source.sfxEnabled !== undefined) audio.sfxEnabled = source.sfxEnabled === true;
    if (source.bgmEnabled !== undefined) audio.bgmEnabled = source.bgmEnabled === true;
    if (typeof source.sfxVolume === 'number') audio.sfxVolume = source.sfxVolume;
    if (typeof source.bgmVolume === 'number') audio.bgmVolume = source.bgmVolume;
    for (var name in audioContexts) {
      if (Object.prototype.hasOwnProperty.call(audioContexts, name)) audioContexts[name].volume = audio.sfxVolume;
    }
    if (bgmContext) bgmContext.volume = audio.bgmVolume;
    // 关掉 BGM 开关时立刻停：否则玩家会以为"设置没生效"
    if (!audio.enabled || !audio.bgmEnabled) stopBgm();
    return audio;
  }

  /** 播一次音效（没有 tt / 文件缺失 / 关掉音效 → 静默返回 false，绝不抛） */
  function sfx(name) {
    if (!audio.enabled || !audio.sfxEnabled) return false;
    var instance = contextFor(name);
    if (!instance) return false;
    try {
      if (typeof instance.stop === 'function') instance.stop();
      if (typeof instance.seek === 'function') instance.seek(0);
      instance.play();
      return true;
    } catch (error) {
      return false;
    }
  }

  /** 背景音乐：play=true 循环播；play=false 停 */
  function bgm(play) {
    if (play !== true) return stopBgm();
    if (!audio.enabled || !audio.bgmEnabled || !audioUnlocked) return false;
    if (!bgmContext) bgmContext = makeContext(BGM_FILE, audio.bgmVolume, true);
    if (!bgmContext) return false;
    try {
      bgmContext.play();
      bgmPlaying = true;
      return true;
    } catch (error) {
      return false;
    }
  }

  /** 首次触摸时调一次（之后音效 / BGM 才算"解锁"，这是平台的硬要求） */
  function unlockAudio() {
    if (audioUnlocked) return false;
    audioUnlocked = true;
    return true;
  }

  function audioState() {
    var ready = [];
    for (var name in audioContexts) {
      if (Object.prototype.hasOwnProperty.call(audioContexts, name)) ready.push(name);
    }
    return {
      supported: audioSupported(),
      unlocked: audioUnlocked,
      bgmPlaying: bgmPlaying,
      enabled: audio.enabled,
      sfxEnabled: audio.sfxEnabled,
      bgmEnabled: audio.bgmEnabled,
      sfxVolume: audio.sfxVolume,
      bgmVolume: audio.bgmVolume,
      files: Object.keys(AUDIO_FILES).concat(['bgm']),
      loaded: ready
    };
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
    cloud: cloud,
    login: login,
    editText: editText,
    setAudio: setAudio,
    sfx: sfx,
    bgm: bgm,
    stopBgm: stopBgm,
    unlockAudio: unlockAudio,
    audioSupported: audioSupported,
    audioState: audioState
  };
})();
