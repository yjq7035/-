/**
 * canvas 警察：把「真实 canvas 会抛异常、但 mock 记录器会照单全收」的非法参数全部抓出来。
 *
 * 为什么需要它：
 *   verify.js 用的是记录式 mock ctx，任何参数（负数半径、NaN、非法 dash）都照存不误；
 *   shoot.js 是把记录回放成 SVG 交给 Edge —— SVG 也不挑这些参数。
 *   于是「负半径 arc / ellipse / arcTo / roundRect 圆角」、「负数 setLineDash」、
 *   「非有限值渐变坐标」这三类真机必抛的错误，在两套校验里**都是隐形的**。
 *   而 game_core.loop() 里 requestAnimationFrame 写在 draw() 之后 ——
 *   只要 draw() 抛一次，主循环就永久断链（画面定格在最后一帧），
 *   表现正好是用户说的「整个界面无法点击」。
 *
 * 另外：verify.js 每个场景只画 3 帧，animate 到后期才越界的数值（缩小中的光圈等）照样漏。
 *       本脚本会跑长时间的真实帧循环（update + draw 交替数千帧）。
 *
 * 输出：.workbuddy/tmp/_police.txt
 */
'use strict';
const fs = require('fs');
const path = require('path');
const HH = require('./harness');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src');
const TMP = path.join(ROOT, '.workbuddy', 'tmp');
const OUT = path.join(TMP, '_police.txt');

const L = [];
let BAD = 0;
function log(s) { L.push(s); }

const RES = [
  [320, 568], [360, 640], [375, 667], [375, 812],
  [390, 844], [414, 896], [428, 926], [768, 1024],
];

// ==================== 严格 ctx 包装 ====================
/**
 * 按 HTML Canvas 2D 规范，把"会抛异常"的入参校验一遍。
 * 规范要点（与"静默忽略"区分开 —— 只有这些是真会 throw 的）：
 *   arc/ellipse/arcTo/roundRect 的半径或圆角为负  → IndexSizeError / RangeError
 *   setLineDash 含负数                            → IndexSizeError
 *   setLineDash 含非有限值                        → TypeError
 *   createLinearGradient 坐标非有限               → TypeError
 *   createRadialGradient 半径负 → IndexSizeError；坐标/半径非有限 → TypeError
 *   变换类(translate/scale/rotate/transform)非有限 → 规范是"静默返回"，不算错
 */
