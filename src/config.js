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

// ========== 全部塔定义（16 种）==========
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
  // ---- 第二批扩展图形（图签容量提升到 16 格）----
  octagon:       { name: '八边塔', color: '#00BFA5', cost: 240, rarity: 2 },
  cross:         { name: '十字塔', color: '#F50057', cost: 210, rarity: 1 },
  arrow:         { name: '箭形塔', color: '#FFA000', cost: 280, rarity: 2 },
  bolt:          { name: '闪电塔', color: '#D500F9', cost: 380, rarity: 3 },
};

// 塔的详细属性（含攻击间隔秒数）
// 注：本批新增的 4 种塔（diamond / pentagon / oval / star）走 game_core 的"普通塔单体攻击"
//     通用分支，因此必须提供 attackInterval，否则 attackTimer 会变成 NaN → 每帧开火。
//
// 战斗三属性口径（2026-09 二次修订，务必别改错）：
//   critChance  暴击率(%)    —— 【原生值默认 0】。唯一例外是"特殊效果本身就是暴击"的三角塔（5%）。
//                               其余塔的暴击只能来自「强化」——每塔的专属特殊属性之一是暴击几率时
//                               （星形塔 / 闪电塔）才堆得起来（见 ENHANCE_SPECIAL）。
//   penetration 穿透       —— 【原生值默认 0】。只有把穿透定为专属特殊属性的塔
//                               （半圆塔 / 菱形塔 / 箭形塔）才能靠强化抵消敌人抗性。
//   critMult    暴击倍率     —— 保留为塔的"上限特征"（如闪电塔 2.0、星形塔 2.0）。
//                               暴击率为 0 时它不参与结算，等强化出暴击率后才会兑现。
//   注：敌人抗性减伤见 BALANCE.armorK 的递减公式；穿透为 0 时按"无抵扣"结算。
//
// 四条"专属特殊属性"的来源字段（由 ENHANCE_SPECIAL 逐级抬高，见该表）：
//   eliteMult        精英伤害倍率 —— 六边塔：对 tier>=3（精英/BOSS/最终BOSS）的伤害倍数
//   projectileScale  弹道体积(%)   —— 正方塔：冲锋弹道的缩放百分比（100 = 原始体积）
//   sectorHalfAngle  扇面半张角(°) —— 扇塔：扇形张角的一半（45 = 上下各 45°，共 90°）
//   stackMax         堆叠上限(层) —— 长方塔：同一目标可累积的最大堆叠层数
const TOWER_STATS = {
  // 三角塔：特殊效果 = 暴击 → 唯一持有原生暴击几率的塔（5%），仍无穿透
  triangle:      { hp: 100, damage: 20, range: 200, attackSpeedMultiplier: 100, attackInterval: 0.5, critChance: 5,  critMult: 1.6, penetration: 0,  isSupport: false, description: '快速射击，对单个目标造成持续伤害。专属特殊属性：暴击几率（默认 5%，每次强化 +5%，满级 30%）。' },
  circle:        { hp: 150, damage: 25, range: 200, attackSpeedMultiplier: 100, attackInterval: 0.8, critChance: 0,  critMult: 1.5, penetration: 0,  isSupport: false, explosionRadius: 60, explosionRatio: 25, description: '攻击命中时触发二次爆炸，对周围敌人造成 25% 溅射伤害。专属特殊属性：二段爆炸伤害比例（默认 25%，每次强化 +5%）。适合对付聚集的敌人。' },
  hexagon:       { hp: 200, damage: 50, range: 200, attackSpeedMultiplier: 100, attackInterval: 1.2, critChance: 0,  critMult: 1.8, penetration: 0,  isSupport: false, eliteMult: 5, description: '强力狙击射击，对单一目标造成高额伤害。专属特殊属性：精英伤害倍率（默认对精英及以上 ×5，每次强化 +1 倍，满级 ×10）。' },
  square:        { hp: 220, damage: 30, range: 200, attackSpeedMultiplier: 100, attackInterval: 1.5, critChance: 0,  critMult: 1.5, penetration: 0,  isSupport: false, projectileScale: 100, description: '旋转冲锋攻击，弹道可贯穿直线上的敌人。专属特殊属性：弹道体积（默认 100%，每次强化 +20%，命中范围同步放大）。' },
  trapezoid:     { hp: 230, damage: 0,  range: 150, attackSpeedMultiplier: 0,   critChance: 0,  critMult: 1,   penetration: 0,  isSupport: true,  supportBuff: { attackSpeedMultiplier: 25 }, description: '辅助塔，不提供攻击。给周围我方图形塔增加 25% 攻击速度光环；自身每进阶一星光环强度 +100%，高阶光环覆盖低阶光环。专属特殊属性：光环强度（默认 25%，每次强化 +5%）。' },
  semicircle:    { hp: 130, damage: 2,  range: 200, attackSpeedMultiplier: 100, attackInterval: 0.15, critChance: 0,  critMult: 1.5, penetration: 0,  isSupport: false, description: '持续激光连接目标，对连接的敌人造成持续伤害。专属特殊属性：激光穿透（每次强化 +5，直接抵扣敌人抗性）。' },
  sector:        { hp: 180, damage: 25, range: 250, attackSpeedMultiplier: 100, attackInterval: 3.0, critChance: 0,  critMult: 1.5, penetration: 0, isSupport: false, sectorHalfAngle: 45, description: '扇形范围攻击，AOE 伤害覆盖大面积区域。专属特殊属性：扇面张角（默认上下各 45°，每次强化 +5°，扫过更宽的一片）。' },
  long_rectangle:{ hp: 250, damage: 2,  range: 200, attackSpeedMultiplier: 100, attackInterval: 0.25, critChance: 0, critMult: 1.7, penetration: 0, isSupport: false, stackMax: 10, description: '堆叠火炮系统，对重复单位攻击时叠加伤害，累积层数后造成巨额爆发。专属特殊属性：堆叠上限（默认 10 层，每次强化 +2 层）。适合对付 BOSS 级别敌人。' },
  diamond:       { hp: 170, damage: 38, range: 210, attackSpeedMultiplier: 100, attackInterval: 1.0, critChance: 0, critMult: 1.6, penetration: 0, isSupport: false, description: '锐击穿刺，单发伤害高且射程略长。专属特殊属性：攻击速度（默认 100%，每次强化 +7%）。性价比优秀的前期切入塔。' },
  pentagon:      { hp: 260, damage: 62, range: 200, attackSpeedMultiplier: 100, attackInterval: 1.4, critChance: 0, critMult: 1.7, penetration: 0, isSupport: false, description: '稳重的重击塔，血厚攻高，节奏偏慢。专属特殊属性：生命（默认 260，每次强化 +45）。适合站在前排槽位承担主力输出。' },
  oval:          { hp: 140, damage: 12, range: 260, attackSpeedMultiplier: 100, attackInterval: 0.4, critChance: 0,  critMult: 1.5, penetration: 0,  isSupport: false, description: '超远射程的快射塔，单发伤害低但覆盖全图大部分路径。专属特殊属性：射程（默认 260，每次强化 +15）。适合补刀漏网之鱼。' },
  star:          { hp: 300, damage: 96, range: 240, attackSpeedMultiplier: 100, attackInterval: 2.0, critChance: 0, critMult: 2.0, penetration: 0, isSupport: false, description: '六芒重炮，全塔最高单发伤害，换弹极慢。专属特殊属性：暴击几率（默认 0%，每次强化 +6%）——配上 200% 暴击倍率上限惊人。' },
  octagon:       { hp: 210, damage: 44, range: 205, attackSpeedMultiplier: 100, attackInterval: 1.1, critChance: 0,  critMult: 1.6, penetration: 0, isSupport: false, description: '八面均衡的中坚塔，攻防兼顾没有短板。专属特殊属性：生命（默认 210，每次强化 +40），适合填满中段槽位。' },
  cross:         { hp: 160, damage: 34, range: 190, attackSpeedMultiplier: 100, attackInterval: 0.9, critChance: 0, critMult: 1.5, penetration: 0, isSupport: false, description: '十字速射塔，射速快、射程偏短。专属特殊属性：攻击速度（默认 100%，每次强化 +8%）。适合贴身补伤。' },
  arrow:         { hp: 150, damage: 46, range: 240, attackSpeedMultiplier: 100, attackInterval: 1.2, critChance: 0, critMult: 1.7, penetration: 0, isSupport: false, description: '箭形狙击塔，射程远、单发高。专属特殊属性：穿透（默认 0，每次强化 +7），专克高抗性单位。' },
  bolt:          { hp: 170, damage: 70, range: 220, attackSpeedMultiplier: 100, attackInterval: 1.5, critChance: 0, critMult: 2.0, penetration: 0, isSupport: false, description: '闪电炮塔，暴击倍率全塔最高（200%），原生暴击几率为 0。专属特殊属性：暴击几率（每次强化 +4%），堆起来后上限惊人。' },
};

