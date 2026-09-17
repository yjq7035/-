// ============================================================================
// SVG 回放器 —— .workbuddy/tmp/svgctx.js
// ----------------------------------------------------------------------------
// 把 canvas 2D 的 draw 调用录成 SVG 字符串（用于肉眼核对面板版式）。
// 照抄技能里的踩坑清单：
//   · 绝不能写 fillStyle="..." 这种非法属性（SVG 会静默回退成黑色填充）；
//   · 渐变 id 用【文档级计数器】，多个录制器共用才不会撞号；
//   · clip() 只设置裁剪区、不清空 path；beginPath() 才是唯一的清空点；
//   · save/restore 要连字体状态与"当前裁剪组"一起存。
// ============================================================================
const fs = require('fs');

let GLOBAL_ID = 0;
function nextId(prefix) { return `${prefix}${++GLOBAL_ID}`; }

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fontFamily(font) {
  const m = /(\d+(?:\.\d+)?)px\s+(.+)$/.exec(String(font || ''));
  return m ? m[2].trim() : 'Arial';
}
function fontPx(font) {
  const m = /(\d+(?:\.\d+)?)px/.exec(String(font || ''));
  return m ? parseFloat(m[1]) : 10;
}
function fontBold(font) { return /bold/i.test(String(font || '')) ? ' font-weight="bold"' : ''; }

