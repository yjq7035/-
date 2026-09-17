// ============================================================================
// 底部导航栏 —— src/nav.js
// ----------------------------------------------------------------------------
// 位置：贴屏幕最底（最底一层的 UI，商店面板叠在它上面）。
// 5 个按钮：1 号（待扩展）/ 2 号 图签 / 3 号 战斗 ⚔️ / 4 号 天赋 / 5 号（待扩展）
//
// 约定：
//  · 1、5 号为占位按钮：绘制成虚线禁用态，点击无效（后续想到内容再接）。
//  · 3 号（⚔️）为默认激活项，战斗场景的入口；点击它永远回到战斗。
//  · 激活项有金色顶条 + 高亮底 + 金色文字，未激活为灰阶。
// ============================================================================

const { LAYOUT } = require('./config');
const theme = require('./theme');

const { THEME, roundRectPath, drawStar, drawDashedBox, drawButtonFx } = theme;

// 导航项定义（唯一真源）
// icon: 字符图标（emoji 直接 fillText，WeChat canvas 支持）；
// star: true 时改用矢量星形绘制（比 emoji 更可控）
const NAV_ITEMS = [
  { id: 'nav1',    scene: null,      icon: null,  label: '待扩展', disabled: true },
  { id: 'codex',   scene: 'codex',   icon: '📖',  label: '图签' },
  { id: 'battle',  scene: 'battle',  icon: '⚔️',  label: '战斗' },
  { id: 'talents', scene: 'talents', icon: '✨',  label: '天赋' },
  { id: 'bag',     scene: 'bag',     icon: '🎒',  label: '背包' },
];

const NAV_UI = {
  height: LAYOUT.navHeight,   // 58
  iconSize: 19,
  iconDY: -10,                // 图标相对每格中心的上偏
  labelDY: 13,                // 文字相对每格中心的下偏
  topBarH: 3,                 // 激活项顶条高度
  // 战斗格专用（多一行状态字，图标/文字整体上移）
  battleIconDY: -12,
  battleLabelDY: 8,
  battleStatusDY: 21,
};

/**
 * 战斗格的状态（动态显示"游戏是否已经开始"）。
 * @returns {{ started:boolean, live:boolean, text:string, color:string, pulse:boolean }}
 */
function battleStatus(game) {
  const started = !!game.battleStarted && !game.gameOver;
  const inBattle = (game.scene || 'battle') === 'battle';
  if (!started) {
    return { started: false, live: false, text: '待开始', color: '#FFB74D', pulse: true };
  }
  if (!inBattle) {
    // 已开打但人不在战斗页（在图签/天赋）→ 世界冻结，闪呼吸点提示"还活着"
    return { started: true, live: true, text: '战斗中', color: '#66BB6A', pulse: true };
  }
  return { started: true, live: true, text: '进行中', color: '#66BB6A', pulse: true };
}

/**
 * 计算导航栏布局（纯函数，渲染/输入共用）
 * @returns {{ x, y, w, h, items: Array<{id,scene,icon,label,disabled,x,y,w,h}> }}
 */
function getNavLayout(game) {
  const W = game.W;
  const H = game.H;
  const y = H - NAV_UI.height;
  const itemW = W / NAV_ITEMS.length;

  const items = NAV_ITEMS.map((it, i) => ({
    id: it.id,
    scene: it.scene,
    icon: it.icon,
    label: it.label,
    disabled: !!it.disabled,
    idx: i,
    x: i * itemW,
    y: y,
    w: itemW,
    h: NAV_UI.height,
  }));

  return { x: 0, y: y, w: W, h: NAV_UI.height, items: items };
}

/** 命中检测：返回导航项 id 或 null */
function hitNav(game, pos) {
  const L = getNavLayout(game);
  if (pos.y < L.y) return null;
  for (const it of L.items) {
    if (pos.x >= it.x && pos.x < it.x + it.w) return it.id;
  }
  return null;
}

/** 当前激活的导航项 id（由 scene 反查） */
function activeNavId(game) {
  const scene = game.scene || 'battle';
  for (const item of NAV_ITEMS) {
    if (item.scene === scene) return item.id;
  }
  return 'battle';
}

/**
 * 绘制底部导航栏。
 * 注意：由 render() 在所有场景内容之后调用，因此天然压在商店面板之上。
 */
