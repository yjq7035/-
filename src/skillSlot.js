// ============================================================================
// 固有技能槽 —— src/skillSlot.js
// ----------------------------------------------------------------------------
// 需求：「固有技能全部都设计一个技能槽放入，左边是技能的图标，右边是介绍和
//        技能名 + Lv{等级}」
//
// 一个技能槽 = **一个技能**（不是一条属性）。一个技能可以带多条效果，所以槽里
// 的数值行数随效果条数变化。三角塔的固有技能「致命一击」就是这样一张卡：
//
//   ┌──────────────────────────────────────────┐
//   │ ┌────┐  致命一击              1/5          │
//   │ │icon│  暴击几率 15%（+5%/级）             │
//   │ └────┘  暴击伤害 20%（+10%/级）            │
//   │         命中时…（说明换行）                 │
//   └──────────────────────────────────────────┘
//
// 第一行右侧那一段 = 技能等级，口径 "当前等级/可学等级"（唯一真源 skills.levelText）：
//   · 当前等级 = 学习等级（局内花金币强化，真源 tower.enhanceLevel）+ 额外等级（宝石 / 十字塔共享）
//   · 可学等级 = 额外等级 + 可学基数(5)
//   两者都由 skills 现算，本文件不存任何等级副本。
//
// ⚠️ 两条铁律（踩过坑）：
//   ① 面板高度与绘制**必须共用本模块**：codex.getCodexLayout 与 renderer.drawTowerPanel
//      都调 slotHeight()/skillSlotsHeight()，绝不允许一边算高度、一边自己换行。
//      数值行的行数也来自同一个 buildSkillSlots —— 加一条效果会自动长高，不用改布局。
//   ② 说明文字一律换行（wrapLines）；数值行按可用宽度 ellipsize，绝不硬画。
//
// 数值行的口径：当前等级（学习 + 额外，不夹上限）→ skills.effectiveValueTextOf；
//   预览（商店/图签，没有实体塔）时学习等级为 0，只剩宝石那份（珠子是跨局的，预览也该体现）。
// 技能表本身在 src/skills.js —— 本文件只负责"把技能画成一张卡"。
// ============================================================================

const theme = require('./theme');
const skills = require('./skills');

const { THEME, roundRectPath } = theme;

