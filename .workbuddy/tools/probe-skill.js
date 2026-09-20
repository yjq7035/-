// ============================================================================
// 技能系统专项探针 —— .workbuddy/tools/probe-skill.js
// ----------------------------------------------------------------------------
// 被测对象：src/skills.js（2026-09 新建的独立技能系统）+ 它在四处 UI/战斗上的落地。
//
// 核心需求（本次改造的验收点）：
//   ① 每种图形塔有且只有一条【固有技能】（图形塔默认自带、专属、不用学）
//   ② **一个技能可以带多条效果**：三角塔的「致命一击」= 暴击几率 + 暴击伤害，
//      两条效果同属一个技能、共用一个技能等级 —— 不是"两个技能"
//   ③ 强化 = 技能等级 +1 = 该技能全部效果一起涨（不是二选一）
//   ④ 宝石（猫眼石）加技能等级 → 同样全部效果一起涨
//   ⑤ 面板 / 技能槽 / 强化浮层 / 战斗结算四处同口径（含三角塔暴击率不许变 NaN ——
//      历史事故：多技能改造漏摊平 base/per，per×等级 = NaN）
//
// 分九组：① 技能表契约 ② 三角塔"一技能两效果" ③ 强化链路（真实点击）
//        ④ 猫眼石加技能等级 ⑤ 面板口径与战斗同源 ⑥ 不生效技能必须显式登记
//        ⑦ 每条生效效果在属性面板都有行 ⑧ Lv.1 不许空转（base = 真实原生值）
//        ⑨ 等级口径：默认 Lv.1（不存在 Lv.0）、上限 Lv.6 = 1 + 5 次强化
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

let Game, config, meta, skills, towerMod, towerMod2, bonusStats, renderer, input, skillSlot, enhance;
try {
  Game = require(path.join(ROOT, 'src', 'game_core'));
  config = require(path.join(ROOT, 'src', 'config'));
  meta = require(path.join(ROOT, 'src', 'meta'));
  skills = require(path.join(ROOT, 'src', 'skills'));
  towerMod = require(path.join(ROOT, 'src', 'tower'));
  bonusStats = require(path.join(ROOT, 'src', 'bonusStats'));
  renderer = require(path.join(ROOT, 'src', 'renderer'));
  input = require(path.join(ROOT, 'src', 'input'));
  skillSlot = require(path.join(ROOT, 'src', 'skillSlot'));
  enhance = require(path.join(ROOT, 'src', 'enhance'));
} catch (e) {
  fs.writeFileSync(path.join(__dirname, '_skill_error.txt'), (e && e.stack) || String(e), 'utf8');
  process.exit(1);
}

const rec = makeRec();
const ctx = makeCtx(rec);
function mkGame(W, H) {
  const canvas = { width: W, height: H, addEventListener() {}, removeEventListener() {}, getContext() { return ctx; } };
  return new Game(canvas, ctx, { screenWidth: W, screenHeight: H, renderScale: 1 });
}
function tapAt(g, x, y) {
  const ev = { touches: [{ clientX: x, clientY: y, x, y }], changedTouches: [{ clientX: x, clientY: y, x, y }] };
  input.handleTouchStart(g, ev);
  input.handleTouchEnd(g, ev);
}
/** 造一座可直接强化的三角塔（3★ 门槛已过） */
function mkTower(type) {
  const t = towerMod.createTower(type, 100, 100);
  t.stage = config.BALANCE.enhance.minStage;
  return t;
}
/** 造一座"面板已打开、可以点强化"的游戏实例（③⑨ 两组共用同一套准备动作） */
function mkPanelGame(type) {
  const g = mkGame(390, 844);
  const tower = mkTower(type);
  g.towers.push(tower);
  g.gold = 999999;
  g.showPanel = true;
  g.panelTowerType = type;
  g.selectedTower = tower;
  g.scene = 'battle';
  g.battleStarted = true;   // ⚠️ 不设它的话触摸会走"战前选关"分支，面板永远点不到
  return { g: g, tower: tower };
}

meta.resetAll();

// ============================================================================
log('===== ① 技能表契约（每塔一条固有技能）=====');
{
  const ids = {};
  const dupId = [];
  const problems = [];
  for (const type of config.TOWER_ORDER) {
    const sk = skills.getInnateSkill(type);
    if (!sk) { problems.push(`${type} 无技能`); continue; }
    if (ids[sk.id]) dupId.push(sk.id);
    ids[sk.id] = type;
    if (!sk.innate) problems.push(`${type} 非固有`);
    if (!sk.name || !sk.desc) problems.push(`${type} 缺名/说明`);
    if (!(sk.effects || []).length) problems.push(`${type} 无效果`);
    // 一塔一条（getSkills 返回数组是为将来"多条技能"留口，当前必须恰好 1 条）
    if (skills.getSkills(type).length !== 1) problems.push(`${type} 技能条数≠1`);
  }
  ok('全部塔型都有且只有一条固有技能', problems.length === 0, problems.join(' ; ') || `${config.TOWER_ORDER.length} 型`);
  ok('技能 id 全局唯一', dupId.length === 0, dupId.join(',') || Object.keys(ids).length + ' 个 id');
  ok('技能自检 audit() 全绿', skills.audit().length === 0, skills.audit().slice(0, 3).join(' ; ') || '无问题');
  ok('「固有技能」文案常量由技能系统供给（面板/图签/浮层共用）', skills.INNATE_LABEL === '固有技能');

  // 每条效果的属性键都必须"登记过"，禁止悄悄写个没人读的键
  const unregistered = [];
  for (const type of config.TOWER_ORDER) {
    for (const e of skills.getEffects(type)) {
      if (!skills.EFFECT_KEYS[e.key]) unregistered.push(`${type}.${e.key}`);
      if (skills.EFFECT_UNITS.indexOf(e.unit || '') < 0) unregistered.push(`${type}.${e.key} 单位`);
    }
  }
  ok('技能效果键与单位全部登记在案', unregistered.length === 0, unregistered.slice(0, 4).join(',') || '无遗漏');
}

