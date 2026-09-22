// ============================================================================
// 攻击朝向系统（aim）—— src/aim.js
// ----------------------------------------------------------------------------
// 唯一职责：回答「谁朝哪边、要不要转、弹道怎么摆、弹道转不转圈」。
//
// 系统建立之前，这件事被抄了三份、各写各的：
//   ① game_core 里 6 处 `tower.attackAngle = Math.atan2(dy, dx)`，另有 4 处
//      各自算一遍 atan2 当弹道角；
//   ② theme.js 的 `NO_ROTATE_SHAPES` / `shouldRotateTowerIcon`（塔本体转不转）；
//   ③ renderer.js 弹道 switch 里手写的补丁 —— `parallel` 分支自己反向旋转去抵消
//      外层的朝向旋转，`square` 分支自己再加一次自旋。
// 三份口径各说各话的后果（下面两条都是真实存在的缺陷，不是假想）：
//   · **扇塔弹道转了两遍**：外层已经按朝向 rotate 过一次，扇形子路径又用
//     `proj.angle ± 45°` 画了一遍 → 实际画在 2×朝向 的方向上（朝 45° 飞，扇面指 90°）；
//   · 新增一种图形必须同时改 3 个文件才"看起来正常"，漏一处就是静默错误
//     （平行塔弹道曾经整条掉出 switch、一颗子弹都不画）。
//
// ========== 本系统约定的坐标系（与 theme.drawTowerIcon 的既有约定同源）==========
//   · 本地坐标系 0 rad = 指向 +x（正右方）；y 向下为正（canvas 约定）；
//   · 塔本体与弹道的**形状绘制代码只画"朝右"的那一份**，朝向由本模块施加
//     （applyIconTransform / applyProjectileTransform）；
//   · 于是"形状朝向"与"攻击朝向"永远同步，新形状不含任何朝向相关代码。
//
// ========== 自适应（这是本系统存在的首要理由）==========
//   · 政策表的**默认值是"跟随朝向"** —— 新图形一登记就自动获得
//     「塔本体转向 + 弹道随飞行方向转向」，不需要来改本文件；
//   · 只有"轮廓一转就跟别的塔撞脸"的极少数图形才需要显式登记（见 SHAPE_AIM）；
//   · audit() 抓的是**登记类错误**：政策表里的键在塔/图形表里查无此塔（改名残留）、
//     或某塔型有定义却没图形。历史上 graphic → parallel 改名就留过这种尾巴。
//
// ⛔ 纪律：`tower.attackAngle` 的**写入**只允许出现在本文件；
//    战斗层要朝向就调 aimAtTarget / aimAt，渲染层要旋转就调 apply*Transform。
//    这条由 probe-aim 的源码契约段守着（game_core 里再出现裸写入即报红）。
// ============================================================================
const config = require('./config');
const theme = require('./theme');

// ============================================================================
// 一、转向政策（唯一真源）
// ----------------------------------------------------------------------------
// TURN.FOLLOW —— 跟随朝向：塔本体按攻击朝向转 / 弹道按飞行方向转
// TURN.FIXED  —— 保持正立：轮廓一转就变成别的塔，永不旋转
// ============================================================================
const TURN = { FOLLOW: 'follow', FIXED: 'fixed' };

/** 静态朝向：0 rad = 朝右。塔出生时的默认朝向（也是"没有目标"时保持的姿态）。 */
const REST_ANGLE = 0;

/** 未登记的图形一律按"跟随朝向"处理 —— 这就是"扩展时自适应"的落点 */
const DEFAULT_AIM = { tower: TURN.FOLLOW, projectile: TURN.FOLLOW, projectileSpin: 0 };

/**
 * 各图形的转向政策（只登记"偏离默认"的图形）。
 *
 * · `tower` / `projectile`：见 TURN，缺省 = FOLLOW；
 * · `projectileSpin`：弹道自旋角速度（弧度/秒），缺省 0 = 不自旋。
 *
 * 平行塔 2026-09 起取消 FIXED 登记：塔本体与弹道都回归默认"跟随朝向"
 * （塔指向攻击目标、弹道指向飞行方向），与其它 14 型口径一致；
 * 双横轮廓 0 rad 时仍呈水平"二"字，随飞行方向整体旋转（转向下即成"||"）。
 */
