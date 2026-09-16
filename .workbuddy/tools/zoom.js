/**
 * 放大镜：把已回放好的 SVG 的指定矩形区域按 N 倍放大后截图，用于肉眼核对细节。
 * 用法：node zoom.js <svg基名> <x> <y> <w> <h> [scale]
 * 产物：.workbuddy/preview/zoom_<基名>.png
 */
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const TMP = path.join(ROOT, '.workbuddy', 'tmp');
const SVG_DIR = path.join(TMP, 'svg');
const PNG_DIR = path.join(ROOT, '.workbuddy', 'preview');
const HTML_DIR = path.join(TMP, 'html');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const base = process.argv[2];
const x = parseFloat(process.argv[3]);
const y = parseFloat(process.argv[4]);
const w = parseFloat(process.argv[5]);
const h = parseFloat(process.argv[6]);
const scale = parseFloat(process.argv[7] || '3');

if (!base) { console.error('需要 svg 基名'); process.exit(1); }
for (const d of [PNG_DIR, HTML_DIR]) { try { fs.mkdirSync(d, { recursive: true }); } catch (e) { } }

const svgPath = path.join(SVG_DIR, base + '.svg');
const svgText = fs.readFileSync(svgPath, 'utf8');
const m = /_(\d+)x(\d+)$/.exec(base);
const SW = m ? parseInt(m[1], 10) : 390;
const SH = m ? parseInt(m[2], 10) : 844;

const OW = Math.round(w * scale);
const OH = Math.round(h * scale);
const ox = Math.round(x * scale);
const oy = Math.round(y * scale);

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:#0d1117;overflow:hidden;width:${OW}px;height:${OH}px}
.stage{position:relative;width:${OW}px;height:${OH}px;overflow:hidden}
.inner{position:absolute;left:${-ox}px;top:${-oy}px;width:${SW * scale}px;height:${SH * scale}px}
.inner svg{display:block;width:${SW * scale}px;height:${SH * scale}px}
</style></head><body>
<div class="stage"><div class="inner">${svgText.replace(/^<\?xml[^>]*\?>\s*/, '')}</div></div>
</body></html>`;
const htmlPath = path.join(HTML_DIR, 'zoom_' + base + '.html');
fs.writeFileSync(htmlPath, html, 'utf8');

const pngPath = path.join(PNG_DIR, 'zoom_' + base + '.png');
const url = 'file:///' + htmlPath.replace(/\\/g, '/');
cp.execFileSync(EDGE, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-sandbox',
  '--force-device-scale-factor=1',
  '--default-background-color=0d1117',
  `--window-size=${OW},${OH}`,
  `--screenshot=${pngPath}`,
  url,
], { stdio: 'ignore', timeout: 30000 });

fs.writeFileSync(path.join(TMP, '_zoom.txt'),
  `放大 ${base} 区域(${x},${y},${w},${h}) ×${scale} → ${pngPath}\n`, 'utf8');
