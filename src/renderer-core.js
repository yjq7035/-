// 渲染层 · 核心子模块：游戏实体绘制（路径 / 槽位 / 塔 / 怪 / 弹道 / BOSS 血条 / 战斗场景）
// + 一帧的组合入口 render。由 src/renderer.js 薄壳 re-export，与 renderer-ui.js 合并成
// 原先单文件 src/renderer.js 的完整导出面。
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
const bag = require('./bag');
const levels = require('./levels');
const gamemenu = require('./gamemenu');
const enhanceMod = require('./enhance');
const meta = require('./meta');
const gems = require('./gems');
const skills = require('./skills');
const stageMod = require('./stage');
const aim = require('./aim');
const skillSlot = require('./skillSlot');
const gemModal = require('./gemModal');
const { anchorPointOf } = require('./geometry');

// 通用 UI 原子统一来自 theme.js（本项目 UI 风格与坐标工具的唯一真源）
const {
  THEME, TOAST, shade, teamBandGradient, easeOutCubic, easeOutBack,
  roundRectPath, drawStar, drawTowerIcon, wrapTextLines, wrapText,
  drawTaperedDivider, drawButton, drawButtonFx, isButtonPressed,
  drawPillTitle, drawChip, ellipsize, drawChevron, drawScrollBar,
} = theme;

// 塔属性查询（纯配置查找，实体在 tower.js，这里保留同名别名给既有调用点）
const getTowerStats = towerMod.getTowerStats;

// UI 子模块：drawBattle 要画顶栏/波次倒计时，render 要画属性面板/结算/提示。
// 单依赖方向 core → ui（ui 侧只用到 core 的 drawBossBars，走延迟 require 绕开循环）。
const ui = require('./renderer-ui');


// BOSS 阵营色族（怪物本体色 → 所属阵营）。
// 游戏里"BOSS"= tier>=4（drawEnemy 里画王冠的级别）：
//   红方 BOSS = boss（#FF0000 红）；
//   蓝方 BOSS = finalBoss（#9900FF 紫）。
// （elite 金色 #FFD700 属"精英"tier 3，不算 BOSS，不画大血条。）
// 用于把场上 BOSS 归类到红/蓝两方，分别画对应的大血条。
const BOSS_TEAM_COLORS = {
  red:  new Set(['#FF0000', '#9900FF']),
  blue: new Set(['#00BFFF']),
};

// 小怪血条的追赶速度：鬼影从满管缩到空管所需秒数（经典口径 = 白条记着"上一次的血量"）。
// 调小的手感 = 扣得更急（0.2 会像抽搐），调大的手感 = 白条挂太久像卡住。
// 小怪数量多、本身血量也小，白条挂太久会让人误判"这只还没死"，所以偏快。


// 小怪血条的追赶速度：鬼影从满管缩到空管所需秒数（经典口径 = 白条记着"上一次的血量"）。
// 调小的手感 = 扣得更急（0.2 会像抽搐），调大的手感 = 白条挂太久像卡住。
// 小怪数量多、本身血量也小，白条挂太久会让人误判"这只还没死"，所以偏快。
const ENEMY_HP_GHOST_DRAIN_SEC = 0.6;

// BOSS 大血条的时间常数（漏桶口径，见 advanceBossGhost）：
// 白条长度 ≈ 最近 BOSS_GHOST_DECAY_SEC 秒里吃到的伤害；停火后按 e 指数消退。
// ⚠️ 为什么 BOSS 不能用小怪那套恒定速度（2026-09-19 用户报"小怪有白条、BOSS 没有"）：
//   · BOSS 的 maxHp 是小怪的 50 倍（enemy.js：boss = 100 × 50 × 波次倍率 × Boss阶段加成），
//     塔打它一下只掉条宽的 0.1%~0.5%，而"满管 0.9s"换算成每帧要缩掉 1.85% ——
//     **一次伤害比一帧要缩掉的还少**，鬼影在绘制之前就被追平，白条一帧都没进过画布。
//   · 实测（8~12 座塔打 10/20 波 BOSS，逐帧量白条像素）：峰值 0.01~0.78px、可见帧 0%
//     —— 玩家眼里就是"根本没有"；同一套塔打小怪的白条峰值有 1.3px（小怪条才 20px 宽）。
//   · 漏桶把零散小伤害累起来：稳态白条长度 ≈ 每秒伤害 × 时间常数，
//     10 波 BOSS 实测峰值 19px、20 波 5px，都看得见；停火后自然消退、不会赖着不走。
// 0.2s → 白条太短（强势一波也就 1~2px）；1.0s → 停火后要拖 2 秒才干净。0.5s 两头都合适。


