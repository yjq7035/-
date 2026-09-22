// 渲染层 · 界面子模块：属性面板 / 波次标题与倒计时 / 顶栏 / 结算 / 提示等界面绘制。
// 由 src/renderer.js 薄壳 re-export，与 renderer-core.js 合并成原先单文件 src/renderer.js
// 的完整导出面。
// 约定：每个绘制函数接收 game 实例，内部用 game.ctx 取画布。
// ⚠️ 布局尺寸一律用 **game.W / game.H**（逻辑像素，= 触摸坐标空间），
//    不要读 game.canvas.width/height —— 画布是物理像素（逻辑 × renderScale，
//    见 game.js 渲染倍率 / game_core.applyViewScale），读它会整体放大且跑出屏幕。
// drawTowerIcon 为纯函数，直接吃 ctx。
const config = require('./config');
const { TOWER_DEFS, LAYOUT, TOWER_STATS, LEVELS, BALANCE, AD } = config;
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
const aim = require('./aim');
const skillSlot = require('./skillSlot');
const gemModal = require('./gemModal');
const { anchorPointOf } = require('./geometry');

// 通用 UI 原子统一来自 theme.js（本项目 UI 风格与坐标工具的唯一真源）
const {
  THEME, TOAST, shade, teamBandGradient, easeOutCubic, easeOutBack,
  roundRectPath, drawStar, drawTowerIcon, wrapTextLines, wrapText,
  drawTaperedDivider, drawButton, drawButtonFx, isButtonPressed,
  drawPillTitle, drawChip, ellipsize, drawChevron, drawScrollBar,
} = theme;

// 塔属性查询（纯配置查找，实体在 tower.js，这里保留同名别名给既有调用点）
const getTowerStats = towerMod.getTowerStats;

// ⚠️ 与 core 是循环依赖：core 顶层 require 了本模块（drawBattle / render 要用 drawUI 等）。
// 所以这里**不能**顶层 require('./renderer-core') —— 那样只会拿到半初始化的空对象。
// drawBossBars（BOSS 血条）只在 drawUI 里用一次，延迟到调用时取（那时 core 已加载完）。
let _coreMod = null;
const coreMod = () => (_coreMod || (_coreMod = require('./renderer-core')));


// ========== 属性面板布局参数（自适应高度的唯一真源）==========
// 面板不再写死高度：所有区块高度在这里定义，实际面板高 = 内容高度之和（可被屏幕裁切）。
const PANEL_UI = {
  width: 302,           // 面板基准宽度（屏幕更窄时自动收窄）
  screenMarginX: 16,    // 距屏幕左右最小边距
  screenMarginY: 18,    // 距屏幕上下最小边距
  padX: 20,             // 内容左右内边距
  padTop: 14,
  padBottom: 12,
  radius: 12,
  headerH: 48,          // 标题区（图标 + 名称 + 阶段星 + 造价）
  dividerH: 18,         // "切割"分隔线占位（含上下留白）
  dividerThickness: 5,  // 分隔线中心最厚处（两端收细到 0）
  rowH: 26,             // 属性行高
  subH: 16,             // 属性来源明细子行高
  sectionTitleH: 22,    // 小节标题行高
  effectH: 18,          // 生效效果单行高
  descLineH: 17,        // 攻击介绍行高
  descSize: 12.5,
  skillH: 24,
  gemRowH: 56,          // 宝石卡兜底估计高（单卡三行单行文本时；真实高度走 gemCardHeight 自适应换行）
  gemGap: 5,            // 相邻两张宝石卡之间的间距（**区块高度与绘制共用**，见 gemBlockHeight）
  gemWrapLineH: 13,     // 宝石卡内换行文本行高（短描述/详细文本多行时）
  gemNameH: 15,         // 宝石卡内名字行高（单行，超宽截断）
  gemCardPadV: 7,       // 宝石卡上下内边距
  gemIconMinH: 40,      // 宝石卡最小高（保证图标槽不被压扁）
  enhanceH: 52,         // 强化按钮区（含标签行）
  footerH: 24,
};

// 属性行标签配色（数值本体统一遵守：白=原生 / 绿=增益 / 红=减益）


// 属性行标签配色（数值本体统一遵守：白=原生 / 绿=增益 / 红=减益）
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

/**
 * 宝石卡文本可用宽（**布局唯一真源**）：内容宽 − (左pad + 槽宽 + 槽文间距) − 右pad。
 * drawTowerPanel（算高）与 drawPanelGems（绘制）必须调同一个函数，否则"算出来放得下、画出来溢出"。
 */
function gemTextWidth(panelW) {
  const contentW = panelW - PANEL_UI.padX * 2;
  const slotSize = 14 + 8;   // iconSize + 8（与 drawPanelGems 同值）
  return Math.max(40, contentW - (6 + slotSize + 10) - 6);
}

/** 宝石卡内换行行数（无 ctx 时按字数估算，保证探针/单测不崩） */
function gemWrapCount(ctx, text, textW, font) {
  if (!text) return 0;
  if (ctx && typeof wrapTextLines === 'function') {
    try {
      const lines = wrapTextLines(ctx, text, textW, font);
      return Math.max(1, lines.length);
    } catch (e) { /* 回落到字数估算 */ }
  }
  return Math.max(1, Math.ceil(String(text).length * 5.5 / Math.max(40, textW)));
}

/**
 * 单张宝石卡高度（**自适应换行真源**）：上pad + 名字行 + 短描述换行 + 详细文本换行 + 下pad，
 * 下限 gemIconMinH（图标槽不被压扁）。drawTowerPanel 与 drawPanelGems 共用，绝不各算各的。
 */
function gemCardHeight(ctx, entry, textW) {
  const eff = gems.effectTextAt(entry.kind, entry.lv);
  const detail = gems.detailTextAt(entry.kind);
  const effN = gemWrapCount(ctx, eff, textW, '10px Arial');
  const detN = gemWrapCount(ctx, detail, textW, '10px Arial');
  const textH = PANEL_UI.gemNameH + effN * PANEL_UI.gemWrapLineH + detN * PANEL_UI.gemWrapLineH;
  return Math.max(PANEL_UI.gemIconMinH, textH + PANEL_UI.gemCardPadV * 2);
}

/**
 * 宝石区块总高（**唯一真源**）：标题 + Σ各卡自适应高 + 卡间 gap。
 *
 * ⚠️ 必须与 drawPanelGems 的 cardY 步进严格同源（同一 gemCardHeight 求和）——
 *    旧实现只按 n×gemRowH 预留高度、绘制却按 (gemRowH + 5) 步进，两张卡起
 *    最后一张就会比区块多探出；这里与 src/skillSlot.js 的 skillSlotsHeight 是同一套算法。
 * @param {number|Array} n 该塔型已嵌入的宝石数量（数字=兼容老调用，按 gemRowH 估算），或条目数组
 * @param {object} [ctx] 有 ctx + textW 时按换行精确求和；没有时按 gemRowH 估算
 * @param {number} [textW] 宝石卡文本可用宽（见 gemTextWidth）
 */
