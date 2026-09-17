// ============================================================================
// 修复效果图 —— .workbuddy/tmp/dump-svg.js
// ----------------------------------------------------------------------------
// 把两处受害面板用真实绘制链路回放成 SVG，拼进一个自包含 HTML 交付。
//   A. 战斗中的塔属性面板（arrow）—— 固有技能说明已换行
//   B. 图签页 + 详情面板（arrow）—— 面板能弹出、固有技能说明已换行
// 顺手用虚线框把面板边界描出来，"文字有没有出界"一眼可判。
// ============================================================================
const path = require('path');
const fs = require('fs');
const { createSvgCtx } = require('./svgctx');

global.document = { addEventListener() {}, removeEventListener() {} };
global.requestAnimationFrame = () => 0;

const ROOT = path.resolve(__dirname, '..', '..');
const Game = require(path.join(ROOT, 'src', 'game_core'));
const renderer = require(path.join(ROOT, 'src', 'renderer'));
const codex = require(path.join(ROOT, 'src', 'codex'));

const W = 390, H = 844;

function mkGame(ctx) {
  const canvas = { width: W, height: H, addEventListener() {}, removeEventListener() {}, getContext() { return ctx; } };
  return new Game(canvas, ctx, { screenWidth: W, screenHeight: H, renderScale: 1 });
}

/** 用高亮虚线描出面板边界，方便判断文字是否越界 */
function outline(ctx, rect, color, label) {
  ctx.save();
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(rect.x, rect.y, rect.w, rect.h, 12);
  ctx.stroke();
  ctx.restore();
  ctx.save();
  ctx.font = 'bold 11px Arial';
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText(label, rect.x + 2, rect.y - 4);
  ctx.restore();
}

// ---------- A. 塔属性面板 ----------
const ctxA = createSvgCtx(W, H, '#0d1017');
const gA = mkGame(ctxA);
gA.scene = 'battle';
gA.battleStarted = true;
gA.panelTowerType = 'arrow';
gA.showPanel = true;
gA.gold = 9999;
renderer.render(gA);
{
  const p = gA._panelRectForDebug;
  // 从渲染结果里拿不到面板矩形，这里按同一套公式复算一遍
  const rect = { x: (W - Math.min(302, W - 32)) / 2, y: 0, w: Math.min(302, W - 32), h: 0 };
  const ctx = ctxA;
  ctx.save();
  ctx.font = '12.5px Arial';
  // 面板高：直接用探针测得的最终值 576（arrow @390x844，见 _panel.txt）
  rect.h = 576;
  rect.y = Math.max(18, (H - rect.h) / 2);
  ctx.restore();
  outline(ctxA, rect, '#FFD166', '属性面板边界（虚线）');
}
const svgA = ctxA.toSVG();

// ---------- B. 图签 + 详情面板 ----------
const ctxB = createSvgCtx(W, H, '#0d1017');
const gB = mkGame(ctxB);
gB.scene = 'codex';
gB.codexSelected = 'arrow';
gB.codexScroll = 0;
const LB = codex.getCodexLayout(gB);
renderer.render(gB);
outline(ctxB, LB.sheet, '#4DD0E1', '详情面板边界（虚线）');
const svgB = ctxB.toSVG();

const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>图形塔防 · 属性面板 / 图签详情面板 修复效果</title>
<style>
  html,body{margin:0;background:#0b0e14;color:#e6edf3;font:14px/1.7 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
  .wrap{max-width:1120px;margin:0 auto;padding:28px 20px 60px}
  h1{font-size:20px;margin:0 0 6px}
  h2{font-size:15px;margin:34px 0 10px;color:#FFD166}
  h2.cy{color:#4DD0E1}
  .sub{color:#8b98a9;font-size:13px;margin-bottom:8px}
  .row{display:flex;gap:26px;flex-wrap:wrap;align-items:flex-start}
  .phone{border:1px solid #222b38;border-radius:12px;overflow:hidden;background:#0d1017;flex:0 0 auto}
  .phone svg{display:block}
  .note{flex:1 1 320px;min-width:300px;background:#111722;border:1px solid #1e2734;border-radius:10px;padding:14px 18px}
  .note b{color:#fff}
  code{background:#1a2230;padding:1px 5px;border-radius:4px;font-size:12.5px;color:#9fd0ff}
  table{border-collapse:collapse;width:100%;margin-top:10px;font-size:13px}
  td,th{border-bottom:1px solid #1e2734;padding:6px 8px;text-align:left}
  th{color:#8b98a9;font-weight:600}
  .bad{color:#e57373}.good{color:#81c784}
</style></head><body><div class="wrap">
<h1>属性面板 / 图签详情面板 —— 文本溢出与弹窗失效修复</h1>
<div class="sub">390 × 844 · 由真实绘制链路回放成 SVG（非手绘示意图）</div>

<h2>A. 战斗中的塔属性面板（箭形塔 arrow —— 全塔最长的一句技能说明）</h2>
<div class="row">
  <div class="phone">${svgA}</div>
  <div class="note">
    <p><b>病因</b>：<code>ENHANCE_SPECIAL[type].desc</code> 这一行从来没走过换行，被 <code>fillText</code> 整句硬画出去。</p>
    <p>箭形塔那句 33 字，按 12.5px 字宽约 410px，而面板内容宽度只有 <b>262px</b> —— 实测<b class="bad">右边界超出 116px</b>，被面板圆角裁成半句。</p>
    <p><b>修法</b>：固有技能区改走 <code>wrapTextLines</code>（与"攻击介绍"同一个换行函数、同一份字体配置），换行后的行数累加进区块高度，面板高度随之自适应。</p>
    <table>
      <tr><th>塔型</th><th>面板高（修复前 → 后）</th></tr>
      <tr><td>箭形塔 arrow</td><td>542 → <b>576</b></td></tr>
      <tr><td>短说明塔</td><td>542 → 542（不变，不多占一行）</td></tr>
    </table>
  </div>
</div>

<h2 class="cy">B. 图签页 + 详情面板（点图形塔卡片弹出）</h2>
<div class="row">
  <div class="phone">${svgB}</div>
  <div class="note">
    <p><b>病因（弹不出来）</b>：<code>getCodexLayout()</code> 里有一行 <code>L.sheet.h = sheetH;</code>，而 <code>L</code> 是<span class="bad">不存在的变量</span> → 每次调用都抛 <code>ReferenceError</code>。</p>
    <p>触点一落到卡片上，<code>hitCodex()</code> 立刻抛异常，<code>handleTouchStart</code> 整条链路中断 —— 面板永远没机会打开；同一份异常也让渲染帧画不出图签内容。</p>
    <p><b>修法</b>：删掉那行幽灵赋值（返回的对象本来就带正确的 <code>h</code>）；固有技能说明同样改为换行，高度用<b>同一个换行函数</b>算，杜绝"行数算一套、画另一套"。</p>
    <p>另外把详情面板的裁剪区从 <code>sheet.h - 50</code> 改成贴住面板本身 —— 旧裁剪区比面板矮 48px，正好把属性行、图签等级那几行切掉。</p>
  </div>
</div>
</div></body></html>`;

fs.writeFileSync(path.join(__dirname, '_panels.html'), html, 'utf8');
fs.writeFileSync(path.join(__dirname, '_svgA.txt'), String(svgA.length), 'utf8');
fs.writeFileSync(path.join(__dirname, '_svgB.txt'), String(svgB.length), 'utf8');
