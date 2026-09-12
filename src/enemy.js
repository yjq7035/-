// 敌人：工厂 + 更新逻辑（从原 Game.spawnEnemy / updateEnemy 抽离）
const { ENEMY_TYPES } = require('./config');
const { getPathLength, getPathPosition } = require('./geometry');

// 在路径起点创建一只敌人
function spawnEnemy(type, pathPoints) {
  const config = ENEMY_TYPES[type] || ENEMY_TYPES.normal;
  const pos = getPathPosition(pathPoints, 0);

  return {
    type: type,
    x: pos.x,
    y: pos.y,
    maxHp: config.hp,
    hp: config.hp,
    speed: config.speed,
    color: config.color,
    tier: config.tier,
    reward: config.reward,
    size: config.size,
    progress: 0,
    alive: true,
  };
}

// 沿路径推进敌人；返回 true 表示到达终点（由调用方扣生命）
function updateEnemy(enemy, deltaTime, pathPoints) {
  if (!enemy.alive) return false;

  const pathLength = getPathLength(pathPoints);
  const speedPerPixel = enemy.speed / pathLength;
  enemy.progress += speedPerPixel * deltaTime;

  if (enemy.progress >= 1) {
    enemy.alive = false;
    return true; // 到达终点
  }

  const pos = getPathPosition(pathPoints, enemy.progress);
  enemy.x = pos.x;
  enemy.y = pos.y;
  return false;
}

module.exports = { spawnEnemy, updateEnemy };
