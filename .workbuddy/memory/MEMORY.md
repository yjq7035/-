# 图形塔防 · 项目长期备忘

## 环境（Windows / Git Bash 残缺）
- Bash 缺 coreutils（ls/dirname/grep 都没有）；PowerShell 工具吞 stdout、管道会 EPIPE 假崩溃。
  node 输出一律 `fs.writeFileSync` 落盘再用 Read 取；Read 缓存可能滞后（Glob 看得到、Read 报没有）→ 用 Glob 复核。

## 验证工具链：`.workbuddy/tools/`
- **`node run-all.js` = 一键全量回归**（先删旧报告 → spawn 10 套 → 汇总 `tmp/_all.txt`，有红退出码 1）。跑全套一律用它，别手写 PowerShell 串。
- 套件：syntax（全 js 编译）/ probe-panel（7 分辨率×17 塔型「文字⊆clip」）/ probe-codex（图签+真实触摸）/ probe-gem（宝石+背包+合成）/ smoke（5×7 场景渲染+交互）/ probe-audio（假 wx 音频状态机+按钮几何）/ probe-graphic（平行塔+血条+HTML 交付）/ svgcheck / dump-gems / dump-texts（列 SVG text）；harness.js/svgctx.js 录制 ctx+SVG 回放；make-snowfall.py / audit-bgm.py / measure-timbre.py 为 BGM 生成与体检。
- 报告落 `.workbuddy/tmp/_*.txt`（早期几个写在 tools/）。**开跑前先删旧报告**，否则读到上一轮结论。
- Edge headless 被沙箱静默拦截、且吃不下非 ASCII `file:///` 路径 → 别依赖出图。

## 代码约定（踩过坑的）
- 布局只用 `game.W/H`（逻辑视口=触摸空间）；canvas.width/height 是物理像素。
- 「文案→面板高度」必须与绘制共用同一个换行函数（曾捅出面板 116px）；裁剪区贴面板本身，别写固定缩进；内容超高按"分隔线→页脚→内边距"让位，**按钮和数值绝不让位**。
- 主循环 loop() 必须 try/catch，requestAnimationFrame 重排放 try **之外**；渲染要 dt 取 `game.dt`。
- 多子路径形状别用 `roundRectPath`（内部 beginPath 擦掉前面的子路径），用 beginPath+roundRect 逐条追加。
- 新加塔型五处登记：TOWER_DEFS / TOWER_STATS / ENHANCE_SPECIAL / TOWER_SHAPES / drawTowerIcon；漏了会静默画成圆或固有技能只剩空标题。对称形状不随攻击旋转：`NO_ROTATE_SHAPES` + shouldRotateTowerIcon。
- 单位渲染态出生即初始化（enemy._hpGhost=maxHp），否则首次挨打的白条永远不出现。
- 强化增量只走 `tower.getEnhanceAttr`；招牌属性（ENHANCE_SPECIAL.key）= per×clamp(强化+宝石lv)，不读 enhanceAttrs（测试手写会静默无效）。
- 塔型键 `graphic` 已更名 `parallel`；再改键必须往 meta.js `TYPE_ALIAS` 加行，否则老号静默丢图签等级/丢宝石。
- 多 agent 并发改本仓库：改完先查 LastWriteTime + git status。**同文件禁止并行 Edit**（后写覆盖先写却全报成功）——同文件串行、跨文件才并行；改完 grep 复核（字面量+点访问各查一遍）。

## 音频 / BGM
- `audio/snowfall.mp3` 原创合成（make-snowfall.py）：37.9s 无缝循环 / F 大调 76BPM / 前 12.6s 是 pad 引子。**别用 Øneheart×reidenshi 那版录音**（版权），其公开分析参数可参考。
- `src/audio.js` 唯一碰 wx 音频 API，四条硬约束：非微信安全降级 / 异常不冒泡 / enabled(意愿)≠wantPlay(此刻该不该响) / 自动播放被静默拦截靠一次性触摸解锁兜底。
- 顶栏按钮从右往左码；音乐开关在 handleTouchStart 里提到 ④ 选关**之前**（②' 分支），否则没开打时全是死的。
- ⚠️"刺耳/难听"先查乐谱（旋律撞和弦、音域过冲），别先查频谱；心理声学"粗糙度"本项目标定失败，只作诊断**不作判据**。
- 假 wx：事件表用**数组**（onTouchXxx 是累积注册）；模拟"静默拦截自动播放"只能拦第一次。

## 宝石系统（2026-09-18 定型）
- 宝石带 lv：效果随 lv 线性放大（Lv.N=基础×N）；名字一律 `gemName(kind,lv)` 显示"Lv.N"。旧"宝石无等级"作废（奖励宝石=lv1 特例）。
- socketed 槽位 = `{kind,lv}` 对象（旧字符串档 normalize 迁移补 Lv.1）；断言/读槽走 `.kind`，别比字符串。
- 合成（`meta.synthesizeGems` + `GEM.synth`）：≥3 颗**同级**起，成功率 50%+10%/颗封顶 100%；成功产物=材料范围随机一种 +1 级；**失败材料全耗**（UI 明示）。锚点等级=第一颗选中，异级行 hit 层拦（kind:'disabled'+reason:'level'，toast 按 reason 分流）。
- ⚠️ 浮层布局随内容伸缩（列表加一行→面板长高→底部按钮下移）：点击/断言必须**现取现点**，改包/改选后旧布局引用立即作废——拿旧 goBtn 去点会被模态层当空白吞掉（"点了没反应"假象）。
- 浮层集中在 `src/gemModal.js`（gemPicker/gemInfo/gemSynth 三层统一路由 hasActive/hitActive/settleTap/drawGemModal），input.js ③' 模态分支接管、renderer 收尾统一调 drawGemModal；新浮层照此模板接。
