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

  // 如果正在显示面板，检查是否点击面板外
  if (game.showPanel) {
    const panelW = 280;
    const panelH = 320;
    const panelX = (canvas.width - panelW) / 2;
    const panelY = (canvas.height - panelH) / 2;
    
    // 点击面板外关闭面板
    if (!isPointInPanel(pos, panelX, panelY, panelW, panelH)) {
      game.showPanel = false;
      game.panelTowerType = null;
      game.selectedTower = null;
    }
    return;
  }

  // 先检查是否点击了放置槽（已有塔）- 优先处理
  for (const slot of game.slots) {
    if (slot.occupied && slot.tower) {
      if (pos.x >= slot.x && pos.x <= slot.x + slot.size &&
          pos.y >= slot.y && pos.y <= slot.y + slot.size) {
        game.showPanel = true;
        game.panelTowerType = slot.tower.type;
        game.selectedTower = slot.tower;
        return;
      }
    }
  }

  // 商店塔列表（与渲染一致，从刷新后的塔池中获取）
  const towerTypes = game.refreshTowerTypes.map((t) => ({ type: t, ...TOWER_DEFS[t] }));
  const slotWidth = LAYOUT.shopSlotWidth;
  const gap = LAYOUT.shopGap;
  const totalWidth = towerTypes.length * slotWidth + (towerTypes.length - 1) * gap;
  const startX = (canvas.width - totalWidth) / 2;
  const shopY = height - LAYOUT.shopBarYOffset;
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

    if (pos.x >= x && pos.x <= x + slotWidth && pos.y >= shopY && pos.y <= shopY + slotWidth) {
      // 启动拖放
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
  const dragType = game.dragType;
  let placed = false;

  // 检查是否释放到了空槽位
  for (const slot of game.slots) {
    if (!slot.occupied &&
        pos.x >= slot.x && pos.x <= slot.x + slot.size &&
        pos.y >= slot.y && pos.y <= slot.y + slot.size) {

      // 检查金币是否足够
      const cost = towerMod.getTowerCost(dragType);
      if (game.gold >= cost) {
        // 检查是否有相同类型且可升级的塔
        let upgraded = false;
        for (const existingTower of game.towers) {
          if (towerMod.canUpgradeTower(existingTower, { type: dragType, level: 0 })) {
            // 合并进阶（同类型+已有塔>=1级且<6级）
            existingTower.level += 1;
            game.gold -= cost;
            upgraded = true;
            break;
          }
        }
        
        if (!upgraded) {
          // 创建新塔
          const tower = towerMod.createTower(dragType, slot.x + slot.size / 2, slot.y + slot.size / 2);
          slot.occupied = true;
          slot.tower = tower;
          game.towers.push(tower);
          game.gold -= cost;
          placed = true;
        }
      }
      break;
    }
  }

  // 只有成功放置才标记商店槽为空
  if (placed) {
    // 在 refreshTowerTypes 中找到对应类型并标记为空
    const dragIndex = game.refreshTowerTypes.indexOf(dragType);
    if (dragIndex !== -1) {
      game.shopSlotState[dragIndex].empty = true;
    }
  }
  
  game.dragging = false;
  game.dragType = null;
}

/**
 * 检查坐标是否在面板内
 */
function isPointInPanel(pos, panelX, panelY, panelW, panelH) {
  return pos.x >= panelX && pos.x <= panelX + panelW &&
         pos.y >= panelY && pos.y <= panelY + panelH;
}

module.exports = {
  getTouchPos,
  handleTouchStart,
  handleTouchMove,
  handleTouchEnd,
};
