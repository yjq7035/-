// 渲染层 UI 子模块：所有界面元素绘制（属性面板、波次标题、结算、提示等）。
// 由 src/renderer.js 薄壳 re-export。
const config = require('./config');
const { TOWER_DEFS, LAYOUT } = config;
const theme = require('./theme');
const towerMod = require('./tower');
const bonusStats = require('./bonusStats');
const shop = require('./shop');
const nav = require('./nav');
const codex = require('./codex');
const talents = require('./talents');
const bag = require('./bag');
const levels = require('./levels');
const gamemenu = require('./gamemenu');
const enhanceMod = require('./enhance');
const meta = require('./meta');
const gems = require('./gems');
const skills = require('./skills');
const stageMod = require('./stage');
const skillSlot = require('./skillSlot');
const { anchorPointOf, clamp } = require('./geometry');

const {
  THEME, TOAST, shade, teamBandGradient, easeOutCubic, easeOutBack,
  roundRectPath, drawStar, drawTowerIcon, wrapTextLines, drawPillTitle, drawButton,
  drawButtonFx, isButtonPressed,
} = theme;

// ========== 属性面板布局参数（自适应高度的唯一真源）==========
const PANEL_UI = {
  width: 302,
  screenMarginX: 16,
  screenMarginY: 18,
  padX: 20,
  padTop: 14,
  padBottom: 12,
  radius: 12,
  headerH: 48,
  dividerH: 18,
  dividerThickness: 5,
  rowH: 26,
  subH: 16,
  sectionTitleH: 22,
  effectH: 18,
  descLineH: 17,
  descSize: 12.5,
  skillH: 24,
  gemRowH: 40,
  gemGap: 5,
  enhanceH: 52,
  footerH: 24,
};

// 属性行标签配色
const ROW_LABEL_COLOR = {
  damage: THEME.accent.danger,
  attackSpeedMultiplier: THEME.accent.danger,
  attackInterval: THEME.text.secondary,
  auraPower: '#B388FF',
  shareRatio: '#B388FF',
  shareTarget: '#B388FF',
  range: THEME.text.secondary,
  hp: THEME.text.secondary,
  critChance: THEME.accent.cyan,
  critMult: THEME.accent.cyan,
  penetration: THEME.accent.gold,
  break: THEME.accent.gold,
};

/** 宝石区块总高（唯一真源） */
function gemBlockHeight(n) {
  if (!(n > 0)) return 0;
  return PANEL_UI.sectionTitleH + n * PANEL_UI.gemRowH + (n - 1) * PANEL_UI.gemGap;
}

// ========== 塔属性面板（高度自适应）==========