// BOSS 大血条的时间常数（漏桶口径，见 advanceBossGhost）：
// 白条长度 ≈ 最近 BOSS_GHOST_DECAY_SEC 秒里吃到的伤害；停火后按 e 指数消退。
// ⚠️ 为什么 BOSS 不能用小怪那套恒定速度（2026-09-19 用户报"小怪有白条、BOSS 没有"）：
//   · BOSS 的 maxHp 是小怪的 50 倍（enemy.js：boss = 100 × 50 × 波次倍率 × Boss阶段加成），
//     塔打它一下只掉条宽的 0.1%~0.5%，而"满管 0.9s"换算成每帧要缩掉 1.85% ——
//     **一次伤害比一帧要缩掉的还少**，鬼影在绘制之前就被追平，白条一帧都没进过画布。
//   · 实测（8~12 座塔打 10/20 波 BOSS，逐帧量白条像素）：峰值 0.01~0.78px、可见帧 0%
//     —— 玩家眼里就是"根本没有"；同一套塔打小怪的白条峰值有 1.3px（小怪条才 20px 宽）。
//   · 漏桶把零散小伤害累起来：稳态白条长度 ≈ 每秒伤害 × 时间常数，
//     10 波 BOSS 实测峰值 19px、20 波 5px，都看得见；停火后自然消退、不会赖着不走。
// 0.2s → 白条太短（强势一波也就 1~2px）；1.0s → 停火后要拖 2 秒才干净。0.5s 两头都合适。
const BOSS_GHOST_DECAY_SEC = 0.5;

// 漏桶的泄流是 e 指数 —— 尾巴无穷小、永远"差一点点"归不了零。
// 低于"满管的 0.1%"直接掐到 0（273px 的条上 0.1% = 0.27px，本来就看不见），
// 保证白条真的会消失，也保证"追平后不再画白条"这类断言成立。


// 漏桶的泄流是 e 指数 —— 尾巴无穷小、永远"差一点点"归不了零。
// 低于"满管的 0.1%"直接掐到 0（273px 的条上 0.1% = 0.27px，本来就看不见），
// 保证白条真的会消失，也保证"追平后不再画白条"这类断言成立。
const GHOST_SNAP_FRAC = 0.001;



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
  // 延迟掉血鬼影：**全项目唯一的推进点**（大血条只读同一份）。
  // 口径按 tier 分流 —— BOSS 血量是小怪的 50 倍，单次伤害占条宽极小，
  // 沿用恒定速度会在画之前就被追平（见 advanceBossGhost 的漏桶）。
  const ghostPct = advanceHpGhost(enemy, frameDt(game));
  const barW = Math.max(20, s);
  const barH = 4;
  const barX = enemy.x - barW / 2;
  const barY = enemy.y - half - (enemy.tier >= 4 ? 16 : 10);

  // 轨道（方形：直角）
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.fillRect(barX, barY, barW, barH);

  // 白色缓冲条（残留旧血量，方形）
  if (ghostPct > pct + 1e-4) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.fillRect(barX, barY, Math.max(barH, barW * ghostPct), barH);
  }

  // 填充（绿→黄→红，按剩余比例，方形）
  let hpColor;
  if (pct > 0.5) hpColor = '#6EE86E';
  else if (pct > 0.25) hpColor = THEME.accent.gold;
  else hpColor = THEME.accent.danger;
  if (pct > 0) {
    ctx.fillStyle = hpColor;
    ctx.fillRect(barX, barY, barW * pct, barH);
  }
  // 描边（方形）
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect(barX, barY, barW, barH);

  // 血条与血量数字现已分离：血条保留；血量数值文本已移除（BOSS 大血条 + 怪物小血条已足够表达血量）。
  ctx.restore();
}

/**
 * 取场上某一方的 BOSS（tier>=4，即 boss/finalBoss，血量最高）。
 * @param {object} game 游戏实例
 * @param {string} team 'red' | 'blue'
 * @returns {object|null} BOSS 单位或 null
 */


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
 * 小怪口径的「延迟掉血」鬼影推进器（经典款）：白条记着"上一次的血量"，按恒定速度往下追。
 *
 * 规则：
 *   鬼影 > 实血  → 按 drainSecPerFull 秒缩完"整管"的恒定速度往下追（每帧夹一次，绝不越过头）
 *   鬼影 ≤ 实血  → 立刻贴合（首次出现 / 回血 / 换单位复用都靠这条兜住，
 *                  否则会出现"白条比实条长"或白条反向生长的鬼畜现象）
 *
 * ⚠️ BOSS 不用这套（血量级差 50 倍，恒定速度会在绘制前把鬼影追平 → 白条永远画不出来），
 *    走漏桶口径 advanceBossGhost。分流在 advanceHpGhost 一处完成。
 *
 * @param {object} unit 需要 maxHp / hp 的单位（状态记在 unit._hpGhost，单位不池化故安全）
 * @param {number} dt 帧间隔（秒）
 * @param {number} drainSecPerFull 从满管掉到空管所需的秒数（越小扣得越快）
 * @returns {number} 鬼影进度 0~1
 */


