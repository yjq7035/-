// 塔：工厂 + 造价（从原 Game.createTower / getTowerCost 抽离）
const { TOWER_DEFS } = require('./config');

function createTower(type, x, y) {
  return {
    type: type,
    x: x,
    y: y,
    attackTimer: 0,
    target: null,
  };
}

function getTowerCost(type) {
  const def = TOWER_DEFS[type];
  return def ? def.cost : 100;
}

module.exports = { createTower, getTowerCost };