// ============================================================================
log('\n===== ② 三角塔：一个技能 = 暴击 + 爆伤（不是两个技能）=====');
{
  const list = skills.getSkills('triangle');
  ok('三角塔只有 1 条固有技能（不是 2 条）', list.length === 1, `实际 ${list.length} 条`);
  const sk = list[0];
  ok('技能名 + 固有标记齐备', !!sk && sk.innate === true && !!sk.name, sk ? `${sk.name} innate=${sk.innate}` : '缺失');

  const effs = skills.getEffects('triangle');
  ok('该技能带 2 条效果（暴击几率 + 暴击伤害）', effs.length === 2, effs.map((e) => `${e.name}${e.per}%`).join(' · '));
  const crit = skills.findEffect('triangle', 'critChance');
  const cdmg = skills.findEffect('triangle', 'critDamage');
  ok('两条效果同属一个技能（skillId 相同）',
    !!crit && !!cdmg && crit.skillId === cdmg.skillId && crit.skillId === sk.id,
    crit && cdmg ? `${crit.skillId} / ${cdmg.skillId}` : '缺效果');
  ok('暴击几率 base=5（= TOWER_STATS 原生 5%）',
    crit && crit.base === config.TOWER_STATS.triangle.critChance, crit ? `base=${crit.base}` : '');
  ok('暴击伤害 base=10（= 原生「+10% 暴击伤害」，不是 0 起步）',
    cdmg && cdmg.base === 10 && config.TOWER_STATS.triangle.critDamage === 10,
    cdmg ? `base=${cdmg.base} / 原生=${config.TOWER_STATS.triangle.critDamage}` : '');

  // 技能槽：1 个槽（不是 2 个），槽里 2 条数值行
  const slots = skillSlot.buildSkillSlots(null, 'triangle', null, 260);
  ok('三角塔面板只画 1 个技能槽', slots.length === 1, `槽数=${slots.length}`);
  ok('槽里逐条列出 2 条效果', slots[0] && slots[0].effects.length === 2,
    slots[0] ? slots[0].effects.map((e) => `${e.name} ${e.valueText}`).join(' · ') : '无槽');
  ok('Lv.1 时暴击伤害显示 10%（base 真的进了展示）',
    slots[0] && slots[0].effects[1].valueText === '10%',
    slots[0] ? slots[0].effects[1].valueText : '无槽');

  // 战斗口径：一个技能等级同时驱动两条属性
  const bare = { type: 'triangle', enhanceLevel: 0, enhanceAttrs: {} };
  const maxed = { type: 'triangle', enhanceLevel: config.BALANCE.enhance.maxLevel, enhanceAttrs: {} };
  const p0 = towerMod.getAttackProfile(bare);
  const p5 = towerMod.getAttackProfile(maxed);
  const L = config.BALANCE.enhance.maxLevel;
  const wantCrit0 = config.TOWER_STATS.triangle.critChance;                                  // 5
  const wantCrit5 = wantCrit0 + crit.per * L;                                               // 5 + 25 = 30
  // 暴击倍率 = 原生倍率 + 原生暴击伤害/100 + 技能暴击伤害增量/100
  const nativeMult = config.TOWER_STATS.triangle.critMult + config.TOWER_STATS.triangle.critDamage / 100; // 2.2
  const wantMult0 = nativeMult;                                                             // 2.2
  const wantMult5 = nativeMult + (cdmg.per * L) / 100;                                      // 2.2 + 0.5 = 2.7
  ok(`Lv.1（0 次强化）：暴击率 ${wantCrit0}% 且暴击倍率 ${wantMult0.toFixed(2)}（原生 10% 暴伤已计入）`,
    Math.abs(p0.critChance - wantCrit0) < 1e-9 && Math.abs(p0.critMult - wantMult0) < 1e-9,
    `${p0.critChance}% / ${p0.critMult.toFixed(2)}`);
  ok(`Lv.${skills.MAX_LEVEL}（满强化）：暴击率 ${wantCrit5}% 与暴击倍率 ${wantMult5.toFixed(2)} 同时兑现`,
    Math.abs(p5.critChance - wantCrit5) < 1e-9 && Math.abs(p5.critMult - wantMult5) < 1e-9,
    `${p5.critChance}% / ${p5.critMult.toFixed(2)}`);
  ok('暴击率不是 NaN（历史事故哨兵）', !Number.isNaN(p5.critChance), String(p5.critChance));
  ok('暴击倍率不是 NaN', !Number.isNaN(p5.critMult), String(p5.critMult));
  ok('runtimeStats 与 getAttackProfile 的暴击倍率同口径（不漏原生 10% 暴伤）',
    Math.abs(towerMod.getTowerRuntimeStats(bare).critMult - wantMult0) < 1e-9,
    `${towerMod.getTowerRuntimeStats(bare).critMult}`);

  // applyEnhanceAttrs：两条效果都要落进 enhanceAttrs
  const written = towerMod.applyEnhanceAttrs(maxed);
  ok('强化增量同时写入两条效果',
    written.critChance === crit.per * L && written.critDamage === cdmg.per * L,
    JSON.stringify(written));

  // 战斗结算真的用上了暴击倍率（强制必暴 + 采样）
  const g = mkGame(390, 844);
  const randomBack = Math.random;
  Math.random = () => 0;                    // 必暴
  const enemy = { alive: true, hp: 1e9, maxHp: 1e9, armor: 0, x: 0, y: 0 };
  const srcTower = { type: 'triangle', enhanceLevel: L, enhanceAttrs: {} };
  towerMod.applyEnhanceAttrs(srcTower);
  const r5 = g.applyDamage(srcTower, enemy, 100);
  Math.random = randomBack;
  ok(`战斗结算按技能后的暴击倍率放大伤害（100 → ×${wantMult5.toFixed(2)}）`,
    Math.abs(r5.damage - 100 * wantMult5) < 1e-6 && r5.crit === true,
    `伤害 ${r5.damage.toFixed(2)}（crit=${r5.crit}）`);

  towerMod.applyEnhanceAttrs(maxed);
}