function gemBlockHeight(n, ctx, textW) {
  if (Array.isArray(n)) {
    const entries = n.filter((e) => e && gems.gemDef(e.kind));
    if (!entries.length) return 0;
    if (ctx && textW) {
      let sum = PANEL_UI.sectionTitleH;
      entries.forEach((e, i) => {
        sum += gemCardHeight(ctx, e, textW);
        if (i < entries.length - 1) sum += PANEL_UI.gemGap;
      });
      return sum;
    }
    return PANEL_UI.sectionTitleH + entries.length * PANEL_UI.gemRowH
      + (entries.length - 1) * PANEL_UI.gemGap;
  }
  if (!(n > 0)) return 0;
  return PANEL_UI.sectionTitleH + n * PANEL_UI.gemRowH + (n - 1) * PANEL_UI.gemGap;
}

/**
 * 绘制塔属性面板（高度自适应）
 * 三步走：
 *   ① 附加绿字属性系统（bonusStats）算出属性行 / 来源明细 / 生效效果；
 *   ② 预排版全部文本并累加各区块高度 → 得到面板真实高度（不与屏幕争空间）；
 *   ③ 按块顺序自上而下绘制，块间用"切割"式分隔线，内容整体裁剪在面板内。
 * 结果：不会出现文本越界、重叠或"技能槽压在介绍文字上"的情况。
 */


/**
 * 绘制塔属性面板（高度自适应）
 * 三步走：
 *   ① 附加绿字属性系统（bonusStats）算出属性行 / 来源明细 / 生效效果；
 *   ② 预排版全部文本并累加各区块高度 → 得到面板真实高度（不与屏幕争空间）；
 *   ③ 按块顺序自上而下绘制，块间用"切割"式分隔线，内容整体裁剪在面板内。
 * 结果：不会出现文本越界、重叠或"技能槽压在介绍文字上"的情况。
 */
function drawTowerPanel(game) {
  const ctx = game.ctx;
  const W = game.W;
  const H = game.H;

  const towerType = game.panelTowerType;
  const towerDef = TOWER_DEFS[towerType];
  if (!towerDef) return;
  const stats = getTowerStats(towerType);
  const tower = game.selectedTower || null;
  game._currentPanelTower = tower;

  // ---------- ① 附加属性系统 ----------
  const info = bonusStats.collectTowerStats(game, tower, stats, towerType);

  // ---------- ② 尺寸 + 文本预排版 ----------
  const panelW = Math.min(PANEL_UI.width, W - PANEL_UI.screenMarginX * 2);
  const contentW = panelW - PANEL_UI.padX * 2;
  const cx = W / 2;
  const descLines = wrapTextLines(ctx, stats.description || '', contentW, `${PANEL_UI.descSize}px Arial`);

  // 固有技能槽：每个技能一个槽（左图标 / 右技能名+Lv+介绍+当前值）。
  // ⚠️ 高度必须取自 skillSlot.skillSlotsHeight —— 与绘制同一个换行函数，
  //    "这边算行数、那边画文字"的历史事故（文字捅出面板 116px）不许回来。
  const skillSlots = skillSlot.buildSkillSlots(ctx, towerType, tower, contentW);
  const skillBlockH = skillSlots.length > 0
    ? PANEL_UI.sectionTitleH + skillSlot.skillSlotsHeight(skillSlots, contentW)
    : 0;

  // 宝石槽条：展示该塔型已嵌入的宝石（嵌入操作在图签里做，这里负责"看得到"）
  // 嵌入条目带等级（合成产物 > Lv.1），名字按需求带上 Lv
  const gemEntries = gems.embeddedEntries(towerType);
  // 高度按换行精确求和（唯一真源 gemBlockHeight；文本宽与绘制共用 gemTextWidth）——
  // 少算一份，下面的分隔线就会压到卡片上；多算则留白，无溢出风险
  const gemBlockH = gemBlockHeight(gemEntries, ctx, gemTextWidth(panelW));

  // 组装区块（累加高度，杜绝重叠）
  const blocks = [];
  // 上下留白走局部变量：矮屏塞不下时它们也参与"弹性压缩"（见下方自适应第二步）
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

  // 固有技能区块（技能槽：一技能一槽，左图标右文案）
  if (skillSlots.length > 0) {
    push({ type: 'divider', h: PANEL_UI.dividerH });
    push({ type: 'skill', h: skillBlockH, slots: skillSlots, color: towerDef.color });
  }

  // 宝石区块（已嵌入的宝石，与固有技能绑定，向下排列）
  if (gemEntries.length > 0) {
    push({ type: 'divider', h: PANEL_UI.dividerH });
    push({ type: 'gems', h: gemBlockH, entries: gemEntries });
  }

  push({ type: 'divider', h: PANEL_UI.dividerH });
  push({ type: 'enhance', h: PANEL_UI.enhanceH });

  push({ type: 'footer', h: PANEL_UI.footerH });
  contentH += padBottom;

  // ---------- 面板外框 ----------
  const availH = H - PANEL_UI.screenMarginY * 2;

  // ---- 高度自适应第二步：实在塞不下时，按"装饰优先级"依次让出高度 ----
  // ① 先压扁"切割"分隔线（纯装饰，压扁只损失留白，不影响任何一条文字的可读性）
  //    分隔线画在 y + block.h/2 上，所以直接改 block.h 就能让它自动重新居中；
  // ② 再压页脚留白（那一块只有一行小字，本身用不满）；
  // ③ 最后削上下内边距（底线 6px，保证内容不贴边）。
  // 顺序很重要：被裁掉的绝不能是底部的「强化」按钮 —— 那才是要紧的东西。
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
  // 给输入层用（判断触摸是否在面板内、面板大小）
  game._panelRect = { x: panelX, y: panelY, w: panelW, h: panelH };

  // ---------- 滚动支持 ----------
  // 内容总高 - 面板高 = 可滚动距离
  const scrollable = contentH > availH;
  const maxScroll = scrollable ? (contentH - availH) : 0;
  if (scrollable) {
    // 打开面板时重置滚动到顶部
    if (game.panelScrollOffset === undefined || game.panelScrollOffset === null) {
      game.panelScrollOffset = 0;
    }
    game.panelScrollMax = maxScroll;
    // 边界修正（防止面板缩放后 maxScroll 变小）
    if (game.panelScrollOffset > maxScroll) game.panelScrollOffset = maxScroll;
  } else {
    game.panelScrollMax = 0;
    game.panelScrollOffset = 0;
  }
  const scroll = game.panelScrollOffset || 0;

  // 背板 + 描边（同时建立裁剪区，超出屏幕的内容自动切掉而非糊出面板）
  // 透明度取 0.96：再低会让战场上的"第 N 波"横幅、选中塔名称标签从面板中间透出来，很脏。
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

  // （属性面板不再画滚动条，滑动交互由 panelScrollOffset 驱动，保持不变。）

  // ---------- ③ 逐块绘制（应用滚动偏移） ----------
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

  // 滚动提示（内容可滚动时显示）：到顶/到底就把对应那一侧的提示收掉，
  // 免得"已经滑到底了还在喊再滑"这种假提示。
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

  // 「强化」按钮的点击波纹（只画 panel 层的）
  drawButtonFx(game, ctx, 'panel');
}

