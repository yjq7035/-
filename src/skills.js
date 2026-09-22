// ============================================================================
// 技能系统 —— src/skills.js
// ----------------------------------------------------------------------------
// 【固有技能】= 每种图形塔默认自带、且只属于它自己的那个技能。
//   玩家不学习、不选择：塔一放下它就生效 —— 所以叫"固有"。
//   玩家能对它做的只有两件事：
//     · 局内【强化】把技能等级抬一级（需先进阶到 3★，花金币，见 game_core.enhanceTower）
//     · 在图签里嵌【猫眼石】让技能等级 +1（跨局永久，见 gems.skillLevels）
//
// ★ 本系统的核心：**一个技能可以带多条效果**。
//   三角塔的固有技能「致命一击」= 暴击几率 + 暴击伤害，两条效果挂在同一个技能上、
//   共用同一个技能等级。强化一次 = 技能等级 +1 = 两条效果一起涨。
//   （历史版本把这两条拆成"两个技能"，于是玩家一次强化要在它们之间二选一 —— 那是错的。）
//
// ★ 技能等级从 Lv.1 起算（2026-09-18 定稿）：
//   塔一放下，它的固有技能就是 **Lv.1**。不存在"Lv.0"—— 那等于"技能没生效"，
//   与「固有技能一放下就生效」自相矛盾。【学习】上限 Lv.1 ~ Lv.6（默认 1 + 最多学习 5 次）；
//   宝石 / 十字塔共享给的【额外等级】不占这 5 次，当前等级可以超过 Lv.6（见下方取值口径）。
//
// 数据形状：
//   SKILLS[type] = {
//     id:      'tri_crit',      // 技能唯一键（强化选项 key / 强化落点记录 / 图标兜底）
//     name:    '致命一击',       // 技能名（技能槽第一行）
//     innate:  true,            // ★ 固有技能标记（当前全部为 true；留给"后天习得技能"扩展）
//     icon:    'critChance',    // 技能图标（缺省取首条效果的 key，见 iconOf）
//     desc:    '一句话机制说明',  // 技能说明（技能槽里按可用宽度换行显示）
//     effects: [                // ≥1 条效果；同一技能内 key 不许重复
//       { key:'critChance', name:'暴击几率', base:5, per:5, unit:'%', desc:'命中时触发暴击的概率' },
//       { key:'critDamage', name:'暴击伤害', base:10, per:10, unit:'%', desc:'暴击时额外增加的伤害' },
//     ],
//   }
//
// 取值口径（全项目唯一真源 —— 改这里就等于改战斗）：
//   学习等级 learned = clamp(局内强化次数, 0, 可学基数)   —— 0..5，只有花金币强化才涨
//   额外等级 extra   = 宝石等级 + 十字塔共享等级          —— ≥0，外部途径给的"地基"
//   当前等级 current = learned + extra                    —— 0 起，**真正生效**的技能等级
//   可学等级 cap     = extra + 可学基数(默认 5)           —— 这条技能最高能到的等级
//   当前值(等级 L)   = base + per × (L − 1)               —— 面板 / 技能槽 / 强化浮层展示
//   强化增量         = per × learned                      —— 写进 tower.enhanceAttrs，
//                                                           并由 tower.getEnhanceAttr
//                                                           叠加到战斗取值上（战斗侧只有这一个入口）
//   塔的实际数值 = TOWER_STATS 原生值 + 强化增量 ⇒ **Lv.1 显示的就是原生值本身**，
//   所以 base 必须与原生值相等，面板才不会撒谎。
//
// ⚠️ 2026-09-20 修正：额外等级**不再**与"学习额度"共用同一个上限。
//   宝石 / 十字塔共享堆出来的等级是"地基"，玩家还能在它之上再学 5 级 ——
//   0/5 → 宝石 +2 → 2/7 → 学满 → 7/7。历史上额外等级会吃掉那 5 次学习额度
//   （显示 2/5、顶到 5 就再也学不动，且超出 5 的等级战斗里不生效）。
//
// ⚠️ base 必须与 TOWER_STATS 里同名的原生值一致（战斗结算 = 原生 + per×n，若 base 与原生
//    不一致，面板显示的"当前值"就是假的）。原生里确实没有对应字段的属性（例如某些塔的
//    "光环强度"是虚拟属性因为它是从 supportBuff.attackSpeedMultiplier 读的），
//    才允许写 0 —— 那种情况战斗侧也只加 per×n，两边仍然自洽。
//    三角塔的"暴击伤害 base=10"是**真原生值**（TOWER_STATS.triangle.critDamage），
//    所以 getAttackProfile 必须把原生 critDamage 一并加进倍率，否则就是假数值。
//    probe-skill.js 的契约断言会逐塔核对这一条。
// ⚠️ **禁止 base=0**：固有技能 = "塔一放下就生效"，0 起点 = Lv.1 完全空转，
//    面板上就是一个坏掉的技能。base 一律取塔的真原生值；原生表里没有就补 TOWER_STATS
//    字段（不是把 base 写成 0 糊弄过去）。确实需要 0 起点的，登记进 ZERO_BASE_ALLOWED。
//    排查"技能显示 0"先问一句：**塔的 description 是不是已经承诺了这个能力？**
//    （箭形塔 description 写着"破坏目标 3 点抗性"，字段却漏了 → 白送一个空转技能。）
//
// 依赖方向：skills → config（上限）/ gems（宝石等级）。**gems 绝不能反向 require skills**
//   否则成环。宝石侧需要技能名时，调用方直接用 skills.skillName(type)。
// ============================================================================

const { BALANCE, TOWER_STATS, TOWER_DEFS } = require('./config');
const gems = require('./gems');

/** UI 统一文案：面板 / 图签 / 强化浮层 / 宝石浮层都显示这一串，避免各写各的 */
const INNATE_LABEL = '固有技能';

/** 展示单位白名单（新增单位必须登记，否则 valueText 会拼出奇怪的字符串） */
const EFFECT_UNITS = ['', '%', '倍', '°', '层'];

