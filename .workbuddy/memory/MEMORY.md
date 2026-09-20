# 图形塔防 · 项目长期备忘

## 系统真源速查（改之前先看这里）
- 固有技能 `src/skills.js` 的 `SKILLS` ｜ 进阶（阶段）`src/stage.js` ｜ 光环 `src/auraManager.js` ｜ 宝石 `src/gems.js`(`GEM_KINDS`/`GEM.synth`) ｜ 面板绿字 `src/bonusStats.js` ｜ 天赋花费 `meta.talentCost` ｜ 浮层 `src/gemModal.js` ｜ 攻击朝向/弹道转向 `src/aim.js`。
- 铁律：**任何数值只能有一处定义**。展示、结算、场上标识必须调同一个函数，否则一定会出现"面板涨了打起来没变"。

## 攻击朝向系统（2026-09-19 新建 src/aim.js）
- 政策表 `SHAPE_AIM` 只有偏离默认的条目（`parallel` → 塔+弹道 FIXED；`square` → `projectileSpin:8`）；**默认「跟随朝向」**，所以新塔型一来就自适应，别把政策写回 renderer/theme。
- 唯一入口：写作 `initAim`(工厂) / `aimAtTarget` / `aimAt`；变换 `applyIconTransform`(塔) / `applyProjectileTransform`(弹道，平移→按朝向→叠自旋)；自旋 `advanceProjectile`；角度数学 `angleBetween/normalizeAngle`（game_core 里已无 `Math.atan2`）。`probe-aim` ⑧ 会扫源码：除 aim.js 外出现 `attackAngle =` 即报红。
- 坐标约定：**形状代码只画"朝右"的一份**（0 rad = +x）。⛔ 别在形状里再乘一次朝向（扇塔弹道曾经因此画在 2×朝向 上）。
- 弹道 switch 的 `default` 用 `theme.drawTowerIcon(...,0.28)` 兜底 → 新图形自动有弹道（以前没 case = 子弹隐身）。`drawProjectiles` 已拆出 `drawProjectileShape`(本地坐标) + `drawEffects`(世界坐标，别套旋转)，都导出了，探针可直接调。
- 探针踩坑：**别用 `rec.ops.length>0` 判"画了东西"**（save/restore 也推 op → 假绿）；**别用整帧 render 的 rotate 序列判朝向**（导航箭头就 rotate(±π/4)）。

## 进阶（阶段）系统（2026-09-19 新建 src/stage.js）
- 真源两张表：`STAGE_TABLES`（每类属性的星级放大表）+ `STAGE_FOCUS`（每塔的进阶焦点属性）。config 只剩 `MAX_STAGE=3`。
- 口径：**0★ = ×1 = 原生值**；倍率 = `1 + 表[星级]/100`。damage {1:100,2:200,3:400}；光环 {1:100,2:200,3:300}（= 旧 `(1+stage)`，梯塔数值未变）。
- 焦点：攻击塔默认 `['damage']` 不用登记；**辅助塔必须显式登记**（梯塔 auraPower / 菱形塔 auraPenetration），`stage.audit()` 对未登记者报红。
- ⛔ 旧坑（本次修）：写死的全局攻击增幅表，对 damage=0 的辅助塔恒等于 0 → **菱形塔 0★ 与 3★ 发出的穿透完全相同**，整条进阶线空转；面板还按 isSupport 硬挂「光环强度 +300%」假明细。
- 战斗侧唯一入口 `towerMod.getAuraOutput(tower, codexMult)`（战斗与场上标识共用）；**穿透光环吃进阶、不吃图签**（既定设计）。面板走 `bonusStats` 的 focus 循环，且 `final.auraPenetration` 必须乘 `percentMultiplier(AURA_PENETRATION)`。
- 写入唯一入口 `towerMod.setStage(t, n)`（同步历史字段 `attackPowerBoost`）；**展示/结算一律现算，不读那个存档值**（会过期）。
- 场上标识 `renderer.towerStageTag`：攻击塔 `+400%`；辅助塔显示**实际发出的光环值**（`攻速100`/`穿透20`），文案要短（槽距 44px）。
- ⚠️ 契约测不出"登记的焦点其实没接进战斗"→ 必须跑 `probe-stage.js`。

