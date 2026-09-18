// ============================================================================
// 天赋学习花费专项探针 —— .workbuddy/tools/probe-talent.js
// ----------------------------------------------------------------------------
// 被测对象：src/config.js 的 TALENTS / TALENT_COST、src/meta.js 的 talentCost、
//           src/talents.js 的按钮报价。
//
// 需求（2026-09-18 改版）：学习所需随等级增长 ——
//   **学 Lv.N 的花费 = N × 该天赋的基础花费**
//   例：基础花费 2 → Lv.1 花 2 / Lv.2 花 4 / … / Lv.10 花 20（学满合计 110）
//
// 分五组：① 配置契约（每条有 cost、旧 costs 静态价格表必须绝迹）
//        ② 公式（逐级 = N×base、严格递增、等级夹取、未知 id）
//        ③ 结算链路（真扣点 / 不足 1 点也拒绝且分文不扣 / 学满拦下）
//        ④ 展示口径 == 结算口径（渲染后逐行比对按钮上的价格）
//        ⑤ 面板底部提示行（说明了规则，且最窄分辨率也不越界）
// ============================================================================
const path = require('path');
const fs = require('fs');
const { makeCtx, makeRec } = require('./harness');

global.document = { addEventListener() {}, removeEventListener() {} };
global.requestAnimationFrame = () => 0;

const ROOT = path.resolve(__dirname, '..', '..');
const out = [];
let fails = 0;
const log = (s) => out.push(s);
const ok = (name, cond, detail) => {
  if (!cond) fails++;
  log(`${cond ? '  ok  ' : ' FAIL '} ${name}${detail ? '  → ' + detail : ''}`);
};

let Game, config, meta, talents, renderer;
try {
  Game = require(path.join(ROOT, 'src', 'game_core'));
  config = require(path.join(ROOT, 'src', 'config'));
  meta = require(path.join(ROOT, 'src', 'meta'));
  talents = require(path.join(ROOT, 'src', 'talents'));
  renderer = require(path.join(ROOT, 'src', 'renderer'));
} catch (e) {
  fs.writeFileSync(path.join(__dirname, '_talent_error.txt'), (e && e.stack) || String(e), 'utf8');
  process.exit(1);
}

const rec = makeRec();
const ctx = makeCtx(rec);
function mkGame(W, H) {
  const canvas = { width: W, height: H, addEventListener() {}, removeEventListener() {}, getContext() { return ctx; } };
  return new Game(canvas, ctx, { screenWidth: W, screenHeight: H, renderScale: 1 });
}

/** 该天赋的基础花费（探针自己算一遍，用来验 meta 的实现） */
const baseOf = (def) => (typeof def.cost === 'number' && def.cost > 0 ? def.cost : config.TALENT_COST.default);

log('===== ① 配置契约：每条天赋一个"基础花费"，旧静态价格表必须绝迹 =====');
{
  const bad = [];
  for (const def of config.TALENTS) {
    if (!(typeof def.cost === 'number' && def.cost > 0 && Number.isInteger(def.cost))) {
      bad.push(`${def.id}.cost=${def.cost}`);
    }
  }
  ok(`${config.TALENTS.length} 条天赋都有正整数 cost`, bad.length === 0, bad.length ? bad.join(' ; ')
    : config.TALENTS.map((d) => `${d.id}=${d.cost}`).join(' '));

  ok('TALENT_COST.default 存在且 > 0',
    !!(config.TALENT_COST && config.TALENT_COST.default > 0),
    `default=${config.TALENT_COST && config.TALENT_COST.default}`);

  // 唯一真源：旧价格表（costs 数组 / def.costs 取值）不许残留，否则会有人"改了一半"
  const cfgSrc = fs.readFileSync(path.join(ROOT, 'src', 'config.js'), 'utf8');
  const metaSrc = fs.readFileSync(path.join(ROOT, 'src', 'meta.js'), 'utf8');
  const talSrc = fs.readFileSync(path.join(ROOT, 'src', 'talents.js'), 'utf8');
  ok('config.js 里已无 costs 价格表', cfgSrc.indexOf('costs:') < 0,
    cfgSrc.indexOf('costs:') < 0 ? '干净' : '还留着 costs:');
  ok('meta.js 里已无 def.costs 取价', metaSrc.indexOf('def.costs') < 0);
  ok('talents.js 里已无 def.costs 取价', talSrc.indexOf('def.costs') < 0);
}