function drawTowerPanel(game) {
  const ctx = game.ctx;
  const W = game.W;
  const H = game.H;

  const towerType = game.panelTowerType;
  const towerDef = TOWER_DEFS[towerType];
  if (!towerDef) return;
  const stats = towerMod.getTowerStats(towerType);
  const tower = game.selectedTower || null;
  game._currentPanelTower = tower;

  // 附加属性系统
  const info = bonusStats.collectTowerStats(game, tower, stats, towerType);

  // 尺寸 + 文本预排版
  const panelW = Math.min(PANEL_UI.width, W - PANEL_UI.screenMarginX * 2);
  const contentW = panelW - PANEL_UI.padX * 2;
  const cx = W / 2;
  const descLines = wrapTextLines(ctx, stats.description || '', contentW, `${PANEL_UI.descSize}px Arial`);

  // 固有技能槽
  const skillSlots = skillSlot.buildSkillSlots(ctx, towerType, tower, contentW);
  const skillBlockH = skillSlots.length > 0
    ? PANEL_UI.sectionTitleH + skillSlot.skillSlotsHeight(skillSlots, contentW)
    : 0;

  // 宝石槽条
  const gemEntries = gems.embeddedEntries(towerType);
  const gemBlockH = gemBlockHeight(gemEntries.length);

  // 组装区块
  const blocks = [];
  let padTop = PANEL_UI.padTop;
  let padBottom = PANEL_UI.padBottom;
  let contentH = padTop;
  const push = (block) => { blocks.push(block); contentH += block.h; };

  push({ type: 'header', h: PANEL_UI.headerH });

  let attrH = 0;
  for (const row of info.rows) attrH += PANEL_UI.rowH + row.parts.length * PANEL_UI.subH;
  push({ type: 'divider', h: PANEL_UI.dividerH });
  push({ type: 'attrs', h: attrH, rows: info.rows });

  if (info.effects.length > 0) {
    push({ type: 'divider', h: PANEL_UI.dividerH });
    push({
      type: 'effects',
      h: PANEL_UI.sectionTitleH + info.effects.length * PANEL_UI.effectH,
      items: info.effects,
    });
  }

  push({ type: 'divider', h: PANEL_UI.dividerH });
  push({ type: 'desc', h: PANEL_UI.sectionTitleH + descLines.length * PANEL_UI.descLineH, lines: descLines });

  if (skillSlots.length > 0) {
    push({ type: 'divider', h: PANEL_UI.dividerH });
    push({ type: 'skill', h: skillBlockH, slots: skillSlots, color: towerDef.color });
  }

  if (gemEntries.length > 0) {
    push({ type: 'divider', h: PANEL_UI.dividerH });
    push({ type: 'gems', h: gemBlockH, entries: gemEntries });
  }

  push({ type: 'divider', h: PANEL_UI.dividerH });
  push({ type: 'enhance', h: PANEL_UI.enhanceH });

  push({ type: 'footer', h: PANEL_UI.footerH });
  contentH += padBottom;

  // 高度自适应
  const availH = H - PANEL_UI.screenMarginY * 2;
  if (contentH > availH) {
    const shrinkBlocks = (type, floorH) => {
      const still = contentH - availH;
      if (still <= 0) return;
      const list = blocks.filter((b) => b.type === type);
      if (!list.length) return;
      const per = Math.min(list[0].h - floorH, still / list.length);
      if (per <= 0) return;
      for (const b of list) { b.h -= per; contentH -= per; }
    };
    shrinkBlocks('divider', 6);
    shrinkBlocks('footer', 16);

    const still = contentH - availH;
    if (still > 0) {
      const MIN_PAD = 6;
      const takeTop = Math.min(Math.max(0, padTop - MIN_PAD), still / 2);
      const takeBottom = Math.min(Math.max(0, padBottom - MIN_PAD), still - takeTop);
      padTop -= takeTop;
      padBottom -= takeBottom;
      contentH -= (takeTop + takeBottom);
    }
  }

  const panelH = Math.min(contentH, availH);
  const panelX = (W - panelW) / 2;
  const panelY = Math.max(PANEL_UI.screenMarginY, (H - panelH) / 2);
  game._panelRect = { x: panelX, y: panelY, w: panelW, h: panelH };

  const scrollable = contentH > availH;
  const maxScroll = scrollable ? (contentH - availH) : 0;
  if (scrollable) {
    if (game.panelScrollOffset === undefined || game.panelScrollOffset === null) {
      game.panelScrollOffset = 0;
    }
    game.panelScrollMax = maxScroll;
    if (game.panelScrollOffset > maxScroll) game.panelScrollOffset = maxScroll;
  } else {
    game.panelScrollMax = 0;
    game.panelScrollOffset = 0;
  }
  const scroll = game.panelScrollOffset || 0;

  // 背板 + 描边
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(panelX, panelY, panelW, panelH, PANEL_UI.radius);
  ctx.clip();
  ctx.fillStyle = 'rgba(6, 8, 16, 0.96)';
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = towerDef.color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(panelX, panelY, panelW, panelH, PANEL_UI.radius);
  ctx.stroke();
  ctx.restore();

  // 逐块绘制（应用滚动偏移）
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(panelX, panelY, panelW, panelH, PANEL_UI.radius);
  ctx.clip();

  let y = panelY + padTop - scroll;
  for (const block of blocks) {
    switch (block.type) {
      case 'header':  drawPanelHeader(ctx, block, panelX, y, panelW, towerDef, towerType, tower); break;
      case 'divider': drawTaperedDivider(ctx, cx, y + block.h / 2, panelW - PANEL_UI.padX * 2); break;
      case 'attrs':   drawPanelAttrRows(ctx, block, panelX, y, panelW); break;
      case 'effects': drawPanelEffects(ctx, block, panelX, y, panelW); break;
      case 'desc':    drawPanelDescription(ctx, block, panelX, y, panelW, stats); break;
      case 'skill':   drawPanelSkill(ctx, block, panelX, y, panelW); break;
      case 'gems':    drawPanelGems(ctx, block, panelX, y, panelW); break;
      case 'enhance': drawPanelEnhance(ctx, block, panelX, y, panelW, game); break;
      case 'footer':  drawPanelFooter(ctx, block, cx, y); break;
      default: break;
    }
    y += block.h;
  }
  ctx.restore();

  // 滚动提示
  if (scrollable) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '10px Arial';
    if (scroll > 2) {
      ctx.globalAlpha = 0.55;
      drawChevron(ctx, cx, panelY + 8, -1, THEME.text.dim);
    }
    if (scroll < maxScroll - 2) {
      ctx.globalAlpha = 0.75;
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillText('上滑查看更多', cx, panelY + panelH - 6);
      drawChevron(ctx, cx, panelY + panelH - 17, 1, THEME.text.dim);
    }
    ctx.restore();
  }

  drawButtonFx(game, ctx, 'panel');
}

