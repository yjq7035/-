// 敌人：工厂 + 更新逻辑（从原 Game.spawnEnemy / updateEnemy 抽离）
const { ENEMY_TYPES, PLAYER } = require('./config');
const { getPathLength, getPathPosition } = require('./geometry');
const { getWaveHPMultiplier } = require('./wave');
const { createUnit } = require('./units');

// 眩晕 debuff（椭圆塔「眩晕射击」专用，全库唯一 stun 来源）：
//   · 时长固定 STUN_DURATION 秒，不随技能等级/进阶变化
//   · 同塔单 debuff 规则（仿 armorBreak）：同一目标同时只留一份眩晕，重复命中刷新时长、不叠加
const STUN_DURATION = 1.0;

// 在路径起点创建一只敌人
function spawnEnemy(type, pathPoints, waveNumber, currentLevel) {
  const config = ENEMY_TYPES[type] || ENEMY_TYPES.normal;
  const pos = getPathPosition(pathPoints, 0);
  
  // 根据波数计算生命值倍率
  const hpMultiplier = waveNumber ? getWaveHPMultiplier(waveNumber) : 1;
  
  // Boss 阶段加成（第11波开始）：HP额外+100%，速度额外+15%
  const isBossPhase = waveNumber && waveNumber >= 11;
  let hpBonus = isBossPhase ? 2 : 1;
  let speedBonus = isBossPhase ? 1.15 : 1;

  // 关卡 11-20 额外生命增长：波 1-10 每波额外增加 (当前关卡-10)*1%（线性增长），波 11+ 锁死
  let extraGrowth = 0;
  if (currentLevel >= 11 && waveNumber) {
    extraGrowth = (currentLevel - 10) * 0.01 * Math.min(waveNumber, 10);
  }

  // 精英/Boss/最终Boss 使用独立的生命值计算
  // elite = 普通*15, boss = 普通*50, finalBoss = boss*5 = 普通*250
  let scaledHp;
  if (type === 'elite') {
    scaledHp = Math.floor(100 * 15 * hpMultiplier * hpBonus * (1 + extraGrowth));
  } else if (type === 'boss') {
    scaledHp = Math.floor(100 * 50 * hpMultiplier * hpBonus * (1 + extraGrowth));
  } else if (type === 'finalBoss') {
    scaledHp = Math.floor(100 * 50 * hpMultiplier * hpBonus * (1 + extraGrowth));
  } else {
    scaledHp = Math.floor(config.hp * hpMultiplier * hpBonus * (1 + extraGrowth));
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
  // 固定护甲（减伤值）：与塔的穿透抵扣，见 game_core.applyDamage
  enemy.armor = config.armor || 0;
  // 击杀奖励：基础奖励 + 每波加成（rewardPerWave 未配置则为固定奖励）
  enemy.reward = config.reward + (config.rewardPerWave || 0) * (waveNumber || 1);
  enemy.size = config.size;
  enemy.progress = 0;
  // 眩晕 debuff：剩余秒数（>0 = 眩晕中，不能移动+不能攻击）；出生即清零
  enemy.stunTimer = 0;
  enemy.stunSource = null;
  // 血条"白色缓冲条"的鬼影初值必须 = 满血：否则怪物出生时即为满血、
  // 小血条不绘制，鬼影就一直没机会初始化 —— 等它真被打了才第一次绘制，
  // 初始值会退化成"当前血量"，于是**第一次挨打的白条永远不出现**。
  enemy._hpGhost = scaledHp;
  // BOSS 走"漏桶"口径（renderer.advanceBossGhost），桶也要在出生时清零：
  // 单位现在不池化，但把"出生即初始化"这条规矩一次写全，免得将来复用对象时
  // 带着上一只的旧桶（表现为"刚出生就挂着一段白条"）。
  enemy._hpGhostPool = 0;
  // 初始朝向：取路径第一段切线方向（首帧即有正确朝向，供渲染朝向指示器）
  if (pathPoints.length >= 2) {
    enemy.facing = Math.atan2(pathPoints[1].y - pathPoints[0].y, pathPoints[1].x - pathPoints[0].x);
  } else {
    enemy.facing = 0;
  }

  return enemy;
}

// 眩晕是否生效中（>0 = 不能移动+不能攻击）
function isStunned(enemy) {
  return !!enemy && enemy.alive && (enemy.stunTimer || 0) > 0;
}

// 给目标挂眩晕（同塔单 debuff：重复命中刷新到满时长，不叠加、不延长上限之外）
function applyStun(enemy, source) {
  if (!enemy || !enemy.alive) return false;
  enemy.stunTimer = STUN_DURATION;
  if (source !== undefined) enemy.stunSource = source;
  return true;
}

// 沿路径推进敌人；返回 true 表示到达终点（由调用方扣生命）
// 眩晕中：只消耗 stunTimer，不推进、不判定到达（= 不能移动 + 不能攻击/漏怪扣分）
function updateEnemy(enemy, deltaTime, pathPoints) {
  if (!enemy.alive) return false;

  if ((enemy.stunTimer || 0) > 0) {
    enemy.stunTimer = Math.max(0, (enemy.stunTimer || 0) - (deltaTime || 0));
    if (enemy.stunTimer <= 0) enemy.stunSource = null;
    return false;
  }

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

module.exports = { spawnEnemy, updateEnemy, isStunned, applyStun, STUN_DURATION };
