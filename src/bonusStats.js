// ============================================================================
// 附加属性系统（"绿字"加成）—— src/bonusStats.js
// ----------------------------------------------------------------------------
// 目标：把塔身上所有"非原生"的数值来源集中到一处，供任何 UI（当前是属性面板）
//       统一渲染成 "基础值+加值"：基础值白字，加值绿字（增益）/ 红字（减益）。
//
// 三个概念：
//   原生值 base   —— TOWER_STATS 里的初始数值，白字显示。
//   附加值 bonus  —— 由 等级 / 阶段增幅 / 光环(增益或减益) 产生的增量，绿字或红字。
//   最终值 final  —— 真正参与战斗结算的数值。
//
// 数值口径（与战斗逻辑严格一致，改这里必须同步 tower.js / game_core.js）：
//   攻击力     final = floor(base × Π(1 + 各百分比来源/100))
//              —— 等级 +10%/级、进阶增幅（见 src/stage.js），两者相乘而非相加
//   攻速倍率   final = base + Σ光环点数（点数可为负 = 减速）
//   攻击间隔   final = 原生间隔 ÷ (最终攻速 / 100)
//   光环强度   final = (base + 技能点值) × Π(1 + 各百分比来源/100)
//              —— 与 applyTrapezoidAuras 一致；进阶那一份的数值来自 src/stage.js
//   进阶增幅   **不在这里定义**：放大哪些属性（focus）与放大多少都在 src/stage.js，
//              本文件只负责把那个百分比登记成一条"阶段增幅"明细。
//
// 扩展方式：新增一类来源只要 push 一条 source 记录（见 SOURCE 常量），
//           面板会自动把它画成绿字/红字并列入明细，不需要改渲染代码。
// ============================================================================

const towerMod = require('./tower');
const meta = require('./meta');
const gems = require('./gems');
const skills = require('./skills');
const stageMod = require('./stage');
const { CODEX, BALANCE } = require('./config');

// ---------- 属性键 ----------
const ATTR = {
  DAMAGE: 'damage',
  ATTACK_SPEED: 'attackSpeedMultiplier',
  ATTACK_INTERVAL: 'attackInterval',
  AURA_POWER: 'auraPower',   // 辅助塔光环强度（虚拟属性，非 TOWER_STATS 原生字段）
  AURA_PENETRATION: 'auraPenetration', // 菱形塔：穿透光环（虚拟属性，原生值在 st.auraPenetration）
  RANGE: 'range',
  HP: null, // 已移除：图形塔无敌，不再显示生命
  CRIT: 'critChance',        // 暴击率(%) —— 基础值 + 技能/宝石增量
  CRIT_MULT: 'critMult',     // 暴击倍率（2.1 = 210%）；百分比来源乘算
  CRIT_DAMAGE: 'critDamage', // 暴击伤害(%) —— 技能「致命一击」的第二条效果；点值加算到倍率上
  PENETRATION: 'penetration', // 穿透（固定值）：抵扣敌人护甲
  BREAK: 'break',             // 破解（固定值）：额外抵消敌人抗性（箭形塔专属）
  EXPLOSION_DAMAGE: 'explosionDamage', // 圆塔二段爆炸的溅射伤害比例(%)
  EXPLOSION_RADIUS: 'explosionRadius', // 圆塔二段爆炸的覆盖半径
  ELITE_MULT: 'eliteMult',             // 六边塔：对精英及以上的伤害倍数（×N）
  PROJECTILE_SCALE: 'projectileScale', // 正方塔：弹道体积(%)（命中范围与之同步）
  SECTOR_ANGLE: 'sectorAngle',         // 扇塔：扇形半张角(°)
  STACK_MAX: 'stackMax',               // 长方塔：堆叠上限(层)
  INNATE_STACK_CAP: 'innateStackCap',  // 平行塔：固有技能「连续射击」的攻速叠加上限(%)
};

// ---------- 来源分类（决定颜色语义与明细前缀）----------
const SOURCE = {
  LEVEL: 'level',     // 等级加成（合成等级，每级 +10%）
  STAGE: 'stage',     // 阶段增幅（进阶 1/2/3 星）
  CODEX: 'codex',     // 图签等级加成（每级 +6%，跨局永久）
  ENHANCE: 'enhance', // 塔强化（局内花金币，只抬该塔的专属特殊属性，不给伤害）
  GEM: 'gem',         // 宝石（嵌入图签槽位，绑定固有技能，跨局永久）
  AURA: 'aura',       // 光环增益（正值）
  DEBUFF: 'debuff',   // 负面效果（负值）
};

const SOURCE_LABEL = {
  [SOURCE.LEVEL]: '等级',
  [SOURCE.STAGE]: '阶段',
  [SOURCE.CODEX]: '图签',
  [SOURCE.ENHANCE]: '强化',
  [SOURCE.GEM]: '宝石',
  [SOURCE.AURA]: '光环',
  [SOURCE.DEBUFF]: '负面',
};