/** 标题区：塔图标 + 名称 + 阶段星 + 造价 */


/** 标题区：塔图标 + 名称 + 阶段星 + 造价 */
function drawPanelHeader(ctx, block, panelX, y, panelW, towerDef, towerType, tower) {
  const left = panelX + PANEL_UI.padX;
  const right = panelX + panelW - PANEL_UI.padX;
  const iconX = left + 14;
  const iconY = y + block.h / 2;

  drawTowerIcon(ctx, iconX, iconY, towerDef.color, towerType);

  // 名称
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = towerDef.color;
  ctx.font = 'bold 18px Arial';
  const nameX = left + 34;
  const nameY = y + 17;
  ctx.fillText(towerDef.name, nameX, nameY);
  const nameW = ctx.measureText(towerDef.name).width;

  // 阶段星：紧跟名称右侧（真实星形图案，非 emoji 字符）
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

  // 造价/价值（右上角）
  if (tower && tower._cumulativeGold > 0) {
    // 已放置的塔：显示"价值"（出售返还 70%），替代原来的"造价"
    ctx.textAlign = 'right';
    ctx.fillStyle = THEME.text.dim;
    ctx.font = '11px Arial';
    ctx.fillText('价值', right, y + 14);
    ctx.fillStyle = THEME.accent.gold;
    ctx.font = 'bold 16px Arial';
    const refund = Math.round(tower._cumulativeGold * 0.7);
    ctx.fillText(`${refund}`, right, y + 34);
  } else {
    // 商店/图签预览：显示"造价"（未放置，无价值）
    ctx.textAlign = 'right';
    ctx.fillStyle = THEME.text.dim;
    ctx.font = '11px Arial';
    ctx.fillText('造价', right, y + 14);
    ctx.fillStyle = THEME.accent.gold;
    ctx.font = 'bold 16px Arial';
    ctx.fillText(`${towerDef.cost}`, right, y + 34);
  }
}

/**
 * 属性区：左侧标签，右侧数值。
 * 数值遵循"基础值+加值"双色规则：基础值白字，加值绿字（增益）/ 红字（负面效果）。
 * 有来源明细的属性（等级 / 阶段增幅）在下一行用小字列出算式来源。
 */


/**
 * 属性区：左侧标签，右侧数值。
 * 数值遵循"基础值+加值"双色规则：基础值白字，加值绿字（增益）/ 红字（负面效果）。
 * 有来源明细的属性（等级 / 阶段增幅）在下一行用小字列出算式来源。
 */
