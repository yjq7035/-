// ============================================================================
// 强化（升级）确认浮层 —— src/enhance.js
// ----------------------------------------------------------------------------
// 入口：塔属性面板里的「强化」按钮（只有进阶到 3★ 的图形塔按钮才可用）。
// 内容（2026-09 二次重做）：强化**不再发放任何伤害加成**，只把该塔的
//       【专属特殊属性】抬一级：当前值 = base + per × 等级（见 config.ENHANCE_SPECIAL）。
// 交互：一次性确认 —— 点卡片＝立即强化并扣金币；点空白＝取消。
//       （旧版是"从 2 项里多选一"，现在每塔只有一项属性，所以浮层退化为
//         "看一眼当前值 → 点确认"的预览卡，不再让玩家做无意义的选择。）
//
// 为什么单独一个文件：强化规则（属性表 / 数值）在 config.ENHANCE_SPECIAL，
// 结算在 game_core.enhanceTower，这里只负责"把这次升级摆到玩家面前"。
// ============================================================================

const { BALANCE, TOWER_DEFS } = require('./config');
const theme = require('./theme');
const towerMod = require('./tower');

const { THEME, roundRectPath, drawTaperedDivider, ellipsize } = theme;

const ENHANCE_UI = {
  maxW: 306,        // 面板最大宽（窄屏自动收窄）
  marginX: 16,      // 距屏幕左右最小边距
  padX: 18,
  padTop: 16,
  titleH: 24,
  infoH: 42,        // 收益 + 花费 两行
  optionH: 58,
  gap: 8,
  padBottom: 14,
  hintH: 16,
};

/**
 * 浮层布局（纯函数，渲染 / 输入共用）
 * @returns {{ panel, titleCY, infoLines:number[], cards:Array, hintY, tower, type, options }}
 */
