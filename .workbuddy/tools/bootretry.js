/**
 * 反证：game.js 的重试启动会不会把「屏幕画布」弄丢。
 *
 * 背景（微信小游戏硬规则）：
 *   wx.createCanvas() **只有第一次调用**返回显示在屏幕上的画布，
 *   之后每一次调用返回的都是**离屏画布**。
 *
 * game.js 里有个 tryBoot 重试循环。只要失败点落在 createCanvas 之后
 * （getWindowInfo / new Game 抛错），不缓存 canvas 的话第二次就会
 * 拿到一块看不见的离屏画布 —— 游戏照常跑，但画面永远不更新，
 * 表现依然是「整个界面点不动」。
 *
 * 这个脚本用 vm 把真实 game.js 跑两遍：
 *   1) 当前版本            → 期望 createCanvas 只被调用 1 次
 *   2) 摘掉幂等缓存的反证版 → 期望 createCanvas 被调用 2 次、且第 2 次拿到离屏画布
 *
 * 输出：.workbuddy/tmp/_bootretry.txt
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const TMP = path.join(ROOT, '.workbuddy', 'tmp');
const OUT = path.join(TMP, '_bootretry.txt');
const SRC = path.join(ROOT, 'game.js');

const L = [];
let PASS = 0, FAIL = 0;
const log = (s) => L.push(s);
function ok(name, cond, extra) {
  if (cond) { PASS++; log('  ok   ' + name + (extra ? '   [' + extra + ']' : '')); }
  else { FAIL++; log('  FAIL ' + name + (extra ? '   [' + extra + ']' : '')); }
}

const W = 390, H = 844;

/**
 * 在一个受控沙箱里跑一遍 game.js。
 * - wx.createCanvas 返回带编号的画布：canvas#1 = 屏幕画布，canvas#2+ = 离屏画布
 * - 第一次 new Game() 故意抛错，模拟"失败点发生在 createCanvas 之后"
 */
function run(code) {
  const canvasCalls = [];
  let gameCalls = 0;
  let gameCanvas = null;

  function makeCanvas(tag) {
    const c = {
      __tag: tag,
      width: 0,
      height: 0,
      getContext() { return { __ctxOf: tag, fillRect() {} }; },
    };
    canvasCalls.push(c);
    return c;
  }
  function FakeGame(canvas) {
    gameCalls++;
    if (gameCalls === 1) {
      throw new Error('模拟：jsbridge 未就绪（失败点发生在 createCanvas 之后）');
    }
    gameCanvas = canvas;
  }

  const timers = [];
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; },
    require(p) {
      if (p === './src/game_core') return FakeGame;
      throw new Error('unexpected require: ' + p);
    },
    wx: {
      createCanvas() { return makeCanvas('canvas#' + (canvasCalls.length + 1)); },
      getWindowInfo() { return { screenWidth: W, screenHeight: H }; },
      getSystemInfoSync() { return { screenWidth: W, screenHeight: H }; },
    },
    Math, Date, JSON, Error, isFinite, Number, String, Object, Array,
  };
  sandbox.globalThis = sandbox;

  const ctx = vm.createContext(sandbox);
  let err = null;
  try { vm.runInContext(code, ctx, { filename: 'game.js' }); } catch (e) { err = e; }

  // 把排队中的 setTimeout 回调依次执行（最多 30 轮，防止写错时死循环）
  let guard = 0;
  while (timers.length && guard++ < 30) {
    const t = timers.shift();
    try { t.fn(); } catch (e) { err = err || e; }
  }

  return { canvasCalls, gameCalls, gameCanvas, err };
}

// ---------------------------------------------------------------------
log('=== 反证：重试启动时 wx.createCanvas 调用了几次 ===');
log('');

const code = fs.readFileSync(SRC, 'utf8');

// ① 当前版本
const now = run(code);
log('1) 当前 game.js（带幂等缓存）：');
log('   createCanvas 调用次数 = ' + now.canvasCalls.length +
  '（' + now.canvasCalls.map((c) => c.__tag).join(', ') + '）');
log('   实际 new Game 次数 = ' + now.gameCalls +
  '，第二次拿到的画布 = ' + (now.gameCanvas ? now.gameCanvas.__tag : '(无)'));
ok('当前版本：重试没有重新创建画布（createCanvas 只调 1 次）', now.canvasCalls.length === 1,
  '实际 ' + now.canvasCalls.length + ' 次');
ok('当前版本：第 2 次 new Game 拿到的仍是屏幕画布 canvas#1',
  !!now.gameCanvas && now.gameCanvas.__tag === 'canvas#1',
  now.gameCanvas ? now.gameCanvas.__tag : '(无)');
log('');

// ② 反证版：把幂等缓存摘掉，精确还原"每次重试都重新 createCanvas"的旧写法
const brokenCode = code.replace('if (!canvas) {', 'if (true) {');
const patched = brokenCode !== code;
log('2) 反证版（摘掉 if (!canvas) 缓存，等价于旧写法）：  补丁是否生效 = ' + patched);
if (patched) {
  const broken = run(brokenCode);
  log('   createCanvas 调用次数 = ' + broken.canvasCalls.length +
    '（' + broken.canvasCalls.map((c) => c.__tag).join(', ') + '）');
  log('   第 2 次 new Game 拿到的画布 = ' + (broken.gameCanvas ? broken.gameCanvas.__tag : '(无)'));
  ok('反证成立：没有幂等缓存时，重试会创建第 2 块画布', broken.canvasCalls.length === 2,
    '实际 ' + broken.canvasCalls.length + ' 次');
  ok('反证成立：第 2 次拿到的是**离屏画布** canvas#2（画面不会显示）',
    !!broken.gameCanvas && broken.gameCanvas.__tag === 'canvas#2',
    broken.gameCanvas ? broken.gameCanvas.__tag : '(无)');
} else {
  ok('反证版补丁生效（能在源码里定位到 if (!canvas)）', false, '没找到目标片段，反证未执行');
}

log('');
log('结论：miniprogram 的 wx.createCanvas() 只有首次返回屏幕画布；');
log('     重试启动必须复用同一块 canvas，否则重试成功后画在离屏画布上 ——');
log('     表现同样是「整个界面点不动」。');

log('');
log('============================================');
log(`  通过 ${PASS}   失败 ${FAIL}`);
log('============================================');

fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(OUT, L.join('\n') + '\n', 'utf8');
console.log(`bootretry: ${PASS} pass / ${FAIL} fail`);
