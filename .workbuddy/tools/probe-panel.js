// ============================================================================
// 属性面板文字越界探针 —— .workbuddy/tools/probe-panel.js
// ----------------------------------------------------------------------------
// 断言（2026-09-17 强化版，对应"属性面板可拖动滚动"这条需求）：
//   ① 横向：每条 fillText 都不许捅出面板裁剪区左右边界；
//   ② 纵向：文字可以落在面板下方，但**必须滚得到** ——
//      即"超出面板底部的最大值 ≤ panelScrollMax"，否则就是"永远看不见的内容"；
//   ③ 面板真的需要滚动时，panelScrollMax 必须 > 0（滚动机制已真的挂上）。
//
// 历史（为什么要有这条）：
//   · 老版本 scrollable 分支里调用的 drawScrollIndicator() 全项目不存在 →
//     矮屏 + 文字多的塔（圆塔/正方塔/平行塔）一画面板就 ReferenceError，
//     主循环 try/catch 吞掉 → 面板整块画不出来，表现成"点了塔没反应"。
//   · arrow 的固有技能说明右超 116px（没换行）。
//
// 两轮：
//   第一轮 = 素面板（无宝石）
//   第二轮 = 嵌满 5 颗宝石（含猫眼石 → 技能槽 Lv 应 > 0）+ 新增的「宝石」区块
// ============================================================================
const path = require('path');
const fs = require('fs');
const { makeCtx, makeRec, gemCards, dividerLines } = require('./harness');

global.document = { addEventListener() {}, removeEventListener() {} };
global.requestAnimationFrame = () => 0;

const ROOT = path.resolve(__dirname, '..', '..');

const out = [];
const log = (s) => out.push(s);

const rec = makeRec();
const ctx = makeCtx(rec);

let Game, renderer, config, meta, gems, towerMod;
try {
  Game = require(path.join(ROOT, 'src', 'game_core'));
  renderer = require(path.join(ROOT, 'src', 'renderer'));
  config = require(path.join(ROOT, 'src', 'config'));
  meta = require(path.join(ROOT, 'src', 'meta'));
  gems = require(path.join(ROOT, 'src', 'gems'));
  towerMod = require(path.join(ROOT, 'src', 'tower'));
} catch (e) {
  fs.writeFileSync(path.join(__dirname, '_panel_error.txt'), (e && e.stack) || String(e), 'utf8');
  process.exit(1);
}

const RES = [
  [320, 568], [360, 640], [375, 667], [375, 812],
  [390, 844], [414, 896], [428, 926],
];
const TYPES = config.TOWER_ORDER;
const GEM_TYPES = ['circle', 'star', 'parallel', 'arrow'];

let fails = 0;
let totalTexts = 0;
// 收集"小数位 > 2"的文本（浮点乘算的尾巴，如 84.00000000000001）—— 最后统一断言
const longDecimals = [];
const ok = (name, cond, detail) => {
  if (!cond) fails++;
  log(`${cond ? '  ok  ' : ' FAIL '} ${name}${detail ? '  → ' + detail : ''}`);
};

function mkGame(W, H) {
  const canvas = { width: W, height: H, addEventListener() {}, removeEventListener() {}, getContext() { return ctx; } };
  return new Game(canvas, ctx, { screenWidth: W, screenHeight: H, renderScale: 1 });
}

/** 给指定塔型解锁到图签满级，并把槽位塞满宝石（幂等） */
function prepGems(types) {
  const m = meta.get();
  m.points = 999999;
  m.bagSlots = config.GEM.bagMaxSlots;
  for (const t of types) {
    while (meta.codexLevel(t) < config.CODEX.maxLevel) meta.upgradeCodex(t);
    const kinds = ['ruby', 'emerald', 'opal', 'topaz', 'sapphire'];
    for (let i = 0; i < kinds.length; i++) {
      const s = meta.gemSockets(t)[i];
      if (!s || s.kind || !s.unlocked) continue;
      const added = meta.addGem(kinds[i]);
      if (!added.ok) continue;
      meta.embedGem(t, i, added.gem.uid);
    }
  }
}