// ============================================================================
log('\n===== ③ 强化链路：一次强化，两条效果一起涨（真实点击）=====');
{
  meta.resetAll();
  const env = mkPanelGame('triangle');
  const g = env.g;
  const tower = env.tower;

  rec.texts.length = 0; rec.rects.length = 0; rec.clips.length = 0; rec.ops.length = 0;
  let err = null;
  try { renderer.render(g); } catch (e) { err = e; }
  ok('属性面板渲染不抛异常', !err, err ? `${err.constructor.name}: ${err.message}` : `指令 ${rec.ops.length} 条`);
  ok('强化按钮已挂上（有技能 → 门槛只判星级）', !!g.panelEnhanceBtn);

  const before = towerMod.getAttackProfile(tower);
  const gold0 = g.gold;

  // 点「强化」→ 打开确认浮层
  if (g.panelEnhanceBtn) {
    const b = g.panelEnhanceBtn;
    tapAt(g, b.x + b.w / 2, b.y + b.h / 2);
  }
  ok('点强化按钮打开确认浮层', !!g.enhancePicker, g.enhancePicker ? '已打开' : '未打开');

  const L = enhance.getEnhanceLayout(g);
  ok('浮层只有 1 张卡（一个技能一张，不是一条属性一张）', L.cards.length === 1, `卡片 ${L.cards.length} 张`);
  const card = L.cards[0];
  ok('卡片列出 2 条效果的本次增量',
    card && card.opt.effects.length === 2 && card.opt.gainText.indexOf('·') > 0,
    card ? card.opt.gainText : '无卡');
  ok('卡片高度随效果条数变高（2 条 > 1 条）',
    card.h === enhance.cardH(2) && card.h > enhance.cardH(1), `h=${card.h}（单效果卡 ${enhance.cardH(1)}）`);

  // 渲染浮层：不抛异常、不出 undefined 字面量
  rec.texts.length = 0;
  err = null;
  try { renderer.render(g); } catch (e) { err = e; }
  const bad = rec.texts.filter((t) => String(t.text).indexOf('undefined') >= 0)[0];
  ok('浮层渲染不抛异常且不含 undefined', !err && !bad,
    err ? err.message : (bad ? `「${bad.text}」` : `指令 ${rec.ops.length} 条`));

  // 点卡片 → 结算一次
  tapAt(g, card.x + card.w / 2, card.y + card.h / 2);
  const after = towerMod.getAttackProfile(tower);
  const crit = skills.findEffect('triangle', 'critChance');
  const cdmg = skills.findEffect('triangle', 'critDamage');
  ok('强化后浮层收掉', g.enhancePicker === null);
  ok('只扣一次钱', gold0 - g.gold === towerMod.getEnhanceCost('triangle', 0), `花掉 ${gold0 - g.gold}`);
  ok('暴击几率 +per、暴击伤害 +per（一次强化两条一起涨）',
    Math.abs(after.critChance - (before.critChance + crit.per)) < 1e-9
    && Math.abs(after.critMult - (before.critMult + cdmg.per / 100)) < 1e-9,
    `暴击 ${before.critChance}→${after.critChance}% · 倍率 ${before.critMult.toFixed(2)}→${after.critMult.toFixed(2)}`);
  ok('强化落点记录的是【技能 id】（一个技能一条记录）',
    tower.enhancePicks.length === 1 && tower.enhancePicks[0] === skills.skillId('triangle'),
    `[${tower.enhancePicks.join(',')}] vs ${skills.skillId('triangle')}`);

  // enhanceTower 的返回值要逐条列出本次提升（toast 就是靠它拼文案）
  const t2 = mkTower('triangle');
  g.gold = 999999;
  const res = g.enhanceTower(t2);
  ok('enhanceTower 返回值逐条列出本次提升',
    res.ok && res.special.gains.length === 2 && res.special.gains[0].gain === crit.per,
    res.ok ? `${res.special.name}：${res.special.gains.map((x) => `${x.name} ${x.text}`).join(' · ')}` : res.reason);
  ok('enhanceTower 接受技能 id 作为 optionKey（也兼容效果属性键）',
    g.enhanceTower(t2, skills.skillId('triangle')).ok === true
    && g.enhanceTower(t2, 'critDamage').ok === true,
    `Lv.${skills.levelOf(t2)}`);
}

// ============================================================================
log('\n===== ④ 猫眼石 → 技能等级 +1 → 两条效果同时涨 =====');
{
  meta.resetAll();
  meta.grantPoints(999999);
  meta.upgradeCodex('triangle');
  const tower = { type: 'triangle', enhanceLevel: 0, enhanceAttrs: {} };
  const p0 = towerMod.getAttackProfile(tower);
  const opal = meta.addGem('opal').gem;
  const r = meta.embedGem('triangle', 0, opal.uid);
  const p1 = towerMod.getAttackProfile(tower);
  const crit = skills.findEffect('triangle', 'critChance');
  const cdmg = skills.findEffect('triangle', 'critDamage');
  ok('猫眼石嵌入成功：技能等级 Lv.1 → Lv.2（等级 +1）', r.ok && skills.levelOf(tower) === 2,
    `level=${skills.levelOf(tower)} / 次数=${skills.effectiveTimesOf(tower)}`);
  ok('暴击几率 +per', Math.abs(p1.critChance - (p0.critChance + crit.per)) < 1e-9,
    `${p0.critChance}% → ${p1.critChance}%`);
  ok('暴击伤害也 +per（宝石同样作用于第二条效果）',
    Math.abs(p1.critMult - (p0.critMult + cdmg.per / 100)) < 1e-9,
    `${p0.critMult.toFixed(2)} → ${p1.critMult.toFixed(2)}`);
  const slot4 = skillSlot.buildSkillSlots(null, 'triangle', null, 260)[0];
  ok('技能槽当前等级与战斗口径一致（预览态无学习 + 1 猫眼石 → 当前 1、可学 1+5=6，显示 "1/6"）',
    slot4 && slot4.level === 1 && slot4.levelText === '1/6',
    slot4 ? `槽内 level=${slot4.level} text=${slot4.levelText}` : '无槽');
  meta.resetAll();
}

