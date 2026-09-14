// 塔：工厂 + 造价（从原 Game.createTower / getTowerCost 抽离）
const { TOWER_DEFS, TOWER_STATS, PLAYER, ATTACK_SPEED_BASE } = require('./config');
const { createUnit } = require('./units');

function createTower(type, x, y) {
  const stats = TOWER_STATS[type] || TOWER_STATS.triangle;
  
  // 使用 createUnit 创建单位（所属玩家ID=0，单位ID=类型名）
  const tower = createUnit(PLAYER.OWN, type, x, y, 0);
  
  // 扩展塔属性
  tower.type = type;
  tower.level = 0;
  tower.stage = 0;                // 阶段（初始0阶段，通过同类型同阶段合成升级）
  tower.attackTimer = 0;
  tower.target = null;
  tower.lockedTarget = null; // 锁定的目标，目标死亡前不会切换
  tower.attackAngle = 0; // 默认朝向右侧
  // 长方塔堆叠伤害字段
  tower.stackCount = 0;       // 当前堆叠层数
  tower.stackTarget = null;   // 当前堆叠的目标
  tower.stackTimer = 0;       // 堆叠倒计时
  // 攻击速度乘数（基于100的百分比）
  tower.attackSpeedMultiplier = stats.attackSpeedMultiplier || ATTACK_SPEED_BASE;
  // 是否辅助塔
  tower.isSupport = stats.isSupport || false;
  // 攻击增幅属性（通过合成升级获得）
  tower.attackPowerBoost = 0;   // 攻击力增幅百分比（0 = 无增幅）
  
  return tower;
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
 * 获取阶段星星显示
 * 0阶段 = 无显示
 * 1+阶段 = 1+个🌟
 */
function getStageStars(stage) {
  if (stage <= 0) return '';
  return '🌟'.repeat(stage);
}

/**
 * 获取攻击增幅百分比
 * 每个阶段 +100% 攻击力增幅
 */
function getAttackPowerBoost(stage) {
  return stage * 100; // 阶段0=0%, 阶段1=100%, 阶段2=200% ...
}

/**
 * 计算最终攻击力（包含等级加成和攻击增幅）
 * 公式：最终攻击力 = 基础攻击力 × 等级加成 × (1 + 攻击增幅/100)
 */
function calculateFinalDamage(baseDamage, level, attackPowerBoost) {
  const levelBonus = getLevelAttackBonus(level);
  const boostMultiplier = 1 + (attackPowerBoost / 100);
  return Math.floor(baseDamage * levelBonus * boostMultiplier);
}

/**
 * 检查是否可以合成升级
 * tower1: 已存在的塔(目标槽), tower2: 新放置的塔(触发拖放)
 * 规则：同类型 + 同阶段 + 不是自身 + 同一玩家
 */
function canMergeUpgrade(tower1, tower2) {
  if (tower1.type !== tower2.type) return false;
  if (tower1.stage !== tower2.stage) return false;
  // tower2.uniqueId 可能为 null（拖放中的塔），此时跳过自身检查
  if (tower2.uniqueId !== null && tower1.uniqueId === tower2.uniqueId) return false;
  if (tower1.owner !== tower2.owner) return false;
  return true;
}

module.exports = { createTower, getTowerCost, getTowerStars, getLevelAttackBonus, canMergeUpgrade, getStageStars, getAttackPowerBoost, calculateFinalDamage };
