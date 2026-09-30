# 技术架构 · 竖屏无限地图冒险（v1 草案）

> 玩法见 `01-game-design.md`，阶段与未决事项见 `03-roadmap.md`。
> 设计原则沿用上一版工程验证过的三条：**常量只有一份**、**平台差异集中在一个目录**、**能无头自动验证的就不靠肉眼**。

## 1. 硬约束（这四条决定了架构长什么样）

| 约束 | 后果 |
|---|---|
| 抖音小游戏**没有 DOM** | UI 全部自绘；不能用 Phaser（无可用适配层）、不能用 HTML 覆盖层、不能用 `localStorage`（要用 `tt.setStorage`） |
| 主包体积有限（≤ 4 MB 量级） | 贴图必须图集化 + 分包/远程加载；素材不能随便堆 |
| 网络只允许 **https/wss + 后台白名单域名** | 实时联机必须有一个**已备案域名 + 证书**的服务端；IP 直连不行 |
| 竖屏 + 单手 | UI 锚点布局；输入层 = 摇杆 + 少量按钮 |

**结论：渲染必须平台无关、网络必须走合法域名、UI 必须自绘；而且因为只做小游戏端（决策 #7），逻辑层必须能在 node 里无头断言。**

## 2. 分层与目录结构（提案）

```
src\
├─ main.ts                 入口：平台探测 → 屏幕适配 → 主循环 → 流程状态机
├─ platform\               ★ 唯一的平台差异层（小游戏 / 浏览器）
│  ├─ index.ts             统一接口：storage、登录、触摸、生命周期、震动
│  ├─ douyin.ts            tt.login / tt.setStorage / tt.onTouchStart / tt.onShow
│  └─ mock.ts              测试替身（仅供 node 断言测试注入，不发行）
├─ core\                   引擎层（与玩法、平台都无关，可单测）
│  ├─ loop.ts              固定步长逻辑（60 Hz）+ 渲染
│  ├─ screen.ts            竖屏适配：设计宽 720、fit-width、可变逻辑高度、安全区
│  ├─ camera.ts            跟随相机 + 世界⇄屏幕换算 + 视野矩形
│  ├─ rng.ts               ★ 确定性哈希与伪随机（跨端一致）
│  ├─ pool.ts              对象池（怪 / 飘字 / 快照包）
│  └─ events.ts            极简事件总线
├─ world\                  ★ 无限地图
│  ├─ chunk.ts             chunk ↔ 世界坐标、chunkKey、边界
│  ├─ terrain.ts           确定性地表与装饰（按 band 换主题配色）
│  ├─ spawn.ts             chunk 内怪与地标的确定性播种
│  ├─ chunkStore.ts        已加载 chunk 的 LRU 缓存与卸载
│  └─ aoi.ts               视野内实体集合（客户端裁剪）
├─ game\                   玩法层（纯逻辑：不碰 canvas、不碰平台 API）
│  ├─ player.ts            移动、等级、属性汇总
│  ├─ monster.ts           怪实体与表现状态（**权威在服务端**，本地只做插值）
│  ├─ combat.ts            自动选目标 + 上报攻击意图 + 伤害的本地预测显示
│  ├─ loot.ts              六阶宝箱掉落表与保底计数
│  ├─ equipment.ts         装备生成 / 词条 / 战力 / 对比
│  ├─ chest.ts             开箱流程
│  ├─ guild.ts             公会锚点与传送冷却
│  └─ shop.ts              商城（号角等）
├─ render\                 绘制层（只依赖 canvas 2D 上下文）
│  ├─ atlas.ts             图集加载与切图
│  ├─ worldRender.ts       地表 + 实体 + 飘字（视锥裁剪）
│  ├─ hud.ts               顶部经验条 / 货币 / 角标
│  └─ panels\              自绘面板：背包 / 装备 / 商城 / 公会 / 开箱 / 设置
├─ net\                    通信层
│  ├─ api.ts               REST（登录 / 存档 / 开箱 / 商城 / 公会）
│  ├─ realtime.ts          WebSocket：订阅、快照、重连
│  └─ protocol.ts          消息类型（与 server 共用同一份定义）
└─ ui\flow.ts              流程状态机：启动 → 登录 → 进世界（面板叠加）

shared\                    前后端共用（唯一真相）
├─ balance.json            ★ 全部数值与掉落表（见玩法文档 §13）
└─ protocol.ts             消息类型（前后端共用）
server\                    后端（Node + ws + SQLite，沿用上一版验证过的组合）
├─ index.mjs / http.mjs    启动与路由
├─ auth.mjs                tt.login 的 code → openid → 会话
├─ world.mjs               活跃 chunk 管理 + **服务端权威的怪 AI 与重生**
├─ aoi.mjs                 chunk 订阅表与广播
├─ combat.mjs              伤害 / 经验结算（权威）
├─ loot.mjs                开箱抽奖与装备生成（权威、服务端随机）
├─ guild.mjs               公会 / 锚点 / 成员
├─ db.mjs                  SQLite 表与迁移
└─ selfcheck.mjs           零依赖自检（迁移 / 结算 / 公会规则）
tools\                     构建与验证
├─ test-logic.mjs          无头断言测试（node 直接跑 core/ world/ game/，无需浏览器）
├─ atlas.mjs               贴图打包（图集 + 切图清单）
├─ build-minigame.ps1      源码 → 小游戏可执行文件（确定性拼装）
└─ check-minigame.ps1      静态校验（无 DOM / 无 Math.random / 常量同步 / 包体）
docs\design\               本目录
```

