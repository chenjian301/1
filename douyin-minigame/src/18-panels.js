/**
 * 18-panels.js —— 自绘面板（开箱 / 背包 / 商城 / 公会 / 设置 / 自检）+ 标题与创建角色界面
 *
 * 小游戏没有 DOM，所以界面也是 canvas 画的（01-game-design §2 的最后一条）。
 *
 * **A4 的三处改动（都是用户直接提的需求）**：
 *   1. **只占约 1/3 屏**：面板从"全屏覆盖"改成一张卡片
 *      （宽 = 屏宽 − leftMargin − rightReserve，高 = 屏高 × heightRatio，见 balance.view.panel）；
 *   2. **打开面板时游戏不停止**：卡片之外的触摸照旧给 15-input（摇杆能推、功能键能按），
 *      世界也照旧跑（20-main 的 step 不再因为面板开着而 return）；
 *   3. **关闭按钮**：卡片右上角一个圆形 ✕；面板内容比卡片长时，在卡片内上下拖动可以滚。
 *
 * 卡片内的行是矩形（可点），卡片右上角的关闭键是圆的 —— 沿用"圆形 = 即时操作，矩形 = 菜单"的分工。
 *
 * 与输入层的关系：面板自己吃触摸（press / move / release 返回一个 action），
 * 20-main 负责执行 action —— 面板不直接改存档，这样以后把这些操作搬到服务端校验时，
 * 只需要换掉执行者，界面一行都不用改。
 *
 * action 清单（都由 20-main 处理）：
 *   { type: 'close' }              关掉当前面板（✕）
 *   { type: 'open', panel }        切换面板（'chest' | 'bag' | 'shop' | 'guild' | 'menu' | 'selftest'）
 *   { type: 'openChest', count }   开箱（真正的抽奖在 20-main：那里才动保底计数）
 *   { type: 'equip', itemId }      穿上背包里的某件装备
 *   { type: 'salvageAll' }         一键分解（只留比身上强的）
 *   { type: 'buyHorn' }            买号角（500 金币，20 级解锁）
 *   { type: 'createGuild' }        建公会（消耗一个号角）
 *   { type: 'renameGuild' }        换一个随机会名（canvas 里没有输入框）
 *   { type: 'teleportGuild' }      回到公会锚点（冷却 + 战斗中禁用）
 *   { type: 'selftest' }  { type: 'cloudPing' }  { type: 'toggleDebug' }  { type: 'resetSave' }
 */

