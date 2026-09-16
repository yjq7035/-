/**
 * 猴子测试：状态机尸检（专治"整个界面无法点击"）
 *
 * 三条不变量（违反任一 = 界面会点不动）：
 *   I1 孤儿拖拽态：一次手势结束后（手指已抬），dragging / pendingDrag 必须为 false。
 *      它们只在"手指按着"时有意义；悬空为 true → handleTouchStart 首行直接 return → 之后所有点击被吃。
 *   I2 死锁结算态：gameOver=true 时，必须满足 (lives<=0) 或 gameWon。
 *      因为 renderer.drawGameOver 的 showFail=lives<=0&&!showWin、showWin=gameWon，
 *      两者都 false 时它**提前 return 且不设置 gameOverButtons** —— 屏幕上没有结算界面，
 *      而 input.handleTouchStart 的 `if (game.gameOver)` 不看 scene/lives，无条件吞掉一切 → 永久死锁。
 *   I3 卡住的广告倒计时：watchingVideo=true 且 isRunning=true → loop() 会走 update() 分支，
 *      倒计时永不推进 → 永久停在 gameOverButtons={} 的"观看视频"态 → 死锁。
 *
 * 输出：.workbuddy/tmp/_monkey.txt
 */
'use strict';
const fs = require('fs');
const path = require('path');
const HH = require('./harness');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src');
const TMP = path.join(ROOT, '.workbuddy', 'tmp');
const OUT = path.join(TMP, '_monkey.txt');
const L = [];
function log(s) { L.push(s); }
function head(t) { log(''); log('=== ' + t + ' ==='); }

function clearCache() {
  Object.keys(require.cache).forEach((k) => {
    if (k.indexOf(SRC) === 0 || k === path.join(ROOT, 'game.js')) delete require.cache[k];
  });
}
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
  g.__holder = holder; g.__env = env;
  CUR = {};
  for (const m of ALL_MODULES) CUR[m] = require(path.join(SRC, m + '.js'));
  return g;
}
function frame(g) { g.__holder.ops = []; g.draw(); return g.__holder.ops; }

const cfg = require(path.join(SRC, 'config.js'));
const W = 390, H = 844;

function ts(g, x, y) { CUR.input.handleTouchStart(g, { touches: [{ clientX: x, clientY: y }] }); }
function tm(g, x, y) { CUR.input.handleTouchMove(g, { touches: [{ clientX: x, clientY: y }] }); }
function te(g, x, y) { CUR.input.handleTouchEnd(g, { changedTouches: [{ clientX: x, clientY: y }] }); }

// =====================================================================
// 场景仓库：覆盖所有"会吞触摸"的态
// =====================================================================
function newBattle() {
  const g = freshGame(W, H);
  g.startBattle();
  g.gold = 999999;
  const types = ['triangle', 'circle', 'trapezoid', 'long_rectangle', 'hexagon', 'sector'];
  for (let i = 0; i < types.length && i < g.slots.length; i++) {
    const tw = CUR.tower.createTower(types[i], g.slots[i].x, g.slots[i].y);
    g.slots[i].tower = tw; g.slots[i].occupied = true;
    g.towers.push(tw);
  }
  frame(g);
  return g;
}

