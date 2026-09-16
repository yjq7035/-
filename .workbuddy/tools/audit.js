/**
 * 可点性体检：找出"整个界面无法点击"的真凶
 *
 * 三件事：
 *  1) 布局矩形体检：所有命中判定用的 rect 是否 NaN / Infinity / 越界 / 宽高为 0
 *     —— 历史上踩过"布局表漏写 padX → NaN → 按钮永远点不中"。
 *  2) 可点热区图：把屏幕按网格扫一遍，统计每个点会被哪一层接管。
 *     —— 如果某界面 99% 的点都被"吞掉且无动作"的层接管，就是"界面点不动"。
 *  3) 逐界面"点下去有没有反应"：对每个界面的每个可见可点目标做一次真实
 *     touchstart→touchend，记录 state 是否发生任何变化。零变化 = 死按钮。
 *
 * 输出：.workbuddy/tmp/_audit.txt
 */
'use strict';
const fs = require('fs');
const path = require('path');
const HH = require('./harness');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src');
const TMP = path.join(ROOT, '.workbuddy', 'tmp');
const OUT = path.join(TMP, '_audit.txt');
const L = [];
const log = (s) => L.push(s);
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
function frame(g) { g.__holder.ops = []; g.draw(); return g.__holder.ops; }
const W = 390, H = 844;
const ts = (g, x, y) => CUR.input.handleTouchStart(g, { touches: [{ clientX: x, clientY: y }] });
const tm = (g, x, y) => CUR.input.handleTouchMove(g, { touches: [{ clientX: x, clientY: y }] });
const te = (g, x, y) => CUR.input.handleTouchEnd(g, { changedTouches: [{ clientX: x, clientY: y }] });
const tap = (g, x, y) => { ts(g, x, y); te(g, x, y); };

function finite(v) { return typeof v === 'number' && isFinite(v); }
function rectOk(tag, r, W_, H_) {
  const bad = [];
  if (!r) return [`${tag}: 缺失(null)`];
  for (const k of ['x', 'y', 'w', 'h']) {
    if (!finite(r[k])) bad.push(`${k}=${r[k]}`);
  }
  if (!bad.length) {
    if (r.w <= 0 || r.h <= 0) bad.push(`非正尺寸 w=${r.w} h=${r.h}`);
    if (r.x + r.w < 0 || r.y + r.h < 0 || r.x > W_ || r.y > H_) bad.push(`完全在屏外 x=${r.x} y=${r.y} w=${r.w} h=${r.h}`);
  }
  return bad.length ? [`${tag}: ${bad.join(' ')}`] : [];
}

/** 指纹：任何可观测状态变化都要体现出来 */
function fp(g) {
  return JSON.stringify({
    s: g.scene, bs: g.battleStarted, go: g.gameOver, gw: g.gameWon,
    wv: g.watchingVideo, ir: g.isRunning, sm: g.showMenu, sp: g.showPanel,
    ep: !!g.enhancePicker, dr: g.dragging, pd: g.pendingDrag, tsp: !!g.touchStartPos,
    bp: g.btnPress ? g.btnPress.id : null, fx: !!g.buttonFx,
    lv: g.currentLevel, lvlScroll: g.levelScroll, toast: g.toast ? g.toast.text : null,
    tabs: Object.keys(g.gameOverButtons || {}).join(','),
  });
}

const cfg = require(path.join(SRC, 'config.js'));

// =====================================================================
head('0. 基础信息');
{
  const g = freshGame(W, H);
  log(`  分辨率 ${W}x${H}  canvas=${g.canvas.width}x${g.canvas.height}`);
  log(`  初始 scene=${g.scene} battleStarted=${g.battleStarted} currentLevel=${g.currentLevel}`);
  log(`  meta.getSelectedLevel()=${CUR.meta.getSelectedLevel()}`);
  const lv = cfg.LEVELS.filter((l) => l.id === g.currentLevel)[0];
  log(`  该关配置: ${lv ? JSON.stringify({ id: lv.id, name: lv.name, waves: lv.waves, playable: lv.playable }) : '不存在'}`);
  log(`  startBattle() 实际返回: ${g.startBattle()}  → battleStarted=${g.battleStarted}`);
}