function drawPanelHeader(ctx, block, panelX, y, panelW, towerDef, towerType, tower) {
  const left = panelX + PANEL_UI.padX;
  const right = panelX + panelW - PANEL_UI.padX;
  const iconX = left + 14;
  const iconY = y + block.h / 2;

  drawTowerIcon(ctx, iconX, iconY, towerDef.color, towerType);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = towerDef.color;
  ctx.font = 'bold 18px Arial';
  const nameX = left + 34;
  const nameY = y + 17;
  ctx.fillText(towerDef.name, nameX, nameY);
  const nameW = ctx.measureText(towerDef.name).width;

  const stage = tower && tower.stage > 0 ? tower.stage : 0;
  if (stage > 0) {
    const outerR = 5;
    const spacing = 12;
    for (let i = 0; i < stage; i++) {
      drawStar(ctx, nameX + nameW + 12 + i * spacing + outerR, nameY, outerR, THEME.accent.pink);
    }
  } else {
    ctx.fillStyle = THEME.text.off;
    ctx.font = '11px Arial';
    ctx.fillText('未进阶', nameX, y + 36);
  }

  if (tower && tower._cumulativeGold > 0) {
    ctx.textAlign = 'right';
    ctx.fillStyle = THEME.text.dim;
    ctx.font = '11px Arial';
    ctx.fillText('价值', right, y + 14);
    ctx.fillStyle = THEME.accent.gold;
    ctx.font = 'bold 16px Arial';
    const refund = Math.round(tower._cumulativeGold * 0.7);
    ctx.fillText(`${refund}`, right, y + 34);
  } else {
    ctx.textAlign = 'right';
    ctx.fillStyle = THEME.text.dim;
    ctx.font = '11px Arial';
    ctx.fillText('造价', right, y + 14);
    ctx.fillStyle = THEME.accent.gold;
    ctx.font = 'bold 16px Arial';
    ctx.fillText(`${towerDef.cost}`, right, y + 34);
  }
}

function drawPanelAttrRows(ctx, block, panelX, y, panelW) {
  const left = panelX + PANEL_UI.padX;
  const right = panelX + panelW - PANEL_UI.padX;
  let rowY = y;

  for (const row of block.rows) {
    const midY = rowY + PANEL_UI.rowH / 2;

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '14px Arial';
    ctx.fillStyle = ROW_LABEL_COLOR[row.key] || THEME.text.secondary;
    ctx.fillText(row.label, left, midY);

    const bonusColor = row.sign > 0 ? THEME.accent.green : (row.sign < 0 ? THEME.accent.danger : null);
    const VALUE_FONT = 'bold 15px Arial';
    const VALUE_GAP = 1.5;

    ctx.font = VALUE_FONT;
    const bonusW = row.bonusText ? ctx.measureText(row.bonusText).width : 0;

    if (row.bonusText) {
      ctx.textAlign = 'right';
      ctx.fillStyle = bonusColor;
      ctx.fillText(row.bonusText, right, midY);
    }

    const baseTint = row.valueTint === 'buff' ? THEME.accent.green
      : (row.valueTint === 'debuff' ? THEME.accent.danger : THEME.text.primary);
    ctx.textAlign = 'right';
    ctx.fillStyle = baseTint;
    ctx.fillText(row.baseText, right - (bonusW ? bonusW + VALUE_GAP : 0), midY);

    rowY += PANEL_UI.rowH;

    for (const part of row.parts) {
      const subY = rowY + PANEL_UI.subH / 2;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = '11px Arial';
      ctx.fillStyle = THEME.text.off;
      ctx.fillText(`· ${part.label}`, left + 8, subY);

      ctx.textAlign = 'right';
      ctx.font = 'bold 11px Arial';
      ctx.fillStyle = part.sign > 0 ? THEME.accent.green : THEME.accent.danger;
      ctx.fillText(part.text, right, subY);
      rowY += PANEL_UI.subH;
    }
  }
}

