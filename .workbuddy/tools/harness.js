/**
 * 无头校验工具链（node 专用，不依赖任何 npm 包）
 *  - makeCtx: 记录式 canvas 2D 上下文（可回放成 SVG + 几何断言）
 *  - setupGlobals: 造 wx / requestAnimationFrame / console 无害环境
 *  - toSVG: 把录制到的绘制指令回放成 SVG 字符串
 *  - decodePNG / getPixel / colProfile / rowProfile: 纯 zlib 实现的 PNG 解码与像素探针
 */
'use strict';
const fs = require('fs');
const zlib = require('zlib');

// ==================== 2x3 矩阵 ====================
const IDENT = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
function matMul(m, n) {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f,
  };
}
function matStr(m) {
  return `matrix(${m.a.toFixed(4)},${m.b.toFixed(4)},${m.c.toFixed(4)},${m.d.toFixed(4)},${m.e.toFixed(2)},${m.f.toFixed(2)})`;
}
function isIdent(m) {
  return Math.abs(m.a - 1) < 1e-6 && Math.abs(m.b) < 1e-6 && Math.abs(m.c) < 1e-6 &&
    Math.abs(m.d - 1) < 1e-6 && Math.abs(m.e) < 1e-6 && Math.abs(m.f) < 1e-6;
}

// ==================== 颜色工具 ====================
function parseColor(s) {
  if (typeof s !== 'string') return { r: 0, g: 0, b: 0, a: 1 };
  s = s.trim();
  if (s[0] === '#') {
    let h = s.slice(1);
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (h.length === 8) {
      return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: parseInt(h.slice(6, 8), 16) / 255 };
    }
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
  }
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const p = m[1].split(',').map((v) => parseFloat(v));
    return { r: p[0] | 0, g: p[1] | 0, b: p[2] | 0, a: p.length > 3 ? p[3] : 1 };
  }
  const named = { white: [255, 255, 255, 1], black: [0, 0, 0, 1], red: [255, 0, 0, 1], transparent: [0, 0, 0, 0] };
  if (named[s]) return { r: named[s][0], g: named[s][1], b: named[s][2], a: named[s][3] };
  return { r: 0, g: 0, b: 0, a: 1 };
}
function colorToHex(c) {
  const h = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return '#' + h(c.r) + h(c.g) + h(c.b);
}

