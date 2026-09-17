// ============================================================================
// 背景音乐专项探针 —— .workbuddy/tools/probe-audio.js
// ----------------------------------------------------------------------------
// 为什么需要它：smoke.js 只证明"加了音频代码之后没把画面改坏"，它证明不了
//   · 音乐到底会不会响（autoplay 有没有真的调 play）
//   · 开关切了之后是不是真的停了 / 真的续上
//   · 切后台再回前台，音乐该不该复活
//   · 自动播放被静默拦截时，触摸兜底解锁有没有生效
// 而在裸 node 里没有 wx，音频模块会整体降级 —— 于是必须**伪造一个 wx**。
// 本探针用一个记录式假 wx（可观测 play/pause 调用次数、可手动触发事件回调），
// 把 audio.js 的状态机完整跑一遍。
//
// 覆盖三块：
//   A. 音频状态机（假 wx）：初始化 / 开关 / 前后台 / 兜底解锁 / 事件回调 / 幂等
//   B. 顶栏按钮几何：7 种分辨率下不与 ☰、不与关卡徽标重叠，且不顶出顶栏
//   C. 渲染与输入：扬声器图标必须画在自己的按钮矩形内（同"文字 ⊆ 裁剪区"的思路），
//      以及真实点按真的能切换开关
//
// 报告输出：tools/_audio.txt
// ============================================================================
const path = require('path');
const fs = require('fs');
const { makeCtx, makeRec } = require('./harness');

global.document = { addEventListener() {}, removeEventListener() {} };
global.requestAnimationFrame = () => 0;

const ROOT = path.resolve(__dirname, '..', '..');
const out = [];
let fails = 0;
const ok = (name, cond, detail) => {
  if (!cond) fails++;
  out.push(`${cond ? '  ok  ' : ' FAIL '} ${name}${detail ? '  → ' + detail : ''}`);
};

/** 清掉本工程所有模块缓存 —— 让 audio/gamemenu/input/renderer 拿到同一份新实例 */
function purgeProjectModules() {
  for (const k of Object.keys(require.cache)) {
    if (k.startsWith(ROOT) && !/harness|probe-audio/.test(k)) delete require.cache[k];
  }
}

/**
 * 伪造 wx。
 * @param {object} [opt]
 *   opt.silentPlay   true = play() 不派发 onPlay（模拟"自动播放被静默拦截"）
 *   opt.seedEnabled  预置存档里的音乐开关偏好
 */
function makeFakeWx(opt) {
  opt = opt || {};
  const log = { play: 0, pause: 0, stop: 0, destroy: 0, instances: 0, options: [] };
  const store = {};
  if (opt.seedEnabled !== undefined) store['graphic_td_audio_v1'] = JSON.stringify({ enabled: !!opt.seedEnabled });

  const inst = {
    src: '', loop: false, volume: 1, obeyMuteSwitch: true, paused: true,
    _h: {},
    onError(f) { this._h.error = f; },
    onPlay(f) { this._h.play = f; },
    onPause(f) { this._h.pause = f; },
    onEnded(f) { this._h.ended = f; },
    onCanplay(f) { this._h.canplay = f; },
    play() {
      log.play++;
      // silentPlay：模拟"自动播放被静默拦截"。⚠️ 只拦**第一次**（无手势那次），
      // 之后由用户手势触发的 play 必须正常生效 —— 否则就分不清
      // "兜底没生效" 还是 "假 wx 把兜底也拦了"（两者都表现为 paused 仍是 true）。
      if (opt.silentPlay && log.play === 1) return;
      this.paused = false;
      if (this._h.play) this._h.play();
    },
    pause() { log.pause++; this.paused = true; if (this._h.pause) this._h.pause(); },
    stop() { log.stop++; this.paused = true; },
    destroy() { log.destroy++; },
  };

  // 事件表用**数组**而不是单槽：wx.onXxx 是累积注册，
  // game_core 与 audio.js 会各自注册一份 touchstart，单槽实现会把前一个冲掉。
  const listeners = { start: [], move: [], end: [], cancel: [], show: [], hide: [] };
  const add = (k, f) => { if (typeof f === 'function' && listeners[k].indexOf(f) < 0) listeners[k].push(f); };
  const del = (k, f) => { listeners[k] = listeners[k].filter((x) => x !== f); };

  const wx = {
    _log: log, _store: store, _inst: inst,
    _fire(k) { listeners[k].slice().forEach((f) => f()); },
    _count(k) { return listeners[k].length; },
    createInnerAudioContext() { log.instances++; return inst; },
    setInnerAudioOption(o) { log.options.push(o); },
    setStorageSync(k, v) { store[k] = v; },
    getStorageSync(k) { return store[k] === undefined ? '' : store[k]; },
    onShow(f) { add('show', f); }, offShow(f) { del('show', f); },
    onHide(f) { add('hide', f); }, offHide(f) { del('hide', f); },
    onTouchStart(f) { add('start', f); }, offTouchStart(f) { del('start', f); },
    onTouchMove(f) { add('move', f); }, offTouchMove(f) { del('move', f); },
    onTouchEnd(f) { add('end', f); }, offTouchEnd(f) { del('end', f); },
    onTouchCancel(f) { add('cancel', f); }, offTouchCancel(f) { del('cancel', f); },
  };
  return wx;
}

