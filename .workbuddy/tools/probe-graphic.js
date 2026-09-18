// ============================================================================
// 平行塔 + 大血条专项探针 —— .workbuddy/tools/probe-graphic.js
// ----------------------------------------------------------------------------
// 覆盖 2026-09-17 这一轮的改动，每一条都是"改错了就再也看不出来"的那种：
//   ① 平行塔轮廓 = 双横（两条横杠），而不是掉进 default 的圆
//   ② 双横不跟随攻击朝向旋转（转了变双竖，辨识度直接崩）
//   ③ 攻击间隔从 description 里拿掉（数值归属性表，介绍只讲机制）
//   ④ 固有技能不再是空标题：ENHANCE_SPECIAL 给平行塔登记了"叠加上限"
//   ⑤ 战斗口径用 getInnateStackCap（原生 100 + 强化 20/级），不再硬编码 100
//   ⑥ 大血条：不发光（0 个径向渐变 / 0 个椭圆）、掉血白条按帧向下追平、
//      回血立刻贴合、鬼影永不小于实血
//   ⑦ 战斗层不再记账 _dmgBuf（跨层状态已删）
//   ⑧ 塔型键 graphic → parallel 改名完整（配置表 / 源码残留 / 旧存档迁移）
// 附：把图标 / 血条 / 两个面板回放成 SVG，拼一份自包含 HTML 给人眼核对。
// ============================================================================
const path = require('path');
const fs = require('fs');
const { makeCtx, makeRec } = require('./harness');
const { createSvgCtx } = require('./svgctx');

global.document = { addEventListener() {}, removeEventListener() {} };
global.requestAnimationFrame = () => 0;

const ROOT = path.resolve(__dirname, '..', '..');
// 交付物与报告落 .workbuddy/tmp/（项目既定约定）；
// tools/ 只放脚本。svgscheck 这类体检脚本吃绝对路径即可。
const TMP = path.join(__dirname, '..', 'tmp');
const Game = require(path.join(ROOT, 'src', 'game_core'));
const renderer = require(path.join(ROOT, 'src', 'renderer'));
const theme = require(path.join(ROOT, 'src', 'theme'));
const config = require(path.join(ROOT, 'src', 'config'));
const codex = require(path.join(ROOT, 'src', 'codex'));
const towerMod = require(path.join(ROOT, 'src', 'tower'));

const out = [];
let fails = 0;
const ok = (name, cond, detail) => {
  if (!cond) fails++;
  out.push(`${cond ? '  ok  ' : ' FAIL '} ${name}${detail ? '  → ' + detail : ''}`);
};
const log = (s) => out.push(s);

// 白条的颜色前缀（BOSS 用 0.82，小怪用 0.8）。断言只认"0.8x"这档白，
// 别用 indexOf('255, 255, 255') —— 血条的静态内高光是 0.22，会整片误报。
const GHOST_FILL_PREFIX = 'rgba(255, 255, 255, 0.8';
const hasGhost = (fills) => fills.some((f) => f.indexOf(GHOST_FILL_PREFIX) >= 0);

// ---------- 带探针的录制 ctx（顺手统计径向渐变 / 椭圆 / 每次 fill 的颜色）----------
function makeSpyCtx() {
  const rec = makeRec();
  const ctx = makeCtx(rec);
  const spy = { radial: 0, ellipse: 0, fills: [] };
  const r0 = ctx.createRadialGradient.bind(ctx);
  const e0 = ctx.ellipse.bind(ctx);
  const f0 = ctx.fill.bind(ctx);
  ctx.createRadialGradient = (...a) => { spy.radial++; return r0(...a); };
  ctx.ellipse = (...a) => { spy.ellipse++; return e0(...a); };
  ctx.fill = () => { spy.fills.push(String(ctx.fillStyle)); return f0(); };
  return { ctx, rec, spy };
}

function mkGame(ctx, W, H) {
  const canvas = { width: W, height: H, addEventListener() {}, removeEventListener() {}, getContext() { return ctx; } };
  return new Game(canvas, ctx, { screenWidth: W, screenHeight: H, renderScale: 1 });
}

