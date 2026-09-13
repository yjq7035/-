// 塔：工厂 + 造价（从原 Game.createTower / getTowerCost 抽离）
const { TOWER_DEFS } = require('./config');

function createTower(type, x, y) {
  return {
    type: type,
    x: x,
    y: y,
    level: 0, // 默认无等级 0
    attackTimer: 0,
    target: null,
    lockedTarget: null, // 锁定的目标，目标死亡前不会切换
    attackAngle: 0, // 默认朝向右侧
  };
}

function getTowerCost(type) {
  const def = TOWER_DEFS[type];
  return def ? def.cost : 100;
}

/**
 * 获取塔的等级星星显示
 * 0级 = 无星星
 * 1-5级 = 1-5个⭐
 * 6级 = 1个大⭐ (★★★★★★ → ⭐)
 */
function getTowerStars(level) {
  if (level <= 0) return '';
  if (level >= 6) return '⭐'; // 大星
  return '⭐'.repeat(level);
}

/**
 * 获取等级攻击加成比例
 * 每级 +10% 攻击加成
 */
function getLevelAttackBonus(level) {
  if (level <= 0) return 1;
  if (level >= 6) return 1 + (level - 5) * 0.5; // 大星后每级+50%
  return 1 + level * 0.1; // 小星每级+10%
}

/**
 * 检查是否可以合并进阶
 * tower1: 已存在的塔, tower2: 新放置的塔(参考用)
 * 规则：同类型且等级相同（>=1级），且未达到最高级
 */
function canUpgradeTower(tower1, tower2) {
  if (tower1.type !== tower2.type) return false;
  if (tower1.level < 1 || tower1.level >= 6) return false; // 至少1级，最高6级
  // tower2.level 对于新放置的塔永远是 0，这里不检查 tower2.level
  return true;
}

module.exports = { createTower, getTowerCost, getTowerStars, getLevelAttackBonus, canUpgradeTower };
