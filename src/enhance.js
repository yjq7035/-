// ============================================================================
// 强化（升级）确认浮层 —— src/enhance.js
// ----------------------------------------------------------------------------
// 入口：塔属性面板里的「强化」按钮（只有进阶到 3★ 的图形塔按钮才可用）。
// 内容：强化**不再发放任何伤害加成**，只把该塔的【固有技能】抬一级：
//       技能等级 +1 → 该技能的全部效果一起涨（当前值 = base + per × 等级）。
//       数值表在 src/skills.js —— 本文件只负责"把这次升级摆到玩家面前"。
// 交互：一次性确认 —— 点卡片＝立即强化并扣金币；点空白＝取消。
//       一个【技能】= 一张卡片（不是一条属性一张卡）：三角塔的「致命一击」只有一张卡，
//       卡上把暴击几率 / 暴击伤害两条效果逐条列出来（各自显示 当前 → 下一级 与增量）。
//
// 为什么单独一个文件：技能表在 src/skills.js，结算在 game_core.enhanceTower，
// 这里只负责"把这次升级摆到玩家面前"。
// ============================================================================

const { BALANCE, TOWER_DEFS } = require('./config');
const theme = require('./theme');
const towerMod = require('./tower');
const skills = require('./skills');

const { THEME, roundRectPath, drawTaperedDivider, ellipsize } = theme;

const ENHANCE_UI = {
  maxW: 306,        // 面板最大宽（窄屏自动收窄）
  marginX: 16,      // 距屏幕左右最小边距
  padX: 18,
  padTop: 16,
  titleH: 24,
  infoH: 58,        // 收益 + 花费 + 等级明细 三行
  cardPadY: 10,     // 卡片上下内边距
  cardTitleH: 20,   // 卡片里"技能名"一行
  cardLineH: 16,    // 卡片里每条效果一行
  cardRadius: 10,
  gap: 8,
  padBottom: 14,
  hintH: 16,
};

/** 一张强化卡的高度：技能名 + N 条效果（N 随技能效果条数变化） */
function cardH(nEffects) {
  const n = Math.max(1, nEffects || 0);
  return ENHANCE_UI.cardPadY * 2 + ENHANCE_UI.cardTitleH + n * ENHANCE_UI.cardLineH;
}

/**
 * 浮层布局（纯函数，渲染 / 输入共用）
 * @returns {{ panel, titleCY, infoLines:number[], cards:Array, hintY, tower, type, options }}
 */
function getEnhanceLayout(game) {
  const W = game.W;
  const H = game.H;

  const picker = game.enhancePicker;
  const tower = picker ? picker.tower : null;
  const type = tower ? tower.type : null;
  const options = type ? towerMod.getEnhanceOptions(type) : [];
  const n = options.length;
  const heights = options.map((o) => cardH((o.effects || []).length));

  const panelW = Math.min(ENHANCE_UI.maxW, W - ENHANCE_UI.marginX * 2);
  let listH = 0;
  for (let i = 0; i < n; i++) listH += heights[i] + (i > 0 ? ENHANCE_UI.gap : 0);
  const panelH = ENHANCE_UI.padTop + ENHANCE_UI.titleH + ENHANCE_UI.infoH
    + ENHANCE_UI.gap + listH + ENHANCE_UI.gap + ENHANCE_UI.hintH + ENHANCE_UI.padBottom;

  const panelX = Math.round((W - panelW) / 2);
  const panelY = Math.round((H - panelH) / 2);

  const inner = panelW - ENHANCE_UI.padX * 2;
  const titleCY = panelY + ENHANCE_UI.padTop + ENHANCE_UI.titleH / 2;
  const infoTop = panelY + ENHANCE_UI.padTop + ENHANCE_UI.titleH + 8;
  const listTop = panelY + ENHANCE_UI.padTop + ENHANCE_UI.titleH + ENHANCE_UI.infoH + ENHANCE_UI.gap;

  const cards = [];
  let cy = listTop;
  options.forEach((o, i) => {
    cards.push({
      key: o.key,
      opt: o,
      idx: i,
      x: panelX + ENHANCE_UI.padX,
      y: cy,
      w: inner,
      h: heights[i],
    });
    cy += heights[i] + ENHANCE_UI.gap;
  });

  return {
    panel: { x: panelX, y: panelY, w: panelW, h: panelH },
    titleCY: titleCY,
    // ⚠️ 三行都要给出 y —— drawEnhancePicker 的 行0 / 行1 / 行2 直接取 infoLines[0/1/2]。
    //    只给两条会让行2 拿到 undefined：fillText(text, x, undefined) 在真机上是无效调用，
    //    于是技能说明 /「金币不足」/「已满级」全部画不出来 —— 玩家只看到按钮变灰，
    //    却不知道原因（"按钮点了没反应"这类投诉的典型来源）。
    infoLines: [infoTop, infoTop + 18, infoTop + 36],
    cards: cards,
    hintY: panelY + panelH - ENHANCE_UI.padBottom - ENHANCE_UI.hintH / 2,
    tower: tower,
    type: type,
    options: options,
  };
}