/**
 * 小怪口径的「延迟掉血」鬼影推进器（经典款）：白条记着"上一次的血量"，按恒定速度往下追。
 *
 * 规则：
 *   鬼影 > 实血  → 按 drainSecPerFull 秒缩完"整管"的恒定速度往下追（每帧夹一次，绝不越过头）
 *   鬼影 ≤ 实血  → 立刻贴合（首次出现 / 回血 / 换单位复用都靠这条兜住，
 *                  否则会出现"白条比实条长"或白条反向生长的鬼畜现象）
 *
 * ⚠️ BOSS 不用这套（血量级差 50 倍，恒定速度会在绘制前把鬼影追平 → 白条永远画不出来），
 *    走漏桶口径 advanceBossGhost。分流在 advanceHpGhost 一处完成。
 *
 * @param {object} unit 需要 maxHp / hp 的单位（状态记在 unit._hpGhost，单位不池化故安全）
 * @param {number} dt 帧间隔（秒）
 * @param {number} drainSecPerFull 从满管掉到空管所需的秒数（越小扣得越快）
 * @returns {number} 鬼影进度 0~1
 */
function updateHpGhost(unit, dt, drainSecPerFull) {
  const maxHp = unit.maxHp > 0 ? unit.maxHp : 1;
  const hp = Math.max(0, Math.min(maxHp, unit.hp || 0));
  let ghost = unit._hpGhost;
  if (typeof ghost !== 'number' || !(ghost > hp)) ghost = hp;
  if (ghost > hp) {
    const step = maxHp * (Math.max(0, dt) / (drainSecPerFull || 1));
    ghost = Math.max(hp, ghost - step);
  }
  unit._hpGhost = ghost;
  return ghost / maxHp;
}

/**
 * BOSS 口径的鬼影推进器（漏桶）：白条长度 ≈ 最近 BOSS_GHOST_DECAY_SEC 秒吃到的伤害。
 *
 * 为什么不是"上一次的血量"：BOSS 血厚 50 倍，塔一下只掉条宽 0.1%~0.5%，
 * 恒定速度下白条一帧就被追平、永远画不出来（见常量注释里的实测数据）。
 * 漏桶把零散小伤害累起来 → 稳态白条 ≈ 每秒伤害 × 时间常数，看得见也读得懂。
 *
 * 状态（都在 unit 上，单位不池化）：
 *   _hpGhost     白条位置 = 实血 + 桶内伤害
 *   _hpGhostPool 桶内还挂着的伤害（本帧伤害入桶、按 e 指数泄流）
 *
 * ⚠️ 本帧伤害由"上一帧血量 - 本帧血量"反推（上一帧血量 = 上一帧的 ghost - 桶）。
 *    这样连"血条没画的那几帧"里吃的伤害也不会丢：下次一画就一次性入桶。
 *
 * @param {object} unit 需要 maxHp / hp 的单位
 * @param {number} dt 帧间隔（秒）
 * @returns {number} 鬼影进度 0~1
 */


/**
 * BOSS 口径的鬼影推进器（漏桶）：白条长度 ≈ 最近 BOSS_GHOST_DECAY_SEC 秒吃到的伤害。
 *
 * 为什么不是"上一次的血量"：BOSS 血厚 50 倍，塔一下只掉条宽 0.1%~0.5%，
 * 恒定速度下白条一帧就被追平、永远画不出来（见常量注释里的实测数据）。
 * 漏桶把零散小伤害累起来 → 稳态白条 ≈ 每秒伤害 × 时间常数，看得见也读得懂。
 *
 * 状态（都在 unit 上，单位不池化）：
 *   _hpGhost     白条位置 = 实血 + 桶内伤害
 *   _hpGhostPool 桶内还挂着的伤害（本帧伤害入桶、按 e 指数泄流）
 *
 * ⚠️ 本帧伤害由"上一帧血量 - 本帧血量"反推（上一帧血量 = 上一帧的 ghost - 桶）。
 *    这样连"血条没画的那几帧"里吃的伤害也不会丢：下次一画就一次性入桶。
 *
 * @param {object} unit 需要 maxHp / hp 的单位
 * @param {number} dt 帧间隔（秒）
 * @returns {number} 鬼影进度 0~1
 */
