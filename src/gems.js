// ============================================================================
// 宝石系统 —— src/gems.js
// ----------------------------------------------------------------------------
// 宝石 = 【家族（加什么）】×【等级（加多少）】。表在 src/config.js（GEM_FAMILIES），
// 本文件负责"按 lv 取数值 / 汇总 / 画图标"，其他模块一律来取，不许各自硬编码
// （战斗侧 tower.js 取加成，图签与背包取图标与文案）。
//
// 四件事：
//   ① 查表：GEM_DEFS（= config.GEM_KINDS，6 个家族的 Lv.1 视图）
//   ② 等级：levelOf / effectAt / effectTextAt / gemName / gemDisplay / gemColor
//      —— **等级的唯一真源 = 实例上的 lv**；旧 kind（fire_ruby …）走 config.GEM_ALIAS 折算，
//         所以 Lv.1 与 Lv.5 的红宝石打出来的伤害真的不一样
//   ③ 汇总：bonusForType(type) —— 把某塔型"已嵌入"的宝石加成加总成一份数值，
//      战斗（tower.js 运行时属性）与 UI（bonusStats 明细）共用同一份口径
//   ④ 绘制：drawGemIcon() —— 纯矢量切面宝石，不依赖 emoji 字体
//
// 绑定关系（需求原话"嵌入宝石后被嵌入的宝石与技能绑定"）：
//   宝石嵌进某个图形塔的槽 → 与该塔的【固有技能】绑定 → 从背包消失 →
//   加成按塔型永久生效（跨局，写进 meta.socketed）。
//   effect.skillLevels 这一项更是直接给固有技能加等级（见 skills.gemLevels）。
//
// ⚠️ 依赖方向：
//   · gems **不许** require skills（会成环：skills → gems）。
//     需要技能名/技能表的地方，调用方直接 require('./skills')。
//   · gems 依赖 config + meta，所以 **meta 不许 require gems**（会成环）——
//     凡是 meta 也要用的法则（等级夹取 / 效果 / 颜色 / 名字 / 合成产物）都写在 config，
//     本文件只做"查 lv + 汇总 + 画"。别为了省事在 meta 里再写一份。
// ============================================================================

const config = require('./config');
const {
  GEM, GEM_KINDS, GEM_FAMILIES, GEM_LEVELS, TOWER_DEFS, MAX_STAGE,
  clampGemLevel, gemEffectAt, gemDescAt, gemLevelColor, gemLevelName, resolveGem,
} = config;
const meta = require('./meta');

const GEM_DEFS = {};
const GEM_ORDER = [];
for (const def of GEM_KINDS) {
  GEM_DEFS[def.id] = def;
  GEM_ORDER.push(def.id);
}
// 等级相关字段也挂到定义上（UI 想做"这一族五级长什么样"直接用，不必再查 config）
for (const f of GEM_FAMILIES) {
  if (GEM_DEFS[f.id]) Object.assign(GEM_DEFS[f.id], { attr: f.attr, base: f.base, step: f.step, names: f.names });
}

/**
 * 宝石定义（未知 id 返回 null）。
 * 旧 kind（fire_ruby / void_opal …）折算到对应家族定义 —— 老档查表不会查空。
 * ⚠️ 返回的是**该家族 Lv.1** 的 name/color/effect；要某个等级的数据请用
 *    gemName / gemColor / effectAt（它们才吃 lv）。
 */
function gemDef(kind) {
  if (GEM_DEFS[kind]) return GEM_DEFS[kind];
  const r = resolveGem(kind, 1);
  return r ? (GEM_DEFS[r.id] || null) : null;
}

/** 是不是合法宝石 id（含旧 kind） */
function isGemKind(kind) {
  return !!resolveGem(kind, 1);
}

/** 家族 id（旧 kind → 家族；未知 → null） */
function familyOf(kind) {
  const r = resolveGem(kind, 1);
  return r ? r.id : null;
}

/** {kind, lv} → 规范 {kind: 家族, lv: 等级}；未知返回 null（调用方据此剔除坏档） */
function normalize(kind, lv) {
  const r = resolveGem(kind, lv);
  return r ? { kind: r.id, lv: r.lv } : null;
}

/** 宝石等级（夹进 [1, GEM_LEVELS]；旧 kind 自带的等级信息也算） */
function levelOf(kind, lv) {
  const r = resolveGem(kind, lv);
  return r ? r.lv : 1;
}

/**
 * 宝石在指定等级下的效果数值。
 * = 家族 base + step × (等级 − 1) —— 等级**真的**放大效果（法则唯一实现在 config.gemEffectAt）。
 * 历史事故：这里曾收下 lv 却整份返回 def.effect，于是 Lv.1 与 Lv.5 完全一样。
 */
