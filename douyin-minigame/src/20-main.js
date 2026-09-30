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
 *   第 ② 条的"卡片里"是 A4 的关键：卡片只占 1/3 屏，**卡片外面照旧能推摇杆**，
 *   加上 step() 不再因为面板开着而 return，"打开背包 / 设置时游戏不停止"才真的成立。
 *
 * 界面状态机（A4）：'welcome'（登录）→ 'createRole'（创建角色 / 输入昵称）→ 'playing'。
 *   只有 'playing' 才跑世界逻辑，登录界面上的世界是静止的（还没登录，不该被怪打）。
 *
 * 玩法结算（经验 / 金币 / 掉箱 / 开箱 / 装备 / 商城 / 公会）放在这里的原因：
 *   它是**改存档的唯一地方**。阶段 B 起把这些函数原样搬到服务端即可 ——
 *   抽奖用的 rng 已经是传入的，接口一行都不用改（决策 #1 的前提）。
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

  var STEP_MS = 1000 / CONFIG.logicHz;

  var state = {
    running: false,
    save: null,
    player: null,
    stats: null,
    camera: { x: 0, y: 0 },
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
    panelTouch: false
  };

  /** 屏幕中央的一条提示（小游戏没有原生 toast，自绘最省事） */
  function flash(message, ms) {
    if (!message) return;
    state.flash.text = message;
    state.flash.until = state.now + (ms || 1600);
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
    state.camera.x = state.player.x;
    state.camera.y = state.player.y;

    WORLD.reset(BAL.season.worldSeed);
    WORLD.ensureChunks(state.player.x, state.player.y);

    // 世界指纹启动时算一次并常驻调试面板：它是"两份实现没有漂移"的证据
    state.fingerprint = G.SELFTEST.worldFingerprint(BAL.season.worldSeed);

    INPUT.setButtons(HUD.buttons({ save: state.save }));
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
   *   2. 没有目标 / 目标死了就按"视野内最近"重选（与出手共用同一份 pickTarget / targetId）；
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
    flash(settings.autoBattle ? '自动战斗已开启：自动走向视野内最近的怪' : '自动战斗已关闭：手动摇杆走位', 2200);
    return settings.autoBattle;
  }

  /* ---------------------------------------------------------------- 逻辑步 */

  /**
   * 一个逻辑帧（固定 1/60 秒）。
   * A4 的两处关键改动：
   *   1. 只有 `screen === 'playing'` 才跑世界 —— 登录 / 创建角色界面上的世界是静止的；
   *   2. **面板开着不再暂停世界**（用户要求"打开背包、设置等界面时游戏不停止"）：
   *      卡片只占 1/3 屏、卡片外还能推摇杆，于是玩家可以边开着背包边跑图。
   *      代价写在 04-decisions #10：站着开箱会被怪打 —— 这是"不暂停"的必然结果。
   */
  function step(dtMs) {
    if (state.screen !== 'playing') return;

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
        // 自动战斗：自动走向视野内最近的怪（出手本来就有 14-world.playerAttack 负责）
        autoStep(player, stats, dtMs);
      } else {
        PLAYER.move(player, 0, 0, dtMs / 1000, stats);
      }
    }
    PLAYER.decayKnockback(player);

    var events = WORLD.update(dtMs, player, stats, state.camera, SCREEN.width(), SCREEN.height());
    for (var i = 0; i < events.kills.length; i += 1) applyKill(events.kills[i]);
    if (events.playerDown) flash('被打倒了，3 秒后原地复活', 1600);

    // 相机缓动跟随（view.cameraLerpPerTick 是"每逻辑帧"的插值比例）
    state.camera.x += (player.x - state.camera.x) * BAL.view.cameraLerpPerTick;
    state.camera.y += (player.y - state.camera.y) * BAL.view.cameraLerpPerTick;

    state.save.stats.playMs += dtMs;
    state.now = WORLD.now();
  }

  /* ---------------------------------------------------------------- 结算 */

  /** 一次击杀的账：经验、金币、掉箱（决策 #1：只有"累计伤害最高者"能拿到） */
  function applyKill(kill) {
    var save = state.save;
    var monster = kill.monster;
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
      if (SAVE.pushChest(save, tier, monster.level)) {
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
    flash(text, 2200);
  }

  /* ---------------------------------------------------------------- 开箱与装备 */

  /**
   * 开箱时的装备等阶：以**箱阶为下限**，在同阶及以上按（band 调整过的）权重抽。
   * 这条规则兑现了 01-game-design §7 的"普通箱开出 ≥ 普通、天赐箱必是天赐"。
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

  /** 开一个箱：抽装备等阶 → 生成装备 →（默认）战力更高就直接穿上，否则进背包 */
  function openOneChest() {
    var save = state.save;
    if (save.chests.length === 0) return null;
    var chest = save.chests.shift();
    var band = CHUNK.bandOf(state.player.x, state.player.y);
    var tier = rollEquipmentTier(chest.tier, band);
    var item = EQUIP.generate(tier, chest.level, WORLD.rng(), 0);
    save.stats.opened += 1;

    var worn = save.loadout[item.slotId];
    if (CONFIG.autoEquipBetter && (!worn || item.power > worn.power)) {
      save.loadout[item.slotId] = item;
      if (worn) save.gold += LOOT.salvageGold(worn.tier);
      state.stats = PLAYER.statsOf(save.level, save.loadout);
      return { item: item, equipped: true };
    }
    SAVE.pushItem(save, item);
    return { item: item, equipped: false };
  }

  /** 开 N 箱：只报"最好的一件"，免得刷屏（每箱的结果都进背包/身上） */
  function openChests(count) {
    var results = [];
    for (var i = 0; i < count; i += 1) {
      var result = openOneChest();
      if (!result) break;
      results.push(result);
    }
    if (results.length === 0) {
      flash('没有宝箱：去打怪（普通怪约 8% 掉箱，精英 25%）', 1800);
      return;
    }
    var best = results[0];
    for (var k = 1; k < results.length; k += 1) {
      if (results[k].item.power > best.item.power) best = results[k];
    }
    flash(
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
    if (save.level < item.reqLevel) {
      flash('等级不够：需要 Lv.' + item.reqLevel, 1400);
      return;
    }
    var worn = save.loadout[item.slotId];
    save.loadout[item.slotId] = item;
    removeItem(save, item.id);
    if (worn) save.items.push(worn);
    state.stats = PLAYER.statsOf(save.level, save.loadout);
    flash('已穿上 ' + EQUIP.tierById(item.tier).name + ' ' + item.slotName + '（战力 ' + state.stats.power + '）', 1800);
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

  /** 建公会：消耗一个号角，**锚点就设在你脚下**（决策 #5 的"据点 = 回城锚点"） */
  function createGuild() {
    var save = state.save;
    if (!PROG.guildUnlocked(save.level)) {
      flash('需要 ' + BAL.guild.unlockLevel + ' 级才能建公会', 1600);
      return;
    }
    if (save.horns <= 0) {
      flash('没有号角：商城 ' + BAL.shop.horn.priceGold + ' 金币', 1800);
      return;
    }
    save.horns -= 1;
    save.guild = {
      name: PANELS.draftGuildName() || PANELS.nextGuildName(WORLD.now() | 0),
      anchor: { x: state.player.x, y: state.player.y },
      createdAt: Math.round(WORLD.now()),
      teleportAt: 0,
      members: [{ id: 1, name: '我', role: 'leader' }]
    };
    PANELS.setDraftGuildName('');
    flash('公会「' + save.guild.name + '」已建立，锚点就在脚下', 2600);
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
    state.camera.x = state.player.x;
    state.camera.y = state.player.y;
    state.player.targetId = 0;
    save.guild.teleportAt = WORLD.now();
    WORLD.ensureChunks(state.player.x, state.player.y);
    flash('回到公会锚点', 1400);
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
    var keepName = state.save ? state.save.name : '';
    SAVE.clear();
    state.save = SAVE.create(BAL.season.worldSeed, 1);
    // 角色名属于**账号**，不跟着存档一起清（否则玩家要重新起名，昵称也还占着）
    state.save.name = keepName;
    state.player = PLAYER.create(state.save);
    state.stats = PLAYER.statsOf(state.save.level, state.save.loadout);
    state.player.hp = state.stats.hpMax;
    state.camera.x = state.player.x;
    state.camera.y = state.player.y;
    WORLD.reset(BAL.season.worldSeed);
    WORLD.ensureChunks(state.player.x, state.player.y);
    writeSave();
    PANELS.close();
    flash('存档已重置', 1600);
  }

  /** 右下功能键 → 打开 / 收起面板；「自动」是开关（用户要求"自动战斗设置为按钮，点击开启"） */
  function onHudButton(id) {
    if (id === 'auto') {
      toggleAutoBattle();
      return;
    }
    if (id === 'chest') togglePanel('chest');
    else if (id === 'bag') togglePanel('bag');
    else if (id === 'guild') togglePanel('guild');
    else if (id === 'menu') togglePanel('menu');
  }

  /** 再点同一个功能键 = 收起面板（卡片只占 1/3 屏，功能键一直在，这是最顺手的关法） */
  function togglePanel(panel) {
    if (PANELS.isOpen() && PANELS.panelId() === panel) PANELS.close();
    else PANELS.open(panel);
  }

  /** 面板 action → 具体操作（**唯一改存档的入口**，阶段 B 会被服务端接口替换） */
  function handleAction(action) {
    if (!action) return;
    var type = action.type;
    if (type === 'close') PANELS.close();
    else if (type === 'open') PANELS.open(action.panel);
    else if (type === 'openChest') openChests(action.count || 1);
    else if (type === 'equip') equipFromBag(action.itemId);
    else if (type === 'salvageAll') salvageAll();
    else if (type === 'buyHorn') buyHorn();
    else if (type === 'createGuild') createGuild();
    else if (type === 'renameGuild') PANELS.setDraftGuildName(PANELS.nextGuildName((WORLD.now() | 0) + 7));
    else if (type === 'teleportGuild') teleportGuild();
    else if (type === 'selftest') runSelftest();
    else if (type === 'cloudPing') cloudPing();
    else if (type === 'toggleDebug') state.debug = !state.debug;
    else if (type === 'resetSave') resetSave();
  }

  /* ---------------------------------------------------------------- 渲染 */

  /** 组装一份"界面视图"：HUD / 面板 / 调试面板都只读它（避免各处各取一套数据） */
  function uiView() {
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
       * 卡片只占 1/3 屏，功能键必须一直可点，所以它不随面板开合而变。
       */
      buttons: HUD.buttons({ save: state.save }),
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
      autoBattle: !!(state.save.settings && state.save.settings.autoBattle === true)
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
   * 功能键放在最后：面板卡片只占 1/3 屏，右下那五个键要一直可用（点「包」能直接关掉背包）。
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

    RENDER.drawGround(ctx, state.camera);
    RENDER.drawDecor(ctx, state.camera, WORLD.decorInView());
    RENDER.drawRoads(ctx, state.camera);
    RENDER.drawLandmarks(ctx, state.camera, WORLD.landmarksInView());
    RENDER.drawCamp(ctx, state.camera);
    RENDER.drawProjectiles(ctx, state.camera, WORLD.projectiles());
    RENDER.drawMonsters(ctx, state.camera, WORLD.monstersInView(), state.player.targetId, view.now);
    RENDER.drawTargetRing(ctx, state.camera, view.target);
    RENDER.drawPlayer(ctx, state.camera, state.player, state.stats, view.now);
    // 头顶名牌：角色名 + 血条（用户要求；玩家和精英怪共用同一份画法）
    RENDER.drawNameplate(ctx, state.camera, {
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
    RENDER.drawDamageNumbers(ctx, state.camera, WORLD.damageNumbers(), WORLD.now());

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
      return;
    }
    INPUT.move(point);
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
      handleAction(PANELS.release(point, uiView()));
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
    step: step,
    applyKill: applyKill,
    onLevelUp: onLevelUp,
    openChests: openChests,
    equipFromBag: equipFromBag,
    salvageAll: salvageAll,
    buyHorn: buyHorn,
    createGuild: createGuild,
    teleportGuild: teleportGuild,
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

