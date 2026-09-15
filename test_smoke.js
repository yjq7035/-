// 冒烟测试：mock 微信/canvas 环境，真实实例化 Game，验证核心改动。
'use strict';

// ---------- mock canvas 2d ctx ----------
const gradient = { addColorStop() {} };
function mkCtx() {
  const fn = () => {};
  return {
    canvas: null,
    save: fn, restore: fn, beginPath: fn, closePath: fn,
    fill: fn, stroke: fn, clip: fn, rect: fn,
    fillRect: fn, strokeRect: fn, clearRect: fn,
    moveTo: fn, lineTo: fn, arc: fn, ellipse: fn,
    roundRect: fn, setLineDash: fn,
    translate: fn, rotate: fn, scale: fn,
    fillText: fn, strokeText: fn,
    measureText: (t) => ({ width: (t || '').length * 10 }),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    createPattern: () => gradient,
    drawImage: fn, putImageData: fn,
    setTransform: fn, resetTransform: fn,
  };
}
const canvas = { width: 640, height: 960, getContext: () => ctx };
const ctx = mkCtx();
ctx.canvas = canvas;

// 全局环境
global.wx = undefined; // 走浏览器兜底分支
global.document = { addEventListener() {}, removeEventListener() {} };
global.requestAnimationFrame = () => 0;
global.window = global;

// ---------- 1) 模块加载 ----------
const config = require('./src/config');
const towerMod = require('./src/tower');
const AuraManager = require('./src/auraManager');
const Game = require('./src/game_core');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? ' -> ' + detail : '')); }
}

console.log('== 1) 阶段封顶与奖励表 ==');
check('MAX_STAGE === 3', config.MAX_STAGE === 3, String(config.MAX_STAGE));
check('STAGE_BOOSTS = {1:100,2:200,3:400}',
  config.STAGE_BOOSTS[1] === 100 && config.STAGE_BOOSTS[2] === 200 && config.STAGE_BOOSTS[3] === 400,
  JSON.stringify(config.STAGE_BOOSTS));
check('1星增幅 = 100', towerMod.getAttackPowerBoost(1) === 100, String(towerMod.getAttackPowerBoost(1)));
check('2星增幅 = 200', towerMod.getAttackPowerBoost(2) === 200, String(towerMod.getAttackPowerBoost(2)));
check('3星增幅 = 400', towerMod.getAttackPowerBoost(3) === 400, String(towerMod.getAttackPowerBoost(3)));
check('超阶钳位到3星 (5星 -> 400)', towerMod.getAttackPowerBoost(5) === 400, String(towerMod.getAttackPowerBoost(5)));
const t3a = { type: 'triangle', stage: 3, uniqueId: 'a', owner: 0 };
const t3b = { type: 'triangle', stage: 3, uniqueId: 'b', owner: 0 };
check('3星封顶：两个3星不可再合成', towerMod.canMergeUpgrade(t3a, t3b) === false);
const t0a = { type: 'triangle', stage: 0, uniqueId: 'c', owner: 0 };
const t0b = { type: 'triangle', stage: 0, uniqueId: 'd', owner: 0 };
check('0星可合成（正常）', towerMod.canMergeUpgrade(t0a, t0b) === true);
check('阶段星星 3 星封顶显示', towerMod.getStageStars(5).length === 3, towerMod.getStageStars(5));

