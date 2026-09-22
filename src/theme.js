// ============================================================================
// 视觉主题 + 通用绘制原子 —— src/theme.js
// ----------------------------------------------------------------------------
// 本文件【零依赖】（不 require 任何其它模块），因此可以被 renderer / shop /
// nav / codex / talents / levels 任意引用，不会产生循环依赖。
//
// 收敛目标：所有 UI 模块共享同一套色板与同一批绘制原子，避免"每个界面各自
// 一套圆角/描边/按钮样式"导致视觉分裂（重构前商店槽与结算按钮各画各的）。
// ============================================================================

// ========== 视觉风格 Token（design tokens，全 UI 唯一真源） ==========
// 所有 UI 元素（进度条 / 槽位 / 商店 / 面板 / 按钮 / 导航 / 胜负界面）都从这里取色，
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
    violet:   '#B388FF',  // 藏珍点 / 图签（第三种货币，区别于金币与天赋点）
    cyan:     '#4DD0E1',  // 天赋点
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
  // 页面/面板底色（暗色主题：底深、字亮）
  surface: {
    page:    '#1a1a2e',                    // 全屏背景（与战场同色，切场景不闪）
    panel:   'rgba(0, 0, 0, 0.55)',        // 面板底
    panelHi: 'rgba(255, 255, 255, 0.06)',  // 卡片底（比面板提亮一档）
    nav:     'rgba(12, 12, 24, 0.94)',     // 底部导航栏
    lock:    'rgba(0, 0, 0, 0.62)',        // 未解锁遮罩
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
    large:  14,   // 面板 / 卡片
  },
};

// ========== 轻提示（操作反馈）动效参数 ==========
// 多条提示同屏浮动：各自独立计时、互相顶位。
// 默认出现在屏幕高度 45% 处，淡入完成后开始向上漂浮。
const TOAST = {
  baseYRatio: 0.45,   // 基准位置：屏幕高度比例（0.45 = 45%）
  duration: 3.0,      // 每条默认存活秒数（pushToast 第 4 个参数可覆盖）
  fadeIn: 0.35,       // 淡入时长（秒）
  fadeOut: 0.6,       // 淡出时长（秒）
  rise: 26,           // 淡入后自身向上漂浮的总距离（逻辑像素）
  lineHeight: 26,     // 单条占位高度
  gap: 2,             // 堆叠时相邻两条的垂直间隙
  maxCount: 10,        // 同屏最多条数（超出丢弃最旧）
  fontSize: 14,
  spawnScale: 1.18,   // 淡入起手的放大倍数：从「大」收缩回 1.0（大到小）
  padX: 28,           // 背景/分割线在文字两侧的额外宽度
  dividerOffset: 9,   // 上下分割线相对文字中心线的偏移
  bgColor: '#000000', // 背景底色（横向渐隐：中间不透明、两端渐隐为透明）
  bgAlpha: 0.82,      // 背景中间的最大不透明度
};

/**
 * 推入一条轻提示（新提示系统：多条同屏、独立计时、互相顶位）。
 * 渲染见 renderer.drawToasts。
 * @param {object} game 游戏实例（只需能挂 toasts 数组）
 * @param {string} text 文案
 * @param {string} [color] 文字 / 分割线颜色（hex）
 * @param {number} [duration] 本条存活秒数，缺省用 TOAST.duration
 */
function pushToast(game, text, color, duration) {
  if (!game || text === undefined || text === null || text === '') return;
  if (!game.toasts) game.toasts = [];
  game.toasts.push({
    text: String(text),
    color: color || THEME.text.secondary,
    t0: Date.now(),
    duration: (typeof duration === 'number' && duration > 0) ? duration : TOAST.duration,
    y: null,   // 当前绘制 y：首帧落到目标位，之后逐帧缓动追目标（实现"被顶上去"的顺滑位移）
  });
  while (game.toasts.length > TOAST.maxCount) game.toasts.shift();
}

/**
 * 颜色明暗工具：把 #RRGGBB 按比例变亮/变暗（amount: -1~1，正=变亮，负=变暗）。
 * 用于给纯色生成渐变两端 / 高光 / 阴影，让"纯色"变成有体积感的渐变。
 * @param {string} hex 十六进制颜色（支持 #rgb / #rrggbb）
 * @param {number} amount -1~1
 * @param {number} [alpha] 可选输出 alpha
 * @returns {string} rgba() 字符串
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

// ========== 缓动 ==========
function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
function easeOutBack(t) { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }

// ========== 基础形状 ==========

/** 圆角矩形路径（不填充不描边，仅建路径，调用方自行 fill/stroke） */
function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r);
  } else {
    // 兜底：手动建路径（极老基础库）
    const rr = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  }
}

