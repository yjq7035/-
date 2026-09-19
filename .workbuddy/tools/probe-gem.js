// ============================================================================
// 宝石系统 + 背包栏 专项探针 —— .workbuddy/tools/probe-gem.js
// ----------------------------------------------------------------------------
// 这一轮（2026-09）新增的两块内容一起测，因为它们共用同一份数据：
//   · 宝石系统（需求 5/3）：图签每升 1 级 +1 个嵌入槽（最多 5）；
//     嵌入后宝石从背包消失、与固有技能绑定、跨局永久生效
//   · 背包栏（需求 6）：导航第 5 格；默认 20 格、每行 10 格；看广告解锁 +10 格（上限 40）
//
// 断言分五组：
//   ① 配置与存档迁移（坏档不许崩、不许造出非法槽位）
//   ② 槽数 = 图签等级
//   ③ 嵌入 / 取出的全部边界（未解锁 / 已占用 / 背包满 / 背包消失）
//   ④ 战斗口径：宝石真的改变了伤害、攻速、暴击、穿透、射程、固有技能等级
//      —— 这一组最关键。历史教训：只在面板上好看、打起来没变。
//   ⑤ 背包布局：10 列 / 4 行 / 默认 20 解锁 / 格子不越出屏幕 / 渲染不抛异常
// ============================================================================
const path = require('path');
const fs = require('fs');
const { makeCtx, makeRec } = require('./harness');

global.document = { addEventListener() {}, removeEventListener() {} };
global.requestAnimationFrame = () => 0;

const ROOT = path.resolve(__dirname, '..', '..');
const out = [];
let fails = 0;
const log = (s) => out.push(s);
const ok = (name, cond, detail) => {
  if (!cond) fails++;
  log(`${cond ? '  ok  ' : ' FAIL '} ${name}${detail ? '  → ' + detail : ''}`);
};

let Game, config, meta, gems, towerMod, skillSlot, bag, renderer, input, gemModal, skills;
try {
  Game = require(path.join(ROOT, 'src', 'game_core'));
  config = require(path.join(ROOT, 'src', 'config'));
  meta = require(path.join(ROOT, 'src', 'meta'));
  gems = require(path.join(ROOT, 'src', 'gems'));
  towerMod = require(path.join(ROOT, 'src', 'tower'));
  skillSlot = require(path.join(ROOT, 'src', 'skillSlot'));
  skills = require(path.join(ROOT, 'src', 'skills'));
  bag = require(path.join(ROOT, 'src', 'bag'));
  renderer = require(path.join(ROOT, 'src', 'renderer'));
  input = require(path.join(ROOT, 'src', 'input'));
  gemModal = require(path.join(ROOT, 'src', 'gemModal'));
} catch (e) {
  fs.writeFileSync(path.join(__dirname, '_gem_error.txt'), (e && e.stack) || String(e), 'utf8');
  process.exit(1);
}

const rec = makeRec();
const ctx = makeCtx(rec);
function mkGame(W, H) {
  const canvas = { width: W, height: H, addEventListener() {}, removeEventListener() {}, getContext() { return ctx; } };
  return new Game(canvas, ctx, { screenWidth: W, screenHeight: H, renderScale: 1 });
}

/** 走完整输入链路点一下（touchstart + touchend） */
function tapAt(g, x, y) {
  const ev = { touches: [{ clientX: x, clientY: y, x, y }], changedTouches: [{ clientX: x, clientY: y, x, y }] };
  input.handleTouchStart(g, ev);
  input.handleTouchEnd(g, ev);
}

// 从干净存档开始（node 环境无 wx → 缓存只在内存里）
meta.resetAll();

