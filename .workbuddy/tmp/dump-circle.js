// 针对 circle@320x568 的细节 dump：面板矩形 / 裁剪区 / 页脚文字实际落点
const path = require('path');
const fs = require('fs');
const { makeCtx, makeRec } = require('./harness');
global.document = { addEventListener() {}, removeEventListener() {} };
global.requestAnimationFrame = () => 0;

const ROOT = path.resolve(__dirname, '..', '..');
const rec = makeRec();
const ctx = makeCtx(rec);
const Game = require(path.join(ROOT, 'src', 'game_core'));
const renderer = require(path.join(ROOT, 'src', 'renderer'));
const config = require(path.join(ROOT, 'src', 'config'));

const out = [];
const W = 320, H = 568;
const canvas = { width: W, height: H, addEventListener() {}, removeEventListener() {}, getContext() { return ctx; } };
const g = new Game(canvas, ctx, { screenWidth: W, screenHeight: H, renderScale: 1 });
g.panelTowerType = 'circle';
g.showPanel = true;
g.selectedTower = null;
g.gold = 9999;

renderer.drawTowerPanel(g);

const panel = rec.rects.filter((r) => r.w > 100 && r.h > 100).sort((a, b) => b.w * b.h - a.w * a.h)[0];
out.push('面板矩形: ' + JSON.stringify(panel));
out.push('roundRect 全部调用:');
for (const r of rec.rects) out.push('   ' + JSON.stringify(r));
out.push('clip 全部调用:');
for (const c of rec.clips) out.push('   ' + JSON.stringify(c));
out.push('面板裁剪层内的文字（y 从大到小）:');
const inPanel = rec.clips.filter((c) => c && c.x >= panel.x - 1 && c.y >= panel.y - 1
  && c.x + c.w <= panel.x + panel.w + 1 && c.y + c.h <= panel.y + panel.h + 1)
  .sort((a, b) => b.w * b.h - a.w * a.h)[0];
const same = (a, b) => a && b && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5
  && Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5;
const list = rec.texts.filter((t) => same(t.clip, inPanel)).sort((a, b) => b.y - a.y);
for (const t of list.slice(0, 8)) {
  out.push(`   y=${t.y.toFixed(1)} bottom=${(t.y + t.size / 2).toFixed(1)} size=${t.size} 「${t.text}」`);
}
out.push(`面板底 = ${(panel.y + panel.h).toFixed(1)}，裁剪底 = ${(inPanel.y + inPanel.h).toFixed(1)}`);
out.push(`availH = ${H - 36}`);

fs.writeFileSync(path.join(__dirname, '_dump.txt'), out.join('\n'), 'utf8');