/**
 * 已登记的属性键 → 是否真的参与战斗结算。
 * 新增技能效果时，key 必须在这里登记（否则 probe-skill 的契约断言会红）——
 * 这条就是为了拦住"技能槽显示得很漂亮、打起来一点没变"的历史事故。
 */
const EFFECT_KEYS = {
  critChance:            { active: true,  name: '暴击率',     unit: '%' },
  critDamage:            { active: true,  name: '暴击伤害',   unit: '%' },
  penetration:           { active: true,  name: '穿透',       unit: '' },
  break:                 { active: true,  name: '破解',       unit: '' },
  range:                 { active: true,  name: '射程',       unit: '' },
  attackSpeedMultiplier: { active: true,  name: '攻速',       unit: '%' },
  explosionDamage:       { active: true,  name: '二段爆炸伤害', unit: '%' },
  explosionRadius:       { active: true,  name: '爆炸范围',   unit: '' },
  eliteMult:             { active: true,  name: '精英伤害倍率', unit: '倍' },
  projectileScale:       { active: true,  name: '弹道体积',   unit: '%' },
  sectorAngle:           { active: true,  name: '扇面张角',   unit: '°' },
  stackMax:              { active: true,  name: '堆叠上限',   unit: '层' },
  innateStackCap:        { active: true,  name: '叠加上限',   unit: '%' },
  auraPower:             { active: true,  name: '光环强度',   unit: '%' },
  auraPenetration:       { active: true,  name: '穿透光环',   unit: '' },
  // 星形塔「星环祝福」：给周围我方塔加暴击几率与暴击伤害的光环。
  //   战斗侧消费方 = tower.getAuraOutput（先加技能增量、再乘进阶倍率发出），见 src/tower.js。
  auraCritChance:        { active: true,  name: '暴击光环',   unit: '%' },
  auraCritDamage:        { active: true,  name: '暴伤光环',   unit: '%' },
  // 十字塔「共享资源」：把自身宝石属性按该比例共享给上下左右四格的邻塔。
  //   战斗侧唯一消费方 = tower.getAuraOutput（乘进发出的光环数值），见 src/tower.js。
  shareRatio:            { active: true,  name: '共享比例',   unit: '%' },
  // 闪电塔「雷电链」：命中主目标后把电流传导给附近敌人。
  //   ⚠️ 这三条**真的参与战斗结算** —— 唯一消费方 = game_core.fireBoltChain
  //      （chainCount-1 个副目标、chainRange 半径内、副目标伤害 = 主目标 × chainRatio）。
  //      所以必须 active:true，而不是像 hp 那样登记成"暂不生效"。
  chainCount:            { active: true,  name: '传导数量',   unit: '' },
  chainRange:            { active: true,  name: '传导距离',   unit: '' },
  chainRatio:            { active: true,  name: '传导伤害比例', unit: '%' },
  // 椭圆塔「眩晕射击」：命中时按概率使目标眩晕1秒（不能移动+不能攻击）。
  //   战斗侧唯一消费方 = game_core.applyDamage 的 oval 分支（按技能等级 roll 点），
  //   眩晕状态机在 src/enemy.js（stunTimer / applyStun / isStunned）。
  stunChance:            { active: true,  name: '眩晕几率',   unit: '%' },
  // ⚠️ 生命（hp）：当前版本图形塔无敌，生命已从战斗结算里移除（TOWER_STATS 也没有 hp 字段）。
  //    保留该键仅为"登记在案但当前不生效"，等哪天把图形塔做成可被击毁，
  //    这里改成 active:true 并在 bonusStats 里接回 ATTR.HP 即可。
  hp:                    { active: false, name: '生命',       unit: '' },
};

// base = 0 的"白名单"（键 = `type.effectKey`）—— ★ 当前必须为空。
// ----------------------------------------------------------------------------
// 规则（2026-09-18 定稿）：**每条固有技能都必须有非零初始值**。
//   理由：固有技能的定义就是"塔一放下就生效"。base=0 意味着它在 Lv.1 完全空转 ——
//   面板上显示"激光穿透 0"、强化浮层显示"0 → 5"，玩家看到的就是一个坏掉的技能。
// 所以 base 一律取"塔的真原生值"（箭形塔破解 3 / 半圆塔穿透 3 / 星形塔·闪电塔暴击 5%）；
//   原生表里没有就先把它补进 TOWER_STATS，再让技能 base 对齐（不是反过来把 base 写成 0）。
// 这个白名单只是"逃生舱"：真出现必须 0 起点的设计，登记进来并写明理由；
//   audit() 第⑤项会对"active 且 base=0 且未登记"的键报红。
const ZERO_BASE_ALLOWED = {};