// ============================================================================
log('\n===== ⑤ 面板口径与战斗口径同源（bonusStats vs getAttackProfile）=====');
{
  const tower = { type: 'triangle', level: 0, stage: 0, attackPowerBoost: 0, enhanceLevel: 0, enhanceAttrs: {} };
  tower.enhanceLevel = 3;
  towerMod.applyEnhanceAttrs(tower);
  const g = mkGame(390, 844);
  const info = bonusStats.collectTowerStats(g, tower, config.TOWER_STATS.triangle, 'triangle');
  const prof = towerMod.getAttackProfile(tower);
  ok('面板暴击率 final 与战斗口径一致',
    Math.abs(info.final.critChance - prof.critChance) < 1e-9,
    `面板 ${info.final.critChance}% / 战斗 ${prof.critChance}%`);
  ok('面板暴击伤害 final 与战斗口径一致（含技能"暴击伤害"点值）',
    Math.abs(info.final.critMult - prof.critMult) < 1e-9,
    `面板 ${info.final.critMult.toFixed(3)} / 战斗 ${prof.critMult.toFixed(3)}`);
  ok('面板给出了"暴击伤害"的明细来源（不是只有个数字）',
    (info.rows.find((r) => r.label === '暴击伤害') || { parts: [] }).parts.length > 0,
    (info.rows.find((r) => r.label === '暴击伤害') || { parts: [] }).parts.map((p) => p.label).join(' | '));

  // 技能槽 / 面板 / 浮层三处都渲染一遍，检查有没有 undefined 漏字
  const g2 = mkGame(375, 667);
  const t2 = mkTower('triangle');
  g2.towers.push(t2);
  g2.gold = 99999;
  g2.showPanel = true;
  g2.panelTowerType = 'triangle';
  g2.selectedTower = t2;
  rec.texts.length = 0;
  let err = null;
  try { renderer.render(g2); } catch (e) { err = e; }
  const badText = rec.texts.filter((t) => String(t.text).indexOf('undefined') >= 0)[0];
  ok('矮屏（375x667）属性面板不抛异常且不含 undefined', !err && !badText,
    err ? err.message : (badText ? `「${badText.text}」` : `指令 ${rec.ops.length} 条`));

  // 图签：三角塔详情页（技能槽 + 属性行）
  const g3 = mkGame(390, 844);
  g3.scene = 'codex';
  g3.codexSelected = 'triangle';
  rec.texts.length = 0;
  err = null;
  try { renderer.render(g3); } catch (e) { err = e; }
  const bad3 = rec.texts.filter((t) => String(t.text).indexOf('undefined') >= 0)[0];
  ok('图签详情页渲染不抛异常且不含 undefined', !err && !bad3,
    err ? err.message : (bad3 ? `「${bad3.text}」` : `指令 ${rec.ops.length} 条`));
  ok('图签里画出了「固有技能」小节标题',
    rec.texts.some((t) => String(t.text).indexOf(skills.INNATE_LABEL) >= 0),
    `标题数 ${rec.texts.filter((t) => String(t.text).indexOf(skills.INNATE_LABEL) >= 0).length}`);
}

// ============================================================================
log('\n===== ⑥ 不生效的技能必须显式登记（不许悄悄失效）=====');
{
  // 当前版本图形塔无敌，hp 已从战斗结算移除 → 五边塔/八边塔的技能暂不生效。
  // 系统要求这种键必须登记成 active:false（而不是被当成正常属性）——
  // 将来接回生命时，这条会立刻变红提醒改回去。
  const inert = Object.keys(skills.EFFECT_KEYS).filter((k) => !skills.EFFECT_KEYS[k].active);
  ok('存在显式登记的"不生效"属性键（当前：生命）', inert.indexOf('hp') >= 0, inert.join(',') || '无');
  const hpUsers = config.TOWER_ORDER.filter((t) => skills.findEffect(t, 'hp'));
  ok('使用该键的塔都把"不生效"写进了技能说明',
    hpUsers.every((t) => (skills.skillDesc(t) || '').indexOf('未生效') >= 0),
    hpUsers.join(',') || '没有塔使用');

  // 反向：生效的键必须真的能动战斗数值（抽样校验射程/攻速/破解/穿透光环/共享比例）
  const cases = [
    ['oval', 'range', (t) => towerMod.getTowerRuntimeStats(t).range],
    ['cross', 'shareRatio', (t) => towerMod.getTowerRuntimeStats(t).shareRatio],
    ['arrow', 'break', (t) => towerMod.getAttackProfile(t).break],
    ['diamond', 'auraPenetration', (t) => towerMod.getTowerRuntimeStats(t).auraPenetration],
  ];
  const badCases = [];
  for (const [type, key, read] of cases) {
    const eff = skills.findEffect(type, key);
    const a = read({ type: type, enhanceLevel: 0, enhanceAttrs: {} });
    const b = read({ type: type, enhanceLevel: 2, enhanceAttrs: {} });
    if (!eff || Math.abs((b - a) - eff.per * 2) > 1e-9) badCases.push(`${type}.${key}: ${a}→${b}（期望 +${eff ? eff.per * 2 : '?'}）`);
  }
  ok('技能满级前逐级叠加：射程 / 共享比例 / 破解 / 穿透光环都能被技能抬高',
    badCases.length === 0, badCases.join(' ; ') || '4/4 类通过');
}

// ============================================================================
log('\n===== ⑦ 每条"生效"的技能效果都必须在属性面板里看得见 =====');
{
  // 历史缺口：菱形塔的穿透光环、箭形塔的破解曾经只在技能槽显示，属性面板里根本没有行 ——
  // 玩家强化完看不到任何数字变化。这条断言把"技能 → 面板行"钉死。
  const g = mkGame(390, 844);
  const missing = [];
  for (const type of config.TOWER_ORDER) {
    const tower = {
      type: type, level: 0, stage: 0, attackPowerBoost: 0,
      enhanceLevel: 2, enhanceAttrs: {},
    };
    towerMod.applyEnhanceAttrs(tower);
    const info = bonusStats.collectTowerStats(g, tower, config.TOWER_STATS[type], type);
    const keys = info.rows.map((r) => r.key);
    for (const eff of skills.getEffects(type)) {
      const meta = skills.EFFECT_KEYS[eff.key];
      if (!meta || !meta.active) continue;                 // 不生效的键已由 ⑥ 单独把关
      const mapped = bonusStats.ENHANCE_ATTR_MAP[eff.key] || eff.key;
      // 暴击伤害与暴击倍率共用同一条「暴击伤害」行（显示的是同一个倍率）
      const rowKey = (mapped === 'critDamage') ? 'critMult' : mapped;
      if (keys.indexOf(rowKey) < 0) missing.push(`${type}.${eff.key}（面板无对应行）`);
    }
  }
  ok('17 型塔 × 全部生效效果：属性面板都有对应数值行', missing.length === 0,
    missing.slice(0, 4).join(' ; ') || '全部有行');
}

