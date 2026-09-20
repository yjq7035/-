// 塔：工厂 + 造价（从原 Game.createTower / getTowerCost 抽离）
const {
  TOWER_DEFS, TOWER_STATS, PLAYER, ATTACK_SPEED_BASE, MAX_STAGE, BALANCE,
} = require('./config');
const { createUnit } = require('./units');
const gems = require('./gems');
const skills = require('./skills');
const stage = require('./stage');
const aim = require('./aim');
const meta = require('./meta');   // 仅在 setStage（唯一进阶写入点）持久化"达到过的最高星级"

function createTower(type, x, y) {
  const stats = TOWER_STATS[type] || TOWER_STATS.triangle;
  
  // 使用 createUnit 创建单位（所属玩家ID=0，单位ID=类型名）
  const tower = createUnit(PLAYER.OWN, type, x, y, 0);
  
  // 扩展塔属性
  tower.type = type;
  tower.level = 0;
  tower.stage = 0;                // 阶段（初始0阶段，通过同类型同阶段合成升级）
  tower.attackTimer = 0;
  tower.target = null;
  tower.lockedTarget = null; // 锁定的目标，目标死亡前不会切换
  aim.initAim(tower); // 出生朝右（朝向的唯一写入口在 src/aim.js，别在这里直接赋值）
  // 长方塔堆叠伤害字段
  tower.stackCount = 0;       // 当前堆叠层数
  tower.stackTarget = null;   // 当前堆叠的目标
  tower.stackTimer = 0;       // 堆叠倒计时
  // 攻击速度乘数（基于100的百分比）
  tower.attackSpeedMultiplier = stats.attackSpeedMultiplier || ATTACK_SPEED_BASE;
  // 是否辅助塔
  tower.isSupport = stats.isSupport || false;
  // 星级标识字段（由 setStage 同步；真正的进阶数值一律现算，不读这个存档值）
  tower.attackPowerBoost = 0;   // 攻击力增幅百分比（0 = 无增幅）—— 仅展示用
  // 强化等级（局内花金币逐级提升，见 game_core.enhanceTower；需先进阶到 3★）
  tower.enhanceLevel = 0;
  // 强化带来的技能属性增量：{ critChance: 10, ... } —— 值 = per × 强化等级，
  // 叠加在 TOWER_STATS 的原生值之上（取值口径见 src/skills.js）
  tower.enhanceAttrs = {};
  // 每次强化落在哪一项上（顺序记录，供面板/浮层展示）
  tower.enhancePicks = [];
  // 该塔已投入的累计金币（基础造价 + 每次强化/升级花费之和），用于出售返还
  tower._cumulativeGold = 0;
  // 破甲宝石 debuff 等级（由 topaz_break 嵌槽后写入，按等级覆盖同塔已有 debuff）
  tower.breakTier = 0;
  // 当前接收到的共享光环快照（十字塔「共享资源」给出的属性，含技能等级/技能效果）。
  // ⚠️ 唯一写入方 = game_core.syncTowerAuras（每帧刷一次）；战斗取值（getAttackProfile /
  //    skills.bonusFor）与属性面板都读这一份，别在别处写它。
  tower.auraBuffs = null;

  return tower;
}

function getTowerCost(type) {
  const def = TOWER_DEFS[type];
  return def ? def.cost : 100;
}

/**
 * 获取塔的详细属性（纯函数）
 * 从配置中读取，与 TOWER_STATS 同步；找不到时兜底三角塔。
 */
function getTowerStats(type) {
  return TOWER_STATS[type] || TOWER_STATS.triangle;
}

/**
 * 图签加成后的实际造价（"精打细算"天赋折扣由调用方传 discountPercent）。
 * @param {string} type 塔类型
 * @param {number} [discountPercent] 折扣百分比（0~90），默认 0
 */
function getDiscountedCost(type, discountPercent) {
  const base = getTowerCost(type);
  const d = Math.max(0, Math.min(90, discountPercent || 0));
  return Math.max(1, Math.round(base * (1 - d / 100)));
}

