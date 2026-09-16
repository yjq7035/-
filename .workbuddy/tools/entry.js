/**
 * 入口 + 活性探针（两件事）
 *
 * 起因：verify.js 从不加载 game.js —— 它直接 new Game(...)，所以入口的 boot/wx.ready 流程
 *       从来没被任何脚本跑过。而"整个界面无法点击"这类故障，最常见的两种成因就是：
 *         ① 入口没初始化（根本没绑定触摸事件 / 根本没建 canvas）
 *         ② 某个模态/拖放状态卡住，把 handleTouchStart 的首行 return 永久占住
 *
 * 本脚本：
 *   Part 1  用"贴近真机"的 wx mock 真实 require game.js，检查游戏是否真的活着、触摸回调是否真的注册了。
 *           分别模拟三种 wx.ready 形态（立即回调 / 永不回调 / 不存在）。
 *   Part 2  活性不变量穷举：对 [起点 × 移动 × 终点] 的所有手势组合，
 *           每个组合用全新一局游戏，施加手势后强制做一次"点导航能不能切页"的活性探测。
 *           切不动 = 该手势把 UI 锁死了（并给出精确复现步骤）。
 *
 * 输出：.workbuddy/tmp/_entry.txt
 */
'use strict';
const fs = require('fs');
const path = require('path');
const HH = require('./harness');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src');
const TMP = path.join(ROOT, '.workbuddy', 'tmp');
const OUT = path.join(TMP, '_entry.txt');

const L = [];
function log(s) { L.push(s); }
function head(t) { log(''); log('=== ' + t + ' ==='); }

function clearCache() {
  Object.keys(require.cache).forEach((k) => { if (k.indexOf(SRC) === 0) delete require.cache[k]; });
}

// =====================================================================
// Part 1. 真实入口 game.js
// =====================================================================
/**
 * 造一个贴近真机的 wx。
 * readyMode:
 *   'immediate' —— wx.ready 存在，注册即回调（已就绪时的真实行为）
 *   'never'     —— wx.ready 存在但永不回调（jsbridge 竞态的极端形态）
 *   'absent'    —— wx.ready 不存在（走 requestAnimationFrame 分支）
 */
function makeWx(W, H, readyMode) {
  const state = { mainCanvas: null, canvases: 0, listeners: {}, readyCalls: 0, storage: {} };
  const canvas = {
    width: 0, height: 0, __main: false,
    getContext() { return this.__ctx; },
  };
  function ready(cb) {
    state.readyCalls++;
    if (readyMode === 'immediate') cb();
    // 'never' → 什么都不做
  }
  const wx = {
    createCanvas() {
      state.canvases++;
      if (!state.mainCanvas) { state.mainCanvas = canvas; canvas.__main = true; }
      return canvas;
    },
    getWindowInfo: () => ({ screenWidth: W, screenHeight: H, pixelRatio: 2 }),
    getSystemInfoSync: () => ({ screenWidth: W, screenHeight: H, pixelRatio: 2 }),
    onTouchStart: (cb) => { state.listeners.start = cb; },
    onTouchMove: (cb) => { state.listeners.move = cb; },
    onTouchEnd: (cb) => { state.listeners.end = cb; },
    onTouchCancel: (cb) => { state.listeners.cancel = cb; },
    getStorageSync: (k) => (k in state.storage ? state.storage[k] : ''),
    setStorageSync: (k, v) => { state.storage[k] = v; },
    removeStorageSync: (k) => { delete state.storage[k]; },
  };
  if (readyMode !== 'absent') wx.ready = ready;
  return { wx, state, canvas };
}

function runEntry(W, H, readyMode) {
  clearCache();
  const { wx, state, canvas } = makeWx(W, H, readyMode);
  global.wx = wx;
  const holder = { ops: [] };
  const ctx = HH.makeCtx(canvas, holder);
  canvas.__ctx = ctx;
  const rafQueue = [];
  global.requestAnimationFrame = (cb) => { rafQueue.push(cb); return rafQueue.length; };
  global.cancelAnimationFrame = () => {};

  let err = null;
  try {
    require(path.join(ROOT, 'game.js'));
  } catch (e) {
    err = e.message + ' @ ' + (e.stack || '').split('\n')[1];
  }
  // game.js 里可能通过 requestAnimationFrame 延迟 boot
  let guard = 0;
  while (rafQueue.length && guard++ < 10) {
    const cb = rafQueue.shift();
    try { cb(); } catch (e) { err = err || (e.message + ' @ ' + (e.stack || '').split('\n')[1]); }
  }
  return {
    err,
    canvases: state.canvases,
    readyCalls: state.readyCalls,
    hasStart: typeof state.listeners.start === 'function',
    listeners: state.listeners,
    ops: holder.ops.length,
    holder,
    canvas,
    storage: state.storage,
  };
}