/** 让某塔型解锁到 2 级并嵌 2 颗宝石（复刻玩家截图：秘术猫眼 + 星辉紫晶） */
function prepTwoGems(type) {
  while (meta.codexLevel(type) < 2) meta.upgradeCodex(type);
  for (const kind of ['opal', 'amethyst']) {
    const i = meta.gemSockets(type).findIndex((s) => s.unlocked && !s.kind);
    if (i < 0) break;
    const added = meta.addGem(kind);
    if (!added.ok) break;
    meta.embedGem(type, i, added.gem.uid);
  }
}

/**
 * 画一次面板并做全套断言。
 * @param {string} tag 出现在断言名里的场景标签
 */
function checkPanel(g, type, tag) {
  g.panelTowerType = type;
  g.showPanel = true;
  g.selectedTower = null;
  g.gold = 9999;
  g.panelScrollOffset = 0;

  rec.texts.length = 0; rec.rects.length = 0; rec.clips.length = 0; rec.ops.length = 0;
  try {
    renderer.drawTowerPanel(g);
  } catch (e) {
    ok(`${tag}${type} 绘制`, false, `${e.constructor.name}: ${e.message}`);
    return;
  }

  // 面板矩形 = 最大的那个 roundRect（背板）
  const panel = rec.rects.filter((r) => r.w > 100 && r.h > 100)
    .sort((a, b) => b.w * b.h - a.w * a.h)[0];
  if (!panel) { ok(`${tag}${type} 找到面板矩形`, false); return; }

  // 数值文案：面板上任何"实数"都不许出现超过 2 位小数
  //（浮点乘算的尾巴，如 25×1×1.12 = 28.000000000000004，历史事故见 bonusStats.numText）
  for (const t of rec.texts) {
    if (/\.\d{3,}/.test(t.text)) longDecimals.push(`${tag}${type}: ${t.text}`);
  }

  // 面板自己的裁剪层 = 完全落在面板内的最大裁剪矩形
  const inPanel = rec.clips.filter((c) => c
    && c.x >= panel.x - 1 && c.y >= panel.y - 1
    && c.x + c.w <= panel.x + panel.w + 1 && c.y + c.h <= panel.y + panel.h + 1);
  const cover = inPanel.sort((a, b) => b.w * b.h - a.w * a.h)[0];

  const same = (a, b) => a && b && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5
    && Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5;

  const reach = g.panelScrollMax || 0;   // 这一帧算出来的可滚动距离
  let bad = 0, worst = null, maxBottom = -Infinity, tested = 0;
  for (const t of rec.texts) {
    totalTexts++;
    maxBottom = Math.max(maxBottom, t.y + t.size / 2);
    if (!same(t.clip, cover)) continue;
    tested++;
    const c = t.clip;
    const tol = 0.75;
    const horiz = Math.max(c.x - t.x0, t.x1 - (c.x + c.w));
    const vert = (t.y + t.size / 2) - (c.y + c.h);
    if (horiz > tol || vert > reach + tol) {
      bad++;
      const over = Math.max(horiz, vert - reach);
      if (!worst || over > worst.over) {
        worst = { over, t, horiz: horiz > tol, vert: vert > reach + tol };
      }
    }
  }

  const cut = maxBottom - (panel.y + panel.h);
  const reachable = cut <= reach + 1;
  ok(`${tag}${type} 面板文字合格（横向不越界 / 纵向滚得到）`, bad === 0 && !!cover,
    (bad === 0 ? `面板内 ${tested} 条文字全部合格` : `${bad}/${tested} 条不合格：` +
      (worst.horiz ? `横向越界 ${worst.over.toFixed(1)}px ` : '') +
      (worst.vert ? `纵向不可达 ${worst.over.toFixed(1)}px ` : '') +
      `「${worst.t.text.slice(0, 22)}」`)
    + `  面板 ${panel.w.toFixed(0)}x${panel.h.toFixed(0)}`
    + (cut > 1 ? `  底部 ${cut.toFixed(0)}px 在视口外（panelScrollMax=${reach.toFixed(0)}）` : ''));

  if (cut > 1) {
    ok(`${tag}${type} 超出视口的内容滚得到`, reachable && reach > 0,
      `需滚 ${cut.toFixed(0)}px / 实际 ${reach.toFixed(0)}`);
  }
}