function advanceBossGhost(unit, dt) {
  const maxHp = unit.maxHp > 0 ? unit.maxHp : 1;
  const hp = Math.max(0, Math.min(maxHp, unit.hp || 0));
  const step = Math.max(0, dt);
  const poolPrev = typeof unit._hpGhostPool === 'number' ? unit._hpGhostPool : 0;
  const ghostPrev = typeof unit._hpGhost === 'number' ? unit._hpGhost : hp;
  const hpPrev = Math.max(0, Math.min(maxHp, ghostPrev - poolPrev));
  const dealt = Math.max(0, hpPrev - hp);                       // 本帧新吃的伤害

  let pool = poolPrev * Math.exp(-step / BOSS_GHOST_DECAY_SEC) + dealt;
  let ghost = hp + pool;
  if (hp >= maxHp || !(ghost > hp)) { ghost = hp; pool = 0; }    // 满血 / 回血 / 首次：立刻贴合
  else if (ghost > maxHp) { ghost = maxHp; pool = maxHp - hp; }  // 桶比人还大：白条不越过满管
  else if (pool <= maxHp * GHOST_SNAP_FRAC) { ghost = hp; pool = 0; }  // 亚像素尾巴掐掉，保证归零

  unit._hpGhost = ghost;
  unit._hpGhostPool = pool;
  return ghost / maxHp;
}

/**
 * 推进某单位的白条鬼影 —— **全项目唯一入口，每帧每个单位只能走一次**。
 * 口径按 tier 分流：tier>=4（boss/finalBoss，与 getTeamBoss 同口径）走漏桶，
 * 其余走经典恒定速度。**别按"画在哪个条上"分流** —— 那正是 2026-09-19 的坑。
 *
 * ⚠️ 只在「血条独立图层」（drawBattle 里那圈 drawEnemyHpBar）调用它：
 *    那是唯一会"每帧不重不漏地遍历每一个怪"的地方（见 drawBattle 的 for 循环）。
 * ⚠️ 千万别在画大血条时再推一次 —— BOSS 同时有「头顶小血条」和「顶部大血条」，
 *    两边都推就是**一帧推两步**：鬼影缩得快一倍，而且谁先谁后会互相咬
 *    （旧 bug：大血条带下限、小血条不带，小血条每帧把鬼影一路追平
 *     → 大血条的白条永远为 0px）。
 *    大血条只读（ghostPctOf），要什么值都由这里统一推进。
 *
 * @param {object} unit 怪物单位
 * @param {number} dt 帧间隔（秒）
 * @returns {number} 鬼影进度 0~1
 */


/**
 * 推进某单位的白条鬼影 —— **全项目唯一入口，每帧每个单位只能走一次**。
 * 口径按 tier 分流：tier>=4（boss/finalBoss，与 getTeamBoss 同口径）走漏桶，
 * 其余走经典恒定速度。**别按"画在哪个条上"分流** —— 那正是 2026-09-19 的坑。
 *
 * ⚠️ 只在「血条独立图层」（drawBattle 里那圈 drawEnemyHpBar）调用它：
 *    那是唯一会"每帧不重不漏地遍历每一个怪"的地方（见 drawBattle 的 for 循环）。
 * ⚠️ 千万别在画大血条时再推一次 —— BOSS 同时有「头顶小血条」和「顶部大血条」，
 *    两边都推就是**一帧推两步**：鬼影缩得快一倍，而且谁先谁后会互相咬
 *    （旧 bug：大血条带下限、小血条不带，小血条每帧把鬼影一路追平
 *     → 大血条的白条永远为 0px）。
 *    大血条只读（ghostPctOf），要什么值都由这里统一推进。
 *
 * @param {object} unit 怪物单位
 * @param {number} dt 帧间隔（秒）
 * @returns {number} 鬼影进度 0~1
 */
function advanceHpGhost(unit, dt) {
  return (unit && (unit.tier || 0) >= 4)
    ? advanceBossGhost(unit, dt)
    : updateHpGhost(unit, dt, ENEMY_HP_GHOST_DRAIN_SEC);
}

/** 只读白条进度（不推进）：大血条 / 小血条读的是同一个鬼影 */


/** 只读白条进度（不推进）：大血条 / 小血条读的是同一个鬼影 */
function ghostPctOf(unit) {
  const maxHp = unit.maxHp > 0 ? unit.maxHp : 1;
  const ghost = typeof unit._hpGhost === 'number' ? unit._hpGhost : (unit.hp || 0);
  return Math.max(0, Math.min(1, ghost / maxHp));
}

/** 取本帧的帧间隔（秒）：由 game_core.loop 写入 game.dt；无头测试/首帧兜底 1/60 */


/** 取本帧的帧间隔（秒）：由 game_core.loop 写入 game.dt；无头测试/首帧兜底 1/60 */
function frameDt(game) {
  const dt = game && game.dt;
  return (typeof dt === 'number' && dt > 0) ? Math.min(dt, 0.1) : 1 / 60;
}

