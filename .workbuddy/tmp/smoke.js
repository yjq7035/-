// ============================================================================
// 整机冒烟 —— .workbuddy/tmp/smoke.js
// ----------------------------------------------------------------------------
// 直接跑 renderer.render(game) 的完整管线（不是单函数），覆盖 5 个场景：
//   battle / battle+属性面板 / codex / codex+详情面板 / talents
// 断言：① 不抛异常；② 绘制指令数 > 40（空屏探测器）。
// 顺带跑一遍"真实点击"链路，确认两个历史 bug 都不会回来。
// ============================================================================
const path = require('path');
const fs = require('fs');
const { makeCtx, makeRec } = require('./harness');

global.document = { addEventListener() {}, removeEventListener() {} };
global.requestAnimationFrame = () => 0;

const ROOT = path.resolve(__dirname, '..', '..');
const out = [];
let fails = 0;
const ok = (name, cond, detail) => {
  if (!cond) fails++;
  out.push(`${cond ? '  ok  ' : ' FAIL '} ${name}${detail ? '  → ' + detail : ''}`);
};

let Game, renderer, input, codex, config;
try {
  Game = require(path.join(ROOT, 'src', 'game_core'));
  renderer = require(path.join(ROOT, 'src', 'renderer'));
  input = require(path.join(ROOT, 'src', 'input'));
  codex = require(path.join(ROOT, 'src', 'codex'));
  config = require(path.join(ROOT, 'src', 'config'));
} catch (e) {
  fs.writeFileSync(path.join(__dirname, '_smoke_error.txt'), (e && e.stack) || String(e), 'utf8');
  process.exit(1);
}

const rec = makeRec();
const ctx = makeCtx(rec);
const RES = [[320, 568], [375, 667], [375, 812], [390, 844], [428, 926]];

function mkGame(W, H) {
  const canvas = { width: W, height: H, addEventListener() {}, removeEventListener() {}, getContext() { return ctx; } };
  return new Game(canvas, ctx, { screenWidth: W, screenHeight: H, renderScale: 1 });
}

function tapAt(g, x, y) {
  const ev = { touches: [{ clientX: x, clientY: y, x, y }], changedTouches: [{ clientX: x, clientY: y, x, y }] };
  input.handleTouchStart(g, ev);
  input.handleTouchEnd(g, ev);
}

for (const [W, H] of RES) {
  out.push(`\n===== ${W}x${H} =====`);
  const g = mkGame(W, H);

  const scenarios = [
    ['战斗（战前选关）', () => { g.scene = 'battle'; }],
    ['战斗 + 属性面板', () => { g.scene = 'battle'; g.panelTowerType = 'arrow'; g.showPanel = true; }],
    ['图签（无选中）', () => { g.scene = 'codex'; g.showPanel = false; g.codexSelected = null; }],
    ['图签 + 详情面板', () => { g.scene = 'codex'; g.codexSelected = 'arrow'; }],
    ['天赋', () => { g.scene = 'talents'; g.codexSelected = null; }],
  ];

  for (const [name, setup] of scenarios) {
    setup();
    rec.texts.length = 0; rec.rects.length = 0; rec.clips.length = 0; rec.ops.length = 0;
    let err = null;
    try { renderer.render(g); } catch (e) { err = e; }
    const ops = rec.ops.length + rec.texts.length;
    ok(`${name} 渲染`, !err && ops > 40,
      err ? `${err.constructor.name}: ${err.message}` : `指令 ${ops} 条`);
  }

  // 真实点击：图签里点卡片 → 必须弹出详情面板（历史 bug：L is not defined 导致永远弹不出）
  g.scene = 'codex';
  g.codexSelected = null;
  g.codexScroll = 0;
  const L = codex.getCodexLayout(g);
  const c0 = L.grid[0];
  tapAt(g, c0.x + c0.w / 2, c0.y + c0.h / 2);
  ok('图签：点卡片弹出详情面板', g.codexSelected === c0.type, `codexSelected=${g.codexSelected}`);

  // 点面板上的「升级」按钮 → 不应抛异常
  let upErr = null;
  try { codex.actCodex(g, 'upgrade', c0.type); } catch (e) { upErr = e; }
  ok('图签：执行一次升级不抛异常', !upErr, upErr ? upErr.message : 'ok');

  // 点空白关闭
  tapAt(g, W / 2, L.viewport.y + 2);
  ok('图签：点空白收面板', g.codexSelected === null, `codexSelected=${g.codexSelected}`);

  // 战斗场景点顶栏 ☰ 不应抛异常
  g.scene = 'battle';
  let menuErr = null;
  try { tapAt(g, 12, 12); } catch (e) { menuErr = e; }
  ok('战斗：点顶栏不抛异常', !menuErr, menuErr ? menuErr.message : 'ok');
}

out.push('');
out.push(`=== 冒烟汇总：${RES.length} 分辨率 × 5 场景，失败 ${fails} 条 ===`);
out.push(`=== 判据戳：TOWER_ORDER=${config.TOWER_ORDER.length} / ${new Date().toISOString()} ===`);
fs.writeFileSync(path.join(__dirname, '_smoke.txt'), out.join('\n'), 'utf8');
