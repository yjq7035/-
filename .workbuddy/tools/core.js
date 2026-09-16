/**
 * 核心交互探针：为什么点了没反应？
 * 1) 商店命中性：每张卡的"画出来的矩形中心"能否被 hitShop 命中（视觉与判定是否同源）
 * 2) 拖放放塔全链路：从商店卡拖到空槽，塔到底有没有落地（towers / slot.occupied / gold）
 * 3) 点击放塔（不拖）：点商店卡会不会弹属性面板
 * 4) 槽位命中：点已有塔的槽中心能不能弹面板
 * 输出：.workbuddy/tmp/_core.txt
 */
'use strict';
const fs = require('fs');
const path = require('path');
const HH = require('./harness');
const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src');
const TMP = path.join(ROOT, '.workbuddy', 'tmp');
const OUT = path.join(TMP, '_core.txt');
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

function inRect(p, r) { return r && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h; }

function newBattle() {
  const g = freshGame(W, H);
  const r = g.startBattle();
  frame(g);
  return { g, r };
}

// =====================================================================
head('1. 商店命中性：画出来的卡片矩形中心 vs hitShop');
{
  const { g, r } = newBattle();
  log(`  startBattle=${r} gold=${g.gold} battleStarted=${g.battleStarted} scene=${g.scene}`);
  const sl = CUR.shop.getShopLayout(g);
  log(`  panel=(${sl.panel.x.toFixed(1)},${sl.panel.y.toFixed(1)}) ${sl.panel.w.toFixed(1)}x${sl.panel.h.toFixed(1)}`);
  log(`  出货 ${g.shopOffers.length} 个: ${JSON.stringify(g.shopOffers)}  shopSlotState=${JSON.stringify(g.shopSlotState.map((s) => s.type + (s.empty ? '(空)' : '')))}`);
  log(`  refreshBtn=(${sl.refreshBtn.x.toFixed(1)},${sl.refreshBtn.y.toFixed(1)}) ${sl.refreshBtn.w.toFixed(1)}x${sl.refreshBtn.h.toFixed(1)}`);
  sl.cards.forEach((c, i) => {
    const cx = c.x + c.w / 2, cy = c.y + c.h / 2;
    const hit = CUR.shop.hitShop(g, { x: cx, y: cy });
    const cost = g.shopOffers[i] ? g.towerCost(g.shopOffers[i]) : null;
    log(`    card${i} rect=(${c.x.toFixed(1)},${c.y.toFixed(1)}) ${c.w.toFixed(1)}x${c.h.toFixed(1)} 中心命中=${hit ? hit.kind + (hit.type ? ':' + hit.type : '') : '★ 未命中'}  造价=${cost}  可买=${cost === null ? '-' : (g.gold >= cost ? '是' : '否(金币不足)')}`);
  });
  const rc = { x: sl.refreshBtn.x + sl.refreshBtn.w / 2, y: sl.refreshBtn.y + sl.refreshBtn.h / 2 };
  const rh = CUR.shop.hitShop(g, rc);
  log(`    refresh 中心命中=${rh ? rh.kind : '★ 未命中'}`);
  log(`  槽位 ${g.slots.length} 个; slot0=(${g.slots[0].x.toFixed(1)},${g.slots[0].y.toFixed(1)}) size=${g.slots[0].size}`);
  log(`  战场范围 mapY=${g.mapY.toFixed(1)} mapH=${g.mapHeight.toFixed(1)} → 底边 ${(g.mapY + g.mapHeight).toFixed(1)}; 商店面板顶边=${sl.panel.y.toFixed(1)}`);
}

// =====================================================================
head('2. 拖放放塔全链路（从商店卡 → 空槽）');
{
  const { g } = newBattle();
  g.gold = 999999;
  frame(g);
  const sl = CUR.shop.getShopLayout(g);
  const c0 = sl.cards[0];
  const t0 = g.towers.length;
  const g0 = g.gold;
  const sx = c0.x + c0.w / 2, sy = c0.y + c0.h / 2;
  const dst = g.slots.find((s) => !s.occupied);
  const dx = dst.x + dst.size / 2, dy = dst.y + dst.size / 2;
  log(`  起点=商店card0中心(${sx.toFixed(1)},${sy.toFixed(1)}) → 终点=空槽(${dx.toFixed(1)},${dy.toFixed(1)})  gold前=${g0}`);

  ts(g, sx, sy);
  log(`  touchstart: dragging=${g.dragging} pendingDrag=${g.pendingDrag} dragType=${g.dragType} dragFromShop=${g.dragFromShop}`);
  tm(g, sx - 40, sy - 40);
  log(`  touchmove : dragging=${g.dragging} dragType=${g.dragType}`);
  tm(g, dx, dy);
  te(g, dx, dy);
  log(`  touchend  : towers ${t0}→${g.towers.length}  gold ${g0}→${g.gold}  目标槽occupied=${dst.occupied}  ${g.towers.length > t0 ? '★ 放塔成功' : '★ 放塔失败（点了没反应）'}`);
  log(`  残留状态  : dragging=${g.dragging} pendingDrag=${g.pendingDrag}`);
}

// =====================================================================
head('3. 点击商店卡（不拖）→ 是否弹属性面板');
{
  const { g } = newBattle();
  g.gold = 999999;
  frame(g);
  const sl = CUR.shop.getShopLayout(g);
  const c0 = sl.cards[0];
  tap(g, c0.x + c0.w / 2, c0.y + c0.h / 2);
  frame(g);
  log(`  点击商店card0后: showPanel=${g.showPanel} panelTowerType=${g.panelTowerType}  ${g.showPanel ? '有反应' : '★ 无反应'}`);
}

// =====================================================================
head('4. 点击已有塔的槽位 → 是否弹属性面板');
{
  const { g } = newBattle();
  g.gold = 999999;
  const tw = CUR.tower.createTower('triangle', g.slots[0].x, g.slots[0].y);
  g.slots[0].tower = tw; g.slots[0].occupied = true; g.towers.push(tw);
  frame(g);
  const s = g.slots[0];
  tap(g, s.x + s.size / 2, s.y + s.size / 2);
  frame(g);
  log(`  点槽0后: showPanel=${g.showPanel} panelTowerType=${g.panelTowerType}  ${g.showPanel ? '有反应' : '★ 无反应'}`);
}

// =====================================================================
head('5. 真实开局：拖第一张商店卡（不额外给钱，就看默认金币够不够）');
{
  const { g } = newBattle();
  frame(g);
  const sl = CUR.shop.getShopLayout(g);
  const c0 = sl.cards[0];
  const type = g.shopOffers[0];
  const cost = g.towerCost(type);
  const dst = g.slots.find((s) => !s.occupied);
  const t0 = g.towers.length;
  ts(g, c0.x + c0.w / 2, c0.y + c0.h / 2);
  tm(g, c0.x + c0.w / 2 - 40, c0.y + c0.h / 2 - 40);
  tm(g, dst.x + dst.size / 2, dst.y + dst.size / 2);
  te(g, dst.x + dst.size / 2, dst.y + dst.size / 2);
  log(`  首卡=${type} 造价=${cost} 起始金币=${g.gold} → towers ${t0}→${g.towers.length} ${g.towers.length > t0 ? '放塔成功' : '★ 放塔失败'}`);
}

log('');
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(OUT, L.join('\n') + '\n', 'utf8');
console.log('core done');
