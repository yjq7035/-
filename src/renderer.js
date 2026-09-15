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

/**
 * 颜色明暗工具：把 #RRGGBB 按比例变亮/变暗（amount: -1~1，正=变亮，负=变暗）。
 * 用于给纯色生成渐变两端 / 高光 / 阴影，让"纯色"变成有体积感的渐变。
 * @param {string} hex 十六进制颜色（支持 #rgb / #rrggbb）
 * @param {number} amount -1~1
 * @param {number} [alpha] 可选输出 alpha
 * @returns rgba() 字符串
 */
function shade(hex, amount, alpha) {
  let h = (hex || '#000000').replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const num = parseInt(h, 16);
  let r = (num >> 16) & 255, g = (num >> 8) & 255, b = num & 255;
  if (amount >= 0) { r = r + (255 - r) * amount; g = g + (255 - g) * amount; b = b + (255 - b) * amount; }
  else { const t = 1 + amount; r = r * t; g = g * t; b = b * t; }
  const a = (alpha === undefined) ? 1 : alpha;
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a})`;
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

  // 起点 / 终点：用"绘制方法"画成地图坐标标记（徽标 + 文字），而非裸文本
  // 起点 = 敌方出生（对方蓝），终点 = 我方基地（我方红）
  drawEndpointMarker(ctx, game.pathStart.x, game.pathStart.y, THEME.team.blue.solid, '起');
  drawEndpointMarker(ctx, game.pathEnd.x, game.pathEnd.y, THEME.team.red.solid, '终');

  ctx.restore();
}

/**
 * 绘制路径端点标记（地图坐标风格）：圆环 + 渐变徽标 + 文字，带柔和呼吸光晕。
 * 替代原先直接 fillText('起'/'终') 的裸文本，使其像"地图坐标点"一样有体积与层次。
 * @param {object} ctx 画布
 * @param {number} x 中心x
 * @param {number} y 中心y
 * @param {string} color 主色（阵营色）
 * @param {string} label 文字（'起'/'终'）
 */
function drawEndpointMarker(ctx, x, y, color, label) {
  const time = Date.now() / 1000;
  const r = 13;                       // 徽标半径
  const pulse = 0.5 + 0.5 * Math.sin(time * 2.2); // 0~1 呼吸

  ctx.save();

  // 呼吸光晕（外圈柔光）
  const glowR = r + 8 + pulse * 4;
  const glow = ctx.createRadialGradient(x, y, r * 0.5, x, y, glowR);
  glow.addColorStop(0, shade(color, 0.2, 0.35 + 0.2 * pulse));
  glow.addColorStop(1, shade(color, 0.2, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, glowR, 0, Math.PI * 2);
  ctx.fill();

  // 徽标主体：径向渐变（上亮下暗，立体感）
  const body = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.2, x, y, r * 1.05);
  body.addColorStop(0, shade(color, 0.45));
  body.addColorStop(1, shade(color, -0.25));
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  // 内圈高光（顶部弧形亮边）
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, y, r - 1.5, Math.PI * 1.05, Math.PI * 1.95);
  ctx.stroke();

  // 外描边
  ctx.strokeStyle = shade(color, -0.4, 0.9);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();

  // 中心文字（白 + 阴影，清晰可读）
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 15px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 2;
  ctx.fillText(label, x, y + 0.5);
  ctx.shadowBlur = 0;

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

/**
 * 绘制敌人（怪物）：立体渐变本体 + 朝向鼻锥 + 等级点缀。
 * 血条已拆分为独立图层（drawEnemyHpBar），在所有怪物之后统一绘制，
 * 避免被后绘制的怪物本体遮挡（withHpBar 默认 true 保留兼容）。
 */
function drawEnemy(game, enemy, withHpBar = true) {
  if (!enemy.alive) return;

  const ctx = game.ctx;
  const s = enemy.size;
  const half = s / 2;
  const color = enemy.color;
  const facing = (enemy.facing !== undefined) ? enemy.facing : 0;

  ctx.save();

  // ---- 地面投影（椭圆，随尺寸缩放）----
  ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
  ctx.beginPath();
  ctx.ellipse(enemy.x, enemy.y + half * 0.7, half * 1.05, half * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();

  // ---- 朝向鼻锥（行进方向的小楔形，让"朝哪走"一眼可见）----
  const noseLen = s * 0.5;
  const nx = Math.cos(facing), ny = Math.sin(facing);
  const perpX = -ny, perpY = nx;
  const tipX = enemy.x + nx * (half + noseLen);
  const tipY = enemy.y + ny * (half + noseLen);
  const baseL = { x: enemy.x + nx * half * 0.6 + perpX * half * 0.5, y: enemy.y + ny * half * 0.6 + perpY * half * 0.5 };
  const baseR = { x: enemy.x + nx * half * 0.6 - perpX * half * 0.5, y: enemy.y + ny * half * 0.6 - perpY * half * 0.5 };
  ctx.fillStyle = shade(color, -0.15);
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(baseL.x, baseL.y);
  ctx.lineTo(baseR.x, baseR.y);
  ctx.closePath();
  ctx.fill();

  // ---- 本体：圆角方块 + 径向渐变（左上亮 → 右下暗，立体）----
  const bodyGrad = ctx.createRadialGradient(
    enemy.x - half * 0.4, enemy.y - half * 0.45, half * 0.2,
    enemy.x, enemy.y, half * 1.4
  );
  bodyGrad.addColorStop(0, shade(color, 0.5));
  bodyGrad.addColorStop(0.7, color);
  bodyGrad.addColorStop(1, shade(color, -0.3));
  ctx.fillStyle = bodyGrad;
  const rr = Math.max(3, s * 0.22);
  ctx.beginPath();
  ctx.roundRect(enemy.x - half, enemy.y - half, s, s, rr);
  ctx.fill();

  // ---- 顶部高光弧 ----
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(enemy.x, enemy.y, half * 0.7, Math.PI * 1.15, Math.PI * 1.85);
  ctx.stroke();

  // ---- 外描边（暗色，勾轮廓）----
  ctx.strokeStyle = shade(color, -0.45);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(enemy.x - half, enemy.y - half, s, s, rr);
  ctx.stroke();

  // ---- 等级点缀：精英金环 / BOSS 王冠 ----
  if (enemy.tier >= 3) {
    // 精英及以上：金色光环
    ctx.strokeStyle = THEME.accent.gold;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(enemy.x, enemy.y, half + 3, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (enemy.tier >= 4) {
    // BOSS / 最终BOSS：头顶王冠
    const cy = enemy.y - half - 4;
    const cw = half * 0.9, chh = 8;
    ctx.fillStyle = THEME.accent.gold;
    ctx.beginPath();
    ctx.moveTo(enemy.x - cw, cy);
    ctx.lineTo(enemy.x - cw * 0.5, cy - chh);
    ctx.lineTo(enemy.x, cy);
    ctx.lineTo(enemy.x + cw * 0.5, cy - chh);
    ctx.lineTo(enemy.x + cw, cy);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = shade(THEME.accent.gold, -0.3);
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // ---- 血条 + 血量（低于100%才显示）----
  // 正常流程下血条由 render() 的独立图层统一绘制（withHpBar=false）
  if (withHpBar && enemy.hp < enemy.maxHp) {
    drawEnemyHpBar(game, enemy);
  }

  ctx.restore();
}

/**
 * 绘制怪物血条（独立图层）。
 * 在所有怪物本体绘制完成后统一调用，保证血条压在所有怪物之上，
 * 不会被同层其他怪物（本体/鼻锥/王冠）挡住。
 */
function drawEnemyHpBar(game, enemy) {
  if (!enemy.alive || enemy.hp >= enemy.maxHp) return;

  const ctx = game.ctx;
  const s = enemy.size;
  const half = s / 2;

  ctx.save();

  const pct = Math.max(0, enemy.hp / enemy.maxHp);
  const barW = Math.max(20, s);
  const barH = 4;
  const barX = enemy.x - barW / 2;
  const barY = enemy.y - half - (enemy.tier >= 4 ? 16 : 10);

  // 轨道
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.beginPath();
  ctx.roundRect(barX, barY, barW, barH, barH / 2);
  ctx.fill();
  // 填充（绿→黄→红，按剩余比例）
  let hpColor;
  if (pct > 0.5) hpColor = '#6EE86E';
  else if (pct > 0.25) hpColor = THEME.accent.gold;
  else hpColor = THEME.accent.danger;
  if (pct > 0) {
    ctx.fillStyle = hpColor;
    ctx.beginPath();
    ctx.roundRect(barX, barY, Math.max(barH, barW * pct), barH, barH / 2);
    ctx.fill();
  }
  // 描边
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(barX, barY, barW, barH, barH / 2);
  ctx.stroke();

  // 血量数字（按 tier 着色，沿用原配色）
  let textColor = '#ffffff';
  if (enemy.tier === 1) textColor = THEME.accent.gold;
  else if (enemy.tier === 2) textColor = THEME.accent.pink;
  else if (enemy.tier === 3) textColor = THEME.accent.danger;
  else if (enemy.tier === 4) textColor = '#CC66FF';
  ctx.fillStyle = textColor;
  ctx.font = `bold ${Math.max(8, s * 0.4)}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 2;
  ctx.fillText(`${enemy.hp}`, enemy.x, enemy.y);
  ctx.shadowBlur = 0;

  ctx.restore();
}

