// 复现：光环（梯塔/菱形塔）与「共享资源」（十字塔）无法同时作用在同一座目标塔上
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
const bonusStats = require(path.join(ROOT, 'src', 'bonusStats'));

const rec = makeRec();
const ctx = makeCtx(rec);
function mkGame(W, H) {
  const canvas = { width: W, height: H, addEventListener() {}, removeEventListener() {}, getContext() { return ctx; } };
  return new Game(canvas, ctx, { screenWidth: W, screenHeight: H, renderScale: 1 });
}

const out = [];
const log = (s) => out.push(s);

/**
 * 场景：十字塔在 slot5（中心），目标塔在 slot4（左邻），梯塔/菱形塔放 slot11（半径内）
 * 宝石：给 cross 型嵌一颗蓝宝石 Lv.1（攻速 +10）→ 共享出去就是 attackSpeedMultiplier
 */
function scene(opts) {
  meta.resetAll();
  const gem = meta.addGem('sapphire', 1);
  if (gem.ok) meta.embedGem('cross', 0, gem.gem.uid);

  const g = mkGame(375, 667);
  const place = (idx, type) => {
    const s = g.slots[idx];
    const cx = s.x + s.size / 2;
    const cy = s.y + s.size / 2;
    const t = towerMod.createTower(type, cx, cy);
    s.tower = t; s.occupied = true;
    g.towers.push(t);
    return t;
  };
  const cross = place(5, 'cross');
  cross.stage = opts.crossStage || 0;
  const target = place(4, opts.targetType || 'triangle');
  const support = place(11, opts.supportType || 'trapezoid');
  support.stage = opts.supportStage || 0;

  g.applyTrapezoidAuras();
  g.syncTowerAuras();
  return { g, target, cross, support };
}

const dump = (g, t, label) => {
  const auras = g.auraManager.getAuras(t.uniqueId) || [];
  log(`  ${label}`);
  log(`    auraBuffs      = ${JSON.stringify(t.auraBuffs)}`);
  log(`    光环条数       = ${auras.length}`);
  for (const a of auras) log(`      ← ${a.sourceName}(★${a.sourceStage}) ${JSON.stringify(a.buffs)}`);
  log(`    战斗攻速       = ${g.auraManager.getBuffedValue(t.uniqueId, 100)}`);
  log(`    战斗穿透       = ${g.getEffectivePenetration(t)}`);
  const info = bonusStats.collectTowerStats(g, t, config.TOWER_STATS[t.type], t.type);
  log(`    面板 final     = ${JSON.stringify({ as: info.final.attackSpeedMultiplier, pen: info.final.penetration, cc: info.final.critChance, cm: info.final.critMult, br: info.final.break, dmgPct: info.final.damagePercent })}`);
  log(`    生效效果       = ${info.effects.map((e) => `${e.source}:${e.text}`).join(' | ')}`);
};

log('===== A. 只有十字塔（邻接）=====');
{
  const { g, target } = scene({});
  dump(g, target, '目标塔（十字塔左邻，无其他辅助塔）');
}

log('\n===== B. 只有梯塔（半径内）=====');
{
  const { g, target } = scene({ supportType: 'trapezoid' });
  // 把十字塔挪出 slot（移出网格）→ 邻接模式下无邻居
  const { target: t2 } = { target };
  dump(g, target, '目标塔（同场景，十字塔仍在）');
}

log('\n===== C. 十字塔 + 梯塔 同时罩住（核心复现）=====');
for (const cs of [0, 1, 2, 3]) {
  for (const ss of [0, 1, 2, 3]) {
    const { g, target } = scene({ crossStage: cs, supportStage: ss, supportType: 'trapezoid' });
    const as = g.auraManager.getAuraValue(target.uniqueId, 'attackSpeedMultiplier');
    const auras = g.auraManager.getAuras(target.uniqueId) || [];
    const src = auras.filter((a) => a.buffs.attackSpeedMultiplier !== undefined).map((a) => a.sourceName).join(',');
    log(`  十字★${cs} + 梯塔★${ss} → 攻速光环=${as}  来源=${src || '(无)'}  条数=${auras.length}`);
  }
}

log('\n===== D. 十字塔 + 菱形塔（穿透键冲突）=====');
for (const cs of [0, 1, 2, 3]) {
  for (const ss of [0, 1, 2, 3]) {
    const { g, target } = scene({ crossStage: cs, supportStage: ss, supportType: 'diamond' });
    const pen = g.auraManager.getAuraValue(target.uniqueId, 'penetration');
    const auras = g.auraManager.getAuras(target.uniqueId) || [];
    const src = auras.filter((a) => a.buffs.penetration !== undefined).map((a) => a.sourceName).join(',');
    log(`  十字★${cs} + 菱形★${ss} → 穿透光环=${pen}  来源=${src || '(无)'}  条数=${auras.length}`);
  }
}

log('\n===== E. 详细 dump：十字★3 + 梯塔★0 =====');
{
  const { g, target } = scene({ crossStage: 3, supportStage: 0, supportType: 'trapezoid' });
  dump(g, target, '十字★3 + 梯塔★0');
}
log('\n===== F. 详细 dump：十字★0 + 梯塔★3 =====');
{
  const { g, target } = scene({ crossStage: 0, supportStage: 3, supportType: 'trapezoid' });
  dump(g, target, '十字★0 + 梯塔★3');
}

fs.writeFileSync(path.join(ROOT, 'tmp', '_repro-share-aura.txt'), out.join('\n'), 'utf8');
console.log('done');
