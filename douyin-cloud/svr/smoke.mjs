/**
 * smoke.mjs —— 抖音云后端的本地冒烟测试（零依赖）
 *
 * 为什么需要它：服务端代码"能通过 node --check"和"真的在监听端口"是两件事。
 *   2026-09-30 踩过一次：readBody 的函数体漏写一个 `}`，于是 http.createServer 与
 *   server.listen 全被吞进那个函数体内 —— 语法完全合法、`--check` 绿，但进程起来后
 *   静默退出、不监听任何端口（curl 得到 ECONNREFUSED / 控制台上是"冷启动超时"）。
 *   所以部署前必须跑一次**真进程 + 真 HTTP 请求**，这个文件就是那一关。
 *
 * 它还顺手把**登录链路**整条跑通（不连抖音云、不花一分钱）：起一个假的 code2session 服务，
 * 让服务端真的去调它，于是"换 openid / 签令牌 / 令牌鉴权 / 越权写 / 伪造与过期令牌"全都能验。
 *
 * 三段进程（都在 127.0.0.1 上，端口 = SMOKE_PORT(=8099) / +2 / +3；假抖音端在 +1）：
 *   A. 正常实例：给了 AppID/密钥，REQUIRE_TOKEN 关（阶段 B 的默认状态）
 *   B. 严格实例：REQUIRE_TOKEN=1（上线前要打开的形态）—— 顺便证明令牌是无状态的
 *   C. 裸实例：凭据一个都不给 —— 验证它是"明确 503"，而不是编造一个 openid
 *
 * 用法：
 *   tools\minigame-node.ps1 douyin-cloud\svr\smoke.mjs   本机没有独立 node 时（用抖音 IDE 的 Electron）
 *   node douyin-cloud\svr\smoke.mjs                      有 node 时；package.json 的 `npm run smoke` 就是它
 *
 * SMOKE_PORT 可换端口（默认 8099 —— 特意避开 8080，免得撞上本地已经在跑的东西）。
 * 这里只连 127.0.0.1，不碰抖音云、不产生任何费用。
 */

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(HERE, 'index.js');
const PORT = Number(process.env.SMOKE_PORT || 8099);
const READY_TIMEOUT_MS = 8000;

/** 全是假凭据：用来验证"服务端确实带着它们去换 openid"，以及"它们绝不会出现在响应里" */
const APPID = 'tt-smoke-appid';
const APP_SECRET = 'smoke-appsecret-should-never-leak';
const SESSION_SECRET = 'smoke-session-secret';
const FAKE_OPENID = 'openid-smoke-0001';
const SESSION_KEY = 'session-key-should-never-leak';
const ANON_OPENID = 'anon-device-smoke-9';

const results = [];

/** 起过的服务进程都记下来，跑完统一收尸（免得留下监听端口的孤儿进程） */
const children = [];

function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  const extra = ok || detail === undefined || detail === '' ? '' : '   <- ' + String(detail);
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + extra);
}

function request(base, method, urlPath, body, rawBody, headers) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(rawBody ? String(body) : JSON.stringify(body), 'utf8');
    const head = Object.assign(
      {},
      data ? { 'content-type': 'application/json', 'content-length': data.length } : {},
      headers || {}
    );
    const req = http.request(base + urlPath, { method, headers: head }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try {
          json = JSON.parse(text);
        } catch (error) {
          json = null;
        }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('client_timeout')));
    if (data) req.write(data);
    req.end();
  });
}

/* --------------------------------------------- 假的 code2session（抖音那一端） */

/**
 * 假装自己是 developer.toutiao.com：
 *   - 凭据不对        -> err_no 40002（顺带证明服务端真的把 appid/secret 带过来了）
 *   - code=good-code  -> v2 形状（字段嵌在 data 里），带 session_key
 *   - code=anon-code  -> 只回 anonymous_openid（抖音的匿名登录）
 *   - code=v1-code    -> v1 形状（字段在顶层），用来验兼容解析
 *   - code=broken-json-> 回一段不是 JSON 的东西（验 502，而不是把进程搞崩）
 *   - 其它            -> err_no 40001（code 无效）
 * GET 也支持：v1 接口是 GET + 查询串，服务端换 METHOD 时不该改代码。
 */
