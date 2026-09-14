// 游戏核心：Game 类，协调各功能模块。
// 原单文件 game.js 中的 Game 类拆出数据/几何/敌人/波次/塔/渲染/输入后，
// 这里只保留：状态、路径与槽位计算、波次调度、主循环、事件绑定。
const config = require('./config');
const enemyMod = require('./enemy');
const waveMod = require('./wave');
const renderer = require('./renderer');
const input = require('./input');
const towerMod = require('./tower');
const units = require('./units');
const EventBus = require('./eventBus');
const AuraManager = require('./auraManager');

const { LAYOUT, BALANCE, TOWER_DEFS, PLAYER, ATTACK_SPEED_BASE } = config;

class Game {
  constructor(canvas, ctx, windowInfo) {
    this.canvas = canvas;
    this.ctx = ctx;

    const w = windowInfo.screenWidth;
    const h = windowInfo.screenHeight;

    // 缩小战斗区域，Y向下偏移100像素
    this.mapX = w * 0.15;
    this.mapY = h * 0.12 + 25;
    this.mapWidth = w * 0.7;
    this.mapHeight = h * 0.58;

    // 游戏状态
    this.gold = BALANCE.startGold;
    this.lives = BALANCE.startLives;
    this.maxLives = BALANCE.startLives; // 生存积分上限（进度条分母）
    this.selectedTowerType = null;
    this.selectedTower = null;

    // 游戏结束状态
    this.gameOver = false;
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

    // 光环管理器
    this.auraManager = new AuraManager();

    // 属性面板状态
    this.showPanel = false;
    this.panelTowerType = null;

    // 商店槽状态（记录哪些槽被拖走了，需要显示为空）
    // 初始化为与 refreshTowerTypes 对应的状态
    this.shopSlotState = [];
    for (let i = 0; i < this.refreshTowerTypes.length; i++) {
      this.shopSlotState.push({
        type: this.refreshTowerTypes[i],
        empty: false,
      });
    }

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

  initRefresh() {
    // 初始刷新 3 个不重复的塔
    const towerTypes = Object.keys(TOWER_DEFS);
    const shuffled = towerTypes.sort(() => Math.random() - 0.5);
    this.refreshTowerTypes = shuffled.slice(0, 3);
  }

  refreshTowers() {
    if (this.gold < this.refreshCost) return;
    this.gold -= this.refreshCost;
    // 从可用塔池随机挑选3种不重复的塔
    const towerTypes = Object.keys(TOWER_DEFS);
    const shuffled = towerTypes.sort(() => Math.random() - 0.5);
    this.refreshTowerTypes = shuffled.slice(0, 3);
    // 重置商店槽状态（与当前展示的 refreshTowerTypes 一一对应，避免索引错位）
    this.shopSlotState = this.refreshTowerTypes.map((type) => ({
      type: type,
      empty: false,
    }));
    // 增加下次刷新所需金币
    this.refreshCost += BALANCE.refreshCostStep;
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
      wx.onTouchStart(onTouchStart);
      wx.onTouchMove(onTouchMove);
      wx.onTouchEnd(onTouchEnd);
      wx.onTouchCancel(onTouchEnd);
    } else {
      // 浏览器调试环境兜底
      this.canvas.addEventListener('touchstart', onTouchStart);
      this.canvas.addEventListener('touchmove', onTouchMove, { passive: false });
      this.canvas.addEventListener('touchend', onTouchEnd);
      this.canvas.addEventListener('touchcancel', onTouchEnd);
      // 同时监听 document 防止手指拖出 canvas
      document.addEventListener('touchmove', onTouchMove, { passive: false });
      document.addEventListener('touchend', onTouchEnd);
      document.addEventListener('touchcancel', onTouchEnd);
    }
  }

  startNextWave() {
    this.currentWave++;
    this.enemiesToSpawn = waveMod.generateWave(this.currentWave);
    this.spawnTimer = 0;
    this.waveInProgress = true;
  }

