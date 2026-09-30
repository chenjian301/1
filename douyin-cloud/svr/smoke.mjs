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
 * 让服务端真的去调它，于是"换 openid / 签令牌 / 令牌鉴权 / 越权写 / 伪造与过期令牌"全都能验；
 * 昵称唯一性（/api/name：首次登记 / 重名 409 / 同设备幂等 / 非法输入 / 带令牌时占用人来自令牌）也一样。
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
 * SMOKE_PORT 可换端口（默认 8099 —— 特意避开 8000：那是服务的线上默认端口，也是官方模板的端口，
 * 免得撞上本机已经在跑的东西）。
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

  /* --- 昵称唯一性（/api/name）：用户要求"昵称不能重复"的服务端一半 --- */
  const claim1 = await request(base, 'POST', '/api/name', { name: '孤影001', account: 'dev-a' });
  check(
    'POST /api/name 首次登记 200 + claimed=true',
    claim1.status === 200 && !!claim1.json && claim1.json.ok === true && claim1.json.claimed === true && claim1.json.key === '孤影001',
    JSON.stringify(claim1.json)
  );

  const claimDup = await request(base, 'POST', '/api/name', { name: '孤影001', account: 'dev-b' });
  check(
    '另一台设备抢同一个昵称回 409 name_taken（跨设备去重）',
    claimDup.status === 409 && !!claimDup.json && claimDup.json.error === 'name_taken',
    'status=' + claimDup.status
  );

  const claimSame = await request(base, 'POST', '/api/name', { name: ' 孤影001 ', account: 'dev-a' });
  check(
    '同一台设备重复登记是幂等的（claimed=false，不报错）',
    claimSame.status === 200 && !!claimSame.json && claimSame.json.claimed === false,
    JSON.stringify(claimSame.json)
  );

  const claimCase = await request(base, 'POST', '/api/name', { name: 'ALICE01', account: 'dev-a' });
  const claimCaseDup = await request(base, 'POST', '/api/name', { name: 'alice01', account: 'dev-b' });
  check(
    '大小写不同算同一个昵称（ALICE01 == alice01）',
    claimCase.status === 200 && claimCaseDup.status === 409,
    claimCase.status + ' / ' + claimCaseDup.status
  );

  const claimShort = await request(base, 'POST', '/api/name', { name: '甲', account: 'dev-a' });
  const claimIllegal = await request(base, 'POST', '/api/name', { name: '名字!!', account: 'dev-a' });
  const claimReserved = await request(base, 'POST', '/api/name', { name: '管理员', account: 'dev-a' });
  const claimLong = await request(base, 'POST', '/api/name', { name: '一二三四五六七八九十十一十二十三', account: 'dev-a' });
  check(
    '非法昵称按原因回 400（太短 / 有符号 / 保留名 / 太长）—— 与客户端同一套规则',
    claimShort.status === 400 &&
      claimShort.json.reason === 'too_short' &&
      claimIllegal.status === 400 &&
      claimIllegal.json.reason === 'illegal' &&
      claimReserved.status === 400 &&
      claimReserved.json.reason === 'reserved' &&
      claimLong.status === 400 &&
      claimLong.json.reason === 'too_long',
    [claimShort.json.reason, claimIllegal.json.reason, claimReserved.json.reason, claimLong.json.reason].join(',')
  );

  const claimWithToken = await request(base, 'POST', '/api/name', { name: '带令牌的昵称', token: token, account: 'spoofed-account' });
  check(
    '带令牌登记时占用人来自令牌（verified=true），body 里的 account 被忽略',
    claimWithToken.status === 200 &&
      !!claimWithToken.json &&
      claimWithToken.json.verified === true &&
      String(claimWithToken.json.account).indexOf('douyin:') === 0,
    JSON.stringify(claimWithToken.json)
  );

  const healthWithNames = await request(base, 'GET', '/api/health');
  check(
    '健康检查回报已登记昵称数（names > 0）',
    healthWithNames.status === 200 && !!healthWithNames.json && healthWithNames.json.names > 0,
    'names=' + (healthWithNames.json && healthWithNames.json.names)
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

  /* --------------------------------------------------------------- 公会（本次新增） */

  /**
   * 三个假账号（直接用 SESSION_SECRET 各签一个令牌）：公会端点认的就是 /api/save 那一套身份，
   * 所以"三个人"用三条不同 sub 的令牌就够了，不必再跑三次登录链路。
   */
  const now = Date.now();
  const leaderToken = mintToken({ sub: 'douyin:smoke-leader', iat: now, exp: now + 3600000, v: 1 }, SESSION_SECRET);
  const memberToken = mintToken({ sub: 'douyin:smoke-member1', iat: now, exp: now + 3600000, v: 1 }, SESSION_SECRET);
  const otherToken = mintToken({ sub: 'douyin:smoke-member2', iat: now, exp: now + 3600000, v: 1 }, SESSION_SECRET);
  const sharedBalance = (() => {
    try {
      const p = path.join(HERE, '..', '..', 'shared', 'balance.json');
      return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
    } catch (error) {
      return null;
    }
  })();
  const guildRules = sharedBalance && sharedBalance.guild ? sharedBalance.guild : {};

  const created = await request(base, 'POST', '/api/guild/create', {
    token: leaderToken,
    name: '烟测兄弟会',
    x: 5000,
    y: 6000,
    playerName: '烟测会长',
    playerLevel: 30
  });
  check(
    'POST /api/guild/create：建会成功，我是会长，成员表里就我一个',
    created.status === 200 &&
      !!created.json &&
      created.json.ok === true &&
      created.json.role === 'leader' &&
      created.json.guild.name === '烟测兄弟会' &&
      created.json.guild.members.length === 1 &&
      created.json.guild.members[0].role === 'leader' &&
      created.json.guild.members[0].name === '烟测会长',
    JSON.stringify(created.json)
  );
  check(
    '公会人数上限与 shared\\balance.json 一致（服务端那份规则没有漂移）',
    !!created.json && created.json.guild.memberCap === guildRules.memberCap,
    'server=' + (created.json && created.json.guild.memberCap) + ' shared=' + guildRules.memberCap
  );
  check(
    '公会等级 = 1 + floor(Σ成员等级 / levelDivisor)：30 级的会长 = 1 级、经验 30',
    !!created.json && created.json.guild.level === 1 && created.json.guild.exp === 30,
    JSON.stringify(created.json && { level: created.json.guild.level, exp: created.json.guild.exp })
  );
  check(
    '锚点就记在建会时给的那一点上',
    !!created.json && created.json.guild.anchor.x === 5000 && created.json.guild.anchor.y === 6000,
    JSON.stringify(created.json && created.json.guild.anchor)
  );
  check(
    '响应里不回 account / openid（成员表只给名字与等级）',
    !!created.json && !created.text.includes('openid') && !created.text.includes('smoke-leader'),
    created.text.slice(0, 200)
  );

  const dupName = await request(base, 'POST', '/api/guild/create', {
    token: memberToken,
    name: '烟测兄弟会',
    x: 90000,
    y: 90000,
    playerName: '烟测乙',
    playerLevel: 45
  });
  check(
    '公会名全服唯一：第二个人用同一个名字建会回 409 name_taken',
    dupName.status === 409 && !!dupName.json && dupName.json.error === 'name_taken',
    JSON.stringify(dupName.json)
  );

  const dupCreate = await request(base, 'POST', '/api/guild/create', { token: leaderToken, name: '另一个名字' });
  check(
    '一个账号只能在一个公会里：再建一次回 409 already_in_guild',
    dupCreate.status === 409 && !!dupCreate.json && dupCreate.json.error === 'already_in_guild',
    JSON.stringify(dupCreate.json)
  );

  const badName = await request(base, 'POST', '/api/guild/create', { token: memberToken, name: '甲' });
  check(
    '公会名太短回 400 invalid_name（顺带回长度规则，与服务端那份平衡表一致）',
    badName.status === 400 &&
      !!badName.json &&
      badName.json.error === 'invalid_name' &&
      badName.json.reason === 'too_short' &&
      badName.json.nameMin === guildRules.nameMin &&
      badName.json.nameMax === guildRules.nameMax,
    JSON.stringify(badName.json)
  );

  const joinNoGuild = await request(base, 'POST', '/api/guild/join', { token: memberToken, name: '根本没有这个会' });
  check(
    '加入一个不存在的公会回 404 no_guild',
    joinNoGuild.status === 404 && !!joinNoGuild.json && joinNoGuild.json.error === 'no_guild',
    JSON.stringify(joinNoGuild.json)
  );

  const joined = await request(base, 'POST', '/api/guild/join', {
    token: memberToken,
    name: '烟测兄弟会',
    playerName: '烟测乙',
    playerLevel: 45
  });
  check(
    'POST /api/guild/join：第二个人进来了（角色是 member，人数 2）',
    joined.status === 200 &&
      !!joined.json &&
      joined.json.ok === true &&
      joined.json.role === 'member' &&
      joined.json.guild.members.length === 2 &&
      joined.json.guild.count === 2,
    JSON.stringify(joined.json && { role: joined.json.role, count: joined.json.guild.count })
  );
  check(
    '公会等级跟着成员等级之和涨：30 + 45 = 75 点，仍是 1 级（差 25 点升 2 级）',
    !!joined.json && joined.json.guild.level === 1 && joined.json.guild.exp === 75,
    JSON.stringify(joined.json && { level: joined.json.guild.level, exp: joined.json.guild.exp })
  );
  check(
    '在线状态是个布尔（没有长连接，它表示"最近两分钟跟服务端说过话"）',
    !!joined.json && typeof joined.json.guild.members[0].online === 'boolean' && joined.json.guild.online >= 1,
    JSON.stringify(joined.json && { online: joined.json.guild.online })
  );

  const mine = await request(base, 'POST', '/api/guild/mine', { token: leaderToken });
  check(
    'POST /api/guild/mine：会长那边也看得见新成员（成员表是现算的）',
    mine.status === 200 && !!mine.json && mine.json.inGuild === true && mine.json.role === 'leader' && mine.json.guild.count === 2,
    JSON.stringify(mine.json && { role: mine.json.role, count: mine.json.guild && mine.json.guild.count })
  );

  const outsiderMine = await request(base, 'POST', '/api/guild/mine', { token: otherToken });
  check(
    '没入会的人 /api/guild/mine 回 inGuild:false（不是错误 —— 界面据此显示"创建 / 加入"）',
    outsiderMine.status === 200 && !!outsiderMine.json && outsiderMine.json.ok === true && outsiderMine.json.inGuild === false,
    JSON.stringify(outsiderMine.json)
  );

  const listed = await request(base, 'POST', '/api/guild/list', { token: memberToken, limit: 10 });
  check(
    'POST /api/guild/list：列表里有这个会，等级 / 人数都对',
    listed.status === 200 &&
      !!listed.json &&
      listed.json.ok === true &&
      listed.json.total >= 1 &&
      listed.json.guilds[0].name === '烟测兄弟会' &&
      listed.json.guilds[0].count === 2 &&
      listed.json.guilds[0].level === 1,
    JSON.stringify(listed.json && listed.json.guilds && listed.json.guilds[0])
  );

  // 客户端每次调公会接口都带上自己的名字与等级 → 服务端顺手刷新"我"那条记录：
  // 于是"练了一级 → 公会等级跟着涨"现在就能成立（云存档还没接上，这是兜底那一份）
  const refreshed = await request(base, 'POST', '/api/guild/mine', {
    token: memberToken,
    playerName: '烟测乙',
    playerLevel: 120
  });
  check(
    '成员的自报等级会刷新成员表：30 + 120 = 150 → 公会等级涨到 2 级',
    refreshed.status === 200 && !!refreshed.json && refreshed.json.guild.level === 2 && refreshed.json.guild.exp === 150,
    JSON.stringify(refreshed.json && { level: refreshed.json.guild.level, exp: refreshed.json.guild.exp })
  );

  const anchorByMember = await request(base, 'POST', '/api/guild/anchor', { token: memberToken, x: 1, y: 1 });
  check(
    '只有会长能挪锚点：成员调它回 403 not_leader',
    anchorByMember.status === 403 && !!anchorByMember.json && anchorByMember.json.error === 'not_leader',
    JSON.stringify(anchorByMember.json)
  );
  const anchorBad = await request(base, 'POST', '/api/guild/anchor', { token: leaderToken, x: 'x', y: null });
  check(
    '锚点坐标不是数时回 400 bad_anchor',
    anchorBad.status === 400 && !!anchorBad.json && anchorBad.json.error === 'bad_anchor',
    JSON.stringify(anchorBad.json)
  );
  const anchorCool = await request(base, 'POST', '/api/guild/anchor', { token: leaderToken, x: 40000, y: 40000 });
  check(
    '锚点有 24 小时冷却：刚建完会就挪回 409 anchor_cooldown（并回还要等多久）',
    anchorCool.status === 409 &&
      !!anchorCool.json &&
      anchorCool.json.error === 'anchor_cooldown' &&
      anchorCool.json.waitMs > 0,
    JSON.stringify(anchorCool.json)
  );

  const guildB = await request(base, 'POST', '/api/guild/create', {
    token: otherToken,
    name: '烟测远征团',
    x: 5000 + guildRules.anchorMinDistance + 1000,
    y: 6000,
    playerName: '烟测丙',
    playerLevel: 5000
  });
  check(
    '第二家公会在别的锚点上建得起来，且等级封顶在 balance 的 levelCap（5000 级的成员也超不过它）',
    guildB.status === 200 && !!guildB.json && guildB.json.ok === true && guildB.json.guild.level === guildRules.levelCap,
    JSON.stringify(guildB.json && guildB.json.guild)
  );
  const nearCreate = await request(base, 'POST', '/api/guild/create', {
    token: mintToken({ sub: 'douyin:smoke-close', iat: now, exp: now + 3600000, v: 1 }, SESSION_SECRET),
    name: '挨得太近的会',
    x: 5000 + 10,
    y: 6000
  });
  check(
    '锚点离已有公会太近时建会回 409 anchor_too_close',
    nearCreate.status === 409 && !!nearCreate.json && nearCreate.json.error === 'anchor_too_close',
    JSON.stringify(nearCreate.json)
  );

  const leaveOwner = await request(base, 'POST', '/api/guild/leave', { token: leaderToken });
  check(
    '会长不能退会（首版没有转让 / 解散）：409 owner_cannot_leave',
    leaveOwner.status === 409 && !!leaveOwner.json && leaveOwner.json.error === 'owner_cannot_leave',
    JSON.stringify(leaveOwner.json)
  );
  const leftOk = await request(base, 'POST', '/api/guild/leave', { token: memberToken });
  check(
    '成员能退会：200 + left=<公会名>',
    leftOk.status === 200 && !!leftOk.json && leftOk.json.ok === true && leftOk.json.left === '烟测兄弟会',
    JSON.stringify(leftOk.json)
  );
  const afterLeave = await request(base, 'POST', '/api/guild/mine', { token: memberToken });
  check(
    '退会以后 /api/guild/mine 就回 inGuild:false 了',
    afterLeave.status === 200 && !!afterLeave.json && afterLeave.json.inGuild === false,
    JSON.stringify(afterLeave.json)
  );

  // 塞满这个公会：会长 + (memberCap - 1) 个成员 = memberCap，下一个人必须被挡住
  let filled = true;
  for (let i = 0; i < guildRules.memberCap - 1; i += 1) {
    const fillToken = mintToken({ sub: 'douyin:smoke-fill-' + i, iat: now, exp: now + 3600000, v: 1 }, SESSION_SECRET);
    const res = await request(base, 'POST', '/api/guild/join', {
      token: fillToken,
      name: '烟测兄弟会',
      playerName: '烟测成员' + i,
      playerLevel: 5
    });
    if (!(res.status === 200 && res.json && res.json.ok === true)) filled = false;
  }
  check('连着塞人进去：memberCap - 1 个请求都成功（刚退会那个人留下的位置也补上了）', filled, '');
  const overflow = await request(base, 'POST', '/api/guild/join', {
    token: mintToken({ sub: 'douyin:smoke-overflow', iat: now, exp: now + 3600000, v: 1 }, SESSION_SECRET),
    name: '烟测兄弟会',
    playerName: '烟测挤不进'
  });
  check(
    '人满了回 409 guild_full',
    overflow.status === 409 && !!overflow.json && overflow.json.error === 'guild_full',
    JSON.stringify(overflow.json)
  );
  const fullView = await request(base, 'POST', '/api/guild/mine', { token: leaderToken });
  check(
    '人满之后成员表正好是 memberCap 行（一行不多）',
    !!fullView.json && !!fullView.json.guild && fullView.json.guild.members.length === guildRules.memberCap,
    String(fullView.json && fullView.json.guild && fullView.json.guild.members.length)
  );

  const guildNoIdentity = await request(base, 'POST', '/api/guild/create', { name: '没身份的会' });
  check(
    '建会必须带身份：既没令牌也没 openid 时回 400 missing_openid',
    guildNoIdentity.status === 400 && !!guildNoIdentity.json && guildNoIdentity.json.error === 'missing_openid',
    JSON.stringify(guildNoIdentity.json)
  );
  const guildBadToken = await request(base, 'POST', '/api/guild/mine', { token: 'not.a.token' });
  check(
    '坏令牌在公会端点上同样 401 bad_token（与存档同一道闸门）',
    guildBadToken.status === 401 && !!guildBadToken.json && guildBadToken.json.error === 'bad_token',
    JSON.stringify(guildBadToken.json)
  );
  const healthWithGuilds = await request(base, 'GET', '/api/health');
  check(
    '健康检查里能看到已建立的公会数（这次跑出来至少 2 个）',
    !!healthWithGuilds.json && typeof healthWithGuilds.json.guilds === 'number' && healthWithGuilds.json.guilds >= 2,
    'guilds=' + (healthWithGuilds.json && healthWithGuilds.json.guilds)
  );
  const guildNotFound = await request(base, 'POST', '/api/guild/nope', { token: leaderToken });
  check(
    '公会下的未知路由回 404（不把 /api/guild/* 整段放行成"什么都收"）',
    guildNotFound.status === 404 && !!guildNotFound.json && guildNotFound.json.error === 'not_found',
    JSON.stringify(guildNotFound.json)
  );
  const guildGetList = await request(base, 'GET', '/api/guild/list?limit=1&token=' + encodeURIComponent(leaderToken));
  check(
    'GET 也能拉公会列表（?limit=1 只回一条）',
    guildGetList.status === 200 && !!guildGetList.json && guildGetList.json.ok === true && guildGetList.json.guilds.length === 1,
    JSON.stringify(guildGetList.json && guildGetList.json.guilds.length)
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

    /*
     * 已知的口子（写在这里，不许它悄悄溜过去）：/api/name 目前**不**受 REQUIRE_TOKEN 约束 ——
     * 阶段 B 的客户端还没带令牌，昵称去重却要现在就能用，所以无令牌登记是允许的（verified:false）。
     * 等客户端把令牌接上，这里就该跟着 /api/save 一起收紧成 401，这条断言也要改。
     */
    const strictName = await request(strict.base, 'POST', '/api/name', { name: '严格实例昵称', account: 'dev-strict' });
    check(
      'REQUIRE_TOKEN=1 下 /api/name 仍接受无令牌登记（已知口子，阶段 B 收紧）',
      strictName.status === 200 && !!strictName.json && strictName.json.verified === false,
      JSON.stringify(strictName.json)
    );

    const strictGuild = await request(strict.base, 'POST', '/api/guild/mine', { openid: 'smoke-openid' });
    check(
      'REQUIRE_TOKEN=1 时公会端点同样 401 token_required（与存档同一道闸门，这里没有已知口子）',
      strictGuild.status === 401 && !!strictGuild.json && strictGuild.json.error === 'token_required',
      JSON.stringify(strictGuild.json)
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

    const bareGuild = await request(bare.base, 'POST', '/api/guild/create', {
      openid: 'smoke-bare',
      name: '裸实例公会',
      x: 300000,
      y: 300000,
      playerName: '裸实例会长',
      playerLevel: 12
    });
    check(
      '没配 AppID / 密钥的实例也能建公会（公会只需要身份，不需要 code2session）',
      bareGuild.status === 200 && !!bareGuild.json && bareGuild.json.ok === true && bareGuild.json.role === 'leader',
      JSON.stringify(bareGuild.json)
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




