// 渲染层：所有绘制函数从原 Game.draw* 抽离。
// 约定：每个绘制函数接收 game 实例，内部用 game.ctx / game.canvas；
// drawTowerIcon 为纯函数，直接吃 ctx。
const { SHOP_TOWERS, TOWER_DEFS, LAYOUT, TOWER_STATS } = require('./config');
const towerMod = require('./tower');
const { anchorPointOf } = require('./geometry');

// ========== 视觉风格 Token（design tokens，全 UI 唯一真源） ==========
// 所有 UI 元素（进度条 / 槽位 / 商店 / 面板 / 按钮 / 胜负界面）都从这里取色，
// 改一处即全局生效。战场身份色（塔色 / 怪物色）在 config.js 定义，不在此列。
// 阵营语义：我方 = 红，对方 = 蓝（左右生存条、底部栏渐变皆基于此）。
const THEME = {
  // 阵营色（solid=实色，light=亮色，用于渐变两端）
  team: {
    red:  { solid: '#E57373', light: '#FF9E9E' },
    blue: { solid: '#64B5F6', light: '#92C5F6' },
  },
  // 强调色
  accent: {
    gold:     '#FFD700',  // 金币 / 等级星 / 选中高亮
    pink:     '#FF69B4',  // 阶段星
    green:    '#4CAF50',  // 增益（攻击增幅 / 路径起点 / 确认按钮）
    danger:   '#FF4444',  // 危险 / 金币不足
    highlight: 'rgba(229, 115, 115, 0.45)',  // 我方交互高亮（选中范围圈 / 槽位高亮）
  },
  // 统一细白描边
  border: {
    subtle: 'rgba(255, 255, 255, 0.15)',  // 弱：空槽 / 禁用
    normal: 'rgba(255, 255, 255, 0.30)',  // 常规：槽位 / 按钮
    strong: 'rgba(255, 255, 255, 0.45)',  // 强调：标题药丸 / 分隔线
  },
  // 轨道 / 面板底色
  track: {
    faint: 'rgba(255, 255, 255, 0.05)',
    soft:  'rgba(255, 255, 255, 0.10)',
    bar:   'rgba(255, 255, 255, 0.12)',   // 进度条轨道
  },
  // 文字灰阶
  text: {
    primary:   '#ffffff',
    secondary: '#AAAAAA',
    dim:       '#888888',
    off:       '#666666',
  },
  // 圆角
  radius: {
    small:  8,
    medium: 10,   // 槽位 / 按钮
  },
};

/**
 * 阵营横向渐变：我方红(左) → 中性 → 对方蓝(右)，统一所有"对阵"背景。
 * @param {number} alpha 整体透明度缩放（1=满，0.3=柔和底栏）
 * @returns 可直接赋给 ctx.fillStyle 的 CanvasGradient
 */
function teamBandGradient(ctx, x0, x1, alpha) {
  const grad = ctx.createLinearGradient(x0, 0, x1, 0);
  grad.addColorStop(0,   `rgba(229, 115, 115, ${0.8 * alpha})`);
  grad.addColorStop(0.5, `rgba(255, 255, 255, ${0.3 * alpha})`);
  grad.addColorStop(1,   `rgba(100, 181, 246, ${0.8 * alpha})`);
  return grad;
}

function drawPath(game) {
  const ctx = game.ctx;
  ctx.save();

  // 细线路径
  ctx.strokeStyle = THEME.text.dim;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(game.pathPoints[0].x, game.pathPoints[0].y);
  for (let i = 1; i < game.pathPoints.length; i++) {
    ctx.lineTo(game.pathPoints[i].x, game.pathPoints[i].y);
  }
  ctx.stroke();

  // 起点文字（敌方出生 = 对方蓝）
  ctx.fillStyle = THEME.team.blue.solid;
  ctx.font = 'bold 14px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('起', game.pathStart.x, game.pathStart.y);

  // 终点文字（我方基地 = 我方红）
  ctx.fillStyle = THEME.team.red.solid;
  ctx.fillText('终', game.pathEnd.x, game.pathEnd.y);

  ctx.restore();
}