// buff 属性键 → 展示文案（光环明细用）
const BUFF_LABELS = {
  attackSpeedMultiplier: { name: '攻速', unit: '%' },
  damage:                { name: '攻击力', unit: '' },
  attackInterval:        { name: '攻击间隔', unit: '秒' },
  range:                 { name: '射程', unit: '' },
  // hp:                  { name: '生命', unit: '' },  // 已移除
  critChance:            { name: '暴击率', unit: '%' },
  critMult:              { name: '暴击倍率', unit: '' },
  critDamage:            { name: '暴击伤害', unit: '%' },
  penetration:           { name: '穿透', unit: '' },
  break:                { name: '破解', unit: '' },
  explosionDamage:       { name: '二段爆炸伤害', unit: '%' },
  explosionRadius:       { name: '爆炸范围', unit: '' },
  auraPower:             { name: '光环强度', unit: '%' },
  auraPenetration:       { name: '穿透光环', unit: '' },
  eliteMult:             { name: '精英伤害倍率', unit: '倍' },
  projectileScale:       { name: '弹道体积', unit: '%' },
  sectorAngle:           { name: '扇面张角', unit: '°' },
  stackMax:              { name: '堆叠上限', unit: '层' },
  innateStackCap:        { name: '叠加上限', unit: '%' },
};

// 技能属性 key → ATTR key（两者同名；这里显式列出，新增技能效果别漏登记）
const ENHANCE_ATTR_MAP = {
  critChance: ATTR.CRIT,
  critMult: ATTR.CRIT_MULT,
  critDamage: ATTR.CRIT_DAMAGE,
  penetration: ATTR.PENETRATION,
  break: ATTR.BREAK,
  attackSpeedMultiplier: ATTR.ATTACK_SPEED,
  range: ATTR.RANGE,
  // hp: ATTR.HP,  // 已移除
  explosionDamage: ATTR.EXPLOSION_DAMAGE,
  explosionRadius: ATTR.EXPLOSION_RADIUS,
  auraPower: ATTR.AURA_POWER,
  auraPenetration: ATTR.AURA_PENETRATION,
  eliteMult: ATTR.ELITE_MULT,
  projectileScale: ATTR.PROJECTILE_SCALE,
  sectorAngle: ATTR.SECTOR_ANGLE,
  stackMax: ATTR.STACK_MAX,
  innateStackCap: ATTR.INNATE_STACK_CAP,
};

function buffMeta(key) {
  return BUFF_LABELS[key] || { name: key, unit: '' };
}

/**
 * 宝石明细标签：把"确实贡献了这一项加成"的宝石名字列出来。
 * 例：红宝石 + 翡翠 同时嵌着 → 攻击力那一行的明细写「宝石 · 红宝石」，
 *     暴击率那一行写「宝石 · 翡翠」，而不是笼统一句"宝石"。
 * @param {string[]} kinds 已嵌入的宝石种类
 * @param {(effect:object)=>boolean} pick 判断这颗宝石是否作用于本项
 */
function gemLabelFor(kinds, pick) {
  const names = [];
  for (const kind of kinds) {
    const def = gems.gemDef(kind);
    if (!def) continue;
    if (pick(def.effect || {})) names.push(def.name);
  }
  return names.length ? ('宝石 · ' + names.join('/')) : '宝石';
}

/**
 * 阶段星级文本（★ 图案在渲染层会被换成实心星，这里只用纯文本做明细标注）
 */
function stageText(stage) {
  if (!stage || stage <= 0) return '';
  return '★'.repeat(Math.min(stage, 3));
}

/**
 * 追加一条来源记录（自动归一化符号；数值为 0 的直接丢弃）
 */
function pushSource(list, src) {
  if (!src) return;
  if (src.kind === 'points' && !src.value) return;
  if (src.kind === 'percent' && !src.percent) return;
  const sign = src.kind === 'points' ? Math.sign(src.value) : Math.sign(src.percent);
  list.push(Object.assign({ sign: sign || 1 }, src));
}

/** 百分比来源连乘系数（攻击力口径：等级 × 阶段，相乘不相加） */
function percentMultiplier(sources, attr) {
  let m = 1;
  for (const s of sources) {
    if (s.attr === attr && s.kind === 'percent') m *= (1 + s.percent / 100);
  }
  return m;
}

/** 点值来源求和（攻速口径：光环点数直接相加，可正可负） */
function pointsSum(sources, attr) {
  let sum = 0;
  for (const s of sources) {
    if (s.attr === attr && s.kind === 'points') sum += s.value;
  }
  return sum;
}

/**
 * 从光环管理器收集目标塔当前生效的光环（可能为增益或减益，可多条）
 */
function collectAuras(game, tower) {
  if (!tower || !game || !game.auraManager) return [];
  const mgr = game.auraManager;
  if (typeof mgr.getAuras !== 'function') return [];
  return mgr.getAuras(tower.uniqueId) || [];
}

