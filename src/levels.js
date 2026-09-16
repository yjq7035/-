// ============================================================================
// 关卡选择 —— src/levels.js
// ----------------------------------------------------------------------------
// 入口：战斗场景顶部左侧的「关卡 N」按钮 → 弹出本浮层。
// 现状：只有"关卡 1"可玩（默认关卡，也就是目前正在做的那一关），
//       关卡 2~6 为占位卡（锁 + 待扩展），后续扩展只需在 config.LEVELS 里补数据。
//
// 浮层是模态的：点卡片切关卡、点空白/关闭按钮退出，其它触摸一律吞掉。
// ============================================================================

const { LEVELS, LAYOUT } = require('./config');
const theme = require('./theme');
const meta = require('./meta');

const { THEME, roundRectPath, drawChip, drawButton, drawLockIcon, drawDashedBox, drawPillTitle, ellipsize } = theme;

const LV_UI = {
  padX: 18,
  cols: 2,
  gap: 10,
  cardH: 92,
  titleH: 46,
  padY: 18,
  footerH: 40,
};

/**
 * 战斗场景顶部状态栏里的「关卡 N」徽标矩形。
 * 抽成纯函数，让渲染层（画）与输入层（点）用同一份坐标。
 */
function getLevelBadgeRect(game) {
  const H = LAYOUT.topBarHeight;
  return { x: 8, y: Math.round((H - 22) / 2), w: 78, h: 22 };
}

/**
 * 关卡浮层布局（纯函数，渲染/输入共用）
 * @returns {{ panel, titleCY, cards: Array, closeBtn, navTop }}
 */
function getLevelLayout(game) {
  const W = game.canvas.width;
  const H = game.canvas.height;
  const navTop = H - LAYOUT.navHeight;

  const cols = LV_UI.cols;
  const rows = Math.ceil(LEVELS.length / cols);
  const panelW = Math.min(340, W - LV_UI.padX * 2);
  const panelX = Math.round((W - panelW) / 2);
  const gridW = panelW - LV_UI.padX * 2;
  const cardW = Math.floor((gridW - (cols - 1) * LV_UI.gap) / cols);

  const gridH = rows * LV_UI.cardH + (rows - 1) * LV_UI.gap;
  const panelH = LV_UI.padY + LV_UI.titleH + gridH + LV_UI.footerH + LV_UI.padY;

  // 垂直居中，但整体必须落在导航栏之上
  let panelY = Math.round((navTop - panelH) / 2);
  panelY = Math.max(LAYOUT.topBarHeight + 8, Math.min(panelY, navTop - panelH - 8));

  const gridTop = panelY + LV_UI.padY + LV_UI.titleH;
  const cards = LEVELS.map((lv, i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    return {
      level: lv,
      idx: i,
      x: panelX + LV_UI.padX + c * (cardW + LV_UI.gap),
      y: gridTop + r * (LV_UI.cardH + LV_UI.gap),
      w: cardW,
      h: LV_UI.cardH,
    };
  });

  const closeBtn = {
    x: panelX + LV_UI.padX,
    y: panelY + panelH - LV_UI.padY - 30,
    w: panelW - LV_UI.padX * 2,
    h: 30,
  };

  return {
    panel: { x: panelX, y: panelY, w: panelW, h: panelH },
    titleCY: panelY + LV_UI.padY + LV_UI.titleH / 2,
    cards: cards,
    closeBtn: closeBtn,
    navTop: navTop,
  };
}

/**
 * 命中检测。
 * @returns {{kind:'level', id:number}|{kind:'close'}|{kind:'none'}}
 */
function hitLevelSelect(game, pos) {
  const L = getLevelLayout(game);

  for (const card of L.cards) {
    if (theme.pointInRect(pos, card)) {
      return card.level.playable ? { kind: 'level', id: card.level.id } : { kind: 'locked', id: card.level.id };
    }
  }
  if (theme.pointInRect(pos, L.closeBtn)) return { kind: 'close' };
  if (theme.pointInRect(pos, L.panel)) return { kind: 'none' }; // 面板内空白吞掉
  return { kind: 'close' };                                     // 面板外点击 → 关闭
}

// ==================== 绘制 ====================