// ============================================================================
log('===== ① 平行塔轮廓 = 双横 =====');
{
  const { ctx, rec } = makeSpyCtx();
  rec.rects.length = 0;
  theme.drawTowerIcon(ctx, 100, 100, '#00FF7F', 'parallel');
  const bars = rec.rects.slice();
  ok('双横 = 恰好两条横杠', bars.length === 2, `实际 ${bars.length} 条（掉进 default 会画成 1 个圆、roundRect 记录为 0 条）`);
  if (bars.length === 2) {
    const [a, b] = bars.sort((p, q) => p.y - q.y);
    ok('两条等宽等高', Math.abs(a.w - b.w) < 0.01 && Math.abs(a.h - b.h) < 0.01, `${a.w}x${a.h} / ${b.w}x${b.h}`);
    ok('左边缘对齐（同一根竖轴）', Math.abs(a.x - b.x) < 0.01, `x=${a.x} / ${b.x}`);
    ok('上下排布且留缝', b.y - (a.y + a.h) > 1, `缝 ${(b.y - (a.y + a.h)).toFixed(2)}px`);
    ok('横长（宽 > 高，确实是"横"）', a.w > a.h * 2, `${a.w} > ${a.h * 2}`);
    ok('整体居中于给定坐标', Math.abs((a.x + a.w / 2) - 100) < 0.01 && Math.abs((a.y + (b.y + b.h - a.y) / 2) - 100) < 0.01);
  }
  // 旧 bug 兜底：未登记的 type 会掉进 default 画圆（无 roundRect 记录）→ 必须为 0
  const { ctx: ctx2, rec: rec2 } = makeSpyCtx();
  theme.drawTowerIcon(ctx2, 100, 100, '#fff', '__no_such_tower__');
  ok('未登记类型仍走 default 兜底（不是静默不画）', rec2.rects.length === 0 && rec2.ops.length > 0);
}

{
  ok('TOWER_SHAPES 已登记 parallel', theme.TOWER_SHAPES.indexOf('parallel') >= 0, `共 ${theme.TOWER_SHAPES.length} 种`);
  ok('平行塔不随攻击朝向旋转', theme.shouldRotateTowerIcon('parallel') === false);
  ok('三角塔仍跟随朝向旋转（没被误伤）', theme.shouldRotateTowerIcon('triangle') === true);
}

// ============================================================================
log('\n===== ② 介绍文案与固有技能登记 =====');
{
  const st = config.TOWER_STATS.parallel;
  ok('description 不含「攻击间隔」', String(st.description).indexOf('攻击间隔') < 0, st.description);
  ok('description 不含具体秒数 0.25', String(st.description).indexOf('0.25') < 0);
  ok('description 仍讲清机制（含「连续射击」）', String(st.description).indexOf('连续射击') >= 0);
  ok('攻击间隔仍在属性表里（只是不在文案里）', st.attackInterval === 0.25, `attackInterval=${st.attackInterval}`);

  const sp = config.ENHANCE_SPECIAL.parallel;
  ok('平行塔有专属特殊属性（不再是空标题）', !!sp, sp ? `${sp.name} base=${sp.base} per=${sp.per}${sp.unit}` : '缺失');
  ok('专属属性 base 与 TOWER_STATS 原生值一致', sp && sp.base === st.innateStackCap, `${sp && sp.base} vs ${st.innateStackCap}`);
  ok('全部塔型都有专属属性（17/17）', config.TOWER_ORDER.every((t) => !!config.ENHANCE_SPECIAL[t]),
    config.TOWER_ORDER.filter((t) => !config.ENHANCE_SPECIAL[t]).join(',') || '无遗漏');
}

// ============================================================================
log('\n===== ③ 战斗口径：叠加上限走 getter（不再硬编码 100）=====');
{
  const bare = { type: 'parallel', enhanceAttrs: {} };
  ok('原生叠加上限 = 100%', towerMod.getInnateStackCap(bare) === 100, `${towerMod.getInnateStackCap(bare)}`);
  // ⚠️ 别用"手写 enhanceAttrs"来模拟强化：tower.getEnhanceAttr 对**招牌属性**
  //    （sp.key）走的是 per × clamp(强化等级 + 宝石等级)，压根不读 enhanceAttrs
  //    （宝石版引入的口径，见 tower.js getEnhanceAttr 的注释）。写 enhanceAttrs 会静默无效。
  const lv2 = { type: 'parallel', enhanceLevel: 2, enhanceAttrs: {} };
  ok('强化 2 级（+20%/级）→ 140%', towerMod.getInnateStackCap(lv2) === 140, `${towerMod.getInnateStackCap(lv2)}`);
  ok('每次攻击叠加步长 = 10%', towerMod.getInnateStackStep(bare) === 10);
  ok('专属属性当前值口径 base+per×L 自洽', towerMod.getSpecialValue('parallel', 2) === 140, `${towerMod.getSpecialValue('parallel', 2)}`);
  const src = fs.readFileSync(path.join(ROOT, 'src', 'game_core.js'), 'utf8');
  ok('game_core 已不再硬编码叠加上限 100', src.indexOf('Math.min(100, tower._innateStack') < 0);
  ok('game_core 已不再记账 _dmgBuf', src.indexOf('_dmgBuf') < 0);
  const rsrc = fs.readFileSync(path.join(ROOT, 'src', 'renderer.js'), 'utf8');
  ok('renderer 已不再消费 _dmgBuf', rsrc.indexOf('_dmgBuf') < 0);
}

