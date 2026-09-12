/**
 * UI 绘制系统
 */
import { TOWER_TYPES } from './tower.js';

class UIDrawer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    // 商店刷新按钮位置（在绘制后更新）
    this.refreshButton = { x: 0, y: 0, width: 80, height: 30 };
  }

  /**
   * 绘制顶部状态栏
   */
  drawStatusBar(gold, score, maxScore, currentWave, countdownActive, countdownTimer, earlyCountdownActive, anyEnemyEscaped) {
    const ctx = this.ctx;
    const width = this.canvas.width;

    // 移除背景，直接绘制文字

    ctx.fillStyle = '#ffffff';
    ctx.font = '18px Arial';
    ctx.textBaseline = 'middle';

    ctx.fillText(`💰 金币: ${gold}`, 20, 30);
    ctx.fillText(`🌊 波次: ${currentWave}`, 200, 30);
    
    // 在波次下方显示积分条
    const scoreBarY = 45;
    const scoreBarX = 200;
    const scoreBarWidth = 150;
    const scoreBarHeight = 12;
    
    // 积分条背景
    ctx.fillStyle = '#333333';
    ctx.fillRect(scoreBarX, scoreBarY, scoreBarWidth, scoreBarHeight);
    
    // 积分条前景
    const scoreRatio = score / maxScore;
    const scoreColor = scoreRatio > 0.5 ? '#4ECDC4' : scoreRatio > 0.25 ? '#FFFF00' : '#FF0000';
    ctx.fillStyle = scoreColor;
    ctx.fillRect(scoreBarX, scoreBarY, scoreBarWidth * scoreRatio, scoreBarHeight);
    
    // 积分文字 - 只有怪物逃离后才显示具体数值
    ctx.fillStyle = '#ffffff';
    ctx.font = '10px Arial';
    ctx.textAlign = 'center';
    const scoreText = anyEnemyEscaped ? `⭐ ${Math.floor(score)}` : '⭐ 100';
    ctx.fillText(scoreText, scoreBarX + scoreBarWidth / 2, scoreBarY + scoreBarHeight / 2);
    
    ctx.textAlign = 'left';
    
    // 绘制倒计时
    if (countdownActive) {
      const remainingTime = Math.ceil(countdownTimer);
      const countdownText = earlyCountdownActive 
        ? `⏰ 快速开始: ${remainingTime}s` 
        : `⏰ 下一波: ${remainingTime}s`;
      
      ctx.fillStyle = earlyCountdownActive ? '#FFD700' : '#87CEEB';
      ctx.font = 'bold 16px Arial';
      ctx.textAlign = 'right';
      ctx.fillText(countdownText, width - 20, 25);
      
      // 倒计时进度条
      const progressWidth = 200;
      const progressHeight = 4;
      const progressY = 35;
      const progressX = width - 20 - progressWidth;
      
      ctx.fillStyle = '#333333';
      ctx.fillRect(progressX, progressY, progressWidth, progressHeight);
      
      const progress = earlyCountdownActive 
        ? remainingTime / 5 
        : remainingTime / 30;
      ctx.fillStyle = earlyCountdownActive ? '#FFD700' : '#87CEEB';
      ctx.fillRect(progressX, progressY, progressWidth * progress, progressHeight);
      
      ctx.textAlign = 'left';
    }
  }

  /**
   * 绘制底部商城
   */
  drawShop(selectedTowerType, towerTypes) {
    const ctx = this.ctx;
    const width = this.canvas.width;
    const height = this.canvas.height;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, height - 100, width, 100);

    towerTypes = towerTypes || Object.keys(TOWER_TYPES);
    const slotWidth = 120;
    const slotHeight = 70;
    const gap = 15;
    const totalWidth = towerTypes.length * slotWidth + (towerTypes.length - 1) * gap;
    const startX = (width - totalWidth) / 2;
    const startY = height - 90;

    for (let i = 0; i < towerTypes.length; i++) {
      const type = towerTypes[i];
      const config = TOWER_TYPES[type];
      const x = startX + i * (slotWidth + gap);
      const isSelected = selectedTowerType === type;

      ctx.fillStyle = isSelected ? 'rgba(255, 255, 100, 0.3)' : 'rgba(255, 255, 255, 0.1)';
      ctx.strokeStyle = isSelected ? '#FFFF00' : 'rgba(255, 255, 255, 0.3)';
      ctx.lineWidth = isSelected ? 3 : 1;

      ctx.fillRect(x, startY, slotWidth, slotHeight);
      ctx.strokeRect(x, startY, slotWidth, slotHeight);

      // 塔图标
      ctx.fillStyle = config.color;
      ctx.beginPath();
      ctx.arc(x + slotWidth / 2, startY + 25, 15, 0, Math.PI * 2);
      ctx.fill();

      // 塔名称
      ctx.fillStyle = '#ffffff';
      ctx.font = '14px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(config.name, x + slotWidth / 2, startY + 50);

      // 价格
      ctx.fillStyle = '#FFD700';
      ctx.font = '12px Arial';
      ctx.fillText(`💰${config.cost}`, x + slotWidth / 2, startY + 65);
    }

    // 绘制刷新按钮（在塔槽右侧）
    this._drawRefreshButton(ctx, startX, startY, totalWidth, slotWidth, slotHeight);
  }

  /**
   * 绘制刷新按钮
   */
  _drawRefreshButton(ctx, startX, startY, totalWidth, slotWidth, slotHeight) {
    const btnWidth = 80;
    const btnHeight = 30;
    // 将刷新按钮放在商城底部中央
    const btnX = (this.canvas.width - btnWidth) / 2;
    const btnY = startY + slotHeight + 10;

    // 更新按钮位置记录
    this.refreshButton = { x: btnX, y: btnY, width: btnWidth, height: btnHeight };

    // 按钮背景
    ctx.fillStyle = 'rgba(255, 165, 0, 0.6)';
    ctx.strokeStyle = 'rgba(255, 200, 0, 0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(btnX, btnY, btnWidth, btnHeight, 5);
    ctx.fill();
    ctx.stroke();

    // 按钮文字
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🔄 刷新', btnX + btnWidth / 2, btnY + btnHeight / 2);
  }


  /**
   * 绘制选中塔的详细信息
   */
  drawTowerInfo(selectedTower) {
    if (!selectedTower) return;

    const ctx = this.ctx;
    const width = this.canvas.width;
    const infoX = width - 220;
    const infoY = 70;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillRect(infoX, infoY, 200, 120);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(infoX, infoY, 200, 120);

    ctx.fillStyle = '#ffffff';
    ctx.font = '16px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(selectedTower.name, infoX + 10, infoY + 25);

    ctx.font = '14px Arial';
    ctx.fillStyle = '#FF6B6B';
    ctx.fillText(`伤害: ${selectedTower.damage}`, infoX + 10, infoY + 50);

    ctx.fillStyle = '#4ECDC4';
    ctx.fillText(`射程: ${selectedTower.range}`, infoX + 10, infoY + 70);

    ctx.fillStyle = '#FFE66D';
    ctx.fillText(`攻速: ${selectedTower.attackSpeed}s`, infoX + 10, infoY + 90);

    ctx.fillStyle = '#A8E6CF';
    ctx.fillText(`描述: ${TOWER_TYPES[selectedTower.type].description}`, infoX + 10, infoY + 110);
  }

  /**
   * 绘制游戏结束画面
   */
  drawGameOver(currentWave, height) {
    const ctx = this.ctx;
    const width = this.canvas.width;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = '#FF0000';
    ctx.font = '48px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('游戏结束', width / 2, height / 2 - 30);

    ctx.fillStyle = '#ffffff';
    ctx.font = '24px Arial';
    ctx.fillText(`坚持波数: ${currentWave}`, width / 2, height / 2 + 30);
  }
}

export { UIDrawer };