function drawPanelEffects(ctx, block, panelX, y, panelW) {
  const left = panelX + PANEL_UI.padX;
  const right = panelX + panelW - PANEL_UI.padX;

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 12px Arial';
  ctx.fillStyle = THEME.text.secondary;
  ctx.fillText('生效效果', left, y + PANEL_UI.sectionTitleH / 2);

  let itemY = y + PANEL_UI.sectionTitleH;
  for (const item of block.items) {
    const midY = itemY + PANEL_UI.effectH / 2;
    const color = item.sign > 0 ? THEME.accent.green : THEME.accent.danger;

    ctx.beginPath();
    ctx.arc(left + 5, midY, 3, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    ctx.textAlign = 'left';
    ctx.font = '12px Arial';
    ctx.fillStyle = color;
    ctx.fillText(`${item.source} · ${item.text}`, left + 14, midY);

    ctx.textAlign = 'right';
    ctx.font = '10px Arial';
    ctx.fillStyle = THEME.text.off;
    ctx.fillText(`剩 ${item.remaining.toFixed(1)}s`, right, midY);

    itemY += PANEL_UI.effectH;
  }
}

function drawPanelDescription(ctx, block, panelX, y, panelW, stats) {
  const left = panelX + PANEL_UI.padX;

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 12px Arial';
  ctx.fillStyle = THEME.text.secondary;
  ctx.fillText('攻击介绍', left, y + PANEL_UI.sectionTitleH / 2);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = `${PANEL_UI.descSize}px Arial`;
  ctx.fillStyle = THEME.text.primary;
  let lineY = y + PANEL_UI.sectionTitleH + PANEL_UI.descLineH / 2;
  for (const line of block.lines) {
    ctx.fillText(line, left, lineY);
    lineY += PANEL_UI.descLineH;
  }
}

function drawPanelSkill(ctx, block, panelX, y, panelW) {
  const left = panelX + PANEL_UI.padX;
  const contentW = panelW - PANEL_UI.padX * 2;

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 12px Arial';
  ctx.fillStyle = THEME.text.secondary;
  ctx.fillText(skills.INNATE_LABEL, left, y + PANEL_UI.sectionTitleH / 2);

  skillSlot.drawSkillSlots(ctx, left, y + PANEL_UI.sectionTitleH, contentW, block.slots, {
    towerColor: block.color,
  });
}

function drawPanelGems(ctx, block, panelX, y, panelW) {
  const left = panelX + PANEL_UI.padX;
  const right = panelX + panelW - PANEL_UI.padX;
  const contentW = right - left;
  const entries = block.entries || [];

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 12px Arial';
  ctx.fillStyle = THEME.text.secondary;
  ctx.fillText('宝石', left, y + PANEL_UI.sectionTitleH / 2);

  const gemPad = 6;
  const iconSize = 14;
  const iconR = iconSize / 2;
  const slotSize = iconSize + 8;
  let cardY = y + PANEL_UI.sectionTitleH;
  for (const entry of entries) {
    const def = gems.gemDef(entry.kind);
    if (!def) continue;

    const cardW = contentW;
    const cardH = PANEL_UI.gemRowH;

    const grad = ctx.createLinearGradient(left, cardY, left, cardY + cardH);
    grad.addColorStop(0, 'rgba(179, 136, 255, 0.10)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0.03)');
    ctx.fillStyle = grad;
    roundRectPath(ctx, left, cardY, cardW, cardH, 8);
    ctx.fill();

    ctx.strokeStyle = 'rgba(179, 136, 255, 0.35)';
    ctx.lineWidth = 1;
    roundRectPath(ctx, left, cardY, cardW, cardH, 8);
    ctx.stroke();

    const slotCX = left + gemPad + slotSize / 2;
    const slotCY = cardY + cardH / 2;
    const slotX = slotCX - slotSize / 2;
    const slotY = slotCY - slotSize / 2;
    ctx.beginPath();
    ctx.rect(slotX, slotY, slotSize, slotSize);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(179,136,255,0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
    gems.drawGemIcon(ctx, slotCX, slotCY + 1, iconR, entry.kind, { lv: entry.lv });

    const textX = slotCX + slotSize + 10;

    ctx.textAlign = 'left';
    ctx.font = 'bold 11px Arial';
    ctx.fillStyle = def.color;
    const label = gems.gemName(entry.kind, entry.lv);
    ctx.fillText(label, textX, cardY + 14);

    const eff = gems.effectTextAt(entry.kind, entry.lv);
    if (eff) {
      ctx.font = '10px Arial';
      ctx.fillStyle = THEME.text.off;
      ctx.fillText(eff, textX, cardY + 28);
    }

    cardY += cardH + PANEL_UI.gemGap;
  }
}

function drawPanelEnhance(ctx, block, panelX, y, panelW, game) {
  const left = panelX + PANEL_UI.padX;
  const right = panelX + panelW - PANEL_UI.padX;
  const tower = game._currentPanelTower;
  const w = panelW - PANEL_UI.padX * 2;

  const btnW = Math.min(160, Math.round(w * 0.52));
  const btnH = 34;
  const btn = {
    x: right - btnW,
    y: y + Math.round((block.h - btnH) / 2),
    w: btnW,
    h: btnH,
  };

  if (!tower) {
    game.panelEnhanceBtn = null;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 13px Arial';
    ctx.fillStyle = THEME.text.secondary;
    ctx.fillText('强化', left, y + block.h / 2 - 8);
    ctx.font = '10px Arial';
    ctx.fillStyle = THEME.text.off;
    ctx.fillText('放置到战场、并进阶到 ★★★ 后可花金币强化', left, y + block.h / 2 + 10);
    return;
  }

  if (!skills.hasSkill(tower.type)) {
    game.panelEnhanceBtn = null;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 13px Arial';
    ctx.fillStyle = THEME.text.secondary;
    ctx.fillText('强化', left, y + block.h / 2 - 8);
    ctx.font = '10px Arial';
    ctx.fillStyle = THEME.text.off;
    ctx.fillText('该塔暂无可强化项', left, y + block.h / 2 + 10);
    return;
  }

  const maxLv = skills.MAX_LEVEL;
  const lv = towerMod.getEffectiveSkillLevel(tower);
  const stage = tower.stage || 0;
  const needStage = BALANCE.enhance.minStage;
  const stageReady = towerMod.isStageReady(tower);
  const maxed = lv >= maxLv;
  const cost = maxed ? Infinity : towerMod.getEnhanceCost(tower.type, towerMod.getEnhanceTimes(tower));
  const affordable = !maxed && game.gold >= cost;
  const usable = stageReady && !maxed;

  game.panelEnhanceBtn = btn;

  const availW = Math.max(40, btn.x - left - 8);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 13px Arial';
  ctx.fillStyle = lv > skills.LEVEL_BASE ? THEME.accent.green : THEME.text.primary;
  ctx.fillText(`固有技能 Lv.${lv}/${maxLv}`, left, y + 20);

  ctx.font = '10px Arial';
  if (!stageReady) {
    ctx.fillStyle = THEME.accent.gold;
    ctx.fillText(ellipsize(ctx, `需进阶到 ★${'★'.repeat(needStage - 1)}（当前 ${stage}★）才能强化`, availW), left, y + 37);
  } else if (maxed) {
    const gemLv = tower ? skills.gemLevels(tower.type) : 0;
    ctx.fillStyle = THEME.text.off;
    ctx.fillText(
      ellipsize(ctx, gemLv > 0
        ? `已满级：宝石占 ${gemLv} 级（与强化共用上限）`
        : '已满级：专属属性已达上限', availW),
      left, y + 37
    );
  } else {
    const gainLabel = skills.skillGainLabel(tower.type);
    ctx.fillStyle = THEME.text.off;
    ctx.fillText(
      ellipsize(ctx, gainLabel ? `每次强化 ${gainLabel}` : '每次强化提升固有技能', availW),
      left, y + 37
    );
  }

  let top, bottom, stroke, label, labelColor;
  if (!stageReady) {
    top = THEME.track.soft; bottom = THEME.track.faint; stroke = THEME.border.subtle;
    label = `需 ${needStage}★`; labelColor = THEME.text.off;
  } else if (maxed) {
    top = THEME.track.soft; bottom = THEME.track.faint; stroke = THEME.border.subtle;
    label = '已满级'; labelColor = THEME.accent.gold;
  } else if (affordable) {
    top = 'rgba(129, 199, 132, 0.42)'; bottom = 'rgba(56, 142, 60, 0.26)';
    stroke = 'rgba(129, 199, 132, 0.85)';
    label = `本次提升固有技能 💰${cost}`; labelColor = THEME.text.primary;
  } else {
    top = THEME.track.soft; bottom = THEME.track.faint; stroke = THEME.border.subtle;
    label = `本次提升固有技能 💰${cost}`; labelColor = THEME.text.off;
  }
  void usable;

  drawButton(ctx, {
    x: btn.x, y: btn.y, w: btn.w, h: btn.h,
    top: top, bottom: bottom, stroke: stroke,
    label: label, labelColor: labelColor,
    fontSize: 14, radius: THEME.radius.medium,
    pressed: isButtonPressed(game, 'tower:enhance'),
  });
}

function drawPanelFooter(ctx, block, cx, y) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '11px Arial';
  ctx.fillStyle = THEME.text.dim;
  ctx.fillText('点击任意位置关闭', cx, y + block.h / 2);
}

// ========== 绘制分隔线 ==========

function drawTaperedDivider(ctx, x, y, width) {
  ctx.save();
  ctx.strokeStyle = THEME.border.normal;
  ctx.lineWidth = PANEL_UI.dividerThickness;
  ctx.beginPath();
  ctx.moveTo(x - width / 2, y);
  ctx.lineTo(x - width * 0.05, y - PANEL_UI.dividerThickness / 2);
  ctx.lineTo(x + width * 0.05, y - PANEL_UI.dividerThickness / 2);
  ctx.lineTo(x + width / 2, y);
  ctx.lineTo(x + width * 0.05, y + PANEL_UI.dividerThickness / 2);
  ctx.lineTo(x - width * 0.05, y + PANEL_UI.dividerThickness / 2);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

function drawChevron(ctx, x, y, dir, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - 6 * dir, y - 4);
  ctx.lineTo(x, y + 3 * dir);
  ctx.lineTo(x + 6 * dir, y - 4);
  ctx.stroke();
  ctx.restore();
}

function drawScrollBar(ctx, x, y, w, h, ratio, color) {
  ctx.save();
  const thumbH = Math.max(16, h * ratio);
  const thumbY = h > thumbH ? y + (1 - ratio) * h : y;
  const thumbX = x + w + 4;
  ctx.fillStyle = shade(color || THEME.border.normal, 0.4);
  ctx.beginPath();
  ctx.roundRect(thumbX, thumbY, 4, thumbH, 2);
  ctx.fill();
  ctx.restore();
}

// ========== 波次标题与倒计时动画 ==========

function getPlayerScoreProgress(game, index) {
  if (index === 0 && game.maxLives > 0) {
    return clamp(0, 1, game.lives / game.maxLives);
  }
  return 0.5;
}

function drawLifeBar(ctx, x, y, w, h, percent, gradient, fillFromRight) {
  percent = clamp(0, 1, percent || 0);
  if (w <= 0) return;

  ctx.fillStyle = THEME.track.bar;
  ctx.beginPath();
  ctx.roundRect(x, y - h / 2, w, h, h / 2);
  ctx.fill();

  if (percent > 0) {
    const fw = Math.max(h, w * percent);
    const fx = fillFromRight ? x + w - fw : x;
    const grad = ctx.createLinearGradient(fx, 0, fx + fw, 0);
    gradient.forEach((color, i) => grad.addColorStop(i / (gradient.length - 1), color));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(fx, y - h / 2, fw, h, h / 2);
    ctx.fill();
  }

  ctx.strokeStyle = THEME.border.normal;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x, y - h / 2, w, h, h / 2);
  ctx.stroke();
}