  /**
   * 重新开始：重置所有数据
   */
  restart() {
    // 恢复运行
    this.isRunning = true;
    this.gameOver = false;
    this.watchingVideo = false;
    this.videoTimer = 30;

    // 恢复游戏状态
    this.gold = BALANCE.startGold;
    this.lives = BALANCE.startLives;
    this.maxLives = BALANCE.startLives;

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

    // 重置槽位
    this.slots = this.calculateSlots();

    // 重置商店
    this.refreshCost = BALANCE.refreshCost;
    this.refreshTowerTypes = [];
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

    // 重置商店槽状态
    this.shopSlotState = [];
    for (let i = 0; i < this.refreshTowerTypes.length; i++) {
      this.shopSlotState.push({
        type: this.refreshTowerTypes[i],
        empty: false,
      });
    }

    // 重新开始游戏循环
    this.loop();
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

    // 恢复当前波次
    this.enemiesToSpawn = waveMod.generateWave(this.currentWave);
    this.spawnTimer = 0;
    this.waveInProgress = true;

    // 获得当前波次 * 500 金币
    this.gold += this.currentWave * 500;

    // 重置倒计时
    this.waitTimer = this.waitDuration;
  }


  update(deltaTime) {
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
        this.enemies.push(enemy);
        this.spawnTimer = this.spawnInterval;
      }

      if (this.enemiesToSpawn.length === 0 && this.enemies.length === 0) {
        this.waveInProgress = false;
        this.waitTimer = this.waitDuration;
        this.countdownText = '';
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
    }