function pointsOf(g) {
  const navL = CUR.nav.getNavLayout(g);
  const shopL = CUR.shop.getShopLayout(g);
  const menuR = CUR.gamemenu.getMenuButtonRect(g);
  const navAt = (id) => { const it = navL.items.filter((i) => i.id === id)[0]; return { x: it.x + it.w / 2, y: it.y + it.h / 2 }; };
  const pts = {
    slot0: { x: g.slots[0].x + g.slots[0].size / 2, y: g.slots[0].y + g.slots[0].size / 2 },
    slot2: { x: g.slots[2].x + g.slots[2].size / 2, y: g.slots[2].y + g.slots[2].size / 2 },
    slotEmpty: { x: g.slots[10].x + g.slots[10].size / 2, y: g.slots[10].y + g.slots[10].size / 2 },
    shopCard0: { x: shopL.cards[0].x + shopL.cards[0].w / 2, y: shopL.cards[0].y + shopL.cards[0].h / 2 },
    shopCard1: { x: shopL.cards[1].x + shopL.cards[1].w / 2, y: shopL.cards[1].y + shopL.cards[1].h / 2 },
    refresh: { x: shopL.refreshBtn.x + shopL.refreshBtn.w / 2, y: shopL.refreshBtn.y + shopL.refreshBtn.h / 2 },
    menuBtn: { x: menuR.x + menuR.w / 2, y: menuR.y + menuR.h / 2 },
    topbar: { x: 14, y: 8 },
    navCodex: navAt('codex'), navTalents: navAt('talents'), navBattle: navAt('battle'),
    navDisabled: navAt('nav1'),
    field: { x: W / 2, y: g.mapY + g.mapHeight / 2 },
    offTop: { x: W / 2, y: -40 }, offBottom: { x: W / 2, y: H + 40 },
    offLeft: { x: -40, y: 300 }, offRight: { x: W + 40, y: 300 },
  };
  if (g.showMenu) {
    const ML = CUR.gamemenu.getMenuLayout(g);
    pts.menuResume = { x: ML.resume.x + ML.resume.w / 2, y: ML.resume.y + ML.resume.h / 2 };
    pts.menuAbandon = { x: ML.abandon.x + ML.abandon.w / 2, y: ML.abandon.y + ML.abandon.h / 2 };
  }
  if (g.enhancePicker) {
    const EL = CUR.enhance.getEnhanceLayout(g);
    pts.pickerCard = { x: EL.cards[0].x + EL.cards[0].w / 2, y: EL.cards[0].y + EL.cards[0].h / 2 };
    pts.pickerBlank = { x: EL.panel.x + 8, y: EL.panel.y + 18 };
  }
  if (g.panelEnhanceBtn) {
    pts.enhanceBtn = { x: g.panelEnhanceBtn.x + g.panelEnhanceBtn.w / 2, y: g.panelEnhanceBtn.y + g.panelEnhanceBtn.h / 2 };
  }
  if (g.gameOverButtons && g.gameOverButtons.restart) {
    const b = g.gameOverButtons.restart;
    pts.overRestart = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  }
  if (g.gameOverButtons && g.gameOverButtons.watchContinue) {
    const b = g.gameOverButtons.watchContinue;
    pts.overWatch = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  }
  if (g.scene === 'battle' && !g.battleStarted) {
    const RL = CUR.levels.getReadyLayout(g);
    pts.startBtn = { x: RL.startBtn.x + RL.startBtn.w / 2, y: RL.startBtn.y + RL.startBtn.h / 2 };
    // 天梯上的一张可点/不可点台阶
    const card = RL.cards.filter((c) => c.y >= RL.viewport.y && c.y + c.h <= RL.viewport.y + RL.viewport.h)[0];
    if (card) pts.ladderCard = { x: card.x + card.w / 2, y: card.y + card.h / 2 };
  }
  return pts;
}

