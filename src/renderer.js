// 渲染层：所有绘制函数从原 Game.draw* 抽离。
// 约定：每个绘制函数接收 game 实例，内部用 game.ctx / game.canvas；
// drawTowerIcon 为纯函数，直接吃 ctx。
const { SHOP_TOWERS, TOWER_DEFS, LAYOUT } = require('./config');
const towerMod = require('./tower');

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

  // 满血不显示生命值，被攻击低于100%时才显示
  if (enemy.hp < enemy.maxHp) {
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
  }

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
      // 三角形 - 默认朝向右侧（与攻击方向一致）
      const triSize = 12;
      ctx.beginPath();
      ctx.moveTo(x + triSize, y);
      ctx.lineTo(x - triSize * 0.5, y - triSize);
      ctx.lineTo(x - triSize * 0.5, y + triSize);
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

    case 'square':
      // 正方塔 - 正方形
      const sqSize = 20;
      ctx.strokeRect(x - sqSize / 2, y - sqSize / 2, sqSize, sqSize);
      break;

    case 'trapezoid':
      // 梯塔 - 梯形
      const tw = 20, bw = 26, th = 16;
      ctx.beginPath();
      ctx.moveTo(x - tw / 2, y - th / 2);
      ctx.lineTo(x + tw / 2, y - th / 2);
      ctx.lineTo(x + bw / 2, y + th / 2);
      ctx.lineTo(x - bw / 2, y + th / 2);
      ctx.closePath();
      ctx.stroke();
      break;

    case 'semicircle':
      // 半圆塔 - 半圆形（开口朝向攻击方向）
      const sr = 11;
      ctx.beginPath();
      // 绘制下半圆（开口朝上），旋转后开口会朝向攻击方向
      // 需要减去90度偏移来修正朝向
      ctx.arc(x, y, sr, -Math.PI / 2, Math.PI / 2);
      ctx.closePath();
      ctx.stroke();
      break;

    case 'sector':
      // 扇塔 - 扇形
      const secR = 11;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.arc(x, y, secR, -Math.PI / 4, Math.PI / 4);
      ctx.closePath();
      ctx.stroke();
      break;

    case 'long_rectangle':
      // 长方形 - 仅边框
      const rectW = 22;
      const rectH = 14;
      ctx.strokeRect(x - rectW / 2, y - rectH / 2, rectW, rectH);
      break;
  }

  ctx.restore();
}

/**
 * 绘制已放置的塔
 */
function drawTower(ctx, game, tower) {
  const towerDef = TOWER_DEFS[tower.type];
  if (!towerDef) return;

  ctx.save();

  // 如果塔有攻击朝向，根据朝向旋转绘制
  if (tower.attackAngle !== undefined) {
    ctx.translate(tower.x, tower.y);
    ctx.rotate(tower.attackAngle);
    drawTowerIcon(ctx, 0, 0, towerDef.color, tower.type);
  } else {
    drawTowerIcon(ctx, tower.x, tower.y, towerDef.color, tower.type);
  }

  ctx.restore();
  
  // 绘制等级星星
  if (tower.level > 0) {
    const stars = towerMod.getTowerStars(tower.level);
    ctx.fillStyle = '#FFD700';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(stars, tower.x, tower.y - 15);
  }
}

/**
 * 绘制塔属性面板
 */
