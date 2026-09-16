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
//              —— 等级 +10%/级、阶段增幅 +100/200/400%，两者相乘而非相加
//   攻速倍率   final = base + Σ光环点数（点数可为负 = 减速）
//   攻击间隔   final = 原生间隔 ÷ (最终攻速 / 100)
//   光环强度   final = base × (1 + 阶段×100%)，与 applyTrapezoidAuras 一致
//
// 扩展方式：新增一类来源只要 push 一条 source 记录（见 SOURCE 常量），
//           面板会自动把它画成绿字/红字并列入明细，不需要改渲染代码。
// ============================================================================

const towerMod = require('./tower');
const meta = require('./meta');
const { CODEX, BALANCE } = require('./config');

// ---------- 属性键 ----------
const ATTR = {
  DAMAGE: 'damage',
  ATTACK_SPEED: 'attackSpeedMultiplier',
  ATTACK_INTERVAL: 'attackInterval',
  AURA_POWER: 'auraPower',   // 辅助塔光环强度（虚拟属性，非 TOWER_STATS 原生字段）
  RANGE: 'range',
  HP: 'hp',
  CRIT: 'critChance',        // 暴击率(%) —— 基础值 + 强化专属属性
  CRIT_MULT: 'critMult',     // 暴击伤害倍率（1.5 = 150%）
  PENETRATION: 'penetration', // 穿透（固定值）：抵扣敌人护甲
  EXPLOSION_DAMAGE: 'explosionDamage', // 圆塔二段爆炸的溅射伤害比例(%)
  EXPLOSION_RADIUS: 'explosionRadius', // 圆塔二段爆炸的覆盖半径
  ELITE_MULT: 'eliteMult',             // 六边塔：对精英及以上的伤害倍数（×N）
  PROJECTILE_SCALE: 'projectileScale', // 正方塔：弹道体积(%)（命中范围与之同步）
  SECTOR_ANGLE: 'sectorAngle',         // 扇塔：扇形半张角(°)
  STACK_MAX: 'stackMax',               // 长方塔：堆叠上限(层)
};

// ---------- 来源分类（决定颜色语义与明细前缀）----------
const SOURCE = {
  LEVEL: 'level',     // 等级加成（合成等级，每级 +10%）
  STAGE: 'stage',     // 阶段增幅（进阶 1/2/3 星）
  CODEX: 'codex',     // 图签等级加成（每级 +6%，跨局永久）
  ENHANCE: 'enhance', // 塔强化（局内花金币，只抬该塔的专属特殊属性，不给伤害）
  AURA: 'aura',       // 光环增益（正值）
  DEBUFF: 'debuff',   // 负面效果（负值）
};

const SOURCE_LABEL = {
  [SOURCE.LEVEL]: '等级',
  [SOURCE.STAGE]: '阶段',
  [SOURCE.CODEX]: '图签',
  [SOURCE.ENHANCE]: '强化',
  [SOURCE.AURA]: '光环',
  [SOURCE.DEBUFF]: '负面',
};

// buff 属性键 → 展示文案（光环明细用）
const BUFF_LABELS = {
  attackSpeedMultiplier: { name: '攻速', unit: '%' },
  damage:                { name: '攻击力', unit: '' },
  attackInterval:        { name: '攻击间隔', unit: '秒' },
  range:                 { name: '射程', unit: '' },
  hp:                    { name: '生命', unit: '' },
  critChance:            { name: '暴击率', unit: '%' },
  critMult:              { name: '暴击伤害', unit: '' },
  penetration:           { name: '穿透', unit: '' },
  explosionDamage:       { name: '二段爆炸伤害', unit: '%' },
  explosionRadius:       { name: '爆炸范围', unit: '' },
  auraPower:             { name: '光环强度', unit: '%' },
  eliteMult:             { name: '精英伤害倍率', unit: '倍' },
  projectileScale:       { name: '弹道体积', unit: '%' },
  sectorAngle:           { name: '扇面张角', unit: '°' },
  stackMax:              { name: '堆叠上限', unit: '层' },
};