// ============================================================================
// 技能表（唯一真源）
// ============================================================================
const SKILLS = {
  // ---- 首批 5 种（开局阵容）----
  triangle: {
    id: 'tri_crit', name: '致命一击', innate: true, icon: 'critChance',
    desc: '命中时有几率打出暴击；升级会同时提高暴击几率与暴击伤害。',
    effects: [
      { key: 'critChance', name: '暴击几率', base: 5, per: 5, unit: '%', desc: '命中时触发暴击的概率' },
      // base = 10：三角塔原生就带「+10% 暴击伤害」（= TOWER_STATS.triangle.critDamage），
      // 不是"0 起步"。所以 Lv.1 的面板显示就是 10%，Lv.6 = 60%。
      // ⚠️ 这个 base 必须真的参与战斗结算（getAttackProfile 把原生 critDamage 一起加进倍率），
      //    否则就是"面板显示 10%、打起来没有"——本系统最忌讳的那种假数值。
      { key: 'critDamage', name: '暴击伤害', base: 10, per: 10, unit: '%', desc: '暴击时额外增加的伤害（直接加到暴击倍率上）' },
    ],
  },
  circle: {
    id: 'cir_splash', name: '二次爆炸', innate: true, icon: 'explosionDamage',
    desc: '命中的瞬间在原地炸开，对周围敌人造成溅射伤害。',
    effects: [
      { key: 'explosionDamage', name: '二段爆炸伤害', base: 25, per: 5, unit: '%', desc: '二次爆炸的溅射伤害占主伤害的比例' },
    ],
  },
  hexagon: {
    id: 'hex_elite', name: '精英猎手', innate: true, icon: 'eliteMult',
    desc: '专打硬骨头：对精英及以上的目标造成成倍伤害。',
    effects: [
      { key: 'eliteMult', name: '精英伤害倍率', base: 5, per: 1, unit: '倍', desc: '对精英及以上（含 BOSS）的伤害倍数' },
    ],
  },
  square: {
    id: 'sqr_laser', name: '巨型弹道', innate: true, icon: 'projectileScale',
    desc: '把冲锋激光变得更粗，命中范围随之变大。',
    effects: [
      { key: 'projectileScale', name: '弹道体积', base: 200, per: 20, unit: '%', desc: '放大冲锋弹道，命中范围（相对伤害范围）同步变大' },
    ],
  },
  semicircle: {
    id: 'semi_pierce', name: '激光穿透', innate: true, icon: 'penetration',
    desc: '激光直接洞穿抗性，不再被高护甲吃掉伤害。',
    effects: [
      // base = 3：半圆塔原生就带 3 点穿透（= TOWER_STATS.semicircle.penetration）
      { key: 'penetration', name: '激光穿透', base: 3, per: 5, unit: '', desc: '直接抵扣敌人抗性，激光不再被高抗性吃伤害' },
    ],
  },
  // ---- 进阶图形 ----
  trapezoid: {
    id: 'trap_aura', name: '攻速光环', innate: true, icon: 'auraPower',
    desc: '持续给周围的我方图形塔加攻速，自己不出手。',
    effects: [
      { key: 'auraPower', name: '光环强度', base: 25, per: 5, unit: '%', desc: '给周围我方塔的攻速光环再抬高一点' },
    ],
  },
  diamond: {
    id: 'dia_aura', name: '穿透光环', innate: true, icon: 'auraPenetration',
    desc: '持续给周围的我方图形塔加穿透，自己不出手。',
    effects: [
      { key: 'auraPenetration', name: '穿透光环', base: 5, per: 3, unit: '', desc: '给周围我方塔的穿透光环再抬高一点（每级 +3 穿透）' },
    ],
  },
  sector: {
    id: 'sec_fan', name: '广域扫射', innate: true, icon: 'sectorAngle',
    desc: '张开更大的扇形，一次扫掉一整片敌人。',
    effects: [
      { key: 'sectorAngle', name: '扇面张角', base: 45, per: 5, unit: '°', desc: '扇形半张角，越大扫过的面越宽' },
    ],
  },
  long_rectangle: {
    id: 'lr_stack', name: '叠层炮击', innate: true, icon: 'stackMax',
    desc: '死咬同一个目标越久，堆叠的层数上限越高。',
    effects: [
      { key: 'stackMax', name: '堆叠上限', base: 10, per: 2, unit: '层', desc: '同一目标可累积的最大堆叠层数' },
    ],
  },
  oval: {
    id: 'oval_stun', name: '眩晕射击', innate: true, icon: 'stunChance',
    desc: '命中时有概率使目标眩晕1秒（不能移动/攻击）；升级提高触发概率，眩晕时长固定不变。',
    effects: [
      { key: 'stunChance', name: '眩晕几率', base: 5, per: 5, unit: '%', desc: '命中时使目标眩晕1秒的概率（=5%×技能等级；眩晕时长固定1秒，不随等级变化）' },
    ],
  },
  star: {
    id: 'star_aura', name: '星环祝福', innate: true, icon: 'auraCritChance',
    desc: '持续给周围的我方图形塔加暴击几率与暴击伤害，自己不出手。',
    effects: [
      { key: 'auraCritChance', name: '暴击光环', base: 2, per: 1, unit: '%', desc: '给周围我方塔的暴击几率光环再抬高一点（每级 +1%）' },
      { key: 'auraCritDamage', name: '暴伤光环', base: 5, per: 2, unit: '%', desc: '给周围我方塔的暴击伤害光环再抬高一点（每级 +2%）' },
    ],
  },
  // 十字塔 2026-09 改为辅助塔：不再是"射速更凶"，而是决定"共享比例"。
  //   效果值 = 宝石属性有多少比例转给上下左右四格的相邻塔（见 tower.getAuraOutput）。
  //   base = 25 必须与 TOWER_STATS.cross.shareRatio 一致（NATIVE_GETTERS 已登记）。
  cross: {
    id: 'cross_share', name: '共享资源', innate: true, icon: 'shareRatio',
    desc: '把自身（嵌入宝石）的属性按比例共享给上下左右四格的相邻塔；升级提高共享比例。',
    effects: [
      { key: 'shareRatio', name: '共享比例', base: 25, per: 5, unit: '%', desc: '嵌入宝石的属性有多少比例共享给上下左右四格的相邻塔' },
    ],
  },
  arrow: {
    id: 'arrow_sunder', name: '碎甲箭', innate: true, icon: 'break',
    desc: '命中即破甲：直接削掉目标的一部分抗性。',
    effects: [
      // base = 3：箭形塔原生就带「破解 3 点」（= TOWER_STATS.arrow.break，
      // 也就是塔说明里那句"破坏目标 3 点抗性"）。不是"0 起步"。
      { key: 'break', name: '破解', base: 3, per: 3, unit: '', desc: '每级 +3 破解，直接抵消敌人抗性' },
    ],
  },
  bolt: {
    id: 'bolt_chain', name: '雷电链', innate: true, icon: 'chainCount',
    desc: '攻击主目标时，电流传导到附近敌人；升级可延长传导距离和数量。',
    effects: [
      { key: 'chainCount', name: '传导数量', base: 2, per: 1, unit: '', desc: '每次攻击传导到的目标总数（含主目标）' },
      { key: 'chainRange', name: '传导距离', base: 75, per: 15, unit: '', desc: '电流从主目标传导到副目标的距离（像素）' },
      { key: 'chainRatio', name: '传导伤害比例', base: 75, per: 5, unit: '%', desc: '副目标伤害 = 主目标 × 这个比例（每级 +5%）' },
    ],
  },
  // ---- 第三批扩展：平行塔 ----
  // 固有技能「连续射击」的实现见 game_core.updateTowers 的 parallel 分支：
  //   · 每发必定换一个不同目标下手；
  //   · 场上只剩同一个目标可打时，每次攻击叠加 innateStackStep 点攻速，上限 innateStackCap。
  parallel: {
    id: 'par_chain', name: '连续射击', innate: true, icon: 'innateStackCap',
    desc: '每发必定换一个不同的敌人下手；被逼着连打同一个目标时出手越来越快。',
    effects: [
      { key: 'innateStackCap', name: '叠加上限', base: 100, per: 20, unit: '%', desc: '被迫连续攻击同一目标时，攻速最多能叠到多少（每次攻击 +10%）' },
    ],
  },
};