function drawWaveTitle(ctx, cx, cy, w, h, text) {
  const x = cx - w / 2;
  const y = cy - h / 2;

  ctx.fillStyle = teamBandGradient(ctx, x, x + w, 1);
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h / 2);
  ctx.fill();

  ctx.strokeStyle = THEME.border.strong;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h / 2);
  ctx.stroke();

  ctx.fillStyle = THEME.text.primary;
  ctx.font = 'bold 18px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, cy);
}

function drawReel(ctx, cx, cy, reelIndex) {
  const digits = ['5', '4', '3', '2', '1'];
  const H = 56;
  const winW = 74;
  const winH = H;
  const x = cx - winW / 2;
  const yTop = cy - winH / 2;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.beginPath();
  ctx.roundRect(x - 4, yTop - 4, winW + 8, winH + 8, 10);
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, yTop, winW, winH);
  ctx.clip();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 46px Arial';
  const offY = -reelIndex * H;
  for (let i = 0; i < digits.length; i++) {
    const cellCy = yTop + i * H + offY + H / 2;
    const dist = Math.abs(cellCy - cy);
    ctx.globalAlpha = Math.max(0, 1 - dist / (H * 1.1));
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 3;
    ctx.fillText(digits[i], cx, cellCy);
  }
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;

  const fade = ctx.createLinearGradient(0, yTop, 0, yTop + winH);
  fade.addColorStop(0,    'rgba(26,26,46,0.85)');
  fade.addColorStop(0.3,  'rgba(26,26,46,0)');
  fade.addColorStop(0.7,  'rgba(26,26,46,0)');
  fade.addColorStop(1,    'rgba(26,26,46,0.85)');
  ctx.fillStyle = fade;
  ctx.fillRect(x, yTop, winW, winH);
  ctx.restore();

  ctx.strokeStyle = THEME.border.strong;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x - 4, yTop - 4, winW + 8, winH + 8, 10);
  ctx.stroke();
}

