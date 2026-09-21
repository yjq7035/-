// 渲染层（薄壳 re-export）：由 game_core.js:8 require('./renderer') 加载。
// 内部拆为两个 <100KB 子模块，避免微信小游戏单文件 100KB 限制。

const core = require('./renderer-core');
const ui   = require('./renderer-ui');

// 从子模块合并导出，保持与原先 renderer.js module.exports 完全一致
// （PANEL_UI / gemBlockHeight 已含在 ...ui 里，无需重复列出）
module.exports = {
  ...core,
  ...ui,
};
