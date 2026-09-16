// 游戏核心：Game 类，协调各功能模块。
// 原单文件 game.js 中的 Game 类拆出数据/几何/敌人/波次/塔/渲染/输入后，
// 这里只保留：状态、路径与槽位计算、波次调度、主循环、事件绑定。
const config = require('./config');
const theme = require('./theme');
const enemyMod = require('./enemy');
const waveMod = require('./wave');
const renderer = require('./renderer');
const input = require('./input');
const towerMod = require('./tower');
const units = require('./units');
const EventBus = require('./eventBus');
const AuraManager = require('./auraManager');
const meta = require('./meta');
const levelsMod = require('./levels');

const {
  LAYOUT, BALANCE, TOWER_DEFS, PLAYER, ATTACK_SPEED_BASE, MAX_STAGE, AURA_DURATION,
  POINTS, TALENT_POINTS, LEVELS, SHOP,
} = config;

// 「重新挑战（看广告复活）」复活后回满的生命比例。
// 口径：复活 = 回到 30% 生存积分，既救得回来又不至于让失败没有代价。
const REVIVE_LIVES_RATIO = 0.3;

// 上一次注册的全局触摸监听器。
// ⚠️ wx.onTouchStart / document.addEventListener 都是**累积注册**：重复实例化 Game
//    （开发者工具热重载、入口被跑两次等）会叠出多套监听 —— 一次触摸被多个 Game
//    实例各处理一遍，状态互相错位，是"界面点不动"的高发区。所以每次绑定前先摘旧的。
let _boundEvents = null;

/** 记录本次注册的监听器（供下一次 _unbindEvents 摘除） */
function _bindEvents(kind, handlers) {
  _boundEvents = { kind, handlers };
}

/** 摘除上一次注册的监听器（平台不支持 offXxx 时退化为不摘，绝不会抛错） */
function _unbindEvents(kind) {
  if (!_boundEvents || _boundEvents.kind !== kind) return;
  const h = _boundEvents.handlers;
  _boundEvents = null;
  try {
    if (kind === 'wx') {
      if (typeof wx === 'undefined') return;
      if (wx.offTouchStart) wx.offTouchStart(h.start);
      if (wx.offTouchMove) wx.offTouchMove(h.move);
      if (wx.offTouchEnd) wx.offTouchEnd(h.end);
      if (wx.offTouchCancel) wx.offTouchCancel(h.end);
    } else if (typeof document !== 'undefined' && document.removeEventListener) {
      document.removeEventListener('touchmove', h.move);
      document.removeEventListener('touchend', h.end);
      document.removeEventListener('touchcancel', h.end);
    }
  } catch (e) {
    // 摘监听失败无所谓，不能因此中断启动
  }
}

class Game {
  constructor(canvas, ctx, windowInfo) {
    this.canvas = canvas;
    this.ctx = ctx;

    // 拿到 ctx 的第一件事：补齐基础库可能缺失的 Canvas 2D 接口。
    // renderer.js 有几十处直接调 ctx.roundRect，老基础库（如 3.14.x）没有这个方法，
    // 缺了就会在首帧 draw() 抛 TypeError → 主循环停摆 → 整个界面点不动。
    // 同一批新接口还有 setLineDash（战前选关天梯虚线）与 ellipse（椭圆塔图标/敌人投影），
    // 老基础库一样可能没有 —— 由 polyfillCanvas2D 一次补齐。
    theme.polyfillCanvas2D(ctx);

    const w = windowInfo.screenWidth;
    const h = windowInfo.screenHeight;

    // -----------------------------------------------------------------------
    // 逻辑视口尺寸（= 屏幕 CSS 像素，= 触摸坐标空间）
    //
    // ⚠️ 全项目布局一律用 this.W / this.H，**不要再读 canvas.width / height**。
    //    画布现在是**物理像素**（逻辑 × renderScale，见 game.js 的渲染倍率标定），
    //    拿它做布局 = 所有 UI 被放大 renderScale 倍、底部导航直接跑出屏幕。
    //    渲染时由 applyViewScale() 把 ctx 缩回逻辑坐标，两者口径就对齐了。
    //
    // 顺带说明为什么不是"把画布建小、由系统放大"：那样每个逻辑像素只有
    // 1 个物理像素可用，字和斜边必然糊（2026-09-16 真机预览实测的症状）。
    // -----------------------------------------------------------------------
    this.W = w;
    this.H = h;
    this.renderScale = (windowInfo.renderScale > 0) ? windowInfo.renderScale : 1;

    // 缩小战斗区域，Y向下偏移100像素
    this.mapX = w * 0.15;
    this.mapY = h * 0.12 + 25;
    this.mapWidth = w * 0.7;
    // 战场高度：优先取 0.58h，但必须给"商店面板 + 底部导航栏"让出空间，
    // 否则短屏手机上怪物路径会压到商店面板上（面板高度见 config.SHOP.panelHeight）。
    const reservedBottom = LAYOUT.navHeight + SHOP.panelHeight + 28;
    this.mapHeight = Math.max(
      180,
      Math.min(h * 0.58, (h - reservedBottom) - this.mapY - 12)
    );

    // 场景：battle / codex / talents（底部导航切换；战斗状态常驻，切走只是冻结不销毁）
    this.scene = 'battle';
    // 战斗子状态（需求：不再点徽标选关，改成战前居中选关 + 开始游戏才跑）
    this.battleStarted = false;   // false = 战前"选关"界面（世界冻结）；true = 战斗进行中
    this.showMenu = false;        // 顶栏 ☰ 打开的游戏中菜单（返回战斗 / 放弃结束）
    this.codexSelected = null;    // 图签界面当前选中的塔类型
    this.codexScroll = 0;         // 图签格网的上下滚动量（0 = 顶部）
    this.talentScroll = 0;        // 天赋列表的上下滚动量（0 = 顶部）
    this.levelScroll = null;      // 选关天梯的上下滚动量（null = 尚未初始化，默认贴底看关卡1）
    this.enhancePicker = null;    // 强化「多选一」浮层：null=关闭，否则 { tower }
    this.toast = null;            // 操作轻提示 { text, color, t0 }
    // 涓流金库（每秒金币天赋）：小数累计，避免每帧取整丢钱
    this._goldTick = 0;
    this._goldFraction = 0;

    // 当前关卡（默认取存档里选中的关卡，初始 = 关卡 1）
    // 加 try-catch 兜底：Storage 子系统未就绪时回退到默认值，避免阻塞初始化
    let currentLevel = 1;
    let goldBonus = 0, livesBonus = 0;
    try {
      currentLevel = meta.getSelectedLevel() || 1;
      goldBonus = meta.talentValue('gold_start') || 0;
      livesBonus = meta.talentValue('lives_max') || 0;
    } catch (e) {
      console.warn('[Game] meta 初始化异常，使用默认值:', e.message);
    }
    this.currentLevel = currentLevel;

    // 游戏状态（起始金币 / 生存积分上限受天赋影响）
    this.gold = BALANCE.startGold + goldBonus;
    this.lives = BALANCE.startLives + livesBonus;
    this.maxLives = this.lives; // 生存积分上限（进度条分母）
    this.selectedTowerType = null;
    this.selectedTower = null;

    // 游戏结束状态
    this.gameOver = false;
    this.gameWon = false; // 胜利标记（与 gameOver 配合，决定结算界面显示胜利/失败）
    this.gameOverButtons = {}; // 游戏结束界面按钮区域
    this.watchingVideo = false;
    this.videoTimer = 30;

    // 游戏对象
    this.enemies = [];
    this.towers = [];
    this.effects = [];
    // 弹道系统
    this.projectiles = []; // 弹道系统
    
    // 点击效果
    this.clickEffect = null; // {x, y, startTime, duration}

    // 事件总线
    this.eventBus = new EventBus();

    // 波次管理
    this.currentWave = 0;
    this.waveInProgress = false;
    this.waitTimer = 0;
    this.waitDuration = BALANCE.waitDuration;
    this.spawnTimer = 0;
    this.spawnInterval = BALANCE.spawnInterval;
    this.enemiesToSpawn = [];

    // 生存积分：玩家0=本地红色方（进度条 = lives / maxLives）；玩家1=蓝色方（预留联机，进度条暂用占位值）

    // 倒计时显示
    this.countdownText = '';

    // 波次标题滑入动画起点（用于"进攻开始"后新波次标题滑入的缓动）
    this.waveStartStamp = 0;

    // 时间管理
    this.lastTime = Date.now();
    this.isRunning = true;

    // 槽位位置（6 个）
    this.slots = this.calculateSlots();

    // 塔刷新系统
    this.refreshCost = BALANCE.refreshCost;
    this.refreshTowerTypes = [];
    this.initRefresh();

    // 初始化路径
    this.initPath();

    // 初始化事件
    this.initEvents();

    // 拖放状态
    this.dragging = false;
    this.dragType = null;
    this.dragX = 0;
    this.dragY = 0;
    this.touchStartPos = null;   // touchstart 起点 {x, y}，用于区分点击/拖放
    this.pendingDrag = false;    // 触摸开始时是否在商店塔上
    this.draggingFromSlot = null; // 从哪个放置槽开始拖放
    this.dragFromShop = false;   // 是否从商店拖放（用于区分拖放来源，避免商店槽误亮）

    // 按钮交互反馈（按压态 + 点击波纹动画）
    this.btnPress = null;   // { id, t0 } 当前按住的按钮
    this.buttonFx = null;   // { x, y, w, h, t0, duration, color } 点击波纹

    // 光环管理器
    this.auraManager = new AuraManager();

    // 属性面板状态
    this.showPanel = false;
    this.panelTowerType = null;

    // 商店槽状态（记录哪些槽被拖走了，需要显示为空），与 shopOffers 一一对应
    this.shopSlotState = this.shopOffers.map((type) => ({ type: type, empty: false }));

    // 开始游戏循环
    this.loop();
    
    // 调试日志
    console.log('Game initialized:', {
      mapX: this.mapX,
      mapY: this.mapY,
      mapWidth: this.mapWidth,
      mapHeight: this.mapHeight,
      slots: this.slots.length,
      towers: this.towers.length,
    });
  }