// =====================================================================
head('1. 猴子随机手势 + 逐次尸检（真实对局，含刷怪/战斗）');
{
  const orphan = [];      // I1
  const deadlock = [];    // I2
  const stuckAd = [];     // I3
  let gestures = 0, frames = 0, exceptions = 0;
  const rnd = (n) => Math.floor(Math.random() * n);
  const pick = (a) => a[rnd(a.length)];

  for (let round = 0; round < 40; round++) {
    let g;
    try {
      g = round % 3 === 0 ? newBattle() : freshGame(W, H);   // 有的从"战前选关"开始
      if (round % 3 !== 0) { g.startBattle(); g.gold = 999999; frame(g); }
    } catch (e) { exceptions++; continue; }

    for (let step = 0; step < 400; step++) {
      // 推进世界
      for (let k = 0; k < 3; k++) {
        try { if (g.isRunning && g.scene === 'battle' && g.battleStarted && !g.showMenu) g.update(1 / 30); frames++; }
        catch (e) { exceptions++; }
        try { frame(g); } catch (e) { exceptions++; break; }
      }
      // 随机手势
      let P;
      try { P = pointsOf(g); } catch (e) { exceptions++; continue; }
      const names = Object.keys(P);
      if (!names.length) continue;
      const a = P[pick(names)];
      const withDrag = Math.random() < 0.55;
      const b = withDrag ? P[pick(names)] : null;
      try {
        ts(g, a.x, a.y);
        if (b) {
          const segs = 1 + rnd(3);
          for (let s = 1; s <= segs; s++) tm(g, a.x + (b.x - a.x) * s / segs, a.y + (b.y - a.y) * s / segs);
          te(g, b.x, b.y);
        } else {
          te(g, a.x, a.y);
        }
        gestures++;
      } catch (e) { exceptions++; }

      // 尸检
      if (g.dragging || g.pendingDrag) {
        orphan.push(`round${round} step${step}: dragging=${g.dragging} pendingDrag=${g.pendingDrag} touchStartPos=${JSON.stringify(g.touchStartPos)} scene=${g.scene} step=${step}`);
      }
      if (g.gameOver && !g.gameWon && !(g.lives <= 0)) {
        deadlock.push(`round${round} step${step}: gameOver=true gameWon=false lives=${g.lives} 按钮=[${Object.keys(g.gameOverButtons || {}).join(',') || '空'}]`);
      }
      if (g.watchingVideo && g.isRunning) {
        stuckAd.push(`round${round} step${step}: watchingVideo=true 且 isRunning=true → 倒计时永不推进`);
      }
    }
  }

  log(`  随机手势 ${gestures} 次，推进 ${frames} 帧，渲染/更新异常 ${exceptions} 次`);
  log('');
  const summarize = (name, arr) => {
    log(`  【${name}】命中 ${arr.length} 次`);
    const seen = {};
    for (const s of arr) {
      const key = s.replace(/round\d+ /, '').replace(/step\d+:/, '');
      if (!seen[key]) seen[key] = 0;
      seen[key]++;
    }
    Object.keys(seen).slice(0, 10).forEach((k) => log(`      ×${seen[k]}  ${k}`));
  };
  summarize('I1 孤儿拖拽态（之后所有点击被首行 return 吃掉）', orphan);
  summarize('I2 死锁结算态（无结算界面 + 吞掉一切触摸）', deadlock);
  summarize('I3 广告倒计时卡死', stuckAd);
}

