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
  // 菱形塔 2026-09 改为辅助塔：辅助语义（isSupport / auraPenetration）登记在 TOWER_STATS，
  // 本表只保留"展示 + 图签价"这四个字段 —— 缺 color 会让 drawTowerIcon → addColorStop
  // 收到 undefined 而每帧抛 SyntaxError（图签一解锁就炸），缺 name 会画出"undefined"。
  diamond:       { name: '菱形塔', color: '#00E5FF', cost: 220, rarity: 1 },
  pentagon:      { name: '五边塔', color: '#7CFF6B', cost: 320, rarity: 2 },
  oval:          { name: '椭圆塔', color: '#B0BEC5', cost: 260, rarity: 1 },
  star:          { name: '星形塔', color: '#FF7BAC', cost: 420, rarity: 3 },
  // ---- 第二批扩展图形（图签容量提升到 16 格）----
  octagon:       { name: '八边塔', color: '#00BFA5', cost: 240, rarity: 2 },
  cross:         { name: '十字塔', color: '#F50057', cost: 210, rarity: 1 },
  arrow:         { name: '箭形塔', color: '#FFA000', cost: 280, rarity: 2 },
  bolt:          { name: '闪电塔', color: '#D500F9', cost: 380, rarity: 3 },
  // ---- 第三批扩展：固有技能「连续射击」平行塔（双横轮廓）----
  // 注：内部键用 parallel（形状名，与 triangle / circle / … 同构）；
  //     历史上曾叫 graphic —— 那个名字与"图形塔"这个塔族统称撞车，2026-09 改名。
  //     旧存档的键搬迁见 meta.js 的 TYPE_ALIAS。
  parallel:      { name: '平行塔', color: '#00FF7F', cost: 450, rarity: 3 },
};

