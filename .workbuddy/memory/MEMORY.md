# 图形塔防 · 项目长期备忘

## 环境（Windows / Git Bash 残缺）
- Bash 缺 coreutils（ls/dirname/grep 都没有）；PowerShell 工具吞 stdout、管道会 EPIPE 假崩溃。
  node 输出一律 `fs.writeFileSync` 落盘再用 Read 取；Read 缓存可能滞后（Glob 看得到、Read 报没有）→ 用 Glob 复核。

## 验证工具链：`.workbuddy/tools/`
- **`node run-all.js` = 一键全量回归**（先删旧报告 → spawn 11 套 → 汇总 `tmp/_all.txt`，有红退出码 1）。跑全套一律用它，别手写 PowerShell 串。
- 套件：syntax（全 js 编译）/ probe-panel（7 分辨率×17 塔型「文字⊆clip」）/ probe-codex（图签+真实触摸）/ probe-gem（宝石+背包+合成）/ **probe-skill（技能系统：表契约/一技能多效果/强化链路/宝石加等级/面板vs战斗同口径/属性面板覆盖）** / smoke（5×7 场景渲染+交互）/ probe-audio（假 wx 音频状态机+按钮几何）/ probe-graphic（平行塔+血条+HTML 交付）/ svgcheck / dump-gems / dump-texts（列 SVG text）；harness.js/svgctx.js 录制 ctx+SVG 回放；make-snowfall.py / audit-bgm.py / measure-timbre.py 为 BGM 生成与体检。
- 报告落 `.workbuddy/tmp/_*.txt`（早期几个写在 tools/）。**开跑前先删旧报告**，否则读到上一轮结论。
- Edge headless 被沙箱静默拦截、且吃不下非 ASCII `file:///` 路径 → 别依赖出图。

## 代码约定（踩过坑的）
- 布局只用 `game.W/H`（逻辑视口=触摸空间）；canvas.width/height 是物理像素。
- 「文案→面板高度」必须与绘制共用同一个换行函数（曾捅出面板 116px）；裁剪区贴面板本身，别写固定缩进；内容超高按"分隔线→页脚→内边距"让位，**按钮和数值绝不让位**。
- 主循环 loop() 必须 try/catch，requestAnimationFrame 重排放 try **之外**；渲染要 dt 取 `game.dt`。
- 多子路径形状别用 `roundRectPath`（内部 beginPath 擦掉前面的子路径），用 beginPath+roundRect 逐条追加。
- 新加塔型五处登记：TOWER_DEFS / TOWER_STATS / **`src/skills.js` 的 SKILLS**（原 ENHANCE_SPECIAL 表已删）/ TOWER_SHAPES / drawTowerIcon；漏了会静默画成圆或固有技能只剩空标题。对称形状不随攻击旋转：`NO_ROTATE_SHAPES` + shouldRotateTowerIcon。
- `TOWER_DEFS` 只管**展示+定价四件套**（name / color / cost / rarity）；辅助语义（isSupport / auraPenetration / **range=光环半径**）一律登记在 `TOWER_STATS`。缺 color → 图签一解锁就每帧 `addColorStop('undefined')`；缺 range → 面板显示「范围 undefined」（引擎有 `||150` 兜底所以不报错）。改表时别把两表的形状搞混 —— 菱形塔就是这么炸的。
- 回归的 mock 必须**照真平台抛错**，否则是假绿：`harness.js` 的 `addColorStop` 已按 CSS 颜色校验（含 rgba 分量有限性）、渐变参数要求有限/半径非负。别改回空函数（2026-09 事故：空 addColorStop + 只在"默认档"画图签，两个盲区叠在一起，让"缺 color 每帧抛错"一路绿灯）。`probe-codex.js` ⑧ 已锁「四件套契约 + 全塔型已解锁绘制 + 画面不出现字面量 undefined」。
- 同名函数重复定义会**静默覆盖**：tower.js 的 getSpecialDef/getSpecialValue/getSpecialBonus 曾被多技能改造各写两份（漏摊平 base/per → `per×等级=NaN`，三角塔暴击率 NaN）；这套包装函数现已整体删除。加完函数记得 `grep -oE "^function \w+" <file> | sort | uniq -d` 查重名。
- 单位渲染态出生即初始化（enemy._hpGhost=maxHp），否则首次挨打的白条永远不出现。
- 强化增量只走 `tower.getEnhanceAttr`（已直接委托 `skills.bonusFor`）；技能属性 = `effects[i].per × clamp(强化等级+宝石等级, 0, maxLevel)`，不读 enhanceAttrs（测试手写会静默无效）。
- 塔型键 `graphic` 已更名 `parallel`；再改键必须往 meta.js `TYPE_ALIAS` 加行，否则老号静默丢图签等级/丢宝石。
- 多 agent 并发改本仓库：改完先查 LastWriteTime + git status。**同文件禁止并行 Edit**（同一条消息里对同一文件发多个 Edit → 后写覆盖先写却全报 success；Read/Grep 还有缓存滞后）。**改完一律用 `tmp/_verify-edit.js` 直读磁盘核对 must/never token**（它按 SPEC 表扫所有文件的必需/禁止字符串），别信 Edit 的 success 回执。

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

