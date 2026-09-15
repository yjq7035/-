// 输入层：触摸事件处理
// 点击 vs 拖放识别：touchstart 记录起点，touchmove 超过阈值(~10px)认定为拖放。
// - 点击商店槽 → 弹出塔属性面板
// - 点击已有塔槽 → 弹出该塔属性面板
// - 拖放商店塔到空槽 → 放置 / 融合进阶
const { TOWER_DEFS, LAYOUT, PLAYER } = require('./config');
const towerMod = require('./tower');

const DRAG_THRESHOLD = 8; // 移动阈值（像素），超过则认定为拖放（放低门槛让商店槽更容易"动起来"，跟放置槽手感一致）

/**
 * 取触摸坐标
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

/**
 * 根据 refreshTowerTypes 计算商店槽矩形区域
 * 返回 { slots: [{type, x, y, w, h, idx}], refreshBtn: {x, y, w, h} }
 */
function getShopLayout(canvas) {
  const height = canvas.height;
  const towerTypes = canvas._game_refresh || []; // 由外部 game.refreshTowerTypes 决定，
                                                  // 实际调用者传入 game，见下方 getShopSlots
  return { towerTypes, height };
}

/**
 * 计算每个商店槽的位置和尺寸，返回数组
 */
function getShopSlots(game) {
  const canvas = game.canvas;
  const towerTypes = game.refreshTowerTypes;
  const slotWidth = LAYOUT.shopSlotWidth;
  const slotHeight = LAYOUT.shopSlotHeight;
  const gap = LAYOUT.shopGap;
  const totalWidth = towerTypes.length * slotWidth + (towerTypes.length - 1) * gap;
  const startX = (canvas.width - totalWidth) / 2;
  const shopY = canvas.height - LAYOUT.shopBarYOffset;

  const slots = [];
  for (let i = 0; i < towerTypes.length; i++) {
    slots.push({
      type: towerTypes[i],
      idx: i,
      x: startX + i * (slotWidth + gap),
      y: shopY,
      w: slotWidth,
      h: slotHeight,
    });
  }

  const btnX = startX + towerTypes.length * (slotWidth + gap) - 5;
  const btnY = canvas.height - LAYOUT.refreshBtnClick.yOffset;

  return {
    slots,
    refreshBtn: {
      x: btnX,
      y: btnY,
      w: LAYOUT.refreshBtnClick.w,
      h: LAYOUT.refreshBtnClick.h,
    },
  };
}

/**
 * 计算起点到当前位置的欧几里得距离
 */