function drawWaveCountdown(game, cx, cy, remaining, waitDuration) {
  const ctx = game.ctx;
  ctx.save();

  const introP = (remaining > waitDuration - 1)
    ? Math.min(1, Math.max(0, (waitDuration - remaining) / 1))
    : 1;
  if (game.currentWave > 0) {
    const eased = easeOutCubic(Math.min(1, introP));
    if (eased < 1) {
      const waveText = `第 ${game.currentWave} 波`;
      ctx.globalAlpha = 1 - eased;
      drawWaveTitle(ctx, cx - 60 * eased, cy - 70 * eased, 140, 40, waveText);
      ctx.globalAlpha = 1;
    }
  }

  if (remaining <= 1) {
    const goP = Math.min(1, Math.max(0, (1 - remaining) / 1));
    const scale = 0.55 + 0.45 * easeOutBack(goP);
    const alpha = Math.min(1, goP * 2.5);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.shadowColor = THEME.accent.gold;
    ctx.shadowBlur = 22;
    ctx.fillStyle = THEME.accent.gold;
    ctx.font = 'bold 40px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('进攻开始', 0, 0);
    ctx.restore();
  } else {
    const reelIndex = clamp(0, 4, waitDuration - remaining);
    drawReel(ctx, cx, cy, reelIndex);
  }

  ctx.restore();
}

function drawWaveTitleAnimated(game, cx, cy, w, h, text) {
  const ctx = game.ctx;
  const now = Date.now();
  const elapsed = (game.waveStartStamp > 0) ? (now - game.waveStartStamp) / 1000 : 1;
  if (elapsed >= 0.6) {
    drawWaveTitle(ctx, cx, cy, w, h, text);
    return;
  }
  const p = clamp(0, 1, elapsed / 0.6);
  const eased = easeOutCubic(p);
  ctx.save();
  ctx.globalAlpha = eased;
  drawWaveTitle(ctx, cx, cy - 40 * (1 - eased), w, h, text);
  ctx.restore();
}

// ========== 顶部状态栏 ==========

function drawTopBar(game) {
  const ctx = game.ctx;
  const width = game.W;
  const H = LAYOUT.topBarHeight;
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
  ctx.fillRect(0, 0, width, H);

  const badge = levels.getLevelBadgeRect(game);
  game.levelBadgeRect = badge;
  const lvDef = LEVELS.filter((l) => l.id === game.currentLevel)[0];
  drawChip(ctx, {
    x: badge.x, y: badge.y, w: badge.w, h: badge.h,
    text: lvDef ? lvDef.name : `关卡 ${game.currentLevel}`,
    color: THEME.team.red.light, fontSize: 11,
    bg: 'rgba(229, 115, 115, 0.18)',
    stroke: 'rgba(229, 115, 115, 0.55)',
  });

  const menuRect = gamemenu.getMenuButtonRect(game);
  gamemenu.drawMusicButton(game);
  gamemenu.drawMenuButton(game);

  ctx.strokeStyle = THEME.border.subtle;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, H + 0.5);
  ctx.lineTo(width, H + 0.5);
  ctx.stroke();

  ctx.restore();

  drawButtonFx(game, ctx, 'topbar');
}