// 塔的详细属性（含攻击间隔秒数）
// 注：本批新增的 4 种塔（diamond / pentagon / oval / star）走 game_core 的"普通塔单体攻击"
//     通用分支，因此必须提供 attackInterval，否则 attackTimer 会变成 NaN → 每帧开火。
//
// 战斗三属性口径（2026-09 三次修订，务必别改错）：
//   critChance  暴击率(%)    —— **原生值默认 0，但每座"自带暴击技能"的塔都必须给非零原生值**
//                               （三角塔 5% / 星形塔 5% / 闪电塔 5%）。固有技能的定义是
//                               "塔一放下就生效（Lv.1）"，base=0 会让技能在 Lv.1 完全空转。
//                               技能的 base 必须与本表同值（见 src/skills.js 的 SKILLS 表）。
//   penetration 穿透       —— 同理不给 0 起点：半圆塔原生 3 点穿透。
//                               （菱形塔走的是"穿透光环"，原生值登记在 auraPenetration 上）
//   critMult    暴击倍率     —— 保留为塔的"上限特征"（如闪电塔 2.0、星形塔 2.0）。
//                               暴击率高的时候它才值钱，所以配高倍率的塔都给一点起步暴击率。
//                               三角塔的固有技能另有"暴击伤害 +N%"（直接加到这个倍率上）。
//   注：敌人抗性减伤见 BALANCE.armorK 的递减公式；穿透为 0 时按"无抵扣"结算。
//   注：技能等级范围 Lv.1~Lv.6（默认 1 + 最多 5 次强化），不存在 Lv.0 —— 见 src/skills.js。
//
// 本表里这四条字段是"原生值"，它们的成长由【固有技能】负责（表在 src/skills.js）：
//   eliteMult        精英伤害倍率 —— 六边塔：对 tier>=3（精英/BOSS/最终BOSS）的伤害倍数
//   projectileScale  弹道体积(%)   —— 正方塔：冲锋弹道的缩放百分比（200 = 原始体积）
//   sectorHalfAngle  扇面半张角(°) —— 扇塔：扇形张角的一半（45 = 上下各 45°，共 90°）
//   stackMax         堆叠上限(层) —— 长方塔：同一目标可累积的最大堆叠层数
//   innateStackCap   攻速叠加上限(%) —— 平行塔：固有技能「连续射击」的叠加上限
const TOWER_STATS = {
  // 三角塔：特殊效果 = 暴击 → 唯一持有原生暴击几率的塔（5%），仍无穿透。
  // critDamage = 原生「+10% 暴击伤害」：直接加到 critMult 上（2.1 + 0.1 = 2.2 倍）。
  //   这是固有技能「致命一击」第二条效果的 base（见 src/skills.js），
  //   战斗侧由 getAttackProfile 计入，别删 —— 删了面板就会显示 210% 而打出来是 220%。
  triangle:      { damage: 20, range: 200, attackSpeedMultiplier: 100, attackInterval: 0.5, critChance: 5,  critMult: 2.1, critDamage: 10, penetration: 0,  isSupport: false, description: '快速射击，对单个目标造成持续伤害。' },
  circle:        { damage: 25, range: 200, attackSpeedMultiplier: 100, attackInterval: 0.8, critChance: 0,  critMult: 2, penetration: 0,  isSupport: false, explosionRadius: 60, explosionRatio: 25, description: '攻击命中时触发二次爆炸，对周围敌人造成 25% 溅射伤害。适合对付聚集的敌人。' },
  hexagon:       { damage: 50, range: 200, attackSpeedMultiplier: 100, attackInterval: 1.2, critChance: 0,  critMult: 2, penetration: 0,  isSupport: false, eliteMult: 5, description: '强力狙击射击，对单一目标造成高额伤害。' },
  square:        { damage: 30, range: 200, attackSpeedMultiplier: 100, attackInterval: 1.5, critChance: 0,  critMult: 2, penetration: 0,  isSupport: false, projectileScale: 200, description: '攻击瞬间沿目标方向发射一道激光，对激光路径上的所有敌人造成单次伤害。弹道体积强化可延长激光射程。' },
  trapezoid:     { damage: 0,  range: 150, attackSpeedMultiplier: 0,   critChance: 0,  critMult: 1,   penetration: 0,  isSupport: true,  supportBuff: { attackSpeedMultiplier: 25 }, description: '辅助塔，不提供攻击。给周围我方图形塔增加 25% 攻击速度光环；自身每进阶一星光环强度 +100%，高阶光环覆盖低阶光环。' },
  // penetration = 原生「穿透 3」= 固有技能「激光穿透」的 base（见 src/skills.js）。
  //   别写 0 —— 那样 Lv.1 时这个技能什么都没做，与"固有技能一放下就生效"矛盾。
  semicircle:    { damage: 2,  range: 200, attackSpeedMultiplier: 100, attackInterval: 0.15, critChance: 0,  critMult: 2, penetration: 3,  isSupport: false, description: '持续激光连接目标，对连接的敌人造成持续伤害，并穿透 3 点抗性。' },
  sector:        { damage: 25, range: 250, attackSpeedMultiplier: 100, attackInterval: 3.0, critChance: 0,  critMult: 2, penetration: 0, isSupport: false, sectorHalfAngle: 45, description: '扇形范围攻击，AOE 伤害覆盖大面积区域。' },
  long_rectangle:{ damage: 2,  range: 200, attackSpeedMultiplier: 100, attackInterval: 0.25, critChance: 0, critMult: 2, penetration: 0, isSupport: false, stackMax: 10, description: '堆叠火炮系统，对重复单位攻击时叠加伤害，累积层数后造成巨额爆发。适合对付 BOSS 级别敌人。' },
  // 辅助塔：这里的 range 是**光环半径**（与梯塔同口径）。别省 —— 引擎侧
  // `stats.range || 150` 会兜底，但属性面板不会，省掉就会显示「范围 undefined」。
  // 战斗字段也照梯塔的形状补齐（damage 0 / 攻速 0 / 无攻击间隔）：
  //   本表是"结构完整"的原生表，getTowerRuntimeStats 在没有强化/宝石时会**直接返回它**，
  //   缺字段就会让 `rs.attackSpeedMultiplier + x` 算出 NaN（菱形塔曾缺这几个键）。
  //   它的进阶焦点是 auraPenetration（见 src/stage.js 的 STAGE_FOCUS）——
  //   别给它写 damage，辅助塔放大攻击力等于什么都没做。
  diamond:       { damage: 0, range: 150, attackSpeedMultiplier: 0, critChance: 0, critMult: 1, penetration: 0, isSupport: true, auraPenetration: 5, description: '辅助塔，不提供攻击。给周围我方图形塔增加 5 点穿透光环；自身每进阶一星穿透光环强度 +100%，高阶光环覆盖低阶光环。' },
  pentagon:      { damage: 62, range: 200, attackSpeedMultiplier: 100, attackInterval: 1.4, critChance: 0, critMult: 2, penetration: 0, isSupport: false, description: '稳重的重击塔，血厚攻高，节奏偏慢。适合站在前排槽位承担主力输出。' },
  oval:          { damage: 12, range: 260, attackSpeedMultiplier: 100, attackInterval: 0.4, critChance: 0,  critMult: 2, penetration: 0,  isSupport: false, description: '超远射程的快射塔，单发伤害低但覆盖全图大部分路径。适合补刀漏网之鱼。' },
  // critChance = 原生「暴击几率 5%」= 固有技能「星芒暴击」的 base（见 src/skills.js）。
  //   星形塔是"换成暴击倍率"的塔：原生倍率 2.0，先白送 5% 暴击起步，再靠技能等级堆上去。
  star:          { damage: 96, range: 240, attackSpeedMultiplier: 100, attackInterval: 2.0, critChance: 5, critMult: 2.0, penetration: 0, isSupport: false, description: '六芒重炮，全塔最高单发伤害，换弹极慢。原生暴击几率 5%、暴击倍率 200%，堆起来收益惊人。' },
  octagon:       { damage: 44, range: 205, attackSpeedMultiplier: 100, attackInterval: 1.1, critChance: 0,  critMult: 2, penetration: 0, isSupport: false, description: '八面均衡的中坚塔，攻防兼顾没有短板。适合填满中段槽位。' },
  cross:         { damage: 34, range: 190, attackSpeedMultiplier: 100, attackInterval: 0.9, critChance: 0, critMult: 2, penetration: 0, isSupport: false, description: '十字速射塔，射速快、射程偏短。适合贴身补伤。' },
  // break = 原生「破解 3 点」，就是 description 里那句"破坏目标 3 点抗性"，
  //   也是固有技能「碎甲箭」的 base（见 src/skills.js）。
  //   ⚠️ 别只写 description 不写字段 —— 字段缺失时 brk 恒为 0，等于"描述承诺的能力
  //      从未生效、技能面板还显示 0"，2026-09 就是这么漏的。
  arrow:         { damage: 46, range: 240, attackSpeedMultiplier: 100, attackInterval: 1.2, critChance: 0, critMult: 2, penetration: 0, break: 3, isSupport: false, description: '箭形狙击塔，射程远、单发高。攻击命中敌人时会给敌人挂一个碎甲的debuff，破坏目标3点抗性。' },
  // critChance = 原生「暴击几率 5%」= 固有技能「雷霆暴击」的 base（见 src/skills.js）。
  //   闪电塔的卖点是"全塔最高暴击倍率（200%）"，所以它必须有起步暴击率 ——
  //   旧版写"原生暴击几率为 0"，等于技能 Lv.1 空转，已作废。
  bolt:          { damage: 70, range: 220, attackSpeedMultiplier: 100, attackInterval: 1.5, critChance: 5, critMult: 2.0, penetration: 0, isSupport: false, description: '闪电炮塔，暴击倍率全塔最高（200%），原生暴击几率 5%。' },
  // ---- 第三批扩展：固有技能「连续射击」平行塔 ----
  // 攻击间隔 0.25s（100% 攻速）；攻击力 35。
  // 固有技能「连续射击」的实现见 game_core.updateTowers 的 parallel 分支：
  //   · 每发必定换一个不同目标下手；
  //   · 场上只剩同一个目标可打时，每次攻击叠加 innateStackStep 点攻速，
  //     上限 innateStackCap（原生 100%，可被"强化"抬高，见 src/skills.js）
  // ⚠️ 攻击间隔 / 攻速这类**有专属属性行**的数字不要写进 description ——
  //    介绍只讲机制，数值交给属性表（属性面板已有「攻击间隔 每0.25秒」一行）。
  parallel:      { damage: 35, range: 220, attackSpeedMultiplier: 100, attackInterval: 0.25, critChance: 0, critMult: 2, penetration: 0, isSupport: false, hasInnate: true, innateStackCap: 100, innateStackStep: 10, description: '固有技能「连续射击」：每发必定换一个不同的敌人下手。被逼着连续打同一个目标时，出手会越来越快。' },
};

