// ============================================================================
// 全量回归跑手 —— .workbuddy/tools/run-all.js
// ----------------------------------------------------------------------------
// 一次跑完所有探针，把每套的「汇总行」写成一份 UTF-8 报告（.workbuddy/tmp/_all.txt）。
//
// 为什么需要它（本机踩过的两个坑）：
//   · PowerShell 的 Get-Content 读 UTF-8 中文报告会乱码，且本机 PowerShell 会**吞掉
//     node 的 stdout** —— 直接在 PS 里串 5 个 node 脚本，等于白跑，什么都看不到；
//   · `*>` 重定向出来的是 UTF-16，Read 工具会判定为 binary 打不开。
//   所以在 node 里 spawnSync/execFileSync 子进程 + fs.writeFileSync('utf8') 才是可靠姿势。
//
// 用法： node .workbuddy/tools/run-all.js
// 退出码：0 = 全部通过；1 = 有套件红
// ============================================================================
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const TOOLS = __dirname;
const TMP = path.join(__dirname, '..', 'tmp');

const JOBS = [
  ['syntax',        path.join(TOOLS, 'syntax.js'),        [path.join(TOOLS, '_syntax.txt')]],
  ['probe-panel',   path.join(TOOLS, 'probe-panel.js'),   [path.join(TOOLS, '_panel.txt')]],
  ['probe-codex',   path.join(TOOLS, 'probe-codex.js'),   [path.join(TOOLS, '_codex.txt')]],
  ['probe-gem',     path.join(TOOLS, 'probe-gem.js'),     [path.join(TOOLS, '_gem.txt')]],
  // 技能系统专项：技能表契约 + "一技能多效果"（三角塔暴击/爆伤）+ 强化与宝石链路
  ['probe-skill',   path.join(TOOLS, 'probe-skill.js'),   [path.join(TOOLS, '_skill.txt')]],
  ['smoke',         path.join(TOOLS, 'smoke.js'),         [path.join(TOOLS, '_smoke.txt')]],
  // 天赋花费专项：公式（Lv.N = N × 基础花费）+ 真扣点 + 按钮报价与结算同口径
  ['probe-talent',  path.join(TOOLS, 'probe-talent.js'),  [path.join(TOOLS, '_talent.txt')]],
  // 背景音乐专项：伪造 wx 跑音频状态机 + 顶栏开关几何/图标/真实点按 + 各场景可见性
  ['probe-audio',   path.join(TOOLS, 'probe-audio.js'),   [path.join(TOOLS, '_audio.txt')]],
  ['probe-graphic', path.join(TOOLS, 'probe-graphic.js'), [path.join(TMP, '_graphic.txt')]],
  ['svgcheck',      path.join(TOOLS, 'svgcheck.js'),      [path.join(TOOLS, '_graphic_svgcheck.txt')], [path.join(TMP, '_graphic.html')]],
  // 交付图先出、再体检：dump-gems 会重新生成 _gems.html，所以 svgcheck 必须排在它后面，
  // 否则体检的是上一轮的旧图（"绿得毫无意义"）
  ['dump-gems',     path.join(TOOLS, 'dump-gems.js'),     [path.join(TOOLS, '_gems_sizes.txt')]],
  ['svgcheck',      path.join(TOOLS, 'svgcheck.js'),      [path.join(TOOLS, '_gems_svgcheck.txt')], [path.join(TOOLS, '_gems.html')]],
];

// 先删旧报告：本项目的老教训 —— 不删就会读到上一轮的结论，红绿都不可信
for (const job of JOBS) for (const r of job[2]) { try { fs.unlinkSync(r); } catch (e) { /* 首次跑本来就没有 */ } }
try { fs.unlinkSync(path.join(TMP, '_graphic.html')); } catch (e) { /* 同上 */ }
try { fs.unlinkSync(path.join(TOOLS, '_gems.html')); } catch (e) { /* 同上 */ }

const lines = [];
let bad = 0;
for (const [name, script, reports, args] of JOBS) {
  let code = 0;
  let err = '';
  try {
    execFileSync(process.execPath, [script].concat(args || []), { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    code = (e.status === undefined || e.status === null) ? -1 : e.status;
    const all = String((e.stdout || '') + (e.stderr || ''));
    err = all.split('\n').filter((l) => /Error|error:/.test(l)).slice(0, 2).join(' | ') || String(e.message || '').split('\n')[0];
  }
  if (code !== 0) bad++;
  const tail = [];
  for (const r of reports) {
    if (!fs.existsSync(r)) { tail.push('报告缺失 ' + path.basename(r)); continue; }
    const arr = fs.readFileSync(r, 'utf8').split('\n').filter((l) => l.trim());
    tail.push(arr.slice(-2).join('  ||  '));
  }
  lines.push(`[${code === 0 ? ' ok ' : 'FAIL'}] ${name} (exit=${code}) ${tail.join('  ||  ')}${err ? '\n        ↳ ' + err : ''}`);
}
lines.push('');
lines.push(`=== 全量回归：${JOBS.length} 套，异常 ${bad} 套 ===`);
fs.writeFileSync(path.join(TMP, '_all.txt'), lines.join('\n'), 'utf8');
process.exitCode = bad ? 1 : 0;