function drawPanelAttrRows(ctx, block, panelX, y, panelW) {
  const left = panelX + PANEL_UI.padX;
  const right = panelX + panelW - PANEL_UI.padX;
  let rowY = y;

  for (const row of block.rows) {
    const midY = rowY + PANEL_UI.rowH / 2;

    // 标签
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '14px Arial';
    ctx.fillStyle = ROW_LABEL_COLOR[row.key] || THEME.text.secondary;
    ctx.fillText(row.label, left, midY);

    // 数值：先画加值（右对齐），再把基础值顶到加值左边
    const bonusColor = row.sign > 0 ? THEME.accent.green : (row.sign < 0 ? THEME.accent.danger : null);
    const VALUE_FONT = 'bold 15px Arial';
    const VALUE_GAP = 1.5;   // 基础值与加值之间的呼吸间隙

    ctx.font = VALUE_FONT;   // 必须先定字体再量宽，否则量出的宽度与绘制不一致 → 数值重叠
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

    // 来源明细子行：· 等级 Lv.2 ............ +20%
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

/** 生效效果区：光环增益 / 负面效果逐条列出（来源 + 数值 + 剩余时间） */


/** 生效效果区：光环增益 / 负面效果逐条列出（来源 + 数值 + 剩余时间） */
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

    // 状态圆点
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

/** 攻击介绍区：左对齐自动换行（行数已预排版，高度不再瞎猜） */


/** 攻击介绍区：左对齐自动换行（行数已预排版，高度不再瞎猜） */
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

/**
 * 固有技能区：标题 + 一个或多个【技能槽】。
 *
 * 槽的形态（需求原话）：左边技能图标，右边技能名 + Lv{等级} 与介绍。
 * 排版全部交给 src/skillSlot.js —— 那里同时负责算高度，两边不会打架。
 * @param {object} block { h, slots }
 */


/**
 * 固有技能区：标题 + 一个或多个【技能槽】。
 *
 * 槽的形态（需求原话）：左边技能图标，右边技能名 + Lv{等级} 与介绍。
 * 排版全部交给 src/skillSlot.js —— 那里同时负责算高度，两边不会打架。
 * @param {object} block { h, slots }
 */
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

/**
 * 宝石区：该塔型已嵌入的宝石（与固有技能绑定，跨局永久）。
 * 只读展示 —— 嵌入/取出都在图签的槽位上操作，这里给出"这颗塔带了什么珠子"。
 * 竖排：每颗一颗，图标 + 名字 + 属性效果。
 */


/**
 * 宝石区：该塔型已嵌入的宝石（与固有技能绑定，跨局永久）。
 * 只读展示 —— 嵌入/取出都在图签的槽位上操作，这里给出"这颗塔带了什么珠子"。
 * 竖排：每颗一颗，图标 + 名字 + 属性效果。
 */
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

    // 珠子逐个竖排，每颗用【圆角卡】框住（左侧图标+槽位 + 右侧名字/描述，同固有技能布局）
    // 自适应换行：短描述 + 详细文本均按文本宽换行，卡高 = gemCardHeight（与区块高度同源）
    const gemPad = 6;
    const iconSize = 14;
    const iconR = iconSize / 2;
    const slotSize = iconSize + 8;
    const textW = gemTextWidth(panelW);
    const textX0 = left + gemPad + slotSize + 10; // 槽位右边缘 + 10px
    let cardY = y + PANEL_UI.sectionTitleH;
    for (const entry of entries) {
      const def = gems.gemDef(entry.kind);
      if (!def) continue;

      const cardW = contentW;
      const cardH = gemCardHeight(ctx, entry, textW);
      const eff = gems.effectTextAt(entry.kind, entry.lv) || '';
      const detail = gems.detailTextAt(entry.kind) || '';
      const effLines = eff
        ? wrapTextLines(ctx, eff, textW, '10px Arial') : [];
      const detLines = detail
        ? wrapTextLines(ctx, detail, textW, '10px Arial') : [];

      // 圆角卡背景
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

      // 图标槽位（与固有技能槽位一致：深色底 + 紫边框 + 圆角）
      const slotCX = left + gemPad + slotSize / 2; // 槽中心 X
      const slotCY = cardY + cardH / 2;            // 槽中心 Y（与卡片同高居中）
      const slotX = slotCX - slotSize / 2;
      const slotY = slotCY - slotSize / 2;
      // 槽位用锐角矩形（圆角太小会导致图标被圆角"吃"掉、看起来偏）
      ctx.beginPath();
      ctx.rect(slotX, slotY, slotSize, slotSize);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(179,136,255,0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
      // 宝石图标（槽位正中；钻石切面几何中心偏上 1px，故补 +1 让视觉居中）
      gems.drawGemIcon(ctx, slotCX, slotCY + 1, iconR, entry.kind, { lv: entry.lv });

      // 右侧：名字（单行，超宽截断）+ 短描述（换行全显）+ 详细文本（换行全显）
      const textX = textX0;

      // 名字
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 11px Arial';
      ctx.fillStyle = def.color;
      const label = gems.gemName(entry.kind, entry.lv);
      let ty = cardY + PANEL_UI.gemCardPadV + PANEL_UI.gemNameH / 2;
      ctx.fillText(ellipsize(ctx, label, textW), textX, ty);
      ty += PANEL_UI.gemNameH / 2;

      // 短描述（含镇守宝石「（需3★生效）」后缀，见 config.gemDescAt）：逐行全显
      ctx.font = '10px Arial';
      ctx.fillStyle = THEME.text.off;
      for (const line of effLines) {
        ty += PANEL_UI.gemWrapLineH / 2;
        ctx.fillText(line, textX, ty);
        ty += PANEL_UI.gemWrapLineH / 2;
      }

      // 详细文本介绍（全系补写，纯文案；镇守宝石重申 3★ 条件）：逐行全显
      ctx.font = '10px Arial';
      ctx.fillStyle = THEME.text.secondary;
      for (const line of detLines) {
        ty += PANEL_UI.gemWrapLineH / 2;
        ctx.fillText(line, textX, ty);
        ty += PANEL_UI.gemWrapLineH / 2;
      }

      // 卡间距交给 gemGap（与区块高度同源）；**不在两卡之间画任何装饰** ——
      // 曾经那条 inset 的紫色小长条（left+12 / cardW-24 / 6.3px 高）本身有 2.3px
      // 压在第 2 张卡上，看着就是个说不清来历的流氓元素，玩家会问"这是什么"。
      // 卡本身有描边，两张卡之间留白就够分隔了。
      cardY += cardH + PANEL_UI.gemGap;
    }
}

/**
 * 强化区：花金币提升该塔的【固有技能】等级（局内，不跨局）。
 * 规则：
 *   · 只有【进阶到 3★】的图形塔才能强化（橙色提示当前星级）
 *   · 强化 = 技能等级 +1 = 该技能的全部效果一起涨，**不再发放任何攻击力加成**
 *     （技能表见 src/skills.js；每条效果的当前取值在下方属性行里看）
 * 商店预览（没有实体塔）时不可用，提示"放置后可强化"。
 * 按钮矩形写入 game.panelEnhanceBtn，供输入层命中（渲染每帧刷新，永不失效）。
 */


/**
 * 强化区：花金币提升该塔的【固有技能】等级（局内，不跨局）。
 * 规则：
 *   · 只有【进阶到 3★】的图形塔才能强化（橙色提示当前星级）
 *   · 强化 = 技能等级 +1 = 该技能的全部效果一起涨，**不再发放任何攻击力加成**
 *     （技能表见 src/skills.js；每条效果的当前取值在下方属性行里看）
 * 商店预览（没有实体塔）时不可用，提示"放置后可强化"。
 * 按钮矩形写入 game.panelEnhanceBtn，供输入层命中（渲染每帧刷新，永不失效）。
 */
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

  // 没有实体塔（商店预览）→ 强化不可用
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

  // 兜底：该塔类型没有登记固有技能（src/skills.js 漏配）→ 直接说清楚，
  // 绝不把"需 3★"这种假门槛画出来，更不许把按钮挂上去（点了会白花金币）。
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

  // ⚠️ 两套口径别混（2026-09-20 定稿，见 src/skills.js 的「等级口径」段）：
  //    显示 = 【当前等级/可学等级】（skills.levelText，含宝石 / 十字塔共享）；
  //    满级判定 + 报价 = 【学习次数】（额外等级不占学习额度）—— 与 enhance.js / tower.canEnhance 同源。
  const learned = towerMod.getLearnTimes(tower);
  const learnCap = skills.baseLearnCap(tower.type);
  const curLv = skills.currentLevel(tower, tower.type);
  const stage = tower.stage || 0;
  const needStage = BALANCE.enhance.minStage;
  const stageReady = towerMod.isStageReady(tower);
  const maxed = learned >= learnCap;
  const cost = maxed ? Infinity : towerMod.getEnhanceCost(tower.type, learned);
  const affordable = !maxed && game.gold >= cost;
  const usable = stageReady && !maxed;

  game.panelEnhanceBtn = btn;

  // 左：当前强化等级 + 门槛/下一级收益
  // 文案必须按左侧可用宽度裁剪（按钮从 right-btnW 开始，不能让文字压到按钮上）
  const availW = Math.max(40, btn.x - left - 8);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 13px Arial';
  ctx.fillStyle = curLv > 0 ? THEME.accent.green : THEME.text.primary;
  ctx.fillText(`${skills.INNATE_LABEL} ${skills.levelText(tower, tower.type)}`, left, y + 20);

  ctx.font = '10px Arial';
  if (!stageReady) {
    ctx.fillStyle = THEME.accent.gold;
    ctx.fillText(ellipsize(ctx, `需进阶到 ★${'★'.repeat(needStage - 1)}（当前 ${stage}★）才能强化`, availW), left, y + 37);
  } else if (maxed) {
    // 学习额度（= 玩家花金币学出来的次数）已满。宝石 / 十字塔共享给的那份等级是"地基"，
    // 不占这个额度（可学等级 = 额外等级 + 5），所以这里必须说清"满的是哪一份"，
    // 否则玩家会以为"嵌了宝石就再也强化不了"。同口径文案见 src/enhance.js。
    ctx.fillStyle = THEME.text.off;
    ctx.fillText(
      ellipsize(ctx, `学习已达上限（${learned}/${learnCap}）${
        skills.gemLevels(tower.type) > 0 ? '；宝石 / 共享的等级另算' : ''}`, availW),
      left, y + 37
    );
  } else {
    // 每次强化的收益（多效果技能拼成「暴击几率 +5% · 暴击伤害 +10%」，宽了自动省略）
    const gainLabel = skills.skillGainLabel(tower.type);
    ctx.fillStyle = THEME.text.off;
    ctx.fillText(
      ellipsize(ctx, gainLabel ? `每次强化 ${gainLabel}` : '每次强化提升固有技能', availW),
      left, y + 37
    );
  }

  // 右：强化按钮
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

/** 底部提示 */


/** 底部提示 */
function drawPanelFooter(ctx, block, cx, y) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '11px Arial';
  ctx.fillStyle = THEME.text.dim;
  ctx.fillText('点击任意位置关闭', cx, y + block.h / 2);
}

/**
 * 计算拖放落点槽位（手指下的放置槽），返回 slot 或 null
 */


/**
 * 绘制生存条（轨道 + 柔和渐变填充 + 描边）
 * 语义：玩家剩余生存积分（生命）的进度，归零判负——是"剩余量"而非"得分"。
 * @param {number} percent 填充比例 0~1
 * @param {string[]} gradient 渐变色列表（柔和色调，避免刺眼）
 * @param {boolean} fillFromRight true=从右向左填充（右侧镜像条）
 */
function drawLifeBar(ctx, x, y, w, h, percent, gradient, fillFromRight) {
  percent = Math.max(0, Math.min(1, percent || 0));
  if (w <= 0) return;

  // 轨道
  ctx.fillStyle = THEME.track.bar;
  ctx.beginPath();
  ctx.roundRect(x, y - h / 2, w, h, h / 2);
  ctx.fill();

  // 渐变填充
  if (percent > 0) {
    const fw = Math.max(h, w * percent); // 极小填充时保留圆点
    const fx = fillFromRight ? x + w - fw : x;
    const grad = ctx.createLinearGradient(fx, 0, fx + fw, 0);
    gradient.forEach((color, i) => grad.addColorStop(i / (gradient.length - 1), color));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(fx, y - h / 2, fw, h, h / 2);
    ctx.fill();
  }

  // 描边
  ctx.strokeStyle = THEME.border.normal;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x, y - h / 2, w, h, h / 2);
  ctx.stroke();
}