// ============================================================================
log('\n===== ⑧ Lv.1 不许空转：每条固有技能都必须有非零初始值 =====');
{
  // 历史事故（2026-09-18）：箭形塔 description 写着"破坏目标 3 点抗性"，
  // 但 TOWER_STATS.arrow 没有 break 字段、NATIVE_GETTERS.break 又硬编码 0
  // → 技能面板显示 0、战斗里 brk 恒为 0：描述承诺的能力从未生效过。
  // 这条把「description 承诺 = TOWER_STATS 字段 = 技能 base」三者钉在一起。
  const arrowNative = config.TOWER_STATS.arrow.break;
  const arrowEff = skills.findEffect('arrow', 'break');
  const desc = config.TOWER_STATS.arrow.description || '';
  ok('箭形塔原生 break=3（= description 承诺的"破坏目标 3 点抗性"）',
    arrowNative === 3 && desc.indexOf('3点抗性') >= 0,
    `原生=${arrowNative} / desc 承诺=${desc.indexOf('3点抗性') >= 0}`);
  ok('碎甲箭 base=3（不是 0 起步）', !!arrowEff && arrowEff.base === 3,
    arrowEff ? `base=${arrowEff.base}` : '缺效果');
  ok('Lv.1 的技能值 = base = 3', !!arrowEff && skills.valueOf(arrowEff, 1) === 3,
    arrowEff ? String(skills.valueOf(arrowEff, 1)) : '');

  // 端到端：Lv.1（0 次强化）就该有 3 点碎甲；强化 2 次（Lv.3）= 9 点 → 伤害必须真的不同
  const g = mkGame(390, 844);
  const dmgAt = (times) => {
    const t = { type: 'arrow', enhanceLevel: times, enhanceAttrs: {} };
    towerMod.applyEnhanceAttrs(t);
    const enemy = { alive: true, hp: 1e9, maxHp: 1e9, armor: 20, x: 0, y: 0 };
    return g.applyDamage(t, enemy, 100, { allowCrit: false }).damage;
  };
  const K = config.BALANCE.armorK;
  const d0 = dmgAt(0), d2 = dmgAt(2);
  const exp0 = 100 * (1 - 17 / (17 + K));   // 抗性 20 - 碎甲 3 = 17
  const exp2 = 100 * (1 - 11 / (11 + K));   // 抗性 20 - 碎甲 9 = 11
  ok('Lv.1 的 3 点碎甲真进了减免公式（不是只写在面板上）',
    Math.abs(d0 - exp0) < 1e-6, `实际 ${d0.toFixed(3)} / 期望 ${exp0.toFixed(3)}`);
  ok('技能等级驱动战斗：碎甲 3 → 9，伤害进一步抬高',
    Math.abs(d2 - exp2) < 1e-6 && d2 > d0, `Lv.1 ${d0.toFixed(3)} → 满 3 级 ${d2.toFixed(3)}`);

  // 同类坑的另外两座（2026-09-18 定稿：每条固有技能都必须有非零初始值）
  const starters = [
    ['semicircle', 'penetration', 3, (t) => towerMod.getAttackProfile(t).penetration],
    ['star', 'critChance', 5, (t) => towerMod.getAttackProfile(t).critChance],
  ];
  const badStart = [];
  for (const [type, key, want, read] of starters) {
    const eff = skills.findEffect(type, key);
    const native = config.TOWER_STATS[type][key];
    const live = read({ type: type, enhanceLevel: 0, enhanceAttrs: {} });
    if (!eff || eff.base !== want || native !== want || live !== want) {
      badStart.push(`${type}.${key}: base=${eff && eff.base} 原生=${native} 战斗=${live}（期望 ${want}）`);
    }
  }
  ok('半圆塔 3 点穿透 / 星形塔 5% 暴击：Lv.1 即生效（技能=原生=战斗）',
    badStart.length === 0, badStart.join(' ; ') || '2/2 通过');

  // 闪电塔：固有技能已从「雷霆暴击」换成「雷电链」（3 条效果：传导数量/距离/伤害比例），
  // 所以上面那套「技能 base = TOWER_STATS 原生值 = getAttackProfile」不再适用 ——
  // 它的战斗读取口是 game_core.fireBoltChain → towerMod.getSpecialValue(type, Lv, key)。
  // 这里按同一条链核对：① 每条效果 base 非零；② Lv.1 时战斗读到的就是 base（不空转）；
  // ③ 原生值真的落在 config.TOWER_STATS.bolt（不是只写在技能表里）。
  const boltLv1 = { type: 'bolt', enhanceLevel: 0, enhanceAttrs: {} };
  const boltLv1n = towerMod.getEffectiveSkillLevel(boltLv1);
  const boltBad = [];
  for (const e of skills.getEffects('bolt')) {
    const live = towerMod.getSpecialValue('bolt', boltLv1n, e.key);
    const native = config.TOWER_STATS.bolt[e.key];
    if (!(e.base > 0) || live !== e.base || native !== e.base) {
      boltBad.push(`${e.key}: base=${e.base} 原生=${native} 战斗=${live}`);
    }
  }
  ok('闪电塔「雷电链」3 条效果 Lv.1 即生效（base 非零 = 原生值 = 战斗读到值）',
    boltBad.length === 0 && skills.getEffects('bolt').length === 3,
    boltBad.join(' ; ') || `${skills.getEffects('bolt').length} 条效果`);

  // 端到端：真的打一炮，副目标必须掉血。
  // 历史事故（2026-09-19）：fireBoltChain 把【属性键】当效果行传给 getSpecialValue
  // → chainCount / chainRange 都是 NaN → 扫链条件恒 false、副目标一个都打不到，
  // 而技能槽 / 面板照样显示"传导数量 2 / 传导距离 75"。只有真打一炮才抓得住。
  {
    const enemyMod = require(path.join(ROOT, 'src', 'enemy'));
    const PATH = [{ x: 0, y: 100 }, { x: 400, y: 100 }];
    const gB = mkGame(390, 844);
    const boltTower = towerMod.createTower('bolt', 100, 100);
    boltTower.attackTimer = 0;
    gB.towers.push(boltTower);
    const main = enemyMod.spawnEnemy('normal', PATH, 1);
    main.x = 160; main.y = 100; main.hp = 1e9; main.maxHp = 1e9;
    const side = enemyMod.spawnEnemy('normal', PATH, 1);
    side.x = 175; side.y = 105; side.hp = 1e9; side.maxHp = 1e9;   // 距主目标 ≈ 15px < 传导距离 75
    const far = enemyMod.spawnEnemy('normal', PATH, 1);
    far.x = 320; far.y = 100; far.hp = 1e9; far.maxHp = 1e9;       // 距主目标 160px > 75 → 不该被传导
    gB.enemies.push(main, side, far);
    gB.enemiesToSpawn = [];
    gB.waveInProgress = true;
    gB.currentWave = 1;
    const beforeSide = side.hp;
    const beforeFar = far.hp;
    let beatErr = null;
    try { for (let f = 0; f < 120; f++) gB.updateTowers(1 / 60); } catch (e) { beatErr = e; }
    const drewSide = beforeSide - side.hp;
    const drewFar = beforeFar - far.hp;
    ok('战斗端到端：传导距离内的副目标真的吃到伤害、范围外的不吃',
      !beatErr && drewSide > 0 && drewFar === 0,
      beatErr ? `${beatErr.constructor.name}: ${beatErr.message}`
        : `副目标 -${drewSide.toFixed(1)} / 范围外 -${drewFar.toFixed(1)}`);
  }

  // 规则钉死（用户 2026-09-18：修改技能设定都要有初始值）——**不存在 base=0 的生效技能**
  const dormant = [];
  for (const type of config.TOWER_ORDER) {
    for (const e of skills.getEffects(type)) {
      const meta = skills.EFFECT_KEYS[e.key];
      if (meta && meta.active && e.base === 0) dormant.push(`${type}.${e.key}`);
    }
  }
  ok('没有任何"生效中却 base=0"的技能（每条固有技能都有非零初始值）',
    dormant.length === 0,
    dormant.join(', ') || `${config.TOWER_ORDER.length} 型全部有初始值`);
  const wl = Object.keys(skills.ZERO_BASE_ALLOWED);
  ok('ZERO_BASE_ALLOWED 为空（无技能需要 0 起点豁免）', wl.length === 0, wl.join(',') || '空');
  ok('audit() 复检仍全绿（含 base=0 契约）',
    skills.audit().length === 0, skills.audit().slice(0, 3).join(' ; ') || '无问题');
}

