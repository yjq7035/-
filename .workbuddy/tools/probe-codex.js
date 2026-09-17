// ============================================================================
// 图签界面探针 —— .workbuddy/tools/probe-codex.js
// ----------------------------------------------------------------------------
// 断言（2026-09 面板改版后重写）：
//   ① getCodexLayout 不抛异常（历史 bug：L is not defined）；
//   ② 走真实输入链路 tapAt 点卡片能选中 → 弹出详情；再点收起；
//   ③ 面板三段（标题 / 正文 / 按钮）几何互不重叠且都在面板内
//      —— 这是"正文可滚动"能成立的前提；
//   ④ 凡是在【详情面板内部】绘制的文字，都必须落在它自己那层裁剪区内
//      —— 历史 bug：固有技能说明没换行，右超 116px；旧写法把裁剪区写成 sheet.h-50，
//         把属性行 / 图签等级切掉了；
//   ⑤ 正文"滚得到底"：sheetMaxScroll 恰好 = 内容高 - 视区高，且滚到底后
//      最后一块内容确实进入视区 —— 证明内容不会被永久裁掉（这才是
//      "文本超出显示不全"要防的东西，而不是"内容不许比面板高"）。
//   ⑥ 宝石嵌入槽：5 个槽横向不溢出；解锁数 = 图签等级；
//   ⑦ 宝石嵌入闭环（真实点击）：空槽 → 弹浮层 → 点宝石 → 背包 -1 且塔上生效
//      → 再点槽取出 → 背包 +1。即需求"嵌入后被嵌入的宝石会从物品栏消失"。
// ============================================================================
const path = require('path');
const fs = require('fs');
const { makeCtx, makeRec } = require('./harness');

global.document = { addEventListener() {}, removeEventListener() {} };
global.requestAnimationFrame = () => 0;

const ROOT = path.resolve(__dirname, '..', '..');
const out = [];
const log = (s) => out.push(s);