/**
 * 获取玩家积分进度（0~1）
 * 玩家0（本地红色方）= 真实生存积分 lives / maxLives；玩家1（蓝色方，预留联机）暂用占位值
 */


/**
 * 获取玩家积分进度（0~1）
 * 玩家0（本地红色方）= 真实生存积分 lives / maxLives；玩家1（蓝色方，预留联机）暂用占位值
 */
function getPlayerScoreProgress(game, index) {
  // 玩家0（本地红色方）：真实生存积分进度
  if (index === 0 && game.maxLives > 0) {
    return Math.max(0, Math.min(1, game.lives / game.maxLives));
  }
  // 玩家1（蓝色方，预留联机）：暂无对手数据，保留占位演示值
  return 0.5;
}

/**
 * 绘制波次标题：药丸形背景 + 红→蓝柔和渐变，风格与左右生存条统一
 * @param {object} ctx 画布
 * @param {number} cx 中心x
 * @param {number} cy 中心y
 * @param {number} w 背景宽
 * @param {number} h 背景高
 * @param {string} text 标题文字
 */


/**
 * 绘制波次标题：药丸形背景 + 红→蓝柔和渐变，风格与左右生存条统一
 * @param {object} ctx 画布
 * @param {number} cx 中心x
 * @param {number} cy 中心y
 * @param {number} w 背景宽
 * @param {number} h 背景高
 * @param {string} text 标题文字
 */
function drawWaveTitle(ctx, cx, cy, w, h, text) {
  const x = cx - w / 2;
  const y = cy - h / 2;

  // 药丸形背景：红 → 中性 → 蓝 柔和渐变（统一阵营色）
  ctx.fillStyle = teamBandGradient(ctx, x, x + w, 1);
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h / 2);
  ctx.fill();

  // 描边
  ctx.strokeStyle = THEME.border.strong;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h / 2);
  ctx.stroke();

  // 标题文字
  ctx.fillStyle = THEME.text.primary;
  ctx.font = 'bold 18px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, cy);
}

// ========== 波次标题动态动画（倒计时滚轮 + 进攻开始 + 标题滑入） ==========
// 缓动函数 easeOutCubic / easeOutBack 统一由 theme.js 提供（见文件头部的解构导入）

/**
 * 绘制"滚轮数字"（odometer 风格）：数字 5→4→3→2→1 在窗口内连续滚动。
 * reelIndex 为浮点（0=显示5，4=显示1），随倒计时连续变化即产生滚动感。
 * @param {object} ctx 画布
 * @param {number} cx 窗口中心x
 * @param {number} cy 窗口中心y
 * @param {number} reelIndex 0..4（浮点）
 */


// ========== 波次标题动态动画（倒计时滚轮 + 进攻开始 + 标题滑入） ==========
// 缓动函数 easeOutCubic / easeOutBack 统一由 theme.js 提供（见文件头部的解构导入）

/**
 * 绘制"滚轮数字"（odometer 风格）：数字 5→4→3→2→1 在窗口内连续滚动。
 * reelIndex 为浮点（0=显示5，4=显示1），随倒计时连续变化即产生滚动感。
 * @param {object} ctx 画布
 * @param {number} cx 窗口中心x
 * @param {number} cy 窗口中心y
 * @param {number} reelIndex 0..4（浮点）
 */
function drawReel(ctx, cx, cy, reelIndex) {
  const digits = ['5', '4', '3', '2', '1'];
  const H = 56;            // 每个数字格高
  const winW = 74;         // 窗口宽
  const winH = H;          // 窗口高
  const x = cx - winW / 2;
  const yTop = cy - winH / 2;

  // 面板底
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.beginPath();
  ctx.roundRect(x - 4, yTop - 4, winW + 8, winH + 8, 10);
  ctx.fill();

  // 裁剪到窗口，画滚动数字
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

  // 上下渐隐（滚轮纵深）
  const fade = ctx.createLinearGradient(0, yTop, 0, yTop + winH);
  fade.addColorStop(0,    'rgba(26,26,46,0.85)');
  fade.addColorStop(0.3,  'rgba(26,26,46,0)');
  fade.addColorStop(0.7,  'rgba(26,26,46,0)');
  fade.addColorStop(1,    'rgba(26,26,46,0.85)');
  ctx.fillStyle = fade;
  ctx.fillRect(x, yTop, winW, winH);
  ctx.restore();

  // 窗口描边
  ctx.strokeStyle = THEME.border.strong;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x - 4, yTop - 4, winW + 8, winH + 8, 10);
  ctx.stroke();
}