// ============================================================================
log('===== ① 配置与存档迁移 =====');
{
  const bad = config.GEM_KINDS.filter((k) => !k.id || !k.name || !/^#[0-9A-Fa-f]{6}$/.test(k.color || '')
    || !k.effect || !k.desc);
  ok('每种宝石都有 id / 名称 / 合法颜色 / 效果 / 文案', bad.length === 0,
    bad.length ? bad.map((k) => k.id).join(',') : `${config.GEM_KINDS.length} 种`);

  const dup = config.GEM_KINDS.length !== Object.keys(gems.GEM_DEFS).length;
  ok('宝石 id 无重复', !dup, `表 ${config.GEM_KINDS.length} / 字典 ${Object.keys(gems.GEM_DEFS).length}`);

  const m = meta.createDefaultMeta();
  ok('新档背包格数 = GEM.bagSlots（每行 8 格 × 3 行）', m.bagSlots === config.GEM.bagSlots,
    `bagSlots=${m.bagSlots} 上限=${config.GEM.bagMaxSlots}`);
  ok('新档赠送宝石按 GEM.starterGems 发放', m.gems.length === config.GEM.starterGems.length,
    `[${m.gems.map((g) => g.kind).join(',')}]`);
  ok('赠送宝石都是合法种类', m.gems.every((g) => !!gems.gemDef(g.kind)), '');

  // 坏档：槽位多于图签等级 / 未知宝石 / 非数组 / bagSlots 越界 → 全被夹干净
  const norm = meta.normalize({
    codex: { triangle: 1 },                          // 只解锁 1 级 → 只该有 1 个槽
    socketed: {
      triangle: ['ruby', 'topaz', 'emerald', 'opal', 'amethyst'],  // 越界塞了 5 个
      __unknown_tower__: ['ruby'],
      parallel: ['not_a_gem', 'ruby'],               // 未解锁 + 未知宝石
    },
    gems: [
      { uid: 'x1', kind: 'ruby' },
      { uid: 'x1', kind: 'topaz' },                  // uid 重复
      { uid: 'x3', kind: 'nope' },                   // 未知种类
      'garbage',
    ],
    bagSlots: 999,
    gemSeq: 2,
  });
  const triSlots = norm.socketed.triangle || [];
  ok('坏档：槽位数被夹到图签等级（1）', triSlots.filter((k) => !!k).length <= 1,
    `保留 [${triSlots.map((k) => (k && k.kind) || k || '-').join(',')}]`);
  ok('坏档：未解锁塔型的记录被丢弃', norm.socketed.parallel === undefined);
  ok('坏档：越界 bagSlots 被夹回上限', norm.bagSlots === config.GEM.bagMaxSlots, `bagSlots=${norm.bagSlots}`);
  ok('坏档：未知宝石被剔除', norm.gems.every((g) => !!gems.gemDef(g.kind)),
    `[${norm.gems.map((g) => g.kind).join(',')}]`);
  ok('坏档：uid 保持唯一', new Set(norm.gems.map((g) => g.uid)).size === norm.gems.length,
    `[${norm.gems.map((g) => g.uid).join(',')}]`);

  // 合成系统（2026-09）带来两代格式：旧档槽位是字符串、宝石没有 lv 字段 → 读档统一搬进 {kind, lv}
  const normOld = meta.normalize({
    codex: { triangle: 3 },
    socketed: { triangle: ['ruby', { kind: 'opal', lv: 3 }, 'bogus'] },
    gems: [{ uid: 'a1', kind: 'ruby' }, { uid: 'a2', kind: 'opal', lv: 2 }, { uid: 'a3', kind: 'ruby', lv: 0 }],
  });
  const oldTri = normOld.socketed.triangle || [];
  ok('旧档：字符串槽位迁移为 {kind, lv:1}',
    oldTri[0] && oldTri[0].kind === 'ruby' && oldTri[0].lv === 1,
    JSON.stringify(oldTri[0]));
  ok('新档：对象槽位原样保留 {kind, lv}',
    oldTri[1] && oldTri[1].kind === 'opal' && oldTri[1].lv === 3,
    JSON.stringify(oldTri[1]));
  ok('旧档：无 lv / 非法 lv 的背包宝石一律补 Lv.1',
    normOld.gems.every((g) => g.lv >= 1) && normOld.gems[0].lv === 1 && normOld.gems[2].lv === 1,
    `[${normOld.gems.map((g) => g.kind + ':Lv' + g.lv).join(',')}]`);
  ok('旧档：非法种类槽位被剔除', oldTri[2] === null, JSON.stringify(oldTri[2]));
}

// ============================================================================
log('\n===== ② 槽数 = 图签等级（每升 1 级解锁 1 个，最多 5）=====');
{
  let bad = [];
  for (const type of config.TOWER_ORDER) {
    const lv = meta.codexLevel(type);
    const expect = Math.min(config.GEM.maxSlots, lv);
    const got = meta.socketCount(type);
    if (got !== expect) bad.push(`${type} lv${lv}→${got}≠${expect}`);
  }
  ok('全部塔型：socketCount = min(图签等级, 5)', bad.length === 0, bad.join(' ') || '17/17 一致');

  // 升到满级后槽数必须封顶在 5（不是 6、不是 5.5）
  meta.grantPoints(999999);
  const t = config.TOWER_ORDER[0];
  for (let i = 0; i < config.CODEX.maxLevel; i++) meta.upgradeCodex(t);
  ok('图签满级后恰好 5 个槽（封顶）',
    meta.socketCount(t) === config.GEM.maxSlots && meta.codexLevel(t) === config.CODEX.maxLevel,
    `图签 Lv.${meta.codexLevel(t)} → 槽 ${meta.socketCount(t)}`);
  ok('槽位状态数组长度恒为 maxSlots（UI 定长绘制）', meta.gemSockets(t).length === config.GEM.maxSlots);
}

