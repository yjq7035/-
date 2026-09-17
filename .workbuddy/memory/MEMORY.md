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
| `run-all.js` | **一键全量回归**（`node run-all.js`）：先删旧报告 → 逐个 spawn **10 套** → 汇总写 `tmp/_all.txt`，有红则退出码 1。跑全套验证一律用它，别手写 PowerShell 串（会吞 stdout + 中文乱码） |
| `probe-audio.js` | 背景音乐专项：**伪造 wx** 跑音频状态机（24 项）+ 顶栏按钮几何 + 图标⊆按钮 + 真实点按 + 各场景按钮可见性 |
| `probe-panel.js` | 塔属性面板：7 分辨率 × 全塔型（现 17）「文字 ⊆ 自己那层 clip」断言 |
| `probe-codex.js` | 图签：布局不抛异常 + 真实触摸点卡片 + 面板裁剪层断言 |
| `probe-graphic.js` | 形状/血条/文案专项：双横几何、白条鬼影动态、无发光计数、战斗分支真跑 + 出自包含 HTML 交付 |
| `smoke.js` | 整机冒烟：5 场景跑完整 `renderer.render()` + 交互回归 |
| `svgcheck.js` | 回放 SVG 的「是不是一坨黑」体检（收文件名参数，可多份交付复用） |
| `dump-texts.js` | 把回放 SVG 的 `<text>` 按顺序列出来 → 查"面板上到底写了什么/有没有空标题" |
| `harness.js` / `svgctx.js` | 录制式 ctx（含 clip 栈追踪）/ SVG 回放器 |
| `dump-svg.js` | 出交付用自包含 HTML（内联 SVG） |
| `make-snowfall.py` | **生成** BGM（`audio/snowfall.mp3`）：环形写入 + 环形卷积混响 = 无缝；参数化可复现 |
| `audit-bgm.py` | BGM 无缝性审计：**审解码后的 mp3**（编码器延迟会毁掉循环），接缝一/二阶差分分位判据 |
| `measure-timbre.py` | BGM 听感体检：亮度重心 / 高频占比 / 瞬态硬度 / 尖峰。**粗糙度项已是诊断、不可作判据** |

报告落 `.workbuddy/tmp/_*.txt`（`probe-graphic.js` 已按此约定；早期几个工具写在 `tools/`）。
**每次开跑前先删旧报告**，否则会读到上一轮结论。
**Edge headless 在本机被沙箱静默拦截**，且吃不下非 ASCII 的 `file:///` 路径 → 别依赖出图。

## 代码约定（踩过坑的）
- 布局一律用 `game.W` / `game.H`（逻辑视口 = 触摸坐标空间）；`canvas.width/height` 是物理像素，别拿来算布局。
- **任何"文案 → 面板高度"的换算，必须与绘制共用同一个换行函数**。
  历史事故：描述换行了、固有技能说明没换行，导致文字捅出面板 116px 且高度算矮。
- 裁剪区要贴住面板本身，别写 `h - 50` 这种固定缩进（会把底部合法内容切掉）。
- 内容高于屏幕时按"装饰优先级"让高：分隔线 → 页脚留白 → 内边距；**按钮和数值绝不让位**。
- 主循环 `loop()` 必须 try/catch，且 `requestAnimationFrame` 重排帧要放在 try **之外**。
- **画多个子路径的形状不能用 `roundRectPath`**（内部 `beginPath()`，第二次调用会擦掉第一个子路径）；
  要用 `ctx.beginPath()` + `ctx.roundRect()` 逐条追加。平行塔"双横"就靠这条。
- 新加塔型必须同时登记 `TOWER_DEFS` / `TOWER_STATS` / `ENHANCE_SPECIAL` / `TOWER_SHAPES` / `drawTowerIcon` 的 case。
  漏 case 会静默掉进 `default` 画成圆（平行塔初版就是这么错的）；漏 `ENHANCE_SPECIAL` 会让属性面板的
  「固有技能」只剩一个空标题。
- **对称形状不跟随攻击朝向旋转**：`theme.shouldRotateTowerIcon(type)` + `NO_ROTATE_SHAPES`（双横转 90° 变双竖）。
- **单位上的渲染态（如血条鬼影 `_hpGhost`）必须在出生时初始化**（`enemy._hpGhost = maxHp`），
  否则"第一次挨打"的白条永远不出现（血条满血时不绘制 → 没机会初始化）。
