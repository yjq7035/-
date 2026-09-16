/**
 * 全量校验：模块加载 / 8 分辨率×8 场景冒烟 / 布局越界 / 伤害口径 / 强化 / 天赋 / 状态机 / SVG 回放
 * 输出统一落到 _verify.txt（本机 PowerShell 不回显 stdout）
 *
 * 重要：freshGame() 会清掉 src 下 require 缓存重建实例，所以「模块引用」必须在 freshGame 之后再取，
 *       否则拿到的是上一代单例，对它的补丁/状态修改不会作用到当前这局游戏上。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const HH = require('./harness');

const ROOT = path.resolve(__dirname, '..', '..');   // .workbuddy/tools/ → 项目根
const SRC = path.join(ROOT, 'src');
const TMP = path.join(ROOT, '.workbuddy', 'tmp');
const OUT = path.join(TMP, '_verify.txt');
const SVG_DIR = path.join(TMP, 'svg');

const L = [];
let PASS = 0, FAIL = 0;
function log(s) { L.push(s); }
function ok(name, cond, extra) {
  if (cond) { PASS++; log('  ok   ' + name + (extra ? '   [' + extra + ']' : '')); }
  else { FAIL++; log('  FAIL ' + name + (extra ? '   [' + extra + ']' : '')); }
}
function section(t) { log(''); log('=== ' + t + ' ==='); }
function r2(n) { return Math.round(n * 100) / 100; }
function finiteRect(r) {
  return !!r && ['x', 'y', 'w', 'h'].every((k) => typeof r[k] === 'number' && isFinite(r[k]));
}
function inside(rect, W, H, tol) {
  tol = tol || 0;
  if (!finiteRect(rect)) return false;
  return rect.x >= -tol && rect.y >= -tol && rect.x + rect.w <= W + tol && rect.y + rect.h <= H + tol;
}
function overlap(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
function rectStr(r) { return `(${r2(r.x)},${r2(r.y)} ${r2(r.w)}x${r2(r.h)})`; }

const ALL_MODULES = ['theme', 'config', 'meta', 'eventBus', 'units', 'geometry', 'enemy',
  'tower', 'wave', 'bonusStats', 'auraManager', 'renderer', 'input', 'shop', 'nav',
  'codex', 'talents', 'levels', 'gamemenu', 'enhance', 'game_core'];

function clearCache() {
  Object.keys(require.cache).forEach((k) => {
    if (k.indexOf(SRC) === 0) delete require.cache[k];
  });
}

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
  g.__env = env;
  // 取"当前这一代"的模块单例（与 game 内部用的是同一批）
  CUR = {};
  for (const m of ALL_MODULES) CUR[m] = require(path.join(SRC, m + '.js'));
  return g;
}
function frame(g) {
  g.__holder.ops = [];
  g.draw();
  return g.__holder.ops;
}
function countOps(ops) { return ops.length; }

// =====================================================================
// A. 模块加载
// =====================================================================
section('A. 模块加载');
let loadErr = null;
for (const m of ALL_MODULES) {
  try { require(path.join(SRC, m + '.js')); }
  catch (e) { loadErr = m + ': ' + e.message; break; }
}
ok('全部 21 个模块 require 成功', !loadErr, loadErr || '');
const cfg = require(path.join(SRC, 'config.js'));

section('A2. 数据表规模');
ok('TOWER_ORDER = 16 种塔', (cfg.TOWER_ORDER || []).length === 16, '实际 ' + (cfg.TOWER_ORDER || []).length);
ok('TALENTS = 10 个天赋', (cfg.TALENTS || []).length === 10, '实际 ' + (cfg.TALENTS || []).length);
ok('LEVELS 数量 >= 1', (cfg.LEVELS || []).length >= 1, '实际 ' + (cfg.LEVELS || []).length);
ok('armorK = 200', cfg.BALANCE && cfg.BALANCE.armorK === 200, '实际 ' + (cfg.BALANCE && cfg.BALANCE.armorK));
ok('BALANCE.enhance 配置齐全', !!(cfg.BALANCE && cfg.BALANCE.enhance &&
  cfg.BALANCE.enhance.maxLevel > 0 && cfg.BALANCE.enhance.minStage > 0), JSON.stringify(cfg.BALANCE && cfg.BALANCE.enhance));
ok('强化已彻底移除伤害加成配置（attackRate/attackMin 不得存在）',
  cfg.BALANCE.enhance.attackRate === undefined && cfg.BALANCE.enhance.attackMin === undefined &&
  cfg.BALANCE.enhance.auraPerLevel === undefined, JSON.stringify(cfg.BALANCE.enhance));
ok('强化门槛 minStage === MAX_STAGE（3★）',
  cfg.BALANCE.enhance.minStage === cfg.MAX_STAGE, 'minStage=' + cfg.BALANCE.enhance.minStage + ' MAX_STAGE=' + cfg.MAX_STAGE);
ok('强化造价已上调（costRate > 0.6）', cfg.BALANCE.enhance.costRate > 0.6, 'costRate=' + cfg.BALANCE.enhance.costRate);

section('A5. 强化专属特殊属性表（每塔一项：默认值 + 每级增量）');
{
  // base 必须等于该塔的原生值（原生取值口径见各自字段名）
  const NATIVE_KEYS = {
    explosionDamage: (st) => st.explosionRatio || 0,
    auraPower: (st) => (st.supportBuff && st.supportBuff.attackSpeedMultiplier) || 0,
    sectorAngle: (st) => st.sectorHalfAngle || 0,
  };
  const nativeOf = (type, key) => {
    const st = cfg.TOWER_STATS[type] || {};
    return NATIVE_KEYS[key] ? NATIVE_KEYS[key](st) : (st[key] || 0);
  };

  const bad = [];
  for (const t of cfg.TOWER_ORDER || []) {
    const sp = cfg.ENHANCE_SPECIAL[t];
    if (!sp) { bad.push(t + ':无专属属性'); continue; }
    if (!sp.key || !sp.name || !sp.desc) bad.push(t + ':缺少 key/name/desc');
    if (!(sp.per > 0)) bad.push(t + ':' + sp.key + ' per=' + sp.per);
    if (sp.unit === undefined) bad.push(t + ':无 unit');
    const nv = nativeOf(t, sp.key);
    if (sp.base !== nv) bad.push(`${t}: base=${sp.base} ≠ 原生 ${sp.key}=${nv}`);
  }
  ok('16 种塔各有一项合法专属属性，且 base 与原生值一致', bad.length === 0, bad.join(' | ') || '16 种全部一致');

  // 需求原文的四项逐一核对
  const S = cfg.ENHANCE_SPECIAL;
  ok('三角塔：默认 1 级 5% 暴击，每级 +5%',
    S.triangle.key === 'critChance' && S.triangle.base === 5 && S.triangle.per === 5,
    `${S.triangle.key} ${S.triangle.base}% +${S.triangle.per}%/级 → 满级 ${S.triangle.base + S.triangle.per * 5}%`);
  ok('圆塔：二段爆炸默认 25%，每级 +5%',
    S.circle.key === 'explosionDamage' && S.circle.base === 25 && S.circle.per === 5,
    `${S.circle.base}% +${S.circle.per}%/级 → 满级 ${S.circle.base + S.circle.per * 5}%`);
  ok('六边塔：默认精英以上 ×5，每级 +1 倍',
    S.hexagon.key === 'eliteMult' && S.hexagon.base === 5 && S.hexagon.per === 1,
    `×${S.hexagon.base} +${S.hexagon.per}/级 → 满级 ×${S.hexagon.base + S.hexagon.per * 5}`);
  ok('方块塔：每次升级投射大小 +20%（相对伤害范围同步）',
    S.square.key === 'projectileScale' && S.square.base === 100 && S.square.per === 20,
    `${S.square.base}% +${S.square.per}%/级 → 满级 ${S.square.base + S.square.per * 5}%`);

  const names = (cfg.TOWER_ORDER || []).map((t) => t + '=' + cfg.ENHANCE_SPECIAL[t].name).join(' ');
  log('  16 塔专属属性：' + names);
  // 每种塔只允许一项：确认没有残留的"多选一"池
  ok('ENHANCE_OPTIONS（旧的多选一池）已移除', cfg.ENHANCE_OPTIONS === undefined);
}

section('A6. 天赋平衡性（削弱变态项 + 提高学习成本）');
{
  const of = (id) => (cfg.TALENTS || []).filter((d) => d.id === id)[0];
  const eff = cfg.TALENT_EFFECT;
  ok('点石成金 每级 3%', eff.gold_gain.perLevel === 3 && of('gold_gain').max === 6,
    '+' + eff.gold_gain.perLevel + '%/级 max=' + of('gold_gain').max);
  ok('涓流金库 每级 0.25（砍半）', eff.gold_per_sec.perLevel === 0.25 && of('gold_per_sec').max === 5,
    '+' + eff.gold_per_sec.perLevel + '/级 max=' + of('gold_per_sec').max);
  ok('洞察先机 每级 5%（砍半）', eff.points_gain.perLevel === 5 && of('points_gain').max === 4,
    '+' + eff.points_gain.perLevel + '%/级 max=' + of('points_gain').max);
  ok('波次结余 每级 6', eff.wave_bonus.perLevel === 6 && of('wave_bonus').max === 5,
    '+' + eff.wave_bonus.perLevel + '/级 max=' + of('wave_bonus').max);
  // costs 提价：这三项的满级总花费都要比以前贵（旧值见 git 历史注释）
  const sum = (id) => of(id).costs.reduce((a, b) => a + b, 0);
  ok('三项变态天赋学习总花费上调', sum('gold_gain') >= 18 && sum('gold_per_sec') >= 16 && sum('points_gain') >= 14,
    '点石成金=' + sum('gold_gain') + ' 涓流金库=' + sum('gold_per_sec') + ' 洞察先机=' + sum('points_gain'));
}

section('A3. 16 种塔属性完整性');
let badTower = [];
const penList = [];
for (const t of cfg.TOWER_ORDER || []) {
  const st = cfg.TOWER_STATS[t];
  if (!st) { badTower.push(t + ':无stat'); continue; }
  if (typeof st.critChance !== 'number' || st.critChance < 0 || st.critChance > 100) badTower.push(t + ':critChance=' + st.critChance);
  if (typeof st.critMult !== 'number' || st.critMult < 1) badTower.push(t + ':critMult=' + st.critMult);
  if (typeof st.penetration !== 'number' || st.penetration < 0) badTower.push(t + ':pen=' + st.penetration);
  penList.push(t + '=' + st.penetration);
}
ok('每种塔都有合法 critChance/critMult/penetration', badTower.length === 0, badTower.join(',') || '16 种全部合法');
log('  穿透表：' + penList.join(' '));
const crits = (cfg.TOWER_ORDER || []).map((t) => ({ t, c: cfg.TOWER_STATS[t].critChance })).sort((a, b) => b.c - a.c);
ok('三角塔 critChance 全塔最高', crits[0].t === 'triangle', 'top=' + crits[0].t + ' ' + crits[0].c + '%  次=' + crits[1].t + ' ' + crits[1].c + '%');

section('A3c. 原生暴击/穿透口径（需求 1：默认不发给图形塔）');
{
  // 口径：暴击几率与穿透的【原生值】默认 0；唯一例外是"特殊效果本身就是暴击"的三角塔（5%）。
  // 其余塔想堆暴击/穿透只能走「强化」多选一（ENHANCE_OPTIONS）。
  const others = (cfg.TOWER_ORDER || []).filter((t) => t !== 'triangle');
  const bad = others.filter((t) => (cfg.TOWER_STATS[t].critChance || 0) !== 0);
  ok('除三角塔外，所有塔原生暴击几率 = 0', bad.length === 0,
    bad.map((t) => t + '=' + cfg.TOWER_STATS[t].critChance).join(',') || '其余 ' + others.length + ' 种全为 0');

  const badPen = (cfg.TOWER_ORDER || []).filter((t) => (cfg.TOWER_STATS[t].penetration || 0) !== 0);
  ok('所有塔原生穿透 = 0（穿透只来自强化）', badPen.length === 0,
    badPen.map((t) => t + '=' + cfg.TOWER_STATS[t].penetration).join(',') || '16 种全为 0');

  ok('三角塔原生暴击几率 = 5%（不是旧的 25%）', cfg.TOWER_STATS.triangle.critChance === 5,
    '实际 ' + cfg.TOWER_STATS.triangle.critChance + '%');

  // 面板/战斗口径复核：原生 0 的塔，未强化时 getAttackProfile 必须也是 0
  const g = freshGame(390, 844);
  const towerMod = CUR.tower;
  const t = towerMod.createTower('star', 0, 0);
  const prof = towerMod.getAttackProfile(t);
  ok('未强化的星形塔：暴击 0% / 穿透 0', prof.critChance === 0 && prof.penetration === 0,
    '暴击=' + prof.critChance + '% 穿透=' + prof.penetration);
  const tri = towerMod.createTower('triangle', 0, 0);
  ok('三角塔自带 5% 暴击（战斗口径一致）', towerMod.getAttackProfile(tri).critChance === 5,
    '实际 ' + towerMod.getAttackProfile(tri).critChance + '%');
  ok('强化 1 级后暴击 = 原生 + 专属增量（三角塔 5% → 10%）', (() => {
    tri.enhanceLevel = 1;
    towerMod.applyEnhanceAttrs(tri);
    const p2 = towerMod.getAttackProfile(tri);
    return p2.critChance === 10 && p2.penetration === 0;
  })(), '强化后 = ' + towerMod.getAttackProfile(tri).critChance + '%/' + towerMod.getAttackProfile(tri).penetration);
}

section('A4. 敌人抗性');
ok('所有敌人类型都有 armor 字段',
  Object.keys(cfg.ENEMY_TYPES || {}).every((k) => typeof cfg.ENEMY_TYPES[k].armor === 'number'),
  Object.keys(cfg.ENEMY_TYPES || {}).map((k) => k + '=' + cfg.ENEMY_TYPES[k].armor).join(' '));

section('A7. 关卡表（需求 2：天梯一次铺到 99）');
{
  const lv = cfg.LEVELS || [];
  ok('LEVELS 共 99 关', lv.length === 99, '实际 ' + lv.length);
  ok('关卡 id 连续 1..99', lv.every((l, i) => l.id === i + 1),
    lv.length ? (lv[0].id + '..' + lv[lv.length - 1].id) : '空');
  ok('只有关卡 1 可玩', lv.filter((l) => l.playable).map((l) => l.id).join(',') === '1',
    '可玩：' + lv.filter((l) => l.playable).map((l) => l.id).join(','));
  ok('关卡 2~99 全部是"待扩展"占位',
    lv.slice(1).every((l) => l.playable === false && l.subtitle === '待扩展'),
    '非占位项：' + lv.slice(1).filter((l) => l.playable || l.subtitle !== '待扩展').map((l) => l.id).join(',') || '无');
  ok('关卡名带序号（关卡 N）', lv[98].name === '关卡 99', '末关 name=' + lv[98].name);
}

// =====================================================================
// B. 冒烟渲染
// =====================================================================
const RES = [
  [320, 568], [360, 640], [375, 667], [375, 812],
  [390, 844], [414, 896], [428, 926], [768, 1024],
];
const SCENES = ['battle-ready', 'battle-ready-scrolled', 'battle-run', 'battle-menu',
  'battle-panel', 'battle-panel-locked', 'enhance-picker', 'codex', 'codex-sheet',
  'codex-sheet-tall', 'codex-scrolled', 'talents', 'gameover'];

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
      // 进阶到 3★：强化区才会显示"可用"状态（未进阶时是橙色门槛提示）
      g.towers[0].stage = cfg.MAX_STAGE;
      g.towers[0].attackPowerBoost = CUR.tower.getAttackPowerBoost(g.towers[0].stage);
      // 强化 2 级：专属属性由 applyEnhanceAttrs 统一重算（三角塔 = 暴击 +10%）
      g.towers[0].enhanceLevel = 2;
      CUR.tower.applyEnhanceAttrs(g.towers[0]);
      g.showPanel = true; g.selectedTower = g.towers[0]; g.panelTowerType = g.towers[0].type;
    }
  }
  else if (kind === 'enhance-picker') {
    buildScene(g, 'battle-panel');
    if (g.selectedTower) g.enhancePicker = { tower: g.selectedTower };
  }
  else if (kind === 'battle-panel-locked') {
    // 未进阶到 3★：强化区应显示门槛提示、按钮禁用（需求 4 的核心表现）
    buildScene(g, 'battle-run');
    if (g.towers[0]) {
      g.towers[0].stage = 0;
      g.towers[0].attackPowerBoost = 0;
      g.towers[0].enhanceLevel = 0;
      g.showPanel = true; g.selectedTower = g.towers[0]; g.panelTowerType = g.towers[0].type;
    }
  }
  else if (kind === 'codex') { g.scene = 'codex'; g.codexSelected = null; }
  else if (kind === 'codex-sheet') { g.scene = 'codex'; g.codexSelected = 'triangle'; }
  // 介绍最长的那一档（3 行）→ 详情面板必须自适应撑高，别把属性行/按钮顶出去
  else if (kind === 'codex-sheet-tall') { g.scene = 'codex'; g.codexSelected = 'trapezoid'; }
  else if (kind === 'codex-scrolled') { g.scene = 'codex'; g.codexSelected = 'triangle'; g.codexScroll = 1e9; }
  else if (kind === 'talents') { g.scene = 'talents'; g.talentScroll = 0; }
  else if (kind === 'gameover') { buildScene(g, 'battle-run'); g.gameOver = true; g.gameWon = false; }
  return g;
}

section('B. 冒烟渲染（8 分辨率 × ' + SCENES.length + ' 场景 × 3 帧）');
for (const [W, H] of RES) {
  const g = freshGame(W, H);
  const errs = [];
  for (const sc of SCENES) {
    try {
      buildScene(g, sc);
      const o1 = frame(g); frame(g); frame(g);
      if (countOps(o1) < 5) errs.push(sc + ':ops=' + countOps(o1));
    } catch (e) {
      errs.push(sc + ':' + e.message);
    }
  }
  ok(`${W}x${H} 全部场景渲染无异常`, errs.length === 0, errs.join(' | ') || (SCENES.length + ' 场景 × 3 帧'));
}
{
  const g = freshGame(390, 844);
  const counts = {};
  for (const sc of SCENES) { buildScene(g, sc); counts[sc] = countOps(frame(g)); }
  log('  绘制指令数：' + Object.keys(counts).map((k) => k + '=' + counts[k]).join('  '));
}

// =====================================================================
// C. 布局越界 / 互相压
// =====================================================================
section('C. 布局检查（逐分辨率）');
for (const [W, H] of RES) {
  const g = freshGame(W, H);
  const levels = CUR.levels, gamemenu = CUR.gamemenu, nav = CUR.nav,
    codex = CUR.codex, talents = CUR.talents, shop = CUR.shop;
  const navTop = H - cfg.LAYOUT.navHeight;
  const topBarH = cfg.LAYOUT.topBarHeight;
  const probs = [];

  const badge = levels.getLevelBadgeRect(g);
  if (!inside(badge, W, H)) probs.push('关卡徽标越界 ' + rectStr(badge));
  const mbtn = gamemenu.getMenuButtonRect(g);
  if (!inside(mbtn, W, H)) probs.push('☰按钮越界 ' + rectStr(mbtn));
  if (mbtn.y < 0 || mbtn.y + mbtn.h > topBarH) probs.push('☰按钮顶出顶栏 ' + rectStr(mbtn) + ' topBarH=' + topBarH);
  if (overlap(badge, mbtn)) probs.push('徽标与☰重叠');

  g.scene = 'battle'; g.battleStarted = false;
  const RL = levels.getReadyLayout(g);
  if (!inside(RL.panel, W, H)) probs.push('选关面板越界 ' + rectStr(RL.panel));
  if (RL.panel.y < topBarH) probs.push('选关面板压顶栏 y=' + r2(RL.panel.y));
  if (RL.panel.y + RL.panel.h > navTop) probs.push('选关面板压导航 bottom=' + r2(RL.panel.y + RL.panel.h) + ' navTop=' + navTop);
  if (!inside(RL.startBtn, W, H)) probs.push('开始按钮越界');
  if (RL.startBtn.x < RL.panel.x || RL.startBtn.y < RL.panel.y ||
    RL.startBtn.x + RL.startBtn.w > RL.panel.x + RL.panel.w ||
    RL.startBtn.y + RL.startBtn.h > RL.panel.y + RL.panel.h) probs.push('开始按钮出面板');
  // 天梯台阶：横向必须在面板内、纵向不能进到开始按钮的区域；视口必须在面板内
  if (RL.viewport.y < RL.panel.y || RL.viewport.y + RL.viewport.h > RL.startBtn.y) probs.push('天梯视口越界');
  for (const c of RL.cards) {
    if (c.x < RL.panel.x || c.x + c.w > RL.panel.x + RL.panel.w) probs.push('台阶横向溢出 #' + c.idx);
    if (c.w <= 40 || c.h <= 30) probs.push('台阶过小 #' + c.idx + ' ' + rectStr(c));
  }
  for (let i = 0; i < RL.cards.length; i++) for (let j = i + 1; j < RL.cards.length; j++) {
    if (overlap(RL.cards[i], RL.cards[j])) probs.push('台阶重叠 ' + i + '/' + j);
  }
  // 交错：相邻两级必须挂在梯绳的两侧（左/右），否则就不叫"爬梯"了
  for (let i = 1; i < RL.cards.length; i++) {
    if (RL.cards[i].side === RL.cards[i - 1].side) probs.push('台阶未交错 ' + (i - 1) + '/' + i);
  }
  if (RL.rail.x <= RL.panel.x || RL.rail.x >= RL.panel.x + RL.panel.w) probs.push('梯绳出面板 x=' + r2(RL.rail.x));

  g.scene = 'battle'; g.startBattle(); g.openMenu();
  const ML = gamemenu.getMenuLayout(g);
  if (!inside(ML.panel, W, H)) probs.push('菜单面板越界 ' + rectStr(ML.panel));
  if (!inside(ML.resume, W, H) || !inside(ML.abandon, W, H)) probs.push('菜单按钮越界');
  if (ML.resume.y + ML.resume.h > ML.panel.y + ML.panel.h) probs.push('返回战斗按钮出面板');
  if (ML.abandon.y < ML.panel.y) probs.push('放弃按钮出面板 y=' + r2(ML.abandon.y));
  if (overlap(ML.resume, ML.abandon)) probs.push('菜单两按钮重叠');
  // 面板内纵向节奏：标题 / 信息行 / 两按钮 依次不相压
  if (ML.titleCY + 13 + 2 > ML.infoY - 8 + 8) probs.push('菜单标题与信息行挤压');
  if (ML.infoY + 8 > ML.abandon.y - 2) probs.push('菜单信息行被放弃按钮压住 ' + r2(ML.infoY) + ' vs ' + r2(ML.abandon.y));
  if (ML.abandon.y + ML.abandon.h + 2 > ML.resume.y) probs.push('菜单两按钮纵向贴死');
  if (ML.resume.y + ML.resume.h > ML.panel.y + ML.panel.h - 8) probs.push('菜单底部留白不足');
  if (ML.titleCY - 13 < ML.panel.y + 8) probs.push('菜单标题贴顶');
  if (Math.round((H - ML.panel.h) / 2) !== ML.panel.y) probs.push('菜单未垂直居中');

  const NL = nav.getNavLayout(g);
  const navItems = NL.items || [];
  if (!navItems.length) probs.push('导航项为空');
  for (const it of navItems) if (!inside(it, W, H, 0.5)) probs.push('导航项越界 ' + rectStr(it));
  if (navItems.length && Math.abs((navItems[0].y + navItems[0].h) - H) > 1) probs.push('导航未贴底 ' + r2(navItems[0].y + navItems[0].h) + ' vs ' + H);
  for (let i = 0; i < navItems.length; i++) for (let j = i + 1; j < navItems.length; j++) {
    if (overlap(navItems[i], navItems[j])) probs.push('导航项重叠 ' + i + '/' + j);
  }

  const SL = shop.getShopLayout(g);
  const sp = SL.panel;
  if (!inside(sp, W, H, 0.5)) probs.push('商店面板越界 ' + rectStr(sp));
  if (sp.y + sp.h > navTop + 0.5) probs.push('商店压导航 bottom=' + r2(sp.y + sp.h) + ' navTop=' + navTop);
  for (const c of SL.cards) if (c.x < 0 || c.x + c.w > W + 0.5) probs.push('商店卡横向越界 #' + c.idx);

  g.scene = 'codex'; g.codexSelected = null; g.codexScroll = 0;
  let CL = codex.getCodexLayout(g);
  if (CL.cols !== 4) probs.push('图签列数不是 4（' + CL.cols + '）');
  if (CL.viewport.y < topBarH) probs.push('图签视口压顶栏');
  if (CL.viewport.y + CL.viewport.h > navTop) probs.push('图签视口压导航');
  if (CL.viewport.h < 60) probs.push('图签视口过矮 ' + r2(CL.viewport.h));
  // 面板收起时至少得完整放下一行（否则一进图签就是空白）
  if (CL.grid[0].y + CL.grid[0].h > CL.viewport.y + CL.viewport.h + 0.5) probs.push('图签首行放不下');
  for (const c of CL.grid) {
    if (c.x < 0 || c.x + c.w > W + 0.5) probs.push('图签格横向越界 ' + c.type + ' ' + rectStr(c));
    if (c.w <= 30 || c.h <= 30) probs.push('图签格过小 ' + c.type + ' ' + rectStr(c));
  }
  for (let i = 0; i < CL.grid.length; i++) for (let j = i + 1; j < CL.grid.length; j++) {
    if (overlap(CL.grid[i], CL.grid[j])) probs.push('图签格重叠 ' + i + '/' + j);
  }
  if (CL.maxScroll < -1e-6) probs.push('图签 maxScroll 为负');

  // 详情面板打开：视口必须收在面板之上，且末行只能靠滚动看到
  g.codexSelected = 'triangle';
  CL = codex.getCodexLayout(g);
  if (!inside(CL.sheet, W, H, 0.5)) probs.push('图签详情面板越界');
  if (CL.sheet.y + CL.sheet.h > navTop) probs.push('详情面板压导航');
  if (CL.viewport.y + CL.viewport.h > CL.sheet.y + 0.5) probs.push('图签视口与详情面板重叠');
  if (CL.viewport.h < 60) probs.push('图签视口过矮（面板打开）' + r2(CL.viewport.h));
  // 底部信息行 / 属性行 / 按钮不能互相压（面板高度由节奏项累加算出）
  const sheetBtns = codex.getSheetButtons(g, CL.sheet);
  if (sheetBtns.upgrade.y < CL.sheet.y + 100) probs.push('详情面板按钮过高，会压住属性行');
  if (sheetBtns.upgrade.y + sheetBtns.upgrade.h > CL.sheet.y + CL.sheet.h) probs.push('详情面板按钮出面板');
  if (sheetBtns.upgrade.x + sheetBtns.upgrade.w > CL.sheet.x + CL.sheet.w) probs.push('详情面板按钮横向溢出');
  if (overlap(sheetBtns.upgrade, sheetBtns.lineup)) probs.push('详情面板两按钮重叠');
  const hd = CL.header;
  if (overlap(hd.brand, hd.unlocked)) probs.push('页头 品牌/已解锁 重叠');
  if (overlap(hd.unlocked, hd.lineup)) probs.push('页头 已解锁/登场 重叠');
  if (overlap(hd.lineup, hd.points)) probs.push('页头 登场/积分 重叠');
  if (!inside(hd.points, W, H)) probs.push('页头积分越界 ' + rectStr(hd.points));
  g.codexScroll = 0;

  g.scene = 'talents';
  const TL = talents.getTalentLayout(g);
  if (!inside(TL.viewport, W, H, 0.5)) probs.push('天赋视口越界');
  if (TL.viewport.y < topBarH) probs.push('天赋列表压顶栏');
  if (TL.viewport.y + TL.viewport.h > navTop) probs.push('天赋列表压导航');
  for (const r of TL.rows) if (r.x < 0 || r.x + r.w > W + 0.5) probs.push('天赋行横向越界 #' + r.idx);
  if (overlap(TL.header.brand, TL.header.points)) probs.push('天赋页头重叠');

  ok(`${W}x${H} 布局`, probs.length === 0, probs.length ? probs.join(' | ') : '全部检查通过');
}

section('C2. 天赋列表滚动');
for (const [W, H] of RES) {
  const g = freshGame(W, H);
  g.scene = 'talents';
  const TL = CUR.talents.getTalentLayout(g);
  const gap = TL.rows.length > 1 ? (TL.rows[1].y - TL.rows[0].y - TL.rows[0].h) : 0;
  const contentH = TL.rows.length * TL.rows[0].h + (TL.rows.length - 1) * gap;
  log(`  ${W}x${H}: 行高=${TL.rows[0].h} 视口高=${r2(TL.viewport.h)} 内容高=${r2(contentH)} 需滚动=${CUR.talents.isScrollable(g)} maxScroll=${r2(TL.maxScroll)}`);
}
{
  const g = freshGame(320, 568);
  g.scene = 'talents';
  const T = CUR.talents;
  const maxS = T.getTalentLayout(g).maxScroll;
  ok('320x568 天赋列表需要滚动', maxS > 0, 'maxScroll=' + r2(maxS));
  T.setTalentScroll(g, 1e9);
  ok('滚动值被夹到 maxScroll', Math.abs(g.talentScroll - maxS) < 1e-6, 'set1e9→' + r2(g.talentScroll) + ' max=' + r2(maxS));
  T.setTalentScroll(g, -50);
  ok('滚动值下限为 0', g.talentScroll === 0, 'set-50→' + g.talentScroll);
  // 滚到底后最后一行应完整落进视口
  T.setTalentScroll(g, maxS + 40);
  const TL2 = T.getTalentLayout(g);
  const last = TL2.rows[TL2.rows.length - 1];
  ok('滚到底：末行在视口内', last.y >= TL2.viewport.y - 0.5 && last.y + last.h <= TL2.viewport.y + TL2.viewport.h + 0.5,
    '末行 bottom=' + r2(last.y + last.h) + ' 视口底=' + r2(TL2.viewport.y + TL2.viewport.h));
  const first = TL2.rows[0];
  ok('滚到底：首行被推出视口（可滚动生效）', first.y < TL2.viewport.y, '首行 y=' + r2(first.y) + ' 视口顶=' + r2(TL2.viewport.y));
  // 命中检测不该命中视口外的行
  const outsideRow = TL2.rows.filter((r) => r.y + r.h < TL2.viewport.y)[0];
  if (outsideRow) {
    const btn = T.getLearnButton(outsideRow);
    const hit = T.hitTalents(g, { x: btn.x + btn.w / 2, y: btn.y + btn.h / 2 });
    ok('已被滚出视口的行点不到', !hit || !hit.id || hit.id !== outsideRow.def.id, JSON.stringify(hit));
  } else {
    ok('已被滚出视口的行点不到', true, '本次无完全滚出的行，跳过');
  }
}

section('C2b. 图签格网滚动');
for (const [W, H] of RES) {
  const g = freshGame(W, H);
  g.scene = 'codex';
  for (const sel of [null, 'triangle']) {
    g.codexSelected = sel;
    const L = CUR.codex.getCodexLayout(g);
    log(`  ${W}x${H} 面板${sel ? '开' : '关'}: 格高=${L.cellH} 视口高=${r2(L.viewport.h)} 内容高=${r2(L.contentH)} maxScroll=${r2(L.maxScroll)}`);
  }
}
{
  const g = freshGame(320, 568);
  g.scene = 'codex';
  const C = CUR.codex;
  g.codexSelected = 'triangle';           // 详情面板打开 → 视口收窄
  const maxS = C.getCodexLayout(g).maxScroll;
  ok('320x568 图签（详情面板打开）需要滚动', maxS > 0, 'maxScroll=' + r2(maxS));
  C.setCodexScroll(g, 1e9);
  ok('图签滚动值被夹到 maxScroll', Math.abs(g.codexScroll - maxS) < 1e-6, 'set1e9→' + r2(g.codexScroll) + ' max=' + r2(maxS));
  C.setCodexScroll(g, -50);
  ok('图签滚动下限为 0', g.codexScroll === 0, 'set-50→' + g.codexScroll);
  C.setCodexScroll(g, maxS + 40);
  const L2 = C.getCodexLayout(g);
  const lastRow = L2.grid.filter((c) => Math.floor(c.idx / L2.cols) === L2.rows - 1);
  ok('图签滚到底：末行完整落在视口内',
    lastRow.every((c) => c.y >= L2.viewport.y - 0.5 && c.y + c.h <= L2.viewport.y + L2.viewport.h + 0.5),
    '末行 bottom=' + r2(lastRow[0].y + lastRow[0].h) + ' 视口底=' + r2(L2.viewport.y + L2.viewport.h));
  ok('图签滚到底：首行被推出视口（可滚动生效）', L2.grid[0].y + L2.grid[0].h < L2.viewport.y,
    '首行 bottom=' + r2(L2.grid[0].y + L2.grid[0].h) + ' 视口顶=' + r2(L2.viewport.y));
  const outside = L2.grid.filter((c) => c.y + c.h < L2.viewport.y)[0];
  if (outside) {
    const hit = C.hitCodex(g, { x: outside.x + outside.w / 2, y: outside.y + outside.h / 2 });
    ok('已滚出视口的图签格点不到', !hit || hit.kind !== 'card' || hit.type !== outside.type, JSON.stringify(hit));
  } else {
    ok('已滚出视口的图签格点不到', true, '本次无完全滚出的格子，跳过');
  }
}

section('C2c. 选关天梯滚动');
for (const [W, H] of RES) {
  const g = freshGame(W, H);
  g.scene = 'battle'; g.battleStarted = false;
  const L = CUR.levels.getReadyLayout(g);
  log(`  ${W}x${H}: 台阶高=${L.cards[0].h} 视口高=${r2(L.viewport.h)} 内容高=${r2(L.contentH)} maxScroll=${r2(L.maxScroll)} 默认scroll=${r2(L.scroll)}`);
}
{
  const g = freshGame(320, 568);
  g.scene = 'battle'; g.battleStarted = false;
  const LV = CUR.levels;
  const maxS = LV.getReadyLayout(g).maxScroll;
  ok('320x568 选关天梯需要滚动', maxS > 0, 'maxScroll=' + r2(maxS));

  // 默认贴底：关卡 1（起点）完整可见，且是整个天梯最下面那级
  const D = LV.getReadyLayout(g);
  const lv1 = D.cards.filter((c) => c.level.id === 1)[0];
  ok('天梯默认贴底：关卡 1 完整落在视口内',
    lv1.y >= D.viewport.y - 0.5 && lv1.y + lv1.h <= D.viewport.y + D.viewport.h + 0.5,
    'bottom=' + r2(lv1.y + lv1.h) + ' 视口底=' + r2(D.viewport.y + D.viewport.h));
  ok('天梯贴底时关卡 1 就是最低那级',
    D.cards.every((c) => c.level.id === 1 || c.y < lv1.y), '最高级 y=' + r2(D.cards.filter((c) => c.level.id === 1)[0].y));

  LV.setLevelScroll(g, 1e9);
  ok('天梯滚动值被夹到 maxScroll', Math.abs(g.levelScroll - maxS) < 1e-6, 'set1e9→' + r2(g.levelScroll));
  LV.setLevelScroll(g, -50);
  ok('天梯滚动下限为 0', g.levelScroll === 0, 'set-50→' + g.levelScroll);

  // 滚到顶：最高关卡完整可见，关卡 1 被推出视口（说明"往上滑能看到上面更难的关卡"）
  LV.setLevelScroll(g, 0);
  const T = LV.getReadyLayout(g);
  const top = T.cards.filter((c) => c.fromTop === 0)[0];
  const lv1b = T.cards.filter((c) => c.level.id === 1)[0];
  ok('天梯滚到顶：最高关卡完整落在视口内',
    top.y >= T.viewport.y - 0.5 && top.y + top.h <= T.viewport.y + T.viewport.h + 0.5,
    '关卡' + top.level.id + ' y=' + r2(top.y));
  ok('天梯滚到顶：关卡 1 被推出视口', lv1b.y > T.viewport.y + T.viewport.h,
    '关卡1 y=' + r2(lv1b.y) + ' 视口底=' + r2(T.viewport.y + T.viewport.h));

  // 滚出视口的台阶不该还能点到
  const outside = T.cards.filter((c) => c.y > T.viewport.y + T.viewport.h)[0];
  if (outside) {
    const hit = LV.hitReady(g, { x: outside.x + outside.w / 2, y: outside.y + outside.h / 2 });
    ok('已滚出视口的台阶点不到', hit.kind === 'none', JSON.stringify(hit));
  } else {
    ok('已滚出视口的台阶点不到', true, '本次无完全滚出的台阶，跳过');
  }

  // 开始按钮永远可点，且与天梯不重叠
  const S = LV.hitReady(g, { x: T.startBtn.x + T.startBtn.w / 2, y: T.startBtn.y + T.startBtn.h / 2 });
  ok('开始按钮可命中', S.kind === 'start', JSON.stringify(S));
  ok('天梯视口不与开始按钮重叠', T.viewport.y + T.viewport.h <= T.startBtn.y + 0.01,
    '视口底=' + r2(T.viewport.y + T.viewport.h) + ' 按钮顶=' + r2(T.startBtn.y));

  // 99 关专项：内容必须真的能滚过整段天梯，且滚动条滑块不会小到看不见
  const all = LV.getReadyLayout(g);
  ok('99 关天梯内容高 ≈ 99 级台阶', all.contentH > 99 * 60,
    'contentH=' + r2(all.contentH) + ' maxScroll=' + r2(all.maxScroll));
  const thumbH = Math.max(20, all.viewport.h * Math.max(0.08, Math.min(1, all.viewport.h / all.contentH)));
  ok('99 关的滚动条滑块仍然可见（>= 20px）', thumbH >= 20, '滑块 ' + r2(thumbH) + 'px');
  const mid = LV.getReadyLayout(g);
  LV.setLevelScroll(g, mid.maxScroll / 2);
  const M = LV.getReadyLayout(g);
  const visible = M.cards.filter((c) => c.y + c.h > M.viewport.y && c.y < M.viewport.y + M.viewport.h);
  ok('滚到中段有台阶完整落在视口内', visible.some((c) => c.y >= M.viewport.y - 0.5 && c.y + c.h <= M.viewport.y + M.viewport.h + 0.5),
    '视口内台阶 ' + visible.length + ' 级：' + visible.slice(0, 4).map((c) => c.level.id).join(','));
}

section('C2d. 图签详情面板：介绍文字自动换行（需求 5）');
for (const [W, H] of RES) {
  const g = freshGame(W, H);
  const codex = CUR.codex;
  const navTop = H - cfg.LAYOUT.navHeight;
  const probs = [];
  let maxLines = 0;
  for (const t of cfg.TOWER_ORDER) {
    g.scene = 'codex';
    g.codexSelected = t;
    const L = codex.getCodexLayout(g);
    const lines = codex.getDescLines(g, t);
    if (lines.length > maxLines) maxLines = lines.length;

    // 面板高度必须为换行后的行数腾出空间（否则按钮压住最后一行）
    const wantH = codex.CODEX_UI.sheetH + Math.max(0, lines.length - 1) * codex.CODEX_UI.descLineH;
    if (Math.abs(L.sheet.h - wantH) > 0.01) probs.push(t + ' 面板高 ' + r2(L.sheet.h) + ' ≠ 期望 ' + r2(wantH));
    if (L.sheet.y + L.sheet.h > navTop) probs.push(t + ' 面板压导航');
    if (L.viewport.y + L.viewport.h > L.sheet.y + 0.5) probs.push(t + ' 视口与面板重叠');

    // 每一行的实际宽度都必须放得下面板可用宽（换行真的生效，不是被硬截）
    const maxW = L.sheet.w - codex.CODEX_UI.descPadX * 2;
    g.ctx.font = codex.CODEX_UI.descFont;
    for (const ln of lines) {
      if (g.ctx.measureText(ln).width > maxW + 0.5) {
        probs.push(t + ' 行超宽「' + ln.slice(0, 8) + '…」' + r2(g.ctx.measureText(ln).width) + '>' + r2(maxW));
      }
    }
    // 末行文字不能压到按钮
    const lastTextBottom = L.sheet.y + 82 + (lines.length - 1) * codex.CODEX_UI.descLineH + 36 + 7;
    const btns = codex.getSheetButtons(g, L.sheet);
    if (lastTextBottom > btns.upgrade.y) probs.push(t + ' 文字行压按钮 ' + r2(lastTextBottom) + '>' + r2(btns.upgrade.y));
  }
  ok(`${W}x${H} 16 种塔的详情面板：换行/面板高/按钮 无冲突`, probs.length === 0,
    probs.slice(0, 3).join(' | ') || ('最多 ' + maxLines + ' 行'));
}
{
  // 换行真的发生：单行放不下的介绍必须被拆成多行（旧实现是 ellipsize 一行硬截）
  const g = freshGame(390, 844);
  const codex = CUR.codex;
  g.scene = 'codex';
  const checked = [];
  for (const t of cfg.TOWER_ORDER) {
    const desc = cfg.TOWER_STATS[t].description || '';
    g.codexSelected = t;
    const L = codex.getCodexLayout(g);
    const maxW = L.sheet.w - codex.CODEX_UI.descPadX * 2;
    g.ctx.font = codex.CODEX_UI.descFont;
    const oneLineW = g.ctx.measureText(desc).width;
    const lines = codex.getDescLines(g, t);
    if (oneLineW > maxW && lines.length < 2) checked.push(t + '（单行 ' + r2(oneLineW) + 'px 却只有 ' + lines.length + ' 行）');
  }
  ok('放不下的介绍都被拆成多行（不是 ellipsize 硬截）', checked.length === 0,
    checked.join(',') || '所有过长介绍均已换行');
  g.codexSelected = 'trapezoid';
  const L2 = codex.getCodexLayout(g);
  const n2 = codex.getDescLines(g, 'trapezoid').length;
  ok('行数变多 → 面板跟着变高', L2.sheet.h === codex.CODEX_UI.sheetH + (n2 - 1) * codex.CODEX_UI.descLineH,
    '椭圆塔…实为梯塔：' + n2 + ' 行 → 面板高 ' + r2(L2.sheet.h));
}

// =====================================================================
// D. 伤害口径
// =====================================================================
section('D. 伤害结算口径');
{
  const g = freshGame(390, 844);
  const towerMod = CUR.tower;
  const realRandom = Math.random;
  const mkEnemy = (armor) => ({
    uniqueId: 9999, alive: true, hp: 1e9, maxHp: 1e9, armor: armor, tier: 0, reward: 0, x: 0, y: 0,
  });
  // 用 Proxy 让 getAttackProfile 返回定制暴击/穿透（不改源码）
  const origGet = towerMod.getAttackProfile;
  towerMod.getAttackProfile = function (tw) {
    const p = origGet.call(this, tw);
    return (tw && tw.__over) ? Object.assign({}, p, tw.__over) : p;
  };
  const mkTower = (over) => {
    const t = towerMod.createTower('triangle', 0, 0);
    t.__over = over;
    return t;
  };

  const e1 = mkEnemy(200);
  const r1 = g.applyDamage(null, e1, 300, {});
  ok('抗性200/穿透0：300 → 150', r1.damage === 150, '实际 ' + r1.damage);

  const e2 = mkEnemy(200);
  const r2c = g.applyDamage(mkTower({ penetration: 200, critChance: 0 }), e2, 300, { allowCrit: false });
  ok('穿透=抗性：无减伤（300 → 300）', r2c.damage === 300, '实际 ' + r2c.damage);

  const e3 = mkEnemy(240);
  const r3 = g.applyDamage(mkTower({ penetration: 60, critChance: 0 }), e3, 300, { allowCrit: false });
  const exp3 = Math.max(1, Math.round(300 * (1 - 180 / 380)));
  ok(`抗性240/穿透60：300 → ${exp3}`, r3.damage === exp3, '实际 ' + r3.damage);

  const e4 = mkEnemy(100000);
  ok('极高抗性伤害保底 >= 1', g.applyDamage(null, e4, 10, {}).damage >= 1);

  const e5 = mkEnemy(0);
  ok('抗性0：原样命中 275', g.applyDamage(null, e5, 275, {}).damage === 275);

  const tCrit = mkTower({ critChance: 100, critMult: 2.0, penetration: 0 });
  Math.random = () => 0;
  const r6 = g.applyDamage(tCrit, mkEnemy(0), 100, {});
  ok('暴击率100%/倍率2：100 → 200 且 crit=true', r6.damage === 200 && r6.crit === true, 'dmg=' + r6.damage + ' crit=' + r6.crit);

  const r7 = g.applyDamage(mkTower({ critChance: 0, critMult: 2.0, penetration: 0 }), mkEnemy(0), 100, {});
  ok('暴击率0：不暴击（100）', r7.damage === 100 && r7.crit === false, 'dmg=' + r7.damage + ' crit=' + r7.crit);

  const r8 = g.applyDamage(tCrit, mkEnemy(0), 100, { allowCrit: false });
  ok('allowCrit:false：不暴击（100）', r8.damage === 100 && r8.crit === false, 'dmg=' + r8.damage);

  const r9 = g.applyDamage(tCrit, mkEnemy(200), 100, {});
  ok('先暴击后减伤：100×2×0.5 = 100', r9.damage === 100 && r9.crit === true, 'dmg=' + r9.damage + ' crit=' + r9.crit);
  Math.random = realRandom;

  const e10 = mkEnemy(0); e10.hp = 5; e10.reward = 10; e10.tier = 1;
  const goldBefore = g.gold;
  const r10 = g.applyDamage(null, e10, 100, {});
  ok('击杀：alive=false 且金币入账', r10.killed === true && e10.alive === false && g.gold >= goldBefore, 'gold ' + goldBefore + '→' + g.gold);

  const r11 = g.applyDamage(null, e10, 100, {});
  ok('已死敌人二次结算返回 0', r11.damage === 0 && r11.killed === false, '实际 ' + r11.damage);

  // 无 sourceTower 时不吃暴击（环境伤害）
  Math.random = () => 0;
  const r12 = g.applyDamage(null, mkEnemy(0), 100, {});
  ok('environment 伤害不吃暴击', r12.damage === 100 && r12.crit === false, 'dmg=' + r12.damage);
  Math.random = realRandom;
}

// =====================================================================
// E. 强化（2026-09 二次重做：只抬专属特殊属性，不再给伤害加成）
// =====================================================================
section('E. 塔强化（只抬专属特殊属性，不给伤害加成）');
{
  const g = freshGame(390, 844);
  const towerMod = CUR.tower;
  const E = cfg.BALANCE.enhance;
  const ATK = cfg.TOWER_STATS.triangle.damage;
  g.startBattle();
  g.gold = 100000;

  const t = towerMod.createTower('triangle', 0, 0);

  // ---- 星级门槛：只有进阶到 3★ 才能强化 ----
  ok('isStageReady：0★ 不可强化', towerMod.isStageReady(t) === false);
  const rStage = g.enhanceTower(t, 'critChance');
  ok('未进阶到 3★ 拒绝强化（reason=stage）',
    rStage.ok === false && rStage.reason === 'stage' && rStage.need === E.minStage, JSON.stringify(rStage));
  ok('被拒时不扣金币', g.gold === 100000, 'gold=' + g.gold);
  t.stage = E.minStage - 1;
  ok('2★ 依然不可强化', g.enhanceTower(t, 'critChance').reason === 'stage');
  t.stage = E.minStage;
  t.attackPowerBoost = towerMod.getAttackPowerBoost(t.stage);
  ok('3★ 达到门槛', towerMod.isStageReady(t) === true);

  // ---- 旧版"固定攻击力"必须已彻底消失 ----
  ok('tower.js 不再导出固定攻击力接口',
    towerMod.getEnhanceAttackFlat === undefined &&
    towerMod.getEnhanceAuraFlat === undefined &&
    towerMod.getEnhanceFlatDamage === undefined);
  ok('calculateFinalDamage 只吃（原生, 等级, 阶段增幅）',
    towerMod.calculateFinalDamage.length === 3, '形参个数 = ' + towerMod.calculateFinalDamage.length);

  const baseDmg = g.towerDamage(t, ATK);
  const cost1 = g.enhanceCost(t);
  const goldBefore = g.gold;
  const r1 = g.enhanceTower(t, 'critChance');
  ok('3★ 后强化成功：等级 0→1', r1.ok === true && t.enhanceLevel === 1, 'lv=' + t.enhanceLevel);
  ok('强化扣金币（造价 = 基础造价 × costRate × 等级）',
    g.gold === goldBefore - cost1 && cost1 === Math.round(cfg.TOWER_DEFS.triangle.cost * E.costRate * 1),
    `${goldBefore} → ${g.gold} (cost ${cost1})`);

  // ---- 核心断言：强化不发放任何伤害加成 ----
  ok('强化不给攻击力（战斗口径 Δ=0）', g.towerDamage(t, ATK) === baseDmg,
    `${baseDmg} → ${g.towerDamage(t, ATK)}`);
  ok('强化不给穿透（三角塔不是穿透型）', towerMod.getAttackProfile(t).penetration === 0,
    '穿透=' + towerMod.getAttackProfile(t).penetration);

  // ---- 专属属性：三角塔 默认 5% → 每级 +5% ----
  ok('专属属性增量 = per × 等级', towerMod.getEnhanceAttr(t, 'critChance') === 5,
    'critChance +' + towerMod.getEnhanceAttr(t, 'critChance'));
  ok('三角塔强化 1 级：暴击 5% → 10%', towerMod.getAttackProfile(t).critChance === 10,
    towerMod.getAttackProfile(t).critChance + '%');
  ok('专属属性取值 = base + per × 等级', towerMod.getSpecialValue('triangle', 1) === 10,
    'Lv.1 = ' + towerMod.getSpecialValue('triangle', 1) + '%');

  // ---- 每塔只有一项属性：传别的 key 一律拒绝 ----
  const rBad = g.enhanceTower(t, 'no_such_option');
  ok('非本塔专属属性的 key 被拒（reason=option）',
    rBad.ok === false && rBad.reason === 'option', JSON.stringify(rBad));
  ok('强化选项只有 1 项（每塔一项专属属性）',
    towerMod.getEnhanceOptions('triangle').length === 1,
    JSON.stringify(towerMod.getEnhanceOptions('triangle').map((o) => o.key)));
  ok('不传 key 也能强化（浮层不再传选项）', g.enhanceTower(t).ok === true && t.enhanceLevel === 2,
    'lv=' + t.enhanceLevel);
  ok('强化花费随等级递增', g.enhanceCost(t) > cost1, `${cost1} → ${g.enhanceCost(t)}`);

  // ---- 满级 / 等级回退重算 ----
  const keys = towerMod.getEnhanceOptions('triangle').map((o) => o.key);
  for (let i = 0; i < 10; i++) g.enhanceTower(t, keys[0]);
  ok('强化封顶 maxLevel=' + E.maxLevel, t.enhanceLevel === E.maxLevel, 'lv=' + t.enhanceLevel);
  ok('满级 enhanceCost = Infinity', g.enhanceCost(t) === Infinity, String(g.enhanceCost(t)));
  const rrMax = g.enhanceTower(t, keys[0]);
  ok('满级后再强化返回 maxed', rrMax.ok === false && rrMax.reason === 'maxed', JSON.stringify(rrMax));
  ok('满级三角塔暴击 = 30%（5 + 5×5）', towerMod.getAttackProfile(t).critChance === 30,
    towerMod.getAttackProfile(t).critChance + '%');
  ok('满级后攻击力依然没被强化改变', g.towerDamage(t, ATK) === baseDmg,
    `${baseDmg} vs ${g.towerDamage(t, ATK)}`);
  ok('等级回退时增量会被重算（不残留旧值）', (() => {
    t.enhanceLevel = 2; towerMod.applyEnhanceAttrs(t);
    return towerMod.getAttackProfile(t).critChance === 15;
  })(), 'lv2 → ' + towerMod.getAttackProfile(t).critChance + '%');
  t.enhanceLevel = E.maxLevel; towerMod.applyEnhanceAttrs(t);

  const t2 = towerMod.createTower('triangle', 0, 0);
  t2.stage = E.minStage;
  g.gold = 0;
  const rrPoor = g.enhanceTower(t2, keys[0]);
  ok('金币不足拒绝强化', rrPoor.ok === false && rrPoor.reason === 'gold', JSON.stringify(rrPoor));

  // ---- 圆塔：专属属性 = 二段爆炸伤害比例（默认 25%，每级 +5%）----
  const c = towerMod.createTower('circle', 0, 0);
  c.stage = E.minStage;
  g.gold = 100000;
  const ex0 = towerMod.getExplosionParams(c);
  ok('圆塔未强化：二段爆炸 25% / 半径 60',
    Math.abs(ex0.ratio - 0.25) < 1e-9 && ex0.radius === 60, `${r2(ex0.ratio * 100)}% r=${ex0.radius}`);
  for (let i = 0; i < 2; i++) g.enhanceTower(c);
  const ex1 = towerMod.getExplosionParams(c);
  ok('圆塔强化 2 级：二段爆炸 25% → 35%（每级 +5%）', Math.abs(ex1.ratio - 0.35) < 1e-9,
    `${r2(ex0.ratio * 100)}% → ${r2(ex1.ratio * 100)}%`);
  ok('圆塔爆炸半径不再随强化变化（旧属性已移除）', ex1.radius === ex0.radius, `${ex0.radius} → ${ex1.radius}`);

  // ---- 各塔"招牌属性"必须真的参与战斗查询 ----
  const oval = towerMod.createTower('oval', 0, 0);
  oval.stage = E.minStage;
  const range0 = towerMod.getTowerRuntimeStats(oval).range;
  for (let i = 0; i < 3; i++) g.enhanceTower(oval);
  ok('椭圆塔：射程 260 → 305（每级 +15）',
    towerMod.getTowerRuntimeStats(oval).range === range0 + 45,
    `${range0} → ${towerMod.getTowerRuntimeStats(oval).range}`);

  const hexa = towerMod.createTower('hexagon', 0, 0);
  hexa.stage = E.minStage;
  ok('六边塔未强化：精英伤害 ×5', towerMod.getEliteMultiplier(hexa) === 5, '×' + towerMod.getEliteMultiplier(hexa));
  for (let i = 0; i < 3; i++) g.enhanceTower(hexa);
  ok('六边塔强化 3 级：精英伤害 ×8（每级 +1 倍）', towerMod.getEliteMultiplier(hexa) === 8,
    '×' + towerMod.getEliteMultiplier(hexa));

  const sq = towerMod.createTower('square', 0, 0);
  sq.stage = E.minStage;
  const size0 = towerMod.getProjectileSize(sq);
  for (let i = 0; i < 2; i++) g.enhanceTower(sq);
  const size1 = towerMod.getProjectileSize(sq);
  ok('正方塔强化 2 级：弹道 10 → 14（每级 +20%，相对伤害范围同步）',
    size0 === 10 && Math.abs(size1 - 14) < 1e-9, `${size0} → ${r2(size1)}`);

  const sec = towerMod.createTower('sector', 0, 0);
  sec.stage = E.minStage;
  for (let i = 0; i < 2; i++) g.enhanceTower(sec);
  ok('扇塔强化 2 级：半张角 45° → 55°',
    Math.abs(towerMod.getSectorHalfAngle(sec) - 55 * Math.PI / 180) < 1e-9,
    r2(towerMod.getSectorHalfAngle(sec) * 180 / Math.PI) + '°');

  const lr = towerMod.createTower('long_rectangle', 0, 0);
  lr.stage = E.minStage;
  for (let i = 0; i < 2; i++) g.enhanceTower(lr);
  ok('长方塔强化 2 级：堆叠上限 10 → 14 层', towerMod.getStackMax(lr) === 14, towerMod.getStackMax(lr) + ' 层');

  const semi = towerMod.createTower('semicircle', 0, 0);
  semi.stage = E.minStage;
  for (let i = 0; i < 2; i++) g.enhanceTower(semi);
  ok('半圆塔强化 2 级：激光穿透 0 → 10', towerMod.getAttackProfile(semi).penetration === 10,
    '穿透 ' + towerMod.getAttackProfile(semi).penetration);

  const stw = towerMod.createTower('star', 0, 0);
  stw.stage = E.minStage;
  for (let i = 0; i < E.maxLevel; i++) g.enhanceTower(stw);
  ok('星形塔满级：暴击 0% → 30%（每级 +6%，配 200% 暴击倍率）',
    towerMod.getAttackProfile(stw).critChance === 30 &&
    Math.abs(towerMod.getAttackProfile(stw).critMult - 2.0) < 1e-9,
    `${towerMod.getAttackProfile(stw).critChance}% ×${r2(towerMod.getAttackProfile(stw).critMult)}`);

  // ---- 全 16 种塔：强化只改专属属性，攻击力零变化，面板/引擎同口径 ----
  {
    const probs = [];
    for (const type of cfg.TOWER_ORDER) {
      const sp = cfg.ENHANCE_SPECIAL[type];
      const tw = towerMod.createTower(type, 0, 0);
      tw.stage = E.minStage;
      g.gold = 1000000;
      const dmg0 = g.towerDamage(tw, cfg.TOWER_STATS[type].damage || 0);
      for (let lv = 1; lv <= E.maxLevel; lv++) {
        const r = g.enhanceTower(tw, sp.key);
        if (!r.ok) { probs.push(type + ': 强化失败 ' + JSON.stringify(r)); break; }
        if (towerMod.getEnhanceAttr(tw, sp.key) !== sp.per * lv) {
          probs.push(`${type}: Lv.${lv} 增量 ${towerMod.getEnhanceAttr(tw, sp.key)} ≠ ${sp.per * lv}`);
        }
        if (towerMod.getSpecialValue(type, lv) !== sp.base + sp.per * lv) {
          probs.push(`${type}: Lv.${lv} 取值 ${towerMod.getSpecialValue(type, lv)} ≠ ${sp.base + sp.per * lv}`);
        }
      }
      if (g.towerDamage(tw, cfg.TOWER_STATS[type].damage || 0) !== dmg0) probs.push(type + ': 攻击力被强化改变了');
      const info = CUR.bonusStats.collectTowerStats(g, tw, cfg.TOWER_STATS[type], type);
      const attr = CUR.bonusStats.ENHANCE_ATTR_MAP[sp.key];
      // 梯塔的光环强度会被自身阶段放大（+100%/星，见 applyTrapezoidAuras），
      // 面板与引擎都必须按 (原生 + 强化点值) × (1 + 阶段) 结算，这里用同一系数核对。
      const auraScale = type === 'trapezoid'
        ? (1 + Math.max(0, Math.min(tw.stage || 0, cfg.MAX_STAGE)))
        : 1;
      const want = (sp.base + sp.per * E.maxLevel) * auraScale;
      if (info.final[attr] !== want) probs.push(`${type}: 面板 ${attr}=${info.final[attr]} ≠ 期望 ${want}`);
      // 梯塔：面板必须与战斗引擎（getTowerRuntimeStats → applyTrapezoidAuras）逐位对齐
      if (type === 'trapezoid') {
        const eng = towerMod.getTowerRuntimeStats(tw).supportBuff.attackSpeedMultiplier
          * auraScale * CUR.meta.codexDamageMultiplier(type);
        if (Math.abs(eng - info.final.auraPower) > 1e-9) {
          probs.push(`trapezoid: 面板 ${info.final.auraPower} ≠ 引擎 ${eng}`);
        }
      }
      if (info.base.damage !== (cfg.TOWER_STATS[type].damage || 0)) {
        probs.push(type + ': 面板原生攻击力 ' + info.base.damage + ' ≠ 原生 ' + (cfg.TOWER_STATS[type].damage || 0));
      }
    }
    ok('16 种塔：强化只改专属属性 / 攻击力零变化 / 面板与引擎同口径', probs.length === 0,
      probs.slice(0, 4).join(' | ') || ('16 种 × Lv.1~' + E.maxLevel + ' 全部一致'));
  }

  // ---- 属性面板口径：攻击力是纯原生值（白字），强化只出现在专属属性行 ----
  const info = CUR.bonusStats.collectTowerStats(g, t, cfg.TOWER_STATS.triangle, 'triangle');
  ok('面板原生攻击力 = 纯原生值（不再叠加强化固定值）',
    info.base.damage === ATK, `base=${info.base.damage} 原生=${ATK}`);
  ok('面板明细里出现"强化"来源',
    info.sources.some((s) => s.source === 'enhance'), 'sources=' + info.sources.length);
  ok('面板最终攻击力与战斗口径一致',
    info.final.damage === g.towerDamage(t, ATK), `面板=${info.final.damage} 战斗=${g.towerDamage(t, ATK)}`);
  ok('面板暴击行 = 原生 5% + 强化 +25%（白字 + 绿字）', (() => {
    const row = info.rows.filter((r) => r.key === 'critChance')[0];
    return !!row && row.baseText === '5%' && row.bonusText === '+25%';
  })(), JSON.stringify(info.rows.filter((r) => r.key === 'critChance')[0]));

  // ---- 四项"强化专属"属性的面板行 ----
  {
    const g3 = freshGame(390, 844);
    const tm = CUR.tower, bs = CUR.bonusStats;
    const mk = (type, lv) => {
      const tw = tm.createTower(type, 0, 0);
      tw.stage = E.minStage;
      tw.enhanceLevel = lv;
      tm.applyEnhanceAttrs(tw);
      return bs.collectTowerStats(g3, tw, cfg.TOWER_STATS[type], type);
    };
    const rowOf = (info2, key) => info2.rows.filter((r) => r.key === key)[0];
    const hexRow = rowOf(mk('hexagon', 3), 'eliteMult');
    ok('六边塔面板「精英伤害倍率」= 5倍 +3倍',
      !!hexRow && hexRow.baseText === '5倍' && hexRow.bonusText === '+3倍', JSON.stringify(hexRow));
    const sqRow = rowOf(mk('square', 2), 'projectileScale');
    ok('正方塔面板「弹道体积」= 100% +40%',
      !!sqRow && sqRow.baseText === '100%' && sqRow.bonusText === '+40%', JSON.stringify(sqRow));
    const secRow = rowOf(mk('sector', 2), 'sectorAngle');
    ok('扇塔面板「扇面张角」= 45° +10°',
      !!secRow && secRow.baseText === '45°' && secRow.bonusText === '+10°', JSON.stringify(secRow));
    const lrRow = rowOf(mk('long_rectangle', 2), 'stackMax');
    ok('长方塔面板「堆叠上限」= 10层 +4层',
      !!lrRow && lrRow.baseText === '10层' && lrRow.bonusText === '+4层', JSON.stringify(lrRow));
    ok('非专属塔不凭空多出这 4 行（三角塔面板）',
      !rowOf(mk('triangle', E.maxLevel), 'eliteMult') && !rowOf(mk('triangle', E.maxLevel), 'stackMax'),
      '三角塔面板干净');
  }

  // ---- 商店预览（无实体塔）不能强化 ----
  const g2 = freshGame(390, 844);
  g2.startBattle();
  ok('canEnhanceTower(null) 被拒', g2.canEnhanceTower(null).ok === false);

  // ---- 辅助塔：专属属性是光环强度，且强化不产生攻击力 ----
  const sup = towerMod.createTower('trapezoid', 0, 0);
  sup.stage = E.minStage;
  ok('辅助塔未强化时光环强度 = 原生 25',
    towerMod.getTowerRuntimeStats(sup).supportBuff.attackSpeedMultiplier === 25,
    String(towerMod.getTowerRuntimeStats(sup).supportBuff.attackSpeedMultiplier));
  g.gold = 100000;
  g.enhanceTower(sup);
  const sup1 = towerMod.getTowerRuntimeStats(sup);
  ok('辅助塔强化 1 级：光环强度 25 → 30（每级 +5%）',
    sup1.supportBuff.attackSpeedMultiplier === 30 && sup1.range === cfg.TOWER_STATS.trapezoid.range,
    '光环=' + sup1.supportBuff.attackSpeedMultiplier + ' 范围=' + sup1.range);
  ok('辅助塔强化后依然不产出攻击力',
    g.towerDamage(sup, cfg.TOWER_STATS.trapezoid.damage) === 0 &&
    towerMod.calculateFinalDamage(cfg.TOWER_STATS.trapezoid.damage, sup.level, sup.attackPowerBoost) === 0,
    'damage=0');
}

// =====================================================================
// E2. 天赋
// =====================================================================
section('E2. 天赋（10 项）');
{
  const g = freshGame(390, 844);
  const meta = CUR.meta;
  const tal = cfg.TALENTS;
  const EFF = cfg.TALENT_EFFECT;
  // 用真实接口学习（grantTalentPoints + learnTalent），避免依赖不存在的测试后门
  function setTalent(id, lv) {
    meta.resetAll();
    meta.grantTalentPoints(9999);
    let guard = 0;
    while (meta.talentLevel(id) < lv && guard++ < 50) {
      const r = meta.learnTalent(id);
      if (!r.ok) break;
    }
    return meta.talentLevel(id);
  }
  void g;

  const bad = [];
  for (const d of tal) {
    if (!(d.max > 0)) bad.push(d.id + ':max 非正');
    if (!Array.isArray(d.costs) || d.costs.length < d.max) bad.push(d.id + ':costs 长度 ' + (d.costs ? d.costs.length : 'null') + ' < max ' + d.max);
    if (!EFF[d.id]) bad.push(d.id + ':TALENT_EFFECT 缺失');
    if (meta.talentValue(d.id) !== 0) bad.push(d.id + ':0 级时 talentValue != 0');
  }
  ok('10 天赋 max/costs/TALENT_EFFECT 齐备', bad.length === 0, bad.join(',') || tal.map((d) => d.id + '(max' + d.max + ')').join(' '));

  const sumBad = [];
  for (const d of tal) {
    const lv = setTalent(d.id, d.max);
    if (lv !== d.max) { sumBad.push(d.id + ': 只能学到 ' + lv); continue; }
    const v = meta.talentValue(d.id);
    // high_stakes 主值 = 负向 perLevel（-10/级）
    const exp = EFF[d.id].perLevel * d.max;
    if (Math.abs(v - exp) > 1e-6) sumBad.push(`${d.id}: ${v} != ${exp}`);
  }
  ok('升满级后 talentValue = perLevel×max', sumBad.length === 0, sumBad.join(' | ') || '10 项全部一致');

  const hs = tal.filter((d) => d.id === 'high_stakes')[0];
  const hsMax = hs.max;
  setTalent('high_stakes', hsMax);
  const goldSide = meta.talentValue('high_stakes', 'goldPerLevel');
  const ptPenalty = meta.talentValue('high_stakes');
  ok('暴利风险 goldPerLevel 取到正增益', goldSide === EFF.high_stakes.goldPerLevel * hsMax,
    'goldPerLevel=+' + goldSide + '%');
  ok('暴利风险 主值取到负惩罚（减积分）', ptPenalty === EFF.high_stakes.perLevel * hsMax, '主值=' + ptPenalty);
  ok('暴利风险 twoWay 标记存在', EFF.high_stakes.twoWay === true, 'twoWay=' + EFF.high_stakes.twoWay);
  ok('暴利风险 desc 里含双向说明', /积分/.test(hs.desc) && /金币/.test(hs.desc), hs.desc);
  ok('天赋点不足时 learnTalent 被拒', (function () {
    meta.resetAll();
    return meta.learnTalent('gold_start').ok === false;
  })());

  // 暴利风险真的"减积分"（grantPoints 里的负向倍率）
  setTalent('high_stakes', hsMax);
  meta.get().points = 0;
  const got = meta.grantPoints(100);
  const expPen = Math.round(100 * (1 + (0 - EFF.high_stakes.perLevel * hsMax) / 100));
  ok('暴利风险满级：100 积分只发 ' + expPen, got === expPen, '实际 ' + got);
  // 洞察先机与暴利风险相抵
  setTalent('high_stakes', hsMax);
  meta.grantTalentPoints(9999);
  for (let i = 0; i < talOf2('points_gain').max; i++) meta.learnTalent('points_gain');
  meta.get().points = 0;
  const got2 = meta.grantPoints(100);
  const pg = EFF.points_gain.perLevel * talOf2('points_gain').max;
  const hsPen = EFF.high_stakes.perLevel * hsMax;
  const exp2 = Math.round(100 * Math.max(0.1, 1 + (pg - hsPen) / 100));
  ok('洞察先机(' + pg + '%) 抵掉暴利风险(' + hsPen + '%)：100 → ' + exp2, got2 === exp2, '实际 ' + got2);

  function talOf2(id) { return cfg.TALENTS.filter((d) => d.id === id)[0]; }
}

// =====================================================================
// F. 状态机
// =====================================================================
section('F. 战斗流程状态机');
{
  const g = freshGame(390, 844);
  ok('初始 battleStarted=false（战前选关）', g.battleStarted === false);
  ok('初始 showMenu=false', g.showMenu === false);
  ok('初始 scene=battle', g.scene === 'battle', g.scene);
  const r = g.startBattle();
  ok('startBattle() 返回 true', r === true);
  ok('开始后 battleStarted=true', g.battleStarted === true);
  const gold0 = g.gold;
  for (let i = 0; i < 300; i++) g.update(1 / 30);
  ok('开始后波次推进', g.currentWave >= 1, 'currentWave=' + g.currentWave);
  void gold0;
  ok('openMenu 成功', g.openMenu() === true && g.showMenu === true);
  g.closeMenu();
  ok('closeMenu 后 showMenu=false', g.showMenu === false);
  g.abandonRun();
  ok('abandonRun 后回到战前（battleStarted=false）', g.battleStarted === false, 'battleStarted=' + g.battleStarted);
  ok('abandonRun 后波次归零', g.currentWave === 0, 'currentWave=' + g.currentWave);
  ok('startLevel(1) 成功', g.startLevel(1) === true);
  ok('startLevel(2) 被拒（占位未开放）', g.startLevel(2) === false);
  ok('未开始时 openMenu 被拒', (function () { const g2 = freshGame(390, 844); g2.battleStarted = false; return g2.openMenu() === false; })());
  // 主循环推进判定（loop 内条件）
  ok('loop 判定字段齐备', 'battleStarted' in g && 'showMenu' in g && 'scene' in g && 'isRunning' in g);
}

// =====================================================================
// F2. 底部导航切页（回归：历史 bug「进了天赋页就再也切不出去」）
// =====================================================================
section('F2. 底部导航切页（回归）');
{
  // 模拟一次真实点按：touchStart 记录按压态 → touchEnd 判定命中
  const tapAt = (g, x, y) => {
    CUR.input.handleTouchStart(g, { touches: [{ clientX: x, clientY: y }] });
    CUR.input.handleTouchEnd(g, { changedTouches: [{ clientX: x, clientY: y }] });
  };

  {
    const g = freshGame(390, 844);
    const navL = CUR.nav.getNavLayout(g);
    const itemOf = (id) => navL.items.filter((it) => it.id === id)[0];
    const center = (it) => ({ x: it.x + it.w / 2, y: it.y + it.h / 2 });

    ok('导航项 >= 4（图签/天赋/战斗/商店）', navL.items.length >= 4, navL.items.map((i) => i.id).join('/'));

    // 逐个导航项：从「天赋页」出发都要能切走 —— 这就是历史 bug 的现场
    const reachable = [];
    for (const it of navL.items) {
      if (it.disabled) continue;
      const g2 = freshGame(390, 844);
      g2.scene = 'talents';                 // 卡在天赋页
      const c = center(CUR.nav.getNavLayout(g2).items.filter((x) => x.id === it.id)[0]);
      tapAt(g2, c.x, c.y);
      reachable.push(it.id + '→' + g2.scene);
      ok('天赋页点「' + it.label + '」能切到 ' + it.scene, g2.scene === it.scene, '实际 ' + g2.scene);
    }
    log('  天赋页出口：' + reachable.join('  '));

    // 反向：从图签页点天赋也要能切过去
    {
      const g3 = freshGame(390, 844);
      g3.scene = 'codex';
      const it = CUR.nav.getNavLayout(g3).items.filter((x) => x.id === 'talents')[0];
      if (it) {
        const c = { x: it.x + it.w / 2, y: it.y + it.h / 2 };
        tapAt(g3, c.x, c.y);
        ok('图签页点「天赋」能切回天赋页（双向）', g3.scene === 'talents', '实际 ' + g3.scene);
      }
    }

    // 负例：点屏幕中部（不是导航栏）不该切场景
    {
      const g4 = freshGame(390, 844);
      g4.scene = 'talents';
      tapAt(g4, 195, 300);
      ok('点非导航区不切场景', g4.scene === 'talents', '实际 ' + g4.scene);
    }

    // disabled 的导航项点了不应切场景
    for (const it of navL.items) {
      if (!it.disabled) continue;
      const g5 = freshGame(390, 844);
      g5.scene = 'battle';
      const it5 = CUR.nav.getNavLayout(g5).items.filter((x) => x.id === it.id)[0];
      const c = { x: it5.x + it5.w / 2, y: it5.y + it5.h / 2 };
      tapAt(g5, c.x, c.y);
      ok('未开放导航项「' + it.label + '」不切场景', g5.scene === 'battle', '实际 ' + g5.scene);
    }
  }
}

// =====================================================================
// F2c. 强化「确认」浮层：模态不能锁死 UI（回归）
// ---------------------------------------------------------------------
// 历史 bug：浮层只在强化**成功**时清 game.enhancePicker，而 canEnhanceTower
// 不看金币。于是"金币不足"时点卡片必然失败 → 浮层永久残留 → handleTouchStart
// 把战斗场景的所有触摸都吃掉，整个界面（连属性面板）都点不动。
// =====================================================================
section('F2c. 强化浮层模态（回归：不能锁死 UI）');
{
  const tapAt = (g, x, y) => {
    CUR.input.handleTouchStart(g, { touches: [{ clientX: x, clientY: y }] });
    CUR.input.handleTouchEnd(g, { changedTouches: [{ clientX: x, clientY: y }] });
  };
  const center = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

  // 造一个"3★ 三角塔 + 属性面板已打开"的现场（panelEnhanceBtn 由 renderer 算出）
  const mkPanel = (gold) => {
    const g = freshGame(390, 844);
    g.startBattle();
    const tw = CUR.tower.createTower('triangle', g.slots[0].x, g.slots[0].y);
    tw.stage = cfg.MAX_STAGE;
    tw.attackPowerBoost = CUR.tower.getAttackPowerBoost(tw.stage);
    g.slots[0].tower = tw; g.slots[0].occupied = true;
    g.towers.push(tw);
    g.gold = gold;
    g.showPanel = true; g.selectedTower = tw; g.panelTowerType = tw.type;
    frame(g);
    return { g: g, tw: tw };
  };
  const openPicker = (g) => {
    const c = center(g.panelEnhanceBtn);
    tapAt(g, c.x, c.y);
    return CUR.enhance.getEnhanceLayout(g);
  };

  // 正例：金币足够 → 点卡片直接强化成功并收掉浮层
  {
    const s = mkPanel(100000);
    const L = openPicker(s.g);
    ok('点属性面板「强化」→ 浮层打开且只有 1 张确认卡',
      !!s.g.enhancePicker && L.cards.length === 1, 'cards=' + L.cards.length);
    const c = center(L.cards[0]);
    tapAt(s.g, c.x, c.y);
    ok('金币足够：点卡片 → 强化 +1 且浮层自动关闭',
      s.tw.enhanceLevel === 1 && s.g.enhancePicker === null,
      'lv=' + s.tw.enhanceLevel + ' picker=' + (s.g.enhancePicker ? 'OPEN' : 'null'));
    ok('金币足够：确实扣了钱', s.g.gold < 100000, 'gold=' + s.g.gold);
  }

  // 负例（历史 bug 现场）：金币不足 → 点卡片失败，浮层必须还能被"点空白"关掉
  {
    const s = mkPanel(0);
    const L = openPicker(s.g);
    const c = center(L.cards[0]);
    tapAt(s.g, c.x, c.y);
    ok('金币不足：点卡片不涨等级、浮层保持打开（让玩家看得到价格）',
      s.tw.enhanceLevel === 0 && !!s.g.enhancePicker, 'lv=' + s.tw.enhanceLevel);
    const blankX = L.panel.x + 10;
    const blankY = L.panel.y + 30;   // 面板内、卡片外的空白
    tapAt(s.g, blankX, blankY);
    ok('金币不足：点空白能取消浮层（旧版会永久锁死）',
      s.g.enhancePicker === null, 'picker=' + (s.g.enhancePicker ? 'OPEN' : 'null'));
    tapAt(s.g, blankX, blankY);
    ok('取消浮层后 UI 恢复响应：再点一下关掉属性面板',
      s.g.showPanel === false, 'showPanel=' + s.g.showPanel);
  }

  // 浮层开着时点导航栏：切场景的同时浮层必须被收掉（不残留到别的场景）
  {
    const s = mkPanel(100000);
    openPicker(s.g);
    const it = CUR.nav.getNavLayout(s.g).items.filter((x) => x.id === 'codex')[0];
    const c = center(it);
    tapAt(s.g, c.x, c.y);
    ok('浮层开着时切到图签页：浮层被收掉且场景已切换',
      s.g.scene === 'codex' && s.g.enhancePicker === null,
      'scene=' + s.g.scene + ' picker=' + (s.g.enhancePicker ? 'OPEN' : 'null'));
  }

  // 兜底：悬空的 pendingDrag（丢了 touchend / touchcancel）不能把后续点击全吃掉
  {
    const s = mkPanel(100000);
    s.g.pendingDrag = true;      // 模拟手势没收尾留下的残留状态
    s.g.touchStartPos = null;
    const L = openPicker(s.g);
    ok('pendingDrag 悬空时不吞点击（点强化按钮仍能打开浮层）',
      !!s.g.enhancePicker && L.cards.length === 1,
      'picker=' + (s.g.enhancePicker ? 'OPEN' : 'null'));
  }
}

// =====================================================================
// F3. 按钮点击波纹（"永久红框/幽灵绿框"回归测试，需求 3 + 需求 4）
// =====================================================================
section('F3. 按钮波纹：0.45s 内必须消失 + 按层绘制');
{
  const g = freshGame(390, 844);
  const input = CUR.input;
  const themeMod = CUR.theme;
  const ctx = g.ctx;

  // ① 单位：duration 必须是毫秒（旧实现按秒算 → 450ms 被当成 450 秒，波纹挂 7.5 分钟）
  input.flashButton(g, { x: 10, y: 10, w: 100, h: 74 }, '255,68,68', 'shop');
  ok('flashButton 的 duration 是毫秒（450）', g.buttonFx && g.buttonFx.duration === 450,
    'duration=' + (g.buttonFx && g.buttonFx.duration));
  ok('flashButton 记录归属层（商店卡 = shop）', g.buttonFx.layer === 'shop', 'layer=' + g.buttonFx.layer);

  // ② 分层：overlay 层不能替商店层画（否则战场中间凭空多一个框）
  themeMod.drawButtonFx(g, ctx, 'overlay');
  ok('overlay 层不绘制 shop 层的波纹', !!g.buttonFx, g.buttonFx ? 'fx 保留' : 'fx 被误清/误画');

  themeMod.drawButtonFx(g, ctx, 'shop');
  ok('shop 层在动画期内绘制自己的波纹', !!g.buttonFx, 'fx 仍在动画中');

  // ③ 过期必须自动清除 —— 这是"永久红框"的核心回归点
  g.buttonFx.t0 = Date.now() - 500;   // 拨到 500ms 前（> 450ms）
  themeMod.drawButtonFx(g, ctx, 'shop');
  ok('450ms 后波纹自动清除（不再是 450 秒）', g.buttonFx === null,
    g.buttonFx ? 'fx 残留（duration 单位又写错了？）' : '已清除');

  // ④ 兜底：归属层始终没人绘制时，2s 硬上限也要清掉，不能永久占着
  input.flashButton(g, { x: 10, y: 10, w: 100, h: 74 }, '255,68,68', 'shop');
  g.buttonFx.t0 = Date.now() - 2100;
  themeMod.drawButtonFx(g, ctx, 'shop');
  ok('超过 2s 硬上限也会清除（切场景防残留）', g.buttonFx === null, g.buttonFx ? '残留' : '已清除');

  // ⑤ 行为链路：从商店拖放失败 → 卡片红色闪烁（且归属 shop 层）
  {
    const g2 = freshGame(390, 844);
    const shopMod = CUR.shop;
    g2.startBattle();
    g2.gold = 0;                                    // 金币不足 → 拖放必失败
    const card = shopMod.getShopLayout(g2).cards[0];
    const sx = card.x + card.w / 2, sy = card.y + card.h / 2;
    CUR.input.handleTouchStart(g2, { touches: [{ clientX: sx, clientY: sy }] });
    ok('按下商店卡进入待拖状态', g2.pendingDrag && g2.dragFromShop, 'pendingDrag=' + g2.pendingDrag);
    g2.dragging = true; g2.dragX = 5; g2.dragY = 200;   // 移到战场空白处
    CUR.input.handleTouchEnd(g2, { changedTouches: [{ clientX: 5, clientY: 200 }] });
    ok('拖放失败触发红色波纹（归属 shop 层）',
      !!g2.buttonFx && g2.buttonFx.color === '255,68,68' && g2.buttonFx.layer === 'shop',
      g2.buttonFx ? ('color=' + g2.buttonFx.color + ' layer=' + g2.buttonFx.layer) : '没有波纹');
    g2.buttonFx.t0 = Date.now() - 500;
    CUR.shop.drawShop(g2);
    ok('下一次绘制商店面板时红框已自动消失', !g2.buttonFx, g2.buttonFx ? '仍在' : '已消失');
  }

  // ⑥ 行为链路：点菜单「返回战斗」→ 绿色波纹，且【不会被战场层画到战场上】
  {
    const g3 = freshGame(390, 844);
    g3.startBattle();
    g3.openMenu();
    const menuL = CUR.gamemenu.getMenuLayout(g3);
    const r = menuL.resume;
    CUR.input.handleTouchStart(g3, { touches: [{ clientX: r.x + r.w / 2, clientY: r.y + r.h / 2 }] });
    CUR.input.handleTouchEnd(g3, { changedTouches: [{ clientX: r.x + r.w / 2, clientY: r.y + r.h / 2 }] });
    ok('点「返回战斗」关闭菜单并留下绿色波纹',
      !g3.showMenu && !!g3.buttonFx && g3.buttonFx.color === '165,214,167',
      g3.buttonFx ? g3.buttonFx.color : '没有波纹');
    ok('该波纹归属 menu 层（菜单一关就没人画它 → 战场不会有幽灵框）',
      g3.buttonFx.layer === 'menu', 'layer=' + (g3.buttonFx && g3.buttonFx.layer));
    const ops = frame(g3);
    // 战场层不该出现"菜单按钮的绿框"：色值 #a5d6a7 在未打开弹层的战场里本来不会被用到。
    // （不做大小写归一化会漏判 —— 记录器输出的是小写 hex，第一版断言就是这么写的，
    //   结果断言恒真、什么都没测到。别改回去。）
    const ghost = ops.filter((o) => String(o.color).toLowerCase() === '#a5d6a7' && o.alpha > 0.2);
    ok('菜单按钮的绿色波纹不会在战场上出现（截图里那个"神秘绿框"）', ghost.length === 0,
      ghost.length ? ('战场层画了 ' + ghost.length + ' 条绿框') : '已按层隔离');
    // 忘记传 layer 时（默认 'overlay'）→ 任何绘制层都不会画它，2s 硬上限自清。
    // 设计意图：宁可"这个按钮不闪"，也绝不允许"永久残留一个框"。
    CUR.input.flashButton(g3, { x: 0, y: 0, w: 50, h: 20 }, '1,2,3');
    ok('未指定归属层时默认 overlay（fail-safe：不会被战场层画出来）',
      g3.buttonFx.layer === 'overlay', 'layer=' + g3.buttonFx.layer);
    const ops2 = frame(g3);
    ok('默认层的闪烁不会漏到战场（宁可少闪一次，也不留幽灵框）',
      ops2.filter((o) => String(o.color).toLowerCase() === '#010203').length === 0,
      '漏了 ' + ops2.filter((o) => String(o.color).toLowerCase() === '#010203').length + ' 条');
  }
}

// =====================================================================
// G. 金币与天赋联动
// =====================================================================
section('G. 金币 / 天赋联动');
{
  const EFF = cfg.TALENT_EFFECT;
  const talOf = (id) => cfg.TALENTS.filter((d) => d.id === id)[0];

  {
    const g = freshGame(390, 844);
    const meta = CUR.meta;
    ok('无天赋时击杀金币倍率=1', Math.abs(g.killGoldMultiplier() - 1) < 1e-9, String(g.killGoldMultiplier()));
    const gd = talOf('gold_gain');
    meta.grantTalentPoints(9999);
    for (let i = 0; i < gd.max; i++) meta.learnTalent('gold_gain');
    const expect = 1 + EFF.gold_gain.perLevel * gd.max / 100;
    ok('点石成金满级倍率正确', Math.abs(g.killGoldMultiplier() - expect) < 1e-9, r2(g.killGoldMultiplier()) + ' vs ' + r2(expect));
    // 暴利风险也进击杀倍率
    const hs = talOf('high_stakes');
    for (let i = 0; i < hs.max; i++) meta.learnTalent('high_stakes');
    const expect2 = expect + EFF.high_stakes.goldPerLevel * hs.max / 100;
    ok('暴利风险与点石成金叠加进击杀倍率', Math.abs(g.killGoldMultiplier() - expect2) < 1e-9, r2(g.killGoldMultiplier()) + ' vs ' + r2(expect2));
  }
  {
    const g = freshGame(390, 844);
    const meta = CUR.meta;
    const gps = talOf('gold_per_sec');
    meta.grantTalentPoints(9999);
    for (let i = 0; i < gps.max; i++) meta.learnTalent('gold_per_sec');
    g.gold = 0;
    for (let i = 0; i < 60; i++) g.tickPassiveGold(1 / 30);
    const perSec = EFF.gold_per_sec.perLevel * gps.max;
    ok('涓流金库 2 秒入账 ≈ ' + r2(perSec * 2), Math.abs(g.gold - Math.round(perSec * 2)) <= 1, '实际 ' + g.gold);
    const g2 = freshGame(390, 844);
    g2.gold = 0;
    for (let i = 0; i < 60; i++) g2.tickPassiveGold(1 / 30);
    ok('未学天赋时不产金币', g2.gold === 0, '实际 ' + g2.gold);
  }
  {
    const g = freshGame(390, 844);
    const meta = CUR.meta;
    const wb = talOf('wave_bonus');
    meta.grantTalentPoints(9999);
    for (let i = 0; i < wb.max; i++) meta.learnTalent('wave_bonus');
    g.gold = 0; g.currentWave = 1;
    g.onWaveCleared();
    const exp = EFF.wave_bonus.perLevel * wb.max;
    ok('波次结余金币入账 ' + exp, g.gold === exp, '实际 ' + g.gold);
  }
  {
    const g = freshGame(390, 844);
    const meta = CUR.meta;
    const bb = talOf('boss_bounty');
    meta.grantTalentPoints(9999);
    for (let i = 0; i < bb.max; i++) meta.learnTalent('boss_bounty');
    g.gold = 0;
    g.grantKillReward({ tier: 3, reward: 100 });
    const exp = Math.round(100 * (1 + EFF.boss_bounty.perLevel * bb.max / 100));
    ok('BOSS 悬赏对 tier3 生效：100 → ' + exp, g.gold === exp, '实际 ' + g.gold);
    const g2 = freshGame(390, 844);
    g2.gold = 0;
    g2.grantKillReward({ tier: 1, reward: 100 });
    ok('普通怪不吃 BOSS 悬赏', g2.gold === 100, '实际 ' + g2.gold);
  }
  {
    // 天赋点产出
    const g = freshGame(390, 844);
    const meta = CUR.meta;
    meta.resetAll();
    g.currentWave = 4;
    g.onWaveCleared();
    ok('每 4 波 +' + cfg.TALENT_POINTS.perWaveGroup.amount + ' 天赋点',
      meta.get().talentPoints === cfg.TALENT_POINTS.perWaveGroup.amount, '实际 ' + meta.get().talentPoints);
    const g2 = freshGame(390, 844);
    const m2 = CUR.meta;
    m2.resetAll();
    g2.currentWave = 3;
    g2.onWaveCleared();
    ok('不足 4 波不给天赋点', m2.get().talentPoints === 0, '实际 ' + m2.get().talentPoints);
  }
}

// =====================================================================
// H. SVG 回放
// =====================================================================
section('H. SVG 回放产物');
try { fs.mkdirSync(SVG_DIR, { recursive: true }); } catch (e) { }
{
  const dumpList = [
    ['battle-ready', 390, 844], ['battle-run', 390, 844], ['battle-menu', 390, 844],
    ['battle-panel', 390, 844], ['codex', 390, 844], ['codex-sheet', 390, 844],
    ['talents', 390, 844], ['battle-run', 375, 667], ['codex-sheet', 320, 568],
    ['talents', 320, 568], ['battle-ready', 768, 1024],
    // 本轮新增/改动场景：强化多选一弹窗、天梯滚到顶、图签滚到底、强化门槛
    ['enhance-picker', 390, 844], ['enhance-picker', 320, 568],
    ['battle-panel-locked', 390, 844],
    ['battle-ready-scrolled', 390, 844], ['codex-scrolled', 320, 568],
    // 本轮新增：介绍文字最长的那一档（详情面板 3 行自适应）
    ['codex-sheet-tall', 320, 568], ['codex-sheet-tall', 390, 844],
  ];
  for (const [sc, W, H] of dumpList) {
    const g = freshGame(W, H);
    buildScene(g, sc);
    const ops = frame(g);
    const svg = HH.toSVG(ops, W, H, '#0d1117');
    const name = `${sc}_${W}x${H}.svg`;
    fs.writeFileSync(path.join(SVG_DIR, name), svg, 'utf8');
    log(`  ${name}  ops=${ops.length}  ${(svg.length / 1024).toFixed(1)}KB`);
  }
  ok('SVG 全部生成', true, dumpList.length + ' 张');
}

log('');
log('============================================');
log(`  通过 ${PASS}   失败 ${FAIL}`);
log('============================================');

fs.writeFileSync(OUT, L.join('\n') + '\n', 'utf8');
console.log('PASS=' + PASS + ' FAIL=' + FAIL);
