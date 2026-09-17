// ============================================================================
// 背景音乐 —— src/audio.js
// ----------------------------------------------------------------------------
// 一句话：把 audio/snowfall.mp3 作为 BGM 循环播起来，并且**永远不要因为音频
// 出问题把游戏搞崩**。
//
// 职责边界
//   · 本文件只管"音乐"（BGM）。将来加音效（SFX）请在下面另起一节或另开模块，
//     两者生命周期不同：BGM 是长驻循环、可开关、要跟前后台走；音效是一次性触发。
//   · 渲染/输入不直接碰 wx 音频 API，一律走本文件导出的接口 + getState()。
//
// 四条关键设计（都是踩过坑的地方）
//
//   1. 【非微信环境必须安全降级】
//      项目的验证工具链（.workbuddy/tools/smoke.js 等）是在裸 node 里跑
//      game.render() 的，那里没有 wx。所以本文件所有对外接口在
//      "没有 wx / 没有 createInnerAudioContext"时都必须是无副作用的空实现，
//      否则整条冒烟测试会挂在 require 或首帧上。
//
//   2. 【任何异常都不许冒泡】
//      音频是典型的"能失败但无所谓"的基础设施。创建实例、设属性、play/pause
//      全部包 try/catch —— 一个音乐播不出来，绝不该演变成整局游戏冻屏
//      （对照 game_core.loop 必须 try/catch 的同一条原则）。
//
//   3. 【wantPlay 与 enabled 分开】
//      · enabled  = 用户的意愿（持久化，关掉就是关掉，重启也不该自己响）
//      · wantPlay = "现在这一刻我们希望它在响"
//      切后台要暂停，但回前台必须知道"这是我暂停的，不是用户关的"，否则
//      用户一关一开会发现音乐莫名其妙自己复活了。两个状态混成一个就会这样。
//
//   4. 【自动播放失败要有兜底】
//      启动即 play() 在某些环境下会被静默拦掉（不报错、也不出声）。
//      所以额外挂一次性触摸解锁：首次玩家触摸时如果还没播起来，补一次 play()。
//      这是唯一能覆盖"静默失败"的手段 —— 没有错误可捕获。
//
// 想换曲子：改 config.js 的 MUSIC.src 即可，本文件不用动。
// ============================================================================

const { MUSIC } = require('./config');

const STORAGE_KEY = 'graphic_td_audio_v1';

// ---------------------------------------------------------------------------
// 模块级单例状态
// ---------------------------------------------------------------------------
let inner = null;            // wx.createInnerAudioContext() 实例
let inited = false;          // init() 幂等标记
let available = false;       // 是否真的拿到了可用的音频实例
let enabled = (MUSIC.defaultEnabled === undefined) ? !!MUSIC.enabled : !!MUSIC.defaultEnabled;  // 用户意愿（存档优先；无存档时用 defaultEnabled 作默认）
let wantPlay = false;        // 当前这一刻是否希望音乐在响
let everPlayed = false;      // 是否至少成功播过一次（用于兜底解锁判断）
let lastError = null;        // 最近一次错误（诊断用，不对外抛）
let unlockListener = null;   // 一次性触摸解锁的监听器引用（用于摘掉）

function clamp01(v) {
  const n = Number(v);
  if (!isFinite(n)) return 1;
  return Math.max(0, Math.min(1, n));
}

/**
 * 是否运行在微信开发者工具里。
 * 用途：开发者工具对 setInnerAudioOption / WebAudio 模拟层都有一堆已知限制
 * （官方提示"请使用真机进行开发"），报错降级为 log，别用 warn 吓人。
 */