/**
 * 获取塔的等级星星显示
 * 0级 = 无星星
 * 1-5级 = 1-5个⭐
 * 6级 = 1个大⭐ (★★★★★★ → ⭐)
 */
function getTowerStars(level) {
  if (level <= 0) return '';
  if (level >= 6) return '⭐'; // 大星
  return '⭐'.repeat(level);
}

/**
 * 获取等级攻击加成比例
 * 每级 +10% 攻击加成
 */
function getLevelAttackBonus(level) {
  if (level <= 0) return 1;
  if (level >= 6) return 1 + (level - 5) * 0.5; // 大星后每级+50%
  return 1 + level * 0.1; // 小星每级+10%
}

/**
 * 获取阶段星星显示
 * 0阶段 = 无显示
 * 1-3阶段 = 对应数量的🌟（3星封顶）
 */
function getStageStars(stage) {
  if (stage <= 0) return '';
  return '🌟'.repeat(Math.min(stage, MAX_STAGE));
}

/**
 * 获取攻击增幅百分比（进阶奖励）
 * ⚠️ 只是 `stage.bonusPercent('damage', stage)` 的兼容壳 —— 攻击力那条线的
 *    进阶幅度现在归 src/stage.js 管。**别再往这里加第二份数字**。
 * 攻击塔：1星 = +100%，2星 = +200%，3星 = +400%（3星封顶）
 */
function getAttackPowerBoost(stageStars) {
  return stage.bonusPercent('damage', stageStars);
}

/** 该塔型的进阶焦点属性（非辅助塔 = ['damage']；辅助塔见 stage.STAGE_FOCUS） */
function getStageFocus(type) {
  return stage.focusOf(type);
}

/**
 * 该塔在某属性上的进阶放大倍率（0★ = 1）。战斗与面板都必须调这一个口。
 * @param {object|number} towerOrStage 塔实例或直接给星级
 * @param {string} attr 属性键（如 'damage' / 'auraPenetration'）
 */
function getStageMultiplier(towerOrStage, attr) {
  const stars = (towerOrStage && typeof towerOrStage === 'object')
    ? (towerOrStage.stage || 0) : towerOrStage;
  return stage.multiplier(attr, stars);
}

/**
 * 设置塔的星级（唯一的"进阶"写入口）。
 * 顺手同步 tower.attackPowerBoost（历史展示字段），免得它和 stage 各说各话。
 * @returns {number} 夹取后的星级
 */
function setStage(tower, stars) {
  if (!tower) return 0;
  const s = stage.clampStage(stars);
  tower.stage = s;
  tower.attackPowerBoost = getAttackPowerBoost(s);
  // 持久化"该塔型达到过的最高星级"：功能性宝石「镇守宝石」的 3★ 判定依赖它。
  // 这里就是进阶的唯一写入点（input.js 合成成功走它），所以只在此处落盘最稳。
  if (tower.type) meta.recordStage(tower.type, s);
  return s;
}

/** 塔当前星级（夹取后；非法输入当 0★） */
function stageOf(tower) {
  return stage.clampStage(tower && tower.stage);
}

/**
 * 计算最终攻击力（包含等级加成、阶段增幅、图签倍率由调用方乘上）
 * 公式：最终攻击力 = 原生攻击力 × 等级加成 × (1 + 阶段增幅/100)
 *
 * 2026-09 二次修订：**强化不再提供任何攻击力点数**，所以这里没有"固定攻击力"入参了。
 * 攻击力的成长只有两条线：合成进阶（等级 +10%/级、阶段 +100/200/400%）与图签（+6%/级）。
 */
function calculateFinalDamage(baseDamage, level, attackPowerBoost) {
  const levelBonus = getLevelAttackBonus(level);
  const boostMultiplier = 1 + (attackPowerBoost / 100);
  return baseDamage * levelBonus * boostMultiplier;
}

