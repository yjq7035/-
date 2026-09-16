/**
 * 区域亮度探针：对比两张 PNG 在同一矩形内的平均亮度，用来核实"遮罩是否真的生效"这类断言。
 * 用法：node probe.js <a.png> <b.png> <x> <y> <w> <h>
 */
'use strict';
const fs = require('fs');
const path = require('path');
const HH = require('./harness');

const ROOT = path.resolve(__dirname, '..', '..');
const PREV = path.join(ROOT, '.workbuddy', 'preview');

function load(name) {
  const p = path.isAbsolute(name) ? name : path.join(PREV, name);
  return HH.decodePNG(fs.readFileSync(p));
}
function regionMean(img, x, y, w, h) {
  let r = 0, g = 0, b = 0, n = 0;
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      const p = img.px(xx, yy);
      r += p[0]; g += p[1]; b += p[2]; n++;
    }
  }
  return { r: r / n, g: g / n, b: b / n, lum: (0.2126 * r + 0.7152 * g + 0.0722 * b) / n };
}

const [a, b] = [process.argv[2], process.argv[3]];
const x = +process.argv[4], y = +process.argv[5], w = +process.argv[6], h = +process.argv[7];
const ia = load(a), ib = load(b);
const ma = regionMean(ia, x, y, w, h);
const mb = regionMean(ib, x, y, w, h);
const f = (v) => Math.round(v * 10) / 10;
const out = [
  `区域 (${x},${y},${w},${h})`,
  `  A ${path.basename(a)}: rgb(${f(ma.r)},${f(ma.g)},${f(ma.b)})  亮度 ${f(ma.lum)}`,
  `  B ${path.basename(b)}: rgb(${f(mb.r)},${f(mb.g)},${f(mb.b)})  亮度 ${f(mb.lum)}`,
  `  亮度比 A/B = ${f(ma.lum / (mb.lum || 1))}`,
].join('\n');
fs.writeFileSync(path.join(ROOT, '.workbuddy', 'tmp', '_probe.txt'), out + '\n', 'utf8');
console.log(out);