function effectAt(kind, lv) {
  const r = resolveGem(kind, lv);
  return r ? gemEffectAt(r.id, r.lv) : {};
}

/** 宝石在指定等级下的效果文案，如「攻击力 +24%」 */
function effectTextAt(kind, lv) {
  const r = resolveGem(kind, lv);
  return r ? gemDescAt(r.id, r.lv) : '';
}

/** 宝石 Lv.1 的基础效果文案（老接口，= effectTextAt(kind, 1)） */
function effectText(kind) {
  return effectTextAt(kind, 1);
}

/** 宝石全名（一定带等级后缀），如「熔岩红宝石 Lv.3」—— 列表 / 浮层 / 掉落提示用 */
function gemName(kind, lv) {
  const r = resolveGem(kind, lv);
  if (!r) return String(kind || '');
  return `${gemLevelName(r.id, r.lv)} Lv.${r.lv}`;
}

/** 宝石短名（Lv.1 不带后缀，Lv.2+ 带）—— 面板明细这类"一行要塞下名字"的地方用 */
function gemDisplay(kind, lv) {
  const r = resolveGem(kind, lv);
  if (!r) return String(kind || '');
  return r.lv > 1 ? `${gemLevelName(r.id, r.lv)} Lv.${r.lv}` : gemLevelName(r.id, r.lv);
}

/** 某家族的完整等级阶梯（名字 / 颜色 / 效果 / 文案），Lv.1 → Lv.GEM_LEVELS */
function levelLadder(kind) {
  const id = familyOf(kind);
  if (!id) return [];
  const out = [];
  for (let lv = 1; lv <= GEM_LEVELS; lv++) {
    out.push({
      lv: lv,
      name: gemLevelName(id, lv),
      color: gemLevelColor(id, lv),
      effect: gemEffectAt(id, lv),
      desc: gemDescAt(id, lv),
    });
  }
  return out;
}

/**
 * 详情浮层用的"等级说明"整句：当前等级 + 合成后的下一级（满级时说满级）。
 * 文案放这里而不是 UI 里拼 —— 等级规则一变，所有展示处自动跟着变。
 */
function levelLine(kind, lv) {
  const r = resolveGem(kind, lv);
  if (!r) return '';
  if (r.lv >= GEM_LEVELS) return `宝石等级 Lv.${r.lv}/${GEM_LEVELS}（已满级）`;
  return `宝石等级 Lv.${r.lv}/${GEM_LEVELS} · 合成 → ${gemLevelName(r.id, r.lv + 1)}（${gemDescAt(r.id, r.lv + 1)}）`;
}

/** 宝石颜色（随等级加深；未知 id 用中性灰，绝不返回 undefined —— 画布会把它变成"透明"） */
function gemColor(kind, lv) {
  const r = resolveGem(kind, lv);
  return r ? gemLevelColor(r.id, r.lv) : '#90A4AE';
}

/**
 * 某塔型已嵌入宝石的加成汇总（纯函数，全项目唯一口径）。
 * 效果按【宝石等级】放大：family.base + step × (等级 − 1)，见 config.gemEffectAt。
 *
 * @param {string} type 塔类型
 * @returns {{
 *   count:number, kinds:string[], entries:Array<{kind:string,lv:number}>,
 *   damagePercent:number, attackSpeedMultiplier:number, critChance:number,
 *   penetration:number, range:number, skillLevels:number,
 *   skillEffectPercent:number, critDamagePercent:number, break:number
 * }}
 */
