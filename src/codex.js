// ============================================================================
// 图签界面 —— src/codex.js
// ----------------------------------------------------------------------------
// 玩法（对应需求"用特殊积分解说图形塔，然后可以升级图形塔级分配图形塔的登场"）：
//   · 12 个图形塔格网；未解锁的显示剪影 + 🔒 + 解锁价
//   · 花"特殊积分"解锁 → 解锁即 Lv.1，之后可继续升级到 Lv.5
//   · 图签等级对战斗直接生效：该类型塔 +6%/级 攻击力（Lv.5 = +30%）
//   · 登场池：只有"已解锁 + 已登场"的塔才会出现在战斗商店的出货池里，上限 6
//
// 交互：点卡片 → 底部弹出详情面板（属性 + 解锁/升级 + 登场/下架）；点空白关闭。
// ============================================================================

const { TOWER_ORDER, TOWER_DEFS, LAYOUT, CODEX, RARITY } = require('./config');
const theme = require('./theme');
const towerMod = require('./tower');
const meta = require('./meta');

const {
  THEME, roundRectPath, drawTowerIcon, drawChip, drawButton, drawStar,
  drawLockIcon, drawTaperedDivider, ellipsize,
} = theme;

const CODEX_UI = {
  padX: 14,
  gap: 10,
  headerTop: LAYOUT.topBarHeight + 10,
  headerH: 30,
  gridTopGap: 12,
  cellMaxH: 106,
  cellMinH: 72,
  sheetH: 184,
  sheetGap: 8,
  gridBottomPad: 14,
};

/**
 * 图签布局（纯函数，渲染/输入共用）
 * @returns {{ cols, rows, header, grid: Array, sheet, cursor }}
 */
function getCodexLayout(game) {
  const W = game.canvas.width;
  const H = game.canvas.height;
  const navTop = H - LAYOUT.navHeight;

  const cols = W < 420 ? 3 : 4;
  const total = TOWER_ORDER.length;
  const rows = Math.ceil(total / cols);

  const cellW = Math.floor((W - CODEX_UI.padX * 2 - (cols - 1) * CODEX_UI.gap) / cols);
  const gridY = CODEX_UI.headerTop + CODEX_UI.headerH + CODEX_UI.gridTopGap;
  const availH = navTop - CODEX_UI.gridBottomPad - gridY;

  let cellH = Math.floor((availH - (rows - 1) * CODEX_UI.gap) / rows);
  cellH = Math.max(CODEX_UI.cellMinH, Math.min(CODEX_UI.cellMaxH, cellH));

  const gridW = cols * cellW + (cols - 1) * CODEX_UI.gap;
  const x0 = Math.round((W - gridW) / 2);

  const grid = TOWER_ORDER.map((type, i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    return {
      idx: i,
      type: type,
      x: x0 + c * (cellW + CODEX_UI.gap),
      y: gridY + r * (cellH + CODEX_UI.gap),
      w: cellW,
      h: cellH,
    };
  });

  // 标题栏：左 = 「图签」徽标，中 = 已解锁 / 登场进度，右 = 特殊积分
  // 宽度按屏宽自适应收窄，保证 320 宽的小屏也不会挤在一起。
  const headerCY = CODEX_UI.headerTop + CODEX_UI.headerH / 2;
  const pointsW = 76;
  const pointsX = W - CODEX_UI.padX - pointsW;
  const header = {
    brand:    { x: CODEX_UI.padX, y: headerCY - 11, w: 56, h: 22 },
    unlocked: { x: CODEX_UI.padX + 64, y: headerCY - 10, w: 74, h: 20 },
    lineup:   { x: CODEX_UI.padX + 64 + 74 + 6, y: headerCY - 10, w: 68, h: 20 },
    points:   { x: pointsX, y: headerCY - 10, w: pointsW, h: 20 },
  };

  // 详情面板（底部弹出，压在格网之上）
  const sheet = {
    x: CODEX_UI.padX,
    y: navTop - CODEX_UI.sheetH - CODEX_UI.sheetGap,
    w: W - CODEX_UI.padX * 2,
    h: CODEX_UI.sheetH,
  };

  return { cols, rows, cellW, cellH, gridY, header, grid, sheet, navTop };
}