G.PANELS = (function () {
  'use strict';

  var BAL = G.BAL;
  var SCREEN = G.SCREEN;
  var EQUIP = G.EQUIP;
  var LOOT = G.LOOT;
  var PROG = G.PROG;

  var current = null;
  var pressedRowId = null;

  /** 滚动与拖动状态：`scroll` 是内容相对视口向下滚过的距离（只增不减的纯数字，能断言） */
  var scroll = 0;
  var pressY = 0;
  var pressScroll = 0;
  var dragging = false;
  var pressedClose = false;

  /** 随机会名用的词（canvas 里没有输入框，用"换一个"代替打字；阶段 D 再接平台键盘） */
  var GUILD_A = ['铁血', '荒野', '星火', '长风', '夜航', '荒原', '钢齿', '灰烬'];
  var GUILD_B = ['兄弟会', '远征团', '守望者', '拾荒团', '游猎帮', '商队', '联盟'];

  var draftGuildName = '';

  /** 用世界时间做种子生成会名（本工程只允许 G.RNG 出随机，不许 Math.random） */
  function nextGuildName(salt) {
    var rng = new G.RNG.Rng(G.RNG.hash32((G.WORLD.now() | 0) + (salt | 0), 0x6d17, 0x3c1f));
    var a = GUILD_A[rng.int(0, GUILD_A.length - 1)];
    var b = GUILD_B[rng.int(0, GUILD_B.length - 1)];
    return a + b;
  }

  /* ------------------------------------------------------------- 卡片几何 */

  /**
   * 面板卡片：**只占约 1/3 屏**（用户要求"ui 不要铺满屏幕，只要占三分之一大小"）。
   *   width  = 屏宽 − leftMargin − rightReserve （右边留给右下功能键，互不遮挡）
   *   height = 屏高 × heightRatio
   *   位置   = 左贴 margin、上边贴在吸顶块下方（下半屏留给摇杆与拇指）
   * 0.79 × 0.38 ≈ 30% 屏面积。所有数字都在 balance.view.panel，改数值不用改代码。
   */
  function rect() {
    var config = BAL.view.panel;
    var width = SCREEN.width() - config.leftMargin - config.rightReserve;
    var height = SCREEN.height() * config.heightRatio;
    return { x: config.leftMargin, y: G.HUD.plateHeight() + 18, w: width, h: height };
  }

  /** 内容视口：卡片去掉标题栏之后的那块（行只在这里面绘制与命中） */
  function viewport() {
    var card = rect();
    var headerHeight = BAL.view.panel.headerHeight;
    return { x: card.x, y: card.y + headerHeight, w: card.w, h: card.h - headerHeight };
  }

  /** 行的起始 y（第一行的左上角） */
  function contentTop() {
    return viewport().y + 8;
  }

  /** 卡片右上角的关闭键（用户要求"添加关闭按钮"）：面板里唯一的圆形按钮 */
  function closeButton() {
    var card = rect();
    var radius = 26;
    return {
      id: 'panel:close',
      label: 'X',
      badge: 0,
      x: card.x + card.w - radius - 12,
      y: card.y + BAL.view.panel.headerHeight / 2,
      r: radius
    };
  }

  /** 卡片内可点行的最大滚动距离（内容比视口短就是 0 —— 短面板不该能拖动） */
  function maxScroll(view) {
    var built = buildRows(view);
    if (!built.length) return 0;
    var last = built[built.length - 1];
    var limit = last.y + last.h - (viewport().y + viewport().h);
    return limit > 0 ? limit : 0;
  }

  /** 设置滚动位置（自动夹到 [0, maxScroll]） */
  function setScroll(value, view) {
    var limit = maxScroll(view);
    if (!(value > 0)) value = 0;
    if (value > limit) value = limit;
    scroll = value;
    return scroll;
  }

  function scrollOffset() {
    return scroll;
  }

  /** 这一点在不在面板的"势力范围"里（卡片矩形 + 关闭键的圆）：不在就交给摇杆/功能键 */
  function contains(point) {
    if (!current || !point) return false;
    var button = closeButton();
    var dx = point.x - button.x;
    var dy = point.y - button.y;
    var reach = button.r + 12;
    if (dx * dx + dy * dy <= reach * reach) return true;
    var card = rect();
    return point.x >= card.x && point.x <= card.x + card.w && point.y >= card.y && point.y <= card.y + card.h;
  }

  function open(panel) {
    current = panel;
    pressedRowId = null;
    scroll = 0;
    dragging = false;
    pressedClose = false;
    if (panel === 'guild' && !draftGuildName) draftGuildName = nextGuildName(0);
  }

  function close() {
    current = null;
    pressedRowId = null;
    scroll = 0;
    dragging = false;
    pressedClose = false;
  }

  function isOpen() {
    return current !== null;
  }

  function panelId() {
    return current;
  }

  function tierColor(tier) {
    var colors = ['#c7c7c7', '#8ce99a', '#a9d5ff', '#d0a9ff', '#ff9b5a', '#ffd479'];
    return colors[tier - 1] || '#c7c7c7';
  }

  /** 面板里唯一的圆按钮：卡片右上角的关闭键。返回数组是为了和 HUD 的按钮同构 */
  function buttons() {
    if (!current) return [];
    return [closeButton()];
  }

  /**
   * 行布局（未加滚动偏移）：从卡片内容的顶部开始，每行高 = `balance.view.panel.rowHeight`。
   * 行高固定是有原因的：命中测试与滚动夹取都只要一次乘加，不用测量文本。
   * 行内两行字：主行 y+22（26px）、副行 y+44（18px）—— 加起来正好落在 62 的行带里。
   * 返回 [{ id, y, h, text, sub, color, action }]
   */
  function buildRows(view) {
    var list = [];
    if (!current) return list;
    var top = contentTop();
    var rowH = BAL.view.panel.rowHeight;
    var i;

    if (current === 'chest') {
      list.push({
        id: 'chest:open1',
        y: top,
        h: rowH,
        text: '开 1 个宝箱',
        sub: '保底计数：史诗 ' + view.save.pity.epic + '/' + BAL.chests.pity.epic + ' · 神话 ' + view.save.pity.mythic + '/' + BAL.chests.pity.mythic,
        color: '#ffd479',
        action: { type: 'openChest', count: 1 }
      });
      list.push({
        id: 'chest:open10',
        y: top + rowH,
        h: rowH,
        text: '开 10 个宝箱',
        sub: '背包 ' + view.save.chests.length + ' / ' + BAL.chests.bagCap + '（满了自动分解成金币）',
        color: '#ffd479',
        action: { type: 'openChest', count: 10 }
      });
      top += rowH * 2 + 24;
      for (i = 0; i < view.save.chests.length && i < 8; i += 1) {
        var chest = view.save.chests[i];
        list.push({
          id: 'chest:bag:' + i,
          y: top + i * 62,
          h: 62,
          text: LOOT.tierName(chest.tier) + '（掉落等级 ' + chest.level + '）',
          sub: '',
          color: tierColor(chest.tier),
          action: { type: 'openChest', count: 1 }
        });
      }
      if (view.save.chests.length === 0) {
        list.push({ id: 'chest:empty', y: top, h: 62, text: '还没有宝箱', sub: '去打怪：普通怪约 8% 掉箱，精英 25%', color: '#c7c7c7', action: null });
      }
      return list;
    }

    if (current === 'bag') {
      list.push({
        id: 'bag:salvageAll',
        y: top,
        h: rowH,
        text: '一键分解（每件都留最强的）',
        sub: '换金币 · 背包 ' + view.save.items.length + ' 件',
        color: '#ffd479',
        action: { type: 'salvageAll' }
      });
      top += rowH + 24;
      for (i = 0; i < view.save.items.length && i < 9; i += 1) {
        var item = view.save.items[i];
        var worn = view.save.loadout[item.slotId];
        var better = !worn || item.power > worn.power;
        list.push({
          id: 'bag:item:' + item.id,
          y: top + i * 62,
          h: 62,
          text: EQUIP.tierById(item.tier).name + ' ' + item.slotName + '（战力 ' + item.power + '）',
          sub: (better ? '↑ 更强' : '↓ 更弱') + ' · 需求 Lv.' + item.reqLevel + ' · 点一下穿上',
          color: better ? '#8ce99a' : '#c7c7c7',
          action: { type: 'equip', itemId: item.id }
        });
      }
      if (view.save.items.length === 0) {
        list.push({ id: 'bag:empty', y: top, h: 62, text: '背包是空的', sub: '开箱会自动穿上更强的装备，不要的在这里分解', color: '#c7c7c7', action: null });
      }
    }

    if (current === 'shop') {
      var unlocked = PROG.shopUnlocked(view.save.level);
      list.push({
        id: 'shop:horn',
        y: top,
        h: rowH,
        text: '公会号角 ' + BAL.shop.horn.priceGold + ' 金币',
        sub: unlocked
          ? '已持有 ' + view.save.horns + ' 个 · 建公会消耗 1 个'
          : '需要 ' + BAL.guild.shopUnlockLevel + ' 级解锁（现在 ' + view.save.level + ' 级）',
        color: unlocked ? '#ffd479' : '#8d8d8d',
        action: { type: 'buyHorn' }
      });
      list.push({
        id: 'shop:teleport',
        y: top + rowH,
        h: rowH,
        text: '回公会（免费）',
        sub: '冷却 ' + Math.round(BAL.guild.teleportCooldownMs / 1000) + ' 秒 · 战斗中 ' + Math.round(BAL.guild.teleportCombatLockMs / 1000) + ' 秒内不可用',
        color: '#a9d5ff',
        action: { type: 'teleportGuild' }
      });
      list.push({
        id: 'shop:note',
        y: top + rowH * 2,
        h: rowH,
        text: '首版不接真实支付（决策 #3）',
        sub: '号角只能用金币买；钻石字段保留但不投放',
        color: '#c7c7c7',
        action: null
      });
    }

    if (current === 'guild') {
      var levelOk = PROG.guildUnlocked(view.save.level);
      if (!view.save.guild) {
        list.push({
          id: 'guild:name',
          y: top,
          h: rowH,
          text: '公会名：' + draftGuildName,
          sub: '点一下换一个（canvas 里没有输入框，阶段 D 接平台键盘）',
          color: '#a9d5ff',
          action: { type: 'renameGuild' }
        });
        list.push({
          id: 'guild:create',
          y: top + rowH,
          h: rowH,
          text: '创建公会（消耗 1 个号角）',
          sub: !levelOk
            ? '需要 ' + BAL.guild.unlockLevel + ' 级（现在 ' + view.save.level + ' 级）'
            : view.save.horns > 0
              ? '持有号角 ' + view.save.horns + ' 个'
              : '还没有号角：商城 ' + BAL.shop.horn.priceGold + ' 金币',
          color: levelOk && view.save.horns > 0 ? '#8ce99a' : '#8d8d8d',
          action: { type: 'createGuild' }
        });
      } else {
        list.push({
          id: 'guild:info',
          y: top,
          h: rowH,
          text: view.save.guild.name,
          sub: '会长：我 · 成员 1 / ' + BAL.guild.memberCap,
          color: '#ffd479',
          action: null
        });
        list.push({
          id: 'guild:teleport',
          y: top + rowH,
          h: rowH,
          text: '回到公会锚点',
          sub: '锚点 (' + Math.round(view.save.guild.anchor.x) + ', ' + Math.round(view.save.guild.anchor.y) + ')',
          color: '#a9d5ff',
          action: { type: 'teleportGuild' }
        });
        list.push({
          id: 'guild:members',
          y: top + rowH * 2,
          h: rowH,
          text: '成员列表（阶段 D 上服务端）',
          sub: '现在只有你自己；邀请码 / 申请 / 踢人都在服务端做',
          color: '#c7c7c7',
          action: null
        });
      }
    }

    if (current === 'camp') {
      var heal = BAL.world.camp.heal;
      var missing = Math.max(0, view.stats.hpMax - view.player.hp);
      var cost = Math.max(heal.minGold, Math.ceil(missing * heal.goldPerHp));
      list.push({
        id: 'camp:heal',
        y: top,
        h: rowH,
        text: '治疗：回复满血（' + cost + ' 金币）',
        sub: missing > 0 ? '缺 ' + Math.round(missing) + ' 点生命 · 持有 ' + view.save.gold + ' 金币' : '血量是满的，不用花钱',
        color: missing > 0 && view.save.gold >= cost ? '#8ce99a' : '#8d8d8d',
        action: { type: 'campHeal' }
      });
      list.push({
        id: 'camp:shop',
        y: top + rowH,
        h: rowH,
        text: '进商城（买公会号角）',
        sub: '营地里的商人：号角 ' + BAL.shop.horn.priceGold + ' 金币，' + BAL.guild.shopUnlockLevel + ' 级解锁',
        color: '#ffd479',
        action: { type: 'open', panel: 'shop' }
      });
      list.push({
        id: 'camp:teleport',
        y: top + rowH * 2,
        h: rowH,
        text: '回到营地中心',
        sub:
          '冷却 ' +
          Math.round(BAL.world.camp.teleportCooldownMs / 1000) +
          ' 秒 · 战斗中 ' +
          Math.round(BAL.guild.teleportCombatLockMs / 1000) +
          ' 秒内不可用',
        color: '#a9d5ff',
        action: { type: 'campTeleport' }
      });
      list.push({
        id: 'camp:guild',
        y: top + rowH * 3,
        h: rowH,
        text: '回公会锚点',
        sub: view.save.guild ? '公会「' + view.save.guild.name + '」的锚点' : '还没有公会：先在商城买号角',
        color: view.save.guild ? '#a9d5ff' : '#8d8d8d',
        action: { type: 'teleportGuild' }
      });
      list.push({
        id: 'camp:note',
        y: top + rowH * 4,
        h: rowH,
        text: '营地是"外观"安全区：怪照样刷新',
        sub: '阶段 A 的取舍（04-decisions #9）；真正的不刷怪半径要和公会锚点 safeRadius 一起定',
        color: '#c7c7c7',
        action: null
      });
      return list;
    }

    if (current === 'menu') {
      var settings = view.save.settings || { autoBattle: false, sfx: true, bgm: true, vibrate: true };
      var audio = view.audio || null;
      list.push({
        id: 'menu:selftest',
        y: top,
        h: rowH,
        text: '立即跑自检',
        sub: '地图确定性 / 伤害 / 掉箱 / 装备 / 升级曲线 / 账号与界面，三百多项断言当场出结果',
        color: '#8ce99a',
        action: { type: 'selftest' }
      });
      list.push({
        id: 'menu:cloud',
        y: top + rowH,
        h: rowH,
        text: '云后端连通性自测',
        sub: '部署抖音云后把域名填进 00-config.js 的 cloudBase，这里会调一次 /api/health',
        color: '#a9d5ff',
        action: { type: 'cloudPing' }
      });
      list.push({
        id: 'menu:debug',
        y: top + rowH * 2,
        h: rowH,
        text: (view.debug ? '关闭' : '打开') + '调试面板',
        sub: 'FPS / chunk 数 / 活跃怪 / 当前目标 / 世界种子',
        color: '#ffd479',
        action: { type: 'toggleDebug' }
      });
      list.push({
        id: 'menu:sfx',
        y: top + rowH * 3,
        h: rowH,
        text: '音效：' + (settings.sfx ? '开' : '关'),
        sub: '命中 / 暴击 / 击杀 / 受伤 / 升级 / 开箱（音量在 balance.audio，声音文件由工具生成）',
        color: settings.sfx ? '#8ce99a' : '#8d8d8d',
        action: { type: 'toggleSfx' }
      });
      list.push({
        id: 'menu:bgm',
        y: top + rowH * 4,
        h: rowH,
        text: '背景音乐：' + (settings.bgm ? '开' : '关'),
        sub: audio && audio.supported ? '首次触摸后才会响（平台要求）' : '当前环境没有音频接口（模拟器里可能如此）',
        color: settings.bgm ? '#8ce99a' : '#8d8d8d',
        action: { type: 'toggleBgm' }
      });
      list.push({
        id: 'menu:vibrate',
        y: top + rowH * 5,
        h: rowH,
        text: '震动：' + (settings.vibrate ? '开' : '关'),
        sub: '暴击与挨打时短震一下（暴击的手感一半在手上）',
        color: settings.vibrate ? '#8ce99a' : '#8d8d8d',
        action: { type: 'toggleVibrate' }
      });
      list.push({
        id: 'menu:reset',
        y: top + rowH * 6,
        h: rowH,
        text: '重置本地存档',
        sub: view.resetArmed ? '再点一次真的删（等级 / 装备 / 宝箱全清，角色名保留）' : '点一下先确认',
        color: view.resetArmed ? '#ff8a8a' : '#c7c7c7',
        action: { type: 'resetSave' }
      });
    }

    return list;
  }

  /**
   * 对外统一入口：在 buildRows 的结果上扣掉滚动偏移。
   * 绘制与命中都用它的原因：面板滚动最经典的 bug 就是"画的时候减了、点的时候没减"。
   */
  function rows(view) {
    var list = buildRows(view);
    if (scroll === 0) return list;
    for (var i = 0; i < list.length; i += 1) list[i].y -= scroll;
    return list;
  }

  /** 命中测试：点落在哪一行上（只认视口内的行；上下各放宽 6 设计像素，手指更好点） */
  function rowAt(point, view) {
    var area = viewport();
    if (point.y < area.y || point.y > area.y + area.h) return null;
    var list = rows(view);
    for (var i = 0; i < list.length; i += 1) {
      var row = list[i];
      if (point.y >= row.y - 6 && point.y <= row.y + row.h - 10 + 6) return row;
    }
    return null;
  }

  /**
   * 按下：先判关闭键，再判卡片内的行（松手时才算点击，中途滑走 / 滚动就取消）。
   */
  function press(point, view) {
    if (!current) return null;
    var button = closeButton();
    var dx = point.x - button.x;
    var dy = point.y - button.y;
    var reach = button.r + 12;
    if (dx * dx + dy * dy <= reach * reach) {
      pressedClose = true;
      return button.id;
    }
    pressedClose = false;
    var card = rect();
    if (point.x < card.x || point.x > card.x + card.w || point.y < card.y || point.y > card.y + card.h) {
      pressedRowId = null;
      return null;
    }
    pressY = point.y;
    pressScroll = scroll;
    dragging = false;
    var row = rowAt(point, view);
    pressedRowId = row ? row.id : null;
    return pressedRowId;
  }

  /**
   * 拖动：卡片内上下拖 = 滚动（内容比视口长才有得滚）。
   * 一旦超过 `touchSlop` 就把"按下命中的那一行"作废 —— 手指滑过一行不该算点了它。
   * 返回 true 表示这一下已经被面板消费（调用方不必再当摇杆处理）。
   */
  function move(point, view) {
    if (!current || pressedClose) return false;
    var dy = point.y - pressY;
    if (!dragging && Math.abs(dy) > BAL.view.panel.touchSlop) {
      dragging = true;
      pressedRowId = null;
    }
    if (!dragging) return false;
    setScroll(pressScroll - dy, view);
    return true;
  }

  /** 松手：关闭键 → close；拖动过 → 什么都不触发；否则命中行 → 该行的 action */
  function release(point, view) {
    if (!current) return null;
    if (pressedClose) {
      pressedClose = false;
      return { type: 'close' };
    }
    if (dragging) {
      dragging = false;
      pressedRowId = null;
      return null;
    }
    var row = rowAt(point, view);
    pressedRowId = null;
    if (row && row.action) return row.action;
    return null;
  }

  /** 标题下面的一行小字：让玩家知道自己在哪个面板、身上有多少钱 */
  function headerLine(view) {
    return 'Lv.' + view.save.level + ' · 金币 ' + view.save.gold + ' · 战力 ' + view.stats.power + ' · 宝箱 ' + view.save.chests.length;
  }

  /**
   * 面板主绘制：一层**很淡**的暗底（世界仍然看得见 —— "打开界面游戏不停止"的视觉表达）
   * 加一张约占 1/3 屏的卡片。卡片 = 标题栏（标题 + 右上关闭键）+ 内容视口（行；超长就滚）。
   *
   * 内容用 `moveTo/lineTo` 组成的矩形路径 clip 住：滚动时半行不会被画到卡片外的世界上。
   * 这也是"只用基础图元"约束下的正解 —— 假 canvas 只实现了 moveTo/lineTo/arc/fillRect 这一组。
   */
  function draw(ctx, view) {
    if (!current) return;
    var config = BAL.view.panel;
    var card = rect();
    var area = viewport();
    var i;

    ctx.fillStyle = 'rgba(6,10,20,' + config.dimAlpha + ')';
    ctx.fillRect(0, 0, SCREEN.width(), SCREEN.height());

    // 卡片底 + 描边（圆角走 16-render 的 roundRectPath：moveTo/lineTo/arc，冒烟的假 canvas 也认）
    ctx.fillStyle = 'rgba(12,18,32,0.95)';
    G.RENDER.roundRectPath(ctx, card.x, card.y, card.w, card.h, 18);
    ctx.fill();
    ctx.strokeStyle = '#3a4a6b';
    ctx.lineWidth = 3;
    G.RENDER.roundRectPath(ctx, card.x, card.y, card.w, card.h, 18);
    ctx.stroke();

    // 标题栏
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(card.x + 2, card.y + 2, card.w - 4, config.headerHeight - 4);
    G.HUD.text(ctx, titlesOf(current), card.x + 22, card.y + 32, 28, '#ffd479', 'left');
    G.HUD.text(ctx, headerLine(view), card.x + 22, card.y + 58, 18, '#9fb4d8', 'left');

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(area.x, area.y);
    ctx.lineTo(area.x + area.w, area.y);
    ctx.lineTo(area.x + area.w, area.y + area.h);
    ctx.lineTo(area.x, area.y + area.h);
    ctx.closePath();
    ctx.clip();

    var list = rows(view);
    for (i = 0; i < list.length; i += 1) {
      var row = list[i];
      // 视口外的行直接跳过（省落笔，也不让 clip 白算）
      if (row.y + row.h < area.y - 4 || row.y > area.y + area.h + 4) continue;
      var pressed = pressedRowId === row.id;
      ctx.fillStyle = pressed ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.05)';
      ctx.fillRect(area.x + 10, row.y, area.w - 20, row.h - 10);
      G.HUD.text(ctx, row.text, area.x + 24, row.y + (row.sub ? 22 : (row.h - 10) / 2), 26, row.color, 'left');
      if (row.sub) G.HUD.text(ctx, row.sub, area.x + 24, row.y + 44, 17, '#9fb4d8', 'left');
      if (!row.action) {
        // 不可点的行给个视觉标记，免得玩家一直点它
        ctx.globalAlpha = 0.5;
        G.HUD.text(ctx, '（说明）', area.x + area.w - 22, row.y + (row.h - 10) / 2, 17, '#8d9bb5', 'right');
        ctx.globalAlpha = 1;
      }
    }

    if (current === 'selftest' && view.selftest) {
      var lines = view.selftest.lines || [];
      var boxH = area.h - 96;
      var maxLines = Math.max(3, Math.floor(boxH / 20));
      var start = Math.max(0, lines.length - maxLines);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(area.x + 10, area.y + 6, area.w - 20, boxH);
      for (var k = start; k < lines.length; k += 1) {
        var line = lines[k];
        var color = line.indexOf('FAIL') >= 0 ? '#ff8a8a' : '#bfe0ff';
        G.HUD.text(ctx, line, area.x + 18, area.y + 18 + (k - start) * 20, 15, color, 'left');
      }
      G.HUD.text(
        ctx,
        view.selftest.checks + ' 项 · 失败 ' + view.selftest.failures + ' · 指纹 ' + view.selftest.fingerprint,
        area.x + 18,
        area.y + boxH + 22,
        18,
        view.selftest.failures === 0 ? '#8ce99a' : '#ff8a8a',
        'left'
      );
    }
    ctx.restore();

    // 滚动条：只有内容真的比视口长才画（让玩家知道"下面还有"）
    var limit = maxScroll(view);
    if (limit > 0) {
      var trackH = area.h - 16;
      var thumbH = Math.max(36, trackH * (area.h / (area.h + limit)));
      var thumbY = area.y + 8 + (trackH - thumbH) * (scroll / limit);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(area.x + area.w - 7, area.y + 8, 4, trackH);
      ctx.fillStyle = '#6d86b5';
      ctx.fillRect(area.x + area.w - 7, thumbY, 4, thumbH);
    }

    if (current === 'menu' && view.cloud) {
      G.HUD.text(ctx, view.cloud, card.x + 20, card.y + card.h - 14, 15, '#9fb4d8', 'left');
    }

    // 关闭键（圆的：和 HUD 的功能键同一套视觉，命中测试在 press/release 里用同一份坐标）
    var list2 = buttons();
    for (i = 0; i < list2.length; i += 1) {
      var button = list2[i];
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = pressedClose ? '#ffd479' : '#243149';
      ctx.beginPath();
      ctx.arc(button.x, button.y, button.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#4d5f86';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(button.x, button.y, button.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      G.HUD.text(ctx, button.label, button.x, button.y, 26, pressedClose ? '#241a05' : '#dce6ff', 'center');
    }
  }

  /** 面板标题（一个地方管住，免得标题与面板 id 各写一份） */
  function titlesOf(panel) {
    if (panel === 'chest') return '开箱';
    if (panel === 'bag') return '背包 / 装备';
    if (panel === 'shop') return '商城';
    if (panel === 'guild') return '公会';
    if (panel === 'camp') return '营地';
    if (panel === 'menu') return '设置 / 调试';
    if (panel === 'selftest') return '自检结果';
    return String(panel);
  }

  return {
    open: open,
    close: close,
    isOpen: isOpen,
    panelId: panelId,
    buttons: buttons,
    rows: rows,
    buildRows: buildRows,
    rect: rect,
    viewport: viewport,
    contains: contains,
    maxScroll: maxScroll,
    setScroll: setScroll,
    scrollOffset: scrollOffset,
    press: press,
    move: move,
    release: release,
    tierColor: tierColor,
    nextGuildName: nextGuildName,
    draftGuildName: function () {
      return draftGuildName;
    },
    setDraftGuildName: function (name) {
      draftGuildName = name;
    },
    draw: draw
  };
})();

