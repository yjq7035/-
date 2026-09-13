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
 * 延迟启动：等 wx 环境完全就绪后再创建 canvas / 读取窗口信息 / 实例化游戏。
 * 使用 wx.ready 确保 JSBridge 已连接，规避 "jsbridge not ready" 警告。
 */
function boot() {
  // 检查 wx 环境
  if (typeof wx === 'undefined') {
    // 非微信环境（如浏览器调试），使用默认值
    windowInfo = { screenWidth: 640, screenHeight: 960 };
  } else if (typeof wx.ready === 'function') {
    // 微信小游戏环境：等待 jsbridge 就绪
    wx.ready(() => {
      initGame();
    });
    return;
  }

  // 无 ready 接口或微信外环境，直接初始化
  initGame();
}

/**
 * 统一的初始化逻辑
 */
function initGame() {
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

// 启动
if (typeof wx !== 'undefined') {
  // 优先使用 wx.ready 确保 jsbridge 就绪
  if (typeof wx.ready === 'function') {
    wx.ready(boot);
  } else {
    requestAnimationFrame(boot);
  }
} else {
  boot();
}
