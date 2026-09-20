// ============================================================================
// 录制式 canvas ctx（无头验证用）—— .workbuddy/tmp/harness.js
// ----------------------------------------------------------------------------
// 目标：把 draw 阶段的每次 fillText / roundRect / clip 连"当时的 font / textAlign /
//       textBaseline"一起记下来，用于做几何断言（文字是否越界、是否重叠）。
// 注意（照抄技能里的踩坑清单）：
//   · clip() 只设置裁剪区，**不清空当前 path**（真实 canvas 就是这样）；
//   · save/restore 必须连字体状态一起存；
//   · measureText 用 CJK 感知宽度表，别用 t.length*6 那种假数据。
// ============================================================================

const CJK = /[\u2e80-\u9fff\u3000-\u303f\uff00-\uffef\u2605\u25cf\u2728\u{1F300}-\u{1FAFF}]/u;

// ----------------------------------------------------------------------------
// 颜色校验：照**真平台**行为，而不是"宽容通过"。
// 事故背景（2026-09）：真实 canvas 的 addColorStop 遇到解析不出来的颜色会
//   抛 SyntaxError: The value provided ('undefined') could not be parsed as a color。
// 而这里原先写成空函数 addColorStop(){}，于是"某座塔的 TOWER_DEFS.color 没登记"
// 这种数据错误在 10 套无头回归里一路绿灯，却在模拟器里每帧炸一次。
// 结论：mock 太宽容 = 假绿。凡是"真平台会抛错"的，mock 必须跟着抛。
// ----------------------------------------------------------------------------
const COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|[a-z]{3,})$/i;

function assertColor(c) {
  if (typeof c !== 'string' || !COLOR_RE.test(c)) {
    throw new SyntaxError(
      `Failed to execute 'addColorStop' on 'CanvasGradient': The value provided ('${c}') could not be parsed as a color.`);
  }
  const m = /^rgba?\(([^)]*)\)$/i.exec(c);
  if (m) {
    const nums = m[1].split(',').map((s) => Number(s.trim()));
    // rgba(NaN, NaN, NaN, 1) 在真平台上同样解析失败（常见于 shade(color, undefined)）
    if (!nums.length || nums.some((n) => !isFinite(n))) {
      throw new SyntaxError(
        `Failed to execute 'addColorStop' on 'CanvasGradient': 颜色分量不是有限数字（'${c}'）`);
    }
  }
}

/** 渐变几何参数必须有限（真平台对 NaN/Infinity 会抛 NotSupportedError） */
function assertFinite(args, what) {
  for (const v of args) {
    if (typeof v !== 'number' || !isFinite(v)) {
      throw new Error(`${what}: 参数必须是有限数字，收到 ${v}`);
    }
  }
}

function makeGradient(kind, args) {
  return {
    __grad: true, kind,
    addColorStop(offset, color) {
      assertColor(color);
      if (typeof offset !== 'number' || !isFinite(offset)) {
        throw new SyntaxError(`Failed to execute 'addColorStop' on 'CanvasGradient': 偏移量非法（${offset}）`);
      }
    },
  };
}

function fontPx(font) {
  const m = /(\d+(?:\.\d+)?)px/.exec(String(font || ''));
  return m ? parseFloat(m[1]) : 10;
}

function textWidth(text, font) {
  const size = fontPx(font);
  let w = 0;
  for (const ch of String(text)) w += CJK.test(ch) ? size : size * 0.55;
  return w;
}

/**
 * 造一个录制式 ctx。
 * @param {object} rec 记录容器：{ texts:[], rects:[], clips:[], ops:[] }
 */