// ============================================================================
// 技能（固有技能）—— 数值表在 src/skills.js，这里只做"塔实例 × 技能"的转接头
// ----------------------------------------------------------------------------
// 口径（与 skills.js 严格一致，本文件不再自己维护第二份规则）：
//   强化次数 n      = clamp(局内强化等级 + 宝石等级, 0, BALANCE.enhance.maxLevel)  —— 0..5
//   有效技能等级 Lv = 1 + n  —— 塔一放下就是 Lv.1（不存在 Lv.0），范围 1..6
//   当前值(Lv)      = base + per × n      —— 面板 / 技能槽 / 浮层展示
//   强化增量(n)     = per × n             —— 存进 tower.enhanceAttrs，叠加在原生值之上
// 一条技能可以有多条效果（三角塔 = 暴击几率 + 暴击伤害），强化一次全部一起涨。
// ============================================================================

/** 该塔的固有技能定义（副本外的只读引用；无技能返回 null） */
function getSkillDef(type) {
  return skills.getInnateSkill(type);
}

/**
 * 该塔强化到 level 级时，某条技能效果的「当前值」= base + per × level。
 * level 是【有效技能等级】（强化 + 宝石），与战斗口径 getEnhanceAttr 完全同源。
 * @param {object} [effect] 指定效果行；缺省取技能的首条效果（单效果塔 = 完全等价）
 */
function getSpecialValue(type, level, effect) {
  const list = skills.getEffects(type);
  if (!list.length) return 0;
  return skills.valueOf(effect || list[0], level);
}

/** 该塔强化到 level 级时的「强化增量」= per × level（写进 enhanceAttrs 的那份） */
function getSpecialBonus(type, level, effect) {
  const list = skills.getEffects(type);
  if (!list.length) return 0;
  return skills.bonusOf(effect || list[0], level);
}

// ============================================================================
// 宝石（嵌入加成）—— 按"塔型"永久生效，战斗与面板共用同一份口径
// ----------------------------------------------------------------------------
// 宝石嵌在图签的槽里（meta.socketed），所以它挂在 **type** 上而不是塔实例上：
//   只要有 tower.type，就能算出这颗塔该吃多少宝石加成。
// 所有"取属性"的入口都必须过这里，否则会出现"面板显示 +8% 攻击，打起来没变"。
// ============================================================================

/** 该塔型的宝石加成汇总（无宝石时返回一份全 0 的结构，调用方可无脑相加） */
function getGemBonus(type) {
  return gems.bonusForType(type);
}

/** 攻击力宝石乘数（1 = 无宝石） */
function getGemDamageMultiplier(type) {
  return gems.damageMultiplier(type);
}

/** 宝石绑定的固有技能等级加成（猫眼石 +1 级/颗） */
function getSkillGemLevels(type) {
  return skills.gemLevels(type);
}

/**
 * 该塔的【有效技能等级】= Lv.1 + (局内强化等级 + 宝石等级) —— 1..6。
 * 面板上的「技能名 Lv.x」、强化浮层的「x → x+1」、技能槽都用它，
 * 避免"珠子嵌了但等级没涨"的错觉。
 * ⚠️ 它是【展示等级】（1 起）；报价 / 写 enhanceAttrs 要的是【强化次数】（0 起，见 getEnhanceTimes）。
 */
function getEffectiveSkillLevel(tower) {
  return skills.levelOf(tower);
}

/**
 * 该塔的【强化次数】= clamp(局内强化等级 + 宝石等级) —— 0..5（0 起，存盘口径）。
 * 报价 / canEnhance / applyEnhanceAttrs 全用这一份；展示才 +1 变成技能等级 Lv。
 */
function getEnhanceTimes(tower) {
  return skills.enhanceTimesOf(tower);
}

/** 把【强化次数】夹到 [0, maxLevel]（0 起 —— 不是技能等级），越界输入一律当合法值处理 */
function clampEnhanceLevel(times) {
  return skills.clampEnhanceTimes(times);
}