// ==================== 记录式 ctx ====================
function makeCtx(canvas, rec) {
  // rec 为可变容器 {ops: []}，允许每帧清空复用（rec 也兼容直接传数组）
  const holder = Array.isArray(rec) ? { ops: rec } : (rec || { ops: [] });
  function recOps() { return holder.ops; }
  const S = {
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1,
    font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic',
    lineCap: 'butt', lineJoin: 'miter', miterLimit: 10, lineDashOffset: 0,
    globalCompositeOperation: 'source-over', shadowBlur: 0, shadowColor: '#000',
    shadowOffsetX: 0, shadowOffsetY: 0, lineDash: [], clip: null,
  };
  const ctx = {
    canvas,
    get fillStyle() { return S.fillStyle; }, set fillStyle(v) { S.fillStyle = v; },
    get strokeStyle() { return S.strokeStyle; }, set strokeStyle(v) { S.strokeStyle = v; },
    get lineWidth() { return S.lineWidth; }, set lineWidth(v) { S.lineWidth = v; },
    get globalAlpha() { return S.globalAlpha; }, set globalAlpha(v) { S.globalAlpha = v; },
    get font() { return S.font; }, set font(v) { S.font = v; },
    get textAlign() { return S.textAlign; }, set textAlign(v) { S.textAlign = v; },
    get textBaseline() { return S.textBaseline; }, set textBaseline(v) { S.textBaseline = v; },
    get lineCap() { return S.lineCap; }, set lineCap(v) { S.lineCap = v; },
    get lineJoin() { return S.lineJoin; }, set lineJoin(v) { S.lineJoin = v; },
    get miterLimit() { return S.miterLimit; }, set miterLimit(v) { S.miterLimit = v; },
    get lineDashOffset() { return S.lineDashOffset; }, set lineDashOffset(v) { S.lineDashOffset = v; },
    get globalCompositeOperation() { return S.globalCompositeOperation; }, set globalCompositeOperation(v) { S.globalCompositeOperation = v; },
    get shadowBlur() { return S.shadowBlur; }, set shadowBlur(v) { S.shadowBlur = v; },
    get shadowColor() { return S.shadowColor; }, set shadowColor(v) { S.shadowColor = v; },
    get shadowOffsetX() { return S.shadowOffsetX; }, set shadowOffsetX(v) { S.shadowOffsetX = v; },
    get shadowOffsetY() { return S.shadowOffsetY; }, set shadowOffsetY(v) { S.shadowOffsetY = v; },
  };

  let ctm = IDENT();
  const stack = [];
  let path = [];

  function push(op, args) { path.push({ op, args }); }
  function pathIsEmpty() { return path.length === 0; }

  ctx.save = function () {
    stack.push({ S: Object.assign({}, S, { lineDash: S.lineDash.slice() }), ctm: Object.assign({}, ctm) });
  };
  ctx.restore = function () {
    const st = stack.pop();
    if (!st) return;
    Object.assign(S, st.S);
    S.lineDash = st.S.lineDash.slice();
    ctm = st.ctm;
  };
  ctx.translate = function (x, y) { ctm = matMul(ctm, { a: 1, b: 0, c: 0, d: 1, e: x, f: y }); };
  ctx.scale = function (x, y) { ctm = matMul(ctm, { a: x, b: 0, c: 0, d: y, e: 0, f: 0 }); };
  ctx.rotate = function (r) { const c = Math.cos(r), s = Math.sin(r); ctm = matMul(ctm, { a: c, b: s, c: -s, d: c, e: 0, f: 0 }); };
  ctx.transform = function (a, b, c, d, e, f) { ctm = matMul(ctm, { a, b, c, d, e, f }); };
  ctx.setTransform = function (a, b, c, d, e, f) {
    if (a && typeof a === 'object') ctm = Object.assign({}, a);
    else ctm = { a, b, c, d, e, f };
  };
  ctx.resetTransform = function () { ctm = IDENT(); };
  ctx.setLineDash = function (arr) { S.lineDash = (arr || []).slice(); };
  ctx.getLineDash = function () { return S.lineDash.slice(); };

  ctx.beginPath = function () { path = []; };
  ctx.closePath = function () { if (path.length) push('Z', []); };
  ctx.moveTo = function (x, y) { push('M', [x, y]); };
  ctx.lineTo = function (x, y) { push('L', [x, y]); };
  ctx.quadraticCurveTo = function (c1x, c1y, x, y) { push('Q', [c1x, c1y, x, y]); };
  ctx.bezierCurveTo = function (c1x, c1y, c2x, c2y, x, y) { push('C', [c1x, c1y, c2x, c2y, x, y]); };
  ctx.rect = function (x, y, w, h) {
    push('M', [x, y]); push('L', [x + w, y]); push('L', [x + w, y + h]); push('L', [x, y + h]); push('Z', []);
  };
  function sampleArc(cx, cy, rx, ry, rot, sa, ea, ccw) {
    let span = ea - sa;
    if (ccw) { while (span > 0) span -= Math.PI * 2; } else { while (span < 0) span += Math.PI * 2; }
    const n = Math.max(8, Math.ceil(Math.abs(span) / (Math.PI / 24)));
    const cosR = Math.cos(rot), sinR = Math.sin(rot);
    for (let i = 0; i <= n; i++) {
      const t = sa + span * (i / n);
      const px = rx * Math.cos(t), py = ry * Math.sin(t);
      const X = cx + px * cosR - py * sinR;
      const Y = cy + px * sinR + py * cosR;
      if (path.length === 0 && i === 0) push('M', [X, Y]);
      else push('L', [X, Y]);
    }
  }
  ctx.arc = function (cx, cy, r, sa, ea, ccw) { sampleArc(cx, cy, r, r, 0, sa, ea, !!ccw); };
  ctx.ellipse = function (cx, cy, rx, ry, rot, sa, ea, ccw) { sampleArc(cx, cy, rx, ry, rot || 0, sa, ea, !!ccw); };
  ctx.arcTo = function (x1, y1, x2, y2) {
    // 圆角近似：到切点直线 + 二次曲线过渡
    if (pathIsEmpty()) push('M', [x1, y1]);
    else push('L', [x1, y1]);
    push('Q', [x1, y1, x2, y2]);
  };
  ctx.roundRect = function (x, y, w, h, r) {
    if (typeof r === 'object' && r) r = Array.isArray(r) ? r[0] : (r.topLeft || 0);
    const rr = Math.min(r || 0, Math.abs(w) / 2, Math.abs(h) / 2) || 0;
    const k = 0.5523;
    push('M', [x + rr, y]);
    push('L', [x + w - rr, y]);
    if (rr) push('C', [x + w - rr + rr * k, y, x + w, y + rr - rr * k, x + w, y + rr]);
    push('L', [x + w, y + h - rr]);
    if (rr) push('C', [x + w, y + h - rr + rr * k, x + w - rr + rr * k, y + h, x + w - rr, y + h]);
    push('L', [x + rr, y + h]);
    if (rr) push('C', [x + rr - rr * k, y + h, x, y + h - rr + rr * k, x, y + h - rr]);
    push('L', [x, y + rr]);
    if (rr) push('C', [x, y + rr - rr * k, x + rr - rr * k, y, x + rr, y]);
    push('Z', []);
  };

  function pathD() {
    let d = '';
    for (const c of path) {
      if (c.op === 'M') d += `M${c.args[0].toFixed(2)} ${c.args[1].toFixed(2)}`;
      else if (c.op === 'L') d += `L${c.args[0].toFixed(2)} ${c.args[1].toFixed(2)}`;
      else if (c.op === 'Q') d += `Q${c.args[0].toFixed(2)} ${c.args[1].toFixed(2)} ${c.args[2].toFixed(2)} ${c.args[3].toFixed(2)}`;
      else if (c.op === 'C') d += `C${c.args[0].toFixed(2)} ${c.args[1].toFixed(2)} ${c.args[2].toFixed(2)} ${c.args[3].toFixed(2)} ${c.args[4].toFixed(2)} ${c.args[5].toFixed(2)}`;
      else if (c.op === 'Z') d += 'Z';
    }
    // 若首指令是 L，补成 M（canvas 里这是隐式起点）
    if (d[0] === 'L') d = 'M' + d.slice(1);
    return d;
  }

  function styleColor(v) {
    if (v && typeof v === 'object' && v.__grad) {
      const stops = v.stops.slice().sort((a, b) => a.o - b.o);
      if (!stops.length) return { hex: '#888888', alpha: 1 };
      const mid = stops[Math.floor(stops.length / 2)];
      const c = parseColor(mid.c);
      return { hex: colorToHex(c), alpha: c.a };
    }
    const c = parseColor(v);
    return { hex: colorToHex(c), alpha: c.a };
  }

  function emit(kind) {
    const r = recOps();
    if (!r) { path = []; return; }
    if (!path.length) return;
    const d = pathD();
    path = [];
    if (!d) return;
    const st = kind === 'fill' ? styleColor(S.fillStyle) : styleColor(S.strokeStyle);
    const op = {
      kind, d, ctm: Object.assign({}, ctm),
      color: st.hex,
      alpha: Math.max(0, Math.min(1, S.globalAlpha)) * st.alpha,
      lw: S.lineWidth, dash: S.lineDash.slice(), cap: S.lineCap, join: S.lineJoin,
      clip: S.clip,
    };
    r.push(op);
  }
  ctx.fill = function () { emit('fill'); };
  ctx.stroke = function () { emit('stroke'); };
  ctx.clip = function () {
    // 注意：真实 canvas 的 clip() 不会重置当前路径（项目里存在 "clip() 后紧接着 fill() 同一路径" 的写法），
    // 因此这里必须保留 path，否则会把那一层填充整个丢掉。
    const d = pathD();
    S.clip = { d, ctm: Object.assign({}, ctm) };
  };

  ctx.fillRect = function (x, y, w, h) {
    ctx.beginPath(); ctx.rect(x, y, w, h); emit('fill');
  };
  ctx.strokeRect = function (x, y, w, h) {
    ctx.beginPath(); ctx.rect(x, y, w, h); emit('stroke');
  };
  ctx.clearRect = function () { /* 记录器忽略清屏 */ };

  // 渐变
  function makeGrad(type, args) {
    const g = { __grad: true, type, args, stops: [] };
    g.addColorStop = function (o, c) { g.stops.push({ o, c }); };
    return g;
  }
  ctx.createLinearGradient = function (x0, y0, x1, y1) { return makeGrad('linear', [x0, y0, x1, y1]); };
  ctx.createRadialGradient = function (x0, y0, r0, x1, y1, r1) { return makeGrad('radial', [x0, y0, r0, x1, y1, r1]); };
  ctx.createPattern = function () { return { __grad: true, stops: [{ o: 0, c: '#888888' }] }; };

  function fontSize() {
    const m = /(\d+(?:\.\d+)?)px/.exec(S.font || '');
    return m ? parseFloat(m[1]) : 10;
  }
  ctx.fontSize = fontSize;
  ctx.measureText = function (t) {
    const fs2 = fontSize();
    // 中日韩字符按 1.0em、其余按 0.55em 估算；加粗再放 4%
    let w = 0;
    for (const ch of String(t)) w += /[\u2E80-\u9FFF\uFF00-\uFFEF]/.test(ch) ? fs2 : fs2 * 0.55;
    if (/bold/i.test(S.font)) w *= 1.04;
    return { width: w, actualBoundingBoxAscent: fs2 * 0.8, actualBoundingBoxDescent: fs2 * 0.2 };
  };
  ctx.fillText = function (t, x, y) {
    const r = recOps();
    if (r) {
      r.push({
        kind: 'text', text: String(t), x, y, ctm: Object.assign({}, ctm),
        color: styleColor(S.fillStyle).hex, alpha: S.globalAlpha,
        font: S.font, fs: fontSize(), align: S.textAlign, baseline: S.textBaseline,
        w: ctx.measureText(t).width, clip: S.clip,
      });
    }
  };
  ctx.strokeText = function () { /* 项目未使用 */ };
  ctx.drawImage = function () { /* 项目未使用 */ };
  ctx.getImageData = function () { return { width: 0, height: 0, data: new Uint8ClampedArray(0) }; };
  ctx.putImageData = function () {};
  ctx.isPointInPath = function () { return false; };

  return ctx;
}