/** 命中检测：{kind:'option', key} 或 {kind:'close'}（点空白 = 取消） */
function hitEnhancePicker(game, pos) {
  const L = getEnhanceLayout(game);
  if (!L.tower) return { kind: 'close' };
  for (const card of L.cards) {
    if (theme.pointInRect(pos, card)) return { kind: 'option', key: card.key };
  }
  return { kind: 'close' };
}

/** 该塔已强化的次数（浮层里显示"已强化 N 次"） */
function pickCount(tower, key) {
  const picks = (tower && tower.enhancePicks) || [];
  let n = 0;
  for (const k of picks) if (k === key) n++;
  return n;
}

/** 本次强化的收益文案，如「+5%」/「暴击几率 +5% · 暴击伤害 +10%」 */
function gainText(type) {
  return towerMod.specialGainText(type);
}

/** 技能当前取值文案，如「30%」/「暴击几率 30% · 暴击伤害 50%」 */
function valueText(type, level) {
  return towerMod.specialText(type, level);
}

/** 「当前 → 下一级」文案，如「5% → 10% · 0% → 10%」 */
function stepText(type, level) {
  return skills.skillStepText(type, level);
}

/** 单条效果的「当前 → 下一级」文案（卡片里每行一份） */
function effectStepText(effect, level) {
  return skills.stepTextOf(effect, level);
}

/** 选项的本次收益文案（多效果用 · 连接；兼容旧调用点） */
function optionGainText(opt) {
  if (!opt) return '';
  if (opt.gainText) return opt.gainText;
  return `+${opt.perLevel}${opt.unit || ''}`;
}

// ==================== 绘制 ====================