function drawSlots(game) {
  const ctx = game.ctx;
  const time = Date.now() / 1000;
  
  for (const slot of game.slots) {
    ctx.save();
    
    // 放置槽位 - 我方红（我方建造区，区别于敌方蓝）
    ctx.fillStyle = slot.occupied ? 'rgba(229, 115, 115, 0.15)' : 'rgba(229, 115, 115, 0.05)';
    ctx.strokeStyle = game.selectedTowerType ? 'rgba(229, 115, 115, 0.6)' : THEME.border.normal;
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.roundRect(slot.x, slot.y, slot.size, slot.size, THEME.radius.small);
    ctx.fill();
    ctx.stroke();
    
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
        
        ctx.strokeStyle = `rgba(229, 115, 115, ${alpha})`;
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

    if (enemy.tier === 1) textColor = THEME.accent.gold;
    else if (enemy.tier === 2) textColor = THEME.accent.pink;
    else if (enemy.tier === 3) textColor = THEME.accent.danger;
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
      drawStar(ctx, startX + i * spacing + outerR, centerY, outerR, THEME.accent.gold);
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
      drawStar(ctx, startX + i * spacing + outerR, centerY, outerR, THEME.accent.pink);
    }
  }
  
  // 绘制攻击增幅标识（底部相对槽位底边，textBaseline='bottom' 使其底边对齐槽位底部）
  if (tower.attackPowerBoost > 0 && slot) {
    const boostText = `+${tower.attackPowerBoost}%`;
    const textBottom = anchorPointOf(slot, 'bottom', { y: 4 });
    ctx.fillStyle = THEME.accent.green;
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
  ctx.roundRect(panelX, panelY, panelW, panelH, THEME.radius.medium);
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
    ctx.fillStyle = THEME.accent.gold;
    ctx.font = '14px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(stars, width / 2, panelY + 50);
  }
  
  // 分隔线
  ctx.strokeStyle = THEME.border.normal;
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
  ctx.fillStyle = THEME.accent.danger;
  ctx.fillText(`攻击力:`, attrX, attrY);
  ctx.fillStyle = THEME.text.primary;
  ctx.textAlign = 'right';
  ctx.fillText(`${finalDamage}${boostPercent ? ` ${boostPercent}` : ''}`, panelX + panelW - 40, attrY);
  attrY += lineH;
  
  // 保存tower到game供后续使用
  game._currentPanelTower = tower;
  
  // 攻击间隔（秒）
  const attackInterval = towerStats.attackInterval || 1.0;
  
  ctx.textAlign = 'left';
  ctx.fillStyle = THEME.accent.danger;
  ctx.fillText(`攻速:`, attrX, attrY);
  ctx.fillStyle = THEME.text.primary;
  ctx.textAlign = 'right';
  ctx.fillText(`每${attackInterval}秒`, panelX + panelW - 40, attrY);
  attrY += lineH;
  
  // 攻击速度（百分比显示）
  const attackSpeedMultiplier = tower ? tower.attackSpeedMultiplier : towerStats.attackSpeedMultiplier;
  const attackSpeedPercent = Math.floor((attackSpeedMultiplier / 100) * 100);
  
  ctx.textAlign = 'left';
  ctx.fillStyle = THEME.accent.danger;
  ctx.fillText(`攻速倍率:`, attrX, attrY);
  ctx.fillStyle = THEME.text.primary;
  ctx.textAlign = 'right';
  ctx.fillText(`${attackSpeedPercent}%`, panelX + panelW - 40, attrY);
  attrY += lineH;
  
  // 阶段
  const stageStars = tower && tower.stage > 0 ? towerMod.getStageStars(tower.stage) : '无';
  ctx.textAlign = 'left';
  ctx.fillStyle = THEME.accent.pink;
  ctx.fillText(`阶段:`, attrX, attrY);
  ctx.fillStyle = THEME.text.primary;
  ctx.textAlign = 'right';
  ctx.fillText(stageStars, panelX + panelW - 40, attrY);
  attrY += lineH;
  
  // 攻击增幅
  if (tower && tower.attackPowerBoost > 0) {
    ctx.textAlign = 'left';
    ctx.fillStyle = THEME.accent.green;
    ctx.fillText(`攻击增幅:`, attrX, attrY);
    ctx.fillStyle = THEME.accent.green;
    ctx.textAlign = 'right';
    ctx.fillText(`+${tower.attackPowerBoost}%`, panelX + panelW - 40, attrY);
    attrY += lineH;
  }
  
  // 造价
  ctx.textAlign = 'left';
  ctx.fillStyle = THEME.accent.gold;
  ctx.fillText(`💰 造价:`, attrX, attrY);
  ctx.textAlign = 'right';
  ctx.fillText(`${towerDef.cost}`, panelX + panelW - 40, attrY);
  attrY += lineH;
  
  // 分隔线
  attrY += 10;
  ctx.strokeStyle = THEME.border.normal;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(panelX + 20, attrY);
  ctx.lineTo(panelX + panelW - 20, attrY);
  ctx.stroke();
  attrY += 15;
  
  // 攻击介绍 - 自适应居中
  ctx.textAlign = 'center';
  ctx.fillStyle = THEME.text.secondary;
  ctx.font = 'bold 13px Arial';
  ctx.fillText('攻击介绍', width / 2, attrY);
  attrY += 20;
  
  ctx.fillStyle = THEME.text.primary;
  ctx.font = '13px Arial';
  wrapText(ctx, towerStats.description, width / 2, attrY, panelW - 60, 18);
  
  // 计算描述文本占用的高度
  const descLines = Math.ceil(towerStats.description.length / 18);
  const descHeight = descLines * 18;
  
  // 技能栏（预留）- 固定位置
  const skillY = panelY + panelH - 70;
  ctx.fillStyle = THEME.text.off;
  ctx.font = '12px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('技能槽（未解锁）', width / 2, skillY);
  
  // 关闭提示 - 固定在底部
  const closeY = panelY + panelH - 25;
  ctx.fillStyle = THEME.text.dim;
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
    ctx.fillStyle = THEME.accent.danger;
  } else {
    ctx.fillStyle = towerConfig.color;
  }
  ctx.strokeStyle = THEME.text.primary;
  ctx.lineWidth = 2;
  // 绘制对应类型的塔图标（使用 drawTowerIcon 显示具体形状）
  drawTowerIcon(ctx, game.dragX, game.dragY, THEME.text.primary, game.dragType);

  ctx.restore();
}

