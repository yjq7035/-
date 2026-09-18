// ============================================================================
// 本轮交付效果图 —— .workbuddy/tools/dump-gems.js
// ----------------------------------------------------------------------------
// 把这一轮新增/改造的三块界面，用【真实绘制链路】回放成 SVG，拼进一个自包含 HTML：
//   A. 塔属性面板 —— 固有技能「技能槽」（左图标 / 右技能名 + Lv + 介绍）
//   B. 图签详情面板 —— 宝石嵌入槽（图签每升 1 级解锁 1 个，最多 5）
//   C. 选宝石浮层 —— 点空槽弹出、列出持有数、点行即嵌入
//   D. 背包栏 —— 导航第 5 格，默认 20 格 / 每行 10 格 / 看广告解锁到 40
//
// 不是手绘示意图：全部走 renderer.render() 真实绘制。
// ============================================================================
const path = require('path');
const fs = require('fs');
const { createSvgCtx } = require('./svgctx');

global.document = { addEventListener() {}, removeEventListener() {} };
global.requestAnimationFrame = () => 0;

const ROOT = path.resolve(__dirname, '..', '..');
const load = (m) => require(path.join(ROOT, 'src', m));
const Game = load('game_core');
const renderer = load('renderer');
const codex = load('codex');
const bag = load('bag');
const meta = load('meta');
const config = load('config');

const W = 390, H = 844;

function mkGame(ctx) {
  const canvas = { width: W, height: H, addEventListener() {}, removeEventListener() {}, getContext() { return ctx; } };
  return new Game(canvas, ctx, { screenWidth: W, screenHeight: H, renderScale: 1 });
}

/** 用高亮虚线描出关键边界（注意：svgctx 的 setLineDash 是空实现，回放出来是实线） */
function outline(ctx, rect, color, label) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(rect.x, rect.y, rect.w, rect.h, 12);
  ctx.stroke();
  ctx.restore();
  if (!label) return;
  ctx.save();
  ctx.font = 'bold 11px Arial';
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText(label, rect.x + 2, rect.y - 4);
  ctx.restore();
}

// ---------- 准备一份有内容的存档（宝石跨局，所以要真的嵌进去）----------
const ARROW = 'arrow';
meta.resetAll();
meta.grantPoints(99999);
for (let i = 0; i < 3; i++) meta.upgradeCodex(ARROW);        // 箭形塔 → 图签 Lv.4 = 4 个槽
meta.addGem('sapphire');
meta.addGem('amethyst');
meta.addGem('topaz');
meta.addGem('opal');
const arrowBag0 = meta.gemList();
for (const k of ['ruby', 'sapphire', 'opal']) {
  const g = meta.gemList().filter((x) => x.kind === k)[0];
  if (g) meta.embedGem(ARROW, 0, g.uid);                     // 嵌入槽 0（空着就让 embed 自己找空位）
}
// 保证前 3 槽有东西：逐个塞进第一个空槽
let filled = meta.embeddedGems(ARROW).length;
for (const kind of ['emerald', 'amethyst', 'topaz']) {
  if (filled >= 3) break;
  meta.addGem(kind);
  const g = meta.gemList().filter((x) => x.kind === kind)[0];
  const slots = meta.gemSockets(ARROW);
  const empty = slots.filter((s) => s.unlocked && !s.kind)[0];
  if (g && empty) { meta.embedGem(ARROW, empty.index, g.uid); filled = meta.embeddedGems(ARROW).length; }
}

// ---------- A. 塔属性面板（技能槽 + 宝石条）----------
const ctxA = createSvgCtx(W, H, '#0d1017');
const gA = mkGame(ctxA);
gA.scene = 'battle';
gA.battleStarted = true;
gA.panelTowerType = ARROW;
gA.showPanel = true;
gA.gold = 99999;
renderer.render(gA);
if (gA._panelRect) outline(ctxA, gA._panelRect, '#FFD166', '属性面板（真实尺寸）');
const svgA = ctxA.toSVG();