// =====================================================================
head('1. 布局矩形体检（NaN / 越界 / 零尺寸）');
{
  const g = freshGame(W, H);
  frame(g);
  const bad = [];
  const navL = CUR.nav.getNavLayout(g);
  for (const it of navL.items) bad.push(...rectOk(`nav.${it.id}`, it, W, H));
  const mL = CUR.gamemenu.getMenuLayout(g);
  bad.push(...rectOk('menu.panel', mL.panel, W, H));
  bad.push(...rectOk('menu.resume', mL.resume, W, H));
  bad.push(...rectOk('menu.abandon', mL.abandon, W, H));
  bad.push(...rectOk('topbar.menuBtn', CUR.gamemenu.getMenuButtonRect(g), W, H));
  const sL = CUR.shop.getShopLayout(g);
  bad.push(...rectOk('shop.panel', sL.panel, W, H));
  bad.push(...rectOk('shop.refreshBtn', sL.refreshBtn, W, H));
  sL.cards.forEach((c, i) => bad.push(...rectOk(`shop.card${i}`, c, W, H)));
  const rL = CUR.levels.getReadyLayout(g);
  bad.push(...rectOk('ready.startBtn', rL.startBtn, W, H));
  bad.push(...rectOk('ready.viewport', rL.viewport, W, H));
  if (rL.cards) rL.cards.slice(0, 3).forEach((c, i) => bad.push(...rectOk(`ready.card${i}`, c, W, H)));
  log(`  共 ${bad.length} 处异常`);
  bad.forEach((b) => log('    ★ ' + b));
}

