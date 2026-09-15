// 敌人：工厂 + 更新逻辑（从原 Game.spawnEnemy / updateEnemy 抽离）
const { ENEMY_TYPES, PLAYER } = require('./config');
const { getPathLength, getPathPosition } = require('./geometry');
const { getWaveHPMultiplier } = require('./wave');
const { createUnit } = require('./units');

// 在路径起点创建一只敌人
function spawnEnemy(type, pathPoints, waveNumber) {
  const config = ENEMY_TYPES[type] || ENEMY_TYPES.normal;
  const pos = getPathPosition(pathPoints, 0);
  
  // 根据波数计算生命值倍率
  const hpMultiplier = waveNumber ? getWaveHPMultiplier(waveNumber) : 1;
  
  // Boss 阶段加成（第11波开始）：HP额外+100%，速度额外+15%
  const isBossPhase = waveNumber && waveNumber >= 11;
  let hpBonus = isBossPhase ? 2 : 1;
  let speedBonus = isBossPhase ? 1.15 : 1;
  
  // 精英/Boss/最终Boss 使用独立的生命值计算
  // elite = 普通*15, boss = 普通*50, finalBoss = 普通*200
  let scaledHp;
  if (type === 'elite') {
    scaledHp = Math.floor(100 * 15 * hpMultiplier * hpBonus);
  } else if (type === 'boss') {
    scaledHp = Math.floor(100 * 50 * hpMultiplier * hpBonus);
  } else if (type === 'finalBoss') {
    scaledHp = Math.floor(100 * 200 * hpMultiplier * hpBonus);
  } else {
    scaledHp = Math.floor(config.hp * hpMultiplier * hpBonus);
  }

  // 使用 createUnit 创建敌人（所属玩家ID=2，单位ID=类型名）
  const enemy = createUnit(PLAYER.ENEMY, type, pos.x, pos.y, 0);

  // 扩展敌人属性
  // 显式记录类型（createUnit 只存 unitID，这里补 type 供扣分/胜利判定按类型区分，与 tower.type 约定一致）
  enemy.type = type;
  enemy.maxHp = scaledHp;
  enemy.hp = scaledHp;
  // 速度加成：Boss阶段+15%，加速怪额外+30%
  let finalSpeedBonus = speedBonus;
  if (type === 'fast') {
    finalSpeedBonus = speedBonus * 1.30;
  }
  enemy.speed = config.speed * finalSpeedBonus;
  enemy.color = config.color;
  enemy.tier = config.tier;
  // 击杀奖励：基础奖励 + 每波加成（rewardPerWave 未配置则为固定奖励）
  enemy.reward = config.reward + (config.rewardPerWave || 0) * (waveNumber || 1);
  enemy.size = config.size;
  enemy.progress = 0;
  // 初始朝向：取路径第一段切线方向（首帧即有正确朝向，供渲染朝向指示器）
  if (pathPoints.length >= 2) {
    enemy.facing = Math.atan2(pathPoints[1].y - pathPoints[0].y, pathPoints[1].x - pathPoints[0].x);
  } else {
    enemy.facing = 0;
  }

  return enemy;
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

  // 记录行进朝向（供渲染朝向指示器使用）：取当前位置所在路径段的切线方向
  if (pathPoints.length >= 2) {
    const targetDistance = enemy.progress * pathLength;
    let acc = 0;
    for (let i = 1; i < pathPoints.length; i++) {
      const segLen = Math.sqrt(
        (pathPoints[i].x - pathPoints[i-1].x) ** 2 + (pathPoints[i].y - pathPoints[i-1].y) ** 2
      );
      if (acc + segLen >= targetDistance) {
        enemy.facing = Math.atan2(pathPoints[i].y - pathPoints[i-1].y, pathPoints[i].x - pathPoints[i-1].x);
        break;
      }
      acc += segLen;
    }
  }

  return false;
}

module.exports = { spawnEnemy, updateEnemy };
