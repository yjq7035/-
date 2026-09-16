'use strict';
const fs = require('fs');
const path = require('path');
const HH = require('./harness');
const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src');
const TMP = path.join(ROOT, '.workbuddy', 'tmp');
const OUT = path.join(TMP, '_micro.txt');
const L = [];
const log = (s) => L.push(s);

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
const W = 390, H = 844;
const ts = (g, x, y) => CUR.input.handleTouchStart(g, { touches: [{ clientX: x, clientY: y }] });
const tm = (g, x, y) => CUR.input.handleTouchMove(g, { touches: [{ clientX: x, clientY: y }] });
const te = (g, x, y) => CUR.input.handleTouchEnd(g, { changedTouches: [{ clientX: x, clientY: y }] });
const st = (g) => `dragging=${g.dragging} pendingDrag=${g.pendingDrag} touchStartPos=${JSON.stringify(g.touchStartPos)} scene=${g.scene} gameOver=${g.gameOver}`;

const cfg = require(path.join(SRC, 'config.js'));
log('LAYOUT.topBarHeight=' + cfg.LAYOUT.topBarHeight + '  navHeight=' + cfg.LAYOUT.navHeight + '  slotSize=' + cfg.LAYOUT.slotSize);

function newBattle() {
  const g = freshGame(W, H);
  g.startBattle();
  g.gold = 999999;
  const types = ['triangle', 'circle', 'trapezoid', 'long_rectangle', 'hexagon', 'sector'];
  for (let i = 0; i < types.length && i < g.slots.length; i++) {
    const tw = CUR.tower.createTower(types[i], g.slots[i].x, g.slots[i].y);
    g.slots[i].tower = tw; g.slots[i].occupied = true; g.towers.push(tw);
  }
  g.__holder.ops = []; g.draw();
  return g;
}

log('');
log('== 松手落点 vs 拖拽残留（逐个分支）==');
const g0 = newBattle();
const s0 = g0.slots[0];
const cx = s0.x + s0.size / 2, cy = s0.y + s0.size / 2;
const navL = CUR.nav.getNavLayout(g0);
const codexItem = navL.items.filter((i) => i.id === 'codex')[0];
const menuR = CUR.gamemenu.getMenuButtonRect(g0);
const shopL = CUR.shop.getShopLayout(g0);

const releases = [
  ['顶栏(y=8, 应在 topBarHeight=34 内)', 14, 8],
  ['☰按钮中心', menuR.x + menuR.w / 2, menuR.y + menuR.h / 2],
  ['战场空地', W / 2, g0.mapY + g0.mapHeight / 2],
  ['底部导航(y=H-20)', codexItem.x + codexItem.w / 2, H - 20],
  ['商店卡区域', shopL.cards[0].x + shopL.cards[0].w / 2, shopL.cards[0].y + shopL.cards[0].h / 2],
];
for (const [name, x, y] of releases) {
  const g = newBattle();
  const s = g.slots[0];
  const px = s.x + s.size / 2, py = s.y + s.size / 2;
  ts(g, px, py);
  tm(g, px + 30, py + 30);
  const mid = st(g);
  te(g, x, y);
  log(`  ${name}\n     拖拽中: ${mid}\n     松手后: ${st(g)}`);
}

log('');
log('== 松手后能否自愈（再点一次导航）==');
for (const [name, x, y] of releases) {
  const g = newBattle();
  const s = g.slots[0];
  const px = s.x + s.size / 2, py = s.y + s.size / 2;
  ts(g, px, py); tm(g, px + 30, py + 30); te(g, x, y);
  const after = st(g);
  const before = g.scene;
  const nx = codexItem.x + codexItem.w / 2, ny = codexItem.y + codexItem.h / 2;
  ts(g, nx, ny); te(g, nx, ny);
  log(`  ${name}\n     松手后: ${after}\n     点导航: ${before}→${g.scene} ${g.scene === 'codex' ? '有救' : '★ 被吞'}`);
}

fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(OUT, L.join('\n') + '\n', 'utf8');
console.log('micro done');