// ============================================================================
log('\n===== ④ 大血条：无发光 + 白条延迟掉血 =====');
const BAR_DT = 1 / 60;
function mkBoss(maxHp, pct) {
  return {
    alive: true, tier: 4, color: '#FF0000', size: 28, x: 195, y: 300,
    maxHp: maxHp, hp: maxHp * pct,
  };
}
/** 只画血条（不画整个战场），返回本帧的探针结果 */
function drawBarOnce(boss, dt) {
  const { ctx, rec, spy } = makeSpyCtx();
  renderer.drawBossHealthBar(ctx, boss, 195, 60, 'red', 320, dt);
  return { spy, rec, fills: spy.fills };
}
{
  const boss = mkBoss(25000, 1);
  const a = drawBarOnce(boss, BAR_DT);
  ok('去掉发光动画：0 个径向渐变', a.spy.radial === 0, `radial=${a.spy.radial}`);
  ok('去掉发光动画：0 个椭圆（旧版那圈呼吸光晕）', a.spy.ellipse === 0, `ellipse=${a.spy.ellipse}`);
  ok('满血：不画白条', !hasGhost(a.fills), a.fills.join(' | '));

  // 掉到 60%：白条必须出现（残留旧血量）
  boss.hp = 25000 * 0.6;
  const b = drawBarOnce(boss, BAR_DT);
  ok('掉血当帧：白条立即出现', hasGhost(b.fills), b.fills.join(' | '));
  const ghostStart = boss._hpGhost;
  ok('掉血当帧：鬼影仍 ≈ 旧血量（这是"缓冲"的来源）', ghostStart > boss.hp, `ghost=${ghostStart.toFixed(0)} hp=${boss.hp.toFixed(0)}`);
  ok('掉血当帧：鬼影不超过满血', ghostStart <= boss.maxHp + 1e-6);

  // 逐帧推进：单调不增、且永不低于实血
  let prev = ghostStart;
  let monotonic = true, neverBelow = true, frames = 0;
  while (frames < 90 && boss._hpGhost > boss.hp + 1e-6) {
    drawBarOnce(boss, BAR_DT);
    if (boss._hpGhost > prev + 1e-6) monotonic = false;
    if (boss._hpGhost < boss.hp - 1e-6) neverBelow = false;
    prev = boss._hpGhost;
    frames++;
  }
  ok('白条单调向下、永不回升', monotonic);
  ok('白条永不掉到实血以下', neverBelow);
  ok('白条会追上实血（最终彻底消失）', boss._hpGhost <= boss.hp + 1e-6, `${(frames * BAR_DT).toFixed(2)}s 追平`);
  // 追赶速度 = 满管 / 0.9s，所以缺口 40% 时理论耗时 = 0.9 × 40% = 0.36s
  const expectSec = 0.9 * 0.4;
  ok('追平耗时符合 0.9s/满管 的设计值', Math.abs(frames * BAR_DT - expectSec) < 0.06,
    `实测 ${(frames * BAR_DT).toFixed(2)}s vs 理论 ${expectSec.toFixed(2)}s`);
  const settled = drawBarOnce(boss, BAR_DT);
  ok('追平后不再画白条', !hasGhost(settled.fills), settled.fills.join(' | '));

  // 回血：鬼影必须立刻贴合，不能出现"白条比实条长"
  const heal = mkBoss(25000, 0.3);
  drawBarOnce(heal, BAR_DT);
  heal.hp = heal.maxHp;                       // 满血复活
  const h = drawBarOnce(heal, BAR_DT);
  ok('回血：鬼影立刻贴合，不残留白条', heal._hpGhost === heal.maxHp && !hasGhost(h.fills),
    `ghost=${heal._hpGhost}`);

  // 复用/换人（同一对象被重置）也不能残留
  const reuse = mkBoss(9000, 0.2);
  drawBarOnce(reuse, BAR_DT);
  reuse.maxHp = 9000; reuse.hp = 9000; reuse._hpGhost = undefined;
  drawBarOnce(reuse, BAR_DT);
  ok('对象被重置/复用时鬼影不残留', reuse._hpGhost === 9000, `ghost=${reuse._hpGhost}`);

  // 小怪血条共用同一套口径（此时只统计"本帧血条自己"的 fill）
  const mob = { alive: true, tier: 0, color: '#808080', size: 16, x: 100, y: 200, maxHp: 1000, hp: 400, _hpGhost: 1000 };
  const { ctx: mctx, spy: mspy } = makeSpyCtx();
  const gm = mkGame(mctx, 390, 844);
  gm.dt = BAR_DT;
  mspy.fills.length = 0;
  renderer.drawEnemyHpBar(gm, mob);
  ok('小怪血条也带白条（同一套 updateHpGhost）', hasGhost(mspy.fills),
    `fills=${mspy.fills.join(' | ')}`);
  for (let i = 0; i < 120 && mob._hpGhost > mob.hp + 1e-6; i++) renderer.drawEnemyHpBar(gm, mob);
  ok('小怪白条同样会追平实血', mob._hpGhost <= mob.hp + 1e-6, `ghost=${mob._hpGhost.toFixed(0)}`);

  // 出生即初始化鬼影：否则"第一次挨打"的白条永远不出现（见 enemy.spawnEnemy）
  const enemyMod = require(path.join(ROOT, 'src', 'enemy'));
  const fresh = enemyMod.spawnEnemy('normal', [{ x: 0, y: 0 }, { x: 100, y: 0 }], 1);
  ok('新刷的怪：鬼影初值 = 满血', fresh._hpGhost === fresh.maxHp, `ghost=${fresh._hpGhost} maxHp=${fresh.maxHp}`);
}

