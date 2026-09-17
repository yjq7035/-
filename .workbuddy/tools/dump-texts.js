// ============================================================================
// 交付图文本转储 —— .workbuddy/tools/dump-texts.js
// ----------------------------------------------------------------------------
// 用途：把回放 HTML 里每个 SVG 的 <text> 按顺序列出来（含字宽估算），
//       用来核对"面板上到底写了什么、顺序对不对、有没有重复/漏项"。
//       几何断言（probe-*.js）负责"有没有越界"，这个负责"内容对不对"。
//
// 用法：node dump-texts.js [文件名] [SVG 序号，从 1 开始；不传则全部]
// ============================================================================
const path = require('path');
const fs = require('fs');

const arg = process.argv[2] || '_graphic.html';
const only = parseInt(process.argv[3], 10);
const file = path.isAbsolute(arg) ? arg : path.join(__dirname, arg);
const html = fs.readFileSync(file, 'utf8');
const svgs = html.match(/<svg[\s\S]*?<\/svg>/g) || [];

const out = [`${path.basename(file)} · 共 ${svgs.length} 张 SVG`];
svgs.forEach((svg, i) => {
  if (only && only !== i + 1) return;
  const texts = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
  out.push(`\n===== SVG#${i + 1}（${texts.length} 条文本）=====`);
  texts.forEach((t, k) => out.push(`${String(k + 1).padStart(4)}  ${t}`));
});
fs.writeFileSync(path.join(__dirname, '_texts.txt'), out.join('\n'), 'utf8');
