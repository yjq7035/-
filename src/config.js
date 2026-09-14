// 游戏配置与数据表（塔 / 敌人 / 布局 / 数值参数）
// 集中常量，便于平衡调整，且让各模块共享同一份定义。

// ========== 玩家定义 ==========
const PLAYER = {
  NONE: -1,       // 无主
  OWN: 0,         // 我方玩家
  ENEMY: 2,       // 敌方（怪物）
};

// ========== 敌我关系表 ==========
// 定义玩家之间的敌对关系（双向）
const HOSTILE_RELATIONS = {
  [PLAYER.OWN]: [PLAYER.ENEMY],
  [PLAYER.ENEMY]: [PLAYER.OWN],
};

// 基础攻击速度：100 = 100%（标准攻速）
const ATTACK_SPEED_BASE = 100;

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

// 塔的详细属性（含攻击间隔秒数）
const TOWER_STATS = {
  triangle:      { hp: 100, damage: 20, range: 200, attackSpeedMultiplier: 100, attackInterval: 0.5, isSupport: false, description: '快速射击，对单个目标造成持续伤害。适合应对大量敌人。' },
  circle:        { hp: 150, damage: 25, range: 200, attackSpeedMultiplier: 100, attackInterval: 0.8, isSupport: false, description: '攻击命中时触发二次爆炸，对周围敌人造成25%溅射伤害。适合对付聚集的敌人。' },
  hexagon:       { hp: 200, damage: 50, range: 200, attackSpeedMultiplier: 100, attackInterval: 1.2, isSupport: false, description: '强力狙击射击，对单一目标造成高额伤害。对精英及以上等级怪物特攻，伤害翻倍。' },
  square:        { hp: 220, damage: 55, range: 200, attackSpeedMultiplier: 100, attackInterval: 1.0, isSupport: false, description: '旋转冲锋攻击，直线穿透多个敌人。均衡的单体输出，适合应对各类敌人。' },
  trapezoid:     { hp: 230, damage: 0, range: 150, attackSpeedMultiplier: 0, isSupport: true, supportBuff: { attackSpeedMultiplier: 25 }, description: '辅助塔，不提供攻击。给周围我方图形塔增加25%攻击速度光环效果。' },
  semicircle:    { hp: 130, damage: 2, range: 200, attackSpeedMultiplier: 100, attackInterval: 0.15, isSupport: false, description: '持续激光连接目标，对连接的敌人造成持续伤害。适合对付高血量单体目标。' },
  sector:        { hp: 180, damage: 40, range: 250, attackSpeedMultiplier: 100, attackInterval: 2.0, isSupport: false, description: '扇形范围攻击，AOE伤害覆盖大面积区域。适合对付密集敌人群。' },
  long_rectangle:{ hp: 250, damage: 2, range: 200, attackSpeedMultiplier: 100, attackInterval: 0.25, isSupport: false, description: '堆叠火炮系统，对重复单位攻击时叠加伤害，累积层数后造成巨额爆发。适合对付BOSS级别敌人。' },
};

// 底部商店常驻展示 / 可拖放的 5 种塔
const SHOP_TOWERS = ['triangle', 'circle', 'hexagon', 'square', 'semicircle'];

// 敌人类型表
// elite/boss/finalBoss 的 hp 是相对普通怪基础 HP(100) 的倍率
// elite = 15倍, boss = 50倍, finalBoss = 200倍
// rewardPerWave: 击杀奖励随波次增长的额外金币（每波 +N），未配置则为固定奖励
const ENEMY_TYPES = {
  normal:    { hp: 100,      speed: 3.0, color: '#808080', tier: 0, reward: 10,  rewardPerWave: 1, size: 16 },
  fast:      { hp: 100,      speed: 5.0, color: '#FF8C00', tier: 1, reward: 15,  rewardPerWave: 1, size: 14 },
  heavy:     { hp: 500,      speed: 2.0, color: '#555555', tier: 2, reward: 50,  rewardPerWave: 3, size: 20 },
  elite:     { hp: 1500,     speed: 3.0, color: '#FFD700', tier: 3, reward: 500,  size: 22 },
  boss:      { hp: 5000,     speed: 2.5, color: '#FF0000', tier: 4, reward: 1000, size: 28 },
  finalBoss: { hp: 20000,    speed: 1.5, color: '#9900FF', tier: 5, reward: 5000, size: 36 },
};

// 布局参数
const LAYOUT = {
  // 地图槽位（12 个，3 行 4 列）
  slotSize: 36,
  slotGap: 8,
  slotCols: 4,
  slotRows: 3,
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
  startGold: 350,
  startLives: 100, // 生存积分池：100 分制，野怪逃离按类型扣分，归零判负；进度条 = lives / startLives
  refreshCost: 10,
  refreshCostStep: 5,
  spawnInterval: 1.0,
  waitDuration: 5,
  totalWaves: 20,
};

module.exports = {
  TOWER_DEFS,
  TOWER_STATS,
  SHOP_TOWERS,
  ENEMY_TYPES,
  LAYOUT,
  BALANCE,
  PLAYER,
  HOSTILE_RELATIONS,
  ATTACK_SPEED_BASE,
};