/**
 * 某项技能属性的增量（叠加在原生值之上的那份）。
 *
 * 口径（2026-09 技能系统版，实现全在 skills.bonusFor）：
 *   有效技能等级 = clamp(局内强化等级 + 宝石等级)
 *   · 该属性是本塔技能里的一条效果 → 增量 = per × 有效技能等级
 *     —— 与面板 / 技能槽展示完全一致；「技能宝石（猫眼石）」就是从这里生效的：
 *        它不需要任何额外分支，全项目的取属性入口本来就是这一个函数
 *        （战斗 / 属性面板 / 强化浮层）。
 *   · 其它键 → 照旧只读 tower.enhanceAttrs
 *   · 三角塔的两条效果（暴击几率 / 暴击伤害）都走第一条：一个技能、两条属性同时涨。
 *
 * ⚠️ 别把第一条改回"只读 enhanceAttrs" —— 那样宝石加的技能等级会在战斗里蒸发。
 */
function getEnhanceAttr(tower, key) {
  return skills.bonusFor(tower, key);
}

/** 该塔的强化选项（一个固有技能 = 一个选项，选项里带该技能的全部效果） */
function getEnhanceOptions(type) {
  return skills.getOptions(type);
}

/** 按 key 取该塔的强化选项；key 可以是技能 id 或任一效果属性键（兼容旧调用） */
function getEnhanceOption(type, key) {
  return skills.getOption(type, key);
}

/** 文案：技能当前值，如「30%」/「×6」/「暴击几率 30% · 暴击伤害 50%」 */
function specialText(type, level, key) {
  const list = skills.getEffects(type);
  if (!list.length) return '';
  if (key) {
    const one = skills.findEffect(type, key);
    return one ? skills.valueTextOf(one, level) : '';
  }
  return skills.skillValueText(type, level);
}

/** 文案：本次强化的收益，如「+5%」/「暴击几率 +5% · 暴击伤害 +10%」 */
function specialGainText(type, key) {
  const list = skills.getEffects(type);
  if (!list.length) return '';
  if (key) {
    const one = skills.findEffect(type, key);
    return one ? skills.gainTextOf(one) : '';
  }
  return skills.skillGainText(type);
}

// ============================================================================
// 专属属性 → 战斗口径取值器
// 战斗里凡是「按塔实例取这些属性」的地方都必须走这里，否则强化不生效。
// ============================================================================

/** 六边塔：对精英及以上（tier>=3）的伤害倍率（默认 5，每级 +1） */
function getEliteMultiplier(tower) {
  const st = (tower && TOWER_STATS[tower.type]) || {};
  return (st.eliteMult || 5) + getEnhanceAttr(tower, 'eliteMult');
}

/** 正方塔：弹道体积倍率（原生 100%，每级 +20% → 1.0 ~ 2.0 倍） */
function getProjectileScale(tower) {
  const st = (tower && TOWER_STATS[tower.type]) || {};
  const pct = (st.projectileScale || 100) + getEnhanceAttr(tower, 'projectileScale');
  return Math.max(0, pct) / 100;
}

/** 正方塔：弹道命中半径（原 10 × 体积倍率，"相对伤害范围"随之变大） */
function getProjectileSize(tower) {
  return 10 * getProjectileScale(tower);
}

/** 扇塔：扇形半张角（弧度），默认 45° */
function getSectorHalfAngle(tower) {
  const st = (tower && TOWER_STATS[tower.type]) || {};
  const deg = (st.sectorHalfAngle || 45) + getEnhanceAttr(tower, 'sectorAngle');
  return deg * Math.PI / 180;
}

/** 长方塔：堆叠上限（默认 10 层，每级 +2） */
function getStackMax(tower) {
  const st = (tower && TOWER_STATS[tower.type]) || {};
  return (st.stackMax || 10) + getEnhanceAttr(tower, 'stackMax');
}

/**
 * 平行塔：固有技能「连续射击」的攻速叠加上限（原生 100%，强化每级 +20%）。
 * 战斗口径 = 原生值 + 强化增量，与 skills.SKILLS.parallel 的 base + per×L 同源；
 * 技能宝石加的等级同样由 getEnhanceAttr 折算进来。
 */
function getInnateStackCap(tower) {
  const st = (tower && TOWER_STATS[tower.type]) || {};
  return (st.innateStackCap || 100) + getEnhanceAttr(tower, 'innateStackCap');
}

/** 平行塔：被迫连打同一目标时，每次攻击叠加的攻速点数（原生 10） */
function getInnateStackStep(tower) {
  const st = (tower && TOWER_STATS[tower.type]) || {};
  return st.innateStackStep || 10;
}

