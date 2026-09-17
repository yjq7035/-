// ============================================================================
// SVG 结构体检 —— .workbuddy/tools/svgcheck.js
// ----------------------------------------------------------------------------
// 目标：确认回放出来的 SVG 是"真画面"，而不是技能里警告过的"一坨黑"。
//   · 绝不能出现 fillStyle=/strokeStyle= 这种非法属性（会静默回退成黑色填充）
//   · 文本条数、路径条数、色簇数要够（空屏/纯色块探测器）
//   · 每个 url(#id) 引用都必须在 <defs> 里有定义（防 id 撞号/漏定义）
//
// 用法：node svgcheck.js [文件名]   （默认 _panels.html；可传 _graphic.html / _gems.html）
// 说明：关键文案检查改为"整份 HTML 的并集"——一张交付里往往同时有
//       "只有图标"和"只有面板"的 SVGs，逐张要求同一批文案必然会假失败。
// ============================================================================
const path = require('path');
const fs = require('fs');

const arg = process.argv[2] || '_panels.html';
const file = path.isAbsolute(arg) ? arg : path.join(__dirname, arg);
const base = path.basename(file);
const html = fs.readFileSync(file, 'utf8');

const out = [];
let fails = 0;
const ok = (name, cond, detail) => {
  if (!cond) fails++;
  out.push(`${cond ? '  ok  ' : ' FAIL '} ${name}${detail ? '  → ' + detail : ''}`);
};

const svgs = html.match(/<svg[\s\S]*?<\/svg>/g) || [];
ok(`${base} 至少内嵌 1 个 SVG`, svgs.length >= 1, `实际 ${svgs.length} 个`);

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
  ok(`${tag} 有真实图元`, paths + rects >= 10, `text=${texts} path=${paths} rect=${rects}`);
  ok(`${tag} 裁剪层定义/引用一一对应`, clipPaths === clips, `定义=${clipPaths} 引用=${clips}`);

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
});

// ⑤ 关键文案（整份交付的并集）：每份交付自带一份 must 清单
// ⚠️ 清单必须写"画面上真实存在的原句"，别写记忆里的近似句 ——
//    曾把箭形塔的「直接抵消敌人抗性」记成「直接抵扣敌人抗性」，白白红了一条。
const MUST_BY_FILE = {
  '_panels.html': ['攻击介绍', '固有技能', '强化', '点击任意位置关闭', '直接抵消敌人抗性'],
  '_graphic.html': ['平行塔', '双横', '固有技能', '叠加上限', '攻击间隔', '间隔 0.25秒', '点空白关闭', '白条'],
  // 技能槽 / 宝石 / 背包交付：挑的都是「SVG 里真画出来的原句」——
  // 别写 HTML 散文里的标题，那只是在检查我自己写的文案（等于没查）
  '_gems.html': ['固有技能', '攻击间隔', 'Lv.', '宝石', '看广告', '取消', '未解锁'],
};
const must = MUST_BY_FILE[base];
if (must) {
  const missingText = must.filter((t) => !html.includes(t));
  ok(`${base} 关键文案齐全`, missingText.length === 0,
    missingText.length ? '缺: ' + missingText.join(' / ') : must.join(' · '));
} else {
  ok(`${base} 有 CJK 文案（未登记 must 清单，做存在性兜底）`, /[\u4e00-\u9fa5]/.test(html));
}

out.push('');
out.push(`=== SVG 体检（${base}）：${svgs.length} 张，失败 ${fails} 条 ===`);
out.push(`=== 判据戳：${new Date().toISOString()} ===`);
fs.writeFileSync(path.join(__dirname, base.replace(/\.html$/, '') + '_svgcheck.txt'), out.join('\n'), 'utf8');