function bonusForType(type) {
  const out = {
    count: 0,
    kinds: [],
    entries: [],
    damagePercent: 0,
    attackSpeedMultiplier: 0,
    critChance: 0,
    penetration: 0,
    range: 0,
    skillLevels: 0,
    skillEffectPercent: 0,
    critDamagePercent: 0,
    break: 0,
  };
  if (!type || !TOWER_DEFS[type]) return out;

  for (const entry of meta.embeddedEntries(type)) {
    const def = gemDef(entry.kind);
    if (!def) continue;
    const e = effectAt(entry.kind, entry.lv);
    out.count++;
    out.kinds.push(entry.kind);
    // 带等级的那一份：面板明细要写「熔岩红宝石 Lv.3」，光有 kinds 是拼不出名字的
    out.entries.push({ kind: entry.kind, lv: levelOf(entry.kind, entry.lv) });
    out.damagePercent += e.damagePercent || 0;
    out.attackSpeedMultiplier += e.attackSpeedMultiplier || 0;
    out.critChance += e.critChance || 0;
    out.penetration += e.penetration || 0;
    out.range += e.range || 0;
    out.skillLevels += e.skillLevels || 0;
    out.skillEffectPercent += e.skillEffectPercent || 0;
    out.critDamagePercent += e.critDamagePercent || 0;
    out.break += e.break || 0;
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

/** 某塔型已嵌入的 topaz_break 最高等级（用于 debuff tier，0 = 无） */
function breakTier(type) {
  let tier = 0;
  for (const entry of meta.embeddedEntries(type)) {
    if (entry.kind === 'topaz_break') {
      const lv = levelOf(entry.kind, entry.lv);
      if (lv > tier) tier = lv;
    }
  }
  return tier;
}

/** 随机一种宝石（掉落/奖励用，永远是各家族 Lv.1 基础宝石；表为空时返回 null） */
function randomKind() {
  if (!GEM_ORDER.length) return null;
  return GEM_ORDER[Math.floor(Math.random() * GEM_ORDER.length)];
}

// ==================== 商店出现概率加权（功能性宝石专用）====================
// 这两族宝石（shop_pull_up / shop_pull_down）不改任何战斗/面板数值，
// 只通过"出货池抽取权重"影响该塔型在商店刷新时出现的几率。
//   · 基础权重 = 100（每个塔型平等）
//   · shop_pull_up   嵌了 → 权重 +3（永久，只看是否嵌入，不看星级）
//   · shop_pull_down 嵌了且达到 3★ → 权重 -3（星级未到 3★ 时完全不生效）
// 星级判定走 meta.getStage(type)（持久化的最佳星级，与战斗 setStage 同源）。
// ⚠️ 每塔型各自算自己的权重：遍历"该塔型已嵌入的宝石"——所以加成**只作用嵌入了
//    该宝石的特定塔型**，其他塔型权重恒为 100，绝不被波及（需求硬要求）。
const SHOP_PULL_BASE = 100;

/** 夹取星级到 [0, MAX_STAGE]（不依赖 stage 模块，避免 gems 多引一层） */
function clampShopStage(stage) {
  const n = Number(stage);
  if (!isFinite(n) || n <= 0) return 0;
  return Math.min(MAX_STAGE, Math.floor(n));
}

/**
 * 该塔型因嵌入宝石获得的"商店出现概率权重加成"（单位 = 权重点数，+3 / -3）。
 * 只统计**该塔型**已嵌入的宝石（meta.embeddedEntries(type)），其他塔型一律返回 0。
 * @param {string} type 塔类型
 * @param {number} [stage] 该类型当前星级（持久化最佳星级；缺省当 0★）
 * @returns {number} 权重增量（如 +3 / 0 / -3）
 */
function shopPullPP(type, stage) {
  if (!type || !TOWER_DEFS[type]) return 0;
  const st = clampShopStage(stage);
  let pp = 0;
  for (const entry of meta.embeddedEntries(type)) {
    const def = gemDef(entry.kind);
    if (!def) continue;
    const e = effectAt(entry.kind, entry.lv);
    if (e.shopPullUp) pp += e.shopPullUp;                       // 祈愿宝石：无条件 +3
    if (e.shopPullDown && st >= MAX_STAGE) pp -= e.shopPullDown; // 镇守宝石：仅 3★ 时 -3
  }
  return pp;
}

/**
 * 该塔型在商店出货池里的抽取权重（基础 100 + 宝石加成）。
 * 出货池加权抽样（src/game_core.js 的 rollShopOffers）直接吃这个权重。
 * @param {string} type 塔类型
 * @param {number} [stage] 该类型当前星级
 * @returns {number} 权重（≥1）
 */
function shopWeight(type, stage) {
  return Math.max(1, SHOP_PULL_BASE + shopPullPP(type, stage));
}

/** 掉落文案，如「获得宝石 · 熔岩红宝石 Lv.3（攻击力 +24%）」 */
function dropText(kind, lv) {
  return isGemKind(kind) ? `获得宝石 · ${gemName(kind, lv)}（${effectTextAt(kind, lv)}）` : '获得宝石';
}

// ==================== 合成（法则在 config，本文件只做转发 + 判定）====================
// 规则：minCount 颗【同级】宝石起，基础成功率 baseRate%，每多 1 颗 +perExtra%（封顶 maxRate%）；
//       成功 → 产物家族取自材料范围（随机一种）、等级 = 材料等级 + 1；失败 → 材料照常消耗。
// ⚠️ 数字与产物法则的唯一实现在 src/config.js（gemSynthRate / gemSynthResult）——
//    因为 meta 要执行合成却又不能 require gems（会成环）。别在这里再写一份。
//    （这里曾躺着一份"3 颗同阶、上限 5"的死合成表，和 config.GEM.synth 互相打架。）

/** 合成最少要几颗 */
function synthMinCount() {
  return GEM.synth.minCount;
}

/** 选 count 颗同级宝石的成功率（0~1） */
function synthRate(count) {
  return config.gemSynthRate(count);
}

/** 这族这级的宝石还能不能往上合（到顶不能） */
function canSynth(kind, lv) {
  return !!resolveGem(kind, lv) && levelOf(kind, lv) < GEM_LEVELS;
}

/**
 * 合成产物：家族取自材料范围（随机一种）、等级 = 材料等级 + 1；到顶返回 null。
 * @param {string|string[]} kinds 材料宝石 id（可混族）
 * @param {number} lv 材料等级（同级，由 meta 校验）
 */
function synthResult(kinds, lv) {
  return config.gemSynthResult(kinds, lv);
}

// ==================== 绘制 ====================

/**
 * 矢量切面宝石图标。
 *
 * 造型：6 角"钻石切割"轮廓（上尖 → 两侧腰 → 下尖），外加两条腰线与一条中横线
 * 表达切面；内部叠一层高光。全部走路径绘制，任何设备都稳定出图形（不依赖 emoji）。
 *
 * **等级的表达**（三处同时给，别只靠颜色 —— 色觉障碍 / 小屏都还看得见）：
 *   · 颜色：等级越高越深（config.GEM_LEVEL_LIGHT）
 *   · 描边：等级越高越亮越粗（像"成色更好"）
 *   · 切面：Lv.2 起每级多一条内部弦线（够大的时候才画，小格子里不糊）
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx 中心 x
 * @param {number} cy 中心 y
 * @param {number} r  半高（同时决定宽度：宽 ≈ 1.7r）
 * @param {string} kind 宝石家族 id（旧 kind 也能画）
 * @param {object} [opts] { lv: 宝石等级（决定颜色/描边/切面）, dim: 变暗（未解锁/空槽处使用）, alpha }
 */
function drawGemIcon(ctx, cx, cy, r, kind, opts) {
  const o = opts || {};
  const lv = clampGemLevel(o.lv === undefined ? 1 : o.lv);
  const color = gemColor(kind, lv);
  const dim = !!o.dim;
  const size = Math.max(4, r);
  const t = (lv - 1) / Math.max(1, GEM_LEVELS - 1);   // 0 = Lv.1，1 = 满级

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

  ctx.strokeStyle = dim ? 'rgba(255,255,255,0.22)' : shadeColor(color, 0.15 + 0.5 * t, 0.80 + 0.20 * t);
  ctx.lineWidth = Math.max(1, size * (0.09 + 0.05 * t));
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

  // 等级切面：Lv.2 起每级多一条内部弦线（左右腰之间插值连线；太小就不画，免得糊成一团）
  if (lv > 1 && size >= 9 && !dim) {
    for (let i = 1; i < lv; i++) {
      const f = i / lv;
      const lx = upL[0] + (lowL[0] - upL[0]) * f, ly = upL[1] + (lowL[1] - upL[1]) * f;
      const rx = upR[0] + (lowR[0] - upR[0]) * f, ry = upR[1] + (lowR[1] - upR[1]) * f;
      ctx.moveTo(lx, ly);
      ctx.lineTo(rx, ry);
    }
  }
  ctx.stroke();

  // 左上高光小三角（体积感）
  ctx.beginPath();
  ctx.moveTo(top[0], top[1]);
  ctx.lineTo(upL[0], upL[1]);
  ctx.lineTo(cx, cy - size * 0.28);
  ctx.closePath();
  ctx.fillStyle = dim ? 'rgba(255,255,255,0.05)' : `rgba(255,255,255,${(0.24 + 0.16 * t).toFixed(2)})`;
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
  GEM_LEVELS,
  gemDef,
  isGemKind,
  familyOf,
  normalize,
  levelOf,
  levelLadder,
  levelLine,
  effectText,
  effectTextAt,
  effectAt,
  gemName,
  gemDisplay,
  gemColor,
  bonusForType,
  damageMultiplier,
  skillLevels,
  gemAt,
  embeddedGems,
  embeddedEntries,
  bagCounts,
  breakTier,
  randomKind,
  dropText,
  shopPullPP,
  shopWeight,
  SHOP_PULL_BASE,
  synthMinCount,
  synthRate,
  canSynth,
  synthResult,
  drawGemIcon,
  drawEmptySocket,
  shadeColor,
};
