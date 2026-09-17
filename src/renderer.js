// 渲染层：所有绘制函数从原 Game.draw* 抽离。
// 约定：每个绘制函数接收 game 实例，内部用 game.ctx 取画布。
// ⚠️ 布局尺寸一律用 **game.W / game.H**（逻辑像素，= 触摸坐标空间），
//    不要读 game.canvas.width/height —— 画布是物理像素（逻辑 × renderScale，
//    见 game.js 渲染倍率 / game_core.applyViewScale），读它会整体放大且跑出屏幕。
// drawTowerIcon 为纯函数，直接吃 ctx。
const config = require('./config');
const { TOWER_DEFS, LAYOUT, TOWER_STATS, LEVELS, BALANCE, AD } = config;
const theme = require('./theme');
const towerMod = require('./tower');
const bonusStats = require('./bonusStats');
const shop = require('./shop');
const nav = require('./nav');
const codex = require('./codex');
const talents = require('./talents');
const levels = require('./levels');
const gamemenu = require('./gamemenu');
const enhanceMod = require('./enhance');
const meta = require('./meta');
const { anchorPointOf } = require('./geometry');

// 通用 UI 原子统一来自 theme.js（本项目 UI 风格与坐标工具的唯一真源）
const {
  THEME, shade, teamBandGradient, easeOutCubic, easeOutBack,
  roundRectPath, drawStar, drawTowerIcon, wrapTextLines, wrapText,
  drawTaperedDivider, drawButton, drawButtonFx, isButtonPressed,
  drawPillTitle, drawChip, ellipsize,
} = theme;

// 塔属性查询（纯配置查找，实体在 tower.js，这里保留同名别名给既有调用点）
const getTowerStats = towerMod.getTowerStats;

// BOSS 阵营色族（怪物本体色 → 所属阵营）。
// 游戏里"BOSS"= tier>=4（drawEnemy 里画王冠的级别）：
//   红方 BOSS = boss（#FF0000 红）；
//   蓝方 BOSS = finalBoss（#9900FF 紫）。
// （elite 金色 #FFD700 属"精英"tier 3，不算 BOSS，不画大血条。）
// 用于把场上 BOSS 归类到红/蓝两方，分别画对应的大血条。
const BOSS_TEAM_COLORS = {
  red:  new Set(['#FF0000']),
  blue: new Set(['#9900FF']),
};

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
 * 绘制敌人（怪物）：立体渐变本体 + 等级点缀。
 * 血条已拆分为独立图层（drawEnemyHpBar），在所有怪物之后统一绘制，
 * 避免被后绘制的怪物本体遮挡（withHpBar 默认 true 保留兼容）。
 */
function drawEnemy(game, enemy, withHpBar = true) {
  if (!enemy.alive) return;

  const ctx = game.ctx;
  const s = enemy.size;
  const half = s / 2;
  const color = enemy.color;

  ctx.save();

  // ---- 地面投影（椭圆，随尺寸缩放）----
  ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
  ctx.beginPath();
  ctx.ellipse(enemy.x, enemy.y + half * 0.7, half * 1.05, half * 0.4, 0, 0, Math.PI * 2);
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

  // ---- 加速怪标识：在本体上画一对白色速度尖角（»），让玩家一眼认出 ----
  if (enemy.type === 'fast') {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    const cw = half * 0.55;   // 尖角半宽
    const cy = enemy.y;       // 居中
    for (let k = 0; k < 2; k++) {
      const ox = -cw * 0.45 + k * cw * 0.55;  // 两个尖角从左到右
      ctx.beginPath();
      ctx.moveTo(enemy.x + ox - cw * 0.35, cy - cw * 0.45);
      ctx.lineTo(enemy.x + ox + cw * 0.25, cy);
      ctx.lineTo(enemy.x + ox - cw * 0.35, cy + cw * 0.45);
      ctx.stroke();
    }
  }

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
 * 不会被同层其他怪物（本体/王冠）挡住。
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

  // 血条与血量数字现已分离：血条保留；血量数值文本已移除（BOSS 大血条 + 怪物小血条已足够表达血量）。
  ctx.restore();
}

/**
 * 取场上某一方的 BOSS（tier>=4，即 boss/finalBoss，血量最高）。
 * @param {object} game 游戏实例
 * @param {string} team 'red' | 'blue'
 * @returns {object|null} BOSS 单位或 null
 */
function getTeamBoss(game, team) {
  if (!game.enemies) return null;
  const colorSet = BOSS_TEAM_COLORS[team];
  let best = null;
  for (const e of game.enemies) {
    if (!e.alive || (e.tier || 0) < 4) continue;
    if (!colorSet.has(e.color)) continue;
    if (!best || e.maxHp > best.maxHp) best = e;
  }
  return best;
}

/**
 * 绘制 BOSS 大血条（宽条 + 数值文本 + 阵营色，带 BOSS 呼吸光晕）。
 * 红方 BOSS 画在波次标题下方，蓝方 BOSS 画在波次标题上方（调用方传 y）。
 * @param {object} ctx 画布
 * @param {object} boss BOSS 单位
 * @param {number} cx 血条中心x（通常屏幕中心）
 * @param {number} cy 血条中心y
 * @param {string} team 'red' | 'blue'（决定配色）
 * @param {number} maxW 血条最大宽度
 */
function drawBossHealthBar(ctx, boss, cx, cy, team, maxW) {
  const w = Math.min(maxW, 320);
  const h = 14;
  const x = cx - w / 2;
  const y = cy - h / 2;
  const pct = Math.max(0, Math.min(1, boss.hp / boss.maxHp));
  const main = team === 'red' ? THEME.team.red.solid : THEME.team.blue.solid;
  const light = team === 'red' ? THEME.team.red.light : THEME.team.blue.light;

  ctx.save();

  // 呼吸光晕（BOSS 专属，强调"大血条"存在感）
  const t = Date.now() / 1000;
  const pulse = 0.5 + 0.5 * Math.sin(t * 2.0);
  const glowR = h * (2.2 + 0.8 * pulse);
  const glow = ctx.createRadialGradient(cx, cy, h * 0.5, cx, cy, Math.max(w / 2, glowR * 2));
  glow.addColorStop(0, shade(main, 0.1, 0.35 + 0.2 * pulse));
  glow.addColorStop(1, shade(main, 0.1, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.ellipse(cx, cy, w / 2 + 12, glowR, 0, 0, Math.PI * 2);
  ctx.fill();

  // 轨道
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h / 2);
  ctx.fill();

  // 填充（阵营色渐变，按剩余比例）
  if (pct > 0) {
    const fw = Math.max(h, w * pct);
    const grad = ctx.createLinearGradient(x, 0, x + fw, 0);
    grad.addColorStop(0, light);
    grad.addColorStop(1, main);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(x, y, fw, h, h / 2);
    ctx.fill();
  }

  // 描边
  ctx.strokeStyle = THEME.border.strong;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h / 2);
  ctx.stroke();

  // 数值文本（BOSS 大血条保留数值，便于精确读血）
  ctx.fillStyle = THEME.text.primary;
  ctx.font = 'bold 12px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.7)';
  ctx.shadowBlur = 2;
  const hpText = `${Math.ceil(boss.hp)} / ${boss.maxHp}`;
  ctx.fillText(hpText, cx, cy + 0.5);
  ctx.shadowBlur = 0;

  ctx.restore();
}