const SKILL_SLOT = {
  iconSize: 40,      // 图标方框边长
  padX: 10,          // 槽内左右内边距
  padY: 9,           // 槽内上下内边距
  gap: 10,           // 图标与文字之间的间距
  nameH: 19,         // 名称行高（技能名 + Lv）
  valH: 15,          // 单条效果行高
  descLineH: 15,     // 说明文字行高
  descFont: '12px Arial',
  nameFont: 'bold 13px Arial',
  valFont: '11px Arial',
  perFont: '10px Arial',
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

/** 该塔型的固有技能列表（转发技能系统；没有登记技能时返回空数组） */
function getSkills(type) {
  return skills.getSkills(type);
}

/**
 * 组装技能槽（数据 + 预排版），渲染与高度计算共用同一个入口。
 * @param {object|null} ctx 画布（可为 null）
 * @param {string} type 塔类型
 * @param {object|null} tower 实体塔（预览时传 null）
 * @param {number} contentW 槽内可用内容宽
 * @returns {Array<{id,name,innate,icon,level,levelText,learnLv,effects,descLines}>}
 *          learnLv = 局内已强化次数（0..5）；预览态为 null（没有局内强化这回事）
 */
function buildSkillSlots(ctx, type, tower, contentW) {
  const list = getSkills(type);
  const out = [];
  const maxW = descMaxWidth(contentW);
  for (const sk of list) {
    // 等级（新口径 2026-09-20）：显示 "当前等级/可学等级"
    //   当前等级 = 额外等级（宝石 / 十字塔共享）+ 学习等级（局内强化）
    //   可学等级 = 额外等级 + 可学基数(5) = 这条技能最高能到的等级
    //   —— 可学基数固定 5、外部加成绝不修改它；宝石 / 共享抬的是"地基"，
    //      玩家还能在其上再学 5 级，所以分母会跟着额外等级涨（0/5 → 2/7 → 8/13）。
    const learnLv = skills.learnedLevel(tower);   // 学习等级（0 起，局内强化次数）
    const lv = skills.currentLevel(tower, type);   // 当前等级 = 学习 + 额外
    out.push({
      id: sk.id,
      name: sk.name,
      innate: !!sk.innate,
      icon: skills.iconOf(sk),
      level: lv,
      levelText: skills.levelText(tower, type),   // "当前等级/可学等级"
      learnLv,
      // 数值行：一条效果一行（技能名 + 实际生效值 + 每级增量）
      // ⚠️ 实际生效值用 effectiveValueTextOf —— 会把紫晶宝石「技能效果 +N%」的放大
      //    一并算进去，与属性面板 / 战斗（tower.getEnhanceAttr）同口径，不会"槽里显示
      //    base、打起来又是另一个数"。
      effects: (sk.effects || []).map((e) => ({
        key: e.key,
        name: e.name,
        valueText: skills.effectiveValueTextOf(type, e, lv),
        perText: `${skills.gainTextOf(e)}/级`,
      })),
      descLines: wrapLines(ctx, sk.desc, maxW),
    });
  }
  return out;
}

/** 单个技能槽的高度（图标与文字取高者；数值行数随效果条数变化） */
function slotHeight(slot, contentW) {
  const n = Math.max(1, (slot.effects || []).length);
  const textH = SKILL_SLOT.nameH + n * SKILL_SLOT.valH + slot.descLines.length * SKILL_SLOT.descLineH;
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
 * @param {object} [opts] { towerColor: 主色（槽描边微染） }
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

/** 单个技能槽：圆角底 + 左侧图标框 + 右侧技能名/Lv + 每条效果一行 + 说明 */
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
  theme.drawSkillIcon(ctx, iconX + iconS / 2, iconY + iconS / 2, iconS * 0.32, slot.icon, THEME.accent.violet);

  // 右侧文字
  const textX = iconX + iconS + SKILL_SLOT.gap;
  const textW = x + w - SKILL_SLOT.padX - textX;
  let ty = y + SKILL_SLOT.padY;

  // 行 1：技能名（左） + "当前等级/可学等级"（右，加粗）
  //   levelText = skills.levelText = "当前/可学"；当前等级 > 0（有强化或宝石加成）
  //   才高亮成绿色，否则灰显。窄屏上技能名截断用的就是同一个 lvW —— 算宽与画字不许各写一份。
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  ctx.font = 'bold 12px Arial';
  const lvStr = slot.levelText;
  const lvW = ctx.measureText(lvStr).width;

  ctx.textAlign = 'left';
  ctx.font = SKILL_SLOT.nameFont;
  ctx.fillStyle = THEME.text.primary;
  ctx.fillText(theme.ellipsize(ctx, slot.name, Math.max(28, textW - lvW - 6)), textX, ty + SKILL_SLOT.nameH / 2);

  // 当前/可学 永远画：它才是这一槽最要紧的等级信息（当前含宝石/共享加成，可学固定）
  ctx.textAlign = 'right';
  ctx.font = 'bold 12px Arial';
  ctx.fillStyle = slot.level > 0 ? THEME.accent.green : THEME.text.dim;
  ctx.fillText(lvStr, textX + textW, ty + SKILL_SLOT.nameH / 2);
  ty += SKILL_SLOT.nameH;

  // 行 2+：每条效果一行 —— 属性名（暗） + 当前值（绿） + 每级增量（暗，放不下就省略）
  for (const eff of slot.effects) {
    const cyText = ty + SKILL_SLOT.valH / 2;
    ctx.textAlign = 'left';
    ctx.font = SKILL_SLOT.valFont;
    ctx.fillStyle = THEME.text.secondary;
    ctx.fillText(eff.name, textX, cyText);
    const nameW = ctx.measureText(eff.name).width;

    const valStr = ` ${eff.valueText}`;
    ctx.fillStyle = THEME.accent.green;
    ctx.fillText(valStr, textX + nameW, cyText);
    const usedW = nameW + ctx.measureText(valStr).width;

    const perStr = `（${eff.perText}）`;
    ctx.font = SKILL_SLOT.perFont;
    ctx.fillStyle = THEME.text.off;
    const perW = ctx.measureText(perStr).width;
    // 剩余宽度不够就不画 —— 宁可少一句解释，也不许压出槽外（历史事故：文字捅出面板）
    if (textW - usedW - 4 >= perW) {
      ctx.fillText(perStr, textX + usedW + 4, cyText);
    }
    ty += SKILL_SLOT.valH;
  }

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