function loadAudio(wxStub) {
  if (wxStub) global.wx = wxStub; else delete global.wx;
  purgeProjectModules();
  return { audio: require(path.join(ROOT, 'src', 'audio')),
           config: require(path.join(ROOT, 'src', 'config')) };
}

// ============================================================================
// A. 音频状态机
// ============================================================================
out.push('===== A. 音频状态机（假 wx）=====');

{
  const wx = makeFakeWx();
  const { audio, config } = loadAudio(wx);
  const inst = wx._inst;

  ok('init() 报告可用', audio.init() === true, `available=${audio.isAvailable()}`);
  ok('配置正确落到实例上',
    inst.src === config.MUSIC.src && inst.loop === true && inst.volume === config.MUSIC.volume,
    `src=${inst.src} loop=${inst.loop} volume=${inst.volume}`);
  ok('设置了音频会话选项（静音键/混音）',
    wx._log.options.length === 1
    && wx._log.options[0].obeyMuteSwitch === config.MUSIC.obeyMuteSwitch
    && wx._log.options[0].mixWithOther === config.MUSIC.mixWithOther,
    JSON.stringify(wx._log.options[0] || null));
  ok('启动即自动播放（play 调了 1 次）', wx._log.play === 1, `play=${wx._log.play}`);
  ok('isPlaying() 反映真实播放态', audio.isPlaying() === true, `paused=${inst.paused}`);

  // --- 幂等 ---
  audio.init();
  audio.init();
  ok('init() 幂等（只创建过 1 个实例）', wx._log.instances === 1, `instances=${wx._log.instances}`);

  // --- 开关 ---
  ok('toggle() 关闭并返回 false', audio.toggle() === false, `enabled=${audio.isEnabled()}`);
  ok('关闭后真的暂停了', wx._log.pause === 1 && audio.isPlaying() === false, `pause=${wx._log.pause}`);
  ok('关闭状态写进了存档（重启后不该自己响）',
    String(wx._store['graphic_td_audio_v1']).indexOf('false') >= 0, String(wx._store['graphic_td_audio_v1']));

  ok('toggle() 再开启并返回 true', audio.toggle() === true, `enabled=${audio.isEnabled()}`);
  ok('开启后真的续播了', wx._log.play === 2, `play=${wx._log.play}`);

  // --- 前后台 ---
  audio.setEnabled(true);
  const p0 = wx._log.pause, q0 = wx._log.play;
  wx._fire('hide');
  ok('切后台：暂停', wx._log.pause === p0 + 1, `pause ${p0}→${wx._log.pause}`);
  wx._fire('show');
  ok('回前台：自动续播（用户没关音乐）', wx._log.play === q0 + 1, `play ${q0}→${wx._log.play}`);

  audio.setEnabled(false);
  const p1 = wx._log.pause, q1 = wx._log.play;
  wx._fire('hide');
  wx._fire('show');
  ok('回前台：用户已关音乐 → 绝不自己复活', wx._log.play === q1, `play ${q1}→${wx._log.play}（应不变）`);
  ok('回前台：用户已关音乐 → 也不再多暂停一次', wx._log.pause === p1 + 1, `pause ${p1}→${wx._log.pause}`);

  // --- 事件回调不许抛 ---
  let cbErr = null;
  try {
    if (inst._h.error) inst._h.error({ errMsg: 'decode fail', errCode: 10001 });
    if (inst._h.ended) inst._h.ended();
    if (inst._h.canplay) inst._h.canplay();
  } catch (e) { cbErr = e; }
  ok('onError / onEnded 回调不抛异常（音乐坏了不能带崩游戏）', !cbErr, cbErr ? cbErr.message : 'ok');
  ok('错误被记进状态快照（便于诊断）',
    (audio.getState().error || '').indexOf('decode fail') >= 0, String(audio.getState().error));

  // --- loop 失效兜底：onEnded 时若仍希望播放，应补一次 play ---
  audio.setEnabled(true);
  const q2 = wx._log.play;
  inst._h.ended();
  ok('onEnded 兜底续播（防某些环境不循环）', wx._log.play === q2 + 1, `play ${q2}→${wx._log.play}`);
}

