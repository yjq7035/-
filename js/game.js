/**
 * 塔防游戏 - 主逻辑
 */
import { Path } from './path.js';
import { Enemy } from './enemy.js';
import { createTower, TOWER_TYPES } from './tower.js';
import { WaveManager } from './wave.js';
import { UIDrawer } from './ui.js';
import { PlacementSystem } from './placement.js';
import { EffectManager } from './effect-system.js';
import { InputHandler } from './input.js';
import { MapSystem } from './map.js';

class Game {
  constructor() {
    // Canvas 设置
    this.canvas = document.getElementById('gameCanvas');
    this.ctx = this.canvas.getContext('2d');

    // 窗口信息
    this.windowInfo = this.getWindowInfo();
    this.canvas.width = this.windowInfo.screenWidth;
    this.canvas.height = this.windowInfo.screenHeight;

    // 游戏区域
    this.mapX = 50;
    this.mapY = 80;
    this.mapWidth = this.windowInfo.screenWidth - 100;
    this.mapHeight = this.windowInfo.screenHeight - 160;

    // 游戏状态
    this.gold = 200;
    this.score = 100;  // 初始积分100
    this.maxScore = 100;  // 最大积分
    this.anyEnemyEscaped = false;  // 是否有怪物逃离过
    this.selectedTowerType = null;
    this.selectedTower = null;

    // 波次倒计时
    this.betweenWaveTimer = 0;  // 波次间倒计时
    this.betweenWaveDuration = 30;  // 30秒倒计时
    this.countdownActive = false;  // 倒计时是否激活
    this.earlyCountdownActive = false;  // 提前清怪倒计时是否激活
    this.earlyCountdownDuration = 5;  // 提前清怪剩余5秒

    // 子系统
    this.mapSystem = new MapSystem(this.mapX, this.mapY, this.mapWidth, this.mapHeight);
    this.path = new Path(this.mapX, this.mapY, this.mapWidth, this.mapHeight);
    this.placement = new PlacementSystem(
      this.mapSystem.slots,
      () => this.gold,
      (cost) => this.gold >= cost
    );
    this.effectManager = new EffectManager();
    this.uiDrawer = new UIDrawer(this.canvas);

    // 游戏对象
    this.enemies = [];
    this.towers = [];

    // 波次管理
    this.waveManager = new WaveManager();

    // 输入处理
    this.inputHandler = new InputHandler(this.canvas, {
      onMouseDown: (pos) => this.handleMouseDown(pos),
      onMouseMove: (pos) => this.handleMouseMove(pos),
      onMouseUp: (pos) => this.handleMouseUp(pos),
      onClick: (pos) => this.handleClick(pos),
      onRightClick: () => this.handleRightClick()
    });

    // 时间管理
    this.lastTime = performance.now();
    this.isRunning = true;

    // 开始游戏循环
    this.loop();
  }

  getWindowInfo() {
    if (typeof wx !== 'undefined' && wx.getWindowInfo) {
      return wx.getWindowInfo();
    }
    return {
      screenWidth: window.innerWidth,
      screenHeight: window.innerHeight,
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight
    };
  }

  // ---- 输入处理 ----

  handleMouseDown(pos) {
    if (this.placement.isDragging()) return;

    const towerTypes = this.waveManager.getShopTowerTypes();
    this.placement.handleMouseDown(towerTypes, pos, this.canvas);
  }

  handleMouseMove(pos) {
    this.placement.handleMouseMove(pos);
  }

  handleMouseUp(pos) {
    if (!this.placement.isDragging()) return;

    // 使用 PlacementSystem 的 handleMouseUp 进行完整的拖放检测
    const placed = this.placement.handleMouseUp(this.canvas, pos, (type, cx, cy) => {
      const tower = createTower(type, cx, cy);
      this.towers.push(tower);
      this.gold -= TOWER_TYPES[type].cost;
      return tower;
    });

    // 仅在放置失败时取消拖放（成功放置时 PlacementSystem 内部不取消）
    if (!placed) {
      this.placement.cancelDrag();
    }
  }

  handleClick(pos) {
    // 如果正在拖放，忽略点击事件
    if (this.placement.isDragging()) return;

    // 检查是否点击了刷新按钮
    const btn = this.uiDrawer.refreshButton;
    if (btn && btn.width > 0 &&
        pos.x >= btn.x && pos.x <= btn.x + btn.width &&
        pos.y >= btn.y && pos.y <= btn.y + btn.height) {
      this.refreshShop();
      return;
    }

    // 检查是否点击了已有的塔
    this.selectedTower = null;
    for (const tower of this.towers) {
      const dx = pos.x - tower.x;
      const dy = pos.y - tower.y;
      if (Math.sqrt(dx * dx + dy * dy) < 30) {
        this.selectedTower = tower;
        break;
      }
    }
  }

