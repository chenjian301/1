/**
 * 18-panels.js —— 全屏自绘面板：开箱 / 背包与装备 / 商城 / 公会 / 设置 / 自检结果
 *
 * 小游戏没有 DOM，所以面板也是 canvas 画的（01-game-design §2 的最后一条）。
 * 这里刻意做得很"平"：一屏 = 标题 + 若干行 + 底部返回键。行可点（矩形命中），
 * 按钮是圆的（沿用"先用圆形代替外观"的阶段约定）。
 *
 * 与输入层的关系：面板自己吃触摸（press / release 返回一个 action），
 * 20-main 负责执行 action —— 面板不直接改存档，这样以后把这些操作搬到服务端校验时，
 * 只需要换掉执行者，界面一行都不用改。
 *
 * action 清单（都由 20-main 处理）：
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

  function open(panel) {
    current = panel;
    pressedRowId = null;
    if (panel === 'guild' && !draftGuildName) draftGuildName = nextGuildName(0);
  }

  function close() {
    current = null;
    pressedRowId = null;
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

  /** 面板底部的返回键（圆形，与 HUD 的按钮同一套命中逻辑） */
  function buttons() {
    if (!current) return [];
    var radius = 44;
    return [
      {
        id: 'panel:close',
        label: '返',
        badge: 0,
        x: 24 + radius,
        y: SCREEN.height() - SCREEN.safeBottom() - radius,
        r: radius
      }
    ];
  }

  /**
   * 行布局：标题下方开始，每行高固定 84（行高固定，命中测试才好写）。
   * 返回 [{ id, y, h, text, sub, color, action }]
   */
  function rows(view) {
    var list = [];
    if (!current) return list;
    var top = SCREEN.safeTop() + 150;
    var rowH = 84;
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

    if (current === 'menu') {
      list.push({
        id: 'menu:selftest',
        y: top,
        h: rowH,
        text: '立即跑自检',
        sub: '地图确定性 / 伤害 / 掉箱 / 装备 / 升级曲线，几十项断言当场出结果',
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
        id: 'menu:reset',
        y: top + rowH * 3,
        h: rowH,
        text: '重置本地存档',
        sub: view.resetArmed ? '再点一次真的删（等级 / 装备 / 宝箱全清）' : '点一下先确认',
        color: view.resetArmed ? '#ff8a8a' : '#c7c7c7',
        action: { type: 'resetSave' }
      });
    }

    return list;
  }

  /**
   * 按下：记住命中的那一行（松手时才算点击，中途滑走就取消 —— 这是"误触保护"的最低成本做法）。
   * 行是整条横向带子（面板是全屏覆盖层），所以只判 y。
   */
  function press(point, view) {
    if (!current) return null;
    var list = rows(view);
    for (var i = 0; i < list.length; i += 1) {
      var row = list[i];
      if (point.y >= row.y - 8 && point.y <= row.y + row.h + 8) {
        pressedRowId = row.id;
        return row.id;
      }
    }
    pressedRowId = null;
    return null;
  }

  /** 松手：同一个 id 上松手才算点击，返回该行的 action（null = 没点中） */
  function release(point, view) {
    if (!current) return null;
    var list = rows(view);
    for (var i = 0; i < list.length; i += 1) {
      var row = list[i];
      var hit = point.y >= row.y - 8 && point.y <= row.y + row.h + 8;
      if (hit && pressedRowId === row.id) {
        pressedRowId = null;
        return row.action;
      }
    }
    pressedRowId = null;
    return null;
  }

  /** 标题下面的一行小字：让玩家知道自己在哪个面板、身上有多少钱 */
  function headerLine(view) {
    return 'Lv.' + view.save.level + ' · 金币 ' + view.save.gold + ' · 战力 ' + view.stats.power + ' · 宝箱 ' + view.save.chests.length;
  }

  /** 面板主绘制：半透明底 + 标题 + 行 + 返回键 + （自检面板）结果滚动区 */
  function draw(ctx, view) {
    if (!current) return;
    var width = SCREEN.width();
    var top = SCREEN.safeTop();
    var nowMs = view.now || 0;

    ctx.fillStyle = 'rgba(6,10,20,0.88)';
    ctx.fillRect(0, 0, width, SCREEN.height());

    var titles = {
      chest: '开箱',
      bag: '背包 / 装备',
      shop: '商城',
      guild: '公会',
      menu: '设置 / 调试',
      selftest: '自检结果'
    };
    G.HUD.text(ctx, titles[current] || current, SCREEN.centerX(), top + 52, 42, '#ffd479', 'center');
    G.HUD.text(ctx, headerLine(view), SCREEN.centerX(), top + 100, 24, '#9fb4d8', 'center');

    var list = rows(view);
    for (var i = 0; i < list.length; i += 1) {
      var row = list[i];
      var pressed = pressedRowId === row.id;
      ctx.fillStyle = pressed ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.05)';
      ctx.fillRect(16, row.y, width - 32, row.h - 10);
      G.HUD.text(ctx, row.text, 32, row.y + (row.sub ? 26 : (row.h - 10) / 2), 28, row.color, 'left');
      if (row.sub) G.HUD.text(ctx, row.sub, 32, row.y + 56, 20, '#9fb4d8', 'left');
      if (!row.action) {
        // 不可点的行给个视觉标记，免得玩家一直点它
        ctx.globalAlpha = 0.5;
        G.HUD.text(ctx, '（说明）', width - 32, row.y + (row.h - 10) / 2, 20, '#8d9bb5', 'right');
        ctx.globalAlpha = 1;
      }
    }

    if (current === 'selftest' && view.selftest) {
      var lines = view.selftest.lines || [];
      var height = SCREEN.height() - (top + 180) - SCREEN.safeBottom() - 120;
      var maxLines = Math.max(4, Math.floor(height / 26));
      var start = Math.max(0, lines.length - maxLines);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(16, top + 180, width - 32, height);
      for (var k = start; k < lines.length; k += 1) {
        var line = lines[k];
        var color = line.indexOf('FAIL') >= 0 ? '#ff8a8a' : '#bfe0ff';
        G.HUD.text(ctx, line, 28, top + 200 + (k - start) * 26, 18, color, 'left');
      }
      G.HUD.text(
        ctx,
        view.selftest.checks + ' 项 · 失败 ' + view.selftest.failures + ' · 指纹 ' + view.selftest.fingerprint,
        28,
        top + 180 + height + 22,
        20,
        view.selftest.failures === 0 ? '#8ce99a' : '#ff8a8a',
        'left'
      );
    }

    if (current === 'menu' && view.cloud) {
      G.HUD.text(ctx, view.cloud, SCREEN.centerX(), SCREEN.height() - SCREEN.safeBottom() - 130, 20, '#9fb4d8', 'center');
    }

    var buttons = buttons();
    for (var b = 0; b < buttons.length; b += 1) {
      var button = buttons[b];
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = '#1b2438';
      ctx.beginPath();
      ctx.arc(button.x, button.y, button.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#4d5f86';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(button.x, button.y, button.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      G.HUD.text(ctx, button.label, button.x, button.y, 32, '#dce6ff', 'center');
    }
  }

  return {
    open: open,
    close: close,
    isOpen: isOpen,
    panelId: panelId,
    buttons: buttons,
    rows: rows,
    press: press,
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
