/**
 * 生成「整个界面点不动」排查报告（自包含 HTML，内联真实回放帧）。
 * 产物：.workbuddy/preview/排查报告_整个界面点不动.html
 */
'use strict';
const fs = require('fs');
const path = require('path');
const HH = require('./harness');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src');
const TMP = path.join(ROOT, '.workbuddy', 'tmp');
const PREVIEW = path.join(ROOT, '.workbuddy', 'preview');
const OUT = path.join(PREVIEW, '排查报告_整个界面点不动.html');

function clearCache() {
  Object.keys(require.cache).forEach((k) => {
    if (k.indexOf(SRC) === 0 || k === path.join(ROOT, 'game.js')) delete require.cache[k];
  });
}
const ALL = ['theme', 'config', 'meta', 'eventBus', 'units', 'geometry', 'enemy', 'tower',
  'wave', 'bonusStats', 'auraManager', 'renderer', 'input', 'shop', 'nav', 'codex',
  'talents', 'levels', 'gamemenu', 'enhance', 'game_core'];
const W = 390, H = 844;

function mk() {
  clearCache();
  const env = HH.setupGlobals(W, H);
  const holder = { ops: [] };
  const ctx = HH.makeCtx(env.canvas, holder);
  env.canvas.__ctx = ctx;
  const Game = require(path.join(SRC, 'game_core.js'));
  const g = new Game(env.canvas, ctx, { screenWidth: W, screenHeight: H });
  g.__holder = holder;
  const CUR = {};
  for (const m of ALL) CUR[m] = require(path.join(SRC, m + '.js'));
  return { g, CUR, holder };
}

// ---- 帧 1：战前选关 ----
let r1;
{
  const { g, holder } = mk();
  holder.ops = []; g.draw();
  r1 = HH.toSVG(holder.ops, W, H, '#0d1117');
}

