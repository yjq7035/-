// 渲染层核心：游戏实体绘制（塔、怪、弹道、战斗场景）。
// 由 src/renderer.js 薄壳 re-export。
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

const {
  THEME, TOAST, shade, teamBandGradient, easeOutCubic, easeOutBack,
  roundRectPath, drawStar, drawTowerIcon, wrapTextLines, wrapText,
  drawTaperedDivider, drawButton, drawButtonFx, isButtonPressed,
  drawPillTitle, drawChip, ellipsize, drawChevron, drawScrollBar,
} = theme;

const getTowerStats = towerMod.getTowerStats;

// BOSS 阵营色族
const BOSS_TEAM_COLORS = {
  red:  new Set(['#FF0000']),
  blue: new Set(['#9900FF']),
};

// 小怪血条鬼影
const ENEMY_HP_GHOST_DRAIN_SEC = 0.6;
const BOSS_GHOST_DECAY_SEC = 0.5;
const GHOST_SNAP_FRAC = 0.001;

// ========== 路径与槽位 ==========

function drawPath(game) {
  const ctx = game.ctx;
  ctx.save();
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
  drawEndpointMarker(ctx, game.pathStart.x, game.pathStart.y, THEME.team.blue.solid, '起');
  drawEndpointMarker(ctx, game.pathEnd.x, game.pathEnd.y, THEME.team.red.solid, '终');
  ctx.restore();
}

function drawEndpointMarker(ctx, x, y, color, label) {
  const time = Date.now() / 1000;
  const r = 13;
  const pulse = 0.5 + 0.5 * Math.sin(time * 2.2);

  ctx.save();
  const glowR = r + 8 + pulse * 4;
  const glow = ctx.createRadialGradient(x, y, r * 0.5, x, y, glowR);
  glow.addColorStop(0, shade(color, 0.2, 0.35 + 0.2 * pulse));
  glow.addColorStop(1, shade(color, 0.2, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, glowR, 0, Math.PI * 2);
  ctx.fill();

  const body = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.2, x, y, r * 1.05);
  body.addColorStop(0, shade(color, 0.45));
  body.addColorStop(1, shade(color, -0.25));
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, y, r - 1.5, Math.PI * 1.05, Math.PI * 1.95);
  ctx.stroke();

  ctx.strokeStyle = shade(color, -0.4, 0.9);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();

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
    ctx.fillStyle = slot.occupied ? 'rgba(229, 115, 115, 0.15)' : 'rgba(229, 115, 115, 0.05)';
    ctx.strokeStyle = game.selectedTowerType ? 'rgba(229, 115, 115, 0.6)' : THEME.border.normal;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(slot.x, slot.y, slot.size, slot.size, THEME.radius.small);
    ctx.fill();
    ctx.stroke();

    if (slot.occupied && slot.tower) {
      const tower = slot.tower;
      if (tower.level > 0) {
        const glowIntensity = Math.min(tower.level / 6, 1);
        const pulse = 0.5 + 0.5 * Math.sin(time * 3);
        const alpha = glowIntensity * 0.3 * pulse;
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
        game.clickEffect = null;
      }
    }
    ctx.restore();
  }
}

// ========== 怪物绘制 ==========

