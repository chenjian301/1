/**
 * 抖音云后端服务（零依赖版）—— 阶段 B
 *
 * 为什么零依赖：
 *   抖音云的部署方式（2026-09-30 在「服务设置 → 部署方式」看到的是 模板部署 / git部署 / 镜像部署）
 *   容器里真正的入口是仓库根的 run.sh（平台固定执行 /opt/application/run.sh，不在镜像 CMD 上 ——
 *   2026-09-30 就因为仓库里没有这个文件而发布失败，见 run.sh 头部与 docs\douyin-cloud-deploy.md §2.8）。
 *   上一版工程验证过的组合是 Node + koa；这里只用 Node 自带的 http / https / crypto，
 *   将来要换 koa/express 也只是换个路由写法。
 *
 * 端点（全部挂在 /api/ 下 —— 抖音云控制台的「访问控制」要授权 /api/* 才能外网访问）：
 *   GET  /api/health     健康检查（小游戏里「设置 → 云后端」调它；也回报登录是否已配置）
 *   GET  /api/version    协议与数值表版本（客户端用它判断要不要更新）
 *   POST /api/profile    **真·登录**：tt.login 的 code → code2session → openid，并签发会话令牌
 *   POST /api/save       上传存档（令牌优先；没令牌时走"未验证"的过渡通道）
 *   GET  /api/save       拉取存档（?token= 或 ?openid=）
 *   POST /api/name       **昵称唯一性**：占一个昵称（重名 409）—— 跨设备去重靠它
 *   POST /api/guild/create   **建公会**（本次新增）：{ name, x, y }，名字全服唯一（重名 409）
 *   POST /api/guild/join     加入公会：{ name }（人满 409 / 没有这个会 404）
 *   POST /api/guild/leave    退出公会（会长不能退：owner_cannot_leave）
 *   POST /api/guild/anchor   会长改据点锚点：{ x, y }（离别的公会锚点至少 anchorMinDistance；24 小时冷却）
 *   POST|GET /api/guild/mine 我在不在公会里 + 公会那一份（成员 / 等级 / 锚点）
 *   POST|GET /api/guild/list 公会列表（等级 / 人数；按人数降序，最多 listLimit 个）
 *
 * 公会这一块（本次新增，用户："创建公会需要自己输入公会名，公会页面显示公会人员，公会等级，公会信息"）：
 *   - **等级由服务端算**：`level = 1 + floor(Σ成员等级 / levelDivisor)`，封顶 levelCap ——
 *     成员的等级直接读 `saves` 表里那份存档（服务端本来就存着每个账号的 level），
 *     所以客户端伪造不了"公会等级"，也不需要任何新的上报接口；
 *   - **成员表也由服务端算**：名字 / 等级 / 在线状态（`presence`：多久没跟服务端说过话算离线）；
 *   - **在线判断没有长连接**（决策 #2 的长连接仍未验证）：靠"每个带身份的请求都盖一次时间戳"，
 *     所以它是"最近 2 分钟说过话"而不是"此刻在线" —— 玩家在面板上手动刷新就能看到最新状态。
 *   规则数字与 shared/balance.json 的 guild 块一致（客户端那份管手感，这份管权威）。
 *
 * 登录链路（2026-09-30 接入，阶段 B 第一件事）：
 *   客户端 tt.login → code → POST /api/profile { code } → 服务端调抖音 code2session
 *   → 得到 openid（+ session_key，**session_key 永久留在服务端**）→ 签发我们自己的会话令牌。
 *   凭据只从环境变量读，**不写进代码**（这份代码会被 git部署 从仓库构建进镜像、也可能被人手工贴进控制台）：
 *     DOUYIN_APPID / DOUYIN_SECRET   小游戏 AppID 与密钥（也认 TT_APPID / TT_SECRET）
 *     SESSION_SECRET                 令牌签名密钥；不设则每次启动随机生成（旧令牌全部失效）
 *     REQUIRE_TOKEN=1                只收验签过的令牌（关掉过渡通道，越权彻底不可能）
 *     CODE2SESSION_URL / _METHOD     换接口地址与方法（默认官方 v2；解析同时兼容 v1 形状）
 *     SESSION_TTL_MS / CODE2SESSION_TIMEOUT_MS
 *   凭据没配时 /api/profile 明确回 503 not_configured —— **绝不编造 openid**。
 *
 * 三条必须记住的平台限制（控制台原文，详见 docs/douyin-cloud-deploy.md）：
 *   1. 默认域名**仅测试可用、限 10 QPS** → 上线要绑定自定义域名（已备案 + 证书）；
 *   2. 外网访问**响应体 ≤ 1 MB** → 存档 / 背包接口必须分页或压缩；
 *   3. 单服务 QPS 有限制 → 高并发要提工单。
 *
 * 安全红线：客户端传来的一切都不可信。
 *   - 有令牌时 openid **只从令牌里取**，body 里的 openid 一律忽略（见 /api/save）；
 *   - 没令牌的写标 verified:false，并且落在**独立命名空间**（openid: 前缀），
 *     永远盖不掉验签账号（douyin: 前缀）的数据；
 *   - session_key 换到 openid 后立刻丢弃，不回客户端、不落盘；
 *   - 真正的权威逻辑（开箱抽奖、伤害结算、公会操作）仍然必须在服务端重算 —— 决策 #1 的方向。
 */

'use strict';

const http = require('http');
const https = require('https');
const crypto = require('crypto');

/** 服务标识（健康检查里回给客户端，便于确认"我连的是哪个服务"） */
const SERVICE = 'phaser-game-svr';
const SERVICE_VERSION = '0.3.0';

/** 与 shared/balance.json 对应的版本信息：客户端用它判断是否需要更新数值表 */
const BALANCE_VERSION = 1;
const SEASON = { name: 'S1', worldSeed: 20260930 };
const PROTOCOL = 1;