/**
 * 绘制 BOSS 大血条（宽条 + 数值文本 + 阵营色）。
 * 红方 BOSS 画在波次标题下方，蓝方 BOSS 画在波次标题上方（调用方传 y）。
 *
 * 2026-09 改版：
 *   · **删掉 BOSS 呼吸光晕**（那圈脉动椭圆糊在标题栏上很脏，而且告诉不了玩家任何信息）；
 *     改成静态暗色垫底 + 细腻内高光，不闪不糊。
 *   · 掉血缓冲条重做：旧版拿"最近 8 秒伤害明细"做归一化，剩余比例其实是
 *     bufHp/bufTotal（永远从 1 开始），既不是血量也读不出信息。现在改为
 *     标准「延迟掉血」——实条立即更新，白色鬼影条慢慢缩。
 *     口径见 advanceBossGhost（BOSS 血厚 50 倍，走的是"最近 N 秒伤害"的漏桶，
 *     不是小怪那套恒定速度；换成恒定速度会一帧就被追平、白条根本画不出来）。
 *   · ⛔ 本函数**只读**鬼影，不推进它：BOSS 头顶还有一条小血条（drawEnemyHpBar），
 *     推进统一收口在那一层（每帧每个怪恰好一次，见 advanceHpGhost）。所以本函数
 *     不再需要 dt —— 传了也没用。
 * @param {object} ctx 画布
 * @param {object} boss BOSS 单位
 * @param {number} cx 血条中心x（通常屏幕中心）
 * @param {number} cy 血条中心y
 * @param {string} team 'red' | 'blue'（决定配色）
 * @param {number} maxW 血条最大宽度
 */


/**
 * 绘制 BOSS 大血条（宽条 + 数值文本 + 阵营色）。
 * 红方 BOSS 画在波次标题下方，蓝方 BOSS 画在波次标题上方（调用方传 y）。
 *
 * 2026-09 改版：
 *   · **删掉 BOSS 呼吸光晕**（那圈脉动椭圆糊在标题栏上很脏，而且告诉不了玩家任何信息）；
 *     改成静态暗色垫底 + 细腻内高光，不闪不糊。
 *   · 掉血缓冲条重做：旧版拿"最近 8 秒伤害明细"做归一化，剩余比例其实是
 *     bufHp/bufTotal（永远从 1 开始），既不是血量也读不出信息。现在改为
 *     标准「延迟掉血」——实条立即更新，白色鬼影条慢慢缩。
 *     口径见 advanceBossGhost（BOSS 血厚 50 倍，走的是"最近 N 秒伤害"的漏桶，
 *     不是小怪那套恒定速度；换成恒定速度会一帧就被追平、白条根本画不出来）。
 *   · ⛔ 本函数**只读**鬼影，不推进它：BOSS 头顶还有一条小血条（drawEnemyHpBar），
 *     推进统一收口在那一层（每帧每个怪恰好一次，见 advanceHpGhost）。所以本函数
 *     不再需要 dt —— 传了也没用。
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

  // 白色缓冲条（延迟掉血）：**只读**取本帧的鬼影（推进由血条独立图层统一做，见 advanceHpGhost）。
  // ⛔ 别在这里再调一次 updateHpGhost —— BOSS 头顶还有一条小血条，两边都推 = 一帧推两步，
  //    鬼影缩得快一倍；历史上这里推、那里不带下限，结果是这条白条被追平到 0px、从来画不出来。
  const ghostPct = ghostPctOf(boss);

  ctx.save();

  // 静态垫底（替代原来的呼吸光晕）：一圈固定暗边，保证亮地图上血条不糊（方形）
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.fillRect(x - 3, y - 3, w + 6, h + 6);

  // 轨道（方形）
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(x, y, w, h);

  // 白条：残留的旧血量（画在实条下面，只露在实条右边那一截，方形）
  if (ghostPct > pct + 1e-4) {
    const gw = Math.max(h, w * ghostPct);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
    ctx.fillRect(x, y, gw, h);
    // 鬼影前锋的一道亮边：让"正在往下扣"这件事看得见（方形）
    const edgeW = 2;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.fillRect(x + gw - edgeW - 1, y + 1, edgeW, h - 2);
  }

  // 实条：真实血量，按剩余比例（阵营色渐变，方形）
  if (pct > 0) {
    const fw = w * pct;
    const grad = ctx.createLinearGradient(x, 0, x + fw, 0);
    grad.addColorStop(0, light);
    grad.addColorStop(1, main);
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, fw, h);
  }

  // 顶部内高光（静态，立体感靠它，不靠动画，方形）
  ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.fillRect(x + h * 0.35, y + 2, Math.max(0, w - h * 0.7), 2.5);

  // 描边（方形）
  ctx.strokeStyle = THEME.border.strong;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x, y, w, h);

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
  // 不传 dt：白条鬼影的推进不在这一层（见 drawBossHealthBar 的注释）
  if (blueBoss) drawBossHealthBar(ctx, blueBoss, cx, titleCY - titleH / 2 - gap - 10, 'blue', maxW);
  if (redBoss)  drawBossHealthBar(ctx, redBoss,  cx, titleCY + titleH / 2 + gap + 10, 'red', maxW);
}

/**
 * 绘制已放置的塔
 */


/**
 * 绘制已放置的塔
 */
