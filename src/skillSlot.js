// ============================================================================
// 固有技能槽 —— src/skillSlot.js
// ----------------------------------------------------------------------------
// 需求：「固有技能全部都设计一个技能槽放入，左边是技能的图标，右边是介绍和
//        技能名 + Lv{等级}」
//
// 一个技能槽长这样：
//   ┌──────────────────────────────────────────┐
//   │ ┌────┐  暴击几率              Lv.2       │
//   │ │icon│  当前 15%（+5%/级）                │
//   │ └────┘  命中时触发暴击的概率（说明换行）    │
//   └──────────────────────────────────────────┘
//
// ⚠️ 两条铁律（踩过坑）：
//   ① 面板高度与绘制**必须共用本模块**：codex.getCodexLayout 与 renderer.drawTowerPanel
//      都调 slotHeight()/skillSlotsHeight()，绝不允许一边算高度、一边自己换行。
//   ② 说明文字一律换行（wrapLines），ENHANCE_SPECIAL 里最长一句 33 字，
//      按 12.5px 硬画会直接捅出面板右边界（历史事故：右超 116px）。
//
// Lv 的口径：tower 存在时 = 强化等级 + 宝石等级（towerMod.getEffectiveSkillLevel）；
//           预览（商店/图签，没有实体塔）时 = 宝石等级（珠子是跨局的，预览也该体现）。
// ============================================================================

const { ENHANCE_SPECIAL, TOWER_DEFS } = require('./config');
const theme = require('./theme');
const towerMod = require('./tower');

const { THEME, roundRectPath } = theme;

const SKILL_SLOT = {
  iconSize: 40,      // 图标方框边长
  padX: 10,          // 槽内左右内边距
  padY: 9,           // 槽内上下内边距
  gap: 10,           // 图标与文字之间的间距
  nameH: 19,         // 名称行高（技能名 + Lv）
  valH: 15,          // 当前值行高
  descLineH: 15,     // 说明文字行高
  descFont: '12px Arial',
  nameFont: 'bold 13px Arial',
  valFont: '11px Arial',
  radius: 10,        // 槽圆角
  outerGap: 8,       // 多个技能槽之间的间距
};

/** 图标方框边长（窄屏时按比例缩一点，避免文字被挤没） */
function iconSizeFor(contentW) {
  return Math.max(30, Math.min(SKILL_SLOT.iconSize, contentW * 0.18));
}

/** 说明文字最大可用宽度（槽内减去图标与内边距） */
function descMaxWidth(contentW) {
  return Math.max(60, contentW - iconSizeFor(contentW) - SKILL_SLOT.gap - SKILL_SLOT.padX * 2);
}

/** 换行（ctx 缺失时退化为不换行 —— 触摸早于首帧渲染时也能算出布局） */
function wrapLines(ctx, text, maxW) {
  if (!text) return [];
  if (!ctx || typeof theme.wrapTextLines !== 'function') return [text];
  const lines = theme.wrapTextLines(ctx, text, maxW, SKILL_SLOT.descFont);
  return lines.length ? lines : [text];
}

/**
 * 该塔型的固有技能列表。
 * 当前每塔恰好 1 条（config.ENHANCE_SPECIAL 一户一条），但这里刻意返回数组：
 * 需求说的是"固有技能**全部**都设计一个技能槽"，将来一塔多技能只要往这里加，
 * 面板与图签会自己多画几个槽，不需要再改布局代码。
 */
function getSkills(type) {
  const sp = type ? ENHANCE_SPECIAL[type] : null;
  if (!sp) return [];
  return [{
    key: sp.key,
    name: sp.name,
    desc: sp.desc || '',
    unit: sp.unit || '',
    per: sp.per,
    base: sp.base,
  }];
}

/** 属性值文案（倍率类走 ×N，其余直接拼单位） */
function valueText(unit, value) {
  return unit === '倍' ? `×${round2(value)}` : `${round2(value)}${unit}`;
}

/**
 * 组装技能槽（数据 + 预排版），渲染与高度计算共用同一个入口。
 * @param {object|null} ctx 画布（可为 null）
 * @param {string} type 塔类型
 * @param {object|null} tower 实体塔（预览时传 null）
 * @param {number} contentW 槽内可用内容宽
 */
function buildSkillSlots(ctx, type, tower, contentW) {
  const skills = getSkills(type);
  const out = [];
  const maxW = descMaxWidth(contentW);
  const gemLv = towerMod.getSkillGemLevels(type);
  for (const sk of skills) {
    const lv = tower
      ? towerMod.getEffectiveSkillLevel(tower)
      : towerMod.clampEnhanceLevel(gemLv);
    const cur = sk.base + sk.per * lv;
    const descLines = wrapLines(ctx, sk.desc, maxW);
    out.push({
      key: sk.key,
      name: sk.name,
      level: lv,
      levelText: `Lv.${lv}`,
      valueText: valueText(sk.unit, cur),
      perText: `+${sk.per}${sk.unit}/级`,
      descLines: descLines,
    });
  }
  return out;
}