// --- 存档偏好：关着进游戏，不该自动响 ---
{
  const wx = makeFakeWx({ seedEnabled: false });
  const { audio } = loadAudio(wx);
  audio.init();
  ok('存档记录"用户关过音乐" → 启动不自动播放',
    wx._log.play === 0 && audio.isEnabled() === false, `play=${wx._log.play} enabled=${audio.isEnabled()}`);
}

// --- 静默拦截兜底：play() 不报错也不出声 → 首次触摸补一次 ---
{
  const wx = makeFakeWx({ silentPlay: true });
  const { audio } = loadAudio(wx);
  audio.init();
  ok('自动播放被静默拦截：调了 play 却没真的响（不报错）',
    wx._log.play === 1 && audio.isPlaying() === false,
    `play=${wx._log.play} playing=${audio.isPlaying()}`);

  ok('已挂上一次性触摸解锁监听', wx._count('start') === 1, `start 监听 ${wx._count('start')} 个`);
  wx._fire('start');
  ok('首次触摸补一次 play（这是静默失败唯一的兜底手段）',
    wx._log.play === 2, `play=${wx._log.play}`);
  {
    const st = audio.getState();
    ok('兜底之后真的响了', st.playing === true,
      `playing=${st.playing} paused=${wx._inst.paused} play次数=${wx._log.play} available=${st.available} enabled=${st.enabled} error=${st.error}`);
  }
  ok('解锁后监听被摘掉（不在触摸回调里长期占位）',
    wx._count('start') === 0, `start 监听 ${wx._count('start')} 个`);

  // 用户主动关掉后，触摸不该把它又打开（此时已无监听可触发，属兜底再确认）
  audio.setEnabled(false);
  const q = wx._log.play;
  wx._fire('start');
  ok('用户已关音乐 → 触摸兜底不会把它偷偷打开', wx._log.play === q, `play=${q}→${wx._log.play}`);
}

// --- 非微信环境（node 冒烟 / 浏览器）必须整体安全降级 ---
{
  const { audio } = loadAudio(null);
  let err = null;
  let r;
  try {
    r = audio.init();
    const st = audio.getState();
    audio.toggle();
    audio.setEnabled(true);
    audio.play();
    audio.pause();
    ok('无 wx：init() 返回 false 且接口全都安全',
      r === false && st.available === false && audio.isPlaying() === false && typeof audio.isEnabled() === 'boolean',
      `init=${r} available=${st.available} enabled=${st.enabled}`);
  } catch (e) { err = e; }
  ok('无 wx：任何接口都不抛异常（否则整条冒烟测试会挂在这）', !err, err ? err.message : 'ok');
}

// ============================================================================
// B + C. 按钮几何 / 渲染 / 输入
// ============================================================================
out.push('');
out.push('===== B. 顶栏按钮几何（7 分辨率）=====');

const wxB = makeFakeWx();
global.wx = wxB;
purgeProjectModules();

const Game = require(path.join(ROOT, 'src', 'game_core'));
const renderer = require(path.join(ROOT, 'src', 'renderer'));
const input = require(path.join(ROOT, 'src', 'input'));
const gamemenu = require(path.join(ROOT, 'src', 'gamemenu'));
const audioB = require(path.join(ROOT, 'src', 'audio'));
const levels = require(path.join(ROOT, 'src', 'levels'));
const { LAYOUT } = require(path.join(ROOT, 'src', 'config'));

audioB.init();

const RES = [320, 360, 375, 390, 414, 428, 768];
const rec = makeRec();
const ctx = makeCtx(rec);

function mkGame(W, H) {
  const canvas = { width: W, height: H, addEventListener() {}, removeEventListener() {}, getContext() { return ctx; } };
  return new Game(canvas, ctx, { screenWidth: W, screenHeight: H, renderScale: 1 });
}

function overlap(a, b) {
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
}

