# MEMORY.md — 图形塔防 项目长期约定

> 微信小游戏（`game.json` + `wx.createCanvas`），CommonJS 多模块（根 `game.js` 入口 + `src/*.js`）。
> 详细逐轮记录见 `memory/YYYY-MM-DD.md`；本文件只放**跨会话必须遵守的硬规则**。

## 平台硬规则（违反必炸）

1. **`wx.createCanvas()` 全生命周期只能调用一次。**
   首次返回屏幕画布，**之后每次返回离屏画布**（游戏照跑、屏幕全黑）。
   绝不可放进任何"失败重试"循环 —— 见 `game.js` 的 `ensureCanvas`（`createCanvasCalls` 全程只有一个
   自增点，**没有任何重试分支**）。**等待只允许放在它之前**（就绪探测），重试绝不允许放在它之后。
2. **`canvas` 与 `ctx` 必须分开判空**，`getContext` 失败要在**同一块画布**上重试（这个重试是安全的）。
3. **主循环 `update()`/`draw()` 必须 try/catch，`requestAnimationFrame` 重新排帧必须放在 try 之外**，
   否则任何一帧抛异常 → rAF 链断掉 → 永久冻屏（"整个界面点不动"）。
4. **新 Canvas API 一律要兜底**：`ctx.roundRect` / `setLineDash` / `ellipse` 在低版本基础库缺失。
   统一由 `theme.polyfillCanvas2D(ctx)` 在 `Game` 构造函数第一步补齐 —— 不要在几十个调用点各写一遍 typeof。
   （注：`project.private.config.json` 里的 `3.14.0` 只管模拟器；**真机调试/预览用的是手机微信客户端自带的基础库**
   —— 实测日志里打的就是 `Wechat Lib:3.17.2`。所以别把"真机异常"归因到那个字段。）
5. **模态浮层必须有逃生口**：每个"吞触摸态"（菜单/属性面板/强化浮层/结算/拖拽残留）都必须存在
   能点得动的出口，否则表现为"整块点不动"。**启动失败也要有逃生口**：用 `wx.showModal`（原生 UI，
   **不需要画布**）把原因摆到屏幕上，绝不静默黑屏。
6. **启动期的两个"探针"必须用对**：
   - 就绪探测**只能用** `wx.getSystemInfoSync()` / `wx.getWindowInfo()`；
     **绝不能用 `wx.getPerformance()`** —— 它本身就是"真机调试"环境 Bug 打坏的那个口（见下表），
     拿它当探针会永远探不通、白等 1.5s，还把真正的故障盖住、误报成「jsbridge 探测超时」。
   - 环境级故障（错误信息含 `getSystemNanoTime` / `ProfileGlobal` / `WAGamePerformanceUtilsSDK` /
     `jsbridge not ready`）**重试毫无意义**，必须立刻 `reportFatal` 喊停并把处置办法弹出来。

## 故障判据速查（先定案再改代码）

| 症状 | 判据 | 归属 |
|---|---|---|
| 卡在原生启动页 | 主屏 canvas 绘制指令 **= 0**，且 `createCanvas` 抛 `getSystemNanoTime` | **工具 Bug：真机调试**（换预览/体验版） |
| 卡在原生启动页 | 主屏 canvas 绘制指令 **= 0**，`createCanvas` 被调 **>1** 次 | 离屏画布：拿了第二块画布 |
| 卡在原生启动页 | 主屏 canvas 绘制指令 **= 0**，`ctx === null` | `getContext` 失败，同画布重试 |
| 整个界面点不动 | 首帧出了，之后停摆 | 主循环 rAF 断链 / 模态吞触摸 |
| 画面残缺 + 控制台报错 | 指令数少于正常值 | 某 Canvas API 缺失，画到一半抛异常 |

### 「真机调试」环境 Bug（2026-09-16 定案，别再当自己的锅查）

**现象**：Android 真机 + 微信开发者工具「真机调试」下，画面停在原生启动页，Console 刷

```
TypeError: Cannot read properties of undefined (reading 'getSystemNanoTime')
  at new Z (WAGamePerformanceUtilsSDK.js:...)
  at ... [as getNetworkType] (WAGamePerformanceUtilsSDK.js:...)
[DETECT EVENT] minigame detect tool inject!! enable=true, autoStart=true
[Trace] TraceGlobal not found
```

