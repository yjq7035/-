// 游戏配置与数据表（塔 / 敌人 / 布局 / 数值参数）
// 集中常量，便于平衡调整，且让各模块共享同一份定义。

// 全部塔定义（含底部商店未展示的 long_rectangle）
const TOWER_DEFS = {
  triangle:      { name: '三角塔', color: '#FF4444', cost: 100 },
  circle:        { name: '圆塔',   color: '#4444FF', cost: 150 },
  hexagon:       { name: '六边塔', color: '#44FF44', cost: 200 },
  square:        { name: '正方塔', color: '#FF44FF', cost: 250 },
  trapezoid:     { name: '梯塔',   color: '#FF8844', cost: 275 },
  semicircle:    { name: '半圆塔', color: '#44FFFF', cost: 180 },
  sector:        { name: '扇塔',   color: '#FFFF44', cost: 350 },
  long_rectangle:{ name: '长方塔', color: '#AA44FF', cost: 300 },
};

// 底部商店常驻展示 / 可拖放的 5 种塔
const SHOP_TOWERS = ['triangle', 'circle', 'hexagon', 'square', 'semicircle'];

// 敌人类型表
const ENEMY_TYPES = {
  normal:    { hp: 100,   speed: 3.0, color: '#808080', tier: 0, reward: 10,  size: 16 },
  fast:      { hp: 50,    speed: 5.0, color: '#FF8C00', tier: 1, reward: 15,  size: 14 },
  heavy:     { hp: 500,   speed: 2.0, color: '#555555', tier: 2, reward: 50,  size: 20 },
  elite:     { hp: 20000, speed: 3.0, color: '#FFD700', tier: 3, reward: 200,  size: 22 },
  boss:      { hp: 200000,speed: 2.5, color: '#FF0000', tier: 4, reward: 1000, size: 28 },
  finalBoss: { hp: 4000000,speed: 1.5, color: '#9900FF', tier: 5, reward: 5000, size: 36 },
};

// 布局参数
const LAYOUT = {
  // 地图槽位（6 个，2 行 3 列）
  slotSize: 44,
  slotGap: 10,
  slotCols: 3,
  slotRows: 2,
  // 底部商店栏
  shopSlotWidth: 72,
  shopSlotHeight: 72,
  shopGap: 10,
  shopBarYOffset: 94,   // drawUI 绘制起点 = height - 94
  // 刷新按钮（点击判定区，保持原版值）
  refreshBtnClick: { yOffset: 97, w: 68, h: 75 },
  // 刷新按钮（drawUI 绘制区，保持原版值）
  refreshBtnDraw: { yOffset: 94, w: 68, h: 72 },
  // 路径外围偏移
  pathPadding: 40,
};

// 数值参数
const BALANCE = {
  startGold: 200,
  startLives: 20,
  refreshCost: 10,
  refreshCostStep: 5,
  spawnInterval: 1.0,
  waitDuration: 5,
  totalWaves: 20,
};

module.exports = {
  TOWER_DEFS,
  SHOP_TOWERS,
  ENEMY_TYPES,
  LAYOUT,
  BALANCE,
};