for (const W of RES) {
  const H = 844;
  const g = mkGame(W, H);
  const m = gamemenu.getMusicButtonRect(g);
  const menu = gamemenu.getMenuButtonRect(g);
  const badge = levels.getLevelBadgeRect(g);
  const tb = LAYOUT.topBarHeight;

  const checks = [
    ['不与 ☰ 重叠', !overlap(m, menu)],
    ['不与关卡徽标重叠', !overlap(m, badge)],
    ['不顶出屏幕', m.x >= 0 && m.x + m.w <= W],
    ['不顶出顶栏', m.y >= 0 && m.y + m.h <= tb],
    ['触摸目标够大（≥24px）', m.w >= 24 && m.h >= 24],
    ['与 ☰ 同尺寸（视觉成一套）', m.w === menu.w && m.h === menu.h],
    ['纵向与 ☰ 对齐', m.y === menu.y],
  ];
  const bad = checks.filter((c) => !c[1]).map((c) => c[0]);
  ok(`W=${W}`, bad.length === 0,
    `music=[${m.x},${m.y},${m.w},${m.h}] menu=[${menu.x},${menu.y}] badge右=${badge.x + badge.w}` +
    (bad.length ? ` ｜ 违规：${bad.join('、')}` : ''));
}

out.push('');
out.push('===== C. 图标渲染 & 点击 —— 断言"图标必须画在自己按钮里" =====');

const g0 = mkGame(390, 844);

// 扬声器图标（开启态）
// ⚠️ harness 的 fill/stroke 记的是 ['fill', {x,y,w,h}]（对象，不是数组），
//    用 Array.isArray 过滤会得到空集 —— 那会让下面的断言"零绘制也通过"。
const opBoxes = (rec) => rec.ops.filter((o) => o[1] && typeof o[1] === 'object' && typeof o[1].w === 'number');

rec.ops.length = 0; rec.rects.length = 0; rec.texts.length = 0; rec.clips.length = 0;
audioB.setEnabled(true);
gamemenu.drawMusicButton(g0);
{
  const r = gamemenu.getMusicButtonRect(g0);
  const ops = opBoxes(rec);
  // 允许 1px 描边溢出容差
  const esc = ops.filter((o) => {
    const b = o[1];
    return b.x < r.x - 1 || b.y < r.y - 1 || b.x + b.w > r.x + r.w + 1 || b.y + b.h > r.y + r.h + 1;
  });
  ok('开启态：所有绘制都落在按钮矩形内', ops.length > 0 && esc.length === 0,
    `绘制 ${ops.length} 组，越界 ${esc.length} 组` + (esc.length ? ' 首个=' + JSON.stringify(esc[0][1]) : ''));
  ok('开启态：图标水平居中于按钮（±2px 容差）',
    (() => { const b = ops[0] && ops[0][1]; return b ? Math.abs((b.x + b.w / 2) - (r.x + r.w / 2)) <= 2 : false; })(),
    JSON.stringify(ops[0] && ops[0][1]));
}

// 扬声器图标（关闭态 = 画叉，不是不画）
rec.ops.length = 0;
audioB.setEnabled(false);
gamemenu.drawMusicButton(g0);
const offOps = opBoxes(rec);
ok('关闭态：仍然画图标（画叉），不是一片空白', offOps.length > 0, `${offOps.length} 组绘制`);
{
  const r = gamemenu.getMusicButtonRect(g0);
  const esc = offOps.filter((o) => {
    const b = o[1];
    return b.x < r.x - 1 || b.y < r.y - 1 || b.x + b.w > r.x + r.w + 1 || b.y + b.h > r.y + r.h + 1;
  });
  ok('关闭态：所有绘制都落在按钮矩形内', esc.length === 0, `越界 ${esc.length} 组`);
}

// ---- 真实点按：点按钮 → 开关切换 ----
function tapAt(g, x, y) {
  const ev = { touches: [{ clientX: x, clientY: y, x, y }], changedTouches: [{ clientX: x, clientY: y, x, y }] };
  input.handleTouchStart(g, ev);
  input.handleTouchEnd(g, ev);
}

{
  const g = mkGame(390, 844);
  g.scene = 'battle';
  g.battleStarted = true;
  audioB.setEnabled(true);

  const r = gamemenu.getMusicButtonRect(g);
  tapAt(g, r.x + r.w / 2, r.y + r.h / 2);
  ok('战斗中真实点按 🔊：音乐被关闭', audioB.isEnabled() === false, `enabled=${audioB.isEnabled()}`);

  tapAt(g, r.x + r.w / 2, r.y + r.h / 2);
  ok('战斗中真实点按 🔊 第二次：音乐被打开', audioB.isEnabled() === true, `enabled=${audioB.isEnabled()}`);

  // 点关卡徽标（顶栏左侧）不应误触音乐开关
  const before = audioB.isEnabled();
  tapAt(g, 40, 17);
  ok('点顶栏关卡徽标：不误触音乐开关', audioB.isEnabled() === before, `enabled=${audioB.isEnabled()}`);

  // 按下与抬起不在同一按钮 → 不生效（与其它按钮同款守卫）
  const m = gamemenu.getMusicButtonRect(g);
  const menuR = gamemenu.getMenuButtonRect(g);
  const before2 = audioB.isEnabled();
  input.handleTouchStart(g, { touches: [{ clientX: m.x + 4, clientY: m.y + 10, x: m.x + 4, y: m.y + 10 }] });
  input.handleTouchEnd(g, { changedTouches: [{ clientX: menuR.x + 4, clientY: menuR.y + 10, x: menuR.x + 4, y: menuR.y + 10 }] });
  ok('按下在 🔊、抬起滑到 ☰：不触发音乐切换',
    audioB.isEnabled() === before2, `enabled=${audioB.isEnabled()}`);

  // 顶栏布局改动后，☰ 仍然好使
  tapAt(g, menuR.x + menuR.w / 2, menuR.y + menuR.h / 2);
  ok('☰ 菜单按钮在加了 🔊 之后依然可点', g.showMenu === true, `showMenu=${!!g.showMenu}`);
}

