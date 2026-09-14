// 渲染层：所有绘制函数从原 Game.draw* 抽离。
// 约定：每个绘制函数接收 game 实例，内部用 game.ctx / game.canvas；
// drawTowerIcon 为纯函数，直接吃 ctx。
const { SHOP_TOWERS, TOWER_DEFS, LAYOUT, TOWER_STATS } = require('./config');
const towerMod = require('./tower');
const { anchorPointOf } = require('./geometry');

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
  const time = Date.now() / 1000;
  
  for (const slot of game.slots) {
    ctx.save();
    
    // 放置槽位 - 浅蓝色边框
    ctx.fillStyle = slot.occupied ? 'rgba(100, 200, 255, 0.15)' : 'rgba(100, 200, 255, 0.05)';
    ctx.strokeStyle = game.selectedTowerType ? 'rgba(100, 200, 255, 0.6)' : 'rgba(100, 200, 255, 0.25)';
    ctx.lineWidth = 2;

    ctx.fillRect(slot.x, slot.y, slot.size, slot.size);
    ctx.strokeRect(slot.x, slot.y, slot.size, slot.size);
    
    // 如果有塔，绘制等级光晕效果
    if (slot.occupied && slot.tower) {
      const tower = slot.tower;
      if (tower.level > 0) {
        // 等级越高，光晕越强
        const glowIntensity = Math.min(tower.level / 6, 1);
        const pulse = 0.5 + 0.5 * Math.sin(time * 3); // 0~1 的脉动
        const alpha = glowIntensity * 0.3 * pulse;
        
        // 光晕范围
        const glowSize = slot.size / 2 + 8;
        const gradient = ctx.createRadialGradient(
          slot.x + slot.size / 2, slot.y + slot.size / 2, slot.size / 4,
          slot.x + slot.size / 2, slot.y + slot.size / 2, glowSize
        );
        gradient.addColorStop(0, `rgba(255, 215, 0, ${alpha})`);
        gradient.addColorStop(1, 'rgba(255, 215, 0, 0)');
        
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(slot.x + slot.size / 2, slot.y + slot.size / 2, glowSize, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    
    // 绘制点击波纹效果
    if (game.clickEffect && 
        !slot.occupied &&
        Math.abs(game.clickEffect.x - (slot.x + slot.size / 2)) < 5 &&
        Math.abs(game.clickEffect.y - (slot.y + slot.size / 2)) < 5) {
      const elapsed = Date.now() - game.clickEffect.startTime;
      const progress = elapsed / game.clickEffect.duration;
      
      if (progress < 1) {
        const alpha = (1 - progress) * 0.8;
        const radius = slot.size / 2 * progress;
        
        ctx.strokeStyle = `rgba(100, 200, 255, ${alpha})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(game.clickEffect.x, game.clickEffect.y, radius, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        // 效果结束，清除
        game.clickEffect = null;
      }
    }
    
    ctx.restore();
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
 * 绘制五角星图案（用作等级/阶段星星显示，替代文本字符⭐）
 * @param {object} ctx 画布
 * @param {number} cx 中心x
 * @param {number} cy 中心y
 * @param {number} outerR 外接圆半径
 * @param {string} color 填充色
 */
function drawStar(ctx, cx, cy, outerR, color) {
  const innerR = outerR * 0.38;
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? outerR : innerR;
    const angle = (Math.PI * i) / 5 - Math.PI / 2;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
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
  
  // 查找塔所在的槽位，用于UI定位
  let slot = null;
  for (const s of game.slots) {
    if (s.tower === tower) {
      slot = s;
      break;
    }
  }
  
  // 绘制等级星星（图案五角星，顶部相对槽位顶边）
  if (tower.level > 0 && slot) {
    // level>=6 显示单个大星，否则显示 level 颗小星
    const big = tower.level >= 6;
    const count = big ? 1 : tower.level;
    const outerR = big ? 9 : 6;
    const spacing = big ? 0 : 13;
    const starTop = anchorPointOf(slot, 'top', { y: -12 });
    const centerY = starTop.y + outerR; // 五角星外顶点对齐槽位顶边
    const totalWidth = count * spacing;
    const startX = tower.x - totalWidth / 2;
    for (let i = 0; i < count; i++) {
      drawStar(ctx, startX + i * spacing + outerR, centerY, outerR, '#FFD700');
    }
  }
  
  // 绘制阶段星星（图案五角星，顶部相对槽位顶边）
  if (tower.stage > 0 && slot) {
    const count = tower.stage;
    const outerR = 5;
    const spacing = 11;
    const stageTop = anchorPointOf(slot, 'top', { y: -2 });
    const centerY = stageTop.y + outerR;
    const totalWidth = count * spacing;
    const startX = tower.x - totalWidth / 2;
    for (let i = 0; i < count; i++) {
      drawStar(ctx, startX + i * spacing + outerR, centerY, outerR, '#FF69B4');
    }
  }
  
  // 绘制攻击增幅标识（底部相对槽位底边，textBaseline='bottom' 使其底边对齐槽位底部）
  if (tower.attackPowerBoost > 0 && slot) {
    const boostText = `+${tower.attackPowerBoost}%`;
    const textBottom = anchorPointOf(slot, 'bottom', { y: 4 });
    ctx.fillStyle = '#00FF00';
    ctx.font = 'bold 10px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(boostText, tower.x, textBottom.y);
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
  
  // 攻击力（含等级加成和攻击增幅）
  const attackBonus = tower ? towerMod.getLevelAttackBonus(tower.level) : 1;
  const attackPowerBoost = tower ? tower.attackPowerBoost : 0;
  const boostPercent = attackPowerBoost > 0 ? `(+${attackPowerBoost}%)` : '';
  const baseDamage = towerStats.damage;
  const finalDamage = tower ? towerMod.calculateFinalDamage(baseDamage, tower.level, attackPowerBoost) : Math.floor(baseDamage * attackBonus);
  
  ctx.textAlign = 'left';
  ctx.fillStyle = '#FF6B6B';
  ctx.fillText(`攻击力:`, attrX, attrY);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'right';
  ctx.fillText(`${finalDamage}${boostPercent ? ` ${boostPercent}` : ''}`, panelX + panelW - 40, attrY);
  attrY += lineH;
  
  // 保存tower到game供后续使用
  game._currentPanelTower = tower;
  
  // 攻击间隔（秒）
  const attackInterval = towerStats.attackInterval || 1.0;
  
  ctx.textAlign = 'left';
  ctx.fillStyle = '#FF6B6B';
  ctx.fillText(`攻速:`, attrX, attrY);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'right';
  ctx.fillText(`每${attackInterval}秒`, panelX + panelW - 40, attrY);
  attrY += lineH;
  
  // 攻击速度（百分比显示）
  const attackSpeedMultiplier = tower ? tower.attackSpeedMultiplier : towerStats.attackSpeedMultiplier;
  const attackSpeedPercent = Math.floor((attackSpeedMultiplier / 100) * 100);
  
  ctx.textAlign = 'left';
  ctx.fillStyle = '#FF6B6B';
  ctx.fillText(`攻速倍率:`, attrX, attrY);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'right';
  ctx.fillText(`${attackSpeedPercent}%`, panelX + panelW - 40, attrY);
  attrY += lineH;
  
  // 阶段
  const stageStars = tower && tower.stage > 0 ? towerMod.getStageStars(tower.stage) : '无';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#FF69B4';
  ctx.fillText(`阶段:`, attrX, attrY);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'right';
  ctx.fillText(stageStars, panelX + panelW - 40, attrY);
  attrY += lineH;
  
  // 攻击增幅
  if (tower && tower.attackPowerBoost > 0) {
    ctx.textAlign = 'left';
    ctx.fillStyle = '#00FF00';
    ctx.fillText(`攻击增幅:`, attrX, attrY);
    ctx.fillStyle = '#00FF00';
    ctx.textAlign = 'right';
    ctx.fillText(`+${tower.attackPowerBoost}%`, panelX + panelW - 40, attrY);
    attrY += lineH;
  }
  
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
 * 从配置中读取，与 TOWER_STATS 同步
 */
function getTowerStats(type) {
  return TOWER_STATS[type] || TOWER_STATS.triangle;
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

  ctx.restore();
}

/**
 * 绘制积分进度条（轨道 + 柔和渐变填充 + 描边）
 * @param {number} percent 填充比例 0~1
 * @param {string[]} gradient 渐变色列表（柔和色调，避免刺眼）
 * @param {boolean} fillFromRight true=从右向左填充（右侧镜像条）
 */
function drawScoreBar(ctx, x, y, w, h, percent, gradient, fillFromRight) {
  percent = Math.max(0, Math.min(1, percent || 0));
  if (w <= 0) return;

  // 轨道
  ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.beginPath();
  ctx.roundRect(x, y - h / 2, w, h, h / 2);
  ctx.fill();

  // 渐变填充
  if (percent > 0) {
    const fw = Math.max(h, w * percent); // 极小填充时保留圆点
    const fx = fillFromRight ? x + w - fw : x;
    const grad = ctx.createLinearGradient(fx, 0, fx + fw, 0);
    gradient.forEach((color, i) => grad.addColorStop(i / (gradient.length - 1), color));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(fx, y - h / 2, fw, h, h / 2);
    ctx.fill();
  }

  // 描边
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x, y - h / 2, w, h, h / 2);
  ctx.stroke();
}

/**
 * 获取玩家积分进度（0~1）
 * 玩家0（本地红色方）= 真实生存积分 lives / maxLives；玩家1（蓝色方，预留联机）暂用占位值
 */
function getPlayerScoreProgress(game, index) {
  // 玩家0（本地红色方）：真实生存积分进度
  if (index === 0 && game.maxLives > 0) {
    return Math.max(0, Math.min(1, game.lives / game.maxLives));
  }
  // 玩家1（蓝色方，预留联机）：暂无对手数据，保留占位演示值
  return 0.5;
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
  
  // 左右积分进度条：与关卡标题平行，同一条水平线，标题左右两边各一条
  // 左侧=玩家0 红色方（关卡标题 y 往下为红方区域），右侧=玩家1 蓝色方（反之为蓝方区域，预留联机）
  const barH = 10;      // 进度条高度
  const barEdge = 10;   // 距屏幕边缘
  const barGap = 10;    // 距关卡标题盒
  // 左侧：玩家0（红），填充方向 左→右
  drawScoreBar(
    ctx, barEdge, centerLineY,
    bgX - barGap - barEdge, barH,
    getPlayerScoreProgress(game, 0),
    ['#FF9E9E', '#E57373'], false
  );
  // 右侧：玩家1（蓝），填充方向 右→左
  const p1X = bgX + bgWidth + barGap;
  drawScoreBar(
    ctx, p1X, centerLineY,
    width - barEdge - p1X, barH,
    getPlayerScoreProgress(game, 1),
    ['#92C5FF', '#64B5F6'], true
  );
  
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
    const isSelected = game.dragging && game.dragFromShop && game.dragType === type;
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
    // 记录游戏结束界面按钮区域（用于点击检测）
    const centerY = height / 2 + 90;
    const btnW = 160;
    const btnH = 50;
    const startX = (width - btnW * 2 - 20) / 2;

    game.gameOverButtons = {
      restart: { x: startX, y: centerY, w: btnW, h: btnH },
      watchContinue: { x: startX + btnW + 20, y: centerY, w: btnW, h: btnH },
    };

    // 半透明遮罩
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillRect(0, 0, width, height);

    // 游戏结束文字
    ctx.fillStyle = '#FF0000';
    ctx.font = 'bold 48px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('游戏结束', width / 2, height / 2 - 30);

    // 坚持波数
    ctx.fillStyle = '#ffffff';
    ctx.font = '24px Arial';
    ctx.fillText(`坚持波数: ${game.currentWave}`, width / 2, height / 2 + 20);

    if (game.watchingVideo) {
      // 正在观看视频 - 显示倒计时
      ctx.fillStyle = '#FFD700';
      ctx.font = 'bold 32px Arial';
      ctx.fillText(`视频倒计时: ${game.videoTimer}秒`, width / 2, centerY + 70);

      ctx.fillStyle = '#AAAAAA';
      ctx.font = '16px Arial';
      ctx.fillText('观看广告后可继续游戏', width / 2, centerY + 100);
    } else {
      // 重新开始按钮
      ctx.fillStyle = '#4CAF50';
      ctx.fillRect(game.gameOverButtons.restart.x, game.gameOverButtons.restart.y, btnW, btnH);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.strokeRect(game.gameOverButtons.restart.x, game.gameOverButtons.restart.y, btnW, btnH);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 20px Arial';
      ctx.fillText('重新开始', width / 2 - btnW / 2 - 10, centerY + btnH / 2);

      // 重新挑战按钮
      ctx.fillStyle = '#2196F3';
      ctx.fillRect(game.gameOverButtons.watchContinue.x, game.gameOverButtons.watchContinue.y, btnW, btnH);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.strokeRect(game.gameOverButtons.watchContinue.x, game.gameOverButtons.watchContinue.y, btnW, btnH);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 18px Arial';
      ctx.fillText('重新挑战', width / 2 + btnW / 2 + 10, centerY + btnH / 2 - 12);
      ctx.font = '14px Arial';
      ctx.fillText(`(${game.currentWave * 500}金币)`, width / 2 + btnW / 2 + 10, centerY + btnH / 2 + 10);
    }
  }
  
  // 胜利界面
  if (game.gameWon) {
    const centerY = height / 2 + 90;
    const btnW = 160;
    const btnH = 50;
    const startX = (width - btnW) / 2;

    game.gameOverButtons = {
      restart: { x: startX, y: centerY, w: btnW, h: btnH },
    };

    // 半透明遮罩
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillRect(0, 0, width, height);

    // 胜利文字
    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold 48px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('胜利！', width / 2, height / 2 - 30);

    // 坚持波数
    ctx.fillStyle = '#ffffff';
    ctx.font = '24px Arial';
    ctx.fillText(`坚持波数: ${game.currentWave}`, width / 2, height / 2 + 20);

    // 重新开始按钮
    ctx.fillStyle = '#4CAF50';
    ctx.fillRect(game.gameOverButtons.restart.x, game.gameOverButtons.restart.y, btnW, btnH);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.strokeRect(game.gameOverButtons.restart.x, game.gameOverButtons.restart.y, btnW, btnH);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px Arial';
    ctx.fillText('重新开始', width / 2, centerY + btnH / 2);
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