// ============================================================================
// 第一轮：素面板（无宝石）
// ============================================================================
for (const [W, H] of RES) {
  log(`\n===== 第一轮 ${W}x${H}（无宝石） =====`);
  let g;
  try {
    g = mkGame(W, H);
  } catch (e) {
    log(`[BUILD FAIL] ${W}x${H}: ${e.message}`);
    continue;
  }
  for (const type of TYPES) checkPanel(g, type, '');
}

// ============================================================================
// 第二轮：嵌满 5 颗宝石（含猫眼石 → 技能槽 Lv>0）+ 宝石区块
// ============================================================================
prepGems(GEM_TYPES);
for (const t of GEM_TYPES) {
  const kinds = gems.embeddedGems(t);
  log(`\n[宝石态] ${t}：槽位 ${kinds.length}/${config.GEM.maxSlots} → ${kinds.join(',') || '空'}｜技能等级 ${towerMod.getEffectiveSkillLevel({ type: t, enhanceLevel: 0 })}`);
}
log('');

for (const [W, H] of RES) {
  log(`\n===== 第二轮 ${W}x${H}（嵌满宝石） =====`);
  let g;
  try {
    g = mkGame(W, H);
  } catch (e) {
    log(`[BUILD FAIL] ${W}x${H}: ${e.message}`);
    continue;
  }
  for (const type of GEM_TYPES) checkPanel(g, type, '宝石态·');

  // 宝石区块必须真的画出来了（否则"嵌了看不见"）
  // ⚠️ 四份记录一起清 —— 只清 texts 会让下面的几何断言吃到"上一批面板"的矩形
  rec.texts.length = 0; rec.rects.length = 0; rec.clips.length = 0; rec.ops.length = 0;
  g.panelTowerType = 'circle';
  g.showPanel = true;
  renderer.drawTowerPanel(g);
  const texts = rec.texts.map((t) => t.text);
  ok('宝石态·circle 面板出现「宝石」区块', texts.some((t) => t === '宝石'), texts.filter((t) => /宝石|红宝石|翡翠/.test(t)).join(' / ') || '无');
  ok('宝石态·circle 面板列出国色宝石名', texts.some((t) => /红宝石|翡翠|猫眼石|黄玉|蓝宝石/.test(t)), texts.filter((t) => /石/.test(t)).join(' / '));
  ok('宝石态·circle 技能槽显示 Lv>0（猫眼石+1 级）', texts.some((t) => /^Lv\.[1-9]/.test(t)), texts.filter((t) => /^Lv\./.test(t)).join(' / ') || '无 Lv 文本');

  // 判据：① 分隔线不许压在宝石卡上；② 两卡间距必须正好 = gemGap；③ 两卡之间没有多余装饰。
  // 注：录制到的分隔线 y 是那条"梭形"线的**上沿**（drawTaperedDivider 的 y 是中心、半厚 2.5），
  //     所以"净间距"直接拿它减卡片底边即可，重叠判据就是 clear >= 0。
  //     面板被矮屏挤压时每个分隔线区块会被压到 6px 高，线两侧必然贴死 —— 那种情况下
  //     只要求"不重叠"；"设计间距"由第三轮（宽屏 + 2 颗宝石）单独锁。
  const UI = renderer.PANEL_UI;   // 布局真源（renderer 已导出给探针）
  const cards = gemCards(rec, UI.gemRowH);   // 几何抽取在 harness 里（出图工具共用同一份）
  const dividers = dividerLines(rec);
  const nGem = gems.embeddedEntries('circle').length;
  ok(`${W}x${H} 宝石卡张数 = 已嵌宝石数`, cards.length === nGem,
    `画出 ${cards.length} 张 / 实嵌 ${nGem} 颗`);

  const squeezed = (g.panelScrollMax || 0) > 0;   // 面板被屏幕挤压 → 分隔线块会被压扁
  let minClear = Infinity;
  for (const c of cards) {
    const below = dividers.filter((d) => d.y > c.y).sort((a, b) => a.y - b.y)[0];
    if (!below) continue;
    minClear = Math.min(minClear, below.y - (c.y + c.h));
  }
  const need = 0;   // 挤压与否一律不许重叠；"设计间距 6.5px"见第三轮
  ok(`${W}x${H} 宝石卡不被下方分隔线压住`, !isFinite(minClear) || minClear >= need,
    `最近净间距 ${isFinite(minClear) ? minClear.toFixed(1) : 'n/a'}px（${squeezed ? '面板被挤压' : '面板不滚动'}；${dividers.length} 条分隔线 / ${cards.length} 张卡）`);

  let minCardGap = Infinity;
  for (let i = 1; i < cards.length; i++) {
    minCardGap = Math.min(minCardGap, cards[i].y - (cards[i - 1].y + cards[i - 1].h));
  }
  ok(`${W}x${H} 相邻宝石卡间距 = gemGap(${UI.gemGap})`,
    !isFinite(minCardGap) || Math.abs(minCardGap - UI.gemGap) < 0.01,
    `实测 ${isFinite(minCardGap) ? minCardGap.toFixed(1) : 'n/a'}px`);

  let stray = 0;
  for (let i = 1; i < cards.length; i++) {
    const a = cards[i - 1], b = cards[i];
    for (const r of rec.rects) {
      if (r.h <= 8 && r.w > 20 && r.y >= a.y + a.h - 1 && r.y + r.h <= b.y + 1) stray++;
    }
  }
  ok(`${W}x${H} 两张宝石卡之间没有多余装饰元素`, stray === 0, stray ? `发现 ${stray} 个 inset 小长条` : '干净');
}

