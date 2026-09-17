# 图形塔防 · 项目长期备忘

## 环境（Windows / Git Bash 残缺）
- **Bash 工具基本不可用**：缺 `ls` / `dirname` / `wc` 等 coreutils。用 PowerShell + Read/Glob/Grep 替代。
- **PowerShell 工具会吞掉 stdout**：node 脚本输出一律 `fs.writeFileSync` 落盘，再用 Read 取；
  不要用管道（会制造 EPIPE 假崩溃）。
- **Read 工具文件缓存可能滞后**（Glob 已能看到、Read 报不存在）→ 换 Glob 复核。

## 验证工具链：`.workbuddy/tools/`（改动 UI 后按顺序跑）
| 文件 | 用途 |
|---|---|
| `syntax.js` | `vm.Script` 编译全部 .js（只编译不执行），秒级语法体检 |
| `probe-panel.js` | 塔属性面板：7 分辨率 × 16 塔型「文字 ⊆ 自己那层 clip」断言 |
| `probe-codex.js` | 图签：布局不抛异常 + 真实触摸点卡片 + 面板裁剪层断言 |
| `smoke.js` | 整机冒烟：5 场景跑完整 `renderer.render()` + 交互回归 |
| `svgcheck.js` | 回放 SVG 的「是不是一坨黑」体检 |
| `harness.js` / `svgctx.js` | 录制式 ctx（含 clip 栈追踪）/ SVG 回放器 |
| `dump-svg.js` | 出交付用自包含 HTML（内联 SVG） |

报告落 `.workbuddy/tmp/_*.txt`。**每次开跑前先删旧报告**，否则会读到上一轮结论。
**Edge headless 在本机被沙箱静默拦截**，且吃不下非 ASCII 的 `file:///` 路径 → 别依赖出图。

## 代码约定（踩过坑的）
- 布局一律用 `game.W` / `game.H`（逻辑视口 = 触摸坐标空间）；`canvas.width/height` 是物理像素，别拿来算布局。
- **任何"文案 → 面板高度"的换算，必须与绘制共用同一个换行函数**。
  历史事故：描述换行了、固有技能说明没换行，导致文字捅出面板 116px 且高度算矮。
- 裁剪区要贴住面板本身，别写 `h - 50` 这种固定缩进（会把底部合法内容切掉）。
- 内容高于屏幕时按"装饰优先级"让高：分隔线 → 页脚留白 → 内边距；**按钮和数值绝不让位**。
- 主循环 `loop()` 必须 try/catch，且 `requestAnimationFrame` 重排帧要放在 try **之外**。