/**
 * 监听端口：平台注入了 PORT 就听平台的，否则 8000 —— 8000 是抖音云的约定
 * （官方 Node 模板 src/server.ts 硬编码 `const PORT = 8000;`，平台监管进程的日志也写着
 *  "restarting user function at port 8000"）。容器里这个默认值通常由 run.sh 补，两处都是 8000。
 * **别再改回 8080**：2026-09-30 之前的"端口 8080"没有任何依据，配合缺失的 run.sh 让发布失败了一次
 * （复盘见 docs\douyin-cloud-deploy.md §2.8）。
 */
const PORT = process.env.PORT || 8000;
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 900 * 1024;

/** 内存存档（演示用）。正式版换 SQLite / Redis，表结构见 docs\design\02-architecture.md §7 */
const saves = new Map();

/**
 * 昵称注册表（同样是内存版）：nameKey → { account, name, claimedAt, verified }。
 * 为什么服务端也要挡一遍：客户端的本机注册表只管得住一台设备，
 * "昵称不能重复"要成立就得有中心节点 —— 这就是 /api/name 存在的唯一理由。
 * 只增不减：**存档可以被重置，昵称占用不该跟着被释放**，否则改名刷号就能绕过去重。
 */
const names = new Map();

/* ---------------------------------------------------------------- 公会（本次新增） */

/**
 * 公会规则：与 `shared/balance.json` 的 guild 块**同一套数**。
 * 服务端读不到 balance.json（部署包里只有 index.js + package.json + run.sh），
 * 所以与昵称规则一样分两份：客户端那份管手感（打字时立刻校验），这份管**权威**。
 * 改数的时候两边一起改 —— `douyin-cloud\svr\smoke.mjs` 有一条断言盯着这几个数与平衡表一致。
 */
const GUILD = {
  memberCap: 20,
  anchorMinDistance: 2000,
  anchorCooldownMs: 24 * 3600 * 1000,
  // 长度规则直接用**昵称那一对数**（NAME_MIN / NAME_MAX 在本文件后面才声明，
  // 所以写成 getter：真正读它的时候模块早就初始化完了，也永远只有一份出处）
  get nameMin() {
    return NAME_MIN;
  },
  get nameMax() {
    return NAME_MAX;
  },
  levelDivisor: 100,
  levelCap: 10,
  /** 多久没跟服务端说过话就算离线（客户端 balance.guild.onlineWindowMs 是同一个数） */
  onlineWindowMs: 120000,
  /** 公会列表一次最多回几个 */
  listLimit: 20
};

/** 公会表（内存版）：nameKey → { id, name, nameKey, leader, createdAt, anchor, anchorAt, members[] } */
const guilds = new Map();
/** 账号 → nameKey（一个账号只能在一个公会里；反查比遍历公会表便宜） */
const guildByAccount = new Map();
/** 在线表（内存版）：account → 最近一次带身份的请求时刻。没有长连接，这就是"在线"的全部依据 */
const presence = new Map();
/** 公会 id 自增（给客户端一个稳定标识；名字才是唯一键） */
let nextGuildId = 1;

/** 一个请求"露过面"了：带身份的请求都会盖一次（见 resolveIdentity） */
function touchPresence(account) {
  if (!account) return;
  presence.set(account, Date.now());
}

/** 公会名的唯一性键：与昵称**同一套清洗**（去空白与非法字符、截到上限、小写） */
function guildNameKey(name) {
  return nameKeyOf(name);
}

/**
 * 校验公会名 → `{ ok, name, key }` 或 `{ ok:false, reason }`。
 * 与昵称共用 NAME_LEGAL / RESERVED_NAMES：2~12 个字符，只允许中文 / 字母 / 数字 / 下划线。
 * 刻意**不查昵称注册表**：公会名与昵称是两个命名空间，各自只在自己的表里去重。
 */
function validateGuildName(value) {
  const text = typeof value === 'string' ? value.replace(/\s+/g, '') : '';
  if (!text) return { ok: false, reason: 'empty' };
  if (!NAME_LEGAL.test(text)) return { ok: false, reason: 'illegal' };
  const length = text.split('').length;
  if (length < GUILD.nameMin) return { ok: false, reason: 'too_short' };
  if (length > GUILD.nameMax) return { ok: false, reason: 'too_long' };
  const key = guildNameKey(text);
  if (RESERVED_NAMES.indexOf(key) >= 0) return { ok: false, reason: 'reserved' };
  return { ok: true, name: text, key: key };
}

/** 这个账号的存档（公会成员的名字 / 等级优先读它 —— 服务端本来就存着） */
function saveOf(account) {
  const record = saves.get(account);
  return record && record.save && typeof record.save === 'object' ? record.save : null;
}

/** 夹到合法区间的小工具（service 端也要防脏数据：客户端传来的 level 可能是任意值） */
function clampInt(value, fallback, min, max) {
  const number = typeof value === 'number' && isFinite(value) ? Math.floor(value) : fallback;
  if (number < min) return min;
  if (number > max) return max;
  return number;
}

/**
 * 成员表（**权威版**）：名字 / 等级 / 在线状态。
 *   - 名字与等级优先读该账号的存档（`saves`），没有存档时退回入会那一刻记下的值
 *     （`body.playerName` / `body.playerLevel` —— 客户端建号时还没上传过存档的那段时间靠它）；
 *   - 在线 = 最近 `GUILD.onlineWindowMs` 内跟服务端说过话（`presence`）；
 *   - 刻意**不回 account**：那串东西就是 openid（`douyin:<openid>`），不能给别的玩家看。
 */
