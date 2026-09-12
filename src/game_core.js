// 游戏核心：Game 类，协调各功能模块。
// 原单文件 game.js 中的 Game 类拆出数据/几何/敌人/波次/塔/渲染/输入后，
// 这里只保留：状态、路径与槽位计算、波次调度、主循环、事件绑定。
const config = require('./config');
const enemyMod = require('./enemy');
const waveMod = require('./wave');
const renderer = require('./renderer');
const input = require('./input');

const { LAYOUT, BALANCE, TOWER_DEFS } = config;

class Game {
  constructor(canvas, ctx, windowInfo) {
    this.canvas = canvas;
    this.ctx = ctx;

    const w = windowInfo.screenWidth;
    const h = windowInfo.screenHeight;

    // 缩小战斗区域
    this.mapX = w * 0.15;
    this.mapY = h * 0.12;
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
    this.lastTime = performance.now();
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

    // 商店槽状态（记录哪些槽被拖走了，需要显示为空）
    this.shopSlotState = SHOP_TOWERS.map((type) => ({
      type: type,
      empty: false,
    }));

    // 开始游戏循环
    this.loop();
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
    // 初始刷新 3 个塔
    const towerTypes = Object.keys(TOWER_DEFS);
    for (let i = 0; i < 3; i++) {
      const randomType = towerTypes[Math.floor(Math.random() * towerTypes.length)];
      this.refreshTowerTypes.push(randomType);
    }
  }

  refreshTowers() {
    if (this.gold < this.refreshCost) return;
    this.gold -= this.refreshCost;
    this.refreshTowerTypes = [];
    const towerTypes = Object.keys(TOWER_DEFS);
    for (let i = 0; i < 3; i++) {
      const randomType = towerTypes[Math.floor(Math.random() * towerTypes.length)];
      this.refreshTowerTypes.push(randomType);
    }
    // 重置商店槽状态
    this.shopSlotState = SHOP_TOWERS.map((type) => ({
      type: type,
      empty: false,
    }));
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
        const enemy = enemyMod.spawnEnemy(type, this.pathPoints);
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

    // 检查游戏结束
    if (this.lives <= 0) {
      this.isRunning = false;
    }
  }

  draw() {
    renderer.render(this);
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

module.exports = Game;