// ============================================================================
log('\n===== ⑨ 等级口径：默认 Lv.1、上限 Lv.6（不存在 Lv.0）=====');
{
  // 用户 2026-09-18 定稿：「所有技能都是默认等级 1，且显示的就是等级 1 的属性」。
  // 塔一放下 = Lv.1，属性 = 原生值本身；强化/宝石每 +1 次，等级 +1、每条效果 +per。
  ok('skills.LEVEL_BASE = 1（默认等级）', skills.LEVEL_BASE === 1, String(skills.LEVEL_BASE));
  ok('等级上限 = 1 + 强化上限（Lv.1 ~ Lv.6）',
    skills.MAX_LEVEL === skills.LEVEL_BASE + config.BALANCE.enhance.maxLevel,
    `MAX_LEVEL=${skills.MAX_LEVEL} / 强化上限=${config.BALANCE.enhance.maxLevel}`);

  // 塔一放下（0 次强化、无宝石）= Lv.1，属性就是原生值本身
  const bare = { type: 'triangle', enhanceLevel: 0, enhanceAttrs: {} };
  ok('未强化、无宝石的塔：技能就是 Lv.1（不是 Lv.0）',
    skills.levelOf(bare) === 1, `Lv.${skills.levelOf(bare)}`);
  ok('预览态（商店/图签）也是 Lv.1',
    skills.previewLevel('triangle') === 1, `Lv.${skills.previewLevel('triangle')}`);
  const crit1 = skills.findEffect('triangle', 'critChance');
  const cdmg1 = skills.findEffect('triangle', 'critDamage');
  ok('Lv.1 的属性 = base = 原生值（面板不撒谎）',
    skills.valueOf(crit1, 1) === config.TOWER_STATS.triangle.critChance
    && skills.valueOf(cdmg1, 1) === config.TOWER_STATS.triangle.critDamage,
    `暴击 ${skills.valueOf(crit1, 1)}% / 暴伤 ${skills.valueOf(cdmg1, 1)}%`);

  // clamp：0 与负数一律回到 Lv.1，超上限停在 Lv.6（绝不出现 Lv.0 / Lv.7）
  ok('clampLevel(0) / (-3) 都回落到 Lv.1（不存在 Lv.0）',
    skills.clampLevel(0) === 1 && skills.clampLevel(-3) === 1,
    `${skills.clampLevel(0)} / ${skills.clampLevel(-3)}`);
  ok(`clampLevel 上限封在 Lv.${skills.MAX_LEVEL}（不会出现 Lv.${skills.MAX_LEVEL + 1}）`,
    skills.clampLevel(99) === skills.MAX_LEVEL, `Lv.${skills.clampLevel(99)}`);
  ok('nextLevel 满级后原地不动（浮层不会写出 Lv.7）',
    skills.nextLevel(skills.MAX_LEVEL) === skills.MAX_LEVEL,
    `Lv.${skills.MAX_LEVEL} → Lv.${skills.nextLevel(skills.MAX_LEVEL)}`);

  // 【强化次数】与【技能等级】差 1 —— 混用就是凭空多送一级
  const maxed = { type: 'triangle', enhanceLevel: config.BALANCE.enhance.maxLevel, enhanceAttrs: {} };
  ok(`强化 ${config.BALANCE.enhance.maxLevel} 次 → Lv.${skills.MAX_LEVEL}（满级）`,
    skills.levelOf(maxed) === skills.MAX_LEVEL && skills.isMaxLevel(skills.levelOf(maxed)) === true,
    `Lv.${skills.levelOf(maxed)}`);
  ok('次数口径 ≠ 等级口径（差 1：学习 0 次 = Lv.1）',
    skills.learnedLevel(maxed) === config.BALANCE.enhance.maxLevel
    && skills.levelOf(maxed) === config.BALANCE.enhance.maxLevel + 1,
    `学习 ${skills.learnedLevel(maxed)} → Lv.${skills.levelOf(maxed)}`);

  // 技能槽默认态：新口径显示 "当前等级/可学等级"
  const slot = skillSlot.buildSkillSlots(null, 'triangle', bare, 260)[0];
  ok('技能槽显示 "当前/可学" 格式（数字/数字）', slot && /^\d+\/\d+$/.test(slot.levelText),
    slot ? slot.levelText : '无槽');

  // 属性面板顶行 + 强化浮层标题：两处 UI 都得按新口径写 "当前/可学"。
  // ⚠️ 用 provider 把宝石加成隔离为 0，确保「无额外等级 → 当前=学习=0」这种基础态可断言。
  const env = mkPanelGame('triangle');
  const g = env.g;
  skills.setGemLevelProvider(() => 0);
  rec.texts.length = 0;
  let err = null;
  try { renderer.render(g); } catch (e) { err = e; }
  ok('属性面板顶行写「固有技能 0/5」',
    !err && rec.texts.some((t) => String(t.text).indexOf('固有技能 0/5') >= 0),
    err ? err.message
      : (rec.texts.map((t) => t.text).filter((s) => String(s).indexOf('固有技能') >= 0).join(' | ') || '没找到该行'));

  if (g.panelEnhanceBtn) {
    const b = g.panelEnhanceBtn;
    tapAt(g, b.x + b.w / 2, b.y + b.h / 2);
  }
  rec.texts.length = 0;
  err = null;
  try { renderer.render(g); } catch (e) { err = e; }
  ok('强化浮层标题写「0/5 → 1/5」',
    !err && rec.texts.some((t) => String(t.text).indexOf('0/5 → 1/5') >= 0),
    err ? err.message
      : (rec.texts.map((t) => t.text).filter((s) => String(s).indexOf('→') >= 0).join(' | ') || '没找到标题'));
  g.enhancePicker = null;
  skills.setGemLevelProvider(null);

  // 满级塔：技能等级行必须仍是 "固有技能 N/M"（M=可学上限、N 有限整数，绝不越界）
  const gMax = mkPanelGame('triangle').g;
  gMax.selectedTower.enhanceLevel = config.BALANCE.enhance.maxLevel;
  gMax.gold = 999999;
  rec.texts.length = 0;
  err = null;
  try { renderer.render(gMax); } catch (e) { err = e; }
  const skillLine = !err && rec.texts.map((t) => String(t.text)).find((s) => s.indexOf('固有技能 ') === 0);
  const m = skillLine && skillLine.match(/^固有技能 (\d+)\/(\d+)$/);
  ok('满级塔渲染不抛异常且技能等级显示 "N/M"（M=可学上限、N 有限整数）',
    !err && !!m && Number(m[2]) === skills.learnableCap('triangle') && isFinite(Number(m[1])),
    err ? err.message : (skillLine || '没找到「固有技能」行'));

  // 强化一次后：toast 报的是技能等级 Lv.2（不是"强化到 Lv.1"那种与面板对不上的数字）
  const t3 = mkTower('triangle');
  g.gold = 999999;
  const res = g.enhanceTower(t3);
  ok('enhanceTower 返回 level = 技能等级（强化 1 次 → Lv.2）',
    res.ok && res.level === 2 && res.enhanceTimes === 1,
    res.ok ? `level=${res.level} / 次数=${res.enhanceTimes}` : res.reason);

  // 报价仍按【强化次数】：第一次最便宜，没被"等级从 1 起"带涨
  const c0 = towerMod.getEnhanceCost('triangle', 0);
  const c1 = towerMod.getEnhanceCost('triangle', 1);
  ok('报价按强化次数递增（没被等级口径带涨）',
    c0 > 0 && c1 > c0, `第 1 次 💰${c0} → 第 2 次 💰${c1}`);
  ok('满级后不再报价（Infinity）',
    towerMod.getEnhanceCost('triangle', config.BALANCE.enhance.maxLevel) === Infinity,
    String(towerMod.getEnhanceCost('triangle', config.BALANCE.enhance.maxLevel)));

  // ⚠️ canEnhance 必须判【强化次数】。判成技能等级的话 Lv.5 会被误判满级 ——
  //    面板按钮画得出来、点下去却被拦掉，技能永远到不了 Lv.6（2026-09-18 当场抓到过）。
  const t4 = { type: 'triangle', enhanceLevel: config.BALANCE.enhance.maxLevel - 1, enhanceAttrs: {} };
  const t5 = { type: 'triangle', enhanceLevel: config.BALANCE.enhance.maxLevel, enhanceAttrs: {} };
  ok(`Lv.${skills.levelOf(t4)}（还差 1 次强化）时仍可强化`,
    towerMod.canEnhance(t4) === true, `Lv.${skills.levelOf(t4)} canEnhance=${towerMod.canEnhance(t4)}`);
  ok(`Lv.${skills.MAX_LEVEL}（满强化）时不可再强化`,
    towerMod.canEnhance(t5) === false, `Lv.${skills.levelOf(t5)} canEnhance=${towerMod.canEnhance(t5)}`);

  // 端到端：一路强化到 Lv.6，中途不能卡住
  const gEnd = mkPanelGame('triangle').g;
  gEnd.gold = 99999999;
  let steps = 0;
  while (gEnd.enhanceTower(gEnd.selectedTower).ok) steps++;
  ok(`连续强化 ${config.BALANCE.enhance.maxLevel} 次都能成功（不会卡在 Lv.5）`,
    steps === config.BALANCE.enhance.maxLevel
    && skills.levelOf(gEnd.selectedTower) === skills.MAX_LEVEL,
    `成功 ${steps} 次 → Lv.${skills.levelOf(gEnd.selectedTower)}`);
}

