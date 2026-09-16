// ============================================================================
// 天赋界面 —— src/talents.js
// ----------------------------------------------------------------------------
// 玩法（对应需求"玩家用到的各种功能的天赋学习"）：
//   · 10 条天赋覆盖玩家侧功能：经济（开局/击杀/BOSS/每秒/波次）/ 生存 / 商店 / 图签 / 积分
//   · 消耗"天赋点"逐级学习；天赋点来源见 config.TALENT_POINTS
//   · 数值口径集中在 config.TALENT_EFFECT，由 game_core / meta 统一读取生效
//
// 2026-09 重做要点：
//   · 每级数值下调、可学习等级提高（长线成长）
//   · 条目变多后，列表在放不下时【可上下拖动滚动】，保证任何分辨率都能学到最后一条
//
// 本文件只管"展示 + 学习 + 滚动"，不改战斗逻辑——战斗侧的取值在 game_core。
// ============================================================================

const { TALENTS, LAYOUT, TALENT_POINTS } = require('./config');
const theme = require('./theme');
const meta = require('./meta');

const { THEME, roundRectPath, drawChip, drawButton, ellipsize, drawScrollBar } = theme;

const TALENT_UI = {
  padX: 14,
  gap: 8,
  headerTop: LAYOUT.topBarHeight + 10,
  headerH: 30,
  listTopGap: 14,
  bottomPad: 14,
  rowMaxH: 72,
  rowMinH: 52,
  radius: 12,
  hintH: 16,          // 底部提示行预留高度
};

/**
 * 天赋界面布局（纯函数，渲染/输入共用）
 * @returns {{ header, rows, viewport, maxScroll, scroll, navTop, hintY }}
 */
function getTalentLayout(game) {
  const W = game.W;
  const H = game.H;
  const navTop = H - LAYOUT.navHeight;

  const listTop = TALENT_UI.headerTop + TALENT_UI.headerH + TALENT_UI.listTopGap;
  const listBottom = navTop - TALENT_UI.bottomPad - TALENT_UI.hintH;
  const listH = Math.max(0, listBottom - listTop);
  const n = TALENTS.length;

  // 行高自适应：能撑开就撑开，撑不开退到下限并开启滚动
  let rowH = Math.floor((listH - (n - 1) * TALENT_UI.gap) / n);
  rowH = Math.max(TALENT_UI.rowMinH, Math.min(TALENT_UI.rowMaxH, rowH));

  const contentH = n * rowH + (n - 1) * TALENT_UI.gap;
  const maxScroll = Math.max(0, contentH - listH);
  const scroll = Math.max(0, Math.min(maxScroll, game.talentScroll || 0));

  const rowW = W - TALENT_UI.padX * 2;
  const rows = TALENTS.map((def, i) => ({
    idx: i,
    def: def,
    x: TALENT_UI.padX,
    y: listTop + i * (rowH + TALENT_UI.gap) - scroll,
    w: rowW,
    h: rowH,
  }));

  const headerCY = TALENT_UI.headerTop + TALENT_UI.headerH / 2;
  const header = {
    brand:  { x: TALENT_UI.padX, y: headerCY - 11, w: 56, h: 22 },
    points: { x: W - TALENT_UI.padX - 96, y: headerCY - 10, w: 96, h: 20 },
  };

  return {
    header,
    rows,
    viewport: { x: 0, y: listTop, w: W, h: listH },
    maxScroll,
    scroll,
    contentH,
    navTop,
    hintY: navTop - TALENT_UI.bottomPad - TALENT_UI.hintH / 2,
  };
}

/** 把滚动值夹到合法区间并写回 game（输入层滚动手势用） */
function setTalentScroll(game, value) {
  const L = getTalentLayout(game);
  game.talentScroll = Math.max(0, Math.min(L.maxScroll, value || 0));
  return game.talentScroll;
}

/** 该界面当前是否需要滚动 */
function isScrollable(game) {
  return getTalentLayout(game).maxScroll > 0;
}

/** 每行"学习"按钮的矩形 */
function getLearnButton(row) {
  const bw = 78, bh = 28;
  return {
    x: row.x + row.w - bw - 12,
    y: row.y + Math.round((row.h - bh) / 2),
    w: bw,
    h: bh,
  };
}

/** 命中检测：返回 {kind:'learn', id} 或 null */
function hitTalents(game, pos) {
  const L = getTalentLayout(game);
  // 视口外的行不可点
  if (pos.y < L.viewport.y || pos.y > L.viewport.y + L.viewport.h) return null;
  for (const row of L.rows) {
    if (row.y + row.h <= L.viewport.y) continue;
    if (row.y >= L.viewport.y + L.viewport.h) continue;
    const btn = getLearnButton(row);
    if (theme.pointInRect(pos, btn)) return { kind: 'learn', id: row.def.id };
  }
  return null;
}

