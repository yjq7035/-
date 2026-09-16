/**
 * 入口真实性测试：把 game.js 当真实微信小游戏跑一遍。
 *
 * 关键疑点：
 *  A) game.js 里出现**两次 wx.ready 注册**（顶层 wx.ready(boot)，boot() 内又 wx.ready(initGame)）。
 *     如果 wx.ready 存在且在"已就绪"时会立即回调，initGame() 会被跑两次。
 *  B) 微信规定：wx.createCanvas() **第一次返回主屏 canvas，之后返回离屏 canvas**。
 *     所以 initGame() 跑第二次 = 游戏画到看不见的离屏画布上。
 *  C) initEvents() 用 wx.onTouchStart 注册，**从不清除**（没有 offTouchStart）。
 *     每 new 一个 Game 就多一套全局触摸监听 → 一次触摸被多个实例同时处理。
 *
 * 输出：.workbuddy/tmp/_entry2.txt
 */
'use strict';
const fs = require('fs');
const path = require('path');
const HH = require('./harness');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src');
const TMP = path.join(ROOT, '.workbuddy', 'tmp');
const OUT = path.join(TMP, '_entry2.txt');
const L = [];
const log = (s) => L.push(s);
const head = (t) => { log(''); log('=== ' + t + ' ==='); };

/** 造一个"像真微信"的 wx：ready 可重复触发、createCanvas 区分主屏/离屏、onTouch* 累积 */
function realishWx(W, H) {
  const state = {
    canvasesCreated: 0,
    canvasIsOffscreen: [],
    readyCbs: [],
    readyFired: false,
    handlers: { start: [], move: [], end: [], cancel: [] },
  };
  const rafQueue = [];
  global.requestAnimationFrame = (cb) => { rafQueue.push(cb); return rafQueue.length; };
  global.cancelAnimationFrame = () => {};
  global.setTimeout = global.setTimeout || ((cb) => { cb(); return 0; });

  global.wx = {
    // 微信：第一次主屏，之后离屏
    createCanvas() {
      state.canvasesCreated++;
      const offscreen = state.canvasesCreated > 1;
      state.canvasIsOffscreen.push(offscreen);
      return {
        width: W, height: H,
        __offscreen: offscreen,
        __ctx: null,
        getContext() { return this.__ctx; },
      };
    },
    getWindowInfo: () => ({ screenWidth: W, screenHeight: H, pixelRatio: 2 }),
    getSystemInfoSync: () => ({ screenWidth: W, screenHeight: H, pixelRatio: 2 }),
    // 真实语义：已就绪 → 立即回调
    ready(cb) {
      state.readyCbs.push(cb);
      if (state.readyFired) { try { cb(); } catch (e) { state.readyErr = e; } }
      return undefined;
    },
    onTouchStart: (cb) => { state.handlers.start.push(cb); },
    onTouchMove: (cb) => { state.handlers.move.push(cb); },
    onTouchEnd: (cb) => { state.handlers.end.push(cb); },
    onTouchCancel: (cb) => { state.handlers.cancel.push(cb); },
    offTouchStart: () => {},
    createInnerAudioContext: () => ({ play() {}, stop() {}, destroy() {}, seek() {}, onEnded() {} }),
    vibrateShort: () => {},
    setKeepScreenOn: () => {},
    getStorageSync: () => '',
    setStorageSync: () => {},
    removeStorageSync: () => {},
  };
  state.rafQueue = rafQueue;
  state.fireReady = () => {
    state.readyFired = true;
    const cbs = state.readyCbs.slice();
    state.readyCbs.length = 0;
    for (const cb of cbs) { try { cb(); } catch (e) { state.readyErr = e; } }
  };
  state.pumpRaf = (n) => {
    for (let i = 0; i < n; i++) {
      const q = rafQueue.splice(0, rafQueue.length);
      for (const cb of q) { try { cb(); } catch (e) { state.rafErr = e; } }
    }
  };
  return state;
}

function clearCache() {
  Object.keys(require.cache).forEach((k) => {
    if (k.indexOf(SRC) === 0 || k === path.join(ROOT, 'game.js')) delete require.cache[k];
  });
}

const W = 390, H = 844;