head('Part 1. 真实入口 game.js 加载（verify.js 完全没覆盖这一段）');
for (const mode of ['immediate', 'never', 'absent']) {
  const r = runEntry(390, 844, mode);
  log(`wx.ready 形态 = ${mode}`);
  log(`  加载异常      : ${r.err || '无'}`);
  log(`  createCanvas  : ${r.canvases} 次（真机只会创建 1 次主画布）`);
  log(`  ready 调用    : ${r.readyCalls} 次`);
  log(`  触摸回调注册  : start=${r.hasStart} move=${!!r.listeners.move} end=${!!r.listeners.end} cancel=${!!r.listeners.cancel}`);
  log(`  首帧绘制指令  : ${r.ops} 条`);
  if (r.hasStart) {
    // 真的派发一次触摸，看游戏有没有活
    const L_ = require(path.join(SRC, 'config.js')).LAYOUT;
    const x = 390 / 2, y = 844 - L_.navHeight / 2;
    const before = r.holder.ops;
    r.holder.ops = [];
    try {
      r.listeners.start({ touches: [{ clientX: x, clientY: y }] });
      r.listeners.end({ changedTouches: [{ clientX: x, clientY: y }] });
    } catch (e) { r.err = e.message; }
    log(`  派发触摸后重绘: ${r.holder.ops.length} 条指令  ${r.holder.ops.length > 0 ? '（渲染存活）' : '（★ 没有任何绘制 → 循环已死）'}`);
  }
  log('');
}

// =====================================================================
// Part 2. 活性不变量穷举
// =====================================================================
let CUR = {};
const ALL_MODULES = ['theme', 'config', 'meta', 'eventBus', 'units', 'geometry', 'enemy',
  'tower', 'wave', 'bonusStats', 'auraManager', 'renderer', 'input', 'shop', 'nav',
  'codex', 'talents', 'levels', 'gamemenu', 'enhance', 'game_core'];
function freshGame(W, H) {
  clearCache();
  const env = HH.setupGlobals(W, H);
  const holder = { ops: [] };
  const ctx = HH.makeCtx(env.canvas, holder);
  env.canvas.__ctx = ctx;
  const Game = require(path.join(SRC, 'game_core.js'));
  const g = new Game(env.canvas, ctx, { screenWidth: W, screenHeight: H });
  g.__holder = holder;
  g.__env = env;
  CUR = {};
  for (const m of ALL_MODULES) CUR[m] = require(path.join(SRC, m + '.js'));
  return g;
}
function frame(g) { g.__holder.ops = []; g.draw(); return g.__holder.ops; }

const cfg = require(path.join(SRC, 'config.js'));
const W = 390, H = 844;