/**
 * 绘制场上所有 BOSS 大血条（红方在波次标题下方、蓝方在上方）。
 * 仅在对应阵营有存活 BOSS 时绘制该条。
 * @param {object} game 游戏实例
 * @param {number} titleCY 波次标题中心y
 * @param {number} titleH  波次标题高
 */
function drawBossBars(game, titleCY, titleH) {
  const ctx = game.ctx;
  const cx = game.W / 2;
  const maxW = game.W * 0.7;
  const gap = 8;
  const redBoss = getTeamBoss(game, 'red');
  const blueBoss = getTeamBoss(game, 'blue');
  if (blueBoss) drawBossHealthBar(ctx, blueBoss, cx, titleCY - titleH / 2 - gap - 10, 'blue', maxW);
  if (redBoss)  drawBossHealthBar(ctx, redBoss,  cx, titleCY + titleH / 2 + gap + 10, 'red', maxW);
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

// ========== 属性面板布局参数（自适应高度的唯一真源）==========
// 面板不再写死高度：所有区块高度在这里定义，实际面板高 = 内容高度之和（可被屏幕裁切）。
const PANEL_UI = {
  width: 302,           // 面板基准宽度（屏幕更窄时自动收窄）
  screenMarginX: 16,    // 距屏幕左右最小边距
  screenMarginY: 18,    // 距屏幕上下最小边距
  padX: 20,             // 内容左右内边距
  padTop: 14,
  padBottom: 12,
  radius: 12,
  headerH: 48,          // 标题区（图标 + 名称 + 阶段星 + 造价）
  dividerH: 18,         // "切割"分隔线占位（含上下留白）
  dividerThickness: 5,  // 分隔线中心最厚处（两端收细到 0）
  rowH: 26,             // 属性行高
  subH: 16,             // 属性来源明细子行高
  sectionTitleH: 22,    // 小节标题行高
  effectH: 18,          // 生效效果单行高
  descLineH: 17,        // 攻击介绍行高
  descSize: 12.5,
  skillH: 24,
  enhanceH: 52,         // 强化按钮区（含标签行）
  footerH: 24,
};

// 属性行标签配色（数值本体统一遵守：白=原生 / 绿=增益 / 红=减益）
const ROW_LABEL_COLOR = {
  damage: THEME.accent.danger,
  attackSpeedMultiplier: THEME.accent.danger,
  attackInterval: THEME.text.secondary,
  auraPower: '#B388FF',
  range: THEME.text.secondary,
  hp: THEME.text.secondary,
  critChance: THEME.accent.cyan,
  critMult: THEME.accent.cyan,
  penetration: THEME.accent.gold,
};

/**
 * 绘制塔属性面板（高度自适应）
 * 三步走：
 *   ① 附加绿字属性系统（bonusStats）算出属性行 / 来源明细 / 生效效果；
 *   ② 预排版全部文本并累加各区块高度 → 得到面板真实高度（不与屏幕争空间）；
 *   ③ 按块顺序自上而下绘制，块间用"切割"式分隔线，内容整体裁剪在面板内。
 * 结果：不会出现文本越界、重叠或"技能槽压在介绍文字上"的情况。
 */
function drawTowerPanel(game) {
  const ctx = game.ctx;
  const W = game.W;
  const H = game.H;

  const towerType = game.panelTowerType;
  const towerDef = TOWER_DEFS[towerType];
  if (!towerDef) return;
  const stats = getTowerStats(towerType);
  const tower = game.selectedTower || null;
  game._currentPanelTower = tower;

  // ---------- ① 附加属性系统 ----------
  const info = bonusStats.collectTowerStats(game, tower, stats, towerType);

  // ---------- ② 尺寸 + 文本预排版 ----------
  const panelW = Math.min(PANEL_UI.width, W - PANEL_UI.screenMarginX * 2);
  const contentW = panelW - PANEL_UI.padX * 2;
  const cx = W / 2;
  const descLines = wrapTextLines(ctx, stats.description || '', contentW, `${PANEL_UI.descSize}px Arial`);

  // 专属技能行：从 ENHANCE_SPECIAL 读取 name/desc/base+per×等级
  const towerMod = require('./tower');
  const spDef = towerMod.getSpecialDef(towerType);
  // ⚠️ 说明文字必须换行：ENHANCE_SPECIAL 的 desc 最长一句 33 字（箭形塔），
  //    按 12.5px 字宽算约 410px，而面板内容宽只有 262px ——
  //    单行 fillText 会直接捅出面板右边界（实测右超 116px）。
  //    换行后的行数会累加进下方 skill 区块的高度，面板高度因此自适应。
  const skillLines = [];
  if (spDef) {
    const lv = tower ? (tower.enhanceLevel || 0) : 0;
    const cur = spDef.base + spDef.per * lv;
    const curText = spDef.unit === '倍' ? `×${cur}` : `${cur}${spDef.unit}`;
    const perText = `+${spDef.per}${spDef.unit}`;
    const raws = [ `${spDef.name}: ${curText} (${perText}/级)` ];
    if (spDef.desc) raws.push(spDef.desc);
    for (const raw of raws) {
      const ls = wrapTextLines(ctx, raw, contentW, `${PANEL_UI.descSize}px Arial`);
      if (ls.length) skillLines.push(...ls);
      else skillLines.push('');
    }
  }

  // 组装区块（累加高度，杜绝重叠）
  const blocks = [];
  // 上下留白走局部变量：矮屏塞不下时它们也参与"弹性压缩"（见下方自适应第二步）
  let padTop = PANEL_UI.padTop;
  let padBottom = PANEL_UI.padBottom;
  let contentH = padTop;
  const push = (block) => { blocks.push(block); contentH += block.h; };

  push({ type: 'header', h: PANEL_UI.headerH });

  let attrH = 0;
  for (const row of info.rows) attrH += PANEL_UI.rowH + row.parts.length * PANEL_UI.subH;
  push({ type: 'divider', h: PANEL_UI.dividerH });
  push({ type: 'attrs', h: attrH, rows: info.rows });

  if (info.effects.length > 0) {
    push({ type: 'divider', h: PANEL_UI.dividerH });
    push({
      type: 'effects',
      h: PANEL_UI.sectionTitleH + info.effects.length * PANEL_UI.effectH,
      items: info.effects,
    });
  }

  push({ type: 'divider', h: PANEL_UI.dividerH });
  push({ type: 'desc', h: PANEL_UI.sectionTitleH + descLines.length * PANEL_UI.descLineH, lines: descLines });

  // 固有技能区块
  if (skillLines.length > 0) {
    push({ type: 'divider', h: PANEL_UI.dividerH });
    push({ type: 'skill', h: PANEL_UI.sectionTitleH + skillLines.length * PANEL_UI.descLineH, lines: skillLines });
  }

  push({ type: 'divider', h: PANEL_UI.dividerH });
  push({ type: 'enhance', h: PANEL_UI.enhanceH });

  push({ type: 'footer', h: PANEL_UI.footerH });
  contentH += padBottom;

  // ---------- 面板外框 ----------
  const availH = H - PANEL_UI.screenMarginY * 2;

  // ---- 高度自适应第二步：实在塞不下时，按"装饰优先级"依次让出高度 ----
  // ① 先压扁"切割"分隔线（纯装饰，压扁只损失留白，不影响任何一条文字的可读性）
  //    分隔线画在 y + block.h/2 上，所以直接改 block.h 就能让它自动重新居中；
  // ② 再压页脚留白（那一块只有一行小字，本身用不满）；
  // ③ 最后削上下内边距（底线 6px，保证内容不贴边）。
  // 顺序很重要：被裁掉的绝不能是底部的「强化」按钮 —— 那才是要紧的东西。
  if (contentH > availH) {
    const shrinkBlocks = (type, floorH) => {
      const still = contentH - availH;
      if (still <= 0) return;
      const list = blocks.filter((b) => b.type === type);
      if (!list.length) return;
      const per = Math.min(list[0].h - floorH, still / list.length);
      if (per <= 0) return;
      for (const b of list) { b.h -= per; contentH -= per; }
    };
    shrinkBlocks('divider', 6);
    shrinkBlocks('footer', 16);

    const still = contentH - availH;
    if (still > 0) {
      const MIN_PAD = 6;
      const takeTop = Math.min(Math.max(0, padTop - MIN_PAD), still / 2);
      const takeBottom = Math.min(Math.max(0, padBottom - MIN_PAD), still - takeTop);
      padTop -= takeTop;
      padBottom -= takeBottom;
      contentH -= (takeTop + takeBottom);
    }
  }

  const panelH = Math.min(contentH, availH);
  const panelX = (W - panelW) / 2;
  const panelY = Math.max(PANEL_UI.screenMarginY, (H - panelH) / 2);
  // 给输入层用（判断触摸是否在面板内、面板大小）
  game._panelRect = { x: panelX, y: panelY, w: panelW, h: panelH };

  // ---------- 滚动支持 ----------
  // 内容总高 - 面板高 = 可滚动距离
  const scrollable = contentH > availH;
  const maxScroll = scrollable ? (contentH - availH) : 0;
  if (scrollable) {
    // 打开面板时重置滚动到顶部
    if (game.panelScrollOffset === undefined || game.panelScrollOffset === null) {
      game.panelScrollOffset = 0;
    }
    game.panelScrollMax = maxScroll;
    // 边界修正（防止面板缩放后 maxScroll 变小）
    if (game.panelScrollOffset > maxScroll) game.panelScrollOffset = maxScroll;
  } else {
    game.panelScrollMax = 0;
    game.panelScrollOffset = 0;
  }
  const scroll = game.panelScrollOffset || 0;

  // 背板 + 描边（同时建立裁剪区，超出屏幕的内容自动切掉而非糊出面板）
  // 透明度取 0.96：再低会让战场上的"第 N 波"横幅、选中塔名称标签从面板中间透出来，很脏。
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(panelX, panelY, panelW, panelH, PANEL_UI.radius);
  ctx.clip();
  ctx.fillStyle = 'rgba(6, 8, 16, 0.96)';
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = towerDef.color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(panelX, panelY, panelW, panelH, PANEL_UI.radius);
  ctx.stroke();
  ctx.restore();

  // 滚动指示器（滚动条）：绘制在面板右侧
  if (scrollable) {
    drawScrollIndicator(ctx, panelX, panelY, panelW, panelH, scroll, maxScroll);
  }

  // ---------- ③ 逐块绘制（应用滚动偏移） ----------
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(panelX, panelY, panelW, panelH, PANEL_UI.radius);
  ctx.clip();

  let y = panelY + padTop - scroll;
  for (const block of blocks) {
    switch (block.type) {
      case 'header':  drawPanelHeader(ctx, block, panelX, y, panelW, towerDef, towerType, tower); break;
      case 'divider': drawTaperedDivider(ctx, cx, y + block.h / 2, panelW - PANEL_UI.padX * 2); break;
      case 'attrs':   drawPanelAttrRows(ctx, block, panelX, y, panelW); break;
      case 'effects': drawPanelEffects(ctx, block, panelX, y, panelW); break;
      case 'desc':    drawPanelDescription(ctx, block, panelX, y, panelW, stats); break;
      case 'skill':   drawPanelSkill(ctx, block, panelX, y, panelW); break;
      case 'enhance': drawPanelEnhance(ctx, block, panelX, y, panelW, game); break;
      case 'footer':  drawPanelFooter(ctx, block, cx, y); break;
      default: break;
    }
    y += block.h;
  }
  ctx.restore();

  // 滚动提示（内容可滚动时显示）
  if (scrollable) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '10px Arial';
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillText('上滑查看更多', cx, panelY + panelH - 6);
    ctx.restore();
  }

  // 「强化」按钮的点击波纹（只画 panel 层的）
  drawButtonFx(game, ctx, 'panel');
}

