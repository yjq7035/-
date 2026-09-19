// 针对性探针：平行塔攻击弹道（迷你双横）
// 背景：弹道绘制 switch 曾漏掉 'parallel' case → 静默不画，子弹隐身。
// 判据：渲染一帧后，弹道位置附近必须出现 2 条 roundRect 横杠（等宽等高 / 左对齐 /
//       有缝 / 横向），且弹道**不随攻击朝向旋转**（政策 FIXED，见 src/aim.js）。
const path = require('path');
const fs = require('fs');
const { makeCtx, makeRec } = require(path.join(__dirname, 'harness'));

global.document = { addEventListener() {}, removeEventListener() {} };
global.requestAnimationFrame = () => 0;

const ROOT = path.join(__dirname, '..', '..');
const Game = require(path.join(ROOT, 'src', 'game_core'));
const renderer = require(path.join(ROOT, 'src', 'renderer'));

const out = [];
const ok = (name, cond, detail) => out.push(`${cond ? '[ ok ]' : '[FAIL]'} ${name}${detail ? '  ||  ' + detail : ''}`);
const log = (s) => out.push(s);

const W = 390, H = 700;
const rec = makeRec();
const ctx = makeCtx(rec);

// 间谍：记录 rotate 调用（验证"弹道保持正立"的反向旋转）
const rotations = [];
const r0 = ctx.rotate.bind(ctx);
ctx.rotate = (a) => { rotations.push(a); return r0(a); };

const canvas = { width: W, height: H, addEventListener() {}, removeEventListener() {}, getContext() { return ctx; } };
const game = new Game(canvas, ctx, { screenWidth: W, screenHeight: H, renderScale: 1 });

// 空战场 + 一枚平行塔弹道（朝右下 45° 发射）
const ANGLE = Math.PI / 4;
game.towers = [];
game.enemies = [];
game.projectiles = [{
  x: 300, y: 300,
  targetX: 360, targetY: 360,
  targetType: null, sourceTower: null,
  speed: 300, color: '#00FF7F',
  type: 'parallel', damage: 10,
  alive: true, angle: ANGLE,
}];

rec.rects.length = 0;
rec.ops.length = 0;
rotations.length = 0;

let threw = null;
try { renderer.render(game); } catch (e) { threw = e; }

ok('渲染不抛异常', !threw, threw ? String(threw && threw.stack || threw).split('\n')[0] : '');

// 修复前：parallel 掉出 switch → 不画任何形状（0 条 roundRect / 0 次 fill）
// 全帧 UI（顶栏按钮等）也会画 roundRect，按弹道几何尺寸过滤：
//   size=3 → pBarW=6.6, pBarH=2.4
const projBars = rec.rects.filter((r) => r.kind === 'roundRect'
  && Math.abs(r.w - 6.6) < 0.05 && Math.abs(r.h - 2.4) < 0.05);
ok('弹道被真实绘制（恰好 2 条横杠，修复前为 0）', projBars.length === 2, `匹配到 ${projBars.length} 条`);

if (projBars.length === 2) {
  const bars = projBars.slice(0, 2).sort((p, q) => p.y - q.y);
  const [a, b] = bars;
  ok('两条等宽等高', Math.abs(a.w - b.w) < 0.01 && Math.abs(a.h - b.h) < 0.01, `${a.w}x${a.h} / ${b.w}x${b.h}`);
  ok('宽 ≈ size×2.2（迷你双横，非塔本体尺寸）', Math.abs(a.w - 6.6) < 0.01 && Math.abs(a.h - 2.4) < 0.01, `w=${a.w} h=${a.h}`);
  ok('左边缘对齐（同一根竖轴）', Math.abs(a.x - b.x) < 0.01, `x=${a.x} / ${b.x}`);
  ok('上下排布且留缝', b.y - (a.y + a.h) > 0.5, `缝 ${(b.y - (a.y + a.h)).toFixed(2)}px`);
  ok('横长（宽 > 高×2，确实是"横"）', a.w > a.h * 2, `${a.w} > ${a.h * 2}`);
}

// 弹道随攻击朝向发射（angle=45°），但双横必须保持正立。
// 2026-09-19：转向政策迁到 src/aim.js（塔本体与弹道都是 FIXED），
// 由 applyProjectileTransform 直接**不施加**旋转 —— 旧版那句手写的
// 反向 rotate(-angle) 补丁已删除，所以判据从"必须反向转"改成"一次都不转"。
//
// ⚠️ 别用整帧 render 的 rotate 序列判这个：导航栏箭头本身就会 rotate(±π/4)，
//    与 45° 的弹道角撞值（本探针第一版就是这么假红的）。改为直接调弹道层。
{
  const rotationsOfLayer = (proj) => {
    game.projectiles = [proj];
    rotations.length = 0;
    renderer.drawProjectiles(game);
    return rotations.slice();
  };
  const base = { x: 300, y: 300, targetX: 360, targetY: 360, targetType: null, sourceTower: null,
    speed: 300, alive: true, angle: ANGLE, damage: 10 };
  const pRots = rotationsOfLayer(Object.assign({}, base, { type: 'parallel', color: '#00FF7F' }));
  ok('平行塔弹道：政策 FIXED → 弹道层一次都不旋转', pRots.length === 0,
    `rotations=[${pRots.map((v) => v.toFixed(3)).join(', ')}]`);
  // 正向对照：跟随朝向的塔型必须**恰好**转一次，且角度 = 弹道朝向
  const tRots = rotationsOfLayer(Object.assign({}, base, { type: 'triangle', color: '#FF4444' }));
  ok('对照：三角塔弹道恰好按朝向转一次', tRots.length === 1 && Math.abs(tRots[0] - ANGLE) < 1e-9,
    `rotations=[${tRots.map((v) => v.toFixed(3)).join(', ')}]`);
  // 恢复平行塔弹道，供下面"有绘制动作"的断言用（顺手重绘一次，让 rec.ops 反映它）
  game.projectiles = [Object.assign({}, base, { type: 'parallel', color: '#00FF7F' })];
  renderer.drawProjectiles(game);
}

// 弹道本体 fill 过（修复前 case 缺失连 fill 都不会发生——这里顺带断言 ops 非空）
ok('本帧有 fill/stroke 绘制动作', rec.ops.some((o) => o[0] === 'fill' || o[0] === 'stroke'));

fs.writeFileSync(path.join(__dirname, '..', 'tmp', '_parallel_proj.txt'),
  ['===== 平行塔攻击弹道探针 =====', ...out, ''].join('\n'));
console.log('done');