/** 单个技能槽的高度（图标与文字取高者） */
function slotHeight(slot, contentW) {
  const textH = SKILL_SLOT.nameH + SKILL_SLOT.valH + slot.descLines.length * SKILL_SLOT.descLineH;
  const iconH = iconSizeFor(contentW);
  return SKILL_SLOT.padY * 2 + Math.max(textH, iconH);
}

/** 整块技能槽区域的总高（多个槽按 outerGap 分隔） */
function skillSlotsHeight(slots, contentW) {
  if (!slots.length) return 0;
  let h = 0;
  for (const s of slots) h += slotHeight(s, contentW);
  return h + (slots.length - 1) * SKILL_SLOT.outerGap;
}

/**
 * 绘制技能槽区域。
 * @param {object} ctx
 * @param {number} x 区域左上角
 * @param {number} y
 * @param {number} w 区域宽
 * @param {Array} slots buildSkillSlots 的结果
 * @param {object} [opts] { towerColor: 主色（槽描边微染）, touchHint: 是否画"点槽"提示 }
 */
function drawSkillSlots(ctx, x, y, w, slots, opts) {
  const o = opts || {};
  const tint = o.towerColor || THEME.accent.violet;
  let cy = y;
  for (const slot of slots) {
    const h = slotHeight(slot, w);
    drawOneSlot(ctx, x, cy, w, h, slot, tint);
    cy += h + SKILL_SLOT.outerGap;
  }
}

/** 单个技能槽：圆角底 + 左侧图标框 + 右侧名称/Lv/当前值/说明 */
function drawOneSlot(ctx, x, y, w, h, slot, tint) {
  ctx.save();

  // 槽底：淡色渐变（与"属性行"区分开，一眼看出这是一张卡片而不是一行文字）
  const grad = ctx.createLinearGradient(x, y, x, y + h);
  grad.addColorStop(0, 'rgba(179, 136, 255, 0.13)');
  grad.addColorStop(1, 'rgba(255, 255, 255, 0.03)');
  ctx.fillStyle = grad;
  roundRectPath(ctx, x, y, w, h, SKILL_SLOT.radius);
  ctx.fill();

  ctx.strokeStyle = tint === THEME.accent.violet
    ? 'rgba(179, 136, 255, 0.40)'
    : theme.shade(tint, -0.1, 0.42);
  ctx.lineWidth = 1.1;
  roundRectPath(ctx, x, y, w, h, SKILL_SLOT.radius);
  ctx.stroke();

  // 左侧图标框
  const iconS = iconSizeFor(w);
  const iconX = x + SKILL_SLOT.padX;
  const iconY = y + (h - iconS) / 2;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  roundRectPath(ctx, iconX, iconY, iconS, iconS, 8);
  ctx.fill();
  ctx.strokeStyle = 'rgba(179, 136, 255, 0.5)';
  ctx.lineWidth = 1;
  roundRectPath(ctx, iconX, iconY, iconS, iconS, 8);
  ctx.stroke();
  theme.drawSkillIcon(ctx, iconX + iconS / 2, iconY + iconS / 2, iconS * 0.32, slot.key, THEME.accent.violet);

  // 右侧文字
  const textX = iconX + iconS + SKILL_SLOT.gap;
  const textW = x + w - SKILL_SLOT.padX - textX;
  let ty = y + SKILL_SLOT.padY;

  // 行 1：技能名（左） + Lv.N（右）
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = SKILL_SLOT.nameFont;
  ctx.fillStyle = THEME.text.primary;
  ctx.fillText(slot.name, textX, ty + SKILL_SLOT.nameH / 2);

  ctx.textAlign = 'right';
  ctx.font = 'bold 12px Arial';
  ctx.fillStyle = slot.level > 0 ? THEME.accent.green : THEME.text.dim;
  ctx.fillText(slot.levelText, textX + textW, ty + SKILL_SLOT.nameH / 2);
  ty += SKILL_SLOT.nameH;

  // 行 2：当前值 + 每级增量
  ctx.textAlign = 'left';
  ctx.font = SKILL_SLOT.valFont;
  ctx.fillStyle = THEME.accent.green;
  const valStr = `当前 ${slot.valueText}`;
  ctx.fillText(valStr, textX, ty + SKILL_SLOT.valH / 2);
  const valW = ctx.measureText(valStr).width;
  ctx.fillStyle = THEME.text.off;
  ctx.font = '10px Arial';
  ctx.fillText(theme.ellipsize(ctx, `（${slot.perText}）`, Math.max(20, textW - valW - 4)), textX + valW + 4, ty + SKILL_SLOT.valH / 2);
  ty += SKILL_SLOT.valH;

  // 行 3+：说明（已换行，行数与 slotHeight 同源）
  ctx.textAlign = 'left';
  ctx.font = SKILL_SLOT.descFont;
  ctx.fillStyle = THEME.text.secondary;
  for (const line of slot.descLines) {
    ctx.fillText(line, textX, ty + SKILL_SLOT.descLineH / 2);
    ty += SKILL_SLOT.descLineH;
  }

  ctx.restore();
}

function round2(v) {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

module.exports = {
  SKILL_SLOT,
  iconSizeFor,
  descMaxWidth,
  getSkills,
  buildSkillSlots,
  slotHeight,
  skillSlotsHeight,
  drawSkillSlots,
};
