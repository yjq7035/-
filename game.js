/**
 * 塔防游戏 - 入口文件
 *
 * ===========================================================================
 * ⚠️ 真机「卡在原生启动页」的两轮排查结论（动这里之前必须读完）
 *
 * 【结论 1｜2026-09-16 已定案】真机调试环境 Bug —— 不是本工程的锅
 *
 *   症状：Android 真机 + 微信开发者工具「真机调试」下，画面停在原生启动页，
 *         Console 里反复刷：
 *           TypeError: Cannot read properties of undefined
 *                      (reading 'getSystemNanoTime')
 *             at new Z (WAGamePerformanceUtilsSDK.js:...)
 *             at ... [as getNetworkType] (WAGamePerformanceUtilsSDK.js:...)
 *           [DETECT EVENT] minigame detect tool inject!! enable=true, autoStart=true
 *           [Trace] TraceGlobal not found
 *           [jsbridge] invoke getSystemInfo fail: jsbridge not ready
 *
 *   判据（三条同时成立即可定案，缺一条都别急着归因）：
 *     ① 报错栈**全部落在 WAGamePerformanceUtilsSDK.js / WAGame.js**，
 *        没有一帧是本工程的代码；
 *     ② 同一条栈上的 wx.createCanvas() 与 wx.getPerformance() **一起**抛错
 *        —— 它们共用底层纳秒计时接口；
 *     ③ 模拟器正常、预览/体验版正常，只有「真机调试」挂。
 *
 *   定性：开发者工具「真机调试」注入的性能桩拿不到纳秒计时对象，
 *        基础库性能 SDK 构造即 TypeError。**工具 Bug，与本工程无关。**
 *   佐证（两条独立同源反馈，均可复现）：
 *     · 微信开放社区（小游戏 / Bug / 精选热门，工具 1.06.2504010，Win11）
 *         《相同代码在真机调试下报错，体验版和正式版正常》
 *         V.ProfileGlobal.getSystemNanoTime is not a function
 *     · GitHub wechat-miniprogram/minigame-tuanjie-transform-sdk#43
 *         （Android 真机调试必现，PC + 模拟器正常）
 *
 *   ✅ 正确处置：换调试方式（预览 / 体验版 / 正式版），别在游戏里硬绕。
 *   ❌ 错误处置：想"重试 createCanvas 绕过去" —— 见结论 2，会炸得更惨。
 *
 * 【结论 2｜硬约束，永久有效】wx.createCanvas() 全生命周期只能调用一次
 *
 *   微信规则：首次调用返回屏幕画布，之后每次都是离屏画布。
 *   所以任何"失败就重建画布"的循环都是致命的：游戏照跑、日志还打
 *   「✅ 启动成功」，但整局画在一块看不见的画布上 → 主屏 0 像素
 *   → 原生启动页永不消失。上一版 tryBoot 的重试循环干的就是这件事。
 *
 *   本文件的写法（别再改回去）：
 *     · createCanvas() **有且仅有一次**调用 —— createCanvasCalls 只有一个
 *       自增点，且没有任何重试分支；
 *     · 等待放在它**之前**（就绪探测），绝不把重试放在它**之后**；
 *     · 失败就失败 —— 用 wx.showModal（原生 UI，**不需要画布**）把原因
 *       喊到屏幕上，绝不静默黑屏。
 *
 * 【结论 3｜探针别选错】就绪探测不能用 wx.getPerformance()
 *
 *   它恰好是被结论 1 那个工具 Bug 打坏的口。上一版拿它当探针，真机上
 *   必然"探测超时 1500ms"，既白等 1.5 秒，又把真正的故障盖住、还误报成
 *   「jsbridge 探测超时」——jsbridge 其实是好的。
 *   现在改用 getSystemInfoSync / getWindowInfo：直接反映 jsbridge 状态。
 *
 * 【历史坑，一并保留】
 *   · ctx.roundRect / ellipse / setLineDash 在低版本基础库不存在
 *     → 已由 theme.polyfillCanvas2D(ctx) 在 Game 构造第一步统一兜底。
 *   · 主循环必须 try/catch（见 game_core.loop），否则任何一帧抛异常都会
 *     让 requestAnimationFrame 链断掉 → 永久冻屏。
 *
 * 【结论 4｜画质】画布要按**物理像素**建，ctx 再缩回逻辑坐标
 *
 *   真机预览能跑但画面糊 —— 因为画布原来按逻辑像素建（390×844），
 *   系统把它拉到 2~3 倍物理像素铺满屏幕，等于放大了 2~3 倍。
 *   现在：canvas.width = 逻辑宽 × renderScale（见 resolveRenderScale），
 *   game_core.applyViewScale() 每帧把 ctx 复位成 setTransform(scale,...)。
 *   于是**布局/触摸坐标口径完全不变**（仍是逻辑像素），只是每逻辑像素
 *   由 renderScale² 个物理像素来画。倍率旋钮 = MAX_RENDER_SCALE。
 *
 *   诊断入口：真机卡住时，Console 搜 [boot] 前缀（会打印"平台默认画布尺寸 /
 *   pixelRatio / 渲染倍率 / 画布按物理像素建立"四行，画质问题一眼可判）。
 * ===========================================================================
 */