// ============================================================================
// 【技能表已迁出】每种图形塔的固有技能（含每级抬什么、抬多少）现在住在
//   → src/skills.js 的 SKILLS 表
// ----------------------------------------------------------------------------
// 2026-09 重构：旧的 config.ENHANCE_SPECIAL 已删除。原因有两个：
//   ① 一个技能可以带多条效果（三角塔 = 暴击几率 + 暴击伤害两条效果同属「致命一击」），
//      旧的"一个属性一条记录"结构表达不了，只能靠 { skills: [...] } 打补丁，
//      而补丁一旦漏摊平就出 NaN（三角塔暴击率 NaN 的事故就是这么来的）；
//   ② 技能表与宝石 / 面板 / 图签 / 强化浮层四处的取值口径混在一起，容易"这边改了
//      那边没改"。现在全部由 src/skills.js 一个口供给。
// 本文件只保留"塔是什么"（TOWER_DEFS / TOWER_STATS）与全局数值（BALANCE 等）。
// ============================================================================

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
  critDamageDefaultMult: 2, // 塔未显式配置 critMult 时的兜底暴击倍率
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
  //   · 每塔只有一条固有技能，技能内的每条效果逐级累加
  //     （当前值 = base + per × 强化次数，表在 src/skills.js）
  //   · 攻击力的成长仍由「合成进阶（等级/阶段）」与「图签」负责，两条线互不重叠
  // 门槛：只有进阶到 minStage（3★封顶）的图形塔才能强化。
  // ==========================================================================
  enhance: {
    maxLevel: 5,      // 最多可强化次数（技能等级 = Lv.1 + 强化次数 + 宝石等级 → 满级 Lv.6）
    minStage: 3,      // 需要进阶到几星才能强化（MAX_STAGE = 3★）
    costRate: 0.9,    // 升到 L 级的造价 = 塔基础造价 × costRate × L（越强化越贵）
  },
};

