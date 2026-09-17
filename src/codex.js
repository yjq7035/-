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

const { TOWER_ORDER, TOWER_DEFS, TOWER_STATS, LAYOUT, CODEX, RARITY, GEM } = require('./config');
const theme = require('./theme');
const towerMod = require('./tower');
const meta = require('./meta');
const gems = require('./gems');
const skillSlot = require('./skillSlot');
const { formatNum } = require('./bonusStats');

const {
  THEME, roundRectPath, drawTowerIcon, drawChip, drawButton, drawStar,
  drawLockIcon, drawTaperedDivider, ellipsize, drawScrollBar, drawScrollHint,
  wrapTextLines, drawChevron,
} = theme;

const CODEX_UI = {
  padX: 14,
  gap: 10,
  headerTop: LAYOUT.topBarHeight + 10,
  headerH: 30,
  gridTopGap: 12,
  cellMaxH: 106,
  cellMinH: 88,
  sheetGap: 8,
  gridBottomPad: 16,
  // ---- 详情面板（固定高度 + 内部可滚动：对应需求"属性面板可点击可拖滑动"）----
  // 三段式：①标题区（固定）②正文（可滚动）③按钮区（固定）。
  // 正文滚动而不是整块滚动 —— 玩家任何时刻都看得见"这是哪个塔"和"能不能升级"。
  sheetPadX: 14,        // 面板内容左右内边距
  sheetHeaderH: 44,     // 固定标题区高（图标 + 名称 + 稀有度 + 分隔线）
  sheetPadBottom: 10,   // 正文底 → 按钮顶 的留白
  sheetMinH: 170,       // 面板最小高（内容再少也不缩成一条缝）
  sheetMaxRatio: 0.68,  // 面板最多占"格网顶 → 导航顶"这一段的比例
  sheetBtnH: 36,        // 底部按钮高（固定，不随内容滚动）
  sheetBtnPad: 12,      // 按钮距面板底内边距
  divH: 12,             // 分隔线占位
  descFont: '11.5px Arial',
  descLineH: 15,        // 描述行高
  sectionTitleH: 20,    // 区块小标题行高
  attrRowH: 17,
  attrGapTop: 5,
  codexLvH: 20,
  socketSize: 38,       // 宝石嵌入槽边长（基准，窄屏自动缩）
  socketGap: 8,
  socketHintH: 16,
};

/** 描述文字的最大可用宽度（面板内左右各留 sheetPadX） */
function descMaxWidth(W) {
  return (W - CODEX_UI.padX * 2) - CODEX_UI.sheetPadX * 2;
}

/**
 * 把若干段原文按面板可用宽度逐段换行后拼成一个行数组。
 * 说明：面板高度必须与"绘制时同样的换行结果"一致，所以这里与绘制共用同一个换行函数，
 *      字体也走同一份配置（CODEX_UI.descFont）。
 * 命中检测（touchstart）可能先于渲染帧执行，此时 game.ctx 为 null
 * → 回退到"每段 1 行"，布局仍能算出合理值，不会崩溃。
 * @returns {string[]}
 */
function wrapParagraphs(game, raws, maxW) {
  if (!game.ctx) return raws.slice();
  const out = [];
  for (const raw of raws) {
    const ls = wrapTextLines(game.ctx, raw, maxW, CODEX_UI.descFont);
    if (ls.length) out.push(...ls);
    else out.push('');
  }
  return out;
}

/**
 * 某塔的介绍文字在详情面板里会占几行（用于把面板高度算准，见 getCodexLayout）。
 * @returns {string[]} 行数组（至少 1 行）
 */
function getDescLines(game, type) {
  const st = type ? TOWER_STATS[type] : null;
  const text = st && st.description ? st.description : '';
  if (!text) return [''];
  const lines = wrapParagraphs(game, [text], descMaxWidth(game.W));
  return lines.length ? lines : [''];
}

/**
 * 宝石嵌入槽在【内容坐标系】里的矩形（x 相对内容左边界，y=0 相对宝石块正文顶）。
 *
 * 5 个槽等宽横排并整体居中；窄屏自动缩到塞得下为止（绝不越出面板右边界）。
 * ⚠️ 绘制与命中检测共用本函数 —— 不允许一边算坐标、一边自己排，
 *    否则必然出现"画在一处、点在另一处"（历史事故：图签卡片点不准）。
 * @param {number} contentW 面板正文可用宽（sheet.w - sheetPadX*2）
 */
function socketRects(contentW) {
  const n = GEM.maxSlots;
  const gap = CODEX_UI.socketGap;
  const fit = Math.floor((contentW - (n - 1) * gap) / n);
  const size = Math.max(20, Math.min(CODEX_UI.socketSize, fit));
  const totalW = n * size + (n - 1) * gap;
  const x0 = Math.max(0, (contentW - totalW) / 2);
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ x: x0 + i * (size + gap), y: 0, w: size, h: size });
  }
  return out;
}

