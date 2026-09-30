/**
 * minigame-selftest.mjs —— 在 node 里跑小游戏 bundle 的自检（`tools\minigame-now.cmd` 的第 4 步）
 *
 * 它为什么能存在（这是决策 #7 里"不做 web 端就失去 harness"的补丁）：
 *   因为逻辑层（`douyin-minigame\src\02~11`）不许出现 `tt.` / document / canvas，
 *   所以把 game.js 丢进一个**没有 tt、没有 canvas 的裸 node** 里也照样能加载、
 *   照样能跑完 18-selftest.js 的全部断言。渲染与手感仍然只能靠 IDE 模拟器 + 真机，
 *   但"最容易错、也最值得断言"的那部分（地图确定性、伤害结算、掉箱、装备、升级曲线）
 *   从此是本机一条命令的事。
 *
 * 本机怎么跑（这台开发机没有独立 node，用抖音开发者工具自带的 Electron 当 node）：
 *   powershell -ExecutionPolicy Bypass -File tools\minigame-now.cmd
 * 命令行等价写法：
 *   $env:ELECTRON_RUN_AS_NODE=1
 *   & 'd:\myproject\@bytedminiprogram-ide\抖音开发者工具.exe' tools\minigame-selftest.mjs
 *
 * 退出码：0 = 全绿；1 = 有断言失败；2 = 连自检模块都没加载起来（通常是 bundle 语法错误）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const bundlePath = path.join(root, 'douyin-minigame', 'game.js');

if (!fs.existsSync(bundlePath)) {
  console.log(`FAIL 找不到 ${bundlePath}（先跑 tools\\build-minigame.ps1）`);
  process.exit(2);
}

const code = fs.readFileSync(bundlePath, 'utf8');

/**
 * 关键：只注入 console / 一个**故意为 undefined 的 tt** / setTimeout。
 * `tt` 以参数形式存在，所以 bundle 里 `typeof tt === 'undefined'` 的判断是安全的，
 * 而任何"直接调 tt.xxx"的代码都会当场炸出来 —— 这正是红线的验收方式。
 */
let G;
try {
  G = new Function('console', 'tt', 'setTimeout', code + '\n; return G;')(console, undefined, setTimeout);
} catch (error) {
  console.log('FAIL bundle 加载失败（语法错误或顶层就碰了平台 API）：');
  console.log('     ' + (error && error.stack ? error.stack.split('\n').slice(0, 4).join('\n     ') : error));
  process.exit(2);
}

if (!G || !G.SELFTEST || typeof G.SELFTEST.runAll !== 'function') {
  console.log('FAIL bundle 里没有 G.SELFTEST.runAll()（18-selftest.js 没被拼进去？）');
  process.exit(2);
}

const result = G.SELFTEST.runAll();
for (const line of result.lines) console.log(line);

console.log('');
console.log(`世界指纹 = ${result.fingerprint}（基准 e9802f11，与 src 侧的 TypeScript 实现必须一致）`);

let totalChecks = result.checks;
let totalFailures = result.failures;

// 冒烟：用一个"假 canvas 上下文"跑 boot + 1800 步 + 31 帧，验的是流程（防白屏）
if (typeof G.SELFTEST.runSmoke === 'function') {
  const smoke = G.SELFTEST.runSmoke();
  console.log('');
  for (const line of smoke.lines) console.log(line);
  totalChecks += smoke.checks;
  totalFailures += smoke.failures;
}

if (totalFailures === 0) {
  console.log('');
  console.log(`PASS  ${totalChecks}/${totalChecks} 项通过（含冒烟）`);
  // ASCII-only summary line: tools\minigame-now.cmd greps this because the Douyin devtools
  // console is a GBK console where Chinese text comes back as mojibake.
  console.log(`RESULT PASS ${totalChecks}/${totalChecks} checks`);
  process.exit(0);
}
console.log('');
console.log(`FAIL  ${totalChecks - totalFailures}/${totalChecks} 项通过，${totalFailures} 项失败`);
console.log(`RESULT FAIL ${totalChecks - totalFailures}/${totalChecks} checks`);
process.exit(1);
