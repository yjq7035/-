// 广告管理器 —— 微信小游戏激励视频 / 插屏 / Banner
// 支持开关 AD.enabled，关闭时所有接口无操作

const { AD } = require('./config');

let rewardedVideoAd = null;
let interstitialAd = null;
let bannerAd = null;

let _reviveCallback = null;
let _reviveRemaining = 0;

// 校验广告位 ID：合法格式为 "adunit-" + 16 位以上十六进制字符
// 占位符（如 'adunit-interstitial'）长度/字符不符合，直接跳过创建，避免 errCode 1002
function _isValidAdUnitId(id) {
  return typeof id === 'string' && /^adunit-[0-9a-z]{16,}$/i.test(id);
}

function _warnInvalidAdUnit(type, id) {
  console.warn('[ads] ' + type + ' 广告位 ID 无效（当前为占位符或格式错误）："' + id +
    '"。请到 src/config.js 的 AD 中填入微信广告后台申请的真实 adunit-id，已跳过该广告。');
}

// ============================================================================
// 模拟广告（仅开发测试用）：没有真实广告位 ID 时，用 wx.showModal 模拟广告流程，
// 完整跑通 load / show / onClose(isEnded) 回调链路。上线前请把 AD.mock 设为 false。
// ============================================================================
function _createMockAd(type) {
  const listeners = { load: [], error: [], close: [] };
  const emit = key => { listeners[key].forEach(f => { try { f(); } catch (e) {} }); };
  return {
    __mock: true,
    onLoad(f) { listeners.load.push(f); },
    offLoad(f) { listeners.load = listeners.load.filter(x => x !== f); },
    onError(f) { listeners.error.push(f); },
    offError(f) { listeners.error = listeners.error.filter(x => x !== f); },
    onClose(f) { listeners.close.push(f); },
    offClose(f) { listeners.close = listeners.close.filter(x => x !== f); },
    load() { return Promise.resolve().then(() => emit('load')); },
    show() {
      return new Promise((resolve, reject) => {
        if (typeof wx === 'undefined' || !wx.showModal) {
          reject(new Error('[ads] mock: wx.showModal 不可用'));
          return;
        }
        wx.showModal({
          title: '【模拟广告】' + type,
          content: '这是开发测试用的假广告。\n点「看完」= 完整观看（isEnded=true）\n点「关闭」= 中途跳过（isEnded=false）',
          confirmText: '看完',
          cancelText: '关闭',
          success: res => {
            resolve();
            listeners.close.forEach(f => { try { f({ isEnded: !!res.confirm }); } catch (e) {} });
          },
          fail: () => reject(new Error('[ads] mock show fail')),
        });
      });
    },
    hide() {},
    destroy() {},
    onResize(f) {},
    style: { left: 0, top: 0, width: 320 },
  };
}

// 插屏广告状态
let _interstitialRetryTimer = null;
let _lastInterstitialShowAt = 0;

// 预加载插屏（可延迟执行；同一时间只保留一个定时器）
function _preloadInterstitial(delay = 0) {
  if (!interstitialAd) return;
  if (_interstitialRetryTimer) {
    clearTimeout(_interstitialRetryTimer);
    _interstitialRetryTimer = null;
  }
  if (delay <= 0) {
    try { interstitialAd.load().catch(() => {}); } catch (e) {}
    return;
  }
  _interstitialRetryTimer = setTimeout(() => {
    _interstitialRetryTimer = null;
    try { interstitialAd.load().catch(() => {}); } catch (e) {}
  }, delay);
}

