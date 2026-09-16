// ============================================================================
// 关卡选择 —— src/levels.js
// ----------------------------------------------------------------------------
// 2026-09 改版（第一次）：左上角「关卡 N」徽标改为【纯展示不可点】，
//                          关卡选择搬到【战前】居中面板。
// 2026-09 改版（第二次，本次）：左右两列卡片网格 → 【天梯 / 爬梯】纵向台阶。
// ----------------------------------------------------------------------------
// 为什么换：左右两列的网格"关卡一多就没法看"——只能一行一行往外挤，
// 屏幕塞不下就溢出，而且视觉上完全表达不出"越往上越难"。
// 现在：
//   · 关卡 1 在最底（起点），关卡越高越往上摞，中间一条"梯绳"把它们串起来；
//   · 每张卡交错挂在梯绳左右两侧，像一级级台阶；
//   · 内容高于视口时上下拖动查看（默认贴底，正好停在关卡 1），右侧有滚动条。
// 浮层是模态的：点卡片切关卡、其它触摸一律吞掉（不吃到底下的商店/槽位）。
// ============================================================================

const { LEVELS, LAYOUT } = require('./config');
const theme = require('./theme');
const meta = require('./meta');

const {
  THEME, roundRectPath, drawButton, drawLockIcon, drawDashedBox, drawPillTitle,
  ellipsize, drawScrollBar, drawScrollHint, drawButtonFx,
} = theme;

const LV_UI = {
  padX: 18,
  rowH: 62,          // 单级台阶（关卡卡）高
  gap: 14,           // 台阶之间的纵向间距
  titleH: 44,
  padY: 18,
  startH: 48,
  cardGapTop: 12,
  cardWRatio: 0.60,  // 关卡卡宽 = 内容宽 × 此比例（剩下 40% 留给中间的梯绳）
  railW: 3,          // 梯绳宽度
};

/**
 * 战斗场景顶部状态栏里的「关卡 N」徽标矩形（纯展示，不再可点击）。
 */
function getLevelBadgeRect(game) {
  const H = LAYOUT.topBarHeight;
  return { x: 8, y: Math.round((H - 22) / 2), w: 78, h: 22 };
}

/**
 * 战前选关（天梯）布局 —— 纯函数，渲染 / 输入共用
 * @returns {{ panel, titleCY, cards, startBtn, navTop, viewport, rail, contentH, maxScroll, scroll }}
 */
function getReadyLayout(game) {
  const W = game.W;
  const H = game.H;
  const navTop = H - LAYOUT.navHeight;

  const panelW = Math.min(340, W - LV_UI.padX * 2);
  const panelX = Math.round((W - panelW) / 2);
  const innerW = panelW - LV_UI.padX * 2;

  const n = LEVELS.length;
  const contentH = n * LV_UI.rowH + Math.max(0, n - 1) * LV_UI.gap;

  // 非滚动部分的固定高度：上下内边距 + 标题 + 两处间距 + 开始按钮
  const fixedH = LV_UI.padY * 2 + LV_UI.titleH + LV_UI.cardGapTop * 2 + LV_UI.startH;

  // 面板高：能一次全放下最好；放不下就顶到屏幕允许的最大高度，剩下的交给滚动
  const minY = LAYOUT.topBarHeight + 8;
  const maxPanelH = Math.max(240, navTop - 8 - minY);
  const panelH = Math.min(fixedH + contentH, maxPanelH);

  let panelY = Math.round((navTop - panelH) / 2);
  panelY = Math.max(minY, Math.min(panelY, navTop - panelH - 8));

  const titleCY = panelY + LV_UI.padY + LV_UI.titleH / 2;
  const startBtn = {
    x: panelX + LV_UI.padX,
    y: panelY + panelH - LV_UI.padY - LV_UI.startH,
    w: innerW,
    h: LV_UI.startH,
  };

  const viewportTop = panelY + LV_UI.padY + LV_UI.titleH + LV_UI.cardGapTop;
  const viewportBottom = startBtn.y - LV_UI.cardGapTop;
  const viewportH = Math.max(60, viewportBottom - viewportTop);

  const maxScroll = Math.max(0, contentH - viewportH);
  // 默认贴底：镜头停在"地面"上，正好看到关卡 1
  const raw = (game.levelScroll === null || game.levelScroll === undefined)
    ? maxScroll : game.levelScroll;
  const scroll = Math.max(0, Math.min(maxScroll, raw));

  const cardW = Math.round(innerW * LV_UI.cardWRatio);
  const cards = LEVELS.map((lv, i) => {
    // 关卡 1 在最底（fromTop 最大），关卡越高 fromTop 越小
    const fromTop = (n - 1) - i;
    const leftSide = (fromTop % 2 === 0);
    return {
      level: lv,
      idx: i,
      fromTop: fromTop,
      x: leftSide ? (panelX + LV_UI.padX) : (panelX + LV_UI.padX + innerW - cardW),
      y: viewportTop + fromTop * (LV_UI.rowH + LV_UI.gap) - scroll,
      w: cardW,
      h: LV_UI.rowH,
      side: leftSide ? -1 : 1,   // -1 = 挂在梯绳左侧，1 = 右侧
    };
  });

  return {
    panel: { x: panelX, y: panelY, w: panelW, h: panelH },
    titleCY: titleCY,
    cards: cards,
    startBtn: startBtn,
    navTop: navTop,
    viewport: { x: panelX + LV_UI.padX, y: viewportTop, w: innerW, h: viewportH },
    rail: {
      x: Math.round(panelX + panelW / 2),
      top: viewportTop,
      bottom: viewportBottom,
    },
    contentH: contentH,
    maxScroll: maxScroll,
    scroll: scroll,
  };
}