/**
 * 详情面板的【正文内容块】（唯一真源）。
 *
 * 每块带 `y`（相对正文顶的偏移）与 `h`；绘制与命中检测一律按
 * `sheetView.y - sheetScroll + block.y` 换算绝对坐标，所以两边永远在同一套几何上。
 *
 * 块序：描述 → 固有技能槽 → 宝石嵌入槽 → 属性数值 → 图签等级。
 * 高度全部来自"与绘制同一个换行/布局函数"（desc 用 getDescLines，
 * 技能用 skillSlot.buildSkillSlots），因此面板高不可能与文字实际占位脱节。
 *
 * @returns {{blocks:Array, h:number, contentW:number}|null}
 */
function buildSheetContent(game, sheetW) {
  const type = game.codexSelected;
  if (!type || !TOWER_DEFS[type]) return null;
  const contentW = sheetW - CODEX_UI.sheetPadX * 2;

  const blocks = [];
  let h = 0;
  const push = (b) => { b.y = h; blocks.push(b); h += b.h; return b; };

  // ① 描述（整段换行；行数由 getDescLines 决定，与绘制同源）
  const descLines = getDescLines(game, type);
  push({ type: 'desc', h: descLines.length * CODEX_UI.descLineH, lines: descLines });

  // ② 固有技能槽（与战斗属性面板共用 src/skillSlot.js）
  //    tower 传 null：图签是"跨局预览"，Lv 只反映宝石等级（强化是局内的，不跨局）
  const skillSlots = skillSlot.buildSkillSlots(game.ctx, type, null, contentW);
  if (skillSlots.length > 0) {
    push({ type: 'divider', h: CODEX_UI.divH });
    push({
      type: 'skill',
      h: CODEX_UI.sectionTitleH + skillSlot.skillSlotsHeight(skillSlots, contentW),
      slots: skillSlots,
    });
  }

  // ③ 宝石嵌入槽：槽数 = 图签等级（Lv.1 解锁即 1 个，Lv.5 = 5 个）
  push({ type: 'divider', h: CODEX_UI.divH });
  push({
    type: 'gems',
    h: CODEX_UI.sectionTitleH + CODEX_UI.socketSize + CODEX_UI.socketHintH,
    sockets: meta.gemSockets(type),
  });

  // ④ 属性数值（两行：攻击/射程/间隔 + 暴击/暴伤/穿透）
  push({ type: 'divider', h: CODEX_UI.divH });
  push({ type: 'attrs', h: CODEX_UI.attrGapTop + CODEX_UI.attrRowH * 2 });

  // ⑤ 图签等级（数值本身在 draw 时现取，这里只要高度）
  push({ type: 'codexlv', h: CODEX_UI.codexLvH });

  return { blocks: blocks, h: h, contentW: contentW };
}


/**
 * 图签布局（纯函数，渲染/输入共用）
 *
 * 滚动约定（2026-09 新增）：
 *   · 格高按"整屏可用高"一次算定，**不随详情面板开合变化**（否则点一下卡片整张网重排、视觉抖）
 *   · 视口 = [gridTop, 视口底]（详情面板打开时视口底收窄到面板之上）
 *   · 内容比视口高 → maxScroll > 0，靠上下拖动看；滚动条把这件事画出来
 *
 * @returns {{ cols, rows, cellW, cellH, gridY, header, grid, sheet, navTop,
 *             viewport, contentH, maxScroll, scroll }}
 */