// ---------- B. 图签详情面板（宝石嵌入槽）----------
const ctxB = createSvgCtx(W, H, '#0d1017');
const gB = mkGame(ctxB);
gB.scene = 'codex';
gB.codexSelected = ARROW;
gB.codexScroll = 0;
gB.codexSheetScroll = 0;
const LB = codex.getCodexLayout(gB);
// 把正文滚到"宝石槽完整可见"的位置
const gemsBlock = LB.sheetContent.blocks.filter((b) => b.type === 'gems')[0];
gB.codexSheetScroll = Math.max(0, Math.min(LB.sheetMaxScroll, gemsBlock.y + gemsBlock.h - LB.sheetView.h + 6));
const LB2 = codex.getCodexLayout(gB);
renderer.render(gB);
outline(ctxB, LB2.sheet, '#4DD0E1', '详情面板（标题固定 / 正文可滚动 / 按钮固定）');
outline(ctxB, LB2.sheetView, '#81C784', '正文滚动视区');
for (const s of codex.getSocketHitRects(LB2)) {
  outline(ctxB, s.rect, s.unlocked ? '#FFB74D' : '#78909C', null);
}
const svgB = ctxB.toSVG();

// ---------- C. 选宝石浮层 ----------
const ctxC = createSvgCtx(W, H, '#0d1017');
const gC = mkGame(ctxC);
gC.scene = 'codex';
gC.codexSelected = ARROW;
codex.openGemPicker(gC, ARROW, 3);            // 第 4 槽（空着，可嵌）
renderer.render(gC);
const svgC = ctxC.toSVG();

// ---------- D. 背包（20 格已解锁 + 20 格待解锁）----------
const ctxD = createSvgCtx(W, H, '#0d1017');
const gD = mkGame(ctxD);
gD.scene = 'bag';
const LD = bag.getBagLayout(gD);
renderer.render(gD);
outline(ctxD, { x: LD.cells[0].x, y: LD.cells[0].y, w: LD.cells[9].x + LD.cells[9].w - LD.cells[0].x, h: LD.cellH }, '#4DD0E1', '每行 10 格');
outline(ctxD, LD.btn, '#FFB74D', '看广告解锁（AD.enabled=false → 置灰）');
const svgD = ctxD.toSVG();

const bagUsed = meta.gemList().length;
const bagMax = meta.bagSlots();