/** 把滚动值夹到合法区间并写回 game（输入层滚动手势用） */
function setLevelScroll(game, value) {
  const L = getReadyLayout(game);
  game.levelScroll = Math.max(0, Math.min(L.maxScroll, value || 0));
  return game.levelScroll;
}

/** 天梯当前是否需要滚动 */
function isReadyScrollable(game) {
  return getReadyLayout(game).maxScroll > 0;
}

/**
 * 计算某关卡卡片居中显示所需的 scroll 值，并写回 game.levelScroll。
 * 选中关卡切换后调用 → 选关界面始终停在选中关卡的位置。
 * @param {number} levelId
 * @returns {number} 实际设置的 scroll 值
 */
function scrollToLevel(game, levelId) {
  const L0 = getReadyLayout(game);  // getReadyLayout 内部会根据 game.levelScroll 计算 scroll
  const idx = Math.max(0, Math.min(LEVELS.length - 1, (levelId || 1) - 1));
  const card = L0.cards[idx];
  if (!card) return L0.scroll;

  const rowStep = LV_UI.rowH + LV_UI.gap;
  // fromTop 越大（越底层），scroll 应该越大（内容越往下滚）
  // 默认贴底时 scroll=maxScroll，关卡1（fromTop 最大）正好落在 viewport 中间
  const viewportCenter = L0.viewport.y + L0.viewport.h / 2;
  // 原始位置（scroll=0 时）：viewportTop + fromTop * rowStep
  const rawY = L0.viewport.y + card.fromTop * rowStep;
  // 居中条件：rawY + h/2 - scroll = viewportCenter
  const targetScroll = rawY + card.h / 2 - viewportCenter;
  return setLevelScroll(game, targetScroll);
}

/**
 * 命中检测（视口外的台阶不可点）。面板内空白也吞掉，避免误触到下面的战场。
 * @returns {{kind:'level', id:number}|{kind:'locked', id:number, reason:'progression'|'not_implemented'}|{kind:'start'}|{kind:'none'}}
 */
function hitReady(game, pos) {
  const L = getReadyLayout(game);

  if (theme.pointInRect(pos, L.startBtn)) return { kind: 'start' };

  const v = L.viewport;
  if (pos.y >= v.y && pos.y <= v.y + v.h) {
    for (const card of L.cards) {
      if (card.y + card.h <= v.y || card.y >= v.y + v.h) continue;
      if (theme.pointInRect(pos, card)) {
        const lv = card.level;
        if (!meta.isLevelPlayable(lv.id)) {
          return { kind: 'locked', id: lv.id, reason: 'not_implemented' };
        }
        if (meta.isLevelUnlocked(lv.id)) {
          return { kind: 'level', id: lv.id };
        }
        return { kind: 'locked', id: lv.id, reason: 'progression' };
      }
    }
  }
  return { kind: 'none' };
}