function guildMembers(guild) {
  const now = Date.now();
  return guild.members.map((member) => {
    const save = saveOf(member.account);
    const name = save && typeof save.name === 'string' && save.name ? save.name : member.name;
    const level = save && typeof save.level === 'number' ? save.level : member.level;
    const seen = presence.get(member.account) || 0;
    return {
      name: name,
      level: clampInt(level, 1, 1, 9999),
      online: seen > 0 && now - seen <= GUILD.onlineWindowMs,
      role: member.role,
      at: member.at
    };
  });
}

/** 公会等级：与客户端 `G.GUILD.levelFrom` 是**同一道式子**（1 + floor(Σ等级 / levelDivisor)，封顶 levelCap） */
function guildLevelOf(members) {
  let total = 0;
  for (let i = 0; i < members.length; i += 1) total += members[i].level;
  const level = 1 + Math.floor(total / GUILD.levelDivisor);
  return { level: Math.min(GUILD.levelCap, level), exp: total };
}

/** 回给客户端的公会对象（成员 / 等级 / 锚点 / 人数）—— 界面直接画它 */
function guildView(guild) {
  const members = guildMembers(guild);
  const stats = guildLevelOf(members);
  return {
    id: guild.id,
    name: guild.name,
    level: stats.level,
    exp: stats.exp,
    expForNext: GUILD.levelDivisor,
    levelCap: GUILD.levelCap,
    memberCap: GUILD.memberCap,
    members: members,
    count: members.length,
    online: members.filter((member) => member.online).length,
    anchor: guild.anchor,
    createdAt: guild.createdAt,
    /** 只剩一个会长时也如实说 —— 客户端拿它写"还有 N 个空位" */
    leader: members.length ? members[0].name : ''
  };
}

/** 我所在的公会（没有就 null） */
function guildOf(account) {
  const key = guildByAccount.get(account);
  return key && guilds.has(key) ? guilds.get(key) : null;
}

/** 锚点合法性：两个有限数、别离谱（客户端可能传来 NaN / Infinity / 巨大值） */
function validAnchor(x, y) {
  return (
    typeof x === 'number' && isFinite(x) && typeof y === 'number' && isFinite(y) && Math.abs(x) < 1e9 && Math.abs(y) < 1e9
  );
}

/** 与**别的**公会锚点至少隔 anchorMinDistance（否则全服会挤成一团，决策里的老规矩） */
function anchorTooClose(self, x, y) {
  for (const other of guilds.values()) {
    if (other === self) continue;
    const dx = other.anchor.x - x;
    const dy = other.anchor.y - y;
    if (Math.sqrt(dx * dx + dy * dy) < GUILD.anchorMinDistance) return other;
  }
  return null;
}

/** 公会成员记录：入会那一刻先把名字与等级记下来（之后读存档覆盖） */
function newMember(account, role, body, at) {
  const save = saveOf(account);
  const name =
    (save && typeof save.name === 'string' && save.name) ||
    (typeof body.playerName === 'string' && body.playerName ? body.playerName.slice(0, 12) : '') ||
    '无名者';
  const level = save && typeof save.level === 'number' ? save.level : clampInt(body.playerLevel, 1, 1, 9999);
  return { account, name, level: clampInt(level, 1, 1, 9999), role, at };
}

/** 存档命名空间：验签账号 / 匿名账号 / 未验证的过渡通道。三者互不覆盖（安全红线） */
const NS_VERIFIED = 'douyin:';
const NS_ANONYMOUS = 'anon:';
const NS_LEGACY = 'openid:';

/* ---------------------------------------------------------------- 登录配置 */

/** 小游戏凭据：**只从环境变量读**，绝不写进代码（这个包会被传到控制台） */
const APPID = process.env.DOUYIN_APPID || process.env.TT_APPID || '';
const APP_SECRET = process.env.DOUYIN_SECRET || process.env.TT_SECRET || '';
const LOGIN_CONFIGURED = !!(APPID && APP_SECRET);

/**
 * code2session 接口。默认官方 v2：JSON POST
 *   POST https://developer.toutiao.com/api/apps/v2/jscode2session
 *   { appid, secret, code, anonymous_code }
 *   -> { err_no, err_tips, data: { openid, session_key, anonymous_openid, unionid } }
 * 老版 v1 是 GET + 查询串、字段在顶层，所以解析两种形状都认（normalizeSession）。
 */
const CODE2SESSION_URL = process.env.CODE2SESSION_URL || 'https://developer.toutiao.com/api/apps/v2/jscode2session';
const CODE2SESSION_METHOD =
  String(process.env.CODE2SESSION_METHOD || 'POST').toUpperCase() === 'GET' ? 'GET' : 'POST';
const CODE2SESSION_TIMEOUT_MS = Number(process.env.CODE2SESSION_TIMEOUT_MS || 8000);

/** 会话令牌：HMAC 签名的无状态令牌。多实例 / 重启都认，只要 SESSION_SECRET 不变 */
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_SECRET_IS_RANDOM = !process.env.SESSION_SECRET;
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 7 * 24 * 3600 * 1000);
/** 打开它，就只有验签过的令牌能写存档（上线前应当打开） */
const REQUIRE_TOKEN = process.env.REQUIRE_TOKEN === '1' || process.env.REQUIRE_TOKEN === 'true';

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) {
    // 平台硬限制：外网响应 ≤ 1MB。宁可报错，也不要被网关截成半截 JSON
    res.writeHead(413, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'response_too_large', limit: MAX_RESPONSE_BYTES }));
    return;
  }
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    // authorization 必须放行：令牌走 Authorization: Bearer 时预检要过（CORS 白名单是逐头的）
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    // 客户端时钟同步用（联机时"同一时刻"必须能对齐，见 02-architecture §6 的 pong）
    'x-server-time': String(Date.now())
  });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_REQUEST_BYTES) {
        reject(new Error('request_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error('bad_json'));
      }
    });
    req.on('error', reject);
  });
}

