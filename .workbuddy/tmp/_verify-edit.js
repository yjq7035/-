// ============================================================================
// 技能系统重构 · 落盘核对 —— .workbuddy/tmp/_verify-edit.js
// 背景：同一条消息里对**同一个文件**发多个 Edit，后写会覆盖先写却全报成功
// （本项目 Read/Grep 也有缓存滞后）。所以改完必须直读磁盘核对，
// 「should 出现 / should 消失」逐条过一遍，缺什么立刻补。
// ============================================================================
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');

const SPEC = [
  ['src/skills.js', {
    must: ['const SKILLS = {', "require('./gems')", 'function getEffects', 'function bonusFor',
      'function applyTo', 'function audit', "id: 'tri_crit'", 'critDamage', 'NATIVE_GETTERS',
      'const INNATE_LABEL'],
    never: ['ENHANCE_SPECIAL'],
  }],
  ['src/config.js', {
    must: ['src/skills.js 的 SKILLS 表', 'critDamage: 10'],
    never: ['const ENHANCE_SPECIAL = {', 'ENHANCE_SPECIAL,'],
  }],
  ['src/tower.js', {
    // ⚠️ 原来这里写的是 'skills.clampLevel'，但 tower.js 从头到尾都没用过它（HEAD 版也没有）——
    //    塔这边走的是【强化次数】口径 clampEnhanceTimes + getEffectiveSkillLevel，
    //    clampLevel 只在 skills.js 内部用。死 token 只会制造假红灯，已改成真实现。
    must: ["require('./skills')", 'skills.getInnateSkill', 'skills.getEffects', 'skills.bonusFor',
      'skills.getOptions', 'skills.applyTo', 'skills.clampEnhanceTimes', 'skills.gemLevels',
      'getEffectiveSkillLevel',
      'critDamagePts', "add('auraPenetration')", 'getSkillDef', 'skills.SKILLS',
      'skills.skillGainText', 'skills.skillValueText', '取值口径见 src/skills.js'],
    never: ['ENHANCE_SPECIAL', 'getSpecialDef'],
  }],
  ['src/renderer.js', {
    must: ["require('./skills')", 'skills.hasSkill', 'skills.skillGainLabel', 'skills.INNATE_LABEL',
      'break: THEME.accent.gold'],
    never: ['getSpecialDef', 'ENHANCE_SPECIAL'],
  }],
  ['src/codex.js', {
    must: ["require('./skills')", 'skills.INNATE_LABEL', 'stats.critDamage'],
    never: [],
  }],
  ['src/enhance.js', {
    must: ["require('./skills')", 'function cardH', 'options.map((o) => cardH', 'skills.INNATE_LABEL',
      'effectStepText', 'skills.skillStepText', 'skills.getInnateSkill', 'skills.skillGainText'],
    never: ['ENHANCE_SPECIAL', 'optionH:'],
  }],
  ['src/bonusStats.js', {
    must: ["require('./skills')", 'CRIT_DAMAGE:', 'critDamage: ATTR.CRIT_DAMAGE',
      'critDamage:            { name', 'AURA_PENETRATION:', 'auraPenetration: ATTR.AURA_PENETRATION',
      'auraPenetration:       { name', 'skills.getEffects',
      'auraPenetration: st.auraPenetration', 'auraPenetration: Math.max(0',
      'auraPenetration: final.auraPenetration', 'break: st.break', 'break: finalBreak',
      'break: final.break', 'key: ATTR.BREAK',
      'percentParts(sources, ATTR.CRIT_MULT).concat(pointParts(sources, ATTR.CRIT_DAMAGE))',
      // 展示层唯一收口：所有实数文案走 numText（最多 2 位小数）
      'function numText(v)', '${numText(n)}${meta.unit}', '${numText(s.percent)}%',
      '${numText(s.value)}${meta.unit}', '  numText,'],
    // 裸数字插值不复辟（光环值是浮点乘算，直接印会带出 84.00000000000001 这类尾巴）
    never: ['ENHANCE_SPECIAL', '${round2('],
  }],
  ['src/gems.js', {
    must: ['bonusForType', 'skillLevels', 'gems **不许** require skills'],
    never: ['skillNameOf', 'ENHANCE_SPECIAL'],
  }],
  ['src/skillSlot.js', {
    // 技能槽显示的是**实际生效值**（含紫晶宝石的技能效果放大），对应 effectiveValueTextOf；
    // 旧的 valueTextOf 只有 HEAD 版还在用，留着就是假红灯。
    must: ["require('./skills')", 'skills.iconOf', 'skills.levelOf', 'skills.previewLevel',
      'skills.effectiveValueTextOf', 'skills.gainTextOf'],
    never: ['ENHANCE_SPECIAL'],
  }],
  ['src/game_core.js', {
    must: ['prof.critMult', 'gains: (opt.effects', 'src/skills.js'],
    never: ['critDamageAdd', 'ENHANCE_SPECIAL', 'getSpecialDef'],
  }],
  ['src/gemModal.js', {
    must: ["require('./skills')", 'skills.skillName'],
    never: ['skillNameOf'],
  }],
  ['src/input.js', {
    must: ['sp.gains', 'g.name'],
    never: ['专属特殊属性升一级'],
  }],
  ['src/theme.js', {
    must: ["critDamage: 'crosshair'", "auraPenetration: 'aura'"],
    never: [],
  }],
];

const out = [];
let bad = 0;
for (const [file, spec] of SPEC) {
  const p = path.join(ROOT, file);
  let src = '';
  try { src = fs.readFileSync(p, 'utf8'); } catch (e) {
    out.push(`! ${file}: 读不到（${e.code}）`);
    bad++;
    continue;
  }
  const miss = (spec.must || []).filter((m) => src.indexOf(m) < 0);
  const leftovers = (spec.never || []).filter((m) => src.indexOf(m) >= 0);
  const okFile = miss.length === 0 && leftovers.length === 0;
  if (!okFile) bad++;
  out.push(`${okFile ? ' ok ' : 'FAIL'} ${file}`);
  if (miss.length) out.push(`       缺: ${miss.join(' ; ')}`);
  if (leftovers.length) out.push(`       残留: ${leftovers.join(' ; ')}`);
}
out.push('');
out.push(`=== 落盘核对：${SPEC.length} 个文件，问题 ${bad} ===`);
fs.writeFileSync(path.join(__dirname, '_verify-edit.txt'), out.join('\n'), 'utf8');
process.exitCode = bad ? 1 : 0;
