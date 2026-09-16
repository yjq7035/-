/**
 * 真机启动还原测试（entry3）
 *
 * 目标：复现并验证「真机卡在原生启动页」。
 *
 * 判据只有一条：
 *   原生启动页的消失条件 = **主屏 canvas 上画出第一帧**。
 *   所以跑完启动流程后，数一数主屏 canvas 上的绘制指令即可定案：
 *     0 条  → 真机表现就是"卡在原生启动页"
 *     >0 条 → 启动成功
 *
 * 被测变量：
 *   1~4. ctx.roundRect / ellipse / setLineDash 缺失（老基础库）
 *   5.    WAGamePerformanceUtilsSDK 竞态（**按时间**，复现真机中转态）
 *   6.    getContext 返回 null
 *   7.    性能桩**永久**损坏（sdkBroken）—— 真机「真机调试」实测环境，见下
 *
 * 关于场景 I（2026-09-16 新增，务必保留）：
 *   Android 真机 + 微信开发者工具「真机调试」下，基础库注入的
 *   WAGamePerformanceUtilsSDK 取不到纳秒计时对象，构造即 TypeError，
 *   同一条栈上的 wx.createCanvas() 每次必抛。
 *   这是**工具 Bug**（预览/体验版/正式版正常），证据：
 *     · 微信开放社区《相同代码在真机调试下报错,体验版和正式版正常》
 *     · GitHub wechat-miniprogram/minigame-tuanjie-transform-sdk#43
 *   这时**唯一正确的行为**是：不浪费画布槽位、不静默黑屏、把处置办法
 *   用原生 showModal 摆到屏幕上。场景 I 就是在钉死这三条。
 *
 * 用法：
 *   node .workbuddy/tools/entry3.js                 # 测根目录 game.js
 *   ENTRY=_entry_old.js node .workbuddy/tools/entry3.js   # 测对照版本
 *
 * 输出：.workbuddy/tmp/_entry3.txt
 */
'use strict';
const fs = require('fs');
const path = require('path');
const HH = require('./harness');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src');
const TMP = path.join(ROOT, '.workbuddy', 'tmp');
const OUT = path.join(TMP, '_entry3.txt');
const ENTRY_NAME = process.env.ENTRY || 'game.js';
const ENTRY = path.join(ROOT, ENTRY_NAME);
const L = [];
const log = (s) => L.push(s);
const head = (t) => { log(''); log('=== ' + t + ' ==='); };

const W = 390, H = 844;

function clearCache() {
  Object.keys(require.cache).forEach((k) => {
    if (k.indexOf(SRC) === 0 || k === ENTRY) delete require.cache[k];
  });
}

/**
 * 造环境 + 跑一次真实入口。
 * @param {object} opt
 *   strip           从 ctx 上摘掉的接口名数组
 *   canvasFailures  wx.createCanvas 前几次无条件抛错
 *   ctxNull         getContext 返回 null
 *   sdkRaceMs       虚拟时钟在该时刻之前：createCanvas 与 getPerformance 全部抛错
 *                   （还原 WAGamePerformanceUtilsSDK 注入竞态：jsbridge not ready）
 */