/* -------------------------------------------------------- 会话令牌（无状态） */

function base64url(buffer) {
  return Buffer.from(buffer).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function signText(text) {
  return base64url(crypto.createHmac('sha256', SESSION_SECRET).update(text).digest());
}

/**
 * 签发令牌：base64url(JSON{sub,iat,exp,v}) + '.' + HMAC-SHA256。
 * sub 就是存档账号（douyin:<openid> / anon:<anonymous_openid>），客户端**只当字符串存着**。
 * 无状态的好处：服务重启、多实例、换部署方式都不影响，只要 SESSION_SECRET 不变。
 */
function issueToken(account, nowMs) {
  const payload = { sub: account, iat: nowMs, exp: nowMs + SESSION_TTL_MS, v: 1 };
  const text = base64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  return { token: text + '.' + signText(text), expiresAt: payload.exp };
}

function verifyToken(token, nowMs) {
  if (typeof token !== 'string' || !token || token.length > 4096) return { ok: false, error: 'bad_token' };
  const dot = token.indexOf('.');
  if (dot <= 0) return { ok: false, error: 'bad_token' };
  const text = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = signText(text);
  // 长度不同直接拒（timingSafeEqual 要求等长，顺带省掉一次比较）
  if (signature.length !== expected.length) return { ok: false, error: 'bad_token' };
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return { ok: false, error: 'bad_token' };
  let payload = null;
  try {
    payload = JSON.parse(Buffer.from(text.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch (error) {
    payload = null;
  }
  if (!payload || typeof payload.sub !== 'string' || !payload.sub) return { ok: false, error: 'bad_token' };
  if (typeof payload.exp !== 'number' || payload.exp <= nowMs) return { ok: false, error: 'token_expired' };
  return { ok: true, account: payload.sub, expiresAt: payload.exp };
}

/** 令牌三种放法都认：Authorization: Bearer / body.token / ?token= */
function readToken(req, url, body) {
  const header = req.headers.authorization;
  if (typeof header === 'string' && header) {
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (match) return match[1].trim();
  }
  if (body && typeof body.token === 'string' && body.token) return body.token;
  return url.searchParams.get('token') || '';
}

/** 健康检查里只回主机名：不回路径、更不回凭据（这个接口谁都能调） */
function loginEndpointHost() {
  try {
    return new URL(CODE2SESSION_URL).host;
  } catch (error) {
    return 'invalid_url';
  }
}

/* --------------------------------------------------- code2session（真登录） */

/**
 * 拿 code 去换 openid。code 是**一次性**的（重放会失败），成功时还会给 session_key。
 * session_key 是解密开放数据的钥匙，**绝不回客户端**，这里换到 openid 就丢掉它。
 */
function code2session(code, anonymousCode) {
  return new Promise((resolve, reject) => {
    const params = { appid: APPID, secret: APP_SECRET, code: code };
    if (anonymousCode) params.anonymous_code = anonymousCode;

    let target = CODE2SESSION_URL;
    let payload = null;
    if (CODE2SESSION_METHOD === 'GET') {
      // v1 风格：GET + 查询串
      const withQuery = new URL(CODE2SESSION_URL);
      Object.keys(params).forEach((key) => {
        if (params[key]) withQuery.searchParams.set(key, params[key]);
      });
      target = withQuery.toString();
    } else {
      payload = Buffer.from(JSON.stringify(params), 'utf8');
    }

    const transport = target.indexOf('https:') === 0 ? https : http;
    const request = transport.request(
      target,
      {
        method: CODE2SESSION_METHOD,
        headers: payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => {
          chunks.push(chunk);
        });
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = JSON.parse(text);
          } catch (error) {
            json = null;
          }
          if (!json) {
            reject(new Error('code2session_bad_response'));
            return;
          }
          resolve(normalizeSession(json, response.statusCode));
        });
      }
    );
    // 网络错误只在服务端记一句，别把上游细节泄给客户端
    request.on('error', () => {
      reject(new Error('code2session_network'));
    });
    request.setTimeout(CODE2SESSION_TIMEOUT_MS, () => {
      request.destroy(new Error('code2session_timeout'));
    });
    if (payload) request.write(payload);
    request.end();
  });
}

/**
 * 兼容两种响应形状：v2 把字段嵌在 data 里，v1 直接给在顶层（认 v1 = "接口换版不用改代码"）。
 * 只认 err_no / errcode 为 0 且真拿到 openid（或 anonymous_openid）的响应。
 */
function normalizeSession(json, httpStatus) {
  const data = json && typeof json.data === 'object' && json.data ? json.data : json;
  const errNo =
    typeof json.err_no === 'number' ? json.err_no : typeof json.errcode === 'number' ? json.errcode : null;
  const tips = json.err_tips || json.errmsg || json.message || json.description || '';
  const openid = typeof data.openid === 'string' && data.openid ? data.openid : '';
  const anonymousOpenid = typeof data.anonymous_openid === 'string' ? data.anonymous_openid : '';
  if ((errNo === null || errNo === 0) && (openid || anonymousOpenid)) {
    return {
      ok: true,
      openid: openid || null,
      anonymousOpenid: anonymousOpenid || null,
      // session_key 到这儿为止：只回报"有没有拿到"，值本身不往上传
      sessionKeySeen: typeof data.session_key === 'string' && !!data.session_key
    };
  }
  return { ok: false, errNo, tips: String(tips).slice(0, 160), httpStatus };
}

/**
 * 判断"是谁在说话"：
 *   有令牌 → 验签；账号**只从令牌里取**，body / 查询串里的 openid 一概忽略（客户端说了不算）；
 *   没令牌 → REQUIRE_TOKEN 打开就 401；否则落到未验证的过渡命名空间（verified:false）——
 *            阶段 B 的客户端可以先把"存档往返"跑通，上线前把 REQUIRE_TOKEN 打开即可收紧。
 */