console.log('== 2) 光环：高阶覆盖低阶 + 过期 ==');
const am = new AuraManager();
am.applyAura('low', { attackSpeedMultiplier: 25 }, 0, 'target', 3.0);
am.applyAura('high', { attackSpeedMultiplier: 75 }, 2, 'target', 3.0);
check('高阶覆盖低阶（75 生效）', am.getBuffedValue('target', 100) === 175, String(am.getBuffedValue('target', 100)));
// 低阶再刷新不能压低数值
am.applyAura('low', { attackSpeedMultiplier: 25 }, 0, 'target', 3.0);
check('低阶不能覆盖已生效的高阶', am.getBuffedValue('target', 100) === 175, String(am.getBuffedValue('target', 100)));
am.update(3.5); // 过期
check('3.5s 后光环过期移除', am.getBuffedValue('target', 100) === 100, String(am.getBuffedValue('target', 100)));
am.applyAura('h2', { attackSpeedMultiplier: 100 }, 3, 't2', 3.0);
check('3星光环 buff=100', am.getBuffedValue('t2', 100) === 200, String(am.getBuffedValue('t2', 100)));
am.clear();
check('clear 后无光环', am.hasAura('t2') === false);

console.log('== 3) Game 实例化（mock 环境）==');
const game = new Game(canvas, ctx, { screenWidth: 640, screenHeight: 960 });
check('游戏实例创建成功', !!game && typeof game.update === 'function');
check('btnPress/buttonFx 状态存在', game.btnPress === null && game.buttonFx === null);
check('光环管理器实例化', game.auraManager instanceof AuraManager);

console.log('== 4) 扇塔单次伤害验证 ==');
// 构造：扇塔 + 一个满血敌人位于扇形正前方
const secTower = {
  type: 'sector', x: 300, y: 300, level: 0, stage: 0,
  attackPowerBoost: 0, attackAngle: 0, attackTimer: 0,
  uniqueId: 'sec1', owner: 0,
};
const enemy = {
  alive: true, x: 380, y: 300, // 正前方 80px，在 45° 扇形内
  size: 16, hp: 100, maxHp: 100, tier: 1, type: 'normal',
  uniqueId: 'e1', reward: 5,
};
game.towers = [secTower];
game.enemies = [enemy];
game.enemiesToSpawn = [];
game.projectiles = [];
game.effects = [];

const stats = require('./src/renderer').getTowerStats('sector');
const expectedDamage = towerMod.calculateFinalDamage(stats.damage, 0, 0);
console.log('  扇塔基础伤害 =', expectedDamage);

game.fireSectorAOE(secTower);
check('一次攻击 = 敌人掉血恰好一次', enemy.hp === 100 - expectedDamage,
  'hp=' + enemy.hp + ' 期望 ' + (100 - expectedDamage));

// 扇形外敌人不受该次攻击影响
const enemy2 = { alive: true, x: 300, y: 200, size: 16, hp: 50, maxHp: 50, tier: 1, type: 'normal', uniqueId: 'e2', reward: 5 }; // 正上方 90°，扇形(0°±45°)外
game.enemies = [enemy2];
game.fireSectorAOE(secTower);
check('扇形外敌人不受本次攻击影响', enemy2.hp === 50, 'hp=' + enemy2.hp);

// 视觉弹道不参与二次伤害
const secProj = game.projectiles.find(p => p.type === 'sector');
check('扇塔弹道为纯视觉（damage=0）', secProj && secProj.damage === 0);

console.log('== 5) 渲染函数可用性（血条独立图层）==');
const renderer = require('./src/renderer');
check('drawEnemyHpBar 已导出', typeof renderer.drawEnemyHpBar === 'function');
const barEnemy = { alive: true, x: 100, y: 100, size: 16, hp: 30, maxHp: 100, tier: 1, facing: 0 };
let threw = null;
try { renderer.drawEnemy(game, barEnemy, false); renderer.drawEnemyHpBar(game, barEnemy); } catch (e) { threw = e; }
check('drawEnemy(withHpBar=false) + drawEnemyHpBar 可正常绘制', threw === null, threw && threw.message);

console.log('== 6) 帧循环驱动（update 不抛错）==');
threw = null;
try { game.update(0.016); } catch (e) { threw = e; }
check('update 单帧运行无异常', threw === null, threw && threw.message);

console.log('');
console.log('================ 结果: ' + pass + ' 通过 / ' + fail + ' 失败 ================');
process.exit(fail > 0 ? 1 : 0);