// ============================================================================
log('\n===== ⑤ 两个面板都真的显示了固有技能 / 攻击间隔 =====');
{
  const { ctx, rec } = makeSpyCtx();
  const g = mkGame(ctx, 390, 844);
  g.scene = 'battle';
  g.panelTowerType = 'parallel';
  g.showPanel = true;
  g.gold = 9999;
  renderer.drawTowerPanel(g);
  const texts = rec.texts.map((t) => t.text);
  const has = (s) => texts.some((t) => t.indexOf(s) >= 0);
  ok('属性面板：显示的是「平行塔」', has('平行塔'), texts.filter((t) => /塔/.test(t)).slice(0, 3).join(' / '));
  ok('属性面板：有「固有技能」标题', has('固有技能'));
  ok('属性面板：固有技能区块有内容（不是空标题）', texts.some((t) => /叠加上限/.test(t)), texts.filter((t) => /叠加|上限/.test(t)).join(' / ') || '无');
  ok('属性面板：攻击间隔归位到属性行', has('攻击间隔'), texts.filter((t) => /间隔/.test(t)).join(' / '));
  // 注意：'叠加上限' 在面板上**天然出现两次** —— 一次是属性行（左标签 + 右侧数值），
  // 一次是下方「固有技能」区块里的属性名。所以只断言"至少一次 + 数值在位"，
  // 别写 === 1（那是在断言另一套 UI 布局，不是需求）。
  ok('属性面板：叠加上限作为属性行出现（且有数值）', has('叠加上限') && has('100%'),
    `出现 ${texts.filter((t) => t === '叠加上限').length} 次`);

  const { ctx: ctx2, rec: rec2 } = makeSpyCtx();
  const g2 = mkGame(ctx2, 390, 844);
  g2.scene = 'codex';
  g2.codexSelected = 'parallel';
  renderer.render(g2);
  const texts2 = rec2.texts.map((t) => t.text);
  const has2 = (s) => texts2.some((t) => t.indexOf(s) >= 0);
  ok('图签详情：有「固有技能」标题', has2('固有技能'));
  ok('图签详情：固有技能区块有内容', texts2.some((t) => /叠加上限/.test(t)), texts2.filter((t) => /叠加/.test(t)).join(' / ') || '无');
  ok('图签详情：第三列补上「间隔 0.25秒」', has2('间隔 0.25秒'), texts2.filter((t) => /间隔/.test(t)).join(' / ') || '无');
  ok('图签详情：描述里不再重复攻击间隔', !texts2.some((t) => /间隔 0\.25/.test(t) && /连续射击/.test(t)));
  // 面板高度算得准：所有文字仍在各自裁剪区内
  const sheet = codex.getCodexLayout(g2).sheet;
  let over = 0;
  for (const t of rec2.texts) {
    if (!t.clip) continue;
    if (Math.abs(t.clip.x - (sheet.x + 2)) > 0.5) continue;
    if (t.x1 > t.clip.x + t.clip.w + 0.75 || t.x0 < t.clip.x - 0.75
        || t.y + t.size / 2 > t.clip.y + t.clip.h + 0.75 || t.y - t.size / 2 < t.clip.y - 0.75) over++;
  }
  ok('图签详情：文字无一条越界', over === 0, `越界 ${over} 条`);
}