function drawNav(game) {
  const ctx = game.ctx;
  const L = getNavLayout(game);
  const activeId = activeNavId(game);

  ctx.save();

  // 栏底
  ctx.fillStyle = THEME.surface.nav;
  ctx.fillRect(L.x, L.y, L.w, L.h);

  // 顶部分隔线（发丝）
  ctx.strokeStyle = THEME.border.normal;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(L.x, L.y + 0.5);
  ctx.lineTo(L.x + L.w, L.y + 0.5);
  ctx.stroke();

  if (typeof ctx.createLinearGradient === 'function') {
    // 轻微上浅下深的体积感
    const g = ctx.createLinearGradient(0, L.y, 0, L.y + L.h);
    g.addColorStop(0, 'rgba(255, 255, 255, 0.04)');
    g.addColorStop(1, 'rgba(0, 0, 0, 0.10)');
    ctx.fillStyle = g;
    ctx.fillRect(L.x, L.y + 1, L.w, L.h - 1);
  }

  for (const it of L.items) {
    const cx = it.x + it.w / 2;
    const cy = it.y + it.h / 2;
    const active = (it.id === activeId) && !it.disabled;
    const pressed = theme.isButtonPressed(game, 'nav:' + it.id);

    // 激活项：顶条 + 底色
    if (active) {
      const g = ctx.createLinearGradient(0, it.y, 0, it.y + it.h);
      g.addColorStop(0, 'rgba(255, 215, 0, 0.14)');
      g.addColorStop(1, 'rgba(255, 215, 0, 0.01)');
      ctx.fillStyle = g;
      ctx.fillRect(it.x + 2, it.y + NAV_UI.topBarH, it.w - 4, it.h - NAV_UI.topBarH);

      ctx.fillStyle = THEME.accent.gold;
      roundRectPath(ctx, cx - it.w * 0.22, it.y + 1, it.w * 0.44, NAV_UI.topBarH, 1.5);
      ctx.fill();
    }

    // 按压态：整格压暗
    if (pressed) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
      ctx.fillRect(it.x + 1, it.y + 1, it.w - 2, it.h - 2);
    }

    const iconColor = it.disabled ? THEME.text.off : (active ? THEME.accent.gold : THEME.text.secondary);
    const labelColor = it.disabled ? THEME.text.off : (active ? THEME.accent.gold : THEME.text.dim);

    // 战斗格多一行状态字：图标与名称整体上移，给状态让位
    const isBattle = (it.id === 'battle' && !it.disabled);
    const iconCY = cy + (isBattle ? NAV_UI.battleIconDY : NAV_UI.iconDY);
    const labelY = cy + (isBattle ? NAV_UI.battleLabelDY : NAV_UI.labelDY);

    if (it.disabled) {
      // 占位按钮：虚线方框 + 问号，明确表达"这里以后会有东西"
      const s = 22;
      drawDashedBox(ctx, cx - s / 2, iconCY - s / 2, s, s, 5, THEME.border.subtle);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 13px Arial';
      ctx.fillStyle = THEME.text.off;
      ctx.fillText('?', cx, iconCY);
    } else if (it.id === 'battle') {
      // 战斗：矢量双剑（不依赖 emoji 字体，任何设备都稳定出图形）；
      // 同时叠加 ⚔️ 字样，二者取一由设备字体决定，视觉上都是"一把剑"。
      drawSwords(ctx, cx, iconCY, 11, iconColor);
    } else if (it.id === 'talents') {
      // 天赋：矢量四角星
      drawSpark(ctx, cx, iconCY, 10, iconColor);
    } else if (it.id === 'bag') {
      // 背包：矢量挎包（不依赖 emoji 字体，任何设备都稳定出图形）
      drawBackpack(ctx, cx, iconCY, 10, iconColor);
    } else if (it.icon) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `${NAV_UI.iconSize}px Arial`;
      ctx.fillStyle = iconColor;
      ctx.fillText(it.icon, cx, iconCY + 1);
    }

    // 文字
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 10px Arial';
    ctx.fillStyle = labelColor;
    ctx.fillText(it.label, cx, labelY);

    // 战斗格：动态状态（待开始 / 进行中 / 战斗中）+ 呼吸圆点
    if (isBattle) {
      const st = battleStatus(game);
      const blink = 0.45 + 0.55 * Math.abs(Math.sin(Date.now() / 520));
      ctx.save();
      ctx.globalAlpha = st.pulse ? blink : 1;
      ctx.beginPath();
      ctx.arc(cx + 15, iconCY - 8, 3, 0, Math.PI * 2);
      ctx.fillStyle = st.color;
      ctx.fill();
      ctx.restore();

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 9px Arial';
      ctx.fillStyle = st.color;
      ctx.fillText(st.text, cx, cy + NAV_UI.battleStatusDY);
    }
  }

  ctx.restore();

  // 导航项的点击波纹（只画 nav 层）
  drawButtonFx(game, ctx, 'nav');
}