function drawEnhancePicker(game) {
  const ctx = game.ctx;
  const W = game.W;
  const H = game.H;

  const picker = game.enhancePicker;
  if (!picker || !picker.tower) return;
  const tower = picker.tower;
  const towerDef = TOWER_DEFS[tower.type];
  if (!towerDef) return;

  const sk = skills.getInnateSkill(tower.type);
  const L = getEnhanceLayout(game);
  // 学习额度：只有【学习次数】会涨/会满 —— 额外等级（宝石 / 十字塔共享）不占这个额度。
  const learned = skills.learnedLevel(tower);
  const learnCap = skills.baseLearnCap(tower.type);
  const maxed = learned >= learnCap;
  const cost = towerMod.getEnhanceCost(tower.type, learned);
  const affordable = game.gold >= cost;

  // 学习等级（局内花金币学出来的次数）与额外等级（宝石 / 共享）分开显示 —— 口径不同，别相加着写。
  // ⚠️ 学习等级真源是 tower.enhanceLevel（0..5）；额外等级来自宝石 + 十字塔共享；
  //    与技能槽（skillSlot）/ 属性面板读的是同一个值，三处不会各说各话。
  const bonusLv = skills.extraLevel(tower, tower.type);
  // 等级口径 2026-09-20：当前等级 = 学习等级 + 额外等级；可学等级 = 额外等级 + 可学基数
  const curLv = learned + bonusLv;
  const capLv = skills.learnableCap(tower, tower.type);
  const canAffordNext = affordable && !maxed;

  ctx.save();

  // 遮罩（把属性面板压到后面，焦点只在这张卡上）
  ctx.fillStyle = 'rgba(0, 0, 0, 0.74)';
  ctx.fillRect(0, 0, W, H);

  // 面板
  const grad = ctx.createLinearGradient(0, L.panel.y, 0, L.panel.y + L.panel.h);
  grad.addColorStop(0, 'rgba(24, 26, 42, 0.99)');
  grad.addColorStop(1, 'rgba(10, 12, 22, 0.99)');
  ctx.fillStyle = grad;
  ctx.strokeStyle = (canAffordNext) ? 'rgba(129, 199, 132, 0.85)' : THEME.border.strong;
  ctx.lineWidth = 1.5;
  roundRectPath(ctx, L.panel.x, L.panel.y, L.panel.w, L.panel.h, THEME.radius.large);
  ctx.fill();
  ctx.stroke();

  // 标题：固有技能 · 塔名   当前 0/5 → 1/5（或 已满）
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 15px Arial';
  ctx.fillStyle = THEME.text.primary;
  ctx.fillText(`${skills.INNATE_LABEL} · ${towerDef.name}`, L.panel.x + ENHANCE_UI.padX, L.titleCY);

  ctx.textAlign = 'right';
  ctx.font = 'bold 13px Arial';
  ctx.fillStyle = maxed ? THEME.text.off : THEME.accent.green;
  if (maxed) {
    ctx.fillText(`当前 ${curLv}/${capLv} · 已满`, L.panel.x + L.panel.w - ENHANCE_UI.padX, L.titleCY);
  } else {
    // 标题只放"等级迁移"。等级明细（学习 / 额外）在下面的【等级明细行】里，
    // ⛔ 别再往标题里塞括号明细：13px 下那串有 206.7px，加上左边"固有技能 · 塔名"的
    //    129.8px = 336.5px，而浮层内宽只有 252~270px —— 实测每种屏宽都重叠 66~85px。
    ctx.fillText(`${curLv}/${capLv} → ${curLv + 1}/${capLv}`, L.panel.x + L.panel.w - ENHANCE_UI.padX, L.titleCY);
  }

  // 分隔线（标题与正文之间，风格统一）
  drawTaperedDivider(ctx, W / 2, L.titleCY + ENHANCE_UI.titleH / 2 + 8, L.panel.w - ENHANCE_UI.padX * 2);

  // 信息三行：
  //   行0：左 = 本次提升哪个技能；右 = 花费
  //   行1：等级明细：学习等级 0/5（强化进度） / 额外等级 5（猫眼石）
  //   行2：金币状态 / 技能说明
  ctx.textAlign = 'left';
  ctx.font = 'bold 12px Arial';
  ctx.fillStyle = THEME.accent.green;
  ctx.fillText(
    sk ? `本次提升 ${sk.name} ${skills.skillGainText(tower.type)}` : '本次提升',
    L.panel.x + ENHANCE_UI.padX, L.infoLines[0]
  );

  ctx.textAlign = 'right';
  ctx.font = 'bold 13px Arial';
  ctx.fillStyle = maxed ? THEME.text.off : (affordable ? THEME.accent.gold : THEME.accent.danger);
  ctx.fillText(maxed ? '已满级' : `花费 💰${cost}`, L.panel.x + L.panel.w - ENHANCE_UI.padX, L.infoLines[0]);

  // 等级明细行：学习等级（学习进度，绿/暗色）+ 额外等级（宝石/共享，金/灰）
  //   当前等级 = 学习等级 + 额外等级；可学等级 = 额外等级 + 可学基数（额外只抬当前与可学，不占学习额度）。
  ctx.textAlign = 'left';
  ctx.font = '11px Arial';
  ctx.fillStyle = THEME.text.secondary;
  const bonusColor = bonusLv > 0 ? THEME.accent.gold : THEME.text.dim;
  const learnedStr = `学习等级: ${learned}/${learnCap}`;
  const bonusStr = bonusLv > 0 ? `额外等级: ${bonusLv}（${skills.gemLevels(tower.type) > 0 ? '猫眼石' : '其他'}）` : `额外等级: 0`;
  const combinedX = L.panel.x + ENHANCE_UI.padX;
  const learnedW = ctx.measureText(learnedStr).width;
  ctx.fillText(learnedStr, combinedX, L.infoLines[1]);
  const bonusX = combinedX + learnedW + 12;
  ctx.fillStyle = bonusColor;
  ctx.fillText(bonusStr, bonusX, L.infoLines[1]);

  ctx.textAlign = 'left';
  ctx.font = '11px Arial';
  ctx.fillStyle = THEME.text.secondary;
  let subText;
  if (maxed) subText = `学习已达上限（${learned}/${learnCap}）；宝石 / 共享的等级另算`;
  else if (!affordable) subText = `金币不足（现有 💰${game.gold}）`;
  else subText = sk ? ellipsize(ctx, sk.desc || '', L.panel.w - ENHANCE_UI.padX * 2) : '';
  ctx.fillText(subText, L.panel.x + ENHANCE_UI.padX, L.infoLines[2]);

  // 卡片（一个技能一张：确认本次升级）
  for (const card of L.cards) {
    drawOptionCard(game, card, tower);
  }

  // 底部提示
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '10px Arial';
  ctx.fillStyle = THEME.text.off;
  ctx.fillText(`点卡片提升固有技能 · 点空白取消`, W / 2, L.hintY);

  ctx.restore();
}