function drawTowerPanel(game) {
  const ctx = game.ctx;
  const canvas = game.canvas;
  const width = canvas.width;
  const height = canvas.height;
  
  const panelW = 280;
  const panelH = 320;
  const panelX = (width - panelW) / 2;
  const panelY = (height - panelH) / 2;
  
  const towerType = game.panelTowerType;
  const towerDef = TOWER_DEFS[towerType];
  if (!towerDef) return;
  
  // 获取塔的详细属性
  const towerStats = getTowerStats(towerType);
  
  // 面板背景
  ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
  ctx.strokeStyle = towerDef.color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(panelX, panelY, panelW, panelH, 10);
  ctx.fill();
  ctx.stroke();
  
  // 标题 - 塔名称和等级
  ctx.fillStyle = towerDef.color;
  ctx.font = 'bold 20px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(towerDef.name, width / 2, panelY + 30);
  
  // 等级星星
  const tower = game.selectedTower;
  if (tower && tower.level > 0) {
    const stars = towerMod.getTowerStars(tower.level);
    ctx.fillStyle = '#FFD700';
    ctx.font = '14px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(stars, width / 2, panelY + 50);
  }
  
  // 分隔线
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(panelX + 20, panelY + 65);
  ctx.lineTo(panelX + panelW - 20, panelY + 65);
  ctx.stroke();
  
  // 属性数据
  const attrX = panelX + 40;
  let attrY = panelY + 95;
  const lineH = 28;
  
  ctx.font = '14px Arial';
  ctx.textAlign = 'left';
  
  // 攻击力（含等级加成）
  const attackBonus = tower ? towerMod.getLevelAttackBonus(tower.level) : 1;
  const baseDamage = towerStats.damage;
  const finalDamage = Math.floor(baseDamage * attackBonus);
  
  ctx.textAlign = 'left';
  ctx.fillStyle = '#FF6B6B';
  ctx.fillText(`⚔️ 攻击力:`, attrX, attrY);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'right';
  ctx.fillText(`${finalDamage}${attackBonus > 1 ? `(+${Math.floor((attackBonus - 1) * 100)}%)` : ''}`, panelX + panelW - 40, attrY);
  attrY += lineH;
  
  // 保存tower到game供后续使用
  game._currentPanelTower = tower;
  
  // 攻击速度
  ctx.textAlign = 'left';
  ctx.fillStyle = '#FF6B6B';
  ctx.fillText(`⚡ 攻速:`, attrX, attrY);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'right';
  ctx.fillText(`每${towerStats.attackSpeed}秒`, panelX + panelW - 40, attrY);
  attrY += lineH;
  
  // 造价
  ctx.textAlign = 'left';
  ctx.fillStyle = '#FFD700';
  ctx.fillText(`💰 造价:`, attrX, attrY);
  ctx.textAlign = 'right';
  ctx.fillText(`${towerDef.cost}`, panelX + panelW - 40, attrY);
  attrY += lineH;
  
  // 分隔线
  attrY += 10;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(panelX + 20, attrY);
  ctx.lineTo(panelX + panelW - 20, attrY);
  ctx.stroke();
  attrY += 15;
  
  // 攻击介绍 - 自适应居中
  ctx.textAlign = 'center';
  ctx.fillStyle = '#AAAAAA';
  ctx.font = 'bold 13px Arial';
  ctx.fillText('攻击介绍', width / 2, attrY);
  attrY += 20;
  
  ctx.fillStyle = '#ffffff';
  ctx.font = '13px Arial';
  wrapText(ctx, towerStats.description, width / 2, attrY, panelW - 60, 18);
  
  // 计算描述文本占用的高度
  const descLines = Math.ceil(towerStats.description.length / 18);
  const descHeight = descLines * 18;
  
  // 技能栏（预留）- 固定位置
  const skillY = panelY + panelH - 70;
  ctx.fillStyle = '#666666';
  ctx.font = '12px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('技能槽（未解锁）', width / 2, skillY);
  
  // 关闭提示 - 固定在底部
  const closeY = panelY + panelH - 25;
  ctx.fillStyle = '#888888';
  ctx.font = '11px Arial';
  ctx.fillText('点击任意位置关闭', width / 2, closeY);
}

/**
 * 自动换行文本
 */
function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split('');
  let line = '';
  let currentY = y;
  
  for (let i = 0; i < words.length; i++) {
    const testLine = line + words[i];
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && i > 0) {
      ctx.fillText(line, x, currentY);
      line = words[i];
      currentY += lineHeight;
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line, x, currentY);
}

/**
 * 获取塔的详细属性（纯函数）
 */