// ============================================================================
// 强化（升级）专属特殊属性表 —— 每种图形塔一项，**不再给伤害加成**
// ----------------------------------------------------------------------------
// 2026-09 二次重做。上一版是「固定攻击力点数 + 从 2 项里多选一」，现在改成：
//   每次强化只把该塔的**招牌特殊属性**往上推，不发放任何攻击力。
//   等级 L（0 ~ BALANCE.enhance.maxLevel）的取值：
//
//      当前值(L) = base + per × L
//
//   · base = 该属性"默认"（未强化）时的取值，也就是需求里的「默认 1 级」
//            —— 必须与 TOWER_STATS 里的原生值严格一致（引擎按"原生 + per×L"结算，
//               这里只是同口径的展示真源，verify.js 会逐塔断言两者相等）。
//   · per  = 每强化一级的增量，也就是需求里的「后续每次升级 +X」。
//
// 例：
//   三角塔 base=5 per=5  → 默认 5% 暴击，每级 +5%，Lv.5 = 30%
//   圆塔   base=25 per=5 → 默认 25% 溅射，每级 +5%，Lv.5 = 50%
//   六边塔 base=5 per=1  → 默认 ×5（精英），每级 +1 倍，Lv.5 = ×10
//   方块塔 base=0 per=20 → 默认无加成，每级 +20%，Lv.5 = +100%
//
// 字段：
//   key  —— 属性键，与 tower.js 运行时口径 / bonusStats.ATTR 同名
//   name —— 浮层与属性面板里显示的名字
//   unit —— 展示单位（'' / '%' / '倍' / '°' / '层'）
//   desc —— 浮层里的一句话说明
//   玩家不再二选一：每塔的属性与增量由本表唯一决定。
// ============================================================================
const ENHANCE_SPECIAL = {
  // ---- 首批 5 种（开局阵容）----
  triangle:       { key: 'critChance',            name: '暴击几率',     base: 5,   per: 5,  unit: '%',  desc: '命中时触发暴击的概率' },
  circle:         { key: 'explosionDamage',       name: '二段爆炸伤害', base: 25,  per: 5,  unit: '%',  desc: '二次爆炸的溅射伤害占主伤害的比例' },
  hexagon:        { key: 'eliteMult',             name: '精英伤害倍率', base: 5,   per: 1,  unit: '倍', desc: '对精英及以上（含 BOSS）的伤害倍数' },
  square:         { key: 'projectileScale',       name: '弹道体积',     base: 100, per: 20, unit: '%',  desc: '放大冲锋弹道，命中范围（相对伤害范围）同步变大' },
  semicircle:     { key: 'penetration',           name: '激光穿透',     base: 0,   per: 5,  unit: '',   desc: '直接抵扣敌人抗性，激光不再被高抗性吃伤害' },
  // ---- 进阶图形 ----
  trapezoid:      { key: 'auraPower',             name: '光环强度',     base: 25,  per: 5,  unit: '%',  desc: '给周围我方塔的攻速光环再抬高一点' },
  sector:         { key: 'sectorAngle',           name: '扇面张角',     base: 45,  per: 5,  unit: '°',  desc: '扇形半张角，越大扫过的面越宽' },
  long_rectangle: { key: 'stackMax',              name: '堆叠上限',     base: 10,  per: 2,  unit: '层', desc: '同一目标可累积的最大堆叠层数' },
  diamond:        { key: 'attackSpeedMultiplier', name: '攻击速度',     base: 100, per: 7,  unit: '%',  desc: '出手更快，穿刺弹道更密' },
  pentagon:       { key: 'hp',                    name: '生命',         base: 260, per: 45, unit: '',   desc: '本体更耐打，敢站前排' },
  oval:           { key: 'range',                 name: '射程',         base: 260, per: 15, unit: '',   desc: '覆盖更长的路径' },
  star:           { key: 'critChance',            name: '暴击几率',     base: 0,   per: 6,  unit: '%',  desc: '命中时触发暴击的概率（配上 200% 暴击倍率）' },
  octagon:        { key: 'hp',                    name: '生命',         base: 210, per: 40, unit: '',   desc: '本体更耐打' },
  cross:          { key: 'attackSpeedMultiplier', name: '攻击速度',     base: 100, per: 8,  unit: '%',  desc: '贴身速射更凶' },
  arrow:          { key: 'penetration',           name: '穿透',         base: 0,   per: 7,  unit: '',   desc: '直接抵扣敌人抗性' },
  bolt:           { key: 'critChance',            name: '暴击几率',     base: 0,   per: 4,  unit: '%',  desc: '命中时触发暴击的概率（暴击倍率全塔最高）' },
};

