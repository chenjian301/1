# douyin-cloud —— 抖音云后端（阶段 B：`code2session` 登录已接入）

零依赖 Node HTTP 服务，用来验证"小游戏 → 抖音云"这条链路，并作为云存档 / 服务端权威逻辑的落点。

```
douyin-cloud\
├─ svr\index.js      服务本体（5 个端点 + 登录/令牌，无第三方依赖，启动命令 node index.js）
├─ svr\package.json  只有元信息（没有 dependencies，所以部署时不需要 npm install）
├─ svr\smoke.mjs     本地冒烟：起 3 个真进程 + 一个**假 code2session**，打 41 项断言（**不属于部署包**）
├─ Dockerfile        选「Docker 镜像」方式部署时用（构建上下文 = 本目录）
├─ dist\             tools\cloud-pack.ps1 产出的上传包（svr-code-<时间戳>.zip，生成物，已被 .gitignore 忽略）
└─ README.md         本文件
```

## 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查（游戏内「设 → 云后端连通性自测」调它）+ 协议/数值表版本 + 登录是否已配（只回主机名，不回凭据） |
| GET | `/api/version` | 协议 / 数值表版本 / 赛季 |
| POST | `/api/profile` | **真登录**：`tt.login` 的 code → `code2session` → openid → 回 `{account, openid, token, expiresAt, hasSave}`（`session_key` 换完就丢，**不出服务端**） |
| POST | `/api/save` | 上传存档 `{ token 或 openid, save }`。**有令牌时 `openid` 只认令牌里那个**；没令牌写下来的标 `verified:false` 且落在 `openid:` 命名空间，盖不掉验签账号 |
| GET | `/api/save?token=` | 拉取存档（过渡期也支持 `?openid=`） |

存档账号有三个命名空间（安全红线：客户端传来的一切都不可信）：

| 前缀 | 来源 | 说明 |
|---|---|---|
| `douyin:` | 验签过的令牌 | 真正的账号，`REQUIRE_TOKEN=1` 时只有它能写 |
| `anon:` | 只有 `anonymous_openid` 时（抖音匿名登录） | 与主账号隔离，避免匿名数据污染真账号 |
| `openid:` | 客户端直接给的 `openid`（过渡通道） | 阶段 B 客户端先跑通"存档往返"用；上线前打开 `REQUIRE_TOKEN=1` 关掉 |

## 环境变量（登录与令牌）

凭据**只从环境变量读**：代码里没有、日志里没有、`/api/health` 也只回接口主机名。在抖音云控制台的
**服务配置 → 环境变量**里加，改完重新部署。

| 变量 | 作用 | 不设会怎样 |
|---|---|---|
| `DOUYIN_APPID` | 小游戏 AppID（也认 `TT_APPID`） | `/api/profile` 明确回 `503 not_configured`，**绝不编造 openid** |
| `DOUYIN_SECRET` | 小游戏密钥（也认 `TT_SECRET`） | 同上 |
| `SESSION_SECRET` | 会话令牌签名密钥 | 启动时随机生成 → **重启/重新部署后所有令牌失效**（`/api/health` 的 `login.sessionSecretIsRandom=true` 能一眼看出来） |
| `REQUIRE_TOKEN=1` | 只收验签令牌，彻底关掉过渡通道 | 默认 `0`：没令牌的写仍接受，但标 `verified:false` 并另立命名空间 |
| `CODE2SESSION_URL` / `CODE2SESSION_METHOD` | 换 code2session 接口（默认官方 v2：JSON POST） | 用官方默认值；响应解析同时兼容 v1（字段在顶层）的形状 |
| `SESSION_TTL_MS` / `CODE2SESSION_TIMEOUT_MS` | 令牌有效期（默认 7 天）/ 上游超时（默认 8s） | 默认值够用 |

令牌是无状态的 HMAC 签名令牌（`payload.signature`），所以**多实例 / 重新部署不掉线**，只要
`SESSION_SECRET` 不变 —— 冒烟测试里"实例 A 签的令牌能在实例 B 用"就是这条性质。

## 本地验证与打包（上传前必做）

```powershell
powershell -ExecutionPolicy Bypass -File tools\cloud-pack.ps1
# ① 真进程 + 真 HTTP 请求跑 svr\smoke.mjs（41 项断言，127.0.0.1:8099/8101/8102 + 假抖音端 8100）：
#    端口真的在听吗 / 健康检查 / 数值表是否漂移 / code→openid / 签令牌 / 越权写 / 伪造与过期令牌 /
#    严格模式(REQUIRE_TOKEN=1) / 没配凭据时是否明确 503 / 坏 JSON / 404 / OPTIONS 预检
# ② 绿的才打包 → douyin-cloud\dist\svr-code-<时间戳>.zip（只有 index.js + package.json）
```

冒烟测试里那个**假 code2session** 是关键设计：它模仿 `developer.toutiao.com`，只在 appid/secret 都对
（顺带证明服务端确实带了凭据）、且 code 是约定的那几个值时给 openid，于是"登录链路"能在**不连抖音云、
不花一分钱**的前提下整条跑通（含 502 坏响应、401 上游拒绝、匿名登录、v1 老形状）。

**为什么必须"真跑一次"而不只是 `node --check`**：2026-09-30 实际踩过 —— `svr\index.js` 的 `readBody`
函数体漏了一个 `}`，`http.createServer` 与 `server.listen` 就被吞进了那个函数体内；`node --check`
**通过**（语法合法），进程起来后**静默退出、不监听端口**（curl 只会得到 `ECONNREFUSED`）。这种错若先
上传，在控制台上只表现为"冷启动超时"。

只想手动起个服务看看（可选）：

```powershell
# 本机没有独立 node 时，用抖音开发者工具自带的 Electron 当 node：
tools\minigame-node.ps1 douyin-cloud\svr\index.js
# 另开一个窗口：curl.exe http://127.0.0.1:8080/api/health
```

## 部署

完整的控制台步骤（新建服务 → 上传代码 → 授权 `/api/*` → 抄域名 → 填进游戏 → 自测）写在
**`docs\douyin-cloud-deploy.md`**，包括上线前必须处理的四条平台限制（默认域名 10 QPS、响应 ≤ 1MB、
单服务 QPS、长连接未验证）。

⚠️ **上传这一步只能在控制台点**：抖音云只支持控制台里的「Git 代码 / Docker 镜像」两种部署方式，
**没有官方 CLI**（官方模板仓库 README 原文）。所以自动化止步于"产出那个 zip"，推上去要人工。
另外：文档里出现的具体域名都是历史痕迹 —— 2026-09-30 复核时旧域名已返回
`404 + X-Status-Code: 13005 not found server`，一律以控制台现值（并重新填入 `cloudBase`）为准。
