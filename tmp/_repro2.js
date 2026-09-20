const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const { makeCtx, makeRec } = require(path.join(ROOT, '.workbuddy', 'tools', 'harness.js'));

global.document = { addEventListener() {}, removeEventListener() {} };
global.requestAnimationFrame = () => 0;

const Game = require(path.join(ROOT, 'src', 'game_core'));
const config = require(path.join(ROOT, 'src', 'config'));
const meta = require(path.join(ROOT, 'src', 'meta'));
const towerMod = require(path.join(ROOT, 'src', 'tower'));
const gems = require(path.join(ROOT, 'src', 'gems'));

const rec = makeRec();
const ctx = makeCtx(rec);
function mkGame(W, H) {
  const canvas = { width: W, height: H, addEventListener() {}, removeEventListener() {}, getContext() { return ctx; } };
  return new Game(canvas, ctx, { screenWidth: W, screenHeight: H, renderScale: 1 });
}

const out = [];
const log = (s) => out.push(s);

/** 解锁 cross 图签到 lv（= 槽位数），并嵌入给定宝石 */
function setup(gemList, codexLv) {
  meta.resetAll();
  meta.grantPoints(1e9);
  for (let i = 0; i < (codexLv || 5); i++) meta.upgradeCodex('cross');
  gemList.forEach((k, i) => {
    const r = meta.addGem(k[0], k[1]);
    if (!r.ok) { log(`    addGem 失败 ${k}`); return; }
    const e = meta.embedGem('cross', i, r.gem.uid);
    if (!e.ok) log(`    embedGem 失败 idx=${i} ${k} → ${JSON.stringify(e)}`);
  });
  log(`    cross 槽位 = ${JSON.stringify(meta.gemSockets('cross').map((s) => s.kind))}`);
  log(`    gems.bonusForType('cross') = ${JSON.stringify(gems.bonusForType('cross'))}`);
}

function build(opts) {
  const g = mkGame(375, 667);
  const place = (idx, type, stage) => {
    const s = g.slots[idx];
    const t = towerMod.createTower(type, s.x + s.size / 2, s.y + s.size / 2);
    t.stage = stage || 0; s.tower = t; s.occupied = true; g.towers.push(t);
    return t;
  };
  const cross = place(5, 'cross', opts.crossStage);
  const target = place(4, opts.targetType || 'triangle', 0);
  const extra = (opts.extra || []).map((e) => place(e[0], e[1], e[2]));
  return { g, target, cross, extra };
}

const show = (g, t) => {
  const auras = g.auraManager.getAuras(t.uniqueId) || [];
  return {
    buffs: t.auraBuffs,
    n: auras.length,
    srcs: auras.map((a) => `${a.sourceName}★${a.sourceStage}${JSON.stringify(a.buffs)}`).join(' + ') || '(无)',
    speed: g.auraManager.getBuffedValue(t.uniqueId, 100),
    pen: g.getEffectivePenetration(t),
  };
};

log('===== 0. 十字塔单独（蓝宝石 Lv.1，图签 Lv.5）=====');
{
  setup([['sapphire', 1]]);
  const { g, target, cross } = build({ crossStage: 0 });
  log(`  getAuraOutput(cross) = ${JSON.stringify(towerMod.getAuraOutput(cross, 1))}`);
  g.applyTrapezoidAuras(); g.syncTowerAuras();
  log(`  目标塔 ← ${JSON.stringify(show(g, target))}`);
}

log('\n===== 1. 十字塔(蓝宝石Lv5 share) × 梯塔（同一属性键 attackSpeedMultiplier）=====');
for (const cs of [0, 1, 2, 3]) for (const ss of [0, 1, 2, 3]) {
  setup([['sapphire', 5]]);
  const { g, target, cross } = build({ crossStage: cs, extra: [[11, 'trapezoid', ss]] });
  const share = towerMod.getAuraOutput(cross, 1);
  g.applyTrapezoidAuras(); g.syncTowerAuras();
  const r = show(g, target);
  log(`  十字★${cs}(发出${JSON.stringify(share)}) + 梯塔★${ss} → 攻速光环=${r.speed - 100}  来源=${r.srcs}`);
}

log('\n===== 2. 十字塔(黄玉Lv5 share) × 菱形塔（同一属性键 penetration）=====');
for (const cs of [0, 1, 2, 3]) for (const ss of [0, 1, 2, 3]) {
  setup([['topaz', 5]]);
  const { g, target, cross } = build({ crossStage: cs, extra: [[11, 'diamond', ss]] });
  const share = towerMod.getAuraOutput(cross, 1);
  g.applyTrapezoidAuras(); g.syncTowerAuras();
  const r = show(g, target);
  log(`  十字★${cs}(发出${JSON.stringify(share)}) + 菱形★${ss} → 穿透光环=${r.pen}  来源=${r.srcs}`);
}

log('\n===== 3. 十字塔 5 家族全嵌 ★3 × 梯塔★0 × 菱形塔★0 =====');
{
  setup([['sapphire', 5], ['topaz', 5], ['emerald', 5], ['ruby_crit', 5], ['topaz_break', 5]]);
  const { g, target, cross } = build({ crossStage: 3, extra: [[11, 'trapezoid', 0], [0, 'diamond', 0]] });
  log(`  cross 发出 = ${JSON.stringify(towerMod.getAuraOutput(cross, 1))}`);
  g.applyTrapezoidAuras(); g.syncTowerAuras();
  log(`  目标塔 ← ${JSON.stringify(show(g, target))}`);
  log(`  期望：攻速 = 梯塔100 + 共享(50*100%)=50 → 若只 100 说明共享被顶掉`);
}

log('\n===== 4. 十字塔单独（5 家族全嵌 ★0）—— 没有其他辅助塔时共享是否生效 =====');
{
  setup([['sapphire', 5], ['topaz', 5], ['emerald', 5], ['ruby_crit', 5], ['topaz_break', 5]]);
  const { g, target, cross } = build({ crossStage: 0 });
  log(`  cross 发出 = ${JSON.stringify(towerMod.getAuraOutput(cross, 1))}`);
  g.applyTrapezoidAuras(); g.syncTowerAuras();
  log(`  目标塔 ← ${JSON.stringify(show(g, target))}`);
}

fs.writeFileSync(path.join(ROOT, 'tmp', '_repro2.txt'), out.join('\n'), 'utf8');
console.log('done');