console.log('[boot] === game.js 开始执行 ===');

const Game = require('./src/game_core');
console.log('[boot] game_core require 完成');

// ============================================================================
// 启动期状态 —— 模块级：重试之间复用同一块画布、同一个 ctx
// ============================================================================
let canvas = null;
let ctx = null;
let windowInfo = null;

let booted = false;            // 幂等：入口被重复求值（热重载）时不再建第二个 Game
let createCanvasCalls = 0;     // ⚠️ 硬约束：全生命周期 ≤ 1 次（第 2 次起是离屏画布）
let canvasError = null;        // createCanvas 抛出的原始错误（重试时原样抛出，不掩盖真相）
let bootTries = 0;
let fatalError = null;         // 一旦置位：停止重试（切场景救不了环境故障）
let bootStep = 'init';         // 当前正处在哪一步（报错时精确定位，别把 getContext 报成 createCanvas）

// ---------------------------------------------------------------------------
// 渲染倍率（画质）：逻辑像素 × renderScale = 画布物理像素
// ---------------------------------------------------------------------------
// 症状（2026-09-16，预览扫码真机实测）：能玩，但画面糊、字发虚、斜边锯齿。
// 原因：画布是按**逻辑像素**建的（比如 390×844 就这么大），而手机屏有 2~3 倍
//       物理像素 —— 系统把这张小图拉伸铺满屏幕，等于每 1 个像素被放大 2~3 倍。
// 解法（官方/社区一致口径）：canvas.width = 逻辑宽 × devicePixelRatio，
//       再把 ctx 反向缩放回逻辑坐标系（见 game_core.applyViewScale）。
//       于是"布局代码一行不改，但每个逻辑像素由 N×N 个物理像素来画"。
//
// MAX_RENDER_SCALE：渲染倍率上限。倍率 N 意味着每帧要填 N² 倍像素
//   （2 → 4 倍，3 → 9 倍），所以它是**画质与帧率的旋钮**：
//   · 2 = 够用但偏低。3x DPR 的手机（多数旗舰安卓/iPhone）会被 clamp 在 2 倍，
//         画布只有 2x 物理像素，系统拉到 3x 屏幕就发虚、字糊、斜边锯齿。
//   · 3 = 推荐。覆盖当前绝大多数真机的 DPR（2x ~ 3x），画质明显提升。
//         塔防游戏矢量绘制为主，9 倍像素量帧率无感；只有极低端安卓可能掉帧。
//   · 4+ = 极端。目前没有手机 DPR 到 4，保留给未来。
const MAX_RENDER_SCALE = 1;

let renderScale = 0;           // 标定结果：只在首次成功拿到画布后算一次（重试复用，避免翻倍）
let platformBaseW = 0;         // createCanvas 返回时的**原始**画布宽（平台的默认基准，只读一次）
let platformBaseH = 0;

const BOOT_MIN_DELAY = 250;    // 最早启动时刻：给 SDK 注入/patch 留窗口
const BOOT_PROBE_STEP = 25;    // 就绪探测间隔
const BOOT_PROBE_MAX = 60;     // 探测上限：60 × 25ms = 1.5s，超时就硬上
const BOOT_MAX_TRIES = 6;      // 非环境故障的重试上限

// ---------------------------------------------------------------------------
// 故障分类：环境级（重试无意义，立刻喊出来）vs 其它（可重试）
// ---------------------------------------------------------------------------
// 结论 1 那个工具 Bug 的指纹：只要出现在错误信息里，就是环境挂了。
const DEVTOOL_BUG_KEYS = [
  'getSystemNanoTime',        // 工具注入的性能桩缺这个方法
  'ProfileGlobal',            // 社区版报错里的宿主对象
  'WAGamePerformanceUtilsSDK',
  'TraceGlobal',
];

