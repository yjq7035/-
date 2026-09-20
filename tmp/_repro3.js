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
const out = [];
const log = (s) => out.push(s);
function mkGame(W, H) {
  const canvas = { width: W, height: H, addEventListener() {}, removeEventListener() {}, getContext() { return ctx; } };
  return new Game(canvas, ctx, { screenWidth: W, screenHeight: H, renderScale: 1 });
}

meta.resetAll();
meta.grantPoints(1e9);
for (let i = 0; i < 5; i++) meta.upgradeCodex('cross');
[['sapphire', 5], ['topaz', 5], ['emerald', 5], ['ruby_crit', 5], ['topaz_break', 5]].forEach((k, i) => {
  const r = meta.addGem(k[0], k[1]);
  if (r.ok) meta.embedGem('cross', i, r.gem.uid);
});

const g = mkGame(375, 667);
const place = (idx, type, stage) => {
  const s = g.slots[idx];
  const t = towerMod.createTower(type, s.x + s.size / 2, s.y + s.size / 2);
  t.stage = stage; s.tower = t; s.occupied = true; g.towers.push(t);
  return t;
};
const cross = place(5, 'cross', 3);
const target = place(4, 'triangle', 0);
place(11, 'trapezoid', 0);
place(0, 'diamond', 0);
g.applyTrapezoidAuras();
g.syncTowerAuras();

log(`cross 发出 = ${JSON.stringify(towerMod.getAuraOutput(cross, 1))}`);
log(`auraBuffs  = ${JSON.stringify(target.auraBuffs)}`);
log(`auras      = ${JSON.stringify(g.auraManager.getAuras(target.uniqueId), null, 0)}`);
const info = bonusStats.collectTowerStats(g, target, config.TOWER_STATS.triangle, 'triangle');
log(`final      = ${JSON.stringify(info.final)}`);
log(`生效效果:`);
for (const e of info.effects) log(`   ${e.source} | ${e.text}`);
log(`属性行:`);
for (const r of info.rows) log(`   ${r.key}: base=${r.baseText} bonus=${r.bonusText} parts=${r.parts.map((p) => p.text).join(' / ')}`);
log(`战斗: 攻速=${g.auraManager.getBuffedValue(target.uniqueId, 100)} 穿透=${g.getEffectivePenetration(target)}`);
log(`攻击画像: ${JSON.stringify(towerMod.getAttackProfile(target))}`);
log(`战斗伤害: ${g.towerDamage(target, towerMod.getTowerRuntimeStats(target).damage)}`);

// 反向：只有梯塔 / 只有十字塔
const solo = mkGame(375, 667);
const t2 = towerMod.createTower('triangle', 180, 300);
solo.towers = [t2];
const base = {
  speed: solo.auraManager.getBuffedValue(t2.uniqueId, 100),
  pen: solo.getEffectivePenetration(t2),
  prof: towerMod.getAttackProfile(t2),
};
log(`对照（无任何光环）: ${JSON.stringify(base)}`);

fs.writeFileSync(path.join(ROOT, 'tmp', '_repro3.txt'), out.join('\n'), 'utf8');
console.log('done');