// 初始化
function initAds() {
  if (!AD.enabled) return;
  if (typeof wx === 'undefined') return;

  // 激励视频
  try {
    if (!_isValidAdUnitId(AD.rewardedVideoAdUnitId)) {
      if (AD.mock) {
        rewardedVideoAd = _createMockAd('激励视频');
        console.warn('[ads] 激励视频使用模拟广告（仅开发测试用，AD.mock=true）');
      } else {
        _warnInvalidAdUnit('激励视频', AD.rewardedVideoAdUnitId);
        rewardedVideoAd = null;
      }
    } else {
      rewardedVideoAd = wx.createRewardedVideoAd({ adUnitId: AD.rewardedVideoAdUnitId });
      rewardedVideoAd.onLoad(() => console.log('[ads] rewarded loaded'));
      rewardedVideoAd.onError(err => {
        console.warn('[ads] rewarded error', err);
        // 失败时自动重试一次
        setTimeout(() => {
          try { rewardedVideoAd && rewardedVideoAd.load(); } catch(e){}
        }, 1000);
      });
      rewardedVideoAd.onClose(res => {
        console.log('[ads] rewarded closed', res);
        if (_reviveCallback) {
          if (res && res.isEnded) {
            // 本次广告观看完成
            _reviveRemaining--;
            if (_reviveRemaining <= 0) {
              const cb = _reviveCallback;
              _reviveCallback = null;
              cb(true);
            } else {
              // 继续下一个广告
              _showNextRewarded();
            }
          } else {
            // 用户跳过，视为失败
            const cb = _reviveCallback;
            _reviveCallback = null;
            cb(false);
          }
        }
      });
    }
  } catch(e) { console.warn('[ads] rewarded init fail', e); }

  // 插屏
  // 官方要点：createInterstitialAd 每次创建返回全新实例，默认隐藏；
  // 建议 load 预加载 → show 展示；onClose 后重新预加载；onError 后间隔重试。
  try {
    if (!_isValidAdUnitId(AD.interstitialAdUnitId)) {
      if (AD.mock) {
        interstitialAd = _createMockAd('插屏');
        console.warn('[ads] 插屏使用模拟广告（仅开发测试用，AD.mock=true）');
      } else {
        _warnInvalidAdUnit('插屏', AD.interstitialAdUnitId);
      }
    } else if (!wx.createInterstitialAd) {
      console.warn('[ads] wx.createInterstitialAd 不存在（基础库版本过低）');
    } else {
      interstitialAd = wx.createInterstitialAd({ adUnitId: AD.interstitialAdUnitId });
      interstitialAd.onLoad(() => console.log('[ads] interstitial loaded'));
      interstitialAd.onError(err => {
        console.warn('[ads] interstitial error', err);
        // 加载失败后按官方建议间隔一段时间再重试，不要立刻频繁重试
        _preloadInterstitial((AD.interstitialRetrySec || 30) * 1000);
      });
      interstitialAd.onClose(() => {
        // 关闭后为下一次展示提前预加载
        _preloadInterstitial();
      });
      // 启动即预加载，show 时无需再等
      _preloadInterstitial();
    }
  } catch(e) { console.warn('[ads] interstitial init fail', e); }

  // Banner
  try {
    if (!_isValidAdUnitId(AD.bannerAdUnitId)) {
      if (AD.mock) {
        bannerAd = _createMockAd('Banner');
        console.warn('[ads] Banner 使用模拟广告（仅开发测试用，AD.mock=true）');
      } else {
        _warnInvalidAdUnit('Banner', AD.bannerAdUnitId);
      }
    } else {
      bannerAd = wx.createBannerAd({
        adUnitId: AD.bannerAdUnitId,
        style: { left: 0, top: 0, width: 320 }
      });
      bannerAd.onResize(() => {
        bannerAd.style.top = 0;
      });
    }
  } catch(e) { console.warn('[ads] banner init fail', e); }
}

// 展示 Banner
function showBanner(show = true) {
  if (!AD.enabled || !bannerAd) return;
  show ? bannerAd.show() : bannerAd.hide();
}

// 展示插屏
function showInterstitial() {
  if (!AD.enabled || !interstitialAd) return;
  // 频控：间隔不足时静默跳过，避免连续弹窗打扰用户
  const now = Date.now();
  if (now - _lastInterstitialShowAt < (AD.interstitialMinIntervalSec || 60) * 1000) return;
  _lastInterstitialShowAt = now;
  // 已预加载则直接展示；show 失败（通常是物料未就绪）时重新加载再试一次
  interstitialAd.show().catch(err => {
    console.warn('[ads] interstitial show fail, reload and retry', err);
    interstitialAd.load().then(() => {
      interstitialAd.show().catch(() => {});
    }).catch(() => {});
  });
}

// 内部：展示下一个激励视频
function _showNextRewarded() {
  if (!rewardedVideoAd) return;
  rewardedVideoAd.show().catch(err => {
    console.warn('[ads] rewarded show fail', err);
    // 失败则直接回调 false
    const cb = _reviveCallback;
    _reviveCallback = null;
    if (cb) cb(false);
  });
}

// 外部调用：观看复活广告（需要看 reviveAdCount 个）
function showReviveAds(onComplete) {
  if (!AD.enabled) {
    // 开关关闭时直接回调成功，避免卡死
    if (typeof onComplete === 'function') onComplete(true);
    return;
  }
  if (!rewardedVideoAd) {
    console.warn('[ads] rewarded not ready');
    if (typeof onComplete === 'function') onComplete(false);
    return;
  }
  _reviveCallback = onComplete;
  _reviveRemaining = AD.reviveAdCount || 2;
  _showNextRewarded();
}

// 单次激励视频（通用）
async function showRewardedOnce() {
  if (!AD.enabled || !rewardedVideoAd) return false;
  try {
    await rewardedVideoAd.load();
    await rewardedVideoAd.show();
    return true;
  } catch(e) {
    console.warn('[ads] rewarded once fail', e);
    return false;
  }
}

module.exports = {
  initAds,
  showBanner,
  showInterstitial,
  showReviveAds,
  showRewardedOnce,
  isEnabled: () => AD.enabled,
};