/** 学习下一级天赋 */
function learn(game, id) {
  const res = meta.learnTalent(id);
  const def = TALENTS.filter((t) => t.id === id)[0];
  if (res.ok) {
    game.toast = {
      text: `${def ? def.name : id} → Lv.${res.level}`,
      color: THEME.accent.cyan,
      t0: Date.now(),
    };
  } else {
    const msg = res.reason === 'points' ? '天赋点不足'
      : (res.reason === 'maxed' ? '该天赋已精通' : '无法学习');
    game.toast = { text: msg, color: THEME.accent.danger, t0: Date.now() };
  }
  return res;
}

// ==================== 绘制 ====================

function drawTalents(game) {
  const ctx = game.ctx;
  const W = game.W;
  const H = game.H;

  ctx.fillStyle = THEME.surface.page;
  ctx.fillRect(0, 0, W, H);

  const L = getTalentLayout(game);
  const m = meta.get();

  // ---- 标题栏 ----
  drawChip(ctx, {
    x: L.header.brand.x, y: L.header.brand.y, w: L.header.brand.w, h: L.header.brand.h,
    text: '天赋', color: THEME.text.primary, fontSize: 12,
    bg: THEME.track.soft, stroke: THEME.border.normal,
  });

  drawChip(ctx, {
    x: L.header.points.x, y: L.header.points.y, w: L.header.points.w, h: L.header.points.h,
    text: `${m.talentPoints}`, icon: '✦', color: THEME.accent.cyan, fontSize: 11,
    bg: 'rgba(77, 208, 225, 0.12)', stroke: 'rgba(77, 208, 225, 0.35)',
  });

  // ---- 天赋列表（裁剪在视口内，超出部分靠滚动看）----
  ctx.save();
  ctx.beginPath();
  ctx.rect(L.viewport.x, L.viewport.y, L.viewport.w, L.viewport.h);
  ctx.clip();
  for (const row of L.rows) {
    if (row.y + row.h <= L.viewport.y) continue;
    if (row.y >= L.viewport.y + L.viewport.h) continue;
    drawTalentRow(game, row);
  }
  ctx.restore();

  // ---- 滚动提示（滚动条 + 顶/底渐隐遮罩 + 小箭头）----
  if (L.maxScroll > 0) {
    drawScrollHints(ctx, L, game);
    drawScrollBar(ctx, L.viewport, L.scroll, L.maxScroll, L.viewport.h, L.contentH);
  }

  // ---- 底部提示 ----
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '10px Arial';
  ctx.fillStyle = THEME.text.off;
  ctx.fillText(
    `天赋点来源：每过 ${TALENT_POINTS.perWaveGroup.every} 波 +${TALENT_POINTS.perWaveGroup.amount} · 通关 +${TALENT_POINTS.clearLevel} · 击杀 BOSS +${TALENT_POINTS.bossKill}`,
    W / 2, L.hintY
  );
}

/** 上下渐隐 + 箭头，暗示"还能滚" */
function drawScrollHints(ctx, L, game) {
  const v = L.viewport;
  const fadeH = 16;
  const t = Date.now() / 700;
  const blink = 0.35 + 0.35 * Math.abs(Math.sin(t));

  if (L.scroll > 2) {
    const g1 = ctx.createLinearGradient(0, v.y, 0, v.y + fadeH);
    g1.addColorStop(0, 'rgba(26, 26, 46, 0.95)');
    g1.addColorStop(1, 'rgba(26, 26, 46, 0)');
    ctx.fillStyle = g1;
    ctx.fillRect(v.x, v.y, v.w, fadeH);
    ctx.globalAlpha = blink;
    drawChevron(ctx, v.x + v.w / 2, v.y + 6, -1, THEME.accent.cyan);
    ctx.globalAlpha = 1;
  }
  if (L.scroll < L.maxScroll - 2) {
    const g2 = ctx.createLinearGradient(0, v.y + v.h - fadeH, 0, v.y + v.h);
    g2.addColorStop(0, 'rgba(26, 26, 46, 0)');
    g2.addColorStop(1, 'rgba(26, 26, 46, 0.95)');
    ctx.fillStyle = g2;
    ctx.fillRect(v.x, v.y + v.h - fadeH, v.w, fadeH);
    ctx.globalAlpha = blink;
    drawChevron(ctx, v.x + v.w / 2, v.y + v.h - 6, 1, THEME.accent.cyan);
    ctx.globalAlpha = 1;
  }
}