// ============================================================================
// ⑩ 等级口径：当前 = 额外 + 学习；可学 = 额外 + 可学基数(5)
// ----------------------------------------------------------------------------
// 2026-09-20 定稿（本次修的就是它）：额外等级（宝石 / 十字塔共享）**不占**学习额度，
// 且**真正抬升**战斗生效的等级 —— 面板 / 技能槽 / 战斗三处同源，
// 不许出现"显示涨了、打起来没变"或"显示 11/16 却只能学到 5"。
//   · 学习等级 = 局内花金币学出来的次数（0..5，唯一真源 tower.enhanceLevel）
//   · 额外等级 = 宝石等级 + 十字塔共享等级
//   · 当前等级 = 学习 + 额外（**不夹上限**，就是战斗取值用的生效次数）
//   · 可学等级 = 额外 + 可学基数(=5) —— "这条技能最高能到几级"
//     ⚠️ 可学等级不是固定 5：宝石 / 共享堆出来的是"地基"，玩家还能在其上再学 5 级。
//        玩家实测「十字塔共享 +11 级、自己从未强化」正确显示 11/16（曾被压成 11/5）。
// 用 setGemLevelProvider 隔离全局宝石态，精确控制额外等级。
// ============================================================================
log('===== ⑩ 新口径：当前 = 额外 + 学习；可学 = 额外 + 基数（显示 "X/Y"）=====');
const mkTL = (enh) => ({ type: 'triangle', enhanceLevel: enh, enhanceAttrs: {} });

skills.setGemLevelProvider(() => 0);   // 额外等级 = 0 → 可学等级 = 5
ok('无额外等级：当前 = 学习等级（0 强化 → 0/5）',
  skills.levelText(mkTL(0), 'triangle') === '0/5' && skills.currentLevel(mkTL(0), 'triangle') === 0,
  skills.levelText(mkTL(0), 'triangle'));
ok('无额外等级：学习 3 次 → 当前 3 / 可学 5（3/5）',
  skills.currentLevel(mkTL(3), 'triangle') === 3 && skills.levelText(mkTL(3), 'triangle') === '3/5',
  skills.levelText(mkTL(3), 'triangle'));