head('Part 2. 活性探针：施加手势后，界面还能不能响应？');
{
  // ---- 备一局"标准战场"：已开战、有塔、有金币 ----
  function mkGame() {
    const g = freshGame(W, H);
    g.startBattle();
    g.gold = 99999;
    const types = ['triangle', 'circle', 'trapezoid', 'long_rectangle', 'hexagon', 'sector'];
    for (let i = 0; i < types.length && i < g.slots.length; i++) {
      const tw = CUR.tower.createTower(types[i], g.slots[i].x, g.slots[i].y);
      g.slots[i].tower = tw; g.slots[i].occupied = true;
      g.towers.push(tw);
    }
    for (let i = 0; i < 60; i++) g.update(1 / 30);
    frame(g);
    return g;
  }

  // ---- 关注点：每个点都有明确"语义" ----
  const base = mkGame();
  const navL = CUR.nav.getNavLayout(base);
  const shopL = CUR.shop.getShopLayout(base);
  const P = {
    slot0: { x: base.slots[0].x + base.slots[0].size / 2, y: base.slots[0].y + base.slots[0].size / 2 },
    slot3: { x: base.slots[3].x + base.slots[3].size / 2, y: base.slots[3].y + base.slots[3].size / 2 },
    shopCard: { x: shopL.cards[0].x + shopL.cards[0].w / 2, y: shopL.cards[0].y + shopL.cards[0].h / 2 },
    refresh: { x: shopL.refreshBtn.x + shopL.refreshBtn.w / 2, y: shopL.refreshBtn.y + shopL.refreshBtn.h / 2 },
    topbar: { x: 20, y: 8 },
    menuBtn: (() => { const r = CUR.gamemenu.getMenuButtonRect(base); return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; })(),
    navCodex: (() => { const it = navL.items.filter((i) => i.id === 'codex')[0]; return { x: it.x + it.w / 2, y: it.y + it.h / 2 }; })(),
    navTalents: (() => { const it = navL.items.filter((i) => i.id === 'talents')[0]; return { x: it.x + it.w / 2, y: it.y + it.h / 2 }; })(),
    field: { x: W / 2, y: base.mapY + base.mapHeight / 2 },
    aboveScreen: { x: W / 2, y: -30 },
    belowScreen: { x: W / 2, y: H + 30 },
    leftOut: { x: -30, y: base.mapY + 100 },
  };
  const names = Object.keys(P);

  const gesture = (g, a, b) => {
    const start = (x, y) => CUR.input.handleTouchStart(g, { touches: [{ clientX: x, clientY: y }] });
    const move = (x, y) => CUR.input.handleTouchMove(g, { touches: [{ clientX: x, clientY: y }] });
    const end = (x, y) => CUR.input.handleTouchEnd(g, { changedTouches: [{ clientX: x, clientY: y }] });
    start(a.x, a.y);
    if (b) {
      // 分两步移动，模拟真实拖动轨迹
      move((a.x + b.x) / 2, (a.y + b.y) / 2);
      move(b.x, b.y);
      end(b.x, b.y);
    } else {
      end(a.x, a.y);
    }
  };

  // ---- 活性探测：点导航「图签」，场景必须切过去 ----
  const alive = (g) => {
    const it = CUR.nav.getNavLayout(g).items.filter((i) => i.id === 'codex')[0];
    const c = { x: it.x + it.w / 2, y: it.y + it.h / 2 };
    CUR.input.handleTouchStart(g, { touches: [{ clientX: c.x, clientY: c.y }] });
    CUR.input.handleTouchEnd(g, { changedTouches: [{ clientX: c.x, clientY: c.y }] });
    return g.scene === 'codex';
  };

  const locks = [];
  let tested = 0;
  // 手势 A：单点按下 + 抬手（起点=终点）
  for (const n of names) {
    const g = mkGame();
    gesture(g, P[n], null);
    tested++;
    if (!alive(g)) locks.push(`单击「${n}」 @(${Math.round(P[n].x)},${Math.round(P[n].y)})  → 之后界面无响应`);
  }
  // 手势 B：从 A 按下，拖到 B 再抬起（覆盖"拖出去在别处松手"）
  for (const na of names) for (const nb of names) {
    if (na === nb) continue;
    const g = mkGame();
    gesture(g, P[na], P[nb]);
    tested++;
    if (!alive(g)) locks.push(`从「${na}」拖到「${nb}」松手  → 之后界面无响应`);
  }

  log(`  共测 ${tested} 种手势组合`);
  log(`  把 UI 锁死的组合：${locks.length} 个`);
  for (const s of locks) log('    ★ ' + s);

  // ---- 锁死后的状态诊断：到底是哪个门把点击吃掉了 ----
  if (locks.length) {
    const g = mkGame();
    gesture(g, P.slot0, P.topbar);
    log('');
    log('  诊断（以「从 slot0 拖到顶栏松手」为例）松手后的内部状态：');
    log(`    dragging=${g.dragging}  pendingDrag=${g.pendingDrag}  touchStartPos=${JSON.stringify(g.touchStartPos)}`);
    log(`    dragType=${g.dragType}  draggingFromSlot=${g.draggingFromSlot ? 'slot' : null}  dragFromShop=${g.dragFromShop}`);
    log(`    gameOver=${g.gameOver}  showMenu=${g.showMenu}  enhancePicker=${!!g.enhancePicker}  showPanel=${g.showPanel}`);
    log('    ↑ handleTouchStart 第 1 行 `if (game.dragging || game.pendingDrag) return;` 会把之后**所有**触摸吃掉');
  }
}