/** 标题区：塔图标 + 名称 + 阶段星 + 造价 */
function drawPanelHeader(ctx, block, panelX, y, panelW, towerDef, towerType, tower) {
  const left = panelX + PANEL_UI.padX;
  const right = panelX + panelW - PANEL_UI.padX;
  const iconX = left + 14;
  const iconY = y + block.h / 2;

  drawTowerIcon(ctx, iconX, iconY, towerDef.color, towerType);

  // 名称
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = towerDef.color;
  ctx.font = 'bold 18px Arial';
  const nameX = left + 34;
  const nameY = y + 17;
  ctx.fillText(towerDef.name, nameX, nameY);
  const nameW = ctx.measureText(towerDef.name).width;

  // 阶段星：紧跟名称右侧（真实星形图案，非 emoji 字符）
  const stage = tower && tower.stage > 0 ? tower.stage : 0;
  if (stage > 0) {
    const outerR = 5;
    const spacing = 12;
    for (let i = 0; i < stage; i++) {
      drawStar(ctx, nameX + nameW + 12 + i * spacing + outerR, nameY, outerR, THEME.accent.pink);
    }
  } else {
    ctx.fillStyle = THEME.text.off;
    ctx.font = '11px Arial';
    ctx.fillText('未进阶', nameX, y + 36);
  }

  // 造价（右上角，金币色）
  ctx.textAlign = 'right';
  ctx.fillStyle = THEME.text.dim;
  ctx.font = '11px Arial';
  ctx.fillText('造价', right, y + 14);
  ctx.fillStyle = THEME.accent.gold;
  ctx.font = 'bold 16px Arial';
  ctx.fillText(`${towerDef.cost}`, right, y + 34);

  // 累计投入（只有已放置的塔才显示）
  if (tower && tower._cumulativeGold > 0) {
    ctx.textAlign = 'right';
    ctx.fillStyle = THEME.accent.gold;
    ctx.font = 'bold 11px Arial';
    ctx.fillText(`累计投入：${tower._cumulativeGold}`, right - PANEL_UI.padX - 120, y + 14);
    // 出售返还 70%（灰色提示）
    const refund = Math.round(tower._cumulativeGold * 0.7);
    ctx.fillStyle = THEME.text.dim;
    ctx.font = '10px Arial';
    ctx.fillText(`出售返还 70%：${refund}`, right - PANEL_UI.padX - 120, y + 30);
  }
}

