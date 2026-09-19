// ============================================================================
// 进阶（阶段）系统 —— src/stage.js
// ----------------------------------------------------------------------------
// 【进阶】= 同类型同阶段的塔互相合成，星级 +1（0★ → 1★ → 2★ → 3★，MAX_STAGE 封顶）。
// 玩家不花金币、不选方向：合出来就自动按本表放大该塔的**核心贡献属性**。
//
// ★ 为什么要独立成一个模块（2026-09-19）
// ----------------------------------------------------------------------------
// 旧版把进阶写成 config 里一句全局常量（`{1:100, 2:200, 3:400}`），语义写死为
// "攻击力 +N%"，并且只在 game_core.towerDamage 一处生效。后果：
//   · 辅助塔（damage = 0）进阶后 0 × 4 = 0，**面板显示 +400%、实战一点没变**；
//     菱形塔（穿透光环）尤其严重 —— 它的光环当年是"固定值不吃任何放大"，
//     于是 0★ 和 3★ 的菱形塔发出的穿透**一模一样**，整个进阶线对它完全空转。
//   · bonusStats 里两张硬编码的 if 分支，给**所有**辅助塔都挂一条
//     「光环强度 +300%」—— 菱形塔给的是*穿透*光环，这条明细是纯撒谎。
//   · 进阶幅度的数值散在两处（config 的攻击表 + applyTrapezoidAuras 里的 `(1+stage)`），
//     加一座辅助塔就要记得再改一处，忘了就静默空转。
//
// 本模块把这件事收成一个口：
//   · STAGE_TABLES —— 每类**属性**的进阶放大表（可按属性配不同的曲线）
//   · STAGE_FOCUS  —— 每座塔的**核心贡献属性**（进阶放大它）
//   战斗侧（game_core.applyTrapezoidAuras / towerDamage）、面板（bonusStats）、
//   场上标识（renderer）全部从这里取值，谁都不许再自己写第二份数字。
//
// ★ 新增一座塔时唯一要做的事：确认它的 focus。
//   非辅助塔默认 `['damage']`，不用写；**辅助塔必须在 STAGE_FOCUS 里显式声明**，
//   否则 audit() 会报红 —— 这条硬规则就是为了拦住"又一座进阶空转的菱形塔"。
//
// 依赖方向：stage → config（只取 MAX_STAGE）。**config 不许 require stage**（成环）。
// ============================================================================

const { MAX_STAGE } = require('./config');

/**
 * 进阶放大表：属性键 → { 星级: 增幅百分比 }。
 *   实际倍率 = 1 + 百分比/100（0★ 恒为 1 倍，即"没进阶 = 原生值"）。
 *
 * 曲线为什么分两种：
 *   · damage —— 主输出，1★/2★/3★ = +100%/+200%/+400%（保留旧平衡，别动）
 *   · 辅助光环 —— +100%/星（线性），与旧版 applyTrapezoidAuras 的 `(1+stage)` 等价，
 *     所以改成查表后梯塔数值**一点没变**（1★×2 / 2★×3 / 3★×4）。
 *     光环是给别的塔吃的、还能被"同属性取最强"规则互相顶掉，给太高会挤压主输出的地位。
 */
const STAGE_TABLES = {
  damage:           { 1: 100, 2: 200, 3: 400 },
  auraPower:        { 1: 100, 2: 200, 3: 300 },
  auraPenetration:  { 1: 100, 2: 200, 3: 300 },
  // 十字塔「共享资源」：共享比例本身也吃进阶（+100%/星，与梯塔口径一致）。
  //   发出的光环数值 = 宝石值 × 共享比例 × 本倍率，见 tower.getAuraOutput。
  shareRatio:       { 1: 100, 2: 200, 3: 300 },
};

/**
 * 每座塔的"进阶焦点"：进阶时放大哪些属性。
 * 缺省（非辅助塔）= ['damage']，所以 14 座攻击塔都不用写。
 * ⚠️ 辅助塔（TOWER_STATS[type].isSupport）**必须**在这里显式登记 ——
 *    因为它的伤害是 0，"放大攻击力"对它等于什么都没做。
 */
const STAGE_FOCUS = {
  // 梯塔：攻速光环（发出的 supportBuff.attackSpeedMultiplier）
  trapezoid: ['auraPower'],
  // 菱形塔：穿透光环（发出的 auraPenetration）—— 2026-09-19 补上，此前完全空转
  diamond: ['auraPenetration'],
  // 十字塔：共享比例（宝石属性转给上下左右邻塔的那个 %）
  cross: ['shareRatio'],
};

/** 默认焦点：非辅助塔统一放大攻击力 */
const DEFAULT_FOCUS = ['damage'];

/** 效果单位/展示名（面板明细与场上标识共用，避免两处各写一份中文） */
const STAGE_ATTR_META = {
  damage:          { name: '攻击力',  short: '攻击', unit: '%' },
  auraPower:       { name: '光环强度', short: '攻速', unit: '%' },
  auraPenetration: { name: '穿透光环', short: '穿透', unit: '' },
  shareRatio:      { name: '共享比例', short: '共享', unit: '%' },
};