/**
 * 强化卡：技能名 + 逐条效果（属性名 · 当前值 → 下一级 · 本次增量）。
 * 效果条数决定卡高（见 cardH / getEnhanceLayout），所以"一技能多效果"不会画到卡外。
 */
function drawOptionCard(game, card, tower) {
  const ctx = game.ctx;
  const opt = card.opt;
  const { x, y, w, h } = card;
  const pressed = theme.isButtonPressed(game, 'enhance:opt:' + opt.key);
  const picked = pickCount(tower, opt.key);
  // 卡片展示"再学一次会多什么"，基准取【当前等级】= Lv.1 + 生效次数（学习 + 宝石 + 共享）
  // —— 必须与技能槽 / 属性面板显示的数值同口径：拿"学习等级"当基准的话，
  //    嵌了猫眼石的塔会写成「暴击几率 5% → 10%」，而槽里明明是 30%（面板撒谎）。
  const lvNow = skills.LEVEL_BASE + skills.effectiveTimesOf(tower);

  ctx.save();

  // 卡底：绿色系渐变（强化 = 增益语义），按压时提亮
  const grad = ctx.createLinearGradient(x, y, x, y + h);
  if (pressed) {
    grad.addColorStop(0, 'rgba(129, 199, 132, 0.34)');
    grad.addColorStop(1, 'rgba(56, 142, 60, 0.18)');
  } else {
    grad.addColorStop(0, 'rgba(129, 199, 132, 0.15)');
    grad.addColorStop(1, 'rgba(56, 142, 60, 0.06)');
  }
  ctx.fillStyle = grad;
  ctx.strokeStyle = pressed ? 'rgba(165, 214, 167, 0.95)' : 'rgba(129, 199, 132, 0.5)';
  ctx.lineWidth = pressed ? 2 : 1.2;
  roundRectPath(ctx, x, y, w, h, ENHANCE_UI.cardRadius);
  ctx.fill();
  ctx.stroke();

  ctx.textBaseline = 'middle';
  const left = x + 14;
  const right = x + w - 14;

  // 第 1 行：技能名（左） + 已强化次数（右，暗）
  ctx.textAlign = 'left';
  ctx.font = 'bold 15px Arial';
  ctx.fillStyle = THEME.text.primary;
  ctx.fillText(ellipsize(ctx, opt.name, w - 92), left, y + ENHANCE_UI.cardPadY + ENHANCE_UI.cardTitleH / 2);

  if (picked > 0) {
    ctx.textAlign = 'right';
    ctx.font = '10px Arial';
    ctx.fillStyle = THEME.text.dim;
    ctx.fillText(`已强化 ${picked} 次`, right, y + ENHANCE_UI.cardPadY + ENHANCE_UI.cardTitleH / 2);
  }

  // 第 2 行起：每条效果一行 —— 属性名（暗） · 当前 → 下一级（白） · 本次增量（绿，右对齐）
  let cy = y + ENHANCE_UI.cardPadY + ENHANCE_UI.cardTitleH + ENHANCE_UI.cardLineH / 2;
  for (const eff of (opt.effects || [])) {
    ctx.textAlign = 'left';
    ctx.font = '11px Arial';
    ctx.fillStyle = THEME.text.secondary;
    ctx.fillText(eff.name, left, cy);
    const nameW = ctx.measureText(eff.name).width;

    const gainStr = eff.gainText;
    ctx.font = 'bold 12px Arial';
    const gainW = ctx.measureText(gainStr).width;

    const stepStr = effectStepText(eff, lvNow);
    const availW = Math.max(20, w - 28 - nameW - 6 - gainW - 8);
    ctx.fillStyle = THEME.text.primary;
    ctx.fillText(ellipsize(ctx, stepStr, availW), left + nameW + 6, cy);

    ctx.textAlign = 'right';
    ctx.fillStyle = THEME.accent.green;
    ctx.fillText(gainStr, right, cy);
    cy += ENHANCE_UI.cardLineH;
  }

  ctx.restore();
}

module.exports = {
  ENHANCE_UI,
  cardH,
  getEnhanceLayout,
  hitEnhancePicker,
  drawEnhancePicker,
  gainText,
  valueText,
  stepText,
  effectStepText,
  optionGainText,
  pickCount,
};