/**
 * G.LOGIN —— 标题 / 登录 / 创建角色界面（A4 新增）
 *
 * 用户要求："在打开游戏后增加注册，登录，创建角色，输入昵称等功能，并且昵称不能重复。"
 *
 * 它管的是**进游戏之前**的那两块屏，和 PANELS 同一套约定：
 *   界面只产生 action，由 20-main 执行（登录 = tt.login + /api/profile；建角色 = 校验昵称 + 写存档）。
 *   所以这里既不碰 tt、也不改存档 —— "昵称到底能不能用"于是可以在 node 里直接断言。
 *
 * action 清单：
 *   { type: 'login' }        登录：本机已有角色就直接进游戏，没有就去创建角色
 *   { type: 'typeName' }     调平台键盘输入昵称（tt.showKeyboard；没有这个 API 会退回随机名）
 *   { type: 'randomName' }   换一个随机昵称（canvas 里没有输入框时的兜底输入方式）
 *   { type: 'createRole' }   用当前昵称创建角色（先查本机注册表，配了云后端再查服务端）
 *   { type: 'newAccount' }   清掉本机账号（两步确认，调试用）
 *
 * 按钮是**矩形**（菜单语义，和面板卡片里的行同构）；游戏内的即时操作才用圆形 —— 这条分工
 * 让"点哪是哪"在两套界面里都成立。
 */