/** 把星级夹进 [0, MAX_STAGE]（越界/非法输入一律当 0★ 处理） */
function clampStage(stage) {
  const n = Number(stage);
  if (!isFinite(n) || n <= 0) return 0;
  return Math.min(MAX_STAGE, Math.floor(n));
}

/** 该塔型的进阶焦点属性列表 */
function focusOf(type) {
  const list = type ? STAGE_FOCUS[type] : null;
  return (list && list.length) ? list.slice() : DEFAULT_FOCUS.slice();
}

/** 某属性在某星级下的增幅百分比（0★ / 未登记的属性 = 0） */
function bonusPercent(attr, stage) {
  const table = STAGE_TABLES[attr];
  if (!table) return 0;
  return table[clampStage(stage)] || 0;
}

/**
 * 某属性在某星级下的**放大倍率**（0★ = 1）。
 * 这是全项目唯一的"进阶怎么算"入口：战斗与面板都必须调它，
 * 别再写 `1 + stage` 之类的等价表达式（那正是旧版散成两处数字的来源）。
 */
function multiplier(attr, stage) {
  const pct = bonusPercent(attr, stage);
  const m = 1 + pct / 100;
  return (isFinite(m) && m > 0) ? m : 1;
}

/** 某塔型在某星级下某属性的增幅百分比（focus 之外的属性一律 0） */
function bonusPercentForType(type, attr, stage) {
  if (focusOf(type).indexOf(attr) < 0) return 0;
  return bonusPercent(attr, stage);
}

/** 展示元信息（名字 / 短名 / 单位） */
function attrMeta(attr) {
  return STAGE_ATTR_META[attr] || { name: attr, short: attr, unit: '' };
}

/** 某一档星级的明细文案：'1★ +100%' / '3★ +400%' */
function gainText(attr, stage) {
  const pct = bonusPercent(attr, stage);
  return pct > 0 ? `${clampStage(stage)}★ +${pct}%` : '';
}

// ============================================================================
// 契约自检（给探针用；运行时不调用）
// ============================================================================

/**
 * 静态自检：返回问题清单（空数组 = 合格）。检查项：
 *   ① 每张放大表都覆盖 1..MAX_STAGE，且 0★ 无条目（0★ 必须等于"没进阶"）
 *   ② 增幅百分比随星级**严格递增**（进阶不该出现"2★ 比 1★ 弱"）
 *   ③ 每座**辅助塔**都在 STAGE_FOCUS 里显式登记了焦点（否则进阶必然空转）
 *   ④ 焦点属性必须有对应的放大表 + 展示元信息
 *   ⑤ 辅助塔的焦点不许是 'damage' —— 伤害为 0 的塔放大攻击力等于没做
 *
 * ⚠️ 这里**测不出"登记的焦点属性其实没接进战斗"**（菱形塔当年正是这种：
 *    表里写得很漂亮、applyTrapezoidAuras 里没接）。所以新增/改动进阶时，
 *    必须跑 probe-stage.js —— 它按 (0★,1★,2★,3★) 四态实测战斗数值的 diff。
 */
function audit() {
  const problems = [];
  const { TOWER_DEFS, TOWER_STATS } = require('./config');
  const ATTRS = Object.keys(STAGE_TABLES);

  // ①② 放大表本身
  for (const attr of ATTRS) {
    const table = STAGE_TABLES[attr];
    if (table[0] !== undefined) problems.push(`${attr}: 0★ 不该有条目（0★ 必须等于原生值）`);
    for (let s = 1; s <= MAX_STAGE; s++) {
      const pct = table[s];
      if (!(pct > 0)) { problems.push(`${attr}: 缺 ${s}★ 的增幅`); continue; }
      if (s > 1 && !(pct > table[s - 1])) {
        problems.push(`${attr}: ${s}★ (${pct}%) 不高于 ${s - 1}★ (${table[s - 1]}%)——进阶不该变弱`);
      }
    }
  }

  // ③④⑤ 逐塔核对焦点
  for (const type of Object.keys(TOWER_DEFS)) {
    const st = TOWER_STATS[type] || {};
    const focus = focusOf(type);
    const declared = (STAGE_FOCUS[type] && STAGE_FOCUS[type].length) ? STAGE_FOCUS[type] : null;
    if (st.isSupport && !declared) {
      problems.push(`${type}: 辅助塔未登记 STAGE_FOCUS —— 它伤害为 0，进阶会完全空转`);
      continue;
    }
    if (st.isSupport && focus.indexOf('damage') >= 0) {
      problems.push(`${type}: 辅助塔的进阶焦点是 'damage'，但它的伤害是 0 —— 等于没进阶`);
    }
    for (const attr of focus) {
      if (!STAGE_TABLES[attr]) problems.push(`${type}: 焦点属性 ${attr} 没有对应的放大表`);
      if (!STAGE_ATTR_META[attr]) problems.push(`${type}: 焦点属性 ${attr} 缺少展示元信息`);
    }
  }
  return problems;
}

module.exports = {
  MAX_STAGE,
  STAGE_TABLES,
  STAGE_FOCUS,
  DEFAULT_FOCUS,
  STAGE_ATTR_META,
  clampStage,
  focusOf,
  bonusPercent,
  bonusPercentForType,
  multiplier,
  attrMeta,
  gainText,
  audit,
};
