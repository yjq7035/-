// ============================================================================
// 背包栏 —— src/bag.js
// ----------------------------------------------------------------------------
// 需求（导航第 5 格）：
//   · 默认 20 个格子，每行 10 个格子
//   · 可以通过观看广告视频解锁（每次 +1 行 = 10 格，上限 40 格）
//   · 广告位 ID 尚未申请 → AD.enabled=false 时解锁按钮与「再次挑战」同款禁用
//
// 与宝石系统的关系：
//   · 背包里放的是【未嵌入】的宝石（meta.gemList()），每颗一个 uid；
//   · 宝石嵌进某个图形塔的槽位后**从背包消失**（见 meta.embedGem），
//     加成与固有技能绑定、跨局生效；
//   · 所以本页是"仓库"，不是"图鉴"：空槽 = 没有宝石，格子用完 = 背包满。
//
// 布局与命中检测共用 getBagLayout（纯函数）—— 渲染层与输入层同一个真源。
// ============================================================================

const { GEM, LAYOUT, AD } = require('./config');
const theme = require('./theme');
const meta = require('./meta');
const gems = require('./gems');

const { THEME, roundRectPath, drawChip, drawButton, drawLockIcon, drawTaperedDivider, ellipsize } = theme;

const BAG_UI = {
  padX: 12,
  gap: 5,             // 格子间距（10 列比较密，间距必须小）
  headerTop: LAYOUT.topBarHeight + 10,
  headerH: 30,
  gridTopGap: 12,
  cellMinH: 24,       // 极矮屏的下限（宁可格子扁，也不能一屏放不下）
  cellMaxH: 52,
  footerH: 82,        // 底部：规则说明 + 解锁按钮
  cellRadius: 7,
};

/**
 * 背包布局（纯函数，渲染/输入共用）。
 * @returns {{cols,rows,cellW,cellH,gridY,x0,header,cells,footer,btn,unlocked,used,max,adReady,canExpand}}
 */
function getBagLayout(game) {
  const W = game.W;
  const H = game.H;
  const navTop = H - LAYOUT.navHeight;

  const cols = GEM.bagCols;                              // 10（需求：每行 10 格）
  const rows = Math.ceil(GEM.bagMaxSlots / cols);         // 4 行封顶
  const unlocked = meta.bagSlots();
  const list = meta.gemList();

  const cellW = Math.floor((W - BAG_UI.padX * 2 - (cols - 1) * BAG_UI.gap) / cols);
  const gridY = BAG_UI.headerTop + BAG_UI.headerH + BAG_UI.gridTopGap;

  // 格高：正方形为基准，被"导航栏 - 页脚"夹住时再压扁
  const avail = Math.max(0, (navTop - BAG_UI.footerH) - gridY);
  const fitH = Math.floor((avail - (rows - 1) * BAG_UI.gap) / rows);
  const cellH = Math.max(BAG_UI.cellMinH, Math.min(BAG_UI.cellMaxH, Math.min(cellW, fitH)));

  const gridW = cols * cellW + (cols - 1) * BAG_UI.gap;
  const x0 = Math.round((W - gridW) / 2);

  const cells = [];
  for (let i = 0; i < GEM.bagMaxSlots; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const isUnlocked = i < unlocked;
    cells.push({
      index: i,
      unlocked: isUnlocked,
      item: isUnlocked ? (list[i] || null) : null,
      x: x0 + c * (cellW + BAG_UI.gap),
      y: gridY + r * (cellH + BAG_UI.gap),
      w: cellW,
      h: cellH,
    });
  }

  // 标题栏：左「背包」徽标 + 中「宝石已用/格数」+ 右「未嵌入颗数」
  const headerCY = BAG_UI.headerTop + BAG_UI.headerH / 2;
  const header = {
    brand: { x: BAG_UI.padX, y: headerCY - 11, w: 56, h: 22 },
    slots: { x: BAG_UI.padX + 64, y: headerCY - 10, w: 88, h: 20 },
    gems:  { x: W - BAG_UI.padX - 76, y: headerCY - 10, w: 76, h: 20 },
  };

  const btnW = Math.min(W - BAG_UI.padX * 2, 320);
  const btnH = 38;
  const btn = {
    x: Math.round((W - btnW) / 2),
    y: navTop - btnH - 10,
    w: btnW,
    h: btnH,
  };

  return {
    cols, rows, cellW, cellH, gridY, x0, header, cells,
    footer: { x: 0, y: navTop - BAG_UI.footerH, w: W, h: BAG_UI.footerH },
    btn, navTop,
    unlocked, used: list.length, max: GEM.bagMaxSlots,
    adReady: !!AD.enabled,
    canExpand: meta.canExpandBag(),
  };
}