/**
 * 给 2d 上下文补一个 `roundRect`（缺失时）。
 *
 * ⚠️ 为什么必须补：`ctx.roundRect` 是很新的 Canvas 2D 接口，**微信小游戏的基础库版本
 * 差异很大**（老版本没有它）。而 renderer.js 里有几十处是**直接** `ctx.roundRect(...)`
 * 调用（没有逐个做 typeof 判断）。一旦运行环境缺这个方法，第一帧 `draw()` 就抛
 * `TypeError: ctx.roundRect is not a function` —— 主循环当场停摆，
 * 现象就是"画面定格、什么都点不动"。
 *
 * 在拿到 ctx 的地方一次补齐，比在几十个调用点各写一遍兜底可靠得多。
 * 语义对齐原生：**只往当前路径里追加一个闭合子路径，不自己 beginPath**。
 */
function polyfillRoundRect(ctx) {
  if (!ctx || typeof ctx.roundRect === 'function') return ctx;
  ctx.roundRect = function (x, y, w, h, radii) {
    let r = 0;
    if (typeof radii === 'number') r = radii;
    else if (radii && radii.length) r = radii[0];
    if (!isFinite(x) || !isFinite(y) || !isFinite(w) || !isFinite(h)) return;
    const lim = Math.min(Math.abs(w) / 2, Math.abs(h) / 2);
    const rr = Math.max(0, Math.min(isFinite(r) ? r : 0, lim));
    if (rr <= 0) {
      this.moveTo(x, y);
      this.lineTo(x + w, y);
      this.lineTo(x + w, y + h);
      this.lineTo(x, y + h);
      this.closePath();
      return;
    }
    this.moveTo(x + rr, y);
    this.lineTo(x + w - rr, y);
    this.quadraticCurveTo(x + w, y, x + w, y + rr);
    this.lineTo(x + w, y + h - rr);
    this.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    this.lineTo(x + rr, y + h);
    this.quadraticCurveTo(x, y + h, x, y + h - rr);
    this.lineTo(x, y + rr);
    this.quadraticCurveTo(x, y, x + rr, y);
    this.closePath();
  };
  return ctx;
}

/**
 * 给 2d 上下文补齐**所有**老基础库可能缺失的 Canvas 2D 接口。
 *
 * 为什么集中做：项目里对 ctx 的调用是"直接调"（不做逐个 typeof 判断），
 * 而微信小游戏基础库版本差异很大。任何一个新接口缺失，首帧/某帧就抛
 * TypeError → 该帧只画到一半（表现为界面残缺 + console 报错刷屏）。
 *
 * 实测（.workbuddy/tools/entry3.js，3.14.0 场景）：
 *   · 缺 roundRect   → 首帧直接抛错，主循环停摆（历史事故）
 *   · 缺 setLineDash → 战前选关界面画到 drawLadderRail 就抛错，只出 492 条指令（半张）
 *   · 缺 ellipse     → 绘制椭圆塔图标 / 敌人投影时抛错
 *
 * 语义对齐原生：只往**当前路径**追加子路径，不自己 beginPath。
 */
function polyfillCanvas2D(ctx) {
  if (!ctx) return ctx;
  polyfillRoundRect(ctx);

  // setLineDash：缺失时退化为"实线"（视觉降级，但绝不能抛错）
  if (typeof ctx.setLineDash !== 'function') {
    ctx.setLineDash = function () {};
  }
  if (typeof ctx.getLineDash !== 'function') {
    ctx.getLineDash = function () { return []; };
  }

  // ellipse：缺失时用「外接圆」近似（半径取两者均值），保证形状还在
  if (typeof ctx.ellipse !== 'function') {
    ctx.ellipse = function (cx, cy, rx, ry, rot, sa, ea, ccw) {
      if (!isFinite(cx) || !isFinite(cy) || !isFinite(rx) || !isFinite(ry)) return;
      const r = Math.max(0.5, (Math.abs(rx) + Math.abs(ry)) / 2);
      this.arc(cx, cy, r, sa, ea, !!ccw);
    };
  }

  return ctx;
}

/** 文本是否在矩形内（含 padding 收缩） */
function pointInRect(pos, rect, pad) {
  if (!rect) return false;
  const p = pad || 0;
  const w = (rect.w !== undefined) ? rect.w : rect.size;
  const h = (rect.h !== undefined) ? rect.h : rect.size;
  return pos.x >= rect.x - p && pos.x <= rect.x + w + p &&
         pos.y >= rect.y - p && pos.y <= rect.y + h + p;
}

/**
 * 绘制五角星图案（等级/阶段/稀有度显示，替代文本字符 ⭐）
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
 * 给已构建好的形状轮廓应用统一的"立体样式"：径向渐变填充 + 顶部光泽（裁剪到形状内）+ 深色描边。
 * 让"仅边框"的图形塔变成有体积感的填充图形。
 * @param {number} approxR 形状的近似半径（用于渐变/光泽范围）
 */