// ========== 阶段（进阶）系统 ==========
// 进阶最高 3 星封顶（同类型同阶段的塔互相合成，星级 +1）。
// ⚠️ "进阶放大什么、放大多少"**不在本文件** —— 唯一真源是 src/stage.js：
//    每类属性的放大表（STAGE_TABLES）+ 每座塔的进阶焦点（STAGE_FOCUS）。
//    本文件只保留"最多几星"这一个全局上限。
//    历史坑：这里曾写死一张全局增幅表 `{1:100,2:200,3:400}`，
//    语义被当成"攻击力 +N%"，于是伤害为 0 的辅助塔进阶后 0×4 = 0 ——
//    面板显示 +400%、实战一点没变（菱形塔的穿透光环更是整条进阶线空转）。
const MAX_STAGE = 3;

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
  lineupMin: 6,           // 登场池容量下限（战斗内不可低于 6 个）
  lineupMax: 8,           // 登场池容量上限
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
//   点石成金 gold_gain   +4%/级 → +3%/级，上限 8 → 6
//   涓流金库 gold_per_sec +0.5/级 → +0.25/级（直接砍半），上限 6 → 5
//   洞察先机 points_gain +10%/级 → +5%/级（直接砍半），上限 5 → 4
//   波次结余 wave_bonus  +8/级 → +6/级，上限 6 → 5
//   BOSS悬赏 boss_bounty +12%/级 → +10%/级
//
// 2026-09-18 学习花费改版（原来的 costs 静态价格表已删除）：
//   旧方案每条天赋手写 10 个价格，改一次要背 90 个数字、还容易写歪。
//   新方案一句话：**学 Lv.N 的花费 = N × 该天赋的基础花费**（线性增长，越高级越贵）。
//     · 基础花费 = 本表里每条的 cost（= 学 Lv.1 的价钱）；
//       "表现强的天赋更贵"这层差异靠 cost 保留（点石成金 / 涓流金库 / 波次结余 = 2，其余 = 1）
//     · 没写 cost 的天赋用 TALENT_COST.default 兜底
//     · 例：cost=2 → Lv.1 花 2 / Lv.2 花 4 / … / Lv.10 花 20（学满合计 110）
//   ⚠️ 唯一真源是 meta.talentCost(id, level)——展示（talents.js）与结算（learnTalent）
//      都必须走它；任何地方都不许再自己算价，更不许再手写价格表。
const TALENT_COST = {
  default: 2,   // 天赋没显式声明 cost 时用它兜底
};