function runEntry(opt) {
  clearCache();

  const timerQ = [];
  const rafQ = [];
  let timerSeq = 0;
  let vclock = 0;                      // 虚拟时钟（ms）

  const realSetTimeout = global.setTimeout;
  global.setTimeout = function (cb, ms) { timerQ.push({ at: timerSeq++, ms: ms || 0, cb }); return timerSeq; };
  global.requestAnimationFrame = function (cb) { rafQ.push(cb); return rafQ.length; };
  global.cancelAnimationFrame = function () {};

  const raceMs = opt.sdkRaceMs || 0;
  function notReady() { return vclock < raceMs; }

  const st = {
    createCanvasCalls: 0,
    canvasCreated: [],
    mainHolder: null,
    offscreenHolder: null,
    getContextCalls: 0,
    firstCanvasAt: null,
    errors: [],
    logs: [],
    modals: [],
  };

  const origLog = console.log, origWarn = console.warn, origErr = console.error;
  console.log = (...a) => { st.logs.push(['log', a.join(' ')]); };
  console.warn = (...a) => { st.logs.push(['warn', a.join(' ')]); };
  console.error = (...a) => { st.errors.push(a.join(' ')); };

  global.wx = {
    getPerformance() {
      return {
        now() {
          if (notReady()) throw new Error('jsbridge not ready');
          return vclock * 1e6;
        },
      };
    },
    createCanvas() {
      st.createCanvasCalls++;
      // sdkBroken：还原真机「真机调试」实测环境 —— 性能桩永久损坏，
      // createCanvas 每次必抛，重试再多次也是同一个错。
      if (opt.sdkBroken) {
        throw new Error("TypeError: Cannot read properties of undefined (reading 'getSystemNanoTime')");
      }
      if (st.createCanvasCalls <= (opt.canvasFailures || 0)) {
        throw new Error('TypeError: wx.getSystemNanoTime is not a function');
      }
      if (notReady()) throw new Error('TypeError: wx.getSystemNanoTime is not a function');
      const isMain = st.createCanvasCalls === 1;
      if (isMain && st.firstCanvasAt === null) st.firstCanvasAt = vclock;
      const holder = { ops: [] };
      const canvas = {
        width: W, height: H, __main: isMain,
        getContext() {
          st.getContextCalls++;
          if (opt.ctxNull) return null;
          const c = HH.makeCtx(canvas, holder);
          for (const name of (opt.strip || [])) { try { delete c[name]; } catch (e) { c[name] = undefined; } }
          return c;
        },
      };
      st.canvasCreated.push(isMain ? 'main' : 'offscreen');
      if (isMain) st.mainHolder = holder; else st.offscreenHolder = holder;
      return canvas;
    },
    showModal(o) {
      st.modals.push(String((o && o.content) || ''));
      if (o && typeof o.success === 'function') o.success({ confirm: true });
    },
    getWindowInfo() {
      if (notReady()) throw new Error('jsbridge not ready');
      return { screenWidth: W, screenHeight: H, pixelRatio: 2 };
    },
    getSystemInfoSync() {
      if (notReady()) throw new Error('jsbridge not ready');
      return { screenWidth: W, screenHeight: H, pixelRatio: 2 };
    },
    onTouchStart: () => {}, onTouchMove: () => {}, onTouchEnd: () => {}, onTouchCancel: () => {},
    getStorageSync: () => '', setStorageSync: () => {}, removeStorageSync: () => {},
  };

  let loadErr = null;
  try { require(ENTRY); } catch (e) { loadErr = e; }

  // 泵定时器：虚拟时钟按各定时器的延迟推进
  let timerRuns = 0;
  while (timerQ.length && timerRuns < 200) {
    timerQ.sort((a, b) => a.at - b.at);
    const t = timerQ.shift();
    timerRuns++;
    vclock += t.ms;
    try { t.cb(); } catch (e) { st.errors.push('[timer] ' + e.message); }
  }

  let frames = 0;
  while (rafQ.length && frames < 5) {
    const q = rafQ.splice(0, rafQ.length);
    frames++;
    vclock += 16;
    for (const cb of q) { try { cb(); } catch (e) { st.errors.push('[raf] ' + e.message); } }
  }

  console.log = origLog; console.warn = origWarn; console.error = origErr;
  global.setTimeout = realSetTimeout;

  st.loadErr = loadErr;
  st.timerRuns = timerRuns;
  st.frames = frames;
  st.vclock = vclock;
  st.mainOps = st.mainHolder ? st.mainHolder.ops.length : 0;
  st.offscreenOps = st.offscreenHolder ? st.offscreenHolder.ops.length : 0;
  st.frameError = st.errors.find((e) => e.indexOf('帧异常') >= 0 || e.indexOf('[raf]') >= 0) || null;
  return st;
}

let PASS = 0, FAIL = 0;
function chk(cond, msg, actual) {
  if (cond) { PASS++; log('    ok   ' + msg + (actual !== undefined ? '   [' + actual + ']' : '')); }
  else { FAIL++; log('    ★FAIL ' + msg + (actual !== undefined ? '   [实际 ' + actual + ']' : '')); }
}

