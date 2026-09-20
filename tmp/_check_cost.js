const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const { makeCtx, makeRec } = require(path.join(ROOT, '.workbuddy', 'tools', 'harness'));

global.document = { addEventListener() {}, removeEventListener() {} };
global.requestAnimationFrame = () => 0;

const Game = require(path.join(ROOT, 'src', 'game_core'));
const renderer = require(path.join(ROOT, 'src', 'renderer'));
const towerMod = require(path.join(ROOT, 'src', 'tower'));
const skills = require(path.join(ROOT, 'src', 'skills'));
const config = require(path.join(ROOT, 'src', 'config'));

const rec = makeRec();
const ctx = makeCtx(rec);
const canvas = { width: 390, height: 844, addEventListener() {}, removeEventListener() {}, getContext() { return ctx; } };
const g = new Game(canvas, ctx, { screenWidth: 390, screenHeight: 844, renderScale: 1 });

// 复刻玩家截图：半圆塔，从未强化，收到十字塔共享的 +11 技能等级
const t = towerMod.createTower('semicircle', 100, 100);
t.stage = config.BALANCE.enhance.minStage;
t.enhanceLevel = 0;
t.auraBuffs = { skillLevels: 11 };
g.towers.push(t);
g.selectedTower = t;
g.panelTowerType = 'semicircle';
g.showPanel = true;
g.gold = 99999;
g.scene = 'battle';
g.battleStarted = true;

const out = [];
out.push('=== 口径 ===');
out.push('learnedLevel(学习)   = ' + skills.learnedLevel(t));
out.push('extraLevel(额外)     = ' + skills.extraLevel(t, 'semicircle'));
out.push('currentLevel(当前)   = ' + skills.currentLevel(t, 'semicircle'));
out.push('learnableCap(可学)   = ' + skills.learnableCap(t, 'semicircle'));
out.push('levelText(显示)      = ' + skills.levelText(t, 'semicircle'));
out.push('getEnhanceTimes(次数) = ' + towerMod.getEnhanceTimes(t));
out.push('getEffectiveSkillLevel= ' + towerMod.getEffectiveSkillLevel(t));
out.push('canEnhance           = ' + towerMod.canEnhance(t));
out.push('enhanceCost(按次数)  = ' + towerMod.getEnhanceCost('semicircle', towerMod.getEnhanceTimes(t)));
out.push('enhanceCost(按学习0) = ' + towerMod.getEnhanceCost('semicircle', skills.learnedLevel(t)));
out.push('baseCost             = ' + towerMod.getTowerCost('semicircle'));
out.push('costRate             = ' + config.BALANCE.enhance.costRate);

rec.texts.length = 0;
let err = null;
try { renderer.render(g); } catch (e) { err = e; }
out.push('render err=' + (err ? err.message : 'none'));
out.push('=== 面板出现的关键文字 ===');
for (const s of rec.texts.map((x) => x.text)) {
  if (/固有技能|花费|💰|已满|可学|等级|\d\/\d|强化/.test(s)) out.push('  ' + s);
}

fs.writeFileSync(path.join(__dirname, '_check_cost.txt'), out.join('\n'), 'utf8');
