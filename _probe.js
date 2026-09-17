// 临时探针：验证 codex.js 的布局/命中链路是否可用（用完即删）
const fs = require('fs');
const out = [];

function mockCtx() {
  return {
    save() {}, restore() {}, beginPath() {}, rect() {}, clip() {},
    moveTo() {}, lineTo() {}, closePath() {}, fill() {}, stroke() {},
    fillRect() {}, clearRect() {}, arc() {}, quadraticCurveTo() {}, bezierCurveTo() {},
    createLinearGradient() { return { addColorStop() {} }; },
    createRadialGradient() { return { addColorStop() {} }; },
    fillText() {}, strokeText() {}, setLineDash() {},
    measureText(t) { return { width: String(t).length * 6 }; },
    font: '', fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1,
    textAlign: '', textBaseline: '', shadowBlur: 0, shadowColor: '', lineCap: '',
    globalCompositeOperation: '',
  };
}

function mkGame(sel) {
  return {
    W: 375, H: 667,
    ctx: mockCtx(),
    codexSelected: sel || null,
    codexScroll: 0,
  };
}

const codex = require('./src/codex');
out.push('module loaded OK');

// 1) 无选中状态下计算布局（纯网格）
try {
  const L = codex.getCodexLayout(mkGame(null));
  out.push('[1] layout(no sel) OK rows=' + L.rows + ' sheetY=' + L.sheet.y + ' sheetH=' + L.sheet.h);
} catch (e) {
  out.push('[1] layout(no sel) THREW: ' + e.constructor.name + ' :: ' + e.message);
}

// 2) 选中状态下计算布局（走描述换行 + sheetH 路径）
try {
  const L = codex.getCodexLayout(mkGame('arrow'));
  out.push('[2] layout(sel) OK sheetH=' + L.sheet.h + ' sheetY=' + L.sheet.y);
} catch (e) {
  out.push('[2] layout(sel) THREW: ' + e.constructor.name + ' :: ' + e.message);
}

// 3) 命中检测（模拟点击第一张卡）
try {
  const g = mkGame(null);
  const r = codex.hitCodex(g, { x: 60, y: 200 });
  out.push('[3] hitCodex OK -> ' + JSON.stringify(r));
} catch (e) {
  out.push('[3] hitCodex THREW: ' + e.constructor.name + ' :: ' + e.message);
}

// 4) 完整绘制
try {
  const g = mkGame('arrow');
  codex.drawCodex(g);
  out.push('[4] drawCodex(sel) OK');
} catch (e) {
  out.push('[4] drawCodex(sel) THREW: ' + e.constructor.name + ' :: ' + e.message);
}

fs.writeFileSync('_probe.txt', out.join('\n'), 'utf8');