function looksLikeDevtoolBug(msg) {
  const s = String(msg || '');
  for (let i = 0; i < DEVTOOL_BUG_KEYS.length; i++) {
    if (s.indexOf(DEVTOOL_BUG_KEYS[i]) >= 0) return true;
  }
  return false;
}

function looksLikeNotReady(msg) {
  return String(msg || '').indexOf('jsbridge not ready') >= 0;
}

/**
 * 环境是否就绪。
 *
 * 探针必须是**不经过 WAGamePerformanceUtilsSDK** 的同步接口：
 * getSystemInfoSync / getWindowInfo。它们抛「jsbridge not ready」时就代表
 * 底层通道还没通 —— 真机日志里这句确实出现过，是个可信信号。
 *
 * （上一版探的是 wx.getPerformance().now()：那个口本身被工具 Bug 打坏了，
 *   于是永远探不通，白等 1.5s 再硬上，属于"探针和故障源是同一个东西"。）
 *
 * 两个口都不存在（老环境 / node 冒烟）→ 返回 true，不阻塞启动。
 */
function envReady() {
  try {
    if (typeof wx.getSystemInfoSync === 'function') {
      wx.getSystemInfoSync();
      return true;
    }
  } catch (e) {
    return false;
  }
  try {
    if (typeof wx.getWindowInfo === 'function') {
      wx.getWindowInfo();
      return true;
    }
  } catch (e) {
    return false;
  }
  return true;
}

/**
 * 取得屏幕画布 + 2D 上下文。
 *
 * ⚠️ 两条硬规则（结论 2 的落地）：
 *
 *  1. **wx.createCanvas() 全生命周期只调一次。**
 *     createCanvasCalls 全程只有一个自增点，且这里**没有任何重试分支**。
 *     失败就抛出原始错误，交给 tryBoot 决定"重试别的步骤"还是"喊停"。
 *
 *  2. **canvas 与 ctx 分开判空。**
 *     getContext 失败必须在**同一块画布**上重试 —— 过去 ctx 的创建被塞在
 *     `if (!canvas)` 里，一旦 getContext 返回空，ctx 就永远是 null，
 *     之后每一帧都抛异常、一个像素都画不出来，表现同样是「卡启动页」。
 *     现在这个重试是安全的：canvas 已经拿到，不会再多调 createCanvas。
 */
function ensureCanvas() {
  if (!canvas) {
    if (createCanvasCalls >= 1) {
      // 已经调过一次且没拿到画布 —— 按硬约束绝不重调。
      // 原样抛出 createCanvas 的原始错误，别用"拒绝重调"把它盖住。
      throw canvasError || new Error('wx.createCanvas() 已调用过但未取得画布，拒绝重调（第 2 次起是离屏画布）');
    }
    createCanvasCalls++;   // ⚠️ 唯一自增点
    console.log('[boot] 调用 wx.createCanvas()（第 1 次，也是唯一一次）...');
    try {
      canvas = wx.createCanvas();
    } catch (e) {
      canvasError = e;     // 记下原始错误
      throw e;
    }
    console.log('[boot] 屏幕画布已取得');
    // 记下平台给的**默认**尺寸：它是"这块画布究竟按逻辑像素还是物理像素建"
    // 的唯一可信基准（之后我们就把它改成物理像素了，再读就没意义了）。
    platformBaseW = canvas.width || 0;
    platformBaseH = canvas.height || 0;
    console.log('[boot] 平台默认画布尺寸 =', platformBaseW + 'x' + platformBaseH);
  }

  if (!ctx) {
    bootStep = 'canvas.getContext("2d")';
    ctx = canvas.getContext('2d');
    console.log('[boot] ctx =', !!ctx);
    if (!ctx) throw new Error('canvas.getContext("2d") 返回空（jsbridge 未就绪？）');
  }
}