/**
 * 波次倒计时动画舞台（在波次之间播放）：
 *   第一秒：旧"第 N 波"标题从西面被顶上去并淡出，同时滚轮从 5 开始滚；
 *   中间：  滚轮 5→4→3→2→1 连续滚动；
 *   最后一秒："进攻开始"放大冲入。
 * 完全由 remaining(=waitTimer) 驱动，纯函数，跨重启稳健。
 * @param {object} game 游戏实例
 * @param {number} cx 中心x
 * @param {number} cy 中心y
 * @param {number} remaining 剩余倒计时（秒）
 * @param {number} waitDuration 总倒计时（秒）
 */


/**
 * 波次倒计时动画舞台（在波次之间播放）：
 *   第一秒：旧"第 N 波"标题从西面被顶上去并淡出，同时滚轮从 5 开始滚；
 *   中间：  滚轮 5→4→3→2→1 连续滚动；
 *   最后一秒："进攻开始"放大冲入。
 * 完全由 remaining(=waitTimer) 驱动，纯函数，跨重启稳健。
 * @param {object} game 游戏实例
 * @param {number} cx 中心x
 * @param {number} cy 中心y
 * @param {number} remaining 剩余倒计时（秒）
 * @param {number} waitDuration 总倒计时（秒）
 */
function drawWaveCountdown(game, cx, cy, remaining, waitDuration) {
  const ctx = game.ctx;
  ctx.save();

  // ---- 旧波次标题：从西面被往上顶 + 淡出（第一窗口内完成）----
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
    // ---- 进攻开始：放大冲入 + 金色发光 ----
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
    // ---- 滚轮数字：5→4→3→2→1 连续滚动 ----
    const reelIndex = Math.max(0, Math.min(4, waitDuration - remaining));
    drawReel(ctx, cx, cy, reelIndex);
  }

  ctx.restore();
}

/**
 * 波次标题（波次进行中显示），带"滑入"动画：波次刚开始时从上方滑落到位。
 * @param {object} game 游戏实例
 */


/**
 * 波次标题（波次进行中显示），带"滑入"动画：波次刚开始时从上方滑落到位。
 * @param {object} game 游戏实例
 */
function drawWaveTitleAnimated(game, cx, cy, w, h, text) {
  const ctx = game.ctx;
  const now = Date.now();
  const elapsed = (game.waveStartStamp > 0) ? (now - game.waveStartStamp) / 1000 : 1;
  if (elapsed >= 0.6) {
    drawWaveTitle(ctx, cx, cy, w, h, text);
    return;
  }
  const p = Math.max(0, Math.min(1, elapsed / 0.6));
  const eased = easeOutCubic(p);
  ctx.save();
  ctx.globalAlpha = eased;
  drawWaveTitle(ctx, cx, cy - 40 * (1 - eased), w, h, text);
  ctx.restore();
}

/**
 * 顶部状态栏：关卡徽标（可点开关卡选择）/ 生存积分 / 金币。
 * 金币从底栏挪到顶栏——底栏现在归重做后的商店面板用。
 */


/**
 * 顶部状态栏：关卡徽标（可点开关卡选择）/ 生存积分 / 金币。
 * 金币从底栏挪到顶栏——底栏现在归重做后的商店面板用。
 */
function drawTopBar(game) {
  const ctx = game.ctx;
  const width = game.W;
  const H = LAYOUT.topBarHeight;
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
  ctx.fillRect(0, 0, width, H);

  // 左：关卡徽标（纯展示，不可点击——选关已搬到战前居中面板）
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

  // 右：☰ 游戏菜单按钮 / 🔊 音乐开关（从右往左排，见 gamemenu.js 文件头）
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

  // ☰ 按钮的点击波纹（只画 topbar 层的，见 theme.drawButtonFx）
  drawButtonFx(game, ctx, 'topbar');
}



function drawUI(game) {
  const ctx = game.ctx;
  const width = game.W;
  const height = game.H;

  // 顶部状态栏：关卡徽标 / 生存积分 / 金币
  drawTopBar(game);

  // 屏幕中心波次标题 - 向上偏移
  const centerLineY = height / 2 - 40;
  const waveText = `第 ${game.currentWave} 波`;

  // 测量文本宽度，自适应背景（标题与左右积分条同一条水平线）
  ctx.font = 'bold 18px Arial';
  const textWidth = ctx.measureText(waveText).width || 80;
  const bgWidth = textWidth + 60;
  const bgHeight = 40;
  const bgX = width / 2 - bgWidth / 2;

  // 左右生存条：左侧=我方（红，填充 左→右），右侧=对方（蓝，填充 右→左，预留联机）
  const barH = 10;      // 生存条高度
  const barEdge = 10;   // 距屏幕边缘
  const barGap = 10;    // 距标题
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

  // 标题：药丸形 + 红→蓝柔和渐变，风格与左右生存条统一
  drawWaveTitle(ctx, width / 2, centerLineY, bgWidth, bgHeight, waveText);

  // BOSS 大血条：红方 BOSS 在波次标题下方，蓝方 BOSS 在波次标题上方
  coreMod().drawBossBars(game, centerLineY, bgHeight);

  // ========== 重做后的商店板块 ==========
  // 标题栏（商店徽标 + 藏珍点 + 刷新按钮）+ 3 张塔卡；坐标由 shop.getShopLayout 统一提供
  shop.drawShop(game);

  // 注意：结算界面不在这里画——它必须盖住底部导航栏，
  // 所以由 render() 在导航栏之后统一绘制（见 drawGameOver 的调用点）。
}

/**
 * 结算界面（失败 / 胜利）：与游戏内 UI 统一风格。
 * 从原 drawUI 尾部抽出，逻辑不变。
 */


/**
 * 结算界面（失败 / 胜利）：与游戏内 UI 统一风格。
 * 从原 drawUI 尾部抽出，逻辑不变。
 */
