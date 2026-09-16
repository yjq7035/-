// ============================================================================
// 天赋界面 —— src/talents.js
// ----------------------------------------------------------------------------
// 玩法（对应需求"玩家用到的各种功能的天赋学习"）：
//   · 6 条天赋覆盖玩家侧功能：经济 / 生存 / 商店 / 图签 / 积分获取
//   · 消耗"天赋点"逐级学习；天赋点来源：每过 5 波 +1、通关 +3、击杀 BOSS +1
//   · 数值口径集中在 config.TALENT_EFFECT，由 game_core 统一读取生效
//
// 本文件只管"展示 + 学习"，不改战斗逻辑——战斗侧的取值在 game_core。
// ============================================================================

const { TALENTS, LAYOUT, TALENT_POINTS } = require('./config');
const theme = require('./theme');
const meta = require('./meta');

const { THEME, roundRectPath, drawChip, drawButton, ellipsize } = theme;

const TALENT_UI = {
  padX: 14,
  gap: 8,
  headerTop: LAYOUT.topBarHeight + 10,
  headerH: 30,
  listTopGap: 14,
  bottomPad: 14,
  rowMaxH: 76,
  rowMinH: 58,
  radius: 12,
};

/**
 * 天赋界面布局（纯函数，渲染/输入共用）
 * @returns {{ header, rows: Array, navTop, hintY }}
 */
function getTalentLayout(game) {
  const W = game.canvas.width;
  const H = game.canvas.height;
  const navTop = H - LAYOUT.navHeight;

  const listTop = TALENT_UI.headerTop + TALENT_UI.headerH + TALENT_UI.listTopGap;
  const availH = navTop - TALENT_UI.bottomPad - listTop - 18; // 18 = 底部提示行留白
  const n = TALENTS.length;

  let rowH = Math.floor((availH - (n - 1) * TALENT_UI.gap) / n);
  rowH = Math.max(TALENT_UI.rowMinH, Math.min(TALENT_UI.rowMaxH, rowH));

  const rowW = W - TALENT_UI.padX * 2;
  const rows = TALENTS.map((def, i) => ({
    idx: i,
    def: def,
    x: TALENT_UI.padX,
    y: listTop + i * (rowH + TALENT_UI.gap),
    w: rowW,
    h: rowH,
  }));

  const headerCY = TALENT_UI.headerTop + TALENT_UI.headerH / 2;
  const header = {
    brand:  { x: TALENT_UI.padX, y: headerCY - 11, w: 56, h: 22 },
    points: { x: W - TALENT_UI.padX - 96, y: headerCY - 10, w: 96, h: 20 },
  };

  return { header, rows, navTop, hintY: navTop - 15 };
}

/** 每行"学习"按钮的矩形 */
function getLearnButton(row) {
  const bw = 78, bh = 28;
  return {
    x: row.x + row.w - bw - 12,
    y: row.y + row.h - bh - 10,
    w: bw,
    h: bh,
  };
}

/** 命中检测：返回 {kind:'learn', id} 或 null */
function hitTalents(game, pos) {
  const L = getTalentLayout(game);
  for (const row of L.rows) {
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
  const W = game.canvas.width;
  const H = game.canvas.height;

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

  // ---- 天赋列表 ----
  for (const row of L.rows) drawTalentRow(game, row);

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

/** 单条天赋 */
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

  // 名称
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 14px Arial';
  ctx.fillStyle = lv > 0 ? THEME.accent.cyan : THEME.text.primary;
  ctx.fillText(def.name, x + 14, y + 18);

  // 等级（右侧）
  ctx.textAlign = 'right';
  ctx.font = 'bold 11px Arial';
  ctx.fillStyle = maxed ? THEME.accent.gold : THEME.text.secondary;
  ctx.fillText(maxed ? '已精通' : `Lv.${lv}/${def.max}`, x + w - 14, y + 18);

  // 等级点阵（名称下方，直观显示进度）
  const dotY = y + 34;
  for (let i = 0; i < def.max; i++) {
    const dx = x + 15 + i * 12;
    ctx.beginPath();
    ctx.arc(dx, dotY, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = i < lv ? THEME.accent.cyan : THEME.track.soft;
    ctx.fill();
    if (i >= lv) {
      ctx.strokeStyle = THEME.border.subtle;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  // 描述
  ctx.textAlign = 'left';
  ctx.font = '11px Arial';
  ctx.fillStyle = THEME.text.secondary;
  const descY = y + h - 24;
  ctx.fillText(ellipsize(ctx, def.desc, w - 110), x + 14, descY);

  // 学习按钮
  const btn = getLearnButton(row);
  let top, bottom, stroke, label, labelColor;
  if (maxed) {
    top = THEME.track.soft; bottom = THEME.track.faint; stroke = THEME.border.subtle;
    label = '已精通'; labelColor = THEME.accent.gold;
  } else if (canLearn) {
    top = 'rgba(77, 208, 225, 0.42)'; bottom = 'rgba(0, 151, 167, 0.28)';
    stroke = 'rgba(77, 208, 225, 0.85)';
    label = `学习 ✦${cost}`; labelColor = THEME.text.primary;
  } else {
    top = THEME.track.soft; bottom = THEME.track.faint; stroke = THEME.border.subtle;
    label = `学习 ✦${cost}`; labelColor = THEME.text.off;
  }

  drawButton(ctx, {
    x: btn.x, y: btn.y, w: btn.w, h: btn.h,
    top: top, bottom: bottom, stroke: stroke,
    label: label, labelColor: labelColor,
    fontSize: 12, radius: THEME.radius.medium,
    pressed: theme.isButtonPressed(game, 'talent:' + def.id),
  });

  ctx.restore();
}

module.exports = {
  TALENT_UI,
  getTalentLayout,
  getLearnButton,
  hitTalents,
  drawTalents,
  learn,
};