// 强化专属属性 key → ATTR key（两者同名；这里显式列出，新增属性别漏登记）
const ENHANCE_ATTR_MAP = {
  critChance: ATTR.CRIT,
  critMult: ATTR.CRIT_MULT,
  penetration: ATTR.PENETRATION,
  attackSpeedMultiplier: ATTR.ATTACK_SPEED,
  range: ATTR.RANGE,
  hp: ATTR.HP,
  explosionDamage: ATTR.EXPLOSION_DAMAGE,
  explosionRadius: ATTR.EXPLOSION_RADIUS,
  auraPower: ATTR.AURA_POWER,
  eliteMult: ATTR.ELITE_MULT,
  projectileScale: ATTR.PROJECTILE_SCALE,
  sectorAngle: ATTR.SECTOR_ANGLE,
  stackMax: ATTR.STACK_MAX,
};

function buffMeta(key) {
  return BUFF_LABELS[key] || { name: key, unit: '' };
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

  // 1.2 阶段增幅：1/2/3 星 = +100 / +200 / +400%（3 星封顶）
  const stage = tower && tower.stage > 0 ? tower.stage : 0;
  const boost = tower ? (tower.attackPowerBoost || 0) : 0;
  if (boost > 0) {
    pushSource(sources, {
      attr: ATTR.DAMAGE,
      source: SOURCE.STAGE,
      label: `阶段增幅 ${stageText(stage)}`.trim(),
      kind: 'percent',
      percent: boost,
    });
  }
  // 辅助塔：阶段同时提升光环强度（+100%/星）
  if (isSupport && stage > 0) {
    pushSource(sources, {
      attr: ATTR.AURA_POWER,
      source: SOURCE.STAGE,
      label: `阶段增幅 ${stageText(stage)}`.trim(),
      kind: 'percent',
      percent: stage * 100,
    });
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

  // 1.35 塔强化（局内花金币，需 3★）
  //   专属特殊属性增量登记成点值来源（绿字），不混入 base.damage。
  //   但 3★ 阶段强化会给白字基础攻击力 +5%/级（见下方 section 2 原生值）。
  const enhanceLv = (tower && tower.enhanceLevel > 0) ? tower.enhanceLevel : 0;
  const enhanceAttrs = (tower && tower.enhanceAttrs) ? tower.enhanceAttrs : null;
  if (enhanceLv > 0 && enhanceAttrs) {
    for (const key of Object.keys(enhanceAttrs)) {
      const v = enhanceAttrs[key];
      if (!v) continue;
      const attr = ENHANCE_ATTR_MAP[key] || key;
      pushSource(sources, {
        attr: attr,
        source: SOURCE.ENHANCE,
        label: '强化 Lv.' + enhanceLv + ' · ' + buffMeta(key).name,
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
  // 3★ 强化塔：基础攻击力 +5%/级（白字，属于原生值范畴，不是绿字来源）
  const stage3EnhanceLv = (tower && tower.stage >= BALANCE.enhance.minStage) ? enhanceLv : 0;
  const rawBaseDamage = st.damage || 0;
  const whiteBonusDamage = stage3EnhanceLv > 0
    ? rawBaseDamage * (1 + stage3EnhanceLv * 0.05)
    : rawBaseDamage;
  const base = {
    damage: whiteBonusDamage,
    attackSpeedMultiplier: st.attackSpeedMultiplier || 0,
    attackInterval: st.attackInterval || 0,
    range: st.range || 0,
    hp: st.hp || 0,
    auraPower: (st.supportBuff && st.supportBuff.attackSpeedMultiplier) || 0,
    critChance: st.critChance || 0,
    critMult: st.critMult || BALANCE.critDamageDefaultMult,
    penetration: st.penetration || 0,
    explosionDamage: st.explosionRatio || 0,
    explosionRadius: st.explosionRadius || 0,
    eliteMult: st.eliteMult || 0,
    projectileScale: st.projectileScale || 0,
    sectorAngle: st.sectorHalfAngle || 0,
    stackMax: st.stackMax || 0,
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
  // 暴击伤害：倍率 × Π(1 + 百分比来源/100)
  const finalCritMult = Math.max(1, base.critMult * percentMultiplier(sources, ATTR.CRIT_MULT));
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

  const final = {
    damage: finalDamage,
    attackSpeedMultiplier: finalSpeed,
    attackInterval: finalInterval,
    range: finalRange,
    hp: finalHp,
    auraPower: (base.auraPower + auraPoints) * auraMult,
    critChance: finalCrit,
    critMult: finalCritMult,
    penetration: finalPen,
    explosionDamage: finalExplDmg,
    explosionRadius: finalExplRadius,
    eliteMult: finalElite,
    projectileScale: finalProjScale,
    sectorAngle: finalSectorAngle,
    stackMax: finalStackMax,
  };

  // ================= 4. 附加值（绿字/红字的那一半）=================
  const bonus = {
    damage: final.damage - base.damage,
    attackSpeedMultiplier: final.attackSpeedMultiplier - base.attackSpeedMultiplier,
    attackInterval: final.attackInterval - base.attackInterval,
    auraPower: final.auraPower - base.auraPower,
    range: final.range - base.range,
    hp: final.hp - base.hp,
    critChance: final.critChance - base.critChance,
    critMult: final.critMult - base.critMult,
    penetration: final.penetration - base.penetration,
    explosionDamage: final.explosionDamage - base.explosionDamage,
    explosionRadius: final.explosionRadius - base.explosionRadius,
    eliteMult: final.eliteMult - base.eliteMult,
    projectileScale: final.projectileScale - base.projectileScale,
    sectorAngle: final.sectorAngle - base.sectorAngle,
    stackMax: final.stackMax - base.stackMax,
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
      effects.push({
        sign: v > 0 ? 1 : -1,
        source: `${aura.sourceName}${aura.sourceStage > 0 ? ' ' + stageText(aura.sourceStage) : ''}`,
        text: `${meta.name}${v > 0 ? '+' : ''}${v}${meta.unit}`,
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

  const signed = (v, unit) => (v > 0 ? `+${round2(v)}${unit}` : (v < 0 ? `${round2(v)}${unit}` : ''));

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
        baseText: `${round2(base.attackSpeedMultiplier)}%`,
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
      baseText: `${round2(base.critChance)}%`,
      bonusText: signed(bonus.critChance, '%'),
      sign: Math.sign(bonus.critChance),
      parts: pointParts(sources, ATTR.CRIT),
    });

    // 暴击伤害：暴击时的伤害倍率（1.5 → 150%）；强化可把它按百分比放大
    rows.push({
      key: ATTR.CRIT_MULT,
      label: '暴击伤害',
      baseText: `${Math.round(base.critMult * 100)}%`,
      bonusText: signed(bonus.critMult * 100, '%'),
      sign: Math.sign(bonus.critMult),
      parts: percentParts(sources, ATTR.CRIT_MULT),
    });

    // 穿透：固定值，抵扣敌人护甲
    rows.push({
      key: ATTR.PENETRATION,
      label: '穿透',
      baseText: `${round2(base.penetration)}`,
      bonusText: signed(bonus.penetration, ''),
      sign: Math.sign(bonus.penetration),
      parts: pointParts(sources, ATTR.PENETRATION),
    });

    // 二段爆炸（圆塔专属；强化"二段爆炸伤害 / 爆炸范围"在此显示）
    if (base.explosionRadius > 0) {
      rows.push({
        key: ATTR.EXPLOSION_DAMAGE,
        label: '二段爆炸伤害',
        baseText: `${round2(base.explosionDamage)}%`,
        bonusText: signed(bonus.explosionDamage, '%'),
        sign: Math.sign(bonus.explosionDamage),
        parts: pointParts(sources, ATTR.EXPLOSION_DAMAGE),
      });
      rows.push({
        key: ATTR.EXPLOSION_RADIUS,
        label: '爆炸范围',
        baseText: `${round2(base.explosionRadius)}`,
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
      baseText: `${round2(base.auraPower)}%`,
      bonusText: signed(bonus.auraPower, '%'),
      sign: Math.sign(bonus.auraPower),
      parts: percentParts(sources, ATTR.AURA_POWER).concat(pointParts(sources, ATTR.AURA_POWER)),
    });
  }

  // 射程 / 光环范围
  if (isSupport) {
    rows.push({
      key: ATTR.RANGE, label: '光环范围',
      baseText: `${round2(base.range)}`,
      bonusText: signed(bonus.range, ''), sign: Math.sign(bonus.range),
      parts: pointParts(sources, ATTR.RANGE),
    });
  } else {
    rows.push({
      key: ATTR.RANGE, label: '射程',
      baseText: `${round2(base.range)}`,
      bonusText: signed(bonus.range, ''), sign: Math.sign(bonus.range),
      parts: pointParts(sources, ATTR.RANGE),
    });
  }
  rows.push({
    key: ATTR.HP, label: '生命',
    baseText: `${round2(base.hp)}`,
    bonusText: signed(bonus.hp, ''), sign: Math.sign(bonus.hp),
    parts: pointParts(sources, ATTR.HP),
  });

  // ---- 强化专属属性行：原生值或强化增量只要有一项非 0 就显示 ----
  // （避免了给 16 种塔都塞 4 行 "0倍 / 0° / 0层" 的噪音）
  pushSpecialRow(rows, sources, { key: ATTR.ELITE_MULT, label: '精英伤害倍率', unit: '倍', base: base.eliteMult, bonus: bonus.eliteMult });
  pushSpecialRow(rows, sources, { key: ATTR.PROJECTILE_SCALE, label: '弹道体积', unit: '%', base: base.projectileScale, bonus: bonus.projectileScale });
  pushSpecialRow(rows, sources, { key: ATTR.SECTOR_ANGLE, label: '扇面张角', unit: '°', base: base.sectorAngle, bonus: bonus.sectorAngle });
  pushSpecialRow(rows, sources, { key: ATTR.STACK_MAX, label: '堆叠上限', unit: '层', base: base.stackMax, bonus: bonus.stackMax });

  return rows;
}

/** 专属属性行（基础值白字 + 强化增量绿字 + 来源明细） */
function pushSpecialRow(rows, sources, cfg) {
  if (!cfg.base && !cfg.bonus) return;
  rows.push({
    key: cfg.key,
    label: cfg.label,
    baseText: `${round2(cfg.base)}${cfg.unit}`,
    bonusText: signedNum(cfg.bonus, cfg.unit),
    sign: Math.sign(cfg.bonus),
    parts: pointParts(sources, cfg.key),
  });
}

/** 带符号的数值文本（0 返回空串；用于"基础值+加值"的加值一侧） */
function signedNum(v, unit) {
  if (!v) return '';
  return `${v > 0 ? '+' : ''}${round2(v)}${unit || ''}`;
}

/** 把百分比来源整理成明细子行 */
function percentParts(sources, attr) {
  return sources
    .filter((s) => s.attr === attr && s.kind === 'percent')
    .map((s) => ({ source: s.source, label: s.label, text: `${s.percent > 0 ? '+' : ''}${s.percent}%`, sign: s.sign }));
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
        text: `${s.value > 0 ? '+' : ''}${round2(s.value)}${meta.unit}`,
        sign: s.sign,
      };
    });
}

function round2(v) {
  return Math.round((v + Number.EPSILON) * 100) / 100;
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
  stageText,
  collectTowerStats,
  collectAuras,
  percentParts,
  pointParts,
  round2,
  formatNum,
};