## 技能系统（2026-09-18 定型，替代 config.ENHANCE_SPECIAL）
- 固有技能 = 每塔专属；**一个技能可含多条效果**（`effects[]`），共用同一技能等级。三角塔「致命一击」= 一个技能两条效果，不是二选一。
- **两套口径必须分清**：【强化次数 n】0 起 0..5（存盘 = `tower.enhanceLevel`，报价/canEnhance/applyTo 用它）vs【技能等级 Lv】1 起 1..6（只用于展示与基数，Lv = 1+n）。混用 = 凭空多送一级（`canEnhance` 曾拿 Lv 比 maxLevel → Lv.6 永远到不了）。夹取分两把：`clampEnhanceTimes` / `clampLevel`。
- 战斗侧唯一入口 `skills.bonusFor(tower,key)`；`applyTo` 写 `enhanceAttrs`。⛔ 别把 `getEnhanceAttr` 改回只读 enhanceAttrs（宝石加的技能等级会蒸发）。
- **每条固有技能必须 base≠0**（0 = Lv.1 完全空转）；base 取**真原生值**，原生表没有就补 `TOWER_STATS` 字段（别写 0 糊弄）。`ZERO_BASE_ALLOWED` 为空，`audit()` 第⑤项报红。字段名对不上走 `NATIVE_GETTERS` 显式映射。
- ⚠️ 排查「技能显示 0」先看**塔的 description 有没有承诺过这能力**（箭形塔写明"破坏 3 点抗性"却漏 `break` 字段 = 白送空转技能）。⚠️ `audit()` 抓不出"原生值本身写错"。
- 战斗侧别写死塔型（`applyDamage` 的 brk 已改成读 `getAttackProfile().break`）。依赖单向：skills → config/gems；**gems 不许反向 require skills**。
- **技能槽（`src/skillSlot.js`）第一行是两段并列**：`已学 n/5`（暗色小字，真源 = **`tower.enhanceLevel`**，预览态不画）+ `Lv.N`（粗体，= 1 + 强化 + 宝石 + 十字塔共享 = `skills.levelOf`）。⛔ 别再写成二选一（历史 bug：`learnLv` 恒非 null → **Lv 永远画不出来**）。⛔ 塔实例上**没有** `skillLevels` 字段（同名的是 `gems.skillLevels(type)` 与光环键）；读它 = 选中实体塔必崩。
- **技能等级是十字塔共享属性里唯一取整的一条**（`tower.getAuraOutput` 里 `Math.floor`）：因为它会被写成 `Lv.N`（`renderer.js` 的「固有技能 Lv.N/6」），小数会印出 "Lv.1.3"。其余共享属性（攻速/暴击/暴击伤害）保留小数。1 颗猫眼石 0★ 共享 30% → 0（不足 1 级不共享）。
- 强化浮层信息区是**三行**，`getEnhanceLayout().infoLines` 必须给 3 个 y；标题行只放 `Lv.x → Lv.y`（括号里塞"已学/附加"会与左侧塔名重叠 66~85px，实测每种屏宽都撞）。