// ============================================================================
// 查询
// ============================================================================

/**
 * 该塔型的固有技能列表（**数组**，当前恒 0 或 1 条）。
 * 刻意返回数组：面板/图签都是"一个技能一个槽"，将来出现"固有 + 后天习得"两条技能时，
 * 往 SKILLS[type] 加就行，UI 不用改。
 */
function getSkills(type) {
  const sk = type ? SKILLS[type] : null;
  if (!sk) return [];
  return [sk];
}

/** 该塔型的固有技能（单条；没有则 null）—— 语义别名，读代码时更直白 */
function getInnateSkill(type) {
  return (type && SKILLS[type]) || null;
}

/** 有没有登记固有技能 */
function hasSkill(type) {
  return !!getInnateSkill(type);
}

/** 技能名（无技能返回空串，调用方可以无脑拼字符串） */
function skillName(type) {
  const sk = getInnateSkill(type);
  return sk ? sk.name : '';
}

/** 技能说明 */
function skillDesc(type) {
  const sk = getInnateSkill(type);
  return sk ? (sk.desc || '') : '';
}

/** 技能唯一键（强化选项 key / 强化落点记录用） */
function skillId(type) {
  const sk = getInnateSkill(type);
  return sk ? sk.id : '';
}

/** 技能图标键（没显式配就用首条效果的键；再没有就退回通用星芒） */
function iconOf(skill) {
  if (!skill) return 'star';
  if (skill.icon) return skill.icon;
  const first = (skill.effects || [])[0];
  return (first && first.key) || 'star';
}

/**
 * 该塔型全部效果行（摊平；每条带上所属技能信息）。
 * 战斗侧 / 属性面板 / 强化浮层都从这里取，避免各自去翻 SKILLS 的结构。
 */
function getEffects(type) {
  const sk = getInnateSkill(type);
  if (!sk) return [];
  return (sk.effects || []).map((e) => Object.assign({}, e, {
    skillId: sk.id,
    skillName: sk.name,
    skillDesc: sk.desc || '',
    innate: !!sk.innate,
  }));
}

/** 按属性键找该塔型的效果行（找不到返回 null） */
function findEffect(type, key) {
  if (!key) return null;
  const list = getEffects(type);
  for (const e of list) if (e.key === key) return e;
  return null;
}

/** 全部塔型的属性键并集（去重；给"哪些属性由技能驱动"这类全局检查用） */
function allEffectKeys() {
  const set = {};
  for (const type of Object.keys(SKILLS)) {
    for (const e of (SKILLS[type].effects || [])) set[e.key] = true;
  }
  return Object.keys(set);
}

/** 属性键是否登记过 / 是否真的参与战斗结算 */
function effectKeyMeta(key) {
  return EFFECT_KEYS[key] || null;
}

// ============================================================================
// 等级与取值
// ----------------------------------------------------------------------------
// 三套口径必须分清（历史上混用会凭空多送一级）：
//   【学习次数 learned】0 起，0..5 —— 存盘的就是它（tower.enhanceLevel），只有花金币才涨
//   【生效次数 times】  0 起，无上限 —— 学习 + 额外（宝石 / 十字塔共享），战斗取值看它
//   【技能等级 Lv】     1 起 —— 只用于展示与取值基数，Lv = LEVEL_BASE + 生效次数
// ============================================================================

/** 技能默认等级：塔一放下就是 Lv.1（不是 Lv.0）—— 2026-09-18 定稿 */
const LEVEL_BASE = 1;

/** 局内最多能学几次（= config.BALANCE.enhance.maxLevel，花金币逐次 +1） */
const MAX_ENHANCE_TIMES = BALANCE.enhance.maxLevel;

/**
 * 【学习等级】的上限（默认 5）= 默认等级 1 + 最多 5 次学习 = Lv.6。
 * ⚠️ 它**只是学习上限**，不是技能等级上限：额外等级（宝石 / 十字塔共享）另算，
 *    所以"当前等级"可以远超 6（见 currentLevel / learnableCap）。
 */
const MAX_LEVEL = LEVEL_BASE + MAX_ENHANCE_TIMES;

/**
 * 把【学习次数】夹进 [0, MAX_ENHANCE_TIMES]。
 * ⚠️ 这是"学习次数"口径（0 起，存档里 tower.enhanceLevel 就是它）——
 *    别把【技能等级】（1 起）喂进来，那会凭空多送一级；
 *    也别拿它去夹【生效次数】（= 学习 + 额外），那会把宝石 / 共享的等级吃掉。
 */
function clampEnhanceTimes(times) {
  const n = Number(times);
  if (!isFinite(n) || n <= 0) return 0;
  return Math.min(MAX_ENHANCE_TIMES, n);
}

/** 把【技能等级】夹进 [1, MAX_LEVEL]；越界/非法输入一律当合法值处理 */
function clampLevel(level) {
  const lv = Number(level);
  if (!isFinite(lv) || lv <= LEVEL_BASE) return LEVEL_BASE;
  return Math.min(MAX_LEVEL, lv);
}

/**
 * 技能等级 → 生效次数（Lv.1 → 0、Lv.6 → 5）：base 之上要乘 per 的那一份。
 * ⚠️ 这里**不夹 MAX_LEVEL**：额外等级（宝石 / 十字塔共享）可以超过"学习上限 5"，
 *    夹了就会"技能槽写着 8/13、数值却只有 6 级的"。学习上限由 baseLearnCap 管。
 */
function levelToTimes(level) {
  const lv = Number(level);
  if (!isFinite(lv) || lv <= LEVEL_BASE) return 0;
  return Math.floor(lv) - LEVEL_BASE;
}

