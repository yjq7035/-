// ============================================================================
// 商店板块（重做版）—— src/shop.js
// ----------------------------------------------------------------------------
// 重构前：3 个 72×72 的裸槽位 + 一个独立刷新按钮，从"全部塔"里随机抽，
//         布局在 renderer.drawUI 与 input.getShopSlots 各算一遍（两处真源）。
//
// 重构后：
//   1【面板化】整块底部面板 = 标题栏（商店徽标 + 特殊积分 + 刷新按钮）+ 3 张塔卡；
//   2【单一真源】getShopLayout() 同时供渲染层与输入层使用，坐标不可能再错位；
//   3【玩法联动】出货池来自"图签登场配置"（meta.lineup），且只出已解锁的塔——
//               图签里怎么排，商店就出什么；
//   4【信息量】每张卡显示 稀有度 / 图签等级 / 造价 / 金币是否够，拖走即空槽。
// ============================================================================

const { TOWER_DEFS, LAYOUT, CODEX, RARITY, SHOP } = require('./config');
const theme = require('./theme');
const towerMod = require('./tower');
const meta = require('./meta');

const { THEME, roundRectPath, drawTowerIcon, drawChip, drawButton, drawButtonFx, isButtonPressed, drawDashedBox, shade } = theme;

// ---------- 商店面板布局参数（唯一真源：全部来自 config.SHOP）----------
// 战场高度、绘制、命中判定三处共用它，任何尺寸调整只改 config 一处。
const SHOP_UI = SHOP;

/**
 * 计算商店面板的完整布局（纯函数，渲染/输入共用）。
 * @returns {{
 *   panel: {x,y,w,h},
 *   headerY: number,
 *   brand: {x,y,w,h},
 *   pointsChip: {x,y,w,h},
 *   refreshBtn: {x,y,w,h},
 *   cards: Array<{type,x,y,w,h,idx,empty}>,
 *   navTop: number
 * }}
 */
function getShopLayout(game) {
  const W = game.canvas.width;
  const H = game.canvas.height;

  const navTop = H - LAYOUT.navHeight;
  const panelH = SHOP_UI.padTop + SHOP_UI.headerH + SHOP_UI.cardH + SHOP_UI.padBottom;
  const panelY = navTop - panelH;

  const headerY = panelY + SHOP_UI.padTop;
  const headerCY = headerY + SHOP_UI.headerH / 2;

  // 标题栏：左 = 商店徽标，右 = 刷新按钮，刷新左边 = 特殊积分
  const brand = { x: SHOP_UI.padX, y: headerCY - 10, w: 54, h: 20 };
  const refreshBtn = {
    x: W - SHOP_UI.padX - SHOP_UI.refreshW,
    y: headerCY - SHOP_UI.refreshH / 2,
    w: SHOP_UI.refreshW,
    h: SHOP_UI.refreshH,
  };
  const pointsChip = {
    x: refreshBtn.x - 8 - SHOP_UI.pointsChipW,
    y: headerCY - SHOP_UI.pointsChipH / 2,
    w: SHOP_UI.pointsChipW,
    h: SHOP_UI.pointsChipH,
  };

  // 卡片行：N 张卡居中，宽度自适应（窄屏收缩、宽屏封顶）
  const contentW = W - SHOP_UI.padX * 2;
  const n = SHOP_UI.cardCount;
  let cardW = Math.floor((contentW - (n - 1) * SHOP_UI.gap) / n);
  cardW = Math.max(64, Math.min(SHOP_UI.cardMaxW, cardW));
  const totalW = n * cardW + (n - 1) * SHOP_UI.gap;
  const cardX0 = (W - totalW) / 2;
  const cardY = headerY + SHOP_UI.headerH + 2;

  const offers = game.shopOffers || [];
  const cards = [];
  for (let i = 0; i < n; i++) {
    const state = (game.shopSlotState && game.shopSlotState[i]) || null;
    cards.push({
      idx: i,
      type: offers[i] || null,
      empty: !state || state.empty,
      x: cardX0 + i * (cardW + SHOP_UI.gap),
      y: cardY,
      w: cardW,
      h: SHOP_UI.cardH,
    });
  }

  return {
    panel: { x: 0, y: panelY, w: W, h: panelH },
    headerY,
    brand,
    pointsChip,
    refreshBtn,
    cards,
    navTop,
  };
}

