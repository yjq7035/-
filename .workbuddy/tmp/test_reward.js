// 临时验证：meta.addGemsByKind / bagGemCount + 模拟 grantRewardGems 的逐格逻辑
const fs = require('fs');
const ROOT = 'F:/图形塔防/src';
const meta = require(ROOT + '/meta');
const gems = require(ROOT + '/gems');
const config = require(ROOT + '/config');
const GEM = config.GEM;

const log = [];
function check(name, cond, extra) {
  log.push((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : ''));
}

// 1) 初始背包（新档赠送 ruby/emerald，bagSlots=20）
const initCount = meta.bagGemCount();
check('初始背包=2（starter gems）', initCount === 2, 'got ' + initCount);

// 2) 正常加 5 颗
let r = meta.addGemsByKind('ruby', 5);
check('加5颗 added=5', r.added === 5 && r.ok === true, JSON.stringify(r));
check('加后背包=7', meta.bagGemCount() === 7, 'got ' + meta.bagGemCount());

// 3) 容量上限：bagSlots=20，再塞 100 颗，只能塞 13 颗
r = meta.addGemsByKind('emerald', 100);
check('超容量 added=13', r.added === 13 && r.ok === false && r.reason === 'full', JSON.stringify(r));
check('背包满=20', meta.bagGemCount() === 20, 'got ' + meta.bagGemCount());

// 4) randomKind 返回合法种类
const k = gems.randomKind();
check('randomKind 合法', !!gems.gemDef(k), 'kind=' + k);

// 5) 模拟 grantRewardGems 逐格逻辑（不依赖 Game 实例）
// 先 reset 存档，确保背包不是满的（上面步骤把背包塞满了，会走到"背包满→0颗"分支）
meta.resetAll();
check('reset 后背包=2', meta.bagGemCount() === 2, 'got ' + meta.bagGemCount());
function simReward(victory, lv) {
  const chance = victory ? GEM.victoryChance : GEM.defeatChance;
  if (Math.random() >= chance) return { triggered: false, slots: [], total: 0 };
  const cellCount = GEM.rewardCellCount || 9;
  const maxEach = GEM.gemRewardMax > 0 ? GEM.gemRewardMax : Math.max(1, lv);
  const capacity = Math.max(0, meta.bagSlots() - meta.bagGemCount());
  const slots = []; let total = 0; let bagFull = false;
  for (let i = 0; i < cellCount; i++) {
    const count = 1 + Math.floor(Math.random() * maxEach);
    const kind = gems.randomKind();
    if (!kind) { slots.push(null); continue; }
    const room = capacity - total;
    const add = Math.min(count, Math.max(0, room));
    if (add > 0) {
      const added = meta.addGemsByKind(kind, add).added;
      total += added; slots.push({ kind, count: added });
      if (added < count) bagFull = true;
    } else { bagFull = true; slots.push(null); }
  }
  return { triggered: true, slots, total, bagFull };
}

// 跑 200 次通关模拟，每次用全新背包（resetAll），统计不抛错、slots 长度=9、total 落在 [9,45]
let threw = false, badLen = 0, totalMin = 1e9, totalMax = -1, trig = 0, badRange = 0;
try {
  for (let n = 0; n < 200; n++) {
    meta.resetAll(); // 每次清空背包，避免跨次累积把背包塞满
    const res = simReward(true, 5); // 第5关：每格 1~5
    if (!res.triggered) { trig++; continue; }
    if (res.slots.length !== 9) badLen++;
    if (res.total < 9 || res.total > 45) badRange++;
    totalMin = Math.min(totalMin, res.total);
    totalMax = Math.max(totalMax, res.total);
    for (const s of res.slots) {
      if (s && (s.count < 1 || s.count > 5)) threw = true;
    }
  }
} catch (e) { threw = true; log.push('THROW ' + e.message); }
check('200次模拟不抛错', !threw);
check('slots 长度恒为9', badLen === 0, 'bad=' + badLen);
check('total 恒在 [9,45]', badRange === 0, 'badRange=' + badRange);
check('total 实际区间', totalMin >= 9 && totalMax <= 45, 'min=' + totalMin + ' max=' + totalMax);
log.push('统计：200次通关中触发 ' + (200 - trig) + ' 次，未触发 ' + trig + ' 次（理论~90%）');

fs.writeFileSync('F:/图形塔防/.workbuddy/tmp/_test_reward.txt', log.join('\n') + '\n', 'utf8');
