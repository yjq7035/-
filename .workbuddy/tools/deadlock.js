/**
 * 定向复现：拖拽过程中游戏结束 → 永久锁死
 *
 * 假设链路：
 *   1. 玩家按住塔（或商店卡）开始拖放 → handleTouchMove 令 dragging=true（touchStartPos 仍在）
 *   2. 同一帧内 update() 扣到 lives<=0 → game_core.js:811 置 gameOver=true / isRunning=false
 *   3. 玩家松手 → handleTouchEnd 命中第 321 行 `if (game.gameOver && !watchingVideo)` 分支
 *      → 只 releaseButton + return，**从不调用 _resetDragState**
 *   4. 于是 dragging 永久为 true 且 touchStartPos 仍非空
 *      → handleTouchStart 第 68 行的兜底（pendingDrag && !touchStartPos）救不了
 *      → 第 69 行 `if (game.dragging || game.pendingDrag) return;` 吞掉**之后所有触摸**
 *   5. 屏幕上明明画着「重新开始 / 重新挑战」，却一个都点不动 = 用户看到的"整个界面无法点击"
 *
 * 输出：.workbuddy/tmp/_deadlock.txt
 */
'use strict';
const fs = require('fs');
const path = require('path');
const HH = require('./harness');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src');
const TMP = path.join(ROOT, '.workbuddy', 'tmp');
const OUT = path.join(TMP, '_deadlock.txt');
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
  g.__holder = holder;
  CUR = {};
  for (const m of ALL_MODULES) CUR[m] = require(path.join(SRC, m + '.js'));
  return g;
}
function frame(g) { g.__holder.ops = []; g.draw(); return g.__holder.ops; }

const W = 390, H = 844;

function ts(g, x, y) { CUR.input.handleTouchStart(g, { touches: [{ clientX: x, clientY: y }] }); }
function tm(g, x, y) { CUR.input.handleTouchMove(g, { touches: [{ clientX: x, clientY: y }] }); }
function te(g, x, y) { CUR.input.handleTouchEnd(g, { changedTouches: [{ clientX: x, clientY: y }] }); }
function dragState(g) {
  return `dragging=${g.dragging} pendingDrag=${g.pendingDrag} touchStartPos=${JSON.stringify(g.touchStartPos)}`;
}

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

function navPt(g, id) {
  const L2 = CUR.nav.getNavLayout(g);
  const it = L2.items.filter((i) => i.id === id)[0];
  return { x: it.x + it.w / 2, y: it.y + it.h / 2 };
}

/** 手指还按着时，游戏结束（真实：update() 里 lives 扣到 0） */
function endGameMidDrag(g) {
  g.lives = 1;
  g.isRunning = true;
  // 直接走真实扣命路径：把一只怪放到终点
  g.applyPenaltyByEnemyType({ type: 'normal' });
  g.update(1 / 30);   // game_core.js:811 → gameOver=true / isRunning=false
}

// =====================================================================
head('A. 复现：拖拽中游戏结束（手指仍按着）→ 松手');
{
  const g = newBattle();
  const s0 = g.slots[0];
  const cx = s0.x + s0.size / 2, cy = s0.y + s0.size / 2;
  log('  初始: ' + dragState(g));

  ts(g, cx, cy);
  log('  touchstart(塔)      : ' + dragState(g));
  tm(g, cx + 40, cy + 40);
  log('  touchmove(超阈值)   : ' + dragState(g));
  tm(g, cx + 80, cy + 80);
  log('  touchmove(继续拖)   : ' + dragState(g));

  endGameMidDrag(g);
  log(`  拖拽中游戏结束      : gameOver=${g.gameOver} isRunning=${g.isRunning} lives=${g.lives}  gameOverButtons=[${Object.keys(g.gameOverButtons || {}).join(',') || '空'}]`);

  te(g, cx + 80, cy + 80);   // 松手（落点不在顶栏）
  log('  touchend(松手)      : ' + dragState(g));
  frame(g);
  log(`  渲染一帧后          : gameOverButtons=[${Object.keys(g.gameOverButtons || {}).join(',') || '空'}]`);

  // 现在疯狂点击，看看有没有任何一次能唤醒界面
  const before = g.scene;
  let hits = 0, tried = 0;
  const targets = [];
  if (g.gameOverButtons && g.gameOverButtons.restart) {
    const b = g.gameOverButtons.restart;
    targets.push(['重新开始', b.x + b.w / 2, b.y + b.h / 2]);
  }
  if (g.gameOverButtons && g.gameOverButtons.watchContinue) {
    const b = g.gameOverButtons.watchContinue;
    targets.push(['重新挑战', b.x + b.w / 2, b.y + b.h / 2]);
  }
  const nc = navPt(g, 'codex');
  targets.push(['导航-图签', nc.x, nc.y]);
  const nr = CUR.gamemenu.getMenuButtonRect(g);
  targets.push(['顶栏☰', nr.x + nr.w / 2, nr.y + nr.h / 2]);
  targets.push(['战场空地', W / 2, g.mapY + g.mapHeight / 2]);

  for (const [name, x, y] of targets) {
    tried++;
    const bs = g.scene, bo = g.gameOver, bv = g.watchingVideo, bp = g.showPanel, bm = g.showMenu;
    ts(g, x, y); te(g, x, y);
    const changed = (g.scene !== bs) || (g.gameOver !== bo) || (g.watchingVideo !== bv) ||
                    (g.showPanel !== bp) || (g.showMenu !== bm) || g.dragging || g.pendingDrag;
    if (g.scene !== bs || g.gameOver !== bo || g.watchingVideo !== bv || g.showPanel !== bp || g.showMenu !== bm) hits++;
    log(`    点「${name}」→ ${changed ? '有反应' : '★ 被吞（界面毫无响应）'}   [scene=${g.scene} gameOver=${g.gameOver} panel=${g.showPanel} menu=${g.showMenu}]`);
  }
  log('');
  log(`  结论：尝试 ${tried} 个可点目标，${hits} 个有效应。`);
  log(`  ${hits === 0 ? '★★ 完全无响应 = 永久死锁，且屏幕上画着结算按钮 = "整个界面无法点击"' : '未完全死锁，需进一步分析'}`);
  void before;
}