/** 详情面板内的按钮矩形（依赖当前选中塔的状态） */
function getSheetButtons(game, sheet) {
  const gap = 10;
  const bw = Math.floor((sheet.w - 32 - gap) / 2);
  const bh = 36;
  const by = sheet.y + sheet.h - bh - 12;
  return {
    upgrade: { x: sheet.x + 16, y: by, w: bw, h: bh },
    lineup:  { x: sheet.x + 16 + bw + gap, y: by, w: bw, h: bh },
  };
}

/**
 * 命中检测（详情面板优先于格网）
 * @returns {{kind:'upgrade'|'lineup'|'card'|'close', type?:string}|null}
 */
function hitCodex(game, pos) {
  const L = getCodexLayout(game);
  const sel = game.codexSelected;

  if (sel) {
    const btns = getSheetButtons(game, L.sheet);
    if (theme.pointInRect(pos, btns.upgrade)) return { kind: 'upgrade', type: sel };
    if (theme.pointInRect(pos, btns.lineup))  return { kind: 'lineup', type: sel };
    if (theme.pointInRect(pos, L.sheet)) return { kind: 'none' }; // 面板内空白 → 吞掉，不误触格网
  }

  for (const cell of L.grid) {
    if (theme.pointInRect(pos, cell)) return { kind: 'card', type: cell.type };
  }

  return { kind: 'close' };
}

// ==================== 绘制 ====================

function drawCodex(game) {
  const ctx = game.ctx;
  const W = game.canvas.width;
  const H = game.canvas.height;

  // 背景（与战场同底色，避免切场景闪白）
  ctx.fillStyle = THEME.surface.page;
  ctx.fillRect(0, 0, W, H);

  const L = getCodexLayout(game);
  const m = meta.get();

  // ---- 标题栏 ----
  drawChip(ctx, {
    x: L.header.brand.x, y: L.header.brand.y, w: L.header.brand.w, h: L.header.brand.h,
    text: '图签', icon: '📖', color: THEME.text.primary, fontSize: 12,
    bg: THEME.track.soft, stroke: THEME.border.normal,
  });

  const unlockedCount = TOWER_ORDER.filter((t) => meta.isUnlocked(t)).length;
  const total = TOWER_ORDER.length;

  // 已解锁进度：放在标题栏中间（早先放在屏幕底部，会被详情面板压住半边）
  drawChip(ctx, {
    x: L.header.unlocked.x, y: L.header.unlocked.y, w: L.header.unlocked.w, h: L.header.unlocked.h,
    text: `${unlockedCount}/${total}`, color: THEME.text.secondary, fontSize: 10,
    bg: THEME.track.faint, stroke: THEME.border.subtle,
  });

  drawChip(ctx, {
    x: L.header.lineup.x, y: L.header.lineup.y, w: L.header.lineup.w, h: L.header.lineup.h,
    text: `${m.lineup.length}/${CODEX.lineupMax} 登场`, color: THEME.accent.violet, fontSize: 10,
    bg: 'rgba(179, 136, 255, 0.10)', stroke: 'rgba(179, 136, 255, 0.32)',
  });

  drawChip(ctx, {
    x: L.header.points.x, y: L.header.points.y, w: L.header.points.w, h: L.header.points.h,
    text: `${m.points}`, icon: '✨', color: THEME.accent.violet, fontSize: 11,
    bg: 'rgba(179, 136, 255, 0.12)', stroke: 'rgba(179, 136, 255, 0.35)',
  });

  // 格网下方的规则说明（一行小字，位置在详情面板之上，不会被压住）
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '10px Arial';
  ctx.fillStyle = THEME.text.off;
  ctx.fillText(`图签每级 +${CODEX.bonusPerLevel}% 攻击力 · 只有登场的图形塔会出现在商店`,
    W / 2, L.grid[L.grid.length - 1].y + L.grid[L.grid.length - 1].h + 9);

  // ---- 格网 ----
  for (const cell of L.grid) drawCodexCell(game, cell);

  // ---- 详情面板 ----
  if (game.codexSelected) drawSheet(game, L);
}

