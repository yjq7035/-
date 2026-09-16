/**
 * UI 可点性回归（专治"整个界面点不动"）
 *
 * 把本轮的修复固化成断言，任何一个退回去都要立刻变红：
 *   U1 拖拽途中游戏结束 → 松手后拖放态必须归零，且结算按钮必须点得动
 *   U2 逃生通道不变式：任何"会吞触摸"的状态，都必须存在一个能恢复响应的点
 *   U3 复活必须真的补生命（onVideoComplete 后 lives>0 且 gameOver=false）
 *   U4 「开始游戏」在"存档关卡不可玩"时也必须真的开打（不能静默失败）
 *   U5 结算态自洽：gameOver ⇒ (gameWon || lives<=0)
 *   U6 老基础库（ctx 无 roundRect）也必须画得出来、点得动
 *   U7 结算判据三层一致：渲染层画了什么 ⇔ 输入层吞了什么（= game.isSettlementActive()）
 *
 * 输出：.workbuddy/tmp/_regress.txt   （通过 N / 失败 M）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const HH = require('./harness');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src');
const TMP = path.join(ROOT, '.workbuddy', 'tmp');
const OUT = path.join(TMP, '_regress.txt');
const L = [];
let PASS = 0, FAIL = 0;
const log = (s) => L.push(s);
function ok(name, cond, extra) {
  if (cond) { PASS++; log('  ok   ' + name + (extra ? '   [' + extra + ']' : '')); }
  else { FAIL++; log('  FAIL ' + name + (extra ? '   [' + extra + ']' : '')); }
}
const head = (t) => { log(''); log('=== ' + t + ' ==='); };

function clearCache() {
  Object.keys(require.cache).forEach((k) => {
    if (k.indexOf(SRC) === 0 || k === path.join(ROOT, 'game.js')) delete require.cache[k];
  });
}
const ALL = ['theme', 'config', 'meta', 'eventBus', 'units', 'geometry', 'enemy', 'tower',
  'wave', 'bonusStats', 'auraManager', 'renderer', 'input', 'shop', 'nav', 'codex',
  'talents', 'levels', 'gamemenu', 'enhance', 'game_core'];
let CUR = {};
function freshGame(W, H) {
  clearCache();
  const env = HH.setupGlobals(W, H);
  const holder = { ops: [] };
  const ctx = HH.makeCtx(env.canvas, holder);
  env.canvas.__ctx = ctx;
  const Game = require(path.join(SRC, 'game_core.js'));
  const g = new Game(env.canvas, ctx, { screenWidth: W, screenHeight: H });
  g.__holder = holder;
  CUR = {};
  for (const m of ALL) CUR[m] = require(path.join(SRC, m + '.js'));
  return g;
}
function frame(g) { g.__holder.ops = []; g.draw(); }
const W = 390, H = 844;
const ts = (g, x, y) => CUR.input.handleTouchStart(g, { touches: [{ clientX: x, clientY: y }] });
const tm = (g, x, y) => CUR.input.handleTouchMove(g, { touches: [{ clientX: x, clientY: y }] });
const te = (g, x, y) => CUR.input.handleTouchEnd(g, { changedTouches: [{ clientX: x, clientY: y }] });
const tap = (g, x, y) => { ts(g, x, y); te(g, x, y); };

function battle() {
  const g = freshGame(W, H);
  g.startBattle();
  g.gold = 999999;
  const types = ['triangle', 'circle', 'trapezoid', 'long_rectangle', 'hexagon', 'sector'];
  for (let i = 0; i < types.length && i < g.slots.length; i++) {
    const tw = CUR.tower.createTower(types[i], g.slots[i].x, g.slots[i].y);
    g.slots[i].tower = tw; g.slots[i].occupied = true; g.towers.push(tw);
  }
  frame(g);
  return g;
}
function navPt(g, id) {
  const L2 = CUR.nav.getNavLayout(g);
  const it = L2.items.filter((i) => i.id === id)[0];
  return { x: it.x + it.w / 2, y: it.y + it.h / 2 };
}
/** 真实地把生命扣到 0 并让 update 判负（模拟拖拽途中打输） */
function endGameMidDrag(g) {
  g.lives = 1;
  g.isRunning = true;
  g.applyPenaltyByEnemyType({ type: 'normal' });
  g.update(1 / 30);
}

