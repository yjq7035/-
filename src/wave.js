// 波次生成（纯函数，从原 Game.generateWave 抽离）

// 每波怪物数量
const NORMAL_COUNT = 30;

function generateWave(waveNumber) {
  const enemies = [];

  // 最后一波（第 20 波）是最终 BOSS
  if (waveNumber === 20) {
    // 最终波：30 只普通怪 + 最终 BOSS（BOSS 最后一个刷）
    for (let i = 0; i < NORMAL_COUNT; i++) {
      enemies.push('normal');
    }
    enemies.push('finalBoss');
    return enemies;
  }

  // 确定特殊怪物
  const specials = [];
  
  // 每 3 波一个精英（fast）
  if (waveNumber % 3 === 0) {
    specials.push({ type: 'fast', interval: 3, totalWaves: waveNumber });
  }
  
  // 每 5 波一个重型精英（heavy）
  if (waveNumber % 5 === 0) {
    specials.push({ type: 'heavy', interval: 5, totalWaves: waveNumber });
  }
  
  // 每 10 波一个 BOSS
  if (waveNumber % 10 === 0) {
    specials.push({ type: 'boss', interval: 10, totalWaves: waveNumber });
  }

  // 如果有特殊怪物，30 只普通怪中穿插
  if (specials.length > 0) {
    // 计算总共需要刷多少只特殊怪
    const specialCount = specials.length;
    // 每波固定刷 NORMAL_COUNT 只怪，其中包含特殊怪
    // 特殊怪均匀分布在 30 只怪的最后
    const normalCount = NORMAL_COUNT - specialCount;
    
    // 先刷普通怪
    for (let i = 0; i < normalCount; i++) {
      enemies.push('normal');
    }
    
    // 再刷特殊怪（每个特殊怪按间隔均匀分布）
    for (let i = 0; i < specialCount; i++) {
      enemies.push(specials[i].type);
    }
  } else {
    // 没有特殊怪物，刷 30 只普通怪
    for (let i = 0; i < NORMAL_COUNT; i++) {
      enemies.push('normal');
    }
  }

  return enemies;
}

// 根据波数计算怪物生命值的倍率（每波线性增长）
function getWaveHPMultiplier(waveNumber) {
  // 每波生命值 = 波次 * 基础HP
  // 波数1=1倍, 波数5=5倍, 波数20=20倍
  return waveNumber;
}

module.exports = { generateWave, getWaveHPMultiplier };