/** 单个图形塔格子 */
function drawCodexCell(game, cell) {
  const ctx = game.ctx;
  const def = TOWER_DEFS[cell.type];
  if (!def) return;

  const rarity = RARITY[def.rarity] || RARITY[1];
  const unlocked = meta.isUnlocked(cell.type);
  const level = meta.codexLevel(cell.type);
  const onLineup = meta.isInLineup(cell.type);
  const selected = game.codexSelected === cell.type;

  const { x, y, w, h } = cell;
  ctx.save();

  // 卡底
  const grad = ctx.createLinearGradient(x, y, x, y + h);
  if (unlocked) {
    grad.addColorStop(0, theme.shade(rarity.color, 0.15, 0.16));
    grad.addColorStop(1, theme.shade(rarity.color, -0.25, 0.05));
  } else {
    grad.addColorStop(0, 'rgba(255,255,255,0.05)');
    grad.addColorStop(1, 'rgba(255,255,255,0.02)');
  }
  ctx.fillStyle = grad;
  ctx.strokeStyle = selected
    ? THEME.accent.gold
    : (unlocked ? theme.shade(rarity.color, 0, 0.5) : THEME.border.subtle);
  ctx.lineWidth = selected ? 2 : 1.2;
  roundRectPath(ctx, x, y, w, h, THEME.radius.medium);
  ctx.fill();
  ctx.stroke();

  // 图标（未解锁 → 灰剪影）
  drawTowerIcon(ctx, x + w / 2, y + h * 0.36, unlocked ? def.color : THEME.text.off, cell.type, 0.94);

  if (!unlocked) {
    // 未解锁遮罩 + 锁
    ctx.fillStyle = THEME.surface.lock;
    roundRectPath(ctx, x, y, w, h, THEME.radius.medium);
    ctx.fill();
    drawLockIcon(ctx, x + w / 2, y + h * 0.36, 18, 'rgba(255,255,255,0.75)');
  }

  // 名称
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 11px Arial';
  ctx.fillStyle = unlocked ? THEME.text.primary : THEME.text.dim;
  const name = unlocked ? def.name : '???';
  ctx.fillText(ellipsize(ctx, name, w - 12), x + w / 2, y + h * 0.66);

  // 底部信息：Lv 星（已解锁）/ 解锁价（未解锁）
  const infoY = y + h * 0.85;
  if (unlocked) {
    const stars = level;
    const spacing = 9;
    const totalW = stars * spacing;
    const sx = x + w / 2 - totalW / 2;
    for (let i = 0; i < stars; i++) {
      drawStar(ctx, sx + i * spacing + 4.5, infoY, 4, THEME.accent.violet);
    }
  } else {
    const cost = meta.codexCost(cell.type, 1);
    ctx.font = 'bold 11px Arial';
    ctx.fillStyle = meta.get().points >= cost ? THEME.accent.violet : THEME.accent.danger;
    ctx.fillText(`✨${cost}`, x + w / 2, infoY);
  }

  // 登场标记（右上角小药丸）
  if (onLineup && unlocked) {
    const pw = 32, ph = 14;
    const px = x + w - pw - 5;
    const py = y + 5;
    drawChip(ctx, {
      x: px, y: py, w: pw, h: ph, text: '登场', color: '#0b0b16',
      bg: THEME.accent.violet, fontSize: 9,
    });
  }

  ctx.restore();
}