log('');
log('===== ② 公式：学 Lv.N = N × 基础花费，且随等级严格递增 =====');
{
  const wrong = [];
  const flat = [];
  for (const def of config.TALENTS) {
    const base = baseOf(def);
    let prev = 0;
    for (let n = 1; n <= def.max; n++) {
      const got = meta.talentCost(def.id, n);
      const want = base * n;
      if (got !== want) wrong.push(`${def.id} Lv.${n}: 得 ${got}，应 ${want}`);
      if (n > 1 && got <= prev) flat.push(`${def.id} Lv.${n} 没比 Lv.${n - 1} 贵`);
      prev = got;
    }
  }
  ok('逐级取值 = N × 基础花费（全部天赋 × 全等级）',
    wrong.length === 0, wrong.length ? wrong.slice(0, 5).join(' ; ') : `覆盖 ${config.TALENTS.length * 10} 个价位`);
  ok('价格随等级严格递增（不存在平价/倒挂）', flat.length === 0, flat.slice(0, 5).join(' ; '));

  // 举例口径：基础花费 2 → 2,4,…,20；基础花费 1 → 1,2,…,10
  const two = config.TALENTS.filter((d) => baseOf(d) === 2)[0];
  const one = config.TALENTS.filter((d) => baseOf(d) === 1)[0];
  const seq = (def) => Array.from({ length: def.max }, (_, i) => meta.talentCost(def.id, i + 1)).join(',');
  ok('基础花费 2 的天赋：Lv.1..Lv.10 = 2,4,6,…,20',
    two && seq(two) === '2,4,6,8,10,12,14,16,18,20', two ? `${two.id} → ${seq(two)}` : '没有 cost=2 的天赋');
  ok('基础花费 1 的天赋：Lv.1..Lv.10 = 1,2,3,…,10',
    one && seq(one) === '1,2,3,4,5,6,7,8,9,10', one ? `${one.id} → ${seq(one)}` : '没有 cost=1 的天赋');

  // 边界：0 级不要钱、超上限按上限夹、未知 id 不可学
  const d0 = config.TALENTS[0];
  ok('Lv.0 报价为 0（还没学，不该报价）', meta.talentCost(d0.id, 0) === 0, `${d0.id} → ${meta.talentCost(d0.id, 0)}`);
  ok('等级超上限按 max 夹住（不越界涨价）',
    meta.talentCost(d0.id, d0.max + 5) === baseOf(d0) * d0.max,
    `Lv.${d0.max + 5} → ${meta.talentCost(d0.id, d0.max + 5)}`);
  ok('未知天赋 → Infinity（视为不可学）', meta.talentCost('__nope__', 1) === Infinity);
  ok('非数字等级 → 0（不产生 NaN 报价）',
    meta.talentCost(d0.id, undefined) === 0 && meta.talentCost(d0.id, 'x') === 0,
    `${meta.talentCost(d0.id, undefined)} / ${meta.talentCost(d0.id, 'x')}`);
}

log('');
log('===== ③ 结算链路：按 N×基础花费真扣点 =====');
{
  meta.resetAll();
  const r0 = meta.learnTalent('gold_start');
  ok('天赋点 0 时学不了（reason=points，等级不变）',
    r0.ok === false && r0.reason === 'points' && r0.cost === 1 && meta.talentLevel('gold_start') === 0,
    JSON.stringify(r0));

  meta.resetAll();
  meta.grantTalentPoints(1);
  const r1 = meta.learnTalent('gold_start');
  ok('cost=1 天赋：Lv.1 扣 1 点',
    r1.ok === true && r1.cost === 1 && r1.level === 1 && meta.get().talentPoints === 0,
    `${JSON.stringify(r1)} 余 ${meta.get().talentPoints}`);

  // 逐级报价 + 累计花费（cost=2 天赋：1..10 级合计 2×55 = 110）
  meta.resetAll();
  meta.grantTalentPoints(1000);
  const books = [];
  for (let i = 0; i < 10; i++) {
    const r = meta.learnTalent('gold_gain');
    books.push(r.cost);
  }
  ok('cost=2 天赋逐级实扣 = 2,4,…,20', books.join(',') === '2,4,6,8,10,12,14,16,18,20', books.join(','));
  ok('学满 10 级累计扣 110 点', 1000 - meta.get().talentPoints === 110, `扣了 ${1000 - meta.get().talentPoints}`);
  const rMax = meta.learnTalent('gold_gain');
  ok('学满后再学被拦（maxed，不再扣点）',
    rMax.ok === false && rMax.reason === 'maxed' && meta.get().talentPoints === 890,
    `${JSON.stringify(rMax)} 余 ${meta.get().talentPoints}`);

  // 差 1 点也不许扣（原子性）：Lv.1 要 2 点，只给 1 点
  meta.resetAll();
  meta.grantTalentPoints(1);
  const rPoor = meta.learnTalent('gold_gain');
  ok('点数差 1 点时拒绝且分文不扣',
    rPoor.ok === false && rPoor.reason === 'points' && rPoor.cost === 2
      && meta.get().talentPoints === 1 && meta.talentLevel('gold_gain') === 0,
    `${JSON.stringify(rPoor)} 余 ${meta.get().talentPoints}`);

  // 高等级同理：Lv.5 → Lv.6 要 12 点，给 11 点必须被拦
  meta.resetAll();
  meta.get().talents['gold_gain'] = 5;
  meta.grantTalentPoints(11);
  const rHigh = meta.learnTalent('gold_gain');
  ok('高等级报价确实涨到 12（不是还按第一级的 2 收）',
    rHigh.ok === false && rHigh.cost === 12 && meta.get().talentPoints === 11,
    `${JSON.stringify(rHigh)} 余 ${meta.get().talentPoints}`);
  meta.grantTalentPoints(1);
  const rHigh2 = meta.learnTalent('gold_gain');
  ok('补到 12 点后学得动，且恰好扣光',
    rHigh2.ok === true && rHigh2.level === 6 && rHigh2.cost === 12 && meta.get().talentPoints === 0,
    `${JSON.stringify(rHigh2)} 余 ${meta.get().talentPoints}`);
}

