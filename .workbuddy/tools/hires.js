/**
 * 高清渲染（画质）验证 —— hires
 *
 * 背景（2026-09-16）：预览扫码真机能玩，但画面糊。
 *   原因：画布按**逻辑像素**建（390×844 就这么大），手机屏有 2~3 倍物理像素，
 *        系统把小图拉伸铺满 → 每个像素放大 2~3 倍，字发虚、斜边锯齿。
 *   修复：canvas.width = 逻辑宽 × renderScale，game_core.applyViewScale() 每帧
 *        把 ctx 复位成 setTransform(scale,...)，布局仍按逻辑像素走。
 *
 * 本脚本钉死三件事（都是这次修复的**回归红线**）：
 *   ① 画布确实按物理像素建立，且倍率 = 被 MAX_RENDER_SCALE 夹住后的 DPR；
 *   ② **布局口径没变**：game.W/H 仍是逻辑像素，底部导航依旧落在屏幕内
 *      （要是有人把布局读回 canvas.width，这里立刻红：底栏会算到屏幕外）；
 *   ③ 变换**每帧复位**（不是启动时 scale 一次）—— 否则一帧 save/restore 不配对
 *      就会顺着帧累积越画越偏；同时"重试启动"不能把倍率翻倍（780 → 1560）。
 *
 * 用法：node .workbuddy/tools/hires.js
 * 输出：.workbuddy/tmp/_hires.txt
 */
'use strict';
const fs = require('fs');
const path = require('path');
const HH = require('./harness');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src');
const TMP = path.join(ROOT, '.workbuddy', 'tmp');
const OUT = path.join(TMP, '_hires.txt');
const ENTRY = path.join(ROOT, 'game.js');

const W = 390, H = 844;          // 逻辑视口（iPhone 12/13 口径）
const NAV = 56;                  // 底栏高度量级（只用来判断"在屏幕内"，不依赖 config）

const L = [];
const log = (s) => L.push(s);
const head = (t) => { log(''); log('=== ' + t + ' ==='); };

function clearCache() {
  Object.keys(require.cache).forEach((k) => {
    if (k.indexOf(SRC) === 0 || k === ENTRY) delete require.cache[k];
  });
}

/**
 * 把 src/game_core.js 的导出换成"间谍构造函数"，用来抓 Game 实例、
 * 以及按需让第 N 次构造抛错（还原"启动重试"路径）。
 */
function installGameSpy(throwOnFirst) {
  const key = require.resolve(path.join(SRC, 'game_core.js'));
  const real = require(key);
  const spy = { calls: 0, instances: [], real };
  function Spy() {
    spy.calls++;
    if (throwOnFirst && spy.calls === 1) throw new Error('模拟 Game 构造失败（测试注入）');
    const inst = new real(...arguments);
    spy.instances.push(inst);
    return inst;
  }
  Spy.prototype = real.prototype;
  require.cache[key].exports = Spy;
  return spy;
}

/**
 * 造环境 + 跑一次真实入口（game.js）。
 * @param {object} opt
 *   dpr           pixelRatio（默认 2）
 *   baseW/baseH   平台默认画布尺寸（默认 = 逻辑尺寸，即"画布按逻辑像素建"）
 *   throwOnFirst  第 1 次 new Game 抛错（测重试幂等）
 */
function runEntry(opt) {
  opt = opt || {};
  clearCache();
  const spy = installGameSpy(!!opt.throwOnFirst);

  const timerQ = [];
  const rafQ = [];
  let timerSeq = 0;
  let vclock = 0;
  const realSetTimeout = global.setTimeout;
  global.setTimeout = function (cb, ms) { timerQ.push({ at: timerSeq++, ms: ms || 0, cb }); return timerSeq; };
  global.requestAnimationFrame = function (cb) { rafQ.push(cb); return rafQ.length; };
  global.cancelAnimationFrame = function () {};

  const st = {
    createCanvasCalls: 0, ops: [], setTransform: [], errors: [], modals: [],
    frameErrors: 0,
  };

  const origLog = console.log, origWarn = console.warn, origErr = console.error;
  console.log = () => {}; console.warn = () => {}; console.error = (...a) => { st.errors.push(a.join(' ')); };

  let canvasObj = null;
  const holder = { ops: [] };

  global.wx = {
    createCanvas() {
      st.createCanvasCalls++;
      const isMain = st.createCanvasCalls === 1;
      const bW = (opt.baseW || W), bH = (opt.baseH || H);
      const c = {
        width: bW, height: bH, __main: isMain,
        getContext() {
          const ctx = HH.makeCtx(c, isMain ? holder : { ops: [] });
          // 只记录**主画布**的变换复位调用（这正是画质修复的落点）
          if (isMain) {
            const orig = ctx.setTransform;
            ctx.setTransform = function (a, b, cc, d, e, f) {
              st.setTransform.push([a, b, cc, d, e, f]);
              return orig.apply(this, arguments);
            };
          }
          return ctx;
        },
      };
      if (isMain) canvasObj = c;
      return c;
    },
    getWindowInfo: () => ({ screenWidth: W, screenHeight: H, pixelRatio: opt.dpr || 2 }),
    getSystemInfoSync: () => ({ screenWidth: W, screenHeight: H, pixelRatio: opt.dpr || 2 }),
    showModal(o) { st.modals.push(String((o && o.content) || '')); },
    onTouchStart: () => {}, onTouchMove: () => {}, onTouchEnd: () => {}, onTouchCancel: () => {},
    getStorageSync: () => '', setStorageSync: () => {}, removeStorageSync: () => {},
  };

  let loadErr = null;
  try { require(ENTRY); } catch (e) { loadErr = e; }

  let timerRuns = 0;
  while (timerQ.length && timerRuns < 200) {
    timerQ.sort((a, b) => a.at - b.at);
    const t = timerQ.shift();
    timerRuns++;
    vclock += t.ms;
    try { t.cb(); } catch (e) { st.errors.push('[timer] ' + e.message); }
  }

  let frames = 0;
  while (rafQ.length && frames < 4) {
    const q = rafQ.splice(0, rafQ.length);
    frames++;
    vclock += 16;
    for (const cb of q) { try { cb(); } catch (e) { st.frameErrors++; st.errors.push('[raf] ' + e.message); } }
  }

  console.log = origLog; console.warn = origWarn; console.error = origErr;
  global.setTimeout = realSetTimeout;

  st.loadErr = loadErr;
  st.frames = frames;
  st.canvas = canvasObj;
  st.game = spy.instances.length ? spy.instances[spy.instances.length - 1] : null;
  st.gameCalls = spy.calls;
  st.ops = holder.ops;
  return st;
}