// ============================================================================
log('\n===== ③ 嵌入 / 取出的边界 =====');
{
  meta.resetAll();
  const T = config.SHOP_TOWERS[0];            // 默认解锁 → 1 个槽
  ok('默认解锁塔有 1 个槽', meta.socketCount(T) === 1, `${T} Lv.${meta.codexLevel(T)}`);

  // 保证背包有货（新档 starterGems 为空、掉落不保证，探测先播种）
  if (meta.gemList().length === 0) {
    for (const k of ['ruby', 'topaz', 'emerald', 'amethyst', 'sapphire', 'opal']) meta.addGem(k);
  }
  const bagBefore = meta.gemList().length;
  const ruby = meta.gemList().filter((g) => g.kind === 'ruby')[0];
  ok('背包里有红宝石可嵌', !!ruby, `[${meta.gemList().map((g) => g.kind).join(',')}]`);

  // 1) 未解锁的槽（index 1，图签只有 Lv.1）→ 必须拒绝
  const r1 = meta.embedGem(T, 1, ruby.uid);
  ok('嵌入未解锁的槽被拒绝且不动背包',
    r1.ok === false && r1.reason === 'locked' && meta.gemList().length === bagBefore,
    `reason=${r1.reason} 背包 ${meta.gemList().length}`);

  // 2) 正常嵌入
  const r2 = meta.embedGem(T, 0, ruby.uid);
  ok('嵌入成功', r2.ok && r2.kind === 'ruby', `kind=${r2.kind}`);
  ok('嵌入后宝石从背包消失（需求原话）',
    meta.gemList().length === bagBefore - 1 && !meta.gemList().some((g) => g.uid === ruby.uid),
    `背包 ${bagBefore}→${meta.gemList().length}`);
  ok('嵌入后该塔型记录到槽位', meta.embeddedGems(T).indexOf('ruby') >= 0,
    `[${meta.embeddedGems(T).join(',')}]`);

  // 3) 往同一个槽再嵌 → 必须拒绝（不能覆盖、不能吞掉第二颗）
  const bagMid = meta.gemList().length;
  const other = meta.gemList()[0];
  if (other) {
    const r3 = meta.embedGem(T, 0, other.uid);
    ok('往已占用的槽嵌入被拒绝',
      r3.ok === false && r3.reason === 'occupied' && meta.gemList().length === bagMid,
      `reason=${r3.reason}`);
  }

  // 4) 取出
  const r4 = meta.takeGem(T, 0);
  ok('取出成功且宝石回到背包',
    r4.ok && r4.kind === 'ruby' && meta.gemList().length === bagBefore,
    `背包 ${meta.gemList().length}`);

  // 5) 空槽取出 → 拒绝
  const r5 = meta.takeGem(T, 0);
  ok('取出空槽被拒绝（reason=empty）', r5.ok === false && r5.reason === 'empty', `reason=${r5.reason}`);

  // 6) 背包满时绝不能取出（否则宝石会被"取出来又没地方放"地吞掉）
  //    ⚠️ 顺序很重要：必须先 embed（embed 会从背包拿走一颗、腾出一格），
  //       再把背包灌满，最后才 take —— 反过来写的话"满"的前提在 embed 那一步就没了。
  const g6 = meta.get();
  const maxN = g6.bagSlots;
  const backupGems = g6.gems.slice();
  const backupSock = JSON.parse(JSON.stringify(g6.socketed));

  g6.gems = [];
  g6.gemSeq = (g6.gemSeq || 0) + 1;
  g6.gems.push({ uid: 'seed1', kind: 'topaz' });
  const rEmbed = meta.embedGem(T, 0, 'seed1');       // 先嵌进去（背包随之空出来）
  while (g6.gems.length < maxN) {                    // 再把背包灌满
    g6.gemSeq = (g6.gemSeq || 0) + 1;
    g6.gems.push({ uid: 'fill' + g6.gemSeq, kind: 'ruby' });
  }
  const r6 = meta.takeGem(T, 0);                     // 现在取出必须被拦
  ok('背包满时拒绝取出（绝不吞宝石）',
    rEmbed.ok && r6.ok === false && r6.reason === 'full' && meta.embeddedGems(T).indexOf('topaz') >= 0,
    `embed=${rEmbed.ok}:${rEmbed.reason || '-'} / take=${r6.ok}:${r6.reason || '-'} 背包 ${g6.gems.length}/${maxN} 槽内 [${meta.embeddedGems(T).join(',')}]`);
  // 还原
  g6.gems = backupGems;
  g6.socketed = backupSock;
}

