// 波次生成（纯函数，从原 Game.generateWave 抽离）

const { BALANCE } = require('./config');

// 每波怪物数量
const NORMAL_COUNT = 30;

function generateWave(waveNumber) {
  const enemies = [];

  const fastChance = BALANCE.fastChance;         // 每只普通怪变为加速怪的概率
  const maxFastPerWave = BALANCE.maxFastPerWave; // 每波加速怪上限

  // 加速怪计数（每波上限 maxFastPerWave，含保底与随机）
  let fastCount = 0;

  // 把一只加速怪加入队列；已达上限则失败（由调用方退化为普通怪）
  function trySpawnFast() {
    if (fastCount >= maxFastPerWave) return false;
    enemies.push('fast');
    fastCount++;
    return true;
  }

  // 最后一波（第 20 波）是最终 BOSS
  if (waveNumber === 20) {
    for (let i = 0; i < NORMAL_COUNT; i++) {
      // 普通怪按概率升级为加速怪
      if (Math.random() < fastChance) {
        trySpawnFast();
      } else {
        enemies.push('normal');
      }
    }
    enemies.push('finalBoss');
    return enemies;
  }

  // 特殊怪物：重型（每5波）/ BOSS（每10波）。
  // 加速怪改为「普通怪随机刷新 + 每3波保底」机制，不再作为固定特殊怪。
  const specials = [];
  if (waveNumber % 5 === 0) specials.push('heavy');
  if (waveNumber % 10 === 0) specials.push('boss');

  // 每 3 波保底 1 只加速怪（计入上限）
  const guaranteedFast = waveNumber % 3 === 0;

  // 普通怪数量 = 总怪数 - 其它特殊怪（重型/BOSS）
  const normalCount = NORMAL_COUNT - specials.length;

  // 刷普通怪：每只按概率变为加速怪，受上限约束
  for (let i = 0; i < normalCount; i++) {
    if (Math.random() < fastChance) {
      // 尝试刷加速怪；若已达上限则退化为普通怪
      if (!trySpawnFast()) enemies.push('normal');
    } else {
      enemies.push('normal');
    }
  }

  // 保底：每 3 波至少 1 只加速怪。
  // 若随机未刷出，强制把一只普通怪替换为加速怪（随机位置，避免总在队尾）。
  if (guaranteedFast && fastCount === 0 && maxFastPerWave >= 1) {
    const normalIdx = [];
    for (let i = 0; i < enemies.length; i++) {
      if (enemies[i] === 'normal') normalIdx.push(i);
    }
    if (normalIdx.length > 0) {
      const pick = normalIdx[Math.floor(Math.random() * normalIdx.length)];
      enemies[pick] = 'fast';
      fastCount++;
    }
  }

  // 其它特殊怪（重型/BOSS）排在最后
  for (const type of specials) enemies.push(type);

  return enemies;
}

// 根据波数计算怪物生命值的倍率（每波线性增长）
function getWaveHPMultiplier(waveNumber) {
  // 每波生命值 = 波次 * 基础HP
  // 波数1=1倍, 波数5=5倍, 波数20=20倍
  return waveNumber;
}

module.exports = { generateWave, getWaveHPMultiplier };