let PASS = 0, FAIL = 0;
function chk(cond, msg, actual) {
  if (cond) { PASS++; log('    ok   ' + msg + (actual !== undefined ? '   [' + actual + ']' : '')); }
  else { FAIL++; log('    ★FAIL ' + msg + (actual !== undefined ? '   [实际 ' + actual + ']' : '')); }
}

function report(name, opt, body) {
  head(name);
  if (opt && opt._desc) log('  ' + opt._desc);
  let st;
  try { st = runEntry(opt || {}); } catch (e) { log('  ★ 测试本身异常: ' + e.stack); FAIL++; return; }
  log('  顶层加载        : ' + (st.loadErr ? '★ 抛异常 ' + st.loadErr.message : '正常'));
  log('  createCanvas    : ' + st.createCanvasCalls + ' 次 ｜ new Game ' + st.gameCalls + ' 次');
  log('  画布（物理像素）: ' + (st.canvas ? st.canvas.width + 'x' + st.canvas.height : '(无)'));
  log('  game.W/H        : ' + (st.game ? st.game.W + 'x' + st.game.H : '(无)') +
    '  ｜ renderScale = ' + (st.game ? st.game.renderScale : '-'));
  log('  变换复位调用    : ' + st.setTransform.length + ' 次' +
    (st.setTransform.length ? '  首个 = [' + st.setTransform[0].join(',') + ']' : ''));
  log('  主屏绘制指令    : ' + st.ops.length + ' 条 ｜ 帧数 ' + st.frames + ' ｜ 帧异常 ' + st.frameErrors);
  if (body) body(st);
}

// ---------------------------------------------------------------------------
// 场景
// ---------------------------------------------------------------------------
report('A 标准机（pixelRatio=2）— 画布应为 780x1688，布局仍按 390x844', {}, (st) => {
  chk(st.createCanvasCalls === 1, 'createCanvas 只调 1 次', st.createCanvasCalls);
  chk(!!st.game, 'Game 构造成功');
  if (!st.game) return;
  chk(st.game.W === W && st.game.H === H, 'game.W/H 仍是逻辑像素（布局口径未变）', st.game.W + 'x' + st.game.H);
  chk(st.game.renderScale === 2, 'renderScale = 2', st.game.renderScale);
  chk(st.canvas.width === W * 2 && st.canvas.height === H * 2, '画布 = 逻辑 × 2（物理像素）',
    st.canvas.width + 'x' + st.canvas.height);
  chk(st.setTransform.length >= st.frames && st.frames > 0,
    '每帧都复位一次变换（不是启动时 scale 一次）', st.setTransform.length + ' 次 / ' + st.frames + ' 帧');
  chk(st.setTransform.length > 0 && st.setTransform[0][0] === 2 && st.setTransform[0][3] === 2,
    '变换 = setTransform(2,0,0,2,0,0)', st.setTransform[0] && st.setTransform[0].join(','));
  chk(st.ops.length > 100, '首帧确实画出了东西', st.ops.length + ' 条');
  chk(st.frameErrors === 0, '无帧异常', st.frameErrors);

  // 布局口径红线：底栏必须落在**逻辑屏幕内**。
  // 如果有人把布局读回 canvas.width（780），导航会被算到 y≈780 下方 → 出屏幕。
  const nav = require(path.join(SRC, 'nav.js'));
  const L2 = nav.getNavLayout(st.game);
  const it = L2.items[0];
  chk(it && (it.y + it.h) <= H + 0.5, '底部导航落在逻辑屏幕内（没被物理像素顶出去）',
    it ? 'nav底 = ' + (it.y + it.h).toFixed(1) + ' / H = ' + H : '无');
  chk(it && it.y > H * 0.8, '底栏确实贴在屏幕底部', it ? 'y = ' + it.y.toFixed(1) : '无');
});