// =====================================================================
head('A. 用"像真微信"的 wx 加载入口 game.js');
{
  clearCache();
  const st = realishWx(W, H);
  // 给 Canvas 装记录式 ctx
  const origCreate = wx.createCanvas;
  let lastCanvas = null;
  global.wx.createCanvas = function () {
    const c = origCreate.call(this);
    const holder = { ops: [] };
    c.__ctx = HH.makeCtx(c, holder);
    c.__holder = holder;
    lastCanvas = c;
    return c;
  };
  log(`  加载前: canvases=${st.canvasesCreated} readyCbs=${st.readyCbs.length} startHandlers=${st.handlers.start.length}`);

  let loadErr = null;
  try {
    require(path.join(ROOT, 'game.js'));
  } catch (e) {
    loadErr = e;
  }
  log(`  顶层加载: ${loadErr ? '★ 抛异常 ' + loadErr.message : '正常'}   canvases=${st.canvasesCreated}  startHandlers=${st.handlers.start.length}`);

  // 平台就绪
  st.fireReady();
  log(`  触发 ready 后: canvases=${st.canvasesCreated}  是否离屏=${JSON.stringify(st.canvasIsOffscreen)}  startHandlers=${st.handlers.start.length}  readyErr=${st.readyErr ? st.readyErr.message : '无'}`);

  // 再触发一次 ready（模拟第二次 ready 回调 / 热重载）
  st.fireReady();
  log(`  第二次 ready: canvases=${st.canvasesCreated}  是否离屏=${JSON.stringify(st.canvasIsOffscreen)}  startHandlers=${st.handlers.start.length}`);

  st.pumpRaf(3);
  log(`  跑 3 帧后: rafErr=${st.rafErr ? '★ ' + st.rafErr.message : '无'}`);

  log('');
  log(`  ★ 结论：initGame 执行了 ${st.canvasesCreated} 次；全局触摸监听累积 ${st.handlers.start.length} 套`);
  if (st.canvasesCreated > 1) {
    log(`  ★★ 第 2 次 wx.createCanvas() 在真微信里返回的是【离屏 canvas】（isOffscreen=${JSON.stringify(st.canvasIsOffscreen)}）`);
    log(`      → 多出来的 Game 实例画在看不见的画布上，却仍然接收并处理屏幕触摸`);
  }
  if (st.handlers.start.length > 1) {
    log(`  ★★ 一次触摸会被 ${st.handlers.start.length} 个 Game 实例各自处理一遍（onTouchStart 是累积注册，从没有 offTouchStart）`);
  }
}

// =====================================================================
head('B. 复现：两套监听器同时生效会怎样');
{
  clearCache();
  const st = realishWx(W, H);
  const origCreate = wx.createCanvas;
  global.wx.createCanvas = function () {
    const c = origCreate.call(this);
    const holder = { ops: [] };
    c.__ctx = HH.makeCtx(c, holder);
    c.__holder = holder;
    return c;
  };
  try { require(path.join(ROOT, 'game.js')); } catch (e) { /* noop */ }
  st.fireReady();
  st.pumpRaf(2);
  const n = st.handlers.start.length;
  log(`  当前 Game 实例数（= start 监听器数）= ${n}`);
  log(`  → 每次 tap 都会依次调用 ${n} 个 handleTouchStart；各实例状态互相独立。`);
  log(`  → 屏幕上看到的是"主屏 canvas"那一个实例的画面，而输入同时打在全部实例上。`);
  log(`     只要其中任一实例卡在模态（showMenu / enhancePicker / gameOver / 拖拽残留），`);
  log(`     它吞掉的不只是自己的状态，用户看到的那份画面也会因为状态分歧而"点不动"。`);
}

// =====================================================================
head('C. loop() 的健壮性：一帧抛异常会怎样');
{
  log('  game_core.loop() 结构：');
  log('    if (...) this.update(dt); else if (watchingVideo) {...}');
  log('    this.draw();');
  log('    requestAnimationFrame(() => this.loop());   ← 没有 try/catch 包住上面两步');
  log('  → update() 或 draw() 任一处抛异常，异常穿过 rAF 回调后');
  log('    line1491 的 requestAnimationFrame 永远不会执行 → 主循环彻底停摆。');
  log('  → 表现：画面停在出错那一帧，之后所有动画/按压反馈/波纹全部消失，');
  log('    用户看到的就是"整个界面点不动"。');
}

log('');
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(OUT, L.join('\n') + '\n', 'utf8');
console.log('entry2 done');