## 光环系统（2026-09-20 三次修订：加了「通道」）
- 存储 **`Map<targetId, Map<buffKey, Map<channel, entry>>>`**（三层；最后一层才是通道）。⛔ 别退回"每目标单槽"（一塔同时被菱形塔穿透+梯塔攻速罩住会整条互斥，放置顺序决定结果）。
- **通道 `config.AURA_CHANNEL`**：`aura`（辅助塔固有光环）/ `share`（十字塔「共享资源」）。竞争**只在同通道内**发生；**跨通道读值时相加**（`getAuraValue` 求和、`getAura().buffs` 同键相加）。登记处 = `TOWER_STATS[type].auraChannel`（缺省 aura），写入处 = `game_core.applyTrapezoidAuras` 的 `meta.channel`。
- ⛔ 为什么必须有通道（2026-09-20 玩家报的 bug）：共享资源与光环发出去的键**完全同名**（攻速/穿透/暴击率/破解/暴击伤害），分通道前在同一把键上抢唯一名额 → 谁阶段高谁留、**输的那个整条光环凭空消失**。玩家症状原话：「只有等级 lv 压住资源共享时才能正常效果，否则光环无法赋予」。修前实测：十字★3 能把梯塔★0 和菱形塔★0 的光环**同时**顶掉。
- 不同属性键可同时生效；同一通道同一属性键多源竞争**取最强**（阶段高者胜 → 同阶 |值| 大者胜 → 打平先到先得），不多源累加。两座十字塔也只取最强的一份共享。
- ⛔ 低阶来源不许给高阶光环续命。⛔ 禁止 `stats.supportBuff || {attackSpeedMultiplier:25}` 兜底（菱形塔会凭空多发 +25 攻速并抢梯塔的键）。
- 穿透光环必须走 `game_core.getEffectivePenetration`；攻速走 `getBuffedValue`。新加光环类属性务必同时接上战斗侧入口。
- `getChannelValue(id,key,channel)` = 只看某一条通道（探针/明细用它区分"这加成是光环发的还是共享发的"）；通道名非法/拼错一律回落 `aura`。**新加"发共享"的塔型必须在 TOWER_STATS 写 `auraChannel: AURA_CHANNEL.SHARE`**（probe-aura ⑨ 按 `shareRatio !== undefined` 反查，漏写报红）。
- 回归 = `probe-aura.js` 第 ⑨ 组：4×4 星级矩阵（十字★c × 梯塔/菱形塔★s）逐格核对「实得 = 共享值 + 光环值」，期望值独立取自 config.GEM_FAMILIES / TOWER_STATS / STAGE_TABLES（不用 getAuraOutput 验 getAuraOutput）。反向验证做过：把 `channel` 撤成单一通道 → 4 条红。

## 宝石系统
- 宝石带 lv（效果 ×N）；槽位 = `{kind,lv}` 对象，断言读 `.kind` 别比字符串。
- 合成：≥2 颗**同级**起，每颗 +10%（2 颗 = 20% 起步，封顶 100%）；成功产物 = 材料范围随机一种 +1 级；**失败材料全耗**。锚点等级 = 第一颗选中，异级行 hit 层拦。结算只掉 Lv.1（game_core.grantRewardGems 显式 `addGemsByKind(kind,1,1)`）。
- **宝石等级与强化次数共用同一上限**（`BALANCE.enhance.maxLevel`）：面板技能明细必须按 `totalTimes` 分摊（`gemPart`/`enhPart`），否则面板报 40%、战斗只 30%。宝石吃满时强化按钮变灰是故意的，文案要说清。
- ⚠️ 浮层布局随内容伸缩：点击/断言**现取现点**，改包/改选后旧布局引用立即作废。