/**
 * 属性区：左侧标签，右侧数值。
 * 数值遵循"基础值+加值"双色规则：基础值白字，加值绿字（增益）/ 红字（负面效果）。
 * 有来源明细的属性（等级 / 阶段增幅）在下一行用小字列出算式来源。
 */
function drawPanelAttrRows(ctx, block, panelX, y, panelW) {
  const left = panelX + PANEL_UI.padX;
  const right = panelX + panelW - PANEL_UI.padX;
  let rowY = y;

  for (const row of block.rows) {
    const midY = rowY + PANEL_UI.rowH / 2;

    // 标签
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '14px Arial';
    ctx.fillStyle = ROW_LABEL_COLOR[row.key] || THEME.text.secondary;
    ctx.fillText(row.label, left, midY);

    // 数值：先画加值（右对齐），再把基础值顶到加值左边
    const bonusColor = row.sign > 0 ? THEME.accent.green : (row.sign < 0 ? THEME.accent.danger : null);
    const VALUE_FONT = 'bold 15px Arial';
    const VALUE_GAP = 1.5;   // 基础值与加值之间的呼吸间隙

    ctx.font = VALUE_FONT;   // 必须先定字体再量宽，否则量出的宽度与绘制不一致 → 数值重叠
    const bonusW = row.bonusText ? ctx.measureText(row.bonusText).width : 0;

    if (row.bonusText) {
      ctx.textAlign = 'right';
      ctx.fillStyle = bonusColor;
      ctx.fillText(row.bonusText, right, midY);
    }

    const baseTint = row.valueTint === 'buff' ? THEME.accent.green
      : (row.valueTint === 'debuff' ? THEME.accent.danger : THEME.text.primary);
    ctx.textAlign = 'right';
    ctx.fillStyle = baseTint;
    ctx.fillText(row.baseText, right - (bonusW ? bonusW + VALUE_GAP : 0), midY);

    rowY += PANEL_UI.rowH;

    // 来源明细子行：· 等级 Lv.2 ............ +20%
    for (const part of row.parts) {
      const subY = rowY + PANEL_UI.subH / 2;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = '11px Arial';
      ctx.fillStyle = THEME.text.off;
      ctx.fillText(`· ${part.label}`, left + 8, subY);

      ctx.textAlign = 'right';
      ctx.font = 'bold 11px Arial';
      ctx.fillStyle = part.sign > 0 ? THEME.accent.green : THEME.accent.danger;
      ctx.fillText(part.text, right, subY);
      rowY += PANEL_UI.subH;
    }
  }
}