// ============================================================================
log('\n===== ④ 战斗口径：宝石必须真的改变战斗数值 =====');
{
  meta.resetAll();
  const g = mkGame(390, 844);
  const T = config.SHOP_TOWERS[0];
  const tower = { type: T, level: 1, stage: 0, attackPowerBoost: 0, enhanceLevel: 0, enhanceAttrs: {} };
  // 播种（新档背包是空的，六个种类各来一颗，战斗口径每条都要真的嵌得上）
  for (const k of ['ruby', 'topaz', 'emerald', 'amethyst', 'sapphire', 'opal']) meta.addGem(k);
  const BAG = meta.gemList().map((x) => x.uid);

  const dmgBefore = g.towerDamage(tower, 100);
  const profBefore = towerMod.getAttackProfile(tower);
  const rtBefore = towerMod.getTowerRuntimeStats(tower);

  // —— 红宝石：攻击力 +8%（乘算）——
  const ruby = meta.gemList().filter((x) => x.kind === 'ruby')[0];
  meta.embedGem(T, 0, ruby.uid);
  const dmgAfter = g.towerDamage(tower, 100);
  ok('红宝石让最终伤害 ×1.08（乘算，与图签同一条绿字链）',
    Math.abs(dmgAfter / dmgBefore - 1.08) < 1e-6,
    `${dmgBefore.toFixed(2)} → ${dmgAfter.toFixed(2)}（×${(dmgAfter / dmgBefore).toFixed(4)}）`);
  const mult = towerMod.getGemDamageMultiplier(T);
  ok('getGemDamageMultiplier 与伤害链同源', Math.abs(mult - 1.08) < 1e-6, `mult=${mult}`);

  // 取出，回到起点
  meta.takeGem(T, 0);
  ok('取出后伤害回到原值', Math.abs(g.towerDamage(tower, 100) - dmgBefore) < 1e-6);

  // —— 翡翠：暴击率 +6% ——
  const em = meta.gemList().filter((x) => x.kind === 'emerald')[0];
  if (em) {
    meta.embedGem(T, 0, em.uid);
    const p = towerMod.getAttackProfile(tower);
    const def = gems.gemDef('emerald');
    ok('翡翠让暴击率 +6%',
      Math.abs(p.critChance - (profBefore.critChance + def.effect.critChance)) < 1e-6,
      `${profBefore.critChance}% → ${p.critChance}%`);
    meta.takeGem(T, 0);
  }

  // —— 黄玉：穿透 +6 ——
  const tp = meta.gemList().filter((x) => x.kind === 'topaz')[0]
    || (meta.addGem('topaz'), meta.gemList().filter((x) => x.kind === 'topaz')[0]);
  if (tp) {
    meta.embedGem(T, 0, tp.uid);
    const p = towerMod.getAttackProfile(tower);
    ok('黄玉让穿透 +6',
      Math.abs(p.penetration - (profBefore.penetration + gems.gemDef('topaz').effect.penetration)) < 1e-6,
      `${profBefore.penetration} → ${p.penetration}`);
    meta.takeGem(T, 0);
  }

  // —— 紫晶：技能效果 +16%（放大固有技能「致命一击」两条效果的当前值）——
  //    三角塔 = 暴击几率 5% → 5.8%（5% × 16%）、暴击伤害 220% → 221.6%（10% × 16%）。
  //    ⚠️ 它**不碰攻击力** —— 曾被误当成「攻击力 +16%」叠在基础攻击上（口径打架）。
  const am = meta.gemList().filter((x) => x.kind === 'amethyst')[0] || (meta.addGem('amethyst'), meta.gemList().filter((x) => x.kind === 'amethyst')[0]);
  if (am) {
    const dmgPre = g.towerDamage(tower, 100);
    meta.embedGem(T, 0, am.uid);
    const p = towerMod.getAttackProfile(tower);
    const pct = gems.gemDef('amethyst').effect.skillEffectPercent / 100;
    ok('紫晶让暴击几率吃到「技能效果 +16%」（5% → 5.8%）',
      Math.abs(p.critChance - profBefore.critChance * (1 + pct)) < 1e-6,
      `${profBefore.critChance}% → ${p.critChance}%`);
    ok('紫晶让暴击伤害也吃到「技能效果 +16%」（220% → 221.6%）',
      Math.abs(p.critMult - profBefore.critMult - (config.TOWER_STATS.triangle.critDamage * pct) / 100) < 1e-6,
      `${profBefore.critMult.toFixed(3)} → ${p.critMult.toFixed(3)}`);
    ok('紫晶不加攻击力（技能效果 ≠ 攻击力）',
      Math.abs(g.towerDamage(tower, 100) - dmgPre) < 1e-6,
      `${dmgPre.toFixed(2)} → ${g.towerDamage(tower, 100).toFixed(2)}`);
    meta.takeGem(T, 0);
  }

  // —— 蓝宝石：攻速 +10 ——
  const sp = meta.gemList().filter((x) => x.kind === 'sapphire')[0] || (meta.addGem('sapphire'), meta.gemList().filter((x) => x.kind === 'sapphire')[0]);
  if (sp) {
    meta.embedGem(T, 0, sp.uid);
    const rt = towerMod.getTowerRuntimeStats(tower);
    const base = (before) => (before.attackSpeedMultiplier || 0);
    ok('蓝宝石让攻速 +10',
      Math.abs(rt.attackSpeedMultiplier - (base(rtBefore) + gems.gemDef('sapphire').effect.attackSpeedMultiplier)) < 1e-6,
      `${base(rtBefore)} → ${rt.attackSpeedMultiplier}`);
    meta.takeGem(T, 0);
  }

  // —— 猫眼石：固有技能 +1 级（"宝石与技能绑定"的落地点）——
  // 用平行塔：它的固有技能是「叠加上限」，宝石 +1 级 → 上限 +per。
  meta.grantPoints(999999);
  meta.upgradeCodex('parallel');
  const pt = { type: 'parallel', enhanceLevel: 0, enhanceAttrs: {} };
  const capBefore = towerMod.getInnateStackCap(pt);
  const opal = meta.addGem('opal').gem;
  const slotsP = meta.socketCount('parallel');
  const r = meta.embedGem('parallel', slotsP - 1, opal.uid);
  const capAfter = towerMod.getInnateStackCap(pt);
  const spDef = skills.getEffects('parallel')[0];
  ok('猫眼石让固有技能等级 +1',
    towerMod.getSkillGemLevels('parallel') === 1 && towerMod.getEffectiveSkillLevel(pt) === 2,
    `宝石等级=${towerMod.getSkillGemLevels('parallel')} 有效等级=${towerMod.getEffectiveSkillLevel(pt)}`);
  ok('固有技能等级 +1 真的抬高了战斗数值（叠加上限）',
    r.ok && Math.abs(capAfter - (capBefore + spDef.per)) < 1e-6,
    `${spDef.name}: ${capBefore} → ${capAfter}（per=${spDef.per}${spDef.unit}）`);
  ok('技能槽显示的 Lv 与战斗口径一致（Lv.1 默认 + 宝石 1 级 = Lv.2）',
    skillSlot.buildSkillSlots(null, 'parallel', null, 280)[0].level === 2,
    `槽内 Lv.${skillSlot.buildSkillSlots(null, 'parallel', null, 280)[0].level}`);

  // —— 宝石加成汇总（面板 / 图签 / 战斗共用的那一份）——
  const bonus = gems.bonusForType('parallel');
  ok('bonusForType 汇总到 embed 的宝石', bonus.count === 1 && bonus.skillLevels === 1,
    `count=${bonus.count} kinds=[${bonus.kinds.join(',')}] skillLevels=${bonus.skillLevels}`);

  meta.resetAll();
}