const TALENTS = [
  { id: 'gold_start',  name: '启动资金', desc: '开局金币 +20 / 级',              max: 10, cost: 1 },
  { id: 'gold_gain',   name: '点石成金', desc: '击杀金币收益 +1% / 级',          max: 10, cost: 2 },
  { id: 'boss_bounty', name: 'BOSS悬赏', desc: '精英/BOSS 击杀金币 +1% / 级',   max: 10, cost: 1 },
  { id: 'gold_per_sec',name: '涓流金库', desc: '每秒自动获得金币 +0.25 / 级',     max: 10, cost: 2 },
  { id: 'wave_bonus',  name: '波次结余', desc: '每清空一波额外金币 +6 / 级',      max: 10, cost: 2 },
  { id: 'points_gain', name: '洞察先机', desc: '特殊积分获取 +2% / 级',          max: 10, cost: 1 },
  { id: 'build_cost',  name: '精打细算', desc: '图形塔造价 -1% / 级',            max: 10, cost: 1 },
  { id: 'codex_ease',  name: '图鉴学',   desc: '图签解锁/升级花费 -1% / 级',      max: 10, cost: 1 },
  { id: 'high_stakes', name: '暴利风险', desc: '生存积分 -1%/级，击杀金币 +2%/级', max: 10, cost: 1 },
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
  gold_start:   { perLevel: 20 },   // 绝对值
  gold_gain:    { perLevel: 1 },    // 百分比
  boss_bounty:  { perLevel: 1 },   // 百分比
  gold_per_sec: { perLevel: 0.25 }, // 绝对值（每秒）
  wave_bonus:   { perLevel: 6 },    // 绝对值
  points_gain:  { perLevel: 2 },    // 百分比
  build_cost:   { perLevel: 1 },    // 百分比（减）
  codex_ease:   { perLevel: 1 },    // 百分比（减）
  high_stakes:  { perLevel: 1, goldPerLevel: 2, twoWay: true },
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

// ============================================================================
// 宝石系统（Gems）
// ----------------------------------------------------------------------------
// 玩法：
//   · 局内掉落 / 奖励的宝石先进【背包】（导航第 5 格，默认 24 格 = 8 格/行 × 3 行）
//   · 图签里每升 1 级解锁 1 个【嵌入宝石槽】（解锁即 Lv.1 → 1 个槽，Lv.5 = 5 个槽）
//   · 把背包里的宝石嵌进某个图形塔的槽里 → 宝石与【该塔的固有技能】绑定，
//     从背包消失，加成永久（跨局）作用在该塔型上
//   · 3 颗同级宝石可合成 1 颗 +1 级宝石（规则见 GEM.synth，产物法则见 gems.synthResult）
//
// 数值口径：宝石 = 【家族(加什么)】×【等级(加多少)】，两张表都在本文件：
//   GEM_FAMILIES（家族：属性键 / 基础值 / 每级增量 / 各级名字与色相）
//   GEM_LEVEL_LIGHT（等级 → 明度）
//   效果的键与 bonusStats.ATTR / ENHANCE_SPECIAL 同名字段，
//   战斗侧由 tower.js 的 getGemBonus 统一叠加（见 src/gems.js）。
//
// ⚠️ 袋口（bagSlots）之外还有 bagMaxSlots：广告解锁是"每次 +1 行（8 格）"，
//    上限 120 格。广告未开放（AD.enabled=false）时解锁按钮与「再次挑战」同款禁用。
// ============================================================================
/** 宝石最高等级（合成 +1 级，到顶为止）。GEM.maxLevel 与它同源，别在别处再写一个 5。 */
const GEM_LEVELS = 5;

const GEM = {
  maxLevel: GEM_LEVELS, // 单颗宝石最高等级（= 等级阶梯长度；合成的天花板）
  maxSlots: 5,          // 单个图形塔最多 5 个嵌入槽（与 CODEX.maxLevel 对齐：每升 1 级 +1 槽）
  slotFromLevel: 1,     // 图签 Lv.1（即解锁）就送 1 个槽
  bagCols: 8,          // 背包每行 8 格
  bagSlots: 24,         // 默认解锁 24 格（3 行）
  bagStep: 8,          // 看一次激励视频解锁 1 行（8 格）
  bagMaxSlots: 120,     // 背包上限 120 格（15 行 × 8 列）
  starterGems: [],  // 新档不再赠送宝石
  // 掉落：每清空 N 波必掉 1 颗（第 N、2N、… 波）；精英/BOSS 另按概率掉
  dropEveryWaves: 99, // 改为 99 使战斗过程不再掉落（> 最大波次 20）
  dropTierChance: null, // 精英/BOSS 不再掉落，改为通关/失败结算
  // 结算宝石奖励概率（保留字段，供日后调参）。
  // 当前 game_core.grantRewardGems 已改为【通关/失败结算必给】，故此处恒为 1。
  // 若想恢复"本次未获得"的概率性，把对应值设为 <1 即可重新开启门控。
  victoryChance: 1,  // =1 表示通关必给
  defeatChance: 1,   // =1 表示失败必给
  rewardCellCount: 9,  // 结算界面奖励格子数（固定 9）
  gemRewardMax: 0,     // 0 = 每格随机 1~关卡关联数量（currentLevel）；>0 时覆盖为固定值

  // 合成宝石规则（需求 2026-09-18，2026-09-19 调整）：
  //   · 从 minCount 颗【同级】宝石起合成；基础成功率 = minCount × perExtra%
  //     （即「每颗 +perExtra%」，2 颗 = 20% 起步，不再有 50% 保底）
  //   · 每额外多选 1 颗同级宝石再 +perExtra%（封顶 maxRate%）
  //   · 成功 → 获得所选材料范围内【随机一种】+1 级宝石（材料全同名时即该种类）
  //   · 失败 → 材料照常消耗（合成浮层上写清楚，让玩家自己权衡）
  synth: { minCount: 2, baseRate: 20, perExtra: 10, maxRate: 100 },
};

// ============================================================================
// 宝石家族 × 等级阶梯（升级体系的唯一真源）
// ----------------------------------------------------------------------------
// 一颗宝石 = 【家族】+【等级 Lv.1~5】。
//   · 家族 = 加哪条属性（6 种，见 GEM_FAMILIES）—— 决定"加什么"
//   · 等级 = 数值逐级放大 —— 决定"加多少"
//   · 效果 = base + step × (等级 − 1)，且**每一级有独立的名字与颜色**
//     （所以"等级"在背包/图签里是看得见的，不只是角落里一个数字）
//
// ⛔ 2026-09-19 修复的历史坑 —— 旧实现里"等级"是两套互相打架的东西：
//     ① 20 个并列的 kind 按 tier 分组（ruby / fire_ruby / magma_ruby …）
//     ② 实例上另存一个 lv 字段
//     gems.effectAt(kind, lv) 收下 lv 却整份返回 def.effect
//       ⇒ Lv.1 与 Lv.5 的红宝石打出一模一样的伤害（"等级"纯装饰）
//     meta.synthesizeGems 又无视材料随机滚一个 tier
//       ⇒ 3 颗 Lv.1 红宝石能合出 tier-5 的"混沌紫晶宝石"（还顺手把 lv 写成 5）
//   现在：**等级只有一个真源 = 存档里的 lv**；
//        旧 kind 走 GEM_ALIAS 折算成 {家族, 等级}，老存档不掉东西。
// ============================================================================
// attr —— 属性键（与 gems.bonusForType / bonusStats.ATTR 同名字段）
//   damagePercent        攻击力 +N%（乘算，与图签同一档绿字）
//   attackSpeedMultiplier 攻速 +N
//   critChance           暴击率 +N%
//   penetration          穿透 +N
//   skillEffectPercent   技能效果 +N%（放大固有技能每条效果的当前值）
//   skillLevels          固有技能等级 +N（"宝石与技能绑定"的落地点，走 tower.getEnhanceAttr）
// hue/sat —— 家族色相与饱和度；各级颜色 = 同色相、明度按 GEM_LEVEL_LIGHT 逐级加深。
//            颜色只用来分"家族"，"等级"由名字 + Lv 角标 + 描边亮度表达（都看得见）。
const GEM_FAMILIES = [
  { id: 'ruby',     family: '红宝石',    attr: 'damagePercent',         label: '攻击力',   unit: '%',  base: 8,  step: 8,  hue: 2,   sat: 88,
    names: ['烈焰红宝石', '炽焰红宝石', '熔岩红宝石', '永恒红宝石', '焚天红宝石'] },
  { id: 'sapphire', family: '蓝宝石',    attr: 'attackSpeedMultiplier', label: '攻速',     unit: '',   base: 10, step: 10, hue: 219, sat: 92,
    names: ['疾风蓝宝石', '迅风蓝宝石', '风暴蓝宝石', '飓风蓝宝石', '天岚蓝宝石'] },
  { id: 'emerald',  family: '翡翠宝石',  attr: 'critChance',            label: '暴击率',   unit: '%',  base: 6,  step: 6,  hue: 152, sat: 88,
    names: ['雷光翡翠宝石', '雷鸣翡翠宝石', '极光翡翠宝石', '星环翡翠宝石', '起源翡翠宝石'] },
  { id: 'topaz',    family: '黄玉宝石',  attr: 'penetration',           label: '穿透',     unit: '',   base: 6,  step: 6,  hue: 45,  sat: 90,
    names: ['破甲黄玉宝石', '裂甲黄玉宝石', '断钢黄玉宝石', '苍穹黄玉宝石', '天陨黄玉宝石'] },
  { id: 'amethyst', family: '紫晶宝石',  attr: 'skillEffectPercent',    label: '技能效果', unit: '%',  base: 16, step: 16, hue: 265, sat: 80,
    names: ['星辉紫晶宝石', '流光紫晶宝石', '深渊紫晶宝石', '虚灵紫晶宝石', '混沌紫晶宝石'] },
  { id: 'opal',     family: '猫眼宝石',  attr: 'skillLevels',           label: '固有技能', unit: ' 级', base: 1,  step: 1,  hue: 186, sat: 78,
    names: ['秘术猫眼宝石', '幻梦猫眼宝石', '窥真猫眼宝石', '虚空猫眼宝石', '永恒猫眼宝石'] },
  // ---- 新加两个家族 ----
  { id: 'ruby_crit',    family: '翡翠宝石', attr: 'critDamagePercent', label: '暴击伤害', unit: '%', base: 10, step: 10, hue: 152, sat: 88,
    names: ['裂心翡翠宝石', '碎心翡翠宝石', '灭心翡翠宝石', '渊心翡翠宝石', '绝心翡翠宝石'] },
  { id: 'topaz_break',  family: '黄玉宝石', attr: 'break',             label: '破甲',     unit: '',   base: 3,  step: 3,  hue: 45,  sat: 90,
    names: ['破甲黄玉宝石', '裂甲黄玉宝石', '断钢黄玉宝石', '苍穹黄玉宝石', '天陨黄玉宝石'] },
];

/** 等级 → 明度（%）。同族同色相，等级越高越深；最低 52% 保证在深色底上仍然看得清 */
const GEM_LEVEL_LIGHT = { 1: 80, 2: 73, 3: 66, 4: 59, 5: 52 };

const GEM_FAMILY_BY_ID = {};
for (const f of GEM_FAMILIES) GEM_FAMILY_BY_ID[f.id] = f;

/** HSL(0~360, 0~1, 0~1) → '#RRGGBB'（只给宝石等级色用；不引 theme，避免 config 反向依赖） */
function gemHex(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) { r = c; g = x; }
  else if (hp < 2) { r = x; g = c; }
  else if (hp < 3) { g = c; b = x; }
  else if (hp < 4) { g = x; b = c; }
  else if (hp < 5) { r = x; b = c; }
  else { r = c; b = x; }
  const m = l - c / 2;
  const to = (v) => Math.max(0, Math.min(255, Math.round((v + m) * 255)));
  return '#' + [to(r), to(g), to(b)].map((v) => v.toString(16).padStart(2, '0').toUpperCase()).join('');
}