// =====================================================================
head('2. 各界面「点下去有没有反应」——逐目标真点');
{
  // 构造多套界面态，每套对每个目标做一次真实 tap
  const builders = {
    '战前选关(初始)': () => { const g = freshGame(W, H); frame(g); return g; },
    '战斗进行中': () => {
      const g = freshGame(W, H); g.startBattle(); g.gold = 999999;
      const types = ['triangle', 'circle', 'trapezoid', 'long_rectangle', 'hexagon', 'sector'];
      for (let i = 0; i < types.length && i < g.slots.length; i++) {
        const tw = CUR.tower.createTower(types[i], g.slots[i].x, g.slots[i].y);
        g.slots[i].tower = tw; g.slots[i].occupied = true; g.towers.push(tw);
      }
      frame(g); return g;
    },
    '图签场景': () => { const g = freshGame(W, H); g.startBattle(); g.switchScene('codex'); frame(g); return g; },
    '天赋场景': () => { const g = freshGame(W, H); g.startBattle(); g.switchScene('talents'); frame(g); return g; },
    '游戏中菜单': () => { const g = freshGame(W, H); g.startBattle(); g.openMenu(); frame(g); return g; },
    '结算-失败': () => { const g = freshGame(W, H); g.startBattle(); g.lives = 0; g.gameOver = true; g.isRunning = false; frame(g); return g; },
    '结算-胜利': () => { const g = freshGame(W, H); g.startBattle(); g.gameOver = true; g.gameWon = true; frame(g); return g; },
    '结算-观视频': () => { const g = freshGame(W, H); g.startBattle(); g.lives = 0; g.gameOver = true; g.isRunning = false; g.watchingVideo = true; g.videoTimer = 30; frame(g); return g; },
    '属性面板(点塔)': () => {
      const g = freshGame(W, H); g.startBattle(); g.gold = 999999;
      const tw = CUR.tower.createTower('triangle', g.slots[0].x, g.slots[0].y);
      g.slots[0].tower = tw; g.slots[0].occupied = true; g.towers.push(tw);
      frame(g);
      const s = g.slots[0];
      tap(g, s.x + s.size / 2, s.y + s.size / 2);
      frame(g); return g;
    },
    '强化浮层': () => {
      const g = freshGame(W, H); g.startBattle(); g.gold = 999999;
      const tw = CUR.tower.createTower('triangle', g.slots[0].x, g.slots[0].y);
      tw.stage = 3;
      g.slots[0].tower = tw; g.slots[0].occupied = true; g.towers.push(tw);
      frame(g);
      const s = g.slots[0];
      tap(g, s.x + s.size / 2, s.y + s.size / 2);   // 开属性面板
      frame(g);
      if (g.panelEnhanceBtn) {
        const b = g.panelEnhanceBtn;
        tap(g, b.x + b.w / 2, b.y + b.h / 2);       // 点强化 → 开浮层
      }
      frame(g); return g;
    },
  };

  for (const [name, build] of Object.entries(builders)) {
    const probeG = build();
    const targets = [];

    const navL = CUR.nav.getNavLayout(probeG);
    for (const it of navL.items) targets.push([`导航:${it.id}`, it.x + it.w / 2, it.y + it.h / 2]);

    const mb = CUR.gamemenu.getMenuButtonRect(probeG);
    targets.push(['顶栏☰', mb.x + mb.w / 2, mb.y + mb.h / 2]);
    targets.push(['顶栏空白', 14, 8]);
    targets.push(['战场中心', W / 2, probeG.mapY + probeG.mapHeight / 2]);
    targets.push(['商店面板', (() => { const s = CUR.shop.getShopLayout(probeG); return s.panel.x + 6; })(), (() => { const s = CUR.shop.getShopLayout(probeG); return s.panel.y + 4; })()]);
    if (probeG.slots && probeG.slots[0]) targets.push(['放置槽0', probeG.slots[0].x + probeG.slots[0].size / 2, probeG.slots[0].y + probeG.slots[0].size / 2]);

    if (probeG.showMenu) {
      const m = CUR.gamemenu.getMenuLayout(probeG);
      targets.push(['菜单:返回战斗', m.resume.x + m.resume.w / 2, m.resume.y + m.resume.h / 2]);
      targets.push(['菜单:放弃结束', m.abandon.x + m.abandon.w / 2, m.abandon.y + m.abandon.h / 2]);
    }
    if (probeG.gameOverButtons && probeG.gameOverButtons.restart) {
      const b = probeG.gameOverButtons.restart;
      targets.push(['结算:重新开始', b.x + b.w / 2, b.y + b.h / 2]);
    }
    if (probeG.gameOverButtons && probeG.gameOverButtons.watchContinue) {
      const b = probeG.gameOverButtons.watchContinue;
      targets.push(['结算:重新挑战', b.x + b.w / 2, b.y + b.h / 2]);
    }
    if (probeG.panelEnhanceBtn) {
      const b = probeG.panelEnhanceBtn;
      targets.push(['面板:强化', b.x + b.w / 2, b.y + b.h / 2]);
    }
    if (probeG.scene === 'battle' && !probeG.battleStarted) {
      const r = CUR.levels.getReadyLayout(probeG);
      targets.push(['选关:开始游戏', r.startBtn.x + r.startBtn.w / 2, r.startBtn.y + r.startBtn.h / 2]);
    }
    if (probeG.scene === 'codex') {
      const c = CUR.codex.getCodexLayout(probeG);
      if (c && c.cells && c.cells[0]) targets.push(['图签:第1格', c.cells[0].x + c.cells[0].w / 2, c.cells[0].y + c.cells[0].h / 2]);
      if (c && c.sheet && c.sheetClose) targets.push(['图签:关闭', c.sheetClose.x + c.sheetClose.w / 2, c.sheetClose.y + c.sheetClose.h / 2]);
    }
    if (probeG.scene === 'talents') {
      const t = CUR.talents.getTalentLayout(probeG);
      if (t && t.rows && t.rows[0] && t.rows[0].btn) targets.push(['天赋:学习', t.rows[0].btn.x + t.rows[0].btn.w / 2, t.rows[0].btn.y + t.rows[0].btn.h / 2]);
    }

    log('');
    log(`  【${name}】 可点目标 ${targets.length} 个`);
    let dead = 0;
    for (const [tname, x, y] of targets) {
      const g = build();                 // 每个目标用全新同态游戏，避免互相污染
      const before = fp(g);
      const sb = g.scene, gb = g.gameOver, wb = g.watchingVideo, mb2 = g.showMenu, pb = g.showPanel;
      tap(g, x, y);
      frame(g);                          // 渲染一帧，把 gameOverButtons 等派生状态算出来
      const after = fp(g);
      const changed = before !== after;
      if (!changed) dead++;
      log(`    ${changed ? '有反应' : '★ 无反应'}  ${tname.padEnd(14)} ${before === after ? '' : ''}[${sb}/${gb ? 'over' : '-'}/${wb ? 'vid' : '-'}/${mb2 ? 'menu' : '-'}/${pb ? 'panel' : '-'}]`);
      void after;
    }
    log(`    → 无反应目标 ${dead}/${targets.length}`);
  }
}

