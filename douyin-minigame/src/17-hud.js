/**
 * 17-hud.js —— 吸顶 / 吸底 HUD（竖屏单手布局，01-game-design §2）
 *
 * 布局纪律：所有 y 坐标都由 `SCREEN.safeTop()` / `SCREEN.safeBottom()` 推出来，
 * 不写死数字 —— 长屏、刘海屏、手势条都能自动躲开。
 *
 * 画的东西（A4 重排，A7 换位）：
 *   吸顶左：**头像 + 角色名 + 等级**（用户要求"左上角添加玩家头像，角色名，等级"）
 *   吸顶中：玩家血条 + 金币 / 战力 / 难度带 / 自动战斗状态
 *   吸顶右：**小地图**（chunk 网格 + 小径 + 营地 + 地标 + 怪 + 公会锚点 + 玩家朝向；
 *     A11 起覆盖范围跟着视角档位走，并画出**视野框** = 主画面现在覆盖的那一块）
 *   吸底：**经验条**（用户要求"画面最下方添加经验条"）
 *   吸底上一行：**五个圆形功能键**「营 箱 包 会 设 自动」（带角标；自动是开关）
 *   吸底最下一行：**四个技能键**「斩 疗 刺 旋」（A7 起从这里下沉到最底，名字改画在圆上方；
 *     A10 起每个键的右上角挂一个「自动释放」勾选框 —— 勾上的才会被自动战斗放出去）
 *   左下：摇杆由 15-input 自己画
 *   **左边缘：一条侧边栏**（本次新增，用户："回到营地按钮设置在左边侧边栏，商城下面"）——
 *     竖着两枚圆键：「商」（商城）在上、「营」（回营地）在下，共用一个半透明底板；
 *     它不在吸底动作栏里，所以底部那两行的几何一点没动（见 sideButtons / sideBarRect）
 *   调试面板（可选）：FPS / chunk 数 / 活跃怪数 / 当前目标 / 世界种子 / 世界指纹
 *
 * 三个"必须记住"的点：
 *   1. **两行按钮 + 经验条**（A7）都是从 `expTop()` 往上推的：技能行贴底、功能行在它上面 ——
 *      行距只由 `hud.barGap / captionGap / rowGap` 与两个半径决定，改一处整条底栏自动让位；
 *   2. **功能键与面板卡片互不遮挡**：卡片右侧留了 `view.panel.rightReserve` 的位置，
 *      卡片底边落在 `bottomBarTop()` 之上（见 18-panels 的卡片几何）；
 *   3. 按钮的坐标就是命中测试的坐标（15-input 只认这一份），所以画法与判定不会各算一套。
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

  /** 吸顶区高度（头像那一块）：小地图与调试面板都从它往下排 */
  function plateHeight() {
    return SCREEN.safeTop() + 152;
  }

  /** 小地图左上角 y：吸顶条下面一点点，右侧留 margin */
  function minimapTop() {
    return SCREEN.safeTop() + 128;
  }

  /** 右侧留白（小地图 + 边距）：血条这类"横向要尽量宽"的元素别压到小地图上 */
  function rightReserve() {
    return BAL.view.minimap.size + BAL.view.minimap.margin * 2;
  }

  /**
   * 底部两行圆键的几何（A7）：全部从 `expTop()` 与 `view.hud/skillBar/functionBar` 推出来，
   * 一个硬编码数字都没有 —— 换屏幕、加安全区、改半径，整条底栏自己让位。
   */
  /** 经验条上沿 y：整条吸底动作栏都从它往上推（A7），不写死数字 */
  function expTop() {
    return SCREEN.height() - SCREEN.safeBottom() - BAL.view.hud.expBarHeight;
  }

  /** 一小块说明文字占的高度（字高 + 一点间距）：算两行按钮之间的行距用 */
  function captionBlock(size) {
    return BAL.view.hud.captionGap + size;
  }

  /**
   * 技能栏圆心 y（A7）：**贴屏幕最底** —— 圆的下沿离经验条只剩 `hud.barGap`。
   * 技能名因此改画在圆**上方**（名字块由 captionBlock 算进整条底栏的高度里）。
   */
  function skillRowY() {
    return expTop() - BAL.view.hud.barGap - BAL.view.skillBar.radius;
  }

  /**
   * 功能图标栏圆心 y（A7）：在技能栏整块（名字 + 圆）之上再空 `hud.rowGap` 排一行 ——
   * 它占的正是**技能原来那一行**：现在归功能键（箱 / 包 / 会 / 设 / 自动 + 营地里的「营」），
   * 技能下沉到最底（用户要求"技能放最底，原来技能的位置放背包 / 自动等图标"）。
   */
  function functionRowY() {
    var skills = BAL.view.skillBar;
    var hud = BAL.view.hud;
    var skillBlockTop = skillRowY() - skills.radius - captionBlock(skills.nameSize);
    return skillBlockTop - hud.rowGap - captionBlock(G.ICONS.size('captionSize')) - BAL.view.functionBar.radius;
  }

  /** 整条吸底动作栏的顶边：面板卡片落在它上面就不会被压住（自检也读它） */
  function bottomBarTop() {
    return functionRowY() - BAL.view.functionBar.radius;
  }

  /**
   * 技能栏（A5 起；A7 起**下沉到屏幕最底**）：四个圆键贴在**经验条正上方、靠屏幕右边**。
   * 每个键画圆 + 一个字（斩 / 疗 / 刺 / 旋），技能名画在圆**上面**（下面留给经验条）；冷却时压一层扇形暗罩并改显示剩余秒数；
   * 没到解锁等级的画成"锁 + Lv.n"。
   *
   * 与功能键的纪律完全一致：**坐标就是命中测试的坐标**（15-input 只认这一份），
   * 而锁定 / 冷却 / 剩余毫秒由 20-main 的 `skillView()` 提前算好传进来 ——
   * HUD 不认识 balance 里的技能表，它只认这份视图（界面层不读玩法数据，决策 #4）。
   *
   * A7：这一排上面那一行留给功能键（见 buttons），技能键整排靠屏幕右边（`view.skillBar.margin`）——
   * 于是左下角摇杆区（`input.zoneWidthRatio`）整块空地都还给走位；想让这一排居中，把 margin 改成
   * `(屏宽 − 整排宽) / 2` 就行（设计宽 720 下是 206）。
   */
  function skillButtons(view) {
    var config = BAL.view.skillBar;
    var skills = view && view.skills ? view.skills : null;
    var slots = skills && skills.slots ? skills.slots : [];
    if (!slots.length) return [];
    var radius = config.radius;
    var step = radius * 2 + config.gap;
    var rowWidth = slots.length * radius * 2 + (slots.length - 1) * config.gap;
    // 右贴边（留 skillBar.margin）：最后一个技能靠屏幕右边，第一个技能在它左边（读起来就是 1→4）
    var firstX = SCREEN.width() - config.margin - rowWidth + radius;
    var y = skillRowY();
    var auto = config.autoBox;
    var list = [];
    for (var i = 0; i < slots.length; i += 1) {
      var slot = slots[i];
      var x = firstX + i * step;
      list.push({
        id: 'skill' + slot.index,
        label: slot.key,
        name: slot.name,
        badge: 0,
        state: slot.state,
        lock: !slot.unlocked,
        cool: slot.cool,
        remainSec: slot.remainMs > 0 ? Math.ceil(slot.remainMs / 1000) : 0,
        unlockLevel: slot.unlockLevel,
        // A7：技能名画在圆**上面**（下面那一线留给吸底经验条）
        captionAbove: true,
        // A10：这个技能勾上"自动释放"了吗（来自 skillView，界面层不读存档里的设置表）
        auto: slot.auto !== false,
        // A10：右上角勾选框的几何（框心 + 边长）—— 画（drawButtons）与点（skillAutoButtons）
        // 用的是**同一份**，永远不会有"画在这儿、要点那儿"的老毛病
        autoBox: { x: x + radius * auto.offsetX, y: y - radius * auto.offsetY, size: auto.side },
        x: x,
        y: y,
        r: radius
      });
    }
    return list;
  }

  /**
   * A10：四个技能键右上角的「自动释放」勾选框（用户要求"给四个技能位置做一个是否自动释放的勾选位置"）。
   *
   * 它是一枚**独立的小方键**：几何直接取 `skillButtons` 里的 `autoBox`（一份出处），
   * 注册顺序排在技能键**前面** —— 15-input 的 `buttonAt` 取第一个命中的，于是方框永远优先于整个圆键，
   * 点框是切换自动、点圆是放技能，两者不会打架。
   */
  function skillAutoButtons(view) {
    var skills = skillButtons(view);
    var list = [];
    for (var i = 0; i < skills.length; i += 1) {
      var box = skills[i].autoBox;
      list.push({
        id: 'skillAuto' + i,
        label: '自动',
        name: skills[i].name,
        badge: 0,
        on: skills[i].auto === true,
        lock: skills[i].lock === true,
        /**
         * `kind: 'skillAuto'` 是给 `drawButtons` 看的**跳过标记**：这枚小方框只占按钮表里的一个命中位置，
         * 画法由技能键自己那一趟的 `drawAutoBox` 负责（同一份几何）——
         * 不标它，`drawButtons` 会顺手按"圆按钮"再画一遍（多一圈圆 + 一个图标 + 一行字，
         * 压到技能键上，还白花 ~29 次落笔；`tools\perf-frame.mjs` 就是这么发现的）。
         */
        kind: 'skillAuto',
        x: box.x,
        y: box.y,
        r: box.size / 2
      });
    }
    return list;
  }

  /**
   * A10：画一枚「自动释放」勾选框。亮的绿框 + 勾 = 会自动放；暗框 + 「自」= 不会自动放
   * （手动点那个技能键照样能放 —— 这是"勾选只作用在自动战斗"的视觉表达）。
   * 技能还没解锁时整块压淡，但**仍然可点**（提前把想自动放的技能勾好）。
   */
  function drawAutoBox(ctx, button) {
    var box = button.autoBox;
    var half = box.size / 2;
    var on = button.auto === true;
    var left = box.x - half;
    var top = box.y - half;
    ctx.globalAlpha = button.lock === true ? 0.5 : 0.96;
    ctx.fillStyle = on ? '#2f8a4f' : '#131a29';
    G.RENDER.roundRectPath(ctx, left, top, box.size, box.size, 8);
    ctx.fill();
    ctx.strokeStyle = on ? '#8ce99a' : '#4d5f86';
    ctx.lineWidth = 3;
    G.RENDER.roundRectPath(ctx, left, top, box.size, box.size, 8);
    ctx.stroke();
    if (on) {
      // 一个对勾：两笔直线（只用 moveTo/lineTo，假 canvas 也认）
      ctx.strokeStyle = '#eafff0';
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(box.x - half * 0.42, box.y + half * 0.04);
      ctx.lineTo(box.x - half * 0.1, box.y + half * 0.4);
      ctx.lineTo(box.x + half * 0.48, box.y - half * 0.44);
      ctx.stroke();
    } else {
      text(ctx, '自', box.x, box.y, Math.round(box.size * 0.56), '#6d86b5', 'center');
    }
    ctx.globalAlpha = 1;
  }

  /**
   * 左侧边栏（本次新增）—— 用户要求：**「回到营地按钮设置在左边侧边栏，商城下面」**。
   *
   * 一枚枚圆键竖着排、贴左边缘：上面那枚「商」（商城），它下面那枚「营」（回营地）。
   * 为什么单开一块而不是塞进功能栏：用户要的就是"侧边栏"—— 竖排、贴左边，
   * 与底部那一行是**两个区域**。它与功能键共用同一套画法与命中表（15-input 只认
   * `uiView().buttons` 这一份），所以"画在哪 / 点哪 / 判定哪"仍然只有一处。
   *
   * 三条几何纪律（数字全在 `view.sideBar`，改数值不用改代码）：
   *   1. **竖排的间距比功能栏大得多**（gap 58 对 20）：这里必须塞得下圆下方那行说明文字
   *      （`hud.captionGap` + `captionSize`），否则第二枚的圆会压到第一枚的字上；
   *   2. 第一枚的**上沿**与面板卡片顶边齐平（都从 `plateHeight()` 起算）；
   *   3. 整条栏在卡片**左边**：`view.panel.leftReserve` 让卡片右移这么多，于是
   *      面板打开时侧边栏既不会被盖住，也不会抢走卡片的触摸（20-main 的三层路由先给卡片）。
   */
  function sideButtons(view) {
    var config = BAL.view.sideBar;
    var save = view && view.save ? view.save : null;
    var defs = [
      // 商城（A15 起在底部功能栏；本次挪进侧边栏）：角标 = 手里的强化石 ——
      // 与「包」的装备数、「箱」的箱子数同一套读法
      { id: 'sideShop', label: '商城', iconKey: 'shop', badge: save && save.stones ? save.stones : 0, action: 'shop' },
      // 回营地（本次新增）：把玩家送回原点营地中心（冷却 / 战斗中禁用的规矩在 20-main 的 teleportCamp）
      { id: 'sideCamp', label: '回营地', iconKey: 'camp', badge: 0, action: 'camp' }
    ];
    var radius = config.radius;
    var step = radius * 2 + config.gap;
    var top = plateHeight() + config.top + radius;
    var list = [];
    for (var i = 0; i < defs.length; i += 1) {
      list.push({
        id: defs[i].id,
        /** 圆下面的说明（与功能键同一套画法：`hud.captionGap` 那一行） */
        label: defs[i].label,
        /** 图标按 iconKey 取（id 是 sideShop / sideCamp，图标仍是「商」「营」那两个） */
        iconKey: defs[i].iconKey,
        action: defs[i].action,
        badge: defs[i].badge,
        state: '',
        /** 标记：16-render / 预览与自检靠它把"侧边栏"和"底部功能栏"分开（画法与命中都不受影响） */
        kind: 'side',
        side: i + 1,
        x: config.left,
        y: top + i * step,
        r: radius
      });
    }
    return list;
  }

  /**
   * 侧边栏的底板：一枚圆一枚圆地悬在世界（或卡片旁边）上会像"两个迷路的按钮"，
   * 一条半透明的竖栏才读得出"这是一条侧边栏"。几何由第一枚与最后一枚键推出来，
   * **不写死数字** —— 自检与 tools\hud-preview.mjs 读的就是这一份。
   */
  function sideBarRect() {
    var list = sideButtons();
    if (!list.length) return null;
    var pad = BAL.view.sideBar.pad;
    var first = list[0];
    var last = list[list.length - 1];
    // 下沿要把最后一枚键的说明文字也算进去（否则那行字会悬在栏外）
    var bottom = last.y + last.r + captionBlock(G.ICONS.size('captionSize')) + pad;
    return {
      x: first.x - first.r - pad,
      y: first.y - first.r - pad,
      w: first.r * 2 + pad * 2,
      h: bottom - (first.y - first.r - pad)
    };
  }

  /**
   * 底部功能图标栏（A7）：**一行圆键**，槽位 0 是营 · 槽位 1..5 是 箱 / 包 / 会 / 设 / 自动
   * （营地槽在营地外留空）。它占的正是**技能原来那一行** —— 用户要求"把背包 / 自动攻击 / 菜单这些图标挪到技能原本的位置"。
   *
   * 槽位**固定**（`view.functionBar.slots`）：营地槽在外面就空着，不把其余键往中间挪 ——
   * 于是进出营地时键的坐标一个都不动，不会出现"刚出营地那一下点到了旁边那个键"。
   * A15 那枚「商」占的是 slot 6，**本次已挪到左边侧边栏**（见 sideButtons）——
   * 底部这一行因此只剩 5 个键（营地外）与 6 个键（营地里），坐标一个都没动，slot 6 空着。
   * `badge` 是右上角的小角标（宝箱数 / 背包装备数 / 有没有公会 / 手里几颗强化石），
   * `state` 只服务画法（'on' 时按钮点亮）。
   */
  function buttons(view) {
    var config = BAL.view.functionBar;
    var radius = config.radius;
    var save = view && view.save ? view.save : null;
    var auto = !!(save && save.settings && save.settings.autoBattle === true);
    var defs = [
      { id: 'chest', label: '箱', badge: save ? save.chests.length : 0 },
      { id: 'bag', label: '包', badge: save ? save.items.length : 0 },
      { id: 'guild', label: '会', badge: save && save.guild ? 1 : 0 },
      { id: 'menu', label: '设', badge: 0 },
      { id: 'auto', label: auto ? '自动' : '手动', badge: 0, state: auto ? 'on' : 'off' }
      // 「商」不再在这一行（本次新增：用户要求商城放进左边侧边栏的顶部，见 sideButtons）——
      // slot 6 因此空着，其余 5 个键的坐标一个都没动（slots 仍是 7，整排仍然居中）
    ];
    // 站在营地里才出现的「营」：营地的交互入口（治疗 / 商店 / 传送，A4）——
    // 它写死占**最左边那个槽位**（slot 0），所以其余键一个都不动
    if (view && view.inCamp) defs.push({ id: 'camp', label: '营', badge: 0, state: 'on', slot: 0 });

    var step = radius * 2 + config.gap;
    var rowWidth = config.slots * radius * 2 + (config.slots - 1) * config.gap;
    // 整行居中：槽位数固定，所以有没有「营」都压在同一个框里
    var firstX = (SCREEN.width() - rowWidth) / 2 + radius;
    var y = functionRowY();
    var list = [];
    for (var i = 0; i < defs.length; i += 1) {
      // 没写 slot 的按顺序从 1 往下排（0 号槽位留给「营」）
      var slot = defs[i].slot === undefined ? i + 1 : defs[i].slot;
      list.push({
        id: defs[i].id,
        label: defs[i].label,
        badge: defs[i].badge || 0,
        state: defs[i].state || '',
        x: firstX + slot * step,
        y: y,
        r: radius
      });
    }
    // 左侧边栏（本次新增）追加在**最后**：功能键的槽位、顺序、坐标一个都不动 ——
    // 自检与 tools\hud-preview.mjs 都在数这份表，追加最安全（预览里 `outside[0]` 仍是「箱」）
    var side = sideButtons(view);
    for (var s = 0; s < side.length; s += 1) list.push(side[s]);
    return list;
  }

  /**
   * 画按钮（按下时稍微放大 + 变色；自动战斗开着时按钮常亮，一眼看出当前模式）。
   * A5 起同一个循环还画技能键：`cool`（剩余比例）+ `remainSec`（读秒）+ `lock`（未解锁）——
   * 技能键的状态全部来自 skillView()，这里只负责把它画出来。
   * A7 起技能键的说明文字画在圆**上方**（`captionAbove`），功能键仍在圆下方。
   */
  function drawButtons(ctx, view) {
    var list = view && view.buttons ? view.buttons : [];
    var nowMs = view && view.now ? view.now : 0;
    /**
     * 左侧边栏的底板先画（本次新增）：它是一条半透明的竖栏，压在**世界与面板卡片之上**
     * （drawButtons 是最后一趟），而侧边栏本身在卡片左边（`view.panel.leftReserve`）——
     * 所以"栏盖住卡片"这件事不会发生，只是绘制顺序保证了它永远可见。
     */
    var hasSide = false;
    for (var k = 0; k < list.length; k += 1) {
      if (list[k].kind === 'side') {
        hasSide = true;
        break;
      }
    }
    if (hasSide) {
      var rail = sideBarRect();
      if (rail) {
        ctx.globalAlpha = 0.72;
        ctx.fillStyle = '#0e1526';
        G.RENDER.roundRectPath(ctx, rail.x, rail.y, rail.w, rail.h, 26);
        ctx.fill();
        ctx.strokeStyle = '#2b3a5c';
        ctx.lineWidth = 3;
        G.RENDER.roundRectPath(ctx, rail.x, rail.y, rail.w, rail.h, 26);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    for (var i = 0; i < list.length; i += 1) {
      var button = list[i];
      // A10：勾选框只在按钮表里占一个**命中位置**，画法由技能键那一趟的 drawAutoBox 负责 —— 这里跳过
      if (button.kind === 'skillAuto') continue;
      var pressed = G.INPUT.isPressed(button.id, nowMs);
      var locked = button.lock === true;
      var cooling = !locked && button.cool > 0;
      var lit = button.state === 'on' || button.state === 'ready' || pressed;
      ctx.globalAlpha = pressed ? 0.95 : lit ? 0.88 : 0.72;
      ctx.fillStyle = pressed ? '#ffd479' : locked ? '#141a26' : lit && !cooling ? '#2f6b46' : '#1b2438';
      ctx.beginPath();
      ctx.arc(button.x, button.y, button.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = pressed ? '#fff3d0' : locked ? '#38415a' : lit && !cooling ? '#8ce99a' : '#4d5f86';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(button.x, button.y, button.r, 0, Math.PI * 2);
      ctx.stroke();

      // A6：图标（每个键都有对应图形：箱 / 包 / 会 / 营 / 设 / 自动 + 斩 / 疗 / 刺 / 旋）
      // 本次新增：侧边栏的「商 / 营」按 `iconKey` 取图标（它们的 id 是 sideShop / sideCamp，
      // 图标仍是「商」「营」那两个 —— 16-icons 的 button() 认 id，所以在这里把 iconKey 递过去）
      G.ICONS.button(
        ctx,
        button.iconKey || button.id,
        button.x,
        button.y,
        button.id.indexOf('skill') === 0 ? button.r * 1.5 : G.ICONS.size('buttonSize'),
        locked ? '#38415a' : pressed ? '#241a05' : '#dce6ff'
      );

      // 冷却：从正上方顺时针压一层暗扇形（"还剩四成"一眼可见）—— 压在图标上，图标仍看得见
      if (cooling) {
        ctx.globalAlpha = 0.62;
        ctx.fillStyle = '#0b1020';
        ctx.beginPath();
        ctx.moveTo(button.x, button.y);
        ctx.arc(button.x, button.y, button.r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * button.cool);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // A10：技能键右上角的「自动释放」勾选框（压在冷却扇形之上，永远看得见、点得到）
      if (button.autoBox) drawAutoBox(ctx, button);

      if (locked) text(ctx, '锁', button.x, button.y + button.r * 0.5, 22, '#5c6b8a', 'center');
      else if (button.remainSec > 0) text(ctx, String(button.remainSec), button.x, button.y + button.r * 0.5, 24, '#ffffff', 'center');

      // 技能键：把「斩 / 疗 / 刺 / 旋」当左上角的小徽章（图标与键位字都要有）
      if (button.id.indexOf('skill') === 0 && !locked) {
        var chipX = button.x - button.r * 0.64;
        var chipY = button.y - button.r * 0.64;
        ctx.fillStyle = 'rgba(11,16,32,0.85)';
        ctx.beginPath();
        ctx.arc(chipX, chipY, 15, 0, Math.PI * 2);
        ctx.fill();
        text(ctx, button.label, chipX, chipY, 18, '#ffd479', 'center');
      }

      // 圆旁边一行说明：技能键写技能名（锁着写解锁等级），功能键写「箱 / 包 / 会 / 营 / 设 / 自动」。
      // A7 起技能键的说明画在圆**上方**（下面那一线留给吸底经验条）；间距统一用 `hud.captionGap`，
      // 与 `functionRowY()` 算行距时用的是同一个数 —— 改一处，两行都不会互相压。
      var caption = button.name ? (locked ? 'Lv.' + button.unlockLevel : button.name) : button.label;
      if (caption) {
        var captionSize = button.name ? BAL.view.skillBar.nameSize : G.ICONS.size('captionSize');
        var captionGap = BAL.view.hud.captionGap + captionSize * 0.5;
        text(
          ctx,
          caption,
          button.x,
          button.captionAbove ? button.y - button.r - captionGap : button.y + button.r + captionGap,
          captionSize,
          locked ? '#8d8d8d' : cooling ? '#9fb4d8' : '#e8f1ff',
          'center'
        );
      }

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
      '视角 ' + (view.zoom ? view.zoom.name + '（一屏 ' + view.zoom.tiles + ' 格 · 一格 ' + view.zoom.tileCssPx + ' CSS px · 宏观色格 ' + view.zoom.lodBlocks + ' 格）' : '—'),
      '怪物击杀 ' + view.save.stats.kills + '（精英 ' + view.save.stats.eliteKills + '）开箱 ' + view.save.stats.opened,
      '技能 ' + (view.lastSkill || '—') + ' 已放 ' + (view.save.stats.skillCasts || 0) + ' 次  解锁 ' + (view.skills ? view.skills.unlocked + '/' + view.skills.total : '—') + '  自动释放 ' + (view.skills && view.skills.autoCount !== undefined ? view.skills.autoCount + '/' + view.skills.total : '—'),
      '世界种子 ' + BAL.season.worldSeed + '  指纹 ' + (view.fingerprint || '—'),
      '触摸 ' + (G.PLAT.hasTt() ? 'tt' : '桩') + '  存档 ' + (view.saveOk ? '正常' : '未写入')
    ];
    var top = minimapTop() + BAL.view.minimap.size + 26;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(12, top - 12, SCREEN.width() - 24, lines.length * 30 + 24);
    for (var i = 0; i < lines.length; i += 1) {
      text(ctx, lines[i], 24, top + i * 30, 20, '#bfe0ff');
    }
  }

  /**
   * 小地图覆盖多少个 chunk（A11）：**跟着视角档位走，而且必须装得下整屏** ——
   * 半径 = ceil(max(视野宽, 视野高) / 2 / chunkSize)，于是远档 9、中档 5、近档 3。
   *
   * A8 时它是写死的 3：拉远到 128 格之后地图反而比屏幕小，"我在哪一块"就没法看了（那版记为待办）。
   * A11 修掉：屏幕多大，地图就多大 —— 小地图上的**视野框**（`minimapViewRect`）因此永远画得进框里，
   * 一眼看出"我屏幕上看到的，是地图上这一块"。
   * 代价很小：地图上多出来的只是网格线与路网的路径（都是**一次 stroke** 画完），
   * 怪点 / 地标仍然只来自已装载的 chunk。
   */
  function minimapRadius() {
    var rect = G.RENDER.viewRect({ x: 0, y: 0 });
    var need = (rect.width > rect.height ? rect.width : rect.height) / 2 / G.CHUNK.CHUNK_SIZE;
    var radius = Math.ceil(need);
    return radius >= 1 ? radius : 1;
  }

  /**
   * 小地图上的"视野框"（A11）：主画面现在覆盖的世界矩形 → 小地图坐标。
   * 画与自检读的是同一份 —— 于是"小地图上这一小格"和"我屏幕上看到的地"永远对得上。
   * 视野框以**相机**为中心（相机带前瞻偏移），而不是玩家 —— 这正是"镜头在看哪里"的答案。
   */
  function minimapViewRect(view) {
    var config = BAL.view.minimap;
    var size = config.size;
    var left = SCREEN.width() - size - config.margin;
    var top = minimapTop();
    var player = view.player;
    var camera = view.camera || player;
    var scale = size / (minimapRadius() * G.CHUNK.CHUNK_SIZE * 2);
    var rect = G.RENDER.viewRect(camera);
    return {
      x: left + size / 2 + (rect.minX - player.x) * scale,
      y: top + size / 2 + (rect.minY - player.y) * scale,
      w: rect.width * scale,
      h: rect.height * scale,
      worldW: rect.width,
      worldH: rect.height
    };
  }

  /**
   * 小地图（右上角）：附近 chunk 网格 + 小径路网 + 营地 + 地标 + 怪点 + 公会锚点 + 玩家朝向
   * + A11 的**视野框**。它是"地图设计"的呈现层 —— 玩家要能一眼看出"我在哪、路往哪边走、还有什么没去过"。
   * 路网用的是**和小地图外面同一份数据**（G.TERRAIN.roadsInRect），不另画一套。
   */
  function drawMinimap(ctx, view) {
    var config = BAL.view.minimap;
    var size = config.size;
    var left = SCREEN.width() - size - config.margin;
    var top = minimapTop();
    var player = view.player;
    var halfWorld = minimapRadius() * G.CHUNK.CHUNK_SIZE;
    var scale = size / (halfWorld * 2);
    var centerX = left + size / 2;
    var centerY = top + size / 2;
    var i;
    var point;

    function toMap(x, y) {
      return { x: centerX + (x - player.x) * scale, y: centerY + (y - player.y) * scale };
    }
    function insideMap(p) {
      return p.x >= left && p.x <= left + size && p.y >= top && p.y <= top + size;
    }

    ctx.save();
    ctx.globalAlpha = 0.62;
    ctx.fillStyle = '#101828';
    ctx.fillRect(left, top, size, size);
    ctx.globalAlpha = 1;

    // chunk 网格：按世界坐标对齐，跨 chunk 时格子不会"跟着玩家漂"
    ctx.strokeStyle = '#2c3a55';
    ctx.lineWidth = 1;
    ctx.beginPath();
    var firstX = Math.ceil((player.x - halfWorld) / G.CHUNK.CHUNK_SIZE) * G.CHUNK.CHUNK_SIZE;
    for (var gx = firstX; gx <= player.x + halfWorld; gx += G.CHUNK.CHUNK_SIZE) {
      var lineX = toMap(gx, player.y).x;
      ctx.moveTo(lineX, top);
      ctx.lineTo(lineX, top + size);
    }
    var firstY = Math.ceil((player.y - halfWorld) / G.CHUNK.CHUNK_SIZE) * G.CHUNK.CHUNK_SIZE;
    for (var gy = firstY; gy <= player.y + halfWorld; gy += G.CHUNK.CHUNK_SIZE) {
      var lineY = toMap(player.x, gy).y;
      ctx.moveTo(left, lineY);
      ctx.lineTo(left + size, lineY);
    }
    ctx.stroke();

    // 小径
    var segments = G.TERRAIN.roadsInRect(
      BAL.season.worldSeed,
      player.x - halfWorld,
      player.y - halfWorld,
      player.x + halfWorld,
      player.y + halfWorld
    );
    ctx.strokeStyle = '#8a7457';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (i = 0; i < segments.length; i += 1) {
      var a = toMap(segments[i].x1, segments[i].y1);
      var b = toMap(segments[i].x2, segments[i].y2);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();

    // 营地（原点）
    point = toMap(0, 0);
    if (insideMap(point)) {
      ctx.fillStyle = '#c9b08a';
      ctx.beginPath();
      ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    // 地标
    var landmarks = G.WORLD.landmarksInView();
    ctx.fillStyle = '#9ad4ff';
    for (i = 0; i < landmarks.length; i += 1) {
      point = toMap(landmarks[i].x, landmarks[i].y);
      if (!insideMap(point)) continue;
      ctx.fillRect(point.x - 2.5, point.y - 2.5, 5, 5);
    }

    // 怪（精英画大一点、金色）
    var monsters = G.WORLD.monstersInView();
    for (i = 0; i < monsters.length; i += 1) {
      point = toMap(monsters[i].x, monsters[i].y);
      if (!insideMap(point)) continue;
      ctx.fillStyle = monsters[i].elite ? '#ffd479' : '#ff8a8a';
      ctx.beginPath();
      ctx.arc(point.x, point.y, monsters[i].elite ? 3.4 : 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // 公会锚点（有公会才有）
    if (view.save && view.save.guild && view.save.guild.anchor) {
      point = toMap(view.save.guild.anchor.x, view.save.guild.anchor.y);
      if (insideMap(point)) {
        ctx.fillStyle = '#a9d5ff';
        ctx.beginPath();
        ctx.moveTo(point.x, point.y - 5);
        ctx.lineTo(point.x + 5, point.y);
        ctx.lineTo(point.x, point.y + 5);
        ctx.lineTo(point.x - 5, point.y);
        ctx.closePath();
        ctx.fill();
      }
    }

    // 视野框（A11）：主画面现在覆盖的范围。竖屏一屏很高（远档 128×277 格），所以这个框常常上下超出小地图 ——
    // 裁到地图里画（于是远档看到的是"我正在看这一竖条地"，近档看到的是一个小框）。
    // 与 minimapViewRect 同一份几何：画与自检不会各算一套。
    var frame = minimapViewRect(view);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(left, top);
    ctx.lineTo(left + size, top);
    ctx.lineTo(left + size, top + size);
    ctx.lineTo(left, top + size);
    ctx.closePath();
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,224,138,0.7)';
    ctx.lineWidth = 2;
    ctx.strokeRect(frame.x, frame.y, frame.w, frame.h);
    ctx.restore();

    // 玩家：一个朝向三角（朝向直接取 player.facing，不另算一套）
    var fx = player.facing.x;
    var fy = player.facing.y;
    var length = Math.sqrt(fx * fx + fy * fy);
    if (!(length > 0.0001)) {
      fx = 0;
      fy = 1;
      length = 1;
    }
    fx /= length;
    fy /= length;
    ctx.fillStyle = '#ffd479';
    ctx.beginPath();
    ctx.moveTo(centerX + fx * 9, centerY + fy * 9);
    ctx.lineTo(centerX - fx * 5 - fy * 5, centerY - fy * 5 + fx * 5);
    ctx.lineTo(centerX - fx * 5 + fy * 5, centerY - fy * 5 - fx * 5);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = '#4d5f86';
    ctx.lineWidth = 3;
    ctx.strokeRect(left, top, size, size);
    ctx.restore();
  }

  /**
   * 吸顶块：头像 + 角色名 + 等级 + 血条 + 一行状态。
   * 文字区宽度按 `rightReserve()` 扣掉右侧小地图，所以名字再长也撞不到地图。
   */
  function drawTop(ctx, view) {
    var width = SCREEN.width();
    var top = SCREEN.safeTop();
    var save = view.save;
    var stats = view.stats;
    var radius = BAL.view.hud.avatarRadius;
    var textLeft = 24 + radius * 2 + 18;
    var reserve = rightReserve();

    ctx.fillStyle = 'rgba(8,12,24,0.62)';
    ctx.fillRect(0, 0, width, plateHeight());

    // 头像（程序自绘；种子只跟角色名与等级有关 → 同一角色永远同一张脸）
    G.RENDER.drawAvatar(
      ctx,
      24 + radius,
      top + 46,
      radius,
      G.RNG.hash32(G.ACCOUNT.nameKey(save.name).length * 31, save.level | 0, 0x51a7c3)
    );

    // 角色名 + 等级
    text(ctx, save.name || '无名者', textLeft, top + 28, 32, '#ffffff');
    text(ctx, 'Lv.' + save.level, textLeft, top + 64, 26, '#ffd479');
    text(ctx, PROG.bandLabel(G.CHUNK.bandOf(view.player.x, view.player.y)), width - reserve, top + 64, 22, '#9fb4d8', 'right');

    // 血条（战斗反馈第一优先级）
    var hpRatio = stats.hpMax > 0 ? view.player.hp / stats.hpMax : 0;
    var barW = width - 48 - reserve;
    bar(ctx, 24, top + 92, barW, 24, hpRatio, view.player.dead ? '#6b6b6b' : '#e05c5c');
    text(
      ctx,
      (view.player.dead ? '复活中… ' : '生命 ') + Math.max(0, Math.round(view.player.hp)) + ' / ' + stats.hpMax,
      34,
      top + 104,
      18,
      '#ffecec'
    );

    // 第三行：金币 / 战力 / 自动战斗状态（一眼看出现在是手动还是自动）
    var auto = !!(save.settings && save.settings.autoBattle === true);
    text(
      ctx,
      '金币 ' + PROG.shortNumber(save.gold) + ' · 战力 ' + stats.power + ' · 自动战斗 ' + (auto ? '开' : '关'),
      24,
      top + 134,
      22,
      auto ? '#8ce99a' : '#f2e6c8'
    );
  }

  /** 吸底经验条：用户要求"画面最下方添加经验条"，所以它贴在最底（避开手势条） */
  function drawExpBar(ctx, view) {
    var save = view.save;
    var width = SCREEN.width();
    var height = BAL.view.hud.expBarHeight;
    var y = expTop();
    var need = PROG.xpToNext(save.level);
    bar(ctx, 0, y, width, height, need > 0 ? save.exp / need : 0, '#4f8fd8', 'rgba(8,12,24,0.72)');
    text(
      ctx,
      'Lv.' + save.level + ' 经验 ' + PROG.shortNumber(save.exp) + ' / ' + PROG.shortNumber(need),
      28,
      y + height / 2,
      16,
      '#e8f1ff',
      'left'
    );
  }

  /**
   * 主绘制：view 由 20-main 组装（玩家、属性、存档、FPS、目标…）。
   * **功能键不在这里画**（交给 `drawButtons`）：面板卡片只占约 2/3 屏高，底部整条动作栏仍露在外面，
   * 按钮要压在卡片之上继续可用，所以 20-main 的绘制顺序是 HUD → 面板 → 按钮。
   */
  function draw(ctx, view) {
    drawTop(ctx, view);
    drawExpBar(ctx, view);

    // 升级/掉落等闪光提示（压在吸顶块下面，不挤血条）
    if (view.flash && view.flash.until > view.now) {
      text(ctx, view.flash.text, SCREEN.centerX(), plateHeight() + 46, 38, '#ffe08a', 'center');
    }

    drawMinimap(ctx, view);
    if (view.debug) drawDebug(ctx, view);
  }

  return {
    buttons: buttons,
    sideButtons: sideButtons,
    sideBarRect: sideBarRect,
    skillButtons: skillButtons,
    skillAutoButtons: skillAutoButtons,
    expTop: expTop,
    skillRowY: skillRowY,
    functionRowY: functionRowY,
    bottomBarTop: bottomBarTop,
    draw: draw,
    drawTop: drawTop,
    drawExpBar: drawExpBar,
    drawButtons: drawButtons,
    drawMinimap: drawMinimap,
    minimapRadius: minimapRadius,
    minimapViewRect: minimapViewRect,
    plateHeight: plateHeight,
    minimapTop: minimapTop,
    bar: bar,
    text: text
  };
})();