function getCodexLayout(game) {
  const W = game.W;
  const H = game.H;
  const navTop = H - LAYOUT.navHeight;

  // 4 列固定：图形塔已扩到 16 种，3 列会变成 6 行把格网挤出屏幕
  const cols = 4;
  const total = TOWER_ORDER.length;
  const rows = Math.ceil(total / cols);

  const cellW = Math.floor((W - CODEX_UI.padX * 2 - (cols - 1) * CODEX_UI.gap) / cols);
  const gridY = CODEX_UI.headerTop + CODEX_UI.headerH + CODEX_UI.gridTopGap;

  // ---- 格高：按面板收起时的整屏可用高来定（稳定）----
  const fullBottom = navTop - CODEX_UI.gridBottomPad;
  const fullH = Math.max(0, fullBottom - gridY);
  const fitH = Math.floor((fullH - (rows - 1) * CODEX_UI.gap) / rows);
  let cellH = Math.max(CODEX_UI.cellMinH, Math.min(CODEX_UI.cellMaxH, fitH));
  // 极矮屏：连 cellMinH 都塞不下时才继续缩（宁可格子扁一点，也不能一屏连一行都放不下）
  if (fitH < CODEX_UI.cellMinH) cellH = Math.max(38, fitH);

  // ---- 视口：详情面板打开时把底部让出来 ----
  // 面板 = 【定高 + 正文内部滚动】三段式：
  //   · 面板高不再由文字行数决定（那会导致"点一下卡片整张网都在重排"，且长文案会被
  //     屏幕夹住看不到结尾）；
  //   · 高度 = 标题区 + 正文(有上限) + 按钮区，正文超出部分靠**面板内拖动**看；
  //   · 标题区与按钮区固定 —— 玩家永远看得见"这是哪个塔"和"能不能升级"，
  //     不会出现"滚到一半按钮找不到了"；
  //   · 上限同时受"格网顶 → 导航顶"这段空间约束，保证格网还剩得下一行。
  const availH = navTop - gridY - CODEX_UI.sheetGap;
  const capH = Math.max(
    CODEX_UI.sheetMinH,
    Math.min(availH * CODEX_UI.sheetMaxRatio, availH - CODEX_UI.cellMinH * 0.6)
  );

  const sheetW = W - CODEX_UI.padX * 2;
  const sheetContent = game.codexSelected ? buildSheetContent(game, sheetW) : null;
  const sheetFixedH = CODEX_UI.sheetHeaderH + CODEX_UI.sheetPadBottom
    + CODEX_UI.sheetBtnH + CODEX_UI.sheetBtnPad;
  const sheetNeedH = sheetContent ? sheetFixedH + sheetContent.h : 0;

  let sheetH = 0;
  if (sheetContent) {
    sheetH = Math.max(Math.min(CODEX_UI.sheetMinH, capH), Math.min(capH, sheetNeedH));
  }
  const sheetTop = navTop - sheetH - CODEX_UI.sheetGap;
  // 视口底 = 面板上沿留 6px 间隙，但最低不能低于 gridY（视口高度至少 0）
  const viewportBottom = game.codexSelected ? Math.max(gridY, sheetTop - 6) : fullBottom;
  const viewportH = Math.max(0, viewportBottom - gridY);

  const contentH = rows * cellH + (rows - 1) * CODEX_UI.gap;
  const maxScroll = Math.max(0, contentH - viewportH);
  const scroll = Math.max(0, Math.min(maxScroll, game.codexScroll || 0));

  const gridW = cols * cellW + (cols - 1) * CODEX_UI.gap;
  const x0 = Math.round((W - gridW) / 2);

  const grid = TOWER_ORDER.map((type, i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    return {
      idx: i,
      type: type,
      x: x0 + c * (cellW + CODEX_UI.gap),
      y: gridY + r * (cellH + CODEX_UI.gap) - scroll,
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
    y: sheetTop,
    w: sheetW,
    h: sheetH,
  };

  // 面板内部：正文区（可滚动）夹在 标题区 与 按钮区 之间
  const btnTop = sheetTop + sheetH - CODEX_UI.sheetBtnPad - CODEX_UI.sheetBtnH;
  const viewTop = sheetTop + CODEX_UI.sheetHeaderH;
  const contentViewH = Math.max(0, (btnTop - CODEX_UI.sheetPadBottom) - viewTop);
  const sheetMaxScroll = sheetContent ? Math.max(0, sheetContent.h - contentViewH) : 0;
  const sheetScroll = sheetContent
    ? Math.max(0, Math.min(sheetMaxScroll, game.codexSheetScroll || 0))
    : 0;

  return {
    cols, rows, cellW, cellH, gridY, header, grid, sheet, navTop,
    viewport: { x: 0, y: gridY, w: W, h: viewportH },
    contentH, maxScroll, scroll,
    sheetContent, sheetNeedH, sheetMaxScroll, sheetScroll, sheetBtnTop: btnTop,
    // 详情面板的"当前塔型"与主色：正文块绘制要用，但它们是"选中态"而不是几何，
    // 放在这里统一暴露，省得每个绘制函数都去 game 里现捞一遍。
    sheetType: game.codexSelected || null,
    sheetAccent: (TOWER_DEFS[game.codexSelected] || {}).color,
    sheetView: {
      x: sheet.x + 2, y: viewTop,
      w: sheet.w - 4, h: contentViewH,
    },
  };
}

/** 把面板内部的滚动值夹到合法区间并写回 game */
function setCodexSheetScroll(game, value) {
  const L = getCodexLayout(game);
  game.codexSheetScroll = Math.max(0, Math.min(L.sheetMaxScroll, value || 0));
  return game.codexSheetScroll;
}

/** 详情面板内部当前是否需要滚动 */
function isSheetScrollable(game) {
  return getCodexLayout(game).sheetMaxScroll > 0;
}

/** 把滚动值夹到合法区间并写回 game（输入层滚动手势用） */
function setCodexScroll(game, value) {
  const L = getCodexLayout(game);
  game.codexScroll = Math.max(0, Math.min(L.maxScroll, value || 0));
  return game.codexScroll;
}

/** 图签格网当前是否需要滚动 */
function isCodexScrollable(game) {
  return getCodexLayout(game).maxScroll > 0;
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
 * 宝石槽在屏幕上的绝对矩形（含面板正文的滚动偏移）。
 *
 * ⚠️ 只返回"完整落在正文可视区内"的槽 —— 被滚出去的那半个槽不该能被点到，
 *    否则手指点空白会莫名其妙弹出一个浮层（历史上卡片视图就栽在这上面）。
 * @returns {Array<{index:number, kind:string|null, unlocked:boolean, rect:object}>}
 */
function getSocketHitRects(L) {
  const out = [];
  const content = L.sheetContent;
  if (!content) return out;
  const block = content.blocks.filter((b) => b.type === 'gems')[0];
  if (!block) return out;

  const rects = socketRects(content.contentW);
  const left = L.sheet.x + CODEX_UI.sheetPadX;
  const top = L.sheetView.y - L.sheetScroll + block.y + CODEX_UI.sectionTitleH;
  const view = L.sheetView;

  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    const abs = { x: left + r.x, y: top + r.y, w: r.w, h: r.h };
    if (abs.y < view.y - 0.5) continue;                      // 上边被裁
    if (abs.y + abs.h > view.y + view.h + 0.5) continue;      // 下边被裁
    const s = block.sockets[i] || { unlocked: false, kind: null };
    out.push({ index: i, kind: s.kind, unlocked: !!s.unlocked, rect: abs });
  }
  return out;
}

/**
 * 命中检测（详情面板优先于格网；已被滚出视口的格子不可点）
 *
 * 返回：
 *   { kind:'upgrade'|'lineup'|'card'|'socket'|'unsocket'|'socketLocked'|'none'|'close', type?, index? }
 *   · socket      —— 点了【已解锁的空槽】→ 打开选宝石浮层
 *   · unsocket    —— 点了【已嵌宝石的槽】→ 取出，放回背包
 *   · socketLocked—— 点了【未解锁的槽】→ 提示升图签
 *   · none        —— 面板内其他空白（吞掉，不误触格网）
 */
function hitCodex(game, pos) {
  const L = getCodexLayout(game);
  const sel = game.codexSelected;

  if (sel) {
    const btns = getSheetButtons(game, L.sheet);
    if (theme.pointInRect(pos, btns.upgrade)) return { kind: 'upgrade', type: sel };
    if (theme.pointInRect(pos, btns.lineup))  return { kind: 'lineup', type: sel };

    // 宝石槽：先于"面板空白吞掉"
    for (const s of getSocketHitRects(L)) {
      if (!theme.pointInRect(pos, s.rect)) continue;
      if (!s.unlocked) return { kind: 'socketLocked', type: sel, index: s.index };
      return { kind: s.kind ? 'unsocket' : 'socket', type: sel, index: s.index };
    }

    if (theme.pointInRect(pos, L.sheet)) return { kind: 'none' }; // 面板内空白 → 吞掉
  }

  // 视口外的格子（滚上去/滚下去的那些）不参与命中，否则会点到屏幕上看不见的卡
  const v = L.viewport;
  if (pos.y >= v.y && pos.y <= v.y + v.h) {
    for (const cell of L.grid) {
      if (cell.y + cell.h <= v.y || cell.y >= v.y + v.h) continue;
      if (theme.pointInRect(pos, cell)) return { kind: 'card', type: cell.type };
    }
  }

  return { kind: 'close' };
}

// ==================== 选宝石浮层（模态） ====================

const PICKER_UI = {
  maxW: 322,
  headH: 44,
  rowH: 44,
  rowGap: 6,
  footH: 46,
  padX: 14,
};

/**
 * 选宝石浮层布局（模态，居中）。
 *
 * 行 = 宝石【种类】而不是背包里的每一颗：6 种封顶，一屏放得下，
 * 因此**不需要滚动**（少一个会出错的交互面）。每行右侧显示持有数量。
 * @returns {{x,y,w,h,rows,close,cancel,bagUsed,bagMax,type,index}}
 */
function getGemPickerLayout(game) {
  const W = game.W;
  const H = game.H;
  const kinds = gems.GEM_ORDER;
  const counts = gems.bagCounts();

  const w = Math.min(PICKER_UI.maxW, W - 36);
  const h = PICKER_UI.headH + kinds.length * PICKER_UI.rowH + PICKER_UI.footH;
  const x = Math.round((W - w) / 2);
  const y = Math.round(Math.max(LAYOUT.topBarHeight + 14, (H - h) / 2 - 18));

  const rows = kinds.map((kind, i) => {
    const def = gems.gemDef(kind) || { name: kind, desc: '', color: '#90A4AE' };
    const n = counts[kind] || 0;
    return {
      kind: kind,
      name: def.name,
      desc: def.desc,
      color: def.color,
      count: n,
      enabled: n > 0,
      rect: {
        x: x + PICKER_UI.padX,
        y: y + PICKER_UI.headH + i * PICKER_UI.rowH,
        w: w - PICKER_UI.padX * 2,
        h: PICKER_UI.rowH - PICKER_UI.rowGap,
      },
    };
  });

  return {
    x, y, w, h, rows,
    bagUsed: meta.gemList().length,
    bagMax: meta.bagSlots(),
    close: { x: x + w - 36, y: y + 9, w: 26, h: 26 },
    cancel: {
      x: x + PICKER_UI.padX,
      y: y + h - PICKER_UI.footH + 6,
      w: w - PICKER_UI.padX * 2,
      h: 32,
    },
    type: game.gemPicker ? game.gemPicker.type : null,
    index: game.gemPicker ? game.gemPicker.index : -1,
  };
}

/**
 * 浮层命中。
 * @returns {{kind:'pick'|'disabled'|'close', gem?:string}}
 *   · pick     —— 点到了持有数量 > 0 的宝石行
 *   · disabled —— 点到的是"持有 0"的灰行：**不算关闭**，只提示，浮层留在原地
 *                 （不然玩家手一抖点到灰行，整个浮层就没了）
 *   · close    —— 点了取消 / ✕ / 浮层外
 */
function hitGemPicker(game, pos) {
  const L = getGemPickerLayout(game);
  for (const row of L.rows) {
    if (!theme.pointInRect(pos, row.rect)) continue;
    return row.enabled ? { kind: 'pick', gem: row.kind } : { kind: 'disabled', gem: row.kind };
  }
  return { kind: 'close' };
}

/** 浮层是否需要滚动（恒 false：6 种宝石一屏放得下 —— 保留接口给输入层判断） */
function isGemPickerScrollable() {
  return false;
}

/** 打开"给某槽选宝石"浮层 */
function openGemPicker(game, type, index) {
  game.gemPicker = { type: type, index: index };
  return game.gemPicker;
}

/**
 * 把背包里的一颗宝石嵌进浮层指向的槽位。
 *
 * 语义（需求原话"嵌入宝石后被嵌入的宝石与技能绑定会从物品栏消失"）：
 *   ① 从背包移除该 uid（meta.embedGem 内部完成，永不复制）；
 *   ② 写进该塔型的槽位 → 加成按塔型跨局生效（gems.bonusForType）；
 *   ③ 若这颗是"猫眼石"（skillLevels），固有技能等级随之 +1 → 战斗立刻变强。
 * @returns {{ok:boolean, reason?:string}}
 */
function actEmbedGem(game, kind) {
  const p = game.gemPicker;
  if (!p) return { ok: false, reason: 'nopicker' };

  const owned = meta.gemList().filter((g) => g.kind === kind);
  if (!owned.length) {
    say(game, '背包里没有这种宝石', THEME.accent.danger);
    return { ok: false, reason: 'nogem' };
  }

  const res = meta.embedGem(p.type, p.index, owned[0].uid);
  if (res.ok) {
    const def = gems.gemDef(kind) || { name: kind, desc: '', color: THEME.accent.violet };
    game.gemPicker = null;
    say(game, `已嵌入 ${def.name}（${def.desc}）· 与固有技能绑定`, def.color);
  } else if (res.reason === 'occupied') {
    say(game, '该槽已有宝石，先点它取出来', THEME.accent.danger);
  } else if (res.reason === 'locked') {
    say(game, '该槽尚未解锁', THEME.accent.danger);
  } else {
    say(game, '无法嵌入', THEME.accent.danger);
  }
  return res;
}

/** 取出槽里的宝石（回背包；背包满则拒绝，绝不吞宝石） */
function actUnsocketGem(game, type, index) {
  const res = meta.takeGem(type, index);
  if (res.ok) {
    const def = gems.gemDef(res.kind) || { name: '宝石', color: THEME.accent.violet };
    say(game, `已取出 ${def.name}，放回背包`, THEME.accent.gold);
  } else if (res.reason === 'full') {
    say(game, '背包已满，无法取出（先清理或解锁更多格子）', THEME.accent.danger);
  } else {
    say(game, '该槽是空的', THEME.text.dim);
  }
  return res;
}

/** 统一轻提示（本模块内部用） */
function say(game, text, color) {
  game.toast = { text: text, color: color || THEME.text.secondary, t0: Date.now() };
}


// ==================== 绘制 ====================

function drawCodex(game) {
  const ctx = game.ctx;
  const W = game.W;
  const H = game.H;

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

  // 规则说明（一行小字）：贴在视口下沿之外、导航栏之上；详情面板打开时会被面板盖住，不再画
  if (!game.codexSelected) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '10px Arial';
    ctx.fillStyle = THEME.text.off;
    ctx.fillText(`图签每级 +${CODEX.bonusPerLevel}% 攻击力 · 只有登场的图形塔会出现在商店`,
      W / 2, L.navTop - CODEX_UI.gridBottomPad / 2 - 2);
  }

  // ---- 格网（裁剪在视口内，超出部分靠上下拖动看）----
  ctx.save();
  ctx.beginPath();
  ctx.rect(L.viewport.x, L.viewport.y, L.viewport.w, L.viewport.h);
  ctx.clip();
  for (const cell of L.grid) {
    if (cell.y + cell.h <= L.viewport.y) continue;
    if (cell.y >= L.viewport.y + L.viewport.h) continue;
    drawCodexCell(game, cell);
  }
  ctx.restore();

  // ---- 滚动条 + 上下渐隐箭头：把"还能滑"画出来 ----
  drawScrollBar(ctx, L.viewport, L.scroll, L.maxScroll, L.viewport.h, L.contentH);
  drawScrollHint(ctx, L.viewport, L.scroll, L.maxScroll, 'rgba(26, 26, 46, 0.95)', THEME.accent.violet);

  // ---- 详情面板 ----
  if (game.codexSelected) drawSheet(game, L);

  // ---- 选宝石浮层（模态，必须盖在详情面板之上）----
  if (game.gemPicker) drawGemPicker(game);
}

/**
 * 选宝石浮层：列出 6 种宝石与背包持有数，点一行即嵌入。
 * 持有 0 的行置灰不可点（看得见"这种宝石长什么样"，但点不动）。
 */
function drawGemPicker(game) {
  const ctx = game.ctx;
  const L = getGemPickerLayout(game);
  const W = game.W;
  const H = game.H;

  // 遮罩
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.62)';
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  // 面板底
  ctx.save();
  const bg = ctx.createLinearGradient(0, L.y, 0, L.y + L.h);
  bg.addColorStop(0, 'rgba(20, 20, 36, 0.99)');
  bg.addColorStop(1, 'rgba(10, 10, 20, 1)');
  ctx.fillStyle = bg;
  ctx.strokeStyle = 'rgba(179, 136, 255, 0.55)';
  ctx.lineWidth = 1.4;
  roundRectPath(ctx, L.x, L.y, L.w, L.h, THEME.radius.large);
  ctx.fill();
  ctx.stroke();

  // 标题：目标槽位 + 绑定的固有技能名
  const towerDef = L.type ? TOWER_DEFS[L.type] : null;
  const skillName = L.type ? gems.skillNameOf(L.type) : '';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 13px Arial';
  ctx.fillStyle = THEME.text.primary;
  ctx.fillText(`嵌入宝石 · 第 ${L.index + 1} 槽`, L.x + PICKER_UI.padX, L.y + 17);

  ctx.font = '10px Arial';
  ctx.fillStyle = THEME.text.dim;
  const sub = towerDef
    ? `${towerDef.name}${skillName ? ' · 绑定「' + skillName + '」' : ''}`
    : '';
  ctx.fillText(ellipsize(ctx, sub, L.w - PICKER_UI.padX * 2 - 40), L.x + PICKER_UI.padX, L.y + 33);

  // 关闭 ✕
  ctx.textAlign = 'center';
  ctx.font = 'bold 14px Arial';
  ctx.fillStyle = THEME.text.dim;
  ctx.fillText('✕', L.close.x + L.close.w / 2, L.close.y + L.close.h / 2);

  // 宝石行
  for (const row of L.rows) {
    const r = row.rect;

    ctx.fillStyle = row.enabled ? 'rgba(255, 255, 255, 0.06)' : 'rgba(255, 255, 255, 0.02)';
    roundRectPath(ctx, r.x, r.y, r.w, r.h, THEME.radius.medium);
    ctx.fill();
    ctx.strokeStyle = row.enabled ? theme.shade(row.color, -0.1, 0.42) : THEME.border.subtle;
    ctx.lineWidth = 1;
    roundRectPath(ctx, r.x, r.y, r.w, r.h, THEME.radius.medium);
    ctx.stroke();

    // 左：宝石图标
    gems.drawGemIcon(ctx, r.x + 22, r.y + r.h / 2, 12, row.kind, { dim: !row.enabled });

    // 中：名称 + 效果
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 12px Arial';
    ctx.fillStyle = row.enabled ? row.color : THEME.text.off;
    ctx.fillText(row.name, r.x + 42, r.y + r.h / 2 - 7);

    ctx.font = '10px Arial';
    ctx.fillStyle = row.enabled ? THEME.text.secondary : THEME.text.off;
    ctx.fillText(row.desc, r.x + 42, r.y + r.h / 2 + 9);

    // 右：持有数量（0 就写明"无"，而不是画个 0 让人猜）
    ctx.textAlign = 'right';
    ctx.font = 'bold 13px Arial';
    ctx.fillStyle = row.enabled ? THEME.accent.green : THEME.text.off;
    ctx.fillText(row.enabled ? `×${row.count}` : '无', r.x + r.w - 12, r.y + r.h / 2);
  }

  // 底部：背包占用 + 取消
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '10px Arial';
  ctx.fillStyle = THEME.text.off;
  ctx.fillText(`背包 ${L.bagUsed}/${L.bagMax} 格`, L.x + L.w / 2, L.y + L.h - PICKER_UI.footH + 2);

  drawButton(ctx, {
    x: L.cancel.x, y: L.cancel.y, w: L.cancel.w, h: L.cancel.h,
    top: THEME.track.soft, bottom: THEME.track.faint, stroke: THEME.border.subtle,
    label: '取消', labelColor: THEME.text.secondary,
    fontSize: 13, radius: THEME.radius.medium,
    pressed: false,
  });

  ctx.restore();
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

  // 图标（未解锁 → 灰剪影）；格子矮时同步缩小，避免图标压到名称
  const iconScale = Math.max(0.5, Math.min(0.94, h / 112));
  drawTowerIcon(ctx, x + w / 2, y + h * 0.36, unlocked ? def.color : THEME.text.off, cell.type, iconScale);

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

/** 底部详情面板（标题固定 + 正文可滚动 + 按钮固定） */
function drawSheet(game, L) {
  const ctx = game.ctx;
  const sheet = L.sheet;
  const type = game.codexSelected;
  const def = TOWER_DEFS[type];
  if (!def) return;

  const rarity = RARITY[def.rarity] || RARITY[1];
  const level = meta.codexLevel(type);
  const unlocked = level > 0;
  const maxed = level >= CODEX.maxLevel;
  const cost = meta.codexCost(type, Math.min(CODEX.maxLevel, level + 1));
  const points = meta.get().points;
  const onLineup = meta.isInLineup(type);
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

  // ---------- ① 固定标题区（不随正文滚动）----------
  // 玩家滚到正文任何位置，都必须看得见"这是哪个塔、什么稀有度、能不能升级"。
  ctx.save();
  ctx.beginPath();
  ctx.rect(sheet.x + 2, sheet.y + 2, sheet.w - 4, CODEX_UI.sheetHeaderH);
  ctx.clip();
  drawSheetHeader(ctx, sheet, def, rarity, unlocked, type);
  ctx.restore();

  // ---------- ② 正文（可滚动，裁剪在 sheetView 内）----------
  // 正文块的 y 一律相对内容顶算：绝对 y = sheetView.y - sheetScroll + block.y。
  // 命中检测走同一个公式（getSocketHitRects），所以"看到的位置" = "能点的位置"。
  ctx.save();
  ctx.beginPath();
  ctx.rect(L.sheetView.x, L.sheetView.y, L.sheetView.w, L.sheetView.h);
  ctx.clip();
  if (L.sheetContent) {
    let by = L.sheetView.y - L.sheetScroll;
    for (const block of L.sheetContent.blocks) {
      drawSheetBlock(ctx, L, block, by);
      by += block.h;
    }
  }
  ctx.restore();

  // 正文滚动条 + 上下渐隐：把"里面还有内容"画出来（内容没超出就不画）
  if (L.sheetMaxScroll > 0) {
    const view = L.sheetView;
    drawScrollBar(ctx, view, L.sheetScroll, L.sheetMaxScroll, view.h, L.sheetContent.h);
    drawScrollHint(ctx, view, L.sheetScroll, L.sheetMaxScroll, 'rgba(16,16,30,0.96)', THEME.accent.violet);
  }

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
  } else if (game.battleStarted) {
    // 战斗内：登场/下架按钮置灰，不可操作
    lineLabel = '战斗中不可';
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

/** ① 固定标题区：图标 + 名称 + 稀有度 + 关闭提示 + 分隔线 */
function drawSheetHeader(ctx, sheet, def, rarity, unlocked, type) {
  const iconX = sheet.x + 30;
  const iconY = sheet.y + 22;
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

  // 标题与正文之间的分隔线
  drawTaperedDivider(ctx, sheet.x + sheet.w / 2, sheet.y + CODEX_UI.sheetHeaderH - 6, sheet.w - 28, 4);
}

/**
 * ② 正文块绘制。`y` 是已经算好滚动偏移的绝对 y —— 本函数只管往 y 处画，
 *    不自己算任何偏移（否则又与命中检测分家）。
 */
function drawSheetBlock(ctx, L, block, y) {
  const sheet = L.sheet;
  const content = L.sheetContent;
  const left = sheet.x + CODEX_UI.sheetPadX;
  const contentW = content ? content.contentW : (sheet.w - CODEX_UI.sheetPadX * 2);

  switch (block.type) {
    case 'divider': {
      drawTaperedDivider(ctx, sheet.x + sheet.w / 2, y + block.h / 2, sheet.w - 28, 4);
      break;
    }
    case 'desc': {
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = CODEX_UI.descFont;
      ctx.fillStyle = THEME.text.secondary;
      for (let i = 0; i < block.lines.length; i++) {
        ctx.fillText(block.lines[i], left, y + i * CODEX_UI.descLineH + CODEX_UI.descLineH / 2);
      }
      break;
    }
    case 'skill': {
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 11px Arial';
      ctx.fillStyle = THEME.text.primary;
      ctx.fillText('固有技能', left, y + CODEX_UI.sectionTitleH / 2);
      skillSlot.drawSkillSlots(ctx, left, y + CODEX_UI.sectionTitleH, contentW, block.slots, {
        towerColor: L.sheetAccent,
      });
      break;
    }
    case 'gems': {
      drawSheetGems(ctx, L, block, y, left, contentW);
      break;
    }
    case 'attrs': {
      drawSheetAttrs(ctx, L, block, y, left, contentW);
      break;
    }
    case 'codexlv': {
      drawSheetCodexLevel(ctx, L, y, left);
      break;
    }
    default: break;
  }
}

/** 宝石嵌入槽区：标题 + N 个槽（未解锁画锁）+ 一行操作提示 */
function drawSheetGems(ctx, L, block, y, left, contentW) {
  const sockets = block.sockets || [];
  const unlockedN = sockets.filter((s) => s.unlocked).length;
  const filledN = sockets.filter((s) => !!s.kind).length;

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 11px Arial';
  ctx.fillStyle = THEME.text.primary;
  ctx.fillText('宝石嵌入槽', left, y + CODEX_UI.sectionTitleH / 2);

  ctx.textAlign = 'right';
  ctx.font = '10px Arial';
  ctx.fillStyle = unlockedN > 0 ? THEME.accent.violet : THEME.text.off;
  ctx.fillText(`${unlockedN}/${GEM.maxSlots}`, left + contentW, y + CODEX_UI.sectionTitleH / 2);

  const rects = socketRects(contentW);
  const top = y + CODEX_UI.sectionTitleH;
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    const sock = sockets[i] || { unlocked: false, kind: null };
    const x = left + r.x;
    const sy = top + r.y;
    const size = r.w;

    if (!sock.unlocked) {
      // 未解锁：虚线凹槽 + 锁（一眼看出"图签升一级就多一个"）
      gems.drawEmptySocket(ctx, x, sy, size, size, 'rgba(255,255,255,0.16)');
      drawLockIcon(ctx, x + size / 2, sy + size / 2, size * 0.32, 'rgba(255,255,255,0.26)');
      continue;
    }

    if (sock.kind) {
      // 已嵌入：深色槽底 + 彩色描边 + 宝石
      const col = gems.gemColor(sock.kind);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.40)';
      roundRectPath(ctx, x, sy, size, size, 8);
      ctx.fill();
      ctx.strokeStyle = theme.shade(col, -0.05, 0.85);
      ctx.lineWidth = 1.4;
      roundRectPath(ctx, x, sy, size, size, 8);
      ctx.stroke();
      gems.drawGemIcon(ctx, x + size / 2, sy + size / 2, size * 0.34, sock.kind);
    } else {
      gems.drawEmptySocket(ctx, x, sy, size, size, 'rgba(179, 136, 255, 0.45)');
    }
  }

  // 操作提示（随状态变话术，别让玩家猜）
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = '10px Arial';
  ctx.fillStyle = THEME.text.off;
  const bagEmpty = meta.gemList().length === 0;
  let hint;
  if (unlockedN === 0) hint = '解锁 / 升级图签，每级解锁 1 个宝石槽';
  else if (bagEmpty) hint = '背包里还没有宝石 · 战斗清波与精英怪会掉落';
  else if (filledN > 0) hint = '点空槽嵌入宝石 · 点已嵌的宝石取出';
  else hint = '点槽位选择要嵌入的宝石（与固有技能绑定）';
  ctx.fillText(ellipsize(ctx, hint, contentW), left, top + CODEX_UI.socketSize + CODEX_UI.socketHintH / 2);
}