// ==================== 绘制 ====================

/** 战前选关界面（遮罩 + 居中面板 + 天梯 + 开始游戏） */
function drawBattleReady(game) {
  const ctx = game.ctx;
  const W = game.W;
  const H = game.H;

  const L = getReadyLayout(game);

  ctx.save();

  // 全屏遮罩（压暗战场，让中心面板成为唯一焦点）
  ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
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

  // 标题 + 副标题（提示可以滑）
  drawPillTitle(ctx, W / 2, L.titleCY, '选择关卡',
    'rgba(229, 115, 115, 0.45)', 'rgba(100, 181, 246, 0.35)',
    L.panel.w - 40, 18);

  // ---- 天梯（裁剪在视口内）----
  ctx.save();
  ctx.beginPath();
  ctx.rect(L.viewport.x, L.viewport.y, L.viewport.w, L.viewport.h);
  ctx.clip();

  drawLadderRail(game, L);
  for (const card of L.cards) {
    if (card.y + card.h <= L.viewport.y) continue;
    if (card.y >= L.viewport.y + L.viewport.h) continue;
    drawLadderCard(game, card, L);
  }
  ctx.restore();

  // ---- 滚动条 + 上下渐隐箭头 ----
  drawScrollBar(ctx, L.viewport, L.scroll, L.maxScroll, L.viewport.h, L.contentH);
  drawScrollHint(ctx, L.viewport, L.scroll, L.maxScroll, 'rgba(16, 16, 30, 0.95)', THEME.team.blue.light);

  // 开始游戏按钮（主操作 = 增益绿）
  drawButton(ctx, {
    x: L.startBtn.x, y: L.startBtn.y, w: L.startBtn.w, h: L.startBtn.h,
    top: 'rgba(165, 214, 167, 0.52)', bottom: 'rgba(76, 175, 80, 0.34)',
    stroke: 'rgba(165, 214, 167, 0.85)',
    label: '开始游戏', labelColor: THEME.text.primary,
    fontSize: 18, radius: THEME.radius.medium,
    pressed: theme.isButtonPressed(game, 'ready:start'),
  });

  // 底部说明（走面板内边距那一行，不再越出面板）
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '10px Arial';
  ctx.fillStyle = THEME.text.off;
  ctx.fillText(
    L.maxScroll > 0 ? '上下滑动查看更高难度 · 点卡片选关' : '点卡片切换目标关卡，准备好后开始游戏',
    W / 2, L.panel.y + L.panel.h - LV_UI.padY / 2
  );

  ctx.restore();

  // 「开始游戏」按钮的点击波纹（只画 ready 层的）
  drawButtonFx(game, ctx, 'ready');
}

/**
 * 中间那条"梯绳"：竖虚线 + 每级台阶的横档（rung）+ 状态圆点。
 * 关卡 1 在最底、越高越往上，一眼就能读出"往上爬 = 更难"。
 */