function applyTowerStyle(ctx, x, y, color, approxR) {
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

// ========== 图形塔图标（15 种轮廓，全项目统一绘制入口）==========
// 方向语义（全项目统一）：**轮廓一律画成"朝右"（正右方 = 0 度）**，
// 攻击朝向的旋转由 src/aim.js 施加（applyIconTransform / applyProjectileTransform），
// 本文件不再判断"哪种塔该不该转" —— 那份政策只有一处定义，在 aim.SHAPE_AIM。
const TOWER_SHAPES = [
  'triangle', 'circle', 'hexagon', 'square', 'trapezoid', 'semicircle',
  'sector', 'long_rectangle', 'diamond', 'oval', 'star',
  'cross', 'arrow', 'bolt', 'parallel',
];

/**
 * 绘制塔图标（纯函数）：按类型构建轮廓，再套用统一立体样式。
 *
 * ⚠️ 本函数只画"朝右"的那一份轮廓，**不负责朝向** —— 要按攻击朝向摆，
 *    请先调 aim.applyIconTransform(ctx, tower)（见 src/aim.js）。
 * @param {object} ctx 画布
 * @param {number} x 中心x
 * @param {number} y 中心y
 * @param {string} color 塔主色（未解锁时可传灰色）
 * @param {string} type 塔类型
 * @param {number} [scale] 整体缩放（默认 1；图签卡片/导航可放大）
 */
function drawTowerIcon(ctx, x, y, color, type, scale) {
  // ⚠️ 主色最终交给 CanvasGradient.addColorStop，而它对"解析不出来的颜色"是**抛错**的
  //    （SyntaxError: The value provided ('undefined') could not be parsed as a color）。
  //    历史事故：菱形塔改辅助塔时 TOWER_DEFS 丢了 color，图签一解锁就每帧抛；
  //    栈里只有 addColorStop + applyTowerStyle，看不出是哪座塔。这里提前喊停并**点名塔型**。
  if (typeof color !== 'string' || color === '') {
    throw new Error(`drawTowerIcon: 塔型「${type}」没有可用主色 —— 去补 TOWER_DEFS.${type}.color`);
  }
  const s = scale === undefined ? 1 : scale;
  ctx.save();
  if (s !== 1) {
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.translate(-x, -y);
  }
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
      const sqSize = 20;
      approxR = sqSize / 2;
      roundRectPath(ctx, x - sqSize / 2, y - sqSize / 2, sqSize, sqSize, 4);
      break;
    }

    case 'trapezoid': {
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
      const secR = 11;
      approxR = secR;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.arc(x, y, secR, -Math.PI / 4, Math.PI / 4);
      ctx.closePath();
      break;
    }

    case 'long_rectangle': {
      const rectW = 22;
      const rectH = 14;
      approxR = rectW / 2;
      roundRectPath(ctx, x - rectW / 2, y - rectH / 2, rectW, rectH, 3);
      break;
    }

    case 'diamond': {
      // 菱形塔 - 竖长菱形（4 顶点）
      const dw = 10, dh = 13;
      approxR = dh;
      ctx.beginPath();
      ctx.moveTo(x, y - dh);
      ctx.lineTo(x + dw, y);
      ctx.lineTo(x, y + dh);
      ctx.lineTo(x - dw, y);
      ctx.closePath();
      break;
    }

    case 'oval': {
      // 椭圆塔 - 横向椭圆
      approxR = 12;
      ctx.beginPath();
      ctx.ellipse(x, y, 13, 8.5, 0, 0, Math.PI * 2);
      break;
    }

    case 'star': {
      // 星形塔 - 六角星（与等级星区分：六芒轮廓 + 六边形基底）
      const r1 = 13, r2 = 6;
      approxR = r1;
      ctx.beginPath();
      for (let i = 0; i < 12; i++) {
        const radius = i % 2 === 0 ? r1 : r2;
        const angle = (Math.PI / 6) * i - Math.PI / 2;
        const sx = x + radius * Math.cos(angle);
        const sy = y + radius * Math.sin(angle);
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.closePath();
      break;
    }

    case 'cross': {
      // 十字塔 - 等臂十字（12 个顶点的凹多边形，绕行一圈闭合）
      const arm = 7, len = 13;
      approxR = len;
      const pts = [
        [-arm, -len], [arm, -len], [arm, -arm], [len, -arm],
        [len, arm], [arm, arm], [arm, len], [-arm, len],
        [-arm, arm], [-len, arm], [-len, -arm], [-arm, -arm],
      ];
      ctx.beginPath();
      pts.forEach((p, i) => {
        const px = x + p[0], py = y + p[1];
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.closePath();
      break;
    }

    case 'arrow': {
      // 箭形塔 - 箭头朝右（与攻击方向一致）：箭尖 + 双翼 + 尾杆
      approxR = 13;
      ctx.beginPath();
      ctx.moveTo(x + 15, y);            // 箭尖
      ctx.lineTo(x + 4, y - 11);        // 上翼
      ctx.lineTo(x + 4, y - 4.5);
      ctx.lineTo(x - 12, y - 4.5);      // 尾杆上沿
      ctx.lineTo(x - 12, y + 4.5);
      ctx.lineTo(x + 4, y + 4.5);
      ctx.lineTo(x + 4, y + 11);        // 下翼
      ctx.closePath();
      break;
    }

    case 'bolt': {
      // 闪电塔 - 双折闪电（上宽下尖，重心偏上）
      approxR = 13;
      ctx.beginPath();
      ctx.moveTo(x + 2, y - 13);
      ctx.lineTo(x - 9, y + 2);
      ctx.lineTo(x - 1, y + 2);
      ctx.lineTo(x - 5, y + 13);
      ctx.lineTo(x + 9, y - 3);
      ctx.lineTo(x + 1, y - 3);
      ctx.closePath();
      break;
    }

    case 'parallel': {
      // 平行塔 - 双横：上下两条等长横杠（"二"字轮廓，两条杠互相平行）。
      // ⚠️ 必须用 ctx.roundRect 逐条追加子路径，**不能用 roundRectPath**
      //    —— 后者内部会 beginPath()，第二次调用会把第一条横杠擦掉，
      //    最后只剩一条杠（这正是"平行塔画成了圆"之外最容易踩的坑）。
      const barW = 22, barH = 7, barGap = 4;
      approxR = 11;
      const barX = x - barW / 2;
      const topY = y - barGap / 2 - barH;
      ctx.beginPath();
      ctx.roundRect(barX, topY, barW, barH, 2.5);
      ctx.roundRect(barX, topY + barH + barGap, barW, barH, 2.5);
      break;
    }

    default: {
      // 未知类型：兜底画圆，避免静默不画
      approxR = 11;
      ctx.beginPath();
      ctx.arc(x, y, 11, 0, Math.PI * 2);
      break;
    }
  }

  applyTowerStyle(ctx, x, y, color, approxR);
  ctx.restore();
  // 返回轮廓的近似半径（各图形自带不同尺寸：三角 13.8 / 正方 10 / 圆 11 …）。
  // 给"需要按轮廓尺寸等比缩放"的调用方一个现成的量：弹道兜底绘制会用它挑缩放比例，
  // probe-aim 也用它守"每种图形都有真实尺寸"（case 忘了设 approxR 会落到默认 12）。
  return approxR;
}

// ========== 文字排版 ==========

/**
 * 文本自动换行（只测量、不绘制）→ 返回行数组。
 * 面板需要"先算高度再画"，所以换行必须与绘制解耦。
 * @param {string} font 测量用字体
 * @returns {string[]} 行数组
 */
function wrapTextLines(ctx, text, maxWidth, font) {
  const lines = [];
  if (!text) return lines;

  ctx.save();
  if (font) ctx.font = font;

  const chars = String(text).split('');
  let line = '';
  for (let i = 0; i < chars.length; i++) {
    const test = line + chars[i];
    if (ctx.measureText(test).width > maxWidth && line !== '') {
      lines.push(line);
      line = chars[i];
    } else {
      line = test;
    }
  }
  if (line !== '') lines.push(line);
  ctx.restore();
  return lines;
}

/** 兼容旧接口：直接绘制换行文本 */
function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const lines = wrapTextLines(ctx, text, maxWidth, ctx.font);
  ctx.save();
  ctx.textBaseline = 'middle';
  lines.forEach((line, i) => ctx.fillText(line, x, y + i * lineHeight));
  ctx.restore();
}

/** 截断文本到指定宽度，超出补省略号（单行竞技场/卡片名称用） */
function ellipsize(ctx, text, maxWidth) {
  const t = String(text || '');
  if (ctx.measureText(t).width <= maxWidth) return t;
  let out = t;
  while (out.length > 1 && ctx.measureText(out + '…').width > maxWidth) {
    out = out.slice(0, -1);
  }
  return out + '…';
}

// ========== 通用控件 ==========

/**
 * 绘制"切割"式分隔线：中间厚、两端渐隐收细（柳叶/透镜形）。
 * 用两段二次贝塞尔闭合：上缘由左端拱到中心最厚处再落到右端，下缘镜像；
 * 横向再叠一层透明度渐变，让两端"切"进背景。
 */
function drawTaperedDivider(ctx, cx, y, width, thickness) {
  const t = (thickness === undefined ? 5 : thickness) / 2;
  const x1 = cx - width / 2;
  const x2 = cx + width / 2;

  ctx.save();
  const grad = ctx.createLinearGradient(x1, 0, x2, 0);
  grad.addColorStop(0, 'rgba(255, 255, 255, 0)');
  grad.addColorStop(0.18, THEME.border.strong);
  grad.addColorStop(0.5, THEME.border.strong);
  grad.addColorStop(0.82, THEME.border.strong);
  grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.quadraticCurveTo(cx, y - t, x2, y);
  ctx.quadraticCurveTo(cx, y + t, x1, y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * 绘制统一风格按钮：圆角 + 柔和纵向渐变 + 主题描边。
 * 支持可选副文案（subLabel），主副文案垂直居中排布。
 * pressed=true 时呈按压态：整体轻微缩小 + 压暗。
 */
function drawButton(ctx, o) {
  const { x, y, w, h } = o;
  const cx = x + w / 2;
  const cy = y + h / 2;

  if (o.pressed) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(0.96, 0.94);
    ctx.translate(-cx, -cy);
  }

  if (o.flat) {
    // 扁平态（卡片/列表行）：只填纯色，不画渐变
    ctx.fillStyle = o.top;
  } else {
    const grad = ctx.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, o.top);
    grad.addColorStop(1, o.bottom);
    ctx.fillStyle = grad;
  }
  ctx.strokeStyle = o.stroke;
  ctx.lineWidth = o.lineWidth || 1.5;
  roundRectPath(ctx, x, y, w, h, o.radius === undefined ? THEME.radius.medium : o.radius);
  ctx.fill();
  ctx.stroke();

  if (o.pressed) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    roundRectPath(ctx, x, y, w, h, o.radius === undefined ? THEME.radius.medium : o.radius);
    ctx.fill();
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (o.disabled) {
    ctx.fillStyle = o.disabledColor || THEME.text.off;
    ctx.font = `bold ${o.fontSize || 16}px Arial`;
    ctx.fillText(o.label, cx, cy);
  } else if (o.subLabel) {
    ctx.fillStyle = o.labelColor;
    ctx.font = `bold ${o.fontSize || 16}px Arial`;
    ctx.fillText(o.label, cx, cy - 9);
    ctx.fillStyle = o.subColor || THEME.text.secondary;
    ctx.font = '12px Arial';
    ctx.fillText(o.subLabel, cx, cy + 11);
  } else {
    ctx.fillStyle = o.labelColor;
    ctx.font = `bold ${o.fontSize || 18}px Arial`;
    ctx.fillText(o.label, cx, cy);
  }

  // 可选：左上角图标（用于广告播放器等标识）
  if (o.icon && !o.disabled) {
    const iconSize = 16;
    const iconX = x + 14;
    const iconY = y + h / 2;
    ctx.save();
    ctx.translate(iconX, iconY);
    // 简单播放器图标：矩形+三角
    ctx.fillStyle = o.labelColor || THEME.text.primary;
    ctx.fillRect(-iconSize/2, -iconSize/2, iconSize, iconSize);
    ctx.fillStyle = o.labelColor || THEME.text.primary;
    ctx.beginPath();
    ctx.moveTo(-iconSize/3, -iconSize/3);
    ctx.lineTo(iconSize/3, 0);
    ctx.lineTo(-iconSize/3, iconSize/3);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // 文字右移避免重叠
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = o.labelColor;
    ctx.font = `bold ${o.fontSize || 16}px Arial`;
    if (o.subLabel) {
      ctx.fillText(o.label, cx, cy - 9);
      ctx.fillStyle = o.subColor || THEME.text.secondary;
      ctx.font = '12px Arial';
      ctx.fillText(o.subLabel, cx, cy + 11);
    } else {
      ctx.fillText(o.label, cx, cy);
    }
  }

  if (o.pressed) ctx.restore();
}

/**
 * 绘制按钮点击波纹（释放瞬间）：从按钮中心扩散的圆角矩形光环，短时间内透明度衰减。
 * game.buttonFx = { x, y, w, h, t0, duration, color, layer }。
 *
 * ⚠️ 两个历史坑（都是"幽灵红框/绿框永久挂在屏幕上"的成因，别改回去）：
 *   ① duration 单位是【毫秒】（flashButton 写死 450）。早期这里误写成
 *      `(now - t0) / (duration * 1000)`，等于把 450ms 当成 450 秒 →
 *      波纹 7.5 分钟不消失，而且每一帧都被绘制层重画，看起来就是个永久框；
 *      只有下一次 flashButton（比如点"更新"）把它替换掉才会"突然消失"。
 *   ② 波纹要按【层】绘制：flashButton 记下发起它的层（'shop' / 'overlay'），
 *      绘制方传同一个 layer 才会画。否则商店层会替菜单/面板的按钮画波纹 —— 
 *      于是战场中间凭空出现一个跟按钮一样大的框。
 * 另外加了 2s 硬上限：万一某层的 fx 没人负责绘制（切场景），也不会永久残留。
 *
 * @param {string} [layer] 绘制层；不传 = 任意层都可绘制（兼容旧调用）
 */
function drawButtonFx(game, ctx, layer) {
  const fx = game.buttonFx;
  if (!fx) return;
  // 归属层不匹配 → 不画也【不清】，交给它自己的层去画/清
  if (layer && fx.layer && fx.layer !== layer) return;

  const now = Date.now();
  const age = now - fx.t0;
  const dur = fx.duration > 0 ? fx.duration : 450;
  const p = age / dur;
  if (p >= 1 || age > 2000) {
    game.buttonFx = null;
    return;
  }

  const cx = fx.x + fx.w / 2;
  const cy = fx.y + fx.h / 2;
  const alpha = 1 - p;
  const grow = 1 + p * 0.25;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(grow, grow);
  ctx.translate(-cx, -cy);

  ctx.strokeStyle = `rgba(${fx.color || '255,255,255'}, ${(alpha * 0.8).toFixed(3)})`;
  ctx.lineWidth = 2 + (1 - p) * 2;
  roundRectPath(ctx, fx.x, fx.y, fx.w, fx.h, THEME.radius.medium);
  ctx.stroke();

  ctx.fillStyle = `rgba(${fx.color || '255,255,255'}, ${(alpha * 0.15).toFixed(3)})`;
  roundRectPath(ctx, fx.x, fx.y, fx.w, fx.h, THEME.radius.medium);
  ctx.fill();

  ctx.restore();
}

/** 按钮按压态查询：game.btnPress = { id, t0 }，按住超过 1.2s 视为误触自动松开。 */
function isButtonPressed(game, id) {
  if (!game.btnPress || game.btnPress.id !== id) return false;
  if (Date.now() - game.btnPress.t0 > 1200) return false;
  return true;
}

/**
 * 绘制小药丸标签（chip）：圆角底 + 可选描边 + 图标字符 + 文本。
 * 导航徽标 / 货币显示 / 状态标记统一用它，避免各界面自造"小圆角块"。
 * @param {object} o { x, y, w, h, text, icon, color, bg, stroke, fontSize, align }
 */
function drawChip(ctx, o) {
  const { x, y, w, h } = o;
  const r = h / 2;

  if (o.bg) {
    ctx.fillStyle = o.bg;
    roundRectPath(ctx, x, y, w, h, r);
    ctx.fill();
  }
  if (o.stroke) {
    ctx.strokeStyle = o.stroke;
    ctx.lineWidth = o.lineWidth || 1;
    roundRectPath(ctx, x, y, w, h, r);
    ctx.stroke();
  }

  const cy = y + h / 2;
  const fs = o.fontSize || 11;
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${fs}px Arial`;

  const label = o.icon ? `${o.icon} ${o.text}` : String(o.text);
  ctx.textAlign = o.align || 'center';
  ctx.fillStyle = o.color || THEME.text.secondary;
  ctx.fillText(label, o.align === 'left' ? x + 8 : (o.align === 'right' ? x + w - 8 : x + w / 2), cy);
}

/**
 * 绘制结算/界面标题药丸：圆角 + 柔和横向渐变 + 强描边，风格与波次标题一致。
 * @param {number} maxW 药丸最大宽度（超出则收敛，保证不越界）
 * @param {number} [fontSize]
 */
function drawPillTitle(ctx, cx, cy, text, top, bottom, maxW, fontSize) {
  const fz = fontSize || 22;
  ctx.font = `bold ${fz}px Arial`;
  const tw = ctx.measureText(text).width || 80;
  const w = Math.min(maxW, tw + 44);
  const h = fz + 20;
  const x = cx - w / 2;
  const y = cy - h / 2;

  const grad = ctx.createLinearGradient(x, 0, x + w, 0);
  grad.addColorStop(0, top);
  grad.addColorStop(1, bottom);
  ctx.fillStyle = grad;
  ctx.strokeStyle = THEME.border.strong;
  ctx.lineWidth = 1;
  roundRectPath(ctx, x, y, w, h, h / 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = THEME.text.primary;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, cy);
}

/** 绘制一枚"锁"图标（未解锁卡片/关卡用） */
function drawLockIcon(ctx, cx, cy, size, color) {
  const w = size, h = size * 0.78;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1.5, size * 0.14);
  // 锁梁
  ctx.beginPath();
  ctx.arc(cx, cy - h * 0.32, w * 0.34, Math.PI, 0);
  ctx.stroke();
  // 锁体
  roundRectPath(ctx, cx - w / 2, cy - h * 0.28, w, h * 0.86, size * 0.14);
  ctx.fill();
  ctx.restore();
}

/** 绘制虚线占位框（"待扩展"用） */
function drawDashedBox(ctx, x, y, w, h, r, color) {
  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = color || THEME.border.subtle;
  ctx.lineWidth = 1;
  roundRectPath(ctx, x, y, w, h, r);
  ctx.stroke();
  ctx.restore();
}

// ============================================================================
// 固有技能图标（技能槽左侧那枚图形）
// ----------------------------------------------------------------------------
// 按技能的**属性键**决定画什么图形（不是按塔型）—— 同一项属性在不同塔上是同一种
// "能力语义"，所以图标一致玩家才认得出：
//   暴击 → 准星 / 爆炸 → 爆裂星芒 / 精英倍率 → 狙击环 / 弹道体积 → 外扩箭头
//   穿透·破解 → 破盾箭 / 光环·射程 → 同心弧 / 扇面张角 → 扇形 / 叠加上限·堆叠 → 层叠横条
//   攻速 → 速度线 / 生命 → 盾
// 全部矢量绘制，不依赖 emoji 字体。
// ============================================================================
const SKILL_GLYPH = {
  critChance: 'crosshair',
  critMult: 'crosshair',
  critDamage: 'crosshair',
  explosionDamage: 'burst',
  explosionRadius: 'burst',
  eliteMult: 'scope',
  projectileScale: 'expand',
  penetration: 'pierce',
  break: 'pierce',
  auraPower: 'aura',
  auraPenetration: 'aura',
  auraCritChance: 'aura',
  auraCritDamage: 'aura',
  range: 'aura',
  stunChance: 'burst',
  sectorAngle: 'sector',
  stackMax: 'stack',
  innateStackCap: 'stack',
  attackSpeedMultiplier: 'swift',
  hp: 'shield',
};

/** 技能图标：按属性键取图形；未知键退回通用"星芒"（绝不静默不画） */
function drawSkillIcon(ctx, cx, cy, r, key, color) {
  const glyph = SKILL_GLYPH[key] || 'star';
  const c = color || THEME.accent.violet;
  const R = Math.max(4, r);
  ctx.save();
  ctx.strokeStyle = c;
  ctx.fillStyle = c;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1.2, R * 0.22);

  switch (glyph) {
    case 'crosshair': {
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.72, 0, Math.PI * 2);
      ctx.stroke();
      for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        ctx.beginPath();
        ctx.moveTo(cx + d[0] * R * 0.72, cy + d[1] * R * 0.72);
        ctx.lineTo(cx + d[0] * R * 1.15, cy + d[1] * R * 1.15);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.2, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'burst': {
      const spikes = 8;
      ctx.beginPath();
      for (let i = 0; i < spikes * 2; i++) {
        const rad = (i % 2 === 0) ? R : R * 0.42;
        const a = (Math.PI / spikes) * i - Math.PI / 2;
        const px = cx + rad * Math.cos(a), py = cy + rad * Math.sin(a);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'scope': {
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.86, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - R * 1.1, cy); ctx.lineTo(cx - R * 0.4, cy);
      ctx.moveTo(cx + R * 0.4, cy); ctx.lineTo(cx + R * 1.1, cy);
      ctx.moveTo(cx, cy - R * 1.1); ctx.lineTo(cx, cy - R * 0.4);
      ctx.moveTo(cx, cy + R * 0.4); ctx.lineTo(cx, cy + R * 1.1);
      ctx.stroke();
      break;
    }
    case 'expand': {
      // 上下两条向外的箭头 + 中间一竖：弹道体积/命中范围变大
      for (const s of [1, -1]) {
        const tipY = cy + s * R * 1.05;
        const baseY = cy + s * R * 0.55;
        ctx.beginPath();
        ctx.moveTo(cx, tipY);
        ctx.lineTo(cx + R * 0.5, baseY);
        ctx.lineTo(cx - R * 0.5, baseY);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(cx - R * 0.9, baseY);
        ctx.lineTo(cx + R * 0.9, baseY);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(cx, cy - R * 0.5);
      ctx.lineTo(cx, cy + R * 0.5);
      ctx.stroke();
      break;
    }
    case 'pierce': {
      // 箭穿过一条盾线
      ctx.beginPath();
      ctx.moveTo(cx - R * 1.1, cy + R * 0.75);
      ctx.lineTo(cx + R * 1.1, cy - R * 0.75);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx + R * 0.5, cy - R * 0.95);
      ctx.lineTo(cx + R * 1.15, cy - R * 0.8);
      ctx.lineTo(cx + R * 0.75, cy - R * 0.28);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx + R * 0.35, cy - R * 1.05);
      ctx.lineTo(cx + R * 0.35, cy + R * 1.05);
      ctx.stroke();
      break;
    }
    case 'aura': {
      for (let i = 1; i <= 3; i++) {
        ctx.beginPath();
        ctx.arc(cx, cy, R * 0.32 * i, Math.PI * 0.15, Math.PI * 0.85);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, R * 0.32 * i, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.16, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'sector': {
      ctx.beginPath();
      ctx.moveTo(cx, cy + R * 0.9);
      ctx.lineTo(cx - R * 0.95, cy - R * 0.7);
      ctx.lineTo(cx + R * 0.95, cy - R * 0.7);
      ctx.closePath();
      ctx.globalAlpha = 0.35;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.stroke();
      break;
    }
    case 'stack': {
      for (let i = 0; i < 3; i++) {
        const y = cy - R * 0.7 + i * R * 0.7;
        const w = R * (1.9 - i * 0.35);
        roundRectPath(ctx, cx - w / 2, y - R * 0.16, w, R * 0.32, R * 0.16);
        ctx.fill();
      }
      break;
    }
    case 'swift': {
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(cx - R * 0.9, cy + i * R * 0.6);
        ctx.lineTo(cx + R * 0.45, cy + i * R * 0.6);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx + R * 0.2, cy + i * R * 0.6 - R * 0.3);
        ctx.lineTo(cx + R * 0.85, cy + i * R * 0.6);
        ctx.lineTo(cx + R * 0.2, cy + i * R * 0.6 + R * 0.3);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case 'shield': {
      ctx.beginPath();
      ctx.moveTo(cx, cy - R);
      ctx.lineTo(cx + R * 0.85, cy - R * 0.55);
      ctx.lineTo(cx + R * 0.7, cy + R * 0.5);
      ctx.lineTo(cx, cy + R);
      ctx.lineTo(cx - R * 0.7, cy + R * 0.5);
      ctx.lineTo(cx - R * 0.85, cy - R * 0.55);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx, cy - R * 0.45);
      ctx.lineTo(cx, cy + R * 0.45);
      ctx.stroke();
      break;
    }
    default: {
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const rad = (i % 2 === 0) ? R : R * 0.34;
        const a = (Math.PI / 4) * i - Math.PI / 2;
        const px = cx + rad * Math.cos(a), py = cy + rad * Math.sin(a);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
  }
  ctx.restore();
}

/**
 * 绘制竖直滚动条（细条，靠轨道右侧）——把"这里能上下滑"变成看得见的东西。
 * 不需要滚动（maxScroll <= 0）时什么都不画。
 * @param {object} track 视口矩形 {x,y,w,h}
 * @param {number} scroll 当前滚动量
 * @param {number} maxScroll 最大滚动量
 * @param {number} viewportH 视口高（= track.h，显式传入便于调用方自查）
 * @param {number} contentH 内容总高
 */
function drawScrollBar(ctx, track, scroll, maxScroll, viewportH, contentH) {
  if (!(maxScroll > 0) || !(contentH > 0) || !(viewportH > 0)) return;
  const w = 3;
  const x = track.x + track.w - w - 2;
  const ratio = Math.max(0.08, Math.min(1, viewportH / contentH));
  const thumbH = Math.max(20, track.h * ratio);
  const travel = track.h - thumbH;
  const t = Math.max(0, Math.min(1, scroll / maxScroll));

  ctx.save();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.10)';
  roundRectPath(ctx, x, track.y, w, track.h, w / 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.42)';
  roundRectPath(ctx, x, track.y + travel * t, w, thumbH, w / 2);
  ctx.fill();
  ctx.restore();
}

/**
 * 上下渐隐 + 呼吸箭头：暗示"还能继续滑"。
 * @param {string} [bg] 渐隐用的底色（默认页面底色）
 * @param {string} [accent] 箭头颜色
 */
function drawScrollHint(ctx, viewport, scroll, maxScroll, bg, accent) {
  if (!(maxScroll > 0)) return;
  const fadeH = 16;
  const t = Date.now() / 700;
  const blink = 0.35 + 0.35 * Math.abs(Math.sin(t));
  const base = bg || THEME.surface.page;

  ctx.save();
  if (scroll > 2) {
    const g1 = ctx.createLinearGradient(0, viewport.y, 0, viewport.y + fadeH);
    g1.addColorStop(0, base);
    g1.addColorStop(1, 'rgba(26, 26, 46, 0)');
    ctx.fillStyle = g1;
    ctx.fillRect(viewport.x, viewport.y, viewport.w, fadeH);
    ctx.globalAlpha = blink;
    drawChevron(ctx, viewport.x + viewport.w / 2, viewport.y + 7, -1, accent || THEME.accent.cyan);
    ctx.globalAlpha = 1;
  }
  if (scroll < maxScroll - 2) {
    const g2 = ctx.createLinearGradient(0, viewport.y + viewport.h - fadeH, 0, viewport.y + viewport.h);
    g2.addColorStop(0, 'rgba(26, 26, 46, 0)');
    g2.addColorStop(1, base);
    ctx.fillStyle = g2;
    ctx.fillRect(viewport.x, viewport.y + viewport.h - fadeH, viewport.w, fadeH);
    ctx.globalAlpha = blink;
    drawChevron(ctx, viewport.x + viewport.w / 2, viewport.y + viewport.h - 7, 1, accent || THEME.accent.cyan);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

/** 小箭头（滚动提示用） */
function drawChevron(ctx, cx, cy, dir, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - 5, cy + dir * 2.5);
  ctx.lineTo(cx, cy - dir * 2.5);
  ctx.lineTo(cx + 5, cy + dir * 2.5);
  ctx.stroke();
  ctx.restore();
}

module.exports = {
  THEME,
  TOAST,
  pushToast,
  TOWER_SHAPES,
  shade,
  teamBandGradient,
  easeOutCubic,
  easeOutBack,
  roundRectPath,
  polyfillRoundRect,
  polyfillCanvas2D,
  pointInRect,
  drawStar,
  applyTowerStyle,
  drawTowerIcon,
  wrapTextLines,
  wrapText,
  ellipsize,
  drawTaperedDivider,
  drawButton,
  drawButtonFx,
  isButtonPressed,
  drawChip,
  drawPillTitle,
  drawLockIcon,
  drawDashedBox,
  SKILL_GLYPH,
  drawSkillIcon,
  drawScrollBar,
  drawScrollHint,
  drawChevron,
};
