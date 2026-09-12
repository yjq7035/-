// 输入层：触摸事件处理（从原 Game 的 handleTouch* / getTouchPos 抽离）
// 所有函数接收 game 实例，通过 game.canvas / game.ctx / game.* 访问状态。
const { SHOP_TOWERS, TOWER_DEFS, LAYOUT } = require('./config');
const towerMod = require('./tower');

/**
 * 取触摸坐标：
 * - 微信小游戏 Touch 对象是 clientX/clientY（没有 x/y）
 * - touchend 时 e.touches 已清空，需从 changedTouches 取当前触点
 */
function getTouchPos(e) {
  const t = (e.touches && e.touches[0]) ||
            (e.changedTouches && e.changedTouches[0]);
  if (!t) return { x: 0, y: 0 };
  return {
    x: (t.clientX !== undefined) ? t.clientX : t.x,
    y: (t.clientY !== undefined) ? t.clientY : t.y,
  };
}

function handleTouchStart(game, e) {
  const pos = getTouchPos(e);
  const canvas = game.canvas;
  const height = canvas.height;

  // 检查是否正在拖放中
  if (game.dragging) return;

  // 商店塔列表（与绘制一致）
  const towerTypes = SHOP_TOWERS.map((t) => ({ type: t, ...TOWER_DEFS[t] }));
  const slotWidth = LAYOUT.shopSlotWidth;
  const gap = LAYOUT.shopGap;
  const totalWidth = towerTypes.length * slotWidth + (towerTypes.length - 1) * gap;
  const startX = (canvas.width - totalWidth) / 2;
  const btnX = startX + towerTypes.length * (slotWidth + gap) - 5;
  const btnY = height - LAYOUT.refreshBtnClick.yOffset;
  const btnW = LAYOUT.refreshBtnClick.w;
  const btnH = LAYOUT.refreshBtnClick.h;

  // 检查是否点击了刷新按钮
  if (pos.x >= btnX && pos.x <= btnX + btnW && pos.y >= btnY && pos.y <= btnY + btnH) {
    game.refreshTowers();
    return;
  }

  // 检查是否点击了商城的塔
  for (let i = 0; i < towerTypes.length; i++) {
    // 跳过已被拖走的槽位
    if (game.shopSlotState[i] && game.shopSlotState[i].empty) continue;
    
    const t = towerTypes[i];
    const x = startX + i * (slotWidth + gap);

    if (pos.x >= x && pos.x <= x + slotWidth && pos.y >= btnY && pos.y <= btnY + slotWidth) {
      // 只有金币足够才能拖放
      if (game.gold >= t.cost) {
        game.dragging = true;
        game.dragType = t.type;
        game.dragX = pos.x;
        game.dragY = pos.y;
      }
      return;
    }
  }
}

function handleTouchMove(game, e) {
  if (!game.dragging) return;
  e.preventDefault();
  const pos = getTouchPos(e);
  game.dragX = pos.x;
  game.dragY = pos.y;
}

function handleTouchEnd(game, e) {
  if (!game.dragging) return;

  const pos = getTouchPos(e);

  // 检查是否释放到了空槽位
  for (const slot of game.slots) {
    if (!slot.occupied &&
        pos.x >= slot.x && pos.x <= slot.x + slot.size &&
        pos.y >= slot.y && pos.y <= slot.y + slot.size) {

      // 检查金币是否足够
      const cost = towerMod.getTowerCost(game.dragType);
      if (game.gold >= cost) {
        const tower = towerMod.createTower(game.dragType, slot.x + slot.size / 2, slot.y + slot.size / 2);
        slot.occupied = true;
        slot.tower = tower;
        game.towers.push(tower);
        game.gold -= cost;
      }

      game.dragging = false;
      game.dragType = null;
      return;
    }
  }

  // 没有放置到槽位，取消拖拽，但标记商店槽为空
  const dragIndex = SHOP_TOWERS.indexOf(game.dragType);
  if (dragIndex !== -1) {
    game.shopSlotState[dragIndex].empty = true;
  }
  game.dragging = false;
  game.dragType = null;
}

module.exports = {
  getTouchPos,
  handleTouchStart,
  handleTouchMove,
  handleTouchEnd,
};