function drawLevelSelect(game) {
  const ctx = game.ctx;
  const W = game.canvas.width;
  const H = game.canvas.height;

  const L = getLevelLayout(game);

  ctx.save();

  // 全屏遮罩
  ctx.fillStyle = 'rgba(0, 0, 0, 0.78)';
  ctx.fillRect(0, 0, W, H);

  // 面板
  const grad = ctx.createLinearGradient(0, L.panel.y, 0, L.panel.y + L.panel.h);
  grad.addColorStop(0, 'rgba(22, 22, 40, 0.99)');
  grad.addColorStop(1, 'rgba(10, 10, 22, 0.99)');
  ctx.fillStyle = grad;
  ctx.strokeStyle = THEME.border.strong;
  ctx.lineWidth = 1.5;
  roundRectPath(ctx, L.panel.x, L.panel.y, L.panel.w, L.panel.h, THEME.radius.large);
  ctx.fill();
  ctx.stroke();

  // 标题
  drawPillTitle(ctx, W / 2, L.titleCY, '关卡选择',
    'rgba(229, 115, 115, 0.45)', 'rgba(100, 181, 246, 0.35)',
    L.panel.w - 40, 18);

  // 关卡卡
  for (const card of L.cards) drawLevelCard(game, card);

  // 关闭按钮
  drawButton(ctx, {
    x: L.closeBtn.x, y: L.closeBtn.y, w: L.closeBtn.w, h: L.closeBtn.h,
    top: THEME.track.soft, bottom: THEME.track.faint,
    stroke: THEME.border.normal,
    label: '返回战斗', labelColor: THEME.text.secondary,
    fontSize: 13, radius: L.closeBtn.h / 2,
    pressed: theme.isButtonPressed(game, 'levels:close'),
  });

  ctx.restore();
}

/** 单张关卡卡 */
function drawLevelCard(game, card) {
  const ctx = game.ctx;
  const lv = card.level;
  const { x, y, w, h } = card;
  const playable = !!lv.playable;
  const cleared = playable && meta.isLevelCleared(lv.id);
  const selected = meta.getSelectedLevel() === lv.id;
  const best = meta.bestWaveOf(lv.id);

  ctx.save();

  // 卡底：可玩 = 红蓝对阵渐变（呼应战场身份色），占位 = 灰
  const grad = ctx.createLinearGradient(x, y, x, y + h);
  if (playable) {
    grad.addColorStop(0, cleared ? 'rgba(165, 214, 167, 0.20)' : 'rgba(229, 115, 115, 0.20)');
    grad.addColorStop(1, 'rgba(100, 181, 246, 0.08)');
  } else {
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.045)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0.02)');
  }
  ctx.fillStyle = grad;
  ctx.strokeStyle = selected ? THEME.accent.gold
    : (playable ? 'rgba(229, 115, 115, 0.55)' : THEME.border.subtle);
  ctx.lineWidth = selected ? 2 : 1.2;
  roundRectPath(ctx, x, y, w, h, THEME.radius.medium);
  ctx.fill();
  ctx.stroke();

  if (!playable) {
    // 占位卡：虚线 + 锁 + 待扩展
    drawDashedBox(ctx, x + 5, y + 5, w - 10, h - 10, THEME.radius.small, THEME.border.subtle);
    drawLockIcon(ctx, x + w / 2, y + 26, 17, THEME.text.off);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 12px Arial';
    ctx.fillStyle = THEME.text.dim;
    ctx.fillText(lv.name, x + w / 2, y + 50);
    ctx.font = '10px Arial';
    ctx.fillStyle = THEME.text.off;
    ctx.fillText('待扩展', x + w / 2, y + 68);
    ctx.restore();
    return;
  }

  // 可玩卡：关卡名 + 副标题 + 状态
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 14px Arial';
  ctx.fillStyle = THEME.text.primary;
  ctx.fillText(lv.name, x + 12, y + 20);

  ctx.font = '10px Arial';
  ctx.fillStyle = THEME.text.secondary;
  ctx.fillText(ellipsize(ctx, lv.subtitle, w - 24), x + 12, y + 37);

  ctx.font = '10px Arial';
  ctx.fillStyle = THEME.text.dim;
  ctx.fillText(`${lv.waves} 波`, x + 12, y + 54);

  // 状态徽标（右上）
  const label = cleared ? '已通关' : (selected ? '进行中' : '可挑战');
  const chipColor = cleared ? THEME.accent.green : (selected ? THEME.accent.gold : THEME.team.red.light);
  ctx.font = 'bold 10px Arial';
  ctx.textAlign = 'right';
  ctx.fillStyle = chipColor;
  ctx.fillText(label, x + w - 12, y + 20);

  if (best > 0) {
    ctx.font = '10px Arial';
    ctx.fillStyle = THEME.text.off;
    ctx.fillText(`最高 ${best} 波`, x + w - 12, y + 37);
  }

  // 底部一行说明
  ctx.textAlign = 'left';
  ctx.font = '9px Arial';
  ctx.fillStyle = THEME.text.off;
  ctx.fillText(ellipsize(ctx, lv.desc || '', w - 24), x + 12, y + h - 16);

  ctx.restore();
}

module.exports = {
  LV_UI,
  getLevelBadgeRect,
  getLevelLayout,
  hitLevelSelect,
  drawLevelSelect,
};