**三条分层铁律**（每条都是被坑出来的）：

1. `game\` 里**禁止**出现 `document` / `canvas` / `tt.` / `window` —— 它是纯逻辑，才能被无头测试直接跑。
2. `core\rng.ts` 之外**禁止** `Math.random()` —— 无限地图要"同坐标同内容"，客户端与服务端必须算出完全一样的结果；静态校验会扫这一条。
3. 数值只在 `shared\balance.json`，两端共读，不各写一套（上一版 `shared\world.json` 就是这么治住前后端漂移的）。

## 3. 无限地图怎么做到「无限」又「人人一致」

**地图不是数据，是一个函数**：

```
chunkKey(cx, cy) → hash32(seed, cx, cy, salt) → mulberry32 → 该 chunk 的全部内容
```

| 元素 | 生成规则（草案） |
|---|---|
| 地表 | 按 band 选配色主题（原点=草原 → 荒漠 → 雪原 → 焦土 → 虚境），chunk 内用确定性噪声做色块过渡 |
| 装饰 | 每 chunk 播种 8~24 个草/石/枯树，纯视觉、**无碰撞** |
| 怪 | 每 chunk 1~3 只，位置/种类/等级/是否精英全部由哈希决定 |
| 宝箱 | **不在地图上摆**，只从怪身上掉（实现简单、语义清晰） |
| 地标 | 每 5×5 chunk 一个（废墟/石碑），给"我走到新地方了"的反馈，也是公会锚点的候选点 |

**两条硬规矩**：

1. **哈希输入必须整数**：用 `Math.floor(x / chunkSize)`，绝不拿浮点当哈希输入（浮点在不同机器上可能差 1 个 ULP，会让 chunk 边界两侧内容错位）。
2. **只用 32 位整数运算**（`Math.imul`、`>>>`、`^`），**不用 `Math.sin`/`Math.cos` 参与生成** —— 不同 JS 引擎的三角函数实现可能有细微差异，客户端和服务端会算出不同的地图。

## 4. 「只加载视野内」= 客户端裁剪 + 服务端 AOI

**客户端（每帧）**：

1. 相机矩形 → 覆盖到的 chunk 集合（竖屏 720×1280、chunk 512 → 约 2×4 = 8 个，加一圈预载 ≈ 12 个）；
2. `chunkStore` 只保留这些 chunk，**LRU 上限 48**，超出即卸载（实体对象回收进池）；
3. 渲染只画相机矩形内的实体（视锥裁剪）；
4. 离屏的怪**不跑 AI**（省 CPU），但位置状态留在 chunk 里，走回来时接着演。

**服务端（AOI / 兴趣管理）**：

1. 每个在线玩家的"订阅集合" = 所在 chunk + 周围一圈（3×3）；
2. 玩家跨 chunk 移动 → 退订离开的、订阅新进入的；
3. 快照（10~20 Hz）**只发给订阅了该 chunk 的玩家**，内容 = **附近玩家 + 附近的怪（位置/血量/状态）+ 公会锚点**；
4. **没有人订阅的 chunk，服务端不模拟**（怪状态直接丢弃，只留"最后活跃时间"，玩家回来时按规则重生）。

> 这是"无限地图 + 多人"唯一现实的解法：**服务端开销与在线人数成正比，与地图大小无关**。

## 5. 权威模型（什么放哪边）

| 内容 | 客户端 | 服务端 | 理由 |
|---|---|---|---|
| 移动位置 | **主导**（本地即时响应） | 校验（速度上限、瞬移、chunk 订阅） | 无限地图上全量模拟成本过高；上一版已验证这套够用 |
| 怪 AI（位置 / 血量 / 仇恨 / 重生） | **不模拟**，只做插值与表现 | **权威**（服务端跑 AI 与伤害） | 决策 #1：怪是全服共享实体，服务端必须是唯一事实源 |
| 伤害与血量 | 预测显示（保证手感跟手） | **权威** | 客户端只上报"攻击意图"，不上报伤害数值 |
| 奖励归属 | 只显示结果 | **权威**（累计伤害最高的玩家得经验 + 宝箱） | 决策 #1 的核心规则，绝不能由客户端判定 |
| 经验 / 等级 / 货币 | 只显示 | **权威** | 改一行数字就能满级，必须服务端 |
| 开箱 | 播动画 | **权威**（概率 + 装备生成） | 同上 |
| 公会（成员/锚点/冷却） | 面板请求 | **权威** | 纠纷高发区 |
| 附近玩家可见性 | 渲染 | **权威**（AOI 广播） | 客户端不能自己决定看见谁 |

**断线保护**：客户端断开超过 10 秒，服务端停止为其广播；重连时客户端重新订阅 chunk 并全量拉一次附近状态（避免"幽灵玩家"永久留在别人屏幕上）。

## 6. 协议草案

**REST（`/api`，一次性、可重试的请求）**：

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/api/auth/login` | `tt.login` 的 code → 会话 token |
| GET | `/api/profile` | 角色全量：等级 / 经验 / 货币 / 最后位置 / 保底计数 |
| GET | `/api/inventory` | 背包与已穿装备 |
| POST | `/api/inventory/equip` | 穿 / 脱装备 |
| POST | `/api/inventory/salvage` | 批量分解 |
| POST | `/api/chest/open` | 开箱（服务端抽奖） |
| POST | `/api/shop/buy` | 买号角等 |
| GET | `/api/guild` | 公会信息（我的 / 按名查询） |
| POST | `/api/guild/create` `/invite` `/join` `/leave` `/kick` | 公会管理 |
| POST | `/api/guild/anchor` | 设置 / 迁移锚点 |