/**
 * 等级夹取：[1, GEM_LEVELS]。非法 / 坏档一律回落 Lv.1（不许造出 0 级 / 负级 / 小数级宝石）。
 * ⚠️ 这是**唯一**的宝石等级夹取入口 —— 存档侧（meta）与展示/结算侧（gems）都调它，
 *    别在各自文件里再写一份 Math.min/max（两份夹取必然会在某次改上限时打架）。
 */
function clampGemLevel(v) {
  const n = Math.floor(Number(v));
  if (!isFinite(n) || n < 1) return 1;
  return Math.min(GEM_LEVELS, n);
}

/** 某家族某等级的效果数值对象，如 ruby Lv.3 → { damagePercent: 24 } */
function gemEffectAt(familyId, lv) {
  const fam = GEM_FAMILY_BY_ID[familyId];
  if (!fam) return {};
  const out = {};
  out[fam.attr] = fam.base + fam.step * (clampGemLevel(lv) - 1);
  return out;
}

/** 某家族某等级的效果文案，如 ruby Lv.3 → '攻击力 +24%' */
function gemDescAt(familyId, lv) {
  const fam = GEM_FAMILY_BY_ID[familyId];
  if (!fam) return '';
  const v = fam.base + fam.step * (clampGemLevel(lv) - 1);
  return `${fam.label} +${v}${fam.unit}`;
}

/** 某家族某等级的颜色（等级越高越深；未知家族给中性灰，绝不返回 undefined） */
function gemLevelColor(familyId, lv) {
  const fam = GEM_FAMILY_BY_ID[familyId];
  if (!fam) return '#90A4AE';
  return gemHex(fam.hue, fam.sat / 100, (GEM_LEVEL_LIGHT[clampGemLevel(lv)] || 66) / 100);
}

