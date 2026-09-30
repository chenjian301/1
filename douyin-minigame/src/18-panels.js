/**
 * 18-panels.js —— 自绘面板（开箱 / 背包 / 商城 / 公会 / 营地 / 强化 / 属性 / 设置 / 自检）+ 标题与创建角色界面
 *
 * 小游戏没有 DOM，所以界面也是 canvas 画的（01-game-design §2 的最后一条）。
 *
 * **A4 的三处改动（都是用户直接提的需求）**：
 *   1. **只占一部分屏**：面板从"全屏覆盖"改成一张卡片
 *      （宽 = 屏宽 − leftMargin − rightReserve，高 = 屏高 × heightRatio，见 balance.view.panel）。
 *      A4 是"约 1/3 屏"（heightRatio 0.42），**2026-10-01 用户改成"约 2/3 屏高"（0.66）** ——
 *      为的是少滚：背包内容约 1492 设计 px，视口从 ~580 变成 ~964；
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
 *   { type: 'open', panel }        切换面板（'chest' | 'bag' | 'shop' | 'guild' | 'camp' | 'enhance' | 'stat' | 'menu' | 'selftest'）
 *   { type: 'openChest', count }   开箱（真正的抽奖在 20-main：那里才动保底计数）
 *   { type: 'openChestTier', tier } 开掉**这一阶**的箱子（A14：宝箱清单每行右侧那枚「全开」）
 *   { type: 'toggleChestAuto', tier } 切换这一阶的「自动开启」（A14：勾上 = 掉出来就当场开）
 *   { type: 'equip', itemId }      穿上背包里的某件装备
 *   { type: 'unequip', slotId }    脱下某个部位
 *   { type: 'skillAuto', index }   切换第 index 个技能的「自动释放」勾选（A10）
 *   { type: 'setZoomTiles', tiles } 把视角缩放到"一屏 tiles 格"（设置面板里那一行滚动轴，A11 之二）
 *   { type: 'salvageAll' }         一键分解（只留比身上强的）
 *   { type: 'buyHorn' }            买号角（500 金币，20 级解锁）
 *   { type: 'buyStone' }           买强化石（100 金币一颗，本次新增）
 *   { type: 'enhance', slotId }    铁匠强化**已穿的那一件**（本次新增：扣强化石 → 09-equipment 的 applyEnhance）
 *   { type: 'createGuild' }        建公会（消耗一个号角；名字非法 / 没号角会被 20-main 拦下）
 *   { type: 'typeGuildName' }      调平台键盘输入公会名（本次新增：建会必须自己取名字）
 *   { type: 'renameGuild' }        随机取一个公会名（键盘不可用时的兜底输入方式）
 *   { type: 'typeJoinName' }       调平台键盘输入"要加入的公会名"（本次新增）
 *   { type: 'joinGuild', name? }   加入公会（不给 name 就用那一行的草稿；给了 name 就是列表里点的那一行）
 *   { type: 'guildSync' }          向服务端要一份最新成员表（本次新增）
 *   { type: 'guildList' }          向服务端要一份公会列表（本次新增）
 *   { type: 'guildLeave' }         退出公会（会长不能退，本次新增）
 *   { type: 'teleportGuild' }      回到公会锚点（冷却 + 战斗中禁用）
 *   { type: 'selftest' }  { type: 'cloudPing' }  { type: 'toggleDebug' }  { type: 'resetSave' }
 *
 * **A10（用户：把背包 / 宝箱 / 属性的 UI 做得更好看一些，模仿参考图）**：三个面板从"一列一列的字"
 * 重排成**版面**，但复用同一条命中链与滚动链 —— 每一块仍然是一个行对象，只是 `kind` 不同、
 * 由 `PAINTERS` 分派画法：
 *   背包：角色预览（四角四个装备槽，点一下脱）→ 技能自动释放条（点一下切换）→ 三排背包格（点一下穿；
 *        本次新增：拖格子可以**翻页**看后面的装备，见文件末的「本次新增」一段）
 *        → 属性网格（2 列，图标 + 名称 + 数值）；
 *   宝箱：两个大按钮（开 1 / 开 10）→ 两条保底进度条 → 六阶宝箱清单（一阶一行：阶名 + × 数量 + 掉落占比）；
 *   属性：头像抬头（等级 / 经验条 / 战力）+ 一行一张的属性卡（图标 + 数值 + 基础与装备的拆分）。
 * 版面尺寸全在 `balance.view.panel.layout`；`hit: false` 的行（大块背景 / 小标题 / 进度条）不吃触摸，
 * 于是"背景块排在前、可点的格子排在后"也能各画各的、各点各的。
 *
 * **A11 之二（用户："玩家设置中添加视角缩放滚动轴，可以缩到16-64"）**：设置面板里多了一个
 * `kind: 'slider'` 的行 —— 它是面板里唯一"拖"出来的控件：
 *   1. 按下的那一下就跳到手指位置（滑块的标准手感），**拖动时不吃滚动**（卡片内容不会跟着跑）；
 *   2. 拖动过程中由 20-main 每帧问一次 `sliderDrag()`，世界**边拖边缩放**（静默，不写存储）；
 *   3. 松手才产出一个 action（`{ type: 'setZoomTiles', tiles }`）→ 提示 + 落盘。
 * 范围与画法规格全在 `balance.view.zoomSlider`（16 ~ 64 格 / 轨道高 / 圆钮半径 / 两端余量）。
 *
 * **A12（用户：给不同等阶的装备添加发光颜色，分别为白色，蓝色，紫色，金色，红色，炫彩）**：
 * 面板里每一处「装备格」都多了一层阶的发光 —— 颜色在 `balance.equipment.tiers[].glow`，
 * 画法在 16-icons 的 `glowRing` / `heroGlow`，这里只负责**把时间基准（世界时钟）与阶号递下去**：
 *   1. 背包格 / 四角装备槽 / 宝箱清单的行图标 / 行图标：`frame(..., glowPhase())`，空位与等级不够的（`dim`）不发光；
 *   2. 宝箱清单每行左边那口阶色小箱：它走的就是 `frame`，于是六阶的发光色在清单上一行一个；
 *   3. 角色预览：`heroGlow` 在人物之前画一束光，颜色取身上**最高那一阶**（光身板就没有这一束）。
 *
 * **A13（用户："宝箱背包不需要格子，直接放不同等阶宝箱×数量"）**：宝箱面板撤掉**箱子格**与**六阶图例**，
 * 换成**六阶宝箱清单** —— 一阶一行、恒六行：左边一口阶色小箱（顺手带上 A12 的发光）+ 阶名 +
 * 右边「× 数量」+ 一行掉落占比（仍然是按权重算出来的）。数量由 08-loot 的 `countByTier` 数出来，
 * **没有的阶也占一行**（压淡写 × 0），于是"还缺哪一阶"一眼看得出来，也不再需要"只列出前 12 个"那种截断。
 * 清单**行身**仍然是只读的（`hit: false`）：袋子里的箱子按掉落顺序排，点"传说"那一行开出来的却可能是别的阶，
 * 所以"按阶开箱"不靠点行身，而是靠 A14 给每一行配的那枚**显式按钮**（见下）。
 *
 * **A14（用户："宝箱可以设置是否自动开启——对应不同等阶不同的开启按钮"）**：清单每一行右侧多两枚
 * **按阶的控件**（行身照旧 `hit: false`，点那一行的字上什么都不发生）：
 *   1. `chest:tierOpen:<阶>` —— 一枚**阶色**的「全开」小按钮：点一下把**这一阶**的箱子全开掉
 *      （action `{ type: 'openChestTier', tier }` → 20-main 的 `openChestsOfTier`）。这一阶一口
 *      箱子也没有时整块压淡、并且**不产出 action**（同背包里空位的纪律：点了没反应，也不会误开别的阶）；
 *   2. `chest:tierAuto:<阶>` —— 一枚「自动」勾选（画法与技能条上那一枚一样）：勾上 = 这一阶一掉出来
 *      就当场开（存 `settings.chestAuto`，action `{ type: 'toggleChestAuto', tier }`）。勾选**恒可点**：
 *      先勾上、之后掉出来就自动开，所以"这一阶现在 0 口箱子"照样能勾。
 * 两枚控件都**长在清单那一行的行带里**（尺寸在 `balance.view.panel.layout`：`chestOpenWidth /
 * chestOpenHeight / chestAutoSide / chestControlGap`），于是清单还是恒六行、宝箱面板还是不用滚；
 * "× 数量"因此往左让出位置 —— 它的右边界 = 勾选框左边界 - 12（`tierControls` 一处算出来，画与点共用）。
 *
 * **本次新增（用户：背包要能滚动查看所有装备 + 商城里加可购买物品 + 营地里加铁匠NPC）**：
 *   1. **背包分页**（`bagRow` = 当前页第一行在全部装备里的行号）：三排格子从原先的
 *      「只列前 15 件」变成**一页 15 件、拖格子上下翻页**。可拖的那块是**格子那一整块**
 *      （`bagGridRect`，含空框区域），卡片其余部分照旧往下滚卡片 —— 两种手势互不吃：
 *      按在格子上拖 = 翻页，按在别处拖 = 滚卡片。页数写在标题右侧（`第 1-3 / 共 5 页`），
 *      页码夹在 [0, maxRow]（到底 / 到顶就不动了）。写法与 A11 之二的缩放轴同源
 *      （按下记状态 → move 改状态 → 松手收尾），只是改的是页码而不是世界倍率；
 *      而且**拖动过就不触发那一行的 action**（手指滑过一格不该把装备穿上）。
 *   2. **商城的第二件货**：强化石（100 金币一颗，`balance.shop.stone`）—— 与号角同一套买法；
 *   3. **强化面板**（`current === 'enhance'`，营地铁匠 / 营地面板 / 那枚「锻」圆键都进这里）：
 *      四个已穿部位各一行（装备内观图标 + 当前强化等级 + 下一级要几颗石头 + 强化后的战力），
 *      点一行 = 强化一次；末尾一行直接跳去商城买石头。数值规则全在 09-equipment
 *      （`enhanceCost` 每级翻倍、`applyEnhance` 是唯一改等级的地方），这里只把它排成行。
 *
 * **本次新增之二（用户："创建公会需要自己输入公会名，公会页面显示公会人员，公会等级，公会信息"）**：
 *   1. **公会名是打出来的**：面板上多了一行「公会名：…」（点它 → 20-main 调平台键盘 `PLAT.editText`），
 *      草稿 `draftGuildName` 存在本文件；不再有"打开面板就自动填一个名字"这件事。
 *      模拟器里没有 `tt.showKeyboard`，所以「随机取一个名字」那一行留着当兜底
 *      （与登录页的「换一个随机昵称」同一条思路）；
 *   2. **公会面板重排**：没有公会时 = 输入名 → 创建（另有随机名）+ 加入（输入名 / 服务端列表里点一行）；
 *      有公会时 = 公会等级（含升级进度）+ 公会信息（会长 / 我的身份 / 人数 / 锚点 / 最近同步）+
 *      **公会人员**（一行一个人：会长第一、在线优先、自己带 `（我）`）+ 回锚点 / 刷新成员 / 退会。
 *      等级与成员表的**规则**在 11-save 的 `G.GUILD`，**权威**在服务端（`/api/guild/*`）；
 *   3. **卡片左边让位**（`view.panel.leftReserve`）：左边缘那条**左侧边栏**（17-hud 的 sideButtons）
 *      必须永远露在卡片外 —— 20-main 的触摸路由是"卡片优先"，被盖住就等于点不到。
 */