/**
 * 命中检测。
 * @returns {{kind:'expand'|'cell', index?:number}|null}
 */
function hitBag(game, pos) {
  const L = getBagLayout(game);
  if (theme.pointInRect(pos, L.btn)) return { kind: 'expand' };
  for (const cell of L.cells) {
    if (theme.pointInRect(pos, cell)) return { kind: 'cell', index: cell.index };
  }
  return null;
}

/**
 * 看广告解锁背包（+10 格）。
 *
 * ⚠️ 广告未开放（AD.enabled=false）时**绝不假装成功** ——
 *    与「再次挑战」同款策略：按钮置灰 + 明确提示"广告未开放"。
 *    假解锁会让 20/40 这条进度在线上环境凭空跳变，且广告接入后无法回收。
 * @returns {{ok:boolean, slots?:number, reason?:string}}
 */
function actExpandBag(game) {
  if (!meta.canExpandBag()) {
    say(game, `背包已解锁全部 ${GEM.bagMaxSlots} 格`, THEME.text.dim);
    return { ok: false, reason: 'max' };
  }
  if (!AD.enabled) {
    say(game, '广告位尚未开放，暂时无法解锁背包', THEME.accent.danger);
    return { ok: false, reason: 'ad' };
  }

  const ads = require('./ads');
  if (typeof ads.showRewarded !== 'function') {
    say(game, '广告组件不可用', THEME.accent.danger);
    return { ok: false, reason: 'ad' };
  }

  say(game, '正在加载广告…', THEME.text.secondary);
  ads.showRewarded((ok) => {
    if (!ok) {
      say(game, '需要完整看完广告才能解锁', THEME.accent.danger);
      return;
    }
    const res = meta.expandBag();
    if (res.ok) {
      say(game, `背包已扩展到 ${res.slots} 格（+${GEM.bagStep}）`, THEME.accent.green);
    } else {
      say(game, '背包已是最大容量', THEME.text.dim);
    }
  });
  return { ok: true, reason: 'pending' };
}

/** 统一轻提示（本模块内部用） */
function say(game, text, color) {
  game.toast = { text: text, color: color || THEME.text.secondary, t0: Date.now() };
}

// ==================== 绘制 ====================