/** 已满级？（满了既不能再强化，也不该再报价） */
function isMaxLevel(level) {
  return clampLevel(level) >= MAX_LEVEL;
}

/** 下一级；已满级时原地不动（否则界面会写出 Lv.7 这种不存在的等级） */
function nextLevel(level) {
  return Math.min(MAX_LEVEL, clampLevel(level) + 1);
}

/**
 * 宝石提供的技能等级（猫眼石 +1 级/颗）。
 * 走 gems.skillLevels —— 宝石挂在塔型上（跨局永久），所以只需要 type。
 * setGemLevelProvider 允许上层（测试 / 特殊场景）替换这个来源。
 */
let gemLevelProvider = null;
function setGemLevelProvider(fn) {
  gemLevelProvider = (typeof fn === 'function') ? fn : null;
}
function gemLevels(type) {
  if (gemLevelProvider) return Math.max(0, gemLevelProvider(type) || 0);
  return Math.max(0, gems.skillLevels(type) || 0);
}

/**
 * 塔的【生效技能等级次数】（0 起）= 学习等级 + 额外等级 —— 就是 currentLevel。
 * 战斗取值（bonusFor）与展示（levelText / 技能槽数值）都读这一份，两边不会各说各话。
 * ⚠️ 它**不夹 MAX_ENHANCE_TIMES**：额外等级（宝石 / 十字塔共享）是独立于"学习额度"
 *    的地基，可学等级 = 额外 + 5。历史上这里夹了 5，于是
 *      · 宝石 / 共享把 5 次学习额度吃光 → 玩家再也学不动（"2/7"永远到不了 7）；
 *      · "当前 8" 里超出 5 的那部分战斗里不生效 → 面板撒谎。
 */
function effectiveTimesOf(tower) {
  if (!tower) return 0;
  return currentLevel(tower, tower.type);
}

/**
 * 塔实例的【技能等级 Lv】= Lv.1 + 生效次数 —— 1 起，**没有上限**（额外等级可以超过 6）。
 * 只用于"Lv.N"这种展示文案（toast / 图签）；面板与技能槽显示的是 levelText（当前/可学）。
 */
function levelOf(tower) {
  return LEVEL_BASE + effectiveTimesOf(tower);
}

/** 预览（商店 / 图签，没有实体塔）时的等级 = Lv.1 + 宝石等级（学习是局内的，不跨局） */
function previewLevel(type) {
  return LEVEL_BASE + extraLevel(null, type);
}

// ============================================================================
// 等级口径（2026-09-20 定稿）：技能等级【显示】= "当前等级/可学等级"
// ----------------------------------------------------------------------------
// 规则：当前等级 = 额外等级 + 学习等级
//   · 学习等级 (learnedLevel)：玩家花金币在局内学出来的基础等级；
//                             0 起，0..可学基数（唯一真源 = tower.enhanceLevel）。
//   · 额外等级 (extraLevel)  ：宝石 / 十字塔共享等【外部途径】给的临时等级加成。
//   · 可学基数 (baseLearnCap)：玩家能"学"的次数上限（固定 5）—— 外部加成不修改它。
//   · 可学等级 (learnableCap)：= 额外等级 + 可学基数 = 这条技能【最高能到达的等级】。
//       ⚠️ 它不是固定 5。宝石 / 共享堆出来的等级是"地基"，玩家还能在其上再学 5 级 ——
//          十字塔共享 +11 级、自己从未学习时，正确显示是 "11/16"（曾被错误地压成 "11/5"）。
//   · 当前等级 (currentLevel)：= 额外等级 + 学习等级 —— 也是战斗实际生效的等级。
//
// ⚠️ 三处必须同源（别各写各的）：
//   · 展示：levelText = "当前/可学"；技能槽数值 = valueOf(effect, currentLevel)
//   · 战斗：bonusFor 的生效次数 = currentLevel（不夹 5）
//   · 学习门槛：canEnhance / 报价只数【学习等级】（额外等级不占学习额度）
// ============================================================================

/** 学习等级：局内花金币学出来的次数（0 起，夹在 [0, 可学基数]）。无实体塔（预览态）= 0。 */
function learnedLevel(tower) {
  if (!tower) return 0;
  const n = Number(tower.enhanceLevel);
  if (!isFinite(n) || n <= 0) return 0;
  return Math.min(baseLearnCap(tower.type), Math.floor(n));
}

/**
 * 额外等级：通过宝石 / 十字塔共享等外部途径获得的临时等级加成。
 * @param {object|null} tower 实体塔（提供共享光环读取）；预览态可传 null
 * @param {string} [type] 塔类型（预览态必须给，否则取 tower.type）
 */
function extraLevel(tower, type) {
  const t = type || (tower && tower.type);
  if (!t) return 0;
  const gem = gemLevels(t);
  const shared = tower ? auraBuff(tower, 'skillLevels') : 0;
  return Math.max(0, gem + shared);
}

/**
 * 当前等级 = 额外等级 + 学习等级 —— 也是战斗实际生效的等级（bonusFor 走同一份）。
 */
function currentLevel(tower, type) {
  return learnedLevel(tower) + extraLevel(tower, type);
}

/**
 * 可学基数：玩家在一条技能上能"学"的次数上限。固定值，外部加成（宝石 / 共享）绝不修改它。
 * 缺省 = 全局上限 MAX_ENHANCE_TIMES（5）；特定技能可在 SKILLS[type].learnCap 覆盖。
 * ⚠️ 别把它和下面 levelText 的分母（learnableCap）搞混：这个是不吃任何加成的基数。
 */
function baseLearnCap(type) {
  const sk = getInnateSkill(type);
  if (sk && typeof sk.learnCap === 'number' && sk.learnCap > 0) return sk.learnCap;
  return MAX_ENHANCE_TIMES;
}

