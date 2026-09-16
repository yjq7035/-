// 游戏配置与数据表（塔 / 敌人 / 布局 / 数值参数 / 元进度表）
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

// ========== 稀有度 ==========
// 1=常见(灰蓝) 2=稀有(蓝紫) 3=史诗(金红)
// 决定：图签解锁价、商店卡片描边色、图签网格角标
const RARITY = {
  1: { key: 1, name: '常见', color: '#90A4AE' },
  2: { key: 2, name: '稀有', color: '#7986CB' },
  3: { key: 3, name: '史诗', color: '#FFB74D' },
};

// ========== 全部塔定义（12 种，图签"最低 10 个起步"的容量已达标）==========
// color = 战场身份色；cost = 基础造价；rarity = 稀有度(1~3)
const TOWER_DEFS = {
  triangle:      { name: '三角塔', color: '#FF4444', cost: 100, rarity: 1 },
  circle:        { name: '圆塔',   color: '#4444FF', cost: 150, rarity: 1 },
  hexagon:       { name: '六边塔', color: '#44FF44', cost: 200, rarity: 2 },
  square:        { name: '正方塔', color: '#FF44FF', cost: 250, rarity: 2 },
  trapezoid:     { name: '梯塔',   color: '#FF8844', cost: 275, rarity: 2 },
  semicircle:    { name: '半圆塔', color: '#44FFFF', cost: 180, rarity: 1 },
  sector:        { name: '扇塔',   color: '#FFFF44', cost: 350, rarity: 3 },
  long_rectangle:{ name: '长方塔', color: '#AA44FF', cost: 300, rarity: 2 },
  diamond:       { name: '菱形塔', color: '#00E5FF', cost: 220, rarity: 1 },
  pentagon:      { name: '五边塔', color: '#7CFF6B', cost: 320, rarity: 2 },
  oval:          { name: '椭圆塔', color: '#B0BEC5', cost: 260, rarity: 1 },
  star:          { name: '星形塔', color: '#FF7BAC', cost: 420, rarity: 3 },
};

// 塔的详细属性（含攻击间隔秒数）
// 注：本批新增的 4 种塔（diamond / pentagon / oval / star）走 game_core 的"普通塔单体攻击"
//     通用分支，因此必须提供 attackInterval，否则 attackTimer 会变成 NaN → 每帧开火。
const TOWER_STATS = {
  triangle:      { hp: 100, damage: 20, range: 200, attackSpeedMultiplier: 100, attackInterval: 0.5, isSupport: false, description: '快速射击，对单个目标造成持续伤害。适合应对大量敌人。' },
  circle:        { hp: 150, damage: 25, range: 200, attackSpeedMultiplier: 100, attackInterval: 0.8, isSupport: false, description: '攻击命中时触发二次爆炸，对周围敌人造成25%溅射伤害。适合对付聚集的敌人。' },
  hexagon:       { hp: 200, damage: 50, range: 200, attackSpeedMultiplier: 100, attackInterval: 1.2, isSupport: false, description: '强力狙击射击，对单一目标造成高额伤害。对精英及以上等级怪物特攻，伤害翻倍。' },
  square:        { hp: 220, damage: 30, range: 200, attackSpeedMultiplier: 100, attackInterval: 1.5, isSupport: false, description: '旋转冲锋攻击，直线穿透多个敌人。均衡的单体输出，适合应对各类敌人。' },
  trapezoid:     { hp: 230, damage: 0, range: 150, attackSpeedMultiplier: 0, isSupport: true, supportBuff: { attackSpeedMultiplier: 25 }, description: '辅助塔，不提供攻击。给周围我方图形塔增加25%攻击速度光环；自身每进阶一星光环强度+100%，高阶光环覆盖低阶光环。' },
  semicircle:    { hp: 130, damage: 2, range: 200, attackSpeedMultiplier: 100, attackInterval: 0.15, isSupport: false, description: '持续激光连接目标，对连接的敌人造成持续伤害。适合对付高血量单体目标。' },
  sector:        { hp: 180, damage: 25, range: 250, attackSpeedMultiplier: 100, attackInterval: 3.0, isSupport: false, description: '扇形范围攻击，AOE伤害覆盖大面积区域。适合对付密集敌人群。' },
  long_rectangle:{ hp: 250, damage: 2, range: 200, attackSpeedMultiplier: 100, attackInterval: 0.25, isSupport: false, description: '堆叠火炮系统，对重复单位攻击时叠加伤害，累积层数后造成巨额爆发。适合对付BOSS级别敌人。' },
  diamond:       { hp: 170, damage: 38, range: 210, attackSpeedMultiplier: 100, attackInterval: 1.0, isSupport: false, description: '锐击穿刺，单发伤害高且射程略长。均衡的切入型输出塔，前期性价比优秀。' },
  pentagon:      { hp: 260, damage: 62, range: 200, attackSpeedMultiplier: 100, attackInterval: 1.4, isSupport: false, description: '稳重的重击塔，血厚攻高，节奏偏慢。适合站在前排槽位承担主力输出。' },
  oval:          { hp: 140, damage: 12, range: 260, attackSpeedMultiplier: 100, attackInterval: 0.4, isSupport: false, description: '超远射程的快射塔，单发伤害低但覆盖全图大部分路径。适合补刀漏网之鱼。' },
  star:          { hp: 300, damage: 96, range: 240, attackSpeedMultiplier: 100, attackInterval: 2.0, isSupport: false, description: '六芒重炮，全塔最高单发伤害，换弹极慢。配合攻速光环可碾压精英与BOSS。' },
};