/**
 * 标定渲染倍率（只算一次）。
 *
 * 三条分支，顺序不能变：
 *   ① 平台默认画布**已经**是物理分辨率（默认宽 > 逻辑宽 × 1.25）
 *      → 尊重平台基准，直接用它的比值。
 *        这一条是**防呆**：不同基础库/机型对"主画布默认多大"口径并不统一，
 *        万一某台机器本来就是物理像素画布，我们再乘一次 DPR 就成了
 *        "2 倍放大后又被当成 2 倍放大的坐标画"——UI 直接涨到屏幕外。
 *   ② 否则按 pixelRatio 放大，并用 MAX_RENDER_SCALE 夹住（画质 vs 帧率旋钮）。
 *   ③ pixelRatio 拿不到（老环境）→ 保持 1 倍，行为与修复前一致，绝不倒退。
 *
 * ⚠️ 结果必须缓存：prepareWindowInfo 会在每次启动重试时重跑，
 *    而那时 canvas.width 已经被我们改写成物理像素了，再拿它当基准会翻倍
 *    （780 → 1560 → …）。所以这里只信"只读一次"的 platformBase*。
 */
function resolveRenderScale(logicalW) {
  if (renderScale > 0) return renderScale;

  const dpr = Number(windowInfo && windowInfo.pixelRatio) || 1;
  let scale = 1;
  let why = '';

  if (platformBaseW > 0 && logicalW > 0 && platformBaseW > logicalW * 1.25) {
    scale = platformBaseW / logicalW;
    why = '平台默认画布 ' + platformBaseW + ' 已是物理分辨率（逻辑 ' + logicalW + '）→ 原样尊重';
  } else if (dpr > 1) {
    scale = Math.min(dpr, MAX_RENDER_SCALE);
    why = 'pixelRatio=' + dpr + '，上限 MAX_RENDER_SCALE=' + MAX_RENDER_SCALE;
  } else {
    why = 'pixelRatio=' + dpr + '，不放大（与修复前一致）';
  }

  if (!isFinite(scale) || scale < 1) scale = 1;
  scale = Math.round(scale * 100) / 100;
  renderScale = scale;
  console.log('[boot] 渲染倍率 =', scale, '｜', why);
  return scale;
}

/**
 * 计算并应用画布尺寸（每次尝试都重算，避免复用过期尺寸）。
 *
 * ⚠️ 这里写的是**物理像素**（逻辑 × renderScale），不是逻辑像素。
 *    布局代码一律读 game.W / game.H（逻辑），别再读 canvas.width 做布局 ——
 *    renderer 里那些 `const W = game.canvas.width` 已经全部改掉了，
 *    旧写法会让所有 UI 被放大 renderScale 倍、底部控件直接跑出屏幕。
 */
function prepareWindowInfo() {
  try {
    windowInfo = (typeof wx.getWindowInfo === 'function')
      ? wx.getWindowInfo()
      : wx.getSystemInfoSync();
    console.log('[boot] windowInfo =', windowInfo && windowInfo.screenWidth, windowInfo && windowInfo.screenHeight,
      '｜ pixelRatio =', windowInfo && windowInfo.pixelRatio);
  } catch (e) {
    console.warn('[boot] getWindowInfo 失败，用 canvas 尺寸兜底:', e && e.message);
    windowInfo = null;
  }
  if (!windowInfo || typeof windowInfo.screenWidth !== 'number') {
    windowInfo = {
      screenWidth: (platformBaseW || (canvas && canvas.width)) || 640,
      screenHeight: (platformBaseH || (canvas && canvas.height)) || 960,
    };
    windowInfo.renderScale = 1;
  }

  const logicalW = windowInfo.screenWidth;
  const logicalH = windowInfo.screenHeight;
  windowInfo.renderScale = resolveRenderScale(logicalW);

  if (canvas) {
    canvas.width = Math.max(1, Math.round(logicalW * windowInfo.renderScale));
    canvas.height = Math.max(1, Math.round(logicalH * windowInfo.renderScale));
  }
  console.log('[boot] 画布按物理像素建立 =', canvas && (canvas.width + 'x' + canvas.height),
    '（逻辑 ' + logicalW + 'x' + logicalH + ' × ' + windowInfo.renderScale + '）');
}

/**
 * 启动失败的逃生口。
 *
 * 用 wx.showModal —— 原生 UI，**不依赖画布**。所以即使 createCanvas 挂了，
 * 也能把原因摆到屏幕上，而不是让玩家/开发者对着一整块黑屏猜。
 * （这是本项目"模态必须有逃生口"那条规则在启动路径上的对应物。）
 */