/** 底部详情面板（属性 + 解锁/升级 + 登场切换） */
function drawSheet(game, L) {
  const ctx = game.ctx;
  const sheet = L.sheet;
  const type = game.codexSelected;
  const def = TOWER_DEFS[type];
  if (!def) return;

  const stats = towerMod.getTowerStats(type);
  const rarity = RARITY[def.rarity] || RARITY[1];
  const level = meta.codexLevel(type);
  const unlocked = level > 0;
  const maxed = level >= CODEX.maxLevel;
  const cost = meta.codexCost(type, Math.min(CODEX.maxLevel, level + 1));
  const points = meta.get().points;
  const onLineup = meta.isInLineup(type);
  const dmgMult = meta.codexDamageMultiplier(type);
  const finalDamage = Math.round((stats.damage || 0) * dmgMult);
  const btns = getSheetButtons(game, sheet);

  ctx.save();

  // 面板底
  const bg = ctx.createLinearGradient(0, sheet.y, 0, sheet.y + sheet.h);
  bg.addColorStop(0, 'rgba(16, 16, 30, 0.98)');
  bg.addColorStop(1, 'rgba(8, 8, 18, 0.99)');
  ctx.fillStyle = bg;
  ctx.strokeStyle = theme.shade(rarity.color, -0.05, 0.7);
  ctx.lineWidth = 1.5;
  roundRectPath(ctx, sheet.x, sheet.y, sheet.w, sheet.h, THEME.radius.large);
  ctx.fill();
  ctx.stroke();

  // 标题区：图标 + 名称 + 稀有度 + 关闭提示
  const iconX = sheet.x + 30;
  const iconY = sheet.y + 30;
  drawTowerIcon(ctx, iconX, iconY, unlocked ? def.color : THEME.text.off, type);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const nameX = sheet.x + 54;
  ctx.font = 'bold 16px Arial';
  ctx.fillStyle = unlocked ? def.color : THEME.text.dim;
  ctx.fillText(def.name, nameX, sheet.y + 22);
  const nameW = ctx.measureText(def.name).width;

  ctx.font = '10px Arial';
  ctx.fillStyle = rarity.color;
  ctx.fillText(rarity.name, nameX + nameW + 12, sheet.y + 23);

  ctx.textAlign = 'right';
  ctx.font = '10px Arial';
  ctx.fillStyle = THEME.text.off;
  ctx.fillText('点空白关闭', sheet.x + sheet.w - 14, sheet.y + 22);

  // 描述（最多两行）
  ctx.textAlign = 'left';
  ctx.font = '11px Arial';
  ctx.fillStyle = THEME.text.secondary;
  const lines = theme.wrapTextLines(ctx, stats.description || '', sheet.w - 28, '11px Arial').slice(0, 2);
  lines.forEach((ln, i) => ctx.fillText(ln, sheet.x + 14, sheet.y + 46 + i * 14));

  // 分隔线
  drawTaperedDivider(ctx, sheet.x + sheet.w / 2, sheet.y + 78, sheet.w - 28, 4);

  // 属性行（含图签加成）——三等分，窄面板也不重叠
  const attrY = sheet.y + 92;
  const colW = (sheet.w - 28) / 3;
  ctx.textAlign = 'left';
  ctx.font = '11px Arial';
  const isSupport = !!stats.isSupport;
  let attrText;
  if (isSupport) {
    attrText = `光环 +${(stats.supportBuff && stats.supportBuff.attackSpeedMultiplier) || 0}%`;
  } else {
    attrText = `攻击 ${stats.damage}`;
    const bonus = finalDamage - (stats.damage || 0);
    if (bonus > 0) attrText += ` +${bonus}`;
  }
  ctx.fillStyle = THEME.text.dim;
  ctx.fillText(attrText, sheet.x + 14, attrY);
  ctx.fillText(`射程 ${stats.range}`, sheet.x + 14 + colW, attrY);
  ctx.fillText(`生命 ${stats.hp}`, sheet.x + 14 + colW * 2, attrY);

  // 图签等级（第二行左侧，避免与属性行/按钮挤在一起）
  ctx.textAlign = 'left';
  ctx.font = 'bold 11px Arial';
  ctx.fillStyle = THEME.accent.violet;
  ctx.fillText(unlocked ? `图签 Lv.${level}/${CODEX.maxLevel}  ·  伤害 +${Math.round((dmgMult - 1) * 100)}%` : '未解锁（需 ✨' + cost + '）', sheet.x + 14, attrY + 20);

  // ---- 按钮 1：解锁 / 升级 ----
  let upLabel, upEnabled, upSub;
  if (maxed) {
    upLabel = '已满级';
    upEnabled = false;
    upSub = '';
  } else if (!unlocked) {
    upLabel = '解锁';
    upSub = `✨${cost}`;
    upEnabled = points >= cost;
  } else {
    upLabel = '升级';
    upSub = `✨${cost}`;
    upEnabled = points >= cost;
  }
  drawButton(ctx, {
    x: btns.upgrade.x, y: btns.upgrade.y, w: btns.upgrade.w, h: btns.upgrade.h,
    top: upEnabled ? 'rgba(179, 136, 255, 0.42)' : THEME.track.soft,
    bottom: upEnabled ? 'rgba(126, 87, 194, 0.28)' : THEME.track.faint,
    stroke: upEnabled ? 'rgba(179, 136, 255, 0.8)' : THEME.border.subtle,
    label: upSub ? `${upLabel} ${upSub}` : upLabel,
    labelColor: upEnabled ? THEME.text.primary : THEME.text.off,
    fontSize: 14, radius: THEME.radius.medium,
    pressed: isUpgradePressed(game, type),
  });

  // ---- 按钮 2：登场 / 下架 ----
  let lineLabel, lineEnabled, lineTop, lineBottom, lineStroke;
  if (!unlocked) {
    lineLabel = '需先解锁';
    lineEnabled = false;
    lineTop = THEME.track.soft; lineBottom = THEME.track.faint; lineStroke = THEME.border.subtle;
  } else if (onLineup) {
    lineLabel = '下架';
    lineEnabled = true;
    lineTop = 'rgba(229, 115, 115, 0.34)'; lineBottom = 'rgba(183, 28, 28, 0.22)';
    lineStroke = 'rgba(229, 115, 115, 0.75)';
  } else {
    lineLabel = '登场';
    lineEnabled = true;
    lineTop = 'rgba(165, 214, 167, 0.40)'; lineBottom = 'rgba(76, 175, 80, 0.24)';
    lineStroke = 'rgba(165, 214, 167, 0.8)';
  }
  drawButton(ctx, {
    x: btns.lineup.x, y: btns.lineup.y, w: btns.lineup.w, h: btns.lineup.h,
    top: lineTop, bottom: lineBottom, stroke: lineStroke,
    label: lineLabel,
    labelColor: lineEnabled ? THEME.text.primary : THEME.text.off,
    fontSize: 14, radius: THEME.radius.medium,
    pressed: theme.isButtonPressed(game, 'codex:lineup:' + type),
  });

  ctx.restore();
}