// 默认已解锁 + 默认登场池的 5 种塔（玩家开局的起点阵容）// 图签里其余 7 种需要消耗"特殊积分"解锁后才能进入登场池。
const SHOP_TOWERS = ['triangle', 'circle', 'hexagon', 'square', 'semicircle'];

// 全部塔类型顺序（图签网格 / 商店抽池 都按此稳定顺序，避免随机排序导致 UI 跳动）
const TOWER_ORDER = Object.keys(TOWER_DEFS);

// 敌人类型表
// elite/boss/finalBoss 的 hp 是相对普通怪基础 HP(100) 的倍率
// elite = 15倍, boss = 50倍, finalBoss = boss的5倍 = 250倍
// rewardPerWave: 击杀奖励随波次增长的额外金币（每波 +N），未配置则为固定奖励
// armor: 抗性值 —— 有效抗性 = max(0, armor - 塔的穿透)，减伤 = 有效抗性/(有效抗性+BALANCE.armorK)
const ENEMY_TYPES = {
  normal:    { hp: 100,      speed: 6.0,  color: '#808080', tier: 0, reward: 10,   rewardPerWave: 1, size: 16, armor: 0 },
  fast:      { hp: 100,      speed: 10.0, color: '#FF8C00', tier: 1, reward: 15,   rewardPerWave: 1, size: 14, armor: 0 },
  heavy:     { hp: 500,      speed: 4.0,  color: '#555555', tier: 2, reward: 50,   rewardPerWave: 3, size: 20, armor: 45 },
  elite:     { hp: 1500,     speed: 6.0,  color: '#FFD700', tier: 3, reward: 500,  size: 22, armor: 90 },
  boss:      { hp: 5000,     speed: 5.0,  color: '#FF0000', tier: 4, reward: 1000, size: 28, armor: 150 },
  finalBoss: { hp: 25000,    speed: 3.0,  color: '#9900FF', tier: 5, reward: 5000, size: 36, armor: 240 },
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

  // ---- 战斗结算口径（暴击 / 抗性穿透 / 强化）----
  critDamageDefaultMult: 1.5, // 塔未显式配置 critMult 时的兜底暴击倍率
  // 抗性减伤公式（2026-09 定稿）：
  //   有效抗性 = max(0, 敌人抗性 - 塔的穿透)
  //   减伤比例 = 有效抗性 / (有效抗性 + armorK)
  //   实际伤害 = 造成伤害 × (1 - 减伤比例)
  // 递减曲线：抗性越高收益越低，永远不会免疫（抗性 200 时正好减伤 50%）
  armorK: 200,
  // ==========================================================================
  // 塔强化（2026-09 二次重做）
  // --------------------------------------------------------------------------
  // 玩法：塔属性面板点「强化」→ 浮层确认 → 花金币把该塔的【专属特殊属性】抬一级。
  //   · **不再发放任何攻击力加成**（旧版的"固定攻击力点数"已移除）
  //   · 每塔只有一项特殊属性，逐级累加（取值 = base + per × 等级，见 ENHANCE_SPECIAL）
  //   · 攻击力的成长仍由「合成进阶（等级/阶段）」与「图签」负责，两条线互不重叠
  // 门槛：只有进阶到 minStage（3★封顶）的图形塔才能强化。
  // ==========================================================================
  enhance: {
    maxLevel: 5,      // 最高强化等级（可购买次数）
    minStage: 3,      // 需要进阶到几星才能强化（MAX_STAGE = 3★）
    costRate: 0.9,    // 升到 L 级的造价 = 塔基础造价 × costRate × L（越强化越贵）
  },
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
//
// 2026-09 重做：每级数值下调、可学习等级提高（长线成长），并补足经济类天赋：
//   杀敌金币 / BOSS 悬赏 / 每秒金币 / 波次结余 / 暴利风险（负收益换金币）
//
// 2026-09 平衡性二次修正（按反馈"这几项每级属性太变态"）：
//   点石成金 gold_gain   +4%/级 → +3%/级，上限 8 → 6，学习花费整体上调
//   涓流金库 gold_per_sec +0.5/级 → +0.25/级（直接砍半），上限 6 → 5
//   洞察先机 points_gain +10%/级 → +5%/级（直接砍半），上限 5 → 4
//   波次结余 wave_bonus  +8/级 → +6/级，上限 6 → 5
//   BOSS悬赏 boss_bounty +12%/级 → +10%/级
// 三条"变态"项的 costs 全部上调，把"无脑点它就是最优解"改成"要攒天赋点才点得起"。
const TALENTS = [
  { id: 'gold_start',  name: '启动资金', desc: '开局金币 +30 / 级',              max: 6, costs: [1, 1, 1, 2, 2, 3] },
  { id: 'gold_gain',   name: '点石成金', desc: '击杀金币收益 +3% / 级',          max: 6, costs: [2, 2, 3, 3, 4, 4] },
  { id: 'boss_bounty', name: 'BOSS悬赏', desc: '精英/BOSS 击杀金币 +10% / 级',   max: 5, costs: [2, 2, 3, 3, 4] },
  { id: 'gold_per_sec',name: '涓流金库', desc: '每秒自动获得金币 +0.25 / 级',     max: 5, costs: [2, 3, 3, 4, 4] },
  { id: 'wave_bonus',  name: '波次结余', desc: '每清空一波额外金币 +6 / 级',      max: 5, costs: [2, 2, 3, 3, 4] },
  { id: 'points_gain', name: '洞察先机', desc: '特殊积分获取 +5% / 级',          max: 4, costs: [3, 3, 4, 4] },
  { id: 'lives_max',   name: '坚固防线', desc: '生存积分上限 +10 / 级',          max: 5, costs: [1, 2, 2, 3, 3] },
  { id: 'build_cost',  name: '精打细算', desc: '图形塔造价 -3% / 级',            max: 5, costs: [1, 1, 2, 2, 3] },
  { id: 'codex_ease',  name: '图鉴学',   desc: '图签解锁/升级花费 -5% / 级',      max: 4, costs: [2, 2, 3, 3] },
  { id: 'high_stakes', name: '暴利风险', desc: '生存积分 -10%/级，击杀金币 +15%/级', max: 4, costs: [1, 2, 3, 3] },
];

// 天赋点产出
const TALENT_POINTS = {
  perWaveGroup: { every: 4, amount: 1 }, // 每通过 4 波 +1
  clearLevel: 5,                          // 通关一个关卡 +5
  bossKill: 2,                            // 击杀 BOSS / 最终BOSS +2
};

// 天赋数值口径（供 game_core / shop / codex 统一取值，避免各处硬编码）
// 只有 high_stakes 是"双向"天赋：perLevel 作用于生存积分（负向），goldPerLevel 作用于击杀金币（正向）
const TALENT_EFFECT = {
  gold_start:   { perLevel: 30 },   // 绝对值
  gold_gain:    { perLevel: 3 },    // 百分比
  boss_bounty:  { perLevel: 10 },   // 百分比
  gold_per_sec: { perLevel: 0.25 }, // 绝对值（每秒）
  wave_bonus:   { perLevel: 6 },    // 绝对值
  points_gain:  { perLevel: 5 },    // 百分比
  lives_max:    { perLevel: 10 },   // 绝对值
  build_cost:   { perLevel: 3 },    // 百分比（减）
  codex_ease:   { perLevel: 5 },    // 百分比（减）
  high_stakes:  { perLevel: 10, goldPerLevel: 15, twoWay: true },
};

// ============================================================================
// 关卡（Levels）
// ----------------------------------------------------------------------------
// 2026-09（本次扩展）：天梯铺到【关卡 10】全部可玩，关卡 11~99 仍是占位。
// 每关 20 波，关卡编号越高 = 敌人抗性越高（关卡 2 起，每波抗性 = (关卡-1) × 波次）。
// 战前选关的天梯会自动滚动（内容高于视口就上下拖动，见 src/levels.js），
// 默认贴底停在关卡 1。
// ============================================================================
const LEVELS = (() => {
  const MAX_LEVEL = 99;
  const PLAYABLE_LEVELS = 10;  // 1~10 可玩
  const levelSubtitles = [
    '边境哨站',
    '前哨阵地',
    '峡谷要塞',
    '废弃兵工厂',
    '雪原前哨',
    '古代遗迹',
    '熔岩裂谷',
    '星际中转站',
    '虚空裂隙',
    '决战之巅',
  ];
  const levelDescs = [
    '标准 20 波教学关卡，红方基地遭蓝色阵营试探性进攻。',
    '敌人开始学会集结推进，低抗性下考验你的基础输出。',
    '峡谷地形逼敌人走单一路线，合理布置射程就能打穿。',
    '废弃兵工厂中敌人的装甲部队登场，穿透塔第一次派上用场。',
    '雪原天寒地冻，但敌人攻势不减，稳定的清线能力是关键。',
    '古代遗迹里封印着更强的敌人，BOSS 波开始变得棘手。',
    '熔岩裂谷让坦克变得更肉，考虑给主力塔堆强化。',
    '星际中转站里的敌人拥有高科技护甲，穿透是硬通货。',
    '虚空裂隙中敌人从多方向涌来，需要全方位布防。',
    '最终决战——最高抗性 + 最强波次配置，图形塔防的终极考验。',
  ];
  const list = [];
  for (let i = 1; i <= MAX_LEVEL; i++) {
    if (i <= PLAYABLE_LEVELS) {
      list.push({
        id: i,
        name: '关卡 ' + i,
        subtitle: levelSubtitles[i - 1],
        waves: 20,
        playable: true,
        desc: levelDescs[i - 1],
      });
    } else {
      list.push({
        id: i,
        name: '关卡 ' + i,
        subtitle: '待扩展',
        waves: 0,
        playable: false,
        desc: '开发中。',
      });
    }
  }
  return list;
})();

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
  ENHANCE_SPECIAL,
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