// ============================================================================
log('\n===== ⑤ 背包布局与渲染 =====');
{
  meta.resetAll();
  const RES = [[320, 568], [375, 667], [390, 844], [428, 926]];
  const COLS = config.GEM.bagCols;                       // 8
  const ROWS = Math.ceil(config.GEM.bagMaxSlots / COLS); // 15 行封顶
  for (const [W, H] of RES) {
    const g = mkGame(W, H);
    g.scene = 'bag';
    const L = bag.getBagLayout(g);

    ok(`${W}x${H} 每行 ${COLS} 格`, L.cols === COLS, `cols=${L.cols}`);
    ok(`${W}x${H} 行数 = 上限 ${config.GEM.bagMaxSlots} ÷ ${COLS} = ${ROWS}`,
      L.rows === ROWS && L.cells.length === config.GEM.bagMaxSlots,
      `rows=${L.rows} cells=${L.cells.length}`);

    // 同一行前 COLS 格 y 相同、x 递增；第 COLS+1 格换行
    const row0 = L.cells.slice(0, COLS);
    const sameY = row0.every((c) => Math.abs(c.y - row0[0].y) < 0.01);
    const incX = row0.every((c, i) => i === 0 || c.x > row0[i - 1].x + 1);
    ok(`${W}x${H} 第一行 ${COLS} 格同高、横向递增`, sameY && incX,
      `y=${row0[0].y.toFixed(0)} x=${row0[0].x.toFixed(0)}…${row0[COLS - 1].x.toFixed(0)} w=${L.cellW}`);
    ok(`${W}x${H} 第 ${COLS + 1} 格换到下一行`, L.cells[COLS].y > L.cells[0].y + 1,
      `y ${L.cells[0].y.toFixed(0)} → ${L.cells[COLS].y.toFixed(0)}`);

    // 默认解锁 bagSlots 格，其余上锁
    const unlockedN = L.cells.filter((c) => c.unlocked).length;
    ok(`${W}x${H} 默认解锁 ${config.GEM.bagSlots} 格`,
      unlockedN === config.GEM.bagSlots && L.unlocked === config.GEM.bagSlots,
      `解锁 ${unlockedN} / 共 ${L.cells.length}`);

    // 格子不许越出屏幕（横向；纵向靠滚动，超出的被视口裁掉）
    const outX = L.cells.filter((c) => c.x < -0.5 || c.x + c.w > W + 0.5);
    ok(`${W}x${H} 全部格子横向在屏幕内`, outX.length === 0,
      outX.length ? `${outX.length} 格越界（最右 ${outX[0].x + outX[0].w} vs ${W}）` : `cellW=${L.cellW}`);

    // 最后一个已解锁格不压住解锁按钮
    const lastUnlocked = L.cells[config.GEM.bagSlots - 1];
    ok(`${W}x${H} 已解锁格网不压到解锁按钮`, lastUnlocked.y + lastUnlocked.h <= L.btn.y + 0.5,
      `格网底 ${(lastUnlocked.y + lastUnlocked.h).toFixed(0)} ≤ 按钮顶 ${L.btn.y.toFixed(0)}`);

    // 真实渲染（含全部格子 + 锁）
    rec.texts.length = 0; rec.rects.length = 0; rec.clips.length = 0; rec.ops.length = 0;
    let err = null;
    try { renderer.render(g); } catch (e) { err = e; }
    ok(`${W}x${H} 背包渲染不抛异常`, !err, err ? `${err.constructor.name}: ${err.message}` : `指令 ${rec.ops.length + rec.texts.length} 条`);
  }

  // 广告开关：关着的时候解锁按钮必须置灰（渲染层文案）且动作被拒
  const g = mkGame(390, 844);
  g.scene = 'bag';
  const before = meta.bagSlots();
  const res = bag.actExpandBag(g);
  ok('广告未开放：动作被拒且不改存档',
    (!config.AD.enabled) ? (res.ok === false && meta.bagSlots() === before) : true,
    `AD.enabled=${config.AD.enabled} reason=${res.reason} slots=${meta.bagSlots()}`);

  // 直接调 meta 扩容（模拟广告看完后的入账）应能到 bagMaxSlots 封顶
  let n = meta.bagSlots();
  while (meta.canExpandBag()) meta.expandBag();
  ok(`扩容每次 +${config.GEM.bagStep}，封顶 ${config.GEM.bagMaxSlots}`,
    meta.bagSlots() === config.GEM.bagMaxSlots,
    `${n} → ${meta.bagSlots()}`);
  meta.resetAll();
}

