/**
 * 塔防游戏 - 入口文件
 * 仅负责：全局 canvas / ctx / windowInfo 的延迟初始化、boot()、启动主循环。
 * 游戏逻辑分散在 src/ 下各模块，由 src/game_core.js 的 Game 类协调。
 */

// 兼容微信小程序和游戏环境
// 注意：canvas / ctx / windowInfo 延迟到 boot() 内初始化，
// 避免模块顶层同步调用 wx.* 时 jsbridge 尚未就绪（开发者工具启动竞态）
let canvas = null;
let ctx = null;
let windowInfo = null;

const Game = require('./src/game_core');

/**
 * 延迟启动：等运行时（jsbridge）就绪后再创建 canvas / 读取窗口信息 / 实例化游戏。
 * 同时优先使用新接口 wx.getWindowInfo，避开已废弃的 wx.getSystemInfoSync
 * （其内部会访问 deviceOrientation getter，正是触发 getSystemInfo 的引擎内部路径）。
 */
function boot() {
  canvas = wx.createCanvas();
  ctx = canvas.getContext('2d');

  if (typeof wx.getWindowInfo === 'function') {
    windowInfo = wx.getWindowInfo();
  } else if (typeof wx.getSystemInfoSync === 'function') {
    windowInfo = wx.getSystemInfoSync();
  } else {
    // 兜底（理论上 wx 环境必然提供上述接口）
    windowInfo = { screenWidth: 640, screenHeight: 960 };
  }

  canvas.width = windowInfo.screenWidth;
  canvas.height = windowInfo.screenHeight;

  new Game(canvas, ctx, windowInfo);
}

// 首帧再启动，确保微信 JS 桥已连接；规避 "jsbridge not ready" 警告
if (typeof wx !== 'undefined') {
  requestAnimationFrame(boot);
} else {
  boot();
}
