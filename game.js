/**
 * 塔防游戏 - 入口文件
 */

// 兼容微信小程序和游戏环境
// 注意：canvas / ctx / windowInfo 延迟到 boot() 内初始化，
// 避免模块顶层同步调用 wx.* 时 jsbridge 尚未就绪（开发者工具启动竞态）
let canvas = null;
let ctx = null;
let windowInfo = null;

// 游戏主逻辑
class Game {
  constructor() {
    const w = windowInfo.screenWidth;
    const h = windowInfo.screenHeight;
    
    // 缩小战斗区域
    this.mapX = w * 0.15;
    this.mapY = h * 0.12;
    this.mapWidth = w * 0.7;
    this.mapHeight = h * 0.58;
    
    // 游戏状态
    this.gold = 200;
    this.lives = 20;
    this.selectedTowerType = null;
    this.selectedTower = null;
    
    // 游戏对象
    this.enemies = [];
    this.towers = [];
    this.effects = [];
    
    // 波次管理
    this.currentWave = 0;
    this.waveInProgress = false;
    this.waitTimer = 0;
    this.waitDuration = 5; // 首波5秒倒计时
    this.spawnTimer = 0;
    this.spawnInterval = 1.0; // 每秒刷新一只
    this.enemiesToSpawn = [];
    
    // 倒计时显示
    this.countdownText = '';
    
    // 时间管理
    this.lastTime = performance.now();
    this.isRunning = true;
    
    // 槽位位置（6个）
    this.slots = this.calculateSlots();
    
    // 塔刷新系统
    this.refreshCost = 100;
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
    
    // 开始游戏循环
    this.loop();
  }
  