function drawChevron(ctx, cx, cy, dir, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - 5, cy + dir * 2.5);
  ctx.lineTo(cx, cy - dir * 2.5);
  ctx.lineTo(cx + 5, cy + dir * 2.5);
  ctx.stroke();
  ctx.restore();
}

/** 单条天赋（行高自适应：紧凑行也能塞下 名称+等级点阵+描述+按钮） */
function drawTalentRow(game, row) {
  const ctx = game.ctx;
  const def = row.def;
  const lv = meta.talentLevel(def.id);
  const maxed = lv >= def.max;
  const cost = maxed ? 0 : (def.costs[lv] || 1);
  const points = meta.get().talentPoints;
  const canLearn = !maxed && points >= cost;
  const { x, y, w, h } = row;

  ctx.save();

  // 行底
  const grad = ctx.createLinearGradient(x, y, x, y + h);
  const lit = lv > 0;
  grad.addColorStop(0, lit ? 'rgba(77, 208, 225, 0.15)' : 'rgba(255, 255, 255, 0.06)');
  grad.addColorStop(1, lit ? 'rgba(77, 208, 225, 0.04)' : 'rgba(255, 255, 255, 0.02)');
  ctx.fillStyle = grad;
  ctx.strokeStyle = lit ? 'rgba(77, 208, 225, 0.45)' : THEME.border.subtle;
  ctx.lineWidth = 1.2;
  roundRectPath(ctx, x, y, w, h, TALENT_UI.radius);
  ctx.fill();
  ctx.stroke();

  // 名称 + 等级（同一行，放在左侧；右侧整块留给学习按钮）
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 14px Arial';
  ctx.fillStyle = lv > 0 ? THEME.accent.cyan : THEME.text.primary;
  ctx.fillText(def.name, x + 14, y + 16);
  const nameW = ctx.measureText(def.name).width;

  ctx.font = 'bold 11px Arial';
  ctx.fillStyle = maxed ? THEME.accent.gold : THEME.text.secondary;
  ctx.fillText(maxed ? '已精通' : `Lv.${lv}/${def.max}`, x + 14 + nameW + 8, y + 16);

  // 等级点阵（名称下方）
  const dotY = y + 31;
  const dotGap = def.max > 6 ? 9 : 12;
  for (let i = 0; i < def.max; i++) {
    const dx = x + 15 + i * dotGap;
    ctx.beginPath();
    ctx.arc(dx, dotY, def.max > 6 ? 3 : 3.5, 0, Math.PI * 2);
    ctx.fillStyle = i < lv ? THEME.accent.cyan : THEME.track.soft;
    ctx.fill();
    if (i >= lv) {
      ctx.strokeStyle = THEME.border.subtle;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  // 描述（底部一行，右侧给按钮留出 108px）
  ctx.textAlign = 'left';
  ctx.font = '11px Arial';
  ctx.fillStyle = THEME.text.secondary;
  ctx.fillText(ellipsize(ctx, def.desc, w - 108), x + 14, y + h - 15);

  // 学习按钮
  const btn = getLearnButton(row);
  let top, bottom, stroke, label, labelColor, labelSize;
  if (maxed) {
    top = THEME.track.soft; bottom = THEME.track.faint; stroke = THEME.border.subtle;
    label = '已精通'; labelColor = THEME.accent.gold; labelSize = 12;
  } else if (canLearn) {
    top = 'rgba(77, 208, 225, 0.42)'; bottom = 'rgba(0, 151, 167, 0.28)';
    stroke = 'rgba(77, 208, 225, 0.85)';
    label = `学习 ✦${cost}`; labelColor = THEME.text.primary; labelSize = 12;
  } else {
    top = THEME.track.soft; bottom = THEME.track.faint; stroke = THEME.border.subtle;
    label = `学习 ✦${cost}`; labelColor = THEME.text.off; labelSize = 12;
  }

  drawButton(ctx, {
    x: btn.x, y: btn.y, w: btn.w, h: btn.h,
    top: top, bottom: bottom, stroke: stroke,
    label: label, labelColor: labelColor,
    fontSize: labelSize, radius: THEME.radius.medium,
    pressed: theme.isButtonPressed(game, 'talent:' + def.id),
  });

  ctx.restore();
}

module.exports = {
  TALENT_UI,
  getTalentLayout,
  getLearnButton,
  setTalentScroll,
  isScrollable,
  hitTalents,
  drawTalents,
  learn,
};
