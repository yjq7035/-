// 技能效果 base 体检：逐塔逐效果核对「技能表 base」vs「TOWER_STATS 原生值」
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const config = require(path.join(ROOT, 'src', 'config.js'));
const skills = require(path.join(ROOT, 'src', 'skills.js'));

const lines = [];
const dormant = [];   // active:true 但 base=0 → Lv.1 时技能等于没生效
const mismatch = [];  // base 与原生值不一致 → 面板显示假数值
const inactiveNonZero = []; // active:false 但显示非 0 → "看得见打不着"
const ok = [];

lines.push('type            skill           key                     base   per  unit  active  native  verdict');
lines.push('-'.repeat(110));

for (const type of Object.keys(config.TOWER_DEFS)) {
  const sk = skills.getInnateSkill(type);
  if (!sk) { lines.push(`${type.padEnd(15)} <无技能>`); continue; }
  for (const e of (sk.effects || [])) {
    const meta = skills.EFFECT_KEYS[e.key];
    const active = meta ? !!meta.active : false;
    const native = skills.nativeOf(type, e.key);
    let verdict;
    if (!meta) verdict = '未登记键';
    else if (!active) {
      verdict = e.base ? 'active:false 但显示非0' : 'active:false';
      if (e.base) inactiveNonZero.push(`${type}.${e.key} (${e.base})`);
    } else if (native === undefined) verdict = '原生值缺失';
    else if (Math.abs(native - e.base) > 1e-6) {
      verdict = `★不一致 原生=${native}`;
      mismatch.push(`${type}.${e.key}: base=${e.base} 原生=${native}`);
    } else if (e.base === 0) {
      verdict = '⚠ Lv.1 无效果（休眠）';
      dormant.push(`${type}「${sk.name}」${e.name}`);
    } else { verdict = 'ok'; ok.push(`${type}.${e.key}`); }

    lines.push([
      type.padEnd(15),
      sk.name.padEnd(14),
      e.key.padEnd(22),
      String(e.base).padStart(4),
      String(e.per).padStart(4),
      String(e.unit || '-').padStart(5),
      String(active).padStart(6),
      String(native === undefined ? 'N/A' : native).padStart(7),
      ' ' + verdict,
    ].join(' '));
  }
}

lines.push('');
lines.push('===== 汇总 =====');
lines.push(`效果总数        : ${ok.length + dormant.length + mismatch.length + inactiveNonZero.length}`);
lines.push(`ok（base=原生且非0）: ${ok.length}  [${ok.join(', ')}]`);
lines.push(`★ base 与原生不一致 : ${mismatch.length}  ${mismatch.length ? '→ ' + mismatch.join(' | ') : ''}`);
lines.push(`⚠ active 但 base=0  : ${dormant.length}  ${dormant.length ? '→ ' + dormant.join(' | ') : ''}`);
lines.push(`active:false 却非0   : ${inactiveNonZero.length}  ${inactiveNonZero.length ? '→ ' + inactiveNonZero.join(' | ') : ''}`);
lines.push('');
lines.push(`skills.audit() 报告的问题数: ${skills.audit().length}`);
skills.audit().forEach((p) => lines.push('  · ' + p));

fs.writeFileSync(path.join(__dirname, '_audit-base.txt'), lines.join('\n'), 'utf8');
console.log('done');