const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>图形塔防 · 技能槽 / 宝石系统 / 背包栏</title>
<style>
  html,body{margin:0;background:#0b0e14;color:#e6edf3;font:14px/1.7 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
  .wrap{max-width:1180px;margin:0 auto;padding:28px 20px 60px}
  h1{font-size:21px;margin:0 0 6px}
  h2{font-size:15px;margin:34px 0 10px;color:#FFD166}
  h2.cy{color:#4DD0E1}h2.gr{color:#81C784}h2.or{color:#FFB74D}
  .sub{color:#8b98a9;font-size:13px;margin-bottom:8px}
  .row{display:flex;gap:24px;flex-wrap:wrap;align-items:flex-start}
  .phone{border:1px solid #222b38;border-radius:12px;overflow:hidden;background:#0d1017;flex:0 0 auto}
  .phone svg{display:block}
  .note{flex:1 1 340px;min-width:300px;background:#111722;border:1px solid #1e2734;border-radius:10px;padding:14px 18px}
  .note b{color:#fff}
  code{background:#1a2230;padding:1px 5px;border-radius:4px;font-size:12.5px;color:#9fd0ff}
  table{border-collapse:collapse;width:100%;margin-top:10px;font-size:13px}
  td,th{border-bottom:1px solid #1e2734;padding:6px 8px;text-align:left}
  th{color:#8b98a9;font-weight:600}
  .bad{color:#e57373}.good{color:#81c784}
  ul{margin:8px 0 0 18px;padding:0}li{margin:3px 0}
</style></head><body><div class="wrap">
<h1>固有技能槽 · 宝石系统 · 背包栏</h1>
<div class="sub">390 × 844 · 全部由真实绘制链路（<code>renderer.render</code>）回放成 SVG，非手绘示意图</div>

<h2>A. 塔属性面板 —— 固有技能改成「技能槽」</h2>
<div class="row">
  <div class="phone">${svgA}</div>
  <div class="note">
    <p>每个固有技能一个槽：<b>左边技能图标，右边技能名 + <code>Lv{等级}</code> + 当前值 + 说明</b>。</p>
    <ul>
      <li>槽内说明文字走 <code>wrapTextLines</code> 换行，<b>槽高由同一个函数算</b> —— 曾经"文本捅出面板 116px"的病因就是算行数和画文字用了两套逻辑。</li>
      <li><code>Lv</code> 的口径 = <b>Lv.1（默认）</b> + 强化次数 + <b>宝石等级</b>。所以嵌了猫眼石之后，这里会立刻显示 <code>Lv.2</code> 而强化还是 0 次 —— 面板与战斗取值同源（<code>tower.getEffectiveSkillLevel</code>）。</li>
      <li>面板整体可拖动滚动；内容塞不下时按"装饰优先级"让位：分隔线 → 页脚留白 → 内边距，<b>按钮和数值绝不让位</b>。</li>
      <li>这里曾有一个致命 bug：内容超出时调用了<b>全项目不存在</b>的 <code>drawScrollIndicator()</code> → 矮屏上必抛 <code>ReferenceError</code> → 面板整块画不出来，玩家只看到"点了塔没反应"。现已统一改用 <code>theme.drawScrollBar</code>。</li>
    </ul>
  </div>
</div>

<h2 class="cy">B. 图签详情面板 —— 宝石嵌入槽</h2>
<div class="row">
  <div class="phone">${svgB}</div>
  <div class="note">
    <p>这块面板改成了<b>三段式</b>：<span style="color:#4DD0E1">标题固定</span> /
      <span style="color:#81C784">正文可滚动</span> /
      <span style="color:#FFD166">按钮固定</span>。滚动正文而不是整块，玩家任何时刻都看得见
      "这是哪个塔"和"能不能升级"。</p>
    <p><b>宝石槽</b>：图签 <b>每升 1 级解锁 1 个</b>，最多 5 个（解锁即 Lv.1 → 1 个槽）。
      橙色框出的就是 5 个槽位；已解锁的实心、未解锁的画锁。槽位坐标由 <code>codex.socketRects()</code>
      一处算定，<b>绘制与命中检测共用</b>，滚动后"看到的槽"就是"能点的槽"。</p>
    <p>操作：<b>点空槽</b> → 弹选宝石浮层；<b>点已嵌的宝石</b> → 取出放回背包（背包满会拒绝，绝不吞宝石）。</p>
    <p>旧实现在正文超出时靠"把面板顶上去"来解决，结果是长文案被屏幕夹住看不到结尾；
      而且面板高度依赖文字行数 → 点一下卡片整张格网都在重排。现在高度有上限，超出部分靠拖动看。</p>
  </div>
</div>

<h2 class="or">C. 选宝石浮层（模态）</h2>
<div class="row">
  <div class="phone">${svgC}</div>
  <div class="note">
    <p>列出 6 种宝石与<b>背包持有数</b>；持有 0 的行置灰不可点（看得见长相，点不动）。</p>
    <p>点一行即嵌入：宝石<b>从背包消失</b>、写进该塔型的槽位、加成与<b>固有技能绑定</b>并跨局永久生效。</p>
    <p>浮层是模态，且<b>必须能退出</b> —— 点取消 / ✕ / 浮层外都会关掉；点灰行只提示、不关闭（防误触）。</p>
    <p>6 种宝石一屏放得下，所以刻意<b>不做列表滚动</b> —— 少一个会出错的交互面。</p>
  </div>
</div>

<h2 class="gr">D. 背包栏（导航第 5 格）</h2>
<div class="row">
  <div class="phone">${svgD}</div>
  <div class="note">
    <p>默认 <b>20 格</b>、<b>每行 10 格</b>；上限 40 格（4 行）。未解锁的格子画小锁。</p>
    <p>解锁走<b>激励视频</b>：看一次 <code>+10</code> 格。广告位 ID 尚未申请，
      <code>AD.enabled=false</code> 时按钮与「再次挑战」同款<b>置灰禁用</b>，
      并且 <code>actExpandBag()</code> 会<b>真的拒绝</b>而不是假装成功 —— 假解锁会让这条进度在线上凭空跳变。</p>
    <p>宝石来源：清空每 3 波必掉 1 颗，精英 / BOSS 另按概率掉；背包满时掉落会被丢弃（不会静默顶掉已有宝石）。</p>
    <p>当前存档状态：背包 <b>${bagUsed} / ${bagMax}</b> 格已用。</p>
  </div>
</div>
</div></body></html>`;

fs.writeFileSync(path.join(__dirname, '_gems.html'), html, 'utf8');
fs.writeFileSync(path.join(__dirname, '_gems_sizes.txt'),
  `A=${svgA.length} B=${svgB.length} C=${svgC.length} D=${svgD.length} html=${html.length}\n`, 'utf8');
