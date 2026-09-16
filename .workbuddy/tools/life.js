/**
 * 状态不变量穷举（针对"整个界面无法点击"）
 *
 * 两条不变量：
 *   A. 状态洁净度：任何一次完整手势（touchstart → [move] → touchend）结束后，
 *      dragging / pendingDrag / touchStartPos 必须全部归零。
 *      只要 dragging 或 pendingDrag 悬空为 true，handleTouchStart 首行就直接 return，
 *      **之后所有触摸都被吃掉** —— 这就是"界面点不动"的最短路径。
 *   B. 可达性：每个"会吞触摸"的模态态（gameOver / showMenu / enhancePicker / showPanel）
 *      必须有一个真实可点的逃生口；否则就是死锁。
 *
 * 输出：.workbuddy/tmp/_life.txt
 */
'use strict';
const fs = require('fs');
const path = require('path');
const HH = require('./harness');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src');
const TMP = path.join(ROOT, '.workbuddy', 'tmp');
const OUT = path.join(TMP, '_life.txt');
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
const input = () => CUR.input;

// 手势原语
function ts(g, x, y) { input().handleTouchStart(g, { touches: [{ clientX: x, clientY: y }] }); }
function tm(g, x, y) { input().handleTouchMove(g, { touches: [{ clientX: x, clientY: y }] }); }
function te(g, x, y) { input().handleTouchEnd(g, { changedTouches: [{ clientX: x, clientY: y }] }); }
function tap(g, x, y) { ts(g, x, y); te(g, x, y); }

function mkBattle() {
  const g = freshGame(W, H);
  g.startBattle();
  g.gold = 99999;
  const types = ['triangle', 'circle', 'trapezoid', 'long_rectangle', 'hexagon', 'sector'];
  for (let i = 0; i < types.length && i < g.slots.length; i++) {
    const tw = CUR.tower.createTower(types[i], g.slots[i].x, g.slots[i].y);
    g.slots[i].tower = tw; g.slots[i].occupied = true;
    g.towers.push(tw);
  }
  for (let i = 0; i < 30; i++) g.update(1 / 30);
  frame(g);
  return g;
}
function pointsOf(g) {
  const navL = CUR.nav.getNavLayout(g);
  const shopL = CUR.shop.getShopLayout(g);
  const menuR = CUR.gamemenu.getMenuButtonRect(g);
  const navAt = (id) => { const it = navL.items.filter((i) => i.id === id)[0]; return { x: it.x + it.w / 2, y: it.y + it.h / 2 }; };
  return {
    slot0: { x: g.slots[0].x + g.slots[0].size / 2, y: g.slots[0].y + g.slots[0].size / 2 },
    slot3: { x: g.slots[3].x + g.slots[3].size / 2, y: g.slots[3].y + g.slots[3].size / 2 },
    slotEmpty: { x: g.slots[8].x + g.slots[8].size / 2, y: g.slots[8].y + g.slots[8].size / 2 },
    shopCard: { x: shopL.cards[0].x + shopL.cards[0].w / 2, y: shopL.cards[0].y + shopL.cards[0].h / 2 },
    refresh: { x: shopL.refreshBtn.x + shopL.refreshBtn.w / 2, y: shopL.refreshBtn.y + shopL.refreshBtn.h / 2 },
    menuBtn: { x: menuR.x + menuR.w / 2, y: menuR.y + menuR.h / 2 },
    topbarLeft: { x: 14, y: 8 },
    navCodex: navAt('codex'),
    navTalents: navAt('talents'),
    navBattle: navAt('battle'),
    navDisabled: navAt('nav1'),
    field: { x: W / 2, y: g.mapY + g.mapHeight / 2 },
    aboveScreen: { x: W / 2, y: -30 },
    belowScreen: { x: W / 2, y: H + 30 },
    leftOut: { x: -30, y: 300 },
  };
}