- 渲染层要 `dt` 就取 `game.dt`（主循环每帧写入），不要自己算帧间隔。
- 战斗数值的强化增量**只走 `tower.getEnhanceAttr(tower, key)`**；注意"宝石版"起，**招牌属性**
  （`ENHANCE_SPECIAL[type].key`）走的是 `per × clamp(强化等级 + 宝石等级)`，**不读 `tower.enhanceAttrs`**
  —— 测试里手写 `enhanceAttrs` 模拟强化会静默无效。
- **塔型内部键**：`graphic` 已更名为 **`parallel`**（显示名「图形塔」→「平行塔」，2026-09；旧名与塔族统称撞车）。
  存档里以塔型为键的三张表（`codex` / `lineup` / `socketed`）靠 `meta.js` 的 `TYPE_ALIAS` 自动搬迁 —— 以后再改塔型键，
  **必须往 `TYPE_ALIAS` 加一行**，否则老号静默掉图签等级/丢宝石。
- **本仓库可能被多个 agent 同时改**：改完先 `Get-ChildItem src\*.js | Sort LastWriteTime -Descending`
  + `git status` 看有没有并发写入（曾在会话中途多出 `src/gems.js` 并改写 `getEnhanceAttr`）。
- **同一个文件禁止并行发多个 Edit**：每条 Edit 都是"读全文→替换→写全文"，并发时后写覆盖先写，
  **却全部回 "Successfully edited"**（实测 4 条只落地 1~2 条，2026-09-17 又栽两次：
  `input.js` 的 ②' 分支、`probe-audio.js` 的 silentPlay 改动）。同文件改动串行发，跨文件才可并行；
  改完必须 grep 复核，且要同时 grep「引号字面量」和「点访问」（`.graphic` 这种点访问第一遍漏查过）。

## 音频 / 背景音乐（2026-09-17 新增）
- 曲目 `audio/snowfall.mp3`：**原创合成**（脚本 `make-snowfall.py`）。12 小节 / 37.9s 无缝循环 /
  mono 32kHz 80kbps / 371KB。F 大调 / 76BPM / Fmaj7–Gm7–Dm9–Bb△7；**前 12.6 秒是纯 pad 引子**。
- **不要用流传那版 snowfall（Øneheart × reidenshi）的录音** —— 有版权的商业录音，打进包体发布即侵权。
  但它的**公开分析参数可用**（F 大调 / I△7–ii7–vi9 / 旋律 C4–C6），照参数做自己的曲子即可。
- `src/audio.js` 是唯一碰 `wx` 音频 API 的地方；渲染/输入只经它导出的接口 + `getState()`。
  它有四条硬约束：非微信环境安全降级（否则 node 冒烟全挂）/ 异常绝不冒泡 / `enabled`(用户意愿) 与
  `wantPlay`(这一刻该不该响) 分开（否则切后台回来音乐自己复活）/ 自动播放被**静默拦截**时靠一次性
  触摸解锁兜底（那种失败没有错误可捕获）。
- 顶栏按钮布局**从右往左码**（☰ 贴右边距，其余往左排）。音乐开关是全局操作，
  在 `handleTouchStart` 里提到 ④ 战前选关**之前**（②' 分支）—— 否则"还没开打"时顶栏全是死的。
- ⚠️ **"刺耳/难听"先查乐谱，别先查音色和频谱**。实测事故：v1 四项客观亮度指标全部合格
  （重心 405Hz、>4kHz 占 0.025%），却被判"太刺耳" —— 真因是旋律用随机数从音阶挑音、
  **不看当前和弦**（在 Fmaj7 上蹦出 B=#11）+ 音域冲到 E6 + 非谐波泛音。修法和声后问题消失。
- ⚠️ 心理声学"粗糙度"指标在本项目**标定失败**：判 v2（重做后）比 v1（判刺耳）更糙，排序与听感相反
  （加了 A 计权也没救）。它是浑浊度不是刺耳度，已降级为诊断项、不参与 PASS。**别再拿它当判据。**
- 假 wx 的两个坑：事件表要用**数组**（`wx.onTouchXxx` 是累积注册，单槽会互相冲掉）；
  模拟"静默拦截自动播放"**只能拦第一次**（否则分不清兜底没生效还是假 wx 把兜底也拦了）。