/** 属性数值区：三列 × 两行（与塔属性面板同口径：tower.getTowerStats） */
function drawSheetAttrs(ctx, L, block, y, left, contentW) {
  const type = L.sheetType;
  const stats = towerMod.getTowerStats(type);
  const dmgMult = meta.codexDamageMultiplier(type);
  const colW = contentW / 3;
  const row1 = y + CODEX_UI.attrGapTop + CODEX_UI.attrRowH / 2;
  const row2 = row1 + CODEX_UI.attrRowH;

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = '11px Arial';

  const isSupport = !!stats.isSupport;
  if (isSupport) {
    ctx.fillStyle = THEME.text.dim;
    ctx.fillText(`光环 +${(stats.supportBuff && stats.supportBuff.attackSpeedMultiplier) || 0}%`, left, row1);
    ctx.fillText(`范围 ${stats.range}`, left + colW, row1);
  } else {
    // 攻击：白字基础值 + 绿字图签加成（与属性面板同一套双色语义）
    ctx.fillStyle = THEME.text.primary;
    const baseText = `攻击 ${formatNum(stats.damage)}`;
    ctx.fillText(baseText, left, row1);
    const baseW = ctx.measureText(baseText).width;
    const bonus = (stats.damage || 0) * (dmgMult - 1);
    if (bonus > 0) {
      ctx.fillStyle = THEME.accent.green;
      ctx.fillText(`+${formatNum(bonus)}`, left + baseW + 3, row1);
    }
    ctx.fillStyle = THEME.text.dim;
    ctx.fillText(`射程 ${stats.range}`, left + colW, row1);
    if (stats.attackInterval > 0) {
      ctx.fillText(`间隔 ${stats.attackInterval}秒`, left + colW * 2, row1);
    }
  }

  if (!isSupport) {
    const critMult = stats.critMult || 1.5;
    ctx.fillStyle = THEME.accent.cyan;
    ctx.fillText(`暴击 ${stats.critChance || 0}%`, left, row2);
    ctx.fillStyle = THEME.text.dim;
    ctx.fillText(`暴伤 ${Math.round(critMult * 100)}%`, left + colW, row2);
    ctx.fillStyle = THEME.accent.gold;
    ctx.fillText(`穿透 ${stats.penetration || 0}`, left + colW * 2, row2);
  }
}