/** 某家族某等级的名字（等级越界的夹到两端，不返回 undefined） */
function gemLevelName(familyId, lv) {
  const fam = GEM_FAMILY_BY_ID[familyId];
  if (!fam) return String(familyId || '宝石');
  return fam.names[clampGemLevel(lv) - 1] || fam.names[0];
}

/**
 * 宝石 id 折算（**唯一入口**）：任意 kind + lv → 规范的 { id: 家族, lv: 等级 }。
 *   · 'ruby' + 3            → { id: 'ruby', lv: 3 }
 *   · 'magma_ruby' + 1      → { id: 'ruby', lv: 3 }   ← 旧档的 tier-3 宝石折算成"红宝石 Lv.3"
 *   · 'magma_ruby' + 4      → { id: 'ruby', lv: 4 }   ← 两者取高（旧档的 kind 已经表达了等级）
 * 未知 id 返回 null（调用方据此剔除坏档）。
 */
function resolveGem(kind, lv) {
  if (!kind) return null;
  const fam = GEM_FAMILY_BY_ID[kind];
  if (fam) return { id: fam.id, lv: clampGemLevel(lv) };
  const alias = GEM_ALIAS[kind];
  if (!alias) return null;
  return { id: alias.id, lv: clampGemLevel(Math.max(Number(lv) || 1, alias.lv)) };
}

/**
 * 宝石 Lv.1 视图（**由 GEM_FAMILIES 生成，不是第二份真源**）。
 * 保留 id/name/color/effect/desc 这几个老字段，让"按 kind 查表"的老代码继续能用：
 * 拿到的就是该家族 Lv.1 的名字 / 颜色 / 基础效果。
 * 要某个等级的数据，请用 gems.effectAt / gemColor / gemName（它们才吃 lv）。
 */
const GEM_KINDS = GEM_FAMILIES.map((f) => ({
  id: f.id,
  family: f.family,
  attr: f.attr,
  name: f.names[0],
  color: gemLevelColor(f.id, 1),
  effect: gemEffectAt(f.id, 1),
  desc: gemDescAt(f.id, 1),
}));

// 旧 kind → {家族, 等级}（2026-09-19 前的 20 行 tier 表；等级 = 原 tier）
// 老存档里可能存着这些 id，读档时由 resolveGem 折算，玩家不会掉宝石。
// ⚠️ 当年有 4 行是"跨家族错配"（star_amethyst 是射程、sky_topaz 是射程+暴击、
//    chaos_amethyst 是全属性、origin_emerald 是暴击+穿透），它们**只可能**来自旧版那个
//    随机滚 tier 的坏合成。折算后按各自家族的主属性生效（射程属性因此退出宝石池）。
const GEM_ALIAS = {
  // Lv.1（6 种基础掉落）
  ruby: { id: 'ruby', lv: 1 }, sapphire: { id: 'sapphire', lv: 1 }, emerald: { id: 'emerald', lv: 1 },
  topaz: { id: 'topaz', lv: 1 }, amethyst: { id: 'amethyst', lv: 1 }, opal: { id: 'opal', lv: 1 },
  // Lv.2
  fire_ruby: { id: 'ruby', lv: 2 }, gale_sapphire: { id: 'sapphire', lv: 2 }, thunder_emerald: { id: 'emerald', lv: 2 },
  armor_topaz: { id: 'topaz', lv: 2 }, star_amethyst: { id: 'amethyst', lv: 2 },
  // Lv.3
  magma_ruby: { id: 'ruby', lv: 3 }, storm_sapphire: { id: 'sapphire', lv: 3 }, aurora_emerald: { id: 'emerald', lv: 3 },
  abyss_amethyst: { id: 'amethyst', lv: 3 },
  // Lv.4
  eternal_ruby: { id: 'ruby', lv: 4 }, sky_topaz: { id: 'topaz', lv: 4 }, void_opal: { id: 'opal', lv: 4 },
  // Lv.5
  chaos_amethyst: { id: 'amethyst', lv: 5 }, origin_emerald: { id: 'emerald', lv: 5 },
};

// ---------------------------------------------------------------------------
// 合成法则（数值 + 产物，唯一真源）
// ---------------------------------------------------------------------------
// ⚠️ 为什么放在 config 而不是 meta 或 gems：
//    meta 需要它（执行合成、写存档），但 **meta 不能 require gems** —— gems 已经
//    require meta，反过来就成了环。法则放这里，meta 与 gems 都只是调它。
// ---------------------------------------------------------------------------

/** 选 n 颗同级宝石的合成成功率（0~1）：minCount 颗 baseRate% 起，每多 1 颗 +perExtra%，封顶 maxRate% */
function gemSynthRate(count) {
  const s = GEM.synth;
  const n = Math.max(0, Math.floor(count || 0));
  const extra = Math.max(0, n - s.minCount);
  return Math.min(s.maxRate, s.baseRate + extra * s.perExtra) / 100;
}