// ============================================================================
log('\n===== ⑥ 合成宝石（同级多选 · 成功率 · 随机种类 +1 级）=====');
{
  meta.resetAll();
  // 成功率曲线：3 颗 50% 起，每多 1 颗 +10%，封顶 100%
  const rateCases = [[3, 0.5], [4, 0.6], [5, 0.7], [8, 1.0], [12, 1.0]];
  let bad = [];
  for (const [n, want] of rateCases) {
    const got = meta.synthRate(n);
    if (Math.abs(got - want) > 1e-9) bad.push(`${n}→${got}≠${want}`);
  }
  ok('成功率曲线：50% 起 / 每多 1 颗 +10% / 封顶 100%', bad.length === 0, bad.join(' ') || '3→50% … 8→100%');

  // 播种：3 颗红宝石 + 1 颗 Lv.2 猫眼石 + 2 颗蓝宝石
  meta.addGemsByKind('ruby', 3);
  meta.addGemsByKind('sapphire', 2);
  meta.addGem('opal', 2);
  const bagAtStart = meta.gemList().length;

  const rubies = meta.gemList().filter((x) => x.kind === 'ruby').map((x) => x.uid);
  const sapphires = meta.gemList().filter((x) => x.kind === 'sapphire').map((x) => x.uid);
  const opal = meta.gemList().filter((x) => x.kind === 'opal')[0];

  // —— 校验：数量不足 / 混等级 必须被拒（存档一字不动）——
  const r2 = meta.synthesizeGems(rubies.slice(0, 2));
  ok('少于 3 颗被拒（reason=count）', r2.ok === false && r2.reason === 'count', `reason=${r2.reason}`);
  const rMix = meta.synthesizeGems([rubies[0], rubies[1], rubies[2], opal.uid]);
  ok('混选不同等级被拒（reason=level）', rMix.ok === false && rMix.reason === 'level', `reason=${rMix.reason}`);
  ok('被拒的合成不动存档', meta.gemList().length === bagAtStart, `背包 ${meta.gemList().length}`);
  const rGhost = meta.synthesizeGems(rubies.concat(['g99999']));
  ok('材料里混入不存在的 uid 被拒', rGhost.ok === false && rGhost.reason === 'nogem', `reason=${rGhost.reason}`);

  // —— 强制失败：材料全消耗、无产物 ——
  let randomBack = Math.random;
  Math.random = () => 0.99;                       // 0.99 ≥ 50% → 失败
  const rFail = meta.synthesizeGems(rubies);
  Math.random = randomBack;
  ok('失败：材料全部消耗、没有任何产物',
    rFail.ok && rFail.success === false && meta.gemList().length === bagAtStart - 3,
    `背包 ${bagAtStart}→${meta.gemList().length} rate=${rFail.rate}`);

  // —— 强制成功：3 颗红宝石 → 1 颗 Lv.2 红宝石（全同名 → 必是该种）——
  const ruby2 = meta.addGemsByKind('ruby', 3);
  const rubies2 = meta.gemList().filter((x) => x.kind === 'ruby').map((x) => x.uid);
  Math.random = () => 0;                          // 0 < 50% → 成功
  const rWin = meta.synthesizeGems(rubies2);
  Math.random = randomBack;
  ok('成功：3 颗同级 → 1 颗产物',
    rWin.ok && rWin.success === true && meta.gemList().filter((x) => x.kind === 'ruby').length === 1,
    `rate=${rWin.rate} 背包红宝石 ${meta.gemList().filter((x) => x.kind === 'ruby').length} 颗`);
  ok('产物种类 = 材料种类（全同名）· 等级 +1',
    rWin.gem && rWin.gem.kind === 'ruby' && rWin.gem.lv === 2,
    rWin.gem ? `${rWin.gem.kind} Lv.${rWin.gem.lv}` : '无产物');

  // —— 强制成功：混种材料 → 产物种类落在材料范围内 ——
  const mixed = meta.gemList().filter((x) => x.kind === 'sapphire').map((x) => x.uid).concat([rWin.gem.uid]);
  Math.random = () => 0;
  const rMixWin = meta.synthesizeGems(mixed);     // 2 蓝宝石 + 1 红宝石（同级？不行——蓝Lv1 红Lv2）
  Math.random = randomBack;
  ok('混种但不同级被拒（产物 Lv.2 + Lv.1 蓝宝石）',
    rMixWin.ok === false && rMixWin.reason === 'level', `reason=${rMixWin.reason}`);

  // 播两颗 Lv.2 蓝宝石凑"同级混种"（红Lv2 + 蓝Lv2 + 蓝Lv2）
  const sapA = meta.addGem('sapphire', 2).gem;
  const sapB = meta.addGem('sapphire', 2).gem;
  Math.random = () => 0;
  const rMix2 = meta.synthesizeGems([rWin.gem.uid, sapA.uid, sapB.uid]);  // 红Lv2 + 蓝Lv2 + 蓝Lv2
  Math.random = randomBack;
  const mixKinds = ['ruby', 'sapphire'];
  ok('混种同级合成成功且产物 +1 级',
    rMix2.ok && rMix2.success === true && rMix2.gem && rMix2.gem.lv === 3,
    rMix2.gem ? `产物 ${rMix2.gem.kind} Lv.${rMix2.gem.lv}` : `reason=${rMix2.reason}`);
  ok('混种产物种类落在材料范围内',
    rMix2.gem && mixKinds.indexOf(rMix2.gem.kind) >= 0,
    rMix2.gem ? `产物 ${rMix2.gem.kind} ∈ [${mixKinds.join(',')}]` : '无产物');

  // —— 等级缩放真的进战斗：Lv.2 红宝石 = 攻击力 ×1.16 ——
  const g = mkGame(390, 844);
  const T = config.SHOP_TOWERS[0];
  const tower = { type: T, level: 1, stage: 0, attackPowerBoost: 0, enhanceLevel: 0, enhanceAttrs: {} };
  const dmg0 = g.towerDamage(tower, 100);
  // 混种产物可能是红/蓝，先确保手里有一颗确定的 Lv.2 红宝石
  const rubyLv2 = meta.addGem('ruby', 2).gem;
  meta.embedGem(T, 0, rubyLv2.uid);
  const dmg2 = g.towerDamage(tower, 100);
  ok('Lv.2 红宝石 = 攻击 ×1.16（效果随等级线性放大）',
    Math.abs(dmg2 / dmg0 - 1.16) < 1e-6,
    `${dmg0.toFixed(2)} → ${dmg2.toFixed(2)}（×${(dmg2 / dmg0).toFixed(4)}）`);
  meta.takeGem(T, 0);
  ok('取出后伤害回到原值', Math.abs(g.towerDamage(tower, 100) - dmg0) < 1e-6);

  // —— 槽位也带等级：嵌入 Lv.2 → 槽位记录 {kind, lv:2} → 取出回背包仍是 Lv.2 ——
  const rubyLv3 = meta.addGem('ruby', 3).gem;
  meta.embedGem(T, 0, rubyLv3.uid);
  const sock = meta.gemSockets(T)[0];
  ok('槽位记录宝石等级', sock.kind === 'ruby' && sock.lv === 3,
    `槽0 = ${sock.kind} Lv.${sock.lv}`);
  const back = meta.takeGem(T, 0);
  ok('取出后等级原样回背包',
    back.ok && meta.gemList().some((x) => x.kind === 'ruby' && x.lv === 3),
    `背包红宝石 [${meta.gemList().filter((x) => x.kind === 'ruby').map((x) => 'Lv' + x.lv).join(',')}]`);

  meta.resetAll();
}

