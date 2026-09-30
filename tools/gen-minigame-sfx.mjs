/**
 * gen-minigame-sfx.mjs —— 生成小游戏的音效与 BGM（纯 WAV，零第三方素材）
 *
 * 为什么自己合成而不是下载素材：
 *   1. 这个工程的硬约束是"不引入任何外部素材"（01-game-design §12：贴图与图集都排在阶段 E），
 *      声音同理 —— 来源说不清的文件不该进包；
 *   2. 合成是**确定性**的：同一个脚本跑出来的字节完全一样，所以仓库里的 .wav 是可复现的产物，
 *      而不是"从某个网站下下来的神秘文件"，也方便随时改参数重生成。
 *
 * 产物（写进 douyin-minigame\audio\，由 12-platform.js 的 PLAT.sfx / PLAT.bgm 播放）：
 *   hit / crit / kill / hurt / levelup / chest / ui / camp / cast / mend (+ bgm)
 * 规格：16bit 单声道。音效 22050Hz（几 KB ~ 二十几 KB），BGM 11025Hz 8 秒循环（约 176KB）。
 *   主包预算 4MB，这点体积可以忽略；真嫌大就调 BGM_SECONDS。
 *
 * 用法（本机没有独立 node，用抖音开发者工具自带的 Electron 当 node）：
 *   powershell -ExecutionPolicy Bypass -File tools\minigame-node.ps1 tools\gen-minigame-sfx.mjs
 * 重新生成是幂等的：参数没改 → 写出来的字节完全相同。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'douyin-minigame', 'audio');

const SFX_RATE = 22050;
const BGM_RATE = 11025;
const BGM_SECONDS = 8;

/* -------------------------------------------------------------- 合成小工具 */

/** 确定性噪声（自带 LCG，不用 Math.random：重跑必须字节一致） */
let seed = 0x9e3779b1;
function noise() {
  seed = (Math.imul(seed ^ (seed >>> 15), 0x2545f491) + 1) >>> 0;
  return (seed / 4294967296) * 2 - 1;
}

function buffer(seconds, rate) {
  return new Float32Array(Math.max(1, Math.ceil(seconds * rate)));
}

/** 波形取值（phase 是 0..1 的累计相位） */
function wave(shape, phase) {
  if (shape === 'square') return phase < 0.5 ? 1 : -1;
  if (shape === 'saw') return phase * 2 - 1;
  if (shape === 'tri') return phase < 0.5 ? phase * 4 - 1 : 3 - phase * 4;
  if (shape === 'noise') return noise();
  return Math.sin(phase * Math.PI * 2);
}

/**
 * 往缓冲里叠一个音：从 start 时刻起 dur 秒，频率从 freq0 线性滑到 freq1（不滑就传同一个值），
 * 音量走"起音 → 衰减"包络（默认起音 5ms，避免开头"啪"一声爆音）。
 */
function addTone(buf, rate, start, dur, freq0, freq1, amp, shape, attack, release) {
  const from = Math.max(0, Math.floor(start * rate));
  const to = Math.min(buf.length, Math.floor((start + dur) * rate));
  const atk = Math.max(1, Math.floor((attack === undefined ? 0.005 : attack) * rate));
  const rel = Math.max(1, Math.floor((release === undefined ? dur * 0.9 : release) * rate));
  let phase = 0;
  for (let i = from; i < to; i += 1) {
    const played = i - from;
    const span = to - from || 1;
    const freq = freq0 + (freq1 - freq0) * (played / span);
    phase += freq / rate;
    let envelope = 1;
    if (played < atk) envelope = played / atk;
    const after = played - atk;
    if (after > 0) envelope *= Math.max(0, 1 - after / rel);
    buf[i] += wave(shape, phase % 1) * amp * envelope;
  }
}

