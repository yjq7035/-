'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src');
const NODE = process.execPath;
const out = [];
let bad = 0;
const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.js')).map((f) => path.join(SRC, f));
files.push(path.join(ROOT, 'game.js'));
for (const f of files) {
  const r = cp.spawnSync(NODE, ['--check', f], { encoding: 'utf8' });
  if (r.status === 0) out.push('ok   ' + path.basename(f));
  else { bad++; out.push('FAIL ' + path.basename(f) + '\n' + (r.stderr || '')); }
}
out.push('');
out.push(`语法检查：${files.length - bad}/${files.length} 通过`);
fs.writeFileSync(path.join(ROOT, '.workbuddy', 'tmp', '_syntax.txt'), out.join('\n'), 'utf8');
