// ============================================================================
// 属性面板文字越界探针 —— .workbuddy/tmp/probe-panel.js
// ----------------------------------------------------------------------------
// 断言：drawTowerPanel 画出的每条 fillText 都必须落在【它当时的裁剪区】内。
//       —— 这条不变式正好覆盖"描述文字比面板宽/高"的越界（历史 bug：
//          arrow 的固有技能说明右超 116px、square 右超 5.5px）。
// 另附诊断：面板被屏幕高度夹住时，有多少内容被裁掉（短屏观察用）。
// ============================================================================
const path = require('path');
const fs = require('fs');
const { makeCtx, makeRec } = require('./harness');

// 平台兜底：game_core.initEvents() 在非 wx 环境会去碰 document
global.document = { addEventListener() {}, removeEventListener() {} };
global.requestAnimationFrame = () => 0;

const ROOT = path.resolve(__dirname, '..', '..');

const out = [];
const log = (s) => out.push(s);

const rec = makeRec();
const ctx = makeCtx(rec);

let Game, renderer, config;
try {
  Game = require(path.join(ROOT, 'src', 'game_core'));
  renderer = require(path.join(ROOT, 'src', 'renderer'));
  config = require(path.join(ROOT, 'src', 'config'));
} catch (e) {
  fs.writeFileSync(path.join(__dirname, '_panel_error.txt'), (e && e.stack) || String(e), 'utf8');
  process.exit(1);
}

const RES = [
  [320, 568], [360, 640], [375, 667], [375, 812],
  [390, 844], [414, 896], [428, 926],
];

const TYPES = config.TOWER_ORDER;

let fails = 0;
let totalTexts = 0;
const ok = (name, cond, detail) => {
  if (!cond) fails++;
  log(`${cond ? '  ok  ' : ' FAIL '} ${name}${detail ? '  → ' + detail : ''}`);
};

for (const [W, H] of RES) {
  log(`\n===== ${W}x${H} =====`);
  const canvas = { width: W, height: H, addEventListener() {}, removeEventListener() {}, getContext() { return ctx; } };
  let g;
  try {
    g = new Game(canvas, ctx, { screenWidth: W, screenHeight: H, renderScale: 1 });
  } catch (e) {
    log(`[BUILD FAIL] ${W}x${H}: ${e.message}`);
    continue;
  }

  for (const type of TYPES) {
    g.panelTowerType = type;
    g.showPanel = true;
    g.selectedTower = null;
    g.gold = 9999;

    rec.texts.length = 0; rec.rects.length = 0; rec.clips.length = 0; rec.ops.length = 0;
    try {
      renderer.drawTowerPanel(g);
    } catch (e) {
      ok(`${type} 绘制`, false, `${e.constructor.name}: ${e.message}`);
      continue;
    }

    // 面板矩形 = 最大的那个 roundRect（背板）
    const panel = rec.rects.filter((r) => r.w > 100 && r.h > 100)
      .sort((a, b) => b.w * b.h - a.w * a.h)[0];
    if (!panel) { ok(`${type} 找到面板矩形`, false); continue; }

    // 面板自己的裁剪层 = 完全落在面板内的最大裁剪矩形
    const inPanel = rec.clips.filter((c) => c
      && c.x >= panel.x - 1 && c.y >= panel.y - 1
      && c.x + c.w <= panel.x + panel.w + 1 && c.y + c.h <= panel.y + panel.h + 1);
    const cover = inPanel.sort((a, b) => b.w * b.h - a.w * a.h)[0];

    const same = (a, b) => a && b && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5
      && Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5;

    let bad = 0, worst = null, maxBottom = -Infinity, tested = 0;
    for (const t of rec.texts) {
      totalTexts++;
      maxBottom = Math.max(maxBottom, t.y + t.size / 2);
      if (!same(t.clip, cover)) continue;    // 只查画在面板裁剪层里的文字
      tested++;
      const c = t.clip;
      const tol = 0.75;
      const over = Math.max(c.x - t.x0, t.x1 - (c.x + c.w), c.y - (t.y - t.size / 2), (t.y + t.size / 2) - (c.y + c.h));
      if (over > tol) {
        bad++;
        if (!worst || over > worst.over) worst = { over, t };
      }
    }

    const cut = maxBottom - (panel.y + panel.h);
    ok(`${type} 面板文字不溢出`, bad === 0 && !!cover,
      (bad === 0 ? `面板内 ${tested} 条文字全部在界内` : `${bad}/${tested} 条越界，最严重 ${worst.over.toFixed(1)}px「${worst.t.text.slice(0, 22)}」`)
      + `  面板 ${panel.w.toFixed(0)}x${panel.h.toFixed(0)}`
      + (cut > 1 ? `  ⚠内容被屏幕夹住，底部 ${cut.toFixed(0)}px 被裁` : ''));
  }
}

log('');
log(`=== 属性面板汇总：${RES.length} 分辨率 × ${TYPES.length} 塔型，文字 ${totalTexts} 条，失败 ${fails} 条 ===`);
log(`=== 判据戳：TOWER_ORDER=${TYPES.length} 型 / panel 基准宽=${renderer.PANEL_UI ? renderer.PANEL_UI.width : 'n/a'} / ${new Date().toISOString()} ===`);

fs.writeFileSync(path.join(__dirname, '_panel.txt'), out.join('\n'), 'utf8');