function dist(p1, p2) {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function handleTouchStart(game, e) {
  const pos = getTouchPos(e);
  const canvas = game.canvas;

  // 正在拖放中不应再触发新的 start
  if (game.dragging || game.pendingDrag) return;

  // ========== 结算界面：吞掉全部触摸，只处理按钮按压 ==========
  if (game.gameOver) {
    const btns = game.gameOverButtons;
    if (btns && isPointInRect(pos, btns.restart)) {
      pressButton(game, 'restart');
      return;
    }
    if (btns && btns.watchContinue && isPointInRect(pos, btns.watchContinue)) {
      pressButton(game, 'watchContinue');
      return;
    }
    game.touchStartPos = null;
    return;
  }

  // 记录起点（用于点击/拖放区分）
  game.touchStartPos = { x: pos.x, y: pos.y };

  // 如果正在显示属性面板，点击面板内外都会关闭
  if (game.showPanel) {
    game.showPanel = false;
    game.panelTowerType = null;
    game.selectedTower = null;
    game.touchStartPos = null;
    return;
  }

  // ========== 1. 放置槽（已有塔）==========
  for (const slot of game.slots) {
    if (slot.occupied && slot.tower &&
        pos.x >= slot.x && pos.x <= slot.x + slot.size &&
        pos.y >= slot.y && pos.y <= slot.y + slot.size) {
      // 金币足够才能拖放/选中
      const t = TOWER_DEFS[slot.tower.type];
      // 金币不足 → 也弹出属性面板让玩家看（只读）（已注释，点击不再弹出）
      // if (game.gold < t.cost) {
      //   game.showPanel = true;
      //   game.panelTowerType = slot.tower.type;
      //   game.selectedTower = slot.tower;
      //   game.touchStartPos = null;
      //   return;
      // }

      // 设置 pendingDrag：此时还不确定用户是想点击还是拖放
      game.pendingDrag = true;
      game.dragType = slot.tower.type;
      game.draggingFromSlot = slot;
      game.dragShopIdx = undefined;
      game.dragFromShop = false; // 从放置槽拖放，不是商店
      game.dragX = pos.x;
      game.dragY = pos.y;
      return;
    }
  }

  // ========== 2. 刷新按钮 ==========
  const shopLayout = getShopSlots(game);
  const { refreshBtn, slots: shopSlots } = shopLayout;

  if (pos.x >= refreshBtn.x && pos.x <= refreshBtn.x + refreshBtn.w &&
      pos.y >= refreshBtn.y && pos.y <= refreshBtn.y + refreshBtn.h) {
    pressButton(game, 'refresh');
    if (game.gold >= game.refreshCost) {
      game.refreshTowers();
      flashButton(game, refreshBtn, '146,197,255');
    } else {
      // 金币不足：红色反馈
      flashButton(game, refreshBtn, '255,68,68');
    }
    game.touchStartPos = null;
    return;
  }

  // ========== 3. 商店塔槽 ==========
  for (const s of shopSlots) {
    // 跳过已空的槽
    if (game.shopSlotState[s.idx] && game.shopSlotState[s.idx].empty) continue;

    if (pos.x >= s.x && pos.x <= s.x + s.w &&
        pos.y >= s.y && pos.y <= s.y + s.h) {
      // 金币足够才能"购买放置"，但允许拖拽预览（金币不足时放置会被 tryPlaceTower 拦下并红色闪烁，
      // 与放置槽一致：按下→拖拽 永远能"动起来"，不会因为穷而点不动/拖不动）

      // 设置 pendingDrag：此时还不确定用户是想点击还是拖放
      game.pendingDrag = true;
      game.dragType = s.type;
      game.dragShopIdx = s.idx;
      game.draggingFromSlot = null;
      game.dragFromShop = true; // 从商店拖放
      game.dragX = pos.x;
      game.dragY = pos.y;
      // 按压态反馈：按住商店槽期间渲染"被按下"的样式（与刷新按钮一致，弥补放置槽"按下即亮"的顺滑感）
      pressButton(game, 'shop:' + s.idx);
      return;
    }
  }

  // 其他区域点击：清除选中
  game.selectedTowerType = null;
  game.touchStartPos = null;
}

function handleTouchMove(game, e) {
  // 已经是拖放状态 → 更新拖拽坐标
  if (game.dragging) {
    const pos = getTouchPos(e);
    game.dragX = pos.x;
    game.dragY = pos.y;
    return;
  }

  // pendingDrag 状态下，检查是否超过阈值 → 升级为真正的拖放
  if (game.pendingDrag && game.touchStartPos) {
    const pos = getTouchPos(e);
    if (dist(game.touchStartPos, pos) >= DRAG_THRESHOLD) {
      game.dragging = true;
      game.dragX = pos.x;
      game.dragY = pos.y;
    }
  }
}

function handleTouchEnd(game, e) {
  const pos = getTouchPos(e);

  // ========== 游戏结束界面按钮点击 ==========\
  if (game.gameOver && !game.watchingVideo) {
    const btns = game.gameOverButtons;
    if (btns && isPointInRect(pos, btns.restart)) {
      flashButton(game, btns.restart, '165,214,167');
      game.restart();
      releaseButton(game);
      game.touchStartPos = null;
      return;
    }
    if (btns && btns.watchContinue && isPointInRect(pos, btns.watchContinue)) {
      flashButton(game, btns.watchContinue, '146,197,255');
      game.watchContinue();
      releaseButton(game);
      game.touchStartPos = null;
      return;
    }
  }

  // ========== 场景 A：真正的拖放结束 ==========
  if (game.dragging) {
    const placed = tryPlaceTowerAtPos(game, game.dragType, pos);

    if (placed) {
      // 放置成功：清除原槽位。
      // 移动场景下（从槽拖到另一空槽）原槽位的塔已在 tryPlaceTower 中移到目标槽，
      // fromSlot.tower 此刻为 null，removeSlotTower 会自然跳过删除。
      const fromSlot = getFromSlot(game);
      if (fromSlot) {
        removeSlotTower(game, fromSlot);
      }
      // 如果是从商店槽拖放，标记商店槽为空
      if (game.dragShopIdx !== undefined) {
        game.shopSlotState[game.dragShopIdx].empty = true;
      }
    } else if (game.dragFromShop) {
      // 从商店拖放失败（最可能是金币不足）：红色闪烁提示，而不是"没反应"
      flashButton(game, getShopSlots(game).slots[game.dragShopIdx], '255,68,68');
    }
    // 放置失败（移动场景）：不做任何动作，保留原槽位

    _resetDragState(game);
    return;
  }

  // ========== 场景 B：pendingDrag 没移动 → 视为点击 ==========
  if (game.pendingDrag) {
    // 检查是否点击的是放置槽中的塔
    if (game.draggingFromSlot && game.draggingFromSlot.occupied && game.draggingFromSlot.tower) {
      // 点击已有塔 → 弹出该塔属性面板（阶段星星/攻击增幅一目了然）
      game.showPanel = true;
      game.panelTowerType = game.draggingFromSlot.tower.type;
      game.selectedTower = game.draggingFromSlot.tower;
      game.touchStartPos = null;
    } else {
      // 点击商店塔 → 弹出塔属性面板（类型预览）
      game.showPanel = true;
      game.panelTowerType = game.dragType;
      game.selectedTower = null;
      game.touchStartPos = null;
    }
    _resetDragState(game);
    return;
  }

  // 其他情况：nothing to do
  releaseButton(game);
  game.touchStartPos = null;
}

/**
 * 检查坐标是否在矩形内
 */
function isPointInRect(pos, rect) {
  return pos.x >= rect.x && pos.x <= rect.x + rect.w &&
         pos.y >= rect.y && pos.y <= rect.y + rect.h;
}

// ==================== 按钮按压 / 点击波纹 ====================

/**
 * 记录按钮按压态（手指按下期间 renderer 绘制按压样式）
 */
function pressButton(game, id) {
  game.btnPress = { id, t0: Date.now() };
}

/**
 * 清除按钮按压态
 */
function releaseButton(game) {
  game.btnPress = null;
}

/**
 * 触发按钮点击波纹动画（renderer 每帧绘制，450ms 后自动清除）
 * @param {string} rgb - "R,G,B" 颜色分量，如 "146,197,255"
 */
function flashButton(game, rect, rgb) {
  game.buttonFx = {
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: rect.h,
    t0: Date.now(),
    duration: 450,
    color: rgb || '255,255,255',
  };
}

/**
 * 检查坐标是否在商店刷新按钮内
 */
function isPointInRefreshBtn(game, pos) {
  const shopLayout = getShopSlots(game);
  const btn = shopLayout.refreshBtn;
  return pos.x >= btn.x && pos.x <= btn.x + btn.w &&
         pos.y >= btn.y && pos.y <= btn.y + btn.h;
}

/**
 * 清理拖放相关的所有临时状态
 */
function _resetDragState(game) {
  game.dragging = false;
  game.pendingDrag = false;
  game.dragType = null;
  game.dragShopIdx = undefined;
  game.draggingFromSlot = null;
  game.dragFromShop = false;
  game.touchStartPos = null;
  releaseButton(game); // 拖放结束，清除商店槽按压态
}

// ==================== 拖放底层函数 ====================

/**
 * 获取拖放的图形塔
 */
function getDragTower(game) {
  // 从放置槽拖放：返回真实的塔对象（含 owner/level/stage/uniqueId）
  if (game.draggingFromSlot && game.draggingFromSlot.tower) {
    return game.draggingFromSlot.tower;
  }
  // 从商店拖放：构造带正确 owner 的塔（新塔 = 0阶段0级，只能与同阶段的塔合成）
  if (game.dragType) {
    return {
      type: game.dragType,
      level: 0,
      stage: 0,
      uniqueId: null,
      owner: PLAYER.OWN, // 必须与已有塔相同的 owner，否则 canMergeUpgrade 判断失败
    };
  }
  return null;
}

/**
 * 获取拖放的槽位（目标槽位）
 */
function getTargetSlot(game, pos) {
  for (const slot of game.slots) {
    if (pos.x >= slot.x && pos.x <= slot.x + slot.size &&
        pos.y >= slot.y && pos.y <= slot.y + slot.size) {
      return slot;
    }
  }
  return null;
}

/**
 * 获取拖放原槽位
 */
function getFromSlot(game) {
  return game.draggingFromSlot;
}

/**
 * 获取槽位图形塔
 */
function getSlotTower(slot) {
  return slot && slot.occupied ? slot.tower : null;
}

/**
 * 删除槽位图形塔
 */
function removeSlotTower(game, slot) {
  if (slot && slot.tower) {
    game.towers = game.towers.filter(t => t !== slot.tower);
    const units = require('./units');
    units.removeUnit(slot.tower.uniqueId);
    slot.occupied = false;
    slot.tower = null;
  }
}

/**
 * 设置槽位图形塔
 */
function setSlotTower(slot, tower) {
  slot.occupied = true;
  slot.tower = tower;
}

/**
 * 移动图形塔到指定槽位
 */
function moveTowerToSlot(game, tower, slot) {
  setSlotTower(slot, tower);
  if (!game.towers.includes(tower)) {
    game.towers.push(tower);
  }
}

/**
 * 检查槽位是否为商店
 */
function isShopSlot(slot, game) {
  if (!slot || slot.idx === undefined) return false;
  return game.shopSlotState[slot.idx] !== undefined;
}

/**
 * 检查槽位是否为放置
 */
function isPlacementSlot(slot) {
  return slot && slot.size !== undefined;
}

/**
 * 检查槽位是否为空置
 */
function isEmptySlot(slot) {
  return slot && !slot.occupied;
}

/**
 * 创建单位到槽位
 */
function createUnitToSlot(game, type, slot) {
  const tower = towerMod.createTower(type, slot.x + slot.size / 2, slot.y + slot.size / 2);
  setSlotTower(slot, tower);
  game.towers.push(tower);
  return tower;
}

/**
 * 尝试在指定坐标放置塔（给 handleTouchEnd 用：根据 pos 找槽）
 */
function tryPlaceTowerAtPos(game, dragType, pos) {
  const targetSlot = getTargetSlot(game, pos);
  if (!targetSlot) return false;
  
  // 不能放回原槽位
  if (game.draggingFromSlot && targetSlot === game.draggingFromSlot) return false;
  
  // 目标槽位是否为空由 tryPlaceTower 决定：
  // 已占用 → 尝试合成升级/融合进阶；为空 → 创建新塔
  return tryPlaceTower(game, dragType, targetSlot, game.dragShopIdx !== undefined);
}

/**
 * 在指定空槽位放置塔：
 *  - 优先尝试合成升级（同类型 + 同阶段，只有目标槽位有同类型同阶的塔才触发）
 *  - 否则尝试融合进阶（同类型 + 已有塔 >=1级 <6级，只有目标槽位有同类型的塔才触发）
 *  - 否则创建新塔并占用槽位
 *  fromShop: 是否从商店拖放（只有从商店拖放才消耗金币）
 * 返回是否成功放置
 */
function tryPlaceTower(game, dragType, slot, fromShop) {
  let cost = 0;
  
  // 只有从商店拖放时才检查并消耗金币
  if (fromShop) {
    cost = towerMod.getTowerCost(dragType);
    if (game.gold < cost) return false;
  }

  // 获取目标槽位中的图形塔
  const slotTower = getSlotTower(slot);

  // 1. 检查合成升级（只有槽位本身有同类型同阶的塔才触发融合）
  if (slotTower) {
    const dragTower = getDragTower(game);
    if (dragTower && towerMod.canMergeUpgrade(slotTower, dragTower)) {
      // 合成成功：目标槽塔阶段+1，攻击增幅+100%
      slotTower.stage += 1;
      slotTower.attackPowerBoost = towerMod.getAttackPowerBoost(slotTower.stage);
      // 如果从商店拖放，消耗金币
      if (fromShop) {
        game.gold -= cost;
      }
      return true;
    }

    // 2. 检查融合进阶（只有槽位本身有同类型的塔才触发）
    const dragTowerForLevel = getDragTower(game);
    if (dragTowerForLevel && dragTowerForLevel.level >= 1 && dragTowerForLevel.level <= 5 &&
        slotTower.type === dragTowerForLevel.type) {
      slotTower.level += 1;
      if (fromShop) {
        game.gold -= cost;
      }
      return true;
    }
  }

  // 3. 从放置槽拖放到空槽 → 直接移动塔（保留升级数据）
  if (!slot.occupied && !fromShop) {
    const dragTower = getDragTower(game);
    const fromSlot = getFromSlot(game);
    if (dragTower && fromSlot && fromSlot !== slot) {
      // 把原槽位的真实塔对象移动到新槽位
      fromSlot.occupied = false;
      fromSlot.tower = null;
      // 同步更新图形塔坐标到新槽中心，否则塔图形/星标/增幅文本仍停留在原槽位
      dragTower.x = slot.x + slot.size / 2;
      dragTower.y = slot.y + slot.size / 2;
      setSlotTower(slot, dragTower); // 填充目标槽
      if (!game.towers.includes(dragTower)) {
        game.towers.push(dragTower);
      }
      return true;
    }
  }

  // 4. 创建新塔到该空槽（仅从商店拖放时走此分支）
  if (!slot.occupied) {
    const tower = createUnitToSlot(game, dragType, slot);
  
    if (fromShop) {
      game.gold -= cost;
    }
    return true;
  }
  
  // 目标槽位已占用且无法融合 → 放置失败
  return false;
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