function drawBag(game) {
  const ctx = game.ctx;
  const W = game.W;
  const H = game.H;

  // 背景（与图签同底色，避免切场景闪白）
  ctx.fillStyle = THEME.surface.page;
  ctx.fillRect(0, 0, W, H);

  const L = getBagLayout(game);

  // ---- 标题栏 ----
  drawChip(ctx, {
    x: L.header.brand.x, y: L.header.brand.y, w: L.header.brand.w, h: L.header.brand.h,
    text: '背包', icon: '🎒', color: THEME.text.primary, fontSize: 12,
    bg: THEME.track.soft, stroke: THEME.border.normal,
  });

  drawChip(ctx, {
    x: L.header.slots.x, y: L.header.slots.y, w: L.header.slots.w, h: L.header.slots.h,
    text: `格子 ${L.unlocked}/${L.max}`, color: THEME.text.secondary, fontSize: 10,
    bg: THEME.track.faint, stroke: THEME.border.subtle,
  });

  drawChip(ctx, {
    x: L.header.gems.x, y: L.header.gems.y, w: L.header.gems.w, h: L.header.gems.h,
    text: `${L.used}/${L.unlocked}`, icon: '💎', color: THEME.accent.cyan, fontSize: 10,
    bg: 'rgba(77, 208, 225, 0.10)', stroke: 'rgba(77, 208, 225, 0.32)',
  });

  // ---- 格网 ----
  for (const cell of L.cells) {
    drawBagCell(ctx, cell);
  }

  // ---- 页脚：规则说明 + 解锁按钮 ----
  const foot = L.footer;
  const lineY = foot.y + 12;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '10px Arial';
  ctx.fillStyle = THEME.text.off;
  ctx.fillText('宝石来自战斗掉落 · 在图签里点槽位嵌入，嵌入后与固有技能绑定', W / 2, lineY);
  drawTaperedDivider(ctx, W / 2, lineY + 12, W - 40, 3);

  let label, enabled, top, bottom, stroke;
  if (!L.canExpand) {
    label = `已解锁全部 ${L.max} 格`;
    enabled = false;
    top = THEME.track.soft; bottom = THEME.track.faint; stroke = THEME.border.subtle;
  } else if (!L.adReady) {
    // 与「再次挑战」同款：广告未开放 → 置灰不可点，但把话说清楚
    label = `看广告解锁 +${GEM.bagStep} 格（广告未开放）`;
    enabled = false;
    top = THEME.track.soft; bottom = THEME.track.faint; stroke = THEME.border.subtle;
  } else {
    label = `看广告解锁 +${GEM.bagStep} 格`;
    enabled = true;
    top = 'rgba(77, 208, 225, 0.36)'; bottom = 'rgba(0, 131, 143, 0.24)';
    stroke = 'rgba(77, 208, 225, 0.8)';
  }

  drawButton(ctx, {
    x: L.btn.x, y: L.btn.y, w: L.btn.w, h: L.btn.h,
    top: top, bottom: bottom, stroke: stroke,
    label: label,
    labelColor: enabled ? THEME.text.primary : THEME.text.off,
    fontSize: 13, radius: THEME.radius.medium,
    pressed: enabled && theme.isButtonPressed(game, 'bag:expand'),
  });

  // 页面顶部那行提示：告诉玩家宝石怎么用（没有宝石时尤其需要）
  if (L.used === 0) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '11px Arial';
    ctx.fillStyle = THEME.text.off;
    ctx.fillText('背包是空的 · 清空波次与精英怪会掉落宝石', W / 2, L.gridY + L.cellH + 14);
  }

  // 按钮波纹（只画 bag 层）
  theme.drawButtonFx(game, ctx, 'bag');
}

/** 单个背包格：未解锁 → 暗格 + 锁；空 → 虚线；有宝石 → 珠子 */
function drawBagCell(ctx, cell) {
  const { x, y, w, h, unlocked, item } = cell;

  if (!unlocked) {
    // 未解锁：几乎不可见的一格 + 小锁（表达"这里以后能放东西"）
    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.025)';
    roundRectPath(ctx, x, y, w, h, BAG_UI.cellRadius);
    ctx.fill();
    ctx.restore();
    drawLockIcon(ctx, x + w / 2, y + h / 2, Math.min(11, w * 0.34), 'rgba(255, 255, 255, 0.16)');
    return;
  }

  ctx.save();

  // 格底
  ctx.fillStyle = item ? 'rgba(255, 255, 255, 0.07)' : 'rgba(255, 255, 255, 0.035)';
  roundRectPath(ctx, x, y, w, h, BAG_UI.cellRadius);
  ctx.fill();

  if (item) {
    const col = gems.gemColor(item.kind);
    ctx.strokeStyle = gems.shadeColor(col, -0.1, 0.55);
    ctx.lineWidth = 1;
    roundRectPath(ctx, x, y, w, h, BAG_UI.cellRadius);
    ctx.stroke();

    // 宝石本体（半径按格宽自适应，窄屏也不会糊出格子）
    gems.drawGemIcon(ctx, x + w / 2, y + h / 2, Math.max(5, Math.min(w, h) * 0.30), item.kind);
  } else {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
    ctx.lineWidth = 1;
    if (typeof ctx.setLineDash === 'function') ctx.setLineDash([3, 3]);
    roundRectPath(ctx, x, y, w, h, BAG_UI.cellRadius);
    ctx.stroke();
    if (typeof ctx.setLineDash === 'function') ctx.setLineDash([]);
  }

  ctx.restore();
}

module.exports = {
  BAG_UI,
  getBagLayout,
  hitBag,
  actExpandBag,
  drawBag,
};
