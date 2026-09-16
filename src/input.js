// ============================================================================
// 输入层：触摸事件处理 + 全局路由
// ----------------------------------------------------------------------------
// 路由优先级（自上而下，先命中先返回）：
//   ① 拖放进行中 → 只更新拖拽坐标
//   ② 结算界面   → 吞掉全部触摸，只处理重新开始 / 重新挑战
//   ③ 关卡选择浮层（模态）
//   ④ 底部导航栏（导航永远可点，除非结算界面遮住）
//   ⑤ 图签 / 天赋场景的界面交互
//   ⑥ 战斗场景：塔属性面板 → 顶部状态栏(关卡徽标) → 放置槽 → 商店（刷新/塔卡）
//
// 坐标一律来自各模块导出的纯布局函数（shop.getShopLayout / nav.getNavLayout /
// codex.getCodexLayout / talents.getTalentLayout / levels.getLevelLayout），
// 渲染层与输入层共用同一份真源，不存在"画在一处、点在另一处"。
// ============================================================================
const { TOWER_DEFS, LAYOUT, PLAYER } = require('./config');
const theme = require('./theme');
const towerMod = require('./tower');
const shop = require('./shop');
const nav = require('./nav');
const codex = require('./codex');
const talents = require('./talents');
const levels = require('./levels');

const DRAG_THRESHOLD = 8; // 移动阈值（像素），超过则认定为拖放（放低门槛让商店槽更容易"动起来"，跟放置槽手感一致）

const { THEME } = theme;

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
 * 计算起点到当前位置的欧几里得距离
 */