function getTowerStats(type) {
  const stats = {
    triangle: { hp: 100, damage: 20, range: 200, attackSpeed: 0.5, description: '快速射击，对单个目标造成持续伤害。适合应对大量敌人。' },
    circle: { hp: 150, damage: 35, range: 200, attackSpeed: 1.5, description: '圆塔攻击命中目标时触发二段爆炸，对周围敌人造成25%溅射伤害。' },
    hexagon: { hp: 200, damage: 50, range: 200, attackSpeed: 1.2, description: '强力单体攻击，对单一目标造成大量伤害。适合对付高血量敌人。' },
    square: { hp: 220, damage: 55, range: 200, attackSpeed: 1.0, description: '正方塔，均衡的单体输出，适合应对各类敌人。' },
    trapezoid: { hp: 230, damage: 45, range: 200, attackSpeed: 1.1, description: '梯塔，稳定的输出能力，适合中期使用。' },
    semicircle: { hp: 130, damage: 2, range: 200, attackSpeed: 0.15, description: '半圆塔发射持续直线激光，连接目标造成持续伤害。' },
    sector: { hp: 180, damage: 40, range: 250, attackSpeed: 2.0, description: '扇塔攻击扇形范围，AOE伤害，适合应对密集敌人群。' },
    long_rectangle: { hp: 250, damage: 80, range: 200, attackSpeed: 2.0, description: '超级火炮，对目标造成巨额伤害。适合对付BOSS级别敌人。' },
  };
  return stats[type] || stats.triangle;
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

  // 屏幕中心波次显示 - 向上偏移
  const centerLineY = height / 2 - 40;
  const waveText = `第 ${game.currentWave} 波`;
  
  // 测量文本宽度，自适应背景
  const tempMetrics = ctx.measureText(waveText);
  const textWidth = tempMetrics.width || 80;
  const bgWidth = textWidth + 60;
  const bgHeight = 40;
  const bgX = width / 2 - bgWidth / 2;
  const bgY = centerLineY - bgHeight / 2;
  
  // 自适应背景方块
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.beginPath();
  ctx.roundRect(bgX, bgY, bgWidth, bgHeight, 8);
  ctx.fill();
  
  // 左右两条横线
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.lineWidth = 1;
  // 左边横线
  ctx.beginPath();
  ctx.moveTo(0, centerLineY);
  ctx.lineTo(bgX, centerLineY);
  ctx.stroke();
  // 右边横线
  ctx.beginPath();
  ctx.moveTo(bgX + bgWidth, centerLineY);
  ctx.lineTo(width, centerLineY);
  ctx.stroke();
  
  // 波次文字
  ctx.fillStyle = '#FFD700';
  ctx.font = 'bold 18px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(waveText, width / 2, centerLineY);

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

  // 底部栏
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.fillRect(0, height - 97, width, 97);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, height - 97);
  ctx.lineTo(width, height - 97);
  ctx.stroke();

  // 商店塔选择 - 从刷新后的塔池中获取
  const towerTypes = game.refreshTowerTypes;

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
      // 检查金币是否足够
      const canAfford = game.gold >= t.cost;
      
      // 绘制无填充的边框图标（根据塔类型）
      drawTowerIcon(ctx, x + slotWidth / 2, startY + 30, canAfford ? t.color : '#666666', type);

      // 金币文本 - 不足时显示为红色
      ctx.fillStyle = canAfford ? '#FFD700' : '#FF4444';
      ctx.font = '10px Arial';
      ctx.fillText(`💰${t.cost}`, x + slotWidth / 2, startY + 56);
      
      // 如果金币不足，槽位变灰
      if (!canAfford) {
        ctx.fillStyle = 'rgba(100, 100, 100, 0.3)';
        ctx.fill();
      }
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
  const canAffordRefresh = game.gold >= game.refreshCost;

  // 按钮背景 - 金币不足时变灰
  ctx.fillStyle = canAffordRefresh ? 'rgba(100, 200, 255, 0.25)' : 'rgba(100, 100, 100, 0.25)';
  ctx.strokeStyle = canAffordRefresh ? '#64C8FF' : '#666666';
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
  ctx.fillStyle = canAffordRefresh ? '#FFD700' : '#FF4444';
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

  // 绘制路径
  drawPath(game);

  // 绘制弹道