/**
 * 主入口：汇总一座塔的原生值 / 附加值 / 最终值 / 来源明细 / 面板行 / 生效效果
 *
 * @param {object} game  游戏实例（需含 auraManager，可为 null）
 * @param {object|null} tower 选中的塔（商店预览时传 null → 只显示原生属性）
 * @param {object} stats TOWER_STATS[type]
 * @param {string} [towerType] 塔类型（tower 为 null 时也要能查到图签等级，必须显式传）
 * @returns {{
 *   isSupport: boolean,
 *   base: Object, bonus: Object, final: Object,
 *   sources: Array, rows: Array, effects: Array, auras: Array
 * }}
 */
function collectTowerStats(game, tower, stats, towerType) {
  const st = stats || {};
  const isSupport = !!st.isSupport;
  const sources = [];

  // ================= 1. 收集所有非原生来源 =================
  // 1.1 等级加成：每级 +10%（大星后每级 +50%），只作用于攻击力
  const level = tower && tower.level > 0 ? tower.level : 0;
  if (level > 0) {
    const levelBonus = towerMod.getLevelAttackBonus(level);
    pushSource(sources, {
      attr: ATTR.DAMAGE,
      source: SOURCE.LEVEL,
      label: `等级 Lv.${level}`,
      kind: 'percent',
      percent: Math.round((levelBonus - 1) * 100),
    });
  }

  // 1.2 进阶（阶段）增幅 —— 真源 src/stage.js，本文件不再存第二份数字。
  //   放大的是该塔的【进阶焦点属性】：攻击塔 = 攻击力；辅助塔 = 它**真正发出**的那条光环
  //   （梯塔 → 光环强度 / 菱形塔 → 穿透光环）。
  //   ⚠️ 别退回"按 isSupport 硬挂一条 AURA_POWER"的老写法 —— 那会让菱形塔（发的是穿透）
  //      的面板写出「光环强度 +300%」这种假明细，而它自己的「穿透光环」行里反而
  //      一条阶段明细都没有（数字不动 + 明细撒谎，玩家看到的就是"进阶没用"）。
  const focusType = towerType || (tower && tower.type) || null;
  const stage = tower ? stageMod.clampStage(tower.stage) : 0;
  if (focusType && stage > 0) {
    for (const attr of stageMod.focusOf(focusType)) {
      const percent = stageMod.bonusPercent(attr, stage);
      if (!percent) continue;
      pushSource(sources, {
        attr: attr,
        source: SOURCE.STAGE,
        label: `阶段增幅 ${stageText(stage)}`.trim(),
        kind: 'percent',
        percent: percent,
      });
    }
  }

  // 1.3 图签等级加成（跨局永久）：每级 +6%
  //     · 普通塔 → 作用于攻击力（与 game_core.towerDamage 同口径）
  //     · 辅助塔 → 作用于光环强度（与 game_core.applyTrapezoidAuras 同口径）
  const tType = towerType || (tower && tower.type) || null;
  if (tType) {
    const codexLv = meta.codexLevel(tType);
    if (codexLv > 0) {
      pushSource(sources, {
        attr: isSupport ? ATTR.AURA_POWER : ATTR.DAMAGE,
        source: SOURCE.CODEX,
        label: `图签 Lv.${codexLv}`,
        kind: 'percent',
        percent: codexLv * CODEX.bonusPerLevel,
      });
    }
  }

  // 1.32 宝石（嵌入图签槽位、与固有技能绑定，跨局永久）
  //   与图签同档的"永久加成"，但走独立的 GEM 来源 —— 明细里能一眼看出这几点加成
  //   是珠子给的还是图签给的。
  //   技能宝石（skillLevels）折算成技能【每一条效果】的点值增量：per × 宝石等级，
  //   与 tower.getEnhanceAttr（= per × (强化 + 宝石)）严格同口径 —— 所以三角塔嵌一颗
  //   猫眼石，暴击几率与暴击伤害两条明细会同时出现。遍历技能效果而不是写死某一条，
  //   就是为了不让"多效果技能"漏掉第二条。
  const gemBonus = tType ? gems.bonusForType(tType) : null;
  // ---- 技能等级的"总额度"口径（唯一真源 src/skills.js）----
  // 强化次数与宝石等级**共用同一个上限**（BALANCE.enhance.maxLevel）：宝石给的等级会占用
  // 强化额度，最终生效的总额度 = clamp(强化次数 + 宝石等级)。
  // ⚠️ 面板明细必须按【夹取后】的额度登记，否则会"面板数字一直涨、打起来纹丝不动"
  //    （历史事故：E=4、宝石 +3 时面板报 40%、战斗只有 30%）。
  const enhTimes = (tower && tower.enhanceLevel > 0) ? skills.clampEnhanceTimes(tower.enhanceLevel) : 0;
  const gemTimes = (gemBonus && gemBonus.skillLevels) ? skills.clampEnhanceTimes(gemBonus.skillLevels) : 0;
  const totalTimes = skills.clampEnhanceTimes(enhTimes + gemTimes);
  const gemPart = Math.min(gemTimes, totalTimes);   // 宝石实际贡献的等级
  const enhPart = totalTimes - gemPart;             // 强化在宝石之上额外贡献的等级
  if (gemBonus && gemBonus.count > 0) {
    const kinds = gemBonus.kinds;
    const label = (pick) => gemLabelFor(kinds, pick);
    if (gemBonus.damagePercent) {
      pushSource(sources, { attr: ATTR.DAMAGE, source: SOURCE.GEM, label: label((e) => e.damagePercent), kind: 'percent', percent: gemBonus.damagePercent });
    }
    if (gemBonus.attackSpeedMultiplier) {
      pushSource(sources, { attr: ATTR.ATTACK_SPEED, source: SOURCE.GEM, label: label((e) => e.attackSpeedMultiplier), kind: 'points', value: gemBonus.attackSpeedMultiplier });
    }
    if (gemBonus.critChance) {
      pushSource(sources, { attr: ATTR.CRIT, source: SOURCE.GEM, label: label((e) => e.critChance), kind: 'points', value: gemBonus.critChance });
    }
    if (gemBonus.penetration) {
      pushSource(sources, { attr: ATTR.PENETRATION, source: SOURCE.GEM, label: label((e) => e.penetration), kind: 'points', value: gemBonus.penetration });
    }
    if (gemBonus.range) {
      pushSource(sources, { attr: ATTR.RANGE, source: SOURCE.GEM, label: label((e) => e.range), kind: 'points', value: gemBonus.range });
    }
    if (gemPart > 0 && tType) {
      for (const eff of skills.getEffects(tType)) {
        const attr = ENHANCE_ATTR_MAP[eff.key] || eff.key;
        pushSource(sources, {
          attr: attr,
          source: SOURCE.GEM,
          label: `${label((e) => e.skillLevels)} Lv.+${gemPart}`,
          kind: 'points',
          value: eff.per * gemPart,
        });
      }
    }
    // 技能效果 +N%（紫晶宝石）：放大固有技能**每一条效果**的当前值（base + per × 次数）。
    //   放大后的那份增量以点值来源登记到该效果对应的属性行上 —— 与战斗口径
    //   tower.getEnhanceAttr（= (base + per×n) × 系数 − base）严格同源，
    //   所以嵌一颗紫晶，暴击率行会多出 +0.8%（5% × 16%）、暴击伤害行多出 +1.6%（10% × 16%）。
    //   ⚠️ 别把它当成「攻击力 +N%」登记 —— 紫晶不碰攻击力（历史口径打架的根源）。
    if (gemBonus.skillEffectPercent && tType) {
      const times = totalTimes;        // 已夹上限的总额度（与战斗口径同源）
      const mult = 1 + gemBonus.skillEffectPercent / 100;
      for (const eff of skills.getEffects(tType)) {
        const keyMeta = skills.EFFECT_KEYS[eff.key];
        if (!keyMeta || !keyMeta.active) continue;   // 不生效的键（如生命）不登记
        const boost = (eff.base + eff.per * times) * (mult - 1);
        if (!boost) continue;
        pushSource(sources, {
          attr: ENHANCE_ATTR_MAP[eff.key] || eff.key,
          source: SOURCE.GEM,
          label: `${label((e) => e.skillEffectPercent)} 技能效果 +${gemBonus.skillEffectPercent}%`,
          kind: 'points',
          value: boost,
        });
      }
    }
  }

  // 1.35 塔强化（局内花金币，需 3★）
  //   技能等级带来的增量登记成点值来源（绿字），不混入 base.damage。
  //   一条技能的全部效果都会各出一条明细（三角塔 = 暴击几率 + 暴击伤害两行）。
  //   但 3★ 阶段强化会给白字基础攻击力 +5%/次（见下方 section 2 原生值）。
  //   ⚠️ 这里登记的是【强化自己贡献的那一份】enhPart（= 总额度 − 宝石那一份），
  //      与宝石明细相加后才等于战斗口径的总额度。宝石把额度吃满时 enhPart 会更小，
  //      这正是"面板不许超报"的落点。
  const enhanceAttrs = (tower && tower.enhanceAttrs) ? tower.enhanceAttrs : null;
  if (enhPart > 0 && enhanceAttrs) {
    for (const key of Object.keys(enhanceAttrs)) {
      const eff = skills.findEffect(tType, key);
      const v = eff ? eff.per * enhPart : (enhanceAttrs[key] || 0);
      if (!v) continue;
      const attr = ENHANCE_ATTR_MAP[key] || key;
      pushSource(sources, {
        attr: attr,
        source: SOURCE.ENHANCE,
        // 用【技能等级】（Lv.1 起）而不是强化次数，才能和技能槽的「Lv.x」对得上
        label: '强化 Lv.' + (skills.LEVEL_BASE + enhPart) + ' · ' + buffMeta(key).name,
        kind: 'points',
        value: v,
      });
    }
  }

  // 1.4 光环（增益 / 减益）：来自 auraManager，数值为负即负面效果
  const auras = collectAuras(game, tower);
  for (const aura of auras) {
    for (const key of Object.keys(aura.buffs || {})) {
      const v = aura.buffs[key];
      if (!v) continue;
      const remain = aura.remaining > 0 ? ` 剩${aura.remaining.toFixed(1)}s` : '';
      pushSource(sources, {
        attr: key,
        source: v > 0 ? SOURCE.AURA : SOURCE.DEBUFF,
        label: `${aura.sourceName}${stageText(aura.sourceStage) ? ' ' + stageText(aura.sourceStage) : ''}${remain}`,
        kind: 'points',
        value: v,
      });
    }
  }

  // ================= 2. 原生值 =================
  // 3★ 强化塔：基础攻击力 +5%/次（白字，属于原生值范畴，不是绿字来源）
  // ⚠️ 口径 = 【强化次数总额度】totalTimes = clamp(局内强化 + 宝石等级) —— 与
  //    game_core.towerDamage 严格同一份（那边直接调 towerMod.getEnhanceTimes）。
  //    历史上这里写的是 tower.enhanceLevel（0 起、不含宝石），而战斗侧写的是
  //    【技能等级 Lv】（1 起、含宝石）→ 面板与战斗永久差 5%，宝石加的等级面板更是
  //    完全看不见。两条线必须同源，别再各写各的。
  const stage3 = !!(tower && (tower.stage || 0) >= BALANCE.enhance.minStage);
  const rawBaseDamage = st.damage || 0;
  const whiteBonusDamage = (stage3 && totalTimes > 0)
    ? rawBaseDamage * (1 + totalTimes * 0.05)
    : rawBaseDamage;
  const base = {
    damage: whiteBonusDamage,
    attackSpeedMultiplier: st.attackSpeedMultiplier || 0,
    attackInterval: st.attackInterval || 0,
    range: st.range || 0,
    hp: st.hp || 0,
    auraPower: (st.supportBuff && st.supportBuff.attackSpeedMultiplier) || 0,
    auraPenetration: st.auraPenetration || 0,
    critChance: st.critChance || 0,
    // 暴击倍率的原生值 = 倍率 + 原生「+N% 暴击伤害」（三角塔 2.1 + 10% = 2.2）
    // 与 tower.getAttackProfile 的 baseNative 同一口径，改一处必须改另一处。
    critMult: (st.critMult || BALANCE.critDamageDefaultMult) + (st.critDamage || 0) / 100,
    break: st.break || 0,
    penetration: st.penetration || 0,
    explosionDamage: st.explosionRatio || 0,
    explosionRadius: st.explosionRadius || 0,
    eliteMult: st.eliteMult || 0,
    projectileScale: st.projectileScale || 0,
    sectorAngle: st.sectorHalfAngle || 0,
    stackMax: st.stackMax || 0,
    innateStackCap: st.innateStackCap || 0,
  };

  // ================= 3. 最终值 =================
  const damageMult = percentMultiplier(sources, ATTR.DAMAGE);
  const finalDamage = Math.max(0, base.damage * damageMult);

  const speedPoints = pointsSum(sources, ATTR.ATTACK_SPEED);
  const finalSpeed = Math.max(1, base.attackSpeedMultiplier + speedPoints);

  const finalInterval = (base.attackInterval > 0 && finalSpeed > 0)
    ? base.attackInterval / (finalSpeed / 100)
    : base.attackInterval;

  // 光环强度：原生值 + 强化点值（专属属性），再整体乘阶段/图签倍率
  // 与 game_core.applyTrapezoidAuras 同口径：(25 + 5×强化等级) × (1 + 阶段) × 图签倍率
  const auraPoints = pointsSum(sources, ATTR.AURA_POWER);
  const auraMult = percentMultiplier(sources, ATTR.AURA_POWER);

  // 暴击率 / 穿透：点值相加（可为负 = 负面效果）
  const finalCrit = Math.max(0, base.critChance + pointsSum(sources, ATTR.CRIT));
  const finalPen = Math.max(0, base.penetration + pointsSum(sources, ATTR.PENETRATION));
  // 暴击倍率（与 tower.getAttackProfile 同一条公式，改一处必须改另一处）：
  //   倍率 × Π(1 + 百分比来源/100)  ← 百分比放大（乘算）
  //         + Σ暴击伤害点值/100     ← 三角塔固有技能「致命一击」的第二条效果（加算，单位 %）
  const finalCritMult = Math.max(1,
    base.critMult * percentMultiplier(sources, ATTR.CRIT_MULT)
    + pointsSum(sources, ATTR.CRIT_DAMAGE) / 100);
  // 破解（箭形塔）：固定值相加，直接抵消敌人抗性
  const finalBreak = Math.max(0, base.break + pointsSum(sources, ATTR.BREAK));
  // 射程 / 生命：点值相加
  const finalRange = Math.max(0, base.range + pointsSum(sources, ATTR.RANGE));
  const finalHp = Math.max(1, base.hp + pointsSum(sources, ATTR.HP));
  // 圆塔二段爆炸：伤害比例与范围都是点值相加
  const finalExplDmg = Math.max(0, base.explosionDamage + pointsSum(sources, ATTR.EXPLOSION_DAMAGE));
  const finalExplRadius = base.explosionRadius > 0
    ? Math.max(0, base.explosionRadius + pointsSum(sources, ATTR.EXPLOSION_RADIUS))
    : 0;
  // 四项"强化专属"属性（六边塔/正方塔/扇塔/长方塔）：同样是点值相加
  const finalElite = Math.max(0, base.eliteMult + pointsSum(sources, ATTR.ELITE_MULT));
  const finalProjScale = Math.max(0, base.projectileScale + pointsSum(sources, ATTR.PROJECTILE_SCALE));
  const finalSectorAngle = Math.max(0, base.sectorAngle + pointsSum(sources, ATTR.SECTOR_ANGLE));
  const finalStackMax = Math.max(0, base.stackMax + pointsSum(sources, ATTR.STACK_MAX));
  const finalStackCap = Math.max(0, base.innateStackCap + pointsSum(sources, ATTR.INNATE_STACK_CAP));

  const final = {
    damage: finalDamage,
    attackSpeedMultiplier: finalSpeed,
    attackInterval: finalInterval,
    range: finalRange,
  // hp: finalHp,  // 已移除：图形塔无敌，不再显示
    auraPower: (base.auraPower + auraPoints) * auraMult,
    // 穿透光环（菱形塔）：口径 = (原生 + 技能点值) × 进阶倍率 —— 与战斗侧
    // towerMod.getAuraOutput 严格同源（那里也是 先加点值、再乘 stage.multiplier）。
    // ⚠️ 别顺手把图签也乘进来：穿透光环按既定设计**不吃图签**（倍率里只有阶段那一项）。
    auraPenetration: Math.max(0, (base.auraPenetration + pointsSum(sources, ATTR.AURA_PENETRATION))
      * percentMultiplier(sources, ATTR.AURA_PENETRATION)),
    critChance: finalCrit,
    critMult: finalCritMult,
    break: finalBreak,
    penetration: finalPen,
    explosionDamage: finalExplDmg,
    explosionRadius: finalExplRadius,
    eliteMult: finalElite,
    projectileScale: finalProjScale,
    sectorAngle: finalSectorAngle,
    stackMax: finalStackMax,
    innateStackCap: finalStackCap,
  };

  // ================= 4. 附加值（绿字/红字的那一半）=================
  const bonus = {
    damage: final.damage - base.damage,
    attackSpeedMultiplier: final.attackSpeedMultiplier - base.attackSpeedMultiplier,
    attackInterval: final.attackInterval - base.attackInterval,
    auraPower: final.auraPower - base.auraPower,
    auraPenetration: final.auraPenetration - base.auraPenetration,
    range: final.range - base.range,
    // hp: final.hp - base.hp,  // 已移除
    critChance: final.critChance - base.critChance,
    critMult: final.critMult - base.critMult,
    break: final.break - base.break,
    penetration: final.penetration - base.penetration,
    explosionDamage: final.explosionDamage - base.explosionDamage,
    explosionRadius: final.explosionRadius - base.explosionRadius,
    eliteMult: final.eliteMult - base.eliteMult,
    projectileScale: final.projectileScale - base.projectileScale,
    sectorAngle: final.sectorAngle - base.sectorAngle,
    stackMax: final.stackMax - base.stackMax,
    innateStackCap: final.innateStackCap - base.innateStackCap,
  };

  // ================= 5. 面板行（渲染就绪，渲染层不再算数）=================
  const rows = buildRows({ isSupport, base, bonus, final, sources });

  // ================= 6. 生效效果（光环增益 / 负面效果逐条列出）=================
  const effects = [];
  for (const aura of auras) {
    for (const key of Object.keys(aura.buffs || {})) {
      const v = aura.buffs[key];
      if (!v) continue;
      const meta = buffMeta(key);
      // ⚠️ 数值必须过 numText（最多 2 位小数）：光环值是浮点乘算出来的，
      //    25 × 1 × 1.12 = 28.000000000000004 —— 直接把裸数字插进模板串，
      //    这串尾巴就会原样印到面板的"生效效果"里。
      const n = round2(v);
      effects.push({
        // sign 取【四舍五入后】的值：负号要不要画，得看玩家真正看到的那个数
        sign: n < 0 ? -1 : 1,
        source: `${aura.sourceName}${aura.sourceStage > 0 ? ' ' + stageText(aura.sourceStage) : ''}`,
        text: `${meta.name}${n > 0 ? '+' : ''}${numText(n)}${meta.unit}`,
        remaining: Math.max(0, aura.remaining || 0),
      });
    }
  }

  return { isSupport, base, bonus, final, sources, rows, effects, auras };
}