/**
 * 给已构建好的塔轮廓应用统一的"立体样式"：径向渐变填充 + 顶部光泽（裁剪到形状内）+ 深色描边。
 * 让原本"仅边框"的图形塔变成有体积感的填充图形。
 * @param {object} ctx 画布
 * @param {number} x 中心x
 * @param {number} y 中心y
 * @param {string} color 塔主色
 * @param {number} approxR 形状的近似半径（用于渐变/光泽范围）
 */
function applyTowerStyle(ctx, x, y, color, approxR) {
  // 径向渐变填充（左上亮 → 右下暗，立体）
  const g = ctx.createRadialGradient(
    x - approxR * 0.3, y - approxR * 0.35, approxR * 0.15,
    x, y, approxR * 1.25
  );
  g.addColorStop(0, shade(color, 0.5));
  g.addColorStop(0.7, color);
  g.addColorStop(1, shade(color, -0.3));
  ctx.fillStyle = g;
  ctx.fill();

  // 顶部光泽（裁剪到形状内，避免溢出）
  ctx.save();
  ctx.clip();
  const sheen = ctx.createLinearGradient(x, y - approxR, x, y + approxR);
  sheen.addColorStop(0,   'rgba(255, 255, 255, 0.32)');
  sheen.addColorStop(0.5, 'rgba(255, 255, 255, 0.04)');
  sheen.addColorStop(1,   'rgba(0, 0, 0, 0.12)');
  ctx.fillStyle = sheen;
  ctx.fillRect(x - approxR * 1.6, y - approxR * 1.6, approxR * 3.2, approxR * 3.2);
  ctx.restore();

  // 深色描边，勾轮廓
  ctx.strokeStyle = shade(color, -0.45);
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

/**
 * 绘制塔图标（纯函数）：按类型构建轮廓，再套用统一立体样式。
 * 轮廓几何保持原样（方向语义不变：三角/扇/半圆仍按攻击朝向绘制）。
 */
function drawTowerIcon(ctx, x, y, color, type) {
  ctx.save();
  ctx.lineJoin = 'round';

  let approxR = 12; // 形状近似半径（默认）

  switch (type) {
    case 'triangle': {
      // 三角形 - 默认朝向右侧（与攻击方向一致）
      const triSize = 12;
      approxR = triSize * 1.15;
      ctx.beginPath();
      ctx.moveTo(x + triSize, y);
      ctx.lineTo(x - triSize * 0.5, y - triSize);
      ctx.lineTo(x - triSize * 0.5, y + triSize);
      ctx.closePath();
      break;
    }

    case 'circle': {
      approxR = 11;
      ctx.beginPath();
      ctx.arc(x, y, 11, 0, Math.PI * 2);
      break;
    }

    case 'hexagon': {
      // 六边形
      const hexR = 11;
      approxR = hexR;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i - Math.PI / 6;
        const hx = x + hexR * Math.cos(angle);
        const hy = y + hexR * Math.sin(angle);
        if (i === 0) ctx.moveTo(hx, hy);
        else ctx.lineTo(hx, hy);
      }
      ctx.closePath();
      break;
    }

    case 'square': {
      // 正方塔 - 圆角正方形（更精致）
      const sqSize = 20;
      approxR = sqSize / 2;
      ctx.beginPath();
      ctx.roundRect(x - sqSize / 2, y - sqSize / 2, sqSize, sqSize, 4);
      break;
    }

    case 'trapezoid': {
      // 梯塔 - 梯形
      const tw = 20, bw = 26, th = 16;
      approxR = bw / 2;
      ctx.beginPath();
      ctx.moveTo(x - tw / 2, y - th / 2);
      ctx.lineTo(x + tw / 2, y - th / 2);
      ctx.lineTo(x + bw / 2, y + th / 2);
      ctx.lineTo(x - bw / 2, y + th / 2);
      ctx.closePath();
      break;
    }

    case 'semicircle': {
      // 半圆塔 - 半圆形（开口朝向攻击方向）
      const sr = 11;
      approxR = sr;
      ctx.beginPath();
      ctx.arc(x, y, sr, -Math.PI / 2, Math.PI / 2);
      ctx.closePath();
      break;
    }

    case 'sector': {
      // 扇塔 - 扇形
      const secR = 11;
      approxR = secR;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.arc(x, y, secR, -Math.PI / 4, Math.PI / 4);
      ctx.closePath();
      break;
    }

    case 'long_rectangle': {
      // 长方形 - 圆角长方形
      const rectW = 22;
      const rectH = 14;
      approxR = rectW / 2;
      ctx.beginPath();
      ctx.roundRect(x - rectW / 2, y - rectH / 2, rectW, rectH, 3);
      break;
    }
  }

  // 套用统一立体样式（渐变填充 + 光泽 + 描边）
  applyTowerStyle(ctx, x, y, color, approxR);

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

// ========== 波次标题动态动画（倒计时滚轮 + 进攻开始 + 标题滑入） ==========

function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
function easeOutBack(t) { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }

/**
 * 绘制"滚轮数字"（odometer 风格）：数字 5→4→3→2→1 在窗口内连续滚动。
 * reelIndex 为浮点（0=显示5，4=显示1），随倒计时连续变化即产生滚动感。
 * @param {object} ctx 画布
 * @param {number} cx 窗口中心x
 * @param {number} cy 窗口中心y
 * @param {number} reelIndex 0..4（浮点）
 */
function drawReel(ctx, cx, cy, reelIndex) {
  const digits = ['5', '4', '3', '2', '1'];
  const H = 56;            // 每个数字格高
  const winW = 74;         // 窗口宽
  const winH = H;          // 窗口高
  const x = cx - winW / 2;
  const yTop = cy - winH / 2;

  // 面板底
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.beginPath();
  ctx.roundRect(x - 4, yTop - 4, winW + 8, winH + 8, 10);
  ctx.fill();

  // 裁剪到窗口，画滚动数字
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, yTop, winW, winH);
  ctx.clip();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 46px Arial';
  const offY = -reelIndex * H;
  for (let i = 0; i < digits.length; i++) {
    const cellCy = yTop + i * H + offY + H / 2;
    const dist = Math.abs(cellCy - cy);
    ctx.globalAlpha = Math.max(0, 1 - dist / (H * 1.1));
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 3;
    ctx.fillText(digits[i], cx, cellCy);
  }
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;

  // 上下渐隐（滚轮纵深）
  const fade = ctx.createLinearGradient(0, yTop, 0, yTop + winH);
  fade.addColorStop(0,    'rgba(26,26,46,0.85)');
  fade.addColorStop(0.3,  'rgba(26,26,46,0)');
  fade.addColorStop(0.7,  'rgba(26,26,46,0)');
  fade.addColorStop(1,    'rgba(26,26,46,0.85)');
  ctx.fillStyle = fade;
  ctx.fillRect(x, yTop, winW, winH);
  ctx.restore();

  // 窗口描边
  ctx.strokeStyle = THEME.border.strong;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x - 4, yTop - 4, winW + 8, winH + 8, 10);
  ctx.stroke();
}