function resolveIdentity(req, url, body) {
  const token = readToken(req, url, body);
  if (token) {
    const verified = verifyToken(token, Date.now());
    if (!verified.ok) return { ok: false, status: 401, error: verified.error };
    touchPresence(verified.account);
    return { ok: true, verified: true, account: verified.account, subject: verified.account };
  }
  if (REQUIRE_TOKEN) {
    return { ok: false, status: 401, error: 'token_required' };
  }
  const raw = (body && typeof body.openid === 'string' && body.openid) || url.searchParams.get('openid') || '';
  if (!raw) return { ok: false, status: 400, error: 'missing_openid' };
  touchPresence(NS_LEGACY + raw);
  return { ok: true, verified: false, account: NS_LEGACY + raw, subject: raw };
}

/** 存档摘要：只回真实存在的字段（结构见 douyin-minigame\src\11-save.js），不编造字段 */
function saveSummary(record) {
  if (!record) return null;
  const save = record.save || {};
  return {
    level: typeof save.level === 'number' ? save.level : null,
    gold: typeof save.gold === 'number' ? save.gold : null,
    horns: typeof save.horns === 'number' ? save.horns : null,
    // A15：强化石（客户端 11-save 的 stones）—— 与 horns 同一条口径：只回真实存在的数字
    stones: typeof save.stones === 'number' ? save.stones : null,
    savedAt: record.savedAt,
    revision: record.revision
  };
}

/**
 * 昵称规则：与客户端 `douyin-minigame\src\11-save.js` 的 G.ACCOUNT **同一套**
 * （2~12 个字符，只允许中文 / 字母 / 数字 / 下划线，保留名不给用）。
 * 两边都写一遍不是重复劳动：客户端那份管手感（离线也能立刻给提示），
 * 这份管**权威**（改了客户端也骗不到一个重名）。
 */
const NAME_MIN = 2;
const NAME_MAX = 12;
const NAME_LEGAL = /^[\u4e00-\u9fa5A-Za-z0-9_]+$/;
const RESERVED_NAMES = ['gm', 'admin', 'administrator', 'root', 'system', 'official', '官方', '客服', '管理员', '系统', '无名者', '测试', 'test'];

/** 唯一性键：去掉空白与非法字符、截到上限、转小写（Alice == alice） */
function nameKeyOf(value) {
  if (typeof value !== 'string') return '';
  const text = value.replace(/\s+/g, '').replace(/[^\u4e00-\u9fa5A-Za-z0-9_]/g, '');
  const chars = text.split('');
  return (chars.length > NAME_MAX ? chars.slice(0, NAME_MAX).join('') : text).toLowerCase();
}

/** 校验昵称 → { ok, name, key } 或 { ok:false, reason }（先看非法字符再看长度，避免脏串被截成合法名） */
function validateName(value) {
  const text = typeof value === 'string' ? value.replace(/\s+/g, '') : '';
  if (!text) return { ok: false, reason: 'empty' };
  if (!NAME_LEGAL.test(text)) return { ok: false, reason: 'illegal' };
  const length = text.split('').length;
  if (length < NAME_MIN) return { ok: false, reason: 'too_short' };
  if (length > NAME_MAX) return { ok: false, reason: 'too_long' };
  const key = nameKeyOf(text);
  if (RESERVED_NAMES.indexOf(key) >= 0) return { ok: false, reason: 'reserved' };
  return { ok: true, name: text, key: key };
}