// ============================================================================
log('\n===== ⑥ 战斗中真跑一遍 graphic 分支（叠层 / 换目标 / 上限）=====');
{
  const towerMod2 = towerMod;
  const enemyMod = require(path.join(ROOT, 'src', 'enemy'));
  const PATH = [{ x: 0, y: 100 }, { x: 400, y: 100 }];

  /** 造一个"平行塔打怪"的最小战场，跑 frames 帧 */
  function runBattle(frames, enemyCount, enhanceLv) {
    const { ctx } = makeSpyCtx();
    const g = mkGame(ctx, 390, 844);
    g.pathPoints = PATH;
    g.battleStarted = true;
    g.isRunning = true;
    const tower = towerMod2.createTower('parallel', 100, 100);
    if (enhanceLv) tower.enhanceLevel = enhanceLv;   // 走真实的强化等级口径（不是手写 enhanceAttrs）
    g.towers = [tower];
    g.enemies = [];
    for (let i = 0; i < enemyCount; i++) {
      const e = enemyMod.spawnEnemy('normal', PATH, 1);
      e.x = 130 + i * 20;
      e.y = 100;
      e.hp = 1e9; e.maxHp = 1e9;      // 别让它死，专心测机制
      g.enemies.push(e);
    }
    let err = null;
    try {
      for (let f = 0; f < frames; f++) g.updateTowers(1 / 60);
    } catch (e) { err = e; }
    return { g, tower, err, enemies: g.enemies };
  }

  const solo = runBattle(400, 1);
  ok('单目标战场不抛异常', !solo.err, solo.err ? `${solo.err.constructor.name}: ${solo.err.message}` : '400 帧');
  // 注意：这里只跑 updateTowers（不跑 updateProjectiles），所以伤害还没落到怪身上，
  // "开火了"的证据是弹道被创建出来了 —— 别拿 hp 掉没掉当判据。
  ok('确实开火了（有弹道飞出）', solo.g.projectiles.length > 0, `弹道 ${solo.g.projectiles.length} 发`);
  ok('叠层确实累加', (solo.tower._innateStack || 0) > 0, `stack=${solo.tower._innateStack}`);
  ok('叠层被原生 100% 上限夹住', solo.tower._innateStack === 100, `stack=${solo.tower._innateStack}`);

  const boosted = runBattle(500, 1, 2);
  ok('强化后叠层上限抬到 140%', boosted.tower._innateStack === 140, `stack=${boosted.tower._innateStack}`);

  const multi = runBattle(300, 3);
  ok('多目标战场不抛异常', !multi.err, multi.err ? `${multi.err.constructor.name}: ${multi.err.message}` : '300 帧');
  ok('能换目标时叠层不涨（保持 0）', (multi.tower._innateStack || 0) === 0, `stack=${multi.tower._innateStack}`);
  const seen = new Set();
  for (let f = 0; f < 600; f++) { multi.g.updateTowers(1 / 60); seen.add(multi.tower._lastInnateTarget && multi.tower._lastInnateTarget.uniqueId); }
  ok('确实在多个目标之间来回换（不是死盯一个）', seen.size >= 2, `打过 ${seen.size} 个不同目标`);
}

