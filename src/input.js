// ============================================================================
// 输入层：触摸事件处理 + 全局路由
// ----------------------------------------------------------------------------
// 路由优先级（自上而下，先命中先返回）：
//   ① 拖放进行中 → 只更新拖拽坐标
//   ② 结算界面   → 吞掉全部触摸，只处理重新开始 / 重新挑战
//   ③ 游戏中菜单（☰）→ 只处理 返回战斗 / 放弃结束
//   ④ 底部导航栏（导航永远可点，除非被结算/菜单遮住）
//   ⑤ 战前选关界面（未开始游戏时）→ 切关卡 / 开始游戏
//   ⑥ 图签 / 天赋场景的界面交互（天赋支持上下拖动滚动）
//   ⑦ 战斗场景：塔属性面板(强化按钮) → 顶栏 ☰ → 放置槽 → 商店
//
// 坐标一律来自各模块导出的纯布局函数（shop/nav/codex/talents/levels/gamemenu），
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
const gamemenu = require('./gamemenu');
const enhance = require('./enhance');

const DRAG_THRESHOLD = 8;        // 移动阈值（像素），超过则认定为拖放
const TALENT_SCROLL_THRESHOLD = 6; // 天赋列表：垂直拖动超过此值即进入滚动
const LIST_SCROLL_THRESHOLD = 6;   // 图签格网 / 选关天梯：垂直拖动超过此值即进入滚动

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

  // 正在拖放中不应再触发新的 start。
  // 兜底：pendingDrag 却丢了 touchStartPos，说明上一次手势没走到 touchend（事件丢失），
  //       这种悬空状态会让下面这行 return 把**之后所有**点击都吃掉（表现为"界面点不动"），
  //       所以必须先清干净。正常流程里 pendingDrag 一定伴随 touchStartPos，不会误伤。
  if (game.pendingDrag && !game.touchStartPos) _resetDragState(game);
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

  // ========== ② 游戏中菜单（模态，盖住导航栏）==========
  if (game.scene === 'battle' && game.showMenu) {
    const hit = gamemenu.hitMenu(game, pos);
    game.touchStartPos = null;
    if (hit.kind === 'resume') pressButton(game, 'menu:resume');
    else if (hit.kind === 'abandon') pressButton(game, 'menu:abandon');
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

  // ========== ④ 战前选关界面（未开始游戏，天梯可上下拖动）==========
  if (game.scene === 'battle' && !game.battleStarted) {
    const hit = levels.hitReady(game, pos);
    // 触摸起点与"待定点按"都记下来：拖动 = 滚天梯，抬起不动 = 才当点击，
    // 否则"想滑动"会误触成"选了另一个关卡"。
    game.touchStartPos = { x: pos.x, y: pos.y };
    game.levelScrolling = false;
    game._readyTap = (hit.kind === 'none') ? null : hit;

    if (hit.kind === 'level') pressButton(game, 'ready:card');
    else if (hit.kind === 'locked') pressButton(game, 'ready:locked');
    else if (hit.kind === 'start') pressButton(game, 'ready:start');
    return;
  }

  // ========== ⑤ 图签场景（格网可上下拖动）==========
  if (game.scene === 'codex') {
    const hit = codex.hitCodex(game, pos);
    game.touchStartPos = { x: pos.x, y: pos.y };
    game.codexScrolling = false;

    if (hit.kind === 'card') {
      game._codexTap = { kind: 'card', type: hit.type };
      pressButton(game, 'codex:card');
    } else if (hit.kind === 'upgrade') {
      game._codexTap = { kind: 'upgrade', type: hit.type };
      pressButton(game, 'codex:up:' + hit.type);
    } else if (hit.kind === 'lineup') {
      game._codexTap = { kind: 'lineup', type: hit.type };
      pressButton(game, 'codex:lineup:' + hit.type);
    } else if (hit.kind === 'close') {
      game._codexTap = { kind: 'close' };
    } else {
      game._codexTap = null;
    }
    return;
  }

  // ========== ⑥ 天赋场景（支持上下拖动滚动）==========
  if (game.scene === 'talents') {
    game.touchStartPos = { x: pos.x, y: pos.y };
    game.talentScrolling = false;
    const hit = talents.hitTalents(game, pos);
    if (hit && hit.kind === 'learn') {
      pressButton(game, 'talent:' + hit.id);
      game._talentLearnId = hit.id;
    } else {
      game._talentLearnId = null;
    }
    return;
  }

  // ========== ⑦ 战斗场景 ==========
  // 记录起点（用于点击/拖放区分）
  game.touchStartPos = { x: pos.x, y: pos.y };

  // 强化「多选一」浮层（模态，盖住属性面板）：先于属性面板处理
  if (game.enhancePicker) {
    const hit = enhance.hitEnhancePicker(game, pos);
    game._pickerTouch = { key: (hit.kind === 'option') ? hit.key : null };
    if (hit.kind === 'option') pressButton(game, 'enhance:opt:' + hit.key);
    game.touchStartPos = null;
    return;
  }

  // 塔属性面板：先判断是否点在「强化」按钮上，其余位置一律关闭面板
  if (game.showPanel) {
    if (game.panelEnhanceBtn && isPointInRect(pos, game.panelEnhanceBtn)) {
      pressButton(game, 'tower:enhance');
      game._panelBtnTouch = true;
      game.touchStartPos = null;
      return;
    }
    game.showPanel = false;
    game.panelTowerType = null;
    game.selectedTower = null;
    game.touchStartPos = null;
    return;
  }

  // ---- 顶部状态栏：只有 ☰ 可点（关卡徽标改为纯展示，不再触发任何东西）----
  if (pos.y <= LAYOUT.topBarHeight) {
    if (isPointInRect(pos, gamemenu.getMenuButtonRect(game))) {
      pressButton(game, 'menu:open');
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
        flashButton(game, shopHit.rect, '146,197,255', 'shop');
      } else {
        // 金币不足：红色反馈
        flashButton(game, shopHit.rect, '255,68,68', 'shop');
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
  // ========== 天赋列表滚动 ==========
  if (game.scene === 'talents' && game.touchStartPos && talents.isScrollable(game) && !game.pendingDrag) {
    const pos = getTouchPos(e);
    const dy = pos.y - game.touchStartPos.y;
    if (Math.abs(dy) >= TALENT_SCROLL_THRESHOLD) {
      game.talentScrolling = true;
      const L = talents.getTalentLayout(game);
      talents.setTalentScroll(game, L.scroll - dy);
      // 连续滚动：把基准点重置到当前位置，并取消按压态（避免滚动时按钮一直亮）
      game.touchStartPos = { x: pos.x, y: pos.y };
      game._talentLearnId = null;
      releaseButton(game);
    }
    return;
  }

  // ========== 图签格网滚动 ==========
  if (game.scene === 'codex' && game.touchStartPos && codex.isCodexScrollable(game)) {
    const pos = getTouchPos(e);
    const dy = pos.y - game.touchStartPos.y;
    if (Math.abs(dy) >= LIST_SCROLL_THRESHOLD) {
      game.codexScrolling = true;
      const L = codex.getCodexLayout(game);
      codex.setCodexScroll(game, L.scroll - dy);
      game.touchStartPos = { x: pos.x, y: pos.y };
      game._codexTap = null;          // 滚过了就不算点按
      releaseButton(game);
    }
    return;
  }

  // ========== 选关天梯滚动 ==========
  if (game.scene === 'battle' && !game.battleStarted && !game.showMenu &&
      game.touchStartPos && levels.isReadyScrollable(game)) {
    const pos = getTouchPos(e);
    const dy = pos.y - game.touchStartPos.y;
    if (Math.abs(dy) >= LIST_SCROLL_THRESHOLD) {
      game.levelScrolling = true;
      const L = levels.getReadyLayout(game);
      levels.setLevelScroll(game, L.scroll - dy);
      game.touchStartPos = { x: pos.x, y: pos.y };
      game._readyTap = null;          // 滚过了就不算点按
      releaseButton(game);
    }
    return;
  }

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
      flashButton(game, btns.restart, '165,214,167', 'gameover');
      game.restart();
      releaseButton(game);
      game.touchStartPos = null;
      return;
    }
    if (btns && btns.watchContinue && isPointInRect(pos, btns.watchContinue)) {
      flashButton(game, btns.watchContinue, '146,197,255', 'gameover');
      game.watchContinue();
      releaseButton(game);
      game.touchStartPos = null;
      return;
    }
    releaseButton(game);
    return;
  }

  // ========== 游戏中菜单按钮 ==========
  if (game.scene === 'battle' && game.showMenu) {
    const bp = game.btnPress;
    const hit = gamemenu.hitMenu(game, pos);
    if (bp && bp.id === 'menu:resume' && hit.kind === 'resume') {
      game.closeMenu();
      flashButton(game, gamemenu.getMenuLayout(game).resume, '165,214,167', 'menu');
    } else if (bp && bp.id === 'menu:abandon' && hit.kind === 'abandon') {
      flashButton(game, gamemenu.getMenuLayout(game).abandon, '229,115,115', 'menu');
      game.abandonRun();
      toast(game, '已放弃本局，回到选关界面', THEME.text.dim);
    }
    releaseButton(game);
    game.touchStartPos = null;
    return;
  }

  // ========== 顶栏 ☰ 按钮 ==========
  if (game.scene === 'battle' && pos.y <= LAYOUT.topBarHeight) {
    const bp = game.btnPress;
    const rect = gamemenu.getMenuButtonRect(game);
    if (bp && bp.id === 'menu:open' && isPointInRect(pos, rect)) {
      if (game.openMenu()) flashButton(game, rect, '255,215,0', 'topbar');
    }
    releaseButton(game);
    game.touchStartPos = null;
    return;
  }

  // ========== 底部导航栏点按（必须在各场景自身的 touchend 处理之前）==========
  // 历史 bug：天赋场景的 touchend 分支里提前 return，导致后面的导航判定永远走不到，
  // 表现就是"进了天赋页就再也切不出去"。导航是全局的，所以提到这里统一处理。
  // 拖放中/待定拖放时不接管（手指可能只是从战场拖到底栏）。
  if (!game.dragging && !game.pendingDrag &&
      pos.y >= game.canvas.height - LAYOUT.navHeight) {
    const id = nav.hitNav(game, pos);
    const item = id ? nav.NAV_ITEMS.filter((x) => x.id === id)[0] : null;
    const bp = game.btnPress;
    if (item && !item.disabled && bp && bp.id === 'nav:' + id) {
      game.switchScene(item.scene);
      const L = nav.getNavLayout(game);
      const rect = L.items.filter((x) => x.id === id)[0];
      if (rect) flashButton(game, rect, '255,215,0', 'nav');
    }
    // 清掉跨场景残留的手势状态，免得切回来时"上次还在滚"串台
    game.talentScrolling = false;
    game._talentLearnId = null;
    game.codexScrolling = false;
    game._codexTap = null;
    game.levelScrolling = false;
    game._readyTap = null;
    releaseButton(game);
    game.touchStartPos = null;
    return;
  }

  // ========== 战前选关（天梯）：点卡片选关 / 开始游戏 ==========
  if (game.scene === 'battle' && !game.battleStarted) {
    const bp = game.btnPress;
    const tap = game._readyTap;
    const scrolled = game.levelScrolling;
    game._readyTap = null;
    game.levelScrolling = false;

    if (!scrolled && tap && bp && bp.id.indexOf('ready:') === 0) {
      if (tap.kind === 'start') {
        const startBtn = levels.getReadyLayout(game).startBtn;
        flashButton(game, startBtn, '165,214,167', 'ready');
        game.startBattle();
        toast(game, '开始游戏', THEME.accent.green);
      } else if (tap.kind === 'level') {
        if (game.startLevel(tap.id)) toast(game, `已选择关卡 ${tap.id}`, THEME.accent.gold);
      } else if (tap.kind === 'locked') {
        toast(game, '该关卡待扩展', THEME.text.dim);
      }
    }
    releaseButton(game);
    game.touchStartPos = null;
    return;
  }

  // ========== 图签场景：点按（滚动过就不触发）==========
  if (game.scene === 'codex') {
    const tap = game._codexTap;
    const scrolled = game.codexScrolling;
    game._codexTap = null;
    game.codexScrolling = false;

    if (!scrolled && tap) {
      if (tap.kind === 'card') {
        // 再点同一张卡 → 收起详情面板
        game.codexSelected = (game.codexSelected === tap.type) ? null : tap.type;
      } else if (tap.kind === 'upgrade') {
        codex.actCodex(game, 'upgrade', tap.type);
      } else if (tap.kind === 'lineup') {
        codex.actCodex(game, 'lineup', tap.type);
      } else if (tap.kind === 'close') {
        game.codexSelected = null;
      }
    }
    releaseButton(game);
    game.touchStartPos = null;
    return;
  }

  // ========== 天赋场景：学习按钮（滚动过就不触发）==========
  if (game.scene === 'talents') {
    const bp = game.btnPress;
    const id = game._talentLearnId;
    if (!game.talentScrolling && bp && id && bp.id === 'talent:' + id) {
      const hit = talents.hitTalents(game, pos);
      if (hit && hit.kind === 'learn' && hit.id === id) {
        talents.learn(game, id);
      }
    }
    releaseButton(game);
    game.touchStartPos = null;
    game._talentLearnId = null;
    game.talentScrolling = false;
    return;
  }

  // ========== 强化「确认」浮层：点卡片即结算，点空白即取消 ==========
  // 注意：无论这次触摸是"点了卡片"还是"点空白取消"，都在这里收尾并 return，
  // 否则会掉进下面的属性面板分支，把刚打开的面板又关掉。
  // 取消分支必须显式清 game.enhancePicker（见下方注释里的历史 bug）。
  if (game._pickerTouch) {
    const t = game._pickerTouch;
    game._pickerTouch = null;
    const bp = game.btnPress;
    let done = false;
    if (t.key && bp && bp.id === 'enhance:opt:' + t.key) {
      const hit = enhance.hitEnhancePicker(game, pos);
      if (hit.kind === 'option' && hit.key === t.key) {
        applyEnhancePick(game, t.key);
        done = true;
      }
    }
    // 点卡片以外的地方（或按住卡片但没点实）= 取消：必须真的把浮层收掉。
    // 浮层是模态，handleTouchStart 会吞掉战斗场景的所有触摸；旧实现只在强化**成功**时
    // 清 enhancePicker，于是"金币不足 / 满级"这类失败会让浮层永久残留 ——
    // 表现就是整个战斗界面点不动（连属性面板都关不掉）。这是修过的历史 bug，别退回去。
    if (!done) game.enhancePicker = null;
    releaseButton(game);
    game.touchStartPos = null;
    return;
  }

  // ========== 塔属性面板：强化按钮 → 打开"升级确认"浮层 ==========
  if (game.showPanel) {
    const bp = game.btnPress;
    if (bp && bp.id === 'tower:enhance' && game.panelEnhanceBtn &&
        isPointInRect(pos, game.panelEnhanceBtn)) {
      const tower = game.selectedTower;
      const gate = game.canEnhanceTower(tower);
      if (gate.ok) {
        // 打开浮层：确认这次的专属属性提升（见 src/enhance.js）
        game.enhancePicker = { tower: tower };
      } else {
        flashButton(game, game.panelEnhanceBtn, '255,68,68', 'panel');
        const msg = gate.reason === 'stage'
          ? `需先进阶到 ${gate.need}★（当前 ${gate.stage}★）才能强化`
          : (gate.reason === 'maxed' ? '该塔强化已满级' : '无法强化');
        toast(game, msg, THEME.accent.danger);
      }
    }
    releaseButton(game);
    game._panelBtnTouch = false;
    game.touchStartPos = null;
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
      if (card) flashButton(game, card, '255,68,68', 'shop');
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
      // 点击已有塔 → 弹出该塔属性面板（属性 / 强化 / 阶段星一目了然）
      game.showPanel = true;
      game.panelTowerType = game.draggingFromSlot.tower.type;
      game.selectedTower = game.draggingFromSlot.tower;
    } else if (game.dragType) {
      // 点击商店塔 → 弹出塔属性面板（类型预览，强化不可用）
      game.showPanel = true;
      game.panelTowerType = game.dragType;
      game.selectedTower = null;
    }
    _resetDragState(game);
    return;
  }

  // 其他情况：nothing to do
  releaseButton(game);
  game.touchStartPos = null;
}