// =====================================================================
head('2. 定向复现：把 I1 / I2 / I3 逐条钉死');
{
  const tap = (g, x, y) => { ts(g, x, y); te(g, x, y); };

  // ---- I1：拖动松手在"输入层提前 return 的区域" ----
  log('  I1 拖放松手位置 vs 状态残留：');
  const base = newBattle();
  const P0 = pointsOf(base);
  for (const a of ['slot0', 'slot2', 'shopCard0', 'shopCard1']) {
    for (const b of ['topbar', 'menuBtn', 'offTop']) {
      const g = newBattle();
      const P = pointsOf(g);
      ts(g, P[a].x, P[a].y);
      tm(g, (P[a].x + P[b].x) / 2, (P[a].y + P[b].y) / 2);
      tm(g, P[b].x, P[b].y);
      te(g, P[b].x, P[b].y);
      const bad = g.dragging || g.pendingDrag;
      // 紧接着点导航，看会不会被吞掉
      const P2 = pointsOf(g);
      const before = g.scene;
      tap(g, P2.navCodex.x, P2.navCodex.y);
      log(`    「${a}」→「${b}」松手: dragging=${g.dragging} pendingDrag=${g.pendingDrag} | 紧接着点导航 scene=${before}→${g.scene} ${g.scene === 'codex' ? '（未受影响）' : '★ 这一次点击被吞掉了'}`);
      if (bad) void 0;
    }
  }

  // ---- I2：结算界面的三种态 ----
  log('');
  log('  I2 结算界面各态下的按钮与输入吞没情况：');
  const mkOver = (lives, won, video) => {
    const g = newBattle();
    g.lives = lives;
    g.gameOver = true; g.gameWon = won;
    if (video) { g.watchingVideo = true; g.isRunning = false; }
    frame(g);
    return g;
  };
  for (const [tag, lives, won, video] of [
    ['正常失败(lives=0)', 0, false, false],
    ['正常失败+观看视频', 0, false, true],
    ['正常胜利(lives>0)', 20, true, false],
  ]) {
    const g = mkOver(lives, won, video);
    const btns = Object.keys(g.gameOverButtons || {});
    const P = pointsOf(g);
    const before = g.scene;
    tap(g, P.navCodex.x, P.navCodex.y);
    log(`    ${tag}: 按钮=[${btns.join(',') || '空'}] 点导航 ${before}→${g.scene}`);
  }
  // 错配态（lives>0 + gameOver + 非胜利）
  {
    const g = mkOver(20, false, false);
    frame(g);
    const btns = Object.keys(g.gameOverButtons || {});
    const P = pointsOf(g);
    tap(g, P.navCodex.x, P.navCodex.y); tap(g, P.navTalents.x, P.navTalents.y); tap(g, P.navBattle.x, P.navBattle.y);
    log(`    ★ 错配态(lives=20,gameOver,非胜利): 按钮=[${btns.join(',') || '空'}]  连点三个导航后 scene=${g.scene}  ${g.scene === 'battle' ? '★ 完全无响应 = 永久死锁' : '能切'}`);
  }

  // ---- I3：广告复活链路 ----
  log('');
  log('  I3 「重新挑战（看广告复活）」链路：');
  {
    const g = newBattle();
    g.lives = 0;
    g.currentWave = 5;
    g.gameOver = true; g.gameWon = false;
    frame(g);
    const b = g.gameOverButtons.watchContinue;
    if (!b) { log('    ★ 失败态居然没有 watchContinue 按钮'); }
    else {
      tap(g, b.x + b.w / 2, b.y + b.h / 2);
      log(`    点「重新挑战」→ watchingVideo=${g.watchingVideo} isRunning=${g.isRunning} videoTimer=${g.videoTimer}`);
      // 推进 31 秒广告
      let t = 0, guard = 0;
      while (g.watchingVideo && guard++ < 5000) {
        // 复刻 loop() 的分支判定
        if (g.isRunning && g.scene === 'battle' && g.battleStarted && !g.showMenu) { g.update(1 / 30); }
        else if (g.watchingVideo) { g.videoTimer -= 1 / 30; if (g.videoTimer <= 0) g.onVideoComplete(); }
        t += 1 / 30;
        frame(g);
      }
      log(`    广告结束后（${t.toFixed(1)}s）: watchingVideo=${g.watchingVideo} isRunning=${g.isRunning} gameOver=${g.gameOver} gameWon=${g.gameWon} lives=${g.lives}`);
      // 再跑 2 秒，看会不会立刻又死
      for (let i = 0; i < 60; i++) { if (g.isRunning) g.update(1 / 30); }
      frame(g);
      log(`    复活后跑 2 秒: gameOver=${g.gameOver} lives=${g.lives} 按钮=[${Object.keys(g.gameOverButtons || {}).join(',') || '空'}]`);
      log(`    ${(g.gameOver && g.lives <= 0) ? '★ 复活无效：生命值没补，出广告立刻又死' : '复活正常'}`);
      const P = pointsOf(g);
      const before = g.scene;
      tap(g, P.navCodex.x, P.navCodex.y);
      log(`    复活链路收尾点导航 ${before}→${g.scene}`);
    }
  }
}

// =====================================================================
head('3. 定向复现：战前选关「开始游戏」被静默拒绝');
{
  const g = freshGame(W, H);
  const meta = CUR.meta;
  for (const lv of [1, 2, 5, 6, 99]) {
    meta.setSelectedLevel ? null : null;
    // 直接构造：存档里选中了第 lv 关
    const g2 = freshGame(W, H);
    g2.currentLevel = lv;
    const r = g2.startBattle();
    const P = pointsOf(g2);
    const st = P.startBtn;
    if (st) ts(g2, st.x, st.y), te(g2, st.x, st.y);
    log(`  currentLevel=${lv} → startBattle()=${r}  battleStarted=${g2.battleStarted}  点「开始游戏」后 toast=${g2.toast ? g2.toast.text : '无'}`);
  }
  void g;
}

log('');
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(OUT, L.join('\n') + '\n', 'utf8');
console.log('monkey done');