G.LOGIN = (function () {
  'use strict';

  var BAL = G.BAL;
  var SCREEN = G.SCREEN;

  var stage = 'welcome';
  var draft = '';
  var message = '';
  var busy = false;
  var pressedId = null;
  var armed = false;
  var hasAccount = false;

  /** 打开某一屏（'welcome' | 'createRole'） */
  function open(nextStage) {
    stage = nextStage === 'createRole' ? 'createRole' : 'welcome';
    busy = false;
    armed = false;
    pressedId = null;
    message = '';
    if (stage === 'createRole' && !draft) draft = G.ACCOUNT.suggest(G.WORLD.now() | 0);
  }

  function stageId() {
    return stage;
  }

  function draftName() {
    return draft;
  }

  function setDraftName(name) {
    draft = G.ACCOUNT.sanitizeName(name);
    return draft;
  }

  /** 换一个随机昵称（走 G.RNG：同一个世界时间给同一个名字，可复现） */
  function randomName(salt) {
    draft = G.ACCOUNT.suggest(typeof salt === 'number' ? salt : G.WORLD.now() | 0);
    message = '';
    return draft;
  }

  function setMessage(text) {
    message = text || '';
  }

  function setBusy(flag, text) {
    busy = flag === true;
    if (text !== undefined) message = text || '';
  }

  function isBusy() {
    return busy;
  }

  function setHasAccount(flag) {
    hasAccount = flag === true;
  }

  function isArmed() {
    return armed;
  }

  /** 卡片几何：和面板同一套边距（这是全屏界面，右边不用给功能键留位） */
  function rect() {
    var config = BAL.view.panel;
    var width = SCREEN.width() - config.leftMargin * 2;
    var height = SCREEN.height() * 0.34;
    return { x: config.leftMargin, y: SCREEN.height() * 0.3, w: width, h: height };
  }

  /** 矩形按钮：{ id, label, x, y, w, h }（命中测试与绘制共用同一份坐标） */
  function buttons() {
    var card = rect();
    var left = card.x + 24;
    var wide = card.w - 48;
    var list = [];
    if (stage === 'welcome') {
      list.push({
        id: 'login',
        label: hasAccount ? '继续游戏（登录）' : '登录 / 开始游戏',
        x: left,
        y: card.y + 196,
        w: wide,
        h: 78
      });
      list.push({
        id: 'newAccount',
        label: armed ? '再点一次：清掉本机账号' : '清掉本机账号（调试）',
        x: left,
        y: card.y + 292,
        w: wide,
        h: 54
      });
      return list;
    }
    list.push({ id: 'typeName', label: '输入昵称', x: left, y: card.y + 196, w: wide, h: 64 });
    list.push({ id: 'randomName', label: '换一个随机昵称', x: left, y: card.y + 270, w: wide, h: 58 });
    list.push({ id: 'createRole', label: '创建角色并进入游戏', x: left, y: card.y + 342, w: wide, h: 70 });
    return list;
  }

  function buttonAt(point) {
    var list = buttons();
    for (var i = 0; i < list.length; i += 1) {
      var button = list[i];
      if (point.x >= button.x && point.x <= button.x + button.w && point.y >= button.y && point.y <= button.y + button.h) {
        return button;
      }
    }
    return null;
  }

  /** 按下：记住被按住的按钮（松手才算点击，滑开就取消） */
  function press(point) {
    if (busy) return null;
    var button = buttonAt(point);
    pressedId = button ? button.id : null;
    return pressedId;
  }

  /** 松手：同一个按钮上松手才产生 action（"清账号"要求点两次） */
  function release(point) {
    if (busy || !pressedId) {
      pressedId = null;
      return null;
    }
    var button = buttonAt(point);
    var id = pressedId;
    pressedId = null;
    if (!button || button.id !== id) return null;
    if (id === 'newAccount') {
      if (!armed) {
        armed = true;
        message = '清掉本机账号只是调试用：存档不会删，昵称注册表也不会释放';
        return null;
      }
      armed = false;
      return { type: 'newAccount' };
    }
    return { type: id };
  }

  /** 画一个矩形按钮（菜单语义：比圆形更好放长文案） */
  function painted(ctx, button, pressed) {
    ctx.fillStyle = pressed ? '#ffd479' : '#1b2438';
    ctx.fillRect(button.x, button.y, button.w, button.h);
    ctx.strokeStyle = pressed ? '#fff3d0' : '#4d5f86';
    ctx.lineWidth = 3;
    ctx.strokeRect(button.x, button.y, button.w, button.h);
  }

  /** 一屏的字：标题 / 账号态 / 昵称 / 提示 / 按钮 */
  function draw(ctx, view) {
    var card = rect();
    var centerX = SCREEN.centerX();
    var account = view && view.account ? view.account : null;
    var save = view && view.save ? view.save : null;
    var name = stage === 'createRole' ? draft : (account && account.name) || '';

    ctx.fillStyle = '#0b1020';
    ctx.fillRect(0, 0, SCREEN.width(), SCREEN.height());

    G.HUD.text(ctx, '疯狂开宝箱', centerX, SCREEN.height() * 0.13, 52, '#ffd479', 'center');
    G.HUD.text(ctx, '竖屏 · 无限地图 · 自动战斗 · 刷宝', centerX, SCREEN.height() * 0.13 + 46, 22, '#9fb4d8', 'center');

    ctx.fillStyle = 'rgba(12,18,32,0.95)';
    G.RENDER.roundRectPath(ctx, card.x, card.y, card.w, card.h, 18);
    ctx.fill();
    ctx.strokeStyle = '#3a4a6b';
    ctx.lineWidth = 3;
    G.RENDER.roundRectPath(ctx, card.x, card.y, card.w, card.h, 18);
    ctx.stroke();

    // 头像：用昵称当种子 → 同一个名字永远同一张脸（视觉上"这就是我的角色"）
    G.RENDER.drawAvatar(ctx, centerX, card.y - 2, 46, G.RNG.hash32(G.ACCOUNT.nameKey(name).length * 31, 0x51a7c3));

    if (stage === 'welcome') {
      G.HUD.text(ctx, '登录后开始你的刷宝之旅', centerX, card.y + 60, 26, '#ffd479', 'center');
      G.HUD.text(
        ctx,
        account
          ? '本机账号：' + account.name + '（' + (account.mode === 'douyin' ? '抖音' : '本机') + '）'
          : '还没有账号：点下面的按钮登录 / 注册',
        centerX,
        card.y + 100,
        20,
        '#9fb4d8',
        'center'
      );
      G.HUD.text(
        ctx,
        save && save.name ? '当前角色：' + save.name + ' Lv.' + save.level : '还没有角色：登录后创建',
        centerX,
        card.y + 134,
        20,
        '#e8f1ff',
        'center'
      );
      if (message) G.HUD.text(ctx, message, centerX, card.y + 168, 17, '#8ce99a', 'center');
    } else {
      G.HUD.text(ctx, '创建角色：给角色起个名字', centerX, card.y + 34, 24, '#ffd479', 'center');
      // 昵称框（矩形，和按钮同一套视觉；真正的文字来自平台键盘或随机词库）
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(card.x + 24, card.y + 84, card.w - 48, 74);
      ctx.strokeStyle = '#4d5f86';
      ctx.lineWidth = 2;
      ctx.strokeRect(card.x + 24, card.y + 84, card.w - 48, 74);
      G.HUD.text(ctx, name || '（空）', centerX, card.y + 121, 34, '#ffffff', 'center');
      G.HUD.text(
        ctx,
        '昵称 ' + BAL.account.nameMin + '~' + BAL.account.nameMax + ' 个字符，只能用中文 / 字母 / 数字 / 下划线',
        centerX,
        card.y + 176,
        16,
        '#9fb4d8',
        'center'
      );
      if (message) {
        G.HUD.text(ctx, message, centerX, card.y + 204, 17, message.indexOf('占用') >= 0 ? '#ff8a8a' : '#8ce99a', 'center');
      }
    }

    if (busy) G.HUD.text(ctx, '请稍候…', centerX, card.y + card.h + 28, 20, '#ffd479', 'center');

    var list = buttons();
    for (var i = 0; i < list.length; i += 1) painted(ctx, list[i], pressedId === list[i].id);

    G.HUD.text(ctx, '没有抖音环境时会自动使用本机离线账号，单机照样能玩', centerX, card.y + card.h + 72, 16, '#6d86b5', 'center');
  }

  return {
    open: open,
    stageId: stageId,
    draftName: draftName,
    setDraftName: setDraftName,
    randomName: randomName,
    setMessage: setMessage,
    setBusy: setBusy,
    setHasAccount: setHasAccount,
    isArmed: isArmed,
    rect: rect,
    buttons: buttons,
    press: press,
    release: release,
    draw: draw
  };
})();