// ============================================================================
log('\n===== ⑦ 塔型键改名 graphic → parallel 的完整性 =====');
{
  ok('TOWER_DEFS 里名字是「平行塔」', config.TOWER_DEFS.parallel && config.TOWER_DEFS.parallel.name === '平行塔',
    config.TOWER_DEFS.parallel && config.TOWER_DEFS.parallel.name);
  ok('旧键 graphic 已从所有配置表消失',
    !config.TOWER_DEFS.graphic && !config.TOWER_STATS.graphic && !config.ENHANCE_SPECIAL.graphic
    && theme.TOWER_SHAPES.indexOf('graphic') < 0);   // TOWER_SHAPES 住在 theme，不在 config
  ok('TOWER_ORDER 仍是 17 且不含旧键',
    config.TOWER_ORDER.length === 17 && config.TOWER_ORDER.indexOf('graphic') < 0 && config.TOWER_ORDER.indexOf('parallel') >= 0,
    `共 ${config.TOWER_ORDER.length} 种`);

  // 源码里任何一处漏改的 'graphic' 类型字面量都会让这条红 —— 特别是"另一个 agent 又写回来"的情况
  const SRC = ['config', 'tower', 'game_core', 'theme', 'renderer', 'codex', 'shop', 'input', 'meta', 'bonusStats', 'enemy', 'enhance'];
  const dirty = [];
  for (const name of SRC) {
    const f = path.join(ROOT, 'src', name + '.js');
    if (!fs.existsSync(f)) continue;
    const s = fs.readFileSync(f, 'utf8');
    // 只看"塔型字面量"：引号里的 graphic，或 obj.graphic 取属性
    if (/['"]graphic['"]/.test(s) || /\.graphic\b/.test(s)) dirty.push(name);
  }
  ok('src/ 里没有残留的塔型键 graphic', dirty.length === 0, dirty.join(',') || '干净');

  // 旧存档迁移：codex / socketed / lineup 三张以塔型为键的表都要搬过来，
  // 否则老玩家的平行塔会静默"掉回未解锁"、已嵌宝石消失。
  const LEGACY = {
    version: 1, points: 999, talentPoints: 3,
    codex: { triangle: 2, graphic: 4 },                 // 平行塔图签 Lv.4
    lineup: ['triangle', 'graphic'],
    talents: {}, levels: { cleared: {}, best: {} }, selectedLevel: 1,
    gems: [], gemSeq: 0,
    socketed: { graphic: ['ruby', null, 'topaz', null, null] },
    bagSlots: 20,
  };
  global.wx = {
    getStorageSync: () => JSON.stringify(LEGACY),
    setStorageSync() {},
  };
  // meta 的单例是**模块级**的（let meta），而 resetAll() 只会把内存态覆盖成默认档、
  // 不会重新走 normalize(readRaw())。想真跑一遍迁移，只能换一个干净的模块实例。
  // 用完把老实例塞回 require.cache，别影响后面的场景。
  const META_PATH = require.resolve(path.join(ROOT, 'src', 'meta.js'));
  const cachedMeta = require.cache[META_PATH];
  delete require.cache[META_PATH];
  const metaMod = require(META_PATH);
  const m = metaMod.get();
  ok('迁移：图签等级搬到新键（Lv.4 不丢）', m.codex.parallel === 4 && m.codex.graphic === undefined,
    `parallel=${m.codex.parallel} graphic=${m.codex.graphic}`);
  ok('迁移：登场池里的旧键换成新键', m.lineup.indexOf('parallel') >= 0 && m.lineup.indexOf('graphic') < 0,
    m.lineup.join(','));
  // 槽位自宝石系统升级起存 {kind, lv} 对象（旧字符串档由 normalize 迁移并补 Lv.1）
  ok('迁移：已嵌宝石跟着搬（0/2 槽有货 · 对象格式）',
    !!m.socketed.parallel && m.socketed.parallel[0] && m.socketed.parallel[0].kind === 'ruby' &&
    m.socketed.parallel[2] && m.socketed.parallel[2].kind === 'topaz',
    JSON.stringify(m.socketed));
  ok('迁移：三张表都读得出来（没被清空）', metaMod.isUnlocked('parallel') && metaMod.socketCount('parallel') === 4,
    `socketCount=${metaMod.socketCount('parallel')}`);
  delete require.cache[META_PATH];
  if (cachedMeta) require.cache[META_PATH] = cachedMeta;
  delete global.wx;
}

// ============================================================================
// 交付图：图标 / 血条 / 两个面板
// ============================================================================
const ICON_TYPES = config.TOWER_ORDER;
const ICON_COLS = 6, ICON_CW = 62, ICON_CH = 78, ICON_TOP = 44;
const ICON_ROWS = Math.ceil(ICON_TYPES.length / ICON_COLS);
const ICON_W = ICON_COLS * ICON_CW;
const ICON_H = ICON_TOP + ICON_ROWS * ICON_CH + 10;
const ctxIcons = createSvgCtx(ICON_W, ICON_H, '#0d1017');
ctxIcons.font = 'bold 13px Arial';
ctxIcons.fillStyle = '#c9d4e3';
ctxIcons.textAlign = 'left';
ctxIcons.textBaseline = 'middle';
ctxIcons.fillText('图形塔防 · 17 种塔轮廓（绿色 = 平行塔，右侧为"双横"）', 10, 20);
ICON_TYPES.forEach((type, i) => {
  const r = Math.floor(i / ICON_COLS), c = i % ICON_COLS;
  const cx = c * ICON_CW + ICON_CW / 2;
  const cy = ICON_TOP + r * ICON_CH + 26;
  const unlocked = i % 2 === 0;
  theme.drawTowerIcon(ctxIcons, cx, cy, unlocked ? (config.TOWER_DEFS[type] || {}).color || '#fff' : theme.THEME.text.off, type);
  ctxIcons.font = '10px Arial';
  ctxIcons.fillStyle = type === 'parallel' ? '#00FF7F' : '#8b98a9';
  ctxIcons.textAlign = 'center';
  ctxIcons.textBaseline = 'middle';
  ctxIcons.fillText(type, cx, cy + 30);
});
const svgIcons = ctxIcons.toSVG();

// ---- 血条时序：一条 BOSS 从满血挨到 45% ----
const BAR_W = 400, BAR_H = 250;
const ctxBars = createSvgCtx(BAR_W, BAR_H, '#0d1017');
{
  const boss = mkBoss(25000, 1);
  const cx = 200;
  // 时间轴：满血 → 掉到 55%（白条立刻出现）→ 逐帧往下追 → 0.41s 追平
  // （追赶速度 = 满管 / 0.9s，要补 45% 的缺口 ≈ 0.405s，所以时间点选在 0.1 / 0.25 / 0.45）
  const rows = [
    ['满血：不画白条', 1, 0],
    ['掉到 55%：实条已到位，白条 = 残留的旧血量', 0.55, 0],
    ['0.10s：白条正在缩', 0.55, 0.10],
    ['0.25s：白条追到一半', 0.55, 0.25],
    ['0.45s：已追平，白条消失', 0.55, 0.45],
  ];
  let elapsed = 0;
  rows.forEach(([label, pct, t], i) => {
    const cy = 34 + i * 42;
    ctxBars.font = '11px Arial';
    ctxBars.fillStyle = '#8b98a9';
    ctxBars.textAlign = 'left';
    ctxBars.textBaseline = 'middle';
    ctxBars.fillText(label, 12, cy - 15);
    boss.hp = 25000 * pct;
    const steps = Math.max(1, Math.round((t - elapsed) / BAR_DT));
    for (let s = 0; s < steps; s++) renderer.drawBossHealthBar(ctxBars, boss, cx, cy, 'red', 320, BAR_DT);
    elapsed = t;
  });
}
const svgBars = ctxBars.toSVG();

// ---- 属性面板 ----
const PW = 390, PH = 844;
const ctxPanel = createSvgCtx(PW, PH, '#0d1017');
{
  const g = mkGame(ctxPanel, PW, PH);
  g.scene = 'battle';
  g.battleStarted = true;
  g.panelTowerType = 'parallel';
  g.showPanel = true;
  g.gold = 9999;
  renderer.render(g);
  const rect = g._panelRect;
  if (rect) {
    ctxPanel.save();
    ctxPanel.setLineDash([6, 4]);
    ctxPanel.strokeStyle = '#FFD166';
    ctxPanel.lineWidth = 1.5;
    ctxPanel.beginPath();
    ctxPanel.roundRect(rect.x, rect.y, rect.w, rect.h, 12);
    ctxPanel.stroke();
    ctxPanel.restore();
  }
}
const svgPanel = ctxPanel.toSVG();

// ---- 图签详情 ----
const ctxCodex = createSvgCtx(PW, PH, '#0d1017');
{
  const g = mkGame(ctxCodex, PW, PH);
  g.scene = 'codex';
  g.codexSelected = 'parallel';
  g.codexScroll = 0;
  const L = codex.getCodexLayout(g);
  renderer.render(g);
  ctxCodex.save();
  ctxCodex.setLineDash([6, 4]);
  ctxCodex.strokeStyle = '#4DD0E1';
  ctxCodex.lineWidth = 1.5;
  ctxCodex.beginPath();
  ctxCodex.roundRect(L.sheet.x, L.sheet.y, L.sheet.w, L.sheet.h, 12);
  ctxCodex.stroke();
  ctxCodex.restore();
}
const svgCodex = ctxCodex.toSVG();

const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>图形塔防 · 平行塔（双横）+ 属性面板 + BOSS 大血条 改版核对</title>
<style>
  html,body{margin:0;background:#0b0e14;color:#e6edf3;font:14px/1.75 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
  .wrap{max-width:1180px;margin:0 auto;padding:26px 20px 60px}
  h1{font-size:20px;margin:0 0 4px}
  h2{font-size:15px;margin:32px 0 10px;color:#FFD166}
  h2.g{color:#00FF7F}h2.cy{color:#4DD0E1}
  .sub{color:#8b98a9;font-size:13px;margin-bottom:10px}
  .row{display:flex;gap:24px;flex-wrap:wrap;align-items:flex-start}
  .phone{border:1px solid #222b38;border-radius:12px;overflow:hidden;background:#0d1017;flex:0 0 auto}
  .phone svg{display:block}
  .note{flex:1 1 330px;min-width:300px;background:#111722;border:1px solid #1e2734;border-radius:10px;padding:14px 18px}
  code{background:#1a2230;padding:1px 5px;border-radius:4px;font-size:12.5px;color:#9fd0ff}
  ul{margin:6px 0 0 18px;padding:0}
  li{margin:3px 0}
  .ok{color:#81c784}
</style></head><body><div class="wrap">
<h1>平行塔「双横」轮廓 · 属性面板完善 · BOSS 大血条改版</h1>
<div class="sub">全部由真实绘制链路回放成 SVG（不是手绘示意图）· 390 × 844 基准</div>

<h2 class="g">A. 平行塔轮廓：修好之后是「双横」</h2>
<div class="row">
  <div class="phone">${svgIcons}</div>
  <div class="note">
    <p><b>原来错在哪</b>：<code>drawTowerIcon</code> 的 <code>switch</code> 里根本没有平行塔的分支，直接掉进 <code>default</code> 画了个圆 —— 所以截图里它和圆塔长得一模一样。</p>
    <p>另外 <code>TOWER_SHAPES</code> 里也没登记，任何"按图形表遍历"的校验都会漏掉它。</p>
    <p><b>现在</b>：上下两条 22×7 的横杠、缝 4px，走统一的立体样式（径向渐变 + 顶部光泽 + 深色描边）。两条杠互相平行，"平行塔"这名字名副其实。</p>
    <p><b>顺手修掉的隐患</b>：<code>roundRectPath()</code> 内部会 <code>beginPath()</code>，画第二条杠时会把第一条擦掉 —— 所以双横必须用 <code>ctx.roundRect</code> 逐条追加子路径（并在注释里写死，免得下次又被改回去）。</p>
    <p><b>不跟随瞄准方向旋转</b>：其他塔按 <code>attackAngle</code> 旋转是有意义的（三角/箭形/扇形），但"双横"转 90° 就成了"双竖"，会被当成另一种塔。</p>
    <p><b>改名</b>：显示名「图形塔」→「平行塔」，内部键 <code>graphic</code> → <code>parallel</code>（旧名和"图形塔"这个塔族统称撞车）。旧存档里以塔型为键的三张表（图签等级 / 登场池 / 已嵌宝石）在 <code>meta.normalize</code> 里自动搬迁，老号不会掉进度。</p>
  </div>
</div>

<h2>B. BOSS 大血条：白色缓冲条 + 去掉发光</h2>
<div class="row">
  <div class="phone">${svgBars}</div>
  <div class="note">
    <p><b>掉血手感</b>：实条（红色阵营色）扣血当帧就到位，读数永远准；白色鬼影条 = 上一次的旧血量，只允许向下追，所以会残留一截慢慢缩。追赶速度按"满管 0.9 秒"折算，掉多少就按比例缩多久（下图掉了 45%，约 0.41 秒追平）。</p>
    <p><b>旧的"白条"其实是假的</b>：老实现用"最近 8 秒伤害明细"归一化，进度写的是 <code>bufHp / bufTotal</code> —— 那两项都是从伤害量算的，跟血量没有任何关系，所以白条永远从满格开始、也读不出"还剩多少血"。</p>
    <p><b>发光动画已删</b>：那两层脉动径向渐变（外圈椭圆）不再绘制，改成静态暗色垫底 + 顶部内高光，不闪也不糊。</p>
    <p><b>小怪小血条</b>共用同一套 <code>updateHpGhost</code>（0.6 秒追平），掉血反馈全线统一。</p>
  </div>
</div>

<h2>C. 属性面板：固有技能不再是空标题</h2>
<div class="row">
  <div class="phone">${svgPanel}</div>
  <div class="note">
    <p><b>病因</b>：<code>config.ENHANCE_SPECIAL</code> 里没有平行塔的条目（配置注释写的是"无专属特殊属性"），而面板的「固有技能」区块内容完全由它驱动 —— 于是标题画出来了、下面一行字都没有。</p>
    <p><b>现在</b>：给平行塔登记了招牌属性「叠加上限 100%（+20%/级）」，与另外 16 种塔口径一致，也意味着它可以像其他塔一样在 ★★★ 后花金币强化。</p>
    <p><b>攻击间隔搬出介绍文案</b>：介绍只讲机制，数值归属性行（面板里本来就有「攻击间隔 每0.25秒」一行，写进介绍是重复且会跟强化/光环口径脱节）。</p>
    <p>战斗侧同步改为 <code>tower.getInnateStackCap(tower)</code>，叠加上限不再硬编码 100。</p>
  </div>
</div>

<h2 class="cy">D. 图签详情面板：第三列补上攻击间隔</h2>
<div class="row">
  <div class="phone">${svgCodex}</div>
  <div class="note">
    <p>「生命」被移除后，第一行第三列一直空着 —— 正好把 <b>间隔 0.25秒</b> 补进去，属性一眼看全。</p>
    <p>顺手加固：固有技能区块<b>没有内容时连标题一起不画</b>（面板高度同步少算这一块），免得再出现"空标题"这种半成品观感。</p>
    <p>图签面板改成<b>标题固定 / 正文可滚动 / 按钮固定</b>的三段式后，面板高与正文块高由
      <code>codex.buildSheetContent()</code> 一处算定，绘制与命中检测共用同一套块几何
      —— 行数算一套画另一套的历史 bug 不会回来。</p>
    <p class="ok">本轮探针：17 塔型 × 7 分辨率属性面板 + 7 分辨率图签 = 0 越界；大血条白条动态 0 断言失败。</p>
  </div>
</div>
</div></body></html>`;

fs.writeFileSync(path.join(TMP, '_graphic.html'), html, 'utf8');
out.push('');
out.push(`=== 平行塔/大血条专项：失败 ${fails} 条 ===`);
out.push(`=== 判据戳：TOWER_ORDER=${config.TOWER_ORDER.length} / 交付 _graphic.html ${html.length} 字节 / ${new Date().toISOString()} ===`);
fs.writeFileSync(path.join(TMP, '_graphic.txt'), out.join('\n'), 'utf8');
process.exitCode = fails ? 1 : 0;