  initPath() {
    const { mapX, mapY, mapWidth, mapHeight } = this;
    
    // 槽位位置计算
    const slotSize = 44;
    const gap = 10;
    const cols = 3;
    const rows = 2;
    const totalWidth = cols * slotSize + (cols - 1) * gap;
    const startX = mapX + (mapWidth - totalWidth) / 2;
    const totalHeight = rows * slotSize + (rows - 1) * gap;
    const startY = mapY + mapHeight - totalHeight - 10;
    
    // 关键槽位位置（外围）
    const slot1LeftTop = { x: startX, y: startY };
    const slot4LeftBottom = { x: startX, y: startY + slotSize + gap };
    const slot6RightBottom = { x: startX + (slotSize + gap) * 2 + slotSize, y: startY + (slotSize + gap) * 1 + slotSize };
    const slot3RightTop = { x: startX + (slotSize + gap) * 2, y: startY };
    
    const padding = 40; // 外围偏移
    
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
  
  getPathLength() {
    let total = 0;
    for (let i = 1; i < this.pathPoints.length; i++) {
      const dx = this.pathPoints[i].x - this.pathPoints[i - 1].x;
      const dy = this.pathPoints[i].y - this.pathPoints[i - 1].y;
      total += Math.sqrt(dx * dx + dy * dy);
    }
    return total;
  }
  
  getPathPosition(progress) {
    if (progress <= 0) return this.pathPoints[0];
    if (progress >= 1) return this.pathPoints[this.pathPoints.length - 1];
    
    const totalLength = this.getPathLength();
    const targetDistance = progress * totalLength;
    let accumulatedDistance = 0;
    
    for (let i = 1; i < this.pathPoints.length; i++) {
      const prev = this.pathPoints[i - 1];
      const curr = this.pathPoints[i];
      const segmentLength = Math.sqrt(
        (curr.x - prev.x) ** 2 + (curr.y - prev.y) ** 2
      );
      
      if (accumulatedDistance + segmentLength >= targetDistance) {
        const t = (targetDistance - accumulatedDistance) / segmentLength;
        return {
          x: prev.x + (curr.x - prev.x) * t,
          y: prev.y + (curr.y - prev.y) * t
        };
      }
      accumulatedDistance += segmentLength;
    }
    
    return this.pathPoints[this.pathPoints.length - 1];
  }
  
  initRefresh() {
    // 初始刷新3个塔
    const towerTypes = ['triangle', 'circle', 'hexagon', 'rectangle'];
    for (let i = 0; i < 3; i++) {
      const randomType = towerTypes[Math.floor(Math.random() * towerTypes.length)];
      this.refreshTowerTypes.push(randomType);
    }
  }
  
  refreshTowers() {
    if (this.gold < this.refreshCost) return;
    this.gold -= this.refreshCost;
    this.refreshTowerTypes = [];
    const towerTypes = ['triangle', 'circle', 'hexagon', 'rectangle'];
    for (let i = 0; i < 3; i++) {
      const randomType = towerTypes[Math.floor(Math.random() * towerTypes.length)];
      this.refreshTowerTypes.push(randomType);
    }
    this.refreshCost += 50;
  }
  
  calculateSlots() {
    // 6个槽位 2行3列
    const slotSize = 44;
    const gap = 10;
    const cols = 3;
    const rows = 2;
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
          tower: null
        });
      }
    }
    return slots;
  }
  
  initEvents() {
    canvas.addEventListener('touchstart', (e) => this.handleTouchStart(e));
    canvas.addEventListener('touchmove', (e) => this.handleTouchMove(e));
    canvas.addEventListener('touchend', (e) => this.handleTouchEnd(e));
  }

  /**
   * 取触摸坐标：
   * - 微信小游戏 Touch 对象是 clientX/clientY（没有 x/y）
   * - touchend 时 e.touches 已清空，需从 changedTouches 取当前触点
   */
  getTouchPos(e) {
    const t = (e.touches && e.touches[0]) ||
              (e.changedTouches && e.changedTouches[0]);
    if (!t) return { x: 0, y: 0 };
    return {
      x: (t.clientX !== undefined) ? t.clientX : t.x,
      y: (t.clientY !== undefined) ? t.clientY : t.y
    };
  }
  
  handleTouchStart(e) {
    const pos = this.getTouchPos(e);
    const height = canvas.height;
    
    // 检查是否正在拖放中
    if (this.dragging) return;
    
    // 检查是否点击了刷新按钮
    const towerTypes = [
      { type: 'triangle', name: '三角塔', color: '#FF4444', cost: 100 },
      { type: 'circle', name: '圆塔', color: '#4444FF', cost: 150 },
      { type: 'hexagon', name: '六边塔', color: '#44FF44', cost: 200 }
    ];
    const slotWidth = 72;
    const gap = 10;
    const totalWidth = towerTypes.length * slotWidth + (towerTypes.length - 1) * gap;
    const startX = (canvas.width - totalWidth) / 2;
    const btnX = startX + towerTypes.length * (slotWidth + gap) - 5;
    const btnY = height - 97;
    const btnW = 68;
    const btnH = 75;
    
    if (pos.x >= btnX && pos.x <= btnX + btnW && pos.y >= btnY && pos.y <= btnY + btnH) {
      this.refreshTowers();
      return;
    }
    
    // 检查是否点击了商城的塔
    for (let i = 0; i < towerTypes.length; i++) {
      const t = towerTypes[i];
      const x = startX + i * (slotWidth + gap);
      
      if (pos.x >= x && pos.x <= x + slotWidth && pos.y >= btnY && pos.y <= btnY + slotWidth) {
        // 只有金币足够才能拖放
        if (this.gold >= t.cost) {
          this.dragging = true;
          this.dragType = t.type;
          this.dragX = pos.x;
          this.dragY = pos.y;
        }
        return;
      }
    }
  }
  
  handleTouchMove(e) {
    if (!this.dragging) return;
    e.preventDefault();
    const pos = this.getTouchPos(e);
    this.dragX = pos.x;
    this.dragY = pos.y;
  }
  
  handleTouchEnd(e) {
    if (!this.dragging) return;
    
    const pos = this.getTouchPos(e);
    
    // 检查是否释放到了空槽位
    for (const slot of this.slots) {
      if (!slot.occupied &&
          pos.x >= slot.x && pos.x <= slot.x + slot.size &&
          pos.y >= slot.y && pos.y <= slot.y + slot.size) {
        
        // 检查金币是否足够
        const cost = this.getTowerCost(this.dragType);
        if (this.gold >= cost) {
          const tower = this.createTower(this.dragType, slot.x + slot.size / 2, slot.y + slot.size / 2);
          slot.occupied = true;
          slot.tower = tower;
          this.towers.push(tower);
          this.gold -= cost;
        }
        
        this.dragging = false;
        this.dragType = null;
        return;
      }
    }
    
    // 没有放置到槽位，取消拖拽
    this.dragging = false;
    this.dragType = null;
  }
  
  drawDragPreview() {
    if (!this.dragging || !this.dragType) return;
    
    const towerConfig = {
      triangle: { color: '#FF4444', cost: 100 },
      circle: { color: '#4444FF', cost: 150 },
      hexagon: { color: '#44FF44', cost: 200 },
      rectangle: { color: '#AA44FF', cost: 300 }
    }[this.dragType];
    
    const cost = towerConfig.cost;
    const canAfford = this.gold >= cost;
    
    // 绘制拖拽的塔预览
    ctx.save();
    ctx.globalAlpha = canAfford ? 0.7 : 0.5;
    
    if (!canAfford) {
      ctx.fillStyle = '#FF4444';
    } else {
      ctx.fillStyle = towerConfig.color;
    }
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(this.dragX, this.dragY, 25, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    
    // 显示金币状态
    ctx.fillStyle = canAfford ? '#44FF44' : '#FF4444';
    ctx.font = 'bold 12px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(canAfford ? '✅ 可放置' : '❌ 金币不足', this.dragX, this.dragY + 30);
    
    ctx.restore();
  }
  
  getTowerCost(type) {
    const costs = { triangle: 100, circle: 150, hexagon: 200, rectangle: 300 };
    return costs[type] || 100;
  }
  
  createTower(type, x, y) {
    return {
      type: type,
      x: x,
      y: y,
      attackTimer: 0,
      target: null
    };
  }
  
  spawnEnemy(type) {
    const types = {
      normal: { hp: 100, speed: 3.0, color: '#808080', tier: 0, reward: 10, size: 16 },
      fast: { hp: 50, speed: 5.0, color: '#FF8C00', tier: 1, reward: 15, size: 14 },
      heavy: { hp: 500, speed: 2.0, color: '#555555', tier: 2, reward: 50, size: 20 },
      boss: { hp: 2000, speed: 2.5, color: '#FF0000', tier: 3, reward: 200, size: 24 },
      finalBoss: { hp: 5000, speed: 1.5, color: '#9900FF', tier: 4, reward: 500, size: 28 }
    };
    
    const config = types[type] || types.normal;
    const pos = this.getPathPosition(0);
    
    return {
      type: type,
      x: pos.x,
      y: pos.y,
      maxHp: config.hp,
      hp: config.hp,
      speed: config.speed,
      color: config.color,
      tier: config.tier,
      reward: config.reward,
      size: config.size,
      progress: 0,
      alive: true
    };
  }
  
  updateEnemy(enemy, deltaTime) {
    if (!enemy.alive) return;
    
    const pathLength = this.getPathLength();
    const speedPerPixel = enemy.speed / pathLength;
    enemy.progress += speedPerPixel * deltaTime;
    
    if (enemy.progress >= 1) {
      enemy.alive = false;
      this.lives--;
      return;
    }
    
    const pos = this.getPathPosition(enemy.progress);
    enemy.x = pos.x;
    enemy.y = pos.y;
  }
  
  generateWave(waveNumber) {
    const enemies = [];
    
    // 最后一波（第20波）是最终BOSS
    if (waveNumber === 20) {
      enemies.push('finalBoss');
      return enemies;
    }
    
    // 每波30只普通怪
    for (let i = 0; i < 30; i++) {
      enemies.push('normal');
    }
    
    // 每3波一个精英
    if (waveNumber % 3 === 0) {
      enemies.push('fast');
    }
    
    // 每5波一个重型精英
    if (waveNumber % 5 === 0) {
      enemies.push('heavy');
    }
    
    // 每10波一个BOSS
    if (waveNumber % 10 === 0) {
      enemies.push('boss');
    }
    
    return enemies;
  }
  
  startNextWave() {
    this.currentWave++;
    this.enemiesToSpawn = this.generateWave(this.currentWave);
    this.spawnTimer = 0;
    this.waveInProgress = true;
  }
  
  update(deltaTime) {
    // 更新倒计时/波次
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
        const enemy = this.spawnEnemy(type);
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
      this.updateEnemy(enemy, deltaTime);
    }
    
    this.enemies = this.enemies.filter(e => e.alive);
    
    // 检查游戏结束
    if (this.lives <= 0) {
      this.isRunning = false;
    }
  }
  
  drawPath() {
    ctx.save();
    
    // 细线路径
    ctx.strokeStyle = '#888888';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(this.pathPoints[0].x, this.pathPoints[0].y);
    for (let i = 1; i < this.pathPoints.length; i++) {
      ctx.lineTo(this.pathPoints[i].x, this.pathPoints[i].y);
    }
    ctx.stroke();
    
    // 起点文字
    ctx.fillStyle = '#00FF00';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('起', this.pathStart.x, this.pathStart.y);
    
    // 终点文字
    ctx.fillStyle = '#FF0000';
    ctx.fillText('终', this.pathEnd.x, this.pathEnd.y);
    
    ctx.restore();
  }
  
  drawSlots() {
    for (const slot of this.slots) {
      // 放置槽位 - 浅蓝色边框
      ctx.fillStyle = slot.occupied ? 'rgba(100, 200, 255, 0.15)' : 'rgba(100, 200, 255, 0.05)';
      ctx.strokeStyle = this.selectedTowerType ? 'rgba(100, 200, 255, 0.6)' : 'rgba(100, 200, 255, 0.25)';
      ctx.lineWidth = 2;
      
      ctx.fillRect(slot.x, slot.y, slot.size, slot.size);
      ctx.strokeRect(slot.x, slot.y, slot.size, slot.size);
    }
  }
  
  drawEnemy(enemy) {
    if (!enemy.alive) return;
    
    ctx.save();
    const halfSize = enemy.size / 2;
    ctx.fillStyle = enemy.color;
    ctx.fillRect(enemy.x - halfSize, enemy.y - halfSize, enemy.size, enemy.size);
    
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(enemy.x - halfSize, enemy.y - halfSize, enemy.size, enemy.size);
    
    // 只显示当前生命值
    const hpText = `${enemy.hp}`;
    let textColor = '#ffffff';
    
    if (enemy.tier === 1) textColor = '#FFD700';
    else if (enemy.tier === 2) textColor = '#FF69B4';
    else if (enemy.tier === 3) textColor = '#FF0000';
    else if (enemy.tier === 4) textColor = '#CC66FF';
    
    ctx.fillStyle = textColor;
    ctx.font = `bold ${Math.max(8, enemy.size * 0.45)}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(hpText, enemy.x, enemy.y);
    
    ctx.restore();
  }
  
  drawUI() {
    const width = canvas.width;
    const height = canvas.height;
    
    // 顶部状态栏 - 移除金币，只保留生命
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, 0, width, 30);
    
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px Arial';
    ctx.textBaseline = 'middle';
    
    // 生命
    ctx.textAlign = 'center';
    ctx.fillText(`❤️ ${this.lives}`, width / 2, 15);
    
    // 分隔线
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 30);
    ctx.lineTo(width, 30);
    ctx.stroke();
    
    // 战斗区域顶部 - 显示当前波次或倒计时
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(this.mapX, this.mapY, this.mapWidth, 24);
    
    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold 13px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    if (this.countdownText) {
      // 倒计时
      ctx.font = 'bold 28px Arial';
      ctx.fillText(this.countdownText, this.mapX + this.mapWidth / 2, this.mapY + 12);
    } else {
      // 波次
      ctx.fillText(`第 ${this.currentWave} 波`, this.mapX + this.mapWidth / 2, this.mapY + 12);
    }
    
    // 分隔线
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(this.mapX, this.mapY + 24);
    ctx.lineTo(this.mapX + this.mapWidth, this.mapY + 24);
    ctx.stroke();
    
    // 底部栏
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, height - 97, width, 97);
    
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height - 97);
    ctx.lineTo(width, height - 97);
    ctx.stroke();
    
    // 商店塔选择
    const towerTypes = [
      { type: 'triangle', name: '三角塔', color: '#FF4444', cost: 100 },
      { type: 'circle', name: '圆塔', color: '#4444FF', cost: 150 },
      { type: 'hexagon', name: '六边塔', color: '#44FF44', cost: 200 }
    ];
    
    const slotWidth = 72;
    const slotHeight = 72;
    const gap = 10;
    const totalWidth = towerTypes.length * slotWidth + (towerTypes.length - 1) * gap;
    const startX = (width - totalWidth) / 2;
    const startY = height - 94;
    
    for (let i = 0; i < towerTypes.length; i++) {
      const t = towerTypes[i];
      const x = startX + i * (slotWidth + gap);
      const isSelected = this.selectedTowerType === t.type;
      
      ctx.fillStyle = isSelected ? 'rgba(255, 255, 100, 0.4)' : 'rgba(255, 255, 255, 0.12)';
      ctx.strokeStyle = isSelected ? '#FFFF00' : 'rgba(255, 255, 255, 0.25)';
      ctx.lineWidth = isSelected ? 2.5 : 1;
      
      const radius = 8;
      ctx.beginPath();
      ctx.moveTo(x + radius, startY);
      ctx.lineTo(x + slotWidth - radius, startY);
      ctx.quadraticCurveTo(x + slotWidth, startY, x + slotWidth, startY + radius);
      ctx.lineTo(x + slotWidth, startY + slotHeight - radius);
      ctx.quadraticCurveTo(x + slotWidth, startY + slotHeight, x + slotWidth - radius, startY + slotHeight);
      ctx.lineTo(x + radius, startY + slotHeight);
      ctx.quadraticCurveTo(x, startY + slotHeight, x, startY + slotHeight - radius);
      ctx.lineTo(x, startY + radius);
      ctx.quadraticCurveTo(x, startY, x + radius, startY);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      
      // 绘制无填充的边框图标（根据塔类型）
      this.drawTowerIcon(ctx, x + slotWidth / 2, startY + 24, t.color, t.type);
      
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 10px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(t.name, x + slotWidth / 2, startY + 48);
      
      ctx.fillStyle = '#FFD700';
      ctx.font = '10px Arial';
      ctx.fillText(`💰${t.cost}`, x + slotWidth / 2, startY + 64);
    }
    
    // 刷新按钮 - 正规样式
    const btnX = startX + towerTypes.length * (slotWidth + gap) - 5;
    const btnY = height - 94;
    const btnW = 68;
    const btnH = 72;
    
    // 按钮背景
    ctx.fillStyle = 'rgba(100, 200, 255, 0.25)';
    ctx.strokeStyle = '#64C8FF';
    ctx.lineWidth = 2;
    
    const btnRadius = 8;
    ctx.beginPath();
    ctx.moveTo(btnX + btnRadius, btnY);
    ctx.lineTo(btnX + btnW - btnRadius, btnY);
    ctx.quadraticCurveTo(btnX + btnW, btnY, btnX + btnW, btnY + btnRadius);
    ctx.lineTo(btnX + btnW, btnY + btnH - btnRadius);
    ctx.quadraticCurveTo(btnX + btnW, btnY + btnH, btnX + btnW - btnRadius, btnY + btnH);
    ctx.lineTo(btnX + btnRadius, btnY + btnH);
    ctx.quadraticCurveTo(btnX, btnY + btnH, btnX, btnY + btnH - btnRadius);
    ctx.lineTo(btnX, btnY + btnRadius);
    ctx.quadraticCurveTo(btnX, btnY, btnX + btnRadius, btnY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    
    // 刷新图标
    ctx.fillStyle = '#ffffff';
    ctx.font = '18px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⟳', btnX + btnW / 2, btnY + 22);
    
    // 显示当前金币/刷新所需金币
    ctx.fillStyle = this.gold >= this.refreshCost ? '#FFD700' : '#FF6666';
    ctx.font = 'bold 10px Arial';
    ctx.fillText(`${this.gold}/${this.refreshCost}`, btnX + btnW / 2, btnY + 48);
    
    ctx.fillStyle = '#AAAAAA';
    ctx.font = '9px Arial';
    ctx.fillText('刷新', btnX + btnW / 2, btnY + 62);
    
    // 游戏结束
    if (this.lives <= 0) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
      ctx.fillRect(0, 0, width, height);
      
      ctx.fillStyle = '#FF0000';
      ctx.font = '48px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('游戏结束', width / 2, height / 2 - 30);
      
      ctx.fillStyle = '#ffffff';
      ctx.font = '24px Arial';
      ctx.fillText(`坚持波数: ${this.currentWave}`, width / 2, height / 2 + 30);
    }
  }
  
  /**
   * 绘制无填充的塔图标（仅边框）
   */
  drawTowerIcon(ctx, x, y, color, type) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    
    switch (type) {
      case 'triangle':
        // 三角形 - 仅边框
        const triSize = 12;
        ctx.beginPath();
        ctx.moveTo(x, y - triSize);
        ctx.lineTo(x - triSize, y + triSize);
        ctx.lineTo(x + triSize, y + triSize);
        ctx.closePath();
        ctx.stroke();
        break;
        
      case 'circle':
        // 圆形 - 仅边框
        ctx.beginPath();
        ctx.arc(x, y, 11, 0, Math.PI * 2);
        ctx.stroke();
        break;
        
      case 'hexagon':
        // 六边形 - 仅边框
        const hexR = 11;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const angle = (Math.PI / 3) * i - Math.PI / 6;
          const hx = x + hexR * Math.cos(angle);
          const hy = y + hexR * Math.sin(angle);
          if (i === 0) ctx.moveTo(hx, hy);
          else ctx.lineTo(hx, hy);
        }
        ctx.closePath();
        ctx.stroke();
        break;
        
      case 'rectangle':
        // 长方形 - 仅边框
        const rectW = 22;
        const rectH = 14;
        ctx.strokeRect(x - rectW / 2, y - rectH / 2, rectW, rectH);
        break;
    }
    
    ctx.restore();
  }
  
  draw() {
    const width = canvas.width;
    const height = canvas.height;
    
    // 清空画布
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, width, height);
    
    // 地图背景
    ctx.fillStyle = '#16213e';
    ctx.fillRect(this.mapX, this.mapY, this.mapWidth, this.mapHeight);
    
    // 绘制路径
    this.drawPath();
    
    // 绘制槽位
    this.drawSlots();
    
    // 绘制怪物
    for (const enemy of this.enemies) {
      this.drawEnemy(enemy);
    }
    
    // 绘制拖拽预览
    this.drawDragPreview();
    
    // 绘制UI
    this.drawUI();
  }
  
  loop() {
    if (!this.isRunning) return;
    
    const now = performance.now();
    const deltaTime = (now - this.lastTime) / 1000;
    this.lastTime = now;
    
    const dt = Math.min(deltaTime, 0.1);
    
    this.update(dt);
    this.draw();
    
    requestAnimationFrame(() => this.loop());
  }
}

/**
 * 延迟启动：等运行时（jsbridge）就绪后再创建 canvas / 读取窗口信息 / 实例化游戏。
 * 同时优先使用新接口 wx.getWindowInfo，避开已废弃的 wx.getSystemInfoSync
 * （其内部会访问 deviceOrientation getter，正是触发 getSystemInfo 的引擎内部路径）。
 */
function boot() {
  canvas = wx.createCanvas();
  ctx = canvas.getContext('2d');

  if (typeof wx.getWindowInfo === 'function') {
    windowInfo = wx.getWindowInfo();
  } else if (typeof wx.getSystemInfoSync === 'function') {
    windowInfo = wx.getSystemInfoSync();
  } else {
    // 兜底（理论上 wx 环境必然提供上述接口）
    windowInfo = { screenWidth: 640, screenHeight: 960 };
  }

  canvas.width = windowInfo.screenWidth;
  canvas.height = windowInfo.screenHeight;

  new Game();
}

// 首帧再启动，确保微信 JS 桥已连接；规避 "jsbridge not ready" 警告
if (typeof wx !== 'undefined') {
  requestAnimationFrame(boot);
} else {
  boot();
}