/**
 * 组装面板属性行
 */
function buildRows(ctx) {
  const { isSupport, base, bonus, final, sources } = ctx;
  const rows = [];

  const signed = (v, unit) => (v > 0 ? `+${numText(v)}${unit}` : (v < 0 ? `${numText(v)}${unit}` : ''));

  if (!isSupport) {
    // 攻击力：50+50（+50 为等级/阶段带来的非原生增幅）
    rows.push({
      key: ATTR.DAMAGE,
      label: '攻击力',
      baseText: `${formatNum(base.damage)}`,
      bonusText: `+${formatNum(bonus.damage)}`,
      sign: Math.sign(bonus.damage),
      parts: percentParts(sources, ATTR.DAMAGE),
    });

    // 攻速倍率：100%+50%（+50% 来自光环）
    // 光环来源不在此重复列出——下方"生效效果"小节会给出出处与剩余时间。
    if (base.attackSpeedMultiplier > 0) {
      rows.push({
        key: ATTR.ATTACK_SPEED,
        label: '攻速',
        baseText: `${numText(base.attackSpeedMultiplier)}%`,
        bonusText: signed(bonus.attackSpeedMultiplier, '%'),
        sign: Math.sign(bonus.attackSpeedMultiplier),
        parts: [],
      });
    }

    // 攻击间隔：实际每 X 秒（受攻速加成影响 → 提速绿字 / 减速红字）
    if (base.attackInterval > 0) {
      const faster = bonus.attackInterval < -1e-6;
      const slower = bonus.attackInterval > 1e-6;
      rows.push({
        key: ATTR.ATTACK_INTERVAL,
        label: '攻击间隔',
        baseText: `每${final.attackInterval.toFixed(2)}秒`,
        bonusText: '',
        sign: 0,
        valueTint: faster ? 'buff' : (slower ? 'debuff' : ''),
        parts: [],
      });
    }

    // 暴击率：25%+5%（+5% 来自强化等级）
    rows.push({
      key: ATTR.CRIT,
      label: '暴击率',
      baseText: `${numText(base.critChance)}%`,
      bonusText: signed(bonus.critChance, '%'),
      sign: Math.sign(bonus.critChance),
      parts: pointParts(sources, ATTR.CRIT),
    });

    // 暴击伤害：暴击时的伤害倍率（210% = 2.1 倍）
    //   两条来源都要列：百分比放大（倍率类）+ 暴击伤害点值（三角塔技能的第二条效果）
    rows.push({
      key: ATTR.CRIT_MULT,
      label: '暴击伤害',
      baseText: `${Math.round(base.critMult * 100)}%`,
      bonusText: signed(bonus.critMult * 100, '%'),
      sign: Math.sign(bonus.critMult),
      parts: percentParts(sources, ATTR.CRIT_MULT).concat(pointParts(sources, ATTR.CRIT_DAMAGE)),
    });

    // 穿透：固定值，抵扣敌人护甲
    rows.push({
      key: ATTR.PENETRATION,
      label: '穿透',
      baseText: `${numText(base.penetration)}`,
      bonusText: signed(bonus.penetration, ''),
      sign: Math.sign(bonus.penetration),
      parts: pointParts(sources, ATTR.PENETRATION),
    });

    // 二段爆炸（圆塔专属；强化"二段爆炸伤害 / 爆炸范围"在此显示）
    if (base.explosionRadius > 0) {
      rows.push({
        key: ATTR.EXPLOSION_DAMAGE,
        label: '二段爆炸伤害',
        baseText: `${numText(base.explosionDamage)}%`,
        bonusText: signed(bonus.explosionDamage, '%'),
        sign: Math.sign(bonus.explosionDamage),
        parts: pointParts(sources, ATTR.EXPLOSION_DAMAGE),
      });
      rows.push({
        key: ATTR.EXPLOSION_RADIUS,
        label: '爆炸范围',
        baseText: `${numText(base.explosionRadius)}`,
        bonusText: signed(bonus.explosionRadius, ''),
        sign: Math.sign(bonus.explosionRadius),
        parts: pointParts(sources, ATTR.EXPLOSION_RADIUS),
      });
    }
  }

  // 光环强度（辅助塔）：25+50，阶段每星 +100%，强化再加点值
  if (base.auraPower > 0) {
    rows.push({
      key: ATTR.AURA_POWER,
      label: '光环强度',
      baseText: `${numText(base.auraPower)}%`,
      bonusText: signed(bonus.auraPower, '%'),
      sign: Math.sign(bonus.auraPower),
      parts: percentParts(sources, ATTR.AURA_POWER).concat(pointParts(sources, ATTR.AURA_POWER)),
    });
  }

  // 穿透光环（菱形塔）：原生值 + 技能增量，再乘进阶倍率
  //   —— 与 game_core.applyTrapezoidAuras / tower.getAuraOutput 同口径。
  // ⚠️ parts 必须**百分比与点值都列**：进阶是百分比来源，只列点值会让这一行
  //    有绿字却没有"阶段增幅"明细（数字涨了、玩家看不到为什么涨）。
  if (base.auraPenetration > 0) {
    rows.push({
      key: ATTR.AURA_PENETRATION,
      label: '穿透光环',
      baseText: `${numText(base.auraPenetration)}`,
      bonusText: signed(bonus.auraPenetration, ''),
      sign: Math.sign(bonus.auraPenetration),
      parts: percentParts(sources, ATTR.AURA_PENETRATION).concat(pointParts(sources, ATTR.AURA_PENETRATION)),
    });
  }

  // 射程 / 光环范围
  if (isSupport) {
    rows.push({
      key: ATTR.RANGE, label: '光环范围',
      baseText: `${numText(base.range)}`,
      bonusText: signed(bonus.range, ''), sign: Math.sign(bonus.range),
      parts: pointParts(sources, ATTR.RANGE),
    });
  } else {
    rows.push({
      key: ATTR.RANGE, label: '射程',
      baseText: `${numText(base.range)}`,
      bonusText: signed(bonus.range, ''), sign: Math.sign(bonus.range),
      parts: pointParts(sources, ATTR.RANGE),
    });
  }
  // rows.push({  // 已移除：图形塔无敌，不再显示生命
  //   key: ATTR.HP, label: '生命',
  //   baseText: `${numText(base.hp)}`,
  //   bonusText: signed(bonus.hp, ''), sign: Math.sign(bonus.hp),
  //   parts: pointParts(sources, ATTR.HP),
  // });

  // ---- 强化专属属性行：原生值或技能增量只要有一项非 0 就显示 ----
  // （避免了给 16 种塔都塞 4 行 "0倍 / 0° / 0层" 的噪音）
  pushSpecialRow(rows, sources, { key: ATTR.BREAK, label: '破解', unit: '', base: base.break, bonus: bonus.break });
  pushSpecialRow(rows, sources, { key: ATTR.ELITE_MULT, label: '精英伤害倍率', unit: '倍', base: base.eliteMult, bonus: bonus.eliteMult });
  pushSpecialRow(rows, sources, { key: ATTR.PROJECTILE_SCALE, label: '弹道体积', unit: '%', base: base.projectileScale, bonus: bonus.projectileScale });
  pushSpecialRow(rows, sources, { key: ATTR.SECTOR_ANGLE, label: '扇面张角', unit: '°', base: base.sectorAngle, bonus: bonus.sectorAngle });
  pushSpecialRow(rows, sources, { key: ATTR.STACK_MAX, label: '堆叠上限', unit: '层', base: base.stackMax, bonus: bonus.stackMax });
  pushSpecialRow(rows, sources, { key: ATTR.INNATE_STACK_CAP, label: '叠加上限', unit: '%', base: base.innateStackCap, bonus: bonus.innateStackCap });

  return rows;
}