// ==================== SVG 回放 ====================
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function toSVG(rec, W, H, bg) {
  const defs = [];
  const body = [];
  const clips = [];
  let clipN = 0;
  function clipRef(clip) {
    if (!clip) return null;
    const key = clip.d + '|' + matStr(clip.ctm);
    let idx = clips.findIndex((c) => c.key === key);
    if (idx < 0) {
      clipN++;
      defs.push(`<clipPath id="c${clipN}"><path d="${clip.d}" transform="${matStr(clip.ctm)}"/></clipPath>`);
      clips.push({ key, id: 'c' + clipN });
      idx = clips.length - 1;
    }
    return clips[idx].id;
  }
  for (const op of rec) {
    const tr = isIdent(op.ctm) ? '' : ` transform="${matStr(op.ctm)}"`;
    const cid = clipRef(op.clip);
    const wrapOpen = cid ? `<g clip-path="url(#${cid})">` : '';
    const wrapClose = cid ? '</g>' : '';
    if (op.kind === 'text') {
      const anchor = op.align === 'center' ? 'middle' : op.align === 'right' ? 'end' : 'start';
      const base = op.baseline === 'middle' ? 'central' : op.baseline === 'top' ? 'hanging' : 'alphabetic';
      const weight = /bold/i.test(op.font) ? 'bold' : 'normal';
      body.push(`${wrapOpen}<text${tr} x="${op.x.toFixed(2)}" y="${op.y.toFixed(2)}" fill="${op.color}" fill-opacity="${op.alpha.toFixed(3)}" font-size="${op.fs.toFixed(2)}" font-family="sans-serif" font-weight="${weight}" text-anchor="${anchor}" dominant-baseline="${base}">${esc(op.text)}</text>${wrapClose}`);
    } else {
      const dash = op.dash && op.dash.length ? ` stroke-dasharray="${op.dash.join(' ')}"` : '';
      const strokeAttr = op.kind === 'stroke'
        ? `fill="none" stroke="${op.color}" stroke-opacity="${op.alpha.toFixed(3)}" stroke-width="${op.lw}" stroke-linecap="${op.cap}" stroke-linejoin="${op.join}"${dash}`
        : `fill="${op.color}" fill-opacity="${op.alpha.toFixed(3)}"`;

// wrap in <defs>? no —占位
      void dash;
      body.push(`${wrapOpen}<path${tr} d="${op.d}" ${strokeAttr}/>${wrapClose}`);
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">\n<rect width="${W}" height="${H}" fill="${bg || '#0d1117'}"/>\n<defs>${defs.join('')}</defs>\n${body.join('\n')}\n</svg>`;
}

// ==================== PNG 解码（纯 zlib） ====================
function decodePNG(buf) {
  let p = 8, width = 0, height = 0, bitDepth = 8, colorType = 6;
  const idat = [];
  while (p + 8 <= buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.slice(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (bitDepth !== 8) throw new Error('unsupported bitDepth ' + bitDepth);
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 4;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const line = raw.slice(pos, pos + stride); pos += stride;
    const o = y * stride, po = (y - 1) * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[o + x - channels] : 0;
      const b = y > 0 ? out[po + x] : 0;
      const c = (x >= channels && y > 0) ? out[po + x - channels] : 0;
      let v = line[x];
      if (filter === 1) v = (v + a) & 255;
      else if (filter === 2) v = (v + b) & 255;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
      out[o + x] = v;
    }
  }
  return {
    width, height, channels, data: out,
    px(x, y) {
      if (x < 0 || y < 0 || x >= width || y >= height) return [0, 0, 0, 0];
      const i = y * width * channels + x * channels;
      if (channels === 4) return [out[i], out[i + 1], out[i + 2], out[i + 3]];
      if (channels === 3) return [out[i], out[i + 1], out[i + 2], 255];
      return [out[i], out[i], out[i], 255];
    },
  };
}
function lum(px) { return 0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2]; }
// 横向剖面：返回每行"亮像素数"（亮 = 与背景差异明显）
function rowProfile(img, box, thr) {
  const rows = [];
  for (let y = box.y; y < box.y + box.h; y++) {
    let n = 0;
    for (let x = box.x; x < box.x + box.w; x++) if (lum(img.px(x, y)) > (thr || 90)) n++;
    rows.push(n);
  }
  return rows;
}
function colProfile(img, box, thr) {
  const cols = [];
  for (let x = box.x; x < box.x + box.w; x++) {
    let n = 0;
    for (let y = box.y; y < box.y + box.h; y++) if (lum(img.px(x, y)) > (thr || 90)) n++;
    cols.push(n);
  }
  return cols;
}

// ==================== 全局环境 ====================
function setupGlobals(W, H) {
  const canvas = {
    width: W, height: H,
    getContext() { return this.__ctx; },
  };
  const rafQueue = [];
  global.requestAnimationFrame = function (cb) { rafQueue.push(cb); return rafQueue.length; };
  global.cancelAnimationFrame = function () {};
  const listeners = {};
  global.wx = {
    createCanvas: () => canvas,
    getWindowInfo: () => ({ screenWidth: W, screenHeight: H, pixelRatio: 2, safeArea: { top: 20, bottom: H - 10, left: 0, right: W, width: W, height: H - 30 } }),
    getSystemInfoSync: () => ({ screenWidth: W, screenHeight: H, pixelRatio: 2 }),
    ready: () => {},
    onTouchStart: (cb) => { listeners.start = cb; },
    onTouchMove: (cb) => { listeners.move = cb; },
    onTouchEnd: (cb) => { listeners.end = cb; },
    onTouchCancel: (cb) => { listeners.cancel = cb; },
    createInnerAudioContext: () => ({ play() {}, stop() {}, destroy() {}, seek() {}, onEnded() {} }),
    vibrateShort: () => {},
    setKeepScreenOn: () => {},
  };
  return { canvas, rafQueue, listeners };
}

module.exports = {
  makeCtx, setupGlobals, toSVG, decodePNG, rowProfile, colProfile,
  matMul, matStr, parseColor, IDENT,
};