function drawTower(ctx, game, tower) {
  const towerDef = TOWER_DEFS[tower.type];
  if (!towerDef) return;

  ctx.save();

  // 朝向变换由攻击朝向系统施加（唯一真源 src/aim.js）：
  //   · 跟随朝向的塔型（全部 17 型，含平行塔）→ 平移到塔位 + 按 attackAngle 旋转，
  //     轮廓照"朝右"画在原点。
  // ⛔ 别在这里再写一份"哪种塔要不要转"的判断 —— 政策只有 aim.SHAPE_AIM 一处。
  const placed = aim.applyIconTransform(ctx, tower);
  drawTowerIcon(ctx, placed.x, placed.y, towerDef.color, tower.type);

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
  
  // 绘制进阶标识（底部相对槽位底边，textBaseline='bottom' 使其底边对齐槽位底部）
  //   攻击塔 → '+400%'（攻击力增幅，真源 src/stage.js）
  //   辅助塔 → '攻速100' / '穿透20'（它**真正发出**的光环值）
  // ⚠️ 辅助塔不能再显示 '+400%' —— 它伤害为 0，那个数字读起来像"攻击力 +400%"，
  //    实战里什么都没发生（旧版对菱形塔就是如此，进阶标识纯属装饰）。
  const stageTag = towerStageTag(tower);
  if (stageTag && slot) {
    const textBottom = anchorPointOf(slot, 'bottom', { y: 4 });
    ctx.fillStyle = THEME.accent.green;
    ctx.font = 'bold 10px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(stageTag, tower.x, textBottom.y);
  }
}

/**
 * 塔下那行进阶标识的文案（无进阶返回空串）。
 * 所有数字都现算自 src/stage.js / tower.getAuraOutput —— 不读 tower.attackPowerBoost，
 * 免得那个历史字段和真实星级各说各话。
 * ⚠️ 文案要短：槽位间距只有 44px，太长会压到隔壁槽的标识上。
 */


/**
 * 塔下那行进阶标识的文案（无进阶返回空串）。
 * 所有数字都现算自 src/stage.js / tower.getAuraOutput —— 不读 tower.attackPowerBoost，
 * 免得那个历史字段和真实星级各说各话。
 * ⚠️ 文案要短：槽位间距只有 44px，太长会压到隔壁槽的标识上。
 */
function towerStageTag(tower) {
  if (!tower) return '';
  const stars = stageMod.clampStage(tower.stage);
  if (stars <= 0) return '';

  if (tower.isSupport) {
    // 十字塔：进阶收益 = 共享比例翻倍（它没有"攻速/穿透光环"可报）
    if (towerMod.getTowerRuntimeStats(tower).auraMode === 'adjacent') {
      return `共享${Math.round(towerMod.getShareRatio(tower))}%`;
    }
    const out = towerMod.getAuraOutput(tower, meta.codexDamageMultiplier(tower.type));
    if (out.attackSpeedMultiplier) return `攻速${Math.round(out.attackSpeedMultiplier)}`;
    if (out.penetration) return `穿透${Math.round(out.penetration)}`;
    return '';
  }
  const pct = stageMod.bonusPercent('damage', stars);
  return pct > 0 ? `+${pct}%` : '';
}

// ========== 属性面板布局参数（自适应高度的唯一真源）==========
// 面板不再写死高度：所有区块高度在这里定义，实际面板高 = 内容高度之和（可被屏幕裁切）。


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
      // 宽度跟随弹道体积（含强化）：0.8 / 0.15 是原生 200% 体积下与旧值 16 / 3 对齐的系数
      const w = effect.width || 20;
      ctx.save();
      ctx.globalAlpha = alpha * 0.85;
      // 激光管：粗线 + 外发光
      ctx.lineWidth = w * 0.8;
      ctx.strokeStyle = effect.color;
      ctx.shadowColor = effect.color;
      ctx.shadowBlur = 20;
      ctx.beginPath();
      ctx.moveTo(effect.x1, effect.y1);
      ctx.lineTo(effect.x2, effect.y2);
      ctx.stroke();
      ctx.shadowBlur = 0;
      // 中心高亮白线
      ctx.lineWidth = Math.max(1, w * 0.15);
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
  ui.drawUI(game);

  // 拖拽预览最后绘制，盖住商店面板，确保拖放图标始终可见
  drawDragPreview(game);
}

/**
 * 绘制弹道与爆炸/扇形特效。
 * 原先嵌套在 render() 内部（靠函数声明提升被调用），现提到顶层。
 */


/**
 * 绘制弹道与爆炸/扇形特效。
 * 原先嵌套在 render() 内部（靠函数声明提升被调用），现提到顶层。
 */
function drawProjectiles(game) {
  const ctx = game.ctx;
  for (const proj of game.projectiles) {
    if (!proj.alive) continue;

    ctx.save();
    // 朝向变换（平移到弹道位置 → 按飞行方向旋转 → 叠加自旋）唯一入口见 src/aim.js。
    // 全部塔型（含平行塔）的弹道都跟随飞行方向旋转 —— 形状代码里不用再手写旋转。
    aim.applyProjectileTransform(ctx, proj);
    drawProjectileShape(ctx, proj);
    ctx.restore();
  }

  drawEffects(game);
}