function drawGameOver(game) {
  const ctx = game.ctx;
  const width = game.W;
  const height = game.H;

  const showWin = !!game.gameWon;
  const showFail = game.lives <= 0 && !showWin;
  if (!showFail && !showWin) return;
  // 全屏遮罩
  ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
  ctx.fillRect(0, 0, width, height);

  // 居中圆角面板（自适应宽度，风格与塔属性面板一致）
  const panelW = Math.min(360, width - 32);
  // 有宝石奖励时把面板加高，给奖励容器留位置；没有（理论上 gameOver 时必已结算）保持原高
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

  // 标题药丸（风格与波次标题一致）
  const titleText = showFail ? '游戏结束' : '胜利！';
  const titleTop = showFail ? 'rgba(229, 115, 115, 0.55)' : 'rgba(255, 215, 0, 0.55)';
  const titleBottom = showFail ? 'rgba(255, 68, 68, 0.35)' : 'rgba(255, 170, 0, 0.35)';
  drawPillTitle(ctx, cx, panelY + 56, titleText, titleTop, titleBottom, panelW - 24);

  // 坚持波数
  ctx.fillStyle = THEME.text.secondary;
  ctx.font = '16px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`坚持波数: ${game.currentWave}`, cx, panelY + 116);

  // 本局收获（金币/积分不跨局，只有积分与天赋点进存档）
  ctx.font = '12px Arial';
  ctx.fillStyle = THEME.text.dim;
  ctx.fillText(
    showWin
      ? '关卡完成 · 藏珍点与天赋点已入账'
      : '本次收获的藏珍点已全部入账',
    cx, panelY + 142
  );

  // 宝石奖励（容器：有几颗画几个槽）：观看视频复活的倒计时状态下不画，避免和倒计时文字重叠
  if (reward && !game.watchingVideo) {
    drawGemReward(ctx, game, panelX, panelY, panelW);
  }

  if (showWin) {
    // 胜利：单个"返回主页"按钮（主操作 = 增益绿）
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
    // 失败 - 观看视频倒计时
    game.gameOverButtons = {};
    ctx.fillStyle = THEME.accent.gold;
    ctx.font = 'bold 26px Arial';
    ctx.fillText(`视频倒计时: ${Math.max(0, Math.ceil(game.videoTimer))} 秒`, cx, panelY + 190);
    ctx.fillStyle = THEME.text.secondary;
    ctx.font = '14px Arial';
    ctx.fillText('观看广告后可继续游戏', cx, panelY + 226);
  } else {
    // 失败 - 按钮：AD.enabled 为 false 时，再次挑战按钮变灰不可点
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

  // 结算按钮的点击波纹（只画 gameover 层的）
  drawButtonFx(game, ctx, 'gameover');
}

/**
 * 结算界面的「宝石奖励」容器面板（2026-09-22 工单：容器化）。
 * 数据来自 game.gemReward.slots（发放逻辑仍是 9 格洗牌选位，见 game_core.grantRewardGems，
 * 本函数只动展示）—— 展示时只取有效项（{kind,count} 且 count>0），空位直接丢弃：
 *   · 不再画 9 宫格、不再显示上限（没有 "/9"、没有空虚线格）；
 *   · 获得几颗就显示几个槽位（列数 = min(n,3)，行数 = ceil(n/列数)，末行居中）；
 *   · 重复宝石不叠加：每颗独立占一槽（发放侧本就每格 1 颗，这里原样逐槽画出）。
 * 与背包页共用 gems.drawGemIcon，保证"奖励里长什么样、嵌进塔就长什么样"。
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} game
 * @param {number} panelX, panelY, panelW
 */
function drawGemReward(ctx, game, panelX, panelY, panelW) {
  const reward = game.gemReward;
  const cx = game.W / 2;
  const labelY = panelY + 166;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 13px Arial';
  if (reward.triggered && reward.total > 0) {
    ctx.fillStyle = THEME.accent.gold;
    ctx.fillText(`宝石奖励 · 共 ${reward.total} 颗（均为 LV1 基础宝石）`, cx, labelY);
  } else if (reward.triggered) {
    ctx.fillStyle = THEME.text.off;
    ctx.fillText('宝石奖励 · 本次未获得', cx, labelY);
  } else {
    ctx.fillStyle = THEME.text.off;
    ctx.fillText('宝石奖励', cx, labelY);
  }

  // 容器：只收纳实际获得的宝石（空位丢弃，不画上限格）
  // 槽位规则：列数 = min(n,3)，行数 = ceil(n/列数)；每行独立居中（末行不满也居中）；
  // 3 行时槽位略缩（30→28），保证容器底不压到底部按钮（面板高 388 不动）。
  const cells = (reward.slots || []).filter((c) => c && c.count > 0 && gems.isGemKind(c.kind));
  const n = cells.length;
  const boxPad = 8, gap = 8;
  const cols = n > 0 ? Math.min(n, 3) : 1;
  const rows = n > 0 ? Math.ceil(n / cols) : 1;
  const slot = rows >= 3 ? 28 : 30;
  const gridW = cols * slot + (cols - 1) * gap;
  const gridH = rows * slot + (rows - 1) * gap;
  const boxW = gridW + boxPad * 2;
  const boxH = n > 0 ? gridH + boxPad * 2 : 46;
  const boxX = cx - boxW / 2;
  const boxY = labelY + 14;

  // 容器底
  ctx.save();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 1;
  if (typeof ctx.roundRect === 'function') ctx.roundRect(boxX, boxY, boxW, boxH, 10);
  else ctx.rect(boxX, boxY, boxW, boxH);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  if (n === 0) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '11px Arial';
    ctx.fillStyle = THEME.text.off;
    ctx.fillText('空', cx, boxY + boxH / 2);
    return;
  }

  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols);
    // 本行实际几颗（末行可能不满）→ 行内居中
    const rowCount = Math.min(cols, n - r * cols);
    const rowW = rowCount * slot + (rowCount - 1) * gap;
    const c = i % cols;
    const x = cx - rowW / 2 + c * (slot + gap);
    const y = boxY + boxPad + r * (slot + gap);
    const cell = cells[i];

    ctx.save();
    // 格底
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, slot, slot, 7);
    else ctx.rect(x, y, slot, slot);
    ctx.fill();

    // 边框：该宝石色描边（每颗独立一槽，重复宝石各占一格不叠加）
    // 结算奖励格永远是 Lv.1 基础宝石（等级靠合成提升）
    ctx.strokeStyle = gems.shadeColor(gems.gemColor(cell.kind, 1), -0.1, 0.6);
    ctx.lineWidth = 1;
    if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, slot, slot, 7);
    else ctx.rect(x, y, slot, slot);
    ctx.stroke();

    // 宝石本体（每格恰好 1 颗 LV1 基础宝石）+ "Lv1" 标记
    gems.drawGemIcon(ctx, x + slot / 2, y + slot / 2 - 3, slot / 3, cell.kind, { lv: 1 });
    ctx.font = 'bold 9px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    ctx.fillText('Lv1', x + slot / 2, y + slot - 4);
    ctx.restore();
  }
}