/** 升级按钮按压态（id 带类型，避免换选中塔时状态串台） */
function isUpgradePressed(game, type) {
  return theme.isButtonPressed(game, 'codex:up:' + type);
}

// ==================== 操作 ====================

/**
 * 执行一次图签操作（由 input 层调用）
 * @returns {{ok:boolean, reason?:string, level?:number}}
 */
function actCodex(game, action, type) {
  if (!TOWER_DEFS[type]) return { ok: false, reason: 'unknown' };

  if (action === 'upgrade') {
    const res = meta.upgradeCodex(type);
    if (res.ok) {
      game.toast = {
        text: `图签提升 → Lv.${res.level}（+${res.level * CODEX.bonusPerLevel}% 攻击力）`,
        color: THEME.accent.violet,
        t0: Date.now(),
      };
    } else {
      game.toast = {
        text: res.reason === 'points' ? '特殊积分不足' : (res.reason === 'maxed' ? '图签已满级' : '无法提升'),
        color: THEME.accent.danger,
        t0: Date.now(),
      };
    }
    return res;
  }

  if (action === 'lineup') {
    const res = meta.toggleLineup(type);
    if (res.ok) {
      game.toast = {
        text: res.on ? `${TOWER_DEFS[type].name} 已登场` : `${TOWER_DEFS[type].name} 已下架`,
        color: res.on ? THEME.accent.green : THEME.text.secondary,
        t0: Date.now(),
      };
    } else {
      const msg = res.reason === 'full' ? `登场池已满（${CODEX.lineupMax}）`
        : (res.reason === 'last' ? '至少保留 1 个登场图形塔' : '需先解锁');
      game.toast = { text: msg, color: THEME.accent.danger, t0: Date.now() };
    }
    return res;
  }

  return { ok: false, reason: 'unknown-action' };
}

module.exports = {
  CODEX_UI,
  getCodexLayout,
  getSheetButtons,
  hitCodex,
  drawCodex,
  actCodex,
};
