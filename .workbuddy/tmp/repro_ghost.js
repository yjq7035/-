'use strict';
// 反证：证明"截图里那个绿框"= 菜单「返回战斗」按钮的 buttonFx 幽灵。
// 做法：复现【修复前】的行为（不传 layer + duration 按秒算），看是否画出一条
// 与截图实测一致的绿框（宽 ≈ 252、高 ≈ 48、绿色 rgba(165,214,167)）。
const fs = require('fs');
const path = require('path');
const HH = require('../tools/harness');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src');
const OUT = path.join(__dirname, '_repro_ghost.txt');
const L = [];
function log(s) { L.push(s); }

const W = 390, H = 844;
const env = HH.setupGlobals(W, H);
const holder = { ops: [] };
const ctx = HH.makeCtx(env.canvas, holder);
env.canvas.__ctx = ctx;

const Game = require(path.join(SRC, 'game_core.js'));
const g = new Game(env.canvas, ctx, { screenWidth: W, screenHeight: H });
const input = require(path.join(SRC, 'input.js'));
const gamemenu = require(path.join(SRC, 'gamemenu.js'));
const themeMod = require(path.join(SRC, 'theme.js'));

g.startBattle();
g.openMenu();
const resume = gamemenu.getMenuLayout(g).resume;
log('菜单「返回战斗」按钮矩形 = ' + JSON.stringify(resume));
log('');

// 模拟点「返回战斗」：输入层产生绿色闪烁（这是截图那次操作的来源）
input.flashButton(g, resume, '165,214,167');
log('flashButton 产生的 fx = ' + JSON.stringify(Object.assign({}, g.buttonFx)));
log('');

function bboxOfD(d) {
  const nums = (d.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
  let x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9;
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const x = nums[i], y = nums[i + 1];
    if (x < x1) x1 = x; if (x > x2) x2 = x;
    if (y < y1) y1 = y; if (y > y2) y2 = y;
  }
  return { x1, y1, x2, y2, w: x2 - x1, h: y2 - y1 };
}

// ---------- A. 修复前：商店层无条件绘制 fx（不传 layer） ----------
g.closeMenu();                       // 菜单已关，回到战场
holder.ops = [];
// 旧版 shop.drawShop 的最后一行就是 drawButtonFx(game, ctx) —— 不传 layer
themeMod.drawButtonFx(g, ctx);
const ghostA = holder.ops.filter((o) => String(o.color).toLowerCase() === '#a5d6a7');
log('【修复前】战场一帧里出现的绿框数量 = ' + ghostA.length);
for (const o of ghostA) {
  const b = bboxOfD(o.d);
  log('   kind=' + o.kind + ' 色=' + o.color + ' alpha=' + o.alpha.toFixed(2)
    + ' 位置 ' + b.x1.toFixed(0) + ',' + b.y1.toFixed(0)
    + ' 尺寸 ' + b.w.toFixed(0) + 'x' + b.h.toFixed(0));
}
log('   → 截图实测的幽灵框：画布坐标 x 67..324  y 457..508，即 257x51（含描边外扩）');
log('');

// ---------- 修复后：商店层只画自己层的波纹 ----------
holder.ops = [];
themeMod.drawButtonFx(g, ctx, 'shop');
const ghostB = holder.ops.filter((o) => String(o.color).toLowerCase() === '#a5d6a7');
log('【修复后】同一场景下战场层的绿框数量 = ' + ghostB.length + '（应为 0）');
log('');

// ---------- B. 修复前：duration 单位错的后果 ----------
const beforeT0 = g.buttonFx ? g.buttonFx.t0 : 0;
if (g.buttonFx) {
  const age = 500; // 过了 500ms
  const pOld = age / (g.buttonFx.duration * 1000);   // 旧公式
  const pNew = age / g.buttonFx.duration;            // 新公式
  log('【修复前】500ms 后的进度 p = ' + pOld.toFixed(6) + ' → 波纹还亮着（要 ' + (g.buttonFx.duration * 1000 / 1000) + ' 秒才结束）');
  log('【修复后】500ms 后的进度 p = ' + pNew.toFixed(3) + ' → 已结束，自动清除');
  log('   → 这解释了用户说的"红框一直不消失，直到点更新才消失"：');
  log('     点更新会用新按钮的 fx 覆盖掉旧的，于是旧框"突然没了"。');
}
log('');
log('（本文件只做取证，不改任何产品代码）');

fs.writeFileSync(OUT, L.join('\n'), 'utf8');
console.log(L.join('\n'));
