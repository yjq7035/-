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

let Game, config, meta, gems, towerMod, skillSlot, bag, renderer;
try {
  Game = require(path.join(ROOT, 'src', 'game_core'));
  config = require(path.join(ROOT, 'src', 'config'));
  meta = require(path.join(ROOT, 'src', 'meta'));
  gems = require(path.join(ROOT, 'src', 'gems'));
  towerMod = require(path.join(ROOT, 'src', 'tower'));
  skillSlot = require(path.join(ROOT, 'src', 'skillSlot'));
  bag = require(path.join(ROOT, 'src', 'bag'));
  renderer = require(path.join(ROOT, 'src', 'renderer'));
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
  ok('新档背包格数 = 20（每行 10 格 × 2 行）', m.bagSlots === 20 && config.GEM.bagSlots === 20,
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
    `保留 [${triSlots.map((k) => k || '-').join(',')}]`);
  ok('坏档：未解锁塔型的记录被丢弃', norm.socketed.parallel === undefined);
  ok('坏档：越界 bagSlots 被夹回上限', norm.bagSlots === config.GEM.bagMaxSlots, `bagSlots=${norm.bagSlots}`);
  ok('坏档：未知宝石被剔除', norm.gems.every((g) => !!gems.gemDef(g.kind)),
    `[${norm.gems.map((g) => g.kind).join(',')}]`);
  ok('坏档：uid 保持唯一', new Set(norm.gems.map((g) => g.uid)).size === norm.gems.length,
    `[${norm.gems.map((g) => g.uid).join(',')}]`);
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

  // —— 紫晶：射程 +16（运行时属性，且强化等级为 0 也要生效）——
  const am = meta.gemList().filter((x) => x.kind === 'amethyst')[0] || (meta.addGem('amethyst'), meta.gemList().filter((x) => x.kind === 'amethyst')[0]);
  if (am) {
    meta.embedGem(T, 0, am.uid);
    const rt = towerMod.getTowerRuntimeStats(tower);
    ok('紫晶让射程 +16（强化等级 0 也生效）',
      Math.abs(rt.range - (rtBefore.range + gems.gemDef('amethyst').effect.range)) < 1e-6,
      `${rtBefore.range} → ${rt.range}`);
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
  const spDef = config.ENHANCE_SPECIAL.parallel;
  ok('猫眼石让固有技能等级 +1',
    towerMod.getSkillGemLevels('parallel') === 1 && towerMod.getEffectiveSkillLevel(pt) === 1,
    `宝石等级=${towerMod.getSkillGemLevels('parallel')} 有效等级=${towerMod.getEffectiveSkillLevel(pt)}`);
  ok('固有技能等级 +1 真的抬高了战斗数值（叠加上限）',
    r.ok && Math.abs(capAfter - (capBefore + spDef.per)) < 1e-6,
    `${spDef.name}: ${capBefore} → ${capAfter}（per=${spDef.per}${spDef.unit}）`);
  ok('技能槽显示的 Lv 与战斗口径一致',
    skillSlot.buildSkillSlots(null, 'parallel', null, 280)[0].level === 1,
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
  for (const [W, H] of RES) {
    const g = mkGame(W, H);
    g.scene = 'bag';
    const L = bag.getBagLayout(g);

    ok(`${W}x${H} 每行 10 格`, L.cols === 10, `cols=${L.cols}`);
    ok(`${W}x${H} 行数 = 上限 40 ÷ 10 = 4`, L.rows === 4 && L.cells.length === 40,
      `rows=${L.rows} cells=${L.cells.length}`);

    // 同一行前 10 格 y 相同、x 递增；第 11 格换行
    const row0 = L.cells.slice(0, 10);
    const sameY = row0.every((c) => Math.abs(c.y - row0[0].y) < 0.01);
    const incX = row0.every((c, i) => i === 0 || c.x > row0[i - 1].x + 1);
    ok(`${W}x${H} 第一行 10 格同高、横向递增`, sameY && incX,
      `y=${row0[0].y.toFixed(0)} x=${row0[0].x.toFixed(0)}…${row0[9].x.toFixed(0)} w=${L.cellW}`);
    ok(`${W}x${H} 第 11 格换到下一行`, L.cells[10].y > L.cells[0].y + 1,
      `y ${L.cells[0].y.toFixed(0)} → ${L.cells[10].y.toFixed(0)}`);

    // 默认解锁 20 格，其余上锁
    const unlockedN = L.cells.filter((c) => c.unlocked).length;
    ok(`${W}x${H} 默认解锁 20 格`, unlockedN === 20 && L.unlocked === 20,
      `解锁 ${unlockedN} / 共 ${L.cells.length}`);

    // 格子不许越出屏幕
    const outX = L.cells.filter((c) => c.x < -0.5 || c.x + c.w > W + 0.5);
    ok(`${W}x${H} 40 格全部在屏幕内`, outX.length === 0,
      outX.length ? `${outX.length} 格越界（最右 ${outX[0].x + outX[0].w} vs ${W}）` : `cellW=${L.cellW}`);

    // 解锁按钮不压住格网
    const lastRowBottom = L.cells[30].y + L.cells[30].h;
    ok(`${W}x${H} 格网不压到解锁按钮`, lastRowBottom <= L.btn.y + 0.5,
      `格网底 ${lastRowBottom.toFixed(0)} ≤ 按钮顶 ${L.btn.y.toFixed(0)}`);

    // 真实渲染（含 40 格 + 锁）
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

  // 直接调 meta 扩容（模拟广告看完后的入账）应能到 40 封顶
  let n = meta.bagSlots();
  for (let i = 0; i < 10; i++) meta.expandBag();
  ok('扩容每次 +10，封顶 40', meta.bagSlots() === config.GEM.bagMaxSlots,
    `${n} → ${meta.bagSlots()}`);
  meta.resetAll();
}

log('');
log(`=== 宝石+背包汇总：失败 ${fails} 条 ===`);
log(`=== 判据戳：GEM_KINDS=${config.GEM_KINDS.length} 种 / maxSlots=${config.GEM.maxSlots} / 背包 ${config.GEM.bagSlots}→${config.GEM.bagMaxSlots} 格 / ${new Date().toISOString()} ===`);
fs.writeFileSync(path.join(__dirname, '_gem.txt'), out.join('\n'), 'utf8');
process.exitCode = fails ? 1 : 0;