/** 极简路由：只认 /api/*，其余一律 404（避免误开外网接口） */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type, authorization',
      'access-control-allow-methods': 'GET,POST,OPTIONS'
    });
    res.end();
    return;
  }

  if (path === '/' || path === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(SERVICE + ' 正常。健康检查：/api/health\n');
    return;
  }

  if (!path.startsWith('/api/')) {
    sendJson(res, 404, { ok: false, error: 'not_found', path });
    return;
  }

  try {
    if (req.method === 'GET' && path === '/api/health') {
      sendJson(res, 200, {
        ok: true,
        service: SERVICE,
        version: SERVICE_VERSION,
        protocol: PROTOCOL,
        balanceVersion: BALANCE_VERSION,
        season: SEASON,
        time: Date.now(),
        saves: saves.size,
        /** 已登记的昵称数（唯一性注册表；只增不减） */
        names: names.size,
        /** 已建立的公会数（本次新增：内存版，重启就没了 —— 正式版换库） */
        guilds: guilds.size,
        /** 登录是否已配好（只回主机名，不回 appid/secret —— 这个接口谁都能调） */
        login: {
          configured: LOGIN_CONFIGURED,
          endpoint: loginEndpointHost(),
          method: CODE2SESSION_METHOD,
          requireToken: REQUIRE_TOKEN,
          sessionTtlMs: SESSION_TTL_MS,
          sessionSecretIsRandom: SESSION_SECRET_IS_RANDOM
        }
      });
      return;
    }

    if (req.method === 'GET' && path === '/api/version') {
      sendJson(res, 200, { ok: true, protocol: PROTOCOL, balanceVersion: BALANCE_VERSION, season: SEASON });
      return;
    }

    if (req.method === 'POST' && path === '/api/profile') {
      // 凭据没配就不装样子：明确 503，客户端据此提示"后端还没配 AppID/密钥"
      if (!LOGIN_CONFIGURED) {
        sendJson(res, 503, {
          ok: false,
          error: 'not_configured',
          note: '服务端缺 DOUYIN_APPID / DOUYIN_SECRET（在抖音云服务的环境变量里配）'
        });
        return;
      }
      const body = await readBody(req);
      const code = typeof body.code === 'string' ? body.code.trim() : '';
      const anonymousCode = typeof body.anonymousCode === 'string' ? body.anonymousCode.trim() : '';
      if (!code && !anonymousCode) {
        sendJson(res, 400, { ok: false, error: 'missing_code', note: '需要 { code }（tt.login 拿到的）' });
        return;
      }

      let session = null;
      try {
        session = await code2session(code, anonymousCode);
      } catch (error) {
        // 网络断 / 超时 / 上游回了看不懂的东西：统一 502，细节只记在服务端日志
        console.log('[login] code2session 调用失败: ' + ((error && error.message) || 'unknown'));
        sendJson(res, 502, { ok: false, error: (error && error.message) || 'code2session_unreachable' });
        return;
      }

      if (!session.ok) {
        // 只记 err_no / err_tips：日志里绝不出现 code 和 secret
        console.log('[login] code2session 拒绝: err_no=' + session.errNo + ' tips=' + session.tips);
        sendJson(res, 401, {
          ok: false,
          error: 'code2session_failed',
          errNo: session.errNo,
          errTips: session.tips
        });
        return;
      }

      // 有 openid 走主账号；只有 anonymous_openid 的（抖音的匿名登录）也认，但落在独立命名空间
      const anonymous = !session.openid;
      const account = anonymous ? NS_ANONYMOUS + session.anonymousOpenid : NS_VERIFIED + session.openid;
      const issued = issueToken(account, Date.now());
      const existing = saves.get(account);
      console.log('[login] ' + (anonymous ? '匿名登录' : 'openid 登录') + ' account=' + account);
      sendJson(res, 200, {
        ok: true,
        account: account,
        openid: session.openid,
        anonymous: anonymous,
        /** 只是个布尔：确认抖音确实回了 session_key，而它本身永远不出服务端 */
        sessionKeySeen: session.sessionKeySeen,
        token: issued.token,
        expiresAt: issued.expiresAt,
        ttlMs: SESSION_TTL_MS,
        hasSave: !!existing,
        save: saveSummary(existing)
      });
      return;
    }

    if (req.method === 'POST' && path === '/api/name') {
      const body = await readBody(req);
      const checked = validateName(body.name);
      if (!checked.ok) {
        sendJson(res, 400, {
          ok: false,
          error: 'invalid_name',
          reason: checked.reason,
          nameMin: NAME_MIN,
          nameMax: NAME_MAX,
          note: '昵称 2~12 个字符，只能用中文 / 字母 / 数字 / 下划线'
        });
        return;
      }

      /*
       * 谁在占这个名字：
       *   有令牌  → 账号**只从令牌里取**（验签过的，可信）；
       *   没令牌  → 用请求里的 account 标识当占用人（不可信，但足以挡住"两台设备抢同一个名字"）。
       *     为什么没令牌也收：阶段 B 的令牌链路还没和客户端接通，而"昵称不能重复"现在就要能用；
       *     等 REQUIRE_TOKEN=1 之后，把下面这段收窄成"无令牌直接 401"即可（届时客户端已带 token）。
       */
      const identity = resolveIdentity(req, url, body);
      const claimedBy = identity.ok
        ? identity.account
        : 'anon-name:' + (typeof body.account === 'string' && body.account ? body.account.slice(0, 64) : 'unknown');
      const existing = names.get(checked.key);
      if (existing && existing.account !== claimedBy) {
        sendJson(res, 409, {
          ok: false,
          error: 'name_taken',
          name: checked.name,
          takenAt: existing.claimedAt,
          note: '昵称已被占用，换一个'
        });
        return;
      }

      names.set(checked.key, {
        account: claimedBy,
        name: checked.name,
        claimedAt: existing ? existing.claimedAt : Date.now(),
        verified: identity.ok ? identity.verified === true : false
      });
      console.log('[name] ' + (existing ? '重复登记' : '新登记') + ' key=' + checked.key + ' by=' + claimedBy);
      sendJson(res, 200, {
        ok: true,
        name: checked.name,
        key: checked.key,
        account: claimedBy,
        verified: identity.ok ? identity.verified === true : false,
        /** claimed=false 表示"这个名字本来就是你的"，客户端据此提示更准确 */
        claimed: !existing,
        total: names.size
      });
      return;
    }

    if (req.method === 'POST' && path === '/api/save') {
      const body = await readBody(req);
      const identity = resolveIdentity(req, url, body);
      if (!identity.ok) {
        sendJson(res, identity.status, {
          ok: false,
          error: identity.error,
          note: identity.error === 'token_required' ? '先 POST /api/profile 拿 token' : undefined
        });
        return;
      }
      const save = body.save && typeof body.save === 'object' && !Array.isArray(body.save) ? body.save : null;
      if (!save || save.v !== 1) {
        sendJson(res, 400, {
          ok: false,
          error: 'bad_save',
          note: '需要 { save: { v: 1, ... } }，并且 openid / token 至少给一个'
        });
        return;
      }
      // 数值表漂移闸门：客户端带的版本和服务端不一致就拒收，免得两套数值混进同一份存档
      if (typeof save.balanceVersion === 'number' && save.balanceVersion !== BALANCE_VERSION) {
        sendJson(res, 409, {
          ok: false,
          error: 'balance_mismatch',
          balanceVersion: save.balanceVersion,
          serverBalanceVersion: BALANCE_VERSION
        });
        return;
      }
      const previous = saves.get(identity.account);
      const record = {
        account: identity.account,
        verified: identity.verified,
        save: save,
        savedAt: Date.now(),
        revision: (previous && previous.revision ? previous.revision : 0) + 1
      };
      saves.set(identity.account, record);
      sendJson(res, 200, {
        ok: true,
        account: record.account,
        verified: record.verified,
        savedAt: record.savedAt,
        revision: record.revision,
        bytes: JSON.stringify(save).length
      });
      return;
    }

    if (req.method === 'GET' && path === '/api/save') {
      const identity = resolveIdentity(req, url, null);
      if (!identity.ok) {
        sendJson(res, identity.status, { ok: false, error: identity.error });
        return;
      }
      const record = saves.get(identity.account);
      if (!record) {
        sendJson(res, 404, { ok: false, error: 'no_save', account: identity.account, verified: identity.verified });
        return;
      }
      sendJson(res, 200, {
        ok: true,
        account: record.account,
        verified: record.verified,
        savedAt: record.savedAt,
        revision: record.revision,
        save: record.save
      });
      return;
    }

    /* ------------------------------------------------------------ 公会（本次新增） */

    /**
     * 六个公会端点共用同一段前置：读 body（GET 就是空对象）→ 认身份 → 盖一次在线时间戳。
     * 身份用的是**和 /api/save 完全相同的那一套**（`resolveIdentity`）：有令牌时账号只从令牌里取，
     * 没令牌时 `REQUIRE_TOKEN=1` 直接 401 —— 所以公会操作天生跟着存档走同一道闸门。
     */
    if (path.indexOf('/api/guild/') === 0) {
      const body = req.method === 'POST' ? await readBody(req) : {};
      const identity = resolveIdentity(req, url, body);
      if (!identity.ok) {
        sendJson(res, identity.status, {
          ok: false,
          error: identity.error,
          note: identity.error === 'token_required' ? '先 POST /api/profile 拿 token' : undefined
        });
        return;
      }
      touchPresence(identity.account);

      /*
       * 顺手用客户端带来的名字 / 等级刷新"我"这条成员记录。
       * 为什么需要：云存档还没接上（阶段 B 第 2 项），成员表里的名字 / 等级本来会停在他入会那一刻；
       * 客户端每次调公会接口都会带 `playerName` / `playerLevel`，于是"升了一级 → 公会等级跟着涨"
       * 这件事现在就能成立。**服务端有存档时以存档为准**（见 guildMembers），这里只是兜底那一份。
       */
      const mineNow = guildOf(identity.account);
      if (mineNow) {
        for (const member of mineNow.members) {
          if (member.account !== identity.account) continue;
          if (typeof body.playerName === 'string' && body.playerName) member.name = body.playerName.slice(0, 12);
          if (typeof body.playerLevel === 'number' && isFinite(body.playerLevel)) {
            member.level = clampInt(body.playerLevel, member.level, 1, 9999);
          }
        }
      }

      if (path === '/api/guild/create' || path === '/api/guild/join') {
        const checked = validateGuildName(body.name);
        if (!checked.ok) {
          sendJson(res, 400, {
            ok: false,
            error: 'invalid_name',
            reason: checked.reason,
            nameMin: GUILD.nameMin,
            nameMax: GUILD.nameMax,
            note: '公会名 2~12 个字符，只能用中文 / 字母 / 数字 / 下划线'
          });
          return;
        }
        const mine = guildOf(identity.account);
        if (mine) {
          sendJson(res, 409, {
            ok: false,
            error: 'already_in_guild',
            guild: mine.name,
            note: '一个账号只能在一个公会里'
          });
          return;
        }
      }

      if (path === '/api/guild/create') {
        const checked = validateGuildName(body.name);
        if (guilds.has(checked.key)) {
          sendJson(res, 409, { ok: false, error: 'name_taken', name: checked.name, note: '公会名全服唯一，换一个' });
          return;
        }
        // 锚点：不给就用 (0,0)（= 原点营地），给了就必须是两个正常数
        const x = body.x === undefined ? 0 : body.x;
        const y = body.y === undefined ? 0 : body.y;
        if (!validAnchor(x, y)) {
          sendJson(res, 400, { ok: false, error: 'bad_anchor', note: '需要 { x, y }，两个有限数' });
          return;
        }
        const near = anchorTooClose(null, x, y);
        if (near) {
          sendJson(res, 409, {
            ok: false,
            error: 'anchor_too_close',
            other: near.name,
            minDistance: GUILD.anchorMinDistance,
            note: '离别的公会锚点太近，往外走一段再建'
          });
          return;
        }
        const now = Date.now();
        const guild = {
          id: 'g' + nextGuildId,
          name: checked.name,
          nameKey: checked.key,
          leader: identity.account,
          createdAt: now,
          anchor: { x: x, y: y },
          anchorAt: now,
          members: [newMember(identity.account, 'leader', body, now)]
        };
        nextGuildId += 1;
        guilds.set(checked.key, guild);
        guildByAccount.set(identity.account, checked.key);
        console.log(
          '[guild] 新建 account=' + identity.account + ' name=' + guild.name + ' anchor=' + Math.round(x) + ',' + Math.round(y)
        );
        sendJson(res, 200, { ok: true, role: 'leader', guild: guildView(guild) });
        return;
      }

      if (path === '/api/guild/join') {
        const checked = validateGuildName(body.name);
        const guild = guilds.get(checked.key);
        if (!guild) {
          sendJson(res, 404, { ok: false, error: 'no_guild', name: checked.name, note: '服务端没有这个公会（打错名字了？）' });
          return;
        }
        if (guild.members.length >= GUILD.memberCap) {
          sendJson(res, 409, { ok: false, error: 'guild_full', name: guild.name, memberCap: GUILD.memberCap });
          return;
        }
        guild.members.push(newMember(identity.account, 'member', body, Date.now()));
        guildByAccount.set(identity.account, checked.key);
        console.log('[guild] 加入 account=' + identity.account + ' name=' + guild.name + ' 人数=' + guild.members.length);
        sendJson(res, 200, { ok: true, role: 'member', guild: guildView(guild) });
        return;
      }

      if (path === '/api/guild/leave') {
        const guild = guildOf(identity.account);
        if (!guild) {
          sendJson(res, 404, { ok: false, error: 'not_in_guild' });
          return;
        }
        if (guild.leader === identity.account) {
          sendJson(res, 409, {
            ok: false,
            error: 'owner_cannot_leave',
            guild: guild.name,
            note: '会长不能退会（首版没有转让 / 解散，先把成员请出去）'
          });
          return;
        }
        guild.members = guild.members.filter((member) => member.account !== identity.account);
        guildByAccount.delete(identity.account);
        console.log('[guild] 退会 account=' + identity.account + ' name=' + guild.name + ' 人数=' + guild.members.length);
        sendJson(res, 200, { ok: true, left: guild.name, guild: guildView(guild) });
        return;
      }

      if (path === '/api/guild/anchor') {
        const guild = guildOf(identity.account);
        if (!guild) {
          sendJson(res, 404, { ok: false, error: 'not_in_guild' });
          return;
        }
        if (guild.leader !== identity.account) {
          sendJson(res, 403, { ok: false, error: 'not_leader', note: '只有会长能挪据点锚点' });
          return;
        }
        if (!validAnchor(body.x, body.y)) {
          sendJson(res, 400, { ok: false, error: 'bad_anchor', note: '需要 { x, y }，两个有限数' });
          return;
        }
        const since = Date.now() - guild.anchorAt;
        if (since < GUILD.anchorCooldownMs) {
          sendJson(res, 409, {
            ok: false,
            error: 'anchor_cooldown',
            waitMs: GUILD.anchorCooldownMs - since,
            note: '锚点刚挪过，冷却中'
          });
          return;
        }
        const near = anchorTooClose(guild, body.x, body.y);
        if (near) {
          sendJson(res, 409, {
            ok: false,
            error: 'anchor_too_close',
            other: near.name,
            minDistance: GUILD.anchorMinDistance,
            note: '离别的公会锚点太近'
          });
          return;
        }
        guild.anchor = { x: body.x, y: body.y };
        guild.anchorAt = Date.now();
        console.log('[guild] 挪锚点 account=' + identity.account + ' name=' + guild.name);
        sendJson(res, 200, { ok: true, role: 'leader', guild: guildView(guild) });
        return;
      }

      if (path === '/api/guild/mine') {
        const guild = guildOf(identity.account);
        if (!guild) {
          sendJson(res, 200, { ok: true, inGuild: false });
          return;
        }
        sendJson(res, 200, {
          ok: true,
          inGuild: true,
          role: guild.leader === identity.account ? 'leader' : 'member',
          // 等级 / 成员表都是现算的（成员等级从存档里读）—— 每次刷新都是最新的
          guild: guildView(guild)
        });
        return;
      }

      if (path === '/api/guild/list') {
        const asked = body.limit !== undefined ? body.limit : Number(url.searchParams.get('limit'));
        const limit = clampInt(asked, GUILD.listLimit, 1, 50);
        const rows = [];
        for (const guild of guilds.values()) {
          const view = guildView(guild);
          rows.push({
            id: guild.id,
            name: guild.name,
            level: view.level,
            exp: view.exp,
            count: view.count,
            online: view.online,
            memberCap: GUILD.memberCap,
            anchor: guild.anchor,
            createdAt: guild.createdAt
          });
        }
        // 人数多的排前面（一眼看到"哪个热闹"），同人数按等级、再按名字（顺序可复现）
        rows.sort((a, b) => b.count - a.count || b.level - a.level || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        sendJson(res, 200, { ok: true, total: rows.length, memberCap: GUILD.memberCap, guilds: rows.slice(0, limit) });
        return;
      }

      sendJson(res, 404, { ok: false, error: 'not_found', path: path, note: '公会端点见 docs\\douyin-cloud-deploy.md' });
      return;
    }

    sendJson(res, 404, { ok: false, error: 'not_found', method: req.method, path: path });
  } catch (error) {
    const code =
      error && error.message === 'bad_json' ? 400 : error && error.message === 'request_too_large' ? 413 : 500;
    sendJson(res, code, { ok: false, error: (error && error.message) || 'internal_error' });
  }
});

