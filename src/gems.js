// ============================================================================
// 宝石系统 —— src/gems.js
// ----------------------------------------------------------------------------
// 单一真源：宝石的种类 / 数值 / 图标 / 加成汇总都在这里，其他模块一律来取，
// 不允许各自硬编码（战斗侧 tower.js 取加成，图签与背包取图标与文案）。
//
// 三件事：
//   ① 查表：GEM_DEFS（由 config.GEM_KINDS 生成）
//   ② 汇总：bonusForType(type) —— 把某塔型"已嵌入"的宝石加成加总成一份数值，
//      战斗（tower.js 运行时属性）与 UI（bonusStats 明细）共用同一份口径
//   ③ 绘制：drawGemIcon() —— 纯矢量切面宝石，不依赖 emoji 字体
//
// 绑定关系（需求原话"嵌入宝石后被嵌入的宝石与技能绑定"）：
//   宝石嵌进某个图形塔的槽 → 与该塔的【固有技能】绑定 → 从背包消失 →
//   加成按塔型永久生效（跨局，写进 meta.socketed）。
//   effect.skillPercent 这一项更是直接作用于固有技能那项属性本身。
// ============================================================================

const { GEM, GEM_KINDS, ENHANCE_SPECIAL, TOWER_DEFS } = require('./config');
const meta = require('./meta');

const GEM_DEFS = {};
const GEM_ORDER = [];
for (const def of GEM_KINDS) {
  GEM_DEFS[def.id] = def;
  GEM_ORDER.push(def.id);
}

/** 宝石定义（未知 id 返回 null） */
function gemDef(kind) {
  return GEM_DEFS[kind] || null;
}

/** 宝石展示文案（基础值，即 Lv.1 的效果），如「攻击力 +8%」 */
function effectText(kind) {
  const def = gemDef(kind);
  return def ? def.desc : '';
}

/** 宝石名字带上等级（需求：宝石名字那边要写上宝石的 lv 等级），如「红宝石 Lv.2」 */
function gemName(kind, lv) {
  const def = gemDef(kind);
  const base = def ? def.name : String(kind || '');
  return `${base} Lv.${Math.max(1, Math.floor(lv || 1))}`;
}

/**
 * 宝石在指定等级下的效果数值（效果随等级线性放大：Lv.N = 基础值 × N）。
 * 合成产物 +1 级 → 加成翻倍一档，这是"合成值得做"的数值根基。
 */
function effectAt(kind, lv) {
  const def = gemDef(kind);
  if (!def) return {};
  const mult = Math.max(1, Math.floor(lv || 1));
  const e = def.effect || {};
  const out = {};
  for (const k of Object.keys(e)) out[k] = e[k] * mult;
  return out;
}

/** 宝石在指定等级下的效果文案，如 红宝石 Lv.2 → 「攻击力 +16%」 */
function effectTextAt(kind, lv) {
  const def = gemDef(kind);
  if (!def) return '';
  const e = effectAt(kind, lv);
  const parts = [];
  if (e.damagePercent) parts.push(`攻击力 +${e.damagePercent}%`);
  if (e.attackSpeedMultiplier) parts.push(`攻速 +${e.attackSpeedMultiplier}`);
  if (e.critChance) parts.push(`暴击率 +${e.critChance}%`);
  if (e.penetration) parts.push(`穿透 +${e.penetration}`);
  if (e.range) parts.push(`射程 +${e.range}`);
  if (e.skillLevels) parts.push(`固有技能 +${e.skillLevels} 级`);
  return parts.length ? parts.join(' · ') : def.desc;
}

/** 宝石颜色（未知 id 用中性灰，绝不返回 undefined —— 画布会把它变成"透明"） */
function gemColor(kind) {
  const def = gemDef(kind);
  return def ? def.color : '#90A4AE';
}

/** 该塔型固有技能的名字（宝石绑定的对象；无技能返回空串） */
function skillNameOf(type) {
  const sp = type ? ENHANCE_SPECIAL[type] : null;
  return sp ? sp.name : '';
}