// 默认已解锁 + 默认登场池的 5 种塔（玩家开局的起点阵容）
// 图签里其余 7 种需要消耗"特殊积分"解锁后才能进入登场池。
const SHOP_TOWERS = ['triangle', 'circle', 'hexagon', 'square', 'semicircle'];

// 全部塔类型顺序（图签网格 / 商店抽池 都按此稳定顺序，避免随机排序导致 UI 跳动）
const TOWER_ORDER = Object.keys(TOWER_DEFS);

// 敌人类型表
// elite/boss/finalBoss 的 hp 是相对普通怪基础 HP(100) 的倍率
// elite = 15倍, boss = 50倍, finalBoss = boss的5倍 = 250倍
// rewardPerWave: 击杀奖励随波次增长的额外金币（每波 +N），未配置则为固定奖励
const ENEMY_TYPES = {
  normal:    { hp: 100,      speed: 6.0, color: '#808080', tier: 0, reward: 10,  rewardPerWave: 1, size: 16 },
  fast:      { hp: 100,      speed: 10.0, color: '#FF8C00', tier: 1, reward: 15,  rewardPerWave: 1, size: 14 },
  heavy:     { hp: 500,      speed: 4.0, color: '#555555', tier: 2, reward: 50,  rewardPerWave: 3, size: 20 },
  elite:     { hp: 1500,     speed: 6.0, color: '#FFD700', tier: 3, reward: 500,  size: 22 },
  boss:      { hp: 5000,     speed: 5.0, color: '#FF0000', tier: 4, reward: 1000, size: 28 },
  finalBoss: { hp: 25000,    speed: 3.0, color: '#9900FF', tier: 5, reward: 5000, size: 36 },
};

// 布局参数
const LAYOUT = {
  // 地图槽位（12 个，3 行 4 列）
  slotSize: 36,
  slotGap: 8,
  slotCols: 4,
  slotRows: 3,
  // 顶部状态栏 / 底部导航栏高度（底部导航贴屏幕最底，商店面板叠在它上面）
  topBarHeight: 34,
  navHeight: 58,
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
  waitDuration: 6, // 波间歇倒计时：给动态标题（5→4→3→2→1→进攻开始）留 6 秒舞台
  totalWaves: 20,
  // 加速怪（fast）随机刷新：每只普通怪刷新时按此概率变为加速怪；每波加速怪总数（含计划特殊怪）不超过上限
  fastChance: 0.1,
  maxFastPerWave: 3,
};

// ========== 阶段（进阶）系统 ==========
// 进阶最高 3 星封顶；各阶段攻击增幅奖励：1星 +100%，2星 +200%，3星 +400%
const MAX_STAGE = 3;
const STAGE_BOOSTS = { 1: 100, 2: 200, 3: 400 };

// 光环持续时间（秒）：梯塔离开范围后，光环保留该时长后失效
const AURA_DURATION = 3.0;

// ============================================================================
// 特殊积分产出（图签的唯一货币）
// ----------------------------------------------------------------------------
// 积分"当场入账"到存档：每波清空 / 击杀精英及以上 / 通关关卡都给，不打折。
const POINTS = {
  perWave: 2,        // 每清空一波
  tier3: 3,          // 击杀精英(tier 3)
  tier4: 10,         // 击杀 BOSS(tier 4)
  tier5: 30,         // 击杀最终BOSS(tier 5)
  clearLevel: 50,    // 通关一个关卡
  firstClearBonus: 60, // 首次通关额外汇总奖励
};

// ============================================================================
// 图签（Codex）
// ----------------------------------------------------------------------------
// 玩法：花"特殊积分"解锁图形塔 → 解锁后才可"登场"（进入战斗商店的出货池）
//       解锁后可继续花积分升级图签等级，每级给该类型塔 +6% 攻击力（战斗中直接生效）
const CODEX = {
  maxLevel: 5,            // 图签最高等级（解锁即为 Lv.1）
  bonusPerLevel: 6,       // 每级 +6% 攻击力（Lv.1 = +6%，Lv.5 = +30%）
  upgradeCostRate: 0.6,   // 升级花费 = 解锁价 × 0.6 × 目标等级
  lineupMax: 6,           // 登场池容量上限
  // 解锁价（按稀有度）
  unlockCost: { 1: 120, 2: 220, 3: 360 },
};