/** 生效效果区：光环增益 / 负面效果逐条列出（来源 + 数值 + 剩余时间） */
function drawPanelEffects(ctx, block, panelX, y, panelW) {
  const left = panelX + PANEL_UI.padX;
  const right = panelX + panelW - PANEL_UI.padX;

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 12px Arial';
  ctx.fillStyle = THEME.text.secondary;
  ctx.fillText('生效效果', left, y + PANEL_UI.sectionTitleH / 2);

  let itemY = y + PANEL_UI.sectionTitleH;
  for (const item of block.items) {
    const midY = itemY + PANEL_UI.effectH / 2;
    const color = item.sign > 0 ? THEME.accent.green : THEME.accent.danger;

    // 状态圆点
    ctx.beginPath();
    ctx.arc(left + 5, midY, 3, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    ctx.textAlign = 'left';
    ctx.font = '12px Arial';
    ctx.fillStyle = color;
    ctx.fillText(`${item.source} · ${item.text}`, left + 14, midY);

    ctx.textAlign = 'right';
    ctx.font = '10px Arial';
    ctx.fillStyle = THEME.text.off;
    ctx.fillText(`剩 ${item.remaining.toFixed(1)}s`, right, midY);

    itemY += PANEL_UI.effectH;
  }
}

/** 攻击介绍区：左对齐自动换行（行数已预排版，高度不再瞎猜） */
function drawPanelDescription(ctx, block, panelX, y, panelW, stats) {
  const left = panelX + PANEL_UI.padX;

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 12px Arial';
  ctx.fillStyle = THEME.text.secondary;
  ctx.fillText('攻击介绍', left, y + PANEL_UI.sectionTitleH / 2);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = `${PANEL_UI.descSize}px Arial`;
  ctx.fillStyle = THEME.text.primary;
  let lineY = y + PANEL_UI.sectionTitleH + PANEL_UI.descLineH / 2;
  for (const line of block.lines) {
    ctx.fillText(line, left, lineY);
    lineY += PANEL_UI.descLineH;
  }
}

/** 固有技能区：标题 + 技能名/数值 + 说明 */
function drawPanelSkill(ctx, block, panelX, y, panelW) {
  const left = panelX + PANEL_UI.padX;

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 12px Arial';
  ctx.fillStyle = THEME.text.secondary;
  ctx.fillText('固有技能', left, y + PANEL_UI.sectionTitleH / 2);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = `${PANEL_UI.descSize}px Arial`;
  ctx.fillStyle = THEME.text.primary;
  let lineY = y + PANEL_UI.sectionTitleH + PANEL_UI.descLineH / 2;
  for (const line of block.lines) {
    ctx.fillText(line, left, lineY);
    lineY += PANEL_UI.descLineH;
  }
}

/**
 * 强化区：花金币提升该塔（局内，不跨局）。
 * 2026-09 二次重做后的规则：
 *   · 只有【进阶到 3★】的图形塔才能强化（橙色提示当前星级）
 *   · 每次强化只把该塔的【专属特殊属性】抬一级，**不再发放任何攻击力加成**
 *     （属性表见 config.ENHANCE_SPECIAL；当前取值在下方属性行里看）
 * 商店预览（没有实体塔）时不可用，提示"放置后可强化"。
 * 按钮矩形写入 game.panelEnhanceBtn，供输入层命中（渲染每帧刷新，永不失效）。
 */
function drawPanelEnhance(ctx, block, panelX, y, panelW, game) {
  const left = panelX + PANEL_UI.padX;
  const right = panelX + panelW - PANEL_UI.padX;
  const tower = game._currentPanelTower;
  const w = panelW - PANEL_UI.padX * 2;

  const btnW = Math.min(160, Math.round(w * 0.52));
  const btnH = 34;
  const btn = {
    x: right - btnW,
    y: y + Math.round((block.h - btnH) / 2),
    w: btnW,
    h: btnH,
  };

  // 没有实体塔（商店预览）→ 强化不可用
  if (!tower) {
    game.panelEnhanceBtn = null;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 13px Arial';
    ctx.fillStyle = THEME.text.secondary;
    ctx.fillText('强化', left, y + block.h / 2 - 8);
    ctx.font = '10px Arial';
    ctx.fillStyle = THEME.text.off;
    ctx.fillText('放置到战场、并进阶到 ★★★ 后可花金币强化', left, y + block.h / 2 + 10);
    return;
  }

  const maxLv = BALANCE.enhance.maxLevel;
  const lv = tower.enhanceLevel || 0;
  const stage = tower.stage || 0;
  const needStage = BALANCE.enhance.minStage;
  const stageReady = towerMod.isStageReady(tower);
  const maxed = lv >= maxLv;
  const cost = maxed ? Infinity : towerMod.getEnhanceCost(tower.type, lv);
  const affordable = !maxed && game.gold >= cost;
  const usable = stageReady && !maxed;

  game.panelEnhanceBtn = btn;

  // 左：当前强化等级 + 门槛/下一级收益
  // 文案必须按左侧可用宽度裁剪（按钮从 right-btnW 开始，不能让文字压到按钮上）
  const availW = Math.max(40, btn.x - left - 8);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 13px Arial';
  ctx.fillStyle = lv > 0 ? THEME.accent.green : THEME.text.primary;
  ctx.fillText(`固有技能 Lv.${lv}/${maxLv}`, left, y + 20);

  ctx.font = '10px Arial';
  if (!stageReady) {
    ctx.fillStyle = THEME.accent.gold;
    ctx.fillText(ellipsize(ctx, `需进阶到 ★${'★'.repeat(needStage - 1)}（当前 ${stage}★）才能强化`, availW), left, y + 37);
  } else if (maxed) {
    ctx.fillStyle = THEME.text.off;
    ctx.fillText('已满级：专属属性已达上限', left, y + 37);
  } else {
    const sp = towerMod.getSpecialDef(tower.type);
    ctx.fillStyle = THEME.text.off;
    ctx.fillText(
      ellipsize(ctx, sp ? `每次强化 ${sp.name} +${sp.per}${sp.unit}` : '每次强化提升专属属性', availW),
      left, y + 37
    );
  }

  // 右：强化按钮
  let top, bottom, stroke, label, labelColor;
  if (!stageReady) {
    top = THEME.track.soft; bottom = THEME.track.faint; stroke = THEME.border.subtle;
    label = `需 ${needStage}★`; labelColor = THEME.text.off;
  } else if (maxed) {
    top = THEME.track.soft; bottom = THEME.track.faint; stroke = THEME.border.subtle;
    label = '已满级'; labelColor = THEME.accent.gold;
  } else if (affordable) {
    top = 'rgba(129, 199, 132, 0.42)'; bottom = 'rgba(56, 142, 60, 0.26)';
    stroke = 'rgba(129, 199, 132, 0.85)';
    label = `本次提升固有技能 💰${cost}`; labelColor = THEME.text.primary;
  } else {
    top = THEME.track.soft; bottom = THEME.track.faint; stroke = THEME.border.subtle;
    label = `本次提升固有技能 💰${cost}`; labelColor = THEME.text.off;
  }
  void usable;

  drawButton(ctx, {
    x: btn.x, y: btn.y, w: btn.w, h: btn.h,
    top: top, bottom: bottom, stroke: stroke,
    label: label, labelColor: labelColor,
    fontSize: 14, radius: THEME.radius.medium,
    pressed: isButtonPressed(game, 'tower:enhance'),
  });
}

/** 底部提示 */
function drawPanelFooter(ctx, block, cx, y) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '11px Arial';
  ctx.fillStyle = THEME.text.dim;
  ctx.fillText('点击任意位置关闭', cx, y + block.h / 2);
}

/**
 * 计算拖放落点槽位（手指下的放置槽），返回 slot 或 null
 */
function findDropTargetSlot(game, pos) {
  for (const slot of game.slots) {
    if (pos.x >= slot.x && pos.x <= slot.x + slot.size &&
        pos.y >= slot.y && pos.y <= slot.y + slot.size) {
      return slot;
    }
  }
  return null;
}

/**
 * 拖放合法性：place=可放置(空槽) / merge=可合成(同类型塔) / invalid=不可(类型不符或自身) / none=无落点
 */
function dropValidity(game, slot, dragType) {
  if (!slot) return 'none';
  if (slot === game.draggingFromSlot) return 'invalid';
  if (slot.occupied && slot.tower) {
    return slot.tower.type === dragType ? 'merge' : 'invalid';
  }
  return 'place';
}