// =====================================================================
head('U1 拖拽途中游戏结束 → 松手后拖放态归零 + 结算按钮可点');
{
  const cases = [
    ['从放置槽拖', (g) => { const s = g.slots[0]; return { x: s.x + s.size / 2, y: s.y + s.size / 2 }; }],
    ['从商店卡拖', (g) => { const c = CUR.shop.getShopLayout(g).cards[0]; return { x: c.x + c.w / 2, y: c.y + c.h / 2 }; }],
  ];
  for (const [tag, pick] of cases) {
    const g = battle();
    const p = pick(g);
    ts(g, p.x, p.y);
    tm(g, p.x - 60, p.y - 60);
    ok(`U1a ${tag}：touchmove 后进入拖拽`, g.dragging === true, `dragging=${g.dragging}`);
    endGameMidDrag(g);
    ok(`U1b ${tag}：拖拽中成功判负`, g.gameOver === true, `gameOver=${g.gameOver} lives=${g.lives}`);
    te(g, p.x - 60, p.y - 60);
    ok(`U1c ${tag}：松手后拖放态归零`, !g.dragging && !g.pendingDrag,
      `dragging=${g.dragging} pendingDrag=${g.pendingDrag} touchStartPos=${JSON.stringify(g.touchStartPos)}`);

    frame(g);
    const b = g.gameOverButtons && g.gameOverButtons.restart;
    ok(`U1d ${tag}：结算界面给出了重新开始按钮`, !!b, b ? 'rect ok' : '缺失');
    if (b) {
      tap(g, b.x + b.w / 2, b.y + b.h / 2);
      ok(`U1e ${tag}：点「重新开始」真的有反应`, g.gameOver === false && !g.dragging,
        `gameOver=${g.gameOver}`);
    }
  }
}

// =====================================================================
head('U2 逃生通道不变式：每个"吞触摸态"都必须点得动');
{
  const builds = {
    '游戏菜单开着': () => { const g = battle(); g.openMenu(); frame(g); return g; },
    '属性面板开着': () => { const g = battle(); tap(g, g.slots[0].x + 18, g.slots[0].y + 18); frame(g); return g; },
    '结算-失败': () => { const g = battle(); g.lives = 0; g.gameOver = true; g.isRunning = false; frame(g); return g; },
    '结算-胜利': () => { const g = battle(); g.gameOver = true; g.gameWon = true; frame(g); return g; },
    '强拖拽残留(旧死锁态)': () => {
      const g = battle();
      g.pendingDrag = true; g.dragging = true; g.touchStartPos = { x: 100, y: 100 };
      frame(g); return g;
    },
    '残留:pendingDrag 丢了起点': () => {
      const g = battle();
      g.pendingDrag = true; g.dragging = false; g.touchStartPos = null;
      frame(g); return g;
    },
    '残留:dragging 无 pendingDrag': () => {
      const g = battle();
      g.pendingDrag = false; g.dragging = true; g.touchStartPos = { x: 100, y: 100 };
      frame(g); return g;
    },
  };
  for (const [name, build] of Object.entries(builds)) {
    const g = build();
    // 逃生判定：连点若干"合理的目标"，只要任意一次让 state 发生可观测变化就算活的
    const snap = () => JSON.stringify([g.scene, g.showMenu, g.showPanel, !!g.enhancePicker,
      g.gameOver, g.watchingVideo, g.dragging, g.pendingDrag, g.isRunning,
      g.btnPress ? g.btnPress.id : null, Object.keys(g.gameOverButtons || {}).join(',')]);
    const probes = [];
    const nc = navPt(g, 'codex'), nb = navPt(g, 'battle'), nt = navPt(g, 'talents');
    probes.push(['导航:codex', nc.x, nc.y], ['导航:talents', nt.x, nt.y], ['导航:battle', nb.x, nb.y]);
    probes.push(['战场空地', W / 2, g.mapY + g.mapHeight / 2]);
    probes.push(['顶栏☰', CUR.gamemenu.getMenuButtonRect(g).x + 10, 14]);
    if (g.gameOverButtons && g.gameOverButtons.restart) {
      const b = g.gameOverButtons.restart;
      probes.push(['结算:重新开始', b.x + b.w / 2, b.y + b.h / 2]);
    }
    if (g.showMenu) {
      const m = CUR.gamemenu.getMenuLayout(g);
      probes.push(['菜单:返回战斗', m.resume.x + m.resume.w / 2, m.resume.y + m.resume.h / 2]);
    }

    let escaped = false, how = '';
    for (const [pname, x, y] of probes) {
      const before = snap();
      tap(g, x, y); frame(g);
      if (snap() !== before) { escaped = true; how = pname; break; }
      // 有些状态需要"点两次"（第一次解锁手势/收模态，第二次才生效）
      tap(g, x, y); frame(g);
      if (snap() !== before) { escaped = true; how = pname + '(连点两次)'; break; }
    }
    ok(`U2 ${name} 存在逃生口`, escaped, escaped ? '逃生点=' + how : '★ 所有可点目标都无响应');
  }
}

