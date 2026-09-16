/**
 * 用 Edge headless 把回放出来的 SVG 真渲染成 PNG，再做像素探针。
 * 产物：.workbuddy/tmp/png/*.png  +  _shoot.txt（探针报告）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const HH = require('./harness');

const ROOT = path.resolve(__dirname, '..', '..');   // .workbuddy/tools/ → 项目根
const TMP = path.join(ROOT, '.workbuddy', 'tmp');
const SVG_DIR = path.join(TMP, 'svg');
const PNG_DIR = path.join(ROOT, '.workbuddy', 'preview');   // 最终产物目录（给用户看）
const HTML_DIR = path.join(TMP, 'html');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const REPORT = path.join(TMP, '_shoot.txt');

const L = [];
let PASS = 0, FAIL = 0;
function ok(name, cond, extra) {
  if (cond) { PASS++; L.push('  ok   ' + name + (extra ? '   [' + extra + ']' : '')); }
  else { FAIL++; L.push('  FAIL ' + name + (extra ? '   [' + extra + ']' : '')); }
}
function log(s) { L.push(s); }
function r1(n) { return Math.round(n * 10) / 10; }

for (const d of [PNG_DIR, HTML_DIR]) { try { fs.mkdirSync(d, { recursive: true }); } catch (e) { } }

const files = fs.readdirSync(SVG_DIR).filter((f) => /\.svg$/.test(f));
log('=== Edge headless 真渲染 ===');
log('SVG 数：' + files.length);

for (const f of files) {
  const base = f.replace(/\.svg$/, '');
  const m = /_(\d+)x(\d+)$/.exec(base);
  const W = m ? parseInt(m[1], 10) : 390;
  const H = m ? parseInt(m[2], 10) : 844;
  const svgPath = path.join(SVG_DIR, f);
  const htmlPath = path.join(HTML_DIR, base + '.html');
  const pngPath = path.join(PNG_DIR, base + '.png');

  const svgText = fs.readFileSync(svgPath, 'utf8');
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:#0d1117;overflow:hidden;width:${W}px;height:${H}px}
svg{display:block;width:${W}px;height:${H}px}
</style></head><body>${svgText.replace(/^<\?xml[^>]*\?>\s*/, '')}</body></html>`;
  fs.writeFileSync(htmlPath, html, 'utf8');

  const url = 'file:///' + htmlPath.replace(/\\/g, '/');
  try {
    cp.execFileSync(EDGE, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-sandbox',
      '--force-device-scale-factor=1', '--disable-lcd-text',
      '--default-background-color=0d1117',
      `--window-size=${W},${H}`,
      `--screenshot=${pngPath}`,
      url,
    ], { stdio: 'ignore', timeout: 30000 });
  } catch (e) {
    ok('截图 ' + base, false, 'edge 失败: ' + (e.message || '').slice(0, 120));
    continue;
  }
  if (!fs.existsSync(pngPath)) { ok('截图 ' + base, false, '未生成 png'); continue; }

  const img = HH.decodePNG(fs.readFileSync(pngPath));
  if (img.width !== W || img.height !== H) {
    ok('截图 ' + base, false, `尺寸 ${img.width}x${img.height} != ${W}x${H}`);
    continue;
  }

  // ---- 像素探针 ----
  // 1) 非背景像素占比（证明不是空白）
  let nonBg = 0, sampled = 0;
  const colors = new Set();
  const step = 2;
  for (let y = 0; y < H; y += step) {
    for (let x = 0; x < W; x += step) {
      const p = img.px(x, y);
      sampled++;
      if (Math.abs(p[0] - 13) + Math.abs(p[1] - 17) + Math.abs(p[2] - 23) > 24) nonBg++;
      colors.add((p[0] >> 3) + ',' + (p[1] >> 3) + ',' + (p[2] >> 3));
    }
  }
  const pct = nonBg / sampled * 100;

  // 2) 内容包围盒（非背景像素的边界）
  let minX = W, minY = H, maxX = -1, maxY = -1;
  for (let y = 0; y < H; y += 2) {
    for (let x = 0; x < W; x += 2) {
      const p = img.px(x, y);
      if (Math.abs(p[0] - 13) + Math.abs(p[1] - 17) + Math.abs(p[2] - 23) > 24) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }

  const boxStr = maxX < 0 ? '空' : `(${minX},${minY})-(${maxX},${maxY})`;
  log(`  ${base}: 非背景 ${r1(pct)}%  色簇 ${colors.size}  内容盒 ${boxStr}`);

  ok(base + ' 非空白', pct > 3, r1(pct) + '%');
  ok(base + ' 颜色层次足够（非纯色块）', colors.size >= 8, colors.size + ' 色簇');
  if (maxX >= 0) {
    ok(base + ' 内容充满画布（左右均有内容）', minX <= W * 0.06 && maxX >= W * 0.94, `左 ${minX} 右 ${maxX}`);
  }
}

log('');
log('============================================');
log(`  截图 ${PASS} 通过  ${FAIL} 失败`);
log('============================================');
fs.writeFileSync(REPORT, L.join('\n') + '\n', 'utf8');
console.log('SHOOT PASS=' + PASS + ' FAIL=' + FAIL);
