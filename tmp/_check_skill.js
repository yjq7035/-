const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const skills = require(path.join(ROOT, 'src', 'skills'));

const out = [];
const mk = (enh) => ({ type: 'triangle', enhanceLevel: enh, enhanceAttrs: {} });

for (const p of [0, 1, 2, 5, 11]) {
  skills.setGemLevelProvider(() => p);
  out.push(`provider=${p}: levelText(0学)=${skills.levelText(mk(0), 'triangle')}` +
    ` levelText(3学)=${skills.levelText(mk(3), 'triangle')}` +
    ` baseCap=${skills.baseLearnCap('triangle')}` +
    ` cap=${skills.learnableCap(mk(0), 'triangle')}` +
    ` cur(3学)=${skills.currentLevel(mk(3), 'triangle')}`);
}

// 需求 5 的三个场景（0/5、2/7、8/13 全是玩家给的原话）
for (const p of [0, 2, 8]) {
  skills.setGemLevelProvider(() => p);
  out.push(`额外=${p} 学习=0 → ${skills.levelText(mk(0), 'triangle')}（期望 ${p}/${p + 5}）`);
}
// 额外等级变化时：只动当前等级，可学基数(5) 纹丝不动
skills.setGemLevelProvider(() => 2);
const a2 = skills.levelText(mk(3), 'triangle');
skills.setGemLevelProvider(() => 8);
const a8 = skills.levelText(mk(3), 'triangle');
out.push(`额外 2→8（学习固定 3）：${a2} → ${a8}（期望 5/7 → 11/13，可学基数始终 ${skills.baseLearnCap('triangle')}）`);

// 复刻玩家截图：半圆塔收到十字塔共享的 +11 技能等级、自己从未强化、自身宝石 0 级
skills.setGemLevelProvider(() => 0);
const shared = { type: 'semicircle', enhanceLevel: 0, enhanceAttrs: {}, auraBuffs: { skillLevels: 11 } };
out.push(`截图场景 半圆塔(共享+11, 0学): ${skills.levelText(shared, 'semicircle')}  (期望 11/16)`);

// 预览态（无实体塔，只有塔型）：learnableCap(type) 兼容字符串调用
skills.setGemLevelProvider(() => 2);
out.push(`预览态 learnableCap('triangle')=${skills.learnableCap('triangle')}  levelText(null)=${skills.levelText(null, 'triangle')}`);

skills.setGemLevelProvider(null);
// 战斗口径：生效次数 = 学习 + 额外（不夹 5），等级 Lv = 1 + 生效次数
out.push(`战斗口径: levelOf(0学)=${skills.levelOf(mk(0))} effectiveTimesOf(0学)=${skills.effectiveTimesOf(mk(0))}` +
  ` levelOf(5学)=${skills.levelOf(mk(5))} effectiveTimesOf(5学)=${skills.effectiveTimesOf(mk(5))} (期望 1 / 0 / 6 / 5)`);
out.push(`audit 问题数=${skills.audit().length}`);

fs.writeFileSync(path.join(__dirname, '_check_skill.txt'), out.join('\n'), 'utf8');