/** 命中检测：返回 { kind: 'card'|'refresh', idx?, type?, rect } 或 null */
function hitShop(game, pos) {
  const L = getShopLayout(game);

  if (theme.pointInRect(pos, L.refreshBtn)) return { kind: 'refresh', rect: L.refreshBtn };

  for (const c of L.cards) {
    if (c.empty) continue;
    if (theme.pointInRect(pos, c)) return { kind: 'card', idx: c.idx, type: c.type, rect: c };
  }
  return null;
}

/** 该塔当前的实际造价（含"精打细算"天赋折扣） */
function towerCost(game, type) {
  if (game && typeof game.towerCost === 'function') return game.towerCost(type);
  return towerMod.getTowerCost(type);
}

/** 刷新按钮上显示的费用 */
function refreshCost(game) {
  if (game && typeof game.getRefreshCost === 'function') return game.getRefreshCost();
  return game.refreshCost;
}

// ---------- 绘制 ----------

/** 小型刷新图标（圆环箭头），避免依赖 renderer 造成循环引用 */
function drawRefreshGlyph(ctx, cx, cy, r, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.8;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(cx, cy, r, -Math.PI / 2, Math.PI);
  ctx.stroke();
  const ax = cx - r, ay = cy;
  ctx.beginPath();
  ctx.moveTo(ax, ay - 4.5);
  ctx.lineTo(ax - 3.6, ay + 1);
  ctx.lineTo(ax + 3.6, ay + 1);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * 绘制商店面板（含标题栏 / 特殊积分 / 刷新按钮 / 塔卡）
 */
function drawShop(game) {
  const ctx = game.ctx;
  const L = getShopLayout(game);

  // ---- 面板底 + 顶部发丝描边 ----
  ctx.save();
  const bg = ctx.createLinearGradient(0, L.panel.y, 0, L.panel.y + L.panel.h);
  bg.addColorStop(0, 'rgba(12, 12, 24, 0.92)');
  bg.addColorStop(1, 'rgba(20, 20, 38, 0.97)');
  ctx.fillStyle = bg;
  ctx.fillRect(L.panel.x, L.panel.y, L.panel.w, L.panel.h);

  ctx.strokeStyle = THEME.border.normal;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, L.panel.y + 0.5);
  ctx.lineTo(L.panel.w, L.panel.y + 0.5);
  ctx.stroke();
  ctx.restore();

  // ---- 标题栏 ----
  drawChip(ctx, {
    x: L.brand.x, y: L.brand.y, w: L.brand.w, h: L.brand.h,
    text: '商店', icon: '🛒', color: THEME.text.primary, fontSize: 11,
    bg: THEME.track.soft, stroke: THEME.border.normal,
  });

  // 特殊积分（图签货币，顺手在商店也能看到余额）
  const m = meta.get();
  drawChip(ctx, {
    x: L.pointsChip.x, y: L.pointsChip.y, w: L.pointsChip.w, h: L.pointsChip.h,
    text: `${m.points}`, icon: '✨', color: THEME.accent.violet, fontSize: 11,
    bg: 'rgba(179, 136, 255, 0.12)', stroke: 'rgba(179, 136, 255, 0.35)',
  });

  // 刷新按钮
  const rc = refreshCost(game);
  const canRefresh = game.gold >= rc;
  const refreshRect = L.refreshBtn;
  drawButton(ctx, {
    x: refreshRect.x, y: refreshRect.y, w: refreshRect.w, h: refreshRect.h,
    top: canRefresh ? 'rgba(146, 197, 255, 0.32)' : THEME.track.soft,
    bottom: canRefresh ? 'rgba(100, 181, 246, 0.20)' : THEME.track.faint,
    stroke: canRefresh ? 'rgba(146, 197, 255, 0.62)' : THEME.border.subtle,
    label: '', labelColor: THEME.text.primary, radius: refreshRect.h / 2,
    pressed: isButtonPressed(game, 'refresh'),
  });
  drawRefreshGlyph(ctx, refreshRect.x + 15, refreshRect.y + refreshRect.h / 2, 6,
    canRefresh ? THEME.text.primary : THEME.text.off);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 11px Arial';
  ctx.fillStyle = canRefresh ? THEME.accent.gold : THEME.accent.danger;
  ctx.fillText(`${rc}`, refreshRect.x + 26, refreshRect.y + refreshRect.h / 2 + 0.5);

  // ---- 塔卡 ----
  for (const card of L.cards) {
    drawOfferCard(game, card);
  }

  drawButtonFx(game, ctx);
}

