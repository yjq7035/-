// ============================================================================
// 图签界面探针 —— .workbuddy/tmp/probe-codex.js
// ----------------------------------------------------------------------------
// 三条断言：
//   ① getCodexLayout 不再抛异常（历史 bug：L is not defined）；
//   ② 走真实输入链路 tapAt（handleTouchStart → handleTouchEnd）点卡片能选中 → 弹出详情；
//   ③ 详情面板里的每条文字都落在面板矩形内（描述 / 固有技能说明都不许溢出）。
// ============================================================================
const path = require('path');
const fs = require('fs');
const { makeCtx, makeRec } = require('./harness');

global.document = { addEventListener() {}, removeEventListener() {} };
global.requestAnimationFrame = () => 0;

const ROOT = path.resolve(__dirname, '..', '..');
const out = [];
const log = (s) => out.push(s);

let Game, codex, renderer, input, config;
try {
  Game = require(path.join(ROOT, 'src', 'game_core'));
  codex = require(path.join(ROOT, 'src', 'codex'));
  renderer = require(path.join(ROOT, 'src', 'renderer'));
  input = require(path.join(ROOT, 'src', 'input'));
  config = require(path.join(ROOT, 'src', 'config'));
} catch (e) {
  fs.writeFileSync(path.join(__dirname, '_codex_error.txt'), (e && e.stack) || String(e), 'utf8');
  process.exit(1);
}

const rec = makeRec();
const ctx = makeCtx(rec);
const RES = [[320, 568], [360, 640], [375, 667], [375, 812], [390, 844], [414, 896], [428, 926]];

function mkGame(W, H) {
  const canvas = { width: W, height: H, addEventListener() {}, removeEventListener() {}, getContext() { return ctx; } };
  return new Game(canvas, ctx, { screenWidth: W, screenHeight: H, renderScale: 1 });
}

/** 走完整输入链路点一下（wx 触摸事件的坐标取 e.touches[0] 或 changedTouches[0]） */
function tapAt(g, x, y) {
  const ev = { touches: [{ clientX: x, clientY: y, x, y }], changedTouches: [{ clientX: x, clientY: y, x, y }] };
  input.handleTouchStart(g, ev);
  input.handleTouchEnd(g, ev);
}

let fails = 0;
const ok = (name, cond, detail) => {
  if (!cond) fails++;
  log(`${cond ? '  ok  ' : ' FAIL '} ${name}${detail ? '  → ' + detail : ''}`);
};

for (const [W, H] of RES) {
  log(`\n===== ${W}x${H} =====`);
  const g = mkGame(W, H);
  g.scene = 'codex';

  // ---- ① 布局不抛异常 ----
  let L = null;
  try {
    L = codex.getCodexLayout(g);
    ok('getCodexLayout 不抛异常', true, `sheetH=${L.sheet.h.toFixed(0)} maxScroll=${L.maxScroll.toFixed(0)}`);
  } catch (e) {
    ok('getCodexLayout 不抛异常', false, `${e.constructor.name}: ${e.message}`);
    continue;
  }

  // ---- ② 真实点击第一张卡 → 弹出详情面板 ----
  const cell0 = L.grid[0];
  ok('格网至少 1 格', !!cell0);
  if (cell0) {
    tapAt(g, cell0.x + cell0.w / 2, cell0.y + cell0.h / 2);
    ok(`点击「${cell0.type}」卡片后选中并弹出详情`, g.codexSelected === cell0.type,
      `codexSelected=${g.codexSelected}`);
  }

  // 再点一次同卡片 → 收起
  if (cell0) {
    tapAt(g, cell0.x + cell0.w / 2, cell0.y + cell0.h / 2);
    ok('再点同卡片收起面板', g.codexSelected === null, `codexSelected=${g.codexSelected}`);
  }

  // ---- ③ 逐个塔型：选中 → 绘制 → 断言"任何文字都不许逃出它当时的裁剪区" ----
  // 这条不变式同时覆盖两种 bug：
  //   · 文字没换行、比裁剪区还宽（历史 bug：固有技能说明右超 116px）
  //   · 裁剪区自己画小了（历史 bug：sheet.h - 50，把属性行/图签等级切掉）
  for (const type of config.TOWER_ORDER) {
    g.codexSelected = type;
    g.codexScroll = 0;
    rec.texts.length = 0; rec.rects.length = 0; rec.clips.length = 0; rec.ops.length = 0;
    let LL;
    try {
      LL = codex.getCodexLayout(g);
      codex.drawCodex(g);
    } catch (e) {
      ok(`${type} 绘制`, false, `${e.constructor.name}: ${e.message}`);
      continue;
    }
    const sheet = LL.sheet;
    const tol = 0.75;

    // 先定位"详情面板自己的那层裁剪区"= 完全落在面板内的最大裁剪矩形
    const inSheet = rec.clips.filter((c) => c
      && c.x >= sheet.x - 1 && c.y >= sheet.y - 1
      && c.x + c.w <= sheet.x + sheet.w + 1 && c.y + c.h <= sheet.y + sheet.h + 1);
    const cover = inSheet.sort((a, b) => b.w * b.h - a.w * a.h)[0];

    // 命门①：面板裁剪区必须罩住面板本身（差 6px 内算圆角留白）
    //         —— 历史 bug：裁剪区写成 sheet.h - 50，把属性行/图签等级切掉了
    ok(`${type} 面板裁剪区罩住面板`, !!cover && cover.h >= sheet.h - 6 && cover.w >= sheet.w - 6,
      cover ? `裁剪 ${cover.w.toFixed(0)}x${cover.h.toFixed(0)} vs 面板 ${sheet.w.toFixed(0)}x${sheet.h.toFixed(0)}` : '没找到面板裁剪区');

    // 命门②：画在"面板裁剪层"里的每条文字都必须落在该裁剪区内
    //         —— 历史 bug：固有技能说明没换行，右超 116px
    //         只筛这一层：格网里被视口边缘正常裁掉的部分格子不属于面板内容，不该算越界
    const same = (a, b) => a && b && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5
      && Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5;
    let bad = 0, worst = null, inSheetTexts = 0;
    for (const t of rec.texts) {
      if (!same(t.clip, cover)) continue;
      inSheetTexts++;
      const c = t.clip;
      const over = Math.max(c.x - t.x0, t.x1 - (c.x + c.w), c.y - (t.y - t.size / 2), (t.y + t.size / 2) - (c.y + c.h));
      if (over > tol) {
        bad++;
        if (!worst || over > worst.over) worst = { over, t };
      }
    }
    ok(`${type} 面板文字不溢出`, bad === 0,
      bad === 0 ? `面板内 ${inSheetTexts} 条文字全部在界内` : `${bad}/${inSheetTexts} 条越界，最严重 ${worst.over.toFixed(1)}px「${worst.t.text.slice(0, 22)}」`);
  }
}

log(`\n=== 图签汇总：${RES.length} 分辨率，失败 ${fails} 条 ===`);
log(`=== 判据戳：TOWER_ORDER=${config.TOWER_ORDER.length} 型 / sheetH基准=${codex.CODEX_UI.sheetH} / ${new Date().toISOString()} ===`);

fs.writeFileSync(path.join(__dirname, '_codex.txt'), out.join('\n'), 'utf8');