// ---- 回归：战前选关界面也必须能关音乐 ----
// 音乐从启动那刻就在响，而玩家第一眼看到的是选关界面。
// 输入路由若把顶栏判定排在"战前选关"之后，这个按钮在开局就是死的。
{
  const g = mkGame(390, 844);
  g.scene = 'battle';
  g.battleStarted = false;       // 尚未开打 —— 正是启动后的真实状态
  audioB.setEnabled(true);

  const r = gamemenu.getMusicButtonRect(g);
  tapAt(g, r.x + r.w / 2, r.y + r.h / 2);
  ok('战前选关：点按 🔊 能关掉音乐（音乐一进游戏就在响）',
    audioB.isEnabled() === false, `enabled=${audioB.isEnabled()}`);

  tapAt(g, r.x + r.w / 2, r.y + r.h / 2);
  ok('战前选关：再点一次能开回来', audioB.isEnabled() === true, `enabled=${audioB.isEnabled()}`);

  // 未开打时 ☰ 仍然是死的（"战中菜单"不该在选关界面能打开）
  const menuR = gamemenu.getMenuButtonRect(g);
  tapAt(g, menuR.x + menuR.w / 2, menuR.y + menuR.h / 2);
  ok('战前选关：☰ 打不开（战中菜单不该在开局就能开）', !g.showMenu, `showMenu=${!!g.showMenu}`);
}

// ---- 整帧渲染不该抛（含顶栏两个按钮）----
{
  const g = mkGame(390, 844);
  g.scene = 'battle';
  let err = null;
  try { renderer.render(g); } catch (e) { err = e; }
  ok('整帧渲染（含顶栏 🔊）不抛异常', !err, err ? err.message : 'ok');
}

// ============================================================================
// D. 音乐开关到底在哪些场景被画出来？（把"哪些页面有这个按钮"变成事实）
// ============================================================================
// 做法：包一层 spy 统计 drawMusicButton 的调用次数。
// renderer 是通过 gamemenu.drawMusicButton(...) 属性访问调用的，
// 所以替换模块对象上的属性就能拦到，不用改产品代码。
out.push('');
out.push('===== D. 音乐开关出现在哪些场景 =====');
{
  const origDraw = gamemenu.drawMusicButton;
  let calls = 0;
  gamemenu.drawMusicButton = function () { calls++; return origDraw.apply(this, arguments); };

  const scenes = ['battle', 'codex', 'talents', 'bag'];
  const seen = {};
  for (const sc of scenes) {
    const g = mkGame(390, 844);
    g.scene = sc;
    g.gemPicker = null;
    g.codexSelected = null;
    calls = 0;
    try { renderer.render(g); } catch (e) { /* 场景自身问题与本项无关 */ }
    seen[sc] = calls;
  }
  gamemenu.drawMusicButton = origDraw;

  out.push(`  drawMusicButton 调用次数：${scenes.map((s) => s + '=' + seen[s]).join('  ')}`);
  ok('战斗场景：有音乐开关', seen.battle > 0, `battle=${seen.battle}`);
  ok('图签场景：当前**没有**音乐开关', seen.codex === 0, `codex=${seen.codex}`);
  ok('天赋场景：当前**没有**音乐开关', seen.talents === 0, `talents=${seen.talents}`);
  ok('背包场景：当前**没有**音乐开关', seen.bag === 0, `bag=${seen.bag}`);
}

out.push('');
out.push(`=== 音频专项汇总：失败 ${fails} 条 ===`);
fs.writeFileSync(path.join(__dirname, '_audio.txt'), out.join('\n'), 'utf8');
process.exitCode = fails ? 1 : 0;