function drawLadderRail(game, L) {
  const ctx = game.ctx;
  const rx = L.rail.x;

  ctx.save();

  // 梯绳（竖直虚线）
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
  ctx.lineWidth = LV_UI.railW;
  ctx.setLineDash([5, 6]);
  ctx.beginPath();
  ctx.moveTo(rx, L.rail.top);
  ctx.lineTo(rx, L.rail.bottom);
  ctx.stroke();
  ctx.setLineDash([]);

  // 横档 + 状态点
  const selectedId = meta.getSelectedLevel();
  for (const card of L.cards) {
    const cy = card.y + card.h / 2;
    if (cy < L.rail.top - 4 || cy > L.rail.bottom + 4) continue;

    const lv = card.level;
    const playable = meta.isLevelPlayable(lv.id);
    const unlocked = playable && meta.isLevelUnlocked(lv.id);
    const cleared = unlocked && meta.isLevelCleared(lv.id);
    const selected = selectedId === lv.id;
    // 状态点颜色：待扩展（完全灰）、进度锁定（深灰）、已通关（绿环）、选中（金）、普通（红）
    let dotColor;
    if (!playable) dotColor = THEME.text.off;
    else if (!unlocked) dotColor = 'rgba(120, 120, 140, 0.7)';
    else if (selected) dotColor = THEME.accent.gold;
    else if (cleared) dotColor = THEME.accent.green;
    else dotColor = THEME.team.red.light;

    // 从梯绳横到卡片边缘的横档
    const cardInnerEdge = card.side < 0 ? (card.x + card.w) : card.x;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(rx, cy);
    ctx.lineTo(cardInnerEdge, cy);
    ctx.stroke();

    // 状态圆点
    ctx.beginPath();
    ctx.arc(rx, cy, selected ? 6 : 4.5, 0, Math.PI * 2);
    ctx.fillStyle = dotColor;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 已通关：点上一圈绿环
    if (cleared) {
      ctx.beginPath();
      ctx.arc(rx, cy, 9, 0, Math.PI * 2);
      ctx.strokeStyle = THEME.accent.green;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  ctx.restore();
}

/** 单级台阶（关卡卡）—— 四种状态颜色语义明确区分 */
function drawLadderCard(game, card, L) {
  const ctx = game.ctx;
  const lv = card.level;
  const { x, y, w, h } = card;
  const playable = meta.isLevelPlayable(lv.id);
  const unlocked = playable && meta.isLevelUnlocked(lv.id);
  const cleared = unlocked && meta.isLevelCleared(lv.id);
  const selected = meta.getSelectedLevel() === lv.id;
  const best = meta.bestWaveOf(lv.id);

  // ---- 状态优先级：选中 > 通关 > 可挑战 > 进度锁定 > 待扩展 ----
  // （选中时不强调"已通关"——选中本身是玩家动作，通关是历史状态）
  let state;
  if (!playable) state = 'not_impl';
  else if (!unlocked) state = 'prog_locked';
  else if (selected) state = 'selected';
  else if (cleared) state = 'cleared';
  else state = 'normal';

  ctx.save();

  // ---- 卡片底渐变 ----
  const grad = ctx.createLinearGradient(x, y, x, y + h);
  let strokeColor, strokeWidth, textColor, chipColor;
  switch (state) {
    case 'not_impl':
      grad.addColorStop(0, 'rgba(255, 255, 255, 0.05)');
      grad.addColorStop(1, 'rgba(255, 255, 255, 0.02)');
      strokeColor = THEME.border.subtle;
      strokeWidth = 1;
      break;
    case 'prog_locked':
      grad.addColorStop(0, 'rgba(120, 120, 140, 0.18)');
      grad.addColorStop(1, 'rgba(80, 80, 100, 0.08)');
      strokeColor = 'rgba(180, 180, 200, 0.45)';
      strokeWidth = 1.2;
      break;
    case 'normal':
      grad.addColorStop(0, 'rgba(229, 115, 115, 0.22)');
      grad.addColorStop(1, 'rgba(100, 181, 246, 0.10)');
      strokeColor = 'rgba(229, 115, 115, 0.75)';
      strokeWidth = 1.4;
      break;
    case 'cleared':
      grad.addColorStop(0, 'rgba(76, 175, 80, 0.28)');
      grad.addColorStop(1, 'rgba(139, 195, 74, 0.10)');
      strokeColor = 'rgba(76, 175, 80, 0.9)';
      strokeWidth = 1.6;
      break;
    case 'selected':
      grad.addColorStop(0, 'rgba(255, 215, 0, 0.28)');
      grad.addColorStop(1, 'rgba(255, 183, 77, 0.10)');
      strokeColor = THEME.accent.gold;
      strokeWidth = 2.5;
      break;
  }
  ctx.fillStyle = grad;
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = strokeWidth;
  roundRectPath(ctx, x, y, w, h, THEME.radius.medium);
  ctx.fill();
  ctx.stroke();

  // 选中态：额外的金色外发光（呼吸感）
  if (state === 'selected') {
    const t = Math.sin(Date.now() / 350) * 0.3 + 0.7;  // 0.4 ~ 1.0
    ctx.shadowColor = 'rgba(255, 215, 0, ' + (0.45 * t).toFixed(2) + ')';
    ctx.shadowBlur = 14;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  // ---- 进度锁定：虚线框 + 锁 + 灰色文字，带引导"通关前一关解锁" ----
  if (state === 'prog_locked') {
    drawDashedBox(ctx, x + 4, y + 4, w - 8, h - 8, THEME.radius.small, strokeColor);
    drawLockIcon(ctx, x + 26, y + h / 2, 16, THEME.text.off);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 13px Arial';
    ctx.fillStyle = THEME.text.dim;
    ctx.fillText(lv.name, x + 44, y + h / 2 - 8);
    ctx.font = '10px Arial';
    ctx.fillStyle = 'rgba(200, 200, 220, 0.55)';
    ctx.fillText(`通关关卡 ${lv.id - 1} 解锁`, x + 44, y + h / 2 + 9);
    ctx.restore();
    return;
  }

  // ---- 待扩展：虚线 + 锁 + 灰字 ----
  if (state === 'not_impl') {
    drawDashedBox(ctx, x + 4, y + 4, w - 8, h - 8, THEME.radius.small, THEME.border.subtle);
    drawLockIcon(ctx, x + 26, y + h / 2, 16, THEME.text.off);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 13px Arial';
    ctx.fillStyle = THEME.text.dim;
    ctx.fillText(lv.name, x + 44, y + h / 2 - 8);
    ctx.font = '10px Arial';
    ctx.fillStyle = THEME.text.off;
    ctx.fillText('待扩展', x + 44, y + h / 2 + 9);
    ctx.restore();
    return;
  }

  // ---- 可玩台阶：关卡名 + 副标题 / 波数 + 最高波次 ----
  ctx.textBaseline = 'middle';

  // 状态决定文字颜色
  switch (state) {
    case 'selected': textColor = THEME.accent.gold; chipColor = THEME.accent.gold; break;
    case 'cleared':  textColor = THEME.accent.green; chipColor = THEME.accent.green; break;
    case 'normal':   textColor = THEME.text.primary; chipColor = 'rgba(229, 115, 115, 0.95)'; break;
  }

  ctx.textAlign = 'left';
  ctx.font = 'bold 14px Arial';
  ctx.fillStyle = textColor;
  ctx.fillText(lv.name, x + 12, y + 15);

  ctx.font = '10px Arial';
  ctx.fillStyle = THEME.text.secondary;
  ctx.fillText(ellipsize(ctx, lv.subtitle, w - 24), x + 12, y + 32);

  ctx.font = '10px Arial';
  ctx.fillStyle = THEME.text.dim;
  ctx.fillText(`${lv.waves} 波`, x + 12, y + 49);

  // 右上：状态徽标
  let label;
  if (state === 'selected') label = '● 已选中';
  else if (state === 'cleared') label = '✓ 已通关';
  else label = '可挑战';
  ctx.font = 'bold 10px Arial';
  ctx.textAlign = 'right';
  ctx.fillStyle = chipColor;
  ctx.fillText(label, x + w - 12, y + 15);

  if (best > 0) {
    ctx.font = '10px Arial';
    ctx.fillStyle = THEME.text.off;
    ctx.fillText(`最高 ${best} 波`, x + w - 12, y + 49);
  }

  // 已通关右下角：绿色 ✓ 角标（更醒目的视觉锚点）
  if (state === 'cleared') {
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.font = 'bold 20px Arial';
    ctx.fillStyle = 'rgba(76, 175, 80, 0.85)';
    ctx.fillText('✓', x + w - 6, y + h - 2);
  }

  // 选中左下角：金色 ◆ 小标记（与右上状态徽标呼应）
  if (state === 'selected') {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.font = 'bold 14px Arial';
    ctx.fillStyle = 'rgba(255, 215, 0, 0.9)';
    ctx.fillText('◆', x + 10, y + h - 3);
  }

  ctx.restore();
}

module.exports = {
  LV_UI,
  getLevelBadgeRect,
  getReadyLayout,
  setLevelScroll,
  scrollToLevel,
  isReadyScrollable,
  hitReady,
  drawBattleReady,
  drawLadderRail,
  drawLevelCard,
};

/** 兼容旧名（外部若还按旧名字调用，等价于画一级台阶） */
function drawLevelCard(game, card) {
  const L = getReadyLayout(game);
  drawLadderCard(game, card, L);
}