## 代码约定（踩过坑的）
- 布局只用 `game.W/H`（canvas.width 是物理像素）。「文案→面板高度」必须与绘制共用同一个换行函数；裁剪区贴面板本身；内容超高按"分隔线→页脚→内边距"让位，**按钮和数值绝不让位**。
- **区块高度必须涵盖卡间距**：面板区块高度一律走真源函数（如 `renderer.gemBlockHeight(n) = sectionTitleH + n×gemRowH + (n−1)×gemGap`），**与绘制步进 `cardY += cardH + PANEL_UI.gemGap` 复用同一常量**。少算这份 gap → 内容探出区块 → 画在"下一区块正中"的分隔线正好压到最后一张卡上（2026-09-20 玩家截图事故：2 颗宝石净距只剩 1.5px、5 颗 −19.5px 直接插进卡里）。抄写范本 = `src/skillSlot.js` 的 `skillSlotsHeight`。⛔ 卡与卡之间**别再画任何 inset 装饰条**（那条 `rgba(179,136,255,0.2)` 紫条比 gap 还厚，2.3px 压在下张卡上，就是玩家口中的"不知道什么元素"）。
- 主循环 loop() 必须 try/catch，requestAnimationFrame 重排放 try **之外**；dt 取 `game.dt`。
- 多子路径形状别用 `roundRectPath`（内部 beginPath 会擦掉前面的子路径），用 beginPath+roundRect 逐条追加。
- 新加塔型五处登记：TOWER_DEFS / TOWER_STATS / **skills.js 的 SKILLS** / TOWER_SHAPES / drawTowerIcon；漏了会静默画成圆或技能只剩空标题。**朝向不用登记** —— aim 默认「跟随朝向」，只有"一转就撞脸"的轮廓才去 `aim.SHAPE_AIM` 写 `FIXED`（现在只有平行塔双横）。
- `TOWER_DEFS` 只管展示+定价四件套（name/color/cost/rarity）；辅助语义（isSupport / auraPenetration / range=光环半径）登记在 `TOWER_STATS`，且**战斗字段要写全**（缺字段 → `rs.attackSpeedMultiplier + x` = NaN）。
- 回归 mock 必须**照真平台抛错**（harness 的 addColorStop 按 CSS 颜色校验），别改回空函数（假绿事故）。
- **面板数值文案只有一个出口：`bonusStats.numText(v)` = `String(round2(v))`**（最多 2 位小数，整数不带小数点）。光环/倍率都是浮点乘算，`25 × 1 × 1.12 = 28.000000000000004`、`25 × 3 × 1.12 = 84.00000000000001`，把裸数字插进模板串就直接印给玩家（"生效效果"历史事故，2026-09-19 修）。⛔ `src/bonusStats.js` 里禁止再出现 `${round2(` 裸插值（SPEC 的 `never` 已锁）；守它的探针 = `probe-aura.js` ⑧ + `probe-panel.js` 末尾「面板全文无 >2 位小数」那条（文字条数随塔型/分辨率增长，别把数字写进备忘当断言）。
- 同名函数重复定义会静默覆盖 → 加完函数 `grep -oE "^function \w+" <file> | sort | uniq -d` 查重。
- ⛔ **改完必须跑全量回归再提交**。2026-09-20 事故：编辑完直接提交，`_all.txt` 里那句"失败 0 条"的判据戳比提交早 1.5 小时 —— 于是"探针全绿"和"真机崩溃"同时存在于同一个提交里。判断报告新不新：**看报告里的判据戳时间**，别只看红绿。
- **同一个界面往往有多条入口路径，只测一条 = 没测**。`probe-panel` 前三轮全走 `selectedTower = null`（预览/图签口径），于是"只有实体塔才会走到"的分支（`buildSkillSlots(tower)`）从来没执行过 → 16 套全绿、玩家一选塔就崩。第四轮补了"选中实体塔"（`tower.createTower` + `enhanceLevel=2`）。**加探针时先问：这条分支在别的入口会不会走另一条路？**
- **新写/改写的探针必须做反向验证**：把被修的源码退回修复前版本（`git checkout HEAD -- <文件>`，先备份到 `tmp/`），确认探针**真的会红**，再还原。本次退回后 154 条 FAIL、含玩家那条 `reading 'tri_crit'`。不做这步就分不清"探针守住了"和"探针根本没跑到"。
- **"只读不写"的字段是隐形雷**（`tower.X` 读取但全项目没有 `tower.X =`）：启动不报错，只在走到那一刻抛 TypeError，被主循环 try/catch 吞掉。排查法：扫 `tower\.(\w+)` 的读 − 写集合。假阳性来源：方法名（后面紧跟 `(`）、`units.createUnit` 对象字面量里的 `uniqueId/x/y`、以及注释。
- ⛔ **行尾是混的**（`src/` 里 14 个 CRLF + 16 个 LF，取决于最后一次是谁写的；`git diff` 会对含 LF 的文件发 "LF will be replaced by CRLF" 警告）。所以"扫源码"类探针**别写依赖行尾的正则**：`line.replace(/\/\/.*$/, '')` 在 CRLF 文件里因为 `$` 不匹配 `\r` 前面而**完全不生效**（注释没被剥掉 → 注释里出现的字段名会被当成真实读取）。一律用 `/\/\/.*/`（不带 `$`）。
- 宝石文案的唯一出口 `config.gemDescAt`：符号由家族的 `neg: true` 决定，**别假定所有宝石都是增益**（镇守宝石实际是 -3%，曾印成「+3%」）。
- 单位渲染态出生即初始化（`enemy._hpGhost=maxHp`）。塔型键 `graphic` 已更名 `parallel`；再改键必须往 meta.js `TYPE_ALIAS` 加行。