function drawProjectiles(game) {
    const ctx = game.ctx;
    for (const proj of game.projectiles) {
      if (!proj.alive) continue;

      ctx.save();
      
      // 绘制小型塔图标作为弹道
      ctx.fillStyle = proj.color;
      ctx.globalAlpha = 0.9;
      
      const size = 6; // 弹道大小
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1;

      // 根据角度旋转
      ctx.translate(proj.x, proj.y);
      ctx.rotate(proj.angle || 0);

      // 根据类型绘制不同形状
      switch (proj.type) {
        case 'triangle':
          ctx.beginPath();
          ctx.moveTo(size, 0);
          ctx.lineTo(-size, size);
          ctx.lineTo(-size, -size);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          break;

        case 'circle':
          // 圆塔弹道：更明显的圆形弹道
          ctx.beginPath();
          ctx.arc(0, 0, size + 2, 0, Math.PI * 2);
          ctx.fillStyle = proj.color;
          ctx.fill();
          ctx.strokeStyle = '#FFFFFF';
          ctx.lineWidth = 1.5;
          ctx.stroke();
          
          // 添加发光效果
          ctx.shadowColor = proj.color;
          ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.arc(0, 0, size, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
          break;

        case 'sector':
          // 扇塔弹道：绘制小扇形
          ctx.fillStyle = proj.color;
          ctx.globalAlpha = 0.9;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.arc(0, 0, size * 1.5, proj.angle - Math.PI / 4, proj.angle + Math.PI / 4);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = '#FFFFFF';
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.globalAlpha = 1;
          break;

        case 'hexagon':
          ctx.beginPath();
          for (let i = 0; i < 6; i++) {
            const angle = (Math.PI / 3) * i - Math.PI / 6;
            const hx = size * Math.cos(angle);
            const hy = size * Math.sin(angle);
            if (i === 0) ctx.moveTo(hx, hy);
            else ctx.lineTo(hx, hy);
          }
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          break;

        case 'long_rectangle':
          ctx.fillRect(-size, -size / 2, size * 2, size);
          ctx.strokeRect(-size, -size / 2, size * 2, size);
          break;

        case 'square':
          // 正方塔弹道：旋转的正方形
          ctx.rotate(proj.rotationAngle || 0);
          ctx.fillRect(-size, -size, size * 2, size * 2);
          ctx.strokeRect(-size, -size, size * 2, size * 2);
          break;
      }

      ctx.restore();
    }

    // 绘制爆炸效果（圆塔）
    for (const effect of game.effects) {
      if (effect.type === 'explosion') {
        const alpha = effect.life / effect.maxLife;
        // 爆炸效果：从0放大到最大半径
        const progress = 1 - alpha; // 0→1
        const currentRadius = effect.maxRadius ? effect.maxRadius * progress : effect.radius;
        
        ctx.save();
        ctx.globalAlpha = alpha * 0.8;
        ctx.strokeStyle = effect.color;
        ctx.lineWidth = 3;
        ctx.shadowColor = effect.color;
        ctx.shadowBlur = 15;
        ctx.beginPath();
        ctx.arc(effect.x, effect.y, currentRadius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      
      // 绘制扇形效果（扇塔）
      if (effect.type === 'sector') {
        const alpha = effect.life / effect.maxLife;
        ctx.save();
        ctx.globalAlpha = alpha * 0.8;
        ctx.strokeStyle = effect.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(effect.x, effect.y);
        ctx.arc(effect.x, effect.y, effect.range, effect.angle - Math.PI / 4, effect.angle + Math.PI / 4);
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  // 绘制已放置塔的攻击范围（选中时显示）
  if (game.selectedTower) {
    const tower = game.selectedTower;
    ctx.save();
    ctx.strokeStyle = 'rgba(100, 200, 255, 0.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.arc(tower.x, tower.y, 200, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // 绘制槽位
  drawSlots(game);

  // 绘制塔
  for (const tower of game.towers) {
    drawTower(ctx, game, tower);
  }

  // 绘制怪物（生命值低于100%的优先显示）
  const damagedEnemies = game.enemies.filter(e => e.alive && e.hp < e.maxHp);
  const fullHpEnemies = game.enemies.filter(e => e.alive && e.hp >= e.maxHp);
  
  for (const enemy of fullHpEnemies) {
    drawEnemy(game, enemy);
  }
  for (const enemy of damagedEnemies) {
    drawEnemy(game, enemy);
  }

  // 绘制弹道
  drawProjectiles(game);

  // 绘制激光效果（半圆塔）
  for (const effect of game.effects) {
    if (effect.type === 'laser') {
      const alpha = effect.life / effect.maxLife;
      ctx.save();
      ctx.globalAlpha = alpha * 0.6; // 降低透明度
      ctx.strokeStyle = effect.color;
      ctx.lineWidth = 1.5; // 减少厚度
      ctx.shadowColor = effect.color;
      ctx.shadowBlur = 4; // 削弱发光
      ctx.beginPath();
      ctx.moveTo(effect.x1, effect.y1);
      ctx.lineTo(effect.x2, effect.y2);
      ctx.stroke();
      ctx.restore();
    }
  }

  // 绘制拖拽预览
  drawDragPreview(game);

  // 绘制 UI
  drawUI(game);

  // 绘制属性面板（最后绘制，确保在最上层）
  if (game.showPanel) {
    drawTowerPanel(game);
  }
}

module.exports = {
  render,
  drawPath,
  drawSlots,
  drawEnemy,
  drawTowerIcon,
  drawTower,
  drawDragPreview,
  drawUI,
  drawTowerPanel,
  getTowerStats,
};