function isDevtools() {
  try {
    if (typeof wx === 'undefined' || typeof wx.getSystemInfoSync !== 'function') return false;
    const info = wx.getSystemInfoSync();
    return !!(info && info.platform === 'devtools');
  } catch (e) {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 偏好持久化（独立 key，不塞进 meta 存档）
// ---------------------------------------------------------------------------
// 为什么不写进 meta.js 的存档：那会牵动它的 normalize() 迁移逻辑（旧档补齐、
// 坏档兜底），而音乐开关是个"丢了也无所谓"的偏好。独立 key 更小、更安全。
function getStorage() {
  if (typeof wx !== 'undefined' && wx && typeof wx.setStorageSync === 'function') return wx;
  return null;
}

function readPref() {
  const st = getStorage();
  if (!st) return null;
  try {
    const raw = st.getStorageSync(STORAGE_KEY);
    if (!raw) return null;
    const obj = (typeof raw === 'string') ? JSON.parse(raw) : raw;
    if (obj && typeof obj.enabled === 'boolean') return obj.enabled;
    return null;
  } catch (e) {
    return null;   // 坏档 → 当作没有偏好，用配置默认值
  }
}

function writePref(v) {
  const st = getStorage();
  if (!st) return;
  try {
    st.setStorageSync(STORAGE_KEY, JSON.stringify({ enabled: !!v }));
  } catch (e) {
    // 落盘失败不影响本次会话的音乐状态
  }
}

// ---------------------------------------------------------------------------
// 播放控制
// ---------------------------------------------------------------------------

/** 开始播放（记录"我们希望它在响"，即使当前实例不可用） */
function play() {
  wantPlay = true;
  if (!available || !enabled || !inner) return false;
  try {
    inner.play();
    return true;
  } catch (e) {
    lastError = e;
    console.warn('[audio] play 失败：', e && e.message);
    return false;
  }
}

/** 暂停播放（同时撤销"希望它在响"） */
function pause() {
  wantPlay = false;
  if (!available || !inner) return;
  try {
    inner.pause();
  } catch (e) {
    lastError = e;
  }
}

/**
 * 设置/切换音乐开关，返回设置后的状态。
 * 关 → 立即停；开 → 立即播（含"首次触摸解锁"场景）。
 */
function setEnabled(v) {
  const next = !!v;
  if (next === enabled) return enabled;
  enabled = next;
  writePref(enabled);

  if (enabled) {
    play();
  } else {
    pause();
  }
  return enabled;
}

/** 开关取反，返回新状态（UI 按钮直接用它） */
function toggle() {
  return setEnabled(!enabled);
}

// ---------------------------------------------------------------------------
// 生命周期绑定
// ---------------------------------------------------------------------------

/**
 * 切后台暂停 / 回前台续播。
 * 判据用 wantPlay（我们自己的意图），不用 everPlayed —— 见文件头的设计 3。
 */
function bindLifecycle() {
  if (typeof wx === 'undefined') return;
  try {
    if (typeof wx.onHide === 'function') {
      wx.onHide(() => {
        // 只停，不动 wantPlay：回前台才知道该不该续上
        if (available && inner) { try { inner.pause(); } catch (e) {} }
      });
    }
    if (typeof wx.onShow === 'function') {
      wx.onShow(() => {
        if (available && enabled && wantPlay) play();
      });
    }
  } catch (e) {
    console.warn('[audio] 生命周期绑定失败：', e && e.message);
  }
}

/**
 * 一次性触摸解锁。
 *
 * 为什么需要：启动即 play() 在部分环境会被**静默拦截** —— 既不报错，也不出声。
 * 没有错误可捕获，只能靠"首次玩家触摸时再试一次"来兜底。解开着就自己摘监听，
 * 不在触摸回调里长期占位。
 */
function bindUnlock() {
  if (unlockListener) return;
  if (typeof wx === 'undefined' || typeof wx.onTouchStart !== 'function') return;
  unlockListener = function onFirstTouch() {
    try { wx.offTouchStart(unlockListener); } catch (e) {}
    unlockListener = null;
    if (enabled && !everPlayed) play();
  };
  try {
    wx.onTouchStart(unlockListener);
  } catch (e) {
    unlockListener = null;
  }
}

// ---------------------------------------------------------------------------
// 初始化
// ---------------------------------------------------------------------------

/**
 * 初始化 BGM。幂等，重复调用无副作用。
 * @returns {boolean} 是否拿到了可用的音频实例（false ≠ 出错，只是不能放音）
 */
function init() {
  if (inited) return available;
  inited = true;

  // 配置总开关优先：关掉就彻底不创建实例，连 wx 都不碰
  if (!MUSIC.enabled) {
    enabled = false;
    console.log('[audio] MUSIC.enabled=false，背景音乐整体关闭');
    return false;
  }

  // 存档里的用户偏好优先；没有存档时按 defaultEnabled 决定默认开关（字段缺省则视为开，保持旧行为）
  const pref = readPref();
  if (pref !== null) {
    enabled = pref;
  } else {
    enabled = (MUSIC.defaultEnabled === undefined) ? true : !!MUSIC.defaultEnabled;
  }

  if (typeof wx === 'undefined' || typeof wx.createInnerAudioContext !== 'function') {
    console.log('[audio] 非微信环境（或基础库过低），背景音乐降级为空实现（不影响游戏）');
    return false;
  }

  // ---- 1. 音频会话选项：必须在创建实例之前设置 ----
  // 说明：obeyMuteSwitch 从基础库 2.3.0 起通过 InnerAudioContext 属性设置**不生效**，
  //       以 setInnerAudioOption 为准。所以这里设一遍，实例上再设一遍（兼容老库）。
  try {
    if (typeof wx.setInnerAudioOption === 'function') {
      wx.setInnerAudioOption({
        obeyMuteSwitch: !!MUSIC.obeyMuteSwitch,
        mixWithOther: !!MUSIC.mixWithOther,
        fail: (e) => {
          const msg = e && e.errMsg;
          if (isDevtools()) {
            // 开发者工具不支持此 API 调试（官方提示用真机），属预期行为
            console.log('[audio] 开发者工具不支持 setInnerAudioOption（真机正常，不影响播放）');
          } else {
            console.warn('[audio] setInnerAudioOption 失败（不影响播放）：', msg);
          }
        },
      });
    }
  } catch (e) {
    console.warn('[audio] setInnerAudioOption 异常：', e && e.message);
  }

  // ---- 2. 创建实例并挂事件 ----
  try {
    inner = wx.createInnerAudioContext();
    inner.src = MUSIC.src;
    inner.loop = !!MUSIC.loop;
    inner.volume = clamp01(MUSIC.volume);
    inner.obeyMuteSwitch = !!MUSIC.obeyMuteSwitch;

    inner.onError((err) => {
      lastError = err;
      const msg = err && (err.errMsg || err.errCode);
      if (isDevtools()) {
        // 工具用 WebAudio 模拟 InnerAudioContext，Windows 上偶发渲染器报错，不代表真机有问题
        console.log('[audio] 播放出错（多为开发者工具模拟层问题，请以真机为准；游戏继续）：', msg);
      } else {
        console.warn('[audio] 播放出错（游戏继续，音乐静音）：', msg);
      }
      // 文件缺失 / 格式不支持都会走到这里。刻意不做重试：重试只会刷日志。
    });
    inner.onPlay(() => {
      everPlayed = true;
      console.log('[audio] BGM 开始播放：' + MUSIC.src);
    });
    inner.onEnded(() => {
      // loop=true 时正常不会触发；万一某些环境没循环，这里补一次，保证"音乐不断"
      if (enabled && wantPlay) play();
    });

    available = true;
    console.log('[audio] 初始化完成：' + MUSIC.src + '（volume=' + inner.volume + ', loop=' + inner.loop + '）');
  } catch (e) {
    available = false;
    lastError = e;
    console.warn('[audio] 创建音频实例失败，背景音乐不可用：', e && e.message);
    return false;
  }

  // ---- 3. 生命周期 + 兜底解锁 ----
  bindLifecycle();
  bindUnlock();

  // ---- 4. 启动即播（被拦时由解锁兜底） ----
  if (enabled && MUSIC.autoplay) play();

  return available;
}

// ---------------------------------------------------------------------------
// 对外查询（给 UI 用；任何情况下都不抛）
// ---------------------------------------------------------------------------

function isEnabled() {
  return !!enabled;
}

function isAvailable() {
  return !!available;
}

function isPlaying() {
  if (!available || !inner) return false;
  try {
    return !inner.paused;
  } catch (e) {
    return false;
  }
}

/** 给渲染层用的状态快照 */
function getState() {
  return {
    enabled: !!enabled,
    available: !!available,
    playing: isPlaying(),
    error: lastError ? (lastError.errMsg || String(lastError.message || lastError)) : null,
  };
}

module.exports = {
  init,
  play,
  pause,
  toggle,
  setEnabled,
  isEnabled,
  isAvailable,
  isPlaying,
  getState,
};
