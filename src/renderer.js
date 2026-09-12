// 渲染层：所有绘制函数从原 Game.draw* 抽离。
// 约定：每个绘制函数接收 game 实例，内部用 game.ctx / game.canvas；
// drawTowerIcon 为纯函数，直接吃 ctx。
const { SHOP_TOWERS, TOWER_DEFS, LAYOUT } = require('./config');

function drawPath(game) {
  const ctx = game.ctx;
  ctx.save();

  // 细线路径
  ctx.strokeStyle = '#888888';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(game.pathPoints[0].x, game.pathPoints[0].y);
  for (let i = 1; i < game.pathPoints.length; i++) {
    ctx.lineTo(game.pathPoints[i].x, game.pathPoints[i].y);
  }
  ctx.stroke();

  // 起点文字
  ctx.fillStyle = '#00FF00';
  ctx.font = 'bold 14px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('起', game.pathStart.x, game.pathStart.y);

  // 终点文字
  ctx.fillStyle = '#FF0000';
  ctx.fillText('终', game.pathEnd.x, game.pathEnd.y);

  ctx.restore();
}

function drawSlots(game) {
  const ctx = game.ctx;
  for (const slot of game.slots) {
    // 放置槽位 - 浅蓝色边框
    ctx.fillStyle = slot.occupied ? 'rgba(100, 200, 255, 0.15)' : 'rgba(100, 200, 255, 0.05)';
    ctx.strokeStyle = game.selectedTowerType ? 'rgba(100, 200, 255, 0.6)' : 'rgba(100, 200, 255, 0.25)';
    ctx.lineWidth = 2;

    ctx.fillRect(slot.x, slot.y, slot.size, slot.size);
    ctx.strokeRect(slot.x, slot.y, slot.size, slot.size);
  }
}

function drawEnemy(game, enemy) {
  if (!enemy.alive) return;

  const ctx = game.ctx;
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

/**
 * 绘制无填充的塔图标（仅边框），纯函数。
 */
function drawTowerIcon(ctx, x, y, color, type) {
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

function drawDragPreview(game) {
  if (!game.dragging || !game.dragType) return;

  const ctx = game.ctx;
  const towerConfig = TOWER_DEFS[game.dragType];
  const cost = towerConfig.cost;
  const canAfford = game.gold >= cost;

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
  ctx.arc(game.dragX, game.dragY, 25, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // 绘制对应类型的塔图标（使用 drawTowerIcon 显示具体形状）
  drawTowerIcon(ctx, game.dragX, game.dragY, '#FFFFFF', game.dragType);

  // 显示金币状态
  ctx.fillStyle = canAfford ? '#44FF44' : '#FF4444';
  ctx.font = 'bold 12px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(canAfford ? '✅ 可放置' : '❌ 金币不足', game.dragX, game.dragY + 35);

  ctx.restore();
}

function drawUI(game) {
  const ctx = game.ctx;
  const canvas = game.canvas;
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
  ctx.fillText(`❤️ ${game.lives}`, width / 2, 15);

  // 分隔线
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, 30);
  ctx.lineTo(width, 30);
  ctx.stroke();

  // 战斗区域顶部 - 显示当前波次或倒计时
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(game.mapX, game.mapY, game.mapWidth, 24);

  ctx.fillStyle = '#FFD700';
  ctx.font = 'bold 13px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (game.countdownText) {
    // 倒计时
    ctx.font = 'bold 28px Arial';
    ctx.fillText(game.countdownText, game.mapX + game.mapWidth / 2, game.mapY + 12);
  } else {
    // 波次
    ctx.fillText(`第 ${game.currentWave} 波`, game.mapX + game.mapWidth / 2, game.mapY + 12);
  }

  // 分隔线
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(game.mapX, game.mapY + 24);
  ctx.lineTo(game.mapX + game.mapWidth, game.mapY + 24);
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
  const towerTypes = SHOP_TOWERS;

  const slotWidth = LAYOUT.shopSlotWidth;
  const slotHeight = LAYOUT.shopSlotHeight;
  const gap = LAYOUT.shopGap;
  const totalWidth = towerTypes.length * slotWidth + (towerTypes.length - 1) * gap;
  const startX = (width - totalWidth) / 2;
  const startY = height - LAYOUT.shopBarYOffset;

  for (let i = 0; i < towerTypes.length; i++) {
    const type = towerTypes[i];
    const t = TOWER_DEFS[type];
    const x = startX + i * (slotWidth + gap);
    const isSelected = game.dragging && game.dragType === type;
    const isEmpty = game.shopSlotState[i] && game.shopSlotState[i].empty;

    ctx.fillStyle = isSelected ? 'rgba(255, 255, 100, 0.4)' : (isEmpty ? 'rgba(255, 255, 255, 0.05)' : 'rgba(255, 255, 255, 0.12)');
    ctx.strokeStyle = isSelected ? '#FFFF00' : (isEmpty ? 'rgba(255, 255, 255, 0.15)' : 'rgba(255, 255, 255, 0.25)');
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

    if (!isEmpty) {
      // 绘制无填充的边框图标（根据塔类型）
      drawTowerIcon(ctx, x + slotWidth / 2, startY + 24, t.color, type);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 10px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(t.name, x + slotWidth / 2, startY + 48);

      ctx.fillStyle = '#FFD700';
      ctx.font = '10px Arial';
      ctx.fillText(`💰${t.cost}`, x + slotWidth / 2, startY + 64);
    } else {
      // 显示空槽提示
      ctx.fillStyle = '#666666';
      ctx.font = '24px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('空', x + slotWidth / 2, startY + slotHeight / 2);
    }
  }

  // 刷新按钮 - 正规样式
  const btnX = startX + towerTypes.length * (slotWidth + gap) - 5;
  const btnY = height - LAYOUT.refreshBtnDraw.yOffset;
  const btnW = LAYOUT.refreshBtnDraw.w;
  const btnH = LAYOUT.refreshBtnDraw.h;

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
  ctx.fillStyle = game.gold >= game.refreshCost ? '#FFD700' : '#FF6666';
  ctx.font = 'bold 10px Arial';
  ctx.fillText(`${game.gold}/${game.refreshCost}`, btnX + btnW / 2, btnY + 48);

  ctx.fillStyle = '#AAAAAA';
  ctx.font = '9px Arial';
  ctx.fillText('刷新', btnX + btnW / 2, btnY + 62);

  // 游戏结束
  if (game.lives <= 0) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = '#FF0000';
    ctx.font = '48px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('游戏结束', width / 2, height / 2 - 30);

    ctx.fillStyle = '#ffffff';
    ctx.font = '24px Arial';
    ctx.fillText(`坚持波数: ${game.currentWave}`, width / 2, height / 2 + 30);
  }
}

// 组合一帧的完整绘制（原 Game.draw）
function render(game) {
  const ctx = game.ctx;
  const canvas = game.canvas;
  const width = canvas.width;
  const height = canvas.height;

  // 清空画布
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, width, height);

  // 地图背景
  ctx.fillStyle = '#16213e';
  ctx.fillRect(game.mapX, game.mapY, game.mapWidth, game.mapHeight);

  // 绘制路径
  drawPath(game);

  // 绘制槽位
  drawSlots(game);

  // 绘制怪物
  for (const enemy of game.enemies) {
    drawEnemy(game, enemy);
  }

  // 绘制拖拽预览
  drawDragPreview(game);

  // 绘制 UI
  drawUI(game);
}

module.exports = {
  render,
  drawPath,
  drawSlots,
  drawEnemy,
  drawTowerIcon,
  drawDragPreview,
  drawUI,
};