function drawDragPreview(game) {
  if (!game.dragging || !game.dragType) return;

  const ctx = game.ctx;
  const towerConfig = TOWER_DEFS[game.dragType];
  const cost = towerConfig.cost;
  const canAfford = game.gold >= cost || !game.dragFromShop;

  const pos = { x: game.dragX, y: game.dragY };
  const targetSlot = findDropTargetSlot(game, pos);
  const validity = dropValidity(game, targetSlot, game.dragType);

  // ---- 0. 检测拖放是否覆盖商店面板 → 变"销毁/出售"视觉状态 ----
  const shopMod = require('./shop');
  const shopL = shopMod.getShopLayout(game);
  const sellPad = 16;
  const sellBox = {
    x: shopL.panel.x - sellPad,
    y: shopL.panel.y - sellPad,
    w: shopL.panel.w + sellPad * 2,
    h: shopL.panel.h + sellPad * 2,
  };
  const isOverShop = pos.x >= sellBox.x && pos.x <= sellBox.x + sellBox.w &&
                     pos.y >= sellBox.y && pos.y <= sellBox.y + sellBox.h;
  const canSell = isOverShop && game.draggingFromSlot && game.draggingFromSlot.occupied;

  // ---- 1. 落点槽高亮（金色=可放置/合成，红色=不可）----
  if (targetSlot && validity !== 'none') {
    const good = validity === 'place' || validity === 'merge';
    const rgb = good ? '255, 215, 0' : '255, 68, 68';
    ctx.save();
    ctx.fillStyle = `rgba(${rgb}, 0.18)`;
    ctx.strokeStyle = `rgba(${rgb}, 0.9)`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(targetSlot.x - 2, targetSlot.y - 2, targetSlot.size + 4, targetSlot.size + 4, THEME.radius.small);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // ---- 2. 来源槽变暗（拖走后"腾空"的视觉暗示，与放置槽拖拽一致）----
  let sourceSlot = null;
  if (game.dragFromShop && game.dragShopIdx !== undefined) {
    // 商店卡位置由图签驱动的新商店布局统一提供（渲染/输入同一份坐标）
    const L = shop.getShopLayout(game);
    const card = L.cards[game.dragShopIdx];
    if (card) sourceSlot = { x: card.x, y: card.y, slotW: card.w, slotH: card.h };
  } else if (game.draggingFromSlot) {
    sourceSlot = game.draggingFromSlot;
  }
  if (sourceSlot) {
    const w = sourceSlot.slotW || sourceSlot.size;
    const h = sourceSlot.slotH || sourceSlot.size;
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.roundRect(sourceSlot.x, sourceSlot.y, w, h, THEME.radius.medium);
    ctx.fill();
    ctx.restore();
  }

  // ---- 3. 拖拽幽灵塔（抬起感：阴影 + 放大 + 半透明，金币不足时偏红）----
  ctx.save();
  ctx.globalAlpha = 0.85;

  // 地面阴影（椭圆，制造"离地"感）
  ctx.fillStyle = 'rgba(0, 0, 0, 0.30)';
  ctx.beginPath();
  ctx.ellipse(pos.x, pos.y + 14, 16, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  // 放大 1.15 倍绘制图标（围绕手指中心）
  ctx.translate(pos.x, pos.y);
  ctx.scale(1.15, 1.15);
  ctx.translate(-pos.x, -pos.y);
  drawTowerIcon(ctx, pos.x, pos.y, canAfford ? towerConfig.color : THEME.accent.danger, game.dragType);
  ctx.restore();

  // ---- 4. 拖放覆盖商店面板 → 红色"销毁/出售"视觉反馈 ----
  if (canSell) {
    ctx.save();
    // 红色呼吸光晕
    const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 200);
    const glow = ctx.createRadialGradient(pos.x, pos.y, 8, pos.x, pos.y, 30);
    glow.addColorStop(0, `rgba(255, 68, 68, ${0.4 + 0.2 * pulse})`);
    glow.addColorStop(1, 'rgba(255, 68, 68, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 30, 0, Math.PI * 2);
    ctx.fill();

    // 底部标签 "销毁/出售"
    ctx.fillStyle = THEME.accent.danger;
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 2;
    ctx.fillText('销毁 / 出售', pos.x, pos.y + 24);
    ctx.shadowBlur = 0;
    ctx.restore();
  }
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
// 缓动函数 easeOutCubic / easeOutBack 统一由 theme.js 提供（见文件头部的解构导入）

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
 * 顶部状态栏：关卡徽标（可点开关卡选择）/ 生存积分 / 金币。
 * 金币从底栏挪到顶栏——底栏现在归重做后的商店面板用。
 */
function drawTopBar(game) {
  const ctx = game.ctx;
  const width = game.W;
  const H = LAYOUT.topBarHeight;
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
  ctx.fillRect(0, 0, width, H);

  // 左：关卡徽标（纯展示，不可点击——选关已搬到战前居中面板）
  const badge = levels.getLevelBadgeRect(game);
  game.levelBadgeRect = badge;
  const lvDef = LEVELS.filter((l) => l.id === game.currentLevel)[0];
  drawChip(ctx, {
    x: badge.x, y: badge.y, w: badge.w, h: badge.h,
    text: lvDef ? lvDef.name : `关卡 ${game.currentLevel}`,
    color: THEME.team.red.light, fontSize: 11,
    bg: 'rgba(229, 115, 115, 0.18)',
    stroke: 'rgba(229, 115, 115, 0.55)',
  });

  // 右：☰ 游戏菜单按钮（顶栏唯一可点元素）
  const menuRect = gamemenu.getMenuButtonRect(game);
  gamemenu.drawMenuButton(game);

  ctx.strokeStyle = THEME.border.subtle;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, H + 0.5);
  ctx.lineTo(width, H + 0.5);
  ctx.stroke();

  ctx.restore();

  // ☰ 按钮的点击波纹（只画 topbar 层的，见 theme.drawButtonFx）
  drawButtonFx(game, ctx, 'topbar');
}

function drawUI(game) {
  const ctx = game.ctx;
  const width = game.W;
  const height = game.H;

  // 顶部状态栏：关卡徽标 / 生存积分 / 金币
  drawTopBar(game);

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
  drawLifeBar(
    ctx, barEdge, centerLineY,
    bgX - barGap - barEdge, barH,
    getPlayerScoreProgress(game, 0),
    [THEME.team.red.light, THEME.team.red.solid], false
  );
  const p1X = bgX + bgWidth + barGap;
  drawLifeBar(
    ctx, p1X, centerLineY,
    width - barEdge - p1X, barH,
    getPlayerScoreProgress(game, 1),
    [THEME.team.blue.light, THEME.team.blue.solid], true
  );

  // 标题：药丸形 + 红→蓝柔和渐变，风格与左右生存条统一
  drawWaveTitle(ctx, width / 2, centerLineY, bgWidth, bgHeight, waveText);

  // BOSS 大血条：红方 BOSS 在波次标题下方，蓝方 BOSS 在波次标题上方
  drawBossBars(game, centerLineY, bgHeight);

  // ========== 重做后的商店板块 ==========
  // 标题栏（商店徽标 + 特殊积分 + 刷新按钮）+ 3 张塔卡；坐标由 shop.getShopLayout 统一提供
  shop.drawShop(game);

  // 注意：结算界面不在这里画——它必须盖住底部导航栏，
  // 所以由 render() 在导航栏之后统一绘制（见 drawGameOver 的调用点）。
}

/**
 * 结算界面（失败 / 胜利）：与游戏内 UI 统一风格。
 * 从原 drawUI 尾部抽出，逻辑不变。
 */
function drawGameOver(game) {
  const ctx = game.ctx;
  const width = game.W;
  const height = game.H;

  const showWin = !!game.gameWon;
  const showFail = game.lives <= 0 && !showWin;
  if (!showFail && !showWin) return;
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
  ctx.fillText(`坚持波数: ${game.currentWave}`, cx, panelY + 116);

  // 本局收获（金币/积分不跨局，只有积分与天赋点进存档）
  ctx.font = '12px Arial';
  ctx.fillStyle = THEME.text.dim;
  ctx.fillText(
    showWin
      ? '关卡完成 · 特殊积分与天赋点已入账'
      : '本次收获的特殊积分已全部入账',
    cx, panelY + 142
  );

  if (showWin) {
    // 胜利：单个"返回主页"按钮（主操作 = 增益绿）
    const btnW = Math.min(240, panelW - 48);
    const btnH = 54;
    const btnX = (width - btnW) / 2;
    const btnY = panelY + panelH - 90;
    game.gameOverButtons = { returnHome: { x: btnX, y: btnY, w: btnW, h: btnH } };
    drawButton(ctx, {
      x: btnX, y: btnY, w: btnW, h: btnH,
      top: 'rgba(165, 214, 167, 0.5)', bottom: 'rgba(76, 175, 80, 0.32)',
      stroke: 'rgba(165, 214, 167, 0.8)',
      label: '返回主页', labelColor: THEME.text.primary, fontSize: 18,
      pressed: isButtonPressed(game, 'returnHome'),
    });
  } else if (game.watchingVideo) {
    // 失败 - 观看视频倒计时
    game.gameOverButtons = {};
    ctx.fillStyle = THEME.accent.gold;
    ctx.font = 'bold 26px Arial';
    ctx.fillText(`视频倒计时: ${Math.max(0, Math.ceil(game.videoTimer))} 秒`, cx, panelY + 190);
    ctx.fillStyle = THEME.text.secondary;
    ctx.font = '14px Arial';
    ctx.fillText('观看广告后可继续游戏', cx, panelY + 226);
  } else {
    // 失败 - 按钮：AD.enabled 为 false 时，再次挑战按钮变灰不可点
    const btnH = 54;
    const inner = panelW - 40;
    const gap = 16;
    const btnW = (inner - gap) / 2;
    const totalW = btnW * 2 + gap;
    const x1 = (width - totalW) / 2;
    const x2 = x1 + btnW + gap;
    const btnY = panelY + panelH - 90;
    game.gameOverButtons = {
      restart: { x: x1, y: btnY, w: btnW, h: btnH },
      watchContinue: { x: x2, y: btnY, w: btnW, h: btnH },
    };
    const adEnabled = AD.enabled;
    const watchDisabled = !adEnabled;
    const watchTop = watchDisabled ? 'rgba(120, 120, 120, 0.4)' : 'rgba(146, 197, 255, 0.5)';
    const watchBottom = watchDisabled ? 'rgba(90, 90, 90, 0.32)' : 'rgba(100, 181, 246, 0.32)';
    const watchStroke = watchDisabled ? 'rgba(120, 120, 120, 0.8)' : 'rgba(146, 197, 255, 0.8)';
    drawButton(ctx, {
      x: x1, y: btnY, w: btnW, h: btnH,
      top: 'rgba(165, 214, 167, 0.5)', bottom: 'rgba(76, 175, 80, 0.32)',
      stroke: 'rgba(165, 214, 167, 0.8)',
      label: '重新开始', labelColor: THEME.text.primary, fontSize: 16,
      pressed: isButtonPressed(game, 'restart'),
    });
    drawButton(ctx, {
      x: x2, y: btnY, w: btnW, h: btnH,
      top: watchTop, bottom: watchBottom,
      stroke: watchStroke,
      label: '再次挑战', labelColor: THEME.text.primary, fontSize: 15,
      subLabel: `(${game.currentWave * 500} 金币)`, subColor: THEME.text.secondary,
      pressed: adEnabled && isButtonPressed(game, 'watchContinue'),
      disabled: watchDisabled,
      disabledColor: THEME.text.off,
      icon: true,
    });
  }

  // 结算按钮的点击波纹（只画 gameover 层的）
  drawButtonFx(game, ctx, 'gameover');
}

/**
 * 战斗场景绘制：路径 / 选中范围 / 槽位 / 塔 / 怪物 / 血条 / 弹道 / 特效 / 拖拽预览 / UI。
 * 从原 render() 抽成独立函数——因为 render() 现在要按"场景"分派（战斗 / 图签 / 天赋）。
 */
function drawBattle(game) {
  const ctx = game.ctx;

  // 绘制路径
  drawPath(game);

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

  // 绘制激光效果（半圆塔 / 正方塔）
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
    if (effect.type === 'square_laser') {
      const alpha = effect.life / effect.maxLife;
      ctx.save();
      ctx.globalAlpha = alpha * 0.85;
      // 激光管：粗线 + 外发光
      ctx.lineWidth = 16;
      ctx.strokeStyle = effect.color;
      ctx.shadowColor = effect.color;
      ctx.shadowBlur = 20;
      ctx.beginPath();
      ctx.moveTo(effect.x1, effect.y1);
      ctx.lineTo(effect.x2, effect.y2);
      ctx.stroke();
      ctx.shadowBlur = 0;
      // 中心高亮白线
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#fff';
      ctx.globalAlpha = alpha * 0.9;
      ctx.beginPath();
      ctx.moveTo(effect.x1, effect.y1);
      ctx.lineTo(effect.x2, effect.y2);
      ctx.stroke();
      ctx.restore();
    }
  }

  // 绘制 UI（含商店面板，位于拖拽图标之下）
  drawUI(game);

  // 拖拽预览最后绘制，盖住商店面板，确保拖放图标始终可见
  drawDragPreview(game);
}

/**
 * 绘制弹道与爆炸/扇形特效。
 * 原先嵌套在 render() 内部（靠函数声明提升被调用），现提到顶层。
 */
function drawProjectiles(game) {
  const ctx = game.ctx;
  for (const proj of game.projectiles) {
    if (!proj.alive) continue;

    ctx.save();

    // 绘制小型塔图标作为弹道
    ctx.fillStyle = proj.color;
    ctx.globalAlpha = 0.9;

    const size = 3; // 弹道大小（原6，减小50%）
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
        // 正方塔弹道：旋转的正方形（体积随弹道体积强化一起变大，命中范围同步）
        ctx.rotate(proj.rotationAngle || 0);
        {
          const sq = Math.max(1.5, (proj.size || 10) * 0.3);
          ctx.fillRect(-sq, -sq, sq * 2, sq * 2);
          ctx.strokeRect(-sq, -sq, sq * 2, sq * 2);
        }
        break;

      case 'diamond':
        // 菱形塔弹道：菱形
        ctx.beginPath();
        ctx.moveTo(0, -size);
        ctx.lineTo(size, 0);
        ctx.lineTo(0, size);
        ctx.lineTo(-size, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;

      case 'pentagon':
        // 五边塔弹道：五边形
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
          const angle = (Math.PI * 2 / 5) * i - Math.PI / 2;
          const px = size * Math.cos(angle);
          const py = size * Math.sin(angle);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;

      case 'oval':
        // 椭圆塔弹道：椭圆
        ctx.beginPath();
        ctx.ellipse(0, 0, size * 1.2, size * 0.7, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        break;

      case 'star':
        // 星形塔弹道：六角星
        const r1 = size * 1.2, r2 = size * 0.5;
        ctx.beginPath();
        for (let i = 0; i < 12; i++) {
          const radius = i % 2 === 0 ? r1 : r2;
          const angle = (Math.PI / 6) * i - Math.PI / 2;
          const sx = radius * Math.cos(angle);
          const sy = radius * Math.sin(angle);
          if (i === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;

      case 'octagon':
        // 八边塔弹道：八边形
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const angle = (Math.PI / 4) * i - Math.PI / 8;
          const px = size * Math.cos(angle);
          const py = size * Math.sin(angle);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;

      case 'cross':
        // 十字塔弹道：十字形
        const arm = size * 0.6, len = size * 1.2;
        const pts = [
          [-arm, -len], [arm, -len], [arm, -arm], [len, -arm],
          [len, arm], [arm, arm], [arm, len], [-arm, len],
          [-arm, arm], [-len, arm], [-len, -arm], [-arm, -arm],
        ];
        ctx.beginPath();
        pts.forEach((p, i) => {
          const px = p[0], py = p[1];
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;

      case 'arrow':
        // 箭形塔弹道：箭头
        ctx.beginPath();
        ctx.moveTo(size * 1.5, 0);
        ctx.lineTo(size * 0.4, -size);
        ctx.lineTo(size * 0.4, -size * 0.5);
        ctx.lineTo(-size, -size * 0.5);
        ctx.lineTo(-size, size * 0.5);
        ctx.lineTo(size * 0.4, size * 0.5);
        ctx.lineTo(size * 0.4, size);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;

      case 'bolt':
        // 闪电塔弹道：闪电
        ctx.beginPath();
        ctx.moveTo(size * 0.2, -size);
        ctx.lineTo(-size * 0.9, size * 0.2);
        ctx.lineTo(-size * 0.1, size * 0.2);
        ctx.lineTo(-size * 0.5, size);
        ctx.lineTo(size * 0.9, -size * 0.3);
        ctx.lineTo(size * 0.1, -size * 0.3);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;

      case 'semicircle':
        // 半圆塔弹道：半圆（激光视觉）
        ctx.beginPath();
        ctx.arc(0, 0, size, -Math.PI / 2, Math.PI / 2);
        ctx.lineTo(0, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
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

/**
 * 轻提示（操作反馈）：解锁 / 升级 / 登场 / 学习 / 失败原因。
 * game.toast = { text, color, t0 }，自动淡出。
 */
function drawToast(game) {
  const t = game.toast;
  if (!t) return;

  const elapsed = (Date.now() - t.t0) / 1000;
  if (elapsed > 2.2) { game.toast = null; return; }

  const ctx = game.ctx;
  const W = game.W;
  const H = game.H;
  const navTop = H - LAYOUT.navHeight;

  const fadeIn = Math.min(1, elapsed / 0.15);
  const fadeOut = elapsed > 1.8 ? Math.max(0, 1 - (elapsed - 1.8) / 0.35) : 1;
  const alpha = Math.min(fadeIn, fadeOut);

  ctx.save();
  ctx.globalAlpha = alpha;

  ctx.font = 'bold 12px Arial';
  const tw = ctx.measureText(t.text).width || 60;
  const w = Math.min(W - 32, tw + 30);
  const h = 30;
  const x = (W - w) / 2;
  const y = navTop - h - 80;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.88)';
  roundRectPath(ctx, x, y, w, h, h / 2);
  ctx.fill();

  ctx.strokeStyle = t.color || THEME.border.strong;
  ctx.lineWidth = 1.2;
  roundRectPath(ctx, x, y, w, h, h / 2);
  ctx.stroke();

  ctx.fillStyle = t.color || THEME.text.primary;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(t.text, W / 2, y + h / 2);

  ctx.restore();
}

// 组合一帧的完整绘制（按场景分派）
function render(game) {
  const ctx = game.ctx;

  // 清空画布：用逻辑视口尺寸（game.W/H）。
  // ctx 已被 game.applyViewScale() 缩到逻辑坐标，所以这里填 game.W × game.H
  // 正好覆盖整块物理画布；写 canvas.width 会多铺 renderScale 倍（无害但浪费）。
  ctx.fillStyle = THEME.surface.page;
  ctx.fillRect(0, 0, game.W, game.H);

  const scene = game.scene || 'battle';

  if (scene === 'codex') {
    codex.drawCodex(game);
  } else if (scene === 'talents') {
    talents.drawTalents(game);
  } else {
    drawBattle(game);
  }

  // 战前选关界面（战斗未开始时居中弹出；画在导航栏之下，导航仍可用）
  if (scene === 'battle' && !game.battleStarted) {
    levels.drawBattleReady(game);
  }

  // 底部导航栏：在所有场景内容之上、所有浮层之下
  nav.drawNav(game);

  // 游戏中菜单（☰）：模态，必须盖住导航栏
  if (scene === 'battle' && game.showMenu) {
    gamemenu.drawGameMenu(game);
  }

  // 塔属性面板（仅战斗场景，最后绘制确保在最上层）
  if (game.showPanel && scene === 'battle') {
    drawTowerPanel(game);
  }

  // 强化「多选一」浮层：模态，必须盖住塔属性面板
  if (game.enhancePicker && scene === 'battle') {
    enhanceMod.drawEnhancePicker(game);
  }

  // 结算界面：必须盖住底部导航栏（否则玩家能在结算界面点导航溜走）
  // 判据与输入层共用 game.isSettlementActive()（= battle 场景 + 胜利或 lives<=0），
  // 保证"实际画出来的"与"允许点的"永远是同一套前提。
  if (game.isSettlementActive()) {
    drawGameOver(game);
  }

  // 操作轻提示
  drawToast(game);
}

module.exports = {
  THEME,
  render,
  drawBattle,
  drawPath,
  drawSlots,
  drawEnemy,
  drawEnemyHpBar,
  drawBossHealthBar,
  drawBossBars,
  getTeamBoss,
  drawTowerIcon,
  drawTower,
  drawDragPreview,
  drawUI,
  drawTopBar,
  drawGameOver,
  drawToast,
  drawTowerPanel,
  drawTaperedDivider,
  wrapTextLines,
  getTowerStats,
};