let Game, codex, meta, gems, renderer, input, config;
try {
  Game = require(path.join(ROOT, 'src', 'game_core'));
  codex = require(path.join(ROOT, 'src', 'codex'));
  meta = require(path.join(ROOT, 'src', 'meta'));
  gems = require(path.join(ROOT, 'src', 'gems'));
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

/** 走完整输入链路点一下 */
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

const TOL = 0.75;
const same = (a, b) => a && b && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5
  && Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5;
const inside = (inner, outer, tol) => inner
  && inner.x >= outer.x - tol && inner.y >= outer.y - tol
  && inner.x + inner.w <= outer.x + outer.w + tol
  && inner.y + inner.h <= outer.y + outer.h + tol;

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

    tapAt(g, cell0.x + cell0.w / 2, cell0.y + cell0.h / 2);
    ok('再点同卡片收起面板', g.codexSelected === null, `codexSelected=${g.codexSelected}`);
  }

  // ---- ③④⑤ 逐个塔型：几何 / 文字 / 滚动可达 ----
  for (const type of config.TOWER_ORDER) {
    g.codexSelected = type;
    g.codexScroll = 0;
    g.codexSheetScroll = 0;

    let LL;
    rec.texts.length = 0; rec.rects.length = 0; rec.clips.length = 0; rec.ops.length = 0;
    try {
      LL = codex.getCodexLayout(g);
      codex.drawCodex(g);
    } catch (e) {
      ok(`${type} 绘制`, false, `${e.constructor.name}: ${e.message}`);
      continue;
    }

    const sheet = LL.sheet;
    const view = LL.sheetView;
    const btnTop = LL.sheetBtnTop;

    // ③ 三段几何：标题区 / 正文区 / 按钮区 不重叠、都在面板内
    const headerRect = { x: sheet.x, y: sheet.y, w: sheet.w, h: codex.CODEX_UI.sheetHeaderH };
    const btnRect = { x: sheet.x + 16, y: btnTop, w: sheet.w - 32, h: codex.CODEX_UI.sheetBtnH };
    const geoOk = view.y >= headerRect.y + headerRect.h - TOL
      && view.y + view.h <= btnTop + TOL
      && btnRect.y + btnRect.h <= sheet.y + sheet.h + TOL
      && view.h > 0;
    ok(`${type} 面板三段几何自洽`, geoOk,
      `标题底 ${(headerRect.y + headerRect.h).toFixed(0)} ≤ 正文 ${view.y.toFixed(0)}~${(view.y + view.h).toFixed(0)} ≤ 按钮顶 ${btnTop.toFixed(0)}`);

    // ④ 面板内文字的两条不变式：
    //    ④a 横向：任何文字都不许捅出它那层裁剪区的左右边界（= 面板左右边界）
    //        —— 历史 bug：固有技能说明没换行，右超 116px。
    //    ④b 纵向：只对【固定不滚动】的标题带检查"必须完整可见"；
    //        正文区是**可滚动**的，越出视口的文字本来就该被裁掉（滚一下就能看到），
    //        拿"纵向不许越界"去卡它只会得到一个永远失败、且毫无意义的断言。
    //        "纵向真的看得全"由下面的 ⑤（滚到底能否看到内容结尾）来守。
    let badH = 0, worstH = null, badV = 0, worstV = null, tested = 0, fixedBand = 0;
    for (const t of rec.texts) {
      if (!inside(t.clip, sheet, 1)) continue;      // 只查面板内部的裁剪层（格网那层不算）
      tested++;
      const c = t.clip;

      const overH = Math.max(c.x - t.x0, t.x1 - (c.x + c.w));
      if (overH > TOL) {
        badH++;
        if (!worstH || overH > worstH.over) worstH = { over: overH, t };
      }

      if (!same(c, view)) {
        fixedBand++;
        const overV = Math.max(c.y - (t.y - t.size / 2), (t.y + t.size / 2) - (c.y + c.h));
        if (overV > TOL) {
          badV++;
          if (!worstV || overV > worstV.over) worstV = { over: overV, t };
        }
      }
    }
    ok(`${type} 面板内文字不横向溢出`, badH === 0,
      badH === 0 ? `面板内 ${tested} 条文字左右都在界内`
        : `${badH}/${tested} 条横向越界，最严重 ${worstH.over.toFixed(1)}px「${worstH.t.text.slice(0, 22)}」`);
    ok(`${type} 固定标题带文字完整可见`, badV === 0,
      badV === 0 ? `标题带 ${fixedBand} 条文字纵向也在界内`
        : `${badV}/${fixedBand} 条纵向越界，最严重 ${worstV.over.toFixed(1)}px「${worstV.t.text.slice(0, 22)}」`);

    // ⑤ 滚动可达：maxScroll 必须精确等于 内容高 - 视区高
    const contentH = LL.sheetContent ? LL.sheetContent.h : 0;
    const expectMax = Math.max(0, contentH - view.h);
    ok(`${type} 面板滚动范围自洽`, Math.abs(LL.sheetMaxScroll - expectMax) < 0.5,
      `maxScroll=${LL.sheetMaxScroll.toFixed(0)} 期望=${expectMax.toFixed(0)}（内容 ${contentH.toFixed(0)} / 视区 ${view.h.toFixed(0)}）`);

    if (contentH > 0) {
      // 滚到底再画一次：内容末尾必须进入视区（否则就是"永远看不到结尾"）
      g.codexSheetScroll = LL.sheetMaxScroll;
      const L2 = codex.getCodexLayout(g);
      let lastBlockBottom = -Infinity;
      for (const b of L2.sheetContent.blocks) {
        lastBlockBottom = Math.max(lastBlockBottom, L2.sheetView.y - L2.sheetScroll + b.y + b.h);
      }
      ok(`${type} 滚到底能看到内容结尾`, lastBlockBottom <= L2.sheetView.y + L2.sheetView.h + TOL,
        `末块底 ${lastBlockBottom.toFixed(0)} ≤ 视区底 ${(L2.sheetView.y + L2.sheetView.h).toFixed(0)}`);
      g.codexSheetScroll = 0;
    }

    // ⑥ 宝石槽：5 个槽都在正文宽内；解锁数 = 图签等级；锁槽画锁
    const socks = LL.sheetContent ? LL.sheetContent.blocks.filter((b) => b.type === 'gems')[0] : null;
    if (!socks) {
      ok(`${type} 有宝石槽区块`, false, '没找到 gems 区块');
    } else {
      const cw = LL.sheetContent.contentW;
      const rects = codex.socketRects(cw);
      const inW = rects.every((r) => r.x >= -TOL && r.x + r.w <= cw + TOL);
      const lv = meta.codexLevel(type);
      const expectUnlocked = Math.min(config.GEM.maxSlots, lv);
      const gotUnlocked = socks.sockets.filter((s) => s.unlocked).length;
      ok(`${type} 宝石槽不溢出且数量正确`, inW && gotUnlocked === expectUnlocked,
        `槽宽合计 ${(rects[rects.length - 1].x + rects[rects.length - 1].w).toFixed(0)}/${cw.toFixed(0)} · 解锁 ${gotUnlocked}/${expectUnlocked}（图签 Lv.${lv}）`);
    }
  }
}

