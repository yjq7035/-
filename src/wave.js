// 波次生成（纯函数，从原 Game.generateWave 抽离）
function generateWave(waveNumber) {
  const enemies = [];

  // 最后一波（第 20 波）是最终 BOSS
  if (waveNumber === 20) {
    enemies.push('finalBoss');
    return enemies;
  }

  // 每波 30 只普通怪
  for (let i = 0; i < 30; i++) {
    enemies.push('normal');
  }

  // 每 3 波一个精英
  if (waveNumber % 3 === 0) {
    enemies.push('fast');
  }

  // 每 5 波一个重型精英
  if (waveNumber % 5 === 0) {
    enemies.push('heavy');
  }

  // 每 10 波一个 BOSS
  if (waveNumber % 10 === 0) {
    enemies.push('boss');
  }

  return enemies;
}

module.exports = { generateWave };