/**
 * 战斗场景绘制：路径 / 选中范围 / 槽位 / 塔 / 怪物 / 血条 / 弹道 / 特效 / 拖拽预览 / UI。
 * 从原 render() 抽成独立函数——因为 render() 现在要按"场景"分派（战斗 / 图签 / 天赋）。
 */


/**
 * 轻提示（操作反馈）：多条同屏、各自独立计时、互相顶位。
 * 数据由 theme.pushToast 写入 game.toasts = [{ text, color, t0, duration, y }]。
 *
 * 动效：
 *   ① 默认出现在屏幕高度 45% 处，先原地淡入（淡入期间不位移），
 *      同时带一个「由大到小」的收缩动画（spawnScale → 1.0）；
 *   ② 淡入完成后开始向上漂浮；
 *   ③ 后续提示到来时，把前面的整体顶上去（y 逐帧缓动，不瞬移），形成动态层次；
 *   ④ 每条活满各自的 duration 后淡出并回收。
 * 视觉：文字上下各一条「中间实、两端渐隐」的分割线；
 *      背景为横向渐变（中间不透明度高、两侧渐隐为透明），不用旧的圆角药丸 + 描边。
 */
function drawToasts(game) {
  const list = game.toasts;
  if (!list || !list.length) return;

  const ctx = game.ctx;
  const W = game.W;
  const H = game.H;
  const now = Date.now();

  // 帧间隔：draw 没有 dt，用上一帧时间戳自己算（顶位缓动要用）
  const dt = Math.min(0.05, Math.max(0.001, (now - (game._toastFrameTs || now)) / 1000));
  game._toastFrameTs = now;

  const baseY = H * TOAST.baseYRatio;
  const step = TOAST.lineHeight + TOAST.gap;

  // 回收：活满各自 duration 的移除
  for (let i = list.length - 1; i >= 0; i--) {
    if ((now - list[i].t0) / 1000 >= list[i].duration) list.splice(i, 1);
  }
  if (!list.length) return;

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${TOAST.fontSize}px Arial`;

  const maxTextW = W - 48;

  // 由旧到新绘制：最新的压在其它之上
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    const age = (now - t.t0) / 1000;

    // 透明度：开头淡入、结尾淡出
    const aIn = Math.min(1, age / TOAST.fadeIn);
    const aOut = Math.min(1, Math.max(0, (t.duration - age) / TOAST.fadeOut));
    const alpha = Math.max(0, Math.min(aIn, aOut));
    if (alpha <= 0.001) continue;

    // 淡入完成后开始向上漂浮（越老漂得越高）
    const riseT = Math.min(1, Math.max(0, (age - TOAST.fadeIn) / Math.max(0.001, t.duration - TOAST.fadeIn)));
    const rise = TOAST.rise * easeOutCubic(riseT);

    // 被后面的（更新的）提示顶上去：越靠前，目标位越高
    const stackOffset = (list.length - 1 - i) * step;
    const targetY = baseY - rise - stackOffset;

    if (t.y === null || t.y === undefined) t.y = targetY;
    else t.y += (targetY - t.y) * Math.min(1, dt * 14);

    // 淡入附带「由大到小」收缩：起手放大，随淡入完成回到原尺寸
    const spawnT = Math.min(1, age / TOAST.fadeIn);
    const scale = 1 + (TOAST.spawnScale - 1) * (1 - easeOutCubic(spawnT));

    const text = ellipsize(ctx, t.text, maxTextW);
    const tw = ctx.measureText(text).width || 60;
    const w = Math.min(W - 24, tw + TOAST.padX);

    ctx.save();
    ctx.translate(W / 2, t.y);
    ctx.scale(scale, scale);
    drawToastBand(ctx, 0, 0, w, t.color, alpha, text);
    ctx.restore();
  }

  ctx.restore();
}

/** 画一条轻提示：横向渐隐背景 + 上下分割线 + 居中文字 */


/** 画一条轻提示：横向渐隐背景 + 上下分割线 + 居中文字 */
function drawToastBand(ctx, cx, cy, w, color, alpha, text) {
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const halfH = TOAST.lineHeight / 2;

  ctx.globalAlpha = alpha;

  // 背景：中间不透明度高，两侧渐隐为透明
  const bg = ctx.createLinearGradient(x0, 0, x1, 0);
  bg.addColorStop(0, shade(TOAST.bgColor, 0, 0));
  bg.addColorStop(0.22, shade(TOAST.bgColor, 0, TOAST.bgAlpha * 0.72));
  bg.addColorStop(0.5, shade(TOAST.bgColor, 0, TOAST.bgAlpha));
  bg.addColorStop(0.78, shade(TOAST.bgColor, 0, TOAST.bgAlpha * 0.72));
  bg.addColorStop(1, shade(TOAST.bgColor, 0, 0));
  ctx.fillStyle = bg;
  ctx.fillRect(x0, cy - halfH, w, TOAST.lineHeight);

  // 上下分割线（同款横向渐隐）
  drawToastLine(ctx, cx, cy - TOAST.dividerOffset, w * 0.92, color);
  drawToastLine(ctx, cx, cy + TOAST.dividerOffset, w * 0.92, color);

  // 文字
  ctx.fillStyle = color;
  ctx.fillText(text, cx, cy);
  ctx.globalAlpha = 1;
}

/** 轻提示的上下分割线：中间实、两端渐隐 */


/** 轻提示的上下分割线：中间实、两端渐隐 */
function drawToastLine(ctx, cx, y, w, color) {
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const g = ctx.createLinearGradient(x0, 0, x1, 0);
  g.addColorStop(0, shade(color, 0, 0));
  g.addColorStop(0.18, shade(color, 0, 0.55));
  g.addColorStop(0.5, shade(color, 0, 0.9));
  g.addColorStop(0.82, shade(color, 0, 0.55));
  g.addColorStop(1, shade(color, 0, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x0, y - 0.5, w, 1);
}

// 组合一帧的完整绘制（按场景分派）

module.exports = {

  // 弹道层：drawProjectiles = 弹道循环 + 特效层；
  // drawProjectileShape / drawEffects 拆出来是为了能被探针单独调用（无 UI 噪声地断言几何）
  drawUI,
  drawTopBar,
  drawGameOver,
  drawToasts,
  drawTowerPanel,
  // 面板布局真源 + 宝石区块高度公式（导出给探针用：卡不许溢出区块，
  // 否则"宝石 → 强化"那条分隔线会压在最后一张卡上）
  PANEL_UI,
  gemBlockHeight,

};