log('');
log('===== ④ 展示口径 == 结算口径：渲染后逐行比对按钮上的价格 =====');
{
  const W = 428, H = 926;
  const g = mkGame(W, H);
  g.scene = 'talents';
  meta.resetAll();
  meta.grantTalentPoints(99999);

  // 每条天赋给一个不同的起始等级（都留 1 级以上，避开"已精通"分支）
  const m = meta.get();
  const lvOf = {};
  config.TALENTS.forEach((def, i) => {
    const lv = Math.min(def.max - 1, i % 4);
    m.talents[def.id] = lv;
    lvOf[def.id] = lv;
  });

  rec.texts.length = 0; rec.rects.length = 0; rec.clips.length = 0; rec.ops.length = 0;
  let err = null;
  try { renderer.render(g); } catch (e) { err = e; }
  ok('天赋页渲染不抛异常', !err, err ? `${err.constructor.name}: ${err.message}` : `${rec.texts.length} 条文字`);

  const L = talents.getTalentLayout(g);
  const mismatch = [];
  let checked = 0;
  for (const row of L.rows) {
    if (row.y + row.h <= L.viewport.y || row.y >= L.viewport.y + L.viewport.h) continue;
    const btn = talents.getLearnButton(row);
    const t = rec.texts.filter((x) => x.text.indexOf('学习') === 0
      && x.y >= btn.y && x.y <= btn.y + btn.h
      && x.x >= btn.x && x.x <= btn.x + btn.w)[0];
    if (!t) { mismatch.push(`${row.def.id}: 按钮上找不到价格文字`); continue; }
    const shown = Number((/✦\s*(\d+)/.exec(t.text) || [])[1]);
    const want = meta.talentCost(row.def.id, lvOf[row.def.id] + 1);
    checked++;
    if (shown !== want) mismatch.push(`${row.def.id} Lv.${lvOf[row.def.id]}→${lvOf[row.def.id] + 1} 显示 ✦${shown}，结算要 ✦${want}`);
  }
  ok(`全部 ${config.TALENTS.length} 行按钮报价 == meta.talentCost`,
    checked === config.TALENTS.length && mismatch.length === 0,
    mismatch.length ? mismatch.join(' | ') : `比对 ${checked} 行`);

  // 同一屏里必须出现多个不同价位（价随等级长，玩家看得见）
  const prices = {};
  for (const row of L.rows) {
    const lv = lvOf[row.def.id];
    prices[meta.talentCost(row.def.id, lv + 1)] = true;
  }
  const uniq = Object.keys(prices).map(Number).sort((a, b) => a - b);
  ok('一屏内价格有高有低（增长可见）', uniq.length >= 4,
    `价位 ${uniq.join('/')}`);
}

log('');
log('===== ⑤ 面板底部提示行：说明规则，且最窄分辨率不越界 =====');
{
  const RES = [[320, 568], [375, 667], [375, 812], [390, 844], [428, 926]];
  const overflow = [];
  let hitLine = 0;
  for (const [W, H] of RES) {
    const g = mkGame(W, H);
    g.scene = 'talents';
    meta.resetAll();
    rec.texts.length = 0; rec.clips.length = 0; rec.ops.length = 0;
    let err = null;
    try { renderer.render(g); } catch (e) { err = e; }
    const hint = rec.texts.filter((x) => x.text.indexOf('基础花费') >= 0)[0];
    if (hint) {
      hitLine++;
      if (hint.x0 < 0 || hint.x1 > W) overflow.push(`${W}x${H}: ${hint.x0.toFixed(1)}..${hint.x1.toFixed(1)}`);
    } else {
      overflow.push(`${W}x${H}: 没画提示行${err ? '（渲染抛错 ' + err.message + '）' : ''}`);
    }
  }
  ok('每个分辨率都画出了"花费 = 等级 × 基础花费"提示', hitLine === RES.length,
    `${hitLine}/${RES.length}`);
  ok('提示行不越界（x0 ≥ 0 且 x1 ≤ W）', overflow.length === 0, overflow.join(' | ') || '全部贴边内');
}

log('');
log(`=== 天赋学习花费专项：${fails} 处异常 ===`);
fs.writeFileSync(path.join(__dirname, '_talent.txt'), out.join('\n'), 'utf8');
process.exitCode = fails ? 1 : 0;