/**
 * 可学等级（**显示口径**，即技能槽 / 面板 "当前/可学" 里的分母）
 *   = 额外等级 + 可学基数 = 这条技能【最高能到达的等级】。
 * 语义：宝石 / 十字塔共享给的那份等级是"地基"，玩家还能在它之上再学 5 级。
 *   例：十字塔共享 +11 级、玩家从未强化 → 当前 11、可学 16（显示 "11/16"）。
 * 允许两种调用：
 *   learnableCap(tower, type) —— 实体塔（额外含自身宝石 + 收到的共享）
 *   learnableCap(type)        —— 预览态（无实体塔；额外只含塔型宝石）
 */
function learnableCap(towerOrType, type) {
  let tower = null;
  let t = type;
  if (typeof towerOrType === 'string') {
    t = type || towerOrType;
  } else {
    tower = towerOrType || null;
    t = type || (tower && tower.type);
  }
  if (!t) return 0;
  return extraLevel(tower, t) + baseLearnCap(t);
}

/**
 * 技能等级显示文案 = "当前等级/可学等级"。
 * @example 无强化无宝石 → "0/5"；强化 2 次 → "2/5"；嵌 1 颗猫眼石 → "1/6"；
 *          十字塔共享 +11（从未强化）→ "11/16"
 */
function levelText(tower, type) {
  const t = type || (tower && tower.type);
  return `${currentLevel(tower, t)}/${learnableCap(tower, t)}`;
}

/** 效果当前值 = base + per × (等级 - 1)；Lv.1 时就是原生值本身 */
function valueOf(effect, level) {
  if (!effect) return 0;
  return effect.base + effect.per * levelToTimes(level);
}

/** 效果增量（写进 enhanceAttrs、叠加到战斗上的那份）= per × (等级 - 1) */
function bonusOf(effect, level) {
  if (!effect) return 0;
  return effect.per * levelToTimes(level);
}