const SHAPE_AIM = {
  // 正方塔弹道（激光）自带自旋：原先由 game_core 的 updateProjectiles 每帧
  // 硬加 `dt * 8`，现在归这里管（8 rad/s ≈ 1.27 圈/秒）
  square: { projectileSpin: 8 },
};

// 政策是静态数据，按塔型缓存一份解析结果（每帧每弹道都会查）
const _policyCache = new Map();

/** 解析某塔型的转向政策（任何输入都返回一份可用的政策，未知图形 = 默认跟随） */
function policyOf(type) {
  const key = (type === undefined || type === null) ? '' : String(type);
  const hit = _policyCache.get(key);
  if (hit) return hit;
  const raw = SHAPE_AIM[key];
  const p = {
    type: key,
    tower: (raw && raw.tower) || DEFAULT_AIM.tower,
    projectile: (raw && raw.projectile) || DEFAULT_AIM.projectile,
    projectileSpin: (raw && raw.projectileSpin) || 0,
    declared: !!raw,          // 是否在政策表里显式登记过（仅供 audit / 探针区分）
  };
  _policyCache.set(key, p);
  return p;
}

/** 塔本体图标是否随攻击朝向旋转 */
function canRotateIcon(type) {
  return policyOf(type).tower === TURN.FOLLOW;
}

/** 弹道轮廓是否随飞行方向旋转 */
function canRotateProjectile(type) {
  return policyOf(type).projectile === TURN.FOLLOW;
}

/** 该塔型弹道的自旋角速度（弧度/秒），0 = 不自旋 */
function spinOf(type) {
  return policyOf(type).projectileSpin;
}

// ============================================================================
// 二、角度数学（全项目唯一实现，别再散落 atan2）
// ============================================================================
const TWO_PI = Math.PI * 2;

/** 有限数字兜底：NaN / Infinity / 非数字一律取默认值（canvas 遇到非有限参数会静默不画） */
function numOr(v, d) {
  return (typeof v === 'number' && isFinite(v)) ? v : d;
}

/** 归一化到 (-π, π] —— 只用于需要"角度差"的地方（如扇面判定），朝向写入不做归一化 */
function normalizeAngle(a) {
  let x = numOr(a, 0) % TWO_PI;
  if (x > Math.PI) x -= TWO_PI;
  if (x <= -Math.PI) x += TWO_PI;
  return x;
}

/** 两点连线的朝向（唯一 atan2 实现） */
function angleBetween(x1, y1, x2, y2) {
  return Math.atan2(numOr(y2, 0) - numOr(y1, 0), numOr(x2, 0) - numOr(x1, 0));
}

/** 单位（塔/怪）指向目标的朝向 */
function angleTo(unit, target) {
  if (!unit || !target) return REST_ANGLE;
  return angleBetween(unit.x, unit.y, target.x, target.y);
}

/** 读塔当前的攻击朝向（永远有限，缺省 = 静止朝向） */
function currentAngle(tower) {
  return numOr(tower && tower.attackAngle, REST_ANGLE);
}

/**
 * 初始化/复位一座塔的朝向（写入口 #1 —— 工厂造塔时用）。
 * 放在这里是为了守住"除本文件外零写入"这条纪律：
 * 连"给字段一个初始值"这种赋值也不许散到 tower.js 去。
 */
function initAim(tower) {
  if (!tower) return REST_ANGLE;
  tower.attackAngle = REST_ANGLE;
  return tower.attackAngle;
}

/** 让塔转向某个坐标点，返回该朝向（写入口 #2） */
function aimAt(tower, x, y) {
  if (!tower) return REST_ANGLE;
  const a = angleBetween(tower.x, tower.y, x, y);
  tower.attackAngle = a;
  return a;
}

/** 让塔转向某个单位，返回该朝向（写入口 #3 —— 战斗层用这个） */
function aimAtTarget(tower, target) {
  if (!tower || !target) return currentAngle(tower);
  return aimAt(tower, target.x, target.y);
}

// ============================================================================
// 三、变换施加（渲染层唯一入口）
// ============================================================================
/**
 * 施加塔本体的朝向变换，返回该把图标画在哪儿。
 * 不跟随朝向的塔型**不做任何变换**（保持历史调用形状，绘制指令与旧版逐字一致）。
 * @returns {{ rotated:boolean, x:number, y:number }} 传给 drawTowerIcon 的坐标
 */