/**
 * 把塔的强化等级重新结算成 enhanceAttrs。
 * 单一真源：先清空再按「per × 等级」写入，等级回退（理论上不会发生）也不会残留旧的增量。
 * 一条技能的全部效果都会写进 enhanceAttrs[key]（三角塔 = critChance + critDamage 两条），
 * 让 getEnhanceAttr(tower, key) 可以直接查 enhanceAttrs 兜底。
 * @returns {object} tower.enhanceAttrs
 */
function applyEnhanceAttrs(tower) {
  return skills.applyTo(tower);
}

/** 是否已进阶到可强化的星级（3★封顶） */
function isStageReady(tower) {
  return !!tower && (tower.stage || 0) >= BALANCE.enhance.minStage;
}

/**
 * 强化到下一级所需金币。
 * @param {number} enhanceTimes 【强化次数】（0 起，存盘口径 —— 不是技能等级 Lv）
 * 造价 = 塔基础造价 × costRate × (次数 + 1)（越强化越贵）
 * @returns {number} 已满级返回 Infinity
 */
function getEnhanceCost(type, enhanceTimes) {
  const n = Math.max(0, enhanceTimes || 0);
  if (n >= BALANCE.enhance.maxLevel) return Infinity;
  const base = getTowerCost(type);
  return Math.max(1, Math.round(base * BALANCE.enhance.costRate * (n + 1)));
}

/** 是否还能继续强化（只判等级上限；星级门槛另用 isStageReady）
 *  ⚠️ 判的是【强化次数】（强化 + 宝石），**不是技能等级 Lv** ——
 *     拿 Lv 去和 maxLevel 比会把 Lv.5 误判成满级，技能就永远到不了 Lv.6。
 *  ⚠️ 宝石也计入次数：宝石已经把技能顶到上限时按钮必须变灰，
 *     否则玩家会花金币买一个 clamp 掉的等级（白扣钱）。 */
function canEnhance(tower) {
  return !!tower && getEnhanceTimes(tower) < skills.MAX_ENHANCE_TIMES;
}

/**
 * 塔的一次攻击参数（暴击率 / 暴击倍率 / 穿透），已并入技能与宝石的累计属性。
 * 战斗结算与属性面板共用此函数，保证"显示的"与"结算的"同口径。
 *
 * 暴击倍率三条来源（与 bonusStats 的 暴击伤害 行同口径）：
 *   ① critMult   原生倍率（三角塔 2.1）
 *   ② critDamage 原生「+N% 暴击伤害」（三角塔 +10%）→ 直接加到倍率上（+0.1）
 *   ③ 技能「暴击伤害」的增量 per × 有效技能等级（同样按 % 加算）
 *   另有 critMult 百分比放大（乘算，当前没有塔用它，保留给将来）
 *
 * ⚠️ 技能增量的放大系数（紫晶宝石「技能效果 +N%」）已经包含在 getEnhanceAttr 里，
 *    这里不能再乘一次 —— 否则会重复放大（历史口径打架的来源之一）。
 * @returns {{ critChance:number, critMult:number, penetration:number, break:number }}
 */
function getAttackProfile(tower) {
  const type = tower ? tower.type : null;
  const st = TOWER_STATS[type] || TOWER_STATS.triangle;
  const gem = getGemBonus(type);
  const critMultPct = getEnhanceAttr(tower, 'critMult');       // 百分比放大（乘算）
  const baseNative = (st.critMult || BALANCE.critDamageDefaultMult) + (st.critDamage || 0) / 100;
  const critDamagePts = getEnhanceAttr(tower, 'critDamage') || 0;
  const critDamagePct = getEnhanceAttr(tower, 'critDamagePercent') || 0;
  // 共享光环（十字塔「共享资源」）：暴击率 / 暴击伤害 / 破解直接加在自身属性上。
  // ⚠️ 穿透**不在这里**加 —— 它由 game_core.getEffectivePenetration 统一负责，
  //    两边都加会重复计算（历史口径打架的来源之一）。
  const auraCrit = auraNum(tower, 'critChance');
  const auraCritDmg = auraNum(tower, 'critDamage') + auraNum(tower, 'critDamagePercent');
  const auraBreak = auraNum(tower, 'break');
  return {
    critChance: Math.max(0, (st.critChance || 0) + gem.critChance + getEnhanceAttr(tower, 'critChance') + auraCrit),
    critMult: Math.max(1, baseNative * (1 + critMultPct / 100) + critDamagePts / 100 + critDamagePct / 100 + auraCritDmg / 100),
    penetration: Math.max(0, (st.penetration || 0) + gem.penetration + getEnhanceAttr(tower, 'penetration')),
    break:       Math.max(0, (st.break || 0) + gem.break + getEnhanceAttr(tower, 'break') + auraBreak),
  };
}

