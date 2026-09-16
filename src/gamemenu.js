// ============================================================================
// 游戏中菜单 —— src/gamemenu.js
// ----------------------------------------------------------------------------
// 入口：战斗场景顶栏右侧的 ☰ 按钮（顶栏唯一可点元素）。
// 内容：返回战斗（继续）/ 放弃结束（结束本局，回到战前选关）。
//
// 为什么单独一个文件：levels.js 管"战前选关"，本文件管"战中菜单"，
// 两者都是模态浮层但与战斗流程正交，拆开以后各自扩展互不干扰。
// ============================================================================

const { LAYOUT } = require('./config');
const theme = require('./theme');

const { THEME, roundRectPath, drawButton, drawPillTitle, drawButtonFx } = theme;

const MENU_UI = {
  // 顶栏 ☰ 图标按钮尺寸（必须 ≤ LAYOUT.topBarHeight，否则会顶出屏幕）
  iconW: 28,
  iconH: 24,
  btnMarginRight: 8,
  panelMaxW: 300,
  padX: 24,
  // 面板纵向节奏：padTop → 标题 → infoGap → 信息行 → gap → 放弃 → gap → 返回 → padBottom
  // （panelH 由下面几项自动算出，别再手写常量，否则标题/信息行会被按钮压住）
  padTop: 22,
  padBottom: 26,
  titleH: 26,
  infoH: 16,
  infoGap: 10,
  // 菜单面板里的操作按钮高度
  actionH: 48,
  gap: 12,
};

MENU_UI.panelH = MENU_UI.padTop + MENU_UI.titleH + MENU_UI.infoGap + MENU_UI.infoH
  + MENU_UI.gap + MENU_UI.actionH + MENU_UI.gap + MENU_UI.actionH + MENU_UI.padBottom;

/** 顶栏 ☰ 按钮矩形（渲染/输入共用） */
function getMenuButtonRect(game) {
  const W = game.canvas.width;
  const H = LAYOUT.topBarHeight;
  return {
    x: W - MENU_UI.btnMarginRight - MENU_UI.iconW,
    y: Math.round((H - MENU_UI.iconH) / 2),
    w: MENU_UI.iconW,
    h: MENU_UI.iconH,
  };
}

/** 菜单面板布局 */
function getMenuLayout(game) {
  const W = game.canvas.width;
  const H = game.canvas.height;

  const panelW = Math.min(MENU_UI.panelMaxW, W - 48);
  const panelH = MENU_UI.panelH;
  const panelX = Math.round((W - panelW) / 2);
  const panelY = Math.round((H - panelH) / 2);

  const inner = panelW - MENU_UI.padX * 2;
  const titleCY = panelY + MENU_UI.padTop + MENU_UI.titleH / 2;
  const infoY = titleCY + MENU_UI.titleH / 2 + MENU_UI.infoGap + MENU_UI.infoH / 2;
  const abandonY = infoY + MENU_UI.infoH / 2 + MENU_UI.gap;
  const resumeY = abandonY + MENU_UI.actionH + MENU_UI.gap;

  return {
    panel: { x: panelX, y: panelY, w: panelW, h: panelH },
    titleCY: titleCY,
    infoY: infoY,
    resume: { x: panelX + MENU_UI.padX, y: resumeY, w: inner, h: MENU_UI.actionH },
    abandon: { x: panelX + MENU_UI.padX, y: abandonY, w: inner, h: MENU_UI.actionH },
  };
}

/** 命中检测：{kind:'resume'|'abandon'|'none'} */
function hitMenu(game, pos) {
  const L = getMenuLayout(game);
  if (theme.pointInRect(pos, L.resume)) return { kind: 'resume' };
  if (theme.pointInRect(pos, L.abandon)) return { kind: 'abandon' };
  return { kind: 'none' };
}

/** 绘制 ☰ 图标（三条横线） */
function drawMenuIcon(ctx, rect, color) {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const w = 13;
  const gap = 4;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.moveTo(cx - w / 2, cy + i * gap);
    ctx.lineTo(cx + w / 2, cy + i * gap);
    ctx.stroke();
  }
  ctx.restore();
}

/** ☰ 按钮（顶栏右侧，唯一可点元素） */
function drawMenuButton(game) {
  const ctx = game.ctx;
  const r = getMenuButtonRect(game);
  const pressed = theme.isButtonPressed(game, 'menu:open');

  ctx.save();
  ctx.fillStyle = pressed ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.06)';
  ctx.strokeStyle = THEME.border.normal;
  ctx.lineWidth = 1;
  roundRectPath(ctx, r.x, r.y, r.w, r.h, THEME.radius.small);
  ctx.fill();
  ctx.stroke();
  drawMenuIcon(ctx, r, THEME.text.primary);
  ctx.restore();
}

/** 游戏中菜单浮层 */
function drawGameMenu(game) {
  const ctx = game.ctx;
  const W = game.canvas.width;
  const H = game.canvas.height;
  const L = getMenuLayout(game);

  ctx.save();

  // 遮罩
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
  drawPillTitle(ctx, W / 2, L.titleCY, '游戏菜单',
    'rgba(229, 115, 115, 0.45)', 'rgba(100, 181, 246, 0.35)',
    L.panel.w - MENU_UI.padX * 2, 18);

  // 说明
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '11px Arial';
  ctx.fillStyle = THEME.text.dim;
  ctx.fillText(`关卡 ${game.currentLevel} · 第 ${game.currentWave} 波 · 💰${game.gold}`, W / 2, L.infoY);

  // 返回战斗（主操作 = 增益绿）
  drawButton(ctx, {
    x: L.resume.x, y: L.resume.y, w: L.resume.w, h: L.resume.h,
    top: 'rgba(165, 214, 167, 0.5)', bottom: 'rgba(76, 175, 80, 0.32)',
    stroke: 'rgba(165, 214, 167, 0.8)',
    label: '返回战斗', labelColor: THEME.text.primary,
    fontSize: 17, radius: THEME.radius.medium,
    pressed: theme.isButtonPressed(game, 'menu:resume'),
  });

  // 放弃结束（危险 = 红）
  drawButton(ctx, {
    x: L.abandon.x, y: L.abandon.y, w: L.abandon.w, h: L.abandon.h,
    top: 'rgba(229, 115, 115, 0.40)', bottom: 'rgba(183, 28, 28, 0.26)',
    stroke: 'rgba(229, 115, 115, 0.78)',
    label: '放弃结束', labelColor: THEME.text.primary,
    fontSize: 17, radius: THEME.radius.medium,
    pressed: theme.isButtonPressed(game, 'menu:abandon'),
  });

  ctx.restore();

  // 菜单按钮的点击波纹（只画 menu 层的）——例如点「返回战斗」时菜单已经关了，
  // 这一帧之后没有 menu 层再绘制它，波纹自然随 450ms 过期消失，不会飘到战场上。
  drawButtonFx(game, ctx, 'menu');
}

module.exports = {
  MENU_UI,
  getMenuButtonRect,
  getMenuLayout,
  hitMenu,
  drawMenuIcon,
  drawMenuButton,
  drawGameMenu,
};