## 环境 / 工具链
- Bash 无 coreutils（ls/grep/head/dirname 全无），`rm` 被 safe-bin 拦死 → 删文件用 `node -e "fs.unlinkSync(...)"`。**查脏别打管道**（`git status|head` 会把输出整个吞掉，看着像"工作区干净"）。PowerShell 吞 stdout、管道 EPIPE 假崩溃。node 输出一律 `fs.writeFileSync` 落盘再用 Read；Read 缓存会滞后 → Glob 复核。
- ⛔ **含 `${...}` 或反引号的 JS 别塞进 `bash node -e "..."`**：`${...}` 会被 bash 先展开成空串（替换逻辑当场改坏源文件）；更阴的是中文长文本里被反引号包住的 shell 命令会**被当命令执行** —— 2026-09-19 真事故：日志文本里的 `git stash push` 跑了一遍，12 个 src 文件被 stash、工作区整体回滚到 HEAD，靠 `git stash pop` 找回、回归逐字一致。**一律先 Write 成脚本文件再 `node <文件>`**；出事先看 `git stash list`。
- **`node .workbuddy/tools/run-all.js` = 一键全量回归**（先删旧报告 → spawn 16 套 → 汇总 `tmp/_all.txt`，有红退出码 1）。套件：syntax / probe-panel（7 分辨率×17 塔型「文字⊆clip」）/ probe-codex / probe-gem / probe-gem-stack / probe-skill / probe-aura / probe-stage / **probe-aim** / smoke / probe-talent / probe-audio / probe-graphic / svgcheck / dump-gems / dump-texts。报告落 `tmp/_*.txt` 或 `tools/_*.txt`，**开跑前先删旧的**。
- 判「叠加还是覆盖」：别读注释、别信面板 —— 造 (无/只A/只B/AB) 四态，用 `bonusStats.collectTowerStats().final` 逐键 diff。
- 判「某加成有没有真的进战斗」：造多态跑**战斗口径** diff，**不许跳过辅助塔**（旧 probe-gem-stack ⑦ 的 `if (isSupport) continue` 正是菱形塔空转潜伏至今的原因）。
- **量面板几何前必须先清录制缓冲**：`new Game(...)` 构造函数会同步渲染一帧当前场景（选关界面）→ `rec.rects/ops/clips/texts` 里混进关卡卡（实测一张 `{x:97.15,y:295,w:125.7,h:40}`），出图脚本会误报"3 张宝石卡 / 间距 141px"、净间距跟着量错。四个缓冲**一起清**（只清 `texts` 会得到 −739.5px 的假红）。卡类几何用 `harness.gemCards()`（按几何键去重，因为 `roundRectPath`+fill+stroke 每张卡记两条）、分隔线用 `harness.dividerLines()` —— 探针与出图工具**共用同一份**。
- 工具：`.workbuddy/tools/canvasraster.js`（纯 Node canvas 2D → PNG 光栅器，支持 fillRect/roundRect+fill/多边形/clip 取交/渐变/fillText 画色块；不支持 arc 与变换）、`dump-panel-raster.js`（面板出图）、`dump-panel-html.js`（SVG 交付图 + 真实坐标标注）、`crop-png.py`（裁剪/最近邻放大/亮度增益 `gain`）、`rowprofile.py`（逐行亮度剖析，数"到底几条线、各多宽"，默认阈值 70 对 `rgba(255,255,255,0.45)` 的分割线够用）。
- ⛔ **PNG 里没有 ≠ 代码里没有**。光栅器只是近似：曾经 `bounds()` 不认 `q`/`b` 曲线（`drawTaperedDivider` 是纯曲线路径 → 整条线凭空消失）、渐变代表色取"首尾平均"（渐变首尾都透明 → 当成没画）。怀疑渲染缺失时，**先拿探针 ops 对一遍**再改源码；两边不一致就修工具。`rowprofile` 扫不到线先降阈值/查这两条。
- 判断"净间距/是否重叠"这类断言别用"任意分隔线"：头上那条也会被算成负值 → **每张卡只取它下方最近那条**。也别用 `panelScrollMax>0` 反推"分隔线没被压扁"，判据分两档：常规轮 `clear ≥ 0`（不许重叠），"设计间距"由宽屏不滚动场景单独锁定。
- 判断红灯是不是自己捅的：`git stash push -m x -- <文件>` → 跑对照 → `stash pop`。
- ⛔ **同文件禁止并行 Edit**（同一条消息多个 Edit → 后写覆盖先写却全报 success）。改完用 `tmp/_verify-edit.js` 直读磁盘核对 must/never token，别信 success 回执。Edge headless 被沙箱拦、吃不下非 ASCII `file:///` → 别依赖出图。