> **2026-09-30 实现现状**（避免和后面对不上）：竖线以上是**目标协议**；抖音云那边已经落地的只有
> `/api/health`、`/api/version`、`/api/profile`（= 上表的 login 与 profile 合在一个端点：真 `code2session`
> 换 openid + 签发无状态令牌 + 回存档摘要）、`/api/save`（GET/POST）。`/api/inventory*`、`/api/chest/open`、
> `/api/shop/*`、`/api/guild*` 都还是目标，没写。等第 3 步（服务端权威化）再逐个补，届时**再决定要不要
> 把登录拆成 `/api/auth/login`** —— 现在合成一个端点是因为客户端少一次往返、且首版没有"只换 token 不取 profile"
> 的场景。

**WebSocket（`/ws`，高频、可丢、需重连）**：

| 方向 | 消息 | 说明 |
|---|---|---|
| C→S | `move{seq, x, y, t}` | 位置输入（节流 10 Hz，坐标整数化） |
| C→S | `sub{chunks[]}` / `unsub{chunks[]}` | 订阅 / 退订 chunk（AOI） |
| C→S | `attack{monsterId, t}` | **攻击意图**（"我在打这只"）；伤害与血量由服务端结算，**客户端不上报伤害数值** |
| S→C | `snap{players[], monsters[], guildAnchors[]}` | 附近**玩家 + 怪**（位置/血量/状态）+ 公会锚点快照（20 Hz） |
| S→C | `loot{monsterId, winner, expGain, level, chest?}` | 击杀结算：**奖励归累计伤害最高的玩家**，其余人只看到怪消失 |
| S→C | `pong{t}` | 时钟同步 / 保活 |