function startFakeCode2Session(port) {
  const calls = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body = {};
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch (error) {
        body = {};
      }
      const query = new URL(req.url, 'http://127.0.0.1').searchParams;
      const appid = body.appid || query.get('appid') || '';
      const secret = body.secret || query.get('secret') || '';
      const code = body.code || query.get('code') || '';
      calls.push({ method: req.method, appid, secret, code });

      const send = (status, payload) => {
        const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
        res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
        res.end(text);
      };

      if (appid !== APPID || secret !== APP_SECRET) {
        send(200, { err_no: 40002, err_tips: 'appid or secret invalid' });
        return;
      }
      if (code === 'good-code') {
        send(200, {
          err_no: 0,
          err_tips: '',
          data: { session_key: SESSION_KEY, openid: FAKE_OPENID, anonymous_openid: 'anon-' + FAKE_OPENID, unionid: 'union-smoke' }
        });
        return;
      }
      if (code === 'anon-code') {
        send(200, { err_no: 0, err_tips: '', data: { session_key: SESSION_KEY, anonymous_openid: ANON_OPENID } });
        return;
      }
      if (code === 'v1-code') {
        // 老版接口：字段直接给在顶层
        send(200, { err_no: 0, openid: 'openid-v1-shape', session_key: SESSION_KEY });
        return;
      }
      if (code === 'broken-json') {
        send(200, 'this is not json {');
        return;
      }
      send(200, { err_no: 40001, err_tips: 'code invalid' });
    });
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      resolve({
        calls,
        close: () =>
          new Promise((done) => {
            server.close(() => done());
          })
      });
    });
  });
}

/* --------------------------------------------------------- 起真进程 + 等监听 */

/**
 * spawn 一个真的服务进程，等它打印 listening。
 * 超时 = 它起来后没监听（就是上面那个 readBody bug 的失效模式），把 stdout/stderr 带回去当证据。
 */
function startServer(port, extraEnv) {
  const child = spawn(process.execPath, [ENTRY], {
    env: Object.assign({}, process.env, { PORT: String(port) }, extraEnv),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  children.push(child);
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString('utf8');
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString('utf8');
  });
  const started = Date.now();
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      if (/listening on/.test(stdout)) {
        clearInterval(timer);
        resolve({ base: 'http://127.0.0.1:' + port, out: () => stdout, failed: '' });
        return;
      }
      if (Date.now() - started > READY_TIMEOUT_MS) {
        clearInterval(timer);
        child.kill();
        resolve({
          base: 'http://127.0.0.1:' + port,
          out: () => stdout,
          failed: 'stdout=' + JSON.stringify(stdout) + ' stderr=' + JSON.stringify(stderr)
        });
      }
    }, 100);
  });
}

/* --------------------------------------- 自己签令牌（用来造过期 / 伪造的对照） */

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 用给定密钥签一个令牌：密钥不对、exp 在过去，就是我们要的两类坏令牌 */
function mintToken(payload, secret) {
  const text = base64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  return text + '.' + base64url(crypto.createHmac('sha256', secret).update(text).digest());
}

/** 服务端硬编码的数值表版本必须和 shared\balance.json 一致，否则线上会拒收存档 */
function checkBalanceDrift(health) {
  const sharedPath = path.join(HERE, '..', '..', 'shared', 'balance.json');
  let shared = null;
  try {
    shared = existsSync(sharedPath) ? JSON.parse(readFileSync(sharedPath, 'utf8')) : null;
  } catch (error) {
    shared = null;
  }
  check(
    '服务端 balanceVersion 与 shared\\balance.json 一致',
    !!shared && !!health && health.balanceVersion === shared.version,
    shared ? 'server=' + (health && health.balanceVersion) + ' shared=' + shared.version : 'shared\\balance.json 读不到'
  );
  check(
    '服务端赛季 worldSeed 与 shared\\balance.json 一致',
    !!shared && !!health && !!health.season && health.season.worldSeed === shared.season.worldSeed,
    health && health.season ? JSON.stringify(health.season) : 'health 里没有 season'
  );
}

/* ---------------------------------------------------------------- 断言主体 */