/**
 * 某塔型已嵌入宝石的加成汇总（纯函数，全项目唯一口径）。
 * 效果按宝石等级线性放大：Lv.N 的宝石提供 N 倍基础加成（合成产物的意义所在）。
 *
 * @param {string} type 塔类型
 * @returns {{
 *   count:number, kinds:string[],
 *   damagePercent:number, attackSpeedMultiplier:number, critChance:number,
 *   penetration:number, range:number, skillLevels:number
 * }}
 */
function bonusForType(type) {
  const out = {
    count: 0,
    kinds: [],
    damagePercent: 0,
    attackSpeedMultiplier: 0,
    critChance: 0,
    penetration: 0,
    range: 0,
    skillLevels: 0,
  };
  if (!type || !TOWER_DEFS[type]) return out;

  for (const entry of meta.embeddedEntries(type)) {
    const def = gemDef(entry.kind);
    if (!def) continue;
    const e = effectAt(entry.kind, entry.lv);
    out.count++;
    out.kinds.push(entry.kind);
    out.damagePercent += e.damagePercent || 0;
    out.attackSpeedMultiplier += e.attackSpeedMultiplier || 0;
    out.critChance += e.critChance || 0;
    out.penetration += e.penetration || 0;
    out.range += e.range || 0;
    out.skillLevels += e.skillLevels || 0;
  }
  return out;
}

/** 攻击力乘数（1 + Σ damagePercent/100） */
function damageMultiplier(type) {
  return 1 + bonusForType(type).damagePercent / 100;
}

/**
 * 固有技能等级加成（宝石与技能绑定的落地点）。
 * 唯一消费方：tower.getEnhanceAttr —— 于是战斗、属性面板、强化浮层三处自动同口径。
 */
function skillLevels(type) {
  return bonusForType(type).skillLevels;
}

/** 指定槽位的宝石种类（空槽/锁槽返回 null） */
function gemAt(type, index) {
  const sockets = meta.gemSockets(type);
  const s = sockets[index];
  return (s && s.kind) ? s.kind : null;
}

/**
 * 某塔型已嵌入的宝石种类（按槽位顺序，忽略空槽）。
 * 转发 meta 的实现：UI 层只 import 一个 gems 就够了。
 */
function embeddedGems(type) {
  return meta.embeddedGems(type);
}

/** 某塔型已嵌入的宝石条目 [{kind, lv}]（需要显示/计算等级的场合用这个） */
function embeddedEntries(type) {
  return meta.embeddedEntries(type);
}

/** 背包里每种宝石各有多少颗 —— 汇总成 { kind: 数量 }（旧版按种类聚合计数） */
function bagCounts() {
  const counts = {};
  for (const g of meta.gemList()) counts[g.kind] = (counts[g.kind] || 0) + 1;
  return counts;
}

/** 随机一种宝石（掉落用；种类表为空时返回 null） */
function randomKind() {
  if (!GEM_ORDER.length) return null;
  return GEM_ORDER[Math.floor(Math.random() * GEM_ORDER.length)];
}

/** 掉落文案，如「获得宝石 · 红宝石 Lv.1（攻击力 +8%）」 */
function dropText(kind, lv) {
  const def = gemDef(kind);
  return def ? `获得宝石 · ${gemName(kind, lv)}（${def.desc}）` : '获得宝石';
}

// ==================== 绘制 ====================

/**
 * 矢量切面宝石图标。
 *
 * 造型：6 角"钻石切割"轮廓（上尖 → 两侧腰 → 下尖），外加两条腰线与一条中横线
 * 表达切面；内部叠一层高光。全部走路径绘制，任何设备都稳定出图形（不依赖 emoji）。
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx 中心 x
 * @param {number} cy 中心 y
 * @param {number} r  半高（同时决定宽度：宽 ≈ 1.7r）
 * @param {string} kind 宝石种类
 * @param {object} [opts] { dim: 变暗（未解锁/空槽处使用）, alpha }
 */
