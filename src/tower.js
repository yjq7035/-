// 塔：工厂 + 造价（从原 Game.createTower / getTowerCost 抽离）
const {
  TOWER_DEFS, TOWER_STATS, PLAYER, ATTACK_SPEED_BASE, MAX_STAGE, STAGE_BOOSTS, BALANCE,
  ENHANCE_SPECIAL,
} = require('./config');
const { createUnit } = require('./units');

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
  tower.attackAngle = 0; // 默认朝向右侧
  // 长方塔堆叠伤害字段
  tower.stackCount = 0;       // 当前堆叠层数
  tower.stackTarget = null;   // 当前堆叠的目标
  tower.stackTimer = 0;       // 堆叠倒计时
  // 攻击速度乘数（基于100的百分比）
  tower.attackSpeedMultiplier = stats.attackSpeedMultiplier || ATTACK_SPEED_BASE;
  // 是否辅助塔
  tower.isSupport = stats.isSupport || false;
  // 攻击增幅属性（通过合成升级获得）
  tower.attackPowerBoost = 0;   // 攻击力增幅百分比（0 = 无增幅）
  // 强化等级（局内花金币逐级提升，见 game_core.enhanceTower；需先进阶到 3★）
  tower.enhanceLevel = 0;
  // 强化带来的专属属性增量：{ critChance: 10, ... } —— 值 = per × 强化等级，
  // 叠加在 TOWER_STATS 的原生值之上（取值口径见 config.ENHANCE_SPECIAL）
  tower.enhanceAttrs = {};
  // 每次强化落在哪一项上（顺序记录，供面板/浮层展示）
  tower.enhancePicks = [];
  
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
 * 获取攻击增幅百分比（阶段奖励表）
 * 1星 = +100%，2星 = +200%，3星 = +400%（3星封顶）
 */