/** 塔当前接收到的某条共享光环数值（tower.auraBuffs 由 game_core.syncTowerAuras 写入） */
function auraNum(tower, key) {
  const b = tower && tower.auraBuffs;
  if (!b) return 0;
  const v = Number(b[key]);
  return isFinite(v) ? v : 0;
}

/**
 * 塔的"运行时属性"：TOWER_STATS 叠加强化专属属性后的结果。
 * 战斗里凡是「按塔实例取属性」的地方都必须走这里，否则强化出来的射程/攻速不生效。
 *
 * 注：eliteMult / sectorAngle / stackMax / projectileScale 这四项不在这里，
 *     它们由上方各自的 getter（getEliteMultiplier 等）直接读，避免把原生结构撑变形。
 * @returns {object} 与 TOWER_STATS[type] 同结构（浅拷贝）
 */
function getTowerRuntimeStats(tower) {
  const type = tower ? tower.type : null;
  const st = TOWER_STATS[type] || TOWER_STATS.triangle;
  const lv = tower ? (tower.enhanceLevel || 0) : 0;
  // 宝石挂在塔型上（跨局永久），所以即使强化等级为 0 也要参与结算
  const gem = getGemBonus(type);
  const hasGem = gem.count > 0;
  // 没有任何强化/宝石来源、且原生也没有"额外暴击伤害"时，直接返回原生表（省一次拷贝）。
  // ⚠️ st.critDamage 这个条件不能省：三角塔原生就带 +10% 暴击伤害，必须走下面的合成，
  //    否则 runtimeStats.critMult 会漏掉那 0.1，与 getAttackProfile 对不上。
  if (lv <= 0 && !hasGem && !st.critDamage) return st;

  const out = Object.assign({}, st);
  const add = (key) => getEnhanceAttr(tower, key);
  out.range = (st.range || 0) + gem.range + add('range');
  // out.hp = (st.hp || 0) + add('hp');  // 已移除：图形塔无敌
  out.attackSpeedMultiplier = (st.attackSpeedMultiplier || 0) + gem.attackSpeedMultiplier + add('attackSpeedMultiplier');
  out.penetration = (st.penetration || 0) + gem.penetration + add('penetration');
  out.break = (st.break || 0) + gem.break + add('break');
  out.critChance = (st.critChance || 0) + gem.critChance + add('critChance');
  // 暴击倍率：原生倍率 + 原生「+N% 暴击伤害」（三角塔 +10%）+ 技能增量（点值，单位 %）
  // ⚠️ critDamage 已经并进 critMult，这里不再单独输出 critDamage 字段 ——
  //    两边都留会让"读 critMult 又读 critDamage"的调用点重复计算（+10% 变成 +20%）。
  //    ⚠️ 技能增量的放大系数（紫晶宝石「技能效果 +N%」）已含在 add('critDamage') 里，
  //       这里不能再乘一次 skillEffectMult。
  const critBase = (st.critMult || BALANCE.critDamageDefaultMult) + (st.critDamage || 0) / 100;
  out.critMult = critBase * (1 + add('critMult') / 100) + add('critDamage') / 100 + add('critDamagePercent') / 100;
  if (st.isSupport) {
    // 辅助塔：技能"光环强度"直接加成在光环数值上
    const base = (st.supportBuff && st.supportBuff.attackSpeedMultiplier) || 0;
    out.supportBuff = { attackSpeedMultiplier: base + add('auraPower') };
    // 十字塔：技能「共享资源」抬高共享比例（原生 25%，强化每级 +5%）
    if (st.shareRatio !== undefined) {
      out.shareRatio = (st.shareRatio || 0) + add('shareRatio');
    }
    // 菱形塔的技能是"穿透光环"（原生值在 st.auraPenetration 上）——
    // 这里必须跟着算，否则技能槽显示 Lv.5、光环却还是 5 点（"面板涨了、光环没涨"）。
    if (st.auraPenetration !== undefined) {
      out.auraPenetration = (st.auraPenetration || 0) + add('auraPenetration');
    }
  }
  return out;
}