/** 专属属性行（基础值白字 + 强化增量绿字 + 来源明细） */
function pushSpecialRow(rows, sources, cfg) {
  if (!cfg.base && !cfg.bonus) return;
  rows.push({
    key: cfg.key,
    label: cfg.label,
    baseText: `${numText(cfg.base)}${cfg.unit}`,
    bonusText: signedNum(cfg.bonus, cfg.unit),
    sign: Math.sign(cfg.bonus),
    parts: pointParts(sources, cfg.key),
  });
}

/** 带符号的数值文本（0 返回空串；用于"基础值+加值"的加值一侧） */
function signedNum(v, unit) {
  if (!v) return '';
  return `${v > 0 ? '+' : ''}${numText(v)}${unit || ''}`;
}

/** 把百分比来源整理成明细子行 */
function percentParts(sources, attr) {
  return sources
    .filter((s) => s.attr === attr && s.kind === 'percent')
    .map((s) => ({ source: s.source, label: s.label, text: `${s.percent > 0 ? '+' : ''}${numText(s.percent)}%`, sign: s.sign }));
}

/** 把点值来源整理成明细子行 */
function pointParts(sources, attr) {
  return sources
    .filter((s) => s.attr === attr && s.kind === 'points')
    .map((s) => {
      const meta = buffMeta(s.attr);
      return {
        source: s.source,
        label: s.label,
        text: `${s.value > 0 ? '+' : ''}${numText(s.value)}${meta.unit}`,
        sign: s.sign,
      };
    });
}

function round2(v) {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/**
 * 面板数值文案：**最多保留 2 位小数**（整数不写小数点，小数不留末尾的 0）。
 * ⚠️ 所有"实数"展示都必须走这里，不许直接把数字插进模板串：
 *    光环 / 倍率都是浮点乘算出来的，25 × 1 × 1.12 在 JS 里等于 28.000000000000004，
 *    直接 `${v}` 就把这串尾巴印到"生效效果"里了（玩家看到的就是乱码一样的长小数）。
 */
function numText(v) {
  return String(round2(v));
}

/** 数值格式化：整数显示整数，小数最多保留2位 */
function formatNum(v) {
  const n = round2(v);
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

module.exports = {
  ATTR,
  SOURCE,
  SOURCE_LABEL,
  BUFF_LABELS,
  ENHANCE_ATTR_MAP,
  buffMeta,
  gemLabelFor,
  stageText,
  collectTowerStats,
  collectAuras,
  percentParts,
  pointParts,
  round2,
  numText,
  formatNum,
};