skills.setGemLevelProvider(() => 2);   // 额外等级 = 2（如 2 颗猫眼石）→ 可学等级 = 7
ok('有额外等级：当前 = 学习 + 额外（0 学 + 2 宝石 → 2/7）',
  skills.currentLevel(mkTL(0), 'triangle') === 2 && skills.levelText(mkTL(0), 'triangle') === '2/7',
  skills.levelText(mkTL(0), 'triangle'));
ok('有额外等级：3 学 + 2 宝石 → 当前 5 / 可学 7（5/7）',
  skills.currentLevel(mkTL(3), 'triangle') === 5 && skills.levelText(mkTL(3), 'triangle') === '5/7',
  skills.levelText(mkTL(3), 'triangle'));

// ★ 玩家实测回归（本次报的 bug）：十字塔共享 +11 级、玩家从未强化 → 必须显示 11/16
skills.setGemLevelProvider(() => 11);  // 额外等级 = 11
ok('★ 额外 11 级 + 从未强化 → 显示 11/16（不是被压成 11/5）',
  skills.currentLevel(mkTL(0), 'triangle') === 11 && skills.levelText(mkTL(0), 'triangle') === '11/16',
  skills.levelText(mkTL(0), 'triangle'));

// 可学等级 = 额外 + 基数（随额外同步抬升）；可学基数固定不变
const capBase = skills.baseLearnCap('triangle');
skills.setGemLevelProvider(() => 5);   // 额外等级 = 5 → 可学等级 = 10
ok('可学等级 = 额外等级 + 可学基数（额外 5 → 可学 10）',
  skills.learnableCap(mkTL(0), 'triangle') === 10 && skills.baseLearnCap('triangle') === capBase,
  `可学=${skills.learnableCap(mkTL(0), 'triangle')} / 基数=${capBase}`);
ok('额外等级只抬当前，学习等级不受外部加成影响',
  skills.learnedLevel(mkTL(3)) === 3 && skills.baseLearnCap('triangle') === capBase,
  `学习=${skills.learnedLevel(mkTL(3))} / 基数=${capBase}`);

// ---- 额外等级必须【真正生效】（战斗取值不夹 5），且不挤占学习额度 ----
const critE = skills.findEffect('triangle', 'critChance');
skills.setGemLevelProvider(() => 5);   // 额外 5、学习 0
const t0 = mkTL(0);
ok('额外等级真的生效：额外 5、学习 0 → 暴击几率增量 = per × 5（没被夹在"学习上限 5"里）',
  Math.abs(skills.bonusFor(t0, 'critChance') - critE.per * 5) < 1e-9,
  `增量 ${skills.bonusFor(t0, 'critChance')}%（per=${critE.per}）`);
ok('额外等级不占学习额度：额外 5、学习 0 → 仍可强化（canEnhance=true）',
  towerMod.canEnhance(t0) === true && skills.learnedLevel(t0) === 0,
  `canEnhance=${towerMod.canEnhance(t0)} / 学习=${skills.learnedLevel(t0)}`);
ok('强化报价只按【学习次数】：额外等级不抬价',
  towerMod.getEnhanceCost('triangle', skills.learnedLevel(t0)) === towerMod.getEnhanceCost('triangle', 0),
  `💰${towerMod.getEnhanceCost('triangle', 0)}`);

// 学满 5 次 + 额外 5 → 当前 10 / 可学 10（"地基"之上还能再学满）
const t5 = mkTL(5);
ok('额外 5 + 学满 5 → 显示 10/10，战斗增量 = per × 10（额外那份真的算进去了）',
  skills.levelText(t5, 'triangle') === '10/10'
  && Math.abs(skills.bonusFor(t5, 'critChance') - critE.per * 10) < 1e-9,
  `${skills.levelText(t5, 'triangle')} / 增量 ${skills.bonusFor(t5, 'critChance')}%`);
ok('学满后确实不能再学（canEnhance=false）', towerMod.canEnhance(t5) === false,
  `学习 ${skills.learnedLevel(t5)}/${skills.baseLearnCap('triangle')}`);

// 面板与战斗同源（额外等级用**真实宝石**提供，避免 provider 只作用于显示侧）
skills.setGemLevelProvider(null);
meta.resetAll();
meta.grantPoints(999999);
meta.upgradeCodex('triangle');
const pt = { type: 'triangle', level: 1, stage: 0, enhanceLevel: 2, enhanceAttrs: {}, auraBuffs: {} };
towerMod.applyEnhanceAttrs(pt);
meta.embedGem('triangle', 0, meta.addGem('opal').gem.uid);
const infoG = bonusStats.collectTowerStats(mkGame(390, 844), pt, config.TOWER_STATS.triangle, 'triangle');
const profG = towerMod.getAttackProfile(pt);
ok('面板与战斗同源（宝石 +1、学习 2 → 生效 3）：暴击率 final 一致，且 = 原生 + per × 3',
  Math.abs(infoG.final.critChance - profG.critChance) < 1e-9
  && Math.abs(infoG.final.critChance - (config.TOWER_STATS.triangle.critChance + critE.per * 3)) < 1e-9,
  `面板 ${infoG.final.critChance}% / 战斗 ${profG.critChance}% / 期望 ${config.TOWER_STATS.triangle.critChance + critE.per * 3}%`);
meta.resetAll();

// 所有技能类型均应用同一公式（本游戏 17 型均为固有技能，统一口径）
skills.setGemLevelProvider(() => 0);
let allFmt = true, allBad = '';
for (const type of config.TOWER_ORDER) {
  const txt = skills.levelText(mkTL(2), type);
  const mm = txt.match(/^(\d+)\/(\d+)$/);
  if (!mm || Number(mm[1]) !== 2 || Number(mm[2]) !== 5) {
    allFmt = false; allBad += ` ${type}:${txt}`;
  }
}
ok('全部技能类型均按同一公式计算（学习 2、无额外 → "2/5"）', allFmt,
  allFmt ? `${config.TOWER_ORDER.length} 型统一` : allBad);
skills.setGemLevelProvider(null);

log('');
log(`=== 技能系统汇总：失败 ${fails} 条 ===`);
log(`=== 判据戳：塔 ${config.TOWER_ORDER.length} 型 / 技能 ${Object.keys(skills.SKILLS).length} 条 / 三角塔效果 ${skills.getEffects('triangle').length} 条 / 等级 Lv.${skills.LEVEL_BASE}~Lv.${skills.MAX_LEVEL} / ${new Date().toISOString()} ===`);
fs.writeFileSync(path.join(__dirname, '_skill.txt'), out.join('\n'), 'utf8');
process.exitCode = fails ? 1 : 0;