// =====================================================================
head('不变量 A：任何手势结束后，拖放状态必须归零');
{
  const g0 = mkBattle();
  const P = pointsOf(g0);
  const names = Object.keys(P);
  const violations = [];
  let n = 0;
  for (const a of names) {
    // A1 纯点击
    {
      const g = mkBattle();
      tap(g, P[a].x, P[a].y);
      n++;
      if (g.dragging || g.pendingDrag || g.touchStartPos) {
        violations.push({
          gesture: `点击「${a}」`,
          state: `dragging=${g.dragging} pendingDrag=${g.pendingDrag} touchStartPos=${JSON.stringify(g.touchStartPos)}`,
          g: g,
        });
      }
    }
    // A2 按住后拖到每个点再松手
    for (const b of names) {
      if (a === b) continue;
      const g = mkBattle();
      ts(g, P[a].x, P[a].y);
      tm(g, (P[a].x + P[b].x) / 2, (P[a].y + P[b].y) / 2);
      tm(g, P[b].x, P[b].y);
      te(g, P[b].x, P[b].y);
      n++;
      if (g.dragging || g.pendingDrag || g.touchStartPos) {
        violations.push({
          gesture: `按住「${a}」拖到「${b}」松手`,
          state: `dragging=${g.dragging} pendingDrag=${g.pendingDrag} touchStartPos=${JSON.stringify(g.touchStartPos)}`,
          g: g,
        });
      }
    }
  }
  log(`  共 ${n} 个手势，破坏不变量的 ${violations.length} 个`);
  const seen = {};
  for (const v of violations) {
    const key = v.state.replace(/"[^"]*"/g, 'X');
    if (seen[key]) { seen[key].push(v.gesture); continue; }
    seen[key] = [v.gesture];
  }
  for (const key of Object.keys(seen)) {
    log(`    ★ 残留状态 [${key}]`);
    log(`        触发手势共 ${seen[key].length} 个，例：${seen[key].slice(0, 6).join(' / ')}`);
  }
  // 单独把"拖到顶栏/屏幕外松手"列清楚
  log('');
  log('  重点核对（拖放被输入层的早期 return 吃掉，状态没人清）：');
  for (const a of ['slot0', 'slot3', 'shopCard', 'refresh']) {
    for (const b of ['menuBtn', 'topbarLeft', 'aboveScreen']) {
      const g = mkBattle();
      ts(g, P[a].x, P[a].y);
      tm(g, (P[a].x + P[b].x) / 2, (P[a].y + P[b].y) / 2);
      tm(g, P[b].x, P[b].y);
      te(g, P[b].x, P[b].y);
      const stuck = g.dragging || g.pendingDrag;
      log(`    从「${a}」拖到「${b}」松手 → dragging=${g.dragging} pendingDrag=${g.pendingDrag}  ${stuck ? '★ 卡死（之后所有点击被首行 return 吃掉）' : 'ok'}`);
    }
  }
}