/**
 * 绘制一条弹道的轮廓（本地坐标系：0 rad = 飞行方向 = +x，朝向已由 aim 施加）。
 *
 * ⚠️ 这里画的东西**一律"朝右"**：
 *   · 需要"指向飞行方向"的轮廓（三角 / 箭形 / 长方 / 半圆 / 扇形）直接朝 +x 画即可；
 *   · 扇形不要再拿 `proj.angle ± 45°` 当圆心角 —— 外层已经转过一次，
 *     再按朝向画一次等于**转了两遍**（飞 45°、扇面指 90°，2026-09 修的就是这个）；
 *   · 平行塔的双横不需要任何"反向旋转"补丁：它已回归默认 FOLLOW，外层按朝向转一次。
 *
 * 自适应：未登记的图形落到 `default` 分支，用 theme.drawTowerIcon 按同一个轮廓
 * 等比缩小画出来 —— **新图形一登记就自动有弹道，不会再出现"子弹隐身"**。
 * （想让某个新图形的弹道和现有 16 种一样走定制画法，就在 switch 里补一条，属于可选项。）
 */


/**
 * 绘制一条弹道的轮廓（本地坐标系：0 rad = 飞行方向 = +x，朝向已由 aim 施加）。
 *
 * ⚠️ 这里画的东西**一律"朝右"**：
 *   · 需要"指向飞行方向"的轮廓（三角 / 箭形 / 长方 / 半圆 / 扇形）直接朝 +x 画即可；
 *   · 扇形不要再拿 `proj.angle ± 45°` 当圆心角 —— 外层已经转过一次，
 *     再按朝向画一次等于**转了两遍**（飞 45°、扇面指 90°，2026-09 修的就是这个）；
 *   · 平行塔的双横不需要任何"反向旋转"补丁：它已回归默认 FOLLOW，外层按朝向转一次。
 *
 * 自适应：未登记的图形落到 `default` 分支，用 theme.drawTowerIcon 按同一个轮廓
 * 等比缩小画出来 —— **新图形一登记就自动有弹道，不会再出现"子弹隐身"**。
 * （想让某个新图形的弹道和现有 16 种一样走定制画法，就在 switch 里补一条，属于可选项。）
 */
function drawProjectileShape(ctx, proj) {
  // 绘制小型塔图标作为弹道
  ctx.fillStyle = proj.color;
  ctx.globalAlpha = 0.9;

  const size = 3; // 弹道大小（原6，减小50%）
  ctx.strokeStyle = THEME.text.primary;
  ctx.lineWidth = 1;

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
        // 扇塔弹道：绘制小扇形（本地坐标 —— 扇面平分线就是 +x，即飞行方向）
        // ⛔ 别写成 `proj.angle ± π/4`：外层已经按朝向转过一次，再带上朝向 = 转两遍
        ctx.fillStyle = proj.color;
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, size * 1.5, -Math.PI / 4, Math.PI / 4);
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
        // 自旋已由 aim.applyProjectileTransform 叠加（政策 square.projectileSpin），
        // 这里只画正立的正方形
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

      case 'parallel': {
        // 平行塔弹道：迷你双横（"二"字，两条小横杠）。
        // "朝右"版本就是水平双横（0 rad = 朝右）；随飞行方向整体旋转由
        // 外层 aim.applyProjectileTransform 统一施加（政策默认 FOLLOW）。
        const pBarW = size * 2.2, pBarH = size * 0.8, pBarGap = size * 0.5;
        ctx.beginPath();
        ctx.roundRect(-pBarW / 2, -pBarGap / 2 - pBarH, pBarW, pBarH, 1);
        ctx.roundRect(-pBarW / 2, pBarGap / 2, pBarW, pBarH, 1);
        ctx.fill();
        ctx.stroke();
        break;
      }

      default: {
        // 未登记的图形（新扩展的塔型，或辅助塔那种本不该有弹道的塔）：
        // 用 theme.drawTowerIcon 按**同一个轮廓**等比缩小画一份 —— 永远不会静默不画。
        // 缩放取固定基准：各轮廓的 approxR 落在 10~13.8，乘 0.28 后约 3px，
        // 与上面 size=3 的手绘弹道视觉尺寸相当（这里只要求"看得见 + 形状是对的"）。
        drawTowerIcon(ctx, 0, 0, proj.color, proj.type, 0.28);
        break;
      }
      // 注：梯形塔 / 菱形塔是辅助光环塔，无攻击手段，正常不会走到这里；
      //     万一将来有弹道，上面的 default 兜底会按它们的轮廓画出来。
  }
}