// ============================================================================
// 天赋（Talents）
// ----------------------------------------------------------------------------
// 玩法：花"天赋点"逐级学习，影响玩家侧的各种功能（经济 / 生存 / 商店 / 图签）。
// 天赋点来源见 TALENT_POINTS。
const TALENTS = [
  { id: 'gold_start',  name: '启动资金', desc: '开局金币 +60 / 级',        max: 3, costs: [1, 1, 2] },
  { id: 'gold_gain',   name: '点石成金', desc: '击杀金币收益 +8% / 级',    max: 5, costs: [1, 1, 2, 2, 3] },
  { id: 'points_gain', name: '洞察先机', desc: '特殊积分获取 +25% / 级',   max: 3, costs: [1, 2, 3] },
  { id: 'lives_max',   name: '坚固防线', desc: '生存积分上限 +20 / 级',    max: 3, costs: [1, 2, 3] },
  { id: 'build_cost',  name: '精打细算', desc: '图形塔造价 -5% / 级',      max: 4, costs: [1, 1, 2, 2] },
  { id: 'codex_ease',  name: '图鉴学',   desc: '图签解锁/升级花费 -8% / 级', max: 3, costs: [2, 2, 3] },
];

// 天赋点产出
const TALENT_POINTS = {
  perWaveGroup: { every: 5, amount: 1 }, // 每通过 5 波 +1
  clearLevel: 3,                          // 通关一个关卡 +3
  bossKill: 1,                            // 击杀 BOSS / 最终BOSS +1
};

// 天赋数值口径（供 game_core / shop / codex 统一取值，避免各处硬编码）
const TALENT_EFFECT = {
  gold_start:  { perLevel: 60 },   // 绝对值
  gold_gain:   { perLevel: 8 },    // 百分比
  points_gain: { perLevel: 25 },   // 百分比
  lives_max:   { perLevel: 20 },   // 绝对值
  build_cost:  { perLevel: 5 },    // 百分比（减）
  codex_ease:  { perLevel: 8 },    // 百分比（减）
};

// ============================================================================
// 关卡（Levels）
// ----------------------------------------------------------------------------
// 目前只做"关卡 1"（默认关卡 = 正在进行的那一关），其余占位待扩展。
const LEVELS = [
  { id: 1, name: '关卡 1', subtitle: '边境哨站', waves: 20, playable: true,  desc: '标准 20 波教学关卡，红方基地遭蓝色阵营试探性进攻。' },
  { id: 2, name: '关卡 2', subtitle: '待扩展',   waves: 0,  playable: false, desc: '新地图与新的敌方阵容，开发中。' },
  { id: 3, name: '关卡 3', subtitle: '待扩展',   waves: 0,  playable: false, desc: '开发中。' },
  { id: 4, name: '关卡 4', subtitle: '待扩展',   waves: 0,  playable: false, desc: '开发中。' },
  { id: 5, name: '关卡 5', subtitle: '待扩展',   waves: 0,  playable: false, desc: '开发中。' },
  { id: 6, name: '关卡 6', subtitle: '待扩展',   waves: 0,  playable: false, desc: '开发中。' },
];

// ============================================================================
// 商店（Shop）
// ----------------------------------------------------------------------------
// 商店面板的全部尺寸在这里定义：game_core（算战场可用高度）、shop.js（画卡）、
// input.js（命中判定）三处共用同一份数字，避免"抽 3 个画 4 个"或"面板压住路径"。
const SHOP = {
  cardCount: 3,      // 货架卡片数
  cardH: 74,         // 卡片高
  cardMaxW: 108,     // 卡片最大宽（宽屏时不让卡片摊成大方块）
  gap: 8,            // 卡片间距
  padX: 12,          // 面板左右内边距
  padTop: 6,
  padBottom: 8,
  headerH: 26,       // 标题栏高
  radius: 12,
  refreshW: 68,
  refreshH: 22,
  pointsChipW: 78,
  pointsChipH: 20,
  clickShrinkPx: 5,  // 刷新按钮视觉与判定区宽度差（保持原版手感）
};

// 面板总高（派生值，别手改）：战场布局要靠它算出"底部被占掉多少"
SHOP.panelHeight = SHOP.padTop + SHOP.headerH + SHOP.cardH + SHOP.padBottom;

module.exports = {
  TOWER_DEFS,
  TOWER_STATS,
  TOWER_ORDER,
  SHOP_TOWERS,
  SHOP,
  RARITY,
  ENEMY_TYPES,
  LAYOUT,
  BALANCE,
  PLAYER,
  HOSTILE_RELATIONS,
  ATTACK_SPEED_BASE,
  MAX_STAGE,
  STAGE_BOOSTS,
  AURA_DURATION,
  POINTS,
  CODEX,
  TALENTS,
  TALENT_POINTS,
  TALENT_EFFECT,
  LEVELS,
};