## 天赋 / 音频
- 学习花费唯一真源 `meta.talentCost(id, level)`（= N × 基础花费）；旧 `TALENTS[].costs` 静态表已删,probe-talent ① 守"不复辟"。改底栏文案必跑 probe-talent ⑤(量宽度,曾 350.6px 在 320 宽溢出)。
- `src/audio.js` 唯一碰 wx 音频;四条硬约束:非微信安全降级 / 异常不冒泡 / enabled(意愿)≠wantPlay(此刻该不该响) / 自动播放被静默拦截靠一次性触摸解锁。顶栏按钮从右往左码;音乐开关要提到选关分支**之前**。假 wx 的事件表用**数组**。
- **BGM 现役:`audio/rainfall.mp3`(2026-09-20 上线 v4)—— 80 秒无缝循环、梅雨午后氛围**。生成脚本 `.workbuddy/tools/make-rainfall.py`。上一版 `audio/snowfall.mp3`(31.3s v3)保留作 A/B 试听页对照,完整三件套备份在 `.workbuddy/tmp/_snowfall_v3_backup/`。
- **雨声不参与门控 = 接缝天然连续**(核心设计):v4 把雨声铺底层 `make_rain()` 设为恒定电平 0.025 不进入 PAD_GATE/FIG_GATE/MEL_GATE,整圈电平相同 → 不靠"两端 gate 值精确相等"也能保证无缝。这是 rainfall 比 snowfall 抗接缝爆音的根本原因。
- **"刺耳/难听"先查乐谱再查频谱**(v3 → v4 治"拉音/不好听"全套思路):① 旋律必须落在和弦音 / 安全延伸音上(强拍断言=0);② 音长 < 音距(tau=0.55~0.65s,音距 ≥ 0.833s);③ 整数谐波+快速滚降;④ 密度 1.4~3 音/秒;⑤ 母带 ≤ -16dBFS。先改乐谱再调 EQ。
- ⚠️ 接缝 audit 的 `PASS_edge_not_silent` 判据:别再用 `head/tail > body*0.15`(v4 末段刻意渐弱会判 FAIL)。**现行真源**:`tail > body*0.05` + `|head_db - tail_db| < 12dB` —— 反映真实意图(防编码器延迟导致循环点静音 + 防首尾电平不对称),不要求两端都接近 body 响。
- ⚠️ 这台机器 ffmpeg 不在 PATH、WinGet 链接也没了 → 跑 audit/compare/make-*.py 都靠 `imageio_ffmpeg` pip 包的 exe(`.workbuddy/tools/audit-bgm.py` / `compare-bgm.py` / `make-rainfall.py` 的 `find_ffmpeg()` 都优先 `imageio_ffmpeg.get_ffmpeg_exe()`)。
- ⚠️ 写"源码禁止出现某字符串"的探针时,别把那个字面量写进正文注释(注释也会被扫到)。
