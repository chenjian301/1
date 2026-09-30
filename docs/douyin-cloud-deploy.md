# 抖音云后端部署（阶段 B 的第一步）

> 目标：让这个小游戏**有一个自己的后端**，并且能验证"从手机上的小游戏能调到它"。
> 本文只写抖音云这条路（决策 #2），**不用你现在那台云服务器**。
>
> 服务端代码就在本仓库：`douyin-cloud\svr\index.js`（**零依赖** Node HTTP 服务）。
> 它现在提供 4 个端点，足够把"登录 → 云存档"这条链路先接起来。
>
> **2026-09-30 复核（先看这三条，能省掉一小时）**：
>
> 1. 官方 Node+koa 模板那次部署记在 `docs\douyin-minigame-stage0.md` §9：服务 `demo-svr`、dev 环境、
>    默认域名 `https://1mfj3tamsd9m-env-XHvhMYJ9qm.service.douyincloud.run`、外网路径 `/api/*` 已授权。
>    **那个域名现在已失效**：`GET /` 回 `404 + X-Status-Code: 13005 not found server`（网关说该环境下
>    没有这个服务），`GET /api/health` 直接连接超时。→ **本文里出现的任何具体域名都只是历史痕迹，一律以控制台现值为准。**
> 2. 控制台里现在活着的是**模板演示服务** `auto_deploy_add`（外网路径 `/api/*` 已授权）。它是官方模板，
>    路由只有 `GET /api/get_open_id` 与 `POST /api/text/antidirt` —— **没有 `/api/health`**。
>    要验的是**我们自己的代码**（第 0.5 / 2 步），别把"模板部署成功"当成"后端已就绪"。
> 3. **抖音云只有控制台里的「Git 代码 / Docker 镜像」两种部署方式，没有官方 CLI**
>    （官方模板仓库 README 原文）。也就是说"把代码推上去"这最后一步**无法脚本自动化**；
>    但它前面每一步都能，见 §0.5。
>
> 下面是完整步骤。

---

## 0. 一页速览

| 步骤 | 在哪做 | 耗时 |
|---|---|---|
| 1. 新建服务（Node 运行环境，dev 环境） | 抖音开放平台 → 控制台 → 抖音云 | 2 分钟 |
| 2. 上传 `douyin-cloud\svr` 的代码并部署 | 同一页面（代码包 / 在线编辑 / Docker 镜像三选一） | 3 分钟 |
| 3. 授权外网访问路径 `/api/*` | 服务详情 → 访问控制 | 1 分钟 |
| 4. 抄下默认域名 | 服务详情 → 域名 | — |
| 5. 把域名填进 `douyin-minigame\src\00-config.js` 的 `cloudBase` | 本地 | 1 分钟 |
| 6. 重新拼装 + 自检 → 在游戏里点「云后端连通性自测」 | 本地 + IDE | 2 分钟 |

**费用**：抖音云按资源与出网流量计费，dev 环境通常有免费额度；具体数字以控制台「产品计费」为准
（阶段 B 开工前要确认长连接与出网流量的计费，见决策 #2）。**这一步不产生真实支付**。

---

## 0.5 上传前先在本地过一关（2026-09-30 新增）

服务端"上去才知道起不来"是最贵的错：控制台日志看不到进程为什么退出。所以现在有一道本地关卡，
**全在仓库里，不连抖音云**：

```powershell
powershell -ExecutionPolicy Bypass -File tools\cloud-pack.ps1
# ① 用真进程 + 真 HTTP 请求跑 douyin-cloud\svr\smoke.mjs（41 项断言：3 个真实例 127.0.0.1:8099/8101/8102
#    + 一个**假 code2session** 在 8100 —— 登录链路也在这里整条跑通，不连抖音云、不花一分钱）
# ② 绿的才打包 → douyin-cloud\dist\svr-code-<时间戳>.zip（里面只有 index.js + package.json）
# ③ 打印控制台剩下要做的事
```

**这不是形式主义。** 2026-09-30 就靠它抓到一个只有"真跑一次"才会暴露的 bug：`svr\index.js` 的
`readBody` 函数体漏了一个 `}`，于是 `http.createServer` 与 `server.listen` 全被吞进了那个函数体内 ——
`node --check` **通过**（语法合法），进程启动后**静默退出、根本不监听任何端口**（curl 只会得到
`ECONNREFUSED`）。这种错要是先传上去，现象只是"控制台冷启动超时"，极难定位。

- 单跑冒烟（不打包）：`tools\minigame-node.ps1 douyin-cloud\svr\smoke.mjs`（有 node 时 `npm run smoke`）
- 换端口：`$env:SMOKE_PORT='8123'` 后再跑（默认为 8099，特意避开 8080）
- 只想打包、跳过冒烟：`tools\cloud-pack.ps1 -SkipSmoke`