> 阶段 A 不需要这套协议的任何一条 —— 它是给阶段 B/C 预埋的；现在写下来只为**把接口形状先定死**，避免以后返工。

## 7. 数据模型（SQLite 草案）

```sql
account      (id, platform, platform_uid, nickname, created_at)      -- platform: 'douyin' | 'guest'
character    (id, account_id, level, exp, gold, diamond,
              last_x, last_y, spawned, last_seen_at)                 -- spawned: 是否已随机出生过
item         (id, character_id, slot, tier, level_req, base_json, affixes_json,
              equipped, obtained_at, source)                         -- source 用来查"掉落记录"
chest_stat   (character_id, bag, opened_total, pity_epic, pity_mythic)   -- 保底计数
chest_log    (id, character_id, tier, item_id, at)                   -- 开箱流水（客服/纠纷用）
guild        (id, name, leader_character_id, anchor_x, anchor_y,
              created_at, anchor_moved_at)                           -- name 唯一索引
guild_member (guild_id, character_id, role, joined_at)               -- role: leader | member
session      (token, account_id, issued_at, expires_at)
```

- **索引**：`guild.name` 唯一；`guild_member.character_id` 唯一（一人只能在一个公会）；`item.character_id`。
- 迁移写在 `server\db.mjs`，用 `PRAGMA user_version` 做版本号 —— 上一版验证过的零依赖做法（可重放、可自检）。

## 8. 平台差异只在一个目录里

```ts
// platform\index.ts —— 上层只认这个接口，不认 tt / window
export interface Platform {
  readonly name: 'douyin' | 'web';
  login(): Promise<{ code: string }>;                       // 抖音：tt.login；web：游客号
  getStorage(key: string): string | null;                   // tt.getStorageSync / localStorage
  setStorage(key: string, value: string): void;
  onTouch(handler: (ev: TouchLike) => void): void;          // tt.onTouchStart / canvas 事件
  vibrate(ms: number): void;
  screen(): { cssW: number; cssH: number; dpr: number };    // tt.getSystemInfoSync / window
}
```

- 新增平台（例如微信小游戏）只需再写一个实现，**玩法层零改动** —— 这是"以后不用推倒重来"的保险。
- 小游戏端注意：触摸坐标是**屏幕 CSS 像素**，必须和设计宽 720 做一次缩放换算，不能直接当世界坐标用。

## 9. 性能预算（竖屏手机，目标 60 fps）

