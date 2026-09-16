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
const { CODEX } = require('./config');

// ---------- 属性键 ----------
const ATTR = {
  DAMAGE: 'damage',
  ATTACK_SPEED: 'attackSpeedMultiplier',
  ATTACK_INTERVAL: 'attackInterval',
  AURA_POWER: 'auraPower',   // 辅助塔光环强度（虚拟属性，非 TOWER_STATS 原生字段）
  RANGE: 'range',
  HP: 'hp',
};

// ---------- 来源分类（决定颜色语义与明细前缀）----------
const SOURCE = {
  LEVEL: 'level',     // 等级加成（合成等级，每级 +10%）
  STAGE: 'stage',     // 阶段增幅（进阶 1/2/3 星）
  CODEX: 'codex',     // 图签等级加成（每级 +6%，跨局永久）
  AURA: 'aura',       // 光环增益（正值）
  DEBUFF: 'debuff',   // 负面效果（负值）
};

const SOURCE_LABEL = {
  [SOURCE.LEVEL]: '等级',
  [SOURCE.STAGE]: '阶段',
  [SOURCE.CODEX]: '图签',
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
  const base = {
    damage: st.damage || 0,
    attackSpeedMultiplier: st.attackSpeedMultiplier || 0,
    attackInterval: st.attackInterval || 0,
    range: st.range || 0,
    hp: st.hp || 0,
    auraPower: (st.supportBuff && st.supportBuff.attackSpeedMultiplier) || 0,
  };

  // ================= 3. 最终值 =================
  const damageMult = percentMultiplier(sources, ATTR.DAMAGE);
  const finalDamage = Math.max(0, Math.floor(base.damage * damageMult));

  const speedPoints = pointsSum(sources, ATTR.ATTACK_SPEED);
  const finalSpeed = Math.max(1, base.attackSpeedMultiplier + speedPoints);

  const finalInterval = (base.attackInterval > 0 && finalSpeed > 0)
    ? base.attackInterval / (finalSpeed / 100)
    : base.attackInterval;

  const auraMult = percentMultiplier(sources, ATTR.AURA_POWER);

  const final = {
    damage: finalDamage,
    attackSpeedMultiplier: finalSpeed,
    attackInterval: finalInterval,
    range: base.range,
    hp: base.hp,
    auraPower: base.auraPower * auraMult,
  };

  // ================= 4. 附加值（绿字/红字的那一半）=================
  const bonus = {
    damage: final.damage - base.damage,
    attackSpeedMultiplier: final.attackSpeedMultiplier - base.attackSpeedMultiplier,
    attackInterval: final.attackInterval - base.attackInterval,
    auraPower: final.auraPower - base.auraPower,
    range: 0,
    hp: 0,
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
      baseText: `${round2(base.damage)}`,
      bonusText: signed(bonus.damage, ''),
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
  }

  // 光环强度（辅助塔）：25+50，阶段每星 +100%
  if (base.auraPower > 0) {
    rows.push({
      key: ATTR.AURA_POWER,
      label: '光环强度',
      baseText: `${round2(base.auraPower)}%`,
      bonusText: signed(bonus.auraPower, '%'),
      sign: Math.sign(bonus.auraPower),
      parts: percentParts(sources, ATTR.AURA_POWER),
    });
  }

  // 原生属性（无敌我时统称，作为兜底信息展示）
  if (isSupport) {
    rows.push({
      key: ATTR.RANGE, label: '光环范围',
      baseText: `${round2(base.range)}`, bonusText: '', sign: 0, parts: [],
    });
  } else {
    rows.push({
      key: ATTR.RANGE, label: '射程',
      baseText: `${round2(base.range)}`, bonusText: '', sign: 0, parts: [],
    });
  }
  rows.push({
    key: ATTR.HP, label: '生命',
    baseText: `${round2(base.hp)}`, bonusText: '', sign: 0, parts: [],
  });

  return rows;
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

module.exports = {
  ATTR,
  SOURCE,
  SOURCE_LABEL,
  BUFF_LABELS,
  buffMeta,
  stageText,
  collectTowerStats,
  collectAuras,
  percentParts,
  pointParts,
};