**三条判据同时成立即可定案**：① 报错栈**全在 `WAGamePerformanceUtilsSDK.js` / `WAGame.js`**，
没有一帧是本工程代码；② `wx.createCanvas()` 与 `wx.getPerformance()` **一起**抛错（共用底层纳秒计时口）；
③ 模拟器 / 预览 / 体验版正常，只有「真机调试」挂。

**佐证（两条独立反馈，均可复现）**：
- 微信开放社区（小游戏 / Bug / 精选热门，工具 `1.06.2504010`，Win11）
  《相同代码在真机调试下报错，体验版和正式版正常》→ `V.ProfileGlobal.getSystemNanoTime is not a function`
- GitHub `wechat-miniprogram/minigame-tuanjie-transform-sdk#43`（2025-08-07）
  Android 真机调试必现，PC + 模拟器正常

**处置**：换调试方式 —— ① 用「预览」扫码（手机 `···` → 开发调试 → 打开调试 看 vConsole 日志）；
② 上传体验版后用真机打开；③ 更新/重装开发者工具、切「真机调试 2.0」、换 iOS 设备。**别在游戏里绕。**

## 验证工具链（`node .workbuddy/tools/xxx.js`，报告落 `.workbuddy/tmp/_xxx.txt`）

- `syntax.js` 语法（22/22）· `verify.js` 逻辑断言（211/0）· `regress-ui.js` 可点性（35/0）
- **`entry3.js` 真机启动还原（45/0）** —— 8 个场景，数「主屏 canvas 绘制指令数」+ 断言 `createCanvas ≤ 1`，
  含场景 **I「性能桩永久损坏」**（钉死"不浪费画布槽位 / 不静默黑屏 / 弹 showModal 给处置办法"）。
  改 `game.js` / `theme.js` / `game_core.js` **必跑这个**；`bootretry.js` 已被它取代。
- `_runall.js` 一键全跑（已并入 entry3）。
- 判鲜规则：**先看 `_error.txt` 是否存在**（存在就先信它），并核对报告 mtime 与当前代码。

## 环境坑（本机特有，别浪费时间去试）

- **Git Bash 的 coreutils 全缺**（`ls`/`dirname`/`mkdir`/`tail` 都没有，只剩 shell 内建）。
  可用：`cd "F:/图形塔防" && <node绝对路径> -e "..."`。
- **PowerShell 工具不回显 stdout**，且沙箱会静默拦截 `Remove-Item`。
- 可靠套路：**用 node 脚本跑测试并把输出 `fs.writeFileSync` 成 UTF-8 文件，再用 Read 读**；
  删文件用 `fs.unlinkSync`。写完文件**另起一条命令**复核是否真的落盘。
- 批量生成的 `.png` 可能被静默回收；要给用户看渲染结果就内联成**自包含 `.html`**。
- 临时对照入口要放**项目根目录**（`require('./src/xxx')` 才能解析），用完立刻删。

## 数据口径（改动易错，务必保持一致）

- 攻击力：`towerDamage() = floor( floor(原生 × 等级加成 × 阶段增幅) × 图签倍率 )` —— **每层各自 floor**。
- 伤害结算**唯一入口** `game.applyDamage(sourceTower, enemy, baseDamage, opts)`：①暴击 roll
  ②有效抗性 = max(0, 抗性-穿透) ③递减减伤 `× (1 - eff/(eff+armorK))`，`armorK=200`，保底 1。
- 强化 = 每塔一项专属属性（`config.ENHANCE_SPECIAL`），取值恒为 `base + per × 等级`，
  **不发攻击力**；`tower.applyEnhanceAttrs` 按等级**全量重算**，不在旧值上累加。
- 面板与引擎必须同口径：面板走 `bonusStats.js`，战斗走 `tower.getTowerRuntimeStats`，两者要对拍。

## 素材/文案

- 中文界面；股票涨红跌绿（本项目无关，但沿用同一约定）。**UI 文本不用 emoji**（用矢量图标，
  见 `theme.drawStar` / `drawTowerIcon`）。