// ============================================================================
// ⑦ 宝石嵌入闭环（真实点击）—— 只跑一次（meta 是跨局单例）
// ============================================================================
log('\n===== 宝石嵌入闭环（真实点击）=====');
{
  const g = mkGame(390, 844);
  g.scene = 'codex';

  // 找一个"已解锁 + 有槽"的塔型
  const type = config.TOWER_ORDER.filter((t) => meta.isUnlocked(t))[0];
  ok('存在已解锁塔型', !!type, `type=${type} 图签 Lv.${type ? meta.codexLevel(type) : '-'}`);

  if (type) {
    const bagBefore = meta.gemList().length;
    ok('新档背包里有赠送宝石', bagBefore > 0, `背包 ${bagBefore} 颗`);

    // 把面板滚到"宝石槽完整可见"的位置，再取屏幕坐标
    g.codexSelected = type;
    let L = codex.getCodexLayout(g);
    const gemsBlock = L.sheetContent.blocks.filter((b) => b.type === 'gems')[0];
    const need = gemsBlock.y + gemsBlock.h;
    g.codexSheetScroll = Math.max(0, Math.min(L.sheetMaxScroll, need - L.sheetView.h + 4));
    L = codex.getCodexLayout(g);
    const hits = codex.getSocketHitRects(L);
    ok('槽位在视区内可命中', hits.length === codex.socketRects(L.sheetContent.contentW).length,
      `可命中槽 ${hits.length}/${config.GEM.maxSlots}（面板已滚到 ${g.codexSheetScroll.toFixed(0)}）`);

    const slot0 = hits.filter((h) => h.index === 0)[0];
    if (slot0) {
      // 点空槽 → 必须弹出选宝石浮层
      tapAt(g, slot0.rect.x + slot0.rect.w / 2, slot0.rect.y + slot0.rect.h / 2);
      ok('点空槽弹出选宝石浮层', !!g.gemPicker && g.gemPicker.index === 0,
        g.gemPicker ? `gemPicker=${JSON.stringify(g.gemPicker)}` : '未打开');

      // 点浮层里第一只"持有 > 0"的宝石行
      if (g.gemPicker) {
        const pl = codex.getGemPickerLayout(g);
        const row = pl.rows.filter((r) => r.enabled)[0];
        ok('浮层里有可选的宝石行', !!row, row ? `${row.name} ×${row.count}` : '一行都点不了');
        if (row) {
          const kind = row.kind;
          tapAt(g, row.rect.x + row.rect.w / 2, row.rect.y + row.rect.h / 2);
          const afterBag = meta.gemList().length;
          const embedded = meta.embeddedGems(type);
          ok('嵌入后宝石从背包消失', afterBag === bagBefore - 1 && embedded.indexOf(kind) >= 0,
            `背包 ${bagBefore}→${afterBag} · ${type} 已嵌 [${embedded.join(',')}]`);
          ok('嵌入后浮层自动关闭', g.gemPicker === null);

          // 加成必须能算出来（战斗口径同源）
          const bonus = gems.bonusForType(type);
          ok('宝石加成计入该塔型', bonus.count === 1, `count=${bonus.count} kinds=[${bonus.kinds.join(',')}]`);

          // 再点该槽 → 取出，回背包
          const L2 = codex.getCodexLayout(g);
          const h2 = codex.getSocketHitRects(L2).filter((h) => h.index === 0)[0];
          if (h2) {
            tapAt(g, h2.rect.x + h2.rect.w / 2, h2.rect.y + h2.rect.h / 2);
            ok('点已嵌宝石的槽可取出（回背包）',
              meta.gemList().length === bagBefore && meta.embeddedGems(type).indexOf(kind) < 0,
              `背包 ${bagBefore} · ${type} 已嵌 [${meta.embeddedGems(type).join(',')}]`);
          } else {
            ok('点已嵌宝石的槽可取出（回背包）', false, '取出时槽位不可命中');
          }
        }
      }
    } else {
      ok('槽位在视区内可命中', false, '槽 0 不可命中（面板太矮？）');
    }
  }

  // 未解锁塔：槽位全锁，点击只提示、不弹浮层
  const locked = config.TOWER_ORDER.filter((t) => !meta.isUnlocked(t))[0];
  if (locked) {
    g.codexSelected = locked;
    g.codexSheetScroll = 0;
    const L = codex.getCodexLayout(g);
    const n = codex.getSocketHitRects(L).filter((h) => h.unlocked).length;
    const hit = codex.hitCodex(g, { x: L.sheet.x + L.sheet.w / 2, y: L.sheet.y + 5 });
    ok('未解锁塔：槽位全部上锁', n === 0, `解锁槽 ${n} 个（图签 Lv.${meta.codexLevel(locked)}）`);
    ok('未解锁塔：点击不弹浮层', hit.kind !== 'socket', `hit.kind=${hit.kind}`);
  } else {
    log('  (所有塔型都已解锁，跳过"未解锁塔"用例)');
  }
}

log(`\n=== 图签汇总：${RES.length} 分辨率 × ${config.TOWER_ORDER.length} 塔型，失败 ${fails} 条 ===`);
log(`=== 判据戳：TOWER_ORDER=${config.TOWER_ORDER.length} 型 / 面板三段式(sheetHeaderH=${codex.CODEX_UI.sheetHeaderH}) / ${new Date().toISOString()} ===`);

fs.writeFileSync(path.join(__dirname, '_codex.txt'), out.join('\n'), 'utf8');