// ============================================================================
// 第三轮：玩家截图场景（梯塔 / 2 颗宝石 / 宽屏、面板不滚动）
// ----------------------------------------------------------------------------
// 这一轮专门锁"设计间距"：宝石区块高度必须涵盖"n 张卡 + (n−1) 段间距"，
// 少算一份 → 第 2 张卡就会探出区块，把下面那条分隔线顶到卡片边框上
// （玩家原话："下面的分割线也弄自适应"）。
// 只取宽屏：这些尺寸下面板一定装得下、分隔线块不会被压扁，间距必须是设计值 6.5px。
// ============================================================================
prepTwoGems('trapezoid');
for (const [W, H] of [[390, 844], [414, 896], [428, 926]]) {
  const g = mkGame(W, H);
  g.panelTowerType = 'trapezoid';
  g.selectedTower = null;
  g.showPanel = true;
  g.gold = 9999;
  g.panelScrollOffset = 0;
  rec.texts.length = 0; rec.rects.length = 0; rec.clips.length = 0; rec.ops.length = 0;
  renderer.drawTowerPanel(g);

  const cards = gemCards(rec, renderer.PANEL_UI.gemRowH);
  const last = cards[cards.length - 1];
  const below = dividerLines(rec).filter((d) => last && d.y > last.y).sort((a, b) => a.y - b.y)[0];
  const clear = (last && below) ? below.y - (last.y + last.h) : NaN;
  ok(`${W}x${H} 梯塔 2 宝石：末卡与下方分隔线留出设计间距`,
    cards.length === 2 && isFinite(clear) && clear >= 5,
    `${cards.length} 张卡，净间距 ${isFinite(clear) ? clear.toFixed(1) : 'n/a'}px（设计 6.5px，要求 ≥5）`
    + `  面板 ${g._panelRect.w}x${g._panelRect.h} 滚动 ${g.panelScrollMax}`);
}

log('');
ok('面板全文：没有任何数值超过 2 位小数', longDecimals.length === 0,
  longDecimals.length ? `${longDecimals.length} 条：` + longDecimals.slice(0, 5).join(' ; ')
    : '全部数值最多 2 位小数');
log(`=== 属性面板汇总：${RES.length} 分辨率 × ${TYPES.length} 塔型 + 宝石态，文字 ${totalTexts} 条，失败 ${fails} 条 ===`);
log(`=== 判据戳：TOWER_ORDER=${TYPES.length} 型 / ${new Date().toISOString()} ===`);

fs.writeFileSync(path.join(__dirname, '_panel.txt'), out.join('\n'), 'utf8');
process.exitCode = fails ? 1 : 0;
