// 临时诊断：列出 _panels.html 各 SVG 的文本（查 must 清单里的历史文案到底还在不在）
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '_panels.html');
const html = fs.readFileSync(file, 'utf8');
const svgs = html.match(/<svg[\s\S]*?<\/svg>/g) || [];
const lines = [];
lines.push('SVG 数量: ' + svgs.length);
['直接抵扣敌人抗性', '直接抵消敌人抗性', '攻击介绍', '固有技能', '强化'].forEach((s) => {
  lines.push(`  "${s}" 在整份 HTML 中: ${html.indexOf(s) >= 0}`);
  svgs.forEach((svg, i) => lines.push(`      SVG#${i + 1}: ${svg.indexOf(s) >= 0}`));
});
svgs.forEach((svg, i) => {
  const texts = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
  lines.push(`\n===== SVG#${i + 1}（${texts.length} 条文本）=====`);
  texts.forEach((t, k) => lines.push(`${String(k + 1).padStart(3)}  ${t}`));
});
fs.writeFileSync(path.join(__dirname, '_dump-texts.txt'), lines.join('\n'), 'utf8');