// =====================================================================
// Part 3. 悬空状态：触摸被系统吞掉（touchend 丢失）后会怎样
// =====================================================================
head('Part 3. touchend 丢失 / 多指手势 造成的悬空状态');
{
  const mk = () => { const g = freshGame(W, H); g.startBattle(); g.gold = 99999; const t = CUR.tower.createTower('triangle', g.slots[0].x, g.slots[0].y); g.slots[0].tower = t; g.slots[0].occupied = true; g.towers.push(t); frame(g); return g; };
  const tap = (g, x, y) => {
    CUR.input.handleTouchStart(g, { touches: [{ clientX: x, clientY: y }] });
    CUR.input.handleTouchEnd(g, { changedTouches: [{ clientX: x, clientY: y }] });
  };
  const navCodex = (g) => { const it = CUR.nav.getNavLayout(g).items.filter((i) => i.id === 'codex')[0]; return { x: it.x + it.w / 2, y: it.y + it.h / 2 }; };

  // ① 按下商店卡后，touchend 事件彻底丢失（系统级取消但回调没来）
  {
    const g = mk();
    const c = CUR.shop.getShopLayout(g).cards[0];
    CUR.input.handleTouchStart(g, { touches: [{ clientX: c.x + c.w / 2, clientY: c.y + c.h / 2 }] });
    // 这里故意不发 touchend / touchcancel
    const c2 = navCodex(g);
    tap(g, c2.x, c2.y);
    log(`  ① 按下商店卡后丢失 touchend → pendingDrag=${g.pendingDrag} touchStartPos=${JSON.stringify(g.touchStartPos)}  之后点导航：${g.scene === 'codex' ? '能切（已自愈）' : '★ 切不动，界面锁死'}  scene=${g.scene}`);
  }
  // ② 按下塔槽（pendingDrag）后丢失 touchend
  {
    const g = mk();
    const s = g.slots[0];
    CUR.input.handleTouchStart(g, { touches: [{ clientX: s.x + s.size / 2, clientY: s.y + s.size / 2 }] });
    const c2 = navCodex(g);
    tap(g, c2.x, c2.y);
    log(`  ② 按下塔槽后丢失 touchend → pendingDrag=${g.pendingDrag}  之后点导航：${g.scene === 'codex' ? '能切（已自愈）' : '★ 切不动，界面锁死'}  scene=${g.scene}`);
  }
  // ③ 拖拽中丢失 touchend（dragging=true 悬空）
  {
    const g = mk();
    const s = g.slots[0];
    CUR.input.handleTouchStart(g, { touches: [{ clientX: s.x + s.size / 2, clientY: s.y + s.size / 2 }] });
    CUR.input.handleTouchMove(g, { touches: [{ clientX: s.x + s.size / 2 + 60, clientY: s.y + s.size / 2 + 60 }] });
    // 故意不发 touchend
    const c2 = navCodex(g);
    tap(g, c2.x, c2.y);
    log(`  ③ 拖拽中丢失 touchend → dragging=${g.dragging} pendingDrag=${g.pendingDrag}  之后点导航：${g.scene === 'codex' ? '能切' : '★ 切不动，界面锁死'}  scene=${g.scene}`);
  }
  // ④ 双指：touchend 时 e.touches 仍有另一根手指 → getTouchPos 会取到"剩下的那根"
  {
    const g = mk();
    const slot = g.slots[0];
    const nav = navCodex(g);
    CUR.input.handleTouchStart(g, { touches: [{ clientX: slot.x + slot.size / 2, clientY: slot.y + slot.size / 2 }] });
    CUR.input.handleTouchEnd(g, {
      touches: [{ clientX: nav.x, clientY: nav.y }],
      changedTouches: [{ clientX: slot.x + slot.size / 2, clientY: slot.y + slot.size / 2 }],
    });
    log(`  ④ touchend 时 touches 里还留着另一根手指 → 松手位置被判成 (${Math.round(nav.x)},${Math.round(nav.y)}) 而不是真正的松手点`);
  }
}

log('');
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(OUT, L.join('\n') + '\n', 'utf8');
console.log('entry probe done');