/**
 * 绘制生存条（轨道 + 柔和渐变填充 + 描边）
 * 语义：玩家剩余生存积分（生命）的进度，归零判负——是"剩余量"而非"得分"。
 * @param {number} percent 填充比例 0~1
 * @param {string[]} gradient 渐变色列表（柔和色调，避免刺眼）
 * @param {boolean} fillFromRight true=从右向左填充（右侧镜像条）
 */
function drawLifeBar(ctx, x, y, w, h, percent, gradient, fillFromRight) {
  percent = Math.max(0, Math.min(1, percent || 0));
  if (w <= 0) return;

  // 轨道
  ctx.fillStyle = THEME.track.bar;
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
  ctx.strokeStyle = THEME.border.normal;
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

/**
 * 绘制波次标题：药丸形背景 + 红→蓝柔和渐变，风格与左右生存条统一
 * @param {object} ctx 画布
 * @param {number} cx 中心x
 * @param {number} cy 中心y
 * @param {number} w 背景宽
 * @param {number} h 背景高
 * @param {string} text 标题文字
 */
function drawWaveTitle(ctx, cx, cy, w, h, text) {
  const x = cx - w / 2;
  const y = cy - h / 2;

  // 药丸形背景：红 → 中性 → 蓝 柔和渐变（统一阵营色）
  ctx.fillStyle = teamBandGradient(ctx, x, x + w, 1);
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h / 2);
  ctx.fill();

  // 描边
  ctx.strokeStyle = THEME.border.strong;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h / 2);
  ctx.stroke();

  // 标题文字
  ctx.fillStyle = THEME.text.primary;
  ctx.font = 'bold 18px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, cy);
}