// =====================================================================
head('U3 看广告复活必须真的补活');
{
  const g = battle();
  g.lives = 0;
  g.currentWave = 5;
  g.gameOver = true; g.gameWon = false;
  frame(g);
  const b = g.gameOverButtons && g.gameOverButtons.watchContinue;
  ok('U3a 失败态给出「重新挑战」按钮', !!b);
  if (b) {
    tap(g, b.x + b.w / 2, b.y + b.h / 2);
    ok('U3b 点了之后进入观看视频态', g.watchingVideo === true, `watchingVideo=${g.watchingVideo}`);
    let guard = 0;
    while (g.watchingVideo && guard++ < 5000) {
      if (g.isRunning && g.scene === 'battle' && g.battleStarted && !g.showMenu) g.update(1 / 30);
      else if (g.watchingVideo) { g.videoTimer -= 1 / 30; if (g.videoTimer <= 0) g.onVideoComplete(); }
      frame(g);
    }
    ok('U3c 广告结束后复活：生命被补回', g.lives > 0, `lives=${g.lives}`);
    ok('U3d 广告结束后复活：不再立即判负', g.gameOver === false, `gameOver=${g.gameOver} gameWon=${g.gameWon}`);
    for (let i = 0; i < 60; i++) { if (g.isRunning) g.update(1 / 30); }
    frame(g);
    ok('U3e 复活后能继续打（2 秒内没有立刻又死）', g.gameOver === false, `gameOver=${g.gameOver} lives=${g.lives}`);
  }
}

// =====================================================================
head('U4 「开始游戏」不能被静默拒绝');
{
  for (const lv of [1, 2, 5, 99]) {
    const g = freshGame(W, H);
    g.currentLevel = lv;
    frame(g);
    const r = CUR.levels.getReadyLayout(g);
    const sb = r.startBtn;
    tap(g, sb.x + sb.w / 2, sb.y + sb.h / 2);
    frame(g);
    ok(`U4 存档关卡=${lv} 点「开始游戏」真的开打`,
      g.battleStarted === true && g.gameOver === false,
      `startBattle→battleStarted=${g.battleStarted} currentLevel=${g.currentLevel}`);
  }
}

// =====================================================================
head('U5 结算态自洽（gameOver ⇒ gameWon 或 lives<=0）');
{
  let bad = 0, checked = 0;
  const rnd = (n) => Math.floor(Math.random() * n);
  const pick = (a) => a[rnd(a.length)];
  for (let round = 0; round < 25; round++) {
    const g = battle();
    for (let step = 0; step < 250; step++) {
      for (let k = 0; k < 3; k++) {
        try { if (g.isRunning && g.scene === 'battle' && g.battleStarted && !g.showMenu) g.update(1 / 30); } catch (e) { void e; }
        try { frame(g); } catch (e) { void e; }
      }
      const pts = [
        [g.slots[0].x + 18, g.slots[0].y + 18],
        [CUR.shop.getShopLayout(g).cards[0].x + 40, CUR.shop.getShopLayout(g).cards[0].y + 30],
        [navPt(g, 'codex').x, navPt(g, 'codex').y],
        [navPt(g, 'talents').x, navPt(g, 'talents').y],
        [14, 8],
        [W / 2, g.mapY + g.mapHeight / 2],
      ];
      const a = pick(pts), b2 = pick(pts);
      try {
        ts(g, a[0], a[1]);
        tm(g, (a[0] + b2[0]) / 2, (a[1] + b2[1]) / 2);
        te(g, b2[0], b2[1]);
      } catch (e) { void e; }
      try { frame(g); } catch (e) { void e; }
      checked++;
      if (g.gameOver && !g.gameWon && g.lives > 0) bad++;
    }
  }
  ok(`U5 扫了 ${checked} 个状态，没有出现"gameOver 但既没赢也没死"`, bad === 0, `违例 ${bad} 次`);
}