server.listen(PORT, () => {
  console.log('[' + SERVICE + '] listening on :' + PORT + '  v' + SERVICE_VERSION);
  console.log('  health  : GET  /api/health');
  console.log('  profile : POST /api/profile  { code }   -> openid + token');
  console.log('  save    : POST /api/save     { token | openid, save }');
  console.log('  load    : GET  /api/save?token=...   (或 ?openid=...)');
  console.log('  name    : POST /api/name     { name, account? }   -> 重名回 409（已登记 ' + names.size + ' 个）');
  console.log(
    '  guild   : POST /api/guild/create|join|leave|anchor  GET|POST /api/guild/mine|list' +
      '  -> 人数上限 ' +
      GUILD.memberCap +
      '，等级 = 1 + floor(Σ成员等级 / ' +
      GUILD.levelDivisor +
      ') 封顶 ' +
      GUILD.levelCap +
      '（已建立 ' +
      guilds.size +
      ' 个；内存版，重启即清）'
  );
  console.log(
    '  login   : ' +
      (LOGIN_CONFIGURED
        ? '已配置 -> ' + loginEndpointHost() + ' (' + CODE2SESSION_METHOD + ')'
        : '未配置 DOUYIN_APPID / DOUYIN_SECRET -> /api/profile 回 503（不编造 openid）')
  );
  console.log(
    '  token   : SESSION_SECRET ' +
      (SESSION_SECRET_IS_RANDOM ? '未设置（本次随机生成，重启后旧令牌失效）' : '来自环境变量') +
      '，REQUIRE_TOKEN=' +
      (REQUIRE_TOKEN ? '1（只收验签令牌）' : '0（仍开放未验证的过渡通道）')
  );
});