  /**
   * 刷新商店：随机打乱塔的顺序
   */
  refreshShop() {
    if (this.gold < 50) return; // 刷新费用 50 金币
    this.gold -= 50;
    this.waveManager.shuffleShop();
  }

  handleRightClick() {
    this.selectedTowerType = null;
    this.selectedTower = null;
  }

  // ---- 游戏逻辑 ----

  spawnEnemy(type) {
    const enemy = new Enemy(type, this.path);
    this.enemies.push(enemy);
    return enemy;
  }

  update(deltaTime) {
    // 更新波次
    const waveResult = this.waveManager.update(deltaTime, (type) => this.spawnEnemy(type));
    
    // 如果波次完成，立即开始30秒倒计时
    if (waveResult === 'waveComplete' && !this.countdownActive) {
      this.betweenWaveTimer = this.betweenWaveDuration;
      this.countdownActive = true;
    }
    
    // 处理倒计时
    if (this.countdownActive) {
      if (this.earlyCountdownActive) {
        // 提前清怪倒计时
        this.betweenWaveTimer -= deltaTime;
        if (this.betweenWaveTimer <= 0) {
          this.countdownActive = false;
          this.earlyCountdownActive = false;
          this.waveManager.startNextWave();
        }
      } else {
        // 正常波次间倒计时
        this.betweenWaveTimer -= deltaTime;
        if (this.betweenWaveTimer <= 0) {
          this.countdownActive = false;
          this.waveManager.startNextWave();
        }
      }
    }

    // 更新怪物...
    for (const enemy of this.enemies) {
      const result = enemy.update(deltaTime);
      if (result === 'reachedEnd') {
        // 怪物到达终点，标记为逃亡状态
        enemy.isEscaping = true;
      }
    }

    // 更新塔
    for (const tower of this.towers) {
      const hits = tower.update(deltaTime, this.enemies);
      for (const hit of hits) {
        if (hit.reward > 0) {
          this.gold += hit.reward;
        }
        if (hit.effect) {
          this.effectManager.addEffect(hit.effect);
        }
      }
    }

    // 更新特效
    this.effectManager.update(deltaTime);

    // 处理逃亡怪物的积分扣除
    let hasEscapingEnemies = false;
    for (const enemy of this.enemies) {
      if (enemy.isEscaping) {
        hasEscapingEnemies = true;
        this.anyEnemyEscaped = true;  // 标记有怪物逃离
        this.score -= enemy.scorePenalty * deltaTime;
        if (this.score <= 0) {
          this.score = 0;
          this.isRunning = false;
          alert('积分耗尽！游戏失败！你坚持了 ' + this.waveManager.currentWave + ' 波');
          return;
        }
      }
    }

    // 移除已死亡的怪物（但保留逃亡的怪物）
    this.enemies = this.enemies.filter(e => e.alive || e.isEscaping);

    // 检查是否提前清完怪物（倒计时期间）
    if (this.countdownActive && !hasEscapingEnemies && !this.earlyCountdownActive) {
      // 提前清完，如果倒计时大于5秒，跳到5秒
      if (this.betweenWaveTimer > 5) {
        this.earlyCountdownActive = true;
        this.betweenWaveTimer = 5;
      }
    }

    // 检查游戏结束
    if (this.score <= 0) {
      this.isRunning = false;
    }
  }

  // ---- 绘制 ----

  draw() {
    const ctx = this.ctx;
    const width = this.canvas.width;
    const height = this.canvas.height;

    // 清空画布（移除背景）
    ctx.clearRect(0, 0, width, height);

    // 绘制路径
    this.path.draw(ctx);

    // 绘制槽位
    this.mapSystem.drawSlots(ctx, this.selectedTowerType);

    // 绘制塔
    for (const tower of this.towers) {
      tower.draw(ctx);
    }

    // 绘制怪物
    for (const enemy of this.enemies) {
      enemy.draw(ctx);
    }

    // 绘制拖拽预览
    this.placement.drawDragPreview(ctx);

    // 绘制特效
    this.effectManager.draw(ctx);

    // 绘制 UI
    this.drawUI();
  }

  drawUI() {
    const ctx = this.ctx;
    const height = this.canvas.height;

    // 顶部状态栏
    this.uiDrawer.drawStatusBar(this.gold, this.score, this.maxScore, this.waveManager.currentWave, this.countdownActive, this.betweenWaveTimer, this.earlyCountdownActive, this.anyEnemyEscaped);

    // 底部商城
    this.uiDrawer.drawShop(this.selectedTowerType, this.waveManager.getShopTowerTypes());

    // 选中塔信息
    this.uiDrawer.drawTowerInfo(this.selectedTower);

    // 游戏结束
    if (this.score <= 0) {
      this.uiDrawer.drawGameOver(this.waveManager.currentWave, height);
    }
  }

  // ---- 游戏循环 ----

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

// 启动游戏
window.addEventListener('load', () => {
  window.game = new Game();
});

export { Game };
