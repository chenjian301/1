/**
 * 20-main.js —— 入口：流程状态机 + 固定步长主循环 + 玩法结算 + 触摸路由
 *
 * 主循环的规矩（上一版吃过亏的地方）：
 *   - **逻辑固定 60Hz、渲染跟着屏幕刷新**：手机上掉帧时逻辑不会变慢，手感与数值才稳定；
 *   - 单帧最多追赶 `CONFIG.maxCatchUpSteps` 步：切后台回来不会"一顿狂算"把怪全打一遍；
 *   - 时钟只在这里读（`Date.now` 仅允许出现在 12 / 20 两个文件，静态检查卡这条），
 *     逻辑层自己维护 `WORLD.now()`，所以逻辑可重放、能在 node 里断言。
 *
 * 触摸路由（只此一处，修上一版"点 UI 顺带攻击"的 bug）：
 *   ① 界面在登录 / 创建角色 → G.LOGIN 吃；
 *   ② 面板卡片开着且这一点落在**卡片里**（或关闭键上）→ 18-panels 吃；
 *   ③ 其余一律给 15-input（摇杆 + 右下圆形功能键）。
 *   第 ② 条的"卡片里"是 A4 的关键：卡片只占一部分屏（A4 是 1/3，2026-10-01 改成约 2/3 屏高），
 *   **卡片外面照旧能推摇杆**，加上 step() 不再因为面板开着而 return，"打开背包 / 设置时游戏不停止"才真的成立。
 *
 * 界面状态机（A4）：'welcome'（登录）→ 'createRole'（创建角色 / 输入昵称）→ 'playing'。
 *   只有 'playing' 才跑世界逻辑，登录界面上的世界是静止的（还没登录，不该被怪打）。
 *
 * 玩法结算（经验 / 金币 / 掉箱 / 开箱 / 装备 / 商城 / 公会）放在这里的原因：
 *   它是**改存档的唯一地方**。阶段 B 起把这些函数原样搬到服务端即可 ——
 *   抽奖用的 rng 已经是传入的，接口一行都不用改（决策 #1 的前提）。
 *
 * A14（用户："宝箱可以设置是否自动开启——对应不同等阶不同的开启按钮"）的两条新路径也落在这里：
 *   - 按阶开箱：`openChestsOfTier`（宝箱清单每行右侧那枚「全开」）→ 真正扣箱的那一步在 `openChestAt`
 *     （A7 修订 2 的"先出装备、再扣箱"就在那里，"开箱必出装备"因此对两条路都成立）；
 *   - 自动开启：`autoOpenChest` —— 勾上的那一阶，箱子**一掉出来就当场开**（不进背包、不占 bagCap），
 *     调用点是 `applyKill` 的掉箱分支。勾选表本身是存档数据（`settings.chestAuto`，见 11-save / 08-loot）。
 *
 * 本次新增（用户：商城要能买强化石 + 营地里加铁匠NPC 强化装备）：
 *   - `buyStone`：商城的第二件货（100 金币一颗，`balance.shop.stone`），与 `buyHorn` 同一套规矩；
 *   - `enhanceItem(slotId)`：铁匠强化**已穿**的那一件 —— 扣强化石 → 09-equipment 的 `applyEnhance`
 *     （唯一改等级的地方）→ 重算属性快照。要几颗石头、涨多少主属性全在 `balance.enhance`，
 *     本文件一个数字都不写死；
 *   - `smithButton` / `nearSmith`：营地铁匠头顶那枚「锻」键 —— 只有站在他 `talkRadius` 以内才进
 *     HUD 按钮表（按相机投影算坐标），于是"画法 / 命中 / 点击"三者天然一致；
 *     18-panels 里的营地面板还有一行同样的入口（走不到他跟前也能开强化面板）。
 */