async function main() {
  const fake = await startFakeCode2Session(PORT + 1);
  const svr = await startServer(PORT, {
    DOUYIN_APPID: APPID,
    DOUYIN_SECRET: APP_SECRET,
    SESSION_SECRET: SESSION_SECRET,
    CODE2SESSION_URL: 'http://127.0.0.1:' + (PORT + 1) + '/api/apps/v2/jscode2session'
  });
  check(
    '服务端真的在监听端口（不是"起来就静默退出"—— 2026-09-30 的 readBody bug 正是这样）',
    !svr.failed,
    svr.failed
  );
  if (svr.failed) {
    await fake.close();
    report();
    return;
  }
  const base = svr.base;

  /* --- 基础：健康检查 / 版本 / 数值表对齐 / 凭据不外泄 --- */
  const health = await request(base, 'GET', '/api/health');
  check(
    'GET /api/health 返回 ok + 服务名',
    health.status === 200 && !!health.json && health.json.ok === true && health.json.service === 'phaser-game-svr',
    JSON.stringify(health.json)
  );
  check(
    'GET /api/health 带 x-server-time 响应头（客户端时钟对齐用）',
    /^\d+$/.test(String(health.headers['x-server-time'] || '')),
    'x-server-time=' + health.headers['x-server-time']
  );
  checkBalanceDrift(health.json);
  check(
    '健康检查回报"登录已配置"，但不回 appid / secret',
    !!health.json &&
      !!health.json.login &&
      health.json.login.configured === true &&
      health.json.login.requireToken === false &&
      !health.text.includes(APP_SECRET) &&
      !health.text.includes(APPID),
    JSON.stringify(health.json && health.json.login)
  );

  const version = await request(base, 'GET', '/api/version');
  check(
    'GET /api/version 回协议与数值表版本',
    version.status === 200 &&
      !!version.json &&
      typeof version.json.protocol === 'number' &&
      typeof version.json.balanceVersion === 'number',
    JSON.stringify(version.json)
  );

  /* --- 登录：tt.login 的 code -> code2session -> openid -> 我们自己的令牌 --- */
  const login = await request(base, 'POST', '/api/profile', { code: 'good-code' });
  const token = login.json && typeof login.json.token === 'string' ? login.json.token : '';
  check(
    'POST /api/profile 用 code 换到真 openid（code2session 真的被调用了）',
    login.status === 200 && !!login.json && login.json.openid === FAKE_OPENID && login.json.account === 'douyin:' + FAKE_OPENID,
    JSON.stringify(login.json && { status: login.status, openid: login.json.openid, account: login.json.account })
  );
  check(
    '登录响应里没有 session_key，也没有 appsecret（它们只留在服务端）',
    login.status === 200 && !login.text.includes(SESSION_KEY) && !login.text.includes(APP_SECRET),
    'text=' + login.text.slice(0, 140)
  );
  check(
    '签发的令牌是 payload.signature 两段，并带过期时间',
    token.split('.').length === 2 && !!login.json && typeof login.json.expiresAt === 'number' && login.json.expiresAt > Date.now(),
    'token=' + token.slice(0, 22) + '... expiresAt=' + (login.json && login.json.expiresAt)
  );
  check(
    '服务端确实带着我们的 appid / secret 去调了 code2session',
    fake.calls.some((call) => call.code === 'good-code' && call.appid === APPID && call.secret === APP_SECRET),
    JSON.stringify(fake.calls.map((call) => call.method + ' ' + call.code))
  );

  const noCode = await request(base, 'POST', '/api/profile', {});
  check(
    'POST /api/profile 没带 code 时 400 missing_code',
    noCode.status === 400 && !!noCode.json && noCode.json.error === 'missing_code',
    'status=' + noCode.status
  );

  const badCode = await request(base, 'POST', '/api/profile', { code: 'expired-code' });
  check(
    'code2session 拒绝（err_no 40001）时回 401 并透传 errNo（便于排查）',
    badCode.status === 401 && !!badCode.json && badCode.json.error === 'code2session_failed' && badCode.json.errNo === 40001,
    JSON.stringify(badCode.json)
  );

  const v1 = await request(base, 'POST', '/api/profile', { code: 'v1-code' });
  check(
    '兼容 v1 响应形状（字段在顶层的老接口）',
    v1.status === 200 && !!v1.json && v1.json.openid === 'openid-v1-shape',
    JSON.stringify(v1.json)
  );

  const anon = await request(base, 'POST', '/api/profile', { code: 'anon-code' });
  check(
    '只拿到 anonymous_openid 时也能登录，账号落在 anon: 命名空间',
    anon.status === 200 && !!anon.json && anon.json.anonymous === true && anon.json.account === 'anon:' + ANON_OPENID,
    JSON.stringify(anon.json)
  );

  const broken = await request(base, 'POST', '/api/profile', { code: 'broken-json' });
  check(
    'code2session 回坏 JSON 时 502（不是 500，也没把进程搞崩）',
    broken.status === 502 && !!broken.json && broken.json.error === 'code2session_bad_response',
    'status=' + broken.status + ' body=' + broken.text
  );

  /* --- 令牌鉴权：存档写在"令牌里的账号"上，客户端给的 openid 不作数 --- */
  const saveByToken = await request(base, 'POST', '/api/save', {
    token: token,
    save: { v: 1, balanceVersion: 1, level: 9, gold: 120, horns: 2 }
  });
  check(
    'POST /api/save 用令牌写入：verified:true、revision 从 1 开始',
    saveByToken.status === 200 &&
      !!saveByToken.json &&
      saveByToken.json.ok === true &&
      saveByToken.json.verified === true &&
      saveByToken.json.revision === 1 &&
      saveByToken.json.account === 'douyin:' + FAKE_OPENID,
    JSON.stringify(saveByToken.json)
  );

  const loadByToken = await request(base, 'GET', '/api/save?token=' + encodeURIComponent(token));
  check(
    'GET /api/save?token= 取回同一条存档',
    loadByToken.status === 200 && !!loadByToken.json && !!loadByToken.json.save && loadByToken.json.save.level === 9 && loadByToken.json.verified === true,
    JSON.stringify(loadByToken.json)
  );

  const bearer = await request(base, 'GET', '/api/save', undefined, false, { authorization: 'Bearer ' + token });
  check(
    'Authorization: Bearer 也认（预检已放行该头）',
    bearer.status === 200 && !!bearer.json && !!bearer.json.save && bearer.json.save.level === 9,
    'status=' + bearer.status
  );

  const overwrite = await request(base, 'POST', '/api/save', {
    token: token,
    openid: 'attacker-openid',
    save: { v: 1, balanceVersion: 1, level: 99 }
  });
  const attackerRead = await request(base, 'GET', '/api/save?openid=attacker-openid');
  check(
    '有令牌时 body 里的 openid 被忽略：写不进别人账号（越权）',
    overwrite.status === 200 &&
      overwrite.json.revision === 2 &&
      attackerRead.status === 404 &&
      attackerRead.json.error === 'no_save',
    'overwrite=' + JSON.stringify(overwrite.json) + ' attackerRead=' + attackerRead.status
  );

  const tamperParts = token.split('.');
  const tamperedPayload = JSON.parse(
    Buffer.from(tamperParts[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
  );
  tamperedPayload.sub = 'douyin:someone-else';
  const tamperedToken = base64url(Buffer.from(JSON.stringify(tamperedPayload), 'utf8')) + '.' + tamperParts[1];
  const tamperedRes = await request(base, 'POST', '/api/save', {
    token: tamperedToken,
    save: { v: 1, balanceVersion: 1, level: 1 }
  });
  check(
    '改过 payload 的令牌（签名对不上）401 bad_token',
    tamperedRes.status === 401 && !!tamperedRes.json && tamperedRes.json.error === 'bad_token',
    'status=' + tamperedRes.status + ' body=' + tamperedRes.text
  );

  const forgedToken = mintToken({ sub: 'douyin:' + FAKE_OPENID, exp: Date.now() + 60000 }, 'wrong-secret');
  const forgedRes = await request(base, 'POST', '/api/save', {
    token: forgedToken,
    save: { v: 1, balanceVersion: 1, level: 1 }
  });
  check(
    '换密钥伪造签名的令牌 401 bad_token',
    forgedRes.status === 401 && !!forgedRes.json && forgedRes.json.error === 'bad_token',
    'status=' + forgedRes.status
  );

  const expiredToken = mintToken({ sub: 'douyin:' + FAKE_OPENID, exp: Date.now() - 1000 }, SESSION_SECRET);
  const expiredRes = await request(base, 'POST', '/api/save', {
    token: expiredToken,
    save: { v: 1, balanceVersion: 1, level: 1 }
  });
  check(
    '过期令牌（exp 在过去）401 token_expired',
    expiredRes.status === 401 && !!expiredRes.json && expiredRes.json.error === 'token_expired',
    'status=' + expiredRes.status + ' body=' + expiredRes.text
  );

  /* --- 过渡通道（没令牌）：能写，但明确标未验证，且与验签账号隔离 --- */
  const legacyWrite = await request(base, 'POST', '/api/save', { openid: 'smoke-openid', save: { v: 1, level: 7 } });
  check(
    '没令牌时走过渡通道：200 + verified:false，账号带 openid: 前缀',
    legacyWrite.status === 200 && !!legacyWrite.json && legacyWrite.json.verified === false && legacyWrite.json.account === 'openid:smoke-openid',
    JSON.stringify(legacyWrite.json)
  );

  const legacyRead = await request(base, 'GET', '/api/save?openid=smoke-openid');
  check(
    '过渡通道的存档能取回（阶段 B 的客户端先跑通往返用）',
    legacyRead.status === 200 && !!legacyRead.json && !!legacyRead.json.save && legacyRead.json.save.level === 7,
    JSON.stringify(legacyRead.json)
  );

  const tokenAfterLegacy = await request(base, 'GET', '/api/save?token=' + encodeURIComponent(token));
  check(
    '未验证的写不会碰到验签账号的数据（命名空间隔离）',
    tokenAfterLegacy.status === 200 && !!tokenAfterLegacy.json && !!tokenAfterLegacy.json.save && tokenAfterLegacy.json.save.level === 99,
    JSON.stringify(tokenAfterLegacy.json)
  );

  const noIdentity = await request(base, 'POST', '/api/save', { save: { v: 1 } });
  check(
    '既没令牌也没 openid 时 400 missing_openid',
    noIdentity.status === 400 && !!noIdentity.json && noIdentity.json.error === 'missing_openid',
    'status=' + noIdentity.status
  );

  const badSave = await request(base, 'POST', '/api/save', { openid: 'smoke-openid', save: { level: 7 } });
  check(
    'POST /api/save 版本号不对时 400 bad_save',
    badSave.status === 400 && !!badSave.json && badSave.json.error === 'bad_save',
    'status=' + badSave.status
  );

  const drift = await request(base, 'POST', '/api/save', { openid: 'smoke-openid', save: { v: 1, balanceVersion: 99 } });
  check(
    '存档自带的 balanceVersion 漂移时 409 balance_mismatch（两套数值不许混）',
    drift.status === 409 && !!drift.json && drift.json.error === 'balance_mismatch' && drift.json.serverBalanceVersion === 1,
    JSON.stringify(drift.json)
  );

  const noSave = await request(base, 'GET', '/api/save?openid=nobody-here');
  check('GET /api/save 没有存档时 404 no_save', noSave.status === 404 && !!noSave.json && noSave.json.error === 'no_save', 'status=' + noSave.status);

  // 注意要发**真的坏 JSON**：走 JSON.stringify 的话 '"not-an-object"' 反而是合法 JSON，
  // 服务端会正确地回 200（第一版测试就是这么自己骗自己的）。
  const badJson = await request(base, 'POST', '/api/profile', '{"code": 这不是 JSON', true);
  check('POST 坏 JSON 时 400（而不是 500）', badJson.status === 400, 'status=' + badJson.status + ' body=' + badJson.text);

  const notApi = await request(base, 'GET', '/nope');
  check('GET /nope 返回 404（/api/ 之外一律不放行）', notApi.status === 404, 'status=' + notApi.status);

  const notFound = await request(base, 'GET', '/api/nope');
  check(
    'GET /api/nope 返回 404 not_found',
    notFound.status === 404 && !!notFound.json && notFound.json.error === 'not_found',
    JSON.stringify(notFound.json)
  );

  const preflight = await request(base, 'OPTIONS', '/api/health');
  check(
    'OPTIONS 预检：204 + CORS 放行 authorization 头',
    preflight.status === 204 &&
      preflight.headers['access-control-allow-origin'] === '*' &&
      /authorization/.test(String(preflight.headers['access-control-allow-headers'] || '')),
    'status=' + preflight.status + ' allow-headers=' + preflight.headers['access-control-allow-headers']
  );

  /* --- 严格实例（REQUIRE_TOKEN=1）：关掉过渡通道，且令牌跨实例依然有效 --- */
  const strictEnv = {
    DOUYIN_APPID: APPID,
    DOUYIN_SECRET: APP_SECRET,
    SESSION_SECRET: SESSION_SECRET,
    REQUIRE_TOKEN: '1',
    CODE2SESSION_URL: 'http://127.0.0.1:' + (PORT + 1) + '/api/apps/v2/jscode2session'
  };
  const strict = await startServer(PORT + 2, strictEnv);
  check('REQUIRE_TOKEN=1 的实例也能起来', !strict.failed, strict.failed);
  if (!strict.failed) {
    const strictNoToken = await request(strict.base, 'POST', '/api/save', {
      openid: 'smoke-openid',
      save: { v: 1, level: 7 }
    });
    check(
      'REQUIRE_TOKEN=1 时，没令牌写存档回 401 token_required',
      strictNoToken.status === 401 && !!strictNoToken.json && strictNoToken.json.error === 'token_required',
      JSON.stringify(strictNoToken.json)
    );

    const crossInstance = await request(strict.base, 'POST', '/api/save', {
      token: token,
      save: { v: 1, balanceVersion: 1, level: 30 }
    });
    check(
      'A 实例签发的令牌在 B 实例同样有效（无状态令牌 = 换部署/多实例不掉线）',
      crossInstance.status === 200 &&
        !!crossInstance.json &&
        crossInstance.json.verified === true &&
        crossInstance.json.account === 'douyin:' + FAKE_OPENID,
      JSON.stringify(crossInstance.json)
    );
  }

  /* --- 裸实例（凭据一个都没给）：明确 503，绝不编造 openid --- */
  const bare = await startServer(PORT + 3, {
    DOUYIN_APPID: '',
    DOUYIN_SECRET: '',
    TT_APPID: '',
    TT_SECRET: '',
    SESSION_SECRET: ''
  });
  check('没配凭据的实例也能起来（默认状态不炸）', !bare.failed, bare.failed);
  if (!bare.failed) {
    const bareHealth = await request(bare.base, 'GET', '/api/health');
    check(
      '裸实例健康检查里 login.configured=false（一眼看出还没配）',
      bareHealth.status === 200 &&
        !!bareHealth.json &&
        bareHealth.json.login.configured === false &&
        bareHealth.json.login.sessionSecretIsRandom === true,
      JSON.stringify(bareHealth.json && bareHealth.json.login)
    );

    const bareProfile = await request(bare.base, 'POST', '/api/profile', { code: 'good-code' });
    check(
      '裸实例的 /api/profile 回 503 not_configured（不编造 openid）',
      bareProfile.status === 503 &&
        !!bareProfile.json &&
        bareProfile.json.error === 'not_configured' &&
        !bareProfile.text.includes('openid'),
      'status=' + bareProfile.status + ' body=' + bareProfile.text
    );

    const bareLegacy = await request(bare.base, 'POST', '/api/save', { openid: 'smoke-openid', save: { v: 1, level: 3 } });
    check(
      '裸实例仍能走过渡通道写存档（未配凭据 ≠ 后端不可用）',
      bareLegacy.status === 200 && !!bareLegacy.json && bareLegacy.json.verified === false,
      JSON.stringify(bareLegacy.json)
    );
  }

  await fake.close();
}

function report() {
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log('');
  if (failed === 0) {
    console.log('RESULT PASS ' + passed + '/' + results.length + '  (后端可上传到抖音云)');
    process.exitCode = 0;
  } else {
    console.log('RESULT FAIL ' + passed + '/' + results.length + '  (' + failed + ' 项失败)');
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    check('smoke 自身未抛异常', false, (error && error.stack) || String(error));
  })
  .then(() => {
    // 统一收尸：跑完别留下监听 8099/8101/8102 的孤儿进程
    children.forEach((child) => {
      try {
        child.kill();
      } catch (error) {
        /* 已经退出的进程再 kill 会抛，忽略 */
      }
    });
    report();
  });