/** 归一化 + 极简软削波（多个音叠在一起也不能爆） */
function finish(buf) {
  let peak = 0;
  for (let i = 0; i < buf.length; i += 1) peak = Math.max(peak, Math.abs(buf[i]));
  const gain = peak > 0 ? 0.95 / peak : 1;
  for (let i = 0; i < buf.length; i += 1) buf[i] = Math.tanh(buf[i] * gain * 1.2) * 0.92;
  return buf;
}

/** Float 采样 → 16bit PCM WAV 字节 */
function toWav(samples, rate) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    data.writeInt16LE(Math.round(clamped * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/* -------------------------------------------------------------- 每个声音 */

/** 音效表：键名就是代码里 PLAT.sfx('xxx') 用的名字 */
const SOUNDS = {
  /** 普通命中：一记短促的"啪" + 一点低频"咚" */
  hit: (rate) => {
    const buf = buffer(0.14, rate);
    addTone(buf, rate, 0, 0.05, 0, 0, 0.5, 'noise', 0.001, 0.04);
    addTone(buf, rate, 0, 0.12, 220, 120, 0.6, 'sine', 0.002, 0.11);
    return finish(buf);
  },
  /** 暴击：金属感的双音 + 亮噪声，要明显"比普通命中更爽" */
  crit: (rate) => {
    const buf = buffer(0.3, rate);
    addTone(buf, rate, 0, 0.06, 0, 0, 0.45, 'noise', 0.001, 0.05);
    addTone(buf, rate, 0, 0.28, 1320, 1180, 0.4, 'tri', 0.002, 0.27);
    addTone(buf, rate, 0.05, 0.25, 880, 760, 0.35, 'tri', 0.002, 0.23);
    addTone(buf, rate, 0, 0.2, 330, 220, 0.3, 'sine', 0.002, 0.18);
    return finish(buf);
  },
  /** 击杀：向下滑的短音（"清掉了"的收束感） */
  kill: (rate) => {
    const buf = buffer(0.42, rate);
    addTone(buf, rate, 0, 0.4, 520, 130, 0.5, 'saw', 0.004, 0.38);
    addTone(buf, rate, 0, 0.3, 0, 0, 0.25, 'noise', 0.001, 0.25);
    return finish(buf);
  },
  /** 玩家受伤：低闷的一记（不需要好听，需要"疼"） */
  hurt: (rate) => {
    const buf = buffer(0.26, rate);
    addTone(buf, rate, 0, 0.24, 150, 90, 0.55, 'square', 0.002, 0.22);
    addTone(buf, rate, 0, 0.12, 0, 0, 0.3, 'noise', 0.001, 0.1);
    return finish(buf);
  },
  /** 升级：上行琶音（C5-E5-G5-C6） */
  levelup: (rate) => {
    const buf = buffer(0.7, rate);
    const notes = [523, 659, 784, 1046];
    for (let i = 0; i < notes.length; i += 1) {
      addTone(buf, rate, i * 0.09, 0.3, notes[i], notes[i], 0.42, 'sine', 0.006, 0.28);
      addTone(buf, rate, i * 0.09, 0.3, notes[i] * 2, notes[i] * 2, 0.12, 'tri', 0.006, 0.28);
    }
    return finish(buf);
  },
  /** 开箱：铃铛味的双音 */
  chest: (rate) => {
    const buf = buffer(0.55, rate);
    addTone(buf, rate, 0, 0.5, 1046, 1046, 0.35, 'sine', 0.003, 0.48);
    addTone(buf, rate, 0.02, 0.48, 1568, 1568, 0.22, 'sine', 0.003, 0.46);
    addTone(buf, rate, 0, 0.06, 0, 0, 0.2, 'noise', 0.001, 0.05);
    return finish(buf);
  },
  /** UI 点击：极短的一下（拖动 / 滚动不播，只有真的点中才播） */
  ui: (rate) => {
    const buf = buffer(0.07, rate);
    addTone(buf, rate, 0, 0.06, 1000, 900, 0.4, 'tri', 0.001, 0.055);
    return finish(buf);
  },
  /** 营地：回血 / 传送的暖场音（两个协和音） */
  camp: (rate) => {
    const buf = buffer(0.6, rate);
    addTone(buf, rate, 0, 0.55, 392, 392, 0.36, 'sine', 0.02, 0.52);
    addTone(buf, rate, 0.12, 0.45, 523, 523, 0.3, 'sine', 0.02, 0.42);
    return finish(buf);
  },
  /** 技能（A5）：上行的短促扫频 —— "放技能"要一听就和普通出手不一样 */
  cast: (rate) => {
    const buf = buffer(0.42, rate);
    addTone(buf, rate, 0, 0.36, 320, 1180, 0.42, 'saw', 0.003, 0.32);
    addTone(buf, rate, 0.02, 0.28, 160, 520, 0.22, 'square', 0.004, 0.26);
    addTone(buf, rate, 0, 0.1, 0, 0, 0.16, 'noise', 0.001, 0.09);
    return finish(buf);
  },
  /** 治疗（A5）：温和的三度上行（比"升级"短，别把 BGM 的戏抢了） */
  mend: (rate) => {
    const buf = buffer(0.5, rate);
    addTone(buf, rate, 0, 0.46, 523, 523, 0.34, 'sine', 0.02, 0.42);
    addTone(buf, rate, 0.1, 0.36, 659, 659, 0.26, 'sine', 0.02, 0.34);
    return finish(buf);
  }
};

/**
 * BGM：8 秒循环的 A 小调稀疏琶音 + 低音持续音。
 * 为什么这么简单：竖屏挂机游戏里 BGM 只负责"别太安静"，太复杂反而吵；
 * 8 秒短循环 + 低音量（balance.audio.bgmVolume）就够，体积也只有 176KB。
 */
function bgm(rate) {
  const buf = buffer(BGM_SECONDS, rate);
  const bass = [110, 87.31, 130.81, 98]; // A2 F2 C3 G2
  const steps = [0, 3, 7, 12, 7, 3, 5, 8]; // A 小调里挑出来的音级（半音）
  for (let i = 0; i < steps.length; i += 1) {
    const start = i * (BGM_SECONDS / steps.length);
    const freq = 220 * Math.pow(2, steps[i] / 12);
    addTone(buf, rate, start, 1.6, freq, freq, 0.22, 'tri', 0.15, 1.4);
    addTone(buf, rate, start, 1.6, freq * 2, freq * 2, 0.08, 'sine', 0.2, 1.3);
  }
  for (let i = 0; i < bass.length; i += 1) {
    const span = BGM_SECONDS / bass.length;
    addTone(buf, rate, i * span, span, bass[i], bass[i], 0.18, 'sine', 0.25, 1.6);
  }
  // 首尾各 30ms 淡入淡出：循环接缝处不会"咔"一下
  const fade = Math.floor(rate * 0.03);
  for (let i = 0; i < fade; i += 1) {
    buf[i] *= i / fade;
    buf[buf.length - 1 - i] *= i / fade;
  }
  return finish(buf);
}

/* -------------------------------------------------------------- 写文件 */

fs.mkdirSync(outDir, { recursive: true });
const written = [];
const names = Object.keys(SOUNDS);
for (let i = 0; i < names.length; i += 1) {
  const bytes = toWav(SOUNDS[names[i]](SFX_RATE), SFX_RATE);
  fs.writeFileSync(path.join(outDir, names[i] + '.wav'), bytes);
  written.push({ name: names[i] + '.wav', kb: Math.round(bytes.length / 1024) });
}
const bgmBytes = toWav(bgm(BGM_RATE), BGM_RATE);
fs.writeFileSync(path.join(outDir, 'bgm.wav'), bgmBytes);
written.push({ name: 'bgm.wav', kb: Math.round(bgmBytes.length / 1024) });

let total = 0;
console.log('wrote ' + written.length + ' wav files into ' + outDir);
for (const item of written) {
  total += item.kb;
  console.log('  ' + String(item.kb).padStart(4) + ' KB  ' + item.name);
}
console.log('  ---- total ' + total + ' KB (main package budget is 4 MB)');