/**
 * 合成产物法则：**家族取自材料范围（随机一种）、等级 = 材料等级 + 1**（封顶 GEM_LEVELS）。
 * 材料全同名时产物就是该家族。到顶返回 null（不能合，UI 也不该报价）。
 *
 * ⛔ 别改回"随机滚一个 kind"：旧实现就是这么写的，于是 3 颗 Lv.1 红宝石能合出
 *    tier-5 的混沌紫晶宝石、等级还被写成 5（合成线彻底失控的历史事故）。
 */
function gemSynthResult(materialKinds, lv) {
  const list = (Array.isArray(materialKinds) ? materialKinds : [materialKinds])
    .map((k) => { const r = resolveGem(k, 1); return r ? r.id : null; })
    .filter(Boolean);
  if (!list.length) return null;
  const cur = clampGemLevel(lv);
  if (cur >= GEM_LEVELS) return null;
  const kind = list[Math.floor(Math.random() * list.length)];
  return { kind: kind, lv: cur + 1 };
}

// ============================================================================
// 广告配置
// ============================================================================
const AD = {
  enabled: false, // false 时禁用所有广告相关按钮
  // 开发测试用：没有真实广告位 ID 时，用模拟弹窗（wx.showModal）代替广告，
  // 可完整测试"看完广告→复活"链路。上线前必须改为 false！
  mock: false,
  // ↓↓↓ 以下仍是占位符！必须替换为微信广告后台（mp.weixin.qq.com → 流量主 → 广告位）申请的真实 ID，
  // 格式形如 'adunit-xxxxxxxxxxxxxxxx'（adunit- + 16 位十六进制）。
  // 占位符状态下 ads.js 会自动跳过创建对应广告实例，只打警告，不会触发 errCode 1002 崩溃。
  rewardedVideoAdUnitId: 'adunit-rewarded-video', // 替换为实际广告位 id
  interstitialAdUnitId: 'adunit-interstitial',
  bannerAdUnitId: 'adunit-banner',
  // 30 秒复活需要看 2 个 15 秒激励视频
  reviveAdCount: 2,
  // 插屏广告策略
  interstitialMinIntervalSec: 60, // 两次插屏展示的最小间隔（频控，避免连续弹窗）
  interstitialRetrySec: 30,       // 加载失败后按官方建议间隔一段时间再重试
};

// ============================================================================
// 背景音乐配置
// ============================================================================
// 曲目：audio/snowfall.mp3 —— 原创氛围曲《Snowfall (Original)》
//   · 26.67 秒无缝循环（8 小节 @72BPM），mono / 32kHz / 80kbps，约 261KB。
//   · 生成脚本：.workbuddy/tools/make-snowfall.py（可复现，改参数重跑即可）；
//     无缝性由 .workbuddy/tools/audit-bgm.py 审计（审的是解码后的 mp3）。
//
// ⚠️ 想换成自己手上那首《snowfall》？只要把文件放到 audio/ 下、改这里的 src 即可，
//    别的代码一行都不用动。但请注意：流传最广的那版（Øneheart × reidenshi）是
//    有版权的商业录音，放进了自己的包体再上传发布 = 侵权，请务必先拿到授权。
const MUSIC = {
  enabled: true,                 // 全局总开关（false 时音频模块完全不创建实例；保持 true 才能让游戏内开关能重新打开）
  defaultEnabled: false,         // 用户默认偏好：首次进入、且无存档时的初始开关状态。false = 默认静音/影音关闭
  src: 'audio/snowfall.mp3',     // 代码包内相对路径（微信支持直接播包内本地文件）
  // BGM 音量 0~1。塔防要留耳朵给音效，别开满。
  // 音频文件本身母带定在 RMS -16dBFS（比常见商用曲目低 ~4dB，久听不累），
  // 所以这里给 0.55 —— 实际听感大约 -21dBFS，属于"在背景里、但听得清"。
  volume: 0.55,
  loop: true,                    // 循环播放
  autoplay: true,                // 启动即播；失败时由 audio.js 在首次触摸时兜底重试
  // iOS 静音键：false = 静音键打开时照样出声（游戏常见做法，保证"一进来就有声音"）；
  //              true  = 尊重系统静音键（更礼貌，但用户会以为游戏没声音）。
  // 注意：基础库 2.3.0 起 InnerAudioContext.obeyMuteSwitch 属性失效，
  //       以 wx.setInnerAudioOption 的设置为准（audio.js 两处都设了）。
  obeyMuteSwitch: false,
  // true = 与其它 App 的音频混着播（不打断用户自己正在听的歌）；
  // false = 独占音频通道（会把用户的音乐顶掉）——游戏 BGM 的常规做法。
  mixWithOther: false,
};

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
  AURA_DURATION,
  POINTS,
  CODEX,
  TALENTS,
  TALENT_COST,
  TALENT_POINTS,
  TALENT_EFFECT,
  LEVELS,
  AD,
  MUSIC,
  GEM,
  GEM_KINDS,
  GEM_FAMILIES,
  GEM_FAMILY_BY_ID,
  GEM_LEVELS,
  GEM_LEVEL_LIGHT,
  GEM_ALIAS,
  clampGemLevel,
  gemEffectAt,
  gemDescAt,
  gemLevelColor,
  gemLevelName,
  resolveGem,
  gemSynthRate,
  gemSynthResult,
};