// ========== drawUI（战斗场景 + UI 合成）==========

function drawUI(game) {
  const ctx = game.ctx;
  const width = game.W;
  const height = game.H;

  drawTopBar(game);

  const centerLineY = height / 2 - 40;
  const waveText = `第 ${game.currentWave} 波`;

  ctx.font = 'bold 18px Arial';
  const textWidth = ctx.measureText(waveText).width || 80;
  const bgWidth = textWidth + 60;
  const bgHeight = 40;
  const bgX = width / 2 - bgWidth / 2;

  const barH = 10;
  const barEdge = 10;
  const barGap = 10;
  drawLifeBar(
    ctx, barEdge, centerLineY,
    bgX - barGap - barEdge, barH,
    getPlayerScoreProgress(game, 0),
    [THEME.team.red.light, THEME.team.red.solid], false
  );
  const p1X = bgX + bgWidth + barGap;
  drawLifeBar(
    ctx, p1X, centerLineY,
    width - barEdge - p1X, barH,
    getPlayerScoreProgress(game, 1),
    [THEME.team.blue.light, THEME.team.blue.solid], true
  );

  drawWaveTitle(ctx, width / 2, centerLineY, bgWidth, bgHeight, waveText);
  drawBossBars(game, centerLineY, bgHeight);

  shop.drawShop(game);
}

// ========== drawGameOver（结算界面）==========

function drawGameOver(game) {
  const ctx = game.ctx;
  const width = game.W;
  const height = game.H;

  const showWin = !!game.gameWon;
  const showFail = game.lives <= 0 && !showWin;
  if (!showFail && !showWin) return;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
  ctx.fillRect(0, 0, width, height);

  const panelW = Math.min(360, width - 32);
  const reward = game.gemReward;
  const showReward = !!reward;
  const panelH = showReward ? 388 : 290;
  const panelX = (width - panelW) / 2;
  const panelY = (height - panelH) / 2;
  const accent = showFail
    ? { top: 'rgba(229, 115, 115, 0.14)', bottom: 'rgba(229, 115, 115, 0.05)', stroke: 'rgba(229, 115, 115, 0.5)' }
    : { top: 'rgba(255, 215, 0, 0.14)', bottom: 'rgba(255, 215, 0, 0.04)', stroke: 'rgba(255, 215, 0, 0.55)' };
  const panelGrad = ctx.createLinearGradient(panelX, panelY, panelX, panelY + panelH);
  panelGrad.addColorStop(0, accent.top);
  panelGrad.addColorStop(1, accent.bottom);
  ctx.fillStyle = panelGrad;
  ctx.strokeStyle = accent.stroke;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(panelX, panelY, panelW, panelH, THEME.radius.medium + 4);
  ctx.fill();
  ctx.stroke();

  const cx = width / 2;

  const titleText = showFail ? '游戏结束' : '胜利！';
  const titleTop = showFail ? 'rgba(229, 115, 115, 0.55)' : 'rgba(255, 215, 0, 0.55)';
  const titleBottom = showFail ? 'rgba(255, 68, 68, 0.35)' : 'rgba(255, 170, 0, 0.35)';
  drawPillTitle(ctx, cx, panelY + 56, titleText, titleTop, titleBottom, panelW - 24);

  ctx.fillStyle = THEME.text.secondary;
  ctx.font = '16px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`坚持波数: ${game.currentWave}`, cx, panelY + 116);

  ctx.font = '12px Arial';
  ctx.fillStyle = THEME.text.dim;
  ctx.fillText(
    showWin
      ? '关卡完成 · 特殊积分与天赋点已入账'
      : '本次收获的特殊积分已全部入账',
    cx, panelY + 142
  );

  if (reward && !game.watchingVideo) {
    drawGemReward(ctx, game, panelX, panelY, panelW);
  }

  if (showWin) {
    const btnW = Math.min(240, panelW - 48);
    const btnH = 54;
    const btnX = (width - btnW) / 2;
    const btnY = panelY + panelH - 90;
    game.gameOverButtons = { returnHome: { x: btnX, y: btnY, w: btnW, h: btnH } };
    drawButton(ctx, {
      x: btnX, y: btnY, w: btnW, h: btnH,
      top: 'rgba(165, 214, 167, 0.5)', bottom: 'rgba(76, 175, 80, 0.32)',
      stroke: 'rgba(165, 214, 167, 0.8)',
      label: '返回主页', labelColor: THEME.text.primary, fontSize: 18,
      pressed: isButtonPressed(game, 'returnHome'),
    });
  } else if (game.watchingVideo) {
    game.gameOverButtons = {};
    ctx.fillStyle = THEME.accent.gold;
    ctx.font = 'bold 26px Arial';
    ctx.fillText(`视频倒计时: ${Math.max(0, Math.ceil(game.videoTimer))} 秒`, cx, panelY + 190);
    ctx.fillStyle = THEME.text.secondary;
    ctx.font = '14px Arial';
    ctx.fillText('观看广告后可继续游戏', cx, panelY + 226);
  } else {
    const btnH = 54;
    const inner = panelW - 40;
    const gap = 16;
    const btnW = (inner - gap) / 2;
    const totalW = btnW * 2 + gap;
    const x1 = (width - totalW) / 2;
    const x2 = x1 + btnW + gap;
    const btnY = panelY + panelH - 90;
    game.gameOverButtons = {
      restart: { x: x1, y: btnY, w: btnW, h: btnH },
      watchContinue: { x: x2, y: btnY, w: btnW, h: btnH },
    };
    const adEnabled = AD.enabled;
    const watchDisabled = !adEnabled;
    const watchTop = watchDisabled ? 'rgba(120, 120, 120, 0.4)' : 'rgba(146, 197, 255, 0.5)';
    const watchBottom = watchDisabled ? 'rgba(90, 90, 90, 0.32)' : 'rgba(100, 181, 246, 0.32)';
    const watchStroke = watchDisabled ? 'rgba(120, 120, 120, 0.8)' : 'rgba(146, 197, 255, 0.8)';
    drawButton(ctx, {
      x: x1, y: btnY, w: btnW, h: btnH,
      top: 'rgba(165, 214, 167, 0.5)', bottom: 'rgba(76, 175, 80, 0.32)',
      stroke: 'rgba(165, 214, 167, 0.8)',
      label: '重新开始', labelColor: THEME.text.primary, fontSize: 16,
      pressed: isButtonPressed(game, 'restart'),
    });
    drawButton(ctx, {
      x: x2, y: btnY, w: btnW, h: btnH,
      top: watchTop, bottom: watchBottom,
      stroke: watchStroke,
      label: '再次挑战', labelColor: THEME.text.primary, fontSize: 15,
      subLabel: `(${game.currentWave * 500} 金币)`, subColor: THEME.text.secondary,
      pressed: adEnabled && isButtonPressed(game, 'watchContinue'),
      disabled: watchDisabled,
      disabledColor: THEME.text.off,
      icon: true,
    });
  }

  drawButtonFx(game, ctx, 'gameover');
}