report('B 高分屏（pixelRatio=3）— 倍率被 MAX_RENDER_SCALE 夹住', { dpr: 3 }, (st) => {
  if (!st.game) { chk(false, 'Game 构造成功'); return; }
  chk(st.game.renderScale === 2, 'renderScale 夹到 2（画质/帧率旋钮）', st.game.renderScale);
  chk(st.canvas.width === W * 2, '画布 = 780（没有按 3 倍铺开）', st.canvas.width);
  chk(st.ops.length > 100, '首帧正常出画面', st.ops.length + ' 条');
});

report('C 老机器（pixelRatio=1）— 不放大，行为与修复前一致', { dpr: 1 }, (st) => {
  if (!st.game) { chk(false, 'Game 构造成功'); return; }
  chk(st.game.renderScale === 1, 'renderScale = 1', st.game.renderScale);
  chk(st.canvas.width === W && st.canvas.height === H, '画布 = 逻辑尺寸（不放大）',
    st.canvas.width + 'x' + st.canvas.height);
  chk(st.ops.length > 100, '首帧正常出画面', st.ops.length + ' 条');
});

report('D 启动重试 — 倍率绝不能翻倍（780 → 1560 就是这么来的）',
  { dpr: 2, throwOnFirst: true, _desc: '第 1 次 new Game 抛错 → 走重试分支（prepareWindowInfo 会重跑）' }, (st) => {
  chk(st.createCanvasCalls === 1, 'createCanvas 仍只调 1 次', st.createCanvasCalls);
  chk(st.gameCalls >= 2, '确实走了重试（构造 ≥2 次）', st.gameCalls);
  chk(!!st.game, '重试后构造成功');
  if (!st.game) return;
  chk(st.canvas.width === W * 2 && st.canvas.height === H * 2,
    '重试后画布仍是 780x1688（倍率没有累积）', st.canvas.width + 'x' + st.canvas.height);
  chk(st.game.renderScale === 2, 'renderScale 仍是 2', st.game.renderScale);
  chk(st.ops.length > 100, '重试后首帧仍出画面', st.ops.length + ' 条');
});

report('E 平台默认就给物理分辨率（base=1170x2532, dpr=3）— 尊重平台、不二次放大',
  { dpr: 3, baseW: W * 3, baseH: H * 3, _desc: '防呆分支：万一某基础库的主画布本来就是物理像素' }, (st) => {
  if (!st.game) { chk(false, 'Game 构造成功'); return; }
  chk(st.game.renderScale === 3, 'renderScale 取平台基准比值 3', st.game.renderScale);
  chk(st.canvas.width === W * 3 && st.canvas.height === H * 3,
    '画布尺寸维持平台默认（没有在上面再乘一次）', st.canvas.width + 'x' + st.canvas.height);
  chk(st.game.W === W, '布局仍是逻辑像素', st.game.W);
  chk(st.ops.length > 100, '首帧正常出画面', st.ops.length + ' 条');
});

// ---------------------------------------------------------------------------
// F 源码防回归：布局不许再读 canvas.width/height
// ---------------------------------------------------------------------------
head('F 源码扫描 — src/*.js 的布局代码不得再读 canvas.width/height');
{
  const bad = [];
  for (const f of fs.readdirSync(SRC)) {
    if (!/\.js$/.test(f)) continue;
    const lines = fs.readFileSync(path.join(SRC, f), 'utf8').split('\n');
    lines.forEach((l, i) => {
      const t = l.trim();
      if (t.indexOf('//') === 0 || t.indexOf('*') === 0 || t.indexOf('/*') === 0) return; // 注释不算
      if (/(^|[^.\w])(?:game|this)?\.?canvas\.(width|height)\b/.test(l)) bad.push('src/' + f + ':' + (i + 1) + '  ' + t);
    });
  }
  chk(bad.length === 0, 'src/ 下无 canvas.width/height 布局读取（画布现在是物理像素）', bad.length + ' 处');
  bad.forEach((b) => log('        · ' + b));
  const g = fs.readFileSync(path.join(SRC, 'game_core.js'), 'utf8');
  chk(g.indexOf('applyViewScale') >= 0, 'game_core 里存在 applyViewScale（每帧复位变换的入口）');
  chk(g.indexOf('this.W = w') >= 0 && g.indexOf('this.H = h') >= 0, 'game_core 暴露逻辑视口 game.W/H');
}

// ---------------------------------------------------------------------------
const summary = 'hires: PASS=' + PASS + ' FAIL=' + FAIL + '  |  ' + new Date().toISOString();
log('');
log('=== ' + summary + ' ===');
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(OUT, L.join('\n'), 'utf8');
console.log(summary);
console.log('report -> ' + OUT);
process.exit(FAIL ? 1 : 0);