## 技能系统（2026-09-18 定型，替代 config.ENHANCE_SPECIAL）
- 固有技能 = 每塔默认专属、不可习得；唯一真源 `src/skills.js` 的 `SKILLS`。**一个技能可含多条效果**（`effects[]`，每条 `{key,name,base,per,unit,desc}`），全部效果**共用同一技能等级**：强化一次 = 技能等级 +1 = 所有效果一起涨；猫眼石加技能等级同理（`gems.skillLevels → skills.gemLevels → skills.levelOf`）。
- 三角塔「致命一击」= **一个技能两条效果**（critChance 5%/级 + critDamage 10%/级），不是两个技能二选一。
- 口径单一真源（2026-09-18 二次定稿：**技能等级从 Lv.1 起算**）：塔一放下就是 **Lv.1**（不存在 Lv.0），属性 = 原生值本身；强化/宝石各 +1 级。等级 `Lv = LEVEL_BASE(1) + n`（1..6），数值 = `base + per×n`。战斗侧唯一入口 `skills.bonusFor(tower,key)`，`applyTo(tower)` 把每条的 `per×n` 写进 `tower.enhanceAttrs`。
- ⚠️ **两套口径必须分清，混用就是凭空多送一级**：【强化次数 n】0 起 0..5，存盘的就是它（`tower.enhanceLevel`），报价/`canEnhance`/`applyTo` 全用它；【技能等级 Lv】1 起 1..6，只用于展示与取值基数。skills 里两把夹取分开：`clampEnhanceTimes`（次数）vs `clampLevel`（等级），`tower.getEnhanceTimes` vs `getEffectiveSkillLevel` 同理。**2026-09-18 实测踩坑**：`canEnhance` 忘改，拿 Lv(1..6) 去比 `maxLevel`(5) → Lv.5 被误判满级、技能永远到不了 Lv.6（面板按钮画得出来、点下去被 `canEnhanceTower` 拦掉）。`probe-skill` ⑨ 组已加「Lv.5 可强化 / Lv.6 不可 / 连续强化 5 次不卡住」守死。
- **效果的 base 必须是「真原生值」**——即 `TOWER_STATS` 里真有同名字段（字段名不一致的走 `skills.js` 的 `NATIVE_GETTERS` 显式映射，如 explosionDamage↔explosionRatio、sectorAngle↔sectorHalfAngle、break↔st.break）。只改显示不改结算 = 假数值；三角塔 critDamage 原生就 10%，`getAttackProfile`/`getTowerRuntimeStats`/`bonusStats`/`codex` 四处都 `+(st.critDamage||0)/100` 并进倍率（Lv.1 倍率 2.2 → Lv.6 2.7）。改动后加/改 `skills.audit()` 与 `probe-skill.js` 断言同步。
- ⚠️ **排查「技能显示 0」的正确姿势：先看塔的 description 有没有承诺过这个能力。** 箭形塔 description 写着"破坏目标 3 点抗性"、`TOWER_STATS.arrow` 却没 `break` 字段 → 白送一个 Lv.1 空转的碎甲技能（2026-09 实锤）。
- **规则（2026-09-18 定稿）：每条固有技能都必须有非零初始值。** `base=0` = Lv.1 完全空转（面板显示「穿透 0」、浮层显示「0 → 5」，玩家看到的就是坏掉的技能），与「一放下就生效」矛盾。base 一律取塔的**真原生值**，原生表里没有就**补 `TOWER_STATS` 字段**——不是把 base 写成 0 糊弄。现役起点：箭形塔破解 3 / 半圆塔穿透 3 / 星形塔暴击 5% / 闪电塔暴击 5%（三角塔暴击 5% + 爆伤 10%）。`ZERO_BASE_ALLOWED` 是**空**逃生舱；`audit()` 第⑤项对任何未登记的 base=0 报红，`probe-skill` ⑧ 组断言「不存在生效却 base=0 的技能」。
- ⚠️ `audit()` **抓不出"原生值本身写错"**（原生=0 时 base=0 一路绿灯）；它只核 base↔原生是否一致。所以新增"某属性从 0 起"的技能时，必须人工确认那是设计而不是漏登记字段。
- 战斗侧别再写死塔型：`game_core.applyDamage` 的 `brk` 原为 `type === 'arrow' ? …break : 0`，已改成读 `getAttackProfile().break`——写死塔型会让后加的破解技能静默失效。
- 依赖方向单向：`skills → config/gems`；**gems 不许反向 require skills**（成环），调用方直接用 `skills.skillName`。
- 展示层四处同口径：面板 `bonusStats`（每条生效效果都要有行——菱形塔「穿透光环」、箭形塔「破解」历史缺口已由 `probe-skill.js` ⑦ 守死）/ 技能槽 `skillSlot`（按可用宽度 ellipsize）/ 强化浮层 `enhance`（一技能一张卡，卡片高度随 effects 条数变）/ 图签 `codex`。