function drawEnemy(game, enemy, withHpBar = true) {
  if (!enemy.alive) return;
  const ctx = game.ctx;
  const s = enemy.size;
  const half = s / 2;
  const color = enemy.color;

  ctx.save();

  // 地面投影
  ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
  ctx.beginPath();
  ctx.ellipse(enemy.x, enemy.y + half * 0.7, half * 1.05, half * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();

  // 本体：圆角方块 + 径向渐变
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

  // 顶部高光弧
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(enemy.x, enemy.y, half * 0.7, Math.PI * 1.15, Math.PI * 1.85);
  ctx.stroke();

  // 外描边
  ctx.strokeStyle = shade(color, -0.45);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(enemy.x - half, enemy.y - half, s, s, rr);
  ctx.stroke();

  // 加速怪标识
  if (enemy.type === 'fast') {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    const cw = half * 0.55;
    const cy = enemy.y;
    for (let k = 0; k < 2; k++) {
      const ox = -cw * 0.45 + k * cw * 0.55;
      ctx.beginPath();
      ctx.moveTo(enemy.x + ox - cw * 0.35, cy - cw * 0.45);
      ctx.lineTo(enemy.x + ox + cw * 0.25, cy);
      ctx.lineTo(enemy.x + ox - cw * 0.35, cy + cw * 0.45);
      ctx.stroke();
    }
  }

  // 等级点缀
  if (enemy.tier >= 3) {
    ctx.strokeStyle = THEME.accent.gold;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(enemy.x, enemy.y, half + 3, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (enemy.tier >= 4) {
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

  if (withHpBar && enemy.hp < enemy.maxHp) {
    drawEnemyHpBar(game, enemy);
  }

  ctx.restore();
}

function drawEnemyHpBar(game, enemy) {
  if (!enemy.alive || enemy.hp >= enemy.maxHp) return;
  const ctx = game.ctx;
  const s = enemy.size;
  const half = s / 2;

  ctx.save();
  const pct = Math.max(0, enemy.hp / enemy.maxHp);
  const ghostPct = advanceHpGhost(enemy, frameDt(game));
  const barW = Math.max(20, s);
  const barH = 4;
  const barX = enemy.x - barW / 2;
  const barY = enemy.y - half - (enemy.tier >= 4 ? 16 : 10);

  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.beginPath();
  ctx.roundRect(barX, barY, barW, barH, barH / 2);
  ctx.fill();

  if (ghostPct > pct + 1e-4) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.beginPath();
    ctx.roundRect(barX, barY, Math.max(barH, barW * ghostPct), barH, barH / 2);
    ctx.fill();
  }

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
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(barX, barY, barW, barH, barH / 2);
  ctx.stroke();
  ctx.restore();
}

// ========== BOSS 血条 ==========

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

// 鬼影推进器
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

function advanceBossGhost(unit, dt) {
  const maxHp = unit.maxHp > 0 ? unit.maxHp : 1;
  const hp = Math.max(0, Math.min(maxHp, unit.hp || 0));
  const step = Math.max(0, dt);
  const poolPrev = typeof unit._hpGhostPool === 'number' ? unit._hpGhostPool : 0;
  const ghostPrev = typeof unit._hpGhost === 'number' ? unit._hpGhost : hp;
  const hpPrev = Math.max(0, Math.min(maxHp, ghostPrev - poolPrev));
  const dealt = Math.max(0, hpPrev - hp);

  let pool = poolPrev * Math.exp(-step / BOSS_GHOST_DECAY_SEC) + dealt;
  let ghost = hp + pool;
  if (hp >= maxHp || !(ghost > hp)) { ghost = hp; pool = 0; }
  else if (ghost > maxHp) { ghost = maxHp; pool = maxHp - hp; }
  else if (pool <= maxHp * GHOST_SNAP_FRAC) { ghost = hp; pool = 0; }

  unit._hpGhost = ghost;
  unit._hpGhostPool = pool;
  return ghost / maxHp;
}

function advanceHpGhost(unit, dt) {
  return (unit && (unit.tier || 0) >= 4)
    ? advanceBossGhost(unit, dt)
    : updateHpGhost(unit, dt, ENEMY_HP_GHOST_DRAIN_SEC);
}

function ghostPctOf(unit) {
  const maxHp = unit.maxHp > 0 ? unit.maxHp : 1;
  const ghost = typeof unit._hpGhost === 'number' ? unit._hpGhost : (unit.hp || 0);
  return Math.max(0, Math.min(1, ghost / maxHp));
}

function frameDt(game) {
  const dt = game && game.dt;
  return (typeof dt === 'number' && dt > 0) ? Math.min(dt, 0.1) : 1 / 60;
}

function drawBossHealthBar(ctx, boss, cx, cy, team, maxW) {
  const w = Math.min(maxW, 320);
  const h = 14;
  const x = cx - w / 2;
  const y = cy - h / 2;
  const pct = Math.max(0, Math.min(1, boss.hp / boss.maxHp));
  const main = team === 'red' ? THEME.team.red.solid : THEME.team.blue.solid;
  const light = team === 'red' ? THEME.team.red.light : THEME.team.blue.light;

  const ghostPct = ghostPctOf(boss);

  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.beginPath();
  ctx.roundRect(x - 3, y - 3, w + 6, h + 6, (h + 6) / 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h / 2);
  ctx.fill();

  if (ghostPct > pct + 1e-4) {
    const gw = Math.max(h, w * ghostPct);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
    ctx.beginPath();
    ctx.roundRect(x, y, gw, h, h / 2);
    ctx.fill();
    const edgeW = 2;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.beginPath();
    ctx.roundRect(x + gw - edgeW - 1, y + 1, edgeW, h - 2, edgeW / 2);
    ctx.fill();
  }

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

  ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.beginPath();
  ctx.roundRect(x + h * 0.35, y + 2, Math.max(0, w - h * 0.7), 2.5, 1.25);
  ctx.fill();

  ctx.strokeStyle = THEME.border.strong;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h / 2);
  ctx.stroke();

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

// ========== 塔绘制 ==========

function drawTower(ctx, game, tower) {
  const towerDef = TOWER_DEFS[tower.type];
  if (!towerDef) return;

  ctx.save();
  const placed = aim.applyIconTransform(ctx, tower);
  drawTowerIcon(ctx, placed.x, placed.y, towerDef.color, tower.type);
  ctx.restore();

  let slot = null;
  for (const s of game.slots) {
    if (s.tower === tower) { slot = s; break; }
  }

  if (tower.level > 0 && slot) {
    const big = tower.level >= 6;
    const count = big ? 1 : tower.level;
    const outerR = big ? 9 : 6;
    const spacing = big ? 0 : 13;
    const starTop = anchorPointOf(slot, 'top', { y: -12 });
    const centerY = starTop.y + outerR;
    const totalWidth = count * spacing;
    const startX = tower.x - totalWidth / 2;
    for (let i = 0; i < count; i++) {
      drawStar(ctx, startX + i * spacing + outerR, centerY, outerR, THEME.accent.gold);
    }
  }

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

function towerStageTag(tower) {
  if (!tower) return '';
  const stars = stageMod.clampStage(tower.stage);
  if (stars <= 0) return '';
  if (tower.isSupport) {
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

// ========== 弹道与特效 ==========

function drawProjectiles(game) {
  const ctx = game.ctx;
  for (const proj of game.projectiles) {
    if (!proj.alive) continue;
    ctx.save();
    aim.applyProjectileTransform(ctx, proj);
    drawProjectileShape(ctx, proj);
    ctx.restore();
  }
  drawEffects(game);
}

function drawProjectileShape(ctx, proj) {
  ctx.fillStyle = proj.color;
  ctx.globalAlpha = 0.9;
  const size = 3;
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
      ctx.beginPath();
      ctx.arc(0, 0, size + 2, 0, Math.PI * 2);
      ctx.fillStyle = proj.color;
      ctx.fill();
      ctx.strokeStyle = THEME.text.primary;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.shadowColor = proj.color;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(0, 0, size, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      break;

    case 'sector':
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
      {
        const sq = Math.max(1.5, (proj.size || 10) * 0.3);
        ctx.fillRect(-sq, -sq, sq * 2, sq * 2);
        ctx.strokeRect(-sq, -sq, sq * 2, sq * 2);
      }
      break;

    case 'diamond':
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
      ctx.beginPath();
      ctx.ellipse(0, 0, size * 1.2, size * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;

    case 'star':
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
      ctx.strokeStyle = '#FFD700';
      ctx.lineWidth = 3;
      drawLightningStroke(ctx, -size * 0.2, size, size * 0.2, -size, 3, '#FFD700');
      ctx.stroke();
      break;

    case 'chain_bolt':
      ctx.strokeStyle = '#FFA500';
      ctx.lineWidth = 2;
      drawLightningStroke(ctx, -size * 0.2, size, size * 0.2, -size, 3, '#FFA500');
      ctx.stroke();
      break;

    case 'semicircle':
      ctx.beginPath();
      ctx.arc(0, 0, size, -Math.PI / 2, Math.PI / 2);
      ctx.lineTo(0, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;

    case 'parallel':
      const pBarW = size * 2.2, pBarH = size * 0.8, pBarGap = size * 0.5;
      ctx.beginPath();
      ctx.roundRect(-pBarW / 2, -pBarGap / 2 - pBarH, pBarW, pBarH, 1);
      ctx.roundRect(-pBarW / 2, pBarGap / 2, pBarW, pBarH, 1);
      ctx.fill();
      ctx.stroke();
      break;

    default:
      drawTowerIcon(ctx, 0, 0, proj.color, proj.type, 0.28);
      break;
  }
}

function drawEffects(game) {
  const ctx = game.ctx;
  for (const effect of game.effects) {
    if (effect.type === 'explosion') {
      const alpha = effect.life / effect.maxLife;
      const progress = 1 - alpha;
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

// ========== 拖拽预览 ==========

function findDropTargetSlot(game, pos) {
  for (const slot of game.slots) {
    if (pos.x >= slot.x && pos.x <= slot.x + slot.size &&
        pos.y >= slot.y && pos.y <= slot.y + slot.size) {
      return slot;
    }
  }
  return null;
}

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

  let sourceSlot = null;
  if (game.dragFromShop && game.dragShopIdx !== undefined) {
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

  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.30)';
  ctx.beginPath();
  ctx.ellipse(pos.x, pos.y + 14, 16, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.translate(pos.x, pos.y);
  ctx.scale(1.15, 1.15);
  ctx.translate(-pos.x, -pos.y);
  drawTowerIcon(ctx, pos.x, pos.y, canAfford ? towerConfig.color : THEME.accent.danger, game.dragType);
  ctx.restore();

  if (canSell) {
    ctx.save();
    const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 200);
    const glow = ctx.createRadialGradient(pos.x, pos.y, 8, pos.x, pos.y, 30);
    glow.addColorStop(0, `rgba(255, 68, 68, ${0.4 + 0.2 * pulse})`);
    glow.addColorStop(1, 'rgba(255, 68, 68, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 30, 0, Math.PI * 2);
    ctx.fill();
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

// ========== 闪电绘制 ==========

function drawLightningStroke(ctx, x1, y1, x2, y2, segments, color) {
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 6;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  const dx = x2 - x1, dy = y2 - y1;
  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const px = x1 + dx * t + (i % 2 === 0 ? -1 : 1) * (dy * 0.04);
    const py = y1 + dy * t + (i % 2 === 0 ? 1 : -1) * (dx * 0.04);
    ctx.lineTo(px, py);
  }
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.shadowBlur = 0;
}

// ========== 战斗场景绘制 ==========

function drawBattle(game) {
  const ctx = game.ctx;

  drawPath(game);

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

  drawSlots(game);

  for (const tower of game.towers) {
    drawTower(ctx, game, tower);
  }

  for (const enemy of game.enemies) {
    if (enemy.alive) {
      drawEnemy(game, enemy, false);
    }
  }

  for (const enemy of game.enemies) {
    if (enemy.alive && enemy.hp < enemy.maxHp) {
      drawEnemyHpBar(game, enemy);
    }
  }

  drawProjectiles(game);

  for (const effect of game.effects) {
    if (effect.type === 'laser') {
      const alpha = effect.life / effect.maxLife;
      ctx.save();
      ctx.globalAlpha = alpha * 0.6;
      ctx.strokeStyle = effect.color;
      ctx.lineWidth = 1.5;
      ctx.shadowColor = effect.color;
      ctx.shadowBlur = 4;
      ctx.beginPath();
      ctx.moveTo(effect.x1, effect.y1);
      ctx.lineTo(effect.x2, effect.y2);
      ctx.stroke();
      ctx.restore();
    }
    if (effect.type === 'square_laser') {
      const alpha = effect.life / effect.maxLife;
      const w = effect.width || 20;
      ctx.save();
      ctx.globalAlpha = alpha * 0.85;
      ctx.lineWidth = w * 0.8;
      ctx.strokeStyle = effect.color;
      ctx.shadowColor = effect.color;
      ctx.shadowBlur = 20;
      ctx.beginPath();
      ctx.moveTo(effect.x1, effect.y1);
      ctx.lineTo(effect.x2, effect.y2);
      ctx.stroke();
      ctx.shadowBlur = 0;
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

  drawUI(game);
  drawDragPreview(game);
}

module.exports = {
  render,
  drawBattle,
  drawPath,
  drawSlots,
  drawEnemy,
  drawEnemyHpBar,
  drawBossHealthBar,
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
  drawUI,
  drawTopBar,
  drawGameOver,
  drawToasts,
  drawTowerPanel,
  drawTaperedDivider,
  wrapTextLines,
  getTowerStats,
  // 这些来自 theme 但被 renderer 重新导出给 game_core 用
  THEME,
};