function installPolice(ctx, violations, tag) {
  const fin = (v) => typeof v === 'number' && isFinite(v);
  const nums = (a, n) => { for (let i = 0; i < n; i++) if (!fin(a[i])) return false; return true; };

  function report(method, args, reason) {
    BAD++;
    violations.push({ tag, method, args: Array.prototype.slice.call(args), reason });
  }

  const origArc = ctx.arc;
  ctx.arc = function (x, y, r, sa, ea, ccw) {
    if (fin(r) && r < 0) report('arc', arguments, '半径 r=' + r + ' < 0 → IndexSizeError');
    return origArc.call(ctx, x, y, r, sa, ea, ccw);
  };

  const origEllipse = ctx.ellipse;
  ctx.ellipse = function (x, y, rx, ry, rot, sa, ea, ccw) {
    if (fin(rx) && rx < 0) report('ellipse', arguments, 'rx=' + rx + ' < 0 → IndexSizeError');
    if (fin(ry) && ry < 0) report('ellipse', arguments, 'ry=' + ry + ' < 0 → IndexSizeError');
    return origEllipse.call(ctx, x, y, rx, ry, rot, sa, ea, ccw);
  };

  const origArcTo = ctx.arcTo;
  ctx.arcTo = function (x1, y1, x2, y2, r) {
    if (fin(r) && r < 0) report('arcTo', arguments, 'r=' + r + ' < 0 → IndexSizeError');
    return origArcTo.call(ctx, x1, y1, x2, y2, r);
  };

  const origRoundRect = ctx.roundRect;
  ctx.roundRect = function (x, y, w, h, r) {
    let radii = [];
    if (typeof r === 'number') radii = [r];
    else if (Array.isArray(r)) radii = r;
    else if (r && typeof r === 'object') radii = [r.topLeft, r.topRight, r.bottomRight, r.bottomLeft];
    for (const v of radii) {
      if (fin(v) && v < 0) report('roundRect', arguments, '圆角 radius=' + v + ' < 0 → RangeError');
    }
    return origRoundRect.call(ctx, x, y, w, h, r);
  };

  const origSetLineDash = ctx.setLineDash;
  ctx.setLineDash = function (arr) {
    const a = arr || [];
    for (const v of a) {
      if (!fin(v)) report('setLineDash', arguments, '含非有限值 ' + v + ' → TypeError');
      else if (v < 0) report('setLineDash', arguments, '含负值 ' + v + ' → IndexSizeError');
    }
    return origSetLineDash.call(ctx, arr);
  };

  const origLin = ctx.createLinearGradient;
  ctx.createLinearGradient = function (x0, y0, x1, y1) {
    if (!nums(arguments, 4)) report('createLinearGradient', arguments, '坐标非有限值 → TypeError');
    return origLin.call(ctx, x0, y0, x1, y1);
  };

  const origRad = ctx.createRadialGradient;
  ctx.createRadialGradient = function (x0, y0, r0, x1, y1, r1) {
    if (!nums(arguments, 6)) report('createRadialGradient', arguments, '参数非有限值 → TypeError');
    if (fin(r0) && r0 < 0) report('createRadialGradient', arguments, 'r0=' + r0 + ' < 0 → IndexSizeError');
    if (fin(r1) && r1 < 0) report('createRadialGradient', arguments, 'r1=' + r1 + ' < 0 → IndexSizeError');
    return origRad.call(ctx, x0, y0, r0, x1, y1, r1);
  };

  return ctx;
}

// ==================== 环境 ====================
function clearCache() {
  Object.keys(require.cache).forEach((k) => { if (k.indexOf(SRC) === 0) delete require.cache[k]; });
}

let CUR = {};
const ALL_MODULES = ['theme', 'config', 'meta', 'eventBus', 'units', 'geometry', 'enemy',
  'tower', 'wave', 'bonusStats', 'auraManager', 'renderer', 'input', 'shop', 'nav',
  'codex', 'talents', 'levels', 'gamemenu', 'enhance', 'game_core'];

