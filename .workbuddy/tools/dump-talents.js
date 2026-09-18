// ============================================================================
// 天赋花费改版 · 效果图 —— .workbuddy/tools/dump-talents.js
// ----------------------------------------------------------------------------
// 把天赋页用【真实绘制链路】回放成 SVG（不是手绘示意图），拼进一份自包含 HTML，
// 供肉眼核对：按钮上报价随等级增长、底栏文案、最窄分辨率不越界。
// 顺带附一张「等级 × 基础花费」价格总表（直接来自 meta.talentCost，与游戏同源）。
// 产出：.workbuddy/tmp/_talents.html
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
const meta = load('meta');
const config = load('config');

/** 造一台"这条天赋已经学到 Lv.x"的机器视角（直接写存档态，等价于玩家真学上去） */
function mkGame(W, H, levels) {
  const ctx = createSvgCtx(W, H, '#0d1017');
  const canvas = { width: W, height: H, addEventListener() {}, removeEventListener() {}, getContext() { return ctx; } };
  const g = new Game(canvas, ctx, { screenWidth: W, screenHeight: H, renderScale: 1 });
  meta.resetAll();
  meta.grantTalentPoints(99999);
  const m = meta.get();
  for (const def of config.TALENTS) {
    const lv = (levels && levels[def.id] !== undefined) ? levels[def.id] : 0;
    m.talents[def.id] = Math.max(0, Math.min(def.max, lv));
  }
  g.scene = 'talents';
  renderer.render(g);
  return { svg: ctx.toSVG(), game: g };
}

// A. 主流机型：各天赋错开等级，按钮上应出现 1/2/3/…/18 多种价位
const A = mkGame(390, 844, {
  gold_start: 3, gold_gain: 0, boss_bounty: 6, gold_per_sec: 1,
  wave_bonus: 9, points_gain: 2, build_cost: 0, codex_ease: 4, high_stakes: 7,
});

// B. 最窄分辨率（320×568）：底栏文案最容易在这里溢出，专门盯它
const B = mkGame(320, 568, { gold_start: 9, gold_gain: 9, wave_bonus: 9 });

// C. 价格总表（与游戏同一真源：meta.talentCost）
const rows = config.TALENTS.map((def) => {
  const cells = [];
  let total = 0;
  for (let n = 1; n <= def.max; n++) {
    const c = meta.talentCost(def.id, n);
    total += c;
    cells.push(`<td>${c}</td>`);
  }
  return `<tr><td class="nm">${def.name}<span class="id">${def.id}</span></td>`
    + `<td class="base">${def.cost}</td>${cells.join('')}<td class="tot">${total}</td></tr>`;
}).join('');

const head = Array.from({ length: 10 }, (_, i) => `<th>Lv.${i + 1}</th>`).join('');

const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>图形塔防 · 天赋学习花费（等级 × 基础花费）</title>
<style>
  html,body{margin:0;background:#0b0e14;color:#e6edf3;font:14px/1.7 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
  .wrap{max-width:1180px;margin:0 auto;padding:28px 20px 60px}
  h1{font-size:21px;margin:0 0 6px}
  h2{font-size:15px;margin:34px 0 10px;color:#4DD0E1}
  .sub{color:#8b98a9;font-size:13px;margin-bottom:10px}
  .row{display:flex;gap:26px;flex-wrap:wrap;align-items:flex-start}
  .phone{border:1px solid #222b38;border-radius:12px;overflow:hidden;background:#0d1017;flex:0 0 auto}
  .phone svg{display:block}
  .note{flex:1 1 360px;min-width:300px;background:#111722;border:1px solid #1e2734;border-radius:10px;padding:14px 18px}
  .note b{color:#fff}
  code{background:#1a2230;padding:1px 6px;border-radius:4px;color:#4DD0E1;font-size:12.5px}
  table{border-collapse:collapse;font-size:12.5px;margin-top:6px}
  th,td{border:1px solid #1e2734;padding:3px 8px;text-align:center}
  th{background:#141b26;color:#8b98a9;font-weight:600}
  td.nm{text-align:left;color:#4DD0E1;white-space:nowrap}
  td.nm .id{color:#5b6879;font-size:11px;margin-left:8px}
  td.base{color:#FFB74D;font-weight:700}
  td.tot{color:#81C784;font-weight:700}
</style></head><body><div class="wrap">
<h1>天赋学习花费：学 Lv.N = N × 基础花费</h1>
<div class="sub">旧版每条天赋手写 10 个价格已删除，改为线性公式；下方两张图是 <code>renderer.render()</code> 的真实回放。</div>

<h2>A. 天赋页（390×844，各条错开等级 → 按钮报价应为 1/2/3/…/18 多档）</h2>
<div class="row">
  <div class="phone">${A.svg}</div>
  <div class="note">
    <p><b>看什么</b>：右侧按钮上的 <code>✦N</code> 就是<b>下一级</b>的实价。等级越高越贵，底栏那行字写着规则。</p>
    <p><b>口径</b>：基础花费 1 的天赋 → 1,2,3,…,10（学满 55）；基础花费 2 的天赋 → 2,4,6,…,20（学满 110）。</p>
    <p><b>唯一真源</b>：<code>meta.talentCost(id, level)</code>，按钮报价与真实扣费走同一个函数，测试逐行比对过。</p>
  </div>
</div>

<h2>B. 最窄分辨率 320×568（底栏文案的溢出重灾区）</h2>
<div class="row">
  <div class="phone">${B.svg}</div>
  <div class="note">
    <p><b>看什么</b>：底栏那一行整句是否在屏内。<code>probe-talent.js</code> ⑤ 组会对 320/375/375/390/428 五个宽度断言 <code>x0 ≥ 0 且 x1 ≤ W</code>。</p>
    <p>同屏三条都停在 Lv.9 → 下一级要 <code>✦10 / ✦20</code>，正好检验十位数报价塞不塞得下按钮。</p>
  </div>
</div>

<h2>C. 价格总表（同源：meta.talentCost）</h2>
<table>
  <tr><th>天赋</th><th>基础</th>${head}<th>学满</th></tr>
  ${rows}
</table>

</div></body></html>
`;

fs.writeFileSync(path.join(__dirname, '..', 'tmp', '_talents.html'), html, 'utf8');
console.log('ok');