// ============================================================================
log('\n===== ⑦ 宝石浮层端到端（背包点宝石 → 详情 → 合成，真实点击）=====');
{
  meta.resetAll();
  meta.addGemsByKind('ruby', 5);
  meta.addGemsByKind('sapphire', 2);
  const g = mkGame(390, 844);
  g.scene = 'bag';

  // ---- 背包：点有宝石的格子 → 弹详情浮层（底部只有「合成宝石」）----
  const BL = bag.getBagLayout(g);
  const cell = BL.cells.filter((c) => c.unlocked && c.item && c.item.kind === 'ruby')[0];
  ok('背包格子里有红宝石可点', !!cell, cell ? `cell#${cell.index} ${cell.item.kind}` : '没有');
  if (cell) {
    tapAt(g, cell.x + cell.w / 2, cell.y + cell.h / 2);
    ok('点背包宝石弹出详情浮层', !!g.gemInfo && g.gemInfo.uid === cell.item.uid && g.gemInfo.from === 'bag',
      g.gemInfo ? `uid=${g.gemInfo.uid} from=${g.gemInfo.from}` : '未打开');

    const il = gemModal.getGemInfoLayout(g);
    ok('背包来源的详情浮层只有「合成宝石」一项', !!(il && il.synthBtn && !il.embedBtn),
      il ? `synth=${!!il.synthBtn} embed=${!!il.embedBtn}` : '布局为空');

    // 渲染一次详情浮层（真实绘制链路不许抛异常）
    rec.texts.length = 0; rec.rects.length = 0; rec.clips.length = 0; rec.ops.length = 0;
    let err = null;
    try { renderer.render(g); } catch (e) { err = e; }
    ok('详情浮层渲染不抛异常', !err, err ? err.message : `指令 ${rec.ops.length + rec.texts.length} 条`);

    // ---- 点「合成宝石」→ 打开合成浮层，预选当前这颗 ----
    if (il && il.synthBtn) {
      tapAt(g, il.synthBtn.x + il.synthBtn.w / 2, il.synthBtn.y + il.synthBtn.h / 2);
      ok('点「合成宝石」打开合成浮层并预选当前宝石',
        !!g.gemSynth && g.gemInfo === null && Object.keys(g.gemSynth.picked).length === 1,
        g.gemSynth ? `预选 ${Object.keys(g.gemSynth.picked).length} 颗` : '未打开');

      // ---- 再勾 2 颗同级红宝石 → 已选 3 颗 · 成功率 50% ----
      const SL = gemModal.getSynthLayout(g);
      const more = SL.rows.filter((r) => r.selectable && !r.selected && r.kind === 'ruby' && r.visible).slice(0, 2);
      ok('合成列表里还有可选的同级红宝石', more.length === 2, `可选 ${more.length} 颗`);
      for (const row of more) {
        tapAt(g, row.rect.x + row.rect.w / 2, row.rect.y + row.rect.h / 2);
      }
      const SL2 = gemModal.getSynthLayout(g);
      ok('勾选 3 颗同级后可以合成 · 成功率 50%',
        SL2.count === 3 && SL2.canGo && Math.abs(SL2.rate - 0.5) < 1e-9,
        `count=${SL2.count} canGo=${SL2.canGo} rate=${SL2.rate}`);

      // 异级行必须被拦住：升一颗 Lv.2 蓝宝石进背包，它不在"红宝石 Lv.1"锚点内
      meta.addGem('sapphire', 2);
      const SL3 = gemModal.getSynthLayout(g);
      const lv2Row = SL3.rows.filter((r) => r.kind === 'sapphire' && r.lv === 2)[0];
      ok('Lv.2 蓝宝石行因"等级不符"被禁用', !!lv2Row && !lv2Row.selectable,
        lv2Row ? `selectable=${lv2Row.selectable}` : '行不存在');
      if (lv2Row) {
        tapAt(g, lv2Row.rect.x + lv2Row.rect.w / 2, lv2Row.rect.y + lv2Row.rect.h / 2);
        const SL4 = gemModal.getSynthLayout(g);
        ok('点"等级不符"的行不改变已选集合', SL4.count === 3,
          `count=${SL4.count}（应仍为 3）`);
      }

      // ---- 强制成功：点「开始合成」→ 背包少 3 多 1，产物 Lv.2 红宝石 ----
      // 布局必须现取现点：上一步 addGem 让列表多了一行、面板随之长高，goBtn 整体下移 ——
      // 拿旧引用 SL2.goBtn 去点，点的是按钮原来的位置，会被模态层当空白吞掉（2026-09-18 实测）。
      const SLGo = gemModal.getSynthLayout(g);
      ok('点合成前重取布局仍可合成（面板随列表长高）',
        SLGo.count === 3 && SLGo.canGo && SLGo.goBtn.y > SL2.goBtn.y,
        `goBtn y ${SL2.goBtn.y} → ${SLGo.goBtn.y}`);
      const bagBeforeSynth = meta.gemList().length;
      const randomBack = Math.random;
      Math.random = () => 0;
      tapAt(g, SLGo.goBtn.x + SLGo.goBtn.w / 2, SLGo.goBtn.y + SLGo.goBtn.h / 2);
      Math.random = randomBack;
      const afterList = meta.gemList();
      ok('合成后浮层全部关闭', g.gemSynth === null && g.gemInfo === null,
        `gemSynth=${!!g.gemSynth} gemInfo=${!!g.gemInfo}`);
      ok('合成入账：背包 -3 材料 +1 产物',
        afterList.length === bagBeforeSynth - 2,
        `背包 ${bagBeforeSynth}→${afterList.length}`);
      ok('产物是 Lv.2 红宝石（全同名材料）',
        afterList.some((x) => x.kind === 'ruby' && x.lv === 2),
        `[${afterList.filter((x) => x.kind === 'ruby').map((x) => 'Lv' + x.lv).join(',')}]`);
    }
  }

  // ---- 图签：嵌入列表浮层渲染 + 点行弹详情（from=codex，两项按钮）----
  g.scene = 'codex';
  g.codexSelected = config.TOWER_ORDER[0];
  gemModal.openEmbedPicker(g, config.TOWER_ORDER[0], 0);
  rec.texts.length = 0; rec.rects.length = 0; rec.clips.length = 0; rec.ops.length = 0;
  let err2 = null;
  try { renderer.render(g); } catch (e) { err2 = e; }
  ok('嵌入列表浮层渲染不抛异常', !err2, err2 ? err2.message : `指令 ${rec.ops.length + rec.texts.length} 条`);

  const PL = gemModal.getEmbedPickerLayout(g);
  const prow = PL.rows.filter((r) => r.visible)[0];
  ok('嵌入列表逐颗列出（行名带 Lv）', !!prow && /Lv\.\d+$/.test(prow.name),
    prow ? prow.name : '没有可见行');
  if (prow) {
    tapAt(g, prow.rect.x + prow.rect.w / 2, prow.rect.y + prow.rect.h / 2);
    const il2 = gemModal.getGemInfoLayout(g);
    ok('图签来源的详情浮层有「合成」「嵌入」两项',
      !!g.gemInfo && g.gemInfo.from === 'codex' && !!(il2 && il2.synthBtn && il2.embedBtn),
      il2 ? `from=${g.gemInfo && g.gemInfo.from} 两项=${!!il2.synthBtn}/${!!il2.embedBtn}` : '布局为空');
  }

  meta.resetAll();
}

log('');
log(`=== 宝石+背包+合成汇总：失败 ${fails} 条 ===`);
log(`=== 判据戳：GEM_KINDS=${config.GEM_KINDS.length} 种 / maxSlots=${config.GEM.maxSlots} / 背包 ${config.GEM.bagSlots}→${config.GEM.bagMaxSlots} 格 / 合成 ${config.GEM.synth.minCount} 颗 ${config.GEM.synth.baseRate}%+${config.GEM.synth.perExtra}%/颗 / ${new Date().toISOString()} ===`);
fs.writeFileSync(path.join(__dirname, '_gem.txt'), out.join('\n'), 'utf8');
process.exitCode = fails ? 1 : 0;