    // 视频倒计时
    if (this.watchingVideo) {
      this.videoTimer -= deltaTime;
      if (this.videoTimer <= 0) {
        this.onVideoComplete();
      }
    }
  }

  updateTowers(dt) {
    // 每帧开始时重置光环管理器的重置列表
    this.auraManager.resetFrame();

    for (const tower of this.towers) {
      // 辅助塔（梯塔）不攻击
      if (tower.isSupport) {
        continue;
      }

      // 通过光环管理器获取带光环加成的攻击速度
      const stats = renderer.getTowerStats(tower.type);
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
          // 基础攻击间隔 2.0秒，应用攻击速度乘数（使用光环管理器计算）
          const effectiveInterval = 2.0 / (effectiveAttackSpeed / 100);
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
          const effectiveInterval = 1.0 / (effectiveAttackSpeed / 100);
          tower.attackTimer = effectiveInterval;
          this.fireSquareProjectile(tower, nearestTarget);
        }
        continue;
      }

      // 普通塔：单体攻击
      if (nearestTarget) {
        // 长方塔：堆叠伤害机制
        if (tower.type === 'long_rectangle') {
          const towerStats = renderer.getTowerStats(tower.type);
          // 检查目标是否切换或堆叠已过期
          if (tower.lockedTarget !== nearestTarget || tower.stackTimer <= 0) {
            // 切换目标或堆叠过期 → 重置
            tower.stackCount = 0;
            tower.stackTarget = null;
            tower.stackTimer = 5.0; // 新目标开始5秒计时
          }
          
          // 攻击时增加堆叠层数（最多10层）
          tower.stackCount = Math.min(tower.stackCount + 1, 10);
          
          // 堆叠伤害计算：配置基础攻击力 + 层数加成，应用攻击增幅
          const baseDamage = towerMod.calculateFinalDamage(towerStats.damage, tower.level, tower.attackPowerBoost);
          const stackBonus = tower.stackCount * 2;
          const totalDamage = baseDamage + stackBonus;
          
          // 攻击间隔取配置中的 attackInterval
          const effectiveInterval = towerStats.attackInterval / (effectiveAttackSpeed / 100);
          tower.attackTimer = effectiveInterval;
          this.fireProjectile(tower, nearestTarget, totalDamage);
          continue;
        }
        
        // 六边塔：对精英级以上怪物伤害×5，应用攻击增幅
        if (tower.type === 'hexagon' && nearestTarget.tier >= 3) {
          const towerStats = renderer.getTowerStats(tower.type);
          const totalDamage = towerMod.calculateFinalDamage(towerStats.damage, tower.level, tower.attackPowerBoost) * 5;
          
          const effectiveInterval = 1.2 / (effectiveAttackSpeed / 100);
          tower.attackTimer = effectiveInterval;
          this.fireProjectile(tower, nearestTarget, totalDamage);
          continue;
        }
        
        // 普通塔正常伤害计算，使用配置中的 attackInterval
        const towerStats = renderer.getTowerStats(tower.type);
        const effectiveInterval = towerStats.attackInterval / (effectiveAttackSpeed / 100);
        tower.attackTimer = effectiveInterval;
        this.fireProjectile(tower, nearestTarget);
      }
    }
  }

  /**
   * 应用梯塔光环效果：遍历所有梯塔，给周围我方塔增加攻击速度
   * 使用光环管理器控制持续时间（3秒）
   */
  applyTrapezoidAuras() {
    for (const tower of this.towers) {
      if (!tower.isSupport) continue;

      const stats = renderer.getTowerStats(tower.type);
      const range = stats.range || 150;
      const buff = stats.supportBuff || { attackSpeedMultiplier: 25 };
      
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
          // 在光环范围内，通过光环管理器应用加成
          // 首次赋予才施加实质属性，后续只更新持续时间
          this.auraManager.applyAura(tower.uniqueId, buff, other.uniqueId, ATTACK_SPEED_BASE);
        }
      }
    }
  }

  fireProjectile(tower, target, customDamage) {
    const towerDef = TOWER_DEFS[tower.type];
    const towerStats = renderer.getTowerStats(tower.type);
    
    // 使用 tower.js 中的 calculateFinalDamage 计算最终攻击力
    let damage;
    if (customDamage !== undefined) {
      // 自定义伤害（如长方塔堆叠）
      damage = customDamage;
    } else {
      damage = towerMod.calculateFinalDamage(towerStats.damage, tower.level, tower.attackPowerBoost);
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
    const towerStats = renderer.getTowerStats(tower.type);
    const damage = towerMod.calculateFinalDamage(towerStats.damage, tower.level, tower.attackPowerBoost);
    
    // 计算从塔到目标的方向
    const dx = target.x - tower.x;
    const dy = target.y - tower.y;
    const angle = Math.atan2(dy, dx);
    
    this.projectiles.push({
      x: tower.x,
      y: tower.y,
      angle: angle, // 冲锋方向
      rotationAngle: 0, // 弹道自身旋转角度
      speed: 500, // 冲锋速度
      damage: damage,
      type: 'square',
      color: towerDef.color,
      size: 20, // 弹道大小
      alive: true,
      hitEnemies: new Set(), // 已造成伤害的敌人，避免重复伤害
    });
    
    tower.attackAngle = angle;
  }

  /**
   * 半圆塔：激光攻击（持续直连线条）
   */
  fireLaser(tower, target, dt) {
    const towerStats = renderer.getTowerStats(tower.type);
    const towerDamage = towerMod.calculateFinalDamage(towerStats.damage, tower.level, tower.attackPowerBoost);
    
    // 每秒伤害 = 塔攻击力，按时间比例计算单帧伤害
    const damage = Math.max(1, Math.floor(towerDamage * dt));
    
    // 直接造成伤害（激光持续命中）
    if (target && target.alive) {
      // 触发命中事件
      this.triggerHit(target, tower, damage);
      // 触发伤害事件
      this.triggerDamage(tower, damage, target);
      
      target.hp -= damage;
      if (target.hp <= 0) {
          target.alive = false;
          this.gold += target.reward;
          // 从单位注册表移除
          units.removeUnit(target.uniqueId);
          // 触发死亡事件
          this.triggerDeath(target, tower);
        }
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
   */
  findSectorTarget(tower) {
    const towerStats = renderer.getTowerStats(tower.type);
    const range = towerStats.range;
    const angle = tower.attackAngle || 0;
    const halfAngle = Math.PI / 4; // 45度扇形
    
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
    const towerStats = renderer.getTowerStats(tower.type);
    const damage = towerMod.calculateFinalDamage(towerStats.damage, tower.level, tower.attackPowerBoost);
    
    const range = towerStats.range;
    const angle = tower.attackAngle || 0;
    const halfAngle = Math.PI / 4; // 45度扇形
    
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
        // 触发命中事件
        this.triggerHit(enemy, tower, damage);
        // 触发伤害事件
        this.triggerDamage(tower, damage, enemy);
        
        enemy.hp -= damage;
        if (enemy.hp <= 0) {
          enemy.alive = false;
          this.gold += enemy.reward;
          // 从单位注册表移除
          units.removeUnit(enemy.uniqueId);
          // 触发死亡事件
          this.triggerDeath(enemy, tower);
        }
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
    const towerStats = renderer.getTowerStats(tower.type);
    const damage = towerMod.calculateFinalDamage(towerStats.damage, tower.level, tower.attackPowerBoost);
    
    const dx = target.x - tower.x;
    const dy = target.y - tower.y;
    const angle = Math.atan2(dy, dx);
    
    this.projectiles.push({
      x: tower.x,
      y: tower.y,
      targetX: target.x,
      targetY: target.y,
      targetType: target,
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
   */
  fireExplosion(x, y, maxRadius, color, splashDamage) {
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
    this.applyExplosionDamage(x, y, maxRadius || 60, splashDamage || 0);
  }

  /**
   * 应用爆炸溅射伤害
   */
  applyExplosionDamage(x, y, radius, splashDamage) {
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      
      const dx = enemy.x - x;
      const dy = enemy.y - y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist <= radius) {
        // 触发命中事件（爆炸作为伤害来源）
        this.triggerHit(enemy, { type: 'explosion', x: x, y: y }, splashDamage);
        // 触发伤害事件
        this.triggerDamage({ type: 'explosion', x: x, y: y }, splashDamage, enemy);
        
        enemy.hp -= splashDamage;
        
        if (enemy.hp <= 0) {
          enemy.alive = false;
          this.gold += enemy.reward;
          // 从单位注册表移除
          units.removeUnit(enemy.uniqueId);
          // 触发死亡事件（爆炸作为击杀者）
          this.triggerDeath(enemy, { type: 'explosion', x: x, y: y });
        }
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
            // 触发命中事件
            this.triggerHit(target, proj, proj.damage);
            // 触发伤害事件
            this.triggerDamage(proj, proj.damage, target);
            
            target.hp -= proj.damage;
            if (target.hp <= 0) {
              target.alive = false;
              this.gold += target.reward;
              // 从单位注册表移除
              units.removeUnit(target.uniqueId);
              // 触发死亡事件
              this.triggerDeath(target, proj);
            }
          }
          // 创建爆炸效果（无论目标是否死亡）
          this.fireExplosion(proj.targetX, proj.targetY, 60, '#4444FF', Math.floor(proj.damage * 0.25));
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
        
        // 检查是否出屏幕（使用 canvas 尺寸）
        const w = this.canvas.width;
        const h = this.canvas.height;
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
            // 造成伤害
            // 触发命中事件
            this.triggerHit(enemy, proj, proj.damage);
            // 触发伤害事件
            this.triggerDamage(proj, proj.damage, enemy);
            
            enemy.hp -= proj.damage;
            proj.hitEnemies.add(enemy);
            
            if (enemy.hp <= 0) {
              enemy.alive = false;
              this.gold += enemy.reward;
              // 从单位注册表移除
              units.removeUnit(enemy.uniqueId);
              // 触发死亡事件
              this.triggerDeath(enemy, proj);
            }
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
        // 造成伤害
        const target = proj.targetType;
        if (target && target.alive) {
          // 触发命中事件
          this.triggerHit(target, proj, proj.damage);
          // 触发伤害事件
          this.triggerDamage(proj, proj.damage, target);
          
          target.hp -= proj.damage;
          if (target.hp <= 0) {
            target.alive = false;
            this.gold += target.reward; // 获得金币奖励
            // 从单位注册表移除
            units.removeUnit(target.uniqueId);
            // 触发死亡事件
            this.triggerDeath(target, proj);
          }
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
    const range = (renderer.getTowerStats(tower.type).range) || 200;

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

  draw() {
    renderer.render(this);
  }

  loop() {
    if (!this.isRunning) return;

    const now = Date.now();
    const deltaTime = (now - this.lastTime) / 1000;
    this.lastTime = now;

    const dt = Math.min(deltaTime, 0.1);

    this.update(dt);
    this.draw();

    requestAnimationFrame(() => this.loop());
  }
}

module.exports = Game;