// =====================================================================
head('3. 可点热区图：屏幕网格扫一遍，看谁接管');
{
  const g = freshGame(W, H);
  frame(g);
  const gridX = 13, gridY = 28;
  const counts = {};
  for (let i = 0; i < gridX; i++) {
    for (let j = 0; j < gridY; j++) {
      const x = (i + 0.5) * W / gridX;
      const y = (j + 0.5) * H / gridY;
      let who = '无接管(全场吞掉)';
      if (y >= H - cfg.LAYOUT.navHeight) {
        const id = CUR.nav.hitNav(g, { x, y });
        who = id ? '导航:' + id : '导航栏空白';
      } else if (y <= cfg.LAYOUT.topBarHeight) {
        who = CUR.gamemenu.getMenuButtonRect(g) && (x >= CUR.gamemenu.getMenuButtonRect(g).x) ? '顶栏:☰' : '顶栏空白';
      } else if (g.scene === 'battle' && !g.battleStarted) {
        const hit = CUR.levels.hitReady(g, { x, y });
        who = '选关:' + hit.kind;
      } else {
        const s = CUR.shop.hitShop(g, { x, y });
        who = s ? '商店:' + s.kind : '战场(点击清选中)';
      }
      counts[who] = (counts[who] || 0) + 1;
    }
  }
  const total = gridX * gridY;
  Object.keys(counts).sort((a, b) => counts[b] - counts[a]).forEach((k) => {
    log(`    ${String(counts[k]).padStart(3)}/${total}  ${(counts[k] / total * 100).toFixed(0)}%  ${k}`);
  });
}

// =====================================================================
head('4. 模拟真实新局：从启动到开打，记录每一步');
{
  const steps = [];
  const g = freshGame(W, H);
  steps.push(['启动', fp(g)]);
  frame(g);
  const rl = CUR.levels.getReadyLayout(g);
  const sb = rl.startBtn;
  steps.push([`布局:startBtn=(${sb.x.toFixed(0)},${sb.y.toFixed(0)},${sb.w.toFixed(0)}x${sb.h.toFixed(0)})`, '']);
  tap(g, sb.x + sb.w / 2, sb.y + sb.h / 2);
  steps.push(['点「开始游戏」', fp(g)]);
  frame(g);
  tap(g, W / 2, g.mapY + g.mapHeight / 2);
  steps.push(['点战场中心', fp(g)]);
  frame(g);
  const sh = CUR.shop.getShopLayout(g);
  const c0 = sh.cards[0];
  ts(g, c0.x + c0.w / 2, c0.y + c0.h / 2);
  tm(g, c0.x + c0.w / 2 - 80, c0.y + c0.h / 2 - 80);
  te(g, g.slots[0].x + g.slots[0].size / 2, g.slots[0].y + g.slots[0].size / 2);
  steps.push(['拖商店卡到槽0', fp(g)]);
  frame(g);
  for (const [t, s] of steps) log(`  ${t}\n      ${s}`);
}

log('');
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(OUT, L.join('\n') + '\n', 'utf8');
console.log('audit done');