/**
 * 圆塔二段爆炸参数（专属属性"二段爆炸伤害"在此生效）。
 * 半径保持原生值（上一版可强化的"爆炸范围"已取消，让位给单项专属属性）。
 * @returns {{ radius:number, ratio:number }} ratio 为溅射伤害占主伤害的比例（0~1）
 */
function getExplosionParams(tower) {
  const st = (tower && TOWER_STATS[tower.type]) || {};
  const radius = (st.explosionRadius || 60) + getEnhanceAttr(tower, 'explosionRadius');
  const ratioPct = (st.explosionRatio || 25) + getEnhanceAttr(tower, 'explosionDamage');
  return { radius: radius, ratio: Math.max(0, ratioPct) / 100 };
}

/**
 * 该辅助塔**实际发出**的光环内容（战斗与显示的唯一同源实现）。
 *
 * 计算链（与面板 bonusStats 的明细严格同口径）：
 *   发出值 = (原生光环值 + 技能/宝石增量)      ← getTowerRuntimeStats 已算好
 *          × 进阶倍率（src/stage.js，按各塔的焦点属性取）
 *          × 图签倍率（仅攻速光环；穿透光环按既定设计是固定值，不吃图签）
 *
 * ⚠️ 菱形塔的穿透光环**必须**乘进阶倍率 —— 这正是 2026-09-19 修的那个洞：
 *    旧版这里写死 `buff.penetration = auraPen`，于是 0★ 和 3★ 的菱形塔发出的
 *    穿透完全相同，进阶对它完全空转（而面板还照报"阶段增幅 +300%"）。
 * ⚠️ 别把 codexMult 也乘到穿透上 —— 那会改变既有的"穿透光环不吃图签"设计。
 *
 * @param {object} tower 辅助塔实例
 * @param {number} [codexMult] 该塔型的图签攻击倍率（= meta.codexDamageMultiplier(type)）
 * @returns {Object} buff 键值对，如 { attackSpeedMultiplier: 100 } / { penetration: 20 }；空对象 = 无光环
 */
function getAuraOutput(tower, codexMult) {
  const stats = getTowerRuntimeStats(tower);
  const stars = stageOf(tower);
  const codex = (isFinite(codexMult) && codexMult > 0) ? codexMult : 1;
  const out = {};
  const speedBase = stats.supportBuff && stats.supportBuff.attackSpeedMultiplier;
  if (speedBase) {
    out.attackSpeedMultiplier = speedBase * stage.multiplier('auraPower', stars) * codex;
  }
  const penBase = stats.auraPenetration;
  if (penBase) {
    out.penetration = penBase * stage.multiplier('auraPenetration', stars);
  }
  // 十字塔「共享资源」：把**自身吃到的宝石属性**按共享比例转给上下左右的邻塔。
  //   发出值 = 宝石值 × 共享比例（原生 25% + 强化增量）× 进阶倍率 ÷ 100
  //   ⚠️ 十字塔自身没有任何原生战斗属性，所以没有宝石 = 没有共享（发出空对象，不发光环）——
  //     这正是"本身没有任何属性"的落点，别给它兜底一个默认值。
  //   ⚠️ 暴击伤害宝石（critDamagePercent）统一改写成 'critDamage' 键：它们都是
  //     "直接加到暴击倍率上的百分比点值"，面板那一行与战斗侧也只认 critDamage。
  const shareBase = stats.shareRatio;
  if (shareBase) {
    const gem = gems.bonusForType(tower.type);
    const ratio = shareBase * stage.multiplier('shareRatio', stars);
    const scaled = (v) => (v || 0) * ratio / 100;
    const towerSkillLevels = skills.enhanceTimesOf(tower);  // 强化次数 = level - 1
    const map = [
      ['damagePercent', 'damagePercent'],
      ['attackSpeedMultiplier', 'attackSpeedMultiplier'],
      ['critChance', 'critChance'],
      ['penetration', 'penetration'],
      ['break', 'break'],
      ['critDamagePercent', 'critDamage'],
    ];
    for (const [src, dst] of map) {
      const v = scaled(gem[src]);
      if (v) out[dst] = v;
    }
    // 技能等级：十字塔自身技能等级（强化 + 嵌宝石 + 其他十字塔共享）参与共享
    //   余数不计（只取整数部分），防止 5 * 30/100 = 1.5 被当成 +1 级
    if (towerSkillLevels) out.skillLevels = Math.floor(towerSkillLevels * ratio / 100);
    // 技能效果（紫晶）：仅嵌在十字塔上的紫晶贡献（强化不影响技能效果）
    if (gem.skillEffectPercent) out.skillEffectPercent = Math.floor(gem.skillEffectPercent * ratio / 100);
  }
  return out;
}