function dist(p1, p2) {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** 给一条轻提示（统一入口，避免各处自己拼 game.toast） */
function toast(game, text, color) {
  game.toast = { text: text, color: color || THEME.text.secondary, t0: Date.now() };
}

function handleTouchStart(game, e) {
  const pos = getTouchPos(e);
  const canvas = game.canvas;

  // 正在拖放中不应再触发新的 start
  if (game.dragging || game.pendingDrag) return;

  // ========== ① 结算界面：吞掉全部触摸，只处理按钮按压 ==========
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

  // ========== ② 关卡选择浮层（模态）==========
  if (game.showLevels) {
    const hit = levels.hitLevelSelect(game, pos);
    game.touchStartPos = null;

    if (hit.kind === 'level') {
      pressButton(game, 'levels:play');
      const ok = game.startLevel(hit.id);
      if (ok) toast(game, `进入关卡 ${hit.id}`, THEME.accent.gold);
      return;
    }
    if (hit.kind === 'locked') {
      pressButton(game, 'levels:locked');
      toast(game, '该关卡待扩展', THEME.text.dim);
      return;
    }
    pressButton(game, 'levels:close');
    game.showLevels = false;
    return;
  }

  // ========== ③ 底部导航栏 ==========
  if (pos.y >= canvas.height - LAYOUT.navHeight) {
    const id = nav.hitNav(game, pos);
    const item = id ? nav.NAV_ITEMS.filter((x) => x.id === id)[0] : null;
    if (item && !item.disabled) {
      pressButton(game, 'nav:' + id);
    } else if (item) {
      toast(game, `「${item.label}」待扩展`, THEME.text.dim);
    }
    game.touchStartPos = null;
    return;
  }

  // ========== ④ 图签场景 ==========
  if (game.scene === 'codex') {
    const hit = codex.hitCodex(game, pos);
    game.touchStartPos = null;

    if (hit.kind === 'card') {
      // 再点同一张卡 → 收起详情面板
      game.codexSelected = (game.codexSelected === hit.type) ? null : hit.type;
      pressButton(game, 'codex:card');
    } else if (hit.kind === 'upgrade') {
      pressButton(game, 'codex:up:' + hit.type);
      codex.actCodex(game, 'upgrade', hit.type);
    } else if (hit.kind === 'lineup') {
      pressButton(game, 'codex:lineup:' + hit.type);
      codex.actCodex(game, 'lineup', hit.type);
    } else if (hit.kind === 'close') {
      game.codexSelected = null;
    }
    return;
  }

  // ========== ⑤ 天赋场景 ==========
  if (game.scene === 'talents') {
    const hit = talents.hitTalents(game, pos);
    game.touchStartPos = null;
    if (hit && hit.kind === 'learn') {
      pressButton(game, 'talent:' + hit.id);
      talents.learn(game, hit.id);
    }
    return;
  }

  // ========== ⑥ 战斗场景 ==========
  // 记录起点（用于点击/拖放区分）
  game.touchStartPos = { x: pos.x, y: pos.y };

  // 正在显示塔属性面板 → 点任意处关闭（点面板内也是关闭，与原行为一致）
  if (game.showPanel) {
    game.showPanel = false;
    game.panelTowerType = null;
    game.selectedTower = null;
    game.touchStartPos = null;
    return;
  }

  // ---- 顶部状态栏：关卡徽标 → 打开关卡选择 ----
  if (pos.y <= LAYOUT.topBarHeight) {
    if (isPointInRect(pos, levels.getLevelBadgeRect(game))) {
      pressButton(game, 'levelBadge');
      game.showLevels = true;
    }
    game.touchStartPos = null;
    return;
  }

  // ---- 1. 放置槽（已有塔）----
  for (const slot of game.slots) {
    if (slot.occupied && slot.tower &&
        pos.x >= slot.x && pos.x <= slot.x + slot.size &&
        pos.y >= slot.y && pos.y <= slot.y + slot.size) {
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

  // ---- 2. 商店（重做版）：刷新按钮 / 塔卡 ----
  const shopHit = shop.hitShop(game, pos);
  if (shopHit) {
    if (shopHit.kind === 'refresh') {
      pressButton(game, 'refresh');
      if (game.gold >= game.refreshCost) {
        game.refreshTowers();
        flashButton(game, shopHit.rect, '146,197,255');
      } else {
        // 金币不足：红色反馈
        flashButton(game, shopHit.rect, '255,68,68');
        toast(game, '金币不足，无法刷新', THEME.accent.danger);
      }
      game.touchStartPos = null;
      return;
    }

    if (shopHit.kind === 'card') {
      // 金币不足也能按住拖动（放置失败时才红色闪烁），保证"永远拖得动"
      game.pendingDrag = true;
      game.dragType = shopHit.type;
      game.dragShopIdx = shopHit.idx;
      game.draggingFromSlot = null;
      game.dragFromShop = true; // 从商店拖放
      game.dragX = pos.x;
      game.dragY = pos.y;
      pressButton(game, 'shop:' + shopHit.idx);
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

  // ========== 结算界面按钮点击 ==========
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
    releaseButton(game);
    return;
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
      // 如果是从商店槽拖放，标记商店卡为空
      if (game.dragShopIdx !== undefined && game.shopSlotState[game.dragShopIdx]) {
        game.shopSlotState[game.dragShopIdx].empty = true;
      }
    } else if (game.dragFromShop) {
      // 从商店拖放失败（最可能是金币不足）：红色闪烁提示，而不是"没反应"
      const card = shop.getShopLayout(game).cards[game.dragShopIdx];
      if (card) flashButton(game, card, '255,68,68');
      const cost = game.towerCost(game.dragType);
      if (game.gold < cost) toast(game, `金币不足（需要 ${cost}）`, THEME.accent.danger);
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
    } else if (game.dragType) {
      // 点击商店塔 → 弹出塔属性面板（类型预览）
      game.showPanel = true;
      game.panelTowerType = game.dragType;
      game.selectedTower = null;
    }
    _resetDragState(game);
    return;
  }

  // ========== 场景 C：底部导航栏点按 ==========
  if (pos.y >= game.canvas.height - LAYOUT.navHeight) {
    const id = nav.hitNav(game, pos);
    const item = id ? nav.NAV_ITEMS.filter((x) => x.id === id)[0] : null;
    const bp = game.btnPress;
    if (item && !item.disabled && bp && bp.id === 'nav:' + id) {
      game.switchScene(item.scene);
      const L = nav.getNavLayout(game);
      const rect = L.items.filter((x) => x.id === id)[0];
      if (rect) flashButton(game, rect, '255,215,0');
    }
    releaseButton(game);
    game.touchStartPos = null;
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
  if (!rect) return false;
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
  if (!rect) return;
  game.buttonFx = {
    x: rect.x,
    y: rect.y,
    w: rect.w !== undefined ? rect.w : rect.size,
    h: rect.h !== undefined ? rect.h : rect.size,
    t0: Date.now(),
    duration: 450,
    color: rgb || '255,255,255',
  };
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
    // 造价走 game.towerCost：内含"精打细算"天赋折扣，与商店卡上显示的价一致
    cost = game.towerCost(dragType);
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
    createUnitToSlot(game, dragType, slot);

    if (fromShop) {
      game.gold -= cost;
    }
    return true;
  }

  // 目标槽位已占用且无法融合 → 放置失败
  return false;
}

module.exports = {
  getTouchPos,
  handleTouchStart,
  handleTouchMove,
  handleTouchEnd,
};