function createSvgCtx(W, H, bg) {
  const defs = [];
  const grads = [];
  const body = [];
  const stack = [];
  let depth = 0;
  const openedAt = { 0: 0 };
  let path = [];
  let idn = 0;

  const state = {
    font: '12px Arial', textAlign: 'left', textBaseline: 'alphabetic',
    fillStyle: '#fff', strokeStyle: '#fff', lineWidth: 1, globalAlpha: 1,
  };

  function num(n) { return (Math.round(n * 100) / 100).toString(); }

  function pathD(p) {
    const o = [];
    for (const seg of p) {
      switch (seg[0]) {
        case 'move': o.push(`M ${num(seg[1])} ${num(seg[2])}`); break;
        case 'line': o.push(`L ${num(seg[1])} ${num(seg[2])}`); break;
        case 'q': o.push(`Q ${num(seg[1])} ${num(seg[2])} ${num(seg[3])} ${num(seg[4])}`); break;
        case 'b': o.push(`C ${num(seg[1])} ${num(seg[2])} ${num(seg[3])} ${num(seg[4])} ${num(seg[5])} ${num(seg[6])}`); break;
        case 'arc': {
          const [x, y, r] = [seg[1], seg[2], seg[3]];
          o.push(`M ${num(x - r)} ${num(y)} A ${num(r)} ${num(r)} 0 1 0 ${num(x + r)} ${num(y)} A ${num(r)} ${num(r)} 0 1 0 ${num(x - r)} ${num(y)} Z`);
          break;
        }
        case 'ellipse': {
          const [x, y, rx, ry] = [seg[1], seg[2], seg[3], seg[4]];
          o.push(`M ${num(x - rx)} ${num(y)} A ${num(rx)} ${num(ry)} 0 1 0 ${num(x + rx)} ${num(y)} A ${num(rx)} ${num(ry)} 0 1 0 ${num(x - rx)} ${num(y)} Z`);
          break;
        }
        case 'rect':
          o.push(`M ${num(seg[1])} ${num(seg[2])} H ${num(seg[1] + seg[3])} V ${num(seg[2] + seg[4])} H ${num(seg[1])} Z`);
          break;
        case 'rrect': {
          const [x, y, w, h] = [seg[1], seg[2], seg[3], seg[4]];
          const r = Math.max(0, Math.min(Math.abs(seg[5]) || 0, Math.min(Math.abs(w) / 2, Math.abs(h) / 2)));
          if (r <= 0) { o.push(`M ${num(x)} ${num(y)} H ${num(x + w)} V ${num(y + h)} H ${num(x)} Z`); break; }
          o.push(`M ${num(x + r)} ${num(y)} H ${num(x + w - r)} A ${num(r)} ${num(r)} 0 0 1 ${num(x + w)} ${num(y + r)}`
            + ` V ${num(y + h - r)} A ${num(r)} ${num(r)} 0 0 1 ${num(x + w - r)} ${num(y + h)}`
            + ` H ${num(x + r)} A ${num(r)} ${num(r)} 0 0 1 ${num(x)} ${num(y + h - r)}`
            + ` V ${num(y + r)} A ${num(r)} ${num(r)} 0 0 1 ${num(x + r)} ${num(y)} Z`);
          break;
        }
        case 'close': o.push('Z'); break;
        default: break;
      }
    }
    return o.join(' ');
  }

  function paintOf(v, fallback) {
    if (v && typeof v === 'object' && v.__grad) return `url(#${v.__id})`;
    return typeof v === 'string' ? v : fallback;
  }

  function closeGroupsAtDepth(d) {
    const n = openedAt[d] || 0;
    for (let i = 0; i < n; i++) body.push('</g>');
    openedAt[d] = 0;
  }

  const ctx = {
    get font() { return state.font; }, set font(v) { state.font = v; },
    get textAlign() { return state.textAlign; }, set textAlign(v) { state.textAlign = v; },
    get textBaseline() { return state.textBaseline; }, set textBaseline(v) { state.textBaseline = v; },
    get fillStyle() { return state.fillStyle; }, set fillStyle(v) { state.fillStyle = v; },
    get strokeStyle() { return state.strokeStyle; }, set strokeStyle(v) { state.strokeStyle = v; },
    get lineWidth() { return state.lineWidth; }, set lineWidth(v) { state.lineWidth = v; },
    get globalAlpha() { return state.globalAlpha; }, set globalAlpha(v) { state.globalAlpha = v; },
    shadowBlur: 0, shadowColor: '', lineCap: '', lineJoin: '', globalCompositeOperation: '', lineDashOffset: 0,

    save() { stack.push({ s: { ...state } }); depth++; openedAt[depth] = 0; },
    restore() { closeGroupsAtDepth(depth); openedAt[depth] = 0; depth = Math.max(0, depth - 1); const e = stack.pop(); if (e) Object.assign(state, e.s); },

    beginPath() { path = []; },
    closePath() { path.push(['close']); },
    moveTo(x, y) { path.push(['move', x, y]); },
    lineTo(x, y) { path.push(['line', x, y]); },
    quadraticCurveTo(a, b, c, d) { path.push(['q', a, b, c, d]); },
    bezierCurveTo(a, b, c, d, e, f) { path.push(['b', a, b, c, d, e, f]); },
    arc(x, y, r) { path.push(['arc', x, y, r]); },
    ellipse(x, y, rx, ry) { path.push(['ellipse', x, y, rx, ry]); },
    rect(x, y, w, h) { path.push(['rect', x, y, w, h]); },
    roundRect(x, y, w, h, r) { path.push(['rrect', x, y, w, h, typeof r === 'number' ? r : (r && r[0]) || 0]); },

    fill() { if (path.length) body.push(`<path d="${pathD(path)}" fill="${paintOf(state.fillStyle, '#888')}" fill-rule="evenodd"/>`); },
    stroke() { if (path.length) body.push(`<path d="${pathD(path)}" fill="none" stroke="${paintOf(state.strokeStyle, '#888')}" stroke-width="${num(state.lineWidth)}"/>`); },

    clip() {
      if (!path.length) return;
      const id = nextId('clip');
      defs.push(`<clipPath id="${id}"><path d="${pathD(path)}"/></clipPath>`);
      body.push(`<g clip-path="url(#${id})">`);
      openedAt[depth] = (openedAt[depth] || 0) + 1;
    },

    measureText(t) {
      const size = fontPx(state.font);
      let w = 0;
      for (const ch of String(t)) w += /[\u2e80-\u9fff\u3000-\u303f\uff00-\uffef\u2605\u25cf]/.test(ch) ? size : size * 0.55;
      return { width: w };
    },
    fillText(text, x, y) {
      const anchor = state.textAlign === 'center' ? 'middle' : (state.textAlign === 'right' || state.textAlign === 'end' ? 'end' : 'start');
      const db = state.textBaseline === 'middle' ? ' dominant-baseline="middle"' : (state.textBaseline === 'bottom' ? ' dominant-baseline="text-after-edge"' : '');
      body.push(`<text x="${num(x)}" y="${num(y)}" font-size="${num(fontPx(state.font))}" font-family="${esc(fontFamily(state.font))}"${fontBold(state.font)} fill="${paintOf(state.fillStyle, '#fff')}" text-anchor="${anchor}"${db}>${esc(text)}</text>`);
    },
    strokeText() {},
    setLineDash() {}, getLineDash() { return []; },
    fillRect(x, y, w, h) { body.push(`<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" fill="${paintOf(state.fillStyle, '#000')}"/>`); },
    clearRect() {},
    strokeRect(x, y, w, h) { body.push(`<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" fill="none" stroke="${paintOf(state.strokeStyle, '#888')}" stroke-width="${num(state.lineWidth)}"/>`); },

    createLinearGradient(x0, y0, x1, y1) {
      const id = nextId('grad');
      // ⚠️ 不能在这里就把 defs 拼好：addColorStop 是返回之后才调的，
      //    必须把渐变对象登记起来，等 toSVG() 时（stops 已收集完）再生成定义。
      const g = { __grad: true, __id: id, kind: 'linear', x0, y0, x1, y1, stops: [], addColorStop(o, c) { this.stops.push([o, c]); } };
      grads.push(g);
      return g;
    },
    createRadialGradient(x0, y0, r0, x1, y1, r1) {
      const id = nextId('rgrad');
      const g = { __grad: true, __id: id, kind: 'radial', x1, y1, r1, stops: [], addColorStop(o, c) { this.stops.push([o, c]); } };
      grads.push(g);
      return g;
    },
    createPattern() { return null; },

    scale() {}, translate() {}, rotate() {}, transform() {}, setTransform() {}, resetTransform() {},

    toSVG() {
      while (depth > 0) { closeGroupsAtDepth(depth); depth--; }
      closeGroupsAtDepth(0);
      const gradDefs = grads.map((g) => {
        const stops = g.stops.map(([o, c]) => `<stop offset="${num(o)}" stop-color="${esc(c)}"/>`).join('');
        return g.kind === 'linear'
          ? `<linearGradient id="${g.__id}" gradientUnits="userSpaceOnUse" x1="${num(g.x0)}" y1="${num(g.y0)}" x2="${num(g.x1)}" y2="${num(g.y1)}">${stops}</linearGradient>`
          : `<radialGradient id="${g.__id}" gradientUnits="userSpaceOnUse" cx="${num(g.x1)}" cy="${num(g.y1)}" r="${num(g.r1)}">${stops}</radialGradient>`;
      }).join('');
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
        + `<defs>${defs.join('')}${gradDefs}</defs>`
        + `<rect x="0" y="0" width="${W}" height="${H}" fill="${bg || '#0d1017'}"/>`
        + body.join('')
        + '</svg>';
    },
    _dump() { return { defs, body }; },
  };
  return ctx;
}

module.exports = { createSvgCtx };