// ========== drawToasts（提示）==========

function drawToasts(game) {
  const ctx = game.ctx;
  const W = game.W;
  const H = game.H;

  const toasts = TOAST.getToasts(game);
  if (toasts.length === 0) return;

  const toastH = 28;
  const toastGap = 8;
  const startX = W / 2;
  const startY = H - toasts.length * toastH - (toasts.length - 1) * toastGap - 40;

  for (let i = 0; i < toasts.length; i++) {
    const toast = toasts[toasts.length - 1 - i];
    const ty = startY + i * (toastH + toastGap);

    ctx.save();
    ctx.globalAlpha = Math.min(1, toast.life / 0.5);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    const tw = ctx.measureText(toast.text).width + 20;
    ctx.beginPath();
    ctx.roundRect(startX - tw / 2, ty, tw, toastH, toastH / 2);
    ctx.fill();
    ctx.strokeStyle = toast.color || THEME.text.primary;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = toast.color || THEME.text.primary;
    ctx.font = 'bold 12px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(toast.text, startX, ty + toastH / 2);
    ctx.restore();
  }
}

// ========== 宝石奖励绘制 ==========

function drawGemReward(ctx, game, panelX, panelY, panelW) {
  const reward = game.gemReward;
  if (!reward) return;

  const cx = (game.W) / 2;
  const top = panelY + 250;
  const gemW = 40;
  const gemH = 40;
  const gems = reward.gems || [];

  ctx.save();

  // 标题
  ctx.fillStyle = THEME.text.primary;
  ctx.font = 'bold 14px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('宝石奖励', cx, top - 10);

  // 宝石格子
  const cellSize = 48;
  const totalW = gems.length * cellSize;
  const startX = cx - totalW / 2;

  for (let i = 0; i < gems.length; i++) {
    const gem = gems[i];
    const gx = startX + i * cellSize;
    const gy = top + 5;

    // 格子背景
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.beginPath();
    ctx.roundRect(gx, gy, cellSize, cellSize, 6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // 宝石图标
    const def = gem.gemDef ? gem.gemDef() : null;
    const color = def ? def.color : '#aaa';
    const size = 12;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(gx + cellSize / 2, gy + cellSize / 2, size, 0, Math.PI * 2);
    ctx.fill();

    // 数量
    if (gem.count > 1) {
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`×${gem.count}`, gx + cellSize / 2, gy + cellSize - 4);
    }
  }

  ctx.restore();
}

// 导出
module.exports = {
  PANEL_UI,
  gemBlockHeight,
  drawTowerPanel,
  drawPanelHeader,
  drawPanelAttrRows,
  drawPanelEffects,
  drawPanelDescription,
  drawPanelSkill,
  drawPanelGems,
  drawPanelEnhance,
  drawPanelFooter,
  drawTaperedDivider,
  drawChevron,
  drawScrollBar,
  drawLifeBar,
  getPlayerScoreProgress,
  drawWaveTitle,
  drawWaveTitleAnimated,
  drawWaveCountdown,
  drawReel,
  drawTopBar,
  drawUI,
  drawGameOver,
  drawToasts,
  drawGemReward,
  // 辅助（来自 geometry）
  clamp,
  anchorPointOf,
};