// ==================== 强化结算 ====================

/**
 * 执行一次强化（确认该塔的专属特殊属性升一级）并给出反馈。
 * 扣金币 / 提升专属属性 / 重算 enhanceAttrs 都在 game.enhanceTower 里完成，这里只负责提示。
 */
function applyEnhancePick(game, key) {
  const tower = game.enhancePicker ? game.enhancePicker.tower : game.selectedTower;
  const res = game.enhanceTower(tower, key);
  if (res.ok) {
    game.enhancePicker = null;   // 选完就收，避免连点重复扣钱
    if (game.panelEnhanceBtn) flashButton(game, game.panelEnhanceBtn, '129,199,132', 'panel');
    const sp = res.special || {};
    const gain = sp.name ? `　${sp.name} +${sp.gain}${sp.unit || ''}（现 ${sp.text}）` : '';
    toast(game, `强化 Lv.${res.level}${gain}`, THEME.accent.green);
  } else {
    const msg = res.reason === 'gold' ? `金币不足（需要 ${res.cost}）`
      : (res.reason === 'stage' ? `需先进阶到 ${res.need}★`
        : (res.reason === 'maxed' ? '该塔强化已满级' : '无法强化'));
    toast(game, msg, THEME.accent.danger);
  }
  return res;
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
 * 触发按钮点击波纹动画（renderer 每帧绘制，duration 毫秒后自动清除）
 * @param {string} rgb - "R,G,B" 颜色分量，如 "146,197,255"
 * @param {string} [layer] - 归属层：'shop'（商店面板）/ 省略 = 'overlay'（弹层与顶/底栏）。
 *                          只有同层的绘制方会画它，避免"商店层替菜单按钮画波纹"
 *                          导致战场中间凭空出现一个框（见 theme.drawButtonFx 注释）。
 */
function flashButton(game, rect, rgb, layer) {
  if (!rect) return;
  game.buttonFx = {
    x: rect.x,
    y: rect.y,
    w: rect.w !== undefined ? rect.w : rect.size,
    h: rect.h !== undefined ? rect.h : rect.size,
    t0: Date.now(),
    duration: 450,   // 毫秒
    color: rgb || '255,255,255',
    layer: layer || 'overlay',
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
  // 以下三个是"按钮反馈"原语：输入层内部用，也导出给校验脚本直接调用
  pressButton,
  releaseButton,
  flashButton,
};