## 天赋学习花费（2026-09-18 改版：等级 × 基础花费）
- 口径：**学 Lv.N 的花费 = N × 该天赋的基础花费**。基础花费 = `config.TALENTS[].cost`（单值，不再是数组）；没写 cost 的用 `config.TALENT_COST.default`（当前 2）兜底。
  现役：点石成金 / 涓流金库 / 波次结余 = 2（Lv.1..10 = 2,4,…,20，学满 110）；其余 6 条 = 1（1,2,…,10，学满 55）。全学满 660 点（改版前 229）。
- ⚠️ **唯一真源 `meta.talentCost(id, level)`**（level 是"目标等级"，1 起，会夹到 [1, max]）：`talents.js` 的按钮报价与 `learnTalent` 的扣点都调它。旧的 `TALENTS[].costs` 静态价格表（90 个数字）已删除，`probe-talent.js` ① 组扫源码守住"costs 不复辟"。
- 展示==结算已锁：`probe-talent.js` ④ 组渲染后按按钮矩形逐行取文字，比对 `✦N` 与 `meta.talentCost`。
- ⚠️ 改 `talents.js` 底栏文案要量宽度：第一版 350.6px 在 320 宽**溢出**（x0=-15.3）。`probe-talent.js` ⑤ 组对 5 个分辨率断言 `x0 ≥ 0 且 x1 ≤ W`，改文案后必跑。
- ⚠️ 写"源码禁止出现某字符串"的探针时，别把那个字面量写进**正文注释**里（注释也会被扫到，自己把自己判红）。