/**
 * 矢量双剑图标（战斗）
 * 两把斜向长剑交叉成 X，剑身 + 十字护手 + 剑柄，纯路径绘制。
 */
function drawSwords(ctx, cx, cy, r, color) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const dir of [1, -1]) {
    ctx.save();
    ctx.rotate(dir * Math.PI / 4);

    // 剑身（从中心向上的细长菱形）
    ctx.beginPath();
    ctx.moveTo(0, -r * 1.05);
    ctx.lineTo(r * 0.17, -r * 0.72);
    ctx.lineTo(r * 0.17, r * 0.30);
    ctx.lineTo(-r * 0.17, r * 0.30);
    ctx.lineTo(-r * 0.17, -r * 0.72);
    ctx.closePath();
    ctx.fill();

    // 护手
    ctx.lineWidth = Math.max(1.4, r * 0.17);
    ctx.beginPath();
    ctx.moveTo(-r * 0.42, r * 0.32);
    ctx.lineTo(r * 0.42, r * 0.32);
    ctx.stroke();

    // 剑柄 + 配重球
    ctx.lineWidth = Math.max(1.4, r * 0.16);
    ctx.beginPath();
    ctx.moveTo(0, r * 0.34);
    ctx.lineTo(0, r * 0.72);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, r * 0.80, r * 0.13, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  ctx.restore();
}

/** 矢量星芒（天赋） */
function drawSpark(ctx, cx, cy, r, color) {
  const inner = r * 0.30;
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const radius = i % 2 === 0 ? r : inner;
    const a = (Math.PI / 4) * i - Math.PI / 2;
    const x = cx + radius * Math.cos(a);
    const y = cy + radius * Math.sin(a);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

/**
 * 矢量背包图标（背包）
 * 造型：上提手 + 梯形包体 + 前袋 + 中缝扣带，纯路径绘制。
 */
function drawBackpack(ctx, cx, cy, r, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const w = r * 1.62;   // 包体宽
  const h = r * 1.58;   // 包体高
  const bx = cx - w / 2;
  const by = cy - h * 0.32;

  // 提手（包体上方的半圆）
  ctx.lineWidth = Math.max(1.2, r * 0.16);
  ctx.beginPath();
  ctx.arc(cx, by, r * 0.42, Math.PI * 1.12, Math.PI * 1.88);
  ctx.stroke();

  // 包体
  ctx.beginPath();
  ctx.moveTo(bx, by + r * 0.30);
  ctx.lineTo(bx + w * 0.10, by + h);
  ctx.lineTo(bx + w * 0.90, by + h);
  ctx.lineTo(bx + w, by + r * 0.30);
  ctx.closePath();
  ctx.fill();

  // 前袋（在包体上压一层暗色，形成"口袋"的观感）
  // ⚠️ 不要用 destination-out 挖洞：那会连导航栏底一起挖穿，露出页面底色。
  ctx.fillStyle = 'rgba(0, 0, 0, 0.32)';
  ctx.fillRect(bx + w * 0.22, by + h * 0.62, w * 0.56, h * 0.30);
  ctx.fillStyle = color;

  // 扣带
  ctx.lineWidth = Math.max(1.1, r * 0.14);
  ctx.beginPath();
  ctx.moveTo(bx + w * 0.30, by + h * 0.44);
  ctx.lineTo(bx + w * 0.70, by + h * 0.44);
  ctx.stroke();

  ctx.restore();
}

module.exports = {
  NAV_ITEMS,
  NAV_UI,
  getNavLayout,
  hitNav,
  activeNavId,
  battleStatus,
  drawNav,
};