function report(name, opt, expect) {
  head(name);
  if (opt && opt._desc) log('  ' + opt._desc);
  let st;
  try { st = runEntry(opt || {}); } catch (e) { log('  ★ 测试本身异常: ' + e.stack); FAIL++; return; }
  log('  顶层加载             : ' + (st.loadErr ? '★ 抛异常 ' + st.loadErr.message : '正常'));
  log('  createCanvas 调用    : ' + st.createCanvasCalls + ' 次 → [' + st.canvasCreated.join(', ') + ']'
    + (st.firstCanvasAt !== null ? '   首次成功于 t=' + st.firstCanvasAt + 'ms' : ''));
  log('  getContext 调用      : ' + st.getContextCalls + ' 次');
  log('  定时器泵 / rAF 帧    : ' + st.timerRuns + ' / ' + st.frames);
  log('  ---- 判据 ----');
  log('  ★ 主屏 canvas 绘制指令 : ' + st.mainOps
    + (st.mainOps > 0 ? '   ✅ 首帧画出来了' : '   ❌ 一个像素都没画 → 卡在原生启动页'));
  log('    离屏 canvas 绘制指令 : ' + st.offscreenOps);
  const bootLogs = st.logs.filter((x) => x[1].indexOf('[boot]') >= 0).map((x) => x[1]);
  log('  boot 日志：');
  for (const b of bootLogs) log('    ' + b);
  if (st.frameError) log('  ★ 帧异常: ' + st.frameError.split('\n').slice(0, 3).join(' | '));
  const other = st.errors.filter((e) => e !== st.frameError).slice(0, 2);
  if (other.length) log('  其它错误: ' + other.join(' ;; ').split('\n')[0]);
  if (st.modals.length) {
    log('  ★ 弹给玩家的原生提示（showModal，不依赖画布）：');
    for (const m of st.modals) for (const line of m.split('\n')) log('      | ' + line);
  } else {
    log('  原生提示             : 无');
  }

  // ---- 断言 ----
  log('  ---- 断言 ----');
  chk(st.createCanvasCalls <= 1, 'wx.createCanvas() 调用次数 <= 1（第 2 次起是离屏画布）', st.createCanvasCalls + ' 次');
  if (expect === 'bootOk') {
    chk(st.mainOps > 0, '主屏 canvas 画出首帧', st.mainOps + ' 条指令');
    chk(st.canvasCreated[0] === 'main', '拿到的是屏幕画布（非离屏）', st.canvasCreated[0]);
    chk(st.loadErr === null, '顶层加载无异常');
    const claimedOk = bootLogs.some((b) => b.indexOf('启动成功') >= 0);
    chk(claimedOk === (st.mainOps > 0), '日志"启动成功"与"真的出画面"一致（不许假成功）',
      '声称=' + claimedOk + ' 实际出画=' + (st.mainOps > 0));
  } else if (expect === 'loudFail') {
    const claimedOk = bootLogs.some((b) => b.indexOf('✅ 启动成功') >= 0);
    chk(!claimedOk, '拿不到 ctx 时不许报"✅ 启动成功"', '声称成功=' + claimedOk);
    chk(st.errors.length > 0 || bootLogs.some((b) => b.indexOf('失败') >= 0), '必须留下明确错误日志');
  } else if (expect === 'loudFailEnv') {
    // 环境永久损坏（真机「真机调试」实测环境）：目标不是"救活"，而是
    // ① 绝不把画布槽位浪费掉 ② 绝不静默黑屏 ③ 把处置办法直接怼到屏幕上
    const claimedOk = bootLogs.some((b) => b.indexOf('✅ 启动成功') >= 0);
    chk(!claimedOk, '环境损坏时不许声称"✅ 启动成功"', '声称成功=' + claimedOk);
    chk(st.createCanvasCalls <= 1, '即使环境永久损坏，也绝不多调 createCanvas', st.createCanvasCalls + ' 次');
    chk(st.modals.length > 0, '必须用原生 showModal 把失败摆到屏幕上（不许静默黑屏）', st.modals.length + ' 条');
    const m = st.modals[0] || '';
    chk(m.indexOf('真机调试') >= 0, '弹窗要点名真凶「真机调试」，并给出可执行处置');
    chk(st.errors.length > 0, '必须留下明确错误日志', st.errors.length + ' 条');
    chk(st.offscreenOps === 0, '不许把画面画进离屏画布充数', st.offscreenOps + ' 条');
  }
  log('');
}

// =====================================================================
head('真机启动还原测试  ' + new Date().toISOString());
log('被测入口 : ' + ENTRY_NAME);
log('判据     : 主屏 canvas 是否出现绘制指令（0 = 卡启动页）'
  + ' + createCanvas 调用次数必须 <= 1');

report('A. 基线：现代 ctx', { _desc: '模拟器 / 新版基础库' }, 'bootOk');
report('B. 缺 roundRect', { strip: ['roundRect'], _desc: 'polyfill 应补齐' }, 'bootOk');
report('C. 缺 ellipse', { strip: ['ellipse'] }, 'bootOk');
report('D. 缺 setLineDash', { strip: ['setLineDash'] }, 'bootOk');
report('E. 3.14.0 全缺（roundRect+ellipse+setLineDash）', { strip: ['roundRect', 'ellipse', 'setLineDash'] }, 'bootOk');
report('F. SDK 竞态（按时间）：t<400ms 时 createCanvas/getPerformance 全抛错', {
  sdkRaceMs: 400,
  _desc: '真机可能的中转态：就绪探测应等到可用再取画布',
}, 'bootOk');
report('G. SDK 竞态更久：t<1200ms 才就绪', { sdkRaceMs: 1200 }, 'bootOk');
report('H. getContext 返回 null', { ctxNull: true }, 'loudFail');
report('I. 工具 Bug：性能桩永久损坏（getSystemNanoTime 常抛）', {
  sdkBroken: true,
  _desc: '★ 真机「真机调试」实测量到的环境：createCanvas 每次必抛，重试无意义',
}, 'loudFailEnv');

log('============================================');
log('  通过 ' + PASS + '   失败 ' + FAIL);
log('============================================');

fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(OUT, L.join('\n') + '\n', 'utf8');
console.log('entry3 done -> ' + OUT + '  PASS=' + PASS + ' FAIL=' + FAIL);
process.exit(FAIL === 0 ? 0 : 1);