function makeCtx(rec) {
  let state = {
    font: '10px Arial',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    globalAlpha: 1,
  };
  const stack = [];
  let path = [];
  let clip = null;
  const ctx = {
    // ---- 状态 ----
    get font() { return state.font; },
    set font(v) { state.font = v; },
    get textAlign() { return state.textAlign; },
    set textAlign(v) { state.textAlign = v; },
    get textBaseline() { return state.textBaseline; },
    set textBaseline(v) { state.textBaseline = v; },
    get fillStyle() { return state.fillStyle; },
    set fillStyle(v) { state.fillStyle = v; },
    get strokeStyle() { return state.strokeStyle; },
    set strokeStyle(v) { state.strokeStyle = v; },
    get lineWidth() { return state.lineWidth; },
    set lineWidth(v) { state.lineWidth = v; },
    get globalAlpha() { return state.globalAlpha; },
    set globalAlpha(v) { state.globalAlpha = v; },
    shadowBlur: 0, shadowColor: '', lineCap: '', lineJoin: '', globalCompositeOperation: '',
    lineDashOffset: 0,

    save() { stack.push({ state: { ...state }, clip }); rec.ops.push(['save']); },
    restore() { const s = stack.pop(); if (s) { state = s.state; clip = s.clip; } rec.ops.push(['restore']); },

    // ---- 路径 ----
    beginPath() { path = []; },
    closePath() { path.push(['close']); },
    moveTo(x, y) { path.push(['move', x, y]); },
    lineTo(x, y) { path.push(['line', x, y]); },
    quadraticCurveTo(cx, cy, x, y) { path.push(['q', cx, cy, x, y]); },
    bezierCurveTo(a, b, c, d, x, y) { path.push(['b', a, b, c, d, x, y]); },
    arc(x, y, r, a0, a1) { path.push(['arc', x, y, r, a0, a1]); },
    ellipse(x, y, rx, ry) { path.push(['ellipse', x, y, rx, ry]); },
    rect(x, y, w, h) { path.push(['rect', x, y, w, h]); },
    roundRect(x, y, w, h, r) {
      path.push(['rrect', x, y, w, h, r]);
      rec.rects.push({ x, y, w, h, r, kind: 'roundRect' });
    },

    fill() { rec.ops.push(['fill', bounds(path)]); },
    stroke() { rec.ops.push(['stroke', bounds(path)]); },

    // clip 只记录裁剪路径，**不动 path**（真实 canvas 的语义）
    clip() {
      const b = bounds(path);
      if (b) clip = b;
      rec.clips.push(b);
      rec.ops.push(['clip', b]);
    },

    // ---- 文本 ----
    measureText(t) { return { width: textWidth(t, state.font) }; },
    fillText(text, x, y) {
      const w = textWidth(text, state.font);
      let x0 = x;
      if (state.textAlign === 'center') x0 = x - w / 2;
      else if (state.textAlign === 'right') x0 = x - w;
      else if (state.textAlign === 'end') x0 = x - w;
      rec.texts.push({
        text: String(text), x, y, w, x0, x1: x0 + w,
        font: state.font, size: fontPx(state.font),
        align: state.textAlign, baseline: state.textBaseline,
        fill: state.fillStyle, lineHeight: fontPx(state.font) * 1.2,
        clip: clip ? { ...clip } : null,   // 绘制当时生效的裁剪区（可能为 null）
      });
    },
    strokeText() {},
    setLineDash() {}, getLineDash() { return []; },

    // ---- 矩形/图形 ----
    fillRect(x, y, w, h) { rec.ops.push(['fillRect', { x, y, w, h }]); },
    clearRect() {},
    strokeRect(x, y, w, h) { rec.ops.push(['strokeRect', { x, y, w, h }]); },

    // ---- 渐变 ----
    createLinearGradient(x0, y0, x1, y1) {
      assertFinite([x0, y0, x1, y1], 'createLinearGradient');
      return makeGradient('linear', [x0, y0, x1, y1]);
    },
    createRadialGradient(x0, y0, r0, x1, y1, r1) {
      assertFinite([x0, y0, r0, x1, y1, r1], 'createRadialGradient');
      if (r0 < 0 || r1 < 0) throw new Error(`createRadialGradient: 半径不能为负（${r0}, ${r1}）`);
      return makeGradient('radial', [x0, y0, r0, x1, y1, r1]);
    },
    createPattern() { return null; },

    // ---- 变换 ----
    scale() {}, translate() {}, rotate() {}, transform() {}, setTransform() {}, resetTransform() {},
  };
  return ctx;
}

function bounds(path) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const acc = (x, y) => {
    if (!isFinite(x) || !isFinite(y)) return;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  };
  for (const p of path) {
    switch (p[0]) {
      case 'move': case 'line': acc(p[1], p[2]); break;
      case 'q': acc(p[1], p[2]); acc(p[3], p[4]); break;
      case 'b': acc(p[1], p[2]); acc(p[3], p[4]); acc(p[5], p[6]); break;
      case 'rect': case 'rrect': acc(p[1], p[2]); acc(p[1] + p[3], p[2] + p[4]); break;
      case 'arc': case 'ellipse': acc(p[1] - p[3], p[2] - p[4]); acc(p[1] + p[3], p[2] + p[4]); break;
      default: break;
    }
  }
  if (!isFinite(minX)) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** 造一个干净记录容器 */
function makeRec() { return { texts: [], rects: [], clips: [], ops: [] }; }

// ---------------------------------------------------------------------------
// 两种"能从录制结果里认出来"的图形（探针与出图工具共用，别各写一份）
// ---------------------------------------------------------------------------

/**
 * 塔属性面板里的【宝石卡】矩形。
 * 判据：满内容宽 + 高 = PANEL_UI.gemRowH。
 * ⚠️ 每张卡会被记两条（roundRectPath 先给 fill 用一次、再给 stroke 用一次）→ 按几何去重，
 *    否则"相邻卡间距"会量到 -40 那种自己跟自己的差值。
 * @param {object} rec makeRec() 的产物
 * @param {number} rowH renderer.PANEL_UI.gemRowH
 */
function gemCards(rec, rowH) {
  const seen = {};
  return rec.rects
    .filter((r) => r.w > 100 && Math.abs(r.h - rowH) < 0.01)
    .filter((r) => { const k = `${r.x},${r.y},${r.w},${r.h}`; if (seen[k]) return false; seen[k] = 1; return true; })
    .sort((a, b) => a.y - b.y);
}

/**
 * 面板里的【切割分隔线】位置。线是梭形（drawTaperedDivider 中心 ±2.5），bounds 取外接盒
 * → 得到一条 w≈内容宽、h=5 的 fill；其 y 是线的**上沿**。
 */
function dividerLines(rec) {
  return rec.ops
    .filter((o) => o[0] === 'fill' && o[1] && o[1].w > 100 && o[1].h > 0 && o[1].h <= 8)
    .map((o) => o[1]);
}

module.exports = { makeCtx, makeRec, textWidth, fontPx, gemCards, dividerLines };