  // ========== 事件注册便捷方法 ==========

  /**
   * 注册命中事件
   */
  onHit(callback) {
    return this.eventBus.on('onHit', callback);
  }

  /**
   * 注册伤害事件
   */
  onDamage(callback) {
    return this.eventBus.on('onDamage', callback);
  }

  /**
   * 注册死亡事件
   */
  onDeath(callback) {
    return this.eventBus.on('onDeath', callback);
  }

  // ========== 事件触发辅助方法 ==========

  /**
   * 触发命中事件
   */
  triggerHit(hitTarget, damageSource, damage) {
    if (hitTarget && hitTarget.alive) {
      this.eventBus.emitHit(hitTarget, damageSource, damage);
    }
  }

  /**
   * 触发伤害事件
   */
  triggerDamage(damageSource, damage, target) {
    if (target && target.alive) {
      this.eventBus.emitDamage(damageSource, damage, target);
    }
  }

  /**
   * 触发死亡事件
   */
  triggerDeath(deadTarget, killer) {
    if (!deadTarget.alive) {
      this.eventBus.emitDeath(deadTarget, killer);
    }
  }

  initPath() {
    const { mapX, mapY, mapWidth, mapHeight } = this;

    // 槽位位置计算
    const slotSize = LAYOUT.slotSize;
    const gap = LAYOUT.slotGap;
    const cols = LAYOUT.slotCols;
    const rows = LAYOUT.slotRows;
    const totalWidth = cols * slotSize + (cols - 1) * gap;
    const startX = mapX + (mapWidth - totalWidth) / 2;
    const totalHeight = rows * slotSize + (rows - 1) * gap;
    const startY = mapY + mapHeight - totalHeight - 10;

    // 关键位置：左列上下角、右列上下角
    const topLeft = { x: startX, y: startY };                          // 左上角
    const bottomLeft = { x: startX, y: startY + (rows - 1) * (slotSize + gap) };  // 左下角
    const bottomRight = { x: startX + (cols - 1) * (slotSize + gap) + slotSize, y: startY + (rows - 1) * (slotSize + gap) };  // 右下角
    const topRight = { x: startX + (cols - 1) * (slotSize + gap), y: startY };    // 右上角

    const padding = LAYOUT.pathPadding;

    // 槽位编号（从左到右，从下到上，0起始）：
    // 第2行（顶部）: 8  9  10 11
    // 第1行（中间）: 4  5  6  7
    // 第0行（底部）: 0  1  2  3
    
    // 0槽左上角 (col=0, row=0)
    const slot0TopLeft = { x: startX, y: startY };
    // 8槽左下角 (col=0, row=2)
    const slot8BottomLeft = { x: startX, y: startY + 2 * (slotSize + gap) };
    // 11槽右下角 (col=3, row=2)
    const slot11BottomRight = { x: startX + 3 * (slotSize + gap) + slotSize, y: startY + 2 * (slotSize + gap) };
    // 3槽右上角 (col=3, row=0)
    const slot3TopRight = { x: startX + 3 * (slotSize + gap) + slotSize, y: startY };

    // 怪物路径：起点(0槽左上角) → 转点1(8槽左下角) → 转点2(11槽右下角) → 终点(3槽右上角)
    this.pathPoints = [
      { x: slot0TopLeft.x - 10, y: slot0TopLeft.y - 10 },      // 起点 - 0槽左上角偏移
      { x: slot8BottomLeft.x - 10, y: slot8BottomLeft.y + 45 }, // 转点1 - 8槽左下角偏移
      { x: slot11BottomRight.x + 10, y: slot11BottomRight.y + 45 }, // 转点2 - 11槽右下角偏移
      { x: slot3TopRight.x + 10, y: slot3TopRight.y - 10 },    // 终点 - 3槽右上角偏移
    ];

    // 保存起点终点用于绘制文字
    this.pathStart = this.pathPoints[0];
    this.pathEnd = this.pathPoints[this.pathPoints.length - 1];
  }

  /**
   * 从"图签登场池"抽货：这是商店与图签的联动点。
   * 图签里怎么排登场，商店就出什么货；未解锁的塔永远不会出货（解锁由图签界面负责）。
   * 出货池至少 1 个（meta 保证），不足 cardCount 时货架按实际数量出，其余显示为空槽。
   */
  rollShopOffers() {
    const pool = meta.getLineup();
    const shuffled = pool.slice().sort(() => Math.random() - 0.5);
    const count = Math.min(SHOP.cardCount, shuffled.length);
    return shuffled.slice(0, count);
  }

  initRefresh() {
    this.shopOffers = this.rollShopOffers();
    this.shopSlotState = this.shopOffers.map((type) => ({ type: type, empty: false }));
  }

  refreshTowers() {
    if (this.gold < this.refreshCost) return false;
    this.gold -= this.refreshCost;
    this.shopOffers = this.rollShopOffers();
    // 重置商店槽状态（与 shopOffers 一一对应，避免索引错位）
    this.shopSlotState = this.shopOffers.map((type) => ({ type: type, empty: false }));
    // 增加下次刷新所需金币
    this.refreshCost += BALANCE.refreshCostStep;
    return true;
  }