/** 单张货架卡 */
function drawOfferCard(game, card) {
  const ctx = game.ctx;
  const { x, y, w, h } = card;

  // 空槽（塔已被拖走）
  if (card.empty || !card.type) {
    ctx.save();
    ctx.fillStyle = THEME.track.faint;
    roundRectPath(ctx, x, y, w, h, SHOP_UI.radius);
    ctx.fill();
    ctx.restore();
    drawDashedBox(ctx, x, y, w, h, SHOP_UI.radius, THEME.border.subtle);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '11px Arial';
    ctx.fillStyle = THEME.text.off;
    ctx.fillText('已取走', x + w / 2, y + h / 2);
    return;
  }

  const def = TOWER_DEFS[card.type];
  if (!def) return;

  const rarity = RARITY[def.rarity] || RARITY[1];
  const cost = towerCost(game, card.type);
  const canAfford = game.gold >= cost;
  const level = meta.codexLevel(card.type);
  const isSelected = game.dragFromShop && game.dragType === card.type &&
                     (game.dragging || game.pendingDrag);
  const isPressed = isButtonPressed(game, 'shop:' + card.idx);
  const highlighted = isSelected || isPressed;

  ctx.save();

  // 卡底：按稀有度着色；选中/按住时整体提亮 + 金描边
  const grad = ctx.createLinearGradient(x, y, x, y + h);
  if (highlighted) {
    grad.addColorStop(0, 'rgba(255, 215, 155, 0.42)');
    grad.addColorStop(1, 'rgba(255, 215, 0, 0.24)');
  } else {
    grad.addColorStop(0, shade(rarity.color, 0.1, 0.16));
    grad.addColorStop(1, shade(rarity.color, -0.2, 0.06));
  }
  ctx.fillStyle = grad;
  ctx.strokeStyle = highlighted ? 'rgba(255, 215, 0, 0.85)' : shade(rarity.color, -0.1, 0.5);
  ctx.lineWidth = highlighted ? 2 : 1.2;
  roundRectPath(ctx, x, y, w, h, SHOP_UI.radius);
  ctx.fill();
  ctx.stroke();

  // 顶部：图签等级徽标（左）+ 稀有度（右）
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = 'bold 9px Arial';
  ctx.fillStyle = THEME.accent.violet;
  ctx.fillText(`Lv.${level}`, x + 7, y + 12);

  ctx.textAlign = 'right';
  ctx.font = '9px Arial';
  ctx.fillStyle = canAfford ? rarity.color : THEME.text.off;
  ctx.fillText(rarity.name, x + w - 7, y + 12);

  // 图形塔图标（金币不足时画灰，一眼看出买不起）
  drawTowerIcon(ctx, x + w / 2, y + 34, canAfford ? def.color : THEME.text.off, card.type, 0.92);

  // 名称
  ctx.textAlign = 'center';
  ctx.font = '10px Arial';
  ctx.fillStyle = canAfford ? THEME.text.primary : THEME.text.dim;
  ctx.fillText(theme.ellipsize(ctx, def.name, w - 12), x + w / 2, y + 53);

  // 造价
  ctx.font = 'bold 12px Arial';
  ctx.fillStyle = canAfford ? THEME.accent.gold : THEME.accent.danger;
  ctx.fillText(`💰${cost}`, x + w / 2, y + 66);

  ctx.restore();
}

module.exports = {
  SHOP_UI,
  getShopLayout,
  hitShop,
  drawShop,
  towerCost,
  refreshCost,
};