/**
 * 十字塔的**实际共享比例**（%）= (原生 25 + 强化增量) × 进阶倍率 —— 战斗与展示同源。
 * 发出的光环数值 = 宝石值 × 本比例 ÷ 100（见 getAuraOutput）。
 */
function getShareRatio(tower) {
  const stats = getTowerRuntimeStats(tower);
  return (stats.shareRatio || 0) * stage.multiplier('shareRatio', stageOf(tower));
}

/**
 * 检查是否可以合成升级
 * tower1: 已存在的塔(目标槽), tower2: 新放置的塔(触发拖放)
 * 规则：同类型 + 同阶段 + 不是自身 + 同一玩家
 */
function canMergeUpgrade(tower1, tower2) {
  if (tower1.type !== tower2.type) return false;
  if (tower1.stage !== tower2.stage) return false;
  // 3星封顶：已达最高阶段不可再合成
  if (tower1.stage >= MAX_STAGE) return false;
  // tower2.uniqueId 可能为 null（拖放中的塔），此时跳过自身检查
  if (tower2.uniqueId !== null && tower1.uniqueId === tower2.uniqueId) return false;
  if (tower1.owner !== tower2.owner) return false;
  return true;
}

module.exports = {
  createTower,
  getTowerCost,
  getTowerStats,
  getDiscountedCost,
  getTowerStars,
  getLevelAttackBonus,
  canMergeUpgrade,
  getStageStars,
  getAttackPowerBoost,
  // ---- 进阶（阶段）系统：唯一真源 src/stage.js ----
  stage,                  // 直接暴露进阶系统（面板/探针需要更细的接口时用它）
  getStageFocus,
  getStageMultiplier,
  setStage,
  stageOf,
  calculateFinalDamage,
  // ---- 固有技能（数值表在 src/skills.js，这里是与塔实例结合的转接头）----
  skills,                 // 直接把技能系统暴露出去（面板/浮层/图签需要更细的接口时用它）
  getSkillDef,
  getSpecialValue,
  getSpecialBonus,
  getGemBonus,
  getGemDamageMultiplier,
  getSkillGemLevels,
  getEffectiveSkillLevel,
  getEnhanceTimes,
  clampEnhanceLevel,
  getEnhanceAttr,
  getEnhanceOptions,
  getEnhanceOption,
  specialText,
  specialGainText,
  getEliteMultiplier,
  getProjectileScale,
  getProjectileSize,
  getSectorHalfAngle,
  getStackMax,
  getInnateStackCap,
  getInnateStackStep,
  applyEnhanceAttrs,
  isStageReady,
  getEnhanceCost,
  canEnhance,
  getAttackProfile,
  getTowerRuntimeStats,
  getExplosionParams,
  getAuraOutput,
  getShareRatio,
};