/**
 * 绘制刷新图标（圆环箭头，标准刷新按钮样式）
 * @param {object} ctx 画布
 * @param {number} cx 中心x
 * @param {number} cy 中心y
 * @param {number} r 半径
 * @param {string} color 颜色
 */
function drawRefreshIcon(ctx, cx, cy, r, color) {
  // 270° 圆弧：从顶部顺时针经过右、下，到左侧
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(cx, cy, r, -Math.PI / 2, Math.PI);
  ctx.stroke();

  // 箭头：位于圆弧终点（左侧），沿切线方向朝上
  const ax = cx - r;
  const ay = cy;
  ctx.beginPath();
  ctx.moveTo(ax, ay - 6);
  ctx.lineTo(ax - 5, ay + 1);
  ctx.lineTo(ax + 5, ay + 1);
  ctx.closePath();
  ctx.fill();
}

function drawUI(game) {
  const ctx = game.ctx;
  const canvas = game.canvas;
  const width = canvas.width;
  const height = canvas.height;

  // 屏幕中心波次标题 - 向上偏移
  const centerLineY = height / 2 - 40;
  const waveText = `第 ${game.currentWave} 波`;

  // 测量文本宽度，自适应背景（标题与左右积分条同一条水平线）
  ctx.font = 'bold 18px Arial';
  const textWidth = ctx.measureText(waveText).width || 80;
  const bgWidth = textWidth + 60;
  const bgHeight = 40;
  const bgX = width / 2 - bgWidth / 2;

  // 左右生存条：左侧=我方（红，填充 左→右），右侧=对方（蓝，填充 右→左，预留联机）
  const barH = 10;      // 生存条高度
  const barEdge = 10;   // 距屏幕边缘
  const barGap = 10;    // 距标题
  // 左侧：我方（红），填充方向 左→右
  drawLifeBar(
    ctx, barEdge, centerLineY,
    bgX - barGap - barEdge, barH,
    getPlayerScoreProgress(game, 0),
    [THEME.team.red.light, THEME.team.red.solid], false
  );
  // 右侧：对方（蓝），填充方向 右→左
  const p1X = bgX + bgWidth + barGap;
  drawLifeBar(
    ctx, p1X, centerLineY,
    width - barEdge - p1X, barH,
    getPlayerScoreProgress(game, 1),
    [THEME.team.blue.light, THEME.team.blue.solid], true
  );

  // 标题：药丸形 + 红→蓝柔和渐变，风格与左右生存条统一
  drawWaveTitle(ctx, width / 2, centerLineY, bgWidth, bgHeight, waveText);

  // 顶部状态栏 - 移除金币，只保留生命
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.fillRect(0, 0, width, 30);

  ctx.fillStyle = THEME.text.primary;
  ctx.font = 'bold 11px Arial';
  ctx.textBaseline = 'middle';

  // 生命
  ctx.textAlign = 'center';
  ctx.fillText(`❤️ ${game.lives}`, width / 2, 15);

  // 分隔线
  ctx.strokeStyle = THEME.border.subtle;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, 30);
  ctx.lineTo(width, 30);
  ctx.stroke();

  // 底部栏 - 红→中性→蓝柔和渐变，与生存条风格统一
  const barTop = height - 97;
  ctx.fillStyle = teamBandGradient(ctx, 0, width, 0.4);
  ctx.fillRect(0, barTop, width, 97);

  // 顶部描边（与生存条描边一致）
  ctx.strokeStyle = THEME.border.normal;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, barTop + 0.5);
  ctx.lineTo(width, barTop + 0.5);
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

    // 槽位 - 方形 + 柔和渐变，与生存条风格统一
    if (isSelected) {
      // 选中：柔和金色高亮
      const selGrad = ctx.createLinearGradient(x, 0, x + slotWidth, 0);
      selGrad.addColorStop(0, 'rgba(255, 215, 155, 0.45)');
      selGrad.addColorStop(1, 'rgba(255, 215, 0, 0.30)');
      ctx.fillStyle = selGrad;
      ctx.strokeStyle = 'rgba(255, 215, 0, 0.75)';
      ctx.lineWidth = 2;
    } else {
      // 普通：柔和白色渐变（与生存条轨道同色系）
      const slotGrad = ctx.createLinearGradient(x, startY, x, startY + slotHeight);
      if (isEmpty) {
        slotGrad.addColorStop(0, 'rgba(255, 255, 255, 0.08)');
        slotGrad.addColorStop(1, 'rgba(255, 255, 255, 0.04)');
      } else {
        slotGrad.addColorStop(0, 'rgba(255, 255, 255, 0.18)');
        slotGrad.addColorStop(1, 'rgba(255, 255, 255, 0.10)');
      }
      ctx.fillStyle = slotGrad;
      ctx.strokeStyle = isEmpty ? THEME.border.subtle : THEME.border.normal;
      ctx.lineWidth = 1;
    }

    // 方形槽位（小圆角）
    ctx.beginPath();
    ctx.roundRect(x, startY, slotWidth, slotHeight, THEME.radius.medium);
    ctx.fill();
    ctx.stroke();

    if (!isEmpty) {
      // 检查金币是否足够
      const canAfford = game.gold >= t.cost;
      
      // 绘制无填充的边框图标（根据塔类型）
      drawTowerIcon(ctx, x + slotWidth / 2, startY + 30, canAfford ? t.color : THEME.text.off, type);

      // 金币文本 - 不足时显示为红色
      ctx.fillStyle = canAfford ? THEME.accent.gold : THEME.accent.danger;
      ctx.font = '10px Arial';
      ctx.fillText(`💰${t.cost}`, x + slotWidth / 2, startY + 56);
      
      // 如果金币不足，槽位变灰
      if (!canAfford) {
        ctx.fillStyle = 'rgba(100, 100, 100, 0.3)';
        ctx.fill();
      }
    } else {
      // 显示空槽提示
      ctx.fillStyle = THEME.text.off;
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

  // 按钮背景 - 方形 + 柔和渐变（与生存条风格统一），金币不足时变灰
  if (canAffordRefresh) {
    const btnGrad = ctx.createLinearGradient(btnX, btnY, btnX, btnY + btnH);
    btnGrad.addColorStop(0, 'rgba(146, 197, 255, 0.40)');
    btnGrad.addColorStop(1, 'rgba(100, 181, 246, 0.25)');
    ctx.fillStyle = btnGrad;
    ctx.strokeStyle = 'rgba(146, 197, 255, 0.7)';
  } else {
    ctx.fillStyle = THEME.track.soft;
    ctx.strokeStyle = THEME.border.subtle;
  }
  ctx.lineWidth = 1.5;

  // 方形按钮（与槽位一致）
  ctx.beginPath();
  ctx.roundRect(btnX, btnY, btnW, btnH, THEME.radius.medium);
  ctx.fill();
  ctx.stroke();

  // 刷新图标（圆环箭头，标准刷新按钮样式）
  drawRefreshIcon(ctx, btnX + btnW / 2, btnY + 24, 10, canAffordRefresh ? THEME.text.primary : 'rgba(255, 255, 255, 0.55)');

  // 显示当前金币/刷新所需金币
  ctx.fillStyle = canAffordRefresh ? THEME.accent.gold : THEME.accent.danger;
  ctx.font = 'bold 10px Arial';
  ctx.fillText(`${game.gold}/${game.refreshCost}`, btnX + btnW / 2, btnY + 48);

  ctx.fillStyle = THEME.text.secondary;
  ctx.font = '9px Arial';
  ctx.fillText('刷新', btnX + btnW / 2, btnY + 62);

  // ========== 结算界面（失败 / 胜利）：与游戏内 UI 统一风格 ==========
  const showWin = !!game.gameWon;
  const showFail = game.lives <= 0 && !showWin;
  if (showFail || showWin) {
    // 全屏遮罩
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillRect(0, 0, width, height);

    // 居中圆角面板（自适应宽度，风格与塔属性面板一致）
    const panelW = Math.min(360, width - 32);
    const panelH = 290;
    const panelX = (width - panelW) / 2;
    const panelY = (height - panelH) / 2;
    const accent = showFail
      ? { top: 'rgba(229, 115, 115, 0.14)', bottom: 'rgba(229, 115, 115, 0.05)', stroke: 'rgba(229, 115, 115, 0.5)' }
      : { top: 'rgba(255, 215, 0, 0.14)', bottom: 'rgba(255, 215, 0, 0.04)', stroke: 'rgba(255, 215, 0, 0.55)' };
    const panelGrad = ctx.createLinearGradient(panelX, panelY, panelX, panelY + panelH);
    panelGrad.addColorStop(0, accent.top);
    panelGrad.addColorStop(1, accent.bottom);
    ctx.fillStyle = panelGrad;
    ctx.strokeStyle = accent.stroke;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(panelX, panelY, panelW, panelH, THEME.radius.medium + 4);
    ctx.fill();
    ctx.stroke();

    const cx = width / 2;

    // 标题药丸（风格与波次标题一致）
    const titleText = showFail ? '游戏结束' : '胜利！';
    const titleTop = showFail ? 'rgba(229, 115, 115, 0.55)' : 'rgba(255, 215, 0, 0.55)';
    const titleBottom = showFail ? 'rgba(255, 68, 68, 0.35)' : 'rgba(255, 170, 0, 0.35)';
    drawPillTitle(ctx, cx, panelY + 56, titleText, titleTop, titleBottom, panelW - 24);

    // 坚持波数
    ctx.fillStyle = THEME.text.secondary;
    ctx.font = '16px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`坚持波数: ${game.currentWave}`, cx, panelY + 120);

    if (showWin) {
      // 胜利：单个"重新开始"按钮（主操作 = 增益绿）
      const btnW = Math.min(240, panelW - 48);
      const btnH = 54;
      const btnX = (width - btnW) / 2;
      const btnY = panelY + panelH - 90;
      game.gameOverButtons = { restart: { x: btnX, y: btnY, w: btnW, h: btnH } };
      drawButton(ctx, {
        x: btnX, y: btnY, w: btnW, h: btnH,
        top: 'rgba(165, 214, 167, 0.5)', bottom: 'rgba(76, 175, 80, 0.32)',
        stroke: 'rgba(165, 214, 167, 0.8)',
        label: '重新开始', labelColor: THEME.text.primary, fontSize: 18,
      });
    } else if (game.watchingVideo) {
      // 失败 - 观看视频倒计时
      game.gameOverButtons = {};
      ctx.fillStyle = THEME.accent.gold;
      ctx.font = 'bold 26px Arial';
      ctx.fillText(`视频倒计时: ${game.videoTimer} 秒`, cx, panelY + 190);
      ctx.fillStyle = THEME.text.secondary;
      ctx.font = '14px Arial';
      ctx.fillText('观看广告后可继续游戏', cx, panelY + 226);
    } else {
      // 失败 - 双按钮：重新开始（主 = 增益绿）/ 重新挑战（次 = 对方蓝）
      const gap = 16;
      const inner = panelW - 40;
      const btnW = (inner - gap) / 2;
      const btnH = 54;
      const totalW = btnW * 2 + gap;
      const x1 = (width - totalW) / 2;
      const x2 = x1 + btnW + gap;
      const btnY = panelY + panelH - 90;
      game.gameOverButtons = {
        restart: { x: x1, y: btnY, w: btnW, h: btnH },
        watchContinue: { x: x2, y: btnY, w: btnW, h: btnH },
      };
      drawButton(ctx, {
        x: x1, y: btnY, w: btnW, h: btnH,
        top: 'rgba(165, 214, 167, 0.5)', bottom: 'rgba(76, 175, 80, 0.32)',
        stroke: 'rgba(165, 214, 167, 0.8)',
        label: '重新开始', labelColor: THEME.text.primary, fontSize: 16,
      });
      drawButton(ctx, {
        x: x2, y: btnY, w: btnW, h: btnH,
        top: 'rgba(146, 197, 255, 0.5)', bottom: 'rgba(100, 181, 246, 0.32)',
        stroke: 'rgba(146, 197, 255, 0.8)',
        label: '重新挑战', labelColor: THEME.text.primary, fontSize: 15,
        subLabel: `(${game.currentWave * 500} 金币)`, subColor: THEME.text.secondary,
      });
    }
  }
}