G.GAME = (function () {
  'use strict';

  var BAL = G.BAL;
  var CONFIG = G.CONFIG;
  var PLAT = G.PLAT;
  var SCREEN = G.SCREEN;
  var WORLD = G.WORLD;
  var PLAYER = G.PLAYER;
  var PROG = G.PROG;
  var LOOT = G.LOOT;
  var EQUIP = G.EQUIP;
  var SAVE = G.SAVE;
  var INPUT = G.INPUT;
  var HUD = G.HUD;
  var PANELS = G.PANELS;
  var RENDER = G.RENDER;
  /** 公会的规则与记录（本次新增）：等级怎么算、名字合不合法、服务端那份怎么变成本地镜像 */
  var GUILD = G.GUILD;

  var STEP_MS = 1000 / CONFIG.logicHz;

  var state = {
    running: false,
    save: null,
    player: null,
    stats: null,
    camera: { x: 0, y: 0 },
    /** 相机前瞻偏移（A11）：跟着"正在走的方向 / 正在打的目标"平滑移动。纯表现 —— 逻辑层不读它 */
    cameraLook: { x: 0, y: 0 },
    /** 表现用的闪光提示（升级 / 掉箱 / 抢怪…），到点自己消失 */
    flash: { text: '', until: 0 },
    fps: 0,
    frames: 0,
    fpsSince: 0,
    lastTickAt: 0,
    accumulator: 0,
    autosaveAt: 0,
    saveOk: false,
    debug: false,
    resetArmed: false,
    selftest: null,
    cloud: '',
    fingerprint: '',
    now: 0,
    /** 当前界面：'welcome'（登录）/ 'createRole'（创建角色）/ 'playing'（游戏里）—— A4 */
    screen: 'welcome',
    /** 本机账号（G.ACCOUNT.load() 的结果；没登录时是 null）—— A4 */
    account: null,
    /** 这一次触摸落在面板卡片里（卡片外照旧给摇杆 / 功能键）—— A4 */
    panelTouch: false,
    /** 受击顿帧剩余时长（毫秒）：>0 时世界冻住 —— 打击感全靠它 —— A4 */
    hitStopMs: 0,
    /** 震屏状态：{ until, power, ms }（power=0 表示没在震）—— A4 */
    shake: { until: 0, power: 0, ms: 1 },
    /** 音频是否可用（平台层回报；调试面板与设置面板都看它）—— A4 */
    audioReady: false,
    /** 上一帧在不在营地里（进出营地时提示一次）—— A4 */
    wasInCamp: false,
    /** 技能冷却（A5）：每个技能栏位一个"能再放的时刻"（世界时间毫秒）—— 不进存档，见 07-skills 的文件头 */
    skillCooldowns: [],
    /** 全局冷却（A5）：两次技能之间的最短间隔，防止四个键在同一帧里一起炸出去 */
    skillGlobalAt: 0,
    /** 最近放过的技能名（调试面板用）—— A5 */
    lastSkill: '',
    /**
     * 公会那一块的**运行态**（本次新增；不进存档）：网络提示 / 忙闲 / 服务端列表。
     *   note     —— 面板上那一行「服务端」说明（正在连 / 刚同步过 / 连不上）
     *   busy     —— 有没有一个请求在路上（防重复发包，也用来画"正在连接"）
     *   list     —— `GET/POST /api/guild/list` 拿到的公会列表（点一行加入）
     *   listAt   —— 上次刷新列表的世界时刻（面板上显示"x 分钟前"）
     *   autoAt   —— 上次自动刷新的时刻；**0 = 还没同步过**（打开面板时立刻来一次）
     * 存档里那份（成员 / 等级 / 锚点）在 `state.save.guild`，两者拼起来就是界面读的 view。
     */
    guild: { note: '', busy: false, list: [], listAt: 0, listNote: '', autoAt: 0 }
  };

  /**
   * 缩放轴拖动途中最近应用过的格数（A11 之二）：move 事件比像素还密，
   * 同一格重复调用没有意义（见 `applySliderDrag`）；一次触摸开始时归零。
   */
  var lastSliderTiles = 0;

  /** 屏幕中央的一条提示（小游戏没有原生 toast，自绘最省事） */
  function flash(message, ms) {
    if (!message) return;
    state.flash.text = message;
    state.flash.until = state.now + (ms || 1600);
  }

  /* ------------------------------------------------- 打击感与音频（A4 新增） */

  /** 音量 / 开关推给平台层（boot、改设置、读档后各调一次；平台层不认识"存档"） */
  function syncAudio() {
    var settings = state.save && state.save.settings ? state.save.settings : SAVE.defaultSettings();
    PLAT.setAudio({
      enabled: BAL.audio.enabled === true,
      sfxEnabled: settings.sfx !== false,
      bgmEnabled: settings.bgm !== false,
      sfxVolume: BAL.audio.sfxVolume,
      bgmVolume: BAL.audio.bgmVolume
    });
    state.audioReady = PLAT.audioSupported();
    return state.audioReady;
  }

  /** 播一次音效（玩家关掉了音效就什么都不做；没有 tt 时平台层自己会静默） */
  function playSfx(name) {
    var settings = state.save && state.save.settings ? state.save.settings : null;
    if (settings && settings.sfx === false) return false;
    return PLAT.sfx(name);
  }

  /**
   * 命中反馈：**受击顿帧 + 震屏 + 音效 + 震动**四件事一起做（用户要的"打击感"就是这个）。
   * 做成一个独立函数的原因：自检可以直接喂一份假的 events 断言数值，不用真去打一只怪。
   *   - 普通命中 45ms / 暴击 110ms（balance.view.hitStopMs）——顿帧太短没感觉，太长会"卡"；
   *   - 挨打也有 30ms：让"我被打了"这件事在画面上一顿，比飘字更快被感知；
   *   - 震屏**只有暴击**（26px/240ms，balance.view.shake）—— A7 修订 2 按用户要求
   *     "去掉受伤震屏"：挨打不再抖屏幕（挨打仍保留顿帧 + 音效 + 手机震动，反馈一点没少）。
   */
  function applyHitFeedback(events) {
    var hits = events && events.hits ? events.hits : [];
    var hurt = events && events.playerHits ? events.playerHits : [];
    var skillCast = events && events.skillCast ? events.skillCast : 0;
    var stop = 0;
    var crit = false;
    var plainHits = 0;
    for (var i = 0; i < hits.length; i += 1) {
      // 技能命中也吃同一套顿帧 / 震屏，但**不再叠一声普通命中音**：技能自己那声 cast 更清楚（A5）
      if (hits[i].skill !== true) plainHits += 1;
      if (hits[i].crit) {
        crit = true;
        if (BAL.view.hitStopMs.crit > stop) stop = BAL.view.hitStopMs.crit;
      } else if (BAL.view.hitStopMs.normal > stop) {
        stop = BAL.view.hitStopMs.normal;
      }
    }
    if (crit) {
      playSfx('crit');
      setShake(BAL.view.shake.critMs, BAL.view.shake.critPower);
      if (state.save.settings.vibrate !== false) PLAT.vibrate(30);
    } else if (plainHits > 0 || (hits.length > 0 && skillCast === 0)) {
      playSfx('hit');
    }
    if (hurt.length > 0) {
      playSfx('hurt');
      if (BAL.view.hitStopMs.hurt > stop) stop = BAL.view.hitStopMs.hurt;
      // A7 修订 2：挨打**不震屏**（用户要求"去掉受伤震屏"）—— 只顿帧 + 音效 + 手机震动；
      // 震屏留给暴击，那个才需要"咬手"。自检里有"挨打震屏幅度保持 0"这条断言。
      if (state.save.settings.vibrate !== false) PLAT.vibrate(20);
    }
    if (stop > state.hitStopMs) state.hitStopMs = stop;
    return { stop: state.hitStopMs, crit: crit, hits: hits.length, hurt: hurt.length };
  }

  /** 开一次震屏（power=0 或 ms<=0 就等于没开） */
  function setShake(ms, power) {
    if (!(ms > 0) || !(power > 0)) return state.shake;
    state.shake.until = state.now + ms;
    state.shake.power = power;
    state.shake.ms = ms;
    return state.shake;
  }

  /**
   * 震屏偏移（纯函数，只吃时间）：正弦衰减，时间到就归零。
   * 直接偏相机而不是偏每个绘制调用 —— 世界层完全不用知道"屏幕在抖"。
   */
  function shakeOffset(nowMs) {
    if (!(state.shake.power > 0) || nowMs >= state.shake.until) return { x: 0, y: 0 };
    var remain = (state.shake.until - nowMs) / state.shake.ms;
    var damp = remain > 0 ? remain : 0;
    if (damp > 1) damp = 1;
    return {
      x: Math.sin(nowMs * 0.09) * state.shake.power * damp,
      y: Math.cos(nowMs * 0.13) * state.shake.power * damp
    };
  }

  /** 渲染用的相机（= 真实相机 + 震屏偏移）。逻辑层永远读 state.camera，读到的是干净坐标 */
  function shakeCamera(nowMs) {
    var offset = shakeOffset(nowMs);
    if (offset.x === 0 && offset.y === 0) return state.camera;
    return { x: state.camera.x + offset.x, y: state.camera.y + offset.y };
  }

  /**
   * 相机归位（A11）：把相机钉在玩家身上，并把前瞻偏移清零。
   * 传送 / 复活 / 读档 / 换档 / 重置存档都要走它 —— 否则镜头会带着上一处的前瞻偏移"飘"过去。
   */
  function snapCamera() {
    state.camera.x = state.player.x;
    state.camera.y = state.player.y;
    state.cameraLook.x = 0;
    state.cameraLook.y = 0;
  }

  /**
   * 相机前瞻（A11）：镜头往"正在走的方向 / 正在打的目标"前移一点。
   *
   * 为什么：屏幕正中永远钉着玩家时，**前进方向上是盲的** —— 一半的屏幕被"走过的路"占着。
   * 规则：推着摇杆 → 朝摇杆（推得越满前移越多）；自动战斗 → 朝当前目标（没目标就朝最近的那只）；否则归零。
   * **纯表现**：只改 `state.cameraLook`，逻辑层读到的 player 坐标一个字节都不变。
   *
   * A11 之三（用户："视角没有锁定以角色为中心"）：`view.cameraLookAhead` 现在是 **0** ——
   * 这个偏移以**世界单位**计，近距离视角下它占屏幕的比例会大到把角色挤到边上
   * （22 格时占半屏的 34%、16 格时 47%），所以正式关掉：镜头锁定以角色为中心。
   * 机制留着（把 balance 里的数改回非 0 就恢复），下面的 `span <= 0` 分支就是那个开关。
   */
  function updateCameraLook(player) {
    var look = state.cameraLook;
    var span = BAL.view.cameraLookAhead;
    if (!(span > 0)) {
      // 锁定：前瞻恒为 0（不是"衰减到 0"，是压根不产生偏移）
      look.x = 0;
      look.y = 0;
      return;
    }
    var tx = 0;
    var ty = 0;
    if (player && !player.dead) {
      var direction = INPUT.direction();
      if (direction.magnitude > 0) {
        tx = direction.x * direction.magnitude;
        ty = direction.y * direction.magnitude;
      } else if (state.save && state.save.settings && state.save.settings.autoBattle) {
        var target = WORLD.monsterById(player.targetId) || WORLD.pickTarget(player);
        if (target) {
          var dx = target.x - player.x;
          var dy = target.y - player.y;
          var length = Math.sqrt(dx * dx + dy * dy);
          if (length > 0.0001) {
            tx = dx / length;
            ty = dy / length;
          }
        }
      }
    }
    var rate = BAL.view.cameraLookLerp;
    look.x += (tx * span - look.x) * rate;
    look.y += (ty * span - look.y) * rate;
  }

  /**
   * 相机跟随（A11 之三，用户："视角没有锁定以角色为中心"）：**把镜头钉在角色身上**。
   *
   * `view.cameraLerpPerTick >= 1` = 锁定：每逻辑帧直接把相机放到"玩家 + 前瞻"上 ——
   * 角色因此永远画在屏幕正中（前瞻已被关掉 = 0，见 `updateCameraLook`）。
   * 这里刻意用整块赋值而不是插值：`x += (t - x) * 1` 在浮点下仍可能差最后一位，
   * 而"锁定"是个硬要求（自检断言的是**逐字节相等**）。
   *
   * 小于 1 时退回缓动跟随（镜头落后玩家一点点），换档 / 传送 / 读档 / 拖缩放轴
   * 仍然走 `snapCamera` 直接贴合 —— 缓动再小也不会把镜头丢在上一处。
   */
  function followCamera(player) {
    var rate = BAL.view.cameraLerpPerTick;
    var tx = player.x + state.cameraLook.x;
    var ty = player.y + state.cameraLook.y;
    if (!(rate < 1)) {
      state.camera.x = tx;
      state.camera.y = ty;
      return;
    }
    if (!(rate > 0)) rate = 1;
    state.camera.x += (tx - state.camera.x) * rate;
    state.camera.y += (ty - state.camera.y) * rate;
  }

  /**
   * 当前视角的一份"人话"视图（A11 / A11 之二）：档名 / 一屏几格 / 倍率 / 宏观色格边长 / 一格几 CSS px。
   * 调试面板、设置面板那一行缩放轴、自检都读它 —— 界面层因此不用自己算"现在到底能看清什么"。
   *
   * 拖到两个档位之间时 `name` 是「自定义」（档名不再等于实际倍率，写个"中"就是在骗玩家），
   * `custom` 给自检与调试面板一个布尔量，不用去比字符串。
   */
  function zoomView() {
    var tiers = BAL.view.cameraTiers;
    var index = Math.floor(BAL.view.cameraTier);
    if (!(index >= 0) || index >= tiers.length) index = 0;
    var current = tiers[index];
    var tiles = Math.round(BAL.view.zoomTiles) > 0 ? Math.round(BAL.view.zoomTiles) : current.tiles;
    var zoom = RENDER.zoom();
    return {
      index: index,
      id: current.id,
      name: tiles === current.tiles ? current.name : '自定义',
      custom: tiles !== current.tiles,
      tiles: tiles,
      zoom: zoom,
      lodBlocks: RENDER.lodBlocks(),
      /** 一格在手机上几 CSS px（设计 px × 屏缩放 = cssW / designWidth） */
      tileCssPx: Math.round(zoom * BAL.world.tileSize * SCREEN.scale() * 100) / 100
    };
  }

  /** 离这个格数最近的那个预设档位（拖到两档之间时，宏观规格按更近的一档走） */
  function nearestZoomTier(tiles) {
    var tiers = BAL.view.cameraTiers;
    var best = 0;
    var bestGap = -1;
    for (var i = 0; i < tiers.length; i += 1) {
      var gap = Math.abs(tiers[i].tiles - tiles);
      if (bestGap < 0 || gap < bestGap) {
        bestGap = gap;
        best = i;
      }
    }
    return best;
  }

  /**
   * 把视角缩放到"一屏 tiles 格"（A11 之二，用户："玩家设置中添加视角缩放滚动轴，可以缩到16-64"）。
   *
   * 一次写三处，它们是"一个数"的三张脸：
   *   1. `view.zoomTiles` —— 渲染层读的倍率来源（`RENDER.zoom` = designWidth / (tiles × tileSize)）；
   *   2. `view.cameraTier` —— **最近的预设档位**：宏观色格边长 / 装载环 / 小地图半径都挂在档位上，
   *      按"离哪一档近"取规格，于是拖动时这些"档"级别的数字不会每格乱跳；
   *   3. 存档 `settings.zoomTiles`（重开还记得）+ `settings.zoomTier`（跟着写成最近那一档）——
   *      两个字段因此在任何时候都自洽，不会出现"档位写着中档、格数却是 22"。
   *
   * `quiet = true`：只应用、不提示、**不写磁盘** —— 拖动过程中每一格都写一次存储会把手机拖卡，
   * 松手那一下（`setZoomTiles(tiles, false)`）才落盘 + 给一句带数字的提示。
   * 界面上的"咔"一声由 20-main 的 handleAction 统一播（这里不重复播）。
   */
  function setZoomTiles(tiles, quiet) {
    var value = SAVE.clampZoomTiles(tiles);
    BAL.view.zoomTiles = value;
    BAL.view.cameraTier = nearestZoomTier(value);
    if (state.save && state.save.settings) {
      state.save.settings.zoomTiles = value;
      state.save.settings.zoomTier = BAL.view.cameraTier;
    }
    if (state.player) snapCamera();
    if (!quiet) {
      var info = zoomView();
      flash('视角：一屏 ' + info.tiles + ' 格（一格 ' + info.tileCssPx + ' CSS px）', 1600);
      writeSave();
    }
    return value;
  }

  /**
   * 切到第 index 档视角（A11，用户："相机视角还需要优化"）：写 `view.cameraTier`（渲染层读它）
   * + 存档 `settings.zoomTier`（重开还记得）+ 相机归位 + 一句带数字的提示。
   *
   * 为什么做成"运行时可切"而不是写死一个数：**细节与视野是一对取舍** ——
   * 一格几 CSS px = `tileSize × zoom × 屏缩放`，所以"一眼看到 128 格"和"看清脚下每一格"不可能同时成立。
   * 把选择交给玩家，并把代价（一格几 CSS px、宏观色格几格）直接写在提示里。
   * `quiet = true` 时只应用不提示（开机读档走这条）。
   *
   * A11 之二：档位现在是**预设** —— 切档同时把缩放轴放到这一档的格数上（`setZoomTiles` 的反方向），
   * 两个入口因此永远指向同一个倍率，不会出现"档位写着中档、倍率却是别的"。
   */
  function setZoomTier(index, quiet) {
    var tiers = BAL.view.cameraTiers;
    var i = Math.floor(index);
    if (!(i >= 0)) i = 0;
    if (i >= tiers.length) i = tiers.length - 1;
    BAL.view.cameraTier = i;
    BAL.view.zoomTiles = tiers[i].tiles;
    if (state.save && state.save.settings) {
      state.save.settings.zoomTier = i;
      state.save.settings.zoomTiles = tiers[i].tiles;
    }
    if (state.player) snapCamera();
    if (!quiet) {
      var info = zoomView();
      flash('视角：' + info.name + '（一屏 ' + info.tiles + ' 格 · 一格 ' + info.tileCssPx + ' CSS px）', 1800);
      playSfx('ui');
      writeSave();
    }
    return i;
  }

  /** 点一下换下一档（设置面板那一行）：远 → 中 → 近 → 远 */
  function cycleZoomTier() {
    return setZoomTier(zoomView().index + 1, false);
  }

  /* ---------------------------------------------------------------- 启动 */

  function boot() {
    SCREEN.resize(PLAT.screen());
    var canvas = PLAT.initCanvas();
    if (canvas) SCREEN.applyTo(canvas, PLAT.ctx());

    // 存档：首次进入随机出生（决策 #5），之后回上次离线位置
    state.save = SAVE.load(BAL.season.worldSeed, 1);
    state.player = PLAYER.create(state.save);
    state.stats = PLAYER.statsOf(state.save.level, state.save.loadout);
    state.player.hp = state.stats.hpMax;
    snapCamera();
    // A11：把存档里的视角档位应用到渲染层（静默 —— 开机不刷提示）
    // A11 之二：缩放轴是"档位之上"的那一层 —— 老存档没有 zoomTiles 时 normalizeSettings 已把它对齐到档位，
    // 有的话就以它为准。**先把值取出来再切档**：setZoomTier 会把 settings.zoomTiles 拉回档位值
    // （自检盯着这条：拖到 48 格再重开，必须还是 48，不能悄悄回到档位的 64）。
    var savedZoomTiles = state.save.settings.zoomTiles;
    setZoomTier(state.save.settings.zoomTier, true);
    setZoomTiles(savedZoomTiles, true);

    WORLD.reset(BAL.season.worldSeed);
    WORLD.ensureChunks(state.player.x, state.player.y);

    // 世界指纹启动时算一次并常驻调试面板：它是"两份实现没有漂移"的证据
    state.fingerprint = G.SELFTEST.worldFingerprint(BAL.season.worldSeed);

    INPUT.setButtons(uiView().buttons);
    PLAT.onTouch({ start: onTouchStart, move: onTouchMove, end: onTouchEnd });
    PLAT.onShow(onLifecycle);

    // 账号与界面（A4）：先读本机账号，再决定停在"登录 / 创建角色"还是直接进游戏
    state.account = G.ACCOUNT.load();
    if (!state.account && state.save.name) {
      // 老存档（v1 迁移过来的）自带角色名：补一条本机账号记录，玩家不用重新注册
      state.account = G.ACCOUNT.create({ name: state.save.name, mode: 'local', at: Math.round(state.now) });
      G.ACCOUNT.persist(state.account);
    }
    G.LOGIN.setHasAccount(!!state.account);
    if (state.account && state.save.name) {
      state.screen = 'playing';
    } else {
      state.screen = state.account ? 'createRole' : 'welcome';
      G.LOGIN.open(state.screen);
    }

    state.running = true;
    state.now = WORLD.now();
    state.lastTickAt = Date.now();
    state.autosaveAt = state.lastTickAt;
    // 音频设置推给平台层（音量 / 开关都来自 balance + 存档设置；BGM 等首次触摸解锁后才响）
    syncAudio();
    // 没有画布（node 里的自检 / 冒烟）就不挂主循环：同一份 boot() 既能上手机也能进测试
    if (PLAT.available()) PLAT.frame(frame);
    flash('点右下「设」→ 自检，可以当场验证全部逻辑', 3200);
  }

  /** 前后台切换：切出去先存档，切回来校准时间（防"一回来狂追帧"） */
  function onLifecycle(visible) {
    if (!visible) {
      writeSave();
      return;
    }
    state.lastTickAt = Date.now();
    state.accumulator = 0;
  }

  /** 存档（位置一起存：决策 #5 要求下次回到离线位置） */
  function writeSave() {
    if (!state.save || !state.player) return;
    state.save.x = state.player.x;
    state.save.y = state.player.y;
    state.saveOk = SAVE.write(state.save);
  }

  /* ------------------------------------------------ 账号 / 登录 / 建角色（A4 新增） */

  /**
   * 创建角色并进入游戏：**唯一的"进游戏"入口**（登录流程与 node 冒烟测试都走它）。
   * 只做本机能做的事：写存档里的角色名 + 登记账号 + 切界面。
   * 昵称唯一性里"服务端那一半"在 createRoleAction 里已经先做完，到这里名字必定可用。
   */
  function beginPlaying(rawName) {
    var name = G.ACCOUNT.sanitizeName(rawName) || G.ACCOUNT.suggest(Math.round(state.now));
    state.save.name = name;
    var account = state.account || G.ACCOUNT.create({ name: name, mode: 'local', at: Math.round(state.now) });
    state.account = G.ACCOUNT.update(account, { name: name, at: Math.round(state.now) });
    G.LOGIN.setHasAccount(true);
    state.screen = 'playing';
    state.panelTouch = false;
    PANELS.close();
    writeSave();
    flash('欢迎，' + name + '！点右下「自动」可开启自动战斗', 3600);
    return name;
  }

  /**
   * 昵称在服务端也占一个坑（只有配了 cloudBase 才发包）。
   * 约定：**服务端不可用不阻断建号** —— 返回 ok:true + source:'local' 并附一句说明，
   * 阶段 A 的铁律是"单机永远能玩"（决策 #10）。
   */
  function claimNameOnline(name) {
    return PLAT.cloud('/api/name', {
      method: 'POST',
      data: { name: name, account: state.account ? state.account.id : '' }
    })
      .then(function (res) {
        var body = res && res.data ? res.data : {};
        if (body.ok === true) return { ok: true, source: 'server' };
        if (body.error === 'name_taken') return { ok: false, source: 'server', reason: 'taken' };
        return { ok: true, source: 'local', note: '服务端未就绪（' + (body.error || 'unknown') + '）→ 仅本机去重' };
      })
      .catch(function () {
        return { ok: true, source: 'local', note: '连不上服务端 → 仅本机去重' };
      });
  }

  /** 登录：tt.login → /api/profile（真 code2session）→ 本机账号；任何一环失败都降级成本机离线账号 */
  function loginAction() {
    if (G.LOGIN.isBusy()) return;
    G.LOGIN.setBusy(true, '正在登录…');
    var settle = function (note) {
      G.LOGIN.setBusy(false, note || '');
      G.LOGIN.setHasAccount(!!state.account);
      if (state.save.name) {
        state.screen = 'playing';
        flash('欢迎回来，' + state.save.name, 2600);
      } else {
        state.screen = 'createRole';
        G.LOGIN.open('createRole');
      }
    };
    var localAccount = function (note) {
      state.account = G.ACCOUNT.create({ name: state.save.name || '', mode: 'local', at: Math.round(state.now) });
      settle(note);
    };

    if (!PLAT.hasTt()) {
      localAccount('测试环境没有平台登录接口 → 使用本机离线账号（正式包里会走抖音登录）');
      return;
    }
    PLAT.login().then(function (credentials) {
      if (!credentials) {
        localAccount('拿不到平台登录 code → 使用本机离线账号');
        return;
      }
      if (!CONFIG.cloudBase) {
        localAccount('已连上抖音，但没配云后端地址 → 使用本机离线账号');
        return;
      }
      return PLAT.cloud('/api/profile', {
        method: 'POST',
        data: { code: credentials.code, anonymousCode: credentials.anonymousCode }
      })
        .then(function (res) {
          var body = res && res.data ? res.data : {};
          if (body.ok !== true) {
            localAccount('云登录被拒（' + (body.error || 'unknown') + '）→ 本机离线账号');
            return;
          }
          state.account = G.ACCOUNT.create({
            id: body.account || '',
            name: state.save.name || '',
            mode: 'douyin',
            openid: body.openid || '',
            token: body.token || '',
            at: Math.round(state.now)
          });
          G.ACCOUNT.persist(state.account);
          settle('抖音账号登录成功' + (body.anonymous ? '（匿名 openid）' : ''));
        })
        .catch(function (error) {
          localAccount('连不上云后端：' + (error && error.message ? error.message : '未知错误') + ' → 本机离线账号');
        });
    });
  }

  /** 创建角色：先本地校验（格式 + 本机去重），再（可选）服务端占位，最后 beginPlaying */
  function createRoleAction() {
    if (G.LOGIN.isBusy()) return;
    var check = G.ACCOUNT.validate(G.LOGIN.draftName());
    if (!check.ok) {
      G.LOGIN.setMessage(G.ACCOUNT.reasonText(check.reason));
      return;
    }
    var finish = function (note) {
      beginPlaying(check.name);
      G.LOGIN.setBusy(false, note || '');
    };
    if (!PLAT.hasTt() || !CONFIG.cloudBase) {
      finish('昵称已在本机登记（离线去重）');
      return;
    }
    G.LOGIN.setBusy(true, '正在校验昵称…');
    claimNameOnline(check.name).then(function (result) {
      if (!result.ok) {
        G.LOGIN.setBusy(false, '昵称「' + check.name + '」已被占用，换一个');
        return;
      }
      finish(result.source === 'server' ? '昵称 ' + check.name + ' 已在服务端登记' : result.note);
    });
  }

  /** 平台键盘输入昵称（没有 showKeyboard 时退回随机昵称，并告诉玩家为什么） */
  function typeNameAction() {
    PLAT.editText({ defaultValue: G.LOGIN.draftName(), maxLength: BAL.account.nameMax }).then(function (value) {
      if (value === null || value === undefined) {
        G.LOGIN.randomName(Math.round(state.now) + 31);
        G.LOGIN.setMessage('平台键盘不可用 → 已换成随机昵称「' + G.LOGIN.draftName() + '」，可以一直点「换一个」');
        return;
      }
      G.LOGIN.setDraftName(value);
      var check = G.LOGIN.draftName() ? G.ACCOUNT.validate(G.LOGIN.draftName()) : { ok: false, reason: 'empty' };
      G.LOGIN.setMessage(check.ok ? '昵称可用：' + G.LOGIN.draftName() : G.ACCOUNT.reasonText(check.reason));
    });
  }

  /**
   * 平台键盘输入公会名（本次新增：用户要求"创建公会需要自己输入公会名"）。
   * 与登录页的 `typeNameAction` 是同一套办法：小游戏里没有 `<input>`，只能靠 `tt.showKeyboard`
   * （`PLAT.editText`）。**拿不到键盘就把随机名填进去**并说明原因 —— 模拟器里没有这个 API，
   * 那条路上"建会"不能断（与登录页的「换一个随机昵称」同一条兜底思路）。
   */
  function typeGuildName() {
    var current = PANELS.draftGuildName();
    var check = current ? GUILD.validate(current) : { ok: false };
    PLAT.editText({ defaultValue: check.ok ? check.name : '', maxLength: BAL.guild.nameMax }).then(function (value) {
      if (value === null || value === undefined) {
        var fallback = PANELS.nextGuildName(Math.round(state.now) + 41);
        PANELS.setDraftGuildName(fallback);
        flash('平台键盘不可用 → 已填一个随机公会名「' + fallback + '」，不满意可以再点一次', 3200);
        return;
      }
      PANELS.setDraftGuildName(value);
      var now = GUILD.validate(PANELS.draftGuildName());
      flash(now.ok ? '公会名可用：' + now.name : GUILD.reasonText(now.reason), 2600);
    });
  }

  /** 平台键盘输入"要加入的公会名"（与上面同一条路，只是草稿是另一个） */
  function typeJoinName() {
    PLAT.editText({ defaultValue: PANELS.joinDraftName(), maxLength: BAL.guild.nameMax }).then(function (value) {
      if (value === null || value === undefined) {
        flash('平台键盘不可用 → 从下面的公会列表里点一行加入', 3200);
        return;
      }
      PANELS.setJoinDraftName(value);
      var check = GUILD.validate(PANELS.joinDraftName());
      flash(check.ok ? '要加入的公会名：' + check.name : GUILD.reasonText(check.reason), 2600);
    });
  }

  /** 登录 / 创建角色界面上的按钮 → 动作（与 PANELS 的 action 同构，20-main 统一执行） */
  function handleLoginAction(action) {
    if (!action) return;
    if (action.type === 'login') loginAction();
    else if (action.type === 'createRole') createRoleAction();
    else if (action.type === 'typeName') typeNameAction();
    else if (action.type === 'randomName') {
      G.LOGIN.randomName(Math.round(state.now) + 17);
      G.LOGIN.setMessage('已换一个随机昵称：' + G.LOGIN.draftName());
    } else if (action.type === 'newAccount') {
      G.ACCOUNT.forget();
      state.account = null;
      G.LOGIN.setHasAccount(false);
      G.LOGIN.setMessage('本机账号已清除（存档与昵称注册表保留）');
    }
  }

  /**
   * 自动战斗的**走位**那一半（用户要求："自动战斗时不仅会自动释放技能，还会自动走向最近的怪物"）。
   * 出手由 14-world.playerAttack 负责（它本来就是自动的），这里只负责"走过去"：
   *   1. 摇杆只要推着就手动优先 —— 自动模式随时可以被玩家接管；
   *   2. 没有目标 / 目标死了就按"距离最近"重选（默认全地图：`combat.targetRange` = 0，
   *      与出手共用同一份 pickTarget / targetId）；
   *   3. 走到 `怪半径 + 攻击距离 × auto.moveStopRatio` 就站住：贴脸打容易被围殴，
   *      这个比例就是"贴上去"和"留半个身位"之间的取舍（在 balance 里，不在代码里）。
   * 返回当前目标（自检要断言"确实朝着最近的怪走了"）。
   */
  function autoStep(player, stats, dtMs) {
    var dtSec = dtMs / 1000;
    if (player.dead) {
      PLAYER.move(player, 0, 0, dtSec, stats);
      return null;
    }
    var target = WORLD.monsterById(player.targetId);
    if (!target && WORLD.now() >= player.targetAt) {
      target = WORLD.pickTarget(player);
      player.targetId = target ? target.id : 0;
      player.targetAt = WORLD.now();
    }
    if (!target) {
      PLAYER.move(player, 0, 0, dtSec, stats);
      return null;
    }
    var dx = target.x - player.x;
    var dy = target.y - player.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var reach = target.radius + BAL.player.attackRange * BAL.auto.moveStopRatio;
    if (dist <= reach || dist < 0.0001) {
      PLAYER.move(player, 0, 0, dtSec, stats);
      // 站住也要面向目标，否则会出现"背着脸砍"
      if (dist > 0.0001) {
        player.facing.x = dx / dist;
        player.facing.y = dy / dist;
      }
      return target;
    }
    PLAYER.move(player, dx, dy, dtSec, stats);
    return target;
  }

  /** 自动战斗开关（右下「自动」按钮）：写进存档，重开游戏还记得 */
  function toggleAutoBattle() {
    var settings = state.save.settings;
    settings.autoBattle = settings.autoBattle !== true;
    writeSave();
    flash(settings.autoBattle ? '自动战斗已开启：自动走向全地图最近的怪' : '自动战斗已关闭：手动摇杆走位', 2200);
    return settings.autoBattle;
  }

  /* ------------------------------------------------ 技能栏（A5 新增，A10 加勾选） */

  /** 冷却数组按技能个数补齐 / 截断（读档、改表之后长度都可能不一样） */
  function skillCooldowns() {
    var list = state.skillCooldowns;
    var total = G.SKILLS.count();
    for (var i = list.length; i < total; i += 1) list.push(0);
    if (list.length > total) list.length = total;
    return list;
  }

  /**
   * 四个技能键的「自动释放」勾选（A10）：读存档，再按**技能表长度**对齐一份新数组。
   *
   * 为什么要在 20-main 里对齐：勾选表是存档数据（可能有缺项、可能比技能表短），
   * 而 `SKILLS.autoChoice` 与 17-hud 都只该认一份"长度正确、值正确"的数组 ——
   * 于是"存档里有几个、现在有几个技能"这类对齐只在一个地方做（缺项当"勾上"）。
   */
  function skillAutoFlags() {
    var total = G.SKILLS.count();
    var list = state.save && state.save.settings ? state.save.settings.skillAuto : null;
    var out = [];
    for (var i = 0; i < total; i += 1) out.push(G.SKILLS.autoEnabled(list, i));
    return out;
  }

  /**
   * 切换第 i 个技能的"自动释放"（技能键右上角的勾选框，以及背包面板里的技能条都走它）。
   * 写存档 + 立刻给一句提示（"关了只是不会自动放，手动点照样能放"）。
   * 越界 / 没存档一律返回 null（界面上按空不该炸）。
   */
  function toggleSkillAuto(index) {
    if (!state.save || !state.save.settings) return null;
    var i = typeof index === 'number' ? Math.floor(index) : -1;
    if (!(i >= 0) || i >= G.SKILLS.count()) return null;
    var flags = skillAutoFlags();
    flags[i] = flags[i] !== true;
    state.save.settings.skillAuto = flags;
    writeSave();
    var slot = G.SKILLS.slotAt(i);
    playSfx('ui');
    flash(
      (slot ? slot.name : '技能') + '：自动释放已' + (flags[i] ? '开启' : '关闭') + (flags[i] ? '' : '（手动点它照样能放）'),
      1800
    );
    return flags;
  }

  /**
   * 按阶的「自动开启」勾选表（A14）：读存档 `settings.chestAuto`，再按**阶数**对齐一份新数组。
   *
   * 与技能勾选（`skillAutoFlags`）同一条纪律：对齐只在这一个地方做，18-panels 与 08-loot 都只认
   * "长度正确、值正确"的数组 —— 缺项 / 坏值 / 上个版本没有这个字段，一律当**关**
   * （判定在 `LOOT.autoEnabled`，于是"开关表坏了怎么办"只有一个答案：不替玩家花箱子）。
   */
  function chestAutoFlags() {
    var list = state.save && state.save.settings ? state.save.settings.chestAuto : null;
    var total = G.LOOT.tiers().length;
    var out = [];
    for (var i = 0; i < total; i += 1) out.push(G.LOOT.autoEnabled(list, i + 1));
    return out;
  }

  /**
   * 切换某一阶宝箱的"自动开启"（A14，宝箱清单每行右侧那枚勾选）：写存档 + 立刻给一句提示。
   * 越界 / 没存档一律返回 null（界面上按空不该炸）。
   *
   * 那句提示特意写明"掉出来就当场开"：勾了之后玩家不会再看到箱子进背包，说明白才不会被当成 bug。
   * 音效不在这里放 —— handleAction 已经为所有"非开箱"的 action 统一放了"咔"的一声，这里再放一次就成双响。
   */
  function toggleChestAuto(tierId) {
    if (!state.save || !state.save.settings) return null;
    var tier = typeof tierId === 'number' ? Math.floor(tierId) : -1;
    if (!(tier >= 1) || tier > G.LOOT.tiers().length) return null;
    var flags = chestAutoFlags();
    flags[tier - 1] = flags[tier - 1] !== true;
    state.save.settings.chestAuto = flags;
    writeSave();
    flash(
      LOOT.tierName(tier) + '宝箱：自动开启已' + (flags[tier - 1] ? '开启（掉出来就当场开）' : '关闭（照旧进背包）'),
      1800
    );
    return flags;
  }

  /**
   * 技能栏视图：每个栏位算好"解锁 / 冷却比例 / 剩余秒数"，界面层只认这一份
   * （决策 #4：界面不读玩法数据）。20-main 是唯一知道"技能表长什么样、冷却还剩多少"的地方，
   * 17-hud 只负责画圆和扇形 —— 与功能键一模一样的分工。
   */
  function skillView() {
    var nowMs = WORLD.now();
    var level = state.save ? state.save.level : 1;
    var cooldowns = skillCooldowns();
    var flags = skillAutoFlags();
    var slots = [];
    for (var i = 0; i < G.SKILLS.count(); i += 1) {
      var slot = G.SKILLS.slotAt(i);
      var unlocked = G.SKILLS.unlocked(i, level);
      var remain = unlocked ? G.SKILLS.remainMs(cooldowns, i, nowMs) : 0;
      slots.push({
        index: i,
        id: slot.id,
        name: slot.name,
        key: slot.key,
        type: slot.type,
        unlockLevel: slot.unlockLevel,
        unlocked: unlocked,
        ready: unlocked && remain <= 0,
        remainMs: remain,
        cool: remain > 0 && slot.cooldownMs > 0 ? remain / slot.cooldownMs : 0,
        state: !unlocked ? 'lock' : remain > 0 ? 'cool' : 'ready',
        /** A10：这个技能勾上"自动释放"了吗（17-hud 的勾选框与背包面板的技能条都读它） */
        auto: flags[i]
      });
    }
    return {
      level: level,
      unlocked: G.SKILLS.unlockedCount(level),
      total: G.SKILLS.count(),
      auto: !!(state.save && state.save.settings && state.save.settings.autoBattle === true),
      /** A10：勾上了自动释放的技能个数（HUD 的调试面板与自检读它） */
      autoCount: G.SKILLS.autoCount(flags),
      slots: slots
    };
  }

  /**
   * 真正执行一次技能释放（手动与自动都走这里，唯一的区别是 quiet —— 自动释放不刷屏提示）。
   * 顺序刻意写成"先判定 → 再结算 → 再记冷却"：判定不过就绝不进冷却（玩家按空不该被罚）。
   * 返回值给调用方与自检用：{ ok, reason, slot, id, name, type, targets, kills, healed, crit }。
   */
  function performCast(index, quiet) {
    if (state.screen !== 'playing' || !state.player || !state.stats) return { ok: false, reason: 'screen' };
    if (state.player.dead) {
      if (!quiet) flash('倒下了，复活后再放技能', 1400);
      return { ok: false, reason: 'dead' };
    }
    var nowMs = WORLD.now();
    var check = G.SKILLS.canCast(skillCooldowns(), state.skillGlobalAt, index, nowMs, state.save.level);
    var slot = check.slot;
    if (!check.ok) {
      if (!quiet) {
        if (check.reason === 'locked') {
          flash(
            slot ? slot.name + ' 要 Lv.' + slot.unlockLevel + ' 才解锁（现在 Lv.' + state.save.level + '）' : '没有这个技能',
            1800
          );
        } else if (check.reason === 'global') {
          flash('手速太快：技能之间有 ' + BAL.skills.globalCooldownMs + 'ms 公共冷却', 1200);
        } else {
          flash(slot ? slot.name + ' 冷却中：还要 ' + Math.ceil(check.remainMs / 1000) + ' 秒' : '技能不可用', 1400);
        }
      }
      return { ok: false, reason: check.reason, slot: index };
    }

    // 技能自己造一份 events：命中走同一套打击感，击杀走同一套奖励归属（决策 #1）
    var events = { kills: [], playerHits: [], playerDown: false, target: null, hits: [] };
    var result = WORLD.castSkill(state.player, state.stats, index, events);
    if (!result) return { ok: false, reason: 'unknown', slot: index };

    var stamped = G.SKILLS.markCast(skillCooldowns(), state.skillGlobalAt, index, nowMs);
    state.skillCooldowns = stamped.cooldowns;
    state.skillGlobalAt = stamped.globalAt;
    state.lastSkill = slot.name;
    state.save.stats.skillCasts = (state.save.stats.skillCasts || 0) + 1;

    playSfx(slot.type === 'heal' ? 'mend' : 'cast');
    applyHitFeedback(events);
    for (var i = 0; i < events.kills.length; i += 1) applyKill(events.kills[i]);

    if (!quiet) {
      if (slot.type === 'heal') flash(slot.name + '：+' + result.healed + ' 生命', 1400);
      else if (result.targets === 0) flash(slot.name + '：附近没有目标', 1200);
      else flash(slot.name + '：命中 ' + result.targets + ' 只（击杀 ' + result.kills + '）', 1400);
    }
    return {
      ok: true,
      reason: 'ok',
      slot: index,
      id: slot.id,
      name: slot.name,
      type: slot.type,
      targets: result.targets,
      kills: result.kills,
      healed: result.healed,
      crit: result.crit,
      /** 逐只的伤害明细（自检用它验证"怪掉的血 = 账上的伤害"） */
      hits: result.hits
    };
  }

  /** 点技能键（手动释放）：未解锁 / 冷却中 / 没目标都会给一句提示 */
  function castSkillSlot(index) {
    return performCast(index, false);
  }

  /**
   * 自动释放技能（A5）：自动战斗开着的逻辑帧调一次。
   * 挑哪个由 07-skills 的 `autoChoice` 决定（纯函数，可以单独断言）：从左到右第一个能用的，
   * 伤害技要有怪在打击范围内，治疗只在血量低于 `skills.autoHealRatio` 时放。
   * **A10**：只挑"勾上了自动释放"的技能（`settings.skillAuto`）—— 没勾的只不会被自动放，
   * 手动点那个键照样能放（见 castSkillSlot）。
   * 这就是 A4 决策 #10c 里说的"真要做技能得单开一个工作包"的那个工作包。
   */
  function autoCastStep() {
    if (!state.save || !state.save.settings || state.save.settings.autoBattle !== true) return null;
    var player = state.player;
    var stats = state.stats;
    if (!player || !stats || player.dead) return null;
    var chosen = G.SKILLS.autoChoice({
      cooldowns: skillCooldowns(),
      globalAt: state.skillGlobalAt,
      nowMs: WORLD.now(),
      level: state.save.level,
      auto: skillAutoFlags(),
      hpRatio: stats.hpMax > 0 ? player.hp / stats.hpMax : 1,
      x: player.x,
      y: player.y,
      monsters: WORLD.allMonsters()
    });
    if (chosen < 0) return null;
    return performCast(chosen, true);
  }

  /* ---------------------------------------------------------------- 逻辑步 */

  /**
   * 一个逻辑帧（固定 1/60 秒）。
   * A4 的两处关键改动：
   *   1. 只有 `screen === 'playing'` 才跑世界 —— 登录 / 创建角色界面上的世界是静止的；
   *   2. **面板开着不再暂停世界**（用户要求"打开背包、设置等界面时游戏不停止"）：
   *      卡片只占约 2/3 屏高（2026-10-01 从 1/3 屏改过来）、卡片外还能推摇杆，于是玩家可以边开着背包边跑图。
   *      代价写在 04-decisions #10：站着开箱会被怪打 —— 这是"不暂停"的必然结果。
   */
  function step(dtMs) {
    if (state.screen !== 'playing') return;

    // 受击顿帧（A4）：命中那一瞬间把世界冻住几十毫秒 —— 打击感的一半在这个数字上。
    // 顿帧期间连相机缓动都不推进，画面"咬"住一下才像真打到了东西。
    if (state.hitStopMs > 0) {
      state.hitStopMs -= dtMs;
      return;
    }

    var player = state.player;
    var stats = state.stats;

    if (player.dead) {
      if (WORLD.now() >= player.respawnAt) {
        PLAYER.respawn(player, stats);
        flash('已复活（原地、半血）', 1200);
      }
      PLAYER.move(player, 0, 0, dtMs / 1000, stats);
    } else {
      var direction = INPUT.direction();
      if (direction.magnitude > 0) {
        // 摇杆推得越满走得越快（magnitude 就是模拟量），这是"手感"的一半；手动永远优先
        PLAYER.move(player, direction.x * direction.magnitude, direction.y * direction.magnitude, dtMs / 1000, stats);
      } else if (state.save.settings.autoBattle) {
        // 自动战斗：自动走向**全地图**最近的怪（combat.targetRange = 0；出手本来就有 14-world.playerAttack 负责）
        autoStep(player, stats, dtMs);
      } else {
        PLAYER.move(player, 0, 0, dtMs / 1000, stats);
      }
    }
    // 自动战斗（A5）：在"自动出手 + 自动走位"之外再补上**自动放技能**
    if (!player.dead && state.save.settings.autoBattle) autoCastStep();
    PLAYER.decayKnockback(player);

    var events = WORLD.update(dtMs, player, stats, state.camera, SCREEN.width(), SCREEN.height());
    applyHitFeedback(events);
    for (var i = 0; i < events.kills.length; i += 1) applyKill(events.kills[i]);
    if (events.playerDown) flash('被打倒了，3 秒后原地复活', 1600);

    // 相机跟随（A11 之三：**锁定以角色为中心** —— `view.cameraLerpPerTick = 1` = 每逻辑帧直接贴合）。
    // A11 时代这里还叠了一笔"前瞻偏移"（镜头看向"我 + 我要去的地方"），近距离视角下那个
    // 固定世界单位的偏移会把角色挤出屏幕中心，用户要的是锁定，所以前瞻已关（`cameraLookAhead = 0`，
    // 见 `updateCameraLook`）。逻辑层读到的 player 坐标一个字节都没动。
    updateCameraLook(player);
    followCamera(player);

    // 进出营地时提示一次：营地是回血 / 商店 / 传送的入口（用户要的"营地交互入口"）
    var camp = inCamp();
    if (camp !== state.wasInCamp) {
      state.wasInCamp = camp;
      if (camp) flash('进入营地：点右下「营」可以治疗 / 逛商城 / 回营地中心', 2800);
    }

    state.save.stats.playMs += dtMs;
    state.now = WORLD.now();
    // 公会面板开着时自动保鲜（每 balance.guild.syncIntervalMs 一次；关掉面板就静默）—— 本次新增
    guildAutoSync();
  }

  /* ---------------------------------------------------------------- 结算 */

  /** 一次击杀的账：经验、金币、掉箱（决策 #1：只有"累计伤害最高者"能拿到） */
  function applyKill(kill) {
    var save = state.save;
    var monster = kill.monster;
    playSfx('kill');
    save.stats.kills += 1;
    if (monster.elite) save.stats.eliteKills += 1;

    if (!kill.mine) {
      flash('一只 ' + monster.name + ' 的奖励被抢走了（决策 #1 的规则）', 1600);
      return;
    }

    var xp = Math.round(PROG.monsterXp(monster.level, monster.band, monster.elite) * (1 + state.stats.xpBonus));
    var gold = Math.round(PROG.monsterGold(monster.level, monster.band, monster.elite) * (1 + state.stats.goldBonus));
    save.gold += gold;

    var levels = PROG.applyXp(save, xp);
    if (levels > 0) onLevelUp(levels);
    else flash('+' + xp + ' 经验 · +' + gold + ' 金币', 900);

    if (WORLD.rng().chance(LOOT.dropChance(monster.band, monster.elite))) {
      var tier = LOOT.rollChestTier(monster.band, monster.elite, WORLD.rng(), save.pity);
      // A14：这一阶勾了「自动开启」→ 箱子**不进背包**，当场开掉（于是也不占 bagCap、不会被自动分解）
      if (LOOT.autoEnabled(save.settings.chestAuto, tier)) {
        autoOpenChest(tier, monster.level);
      } else if (SAVE.pushChest(save, tier, monster.level)) {
        flash(LOOT.tierName(tier) + ' 到手（背包 ' + save.chests.length + '/' + LOOT.bagCap() + '）', 1600);
      } else {
        var salvage = LOOT.salvageGold(tier);
        save.gold += salvage;
        flash('宝箱背包已满：' + LOOT.tierName(tier) + ' 自动分解 +' + salvage + ' 金币', 1800);
      }
    }
  }

  /** 升级：属性重算 + 血量按比例补 +（到 20 级时）提示商城与公会解锁 */
  function onLevelUp(levels) {
    var before = state.stats;
    state.stats = PLAYER.statsOf(state.save.level, state.save.loadout);
    PLAYER.onLevelUp(state.player, before, state.stats);
    var text = '升级！Lv.' + state.save.level + (levels > 1 ? '（连升 ' + levels + ' 级）' : '');
    if (PROG.shopUnlocked(state.save.level) && state.save.level - levels < BAL.guild.shopUnlockLevel) {
      text += ' · 商城与公会解锁';
    }
    playSfx('levelup');
    flash(text, 2200);
  }

  /* ---------------------------------------------------------------- 开箱与装备 */

  /**
   * 开箱时的装备等阶：以**箱阶为下限**，在同阶及以上按（band 调整过的）权重抽。
   * 这条规则兑现了 01-game-design §7 的"普通箱开出 ≥ 普通、天赐箱必是天赐"。
   *
   * 兜底（A7 修订 2）：池子为空 = 一件都抽不出来（只会发生在箱阶数据坏掉时，比如 tier 缺失 / 越界）。
   * 这时**回落到合法范围内的箱阶**（1~6），保证永远给得出一个等阶 —— "开箱必出装备"的底线在
   * `openOneChest()`：它先拿到装备才扣箱，所以最坏情况也只是"箱还在"。
   */
  function rollEquipmentTier(chestTier, band) {
    var weights = LOOT.tierWeights(band);
    var pool = [];
    var poolWeights = [];
    for (var i = 0; i < BAL.equipment.tiers.length; i += 1) {
      var tier = BAL.equipment.tiers[i];
      if (tier.id >= chestTier) {
        pool.push(tier);
        poolWeights.push(weights[i]);
      }
    }
    if (pool.length === 0) {
      var last = BAL.equipment.tiers.length;
      var safe = Math.round(chestTier);
      if (!(safe >= 1)) safe = 1;
      if (safe > last) safe = last;
      return safe;
    }
    return pool[WORLD.rng().weightedIndex(poolWeights)].id;
  }

  function removeItem(save, itemId) {
    for (var i = 0; i < save.items.length; i += 1) {
      if (save.items[i].id === itemId) {
        save.items.splice(i, 1);
        return true;
      }
    }
    return false;
  }

  /**
   * 开一个箱（= 背包里第一口）：抽装备等阶 → 生成装备 →（默认）战力更高就直接穿上，否则进背包。
   *
   * **A7 修订 2（用户："打开宝箱必定出装备"）**：产出是**硬保证**，两个地方一起兜住 ——
   *   ① 顺序：**先**把装备生成出来，**再**从背包里扣掉这只箱（A14 起这两步在 `openChestAt` 里，
   *      手点开箱与按阶开箱共用它，所以"箱没了、装备也没有"两种失败都不成立）；
   *      装备生成失败（数据坏、抛异常）时箱子原样留在包里；
   *   ② `rollEquipmentTier` 在池子为空时回落合法箱阶（见那里）。
   * 另外满背包也不会吞装备：装备入包不设上限（`SAVE.pushItem`），旧件换新件时旧件才折算成金币。
   * 自检的 `checkChestOpen` 把这条锁成断言：开 N 箱必产出 N 件，且每件都落在"身上或背包里"。
   */
  function openOneChest() {
    return openChestAt(0);
  }

  /**
   * 装备入账（A14 从 `openOneChest` 里原样抽出来）：**战力更高就直接穿上**（还要过等级门槛），
   * 否则进背包。满背包也不会吞装备：装备入包不设上限（`SAVE.pushItem`），旧件换新件时旧件才折算成金币。
   * 返回 { item, equipped } —— 手点开箱与"自动开启"共用这一份入账规则，从此只有一处。
   */
  function grantEquipment(item) {
    var save = state.save;
    var worn = save.loadout[item.slotId];
    // A6：自动穿上也要过等级门槛 —— 不够就只进背包，等练上去再穿
    if (CONFIG.autoEquipBetter && EQUIP.canWear(item, save.level) && (!worn || item.power > worn.power)) {
      save.loadout[item.slotId] = item;
      if (worn) save.gold += LOOT.salvageGold(worn.tier);
      state.stats = PLAYER.statsOf(save.level, save.loadout);
      return { item: item, equipped: true };
    }
    SAVE.pushItem(save, item);
    return { item: item, equipped: false };
  }

  /**
   * 开掉背包里第 index 口箱（A7 修订 2 的硬保证就落在这里：**先出装备、再扣箱** —— 装备生成失败时
   * 箱子原样留在包里；`openOneChest` 与 A14 的按阶开箱都走它，于是"扣哪口箱"只有一处）。
   * 下标越界返回 null。
   */
  function openChestAt(index) {
    var save = state.save;
    if (!(index >= 0) || index >= save.chests.length) return null;
    var chest = save.chests[index];
    var band = G.CHUNK.bandOf(state.player.x, state.player.y);
    var tier = rollEquipmentTier(chest.tier, band);
    var item = EQUIP.generate(tier, chest.level, WORLD.rng(), 0);
    save.chests.splice(index, 1);
    save.stats.opened += 1;
    return grantEquipment(item);
  }

  /** 背包里**第一口**这一阶箱子的下标（一口都没有就 -1）：A14 的按阶开箱只认阶号，不认袋子顺序 */
  function firstChestIndexOfTier(tierId) {
    var chests = state.save.chests;
    for (var i = 0; i < chests.length; i += 1) {
      if (chests[i].tier === tierId) return i;
    }
    return -1;
  }

  /**
   * 开掉某一阶的一口箱（A14）：抽装备只看**箱阶**与当前 band，同阶之间谁先谁后结果一样，
   * 所以"从这一阶里拿第一口"和"拿最后一口"没有区别。这一阶一口也没有时返回 null。
   */
  function openOneChestOfTier(tierId) {
    var index = firstChestIndexOfTier(tierId);
    if (index < 0) return null;
    return openChestAt(index);
  }

  /**
   * 开箱的统一汇报（A14 抽出来，`openChests` 与 `openChestsOfTier` 共用）：
   * 只报**最好的一件**（战力最高），免得刷屏 —— 每箱的结果都进背包 / 身上。
   * `scope` 是"这次开的是哪一批"（大按钮 = 空字符串；某一阶 = `'传说宝箱 '`），只影响文案。
   */
  function reportOpened(scope, results) {
    var best = results[0];
    for (var k = 1; k < results.length; k += 1) {
      if (results[k].item.power > best.item.power) best = results[k];
    }
    flash(
      scope +
        '开 ' +
        results.length +
        ' 箱：最好 ' +
        EQUIP.tierById(best.item.tier).name +
        ' ' +
        best.item.slotName +
        '（战力 ' +
        best.item.power +
        '）' +
        (best.equipped ? ' · 已穿上' : ' · 进了背包'),
      2800
    );
    return best;
  }

  /** 开 N 箱：只报"最好的一件"，免得刷屏（每箱的结果都进背包/身上） */
  function openChests(count) {
    playSfx('chest');
    var results = [];
    for (var i = 0; i < count; i += 1) {
      var result = openOneChest();
      if (!result) break;
      results.push(result);
    }
    if (results.length === 0) {
      flash('没有宝箱：去打怪（普通怪约 8% 掉箱，精英 25%）', 1800);
      return 0;
    }
    reportOpened('', results);
    return results.length;
  }

  /**
   * 开掉**这一阶**的全部箱子（A14：宝箱清单每行右侧那枚「全开」—— 用户要的"对应不同等阶不同的开启按钮"）。
   *
   * 口径与 `openChests` 一模一样：开局一声开箱音、只报"最好的一件"、每箱的结果都进背包 / 身上。
   * 这一阶一口也没有时给一句明说（正常情况下点不出来 —— 那一枚按钮这时**不产出 action**，
   * 这里兜的是"点了之后箱子被别处开掉了"这类竞态）。
   * 返回这次真开了几箱（"自动开启"那条路也要用它）。
   */
  function openChestsOfTier(tierId) {
    var tier = typeof tierId === 'number' ? Math.floor(tierId) : -1;
    if (!(tier >= 1) || tier > G.LOOT.tiers().length) return 0;
    playSfx('chest');
    var results = [];
    var result = openOneChestOfTier(tier);
    while (result) {
      results.push(result);
      result = openOneChestOfTier(tier);
    }
    if (results.length === 0) {
      flash(LOOT.tierName(tier) + '宝箱：背包里一口都没有', 1600);
      return 0;
    }
    reportOpened(LOOT.tierName(tier) + '宝箱 ', results);
    return results.length;
  }

  /**
   * 自动开启（A14，用户："宝箱可以设置是否自动开启"）：这一阶勾了勾选时，箱子一掉出来就**当场开掉** ——
   *
   *   - 箱子**不进背包**：于是不占 `bagCap`、也不会被"背包满了自动分解"折算成金币；
   *   - 走的是同一套规则：`rollEquipmentTier`（箱阶为下限）+ `grantEquipment`（更就穿，穿不上进背包），
   *     所以"自动开出来的东西"和玩家手点开出来的**完全一样**；
   *   - **不喊开箱音效**：挂机一晚就是几百箱，每箱都咔一声会变成噪音（这是刻意的，不是漏了）；
   *   - 报一句"自动开出 …"：不报的话，玩家会觉得"箱子怎么没了"。
   *
   * 返回 { item, equipped }（没开成返回 null）。
   */
  function autoOpenChest(tier, level) {
    var save = state.save;
    if (!save || !(tier >= 1)) return null;
    var band = G.CHUNK.bandOf(state.player.x, state.player.y);
    var item = EQUIP.generate(rollEquipmentTier(tier, band), level, WORLD.rng(), 0);
    save.stats.opened += 1;
    var granted = grantEquipment(item);
    flash('自动开出 ' + EQUIP.labelOf(granted.item) + (granted.equipped ? ' · 已穿上' : ' · 进了背包'), 1800);
    return granted;
  }

  /** 穿上背包里的装备：旧件退回背包（不自动分解，交给"一键分解"处理） */
  function equipFromBag(itemId) {
    var save = state.save;
    var item = null;
    for (var i = 0; i < save.items.length; i += 1) {
      if (save.items[i].id === itemId) item = save.items[i];
    }
    if (!item) {
      flash('这件装备不在背包里', 1200);
      return;
    }
    // A6：等级门槛 —— 每件装备有自己的 reqLevel（09-equipment 的 requirementForItem）
    if (!EQUIP.canWear(item, save.level)) {
      flash(
        '等级不够：' + EQUIP.labelOf(item) + ' 需要 Lv.' + item.reqLevel + '（现在 ' + save.level + ' 级）',
        1800
      );
      return;
    }
    var worn = save.loadout[item.slotId];
    save.loadout[item.slotId] = item;
    removeItem(save, item.id);
    if (worn) save.items.push(worn);
    state.stats = PLAYER.statsOf(save.level, save.loadout);
    flash('已穿上 ' + EQUIP.labelOf(item) + '（战力 ' + state.stats.power + '）', 1800);
  }

  /**
   * 脱下某个部位（A6）：装备回到背包，人物外观立刻变回"没穿"的样子。
   * 与穿上走同一套：只改 save.loadout，然后重算属性快照（战力随之变化）。
   */
  function unequipSlot(slotId) {
    var save = state.save;
    if (!EQUIP.hasSlot(slotId)) return;
    var item = save.loadout[slotId];
    if (!item) {
      flash('这个部位本来就没穿东西', 1200);
      return;
    }
    save.loadout[slotId] = null;
    SAVE.pushItem(save, item);
    state.stats = PLAYER.statsOf(save.level, save.loadout);
    flash('已脱下 ' + EQUIP.labelOf(item) + '（战力 ' + state.stats.power + '）', 1600);
  }

  /** 一键分解：每个部位只留最强的一件，其余换成金币 */
  function salvageAll() {
    var save = state.save;
    var keep = {};
    var gold = 0;
    var i;
    for (i = 0; i < save.items.length; i += 1) {
      var item = save.items[i];
      if (!keep[item.slotId] || item.power > keep[item.slotId].power) keep[item.slotId] = item;
    }
    var remaining = [];
    for (i = 0; i < save.items.length; i += 1) {
      var candidate = save.items[i];
      if (keep[candidate.slotId] === candidate) remaining.push(candidate);
      else gold += LOOT.salvageGold(candidate.tier);
    }
    var sold = save.items.length - remaining.length;
    save.items = remaining;
    save.gold += gold;
    flash('分解 ' + sold + ' 件，+' + gold + ' 金币（每个部位留最强 1 件）', 2200);
  }

  /* ------------------------------------------------------- 商城 / 公会 / 设置 */

  /** 买号角：20 级解锁商城（balance.guild.shopUnlockLevel），500 金币（决策 #4） */
  function buyHorn() {
    var save = state.save;
    if (!PROG.shopUnlocked(save.level)) {
      flash('需要 ' + BAL.guild.shopUnlockLevel + ' 级才能进商城（现在 ' + save.level + ' 级）', 1800);
      return;
    }
    if (save.gold < BAL.shop.horn.priceGold) {
      flash('金币不够：还差 ' + (BAL.shop.horn.priceGold - save.gold) + ' 金币', 1800);
      return;
    }
    save.gold -= BAL.shop.horn.priceGold;
    save.horns += 1;
    flash('买到公会号角（持有 ' + save.horns + ' 个）', 1800);
  }

  /**
   * 买强化石（本次新增）：营地铁匠强化装备用的通货，100 金币一颗（`balance.shop.stone`）。
   * 与买号角**同一套规矩**（20 级解锁、金币只在 20-main 扣、买完给一句提示），
   * 只是没有"持有上限"这一说 —— 越往上强化越贵，让玩家自己算。
   */
  function buyStone() {
    var save = state.save;
    if (!PROG.shopUnlocked(save.level)) {
      flash('需要 ' + BAL.guild.shopUnlockLevel + ' 级才能进商城（现在 ' + save.level + ' 级）', 1800);
      return;
    }
    if (save.gold < BAL.shop.stone.priceGold) {
      flash('金币不够：还差 ' + (BAL.shop.stone.priceGold - save.gold) + ' 金币', 1800);
      return;
    }
    save.gold -= BAL.shop.stone.priceGold;
    save.stones += 1;
    flash('买到强化石（持有 ' + save.stones + ' 颗）', 1800);
  }

  /**
   * 铁匠强化（本次新增）：把**已穿**的那一件升一级 —— 用户要求"+1 到 +10，等级越高消耗越多"。
   *
   * 这里只做三件事：查这份装备、扣强化石、把等级交给 09-equipment 的 `applyEnhance`（唯一改等级的入口）。
   * "这一级要几颗"、"强化后主属性涨多少"全在 09-equipment / balance.enhance，本文件一个数字都不写死 ——
   * 于是改数值只需要动 balance.json，界面（18-panels 的强化面板）也跟着变。
   *
   * 返回 true / false（自检用它；界面不看返回值，看 flash）。
   */
  function enhanceItem(slotId) {
    var save = state.save;
    if (!EQUIP.hasSlot(slotId)) return false;
    var item = save.loadout[slotId];
    if (!item) {
      flash('这个部位还没穿装备：先去背包穿上再强化', 1800);
      return false;
    }
    var level = EQUIP.enhanceLevel(item);
    if (level >= EQUIP.maxEnhance()) {
      flash(EQUIP.labelOf(item) + ' 已经满级（+' + EQUIP.maxEnhance() + '）', 1600);
      return false;
    }
    var cost = EQUIP.nextEnhanceCost(item);
    if (save.stones < cost) {
      flash(
        '强化石不够：+' + (level + 1) + ' 要 ' + cost + ' 颗，持有 ' + save.stones + ' 颗（商城 ' + BAL.shop.stone.priceGold + ' 金币一颗）',
        2200
      );
      return false;
    }
    save.stones -= cost;
    EQUIP.applyEnhance(item);
    // 属性快照要重算：强化加的是主属性，战力与战斗数值都跟着变
    state.stats = PLAYER.statsOf(save.level, save.loadout);
    playSfx('levelup');
    flash('强化成功：' + EQUIP.labelOf(item) + '（战力 ' + state.stats.power + ' · 还剩 ' + save.stones + ' 颗石头）', 2200);
    return true;
  }

  /* ---------------------------------------------------------------- 公会（本次重做） */

  /**
   * 公会：**网络那一半**（规则在 11-save 的 `G.GUILD`，权威在服务端 `/api/guild/*`）。
   *
   * 用户要求："创建公会需要自己输入公会名，公会页面显示公会人员，公会等级，公会信息。"
   * 于是这条链路是：面板输入名字 → 这里校验 + 发包 → 服务端登记（名字全服唯一）→
   * 服务端回一份权威的成员表 → `G.GUILD.fromServer` 变成存档里的**镜像** → 面板照着画。
   *
   * 三条纪律：
   *   1. **单机永远能玩**（决策 #10）：连不上云时建会在本机成立（`remote:false`），
   *      以后能连上时由 `syncGuild` 的补登记分支把它登记到服务端（不重复扣号角）；
   *   2. **服务端说的就是权威**：任何一次成功响应都把整条记录换成服务端那份，
   *      本地只额外保留两样东西 —— 回城冷却 `teleportAt` 与同步时刻 `syncAt`；
   *   3. **只有这里能改存档**：网络提示 / 列表 / 忙闲放在 `state.guild`（不进存档），
   *      公会本身放在 `state.save.guild`；18-panels 两个都只读（自己拼成 view）。
   */
  function guildSelf() {
    return { name: state.save.name, level: state.save.level };
  }

  /** 公会接口的公共头部：带上令牌（服务端有令牌时**只认令牌里的账号**，body 里的 openid 会被忽略） */
  function guildRequest(path, data) {
    var account = state.account || {};
    var payload = {
      account: account.id || '',
      openid: account.openid || '',
      token: account.token || ''
    };
    if (data) {
      for (var key in data) {
        if (Object.prototype.hasOwnProperty.call(data, key)) payload[key] = data[key];
      }
    }
    return PLAT.cloud(path, { method: 'POST', data: payload });
  }

  /** 响应体（tt.request 的 res.data；拿不到就当空对象 —— 后面每一处都会判 ok） */
  function guildBody(res) {
    return res && res.data && typeof res.data === 'object' ? res.data : {};
  }

  /** 服务端的错误码 → 给玩家看的一句话（服务端只回 code，文案统一在这里） */
  function guildErrorText(body) {
    var error = body && body.error ? body.error : 'unknown';
    if (error === 'name_taken') return '这个公会名全服已经有人用了，换一个';
    if (error === 'invalid_name') return GUILD.reasonText(body.reason || 'illegal');
    if (error === 'already_in_guild') return '你已经在一个公会里了（先退出再建）';
    if (error === 'guild_full') return '这个公会人满了（上限 ' + BAL.guild.memberCap + ' 人）';
    if (error === 'no_guild') return '服务端没有这个公会（名字打错了？）';
    if (error === 'not_in_guild') return '你不在这个公会里';
    if (error === 'owner_cannot_leave') return '你是会长：首版不能退出（先把成员请出去）';
    if (error === 'anchor_too_close') return '离别的公会锚点太近了（至少 ' + BAL.guild.anchorMinDistance + ' 世界单位）';
    if (error === 'anchor_cooldown') return '锚点刚挪过，冷却中';
    if (error === 'missing_openid' || error === 'token_required') return '没拿到账号凭据：先登录一次';
    if (error === 'not_configured') return '服务端还没配 DOUYIN_APPID / DOUYIN_SECRET';
    return '服务端拒绝了：' + error;
  }

  /**
   * 把服务端回的那一份记下来（**成功才换**；失败一律保留本机那份，绝不拿半截数据覆盖存档）。
   * 返回新记录或 null。
   */
  function applyGuildBody(body) {
    var record = GUILD.fromServer(body, guildSelf(), Math.round(WORLD.now()));
    if (!record) return null;
    // 回城冷却留在本机：服务端不管冷却，这里把老值带过去（新记录默认 0 = 没冷却）
    var previous = state.save.guild;
    if (previous && previous.name === record.name && previous.teleportAt) record.teleportAt = previous.teleportAt;
    state.save.guild = record;
    writeSave();
    return record;
  }

  /** 云后端能不能用（没配 cloudBase / 当前环境没有 tt.request → 所有公会操作走本机路径） */
  function guildCloudReady() {
    return !!CONFIG.cloudBase && PLAT.hasTt();
  }

  /**
   * 建公会（用户要求：**自己输入公会名**）。
   *
   * 四道拦截都在这里，顺序与面板上那几行一一对应：等级 → 号角 → 名字 → 扣号角。
   * 之后分两条路：能连上云 = 服务端说了算（名字全服唯一）；连不上 = 本机先建（`remote:false`）。
   * 号角**两条路都扣** —— 它是"建会资格"，不是"服务端登记费"。
   */
  function createGuild() {
    var save = state.save;
    var draft = PANELS.draftGuildName();
    var check = GUILD.validate(draft);
    if (!PROG.guildUnlocked(save.level)) {
      flash('需要 ' + BAL.guild.unlockLevel + ' 级才能建公会（现在 ' + save.level + ' 级）', 1800);
      return false;
    }
    if (save.horns <= 0) {
      flash('没有号角：商城 ' + BAL.shop.horn.priceGold + ' 金币一个', 1800);
      return false;
    }
    if (save.guild) {
      // 已经有会了：再建一次不该白扣一个号角（服务端的 already_in_guild 是同一道闸门）
      flash('你已经在一个公会里了：公会「' + save.guild.name + '」（先退出再建）', 2400);
      return false;
    }
    if (!check.ok) {
      flash('公会名还不能用：' + GUILD.reasonText(check.reason), 2400);
      return false;
    }
    var anchor = { x: state.player.x, y: state.player.y };
    save.horns -= 1;
    // 本机先记一份（离线 / 云不可用时它就是唯一真相；云可用时下面会被服务端那份覆盖）
    save.guild = GUILD.create(check.name, guildSelf(), anchor, Math.round(WORLD.now()));
    PANELS.setDraftGuildName('');
    state.guild.note =
      '公会「' + check.name + '」已在本机建立，锚点就在脚下（' + Math.round(anchor.x) + ', ' + Math.round(anchor.y) + '）';
    writeSave();
    flash('公会「' + check.name + '」已建立，锚点就在脚下', 2400);

    if (!guildCloudReady()) {
      state.guild.note += ' · 没连服务端（没配 cloudBase 或当前环境不支持网络），号角已扣';
      return true;
    }
    state.guild.busy = true;
    guildRequest('/api/guild/create', { name: check.name, x: anchor.x, y: anchor.y })
      .then(function (res) {
        var body = guildBody(res);
        state.guild.busy = false;
        if (body.ok === true && applyGuildBody(body)) {
          state.guild.note = '服务端已登记：' + GUILD.memberText(state.save.guild) + '（公会名全服唯一）';
          flash('服务端登记成功：公会「' + save.guild.name + '」', 2200);
          return;
        }
        state.guild.note = '服务端没登记成功：' + guildErrorText(body) + ' —— 本机这份先留着，下次刷新会再试';
      })
      .catch(function (error) {
        state.guild.busy = false;
        state.guild.note =
          '连不上服务端（' +
          (error && error.message ? error.message : '未知错误') +
          '）—— 本机这份先留着，回到游戏后点「刷新」补登记';
      });
    return true;
  }

  /**
   * 加入公会（本次新增：不然"公会人员"永远只有自己一个人）。
   * `name` 不给就用面板上那一行输入的草稿（`PANELS.joinDraftName()`）；
   * 给了名字就是"公会列表里点的那一行"。
   * 加入**必须由服务端登记** —— 连不上时不给过（否则会造出一个全服不存在的会籍）。
   */
  function joinGuild(name) {
    var save = state.save;
    var wanted = typeof name === 'string' && name ? name : PANELS.joinDraftName();
    var check = GUILD.validate(wanted);
    if (!check.ok) {
      flash('公会名还不能用：' + GUILD.reasonText(check.reason), 2400);
      return false;
    }
    if (save.guild) {
      flash('你已经在公会「' + save.guild.name + '」里了（先退出再换）', 2200);
      return false;
    }
    if (!guildCloudReady()) {
      state.guild.note = '加入公会必须由服务端登记（本机没有别家公会的名单）—— 现在连不上';
      flash('加入公会要连服务端：没配 cloudBase 时只能自己建一个', 2600);
      return false;
    }
    state.guild.busy = true;
    state.guild.note = '正在向服务端申请加入「' + check.name + '」…';
    guildRequest('/api/guild/join', { name: check.name })
      .then(function (res) {
        var body = guildBody(res);
        state.guild.busy = false;
        if (body.ok === true && applyGuildBody(body)) {
          PANELS.setJoinDraftName('');
          state.guild.note = '已加入：' + GUILD.memberText(state.save.guild);
          flash('已加入公会「' + state.save.guild.name + '」', 2200);
          return;
        }
        state.guild.note = '加入失败：' + guildErrorText(body);
        flash(state.guild.note, 2600);
      })
      .catch(function (error) {
        state.guild.busy = false;
        state.guild.note = '加入失败：连不上服务端（' + (error && error.message ? error.message : '未知错误') + '）';
        flash(state.guild.note, 2600);
      });
    return true;
  }

  /**
   * 退出公会（本次新增）：会籍在服务端，所以**要服务端点头**才清本地那份。
   * 会长不能退（首版没有转让 / 解散，服务端回 owner_cannot_leave）。
   * 例外：离线自建的会（`remote:false`）本来就没在服务端，直接清掉即可。
   */
  function guildLeave() {
    var save = state.save;
    if (!save.guild) {
      flash('还没有公会', 1400);
      return false;
    }
    if (GUILD.isLeader(save.guild)) {
      flash('你是会长：首版不能退出（先把成员都请出去）', 2400);
      return false;
    }
    if (!guildCloudReady()) {
      if (!save.guild.remote) {
        var localName = save.guild.name;
        save.guild = null;
        state.guild.note = '已退出本机公会「' + localName + '」（它没在服务端登记过）';
        writeSave();
        flash(state.guild.note, 2400);
        return true;
      }
      flash('退出公会要连服务端：现在连不上', 2400);
      return false;
    }
    state.guild.busy = true;
    guildRequest('/api/guild/leave', {})
      .then(function (res) {
        var body = guildBody(res);
        state.guild.busy = false;
        if (body.ok === true) {
          var left = state.save.guild ? state.save.guild.name : '';
          state.save.guild = null;
          state.guild.note = '已退出「' + left + '」（服务端会籍已删除）';
          writeSave();
          flash(state.guild.note, 2400);
          return;
        }
        state.guild.note = '退出失败：' + guildErrorText(body);
        flash(state.guild.note, 2400);
      })
      .catch(function (error) {
        state.guild.busy = false;
        state.guild.note = '退出失败：连不上服务端（' + (error && error.message ? error.message : '未知错误') + '）';
        flash(state.guild.note, 2400);
      });
    return true;
  }

  /**
   * 要一份最新的成员表（面板上那行「向服务端要一份最新成员表」+ 面板打开时的自动刷新都走它）。
   *
   * 三个分支（第三条是特意设计的**自愈**）：
   *   1. 服务端回 `inGuild:true` → 整份换成服务端那份（成员 / 等级 / 锚点）；
   *   2. 服务端回 `inGuild:false` 而本机有会 → 试着**补登记**（把离线建的会搬上去；
   *      服务端现在还是内存版，重启会把公会弄丢 —— 这条自愈就是为那种情况准备的）；
   *      名字被别人占了就保留本机那份并说明（**绝不静默删玩家的公会**）；
   *   3. 本机也没有会 → 只更新一句提示。
   */
  function syncGuild(quiet) {
    var save = state.save;
    if (!guildCloudReady()) {
      if (!quiet) {
        state.guild.note = '没配 cloudBase（或当前环境不支持网络）—— 公会只在本机';
        flash(state.guild.note, 2400);
      }
      return false;
    }
    if (state.guild.busy) return false;
    state.guild.busy = true;
    if (!quiet) state.guild.note = '正在向服务端要最新成员表…';
    guildRequest('/api/guild/mine', {})
      .then(function (res) {
        var body = guildBody(res);
        state.guild.busy = false;
        if (body.ok !== true) {
          state.guild.note = '同步失败：' + guildErrorText(body);
          return;
        }
        if (body.inGuild === true) {
          if (applyGuildBody(body)) {
            state.guild.note =
              '成员表已同步：' + GUILD.memberText(state.save.guild) + ' · 公会等级 Lv.' + state.save.guild.level;
          }
          return;
        }
        if (!save.guild) {
          state.guild.note = '服务端上没有你的公会（去「创建公会」或从列表里加入一个）';
          return;
        }
        var anchor = save.guild.anchor || { x: state.player.x, y: state.player.y };
        state.guild.note = '本机有公会「' + save.guild.name + '」但服务端没有 → 正在补登记…';
        guildRequest('/api/guild/create', { name: save.guild.name, x: anchor.x, y: anchor.y })
          .then(function (res2) {
            var body2 = guildBody(res2);
            if (body2.ok === true && applyGuildBody(body2)) {
              state.guild.note = '补登记成功：' + GUILD.memberText(state.save.guild);
              return;
            }
            state.guild.note = '补登记失败：' + guildErrorText(body2) + ' —— 本机这份留着（不删玩家的公会）';
          })
          .catch(function (error) {
            state.guild.note = '补登记失败：' + (error && error.message ? error.message : '未知错误');
          });
      })
      .catch(function (error) {
        state.guild.busy = false;
        state.guild.note = '同步失败：连不上服务端（' + (error && error.message ? error.message : '未知错误') + '）';
        if (!quiet) flash(state.guild.note, 2600);
      });
    return true;
  }

  /**
   * 要一份公会列表（没有公会时面板上那块「公会列表」；点一行就能加入）。
   * 列表项由服务端算好（等级 / 人数），客户端只负责画 —— 这里顺手按人数降序排一下，方便挑。
   */
  function guildList(quiet) {
    if (!guildCloudReady()) {
      state.guild.list = [];
      state.guild.listNote = '没配 cloudBase（或当前环境不支持网络）—— 看不到别人的公会';
      if (!quiet) flash(state.guild.listNote, 2400);
      return false;
    }
    state.guild.busy = true;
    guildRequest('/api/guild/list', { limit: BAL.guild.listLimit })
      .then(function (res) {
        var body = guildBody(res);
        state.guild.busy = false;
        if (body.ok !== true) {
          state.guild.list = [];
          state.guild.listNote = '列表拿不到：' + guildErrorText(body);
          return;
        }
        var rows = body.guilds && body.guilds.length ? body.guilds : [];
        rows.sort(function (a, b) {
          return b.count - a.count;
        });
        state.guild.list = rows;
        state.guild.listAt = Math.round(WORLD.now());
        state.guild.listNote = rows.length
          ? '服务端一共 ' + (body.total || rows.length) + ' 个公会（最多显示 ' + BAL.guild.listLimit + ' 个）'
          : '服务端还没有任何公会：你可以去建第一个';
        if (!quiet) flash(state.guild.listNote, 2400);
      })
      .catch(function (error) {
        state.guild.busy = false;
        state.guild.list = [];
        state.guild.listNote = '列表拿不到：连不上服务端（' + (error && error.message ? error.message : '未知错误') + '）';
      });
    return true;
  }

  /**
   * 公会面板开着时的自动刷新（每 `balance.guild.syncIntervalMs` 一次）：成员表 / 列表都靠它保鲜。
   * 只在**面板真的开着**时才发包（关掉面板就静默）；`guildAutoSync` 由 step 每逻辑帧叫一次。
   */
  function guildAutoSync() {
    if (PANELS.panelId() !== 'guild') return;
    if (state.guild.busy) return;
    // autoAt = 0（还没同步过）= 立刻来一次：打开面板那一下就该看到服务端的成员表
    if (state.guild.autoAt > 0 && state.now - state.guild.autoAt < BAL.guild.syncIntervalMs) return;
    state.guild.autoAt = state.now;
    if (state.save.guild) syncGuild(true);
    else guildList(true);
  }

  /** 回公会锚点：冷却 + 战斗中禁用（balance.guild.teleportCooldownMs / teleportCombatLockMs） */
  function teleportGuild() {
    var save = state.save;
    if (!save.guild) {
      flash('还没有公会', 1400);
      return;
    }
    if (PLAYER.inCombat(state.player, WORLD.now())) {
      flash('战斗中不可传送（' + Math.round(BAL.guild.teleportCombatLockMs / 1000) + ' 秒内受过伤）', 1800);
      return;
    }
    var wait = BAL.guild.teleportCooldownMs - (WORLD.now() - (save.guild.teleportAt || 0));
    if (save.guild.teleportAt && wait > 0) {
      flash('冷却中：还要 ' + Math.ceil(wait / 1000) + ' 秒', 1600);
      return;
    }
    state.player.x = save.guild.anchor.x;
    state.player.y = save.guild.anchor.y;
    snapCamera();
    state.player.targetId = 0;
    save.guild.teleportAt = WORLD.now();
    WORLD.ensureChunks(state.player.x, state.player.y);
    flash('回到公会锚点', 1400);
  }

  /** 玩家是不是站在营地里（营地 = 治疗 / 商城 / 传送的入口；判定用的是 04-terrain 的同一份几何） */
  function inCamp() {
    if (!state.player) return false;
    return G.TERRAIN.isInCamp(state.player.x, state.player.y);
  }

  /** 站在铁匠跟前吗（本次新增）：半径取 `balance.world.camp.smith.talkRadius`，坐标来自 04-terrain 的摆位表 */
  function nearSmith() {
    var smith = G.TERRAIN.smithSpot();
    if (!smith || !state.player) return false;
    var dx = state.player.x - smith.x;
    var dy = state.player.y - smith.y;
    var reach = BAL.world.camp.smith.talkRadius;
    return dx * dx + dy * dy <= reach * reach;
  }

  /**
   * 铁匠头顶那枚「锻」圆键（本次新增）：只有站在他跟前才出现在 HUD 按钮表里。
   *
   * 为什么走「HUD 按钮表」而不是给世界里的 NPC 单开一套命中：15-input 的 `buttonAt` 只看这一张表、
   * 触摸也只有一条链 —— 于是这枚键与「箱 / 包 / 商」完全同源（按下有反馈、松手才触发、
   * 面板开着也照样能点）。坐标按**相机投影**算（`RENDER.toScreen`），所以它钉在铁匠头顶跟着世界走。
   * 不在跟前 / 世界里没有他 → 返回 null，uiView 会把它从表里去掉（否则玩家在野外摸到那一块屏幕
   * 会莫名其妙弹出强化面板）。
   */
  function smithButton() {
    var smith = G.TERRAIN.smithSpot();
    if (!smith || !nearSmith()) return null;
    var point = RENDER.toScreen(state.camera, smith.x, smith.y);
    return {
      id: 'smith',
      label: '锻',
      badge: 0,
      state: 'on',
      x: point.x,
      y: point.y - 128,
      r: BAL.view.functionBar.radius + 5
    };
  }

  /** 营地治疗：按**缺失血量**收金币（balance.world.camp.heal）；满血就别让玩家白花钱 */
  function campHeal() {
    var player = state.player;
    var stats = state.stats;
    var heal = BAL.world.camp.heal;
    var missing = Math.max(0, stats.hpMax - player.hp);
    if (missing <= 0) {
      flash('血量是满的，不用治', 1400);
      return false;
    }
    var cost = Math.max(heal.minGold, Math.ceil(missing * heal.goldPerHp));
    if (state.save.gold < cost) {
      flash('金币不够：治疗要 ' + cost + ' 金币（还差 ' + (cost - state.save.gold) + '）', 1800);
      return false;
    }
    state.save.gold -= cost;
    player.hp = stats.hpMax;
    playSfx('camp');
    writeSave();
    flash('治疗完成：+' + Math.round(missing) + ' 生命 · -' + cost + ' 金币', 1800);
    return true;
  }

  /**
   * 回营地中心（原点）：短冷却 + 战斗中禁用（与公会回城同一套规矩，数字另配）。
   * 冷却时间存在**存档**里（`save.camp.teleportAt`），所以重开游戏也刷不掉冷却。
   */
  function teleportCamp() {
    if (PLAYER.inCombat(state.player, WORLD.now())) {
      flash('战斗中不可传送（' + Math.round(BAL.guild.teleportCombatLockMs / 1000) + ' 秒内受过伤）', 1800);
      return false;
    }
    var record = state.save.camp || { teleportAt: 0, used: false };
    var wait = BAL.world.camp.teleportCooldownMs - (WORLD.now() - (record.teleportAt || 0));
    if (record.used && wait > 0) {
      flash('冷却中：还要 ' + Math.ceil(wait / 1000) + ' 秒', 1600);
      return false;
    }
    var center = G.TERRAIN.campCenter();
    state.player.x = center.x;
    state.player.y = center.y;
    snapCamera();
    state.player.targetId = 0;
    state.save.camp = { teleportAt: WORLD.now(), used: true };
    state.wasInCamp = true;
    WORLD.ensureChunks(state.player.x, state.player.y);
    playSfx('camp');
    writeSave();
    flash('回到营地中心：可以治疗 / 逛商城', 1800);
    return true;
  }

  /** 自检：跑 19-selftest 的全部断言，结果直接摆到面板上（人眼也能验收"逻辑没坏"） */
  function runSelftest() {
    var result = G.SELFTEST.runAll();
    state.selftest = {
      lines: result.lines,
      checks: result.checks,
      failures: result.failures,
      fingerprint: result.fingerprint
    };
    PANELS.open('selftest');
    flash(result.failures === 0 ? '自检全绿：' + result.checks + ' 项' : '自检有 ' + result.failures + ' 项失败', 2600);
  }

  /** 云后端连通性自测：没配 cloudBase 时不会发包（PLAT.cloud 直接 reject） */
  function cloudPing() {
    state.cloud = '正在请求 ' + (CONFIG.cloudBase || '(未配置 cloudBase)') + ' …';
    PLAT.cloud('/api/health')
      .then(function (res) {
        var body = res && res.data ? res.data : {};
        state.cloud =
          '云后端正常：' +
          (body.service || '?') +
          ' v' +
          (body.version || '?') +
          ' · balance v' +
          (body.balanceVersion || '?') +
          ' · ' +
          (body.time || '');
      })
      .catch(function (error) {
        state.cloud = '云后端不可用：' + (error && error.message ? error.message : '未知错误');
      });
  }

  /** 重置存档：两次点击确认（第一次只是"上膛"，避免误触把号删了） */
  function resetSave() {
    if (!state.resetArmed) {
      state.resetArmed = true;
      flash('再点一次「重置本地存档」确认删除', 2600);
      return;
    }
    state.resetArmed = false;
    // 公会的运行态也一起清（列表是服务端的东西，重开号不该留着上一局的提示）—— 本次新增
    state.guild.note = '';
    state.guild.busy = false;
    state.guild.list = [];
    state.guild.listAt = 0;
    state.guild.listNote = '';
    state.guild.autoAt = 0;
    var keepName = state.save ? state.save.name : '';
    SAVE.clear();
    state.save = SAVE.create(BAL.season.worldSeed, 1);
    // 角色名属于**账号**，不跟着存档一起清（否则玩家要重新起名，昵称也还占着）
    state.save.name = keepName;
    state.player = PLAYER.create(state.save);
    state.stats = PLAYER.statsOf(state.save.level, state.save.loadout);
    state.player.hp = state.stats.hpMax;
    snapCamera();
    WORLD.reset(BAL.season.worldSeed);
    WORLD.ensureChunks(state.player.x, state.player.y);
    writeSave();
    PANELS.close();
    flash('存档已重置', 1600);
  }

  /** 右下功能键 → 打开 / 收起面板；「自动」是开关（用户要求"自动战斗设置为按钮，点击开启"） */
  function onHudButton(id) {
    // A10：技能键右上角的「自动释放」勾选框 —— 必须排在技能键前面判，
    // 因为 'skillAuto0' 也以 'skill' 开头（顺序反了就会变成"点勾选框放了个技能"）
    if (id.indexOf('skillAuto') === 0) {
      toggleSkillAuto(Number(id.slice(9)));
      return;
    }
    // 技能键（A5）：技能有自己的声音（cast / mend），不再叠一声 UI 的"咔"
    if (id.indexOf('skill') === 0) {
      castSkillSlot(Number(id.slice(5)));
      return;
    }
    playSfx('ui');
    if (id === 'auto') {
      toggleAutoBattle();
      return;
    }
    if (id === 'chest') togglePanel('chest');
    else if (id === 'bag') togglePanel('bag');
    else if (id === 'guild') togglePanel('guild');
    else if (id === 'camp') togglePanel('camp');
    else if (id === 'menu') togglePanel('menu');
    // 左侧边栏（本次新增）：两枚键各有自己的 id —— 商城与"回到营地"，与底部那行互不干扰。
    // 「商」在 A15 是底部第 6 枚功能键，本次挪到侧边栏顶部（用户：商城放在侧边栏，回营地放它下面）。
    else if (id === 'sideShop') togglePanel('shop');
    else if (id === 'sideCamp') teleportCamp();
    // 铁匠头顶那枚「锻」键（本次新增）：只有站在他跟前才会出现在按钮表里
    else if (id === 'smith') togglePanel('enhance');
  }

  /** 再点同一个功能键 = 收起面板（卡片不铺满屏幕、功能键一直在，这是最顺手的关法） */
  function togglePanel(panel) {
    if (PANELS.isOpen() && PANELS.panelId() === panel) {
      PANELS.close();
      return;
    }
    PANELS.open(panel);
    // 打开公会面板：先给服务端要一份（成员表 / 列表）—— `autoAt = 0` 让 guildAutoSync 立刻发一次包
    if (panel === 'guild') {
      state.guild.autoAt = 0;
      guildAutoSync();
    }
  }

  /**
   * 设置开关（音效 / 背景音乐 / 震动）：写存档 + 立刻生效 + 给一句提示。
   * "立刻生效"是重点：关掉 BGM 必须马上静下来，否则玩家会以为设置没生效（04-decisions #10）。
   */
  function toggleSetting(key) {
    var settings = state.save.settings;
    if (key === 'sfx') {
      settings.sfx = settings.sfx === false;
      syncAudio();
      playSfx('ui');
      flash('音效已' + (settings.sfx ? '开启' : '关闭'), 1400);
    } else if (key === 'bgm') {
      settings.bgm = settings.bgm === false;
      syncAudio();
      if (settings.bgm) PLAT.bgm(true);
      else PLAT.stopBgm();
      flash('背景音乐已' + (settings.bgm ? '开启' : '关闭'), 1400);
    } else if (key === 'vibrate') {
      settings.vibrate = settings.vibrate === false;
      if (settings.vibrate) PLAT.vibrate(20);
      flash('震动已' + (settings.vibrate ? '开启' : '关闭'), 1400);
    } else {
      return null;
    }
    writeSave();
    return settings;
  }

  /** 面板 action → 具体操作（**唯一改存档的入口**，阶段 B 会被服务端接口替换） */
  function handleAction(action) {
    if (!action) return;
    var type = action.type;
    // 点一下界面就该有"咔"的一声（开箱那条有自己的声音，所以跳过）
    if (type !== 'openChest') playSfx('ui');
    if (type === 'close') PANELS.close();
    else if (type === 'open') PANELS.open(action.panel);
    else if (type === 'toggleSfx') toggleSetting('sfx');
    else if (type === 'toggleBgm') toggleSetting('bgm');
    else if (type === 'toggleVibrate') toggleSetting('vibrate');
    else if (type === 'skillAuto') toggleSkillAuto(action.index);
    // A11：设置面板里那一行「视角」（点一下换下一档：远 → 中 → 近 → 远）
    else if (type === 'zoomNext') cycleZoomTier();
    // A11 之二：设置面板里的**视角缩放滚动轴**（松手时交出拖到的格数；拖动过程走 onTouchMove 的静默应用）
    else if (type === 'setZoomTiles') setZoomTiles(action.tiles, false);
    else if (type === 'openChest') openChests(action.count || 1);
    // A14：宝箱清单每行右侧那两枚按阶控件（「全开」/「自动」）
    else if (type === 'openChestTier') openChestsOfTier(action.tier);
    else if (type === 'toggleChestAuto') toggleChestAuto(action.tier);
    else if (type === 'equip') equipFromBag(action.itemId);
    else if (type === 'unequip') unequipSlot(action.slotId);
    else if (type === 'salvageAll') salvageAll();
    else if (type === 'buyHorn') buyHorn();
    else if (type === 'buyStone') buyStone();
    else if (type === 'enhance') enhanceItem(action.slotId);
    else if (type === 'createGuild') createGuild();
    else if (type === 'renameGuild') PANELS.setDraftGuildName(PANELS.nextGuildName((WORLD.now() | 0) + 7));
    /* 公会（本次重做）：打字 / 加入 / 同步 / 列表 / 退会 —— 五个动作都落在这里 */
    else if (type === 'typeGuildName') typeGuildName();
    else if (type === 'typeJoinName') typeJoinName();
    else if (type === 'joinGuild') joinGuild(action.name);
    else if (type === 'guildSync') syncGuild(false);
    else if (type === 'guildList') guildList(false);
    else if (type === 'guildLeave') guildLeave();
    else if (type === 'teleportGuild') teleportGuild();
    else if (type === 'campHeal') campHeal();
    else if (type === 'campTeleport') teleportCamp();
    else if (type === 'selftest') runSelftest();
    else if (type === 'cloudPing') cloudPing();
    else if (type === 'toggleDebug') state.debug = !state.debug;
    else if (type === 'resetSave') resetSave();
  }

  /* ---------------------------------------------------------------- 渲染 */

  /** 组装一份"界面视图"：HUD / 面板 / 调试面板都只读它（避免各处各取一套数据） */
  function uiView() {
    // 技能栏视图先算一次：功能键与技能键合并成同一份按钮表交给输入层（画法与命中共用一份坐标）
    var skills = skillView();
    // 铁匠头顶那枚「锻」键（本次新增）：站远了就是 null，不进按钮表（画法、命中、点击都读这一份）
    var smith = smithButton();
    return {
      save: state.save,
      player: state.player,
      stats: state.stats,
      target: targetMonster(),
      fps: state.fps,
      chunks: WORLD.loadedChunkCount(),
      activeMonsters: WORLD.activeMonsterCount(),
      /**
       * 只有 HUD 的功能键在这里（面板的关闭键由 18-panels 自己命中）：
       * 卡片只占约 2/3 屏高，功能键必须一直可点，所以它不随面板开合而变。
       * A10：技能键右上角的四个「自动释放」勾选框排在技能键**前面** ——
       * 15-input 的 buttonAt 取第一个命中的，于是小方框永远优先于整个圆键。
       * 本次新增的「锻」（铁匠）排在功能键之后、勾选框与技能键**之前**：它在屏幕中上部
       * （铁匠头顶），与底下那两行键在位置上永远不会撞上；顺序上则要保持"**技能键永远在最后**"
       * （自检盯着 `uiButtons[length-4..length-1] === skill0..skill3` 这一条）。
       */
      buttons: HUD.buttons({ save: state.save, inCamp: inCamp() })
        .concat(smith ? [smith] : [])
        .concat(HUD.skillAutoButtons({ skills: skills }))
        .concat(HUD.skillButtons({ skills: skills })),
      /** A5：技能栏视图（每个栏位的解锁 / 冷却比例 / 剩余毫秒）—— 17-hud 只认它，不读 balance */
      skills: skills,
      /** A5：最近放过的技能名（调试面板） */
      lastSkill: state.lastSkill,
      debug: state.debug,
      flash: state.flash,
      now: state.now,
      resetArmed: state.resetArmed,
      selftest: state.selftest,
      cloud: state.cloud,
      fingerprint: state.fingerprint,
      saveOk: state.saveOk,
      /** A4：界面与账号（登录 / 创建角色屏要读；HUD 只读名字与等级） */
      screen: state.screen,
      account: state.account,
      inCamp: inCamp(),
      autoBattle: !!(state.save.settings && state.save.settings.autoBattle === true),
      /** A11：渲染用的相机（小地图的视野框画的是"镜头在看哪"，它带前瞻偏移，所以不等于玩家坐标） */
      camera: state.camera,
      /** A11 / A11 之二：当前视角（档位 + 缩放轴；调试面板 / 设置面板那一行滑块 / 自检都读它） */
      zoom: zoomView(),
      /** A4：音频状态（设置面板要显示开关的当前值与平台是否支持） */
      audio: PLAT.audioState(),
      /**
       * 公会那一块的运行态（本次新增）：18-panels 的公会面板读它画"服务端"那一行、公会列表与忙闲；
       * 公会本身（成员 / 等级 / 锚点）在 `view.save.guild` —— 两个都在这一份 view 里，面板不再各取一套。
       */
      guild: state.guild
    };
  }

  function targetMonster() {
    var monsters = WORLD.allMonsters();
    for (var i = 0; i < monsters.length; i += 1) {
      if (monsters[i].id === state.player.targetId && monsters[i].state !== 'dead') return monsters[i];
    }
    return null;
  }

  /** 一帧画面：登录界面 → 世界层 → 摇杆 → HUD → 面板卡片 → 功能键（压在最后的顺序见 renderTo） */
  function render() {
    var ctx = PLAT.ctx();
    var canvas = PLAT.canvas();
    if (!ctx || !canvas) return;
    SCREEN.applyTo(canvas, ctx);
    renderTo(ctx);
  }

  /**
   * 把整帧画到指定上下文上。
   * 单独拆出来是为了让 19-selftest 的**冒烟测试**能用一个"假 canvas 上下文"跑完整帧：
   * "一进游戏就白屏"这类 bug 只在真帧里暴露，而这个假上下文能把它变成一条断言。
   *
   * 绘制顺序（A4 起 HUD 被拆成两半，就是为了这条链）：
   *   世界 → 摇杆 → HUD（吸顶 + 经验条 + 小地图）→ 面板卡片 → **功能键**
   * 功能键放在最后：面板卡片不铺满屏幕（约 2/3 屏高，底部整条动作栏仍露在外面），右下那五个键要一直可用（点「包」能直接关掉背包）。
   * 登录 / 创建角色界面则整屏交给 G.LOGIN（世界不画，玩家还没进游戏）。
   */
  function renderTo(ctx) {
    var view = uiView();

    if (state.screen !== 'playing') {
      G.LOGIN.draw(ctx, view);
      return;
    }

    ctx.fillStyle = '#0b1020';
    ctx.fillRect(0, 0, SCREEN.width(), SCREEN.height());

    // 震屏：只偏渲染用的相机（state.camera 本身不动 → 逻辑层拿到的永远是干净坐标）
    var camera = shakeCamera(view.now);
    // A6：世界层整体缩放一次（视角倍率）。HUD / 面板在 endWorld 之后画，尺寸不受影响。
    RENDER.beginWorld(ctx);
    RENDER.drawGround(ctx, camera);
    RENDER.drawDecor(ctx, camera, WORLD.decorInView());
    RENDER.drawRoads(ctx, camera);
    RENDER.drawLandmarks(ctx, camera, WORLD.landmarksInView());
    RENDER.drawCamp(ctx, camera);
    RENDER.drawProjectiles(ctx, camera, WORLD.projectiles());
    RENDER.drawMonsters(ctx, camera, WORLD.monstersInView(), state.player.targetId, view.now);
    RENDER.drawTargetRing(ctx, camera, view.target);
    // 装备外观：四件装备由 09-equipment 汇总成一份 look，渲染层照着画（穿什么就像什么）
    RENDER.drawPlayer(ctx, camera, state.player, state.stats, view.now, EQUIP.lookOf(state.save.loadout));
    // 头顶名牌：角色名 + 血条（用户要求；玩家和精英怪共用同一份画法）
    RENDER.drawNameplate(ctx, camera, {
      x: state.player.x,
      y: state.player.y,
      radius: BAL.player.radius,
      name: state.save.name || '无名者',
      level: state.save.level,
      hp: state.player.hp,
      hpMax: state.stats.hpMax,
      dead: state.player.dead === true,
      color: '#ffeaa7'
    });
    // 斩击特效画在实体之上、飘字之下：刀光要盖住怪，伤害数字又要最清楚
    RENDER.drawEffects(ctx, camera, WORLD.effects(), view.now);
    RENDER.drawDamageNumbers(ctx, camera, WORLD.damageNumbers(), WORLD.now());
    RENDER.endWorld(ctx);

    INPUT.setButtons(view.buttons);
    INPUT.draw(ctx);
    HUD.draw(ctx, view);
    PANELS.draw(ctx, view);
    HUD.drawButtons(ctx, view);
  }

  /* ---------------------------------------------------------------- 触摸路由 */

  /** 取最后一根手指（竖屏单手为主，多指只服侍摇杆 + 一个按钮） */
  function touchPoint(event) {
    var list = [];
    if (event && event.touches && event.touches.length) list = event.touches;
    else if (event && event.changedTouches && event.changedTouches.length) list = event.changedTouches;
    if (!list.length) return null;
    var raw = list[list.length - 1];
    var point = SCREEN.pointer(raw.clientX, raw.clientY);
    point.id = raw.identifier === undefined || raw.identifier === null ? 0 : raw.identifier;
    return point;
  }

  /**
   * 按下：三层路由（见文件头）。
   * A4 的关键差别：**"面板开着"不再等于"全部触摸都给面板"** ——
   * 只有落在卡片矩形（或关闭键）里的那一下才归面板，其余照旧给摇杆 / 功能键。
   * 于是"打开背包时游戏不停止"不只是世界在跑，玩家也**真的还能走位**。
   */
  function onTouchStart(event) {
    var point = touchPoint(event);
    if (!point) return;
    // 首次触摸：解锁音频（平台硬要求"用户交互后才能播"），然后把 BGM 起起来
    if (PLAT.unlockAudio()) PLAT.bgm(true);
    lastSliderTiles = 0;
    if (state.screen !== 'playing') {
      G.LOGIN.press(point);
      return;
    }
    if (PANELS.isOpen() && PANELS.contains(point)) {
      state.panelTouch = true;
      PANELS.press(point, uiView());
      return;
    }
    state.panelTouch = false;
    INPUT.begin(point, WORLD.now());
  }

  function onTouchMove(event) {
    var point = touchPoint(event);
    if (!point) return;
    if (state.screen !== 'playing') return;
    if (state.panelTouch) {
      PANELS.move(point, uiView());
      applySliderDrag();
      return;
    }
    INPUT.move(point);
  }

  /**
   * A11 之二：视角缩放轴拖到哪，世界就缩放到哪 —— **边拖边缩放**才是滑块该有的手感
   * （卡片外面照旧露着世界，玩家一眼看到"拉近之后能看清什么"）。
   *
   * 静默应用（不提示、不写存储）：拖动途中每格都落盘会把手机拖卡，松手那一下由 release 的 action 收尾。
   * 同一格重复调用直接跳过（move 事件比像素还密，没必要重复算）。
   */
  function applySliderDrag() {
    var drag = PANELS.sliderDrag();
    if (!drag || drag.tiles === lastSliderTiles) return false;
    lastSliderTiles = drag.tiles;
    setZoomTiles(drag.tiles, true);
    return true;
  }

  function onTouchEnd(event) {
    var point = touchPoint(event);
    if (!point) return;
    if (state.screen !== 'playing') {
      handleLoginAction(G.LOGIN.release(point));
      return;
    }
    if (state.panelTouch) {
      state.panelTouch = false;
      var action = PANELS.release(point, uiView());
      lastSliderTiles = 0;
      handleAction(action);
      return;
    }
    var button = INPUT.end(point);
    if (button) onHudButton(button.id);
  }

  /* ---------------------------------------------------------------- 主循环 */

  /**
   * 每帧：把真实经过的时间切成固定 1/60 的逻辑步（最多追赶 maxCatchUpSteps 步），
   * 然后渲染一次。掉帧时逻辑不变慢；切后台回来不会"一顿狂算"。
   */
  function frame(timestampMs) {
    if (!state.running) return;
    var stamp = typeof timestampMs === 'number' && timestampMs > 0 ? timestampMs : Date.now();
    var elapsed = stamp - state.lastTickAt;
    if (!(elapsed > 0)) elapsed = 0;
    if (elapsed > 250) elapsed = 250;
    state.lastTickAt = stamp;
    state.accumulator += elapsed;

    var steps = 0;
    while (state.accumulator >= STEP_MS && steps < CONFIG.maxCatchUpSteps) {
      step(STEP_MS);
      state.accumulator -= STEP_MS;
      steps += 1;
    }
    if (steps >= CONFIG.maxCatchUpSteps) state.accumulator = 0;

    state.frames += 1;
    if (!state.fpsSince) state.fpsSince = stamp;
    if (stamp - state.fpsSince >= 1000) {
      // ⚠️ 无头环境里的 FPS 不能当性能结论（上一版踩过，见 03-roadmap §四.3）
      state.fps = state.frames;
      state.frames = 0;
      state.fpsSince = stamp;
    }
    if (stamp - state.autosaveAt >= BAL.view.autosaveMs) {
      state.autosaveAt = stamp;
      writeSave();
    }

    render();
    PLAT.frame(frame);
  }

  /**
   * 入口。**拿不到画布就不启动主循环**（node 里跑自检 / 冒烟就是这种情况）：
   * 这条判断同时让 19-selftest 能在无平台环境里驱动 step() / render()，
   * 不必假装自己是一台手机。
   */
  function start() {
    if (!PLAT.available()) return false;
    boot();
    return true;
  }

  return {
    state: state,
    flash: flash,
    writeSave: writeSave,
    boot: boot,
    beginPlaying: beginPlaying,
    loginAction: loginAction,
    createRoleAction: createRoleAction,
    handleLoginAction: handleLoginAction,
    autoStep: autoStep,
    toggleAutoBattle: toggleAutoBattle,
    castSkillSlot: castSkillSlot,
    autoCastStep: autoCastStep,
    skillAutoFlags: skillAutoFlags,
    toggleSkillAuto: toggleSkillAuto,
    zoomView: zoomView,
    setZoomTier: setZoomTier,
    setZoomTiles: setZoomTiles,
    nearestZoomTier: nearestZoomTier,
    applySliderDrag: applySliderDrag,
    cycleZoomTier: cycleZoomTier,
    skillView: skillView,
    skillCooldowns: skillCooldowns,
    toggleSetting: toggleSetting,
    syncAudio: syncAudio,
    playSfx: playSfx,
    applyHitFeedback: applyHitFeedback,
    setShake: setShake,
    shakeOffset: shakeOffset,
    step: step,
    applyKill: applyKill,
    onLevelUp: onLevelUp,
    openChests: openChests,
    openOneChest: openOneChest,
    /* A14：按阶开箱（宝箱清单每行的「全开」）+ 自动开启（勾选表 / 切换 / 掉出来就当场开） */
    openChestsOfTier: openChestsOfTier,
    openOneChestOfTier: openOneChestOfTier,
    autoOpenChest: autoOpenChest,
    chestAutoFlags: chestAutoFlags,
    toggleChestAuto: toggleChestAuto,
    equipFromBag: equipFromBag,
    salvageAll: salvageAll,
    buyHorn: buyHorn,
    /* 本次新增：商城的强化石 + 铁匠的强化（两者都是"改存档"的入口，界面只发 action） */
    buyStone: buyStone,
    enhanceItem: enhanceItem,
    nearSmith: nearSmith,
    smithButton: smithButton,
    createGuild: createGuild,
    /* 本次新增：公会的网络那一半（成员表 / 列表 / 加入 / 退会 / 自动刷新） */
    joinGuild: joinGuild,
    guildLeave: guildLeave,
    syncGuild: syncGuild,
    guildList: guildList,
    guildAutoSync: guildAutoSync,
    guildCloudReady: guildCloudReady,
    guildErrorText: guildErrorText,
    typeGuildName: typeGuildName,
    typeJoinName: typeJoinName,
    teleportGuild: teleportGuild,
    inCamp: inCamp,
    campHeal: campHeal,
    teleportCamp: teleportCamp,
    runSelftest: runSelftest,
    cloudPing: cloudPing,
    resetSave: resetSave,
    onTouchStart: onTouchStart,
    onTouchMove: onTouchMove,
    onTouchEnd: onTouchEnd,
    onHudButton: onHudButton,
    handleAction: handleAction,
    togglePanel: togglePanel,
    render: render,
    renderTo: renderTo,
    frame: frame,
    uiView: uiView,
    start: start
  };
})();

/**
 * 小游戏的入口文件就是拼出来的 game.js，所以这里直接起。
 * 拿不到画布（node 断言 / 冒烟）时 start() 返回 false，什么都不会发生 ——
 * 这正是"逻辑层与平台分离"带来的好处：同一份代码既能上手机也能进测试。
 */
G.GAME.start();