/**
 * 绘制特效层：爆炸圈 / 扇塔扫掠 / 激光线。
 *
 * 这些特效**直接吃世界坐标**（effect.x / effect.y / effect.angle），
 * 不参与朝向系统 —— 它们自己就是按世界坐标算好的几何，别再套一层旋转。
 */


/**
 * 绘制特效层：爆炸圈 / 扇塔扫掠 / 激光线。
 *
 * 这些特效**直接吃世界坐标**（effect.x / effect.y / effect.angle），
 * 不参与朝向系统 —— 它们自己就是按世界坐标算好的几何，别再套一层旋转。
 */
function drawEffects(game) {
  const ctx = game.ctx;

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

    // 绘制闪电链弧（闪电塔「雷电链」：主目标 → 副目标 的锯齿折线）
    if (effect.type === 'bolt_chain') {
      const alpha = effect.life / effect.maxLife;
      const segs = 5;
      const dx = effect.x2 - effect.x1;
      const dy = effect.y2 - effect.y1;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len;
      const pts = [];
      for (let i = 1; i < segs; i++) {
        const jitter = i === segs - 1 ? 0 : Math.sin((effect.seed || 0) + i * 7.13) * 5;
        pts.push([effect.x1 + dx * (i / segs) + nx * jitter,
                  effect.y1 + dy * (i / segs) + ny * jitter]);
      }
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.lineCap = 'round';
      // 外层粗线 + 电光：亮黄色闪电折线带发光
      ctx.strokeStyle = effect.color;
      ctx.lineWidth = 2.5;
      ctx.shadowColor = effect.color;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(effect.x1, effect.y1);
      for (const p of pts) ctx.lineTo(p[0], p[1]);
      ctx.lineTo(effect.x2, effect.y2);
      ctx.stroke();
      // 中心白线高亮，更有"电光"感
      ctx.shadowBlur = 0;
      ctx.globalAlpha = alpha * 0.9;
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(effect.x1, effect.y1);
      for (const p of pts) ctx.lineTo(p[0], p[1]);
      ctx.lineTo(effect.x2, effect.y2);
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
 * 轻提示（操作反馈）：多条同屏、各自独立计时、互相顶位。
 * 数据由 theme.pushToast 写入 game.toasts = [{ text, color, t0, duration, y }]。
 *
 * 动效：
 *   ① 默认出现在屏幕高度 45% 处，先原地淡入（淡入期间不位移），
 *      同时带一个「由大到小」的收缩动画（spawnScale → 1.0）；
 *   ② 淡入完成后开始向上漂浮；
 *   ③ 后续提示到来时，把前面的整体顶上去（y 逐帧缓动，不瞬移），形成动态层次；
 *   ④ 每条活满各自的 duration 后淡出并回收。
 * 视觉：文字上下各一条「中间实、两端渐隐」的分割线；
 *      背景为横向渐变（中间不透明度高、两侧渐隐为透明），不用旧的圆角药丸 + 描边。
 */


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
  } else if (scene === 'bag') {
    bag.drawBag(game);
  } else {
    drawBattle(game);
  }

  // 宝石浮层（嵌入列表 / 宝石详情 / 合成）：模态，盖在场景内容之上、导航栏之下
  // （与旧版选宝石浮层的层级一致 —— 导航栏始终可见可点，点导航切场景会顺带收掉浮层）
  if ((scene === 'codex' || scene === 'bag') && gemModal.hasActive(game)) {
    gemModal.drawGemModal(game);
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
    ui.drawTowerPanel(game);
  }

  // 强化「多选一」浮层：模态，必须盖住塔属性面板
  if (game.enhancePicker && scene === 'battle') {
    enhanceMod.drawEnhancePicker(game);
  }

  // 结算界面：必须盖住底部导航栏（否则玩家能在结算界面点导航溜走）
  // 判据与输入层共用 game.isSettlementActive()（= battle 场景 + 胜利或 lives<=0），
  // 保证"实际画出来的"与"允许点的"永远是同一套前提。
  if (game.isSettlementActive()) {
    ui.drawGameOver(game);
  }

  // 操作轻提示
  ui.drawToasts(game);
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
  // 弹道层：drawProjectiles = 弹道循环 + 特效层；
  // drawProjectileShape / drawEffects 拆出来是为了能被探针单独调用（无 UI 噪声地断言几何）
  drawProjectiles,
  drawProjectileShape,
  drawEffects,
  drawBossBars,
  getTeamBoss,
  updateHpGhost,
  advanceHpGhost,
  advanceBossGhost,
  ghostPctOf,
  drawTowerIcon,
  drawTower,
  drawDragPreview,
  drawTaperedDivider,
  wrapTextLines,
  getTowerStats,
  // 面板布局真源 + 宝石区块高度公式（导出给探针用：卡不许溢出区块，
  // 否则"宝石 → 强化"那条分隔线会压在最后一张卡上）

};
