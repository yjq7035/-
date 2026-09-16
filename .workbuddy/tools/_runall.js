/**
 * 一次性驱动：跑完验证套件 + 生成报告，把每个脚本的 stdout/stderr/exit 汇总到一个文件。
 * 产物：.workbuddy/tmp/_runall.txt
 */
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const TMP = path.join(ROOT, '.workbuddy', 'tmp');
const NODE = process.execPath;

// [脚本, 说明, 产物文件(相对 tmp)]
const JOBS = [
  ['syntax.js', 'node --check 语法', '_syntax.txt'],
  ['verify.js', 'verify.js 全量逻辑校验', '_verify.txt'],
  ['regress-ui.js', 'regress-ui.js 可点性回归', '_regress.txt'],
  ['entry3.js', 'entry3.js 真机启动还原（首帧是否出画面 + createCanvas 调用次数）', '_entry3.txt'],
  ['monkey.js', 'monkey.js 随机手势 / 孤儿拖拽态', '_monkey.txt'],
  ['noroundrect.js', 'noroundrect.js 老基础库反证', '_noroundrect.txt'],
  ['report.js', 'report.js 生成 HTML 报告', null],
];

const out = [];
out.push('=== runall  ' + new Date().toISOString() + ' ===');
out.push('node = ' + NODE);
out.push('root = ' + ROOT);
out.push('');

for (const [file, desc, artifact] of JOBS) {
  const abs = path.join(__dirname, file);
  out.push('------------------------------------------------------------');
  out.push('▶ ' + file + '  —— ' + desc);
  if (!fs.existsSync(abs)) { out.push('  !! MISSING'); continue; }
  const t0 = Date.now();
  const r = spawnSync(NODE, [abs], { cwd: ROOT, encoding: 'utf8', timeout: 180000 });
  const ms = Date.now() - t0;
  out.push('  exit=' + r.status + '  signal=' + (r.signal || '-') + '  ' + ms + 'ms');
  const so = (r.stdout || '').trim();
  const se = (r.stderr || '').trim();
  if (so) out.push('  [stdout]\n' + so.split('\n').map((l) => '    ' + l).join('\n'));
  if (se) out.push('  [stderr]\n' + se.split('\n').map((l) => '    ' + l).join('\n'));
  if (artifact) {
    const ap = path.join(TMP, artifact);
    if (fs.existsSync(ap)) {
      const body = fs.readFileSync(ap, 'utf8').replace(/^\uFEFF/, '');
      out.push('  [artifact ' + artifact + '  ' + body.length + 'B]');
      out.push(body.split('\n').map((l) => '    | ' + l).join('\n'));
    } else {
      out.push('  !! artifact missing: ' + artifact);
    }
  }
  out.push('');
}

out.push('=== done ===');
fs.writeFileSync(path.join(TMP, '_runall.txt'), out.join('\n'), 'utf8');
console.log('runall done');