G.PANELS = (function () {
  'use strict';

  var BAL = G.BAL;
  var SCREEN = G.SCREEN;
  var EQUIP = G.EQUIP;
  var PROG = G.PROG;
  /** 公会的规则与记录（本次新增）：名字合不合法、等级怎么算都在 11-save 的 G.GUILD 里 */
  var GUILD = G.GUILD;

  var current = null;
  var pressedRowId = null;

  /** 滚动与拖动状态：`scroll` 是内容相对视口向下滚过的距离（只增不减的纯数字，能断言） */
  var scroll = 0;
  var pressY = 0;
  var pressScroll = 0;
  var dragging = false;
  var pressedClose = false;

  /**
   * 视角缩放轴的拖动状态（A11 之二）：`sliderRow` = 手指正按住的那一行（松手 / 关面板时清空），
   * `sliderTiles` = 已经拖到的格数。画的时候读它（圆钮跟着手指走），20-main 每帧也读它（世界实时缩放）。
   */
  var sliderRow = null;
  var sliderTiles = 0;

  /**
   * 背包分页状态（本次新增）：`bagRow` = 当前这一页的**第一行**在全部装备里的行号
   * （0 = 第一页；一页 = `gridRows` 行 × `gridColumns` 列 = 15 件）。
   * `bagMaxRow` / `bagGridRect` 由 buildRows 每次重算 —— 画、命中测试、翻页读的都是同一份，
   * 不会出现「画的是第二页、点的是第一页」。`bagDrag` = 手指正按在格子上拖的那一笔
   * （松手 / 关面板时清空；不是 null 就说明这一笔手势归"翻页"，卡片不跟着滚）。
   */
  var bagRow = 0;
  var bagMaxRow = 0;
  var bagGridRect = null;
  var bagDrag = null;

  /** 随机会名用的词（键盘不可用时的兜底：模拟器里没有 tt.showKeyboard，也得能建会） */
  var GUILD_A = ['铁血', '荒野', '星火', '长风', '夜航', '荒原', '钢齿', '灰烬'];
  var GUILD_B = ['兄弟会', '远征团', '守望者', '拾荒团', '游猎帮', '商队', '联盟'];

  /**
   * 公会名草稿（本次新增：用户要求**自己输入**公会名）：小游戏里没有 `<input>`，打字只能靠平台键盘 ——
   * 由 20-main 的 `typeGuildName` 调 `PLAT.editText`，回来的值通过 `setDraftGuildName` 落在这里。
   * 为什么草稿放在面板模块里：输入行与「创建公会」按钮都在面板上，值跟着面板走最自然；
   * 而"这个字能不能用"只认 `G.GUILD.validate`，所以校验不在这里重复一遍。
   * `joinDraftName` 是**加入**那一行用的名字（与创建分开存，免得上一次的输入串到另一件事上）。
   */
  var draftGuildName = '';
  var joinDraftName = '';

  /**
   * 用世界时间做种子生成会名（本工程只允许 G.RNG 出随机，不许 Math.random）。
   * 本次改动：它不再是**默认值**，只在玩家点「随机取一个名字」时用（用户要求自己输入公会名）。
   */
  function nextGuildName(salt) {
    var rng = new G.RNG.Rng(G.RNG.hash32((G.WORLD.now() | 0) + (salt | 0), 0x6d17, 0x3c1f));
    var a = GUILD_A[rng.int(0, GUILD_A.length - 1)];
    var b = GUILD_B[rng.int(0, GUILD_B.length - 1)];
    return a + b;
  }

  /**
   * "多久以前"（公会那一块的时间戳用）：**只吃世界时间** ——
   * `guild.syncAt` / `listAt` 都是 20-main 用 `WORLD.now()` 写进去的，和 `view.now` 同一把尺子。
   * （服务端给的 createdAt 是真实 epoch，跟虚拟世界时钟不同源，所以界面上一律不显示它。）
   */
  function agoText(stampMs, view) {
    var now = view && view.now ? view.now : G.WORLD.now();
    var diff = now - stampMs;
    if (!(stampMs > 0)) return '还没同步过';
    if (!(diff > 0)) return '刚刚';
    if (diff < 60000) return Math.round(diff / 1000) + ' 秒前';
    if (diff < 3600000) return Math.round(diff / 60000) + ' 分钟前';
    return Math.round(diff / 3600000) + ' 小时前';
  }

  /* ------------------------------------------------------------- 卡片几何 */

  /**
   * 面板卡片：**A4 是"约 1/3 屏"，2026-10-01 用户改成"约 2/3 屏高"**（用户当初的原话是
   * "ui 不要铺满屏幕，只要占三分之一大小"；后来在 `tools\hud-preview.html` 里把 heightRatio
   * 从 0.42 拖到 0.66 —— 目的很直白：背包内容约 1492 设计 px，卡片高一点就少滚一截）。
   *   width  = 屏宽 − leftMargin − leftReserve − rightReserve
   *            （右边留给右下功能键，**左边留给左侧边栏** —— 本次新增：
   *             20-main 的触摸路由是"卡片优先"，卡片盖住侧边栏就等于那两枚键点不到，
   *             所以卡片整体右移 `leftReserve`，侧边栏永远露在卡片外；自检盯着这条缝）
   *   height = 屏高 × heightRatio （0.66 时 ≈ 90% 宽 × 66% 高 ≈ 59% 屏面积）
   *   位置   = 左贴 margin、上边贴在吸顶块下方（底边仍然压在整条吸底动作栏之上：自检盯着这一条，
   *            实测 1284 <= 1304 设计单位 —— 卡片再高一点就要压到功能键了）
   * 所有数字都在 balance.view.panel，改数值不用改代码。
   */
  function rect() {
    var config = BAL.view.panel;
    var left = config.leftMargin + config.leftReserve;
    var width = SCREEN.width() - left - config.rightReserve;
    var height = SCREEN.height() * config.heightRatio;
    return { x: left, y: G.HUD.plateHeight() + 18, w: width, h: height };
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

  /**
   * 背包分页的当前状态（本次新增）：自检与工具读它 —— 返回的是**最近一次 buildRows** 算出来的那一份
   * （画、命中、翻页共用同一份），所以断言里看到的页码就是屏幕上那一页。
   */
  function bagScroll() {
    return {
      row: bagRow,
      maxRow: bagMaxRow,
      columns: layout().gridColumns,
      visibleRows: layout().gridRows,
      gridRect: bagGridRect
    };
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
    sliderRow = null;
    sliderTiles = 0;
    // 背包分页（本次新增）：每次打开都回到第一页 —— 面板一关一开，玩家要看到的是"最新的装备"
    bagRow = 0;
    bagDrag = null;
    bagGridRect = null;
    // 公会名草稿**不预填**（本次改动：用户要求"创建公会需要自己输入公会名"）——
    // 打开面板时它是什么就是什么：空着就如实写"还没输入"，点「创建公会」会被拦下来
    // （20-main 的 createGuild 再判一次；随机名只在玩家主动点「随机取一个名字」时进来）。
  }

  function close() {
    current = null;
    pressedRowId = null;
    scroll = 0;
    dragging = false;
    pressedClose = false;
    sliderRow = null;
    sliderTiles = 0;
    bagDrag = null;
  }

  function isOpen() {
    return current !== null;
  }

  function panelId() {
    return current;
  }

  /**
   * 发光的时间基准（A12：装备等阶的发光）：取**世界时钟** —— 跟着游戏一起走、一起停，
   * 而且不碰 Date.now（那是 12-platform / 20-main 的活）。呼吸与炫彩流动都读它，
   * 同一个数也进自检（16-icons 的 glowPulse / glowColorAt 是纯函数，可以逐点断言）。
   */
  function glowPhase() {
    return G.WORLD.now();
  }

  /** 阶色只有一份：16-icons 的 TIER_COLORS（这里只转发，免得两处各写一套颜色） */
  function tierColor(tier) {
    return G.ICONS.tierColor(tier);
  }

  /**
   * 六阶宝箱清单（A13，用户："宝箱背包不需要格子，直接放不同等阶宝箱×数量"）：
   * 一阶一行 —— 阶号 + 阶名 + 阶色 + **× 数量** + 掉落占比。
   * 数量由 `LOOT.countByTier` 从存档里数（袋子空了就全是 0，清单照样六行）；
   * 占比**按 balance.chests.tiers 的权重算出来**，不是写死的文案 ——
   * 改权重清单自己跟着变，不会出现"面板上写的和抽奖表不一致"。
   */
  function chestSummary(chests) {
    var tiers = BAL.chests.tiers;
    var counts = G.LOOT.countByTier(chests);
    var total = 0;
    var i;
    for (i = 0; i < tiers.length; i += 1) total += tiers[i].weight;
    var list = [];
    for (i = 0; i < tiers.length; i += 1) {
      var share = total > 0 ? (tiers[i].weight / total) * 100 : 0;
      list.push({
        tier: tiers[i].id,
        name: tiers[i].name,
        color: tierColor(tiers[i].id),
        count: counts[i] || 0,
        share: share,
        text: '掉落 ' + (share >= 1 ? share.toFixed(1) : share.toFixed(2)) + '%'
      });
    }
    return list;
  }

  /**
   * 行左侧的图标盒（A6）：阶色边框 + 装备内观 / 部位剪影 / 功能图形。
   * 返回文字应该从哪个 x 开始 —— 于是"有图标就右移"只用一处代码管住所有面板。
   */
  function iconBox(ctx, area, row) {
    var size = row.icon.size || G.ICONS.size('rowSize');
    var x = area.x + 16;
    var y = row.y + ((row.h - 10) - size) / 2;
    var icon = row.icon;
    var gear = icon.kind === 'gear';
    // dim = 没有货：空位 / 等级不够（gear 那一条），或 A13 宝箱清单里"这一阶 0 口箱子"（icon.dim）
    // —— 两种都只描阶色、不发光（A12 的纪律：发光是"有货"的标记）
    var dim = icon.dim === true || (gear && !icon.look);
    G.ICONS.frame(ctx, x, y, size, icon.tier, dim, glowPhase());
    if (gear) {
      if (icon.look) G.ICONS.item(ctx, icon.look, x + size / 2, y + size / 2, size * 0.92);
      else G.ICONS.slotPlaceholder(ctx, icon.slot, x + size / 2, y + size / 2, size * 0.92);
    } else {
      G.ICONS.button(ctx, icon.key, x + size / 2, y + size / 2, size * 0.8, '#dce6ff');
    }
    return x + size;
  }

  /* ------------------------------------------------ A10 版面（尺寸全在 balance） */

  /** 面板内的版面尺寸（A10）：数字只在 `balance.view.panel.layout` 一处，代码只读它 */
  function layout() {
    return BAL.view.panel.layout;
  }

  /** 内容区的默认横向范围：行铺满整宽，格子自己给 x / w */
  function contentRect() {
    var area = viewport();
    return { x: area.x + 10, w: area.w - 20 };
  }

  /** 分区小标题（左标题 + 右说明），`hit: false` —— 它只是"这块讲什么"的路牌 */
  function pushTitle(list, box, y, text, sub) {
    list.push({
      id: 'title:' + text,
      kind: 'title',
      hit: false,
      x: box.x,
      w: box.w,
      y: y,
      h: layout().titleHeight,
      pad: 0,
      text: text,
      sub: sub || ''
    });
  }

  /* ------------------------------------------------------------ 各"块"的画法 */

  /**
   * 行（默认画法，A4 起的形状）：左图标 + 主字 + 副字 —— 商城 / 公会 / 营地 / 设置 / 自检结果仍是它。
   */
  function paintRow(ctx, area, row, pressed) {
    ctx.fillStyle = pressed ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.05)';
    ctx.fillRect(area.x + 10, row.y, area.w - 20, row.h - 10);
    // A6：行左侧的图标（装备 = 内观，功能 = 对应图形）；有没有图标决定文字从哪开始
    var textX = row.icon ? iconBox(ctx, area, row) + 14 : area.x + 24;
    G.HUD.text(ctx, row.text, textX, row.y + (row.sub ? 22 : (row.h - 10) / 2), 26, row.color, 'left');
    if (row.sub) G.HUD.text(ctx, row.sub, textX, row.y + 44, 17, '#9fb4d8', 'left');
    if (!row.action) {
      // 不可点的行给个视觉标记，免得玩家一直点它
      ctx.globalAlpha = 0.5;
      G.HUD.text(ctx, '（说明）', area.x + area.w - 22, row.y + (row.h - 10) / 2, 17, '#8d9bb5', 'right');
      ctx.globalAlpha = 1;
    }
  }

  /** 分区标题：左边一块小标题、右边一句"这块有多少"，下面一条淡淡的分隔线 */
  function paintTitle(ctx, area, row) {
    G.HUD.text(ctx, row.text, row.x, row.y + row.h / 2, 21, '#9fb4d8', 'left');
    if (row.sub) G.HUD.text(ctx, row.sub, row.x + row.w, row.y + row.h / 2, 16, '#6d86b5', 'right');
    ctx.fillStyle = 'rgba(109,134,181,0.3)';
    ctx.fillRect(row.x, row.y + row.h - 9, row.w, 2);
  }

  /**
   * 格子：阶色八角框 + 内观图标 + 框内左下角的小角标 + 框下一行名字。
   * 背包格是"框 + 名字"，四个装备槽是"大框 + 名字画在框里"（`row.caption` 决定要不要留出名字那一行）。
   * 宝箱不再是格子（A13 改成一行一阶的清单，见 `paintChestTier`），所以这里的 `cell` 只服务背包与装备槽。
   * 图标全部交给 G.ICONS（frame / item / slotPlaceholder / button），所以"背上什么、包里是什么"只有一份画法。
   */
  function paintCell(ctx, area, row, pressed) {
    var side = row.caption ? Math.min(row.w, row.h - 26) : Math.min(row.w, row.h);
    var frameX = row.x + (row.w - side) / 2;
    var frameY = row.y + (row.h - side) / 2;
    G.ICONS.frame(ctx, frameX, frameY, side, row.tier || 0, row.dim === true, glowPhase());
    var cx = frameX + side / 2;
    var cy = frameY + side / 2;
    if (row.icon) {
      if (row.icon.kind === 'gear') {
        if (row.icon.look) G.ICONS.item(ctx, row.icon.look, cx, cy, side * 0.82);
        else G.ICONS.slotPlaceholder(ctx, row.icon.slot, cx, cy, side * 0.82);
      } else {
        G.ICONS.button(ctx, row.icon.key, cx, cy, side * 0.7, '#dce6ff');
      }
    }
    // 框内左下角的小角标（战力 / 空 / 等级门槛）—— 压在图标下沿，不遮住东西
    if (row.badge) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(frameX + 2, frameY + side - 24, side - 4, 22);
      G.HUD.text(ctx, row.badge, cx, frameY + side - 13, 15, row.color || '#c9d8f2', 'center');
    }
    // 名字：背包格 / 宝箱格画在框下面，装备槽画在框里最上面一行
    if (row.text) {
      if (row.caption) {
        G.HUD.text(ctx, row.text, cx, row.y + row.h - 12, 16, '#c9d8f2', 'center');
      } else {
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(frameX + 2, frameY + 2, side - 4, 22);
        G.HUD.text(ctx, row.text, cx, frameY + 13, 15, row.color || '#e8f1ff', 'center');
      }
    }
    if (pressed) {
      ctx.globalAlpha = 0.26;
      ctx.fillStyle = '#ffd479';
      ctx.fillRect(frameX, frameY, side, side);
      ctx.globalAlpha = 1;
    }
  }

  /** 大按钮（开箱 / 一键分解 / 角色属性）：一整块可点的圆角矩形 + 图标 + 两行字 */
  function paintButton(ctx, area, row, pressed) {
    var h = row.h - 8;
    var gold = row.tone === 'gold';
    ctx.fillStyle = pressed ? (gold ? '#ffd479' : '#2f6b46') : gold ? 'rgba(255,212,121,0.13)' : 'rgba(255,255,255,0.06)';
    G.RENDER.roundRectPath(ctx, row.x, row.y, row.w, h, 16);
    ctx.fill();
    ctx.strokeStyle = gold ? '#ffd479' : '#4d5f86';
    ctx.lineWidth = 3;
    G.RENDER.roundRectPath(ctx, row.x, row.y, row.w, h, 16);
    ctx.stroke();
    var textX = row.x + 20;
    if (row.icon) {
      var size = G.ICONS.size('buttonSize') * 0.72;
      G.ICONS.button(ctx, row.icon.key, row.x + 20 + size / 2, row.y + h / 2, size, pressed ? '#241a05' : row.color || '#ffd479');
      textX = row.x + 20 + size + 14;
    }
    G.HUD.text(ctx, row.text, textX, row.y + h / 2 - (row.sub ? 13 : 0), 26, row.color || '#e8f1ff', 'left');
    if (row.sub) G.HUD.text(ctx, row.sub, textX, row.y + h / 2 + 17, 16, '#9fb4d8', 'left');
  }

  /** 进度条（保底计数 / 经验）：左标题、右数值，下面一条带底色的条 */
  function paintBar(ctx, area, row) {
    var barH = layout().barHeight - 12;
    G.HUD.text(ctx, row.text, row.x, row.y + 14, 19, '#e8f1ff', 'left');
    G.HUD.text(ctx, row.valueText || '', row.x + row.w, row.y + 14, 19, row.color || '#e8f1ff', 'right');
    G.HUD.bar(ctx, row.x, row.y + 30, row.w, barH, row.ratio || 0, row.color || '#8ce99a', 'rgba(0,0,0,0.5)');
  }

  /** 属性格（背包下面的 2 列网格）：一枚图标 + 名称 + 右侧数值（一行装下） */
  function paintStat(ctx, area, row) {
    var size = 32;
    G.ICONS.statIcon(ctx, row.iconKey, row.x + 8 + size / 2, row.y + row.h / 2, size, row.color || '#dce6ff');
    G.HUD.text(ctx, row.text, row.x + 8 + size + 10, row.y + row.h / 2, 19, '#c9d8f2', 'left');
    G.HUD.text(ctx, row.value, row.x + row.w - 6, row.y + row.h / 2, 21, row.color || '#e8f1ff', 'right');
  }

  /** 属性卡（属性面板：一行一张）：图标盒 + 名称 + 右对齐的大数值 + 一行"等级基础 / 装备"拆分 */
  function paintStatCard(ctx, area, row) {
    var config = layout();
    var h = row.h - 10;
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    G.RENDER.roundRectPath(ctx, row.x, row.y, row.w, h, 14);
    ctx.fill();
    var boxSize = config.iconSize;
    var boxY = row.y + (h - boxSize) / 2;
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    G.RENDER.roundRectPath(ctx, row.x + 16, boxY, boxSize, boxSize, 12);
    ctx.fill();
    G.ICONS.statIcon(ctx, row.iconKey, row.x + 16 + boxSize / 2, boxY + boxSize / 2, boxSize * 0.62, row.color || '#dce6ff');
    var textX = row.x + 16 + boxSize + 16;
    G.HUD.text(ctx, row.label, textX, row.y + 32, 22, '#c9d8f2', 'left');
    G.HUD.text(ctx, row.value, row.x + row.w - 20, row.y + 32, 30, row.color || '#e8f1ff', 'right');
    G.HUD.text(ctx, row.sub, textX, row.y + 64, 16, '#8fa6c8', 'left');
  }

  /**
   * 角色预览（背包面板的抬头）：一张圆角卡 + 脚下的台面光 + 站立的小人。
   * 四个角的**装备槽是另外四个格子**，画在它上面、点的是那几个格子 —— 这一块自己不吃触摸（`hit: false`）。
   */
  function paintPreview(ctx, area, row) {
    var config = layout();
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    G.RENDER.roundRectPath(ctx, row.x, row.y, row.w, row.h, 18);
    ctx.fill();
    ctx.strokeStyle = '#3a4a6b';
    ctx.lineWidth = 2;
    G.RENDER.roundRectPath(ctx, row.x, row.y, row.w, row.h, 18);
    ctx.stroke();
    var cx = row.x + row.w / 2;
    var feet = row.y + row.h - 54;
    // 台面：一圈淡淡的椭圆光（ellipsePath 只用到 translate / scale / arc，假 canvas 也认）
    G.RENDER.ellipsePath(ctx, cx, feet + 12, config.heroRadius * 1.7, config.heroRadius * 0.42);
    ctx.fillStyle = 'rgba(109,134,181,0.22)';
    ctx.fill();
    // A12：身上最高那一阶的发光（光身板就没有这一束）—— 与装备格 / 背包格 / 宝箱清单同一份颜色表
    G.ICONS.heroGlow(ctx, cx, feet, config.heroRadius, row.look, glowPhase());
    G.RENDER.drawHeroPreview(ctx, cx, feet, config.heroRadius, row.look, 0, 0);
    // 名字 / 等级与战力压在卡片顶部（正好落在左右两个装备槽之间）
    G.HUD.text(ctx, row.text, cx, row.y + 32, 26, '#ffffff', 'center');
    G.HUD.text(ctx, row.sub, cx, row.y + 64, 19, '#ffd479', 'center');
  }

  /** 技能条上的一个技能（背包面板）：图标 + 名字 + 一枚「自动」勾选框（点一下切换自动释放） */
  function paintChip(ctx, area, row, pressed) {
    var h = row.h - 8;
    ctx.fillStyle = pressed ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.05)';
    G.RENDER.roundRectPath(ctx, row.x, row.y, row.w, h, 14);
    ctx.fill();
    var iconR = h / 2 - 12;
    var cx = row.x + 12 + iconR;
    var cy = row.y + h / 2;
    ctx.globalAlpha = row.lock ? 0.45 : 1;
    ctx.fillStyle = '#1b2438';
    ctx.beginPath();
    ctx.arc(cx, cy, iconR, 0, Math.PI * 2);
    ctx.fill();
    G.ICONS.skillIcon(row.index, ctx, cx, cy, iconR * 1.5, '#dce6ff');
    ctx.globalAlpha = 1;
    var textX = cx + iconR + 12;
    G.HUD.text(ctx, row.text, textX, row.y + 26, 20, row.lock ? '#8d9bb5' : '#e8f1ff', 'left');
    // 「自动」勾选框：绿的 = 自动战斗会放它；暗的 = 只手动放
    var side = 26;
    var boxX = textX;
    var boxY = row.y + h - 32;
    ctx.fillStyle = row.on ? '#2f8a4f' : '#131a29';
    G.RENDER.roundRectPath(ctx, boxX, boxY, side, side, 7);
    ctx.fill();
    ctx.strokeStyle = row.on ? '#8ce99a' : '#4d5f86';
    ctx.lineWidth = 2.5;
    G.RENDER.roundRectPath(ctx, boxX, boxY, side, side, 7);
    ctx.stroke();
    if (row.on) {
      ctx.strokeStyle = '#eafff0';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(boxX + 6, boxY + 13);
      ctx.lineTo(boxX + 11, boxY + 18);
      ctx.lineTo(boxX + 20, boxY + 7);
      ctx.stroke();
    }
    G.HUD.text(ctx, '自动', boxX + side + 8, boxY + side / 2, 16, row.on ? '#8ce99a' : '#8d9bb5', 'left');
  }

  /** 缩放轴的规格（`balance.view.zoomSlider`）：画法与命中测试共用一份，别在两处各算一套 */
  function sliderConfig() {
    return BAL.view.zoomSlider;
  }

  /**
   * 视角缩放轴（A11 之二，用户："玩家设置中添加视角缩放滚动轴，可以缩到16-64"）：
   * 一行 = 左边标题 + 右边实时读数 + 一条轨道与圆钮。
   * 轨道两端各留 `endPad`（≥ 圆钮半径）—— 圆心只走 [x+endPad, x+w-endPad]，滑到头圆钮也不越出轨道。
   * 读数取的是**正在拖的值**（拖动中看 sliderTiles），所以圆钮与数字永远一起动。
   */
  function paintSlider(ctx, area, row, pressed) {
    var config = sliderConfig();
    var value = sliderValue(row);
    var ratio = sliderRatio(value);
    ctx.fillStyle = pressed ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.05)';
    G.RENDER.roundRectPath(ctx, row.x, row.y, row.w, row.h - 10, 14);
    ctx.fill();
    G.HUD.text(ctx, row.text, row.x + 20, row.y + 26, 24, '#e8f1ff', 'left');
    G.HUD.text(ctx, row.valueText, row.x + row.w - 20, row.y + 26, 22, row.color || '#ffd479', 'right');
    G.HUD.text(ctx, row.sub, row.x + 20, row.y + 52, 16, '#9fb4d8', 'left');
    var trackX = row.x + config.endPad;
    var trackW = row.w - config.endPad * 2;
    var trackY = row.y + row.h - 10 - config.trackHeight - 10;
    G.HUD.bar(ctx, trackX, trackY, trackW, config.trackHeight, ratio, '#4f8fd8', 'rgba(255,255,255,0.12)');
    var knobX = trackX + trackW * ratio;
    var knobY = trackY + config.trackHeight / 2;
    ctx.fillStyle = pressed ? '#ffd479' : '#dce6ff';
    ctx.beginPath();
    ctx.arc(knobX, knobY, config.knobRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1b2438';
    ctx.beginPath();
    ctx.arc(knobX, knobY, config.knobRadius * 0.42, 0, Math.PI * 2);
    ctx.fill();
  }

  /** 缩放轴现在该显示哪一格：正在拖就是拖到的值，否则取界面视图（`uiView().zoom.tiles`），再兜底 balance */
  function sliderValue(row) {
    if (sliderRow && sliderRow.id === row.id) return sliderTiles;
    if (row.tiles > 0) return row.tiles;
    return BAL.view.zoomTiles;
  }

  /** 值 → 圆钮在轨道上的比例（0 = 最左 = 一屏 minTiles 格） */
  function sliderRatio(tiles) {
    var config = sliderConfig();
    var span = config.maxTiles - config.minTiles;
    if (!(span > 0)) return 0;
    var ratio = (tiles - config.minTiles) / span;
    return ratio < 0 ? 0 : ratio > 1 ? 1 : ratio;
  }

  /**
   * 手指的 x → 整格数（纯函数，自检直接拿它验"滑到最左就是 16 格、最右就是 64 格"）。
   * 只用横向坐标：卡片的 x / w 不随滚动变，所以拖动中不必关心滚到哪了。
   */
  function sliderTilesAt(x) {
    var config = sliderConfig();
    var box = contentRect();
    var trackX = box.x + config.endPad;
    var trackW = box.w - config.endPad * 2;
    var ratio = trackW > 0 ? (x - trackX) / trackW : 0;
    ratio = ratio < 0 ? 0 : ratio > 1 ? 1 : ratio;
    return Math.round(config.minTiles + ratio * (config.maxTiles - config.minTiles));
  }

  /** 属性面板的抬头：头像 + 名字 + 等级 + 战力 + 经验条 */
  function paintHeader(ctx, area, row) {
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    G.RENDER.roundRectPath(ctx, row.x, row.y, row.w, row.h, 18);
    ctx.fill();
    var radius = BAL.view.hud.avatarRadius;
    G.RENDER.drawAvatar(ctx, row.x + 24 + radius, row.y + 72, radius, row.seed);
    var textX = row.x + 24 + radius * 2 + 20;
    G.HUD.text(ctx, row.text, textX, row.y + 34, 28, '#ffffff', 'left');
    G.HUD.text(ctx, row.sub, textX, row.y + 70, 20, '#9fb4d8', 'left');
    G.HUD.text(ctx, row.value, row.x + row.w - 24, row.y + 34, 30, '#ffd479', 'right');
    G.HUD.text(ctx, row.valueText, row.x + row.w - 24, row.y + 70, 18, '#8fa6c8', 'right');
    G.HUD.bar(ctx, row.x + 20, row.y + row.h - 30, row.w - 40, 16, row.ratio, '#4f8fd8', 'rgba(0,0,0,0.5)');
  }

  /**
   * 宝箱清单的一行（A13）：左边一口阶色小箱（走 `iconBox`，于是阶色框 + A12 的发光 + 箱子里观
   * 与地图上的开箱按钮是同一份画法）+ 阶名 + 右边「× 数量」+ 一行掉落占比。
   * **没有的阶照样占一行**（清单恒六行，一眼看得出还缺哪一阶）：那一行的字与数量一起压淡。
   * A14 起这一行的右端还坐着两枚按阶控件（「全开」+「自动」，见 `paintTierOpen` / `paintTierAuto`），
   * 于是"× 数量"的右边界改用 `row.countRight`（没给才回到老位置 —— 兜底，不至于把四个字叠在一起）。
   */
  function paintChestTier(ctx, area, row) {
    var h = row.h - layout().cellGap;
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(area.x + 10, row.y, area.w - 20, h);
    var textX = iconBox(ctx, area, row) + 14;
    var midY = row.y + h / 2;
    var empty = row.count === 0;
    G.HUD.text(ctx, row.text, textX, midY - 13, 24, empty ? '#7d8ba8' : row.color, 'left');
    G.HUD.text(ctx, row.sub, textX, midY + 15, 16, '#8fa6c8', 'left');
    if (empty) ctx.globalAlpha = 0.42;
    G.HUD.text(
      ctx,
      '× ' + row.count,
      row.countRight === undefined ? area.x + area.w - 22 : row.countRight,
      midY,
      30,
      empty ? '#7d8ba8' : row.color,
      'right'
    );
    if (empty) ctx.globalAlpha = 1;
  }

  /* ------------------------------------------------ A14：清单每行右侧的按阶控件 */

  /**
   * 宝箱清单某一行右侧那两枚控件的几何（A14）：**画与点共用这一份**，
   * 免得"画的框和点的框差几像素"这种经典 bug（面板里所有格子都是这条纪律）。
   *
   * 从右往左：行右内边距 12 →「全开」按钮（`chestOpenWidth` × `chestOpenHeight`）→ `chestControlGap`
   * →「自动」勾选（`chestAutoSide` 的方框 + 8 的缝 + 两个字；16px 的两个汉字正好一个 side 宽，
   * 于是整块宽度 = side × 2 + 8）→ 再往左 12 才是"× 数量"的右边界。
   * 两枚控件的 y 都在**行带**里居中（行高 - `cellGap`；清单行 h = `chestTierHeight`）。
   */
  function tierControls(row) {
    var config = layout();
    var side = config.chestAutoSide;
    var autoW = side + 8 + side;
    var right = row.x + row.w - 12;
    var openW = config.chestOpenWidth;
    var openH = config.chestOpenHeight;
    var bandH = row.h - config.cellGap;
    var autoX = right - openW - config.chestControlGap - autoW;
    return {
      openX: right - openW,
      openW: openW,
      openH: openH,
      openY: row.y + (bandH - openH) / 2,
      autoX: autoX,
      autoW: autoW,
      autoSide: side,
      autoY: row.y + (bandH - side) / 2,
      countRight: autoX - 12
    };
  }

  /**
   * 「全开」按钮（A14）：一枚小圆角板，颜色就是**这一阶的阶色** —— 六行六色，一眼分得清点的是哪一阶
   * （用户原话："对应不同等阶不同的开启按钮"）。
   * 这一阶一口箱子也没有时整块压淡（阶色仍在，看得出是哪一阶的按钮），并且 buildRows 那边不产出
   * action —— 压淡 + 点了没反应，两件事一起才叫"这一阶没货"。
   */
  function paintTierOpen(ctx, area, row, pressed) {
    var empty = row.count === 0;
    ctx.globalAlpha = pressed ? 0.42 : empty ? 0.07 : 0.17;
    ctx.fillStyle = row.color;
    G.RENDER.roundRectPath(ctx, row.x, row.y, row.w, row.h, 14);
    ctx.fill();
    ctx.globalAlpha = empty && !pressed ? 0.4 : 1;
    ctx.strokeStyle = row.color;
    ctx.lineWidth = 3;
    G.RENDER.roundRectPath(ctx, row.x, row.y, row.w, row.h, 14);
    ctx.stroke();
    G.HUD.text(ctx, row.text, row.x + row.w / 2, row.y + row.h / 2, 26, row.color, 'center');
    ctx.globalAlpha = 1;
  }

  /**
   * 「自动」勾选（A14）：绿 = 这一阶掉出来就当场开，暗 = 照旧进背包等玩家点。
   * 画法与技能条上那一枚（`paintChip`）同一套：圆角方框 + 勾 + 右边的「自动」两个字 —— 两处入口
   * 说的是同一件事，长相也该是同一个（A10 定的规矩）。
   * 按下时整块亮一点（面板里所有可点控件都这样给一次反馈）。
   */
  function paintTierAuto(ctx, area, row, pressed) {
    var side = row.side;
    var boxX = row.x;
    var boxY = row.y + (row.h - side) / 2;
    ctx.globalAlpha = pressed ? 0.7 : 1;
    ctx.fillStyle = row.on ? '#2f8a4f' : '#131a29';
    G.RENDER.roundRectPath(ctx, boxX, boxY, side, side, 8);
    ctx.fill();
    ctx.strokeStyle = row.on ? '#8ce99a' : '#4d5f86';
    ctx.lineWidth = 2.5;
    G.RENDER.roundRectPath(ctx, boxX, boxY, side, side, 8);
    ctx.stroke();
    if (row.on) {
      ctx.strokeStyle = '#eafff0';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(boxX + 7, boxY + 15);
      ctx.lineTo(boxX + 13, boxY + 21);
      ctx.lineTo(boxX + 24, boxY + 8);
      ctx.stroke();
    }
    G.HUD.text(ctx, '自动', boxX + side + 8, boxY + side / 2, 16, row.on ? '#8ce99a' : '#8d9bb5', 'left');
    ctx.globalAlpha = 1;
  }

  /** 块类型 → 画法（A10 起面板是"版面"而不是"一列行"，但命中与滚动仍然是同一条链） */
  var PAINTERS = {
    row: paintRow,
    title: paintTitle,
    cell: paintCell,
    button: paintButton,
    bar: paintBar,
    stat: paintStat,
    statCard: paintStatCard,
    preview: paintPreview,
    chip: paintChip,
    header: paintHeader,
    slider: paintSlider,
    chestTier: paintChestTier,
    tierOpen: paintTierOpen,
    tierAuto: paintTierAuto
  };

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
      var chestConfig = layout();
      var chestBox = contentRect();
      var chestHalf = (chestBox.w - chestConfig.cellGap) / 2;
      // ① 两个大按钮并排：开 1 个 / 开 10 个 —— 原来那两行"能点的字"现在是一整块能按的板
      list.push({
        id: 'chest:open1',
        kind: 'button',
        tone: 'gold',
        x: chestBox.x,
        w: chestHalf,
        y: top,
        h: chestConfig.bigButtonHeight,
        pad: 0,
        icon: { kind: 'ui', key: 'chest' },
        text: '开 1 个',
        sub: '普通怪 8% 起 · 精英 25%',
        color: '#ffd479',
        action: { type: 'openChest', count: 1 }
      });
      list.push({
        id: 'chest:open10',
        kind: 'button',
        tone: 'gold',
        x: chestBox.x + chestHalf + chestConfig.cellGap,
        w: chestHalf,
        y: top,
        h: chestConfig.bigButtonHeight,
        pad: 0,
        icon: { kind: 'ui', key: 'chest' },
        text: '开 10 个',
        sub: '背包 ' + view.save.chests.length + ' / ' + BAL.chests.bagCap,
        color: '#ffd479',
        action: { type: 'openChest', count: 10 }
      });
      top += chestConfig.bigButtonHeight + chestConfig.cellGap;
      // ② 两条保底进度条：差几箱必出史诗 / 神话，一眼看得出来
      var pityH = chestConfig.barHeight + 18;
      list.push({
        id: 'chest:pityEpic',
        kind: 'bar',
        hit: false,
        x: chestBox.x,
        w: chestBox.w,
        y: top,
        h: pityH,
        pad: 0,
        text: '史诗保底（第 ' + BAL.chests.pity.epic + ' 箱必出）',
        valueText: view.save.pity.epic + ' / ' + BAL.chests.pity.epic,
        ratio: BAL.chests.pity.epic > 0 ? view.save.pity.epic / BAL.chests.pity.epic : 0,
        color: '#d0a9ff'
      });
      list.push({
        id: 'chest:pityMythic',
        kind: 'bar',
        hit: false,
        x: chestBox.x,
        w: chestBox.w,
        y: top + pityH,
        h: pityH,
        pad: 0,
        text: '神话保底（第 ' + BAL.chests.pity.mythic + ' 箱必出）',
        valueText: view.save.pity.mythic + ' / ' + BAL.chests.pity.mythic,
        ratio: BAL.chests.pity.mythic > 0 ? view.save.pity.mythic / BAL.chests.pity.mythic : 0,
        color: '#ff9b5a'
      });
      top += pityH * 2 + chestConfig.cellGap;
      // ③ 六阶宝箱清单（A13）：一阶一行 —— 阶色小箱 + 阶名 + 「× 数量」 + 掉落占比
      //    用户原话："宝箱背包不需要格子，直接放不同等阶宝箱×数量" —— 恒六行，没有的阶也占一行（压淡）
      //    A14：每一行右侧再挂两枚**按阶的控件**（「全开」+「自动」，见 tierControls）
      var chestAuto = view.save.settings ? view.save.settings.chestAuto : null;
      var autoTiers = G.LOOT.autoCount(chestAuto);
      pushTitle(
        list,
        chestBox,
        top,
        '宝箱背包',
        view.save.chests.length +
          ' / ' +
          BAL.chests.bagCap +
          ' 口 · 按阶汇总' +
          (autoTiers > 0 ? ' · 自动 ' + autoTiers + ' 阶' : '')
      );
      top += chestConfig.titleHeight;
      var chestListing = chestSummary(view.save.chests);
      for (i = 0; i < chestListing.length; i += 1) {
        var chestEntry = chestListing[i];
        var tierRow = {
          id: 'chest:tier:' + chestEntry.tier,
          kind: 'chestTier',
          hit: false,
          x: chestBox.x,
          w: chestBox.w,
          y: top,
          h: chestConfig.chestTierHeight,
          pad: 0,
          tier: chestEntry.tier,
          icon: { kind: 'ui', key: 'chest', tier: chestEntry.tier, dim: chestEntry.count === 0 },
          text: chestEntry.name + '宝箱',
          sub: chestEntry.text,
          count: chestEntry.count,
          share: chestEntry.share,
          color: chestEntry.color
        };
        // 两枚按阶控件的几何：画（paintTierOpen / paintTierAuto）与点（下面两个行对象）共用这一份
        var controls = tierControls(tierRow);
        tierRow.countRight = controls.countRight;
        list.push(tierRow);
        // ① 「全开」：开掉**这一阶**的全部箱子。这一阶一口箱子也没有时压淡且**不产出 action**
        list.push({
          id: 'chest:tierOpen:' + chestEntry.tier,
          kind: 'tierOpen',
          x: controls.openX,
          w: controls.openW,
          y: controls.openY,
          h: controls.openH,
          pad: 0,
          tier: chestEntry.tier,
          count: chestEntry.count,
          color: chestEntry.color,
          text: '全开',
          action: chestEntry.count > 0 ? { type: 'openChestTier', tier: chestEntry.tier } : null
        });
        // ② 「自动」：勾上 = 这一阶掉出来就当场开（恒可点：先勾上、之后掉出来就自动开）
        list.push({
          id: 'chest:tierAuto:' + chestEntry.tier,
          kind: 'tierAuto',
          x: controls.autoX,
          w: controls.autoW,
          y: top,
          h: chestConfig.chestTierHeight - chestConfig.cellGap,
          pad: 0,
          tier: chestEntry.tier,
          side: controls.autoSide,
          on: G.LOOT.autoEnabled(chestAuto, chestEntry.tier),
          text: '自动',
          action: { type: 'toggleChestAuto', tier: chestEntry.tier }
        });
        top += chestConfig.chestTierHeight + chestConfig.cellGap;
      }
      top += chestConfig.cellGap;
      if (view.save.chests.length === 0) {
        list.push({
          id: 'chest:empty',
          kind: 'title',
          hit: false,
          x: chestBox.x,
          w: chestBox.w,
          y: top,
          h: chestConfig.titleHeight,
          pad: 0,
          text: '还没有宝箱',
          sub: '去打怪：普通怪约 8% 掉箱，精英 25%'
        });
      }
      return list;
    }

    if (current === 'bag') {
      var bagConfig = layout();
      var bagBox = contentRect();
      var slotSide = bagConfig.slotSize;
      var slotInset = bagConfig.slotInset;
      // ① 角色预览：中间站着小人，四角各一个装备槽（穿了什么一眼看得见，点一下脱下来）
      var previewTop = top;
      list.push({
        id: 'bag:preview',
        kind: 'preview',
        hit: false,
        x: bagBox.x,
        w: bagBox.w,
        y: previewTop,
        h: bagConfig.previewHeight,
        pad: 0,
        look: EQUIP.lookOf(view.save.loadout),
        text: view.save.name || '无名者',
        sub: 'Lv.' + view.save.level + ' · ' + view.save.gold + ' 金币 · 战力 ' + view.stats.power
      });
      // 四角：左上武器、右上衣服、左下鞋子、右下饰品（与 EQUIP.SLOT_IDS 同序，读起来就是"从头到脚"）
      var corners = [
        { slotId: 'weapon', x: bagBox.x + slotInset, y: previewTop + slotInset },
        { slotId: 'armor', x: bagBox.x + bagBox.w - slotInset - slotSide, y: previewTop + slotInset },
        { slotId: 'boots', x: bagBox.x + slotInset, y: previewTop + bagConfig.previewHeight - slotInset - slotSide },
        {
          slotId: 'trinket',
          x: bagBox.x + bagBox.w - slotInset - slotSide,
          y: previewTop + bagConfig.previewHeight - slotInset - slotSide
        }
      ];
      for (i = 0; i < corners.length; i += 1) {
        var slotId = corners[i].slotId;
        var slotDef = EQUIP.slotById(slotId);
        var equipped = view.save.loadout ? view.save.loadout[slotId] : null;
        list.push({
          id: 'bag:slot:' + slotId,
          kind: 'cell',
          x: corners[i].x,
          w: slotSide,
          y: corners[i].y,
          h: slotSide,
          pad: 0,
          tier: equipped ? equipped.tier : 0,
          dim: !equipped,
          icon: {
            kind: 'gear',
            slot: slotId,
            look: equipped ? equipped.look : null,
            tier: equipped ? equipped.tier : 0,
            size: G.ICONS.size('slotSize')
          },
          text: slotDef.name + EQUIP.enhanceTag(equipped),
          badge: equipped ? '战力 ' + equipped.power : '空',
          color: equipped ? tierColor(equipped.tier) : '#8d9bb5',
          action: equipped ? { type: 'unequip', slotId: slotId } : null
        });
      }
      top = previewTop + bagConfig.previewHeight + bagConfig.cellGap;
      // ② 技能条（A10）：四个技能 + 「自动释放」勾选 —— 与技能键右上角那枚勾选框是同一件事
      var bagSkills = (view.skills && view.skills.slots) || [];
      if (bagSkills.length) {
        var autoOn = 0;
        for (i = 0; i < bagSkills.length; i += 1) {
          if (bagSkills[i].auto !== false) autoOn += 1;
        }
        pushTitle(list, bagBox, top, '技能 · 自动释放', autoOn + ' / ' + bagSkills.length + ' 开启');
        top += bagConfig.titleHeight;
        var chipW = (bagBox.w - bagConfig.cellGap * (bagSkills.length - 1)) / bagSkills.length;
        for (i = 0; i < bagSkills.length; i += 1) {
          list.push({
            id: 'bag:skill:' + bagSkills[i].index,
            kind: 'chip',
            x: bagBox.x + i * (chipW + bagConfig.cellGap),
            w: chipW,
            y: top,
            h: bagConfig.skillChipHeight,
            pad: 0,
            index: bagSkills[i].index,
            text: bagSkills[i].name,
            on: bagSkills[i].auto !== false,
            lock: !bagSkills[i].unlocked,
            action: { type: 'skillAuto', index: bagSkills[i].index }
          });
        }
        top += bagConfig.skillChipHeight + bagConfig.cellGap;
      }
      // ③ 三排背包格（点一下穿上）：比身上强的画绿色角标，等级不够的压淡。
      //   本次新增：这一块**一页 15 件**（gridRows 行 × gridColumns 列），拖格子上下翻页看后面的装备 ——
      //   `bagRow` = 这一页的第一行在全部装备里的行号，页码由这里夹回合法范围（装备变少时也要夹）。
      var bagColumns = bagConfig.gridColumns;
      var bagLines = bagConfig.gridRows;
      var bagCount = view.save.items.length;
      var bagTotalRows = Math.max(1, Math.ceil(bagCount / bagColumns));
      bagMaxRow = bagTotalRows > bagLines ? bagTotalRows - bagLines : 0;
      if (bagRow > bagMaxRow) bagRow = bagMaxRow;
      pushTitle(
        list,
        bagBox,
        top,
        '背包',
        bagCount === 0
          ? '还没有装备'
          : bagMaxRow > 0
            ? bagCount +
              ' 件 · 第 ' +
              (bagRow + 1) +
              '–' +
              Math.min(bagRow + bagLines, bagTotalRows) +
              ' / 共 ' +
              bagTotalRows +
              ' 排（上下拖格子翻页）'
            : bagCount + ' 件装备'
      );
      top += bagConfig.titleHeight;
      var slotW = (bagBox.w - bagConfig.cellGap * (bagColumns - 1)) / bagColumns;
      // 这块矩形（含空框区域）就是"翻页手势"的势力范围：move 按它判、画也按它排 —— 只有这一份出处
      bagGridRect = {
        x: bagBox.x,
        w: bagBox.w,
        y: top,
        h: bagLines * (bagConfig.gridCellHeight + bagConfig.cellGap)
      };
      for (i = 0; i < bagColumns * bagLines; i += 1) {
        var cellX = bagBox.x + (i % bagColumns) * (slotW + bagConfig.cellGap);
        var cellY = top + Math.floor(i / bagColumns) * (bagConfig.gridCellHeight + bagConfig.cellGap);
        // 这一格在**全部装备**里的序号 = 当前页第一行 x 每行几格 + 页内序号
        var slotIndex = bagRow * bagColumns + i;
        var item = view.save.items[slotIndex] || null;
        if (item) {
          var worn = view.save.loadout ? view.save.loadout[item.slotId] : null;
          var better = !worn || item.power > worn.power;
          var wearable = EQUIP.canWear(item, view.save.level);
          list.push({
            id: 'bag:item:' + item.id,
            kind: 'cell',
            caption: true,
            x: cellX,
            w: slotW,
            y: cellY,
            h: bagConfig.gridCellHeight,
            pad: 0,
            tier: item.tier,
            dim: !wearable,
            icon: { kind: 'gear', slot: item.slotId, look: item.look, tier: item.tier },
            text: item.name + EQUIP.enhanceTag(item),
            badge: wearable ? (better ? '↑ ' : '') + '战力 ' + item.power : 'Lv.' + item.reqLevel,
            color: wearable ? (better ? '#8ce99a' : '#c7c7c7') : '#8d8d8d',
            action: { type: 'equip', itemId: item.id }
          });
        } else {
          list.push({
            id: 'bag:empty:' + slotIndex,
            kind: 'cell',
            hit: false,
            caption: true,
            x: cellX,
            w: slotW,
            y: cellY,
            h: bagConfig.gridCellHeight,
            pad: 0,
            tier: 0,
            dim: true,
            text: '空'
          });
        }
      }
      top += bagLines * (bagConfig.gridCellHeight + bagConfig.cellGap) + bagConfig.cellGap;
      if (view.save.items.length === 0) {
        list.push({
          id: 'bag:empty',
          kind: 'title',
          hit: false,
          x: bagBox.x,
          w: bagBox.w,
          y: top,
          h: bagConfig.titleHeight,
          pad: 0,
          text: '背包是空的',
          sub: '开箱会开出装备，等级够的会自动穿上'
        });
        top += bagConfig.titleHeight;
      }
      // ④ 两个大按钮：一键分解 / 角色属性（后者与设置面板里那一行是同一个面板）
      var bagHalf = (bagBox.w - bagConfig.cellGap) / 2;
      list.push({
        id: 'bag:salvageAll',
        kind: 'button',
        x: bagBox.x,
        w: bagHalf,
        y: top,
        h: bagConfig.bigButtonHeight,
        pad: 0,
        icon: { kind: 'ui', key: 'bag' },
        text: '一键分解',
        sub: '每个部位留最强 1 件',
        color: '#ffd479',
        action: { type: 'salvageAll' }
      });
      list.push({
        id: 'bag:stat',
        kind: 'button',
        x: bagBox.x + bagHalf + bagConfig.cellGap,
        w: bagHalf,
        y: top,
        h: bagConfig.bigButtonHeight,
        pad: 0,
        icon: { kind: 'ui', key: 'stat' },
        text: '角色属性',
        sub: '基础 / 装备逐项对照',
        color: '#a9d5ff',
        action: { type: 'open', panel: 'stat' }
      });
      top += bagConfig.bigButtonHeight + bagConfig.cellGap;
      // ⑤ 属性网格（2 列）：与「角色属性」面板同一份数据（PLAYER.breakdown），只是紧凑版
      pushTitle(list, bagBox, top, '角色属性', '点上面看完整对照');
      top += bagConfig.titleHeight;
      var bagStats = G.PLAYER.breakdown(view.save.level, view.save.loadout);
      var statW = (bagBox.w - bagConfig.cellGap * (bagConfig.statColumns - 1)) / bagConfig.statColumns;
      for (i = 0; i < bagStats.length; i += 1) {
        list.push({
          id: 'bag:stat:' + i,
          kind: 'stat',
          hit: false,
          x: bagBox.x + (i % bagConfig.statColumns) * (statW + bagConfig.cellGap),
          w: statW,
          y: top + Math.floor(i / bagConfig.statColumns) * (bagConfig.statCellHeight + bagConfig.cellGap),
          h: bagConfig.statCellHeight,
          pad: 0,
          iconKey: bagStats[i].icon,
          text: bagStats[i].label,
          value: bagStats[i].value,
          sub: bagStats[i].sub,
          color: bagStats[i].color || '#e8f1ff'
        });
      }
      return list;
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
        id: 'shop:stone',
        y: top + rowH,
        h: rowH,
        text: '强化石 ' + BAL.shop.stone.priceGold + ' 金币',
        sub: unlocked
          ? '已持有 ' + (view.save.stones || 0) + ' 颗 · 营地铁匠强化装备用（每级翻倍：1 / 2 / 4 …）'
          : '需要 ' + BAL.guild.shopUnlockLevel + ' 级解锁（现在 ' + view.save.level + ' 级）',
        color: unlocked ? '#8ce99a' : '#8d8d8d',
        action: { type: 'buyStone' }
      });
      list.push({
        id: 'shop:teleport',
        y: top + rowH * 2,
        h: rowH,
        text: '回公会（免费）',
        sub: '冷却 ' + Math.round(BAL.guild.teleportCooldownMs / 1000) + ' 秒 · 战斗中 ' + Math.round(BAL.guild.teleportCombatLockMs / 1000) + ' 秒内不可用',
        color: '#a9d5ff',
        action: { type: 'teleportGuild' }
      });
      list.push({
        id: 'shop:note',
        y: top + rowH * 3,
        h: rowH,
        text: '首版不接真实支付（决策 #3）',
        sub: '号角 / 强化石只能用金币买；钻石字段保留但不投放',
        color: '#c7c7c7',
        action: null
      });
    }

    /* ------------------------------------ 强化面板（本次新增：公会营地里的铁匠） */

    /**
     * 四个**已穿**部位各一行：装备内观图标 + 当前等级 + 下一级要几颗石头 + 强化后的战力，点一行 = 强化一次。
     * 面板里**只读**（一行一个 action，真正的扣石头 / 加等级在 20-main 的 enhanceItem），
     * 于是"石头不够 / 已满级 / 这个部位空着"这三种情况这里都能如实写出来。
     */
    if (current === 'enhance') {
      var stones = view.save.stones || 0;
      var maxLevel = EQUIP.maxEnhance();
      var stepPct = Math.round(BAL.enhance.statPerLevel * 100);
      list.push({
        id: 'enhance:stones',
        hit: false,
        y: top,
        h: rowH,
        text: '强化石 ' + stones + ' 颗',
        sub: '每级翻倍：+1 要 1 颗、+2 要 2 颗、+3 要 4 颗 …… 最后一行直接去商城买（' + BAL.shop.stone.priceGold + ' 金币一颗）',
        color: stones > 0 ? '#ffd479' : '#8d8d8d'
      });
      var smithSlots = EQUIP.slotIds();
      for (i = 0; i < smithSlots.length; i += 1) {
        var smithSlotId = smithSlots[i];
        var smithSlot = EQUIP.slotById(smithSlotId);
        var smithItem = view.save.loadout ? view.save.loadout[smithSlotId] : null;
        var smithLevel = EQUIP.enhanceLevel(smithItem);
        var smithCost = EQUIP.nextEnhanceCost(smithItem);
        var smithRow = {
          id: 'enhance:' + smithSlotId,
          y: top + rowH * (i + 1),
          h: rowH,
          action: null
        };
        if (!smithItem) {
          smithRow.text = smithSlot.name + '：空';
          smithRow.sub = '先去背包穿上这一件（只强化身上穿着的四件）';
          smithRow.color = '#8d8d8d';
          smithRow.icon = { kind: 'gear', slot: smithSlotId, look: null, tier: 0 };
        } else if (smithLevel >= maxLevel) {
          smithRow.text = smithSlot.name + '：' + EQUIP.labelOf(smithItem);
          smithRow.sub = '已经满级 +' + maxLevel + '（主属性 +' + maxLevel * stepPct + '%）· 战力 ' + smithItem.power;
          smithRow.color = '#ffd479';
          smithRow.icon = { kind: 'gear', slot: smithSlotId, look: smithItem.look, tier: smithItem.tier };
        } else {
          // 强化后的战力是**算出来的**（浅拷贝一件、等级 +1、走同一个 powerOf）——
          // 与真正扣完石头之后那个数逐位一致，不会有"预览 100、强化完 101"这种事
          var preview = { main: smithItem.main, affixes: smithItem.affixes, enhance: smithLevel + 1 };
          smithRow.text = smithSlot.name + '：' + EQUIP.labelOf(smithItem);
          smithRow.sub =
            '强化到 +' + (smithLevel + 1) + '：' + smithCost + ' 颗强化石（持有 ' + stones + '）· ' +
            EQUIP.statName(smithItem.main.stat) + ' +' + (smithLevel + 1) * stepPct + '% · 战力 ' +
            smithItem.power + ' → ' + EQUIP.powerOf(preview);
          smithRow.color = stones >= smithCost ? '#8ce99a' : '#8d8d8d';
          smithRow.icon = { kind: 'gear', slot: smithSlotId, look: smithItem.look, tier: smithItem.tier };
          // 石头不够也照样给 action：点了会得到一句"还差几颗"的提示（比一个点不动的行更好懂）
          smithRow.action = { type: 'enhance', slotId: smithSlotId };
        }
        list.push(smithRow);
      }
      list.push({
        id: 'enhance:shop',
        y: top + rowH * (smithSlots.length + 1),
        h: rowH,
        text: '去商城买强化石',
        sub: BAL.shop.stone.priceGold + ' 金币一颗 · 公会号角也在那儿（' + BAL.guild.shopUnlockLevel + ' 级解锁）',
        color: '#8ce99a',
        icon: { kind: 'ui', key: 'shop' },
        action: { type: 'open', panel: 'shop' }
      });
      return list;
    }

    /* ------------------ 公会（本次重做）—— 自己输入公会名建会 / 加入 / 人员 / 等级 / 公会信息 */

    /**
     * 用户要求："创建公会需要自己输入公会名，公会页面显示公会人员，公会等级，公会信息。"
     *
     * 这里只负责**排版**，三件事分别由别人负责：
     *   1. **输入**：点「输入公会名」→ 20-main 的 `typeGuildName` 调平台键盘（`PLAT.editText`），
     *      值经 `setDraftGuildName` 回到这里（模拟器没有键盘时用「随机取一个名字」兜底）；
     *   2. **规则**：名字合不合法、等级怎么算全在 11-save 的 `G.GUILD`（validate / levelFrom）；
     *   3. **权威**：全服唯一的名字、成员表与等级由**服务端**说了算（`/api/guild/*`）——
     *      这里的成员表是它的**镜像**（`guild.remote`）；连不上云时本机那份照旧可用（决策 #10）。
     */
    if (current === 'guild') {
      var guild = view.save.guild;
      var guildNet = view.guild || {};
      var guildLevelOk = PROG.guildUnlocked(view.save.level);
      var gy = top;

      // 服务端状态那一行（正在连 / 刚同步过 / 连不上）：有话说的时候才占一行
      if (guildNet.note) {
        list.push({
          id: 'guild:status',
          hit: false,
          y: gy,
          h: rowH,
          icon: { kind: 'ui', key: 'guild' },
          text: guildNet.busy ? '正在连接服务端…' : '公会服务端',
          sub: guildNet.note,
          color: guildNet.busy ? '#a9d5ff' : '#8ce99a'
        });
        gy += rowH;
      }

      if (!guild) {
        /* ------------------ 还没有公会：输入名字 → 创建；或者加入一个已有的 ------------------ */
        var guildDraft = draftGuildName;
        var guildCheck = guildDraft ? GUILD.validate(guildDraft) : { ok: false, reason: 'empty' };
        var guildReady = guildLevelOk && view.save.horns > 0 && guildCheck.ok;
        list.push({
          id: 'guild:name',
          y: gy,
          h: rowH,
          icon: { kind: 'ui', key: 'keyboard' },
          text: '公会名：' + (guildDraft || '还没输入'),
          sub: guildDraft
            ? guildCheck.ok
              ? '可以（' + BAL.guild.nameMin + '~' + BAL.guild.nameMax + ' 字）· 点下面「创建公会」'
              : GUILD.reasonText(guildCheck.reason)
            : '点这一行打字：' + BAL.guild.nameMin + '~' + BAL.guild.nameMax + ' 个字，中文 / 字母 / 数字 / 下划线',
          color: guildCheck.ok ? '#8ce99a' : '#a9d5ff',
          action: { type: 'typeGuildName' }
        });
        gy += rowH;
        pushTitle(list, contentRect(), gy, '创建公会', '消耗 1 个号角 · 据点锚点就设在你脚下');
        gy += layout().titleHeight;
        list.push({
          id: 'guild:create',
          y: gy,
          h: rowH,
          icon: { kind: 'ui', key: 'guild' },
          text: '创建「' + (guildDraft || '？') + '」（消耗 1 个号角）',
          sub: !guildLevelOk
            ? '需要 ' + BAL.guild.unlockLevel + ' 级（现在 ' + view.save.level + ' 级）'
            : view.save.horns <= 0
              ? '还没有号角：商城 ' + BAL.shop.horn.priceGold + ' 金币一个'
              : !guildCheck.ok
                ? GUILD.reasonText(guildCheck.reason)
                : '持有号角 ' + view.save.horns + ' 个',
          color: guildReady ? '#8ce99a' : '#8d8d8d',
          action: { type: 'createGuild' }
        });
        gy += rowH;
        list.push({
          id: 'guild:randomName',
          y: gy,
          h: rowH,
          icon: { kind: 'ui', key: 'dice' },
          text: '随机取一个名字',
          sub: '不想打字就点它（模拟器里没有平台键盘，这是兜底的输入方式）',
          color: '#c7c7c7',
          action: { type: 'renameGuild' }
        });
        gy += rowH;
        pushTitle(list, contentRect(), gy, '或者加入一个已有的公会', '输入名字，或直接在下面的列表里点一行');
        gy += layout().titleHeight;
        list.push({
          id: 'guild:joinName',
          y: gy,
          h: rowH,
          icon: { kind: 'ui', key: 'keyboard' },
          text: '要加入的公会名：' + (joinDraftName || '还没输入'),
          sub: '点这一行打字（和上面的"创建"是两个名字，不会互相覆盖）',
          color: joinDraftName ? '#a9d5ff' : '#c7c7c7',
          action: { type: 'typeJoinName' }
        });
        gy += rowH;
        list.push({
          id: 'guild:join',
          y: gy,
          h: rowH,
          icon: { kind: 'ui', key: 'guild' },
          text: '加入「' + (joinDraftName || '？') + '」',
          sub: joinDraftName
            ? '你会成为它的成员（上限 ' + BAL.guild.memberCap + ' 人）'
            : '先在上面输入公会名',
          color: joinDraftName ? '#8ce99a' : '#8d8d8d',
          action: { type: 'joinGuild' }
        });
        gy += rowH;
        // 服务端的公会列表（点一行 = 加入它）：连不上时这里只有一行说明 —— 不假装有内容
        var guildList = guildNet.list || [];
        pushTitle(
          list,
          contentRect(),
          gy,
          '公会列表',
          guildList.length ? guildList.length + ' 个 · 点一行加入' : '服务端的公会名单'
        );
        gy += layout().titleHeight;
        if (!guildList.length) {
          list.push({
            id: 'guild:listEmpty',
            hit: false,
            y: gy,
            h: rowH,
            text: '列表还是空的',
            sub: guildNet.listNote || '点下面「刷新公会列表」去服务端要一份（没配 cloudBase 时就一直是这样）',
            color: '#8d8d8d'
          });
          gy += rowH;
        } else {
          for (i = 0; i < guildList.length; i += 1) {
            var listed = guildList[i] || {};
            list.push({
              id: 'guild:list:' + i,
              y: gy,
              h: rowH,
              icon: { kind: 'ui', key: 'guild' },
              text: listed.name + '  Lv.' + listed.level,
              sub: '成员 ' + listed.count + ' / ' + listed.memberCap + '　点这一行加入它',
              color: '#a9d5ff',
              action: { type: 'joinGuild', name: listed.name }
            });
            gy += rowH;
          }
        }
        list.push({
          id: 'guild:listRefresh',
          y: gy,
          h: rowH,
          icon: { kind: 'ui', key: 'stat' },
          text: '刷新公会列表',
          sub: guildNet.listAt ? '上次刷新：' + agoText(guildNet.listAt, view) : '还没刷新过',
          color: '#c7c7c7',
          action: { type: 'guildList' }
        });
        gy += rowH;
      } else {
        /* ------------------ 已经有公会：等级 / 公会信息 / 公会人员 ------------------ */
        var guildLeader = GUILD.leaderOf(guild);
        var guildLevelMax = guild.level >= guild.levelCap;
        var guildPct = guildLevelMax
          ? 100
          : Math.round(Math.min(1, guild.expForNext ? guild.exp / guild.expForNext : 0) * 100);
        pushTitle(
          list,
          contentRect(),
          gy,
          '公会「' + guild.name + '」',
          guild.remote ? '成员表来自服务端 · 每 ' + Math.round(BAL.guild.syncIntervalMs / 1000) + ' 秒自动刷新' : '本机记录（离线时建的会）'
        );
        gy += layout().titleHeight;
        // ① 公会等级（用户要"公会页面显示公会等级"）—— 由成员等级之和算出来，公式在 G.GUILD.levelFrom
        list.push({
          id: 'guild:level',
          hit: false,
          y: gy,
          h: rowH,
          icon: { kind: 'ui', key: 'guild' },
          text: '公会等级 Lv.' + guild.level + (guildLevelMax ? '（满级）' : ''),
          sub: guildLevelMax
            ? '成员等级之和 ' + Math.round(guild.exp) + ' · 已经到 ' + guild.levelCap + ' 级上限'
            : '升级进度 ' + Math.round(guild.exp) + ' / ' + Math.round(guild.expForNext) + '（' + guildPct + '%）· 成员等级之和每满 ' + Math.round(guild.expForNext) + ' 升 1 级',
          color: '#ffd479'
        });
        gy += rowH;
        // ② 公会信息：会长 / 我的身份 / 人数 / 锚点
        list.push({
          id: 'guild:info',
          hit: false,
          y: gy,
          h: rowH,
          icon: { kind: 'ui', key: 'user' },
          text: '会长：' + (guildLeader ? guildLeader.name : '？') + ' · 我的身份：' + (GUILD.isLeader(guild) ? '会长' : '成员'),
          sub: GUILD.memberText(guild) + ' · 人数上限 ' + guild.memberCap,
          color: '#c7c7c7'
        });
        gy += rowH;
        list.push({
          id: 'guild:anchor',
          hit: false,
          y: gy,
          h: rowH,
          icon: { kind: 'ui', key: 'camp' },
          text: '据点锚点 (' + Math.round(guild.anchor.x) + ', ' + Math.round(guild.anchor.y) + ')',
          sub: guild.syncAt ? '最近同步：' + agoText(guild.syncAt, view) : '还没和服务端同步过',
          color: '#c7c7c7'
        });
        gy += rowH;
        // ③ 公会人员（用户要"公会页面显示公会人员"）：一行一个人，会长永远第一（顺序在 G.GUILD.sortedMembers）
        var guildMembers = GUILD.sortedMembers(guild);
        pushTitle(list, contentRect(), gy, '公会人员', GUILD.memberText(guild));
        gy += layout().titleHeight;
        for (i = 0; i < guildMembers.length; i += 1) {
          var guildMember = guildMembers[i];
          var isMe = guildMember.name === view.save.name;
          list.push({
            id: 'guild:member:' + i,
            hit: false,
            y: gy,
            h: rowH,
            icon: { kind: 'ui', key: guildMember.role === 'leader' ? 'guild' : 'user' },
            text:
              (guildMember.role === 'leader' ? '会长 ' : '') +
              guildMember.name +
              (isMe ? '（我）' : ''),
            sub:
              'Lv.' + guildMember.level +
              ' · ' +
              (guildMember.online ? '在线' : '离线') +
              (isMe ? ' · 这是我' : ''),
            color: guildMember.online ? '#8ce99a' : '#8d8d8d'
          });
          gy += rowH;
        }
        if (guildMembers.length < guild.memberCap) {
          list.push({
            id: 'guild:invite',
            hit: false,
            y: gy,
            h: rowH,
            text: '还有 ' + (guild.memberCap - guildMembers.length) + ' 个空位',
            sub: '把公会名「' + guild.name + '」告诉朋友：TA 在公会面板里输入这个名字就能加入',
            color: '#c7c7c7'
          });
          gy += rowH;
        }
        list.push({
          id: 'guild:teleport',
          y: gy,
          h: rowH,
          icon: { kind: 'ui', key: 'camp' },
          text: '回到公会锚点',
          sub: '冷却 ' + Math.round(BAL.guild.teleportCooldownMs / 1000) + ' 秒 · 战斗中不可用',
          color: '#a9d5ff',
          action: { type: 'teleportGuild' }
        });
        gy += rowH;
        list.push({
          id: 'guild:sync',
          y: gy,
          h: rowH,
          icon: { kind: 'ui', key: 'stat' },
          text: '向服务端要一份最新成员表',
          sub: guild.syncAt ? '上次同步：' + agoText(guild.syncAt, view) : '还没同步过（点一下试试）',
          color: '#8ce99a',
          action: { type: 'guildSync' }
        });
        gy += rowH;
        // 退出公会：会长不能退（首版没有转让，所以如实写明为什么按钮是灰的）
        if (!GUILD.isLeader(guild)) {
          list.push({
            id: 'guild:leave',
            y: gy,
            h: rowH,
            icon: { kind: 'ui', key: 'trash' },
            text: '退出「' + guild.name + '」',
            sub: '会籍在服务端删除，本机记录一起清掉；再想回来重新加入即可',
            color: '#ffb4b4',
            action: { type: 'guildLeave' }
          });
          gy += rowH;
        } else {
          list.push({
            id: 'guild:leaderNote',
            hit: false,
            y: gy,
            h: rowH,
            text: '你是会长：首版不能退会',
            sub: '要解散就把成员都请出去（解散 / 转让留给下个阶段）',
            color: '#8d8d8d'
          });
          gy += rowH;
        }
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
        text: '进商城（号角 / 强化石）',
        sub: '营地里的商人：号角 ' + BAL.shop.horn.priceGold + ' 金币、强化石 ' + BAL.shop.stone.priceGold + ' 金币，' + BAL.guild.shopUnlockLevel + ' 级解锁',
        color: '#ffd479',
        action: { type: 'open', panel: 'shop' }
      });
      // 铁匠（本次新增）：这行与"走到他跟前才出现的那枚「锻」键"是同一个面板，两条路都好走
      list.push({
        id: 'camp:smith',
        y: top + rowH * 2,
        h: rowH,
        text: '找铁匠强化装备（+' + EQUIP.maxEnhance() + ' 封顶）',
        sub: '篝火旁那个铁砧：走到跟前屏幕上会多一枚「锻」键 · 手里 ' + (view.save.stones || 0) + ' 颗强化石',
        color: (view.save.stones || 0) > 0 ? '#8ce99a' : '#ffd479',
        icon: { kind: 'ui', key: 'smith' },
        action: { type: 'open', panel: 'enhance' }
      });
      list.push({
        id: 'camp:teleport',
        y: top + rowH * 3,
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
        y: top + rowH * 4,
        h: rowH,
        text: '回公会锚点',
        sub: view.save.guild ? '公会「' + view.save.guild.name + '」的锚点' : '还没有公会：先在商城买号角',
        color: view.save.guild ? '#a9d5ff' : '#8d8d8d',
        action: { type: 'teleportGuild' }
      });
      list.push({
        id: 'camp:note',
        y: top + rowH * 5,
        h: rowH,
        text: '营地是安全区：怪不在这里刷新',
        sub: 'A6 起：巢穴落在营地半径 ' + BAL.world.camp.monsterFreeRadius + ' 内的怪不装载，走进来的会被推回边界并回家',
        color: '#c7c7c7',
        action: null
      });
      return list;
    }

    if (current === 'menu') {
      var settings = view.save.settings || { autoBattle: false, sfx: true, bgm: true, vibrate: true };
      var audio = view.audio || null;
      // A6：属性面板的入口（与背包里的「角色属性」是同一个面板）
      list.push({
        id: 'menu:stat',
        y: top,
        h: rowH,
        icon: { kind: 'ui', key: 'stat' },
        text: '角色属性',
        sub: '等级基础与装备加成逐项对照（攻击 / 生命 / 攻速 / 暴击 / 减伤…）',
        color: '#a9d5ff',
        action: { type: 'open', panel: 'stat' }
      });
      list.push({
        id: 'menu:selftest',
        y: top + rowH,
        h: rowH,
        icon: { kind: 'ui', key: 'menu' },
        text: '立即跑自检',
        sub: '地图确定性 / 伤害 / 掉箱 / 装备 / 升级曲线 / 账号与界面 / 技能栏，四百多项断言当场出结果',
        color: '#8ce99a',
        action: { type: 'selftest' }
      });
      list.push({
        id: 'menu:cloud',
        y: top + rowH * 2,
        h: rowH,
        text: '云后端连通性自测',
        sub: '部署抖音云后把域名填进 00-config.js 的 cloudBase，这里会调一次 /api/health',
        color: '#a9d5ff',
        action: { type: 'cloudPing' }
      });
      list.push({
        id: 'menu:debug',
        y: top + rowH * 3,
        h: rowH,
        text: (view.debug ? '关闭' : '打开') + '调试面板',
        sub: 'FPS / chunk 数 / 活跃怪 / 当前目标 / 世界种子',
        color: '#ffd479',
        action: { type: 'toggleDebug' }
      });
      // A11 之二：**视角缩放滚动轴**（用户："玩家设置中添加视角缩放滚动轴，可以缩到16-64"）。
      // 它是设置面板里唯一"拖"出来的控件：按下即跳到手指位置、拖动不吃滚动、松手才写存档。
      // x / w 显式给出来 —— 命中测试与轨道坐标因此读同一份几何（`sliderTilesAt` 也按它算）。
      var zoomBox = contentRect();
      var zoomConfig = sliderConfig();
      var zoomNow = view.zoom && view.zoom.tiles > 0 ? view.zoom.tiles : BAL.view.zoomTiles;
      list.push({
        id: 'menu:zoom',
        kind: 'slider',
        x: zoomBox.x,
        w: zoomBox.w,
        y: top + rowH * 4,
        h: rowH,
        pad: 10,
        text: '视角缩放',
        sub: '拖动圆钮：一屏 ' + zoomConfig.minTiles + ' ~ ' + zoomConfig.maxTiles +
          ' 格（左 = 拉近看细节，右 = 拉远看范围；整格走）',
        valueText: '一屏 ' + zoomNow + ' 格' + (view.zoom && view.zoom.tileCssPx > 0 ? ' · 一格 ' + view.zoom.tileCssPx + ' CSS px' : ''),
        color: '#ffd479',
        tiles: zoomNow
      });
      list.push({
        id: 'menu:sfx',
        y: top + rowH * 5,
        h: rowH,
        text: '音效：' + (settings.sfx ? '开' : '关'),
        sub: '命中 / 暴击 / 击杀 / 受伤 / 升级 / 开箱（音量在 balance.audio，声音文件由工具生成）',
        color: settings.sfx ? '#8ce99a' : '#8d8d8d',
        action: { type: 'toggleSfx' }
      });
      list.push({
        id: 'menu:bgm',
        y: top + rowH * 6,
        h: rowH,
        text: '背景音乐：' + (settings.bgm ? '开' : '关'),
        sub: audio && audio.supported ? '首次触摸后才会响（平台要求）' : '当前环境没有音频接口（模拟器里可能如此）',
        color: settings.bgm ? '#8ce99a' : '#8d8d8d',
        action: { type: 'toggleBgm' }
      });
      list.push({
        id: 'menu:vibrate',
        y: top + rowH * 7,
        h: rowH,
        text: '震动：' + (settings.vibrate ? '开' : '关'),
        sub: '暴击与挨打时短震一下（暴击的手感一半在手上）',
        color: settings.vibrate ? '#8ce99a' : '#8d8d8d',
        action: { type: 'toggleVibrate' }
      });
      list.push({
        id: 'menu:reset',
        y: top + rowH * 8,
        h: rowH,
        text: '重置本地存档',
        sub: view.resetArmed ? '再点一次真的删（等级 / 装备 / 宝箱全清，角色名保留）' : '点一下先确认',
        color: view.resetArmed ? '#ff8a8a' : '#c7c7c7',
        action: { type: 'resetSave' }
      });
    }

    if (current === 'stat') {
      // A10：属性面板 = 抬头（头像 / 等级 / 经验条 / 战力）+ 一行一张的属性卡。
      // 数据仍然来自 PLAYER.breakdown（"等级基础 vs 装备加成"分开写），面板只排排版（决策 #4）
      var statConfig = layout();
      var statBox = contentRect();
      var statList = G.PLAYER.breakdown(view.save.level, view.save.loadout);
      var statNeed = PROG.xpToNext(view.save.level);
      list.push({
        id: 'stat:head',
        kind: 'header',
        hit: false,
        x: statBox.x,
        w: statBox.w,
        y: top,
        h: 150,
        pad: 0,
        text: view.save.name || '无名者',
        sub: 'Lv.' + view.save.level + ' · 经验 ' + PROG.shortNumber(view.save.exp) + ' / ' + PROG.shortNumber(statNeed),
        value: '战力 ' + view.stats.power,
        valueText: '四件装备战力之和（不参与战斗结算）',
        ratio: statNeed > 0 ? view.save.exp / statNeed : 0,
        seed: G.RNG.hash32(G.ACCOUNT.nameKey(view.save.name || '').length * 31, view.save.level | 0, 0x51a7c3)
      });
      top += 150 + statConfig.cellGap;
      for (i = 0; i < statList.length; i += 1) {
        list.push({
          id: 'stat:' + i,
          kind: 'statCard',
          hit: false,
          action: null,
          x: statBox.x,
          w: statBox.w,
          y: top + i * (statConfig.statCardHeight + statConfig.cellGap),
          h: statConfig.statCardHeight,
          pad: 0,
          iconKey: statList[i].icon,
          label: statList[i].label,
          value: statList[i].value,
          text: statList[i].label + '：' + statList[i].value,
          sub: statList[i].sub,
          color: statList[i].color || '#e8f1ff'
        });
      }
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

  /**
   * 命中测试：点落在哪一块上。只认视口里的、`hit !== false` 的块，而且**横向与纵向都要落进去**：
   *   - 横向：块自己给了 `x` / `w` 就用它（网格里的一格），没给就默认铺满内容区（列表行）；
   *   - 纵向：`pad` 是块底部的留白（列表行 10、格子 0），上下各放宽 6 设计像素让手指好点。
   * A10 起面板里"大块背景"（角色预览）与"一格一格"的格子混排，这两条缺一不可：
   * 背景块标了 `hit: false`（它不吃触摸），点击才落得到压在上面的装备槽 / 背包格上。
   */
  function rowAt(point, view) {
    var area = viewport();
    if (point.y < area.y || point.y > area.y + area.h) return null;
    var box = contentRect();
    var list = rows(view);
    for (var i = 0; i < list.length; i += 1) {
      var row = list[i];
      if (row.hit === false) continue;
      var x = row.x === undefined ? box.x : row.x;
      var w = row.w === undefined ? box.w : row.w;
      var pad = row.pad === undefined ? 10 : row.pad;
      if (point.x < x - 6 || point.x > x + w + 6) continue;
      if (point.y >= row.y - 6 && point.y <= row.y + row.h - pad + 6) return row;
    }
    return null;
  }

  /**
   * 这一点在不在**背包的格子块**里（本次新增）：翻页手势的势力范围。
   * `bagGridRect` 来自最近一次 buildRows（`rowAt` / `rows` 都会重算它），所以判到的就是屏幕上那一块。
   */
  function inBagGrid(point) {
    if (current !== 'bag' || !bagGridRect || !point) return false;
    return (
      point.x >= bagGridRect.x &&
      point.x <= bagGridRect.x + bagGridRect.w &&
      point.y >= bagGridRect.y &&
      point.y <= bagGridRect.y + bagGridRect.h
    );
  }

  /**
   * 按下：先判关闭键，再判卡片内的行（松手时才算点击，中途滑走 / 滚动就取消）。
   *
   * A11 之二：命中的是**缩放轴**时立刻把值跳到手指位置（滑块的标准手感：点轨道 = 跳到那一点），
   * 并记下 `sliderRow` —— 后面的 move 就走"拖滑块"而不是"滚卡片"。
   *
   * 本次新增：命中的是**背包格那一块**时记下 `bagDrag` —— 后面的 move 走"翻页"而不是"滚卡片"
   * （两种手势各自消费自己那一笔，互不吃；按下时先不翻页，手指动起来才翻）。
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
    sliderRow = null;
    bagDrag = null;
    var row = rowAt(point, view);
    pressedRowId = row ? row.id : null;
    if (row && row.kind === 'slider') {
      sliderRow = row;
      sliderTiles = sliderTilesAt(point.x);
    } else if (inBagGrid(point)) {
      // 按在背包格子上：这一笔手势归"翻页"（move 里改 bagRow），松手时若没拖动才算点那一格
      bagDrag = { y: point.y, row: bagRow };
    }
    return pressedRowId;
  }

  /**
   * 拖动：**三类手势各自消费自己那一笔**，优先级 = 缩放轴 → 背包翻页 → 卡片滚动。
   * 缩放轴左右拖 = 改缩放；背包格子上拖 = 翻页；其余地方上下拖 = 滚卡片内容。
   * 一旦超过 `touchSlop` 就把"按下命中的那一行"作废 —— 手指滑过一行不该算点了它。
   */
  function move(point, view) {
    if (!current || pressedClose) return false;
    if (sliderRow) {
      sliderTiles = sliderTilesAt(point.x);
      return true;
    }
    // 背包翻页（本次新增）：往上拖看后面的装备，**一格一格走**（半个行距翻一页），卡片不跟着滚
    if (bagDrag) {
      var pitch = layout().gridCellHeight + layout().cellGap;
      var offset = bagDrag.y - point.y;
      if (!dragging && Math.abs(offset) > BAL.view.panel.touchSlop) {
        dragging = true;
        pressedRowId = null;
      }
      var want = bagDrag.row + Math.round(offset / pitch);
      if (want < 0) want = 0;
      if (want > bagMaxRow) want = bagMaxRow;
      if (want !== bagRow) {
        bagRow = want;
        return true;
      }
      return dragging;
    }
    var dy = point.y - pressY;
    if (!dragging && Math.abs(dy) > BAL.view.panel.touchSlop) {
      dragging = true;
      pressedRowId = null;
    }
    if (!dragging) return false;
    setScroll(pressScroll - dy, view);
    return true;
  }

  /**
   * 松手：关闭键 → close；拖动过 → 什么都不触发；缩放轴 → 交出拖到的格数；否则命中行 → 该行的 action。
   * 缩放轴把 action 放在这里（而不是按下时）是有意的：**拖的过程中不写存档**，
   * 只有松手那一下才落盘（拖动过程由 20-main 每帧静默应用，见 `sliderDrag`）。
   * 背包翻页同理：拖过就只翻页（不触发那一格的 action），没拖过才算"点了一下那一格"。
   */
  function release(point, view) {
    if (!current) return null;
    if (pressedClose) {
      pressedClose = false;
      return { type: 'close' };
    }
    if (sliderRow) {
      var tiles = sliderTiles;
      sliderRow = null;
      sliderTiles = 0;
      pressedRowId = null;
      return { type: 'setZoomTiles', tiles: tiles };
    }
    if (bagDrag) {
      var paged = dragging;
      bagDrag = null;
      dragging = false;
      if (paged) {
        pressedRowId = null;
        return null;
      }
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

  /**
   * 正在拖的缩放轴（A11 之二）：20-main 每帧问一次，拿它**边拖边缩放**。
   * 返回 null = 没在拖；返回的 tiles 是"一屏几格"（整数）。
   */
  function sliderDrag() {
    return sliderRow ? { id: sliderRow.id, tiles: sliderTiles } : null;
  }

  /** 标题下面的一行小字：让玩家知道自己在哪个面板、身上有多少钱 */
  function headerLine(view) {
    return 'Lv.' + view.save.level + ' · 金币 ' + view.save.gold + ' · 战力 ' + view.stats.power + ' · 宝箱 ' + view.save.chests.length;
  }

  /**
   * 面板主绘制：一层**很淡**的暗底（世界仍然看得见 —— "打开界面游戏不停止"的视觉表达）
   * 加一张约占 2/3 屏高（2026-10-01 用户从 1/3 屏改过来）的卡片。卡片 = 标题栏（标题 + 右上关闭键）+ 内容视口（行；超长就滚）。
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
      // 视口外的块直接跳过（省落笔，也不让 clip 白算）
      if (row.y + row.h < area.y - 4 || row.y > area.y + area.h + 4) continue;
      // A10：块的类型决定画法（值日表就是 PAINTERS）；认不出的类型退化成"行"，加新块不会白屏
      var painter = PAINTERS[row.kind] || paintRow;
      painter(ctx, area, row, pressedRowId === row.id);
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
    if (panel === 'stat') return '角色属性';
    if (panel === 'shop') return '商城';
    if (panel === 'enhance') return '铁匠 · 强化';
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
    sliderDrag: sliderDrag,
    sliderTilesAt: sliderTilesAt,
    rect: rect,
    viewport: viewport,
    contains: contains,
    maxScroll: maxScroll,
    setScroll: setScroll,
    scrollOffset: scrollOffset,
    bagScroll: bagScroll,
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
    /** 加入公会那一行的名字草稿（本次新增：与创建的草稿分开存） */
    joinDraftName: function () {
      return joinDraftName;
    },
    setJoinDraftName: function (name) {
      joinDraftName = name;
    },
    agoText: agoText,
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
        icon: 'login',
        label: hasAccount ? '继续游戏（登录）' : '登录 / 开始游戏',
        x: left,
        y: card.y + 196,
        w: wide,
        h: 78
      });
      list.push({
        id: 'newAccount',
        icon: 'trash',
        label: armed ? '再点一次：清掉本机账号' : '清掉本机账号（调试）',
        x: left,
        y: card.y + 292,
        w: wide,
        h: 54
      });
      return list;
    }
    list.push({ id: 'typeName', icon: 'keyboard', label: '输入昵称', x: left, y: card.y + 196, w: wide, h: 64 });
    list.push({ id: 'randomName', icon: 'dice', label: '换一个随机昵称', x: left, y: card.y + 270, w: wide, h: 58 });
    list.push({
      id: 'createRole',
      icon: 'user',
      label: draft ? '创建角色并进入游戏' : '先输入昵称',
      enabled: draft.length > 0,
      x: left,
      y: card.y + 342,
      w: wide,
      h: 70
    });
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

  /**
   * 画一个矩形按钮：底 + 描边 + **左侧图标** + 文案。
   *
   * A6 修的 bug：以前这里只画底与边框，文案靠别处补 —— 而补字那一步漏了
   * （2026-09-30 真机验收："登录 / 注册页面的按钮上没有显示对应操作的文字"）。
   * 现在**按钮自己负责自己的字**：画按钮的地方就是唯一一处，不会再出现"按钮画了、字没画"。
   * 19-selftest 里加了一条断言盯着它（假 canvas 会记下 fillText 的每一段文案）。
   */
  function painted(ctx, button, pressed) {
    var enabled = button.enabled !== false;
    ctx.fillStyle = pressed ? '#ffd479' : enabled ? '#1b2438' : '#141a26';
    ctx.fillRect(button.x, button.y, button.w, button.h);
    ctx.strokeStyle = pressed ? '#fff3d0' : enabled ? '#4d5f86' : '#38415a';
    ctx.lineWidth = 3;
    ctx.strokeRect(button.x, button.y, button.w, button.h);

    var iconSize = Math.min(button.h * 0.62, 44);
    var centerY = button.y + button.h / 2;
    var textLeft = button.x + 16;
    if (button.icon) {
      var iconX = textLeft + iconSize / 2;
      G.ICONS.button(ctx, button.icon, iconX, centerY, iconSize, pressed ? '#241a05' : enabled ? '#ffd479' : '#5c6b8a');
      textLeft = iconX + iconSize / 2 + 12;
    }
    var size = Math.min(28, button.h * 0.36);
    if (button.label.length > 12) size = Math.min(size, 23);
    G.HUD.text(
      ctx,
      button.label,
      textLeft + (button.x + button.w - 16 - textLeft) / 2,
      centerY,
      size,
      pressed ? '#241a05' : enabled ? '#e8f1ff' : '#7d8aa3',
      'center'
    );
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
    isBusy: isBusy,
    setHasAccount: setHasAccount,
    isArmed: isArmed,
    rect: rect,
    buttons: buttons,
    press: press,
    release: release,
    draw: draw
  };
})();