// =====================================================================
head('不变量 B：会吞触摸的模态必须都有真实逃生口');
{
  const num = (v) => Math.round(v);

  // B1 游戏中菜单
  {
    const g = mkBattle();
    const P = pointsOf(g);
    tap(g, P.menuBtn.x, P.menuBtn.y);
    const opened = g.showMenu;
    const ML = CUR.gamemenu.getMenuLayout(g);
    tap(g, ML.resume.x + ML.resume.w / 2, ML.resume.y + ML.resume.h / 2);
    log(`  B1 游戏菜单：☰打开=${opened} → 点「返回战斗」后 showMenu=${g.showMenu}  ${g.showMenu === false ? 'ok' : '★ 关不掉'}`);
    // 关掉菜单后导航应恢复
    const P2 = pointsOf(g);
    tap(g, P2.navCodex.x, P2.navCodex.y);
    log(`     关菜单后点导航：scene=${g.scene}  ${g.scene === 'codex' ? 'ok' : '★ 仍然卡住'}`);
  }

  // B2 强化浮层
  {
    const g = mkBattle();
    g.towers[0].stage = cfg.MAX_STAGE;
    g.towers[0].attackPowerBoost = CUR.tower.getAttackPowerBoost(g.towers[0].stage);
    g.showPanel = true; g.selectedTower = g.towers[0]; g.panelTowerType = g.towers[0].type;
    g.gold = 0;                              // 金币不足 → 点卡片必然失败
    frame(g);
    const bc = g.panelEnhanceBtn;
    tap(g, bc.x + bc.w / 2, bc.y + bc.h / 2);
    const opened = !!g.enhancePicker;
    const EL = CUR.enhance.getEnhanceLayout(g);
    tap(g, EL.cards[0].x + EL.cards[0].w / 2, EL.cards[0].y + EL.cards[0].h / 2);
    const afterFail = !!g.enhancePicker;
    tap(g, EL.panel.x + 8, EL.panel.y + 20);   // 点空白
    log(`  B2 强化浮层：打开=${opened} 金币不足点卡片后仍开=${afterFail} → 点空白后 picker=${g.enhancePicker ? 'OPEN' : 'null'}  ${!g.enhancePicker ? 'ok' : '★ 关不掉'}`);
    const P2 = pointsOf(g);
    tap(g, P2.navCodex.x, P2.navCodex.y);
    log(`     逃生后点导航：scene=${g.scene}  ${g.scene === 'codex' ? 'ok' : '★ 仍然卡住'}`);
  }

  // B3 结算界面：胜利态 / 失败态 / 观看视频态
  {
    for (const [tag, setup] of [
      ['胜利', (g) => { g.gameOver = true; g.gameWon = true; }],
      ['失败', (g) => { g.gameOver = true; g.gameWon = false; }],
      ['失败+观看视频中', (g) => { g.gameOver = true; g.gameWon = false; g.watchingVideo = true; g.isRunning = false; g.videoTimer = 30; }],
    ]) {
      const g = mkBattle();
      setup(g);
      frame(g);                              // 让 renderer 算出 gameOverButtons
      const btns = g.gameOverButtons || {};
      const keys = Object.keys(btns);
      let clicked = '（无按钮可点）';
      if (btns.restart) {
        tap(g, btns.restart.x + btns.restart.w / 2, btns.restart.y + btns.restart.h / 2);
        clicked = `点「重新开始」→ gameOver=${g.gameOver} watchingVideo=${g.watchingVideo}`;
      } else if (btns.watchContinue) {
        tap(g, btns.watchContinue.x + btns.watchContinue.w / 2, btns.watchContinue.y + btns.watchContinue.h / 2);
        clicked = `点「重新挑战」→ watchingVideo=${g.watchingVideo}`;
      }
      log(`  B3 结算[${tag}]：gameOverButtons=[${keys.join(',') || '空'}]  ${clicked}`);
      if (!keys.length) {
        // 没有任何可点按钮 → 输入层还在吞触摸吗？
        const P2 = pointsOf(g);
        const sceneBefore = g.scene;
        tap(g, P2.navCodex.x, P2.navCodex.y);
        log(`     ★ 无按钮可点，而 input 的 gameOver 分支吞掉一切 → 点导航 scene=${g.scene}（${g.scene === sceneBefore ? '仍然没有反应 = 界面点不动' : '能切'}）`);
      }
    }
  }

  // B4 胜利后再回战前选关（abandonRun）等组合态
  {
    const g = mkBattle();
    g.gameOver = true; g.gameWon = true;
    frame(g);
    const btns = g.gameOverButtons;
    tap(g, btns.restart.x + btns.restart.w / 2, btns.restart.y + btns.restart.h / 2);
    const P = pointsOf(g);
    tap(g, P.navCodex.x, P.navCodex.y);
    log(`  B4 胜利后点「重新开始」→ gameOver=${g.gameOver} 再点导航 scene=${g.scene}  ${(!g.gameOver && g.scene === 'codex') ? 'ok' : '★ 有问题'}`);
  }
}

// =====================================================================
head('不变量 C：gameOver 为 true 但 scene 不是 battle（渲染层不画结算界面，输入层却照样吞触摸）');
{
  const g = mkBattle();
  g.gameOver = true; g.gameWon = false;
  g.scene = 'codex';                 // 状态错配
  frame(g);
  const btns = g.gameOverButtons || {};
  const P = pointsOf(g);
  tap(g, P.navTalents.x, P.navTalents.y);
  tap(g, P.navBattle.x, P.navBattle.y);
  tap(g, P.field.x, P.field.y);
  log(`  scene=${g.scene} gameOver=${g.gameOver} gameOverButtons=[${Object.keys(btns).join(',') || '空'}]`);
  log(`  连点 天赋/战斗/战场 后 scene 仍是：${g.scene}`);
  log(`  ${g.scene !== 'codex' ? '能切走' : '★ 全部无反应 —— 渲染层没画结算界面，输入层却把所有触摸吃掉了'}`);
}

log('');
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(OUT, L.join('\n') + '\n', 'utf8');
console.log('life probe done');
