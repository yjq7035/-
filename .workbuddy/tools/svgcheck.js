// ============================================================================
// SVG 结构体检 —— .workbuddy/tmp/svgcheck.js
// ----------------------------------------------------------------------------
// 目标：确认回放出来的 SVG 是"真画面"，而不是技能里警告过的"一坨黑"。
//   · 绝不能出现 fillStyle=/strokeStyle= 这种非法属性（会静默回退成黑色填充）
//   · 文本条数、路径条数、色簇数要够（空屏/纯色块探测器）
//   · 每个 url(#id) 引用都必须在 <defs> 里有定义（防 id 撞号/漏定义）
// ============================================================================
const path = require('path');
const fs = require('fs');

const file = path.join(__dirname, '_panels.html');
const html = fs.readFileSync(file, 'utf8');

const out = [];
let fails = 0;
const ok = (name, cond, detail) => {
  if (!cond) fails++;
  out.push(`${cond ? '  ok  ' : ' FAIL '} ${name}${detail ? '  → ' + detail : ''}`);
};

const svgs = html.match(/<svg[\s\S]*?<\/svg>/g) || [];
ok('HTML 内嵌 2 个 SVG', svgs.length === 2, `实际 ${svgs.length} 个`);

svgs.forEach((svg, i) => {
  const tag = `SVG#${i + 1}`;
  out.push(`\n----- ${tag}（${(svg.length / 1024).toFixed(1)} KB）-----`);

  // ① 非法属性（技能里点名的最阴的坑）
  const illegal = (svg.match(/\b(fillStyle|strokeStyle)\s*=/g) || []).length;
  ok(`${tag} 无非法 fillStyle/strokeStyle 属性`, illegal === 0, `出现 ${illegal} 次`);

  // ② 内容量
  const texts = (svg.match(/<text\b/g) || []).length;
  const paths = (svg.match(/<path\b/g) || []).length;
  const rects = (svg.match(/<rect\b/g) || []).length;
  const clipPaths = (svg.match(/<clipPath\b/g) || []).length;
  const clips = (svg.match(/clip-path="url\(/g) || []).length;
  ok(`${tag} 有真实文本`, texts >= 10, `text=${texts}`);
  ok(`${tag} 有真实图元`, paths + rects >= 20, `path=${paths} rect=${rects}`);
  ok(`${tag} 有裁剪层`, clipPaths >= 1 && clipPaths === clips, `定义=${clipPaths} 引用=${clips}`);

  // ③ 色簇数：黑坨的话只有 1~2 种颜色
  const colors = new Set();
  for (const m of svg.matchAll(/(?:fill|stroke)="([^"]+)"/g)) colors.add(m[1]);
  ok(`${tag} 颜色数 >= 8（非纯色块）`, colors.size >= 8, `${colors.size} 种`);

  // ④ 所有 url(#id) 引用都能解析
  const defIds = new Set();
  for (const m of svg.matchAll(/id="([^"]+)"/g)) defIds.add(m[1]);
  const refs = [...svg.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]);
  const missing = refs.filter((r) => !defIds.has(r));
  ok(`${tag} 渐变/裁剪引用全部有定义`, missing.length === 0,
    missing.length ? '缺失: ' + [...new Set(missing)].join(',') : `${refs.length} 个引用全部命中`);

  // ⑤ 关键文案确实画出来了
  const must = i === 0
    ? ['攻击介绍', '固有技能', '强化', '点击任意位置关闭', '直接抵扣敌人抗性']
    : ['图签', '固有技能', '穿透:', '点空白关闭', '直接抵扣敌人抗性'];
  const missingText = must.filter((t) => !svg.includes(t));
  ok(`${tag} 关键文案齐全`, missingText.length === 0,
    missingText.length ? '缺: ' + missingText.join(' / ') : must.join(' · '));
});

out.push('');
out.push(`=== SVG 体检：${svgs.length} 张，失败 ${fails} 条 ===`);
out.push(`=== 判据戳：${new Date().toISOString()} ===`);
fs.writeFileSync(path.join(__dirname, '_svgcheck.txt'), out.join('\n'), 'utf8');