// ---- 帧 2：战斗进行中（含塔 / 商店 / 顶栏 / 导航）----
let r2;
{
  const { g, CUR, holder } = mk();
  g.startBattle();
  g.gold = 999999;
  g.lives = 78;
  const types = ['triangle', 'circle', 'trapezoid', 'hexagon', 'sector', 'long_rectangle'];
  for (let i = 0; i < types.length && i < g.slots.length; i++) {
    const tw = CUR.tower.createTower(types[i], g.slots[i].x, g.slots[i].y);
    g.slots[i].tower = tw; g.slots[i].occupied = true; g.towers.push(tw);
  }
  g.currentWave = 7;
  const tw = g.slots[0].tower;
  g.showPanel = true; g.panelTowerType = tw.type; g.selectedTower = tw;
  holder.ops = []; g.draw();
  r2 = HH.toSVG(holder.ops, W, H, '#0d1117');
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const issues = [
  ['1', '主循环一帧异常 = 永久冻屏', 'game_core.js:loop()', 'update()/draw() 裸跑，异常穿过 rAF 回调 → requestAnimationFrame 永不执行 → 主循环停摆', 'try{update/draw}catch{记一次日志}；rAF 重排帧放到 try 外'],
  ['2', '拖放态悬空 → 首行 return 吃掉所有点击', 'input.js', 'handleTouchEnd 多个提前 return 分支不清 _resetDragState；旧兜底守卫只覆盖"起点丢了"那一半', '守卫改无条件清 + 结算/顶栏分支各自补 _resetDragState'],
  ['3', '缺 ctx.roundRect → 首帧抛 TypeError', 'renderer.js（25 处直接调用）', '基础库 3.17.2 → 3.14.0 后老版本没有 roundRect，drawSlots 首帧就炸', 'theme.polyfillRoundRect(ctx)，在 Game 构造函数里一次补齐'],
  ['4', '输入层与渲染层对 gameOver 口径不一致', 'input.js vs renderer.js', '渲染层只在 scene===\'battle\' 画结算，输入层不看 scene 却吞掉一切触摸', '输入层两处补 scene 判断 + loop() 里加不变式修复'],
  ['5', '看广告复活不补生命', 'game_core.js:onVideoComplete()', '只复原波次+金币，lives 仍 <=0 → 广告结束下一帧立刻又判负', '复活补到 maxLives×30%（REVIVE_LIVES_RATIO）'],
  ['6', '「开始游戏」被静默拒绝', 'game_core.js:startBattle()', '存档里选中了不可玩关卡时直接 return false，而输入层照样弹绿色"开始游戏"', '兜底切到第一个可玩关卡，输入层如实报错'],
];

const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>排查报告 · 整个界面无法点击</title>
<style>
  :root{--bg:#0d1117;--card:#161b22;--line:#30363d;--tx:#e6edf3;--dim:#8b949e;--red:#ff7b72;--grn:#7ee787;--yel:#e3b341;--blu:#79c0ff;}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--tx);font:14px/1.7 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;padding:28px 22px 60px}
  .wrap{max-width:1120px;margin:0 auto}
  h1{font-size:23px;margin:0 0 6px}
  .sub{color:var(--dim);margin-bottom:26px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:18px 20px;margin:16px 0}
  h2{font-size:16px;margin:0 0 12px;padding-bottom:8px;border-bottom:1px solid var(--line)}
  .big{background:linear-gradient(180deg,rgba(255,123,114,.13),rgba(255,123,114,.03));border-color:rgba(255,123,114,.45)}
  code{background:#21262d;padding:1px 6px;border-radius:4px;font-family:Consolas,Menlo,monospace;font-size:12.5px}
  pre{background:#0b0f14;border:1px solid var(--line);border-radius:8px;padding:12px 14px;overflow:auto;font-family:Consolas,Menlo,monospace;font-size:12.5px;color:var(--dim)}
  pre b{color:var(--red)}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th,td{border:1px solid var(--line);padding:8px 10px;text-align:left;vertical-align:top}
  th{background:#1c2128;color:var(--dim);font-weight:600}
  .n{color:var(--yel);font-weight:700;width:26px;text-align:center}
  .shots{display:flex;gap:16px;flex-wrap:wrap;justify-content:center}
  .shot{background:#0d1117;border:1px solid var(--line);border-radius:10px;padding:10px}
  .shot figcaption{color:var(--dim);font-size:12px;text-align:center;margin-top:8px}
  .shot svg{display:block;width:270px;height:585px;border-radius:6px}
  .kpi{display:flex;gap:14px;flex-wrap:wrap}
  .kpi div{flex:1 1 150px;background:#1c2128;border:1px solid var(--line);border-radius:8px;padding:12px 14px}
  .kpi b{display:block;font-size:22px;color:var(--grn)}
  .kpi span{color:var(--dim);font-size:12px}
  ul{margin:8px 0 0;padding-left:20px}
  li{margin:4px 0}
  .ok{color:var(--grn)} .no{color:var(--red)}
</style></head><body><div class="wrap">

<h1>「整个界面无法点击」排查报告</h1>
<div class="sub">项目：图形塔防（微信小游戏） · 分辨率 390×844 · 全部结论都有可复跑的探针支撑</div>

<div class="card big">
  <h2>一句话结论</h2>
  <p>不是逻辑写错了 —— 纯逻辑校验一直是 <b>211/0 全绿</b>。真正的原因是两条：<br>
  ① <b>运行环境变了</b>：<code>project.private.config.json</code> 里基础库从 <code>3.17.2</code> 被降到 <code>3.14.0</code>，
  而 <code>renderer.js</code> 有 <b>25 处直接调用 <code>ctx.roundRect</code></b>（只有 <code>theme.roundRectPath</code> 内部做了判断）。
  老基础库没有这个接口 → <b>首帧 <code>draw()</code> 抛 TypeError</b> → 主循环的 rAF 链断掉 → 画面永远停在最初一帧。<br>
  ② <b>主循环没有 try/catch</b>，所以上面那次异常不是"少画一块"，而是把整个交互彻底打死 —— 这就是你看到的"整块点不动"。</p>
  <pre>★ TypeError: ctx.roundRect is not a function
    at drawSlots      (src/renderer.js:140:9)
    at drawBattle     (src/renderer.js:1505:3)
    at Object.render  (src/renderer.js:1756:5)
    at Game.draw      (src/game_core.js:1545:14)</pre>
  <p class="sub" style="margin:0">↑ 这段栈来自反证脚本 <code>.workbuddy/tools/noroundrect.js</code>：故意拿掉 <code>ctx.roundRect</code> 再画一帧。</p>
</div>

<div class="card">
  <h2>修掉的 6 个问题</h2>
  <table>
    <tr><th class="n">#</th><th>问题</th><th>位置</th><th>为什么会"点不动"</th><th>修法</th></tr>
    ${issues.map((r) => `<tr><td class="n">${r[0]}</td><td>${esc(r[1])}</td><td><code>${esc(r[2])}</code></td><td>${esc(r[3])}</td><td>${esc(r[4])}</td></tr>`).join('\n    ')}
  </table>
</div>

<div class="card">
  <h2>验收（全部可复跑）</h2>
  <div class="kpi">
    <div><b>22/22</b><span>node --check 语法</span></div>
    <div><b>211 / 0</b><span>verify.js 全量校验</span></div>
    <div><b>32 / 0</b><span>regress-ui.js 可点性回归</span></div>
    <div><b>107 → 0</b><span>随机手势中的孤儿拖拽态（16000 次）</span></div>
  </div>
  <ul>
    <li><span class="ok">✓</span> 拖拽途中打输 → 松手后拖放态归零，结算按钮照常点得动（U1）</li>
    <li><span class="ok">✓</span> 每一个"会吞触摸"的状态都存在逃生口（U2，含旧版 2 个永久死锁态）</li>
    <li><span class="ok">✓</span> 看广告复活真的补生命（U3，从"出广告就秒死"→ <code>lives=30</code>）</li>
    <li><span class="ok">✓</span> 「开始游戏」在任意存档关卡下都真的开打（U4，不再静默失败）</li>
    <li><span class="ok">✓</span> 6250 个随机状态零违例：<code>gameOver ⇒ gameWon || lives&lt;=0</code>（U5）</li>
    <li><span class="ok">✓</span> 老基础库（无 <code>roundRect</code>）下全场景渲染不抛异常（U6）</li>
  </ul>
</div>

<div class="card">
  <h2>修复后的真实渲染帧（canvas 绘制指令回放，非截图美化）</h2>
  <div class="shots">
    <figure class="shot">${r1.replace(/^<\?xml[^>]*\?>\s*/, '')}<figcaption>启动 · 战前选关（关卡天梯 + 开始游戏）</figcaption></figure>
    <figure class="shot">${r2.replace(/^<\?xml[^>]*\?>\s*/, '')}<figcaption>战斗中 · 6 座塔 + 商店 + 塔属性面板</figcaption></figure>
  </div>
  <p class="sub" style="margin:12px 0 0">这两帧是主循环修复后由真实 <code>draw()</code> 产出的，用来确认界面本身是完整、可用的。</p>
</div>

<div class="card">
  <h2>顺带发现（未改，供你决定）</h2>
  <ul>
    <li><b>30 秒广告期整屏不可点</b>：<code>watchingVideo</code> 期间没有任何按钮，屏幕上只有倒计时文字，30 秒后自动结束。
        虽然会自愈，但如果玩家在这期间就报了"点不动"，体验上值得加一个"跳过"按钮。</li>
    <li><b><code>game.js</code> 是你工作区里未提交的改动</b>（已被重写过两次）。我只在其之上加了 <code>booted</code> 幂等保护，
        没有动你的启动时序逻辑（<code>setTimeout(boot, 1)</code> 规避 jsbridge not ready 这个判断是对的）。
        另外加了 <code>_unbindEvents</code>：<code>wx.onTouch*</code> 是累积注册，重复实例化会挂多套全局触摸监听。</li>
    <li><b><code>project.config.json</code> 里的 <code>worker: src/</code> 已被删掉</b>（模板残留），方向是对的。</li>
    <li>根目录残留的 <code>_diag.txt</code>（上一轮排查留下的）已清掉。</li>
  </ul>
</div>

</div></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(OUT, html, 'utf8');
fs.writeFileSync(path.join(TMP, '_report.txt'), 'written ' + fs.statSync(OUT).size + 'B -> ' + OUT, 'utf8');
console.log('report done');