function getEnhanceLayout(game) {
  const W = game.canvas.width;
  const H = game.canvas.height;

  const picker = game.enhancePicker;
  const tower = picker ? picker.tower : null;
  const type = tower ? tower.type : null;
  const options = type ? towerMod.getEnhanceOptions(type) : [];
  const n = options.length;

  const panelW = Math.min(ENHANCE_UI.maxW, W - ENHANCE_UI.marginX * 2);
  const listH = n * ENHANCE_UI.optionH + Math.max(0, n - 1) * ENHANCE_UI.gap;
  const panelH = ENHANCE_UI.padTop + ENHANCE_UI.titleH + ENHANCE_UI.infoH
    + ENHANCE_UI.gap + listH + ENHANCE_UI.gap + ENHANCE_UI.hintH + ENHANCE_UI.padBottom;

  const panelX = Math.round((W - panelW) / 2);
  const panelY = Math.round((H - panelH) / 2);

  const inner = panelW - ENHANCE_UI.padX * 2;
  const titleCY = panelY + ENHANCE_UI.padTop + ENHANCE_UI.titleH / 2;
  const infoTop = panelY + ENHANCE_UI.padTop + ENHANCE_UI.titleH + 8;
  const listTop = panelY + ENHANCE_UI.padTop + ENHANCE_UI.titleH + ENHANCE_UI.infoH + ENHANCE_UI.gap;

  const cards = options.map((o, i) => ({
    key: o.key,
    opt: o,
    idx: i,
    x: panelX + ENHANCE_UI.padX,
    y: listTop + i * (ENHANCE_UI.optionH + ENHANCE_UI.gap),
    w: inner,
    h: ENHANCE_UI.optionH,
  }));

  return {
    panel: { x: panelX, y: panelY, w: panelW, h: panelH },
    titleCY: titleCY,
    infoLines: [infoTop, infoTop + 18],
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

/** 本次强化的收益文案，如「+5%」/「+1倍」/「+15」 */
function gainText(type) {
  return towerMod.specialGainText(type);
}

/** 属性取值文案，如「30%」/「×6」/「45°」/「12层」 */
function valueText(type, level) {
  return towerMod.specialText(type, level);
}

/** 「当前 → 下一级」文案，如「10% → 15%」 */
function stepText(type, level) {
  return `${valueText(type, level)} → ${valueText(type, level + 1)}`;
}

/** 兼容旧调用点：选项的本次收益文案 */
function optionGainText(opt) {
  return `+${opt.perLevel}${opt.unit || ''}`;
}

// ==================== 绘制 ====================

function drawEnhancePicker(game) {
  const ctx = game.ctx;
  const W = game.canvas.width;
  const H = game.canvas.height;

  const picker = game.enhancePicker;
  if (!picker || !picker.tower) return;
  const tower = picker.tower;
  const towerDef = TOWER_DEFS[tower.type];
  if (!towerDef) return;

  const sp = towerMod.getSpecialDef(tower.type);
  const L = getEnhanceLayout(game);
  const lv = tower.enhanceLevel || 0;
  const maxLv = BALANCE.enhance.maxLevel;
  const cost = towerMod.getEnhanceCost(tower.type, lv);
  const affordable = game.gold >= cost;
  const maxed = lv >= maxLv;

  ctx.save();

  // 遮罩（把属性面板压到后面，焦点只在这张卡上）
  ctx.fillStyle = 'rgba(0, 0, 0, 0.74)';
  ctx.fillRect(0, 0, W, H);

  // 面板
  const grad = ctx.createLinearGradient(0, L.panel.y, 0, L.panel.y + L.panel.h);
  grad.addColorStop(0, 'rgba(24, 26, 42, 0.99)');
  grad.addColorStop(1, 'rgba(10, 12, 22, 0.99)');
  ctx.fillStyle = grad;
  ctx.strokeStyle = (affordable && !maxed) ? 'rgba(129, 199, 132, 0.85)' : THEME.border.strong;
  ctx.lineWidth = 1.5;
  roundRectPath(ctx, L.panel.x, L.panel.y, L.panel.w, L.panel.h, THEME.radius.large);
  ctx.fill();
  ctx.stroke();

  // 标题：强化 · 塔名   Lv.x → Lv.y
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 15px Arial';
  ctx.fillStyle = THEME.text.primary;
  ctx.fillText(`强化 · ${towerDef.name}`, L.panel.x + ENHANCE_UI.padX, L.titleCY);

  ctx.textAlign = 'right';
  ctx.font = 'bold 13px Arial';
  ctx.fillStyle = THEME.accent.green;
  ctx.fillText(`${lv} → ${lv + 1}`, L.panel.x + L.panel.w - ENHANCE_UI.padX, L.titleCY);

  // 分隔线（标题与正文之间，风格统一）
  drawTaperedDivider(ctx, W / 2, L.titleCY + ENHANCE_UI.titleH / 2 + 8, L.panel.w - ENHANCE_UI.padX * 2);

  // 信息两行：左 = 本次收益 / 此时取值 → 下一级取值；右 = 花费
  ctx.textAlign = 'left';
  ctx.font = 'bold 12px Arial';
  ctx.fillStyle = THEME.accent.green;
  ctx.fillText(
    sp ? `本次获得 ${sp.name} ${gainText(tower.type)}` : '本次获得',
    L.panel.x + ENHANCE_UI.padX, L.infoLines[0]
  );

  ctx.textAlign = 'right';
  ctx.font = 'bold 13px Arial';
  ctx.fillStyle = maxed ? THEME.text.off : (affordable ? THEME.accent.gold : THEME.accent.danger);
  ctx.fillText(maxed ? '已满级' : `花费 💰${cost}`, L.panel.x + L.panel.w - ENHANCE_UI.padX, L.infoLines[0]);

  ctx.textAlign = 'left';
  ctx.font = '11px Arial';
  ctx.fillStyle = THEME.text.secondary;
  let subText;
  if (maxed) subText = '强化属性已达上限';
  else if (!affordable) subText = `金币不足（现有 💰${game.gold}）`;
  else subText = sp ? `${sp.name} ${stepText(tower.type, lv)}` : '';
  ctx.fillText(subText, L.panel.x + ENHANCE_UI.padX, L.infoLines[1]);

  // 卡片（现在只有一张：确认本次升级）
  for (const card of L.cards) {
    drawOptionCard(game, card, tower);
  }

  // 底部提示
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '10px Arial';
  ctx.fillStyle = THEME.text.off;
  ctx.fillText('点卡片立即强化 · 点空白取消', W / 2, L.hintY);

  ctx.restore();
}

/** 强化卡：左侧属性名 + 说明，右侧"本次获得"数值 */
function drawOptionCard(game, card, tower) {
  const ctx = game.ctx;
  const opt = card.opt;
  const { x, y, w, h } = card;
  const pressed = theme.isButtonPressed(game, 'enhance:opt:' + opt.key);
  const picked = pickCount(tower, opt.key);

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
  roundRectPath(ctx, x, y, w, h, THEME.radius.medium);
  ctx.fill();
  ctx.stroke();

  ctx.textBaseline = 'middle';

  // 左：属性名
  ctx.textAlign = 'left';
  ctx.font = 'bold 15px Arial';
  ctx.fillStyle = THEME.text.primary;
  ctx.fillText(opt.name, x + 14, y + h / 2 - 9);

  // 左：说明 + 已强化次数
  ctx.font = '10px Arial';
  ctx.fillStyle = THEME.text.dim;
  const sub = (opt.desc || '') + (picked > 0 ? `　已强化 ${picked} 次` : '');
  ctx.fillText(ellipsize(ctx, sub, w - 116), x + 14, y + h / 2 + 11);

  // 右：本次收益（绿字）+ 小标
  ctx.textAlign = 'right';
  ctx.font = 'bold 17px Arial';
  ctx.fillStyle = THEME.accent.green;
  ctx.fillText(optionGainText(opt), x + w - 14, y + h / 2 - 7);

  ctx.font = '9px Arial';
  ctx.fillStyle = THEME.text.off;
  ctx.fillText('本次获得', x + w - 14, y + h / 2 + 11);

  ctx.restore();
}

module.exports = {
  ENHANCE_UI,
  getEnhanceLayout,
  hitEnhancePicker,
  drawEnhancePicker,
  gainText,
  valueText,
  stepText,
  optionGainText,
  pickCount,
};