function round2(v) {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/** 数值文案：倍率类走 ×N，其余直接拼单位（'30%' / '45°' / '12层' / '260'） */
function valueTextOf(effect, level) {
  if (!effect) return '';
  const v = round2(valueOf(effect, level));
  return effect.unit === '倍' ? `×${v}` : `${v}${effect.unit || ''}`;
}

/**
 * 技能效果放大系数（紫晶宝石「技能效果 +N%」）= 1 + N/100。
 * 作用于固有技能**每一条效果的当前值**（base + per × 次数），
 * ⚠️ 不是只放大强化增量 —— Lv.1 时增量为 0，只放大增量 = 宝石完全空转
 *    （历史事故：嵌了紫晶，面板上暴击几率 / 暴击伤害纹丝不动）。
 * 宝石挂在塔型上（跨局永久），所以只要给 type 就能算出来。
 */
function effectMultiplier(type) {
  if (!type) return 1;
  return 1 + (gems.bonusForType(type).skillEffectPercent || 0) / 100;
}

/** 技能效果的**实际生效值** = 当前值 × 技能效果系数（含紫晶宝石的放大） */
function effectiveValueOf(type, effect, level) {
  if (!effect) return 0;
  return valueOf(effect, level) * effectMultiplier(type);
}

/** 技能效果实际生效值的文案（技能槽显示用；单位口径与 valueTextOf 一致） */
function effectiveValueTextOf(type, effect, level) {
  if (!effect) return '';
  const v = round2(effectiveValueOf(type, effect, level));
  return effect.unit === '倍' ? `×${v}` : `${v}${effect.unit || ''}`;
}

/** 每级增量文案：'+5%' / '+1倍' / '+15' */
function gainTextOf(effect) {
  if (!effect) return '';
  return `+${round2(effect.per)}${effect.unit || ''}`;
}

/**
 * 「当前 → 下一级」文案：'5% → 10%'
 * ⚠️ 不夹 MAX_LEVEL：传进来的是【当前等级】（= 学习 + 额外，可超过学习上限 Lv.6），
 *    夹了会在高等级塔上写出"85% → 30%"这种倒挂。学习门槛由 canEnhance 单独把关。
 */
function stepTextOf(effect, level) {
  if (!effect) return '';
  const lv = Number(level);
  const cur = (isFinite(lv) && lv > LEVEL_BASE) ? Math.floor(lv) : LEVEL_BASE;
  return `${valueTextOf(effect, cur)} → ${valueTextOf(effect, cur + 1)}`;
}

// ---- 技能级（多条效果合起来）的文案 ----

/** 该技能当前值文案：单效果 = '30%'；多效果 = '暴击几率 30% · 暴击伤害 50%' */
function skillValueText(type, level, sep) {
  const list = getEffects(type);
  if (!list.length) return '';
  const parts = list.map((e) => (list.length > 1
    ? `${e.name} ${valueTextOf(e, level)}`
    : valueTextOf(e, level)));
  return parts.join(sep || ' · ');
}

/** 该技能每级总收益文案：'+5% · +10%'（单效果时就是 '+5%'） */
function skillGainText(type) {
  const list = getEffects(type);
  if (!list.length) return '';
  return list.map(gainTextOf).join(' · ');
}

/** 该技能每级总收益 + 属性名：'暴击几率 +5% · 暴击伤害 +10%' */
function skillGainLabel(type) {
  const list = getEffects(type);
  if (!list.length) return '';
  return list.map((e) => `${e.name} ${gainTextOf(e)}`).join(' · ');
}

/** 强化一次的整体变化：'暴击几率 5% → 10% · 暴击伤害 10% → 20%' */
function skillStepText(type, level) {
  const list = getEffects(type);
  if (!list.length) return '';
  return list.map((e) => stepTextOf(e, level)).join(' · ');
}

// ---- 塔实例上的技能加成（战斗口径的唯一入口）----

/**
 * 该塔某项技能属性的增量（叠加在 TOWER_STATS 原生值之上的那份）。
 *
 *   强化次数 n = clamp(强化等级 + 宝石等级)
 *   · key 是本塔技能里的某条效果 → 增量 = (base + per × n) × 技能效果系数 − base
 *     —— 也就是"实际生效值 − 原生值"，所以调用方照旧写 `原生值 + getEnhanceAttr(...)`
 *        就得到实际值。系数来自紫晶宝石（技能效果 +N%），对 base 与强化增量一视同仁，
 *        Lv.1 也照涨（只放大增量的话 Lv.1 会完全空转）。
 *     （「技能宝石」猫眼石也是从这里生效的：不需要任何额外分支，全项目取属性都走这一个口）
 *   · 其它 key → 照旧读 tower.enhanceAttrs（applyTo 写入的那份），没有就 0
 *
 * ⚠️ 别把第一条改回"只读 enhanceAttrs" —— 那样宝石加的技能等级会在战斗里蒸发。
 * ⚠️ 三角塔的两条效果（暴击几率 / 暴击伤害）都走第一条：一个技能、两条属性同时涨。
 */
function bonusFor(tower, key) {
  if (!tower || !key) return 0;
  const eff = findEffect(tower.type, key);
  if (eff) {
    // 该塔当前接收到的共享光环（十字塔「共享资源」把宝石里的
    // 猫眼石/紫晶石也一并转给邻塔）—— 数值由 game_core.syncTowerAuras 每帧快照到
    // tower.auraBuffs，战斗与面板读的是同一份，所以两边不会各说各话。
    //   技能等级 +N  → 已由 effectiveTimesOf 计入生效次数（= 学习 + 额外，不夹 5）
    //   技能效果 +N% → 与紫晶宝石同一档：系数相加（不是再乘一次）
    const auraPct = auraBuff(tower, 'skillEffectPercent');
    const times = effectiveTimesOf(tower);
    const mult = effectMultiplier(tower.type) + auraPct / 100;
    return (eff.base + eff.per * times) * mult - eff.base;
  }
  if (!tower.enhanceAttrs) return 0;
  return tower.enhanceAttrs[key] || 0;
}

/**
 * 塔当前接收到的某条共享光环数值（无则 0）。
 * ⚠️ 唯一写入方是 game_core.syncTowerAuras —— 别在别处往 tower.auraBuffs 上写。
 */
function auraBuff(tower, key) {
  const b = tower && tower.auraBuffs;
  if (!b) return 0;
  const v = Number(b[key]);
  return isFinite(v) ? v : 0;
}

/**
 * 把塔的强化等级重新结算成 enhanceAttrs（单一真源：先清空再按 per × 次数全量写入，
 * 等级回退也不会残留旧值）。多效果技能会把每一条效果都写进去。
 * ⚠️ 这里用的是【学习等级】（只数花金币学出来的次数）—— 额外等级（宝石 / 共享）不进
 *    这份存档字段，战斗侧由 bonusFor 现算，别写成 clampLevel / 生效次数。
 * @returns {object} tower.enhanceAttrs
 */
function applyTo(tower) {
  if (!tower) return {};
  tower.enhanceAttrs = {};
  const n = learnedLevel(tower);
  if (n <= 0) return tower.enhanceAttrs;
  for (const e of getEffects(tower.type)) {
    tower.enhanceAttrs[e.key] = e.per * n;
  }
  return tower.enhanceAttrs;
}

// ============================================================================
// 强化选项（强化浮层 / game_core.enhanceTower 共用）
// ----------------------------------------------------------------------------
// 一个【技能】= 一个选项（不是一条属性 = 一个选项）。所以三角塔在浮层里只有一张卡，
// 卡上把该技能的全部效果逐条列出来 —— 玩家强化的是技能，不是某一条属性。
// ============================================================================

/** 技能定义 → 浮层选项 */
function skillToOption(sk) {
  return {
    id: sk.id,
    key: sk.id,                     // 兼容旧字段名（强化落点记录 / 按钮 id 都用 key）
    name: sk.name,
    innate: !!sk.innate,
    icon: iconOf(sk),
    desc: sk.desc || '',
    effects: (sk.effects || []).map((e) => ({
      key: e.key,
      name: e.name,
      base: e.base,
      per: e.per,
      unit: e.unit || '',
      desc: e.desc || '',
      gainText: gainTextOf(e),
    })),
    /** 本次强化的总收益文案（多效果用 · 连接） */
    gainText: (sk.effects || []).map(gainTextOf).join(' · '),
    /** 兼容旧字段：首条效果的增量与单位（单效果塔 = 完全等价） */
    perLevel: (sk.effects && sk.effects[0]) ? sk.effects[0].per : 0,
    unit: (sk.effects && sk.effects[0]) ? (sk.effects[0].unit || '') : '',
  };
}

/** 该塔型全部强化选项（一技能一项） */
function getOptions(type) {
  return getSkills(type).map(skillToOption);
}

/**
 * 按 key 取强化选项。key 可以是【技能 id】或【效果属性键】—— 后者是为了兼容
 * 老调用点（历史上一个属性就是一个选项）。找不到返回 null。
 */
function getOption(type, key) {
  const opts = getOptions(type);
  if (!opts.length) return null;
  if (!key) return opts[0];
  for (const o of opts) if (o.id === key || o.key === key) return o;
  for (const o of opts) if (o.effects.some((e) => e.key === key)) return o;
  return null;
}

// ============================================================================
// 契约自检（给探针用；运行时不调用 —— 别在游戏里跑这东西）
// ============================================================================

/**
 * 逐塔核对技能表的自洽性，返回问题清单（空数组 = 全部合格）。
 * 检查项：
 *   ① 每型都有唯一 id / 非空技能名 / innate 标记 / 说明
 *   ② 至少 1 条效果；同一技能内 key 不重复
 *   ③ 效果的 key 已登记在 EFFECT_KEYS；单位在白名单里；per 为正数
 *   ④ base 与该属性的原生值一致（不生效的键跳过，但必须登记为 active:false）
 *   ⑤ 生效中的效果 base=0 时，必须登记进 ZERO_BASE_ALLOWED（否则 Lv.1 技能空转）
 *   ⑥ 等级口径自洽：默认等级 = Lv.1（不是 0）、上限 = MAX_LEVEL（= 1 + 强化次数上限）
 */
function audit() {
  const problems = [];
  for (const type of Object.keys(TOWER_DEFS)) {
    const sk = SKILLS[type];
    if (!sk) { problems.push(`${type}: 没有登记固有技能`); continue; }
    if (!sk.id) problems.push(`${type}: 技能缺 id`);
    if (!sk.name) problems.push(`${type}: 技能缺 name`);
    if (!sk.innate) problems.push(`${type}: 固有技能必须 innate=true`);
    if (!sk.desc) problems.push(`${type}: 技能缺 desc（技能槽会空一行）`);
    const effs = sk.effects || [];
    if (!effs.length) problems.push(`${type}: 技能 ${sk.id} 没有任何效果`);
    const seen = {};
    for (const e of effs) {
      const tag = `${type}.${e.key}`;
      if (seen[e.key]) problems.push(`${tag}: 同一技能内属性键重复`);
      seen[e.key] = true;
      const meta = EFFECT_KEYS[e.key];
      if (!meta) { problems.push(`${tag}: 属性键未在 EFFECT_KEYS 登记`); continue; }
      if (EFFECT_UNITS.indexOf(e.unit || '') < 0) problems.push(`${tag}: 单位「${e.unit}」不在白名单`);
      if (!(e.per > 0)) problems.push(`${tag}: per 必须为正数（当前 ${e.per}）`);
      if (!meta.active) continue;   // 不生效的键（如 hp）只要求登记
      const native = nativeOf(type, e.key);
      if (native === undefined) { problems.push(`${tag}: 战斗侧没有这个原生值，base 无从对齐`); continue; }
      if (Math.abs(native - e.base) > 1e-6) {
        problems.push(`${tag}: base=${e.base} 与原生值 ${native} 不一致（面板会显示假数值）`);
      }
      // base=0 且没登记的 → Lv.1 时技能空转（与"固有技能一放下就生效"矛盾）
      if (e.base === 0 && !ZERO_BASE_ALLOWED[tag]) {
        problems.push(`${tag}: base=0 但未登记为「原生确实为 0」——Lv.1 时该技能没有任何效果`);
      }
    }
  }
  // 反向：登记了却没被任何技能使用
  for (const key of allEffectKeys()) {
    if (!EFFECT_KEYS[key]) problems.push(`${key}: 被技能使用但未登记`);
  }
  // 等级口径：默认等级必须是 1（不是 0），上限必须 = 1 + 强化次数上限
  if (LEVEL_BASE !== 1) problems.push(`LEVEL_BASE=${LEVEL_BASE}：技能默认等级必须为 Lv.1`);
  if (MAX_LEVEL !== LEVEL_BASE + BALANCE.enhance.maxLevel) {
    problems.push(`MAX_LEVEL=${MAX_LEVEL} 与「默认 1 + 强化上限 ${BALANCE.enhance.maxLevel}」不符`);
  }
  if (clampLevel(0) !== LEVEL_BASE || clampLevel(-3) !== LEVEL_BASE) {
    problems.push('clampLevel 把 0/负数夹到的不是默认等级 —— 会把"没强化"显示成 Lv.0');
  }
  if (nextLevel(MAX_LEVEL) !== MAX_LEVEL) {
    problems.push(`nextLevel(${MAX_LEVEL}) 越过了等级上限（面板会写出 Lv.${MAX_LEVEL + 1}）`);
  }
  return problems;
}

/**
 * 属性键 → 该塔型在 TOWER_STATS 里的原生值取法。
 * 字段名对不上的必须在这里显式登记（否则 audit 会以为"战斗侧没有这个原生值"）：
 *   auraPower        → 辅助塔的 supportBuff.attackSpeedMultiplier（虚拟属性）
 *   explosionDamage  → TOWER_STATS.explosionRatio（圆塔的溅射比例）
 *   sectorAngle      → TOWER_STATS.sectorHalfAngle（扇塔的半张角）
 *   break            → TOWER_STATS.break（箭形塔原生 3 点破解）
 */
const NATIVE_GETTERS = {
  auraPower: (st) => (st.supportBuff && st.supportBuff.attackSpeedMultiplier) || 0,
  explosionDamage: (st) => st.explosionRatio,
  auraPenetration: (st) => st.auraPenetration,
  auraCritChance: (st) => st.auraCritChance || 0,
  auraCritDamage: (st) => st.auraCritDamage || 0,
  sectorAngle: (st) => st.sectorHalfAngle,
  break: (st) => st.break || 0,
  // 十字塔「共享资源」的原生共享比例（TOWER_STATS.cross.shareRatio）
  shareRatio: (st) => st.shareRatio || 0,
  // 椭圆塔「眩晕射击」的原生眩晕几率（TOWER_STATS.oval.stunChance）
  stunChance: (st) => st.stunChance || 0,
};

/** 该属性在某塔型上的原生值（没有对应原生字段时返回 undefined → audit 报错） */
function nativeOf(type, key) {
  const st = TOWER_STATS[type];
  if (!st) return undefined;
  const getter = NATIVE_GETTERS[key];
  if (getter) return getter(st);
  return st[key];
}

module.exports = {
  INNATE_LABEL,
  EFFECT_UNITS,
  EFFECT_KEYS,
  ZERO_BASE_ALLOWED,
  NATIVE_GETTERS,
  SKILLS,
  // 查询
  getSkills,
  getInnateSkill,
  hasSkill,
  skillName,
  skillDesc,
  skillId,
  iconOf,
  getEffects,
  findEffect,
  allEffectKeys,
  effectKeyMeta,
  // 等级与取值
  LEVEL_BASE,
  MAX_LEVEL,
  MAX_ENHANCE_TIMES,
  clampEnhanceTimes,
  clampLevel,
  levelToTimes,
  isMaxLevel,
  nextLevel,
  setGemLevelProvider,
  gemLevels,
  effectiveTimesOf,
  levelOf,
  previewLevel,
  // 新口径：当前等级 = 额外等级 + 学习等级，显示 "当前等级/可学等级"
  learnedLevel,
  extraLevel,
  currentLevel,
  baseLearnCap,
  learnableCap,
  levelText,
  valueOf,
  bonusOf,
  valueTextOf,
  effectMultiplier,
  effectiveValueOf,
  effectiveValueTextOf,
  gainTextOf,
  stepTextOf,
  skillValueText,
  skillGainText,
  skillGainLabel,
  skillStepText,
  bonusFor,
  auraBuff,
  applyTo,
  // 强化选项
  getOptions,
  getOption,
  // 自检
  audit,
  nativeOf,
};