// =====================================================================
head('U6 老基础库（ctx 没有 roundRect）也必须画得出来、点得动');
{
  // 造一个"缺 roundRect"的 ctx（模拟低版本微信基础库，如 3.14.x），
  // 再走一遍真实的 new Game 流程 —— 断言构造时自动补齐、且各场景渲染不抛异常。
  clearCache();
  const env = HH.setupGlobals(W, H);
  const holder = { ops: [] };
  const ctx = HH.makeCtx(env.canvas, holder);
  delete ctx.roundRect;                       // ← 关键：假装基础库没有这个方法
  ok('U6a 前置：ctx 上确实没有 roundRect', typeof ctx.roundRect !== 'function');
  env.canvas.__ctx = ctx;
  const Game = require(path.join(SRC, 'game_core.js'));
  const g = new Game(env.canvas, ctx, { screenWidth: W, screenHeight: H });
  g.__holder = holder;
  CUR = {};
  for (const m of ALL) CUR[m] = require(path.join(SRC, m + '.js'));

  ok('U6b 构造后 roundRect 已被补齐', typeof ctx.roundRect === 'function');

  let err = null;
  try {
    g.startBattle();
    g.gold = 999999;
    const types = ['triangle', 'circle', 'trapezoid', 'long_rectangle', 'hexagon', 'sector'];
    for (let i = 0; i < types.length && i < g.slots.length; i++) {
      const tw = CUR.tower.createTower(types[i], g.slots[i].x, g.slots[i].y);
      g.slots[i].tower = tw; g.slots[i].occupied = true; g.towers.push(tw);
    }
    for (let i = 0; i < 5; i++) { g.update(1 / 30); frame(g); }
    g.openMenu(); frame(g); g.closeMenu(); frame(g);
    tap(g, g.slots[0].x + 18, g.slots[0].y + 18); frame(g);   // 属性面板
    g.scene = 'codex'; frame(g);
    g.scene = 'talents'; frame(g);
    g.scene = 'battle';
    g.lives = 0; g.gameOver = true; frame(g);                // 结算界面
  } catch (e) { err = e; }
  ok('U6c 全场景渲染不抛异常（旧基础库首帧炸的就是这里）', !err,
    err ? (err.message || String(err)) : '无异常');

  frame(g);
  const b = g.gameOverButtons && g.gameOverButtons.restart;
  ok('U6d 结算界面照常给出按钮', !!b);
  if (b) {
    tap(g, b.x + b.w / 2, b.y + b.h / 2); frame(g);
    ok('U6e 结算按钮照常点得动', g.gameOver === false, `gameOver=${g.gameOver}`);
  }
}

// =====================================================================
head('U7 结算判据三层一致：渲染层"画了什么" ⇔ 输入层"吞了什么"');
{
  // 渲染层 renderer.render → drawGameOver 的生效前提是：
  //   scene==='battle' && gameOver && (gameWon || lives<=0)
  // 输入层（吞触摸）必须问同一件事，即 game.isSettlementActive()。
  // 只要输入层用的条件比渲染层宽，就会出现"屏幕上什么都不画、点击却被吃光"的错配态。
  //
  // 侦探方法：drawGameOver 只有在**通过前置判断之后**才会写 game.gameOverButtons，
  // 所以把 gameOverButtons 清成 null 再画一帧 → 非 null 就说明它真的画了。
  let checked = 0, mismatch = 0, deadlock = 0, leak = 0;
  const bad = [];
  for (const scene of ['battle', 'codex', 'talents']) {
    for (const gameOver of [false, true]) {
      for (const gameWon of [false, true]) {
        for (const lives of [0, 20]) {
          const g = battle();
          g.scene = scene;
          g.gameOver = gameOver;
          g.gameWon = gameWon;
          g.lives = lives;
          g.watchingVideo = false;

          // ① 渲染层真的画了吗
          g.gameOverButtons = null;
          frame(g);
          const painted = !!g.gameOverButtons;
          // ② 输入层用的判据
          const active = g.isSettlementActive();
          checked++;
          if (painted !== active) {
            mismatch++;
            bad.push(`scene=${scene} over=${gameOver} won=${gameWon} lives=${lives} 画了=${painted} 吞了=${active}`);
          }

          // ③ 错配态（gameOver 但未胜且 lives>0）必须还能逃生：点导航要能切场景
          if (scene === 'battle' && gameOver && !gameWon && lives > 0) {
            const p = navPt(g, 'codex');
            tap(g, p.x, p.y); frame(g);
            if (g.scene === 'battle') deadlock++;
          }

          // ④ 真结算态必须继续挡住导航（不能因为放宽判据而漏给底栏）
          if (scene === 'battle' && active) {
            const p = navPt(g, 'codex');
            tap(g, p.x, p.y); frame(g);
            if (g.scene !== 'battle') leak++;
          }
        }
      }
    }
  }
  ok(`U7a 扫了 ${checked} 个状态："渲染层画了" 与 "输入层吞了" 完全等价`, mismatch === 0,
    mismatch ? mismatch + ' 处错配：' + bad.join(' | ') : '完全等价');
  ok('U7b 错配态下点导航仍能切场景（不再是永久死锁）', deadlock === 0,
    deadlock ? deadlock + ' 个状态完全无响应' : '全部可逃生');
  ok('U7c 真结算态仍然挡得住底部导航（没被放宽判据漏掉）', leak === 0,
    leak ? leak + ' 个状态漏点' : '全部被挡住');
}

log('');
log('============================================');
log(`  通过 ${PASS}   失败 ${FAIL}`);
log('============================================');
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(OUT, L.join('\n') + '\n', 'utf8');
console.log(`regress-ui: ${PASS} pass / ${FAIL} fail`);