  calculateSlots() {
    // 6 个槽位 2 行 3 列
    const slotSize = LAYOUT.slotSize;
    const gap = LAYOUT.slotGap;
    const cols = LAYOUT.slotCols;
    const rows = LAYOUT.slotRows;
    const totalWidth = cols * slotSize + (cols - 1) * gap;
    const startX = this.mapX + (this.mapWidth - totalWidth) / 2;
    const totalHeight = rows * slotSize + (rows - 1) * gap;
    const startY = this.mapY + this.mapHeight - totalHeight - 10;

    const slots = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        slots.push({
          x: startX + col * (slotSize + gap),
          y: startY + row * (slotSize + gap),
          size: slotSize,
          occupied: false,
          tower: null,
        });
      }
    }
    return slots;
  }

  initEvents() {
    // 微信小游戏环境：使用 wx 全局触摸事件 API（更可靠，不受元素绑定限制）
    const onTouchStart = (e) => input.handleTouchStart(this, e);
    const onTouchMove = (e) => input.handleTouchMove(this, e);
    const onTouchEnd = (e) => input.handleTouchEnd(this, e);

    if (typeof wx !== 'undefined' && wx.onTouchStart) {
      // 先摘掉上一次注册的监听：onTouch* 是累积注册，
      // 不摘就会出现"一次触摸被多个 Game 实例各处理一遍"（见 _boundEvents 注释）。
      _unbindEvents('wx');
      wx.onTouchStart(onTouchStart);
      wx.onTouchMove(onTouchMove);
      wx.onTouchEnd(onTouchEnd);
      wx.onTouchCancel(onTouchEnd);
      _bindEvents('wx', { start: onTouchStart, move: onTouchMove, end: onTouchEnd });
    } else {
      // 浏览器调试环境兜底（document 上的监听同样会累积，必须先摘）
      _unbindEvents('dom');
      this.canvas.addEventListener('touchstart', onTouchStart);
      this.canvas.addEventListener('touchmove', onTouchMove, { passive: false });
      this.canvas.addEventListener('touchend', onTouchEnd);
      this.canvas.addEventListener('touchcancel', onTouchEnd);
      // 同时监听 document 防止手指拖出 canvas
      document.addEventListener('touchmove', onTouchMove, { passive: false });
      document.addEventListener('touchend', onTouchEnd);
      document.addEventListener('touchcancel', onTouchEnd);
      _bindEvents('dom', { start: onTouchStart, move: onTouchMove, end: onTouchEnd });
    }
  }

  startNextWave() {
    this.currentWave++;
    this.enemiesToSpawn = waveMod.generateWave(this.currentWave);
    this.spawnTimer = 0;
    this.waveInProgress = true;
    this.waveStartStamp = Date.now(); // 记录波次开始时间，驱动标题滑入动画
  }

  /**
   * 重新开始：重置所有数据
   */
  restart() {
    // 恢复运行
    this.isRunning = true;
    this.gameOver = false;
    this.gameWon = false; // 必须重置，否则胜利界面会残留
    this.watchingVideo = false;
    this.videoTimer = 30;

    // 恢复游戏状态（起始金币 / 生存上限含天赋加成）
    this.gold = BALANCE.startGold + meta.talentValue('gold_start');
    this.lives = BALANCE.startLives + meta.talentValue('lives_max');
    this.maxLives = this.lives;

    // 清空游戏对象
    this.enemies = [];
    this.towers = [];
    this.effects = [];
    this.projectiles = [];
    this.clickEffect = null;

    // 清除所有单位注册表
    units.clearAllUnits();

    // 清除光环管理器
    this.auraManager.clear();

    // 重置波次
    this.currentWave = 0;
    this.waveInProgress = false;
    this.waitTimer = this.waitDuration;
    this.countdownText = '';
    this.waveStartStamp = 0;

    // 重置槽位
    this.slots = this.calculateSlots();

    // 重置商店（出货池重新从图签登场配置抽取）
    this.refreshCost = BALANCE.refreshCost;
    this.shopOffers = [];
    this.initRefresh();

    // 重置拖放状态
    this.dragging = false;
    this.dragType = null;
    this.dragX = 0;
    this.dragY = 0;
    this.touchStartPos = null;
    this.pendingDrag = false;
    this.draggingFromSlot = null;
    this.dragFromShop = false;

    // 重置属性面板
    this.showPanel = false;
    this.panelTowerType = null;

    // 重置按钮交互状态
    this.btnPress = null;
    this.buttonFx = null;

    // 重置商店槽状态
    this.shopSlotState = this.shopOffers.map((type) => ({ type: type, empty: false }));

    // 重置元进度相关 UI 状态
    this.toast = null;
    this.codexSelected = null;
    this.codexScroll = 0;
    this.talentScroll = 0;
    // levelScroll 不在 restart 里重置：保留用户滚动位置，让选关界面回到原来的位置
    // （startLevel 会显式设置到目标关卡，abandonRun 保留上次滚动）
    this.enhancePicker = null;
    this.showMenu = false;

    // 主循环常驻运行，这里只需恢复 isRunning 标志
  }

  /**
   * 观看继续：30秒视频后恢复当前波次 + 金币奖励
   */
  watchContinue() {
    this.watchingVideo = true;
    this.videoTimer = 30;
    // 暂停游戏循环
    this.isRunning = false;
  }

  /**
   * 视频倒计时完成
   */
  onVideoComplete() {
    this.watchingVideo = false;
    this.videoTimer = 30;

    // 恢复游戏
    this.isRunning = true;
    this.gameOver = false;

    // ⚠️ 复活必须真的把生命补回来。
    // 旧实现只复原波次和金币，lives 仍是 <=0 —— 结果广告一结束、下一帧 update()
    // 立刻又判定 gameOver，玩家看了 30 秒广告等于白看（现象：出广告就秒死）。
    if (this.lives <= 0) {
      const base = this.maxLives > 0 ? this.maxLives : BALANCE.startLives;
      this.lives = Math.max(1, Math.floor(base * REVIVE_LIVES_RATIO));
    }

    // 恢复当前波次
    this.enemiesToSpawn = waveMod.generateWave(this.currentWave);
    this.spawnTimer = 0;
    this.waveInProgress = true;
    this.waveStartStamp = Date.now();

    // 获得当前波次 * 500 金币
    this.gainGold(this.currentWave * 500);

    // 重置倒计时
    this.waitTimer = this.waitDuration;
  }


  // ========== 元进度 / 天赋 / 图签 取值口 ==========
  // 战斗侧的数值一律从这里取，保证"面板显示的"与"真正结算的"同口径。

  /** 图形塔实际造价（含"精打细算"天赋折扣） */
  towerCost(type) {
    return towerMod.getDiscountedCost(type, meta.talentValue('build_cost'));
  }

  /** 击杀金币倍率：点石成金 + 暴利风险（增益侧） */
  killGoldMultiplier() {
    return 1 + (meta.talentValue('gold_gain') + meta.talentValue('high_stakes', 'goldPerLevel')) / 100;
  }

  /** 入账金币（含击杀金币天赋加成） */
  gainGold(amount) {
    const mult = this.killGoldMultiplier();
    this.gold += Math.max(0, Math.round((amount || 0) * mult));
  }

  /** 击杀结算：金币 + 特殊积分 +（BOSS 及以上）天赋点 */
  grantKillReward(enemy) {
    if (!enemy) return;
    const tier = enemy.tier || 0;
    // BOSS 悬赏：精英(tier3) 及以上额外加成
    const bounty = tier >= 3 ? (1 + meta.talentValue('boss_bounty') / 100) : 1;
    this.gainGold((enemy.reward || 0) * bounty);
    let pts = 0;
    if (tier >= 5) pts = POINTS.tier5;
    else if (tier >= 4) pts = POINTS.tier4;
    else if (tier >= 3) pts = POINTS.tier3;
    if (pts > 0) meta.grantPoints(pts);
    if (tier >= 4) meta.grantTalentPoints(TALENT_POINTS.bossKill);
  }

  /** 图签加成后的最终攻击力（战斗与属性面板同口径）
   *  攻击力三条线：
   *    ① 3★ 阶段强化塔 → 基础攻击力 +5%/级（白字，受等级/阶段/图签绿字加成影响）
   *    ② 合成进阶（等级/阶段）—— 绿字
   *    ③ 图签 —— 绿字
   */
  towerDamage(tower, baseDamage) {
    // ① 3★ 阶段强化塔的白字加成：每次强化 +5% 基础攻击力
    let whiteBonus = baseDamage;
    const stage = tower && tower.stage ? tower.stage : 0;
    const enhanceLv = tower && tower.enhanceLevel ? tower.enhanceLevel : 0;
    if (stage >= BALANCE.enhance.minStage && enhanceLv > 0) {
      whiteBonus = Math.floor(baseDamage * (1 + enhanceLv * 0.05));
    }
    const dmg = towerMod.calculateFinalDamage(
      whiteBonus, tower.level, tower.attackPowerBoost
    );
    return Math.floor(dmg * meta.codexDamageMultiplier(tower.type));
  }

  /**
   * 统一的伤害结算入口（暴击 + 抗性/穿透 + 事件 + 击杀处理）。
   *
   * 结算顺序：
   *   ① 暴击：按塔的暴击率 roll，命中则伤害 × 暴击倍率（溅射/爆炸默认不暴击，可显式开启）
   *   ② 抗性：有效抗性 = max(0, 敌人抗性 - 塔的穿透)
   *   ③ 减伤：实际伤害 = 造成伤害 × (1 - 有效抗性 / (有效抗性 + BALANCE.armorK))
   *           —— 递减曲线，抗性再高也只是接近免疫而不会真的免疫；
   *              穿透直接抵掉抗性，所以高穿透塔对高抗性目标收益最大。
   *
   * @param {object|null} sourceTower 伤害来源塔（null = 环境伤害，不吃暴击/穿透）
   * @param {object} enemy 目标
   * @param {number} baseDamage 暴击/抗性结算前的伤害
   * @param {{allowCrit?:boolean, source?:any}} [opts]
   * @returns {{damage:number, crit:boolean, killed:boolean}}
   */
  applyDamage(sourceTower, enemy, baseDamage, opts) {
    if (!enemy || !enemy.alive) return { damage: 0, crit: false, killed: false };
    const o = opts || {};
    const source = o.source || sourceTower || { type: 'explosion' };

    let dmg = Math.max(0, baseDamage || 0);
    let crit = false;

    // ① 暴击
    if (sourceTower && o.allowCrit !== false) {
      const prof = towerMod.getAttackProfile(sourceTower);
      if (prof.critChance > 0 && Math.random() * 100 < prof.critChance) {
        dmg = Math.round(dmg * prof.critMult);
        crit = true;
      }
    }

    // ②③ 抗性 / 穿透 + 递减减伤
    const pen = sourceTower ? towerMod.getAttackProfile(sourceTower).penetration : 0;
    const armor = enemy.armor || 0;
    const effectiveArmor = Math.max(0, armor - pen);
    if (effectiveArmor > 0 && dmg > 0) {
      const reduce = effectiveArmor / (effectiveArmor + BALANCE.armorK);
      dmg = Math.max(1, Math.round(dmg * (1 - reduce)));
    }

    this.triggerHit(enemy, source, dmg);
    this.triggerDamage(source, dmg, enemy);

    enemy.hp -= dmg;
    let killed = false;
    if (enemy.hp <= 0) {
      enemy.alive = false;
      killed = true;
      this.grantKillReward(enemy);
      units.removeUnit(enemy.uniqueId);
      this.triggerDeath(enemy, source);
    }
    return { damage: dmg, crit: crit, killed: killed };
  }

  /** 清空一波：特殊积分 + 波次结余金币；每 N 波给天赋点；记录最高波次 */
  onWaveCleared() {
    meta.grantPoints(POINTS.perWave);
    // 波次结余天赋：直接入账，不吃击杀金币倍率
    const waveGold = meta.talentValue('wave_bonus');
    if (waveGold > 0) this.gold += waveGold;
    meta.recordWave(this.currentLevel, this.currentWave);
    const every = TALENT_POINTS.perWaveGroup.every;
    if (every > 0 && this.currentWave % every === 0) {
      meta.grantTalentPoints(TALENT_POINTS.perWaveGroup.amount);
    }
  }

  /** 通关关卡：首通额外奖励 + 天赋点；自动把预选关卡推进到下一关（若已实现） */
  onLevelCleared() {
    const first = meta.markLevelCleared(this.currentLevel, this.currentWave);
    meta.grantPoints(POINTS.clearLevel + (first ? POINTS.firstClearBonus : 0));
    meta.grantTalentPoints(TALENT_POINTS.clearLevel);
    // 首通时：自动把预选关卡指向下一关（若已实现），让玩家"冲下一关"
    if (first) {
      const nextId = this.currentLevel + 1;
      if (meta.isLevelPlayable(nextId)) {
        meta.setSelectedLevel(nextId);
        this.currentLevel = nextId;
      }
    }
    meta.save(true);
  }

  /** 场景切换（底部导航入口）。战斗状态常驻，切走只是冻结。 */
  switchScene(scene) {
    if (scene === this.scene) return;
    this.scene = scene;
    this.codexSelected = null;
    this.showMenu = false;
    this.enhancePicker = null;   // 强化浮层是战斗内模态，切场景必须收掉
    this.dragging = false;
    this.pendingDrag = false;
    this.draggingFromSlot = null;
    this.btnPress = null;
    if (scene !== 'battle') {
      this.selectedTower = null;
      this.showPanel = false;
      this.panelTowerType = null;
    }
    meta.save(true);
  }

  // ========== 战斗流程（战前选关 → 开始游戏 → 游戏中菜单）==========

  /** 打开 ☰ 游戏菜单 */
  openMenu() {
    if (!this.battleStarted || this.gameOver) return false;
    this.showMenu = true;
    this.showPanel = false;
    this.selectedTower = null;
    this.panelTowerType = null;
    return true;
  }

  /** 关闭菜单，返回战斗 */
  closeMenu() {
    this.showMenu = false;
  }

  /**
   * 开始游戏：当前所选关卡正式开跑。
   * 世界在此之前完全不推进（见 loop 的 battleStarted 判定）。
   */
  startBattle() {
    let lv = LEVELS.filter((l) => l.id === this.currentLevel)[0];
    // 存档里的 currentLevel 可能已不可玩/未解锁（历史上可玩、后来锁定，或坏档）。
    // 兜底切到第一个"已解锁"的关卡（默认就是关卡 1），保证「开始游戏」永远真的能开始。
    if (!lv || !meta.isLevelUnlocked(this.currentLevel)) {
      const fallback = LEVELS.filter((l) => meta.isLevelUnlocked(l.id))[0];
      if (fallback) {
        this.currentLevel = fallback.id;
        meta.setSelectedLevel(fallback.id);
        lv = fallback;
      }
    }
    if (!lv || !meta.isLevelUnlocked(lv.id)) return false;
    this.restart();
    this.scene = 'battle';
    this.battleStarted = true;
    this.showMenu = false;
    meta.save(true);
    return true;
  }

  /** 放弃结束：结束本局，回到战前选关界面（局内进度丢弃，局外积分/天赋点已入账） */
  abandonRun() {
    this.restart();
    this.scene = 'battle';
    this.battleStarted = false;
    this.showMenu = false;
    meta.save(true);
    return true;
  }

  /** 进入指定关卡（仅切换"待开始"的关卡，不直接开跑）。需关卡已解锁。 */
  startLevel(levelId) {
    if (!meta.isLevelUnlocked(levelId)) return false;
    meta.setSelectedLevel(levelId);
    this.currentLevel = levelId;
    this.restart();
    this.scene = 'battle';
    // 自动把天梯滚动到选中关卡的位置（居中显示）
    levelsMod.scrollToLevel(this, levelId);
    return true;
  }

  // ========== 塔强化（局内花金币：只抬该塔的专属特殊属性，不给伤害）==========

  /** 强化到下一级的花费；已满级返回 Infinity */
  enhanceCost(tower) {
    if (!tower) return Infinity;
    return towerMod.getEnhanceCost(tower.type, tower.enhanceLevel || 0);
  }

  /** 该塔能否在属性面板里强化（需 3★ + 未满级 + 有实体塔） */
  canEnhanceTower(tower) {
    if (!tower) return { ok: false, reason: 'none' };
    if (!towerMod.isStageReady(tower)) {
      return { ok: false, reason: 'stage', need: BALANCE.enhance.minStage, stage: tower.stage || 0 };
    }
    if (!towerMod.canEnhance(tower)) return { ok: false, reason: 'maxed' };
    return { ok: true };
  }

  /**
   * 强化选中的塔：扣金币 → 强化等级 +1 → 重算专属特殊属性。
   *
   * 与旧版的区别（2026-09 二次重做）：
   *   · 不再发放「固定攻击力点数」，因此塔的攻击力完全不受强化影响；
   *   · 不再多选一，每塔只有一项专属属性（见 config.ENHANCE_SPECIAL），
   *     强化只是把它的取值从 base + per×L 推到 base + per×(L+1)。
   *
   * @param {object} tower 目标塔
   * @param {string} [optionKey] 兼容参数：必须等于该塔的专属属性 key（不传则无条件通过）
   * @returns {{ok:boolean, level?:number, cost?:number, option?:object, special?:object, reason?:string}}
   */
  enhanceTower(tower, optionKey) {
    const gate = this.canEnhanceTower(tower);
    if (!gate.ok) {
      return Object.assign({}, gate, { level: tower ? (tower.enhanceLevel || 0) : 0 });
    }
    const opt = towerMod.getEnhanceOption(tower.type, optionKey);
    if (!opt) return { ok: false, reason: 'option' };

    const cost = this.enhanceCost(tower);
    if (this.gold < cost) return { ok: false, reason: 'gold', cost: cost };

    this.gold -= cost;
    tower.enhanceLevel = (tower.enhanceLevel || 0) + 1;
    // 单一真源：按等级全量重算，而不是在旧值上累加
    towerMod.applyEnhanceAttrs(tower);
    tower.enhancePicks = tower.enhancePicks || [];
    tower.enhancePicks.push(opt.key);
    return {
      ok: true,
      level: tower.enhanceLevel,
      cost: cost,
      option: opt,
      special: {
        name: opt.name,
        gain: opt.perLevel,
        unit: opt.unit,
        value: towerMod.getSpecialValue(tower.type, tower.enhanceLevel),
        text: towerMod.specialText(tower.type, tower.enhanceLevel),
      },
    };
  }

  /** 涓流金库：每秒金币天赋（小数累计，逐点入账） */
  tickPassiveGold(dt) {
    const perSec = meta.talentValue('gold_per_sec');
    if (perSec <= 0) return;
    this._goldFraction += perSec * dt;
    const whole = Math.floor(this._goldFraction);
    if (whole > 0) {
      this.gold += whole;
      this._goldFraction -= whole;
    }
  }

  update(deltaTime) {
    // 被动金币（天赋"涓流金库"）
    this.tickPassiveGold(deltaTime);

    // 更新倒计时 / 波次
    if (!this.waveInProgress) {
      this.waitTimer -= deltaTime;
      this.countdownText = Math.ceil(this.waitTimer).toString();

      if (this.waitTimer <= 0) {
        this.startNextWave();
        this.countdownText = '';
      }
    } else {
      this.spawnTimer -= deltaTime;
      if (this.spawnTimer <= 0 && this.enemiesToSpawn.length > 0) {
        const type = this.enemiesToSpawn.shift();
        const enemy = enemyMod.spawnEnemy(type, this.pathPoints, this.currentWave);
        // 动态抗性：关卡1全程0，关卡N(N≥2)每波抗性 = (关卡-1) × 波次
        // 直接覆盖 ENEMY_TYPES 里的固定 armor（关卡1时 level-1=0 → 0*wave=0 符合"全程0"）
        enemy.armor = Math.max(0, (this.currentLevel - 1) * this.currentWave);
        this.enemies.push(enemy);
        this.spawnTimer = this.spawnInterval;
      }

      if (this.enemiesToSpawn.length === 0 && this.enemies.length === 0) {
        this.waveInProgress = false;
        this.waitTimer = this.waitDuration;
        this.countdownText = '';
        this.onWaveCleared();
      }
    }

    // 更新怪物
    for (const enemy of this.enemies) {
      const reached = enemyMod.updateEnemy(enemy, deltaTime, this.pathPoints);
      if (reached) {
        // 根据怪物类型扣分
        this.applyPenaltyByEnemyType(enemy);
      }
    }

    this.enemies = this.enemies.filter((e) => e.alive);
    
    // 检查第20波胜利条件：最终BOSS死亡后清空全场，还有积分则胜利
    if (this.currentWave === 20 && !this.gameOver) {
      const hasFinalBoss = this.enemies.some(e => e.type === 'finalBoss');
      if (!hasFinalBoss && this.enemiesToSpawn.length === 0) {
        // 最终BOSS已死且没有更多怪可刷
        if (this.lives > 0) {
          this.gameOver = true;
          this.isRunning = false;
          this.gameWon = true; // 标记胜利
          this.onLevelCleared();
        }
      }
    }

    // 更新塔的攻击
      // 更新光环管理器
      this.auraManager.update(deltaTime);
      // 在攻击更新之前先应用光环
      this.applyTrapezoidAuras();
      
      this.updateTowers(deltaTime);

      // 更新长方塔堆叠倒计时
      for (const tower of this.towers) {
        if (tower.type === 'long_rectangle' && tower.stackTimer > 0) {
          tower.stackTimer -= deltaTime;
          if (tower.stackTimer <= 0) {
            tower.stackCount = 0;
            tower.stackTarget = null;
            tower.stackTimer = 0;
          }
        }
      }

      // 更新弹道
      this.updateProjectiles(deltaTime);

      // 更新爆炸效果（二段伤害）
      this.updateExplosions(deltaTime);

      // 更新效果生命周期（基于计时器）
      for (const effect of this.effects) {
        effect.life -= deltaTime;
      }
      this.effects = this.effects.filter(e => e.life > 0);

    // 检查游戏结束
    if (this.lives <= 0 && !this.gameOver) {
      this.gameOver = true;
      this.isRunning = false;
      meta.recordWave(this.currentLevel, this.currentWave);
      meta.save(true);
    }
  }

  updateTowers(dt) {
    for (const tower of this.towers) {
      // 辅助塔（梯塔）不攻击
      if (tower.isSupport) {
        continue;
      }

      // 通过光环管理器获取带光环加成的攻击速度
      const stats = towerMod.getTowerRuntimeStats(tower);
      const baseAttackSpeed = stats.attackSpeedMultiplier || ATTACK_SPEED_BASE;
      const effectiveAttackSpeed = this.auraManager.getBuffedValue(tower.uniqueId, baseAttackSpeed);

      tower.attackTimer -= dt;
      if (tower.attackTimer > 0) continue;

      // 检查当前锁定的目标是否还存活
      if (tower.lockedTarget) {
        // 判断目标是否死亡
        if (!tower.lockedTarget.alive) {
          // 目标已死亡，重新索敌
          tower.lockedTarget = null;
        } else {
          // 目标还活着，检查是否还在攻击范围内
          const dx = tower.lockedTarget.x - tower.x;
          const dy = tower.lockedTarget.y - tower.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          
          if (dist > (stats.range || 200)) {
            // 目标跑出范围，重新锁定
            tower.lockedTarget = null;
          }
        }
      }

      // 如果没有锁定目标，重新扫描
      if (!tower.lockedTarget) {
        tower.lockedTarget = this.findTarget(tower);
      }

      const nearestTarget = tower.lockedTarget;
      
      // 半圆塔：激光攻击，持续直连线条
      if (tower.type === 'semicircle') {
        if (nearestTarget) {
          // 持续造成伤害（每帧都伤害）
          this.fireLaser(tower, nearestTarget, dt);
          // 激光直接造成伤害，攻击后检查目标是否死亡
          if (!nearestTarget.alive) {
            tower.lockedTarget = null;
          }
        }
        continue;
      }

      // 扇塔：扇形弹道攻击
      if (tower.type === 'sector') {
        // 更新扇塔朝向锁定目标
        if (nearestTarget) {
          const dx = nearestTarget.x - tower.x;
          const dy = nearestTarget.y - tower.y;
          tower.attackAngle = Math.atan2(dy, dx);
        }
        
        if (nearestTarget && this.findSectorTarget(tower)) {
          // 基础攻击间隔 3.0秒，应用攻击速度乘数（使用光环管理器计算）
          const effectiveInterval = 3.0 / (effectiveAttackSpeed / 100);
          tower.attackTimer = effectiveInterval;
          this.fireSectorAOE(tower);
        }
        continue;
      }
      // 圆塔：爆炸溅射
      if (tower.type === 'circle') {
        if (nearestTarget) {
          const effectiveInterval = 0.8 / (effectiveAttackSpeed / 100);
          tower.attackTimer = effectiveInterval;
          this.fireExplosiveProjectile(tower, nearestTarget);
          continue;
        }
      }

      // 正方塔：旋转弹道直线冲锋
      if (tower.type === 'square') {
        if (nearestTarget) {
          const effectiveInterval = 1.5 / (effectiveAttackSpeed / 100);
          tower.attackTimer = effectiveInterval;
          this.fireSquareProjectile(tower, nearestTarget);
        }
        continue;
      }

      // 普通塔：单体攻击
      if (nearestTarget) {
        // 长方塔：堆叠伤害机制
        if (tower.type === 'long_rectangle') {
          const towerStats = towerMod.getTowerRuntimeStats(tower);
          // 检查目标是否切换或堆叠已过期
          if (tower.lockedTarget !== nearestTarget || tower.stackTimer <= 0) {
            // 切换目标或堆叠过期 → 重置
            tower.stackCount = 0;
            tower.stackTarget = null;
            tower.stackTimer = 5.0; // 新目标开始5秒计时
          }
          
          // 攻击时增加堆叠层数（上限 = 原生 10 层 + 专属属性"堆叠上限"强化）
          tower.stackCount = Math.min(tower.stackCount + 1, towerMod.getStackMax(tower));
          
          // 堆叠伤害计算：配置基础攻击力 + 层数加成，应用攻击增幅
          const baseDamage = this.towerDamage(tower, towerStats.damage);
          const stackBonus = tower.stackCount * 2;
          const totalDamage = baseDamage + stackBonus;
          
          // 攻击间隔取配置中的 attackInterval
          const effectiveInterval = towerStats.attackInterval / (effectiveAttackSpeed / 100);
          tower.attackTimer = effectiveInterval;
          this.fireProjectile(tower, nearestTarget, totalDamage);
          continue;
        }
        
        // 六边塔：对精英及以上（tier>=3，含 BOSS）伤害 ×N，
        // N = 原生 5 倍 + 专属属性"精英伤害倍率"强化（见 tower.getEliteMultiplier）
        if (tower.type === 'hexagon' && nearestTarget.tier >= 3) {
          const towerStats = towerMod.getTowerRuntimeStats(tower);
          const totalDamage = this.towerDamage(tower, towerStats.damage) * towerMod.getEliteMultiplier(tower);
          
          const effectiveInterval = 1.2 / (effectiveAttackSpeed / 100);
          tower.attackTimer = effectiveInterval;
          this.fireProjectile(tower, nearestTarget, totalDamage);
          continue;
        }
        
        // 普通塔正常伤害计算，使用配置中的 attackInterval
        const towerStats = towerMod.getTowerRuntimeStats(tower);
        const effectiveInterval = towerStats.attackInterval / (effectiveAttackSpeed / 100);
        tower.attackTimer = effectiveInterval;
        this.fireProjectile(tower, nearestTarget);
      }
    }
  }

  /**
   * 应用梯塔光环效果：遍历所有梯塔，给周围我方塔增加攻击速度
   * 光环规则（2026-09 重构）：
   *  - 光环强度随梯塔自身阶段提升：基础25 × (1 + 阶段) → 25 / 50 / 75 / 100
   *  - 每个目标塔只保留一个生效光环，高阶来源覆盖低阶来源
   *  - 在范围内每帧刷新持续时间；离开范围/塔死亡后 AURA_DURATION 秒自动失效
   */
  applyTrapezoidAuras() {
    for (const tower of this.towers) {
      if (!tower.isSupport) continue;

      const stats = towerMod.getTowerRuntimeStats(tower);
      const range = stats.range || 150;
      const baseBuff = stats.supportBuff || { attackSpeedMultiplier: 25 };
      // 光环强度随自身阶段提升（1星+50、2星+75、3星+100），3星封顶
      const stage = Math.max(0, Math.min(tower.stage || 0, MAX_STAGE));
      // 图签等级同样放大光环强度（与属性面板 bonusStats 的口径一致）
      const codexMult = meta.codexDamageMultiplier(tower.type);
      const buff = { attackSpeedMultiplier: baseBuff.attackSpeedMultiplier * (1 + stage) * codexMult };

      // 遍历所有我方塔，检查是否在光环范围内
      for (const other of this.towers) {
        // 跳过梯塔自身，只对我方非辅助塔生效
        if (other === tower) continue;
        if (other.owner !== PLAYER.OWN) continue;
        if (other.isSupport) continue;

        const dx = other.x - tower.x;
        const dy = other.y - tower.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist <= range) {
          // 高阶覆盖低阶；在范围内每帧刷新持续时间
          // meta.name：来源塔显示名（属性面板"生效效果"里展示光环出处）
          const srcDef = TOWER_DEFS[tower.type];
          this.auraManager.applyAura(tower.uniqueId, buff, stage, other.uniqueId, AURA_DURATION, {
            name: srcDef ? srcDef.name : '光环',
          });
        }
      }
    }
  }

  fireProjectile(tower, target, customDamage) {
    const towerDef = TOWER_DEFS[tower.type];
    const towerStats = towerMod.getTowerRuntimeStats(tower);
    
    // 使用 tower.js 中的 calculateFinalDamage 计算最终攻击力
    let damage;
    if (customDamage !== undefined) {
      // 自定义伤害（如长方塔堆叠）
      damage = customDamage;
    } else {
      damage = this.towerDamage(tower, towerStats.damage);
    }
    
    // 计算从塔到目标的角度
    const dx = target.x - tower.x;
    const dy = target.y - tower.y;
    const angle = Math.atan2(dy, dx);
    
    this.projectiles.push({
      x: tower.x,
      y: tower.y,
      targetX: target.x,
      targetY: target.y,
      targetType: target, // 保存对敌人的引用
      sourceTower: tower, // 命中时用于暴击/穿透结算
      speed: 300, // 弹道速度（像素/秒）
      color: towerDef.color,
      type: tower.type,
      damage: damage, // 使用塔的实际攻击力
      alive: true,
      angle: angle, // 弹道朝向角度
    });
    
    // 记录塔的攻击朝向
    tower.attackAngle = angle;
  }

  /**
   * 正方塔：旋转弹道直线冲锋
   * 弹道从塔向目标方向直线冲锋，弹道自身旋转，对经过的敌人造成单次伤害，出屏幕时销毁
   */
  fireSquareProjectile(tower, target) {
    const towerDef = TOWER_DEFS[tower.type];
    const towerStats = towerMod.getTowerRuntimeStats(tower);
    const damage = this.towerDamage(tower, towerStats.damage);
    
    // 计算从塔到目标的方向
    const dx = target.x - tower.x;
    const dy = target.y - tower.y;
    const angle = Math.atan2(dy, dx);
    
    this.projectiles.push({
      x: tower.x,
      y: tower.y,
      angle: angle, // 冲锋方向
      rotationAngle: 0, // 弹道自身旋转角度
      sourceTower: tower,
      speed: 500, // 冲锋速度
      damage: damage,
      type: 'square',
      color: towerDef.color,
      size: 10, // 弹道大小（原20，减小50%）
      alive: true,
      hitEnemies: new Set(), // 已造成伤害的敌人，避免重复伤害
    });
    
    tower.attackAngle = angle;
  }

  /**
   * 半圆塔：激光攻击（持续直连线条）
   */
  fireLaser(tower, target, dt) {
    const towerStats = towerMod.getTowerRuntimeStats(tower);
    const towerDamage = this.towerDamage(tower, towerStats.damage);
    
    // 每秒伤害 = 塔攻击力，按时间比例计算单帧伤害
    const damage = Math.max(1, Math.floor(towerDamage * dt));
    
    // 直接造成伤害（激光持续命中）：每帧伤害太低，不吃暴击（避免每帧 roll 抖动），但吃护甲/穿透
    if (target && target.alive) {
      this.applyDamage(tower, target, damage, { allowCrit: false });
    }
      
      // 记录激光效果（持续线条）
    this.effects.push({
      type: 'laser',
      x1: tower.x,
      y1: tower.y,
      x2: target.x,
      y2: target.y,
      color: '#44FFFF',
      life: 0.1, // 激光效果持续时间
      maxLife: 0.1,
    });
    
    tower.attackAngle = Math.atan2(target.y - tower.y, target.x - tower.x);
  }

  /**
   * 扇塔：查找扇形范围内的第一个敌人（最近的）
   * 半张角取 tower.getSectorHalfAngle：原生 45° + 专属属性"扇面张角"强化
   */
  findSectorTarget(tower) {
    const towerStats = towerMod.getTowerRuntimeStats(tower);
    const range = towerStats.range;
    const angle = tower.attackAngle || 0;
    const halfAngle = towerMod.getSectorHalfAngle(tower);
    
    let closestTarget = null;
    let closestDist = Infinity;
    
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      const dx = enemy.x - tower.x;
      const dy = enemy.y - tower.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist > range) continue;
      
      const enemyAngle = Math.atan2(dy, dx);
      let angleDiff = enemyAngle - angle;
      // 规范化角度差到 [-PI, PI]
      while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
      while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
      
      if (Math.abs(angleDiff) <= halfAngle && dist < closestDist) {
        closestTarget = enemy;
        closestDist = dist;
      }
    }
    
    return !!closestTarget;
  }

  /**
   * 扇塔：单次 AOE 攻击
   * 发射瞬间对扇形范围内的所有敌人一次性结算伤害（单段，不扫掠多次）
   * 弹道仅作视觉表现
   */
  fireSectorAOE(tower) {
    const towerStats = towerMod.getTowerRuntimeStats(tower);
    const damage = this.towerDamage(tower, towerStats.damage);
    
    const range = towerStats.range;
    const angle = tower.attackAngle || 0;
    const halfAngle = towerMod.getSectorHalfAngle(tower);
    
    // 对扇形内所有存活敌人一次性结算伤害
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      
      const dx = enemy.x - tower.x;
      const dy = enemy.y - tower.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > range) continue;
      
      const enemyAngle = Math.atan2(dy, dx);
      let angleDiff = enemyAngle - angle;
      while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
      while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
      
      if (Math.abs(angleDiff) <= halfAngle) {
        // 统一结算：暴击 + 护甲/穿透 + 事件 + 击杀（AOE 每只怪独立 roll 暴击）
        this.applyDamage(tower, enemy, damage);
      }
    }
    
    // 纯视觉弹道（伤害已结算，不再参与命中判定）
    this.projectiles.push({
      x: tower.x,
      y: tower.y,
      angle: angle,
      range: range,
      halfAngle: halfAngle,
      speed: 400,
      damage: 0,
      type: 'sector',
      color: '#FFFF44',
      alive: true,
      progress: 0, // 0~1，弹道延伸进度（仅视觉）
    });
  }

  /**
   * 圆塔：爆炸弹道
   */
  fireExplosiveProjectile(tower, target) {
    const towerDef = TOWER_DEFS[tower.type];
    const towerStats = towerMod.getTowerRuntimeStats(tower);
    const damage = this.towerDamage(tower, towerStats.damage);
    
    const dx = target.x - tower.x;
    const dy = target.y - tower.y;
    const angle = Math.atan2(dy, dx);
    
    this.projectiles.push({
      x: tower.x,
      y: tower.y,
      targetX: target.x,
      targetY: target.y,
      targetType: target,
      sourceTower: tower,
      speed: 250,
      color: towerDef.color,
      type: 'circle',
      damage: damage,
      isExplosive: true,
      radius: 0,
      maxRadius: 60,
      alive: true,
      angle: angle,
      phase: 'flying', // 阶段：flying(飞行中) -> expanding(爆炸扩散中) -> dying(消散中)
      expandProgress: 0, // 爆炸扩散进度
      dyingProgress: 0, // 消散进度
    });
    
    tower.attackAngle = angle;
  }

  /**
   * 创建爆炸效果
   * @param {object} [sourceTower] 伤害来源塔（用于护甲/穿透结算；null = 环境伤害）
   */
  fireExplosion(x, y, maxRadius, color, splashDamage, sourceTower) {
    this.effects.push({
      type: 'explosion',
      x: x,
      y: y,
      radius: 0,
      maxRadius: maxRadius || 60,
      color: color || '#4444FF',
      life: 0.4,
      maxLife: 0.4,
      isExplosive: true,
      splashDamage: splashDamage || 0,
      hitEnemies: new Set(),
    });
    
    // 命中时立即触发二段爆炸伤害
    this.applyExplosionDamage(x, y, maxRadius || 60, splashDamage || 0, sourceTower);
  }

  /**
   * 应用爆炸溅射伤害（溅射不暴击，但同样吃护甲/穿透）
   */
  applyExplosionDamage(x, y, radius, splashDamage, sourceTower) {
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      
      const dx = enemy.x - x;
      const dy = enemy.y - y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist <= radius) {
        const src = sourceTower || { type: 'explosion', x: x, y: y };
        this.applyDamage(sourceTower || null, enemy, splashDamage, {
          allowCrit: false,
          source: src,
        });
      }
    }
  }

  /**
   * 更新爆炸效果（仅视觉显示，伤害已在命中时触发）
   */
  updateExplosions(dt) {
    // 不再处理二段伤害，伤害在 fireExplosion 中立即触发
  }

  updateProjectiles(dt) {
    for (const proj of this.projectiles) {
      if (!proj.alive) continue;

      // 处理爆炸弹道
      if (proj.isExplosive) {
        // 飞行中
        const dx = proj.targetX - proj.x;
        const dy = proj.targetY - proj.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist < 5) {
          // 命中目标，造成伤害
          const target = proj.targetType;
          if (target && target.alive) {
            this.applyDamage(proj.sourceTower || null, target, proj.damage, { source: proj });
          }
          // 创建爆炸效果（无论目标是否死亡）
          // 爆炸半径与溅射比例由 tower.js 统一给出（圆塔强化"爆炸范围 / 二段爆炸伤害"在此生效）
          const boom = towerMod.getExplosionParams(proj.sourceTower || { type: 'circle' });
          this.fireExplosion(proj.targetX, proj.targetY, boom.radius, '#4444FF',
            Math.floor(proj.damage * boom.ratio), proj.sourceTower);
          proj.alive = false;
          continue;
        }
        
        // 继续飞行
        const moveDist = proj.speed * dt;
        proj.x += (dx / dist) * moveDist;
        proj.y += (dy / dist) * moveDist;
        continue;
      }

      // 处理扇形弹道（纯视觉，伤害已在 fireSectorAOE 中一次性结算）
      if (proj.type === 'sector') {
        proj.progress += dt * 1.5; // 弹道延伸速度
        
        if (proj.progress >= 1) {
          proj.alive = false;
          continue;
        }
        
        // 记录扇形弹道效果
        const currentRange = proj.range * proj.progress;
        this.effects.push({
          type: 'sector',
          x: proj.x,
          y: proj.y,
          angle: proj.angle,
          range: currentRange,
          color: '#FFFF44',
          life: 0.25,
          maxLife: 0.25,
        });
        continue;
      }

      // 处理正方塔弹道：旋转弹道直线冲锋
      if (proj.type === 'square') {
        // 旋转弹道自身
        proj.rotationAngle += dt * 8; // 每秒旋转8弧度
        
        // 沿冲锋方向移动
        proj.x += Math.cos(proj.angle) * proj.speed * dt;
        proj.y += Math.sin(proj.angle) * proj.speed * dt;
        
        // 检查是否出屏幕（用逻辑视口尺寸：this.W/H，不是物理像素的 canvas 尺寸）
        const w = this.W;
        const h = this.H;
        if (proj.x < -50 || proj.x > w + 50 || proj.y < -50 || proj.y > h + 50) {
          proj.alive = false;
          continue;
        }
        
        // 检测对路径上的敌人造成伤害
        for (const enemy of this.enemies) {
          if (!enemy.alive) continue;
          if (proj.hitEnemies.has(enemy)) continue;
          
          const dx = enemy.x - proj.x;
          const dy = enemy.y - proj.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          
          if (dist < proj.size / 2 + enemy.size / 2) {
            // 造成伤害：走统一结算入口（暴击 + 穿透 + 抗性减伤）
            this.applyDamage(proj.sourceTower, enemy, proj.damage, { source: proj });
            proj.hitEnemies.add(enemy);
            break;
          }
        }
        
        continue;
      }

      // 计算移动方向
      const dx = proj.targetX - proj.x;
      const dy = proj.targetY - proj.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // 如果弹道已经到达目标位置
      if (dist < 5) {
        proj.alive = false;
        // 造成伤害：走统一结算入口（暴击 + 穿透 + 抗性减伤）
        const target = proj.targetType;
        if (target && target.alive) {
          this.applyDamage(proj.sourceTower || null, target, proj.damage, { source: proj });
        }
        continue;
      }

      // 移动弹道
      const moveDist = proj.speed * dt;
      proj.x += (dx / dist) * moveDist;
      proj.y += (dy / dist) * moveDist;
    }

    // 清理已死亡的弹道
    this.projectiles = this.projectiles.filter(p => p.alive);
  }

  /**
   * 根据怪物类型扣分
   */
  applyPenaltyByEnemyType(enemy) {
    switch (enemy.type) {
      case 'normal':
        this.lives -= 2;
        break;
      case 'fast':
        this.lives -= 5;
        break;
      case 'heavy':
      case 'elite':
        this.lives -= 20;
        break;
      case 'boss':
        this.lives -= 50;
        break;
      case 'finalBoss':
        // 最终BOSS直接判负
        this.lives = 0;
        break;
    }
  }

  findTarget(tower) {
    let closest = null;
    let closestDist = Infinity;
    const range = (towerMod.getTowerRuntimeStats(tower).range) || 200;

    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      const dx = enemy.x - tower.x;
      const dy = enemy.y - tower.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= range && dist < closestDist) {
        closest = enemy;
        closestDist = dist;
      }
    }

    return closest;
  }

  /**
   * 结算界面此刻是否"真的会显示"。
   *
   * ⚠️ 这是渲染层与输入层必须共用的**唯一判据**：
   *   - 渲染层 renderer.render 只在 scene==='battle' 时画结算；
   *   - 而 drawGameOver 内部又要求 gameWon 或 lives<=0 才画。
   * 只要输入层（吞触摸）用的条件比这个宽，就会出现：
   *   渲染层什么都不画、输入层却把所有触摸吃光 → 屏幕看着正常但整块点不动。
   *
   * 之前 input.js 只判 `gameOver`，比这里宽一档，
   * 于是 "gameOver 但 gameWon=false 且 lives>0" 这个错配态就是永久死锁。
   * 现在三层（渲染 / 触摸开始 / 触摸结束）统一问这一个方法。
   */
  isSettlementActive() {
    if (!this.gameOver) return false;
    if (this.scene !== 'battle') return false;
    return !!this.gameWon || this.lives <= 0;
  }

  /**
   * 把 ctx 的变换复位为「1 逻辑像素 = renderScale 物理像素」。
   *
   * 画布本身是按物理像素建的（renderScale 倍大），所以这里必须做一次反向缩放，
   * 之后所有绘制仍按**逻辑坐标**（= game.W/H = 触摸坐标）来 —— 布局与命中判定
   * 的口径一行都没变，只是每个逻辑像素由 renderScale² 个物理像素来画。
   *
   * ⚠️ 为什么每帧都要 setTransform，而不是启动时 scale 一次：
   *    一次 scale 依赖全项目几十处 save/restore 全都配对。只要有一处不配对
   *    （或某帧中途抛异常），变换就会顺着帧往下累积 —— 画面越画越大、越画越偏，
   *    而且极难定位。每帧**直接复位**是唯一不会漂的写法（成本就一次调用）。
   */
  applyViewScale() {
    const ctx = this.ctx;
    if (!ctx) return;
    const s = (this.renderScale > 0) ? this.renderScale : 1;

    if (typeof ctx.setTransform === 'function') {
      ctx.setTransform(s, 0, 0, s, 0, 0);
      return;
    }
    // 兜底：没有 setTransform 的老环境，用 resetTransform 复位后再 scale
    if (typeof ctx.resetTransform === 'function') {
      ctx.resetTransform();
      if (s !== 1 && typeof ctx.scale === 'function') ctx.scale(s, s);
      return;
    }
    // 两个都没有（极老基础库 / 精简 mock）：只能开场 scale 一次，
    // 靠 save/restore 配对维持。画质退回 1 倍，但绝不抛错、绝不冻屏。
    if (!this._viewScaleApplied) {
      this._viewScaleApplied = true;
      if (s !== 1 && typeof ctx.scale === 'function') ctx.scale(s, s);
    }
  }

  draw() {
    // 每帧先复位坐标系（见 applyViewScale），再画。
    this.applyViewScale();
    renderer.render(this);
  }

  loop() {
    const now = Date.now();
    const deltaTime = (now - this.lastTime) / 1000;
    this.lastTime = now;

    const dt = Math.min(deltaTime, 0.1);

    // 帧计数：只用来区分"首帧就炸"和"后面某帧炸"。
    // 首帧就抛异常 = 屏幕上连一个像素都没有 → 真机表现是「卡在原生启动页」，
    // 而不是"界面点不动"（后者通常发生在已出画面之后）。
    this._frameCount = (this._frameCount || 0) + 1;

    // ⚠️ update()/draw() 必须被 try 包住。
    // 旧实现在这里裸跑：任何一帧抛异常都会穿过 rAF 回调，导致下面那行
    // requestAnimationFrame 永远不再执行 —— 主循环彻底停摆。
    // 表现就是"画面定格 + 所有动画/按压反馈/波纹消失 = 整个界面点不动"，
    // 而且日志里只会看到一次异常，很难和生产事故对上号。
    try {
      // 游戏进行中 + 停留在战斗场景 + 已点过「开始游戏」+ 没开着菜单 → 正常逻辑更新
      // （战前选关界面 / 游戏中菜单 / 切到图签天赋 都冻结世界，回来接着打）
      if (this.isRunning && this.scene === 'battle' && this.battleStarted && !this.showMenu) {
        this.update(dt);
      } else if (this.watchingVideo) {
        // 结算界面观看视频：世界冻结，仅推进视频倒计时
        this.videoTimer -= dt;
        if (this.videoTimer <= 0) {
          this.onVideoComplete();
        }
      }

      // 不变式修复：gameOver 一旦置位，就必须落在"结算界面真的会显示"的
      // 两种自洽状态里（胜利 / 生存积分归零）。否则渲染层什么都不画，
      // 而输入层若只按 gameOver 吞触摸 → 整块点不动。
      // 现在输入层也改问 isSettlementActive()，所以这里只是兜底双保险。
      if (this.gameOver && !this.gameWon && this.lives > 0) {
        this.gameOver = false;
        this.isRunning = true;
      }

      // 始终渲染：结算界面按钮按压/点击动画、拖拽预览等都需要持续帧
      this.draw();
    } catch (err) {
      // 单帧异常不杀死主循环：记录一次（避免刷屏）然后继续下一帧。
      // 这样即使某个绘制分支炸了，界面依旧是活的（还能点、还能切场景），
      // 而不是整块卡死让玩家彻底没法操作。
      //
      // ⚠️ 但首帧异常的性质完全不同：一个像素都没画出去 → 真机上表现为
      //    「一直卡在原生启动页」。所以首帧单独喊一嗓子，别让它和
      //    "后面某帧抽风"混在同一条不痛不痒的日志里。
      const firstFrame = this._frameCount <= 1;
      if (firstFrame || !this._loopErrorLogged) {
        this._loopErrorLogged = true;
        if (firstFrame) {
          console.error('[loop] 💀 首帧绘制失败 —— 屏幕上不会有任何画面（真机上表现为「卡在原生启动页」）:',
            err && err.stack ? err.stack : err);
        } else {
          console.error('[loop] 帧异常（已忽略，主循环继续）:', err && err.stack ? err.stack : err);
        }
      }
    }

    // 永远在 try 之外重新排帧：保证主循环不可能因为一次异常而断链
    requestAnimationFrame(() => this.loop());
  }
}

module.exports = Game;