/**
 * 波次倒计时动画舞台（在波次之间播放）：
 *   第一秒：旧"第 N 波"标题从西面被顶上去并淡出，同时滚轮从 5 开始滚；
 *   中间：  滚轮 5→4→3→2→1 连续滚动；
 *   最后一秒："进攻开始"放大冲入。
 * 完全由 remaining(=waitTimer) 驱动，纯函数，跨重启稳健。
 * @param {object} game 游戏实例
 * @param {number} cx 中心x
 * @param {number} cy 中心y
 * @param {number} remaining 剩余倒计时（秒）
 * @param {number} waitDuration 总倒计时（秒）
 */
function drawWaveCountdown(game, cx, cy, remaining, waitDuration) {
  const ctx = game.ctx;
  ctx.save();

  // ---- 旧波次标题：从西面被往上顶 + 淡出（第一窗口内完成）----
  const introP = (remaining > waitDuration - 1)
    ? Math.min(1, Math.max(0, (waitDuration - remaining) / 1))
    : 1;
  if (game.currentWave > 0) {
    const eased = easeOutCubic(Math.min(1, introP));
    if (eased < 1) {
      const waveText = `第 ${game.currentWave} 波`;
      ctx.globalAlpha = 1 - eased;
      drawWaveTitle(ctx, cx - 60 * eased, cy - 70 * eased, 140, 40, waveText);
      ctx.globalAlpha = 1;
    }
  }

  if (remaining <= 1) {
    // ---- 进攻开始：放大冲入 + 金色发光 ----
    const goP = Math.min(1, Math.max(0, (1 - remaining) / 1));
    const scale = 0.55 + 0.45 * easeOutBack(goP);
    const alpha = Math.min(1, goP * 2.5);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.shadowColor = THEME.accent.gold;
    ctx.shadowBlur = 22;
    ctx.fillStyle = THEME.accent.gold;
    ctx.font = 'bold 40px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('进攻开始', 0, 0);
    ctx.restore();
  } else {
    // ---- 滚轮数字：5→4→3→2→1 连续滚动 ----
    const reelIndex = Math.max(0, Math.min(4, waitDuration - remaining));
    drawReel(ctx, cx, cy, reelIndex);
  }

  ctx.restore();
}

