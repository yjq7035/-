const fs = require('fs');
const out = [];
const log = s => out.push(s);
const check = (n, c, e) => log((c ? 'PASS ' : 'FAIL ') + n + (e ? '  [' + e + ']' : ''));

// 游戏宿主在运行期注入的全局（本机 node 没有，手动打桩以跑通真实方法）
global.THEME = { accent: { gold: '#ffd700', danger: '#ff5555', violet: '#aa55ff' }, text: { dim: '#999', off: '#777', primary: '#fff' } };

let Game = null, meta = null;
try {
  meta = require('F:/图形塔防/src/meta.js');
  const gc = require('F:/图形塔防/src/game_core.js');
  Game = (typeof gc === 'function') ? gc : (gc.Game || null);   // module.exports = Game
  log('require ok; Game=' + (Game ? 'yes' : 'no'));
} catch (e) { log('require 失败: ' + e.message + '\n' + e.stack); }

// ---- 1) 真实 addGem 返回的宝石带 lv:1（gemList 会剥 lv，故读返回对象） ----
try {
  const r = meta.addGem('ruby');
  check('addGem 返回宝石对象', r.ok && !!r.gem, 'ok=' + r.ok);
  check('新增宝石 lv===1', r.ok && r.gem && r.gem.lv === 1, 'lv=' + (r.gem && r.gem.lv));
  const r2 = meta.addGemsByKind('sapphire', 2);
  check('addGemsByKind 放入 2 颗', r2.added === 2, 'added=' + r2.added);
} catch (e) { log('addGem 测试抛错: ' + e.message); }

// ---- 2) 真实 grantRewardGems 冒烟 + 结构不变量（不卡 total 范围，因为背包会满） ----
if (Game) {
  try {
    // 直接调真实方法（绕过需要 canvas 的构造函数）
    const proto = Game.prototype;
    const fake = { currentLevel: 1, gemReward: null, toast: null };
    let threw = false, badLen = 0, badCount = 0, litMismatch = 0;
    try {
      for (let n = 0; n < 80; n++) {
        const lv = 1 + (n % 12);
        fake.currentLevel = lv;
        fake.gemReward = null;
        proto.grantRewardGems.call(fake, true, lv);
        const rw = fake.gemReward;
        if (!rw) { threw = true; continue; }
        if (rw.triggered) { if (rw.slots.length !== 9) badLen++; }
        else { if (rw.slots.length !== 0) badLen++; }   // 未触发：空槽（界面显示"本次未获得"）
        let lit = 0;
        for (const s of rw.slots) { if (s) { if (s.count !== 1) badCount++; lit++; } }
        if (lit !== rw.total) litMismatch++;
      }
    } catch (e) { threw = true; log('grantRewardGems 抛错: ' + e.message + '\n' + e.stack); }
    check('80 次真实调用不抛错', !threw);
    check('slots 长度恒为 9', badLen === 0, 'bad=' + badLen);
    check('每格 count 恒为 1（无单格×N）', badCount === 0, 'bad=' + badCount);
    check('点亮格数 === total（含背包满走 0 分支）', litMismatch === 0, 'bad=' + litMismatch);
  } catch (e) { log('Game 构造/调用失败: ' + e.message + '\n' + e.stack); }
} else {
  log('Game 不可用，跳过真实调用测试');
}

// ---- 3) 逐字复刻 slot 算法（capacity 充足），统计不变量 + 触发率 ----
function simSlots(lv, capacity, cellCount, chance) {
  if (Math.random() >= chance) return { triggered: false, slots: [], total: 0 };
  const maxGems = Math.min(cellCount, Math.max(1, Math.floor(lv)));
  const gemCount = 1 + Math.floor(Math.random() * maxGems);
  const actual = Math.min(gemCount, capacity);
  const order = [];
  for (let i = 0; i < cellCount; i++) order.push(i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = order[i]; order[i] = order[j]; order[j] = t;
  }
  const lit = new Set(order.slice(0, actual));
  const slots = []; let total = 0;
  for (let i = 0; i < cellCount; i++) {
    if (lit.has(i)) { slots.push({ kind: 'ruby', count: 1 }); total += 1; }
    else slots.push(null);
  }
  return { triggered: true, slots, total };
}

const CELL = 9;
let badLen2 = 0, badCount2 = 0, litMismatch2 = 0, rangeBad = 0, trig = 0, tot = 0;
const N = 6000;
for (let n = 0; n < N; n++) {
  const lv = 1 + (n % 12);            // 关卡 1..12
  const r = simSlots(lv, 100, CELL, 0.9);
  if (r.triggered) {
    trig++;
    if (r.slots.length !== 9) badLen2++;
    let lit = 0;
    for (const s of r.slots) { if (s) { if (s.count !== 1) badCount2++; lit++; } }
    if (lit !== r.total) litMismatch2++;
    const maxT = Math.min(CELL, lv);
    if (r.total < 1 || r.total > maxT) rangeBad++;
    tot += r.total;
  }
}
check('算法：slots 长度恒为 9', badLen2 === 0, 'bad=' + badLen2);
check('算法：每格 count 恒为 1', badCount2 === 0, 'bad=' + badCount2);
check('算法：点亮格数 === total', litMismatch2 === 0, 'bad=' + litMismatch2);
check('算法：触发时 total ∈ [1, min(9,关卡)]', rangeBad === 0, 'bad=' + rangeBad);
log('算法统计: ' + N + ' 次通关触发 ' + trig + ' 次，触发率=' + (trig / N).toFixed(3) + '（理论 0.9），平均获得=' + (tot / trig).toFixed(2) + ' 颗');

fs.writeFileSync('F:/图形塔防/.workbuddy/tmp/_test_reward2.txt', out.join('\n'));
