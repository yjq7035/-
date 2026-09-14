// 单位系统：统一管理所有游戏单位（塔 + 怪物）
// 提供 createUnit 工厂函数、isHostile 敌我判断、单位注册表

const config = require('./config');

// ========== 单位注册表 ==========
// key: uniqueId, value: unit object
const unitRegistry = new Map();

// 全局唯一 ID 计数器
let nextUnitId = 1;

/**
 * 生成唯一 ID
 */
function generateUniqueId() {
  return nextUnitId++;
}

/**
 * 创建单位
 * @param {number} ownerPlayer - 所属玩家ID (PLAYER.OWN=0, PLAYER.ENEMY=2, PLAYER.NONE=-1)
 * @param {number} unitID - 单位类型ID（塔的type字符串或怪物的type字符串）
 * @param {number} x - X坐标
 * @param {number} y - Y坐标
 * @param {number} defaultAngle - 默认面向角度（弧度）
 * @returns {object} 返回独立的单位对象（包含 uniqueId 字段）
 */
function createUnit(ownerPlayer, unitID, x, y, defaultAngle) {
  const uniqueId = generateUniqueId();
  const unit = {
    uniqueId: uniqueId,
    owner: ownerPlayer,
    unitID: unitID,
    x: x,
    y: y,
    defaultAngle: defaultAngle || 0,
    alive: true,
  };

  // 注册到单位注册表
  unitRegistry.set(uniqueId, unit);

  return unit;
}

/**
 * 从注册表移除单位
 * @param {number} uniqueId - 单位的 uniqueId
 */
function removeUnit(uniqueId) {
  unitRegistry.delete(uniqueId);
}

/**
 * 根据 uniqueId 查找单位
 * @param {number} uniqueId
 * @returns {object|null}
 */
function getUnit(uniqueId) {
  return unitRegistry.get(uniqueId) || null;
}

/**
 * 获取所有存活的单位
 * @returns {Array<object>}
 */
function getAllUnits() {
  const units = [];
  for (const [id, unit] of unitRegistry) {
    if (unit.alive) {
      units.push(unit);
    }
  }
  return units;
}

/**
 * 按玩家获取所有存活单位
 * @param {number} player - 玩家ID
 * @returns {Array<object>}
 */
function getUnitsByPlayer(player) {
  const units = [];
  for (const [id, unit] of unitRegistry) {
    if (unit.alive && unit.owner === player) {
      units.push(unit);
    }
  }
  return units;
}

/**
 * 判断玩家A与玩家B是否为敌对关系
 * @param {number} playerA - 玩家A ID
 * @param {playerB - 玩家B ID
 * @returns {boolean} true 表示敌对，false 表示非敌对
 */
function isHostile(playerA, playerB) {
  // 相同玩家不是敌人
  if (playerA === playerB) return false;

  // PLAYER.NONE 与任何玩家都不是敌人
  if (playerA === config.PLAYER.NONE || playerB === config.PLAYER.NONE) return false;

  const relations = config.HOSTILE_RELATIONS[playerA];
  if (!relations) return false;

  return relations.includes(playerB);
}

/**
 * 清除所有单位（游戏重启时用）
 */
function clearAllUnits() {
  unitRegistry.clear();
  nextUnitId = 1;
}

module.exports = {
  createUnit,
  removeUnit,
  getUnit,
  getAllUnits,
  getUnitsByPlayer,
  isHostile,
  clearAllUnits,
  // 导出内部计数器供测试用
  _getNextId: () => nextUnitId,
};