| 项 | 上限 | 手段 |
|---|---|---|
| 视野内实体 | 怪 ≤ 30、玩家 ≤ 20、飘字 ≤ 40、装饰 ≤ 200 | AOI 裁剪 + 超出不画 |
| 每帧**落笔**次数 | ≤ 900（2026-09-30 实测最坏 737，见下） | 视锥裁剪 + 粗筛（营地 / 路网）+ 同色合并；`tools\perf-frame.mjs` 量 |
| 内存 | 已加载 chunk ≤ 48；贴图显存 ≤ 64 MB | LRU 卸载 + 图集复用 |
| GC 压力 | 每帧新对象 ≤ 20 | 对象池（怪 / 飘字 / 网络包） |
| 网络 | 上行 ≤ 3 KB/s，下行 ≤ 20 KB/s | 位置 10 Hz、快照 20 Hz、坐标整数化 |
| **服务端 CPU** | 单核约 200 并发（全服共享怪 = 服务端要跑 AI） | 每区块怪 ≤ 3 只；AI **分帧 tick**（每帧只算 1/4 的怪）；没人订阅的区块立即停算 |

> **"每帧绘制调用"这一行在 2026-09-30 用实测替换了估算。** 原来写的 ≤ 400 是"所有实体都是圆"时代的
> 拍脑袋值。换成程序自绘角色 + 原点营地 + 小径路网（阶段 A3）之后，`tools\perf-frame.mjs`
> （假 canvas 逐层数"落笔"= fill / stroke / fillRect / fillText）实测：
>
> | 场景 | 落笔/帧 |
> |---|---|
> | 野外（怪最多时） | 593 |
> | 站在原点营地里 | 729 |
> | 营地 + 调试面板（最坏） | **737** |
> | 跑到很远的深带 | 525 |
>
> 逐层拆分（营地那帧）：地表 + 石砖 247 · 装饰 244 · 怪 136 · 营地道具 52 · HUD + 小地图 29 ·
> 玩家 14 · 小径路网 **2**。这些几乎全是**无渐变、无阴影、无文字**的纯色填充，
> 手机 Canvas 2D 一帧几千次落笔是常态 —— 但上限必须要有个数，所以新预算是 **≤ 900**。
> 真机 60fps 仍是最终裁判（IDE 模拟器 + 真机预览）；这个脚本的作用是**在"感觉卡"之前**指出是哪一层涨了。
> （顺带记一笔：石砖地一开始用 48px 砖，实测这一项就要 550 次落笔/帧，改成 96px 后降到 ~65 —— 数据比直觉准。）

## 10. 验证策略（沿用上一版最值钱的部分）

| 手段 | 覆盖 | 为什么必须有 |
|---|---|---|
| `npm run typecheck` | TS 严格模式 | 秒级、最便宜的护栏 |
| `npm run test:server` | 迁移 / 登录 / 结算 / **掉落概率分布** / 公会规则（纯断言、零依赖） | 概率与公会是纠纷源，必须用断言锁住 |
| `tools\test-logic.mjs` 无头断言 | 在 **node 里直接跑** `core/ world/ game/`（不涉及画布）：地图确定性（同坐标必同结果）、自动选目标、**伤害与"最高伤害者得奖励"的结算**、掉箱概率分布、等级曲线、公会规则、AOI 订阅集合 | 决策 #7 不写 web 端，所以验证重心移到**逻辑层** —— 这些恰恰是最容易错、最值得断言的部分 |
| 游戏内调试面板（F1） | 实时显示：FPS、实体数、已加载 chunk、当前目标、伤害日志、地图种子 | 渲染与手感只能靠人眼，但有面板后"人眼验收"也有据可依 |
| `tools\check-minigame.ps1` 静态校验 | 生成物与源码同步 / 无 DOM API / **无 `Math.random`** / 数值常量同步 / 包体大小 | 小游戏端跑不了 node 测试，只能静态卡住红线 |
| 抖音 IDE 预览 | 真机竖屏、触摸手感、包体、真机性能 | 最终验收，前面四关都过了才轮到这里 |