// =====================================================================
head('B. 对照：拖拽中游戏结束，但松手落在「顶栏 / 结算按钮」之外的其他提前 return 分支');
{
  // B1: 松手落在顶栏（模拟玩家随手往上甩）
  const g = newBattle();
  const s0 = g.slots[0];
  const cx = s0.x + s0.size / 2, cy = s0.y + s0.size / 2;
  ts(g, cx, cy); tm(g, cx + 40, cy + 40);
  endGameMidDrag(g);
  te(g, 14, 8);   // 顶栏
  log('  B1 拖拽中结束 + 松手在顶栏  : ' + dragState(g));

  // B2: 拖拽中游戏结束，松手落在底部导航栏
  const g2 = newBattle();
  const s = g2.slots[0];
  const c2x = s.x + s.size / 2, c2y = s.y + s.size / 2;
  ts(g2, c2x, c2y); tm(g2, c2x + 40, c2y + 40);
  endGameMidDrag(g2);
  const nb = navPt(g2, 'codex');
  te(g2, nb.x, nb.y);
  log('  B2 拖拽中结束 + 松手在底栏  : ' + dragState(g2));

  // B3: 对照 —— 没有拖拽时游戏结束，再松手（正常路径）
  const g3 = newBattle();
  endGameMidDrag(g3);
  te(g3, W / 2, g3.mapY + g3.mapHeight / 2);
  log('  B3 无拖拽时结束 + 松手      : ' + dragState(g3) + '   （正常，不受影响）');
}

// =====================================================================
head('C. 商店卡拖拽中游戏结束（同一条链路，来源可以是商店）');
{
  const g = newBattle();
  const shopL = CUR.shop.getShopLayout(g);
  const c = shopL.cards[0];
  const x = c.x + c.w / 2, y = c.y + c.h / 2;
  ts(g, x, y);
  log('  touchstart(商店卡)  : ' + dragState(g));
  tm(g, x - 60, y - 60);
  log('  touchmove(超阈值)   : ' + dragState(g));
  endGameMidDrag(g);
  te(g, x - 60, y - 60);
  log('  touchend            : ' + dragState(g));
  // 有没有救
  const nb = navPt(g, 'codex');
  ts(g, nb.x, nb.y); te(g, nb.x, nb.y);
  log(`  再点导航 → scene=${g.scene} ${g.scene === 'codex' ? '能切（有救）' : '★ 被吞（死锁）'}`);
}

// =====================================================================
head('D. 自愈性核查：兜底守卫能否救回各种残留态');
{
  const cases = [
    ['pendingDrag=true  touchStartPos=null', (g) => { g.pendingDrag = true; g.dragging = false; g.touchStartPos = null; }],
    ['dragging=true     touchStartPos=null', (g) => { g.pendingDrag = true; g.dragging = true; g.touchStartPos = null; }],
    ['dragging=true     touchStartPos={}', (g) => { g.pendingDrag = true; g.dragging = true; g.touchStartPos = { x: 100, y: 100 }; }],
    ['dragging=true pendingDrag=FALSE pos={}', (g) => { g.pendingDrag = false; g.dragging = true; g.touchStartPos = { x: 100, y: 100 }; }],
  ];
  for (const [name, setup] of cases) {
    const g = newBattle();
    setup(g);
    const nb = navPt(g, 'codex');
    const before = g.scene;
    ts(g, nb.x, nb.y); te(g, nb.x, nb.y);
    log(`  ${name}\n      点导航 → scene=${before}→${g.scene}  ${g.scene === 'codex' ? '有救（守卫生效）' : '★ 永久吞掉所有点击'}`);
  }
}

log('');
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(OUT, L.join('\n') + '\n', 'utf8');
console.log('deadlock done');