function drawGemIcon(ctx, cx, cy, r, kind, opts) {
  const o = opts || {};
  const def = gemDef(kind);
  const color = def ? def.color : '#90A4AE';
  const dim = !!o.dim;
  const size = Math.max(4, r);

  const top    = [cx, cy - size];
  const upR    = [cx + size * 0.72, cy - size * 0.3];
  const lowR   = [cx + size * 0.5, cy + size * 0.78];
  const bottom = [cx, cy + size];
  const lowL   = [cx - size * 0.5, cy + size * 0.78];
  const upL    = [cx - size * 0.72, cy - size * 0.3];

  ctx.save();
  if (o.alpha !== undefined) ctx.globalAlpha = o.alpha;

  // 轮廓
  ctx.beginPath();
  ctx.moveTo(top[0], top[1]);
  ctx.lineTo(upR[0], upR[1]);
  ctx.lineTo(lowR[0], lowR[1]);
  ctx.lineTo(bottom[0], bottom[1]);
  ctx.lineTo(lowL[0], lowL[1]);
  ctx.lineTo(upL[0], upL[1]);
  ctx.closePath();

  if (typeof ctx.createLinearGradient === 'function') {
    const g = ctx.createLinearGradient(cx - size, cy - size, cx + size, cy + size);
    g.addColorStop(0, shadeColor(color, 0.45, dim ? 0.55 : 0.98));
    g.addColorStop(1, shadeColor(color, -0.35, dim ? 0.45 : 0.92));
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = color;
  }
  ctx.fill();

  ctx.strokeStyle = dim ? 'rgba(255,255,255,0.22)' : shadeColor(color, -0.5, 0.95);
  ctx.lineWidth = Math.max(1, size * 0.1);
  ctx.stroke();

  // 切面：腰线（左上/右上 → 底尖）+ 中横线
  ctx.beginPath();
  ctx.moveTo(upL[0], upL[1]);
  ctx.lineTo(cx, cy - size * 0.28);
  ctx.lineTo(upR[0], upR[1]);
  ctx.moveTo(cx, cy - size * 0.28);
  ctx.lineTo(bottom[0], bottom[1]);
  ctx.moveTo(upL[0], upL[1]);
  ctx.lineTo(upR[0], upR[1]);
  ctx.strokeStyle = dim ? 'rgba(255,255,255,0.14)' : shadeColor(color, 0.75, 0.55);
  ctx.lineWidth = Math.max(0.8, size * 0.075);
  ctx.stroke();

  // 左上高光小三角（体积感）
  ctx.beginPath();
  ctx.moveTo(top[0], top[1]);
  ctx.lineTo(upL[0], upL[1]);
  ctx.lineTo(cx, cy - size * 0.28);
  ctx.closePath();
  ctx.fillStyle = dim ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.30)';
  ctx.fill();

  ctx.restore();
}

/** 颜色明暗微调（局部实现，避免 gems.js → theme.js → ... 的额外依赖） */
function shadeColor(hex, amount, alpha) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (amount > 0) {
    r = Math.round(r + (255 - r) * amount);
    g = Math.round(g + (255 - g) * amount);
    b = Math.round(b + (255 - b) * amount);
  } else if (amount < 0) {
    const k = 1 + amount;
    r = Math.round(r * k); g = Math.round(g * k); b = Math.round(b * k);
  }
  const a = (alpha === undefined) ? 1 : Math.max(0, Math.min(1, alpha));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** 空槽占位（虚线圆角方框 + 中间一个小菱形凹槽） */
function drawEmptySocket(ctx, x, y, w, h, color) {
  const r = Math.min(6, w * 0.22);
  ctx.save();
  if (typeof ctx.setLineDash === 'function') ctx.setLineDash([4, 3]);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
  ctx.stroke();
  if (typeof ctx.setLineDash === 'function') ctx.setLineDash([]);

  // 中间小菱形（"这里可以嵌一颗宝石"）
  const cx = x + w / 2, cy = y + h / 2, s = Math.min(w, h) * 0.18;
  ctx.beginPath();
  ctx.moveTo(cx, cy - s);
  ctx.lineTo(cx + s, cy);
  ctx.lineTo(cx, cy + s);
  ctx.lineTo(cx - s, cy);
  ctx.closePath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

module.exports = {
  GEM,
  GEM_DEFS,
  GEM_ORDER,
  gemDef,
  effectText,
  effectTextAt,
  effectAt,
  gemName,
  gemColor,
  skillNameOf,
  bonusForType,
  damageMultiplier,
  skillLevels,
  gemAt,
  embeddedGems,
  embeddedEntries,
  bagCounts,
  randomKind,
  dropText,
  drawGemIcon,
  drawEmptySocket,
  shadeColor,
};