function getAttackPowerBoost(stage) {
  if (!stage || stage <= 0) return 0;
  if (stage > MAX_STAGE) stage = MAX_STAGE;
  return STAGE_BOOSTS[stage] || 0;
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
// 强化（局内花钱，需先进阶到 3★）—— 每塔一项「专属特殊属性」，逐级抬高
// ----------------------------------------------------------------------------
// 取值口径（与 config.ENHANCE_SPECIAL 严格一致）：
//   当前值(L) = base + per × L          —— 面板/浮层展示用
//   强化增量    = per × L               —— 存进 tower.enhanceAttrs，叠加在原生值上
// 两个式子等价的前提是 base === TOWER_STATS 里的原生值（verify.js 会逐塔断言）。
// ============================================================================

/** 该塔的专属特殊属性定义（副本外的只读引用；无定义返回 null） */
function getSpecialDef(type) {
  return ENHANCE_SPECIAL[type] || null;
}

/** 该塔强化到 level 级时，专属特殊属性的「当前值」= base + per × level */
function getSpecialValue(type, level) {
  const sp = getSpecialDef(type);
  if (!sp) return 0;
  const lv = clampEnhanceLevel(level);
  return sp.base + sp.per * lv;
}

/** 该塔强化到 level 级时的「强化增量」= per × level（写进 enhanceAttrs 的那份） */
function getSpecialBonus(type, level) {
  const sp = getSpecialDef(type);
  if (!sp) return 0;
  return sp.per * clampEnhanceLevel(level);
}

/** 把等级夹到 [0, maxLevel]，越界输入一律当合法值处理 */
function clampEnhanceLevel(level) {
  const lv = level || 0;
  if (lv <= 0) return 0;
  return Math.min(BALANCE.enhance.maxLevel, lv);
}

/**
 * 某项强化属性的增量（叠加在原生值之上的那份）
 * 例：三角塔强化 2 级 → getEnhanceAttr(tower,'critChance') === 10
 */
function getEnhanceAttr(tower, key) {
  if (!tower || !tower.enhanceAttrs) return 0;
  return tower.enhanceAttrs[key] || 0;
}

/** 该塔的强化选项（现在每塔只有一项，返回单元素数组以兼容浮层渲染） */
function getEnhanceOptions(type) {
  const sp = getSpecialDef(type);
  return sp ? [specialToOption(sp)] : [];
}

/** 按 key 取该塔的强化选项；key 不是它的专属属性时返回 null */
function getEnhanceOption(type, key) {
  const sp = getSpecialDef(type);
  if (!sp) return null;
  return (!key || key === sp.key) ? specialToOption(sp) : null;
}

/** 专属属性定义 → 浮层用的选项结构 */
function specialToOption(sp) {
  return {
    key: sp.key,
    name: sp.name,
    perLevel: sp.per,   // 每次强化的增量
    base: sp.base,      // 默认（未强化）取值
    unit: sp.unit,
    desc: sp.desc,
  };
}

/** 文案：属性值，如「25%」/「×5」/「45°」/「10层」/「260」（`倍` 前缀 ×） */
function specialText(type, level) {
  const sp = getSpecialDef(type);
  if (!sp) return '';
  const v = getSpecialValue(type, level);
  return sp.unit === '倍' ? `×${v}` : `${v}${sp.unit}`;
}

/** 文案：本次强化的收益，如「+5%」/「+1倍」/「+15」 */
function specialGainText(type) {
  const sp = getSpecialDef(type);
  return sp ? `+${sp.per}${sp.unit}` : '';
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
 * 把塔的强化等级重新结算成 enhanceAttrs。
 * 单一真源：先清空再按「per × 等级」写入，等级回退（理论上不会发生）也不会残留旧的增量。
 * @returns {object} tower.enhanceAttrs
 */
function applyEnhanceAttrs(tower) {
  const sp = tower ? getSpecialDef(tower.type) : null;
  if (!tower) return {};
  tower.enhanceAttrs = {};
  if (!sp) return tower.enhanceAttrs;
  const lv = clampEnhanceLevel(tower.enhanceLevel);
  if (lv > 0) tower.enhanceAttrs[sp.key] = sp.per * lv;
  return tower.enhanceAttrs;
}

/** 是否已进阶到可强化的星级（3★封顶） */
function isStageReady(tower) {
  return !!tower && (tower.stage || 0) >= BALANCE.enhance.minStage;
}

/**
 * 强化到下一级所需金币。
 * 目标等级 L 的造价 = 塔基础造价 × costRate × L（越强化越贵）
 * @returns {number} 已满级返回 Infinity
 */
function getEnhanceCost(type, enhanceLevel) {
  const lv = Math.max(0, enhanceLevel || 0);
  if (lv >= BALANCE.enhance.maxLevel) return Infinity;
  const base = getTowerCost(type);
  return Math.max(1, Math.round(base * BALANCE.enhance.costRate * (lv + 1)));
}

/** 是否还能继续强化（只判等级上限；星级门槛另用 isStageReady） */
function canEnhance(tower) {
  return !!tower && (tower.enhanceLevel || 0) < BALANCE.enhance.maxLevel;
}

/**
 * 塔的一次攻击参数（暴击率 / 暴击倍率 / 穿透），已并入强化累计属性。
 * 战斗结算与属性面板共用此函数，保证"显示的"与"结算的"同口径。
 * @returns {{ critChance:number, critMult:number, penetration:number }}
 */
function getAttackProfile(tower) {
  const type = tower ? tower.type : null;
  const st = TOWER_STATS[type] || TOWER_STATS.triangle;
  const critMultPct = getEnhanceAttr(tower, 'critMult'); // 百分比放大
  return {
    critChance: Math.max(0, (st.critChance || 0) + getEnhanceAttr(tower, 'critChance')),
    critMult: Math.max(1, (st.critMult || BALANCE.critDamageDefaultMult) * (1 + critMultPct / 100)),
    penetration: Math.max(0, (st.penetration || 0) + getEnhanceAttr(tower, 'penetration')),
  };
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
  if (lv <= 0) return st;

  const out = Object.assign({}, st);
  const add = (key) => getEnhanceAttr(tower, key);
  out.range = (st.range || 0) + add('range');
  out.hp = (st.hp || 0) + add('hp');
  out.attackSpeedMultiplier = (st.attackSpeedMultiplier || 0) + add('attackSpeedMultiplier');
  out.penetration = (st.penetration || 0) + add('penetration');
  out.critChance = (st.critChance || 0) + add('critChance');
  out.critMult = (st.critMult || BALANCE.critDamageDefaultMult) * (1 + add('critMult') / 100);
  if (st.isSupport) {
    // 辅助塔：专属属性"光环强度"直接加成在光环数值上
    const base = (st.supportBuff && st.supportBuff.attackSpeedMultiplier) || 0;
    out.supportBuff = { attackSpeedMultiplier: base + add('auraPower') };
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
  calculateFinalDamage,
  getSpecialDef,
  getSpecialValue,
  getSpecialBonus,
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
  applyEnhanceAttrs,
  isStageReady,
  getEnhanceCost,
  canEnhance,
  getAttackProfile,
  getTowerRuntimeStats,
  getExplosionParams,
};