function reportFatal(step, err) {
  const msg = (err && err.message) ? err.message : String(err);
  const lines = ['启动失败 @ ' + step, '', msg];

  if (looksLikeDevtoolBug(msg)) {
    lines.push('');
    lines.push('这是微信开发者工具「真机调试」的已知 Bug：');
    lines.push('基础库 WAGamePerformanceUtilsSDK 取不到 getSystemNanoTime。');
    lines.push('同一份代码在 预览 / 体验版 / 正式版 下正常。');
    lines.push('→ 改用「预览」扫码，手机上点 ··· → 开发调试 → 打开调试 看日志；');
    lines.push('  或上传体验版后用真机打开。');
  } else if (looksLikeNotReady(msg)) {
    lines.push('');
    lines.push('底层 jsbridge 未就绪。重启微信客户端 / 开发者工具后重试。');
  }

  console.error('[boot] 💀 ' + step + ' 失败：' + msg);
  console.error('[boot] 💀 createCanvas 调用次数 =', createCanvasCalls, '（硬约束：必须 ≤ 1）');

  try {
    if (typeof wx !== 'undefined' && typeof wx.showModal === 'function') {
      wx.showModal({
        title: '塔防：启动失败',
        content: lines.join('\n'),
        showCancel: false,
        confirmText: '知道了',
      });
    }
  } catch (e) {
    console.error('[boot] showModal 也失败了:', e && e.message);
  }
  return lines.join('\n');
}

function boot() {
  console.log('[boot] boot() 开始（第', bootTries, '次尝试）');

  try {
    if (typeof wx === 'undefined') {
      // 非微信环境（node 冒烟 / 浏览器）：保持历史行为，用默认尺寸
      windowInfo = { screenWidth: 640, screenHeight: 960, renderScale: 1 };
      console.log('[boot] 非微信环境，使用默认尺寸');
    } else {
      bootStep = 'wx.createCanvas()';
      ensureCanvas();          // canvas / ctx 分开判空，失败会保留原始错误
      bootStep = 'getWindowInfo()';
      prepareWindowInfo();
    }

    bootStep = 'new Game()';
    console.log('[boot] 开始 new Game()...');
    new Game(canvas, ctx, windowInfo);
    booted = true;
    console.log('[boot] Game 实例化完成');
    console.log('[boot] ✅ 启动成功（第', bootTries, '次尝试；createCanvas 共调用', createCanvasCalls, '次，应为 1）');
    return null;
  } catch (err) {
    return { step: bootStep, err: err };
  }
}

function tryBoot() {
  if (booted || fatalError) return;
  bootTries++;

  const r = boot();
  if (!r) return;                      // 成功

  const msg = (r.err && r.err.message) ? r.err.message : String(r.err);
  console.warn('[boot] ❌ 第', bootTries, '次失败 @', r.step, ':', msg);

  // 环境级故障：重试再多次也是同一个错，别浪费时间和日志
  const envFatal = looksLikeDevtoolBug(msg) || looksLikeNotReady(msg);
  if (envFatal) {
    fatalError = reportFatal(r.step, r.err);
    return;
  }

  if (bootTries < BOOT_MAX_TRIES) {
    // 注意：重试只会重跑 getWindowInfo / getContext / new Game。
    // canvas 已经拿到的场景下不会碰 createCanvas（它在 try 里被短路了）；
    // canvas 没拿到的场景下，ensureCanvas 会直接抛原始错误，绝不会重调。
    setTimeout(tryBoot, 120);
  } else {
    fatalError = reportFatal(r.step + '（重试 ' + bootTries + ' 次后）', r.err);
  }
}

/**
 * 启动调度：先等到环境就绪（最早 BOOT_MIN_DELAY，最晚 1.5s），再启动。
 * 探测不通不影响启动 —— 到点就硬上，createCanvas 自己会给出明确结论。
 *
 * 等待放在 createCanvas **之前**，这是结论 2 的关键：等待是安全的，
 * 重试 createCanvas 是不安全的。
 */
function scheduleBoot() {
  let probeTries = 0;
  function step() {
    if (booted || fatalError) return;
    if (envReady()) {
      console.log('[boot] 环境就绪（探测', probeTries, '次，t≈', BOOT_MIN_DELAY + probeTries * BOOT_PROBE_STEP, 'ms）');
      tryBoot();
      return;
    }
    probeTries++;
    if (probeTries >= BOOT_PROBE_MAX) {
      console.warn('[boot] ⚠️ 就绪探测超时（', BOOT_PROBE_MAX * BOOT_PROBE_STEP, 'ms），不再等待，直接启动');
      tryBoot();
      return;
    }
    setTimeout(step, BOOT_PROBE_STEP);
  }
  setTimeout(step, BOOT_MIN_DELAY);
}

if (typeof wx === 'undefined') {
  boot();
} else {
  scheduleBoot();
}