function freshGame(W, H, violations) {
  clearCache();
  const env = HH.setupGlobals(W, H);
  const holder = { ops: [] };
  const ctx = HH.makeCtx(env.canvas, holder);
  installPolice(ctx, violations, W + 'x' + H);
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

// ==================== 场景 ====================
const cfg = require(path.join(SRC, 'config.js'));

function buildScene(g, kind) {
  if (kind === 'battle-ready') { g.scene = 'battle'; g.battleStarted = false; }
  else if (kind === 'battle-ready-scrolled') { g.scene = 'battle'; g.battleStarted = false; g.levelScroll = 0; }
  else if (kind === 'battle-run') {
    g.scene = 'battle'; g.startBattle();
    if (g.slots[0]) g.towers.push(CUR.tower.createTower('triangle', g.slots[0].x, g.slots[0].y));
    if (g.slots[1]) g.towers.push(CUR.tower.createTower('circle', g.slots[1].x, g.slots[1].y));
    g.gold = 5000;
    for (let i = 0; i < 300; i++) g.update(1 / 30);
  } else if (kind === 'battle-menu') { buildScene(g, 'battle-run'); g.openMenu(); }
  else if (kind === 'battle-panel') {
    buildScene(g, 'battle-run');
    if (g.towers[0]) {
      g.towers[0].stage = cfg.MAX_STAGE;
      g.towers[0].attackPowerBoost = CUR.tower.getAttackPowerBoost(g.towers[0].stage);
      g.towers[0].enhanceLevel = 2;
      CUR.tower.applyEnhanceAttrs(g.towers[0]);
      g.showPanel = true; g.selectedTower = g.towers[0]; g.panelTowerType = g.towers[0].type;
    }
  } else if (kind === 'battle-panel-locked') {
    buildScene(g, 'battle-run');
    if (g.towers[0]) {
      g.towers[0].stage = 0; g.towers[0].attackPowerBoost = 0; g.towers[0].enhanceLevel = 0;
      g.showPanel = true; g.selectedTower = g.towers[0]; g.panelTowerType = g.towers[0].type;
    }
  } else if (kind === 'enhance-picker') {
    buildScene(g, 'battle-panel');
    if (g.selectedTower) g.enhancePicker = { tower: g.selectedTower };
  } else if (kind === 'codex') { g.scene = 'codex'; g.codexSelected = null; }
  else if (kind === 'codex-sheet') { g.scene = 'codex'; g.codexSelected = 'triangle'; }
  else if (kind === 'codex-sheet-tall') { g.scene = 'codex'; g.codexSelected = 'trapezoid'; }
  else if (kind === 'codex-scrolled') { g.scene = 'codex'; g.codexSelected = 'triangle'; g.codexScroll = 1e9; }
  else if (kind === 'talents') { g.scene = 'talents'; g.talentScroll = 0; }
  else if (kind === 'gameover') { buildScene(g, 'battle-run'); g.gameOver = true; g.gameWon = false; }
  else if (kind === 'gameover-win') { buildScene(g, 'battle-run'); g.gameOver = true; g.gameWon = true; }
  else if (kind === 'watching-video') { buildScene(g, 'battle-run'); g.gameOver = true; g.watchingVideo = true; }
  else if (kind === 'drag-shop') {
    buildScene(g, 'battle-run');
    g.dragging = true; g.dragFromShop = true; g.dragType = 'circle'; g.dragShopIdx = 0;
    g.dragX = 100; g.dragY = 300;
  } else if (kind === 'drag-slot') {
    buildScene(g, 'battle-run');
    g.dragging = true; g.dragFromShop = false; g.draggingFromSlot = g.slots[0];
    g.dragType = 'triangle'; g.dragX = 100; g.dragY = 300;
  }
  return g;
}

const SCENES = ['battle-ready', 'battle-ready-scrolled', 'battle-run', 'battle-menu',
  'battle-panel', 'battle-panel-locked', 'enhance-picker', 'codex', 'codex-sheet',
  'codex-sheet-tall', 'codex-scrolled', 'talents', 'gameover', 'gameover-win',
  'watching-video', 'drag-shop', 'drag-slot'];

log('=== 1. 静态场景 × 8 分辨率 × 5 帧：真机 canvas 参数合规 ===');
{
  const violations = [];
  let errs = [];
  for (const [W, H] of RES) {
    const g = freshGame(W, H, violations);
    for (const sc of SCENES) {
      try {
        buildScene(g, sc);
        for (let i = 0; i < 5; i++) frame(g);
      } catch (e) {
        errs.push(`${W}x${H} ${sc}: ${e.message}`);
      }
    }
  }
  log(`  渲染异常：${errs.length} 条` + (errs.length ? '\n    ' + errs.slice(0, 8).join('\n    ') : ''));
  log(`  非法 canvas 参数：${violations.length} 条`);
  for (const v of violations.slice(0, 30)) {
    log(`    [${v.tag}] ctx.${v.method}(${v.args.join(', ')})  —— ${v.reason}`);
  }
}

log('');
log('=== 2. 长时间真实帧循环（update + draw 交替），把"跑一会儿才越界"的值逼出来 ===');
{
  const violations = [];
  const errs = [];
  const REPORT = { frames: 0, exceptions: 0 };
  for (const [W, H] of RES) {
    const g = freshGame(W, H, violations);
    try {
      g.startBattle();
      g.gold = 999999;
      // 造满各种塔（含会做动画的圆塔爆炸 / 半圆激光 / 扇塔扫描 / 辅助塔光环）
      const types = cfg.TOWER_ORDER.slice();
      for (let i = 0; i < types.length && i < g.slots.length; i++) {
        const tw = CUR.tower.createTower(types[i], g.slots[i].x, g.slots[i].y);
        g.slots[i].tower = tw; g.slots[i].occupied = true;
        g.towers.push(tw);
      }
      // 跑 4000 帧（≈133 秒游戏时间，覆盖开局等待 / 多波刷怪 / 各种爆炸与死亡）
      for (let i = 0; i < 4000; i++) {
        g.update(1 / 30);
        frame(g);
        REPORT.frames++;
        // 中途切场景再切回来，覆盖"切走冻结 → 切回继续"的路径
        if (i === 1200) { g.switchScene('codex'); frame(g); frame(g); }
        if (i === 1210) { g.switchScene('talents'); frame(g); }
        if (i === 1220) { g.switchScene('battle'); frame(g); }
        if (i === 2000) { g.openMenu(); frame(g); g.closeMenu(); }
        if (i === 2500) { g.showPanel = true; g.selectedTower = g.towers[0]; g.panelTowerType = g.towers[0].type; frame(g); }
        if (i === 2520) { g.enhancePicker = { tower: g.towers[0] }; frame(g); g.enhancePicker = null; }
        if (i === 3000) { g.gameOver = true; g.isRunning = false; frame(g); }
        if (i === 3010) { g.gameOver = false; g.isRunning = true; }
      }
    } catch (e) {
      REPORT.exceptions++;
      errs.push(`${W}x${H} @frame${REPORT.frames}: ${e.message}\n      ${(e.stack || '').split('\n')[1] || ''}`);
    }
  }
  log(`  共 ${REPORT.frames} 帧，异常 ${REPORT.exceptions} 次`);
  for (const e of errs) log('    ' + e);
  log(`  非法 canvas 参数：${violations.length} 条`);
  for (const v of violations.slice(0, 40)) {
    log(`    [${v.tag}] ctx.${v.method}(${v.args.join(', ')})  —— ${v.reason}`);
  }
}

log('');
log('=== 3. 专项：缩小/扩散类动画的半径边界（逐一强制到极端相位） ===');
{
  const violations = [];
  const g = freshGame(390, 844, violations);
  g.startBattle();
  g.gold = 999999;
  // 手动往 effects / projectiles 里塞各种动画对象，并把生命周期推到末尾
  const push = [
    { type: 'explosion', x: 100, y: 300, radius: 0, maxRadius: 60, color: '#4444FF', life: 0.4, maxLife: 0.4, isExplosive: true, splashDamage: 0 },
    { type: 'explosion', x: 100, y: 300, radius: 0, maxRadius: 60, color: '#4444FF', life: 0.0001, maxLife: 0.4, isExplosive: true, splashDamage: 0 },
    { type: 'laser', x1: 0, y1: 0, x2: 100, y2: 100, color: '#44FFFF', life: 0.1, maxLife: 0.1 },
    { type: 'sector', x: 100, y: 300, angle: 0, range: 200, color: '#FFFF44', life: 0.25, maxLife: 0.25 },
    { type: 'projectileHit', x: 50, y: 50, life: 0.001, maxLife: 0.3, color: '#fff' },
    { type: 'aura', x: 50, y: 50, radius: 40, life: 0.001, maxLife: 0.5, color: '#fff' },
  ];
  for (const e of push) {
    for (const lifeRatio of [1.0, 0.5, 0.01, 0.0, -0.1]) {
      e.life = e.maxLife * lifeRatio;
      g.effects.push(Object.assign({}, e));
      frame(g);
    }
  }
  // 点击特效
  for (const lifeRatio of [1.0, 0.5, 0.0, -0.5]) {
    g.clickEffect = { x: 100, y: 100, startTime: Date.now() - (1 - lifeRatio) * 500, duration: 500 };
    frame(g);
  }
  g.clickEffect = { x: 100, y: 100, startTime: NaN, duration: NaN };
  frame(g);
  log(`  非法 canvas 参数：${violations.length} 条`);
  for (const v of violations.slice(0, 40)) {
    log(`    [${v.tag}] ctx.${v.method}(${v.args.join(', ')})  —— ${v.reason}`);
  }
}

log('');
log('============================================');
log(`  非法 canvas 参数总计 ${BAD} 条`);
log('============================================');

fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(OUT, L.join('\n') + '\n', 'utf8');
console.log('BAD=' + BAD);