function applyIconTransform(ctx, tower) {
  const x = numOr(tower && tower.x, 0);
  const y = numOr(tower && tower.y, 0);
  if (!canRotateIcon(tower && tower.type)) return { rotated: false, x, y };
  ctx.translate(x, y);
  ctx.rotate(currentAngle(tower));
  // 已平移到塔位，形状按"朝右"画在原点即可
  return { rotated: true, x: 0, y: 0 };
}

/**
 * 施加弹道的朝向变换（平移到弹道位置 → 按飞行方向旋转 → 叠加自旋）。
 * 形状绘制代码因此只需要画"朝右"的那一份。
 * @returns {object} 该塔型的政策（调用方可据此跳过不必要的绘制）
 */
function applyProjectileTransform(ctx, proj) {
  const p = policyOf(proj && proj.type);
  ctx.translate(numOr(proj && proj.x, 0), numOr(proj && proj.y, 0));
  if (p.projectile === TURN.FOLLOW) ctx.rotate(numOr(proj && proj.angle, 0));
  const spin = numOr(proj && proj.spinAngle, 0);
  if (spin) ctx.rotate(spin);
  return p;
}

/**
 * 推进弹道自旋（唯一入口 —— 别再往 updateProjectiles 里写 `+= dt * 8`）。
 * 只有政策里声明了 projectileSpin 的塔型会转；其余塔型自旋量恒为 0
 * （即"没有自旋政策 = 不发生任何状态变化"，不留一个永远不动的字段当摆设）。
 * @returns {number} 推进后的自旋角
 */
function advanceProjectile(proj, dt) {
  if (!proj) return 0;
  const rate = spinOf(proj.type);
  const cur = numOr(proj.spinAngle, 0);
  proj.spinAngle = rate ? (cur + rate * numOr(dt, 0)) : 0;
  return proj.spinAngle;
}

// ============================================================================
// 四、audit：登记完整性（抓"改名残留 / 有塔没图形"这类静默错误）
// ----------------------------------------------------------------------------
// 参数是为了可测：探针可以喂一份"故意写错键"的假注册表，验证它真的报红。
// 默认取真实注册表（塔定义表 src/config.js，图形表 src/theme.js）。
// @returns {{ ok:boolean, red:string[], info:string[] }}
//   red  = 必须修的错误（键查无此塔 / 塔型没有图形）
//   info = 使用默认"跟随朝向"政策的塔型清单（提示确认轮廓是否真的带指向，不是错误）
// ============================================================================
function audit(defs, shapes) {
  const towerDefs = defs || (config && config.TOWER_DEFS) || {};
  const shapeList = shapes || (theme && theme.TOWER_SHAPES) || [];
  const shapeSet = new Set(shapeList);
  const haveShapeList = shapeList.length > 0;
  const red = [];
  const info = [];

  for (const key of Object.keys(SHAPE_AIM)) {
    if (!Object.prototype.hasOwnProperty.call(towerDefs, key)) {
      red.push(`朝向政策表登记了「${key}」，但塔定义表里没有这座塔（改名残留或拼写错误？）`);
    }
    if (haveShapeList && !shapeSet.has(key)) {
      red.push(`朝向政策表登记了「${key}」，但图形表里没有这个轮廓（画不出来）`);
    }
  }
  for (const key of Object.keys(towerDefs)) {
    if (haveShapeList && !shapeSet.has(key)) {
      red.push(`塔型「${key}」在塔定义表里却不在图形表里 → 会被画成兜底圆`);
    }
    if (!SHAPE_AIM[key]) info.push(key);
  }
  return { ok: red.length === 0, red, info };
}

module.exports = {
  // 政策
  TURN,
  DEFAULT_AIM,
  SHAPE_AIM,
  REST_ANGLE,
  policyOf,
  canRotateIcon,
  canRotateProjectile,
  spinOf,
  audit,
  // 角度
  numOr,
  normalizeAngle,
  angleBetween,
  angleTo,
  currentAngle,
  initAim,
  aimAt,
  aimAtTarget,
  // 变换
  applyIconTransform,
  applyProjectileTransform,
  advanceProjectile,
};
