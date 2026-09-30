/**
 * 抖音云后端服务（零依赖版）—— 阶段 B
 *
 * 为什么零依赖：
 *   抖音云控制台支持「上传代码包 / 在线编辑 / Docker 镜像」三种部署方式，零依赖的
 *   `node index.js` 三种都能跑、**不需要 npm install**，失败面最小。
 *   上一版工程验证过的组合是 Node + koa；这里为了"能直接贴进在线编辑器"只用 Node 自带的
 *   http / https / crypto，将来要换 koa/express 也只是换个路由写法。
 *
 * 端点（全部挂在 /api/ 下 —— 抖音云控制台的「访问控制」要授权 /api/* 才能外网访问）：
 *   GET  /api/health     健康检查（小游戏里「设置 → 云后端」调它；也回报登录是否已配置）
 *   GET  /api/version    协议与数值表版本（客户端用它判断要不要更新）
 *   POST /api/profile    **真·登录**：tt.login 的 code → code2session → openid，并签发会话令牌
 *   POST /api/save       上传存档（令牌优先；没令牌时走"未验证"的过渡通道）
 *   GET  /api/save       拉取存档（?token= 或 ?openid=）
 *
 * 登录链路（2026-09-30 接入，阶段 B 第一件事）：
 *   客户端 tt.login → code → POST /api/profile { code } → 服务端调抖音 code2session
 *   → 得到 openid（+ session_key，**session_key 永久留在服务端**）→ 签发我们自己的会话令牌。
 *   凭据只从环境变量读，**不写进代码**（这个包会被传到控制台、还可能贴进在线编辑器）：
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
const SERVICE_VERSION = '0.2.0';

/** 与 shared/balance.json 对应的版本信息：客户端用它判断是否需要更新数值表 */
const BALANCE_VERSION = 1;
const SEASON = { name: 'S1', worldSeed: 20260930 };
const PROTOCOL = 1;

const PORT = process.env.PORT || 8080;
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 900 * 1024;

/** 内存存档（演示用）。正式版换 SQLite / Redis，表结构见 docs\design\02-architecture.md §7 */
const saves = new Map();

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
    return { ok: true, verified: true, account: verified.account, subject: verified.account };
  }
  if (REQUIRE_TOKEN) {
    return { ok: false, status: 401, error: 'token_required' };
  }
  const raw = (body && typeof body.openid === 'string' && body.openid) || url.searchParams.get('openid') || '';
  if (!raw) return { ok: false, status: 400, error: 'missing_openid' };
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
    savedAt: record.savedAt,
    revision: record.revision
  };
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