/**
 * 波次标题（波次进行中显示），带"滑入"动画：波次刚开始时从上方滑落到位。
 * @param {object} game 游戏实例
 */
function drawWaveTitleAnimated(game, cx, cy, w, h, text) {
  const ctx = game.ctx;
  const now = Date.now();
  const elapsed = (game.waveStartStamp > 0) ? (now - game.waveStartStamp) / 1000 : 1;
  if (elapsed >= 0.6) {
    drawWaveTitle(ctx, cx, cy, w, h, text);
    return;
  }
  const p = Math.max(0, Math.min(1, elapsed / 0.6));
  const eased = easeOutCubic(p);
  ctx.save();
  ctx.globalAlpha = eased;
  drawWaveTitle(ctx, cx, cy - 40 * (1 - eased), w, h, text);
  ctx.restore();
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

  // 绘制怪物（按出生顺序正常绘制，不再把受伤怪物置顶——该设定会让后画怪物遮住前画怪物的血条）
  for (const enemy of game.enemies) {
    if (enemy.alive) {
      drawEnemy(game, enemy, false);
    }
  }

  // 血条独立图层：全部怪物本体绘制完成后统一绘制，确保血条在所有怪物之上
  for (const enemy of game.enemies) {
    if (enemy.alive && enemy.hp < enemy.maxHp) {
      drawEnemyHpBar(game, enemy);
    }
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
  drawEnemyHpBar,
  drawTowerIcon,
  drawTower,
  drawDragPreview,
  drawUI,
  drawTowerPanel,
  getTowerStats,
};