/** 图签等级行（含宝石加成后的总伤害放大） */
function drawSheetCodexLevel(ctx, L, y, left) {
  const type = L.sheetType;
  const level = meta.codexLevel(type);
  const cost = meta.codexCost(type, Math.min(CODEX.maxLevel, level + 1));
  const dmgMult = meta.codexDamageMultiplier(type);
  const gemBonus = gems.bonusForType(type);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 11px Arial';
  ctx.fillStyle = THEME.accent.violet;
  const text = level > 0
    ? `图签 Lv.${level}/${CODEX.maxLevel} · 攻击 +${Math.round((dmgMult - 1) * 100)}%`
      + (gemBonus.count > 0 ? ` · 宝石 ×${gemBonus.count}` : '')
    : `未解锁（需 ✨${cost}）`;
  ctx.fillText(text, left, y + CODEX_UI.codexLvH / 2);
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
        : (res.reason === 'min6' ? `至少需要 ${CODEX.lineupMin} 个登场图形塔（当前 ${res.count}）` : '需先解锁');
      game.toast = { text: msg, color: THEME.accent.danger, t0: Date.now() };
    }
    return res;
  }

  return { ok: false, reason: 'unknown-action' };
}

module.exports = {
  CODEX_UI,
  PICKER_UI,
  getCodexLayout,
  getSheetButtons,
  getDescLines,
  buildSheetContent,
  socketRects,
  getSocketHitRects,
  setCodexScroll,
  setCodexSheetScroll,
  isCodexScrollable,
  isSheetScrollable,
  hitCodex,
  // 选宝石浮层
  getGemPickerLayout,
  hitGemPicker,
  isGemPickerScrollable,
  openGemPicker,
  actEmbedGem,
  actUnsocketGem,
  drawCodex,
  actCodex,
};
