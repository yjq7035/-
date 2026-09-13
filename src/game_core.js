// 游戏核心：Game 类，协调各功能模块。
// 原单文件 game.js 中的 Game 类拆出数据/几何/敌人/波次/塔/渲染/输入后，
// 这里只保留：状态、路径与槽位计算、波次调度、主循环、事件绑定。
const config = require('./config');
const enemyMod = require('./enemy');
const waveMod = require('./wave');
const renderer = require('./renderer');
const input = require('./input');
const towerMod = require('./tower');
const EventBus = require('./eventBus');

const { LAYOUT, BALANCE, TOWER_DEFS, SHOP_TOWERS } = config;

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
    this.selectedTowerType = null;
    this.selectedTower = null;

    // 游戏对象
    this.enemies = [];
    this.towers = [];
    this.effects = [];
    // 弹道系统
    this.projectiles = []; // 弹道系统

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

    // 关键槽位位置（外围）
    const slot1LeftTop = { x: startX, y: startY };
    const slot4LeftBottom = { x: startX, y: startY + slotSize + gap };
    const slot6RightBottom = { x: startX + (slotSize + gap) * 2 + slotSize, y: startY + (slotSize + gap) * 1 + slotSize };
    const slot3RightTop = { x: startX + (slotSize + gap) * 2, y: startY };

    const padding = LAYOUT.pathPadding; // 外围偏移

    // H型路径：1槽左上外围 → 4槽左下外围 → 6槽右下外围 → 3槽右上外围（与起点同Y）
    this.pathPoints = [
      { x: slot1LeftTop.x - padding, y: slot1LeftTop.y - padding },
      { x: slot4LeftBottom.x - padding, y: slot4LeftBottom.y + slotSize + padding },
      { x: slot6RightBottom.x + padding, y: slot6RightBottom.y + padding },
      { x: slot3RightTop.x + slotSize + padding, y: slot1LeftTop.y - padding },
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
    // 重置商店槽状态（所有槽恢复为非空）
    this.shopSlotState = SHOP_TOWERS.map((type) => ({
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
    this.canvas.addEventListener('touchstart', (e) => input.handleTouchStart(this, e));
    this.canvas.addEventListener('touchmove', (e) => input.handleTouchMove(this, e));
    this.canvas.addEventListener('touchend', (e) => input.handleTouchEnd(this, e));
  }

  startNextWave() {
    this.currentWave++;
    this.enemiesToSpawn = waveMod.generateWave(this.currentWave);
    this.spawnTimer = 0;
    this.waveInProgress = true;
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
      if (reached) this.lives--;
    }

    this.enemies = this.enemies.filter((e) => e.alive);

    // 更新塔的攻击
      this.updateTowers(deltaTime);

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
    if (this.lives <= 0) {
      this.isRunning = false;
    }
  }

  updateTowers(dt) {
    for (const tower of this.towers) {
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
          
          if (dist > 200) {
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
          tower.attackTimer = 2.0; // 间隔2.0秒
          this.fireSectorProjectile(tower);
        }
        continue;
      }

      // 圆塔：爆炸溅射
      if (tower.type === 'circle') {
        if (nearestTarget) {
          tower.attackTimer = 0.8;
          this.fireExplosiveProjectile(tower, nearestTarget);
          continue;
        }
      }

      // 正方塔：旋转弹道直线冲锋
      if (tower.type === 'square') {
        if (nearestTarget) {
          tower.attackTimer = 1.0; // 间隔1.0秒
          this.fireSquareProjectile(tower, nearestTarget);
        }
        continue;
      }

      // 普通塔：单体攻击
      if (nearestTarget) {
        const towerStats = renderer.getTowerStats(tower.type);
        tower.attackTimer = towerStats.attackSpeed;
        this.fireProjectile(tower, nearestTarget);
      }
    }
  }

  fireProjectile(tower, target) {
    const towerDef = TOWER_DEFS[tower.type];
    const towerStats = renderer.getTowerStats(tower.type);
    const attackBonus = towerMod.getLevelAttackBonus(tower.level);
    const damage = Math.floor(towerStats.damage * attackBonus);
    
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
    const attackBonus = towerMod.getLevelAttackBonus(tower.level);
    const damage = Math.floor(towerStats.damage * attackBonus);
    
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
    const attackBonus = towerMod.getLevelAttackBonus(tower.level);
    const towerDamage = towerStats.damage * attackBonus;
    
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
   * 扇塔：发射扇形弹道
   */
  fireSectorProjectile(tower) {
    const towerStats = renderer.getTowerStats(tower.type);
    const attackBonus = towerMod.getLevelAttackBonus(tower.level);
    const damage = Math.floor(towerStats.damage * attackBonus);
    
    const angle = tower.attackAngle || 0;
    
    this.projectiles.push({
      x: tower.x,
      y: tower.y,
      angle: angle,
      range: towerStats.range,
      halfAngle: Math.PI / 4, // 45度扇形
      speed: 400,
      damage: damage,
      type: 'sector',
      color: '#FFFF44',
      alive: true,
      progress: 0, // 0~1，弹道延伸进度
      hitEnemy: null, // 已命中的敌人，避免重复伤害
    });
  }

  /**
   * 圆塔：爆炸弹道
   */
  fireExplosiveProjectile(tower, target) {
    const towerDef = TOWER_DEFS[tower.type];
    const towerStats = renderer.getTowerStats(tower.type);
    const attackBonus = towerMod.getLevelAttackBonus(tower.level);
    const damage = Math.floor(towerStats.damage * attackBonus);
    
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

      // 处理扇形弹道
      if (proj.type === 'sector') {
        proj.progress += dt * 1.5; // 弹道延伸速度
        
        if (proj.progress >= 1) {
          proj.alive = false;
          continue;
        }
        
        // 计算弹道当前末端位置
        const currentRange = proj.range * proj.progress;
        const endX = proj.x + Math.cos(proj.angle) * currentRange;
        const endY = proj.y + Math.sin(proj.angle) * currentRange;
        
        // 检测扇形范围内是否有敌人被命中
        for (const enemy of this.enemies) {
          if (!enemy.alive) continue;
          if (proj.hitEnemy && proj.hitEnemy === enemy) continue;
          
          const dx = enemy.x - proj.x;
          const dy = enemy.y - proj.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          
          if (dist > currentRange) continue;
          
          const enemyAngle = Math.atan2(dy, dx);
          let angleDiff = enemyAngle - proj.angle;
          while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
          while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
          
          if (Math.abs(angleDiff) <= proj.halfAngle) {
            // 命中敌人
            // 触发命中事件
            this.triggerHit(enemy, proj, proj.damage);
            // 触发伤害事件
            this.triggerDamage(proj, proj.damage, enemy);
            
            enemy.hp -= proj.damage;
            proj.hitEnemy = enemy;
            
            if (enemy.hp <= 0) {
              enemy.alive = false;
              this.gold += enemy.reward;
              // 触发死亡事件
              this.triggerDeath(enemy, proj);
            }
            
            // 命中后停止弹道延伸，显示命中效果
            if (dist < currentRange * 0.8) {
              proj.alive = false;
            }
            break;
          }
        }
        
        // 记录扇形弹道效果
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

  findTarget(tower) {
    let closest = null;
    let closestDist = Infinity;

    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      const dx = enemy.x - tower.x;
      const dy = enemy.y - tower.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // 攻击范围 200 (已增加100%)
      if (dist <= 200 && dist < closestDist) {
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
