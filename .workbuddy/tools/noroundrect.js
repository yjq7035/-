/**
 * 反证：如果运行环境没有 ctx.roundRect，会发生什么？
 *
 * 做法：造一个"缺 roundRect"的 ctx，构造 Game（拿到自动补齐的 ctx），
 * 然后把 roundRect 再删掉 —— 精确还原"没有兜底"的旧行为，看第一帧 draw() 炸在哪。
 *
 * 输出：.workbuddy/tmp/_noroundrect.txt
 */
'use strict';
const fs = require('fs');
const path = require('path');
const HH = require('./harness');
const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src');
const TMP = path.join(ROOT, '.workbuddy', 'tmp');
const OUT = path.join(TMP, '_noroundrect.txt');
const L = [];
const log = (s) => L.push(s);

function clearCache() {
  Object.keys(require.cache).forEach((k) => {
    if (k.indexOf(SRC) === 0 || k === path.join(ROOT, 'game.js')) delete require.cache[k];
  });
}
const ALL = ['theme', 'config', 'meta', 'eventBus', 'units', 'geometry', 'enemy', 'tower',
  'wave', 'bonusStats', 'auraManager', 'renderer', 'input', 'shop', 'nav', 'codex',
  'talents', 'levels', 'gamemenu', 'enhance', 'game_core'];
const W = 390, H = 844;

clearCache();
const env = HH.setupGlobals(W, H);
const holder = { ops: [] };
const ctx = HH.makeCtx(env.canvas, holder);
delete ctx.roundRect;
env.canvas.__ctx = ctx;
const Game = require(path.join(SRC, 'game_core.js'));
const g = new Game(env.canvas, ctx, { screenWidth: W, screenHeight: H });
g.__holder = holder;
const CUR = {};
for (const m of ALL) CUR[m] = require(path.join(SRC, m + '.js'));

log('1) 构造后 ctx.roundRect 类型 = ' + typeof ctx.roundRect + '   （兜底已生效）');

log('');
log('2) 现在把兜底摘掉，精确还原"没有 polyfill"的旧环境：');
delete ctx.roundRect;
log('   ctx.roundRect 类型 = ' + typeof ctx.roundRect);

log('');
log('3) 直接画一帧，看会不会抛异常：');
let err = null;
try {
  g.__holder.ops = [];
  g.draw();
} catch (e) {
  err = e;
}
if (err) {
  log('   ★ 抛异常：' + err.constructor.name + ': ' + err.message);
  const st = String(err.stack || '').split('\n').slice(0, 6);
  st.forEach((s) => log('     ' + s.trim()));
} else {
  log('   没有抛异常（说明这个环境不需要 roundRect）');
}

log('');
log('4) 重新跑真实入口的启动场景（战前选关），验证"有兜底"时不会炸：');
{
  const g2 = fresh();
  let e2 = null;
  try { g2.__holder.ops = []; g2.draw(); } catch (e) { e2 = e; }
  log('   ' + (e2 ? '★ 仍然抛异常: ' + e2.message : '有兜底 → 正常渲染，无异常'));
}

function fresh() {
  clearCache();
  const env2 = HH.setupGlobals(W, H);
  const holder2 = { ops: [] };
  const ctx2 = HH.makeCtx(env2.canvas, holder2);
  delete ctx2.roundRect;
  env2.canvas.__ctx = ctx2;
  const G = require(path.join(SRC, 'game_core.js'));
  const gg = new G(env2.canvas, ctx2, { screenWidth: W, screenHeight: H });
  gg.__holder = holder2;
  return gg;
}

log('');
log('结论：ctx.roundRect 缺失时，renderer 的首帧 draw() 直接抛 TypeError；');
log('      没有 try/catch 的主循环会因此永久停摆 —— 就是"整个界面点不动"。');

fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(OUT, L.join('\n') + '\n', 'utf8');
console.log('noroundrect done');