/**
 * 绘制结算标题药丸：圆角 + 柔和横向渐变 + 强描边，风格与波次标题（drawWaveTitle）一致。
 * @param {number} maxW 药丸最大宽度（超出则收敛，保证不越界）
 */
function drawPillTitle(ctx, cx, cy, text, top, bottom, maxW) {
  ctx.font = 'bold 22px Arial';
  const tw = ctx.measureText(text).width || 80;
  const w = Math.min(maxW, tw + 44);
  const h = 42;
  const x = cx - w / 2;
  const y = cy - h / 2;

  const grad = ctx.createLinearGradient(x, 0, x + w, 0);
  grad.addColorStop(0, top);
  grad.addColorStop(1, bottom);
  ctx.fillStyle = grad;
  ctx.strokeStyle = THEME.border.strong;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h / 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = THEME.text.primary;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, cy);
}

/**
 * 绘制统一风格按钮：圆角 + 柔和纵向渐变 + 主题描边（风格与商店槽位 / 刷新按钮一致）。
 * 支持可选副文案（subLabel），主副文案垂直居中排布。
 */
function drawButton(ctx, o) {
  const { x, y, w, h } = o;
  const grad = ctx.createLinearGradient(x, y, x, y + h);
  grad.addColorStop(0, o.top);
  grad.addColorStop(1, o.bottom);
  ctx.fillStyle = grad;
  ctx.strokeStyle = o.stroke;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, THEME.radius.medium);
  ctx.fill();
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (o.subLabel) {
    ctx.fillStyle = o.labelColor;
    ctx.font = `bold ${o.fontSize || 16}px Arial`;
    ctx.fillText(o.label, x + w / 2, y + h / 2 - 9);
    ctx.fillStyle = o.subColor || THEME.text.secondary;
    ctx.font = '12px Arial';
    ctx.fillText(o.subLabel, x + w / 2, y + h / 2 + 11);
  } else {
    ctx.fillStyle = o.labelColor;
    ctx.font = `bold ${o.fontSize || 18}px Arial`;
    ctx.fillText(o.label, x + w / 2, y + h / 2);
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
      ctx.strokeStyle = THEME.text.primary;
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
          ctx.strokeStyle = THEME.text.primary;
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
          ctx.strokeStyle = THEME.text.primary;
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

  // 绘制已放置塔的攻击范围（选中时显示，我方红）
  if (game.selectedTower) {
    const tower = game.selectedTower;
    ctx.save();
    ctx.strokeStyle = THEME.accent.highlight;
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