## 1. 前置条件

- 抖音开放平台开发者账号（已注册），小游戏 AppID = `tt7c110aace2696a9702`
- 抖音开发者工具已登录（本机在 `D:\myproject\@bytedminiprogram-ide\`）
- 不需要：备案域名、证书、服务器、npm（这套代码零依赖）

## 2. 新建服务

1. 打开 **抖音开放平台 → 控制台 → 抖音云**（开发者工具里也有「抖音云」入口，效果一样）
2. **新建服务**：
   - 服务名：`svr`（上次模板演示用的是 `demo-svr`；换成自己的名字更清楚）
   - 环境：**dev**（`env`；上线前再建 `prod`，两个环境各自有域名）
   - 运行环境：**Node.js**（本代码要求 Node ≥ 18）
   - 实例规格：默认（**服务正常** 即可，首版 QPS 很低）
3. 部署方式三选一：
   - **在线编辑**：把 `douyin-cloud\svr\index.js` 内容整段贴进去（最快，适合先跑通）
   - **上传代码包**（推荐）：用 `tools\cloud-pack.ps1` 生成 `douyin-cloud\dist\svr-code-*.zip` 直接上传
     （zip 里只有 `index.js` + `package.json` 两个文件；冒烟不过它会拒绝打包）
   - **Docker 镜像**：用仓库里的 `douyin-cloud\Dockerfile`（构建上下文选 `douyin-cloud\`）
     —— 这个 Dockerfile 只 `COPY svr\`，没有 `npm install` 步骤，构建不会因为依赖失败

> 三种方式都行，因为代码**零依赖**：启动命令统一是 `node index.js`，监听 `PORT`（默认 8080）。
> 如果控制台要求填端口，就填 8080。

## 3. 授权外网访问路径（关键，漏了会 404）

抖音云默认**不给外部访问**。部署完成、服务状态显示 **服务正常** 之后：

1. 进 **服务详情 → 访问控制**
2. 新增一条授权路径：**`/api/*`**（`GET` + `POST`）
3. 保存后**重新部署一次**（有的环境要求改动后重新发布才生效）

## 3.5 配凭据与令牌密钥（登录要用，2026-09-30 新增）

服务端已经把 `tt.login` 的 code → `code2session` → openid 整条接上了，但**凭据只从环境变量读**
（代码里不写、日志里不写，`/api/health` 也只回接口主机名）。所以在控制台：

**服务详情 → 服务配置 / 环境变量** 里加三条：

| 变量名 | 值 | 为什么 |
|---|---|---|
| `DOUYIN_APPID` | 小游戏 AppID（`tt7c110aace2696a9702`） | 换 openid 必须带 |
| `DOUYIN_SECRET` | 小游戏密钥（开放平台后台可查） | 同上。**这是密钥：只填在控制台，不要写进代码 / 文档 / 截图** |
| `SESSION_SECRET` | 一串长随机串（≥ 32 字符即可） | 会话令牌的签名密钥。**不设的话每次部署都随机生成 → 所有玩家令牌失效、全都要重新登录** |

加完**重新部署**，然后用 curl 确认它真读到了：

```powershell
curl.exe "https://你的默认域名/api/health"
# login.configured 必须是 true；login.sessionSecretIsRandom 应该是 false
```

- 看到 `"configured": false` → 环境变量没生效（多数是加到了另一个环境，或加完没重新部署）
- 没配之前 `POST /api/profile` 会明确回 `503 not_configured` —— 这是**故意的**：
  它绝不编造一个 openid 让你误以为登录已经通了
- 上线前再加一条 `REQUIRE_TOKEN=1`：只收验签过的令牌，`openid:` 过渡通道彻底关掉

## 4. 抄下域名并验证服务

在「服务详情 → 域名」里会看到默认域名，形如：

```
https://1mfj3tamsd9m-env-XHvhMYJ9qm.service.douyincloud.run
```

先用命令行确认服务真的活着（**这一步别跳**，能省掉后面一半的排查）：

```powershell
curl.exe "https://你的默认域名/api/health"
# 期望：{"ok":true,"service":"phaser-game-svr","version":"0.2.0","protocol":1,
#        "balanceVersion":1,"season":{"name":"S1","worldSeed":20260930},"time":...,"saves":0,
#        "login":{"configured":true,"endpoint":"developer.toutiao.com","requireToken":false,
#                 "sessionTtlMs":604800000,"sessionSecretIsRandom":false}}
```

也能直接浏览器打开根路径，会看到一行 `phaser-game-svr 正常。健康检查：/api/health`。

## 5. 让游戏连上它

1. 打开 `douyin-minigame\src\00-config.js`，把域名填进 `cloudBase`（**末尾不要带斜杠**）：
   ```js
   cloudBase: 'https://1mfj3tamsd9m-env-XHvhMYJ9qm.service.douyincloud.run'
   ```
2. 回到仓库根目录跑一次一键脚本（会重新拼装 `game.js` 并跑全部检查）：
   ```powershell
   tools\minigame-now.cmd
   ```
3. 在抖音开发者工具里刷新工程 → 游戏里点 **「设」→「云后端连通性自测」**
   - 屏幕上出现「云后端正常：phaser-game-svr v0.2.0 · balance v1」= **链路通了**
   - 出现「未配置云后端地址」= `cloudBase` 没生效（忘了重跑 `minigame-now.cmd`）
   - 出现「当前环境不支持 tt.request」= 不在小游戏环境里跑
4. 若是域名校验拦截：开发期 `project.config.json` 里 `urlCheck: false`（**已默认关掉**）；
   上线前要把它改回 `true`，并在后台 **开发设置 → 服务器域名** 里配置 `request` 合法域名

> 小游戏里还有一种官方推荐调用方式：**`callContainer`**（抖音云 SDK，官方文案"无需服务器及域名配置即可上线"）。
> 本工程的 `12-platform.js` 先走最通用的 `tt.request` + 域名，`callContainer` 留到阶段 B 需要时再接 ——
> 差别只是"怎么发这个 HTTP 请求"，服务端代码一行都不用改。

## 6. 现有端点（够阶段 B 起步）

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/health` | 健康检查 + 协议/数值表版本 + 登录是否已配（游戏内自测就调它） |
| GET | `/api/version` | 只回 `{protocol, balanceVersion, season}`，客户端判断要不要更新 |
| POST | `/api/profile` | **真登录**：`tt.login` 的 `code` → `code2session` → `{account, openid, token, expiresAt, hasSave}` |
| POST | `/api/save` | 上传存档 `{ token 或 openid, save:{v:1,...} }` → `{ok, account, verified, revision, bytes}` |
| GET | `/api/save?token=...` | 拉取存档（过渡期也支持 `?openid=`） |

存档账号分三个命名空间，**客户端说了不算**（安全红线）：

| 前缀 | 来源 | 说明 |
|---|---|---|
| `douyin:` | 验签过的令牌 | 真账号。`REQUIRE_TOKEN=1` 时**只有它能写** |
| `anon:` | 只有 `anonymous_openid`（抖音匿名登录） | 与主账号隔离 |
| `openid:` | 客户端直接给的 openid（过渡通道） | 标 `verified:false`，**永远盖不掉验签账号的数据** |

用 curl 验登录链路：

```powershell
# ① 用真 code 换 openid + 令牌（code 来自 tt.login，一次性、30 秒内有效，只能从真机/模拟器日志里拿）
curl.exe -X POST "https://你的默认域名/api/profile" -H "content-type: application/json" -d "{\"code\":\"你的code\"}"
#    失败看 errNo：code 用过/过期、或 AppID 与密钥不匹配（密钥要配在服务端环境变量里）

# ② 拿令牌写/读存档（这一步不需要真机，随便验）
curl.exe -X POST "https://你的默认域名/api/save" -H "content-type: application/json" -d "{\"token\":\"上一步的token\",\"save\":{\"v\":1,\"balanceVersion\":1,\"level\":7}}"
curl.exe "https://你的默认域名/api/save?token=上一步的token"

# ③ 过渡通道（客户端还没接登录时用）：会回 verified:false，且只写进 openid: 命名空间
curl.exe -X POST "https://你的默认域名/api/save" -H "content-type: application/json" -d "{\"openid\":\"test-openid\",\"save\":{\"v\":1,\"level\":7}}"
curl.exe "https://你的默认域名/api/save?openid=test-openid"
```

> ⚠️ 现在的存档是**进程内存**（重启即失）。真的做云存档时换成 SQLite 或 Redis，
> 表结构草案见 `docs\design\02-architecture.md` §7（`account` / `character` / `item` / `chest_stat` …）。
> 抽奖、伤害结算、公会操作将来**必须在服务端重算**（决策 #1），客户端只发意图。

## 7. 上线前必须处理的四条硬限制（控制台原文）

1. **默认域名仅测试使用、限 10 QPS** → 上线要**绑定自定义域名**（= 已备案域名 + 证书）；
2. **外网访问响应体 ≤ 1 MB** → 存档 / 背包 / 公会列表要分页（背包 200 格 + 词条很容易超）；
3. **单服务 QPS 有上限** → 高并发要提工单调整；
4. **WebSocket 长连接仍未验证**（决策 #2 的阻塞项）：`callContainer` 是 HTTP，
   而阶段 C 的全服共享怪需要实时广播。阶段 B 第一件事就是确认"抖音云是否支持 wss + 其域名能否进
   `socket` 合法域名白名单"；不成立就回退自建（业务代码不用改，只换部署位置）。

## 8. 常见坑

| 现象 | 原因 / 处理 |
|---|---|
| `curl` 通、游戏里不通 | `cloudBase` 没填 / 没重跑 `tools\minigame-now.cmd`（`game.js` 是生成物） |
| 404 `not_found` | 「访问控制」里没把 `/api/*` 加进去，或改完没重新发布 |
| 网关 502 / 服务启动失败 | 启动命令不是 `node index.js`，或端口不是 8080 |
| 返回 `response_too_large` | 触到 1MB 上限（服务端会主动拒绝而不是被截断） |
| 想换服务名/环境 | `dev` 与 `prod` 各有域名，改完记得同步 `cloudBase` |
| 想回滚 | 控制台有版本历史，可回滚到上一个线上版本 |
| 日志在哪 | 服务详情 → 日志（平台侧记录里也有日志主题 ID，见 stage0 §9.1） |
| 控制台"冷启动超时 / 502"，日志里**没有** `listening on` | 进程起来后没监听：入口文件里有作用域错误把 `createServer/listen` 包进了别的函数（2026-09-30 真实踩过）。**上传前先跑 `tools\cloud-pack.ps1`** |
| 域名 `curl` 回 `404 + X-Status-Code: 13005 not found server` | 这个域名对应的服务/环境已经不存在（服务被删、改名、或换了环境）→ 去控制台重新抄当前域名，别用文档里抄的旧域名 |
| `curl "<域名>/api/health"` 在模板服务上回 404 | 那是官方模板（`/api/get_open_id`、`/api/text/antidirt`），不是我们的代码 —— 先把 §0.5 的 zip 传上去 |
| `/api/profile` 回 `503 not_configured` | 服务端没读到 `DOUYIN_APPID` / `DOUYIN_SECRET`（环境变量加错环境、或加完没重新部署）。**这是故意的**：不编造 openid |
| `/api/profile` 回 `401 code2session_failed` | 上游拒绝了。看响应里的 `errNo` / `errTips`：**code 是一次性的**（重复用必失败），或 AppID 与密钥不匹配 |
| 存档接口回 `401 token_required` | 服务端开了 `REQUIRE_TOKEN=1`（只收验签令牌）→ 客户端必须先 `POST /api/profile` 拿令牌 |
| 玩家隔一次部署就要重新登录 | `SESSION_SECRET` 没配 → 每次启动随机生成，旧令牌全部失效。配成固定值即可（`/api/health` 的 `login.sessionSecretIsRandom` 能一眼看出来） |
| 存档回 `409 balance_mismatch` | 客户端存档里的 `balanceVersion` 与服务端不一致（两套数值不许混进同一份存档）→ 先把 `shared\balance.json` 对齐再传 |

## 9. 阶段 B 的下一步（按顺序）

0. **先把我们自己的代码部署上去**（§0.5 → §2 → §3.5）：`tools\cloud-pack.ps1` 出 zip → 控制台上传
   → 授权 `/api/*` → 配 `DOUYIN_APPID` / `DOUYIN_SECRET` / `SESSION_SECRET` → 抄**当前**域名
   → `curl.exe "<域名>/api/health"` 应回 `{"ok":true,"service":"phaser-game-svr","version":"0.2.0",...}`，
   且 `login.configured` 为 `true`。这一步不通，后面全是空转。
1. ~~接 `tt.login`~~ → **服务端已完成（2026-09-30）**：`POST /api/profile` 用真 code2session 换 openid 并
   签发无状态令牌；`/api/save` 有令牌时只认令牌里的账号；越权写 / 伪造签名 / 过期令牌 / 严格模式
   全在 `douyin-cloud\svr\smoke.mjs` 的 41 项断言里验过（假抖音端，不花钱）。
   **剩下的客户端那一半**：`12-platform.js` 加 `PLAT.login()`（包 `tt.login`；`tt.` 只准出现在这个文件）、
   把 token 存本地、`/api/save` 带上 `Authorization: Bearer`。这一半**没法在 node 里自测**（`tt.login`
   只在真机/开发者工具里存在），只能在抖音开发者工具里点着验。
2. **云存档**：`GET/POST /api/save` 接上真数据库（当前是进程内存，重启即失）；本地存档只在断网时兜底
   （决策 #6：不做离线收益）
3. **服务端权威化**：把 `07-combat` / `08-loot` / `09-equipment` 的那套公式搬到服务端（**公式不用重写**，
   它们本来就是纯函数 + 注入 rng；小游戏里那份改成"只做表现预测"）
4. **长连接**：确认 wss 可行性 → 全服共享怪 + AOI 广播（阶段 C）
