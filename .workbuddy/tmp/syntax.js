// 语法体检：用 vm.Script 编译每个源文件（只编译不执行），任何语法错误立刻暴露
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const files = [];
for (const dir of [ROOT, path.join(ROOT, 'src')]) {
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith('.js') && !f.startsWith('_')) files.push(path.join(dir, f));
  }
}

const out = [];
let bad = 0;
for (const f of files) {
  const rel = path.relative(ROOT, f);
  try {
    new vm.Script(fs.readFileSync(f, 'utf8'), { filename: f });
    out.push(`  ok   ${rel}`);
  } catch (e) {
    bad++;
    out.push(` FAIL  ${rel}  → ${e.message}`);
  }
}
out.push('');
out.push(`=== 语法体检：${files.length} 个文件，失败 ${bad} 个 ===`);
fs.writeFileSync(path.join(__dirname, '_syntax.txt'), out.join('\n'), 'utf8');
process.exitCode = bad ? 1 : 0;
